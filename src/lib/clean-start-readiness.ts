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

/**
 * Fail-closed detail for a rejected provider call: names the method, but the
 * raw error text is only echoed for known-safe domain errors. Foreign
 * provider messages (drivers, connection strings, credentials) never reach
 * the public JSON report — they get a stable generic sentence instead.
 */
function providerErrorDetail(method: ReadinessMethod, error: unknown): string {
  if (error instanceof OrganizationValidationError) {
    return `${method} failed: ${error.message}`
  }
  return `${method} failed (provider error; detail sanitized because the raw provider message is not a known-safe domain error)`
}

async function guardedLoad<T>(
  method: ReadinessMethod,
  run: () => Promise<T>,
  blockers: Array<{ code: string; detail: string }>,
): Promise<T | undefined> {
  try {
    return await run()
  } catch (error) {
    blockers.push({ code: 'READINESS_PROVIDER_ERROR', detail: providerErrorDetail(method, error) })
    return undefined
  }
}

export async function verifyCleanStartReadiness(db: CleanStartReadinessDb): Promise<ReadinessReport> {
  const blockers: Array<{ code: string; detail: string }> = []

  // Each provider call is guarded independently (R-A7-5): one rejection
  // records exactly one blocker and returns undefined, so later checks see
  // "unknown", never a fabricated empty state.
  const units = await guardedLoad('loadUnits', () => db.loadUnits(), blockers)
  const positions = await guardedLoad('loadPositions', () => db.loadPositions(), blockers)
  const assignments = await guardedLoad('loadAssignments', () => db.loadAssignments(), blockers)
  const teams = await guardedLoad('loadTeams', () => db.loadTeams(), blockers)
  const counts = await guardedLoad('countPublishedRoutesByPhase', () => db.countPublishedRoutesByPhase(), blockers)

  // Blocker: organization validation failure (A3). validateOrganization runs
  // assertSingleAcyclicRoot first and wraps it as OrganizationValidationError,
  // so every malformed-tree case surfaces through the same typed error whose
  // message names offending ids — safe domain detail (R-A7-6).
  if (units !== undefined && positions !== undefined && assignments !== undefined && teams !== undefined) {
    try {
      validateOrganization(units, positions, assignments, teams)
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
  if (positions !== undefined) {
    const activePositions = positions.filter((position) => position.isActive).length
    if (activePositions < 2) {
      blockers.push({
        code: 'POSITIONS_MISSING',
        detail: `only ${activePositions} active position(s); at least two active positions are required`,
      })
    }
  }

  // Blockers: published root default routes per phase. Malformed counts are
  // fail-closed (R-A7-3) and a malformed phase never additionally emits a
  // ROOT_DEFAULT blocker — "unreadable" is not "known zero". Skipped when the
  // counts call failed (R-A7-5).
  if (counts !== undefined) {
    let countsAreWellFormed = true
    for (const phase of READINESS_PHASES) {
      const value: unknown = (counts as Record<string, unknown>)[phase]
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        countsAreWellFormed = false
        blockers.push({
          code: 'PUBLISHED_ROUTE_COUNTS_INVALID',
          detail: `published route count for phase ${phase} is not a finite non-negative integer: ${
            typeof value === 'string' ? JSON.stringify(value) : String(value)
          }`,
        })
      }
    }
    if (countsAreWellFormed) {
      const phaseCounts = counts as Record<ReadinessPhase, number>
      for (const phase of READINESS_PHASES) {
        if (phaseCounts[phase] === 0) {
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
