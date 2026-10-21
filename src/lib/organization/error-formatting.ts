// Human-friendly formatting of organization validation and guard errors for
// the admin workspace panels (follow-up on accepted a663e706). Panel-visible
// messages must never surface raw unit slugs (cs-*) or record UUIDs: every
// quoted id in a message resolves to its display name here — unit ids to the
// unit-labels path (unit › parent … root), assignment ids to "person in unit",
// team/position/user ids to their names. Ids the snapshot cannot resolve are
// replaced with an unavailable marker rather than leaked. The detailed
// id-bearing strings remain available to non-UI consumers (CLI/readiness and
// tests), which read validateOrganization's messages directly.
import { unitPathNames } from '@/lib/unit-labels'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from './model'

export interface ErrorFormatSnapshot {
  units: readonly OrganizationUnitNode[]
  positions: readonly PositionNode[]
  assignments: readonly AssignmentNode[]
  teams: readonly TeamNode[]
  users: ReadonlyArray<{ id: string; name: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Ids this codebase has historically seeded with recognizable prefixes. */
const SEEDED_SLUG_RE = /^(cs|teamdeact|treehx|renameblur|unitdeact)-[a-z0-9-]+$/i
/** Same id shapes, matchable inline in free text (applied outside quotes only). */
const BARE_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:cs|teamdeact|treehx|renameblur|unitdeact)-[a-z0-9-]+/gi
const UNAVAILABLE = 'record unavailable'

function isIdShaped(token: string): boolean {
  return UUID_RE.test(token) || SEEDED_SLUG_RE.test(token)
}

function unitLabel(units: readonly OrganizationUnitNode[], unitId: string): string {
  return unitPathNames(units, unitId).join(' › ')
}

function personLabel(
  snapshot: ErrorFormatSnapshot,
  userId: string | undefined,
): string {
  if (userId === undefined) return UNAVAILABLE
  return snapshot.users.find((user) => user.id === userId)?.name ?? UNAVAILABLE
}

function assignmentLabel(snapshot: ErrorFormatSnapshot, assignmentId: string): string {
  const assignment = snapshot.assignments.find((row) => row.id === assignmentId)
  if (!assignment) return UNAVAILABLE
  const person = personLabel(snapshot, assignment.userId)
  const unit = snapshot.units.find((row) => row.id === assignment.unitId)
  return unit ? `${person} in ${unit.name}` : person
}

function resolveToken(snapshot: ErrorFormatSnapshot, token: string): string {
  const unit = snapshot.units.find((row) => row.id === token)
  if (unit) return unitLabel(snapshot.units, unit.id)
  const position = snapshot.positions.find((row) => row.id === token)
  if (position) return position.name
  const team = snapshot.teams.find((row) => row.id === token)
  if (team) return team.name
  if (snapshot.users.some((row) => row.id === token)) {
    return personLabel(snapshot, token)
  }
  if (snapshot.assignments.some((row) => row.id === token)) {
    return assignmentLabel(snapshot, token)
  }
  // Unknown ids (uuid or seeded slug) must never reach the user raw.
  if (UUID_RE.test(token) || SEEDED_SLUG_RE.test(token)) return UNAVAILABLE
  return token
}

/**
 * Rewrite one error message for display: every double-quoted token that
 * matches a known record id becomes its display name; unknown id-shaped
 * tokens become the unavailable marker; plain quoted words (team names,
 * "Line A") pass through unchanged. Guard producers that append the raw
 * record id in parentheses after the already-named offender lose that
 * redundant id, and any remaining bare id-shaped token outside quotes is
 * resolved (or marked unavailable) so no slug or UUID ever reaches the user.
 */
export function formatOrganizationErrorForUser(
  message: string,
  snapshot: ErrorFormatSnapshot,
): string {
  const quoted = message.replace(/"([^"]*)"/g, (_whole, token: string) => (
    `"${resolveToken(snapshot, token)}"`
  ))
  // Deactivation guards emit `"Name" (record-id)`; the id adds nothing the
  // name has not already said, so the parenthetical is dropped.
  const collapsed = quoted.replace(/("[^"]*")\s*\(([^()]*?)\)/g, (whole, label: string, inner: string) => (
    isIdShaped(inner.trim()) ? label : whole
  ))
  // Remaining bare ids (route-version ids, unresolvable fallbacks) are
  // rewritten only outside quotes so display names are never partially matched.
  return collapsed.replace(/("[^"]*"|[^"\n]+)/g, (segment: string) => (
    segment.startsWith('"') ? segment : segment.replace(BARE_ID_RE, (token) => resolveToken(snapshot, token))
  ))
}
