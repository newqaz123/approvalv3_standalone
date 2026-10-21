/**
 * T15E protocol + overlap validation primitives (Task68) — PURE helpers only.
 *
 * Implements the corrected Astra contract
 * (READY_FOR_BOUNDED_T15E_HELPER_IMPLEMENTATION, six constraints) at the
 * pure/type layer: strict canonical identifiers, fixed-key nonce-bound phase
 * payloads (no PID/credentials reach the browser), a legal-phase state machine
 * (READY only after verified lock acknowledgment), a bounded incremental
 * per-command-nonce psql framing parser (fixed safe errors, no echo, no
 * arbitrary stderr persistence), and a pure overlap verifier over SANITIZED
 * activity snapshots (query category enum, never raw query text).
 *
 * Explicit NON-goals (later slices, do not add here): process spawn, psql/DB
 * runtime, persistent connection lifecycle, watchdog timers, runner wiring,
 * barrier execution, the Prisma SQL shape classifier (currently always UNKNOWN
 * — fails closed), and capture/provenance (snapshots carry timestamps from a
 * future capture; this module does NOT prove SQL rows authentic).
 */

// ---------------------------------------------------------------------------
// Bounds / constants (types + numbers only; no timers or polling implemented)
// ---------------------------------------------------------------------------

export const RUN_NONCE_HEX_LENGTH = 32 // 128-bit fresh nonce; generated later by the runner

export const T15E_DEADLINES_MS = {
  /** Overall watchdog armed BEFORE lock acquisition is even sent. */
  overallWatchdog: 120_000,
  connect: 10_000,
  pidDiscovery: 10_000,
  /** Acquisition attempt budget (send → ack/abort). MUST fit inside the
   *  absolute hold deadline below — acquisition consumes it, never adds to it. */
  lockAcquire: 1_000,
  /** THE absolute deadline: acquisition-SEND → RELEASE, 3s. Acquisition,
   *  observation, and release ALL share this one budget; validation enforces
   *  acquire + releaseReserve <= hold. Constants only — no timers here.
   *  Post-deadline TERM/KILL cleanup may run to remove an owned resource but
   *  NEVER extends a valid hold proof. */
  lockHoldSendToRelease: 3_000,
  /** Time reserved out of the hold for the release itself. */
  releaseReserve: 500,
  rollback: 10_000,
  sigterm: 5_000,
  sigkill: 5_000,
  /** Child exit alone proves nothing; owned backend must be gone. */
  backendGoneConfirm: 15_000,
  snapshotMaxAge: 2_000,
  pollInterval: 250,
  maxFrameBytes: 8 * 1024,
  maxLineBytes: 512,
  maxTotalBytes: 256 * 1024,
  maxSessions: 8,
} as const

/** NONCONFIGURABLE hard maximum for the acquisition-send → release hold.
 *  Frozen module literal — NOT derived from any user plan, defaults, or the
 *  watchdog. validateDeadlinePlan rejects any hold above this regardless of
 *  other budgets. Reviewer-approved maximum: 3000ms. */
export const MAX_LOCK_HOLD_MS = 3000 as const

export type T15EDeadlineName = keyof typeof T15E_DEADLINES_MS

export type DeadlinePlan = { [K in keyof typeof T15E_DEADLINES_MS]: number }
export type DeadlinePlanViolation =
  | 'HOLD_EXCEEDS_WATCHDOG'
  | 'HOLD_EXCEEDS_HARD_MAX'
  | 'ACQUIRE_PLUS_RESERVE_EXCEEDS_HOLD'
  | 'NON_POSITIVE_BUDGET'

/** Pure invariant check on the deadline plan (no timers): the acquisition-send
 *  → release hold is bound by the overall watchdog, acquisition itself consumes
 *  that budget, and every budget is a positive finite duration. */
export function validateDeadlinePlan(
  plan: DeadlinePlan,
): { ok: true } | { ok: false; reason: DeadlinePlanViolation; message: string } {
  const positiveBudgets: Array<T15EDeadlineName> = [
    'overallWatchdog',
    'connect',
    'pidDiscovery',
    'lockAcquire',
    'lockHoldSendToRelease',
    'releaseReserve',
    'rollback',
    'sigterm',
    'sigkill',
    'backendGoneConfirm',
    'snapshotMaxAge',
    'pollInterval',
  ]
  for (const name of positiveBudgets) {
    const value = plan[name]
    if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value) || value <= 0) {
      return { ok: false, reason: 'NON_POSITIVE_BUDGET', message: T15E_SAFE_ERROR_MESSAGE }
    }
  }
  // Independent hard cap: applies BEFORE and REGARDLESS of the watchdog or any
  // other budget — a 60s hold under a 120s watchdog is still forbidden.
  if (plan.lockHoldSendToRelease > MAX_LOCK_HOLD_MS) {
    return { ok: false, reason: 'HOLD_EXCEEDS_HARD_MAX', message: T15E_SAFE_ERROR_MESSAGE }
  }
  if (plan.lockHoldSendToRelease > plan.overallWatchdog) {
    return { ok: false, reason: 'HOLD_EXCEEDS_WATCHDOG', message: T15E_SAFE_ERROR_MESSAGE }
  }
  // ONE absolute deadline: acquisition and release RESERVE must fit inside the
  // hold. The additive interpretation (acquire + hold as separate time) is
  // prohibited; observation implicitly uses the remainder.
  if (plan.lockAcquire + plan.releaseReserve > plan.lockHoldSendToRelease) {
    return { ok: false, reason: 'ACQUIRE_PLUS_RESERVE_EXCEEDS_HOLD', message: T15E_SAFE_ERROR_MESSAGE }
  }
  return { ok: true }
}

export const T15E_COUNTER_NAMES = [
  'armPublished',
  'readyReceived',
  'lockAcquireSent',
  'lockAcquireAcknowledged',
  'snapshotPolls',
  'staleSnapshotsRejected',
  'frameBytesBuffered',
  'frameProtocolErrors',
  'voidedRuns',
] as const
export type T15ECounterName = (typeof T15E_COUNTER_NAMES)[number]

/** Fixed safe error message: never includes input, query text, or stderr. */
export const T15E_SAFE_ERROR_MESSAGE = 'T15E protocol failure'

// ---------------------------------------------------------------------------
// Strict canonical identifiers + safe SQL literal binding
// ---------------------------------------------------------------------------

const CANONICAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RUN_NONCE_RE = /^[0-9a-f]{32}$/

export function isValidCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_RE.test(value)
}

export function validateRunNonce(value: unknown): value is string {
  return typeof value === 'string' && RUN_NONCE_RE.test(value)
}

/** Quote ONLY pre-validated identifiers — validation removes every SQL metachar. */
export function uuidSqlLiteral(value: unknown): string | null {
  return isValidCanonicalUuid(value) ? `'${value}'` : null
}

export function hex32SqlLiteral(value: unknown): string | null {
  return validateRunNonce(value) ? `'${value}'` : null
}

// ---------------------------------------------------------------------------
// Phase payloads: fixed keys, nonce-bound, browser-safe (no PID/credentials)
// ---------------------------------------------------------------------------

export const FORBIDDEN_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  'pid',
  'ppid',
  'password',
  'credential',
  'credentials',
  'connectionstring',
  'connectionuri',
  'uri',
  'url',
  'host',
  'port',
  'user',
  'token',
  'secret',
  'stderr',
  'stdout',
  'query',
  'querytext',
  'href',
])

export type ArmPayload = { kind: 'ARM'; runNonce: string; requestId: string }
export type LockAcknowledgment = {
  runNonce: string
  requestId: string
  locked: true
  /** Epoch ms when acquisition was SENT (conservative lock-duration origin). */
  acquireSentAtEpochMs: number
}
export type ReadyPayload = {
  kind: 'READY'
  runNonce: string
  requestId: string
  lockAck: LockAcknowledgment
}
export type SanitizedOverlap = {
  topology: 'TRANSITIVE' | 'DIRECT_BOTH'
  appBackendPids: [number, number]
  coordinatorPid: number
}
export type ProofPayload = {
  kind: 'PROOF'
  runNonce: string
  requestId: string
  overlap: SanitizedOverlap
}
export type ReleasePayload = {
  kind: 'RELEASE'
  runNonce: string
  requestId: string
  outcome: 'COMPLETED' | 'VOIDED'
}
export type PhasePayload = ArmPayload | ReadyPayload | ProofPayload | ReleasePayload

export type PayloadValidationOk<T> = { ok: true; value: T }
export type PayloadValidationFail = {
  ok: false
  reason: 'NOT_AN_OBJECT' | 'INVALID_NONCE' | 'INVALID_REQUEST_ID' | 'FORBIDDEN_PAYLOAD_KEY' | 'SCHEMA_MISMATCH'
  message: string
}
export type PayloadValidation<T> = PayloadValidationOk<T> | PayloadValidationFail

export type ShapedPayload = { runNonce: string; requestId: string } & Record<string, unknown>

function checkPayloadShape(
  value: unknown,
  expectedKeys: readonly string[],
): PayloadValidation<ShapedPayload> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'NOT_AN_OBJECT', message: T15E_SAFE_ERROR_MESSAGE }
  }
  const keys = Object.keys(value)
  for (const key of keys) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase())) {
      return { ok: false, reason: 'FORBIDDEN_PAYLOAD_KEY', message: T15E_SAFE_ERROR_MESSAGE }
    }
  }
  const sorted = [...keys].sort()
  const expected = [...expectedKeys].sort()
  if (sorted.length !== expected.length || sorted.some((k, i) => k !== expected[i])) {
    return { ok: false, reason: 'SCHEMA_MISMATCH', message: T15E_SAFE_ERROR_MESSAGE }
  }
  const record = value as Record<string, unknown>
  if (!validateRunNonce(record.runNonce)) {
    return { ok: false, reason: 'INVALID_NONCE', message: T15E_SAFE_ERROR_MESSAGE }
  }
  if (!isValidCanonicalUuid(record.requestId)) {
    return { ok: false, reason: 'INVALID_REQUEST_ID', message: T15E_SAFE_ERROR_MESSAGE }
  }
  const shaped: ShapedPayload = {
    ...record,
    runNonce: record.runNonce as string,
    requestId: record.requestId as string,
  }
  return { ok: true, value: shaped }
}

export function validateArmPayload(value: unknown): PayloadValidation<ArmPayload> {
  const shape = checkPayloadShape(value, ['kind', 'runNonce', 'requestId'])
  if (!shape.ok) return shape
  if (shape.value.kind !== 'ARM') {
    return { ok: false, reason: 'SCHEMA_MISMATCH', message: T15E_SAFE_ERROR_MESSAGE }
  }
  return { ok: true, value: { kind: 'ARM', runNonce: shape.value.runNonce, requestId: shape.value.requestId } }
}

export function validateLockAcknowledgment(
  value: unknown,
): PayloadValidation<LockAcknowledgment> {
  const shape = checkPayloadShape(value, [
    'runNonce',
    'requestId',
    'locked',
    'acquireSentAtEpochMs',
  ])
  if (!shape.ok) return shape
  const { locked, acquireSentAtEpochMs } = shape.value
  if (locked !== true || typeof acquireSentAtEpochMs !== 'number' || !Number.isFinite(acquireSentAtEpochMs)) {
    return { ok: false, reason: 'SCHEMA_MISMATCH', message: T15E_SAFE_ERROR_MESSAGE }
  }
  return {
    ok: true,
    value: {
      runNonce: shape.value.runNonce,
      requestId: shape.value.requestId,
      locked: true,
      acquireSentAtEpochMs,
    },
  }
}

export function validateReadyPayload(value: unknown): PayloadValidation<ReadyPayload> {
  const shape = checkPayloadShape(value, ['kind', 'runNonce', 'requestId', 'lockAck'])
  if (!shape.ok) return shape
  if (shape.value.kind !== 'READY') {
    return { ok: false, reason: 'SCHEMA_MISMATCH', message: T15E_SAFE_ERROR_MESSAGE }
  }
  const ack = validateLockAcknowledgment(shape.value.lockAck)
  if (!ack.ok) return ack
  // Same-run binding: the lock ack must be for exactly this run and request.
  if (ack.value.runNonce !== shape.value.runNonce || ack.value.requestId !== shape.value.requestId) {
    return { ok: false, reason: 'SCHEMA_MISMATCH', message: T15E_SAFE_ERROR_MESSAGE }
  }
  return {
    ok: true,
    value: {
      kind: 'READY',
      runNonce: shape.value.runNonce,
      requestId: shape.value.requestId,
      lockAck: ack.value,
    },
  }
}

// ---------------------------------------------------------------------------
// Phase state machine: ARM -> READY(verified lock ack) -> PROOF -> RELEASE
// ---------------------------------------------------------------------------

export type PhaseStage = 'IDLE' | 'ARMED' | 'READY' | 'PROVEN' | 'RELEASED'

export type PhaseAcceptOk = { ok: true; stage: PhaseStage }
export type PhaseAcceptFail = {
  ok: false
  reason:
    | 'INVALID_PAYLOAD'
    | 'STALE_NONCE'
    | 'REQUEST_MISMATCH'
    | 'ILLEGAL_ORDER'
    | 'READY_BEFORE_VERIFIED_LOCK'
  message: string
}

export interface T15EPhaseMachine {
  accept(payload: unknown): PhaseAcceptOk | PhaseAcceptFail
  stage(): PhaseStage
}

export function createT15EPhaseMachine(): T15EPhaseMachine {
  let current: PhaseStage = 'IDLE'
  let runNonce: string | null = null
  let armedRequestId: string | null = null
  return {
    stage: () => current,
    accept(payload: unknown): PhaseAcceptOk | PhaseAcceptFail {
      if (typeof payload !== 'object' || payload === null) {
        return { ok: false, reason: 'INVALID_PAYLOAD', message: T15E_SAFE_ERROR_MESSAGE }
      }
      const kind = (payload as Record<string, unknown>).kind
      const nonce = (payload as Record<string, unknown>).runNonce
      if (runNonce !== null && nonce !== runNonce) {
        // Same-run nonce binding: any phase from another run is stale.
        return { ok: false, reason: 'STALE_NONCE', message: T15E_SAFE_ERROR_MESSAGE }
      }
      if (armedRequestId !== null && (payload as Record<string, unknown>).requestId !== armedRequestId) {
        // Every READY/PROOF/RELEASE (and its lock ack identity) is bound to the
        // request armed by ARM; a self-consistent ack for another request is
        // still a mismatch.
        return { ok: false, reason: 'REQUEST_MISMATCH', message: T15E_SAFE_ERROR_MESSAGE }
      }
      switch (kind) {
        case 'ARM': {
          if (current !== 'IDLE') {
            return { ok: false, reason: 'ILLEGAL_ORDER', message: T15E_SAFE_ERROR_MESSAGE }
          }
          const arm = validateArmPayload(payload)
          if (!arm.ok) return { ok: false, reason: 'INVALID_PAYLOAD', message: arm.message }
          runNonce = arm.value.runNonce
          armedRequestId = arm.value.requestId
          current = 'ARMED'
          return { ok: true, stage: current }
        }
        case 'READY': {
          if (current !== 'ARMED') {
            return { ok: false, reason: 'ILLEGAL_ORDER', message: T15E_SAFE_ERROR_MESSAGE }
          }
          const ready = validateReadyPayload(payload)
          if (!ready.ok) {
            return { ok: false, reason: 'READY_BEFORE_VERIFIED_LOCK', message: T15E_SAFE_ERROR_MESSAGE }
          }
          current = 'READY'
          return { ok: true, stage: current }
        }
        case 'PROOF': {
          if (current !== 'READY') {
            return { ok: false, reason: 'ILLEGAL_ORDER', message: T15E_SAFE_ERROR_MESSAGE }
          }
          const shape = checkPayloadShape(payload, ['kind', 'runNonce', 'requestId', 'overlap'])
          if (!shape.ok || shape.value.kind !== 'PROOF') {
            return { ok: false, reason: 'INVALID_PAYLOAD', message: T15E_SAFE_ERROR_MESSAGE }
          }
          const overlap = shape.value.overlap
          const TOPOLOGIES: ReadonlySet<string> = new Set(['TRANSITIVE', 'DIRECT_BOTH'])
          const candidate = overlap as Partial<SanitizedOverlap> | null
          const pids = candidate?.appBackendPids
          const overlapOk =
            typeof overlap === 'object' &&
            overlap !== null &&
            !Array.isArray(overlap) &&
            Object.keys(overlap).length === 3 &&
            Object.prototype.hasOwnProperty.call(overlap, 'topology') &&
            Object.prototype.hasOwnProperty.call(overlap, 'appBackendPids') &&
            Object.prototype.hasOwnProperty.call(overlap, 'coordinatorPid') &&
            typeof candidate?.topology === 'string' &&
            TOPOLOGIES.has(candidate.topology) && // own-membership Set: no `in` prototype names
            Array.isArray(pids) &&
            pids.length === 2 &&
            pids.every((p) => typeof p === 'number' && Number.isInteger(p) && p > 0) &&
            pids[0] !== pids[1] && // two DISTINCT app backend PIDs
            typeof candidate?.coordinatorPid === 'number' &&
            Number.isInteger(candidate.coordinatorPid) &&
            candidate.coordinatorPid > 0 &&
            candidate.coordinatorPid !== pids?.[0] &&
            candidate.coordinatorPid !== pids?.[1]
          if (!overlapOk) {
            return { ok: false, reason: 'INVALID_PAYLOAD', message: T15E_SAFE_ERROR_MESSAGE }
          }
          current = 'PROVEN'
          return { ok: true, stage: current }
        }
        case 'RELEASE': {
          if (current !== 'PROVEN') {
            return { ok: false, reason: 'ILLEGAL_ORDER', message: T15E_SAFE_ERROR_MESSAGE }
          }
          const shape = checkPayloadShape(payload, ['kind', 'runNonce', 'requestId', 'outcome'])
          if (
            !shape.ok ||
            shape.value.kind !== 'RELEASE' ||
            (shape.value.outcome !== 'COMPLETED' && shape.value.outcome !== 'VOIDED')
          ) {
            return { ok: false, reason: 'INVALID_PAYLOAD', message: T15E_SAFE_ERROR_MESSAGE }
          }
          current = 'RELEASED'
          return { ok: true, stage: current }
        }
        default:
          return { ok: false, reason: 'INVALID_PAYLOAD', message: T15E_SAFE_ERROR_MESSAGE }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Bounded incremental psql per-command nonce framing parser
// ---------------------------------------------------------------------------
// Wire format (LF-terminated lines, quiet psql -A -t, input echo disabled):
//   T15E_B1:<nonce>:<seq>:
//   <single-line JSON object result>
//   T15E_E1:<nonce>:<seq>:<totalBytesOfResultLine>:
// Aggregate output across ALL frames is bounded by maxTotalBytes. Unexpected
// tags, wrong nonce, seq gaps, TOTAL mismatches, extra lines, oversized
// partial lines, and unterminated frames all fail with the SAME fixed safe
// error. Results are returned parsed; raw bytes are never retained or echoed.

export interface FramedResult {
  seq: number
  total: number
  result: Record<string, unknown>
}

export interface FrameError {
  code: 'T15E_FRAME_PROTOCOL_ERROR' | 'T15E_STRING_TRANSPORT_REJECTED'
  message: string
}

export interface FrameParserConfig {
  expectedRunNonce: string
  maxLineBytes: number
  maxFrameBytes: number
  maxTotalBytes: number
}

const BEGIN_TAG = 'T15E_B1'
const END_TAG = 'T15E_E1'

export function frameCommand(nonce: string, seq: number, result: Record<string, unknown>): string {
  const json = JSON.stringify(result)
  const totalBytes = Buffer.byteLength(json, 'utf8')
  return `${BEGIN_TAG}:${nonce}:${seq}:\n${json}\n${END_TAG}:${nonce}:${seq}:${totalBytes}:\n`
}

function frameError(): FrameError {
  return { code: 'T15E_FRAME_PROTOCOL_ERROR', message: T15E_SAFE_ERROR_MESSAGE }
}

export interface FramedResultParser {
  /** Transport contract: BUFFER ONLY — psql stdout is a Buffer and is never
   *  setEncoding'd. String chunks are rejected at runtime with the fixed
   *  category T15E_STRING_TRANSPORT_REJECTED: UTF-8 encoding happens exactly
   *  once at the producer, so split-surrogate string semantics cannot arise.
   *  Complete lines are assembled from raw bytes (chunk grouping carries no
   *  meaning), then decoded with FATAL UTF-8 — invalid bytes fail, never
   *  replacement characters. */
  push(chunk: Buffer): Array<FramedResult | FrameError>
  /** Returns a FrameError if the stream ended mid-frame or mid-line. */
  finish(): FrameError | null
}

export function createFramedResultParser(config: FrameParserConfig): FramedResultParser {
  // ALL bounds are UTF-8 BYTE counts (not JS UTF-16 .length). Bytes are
  // buffered raw and decoded only at complete-line granularity with a FATAL
  // decoder, so multibyte sequences split across pushes reassemble before any
  // decode and malformed bytes fail instead of silently becoming replacement
  // characters; line splitting on 0x0A is UTF-8-safe (never inside a sequence).
  const fatalUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let inFrame = false
  let frameSeq = -1
  let frameResultLine: Buffer<ArrayBufferLike> | null = null
  let nextSeq = 0
  let totalStreamBytes = 0
  let failed = false
  if (!validateRunNonce(config.expectedRunNonce)) throw new Error('invalid parser nonce config')

  const fail = (): Array<FrameError> => {
    failed = true
    pending = Buffer.alloc(0)
    frameResultLine = null
    return [frameError()]
  }

  const handleLine = (line: Buffer<ArrayBufferLike>, out: Array<FramedResult | FrameError>): void => {
    if (line.length > config.maxLineBytes) {
      out.push(...fail())
      return
    }
    let text: string
    try {
      // FATAL UTF-8: malformed byte sequences throw instead of decoding to
      // replacement characters — altered contents are never accepted.
      text = fatalUtf8.decode(line)
    } catch {
      out.push(...fail())
      return
    }
    if (text === '') return
    if (text.startsWith(BEGIN_TAG) || text.startsWith(END_TAG)) {
      const parts = text.split(':')
      const [tag, nonce, seqStr, totalStr] = parts
      const seq = Number(seqStr)
      if (
        (parts.length !== (tag === BEGIN_TAG ? 4 : 5)) ||
        parts[parts.length - 1] !== '' ||
        nonce !== config.expectedRunNonce ||
        !Number.isInteger(seq) ||
        seq < 0
      ) {
        out.push(...fail())
        return
      }
      if (tag === BEGIN_TAG) {
        if (inFrame || seq !== nextSeq) {
          out.push(...fail())
          return
        }
        inFrame = true
        frameSeq = seq
        frameResultLine = null
        return
      }
      // END tag: TOTAL is a UTF-8 byte count of the result line.
      const total = Number(totalStr)
      if (!inFrame || seq !== frameSeq || !Number.isInteger(total)) {
        out.push(...fail())
        return
      }
      const resultLine = frameResultLine
      if (
        resultLine === null ||
        resultLine.length !== total ||
        resultLine.length > config.maxFrameBytes
      ) {
        out.push(...fail())
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(fatalUtf8.decode(resultLine))
      } catch {
        out.push(...fail())
        return
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        out.push(...fail())
        return
      }
      out.push({ seq, total, result: parsed as Record<string, unknown> })
      inFrame = false
      frameResultLine = null
      nextSeq = seq + 1
      return
    }
    if (text.startsWith('T15E_')) {
      // Unexpected tag from our namespace: fail closed, never persist it.
      out.push(...fail())
      return
    }
    if (!inFrame || frameResultLine !== null) {
      // Output outside a frame, or a second result line in one frame.
      out.push(...fail())
      return
    }
    if (line.length > config.maxFrameBytes) {
      out.push(...fail())
      return
    }
    frameResultLine = line
  }

  return {
    push(chunk: Buffer): Array<FramedResult | FrameError> {
      if (failed) return []
      if (typeof chunk === 'string') {
        // Intentional contract: string transport is rejected outright with a
        // fixed category — the producer encodes UTF-8 exactly once.
        failed = true
        pending = Buffer.alloc(0)
        frameResultLine = null
        return [{ code: 'T15E_STRING_TRANSPORT_REJECTED', message: T15E_SAFE_ERROR_MESSAGE }]
      }
      if (!Buffer.isBuffer(chunk)) return fail()
      const bytes = chunk
      if (bytes.length === 0) return []
      // Aggregate cap is on BYTES CONSUMED across the whole stream, checked
      // after byte accounting — never an arbitrary chunk-size heuristic.
      totalStreamBytes += bytes.length
      if (totalStreamBytes > config.maxTotalBytes) {
        return fail()
      }
      const combined = pending.length === 0 ? bytes : Buffer.concat([pending, bytes])
      const out: Array<FramedResult | FrameError> = []
      let start = 0
      let nl = combined.indexOf(0x0a, start)
      while (nl !== -1) {
        handleLine(combined.subarray(start, nl), out)
        if (failed) return out
        start = nl + 1
        nl = combined.indexOf(0x0a, start)
      }
      pending = Buffer.from(combined.subarray(start))
      if (pending.length > config.maxLineBytes) {
        // Partial line (no newline yet) that already exceeds the line bound
        // in UTF-8 bytes — fail regardless of how pushes were grouped.
        out.push(...fail())
      }
      return out
    },
    finish(): FrameError | null {
      if (failed) return null
      if (pending.length > 0 || inFrame) return frameError()
      return null
    },
  }
}

// ---------------------------------------------------------------------------
// Pure overlap verifier over SANITIZED activity snapshots
// ---------------------------------------------------------------------------
// Snapshot fields (including timestamps/provenance) come from a future capture
// layer; this verifier does NOT authenticate SQL rows. It only checks shape,
// freshness (caller-supplied now vs capturedAt), identity, chain, and topology
// constraints on already-sanitized data (query category enum, no raw query).

export type QueryCategory = 'UNKNOWN'
/** Named categories are deferred to a later adapter with pinned source
 *  fixtures; until then every query fails closed as UNKNOWN. */
export function classifyQueryText(_raw: unknown): QueryCategory {
  return 'UNKNOWN'
}

export type SanitizedActivitySession = {
  pid: number
  backendStart: string
  databaseId: number
  xactStart: string | null
  blockingPids: number[]
  queryCategory: QueryCategory
}

export type CoordinatorIdentity = { pid: number; backendStart: string; databaseId: number }

export type SanitizedActivitySnapshot = {
  provenance: { capturedAtEpochMs: number; source: string; dbIdentifier: string }
  coordinator: CoordinatorIdentity
  sessions: SanitizedActivitySession[]
}

export interface OverlapCheckConfig {
  nowEpochMs: number
  maxSnapshotAgeMs: number
  maxSessions: number
}

export function defaultOverlapCheckConfig(
  nowEpochMs: number,
  maxSnapshotAgeMs = T15E_DEADLINES_MS.snapshotMaxAge,
  maxSessions = T15E_DEADLINES_MS.maxSessions,
): OverlapCheckConfig {
  return { nowEpochMs, maxSnapshotAgeMs, maxSessions }
}

export type OverlapVerificationOk = {
  ok: true
  topology: 'TRANSITIVE' | 'DIRECT_BOTH'
  appBackendPids: [number, number]
  coordinatorPid: number
}
export type OverlapVerificationFail = {
  ok: false
  reason:
    | 'NOT_AN_OBJECT'
    | 'SNAPSHOT_OVERBOUND'
    | 'STALE_COORDINATOR_SNAPSHOT'
    | 'MISSING_COORDINATOR'
    | 'DATABASE_MISMATCH'
    | 'EXACTLY_TWO_APP_BACKENDS'
    | 'DUPLICATE_SESSION_PID'
    | 'XACT_NOT_ACTIVE'
    | 'UNKNOWN_NODE'
    | 'FOREIGN'
    | 'CYCLE'
    | 'ROOT_NOT_REACHED'
    | 'TOPOLOGY_UNSUPPORTED'
  message: string
}
export type OverlapVerification = OverlapVerificationOk | OverlapVerificationFail

function overlapFail(
  reason: OverlapVerificationFail['reason'],
): OverlapVerificationFail {
  return { ok: false, reason, message: T15E_SAFE_ERROR_MESSAGE }
}

function isSanitizedSession(value: unknown): value is SanitizedActivitySession {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.pid === 'number' &&
    Number.isInteger(s.pid) &&
    s.pid > 0 &&
    typeof s.backendStart === 'string' &&
    s.backendStart.length > 0 &&
    s.backendStart.length <= 64 &&
    typeof s.databaseId === 'number' &&
    Number.isInteger(s.databaseId) &&
    (s.xactStart === null || (typeof s.xactStart === 'string' && s.xactStart.length <= 64)) &&
    Array.isArray(s.blockingPids) &&
    s.blockingPids.length <= 8 &&
    s.blockingPids.every((p) => typeof p === 'number' && Number.isInteger(p) && p > 0) &&
    (s.queryCategory === 'UNKNOWN')
  )
}

export function verifyOverlapSnapshot(
  snapshot: unknown,
  config: OverlapCheckConfig,
): OverlapVerification {
  if (typeof snapshot !== 'object' || snapshot === null) return overlapFail('NOT_AN_OBJECT')
  const s = snapshot as Partial<SanitizedActivitySnapshot>
  if (
    typeof s.provenance !== 'object' ||
    s.provenance === null ||
    typeof s.provenance.capturedAtEpochMs !== 'number' ||
    !Number.isFinite(s.provenance.capturedAtEpochMs) ||
    typeof s.provenance.source !== 'string' ||
    !Array.isArray(s.sessions) ||
    typeof s.coordinator !== 'object' ||
    s.coordinator === null
  ) {
    return overlapFail('NOT_AN_OBJECT')
  }
  if (s.sessions.length > config.maxSessions) return overlapFail('SNAPSHOT_OVERBOUND')
  if (
    config.nowEpochMs - s.provenance.capturedAtEpochMs > config.maxSnapshotAgeMs ||
    s.provenance.capturedAtEpochMs > config.nowEpochMs
  ) {
    return overlapFail('STALE_COORDINATOR_SNAPSHOT')
  }
  const coord = s.coordinator as Partial<CoordinatorIdentity>
  if (
    typeof coord.pid !== 'number' ||
    typeof coord.backendStart !== 'string' ||
    typeof coord.databaseId !== 'number'
  ) {
    return overlapFail('MISSING_COORDINATOR')
  }
  if (!s.sessions.every(isSanitizedSession)) return overlapFail('NOT_AN_OBJECT')

  const coordSession = s.sessions.find((x) => x.pid === coord.pid)
  if (
    !coordSession ||
    coordSession.backendStart !== coord.backendStart ||
    coordSession.databaseId !== coord.databaseId
  ) {
    return overlapFail('MISSING_COORDINATOR')
  }
  if (!s.sessions.every((x) => x.databaseId === coord.databaseId)) {
    return overlapFail('DATABASE_MISMATCH')
  }
  if (coordSession.blockingPids.length > 0) return overlapFail('FOREIGN')

  // Unique PID across ALL sessions: a repeated PID with a different
  // backendStart is one backend misreported twice, never two identities.
  const sessionPids = s.sessions.map((x) => x.pid)
  if (new Set(sessionPids).size !== sessionPids.length) {
    return overlapFail('DUPLICATE_SESSION_PID')
  }
  const knownPids = new Set(sessionPids)
  const appSessions = s.sessions.filter((x) => x.pid !== coord.pid)
  if (appSessions.length !== 2) return overlapFail('EXACTLY_TWO_APP_BACKENDS')
  if (appSessions.some((x) => x.xactStart === null)) return overlapFail('XACT_NOT_ACTIVE')
  // Validate EVERY edge before any reach proof: each blocking PID must be a
  // node present in the snapshot (coordinator or one of the two app backends).
  if (s.sessions.some((x) => x.blockingPids.some((p) => !knownPids.has(p)))) {
    return overlapFail('UNKNOWN_NODE')
  }

  // Full reachable-graph DFS (white/gray/black). Detects ALL cycles — even
  // when a coordinator edge appears earlier on a path — before any root-reach
  // proof. Iterations bounded by maxSessions × per-node edge bound.
  const blockers = new Map<number, number[]>(s.sessions.map((x) => [x.pid, x.blockingPids]))
  const edgeBudget = config.maxSessions * 8 + 1
  let visitedEdges = 0
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<number, number>()
  const nodeReach = new Map<number, boolean>()
  for (const root of appSessions) {
    // Iterative DFS with explicit stack; each frame tracks its edge iterator.
    const stack: Array<{ pid: number; edges: number[]; i: number }> = [
      { pid: root.pid, edges: blockers.get(root.pid) ?? [], i: 0 },
    ]
    color.set(root.pid, GRAY)
    nodeReach.set(root.pid, false)
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (frame.i >= frame.edges.length) {
        color.set(frame.pid, BLACK)
        stack.pop()
        const parent = stack[stack.length - 1]
        if (parent && nodeReach.get(frame.pid) === true) {
          nodeReach.set(parent.pid, true)
        }
        continue
      }
      const target = frame.edges[frame.i++] as number
      if (++visitedEdges > edgeBudget) return overlapFail('CYCLE')
      if (target === coord.pid) {
        nodeReach.set(frame.pid, true)
        continue
      }
      const targetColor = color.get(target) ?? WHITE
      if (targetColor === GRAY) return overlapFail('CYCLE')
      if (targetColor === WHITE) {
        color.set(target, GRAY)
        nodeReach.set(target, false)
        stack.push({ pid: target, edges: blockers.get(target) ?? [], i: 0 })
      } else if (nodeReach.get(target) === true) {
        // BLACK: fully explored; inherit its coordinator reach.
        nodeReach.set(frame.pid, true)
      }
    }
  }
  if (appSessions.some((x) => nodeReach.get(x.pid) !== true)) {
    return overlapFail('ROOT_NOT_REACHED')
  }

  const [a, b] = appSessions
  const aBlocksOnCoord = a.blockingPids.includes(coord.pid)
  const bBlocksOnCoord = b.blockingPids.includes(coord.pid)
  const aBlocksOnB = a.blockingPids.includes(b.pid)
  const bBlocksOnA = b.blockingPids.includes(a.pid)
  const sortedPids: [number, number] = [a.pid, b.pid].sort((x, y) => x - y) as [number, number]
  if (aBlocksOnCoord && bBlocksOnCoord && !aBlocksOnB && !bBlocksOnA) {
    return {
      ok: true,
      topology: 'DIRECT_BOTH',
      appBackendPids: sortedPids,
      coordinatorPid: coord.pid,
    }
  }
  // Transitive: exactly one backend directly on coordinator, the other on it.
  if (aBlocksOnCoord && bBlocksOnA && !bBlocksOnCoord) {
    return {
      ok: true,
      topology: 'TRANSITIVE',
      appBackendPids: sortedPids,
      coordinatorPid: coord.pid,
    }
  }
  if (bBlocksOnCoord && aBlocksOnB && !aBlocksOnCoord) {
    return {
      ok: true,
      topology: 'TRANSITIVE',
      appBackendPids: sortedPids,
      coordinatorPid: coord.pid,
    }
  }
  return overlapFail('TOPOLOGY_UNSUPPORTED')
}

// ---------------------------------------------------------------------------
// Outcome proof (contract #6): overlap AND actual success AND named category
// ---------------------------------------------------------------------------

export type SourceConflictCategory = 'UNKNOWN'

export type OutcomeProofOk = { ok: true; category: 'FK_UNIQUE' }
export type OutcomeProofFail = {
  ok: false
  reason: 'NO_OVERLAP' | 'NO_ACTUAL_SUCCESS' | 'UNKNOWN_SQL_SHAPE'
  message: string
}
export type OutcomeProof = OutcomeProofOk | OutcomeProofFail

/**
 * Fails closed unless measured overlap AND one actual success AND a
 * source-supported conflict category are all present. Never infers the loser
 * category from HTTP 500, rollback, or snapshot state; unknown Prisma SQL
 * shapes stay UNKNOWN until a later adapter pins fixtures.
 */
import { Buffer } from 'node:buffer'
export function proveOutcome(input: {
  overlapVerified: boolean
  actualSuccess: boolean
  sourceConflictCategory: SourceConflictCategory
}): OutcomeProof {
  if (!input.overlapVerified) {
    return { ok: false, reason: 'NO_OVERLAP', message: T15E_SAFE_ERROR_MESSAGE }
  }
  if (!input.actualSuccess) {
    return { ok: false, reason: 'NO_ACTUAL_SUCCESS', message: T15E_SAFE_ERROR_MESSAGE }
  }
  if (input.sourceConflictCategory === 'UNKNOWN') {
    return { ok: false, reason: 'UNKNOWN_SQL_SHAPE', message: T15E_SAFE_ERROR_MESSAGE }
  }
  return { ok: true, category: 'FK_UNIQUE' }
}
