export const RICH_TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const
export type RichTextAlignment = (typeof RICH_TEXT_ALIGNMENTS)[number]

export function isRichTextAlignment(value: unknown): value is RichTextAlignment {
  return typeof value === 'string' && (RICH_TEXT_ALIGNMENTS as readonly string[]).includes(value)
}

/** Missing or invalid alignment becomes left and is not serialized. */
export function normalizeRichTextAlignment(value: string | null | undefined): RichTextAlignment {
  return isRichTextAlignment(value) ? value : 'left'
}

export function serializeRichTextAlignment(align: RichTextAlignment): Record<string, string> {
  return align === 'left' ? {} : { 'data-text-align': align }
}
