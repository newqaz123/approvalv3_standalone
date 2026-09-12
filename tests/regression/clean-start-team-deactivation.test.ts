// Clean-start team deactivation (post-C10 follow-up #2, owner-approved).
// deactivateTeam: deactivate-not-delete semantics with typed refusals naming
// offenders. Component harness: renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-team.test.ts and
// tests/regression/clean-start-unit-deactivation.test.ts).
// Action tests: in-memory fake OrganizationTeamDeactivationDb only.
// NO Prisma, NO database, NO env, NO schema/server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import { OrganizationValidationError } from '@/lib/organization/assignments'
import {
  deactivateTeam,
  type OrganizationTeamDeactivationDb,
  type WorkspaceSnapshot,
} from '@/server-actions/organization'
import { TeamPanel, TeamDeactivationSection } from '@/components/organization/TeamPanel'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'

const read = (path: string) => readFileSync(path, 'utf8')

function unit(
  id: string,
  name: string,
  parentId: string | null,
  extra: Partial<OrganizationUnitNode> = {},
): OrganizationUnitNode {
  return {
    id,
    name,
    parentId,
    isActive: true,
    shareRequests: false,
    canWorkOnSolutions: false,
    managerUserId: null,
    ...extra,
  }
}

function assignment(
  id: string,
  userId: string,
  unitId: string,
  extra: Partial<AssignmentNode> = {},
): AssignmentNode {
  return {
    id,
    userId,
    unitId,
    positionId: 'p-staff',
    teamId: null,
    isActive: true,
    ...extra,
  }
}

function team(
  id: string,
  unitId: string,
  name: string,
  reportsToAssignmentId: string,
  extra: Partial<TeamNode> = {},
): TeamNode {
  return { id, unitId, name, reportsToAssignmentId, isActive: true, ...extra }
}

function makeDeactivationDb(over: {
  units?: OrganizationUnitNode[]
  teams?: TeamNode[]
  assignments?: AssignmentNode[]
  positions?: PositionNode[]
  users?: WorkspaceSnapshot['users'][number][]
} = {}) {
  const units = (over.units ?? [
    unit('company', 'Company', null, { shareRequests: true }),
    unit('ops', 'Operations', 'company', { shareRequests: true }),
    unit('section-a', 'Section A', 'ops', { shareRequests: true }),
    unit('section-b', 'Section B', 'ops'),
  ]).map((row) => ({ ...row }))
  const teams = (over.teams ?? []).map((row) => ({ ...row }))
  const positions = (over.positions ?? [
    { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
    { id: 'p-manager', name: 'Manager', rank: 3, isActive: true },
  ]).map((row) => ({ ...row }))
  const assignments = (over.assignments ?? [
    assignment('asg-pat', 'pat', 'ops', { positionId: 'p-manager' }),
    assignment('asg-alice', 'alice', 'section-a'),
  ]).map((row) => ({ ...row }))
  const users = (over.users ?? [
    { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
    { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
    { id: 'casey', name: 'Casey', email: 'casey@example.com', role: 'general_dept', isActive: true },
    { id: 'riley', name: 'Riley', email: 'riley@example.com', role: 'general_dept', isActive: true },
  ]).map((row) => ({ ...row }))
  const audits: Array<{ action: string; comments: string }> = []
  const revalidated: string[] = []
  let exclusive = Promise.resolve()
  const db: OrganizationTeamDeactivationDb & {
    units: OrganizationUnitNode[]
    teams: TeamNode[]
    assignments: AssignmentNode[]
    positions: PositionNode[]
    users: WorkspaceSnapshot['users'][number][]
    audits: Array<{ action: string; comments: string }>
    revalidated: string[]
  } = {
    adminUserId: 'admin-1',
    units,
    teams,
    assignments,
    positions,
    users,
    audits,
    revalidated,
    async loadUnits() {
      return units.map((row) => ({ ...row }))
    },
    async loadTeams() {
      return teams.map((row) => ({ ...row }))
    },
    async loadAssignments() {
      return assignments.map((row) => ({ ...row }))
    },
    async loadPositions() {
      return positions.map((row) => ({ ...row }))
    },
    async loadUsers() {
      return users.map((row) => ({ ...row }))
    },
    async deactivateTeam(id) {
      const row = teams.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing team ${id}`)
      row.isActive = false
    },
    async updateUnitName() {
      throw new Error('updateUnitName not used by team deactivation')
    },
    async updateTeamName() {
      throw new Error('updateTeamName not used by team deactivation')
    },
    async writeAudit(entry) {
      audits.push({ ...entry })
    },
    async revalidateOrganization() {
      revalidated.push('/admin/organization')
    },
    async runSerializable(fn) {
      const run = exclusive.then(() => fn(db))
      exclusive = run.then(() => undefined, () => undefined)
      return run
    },
  }
  return db
}

const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-manager', name: 'Manager', rank: 3, isActive: true },
]

function makeSnapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    units: [
      unit('company', 'Company', null, { shareRequests: true }),
      unit('ops', 'Operations', 'company', { shareRequests: true }),
      unit('section-a', 'Section A', 'ops', { shareRequests: true }),
      unit('section-b', 'Section B', 'ops'),
    ],
    positions,
    assignments: [
      assignment('asg-pat', 'pat', 'ops', { positionId: 'p-manager' }),
      assignment('asg-alice', 'alice', 'section-a'),
      assignment('asg-casey', 'casey', 'section-a'),
    ],
    teams: [
      team('team-line', 'section-a', 'Line A', 'asg-riley'),
    ],
    users: [
      { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
      { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
      { id: 'casey', name: 'Casey', email: 'casey@example.com', role: 'general_dept', isActive: true },
      { id: 'riley', name: 'Riley', email: 'riley@example.com', role: 'general_dept', isActive: true },
    ],
    unassignedUsers: [],
    routeSources: [],
    customChainExceptions: [],
    readiness: { ready: true, blockers: [] },
    ...over,
  }
}

describe('deactivateTeam fake db — refusals', () => {
  it('rejects a missing team without writing', async () => {
    const db = makeDeactivationDb()
    await assert.rejects(
      () => deactivateTeam({ teamId: 'nope' }, db),
      /not found/i,
    )
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('refuses an already-inactive team matching /not active/i without writing', async () => {
    const db = makeDeactivationDb({
      teams: [team('team-line', 'section-a', 'Line A', 'asg-riley', { isActive: false })],
    })
    await assert.rejects(
      () => deactivateTeam({ teamId: 'team-line' }, db),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match(String(error), /not active/i)
        return true
      },
    )
    assert.equal(db.teams.find((row) => row.id === 'team-line')?.isActive, false)
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('refuses while ACTIVE member assignments reference the team matching /assigned/i, naming each offender', async () => {
    const db = makeDeactivationDb({
      teams: [team('team-line', 'section-a', 'Line A', 'asg-riley')],
      assignments: [
        assignment('asg-riley', 'riley', 'section-a', { positionId: 'p-manager' }),
        assignment('asg-alice', 'alice', 'section-a', { teamId: 'team-line' }),
        assignment('asg-casey', 'casey', 'section-a', { teamId: 'team-line' }),
        assignment('asg-quinn', 'quinn', 'section-a'),
        assignment('asg-old', 'old', 'section-a', { teamId: 'team-line', isActive: false }),
      ],
      users: [
        { id: 'riley', name: 'Riley', email: 'riley@example.com', role: 'general_dept', isActive: true },
        { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
        { id: 'casey', name: 'Casey', email: 'casey@example.com', role: 'general_dept', isActive: true },
        { id: 'quinn', name: 'Quinn', email: 'quinn@example.com', role: 'general_dept', isActive: true },
        { id: 'old', name: 'Old', email: 'old@example.com', role: 'general_dept', isActive: true },
      ],
    })
    await assert.rejects(
      () => deactivateTeam({ teamId: 'team-line' }, db),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match(String(error), /assigned/i)
        assert.match(String(error), /Alice/)
        assert.match(String(error), /asg-alice/)
        assert.match(String(error), /Casey/)
        // an INACTIVE member assignment is history, never an offender
        assert.doesNotMatch(String(error), /Old/)
        return true
      },
    )
    assert.equal(db.teams.find((row) => row.id === 'team-line')?.isActive, true)
    assert.equal(db.assignments.find((row) => row.id === 'asg-alice')?.teamId, 'team-line')
    assert.equal(db.assignments.find((row) => row.id === 'asg-casey')?.teamId, 'team-line')
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })
})

describe('deactivateTeam fake db — success', () => {
  it('deactivates a memberless team, audits, revalidates, and keeps every other field as history', async () => {
    const db = makeDeactivationDb({
      assignments: [
        assignment('asg-riley', 'riley', 'section-a', { positionId: 'p-manager' }),
        assignment('asg-alice', 'alice', 'section-a'),
      ],
      teams: [team('team-line', 'section-a', 'Line A', 'asg-riley')],
    })
    const teamBefore = { ...db.teams.find((row) => row.id === 'team-line')! }
    const assignmentsBefore = db.assignments.map((row) => ({ ...row }))
    const result = await deactivateTeam({ teamId: 'team-line' }, db)
    assert.deepEqual(result, { success: true })
    const after = db.teams.find((row) => row.id === 'team-line')
    assert.equal(after?.isActive, false)
    // deactivate-not-delete: only isActive flips; name/unit/reports-to survive
    // as history and the reports-to assignment row is never touched.
    assert.deepEqual({ ...after, isActive: true }, teamBefore)
    assert.deepEqual(db.assignments, assignmentsBefore)
    assert.equal(db.audits.length, 1)
    assert.equal(db.audits[0].action, 'team_deactivated')
    assert.match(db.audits[0].comments, /team-line/)
    assert.match(db.audits[0].comments, /Line A/)
    assert.deepEqual(db.revalidated, ['/admin/organization'])
  })

  it('keeps the still-active reports-to assignment untouched (retire the relationship WITH the team, never reassign)', async () => {
    const db = makeDeactivationDb({
      assignments: [
        assignment('asg-riley', 'riley', 'section-a', { positionId: 'p-manager' }),
      ],
      teams: [team('team-line', 'section-a', 'Line A', 'asg-riley')],
    })
    const result = await deactivateTeam({ teamId: 'team-line' }, db)
    assert.deepEqual(result, { success: true })
    const reportsTo = db.assignments.find((row) => row.id === 'asg-riley')
    assert.equal(reportsTo?.isActive, true)
    assert.equal(reportsTo?.teamId, null)
    assert.equal(reportsTo?.unitId, 'section-a')
    assert.equal(reportsTo?.positionId, 'p-manager')
    // never silently reassigned: the deactivated team keeps the old reference
    assert.equal(db.teams.find((row) => row.id === 'team-line')?.reportsToAssignmentId, 'asg-riley')
  })

  it('succeeds for a team whose reports-to already went inactive (A3 exempts the inactive team; proposed state validates)', async () => {
    // Defense-in-depth current state: validateOrganization would fail this
    // ACTIVE team (inactive reports-to), yet deactivating it is the correction
    // path — the proposed state exempts the inactive team's reports-to rules.
    const db = makeDeactivationDb({
      assignments: [
        assignment('asg-riley', 'riley', 'section-a', { positionId: 'p-manager', isActive: false }),
      ],
      teams: [team('team-line', 'section-a', 'Line A', 'asg-riley')],
    })
    const result = await deactivateTeam({ teamId: 'team-line' }, db)
    assert.deepEqual(result, { success: true })
    assert.equal(db.teams.find((row) => row.id === 'team-line')?.isActive, false)
    assert.equal(db.assignments.find((row) => row.id === 'asg-riley')?.isActive, false)
    assert.equal(db.audits.length, 1)
  })

  it('succeeds with inactive member history still pointing at the team (rule 6 exempts inactive memberships)', async () => {
    const db = makeDeactivationDb({
      assignments: [
        assignment('asg-riley', 'riley', 'section-a', { positionId: 'p-manager' }),
        assignment('asg-alice', 'alice', 'section-a', { teamId: 'team-line', isActive: false }),
      ],
      teams: [team('team-line', 'section-a', 'Line A', 'asg-riley')],
    })
    const result = await deactivateTeam({ teamId: 'team-line' }, db)
    assert.deepEqual(result, { success: true })
    // the inactive member's historical teamId reference is preserved untouched
    assert.equal(db.assignments.find((row) => row.id === 'asg-alice')?.teamId, 'team-line')
    assert.equal(db.assignments.find((row) => row.id === 'asg-alice')?.isActive, false)
  })
})

describe('tree hides inactive teams', () => {
  it('renders no team group for an inactive team the loader still returned, while the reports-to person stays', () => {
    const snapshot = makeSnapshot({
      assignments: [
        assignment('asg-riley', 'riley', 'section-a', { positionId: 'p-manager' }),
      ],
      teams: [team('team-line', 'section-a', 'Line A', 'asg-riley', { isActive: false })],
    })
    const html = renderToStaticMarkup(createElement(OrganizationWorkspace, { snapshot }))
    assert.doesNotMatch(html, /data-testid="team-group-team-line"/)
    assert.doesNotMatch(html, /Line A/)
    assert.match(html, /data-testid="person-chip-riley"/)
    assert.match(html, /Riley/)
  })
})

describe('TeamPanel deactivation UI', () => {
  it('shows the danger Deactivate team button in manage mode without a confirmation initially', () => {
    const snapshot = makeSnapshot({
      assignments: [
        assignment('asg-riley', 'riley', 'section-a', { positionId: 'p-manager' }),
      ],
      teams: [team('team-line', 'section-a', 'Line A', 'asg-riley')],
    })
    const html = renderToStaticMarkup(createElement(TeamPanel, {
      snapshot,
      unitId: 'section-a',
      teamId: 'team-line',
    }))
    assert.match(html, /data-testid="team-deactivate"/)
    assert.match(html, /Deactivate team/)
    assert.doesNotMatch(html, /data-testid="team-deactivate-confirmation"/)
    assert.doesNotMatch(html, /data-testid="team-deactivate-confirm"/)
  })

  it('never shows the deactivation section in create mode', () => {
    const snapshot = makeSnapshot()
    const html = renderToStaticMarkup(createElement(TeamPanel, {
      snapshot,
      unitId: 'section-a',
    }))
    assert.doesNotMatch(html, /data-testid="team-deactivation-section"/)
    assert.doesNotMatch(html, /data-testid="team-deactivate"/)
  })

  it('confirmation step shows explanatory copy with confirm and cancel controls', () => {
    const html = renderToStaticMarkup(createElement(TeamDeactivationSection, {
      teamName: 'Line A',
      confirming: true,
      saving: false,
      error: null,
      onStart: () => {},
      onConfirm: () => {},
      onCancel: () => {},
    }))
    assert.match(html, /data-testid="team-deactivate-confirmation"/)
    assert.match(html, /Line A/)
    assert.match(html, /history/i)
    assert.match(html, /data-testid="team-deactivate-confirm"/)
    assert.match(html, /data-testid="team-deactivate-cancel"/)
    // the reveal button itself is hidden while confirming
    assert.doesNotMatch(html, /data-testid="team-deactivate"/)
  })

  it('guard errors render adjacent to the confirmation and the confirmation state is retained', () => {
    const html = renderToStaticMarkup(createElement(TeamDeactivationSection, {
      teamName: 'Line A',
      confirming: true,
      saving: false,
      error: 'Team "Line A" has members still assigned: "Alice" (asg-alice); move or remove members first',
      onStart: () => {},
      onConfirm: () => {},
      onCancel: () => {},
    }))
    const errorAt = html.indexOf('data-testid="team-deactivate-error"')
    const confirmAt = html.indexOf('data-testid="team-deactivate-confirm"')
    assert.ok(errorAt >= 0, 'adjacent error element must exist')
    assert.ok(confirmAt > errorAt, 'error renders adjacent (before the confirm control)')
    assert.match(html, /role="alert"/)
    assert.match(html, /move or remove members first/)
    assert.match(html, /data-testid="team-deactivate-cancel"/)
  })

  it('no error element renders before a save is attempted', () => {
    const html = renderToStaticMarkup(createElement(TeamDeactivationSection, {
      teamName: 'Line A',
      confirming: false,
      saving: false,
      error: null,
      onStart: () => {},
      onConfirm: () => {},
      onCancel: () => {},
    }))
    assert.doesNotMatch(html, /data-testid="team-deactivate-error"/)
    assert.match(html, /data-testid="team-deactivate"/)
  })
})

describe('team deactivation source contracts', () => {
  it('exports the action with Serializable isolation, typed refusals, and validateOrganization before the write', () => {
    const actions = read('src/server-actions/organization.ts')
    assert.match(actions, /export async function deactivateTeam/)
    assert.match(actions, /team_deactivated/)
    assert.match(actions, /isolationLevel: 'Serializable'/)
    const start = actions.indexOf('export async function deactivateTeam')
    // Scope to THIS action's body only: the next top-level docblock starts the
    // following action (updateTeamReportsTo legitimately appears later in the file).
    const bodyEnd = actions.indexOf('\n/**', start + 1)
    const body = actions.slice(start, bodyEnd === -1 ? undefined : bodyEnd)
    assert.match(body, /validateOrganization/)
    const validateAt = body.indexOf('validateOrganization(')
    const writeAt = body.indexOf('writer.deactivateTeam(')
    assert.ok(validateAt >= 0 && writeAt > validateAt, 'validateOrganization must run before the deactivate write')
    assert.match(actions, /revalidatePath\('\/admin\/organization'\)/)
    // never a destructive removal: no delete calls in the action body
    assert.doesNotMatch(body, /\.delete\(|deleteMany|\.delete\b/)
    // never silently reassigned: the action writes no reports-to change
    assert.doesNotMatch(body, /updateTeamReportsTo/)
  })
})
