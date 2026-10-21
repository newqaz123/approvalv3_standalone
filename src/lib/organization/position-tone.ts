/**
 * Position badge tone language (owner-approved org visual polish).
 *
 * The tree chips, team member chips, and drawer rows share one tone mapping
 * so a position reads the same everywhere:
 *  - manager family ("Manager", "Department manager", "Section manager") → blue
 *  - Supervisor / Lead → amber
 *  - Staff → emerald
 *  - anything else → neutral slate
 *
 * Classification is by lowercase substring on the position NAME on purpose:
 * positions are free-form rows, and the owner-approved contract names the
 * families, not ids. All pairings are Tailwind 100/800-level badge colors
 * with accessible contrast (WCAG AA on small text).
 */
export type PositionTone = 'manager' | 'lead' | 'staff' | 'neutral'

export function positionToneFor(positionName: string): PositionTone {
  const name = positionName.toLowerCase()
  if (name.includes('manager')) return 'manager'
  if (name.includes('supervisor') || name.includes('lead')) return 'lead'
  if (name.includes('staff')) return 'staff'
  return 'neutral'
}

export const POSITION_TONE_BADGE_CLASSES: Record<PositionTone, string> = {
  manager: 'bg-blue-100 text-blue-800 ring-blue-200',
  lead: 'bg-amber-100 text-amber-800 ring-amber-200',
  staff: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
}

export function positionBadgeClasses(positionName: string): string {
  return POSITION_TONE_BADGE_CLASSES[positionToneFor(positionName)]
}

/**
 * Unit flag icon tones, shared by the tree header icons and the unit panel
 * toggle rows: sharing (Share2) is sky when ON, solutions (Wrench) is amber
 * when ON, and an OFF flag renders muted.
 */
export const SHARING_FLAG_ON_CLASSES = 'border-sky-200 bg-sky-50 text-sky-600'
export const SOLUTIONS_FLAG_ON_CLASSES = 'border-amber-200 bg-amber-50 text-amber-600'
export const FLAG_OFF_CLASSES = 'border-slate-200 bg-secondary text-muted-foreground'
