import sanitizeHtml from 'sanitize-html'

export const MAX_INLINE_IMAGES = 10
export const MAX_INLINE_DESCRIPTION_BYTES = 100 * 1024 * 1024
export const MAX_INLINE_ALT_LENGTH = 300
export const MAX_CONCURRENT_INLINE_UPLOADS = 3
export const INLINE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
export const INLINE_IMAGE_ALIGNMENTS = ['left', 'center', 'right'] as const

export type InlineImageAlignment = typeof INLINE_IMAGE_ALIGNMENTS[number]

export function normalizeInlineImageAlignment(alignment: string | undefined): InlineImageAlignment {
  return INLINE_IMAGE_ALIGNMENTS.includes(alignment as InlineImageAlignment)
    ? alignment as InlineImageAlignment
    : 'center'
}

export type InlineImageUpload = {
  id: string
  src: string
  alt: string
  fileType: string
  fileSize: number
  width: number
  height: number
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const SRC_RE = new RegExp(`^/api/inline-images/(${UUID})$`, 'i')

export function parseInlineImageSrc(src: string): string | null {
  return SRC_RE.exec(src)?.[1].toLowerCase() ?? null
}

export function canonicalInlineImageSrc(id: string): string {
  const parsed = parseInlineImageSrc(`/api/inline-images/${id}`)
  if (!parsed) throw new Error('Invalid inline image id')
  return `/api/inline-images/${parsed}`
}

export function extractInlineImageIds(html: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()

  sanitizeHtml(html, {
    allowedTags: ['img'],
    allowedAttributes: { img: ['src'] },
    transformTags: {
      img: (_tagName, attribs) => {
        const id = parseInlineImageSrc(attribs.src ?? '')
        if (id && !seen.has(id)) {
          seen.add(id)
          ids.push(id)
        }
        return { tagName: 'img', attribs: {} }
      },
    },
  })

  return ids
}

export function inlineImageAltPlaceholder(html: string): string {
  return html
    .replace(/<img\b[^>]*\balt=(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_match, doubleQuotedAlt, singleQuotedAlt) => {
      const alt = String(doubleQuotedAlt ?? singleQuotedAlt ?? '').trim()
      return alt ? `[Image: ${alt}]` : '[Image]'
    })
    .replace(/<img\b[^>]*>/gi, '[Image]')
}
