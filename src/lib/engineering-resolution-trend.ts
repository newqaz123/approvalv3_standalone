import { addDays, addMonths, format, startOfDay, startOfMonth } from 'date-fns'
import type {
  DateRangePreset,
  EngineeringResolutionTrendPoint,
} from '@/types/analytics'

/**
 * Engineering resolution trend aggregation.
 *
 * Pure, testable helpers shared by the analytics server action and the
 * regression tests. No Prisma, no React, no server-only imports.
 *
 * Lifecycle state machine (per request, events ordered chronologically):
 * - `SentToEngineer` opens an engineering cycle.
 * - `SendBackToRequester` or `Completed` closes an open cycle and counts it
 *   as resolved. A `Completed` that arrives after a cycle was already closed
 *   by `SendBackToRequester` finds no open cycle and cannot double-count.
 * - `Cancelled` closes an open cycle WITHOUT counting it as resolved.
 * - A later `SentToEngineer` opens a new (rework) cycle.
 *
 * Trend semantics (half-open periods [start, end)):
 * - "Engineering unresolved" at a period end = cycles opened strictly before
 *   that end and not closed at that instant (cycles opened before the
 *   visible window contribute carry-in backlog; a boundary instant belongs
 *   to the later period only).
 * - "Resolved by Engineering" during a period = resolved cycle closures that
 *   fall inside the period.
 */

/**
 * Audit actions that authoritatively record a lifecycle status transition
 * (their `toStatus` is a real transition). Other actions (soft delete,
 * restore, archive) may copy `toStatus` from the current status for audit
 * purposes - those rows must never open or close cycles, nor suppress the
 * legacy fallback.
 */
export const ENGINEERING_LIFECYCLE_ACTIONS = ['status_changed', 'cancelled', 'manually_completed'] as const

export type EngineeringLifecycleAction = (typeof ENGINEERING_LIFECYCLE_ACTIONS)[number]

export const ENGINEERING_LIFECYCLE_STATUSES = [
  'SentToEngineer',
  'SendBackToRequester',
  'Completed',
  'Cancelled',
] as const

export type EngineeringLifecycleStatus = (typeof ENGINEERING_LIFECYCLE_STATUSES)[number]

/** A recorded status-transition event (request_activities history). */
export interface EngineeringTrendEvent {
  requestId: string
  toStatus: string
  at: Date | string
  /** Producing audit action; events from non-authoritative actions are ignored. */
  action?: string
}

/**
 * Current-state fallback input for matching requests that lack usable
 * lifecycle events (legacy rows created before activity logging).
 */
export interface EngineeringTrendRequestSnapshot {
  requestId: string
  status: string
  createdAt: Date | string
  updatedAt: Date | string
}

/** One engineering cycle derived from the lifecycle events. */
export interface EngineeringTrendCycle {
  requestId: string
  openedAt: Date
  closedAt: Date | null
  /** true when closed by SendBackToRequester / Completed (resolved), false when still open or cancelled */
  resolved: boolean
}

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value)

/**
 * Derive engineering cycles from lifecycle status-transition events, with a
 * conservative legacy fallback for requests that have NO usable lifecycle
 * events (rows predating activity logging):
 * - current status `SentToEngineer` or `DesignCostEstimationApproval`
 *   (engineering still owns the request; cost estimation has not resolved
 *   it under the approved contract) -> one open cycle since `updatedAt`
 *   (the best available signal for when it entered engineering).
 * - current status `SendBackToRequester` / `FinalApproval` / `Completed`
 *   (all past engineering) -> one resolved cycle opened and closed at
 *   `updatedAt` (never inflates backlog).
 * - `ImprovementRequest` / `Cancelled` -> nothing: without events we cannot
 *   prove engineering was ever involved.
 *
 * Events are authoritative when present: requests with lifecycle events are
 * never overridden by the fallback, and events produced by non-lifecycle
 * audit actions (soft delete, restore) are ignored so copied `toStatus`
 * values cannot fabricate cycles or suppress the fallback.
 */
export function deriveEngineeringCycles(
  events: ReadonlyArray<EngineeringTrendEvent>,
  snapshots: ReadonlyArray<EngineeringTrendRequestSnapshot> = [],
): EngineeringTrendCycle[] {
  const eventsByRequest = new Map<string, EngineeringTrendEvent[]>()
  for (const event of events) {
    if (!event.requestId) continue
    if (event.action && !isLifecycleAction(event.action)) continue
    const list = eventsByRequest.get(event.requestId) ?? []
    list.push(event)
    eventsByRequest.set(event.requestId, list)
  }

  const cycles: EngineeringTrendCycle[] = []

  for (const [requestId, requestEvents] of eventsByRequest) {
    const ordered = [...requestEvents].sort(
      (a, b) => toDate(a.at).getTime() - toDate(b.at).getTime(),
    )

    let open: { openedAt: Date } | null = null
    for (const event of ordered) {
      if (event.toStatus === 'SentToEngineer') {
        if (!open) {
          open = { openedAt: toDate(event.at) }
        }
        continue
      }

      if (!open) {
        // Closing event with no open cycle (e.g. Completed after a
        // SendBackToRequester closure) - already counted, never double-count.
        continue
      }

      if (event.toStatus === 'SendBackToRequester' || event.toStatus === 'Completed') {
        cycles.push({
          requestId,
          openedAt: open.openedAt,
          closedAt: toDate(event.at),
          resolved: true,
        })
        open = null
        continue
      }

      if (event.toStatus === 'Cancelled') {
        cycles.push({
          requestId,
          openedAt: open.openedAt,
          closedAt: toDate(event.at),
          resolved: false,
        })
        open = null
      }
    }

    if (open) {
      cycles.push({ requestId, openedAt: open.openedAt, closedAt: null, resolved: false })
    }
  }

  for (const snapshot of snapshots) {
    if (!snapshot.requestId || eventsByRequest.has(snapshot.requestId)) continue

    const updatedAt = toDate(snapshot.updatedAt)
    if (
      snapshot.status === 'SentToEngineer' ||
      snapshot.status === 'DesignCostEstimationApproval'
    ) {
      cycles.push({
        requestId: snapshot.requestId,
        openedAt: updatedAt,
        closedAt: null,
        resolved: false,
      })
      continue
    }

    if (
      snapshot.status === 'SendBackToRequester' ||
      snapshot.status === 'FinalApproval' ||
      snapshot.status === 'Completed'
    ) {
      cycles.push({
        requestId: snapshot.requestId,
        openedAt: updatedAt,
        closedAt: updatedAt,
        resolved: true,
      })
    }
  }

  return cycles
}

interface TrendPeriod {
  label: string
  start: Date
  end: Date
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Adaptive periods:
 * - 7days -> 7 daily buckets (calendar days ending today).
 * - 30days / 90days -> weekly buckets (7 days each, newest ends at `now`,
 *   the oldest bucket absorbs the remainder of the window).
 * - all -> calendar-month buckets from the earliest cycle (available
 *   history) through the current month, replacing the old arbitrary 90-day
 *   cap.
 */
function buildTrendPeriods(
  dateRange: DateRangePreset,
  now: Date,
  earliestOpenedAt: Date | null,
): TrendPeriod[] {
  if (dateRange === '7days') {
    const periods: TrendPeriod[] = []
    for (let i = 6; i >= 0; i--) {
      const start = startOfDay(addDays(now, -i))
      periods.push({ label: format(start, 'MMM dd'), start, end: addDays(start, 1) })
    }
    return periods
  }

  if (dateRange === '30days' || dateRange === '90days') {
    const days = dateRange === '30days' ? 30 : 90
    const bucketCount = Math.ceil(days / 7)
    const windowStart = startOfDay(addDays(now, -(days - 1)))

    const periods: TrendPeriod[] = []
    for (let k = bucketCount - 1; k >= 0; k--) {
      const end = k === 0 ? now : new Date(now.getTime() - k * WEEK_MS)
      const start =
        k === bucketCount - 1 ? windowStart : new Date(end.getTime() - WEEK_MS)
      periods.push({ label: format(start, 'MMM dd'), start, end })
    }
    return periods
  }

  // 'all': monthly buckets across available history.
  if (!earliestOpenedAt) {
    return []
  }

  const periods: TrendPeriod[] = []
  const lastMonth = startOfMonth(now)
  let cursor = startOfMonth(earliestOpenedAt)
  while (cursor.getTime() <= lastMonth.getTime()) {
    const end = addMonths(cursor, 1)
    periods.push({ label: format(cursor, 'MMM yyyy'), start: cursor, end })
    cursor = end
  }
  return periods
}

/**
 * Build the Engineering Resolution Trend series from lifecycle events and
 * (optional) legacy request snapshots.
 *
 * Periods are half-open [start, end): a cycle opened exactly on a boundary
 * belongs to the later period only, and a cycle closed exactly on a
 * boundary resolves in the later period only, so shared bucket boundaries
 * never double-count and never drop a cycle.
 */
export function buildEngineeringResolutionTrend(input: {
  events: ReadonlyArray<EngineeringTrendEvent>
  snapshots?: ReadonlyArray<EngineeringTrendRequestSnapshot>
  dateRange: DateRangePreset
  now?: Date
}): EngineeringResolutionTrendPoint[] {
  const now = input.now ?? new Date()
  const cycles = deriveEngineeringCycles(input.events, input.snapshots ?? [])

  const earliestOpenedAt = cycles.reduce<Date | null>(
    (earliest, cycle) => (!earliest || cycle.openedAt.getTime() < earliest.getTime() ? cycle.openedAt : earliest),
    null,
  )

  const periods = buildTrendPeriods(input.dateRange, now, earliestOpenedAt)

  return periods.map(({ label, start, end }) => {
    const startMs = start.getTime()
    const endMs = end.getTime()

    return {
      period: label,
      // Open at the period-end snapshot: opened strictly before the period
      // end (boundary openings belong to the later period) and not yet
      // closed at that instant (a closure exactly at the boundary end is
      // owned by the later period).
      engineeringUnresolved: cycles.filter(
        (cycle) =>
          cycle.openedAt.getTime() < endMs &&
          (cycle.closedAt === null || cycle.closedAt.getTime() > endMs),
      ).length,
      resolvedByEngineering: cycles.filter(
        (cycle) =>
          cycle.resolved &&
          cycle.closedAt !== null &&
          cycle.closedAt.getTime() >= startMs &&
          cycle.closedAt.getTime() < endMs,
      ).length,
    }
  })
}

function isLifecycleAction(action: string): action is EngineeringLifecycleAction {
  return (ENGINEERING_LIFECYCLE_ACTIONS as readonly string[]).includes(action)
}
