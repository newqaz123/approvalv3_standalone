import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  HighlightColorTokenMark,
  TextColorTokenMark,
} from '../../src/components/rich-text/rich-text-color-extensions'
import { RichTextColorControls } from '../../src/components/rich-text/rich-text-color-controls'
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
    extensions: [StarterKit, TextColorTokenMark, HighlightColorTokenMark],
    content,
  })
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

  it('keeps the exact exported palette values available to the controls contract', () => {
    assert.deepEqual(Object.keys(TEXT_COLOR_VALUES), ['ink', 'slate', 'blue', 'teal', 'green', 'amber', 'red'])
    assert.deepEqual(Object.keys(HIGHLIGHT_COLOR_VALUES), ['yellow', 'blue', 'green', 'pink', 'violet', 'red', 'gray'])
    assert.equal(Object.values(TEXT_COLOR_VALUES).length, 7)
    assert.equal(Object.values(HIGHLIGHT_COLOR_VALUES).length, 7)
  })
})
