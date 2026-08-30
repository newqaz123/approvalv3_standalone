import {
  INLINE_IMAGE_CROP_SCALE,
  parseInlineImagePresentation,
  pixelRectToNormalizedInlineImageCrop,
  serializeInlineImagePresentation,
  type InlineImagePresentation,
  type NormalizedInlineImageCrop,
} from '@/lib/inline-images/presentation'

export type InlineImageCropPreset = 'free' | 'original' | '1:1' | '4:3' | '16:9'

export type InlineImageCropDraft = {
  crop: NormalizedInlineImageCrop
  zoom: number
  panX: number
  panY: number
  preset: InlineImageCropPreset
}

export type InlineImageCropEdge =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export type InlineImageCropArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

/** Smallest selectable crop, 1% of the source on each axis. */
export const INLINE_IMAGE_MIN_CROP_EXTENT = 100
export const INLINE_IMAGE_CROP_MIN_ZOOM = 1
export const INLINE_IMAGE_CROP_MAX_ZOOM = 4
/** One wheel notch of zoom change, applied through the wheel normalizer. */
export const INLINE_IMAGE_CROP_ZOOM_STEP = 0.25
/** One arrow-key step in normalized units; Shift uses the large step. */
export const INLINE_IMAGE_CROP_KEYBOARD_STEP = 10
export const INLINE_IMAGE_CROP_KEYBOARD_LARGE_STEP = 100

const PRESET_ASPECT_RATIOS: Readonly<Record<'1:1' | '4:3' | '16:9', number>> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

/** The single bounds + minimum-extent authority for every draft update. */
function clampCrop(crop: NormalizedInlineImageCrop): NormalizedInlineImageCrop {
  const width = clampInteger(crop.width, INLINE_IMAGE_MIN_CROP_EXTENT, INLINE_IMAGE_CROP_SCALE)
  const height = clampInteger(crop.height, INLINE_IMAGE_MIN_CROP_EXTENT, INLINE_IMAGE_CROP_SCALE)
  return {
    x: clampInteger(crop.x, 0, INLINE_IMAGE_CROP_SCALE - width),
    y: clampInteger(crop.y, 0, INLINE_IMAGE_CROP_SCALE - height),
    width,
    height,
  }
}

function isFullCrop(crop: NormalizedInlineImageCrop): boolean {
  return crop.x === 0
    && crop.y === 0
    && crop.width === INLINE_IMAGE_CROP_SCALE
    && crop.height === INLINE_IMAGE_CROP_SCALE
}

function hasNaturalDimensions(naturalWidth: number, naturalHeight: number): boolean {
  return Number.isFinite(naturalWidth)
    && Number.isFinite(naturalHeight)
    && naturalWidth > 0
    && naturalHeight > 0
}

export function clampInlineImageCropZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return INLINE_IMAGE_CROP_MIN_ZOOM
  return Math.min(
    INLINE_IMAGE_CROP_MAX_ZOOM,
    Math.max(INLINE_IMAGE_CROP_MIN_ZOOM, Math.round(zoom * 100) / 100),
  )
}

/** Seeds a draft from the node's parsed presentation: full image or stored crop. */
export function createInlineImageCropDraft(
  presentation: InlineImagePresentation,
): InlineImageCropDraft {
  const crop = presentation.crop ?? {
    x: 0,
    y: 0,
    width: INLINE_IMAGE_CROP_SCALE,
    height: INLINE_IMAGE_CROP_SCALE,
  }
  return {
    crop: clampCrop(crop),
    zoom: 1,
    panX: 0,
    panY: 0,
    preset: isFullCrop(crop) ? 'original' : 'free',
  }
}

/**
 * Applies one preset. `original` selects the full source; aspect presets pick
 * the largest physically-correct rectangle that fits the source, centered on
 * the current crop center. Invalid natural dimensions fall back to the full
 * original geometry.
 */
export function applyInlineImageCropPreset(
  draft: InlineImageCropDraft,
  preset: InlineImageCropPreset,
  naturalWidth: number,
  naturalHeight: number,
): InlineImageCropDraft {
  if (preset === 'free') return { ...draft, preset }

  if (preset === 'original' || !hasNaturalDimensions(naturalWidth, naturalHeight)) {
    return {
      crop: { x: 0, y: 0, width: INLINE_IMAGE_CROP_SCALE, height: INLINE_IMAGE_CROP_SCALE },
      zoom: 1,
      panX: 0,
      panY: 0,
      preset: 'original',
    }
  }

  const ratio = PRESET_ASPECT_RATIOS[preset]
  const width = Math.min(
    INLINE_IMAGE_CROP_SCALE,
    INLINE_IMAGE_CROP_SCALE * ratio * naturalHeight / naturalWidth,
  )
  const height = Math.min(
    INLINE_IMAGE_CROP_SCALE,
    INLINE_IMAGE_CROP_SCALE * naturalWidth / (ratio * naturalHeight),
  )
  const centerX = draft.crop.x + draft.crop.width / 2
  const centerY = draft.crop.y + draft.crop.height / 2

  return {
    ...draft,
    crop: clampCrop({
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    }),
    zoom: 1,
    panX: 0,
    panY: 0,
    preset,
  }
}

/**
 * Pans the image beneath the crop rectangle: the rectangle moves opposite the
 * drag in normalized source units and stays inside the source.
 */
export function panInlineImageCrop(
  draft: InlineImageCropDraft,
  dx: number,
  dy: number,
): InlineImageCropDraft {
  return {
    ...draft,
    crop: clampCrop({ ...draft.crop, x: draft.crop.x - dx, y: draft.crop.y - dy }),
    panX: clampInteger(draft.panX + dx, -INLINE_IMAGE_CROP_SCALE, INLINE_IMAGE_CROP_SCALE),
    panY: clampInteger(draft.panY + dy, -INLINE_IMAGE_CROP_SCALE, INLINE_IMAGE_CROP_SCALE),
  }
}

/** Zooms the image beneath the rectangle: the crop scales about its center. */
export function zoomInlineImageCrop(
  draft: InlineImageCropDraft,
  zoom: number,
): InlineImageCropDraft {
  const nextZoom = clampInlineImageCropZoom(zoom)
  const factor = draft.zoom / nextZoom
  const width = draft.crop.width * factor
  const height = draft.crop.height * factor
  const centerX = draft.crop.x + draft.crop.width / 2
  const centerY = draft.crop.y + draft.crop.height / 2

  return {
    ...draft,
    crop: clampCrop({
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    }),
    zoom: nextZoom,
  }
}

/** Moves one edge or corner; every other edge stays fixed. */
export function resizeInlineImageCropEdge(
  draft: InlineImageCropDraft,
  edge: InlineImageCropEdge,
  dx: number,
  dy: number,
): InlineImageCropDraft {
  const crop = clampCrop(draft.crop)
  const safeDx = Number.isFinite(dx) ? dx : 0
  const safeDy = Number.isFinite(dy) ? dy : 0
  const right = crop.x + crop.width
  const bottom = crop.y + crop.height

  if (edge === 'left' || edge === 'top-left' || edge === 'bottom-left') {
    const left = clampInteger(crop.x + safeDx, 0, right - INLINE_IMAGE_MIN_CROP_EXTENT)
    crop.x = left
    crop.width = right - left
  }
  if (edge === 'right' || edge === 'top-right' || edge === 'bottom-right') {
    const nextRight = clampInteger(right + safeDx, crop.x + INLINE_IMAGE_MIN_CROP_EXTENT, INLINE_IMAGE_CROP_SCALE)
    crop.width = nextRight - crop.x
  }
  if (edge === 'top' || edge === 'top-left' || edge === 'top-right') {
    const top = clampInteger(crop.y + safeDy, 0, bottom - INLINE_IMAGE_MIN_CROP_EXTENT)
    crop.y = top
    crop.height = bottom - top
  }
  if (edge === 'bottom' || edge === 'bottom-left' || edge === 'bottom-right') {
    const nextBottom = clampInteger(bottom + safeDy, crop.y + INLINE_IMAGE_MIN_CROP_EXTENT, INLINE_IMAGE_CROP_SCALE)
    crop.height = nextBottom - crop.y
  }

  return {
    ...draft,
    crop,
    preset: 'free',
  }
}

function arrowDelta(key: InlineImageCropArrowKey, shiftKey: boolean): { dx: number; dy: number } {
  const step = shiftKey ? INLINE_IMAGE_CROP_KEYBOARD_LARGE_STEP : INLINE_IMAGE_CROP_KEYBOARD_STEP
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
  return { dx, dy }
}

/** Keyboard resize for a focused handle: arrows move that edge one step. */
export function stepInlineImageCropEdge(
  draft: InlineImageCropDraft,
  edge: InlineImageCropEdge,
  key: InlineImageCropArrowKey,
  shiftKey: boolean,
): InlineImageCropDraft {
  const { dx, dy } = arrowDelta(key, shiftKey)
  return resizeInlineImageCropEdge(draft, edge, dx, dy)
}

/** Keyboard move for the focused crop region: arrows move the whole rectangle. */
export function stepInlineImageCropRegion(
  draft: InlineImageCropDraft,
  key: InlineImageCropArrowKey,
  shiftKey: boolean,
): InlineImageCropDraft {
  const { dx, dy } = arrowDelta(key, shiftKey)
  return panInlineImageCrop(draft, -dx, -dy)
}

/** One wheel notch per event: scrolling up zooms in, clamped to the range. */
export function normalizeInlineImageCropWheelZoom(zoom: number, deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampInlineImageCropZoom(zoom)
  const direction = deltaY > 0 ? -1 : 1
  return clampInlineImageCropZoom(zoom + direction * INLINE_IMAGE_CROP_ZOOM_STEP)
}

/** Pinch scale multiplies the current zoom, clamped to the range. */
export function normalizeInlineImageCropPinchZoom(zoom: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return clampInlineImageCropZoom(zoom)
  return clampInlineImageCropZoom(zoom * scale)
}

/**
 * Converts display-pixel drag deltas into normalized source units through the
 * shared Task 1 pixel-to-normalized converter, so pixel math lives in exactly
 * one place. Invalid measurements produce zero deltas.
 */
export function inlineImageCropDisplayDelta(input: {
  dxPixels: number
  dyPixels: number
  displayedWidth: number
  displayedHeight: number
  naturalWidth: number
  naturalHeight: number
}): { dx: number; dy: number } {
  const positive = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0)
  const displayedWidth = positive(input.displayedWidth)
  const displayedHeight = positive(input.displayedHeight)
  const naturalWidth = positive(input.naturalWidth)
  const naturalHeight = positive(input.naturalHeight)
  if (!displayedWidth || !displayedHeight || !naturalWidth || !naturalHeight) {
    return { dx: 0, dy: 0 }
  }

  const xSource = input.dxPixels * naturalWidth / displayedWidth
  const ySource = input.dyPixels * naturalHeight / displayedHeight
  const xMagnitude = pixelRectToNormalizedInlineImageCrop({
    x: 0,
    y: 0,
    width: Math.abs(xSource),
    height: naturalHeight,
    naturalWidth,
    naturalHeight,
  })?.width ?? 0
  const yMagnitude = pixelRectToNormalizedInlineImageCrop({
    x: 0,
    y: 0,
    width: naturalWidth,
    height: Math.abs(ySource),
    naturalWidth,
    naturalHeight,
  })?.height ?? 0

  return {
    dx: Math.sign(xSource) * xMagnitude,
    dy: Math.sign(ySource) * yMagnitude,
  }
}

/**
 * Flat node attrs for one Apply commit. Values pass through the Task 1
 * serializer/parser pair so only contract-valid presentation commits, and a
 * full-image crop stores no crop attributes (Reset-crop semantics: natural
 * dimensions and display width are kept).
 */
export function inlineImageCropApplyAttributes(input: {
  draft: InlineImageCropDraft
  displayWidth: number | null
  naturalWidth: number
  naturalHeight: number
}): {
  displayWidth: number | null
  naturalWidth: number | null
  naturalHeight: number | null
  cropX: number | null
  cropY: number | null
  cropWidth: number | null
  cropHeight: number | null
} {
  const validated = parseInlineImagePresentation(serializeInlineImagePresentation({
    displayWidth: input.displayWidth,
    naturalWidth: input.naturalWidth,
    naturalHeight: input.naturalHeight,
    crop: isFullCrop(input.draft.crop) ? null : input.draft.crop,
    layout: 'block',
    rotation: 0,
  }))

  return {
    displayWidth: validated.displayWidth,
    naturalWidth: validated.naturalWidth,
    naturalHeight: validated.naturalHeight,
    cropX: validated.crop?.x ?? null,
    cropY: validated.crop?.y ?? null,
    cropWidth: validated.crop?.width ?? null,
    cropHeight: validated.crop?.height ?? null,
  }
}
