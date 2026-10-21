// Clean-start team panel (Plan C Task 7).
// Component harness: renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-assignment.test.ts).
// Action tests: in-memory fake OrganizationTeamMutationDb only.
// NO Prisma, NO database, NO env, NO schema/server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import { OrganizationValidationError } from '@/lib/organization/assignments'
import {
  createTeam,
  updateTeam,
  type OrganizationTeamMutationDb,
  type WorkspaceSnapshot,
} from '@/lib/organization/workspace-admin'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'
import { TeamPanel } from '@/components/organization/TeamPanel'

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

function makeMutationDb(over: {
  units?: OrganizationUnitNode[]
  teams?: TeamNode[]
  assignments?: AssignmentNode[]
  positions?: PositionNode[]
  users?: WorkspaceSnapshot['users'][number][]
} = {}) {
  const units = (over.units ?? [
    unit('company', 'Company', null),
    unit('ops', 'Operations', 'company', { shareRequests: true, managerUserId: 'pat' }),
    unit('section-a', 'Section A', 'ops', { shareRequests: true }),
    unit('section-b', 'Section B', 'ops'),
  ]).map((row) => ({ ...row }))
  const teams = (over.teams ?? [
    {
      id: 'team-alpha',
      unitId: 'ops',
      name: 'Alpha Team',
      reportsToAssignmentId: 'asg-pat',
      isActive: true,
    },
    {
      id: 'team-beta',
      unitId: 'ops',
      name: 'Beta Team',
      reportsToAssignmentId: 'asg-pat',
      isActive: true,
    },
  ]).map((row) => ({ ...row }))
  const positions = (over.positions ?? [
    { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
    { id: 'p-lead', name: 'Lead', rank: 2, isActive: true },
    { id: 'p-manager', name: 'Manager', rank: 3, isActive: true },
  ]).map((row) => ({ ...row }))
  const assignments = (over.assignments ?? [
    assignment('asg-pat', 'pat', 'ops', { positionId: 'p-manager' }),
    assignment('asg-casey', 'casey', 'ops', { teamId: 'team-alpha' }),
    assignment('asg-quinn', 'quinn', 'ops', { teamId: 'team-beta' }),
    assignment('asg-morgan', 'morgan', 'ops', { positionId: 'p-lead' }),
    assignment('asg-alice', 'alice', 'section-a'),
    assignment('asg-bob', 'bob', 'section-b'),
    assignment('asg-old', 'old', 'ops', { isActive: false }),
  ]).map((row) => ({ ...row }))
  const users = (over.users ?? [
    { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
    { id: 'casey', name: 'Casey', email: 'casey@example.com', role: 'general_dept', isActive: true },
    { id: 'quinn', name: 'Quinn', email: 'quinn@example.com', role: 'general_dept', isActive: true },
    { id: 'morgan', name: 'Morgan', email: 'morgan@example.com', role: 'general_dept', isActive: true },
    { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
    { id: 'bob', name: 'Bob', email: 'bob@example.com', role: 'general_dept', isActive: true },
    { id: 'old', name: 'Old', email: 'old@example.com', role: 'general_dept', isActive: false },
  ]).map((row) => ({ ...row }))
  const audits: Array<{ action: string; comments: string }> = []
  const revalidated: string[] = []
  const userRoleWrites: Array<{ userId: string; role: string }> = []
  let created = 0
  let exclusive = Promise.resolve()
  const db: OrganizationTeamMutationDb & {
    units: OrganizationUnitNode[]
    teams: TeamNode[]
    assignments: AssignmentNode[]
    positions: PositionNode[]
    users: WorkspaceSnapshot['users'][number][]
    audits: Array<{ action: string; comments: string }>
    revalidated: string[]
    userRoleWrites: Array<{ userId: string; role: string }>
  } = {
    adminUserId: 'admin-1',
    units,
    teams,
    assignments,
    positions,
    users,
    audits,
    revalidated,
    userRoleWrites,
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
    async updateUnitName(id, name) {
      const row = units.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing unit ${id}`)
      row.name = name
    },
    async updateTeamName(id, name) {
      const row = teams.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing team ${id}`)
      row.name = name
    },
    async createUnit() {
      throw new Error('createUnit not used by C7')
    },
    async updateUnitSettings() {
      throw new Error('updateUnitSettings not used by C7')
    },
    async updateUnitManager() {
      throw new Error('updateUnitManager not used by C7')
    },
    async createAssignment() {
      throw new Error('createAssignment not used by C7')
    },
    async updateAssignment() {
      throw new Error('updateAssignment not used by C7')
    },
    async deactivateAssignment() {
      throw new Error('deactivateAssignment not used by C7')
    },
    async updateTeamReportsTo(teamId, reportsToAssignmentId) {
      const row = teams.find((candidate) => candidate.id === teamId)
      if (!row) throw new Error(`missing team ${teamId}`)
      row.reportsToAssignmentId = reportsToAssignmentId
    },
    async createTeam(input) {
      created += 1
      const id = `team-new-${created}`
      teams.push({
        id,
        unitId: input.unitId,
        name: input.name,
        reportsToAssignmentId: input.reportsToAssignmentId,
        isActive: true,
      })
      return { id }
    },
    async setAssignmentTeam(id, teamId) {
      const row = assignments.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing assignment ${id}`)
      row.teamId = teamId
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

function sharedManagerSnapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    units: [
      unit('company', 'Company', null),
      unit('ops', 'Operations', 'company', { shareRequests: true, managerUserId: 'pat' }),
      unit('section-a', 'Section A', 'ops'),
    ],
    positions: [
      { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
      { id: 'p-manager', name: 'Manager', rank: 3, isActive: true },
    ],
    assignments: [
      assignment('asg-pat', 'pat', 'ops', { positionId: 'p-manager' }),
      assignment('asg-casey', 'casey', 'ops', { teamId: 'team-alpha' }),
      assignment('asg-quinn', 'quinn', 'ops', { teamId: 'team-beta' }),
      assignment('asg-alice', 'alice', 'section-a'),
    ],
    teams: [
      {
        id: 'team-alpha',
        unitId: 'ops',
        name: 'Alpha Team',
        reportsToAssignmentId: 'asg-pat',
        isActive: true,
      },
      {
        id: 'team-beta',
        unitId: 'ops',
        name: 'Beta Team',
        reportsToAssignmentId: 'asg-pat',
        isActive: true,
      },
    ],
    users: [
      { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
      { id: 'casey', name: 'Casey', email: 'casey@example.com', role: 'general_dept', isActive: true },
      { id: 'quinn', name: 'Quinn', email: 'quinn@example.com', role: 'general_dept', isActive: true },
      { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
    ],
    unassignedUsers: [],
    routeSources: [],
    customChainExceptions: [],
    readiness: { ready: true, blockers: [] },
    ...over,
  }
}

function countTestId(html: string, testId: string): number {
  const marker = `data-testid="${testId}"`
  return html.split(marker).length - 1
}

function innerByTestId(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`
  const attr = html.indexOf(marker)
  assert.ok(attr >= 0, `missing data-testid="${testId}"`)
  const open = html.lastIndexOf('<', attr)
  const tagMatch = /^<([a-zA-Z0-9]+)/.exec(html.slice(open))
  assert.ok(tagMatch, `could not parse tag for ${testId}`)
  const tag = tagMatch[1]
  const afterOpen = html.indexOf('>', attr) + 1
  let depth = 1
  let i = afterOpen
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf(`<${tag}`, i)
    const nextClose = html.indexOf(`</${tag}>`, i)
    if (nextClose < 0) {
      throw new Error(`unclosed ${testId}`)
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1
      i = nextOpen + tag.length + 1
    } else {
      depth -= 1
      if (depth === 0) return html.slice(afterOpen, nextClose)
      i = nextClose + tag.length + 3
    }
  }
  throw new Error(`unclosed ${testId}`)
}

function expectNamedValidation(
  error: unknown,
  pattern: RegExp,
  offender: string,
): boolean {
  assert.equal(error instanceof OrganizationValidationError, true)
  const message = String(error)
  assert.match(message, pattern)
  assert.match(message, new RegExp(offender))
  return true
}

const nightCrew = {
  unitId: 'ops',
  name: 'Night Crew',
  reportsToAssignmentId: 'asg-pat',
  memberAssignmentIds: ['asg-morgan'] as readonly string[],
}

describe('TeamPanel component harness', () => {
  it('renders create and manage team panels', () => {
    const snapshot = sharedManagerSnapshot()
    const createHtml = renderToStaticMarkup(createElement(TeamPanel, {
      snapshot,
      unitId: 'ops',
    }))
    assert.match(createHtml, /data-testid="team-panel"/)
    assert.match(createHtml, /Create team/)
    assert.match(createHtml, /data-testid="team-name-input"/)
    assert.match(createHtml, /data-testid="team-reports-to-select"/)
    assert.match(createHtml, /data-testid="team-save"/)
    assert.match(createHtml, /Pat/)
    assert.match(createHtml, /Morgan|Casey|Quinn/)

    const manageHtml = renderToStaticMarkup(createElement(TeamPanel, {
      snapshot,
      unitId: 'ops',
      teamId: 'team-alpha',
    }))
    assert.match(manageHtml, /data-testid="team-panel"/)
    assert.match(manageHtml, /Manage team/)
    assert.match(manageHtml, /Alpha Team/)
    assert.match(manageHtml, /Casey/)
  })

  it('shared-manager fixture: one reports-to person, two teams, person not duplicated', () => {
    const html = renderToStaticMarkup(createElement(OrganizationWorkspace, {
      snapshot: sharedManagerSnapshot(),
    }))
    assert.equal(countTestId(html, 'person-chip-pat'), 1)
    const pat = innerByTestId(html, 'person-chip-pat')
    assert.match(pat, /Pat — Manager/)
    assert.match(pat, /data-testid="team-group-team-alpha"/)
    assert.match(pat, /data-testid="team-group-team-beta"/)
    assert.match(innerByTestId(pat, 'team-group-team-alpha'), /Alpha Team/)
    assert.match(innerByTestId(pat, 'team-group-team-beta'), /Beta Team/)
    assert.equal(countTestId(html, 'person-chip-pat'), 1)
  })
})

describe('createTeam / updateTeam fake db', () => {
  it('rejects a duplicate active team name in the unit matching /duplicate team/i', async () => {
    const db = makeMutationDb()
    const before = db.teams.length
    await assert.rejects(
      () => createTeam({
        ...nightCrew,
        name: 'Alpha Team',
        memberAssignmentIds: ['asg-morgan'],
      }, db),
      /duplicate team/i,
    )
    assert.equal(db.teams.length, before)
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])

    await assert.rejects(
      () => updateTeam({
        id: 'team-beta',
        name: 'Alpha Team',
        reportsToAssignmentId: 'asg-pat',
        memberAssignmentIds: ['asg-quinn'],
      }, db),
      /duplicate team/i,
    )
    assert.equal(db.teams.find((row) => row.id === 'team-beta')?.name, 'Beta Team')
    assert.equal(db.audits.length, 0)
  })

  it('rejects equal-rank reports-to matching /strictly above/i and names the offender', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => createTeam({
        unitId: 'ops',
        name: 'Night Crew',
        reportsToAssignmentId: 'asg-quinn',
        memberAssignmentIds: ['asg-casey'],
      }, db),
      (error: unknown) => expectNamedValidation(error, /strictly above/i, 'Casey'),
    )
    assert.equal(db.teams.some((row) => row.name === 'Night Crew'), false)
    assert.equal(db.audits.length, 0)

    await assert.rejects(
      () => updateTeam({
        id: 'team-alpha',
        name: 'Alpha Team',
        reportsToAssignmentId: 'asg-quinn',
        memberAssignmentIds: ['asg-casey'],
      }, db),
      (error: unknown) => expectNamedValidation(error, /strictly above/i, 'Casey'),
    )
    assert.equal(db.teams.find((row) => row.id === 'team-alpha')?.reportsToAssignmentId, 'asg-pat')
  })

  it('rejects reports-to as a member and names the offender', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => createTeam({
        unitId: 'ops',
        name: 'Night Crew',
        reportsToAssignmentId: 'asg-pat',
        memberAssignmentIds: ['asg-pat', 'asg-morgan'],
      }, db),
      (error: unknown) => expectNamedValidation(error, /member/i, 'Pat'),
    )
    assert.equal(db.teams.some((row) => row.name === 'Night Crew'), false)

    await assert.rejects(
      () => updateTeam({
        id: 'team-alpha',
        name: 'Alpha Team',
        reportsToAssignmentId: 'asg-pat',
        memberAssignmentIds: ['asg-pat', 'asg-casey'],
      }, db),
      (error: unknown) => expectNamedValidation(error, /member/i, 'Pat'),
    )
    assert.equal(db.assignments.find((row) => row.id === 'asg-pat')?.teamId, null)
  })

  it('rejects a cross-unit member listed by name', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => createTeam({
        unitId: 'ops',
        name: 'Night Crew',
        reportsToAssignmentId: 'asg-pat',
        memberAssignmentIds: ['asg-alice'],
      }, db),
      (error: unknown) => expectNamedValidation(error, /Alice/, 'Alice'),
    )
    assert.equal(db.assignments.find((row) => row.id === 'asg-alice')?.teamId, null)

    await assert.rejects(
      () => updateTeam({
        id: 'team-alpha',
        name: 'Alpha Team',
        reportsToAssignmentId: 'asg-pat',
        memberAssignmentIds: ['asg-alice'],
      }, db),
      (error: unknown) => expectNamedValidation(error, /Alice/, 'Alice'),
    )
    assert.equal(db.assignments.find((row) => row.id === 'asg-casey')?.teamId, 'team-alpha')
  })

  it('rejects reports-to not in the unit or inactive and names the offender', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => createTeam({
        unitId: 'ops',
        name: 'Night Crew',
        reportsToAssignmentId: 'asg-alice',
        memberAssignmentIds: ['asg-morgan'],
      }, db),
      (error: unknown) => expectNamedValidation(error, /unit/i, 'Alice'),
    )
    await assert.rejects(
      () => createTeam({
        unitId: 'ops',
        name: 'Night Crew',
        reportsToAssignmentId: 'asg-old',
        memberAssignmentIds: ['asg-morgan'],
      }, db),
      (error: unknown) => expectNamedValidation(error, /inactive/i, 'Old'),
    )
    await assert.rejects(
      () => updateTeam({
        id: 'team-alpha',
        name: 'Alpha Team',
        reportsToAssignmentId: 'asg-bob',
        memberAssignmentIds: ['asg-casey'],
      }, db),
      (error: unknown) => expectNamedValidation(error, /unit/i, 'Bob'),
    )
    assert.equal(db.teams.find((row) => row.id === 'team-alpha')?.reportsToAssignmentId, 'asg-pat')
    assert.equal(db.audits.length, 0)
  })

  it('creates a team with two members, audits, and does not write users.role', async () => {
    const db = makeMutationDb()
    const roleBefore = db.users.map((row) => row.role)
    const result = await createTeam({
      unitId: 'ops',
      name: 'Night Crew',
      reportsToAssignmentId: 'asg-pat',
      memberAssignmentIds: ['asg-morgan', 'asg-casey'],
    }, db)
    assert.equal(typeof result.teamId, 'string')
    const created = db.teams.find((row) => row.id === result.teamId)
    assert.equal(created?.name, 'Night Crew')
    assert.equal(created?.unitId, 'ops')
    assert.equal(created?.reportsToAssignmentId, 'asg-pat')
    assert.equal(created?.isActive, true)
    assert.equal(db.assignments.find((row) => row.id === 'asg-morgan')?.teamId, result.teamId)
    assert.equal(db.assignments.find((row) => row.id === 'asg-casey')?.teamId, result.teamId)
    assert.equal(db.audits.length, 1)
    assert.match(db.audits[0].action, /team_created/)
    assert.deepEqual(db.revalidated, ['/admin/organization'])
    assert.deepEqual(db.users.map((row) => row.role), roleBefore)
    assert.deepEqual(db.userRoleWrites, [])
  })

  it('updates name, reports-to, and membership without silently replacing reports-to', async () => {
    const db = makeMutationDb()
    const result = await updateTeam({
      id: 'team-alpha',
      name: 'Alpha Renamed',
      reportsToAssignmentId: 'asg-pat',
      memberAssignmentIds: ['asg-morgan'],
    }, db)
    assert.deepEqual(result, { success: true })
    assert.equal(db.teams.find((row) => row.id === 'team-alpha')?.name, 'Alpha Renamed')
    assert.equal(db.teams.find((row) => row.id === 'team-alpha')?.reportsToAssignmentId, 'asg-pat')
    assert.equal(db.assignments.find((row) => row.id === 'asg-casey')?.teamId, null)
    assert.equal(db.assignments.find((row) => row.id === 'asg-morgan')?.teamId, 'team-alpha')
    assert.equal(db.audits.length, 1)
    assert.match(db.audits[0].action, /team_updated/)
    assert.deepEqual(db.userRoleWrites, [])

    await assert.rejects(
      () => updateTeam({
        id: 'team-alpha',
        name: 'Alpha Renamed',
        reportsToAssignmentId: 'asg-alice',
        memberAssignmentIds: ['asg-morgan'],
      }, db),
      /Alice/,
    )
    assert.equal(db.teams.find((row) => row.id === 'team-alpha')?.reportsToAssignmentId, 'asg-pat')
  })

  it('maps unique-index conflicts to /duplicate team/i', async () => {
    const db = makeMutationDb()
    db.createTeam = async () => {
      const error = new Error('Unique constraint failed') as Error & { code: string }
      error.code = 'P2002'
      throw error
    }
    await assert.rejects(
      () => createTeam({
        unitId: 'ops',
        name: 'Night Crew',
        reportsToAssignmentId: 'asg-pat',
        memberAssignmentIds: ['asg-morgan'],
      }, db),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match(String(error), /duplicate team/i)
        return true
      },
    )
  })
})

describe('C7 source contracts', () => {
  it('keeps Serializable duplicate-name uniqueness and never writes users.role or silently replaces reports-to', () => {
    const panel = read('src/components/organization/TeamPanel.tsx')
    assert.match(panel, /data-testid="team-panel"/)
    assert.match(panel, /createTeam/)
    assert.match(panel, /updateTeam/)
    assert.doesNotMatch(panel, /users\.role/)

    const actions = read('src/lib/organization/workspace-admin.ts')
    assert.match(actions, /export async function createTeam/)
    assert.match(actions, /export async function updateTeam/)
    assert.match(actions, /isolationLevel: 'Serializable'/)
    assert.match(actions, /Duplicate team/)
    assert.match(actions, /strictly above/)
    assert.match(actions, /P2002/)

    const createStart = actions.indexOf('export async function createTeam')
    const updateStart = actions.indexOf('export async function updateTeam')
    assert.ok(createStart >= 0 && updateStart >= 0)
    const createOnly = actions.slice(createStart, updateStart)
    const updateOnly = actions.slice(updateStart)
    for (const fn of [createOnly, updateOnly]) {
      assert.doesNotMatch(fn, /user\.update/)
      assert.doesNotMatch(fn, /users\.update/)
      assert.doesNotMatch(fn, /data:\s*\{[^}]*role/)
      assert.doesNotMatch(fn, /approval_instances/)
    }
    assert.doesNotMatch(updateOnly, /reportsToAssignmentId\s*=\s*.*candidates/)

    const workspace = read('src/components/organization/OrganizationWorkspace.tsx')
    assert.match(workspace, /TeamPanel/)
    assert.match(workspace, /onSelectTeam/)

    const tree = read('src/components/organization/TreeNodeRow.tsx')
    assert.match(tree, /onSelectTeam/)
    assert.match(tree, /team-select-/)
  })
})
