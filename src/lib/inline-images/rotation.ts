export const INLINE_IMAGE_ROTATIONS = [0, 90, 180, 270] as const
export type InlineImageRotation = (typeof INLINE_IMAGE_ROTATIONS)[number]

type NormalizedCrop = {
  x: number
  y: number
  width: number
  height: number
}

/** Must stay equal to INLINE_IMAGE_CROP_SCALE in presentation.ts. */
const CROP_SCALE = 10_000

const DECIMAL_ROTATION_RE = /^(?:0|90|180|270)$/

function isInlineImageRotation(value: number): value is InlineImageRotation {
  return INLINE_IMAGE_ROTATIONS.includes(value as InlineImageRotation)
}

/** Parses only the four allowlisted quarter turns; anything else is 0°. */
export function normalizeInlineImageRotation(value: unknown): InlineImageRotation {
  if (typeof value === 'number' && Number.isInteger(value) && isInlineImageRotation(value)) {
    return value
  }
  if (typeof value === 'string' && DECIMAL_ROTATION_RE.test(value)) {
    return Number(value) as InlineImageRotation
  }
  return 0
}

export function rotateInlineImage(
  rotation: InlineImageRotation,
  direction: 'left' | 'right',
): InlineImageRotation {
  const delta = direction === 'left' ? -90 : 90
  return (((rotation + delta) % 360) + 360) % 360 as InlineImageRotation
}

function inverseRotation(rotation: InlineImageRotation): InlineImageRotation {
  if (rotation === 90) return 270
  if (rotation === 270) return 90
  return rotation
}

export function rotatedInlineImageDimensions(
  width: number,
  height: number,
  rotation: InlineImageRotation,
): { width: number; height: number } {
  if (rotation === 90 || rotation === 270) return { width: height, height: width }
  return { width, height }
}

export function canonicalCropToVisualCrop(
  crop: NormalizedCrop,
  rotation: InlineImageRotation,
): NormalizedCrop {
  const s = CROP_SCALE
  if (rotation === 90) {
    return { x: s - crop.y - crop.height, y: crop.x, width: crop.height, height: crop.width }
  }
  if (rotation === 180) {
    return {
      x: s - crop.x - crop.width,
      y: s - crop.y - crop.height,
      width: crop.width,
      height: crop.height,
    }
  }
  if (rotation === 270) {
    return { x: crop.y, y: s - crop.x - crop.width, width: crop.height, height: crop.width }
  }
  return { ...crop }
}

export function visualCropToCanonicalCrop(
  crop: NormalizedCrop,
  rotation: InlineImageRotation,
): NormalizedCrop {
  return canonicalCropToVisualCrop(crop, inverseRotation(rotation))
}
