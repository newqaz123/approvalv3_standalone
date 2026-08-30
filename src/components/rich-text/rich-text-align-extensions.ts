import Heading from '@tiptap/extension-heading'
import Paragraph from '@tiptap/extension-paragraph'
import type { Editor } from '@tiptap/core'
import {
  normalizeRichTextAlignment,
  serializeRichTextAlignment,
  type RichTextAlignment,
} from '@/lib/rich-text-align'

const alignAttribute = {
  textAlign: {
    default: 'left' as RichTextAlignment,
    parseHTML: (element: HTMLElement) => normalizeRichTextAlignment(element.getAttribute('data-text-align')),
    renderHTML: (attributes: Record<string, unknown>) => (
      serializeRichTextAlignment(normalizeRichTextAlignment(
        typeof attributes.textAlign === 'string' ? attributes.textAlign : null,
      ))
    ),
  },
}

export const AlignedParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...alignAttribute,
    }
  },
})

export const AlignedHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...alignAttribute,
    }
  },
})

/** Aligns the paragraph or heading that currently owns the cursor. */
export function setRichTextBlockAlign(editor: Editor, align: RichTextAlignment): boolean {
  const next = normalizeRichTextAlignment(align)
  const type = editor.state.selection.$from.parent.type.name
  if (type !== 'paragraph' && type !== 'heading') return false
  return editor.commands.updateAttributes(type, { textAlign: next })
}

export function currentRichTextBlockAlign(editor: Editor): RichTextAlignment {
  const parent = editor.state.selection.$from.parent
  return normalizeRichTextAlignment(
    typeof parent.attrs.textAlign === 'string' ? parent.attrs.textAlign : null,
  )
}
