import sanitizeHtml from 'sanitize-html'
import { decodeHTML, escapeText } from 'entities'
import {
  computeInlineImageFrameGeometry,
  materializeInlineImageDisplayWidth,
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
const PRIVATE_INLINE_IMAGE_URL_RE = /\/api\/inline-images\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi
const IMAGE_DATA_URI_RE = /data:image\/[^\s<\]]+/gi
const EMAIL_IMAGE_REFERENCE_REPLACEMENT = '[redacted]'
const VISIBLE_TEXT_BOUNDARY_TAGS = new Set(['p', 'br', 'ul', 'ol', 'li', 'h2', 'h3'])

type VisibleTextSegment = {
  start: number
  end: number
}

type VisibleTextMatch = {
  start: number
  end: number
}

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
    if (presentation.crop === null) {
      return materializeInlineImageDisplayWidth(imageHtml, presentation.displayWidth)
    }
    if (
      presentation.naturalWidth === null
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
    transformTags: {
      '*': (tagName, attribs) => remaining <= 0
        ? { tagName: '', attribs: {} }
        : { tagName, attribs },
    },
    textFilter: (text) => {
      if (remaining <= 0) return ''
      const codePoints = Array.from(decodeHTML(text))
      if (codePoints.length <= remaining) {
        remaining -= codePoints.length
        return escapeText(codePoints.join(''))
      }
      const retained = codePoints.slice(0, remaining).join('')
      remaining = 0
      return escapeText(retained)
    },
  })
}

function forbiddenVisibleTextMatches(visibleText: string): VisibleTextMatch[] {
  const matches: VisibleTextMatch[] = []
  for (const pattern of [PRIVATE_INLINE_IMAGE_URL_RE, IMAGE_DATA_URI_RE]) {
    pattern.lastIndex = 0
    for (const match of visibleText.matchAll(pattern)) {
      matches.push({ start: match.index, end: match.index + match[0].length })
    }
  }

  matches.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: VisibleTextMatch[] = []
  for (const match of matches) {
    const previous = merged.at(-1)
    if (previous && match.start < previous.end) {
      previous.end = Math.max(previous.end, match.end)
    } else {
      merged.push({ ...match })
    }
  }
  return merged
}

function collectEmailVisibleText(source: string): {
  visibleText: string
  segments: VisibleTextSegment[]
} {
  const parts: string[] = []
  const segments: VisibleTextSegment[] = []
  let cursor = 0
  const appendBoundary = () => {
    parts.push('\n')
    cursor += 1
  }

  sanitizeHtml(source, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: false,
    transformTags: {
      '*': (tagName, attribs) => {
        if (VISIBLE_TEXT_BOUNDARY_TAGS.has(tagName)) appendBoundary()
        return { tagName, attribs }
      },
    },
    textFilter: (text) => {
      const decoded = decodeHTML(text)
      const start = cursor
      parts.push(decoded)
      cursor += decoded.length
      segments.push({ start, end: cursor })
      return text
    },
    exclusiveFilter: (frame) => {
      if (VISIBLE_TEXT_BOUNDARY_TAGS.has(frame.tag)) appendBoundary()
      return false
    },
  })

  return { visibleText: parts.join(''), segments }
}

type RedactionFrame = {
  emitted: boolean
  redacted: boolean
}

function redactVisibleTextSegment(
  decoded: string,
  segment: VisibleTextSegment,
  matches: VisibleTextMatch[],
): { text: string; redacted: boolean } {
  let localCursor = 0
  let redacted = false
  const parts: string[] = []

  for (const match of matches) {
    if (match.end <= segment.start || match.start >= segment.end) continue

    const start = Math.max(0, match.start - segment.start)
    const end = Math.min(decoded.length, match.end - segment.start)
    parts.push(decoded.slice(localCursor, start))
    if (match.start >= segment.start) parts.push(EMAIL_IMAGE_REFERENCE_REPLACEMENT)
    localCursor = end
    redacted = true
  }
  parts.push(decoded.slice(localCursor))
  return { text: parts.join(''), redacted }
}

function redactEmailVisibleImageReferences(source: string): string {
  const { visibleText, segments } = collectEmailVisibleText(source)
  const matches = forbiddenVisibleTextMatches(visibleText)
  if (matches.length === 0) return source

  const frames: RedactionFrame[] = []
  let segmentIndex = 0
  return sanitizeHtml(source, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: false,
    transformTags: {
      '*': (tagName, attribs) => {
        frames.push({ emitted: false, redacted: false })
        return { tagName, attribs }
      },
    },
    textFilter: (text) => {
      const segment = segments[segmentIndex++]
      if (!segment) return ''

      const result = redactVisibleTextSegment(decodeHTML(text), segment, matches)
      for (const frame of frames) {
        if (result.text.length > 0) frame.emitted = true
        if (result.redacted) frame.redacted = true
      }
      return escapeText(result.text)
    },
    exclusiveFilter: (frame) => {
      const state = frames.pop()
      if (
        state?.redacted
        && !state.emitted
        && !VISIBLE_TEXT_BOUNDARY_TAGS.has(frame.tag)
      ) {
        return 'excludeTag'
      }
      return false
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
  const redacted = redactEmailVisibleImageReferences(withoutImages)
  const truncated = maxVisibleCharacters === undefined
    ? redacted
    : truncateSanitizedRichTextHtml(redacted, maxVisibleCharacters)
  return materializeRichTextPalette(truncated, 'email')
}
