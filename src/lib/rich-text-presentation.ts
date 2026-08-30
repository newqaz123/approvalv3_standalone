import sanitizeHtml from 'sanitize-html'
import { decodeHTML, escapeText } from 'entities'
import {
  computeInlineImageFrameGeometry,
  INLINE_IMAGE_CROP_SCALE,
  materializeInlineImageDisplayWidth,
  parseInlineImagePresentation,
  type InlineImageFrameGeometry,
  type InlineImagePresentation,
} from '@/lib/inline-images/presentation'
import { inlineImageAltPlaceholder } from '@/lib/inline-images/policy'
import { materializeRichTextPalette } from '@/lib/rich-text-palette'
import {
  RICH_TEXT_ALLOWED_TAGS,
  sanitizeRichText,
} from '@/lib/rich-text-sanitizer'
import { normalizeTableVerticalAlign } from '@/lib/rich-table-vertical-align'

const SANITIZED_IMAGE_RE = /<img\b[^>]*>/gi
const SANITIZED_ATTRIBUTE_RE = /(?:^|\s)([a-z][a-z0-9-]*)="([^"]*)"/gi
const PRIVATE_INLINE_IMAGE_URL_RE = /\/api\/inline-images\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi
const IMAGE_DATA_URI_RE = /data:image\/[^\s<\]]+/gi
const EMAIL_IMAGE_REFERENCE_REPLACEMENT = '[redacted]'
const VISIBLE_TEXT_BOUNDARY_TAGS = new Set(['p', 'br', 'ul', 'ol', 'li', 'h2', 'h3', 'table', 'tr', 'td', 'th'])

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

const FULL_SOURCE_CROP = {
  x: 0,
  y: 0,
  width: INLINE_IMAGE_CROP_SCALE,
  height: INLINE_IMAGE_CROP_SCALE,
}

function serializeGeometryNumber(value: number): string | null {
  return Number.isFinite(value) ? String(value) : null
}

function geometryDeclaration(name: string, value: number, unit: string): string | null {
  const serialized = serializeGeometryNumber(value)
  return serialized === null ? null : `${name}:${serialized}${unit}`
}

function joinStyle(parts: Array<string | null>): string {
  return parts.filter((part): part is string => part !== null).join(';')
}

function unrotatedFallback(
  imageHtml: string,
  attributes: Record<string, string>,
  presentation: InlineImagePresentation,
): string {
  const aligned = materializeInlineImageDisplayWidth(imageHtml, presentation.displayWidth)
  if (presentation.layout !== 'inline') return aligned

  const src = attributes.src ?? ''
  const alt = attributes.alt ?? ''
  const align = attributes['data-align'] ?? 'center'
  const width = presentation.displayWidth
  const frameStyle = width === null ? '' : ` style="width:${String(width)}px"`
  const widthAttr = width === null ? '' : ` width="${String(width)}"`
  return `<span class="rich-text__image-frame" data-layout="inline" data-align="${align}"${frameStyle}><img src="${src}" alt="${alt}"${widthAttr} /></span>`
}

function materializeTrustedImage(
  attributes: Record<string, string>,
  presentation: InlineImagePresentation,
  geometry: InlineImageFrameGeometry,
): string {
  const src = attributes.src ?? ''
  const alt = attributes.alt ?? ''
  const align = attributes['data-align'] ?? 'center'
  const layoutAttr = presentation.layout === 'inline' ? ' data-layout="inline"' : ''
  const frameStyle = joinStyle([
    geometryDeclaration('width', geometry.frameWidth, 'px'),
    geometryDeclaration('aspect-ratio', geometry.aspectRatio, ''),
  ])
  const imageStyle = joinStyle([
    geometryDeclaration('width', geometry.imageWidthPercent, '%'),
    geometryDeclaration('height', geometry.imageHeightPercent, '%'),
    geometryDeclaration('left', geometry.imageOffsetXPercent, '%'),
    geometryDeclaration('top', geometry.imageOffsetYPercent, '%'),
  ])
  const image = `<img src="${src}" alt="${alt}" style="${imageStyle}" />`
  if (geometry.rotation === 0) {
    return `<span class="rich-text__image-frame"${layoutAttr} data-align="${align}" style="${frameStyle}">${image}</span>`
  }

  const sceneStyle = joinStyle([
    geometryDeclaration('width', geometry.sceneWidth / geometry.frameWidth * 100, '%'),
    geometryDeclaration('height', geometry.sceneHeight / geometry.frameHeight * 100, '%'),
    geometryDeclaration('left', geometry.sceneOffsetX / geometry.frameWidth * 100, '%'),
    geometryDeclaration('top', geometry.sceneOffsetY / geometry.frameHeight * 100, '%'),
    `transform:rotate(${geometry.rotation}deg)`,
  ])
  return `<span class="rich-text__image-frame"${layoutAttr} data-align="${align}" style="${frameStyle}"><span class="rich-text__image-scene" style="${sceneStyle}">${image}</span></span>`
}

function materializeTrustedImages(sanitized: string): string {
  return sanitized.replace(SANITIZED_IMAGE_RE, (imageHtml) => {
    const attributes = sanitizedImageAttributes(imageHtml)
    const presentation = parseInlineImagePresentation(attributes)
    const crop = presentation.crop ?? (
      presentation.rotation !== 0
      && presentation.naturalWidth !== null
      && presentation.naturalHeight !== null
        ? FULL_SOURCE_CROP
        : null
    )
    if (
      crop === null
      || presentation.naturalWidth === null
      || presentation.naturalHeight === null
    ) {
      return unrotatedFallback(imageHtml, attributes, presentation)
    }

    const geometry = computeInlineImageFrameGeometry({
      crop,
      naturalWidth: presentation.naturalWidth,
      naturalHeight: presentation.naturalHeight,
      displayWidth: presentation.displayWidth,
      rotation: presentation.rotation,
    })
    if (geometry === null) {
      return unrotatedFallback(imageHtml, attributes, presentation)
    }
    return materializeTrustedImage(attributes, presentation, geometry)
  })
}

/** Trusted application-only presentation generated after the storage sanitizer boundary. */
export function materializeRichTextForApp(source: string): string {
  const sanitized = sanitizeRichText(source)
  const palette = materializeRichTextPalette(sanitized, 'app')
  return materializeTrustedImages(materializeTableCellWidths(palette))
}

const EMAIL_TABLE_STYLE = 'border-collapse:collapse;width:100%;margin:8px 0'
const EMAIL_TABLE_CELL_BOX_STYLE = 'border:1px solid #cbd5e1;padding:6px 8px'
const EMAIL_TABLE_CELL_STYLE = `${EMAIL_TABLE_CELL_BOX_STYLE};vertical-align:top`
const EMAIL_TABLE_HEADER_CELL_STYLE = `${EMAIL_TABLE_CELL_STYLE};background-color:#f1f5f9;text-align:left;font-weight:700`

/** The authored vertical align replaces the default top alignment. */
function emailTableCellStyle(baseStyle: string, attribs: Record<string, string>): string {
  let style = baseStyle
  const verticalAlign = normalizeTableVerticalAlign(attribs['data-vertical-align'])
  if (verticalAlign !== null) {
    style = style.replace('vertical-align:top', `vertical-align:${verticalAlign}`)
  }
  const width = cellWidthStyle(attribs)
  if (width !== null) style += `;${width}`
  return style
}

const TABLE_COLWIDTH_RE = /^\d{1,4}(?:,\d{1,4})*$/

/**
 * Stored cell column width (TipTap colwidth attribute) as an inline style.
 * Multi-value widths belong to colspan spans; skip them rather than guess.
 */
function cellWidthStyle(attribs: Record<string, string>): string | null {
  const raw = attribs.colwidth
  if (!raw || !TABLE_COLWIDTH_RE.test(raw)) return null
  const parts = raw.split(',')
  if (parts.length !== 1) return null
  const px = Number.parseInt(parts[0]!, 10)
  if (!Number.isFinite(px) || px <= 0) return null
  return `width:${px}px`
}

/**
 * Honors stored column widths on app/PDF output. Everything passes through
 * untouched (trusted post-sanitizer markup, including palette styles); only
 * th/td gain a width style.
 */
export function materializeTableCellWidths(sanitized: string): string {
  return sanitizeHtml(sanitized, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: false,
    transformTags: {
      '*': (tagName, attribs) => {
        if (tagName !== 'th' && tagName !== 'td') return { tagName, attribs }
        const width = cellWidthStyle(attribs)
        return width === null
          ? { tagName, attribs }
          : { tagName, attribs: { ...attribs, style: width } }
      },
    },
  })
}

/**
 * Inline-styled trusted table markup for email clients that drop <style>.
 * Runs after the palette materializer (whose internal sanitize pass would
 * strip style attributes); transformTags output bypasses attribute filtering,
 * so the structural cell attributes survive the restyle.
 */
function materializeTrustedTablesForEmail(sanitized: string): string {
  return sanitizeHtml(sanitized, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: false,
    transformTags: {
      table: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, style: EMAIL_TABLE_STYLE },
      }),
      th: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          style: emailTableCellStyle(EMAIL_TABLE_HEADER_CELL_STYLE, attribs),
        },
      }),
      td: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          style: emailTableCellStyle(EMAIL_TABLE_CELL_STYLE, attribs),
        },
      }),
    },
  })
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
  return materializeTrustedTablesForEmail(
    materializeRichTextPalette(truncated, 'email'),
  )
}
