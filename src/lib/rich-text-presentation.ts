import sanitizeHtml from 'sanitize-html'
import { decodeHTML, escapeText } from 'entities'
import { DomUtils, parseDocument } from 'htmlparser2'
import {
  Text as DomText,
  isTag,
  isText,
  type ChildNode,
  type Element,
  type ParentNode,
  type Text,
} from 'domhandler'
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
const PRIVATE_INLINE_IMAGE_URL_RE = /\/api\/inline-images\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi
const IMAGE_DATA_URI_RE = /data:image\/[^\s<\]]+/gi
const EMAIL_IMAGE_REFERENCE_REPLACEMENT = '[redacted]'
const VISIBLE_TEXT_BOUNDARY_TAGS = new Set(['p', 'br', 'ul', 'ol', 'li', 'h2', 'h3'])

type VisibleTextSegment = {
  node: Text
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

function appendVisibleTextBoundary(parts: string[], cursor: { value: number }): void {
  parts.push('\n')
  cursor.value += 1
}

function collectVisibleText(
  parent: ParentNode,
  parts: string[],
  segments: VisibleTextSegment[],
  cursor: { value: number },
): void {
  for (const child of parent.children) {
    if (isText(child)) {
      const start = cursor.value
      parts.push(child.data)
      cursor.value += child.data.length
      segments.push({ node: child, start, end: cursor.value })
      continue
    }
    if (!isTag(child)) continue

    if (child.name === 'br') {
      appendVisibleTextBoundary(parts, cursor)
      continue
    }

    collectVisibleText(child, parts, segments, cursor)
    if (VISIBLE_TEXT_BOUNDARY_TAGS.has(child.name)) {
      appendVisibleTextBoundary(parts, cursor)
    }
  }
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

function lowestCommonParent(left: Text, right: Text): ParentNode {
  const rightParents = new Set<ParentNode>()
  for (let parent = right.parent; parent !== null; parent = parent.parent) {
    rightParents.add(parent)
  }
  for (let parent = left.parent; parent !== null; parent = parent.parent) {
    if (rightParents.has(parent)) return parent
  }
  throw new Error('Visible text nodes must share a document parent')
}

function childUnderParent(node: ChildNode, parent: ParentNode): ChildNode {
  let child = node
  while (child.parent !== parent) {
    if (child.parent === null) throw new Error('Visible text node is outside its match parent')
    child = child.parent
  }
  return child
}

function collectAffectedFormatting(
  node: Text,
  matchParent: ParentNode,
  affected: Set<Element>,
): void {
  for (let parent = node.parent; parent !== null && parent !== matchParent; parent = parent.parent) {
    if (isTag(parent)) affected.add(parent)
  }
}

function elementDepth(element: Element): number {
  let depth = 0
  for (let parent = element.parent; parent !== null; parent = parent.parent) depth += 1
  return depth
}

function pruneEmptyAffectedFormatting(affected: Set<Element>): void {
  const deepestFirst = [...affected].sort((left, right) => elementDepth(right) - elementDepth(left))
  for (const element of deepestFirst) {
    if (element.children.every((child) => isText(child) && child.data.length === 0)) {
      DomUtils.removeElement(element)
    }
  }
}

function applyVisibleTextMatch(
  match: VisibleTextMatch,
  segments: VisibleTextSegment[],
  affected: Set<Element>,
): void {
  const matchedSegments = segments.filter(
    (segment) => segment.end > match.start && segment.start < match.end,
  )
  const first = matchedSegments[0]
  const last = matchedSegments.at(-1)
  if (!first || !last) return

  if (first.node === last.node) {
    const start = match.start - first.start
    const end = match.end - first.start
    first.node.data = first.node.data.slice(0, start)
      + EMAIL_IMAGE_REFERENCE_REPLACEMENT
      + first.node.data.slice(end)
    return
  }

  const matchParent = lowestCommonParent(first.node, last.node)
  const firstBranch = childUnderParent(first.node, matchParent)
  for (const segment of matchedSegments) {
    const start = Math.max(0, match.start - segment.start)
    const end = Math.min(segment.node.data.length, match.end - segment.start)
    segment.node.data = segment.node.data.slice(0, start) + segment.node.data.slice(end)
    collectAffectedFormatting(segment.node, matchParent, affected)
  }
  DomUtils.append(firstBranch, new DomText(EMAIL_IMAGE_REFERENCE_REPLACEMENT))
}

function redactEmailVisibleImageReferences(source: string): string {
  const document = parseDocument(source, { decodeEntities: true })
  const parts: string[] = []
  const segments: VisibleTextSegment[] = []
  collectVisibleText(document, parts, segments, { value: 0 })

  const affected = new Set<Element>()
  for (const match of forbiddenVisibleTextMatches(parts.join('')).reverse()) {
    applyVisibleTextMatch(match, segments, affected)
  }
  pruneEmptyAffectedFormatting(affected)
  return DomUtils.getInnerHTML(document, { encodeEntities: 'utf8' })
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
