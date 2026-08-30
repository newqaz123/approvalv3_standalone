'use client'

import * as React from 'react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  computeInlineImageFrameGeometry,
  INLINE_IMAGE_CROP_SCALE,
  parseInlineImagePresentation,
  serializeInlineImagePresentation,
  type InlineImagePresentation,
} from '@/lib/inline-images/presentation'
import { rotatedInlineImageDimensions } from '@/lib/inline-images/rotation'
import type { InlineImageCoordinator } from '@/hooks/use-inline-description-images'
import type { InlineImageCropCommandsController } from './inline-image-extension'
import {
  applyInlineImageCropPreset,
  createInlineImageCropDraft,
  inlineImageCropApplyAttributes,
  inlineImageCropDisplayDelta,
  normalizeInlineImageCropPinchZoom,
  normalizeInlineImageCropWheelZoom,
  panInlineImageCrop,
  resizeInlineImageCropEdge,
  stepInlineImageCropEdge,
  stepInlineImageCropRegion,
  zoomInlineImageCrop,
  INLINE_IMAGE_CROP_MAX_ZOOM,
  INLINE_IMAGE_CROP_MIN_ZOOM,
  type InlineImageCropArrowKey,
  type InlineImageCropDraft,
  type InlineImageCropEdge,
  type InlineImageCropPreset,
} from './inline-image-crop'
import { attachInlineImageResizeEscapeGuard } from './inline-image-resize'

export const INLINE_IMAGE_CROP_UNAVAILABLE_GUIDANCE = 'Cannot crop this image without its dimensions.'

const CROP_PRESETS: ReadonlyArray<{ preset: InlineImageCropPreset; label: string }> = [
  { preset: 'free', label: 'Free' },
  { preset: 'original', label: 'Original' },
  { preset: '1:1', label: '1:1' },
  { preset: '4:3', label: '4:3' },
  { preset: '16:9', label: '16:9' },
]

const CROP_EDGES: ReadonlyArray<{ edge: InlineImageCropEdge; label: string }> = [
  { edge: 'top', label: 'Move crop top edge' },
  { edge: 'right', label: 'Move crop right edge' },
  { edge: 'bottom', label: 'Move crop bottom edge' },
  { edge: 'left', label: 'Move crop left edge' },
  { edge: 'top-left', label: 'Move crop top-left corner' },
  { edge: 'top-right', label: 'Move crop top-right corner' },
  { edge: 'bottom-left', label: 'Move crop bottom-left corner' },
  { edge: 'bottom-right', label: 'Move crop bottom-right corner' },
]

/** One live crop session on a node: its token, snapshot, and resolved dims. */
export type InlineImageCropNodeSession = {
  editId: string
  snapshot: InlineImagePresentation
  naturalWidth: number
  naturalHeight: number
  /** Guard flag so teardown/cancel/apply can never end the token twice. */
  ended: boolean
  /**
   * Transient pre-switch rendered width for the crop surface only.
   * Never serialized as displayWidth or other stored metadata.
   */
  layoutWidth: number
}

/**
 * Captures the crop surface width from the live box. A finite positive
 * measurement wins; otherwise the existing currentWidth fallback is used.
 */
export function captureInlineImageCropLayoutWidth(input: {
  measuredWidth: number
  fallbackWidth: number
}): number {
  if (Number.isFinite(input.measuredWidth) && input.measuredWidth > 0) {
    return input.measuredWidth
  }
  return input.fallbackWidth
}

/**
 * Visible layout box before crop/recrop: the committed crop frame when the
 * image is the absolutely positioned inner source, otherwise the image itself.
 */
export function inlineImageVisibleCropLayoutElement<T extends {
  closest(selectors: string): T | null
}>(image: T): T {
  return image.closest('.inline-image-crop-frame') ?? image
}

export type InlineImageCropSessionStart =
  | { ok: true; session: InlineImageCropNodeSession }
  | { ok: false; guidance: string }

function positiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null
  // Let Task 1's parser enforce the shared natural-dimension upper bound too.
  const parsed = parseInlineImagePresentation({
    'data-natural-width': String(value),
    'data-natural-height': '1',
  }).naturalWidth
  return parsed === value ? value : null
}

/**
 * Starts one crop session: the snapshot is canonicalized through the Task 1
 * parser, dimensions fall back to the decoded image element (spec 5.2), and a
 * missing pair refuses entry with accessible guidance instead of a token.
 */
export function startInlineImageCropSession(input: {
  src: string
  presentation: InlineImagePresentation
  decodedDimensions: { width: number; height: number } | null
  coordinator?: Pick<InlineImageCoordinator, 'beginImageEdit'>
  cropCommands?: InlineImageCropCommandsController
  /** Transient rendered width captured before switching into crop UI. */
  layoutWidth?: number
}): InlineImageCropSessionStart {
  const snapshot = parseInlineImagePresentation(
    serializeInlineImagePresentation(input.presentation),
  )
  const naturalWidth = snapshot.naturalWidth ?? positiveInteger(input.decodedDimensions?.width)
  const naturalHeight = snapshot.naturalHeight ?? positiveInteger(input.decodedDimensions?.height)
  if (naturalWidth === null || naturalHeight === null) {
    return { ok: false, guidance: INLINE_IMAGE_CROP_UNAVAILABLE_GUIDANCE }
  }

  const session: InlineImageCropNodeSession = {
    editId: `crop:${input.src}:${crypto.randomUUID()}`,
    snapshot,
    naturalWidth,
    naturalHeight,
    ended: false,
    layoutWidth: captureInlineImageCropLayoutWidth({
      measuredWidth: input.layoutWidth ?? 0,
      fallbackWidth: 0,
    }),
  }
  input.coordinator?.beginImageEdit(session.editId)
  input.cropCommands?.begin()
  return { ok: true, session }
}

/** Ends a session exactly once: token, published crop state, and Crop-button focus. */
export function endInlineImageCropSession(input: {
  session: InlineImageCropNodeSession | null
  coordinator?: Pick<InlineImageCoordinator, 'endImageEdit'>
  cropCommands?: InlineImageCropCommandsController
  focusCropButton?: () => void
}): void {
  const session = input.session
  if (!session || session.ended) return
  session.ended = true
  input.coordinator?.endImageEdit(session.editId)
  input.cropCommands?.end()
  input.focusCropButton?.()
}

/** Focuses the toolbar Crop button inside the frame after a session exits. */
export function focusInlineImageCropButton(scope: {
  querySelector: (selector: string) => { focus: () => void } | null
}): boolean {
  const button = scope.querySelector('button[aria-label="Crop image"]')
  if (!button) return false
  button.focus()
  return true
}

export type InlineImageCropEditorProps = {
  src: string
  alt: string
  session: InlineImageCropNodeSession
  onApply: (attributes: Record<string, unknown>) => void
  onCancel: () => void
}

type HandleDrag = {
  kind: 'handle'
  edge: InlineImageCropEdge
  originDraft: InlineImageCropDraft
  originX: number
  originY: number
  pointerId: number
}

type SurfaceDrag = {
  kind: 'surface'
  originDraft: InlineImageCropDraft
  originX: number
  originY: number
  pointerIds: number[]
  pinch: { distance: number; draft: InlineImageCropDraft } | null
}

export type InlineImageCropSurfacePointer = {
  pointerId: number
  x: number
  y: number
}

/** Rebases a remaining one-finger pan on the draft produced by a pinch. */
export function rebaseInlineImageCropSurfaceDrag(input: {
  drag: SurfaceDrag
  draft: InlineImageCropDraft
  remainingPointer: InlineImageCropSurfacePointer
}): SurfaceDrag {
  return {
    ...input.drag,
    originDraft: input.draft,
    originX: input.remainingPointer.x,
    originY: input.remainingPointer.y,
    pointerIds: [input.remainingPointer.pointerId],
    pinch: null,
  }
}

/** In-editor crop UI: dimmed regions, eight handles, pan surface, zoom, presets. */
export function InlineImageCropEditor({
  src,
  alt,
  session,
  onApply,
  onCancel,
}: InlineImageCropEditorProps) {
  const [draft, setDraft] = useState<InlineImageCropDraft>(() => createInlineImageCropDraft(session.snapshot))
  const [status, setStatus] = useState<string>('Crop editor open')
  const draftRef = useRef(draft)
  draftRef.current = draft

  const updateDraft = (next: InlineImageCropDraft) => {
    // Pointer events can deliver pointer-up before React has rendered the
    // preceding pinch update; keep the imperative gesture snapshot current too.
    draftRef.current = next
    setDraft(next)
  }

  const surfaceRef = useRef<HTMLSpanElement | null>(null)
  const regionRef = useRef<HTMLSpanElement | null>(null)
  const handleDragRef = useRef<HandleDrag | null>(null)
  const surfaceDragRef = useRef<SurfaceDrag | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel

  // Focus the crop region on entry so keyboard users land inside the crop UI.
  useEffect(() => {
    regionRef.current?.focus()
    return undefined
  }, [])

  // Escape cancels the crop itself on the window capture phase, stopping the
  // event before the surrounding dialog can dismiss (Task 5 guard pattern).
  useEffect(() => (
    attachInlineImageResizeEscapeGuard(window, () => cancelRef.current())
  ), [])

  // Wheel zoom needs a non-passive native listener to preventDefault scrolling.
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return undefined
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const current = draftRef.current
      updateDraft(zoomInlineImageCrop(
        current,
        normalizeInlineImageCropWheelZoom(current.zoom, event.deltaY),
      ))
    }
    surface.addEventListener('wheel', onWheel, { passive: false })
    return () => surface.removeEventListener('wheel', onWheel)
  }, [])

  const displayedSize = () => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return rect ? { width: rect.width, height: rect.height } : { width: 0, height: 0 }
  }

  const totalDelta = (originX: number, originY: number, clientX: number, clientY: number) => {
    const displayed = displayedSize()
    const visual = rotatedInlineImageDimensions(
      session.naturalWidth,
      session.naturalHeight,
      draftRef.current.rotation,
    )
    return inlineImageCropDisplayDelta({
      dxPixels: clientX - originX,
      dyPixels: clientY - originY,
      displayedWidth: displayed.width,
      displayedHeight: displayed.height,
      naturalWidth: visual.width,
      naturalHeight: visual.height,
    })
  }

  const describeCrop = (next: InlineImageCropDraft) => (
    `Crop ${Math.round(next.crop.width / 100)}% wide, ${Math.round(next.crop.height / 100)}% tall`
    + (next.zoom > 1 ? ` at ${Math.round(next.zoom * 100)}% zoom` : '')
  )

  const onHandlePointerDown = (
    edge: InlineImageCropEdge,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setPointerCaptureSafe(event.currentTarget, event.pointerId)
    handleDragRef.current = {
      kind: 'handle',
      edge,
      originDraft: draftRef.current,
      originX: event.clientX,
      originY: event.clientY,
      pointerId: event.pointerId,
    }
  }

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = handleDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const delta = totalDelta(drag.originX, drag.originY, event.clientX, event.clientY)
    updateDraft(resizeInlineImageCropEdge(drag.originDraft, drag.edge, delta.dx, delta.dy))
  }

  const endHandleDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    restore: boolean,
  ) => {
    const drag = handleDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    handleDragRef.current = null
    releasePointerCaptureSafe(event.currentTarget, event.pointerId)
    if (restore) {
      updateDraft(drag.originDraft)
      return
    }
    setStatus(describeCrop(draftRef.current))
  }

  const onHandleKeyDown = (
    edge: InlineImageCropEdge,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
      return
    }
    if (!isArrowKey(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const next = stepInlineImageCropEdge(draftRef.current, edge, event.key, event.shiftKey)
    updateDraft(next)
    setStatus(describeCrop(next))
  }

  const onRegionPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setPointerCaptureSafe(event.currentTarget, event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    const pointers = [...pointersRef.current.entries()]
    if (pointers.length === 1) {
      surfaceDragRef.current = {
        kind: 'surface',
        originDraft: draftRef.current,
        originX: event.clientX,
        originY: event.clientY,
        pointerIds: [event.pointerId],
        pinch: null,
      }
      return
    }
    if (pointers.length === 2) {
      const [first, second] = pointers.map(([, position]) => position)
      surfaceDragRef.current = {
        kind: 'surface',
        originDraft: draftRef.current,
        originX: first.x,
        originY: first.y,
        pointerIds: pointers.map(([pointerId]) => pointerId),
        pinch: {
          distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
          draft: draftRef.current,
        },
      }
    }
  }

  const onRegionPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = surfaceDragRef.current
    if (!drag || !drag.pointerIds.includes(event.pointerId)) return
    event.preventDefault()
    event.stopPropagation()
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (drag.pinch && pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()]
      const scale = Math.hypot(first.x - second.x, first.y - second.y) / drag.pinch.distance
      updateDraft(zoomInlineImageCrop(
        drag.pinch.draft,
        normalizeInlineImageCropPinchZoom(drag.pinch.draft.zoom, scale),
      ))
      return
    }

    const delta = totalDelta(drag.originX, drag.originY, event.clientX, event.clientY)
    updateDraft(panInlineImageCrop(drag.originDraft, delta.dx, delta.dy))
  }

  const endRegionDrag = (
    event: ReactPointerEvent<HTMLSpanElement>,
    restore: boolean,
  ) => {
    const drag = surfaceDragRef.current
    pointersRef.current.delete(event.pointerId)
    if (!drag || !drag.pointerIds.includes(event.pointerId)) return
    const remaining = [...pointersRef.current.entries()]
    if (remaining.length === 0) {
      surfaceDragRef.current = null
    } else if (remaining.length === 1) {
      const [[pointerId, pointer]] = remaining
      const nextDraft = restore
        ? (drag.pinch ? drag.pinch.draft : drag.originDraft)
        : draftRef.current
      surfaceDragRef.current = rebaseInlineImageCropSurfaceDrag({
        drag,
        draft: nextDraft,
        remainingPointer: { pointerId, x: pointer.x, y: pointer.y },
      })
      if (restore) updateDraft(nextDraft)
    }
    releasePointerCaptureSafe(event.currentTarget, event.pointerId)
    if (restore) {
      if (remaining.length !== 1) updateDraft(drag.pinch ? drag.pinch.draft : drag.originDraft)
      return
    }
    if (remaining.length === 0) setStatus(describeCrop(draftRef.current))
  }

  const onRegionKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
      return
    }
    if (!isArrowKey(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const next = stepInlineImageCropRegion(draftRef.current, event.key, event.shiftKey)
    updateDraft(next)
    setStatus(describeCrop(next))
  }

  const onPresetChange = (preset: InlineImageCropPreset) => {
    const current = draftRef.current
    const visual = rotatedInlineImageDimensions(
      session.naturalWidth,
      session.naturalHeight,
      current.rotation,
    )
    const next = applyInlineImageCropPreset(
      current,
      preset,
      visual.width,
      visual.height,
    )
    updateDraft(next)
    setStatus(preset === 'original' ? 'Crop reset to the full original image' : describeCrop(next))
  }

  const onZoomChange = (zoom: number) => {
    updateDraft(zoomInlineImageCrop(draftRef.current, zoom))
  }

  const onApplyCrop = () => {
    onApply(inlineImageCropApplyAttributes({
      draft: draftRef.current,
      displayWidth: session.snapshot.displayWidth,
      naturalWidth: session.naturalWidth,
      naturalHeight: session.naturalHeight,
    }))
  }

  const stopSurfaceEvents = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
  }

  return (
    <span className="inline-image-crop" contentEditable={false} data-inline-image-crop="true">
      <span
        className="inline-image-crop-controls"
        role="group"
        aria-label="Crop controls"
        onMouseDown={stopSurfaceEvents}
      >
        {CROP_PRESETS.map(({ preset, label }) => (
          <button
            key={preset}
            type="button"
            aria-label={`Crop aspect ${preset}`}
            aria-pressed={draft.preset === preset}
            data-preset={preset}
            onClick={() => onPresetChange(preset)}
            className="inline-image-crop-button"
          >
            {label}
          </button>
        ))}
        <span className="inline-image-toolbar-divider" aria-hidden="true" />
        <label className="inline-image-crop-zoom">
          <span aria-hidden="true">Zoom</span>
          <input
            type="range"
            aria-label="Image zoom"
            min={INLINE_IMAGE_CROP_MIN_ZOOM}
            max={INLINE_IMAGE_CROP_MAX_ZOOM}
            step={0.05}
            value={draft.zoom}
            onChange={(event) => onZoomChange(Number(event.currentTarget.value))}
          />
        </label>
        <span className="inline-image-toolbar-divider" aria-hidden="true" />
        <button type="button" aria-label="Cancel crop" onClick={onCancel} className="inline-image-crop-button">
          Cancel
        </button>
        <button
          type="button"
          aria-label="Reset crop"
          onClick={() => onPresetChange('original')}
          className="inline-image-crop-button"
        >
          Reset
        </button>
        <button
          type="button"
          aria-label="Apply crop"
          onClick={onApplyCrop}
          className="inline-image-crop-button inline-image-crop-button--apply"
        >
          Apply
        </button>
      </span>
      <span
        className="inline-image-crop-surface"
        ref={surfaceRef}
        style={cropSurfaceStyle(session, draft)}
      >
        {rotatedCropSource(src, alt, session, draft)}

        <span
          ref={regionRef}
          className="inline-image-crop-rect"
          role="group"
          tabIndex={0}
          aria-label="Crop region"
          style={{
            left: `${draft.crop.x / 100}%`,
            top: `${draft.crop.y / 100}%`,
            width: `${draft.crop.width / 100}%`,
            height: `${draft.crop.height / 100}%`,
          }}
          onPointerDown={onRegionPointerDown}
          onPointerMove={onRegionPointerMove}
          onPointerUp={(event) => endRegionDrag(event, false)}
          onPointerCancel={(event) => endRegionDrag(event, true)}
          onKeyDown={onRegionKeyDown}
        >
          {CROP_EDGES.map(({ edge, label }) => (
            <button
              key={edge}
              type="button"
              aria-label={label}
              className={`inline-image-crop-handle inline-image-crop-handle--${edge}`}
              onPointerDown={(event) => onHandlePointerDown(edge, event)}
              onPointerMove={onHandlePointerMove}
              onPointerUp={(event) => endHandleDrag(event, false)}
              onPointerCancel={(event) => endHandleDrag(event, true)}
              onKeyDown={(event) => onHandleKeyDown(edge, event)}
            />
          ))}
        </span>
      </span>
      <span role="status" aria-live="polite" className="inline-image-crop-status">
        {status}
      </span>
    </span>
  )
}

function cropDisplayWidth(session: InlineImageCropNodeSession): number | null {
  if (session.layoutWidth > 0) return Math.round(session.layoutWidth)
  return session.snapshot.displayWidth
}

function cropSceneGeometry(
  session: InlineImageCropNodeSession,
  draft: InlineImageCropDraft,
) {
  return computeInlineImageFrameGeometry({
    crop: {
      x: 0,
      y: 0,
      width: INLINE_IMAGE_CROP_SCALE,
      height: INLINE_IMAGE_CROP_SCALE,
    },
    naturalWidth: session.naturalWidth,
    naturalHeight: session.naturalHeight,
    displayWidth: cropDisplayWidth(session),
    rotation: draft.rotation,
  })
}

function cropSurfaceStyle(
  session: InlineImageCropNodeSession,
  draft: InlineImageCropDraft,
): React.CSSProperties | undefined {
  const geometry = cropSceneGeometry(session, draft)
  const rotated = Boolean(geometry && geometry.rotation !== 0)
  if (session.layoutWidth <= 0 && !rotated) return undefined
  return {
    width: session.layoutWidth > 0
      ? `${session.layoutWidth}px`
      : geometry
        ? `${geometry.frameWidth}px`
        : undefined,
    maxWidth: '100%',
    aspectRatio: rotated && geometry ? String(geometry.aspectRatio) : undefined,
    position: rotated ? 'relative' : undefined,
    overflow: rotated ? 'hidden' : undefined,
    touchAction: 'none',
    overscrollBehavior: 'contain',
  }
}

function rotatedCropSource(
  src: string,
  alt: string,
  session: InlineImageCropNodeSession,
  draft: InlineImageCropDraft,
) {
  const geometry = cropSceneGeometry(session, draft)
  const image = (
    <img src={src} alt={alt} draggable={false} className="inline-image-crop-source" />
  )
  if (!geometry || geometry.rotation === 0) return image
  if (!(geometry.frameWidth > 0 && geometry.frameHeight > 0)) return image
  return (
    <span
      className="inline-image-rotation-scene"
      style={{
        position: 'absolute',
        width: `${geometry.sceneWidth / geometry.frameWidth * 100}%`,
        height: `${geometry.sceneHeight / geometry.frameHeight * 100}%`,
        left: `${geometry.sceneOffsetX / geometry.frameWidth * 100}%`,
        top: `${geometry.sceneOffsetY / geometry.frameHeight * 100}%`,
        transform: `rotate(${geometry.rotation}deg)`,
        transformOrigin: 'center',
      }}
    >
      {image}
    </span>
  )
}

function isArrowKey(key: string): key is InlineImageCropArrowKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight'
}

function setPointerCaptureSafe(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // Synthetic (automation/test) pointers have no active capture target.
  }
}

function releasePointerCaptureSafe(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    // Capture can already be lost when the pointer ends.
  }
}

export default InlineImageCropEditor
