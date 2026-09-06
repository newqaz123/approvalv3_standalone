import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { selectNearestPublishedRoute, resolvePublishedApprovalRoute } from '@/lib/approval-routes/resolver'
import type { ApprovalRouteDb, ApprovalRouteVersionDefinition, RouteResolutionContext } from '@/lib/approval-routes/types'
import { ApprovalRouteConfigurationError, validateRouteDefinition } from '@/lib/approval-routes/validation'
import type { ReportingBranch } from '@/lib/organization/types'

const route = (overrides: Partial<ApprovalRouteVersionDefinition> = {}): ApprovalRouteVersionDefinition => ({
  id: 'route', scopeUnitId: 'department-1', phase: 'REQUEST', version: 1,
  maximumPositionLevel: 4, status: 'PUBLISHED', steps: [{ order: 1, position: 'SECTION_MANAGER' }], ...overrides,
})

const factoryRoute = (id: string): ApprovalRouteVersionDefinition => route({
  id, scopeUnitId: 'factory-1', maximumPositionLevel: 6, steps: [{ order: 1, position: 'FACTORY_MANAGER' }],
})

const resolveContext = (overrides: Partial<RouteResolutionContext> = {}): RouteResolutionContext => ({
  phase: 'REQUEST', originUserId: 'user-1', originUnitId: 'section-1', requestId: 'request-1', originalRequestId: 'request-1',
  requestDepartmentId: null, ...overrides,
})

const branch: ReportingBranch = {
  originUserId: 'user-1', primaryUnitId: 'section-1', primaryAssignmentId: 'assignment-1',
  primaryPosition: 'STAFF', unitPath: ['section-1', 'department-1', 'division-1', 'factory-1'], groupPath: [],
}

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
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

  it('skips nearer draft, retired, other-phase, and sibling rows to select the farther published ancestor route', () => {
    const routes: ApprovalRouteVersionDefinition[] = [
      route({ id: 'section-draft', scopeUnitId: 'section-1', status: 'DRAFT' }),
      route({ id: 'section-retired', scopeUnitId: 'section-1', status: 'RETIRED' }),
      route({ id: 'section-solution', scopeUnitId: 'section-1', phase: 'SOLUTION' }),
      route({ id: 'section-sibling-published', scopeUnitId: 'section-2' }),
      factoryRoute('factory-request'),
    ]
    assert.equal(selectNearestPublishedRoute(branch.unitPath, routes, 'REQUEST').id, 'factory-request')
  })

  it('does not select a nearer draft route even when it is the only nearer row', () => {
    const routes: ApprovalRouteVersionDefinition[] = [
      route({ id: 'section-draft', scopeUnitId: 'section-1', status: 'DRAFT' }),
      factoryRoute('factory-request'),
    ]
    assert.equal(selectNearestPublishedRoute(branch.unitPath, routes, 'REQUEST').id, 'factory-request')
  })

  it('selects the published route for the requested SOLUTION or FINAL phase, never a REQUEST row', () => {
    const routes: ApprovalRouteVersionDefinition[] = [
      route({ id: 'section-request', scopeUnitId: 'section-1', phase: 'REQUEST' }),
      route({ id: 'division-solution', scopeUnitId: 'division-1', phase: 'SOLUTION', maximumPositionLevel: 5 }),
      route({ id: 'division-final', scopeUnitId: 'division-1', phase: 'FINAL' }),
    ]
    assert.equal(selectNearestPublishedRoute(branch.unitPath, routes, 'SOLUTION').id, 'division-solution')
    assert.equal(selectNearestPublishedRoute(branch.unitPath, routes, 'FINAL').id, 'division-final')
  })

  it('rejects an ambiguous nearer scope instead of skipping to the farther published route', () => {
    const routes: ApprovalRouteVersionDefinition[] = [
      route({ id: 'section-a', scopeUnitId: 'section-1' }),
      route({ id: 'section-b', scopeUnitId: 'section-1', version: 2 }),
      factoryRoute('factory-request'),
    ]
    assert.throws(() => selectNearestPublishedRoute(branch.unitPath, routes, 'REQUEST'), ApprovalRouteConfigurationError)
  })

  it('resolves to a configuration error when the nearest published route is malformed, even with a valid farther route', async () => {
    const downward = route({
      id: 'section-downward', scopeUnitId: 'section-1',
      steps: [{ order: 1, position: 'DEPARTMENT_MANAGER' }, { order: 2, position: 'SUPERVISOR' }],
    })
    const aboveCeiling = route({
      id: 'section-above-ceiling', scopeUnitId: 'section-1', maximumPositionLevel: 3,
      steps: [{ order: 1, position: 'FACTORY_MANAGER' }],
    })
    const dbWith = (routes: ApprovalRouteVersionDefinition[]): ApprovalRouteDb => ({
      loadOriginBranch: async () => branch, loadPublishedRoutes: async () => routes,
    })
    await assert.rejects(
      () => resolvePublishedApprovalRoute(resolveContext(), dbWith([downward, factoryRoute('factory-valid')])),
      (error: unknown) => error instanceof ApprovalRouteConfigurationError && /ascending/i.test(error.message),
    )
    await assert.rejects(
      () => resolvePublishedApprovalRoute(resolveContext(), dbWith([aboveCeiling, factoryRoute('factory-valid')])),
      (error: unknown) => error instanceof ApprovalRouteConfigurationError && /ceiling/i.test(error.message),
    )
  })

  it('rejects unknown positions, out-of-range and non-integer ceilings, order gaps, and duplicate positions', () => {
    assert.throws(
      () => validateRouteDefinition({ ...route(), steps: [{ order: 1, position: 'NOT_A_POSITION' as never }] }),
      (error: unknown) => error instanceof ApprovalRouteConfigurationError && /unknown/i.test(error.message),
    )
    assert.throws(() => validateRouteDefinition({ ...route(), maximumPositionLevel: 7 as never, steps: [{ order: 1, position: 'SECTION_MANAGER' }] }), /ceiling/i)
    assert.throws(() => validateRouteDefinition({ ...route(), maximumPositionLevel: 3.5 as never }), ApprovalRouteConfigurationError)
    assert.doesNotThrow(() => validateRouteDefinition({ ...route(), maximumPositionLevel: 1, steps: [{ order: 1, position: 'STAFF' }] }))
    assert.throws(() => validateRouteDefinition({ ...route(), steps: [{ order: 1, position: 'SECTION_MANAGER' }, { order: 3, position: 'DEPARTMENT_MANAGER' }] }), /order/i)
    assert.throws(() => validateRouteDefinition({ ...route(), steps: [{ order: 1, position: 'SUPERVISOR' }, { order: 2, position: 'SUPERVISOR' }] }), /duplicate/i)
  })

  it('resolves a department-manager origin whose path has no section scope', async () => {
    const managerBranch: ReportingBranch = {
      originUserId: 'user-1', primaryUnitId: 'department-1', primaryAssignmentId: 'assignment-1',
      primaryPosition: 'DEPARTMENT_MANAGER', unitPath: ['department-1', 'division-1', 'factory-1'], groupPath: [],
    }
    const calls: unknown[] = []
    const db: ApprovalRouteDb = {
      loadOriginBranch: async (userId) => { calls.push(['branch', userId]); return managerBranch },
      loadPublishedRoutes: async (input) => {
        calls.push(['routes', input])
        return [route({ id: 'department-manager-route', scopeUnitId: 'department-1', maximumPositionLevel: 5, steps: [{ order: 1, position: 'DIVISION_MANAGER' }] })]
      },
    }
    const resolved = await resolvePublishedApprovalRoute(resolveContext({ originUnitId: 'department-1' }), db)
    assert.equal(resolved.id, 'department-manager-route')
    assert.deepEqual(resolved.ancestorScopeIds, ['department-1', 'division-1', 'factory-1'])
    assert.deepEqual(calls, [['branch', 'user-1'], ['routes', { scopeUnitIds: ['department-1', 'division-1', 'factory-1'], phase: 'REQUEST' }]])
  })

  it('resolves without mutating caller data and returns distinct steps and ancestor array references', async () => {
    const callerContext = deepFreeze(resolveContext({ requestDepartmentId: 'department-9' }))
    const callerBranch = deepFreeze(structuredClone(branch))
    const callerSteps = [{ order: 1, position: 'SECTION_MANAGER' as const }]
    const callerRoutes = deepFreeze([route({ steps: callerSteps })])
    const contextSnapshot = structuredClone(callerContext)
    const branchSnapshot = structuredClone(callerBranch)
    const routesSnapshot = structuredClone(callerRoutes)
    const db: ApprovalRouteDb = { loadOriginBranch: async () => callerBranch, loadPublishedRoutes: async () => callerRoutes }

    const resolved = await resolvePublishedApprovalRoute(callerContext, db)

    assert.deepEqual(callerContext, contextSnapshot)
    assert.deepEqual(callerBranch, branchSnapshot)
    assert.deepEqual(callerRoutes, routesSnapshot)
    assert.notEqual(resolved.steps, callerSteps)
    assert.deepEqual(resolved.steps, callerSteps)
    assert.notEqual(resolved.ancestorScopeIds, callerBranch.unitPath)
    assert.deepEqual(resolved.ancestorScopeIds, [...callerBranch.unitPath])
  })
})
