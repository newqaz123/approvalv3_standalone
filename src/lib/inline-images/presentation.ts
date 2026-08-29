export type NormalizedInlineImageCrop = {
  x: number
  y: number
  width: number
  height: number
}

export type InlineImagePresentation = {
  displayWidth: number | null
  naturalWidth: number | null
  naturalHeight: number | null
  crop: NormalizedInlineImageCrop | null
}

export type InlineImageFrameGeometry = {
  frameWidth: number
  frameHeight: number
  aspectRatio: number
  imageWidthPercent: number
  imageHeightPercent: number
  imageOffsetXPercent: number
  imageOffsetYPercent: number
}

export const INLINE_IMAGE_MIN_DISPLAY_WIDTH = 80
export const INLINE_IMAGE_MAX_DISPLAY_WIDTH = 2048
export const INLINE_IMAGE_CROP_SCALE = 10_000

const INLINE_IMAGE_MAX_NATURAL_DIMENSION = 65_535
const DECIMAL_INTEGER_RE = /^(?:0|[1-9][0-9]*)$/

function parseBoundedInteger(
  value: string | null | undefined,
  minimum: number,
  maximum: number,
): number | null {
  if (typeof value !== 'string' || !DECIMAL_INTEGER_RE.test(value)) return null

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) return null
  if (parsed < minimum || parsed > maximum) return null
  return parsed
}

function isBoundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value)
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
}

function isValidNaturalDimension(value: number): boolean {
  return isBoundedInteger(value, 1, INLINE_IMAGE_MAX_NATURAL_DIMENSION)
}

function isValidCrop(crop: NormalizedInlineImageCrop): boolean {
  return isBoundedInteger(crop.x, 0, INLINE_IMAGE_CROP_SCALE)
    && isBoundedInteger(crop.y, 0, INLINE_IMAGE_CROP_SCALE)
    && isBoundedInteger(crop.width, 1, INLINE_IMAGE_CROP_SCALE)
    && isBoundedInteger(crop.height, 1, INLINE_IMAGE_CROP_SCALE)
    && crop.x + crop.width <= INLINE_IMAGE_CROP_SCALE
    && crop.y + crop.height <= INLINE_IMAGE_CROP_SCALE
}

export function parseInlineImagePresentation(
  attributes: Record<string, string | null | undefined>,
): InlineImagePresentation {
  const displayWidth = parseBoundedInteger(
    attributes['data-width'],
    INLINE_IMAGE_MIN_DISPLAY_WIDTH,
    INLINE_IMAGE_MAX_DISPLAY_WIDTH,
  )

  const parsedNaturalWidth = parseBoundedInteger(
    attributes['data-natural-width'],
    1,
    INLINE_IMAGE_MAX_NATURAL_DIMENSION,
  )
  const parsedNaturalHeight = parseBoundedInteger(
    attributes['data-natural-height'],
    1,
    INLINE_IMAGE_MAX_NATURAL_DIMENSION,
  )
  const hasNaturalDimensions = parsedNaturalWidth !== null && parsedNaturalHeight !== null
  const naturalWidth = hasNaturalDimensions ? parsedNaturalWidth : null
  const naturalHeight = hasNaturalDimensions ? parsedNaturalHeight : null

  let crop: NormalizedInlineImageCrop | null = null
  if (hasNaturalDimensions) {
    const x = parseBoundedInteger(attributes['data-crop-x'], 0, INLINE_IMAGE_CROP_SCALE)
    const y = parseBoundedInteger(attributes['data-crop-y'], 0, INLINE_IMAGE_CROP_SCALE)
    const width = parseBoundedInteger(attributes['data-crop-width'], 1, INLINE_IMAGE_CROP_SCALE)
    const height = parseBoundedInteger(attributes['data-crop-height'], 1, INLINE_IMAGE_CROP_SCALE)

    if (x !== null && y !== null && width !== null && height !== null) {
      const candidate = { x, y, width, height }
      if (isValidCrop(candidate)) crop = candidate
    }
  }

  return { displayWidth, naturalWidth, naturalHeight, crop }
}

export function serializeInlineImagePresentation(
  presentation: InlineImagePresentation,
): Record<string, string> {
  const attributes: Record<string, string> = {}

  if (presentation.displayWidth !== null && isBoundedInteger(
    presentation.displayWidth,
    INLINE_IMAGE_MIN_DISPLAY_WIDTH,
    INLINE_IMAGE_MAX_DISPLAY_WIDTH,
  )) {
    attributes['data-width'] = String(presentation.displayWidth)
  }

  const hasNaturalDimensions = presentation.naturalWidth !== null
    && presentation.naturalHeight !== null
    && isValidNaturalDimension(presentation.naturalWidth)
    && isValidNaturalDimension(presentation.naturalHeight)

  if (hasNaturalDimensions) {
    attributes['data-natural-width'] = String(presentation.naturalWidth)
    attributes['data-natural-height'] = String(presentation.naturalHeight)

    if (presentation.crop !== null && isValidCrop(presentation.crop)) {
      attributes['data-crop-x'] = String(presentation.crop.x)
      attributes['data-crop-y'] = String(presentation.crop.y)
      attributes['data-crop-width'] = String(presentation.crop.width)
      attributes['data-crop-height'] = String(presentation.crop.height)
    }
  }

  return attributes
}

export function sanitizeInlineImagePresentationAttributes(
  attributes: Record<string, string | undefined>,
): Record<string, string> {
  return serializeInlineImagePresentation(parseInlineImagePresentation(attributes))
}

export function clampInlineImageDisplayWidth(width: number, editorWidth: number): number {
  const safeWidth = Number.isFinite(width) ? Math.round(width) : INLINE_IMAGE_MIN_DISPLAY_WIDTH
  const safeEditorWidth = Number.isFinite(editorWidth)
    ? Math.floor(editorWidth)
    : INLINE_IMAGE_MAX_DISPLAY_WIDTH
  const maximum = Math.max(
    INLINE_IMAGE_MIN_DISPLAY_WIDTH,
    Math.min(INLINE_IMAGE_MAX_DISPLAY_WIDTH, safeEditorWidth),
  )
  return Math.min(maximum, Math.max(INLINE_IMAGE_MIN_DISPLAY_WIDTH, safeWidth))
}

export function cropAspectRatio(input: {
  crop: NormalizedInlineImageCrop
  naturalWidth: number
  naturalHeight: number
}): number {
  const physicalWidth = input.crop.width / INLINE_IMAGE_CROP_SCALE * input.naturalWidth
  const physicalHeight = input.crop.height / INLINE_IMAGE_CROP_SCALE * input.naturalHeight
  return physicalWidth / physicalHeight
}

function normalizedEdgesToCrop(input: {
  left: number
  top: number
  right: number
  bottom: number
}): NormalizedInlineImageCrop | null {
  const left = Math.round(input.left)
  const top = Math.round(input.top)
  const right = Math.round(input.right)
  const bottom = Math.round(input.bottom)

  if (right <= left || bottom <= top) return null

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

export function pixelRectToNormalizedInlineImageCrop(input: {
  x: number
  y: number
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
}): NormalizedInlineImageCrop | null {
  const values = [input.x, input.y, input.width, input.height, input.naturalWidth, input.naturalHeight]
  if (!values.every(Number.isFinite)) return null
  if (!isValidNaturalDimension(input.naturalWidth) || !isValidNaturalDimension(input.naturalHeight)) {
    return null
  }
  if (input.width <= 0 || input.height <= 0) return null

  const left = Math.max(0, input.x)
  const top = Math.max(0, input.y)
  const right = Math.min(input.naturalWidth, input.x + input.width)
  const bottom = Math.min(input.naturalHeight, input.y + input.height)
  if (right <= left || bottom <= top) return null

  const crop = normalizedEdgesToCrop({
    left: left / input.naturalWidth * INLINE_IMAGE_CROP_SCALE,
    top: top / input.naturalHeight * INLINE_IMAGE_CROP_SCALE,
    right: right / input.naturalWidth * INLINE_IMAGE_CROP_SCALE,
    bottom: bottom / input.naturalHeight * INLINE_IMAGE_CROP_SCALE,
  })
  return crop !== null && isValidCrop(crop) ? crop : null
}

/** Materialize a validated resize width without creating a crop frame or storing style. */
export function materializeInlineImageDisplayWidth(
  imageHtml: string,
  displayWidth: number | null,
): string {
  if (displayWidth === null || !isBoundedInteger(
    displayWidth,
    INLINE_IMAGE_MIN_DISPLAY_WIDTH,
    INLINE_IMAGE_MAX_DISPLAY_WIDTH,
  )) {
    return imageHtml
  }

  return imageHtml.replace(/(\s*\/?>)$/, (closing) => ` width="${String(displayWidth)}"${closing}`)
}

export function computeInlineImageFrameGeometry(input: {
  crop: NormalizedInlineImageCrop
  naturalWidth: number
  naturalHeight: number
  displayWidth: number | null
}): InlineImageFrameGeometry | null {
  if (!isValidCrop(input.crop)) return null
  if (!isValidNaturalDimension(input.naturalWidth) || !isValidNaturalDimension(input.naturalHeight)) {
    return null
  }
  if (input.displayWidth !== null && !isBoundedInteger(
    input.displayWidth,
    INLINE_IMAGE_MIN_DISPLAY_WIDTH,
    INLINE_IMAGE_MAX_DISPLAY_WIDTH,
  )) {
    return null
  }

  const aspectRatio = cropAspectRatio(input)
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return null

  const physicalCropWidth = input.crop.width / INLINE_IMAGE_CROP_SCALE * input.naturalWidth
  const frameWidth = input.displayWidth ?? physicalCropWidth

  return {
    frameWidth,
    frameHeight: frameWidth / aspectRatio,
    aspectRatio,
    imageWidthPercent: INLINE_IMAGE_CROP_SCALE / input.crop.width * 100,
    imageHeightPercent: INLINE_IMAGE_CROP_SCALE / input.crop.height * 100,
    imageOffsetXPercent: -input.crop.x / input.crop.width * 100,
    imageOffsetYPercent: -input.crop.y / input.crop.height * 100,
  }
}
