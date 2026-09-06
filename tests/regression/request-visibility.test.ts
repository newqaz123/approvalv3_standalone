import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildRequestVisibilityWhere, canViewRequestByPredicate } from '@/lib/request-visibility/predicate'
import { fakeVisibilityDb, canViewWithFake } from '../fixtures/organization-approval-fixtures'
import {
  createHarness,
  departmentRows,
} from '../fixtures/organization-approval-harness'

const read = (path: string) => readFileSync(path, 'utf8')

describe('request visibility predicate', () => {
  it('keeps PD1 and PD2 isolated while allowing ancestor managers to see descendants', async () => {
    const pd1Staff = await buildRequestVisibilityWhere(fakeVisibilityDb(), {
      userId: 'staff-pd1', includeArchived: false,
    })
    const departmentManager = await buildRequestVisibilityWhere(fakeVisibilityDb(), {
      userId: 'department-manager', includeArchived: false,
    })
    assert.match(JSON.stringify(pd1Staff), /section-pd1/)
    assert.doesNotMatch(JSON.stringify(pd1Staff), /section-pd2/)
    assert.match(JSON.stringify(departmentManager), /department-pd/)
    assert.match(JSON.stringify(departmentManager), /section-pd1/)
    assert.match(JSON.stringify(departmentManager), /section-pd2/)
  })

  it('fails closed for inactive, null-org, deleted, and unmapped ordinary reads', async () => {
    assert.equal(await canViewWithFake({ userId: 'inactive-general', requestId: 'r1' }), false)
    assert.equal(await canViewWithFake({ userId: 'null-org-general', requestId: 'r-null-org' }), false)
    assert.equal(await canViewWithFake({ userId: 'pd1-general', requestId: 'deleted-r1' }), false)
    assert.equal(await canViewWithFake({ userId: 'pd1-general', requestId: 'unmapped-r1' }), false)
  })

  it('allows explicit candidate, historical actor, requester, admin, and engineering exceptions only', async () => {
    assert.equal(await canViewWithFake({ userId: 'candidate-u1', requestId: 'pd2-r1' }), true)
    assert.equal(await canViewWithFake({ userId: 'historical-u2', requestId: 'pd2-r1' }), true)
    assert.equal(await canViewWithFake({ userId: 'admin-u1', requestId: 'unmapped-r1' }), true)
    assert.equal(await canViewWithFake({ userId: 'engineering-u1', requestId: 'pd2-r1' }), true)
  })
})

describe('request visibility predicate behavioral matrix', () => {
  it('isolates PD1 staff from PD2 requests while ancestor managers see both sections', async () => {
    assert.equal(await canViewWithFake({ userId: 'staff-pd1', requestId: 'pd1-r1' }), true)
    assert.equal(await canViewWithFake({ userId: 'staff-pd1', requestId: 'pd2-r1' }), false)
    assert.equal(await canViewWithFake({ userId: 'staff-pd2', requestId: 'pd1-r1' }), false)
    assert.equal(await canViewWithFake({ userId: 'staff-pd2', requestId: 'pd2-r1' }), true)
    assert.equal(await canViewWithFake({ userId: 'department-manager', requestId: 'pd1-r1' }), true)
    assert.equal(await canViewWithFake({ userId: 'department-manager', requestId: 'pd2-r1' }), true)
  })

  it('lets an active requester view their own unmapped request', async () => {
    assert.equal(await canViewWithFake({ userId: 'unmapped-requester', requestId: 'unmapped-r1' }), true)
  })

  it('treats archive hiding as a list filter and still allows authorized archived details', async () => {
    const db = fakeVisibilityDb()
    const listWhere = await buildRequestVisibilityWhere(db, {
      userId: 'staff-pd1', includeArchived: false,
    })
    const detailWhere = await buildRequestVisibilityWhere(db, {
      userId: 'staff-pd1', includeArchived: true,
    })
    assert.match(JSON.stringify(listWhere), /"isArchived":false/)
    assert.doesNotMatch(JSON.stringify(detailWhere), /isArchived/)
    assert.equal(await canViewRequestByPredicate(db, 'staff-pd1', 'archived-r1'), true)
    assert.equal(await canViewWithFake({ userId: 'staff-pd1', requestId: 'archived-r1' }), true)
    assert.equal(await canViewWithFake({ userId: 'staff-pd2', requestId: 'archived-r1' }), false)
  })

  it('does not grant global read from a department name', async () => {
    assert.equal(await canViewWithFake({ userId: 'named-engineering-general', requestId: 'pd2-r1' }), false)
    assert.equal(await canViewWithFake({ userId: 'engineering-type-general', requestId: 'pd2-r1' }), true)
  })
})

describe('visibility caller contracts', () => {
  it('guards direct detail, list, counts, exports, and files with the shared policy', () => {
    for (const path of [
      'src/server-actions/requests.ts',
      'src/server-actions/dashboard.ts',
      'src/app/(dashboard)/engineering/page.tsx',
      'src/server-actions/analytics.ts',
      'src/server-actions/budget-control.ts',
      'src/server-actions/files.ts',
      'src/app/api/inline-images/[id]/route.ts',
      'src/server-actions/reports.ts',
      'src/app/api/files/download/route.ts',
    ]) {
      const source = read(path)
      assert.match(source, /buildRequestVisibilityWhere|canUserViewRequest/)
    }
  })

  it('keeps admin audit and retention paths protected and deleted-record aware', () => {
    for (const path of [
      'src/server-actions/audit.ts',
      'src/app/api/audit/export/request/[requestId]/route.ts',
      'src/app/api/audit/export/date-range/route.ts',
      'src/app/api/admin/retention/backup/route.ts',
    ]) {
      const source = read(path)
      assert.match(source, /requireAdmin|admin/i)
      // Privileged retention may intentionally include deleted history.
    }
  })

  it('checks getRequest authorization before returning attachments or activities', () => {
    const source = read('src/server-actions/requests.ts')
    assert.match(source, /getRequest[\s\S]*canUserViewRequest[\s\S]*findUnique/)
  })

  it('composes ordinary list queries as AND of visibility and filters', () => {
    const source = read('src/server-actions/requests.ts')
    assert.match(source, /AND:\s*\[visibilityWhere/)
    assert.match(source, /buildRequestFilters/)
    assert.match(source, /createRequestVisibilityDb/)
  })

  it('keeps action counts on eligibility predicates rather than view permission', () => {
    const requests = read('src/server-actions/requests.ts')
    const dashboard = read('src/server-actions/dashboard.ts')
    const pendingCount = read('src/app/api/actions/pending-count/route.ts')
    assert.match(requests, /snapshotGroupActionWhere/)
    assert.match(requests, /CURRENT_INSTANCE_ROW_FILTER/)
    assert.match(dashboard, /snapshotGroupActionWhere/)
    assert.match(dashboard, /CURRENT_INSTANCE_ROW_FILTER/)
    assert.match(pendingCount, /snapshotGroupActionWhere/)
    assert.match(pendingCount, /CURRENT_INSTANCE_ROW_FILTER/)
  })

  it('keeps attachment mutation write guards in addition to read authorization', () => {
    const source = read('src/server-actions/files.ts')
    assert.match(source, /canUserViewRequest/)
    assert.match(source, /isUploader/)
    assert.match(source, /isRequester/)
    assert.match(source, /isEngineeringUser/)
  })
})

describe('visibility caller behavioral proof', () => {
  it('does not let a search OR overwrite visibility OR and leak PD2 to PD1 staff', async () => {
    const db = fakeVisibilityDb()
    const visibilityWhere = await buildRequestVisibilityWhere(db, {
      userId: 'staff-pd1',
      includeArchived: false,
    })
    const searchOr = { OR: [{ id: 'pd2-r1' }] }
    const leaked = await db.findRequest(searchOr)
    const composed = await db.findRequest({ AND: [visibilityWhere, searchOr] })
    assert.equal(leaked?.id, 'pd2-r1')
    assert.equal(composed, null)
  })

  it('lets a department manager list both descendant sections under AND composition', async () => {
    const db = fakeVisibilityDb()
    const visibilityWhere = await buildRequestVisibilityWhere(db, {
      userId: 'department-manager',
      includeArchived: false,
    })
    assert.equal((await db.findRequest({ AND: [visibilityWhere, { id: 'pd1-r1' }] }))?.id, 'pd1-r1')
    assert.equal((await db.findRequest({ AND: [visibilityWhere, { id: 'pd2-r1' }] }))?.id, 'pd2-r1')
  })

  it('fails closed for inactive, null-org, and unmapped ordinary list/detail reads', async () => {
    const db = fakeVisibilityDb()
    for (const userId of ['inactive-general', 'null-org-general']) {
      const visibilityWhere = await buildRequestVisibilityWhere(db, { userId, includeArchived: true })
      assert.equal(await db.findRequest({ AND: [{ id: 'pd1-r1' }, visibilityWhere] }), null)
      assert.equal(await canViewRequestByPredicate(db, userId, 'pd1-r1'), false)
    }
    assert.equal(await canViewWithFake({ userId: 'staff-pd1', requestId: 'unmapped-r1' }), false)
    assert.equal(await canViewWithFake({ userId: 'unmapped-requester', requestId: 'unmapped-r1' }), true)
  })

  it('keeps Engineering and Admin broad reads without turning them into extra actions', async () => {
    assert.equal(await canViewWithFake({ userId: 'admin-u1', requestId: 'pd2-r1' }), true)
    assert.equal(await canViewWithFake({ userId: 'engineering-u1', requestId: 'pd2-r1' }), true)
    const dashboard = read('src/server-actions/dashboard.ts')
    const pendingCount = read('src/app/api/actions/pending-count/route.ts')
    assert.match(dashboard, /snapshotGroupActionWhere/)
    assert.match(pendingCount, /snapshotGroupActionWhere/)
    assert.doesNotMatch(
      pendingCount,
      /buildRequestVisibilityWhere/,
    )
  })

  it('does not let PD1 staff open a PD2 request by direct ID', async () => {
    const harness = createSectionIsolationHarness()
    harness.state.authUserId = 'staff-pd1'
    harness.state.currentUser = {
      id: 'staff-pd1',
      role: 'general',
      isActive: true,
      departmentId: 'department-pd',
      department: { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' },
    }
    const denied = await harness.requests.getRequest('pd2-r1')
    assert.equal(denied, null)
    assert.equal(await harness.requestAccess.canUserViewRequest('staff-pd1', 'pd2-r1'), false)
    assert.equal(await harness.requestAccess.canUserViewRequest('staff-pd1', 'pd1-r1'), true)
    assert.equal(await harness.requestAccess.canUserViewRequest('department-manager', 'pd2-r1'), true)
    assert.equal(await harness.requestAccess.canUserViewRequest('engineer-1', 'pd2-r1'), true)
  })
})

function createSectionIsolationHarness() {
  return createHarness({
    departments: departmentRows(),
    users: [
      { id: 'staff-pd1', departmentId: 'department-pd', level: 1, isActive: true, role: 'general', name: 'PD1 Staff', email: 'staff-pd1@example.test' },
      { id: 'staff-pd2', departmentId: 'department-pd', level: 1, isActive: true, role: 'general', name: 'PD2 Staff', email: 'staff-pd2@example.test' },
      { id: 'department-manager', departmentId: 'department-pd', level: 4, isActive: true, role: 'general', name: 'PD Manager', email: 'dept-mgr@example.test' },
      { id: 'engineer-1', departmentId: 'department-engineering', level: 1, isActive: true, role: 'engineering', name: 'Engineer', email: 'engineer-1@example.test' },
      { id: 'admin-1', departmentId: null, level: 1, isActive: true, role: 'admin', name: 'Admin', email: 'admin-1@example.test' },
    ],
    organization_units: [
      { id: 'factory-1', name: 'Factory', unitType: 'FACTORY', parentId: null, isActive: true, operationalType: 'GENERAL' },
      { id: 'division-1', name: 'Division', unitType: 'DIVISION', parentId: 'factory-1', isActive: true, operationalType: 'GENERAL' },
      { id: 'department-pd-unit', name: 'PD Department', unitType: 'DEPARTMENT', parentId: 'division-1', isActive: true, operationalType: 'GENERAL' },
      { id: 'section-pd1', name: 'PD1', unitType: 'SECTION', parentId: 'department-pd-unit', isActive: true, operationalType: 'GENERAL' },
      { id: 'section-pd2', name: 'PD2', unitType: 'SECTION', parentId: 'department-pd-unit', isActive: true, operationalType: 'GENERAL' },
    ],
    organization_position_assignments: [
      { id: 'asg-pd1', userId: 'staff-pd1', unitId: 'section-pd1', positionCode: 'STAFF', isPrimary: true, isActive: true },
      { id: 'asg-pd2', userId: 'staff-pd2', unitId: 'section-pd2', positionCode: 'STAFF', isPrimary: true, isActive: true },
      { id: 'asg-mgr', userId: 'department-manager', unitId: 'department-pd-unit', positionCode: 'DEPARTMENT_MANAGER', isPrimary: true, isActive: true },
    ],
    requests: [
      {
        id: 'pd1-r1',
        status: 'ImprovementRequest',
        requesterId: 'staff-pd1',
        title: 'PD1 request',
        description: '<p>PD1</p>',
        departmentId: 'department-pd',
        organizationUnitId: 'section-pd1',
        isDeleted: false,
        isArchived: false,
      },
      {
        id: 'pd2-r1',
        status: 'ImprovementRequest',
        requesterId: 'staff-pd2',
        title: 'PD2 request',
        description: '<p>PD2</p>',
        departmentId: 'department-pd',
        organizationUnitId: 'section-pd2',
        isDeleted: false,
        isArchived: false,
      },
    ],
  })
}
