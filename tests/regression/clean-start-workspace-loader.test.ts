// Clean-start organization workspace loader (Plan C Task 1).
// In-memory fake db only: NO Prisma, NO database, NO env, NO schema/server ops.
// Pins B2 nearest-published walk for routeSources, unassigned active users,
// and A7 readiness as the snapshot readiness field.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { verifyCleanStartReadiness } from '@/lib/clean-start-readiness'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import {
  getOrganizationWorkspaceData,
  type OrganizationWorkspaceDb,
} from '@/server-actions/organization'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'

const read = (path: string) => readFileSync(path, 'utf8')

const units: OrganizationUnitNode[] = [
  { id: 'company', name: 'Company', parentId: null, isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
  { id: 'ops', name: 'Operations', parentId: 'company', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
  { id: 'section-a', name: 'Section A', parentId: 'ops', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: null },
]

const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-lead', name: 'Lead', rank: 2, isActive: true },
]

const assignments: AssignmentNode[] = [
  { id: 'a-alice', userId: 'alice', unitId: 'ops', positionId: 'p-lead', teamId: null, isActive: true },
  { id: 'a-old', userId: 'inactive-user', unitId: 'ops', positionId: 'p-staff', teamId: null, isActive: false },
]

const teams: TeamNode[] = []

const users = [
  { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
  { id: 'dana', name: 'Dana', email: 'dana@example.com', role: 'general_dept', isActive: true },
  { id: 'inactive-user', name: 'Inactive', email: 'old@example.com', role: 'general_dept', isActive: false },
]

type RouteRow = {
  id: string
  scopeUnitId: string
  phase: ApprovalPhase
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
}

const routes: RouteRow[] = [
  { id: 'rv-root-request', scopeUnitId: 'company', phase: 'REQUEST', status: 'PUBLISHED' },
  { id: 'rv-root-solution', scopeUnitId: 'company', phase: 'SOLUTION', status: 'PUBLISHED' },
  { id: 'rv-root-final', scopeUnitId: 'company', phase: 'FINAL', status: 'PUBLISHED' },
  { id: 'rv-ops-request', scopeUnitId: 'ops', phase: 'REQUEST', status: 'PUBLISHED' },
  { id: 'rv-ops-request-draft', scopeUnitId: 'ops', phase: 'REQUEST', status: 'DRAFT' },
]

function makeDb(over: Partial<OrganizationWorkspaceDb> = {}): OrganizationWorkspaceDb {
  return {
    loadUnits: async () => units,
    loadPositions: async () => positions,
    loadAssignments: async () => assignments,
    loadTeams: async () => teams,
    loadUsers: async () => users,
    loadRouteVersions: async () => routes,
    loadCustomChainExceptions: async () => [],
    ...over,
  }
}

function routeSource(
  snapshot: Awaited<ReturnType<typeof getOrganizationWorkspaceData>>,
  unitId: string,
  phase: ApprovalPhase,
) {
  const row = snapshot.routeSources.find((candidate) => candidate.unitId === unitId && candidate.phase === phase)
  assert.ok(row, `missing routeSources row for ${unitId}/${phase}`)
  return row
}

describe('clean-start organization workspace loader', () => {
  it('classifies routeSources with the B2 nearest-published walk', async () => {
    const snapshot = await getOrganizationWorkspaceData(makeDb())
    const sectionRequest = routeSource(snapshot, 'section-a', 'REQUEST')
    assert.equal(sectionRequest.source, 'INHERITED')
    assert.equal(sectionRequest.sourceUnitId, 'ops')
    assert.equal(sectionRequest.publishedVersionId, 'rv-ops-request')

    const opsRequest = routeSource(snapshot, 'ops', 'REQUEST')
    assert.equal(opsRequest.source, 'CUSTOM')
    assert.equal(opsRequest.hasDraft, true)
    assert.equal(opsRequest.publishedVersionId, 'rv-ops-request')

    const sectionSolution = routeSource(snapshot, 'section-a', 'SOLUTION')
    assert.equal(sectionSolution.source, 'ROOT_DEFAULT')
    assert.equal(sectionSolution.sourceUnitId, 'company')
    assert.equal(sectionSolution.publishedVersionId, 'rv-root-solution')
    assert.equal(sectionSolution.hasDraft, false)
  })

  it('lists active users without active assignments as unassignedUsers', async () => {
    const snapshot = await getOrganizationWorkspaceData(makeDb())
    assert.deepEqual(
      snapshot.unassignedUsers.map((user) => user.id).sort(),
      ['dana'],
    )
    assert.deepEqual(snapshot.unassignedUsers, [
      { id: 'dana', name: 'Dana', email: 'dana@example.com' },
    ])
  })

  it('returns A7 verifyCleanStartReadiness output as readiness', async () => {
    const db = makeDb()
    const snapshot = await getOrganizationWorkspaceData(db)
    const expected = await verifyCleanStartReadiness({
      loadUnits: async () => units,
      loadPositions: async () => positions,
      loadAssignments: async () => assignments,
      loadTeams: async () => teams,
      countPublishedRoutesByPhase: async () => ({ REQUEST: 1, SOLUTION: 1, FINAL: 1 }),
    })
    assert.deepEqual(snapshot.readiness, expected)
    assert.equal(snapshot.readiness.ready, true)
  })

  it('wires the admin organization page through requireAdmin then OrganizationWorkspace', () => {
    const page = read('src/app/admin/organization/page.tsx')
    assert.match(page, /requireAdmin/)
    assert.match(page, /getOrganizationWorkspaceData/)
    assert.match(page, /OrganizationWorkspace/)
    assert.ok(
      page.indexOf('requireAdmin') < page.indexOf('getOrganizationWorkspaceData'),
      'page must call requireAdmin before getOrganizationWorkspaceData',
    )
    assert.match(page, /Approval chains/)
    assert.match(page, /Positions/)
    assert.match(page, /CreateUnitDialog/)
    assert.doesNotMatch(page, /OrganizationEditor/)
    assert.doesNotMatch(page, /getOrganizationAdminData/)
  })
})
