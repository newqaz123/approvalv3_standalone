import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('RichTextEditor implementation', () => {
  const source = read('src/components/rich-text/rich-text-editor.tsx')

  it('configures only the approved extension set', () => {
    for (const ext of ['StarterKit', 'Underline', 'Link']) {
      assert.match(source, new RegExp(`\\b${ext}\\b`))
    }
    assert.match(source, /heading:\s*\{\s*levels:\s*\[2,\s*3\]/)
    // TipTap v3 configures extensions via Link.configure({...}) — the
    // brief's original regex expected an object-literal `link: {autolink}`
    // shape that never occurs in this API.
    assert.match(source, /Link\.configure\(\{\s*autolink/)
  })

  it('disables every StarterKit member outside the approved schema', () => {
    // Approved node/mark set: paragraph, text, bold, italic, underline,
    // strike, lists, heading(2,3), link, history only. StarterKit bundles
    // blockquote/code/codeBlock/hardBreak/horizontalRule by default — all
    // must be explicitly off so paste/shortcuts cannot produce markup the
    // sanitizer would strip (and users would silently lose).
    for (const member of ['blockquote', 'code', 'codeBlock', 'hardBreak', 'horizontalRule']) {
      assert.match(source, new RegExp(`${member}:\\s*false`))
    }
  })

  it('validates link URLs client-side before applying them', () => {
    assert.match(source, /ALLOWED_URL_RE/)
    assert.match(source, /ALLOWED_URL_RE\.test\(/)
  })

  it('gates toolbar commands on the component disabled flag', () => {
    assert.match(source, /const commandsDisabled = disabled \|\| cropCommandsDisabled/)
    assert.match(source, /disabled\s*=\{commandsDisabled\}/)
  })

  it('guards the external setContent sync against re-emission loops', () => {
    // The guard must set lastEmitted BEFORE setContent so the resulting
    // onUpdate sees value === lastEmitted.current and skips onChange.
    assert.match(
      source,
      /lastEmitted\.current = value[\s\S]{0,80}editor\.commands\.setContent/,
    )
  })

  it('sanitizes editor output before it reaches the parent', () => {
    assert.match(source, /emitSanitizedRichTextChange\(current\.getHTML\(\)/)
  })

  it('exposes an accessible toolbar with toggling state', () => {
    assert.match(source, /aria-label=/)
    assert.match(source, /aria-pressed=/)
    assert.match(source, /focus-visible/)
  })
})

describe('RichTextEditor lazy wrapper', () => {
  const lazy = read('src/components/rich-text/rich-text-editor-lazy.tsx')

  it('loads the editor dynamically with ssr disabled', () => {
    assert.match(lazy, /next\/dynamic/)
    assert.match(lazy, /ssr:\s*false/)
  })

  it('falls back to FormattedTextarea while loading', () => {
    assert.match(lazy, /FormattedTextarea/)
  })

  it('sanitizes the error-fallback textarea emissions', () => {
    // The fallback textarea emits raw keystrokes; those must pass through
    // the sanitizer before reaching the parent, same as the rich editor.
    assert.match(
      lazy,
      /onChange=\{\(e\) => props\.onChange\(sanitizeRichText\(e\.target\.value\)\)\}/,
    )
  })
})

describe('fallback sanitizer passthrough (runtime)', () => {
  it('leaves legacy **bold** prose unchanged through sanitizeRichText', async () => {
    const { sanitizeRichText } = await import('@/lib/rich-text-sanitizer')
    const legacy = 'plain **b** text'
    assert.equal(sanitizeRichText(legacy), legacy)
  })
})
