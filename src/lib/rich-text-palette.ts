import sanitizeHtml from 'sanitize-html'
import {
  RICH_TEXT_ALLOWED_TAGS,
  sanitizeRichText,
} from '@/lib/rich-text-sanitizer'

export const TEXT_COLOR_VALUES = {
  ink: '#1E293B',
  slate: '#475569',
  blue: '#1D4ED8',
  teal: '#0F766E',
  green: '#15803D',
  amber: '#B45309',
  red: '#B91C1C',
} as const

export const HIGHLIGHT_COLOR_VALUES = {
  yellow: '#FEF3C7',
  blue: '#DBEAFE',
  green: '#D1FAE5',
  pink: '#FCE7F3',
  violet: '#EDE9FE',
  red: '#FEE2E2',
  gray: '#E2E8F0',
} as const

export type TextColorToken = keyof typeof TEXT_COLOR_VALUES
export type HighlightColorToken = keyof typeof HIGHLIGHT_COLOR_VALUES

export function isTextColorToken(value: unknown): value is TextColorToken {
  return typeof value === 'string' && Object.hasOwn(TEXT_COLOR_VALUES, value)
}

export function isHighlightColorToken(value: unknown): value is HighlightColorToken {
  return typeof value === 'string' && Object.hasOwn(HIGHLIGHT_COLOR_VALUES, value)
}

/**
 * Converts sanitized semantic marks to hard-coded trusted output colors for
 * application, email, and PDF renderers.
 */
export function materializeRichTextPalette(
  html: string,
  target: 'app' | 'email' | 'pdf',
): string {
  const sanitized = sanitizeRichText(html)
  void target

  // The first pass is the authoritative boundary. This pass only replaces its
  // validated semantic attributes and therefore deliberately preserves every
  // already-sanitized tag/attribute, including canonical image presentation.
  return sanitizeHtml(sanitized, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: false,
    transformTags: {
      span: (tagName, attribs) => {
        const token = attribs['data-text-color']
        const next: Record<string, string> = isTextColorToken(token)
          ? { style: `color:${TEXT_COLOR_VALUES[token]}` }
          : {}
        return { tagName, attribs: next }
      },
      mark: (tagName, attribs) => {
        const token = attribs['data-highlight']
        const next: Record<string, string> = isHighlightColorToken(token)
          ? { style: `background-color:${HIGHLIGHT_COLOR_VALUES[token]}` }
          : {}
        return { tagName: isHighlightColorToken(token) ? tagName : 'span', attribs: next }
      },
    },
  })
}
