/**
 * Approval routing rollout gate.
 *
 * Task 8 introduced the legacy-default gate for the NEW approval engine.
 * Task 15 keeps that contract and adds the alias `APPROVAL_ORG_ROUTING_MODE`
 * with the same values. Creation flows consult `getApprovalRolloutMode` and
 * keep their existing legacy builders unless the operator opts into `shadow`
 * (legacy result plus a read-only NEW comparison) or `new` (NEW creation,
 * which still requires a completed import digest and origin/route coverage).
 *
 * The mode affects CREATION ONLY: approval rows and instances that already
 * exist keep their persisted routing semantics in every mode, and legacy
 * in-flight rows are never rebuilt. Unknown values fail closed to `legacy`.
 */

export type ApprovalRolloutMode = 'legacy' | 'shadow' | 'new'

export const APPROVAL_ROUTING_MODE_ENV = 'APPROVAL_ROUTING_MODE'
export const APPROVAL_ORG_ROUTING_MODE_ENV = 'APPROVAL_ORG_ROUTING_MODE'
export const APPROVAL_ORG_MAPPING_DIGEST_ENV = 'APPROVAL_ORG_MAPPING_DIGEST'

function reportUnknownMode(envName: string, value: string): void {
  console.error(
    `[approval-rollout] Unknown ${envName} value "${value}"; using the legacy default. Expected one of: legacy, shadow, new.`,
  )
}

function reportConflictingModes(left: string, right: string): void {
  console.error(
    `[approval-rollout] Conflicting ${APPROVAL_ROUTING_MODE_ENV}="${left}" and ${APPROVAL_ORG_ROUTING_MODE_ENV}="${right}"; using the legacy default.`,
  )
}

function parseMode(raw: string | undefined, envName: string): ApprovalRolloutMode | null {
  if (raw === undefined) return null
  if (raw === 'shadow' || raw === 'new' || raw === 'legacy') return raw
  reportUnknownMode(envName, raw)
  return 'legacy'
}

/**
 * Resolve the creation rollout mode from an explicit environment record
 * (production passes `process.env`; tests pass their own record and never read
 * the real environment). `APPROVAL_ROUTING_MODE` and `APPROVAL_ORG_ROUTING_MODE`
 * are aliases for the same `legacy | shadow | new` values. Unknown values and
 * conflicting aliases fail closed to the legacy default.
 */
export function getApprovalRolloutMode(env: Record<string, string | undefined>): ApprovalRolloutMode {
  const routingRaw = env[APPROVAL_ROUTING_MODE_ENV]
  const orgRaw = env[APPROVAL_ORG_ROUTING_MODE_ENV]
  const routingMode = parseMode(routingRaw, APPROVAL_ROUTING_MODE_ENV)
  const orgMode = parseMode(orgRaw, APPROVAL_ORG_ROUTING_MODE_ENV)
  if (routingMode && orgMode && routingMode !== orgMode) {
    reportConflictingModes(routingRaw ?? '', orgRaw ?? '')
    return 'legacy'
  }
  return routingMode ?? orgMode ?? 'legacy'
}

export interface RolloutVerificationDb {
  loadMappingBlockers(): Promise<string[]>
  countLegacyRowsWithoutDiscriminator(): Promise<number>
  countPublishedRouteConflicts(): Promise<number>
  countInactiveSnapshotCandidates(): Promise<number>
  countPendingSnapshotGroupsMissing(): Promise<number>
}

export interface OrganizationRolloutVerification {
  mappingBlockers: string[]
  legacyRowsWithoutDiscriminator: number
  publishedRouteConflicts: number
  inactiveSnapshotCandidates: number
  pendingSnapshotGroupsMissing: number
  readyForShadow: boolean
  readyForNewAttempts: boolean
  blockers: string[]
}

/**
 * Read-only cutover verification. Mapping blockers, discriminator gaps,
 * published-route conflicts, and missing pending snapshot groups block both
 * shadow and new-attempt readiness. Inactive snapshot candidates are reported
 * but never replaced, approved, or treated as cutover blockers.
 */
export async function verifyOrganizationRollout(
  db: RolloutVerificationDb,
): Promise<OrganizationRolloutVerification> {
  const [
    mappingBlockers,
    legacyRowsWithoutDiscriminator,
    publishedRouteConflicts,
    inactiveSnapshotCandidates,
    pendingSnapshotGroupsMissing,
  ] = await Promise.all([
    db.loadMappingBlockers(),
    db.countLegacyRowsWithoutDiscriminator(),
    db.countPublishedRouteConflicts(),
    db.countInactiveSnapshotCandidates(),
    db.countPendingSnapshotGroupsMissing(),
  ])
  const blockers: string[] = []
  if (mappingBlockers.length > 0) blockers.push('MAPPING_BLOCKERS_PRESENT')
  if (legacyRowsWithoutDiscriminator > 0) blockers.push('LEGACY_ROWS_WITHOUT_DISCRIMINATOR')
  if (publishedRouteConflicts > 0) blockers.push('PUBLISHED_ROUTE_CONFLICTS')
  if (pendingSnapshotGroupsMissing > 0) blockers.push('PENDING_SNAPSHOT_GROUP_MISSING')
  return {
    mappingBlockers,
    legacyRowsWithoutDiscriminator,
    publishedRouteConflicts,
    inactiveSnapshotCandidates,
    pendingSnapshotGroupsMissing,
    readyForShadow: blockers.length === 0,
    readyForNewAttempts: blockers.length === 0,
    blockers,
  }
}
