/**
 * T15E maintenance protocol core (Task121 B1a1) — PURE fixed protocol/script
 * generation, bounded fragment/coalesced demux, and MODELED evidence phases.
 * No injected child, writes, timers, revocation, or cleanup orchestration
 * (B1a2). The modeled SQL output shape is NOT native proof: commit,
 * backend-gone, and issuer acceptance are outside this model; the final
 * transport (B1a2) is the sole acceptance authority. `authority: 'NONE'`
 * everywhere; `backendGoneConfirmed:false` stays a pending outer obligation.
 *
 * Protocol (from the Sol-approved Task120 concretization, static-research
 * backed): argv `-X -A -t -P pager=off -v ON_ERROR_STOP=1 -v
 * ON_ERROR_ROLLBACK=off -v ECHO=none -v ECHO_HIDDEN=off` (NO -q: QUIET is
 * managed per phase; no -c/logfile; piped non-interactive/no banner is a
 * FUTURE factory assumption, not a fake-child proof). Prologue = `\set QUIET
 * on` + internally regenerated canonical prefix + nonce-bound READBACK_ACK
 * SELECT; tails = `\set QUIET off` + COMMIT/ROLLBACK + `\set QUIET on` +
 * corresponding ACK SELECT. The server's ACTUAL command tag (COMMIT\n /
 * ROLLBACK\n) is distinct evidence from the ACK tuple; a ROLLBACK tag with a
 * COMMIT ack is an aborted commit — UNKNOWN, never confirmed.
 */

import { types } from 'node:util'
import { buildT15EMaintenancePrefix } from './t15e-private-maintenance-protocol'
import { parseT15EMaintenanceFrames } from './t15e-maintenance-frame-decoder'
import { validateT15EMaintenanceReadback } from './t15e-maintenance-readback-schema'

export const T15E_MAINT_CORE_SAFE_MESSAGE = 'T15E maintenance protocol failure'
export const T15E_MAINT_CORE_ARGV = Object.freeze([
  '-X', '-A', '-t', '-P', 'pager=off',
  '-v', 'ON_ERROR_STOP=1', '-v', 'ON_ERROR_ROLLBACK=off', '-v', 'ECHO=none', '-v', 'ECHO_HIDDEN=off',
] as const)

export const T15E_MAINT_CORE_MAX_STREAM_BYTES = 512 * 1024 // WHOLE stdout, frames + all ACK/tag lines
export const T15E_MAINT_CORE_MAX_LINE_BYTES = 160 // ACK/tag line bound
/** Model batch fragmentation cap: a chunk batch longer than this is rejected
 * BEFORE traversal (fail-closed fragmentation limit of the pure model; a
 * later live core may coalesce chunks while retaining byte bounds). */
export const T15E_MAINT_CORE_MAX_CHUNKS = 8192

const NONCE_RE = /^[0-9a-f]{64}$/

export type T15EMaintenanceCoreFailureReason =
  | 'INPUT_INVALID'
  | 'SHAPE_INVALID'
  | 'NONCE_INVALID'
  | 'PREFIX_REJECTED'
  | 'STREAM_OVERFLOW'
  | 'ACK_LINE_OVERFLOW'
  | 'DEMUX_INVALID'
  | 'UNKNOWN_TXN'
  | 'EVIDENCE_INVALID'

type Failure<T = Record<string, never>> = { ok: false; authority: 'NONE'; reason: T15EMaintenanceCoreFailureReason; message: string } & T

const fail = <T extends Record<string, unknown>>(reason: T15EMaintenanceCoreFailureReason, extra: T = {} as T): Failure<T> => ({
  ok: false, authority: 'NONE', reason, message: T15E_MAINT_CORE_SAFE_MESSAGE, ...extra,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

export type T15EMaintenanceValidationContext = Readonly<{
  roleName: string
  cluster: { dataDirectory: string; databasePort: number; databaseName: string }
  catalog: { tables: ReadonlyArray<{ schema: string; name: string }>; sequences: ReadonlyArray<{ schema: string; name: string }> }
  nonce: string
}>

/** Clone nested cluster/catalog to PLAIN values once, before validation:
 * EVERY field and array element is captured EXACTLY ONCE (first read wins);
 * array lengths are captured once and bounds-checked BEFORE indexed
 * traversal; loops are INDEXED ONLY (no for..of/map — custom iterators and
 * species are never invoked); throwing getters are a fixed rejection.
 * Bounded known structure only — accessors are not supported, by design. */
class PlainCloneFail extends Error {}

const clonePlainCluster = (value: unknown): { dataDirectory: string; databasePort: number; databaseName: string } | null => {
  try {
    if (!isRecord(value) || !exactKeys(value, ['dataDirectory', 'databasePort', 'databaseName'])) return null
    const directory = value.dataDirectory
    const port = value.databasePort
    const databaseName = value.databaseName
    if (typeof directory !== 'string' || typeof databaseName !== 'string') return null
    if (typeof port !== 'number' || !Number.isSafeInteger(port)) return null
    return { dataDirectory: directory, databasePort: port, databaseName }
  } catch {
    throw new PlainCloneFail()
  }
}

const cloneRelationsIndexed = (array: unknown, bound: number): { schema: string; name: string }[] | null => {
  if (!Array.isArray(array)) return null
  const length = array.length // captured ONCE; bounds BEFORE traversal
  if (!Number.isSafeInteger(length) || length < 0 || length > bound) return null
  const out: { schema: string; name: string }[] = []
  for (let index = 0; index < length; index++) {
    const item = array[index] // single indexed read
    if (!isRecord(item) || !exactKeys(item, ['schema', 'name'])) return null
    const schema = item.schema
    const name = item.name
    if (typeof schema !== 'string' || typeof name !== 'string') return null
    out.push({ schema, name })
  }
  return out
}

const clonePlainCatalog = (value: unknown): { tables: { schema: string; name: string }[]; sequences: { schema: string; name: string }[] } | null => {
  try {
    if (!isRecord(value) || !exactKeys(value, ['tables', 'sequences'])) return null
    const tablesArray = value.tables
    const sequencesArray = value.sequences
    const tables = cloneRelationsIndexed(tablesArray, 64)
    if (tables === null) return null
    const sequences = cloneRelationsIndexed(sequencesArray, 32)
    if (sequences === null) return null
    return { tables, sequences }
  } catch {
    throw new PlainCloneFail()
  }
}

export function buildT15EMaintenanceProtocolScripts(input: unknown):
  | { ok: true; authority: 'NONE'; argv: readonly string[]; prologue: string; commitTail: string; rollbackTail: string; validationContext: T15EMaintenanceValidationContext }
  | Failure {
  try {
    if (!isRecord(input)) return fail('INPUT_INVALID')
  } catch {
    return fail('INPUT_INVALID')
  }
  let shapeOk: boolean
  try {
    shapeOk = exactKeys(input, ['roleName', 'secret', 'cluster', 'catalog', 'nonce'])
  } catch {
    return fail('SHAPE_INVALID')
  }
  if (!shapeOk) return fail('SHAPE_INVALID')
  let roleNameInput: unknown
  let secretInput: unknown
  let clusterInput: unknown
  let catalogInput: unknown
  let nonceInput: unknown
  let plainCluster: ReturnType<typeof clonePlainCluster>
  let plainCatalog: ReturnType<typeof clonePlainCatalog>
  try {
    roleNameInput = input.roleName
    secretInput = input.secret
    clusterInput = input.cluster
    catalogInput = input.catalog
    nonceInput = input.nonce
    plainCluster = clonePlainCluster(clusterInput)
    plainCatalog = clonePlainCatalog(catalogInput)
  } catch {
    // Thrown values are opaque: even instanceof can invoke a proxy trap.
    return fail('INPUT_INVALID')
  }
  if (typeof nonceInput !== 'string' || !NONCE_RE.test(nonceInput)) return fail('NONCE_INVALID')
  if (plainCluster === null || plainCatalog === null) return fail('INPUT_INVALID')
  // Internally regenerate the canonical prefix (validated + captured context
  // used for BOTH prefix and later validation — one immutable snapshot).
  const prefix = buildT15EMaintenancePrefix({ roleName: roleNameInput, secret: secretInput, cluster: plainCluster, catalog: plainCatalog })
  if (!prefix.ok) return fail('PREFIX_REJECTED')
  const nonce = nonceInput
  // The context carries NO secret: the tail decision needs no credential, and
  // returned metadata must not extend the secret's lifetime. The secret lives
  // only in the ephemeral prologue built above (no secure-erasure claim).
  const validationContext: T15EMaintenanceValidationContext = Object.freeze({
    roleName: roleNameInput as string,
    cluster: Object.freeze({ ...plainCluster }),
    catalog: Object.freeze({
      tables: Object.freeze(plainCatalog.tables.map((t) => Object.freeze({ ...t }))),
      sequences: Object.freeze(plainCatalog.sequences.map((s) => Object.freeze({ ...s }))),
    }),
    nonce,
  })
  return {
    ok: true,
    authority: 'NONE',
    argv: T15E_MAINT_CORE_ARGV,
    prologue: `\\set QUIET on\n${prefix.stdin}select 'T15E_MAINT_ACK_READBACK_${nonce}';\n`,
    commitTail: `\\set QUIET off\nCOMMIT;\n\\set QUIET on\nselect 'T15E_MAINT_ACK_COMMIT_${nonce}';\n`,
    rollbackTail: `\\set QUIET off\nROLLBACK;\n\\set QUIET on\nselect 'T15E_MAINT_ACK_ROLLBACK_${nonce}';\n`,
    validationContext,
  }
}

const readbackAckLine = (nonce: string): Buffer => Buffer.from(`T15E_MAINT_ACK_READBACK_${nonce}\n`, 'utf8')

// Trusted intrinsic metadata getters (shared TypedArray-prototype accessors,
// captured ONCE at module load — the accepted frame-decoder pattern): chunk
// OWN/prototype shadow getters are never consulted.
const intrinsicTypedArrayGetter = (name: 'byteLength' | 'byteOffset' | 'buffer'): ((this: Uint8Array) => unknown) => {
  let proto: object | null = Uint8Array.prototype
  while (proto !== null) {
    const desc = Object.getOwnPropertyDescriptor(proto, name)
    if (desc !== undefined && typeof desc.get === 'function') return desc.get as (this: Uint8Array) => unknown
    proto = Object.getPrototypeOf(proto)
  }
  throw new Error('SAFETY: intrinsic Uint8Array metadata getters unavailable')
}
const INTRINSIC_BYTE_LENGTH = intrinsicTypedArrayGetter('byteLength') as (this: Uint8Array) => number
const INTRINSIC_BYTE_OFFSET = intrinsicTypedArrayGetter('byteOffset') as (this: Uint8Array) => number
const INTRINSIC_BUFFER = intrinsicTypedArrayGetter('buffer') as (this: Uint8Array) => ArrayBufferLike

/** Bounded fragment/coalesced demux: exact 6-frame span + separate READBACK_ACK
 * line. Capacity is checked BEFORE any copy; the ENTIRE chunk set is
 * assembled and parsed before publishing a snapshot, so a valid ACK with
 * coalesced garbage cannot briefly pass. No whitespace tolerance, no dropping
 * of extra/stale/duplicate bytes. */
export function demuxT15EMaintenanceReadback(chunks: unknown, nonce: string):
  | { ok: true; frames: Buffer; readbackAck: string }
  | Failure {
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return fail('NONCE_INVALID')
  // Contained recognition: the initial array probe, length capture, brand
  // checks, metadata capture, and copy are ALL guarded — revoked proxies,
  // throwing index getters, exotic hooks, and detached buffers are fixed
  // failures with the raw throw/value discarded, never raw exceptions.
  try {
    if (!Array.isArray(chunks)) return fail('DEMUX_INVALID')
    const chunkCount = chunks.length // captured ONCE
    if (!Number.isSafeInteger(chunkCount) || chunkCount < 0 || chunkCount > T15E_MAINT_CORE_MAX_CHUNKS) {
      return fail('DEMUX_INVALID')
    }
    if (chunkCount === 0) return fail('DEMUX_INVALID')
    // Trusted per-chunk metadata (intrinsic brand + shared TypedArray
    // getters) and WHOLE-stream capacity BEFORE any snapshot copy. Indexed
    // access only — custom iterators are never invoked.
    let total = 0
    const spans: Array<{ buffer: ArrayBufferLike; offset: number; length: number }> = []
    for (let index = 0; index < chunkCount; index++) {
      const chunk = chunks[index] // single indexed read
      if (typeof chunk !== 'object' || chunk === null || !types.isUint8Array(chunk)) return fail('DEMUX_INVALID')
      const byteLength = INTRINSIC_BYTE_LENGTH.call(chunk)
      const byteOffset = INTRINSIC_BYTE_OFFSET.call(chunk)
      const buffer = INTRINSIC_BUFFER.call(chunk)
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) return fail('DEMUX_INVALID')
      // A single chunk already larger than the WHOLE-stream bound is an
      // overflow (classified before any copy), not a grammar failure.
      if (byteLength > T15E_MAINT_CORE_MAX_STREAM_BYTES) return fail('STREAM_OVERFLOW')
      if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) return fail('DEMUX_INVALID')
      if (buffer === null || typeof buffer !== 'object') return fail('DEMUX_INVALID')
      total += byteLength
      if (total > T15E_MAINT_CORE_MAX_STREAM_BYTES) return fail('STREAM_OVERFLOW')
      spans.push({ buffer, offset: byteOffset, length: byteLength })
    }
    // Copy ONLY after the aggregate bound holds: fresh native views over the
    // captured bounded spans (no chunk hooks, no alias of caller output).
    const raw = Buffer.concat(spans.map((span) => Buffer.from(new Uint8Array(span.buffer, span.offset, span.length))))
    return demuxParseSnapshot(raw, nonce)
  } catch {
    return fail('DEMUX_INVALID')
  }
}

/** Grammar walk over the already-copied snapshot (unchanged Task121 rules). */
const demuxParseSnapshot = (raw: Buffer, nonce: string):
  | { ok: true; frames: Buffer; readbackAck: string }
  | Failure => {
  // Exact 6-frame span: walk the fixed grammar byte-exactly (mirrors the
  // decoder's rules) to find the span END, then require the ACK line and EOF.
  const ack = readbackAckLine(nonce)
  let pos = 0
  for (let n = 1; n <= 6; n++) {
    const begin = Buffer.from(`T15E_MAINT_S${n}_B\n`, 'utf8')
    const end = Buffer.from(`\nT15E_MAINT_S${n}_E:`, 'utf8')
    if (raw.byteLength < pos + begin.length || !raw.subarray(pos, pos + begin.length).equals(begin)) return fail('DEMUX_INVALID')
    pos += begin.length
    let endAt = -1
    outer: for (let i = pos; i + end.length <= raw.length; i++) {
      for (let j = 0; j < end.length; j++) {
        if (raw[i + j] !== end[j]) continue outer
      }
      endAt = i
      break
    }
    if (endAt < 0) return fail('DEMUX_INVALID')
    let digitsEnd = endAt + end.length
    while (digitsEnd < raw.length && raw[digitsEnd] !== 0x0a) digitsEnd++
    if (digitsEnd >= raw.length) return fail('DEMUX_INVALID')
    const digits = raw.subarray(endAt + end.length, digitsEnd)
    if (digits.length === 0 || digits.length > 15 || (digits[0] === 0x30 && digits.length > 1)) return fail('DEMUX_INVALID')
    for (let i = 0; i < digits.length; i++) if (digits[i] < 0x30 || digits[i] > 0x39) return fail('DEMUX_INVALID')
    if (Number(digits.toString('ascii')) !== endAt - pos) return fail('DEMUX_INVALID') // payload byte length
    pos = digitsEnd + 1
  }
  // After the frames' terminal LF: exactly the ACK line, then EOF. An
  // oversized trailing line fails the LINE bound before any retain attempt.
  const remainder = raw.byteLength - pos
  if (remainder > T15E_MAINT_CORE_MAX_LINE_BYTES) return fail('ACK_LINE_OVERFLOW')
  if (remainder !== ack.byteLength) return fail('DEMUX_INVALID')
  if (!raw.subarray(pos).equals(ack)) return fail('DEMUX_INVALID')
  // ACK line is bounded by construction (grammar) — enforce the fixed line
  // bound anyway before returning it.
  if (ack.byteLength > T15E_MAINT_CORE_MAX_LINE_BYTES) return fail('ACK_LINE_OVERFLOW')
  // The extracted span must itself pass the approved decoder (strict UTF-8,
  // payload bounds, full grammar) — belt and braces, single authority.
  const frames = raw.subarray(0, pos)
  const decoded = parseT15EMaintenanceFrames(frames)
  if (!decoded.ok) return fail('DEMUX_INVALID')
  return { ok: true, frames: Buffer.from(frames), readbackAck: `T15E_MAINT_ACK_READBACK_${nonce}` }
}

/** Modeled tail decision from a HEALTHY, complete readback: the approved full
 * validator runs with sqlOk:true MODELED from the complete frames + ACK phase
 * (never a caller boolean). Valid facts => COMMIT tail; healthy-but-invalid
 * facts => fixed ROLLBACK request; malformed frames/protocol => UNKNOWN txn
 * (no tail assumed valid — ON_ERROR_STOP makes rollback unprovable). */
/** Modeled tail decision. The ENTIRE supplied chunk batch is demuxed
 * INTERNALLY against the captured nonce BEFORE the frames reach the
 * validator: a bare 6-frame batch without the READBACK_ACK can never COMMIT,
 * and wrong/stale/extra/coalesced-garbage ACK evidence leaves the transaction
 * UNKNOWN with no tail. `sqlOk:true` is MODELED from the complete frames +
 * ACK phase — never a caller boolean. ROLLBACK is eligible ONLY for a
 * healthy, complete ACK readback that passes framing/JSON/exact-schema and
 * is then rejected by the APPROVED FACT VALIDATOR (reason VALIDATOR_REJECTED
 * with its specific safe category); identity/schema/JSON/frame/plan/status
 * failures stay UNKNOWN. On ROLLBACK the validator failure is reported
 * TRUTHFULLY — never an unsafe ok:true with null facts. */
export function decideT15EMaintenanceTail(input: {
  scripts: { ok: true; validationContext: T15EMaintenanceValidationContext }
  chunks: unknown
}):
  | ({ ok: true; authority: 'NONE'; tail: 'COMMIT' | 'ROLLBACK'; readback: { ok: true; identity: unknown; facts: unknown } | { ok: false; category: string; reason: string; facts: null; identity: null } })
  | Failure {
  const context = input.scripts.validationContext
  const demuxed = demuxT15EMaintenanceReadback(input.chunks, context.nonce)
  if (!demuxed.ok) return fail('UNKNOWN_TXN') // missing/wrong/stale/extra ACK or malformed frames
  const readback = validateT15EMaintenanceReadback({
    roleName: context.roleName,
    cluster: context.cluster,
    catalog: context.catalog,
    frames: demuxed.frames,
    sqlOk: true, // MODELED from the complete frame + ACK phase — not caller data
  })
  if (readback.ok) {
    return { ok: true, authority: 'NONE', tail: 'COMMIT', readback: { ok: true, identity: readback.identity, facts: readback.facts } }
  }
  if (readback.reason === 'VALIDATOR_REJECTED') {
    return {
      ok: true,
      authority: 'NONE',
      tail: 'ROLLBACK',
      readback: { ok: false, category: readback.category, reason: readback.reason, facts: null, identity: null },
    }
  }
  return fail('UNKNOWN_TXN') // schema/identity/JSON/frame/plan/status failure — no tail
}

export type T15EMaintenanceTailEvidence = Readonly<{
  outcome:
    | 'COMMIT_CONFIRMED'
    | 'ROLLBACK_CONFIRMED'
    | 'UNKNOWN_COMMIT_NOT_CONFIRMED'
    | 'UNKNOWN_EVIDENCE_INVALID'
    | 'UNKNOWN_PHASE_MISMATCH'
  authority: 'NONE'
  tag: 'COMMIT' | 'ROLLBACK' | null
  historicalOnly: true
}>

/** MODELED tail evidence: the ACTUAL server tag line and the phase ACK line
 * are SEPARATE evidence; both must match the declared phase. A ROLLBACK tag
 * with a COMMIT ack (aborted commit) is UNKNOWN — never confirmed. The
 * result is a frozen point-in-time historical snapshot: later inputs cannot
 * mutate it, and it is never an issuer acceptance or backend-gone proof.
 * Accepted input shape (documented contract, exact keys): { nonce, expected:
 * 'COMMIT' | 'ROLLBACK', tagLine, ackLine }. */
export function modelT15EMaintenanceTail(input: unknown): T15EMaintenanceTailEvidence {
  const evidence = (outcome: T15EMaintenanceTailEvidence['outcome'], tag: 'COMMIT' | 'ROLLBACK' | null): T15EMaintenanceTailEvidence =>
    Object.freeze({ outcome, authority: 'NONE', tag, historicalOnly: true })
  // All fields are captured EXACTLY ONCE inside a contained boundary: exotic
  // inputs (revoked proxies, throwing getters) map to a fixed UNKNOWN with
  // the raw throw discarded — never a raw exception.
  let nonce: unknown
  let expected: unknown
  let tagLine: unknown
  let ackLine: unknown
  let shapeOk: boolean
  try {
    const record = input as Record<string, unknown>
    if (!isRecord(input)) return evidence('UNKNOWN_EVIDENCE_INVALID', null)
    shapeOk = exactKeys(record, ['nonce', 'expected', 'tagLine', 'ackLine'])
    nonce = record.nonce
    expected = record.expected
    tagLine = record.tagLine
    ackLine = record.ackLine
  } catch {
    return evidence('UNKNOWN_EVIDENCE_INVALID', null)
  }
  if (!shapeOk) return evidence('UNKNOWN_EVIDENCE_INVALID', null)
  // The declared phase is a CLOSED union validated BEFORE any branch or ACK
  // interpretation — a divergent or invalid `expected` can never reach a
  // CONFIRMED outcome.
  if (expected !== 'COMMIT' && expected !== 'ROLLBACK') return evidence('UNKNOWN_EVIDENCE_INVALID', null)
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return evidence('UNKNOWN_EVIDENCE_INVALID', null)
  if (typeof tagLine !== 'string' || typeof ackLine !== 'string') return evidence('UNKNOWN_EVIDENCE_INVALID', null)
  if (Buffer.byteLength(tagLine, 'utf8') > T15E_MAINT_CORE_MAX_LINE_BYTES) return evidence('UNKNOWN_EVIDENCE_INVALID', null)
  if (Buffer.byteLength(ackLine, 'utf8') > T15E_MAINT_CORE_MAX_LINE_BYTES) return evidence('UNKNOWN_EVIDENCE_INVALID', null)
  const tagOk = tagLine === 'COMMIT\n' || tagLine === 'ROLLBACK\n'
  if (!tagOk) return evidence('UNKNOWN_EVIDENCE_INVALID', null)
  const tag = tagLine === 'COMMIT\n' ? 'COMMIT' : 'ROLLBACK'
  const ackOk = ackLine === `T15E_MAINT_ACK_${expected}_${nonce}\n`
  if (!ackOk) return evidence('UNKNOWN_PHASE_MISMATCH', null)
  if (expected === 'COMMIT') {
    return tag === 'COMMIT'
      ? evidence('COMMIT_CONFIRMED', 'COMMIT')
      : evidence('UNKNOWN_COMMIT_NOT_CONFIRMED', 'ROLLBACK') // aborted commit — server rewrote the tag
  }
  return tag === 'ROLLBACK'
    ? evidence('ROLLBACK_CONFIRMED', 'ROLLBACK')
    : evidence('UNKNOWN_PHASE_MISMATCH', 'COMMIT')
}
