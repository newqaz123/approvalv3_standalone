// Clean-start position administration (Plan C Task 8).
// Component harness: renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-team.test.ts).
// Action tests: in-memory fake OrganizationPositionMutationDb only.
// NO Prisma, NO database, NO env, NO schema/server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  AssignmentNode,
  OrganizationUnitNode,
  PositionNode,
  TeamNode,
} from '@/lib/organization/model'
import type { RankChangeImpact } from '@/lib/organization/position-rank-guard'
import { OrganizationValidationError } from '@/lib/organization/assignments'
import {
  changePositionRank,
  createPosition,
  deactivatePosition,
  renamePosition,
  type OrganizationPositionMutationDb,
  type WorkspaceSnapshot,
} from '@/server-actions/organization'
import {
  PositionAdminPanel,
  PositionRankEditor,
  PositionRankImpactList,
  applyRankSaveOutcome,
  cancelRankEditSession,
  idleRankEditSession,
  requestRankSave,
  startRankEditSession,
  typeRankDraft,
  type PositionRankEditSession,
} from '@/components/organization/PositionAdminPanel'

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

function position(
  id: string,
  name: string,
  rank: number,
  extra: Partial<PositionNode> = {},
): PositionNode {
  return { id, name, rank, isActive: true, ...extra }
}

const fixtureUnits = (): OrganizationUnitNode[] => [
  unit('company', 'Company', null),
  unit('ops', 'Operations', 'company'),
  unit('section-a', 'Section A', 'ops'),
  unit('section-b', 'Section B', 'ops'),
]

const fixturePositions = (): PositionNode[] => [
  position('p-staff', 'Staff', 1),
  position('p-lead', 'Lead', 2),
  position('p-manager', 'Manager', 3),
  position('p-director', 'Director', 4),
  position('p-coordinator', 'Coordinator', 6),
  position('p-old', 'Old Position', 9, { isActive: false }),
]

const fixtureAssignments = (): AssignmentNode[] => [
  assignment('asg-riley', 'riley', 'section-a', { positionId: 'p-manager' }),
  assignment('asg-quinn', 'quinn', 'section-a', { positionId: 'p-lead', teamId: 'team-line-a' }),
  assignment('asg-casey', 'casey', 'section-a', { positionId: 'p-lead', teamId: 'team-line-a' }),
  assignment('asg-alice', 'alice', 'section-a', { positionId: 'p-staff', teamId: 'team-line-a' }),
  assignment('asg-bob', 'bob', 'section-b', { positionId: 'p-staff' }),
  assignment('asg-old', 'old', 'section-a', { positionId: 'p-manager', isActive: false }),
]

const fixtureTeams = (): TeamNode[] => [
  {
    id: 'team-line-a',
    unitId: 'section-a',
    name: 'Line A',
    reportsToAssignmentId: 'asg-riley',
    isActive: true,
  },
]

interface PublishedRouteFixture {
  id: string
  scopeUnitId: string
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  approvalLimitPositionId: string | null
  steps: ReadonlyArray<{ stepOrder: number; positionId: string | null }>
}

// Historical approval attempt snapshots (option A immutable instances):
// rows reference positions by id and capture display strings at request time.
// Position administration must never rewrite them — captured labels outlive
// renames, rank changes, and deactivation.
interface CapturedApprovalInstance {
  id: string
  requestId: string | null
  solutionId: string | null
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  state: string
  attempt: number
  originPositionId: string | null
}

interface CapturedApprovalRow {
  id: string
  requestId: string | null
  solutionId: string | null
  instanceId: string | null
  order: number
  status: string
  requiredPositionId: string | null
}

interface CapturedCandidateGroup {
  id: string
  approvalInstanceId: string
  scopeUnitId: string
  requiredPositionId: string | null
  capturedAt: string
}

interface CapturedCandidateGroupMember {
  candidateGroupId: string
  userId: string
  capturedAt: string
  capturedDisplayName: string
}

function fixtureApprovalSnapshots() {
  return {
    approvalInstances: [
      {
        id: 'inst-req-1',
        requestId: 'req-1',
        solutionId: null,
        phase: 'REQUEST',
        state: 'APPROVED',
        attempt: 1,
        originPositionId: 'p-coordinator',
      },
      {
        id: 'inst-sol-1',
        requestId: null,
        solutionId: 'sol-1',
        phase: 'SOLUTION',
        state: 'APPROVED',
        attempt: 1,
        originPositionId: 'p-manager',
      },
    ] satisfies CapturedApprovalInstance[],
    requestApprovals: [
      {
        id: 'ra-req-1',
        requestId: 'req-1',
        solutionId: null,
        instanceId: 'inst-req-1',
        order: 1,
        status: 'approved',
        requiredPositionId: 'p-coordinator',
      },
    ] satisfies CapturedApprovalRow[],
    solutionApprovals: [
      {
        id: 'sa-sol-1',
        requestId: null,
        solutionId: 'sol-1',
        instanceId: 'inst-sol-1',
        order: 1,
        status: 'approved',
        requiredPositionId: 'p-manager',
      },
    ] satisfies CapturedApprovalRow[],
    candidateGroups: [
      {
        id: 'cg-req-1',
        approvalInstanceId: 'inst-req-1',
        scopeUnitId: 'section-b',
        requiredPositionId: 'p-coordinator',
        capturedAt: '2026-01-05T09:15:00.000Z',
      },
    ] satisfies CapturedCandidateGroup[],
    candidateGroupMembers: [
      {
        candidateGroupId: 'cg-req-1',
        userId: 'bob',
        capturedAt: '2026-01-05T09:15:00.000Z',
        capturedDisplayName: 'Bob — Coordinator',
      },
    ] satisfies CapturedCandidateGroupMember[],
  }
}

const fixturePublishedRoutes = (): PublishedRouteFixture[] => [
  {
    id: 'route-root-request',
    scopeUnitId: 'company',
    phase: 'REQUEST',
    approvalLimitPositionId: 'p-director',
    steps: [
      { stepOrder: 1, positionId: 'p-lead' },
      { stepOrder: 2, positionId: 'p-manager' },
      { stepOrder: 3, positionId: 'p-director' },
    ],
  },
  {
    id: 'route-ops-request',
    scopeUnitId: 'ops',
    phase: 'REQUEST',
    approvalLimitPositionId: 'p-director',
    steps: [
      { stepOrder: 1, positionId: 'p-lead' },
      { stepOrder: 2, positionId: 'p-manager' },
      { stepOrder: 3, positionId: 'p-director' },
    ],
  },
]

function makePositionMutationDb(over: {
  positions?: PositionNode[]
  assignments?: AssignmentNode[]
  teams?: TeamNode[]
  units?: OrganizationUnitNode[]
  publishedRoutes?: PublishedRouteFixture[]
} = {}) {
  const units = (over.units ?? fixtureUnits()).map((row) => ({ ...row }))
  const positions = (over.positions ?? fixturePositions()).map((row) => ({ ...row }))
  const assignments = (over.assignments ?? fixtureAssignments()).map((row) => ({ ...row }))
  const teams = (over.teams ?? fixtureTeams()).map((row) => ({ ...row }))
  const publishedRoutes = (over.publishedRoutes ?? fixturePublishedRoutes())
    .map((row) => ({ ...row, steps: row.steps.map((step) => ({ ...step })) }))
  const snapshots = fixtureApprovalSnapshots()
  const approvalInstances = snapshots.approvalInstances.map((row) => ({ ...row }))
  const requestApprovals = snapshots.requestApprovals.map((row) => ({ ...row }))
  const solutionApprovals = snapshots.solutionApprovals.map((row) => ({ ...row }))
  const candidateGroups = snapshots.candidateGroups.map((row) => ({ ...row }))
  const candidateGroupMembers = snapshots.candidateGroupMembers.map((row) => ({ ...row }))
  const audits: Array<{ action: string; comments: string }> = []
  const revalidated: string[] = []
  const instanceWrites: string[] = []
  const userRoleWrites: Array<{ userId: string; role: string }> = []
  let created = 0
  let exclusive = Promise.resolve()
  const db: OrganizationPositionMutationDb & {
    units: OrganizationUnitNode[]
    positions: PositionNode[]
    assignments: AssignmentNode[]
    teams: TeamNode[]
    publishedRoutes: PublishedRouteFixture[]
    audits: Array<{ action: string; comments: string }>
    revalidated: string[]
    instanceWrites: string[]
    userRoleWrites: Array<{ userId: string; role: string }>
    approvalInstances: CapturedApprovalInstance[]
    requestApprovals: CapturedApprovalRow[]
    solutionApprovals: CapturedApprovalRow[]
    candidateGroups: CapturedCandidateGroup[]
    candidateGroupMembers: CapturedCandidateGroupMember[]
    updateApprovalInstance(id: string, patch: Partial<CapturedApprovalInstance>): Promise<void>
    updateRequestApproval(id: string, patch: Partial<CapturedApprovalRow>): Promise<void>
    updateSolutionApproval(id: string, patch: Partial<CapturedApprovalRow>): Promise<void>
    updateApprovalCandidateGroup(id: string, patch: Partial<CapturedCandidateGroup>): Promise<void>
    updateApprovalCandidateGroupMember(
      candidateGroupId: string,
      userId: string,
      patch: Partial<CapturedCandidateGroupMember>,
    ): Promise<void>
    updateUserRole(userId: string, role: string): Promise<void>
  } = {
    adminUserId: 'admin-1',
    units,
    positions,
    assignments,
    teams,
    publishedRoutes,
    audits,
    revalidated,
    instanceWrites,
    userRoleWrites,
    approvalInstances,
    requestApprovals,
    solutionApprovals,
    candidateGroups,
    candidateGroupMembers,
    async loadUnits() {
      return units.map((row) => ({ ...row }))
    },
    async loadPositions() {
      return positions.map((row) => ({ ...row }))
    },
    async loadAssignments() {
      return assignments.map((row) => ({ ...row }))
    },
    async loadTeams() {
      return teams.map((row) => ({ ...row }))
    },
    async loadUsers() {
      return []
    },
    async loadPublishedRoutes() {
      return publishedRoutes.map((row) => ({
        ...row,
        steps: row.steps.map((step) => ({ ...step })),
      }))
    },
    async updateUnitName() {
      throw new Error('updateUnitName not used by C8')
    },
    async updateTeamName() {
      throw new Error('updateTeamName not used by C8')
    },
    async createUnit() {
      throw new Error('createUnit not used by C8')
    },
    async updateUnitSettings() {
      throw new Error('updateUnitSettings not used by C8')
    },
    async updateUnitManager() {
      throw new Error('updateUnitManager not used by C8')
    },
    async createAssignment() {
      throw new Error('createAssignment not used by C8')
    },
    async updateAssignment() {
      throw new Error('updateAssignment not used by C8')
    },
    async deactivateAssignment() {
      throw new Error('deactivateAssignment not used by C8')
    },
    async updateTeamReportsTo() {
      throw new Error('updateTeamReportsTo not used by C8')
    },
    async createTeam() {
      throw new Error('createTeam not used by C8')
    },
    async setAssignmentTeam() {
      throw new Error('setAssignmentTeam not used by C8')
    },
    async createPosition(input) {
      created += 1
      const id = `position-new-${created}`
      positions.push({ id, name: input.name, rank: input.rank, isActive: true })
      return { id }
    },
    async updatePositionName(id, name) {
      const row = positions.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing position ${id}`)
      row.name = name
    },
    async updatePositionRank(id, rank) {
      const row = positions.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing position ${id}`)
      row.rank = rank
    },
    async deactivatePosition(id) {
      const row = positions.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing position ${id}`)
      row.isActive = false
    },
    // Forbidden persistence recorders (C8-fix1 P2): position administration
    // must never write historical approval rows or user roles. These surface
    // the forbidden write into instanceWrites/userRoleWrites — and mutate the
    // captured fixtures — so the zero-write assertions can actually fail.
    async updateApprovalInstance(id, patch) {
      const row = approvalInstances.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing approval instance ${id}`)
      instanceWrites.push(`approval_instances.update:${id}`)
      Object.assign(row, patch)
    },
    async updateRequestApproval(id, patch) {
      const row = requestApprovals.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing request approval ${id}`)
      instanceWrites.push(`request_approvals.update:${id}`)
      Object.assign(row, patch)
    },
    async updateSolutionApproval(id, patch) {
      const row = solutionApprovals.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing solution approval ${id}`)
      instanceWrites.push(`solution_approvals.update:${id}`)
      Object.assign(row, patch)
    },
    async updateApprovalCandidateGroup(id, patch) {
      const row = candidateGroups.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing candidate group ${id}`)
      instanceWrites.push(`approval_candidate_groups.update:${id}`)
      Object.assign(row, patch)
    },
    async updateApprovalCandidateGroupMember(candidateGroupId, userId, patch) {
      const row = candidateGroupMembers.find((candidate) => (
        candidate.candidateGroupId === candidateGroupId && candidate.userId === userId
      ))
      if (!row) throw new Error(`missing candidate group member ${candidateGroupId}:${userId}`)
      instanceWrites.push(`approval_candidate_group_members.update:${candidateGroupId}:${userId}`)
      Object.assign(row, patch)
    },
    async updateUserRole(userId, role) {
      userRoleWrites.push({ userId, role })
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

function makeSnapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    units: fixtureUnits(),
    positions: fixturePositions(),
    assignments: fixtureAssignments(),
    teams: fixtureTeams(),
    users: [
      { id: 'riley', name: 'Riley', email: 'riley@example.com', role: 'general_dept', isActive: true },
      { id: 'quinn', name: 'Quinn', email: 'quinn@example.com', role: 'general_dept', isActive: true },
      { id: 'casey', name: 'Casey', email: 'casey@example.com', role: 'general_dept', isActive: true },
      { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
      { id: 'bob', name: 'Bob', email: 'bob@example.com', role: 'general_dept', isActive: true },
    ],
    unassignedUsers: [],
    routeSources: [],
    customChainExceptions: [],
    readiness: { ready: true, blockers: [] },
    ...over,
  }
}

// Lead 2 → 5 breaks Line A's reports-to (Manager 3 no longer strictly above
// members Quinn/Casey at Lead 5) and both published routes (Lead 5 no longer
// ascends into Manager 3 and exceeds the Director 4 limit).
const leadToFiveImpact: RankChangeImpact = {
  blocked: true,
  affectedReportingRelationships: [
    { teamId: 'team-line-a', teamName: 'Line A', unitId: 'section-a' },
  ],
  affectedPublishedRoutes: [
    { routeVersionId: 'route-root-request', scopeUnitId: 'company', phase: 'REQUEST', problem: 'STEP_NOT_ASCENDING' },
    { routeVersionId: 'route-root-request', scopeUnitId: 'company', phase: 'REQUEST', problem: 'STEP_EXCEEDS_LIMIT' },
    { routeVersionId: 'route-ops-request', scopeUnitId: 'ops', phase: 'REQUEST', problem: 'STEP_NOT_ASCENDING' },
    { routeVersionId: 'route-ops-request', scopeUnitId: 'ops', phase: 'REQUEST', problem: 'STEP_EXCEEDS_LIMIT' },
  ],
}

function cloneFixture(db: ReturnType<typeof makePositionMutationDb>) {
  return {
    positions: db.positions.map((row) => ({ ...row })),
    assignments: db.assignments.map((row) => ({ ...row })),
    teams: db.teams.map((row) => ({ ...row })),
    publishedRoutes: db.publishedRoutes.map((row) => ({
      ...row,
      steps: row.steps.map((step) => ({ ...step })),
    })),
    approvalInstances: db.approvalInstances.map((row) => ({ ...row })),
    requestApprovals: db.requestApprovals.map((row) => ({ ...row })),
    solutionApprovals: db.solutionApprovals.map((row) => ({ ...row })),
    candidateGroups: db.candidateGroups.map((row) => ({ ...row })),
    candidateGroupMembers: db.candidateGroupMembers.map((row) => ({ ...row })),
  }
}

// C8-fix1 P2: compare the captured snapshot fixture across successful
// mutations — renames/rank changes/deactivations must leave every captured
// row byte-identical (labels keep the strings captured at request time).
function assertCapturedSnapshotsUnchanged(
  db: ReturnType<typeof makePositionMutationDb>,
  before: ReturnType<typeof cloneFixture>,
) {
  assert.deepEqual(db.approvalInstances, before.approvalInstances)
  assert.deepEqual(db.requestApprovals, before.requestApprovals)
  assert.deepEqual(db.solutionApprovals, before.solutionApprovals)
  assert.deepEqual(db.candidateGroups, before.candidateGroups)
  assert.deepEqual(db.candidateGroupMembers, before.candidateGroupMembers)
}

describe('PositionAdminPanel component harness', () => {
  it('lists active positions with name, rank, and assignment count; hides inactive', () => {
    const html = renderToStaticMarkup(createElement(PositionAdminPanel, {
      snapshot: makeSnapshot(),
    }))
    assert.match(html, /data-testid="position-admin-panel"/)
    assert.match(html, /data-testid="position-list"/)
    for (const id of ['p-staff', 'p-lead', 'p-manager', 'p-director', 'p-coordinator']) {
      assert.match(html, new RegExp(`data-testid="position-row-${id}"`))
      assert.match(html, new RegExp(`data-testid="position-rank-edit-${id}"`))
      assert.match(html, new RegExp(`data-testid="position-deactivate-${id}"`))
    }
    assert.doesNotMatch(html, /data-testid="position-row-p-old"/)
    assert.doesNotMatch(html, /Old Position/)
    const lead = html.slice(html.indexOf('data-testid="position-row-p-lead"'))
    assert.match(lead, /Lead/)
    assert.match(html, /data-testid="position-rank-p-lead"[^>]*>Rank 2</)
    assert.match(html, /data-testid="position-assignment-count-p-staff"[^>]*>2 active assignment\(s\)</)
    assert.match(html, /data-testid="position-assignment-count-p-manager"[^>]*>1 active assignment\(s\)</)
    assert.match(html, /data-testid="position-assignment-count-p-director"[^>]*>0 active assignment\(s\)</)
    assert.match(html, /data-testid="position-create-name"/)
    assert.match(html, /data-testid="position-create-rank"/)
    assert.match(html, /data-testid="position-create-save"/)
    assert.match(html, /data-testid="position-panel-close"/)
  })

  it('blocked rank edit renders team names and route problems adjacent to the rank input; save disabled', () => {
    const html = renderToStaticMarkup(createElement(PositionRankEditor, {
      position: { id: 'p-lead', name: 'Lead', rank: 2 },
      draftRank: '5',
      blockedImpact: leadToFiveImpact,
      unitNames: new Map([['company', 'Company'], ['ops', 'Operations'], ['section-a', 'Section A']]),
      onDraftRankChange: () => {},
      onSave: () => {},
      onCancel: () => {},
    }))
    assert.match(html, /data-testid="position-rank-editor-p-lead"/)
    assert.match(html, /data-testid="position-rank-input-p-lead"/)
    const inputAt = html.indexOf('data-testid="position-rank-input-p-lead"')
    const impactAt = html.indexOf('data-testid="position-rank-impact"')
    assert.ok(inputAt >= 0 && impactAt > inputAt, 'impact list must render after the rank input')
    assert.match(html, /data-testid="position-rank-impact-teams"/)
    assert.match(html, /Line A/)
    assert.match(html, /data-testid="position-rank-impact-routes"/)
    assert.match(html, /Company REQUEST/)
    assert.match(html, /Operations REQUEST/)
    assert.match(html, /STEP_NOT_ASCENDING/)
    assert.match(html, /STEP_EXCEEDS_LIMIT/)
    assert.match(html, /data-testid="position-rank-save-p-lead"[^>]*disabled/)
    assert.match(html, /data-testid="position-rank-cancel-p-lead"/)
  })

  it('unblocked rank edit keeps save enabled and renders no impact list', () => {
    const html = renderToStaticMarkup(createElement(PositionRankEditor, {
      position: { id: 'p-coordinator', name: 'Coordinator', rank: 6 },
      draftRank: '7',
      blockedImpact: null,
      unitNames: new Map(),
      onDraftRankChange: () => {},
      onSave: () => {},
      onCancel: () => {},
    }))
    assert.match(html, /data-testid="position-rank-editor-p-coordinator"/)
    assert.doesNotMatch(html, /data-testid="position-rank-impact"/)
    assert.doesNotMatch(html, /data-testid="position-rank-save-p-coordinator"[^>]*disabled/)
  })

  it('PositionRankImpactList renders guard lists verbatim', () => {
    const html = renderToStaticMarkup(createElement(PositionRankImpactList, {
      impact: leadToFiveImpact,
      unitNames: new Map([['company', 'Company'], ['ops', 'Operations']]),
    }))
    assert.match(html, /data-testid="position-rank-impact-teams"/)
    assert.match(html, /data-testid="position-rank-impact-team-team-line-a"/)
    assert.match(html, /data-testid="position-rank-impact-route-route-root-request-STEP_NOT_ASCENDING"/)
    assert.match(html, /data-testid="position-rank-impact-route-route-root-request-STEP_EXCEEDS_LIMIT"/)
    assert.match(html, /data-testid="position-rank-impact-route-route-ops-request-STEP_NOT_ASCENDING"/)
    assert.match(html, /data-testid="position-rank-impact-route-route-ops-request-STEP_EXCEEDS_LIMIT"/)
  })
})

describe('createPosition fake db', () => {
  it('rejects a duplicate active name matching /unique/i and writes nothing', async () => {
    const db = makePositionMutationDb()
    const before = cloneFixture(db)
    await assert.rejects(
      () => createPosition({ name: 'Lead', rank: 7 }, db),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match(String(error), /unique/i)
        return true
      },
    )
    assert.deepEqual(db.positions.map((row) => row.name), before.positions.map((row) => row.name))
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.instanceWrites, [])
  })

  it('rejects an active rank collision matching /unique/i', async () => {
    const db = makePositionMutationDb()
    await assert.rejects(
      () => createPosition({ name: 'Night Shift', rank: 3 }, db),
      /unique/i,
    )
    assert.equal(db.positions.some((row) => row.name === 'Night Shift'), false)
    assert.equal(db.audits.length, 0)
  })

  it('rejects non-positive and non-integer ranks matching /positive integer/i', async () => {
    const db = makePositionMutationDb()
    await assert.rejects(() => createPosition({ name: 'Night Shift', rank: 0 }, db), /positive integer/i)
    await assert.rejects(() => createPosition({ name: 'Night Shift', rank: -2 }, db), /positive integer/i)
    await assert.rejects(() => createPosition({ name: 'Night Shift', rank: 2.5 }, db), /positive integer/i)
    assert.equal(db.positions.some((row) => row.name === 'Night Shift'), false)
    assert.equal(db.audits.length, 0)
  })

  it('creates a position, audits, and revalidates; captured snapshots untouched', async () => {
    const db = makePositionMutationDb()
    const before = cloneFixture(db)
    const result = await createPosition({ name: 'Night Shift', rank: 7 }, db)
    assert.equal(typeof result.positionId, 'string')
    const created = db.positions.find((row) => row.id === result.positionId)
    assert.equal(created?.name, 'Night Shift')
    assert.equal(created?.rank, 7)
    assert.equal(created?.isActive, true)
    assert.equal(db.audits.length, 1)
    assert.equal(db.audits[0].action, 'position_created')
    assert.match(db.audits[0].comments, /Night Shift/)
    assert.match(db.audits[0].comments, /7/)
    assert.deepEqual(db.revalidated, ['/admin/organization'])
    assert.deepEqual(db.instanceWrites, [])
    assert.deepEqual(db.userRoleWrites, [])
    assertCapturedSnapshotsUnchanged(db, before)
  })
})

describe('renamePosition fake db', () => {
  it('rejects a duplicate active name matching /unique/i', async () => {
    const db = makePositionMutationDb()
    await assert.rejects(
      () => renamePosition({ positionId: 'p-coordinator', name: 'Manager' }, db),
      /unique/i,
    )
    assert.equal(db.positions.find((row) => row.id === 'p-coordinator')?.name, 'Coordinator')
    assert.equal(db.audits.length, 0)
  })

  it('renames only: rank, teams, assignments, and routes untouched; snapshots keep captured strings', async () => {
    const db = makePositionMutationDb()
    const before = cloneFixture(db)
    const result = await renamePosition({ positionId: 'p-coordinator', name: 'Coordinator Prime' }, db)
    assert.deepEqual(result, { success: true })
    const renamed = db.positions.find((row) => row.id === 'p-coordinator')
    assert.equal(renamed?.name, 'Coordinator Prime')
    assert.equal(renamed?.rank, 6)
    assert.equal(db.audits.length, 1)
    assert.equal(db.audits[0].action, 'position_renamed')
    assert.match(db.audits[0].comments, /Coordinator/)
    assert.match(db.audits[0].comments, /Coordinator Prime/)
    assert.deepEqual(
      db.positions.map((row) => ({ ...row, name: row.id === 'p-coordinator' ? 'Coordinator' : row.name })),
      before.positions,
    )
    assert.deepEqual(db.assignments, before.assignments)
    assert.deepEqual(db.teams, before.teams)
    assert.deepEqual(db.publishedRoutes, before.publishedRoutes)
    assert.deepEqual(db.instanceWrites, [])
    assertCapturedSnapshotsUnchanged(db, before)
    // the captured display string outlives the rename
    assert.equal(
      db.candidateGroupMembers.find((row) => row.candidateGroupId === 'cg-req-1')?.capturedDisplayName,
      'Bob — Coordinator',
    )
  })
})

describe('changePositionRank fake db', () => {
  it('blocked case returns the guard lists verbatim and writes nothing', async () => {
    const db = makePositionMutationDb()
    const before = cloneFixture(db)
    const result = await changePositionRank(
      { positionId: 'p-lead', proposedRank: 5 },
      db,
    )
    assert.deepStrictEqual(result, {
      blocked: true,
      impact: leadToFiveImpact,
    })
    assert.equal(db.positions.find((row) => row.id === 'p-lead')?.rank, 2)
    assert.deepEqual(db.positions, before.positions)
    assert.deepEqual(db.assignments, before.assignments)
    assert.deepEqual(db.teams, before.teams)
    assert.deepEqual(db.publishedRoutes, before.publishedRoutes)
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.instanceWrites, [])
    assertCapturedSnapshotsUnchanged(db, before)
  })

  it('rejects a proposed rank already held by another active position matching /unique/i', async () => {
    const db = makePositionMutationDb()
    await assert.rejects(
      () => changePositionRank({ positionId: 'p-lead', proposedRank: 3 }, db),
      /unique/i,
    )
    assert.equal(db.positions.find((row) => row.id === 'p-lead')?.rank, 2)
    assert.equal(db.audits.length, 0)
  })

  it('success writes the rank, audits, and leaves teams/assignments/routes and snapshots untouched', async () => {
    const db = makePositionMutationDb()
    const before = cloneFixture(db)
    const result = await changePositionRank(
      { positionId: 'p-coordinator', proposedRank: 7 },
      db,
    )
    assert.deepStrictEqual(result, { success: true })
    assert.equal(db.positions.find((row) => row.id === 'p-coordinator')?.rank, 7)
    assert.equal(db.audits.length, 1)
    assert.equal(db.audits[0].action, 'position_rank_changed')
    assert.match(db.audits[0].comments, /6/)
    assert.match(db.audits[0].comments, /7/)
    assert.deepEqual(db.assignments, before.assignments)
    assert.deepEqual(db.teams, before.teams)
    assert.deepEqual(db.publishedRoutes, before.publishedRoutes)
    assert.deepEqual(db.instanceWrites, [])
    assertCapturedSnapshotsUnchanged(db, before)
  })

  it('rejects a missing position and a non-positive proposed rank', async () => {
    const db = makePositionMutationDb()
    await assert.rejects(
      () => changePositionRank({ positionId: 'p-missing', proposedRank: 7 }, db),
      /not found/i,
    )
    await assert.rejects(
      () => changePositionRank({ positionId: 'p-coordinator', proposedRank: 0 }, db),
      /positive integer/i,
    )
    assert.equal(db.audits.length, 0)
  })
})

describe('deactivatePosition fake db', () => {
  it('refuses while active assignments reference the position matching /in use/i', async () => {
    const db = makePositionMutationDb()
    const before = cloneFixture(db)
    await assert.rejects(
      () => deactivatePosition({ positionId: 'p-staff' }, db),
      /in use/i,
    )
    assert.equal(db.positions.find((row) => row.id === 'p-staff')?.isActive, true)
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.positions, before.positions)
    assert.deepEqual(db.assignments, before.assignments)
    assert.deepEqual(db.publishedRoutes, before.publishedRoutes)
  })

  it('refuses while a published route step or limit references the position matching /in use/i', async () => {
    const db = makePositionMutationDb()
    await assert.rejects(
      () => deactivatePosition({ positionId: 'p-director' }, db),
      /in use/i,
    )
    assert.equal(db.positions.find((row) => row.id === 'p-director')?.isActive, true)
    assert.equal(db.audits.length, 0)
  })

  it('deactivates an unreferenced position, audits, and never touches attempts or snapshots', async () => {
    const db = makePositionMutationDb()
    const before = cloneFixture(db)
    const result = await deactivatePosition({ positionId: 'p-coordinator' }, db)
    assert.deepEqual(result, { success: true })
    assert.equal(db.positions.find((row) => row.id === 'p-coordinator')?.isActive, false)
    assert.equal(db.audits.length, 1)
    assert.equal(db.audits[0].action, 'position_deactivated')
    assert.match(db.audits[0].comments, /Coordinator/)
    assert.deepEqual(db.assignments, before.assignments)
    assert.deepEqual(db.instanceWrites, [])
    assertCapturedSnapshotsUnchanged(db, before)
  })

  it('rejects a missing position', async () => {
    const db = makePositionMutationDb()
    await assert.rejects(
      () => deactivatePosition({ positionId: 'p-missing' }, db),
      /not found/i,
    )
  })
})

describe('captured snapshot fixtures and forbidden-persistence instrumentation', () => {
  it('fake exposes captured approval snapshot rows that reference live positions', () => {
    const db = makePositionMutationDb()
    assert.ok(db.approvalInstances.length > 0, 'captured instance fixture must exist')
    const instance = db.approvalInstances.find((row) => row.id === 'inst-req-1')
    assert.equal(instance?.originPositionId, 'p-coordinator')
    const approval = db.requestApprovals.find((row) => row.id === 'ra-req-1')
    assert.equal(approval?.requiredPositionId, 'p-coordinator')
    assert.ok(db.solutionApprovals.length > 0, 'captured solution approval fixture must exist')
    const group = db.candidateGroups.find((row) => row.id === 'cg-req-1')
    assert.equal(group?.requiredPositionId, 'p-coordinator')
    const member = db.candidateGroupMembers.find((row) => row.candidateGroupId === 'cg-req-1')
    assert.equal(member?.capturedDisplayName, 'Bob — Coordinator')
  })

  it('forbidden approval-instance persistence records into instanceWrites so zero-write assertions can observe it', async () => {
    const db = makePositionMutationDb()
    await db.updateApprovalInstance('inst-req-1', { state: 'SUPERSEDED' })
    assert.deepEqual(db.instanceWrites, ['approval_instances.update:inst-req-1'])
    assert.equal(db.approvalInstances.find((row) => row.id === 'inst-req-1')?.state, 'SUPERSEDED')
  })

  it('forbidden approval-row and candidate-group persistence record into instanceWrites', async () => {
    const db = makePositionMutationDb()
    await db.updateRequestApproval('ra-req-1', { status: 'skipped' })
    await db.updateSolutionApproval('sa-sol-1', { status: 'skipped' })
    await db.updateApprovalCandidateGroup('cg-req-1', { requiredPositionId: 'p-lead' })
    await db.updateApprovalCandidateGroupMember('cg-req-1', 'bob', { capturedDisplayName: 'Bob — Lead' })
    assert.deepEqual(db.instanceWrites, [
      'request_approvals.update:ra-req-1',
      'solution_approvals.update:sa-sol-1',
      'approval_candidate_groups.update:cg-req-1',
      'approval_candidate_group_members.update:cg-req-1:bob',
    ])
  })

  it('forbidden user-role persistence records into userRoleWrites', async () => {
    const db = makePositionMutationDb()
    await db.updateUserRole('bob', 'admin')
    assert.deepEqual(db.userRoleWrites, [{ userId: 'bob', role: 'admin' }])
  })

  it('every successful mutation keeps the captured snapshot fixture identical', async () => {
    const before = cloneFixture(makePositionMutationDb())
    const renameDb = makePositionMutationDb()
    await renamePosition({ positionId: 'p-coordinator', name: 'Coordinator Prime' }, renameDb)
    assertCapturedSnapshotsUnchanged(renameDb, before)
    assert.deepEqual(renameDb.instanceWrites, [])
    const rankDb = makePositionMutationDb()
    await changePositionRank({ positionId: 'p-coordinator', proposedRank: 7 }, rankDb)
    assertCapturedSnapshotsUnchanged(rankDb, before)
    assert.deepEqual(rankDb.instanceWrites, [])
    const createDb = makePositionMutationDb()
    await createPosition({ name: 'Night Shift', rank: 5 }, createDb)
    assertCapturedSnapshotsUnchanged(createDb, before)
    assert.deepEqual(createDb.instanceWrites, [])
    const deactivateDb = makePositionMutationDb()
    await deactivatePosition({ positionId: 'p-coordinator' }, deactivateDb)
    assertCapturedSnapshotsUnchanged(deactivateDb, before)
    assert.deepEqual(deactivateDb.instanceWrites, [])
  })
})

describe('rank edit session — delayed responses (C3-fix1 epoch pattern)', () => {
  it('stale blocked response after switching editors must not disable the new editor', () => {
    // Review a04044a7 P1: submit Lead→5, switch to another position's editor,
    // then let the Lead→5 assessment land — it must not render its problems
    // against the new editor or disable its Save.
    let session = startRankEditSession('p-lead', 2)
    session = typeRankDraft(session, '5')
    const request = requestRankSave(session)
    assert.equal(request.submit, true)
    session = request.session
    assert.equal(session.pendingEpoch, session.epoch)
    const staleEpoch = session.epoch
    // switch editor before completion
    session = startRankEditSession('p-coordinator', 6, session.epoch)
    assert.equal(session.positionId, 'p-coordinator')
    assert.equal(session.draftRank, '6')
    // the stale Lead→5 blocked assessment resolves late
    session = applyRankSaveOutcome(session, staleEpoch, { kind: 'blocked', impact: leadToFiveImpact })
    assert.equal(session.positionId, 'p-coordinator')
    assert.equal(session.draftRank, '6')
    assert.equal(session.blockedImpact, null, 'stale impact must not attach to the new editor')
    assert.equal(session.error, null)
    assert.equal(session.pendingEpoch, null, 'saving must clear so the new editor Save re-enables')
  })

  it('stale success must not close the editor now open', () => {
    let session = startRankEditSession('p-coordinator', 6)
    session = typeRankDraft(session, '7')
    const request = requestRankSave(session)
    session = request.session
    const staleEpoch = session.epoch
    session = startRankEditSession('p-lead', 2, session.epoch)
    session = applyRankSaveOutcome(session, staleEpoch, { kind: 'success' })
    assert.equal(session.positionId, 'p-lead', 'stale success must not cancel the new editor')
    assert.equal(session.draftRank, '2')
    assert.equal(session.pendingEpoch, null)
  })

  it('typing while pending invalidates the response: stale blocked impact does not attach', () => {
    let session = startRankEditSession('p-lead', 2)
    session = typeRankDraft(session, '5')
    const request = requestRankSave(session)
    session = request.session
    const staleEpoch = session.epoch
    session = typeRankDraft(session, '6')
    assert.equal(session.epoch, staleEpoch + 1)
    session = applyRankSaveOutcome(session, staleEpoch, { kind: 'blocked', impact: leadToFiveImpact })
    assert.equal(session.positionId, 'p-lead')
    assert.equal(session.draftRank, '6', 'newer draft kept')
    assert.equal(session.blockedImpact, null)
    assert.equal(session.pendingEpoch, null)
  })

  it('cancel while pending: a later error for the old editor is ignored and the editor stays closed', () => {
    let session = startRankEditSession('p-lead', 2)
    session = typeRankDraft(session, '5')
    const request = requestRankSave(session)
    session = request.session
    const staleEpoch = session.epoch
    session = cancelRankEditSession(session)
    assert.equal(session.positionId, null)
    session = applyRankSaveOutcome(session, staleEpoch, { kind: 'error', message: 'network failed' })
    assert.equal(session.positionId, null, 'stale error must not restore the canceled editor')
    assert.equal(session.error, null)
    assert.equal(session.pendingEpoch, null)
  })

  it('a second save while one is pending is ignored', () => {
    let session = startRankEditSession('p-lead', 2)
    session = typeRankDraft(session, '5')
    session = requestRankSave(session).session
    assert.equal(session.pendingEpoch, session.epoch)
    assert.equal(requestRankSave(session).submit, false)
    assert.equal(session.pendingEpoch, session.epoch)
  })

  it('fresh blocked response attaches to its own editor; fresh success closes it', () => {
    let session = startRankEditSession('p-lead', 2)
    session = typeRankDraft(session, '5')
    const blocked = requestRankSave(session)
    assert.equal(blocked.submit, true)
    session = applyRankSaveOutcome(blocked.session, blocked.session.epoch, {
      kind: 'blocked',
      impact: leadToFiveImpact,
    })
    assert.equal(session.positionId, 'p-lead')
    assert.equal(session.blockedImpact, leadToFiveImpact)
    assert.equal(session.pendingEpoch, null)

    const retry: PositionRankEditSession = typeRankDraft(session, '1')
    const success = requestRankSave(retry)
    assert.equal(success.submit, true)
    const done = applyRankSaveOutcome(success.session, success.session.epoch, { kind: 'success' })
    assert.deepEqual(done, idleRankEditSession(done.epoch))
    assert.equal(done.positionId, null)
  })
})

describe('C8 source contracts', () => {
  it('exports the four actions with Serializable uniqueness, guard-first blocking, and no instance/auto-repair writes', () => {
    const actions = read('src/server-actions/organization.ts')
    assert.match(actions, /export async function createPosition/)
    assert.match(actions, /export async function renamePosition/)
    assert.match(actions, /export async function changePositionRank/)
    assert.match(actions, /export async function deactivatePosition/)
    assert.match(actions, /isolationLevel: 'Serializable'/)
    assert.match(actions, /assessPositionRankChange/)

    const createStart = actions.indexOf('export async function createPosition')
    const renameStart = actions.indexOf('export async function renamePosition')
    const rankStart = actions.indexOf('export async function changePositionRank')
    const deactivateStart = actions.indexOf('export async function deactivatePosition')
    assert.ok(createStart >= 0 && renameStart > createStart && rankStart > renameStart && deactivateStart > rankStart)
    const createOnly = actions.slice(createStart, renameStart)
    const renameOnly = actions.slice(renameStart, rankStart)
    const rankOnly = actions.slice(rankStart, deactivateStart)
    const deactivateOnly = actions.slice(deactivateStart)

    for (const fn of [createOnly, renameOnly, rankOnly, deactivateOnly]) {
      assert.doesNotMatch(fn, /approval_instances/)
      assert.doesNotMatch(fn, /approval_instance_skips/)
      assert.doesNotMatch(fn, /approval_candidate_group/)
      assert.doesNotMatch(fn, /request_approvals/)
      assert.doesNotMatch(fn, /solution_approvals/)
      assert.doesNotMatch(fn, /OrganizationPositionCode/)
      assert.doesNotMatch(fn, /users?\.update/)
    }

    // createPosition: positive integer + active name and rank uniqueness.
    assert.match(createOnly, /requirePositiveIntegerRank\(/)
    assert.match(createOnly, /unique/i)

    // renamePosition: rename only — never writes rank or route data.
    assert.doesNotMatch(renameOnly, /updatePositionRank/)
    assert.doesNotMatch(renameOnly, /approval_route/)

    // changePositionRank: assess BEFORE any write; blocked returns without writing.
    const assessAt = rankOnly.indexOf('assessPositionRankChange(')
    const writeAt = rankOnly.indexOf('updatePositionRank(')
    assert.ok(assessAt >= 0 && writeAt > assessAt, 'assessPositionRankChange must run before the rank write')
    assert.match(rankOnly, /blocked/)
    // no auto-repair: never rewrites teams, assignments, or routes while changing a rank
    assert.doesNotMatch(rankOnly, /updateAssignment\(/)
    assert.doesNotMatch(rankOnly, /setAssignmentTeam/)
    assert.doesNotMatch(rankOnly, /updateTeamReportsTo/)
    assert.doesNotMatch(rankOnly, /approval_route/)

    // deactivatePosition: refuses while active assignments or published routes reference it.
    assert.match(deactivateOnly, /in use/i)
    assert.match(deactivateOnly, /loadAssignments/)
    assert.match(deactivateOnly, /loadPublishedRoutes/)
    assert.doesNotMatch(deactivateOnly, /approval_route_steps\s*\.\s*update/)
    assert.doesNotMatch(deactivateOnly, /updateAssignment\(/)

    const panel = read('src/components/organization/PositionAdminPanel.tsx')
    assert.match(panel, /data-testid="position-admin-panel"/)
    assert.match(panel, /createPosition/)
    assert.match(panel, /renamePosition/)
    assert.match(panel, /changePositionRank/)
    assert.match(panel, /deactivatePosition/)
    assert.match(panel, /position-rank-impact/)
    assert.doesNotMatch(panel, /users\.role/)
    // C8-fix1 P1: rank save completions are epoch-scoped; no raw shared impact
    // state a late assessment can overwrite another editor with.
    assert.match(panel, /requestRankSave\(/)
    assert.match(panel, /applyRankSaveOutcome\(/)
    assert.match(panel, /startRankEditSession\(/)
    assert.doesNotMatch(panel, /setBlockedImpact/)

    const page = read('src/app/admin/organization/page.tsx')
    assert.match(page, /requireAdmin/)
    assert.match(page, /getOrganizationWorkspaceData/)
    assert.match(page, /Approval chains/)
    assert.match(page, /Positions/)
    assert.match(page, /Create unit/)
    assert.match(page, /PositionAdminPanel/)
    assert.match(page, /panel=positions/)
    assert.match(page, /header-positions/)
    assert.ok(
      page.indexOf('requireAdmin') < page.indexOf('getOrganizationWorkspaceData'),
      'page must call requireAdmin before getOrganizationWorkspaceData',
    )
  })
})
