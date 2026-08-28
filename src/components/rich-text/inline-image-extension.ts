import Image, { type ImageOptions } from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import {
  canonicalInlineImageSrc,
  MAX_INLINE_ALT_LENGTH,
  parseInlineImageSrc,
} from '@/lib/inline-images/policy'
import type { InlineImageCoordinator } from '@/hooks/use-inline-description-images'
import { InlineImageNodeView } from './inline-image-node-view'

export const INLINE_IMAGE_ALIGNMENTS = ['left', 'center', 'right'] as const
export type InlineImageAlignment = (typeof INLINE_IMAGE_ALIGNMENTS)[number]

export type InlineImageExtensionOptions = ImageOptions & {
  inlineImages?: InlineImageCoordinator
  fileByUploadId?: Map<string, File>
  insertionPositionByUploadId?: Map<string, number>
  localUploadIds?: Set<string>
}

function parseAlignment(value: string | null): InlineImageAlignment {
  return INLINE_IMAGE_ALIGNMENTS.includes(value as InlineImageAlignment)
    ? (value as InlineImageAlignment)
    : 'center'
}

/**
 * TipTap's image node narrowed to the private, canonical inline-image format.
 * Upload state remains in node attrs for the local NodeView, but is never part
 * of the serialized HTML returned by renderHTML.
 */
export const InlineImageExtension = Image.extend<InlineImageExtensionOptions>({
  name: 'inlineImage',

  addOptions() {
    return {
      ...this.parent?.(),
      inline: true,
      allowBase64: false,
      resize: false,
      HTMLAttributes: {},
      inlineImages: undefined,
      fileByUploadId: undefined,
      insertionPositionByUploadId: undefined,
      localUploadIds: undefined,
    }
  },

  inline() {
    return true
  },

  group() {
    return 'inline'
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: '',
      },
      align: {
        default: 'center',
      },
      uploadId: {
        default: null,
        rendered: false,
      },
      status: {
        default: null,
        rendered: false,
      },
      progress: {
        default: 0,
        rendered: false,
      },
      error: {
        default: null,
        rendered: false,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'img',
        getAttrs: (element: HTMLElement) => {
          const id = parseInlineImageSrc(element.getAttribute('src') ?? '')
          if (!id) return false

          return {
            src: canonicalInlineImageSrc(id),
            alt: (element.getAttribute('alt') ?? '').slice(0, MAX_INLINE_ALT_LENGTH),
            align: parseAlignment(element.getAttribute('data-align')),
          }
        },
      },
    ]
  },

  renderHTML({ node }) {
    return node.attrs.src
      ? ['img', { src: node.attrs.src, alt: node.attrs.alt, 'data-align': node.attrs.align }]
      : ['span', { 'data-inline-upload-placeholder': 'true' }]
  },

  // Markdown image input can contain remote URLs; image insertion is owned by
  // the toolbar/FileHandler pipeline and must never create an external node.
  addInputRules() {
    return []
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineImageNodeView)
  },
})

export const InlineImage = InlineImageExtension

export default InlineImageExtension
