import sanitizeHtml from 'sanitize-html'
import { decodeHTML } from 'entities'
import {
  MAX_INLINE_ALT_LENGTH,
  canonicalInlineImageSrc,
  normalizeInlineImageAlignment,
  parseInlineImageSrc,
} from '@/lib/inline-images/policy'
import { sanitizeInlineImagePresentationAttributes } from '@/lib/inline-images/presentation'
import {
  normalizeRichTextAlignment,
  serializeRichTextAlignment,
} from '@/lib/rich-text-align'
import { normalizeTableVerticalAlign } from '@/lib/rich-table-vertical-align'
import {
  isHighlightColorToken,
  isTextColorToken,
} from '@/lib/rich-text-palette'

export const RICH_TEXT_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'h2', 'h3', 'a', 'img',
  'span', 'mark', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
] as const

/** Exact allowed link schemes. Scheme-less/relative hrefs are stripped (text kept). */
const ALLOWED_HREF_RE = /^(?:https?:|mailto:)/i

function isAllowedHref(href: string | undefined): href is string {
  return typeof href === 'string' && ALLOWED_HREF_RE.test(href)
}

function alignedBlockTag(tagName: string, attribs: Record<string, string>) {
  return {
    tagName,
    attribs: serializeRichTextAlignment(normalizeRichTextAlignment(attribs['data-text-align'])),
  }
}

const TABLE_CELL_ATTRS = ['colspan', 'rowspan', 'colwidth', 'data-colwidth'] as const

/** Keeps structural cell metadata and only the validated vertical align token. */
function tableCellTag(tagName: string, attribs: Record<string, string>) {
  const next: Record<string, string> = {}
  for (const key of TABLE_CELL_ATTRS) {
    if (attribs[key] !== undefined) next[key] = attribs[key]
  }
  const verticalAlign = normalizeTableVerticalAlign(attribs['data-vertical-align'])
  if (verticalAlign !== null) next['data-vertical-align'] = verticalAlign
  return { tagName, attribs: next }
}

/** Whitelist-sanitize authored description HTML. Never throws. */
export function sanitizeRichText(html: string): string {
  try {
    return sanitizeHtml(html, {
      allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
      allowedAttributes: {
        a: ['href', 'target', 'rel'],
        span: ['data-text-color'],
        mark: ['data-highlight'],
        p: ['data-text-align'],
        h2: ['data-text-align'],
        h3: ['data-text-align'],
        // Table structure. colspan/rowspan are TipTap's cell attributes;
        // colwidth/data-colwidth survive round-trips of tables pasted with
        // explicit column widths. Values are entity-escaped by sanitize-html.
        th: ['colspan', 'rowspan', 'colwidth', 'data-colwidth', 'data-vertical-align'],
        td: ['colspan', 'rowspan', 'colwidth', 'data-colwidth', 'data-vertical-align'],
        img: [
          'src',
          'alt',
          'data-align',
          'data-width',
          'data-natural-width',
          'data-natural-height',
          'data-crop-x',
          'data-crop-y',
          'data-crop-width',
          'data-crop-height',
          'data-layout',
          'data-rotation',
        ],
      },
      allowedSchemes: ['http', 'https', 'mailto'],
      allowProtocolRelative: false,
      transformTags: {
        a: (tagName, attribs) => {
          const next: Record<string, string> = { target: '_blank', rel: 'noopener noreferrer' }
          if (isAllowedHref(attribs.href)) {
            next.href = attribs.href
          }
          return { tagName, attribs: next }
        },
        span: (tagName, attribs) => {
          if (attribs['data-inline-upload-placeholder'] === 'true') {
            return { tagName: 'inline-upload-placeholder', attribs: {} as Record<string, string> }
          }

          const token = attribs['data-text-color']
          const next: Record<string, string> = isTextColorToken(token)
            ? { 'data-text-color': token }
            : {}
          return { tagName, attribs: next }
        },
        mark: (tagName, attribs) => {
          const token = attribs['data-highlight']
          const next: Record<string, string> = isHighlightColorToken(token)
            ? { 'data-highlight': token }
            : {}
          return { tagName: isHighlightColorToken(token) ? tagName : 'span', attribs: next }
        },
        p: alignedBlockTag,
        h2: alignedBlockTag,
        h3: alignedBlockTag,
        th: tableCellTag,
        td: tableCellTag,
        img: (_tagName, attribs) => {
          const id = parseInlineImageSrc(attribs.src ?? '')
          if (!id) return { tagName: 'span', attribs: {} as Record<string, string> }

          const align = normalizeInlineImageAlignment(attribs['data-align'])
          const presentation = sanitizeInlineImagePresentationAttributes(attribs)

          return {
            tagName: 'img',
            attribs: {
              src: canonicalInlineImageSrc(id),
              alt: (attribs.alt ?? '').slice(0, MAX_INLINE_ALT_LENGTH),
              'data-align': align,
              ...presentation,
            },
          }
        },
      },
      disallowedTagsMode: 'discard',
    })
  } catch {
    return ''
  }
}

const WHITELIST_TAG_RE = new RegExp(
  `<(?:${RICH_TEXT_ALLOWED_TAGS.join('|')})(?:\\s|/|>)`,
  'i',
)

/** True only when the source starts with `<` (after whitespace) and contains a whitelisted tag. */
export function containsRichTextHtml(source: string): boolean {
  const trimmed = source.trimStart()
  if (!trimmed.startsWith('<')) return false
  return WHITELIST_TAG_RE.test(trimmed)
}

/** Visible text of authored HTML — tags stripped, entities decoded. */
export function richTextToPlainText(html: string): string {
  const sanitized = sanitizeRichText(html)
  const withBlockSeparators = sanitized
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|h2|h3|li|ul|ol|table|tr|td|th)>/gi, ' ')
  const stripped = sanitizeHtml(withBlockSeparators, {
    allowedTags: [],
    allowedAttributes: {},
  })

  return decodeHTML(stripped).replace(/\s+/g, ' ').trim()
}
