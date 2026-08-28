import sanitizeHtml from 'sanitize-html'
import {
  computeInlineImageFrameGeometry,
  parseInlineImagePresentation,
} from '@/lib/inline-images/presentation'
import { inlineImageAltPlaceholder } from '@/lib/inline-images/policy'
import { materializeRichTextPalette } from '@/lib/rich-text-palette'
import {
  RICH_TEXT_ALLOWED_TAGS,
  sanitizeRichText,
} from '@/lib/rich-text-sanitizer'

const SANITIZED_IMAGE_RE = /<img\b[^>]*>/gi
const SANITIZED_ATTRIBUTE_RE = /(?:^|\s)([a-z][a-z0-9-]*)="([^"]*)"/gi

function sanitizedImageAttributes(imageHtml: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of imageHtml.matchAll(SANITIZED_ATTRIBUTE_RE)) {
    attributes[match[1]!] = match[2]!
  }
  return attributes
}

function serializeGeometryNumber(value: number): string {
  return String(value)
}

function materializeCroppedImages(sanitized: string): string {
  return sanitized.replace(SANITIZED_IMAGE_RE, (imageHtml) => {
    const attributes = sanitizedImageAttributes(imageHtml)
    const presentation = parseInlineImagePresentation(attributes)
    if (
      presentation.crop === null
      || presentation.naturalWidth === null
      || presentation.naturalHeight === null
    ) {
      return imageHtml
    }

    const geometry = computeInlineImageFrameGeometry({
      crop: presentation.crop,
      naturalWidth: presentation.naturalWidth,
      naturalHeight: presentation.naturalHeight,
      displayWidth: presentation.displayWidth,
    })
    if (geometry === null) return imageHtml

    const frameStyle = [
      `width:${serializeGeometryNumber(geometry.frameWidth)}px`,
      `aspect-ratio:${serializeGeometryNumber(geometry.aspectRatio)}`,
    ].join(';')
    const imageStyle = [
      `width:${serializeGeometryNumber(geometry.imageWidthPercent)}%`,
      `height:${serializeGeometryNumber(geometry.imageHeightPercent)}%`,
      `left:${serializeGeometryNumber(geometry.imageOffsetXPercent)}%`,
      `top:${serializeGeometryNumber(geometry.imageOffsetYPercent)}%`,
    ].join(';')

    return `<span class="rich-text__image-frame" data-align="${attributes['data-align']}" style="${frameStyle}"><img src="${attributes.src}" alt="${attributes.alt}" style="${imageStyle}" /></span>`
  })
}

/** Trusted application-only presentation generated after the storage sanitizer boundary. */
export function materializeRichTextForApp(source: string): string {
  const sanitized = sanitizeRichText(source)
  const palette = materializeRichTextPalette(sanitized, 'app')
  return materializeCroppedImages(palette)
}

/**
 * Truncates text by Unicode code points in a second parser pass. Returning an
 * empty string after the budget lets sanitize-html balance all retained tags.
 */
export function truncateSanitizedRichTextHtml(
  source: string,
  maxVisibleCharacters: number,
): string {
  const sanitized = sanitizeRichText(source)
  const budget = Number.isFinite(maxVisibleCharacters)
    ? Math.max(0, Math.floor(maxVisibleCharacters))
    : 0
  let remaining = budget

  return sanitizeHtml(sanitized, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: false,
    textFilter: (text) => {
      if (remaining <= 0) return ''
      const codePoints = Array.from(text)
      if (codePoints.length <= remaining) {
        remaining -= codePoints.length
        return text
      }
      const retained = codePoints.slice(0, remaining).join('')
      remaining = 0
      return retained
    },
  })
}

/** Trusted HTML-email presentation with URL-free inline-image placeholders. */
export function materializeRichTextForEmail(
  source: string,
  maxVisibleCharacters?: number,
): string {
  const sanitized = sanitizeRichText(source)
  const withoutImages = inlineImageAltPlaceholder(sanitized)
  const truncated = maxVisibleCharacters === undefined
    ? withoutImages
    : truncateSanitizedRichTextHtml(withoutImages, maxVisibleCharacters)
  return materializeRichTextPalette(truncated, 'email')
}
