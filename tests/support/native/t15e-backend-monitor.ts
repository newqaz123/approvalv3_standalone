/**
 * T15E independent BACKEND-GONE monitor (Task86) — FIRST bounded slice,
 * INJECTED FAKES ONLY (no native factory, no real DB, no psql, no sockets).
 *
 * Contract (child exit is NEVER backend gone):
 * - Gone is concluded ONLY from a valid FULL-query snapshot on an INDEPENDENT
 *   monitor connection: the EXACT coordinator identity (pid + backendStart +
 *   databaseId) absent => gone; same PID with a DIFFERENT backendStart =>
 *   PID reused => the old backend is gone (precise); anything else => present
 *   or unproven.
 * - pg_stat_clear_snapshot() runs BEFORE every check on the SAME monitor
 *   connection (no stale snapshot reuse across polls).
 * - The monitor backend must be DISTINCT from the coordinator backend
 *   (same pid => rejected). The session's verified cluster identity must
 *   match the expected coordinator cluster; a foreign database/cluster is
 *   UNPROVEN, never gone.
 * - SQL errors, timeouts, connection loss, malformed/duplicate/ambiguous
 *   rows => UNPROVEN (fail closed): a cleanup-time monitor failure can never
 *   report gone.
 * - Fixed SQL only: the pid is validated (positive integer) before being
 *   embedded; no raw browser input; results carry fixed categories/numbers,
 *   never raw SQL errors, payloads, or credentials.
 * - Bounded by the CALLER-ABSOLUTE deadline via an injected clock and
 *   cancellable timers: the remaining budget is never reset per poll, there
 *   are no busy loops, and losing promises keep settlement consumers (late
 *   failures are counted, never unhandled).
 */

import type { T15EArmedTimer, T15EClock, T15ETimerScheduler } from './t15e-overlap-lifecycle'
import { T15E_DEADLINES_MS, T15E_SAFE_ERROR_MESSAGE } from './t15e-overlap-protocol'

/** Fixed prelude run before EVERY identity check (same monitor connection). */
export const T15E_MONITOR_CLEAR_SNAPSHOT_SQL = 'select pg_stat_clear_snapshot();'

/**
 * CANONICAL backend-start representation (Task87): PostgreSQL renders
 * backend_start as UTC text with EXACTLY six fractional (microsecond) digits
 * and a literal Z — timezone-independent, microsecond-preserving, and
 * comparable as an exact string with NO JS Date/number conversion anywhere.
 * Both the coordinator transport SQL and the monitor SQL use the SAME
 * expression; any noncanonical value (equivalent instant in another
 * timezone/offset text, missing microseconds, garbage) is rejected UNPROVEN —
 * it can never be treated as a different backend (GONE).
 */
export const T15E_BACKEND_START_SQL_EXPR =
  "to_char(backend_start at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')"

const CANONICAL_TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/

/** Strict calendar validation of the canonical form (no Date parsing). */
export function isValidT15ECanonicalBackendStart(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = CANONICAL_TS_RE.exec(value)
  if (match === null) return false
  const [, yStr, moStr, dStr, hStr, miStr, sStr] = match
  const year = Number(yStr)
  const month = Number(moStr)
  const day = Number(dStr)
  const hour = Number(hStr)
  const minute = Number(miStr)
  const second = Number(sStr)
  if (month < 1 || month > 12) return false
  if (day < 1) return false
  const daysInMonth = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day > daysInMonth[month - 1]) return false
  if (hour > 23 || minute > 59 || second > 59) return false
  return true
}

/** Real-session factory obligations (dependency contract, NOT wired here):
 *  the runtime implementation is a later slice — no monitor-privileged mint
 *  exists and revoked capabilities grant nothing. */
export const T15E_MONITOR_SESSION_FACTORY_CONTRACT: readonly string[] = [
  'PRE_ESTABLISHED_BEFORE_COORDINATION: the verified monitor connection is established while the runtime capability is still live (producer stop/remove revoke transport capabilities at teardown entry)',
  'SEPARATE_CONNECTION: never the coordinator transport/session; the monitor backend pid must differ from the coordinator pid',
  'SAME_VERIFIED_CLUSTER: the session-observed data_directory / server port / database must equal the coordinator cluster',
  'FIXED_SURFACE_ONLY: the session exposes only the pinned monitor SQL (clear-snapshot prelude + the validated identity query); never arbitrary SQL',
  'NO_NEW_MINT: no monitor-privileged capability mint exists; a revoked capability must not grant new DB access',
]

export interface T15EMonitorBackendIdentity {
  pid: number
  backendStart: string
  databaseId: number
}

export interface T15EMonitorClusterIdentity {
  dataDirectory: string
  serverPort: number
  databaseName: string
}

export interface T15EMonitorSessionInfo {
  monitorBackend: T15EMonitorBackendIdentity
  cluster: T15EMonitorClusterIdentity
}

export interface T15EMonitorQuerySession {
  query(sql: string, deadlineEpochMs: number): Promise<unknown>
}

export type T15EMonitorSessionOutcome =
  | { ok: true; session: T15EMonitorQuerySession; info: T15EMonitorSessionInfo }
  | { ok: false }

export type T15EMonitorSessionFactory = (
  deadlineEpochMs: number,
) => Promise<T15EMonitorSessionOutcome>

export type T15EMonitorFailureCategory =
  | 'T15E_MONITOR_DEADLINE_EXCEEDED'
  | 'T15E_MONITOR_SESSION_UNAVAILABLE'
  | 'T15E_MONITOR_SAME_BACKEND'
  | 'T15E_MONITOR_CLUSTER_MISMATCH'
  | 'T15E_MONITOR_TIMEOUT'
  | 'T15E_MONITOR_QUERY_FAILED'
  | 'T15E_MONITOR_MALFORMED_RESPONSE'
  | 'T15E_MONITOR_DATABASE_MISMATCH'

export type T15EBackendMonitorCheck =
  | { kind: 'GONE'; checks: number }
  | { kind: 'PRESENT'; checks: number }
  | { kind: 'UNPROVEN'; category: T15EMonitorFailureCategory; checks: number }

export interface T15EBackendMonitorDeps {
  clock: T15EClock
  scheduleTimer: T15ETimerScheduler
  createQuerySession: T15EMonitorSessionFactory
  expectedCluster: Readonly<T15EMonitorClusterIdentity>
  pollIntervalMs?: number
}

/** Validated fixed identity query (strict positive-integer pid binding). */
export function buildT15EMonitorIdentityQuery(pid: number): string | null {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null
  return `select pid, ${T15E_BACKEND_START_SQL_EXPR}, datid from pg_stat_activity where pid = ${pid};`
}

type DecodedSnapshot =
  | { kind: 'ABSENT' }
  | { kind: 'PRESENT' }
  | { kind: 'PID_REUSED' }
  | { kind: 'DB_MISMATCH' }
  | { kind: 'MALFORMED' }

function toStrictInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value)
    if (Number.isInteger(parsed)) return parsed
  }
  return null
}

/** Strict bounded decode of the full-query snapshot rows. Duplicate or
 *  ambiguous rows, wrong arity, non-numeric cells, wrong pid, or a foreign
 *  datid fail closed (never gone). */
function decodeSnapshot(
  raw: unknown,
  target: Readonly<T15EMonitorBackendIdentity>,
): DecodedSnapshot {
  if (!Array.isArray(raw)) return { kind: 'MALFORMED' }
  if (raw.length > 1) return { kind: 'MALFORMED' } // duplicate/ambiguous
  if (raw.length === 0) return { kind: 'ABSENT' }
  const row = raw[0]
  if (!Array.isArray(row) || row.length !== 3) return { kind: 'MALFORMED' }
  const pid = toStrictInt(row[0])
  const datid = toStrictInt(row[2])
  const backendStart = row[1]
  if (pid === null || pid !== target.pid) return { kind: 'MALFORMED' }
  if (datid === null || datid !== target.databaseId) return { kind: 'DB_MISMATCH' }
  // Canonical microsecond UTC form ONLY: an equivalent instant in any other
  // textual form (or garbage) is MALFORMED => UNPROVEN, never PID-reuse/GONE.
  if (!isValidT15ECanonicalBackendStart(backendStart)) return { kind: 'MALFORMED' }
  if (backendStart === target.backendStart) return { kind: 'PRESENT' }
  return { kind: 'PID_REUSED' } // same pid, canonical-but-different instant (>= 1us apart)
}

function isValidIdentity(value: Readonly<T15EMonitorBackendIdentity>): boolean {
  return (
    typeof value.pid === 'number' && Number.isInteger(value.pid) && value.pid > 0 &&
    isValidT15ECanonicalBackendStart(value.backendStart) &&
    typeof value.databaseId === 'number' && Number.isInteger(value.databaseId)
  )
}

function sameCluster(
  observed: Readonly<T15EMonitorClusterIdentity>,
  expected: Readonly<T15EMonitorClusterIdentity>,
): boolean {
  return (
    observed.dataDirectory === expected.dataDirectory &&
    observed.serverPort === expected.serverPort &&
    observed.databaseName === expected.databaseName
  )
}

export function createT15EBackendMonitor(
  deps: T15EBackendMonitorDeps,
): { confirmBackendGone(identity: Readonly<T15EMonitorBackendIdentity>, deadlineEpochMs: number): Promise<T15EBackendMonitorCheck> } {
  const { clock, scheduleTimer, createQuerySession, expectedCluster } = deps
  const pollIntervalMs = deps.pollIntervalMs ?? T15E_DEADLINES_MS.pollInterval
  let lateFailures = 0

  /** Bounded await against the REMAINING caller-absolute budget: the armed
   *  timer is always cancelled; the losing promise keeps a settlement
   *  consumer (late failures are counted, never unhandled); the budget is
   *  NEVER reset per poll — it always counts down to the caller deadline. */
  async function awaitBounded<T>(
    deadlineEpochMs: number,
    thunk: () => Promise<T>,
  ): Promise<{ kind: 'value'; value: T } | { kind: 'error' } | { kind: 'timeout' }> {
    const budget = deadlineEpochMs - clock.nowEpochMs()
    if (!(budget > 0)) {
      // Budget exhausted: NO work is performed at all — the thunk is never
      // invoked (a synchronously throwing thunk cannot escape either).
      return { kind: 'timeout' }
    }
    let settled = false
    let observed: Promise<T>
    try {
      observed = thunk()
    } catch {
      return { kind: 'error' } // synchronous failure: unproven, not a timeout
    }
    const timer = scheduleTimer(budget)
    const outcome = await Promise.race([
      observed.then(
        (value) => (settled ? null : { kind: 'value' as const, value }),
        () => (settled ? null : ({ kind: 'error' } as const)),
      ),
      timer.fired.then(() => ({ kind: 'timeout' } as const)),
    ])
    settled = true
    timer.cancel()
    if (outcome === null) return { kind: 'timeout' } // late after settle: consumed
    if (outcome.kind === 'value' && clock.nowEpochMs() >= deadlineEpochMs) {
      // Post-settlement ABSOLUTE-clock recheck: a value arriving at/after the
      // caller deadline (timer-delayed race) can never be accepted as proof.
      return { kind: 'timeout' }
    }
    if (outcome.kind === 'timeout') {
      // Keep a consumer for the still-pending query (late failure counted).
      observed.then(
        () => undefined,
        () => {
          lateFailures += 1
        },
      )
    }
    return outcome
  }

  return {
    async confirmBackendGone(
      identity: Readonly<T15EMonitorBackendIdentity>,
      deadlineEpochMs: number,
    ): Promise<T15EBackendMonitorCheck> {
      if (!isValidIdentity(identity)) {
        return { kind: 'UNPROVEN', category: 'T15E_MONITOR_MALFORMED_RESPONSE', checks: 0 }
      }
      // Defensive immutable copies BEFORE the first await: mid-flight caller
      // mutation of the target identity or the expected cluster can never
      // change this proof. All reads below use these copies only.
      const target: Readonly<T15EMonitorBackendIdentity> = Object.freeze({ ...identity })
      const expected: Readonly<T15EMonitorClusterIdentity> = Object.freeze({ ...expectedCluster })
      const sql = buildT15EMonitorIdentityQuery(target.pid)
      if (sql === null) {
        return { kind: 'UNPROVEN', category: 'T15E_MONITOR_MALFORMED_RESPONSE', checks: 0 }
      }
      let checks = 0
      let session: T15EMonitorQuerySession | null = null
      let lastPresent = false
      while (true) {
        const remaining = deadlineEpochMs - clock.nowEpochMs()
        if (remaining <= 0) {
          // Deadline reached with the target still observed PRESENT in the
          // last valid snapshot: a truthful NOT-gone answer (never unproven
          // when a valid observation exists; never gone without absence).
          if (lastPresent) return { kind: 'PRESENT', checks }
          return { kind: 'UNPROVEN', category: 'T15E_MONITOR_DEADLINE_EXCEEDED', checks }
        }
        if (session === null) {
          const made = await awaitBounded(deadlineEpochMs, () => createQuerySession(deadlineEpochMs))
          if (made.kind === 'timeout') {
            return { kind: 'UNPROVEN', category: 'T15E_MONITOR_TIMEOUT', checks }
          }
          if (made.kind === 'error') {
            return { kind: 'UNPROVEN', category: 'T15E_MONITOR_SESSION_UNAVAILABLE', checks }
          }
          if (!made.value.ok) {
            return { kind: 'UNPROVEN', category: 'T15E_MONITOR_SESSION_UNAVAILABLE', checks }
          }
          const info = made.value.info
          if (!isValidIdentity(info.monitorBackend)) {
            return { kind: 'UNPROVEN', category: 'T15E_MONITOR_MALFORMED_RESPONSE', checks }
          }
          if (info.monitorBackend.pid === target.pid) {
            return { kind: 'UNPROVEN', category: 'T15E_MONITOR_SAME_BACKEND', checks }
          }
          if (!sameCluster(info.cluster, expected)) {
            return { kind: 'UNPROVEN', category: 'T15E_MONITOR_CLUSTER_MISMATCH', checks }
          }
          session = made.value.session
        }
        // One check: clear the stats snapshot FIRST, then the identity query,
        // on the SAME monitor connection (no stale snapshot reuse).
        const cleared = await awaitBounded(deadlineEpochMs, () =>
          session!.query(T15E_MONITOR_CLEAR_SNAPSHOT_SQL, deadlineEpochMs),
        )
        if (cleared.kind === 'timeout') {
          return { kind: 'UNPROVEN', category: 'T15E_MONITOR_TIMEOUT', checks }
        }
        if (cleared.kind === 'error') {
          return { kind: 'UNPROVEN', category: 'T15E_MONITOR_QUERY_FAILED', checks }
        }
        const queried = await awaitBounded(deadlineEpochMs, () => session!.query(sql, deadlineEpochMs))
        if (queried.kind === 'timeout') {
          return { kind: 'UNPROVEN', category: 'T15E_MONITOR_TIMEOUT', checks }
        }
        if (queried.kind === 'error') {
          return { kind: 'UNPROVEN', category: 'T15E_MONITOR_QUERY_FAILED', checks }
        }
        checks += 1
        const decoded = decodeSnapshot(queried.value, target)
        if (decoded.kind === 'ABSENT' || decoded.kind === 'PID_REUSED') {
          // Final ABSOLUTE-clock recheck immediately before GONE: a
          // timer-delayed race can never win past the caller deadline.
          if (clock.nowEpochMs() >= deadlineEpochMs) {
            return { kind: 'UNPROVEN', category: 'T15E_MONITOR_TIMEOUT', checks }
          }
          return { kind: 'GONE', checks }
        }
        if (decoded.kind === 'DB_MISMATCH') {
          return { kind: 'UNPROVEN', category: 'T15E_MONITOR_DATABASE_MISMATCH', checks }
        }
        if (decoded.kind === 'MALFORMED') {
          return { kind: 'UNPROVEN', category: 'T15E_MONITOR_MALFORMED_RESPONSE', checks }
        }
        // PRESENT: record it, pace (bounded by the remaining budget), re-check.
        lastPresent = true
        const pace = scheduleTimer(Math.min(pollIntervalMs, deadlineEpochMs - clock.nowEpochMs()))
        await pace.fired.then(
          () => undefined,
          () => {
            lateFailures += 1
          },
        )
        pace.cancel()
      }
    },
  }
}
