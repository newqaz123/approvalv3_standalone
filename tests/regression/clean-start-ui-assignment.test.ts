// Clean-start person assignment panel (Plan C Task 6).
// Component harness: renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-unit-panel.test.ts).
// Action tests: in-memory fake OrganizationAssignmentMutationDb only.
// NO Prisma, NO database, NO env, NO schema/server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import { OrganizationValidationError } from '@/lib/organization/assignments'
import {
  assignPerson,
  getOrganizationWorkspaceData,
  moveAssignment,
  removeAssignment,
  type OrganizationAssignmentMutationDb,
  type OrganizationWorkspaceDb,
  type WorkspaceSnapshot,
} from '@/server-actions/organization'
import {
  AssignmentChangeSummary,
  PersonAssignmentPanel,
  teamBelongsToUnit,
} from '@/components/organization/PersonAssignmentPanel'

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
    unit('ops', 'Operations', 'company', { shareRequests: true, managerUserId: 'quinn' }),
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
  ]).map((row) => ({ ...row }))
  const positions = (over.positions ?? [
    { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
    { id: 'p-manager', name: 'Manager', rank: 3, isActive: true },
  ]).map((row) => ({ ...row }))
  const assignments = (over.assignments ?? [
    assignment('asg-pat', 'pat', 'ops', { positionId: 'p-manager' }),
    assignment('asg-casey', 'casey', 'ops', { teamId: 'team-alpha' }),
    assignment('asg-quinn', 'quinn', 'ops', { positionId: 'p-manager' }),
    assignment('asg-alice', 'alice', 'section-a'),
    assignment('asg-bob', 'bob', 'section-b'),
    assignment('asg-old', 'old', 'ops', { isActive: false }),
  ]).map((row) => ({ ...row }))
  const users = (over.users ?? [
    { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
    { id: 'casey', name: 'Casey', email: 'casey@example.com', role: 'general_dept', isActive: true },
    { id: 'quinn', name: 'Quinn', email: 'quinn@example.com', role: 'general_dept', isActive: true },
    { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
    { id: 'bob', name: 'Bob', email: 'bob@example.com', role: 'general_dept', isActive: true },
    { id: 'dana', name: 'Dana', email: 'dana@example.com', role: 'general_dept', isActive: true },
    { id: 'old', name: 'Old', email: 'old@example.com', role: 'general_dept', isActive: false },
    { id: 'unassigned', name: 'Una', email: 'una@example.com', role: 'general_dept', isActive: true },
  ]).map((row) => ({ ...row }))
  const audits: Array<{ action: string; comments: string }> = []
  const revalidated: string[] = []
  const deactivatedAt = new Map<string, Date>()
  const userRoleWrites: Array<{ userId: string; role: string }> = []
  let created = 0
  let exclusive = Promise.resolve()
  const db: OrganizationAssignmentMutationDb & {
    units: OrganizationUnitNode[]
    teams: TeamNode[]
    assignments: AssignmentNode[]
    positions: PositionNode[]
    users: WorkspaceSnapshot['users'][number][]
    audits: Array<{ action: string; comments: string }>
    revalidated: string[]
    deactivatedAt: Map<string, Date>
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
    deactivatedAt,
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
      throw new Error('createUnit not used by C6')
    },
    async updateUnitSettings() {
      throw new Error('updateUnitSettings not used by C6')
    },
    async updateUnitManager() {
      throw new Error('updateUnitManager not used by C6')
    },
    async createAssignment(input) {
      created += 1
      const id = `asg-new-${created}`
      assignments.push(assignment(id, input.userId, input.unitId, {
        positionId: input.positionId,
        teamId: input.teamId,
        isActive: true,
      }))
      return { id }
    },
    async updateAssignment(id, input) {
      const row = assignments.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing assignment ${id}`)
      row.unitId = input.unitId
      row.positionId = input.positionId
      row.teamId = input.teamId
    },
    async deactivateAssignment(id, at) {
      const row = assignments.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing assignment ${id}`)
      row.isActive = false
      deactivatedAt.set(id, at)
    },
    async updateTeamReportsTo(teamId, reportsToAssignmentId) {
      const row = teams.find((candidate) => candidate.id === teamId)
      if (!row) throw new Error(`missing team ${teamId}`)
      row.reportsToAssignmentId = reportsToAssignmentId
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

function asWorkspaceDb(mut: ReturnType<typeof makeMutationDb>): OrganizationWorkspaceDb {
  return {
    async loadUnits() {
      return mut.loadUnits()
    },
    async loadPositions() {
      return mut.loadPositions()
    },
    async loadAssignments() {
      return mut.loadAssignments()
    },
    async loadTeams() {
      return mut.loadTeams()
    },
    async loadUsers() {
      return mut.loadUsers()
    },
    async loadRouteVersions() {
      return []
    },
    async loadCustomChainExceptions() {
      return []
    },
  }
}

function makeSnapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
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
      assignment('asg-alice', 'alice', 'section-a', { teamId: 'team-line' }),
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
        id: 'team-line',
        unitId: 'section-a',
        name: 'Line A',
        reportsToAssignmentId: 'asg-pat',
        isActive: true,
      },
    ],
    users: [
      { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
      { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
      { id: 'unassigned', name: 'Una', email: 'una@example.com', role: 'general_dept', isActive: true },
    ],
    unassignedUsers: [{ id: 'unassigned', name: 'Una', email: 'una@example.com' }],
    routeSources: [],
    customChainExceptions: [],
    readiness: { ready: true, blockers: [] },
    ...over,
  }
}

describe('PersonAssignmentPanel component harness', () => {
  it('confirmation dialog lists old and new unit, position, and team', () => {
    const html = renderToStaticMarkup(createElement(AssignmentChangeSummary, {
      before: { unitName: 'Operations', positionName: 'Manager', teamName: 'Alpha Team' },
      after: { unitName: 'Section A', positionName: 'Staff', teamName: 'None' },
    }))
    assert.match(html, /data-testid="assignment-move-confirmation"/)
    assert.match(html, /Operations/)
    assert.match(html, /Section A/)
    assert.match(html, /Manager/)
    assert.match(html, /Staff/)
    assert.match(html, /Alpha Team/)
    assert.match(html, /None/)
  })

  it('requires choosing a new reports-to in the same confirmation when a move invalidates a team', () => {
    const html = renderToStaticMarkup(createElement(AssignmentChangeSummary, {
      before: { unitName: 'Operations', positionName: 'Manager', teamName: 'None' },
      after: { unitName: 'Section A', positionName: 'Manager', teamName: 'None' },
      invalidatedTeams: [{ id: 'team-alpha', name: 'Alpha Team' }],
      reportsToCorrection: null,
    }))
    assert.match(html, /explicit correction/i)
    assert.match(html, /Alpha Team/)
    assert.match(html, /data-testid="assignment-reports-to-correction"/)
  })

  it('renders assign and existing-assignment panels', () => {
    const snapshot = makeSnapshot()
    const assignHtml = renderToStaticMarkup(createElement(PersonAssignmentPanel, {
      snapshot,
      userId: 'unassigned',
    }))
    assert.match(assignHtml, /data-testid="person-assignment-panel"/)
    assert.match(assignHtml, /Assign person/)
    assert.match(assignHtml, /Una/)

    const moveHtml = renderToStaticMarkup(createElement(PersonAssignmentPanel, {
      snapshot,
      assignmentId: 'asg-alice',
    }))
    assert.match(moveHtml, /data-testid="person-assignment-panel"/)
    assert.match(moveHtml, /Alice/)
    assert.match(moveHtml, /Remove assignment/)
  })

  it('treats a team outside the selected unit as incompatible (explicit reselection)', () => {
    const snapshot = makeSnapshot()
    assert.equal(teamBelongsToUnit('team-line', 'section-a', snapshot.teams), true)
    assert.equal(teamBelongsToUnit('team-line', 'ops', snapshot.teams), false)
    assert.equal(teamBelongsToUnit(null, 'ops', snapshot.teams), true)
  })
})

describe('assignPerson / moveAssignment / removeAssignment fake db', () => {
  it('rejects a second active assignment matching /one active/i without writing', async () => {
    const db = makeMutationDb()
    const before = db.assignments.length
    await assert.rejects(
      () => assignPerson({
        userId: 'pat',
        unitId: 'section-a',
        positionId: 'p-staff',
        teamId: null,
      }, db),
      /one active/i,
    )
    assert.equal(db.assignments.length, before)
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
    assert.deepEqual(db.userRoleWrites, [])
  })

  it('rejects an inactive user matching /inactive/i', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => assignPerson({
        userId: 'old',
        unitId: 'ops',
        positionId: 'p-staff',
        teamId: null,
      }, db),
      /inactive/i,
    )
    assert.equal(db.assignments.some((row) => row.userId === 'old' && row.isActive), false)
    assert.equal(db.audits.length, 0)
  })

  it('rejects a team outside the unit', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => assignPerson({
        userId: 'unassigned',
        unitId: 'section-a',
        positionId: 'p-staff',
        teamId: 'team-alpha',
      }, db),
      /team/i,
    )
    assert.equal(db.assignments.some((row) => row.userId === 'unassigned' && row.isActive), false)
    assert.equal(db.audits.length, 0)
  })

  it('assigns an unassigned active user, audits, and does not write users.role', async () => {
    const db = makeMutationDb()
    const roleBefore = db.users.find((row) => row.id === 'unassigned')?.role
    const result = await assignPerson({
      userId: 'unassigned',
      unitId: 'section-b',
      positionId: 'p-staff',
      teamId: null,
    }, db)
    assert.equal(typeof result.assignmentId, 'string')
    const created = db.assignments.find((row) => row.id === result.assignmentId)
    assert.equal(created?.userId, 'unassigned')
    assert.equal(created?.unitId, 'section-b')
    assert.equal(created?.isActive, true)
    assert.equal(db.audits.length, 1)
    assert.match(db.audits[0].action, /organization_assignment_created/)
    assert.deepEqual(db.revalidated, ['/admin/organization'])
    assert.equal(db.users.find((row) => row.id === 'unassigned')?.role, roleBefore)
    assert.deepEqual(db.userRoleWrites, [])
  })

  it('maps unique-index conflicts to /one active/i', async () => {
    const db = makeMutationDb()
    db.createAssignment = async () => {
      const error = new Error('Unique constraint failed') as Error & { code: string }
      error.code = 'P2002'
      throw error
    }
    await assert.rejects(
      () => assignPerson({
        userId: 'unassigned',
        unitId: 'ops',
        positionId: 'p-staff',
        teamId: null,
      }, db),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match(String(error), /one active/i)
        return true
      },
    )
  })

  it('rejects a concurrent second assign of the same user with /one active/i', async () => {
    const db = makeMutationDb()
    const innerLoad = db.loadAssignments.bind(db)
    let loads = 0
    let releaseFirst!: () => void
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let seenFirst!: () => void
    const firstArrived = new Promise<void>((resolve) => {
      seenFirst = resolve
    })
    db.loadAssignments = async () => {
      const rows = await innerLoad()
      loads += 1
      if (loads === 1) {
        seenFirst()
        await firstHeld
      }
      return rows
    }
    const first = assignPerson({
      userId: 'unassigned',
      unitId: 'ops',
      positionId: 'p-staff',
      teamId: null,
    }, db)
    const second = assignPerson({
      userId: 'unassigned',
      unitId: 'section-b',
      positionId: 'p-staff',
      teamId: null,
    }, db)
    await firstArrived
    await Promise.resolve()
    await Promise.resolve()
    releaseFirst()
    const results = await Promise.allSettled([first, second])
    const fulfilled = results.filter((row) => row.status === 'fulfilled')
    const rejected = results.filter((row) => row.status === 'rejected')
    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 1)
    const reason = rejected[0].status === 'rejected' ? rejected[0].reason : undefined
    assert.equal(reason instanceof OrganizationValidationError, true)
    assert.match(String(reason), /one active/i)
    const active = db.assignments.filter((row) => row.isActive && row.userId === 'unassigned')
    assert.equal(active.length, 1)
  })

  it('rejects a stale team id on move', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => moveAssignment({
        assignmentId: 'asg-alice',
        unitId: 'section-b',
        positionId: 'p-staff',
        teamId: 'team-alpha',
      }, db),
      /team/i,
    )
    assert.equal(db.assignments.find((row) => row.id === 'asg-alice')?.unitId, 'section-a')
    assert.equal(db.audits.length, 0)
  })

  it('rejects a move that invalidates a team reports-to matching /explicit correction/i', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => moveAssignment({
        assignmentId: 'asg-pat',
        unitId: 'section-a',
        positionId: 'p-manager',
        teamId: null,
      }, db),
      /explicit correction/i,
    )
    assert.equal(db.assignments.find((row) => row.id === 'asg-pat')?.unitId, 'ops')
    assert.equal(db.teams.find((row) => row.id === 'team-alpha')?.reportsToAssignmentId, 'asg-pat')
    assert.equal(db.audits.length, 0)
  })

  it('applies an explicit reports-to correction in the same move save', async () => {
    const db = makeMutationDb()
    const result = await moveAssignment({
      assignmentId: 'asg-pat',
      unitId: 'section-a',
      positionId: 'p-manager',
      teamId: null,
      teamReportsToCorrections: [
        { teamId: 'team-alpha', reportsToAssignmentId: 'asg-quinn' },
      ],
    }, db)
    assert.deepEqual(result, { success: true })
    assert.equal(db.assignments.find((row) => row.id === 'asg-pat')?.unitId, 'section-a')
    assert.equal(db.teams.find((row) => row.id === 'team-alpha')?.reportsToAssignmentId, 'asg-quinn')
    assert.equal(db.audits.length, 1)
    assert.match(db.audits[0].action, /organization_assignment_moved/)
    assert.deepEqual(db.userRoleWrites, [])
  })

  it('moves within a unit without touching attempts, role, or reports-to', async () => {
    const db = makeMutationDb()
    const result = await moveAssignment({
      assignmentId: 'asg-alice',
      unitId: 'section-a',
      positionId: 'p-manager',
      teamId: null,
    }, db)
    assert.deepEqual(result, { success: true })
    const alice = db.assignments.find((row) => row.id === 'asg-alice')
    assert.equal(alice?.positionId, 'p-manager')
    assert.equal(alice?.teamId, null)
    assert.equal(alice?.isActive, true)
    assert.equal(db.users.find((row) => row.id === 'alice')?.isActive, true)
    assert.equal(db.users.find((row) => row.id === 'alice')?.role, 'general_dept')
  })

  it('deactivates the assignment on remove, keeps the account, and lists the user as unassigned', async () => {
    const db = makeMutationDb()
    const roleBefore = db.users.find((row) => row.id === 'bob')?.role
    const result = await removeAssignment({ assignmentId: 'asg-bob' }, db)
    assert.deepEqual(result, { success: true })
    const bobAssignment = db.assignments.find((row) => row.id === 'asg-bob')
    assert.equal(bobAssignment?.isActive, false)
    assert.equal(db.deactivatedAt.get('asg-bob') instanceof Date, true)
    const bob = db.users.find((row) => row.id === 'bob')
    assert.equal(bob?.isActive, true)
    assert.equal(bob?.role, roleBefore)
    assert.deepEqual(db.userRoleWrites, [])
    assert.equal(db.audits.length, 1)
    assert.match(db.audits[0].action, /organization_assignment_removed/)
    const snapshot = await getOrganizationWorkspaceData(asWorkspaceDb(db))
    assert.equal(snapshot.assignments.find((row) => row.id === 'asg-bob')?.isActive, false)
    assert.equal(snapshot.users.find((row) => row.id === 'bob')?.isActive, true)
    assert.equal(snapshot.unassignedUsers.some((row) => row.id === 'bob'), true)
  })

  it('does not deactivate a reports-to assignment without explicit correction', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => removeAssignment({ assignmentId: 'asg-pat' }, db),
      /explicit correction/i,
    )
    assert.equal(db.assignments.find((row) => row.id === 'asg-pat')?.isActive, true)
    assert.equal(db.users.find((row) => row.id === 'pat')?.isActive, true)
  })
})

describe('C6 source contracts', () => {
  it('keeps Serializable one-active uniqueness, deactivatedAt removal, and never writes users.role', () => {
    const panel = read('src/components/organization/PersonAssignmentPanel.tsx')
    assert.match(panel, /AssignmentChangeSummary/)
    assert.match(panel, /assignment-move-confirmation/)
    assert.match(panel, /explicit correction/i)
    assert.match(panel, /Remove assignment/)
    assert.doesNotMatch(panel, /users\.role/)

    const actions = read('src/server-actions/organization.ts')
    assert.match(actions, /export async function assignPerson/)
    assert.match(actions, /export async function moveAssignment/)
    assert.match(actions, /export async function removeAssignment/)
    assert.match(actions, /isolationLevel: 'Serializable'/)
    assert.match(actions, /one active assignment/i)
    assert.match(actions, /deactivatedAt/)
    assert.match(actions, /explicit correction/i)
    assert.match(actions, /P2002/)

    const assignFn = actions.slice(actions.indexOf('export async function assignPerson'))
    const moveStart = assignFn.indexOf('export async function moveAssignment')
    const removeStart = assignFn.indexOf('export async function removeAssignment')
    const assignOnly = assignFn.slice(0, moveStart)
    const moveOnly = assignFn.slice(moveStart, removeStart)
    const removeOnly = assignFn.slice(removeStart)
    for (const fn of [assignOnly, moveOnly, removeOnly]) {
      assert.doesNotMatch(fn, /user\.update/)
      assert.doesNotMatch(fn, /users\.update/)
      assert.doesNotMatch(fn, /data:\s*\{[^}]*role/)
      assert.doesNotMatch(fn, /approval_instances/)
    }

    const workspace = read('src/components/organization/OrganizationWorkspace.tsx')
    assert.match(workspace, /PersonAssignmentPanel/)
    assert.match(workspace, /onSelectPerson/)

    const tree = read('src/components/organization/TreeNodeRow.tsx')
    assert.match(tree, /onSelectPerson/)
  })
})
