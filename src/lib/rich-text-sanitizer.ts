import sanitizeHtml from 'sanitize-html'
import { decodeHTML } from 'entities'
import {
  MAX_INLINE_ALT_LENGTH,
  canonicalInlineImageSrc,
  parseInlineImageSrc,
} from '@/lib/inline-images/policy'

export const RICH_TEXT_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'h2', 'h3', 'a', 'img',
] as const

/** Exact allowed link schemes. Scheme-less/relative hrefs are stripped (text kept). */
const ALLOWED_HREF_RE = /^(?:https?:|mailto:)/i

function isAllowedHref(href: string | undefined): href is string {
  return typeof href === 'string' && ALLOWED_HREF_RE.test(href)
}

/** Whitelist-sanitize authored description HTML. Never throws. */
export function sanitizeRichText(html: string): string {
  try {
    return sanitizeHtml(html, {
      allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
      allowedAttributes: {
        a: ['href', 'target', 'rel'],
        img: ['src', 'alt', 'data-align'],
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
        img: (_tagName, attribs) => {
          const id = parseInlineImageSrc(attribs.src ?? '')
          if (!id) return { tagName: 'span', attribs: {} as Record<string, string> }

          const align = ['left', 'center', 'right'].includes(attribs['data-align'])
            ? attribs['data-align']
            : 'center'

          return {
            tagName: 'img',
            attribs: {
              src: canonicalInlineImageSrc(id),
              alt: (attribs.alt ?? '').slice(0, MAX_INLINE_ALT_LENGTH),
              'data-align': align,
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
    .replace(/<\/(?:p|h2|h3|li|ul|ol)>/gi, ' ')
  const stripped = sanitizeHtml(withBlockSeparators, {
    allowedTags: [],
    allowedAttributes: {},
  })

  return decodeHTML(stripped).replace(/\s+/g, ' ').trim()
}
