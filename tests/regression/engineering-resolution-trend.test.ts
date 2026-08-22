import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildEngineeringResolutionTrend,
  deriveEngineeringCycles,
  type EngineeringTrendEvent,
  type EngineeringTrendRequestSnapshot,
} from '@/lib/engineering-resolution-trend'

const read = (path: string) => readFileSync(path, 'utf8')

const NOW = new Date('2026-08-16T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** Timestamp `daysAgo` days (plus `hours` extra hours) before NOW, mid-day/mid-window to stay timezone-safe. */
function at(daysAgo: number, hours = 0): Date {
  return new Date(NOW.getTime() - daysAgo * DAY_MS - hours * HOUR_MS)
}

function events(...specs: Array<[requestId: string, toStatus: string, when: Date]>): EngineeringTrendEvent[] {
  return specs.map(([requestId, toStatus, when]) => ({ requestId, toStatus, at: when }))
}

function snapshot(overrides: Partial<EngineeringTrendRequestSnapshot> & { requestId: string }): EngineeringTrendRequestSnapshot {
  return {
    status: 'ImprovementRequest',
    createdAt: at(40),
    updatedAt: at(3),
    ...overrides,
  }
}

function build(input: {
  events?: EngineeringTrendEvent[]
  snapshots?: EngineeringTrendRequestSnapshot[]
  dateRange: '7days' | '30days' | '90days' | 'all'
  now?: Date
}) {
  return buildEngineeringResolutionTrend({
    events: input.events ?? [],
    snapshots: input.snapshots ?? [],
    dateRange: input.dateRange,
    now: input.now ?? NOW,
  })
}

const unresolvedOf = (points: ReturnType<typeof build>) => points.map((p) => p.engineeringUnresolved)
const resolvedOf = (points: ReturnType<typeof build>) => points.map((p) => p.resolvedByEngineering)

describe('engineering lifecycle cycle derivation', () => {
  it('opens a cycle on SentToEngineer and closes it resolved on SendBackToRequester', () => {
    const cycles = deriveEngineeringCycles(
      events(['r1', 'SentToEngineer', at(10)], ['r1', 'SendBackToRequester', at(9)]),
      [],
    )
    assert.equal(cycles.length, 1)
    assert.equal(cycles[0].resolved, true)
    assert.equal(cycles[0].openedAt.getTime(), at(10).getTime())
    assert.equal(cycles[0].closedAt?.getTime(), at(9).getTime())
  })

  it('does not double-count Completed after SendBackToRequester already closed the cycle', () => {
    const cycles = deriveEngineeringCycles(
      events(
        ['r1', 'SentToEngineer', at(10)],
        ['r1', 'SendBackToRequester', at(9)],
        ['r1', 'Completed', at(5)],
      ),
      [],
    )
    assert.equal(cycles.length, 1)
    assert.equal(cycles[0].resolved, true)
  })

  it('closes an open cycle on Cancelled without counting it resolved', () => {
    const cycles = deriveEngineeringCycles(
      events(['r1', 'SentToEngineer', at(10)], ['r1', 'Cancelled', at(8)]),
      [],
    )
    assert.equal(cycles.length, 1)
    assert.equal(cycles[0].resolved, false)
    assert.equal(cycles[0].closedAt?.getTime(), at(8).getTime())
  })

  it('opens a new rework cycle on a later SentToEngineer', () => {
    const cycles = deriveEngineeringCycles(
      events(
        ['r1', 'SentToEngineer', at(20)],
        ['r1', 'SendBackToRequester', at(18)],
        ['r1', 'SentToEngineer', at(10)],
        ['r1', 'SendBackToRequester', at(2)],
      ),
      [],
    )
    assert.equal(cycles.length, 2)
    assert.ok(cycles.every((cycle) => cycle.resolved))
  })

  it('keeps a cycle open when no closing event ever arrives', () => {
    const cycles = deriveEngineeringCycles(events(['r1', 'SentToEngineer', at(40)]), [])
    assert.equal(cycles.length, 1)
    assert.equal(cycles[0].closedAt, null)
    assert.equal(cycles[0].resolved, false)
  })

  it('orders events chronologically even when supplied out of order', () => {
    const cycles = deriveEngineeringCycles(
      events(
        ['r1', 'SendBackToRequester', at(2)],
        ['r1', 'SentToEngineer', at(10)],
      ),
      [],
    )
    assert.equal(cycles.length, 1)
    assert.equal(cycles[0].openedAt.getTime(), at(10).getTime())
  })

  it('ignores closing events that arrive with no open cycle', () => {
    const cycles = deriveEngineeringCycles(
      events(['r1', 'Cancelled', at(5)], ['r2', 'Completed', at(4)]),
      [],
    )
    assert.equal(cycles.length, 0)
  })

  it('applies the conservative legacy fallback only to requests without lifecycle events', () => {
    // r1: currently with engineering, no lifecycle events -> one open cycle from updatedAt.
    // r2: status proves engineering finished -> one resolved cycle at updatedAt.
    // r3/r4: cancelled / never sent -> nothing (cannot prove engineering involvement).
    // r5: has (unusable) events, so no snapshot fallback is applied.
    const cycles = deriveEngineeringCycles(
      events(['r5', 'Cancelled', at(5)]),
      [
        snapshot({ requestId: 'r1', status: 'SentToEngineer' }),
        snapshot({ requestId: 'r2', status: 'Completed', updatedAt: at(2) }),
        snapshot({ requestId: 'r3', status: 'Cancelled' }),
        snapshot({ requestId: 'r4', status: 'ImprovementRequest' }),
        snapshot({ requestId: 'r5', status: 'Cancelled' }),
      ],
    )
    assert.deepEqual(
      cycles.map((c) => c.requestId).sort(),
      ['r1', 'r2'],
    )
    const r1 = cycles.find((c) => c.requestId === 'r1')!
    assert.equal(r1.closedAt, null)
    const r2 = cycles.find((c) => c.requestId === 'r2')!
    assert.equal(r2.resolved, true)
    assert.equal(r2.openedAt.getTime(), at(2).getTime())
  })
})

describe('engineering resolution trend aggregation', () => {
  it('aggregates into 7 daily buckets for the 7days range', () => {
    const points = build({ dateRange: '7days' })
    assert.equal(points.length, 7)
  })

  it('aggregates into weekly buckets for 30days (5) and 90days (13)', () => {
    assert.equal(build({ dateRange: '30days' }).length, 5)
    assert.equal(build({ dateRange: '90days' }).length, 13)
  })

  it('aggregates monthly across available history for the all range (no 90-day cap)', () => {
    const points = build({
      dateRange: 'all',
      events: events(['r1', 'SentToEngineer', at(130)]),
    })
    // at(130) is mid-April 2026, NOW is mid-August 2026 -> Apr, May, Jun, Jul, Aug.
    assert.equal(points.length, 5)
  })

  it('returns no periods for the all range when there is no history', () => {
    assert.deepEqual(build({ dateRange: 'all' }), [])
  })

  it('counts cycles opened before the window as carry-in backlog in every period', () => {
    const points = build({
      dateRange: '30days',
      events: events(['r1', 'SentToEngineer', at(40)]),
    })
    assert.deepEqual(unresolvedOf(points), [1, 1, 1, 1, 1])
    assert.deepEqual(resolvedOf(points), [0, 0, 0, 0, 0])
  })

  it('carry-in backlog drops out of unresolved in the period where the cycle closes', () => {
    const points = build({
      dateRange: '30days',
      events: events(['r1', 'SentToEngineer', at(40)], ['r1', 'SendBackToRequester', at(9)]),
    })
    // Weekly buckets (oldest first): ends at NOW-28d, NOW-21d, NOW-14d, NOW-7d, NOW.
    assert.deepEqual(unresolvedOf(points), [1, 1, 1, 0, 0])
    assert.deepEqual(resolvedOf(points), [0, 0, 0, 1, 0])
  })

  it('resolves a cycle exactly once even when Completed follows SendBackToRequester', () => {
    // The cycle opens and closes inside the same weekly bucket, so it is
    // never open at a period end (unresolved stays 0 everywhere) and the
    // later Completed event must not add a second resolution.
    const points = build({
      dateRange: '30days',
      events: events(
        ['r1', 'SentToEngineer', at(10)],
        ['r1', 'SendBackToRequester', at(9)],
        ['r1', 'Completed', at(5)],
      ),
    })
    assert.deepEqual(resolvedOf(points), [0, 0, 0, 1, 0])
    assert.equal(resolvedOf(points).reduce((sum, n) => sum + n, 0), 1)
    assert.deepEqual(unresolvedOf(points), [0, 0, 0, 0, 0])
  })

  it('cancellation removes carry-in backlog without incrementing resolved', () => {
    const points = build({
      dateRange: '30days',
      events: events(['r1', 'SentToEngineer', at(40)], ['r1', 'Cancelled', at(8)]),
    })
    assert.deepEqual(unresolvedOf(points), [1, 1, 1, 0, 0])
    assert.deepEqual(resolvedOf(points), [0, 0, 0, 0, 0])
  })

  it('tracks a rework cycle as a second resolution with backlog in between', () => {
    const points = build({
      dateRange: '30days',
      events: events(
        ['r1', 'SentToEngineer', at(20)],
        ['r1', 'SendBackToRequester', at(18)],
        ['r1', 'SentToEngineer', at(10)],
        ['r1', 'SendBackToRequester', at(2)],
      ),
    })
    assert.deepEqual(resolvedOf(points), [0, 0, 1, 0, 1])
    assert.deepEqual(unresolvedOf(points), [0, 0, 0, 1, 0])
  })

  it('derives open and resolved cycles from legacy snapshots without lifecycle events', () => {
    const points = build({
      dateRange: '30days',
      snapshots: [
        snapshot({ requestId: 'r1', status: 'SentToEngineer', updatedAt: at(3) }),
        snapshot({ requestId: 'r2', status: 'Completed', updatedAt: at(2) }),
        snapshot({ requestId: 'r3', status: 'Cancelled' }),
      ],
    })
    assert.deepEqual(unresolvedOf(points), [0, 0, 0, 0, 1])
    assert.deepEqual(resolvedOf(points), [0, 0, 0, 0, 1])
  })
})

describe('engineering resolution trend wiring', () => {
  it('replaces the Request Volume card with Engineering Resolution Trend', () => {
    const page = read('src/components/analytics/analytics-page.tsx')
    assert.match(page, /Engineering Resolution Trend/)
    assert.match(
      page,
      /Open Engineering backlog at period end versus requests resolved by Engineering during each period\./,
    )
    assert.match(page, /engineering-resolution-trend-chart/)
    assert.match(page, /data\.engineeringResolutionTrend/)
    assert.doesNotMatch(page, /Request Volume/)
    assert.doesNotMatch(page, /request-timeline-chart/)
  })

  it('renders a two-line chart with point markers and the approved legends', () => {
    const chart = read('src/components/analytics/engineering-resolution-trend-chart.tsx')
    assert.match(chart, /LineChart/)
    assert.match(chart, /Engineering unresolved/)
    assert.match(chart, /Resolved by Engineering/)
    const lines = chart.match(/<Line\b/g) ?? []
    assert.equal(lines.length, 2)
    assert.match(chart, /dot=/)
  })

  it('computes the trend from lifecycle activities without a createdAt window filter (carry-in)', () => {
    const action = read('src/server-actions/analytics.ts')
    assert.match(action, /buildEngineeringResolutionTrend/)
    assert.match(action, /fetchEngineeringResolutionTrend\(\s*trendScopeWhere/)
    const trendScope = action.match(/const trendScopeWhere[\s\S]*?\};/)
    assert.ok(trendScope, 'trendScopeWhere must exist')
    assert.doesNotMatch(trendScope[0], /createdAt/, 'trend scoping must not cap history with a createdAt filter')
  })

  it('exposes the trend on AnalyticsData in place of the old timeline', () => {
    const types = read('src/types/analytics.ts')
    assert.match(types, /engineeringResolutionTrend: EngineeringResolutionTrendPoint\[\]/)
    assert.doesNotMatch(types, /timeline: TimelinePoint\[\]/)
  })
})

describe('authoritative lifecycle event sources', () => {
  it('ignores audit actions that only copy toStatus (soft delete, restore, archive)', () => {
    // Soft delete logs action 'deleted' with toStatus copied from whatever
    // status the request had. Those rows are not lifecycle transitions: they
    // must neither create false cycles nor suppress the snapshot fallback.
    const cycles = deriveEngineeringCycles(
      [
        // Deleted while sitting in Completed: copied toStatus 'Completed'
        // must not look like a resolution event, and must not block the
        // legacy fallback for this request.
        { requestId: 'r1', toStatus: 'Completed', at: at(5), action: 'deleted' },
        // Deleted while sitting in SentToEngineer: the copied toStatus must
        // not fabricate an open engineering cycle either.
        { requestId: 'r2', toStatus: 'SentToEngineer', at: at(4), action: 'deleted' },
        { requestId: 'r3', toStatus: 'Cancelled', at: at(3), action: 'restored' },
      ],
      [
        snapshot({ requestId: 'r1', status: 'Completed', updatedAt: at(2) }),
        snapshot({ requestId: 'r2', status: 'Completed', updatedAt: at(2) }),
      ],
    )

    // Both requests fall back to exactly one resolved legacy cycle; the
    // copied toStatus rows create no open cycle for r2.
    assert.deepEqual(
      cycles.map((c) => `${c.requestId}:${c.resolved ? 'resolved' : 'open'}`).sort(),
      ['r1:resolved', 'r2:resolved'],
    )
    assert.ok(cycles.every((cycle) => cycle.closedAt !== null))
  })

  it('accepts status_changed, cancelled, and manually_completed as authoritative', () => {
    const cycles = deriveEngineeringCycles([
      { requestId: 'r1', toStatus: 'SentToEngineer', at: at(10), action: 'status_changed' },
      { requestId: 'r1', toStatus: 'SendBackToRequester', at: at(9), action: 'status_changed' },
      { requestId: 'r2', toStatus: 'SentToEngineer', at: at(8), action: 'status_changed' },
      { requestId: 'r2', toStatus: 'Cancelled', at: at(7), action: 'cancelled' },
      { requestId: 'r3', toStatus: 'SentToEngineer', at: at(6), action: 'status_changed' },
      { requestId: 'r3', toStatus: 'Completed', at: at(5), action: 'manually_completed' },
    ])

    assert.equal(cycles.length, 3)
    assert.equal(cycles[0].requestId === 'r1' && cycles[0].resolved, true)
    assert.equal(cycles[1].requestId === 'r2' && cycles[1].resolved, false)
    assert.equal(cycles[2].requestId === 'r3' && cycles[2].resolved, true)
  })

  it('exports the authoritative action list and filters the analytics activity query by it', () => {
    const lib = read('src/lib/engineering-resolution-trend.ts')
    assert.match(
      lib,
      /export const ENGINEERING_LIFECYCLE_ACTIONS = \['status_changed', 'cancelled', 'manually_completed'\] as const/,
    )

    const action = read('src/server-actions/analytics.ts')
    assert.match(action, /ENGINEERING_LIFECYCLE_ACTIONS/)
    const query = action.match(/request_activities\.findMany\(\{[\s\S]*?\}\)/)
    assert.ok(query, 'trend activity query must exist')
    assert.match(
      query[0],
      /action:\s*\{\s*in:\s*\[\.\.\.ENGINEERING_LIFECYCLE_ACTIONS\]/,
      'the lifecycle activity query must filter by the authoritative actions',
    )
  })
})

describe('final approval rejection rework producer contract', () => {
  it('rejectFinalApproval logs an atomic FinalApproval -> SentToEngineer status_changed activity', () => {
    const source = read('src/server-actions/solutions.ts')

    // Locate the rejectFinalApproval transaction body.
    const fn = source.match(/export async function rejectFinalApproval[\s\S]*?\n\}\n/)
    assert.ok(fn, 'rejectFinalApproval must exist')
    const body = fn[0]

    // The rejection audit stays.
    assert.match(body, /action: 'final_approval_rejected'/)

    // The reopened cycle is visible to analytics via a status_changed
    // activity carrying toStatus SentToEngineer, written with the same
    // transaction client (tx) as the status update itself.
    const statusChanged = body.match(
      /tx\.request_activities\.create\(\{[\s\S]*?action: 'status_changed'\s*[\s\S]*?toStatus: RequestStatus\.SentToEngineer[\s\S]*?\}\)/,
    )
    assert.ok(
      statusChanged,
      'rejectFinalApproval must create a status_changed activity with toStatus SentToEngineer on the transaction client',
    )
    assert.match(
      statusChanged[0],
      /fromStatus: RequestStatus\.FinalApproval/,
      'the reopened cycle must record fromStatus FinalApproval',
    )

    // Both writes stay inside one transaction (tx, not prisma).
    const statusUpdate = body.match(
      /tx\.requests\.update\(\{[\s\S]*?status: RequestStatus\.SentToEngineer[\s\S]*?\}\)/,
    )
    assert.ok(statusUpdate, 'status update must remain on the transaction client')
  })

  it('aggregates a final-approval rejection as a reopened rework cycle', () => {
    // Real producer sequence: engineering resolves, final approval is
    // initiated, then rejected back to engineering (the new status_changed
    // FinalApproval -> SentToEngineer activity).
    const points = build({
      dateRange: '30days',
      events: [
        { requestId: 'r1', toStatus: 'SentToEngineer', at: at(20), action: 'status_changed' },
        { requestId: 'r1', toStatus: 'SendBackToRequester', at: at(18), action: 'status_changed' },
        { requestId: 'r1', toStatus: 'SentToEngineer', at: at(9), action: 'status_changed' },
      ],
    })

    assert.deepEqual(resolvedOf(points), [0, 0, 1, 0, 0])
    // The reopened cycle stays on the backlog through period end.
    assert.deepEqual(unresolvedOf(points), [0, 0, 0, 1, 1])
  })
})

describe('legacy fallback engineering semantics', () => {
  it('treats DesignCostEstimationApproval as an open unresolved legacy cycle', () => {
    // Cost estimation happens after engineering sent the request back, but
    // under the approved resolution contract it has not been resolved by
    // Engineering: without lifecycle events the best conservative model is
    // one open cycle.
    const cycles = deriveEngineeringCycles(
      [],
      [snapshot({ requestId: 'r1', status: 'DesignCostEstimationApproval' })],
    )
    assert.equal(cycles.length, 1)
    assert.equal(cycles[0].closedAt, null)
    assert.equal(cycles[0].resolved, false)
  })

  it('keeps FinalApproval as the post-SendBack resolved fallback', () => {
    const cycles = deriveEngineeringCycles(
      [],
      [snapshot({ requestId: 'r1', status: 'FinalApproval' })],
    )
    assert.equal(cycles.length, 1)
    assert.equal(cycles[0].resolved, true)
    assert.equal(cycles[0].closedAt?.getTime(), at(3).getTime())
  })

  it('counts a DesignCost legacy snapshot in unresolved and never in resolved', () => {
    const points = build({
      dateRange: '30days',
      snapshots: [snapshot({ requestId: 'r1', status: 'DesignCostEstimationApproval' })],
    })
    assert.deepEqual(unresolvedOf(points), [0, 0, 0, 0, 1])
    assert.deepEqual(resolvedOf(points), [0, 0, 0, 0, 0])
  })
})

describe('half-open period boundaries', () => {
  it('assigns a cycle opened exactly on a period boundary to the later period only', () => {
    // 30days weekly bucket ends are exactly NOW-28d, NOW-21d, NOW-14d,
    // NOW-7d, NOW. at(14) sits exactly on the NOW-14d boundary.
    const points = build({
      dateRange: '30days',
      events: events(['r1', 'SentToEngineer', at(14)]),
    })
    // Strictly-less-than period end: the cycle belongs to buckets ending
    // NOW-7d and NOW only - no double count at the shared boundary.
    assert.deepEqual(unresolvedOf(points), [0, 0, 0, 1, 1])
  })

  it('counts a closure exactly on a period boundary as resolved in the later period only', () => {
    const points = build({
      dateRange: '30days',
      events: events(
        ['r1', 'SentToEngineer', at(20)],
        ['r1', 'SendBackToRequester', at(14)],
      ),
    })
    // Closed exactly at the NOW-14d boundary: resolved inside [NOW-14d,
    // NOW-7d), never resolved in the bucket ending NOW-14d...
    assert.deepEqual(resolvedOf(points), [0, 0, 0, 1, 0])
    // ...and not unresolved at the NOW-14d period end either (the cycle
    // closed exactly at that instant, so the later period owns it).
    assert.deepEqual(unresolvedOf(points), [0, 0, 0, 0, 0])
  })

  it('keeps weekly buckets gap-free and non-overlapping for scattered closures', () => {
    // Four closures at interior and exact-boundary positions: each resolves
    // exactly once and the per-bucket sums add up to the total (no overlaps,
    // no gaps).
    const points = build({
      dateRange: '30days',
      events: events(
        ['r1', 'SentToEngineer', at(20)], ['r1', 'SendBackToRequester', at(18)],
        ['r2', 'SentToEngineer', at(15)], ['r2', 'SendBackToRequester', at(14)],
        ['r3', 'SentToEngineer', at(8)], ['r3', 'SendBackToRequester', at(7)],
        ['r4', 'SentToEngineer', at(5)], ['r4', 'SendBackToRequester', at(3)],
      ),
    })
    assert.deepEqual(resolvedOf(points), [0, 0, 1, 1, 2])
    assert.deepEqual(unresolvedOf(points), [0, 0, 0, 0, 0])
  })

  it('covers every daily and monthly bucket with carry-in backlog (no gaps)', () => {
    const daily = build({ dateRange: '7days', events: events(['r1', 'SentToEngineer', at(10)]) })
    assert.equal(daily.length, 7)
    assert.deepEqual(unresolvedOf(daily), [1, 1, 1, 1, 1, 1, 1])

    const monthly = build({ dateRange: 'all', events: events(['r1', 'SentToEngineer', at(130)]) })
    assert.equal(monthly.length, 5)
    assert.deepEqual(unresolvedOf(monthly), [1, 1, 1, 1, 1])
  })
})
