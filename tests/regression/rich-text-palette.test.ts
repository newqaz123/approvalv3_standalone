import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  HIGHLIGHT_COLOR_VALUES,
  TEXT_COLOR_VALUES,
  isHighlightColorToken,
  isTextColorToken,
  materializeRichTextPalette,
} from '../../src/lib/rich-text-palette'
import {
  HighlightColorTokenMark,
  TextColorTokenMark,
} from '../../src/components/rich-text/rich-text-color-extensions'

const nestedContent: JSONContent = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{
      type: 'text',
      text: 'Nested',
      marks: [
        { type: 'bold' },
        { type: 'link', attrs: { href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer' } },
        { type: 'textColorToken', attrs: { token: 'blue' } },
        { type: 'highlightColorToken', attrs: { token: 'yellow' } },
      ],
    }],
  }],
}

function createPaletteEditor(content: JSONContent = nestedContent) {
  return new Editor({
    element: null,
    extensions: [StarterKit, TextColorTokenMark, HighlightColorTokenMark],
    content,
  })
}

function markNames(editor: Editor): string[] {
  const text = editor.getJSON().content?.[0]?.content?.[0]
  return (text?.marks ?? []).map((mark) => mark.type).sort()
}

describe('rich text palette contract', () => {
  it('exports only the exact Calm Document token maps', () => {
    assert.deepEqual(TEXT_COLOR_VALUES, {
      ink: '#1E293B',
      slate: '#475569',
      blue: '#1D4ED8',
      teal: '#0F766E',
      green: '#15803D',
      amber: '#B45309',
      red: '#B91C1C',
    })
    assert.deepEqual(HIGHLIGHT_COLOR_VALUES, {
      yellow: '#FEF3C7',
      blue: '#DBEAFE',
      green: '#D1FAE5',
      pink: '#FCE7F3',
      violet: '#EDE9FE',
      red: '#FEE2E2',
      gray: '#E2E8F0',
    })
  })

  it('accepts exact case-sensitive token names and rejects all other values', () => {
    assert.equal(isTextColorToken('ink'), true)
    assert.equal(isTextColorToken('blue'), true)
    assert.equal(isTextColorToken('Blue'), false)
    assert.equal(isTextColorToken('#1D4ED8'), false)
    assert.equal(isTextColorToken(null), false)

    assert.equal(isHighlightColorToken('yellow'), true)
    assert.equal(isHighlightColorToken('gray'), true)
    assert.equal(isHighlightColorToken('Yellow'), false)
    assert.equal(isHighlightColorToken('#FEF3C7'), false)
    assert.equal(isHighlightColorToken(undefined), false)
  })

  it('materializes deterministic trusted output for app, email, and PDF', () => {
    const semantic = '<p><span data-text-color="blue">Blue <mark data-highlight="yellow"><strong>check</strong></mark></span></p>'
    const materialized = '<p><span style="color:#1D4ED8">Blue <mark style="background-color:#FEF3C7"><strong>check</strong></mark></span></p>'
    assert.equal(materializeRichTextPalette(semantic, 'app'), materialized)
    assert.equal(materializeRichTextPalette(semantic, 'email'), materialized)
    assert.equal(materializeRichTextPalette(semantic, 'pdf'), materialized)
  })

  it('falls back to neutral text instead of materializing invalid or arbitrary values', () => {
    const hostile = '<span data-text-color="BLUE" style="color:#ff00ff">A</span><mark data-highlight="orange" style="background:var(--x)">B</mark>'
    for (const target of ['app', 'email', 'pdf'] as const) {
      const output = materializeRichTextPalette(hostile, target)
      assert.equal(output, '<span>A</span><span>B</span>')
      assert.doesNotMatch(output, /#ff00ff|var\(|style=/)
    }
  })
})

describe('restricted TipTap palette marks', () => {
  it('round-trips nested color, highlight, bold, and link marks through a real headless editor', () => {
    const first = createPaletteEditor()
    const second = createPaletteEditor(first.getJSON())
    try {
      assert.deepEqual(second.getJSON(), first.getJSON())
      assert.deepEqual(markNames(second), ['bold', 'highlightColorToken', 'link', 'textColorToken'])

      const textMark = second.schema.marks.textColorToken.create({ token: 'blue' })
      const highlightMark = second.schema.marks.highlightColorToken.create({ token: 'yellow' })
      assert.deepEqual(second.schema.marks.textColorToken.spec.toDOM!(textMark, true), ['span', { 'data-text-color': 'blue' }, 0])
      assert.deepEqual(second.schema.marks.highlightColorToken.spec.toDOM!(highlightMark, true), ['mark', { 'data-highlight': 'yellow' }, 0])
      assert.doesNotMatch(JSON.stringify(second.getJSON()), /style/)
    } finally {
      first.destroy()
      second.destroy()
    }
  })

  it('unsets text color and highlight independently without disturbing other marks', () => {
    const editor = createPaletteEditor()
    try {
      editor.commands.setTextSelection({ from: 1, to: 7 })
      assert.equal(editor.commands.unsetTextColorToken(), true)
      assert.deepEqual(markNames(editor), ['bold', 'highlightColorToken', 'link'])

      assert.equal(editor.commands.unsetHighlightColorToken(), true)
      assert.deepEqual(markNames(editor), ['bold', 'link'])

      assert.equal(editor.commands.setTextColorToken('teal'), true)
      assert.equal(editor.commands.setHighlightColorToken('pink'), true)
      assert.deepEqual(markNames(editor), ['bold', 'highlightColorToken', 'link', 'textColorToken'])
    } finally {
      editor.destroy()
    }
  })

  it('maps only exact approved pasted CSS colors to semantic tokens', () => {
    const editor = createPaletteEditor()
    type StyleRule = {
      style?: string
      getAttrs?: (value: string) => false | Record<string, unknown>
    }
    try {
      const textRules = (editor.schema.marks.textColorToken.spec.parseDOM ?? []) as StyleRule[]
      const highlightRules = (editor.schema.marks.highlightColorToken.spec.parseDOM ?? []) as StyleRule[]
      const textStyle = textRules.find((rule) => rule.style === 'color')
      const highlightStyle = highlightRules.find((rule) => rule.style === 'background-color')
      assert.ok(textStyle && textStyle.getAttrs)
      assert.ok(highlightStyle && highlightStyle.getAttrs)

      assert.deepEqual(textStyle.getAttrs!('#1D4ED8'), { token: 'blue' })
      assert.deepEqual(textStyle.getAttrs!('#1d4ed8'), { token: 'blue' })
      assert.deepEqual(textStyle.getAttrs!('rgb(29, 78, 216)'), { token: 'blue' })
      assert.deepEqual(textStyle.getAttrs!('rgba(29, 78, 216, 1)'), { token: 'blue' })
      assert.equal(textStyle.getAttrs!('rgba(29, 78, 216, 0.99)'), false)
      assert.equal(textStyle.getAttrs!('blue'), false)
      assert.equal(textStyle.getAttrs!('var(--blue)'), false)

      assert.deepEqual(highlightStyle.getAttrs!('#fef3c7'), { token: 'yellow' })
      assert.deepEqual(highlightStyle.getAttrs!('rgb(254, 243, 199)'), { token: 'yellow' })
      assert.deepEqual(highlightStyle.getAttrs!('rgba(254, 243, 199, 1)'), { token: 'yellow' })
      assert.equal(highlightStyle.getAttrs!('hsl(48, 96%, 89%)'), false)
      assert.equal(highlightStyle.getAttrs!('rgba(254, 243, 199, 0.5)'), false)
    } finally {
      editor.destroy()
    }
  })
})
