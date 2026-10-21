import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBusinessSeedPlan,
  type BusinessSeedStep,
} from '../support/native/seed-business-fixture-plan'
import {
  BUSINESS_UNITS,
  createBusinessWorkflowFixture,
  type BusinessWorkflowFixture,
} from '../support/business-workflow-fixture'

/**
 * Regression coverage for the native seed's insertion ordering
 * (seed-business-fixture.ts executes the plan built by
 * seed-business-fixture-plan.ts).
 *
 * Background: `prisma db push` creates NOT DEFERRABLE foreign keys, so every
 * INSERT is FK-checked immediately — inside the seed's `$transaction` too.
 * The seed used to create organization_units (managerUserId → users.id)
 * BEFORE users and teams (reportsToAssignmentId → organization_assignments.id,
 * required) BEFORE assignments, which made any real seed run fail on the very
 * first forward reference. These tests lock the corrected semantics:
 *
 *  - every FK reference in the plan resolves to a row inserted EARLIER
 *    (verified against an independent encoding of the schema's FK graph,
 *    mirroring prisma/schema.prisma);
 *  - the teams ⇄ organization_assignments cycle is resolved via the nullable
 *    teamId: assignment INSERTs omit it and a post-team UPDATE backfills it;
 *  - the exact confirmed actors/units/teams business mapping is preserved
 *    (unit managers, team reportsTo anchors, user roles/emails).
 */

type SeedTable = BusinessSeedStep['table']

/** FK edges as declared in prisma/schema.prisma (column → referenced table). */
const FK_REFERENCES: Record<SeedTable, Partial<Record<string, SeedTable>>> = {
  positions: {},
  users: {},
  organization_units: { parentId: 'organization_units', managerUserId: 'users' },
  company_settings: { rootUnitId: 'organization_units' },
  organization_assignments: {
    userId: 'users',
    unitId: 'organization_units',
    positionId: 'positions',
    teamId: 'teams',
  },
  teams: { unitId: 'organization_units', reportsToAssignmentId: 'organization_assignments' },
}

interface FkViolation {
  table: SeedTable
  column: string
  value: string
  references: SeedTable
  stepIndex: number
}

/**
 * Replays the plan exactly like PostgreSQL would: rows become visible to FK
 * checks only when INSERTed, and each non-null FK column must point at an
 * already-inserted row of the referenced table. Team backfill updates run
 * after every INSERT.
 */
function replayPlanForFkViolations(
  steps: readonly BusinessSeedStep[],
  teamUpdates: readonly { assignmentId: string; teamId: string }[],
): FkViolation[] {
  const inserted: Record<SeedTable, Set<string>> = {
    positions: new Set(),
    users: new Set(),
    organization_units: new Set(),
    company_settings: new Set(),
    organization_assignments: new Set(),
    teams: new Set(),
  }
  const violations: FkViolation[] = []
  steps.forEach((step, stepIndex) => {
    inserted[step.table].add(step.data.id)
    const fkMap = FK_REFERENCES[step.table]
    for (const [column, references] of Object.entries(fkMap)) {
      if (!references) continue
      const value = (step.data as unknown as Record<string, unknown>)[column]
      if (value === null || value === undefined) continue
      if (!inserted[references].has(String(value))) {
        violations.push({ table: step.table, column, value: String(value), references, stepIndex })
      }
    }
  })
  for (const update of teamUpdates) {
    if (!inserted.teams.has(update.teamId)) {
      violations.push({ table: 'organization_assignments', column: 'teamId', value: update.teamId, references: 'teams', stepIndex: -1 })
    }
    if (!inserted.organization_assignments.has(update.assignmentId)) {
      violations.push({ table: 'organization_assignments', column: 'id', value: update.assignmentId, references: 'organization_assignments', stepIndex: -1 })
    }
  }
  return violations
}

function planFor(fixture: BusinessWorkflowFixture) {
  return buildBusinessSeedPlan(fixture, { passwordHash: 'synthetic-hash-not-a-real-credential' })
}

const fixture = createBusinessWorkflowFixture()
const plan = planFor(fixture)

describe('native seed plan: FK-safe insertion order', () => {
  it('every FK reference resolves to a row inserted earlier (no forward references)', () => {
    const violations = replayPlanForFkViolations(plan.steps, plan.teamUpdates)
    assert.deepEqual(
      violations,
      [],
      `plan must not forward-reference any non-deferrable FK; violations: ${JSON.stringify(violations)}`,
    )
  })

  it('the FK replayer actually catches forward references (guard against a vacuous checker)', () => {
    // Simulates the OLD buggy order: a unit whose managerUserId references a
    // user that has not been inserted yet (users came after units).
    const managerUserId = 'user-department-manager'
    const badSteps: BusinessSeedStep[] = [
      { table: 'organization_units', data: { id: BUSINESS_UNITS.production, name: 'Production 1', parentId: BUSINESS_UNITS.company, isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId } },
    ]
    const violations = replayPlanForFkViolations(badSteps, [])
    assert.ok(violations.length >= 1, 'checker must flag the forward reference')
    const managerViolation = violations.find((violation) => violation.column === 'managerUserId')
    assert.ok(managerViolation, 'checker must flag managerUserId pointing at a not-yet-inserted user')
    assert.equal(managerViolation.references, 'users')
  })

  it('assignment INSERTs omit the nullable teamId; it is only backfilled via post-team UPDATEs', () => {
    const assignmentSteps = plan.steps.filter((step) => step.table === 'organization_assignments')
    assert.ok(assignmentSteps.length > 0)
    for (const step of assignmentSteps) {
      assert.equal('teamId' in step.data, false, `assignment ${step.data.id} must not set teamId at INSERT time`)
    }
    const teamInsertIndex = plan.steps.map((step) => step.table).lastIndexOf('teams')
    assert.ok(teamInsertIndex > -1, 'plan must create teams')
    assert.ok(
      plan.teamUpdates.length > 0,
      'fixture has assignments with a teamId, so the backfill must be non-empty',
    )
    // Every backfilled teamId references a team created by the plan.
    const teamIds = new Set(
      plan.steps.filter((step) => step.table === 'teams').map((step) => step.data.id),
    )
    for (const update of plan.teamUpdates) {
      assert.ok(teamIds.has(update.teamId), `update references unknown team ${update.teamId}`)
    }
  })

  it('inserts users before any unit with a manager, and assignments before teams', () => {
    const tableSequence = plan.steps.map((step) => step.table)
    const lastUsers = tableSequence.lastIndexOf('users')
    const firstManagedUnit = plan.steps.findIndex(
      (step) => step.table === 'organization_units' && step.data.managerUserId !== null,
    )
    assert.ok(firstManagedUnit > -1, 'fixture units must have managers')
    assert.ok(lastUsers < firstManagedUnit, 'all users must be inserted before the first managed unit')

    const lastAssignment = tableSequence.lastIndexOf('organization_assignments')
    const firstTeam = tableSequence.indexOf('teams')
    assert.ok(firstTeam > -1, 'plan must create teams')
    assert.ok(lastAssignment < firstTeam, 'all assignments must be inserted before the first team')
  })
})

describe('native seed plan: confirmed business mapping preserved', () => {
  it('unit managers match the confirmed mapping (root/manager-less units stay null)', () => {
    const managerByUnit: Record<string, string | null> = {}
    for (const step of plan.steps) {
      if (step.table === 'organization_units') managerByUnit[step.data.id] = step.data.managerUserId
    }
    assert.deepEqual(managerByUnit, {
      [BUSINESS_UNITS.company]: null,
      [BUSINESS_UNITS.production]: 'user-department-manager',
      [BUSINESS_UNITS.productionSection]: 'user-section-manager-p',
      [BUSINESS_UNITS.engineering]: null,
      [BUSINESS_UNITS.engineeringSection]: 'user-section-manager-e',
      [BUSINESS_UNITS.siblingSection]: null,
      // T18C2 isolated branch: deliberately managerless so the ancestor walk
      // contributes no UNIT_MANAGER step (all-vacant chain comes only from
      // exact-position mismatch, never from a missing manager).
      [BUSINESS_UNITS.vacancyBranch]: null,
    })
  })

  it('team reportsTo anchors match the confirmed mapping', () => {
    const reportsToByTeam: Record<string, string> = {}
    for (const step of plan.steps) {
      if (step.table === 'teams') reportsToByTeam[step.data.id] = step.data.reportsToAssignmentId
    }
    assert.deepEqual(reportsToByTeam, {
      'team-production': 'assignment-section-manager-p',
      'team-engineering': 'assignment-section-manager-e',
      // Same-unit anchor required by validateOrganization Rule 4: the old
      // 'assignment-department-manager' link (active in unit-production-1)
      // made the seeded graph invalid for team-sibling in unit-sibling-section.
      'team-sibling': 'assignment-supervisor-sibling',
      'team-production-vacant-sup': 'assignment-section-manager-p',
      // T18C2 isolated branch: staffVacantAll moved to unit-vacancy-branch /
      // team-vacancy-branch, whose reports-to is the dedicated same-unit
      // anchor on position-vacancy-anchor (rank above staff, matches no
      // route step position).
      'team-vacancy-branch': 'assignment-vacancy-anchor',
    })
  })

  it('user rows preserve ids, emails, roles and active flags of the confirmed actors', () => {
    const users = plan.steps
      .filter((step): step is Extract<BusinessSeedStep, { table: 'users' }> => step.table === 'users')
      .map((step) => step.data)
    assert.equal(users.length, Object.keys(fixture.actors).length)
    const byId = new Map(users.map((user) => [user.id, user]))
    for (const actor of Object.values(fixture.actors)) {
      const user = byId.get(actor.id)
      assert.ok(user, `user row for ${actor.id} must exist`)
      assert.equal(user.email, `${actor.id}@business.test`)
      assert.equal(user.isActive, actor.isActive)
      assert.equal(user.forcePasswordChange, false)
      assert.equal(user.passwordHash, 'synthetic-hash-not-a-real-credential')
    }
    assert.equal(byId.get('user-admin')?.role, 'admin')
    assert.equal(byId.get('user-engineer-a')?.role, 'engineering')
    assert.equal(byId.get('user-supervisor-e')?.role, 'engineering')
    assert.equal(byId.get('user-section-manager-e')?.role, 'engineering')
    assert.equal(byId.get('user-requester-a')?.role, 'general_dept')
    assert.equal(byId.get('user-inactive')?.isActive, false)
  })

  it('assignments preserve fixture rows exactly (id/user/unit/position/active), with deactivatedAt for inactive ones', () => {
    const assignmentRows = plan.steps
      .filter((step): step is Extract<BusinessSeedStep, { table: 'organization_assignments' }> => step.table === 'organization_assignments')
      .map((step) => step.data)
    const fixtureAssignments = Object.values(fixture.actors)
      .map((actor) => actor.assignment)
      .filter((assignment): assignment is NonNullable<typeof assignment> => assignment !== null)
    assert.equal(assignmentRows.length, fixtureAssignments.length)
    const byId = new Map(assignmentRows.map((row) => [row.id, row]))
    for (const assignment of fixtureAssignments) {
      const row = byId.get(assignment.id)
      assert.ok(row, `assignment row for ${assignment.id} must exist`)
      assert.equal(row.userId, assignment.userId)
      assert.equal(row.unitId, assignment.unitId)
      assert.equal(row.positionId, assignment.positionId)
      assert.equal(row.isActive, assignment.isActive)
      if (assignment.isActive) {
        assert.equal(row.deactivatedAt, null)
      } else {
        assert.ok(row.deactivatedAt instanceof Date, `inactive assignment ${assignment.id} must carry deactivatedAt`)
      }
    }
  })

  it('teamId backfill covers exactly the fixture assignments that declare a team', () => {
    const expected = Object.values(fixture.actors)
      .map((actor) => actor.assignment)
      .filter((assignment): assignment is NonNullable<typeof assignment> => assignment !== null)
      .filter((assignment) => assignment.teamId !== null)
      .map((assignment) => ({ assignmentId: assignment.id, teamId: assignment.teamId as string }))
    const actual = [...plan.teamUpdates].sort((a, b) => a.assignmentId.localeCompare(b.assignmentId))
    const expectedSorted = [...expected].sort((a, b) => a.assignmentId.localeCompare(b.assignmentId))
    assert.deepEqual(actual, expectedSorted)
  })

  it('builds deterministically (pure helper, same fixture → same plan shape)', () => {
    const again = planFor(createBusinessWorkflowFixture())
    assert.deepEqual(
      again.steps.map((step) => `${step.table}:${step.data.id}`),
      plan.steps.map((step) => `${step.table}:${step.data.id}`),
    )
    assert.deepEqual(again.teamUpdates, plan.teamUpdates)
  })
})
