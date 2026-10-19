import type { BusinessWorkflowFixture } from '../business-workflow-fixture'

/**
 * Import-safe, side-effect-free builder for the native seed's insertion plan.
 *
 * `prisma db push` creates plain (NOT DEFERRABLE) foreign keys, so PostgreSQL
 * validates every INSERT immediately — even inside the seed's single
 * `$transaction`. The fixture's rows therefore have to be ordered so that no
 * INSERT forward-references a row created later in the same transaction.
 *
 * FK graph that constrains the order (prisma/schema.prisma):
 * - organization_units.parentId        → organization_units.id (self, parent-first)
 * - organization_units.managerUserId   → users.id (nullable)
 * - company_settings.rootUnitId        → organization_units.id
 * - organization_assignments.userId    → users.id
 * - organization_assignments.unitId    → organization_units.id
 * - organization_assignments.positionId→ positions.id
 * - organization_assignments.teamId    → teams.id (NULLABLE)
 * - teams.unitId                       → organization_units.id
 * - teams.reportsToAssignmentId        → organization_assignments.id (REQUIRED)
 *
 * `teams ⇄ organization_assignments` is a genuine cycle (teams require an
 * assignment; an assignment may require a team). It is resolved without
 * disabling constraints or changing the schema by inserting every assignment
 * first with its NULLABLE `teamId` omitted, then creating teams against those
 * rows, then backfilling `teamId` with plain UPDATEs.
 *
 * Resulting order (locked by tests/regression/native-seed-order.test.ts):
 *   1. positions
 *   2. users
 *   3. organization_units (parent-first, managerUserId set — users exist)
 *   4. company_settings
 *   5. organization_assignments (teamId NULL)
 *   6. teams (reportsToAssignmentId resolvable — assignments exist)
 *   7. teamUpdates (backfill organization_assignments.teamId)
 */

export interface SeedPositionRow {
  id: string
  name: string
  rank: number
  isActive: boolean
}

export interface SeedUserRow {
  id: string
  email: string
  name: string
  passwordHash: string
  role: 'admin' | 'general_dept' | 'engineering'
  isActive: boolean
  forcePasswordChange: boolean
}

export interface SeedUnitRow {
  id: string
  name: string
  parentId: string | null
  isActive: boolean
  shareRequests: boolean
  canWorkOnSolutions: boolean
  managerUserId: string | null
}

export interface SeedCompanySettingsRow {
  id: string
  name: string
  rootUnitId: string
}

export interface SeedAssignmentRow {
  id: string
  userId: string
  unitId: string
  positionId: string
  isActive: boolean
  deactivatedAt: Date | null
}

export interface SeedTeamRow {
  id: string
  unitId: string
  name: string
  reportsToAssignmentId: string
  isActive: boolean
}

export type BusinessSeedStep =
  | { table: 'positions'; data: SeedPositionRow }
  | { table: 'users'; data: SeedUserRow }
  | { table: 'organization_units'; data: SeedUnitRow }
  | { table: 'company_settings'; data: SeedCompanySettingsRow }
  | { table: 'organization_assignments'; data: SeedAssignmentRow }
  | { table: 'teams'; data: SeedTeamRow }

export interface BusinessSeedTeamUpdate {
  assignmentId: string
  teamId: string
}

export interface BusinessSeedPlan {
  steps: readonly BusinessSeedStep[]
  teamUpdates: readonly BusinessSeedTeamUpdate[]
}

/**
 * The fromAddress the native business seed writes into email_settings — the
 * application's outbound identity for every captured workflow mail. It must
 * live on the fixture domain the mail evaluator requires (@business.test for
 * sender AND recipients: capture-workflow-mail-evidence.ts
 * mail-evidence/fixture-domains-only); the previous @example.test value
 * failed that check in every native run (T18B). Exported from this
 * side-effect-free module so regressions can pin the real seeded sender
 * without importing the seed script (which executes on import).
 */
export const BUSINESS_FIXTURE_OUTBOUND_SENDER_ADDRESS = 'business-workflow-test@business.test'

function roleForActor(role: 'USER' | 'ADMIN', userId: string): 'admin' | 'general_dept' | 'engineering' {
  if (role === 'ADMIN') return 'admin'
  const engineeringUsers = new Set(['user-engineer-a', 'user-supervisor-e', 'user-section-manager-e'])
  return engineeringUsers.has(userId) ? 'engineering' : 'general_dept'
}

export function buildBusinessSeedPlan(
  fixture: BusinessWorkflowFixture,
  options: { passwordHash: string },
): BusinessSeedPlan {
  const steps: BusinessSeedStep[] = []

  // 1. positions — no FK dependencies.
  for (const position of fixture.positions) {
    steps.push({
      table: 'positions',
      data: { id: position.id, name: position.name, rank: position.rank, isActive: position.isActive },
    })
  }

  // 2. users — no FK dependencies; must precede units whose managerUserId
  //    references a user (non-deferrable FK organization_units.managerUserId).
  for (const actor of Object.values(fixture.actors)) {
    steps.push({
      table: 'users',
      data: {
        id: actor.id,
        email: `${actor.id}@business.test`,
        name: actor.name,
        passwordHash: options.passwordHash,
        role: roleForActor(actor.role, actor.id),
        isActive: actor.isActive,
        forcePasswordChange: false,
      },
    })
  }

  // 3. organization_units — parent-first; managerUserId may be set directly
  //    because the users now exist.
  for (const unit of fixture.units) {
    const directManagerAssignment = Object.values(fixture.actors)
      .map((actor) => actor.assignment)
      .filter((assignment): assignment is NonNullable<typeof assignment> =>
        assignment !== null && assignment.isActive && assignment.unitId === unit.id)
      .find((assignment) => assignment.positionId.endsWith('section-manager') || assignment.positionId.endsWith('department-manager'))
    const managerUser = unit.parentId === null
      ? null
      : directManagerAssignment?.userId ?? null
    steps.push({
      table: 'organization_units',
      data: {
        id: unit.id,
        name: unit.name,
        parentId: unit.parentId,
        isActive: unit.isActive,
        shareRequests: unit.shareRequests,
        canWorkOnSolutions: unit.canWorkOnSolutions,
        managerUserId: managerUser,
      },
    })
  }

  // 4. company_settings — rootUnitId references the first unit.
  steps.push({
    table: 'company_settings',
    data: {
      id: 'default',
      name: 'Business Workflow Test Company',
      rootUnitId: fixture.units[0].id,
    },
  })

  // 5. organization_assignments with the NULLABLE teamId omitted —
  //    teams.reportsToAssignmentId is required, so teams cannot be created
  //    until these rows exist; teamId is backfilled after teams (step 7).
  const teamUpdates: BusinessSeedTeamUpdate[] = []
  for (const actor of Object.values(fixture.actors)) {
    if (!actor.assignment) continue
    steps.push({
      table: 'organization_assignments',
      data: {
        id: actor.assignment.id,
        userId: actor.assignment.userId,
        unitId: actor.assignment.unitId,
        positionId: actor.assignment.positionId,
        isActive: actor.assignment.isActive,
        deactivatedAt: actor.assignment.isActive ? null : new Date(),
      },
    })
    if (actor.assignment.teamId) {
      teamUpdates.push({ assignmentId: actor.assignment.id, teamId: actor.assignment.teamId })
    }
  }

  // 6. teams — reportsToAssignmentId is required and validateOrganization
  //    Rule 4 demands an ACTIVE assignment in the team's OWN unit (the old
  //    graph pointed team-sibling at the Department manager, active in
  //    unit-production-1, which the real validator rejects). Each team is
  //    therefore mapped to a same-unit anchor: the section manager for the
  //    workflow units, and the TEST-ONLY sibling supervisor anchor for
  //    team-sibling. Unmapped teams fail loudly instead of silently
  //    falling back to a cross-unit anchor.
  const reportsToByTeam: Record<string, string> = {
    'team-production': 'assignment-section-manager-p',
    'team-engineering': 'assignment-section-manager-e',
    'team-sibling': 'assignment-supervisor-sibling',
    'team-production-vacant-sup': 'assignment-section-manager-p',
    // T18C2 isolated vacancy branch: the team's reports-to is the dedicated
    // same-unit anchor (position-vacancy-anchor, rank 2 > staff rank 1,
    // teamId null) — a valid Rule 4/5 anchor that no route step requires.
    'team-vacancy-branch': 'assignment-vacancy-anchor',
  }
  const teamIds = new Set<string>()
  for (const assignment of Object.values(fixture.actors).map((actor) => actor.assignment)) {
    if (assignment?.teamId) teamIds.add(assignment.teamId)
  }
  for (const teamId of teamIds) {
    const unitId = Object.values(fixture.actors)
      .map((actor) => actor.assignment)
      .find((assignment) => assignment?.teamId === teamId)?.unitId
    if (!unitId) throw new Error(`seed: team ${teamId} has no unit`)
    const reportsToAssignmentId = reportsToByTeam[teamId]
    if (!reportsToAssignmentId) {
      throw new Error(`seed: team ${teamId} has no confirmed same-unit reports-to anchor`)
    }
    steps.push({
      table: 'teams',
      data: {
        id: teamId,
        unitId,
        name: teamId,
        reportsToAssignmentId,
        isActive: true,
      },
    })
  }

  return { steps, teamUpdates }
}
