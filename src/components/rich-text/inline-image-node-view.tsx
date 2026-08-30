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
import type { Ref } from 'react'
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
  InlineImageCropEditor,
  captureInlineImageCropLayoutWidth,
  endInlineImageCropSession,
  focusInlineImageCropButton,
  startInlineImageCropSession,
  type InlineImageCropNodeSession,
} from './inline-image-crop-editor'
import {
  inlineImageNodePresentation,
  inlineImageUploadSuccessAttributes,
  type InlineImageAlignment,
  type InlineImageExtensionOptions,
} from './inline-image-extension'
import type { InlineImageCoordinator } from '@/hooks/use-inline-description-images'
import { parseInlineImageSrc } from '@/lib/inline-images/policy'
import {
  INLINE_IMAGE_CROP_SCALE,
  INLINE_IMAGE_MAX_DISPLAY_WIDTH,
  INLINE_IMAGE_MIN_DISPLAY_WIDTH,
  computeInlineImageFrameGeometry,
  serializeInlineImagePresentation,
  type InlineImageFrameGeometry,
  type InlineImageLayout,
} from '@/lib/inline-images/presentation'
import { rotateInlineImage, type InlineImageRotation } from '@/lib/inline-images/rotation'

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

/** Resolves the visible frame width a new image-resize session should use. */
export function inlineImageResizeStartWidth(input: {
  renderedWidth: number | null
  cropGeometry: InlineImageFrameGeometry | null
  naturalWidth: number | null
  measuredImageWidth: number
}): number {
  if (input.cropGeometry) return input.cropGeometry.frameWidth
  if (input.renderedWidth !== null) return input.renderedWidth
  if (input.naturalWidth !== null) return input.naturalWidth
  return input.measuredImageWidth > 0
    ? input.measuredImageWidth
    : INLINE_IMAGE_MIN_DISPLAY_WIDTH
}

/** Interactive view for one local upload or committed private image. */
export type InlineImageNodeFrameProps = {
  frameRef: Ref<HTMLSpanElement>
  imageRef: Ref<HTMLImageElement>
  src: string
  alt: string
  align: InlineImageAlignment
  layout: InlineImageLayout
  rotation: InlineImageRotation
  selected: boolean
  renderedWidth: number | null
  editable: boolean
  removePending: boolean
  placement: 'above' | 'below'
  /** Serialized presentation data attributes carried by the live editor img. */
  presentationAttributes: Record<string, string>
  /** Trusted Task 1 frame geometry when the node carries a valid crop or rotation. */
  cropGeometry: InlineImageFrameGeometry | null
  crop: {
    session: InlineImageCropNodeSession
    onApply: (attributes: Record<string, unknown>) => void
    onCancel: () => void
  } | null
  cropGuidance: string | null
  onRotateLeft: () => void
  onRotateRight: () => void
  onCrop: () => void
  onResetSize: () => void
  onRemove: () => void
  resizeHandlers: InlineImageResizeHandlesProps
}

/** Frame presenter: crop mode replaces the stable image and its selection chrome. */
function inlineImageRotationSceneStyle(geometry: InlineImageFrameGeometry): React.CSSProperties | undefined {
  if (!(geometry.frameWidth > 0 && geometry.frameHeight > 0) || geometry.rotation === 0) {
    return undefined
  }
  return {
    width: `${geometry.sceneWidth / geometry.frameWidth * 100}%`,
    height: `${geometry.sceneHeight / geometry.frameHeight * 100}%`,
    left: `${geometry.sceneOffsetX / geometry.frameWidth * 100}%`,
    top: `${geometry.sceneOffsetY / geometry.frameHeight * 100}%`,
    transform: `rotate(${geometry.rotation}deg)`,
    transformOrigin: 'center',
  }
}

export function InlineImageNodeFrame({
  frameRef,
  imageRef,
  src,
  alt,
  align,
  layout,
  rotation,
  selected,
  renderedWidth,
  editable,
  removePending,
  placement,
  presentationAttributes,
  cropGeometry,
  crop,
  cropGuidance,
  onRotateLeft,
  onRotateRight,
  onCrop,
  onResetSize,
  onRemove,
  resizeHandlers,
}: InlineImageNodeFrameProps) {
  if (crop) {
    return (
      <span
        ref={frameRef}
        data-align={align}
        data-layout={layout}
        data-crop-active="true"
        className="inline-image-node-frame"
      >
        <InlineImageCropEditor
          src={src}
          alt={alt}
          session={crop.session}
          onApply={crop.onApply}
          onCancel={crop.onCancel}
        />
      </span>
    )
  }

  const rotationStyle = cropGeometry ? inlineImageRotationSceneStyle(cropGeometry) : undefined
  const framedImage = cropGeometry ? (
    <img
      ref={imageRef}
      src={src}
      alt={alt}
      data-align={align}
      draggable={false}
      className="inline-image-crop-frame-image"
      {...presentationAttributes}
      style={{
        position: 'absolute',
        width: `${cropGeometry.imageWidthPercent}%`,
        height: `${cropGeometry.imageHeightPercent}%`,
        left: `${cropGeometry.imageOffsetXPercent}%`,
        top: `${cropGeometry.imageOffsetYPercent}%`,
      }}
    />
  ) : null

  return (
    <span
      ref={frameRef}
      data-align={align}
      data-layout={layout}
      data-selected={selected ? 'true' : undefined}
      className="inline-image-node-frame"
    >
      {cropGeometry && framedImage ? (
        <span
          className="inline-image-crop-frame"
          style={{
            width: `${cropGeometry.frameWidth}px`,
            aspectRatio: String(cropGeometry.aspectRatio),
          }}
        >
          {rotationStyle ? (
            <span className="inline-image-rotation-scene" style={rotationStyle}>
              {framedImage}
            </span>
          ) : framedImage}
        </span>
      ) : (
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          data-align={align}
          width={renderedWidth ?? undefined}
          draggable={false}
          className="block h-auto max-w-full"
          {...presentationAttributes}
          data-width={renderedWidth !== null ? String(renderedWidth) : undefined}
        />
      )}
      {selected && (
        <>
          <InlineImageToolbar
            editable={editable}
            removePending={removePending}
            placement={placement}
            onRotateLeft={onRotateLeft}
            onRotateRight={onRotateRight}
            onCrop={onCrop}
            onResetSize={onResetSize}
            onRemove={onRemove}
          />
          <InlineImageResizeHandles {...resizeHandlers} />
        </>
      )}
      {cropGuidance && (
        <span role="status" className="mt-1 block max-w-full text-sm text-amber-700">
          {cropGuidance}
        </span>
      )}
    </span>
  )
}

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

  const [cropSession, setCropSessionState] = useState<InlineImageCropNodeSession | null>(null)
  const [cropGuidance, setCropGuidance] = useState<string | null>(null)
  const cropSessionRef = useRef<InlineImageCropNodeSession | null>(null)
  const focusCropAfterExitRef = useRef(false)

  const setCropSession = (session: InlineImageCropNodeSession | null) => {
    cropSessionRef.current = session
    setCropSessionState(session)
  }

  /** Focus returns to the Crop button; the flag is consumed after the toolbar
   * has re-rendered, so the button exists regardless of React flush timing. */
  const focusCropButton = () => {
    focusCropAfterExitRef.current = true
  }

  useEffect(() => {
    if (cropSession || !focusCropAfterExitRef.current) return
    focusCropAfterExitRef.current = false
    const frame = frameRef.current
    if (frame) focusInlineImageCropButton(frame)
  }, [cropSession])

  // NodeView teardown ends any still-active crop token (spec 8 lifecycle).
  useEffect(() => (
    () => {
      endInlineImageCropSession({
        session: cropSessionRef.current,
        coordinator,
        cropCommands: options.cropCommands,
      })
    }
  ), [])

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

  // The live editor img carries the serialized presentation data attributes and,
  // when a validated crop exists, renders the same trusted clipped frame the
  // application and PDF paths use (spec 7.2) — never its own crop math.
  const nodePresentation = inlineImageNodePresentation(node.attrs)
  const presentationAttributes = serializeInlineImagePresentation(nodePresentation)
  const layout = nodePresentation.layout
  const rotation = nodePresentation.rotation
  const visibleCrop = nodePresentation.crop
    ?? (rotation !== 0 && nodePresentation.naturalWidth !== null && nodePresentation.naturalHeight !== null
      ? { x: 0, y: 0, width: INLINE_IMAGE_CROP_SCALE, height: INLINE_IMAGE_CROP_SCALE }
      : null)
  const cropGeometry = visibleCrop
    && nodePresentation.naturalWidth !== null
    && nodePresentation.naturalHeight !== null
    ? computeInlineImageFrameGeometry({
      crop: visibleCrop,
      naturalWidth: nodePresentation.naturalWidth,
      naturalHeight: nodePresentation.naturalHeight,
      displayWidth: renderedWidth,
      rotation,
    })
    : null

  const measuredEditorWidth = () => {
    const domWidth = (editor.view.dom as HTMLElement).clientWidth
    if (domWidth > 0) return domWidth
    const frameWidth = frameRef.current?.getBoundingClientRect().width ?? 0
    return frameWidth > 0 ? frameWidth : INLINE_IMAGE_MAX_DISPLAY_WIDTH
  }

  /** The width a fresh resize session starts from. */
  const currentWidth = () => inlineImageResizeStartWidth({
    renderedWidth,
    cropGeometry,
    naturalWidth: typeof node.attrs.naturalWidth === 'number' ? node.attrs.naturalWidth : null,
    measuredImageWidth: imageRef.current?.getBoundingClientRect().width ?? 0,
  })

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
          ...inlineImageUploadSuccessAttributes(upload, alt, align, {
            layout: node.attrs.layout,
            rotation: node.attrs.rotation,
            displayWidth: node.attrs.displayWidth,
          }),
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

  /** Enters crop mode: snapshot the node, resolve dims, begin one edit token. */
  const enterCrop = () => {
    if (!editor.isEditable || cropSessionRef.current) return
    const decoded = imageRef.current
      && imageRef.current.naturalWidth > 0
      && imageRef.current.naturalHeight > 0
      ? { width: imageRef.current.naturalWidth, height: imageRef.current.naturalHeight }
      : null
    const cropFrame = frameRef.current?.querySelector('.inline-image-crop-frame')
    const measuredElement = imageRef.current
      ?? (cropFrame instanceof HTMLElement ? cropFrame : null)
    const measuredWidth = measuredElement?.getBoundingClientRect().width ?? 0
    const started = startInlineImageCropSession({
      src,
      presentation: inlineImageNodePresentation(node.attrs),
      decodedDimensions: decoded,
      coordinator,
      cropCommands: options.cropCommands,
      layoutWidth: captureInlineImageCropLayoutWidth({
        measuredWidth,
        fallbackWidth: currentWidth(),
      }),
    })
    if (!started.ok) {
      setCropGuidance(started.guidance)
      return
    }
    setCropGuidance(null)
    setCropSession(started.session)
  }

  const exitCropSession = () => {
    const session = cropSessionRef.current
    setCropSession(null)
    endInlineImageCropSession({
      session,
      coordinator,
      cropCommands: options.cropCommands,
      focusCropButton: focusCropButton,
    })
  }

  /** Apply: one selection-preserving transaction with the serialized attrs. */
  const applyCropAttributes = (attributes: Record<string, unknown>) => {
    exitCropSession()
    updateSelectedAttributes(attributes)
  }

  return (
    <NodeViewWrapper
      as="span"
      data-inline-image-node="true"
      data-align={align}
      data-layout={layout}
      className="max-w-full"
    >
      {isStable ? (
        <InlineImageNodeFrame
          frameRef={frameRef}
          imageRef={imageRef}
          src={src}
          alt={alt}
          align={align}
          layout={layout}
          rotation={rotation}
          selected={selected}
          renderedWidth={renderedWidth}
          editable={editor.isEditable}
          removePending={removePending}
          placement={toolbarPlacement}
          presentationAttributes={presentationAttributes}
          cropGeometry={cropGeometry}
          crop={cropSession ? {
            session: cropSession,
            onApply: applyCropAttributes,
            onCancel: exitCropSession,
          } : null}
          cropGuidance={cropGuidance}
          onRotateLeft={() => updateSelectedAttributes({
            rotation: rotateInlineImage(rotation, 'left'),
          })}
          onRotateRight={() => updateSelectedAttributes({
            rotation: rotateInlineImage(rotation, 'right'),
          })}
          onCrop={enterCrop}
          onResetSize={() => updateSelectedAttributes({ displayWidth: null })}
          onRemove={remove}
          resizeHandlers={{
            disabled: !editor.isEditable,
            onPointerDown: onHandlePointerDown,
            onPointerMove: onHandlePointerMove,
            onPointerUp: onHandlePointerUp,
            onPointerCancel: onHandlePointerCancel,
            onKeyDown: onHandleKeyDown,
            onDoubleClick: onHandleDoubleClick,
          }}
        />
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
