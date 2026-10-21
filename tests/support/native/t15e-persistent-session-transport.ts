/**
 * T15E persistent psql session TRANSPORT + child ownership/disposal (Task75)
 * — a bounded FIRST SLICE of the session adapter, per the Astra verdict
 * READY_FOR_BOUNDED_T15E_SESSION_ADAPTER_IMPLEMENTATION.
 *
 * What this module IS:
 * - Config validation for the OWNED NativePostgres runtime only: the exact
 *   runner-resolved PG_BIN psql executable, loopback 127.0.0.1, a port that
 *   is NEVER a shared/default port (FORBIDDEN_SHARED_PORTS 3100/5432), the
 *   REQUIRED_DATABASE_NAME, and a run-generated password delivered via env
 *   ONLY (never argv, never logged, shell:false). The module reads NO
 *   ambient environment and NO .env: config is passed explicitly.
 * - ONE persistent psql child per session (`-X -q -A -t -v
 *   ON_ERROR_STOP=1`), SQL delivered to stdin as a UTF-8 Buffer, stdout
 *   consumed as RAW Buffers (never setEncoding'd), framed JSON parsed with
 *   the APPROVED bounded parser (t15e-overlap-protocol) keyed to the session
 *   run nonce with strictly sequential per-command seq numbers.
 * - STRICTLY SEQUENTIAL command ownership: exactly one command in flight; a
 *   second command while one is pending is REJECTED (no overlap). Stray
 *   stdout (unexpected output, string chunks, protocol errors) fails the
 *   command and voids the session. stderr payload is DISCARDED (never
 *   retained or logged) but its bytes count toward the bounded TOTAL buffer.
 * - NO arbitrary SQL surface: commands are a closed T15ETrustedCommand union;
 *   UUIDs are pre-validated then bound with the approved safe psql literal
 *   helpers. Browser/external input can never reach this module's SQL.
 * - Child OWNERSHIP tracked by the EXACT child handle reference (never a
 *   bare PID): timeouts and disposal signal only that handle, with bounded
 *   TERM -> KILL escalation via the INJECTED clock/timers (no real timers).
 *   close/dispose are idempotent; after dispose no new child/command may be
 *   created (fence). Late command settlements are consumed (no unhandled
 *   rejections); every transport-attached listener is removed on disposal.
 *
 * What this module is NOT (deferred, see T15E_SESSION_ADAPTER_OBLIGATIONS_PENDING):
 * - The FULL T15ESessionAdapter (t15e-overlap-lifecycle) implementation.
 * - Real SQL for ARM/LOCK/RELEASE lock-table semantics (barrier execution),
 *   the snapshot source, HTTP-case wiring, and the INDEPENDENT backend-gone
 *   monitor. CHILD EXIT IS NOT BACKEND GONE: every dispose outcome carries
 *   backendGoneConfirmed:false and an explicit pending obligation — this
 *   module NEVER claims the lifecycle disposal fence proves backend gone.
 *
 * The native spawn factory code exists for the later runner slice, but THIS
 * task's tests never invoke it (injected fakes only).
 */

import { Buffer } from 'node:buffer'
import path from 'node:path'
import { spawn as nodeSpawn } from 'node:child_process'
import {
  T15E_DEADLINES_MS,
  T15E_SAFE_ERROR_MESSAGE,
  createFramedResultParser,
  isValidCanonicalUuid,
  validateRunNonce,
  uuidSqlLiteral,
  hex32SqlLiteral,
  type FramedResult,
} from './t15e-overlap-protocol'
import {
  FORBIDDEN_SHARED_PORTS,
  isValidPort,
  PG_BIN,
  REQUIRED_DATABASE_NAME,
} from './native-environment'
import type { T15EArmedTimer, T15EClock, T15ETimerScheduler } from './t15e-overlap-lifecycle'
import type { T15EOwnedClusterIdentity, T15EOwnedRuntimeCapability } from './t15e-capability-types'
import {
  isProducerMintedT15ECapability,
  isT15ECapabilityLive,
  subscribeToT15ERevocation,
} from './postgres-instance'
import { isValidT15ECanonicalBackendStart, T15E_BACKEND_START_SQL_EXPR } from './t15e-backend-monitor'
import { buildCoordinatorFixedCommandSql } from './t15e-coordinator-commands'
import { buildT15EOverlapSnapshotCommandSql } from './t15e-snapshot-observer'

export type { T15EOwnedClusterIdentity, T15EOwnedRuntimeCapability } from './t15e-capability-types'

// ---------------------------------------------------------------------------
// Config: owned runtime only
// ---------------------------------------------------------------------------

/** Fixed quiet argv for the persistent session child (SQL arrives on stdin). */
export const T15E_PSQL_ARGS = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'] as const

// ---------------------------------------------------------------------------
// Owned-runtime capability: PRODUCER provenance (Task81, Astra P1-5)
// ---------------------------------------------------------------------------
// A T15E transport config may ONLY be derived from a capability minted by the
// RUNTIME PRODUCER (postgres-instance.mintT15EOwnedRuntimeCapability), which
// consults its PRIVATE exact-handle allocation WeakMap written only on
// createOwnedRuntime()'s successful allocation path. There is deliberately NO
// public registration here: plain OwnedRuntime-shaped objects, clones, and
// foreign handles can never mint. Identity authority is the producer's
// PRIVATE minted-capability WeakSet consulted through the READ-ONLY
// validator isProducerMintedT15ECapability (no symbol, token, or
// registration a caller could copy, inherit, or transfer). It proves only
// HANDLE origin — proof that the CONNECTED cluster is the owned one stays the
// fixed-SQL cluster-identity comparison at the connect() boundary.

/** Derive a transport config ONLY from a producer-minted, branded capability. */
export function createT15EPersistentPsqlConfigFromCapability(
  capability: T15EOwnedRuntimeCapability,
  input: { runNonce: string },
): { ok: true; config: T15EPersistentPsqlConfig } | { ok: false; reason: T15EPersistentPsqlConfigFailure; message: string } {
  if (!isProducerMintedT15ECapability(capability)) {
    return { ok: false, reason: 'CAPABILITY_FORGED', message: T15E_SAFE_ERROR_MESSAGE }
  }
  const config: T15EPersistentPsqlConfig = {
    capability,
    psqlExecutable: RUNNER_PSQL_EXECUTABLE,
    host: '127.0.0.1',
    port: capability.cluster.databasePort,
    database: capability.cluster.database,
    password: capability.databasePassword,
    runNonce: input.runNonce,
  }
  const verdict = validatePersistentPsqlTransportConfig(config)
  if (!verdict.ok) return { ok: false, reason: verdict.reason, message: verdict.message }
  return { ok: true, config }
}

export interface T15EPersistentPsqlConfig {
  /** Producer-minted owned-runtime capability (postgres-instance mint);
   *  the transport refuses configs whose fields disagree with it. */
  capability: T15EOwnedRuntimeCapability
  /** MUST equal path.join(PG_BIN, 'psql') — the runner-resolved executable. */
  psqlExecutable: string
  /** Only the owned loopback literal is accepted. */
  host: string
  /** Owned database port; never a shared/default port. */
  port: number
  /** MUST equal REQUIRED_DATABASE_NAME. */
  database: string
  /** Run-generated SCRAM password (env only, never argv). */
  password: string
  /** Session run nonce (hex32); frames are bound to it. */
  runNonce: string
}

export type T15EPersistentPsqlConfigFailure =
  | 'CAPABILITY_FORGED'
  | 'CAPABILITY_NOT_BOUND'
  | 'EXECUTABLE_NOT_RUNNER_RESOLVED'
  | 'HOST_NOT_OWNED_LOOPBACK'
  | 'PORT_SHARED_OR_DEFAULT'
  | 'PORT_INVALID'
  | 'DATABASE_NOT_OWNED'
  | 'PASSWORD_NOT_RUN_GENERATED'
  | 'NONCE_INVALID'
  | 'FIELD_TYPE_INVALID'

export type T15EPersistentPsqlConfigVerdict =
  | { ok: true }
  | { ok: false; reason: T15EPersistentPsqlConfigFailure; message: string }

const RUN_GENERATED_PASSWORD_RE = /^[A-Za-z0-9_-]{24,}$/
const RUNNER_PSQL_EXECUTABLE = path.join(PG_BIN, 'psql')

export function validatePersistentPsqlTransportConfig(
  config: T15EPersistentPsqlConfig,
): T15EPersistentPsqlConfigVerdict {
  const fail = (reason: T15EPersistentPsqlConfigFailure) => ({ ok: false, reason, message: T15E_SAFE_ERROR_MESSAGE })
  // Capability provenance FIRST: a forged (non-minted) or invalidated
  // capability is rejected before any field is even looked at.
  // Producer-identity check: ONLY objects minted by the runtime producer
  // (from its private exact-handle allocation record) are in its registry.
  if (!isProducerMintedT15ECapability(config.capability)) {
    return fail('CAPABILITY_FORGED')
  }
  if (typeof config.psqlExecutable !== 'string' || config.psqlExecutable !== RUNNER_PSQL_EXECUTABLE) {
    return fail('EXECUTABLE_NOT_RUNNER_RESOLVED')
  }
  if (config.host !== '127.0.0.1') return fail('HOST_NOT_OWNED_LOOPBACK')
  if (typeof config.port !== 'number') return fail('FIELD_TYPE_INVALID')
  if (!isValidPort(config.port)) return fail('PORT_INVALID')
  // Never the shared app port or the default postgres port.
  if (FORBIDDEN_SHARED_PORTS.has(config.port)) return fail('PORT_SHARED_OR_DEFAULT')
  if (config.database !== REQUIRED_DATABASE_NAME) return fail('DATABASE_NOT_OWNED')
  if (typeof config.password !== 'string' || !RUN_GENERATED_PASSWORD_RE.test(config.password)) {
    return fail('PASSWORD_NOT_RUN_GENERATED')
  }
  if (!validateRunNonce(config.runNonce)) return fail('NONCE_INVALID')
  // Binding LAST: the config fields must still match the frozen capability —
  // a caller cannot swap port/database after the capability was minted.
  if (
    config.capability.cluster.databasePort !== config.port ||
    config.capability.cluster.database !== config.database ||
    config.capability.databasePassword !== config.password
  ) {
    return fail('CAPABILITY_NOT_BOUND')
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Injectable child abstraction (fakes in tests; native factory below)
// ---------------------------------------------------------------------------

export interface T15EPsqlStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown
  removeListener(event: 'data', listener: (chunk: Buffer | string) => void): unknown
}

export interface T15EPsqlStdin {
  /** Node Writable contract: may return false under backpressure (NOT an
   *  error); the optional callback is the write-completion signal. */
  write(buffer: Buffer, callback?: (error: Error | null) => void): boolean
  end(): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: () => void): unknown
  removeListener(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: 'close', listener: () => void): unknown
}

export interface T15EPsqlChild {
  stdin: T15EPsqlStdin | null
  stdout: T15EPsqlStream | null
  stderr: T15EPsqlStream | null
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown
  removeListener(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown
  /** Signals the EXACT child handle this object represents. */
  kill(signal?: 'SIGTERM' | 'SIGKILL'): boolean
}

export type T15EPsqlSpawnFn = (
  executable: string,
  args: readonly string[],
  options: Readonly<{ env: Record<string, string>; shell: false }>,
) => T15EPsqlChild

/**
 * Native spawn factory for the LATER runner slice. Code-only in this task:
 * never invoked by the t15e tests (injected fakes only) and never invoked at
 * import time. Credentials ride in env; argv carries no secrets; shell is
 * literally false.
 */
export function createNativePsqlSpawnFactory(): T15EPsqlSpawnFn {
  return (executable, args, options) =>
    nodeSpawn(executable, [...args], {
      env: options.env as NodeJS.ProcessEnv,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as unknown as T15EPsqlChild
}

// ---------------------------------------------------------------------------
// Trusted command surface (closed union; no arbitrary SQL)
// ---------------------------------------------------------------------------

export type T15ETrustedCommand =
  | { kind: 'SELECT_BACKEND_IDENTITY' }
  | { kind: 'ARM'; requestId: string }
  | { kind: 'LOCK_ACQUIRE'; requestId: string }
  | { kind: 'RELEASE'; requestId: string; outcome: 'COMPLETED' | 'VOIDED' }
  /** Task89 monitor-session surface (fixed): clear the stats snapshot. */
  | { kind: 'CLEAR_STATS_SNAPSHOT' }
  /** Task89 monitor-session surface (fixed): one-row activity lookup for a
   *  STRICTLY validated pid — emits {"found":false} or the full identity. */
  | { kind: 'SELECT_ACTIVITY_FOR_PID'; pid: number }
  /** Task93 coordinator slice: transaction control and the row lock. */
  | { kind: 'COORDINATOR_BEGIN' }
  | { kind: 'COORDINATOR_ROLLBACK' }
  | { kind: 'COORDINATOR_ARM_STAGE'; requestId: string }
  | { kind: 'COORDINATOR_LOCK_NO_KEY_UPDATE'; requestId: string }
  /** Task97: one bounded activity snapshot. No query text. */
  | { kind: 'SELECT_OVERLAP_SNAPSHOT' }

const COMMAND_KINDS: ReadonlySet<string> = new Set([
  'SELECT_BACKEND_IDENTITY',
  'ARM',
  'LOCK_ACQUIRE',
  'RELEASE',
  'CLEAR_STATS_SNAPSHOT',
  'SELECT_ACTIVITY_FOR_PID',
  'COORDINATOR_BEGIN',
  'COORDINATOR_ROLLBACK',
  'COORDINATOR_ARM_STAGE',
  'COORDINATOR_LOCK_NO_KEY_UPDATE',
  'SELECT_OVERLAP_SNAPSHOT',
])

function sqlStringLiteral(value: string): string {
  // Fixed trusted literals only (validated nonce/uuid/enum) — every quote escaped.
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Build the psql SQL for ONE trusted command. The SQL emits the T15E_B1 /
 * result-line / T15E_E1 frame on stdout using the session nonce and the
 * command's seq number, so the approved parser can verify the round trip.
 * Only pre-validated UUIDs/nonces are embedded via the approved safe literal
 * helpers; the lock-table barrier SQL itself is the DEFERRED barrier slice —
 * here each payload is a fixed template of validated constants.
 */
export function buildTrustedPsqlCommand(
  command: T15ETrustedCommand,
  runNonce: string,
  seq = 0,
): { ok: true; sql: string } | { ok: false; message: string } {
  if (typeof command !== 'object' || command === null || !COMMAND_KINDS.has(command.kind)) {
    return { ok: false, message: T15E_SAFE_ERROR_MESSAGE }
  }
  if (!validateRunNonce(runNonce)) return { ok: false, message: T15E_SAFE_ERROR_MESSAGE }
  const nonceLiteral = hex32SqlLiteral(runNonce)
  if (nonceLiteral === null) return { ok: false, message: T15E_SAFE_ERROR_MESSAGE }
  let payloadExpr: string
  if (command.kind === 'SELECT_BACKEND_IDENTITY') {
    // backend_start comes from pg_stat_activity for THIS backend pid
    // (pg_postmaster_start_time is the server start, not the connection's
    // backend start — it cannot match coordinator rows nor distinguish
    // reused backend PIDs). The payload ALSO carries the CLUSTER identity
    // actually observed by the connection (data_directory / server port /
    // current database) which connect() compares against the owned-runtime
    // capability BEFORE any arbitrary command or valid session: the backend
    // pid/start/db identity stays SEPARATE from the cluster identity.
    payloadExpr =
      "jsonb_build_object('kind', 'SELECT_BACKEND_IDENTITY', 'pid', pg_backend_pid(), " +
      "'backendStart', (select " + T15E_BACKEND_START_SQL_EXPR + " from pg_stat_activity where pid = pg_backend_pid()), " +
      "'databaseId', (select oid from pg_database where datname = current_database()), " +
      "'dataDirectory', current_setting('data_directory'), " +
      "'serverPort', current_setting('port')::int, " +
      "'databaseName', current_database())"
  } else if (command.kind === 'CLEAR_STATS_SNAPSHOT') {
    payloadExpr = "jsonb_build_object('cleared', (pg_stat_clear_snapshot() is null))"
  } else if (command.kind === 'SELECT_ACTIVITY_FOR_PID') {
    if (typeof command.pid !== 'number' || !Number.isInteger(command.pid) || command.pid <= 0) {
      return { ok: false, message: T15E_SAFE_ERROR_MESSAGE }
    }
    const aliasedExpr = T15E_BACKEND_START_SQL_EXPR.replace(/backend_start/g, 's.backend_start')
    payloadExpr =
      "coalesce((select jsonb_build_object('found', true, 'pid', s.pid, 'backendStart', " +
      aliasedExpr +
      ", 'databaseId', s.datid) from pg_stat_activity s where s.pid = " + String(command.pid) + "), " +
      "jsonb_build_object('found', false))"
  } else if (
    command.kind === 'COORDINATOR_BEGIN' ||
    command.kind === 'COORDINATOR_ROLLBACK' ||
    command.kind === 'COORDINATOR_ARM_STAGE' ||
    command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE'
  ) {
    return buildCoordinatorFixedCommandSql(command, runNonce, seq)
  } else if (command.kind === 'SELECT_OVERLAP_SNAPSHOT') {
    return buildT15EOverlapSnapshotCommandSql(runNonce, seq)
  } else {
    const uuidLiteral = uuidSqlLiteral(command.requestId)
    if (uuidLiteral === null) return { ok: false, message: T15E_SAFE_ERROR_MESSAGE }
    if (command.kind === 'RELEASE' && command.outcome !== 'COMPLETED' && command.outcome !== 'VOIDED') {
      return { ok: false, message: T15E_SAFE_ERROR_MESSAGE }
    }
    const extra =
      command.kind === 'RELEASE' ? `,'outcome', ${sqlStringLiteral(command.outcome)}` : ''
    payloadExpr = `jsonb_build_object('kind', ${sqlStringLiteral(command.kind)}, 'runNonce', ${nonceLiteral}, 'requestId', ${uuidLiteral}${extra})`
  }
  const begin = `select format('T15E_B1:%s:${seq}:', ${nonceLiteral});`
  const result = `select (${payloadExpr})::text;`
  const end = `select format('T15E_E1:%s:${seq}:%s:', ${nonceLiteral}, length((${payloadExpr})::text));`
  return { ok: true, sql: `${begin}\n${result}\n${end}\n` }
}

// ---------------------------------------------------------------------------
// Results / failure vocabulary (fixed categories, safe messages)
// ---------------------------------------------------------------------------

export type T15ETransportFailureCategory =
  | 'T15E_CONFIG_INVALID'
  | 'T15E_INVALID_COMMAND'
  | 'T15E_TRANSPORT_DISPOSED'
  | 'T15E_SESSION_UNUSABLE'
  | 'T15E_COMMAND_IN_FLIGHT'
  | 'T15E_SPAWN_ERROR'
  | 'T15E_COMMAND_TIMEOUT'
  | 'T15E_WRITE_FAILED'
  | 'T15E_OUTPUT_OVER_LIMIT'
  | 'T15E_FRAME_PROTOCOL_ERROR'
  | 'T15E_STRING_TRANSPORT_REJECTED'
  | 'T15E_CHILD_EXITED_BEFORE_FRAME'
  | 'T15E_IDENTITY_FRAME_INVALID'
  | 'T15E_CLUSTER_IDENTITY_MISMATCH'
  | 'T15E_CLUSTER_IDENTITY_UNVERIFIED'
  | 'T15E_CAPABILITY_REVOKED'

/** Fixed disposal cleanup categories (Task76 P1-4): signal/finalizer
 *  failures during disposal — retained on the structured outcome, never
 *  swallowed and never replaced by a dynamic message. */
export type T15ETransportCleanupCategory =
  | 'CLEANUP_SIGNAL_ERROR'
  | 'CLEANUP_STDIN_END_FAILED'
  | 'CLEANUP_LISTENER_REMOVAL_FAILED'

export type T15ECommandResult =
  | { ok: true; frame: FramedResult }
  | { ok: false; category: T15ETransportFailureCategory; message: string }

export type T15EConnectResult =
  | { ok: true; identity: { pid: number; backendStart: string; databaseId: number } }
  | { ok: false; category: T15ETransportFailureCategory; message: string }

/**
 * Disposal outcome. `ok` certifies ONLY the CHILD HANDLE side of the fence
 * (child exited, or no child ever existed) — child exit is NOT backend gone:
 * backendGoneConfirmed is ALWAYS false here and the pending obligation names
 * the independent monitor that the (deferred) full adapter must consult.
 */
/** Disposal snapshot contract (Task79): terminalCleanup reports the writable
 *  close / close-time finalizer state; ok is false while it is pending. */
export type T15ETerminalCleanupStatus = 'pending' | 'complete' | 'failed'

export interface T15EChildDisposalOutcome {
  ok: boolean
  childExited: boolean
  /** Cleanup failures retained from guarded TERM/KILL/finalizer operations
   *  (frozen copy: snapshots are stable under serialization/copying). */
  cleanupFailures: readonly T15ETransportCleanupCategory[]
  terminalCleanup: T15ETerminalCleanupStatus
  backendGoneConfirmed: false
  pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION'
}

/** Adapter work explicitly NOT done by this transport slice. */
export const T15E_SESSION_ADAPTER_OBLIGATIONS_PENDING: readonly string[] = [
  'INDEPENDENT_BACKEND_GONE_MONITOR',
  'SNAPSHOT_SOURCE_WIRING',
  'BARRIER_EXECUTION_SQL',
  'HTTP_CASE_INTEGRATION',
  'FULL_T15E_SESSION_ADAPTER_IMPLEMENTATION',
]

export type T15ETransportState = 'IDLE' | 'READY' | 'UNUSABLE' | 'CLOSING' | 'DISPOSED'

export interface T15EPersistentPsqlTransport {
  /** Spawn (once) + fetch the owned backend identity via a framed command. */
  connect(deadlineEpochMs: number): Promise<T15EConnectResult>
  /** Send ONE trusted command on the persistent child; strictly sequential. */
  executeTrustedCommand(
    command: T15ETrustedCommand,
    deadlineEpochMs: number,
  ): Promise<T15ECommandResult>
  /** Task89: FROZEN read-only cluster identity VERIFIED at connect (derived
   *  from the capability comparison, never caller assertion); NO credentials. */
  verifiedCluster(): Readonly<{ dataDirectory: string; serverPort: number; databaseName: string }> | null
  /** Graceful: end stdin, bounded wait for exit. No signals. Idempotent. */
  close(deadlineEpochMs: number): Promise<boolean>
  /** Fenced terminal disposal: bounded TERM -> KILL on the EXACT handle. */
  dispose(deadlineEpochMs: number): Promise<T15EChildDisposalOutcome>
  state(): T15ETransportState
}

export interface T15EPersistentPsqlTransportDeps {
  spawnPsql: T15EPsqlSpawnFn
  clock: T15EClock
  scheduleTimer: T15ETimerScheduler
}

export type T15EPersistentPsqlTransportCreate =
  | { ok: true; transport: T15EPersistentPsqlTransport }
  | { ok: false; reason: T15EPersistentPsqlConfigFailure; message: string }

export function createT15EPersistentPsqlTransport(
  config: T15EPersistentPsqlConfig,
  deps: T15EPersistentPsqlTransportDeps,
): T15EPersistentPsqlTransportCreate {
  const verdict = validatePersistentPsqlTransportConfig(config)
  if (!verdict.ok) return { ok: false, reason: verdict.reason, message: verdict.message }

  const { spawnPsql, clock, scheduleTimer } = deps
  const maxTotalBytes = T15E_DEADLINES_MS.maxTotalBytes
  // DEFENSIVE immutable bound config: callers cannot mutate port/password or
  // any other field after construction and affect the spawn (Task83).
  const boundConfig: Readonly<T15EPersistentPsqlConfig> = Object.freeze({
    ...config,
    capability: config.capability,
  })
  // ACTIVE revocation (Task83): subscribe to the capability's allocation
  // revocation; a revoked capability latches a fixed failure and voids/wakes
  // the session promptly. Cleanup of the OWNED handle stays available.
  let capabilityRevoked = false
  const onCapabilityRevoked = (): void => {
    capabilityRevoked = true
    voidSession('T15E_CAPABILITY_REVOKED')
  }
  const revocationSubscription = subscribeToT15ERevocation(boundConfig.capability, onCapabilityRevoked)
  if (revocationSubscription === null) {
    capabilityRevoked = true // already revoked or not minted: fail closed
  }
  const capabilityLive = (): boolean =>
    !capabilityRevoked && isT15ECapabilityLive(boundConfig.capability)

  let state: T15ETransportState = 'IDLE'
  let clusterVerified = false
  let verifiedClusterSnapshot: Readonly<{ dataDirectory: string; serverPort: number; databaseName: string }> | null = null
  /** Task80 P1-1: whether a child process was EVER created — INDEPENDENT of
   *  whether a writable stdin existed (a stdin-less child still needs a
   *  proven exit; the writable reference only feeds terminal-cleanup status). */
  let childEverCreated = false
  /** Task80 P1-2: one-time disposal finalizer phase — ok:true requires
   *  COMPLETED finalizers, not merely a started disposal. */
  let disposalPhase: 'not-started' | 'in-flight' | 'completed' = 'not-started'
  let child: T15EPsqlChild | null = null
  let childExited = false
  let spawnAttempted = false
  let commandInFlight = false
  let nextSeq = 0
  let totalStreamBytes = 0
  let parser: ReturnType<typeof createFramedResultParser> | null = null
  let lateFrames = 0
  let settledOutcome: T15ECommandResult | null = null
  // Event-driven wakeups (NO polling, NO real timers): exit waiters are
  // resolved by the child 'exit' listener; the voided signal by voidSession.
  const exitWaiters: Array<() => void> = []
  let currentVoidResolve: (() => void) | null = null

  // Transport-attached listeners (removed at settlement/disposal).
  const onStdoutData = (chunk: Buffer | string): void => {
    if (typeof chunk === 'string') {
      voidSession('T15E_STRING_TRANSPORT_REJECTED')
      return
    }
    const bytes = chunk
    totalStreamBytes += bytes.length
    if (totalStreamBytes > maxTotalBytes) {
      voidSession('T15E_OUTPUT_OVER_LIMIT')
      return
    }
    if (parser === null) return // session already voided; bytes only counted
    const events = parser.push(bytes)
    for (const event of events) {
      if ('seq' in event) {
        onFrame(event as FramedResult)
      } else {
        const code = (event as { code: string }).code
        voidSession(code === 'T15E_STRING_TRANSPORT_REJECTED' ? code : 'T15E_FRAME_PROTOCOL_ERROR')
      }
    }
  }
  const onStderrData = (_chunk: Buffer | string): void => {
    // Payload DISCARDED (never stored/logged); bytes still count toward the
    // bounded TOTAL buffer.
    totalStreamBytes += typeof _chunk === 'string' ? Buffer.byteLength(_chunk, 'utf8') : _chunk.length
    if (totalStreamBytes > maxTotalBytes) voidSession('T15E_OUTPUT_OVER_LIMIT')
  }
  const onChildError = (): void => {
    voidSession('T15E_SPAWN_ERROR')
  }
  // Async writable errors (e.g. EPIPE after the child exits) arrive on the
  // stdin STREAM, not the child 'error' event — latched, never unhandled.
  const onStdinError = (): void => {
    voidSession('T15E_WRITE_FAILED')
  }
  // Task78: MINIMAL TERMINAL sink, SEPARATE from command listeners. It is
  // retained through (even failed) disposal until the writable ACTUALLY
  // closes — child exit does NOT mean the writable closed — so a late
  // stream error is always consumed (never an EventEmitter throw) and can
  // never resurrect a command or a success. Pure consumption: no latching.
  let terminalStdinErrors = 0
  let stdinCloseHandled = false
  /** Writable closure observed (Task79): snapshots read this, never mutate. */
  let stdinClosed = false
  const closeFinalizerFailures: T15ETransportCleanupCategory[] = []
  const onTerminalStdinError = (): void => {
    terminalStdinErrors += 1
  }
  const onStdinClose = (): void => {
    if (stdinCloseHandled) return // idempotent, independent guarded removals
    stdinCloseHandled = true
    stdinClosed = true // closure is recorded even if a removal throws
    const recordCloseFailure = (category: T15ETransportCleanupCategory) => {
      if (!closeFinalizerFailures.includes(category)) closeFinalizerFailures.push(category)
    }
    try {
      terminalStdinRef?.removeListener('error', onTerminalStdinError)
    } catch {
      recordCloseFailure('CLEANUP_LISTENER_REMOVAL_FAILED')
    }
    try {
      terminalStdinRef?.removeListener('close', onStdinClose)
    } catch {
      recordCloseFailure('CLEANUP_LISTENER_REMOVAL_FAILED')
    }
  }
  let terminalStdinRef: T15EPsqlStdin | null = null
  const onChildExit = (): void => {
    childExited = true
    for (const waiter of exitWaiters.splice(0)) waiter()
    if (!childExitedBeforeSettle) voidSession('T15E_CHILD_EXITED_BEFORE_FRAME')
    childExitedBeforeSettle = true
  }
  let childExitedBeforeSettle = false

  function voidSession(category: T15ETransportFailureCategory): void {
    if (settledOutcome === null) settledOutcome = { ok: false, category, message: T15E_SAFE_ERROR_MESSAGE }
    if (state === 'IDLE' || state === 'READY') state = 'UNUSABLE'
    // Drop the parser so any further stdout is only byte-counted.
    parser = null
    const wake = currentVoidResolve
    currentVoidResolve = null
    wake?.()
  }

  // Pending frame resolution for the in-flight command.
  let frameResolve: ((frame: FramedResult) => void) | null = null
  function onFrame(frame: FramedResult): void {
    if (frameResolve === null) {
      // Stray frame after settlement: consumed, never surfaced, voids session.
      lateFrames += 1
      voidSession('T15E_FRAME_PROTOCOL_ERROR')
      return
    }
    const resolve = frameResolve
    frameResolve = null
    resolve(frame)
  }

  const armTimer = (ms: number): T15EArmedTimer => scheduleTimer(Math.max(0, ms))
  /** Individually guarded listener removal; failures are REPORTED, never
   *  thrown, so one failing removal cannot skip the remaining finalizers. */
  function detachListeners(
    target: T15EPsqlChild,
    record: (category: T15ETransportCleanupCategory) => void,
  ): void {
    const guarded = (op: () => void, category: T15ETransportCleanupCategory) => {
      try {
        op()
      } catch {
        record(category)
      }
    }
    if (target.stdout) guarded(() => target.stdout!.removeListener('data', onStdoutData), 'CLEANUP_LISTENER_REMOVAL_FAILED')
    if (target.stderr) guarded(() => target.stderr!.removeListener('data', onStderrData), 'CLEANUP_LISTENER_REMOVAL_FAILED')
    if (target.stdin) guarded(() => target.stdin!.removeListener('error', onStdinError), 'CLEANUP_LISTENER_REMOVAL_FAILED')
    // NOTE: the TERMINAL stdin sink + its close listener are deliberately
    // NOT removed here — they persist until actual writable closure.
    guarded(() => target.removeListener('error', onChildError), 'CLEANUP_LISTENER_REMOVAL_FAILED')
    guarded(() => target.removeListener('exit', onChildExit), 'CLEANUP_LISTENER_REMOVAL_FAILED')
  }

  /** Bounded wait: race a thunk against an armed timer; timer always cancelled. */
  async function awaitBoundedTransport<T>(
    thunk: () => Promise<T>,
    budgetMs: number,
  ): Promise<{ kind: 'value'; value: T } | { kind: 'timeout' }> {
    if (!(budgetMs > 0)) {
      // Consume late settlement so a late rejection can never be unhandled.
      thunk().then(
        () => undefined,
        () => undefined,
      )
      return { kind: 'timeout' }
    }
    let settled = false
    let observed: Promise<T>
    try {
      observed = thunk()
    } catch {
      return { kind: 'timeout' }
    }
    const timer = armTimer(budgetMs)
    const outcome = await Promise.race([
      observed.then((value) => {
        if (settled) return null
        return { kind: 'value' as const, value }
      }),
      timer.fired.then(() => ({ kind: 'timeout' as const } as const)),
    ])
    settled = true
    timer.cancel()
    if (outcome === null) return { kind: 'timeout' } // late after settle: consumed
    return outcome
  }

  function spawnChildOnce(): T15EPsqlChild {
    // FENCE: exactly one child per session, and none after disposal.
    if (spawnAttempted && child === null) throw new Error('T15E_TRANSPORT_DISPOSED')
    if (child !== null) return child
    spawnAttempted = true
    childEverCreated = true
    const spawned = spawnPsql(RUNNER_PSQL_EXECUTABLE, T15E_PSQL_ARGS, {
      env: {
        PATH: `${PG_BIN}:/usr/bin:/bin`,
        LC_ALL: 'C',
        PGPASSWORD: boundConfig.password,
        PGHOST: '127.0.0.1',
        PGPORT: String(boundConfig.port),
        PGUSER: 'postgres',
        PGDATABASE: boundConfig.database,
      },
      shell: false,
    })
    child = spawned
    parser = createFramedResultParser({
      expectedRunNonce: boundConfig.runNonce,
      maxLineBytes: T15E_DEADLINES_MS.maxLineBytes,
      maxFrameBytes: T15E_DEADLINES_MS.maxFrameBytes,
      maxTotalBytes: maxTotalBytes,
    })
    if (spawned.stdout) spawned.stdout.on('data', onStdoutData)
    if (spawned.stderr) spawned.stderr.on('data', onStderrData)
    if (spawned.stdin) {
      spawned.stdin.on('error', onStdinError)
      spawned.stdin.on('error', onTerminalStdinError)
      spawned.stdin.on('close', onStdinClose)
      terminalStdinRef = spawned.stdin
    }
    spawned.on('error', onChildError)
    spawned.on('exit', onChildExit)
    return spawned
  }

  async function runFramedCommand(
    command: T15ETrustedCommand,
    deadlineEpochMs: number,
  ): Promise<T15ECommandResult> {
    // REVOKED capability first (most specific fixed category): the listener
    // already voided the session at revocation time, so the generic unusable
    // gate must never mask the revocation cause.
    if (!capabilityLive()) {
      capabilityRevoked = true
      voidSession('T15E_CAPABILITY_REVOKED')
      return fail('T15E_CAPABILITY_REVOKED')
    }
    if (state === 'DISPOSED') return fail('T15E_TRANSPORT_DISPOSED')
    if (state === 'CLOSING') return fail('T15E_SESSION_UNUSABLE')
    if (state === 'UNUSABLE') return fail('T15E_SESSION_UNUSABLE')
    if (commandInFlight) return fail('T15E_COMMAND_IN_FLIGHT')
    // Connection-boundary fence (Task77): arbitrary commands require a
    // session whose CLUSTER identity was already verified against the owned
    // capability by the fixed identity SQL — never caller assertions.
    if (command.kind !== 'SELECT_BACKEND_IDENTITY' && !clusterVerified) {
      return fail('T15E_CLUSTER_IDENTITY_UNVERIFIED')
    }
    const seq = nextSeq
    const built = buildTrustedPsqlCommand(command, boundConfig.runNonce, seq)
    if (!built.ok) return fail('T15E_INVALID_COMMAND')

    commandInFlight = true
    settledOutcome = null
    childExitedBeforeSettle = false
    try {
      const owned = spawnChildOnce()
      const framePromise = new Promise<FramedResult>((resolve) => {
        frameResolve = resolve
      })
      // Event-driven voided signal: resolved BY voidSession (never polled).
      const voidedSignal = new Promise<'voided'>((resolve) => {
        currentVoidResolve = () => resolve('voided')
      })
      // Late settlements are consumed by awaitBoundedTransport's race; a
      // frame arriving after the race resolved goes through onFrame's
      // late-frame path (counted, voids session, never unhandled).
      if (owned.stdin === null) {
        voidSession('T15E_SPAWN_ERROR')
        return settledOutcome ?? fail('T15E_SPAWN_ERROR')
      }
      const remainingBudget = () => deadlineEpochMs - clock.nowEpochMs()
      // Bounded write with explicit completion callback (Node Writable
      // contract): a false return under backpressure is NOT an error; the
      // callback is the completion signal and stays bounded by the SAME
      // command deadline. A synchronous write throw is contained.
      let writeAckResolve!: (error: Error | null) => void
      const writeAck = new Promise<Error | null>((resolve) => {
        writeAckResolve = resolve
      })
      if (!capabilityLive()) {
        voidSession('T15E_CAPABILITY_REVOKED')
        return settledOutcome ?? fail('T15E_CAPABILITY_REVOKED')
      }
      let writeThrew = false
      try {
        owned.stdin.write(Buffer.from(built.sql, 'utf8'), (error) => {
          writeAckResolve(error ?? null)
        })
      } catch {
        writeThrew = true
      }
      if (writeThrew) {
        voidSession('T15E_WRITE_FAILED')
        return settledOutcome ?? fail('T15E_WRITE_FAILED')
      }
      const ackOutcome = await awaitBoundedTransport(
        () => Promise.race([writeAck, voidedSignal]),
        remainingBudget(),
      )
      if (ackOutcome.kind === 'timeout') {
        try {
          owned.kill('SIGTERM')
        } catch {
          // Disposal owns further escalation of the owned handle.
        }
        voidSession('T15E_COMMAND_TIMEOUT')
        return settledOutcome ?? fail('T15E_COMMAND_TIMEOUT')
      }
      if (ackOutcome.value === 'voided') {
        if (capabilityRevoked) return fail('T15E_CAPABILITY_REVOKED')
        return settledOutcome ?? fail('T15E_SESSION_UNUSABLE')
      }
      if (ackOutcome.value !== null) {
        voidSession('T15E_WRITE_FAILED')
        return settledOutcome ?? fail('T15E_WRITE_FAILED')
      }
      // A failure latched while the write ack was pending must win over any
      // later success: recheck BEFORE accepting the completed write.
      if (sessionVoided()) {
        return settledOutcome ?? fail('T15E_SESSION_UNUSABLE')
      }
      const raced = await awaitBoundedTransport(
        () => Promise.race([framePromise, voidedSignal]),
        remainingBudget(),
      )
      if (raced.kind === 'timeout') {
        // Timeout: signal the EXACT owned handle only; void the session.
        try {
          owned.kill('SIGTERM')
        } catch {
          // Disposal owns further escalation of the owned handle.
        }
        voidSession('T15E_COMMAND_TIMEOUT')
        return settledOutcome ?? fail('T15E_COMMAND_TIMEOUT')
      }
      if (raced.value === 'voided') {
        if (capabilityRevoked) return fail('T15E_CAPABILITY_REVOKED')
        return settledOutcome ?? fail('T15E_SESSION_UNUSABLE')
      }
      const frame = raced.value
      // Latched-failure recheck BEFORE success: one coalesced chunk may
      // resolve this frame AND then deliver garbage or a duplicate (which
      // voidSession latched after the resolve). The latched failure ALWAYS
      // wins — a failed chunk can never resolve a usable result.
      if (sessionVoided()) {
        return settledOutcome ?? fail('T15E_SESSION_UNUSABLE')
      }
      nextSeq = frame.seq + 1
      if (state === 'IDLE' || state === 'READY') state = 'READY'
      return { ok: true, frame }
    } finally {
      commandInFlight = false
      frameResolve = null
      currentVoidResolve = null
    }
  }

  function fail(category: T15ETransportFailureCategory): T15ECommandResult {
    return { ok: false, category, message: T15E_SAFE_ERROR_MESSAGE }
  }

  /** Latched-failure recheck (Task76 P1-2): a voided session NEVER resolves
   *  a usable command result, even when a frame promise won the race. Read
   *  through a closure so TypeScript narrowing cannot hide late mutations. */
  const sessionVoided = (): boolean =>
    capabilityRevoked || settledOutcome !== null || parser === null || state === 'UNUSABLE' || state === 'DISPOSED'

  const disposalFailures: T15ETransportCleanupCategory[] = []
  /**
   * STABLE SNAPSHOT (Task79): build a FROZEN point-in-time disposal outcome.
   * ok is FALSE while the writable close / close-time finalizers are still
   * pending; every dispose()/close() call returns a NEW snapshot reflecting
   * the CURRENT state — previously returned results are never rewritten.
   * backendGoneConfirmed stays false: the independent monitor obligation is
   * untouched by child exit or writable closure.
   */
  const buildDisposalSnapshot = (): T15EChildDisposalOutcome => {
    const combined: T15ETransportCleanupCategory[] = [...disposalFailures]
    for (const c of closeFinalizerFailures) {
      if (!combined.includes(c)) combined.push(c)
    }
    const writableExisted = terminalStdinRef !== null
    const terminalCleanup: T15ETerminalCleanupStatus =
      !writableExisted
        ? 'complete' // no writable ever existed (no child, or a stdin-less child)
        : stdinClosed
          ? closeFinalizerFailures.length > 0
            ? 'failed'
            : 'complete'
          : 'pending'
    const finalizersCompleted = disposalPhase === 'completed'
    return Object.freeze({
      ok:
        (!childEverCreated || childExited) &&
        terminalCleanup === 'complete' &&
        finalizersCompleted &&
        combined.length === 0,
      childExited,
      cleanupFailures: Object.freeze(combined) as readonly T15ETransportCleanupCategory[],
      terminalCleanup,
      backendGoneConfirmed: false as const,
      pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION' as const,
    })
  }

  async function waitForExit(budgetMs: number): Promise<boolean> {
    if (childExited) return true
    if (child === null) return false
    let waiter!: () => void
    const exitPromise = new Promise<boolean>((resolve) => {
      waiter = () => resolve(true)
      exitWaiters.push(waiter)
    })
    const outcome = await awaitBoundedTransport(() => exitPromise, budgetMs)
    if (outcome.kind === 'timeout') {
      const index = exitWaiters.indexOf(waiter)
      if (index >= 0) exitWaiters.splice(index, 1)
      return false
    }
    return outcome.value
  }

  const transport: T15EPersistentPsqlTransport = {
    async connect(deadlineEpochMs: number): Promise<T15EConnectResult> {
      const result = await runFramedCommand({ kind: 'SELECT_BACKEND_IDENTITY' }, deadlineEpochMs)
      if (!result.ok) return { ok: false, category: result.category, message: result.message }
      const observed = result.frame.result as Record<string, unknown>
      // CLUSTER identity check FIRST — the observed data_directory / server
      // port / database must match the frozen owned capability BEFORE the
      // session is accepted or any arbitrary command may run. This is the
      // connected-cluster proof; the WeakSet alone proves nothing here.
      const expected = boundConfig.capability.cluster
      if (
        observed.dataDirectory !== expected.dataDirectory ||
        observed.serverPort !== expected.databasePort ||
        observed.databaseName !== expected.database
      ) {
        voidSession('T15E_CLUSTER_IDENTITY_MISMATCH')
        return { ok: false, category: 'T15E_CLUSTER_IDENTITY_MISMATCH', message: T15E_SAFE_ERROR_MESSAGE }
      }
      const identity = observed
      if (
        typeof identity.pid !== 'number' ||
        !Number.isInteger(identity.pid) ||
        identity.pid <= 0 ||
        !isValidT15ECanonicalBackendStart(identity.backendStart) ||
        typeof identity.databaseId !== 'number' ||
        !Number.isInteger(identity.databaseId)
      ) {
        return { ok: false, category: 'T15E_IDENTITY_FRAME_INVALID', message: T15E_SAFE_ERROR_MESSAGE }
      }
      // LIVE check after the async verification, BEFORE accepting the session
      // (an already-resolved race can never produce a false acceptance).
      if (!capabilityLive()) {
        voidSession('T15E_CAPABILITY_REVOKED')
        return { ok: false, category: 'T15E_CAPABILITY_REVOKED', message: T15E_SAFE_ERROR_MESSAGE }
      }
      clusterVerified = true
      verifiedClusterSnapshot = Object.freeze({
        dataDirectory: observed.dataDirectory as string,
        serverPort: observed.serverPort as number,
        databaseName: observed.databaseName as string,
      })
      return {
        ok: true,
        identity: { pid: identity.pid, backendStart: identity.backendStart, databaseId: identity.databaseId },
      }
    },
    executeTrustedCommand(command, deadlineEpochMs) {
      return runFramedCommand(command, deadlineEpochMs)
    },
    async close(deadlineEpochMs: number): Promise<boolean> {
      if (disposalPhase !== 'not-started') return buildDisposalSnapshot().ok
      state = 'CLOSING'
      if (child !== null && child.stdin !== null) {
        try {
          child.stdin.end()
        } catch {
          return false
        }
      }
      if (child === null) return true
      return waitForExit(deadlineEpochMs - clock.nowEpochMs())
    },
    async dispose(deadlineEpochMs: number): Promise<T15EChildDisposalOutcome> {
      if (disposalPhase === 'not-started') {
        disposalPhase = 'in-flight'
        state = 'DISPOSED'
        const recordCleanup = (category: T15ETransportCleanupCategory) => {
          if (!disposalFailures.includes(category)) disposalFailures.push(category)
        }
        let exited = childExited
        const target = child
        const remaining = () => Math.min(deadlineEpochMs - clock.nowEpochMs(), 30_000)
        if (target !== null) {
          if (target.stdin !== null) {
            try {
              target.stdin.end()
            } catch {
              recordCleanup('CLEANUP_STDIN_END_FAILED')
            }
          }
          // Bounded TERM -> KILL escalation on the EXACT owned handle only.
          // EACH kill is guarded: a throwing SIGTERM can never skip SIGKILL,
          // the finalizers, or the pending-command wake (Task76 P1-4).
          if (!exited) {
            try {
              target.kill('SIGTERM')
            } catch {
              recordCleanup('CLEANUP_SIGNAL_ERROR')
            }
            exited = await waitForExit(Math.min(T15E_DEADLINES_MS.sigterm, remaining()))
          }
          if (!exited) {
            try {
              target.kill('SIGKILL')
            } catch {
              recordCleanup('CLEANUP_SIGNAL_ERROR')
            }
            exited = await waitForExit(Math.min(T15E_DEADLINES_MS.sigkill, remaining()))
          }
          // Finalizers guarded INDIVIDUALLY: one throwing removal never skips
          // the remaining removals or the wake below. The TERMINAL stdin
          // sink + close listener are deliberately retained until actual
          // writable closure (Task78) and are NEVER removed here.
          detachListeners(target, recordCleanup)
        }
        // Task84: the revocation subscription is unsubscribed in the ONE-TIME
        // finalization UNCONDITIONALLY (childless and failed-cleanup disposal
        // included) — individually guarded: a throwing unsubscribe records the
        // fixed category and preserves the primary failure; a failing sibling
        // finalizer never skips it.
        try {
          revocationSubscription?.unsubscribe()
        } catch {
          recordCleanup('CLEANUP_LISTENER_REMOVAL_FAILED')
        }
        child = null
        parser = null
        // Wake any still-pending command: its late settlement is consumed by
        // its own race; the fence forbids all further children/commands.
        const wake = currentVoidResolve
        currentVoidResolve = null
        wake?.()
        disposalPhase = 'completed'
      }
      // Every call returns a NEW frozen snapshot of the CURRENT state.
      return buildDisposalSnapshot()
    },
    state: () => state,
    verifiedCluster: () => verifiedClusterSnapshot,
  }
  return { ok: true, transport }
}
