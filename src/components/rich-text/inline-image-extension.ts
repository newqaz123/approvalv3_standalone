import type { Editor } from '@tiptap/core'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import {
  canonicalInlineImageSrc,
  INLINE_IMAGE_MIMES,
  MAX_INLINE_ALT_LENGTH,
  parseInlineImageSrc,
  type InlineImageUpload,
} from '@/lib/inline-images/policy'
import {
  parseInlineImagePresentation,
  serializeInlineImagePresentation,
  type InlineImagePresentation,
} from '@/lib/inline-images/presentation'
import type { InlineImageCoordinator } from '@/hooks/use-inline-description-images'
import type { Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model'
import { InlineImageNodeView } from './inline-image-node-view'

export const INLINE_IMAGE_ALIGNMENTS = ['left', 'center', 'right'] as const
export type InlineImageAlignment = (typeof INLINE_IMAGE_ALIGNMENTS)[number]

export type InlineImageExtensionOptions = ImageOptions & {
  inlineImages?: InlineImageCoordinator
  fileByUploadId?: Map<string, File>
  insertionPositionByUploadId?: Map<string, number>
  localUploadIds?: Set<string>
  removedUploadIds?: Set<string>
}

function parseAlignment(value: string | null): InlineImageAlignment {
  return INLINE_IMAGE_ALIGNMENTS.includes(value as InlineImageAlignment)
    ? (value as InlineImageAlignment)
    : 'center'
}

/**
 * FileHandler calls `includes` before it invokes an event callback. Keep that
 * gate live so a disabled editor or missing coordinator leaves the browser
 * event available to the editor's normal paste/drop handling.
 */
export function createInlineImageMimeFilter(canInsert: () => boolean): string[] {
  const mimeTypes = Array.from(INLINE_IMAGE_MIMES)
  const includes = mimeTypes.includes.bind(mimeTypes)
  Object.defineProperty(mimeTypes, 'includes', {
    configurable: true,
    value: (mime: string, fromIndex?: number) => canInsert() && includes(mime, fromIndex),
  })
  return mimeTypes
}

/** Every serialized data attribute owned by the presentation module. */
const INLINE_IMAGE_PRESENTATION_DATA_ATTRIBUTES = [
  'data-width',
  'data-natural-width',
  'data-natural-height',
  'data-crop-x',
  'data-crop-y',
  'data-crop-width',
  'data-crop-height',
] as const

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Node attrs are the flat storage form of one presentation record. */
export function inlineImageNodePresentation(
  attrs: Record<string, unknown>,
): InlineImagePresentation {
  const cropX = finiteNumberOrNull(attrs.cropX)
  const cropY = finiteNumberOrNull(attrs.cropY)
  const cropWidth = finiteNumberOrNull(attrs.cropWidth)
  const cropHeight = finiteNumberOrNull(attrs.cropHeight)
  const hasCrop = cropX !== null && cropY !== null && cropWidth !== null && cropHeight !== null
  return {
    displayWidth: finiteNumberOrNull(attrs.displayWidth),
    naturalWidth: finiteNumberOrNull(attrs.naturalWidth),
    naturalHeight: finiteNumberOrNull(attrs.naturalHeight),
    crop: hasCrop ? { x: cropX, y: cropY, width: cropWidth, height: cropHeight } : null,
  }
}

/** Parses the serialized data attributes back through the presentation module. */
export function parseInlineImageNodePresentation(element: HTMLElement): InlineImagePresentation {
  const attributes: Record<string, string | null> = {}
  for (const name of INLINE_IMAGE_PRESENTATION_DATA_ATTRIBUTES) {
    attributes[name] = element.getAttribute(name)
  }
  return parseInlineImagePresentation(attributes)
}

/** Upload-success attrs shared by the editor insertion pipeline and NodeView retry. */
export function inlineImageUploadSuccessAttributes(
  upload: InlineImageUpload,
  alt: string,
  align: InlineImageAlignment,
): {
  src: string
  alt: string
  align: InlineImageAlignment
  status: 'success'
  progress: number
  error: null
  naturalWidth: number
  naturalHeight: number
} {
  return {
    src: upload.src,
    alt: alt.slice(0, MAX_INLINE_ALT_LENGTH),
    align,
    status: 'success',
    progress: 100,
    error: null,
    naturalWidth: upload.width,
    naturalHeight: upload.height,
  }
}

export type InlineImageUploadNodeSnapshot = {
  uploadId: string
  imageId?: string
  pos: number
  attrs: Record<string, unknown>
}

export type InlineImageUploadSnapshot = Map<string, InlineImageUploadNodeSnapshot>

/** Collects local upload nodes so transaction cleanup can restore one on failure. */
export function collectInlineImageUploads(doc: ProseMirrorNode): InlineImageUploadSnapshot {
  const uploads: InlineImageUploadSnapshot = new Map()
  doc.descendants((node, pos) => {
    if (node.type.name !== 'inlineImage') return true

    const uploadId = typeof node.attrs.uploadId === 'string' ? node.attrs.uploadId : ''
    if (uploadId) {
      const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
      uploads.set(uploadId, {
        uploadId,
        imageId: src ? parseInlineImageSrc(src) ?? undefined : undefined,
        pos,
        attrs: { ...node.attrs },
      })
    }
    return true
  })
  return uploads
}

/** Calls cleanup for local upload nodes that disappeared in a transaction. */
export function reconcileRemovedInlineImageUploads(
  previous: ReadonlyMap<string, InlineImageUploadNodeSnapshot>,
  current: ReadonlyMap<string, InlineImageUploadNodeSnapshot>,
  localUploadIds: ReadonlySet<string>,
  onRemove: (upload: InlineImageUploadNodeSnapshot) => void,
): void {
  for (const [uploadId, upload] of previous) {
    if (!current.has(uploadId) && localUploadIds.has(uploadId)) {
      onRemove(upload)
    }
  }
}

export type InlineImageTransactionCleanupControllerOptions = {
  getCoordinator: () => InlineImageCoordinator | undefined
  fileByUploadId: Map<string, File>
  insertionPositionByUploadId: Map<string, number>
  localUploadIds: Set<string>
  removedUploadIds: Set<string>
}

export type InlineImageTransactionCleanupController = {
  attach(editor: Editor): void
  detach(editor?: Editor): void
  handleTransaction(editor: Editor): void
}

function cleanupError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Image cleanup failed'
}

function findInlineInsertionPosition(
  doc: ProseMirrorNode,
  type: NodeType,
  preferredPosition: number,
): number | null {
  const maximum = doc.content.size
  const preferred = Math.max(0, Math.min(preferredPosition, maximum))

  for (let offset = 0; offset <= maximum; offset += 1) {
    const candidates = offset === 0
      ? [preferred]
      : [preferred - offset, preferred + offset]
    for (const position of candidates) {
      if (position < 0 || position > maximum) continue
      const resolved = doc.resolve(position)
      const index = resolved.index()
      if (resolved.parent.canReplaceWith(index, index, type)) return position
    }
  }

  return null
}

function removeUploadNodes(
  editor: Editor,
  uploadIds: ReadonlySet<string>,
): void {
  if (uploadIds.size === 0) return

  const matches: Array<{ pos: number; size: number }> = []
  editor.state.doc.descendants((node, pos) => {
    if (
      node.type.name === 'inlineImage'
      && typeof node.attrs.uploadId === 'string'
      && uploadIds.has(node.attrs.uploadId)
    ) {
      matches.push({ pos, size: node.nodeSize })
    }
    return true
  })
  if (matches.length === 0) return

  let transaction = editor.state.tr
  for (const match of matches.sort((left, right) => right.pos - left.pos)) {
    transaction = transaction.delete(match.pos, match.pos + match.size)
  }
  transaction.setMeta('addToHistory', false)
  transaction.setMeta('inlineImageCleanup', true)
  editor.view.dispatch(transaction)
}

function restoreUploadNode(
  editor: Editor,
  upload: InlineImageUploadNodeSnapshot,
  error: unknown,
): void {
  const attrs = {
    ...upload.attrs,
    status: upload.imageId ? 'removal-error' : 'error',
    error: `Unable to remove image: ${cleanupError(error)}`,
  }
  let existingPosition: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'inlineImage' && node.attrs.uploadId === upload.uploadId) {
      existingPosition = pos
      return false
    }
    return true
  })

  let transaction = editor.state.tr
  if (existingPosition !== null) {
    transaction = transaction.setNodeMarkup(existingPosition, undefined, attrs)
  } else {
    const type = editor.schema.nodes.inlineImage
    const insertionPosition = type
      ? findInlineInsertionPosition(editor.state.doc, type, upload.pos)
      : null
    if (!type || insertionPosition === null) return
    transaction = transaction.insert(insertionPosition, type.create(attrs))
  }
  transaction.setMeta('addToHistory', false)
  transaction.setMeta('inlineImageCleanupRecovery', true)
  editor.view.dispatch(transaction)
}

/**
 * Reconciles deletion, cut, and undo transactions with coordinator cleanup.
 * Local state is discarded only after coordinator removal succeeds. A failure
 * restores the node with an actionable removal error, preserving retry state.
 */
export function createInlineImageTransactionCleanupController(
  options: InlineImageTransactionCleanupControllerOptions,
): InlineImageTransactionCleanupController {
  let activeEditor: Editor | null = null
  let observedUploads: InlineImageUploadSnapshot = new Map()
  const cleanupPending = new Set<string>()
  const pendingRecoveries = new Map<string, { upload: InlineImageUploadNodeSnapshot; error: unknown }>()

  const applyRecoveries = () => {
    const editor = activeEditor
    if (!editor) return
    for (const [uploadId, recovery] of pendingRecoveries) {
      pendingRecoveries.delete(uploadId)
      restoreUploadNode(editor, recovery.upload, recovery.error)
    }
  }

  const beginCleanup = (upload: InlineImageUploadNodeSnapshot) => {
    if (cleanupPending.has(upload.uploadId) || options.removedUploadIds.has(upload.uploadId)) return
    cleanupPending.add(upload.uploadId)

    const coordinator = options.getCoordinator()
    if (!coordinator) {
      cleanupPending.delete(upload.uploadId)
      pendingRecoveries.set(upload.uploadId, {
        upload,
        error: new Error('Image cleanup is unavailable'),
      })
      applyRecoveries()
      return
    }

    void Promise.resolve()
      .then(() => coordinator.remove(upload.uploadId, upload.imageId))
      .then(() => {
        pendingRecoveries.delete(upload.uploadId)
        options.removedUploadIds.add(upload.uploadId)
        options.localUploadIds.delete(upload.uploadId)
        options.fileByUploadId.delete(upload.uploadId)
        options.insertionPositionByUploadId.delete(upload.uploadId)
        const editor = activeEditor
        if (editor) removeUploadNodes(editor, new Set([upload.uploadId]))
      })
      .catch((error: unknown) => {
        pendingRecoveries.set(upload.uploadId, { upload, error })
        applyRecoveries()
      })
      .finally(() => {
        cleanupPending.delete(upload.uploadId)
      })
  }

  return {
    attach(editor) {
      activeEditor = editor
      observedUploads = collectInlineImageUploads(editor.state.doc)
      removeUploadNodes(editor, options.removedUploadIds)
      applyRecoveries()
    },

    detach(editor) {
      if (!editor || activeEditor === editor) activeEditor = null
      observedUploads = new Map()
    },

    handleTransaction(editor) {
      activeEditor = editor
      const nextUploads = collectInlineImageUploads(editor.state.doc)
      const previousUploads = observedUploads
      observedUploads = nextUploads

      const resurrected = new Set(
        [...nextUploads.keys()].filter((uploadId) => options.removedUploadIds.has(uploadId)),
      )
      removeUploadNodes(editor, resurrected)
      reconcileRemovedInlineImageUploads(
        previousUploads,
        nextUploads,
        options.localUploadIds,
        beginCleanup,
      )
    },
  }
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
      removedUploadIds: undefined,
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
      displayWidth: {
        default: null,
      },
      naturalWidth: {
        default: null,
      },
      naturalHeight: {
        default: null,
      },
      cropX: {
        default: null,
      },
      cropY: {
        default: null,
      },
      cropWidth: {
        default: null,
      },
      cropHeight: {
        default: null,
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

          const presentation = parseInlineImageNodePresentation(element)
          return {
            src: canonicalInlineImageSrc(id),
            alt: (element.getAttribute('alt') ?? '').slice(0, MAX_INLINE_ALT_LENGTH),
            align: parseAlignment(element.getAttribute('data-align')),
            displayWidth: presentation.displayWidth,
            naturalWidth: presentation.naturalWidth,
            naturalHeight: presentation.naturalHeight,
            cropX: presentation.crop?.x ?? null,
            cropY: presentation.crop?.y ?? null,
            cropWidth: presentation.crop?.width ?? null,
            cropHeight: presentation.crop?.height ?? null,
          }
        },
      },
    ]
  },

  renderHTML({ node }) {
    if (!node.attrs.src) {
      return ['span', { 'data-inline-upload-placeholder': 'true' }]
    }
    return ['img', {
      src: node.attrs.src,
      alt: node.attrs.alt,
      'data-align': node.attrs.align,
      ...serializeInlineImagePresentation(inlineImageNodePresentation(node.attrs)),
    }]
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
