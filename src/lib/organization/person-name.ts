/**
 * Person display-name helpers shared by the tree, the unassigned dock, and
 * the manage drawers (one spelling per concept: the drawers must title the
 * SHORT name, never the stored "Name — Unit" qualifier string).
 */
export function personShortName(name: string): string {
  const first = name.split(' — ')[0]?.trim() ?? ''
  return first.length > 0 ? first : name.trim()
}

export function personInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '??'
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}
