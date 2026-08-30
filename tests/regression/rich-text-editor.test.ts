import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  bindInlineImageCropCommands,
  RICH_TEXT_COLOR_EXTENSIONS,
} from '../../src/components/rich-text/rich-text-editor'
import { createInlineImageCropCommandsController } from '../../src/components/rich-text/inline-image-extension'

const read = (path: string) => readFileSync(path, 'utf8')

describe('RichTextEditor implementation', () => {
  const source = read('src/components/rich-text/rich-text-editor.tsx')

  it('configures only the approved extension set', () => {
    for (const ext of ['StarterKit', 'Underline', 'Link', 'TableKit']) {
      assert.match(source, new RegExp(`\\b${ext}\\b`))
    }
    assert.match(source, /AlignedHeading\.configure\(\{\s*levels:\s*\[2,\s*3\]\s*\}\)/)
    assert.match(source, /AlignedParagraph/)
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

  it('wires crop activity to editor editability and toolbar command state', () => {
    const controller = createInlineImageCropCommandsController()
    const editableCalls: boolean[] = []
    const commandDisabledCalls: boolean[] = []
    const editor = {
      setEditable: (editable: boolean) => editableCalls.push(editable),
    }
    const unsubscribe = bindInlineImageCropCommands({
      controller,
      getEditor: () => editor,
      isDisabled: () => false,
      setCommandsDisabled: (disabled: boolean) => commandDisabledCalls.push(disabled),
    })

    controller.begin()
    assert.deepEqual(commandDisabledCalls, [true])
    assert.deepEqual(editableCalls, [false])

    controller.end()
    assert.deepEqual(commandDisabledCalls, [true, false])
    assert.deepEqual(editableCalls, [false, true])

    unsubscribe()
    controller.begin()
    assert.deepEqual(commandDisabledCalls, [true, false])
    assert.deepEqual(editableCalls, [false, true])
    controller.end()
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

describe('RichTextEditor palette schema integration', () => {
  it('supports semantic color commands alongside the editor formatting schema', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, ...RICH_TEXT_COLOR_EXTENSIONS],
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Palette' }] }],
      },
    })
    try {
      editor.commands.setTextSelection({ from: 1, to: 8 })
      assert.equal(editor.commands.setTextColorToken('teal'), true)
      assert.equal(editor.commands.setHighlightColorToken('pink'), true)
      assert.equal(editor.commands.toggleBold(), true)
      assert.deepEqual(
        editor.getJSON().content?.[0]?.content?.[0]?.marks?.map((mark) => mark.type).sort(),
        ['bold', 'highlightColorToken', 'textColorToken'],
      )
      assert.doesNotMatch(JSON.stringify(editor.getJSON()), /style/)
    } finally {
      editor.destroy()
    }
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
