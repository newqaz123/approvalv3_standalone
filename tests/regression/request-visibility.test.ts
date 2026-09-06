import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildRequestVisibilityWhere, canViewRequestByPredicate } from '@/lib/request-visibility/predicate'
import { fakeVisibilityDb, canViewWithFake } from '../fixtures/organization-approval-fixtures'

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
