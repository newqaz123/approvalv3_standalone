import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assessPositionRankChange } from '@/lib/organization/position-rank-guard'
import { OrganizationValidationError } from '@/lib/organization/assignments'
import type { AssignmentNode, PositionNode, TeamNode } from '@/lib/organization/model'

// Plan Task 4 fixture: positions p1..p4 ranks 1..4; team t1's reports-to holds
// p3 (a1), the active member holds p2 (a2); published route rv1 (REQUEST,
// scope company) has steps [p1, p3] with approval limit p4.
//
// CALLER CONTRACT (no status field exists by design): publishedRoutes must
// contain ONLY PUBLISHED route versions — the caller filters drafts before
// calling; the guard neither filters nor invents a status field. No
// draft-status data appears anywhere in these fixtures.
const positions: PositionNode[] = [
  { id: 'p1', name: 'Staff', rank: 1, isActive: true },
  { id: 'p2', name: 'Supervisor', rank: 2, isActive: true },
  { id: 'p3', name: 'Manager', rank: 3, isActive: true },
  { id: 'p4', name: 'Director', rank: 4, isActive: true },
]
const assignments: AssignmentNode[] = [
  { id: 'a1', userId: 'u1', unitId: 'eng', positionId: 'p3', teamId: null, isActive: true },
  { id: 'a2', userId: 'u2', unitId: 'eng', positionId: 'p2', teamId: 't1', isActive: true },
]
const teams: TeamNode[] = [{ id: 't1', unitId: 'eng', name: 'Crew', reportsToAssignmentId: 'a1', isActive: true }]
const publishedRoutes = [{
  id: 'rv1', scopeUnitId: 'company', phase: 'REQUEST' as const,
  approvalLimitPositionId: 'p4',
  steps: [{ stepOrder: 1, positionId: 'p1' }, { stepOrder: 2, positionId: 'p3' }],
}]

type GuardInput = Parameters<typeof assessPositionRankChange>[0]
const assess = (over: Partial<GuardInput> & Pick<GuardInput, 'positionId' | 'proposedRank'>) =>
  assessPositionRankChange({ positions, teams, assignments, publishedRoutes, ...over })

/** Every malformed-input rejection must be the typed error with ids in the message (parent A4 ruling). */
function expectGuardError(fn: () => void, ...patterns: RegExp[]): void {
  try {
    fn()
  } catch (err) {
    assert.ok(
      err instanceof OrganizationValidationError,
      `expected OrganizationValidationError, got: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    )
    assert.equal(err.code, 'ORGANIZATION_INVALID')
    for (const pattern of patterns) {
      assert.ok(pattern.test(err.message), `expected message to match ${pattern}, got: ${err.message}`)
    }
    return
  }
  assert.fail('expected assessPositionRankChange to throw, but it returned')
}

describe('position rank change guard — plan Task 4 samples', () => {
  it('blocks a change breaking a live team reporting relationship and lists it', () => {
    const impact = assess({ positionId: 'p2', proposedRank: 4 })
    assert.equal(impact.blocked, true)
    assert.deepEqual(impact.affectedReportingRelationships, [{ teamId: 't1', teamName: 'Crew', unitId: 'eng' }])
    assert.deepEqual(impact.affectedPublishedRoutes, [])
  })

  it('blocks a change breaking published step ordering or the limit', () => {
    const impact = assess({ positionId: 'p3', proposedRank: 1 })
    assert.equal(impact.blocked, true)
    assert.deepEqual(impact.affectedPublishedRoutes.map((r) => r.problem), ['STEP_NOT_ASCENDING'])
    const lowered = assess({ positionId: 'p4', proposedRank: 2 })
    assert.equal(lowered.blocked, true)
    assert.deepEqual(lowered.affectedPublishedRoutes.map((r) => r.problem), ['STEP_EXCEEDS_LIMIT'])
  })

  it('allows changes that invalidate nothing', () => {
    const impact = assess({ positionId: 'p4', proposedRank: 5 })
    assert.equal(impact.blocked, false)
    assert.deepEqual(impact.affectedReportingRelationships, [])
    assert.deepEqual(impact.affectedPublishedRoutes, [])
  })
})

describe('either side of the reporting relationship can break it', () => {
  it('blocks when the changed REPORTS-TO position drops below an active member', () => {
    const impact = assess({ publishedRoutes: [], positionId: 'p3', proposedRank: 1 })
    assert.equal(impact.blocked, true)
    assert.deepEqual(impact.affectedReportingRelationships, [{ teamId: 't1', teamName: 'Crew', unitId: 'eng' }])
  })

  it('blocks on equal rank from the member side (strictly above is violated at equality)', () => {
    const impact = assess({ positionId: 'p2', proposedRank: 3 })
    assert.equal(impact.blocked, true)
    assert.deepEqual(impact.affectedReportingRelationships, [{ teamId: 't1', teamName: 'Crew', unitId: 'eng' }])
    assert.deepEqual(impact.affectedPublishedRoutes, [])
  })

  it('blocks on equal rank from the reports-to side', () => {
    const impact = assess({ publishedRoutes: [], positionId: 'p3', proposedRank: 2 })
    assert.equal(impact.blocked, true)
    assert.deepEqual(impact.affectedReportingRelationships, [{ teamId: 't1', teamName: 'Crew', unitId: 'eng' }])
  })

  it('allows a step exactly at the limit rank (at-or-below the limit does not exceed it)', () => {
    const impact = assess({ positionId: 'p4', proposedRank: 3 })
    assert.equal(impact.blocked, false)
    assert.deepEqual(impact.affectedReportingRelationships, [])
    assert.deepEqual(impact.affectedPublishedRoutes, [])
  })
})

describe('published route assessment — ordering, limits, multiple problems, list identity', () => {
  it('sorts persisted steps by stepOrder, not input array order (allowed case)', () => {
    const shuffled = [{ stepOrder: 2, positionId: 'p3' }, { stepOrder: 1, positionId: 'p1' }]
    const impact = assess({ publishedRoutes: [{ ...publishedRoutes[0], steps: shuffled }], positionId: 'p4', proposedRank: 5 })
    assert.equal(impact.blocked, false)
    assert.deepEqual(impact.affectedReportingRelationships, [])
    assert.deepEqual(impact.affectedPublishedRoutes, [])
  })

  it('sorts persisted steps by stepOrder, not input array order (blocked case)', () => {
    const shuffled = [{ stepOrder: 3, positionId: 'p4' }, { stepOrder: 1, positionId: 'p1' }, { stepOrder: 2, positionId: 'p3' }]
    const impact = assess({ publishedRoutes: [{ ...publishedRoutes[0], steps: shuffled }], positionId: 'p3', proposedRank: 1 })
    assert.equal(impact.blocked, true)
    assert.deepEqual(impact.affectedPublishedRoutes.map((r) => r.problem), ['STEP_NOT_ASCENDING'])
    assert.deepEqual(impact.affectedReportingRelationships, [{ teamId: 't1', teamName: 'Crew', unitId: 'eng' }])
  })

  it('lists both problems for one route, ascending check first, with full route identity', () => {
    const rv2 = {
      id: 'rv2', scopeUnitId: 'ops', phase: 'SOLUTION' as const,
      approvalLimitPositionId: 'p4',
      steps: [{ stepOrder: 1, positionId: 'p1' }, { stepOrder: 2, positionId: 'p3' }, { stepOrder: 3, positionId: 'p4' }],
    }
    // p1 -> 5 makes the sorted ranks [5, 3, 4]: non-ascending (3 <= 5) AND over the limit (5 > 4).
    const impact = assess({ publishedRoutes: [rv2], positionId: 'p1', proposedRank: 5 })
    assert.equal(impact.blocked, true)
    assert.deepEqual(impact.affectedPublishedRoutes, [
      { routeVersionId: 'rv2', scopeUnitId: 'ops', phase: 'SOLUTION', problem: 'STEP_NOT_ASCENDING' },
      { routeVersionId: 'rv2', scopeUnitId: 'ops', phase: 'SOLUTION', problem: 'STEP_EXCEEDS_LIMIT' },
    ])
    assert.deepEqual(impact.affectedReportingRelationships, [])
  })

  it('lists each affected route in input order with per-route identity', () => {
    const rv2 = {
      id: 'rv2', scopeUnitId: 'ops', phase: 'SOLUTION' as const,
      approvalLimitPositionId: 'p4',
      steps: [{ stepOrder: 1, positionId: 'p1' }, { stepOrder: 2, positionId: 'p2' }],
    }
    // p1 -> 3 breaks both routes' ascending order (rv1: [3, 3]; rv2: [3, 2]) without exceeding either limit.
    const impact = assess({ publishedRoutes: [publishedRoutes[0], rv2], positionId: 'p1', proposedRank: 3 })
    assert.equal(impact.blocked, true)
    assert.deepEqual(impact.affectedPublishedRoutes, [
      { routeVersionId: 'rv1', scopeUnitId: 'company', phase: 'REQUEST', problem: 'STEP_NOT_ASCENDING' },
      { routeVersionId: 'rv2', scopeUnitId: 'ops', phase: 'SOLUTION', problem: 'STEP_NOT_ASCENDING' },
    ])
    assert.deepEqual(impact.affectedReportingRelationships, [])
  })

  it('treats every supplied route as published (input has no status field; draft filtering is caller-owned)', () => {
    const impact = assess({ positionId: 'p3', proposedRank: 1 })
    assert.equal(impact.blocked, true)
    assert.ok(impact.affectedPublishedRoutes.length > 0)
  })
})

describe('inactive relationships are history and never block', () => {
  it('ignores an INACTIVE team whose reporting relationship the change would break', () => {
    const retiredTeam: TeamNode[] = [
      ...teams,
      { id: 't2', unitId: 'eng', name: 'Old Crew', reportsToAssignmentId: 'a1', isActive: false },
    ]
    const seniorMember: AssignmentNode[] = [
      ...assignments,
      { id: 'a3', userId: 'u3', unitId: 'eng', positionId: 'p4', teamId: 't2', isActive: true },
    ]
    // If t2 were active, raising its member position p4 to 5 would break reports-to (3 <= 5).
    const impact = assess({ teams: retiredTeam, assignments: seniorMember, positionId: 'p4', proposedRank: 5 })
    assert.equal(impact.blocked, false)
    assert.deepEqual(impact.affectedReportingRelationships, [])
    assert.deepEqual(impact.affectedPublishedRoutes, [])
  })

  it('compares reports-to rank against ACTIVE members only', () => {
    const inactiveSenior = [
      ...assignments,
      { id: 'a4', userId: 'u4', unitId: 'eng', positionId: 'p4', teamId: 't1', isActive: false },
    ]
    // If a4 counted, p3 -> 4 would tie it (4 <= 4); inactive members are exempt.
    const impact = assess({ assignments: inactiveSenior, positionId: 'p3', proposedRank: 4 })
    assert.equal(impact.blocked, false)
    assert.deepEqual(impact.affectedReportingRelationships, [])
    assert.deepEqual(impact.affectedPublishedRoutes, [])
  })
})

describe('purity — assessment only', () => {
  it('never mutates its inputs and performs no auto-repair (attempt snapshots are not part of the input)', () => {
    const input = {
      positions,
      teams,
      assignments,
      publishedRoutes: [{
        ...publishedRoutes[0],
        steps: [{ stepOrder: 2, positionId: 'p3' }, { stepOrder: 1, positionId: 'p1' }],
      }],
      positionId: 'p3',
      proposedRank: 1,
    }
    const snapshot = JSON.parse(JSON.stringify(input))
    const impact = assessPositionRankChange(input)
    assert.equal(impact.blocked, true)
    assert.deepEqual(input, snapshot)
  })

  it('performs no mutation attempt on frozen inputs (Object.freeze guard; strict mode would throw)', () => {
    const frozenInput = {
      positions: Object.freeze([...positions]),
      teams: Object.freeze([...teams]),
      assignments: Object.freeze([...assignments]),
      publishedRoutes: Object.freeze([{
        ...publishedRoutes[0],
        steps: Object.freeze([...publishedRoutes[0].steps]),
      }]),
      positionId: 'p3',
      proposedRank: 1,
    }
    let impact: ReturnType<typeof assessPositionRankChange> | undefined
    assert.doesNotThrow(() => {
      impact = assessPositionRankChange(frozenInput)
    })
    assert.equal(impact?.blocked, true)
  })
})

describe('malformed consulted input throws OrganizationValidationError (parent A4 ruling)', () => {
  it('throws on a missing change target, naming it', () => {
    expectGuardError(() => assess({ positionId: 'p-x', proposedRank: 2 }), /p-x/, /missing/)
  })

  it('throws on a non-finite proposed rank (NaN, +Infinity, -Infinity)', () => {
    expectGuardError(() => assess({ positionId: 'p2', proposedRank: Number.NaN }), /not a finite/)
    expectGuardError(() => assess({ positionId: 'p2', proposedRank: Number.POSITIVE_INFINITY }), /not a finite/)
    expectGuardError(() => assess({ positionId: 'p2', proposedRank: Number.NEGATIVE_INFINITY }), /not a finite/)
  })

  it('throws on duplicate position ids, including historical inactive rows', () => {
    const duplicated = [...positions, { id: 'p4', name: 'Director (old)', rank: 9, isActive: false }]
    expectGuardError(() => assess({ positions: duplicated, positionId: 'p2', proposedRank: 2 }), /duplicate position/)
  })

  it('throws on duplicate assignment ids in the consulted id map', () => {
    const duplicated = [...assignments, { ...assignments[0], userId: 'u9' }]
    expectGuardError(() => assess({ assignments: duplicated, positionId: 'p2', proposedRank: 2 }), /duplicate assignment/)
  })

  it('throws when an ACTIVE team reports-to references a missing assignment', () => {
    expectGuardError(
      () => assess({ teams: [{ ...teams[0], reportsToAssignmentId: 'a-x' }], positionId: 'p2', proposedRank: 2 }),
      /a-x/, /reports-to/,
    )
  })

  it('throws when an ACTIVE team reports-to is an inactive assignment', () => {
    const retired = [...assignments, { id: 'a5', userId: 'u5', unitId: 'eng', positionId: 'p4', teamId: null, isActive: false }]
    expectGuardError(
      () => assess({ assignments: retired, teams: [{ ...teams[0], reportsToAssignmentId: 'a5' }], positionId: 'p2', proposedRank: 2 }),
      /inactive/,
    )
  })

  it('throws when an ACTIVE team reports-to is active in a different unit', () => {
    const remote = [...assignments, { id: 'a6', userId: 'u6', unitId: 'ops', positionId: 'p4', teamId: null, isActive: true }]
    expectGuardError(
      () => assess({ assignments: remote, teams: [{ ...teams[0], reportsToAssignmentId: 'a6' }], positionId: 'p2', proposedRank: 2 }),
      /unit/,
    )
  })

  it('throws when an ACTIVE team reports-to is itself a member of the team', () => {
    const selfMember = assignments.map((a) => (a.id === 'a1' ? { ...a, teamId: 't1' } : a))
    expectGuardError(() => assess({ assignments: selfMember, positionId: 'p2', proposedRank: 2 }), /member/)
  })

  it('throws when a live relationship references a missing or inactive position', () => {
    const ghostPosition = assignments.map((a) => (a.id === 'a2' ? { ...a, positionId: 'p-gone' } : a))
    expectGuardError(() => assess({ assignments: ghostPosition, positionId: 'p4', proposedRank: 5 }), /p-gone/)
    const withRetired = [...positions, { id: 'p9', name: 'Old Title', rank: 9, isActive: false }]
    const reportsToRetired = assignments.map((a) => (a.id === 'a1' ? { ...a, positionId: 'p9' } : a))
    expectGuardError(
      () => assess({ positions: withRetired, assignments: reportsToRetired, positionId: 'p4', proposedRank: 5 }),
      /inactive position/,
    )
  })

  it('throws on a non-finite rank consulted by a live relationship', () => {
    const nanRank = positions.map((p) => (p.id === 'p2' ? { ...p, rank: Number.NaN } : p))
    expectGuardError(() => assess({ positions: nanRank, positionId: 'p4', proposedRank: 5 }), /non-finite/)
  })

  it('tolerates a non-finite rank on an irrelevant inactive historical position', () => {
    const withDust = [...positions, { id: 'p-nan', name: 'Ancient', rank: Number.NaN, isActive: false }]
    const impact = assess({ positions: withDust, positionId: 'p4', proposedRank: 5 })
    assert.equal(impact.blocked, false)
  })

  it('throws when a supplied route step references a missing position', () => {
    expectGuardError(
      () => assess({
        publishedRoutes: [{ ...publishedRoutes[0], steps: [{ stepOrder: 1, positionId: 'p-gone' }] }],
        positionId: 'p4', proposedRank: 5,
      }),
      /p-gone/,
    )
  })

  it('throws when a supplied route limit references a missing position', () => {
    expectGuardError(
      () => assess({ publishedRoutes: [{ ...publishedRoutes[0], approvalLimitPositionId: 'p-gone' }], positionId: 'p4', proposedRank: 5 }),
      /p-gone/,
    )
  })

  it('throws on a non-finite rank consulted by a supplied route', () => {
    const nanLimit = positions.map((p) => (p.id === 'p4' ? { ...p, rank: Number.NaN } : p))
    expectGuardError(() => assess({ positions: nanLimit, positionId: 'p2', proposedRank: 2 }), /non-finite/)
  })

  it('throws on duplicate stepOrder within one supplied route', () => {
    expectGuardError(
      () => assess({
        publishedRoutes: [{
          ...publishedRoutes[0],
          steps: [{ stepOrder: 1, positionId: 'p1' }, { stepOrder: 1, positionId: 'p3' }],
        }],
        positionId: 'p4', proposedRank: 5,
      }),
      /duplicate stepOrder/,
    )
  })
})

describe('fix1 P1-1 — the change target must not bypass live-reference validation', () => {
  it('throws when an active reports-to holds the INACTIVE change target position', () => {
    const inactiveTarget = positions.map((p) => (p.id === 'p3' ? { ...p, isActive: false } : p))
    expectGuardError(() => assess({ positions: inactiveTarget, positionId: 'p3', proposedRank: 3 }), /inactive position/)
  })

  it('throws when an active member holds the INACTIVE change target position', () => {
    const inactiveTarget = positions.map((p) => (p.id === 'p2' ? { ...p, isActive: false } : p))
    expectGuardError(() => assess({ positions: inactiveTarget, positionId: 'p2', proposedRank: 5 }), /inactive position/)
  })

  it('still allows changing an inactive target that no live relationship consults (route-only reference)', () => {
    const withInactive = [...positions, { id: 'p9', name: 'Old Title', rank: 9, isActive: false }]
    const routeOnInactive = [{
      id: 'rv9', scopeUnitId: 'company', phase: 'REQUEST' as const,
      approvalLimitPositionId: 'p4',
      steps: [{ stepOrder: 1, positionId: 'p9' }],
    }]
    const impact = assess({ positions: withInactive, publishedRoutes: routeOnInactive, positionId: 'p9', proposedRank: 2 })
    assert.equal(impact.blocked, false)
  })
})

describe('fix1 P1-2 — non-finite stepOrder is malformed consulted input and throws', () => {
  const singleBadStep = (stepOrder: number) => [{
    ...publishedRoutes[0],
    steps: [{ stepOrder, positionId: 'p1' }],
  }]

  it('throws on a NaN stepOrder even for a single step, naming the route and value', () => {
    expectGuardError(() => assess({ publishedRoutes: singleBadStep(Number.NaN), positionId: 'p4', proposedRank: 5 }), /rv1/, /stepOrder/)
  })

  it('throws on +Infinity stepOrder', () => {
    expectGuardError(() => assess({ publishedRoutes: singleBadStep(Number.POSITIVE_INFINITY), positionId: 'p4', proposedRank: 5 }), /Infinity/)
  })

  it('throws on -Infinity stepOrder', () => {
    expectGuardError(() => assess({ publishedRoutes: singleBadStep(Number.NEGATIVE_INFINITY), positionId: 'p4', proposedRank: 5 }), /-Infinity/)
  })
})

describe('fix1 P1-3 — every active member is validated regardless of input order', () => {
  const badMember = (positionId: string): AssignmentNode =>
    ({ id: 'a-bad', userId: 'u-bad', unitId: 'eng', positionId, teamId: 't1', isActive: true })

  it('throws on a missing member position appearing AFTER a valid proposed violation (no early break)', () => {
    const withBad = [...assignments, badMember('p-gone')]
    expectGuardError(() => assess({ assignments: withBad, positionId: 'p2', proposedRank: 4 }), /p-gone/)
  })

  it('throws on an inactive member position appearing after a valid proposed violation', () => {
    const withRetired = [...positions, { id: 'p9', name: 'Old Title', rank: 9, isActive: false }]
    const withBad = [...assignments, badMember('p9')]
    expectGuardError(() => assess({ positions: withRetired, assignments: withBad, positionId: 'p2', proposedRank: 4 }), /inactive position/)
  })

  it('throws on a non-finite member rank appearing after a valid proposed violation', () => {
    const withNan = [...positions, { id: 'p-nan9', name: 'Broken', rank: Number.NaN, isActive: true }]
    const withBad = [...assignments, badMember('p-nan9')]
    expectGuardError(() => assess({ positions: withNan, assignments: withBad, positionId: 'p2', proposedRank: 4 }), /non-finite/)
  })

  it('is order-independent: the same typed error fires when the malformed member comes first', () => {
    const reordered = [badMember('p-gone'), ...assignments]
    expectGuardError(() => assess({ assignments: reordered, positionId: 'p2', proposedRank: 4 }), /p-gone/)
  })

  it('still lists the team exactly once when several members violate', () => {
    const twoViolators = [
      ...assignments,
      { id: 'a-v1', userId: 'u-v1', unitId: 'eng', positionId: 'p2', teamId: 't1', isActive: true },
      { id: 'a-v2', userId: 'u-v2', unitId: 'eng', positionId: 'p2', teamId: 't1', isActive: true },
    ]
    const impact = assess({ assignments: twoViolators, publishedRoutes: [], positionId: 'p2', proposedRank: 4 })
    assert.equal(impact.blocked, true)
    assert.deepEqual(impact.affectedReportingRelationships, [{ teamId: 't1', teamName: 'Crew', unitId: 'eng' }])
  })
})

describe('blocked vs malformed distinction (parent A4 ruling)', () => {
  it('returns a blocked impact — never an error — for a valid change that makes a route non-ascending', () => {
    let impact: ReturnType<typeof assessPositionRankChange> | undefined
    assert.doesNotThrow(() => {
      impact = assess({ positionId: 'p3', proposedRank: 1 })
    })
    assert.equal(impact?.blocked, true)
    assert.deepEqual(impact?.affectedPublishedRoutes.map((r) => r.problem), ['STEP_NOT_ASCENDING'])
  })
})
