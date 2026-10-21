/**
 * T15E maintenance readback collector (Task132 B1a2b) — PURE test-domain
 * incremental phase-byte collector for the READBACK phase only, implementing
 * the Sol-approved Task131 contract (APPROVE_B1A2B_READBACK_ONLY_CONTRACT).
 *
 * Scope: intrinsic byte input capture, bounded PRIVATE owned accumulation,
 * incremental exact six-frame + 64-lowercase-hex-nonce READBACK ACK
 * recognition, UNCHANGED `demuxT15EMaintenanceReadback` completion authority,
 * frozen scalar METADATA snapshots with a permanent first-failure latch
 * independent of lifecycle, fresh CALLER-OWNED defensive span copies (no
 * frozen-byte claim), and terminal disposal without rebuild.
 *
 * NOT here (later reviewed gates): tail collection, any stderr handling
 * (B1a2c must still enforce cumulative all-phase 512 KiB stdout and 4 KiB
 * nonempty STDERR_PRESENT fencing), timers/wait-helper, child/runtime
 * adapters, spawn, factory, monitor, mint, issuer, env adoption. Data only:
 * `authority: 'NONE'` everywhere; no SQL/authentication/commit/backend-
 * disappearance acceptance exists in this model.
 *
 * Deliberate reason-precedence divergence (contract §7): the incremental
 * cursor rejects a mismatching ACK byte EARLIER than the batch demux's
 * `ACK_LINE_OVERFLOW`-before-equality check — accept/reject decisions remain
 * identical; only failure-reason precedence differs.
 *
 * Detached inputs (Task133 repair): the contained fresh native-view
 * construction over the captured span throws on a detached backing buffer
 * even at length zero (the approved decoder's own containment pattern), so
 * detached views latch INPUT_INVALID permanently per contract §5/case 10;
 * genuine empty views remain accepted no-ops.
 */

import { types } from 'node:util'
import { demuxT15EMaintenanceReadback, T15E_MAINT_CORE_MAX_STREAM_BYTES } from './t15e-maintenance-protocol-core'
import { T15E_MAINT_FRAME_MAX_SECTION_BYTES } from './t15e-maintenance-frame-decoder'

export const T15E_MAINT_READBACK_COLLECTOR_SAFE_MESSAGE = 'T15E maintenance readback collector failure'

/** Documented mirror of the private protocol-core nonce regex (64 lowercase hex). */
const NONCE_RE = /^[0-9a-f]{64}$/
const MAX_STREAM = T15E_MAINT_CORE_MAX_STREAM_BYTES
const MAX_SECTION = T15E_MAINT_FRAME_MAX_SECTION_BYTES
const SATURATE = Number.MAX_SAFE_INTEGER
const LF = 0x0a

export type T15EMaintenanceReadbackFailureReason =
  | 'INPUT_INVALID' | 'NONCE_INVALID' | 'STREAM_OVERFLOW' | 'SECTION_OVERFLOW'
  | 'READBACK_MALFORMED' | 'OUT_OF_PHASE'

export type T15EMaintenanceReadbackSnapshot = Readonly<{
  authority: 'NONE'
  failure: T15EMaintenanceReadbackFailureReason | null
  readbackComplete: boolean
  ended: boolean
  disposed: boolean
  stdoutBytes: number   // cumulative accepted bytes (readback-local; NOT the future cross-phase enforcement)
  events: number        // recognized pushStdout count incl. zero-length (saturating)
  lateInputs: number    // absorbed post-terminal pushes (saturating)
}>

export interface T15EMaintenanceReadbackCollector {
  pushStdout(chunk: unknown): void
  end(): void
  dispose(): void
  snapshot(): T15EMaintenanceReadbackSnapshot
  readbackSpan(): Buffer | null
}

type Failure = { ok: false; authority: 'NONE'; reason: 'INPUT_INVALID' | 'NONCE_INVALID'; message: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

// Trusted intrinsic metadata getters, captured ONCE at module load from the
// shared TypedArray prototype (the accepted decoder/demux pattern): own and
// prototype-chain SHADOW getters on a genuine view are never consulted — the
// real intrinsic length controls overflow, and the copy cannot be redirected
// at foreign memory.
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

const saturatingAdd = (a: number, b: number): number => (a + b > SATURATE ? SATURATE : a + b)

export function createT15EMaintenanceReadbackCollector(input: unknown):
  | { ok: true; authority: 'NONE'; collector: T15EMaintenanceReadbackCollector }
  | Failure {
  // Contained creation capture: shape probe before ANY value read; throwing
  // getters / revoked proxies / extra keys are fixed INPUT_INVALID with the
  // raw throw discarded (never inspected, never surfaced).
  let nonceInput: unknown
  try {
    if (!isRecord(input)) return failCreate('INPUT_INVALID')
    if (!exactKeys(input, ['nonce'])) return failCreate('INPUT_INVALID')
    nonceInput = input.nonce
  } catch {
    return failCreate('INPUT_INVALID')
  }
  if (typeof nonceInput !== 'string' || !NONCE_RE.test(nonceInput)) return failCreate('NONCE_INVALID')
  const nonce = nonceInput

  // Fixed grammar tables, built once from the captured nonce (grammar from
  // the approved sources; never invented here).
  const beginMarkers: Buffer[] = []
  const endMarkers: Buffer[] = []
  for (let n = 1; n <= 6; n++) {
    beginMarkers.push(Buffer.from(`T15E_MAINT_S${n}_B\n`, 'utf8'))
    endMarkers.push(Buffer.from(`\nT15E_MAINT_S${n}_E:`, 'utf8'))
  }
  const ackLine = Buffer.from(`T15E_MAINT_ACK_READBACK_${nonce}\n`, 'utf8')

  // Independent lifecycle facts (contract §3): the FIRST failure is a one-way
  // latch preserved through every end/dispose order and repeat; ended and
  // disposed are independent one-way latches; none of them erases another.
  let failure: T15EMaintenanceReadbackFailureReason | null = null
  let readbackComplete = false
  let ended = false
  let disposed = false
  let events = 0
  let lateInputs = 0
  let stdoutBytes = 0

  // PRIVATE owned accumulation: one growing owned store with a monotonic
  // write cursor. No per-event chunk retention, no event list. Per-event work
  // is O(chunk bytes + carry): the grammar cursor advances monotonically with
  // a bounded deferred-marker carry and never rescans the accumulated span.
  let store: Buffer | null = Buffer.alloc(1024)
  let writeCursor = 0
  let spanLength = 0

  // Grammar cursor state (all bounded).
  type Mode = 'BEGIN' | 'PAYLOAD' | 'TRAILER' | 'ACK' | 'DONE'
  let mode: Mode = 'BEGIN'
  let section = 1
  let beginPos = 0
  let endMatchPos = 0
  let deferred: number[] = [] // payload-candidate bytes, < end-marker length
  let payloadCount = 0        // committed payload bytes of the current section
  let digits: number[] = []   // trailer digits accumulator, <= 16 bytes
  let ackPos = 0

  const latch = (reason: T15EMaintenanceReadbackFailureReason): void => {
    if (failure === null) failure = reason // first failure wins, permanently
  }

  /** Commit n payload bytes of the current section: bound BEFORE growth. */
  const commitPayload = (count: number): boolean => {
    if (payloadCount + count > MAX_SECTION) {
      latch('SECTION_OVERFLOW')
      return false
    }
    payloadCount += count
    return true
  }

  const validateTrailer = (): boolean => {
    if (digits.length === 0 || digits.length > 15) return false
    if (digits[0] === 0x30 && digits.length > 1) return false // no leading zeros
    let value = 0
    for (const byte of digits) {
      if (byte < 0x30 || byte > 0x39) return false
      value = value * 10 + (byte - 0x30)
    }
    return Number.isSafeInteger(value) && value === payloadCount // exact octet count
  }

  /** Process one byte of the grammar. Returns false once a failure latched. */
  const consumeByte = (byte: number): boolean => {
    if (mode === 'DONE') {
      // Cursor already completed the ACK inside THIS chunk: any further byte
      // is same-chunk garbage — reject closed, never held for a future phase.
      latch('READBACK_MALFORMED')
      return false
    }
    if (mode === 'BEGIN') {
      const begin = beginMarkers[section - 1]
      if (byte !== begin[beginPos]) {
        latch('READBACK_MALFORMED')
        return false
      }
      appendByte(byte)
      beginPos += 1
      if (beginPos === begin.length) {
        mode = 'PAYLOAD'
        endMatchPos = 0
        deferred = []
        payloadCount = 0
      }
      return true
    }
    if (mode === 'PAYLOAD') {
      const end = endMarkers[section - 1]
      if (byte === end[endMatchPos]) {
        deferred.push(byte)
        endMatchPos += 1
        if (endMatchPos === end.length) {
          // End marker completed: the deferred bytes are MARKER bytes, not
          // payload — appended unconditionally in stream order (marker bytes
          // are not subject to the section bound). (The marker's only LF is
          // its first byte, so on mismatch the only possible fresh candidate
          // start is the mismatching byte itself — handled below.)
          for (const deferredByte of deferred) appendByte(deferredByte)
          deferred = []
          endMatchPos = 0
          mode = 'TRAILER'
          digits = []
        }
        return true
      }
      if (endMatchPos > 0) {
        // Match broke: the deferred candidate bytes ARE payload bytes — the
        // section bound is enforced BEFORE they are grown/appended.
        const flushBytes = deferred
        deferred = []
        endMatchPos = 0
        if (!commitPayload(flushBytes.length)) return false
        for (const deferredByte of flushBytes) appendByte(deferredByte)
      }
      if (byte === end[0]) {
        deferred.push(byte)
        endMatchPos = 1
        return true
      }
      if (!commitPayload(1)) return false // bound BEFORE the append of this byte
      appendByte(byte)
      return true
    }
    if (mode === 'TRAILER') {
      if (byte === LF) {
        if (!validateTrailer()) {
          latch('READBACK_MALFORMED')
          return false
        }
        appendByte(byte)
        if (section < 6) {
          section += 1
          mode = 'BEGIN'
          beginPos = 0
        } else {
          mode = 'ACK'
          ackPos = 0
        }
        return true
      }
      // Immediate definitive-prefix rejection (Task133 P2-1 + Task134 P1):
      // EVERY non-LF trailer byte must be an ASCII digit — validated
      // BEFORE append, at every digit position (not only the first); a
      // leading-zero continuation and a 16th digit are likewise definitive
      // at that byte (corrected timing: the 16th digit byte itself rejects).
      if (byte < 0x30 || byte > 0x39) {
        latch('READBACK_MALFORMED')
        return false
      }
      if (digits.length > 0 && (digits[0] === 0x30 || digits.length >= 15)) {
        latch('READBACK_MALFORMED') // leading-zero continuation / 16th digit
        return false
      }
      digits.push(byte)
      appendByte(byte)
      return true
    }
    // ACK mode: exact fixed-line match. A mismatching byte rejects EARLIER
    // than the batch's ACK_LINE_OVERFLOW-before-equality precedence — the
    // disclosed deliberate divergence; accept/reject decisions are identical.
    if (byte !== ackLine[ackPos]) {
      latch('READBACK_MALFORMED')
      return false
    }
    ackPos += 1
    appendByte(byte)
    if (ackPos === ackLine.length) mode = 'DONE'
    return true
  }

  const growStore = (needed: number): void => {
    const current = store
    if (current === null || needed <= current.length) return
    let next = current.length * 2
    while (next < needed) next *= 2
    // Bounded: the event-level precheck guarantees needed <= MAX_STREAM, and
    // doubling from 1024 never exceeds 524288 (= MAX_STREAM).
    const grown = Buffer.alloc(next)
    current.copy(grown, 0, 0, writeCursor)
    store = grown
  }

  /** Append one ACCEPTED byte to the private store (lazy bounded growth);
   * stdoutBytes counts accepted/appended bytes only, so an overflow rejects
   * BEFORE the corresponding byte is grown or appended (Task133 P1-2). */
  const appendByte = (byte: number): void => {
    if (store === null || writeCursor >= store.length) growStore(writeCursor + 1)
    const current = store
    if (current === null) return // unreachable while not disposed
    current[writeCursor] = byte
    writeCursor += 1
    stdoutBytes = saturatingAdd(stdoutBytes, 1)
  }

  const collector: T15EMaintenanceReadbackCollector = {
    pushStdout(chunk: unknown): void {
      // Rule 1 — absorbed post-terminal input: NOT recognized or read at all.
      if (failure !== null || ended || disposed) {
        lateInputs = saturatingAdd(lateInputs, 1)
        return
      }
      // Rule 2 — contained recognition through trusted intrinsics only.
      let byteLength: number
      let byteOffset: number
      let buffer: ArrayBufferLike
      let chunkView: Uint8Array
      try {
        if (typeof chunk !== 'object' || chunk === null || !types.isUint8Array(chunk)) {
          latch('INPUT_INVALID')
          return
        }
        const view = chunk as Uint8Array
        byteLength = INTRINSIC_BYTE_LENGTH.call(view)
        byteOffset = INTRINSIC_BYTE_OFFSET.call(view)
        buffer = INTRINSIC_BUFFER.call(view)
        if (!Number.isSafeInteger(byteLength) || byteLength < 0) { latch('INPUT_INVALID'); return }
        if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) { latch('INPUT_INVALID'); return }
        if (buffer === null || typeof buffer !== 'object') { latch('INPUT_INVALID'); return }
        // Contained fresh native-view construction over the captured span
        // (the approved decoder's own pattern): a DETACHED backing buffer
        // throws here EVEN AT LENGTH ZERO => fixed INPUT_INVALID (contract
        // §5 / Task133 P1-1); a genuine empty view constructs fine. No chunk
        // hooks, no caller alias. Shared-memory event copying is NOT an
        // authenticated atomic observation — one bounded event-time read.
        chunkView = new Uint8Array(buffer, byteOffset, byteLength)
      } catch {
        latch('INPUT_INVALID') // raw throw discarded opaquely, never inspected
        return
      }
      events = saturatingAdd(events, 1)
      // Rule 3 — genuine zero-trusted-length chunk: accepted no-op (a
      // detached view already threw at the construction above).
      if (byteLength === 0) return
      // Rule 4 — remaining capacity BEFORE any growth/copy of this chunk.
      if (byteLength > MAX_STREAM) { latch('STREAM_OVERFLOW'); return }
      if (writeCursor + byteLength > MAX_STREAM) { latch('STREAM_OVERFLOW'); return } // defensive cumulative invariant
      // Rule 5 — nonzero stdout at a non-terminal collector whose readback
      // already completed: out of phase, never held for a future command.
      if (readbackComplete) { latch('OUT_OF_PHASE'); return }
      if (store === null) { latch('INPUT_INVALID'); return } // unreachable while not disposed; fail closed
      // Rule 6 — cursor-process the ENTIRE chunk under the per-byte append
      // discipline: the section bound is enforced BEFORE the corresponding
      // byte is grown/appended (Task133 P1-2 — no whole-event bulk copy);
      // completion is recognized only at chunk end.
      for (let index = 0; index < byteLength; index++) {
        if (!consumeByte(chunkView[index])) return
      }
      if (mode === 'DONE' && !readbackComplete) {
        const owned = store
        if (owned === null) { latch('INPUT_INVALID'); return }
        // Completion authority (contract §7): the UNCHANGED batch demux runs
        // once over the single coalesced owned span — belt and braces, single
        // authority; UTF-8/NUL validity is decided ONLY here.
        spanLength = writeCursor
        const demuxed = demuxT15EMaintenanceReadback([owned.subarray(0, spanLength)], nonce)
        if (demuxed.ok) {
          readbackComplete = true
        } else {
          latch('READBACK_MALFORMED')
        }
      }
    },
    end(): void {
      // Absorbed no-op after disposal (Task133 P1-3): `ended` records an
      // EFFECTIVE accepted end BEFORE disposal; disposal absorbs later
      // calls. Never clears or replaces a latched failure.
      if (disposed) return
      ended = true
    },
    dispose(): void {
      // Release private byte storage honestly (no physical-erasure claim).
      // Previously returned caller-owned copies persist outside ownership.
      disposed = true
      store = null
      deferred = []
      digits = []
    },
    snapshot(): T15EMaintenanceReadbackSnapshot {
      // Fresh frozen SCALAR container per call; earlier snapshots never mutate.
      return Object.freeze({
        authority: 'NONE',
        failure,
        readbackComplete,
        ended,
        disposed,
        stdoutBytes,
        events,
        lateInputs,
      })
    },
    readbackSpan(): Buffer | null {
      if (!readbackComplete || disposed) return null
      const current = store
      if (current === null) return null
      // FRESH caller-owned defensive copy per call, from PRIVATE storage;
      // never a frozen-byte claim; never an alias; no rebuild after disposal.
      return Buffer.from(current.subarray(0, spanLength))
    },
  }

  return { ok: true, authority: 'NONE', collector: Object.freeze(collector) }
}

const failCreate = (reason: 'INPUT_INVALID' | 'NONCE_INVALID'): Failure => ({
  ok: false, authority: 'NONE', reason, message: T15E_MAINT_READBACK_COLLECTOR_SAFE_MESSAGE,
})
