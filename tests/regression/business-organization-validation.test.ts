import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateOrganization } from '@/lib/organization/assignments'
import { resolveReportingPath, type ReportingPathRepository } from '@/lib/organization/reporting-path'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import {
  BUSINESS_POSITIONS,
  BUSINESS_UNITS,
  createBusinessWorkflowFixture,
} from '../support/business-workflow-fixture'
import { buildBusinessSeedPlan } from '../support/native/seed-business-fixture-plan'

/**
 * Regression: the SEEDED business-workflow graph must satisfy the REAL
 * production organization validator and reporting-path resolver.
 *
 * Background: the first native e2e run failed for requesterA/supervisorP with
 * `team "team-sibling" (unit "unit-sibling-section") reports-to assignment
 * "assignment-department-manager" active in unit "unit-production-1", not
 * same unit` — the seed pointed a team at a cross-unit anchor, which the real
 * validateOrganization (Rule 4) rejects, and the mocked Engineering path
 * faked a Department-manager step on unit-company that resolveReportingPath
 * can never produce. These tests lock the fixed state by replaying the seed
 * plan exactly as the database would hold it (including the post-team teamId
 * backfill) and running the unmodified production modules over it.
 */

const fixture = createBusinessWorkflowFixture()

/** Rebuilds the exact post-seed graph rows (FK-safe plan replay, no database). */
function seededGraph(): {
  units: OrganizationUnitNode[]
  positions: PositionNode[]
  assignments: AssignmentNode[]
  teams: TeamNode[]
} {
  const plan = buildBusinessSeedPlan(fixture, { passwordHash: 'synthetic-hash-not-a-real-credential' })
  const units: OrganizationUnitNode[] = []
  const positions: PositionNode[] = []
  const assignmentsById = new Map<string, AssignmentNode>()
  const teams: TeamNode[] = []
  for (const step of plan.steps) {
    switch (step.table) {
      case 'positions':
        positions.push({ ...step.data })
        break
      case 'organization_units':
        units.push({ ...step.data })
        break
      case 'organization_assignments':
        // INSERT omits the nullable teamId (FK cycle resolution).
        assignmentsById.set(step.data.id, { ...step.data, teamId: null })
        break
      case 'teams':
        teams.push({ ...step.data })
        break
    }
  }
  // Post-team backfill: organization_assignments.teamId gets its final value.
  for (const update of plan.teamUpdates) {
    const assignment = assignmentsById.get(update.assignmentId)
    assert.ok(assignment, `teamId backfill references unknown assignment ${update.assignmentId}`)
    assignmentsById.set(update.assignmentId, { ...assignment, teamId: update.teamId })
  }
  return { units, positions, assignments: [...assignmentsById.values()], teams }
}

const graph = seededGraph()

function repository(): ReportingPathRepository {
  const activeByUserId = new Map<string, boolean>()
  for (const actor of Object.values(fixture.actors)) {
    activeByUserId.set(actor.id, actor.isActive)
  }
  return {
    async findUser(userId: string) {
      return activeByUserId.has(userId) ? { id: userId, isActive: activeByUserId.get(userId) === true } : null
    },
    async loadUnits() {
      return graph.units
    },
    async loadPositions() {
      return graph.positions
    },
    async loadAssignments() {
      return graph.assignments
    },
    async loadTeams() {
      return graph.teams
    },
  }
}

describe('business seed graph satisfies the real production validator', () => {
  it('validateOrganization accepts the full seeded data (units, positions, assignments, teams)', () => {
    // Throws OrganizationValidationError naming the offending record ids on
    // any violation; returning undefined is the pass condition.
    assert.equal(
      validateOrganization(graph.units, graph.positions, graph.assignments, graph.teams),
      undefined,
    )
  })

  it('every team reports to an ACTIVE assignment in its OWN unit with strictly greater rank (Rules 4–5)', () => {
    const positionById = new Map(graph.positions.map((position) => [position.id, position] as const))
    const assignmentById = new Map(graph.assignments.map((assignment) => [assignment.id, assignment] as const))
    for (const team of graph.teams) {
      const reportsTo = assignmentById.get(team.reportsToAssignmentId)
      assert.ok(reportsTo, `team ${team.id} reports-to must exist`)
      assert.equal(reportsTo.isActive, true, `team ${team.id} reports-to must be active`)
      assert.equal(reportsTo.unitId, team.unitId, `team ${team.id} reports-to must sit in the same unit`)
      const reportsToRank = positionById.get(reportsTo.positionId)!.rank
      for (const member of graph.assignments) {
        if (!member.isActive || member.teamId !== team.id) continue
        assert.ok(
          reportsToRank > positionById.get(member.positionId)!.rank,
          `team ${team.id} reports-to rank must exceed member ${member.id}`,
        )
      }
    }
  })
})

describe('business seed graph reproduces the fixture paths via the real resolveReportingPath', () => {
  const db = repository()

  // staffVacantAll now resolves through a REAL isolated branch (T18C2):
  // the only step is the team's reports-to anchor, whose dedicated position
  // matches no published route step, so every chain step stays vacant.
  for (const actorName of ['requesterA', 'supervisorP', 'engineerA', 'staffVacantSup', 'staffVacantAll'] as const) {
    it(`real resolution for ${actorName} deep-equals the fixture path`, async () => {
      const expected = fixture.paths[actorName]
      const actual = await resolveReportingPath(expected.originUserId, db)
      assert.deepEqual(actual, expected)
    })
  }

  it('the Department manager sits on BOTH the Production requester and Engineering solution legitimate parent paths', async () => {
    const departmentStep = {
      kind: 'UNIT_MANAGER' as const,
      unitId: BUSINESS_UNITS.production,
      assignmentId: 'assignment-department-manager',
      userId: 'user-department-manager',
      positionId: BUSINESS_POSITIONS.departmentManager,
    }
    const requesterPath = await resolveReportingPath(fixture.paths.requesterA.originUserId, db)
    const engineerPath = await resolveReportingPath(fixture.paths.engineerA.originUserId, db)
    for (const [label, path] of [['requesterA', requesterPath], ['engineerA', engineerPath]] as const) {
      assert.ok(path, `${label} path must resolve`)
      assert.ok(
        path.unitPath.includes(BUSINESS_UNITS.production),
        `${label} unit path must climb through the common parent department (Production 1)`,
      )
      assert.ok(
        path.steps.some((step) =>
          step.kind === 'UNIT_MANAGER'
          && step.unitId === departmentStep.unitId
          && step.assignmentId === departmentStep.assignmentId
          && step.userId === departmentStep.userId
          && step.positionId === departmentStep.positionId),
        `${label} real path must contain the Department manager UNIT_MANAGER step on Production 1`,
      )
    }
  })

  it('origin gates: the inactive user short-circuits to null and the unassigned user has no path', async () => {
    assert.equal(await resolveReportingPath(fixture.actors.inactiveUser.id, db), null)
    assert.equal(await resolveReportingPath(fixture.actors.unassignedUser.id, db), null)
  })

  it('the T18C2 vacancy anchor is an explicit test-only structural anchor, never a workflow candidate', async () => {
    const db = repository()
    const anchor = fixture.actors.vacancyAnchor
    assert.ok(anchor.assignment)
    assert.equal(anchor.assignment.teamId, null, 'the anchor joins no team, so it is never an own-team candidate')
    assert.equal(anchor.assignment.unitId, BUSINESS_UNITS.vacancyBranch)
    assert.equal(anchor.assignment.isActive, true)
    assert.equal(anchor.assignment.positionId, BUSINESS_POSITIONS.vacancyAnchor)
    // Not on any other workflow origin's real reporting path.
    for (const originName of ['requesterA', 'supervisorP', 'engineerA', 'staffVacantSup'] as const) {
      const path = await resolveReportingPath(fixture.paths[originName].originUserId, db)
      assert.ok(path)
      assert.equal(
        path.steps.some((step) => step.userId === anchor.id),
        false,
        `${originName} real path must not include the structural anchor`,
      )
    }
    // Rule 5 anchor rank strictly above the only team member (staffVacantAll,
    // staff rank 1) — yet the anchor's position matches NO published route
    // step position, which is what keeps all three REQUEST steps vacant
    // despite the anchor being a valid higher-rank same-unit holder.
    const positionById = new Map(graph.positions.map((position) => [position.id, position] as const))
    const anchorRank = positionById.get(BUSINESS_POSITIONS.vacancyAnchor)!.rank
    const staffRank = positionById.get(BUSINESS_POSITIONS.staff)!.rank
    assert.ok(anchorRank > staffRank, 'anchor rank must strictly exceed the staff member rank (Rule 5)')
    const stepPositionIds = new Set(
      Object.values(fixture.routeConfigurations)
        .flatMap((configuration) => configuration.routes)
        .flatMap((route) => route.steps.map((step) => step.positionId)),
    )
    assert.equal(
      stepPositionIds.has(BUSINESS_POSITIONS.vacancyAnchor),
      false,
      'the anchor position must never match a published route step position',
    )
    // Origin rank strictly below the limit rank: the plan engine shortcuts
    // to AUTO_APPROVED only when originRank >= limitRank, so the all-vacant
    // branch reaches the per-step vacancy path instead (proven in
    // business-workflow-preparation.test.ts via the real engine).
    assert.ok(
      staffRank < positionById.get(BUSINESS_POSITIONS.departmentManager)!.rank,
      'origin rank must stay below the limit rank (no AUTO_APPROVED shortcut)',
    )
  })

  it('the isolated vacancy branch is a managerless non-sharing unit directly under the company root', () => {
    const byId = new Map(graph.units.map((unit) => [unit.id, unit] as const))
    const branch = byId.get(BUSINESS_UNITS.vacancyBranch)
    assert.ok(branch, `${BUSINESS_UNITS.vacancyBranch} exists`)
    assert.equal(branch.parentId, BUSINESS_UNITS.company)
    assert.equal(branch.managerUserId, null, 'the vacancy branch unit has no manager (ancestor contributes no step)')
    assert.equal(branch.shareRequests, false)
    assert.equal(branch.canWorkOnSolutions, false)
    assert.equal(branch.isActive, true)
    // Isolation: no other fixture unit nests inside the vacancy branch.
    assert.equal(
      graph.units.filter((unit) => unit.parentId === BUSINESS_UNITS.vacancyBranch).length,
      0,
    )
  })
})

describe('fixture structural constraints stay intact after the reporting-link fix', () => {
  it('no Director position exists (department ceiling) and sections keep their rights', () => {
    assert.equal(graph.positions.some((position) => position.name === 'Director'), false)
    const byId = new Map(graph.units.map((unit) => [unit.id, unit] as const))
    for (const sectionId of [BUSINESS_UNITS.productionSection, BUSINESS_UNITS.siblingSection]) {
      const section = byId.get(sectionId)
      assert.ok(section, `${sectionId} exists`)
      assert.equal(section.shareRequests, true, `${sectionId} keeps its own sharing scope`)
      assert.equal(section.isActive, true)
    }
    // The Engineering units OPT OUT of own sharing so Engineering members
    // inherit the Production 1 sharing scope and can view Production 1
    // Section requests (required for the T03/T04 positive solution flows).
    // Request-creation rights are assignment-based (canSubmitRequests), not
    // sharing-based: every section keeps them via active assignments.
    for (const unitId of [BUSINESS_UNITS.engineering, BUSINESS_UNITS.engineeringSection]) {
      const engineeringUnit = byId.get(unitId)
      assert.ok(engineeringUnit, `${unitId} exists`)
      assert.equal(engineeringUnit.shareRequests, false, `${unitId} inherits the Production 1 sharing scope`)
      assert.equal(engineeringUnit.isActive, true)
    }
  })

  it('solution capability stays Engineering-only', () => {
    const byId = new Map(graph.units.map((unit) => [unit.id, unit] as const))
    const solutionUnits = graph.units.filter((unit) => unit.canWorkOnSolutions).map((unit) => unit.id).sort()
    assert.deepEqual(solutionUnits, [BUSINESS_UNITS.engineering, BUSINESS_UNITS.engineeringSection])
    assert.equal(byId.get(BUSINESS_UNITS.productionSection)!.canWorkOnSolutions, false)
    assert.equal(byId.get(BUSINESS_UNITS.production)!.canWorkOnSolutions, false)
  })

  it('the sibling supervisor anchor is an explicit test-only structural anchor, never a workflow candidate', async () => {
    const db = repository()
    const anchor = fixture.actors.siblingSupervisor
    assert.ok(anchor.assignment)
    assert.equal(anchor.assignment.teamId, null, 'the anchor joins no team, so it is never an own-team candidate')
    assert.equal(anchor.assignment.unitId, BUSINESS_UNITS.siblingSection)
    // Not on any workflow origin's real reporting path.
    for (const originName of ['requesterA', 'supervisorP', 'engineerA', 'staffVacantSup'] as const) {
      const path = await resolveReportingPath(fixture.paths[originName].originUserId, db)
      assert.ok(path)
      assert.equal(
        path.steps.some((step) => step.userId === anchor.id),
        false,
        `${originName} real path must not include the structural anchor`,
      )
    }
  })

  it('distinct Staff/Supervisor workflow actors keep their separate accounts and teams', () => {
    assert.equal(fixture.actors.requesterA.assignment!.positionId, BUSINESS_POSITIONS.staff)
    assert.equal(fixture.actors.supervisorP.assignment!.positionId, BUSINESS_POSITIONS.supervisor)
    assert.equal(fixture.actors.engineerA.assignment!.positionId, BUSINESS_POSITIONS.staff)
    assert.equal(fixture.actors.supervisorE.assignment!.positionId, BUSINESS_POSITIONS.supervisor)
    assert.notEqual(fixture.actors.supervisorP.id, fixture.actors.supervisorE.id)
  })
})
