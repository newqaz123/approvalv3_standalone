// Clean-start assignment and flat-team validation (Plan A Task 3).
// Pure validator over the A2 domain model: imports only hierarchy/model and
// nothing from the legacy organization modules. Flat teams cannot create
// cycles structurally — a team has no parent-team field — so membership is
// checked directly rather than traversed.
import { assertSingleAcyclicRoot } from './hierarchy'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from './model'

/** Fail-closed error for every organization validation rule; messages name the offending record ids. */
export class OrganizationValidationError extends Error {
  readonly code = 'ORGANIZATION_INVALID'
}

function indexById<T extends { id: string }>(kind: string, rows: readonly T[]): Map<string, T> {
  const byId = new Map<string, T>()
  for (const row of rows) {
    if (byId.has(row.id)) {
      throw new OrganizationValidationError(`duplicate ${kind} id "${row.id}"`)
    }
    byId.set(row.id, row)
  }
  return byId
}

/**
 * Validates the active organization configuration. Throws OrganizationValidationError when:
 * (1) more than one ACTIVE assignment exists for one user; (2) an active
 * assignment references an inactive/missing unit or position; (3) an active
 * unit's managerUserId has no ACTIVE assignment DIRECTLY in that unit;
 * (4) an active team's reportsToAssignmentId is not an active assignment in
 * the same unit; (5) the reports-to position rank is not strictly greater
 * than every active member's rank in that team, or the reports-to assignment
 * is itself a member (teamId === team.id); (6) an active member's teamId
 * points to a team in a different unit than the member's assignment unit;
 * (7) duplicate ACTIVE team names within one unit; (8) the units fail
 * assertSingleAcyclicRoot (wrapped so callers only see this error type).
 *
 * Inactive rows are history and are exempt only from the CURRENT-RELATIONSHIP
 * rules above (rules 1–7): an inactive assignment, unit, team, or position
 * never fails those rules, mirroring the spec's deactivate-rather-than-delete
 * model. The GLOBAL invariants still apply to every row regardless of active
 * state: rule 8's tree validation (duplicate unit ids, missing parents,
 * cycles) and the up-front duplicate position/assignment/team id rejection,
 * which keep id lookups unambiguous.
 */
export function validateOrganization(
  units: readonly OrganizationUnitNode[],
  positions: readonly PositionNode[],
  assignments: readonly AssignmentNode[],
  teams: readonly TeamNode[],
): void {
  // Rule 8 first: the unit tree underpins every unit reference below.
  let unitById: Map<string, OrganizationUnitNode>
  try {
    unitById = assertSingleAcyclicRoot(units)
  } catch (cause) {
    throw new OrganizationValidationError(`organization tree invalid: ${cause instanceof Error ? cause.message : String(cause)}`)
  }

  const positionById = indexById('position', positions)
  const assignmentById = indexById('assignment', assignments)
  const teamById = indexById('team', teams)

  // Rule 1: at most one ACTIVE assignment per user.
  const activeByUser = new Map<string, AssignmentNode>()
  for (const assignment of assignments) {
    if (!assignment.isActive) continue
    const first = activeByUser.get(assignment.userId)
    if (first !== undefined) {
      throw new OrganizationValidationError(
        `more than one active assignment for user "${assignment.userId}": "${first.id}", "${assignment.id}" — exactly one active assignment per user is allowed`,
      )
    }
    activeByUser.set(assignment.userId, assignment)
  }

  // Rule 2: an active assignment references an existing ACTIVE unit and position.
  for (const assignment of assignments) {
    if (!assignment.isActive) continue
    const unit = unitById.get(assignment.unitId)
    if (unit === undefined) {
      throw new OrganizationValidationError(`active assignment "${assignment.id}" references missing unit id "${assignment.unitId}"`)
    }
    if (!unit.isActive) {
      throw new OrganizationValidationError(`active assignment "${assignment.id}" references inactive unit "${assignment.unitId}"`)
    }
    const position = positionById.get(assignment.positionId)
    if (position === undefined) {
      throw new OrganizationValidationError(`active assignment "${assignment.id}" references missing position id "${assignment.positionId}"`)
    }
    if (!position.isActive) {
      throw new OrganizationValidationError(`active assignment "${assignment.id}" references inactive position "${assignment.positionId}"`)
    }
  }

  // Rule 3: an active unit's manager holds an ACTIVE assignment DIRECTLY in that unit.
  // Management scope is never inferred from rank; inactive units keep stale
  // managerUserId values as history and are not checked.
  for (const unit of units) {
    if (!unit.isActive || unit.managerUserId === null) continue
    const managerAssignment = activeByUser.get(unit.managerUserId)
    if (managerAssignment === undefined || managerAssignment.unitId !== unit.id) {
      const detail = managerAssignment === undefined
        ? 'the user has no active assignment'
        : `active assignment "${managerAssignment.id}" is in unit "${managerAssignment.unitId}"`
      throw new OrganizationValidationError(
        `unit "${unit.id}" manager "${unit.managerUserId}" has no active assignment directly in that unit (${detail})`,
      )
    }
  }

  // Rules 4–5: an ACTIVE team's reports-to is an ACTIVE assignment in the same
  // unit, outside the membership, ranked strictly above every active member.
  for (const team of teams) {
    if (!team.isActive) continue
    const reportsTo = assignmentById.get(team.reportsToAssignmentId)
    if (reportsTo === undefined) {
      throw new OrganizationValidationError(
        `team "${team.id}" (unit "${team.unitId}") reports-to references missing assignment id "${team.reportsToAssignmentId}"`,
      )
    }
    if (!reportsTo.isActive) {
      throw new OrganizationValidationError(
        `team "${team.id}" (unit "${team.unitId}") reports-to assignment "${reportsTo.id}" is inactive; reports-to must be an active assignment in unit "${team.unitId}"`,
      )
    }
    if (reportsTo.unitId !== team.unitId) {
      throw new OrganizationValidationError(
        `team "${team.id}" (unit "${team.unitId}") reports-to assignment "${reportsTo.id}" is active in unit "${reportsTo.unitId}", not in unit "${team.unitId}"`,
      )
    }
    if (reportsTo.teamId === team.id) {
      throw new OrganizationValidationError(
        `team "${team.id}" (unit "${team.unitId}") reports-to assignment "${reportsTo.id}" is itself an active member of the team; reports-to rank must be strictly above every active member rank`,
      )
    }
    // Rule 2 already guarantees every active assignment's position exists.
    const reportsToRank = positionById.get(reportsTo.positionId)!.rank
    for (const member of assignments) {
      if (!member.isActive || member.teamId !== team.id) continue
      const memberRank = positionById.get(member.positionId)!.rank
      if (reportsToRank <= memberRank) {
        throw new OrganizationValidationError(
          `team "${team.id}" (unit "${team.unitId}") reports-to assignment "${reportsTo.id}" (position "${reportsTo.positionId}" rank ${reportsToRank}) `
          + `is not strictly above active member assignment "${member.id}" (position "${member.positionId}" rank ${memberRank}); `
          + `reports-to rank must be strictly above every active member rank`,
        )
      }
    }
  }

  // Rule 6: an ACTIVE membership points at an ACTIVE team in the member's own unit.
  for (const assignment of assignments) {
    if (!assignment.isActive || assignment.teamId === null) continue
    const team = teamById.get(assignment.teamId)
    if (team === undefined) {
      throw new OrganizationValidationError(
        `active assignment "${assignment.id}" (unit "${assignment.unitId}") references missing team id "${assignment.teamId}"`,
      )
    }
    if (!team.isActive) {
      throw new OrganizationValidationError(
        `active assignment "${assignment.id}" (unit "${assignment.unitId}") references inactive team "${team.id}" (unit "${team.unitId}"); active membership requires an active team`,
      )
    }
    if (team.unitId !== assignment.unitId) {
      throw new OrganizationValidationError(
        `active assignment "${assignment.id}" (unit "${assignment.unitId}") is a member of team "${team.id}" in unit "${team.unitId}"; `
        + `team membership must stay within the member's own unit`,
      )
    }
  }

  // Rule 7: ACTIVE team names are unique within one unit (exact name match).
  const teamIdByNameByUnit = new Map<string, Map<string, TeamNode>>()
  for (const team of teams) {
    if (!team.isActive) continue
    let byName = teamIdByNameByUnit.get(team.unitId)
    if (byName === undefined) {
      byName = new Map<string, TeamNode>()
      teamIdByNameByUnit.set(team.unitId, byName)
    }
    const existing = byName.get(team.name)
    if (existing !== undefined) {
      throw new OrganizationValidationError(
        `duplicate team name "${team.name}" among active teams in unit "${team.unitId}": teams "${existing.id}", "${team.id}"`,
      )
    }
    byName.set(team.name, team)
  }
}
