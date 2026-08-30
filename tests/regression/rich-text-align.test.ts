import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  AlignedHeading,
  AlignedParagraph,
  currentRichTextBlockAlign,
  setRichTextBlockAlign,
} from '@/components/rich-text/rich-text-align-extensions'
import { sanitizeRichText } from '@/lib/rich-text-sanitizer'

function createEditor() {
  return new Editor({
    extensions: [
      AlignedParagraph,
      AlignedHeading.configure({ levels: [2, 3] }),
      StarterKit.configure({ paragraph: false, heading: false }),
    ],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Line' }] }],
    },
  })
}

describe('rich text paragraph alignment', () => {
  it('aligns the current paragraph and sanitizes only allowlisted tokens', () => {
    const editor = createEditor()
    try {
      assert.equal(currentRichTextBlockAlign(editor), 'left')
      assert.equal(setRichTextBlockAlign(editor, 'center'), true)
      assert.equal(currentRichTextBlockAlign(editor), 'center')
      assert.equal(editor.state.doc.firstChild?.attrs.textAlign, 'center')
      assert.equal(setRichTextBlockAlign(editor, 'left'), true)
      assert.equal(editor.state.doc.firstChild?.attrs.textAlign, 'left')
    } finally {
      editor.destroy()
    }
  })

  it('keeps only allowlisted block alignment in stored HTML', () => {
    assert.equal(
      sanitizeRichText('<p data-text-align="center">Line</p>'),
      '<p data-text-align="center">Line</p>',
    )
    assert.equal(sanitizeRichText('<p data-text-align="left">Line</p>'), '<p>Line</p>')
  })
})
