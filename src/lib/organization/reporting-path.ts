// Clean-start reporting path resolution — option A, owner-confirmed
// (Plan A Task 6; spec item 2). Pure structural module over a plain
// repository port: NO Prisma import, NO database access, no server-only
// dependencies — any storage satisfying the shape can back it. The
// production adapter is built in Plan B Task 6.
//
// Option A semantics (owner-confirmed):
// - UNGROUPED person: own-unit manager, then each ancestor-unit manager.
//   Other ungrouped coworkers are never candidates.
// - TEAM member: the team's explicit reports-to person, then the own-unit
//   manager (INCLUDED even when different from the reports-to person), then
//   each ancestor-unit manager. Deduplicated by userId, preserving the first
//   occurrence's kind, so nobody appears twice. The origin never appears in
//   their own path.
// - Own-team exact-position members are NOT path steps: they enter approval
//   candidate selection in Plan B Task 3, mirroring the spec's "eligible
//   exact-position members of their own team" clause.
//
// Parent A6 rulings (recorded in the SDD ledger before implementation):
// - R-A6-1: inactive ancestor units are RETAINED in unitPath but contribute
//   no manager step; the walk continues to active ancestors. A stale
//   managerUserId on an inactive unit is never resolved through that user's
//   live assignment in a different unit (no misattribution).
// - R-A6-2: steps carry ACTIVE assignments only; the repository's findUser
//   is the ORIGIN activity gate and there is NO per-step account fan-out.
//   This path is structural, NOT candidate eligibility or authorization.
//   Plan B Task 3/4 obligation: inactive or missing accounts must never
//   become actionable approval candidates and must never be silently
//   replaced — candidate construction and action-time checks enforce that.
// - An active unit with a null managerUserId contributes no step; the walk
//   continues (vacant step, decided by candidate selection).
//
// Null contracts and precedence (fail closed):
// - findUser returns null or an inactive user → null, BEFORE any load or
//   validation (origin gate short-circuit).
// - Otherwise the full organization loads and validates in the literal plan
//   order: assertSingleAcyclicRoot first (raw hierarchy errors: duplicate
//   unit ids, missing parents, cycles, root count), then validateOrganization
//   (typed OrganizationValidationError for assignment/team rules).
// - Only after validation: an origin with no active assignment → null, so
//   corrupt state surfaces instead of masking itself as "unassigned".
import { ancestorUnitIds, assertSingleAcyclicRoot } from './hierarchy'
import { validateOrganization } from './assignments'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, ReportingPath, ReportingPathStep, TeamNode } from './model'

/** Structural storage port (no Prisma): the production adapter is Plan B Task 6. */
export interface ReportingPathRepository {
  findUser(userId: string): Promise<{ id: string; isActive: boolean } | null>
  loadUnits(): Promise<OrganizationUnitNode[]>
  loadPositions(): Promise<PositionNode[]>
  loadAssignments(): Promise<AssignmentNode[]>
  loadTeams(): Promise<TeamNode[]>
}

export async function resolveReportingPath(userId: string, db: ReportingPathRepository): Promise<ReportingPath | null> {
  // Origin activity gate: missing or inactive users short-circuit to null
  // before any organization data is loaded or validated.
  const user = await db.findUser(userId)
  if (user === null || !user.isActive) return null

  const units = await db.loadUnits()
  const positions = await db.loadPositions()
  const assignments = await db.loadAssignments()
  const teams = await db.loadTeams()

  // Fail closed on an inconsistent current organization: raw tree errors
  // first (duplicates/parents/cycles/root count), then the typed assignment
  // and team rules. A path is never returned from unvalidated state.
  assertSingleAcyclicRoot(units)
  validateOrganization(units, positions, assignments, teams)

  // One active assignment per user is guaranteed by validation; the
  // first-match lookup below cannot be ambiguous.
  const origin = assignments.find((candidate) => candidate.isActive && candidate.userId === userId)
  if (origin === undefined) return null

  const unitById = new Map(units.map((unit) => [unit.id, unit] as const))
  const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment] as const))
  const activeAssignmentByUser = new Map<string, AssignmentNode>()
  for (const assignment of assignments) {
    if (assignment.isActive && !activeAssignmentByUser.has(assignment.userId)) {
      activeAssignmentByUser.set(assignment.userId, assignment)
    }
  }

  const steps: ReportingPathStep[] = []
  // The origin never appears in their own path; later occurrences of a user
  // are dropped (first kind wins).
  const seenUserIds = new Set<string>([userId])
  const pushStep = (step: ReportingPathStep): void => {
    if (seenUserIds.has(step.userId)) return
    seenUserIds.add(step.userId)
    steps.push(step)
  }

  if (origin.teamId !== null) {
    // Validation guarantees the team is active, in the origin's unit, with an
    // active same-unit reports-to assignment outside the membership; the
    // lookups below cannot miss on validated state.
    const team = teams.find((candidate) => candidate.id === origin.teamId)
    const reportsTo = team === undefined ? undefined : assignmentById.get(team.reportsToAssignmentId)
    if (team !== undefined && reportsTo !== undefined) {
      pushStep({
        kind: 'TEAM_REPORTS_TO',
        unitId: team.unitId,
        assignmentId: reportsTo.id,
        userId: reportsTo.userId,
        positionId: reportsTo.positionId,
      })
    }
  }

  const unitPath = ancestorUnitIds(units, origin.unitId)
  for (const unitId of unitPath) {
    const unit = unitById.get(unitId)
    if (unit === undefined) continue // unreachable on validated state (defensive)
    // R-A6-1: inactive units keep stale manager refs as history — skipped,
    // never resolved through a live assignment elsewhere. A null manager on
    // an active unit is a vacant step, not an error.
    if (!unit.isActive || unit.managerUserId === null) continue
    // Rule 3 guarantees the manager's active assignment sits directly in this
    // active unit; the guards below are defensive only.
    const managerAssignment = activeAssignmentByUser.get(unit.managerUserId)
    if (managerAssignment === undefined || managerAssignment.unitId !== unit.id) continue
    pushStep({
      kind: 'UNIT_MANAGER',
      unitId: unit.id,
      assignmentId: managerAssignment.id,
      userId: unit.managerUserId,
      positionId: managerAssignment.positionId,
    })
  }

  return {
    originUserId: userId,
    assignmentId: origin.id,
    unitId: origin.unitId,
    positionId: origin.positionId,
    teamId: origin.teamId,
    unitPath,
    steps,
  }
}

export async function loadUserOrganizationContext(
  userId: string,
  db: ReportingPathRepository,
): Promise<{ userId: string; path: ReportingPath } | null> {
  const path = await resolveReportingPath(userId, db)
  return path === null ? null : { userId, path }
}
