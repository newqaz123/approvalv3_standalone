import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { selectNearestPublishedRoute, resolvePublishedApprovalRoute } from '@/lib/approval-routes/resolver'
import type { ApprovalRouteDb, ApprovalRouteVersionDefinition } from '@/lib/approval-routes/types'
import { ApprovalRouteConfigurationError, validateRouteDefinition } from '@/lib/approval-routes/validation'
import type { ReportingBranch } from '@/lib/organization/types'

const route = (overrides: Partial<ApprovalRouteVersionDefinition> = {}): ApprovalRouteVersionDefinition => ({
  id: 'route', scopeUnitId: 'department-1', phase: 'REQUEST', version: 1,
  maximumPositionLevel: 4, status: 'PUBLISHED', steps: [{ order: 1, position: 'SECTION_MANAGER' }], ...overrides,
})

const branch: ReportingBranch = {
  originUserId: 'user-1', primaryUnitId: 'section-1', primaryAssignmentId: 'assignment-1',
  primaryPosition: 'STAFF', unitPath: ['section-1', 'department-1', 'division-1', 'factory-1'], groupPath: [],
}

describe('approval route resolution', () => {
  it('chooses the first published ancestor scope, not a broader manager scope', () => {
    const routes: ApprovalRouteVersionDefinition[] = [
      route({ id: 'factory-route', scopeUnitId: 'factory-1', maximumPositionLevel: 6, steps: [{ order: 1, position: 'FACTORY_MANAGER' }] }),
      route({ id: 'department-route', scopeUnitId: 'department-1', version: 3, steps: [{ order: 1, position: 'SECTION_MANAGER' }, { order: 2, position: 'DEPARTMENT_MANAGER' }] }),
    ]
    assert.equal(selectNearestPublishedRoute(branch.unitPath, routes, 'REQUEST').id, 'department-route')
  })

  it('enforces ceilings, contiguous orders, uniqueness, and ascending positions', () => {
    assert.throws(() => validateRouteDefinition({ ...route(), maximumPositionLevel: 0 as never }), ApprovalRouteConfigurationError)
    assert.throws(() => validateRouteDefinition({ ...route(), steps: [{ order: 1, position: 'DEPARTMENT_MANAGER' }, { order: 2, position: 'SUPERVISOR' }] }), /ascending/i)
    assert.throws(() => validateRouteDefinition({ ...route(), steps: [{ order: 1, position: 'SECTION_MANAGER' }, { order: 1, position: 'DEPARTMENT_MANAGER' }] }), /order/i)
    assert.throws(() => validateRouteDefinition({ ...route(), maximumPositionLevel: 3, steps: [{ order: 1, position: 'FACTORY_MANAGER' }] }), /ceiling/i)
    assert.doesNotThrow(() => validateRouteDefinition({ ...route(), maximumPositionLevel: 6, steps: [{ order: 1, position: 'SUPERVISOR' }, { order: 2, position: 'FACTORY_MANAGER' }] }))
  })

  it('resolves only the origin branch and requested phase, validating the selected route', async () => {
    const calls: unknown[] = []
    const db: ApprovalRouteDb = {
      loadOriginBranch: async (userId) => { calls.push(['branch', userId]); return branch },
      loadPublishedRoutes: async (input) => { calls.push(['routes', input]); return [route()] },
    }
    const resolved = await resolvePublishedApprovalRoute({ phase: 'REQUEST', originUserId: 'user-1', originUnitId: 'section-1', requestId: 'r', originalRequestId: 'r', requestDepartmentId: 'wrong' }, db)
    assert.deepEqual(resolved.ancestorScopeIds, branch.unitPath)
    assert.equal(resolved.id, 'route')
    assert.deepEqual(calls, [['branch', 'user-1'], ['routes', { scopeUnitIds: branch.unitPath, phase: 'REQUEST' }]])
  })

  it('rejects absent, ambiguous, malformed, and mismatched origin routes', async () => {
    assert.throws(() => selectNearestPublishedRoute(branch.unitPath, [], 'REQUEST'), ApprovalRouteConfigurationError)
    assert.throws(() => selectNearestPublishedRoute(branch.unitPath, [route(), route({ id: 'other' })], 'REQUEST'), ApprovalRouteConfigurationError)
    const db = (value: ReportingBranch | null): ApprovalRouteDb => ({ loadOriginBranch: async () => value, loadPublishedRoutes: async () => [route()] })
    await assert.rejects(() => resolvePublishedApprovalRoute({ phase: 'REQUEST', originUserId: 'user-1', originUnitId: 'section-1', requestId: 'r', originalRequestId: 'r', requestDepartmentId: null }, db(null)), ApprovalRouteConfigurationError)
    await assert.rejects(() => resolvePublishedApprovalRoute({ phase: 'REQUEST', originUserId: 'user-1', originUnitId: 'other', requestId: 'r', originalRequestId: 'r', requestDepartmentId: null }, db(branch)), ApprovalRouteConfigurationError)
  })
})
