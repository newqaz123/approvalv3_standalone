'use client'

import * as React from 'react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import {
  attachInlineImageResizeEscapeGuard,
  createInlineImageResizeSession,
  discardInlineImageResizeSession,
  type InlineImageResizeEdge,
  type InlineImageResizeSession,
} from './inline-image-resize'
import { InlineImageToolbar } from './inline-image-toolbar'
import {
  inlineImageUploadSuccessAttributes,
  type InlineImageExtensionOptions,
} from './inline-image-extension'
import type { InlineImageCoordinator } from '@/hooks/use-inline-description-images'
import { MAX_INLINE_ALT_LENGTH, parseInlineImageSrc } from '@/lib/inline-images/policy'
import {
  INLINE_IMAGE_MAX_DISPLAY_WIDTH,
  INLINE_IMAGE_MIN_DISPLAY_WIDTH,
} from '@/lib/inline-images/presentation'

function extensionOptions(extension: NodeViewProps['extension']): InlineImageExtensionOptions {
  return extension.options as unknown as InlineImageExtensionOptions
}

function uploadError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Image upload failed'
}

/** Corner handle -> drag edge mapping; vertical position only changes the cursor. */
export const INLINE_IMAGE_RESIZE_CORNERS: ReadonlyArray<{
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  edge: InlineImageResizeEdge
}> = [
  { corner: 'top-left', edge: 'left' },
  { corner: 'top-right', edge: 'right' },
  { corner: 'bottom-left', edge: 'left' },
  { corner: 'bottom-right', edge: 'right' },
]

export type InlineImageResizeHandlesProps = {
  disabled: boolean
  onPointerDown: (edge: InlineImageResizeEdge, event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
  onDoubleClick: () => void
}

/** Four focusable 24px corner handles for pointer and keyboard resizing. */
export function InlineImageResizeHandles({
  disabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
  onDoubleClick,
}: InlineImageResizeHandlesProps) {
  return (
    <span contentEditable={false} className="inline-image-resize-handles">
      {INLINE_IMAGE_RESIZE_CORNERS.map(({ corner, edge }) => (
        <button
          key={corner}
          type="button"
          aria-label={`Resize image ${corner}`}
          disabled={disabled}
          className={`inline-image-resize-handle inline-image-resize-handle--${corner}`}
          onPointerDown={(event) => onPointerDown(edge, event)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={onKeyDown}
          onDoubleClick={onDoubleClick}
        />
      ))}
    </span>
  )
}

export type RemoveInlineImageNodeInput = {
  uploadId: string
  imageId?: string
  isLocalUpload: boolean
  coordinator?: InlineImageCoordinator
  fileByUploadId?: Map<string, File>
  insertionPositionByUploadId?: Map<string, number>
  localUploadIds?: Set<string>
  removedUploadIds?: Set<string>
  deleteNode: () => void
}

/** Deletes coordinator state before removing a local draft from the document. */
export async function removeInlineImageNode(input: RemoveInlineImageNodeInput): Promise<void> {
  if (!input.isLocalUpload) {
    input.deleteNode()
    return
  }
  if (!input.coordinator) throw new Error('Image cleanup is unavailable')

  await input.coordinator.remove(input.uploadId, input.imageId)
  input.removedUploadIds?.add(input.uploadId)
  input.localUploadIds?.delete(input.uploadId)
  input.fileByUploadId?.delete(input.uploadId)
  input.insertionPositionByUploadId?.delete(input.uploadId)
  input.deleteNode()
}

/** Height of the floating toolbar plus its gap, used for the below-flip. */
const INLINE_IMAGE_TOOLBAR_CLEARANCE = 44

/** The nearest ancestor whose overflow actually clips the frame. */
function inlineImageClipContainer(element: HTMLElement): HTMLElement | null {
  let ancestor: HTMLElement | null = element.parentElement
  while (ancestor instanceof HTMLElement) {
    const overflow = getComputedStyle(ancestor).overflowY
    if (overflow === 'hidden' || overflow === 'auto' || overflow === 'scroll') return ancestor
    ancestor = ancestor.parentElement
  }
  return null
}

/**
 * Applies attrs to one inline image in a single transaction and keeps the
 * node selected. TipTap's updateAttributes alone maps a NodeSelection to a
 * collapsed cursor, which would hide the toolbar and handles after every
 * resize or toolbar action.
 */
export function applyInlineImageAttributes(
  editor: Editor,
  position: number,
  attributes: Record<string, unknown>,
): void {
  const node = editor.state.doc.nodeAt(position)
  if (!node || node.type.name !== 'inlineImage') return

  const transaction = editor.state.tr.setNodeMarkup(position, undefined, {
    ...node.attrs,
    ...attributes,
  })
  transaction.setSelection(NodeSelection.create(transaction.doc, position))
  editor.view.dispatch(transaction)
}

/** Interactive view for one local upload or committed private image. */
export function InlineImageNodeView({
  node,
  editor,
  selected,
  extension,
  getPos,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const options = extensionOptions(extension)
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
  const uploadId = typeof node.attrs.uploadId === 'string' ? node.attrs.uploadId : ''
  const status = typeof node.attrs.status === 'string' ? node.attrs.status : ''
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
  const align = node.attrs.align === 'left' || node.attrs.align === 'right' ? node.attrs.align : 'center'
  const imageId = src ? parseInlineImageSrc(src) : null
  const isStable = imageId !== null && status !== 'error'
  const transactionRemovalError = status === 'removal-error' && typeof node.attrs.error === 'string'
    ? node.attrs.error
    : null
  const isLocalUpload = uploadId.length > 0 && options.localUploadIds?.has(uploadId) === true
  const coordinator = options.inlineImages
  const [removePending, setRemovePending] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const imageRef = useRef<HTMLImageElement | null>(null)
  const frameRef = useRef<HTMLSpanElement | null>(null)
  const sessionRef = useRef<InlineImageResizeSession | null>(null)
  const dragCaptureRef = useRef<{ element: HTMLButtonElement; pointerId: number } | null>(null)
  const [previewWidth, setPreviewWidth] = useState<number | null>(null)
  const [toolbarPlacement, setToolbarPlacement] = useState<'above' | 'below'>('above')
  const [resizeActive, setResizeActive] = useState(false)
  const discardSessionRef = useRef<(session: InlineImageResizeSession | null) => void>(() => undefined)

  // The floating toolbar must stay inside its clipping scroll container; when
  // the frame starts too close to the scrollport top it flips below the frame.
  useEffect(() => {
    if (!selected) return undefined
    const update = () => {
      const frame = frameRef.current
      if (!frame) return
      const clipper = inlineImageClipContainer(frame)
      const frameTop = frame.getBoundingClientRect().top
      const limitTop = clipper ? clipper.getBoundingClientRect().top : 0
      setToolbarPlacement(frameTop - limitTop < INLINE_IMAGE_TOOLBAR_CLEARANCE ? 'below' : 'above')
    }
    update()
    window.addEventListener('scroll', update, { capture: true, passive: true })
    window.addEventListener('resize', update, { passive: true })
    return () => {
      window.removeEventListener('scroll', update, { capture: true } as AddEventListenerOptions)
      window.removeEventListener('resize', update)
    }
  }, [selected])

  // Escape during a pointer-captured drag is intercepted on the window capture
  // phase: the handle never receives focus (pointer-down preventDefault), and
  // stopping the event keeps the surrounding dialog from dismissing.
  useEffect(() => {
    if (!resizeActive) return undefined
    return attachInlineImageResizeEscapeGuard(
      window,
      () => discardSessionRef.current(sessionRef.current),
    )
  }, [resizeActive])

  const displayWidth = typeof node.attrs.displayWidth === 'number' ? node.attrs.displayWidth : null
  const renderedWidth = previewWidth ?? displayWidth

  const measuredEditorWidth = () => {
    const domWidth = (editor.view.dom as HTMLElement).clientWidth
    if (domWidth > 0) return domWidth
    const frameWidth = frameRef.current?.getBoundingClientRect().width ?? 0
    return frameWidth > 0 ? frameWidth : INLINE_IMAGE_MAX_DISPLAY_WIDTH
  }

  /** The width a fresh resize session starts from. */
  const currentWidth = () => {
    if (renderedWidth !== null) return renderedWidth
    if (typeof node.attrs.naturalWidth === 'number') return node.attrs.naturalWidth
    const measured = imageRef.current?.getBoundingClientRect().width ?? 0
    return measured > 0 ? measured : INLINE_IMAGE_MIN_DISPLAY_WIDTH
  }

  const startResizeSession = (edge: InlineImageResizeEdge, startPointerX: number) => (
    createInlineImageResizeSession({
      edge,
      startPointerX,
      startWidth: currentWidth(),
      editorWidth: measuredEditorWidth(),
      onPreview: setPreviewWidth,
      onCommit: (width) => {
        setPreviewWidth(null)
        updateSelectedAttributes({ displayWidth: width })
      },
    })
  )

  /** Cancels a drag: cancel's restore preview must not outlive the clear. */
  const discardSession = (session: InlineImageResizeSession | null) => {
    sessionRef.current = null
    discardInlineImageResizeSession(session, () => setPreviewWidth(null))
    const capture = dragCaptureRef.current
    dragCaptureRef.current = null
    if (capture && capture.element.hasPointerCapture(capture.pointerId)) {
      capture.element.releasePointerCapture(capture.pointerId)
    }
    setResizeActive(false)
  }
  discardSessionRef.current = discardSession

  const onHandlePointerDown = (
    edge: InlineImageResizeEdge,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!editor.isEditable || event.button !== 0 || sessionRef.current) return
    event.preventDefault()
    event.stopPropagation()
    sessionRef.current = startResizeSession(edge, event.clientX)
    dragCaptureRef.current = { element: event.currentTarget, pointerId: event.pointerId }
    setResizeActive(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current
    if (!session) return
    event.preventDefault()
    event.stopPropagation()
    session.preview(event.clientX)
  }

  const onHandlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current
    if (!session) return
    sessionRef.current = null
    dragCaptureRef.current = null
    setResizeActive(false)
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    session.commit()
  }

  const onHandlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!sessionRef.current) return
    discardSession(sessionRef.current)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!editor.isEditable) return
    if (event.key === 'Escape') {
      discardSession(sessionRef.current)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return
    event.preventDefault()
    event.stopPropagation()
    if (sessionRef.current) return

    // One keyboard action is one short-lived session with a single commit.
    const session = startResizeSession('right', 0)
    session.keyboard(event.key, event.shiftKey)
    session.commit()
  }

  const onHandleDoubleClick = () => {
    if (!editor.isEditable) return
    sessionRef.current = null
    setPreviewWidth(null)
    updateSelectedAttributes({ displayWidth: null })
  }

  const retry = () => {
    if (!uploadId || !coordinator || !options.fileByUploadId) return
    const file = options.fileByUploadId.get(uploadId)
    if (!file) return

    updateAttributes({ status: 'uploading', progress: 0, error: null })
    void coordinator
      .upload(uploadId, file, (progress) => {
        updateAttributes({ status: 'uploading', progress })
      })
      .then((upload) => {
        updateAttributes({
          uploadId,
          ...inlineImageUploadSuccessAttributes(upload, alt, align),
        })
      })
      .catch((error: unknown) => {
        updateAttributes({ status: 'error', progress: 0, error: uploadError(error) })
      })
  }

  const remove = async () => {
    if (removePending) return
    setRemoveError(null)

    setRemovePending(true)
    try {
      await removeInlineImageNode({
        uploadId,
        imageId: imageId ?? undefined,
        isLocalUpload,
        coordinator,
        fileByUploadId: options.fileByUploadId,
        insertionPositionByUploadId: options.insertionPositionByUploadId,
        localUploadIds: options.localUploadIds,
        removedUploadIds: options.removedUploadIds,
        deleteNode,
      })
    } catch (error: unknown) {
      setRemoveError(`Unable to remove image: ${uploadError(error)}`)
      setRemovePending(false)
    }
  }

  /** Attr updates from the selected chrome keep the node selected. */
  const updateSelectedAttributes = (attributes: Record<string, unknown>) => {
    const position = typeof getPos === 'function' ? getPos() : null
    if (typeof position !== 'number' || !Number.isFinite(position)) {
      updateAttributes(attributes)
      return
    }
    applyInlineImageAttributes(editor, position, attributes)
  }

  return (
    <NodeViewWrapper
      as="span"
      data-inline-image-node="true"
      data-align={align}
      className="inline-block max-w-full align-middle"
    >
      {isStable ? (
        <span
          ref={frameRef}
          data-align={align}
          data-selected={selected ? 'true' : undefined}
          className="inline-image-node-frame"
        >
          <img
            ref={imageRef}
            src={src}
            alt={alt}
            data-align={align}
            data-width={renderedWidth !== null ? String(renderedWidth) : undefined}
            width={renderedWidth ?? undefined}
            draggable={false}
            className="block h-auto max-w-full"
          />
          {selected && (
            <>
              <InlineImageToolbar
                alt={alt}
                align={align}
                editable={editor.isEditable}
                removePending={removePending}
                placement={toolbarPlacement}
                onAltChange={(value) => updateSelectedAttributes({ alt: value.slice(0, MAX_INLINE_ALT_LENGTH) })}
                onAlignChange={(nextAlign) => updateSelectedAttributes({ align: nextAlign })}
                onCrop={() => undefined}
                onResetSize={() => updateSelectedAttributes({ displayWidth: null })}
                onRemove={remove}
              />
              <InlineImageResizeHandles
                disabled={!editor.isEditable}
                onPointerDown={onHandlePointerDown}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerCancel}
                onKeyDown={onHandleKeyDown}
                onDoubleClick={onHandleDoubleClick}
              />
            </>
          )}
        </span>
      ) : (
        <span
          role={status === 'error' ? 'alert' : 'status'}
          aria-busy={status === 'uploading'}
          className="inline-flex min-h-16 min-w-40 max-w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600"
        >
          {status === 'error' ? (
            <span>{typeof node.attrs.error === 'string' ? node.attrs.error : 'Image upload failed'}</span>
          ) : (
            <>
              <span>Uploading image…</span>
              <progress
                value={Math.max(0, Math.min(100, Number(node.attrs.progress) || 0))}
                max={100}
                aria-label="Image upload progress"
                className="w-full"
              />
            </>
          )}
          {removeError && <span role="alert">{removeError}</span>}
          {status === 'error' && (
            <span className="flex gap-2" contentEditable={false}>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={retry}
                disabled={!editor.isEditable || removePending}
                className="rounded border border-slate-300 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
              >
                Retry
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={remove}
                disabled={!editor.isEditable || removePending}
                className="rounded border border-slate-300 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
              >
                {removePending ? 'Removing…' : 'Remove'}
              </button>
            </span>
          )}
        </span>
      )}

      {isStable && (transactionRemovalError || removeError) && (
        <span
          role="alert"
          className="mt-1 block max-w-full text-sm text-red-700"
        >
          {transactionRemovalError ?? removeError}
        </span>
      )}
    </NodeViewWrapper>
  )
}

export default InlineImageNodeView
