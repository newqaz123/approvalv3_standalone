/**
 * T15E maintenance frame decoder (Task117) — FIRST PART of the bounded PURE
 * decoder: strict RAW-BYTE six-section framing, UTF-8 validity, and size
 * bounds ONLY.
 *
 * Out of scope (Task118): JSON duplicate-key handling, exact-schema mapping,
 * and the complete fact validator. Framing acceptance here is NOT fact
 * acceptance, and nothing in this module establishes sqlOk, commit, or role
 * authority — the module returns data only, `authority: 'NONE'`.
 *
 * Grammar (from the approved sibling builder): sections S1..S6 in fixed
 * order, `T15E_MAINT_S<n>_B\n<payload>\nT15E_MAINT_S<n>_E:<octets>`, joined
 * by EXACTLY ONE LF, with EXACTLY ONE terminal LF after S6_E (the psql
 * record terminator). <octets> is the UTF-8 octet length of the SAME payload
 * bytes. Marker matching is exact-byte with no whitespace tolerance. A
 * marker-looking sequence inside a payload is never accepted as framing
 * unless the WHOLE stream still forms exactly S1..S6 with coherent trailers.
 *
 * Input recognition uses Node's intrinsic brand check and trusted internal-
 * slot metadata (captured once); the 512 KiB aggregate bound runs BEFORE the
 * bounded-span snapshot copy. Bounds are enforced on RAW BYTE COUNTS before
 * any retained copies: every
 * section payload <= 64 KiB and the total stream <= 512 KiB. Parsing is
 * all-or-nothing — no partial success, no truncation tolerance. The input is
 * snapshotted (copied) before parsing, so later caller mutations cannot
 * alter published strings.
 */

import { types } from 'node:util'

export const T15E_MAINT_FRAME_SAFE_MESSAGE = 'T15E maintenance frame failure'
export const T15E_MAINT_FRAME_MAX_SECTION_BYTES = 64 * 1024
export const T15E_MAINT_FRAME_MAX_TOTAL_BYTES = 512 * 1024

export type T15EMaintenanceFrameFailureCategory = 'T15E_MAINT_FRAME_INVALID'
export type T15EMaintenanceFrameReason =
  | 'INPUT_INVALID'
  | 'STREAM_OVERFLOW'
  | 'SECTION_OVERFLOW'
  | 'MARKER_INVALID'
  | 'TRAILER_INVALID'
  | 'LENGTH_MISMATCH'
  | 'UTF8_INVALID'
  | 'NUL_BYTE'
  | 'EXTRA_BYTES'

export type T15EMaintenanceFrameFailure = {
  ok: false
  authority: 'NONE'
  category: T15EMaintenanceFrameFailureCategory
  reason: T15EMaintenanceFrameReason
  message: string
  sections: null
}

export type T15EMaintenanceFrameParse = {
  ok: true
  authority: 'NONE'
  /** Frozen container of immutable payload STRING copies (post-bounds). */
  sections: Readonly<ReadonlyArray<string>>
  sectionOrder: Readonly<ReadonlyArray<string>>
}

const SECTION_NAMES = Object.freeze([
  'role_identity',
  'effective_privileges',
  'table_privileges',
  'sequence_privileges',
  'unpinned_accessible',
  'function_grants',
] as const)

const beginMarker = (n: number): Buffer => Buffer.from(`T15E_MAINT_S${n}_B\n`, 'utf8')
const endMarker = (n: number): Buffer => Buffer.from(`\nT15E_MAINT_S${n}_E:`, 'utf8')

function fail(reason: T15EMaintenanceFrameReason): T15EMaintenanceFrameFailure {
  return {
    ok: false,
    authority: 'NONE',
    category: 'T15E_MAINT_FRAME_INVALID',
    reason,
    message: T15E_MAINT_FRAME_SAFE_MESSAGE,
    sections: null,
  }
}

/** Byte-exact indexOf for a (short) needle buffer. -1 when absent. */
function indexOfBytes(haystack: Buffer, needle: Buffer, from: number): number {
  outer: for (let i = from; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/** Canonical bounded digits: no leading zeros (except "0"), safe integer. */
function parseTrailerDigits(bytes: Buffer, start: number, end: number): number | null {
  if (end <= start || end - start > 15) return null
  if (bytes[start] === 0x30 /* '0' */ && end - start > 1) return null
  let value = 0
  for (let i = start; i < end; i++) {
    const digit = bytes[i]
    if (digit < 0x30 || digit > 0x39) return null
    value = value * 10 + (digit - 0x30)
  }
  if (!Number.isSafeInteger(value)) return null
  return value
}

// Trusted intrinsic metadata getters, captured ONCE at module load: subclass
// shadow getters for byteLength/byteOffset/buffer can never misdirect the
// size or redirect the copy at foreign memory — these read internal slots.
function intrinsicTypedArrayGetter(name: 'byteLength' | 'byteOffset' | 'buffer'): ((this: Uint8Array) => unknown) | undefined {
  // byteLength/byteOffset/buffer are accessor properties on the SHARED
  // TypedArray prototype (inherited by Uint8Array.prototype) — walk up to
  // find the intrinsic own getters.
  let proto: object | null = Uint8Array.prototype
  while (proto !== null) {
    const desc = Object.getOwnPropertyDescriptor(proto, name)
    if (desc !== undefined && typeof desc.get === 'function') return desc.get as (this: Uint8Array) => unknown
    proto = Object.getPrototypeOf(proto)
  }
  return undefined
}
const INTRINSIC_BYTE_LENGTH: (this: Uint8Array) => number = (() => {
  const getter = intrinsicTypedArrayGetter('byteLength')
  if (getter === undefined) throw new Error('SAFETY: intrinsic Uint8Array metadata getters unavailable')
  return getter as (this: Uint8Array) => number
})()
const INTRINSIC_BYTE_OFFSET: (this: Uint8Array) => number = (() => {
  const getter = intrinsicTypedArrayGetter('byteOffset')
  if (getter === undefined) throw new Error('SAFETY: intrinsic Uint8Array metadata getters unavailable')
  return getter as (this: Uint8Array) => number
})()
const INTRINSIC_BUFFER: (this: Uint8Array) => ArrayBufferLike = (() => {
  const getter = intrinsicTypedArrayGetter('buffer')
  if (getter === undefined) throw new Error('SAFETY: intrinsic Uint8Array metadata getters unavailable')
  return getter as (this: Uint8Array) => ArrayBufferLike
})()

export function parseT15EMaintenanceFrames(input: unknown): T15EMaintenanceFrameParse | T15EMaintenanceFrameFailure {
  // Input contract: Buffer or Uint8Array (intrinsic brand check, not
  // instanceof — proxies are never byte inputs, even wrapped over them, and
  // no proxy trap or conversion hook may run). The ENTIRE recognition/
  // metadata/cconversion path is contained: any raw throw (revoked proxy,
  // exotic traps) is a fixed INPUT_INVALID with the throw discarded — no raw
  // errors or payload content in diagnostics.
  let raw: Buffer
  try {
    if (typeof input !== 'object' || input === null || !types.isUint8Array(input)) {
      return fail('INPUT_INVALID')
    }
    const view = input as Uint8Array
    const trustedLength = INTRINSIC_BYTE_LENGTH.call(view)
    const trustedOffset = INTRINSIC_BYTE_OFFSET.call(view)
    const trustedBuffer = INTRINSIC_BUFFER.call(view)
    // Aggregate total-stream bound BEFORE any snapshot allocation, on the
    // TRUSTED byte count: oversize inputs never reach the copy.
    if (trustedLength > T15E_MAINT_FRAME_MAX_TOTAL_BYTES) return fail('STREAM_OVERFLOW')
    // Copy ONLY the captured bounded span, through a FRESH native view built
    // from the trusted buffer/offset/length (no subclass hooks, no caller
    // property reads): the snapshot can never alias caller output or exceed
    // the bound, and later caller mutations cannot affect the result.
    const nativeView = new Uint8Array(trustedBuffer, trustedOffset, trustedLength)
    raw = Buffer.from(nativeView)
  } catch {
    return fail('INPUT_INVALID')
  }

  const payloads: string[] = []
  let pos = 0
  for (let n = 1; n <= 6; n++) {
    const begin = beginMarker(n)
    if (raw.byteLength < pos + begin.length) return fail('MARKER_INVALID')
    for (let i = 0; i < begin.length; i++) {
      if (raw[pos + i] !== begin[i]) return fail('MARKER_INVALID')
    }
    pos += begin.length

    const end = endMarker(n)
    const endAt = indexOfBytes(raw, end, pos)
    if (endAt < 0) return fail('MARKER_INVALID')
    const payloadView = raw.subarray(pos, endAt) // view only — no copy yet

    // Per-section bound on RAW BYTES before any retained copy is made.
    if (payloadView.byteLength > T15E_MAINT_FRAME_MAX_SECTION_BYTES) return fail('SECTION_OVERFLOW')
    // NUL bytes are framing-invalid anywhere in a payload.
    if (payloadView.includes(0x00)) return fail('NUL_BYTE')

    // Trailer digits run from after the end marker to the single LF.
    let digitsEnd = endAt + end.length
    while (digitsEnd < raw.length && raw[digitsEnd] !== 0x0a) digitsEnd++
    if (digitsEnd >= raw.length) return fail('TRAILER_INVALID') // truncated before LF
    const octets = parseTrailerDigits(raw, endAt + end.length, digitsEnd)
    if (octets === null) return fail('TRAILER_INVALID')
    if (payloadView.byteLength !== octets) return fail('LENGTH_MISMATCH')

    // Strict UTF-8: decoded text must round-trip to the identical bytes, so
    // replacement-character forgeries can never pass.
    const payloadText = payloadView.toString('utf8')
    if (Buffer.compare(Buffer.from(payloadText, 'utf8'), payloadView) !== 0) return fail('UTF8_INVALID')

    payloads.push(payloadText) // immutable string copy retained AFTER bounds
    pos = digitsEnd + 1 // past the single LF separator
  }
  // Exactly one terminal LF (the psql record terminator) and nothing else.
  if (pos !== raw.length) return fail('EXTRA_BYTES')

  return {
    ok: true,
    authority: 'NONE',
    sections: Object.freeze(payloads),
    sectionOrder: SECTION_NAMES,
  }
}
