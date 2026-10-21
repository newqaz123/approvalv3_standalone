// Task117B — decoder input integrity P1s + UTF8 coverage P2.
// P1-1: aggregate 512 KiB bound must be checked BEFORE any snapshot copy,
// using TRUSTED intrinsic byte metadata (internal slots), never caller
// properties — subclass shadows of byteLength/byteOffset/buffer can neither
// misdirect the size nor redirect the copy at foreign memory.
// P1-2: entire recognition/metadata/conversion is contained — revoked or
// trap-throwing proxies map to fixed INPUT_INVALID with the raw throw
// discarded (no raw errors/secrets in diagnostics).
// P2: malformed 0xff with a CORRECT RAW-BYTE trailer must reach UTF8_INVALID
// (not LENGTH_MISMATCH); the replacement-length attack stays separate
// coverage. Instrumentation is guarded and restored test-only; no exported
// production driver.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  T15E_MAINT_FRAME_MAX_TOTAL_BYTES,
  parseT15EMaintenanceFrames,
} from '../support/native/t15e-maintenance-frame-decoder'

const sectionBytes = (n: number, payload: string): Buffer =>
  Buffer.from(`T15E_MAINT_S${n}_B\n${payload}\nT15E_MAINT_S${n}_E:${Buffer.byteLength(payload, 'utf8')}`, 'utf8')
const joinSections = (parts: readonly Buffer[]): Buffer =>
  Buffer.concat(parts.flatMap((part) => [part, Buffer.from('\n', 'utf8')]))
const validStream = (payloads: readonly string[]): Buffer =>
  joinSections(payloads.map((payload, index) => sectionBytes(index + 1, payload)))
const SIMPLE = ['{"a":1}', '{"b":false}', '{"c":"x"}', '{"d":[]}', '{"e":{}}', '{"f":"g"}']

describe('P1-1 aggregate bound before snapshot copy (trusted metadata)', () => {
  it('oversize Uint8Array and Buffer reject STREAM_OVERFLOW without any Buffer.from snapshot copy', () => {
    const original = Buffer.from
    let calls = 0
    const guarded = (...args: Parameters<typeof Buffer.from>) => {
      calls += 1
      return original(...args)
    }
    try {
      Object.defineProperty(Buffer, 'from', { value: guarded, configurable: true, writable: true })
      const oversizeView = new Uint8Array(T15E_MAINT_FRAME_MAX_TOTAL_BYTES + 1)
      const r1 = parseT15EMaintenanceFrames(oversizeView)
      assert.equal(r1.ok, false)
      if (!r1.ok) assert.equal(r1.reason, 'STREAM_OVERFLOW')
      assert.equal(calls, 0, 'no snapshot copy before the aggregate bound (Uint8Array)')
      calls = 0
      const oversizeBuffer = original(new Uint8Array(T15E_MAINT_FRAME_MAX_TOTAL_BYTES + 2))
      const r2 = parseT15EMaintenanceFrames(oversizeBuffer)
      assert.equal(r2.ok, false)
      if (!r2.ok) assert.equal(r2.reason, 'STREAM_OVERFLOW')
      assert.equal(calls, 0, 'no snapshot copy before the aggregate bound (Buffer)')
    } finally {
      Object.defineProperty(Buffer, 'from', { value: original, configurable: true, writable: true })
    }
    assert.equal(typeof Buffer.from, 'function', 'instrumentation restored')
  })

  it('a shadowed small byteLength cannot hide an oversize real span', () => {
    const real = new Uint8Array(T15E_MAINT_FRAME_MAX_TOTAL_BYTES + 1)
    Object.defineProperty(real, 'byteLength', { get: () => 10, configurable: true })
    const parsed = parseT15EMaintenanceFrames(real)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.reason, 'STREAM_OVERFLOW')
  })

  it('a shadowed buffer getter cannot redirect the copy at foreign memory', () => {
    const foreign = Buffer.from('zzforeign-memoryzz', 'utf8')
    const real = validStream(SIMPLE)
    Object.defineProperty(real, 'buffer', { get: () => foreign.buffer, configurable: true })
    Object.defineProperty(real, 'byteOffset', { get: () => foreign.byteOffset, configurable: true })
    Object.defineProperty(real, 'byteLength', { get: () => foreign.byteLength, configurable: true })
    const parsed = parseT15EMaintenanceFrames(real)
    assert.equal(parsed.ok, true, 'trusted intrinsic metadata must read the REAL bytes')
    if (!parsed.ok) return
    assert.deepEqual([...parsed.sections], SIMPLE)
  })

  it('throwing shadow metadata getters never run (intrinsic getters captured once)', () => {
    const real = validStream(SIMPLE)
    let shadowReads = 0
    for (const key of ['byteLength', 'byteOffset', 'buffer'] as const) {
      Object.defineProperty(real, key, {
        get() { shadowReads += 1; throw new Error(`shadow ${key} threw`) },
        configurable: true,
      })
    }
    const parsed = parseT15EMaintenanceFrames(real)
    assert.equal(parsed.ok, true)
    assert.equal(shadowReads, 0, 'shadow getters must never be consulted')
  })
})

describe('P1-2 contained recognition: proxies never throw raw', () => {
  it('a REVOKED proxy maps to fixed INPUT_INVALID with no raw diagnostics', () => {
    const { proxy, revoke } = Proxy.revocable(new Uint8Array(8), {})
    revoke()
    const parsed = parseT15EMaintenanceFrames(proxy)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) {
      assert.equal(parsed.reason, 'INPUT_INVALID')
      assert.equal(parsed.sections, null)
    }
    assert.equal(JSON.stringify(parsed).includes('proxy'), false)
    assert.equal(JSON.stringify(parsed).includes('revoked'), false)
  })

  it('a getPrototypeOf-trap-throwing proxy maps to fixed INPUT_INVALID', () => {
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('boom-trap') } })
    const parsed = parseT15EMaintenanceFrames(hostile)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.reason, 'INPUT_INVALID')
    assert.equal(JSON.stringify(parsed).includes('boom'), false)
  })

  it('a plain proxy over a byte array is still rejected (no traps needed)', () => {
    const wrapped = new Proxy(new Uint8Array(validStream(SIMPLE)), {})
    const parsed = parseT15EMaintenanceFrames(wrapped)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.reason, 'INPUT_INVALID')
  })
})

describe('P2 malformed UTF-8 with a CORRECT raw-byte trailer', () => {
  it('0xff payload with the true raw span length reaches UTF8_INVALID, not LENGTH_MISMATCH', () => {
    const rawJson = Buffer.concat([Buffer.from('{"x":"a', 'utf8'), Buffer.from([0xff]), Buffer.from('"}', 'utf8')])
    const rawLength = rawJson.byteLength // 10 — the TRUE byte count including 0xff
    const stream = joinSections([
      Buffer.concat([
        Buffer.from('T15E_MAINT_S1_B\n', 'utf8'),
        rawJson,
        Buffer.from(`\nT15E_MAINT_S1_E:${rawLength}`, 'utf8'),
      ]),
      ...[2, 3, 4, 5, 6].map((n) => sectionBytes(n, '{}')),
    ])
    const parsed = parseT15EMaintenanceFrames(stream)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.reason, 'UTF8_INVALID')
    assert.equal(JSON.stringify(parsed).includes('0xff'), false)
  })
})
