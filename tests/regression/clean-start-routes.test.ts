// Clean-start route definition + nearest-published selection (Plan B Task 2).
// In-memory fakes only: NO Prisma, NO database, NO env, NO schema/server ops.
// Pins invalid-nearer-fails (no fallback to a valid root default) and that
// DRAFT/RETIRED-only scopes are not configured.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ApprovalRouteConfigurationError,
  findLimitConflicts,
  validateRouteDefinition,
} from '@/lib/approval-routes/definition'
import type { ApprovalRouteVersionDefinition } from '@/lib/approval-routes/definition'
import { resolvePublishedApprovalRoute, selectNearestRoute } from '@/lib/approval-routes/selection'
import type { ApprovalRouteDb } from '@/lib/approval-routes/selection'
import type { PositionNode, ReportingPath } from '@/lib/organization/model'

const positions: PositionNode[] = [
  { id: 'p1', name: 'Staff', rank: 1, isActive: true },
  { id: 'p2', name: 'Supervisor', rank: 2, isActive: true },
  { id: 'p3', name: 'Manager', rank: 3, isActive: true },
  { id: 'p4', name: 'Director', rank: 4, isActive: true },
  { id: 'p-old', name: 'Retired title', rank: 2, isActive: false },
]
const positionMap: ReadonlyMap<string, PositionNode> = new Map(positions.map((position) => [position.id, position]))

const UNIT_PATH = ['section-a', 'department-x', 'company'] as const

const originPath: ReportingPath = {
  originUserId: 'user-1',
  assignmentId: 'a-1',
  unitId: 'section-a',
  positionId: 'p1',
  teamId: null,
  unitPath: UNIT_PATH,
  steps: [],
}

const route = (overrides: Partial<ApprovalRouteVersionDefinition> = {}): ApprovalRouteVersionDefinition => ({
  id: 'rv',
  scopeUnitId: 'company',
  phase: 'REQUEST',
  version: 1,
  approvalLimitPositionId: 'p4',
  status: 'PUBLISHED',
  steps: [
    { order: 1, positionId: 'p1' },
    { order: 2, positionId: 'p3' },
  ],
  ...overrides,
})

const validRoot = (): ApprovalRouteVersionDefinition => route({ id: 'root-default', scopeUnitId: 'company' })

function expectConfigError(fn: () => void, pattern: RegExp): void {
  try {
    fn()
  } catch (err) {
    assert.ok(
      err instanceof ApprovalRouteConfigurationError,
      `expected ApprovalRouteConfigurationError, got: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    )
    assert.equal(err.code, 'APPROVAL_ROUTE_CONFIGURATION')
    assert.match(err.message, pattern)
    return
  }
  assert.fail('expected to throw ApprovalRouteConfigurationError, but it returned')
}

function makeDb(over: Partial<ApprovalRouteDb> = {}): ApprovalRouteDb {
  return {
    loadOriginPath: async () => originPath,
    loadRoutes: async () => [validRoot()],
    loadPositions: async () => positions,
    ...over,
  }
}

describe('clean-start route definition validation', () => {
  it('accepts contiguous ascending steps [p1, p3] under limit p4', () => {
    const def = route({
      steps: [
        { order: 1, positionId: 'p1' },
        { order: 2, positionId: 'p3' },
      ],
      approvalLimitPositionId: 'p4',
    })
    assert.doesNotThrow(() => validateRouteDefinition(def, positionMap))
    assert.deepEqual(findLimitConflicts(def, positionMap), [])
  })

  it('throws /ascending/i for non-strictly-ascending ranks [p3, p1]', () => {
    expectConfigError(
      () => validateRouteDefinition(route({
        steps: [
          { order: 1, positionId: 'p3' },
          { order: 2, positionId: 'p1' },
        ],
      }), positionMap),
      /ascending/i,
    )
  })

  it('throws /exceeds/i for [p1, p4] under limit p3 AND findLimitConflicts returns EXCEEDS_LIMIT', () => {
    const def = route({
      steps: [
        { order: 1, positionId: 'p1' },
        { order: 2, positionId: 'p4' },
      ],
      approvalLimitPositionId: 'p3',
    })
    expectConfigError(() => validateRouteDefinition(def, positionMap), /exceeds/i)
    assert.deepEqual(findLimitConflicts(def, positionMap), [
      { order: 2, positionId: 'p4', problem: 'EXCEEDS_LIMIT' },
    ])
  })

  it('throws /duplicate/i for a repeated position id', () => {
    expectConfigError(
      () => validateRouteDefinition(route({
        steps: [
          { order: 1, positionId: 'p1' },
          { order: 2, positionId: 'p1' },
        ],
      }), positionMap),
      /duplicate/i,
    )
  })

  it('throws /contiguous/i when orders start at 2 instead of 1..n', () => {
    expectConfigError(
      () => validateRouteDefinition(route({
        steps: [
          { order: 2, positionId: 'p1' },
          { order: 3, positionId: 'p3' },
        ],
      }), positionMap),
      /contiguous/i,
    )
  })

  it('throws /unknown/i for an unknown step position', () => {
    expectConfigError(
      () => validateRouteDefinition(route({
        steps: [{ order: 1, positionId: 'p-missing' }],
      }), positionMap),
      /unknown/i,
    )
  })

  it('throws for an inactive step position', () => {
    expectConfigError(
      () => validateRouteDefinition(route({
        steps: [{ order: 1, positionId: 'p-old' }],
      }), positionMap),
      /inactive/i,
    )
  })

  it('throws /unknown/i for an unknown approval limit position', () => {
    expectConfigError(
      () => validateRouteDefinition(route({ approvalLimitPositionId: 'p-missing' }), positionMap),
      /unknown/i,
    )
  })

  it('throws for an inactive approval limit position', () => {
    expectConfigError(
      () => validateRouteDefinition(route({ approvalLimitPositionId: 'p-old' }), positionMap),
      /inactive/i,
    )
  })
})

describe('clean-start nearest published route selection', () => {
  it('selects a section-a exception over the company root default', () => {
    const selected = selectNearestRoute(
      UNIT_PATH,
      [
        validRoot(),
        route({ id: 'section-exception', scopeUnitId: 'section-a' }),
      ],
      'REQUEST',
    )
    assert.equal(selected.id, 'section-exception')
  })

  it('selects the root default when no nearer published exception exists', () => {
    const selected = selectNearestRoute(UNIT_PATH, [validRoot()], 'REQUEST')
    assert.equal(selected.id, 'root-default')
  })

  it('invalid nearer fails: two published routes at department-x throw Ambiguous even with a valid root default', () => {
    expectConfigError(
      () => selectNearestRoute(
        UNIT_PATH,
        [
          validRoot(),
          route({ id: 'dept-a', scopeUnitId: 'department-x' }),
          route({ id: 'dept-b', scopeUnitId: 'department-x', version: 2 }),
        ],
        'REQUEST',
      ),
      /Ambiguous/i,
    )
  })

  it('treats a draft-only nearer scope as not configured and falls through to a published ancestor', () => {
    const selected = selectNearestRoute(
      UNIT_PATH,
      [
        validRoot(),
        route({ id: 'section-draft', scopeUnitId: 'section-a', status: 'DRAFT' }),
        route({ id: 'dept-retired', scopeUnitId: 'department-x', status: 'RETIRED' }),
      ],
      'REQUEST',
    )
    assert.equal(selected.id, 'root-default')
  })

  it('does not let extra drafts at a published scope create Ambiguous', () => {
    const selected = selectNearestRoute(
      UNIT_PATH,
      [
        validRoot(),
        route({ id: 'section-published', scopeUnitId: 'section-a' }),
        route({ id: 'section-draft', scopeUnitId: 'section-a', status: 'DRAFT', version: 2 }),
      ],
      'REQUEST',
    )
    assert.equal(selected.id, 'section-published')
  })

  it('throws /No published route/i when nothing in the origin branch is published', () => {
    expectConfigError(
      () => selectNearestRoute(
        UNIT_PATH,
        [
          route({ id: 'root-draft', status: 'DRAFT' }),
          route({ id: 'section-retired', scopeUnitId: 'section-a', status: 'RETIRED' }),
        ],
        'REQUEST',
      ),
      /No published route/i,
    )
  })

  it('ignores other-phase published rows at a nearer scope (not configured for this phase)', () => {
    const selected = selectNearestRoute(
      UNIT_PATH,
      [
        validRoot(),
        route({ id: 'section-solution', scopeUnitId: 'section-a', phase: 'SOLUTION' }),
      ],
      'REQUEST',
    )
    assert.equal(selected.id, 'root-default')
  })
})

describe('clean-start resolvePublishedApprovalRoute', () => {
  it('matches the origin path, loads unitPath routes, selects, validates, and returns ancestorScopeIds', async () => {
    const calls: unknown[] = []
    const sectionException = route({ id: 'section-exception', scopeUnitId: 'section-a' })
    const db = makeDb({
      loadOriginPath: async (originUserId) => {
        calls.push(['path', originUserId])
        return originPath
      },
      loadRoutes: async (input) => {
        calls.push(['routes', input])
        return [validRoot(), sectionException]
      },
      loadPositions: async () => {
        calls.push(['positions'])
        return positions
      },
    })
    const resolved = await resolvePublishedApprovalRoute(
      { phase: 'REQUEST', originUserId: 'user-1', originUnitId: 'section-a', requestId: 'req-1' },
      db,
    )
    assert.equal(resolved.id, 'section-exception')
    assert.deepEqual(resolved.ancestorScopeIds, [...UNIT_PATH])
    assert.deepEqual(calls, [
      ['path', 'user-1'],
      ['routes', { scopeUnitIds: [...UNIT_PATH], phase: 'REQUEST' }],
      ['positions'],
    ])
  })

  it('fails closed on a null origin path (does not return null)', async () => {
    await assert.rejects(
      () => resolvePublishedApprovalRoute(
        { phase: 'REQUEST', originUserId: 'user-1', originUnitId: 'section-a', requestId: 'req-1' },
        makeDb({ loadOriginPath: async () => null }),
      ),
      (err: unknown) => {
        assert.ok(err instanceof ApprovalRouteConfigurationError)
        assert.equal(err.code, 'APPROVAL_ROUTE_CONFIGURATION')
        return true
      },
    )
  })

  it('fails closed when the origin path unit does not match the context', async () => {
    await assert.rejects(
      () => resolvePublishedApprovalRoute(
        { phase: 'REQUEST', originUserId: 'user-1', originUnitId: 'department-x', requestId: 'req-1' },
        makeDb(),
      ),
      ApprovalRouteConfigurationError,
    )
  })

  it('invalid nearer published definition fails closed and does not fall back to a valid root default', async () => {
    const invalidNearer = route({
      id: 'dept-invalid',
      scopeUnitId: 'department-x',
      steps: [
        { order: 1, positionId: 'p3' },
        { order: 2, positionId: 'p1' },
      ],
    })
    await assert.rejects(
      () => resolvePublishedApprovalRoute(
        { phase: 'REQUEST', originUserId: 'user-1', originUnitId: 'section-a', requestId: 'req-1' },
        makeDb({ loadRoutes: async () => [validRoot(), invalidNearer] }),
      ),
      /ascending/i,
    )
  })
})

describe('clean-start route modules stay off the legacy engine and Prisma', () => {
  it('does not import approval-routes/{validation,resolver} or Prisma', () => {
    for (const rel of ['src/lib/approval-routes/definition.ts', 'src/lib/approval-routes/selection.ts']) {
      const src = readFileSync(rel, 'utf8')
      assert.doesNotMatch(src, /approval-routes\/validation/)
      assert.doesNotMatch(src, /approval-routes\/resolver/)
      assert.doesNotMatch(src, /from ['"]\.\/validation['"]/)
      assert.doesNotMatch(src, /from ['"]\.\/resolver['"]/)
      assert.doesNotMatch(src, /@prisma\/client/)
      assert.doesNotMatch(src, /from ['"]prisma/)
    }
  })
})
