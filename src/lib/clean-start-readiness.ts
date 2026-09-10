// Clean-start readiness validation (Plan A Task 7) — replaces the legacy
// cutover/mapping machinery (rollout env modes, mapping digests, shadow/new
// phases) with an explicit organization/route readiness check. Pure module
// over a plain read-only port: no database client is imported, no database
// is accessed, no environment variables are read. Any storage satisfying
// the shape can back it.
//
// Parent A7 rulings (recorded in the SDD ledger before implementation):
// - R-A7-1: the CLI (scripts/verify-clean-start-readiness.ts) is a
//   fail-closed shell until an adapter exists — this module stays pure.
// - R-A7-3: phase counts must be finite non-negative integers (counts, not
//   rank business rules). Missing key / non-number / NaN / ±Infinity /
//   negative / non-integer → PUBLISHED_ROUTE_COUNTS_INVALID, NEVER ready.
//   undefined/NaN must not silently read as "zero published routes, fine".
//   FIX1 (review 9a6fbd83 P1-1/P2-1): a provider that RESOLVES a malformed
//   container (undefined, null, non-object, array) is a SUCCESSFUL load with
//   garbage — never conflated with the failure sentinel (which is reserved
//   for rejections) — and records one identifying container-level
//   PUBLISHED_ROUTE_COUNTS_INVALID blocker without indexing; each phase is
//   then validated and assessed for zero INDEPENDENTLY, so a malformed phase
//   never suppresses another phase's valid zero blocker and never receives
//   a root-default blocker itself.
// - R-A7-4: countPublishedRoutesByPhase is ROOT-scope-only BY ADAPTER
//   CONTRACT (documented on the port below); this module cannot prove the
//   scoping itself — that is provable only in Plan B Task 6 adapter tests.
// - R-A7-5: individual provider rejections are caught and recorded as
//   READINESS_PROVIDER_ERROR blockers naming the method, with SANITIZED
//   detail (raw provider text can carry credentials/URLs; only known-safe
//   domain errors are echoed). Checks whose loads failed are skipped —
//   empty arrays are never fabricated, so a failed provider can never
//   produce a misleading POSITIONS_MISSING / ORGANIZATION_INVALID /
//   ROOT_DEFAULT_ROUTES_PUBLISHED blocker.
// - R-A7-6: ORGANIZATION_INVALID detail = validateOrganization's own
//   domain message (ids only, safe); POSITIONS_MISSING carries the count;
//   one ROOT_DEFAULT_ROUTES_PUBLISHED blocker per zero-count phase.
import { OrganizationValidationError, validateOrganization } from './organization/assignments'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from './organization/model'

/**
 * Read-only storage port: the production ROOT-scope adapter is
 * Plan B Task 6 (R-A7-1/R-A7-2).
 *
 * ADAPTER CONTRACT for countPublishedRoutesByPhase (R-A7-4): the returned
 * numbers must count PUBLISHED route versions scoped to the company ROOT
 * default scope ONLY, one key per phase. Unit-level exception routes must
 * NEVER be counted as root defaults by this port. The counts are consumed
 * verbatim as root-scope counts; the root-only scoping itself is only
 * provable in the Plan B Task 6 adapter's own tests.
 */
export interface CleanStartReadinessDb {
  loadUnits(): Promise<OrganizationUnitNode[]>
  loadPositions(): Promise<PositionNode[]>
  loadAssignments(): Promise<AssignmentNode[]>
  loadTeams(): Promise<TeamNode[]>
  countPublishedRoutesByPhase(): Promise<Record<'REQUEST' | 'SOLUTION' | 'FINAL', number>>
}

export interface ReadinessReport {
  ready: boolean
  blockers: ReadonlyArray<{ code: string; detail: string }>
}

export const ROOT_DEFAULT_ROUTES_REQUIRED = 'ROOT_DEFAULT_ROUTES_PUBLISHED' as const

type ReadinessPhase = 'REQUEST' | 'SOLUTION' | 'FINAL'
const READINESS_PHASES: readonly ReadinessPhase[] = ['REQUEST', 'SOLUTION', 'FINAL']

type ReadinessMethod = keyof CleanStartReadinessDb

type LoadOutcome<T> = { ok: true; value: T } | { ok: false }

/**
 * Fail-closed detail for a rejected provider call: names the method, but the
 * raw error text is only echoed for known-safe domain errors. Foreign
 * provider messages (drivers, connection strings, credentials) never reach
 * the public JSON report — they get a stable generic sentence instead.
 */
function providerErrorDetail(method: ReadinessMethod | 'createDb', error: unknown): string {
  if (error instanceof OrganizationValidationError) {
    return `${method} failed: ${error.message}`
  }
  return `${method} failed (provider error; detail sanitized because the raw provider message is not a known-safe domain error)`
}

/** Reusable sanitized blocker for a provider rejection (library + CLI construction failures). */
function providerErrorBlocker(method: ReadinessMethod | 'createDb', error: unknown): { code: string; detail: string } {
  return { code: 'READINESS_PROVIDER_ERROR', detail: providerErrorDetail(method, error) }
}

async function guardedLoad<T>(
  method: ReadinessMethod,
  run: () => Promise<T>,
  blockers: Array<{ code: string; detail: string }>,
): Promise<LoadOutcome<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    blockers.push(providerErrorBlocker(method, error))
    return { ok: false }
  }
}

/** Identifying description of a malformed resolved count container. */
function describeMalformedContainer(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return `type ${typeof value}`
}

export async function verifyCleanStartReadiness(db: CleanStartReadinessDb): Promise<ReadinessReport> {
  const blockers: Array<{ code: string; detail: string }> = []

  // Each provider call is guarded independently (R-A7-5): a REJECTION
  // records exactly one blocker and returns { ok: false }, so later checks
  // see "failed load", never a fabricated empty state. A RESOLUTION — even
  // with a garbage value — is a successful load (FIX1 P1-1: resolution is
  // never the failure sentinel) and is validated by its consumer below.
  const units = await guardedLoad('loadUnits', () => db.loadUnits(), blockers)
  const positions = await guardedLoad('loadPositions', () => db.loadPositions(), blockers)
  const assignments = await guardedLoad('loadAssignments', () => db.loadAssignments(), blockers)
  const teams = await guardedLoad('loadTeams', () => db.loadTeams(), blockers)
  const counts = await guardedLoad('countPublishedRoutesByPhase', () => db.countPublishedRoutesByPhase(), blockers)

  // Blocker: organization validation failure (A3). validateOrganization runs
  // assertSingleAcyclicRoot first and wraps it as OrganizationValidationError,
  // so every malformed-tree case surfaces through the same typed error whose
  // message names offending ids — safe domain detail (R-A7-6).
  if (units.ok && positions.ok && assignments.ok && teams.ok) {
    try {
      validateOrganization(units.value, positions.value, assignments.value, teams.value)
    } catch (error) {
      const detail = error instanceof OrganizationValidationError
        ? error.message
        : 'organization validation failed with an unexpected error (detail sanitized)'
      blockers.push({ code: 'ORGANIZATION_INVALID', detail })
    }
  }

  // Blocker: fewer than two active positions. Skipped entirely when the
  // positions load failed — a failed provider must not masquerade as
  // "zero active positions" (R-A7-5).
  if (positions.ok) {
    const activePositions = positions.value.filter((position) => position.isActive).length
    if (activePositions < 2) {
      blockers.push({
        code: 'POSITIONS_MISSING',
        detail: `only ${activePositions} active position(s); at least two active positions are required`,
      })
    }
  }

  // Blockers: published root default routes per phase. The container itself
  // is validated first (FIX1 P1-1): a RESOLVED undefined/null/non-object/
  // array is one identifying container-level PUBLISHED_ROUTE_COUNTS_INVALID
  // blocker — it is not indexed (which would throw) and is not the failure
  // sentinel. Then each phase is validated and assessed for zero
  // INDEPENDENTLY (FIX1 P2-1): a malformed phase gets exactly its
  // invalid-count blocker, a well-formed zero phase still gets its
  // ROOT_DEFAULT blocker, and a malformed phase never gets a root blocker.
  // Skipped only when the counts call REJECTED (R-A7-5).
  if (counts.ok) {
    const container: unknown = counts.value
    if (container === null || typeof container !== 'object' || Array.isArray(container)) {
      blockers.push({
        code: 'PUBLISHED_ROUTE_COUNTS_INVALID',
        detail: `countPublishedRoutesByPhase resolved a malformed phase-count container (${describeMalformedContainer(container)}), not a per-phase count record`,
      })
    } else {
      const phaseCounts = container as Record<string, unknown>
      for (const phase of READINESS_PHASES) {
        const value: unknown = phaseCounts[phase]
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
          blockers.push({
            code: 'PUBLISHED_ROUTE_COUNTS_INVALID',
            detail: `published route count for phase ${phase} is not a finite non-negative integer: ${
              typeof value === 'string' ? JSON.stringify(value) : String(value)
            }`,
          })
        } else if (value === 0) {
          blockers.push({
            code: ROOT_DEFAULT_ROUTES_REQUIRED,
            detail: `no published route version for the company ROOT scope in phase ${phase}`,
          })
        }
      }
    }
  }

  return { ready: blockers.length === 0, blockers }
}
