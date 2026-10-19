/**
 * T15E snapshot observer (Task97) — ONE bounded snapshot acquisition.
 * Not a poller, not browser overlap acceptance, and not a live SQL claim.
 *
 * Auth obligation: this repo's runner does not bind owned application
 * sessions (no application_name / role mark). Proof is refused unless the
 * future binder supplies an explicit two-backend identity. Rows are never
 * classified from query text, and query text is not selected or retained.
 */

import { T15E_BACKEND_START_SQL_EXPR, isValidT15ECanonicalBackendStart } from './t15e-backend-monitor'
import { awaitBounded, type T15ETimerScheduler } from './t15e-overlap-lifecycle'
import {
  T15E_DEADLINES_MS,
  T15E_SAFE_ERROR_MESSAGE,
  defaultOverlapCheckConfig,
  hex32SqlLiteral,
  verifyOverlapSnapshot,
  type OverlapVerificationOk,
} from './t15e-overlap-protocol'

export const T15E_SNAPSHOT_OBSERVER_OBLIGATIONS = [
  'RUNNER_MUST_BIND_OWNED_APP_SESSIONS: application_name or role minted by the runner, not inferred from query text or payload',
  'NO_LIVE_SQL_EXECUTION_IN_THIS_SLICE',
  'NO_POLLER_OR_BROWSER_OVERLAP_ACCEPTANCE',
  'NO_RUNNER_HTTP_CLEANUP_INTEGRATION',
] as const

export const T15E_ACTIVITY_STATES = [
  'active',
  'idle',
  'idle in transaction',
  'idle in transaction (aborted)',
  'fastpath function call',
  'disabled',
] as const

const MAX_ROWS = T15E_DEADLINES_MS.maxSessions
const MAX_EDGES = 8
const MAX_RESULT_BYTES = T15E_DEADLINES_MS.maxFrameBytes

export type T15EOwnedAppBackend = { readonly pid: number; readonly backendStart: string }
export type T15EOwnedAppBinding = readonly [T15EOwnedAppBackend, T15EOwnedAppBackend]
export type T15ESnapshotCoordinator = { readonly pid: number; readonly backendStart: string; readonly databaseId: number }

export type T15ESnapshotFailureCategory =
  | 'T15E_SNAPSHOT_HOLD_NOT_READY'
  | 'T15E_SNAPSHOT_MONITOR_NOT_LIVE'
  | 'T15E_SNAPSHOT_DEADLINE'
  | 'T15E_SNAPSHOT_APP_BINDING_REQUIRED'
  | 'T15E_SNAPSHOT_UNPROVEN'
  | 'T15E_SNAPSHOT_MALFORMED'
  | 'T15E_SNAPSHOT_TRUNCATED'
  | 'T15E_SNAPSHOT_QUERY_FAILED'

export interface T15ESnapshotHeldProof {
  ready(): { ok: boolean }
}

export interface T15ESnapshotMonitorProof {
  info(): { monitorBackend: { pid: number }; cluster: { dataDirectory: string; serverPort: number; databaseName: string } } | null
  checkAcceptance(deadlineEpochMs: number): string | null
}

export interface T15ESnapshotQuerySession {
  clearSnapshot(deadlineEpochMs: number): Promise<{ ok: true } | { ok: false }>
  readActivity(deadlineEpochMs: number): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false }>
}

function fail(category: T15ESnapshotFailureCategory): { ok: false; category: T15ESnapshotFailureCategory; message: string } {
  return { ok: false, category, message: T15E_SAFE_ERROR_MESSAGE }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function canonicalExpr(column: string): string {
  return T15E_BACKEND_START_SQL_EXPR.replace(/backend_start/g, column)
}

/** Fixed read-only snapshot SQL. No request id, no query text, no caller strings. */
export function buildT15EOverlapSnapshotCommandSql(
  runNonce: string,
  seq: number,
): { ok: true; sql: string } | { ok: false; message: string } {
  const nonceLiteral = hex32SqlLiteral(runNonce)
  if (nonceLiteral === null || !Number.isInteger(seq) || seq < 0) {
    return { ok: false, message: T15E_SAFE_ERROR_MESSAGE }
  }
  const backendStart = canonicalExpr('s.backend_start')
  const xactStart = canonicalExpr('s.xact_start')
  const payload =
    `jsonb_build_object('truncated', (select count(*) > ${MAX_ROWS} from pg_stat_activity), ` +
    `'rows', coalesce((select jsonb_agg(jsonb_build_object(` +
    `'pid', s.pid, 'backendStart', ${backendStart}, 'databaseId', s.datid, ` +
    `'state', s.state, 'waitEventType', s.wait_event_type, ` +
    `'xactStart', case when s.xact_start is null then null else ${xactStart} end, ` +
    `'blockingPids', coalesce((select jsonb_agg(b) from unnest(pg_blocking_pids(s.pid)) as b), '[]'::jsonb)` +
    `)) from (select * from pg_stat_activity order by pid limit ${MAX_ROWS + 1}) s), '[]'::jsonb))`
  const begin = `select format('T15E_B1:%s:${seq}:', ${nonceLiteral});`
  const result = `select (${payload})::text;`
  const end = `select format('T15E_E1:%s:${seq}:%s:', ${nonceLiteral}, length((${payload})::text));`
  return { ok: true, sql: `select pg_stat_clear_snapshot();\n${begin}\n${result}\n${end}\n` }
}

function validBinding(binding: T15EOwnedAppBinding, coordinator: T15ESnapshotCoordinator): boolean {
  const [a, b] = binding
  return (
    a.pid !== b.pid &&
    a.pid !== coordinator.pid &&
    b.pid !== coordinator.pid &&
    isValidT15ECanonicalBackendStart(a.backendStart) &&
    isValidT15ECanonicalBackendStart(b.backendStart)
  )
}

function decodeRow(value: unknown): {
  pid: number
  backendStart: string
  databaseId: number
  state: string
  waitEventType: string | null
  xactStart: string | null
  blockingPids: number[]
} | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.pid !== 'number' || !Number.isInteger(row.pid) || row.pid <= 0) return null
  if (!isValidT15ECanonicalBackendStart(row.backendStart)) return null
  if (typeof row.databaseId !== 'number' || !Number.isInteger(row.databaseId)) return null
  if (typeof row.state !== 'string' || !T15E_ACTIVITY_STATES.includes(row.state as (typeof T15E_ACTIVITY_STATES)[number])) {
    return null
  }
  if (row.waitEventType !== null && typeof row.waitEventType !== 'string') return null
  if (row.xactStart !== null && !isValidT15ECanonicalBackendStart(row.xactStart)) return null
  if (!Array.isArray(row.blockingPids) || row.blockingPids.length > MAX_EDGES) return null
  if (!row.blockingPids.every((pid) => typeof pid === 'number' && Number.isInteger(pid) && pid > 0)) return null
  return {
    pid: row.pid,
    backendStart: row.backendStart,
    databaseId: row.databaseId,
    state: row.state,
    waitEventType: row.waitEventType === null ? null : row.waitEventType,
    xactStart: row.xactStart === null ? null : row.xactStart,
    blockingPids: [...row.blockingPids],
  }
}

export function decodeT15EOverlapActivity(input: {
  result: Record<string, unknown>
  coordinator: T15ESnapshotCoordinator
  monitorIdentity: T15ESnapshotCoordinator
  appBinding: T15EOwnedAppBinding
  capturedAtEpochMs: number
}): { ok: true; snapshot: unknown } | { ok: false; category: T15ESnapshotFailureCategory } {
  const keys = Object.keys(input.result).sort()
  if (keys.length !== 2 || keys[0] !== 'rows' || keys[1] !== 'truncated') return fail('T15E_SNAPSHOT_MALFORMED')
  if (typeof input.result.truncated !== 'boolean') return fail('T15E_SNAPSHOT_MALFORMED')
  if (input.result.truncated) return fail('T15E_SNAPSHOT_TRUNCATED')
  const rows = input.result.rows
  if (!Array.isArray(rows)) return fail('T15E_SNAPSHOT_MALFORMED')
  if (rows.length > MAX_ROWS) return fail('T15E_SNAPSHOT_TRUNCATED')
  const encoded = JSON.stringify(rows)
  if (encoded.length > MAX_RESULT_BYTES) return fail('T15E_SNAPSHOT_TRUNCATED')
  const decoded = rows.map(decodeRow)
  if (decoded.some((row) => row === null)) return fail('T15E_SNAPSHOT_MALFORMED')
  const sessions = decoded as NonNullable<(typeof decoded)[number]>[]
  if (new Set(sessions.map((row) => row.pid)).size !== sessions.length) return fail('T15E_SNAPSHOT_MALFORMED')
  const monitor = input.monitorIdentity
  const allowed = new Set([
    input.coordinator.pid,
    monitor.pid,
    input.appBinding[0].pid,
    input.appBinding[1].pid,
  ])
  if (sessions.some((row) => !allowed.has(row.pid))) return fail('T15E_SNAPSHOT_UNPROVEN')
  if (sessions.length !== 4) return fail('T15E_SNAPSHOT_UNPROVEN')
  const monitorRow = sessions.find((row) => row.pid === monitor.pid)
  if (
    monitorRow === undefined ||
    monitorRow.backendStart !== monitor.backendStart ||
    monitorRow.databaseId !== monitor.databaseId ||
    monitorRow.blockingPids.length > 0 ||
    sessions.some((row) => row.blockingPids.includes(monitor.pid))
  ) {
    return fail('T15E_SNAPSHOT_UNPROVEN')
  }
  const coordinatorRow = sessions.find((row) => row.pid === input.coordinator.pid)
  if (
    coordinatorRow === undefined ||
    coordinatorRow.backendStart !== input.coordinator.backendStart ||
    coordinatorRow.databaseId !== input.coordinator.databaseId
  ) {
    return fail('T15E_SNAPSHOT_UNPROVEN')
  }
  for (const bound of input.appBinding) {
    const row = sessions.find((item) => item.pid === bound.pid)
    if (row === undefined || row.backendStart !== bound.backendStart) return fail('T15E_SNAPSHOT_UNPROVEN')
  }
  return {
    ok: true,
    snapshot: {
      provenance: {
        capturedAtEpochMs: input.capturedAtEpochMs,
        source: 'T15E_MONITOR_ACTIVITY',
        dbIdentifier: String(input.coordinator.databaseId),
      },
      coordinator: {
        pid: input.coordinator.pid,
        backendStart: input.coordinator.backendStart,
        databaseId: input.coordinator.databaseId,
      },
      sessions: sessions.filter((row) => row.pid !== input.monitorIdentity.pid).map((row) => ({
        pid: row.pid,
        backendStart: row.backendStart,
        databaseId: row.databaseId,
        xactStart: row.xactStart,
        blockingPids: row.blockingPids,
        queryCategory: 'UNKNOWN' as const,
      })),
    },
  }
}

export async function captureT15EOverlapSnapshot(input: {
  held: T15ESnapshotHeldProof
  deadlineEpochMs: number
  clock: { nowEpochMs(): number }
  scheduleTimer: T15ETimerScheduler
  monitor: T15ESnapshotMonitorProof
  monitorIdentity: T15ESnapshotCoordinator
  expectedCluster: { dataDirectory: string; databasePort: number; database: string }
  coordinator: T15ESnapshotCoordinator
  appBinding: T15EOwnedAppBinding | null
  query: T15ESnapshotQuerySession
}): Promise<{ ok: true; overlap: OverlapVerificationOk } | { ok: false; category: T15ESnapshotFailureCategory; message: string }> {
  const deadlineEpochMs = input.deadlineEpochMs
  if (typeof deadlineEpochMs !== 'number' || !Number.isFinite(deadlineEpochMs)) {
    return fail('T15E_SNAPSHOT_DEADLINE')
  }
  const coordinator = deepFreeze({ ...input.coordinator })
  const monitorIdentity = deepFreeze({ ...input.monitorIdentity })
  const appBinding = input.appBinding === null
    ? null
    : deepFreeze([{ ...input.appBinding[0] }, { ...input.appBinding[1] }] as T15EOwnedAppBinding)
  const timers: Array<{ cancel(): void }> = []
  const remaining = () => deadlineEpochMs - input.clock.nowEpochMs()
  const bounded = async <T>(thunk: () => Promise<T>) => {
    const budgetMs = remaining()
    if (typeof budgetMs !== 'number' || !Number.isFinite(budgetMs) || !(budgetMs > 0)) {
      return { kind: 'timeout' as const }
    }
    return awaitBounded(
      thunk,
      budgetMs,
      (ms) => {
        const timer = input.scheduleTimer(ms)
        timers.push(timer)
        return timer
      },
      () => undefined,
    )
  }
  const monitorLive = (): boolean => {
    const info = input.monitor.info()
    if (info === null || input.monitor.checkAcceptance(deadlineEpochMs) !== null) return false
    if (
      info.monitorBackend.pid !== monitorIdentity.pid ||
      info.monitorBackend.pid === coordinator.pid ||
      monitorIdentity.pid === coordinator.pid
    ) return false
    return (
      info.cluster.dataDirectory === input.expectedCluster.dataDirectory &&
      info.cluster.serverPort === input.expectedCluster.databasePort &&
      info.cluster.databaseName === input.expectedCluster.database
    )
  }
  const holdLive = (): boolean => input.held.ready().ok === true
  try {
    if (!holdLive()) return fail('T15E_SNAPSHOT_HOLD_NOT_READY')
    if (!monitorLive()) return fail('T15E_SNAPSHOT_MONITOR_NOT_LIVE')
    if (!(remaining() > 0)) return fail('T15E_SNAPSHOT_DEADLINE')
    if (appBinding === null || !validBinding(appBinding, coordinator)) return fail('T15E_SNAPSHOT_APP_BINDING_REQUIRED')
    const cleared = await bounded(() => input.query.clearSnapshot(deadlineEpochMs))
    if (!holdLive() || !monitorLive()) return fail('T15E_SNAPSHOT_HOLD_NOT_READY')
    if (!(remaining() > 0)) return fail('T15E_SNAPSHOT_DEADLINE')
    if (cleared.kind === 'timeout') return fail('T15E_SNAPSHOT_UNPROVEN')
    if (cleared.kind === 'error' || !cleared.value.ok) return fail('T15E_SNAPSHOT_QUERY_FAILED')
    const read = await bounded(() => input.query.readActivity(deadlineEpochMs))
    if (!holdLive() || !monitorLive()) return fail('T15E_SNAPSHOT_HOLD_NOT_READY')
    if (!(remaining() > 0)) return fail('T15E_SNAPSHOT_DEADLINE')
    if (read.kind === 'timeout') return fail('T15E_SNAPSHOT_UNPROVEN')
    if (read.kind === 'error' || !read.value.ok) return fail('T15E_SNAPSHOT_QUERY_FAILED')
    const decoded = decodeT15EOverlapActivity({
      result: read.value.result,
      coordinator,
      monitorIdentity,
      appBinding,
      capturedAtEpochMs: input.clock.nowEpochMs(),
    })
    if (!decoded.ok) return fail(decoded.category)
    if (!holdLive() || !monitorLive() || !(remaining() > 0)) return fail('T15E_SNAPSHOT_HOLD_NOT_READY')
    const verified = verifyOverlapSnapshot(
      decoded.snapshot,
      defaultOverlapCheckConfig(input.clock.nowEpochMs()),
    )
    if (!holdLive() || !monitorLive() || !(remaining() > 0)) return fail('T15E_SNAPSHOT_HOLD_NOT_READY')
    if (!verified.ok) return fail('T15E_SNAPSHOT_UNPROVEN')
    return { ok: true, overlap: { ok: true, topology: verified.topology, appBackendPids: verified.appBackendPids, coordinatorPid: verified.coordinatorPid } }
  } finally {
    for (const timer of timers) timer.cancel()
  }
}
