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

  it('sanitizes editor output before it reaches the parent', () => {
    assert.match(source, /sanitizeRichText\((?:editor|current)\.getHTML\(\)\)/)
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
})
