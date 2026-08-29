import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  applyRichTextColorToken,
  getColorPaletteEntries,
  getColorPaletteKeyAction,
  PaletteSwatches,
  resetRichTextColorToken,
  RichTextColorControls,
} from '../../src/components/rich-text/rich-text-color-controls'
import { RICH_TEXT_COLOR_EXTENSIONS } from '../../src/components/rich-text/rich-text-editor'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import {
  HIGHLIGHT_COLOR_VALUES,
  TEXT_COLOR_VALUES,
} from '../../src/lib/rich-text-palette'

function createColorEditor(content: JSONContent = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{ type: 'text', text: 'Color controls' }],
  }],
}) {
  return new Editor({
    element: null,
    extensions: [StarterKit, ...RICH_TEXT_COLOR_EXTENSIONS],
    content,
  })
}

type RenderedSwatch = {
  kind: string
  token: string
  value: string
  background: string
  label: string
  selected: boolean
}

function attribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`${name}="([^"]*)"`))
  return match?.[1] ?? null
}

function renderedSwatches(markup: string): RenderedSwatch[] {
  const swatches: RenderedSwatch[] = []
  for (const match of markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attributes = match[1] ?? ''
    const body = match[2] ?? ''
    const kind = attribute(attributes, 'data-color-kind')
    if (!kind) continue
    const token = attribute(attributes, 'data-color-token')
    const value = attribute(attributes, 'data-color-value')
    const label = body.match(/<span class="min-w-0 flex-1">([^<]*)<\/span>/)?.[1]
    const background = body.match(/style="background-color:([^\"]+)"/)?.[1]
    const selected = attribute(attributes, 'data-selected') === 'true'
    if (!token || !value || !label || !background) {
      throw new Error(`incomplete rendered swatch: ${body}`)
    }
    swatches.push({ kind, token, value, background, label, selected })
  }
  return swatches
}

function labelForToken(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1)
}

describe('RichTextColorControls presentation', () => {
  it('renders responsive desktop and More controls without arbitrary color inputs', () => {
    const editor = createColorEditor()
    try {
      const markup = renderToStaticMarkup(createElement(RichTextColorControls, {
        editor,
        disabled: false,
        compact: false,
      }))

      assert.match(markup, /aria-label="Text color"/)
      assert.match(markup, /aria-label="Highlight"/)
      assert.match(markup, /aria-label="More formatting"/)
      assert.match(markup, /rich-text-color-controls-wide/)
      assert.match(markup, /rich-text-color-controls-compact/)
      assert.doesNotMatch(markup, /<input[^>]+type="color"/i)
      assert.doesNotMatch(markup, /(?:placeholder|aria-label)="(?:#|hex)/i)
    } finally {
      editor.destroy()
    }
  })

  it('uses the compact prop as the narrow-layout hint while retaining both palettes', () => {
    const editor = createColorEditor()
    try {
      const markup = renderToStaticMarkup(createElement(RichTextColorControls, {
        editor,
        disabled: false,
        compact: true,
      }))

      assert.match(markup, /data-compact="true"/)
      assert.match(markup, /Text color/)
      assert.match(markup, /Highlight/)
      assert.match(markup, /MoreHorizontal|More formatting/)
    } finally {
      editor.destroy()
    }
  })

  it('exposes selected token indicators in the server-rendered toolbar state', () => {
    const editor = createColorEditor()
    try {
      editor.commands.setTextSelection({ from: 1, to: 15 })
      assert.equal(editor.commands.setTextColorToken('blue'), true)
      assert.equal(editor.commands.setHighlightColorToken('pink'), true)

      const markup = renderToStaticMarkup(createElement(RichTextColorControls, {
        editor,
        disabled: false,
        compact: false,
      }))

      assert.match(markup, /data-active-token="blue"/)
      assert.match(markup, /data-active-value="#1D4ED8"/)
      assert.match(markup, /data-active-token="pink"/)
      assert.match(markup, /data-active-value="#FCE7F3"/)
    } finally {
      editor.destroy()
    }
  })

  it('renders exactly the exported swatches, values, backgrounds, and resets in More', () => {
    const editor = createColorEditor()
    try {
      const markup = [
        renderToStaticMarkup(createElement(TooltipProvider, null,
          createElement(PaletteSwatches, {
            editor,
            disabled: false,
            kind: 'text',
            label: 'Text color',
            entries: getColorPaletteEntries('text'),
            activeToken: 'blue',
            resetLabel: 'Default text',
          }),
        )),
        renderToStaticMarkup(createElement(TooltipProvider, null,
          createElement(PaletteSwatches, {
            editor,
            disabled: false,
            kind: 'highlight',
            label: 'Highlight',
            entries: getColorPaletteEntries('highlight'),
            activeToken: null,
            resetLabel: 'No highlight',
          }),
        )),
      ].join('')
      const expected = [
        ...Object.entries(TEXT_COLOR_VALUES).map(([token, value]) => ({
          kind: 'text', token, value, background: value, label: labelForToken(token), selected: token === 'blue',
        })),
        ...Object.entries(HIGHLIGHT_COLOR_VALUES).map(([token, value]) => ({
          kind: 'highlight', token, value, background: value, label: labelForToken(token), selected: false,
        })),
      ]

      assert.deepEqual(renderedSwatches(markup), expected)
      assert.match(markup, />Default text</)
      assert.match(markup, />No highlight</)
      assert.doesNotMatch(markup, /<input[^>]+type="color"/i)
    } finally {
      editor.destroy()
    }
  })
})

describe('RichTextColorControls TipTap behavior', () => {
  it('applies both marks with bold, then resets each mark independently', () => {
    const editor = createColorEditor()
    try {
      editor.commands.setTextSelection({ from: 1, to: 15 })
      assert.equal(editor.commands.setTextColorToken('blue'), true)
      assert.equal(editor.commands.setHighlightColorToken('yellow'), true)
      assert.equal(editor.commands.toggleBold(), true)

      const markedText = editor.getJSON().content?.[0]?.content?.[0]
      assert.deepEqual(
        markedText?.marks?.map((mark) => mark.type).sort(),
        ['bold', 'highlightColorToken', 'textColorToken'],
      )
      assert.doesNotMatch(JSON.stringify(editor.getJSON()), /style/)

      assert.equal(editor.commands.unsetHighlightColorToken(), true)
      const afterHighlightReset = editor.getJSON().content?.[0]?.content?.[0]
      assert.deepEqual(
        afterHighlightReset?.marks?.map((mark) => mark.type).sort(),
        ['bold', 'textColorToken'],
      )
      assert.equal(editor.commands.unsetTextColorToken(), true)
      const afterTextReset = editor.getJSON().content?.[0]?.content?.[0]
      assert.deepEqual(afterTextReset?.marks?.map((mark) => mark.type), ['bold'])
    } finally {
      editor.destroy()
    }
  })

  it('drives apply and reset through the control actions while keeping semantic serialization', () => {
    const editor = createColorEditor()
    try {
      editor.commands.setTextSelection({ from: 1, to: 15 })
      assert.equal(applyRichTextColorToken(editor, 'text', 'blue'), true)
      assert.equal(applyRichTextColorToken(editor, 'highlight', 'yellow'), true)
      const markedText = editor.getJSON().content?.[0]?.content?.[0]
      assert.deepEqual(markedText?.marks?.map((mark) => ({
        type: mark.type,
        attrs: { ...mark.attrs },
      })), [
        { type: 'textColorToken', attrs: { token: 'blue' } },
        { type: 'highlightColorToken', attrs: { token: 'yellow' } },
      ])
      assert.doesNotMatch(JSON.stringify(editor.getJSON()), /style/)
      assert.equal(resetRichTextColorToken(editor, 'highlight'), true)
      assert.equal(resetRichTextColorToken(editor, 'text'), true)
      assert.deepEqual(editor.getJSON().content?.[0]?.content?.[0]?.marks, undefined)
    } finally {
      editor.destroy()
    }
  })

  it('keeps compact swatch keyboard traversal roving and Escape-dismissible', () => {
    const editor = createColorEditor()
    try {
      const markup = renderToStaticMarkup(createElement(RichTextColorControls, {
        editor,
        disabled: false,
        compact: true,
      }))
      assert.match(markup, /aria-label="More formatting"[^>]*aria-haspopup="dialog"/)
    } finally {
      editor.destroy()
    }

    const textEntries = getColorPaletteEntries('text')
    const highlightEntries = getColorPaletteEntries('highlight')
    const textVisited = [0]
    for (let index = 0; index < textEntries.length; index += 1) {
      const action = getColorPaletteKeyAction(textVisited[textVisited.length - 1]!, 'ArrowRight', textEntries.length)
      assert.equal(action.close, false)
      assert.notEqual(action.focusIndex, null)
      textVisited.push(action.focusIndex!)
    }

    assert.deepEqual(textVisited, [0, 1, 2, 3, 4, 5, 6, 0])
    assert.equal(getColorPaletteKeyAction(0, 'ArrowLeft', textEntries.length).focusIndex, 6)
    assert.equal(getColorPaletteKeyAction(2, 'ArrowUp', highlightEntries.length).focusIndex, 1)
    assert.deepEqual(getColorPaletteKeyAction(0, 'Escape', textEntries.length), {
      focusIndex: null,
      close: true,
    })
  })

  it('uses the live RichTextEditor color extension set for both marks', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, ...RICH_TEXT_COLOR_EXTENSIONS],
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Palette' }] }],
      },
    })
    try {
      assert.ok(editor.schema.marks.textColorToken)
      assert.ok(editor.schema.marks.highlightColorToken)
      editor.commands.setTextSelection({ from: 1, to: 8 })
      assert.equal(applyRichTextColorToken(editor, 'text', 'teal'), true)
      assert.equal(applyRichTextColorToken(editor, 'highlight', 'pink'), true)
      const markedText = editor.getJSON().content?.[0]?.content?.[0]
      assert.deepEqual(markedText?.marks?.map((mark) => ({
        type: mark.type,
        attrs: { ...mark.attrs },
      })), [
        { type: 'textColorToken', attrs: { token: 'teal' } },
        { type: 'highlightColorToken', attrs: { token: 'pink' } },
      ])
      assert.doesNotMatch(JSON.stringify(editor.getJSON()), /style/)
    } finally {
      editor.destroy()
    }
  })

  it('keeps the exact exported palette values available to the controls contract', () => {
    assert.deepEqual(Object.keys(TEXT_COLOR_VALUES), ['ink', 'slate', 'blue', 'teal', 'green', 'amber', 'red'])
    assert.deepEqual(Object.keys(HIGHLIGHT_COLOR_VALUES), ['yellow', 'blue', 'green', 'pink', 'violet', 'red', 'gray'])
    assert.equal(Object.values(TEXT_COLOR_VALUES).length, 7)
    assert.equal(Object.values(HIGHLIGHT_COLOR_VALUES).length, 7)
  })
})
