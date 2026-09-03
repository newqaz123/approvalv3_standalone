export type DiscardDraftFlags = {
  formIsDirty: boolean
  hasFiles: boolean
  hasInlineImageDrafts: boolean
}

const TABLE_OR_IMAGE_RE = /<(?:table|img)\b/i

/** True when authored HTML has visible text, a table, or an image. */
export function hasDraftRichTextContent(html: string): boolean {
  if (TABLE_OR_IMAGE_RE.test(html)) return true
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim().length > 0
}

/** Field changed from its initial value in a way that would lose user work. */
export function isDraftFieldDirty(current: string, initial = ''): boolean {
  const currentMeaningful = hasDraftRichTextContent(current)
  const initialMeaningful = hasDraftRichTextContent(initial)
  if (!currentMeaningful && !initialMeaningful) return false
  return current !== initial
}

export function shouldConfirmDiscardDraft(flags: DiscardDraftFlags): boolean {
  return flags.formIsDirty || flags.hasFiles || flags.hasInlineImageDrafts
}

export function requestDiscardDraft(
  flags: DiscardDraftFlags,
  confirm: () => void,
  leave: () => void,
): void {
  if (shouldConfirmDiscardDraft(flags)) confirm()
  else leave()
}
