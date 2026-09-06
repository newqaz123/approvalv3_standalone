import { ORGANIZATION_POSITION_LEVEL } from '@/lib/organization/types'
import type { OrganizationPositionCode, ReportingBranch } from '@/lib/organization/types'
import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/validation'
import type { CandidateGroupSnapshot } from './types'

/**
 * Resolves the scope unit a required position draws its candidates from:
 * - Reporting positions (levels 1-2: STAFF/SUPERVISOR) resolve from the
 *   origin branch's reporting-group path inside the origin section, never
 *   from sibling groups or other sections.
 * - Manager positions (levels 3-6) resolve from the unit of their own type
 *   on the origin's unit ancestor path (section/department/division/factory
 *   tree depth is validated by the organization repository), never from
 *   descendant or sibling scopes.
 * The validated tree gives every manager position exactly one path position:
 * FACTORY_MANAGER is the last path unit, DIVISION_MANAGER second to last,
 * DEPARTMENT_MANAGER third to last, SECTION_MANAGER fourth to last. A step
 * above the origin level always finds its scope; a missing one is a
 * configuration error, never silently skipped.
 */
export function stepScopeUnitId(branch: ReportingBranch, requiredPosition: OrganizationPositionCode): string {
  const level = ORGANIZATION_POSITION_LEVEL[requiredPosition]
  if (level <= 2) return branch.primaryUnitId
  const index = branch.unitPath.length - (7 - level)
  const scopeUnitId = index >= 0 ? branch.unitPath[index] : undefined
  if (!scopeUnitId) {
    throw new ApprovalRouteConfigurationError(
      `Route position ${requiredPosition} has no scope unit on the origin branch path`,
    )
  }
  return scopeUnitId
}

/** Copies and deduplicates candidate IDs: group membership is never live. */
export function dedupeCandidateIds(candidateUserIds: readonly string[]): string[] {
  return [...new Set(candidateUserIds)]
}

/**
 * Immutable candidate-group snapshot: copies and dedupes the supplied IDs so
 * later organization edits cannot change an already-built plan or snapshot.
 */
export function snapshotCandidateGroup(input: {
  requiredPosition: OrganizationPositionCode
  scopeUnitId: string
  candidateUserIds: readonly string[]
  capturedAt?: Date
}): CandidateGroupSnapshot {
  return {
    requiredPosition: input.requiredPosition,
    scopeUnitId: input.scopeUnitId,
    candidateUserIds: Object.freeze(dedupeCandidateIds(input.candidateUserIds)),
    capturedAt: input.capturedAt ?? new Date(),
  }
}
