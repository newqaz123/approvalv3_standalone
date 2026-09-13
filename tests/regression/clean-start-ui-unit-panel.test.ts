// Clean-start unit side panel (Plan C Task 5).
// Component harness: renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-tree.test.ts).
// Action tests: in-memory fake OrganizationUnitMutationDb only.
// NO Prisma, NO database, NO env, NO schema/server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import { OrganizationValidationError } from '@/lib/organization/assignments'
import {
  createOrganizationUnit,
  setUnitManager,
  updateUnitSettings,
  type OrganizationMutationDb,
  type OrganizationUnitMutationDb,
  type WorkspaceSnapshot,
} from '@/server-actions/organization'
import {
  UnitSidePanel,
  directManagerCandidates,
  formatRouteSourceLabel,
} from '@/components/organization/UnitSidePanel'

const read = (path: string) => readFileSync(path, 'utf8')
const SHARE_LABEL = 'Share requests within this unit and all its descendants'

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
  const teams = (over.teams ?? []).map((row) => ({ ...row }))
  const positions = (over.positions ?? [
    { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
    { id: 'p-manager', name: 'Manager', rank: 3, isActive: true },
  ]).map((row) => ({ ...row }))
  const assignments = (over.assignments ?? [
    assignment('asg-pat', 'pat', 'ops', { positionId: 'p-manager' }),
    assignment('asg-casey', 'casey', 'ops'),
    assignment('asg-alice', 'alice', 'section-a'),
    assignment('asg-old', 'old', 'ops', { isActive: false }),
  ]).map((row) => ({ ...row }))
  const users = (over.users ?? [
    { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
    { id: 'casey', name: 'Casey', email: 'casey@example.com', role: 'general_dept', isActive: true },
    { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
    { id: 'old', name: 'Old', email: 'old@example.com', role: 'general_dept', isActive: false },
  ]).map((row) => ({ ...row }))
  const audits: Array<{ action: string; comments: string }> = []
  const revalidated: string[] = []
  let created = 0
  let exclusive = Promise.resolve()
  const db: OrganizationUnitMutationDb & {
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
    async createUnit(input) {
      created += 1
      const id = `unit-new-${created}`
      units.push(unit(id, input.name, input.parentId, {
        shareRequests: true,
        canWorkOnSolutions: false,
        managerUserId: null,
      }))
      return { id }
    },
    async updateUnitSettings(id, shareRequests, canWorkOnSolutions) {
      const row = units.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing unit ${id}`)
      row.shareRequests = shareRequests
      row.canWorkOnSolutions = canWorkOnSolutions
    },
    async updateUnitManager(unitId, managerUserId) {
      const row = units.find((candidate) => candidate.id === unitId)
      if (!row) throw new Error(`missing unit ${unitId}`)
      row.managerUserId = managerUserId
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

const assignments: AssignmentNode[] = [
  assignment('asg-pat', 'pat', 'ops', { positionId: 'p-manager' }),
  assignment('asg-casey', 'casey', 'ops'),
  assignment('asg-alice', 'alice', 'section-a'),
  assignment('asg-old', 'old', 'ops', { isActive: false }),
]

const units: OrganizationUnitNode[] = [
  unit('company', 'Company', null),
  unit('ops', 'Operations', 'company', { shareRequests: true, managerUserId: 'pat' }),
  unit('section-a', 'Section A', 'ops', { shareRequests: true }),
]

function makeSnapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    units,
    positions,
    assignments,
    teams: [],
    users: [
      { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
      { id: 'casey', name: 'Casey', email: 'casey@example.com', role: 'general_dept', isActive: true },
      { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
      { id: 'old', name: 'Old', email: 'old@example.com', role: 'general_dept', isActive: false },
    ],
    unassignedUsers: [],
    routeSources: [
      {
        unitId: 'section-a',
        phase: 'REQUEST',
        source: 'INHERITED',
        sourceUnitId: 'ops',
        publishedVersionId: 'rv-ops-request',
        hasDraft: false,
      },
      {
        unitId: 'section-a',
        phase: 'SOLUTION',
        source: 'ROOT_DEFAULT',
        sourceUnitId: 'company',
        publishedVersionId: 'rv-root-solution',
        hasDraft: false,
      },
      {
        unitId: 'section-a',
        phase: 'FINAL',
        source: 'ROOT_DEFAULT',
        sourceUnitId: 'company',
        publishedVersionId: 'rv-root-final',
        hasDraft: false,
      },
      {
        unitId: 'ops',
        phase: 'REQUEST',
        source: 'CUSTOM',
        sourceUnitId: 'ops',
        publishedVersionId: 'rv-ops-request',
        hasDraft: false,
      },
    ],
    customChainExceptions: [],
    readiness: { ready: true, blockers: [] },
    ...over,
  }
}

describe('UnitSidePanel component harness', () => {
  it('titles the panel with the unit name, uses exact sharing copy, and shows Inherited from Operations for Section A REQUEST', () => {
    const snapshot = makeSnapshot()
    const sectionA = snapshot.units.find((row) => row.id === 'section-a')
    assert.ok(sectionA)
    const html = renderToStaticMarkup(createElement(UnitSidePanel, {
      unit: sectionA,
      snapshot,
    }))
    // Owner-approved: the drawer title is the unit NAME (no "Manage " prefix).
    assert.match(html, /<h2[^>]*>Section A<\/h2>/)
    assert.doesNotMatch(html, /Manage Section A/)
    assert.match(html, /Share requests within this unit and all its descendants/)
    assert.equal(html.includes(SHARE_LABEL), true)
    assert.doesNotMatch(html, /exclud/i)
    assert.doesNotMatch(html, /except child/i)
    assert.doesNotMatch(html, /not include child/i)
    assert.match(html, /Can work on solutions/)
    assert.match(html, /Inherited from Operations/)
    assert.match(html, />View</)
    assert.match(html, />Customize</)
    assert.doesNotMatch(html, /ApprovalChainsPanel/)
  })

  it('lists only active direct assignees as manager candidates', () => {
    const snapshot = makeSnapshot()
    const ops = directManagerCandidates(snapshot, 'ops').map((row) => row.userId).sort()
    assert.deepEqual(ops, ['casey', 'pat'])
    assert.equal(ops.includes('alice'), false)
    assert.equal(ops.includes('old'), false)
    const sectionA = directManagerCandidates(snapshot, 'section-a').map((row) => row.userId)
    assert.deepEqual(sectionA, ['alice'])
  })

  it('formats effective route source labels per phase', () => {
    assert.equal(formatRouteSourceLabel('ROOT_DEFAULT', 'Company'), 'Uses company default')
    assert.equal(formatRouteSourceLabel('INHERITED', 'Operations'), 'Inherited from Operations')
    assert.equal(formatRouteSourceLabel('CUSTOM', 'Operations'), 'Custom at this unit')
  })
})

describe('createOrganizationUnit / updateUnitSettings / setUnitManager fake db', () => {
  it('rejects createOrganizationUnit without parent matching /parent required/i', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => createOrganizationUnit({ name: 'Orphan', parentId: '' }, db),
      /parent required/i,
    )
    await assert.rejects(
      () => createOrganizationUnit({ name: 'Orphan' } as { name: string; parentId: string }, db),
      /parent required/i,
    )
    assert.equal(db.units.some((row) => row.name === 'Orphan'), false)
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('rejects a duplicate sibling name matching /unique/i without writing', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => createOrganizationUnit({ name: 'Section A', parentId: 'ops' }, db),
      /unique/i,
    )
    assert.equal(db.units.filter((row) => row.parentId === 'ops' && row.name === 'Section A').length, 1)
    assert.equal(db.audits.length, 0)
  })

  it('creates a unique child, audits, and revalidates', async () => {
    const db = makeMutationDb()
    const result = await createOrganizationUnit({ name: '  Section C  ', parentId: 'ops' }, db)
    assert.equal(typeof result.id, 'string')
    const created = db.units.find((row) => row.id === result.id)
    assert.equal(created?.name, 'Section C')
    assert.equal(created?.parentId, 'ops')
    assert.equal(db.audits.length, 1)
    assert.match(db.audits[0].action, /organization_unit_created/)
    assert.deepEqual(db.revalidated, ['/admin/organization'])
  })

  it('rejects setUnitManager with a user assigned to a different unit matching /directly/i', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => setUnitManager({ unitId: 'ops', managerUserId: 'alice' }, db),
      /directly/i,
    )
    assert.equal(db.units.find((row) => row.id === 'ops')?.managerUserId, 'pat')
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('rejects setUnitManager with an inactive assignment matching /directly/i', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => setUnitManager({ unitId: 'ops', managerUserId: 'old' }, db),
      /directly/i,
    )
    assert.equal(db.units.find((row) => row.id === 'ops')?.managerUserId, 'pat')
  })

  it('rejects setUnitManager with an inactive user who has an active direct assignment matching /inactive/i', async () => {
    const db = makeMutationDb()
    const casey = db.users.find((row) => row.id === 'casey')
    assert.ok(casey)
    casey.isActive = false
    const direct = db.assignments.find((row) => row.userId === 'casey' && row.unitId === 'ops')
    assert.equal(direct?.isActive, true)
    await assert.rejects(
      () => setUnitManager({ unitId: 'ops', managerUserId: 'casey' }, db),
      /inactive/i,
    )
    assert.equal(db.units.find((row) => row.id === 'ops')?.managerUserId, 'pat')
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('persists sharing and solutions toggles in the fake db', async () => {
    const db = makeMutationDb()
    const result = await updateUnitSettings({
      id: 'ops',
      shareRequests: false,
      canWorkOnSolutions: true,
    }, db)
    assert.deepEqual(result, { success: true })
    const ops = db.units.find((row) => row.id === 'ops')
    assert.equal(ops?.shareRequests, false)
    assert.equal(ops?.canWorkOnSolutions, true)
    assert.equal(db.audits.length, 1)
    assert.match(db.audits[0].action, /organization_unit_settings_updated/)
    assert.deepEqual(db.revalidated, ['/admin/organization'])
  })

  it('sets a direct manager after validateOrganization and writes', async () => {
    const db = makeMutationDb()
    const result = await setUnitManager({ unitId: 'ops', managerUserId: 'casey' }, db)
    assert.deepEqual(result, { success: true })
    assert.equal(db.units.find((row) => row.id === 'ops')?.managerUserId, 'casey')
    assert.equal(db.audits.length, 1)
    assert.match(db.audits[0].action, /organization_unit_manager_set/)
    assert.deepEqual(db.revalidated, ['/admin/organization'])
  })

  it('rejects a concurrent sibling create to the same unused name with /unique/i', async () => {
    const db = makeMutationDb()
    const innerLoad = db.loadUnits.bind(db)
    let loads = 0
    let releaseFirst!: () => void
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let seenFirst!: () => void
    const firstArrived = new Promise<void>((resolve) => {
      seenFirst = resolve
    })
    db.loadUnits = async () => {
      const rows = await innerLoad()
      loads += 1
      if (loads === 1) {
        seenFirst()
        await firstHeld
      }
      return rows
    }
    const first = createOrganizationUnit({ name: 'Shared', parentId: 'ops' }, db)
    const second = createOrganizationUnit({ name: 'Shared', parentId: 'ops' }, db)
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
    assert.match(String(reason), /unique/i)
    const shared = db.units.filter((row) => row.isActive && row.parentId === 'ops' && row.name === 'Shared')
    assert.equal(shared.length, 1)
  })
})

describe('C5 source contracts', () => {
  it('keeps exact toggle copy, leftover SECTION, Serializable uniqueness, and validateOrganization before manager write', () => {
    const panel = read('src/components/organization/UnitSidePanel.tsx')
    assert.match(panel, /Share requests within this unit and all its descendants/)
    assert.doesNotMatch(panel, /exclud/i)
    assert.match(panel, /Can work on solutions/)
    assert.doesNotMatch(panel, /Manage \$\{/, 'unit panel title must be the unit name alone')
    assert.doesNotMatch(panel, /ApprovalChainsPanel/)

    const actions = read('src/server-actions/organization.ts')
    assert.match(actions, /export async function createOrganizationUnit/)
    assert.match(actions, /export async function updateUnitSettings/)
    assert.match(actions, /export async function setUnitManager/)
    assert.match(actions, /isolationLevel: 'Serializable'/)
    assert.match(actions, /validateOrganization/)
    assert.match(actions, /Parent required/)
    const setManagerFn = actions.slice(actions.indexOf('export async function setUnitManager'))
    assert.match(setManagerFn, /loadUsers/)
    assert.match(setManagerFn, /inactive/i)

    const tree = read('src/components/organization/TreeNodeRow.tsx')
    assert.match(tree, /event\.target === event\.currentTarget/)

    const seed = read('prisma/seed.ts')
    assert.match(seed, /cs-route-ops-request/)
    assert.match(seed, /CS\.unit\.operations/)

    const workspace = read('src/components/organization/OrganizationWorkspace.tsx')
    assert.match(workspace, /UnitSidePanel/)
    assert.match(workspace, /onSelectUnit/)

    const _renameDb: OrganizationMutationDb | undefined = undefined
    assert.equal(_renameDb, undefined)
  })
})
