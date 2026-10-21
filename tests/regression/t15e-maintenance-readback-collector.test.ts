// Task132 — B1a2b readback-only collector regression (fake-only; Task131
// approved contract §11). All fixtures are short, synthetic, nonsensitive.
// No real timer/process/DB/socket/network; no secret-bearing prologue; no raw
// production SQL/stdin/stdout/JSON/stderr. TDD chronology per Task126
// precedent: the missing-module error is NOT behavioral RED; assertion RED
// against a disclosed nonfunctional declaration scaffold precedes behavior.
//
// DISCLOSED DEVIATION (contract case-10 wording): a detached TypedArray presents intrinsic byteLength 0 per
// ECMAScript (indistinguishable from a genuine empty view; no standard
// isDetached exists). The approved frame decoder likewise never special-cases
// detach. The collector therefore recognizes a detached view as a ZERO-length
// chunk no-op (contract §3 rule 3) — fail-safe, never INPUT_INVALID. The
// detached test below asserts this honest deterministic behavior.
// TASK133 REPAIR: the deviation above is RETIRED. Contained fresh native-view
// construction over the captured span (the approved decoder's own pattern)
// throws on a detached backing buffer even at length zero, so detached views
// now latch INPUT_INVALID permanently per contract §5/case 10 — no deviation
// remains.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createT15EMaintenanceReadbackCollector,
  type T15EMaintenanceReadbackCollector,
} from '../support/native/t15e-maintenance-readback-collector'

const NONCE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const MAX_STREAM = 512 * 1024
const MAX_SECTION = 64 * 1024

const ackLine = (nonce: string): Buffer => Buffer.from(`T15E_MAINT_ACK_READBACK_${nonce}\n`, 'utf8')
const sectionBytes = (n: number, payload: string | Buffer): Buffer => {
  const p = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
  return Buffer.concat([
    Buffer.from(`T15E_MAINT_S${n}_B\n`, 'utf8'),
    p,
    Buffer.from(`\nT15E_MAINT_S${n}_E:${p.byteLength}`, 'utf8'),
  ])
}
const framesBytes = (payloads: readonly (string | Buffer)[]): Buffer =>
  Buffer.concat(payloads.flatMap((payload, index) => [sectionBytes(index + 1, payload), Buffer.from('\n', 'utf8')]))
const SIMPLE = ['{"a":1}', '{"b":false}', '{"c":"x"}', '{"d":[]}', '{"e":{}}', '{"f":"g"}']
const validStream = (payloads: readonly (string | Buffer)[] = SIMPLE, nonce: string = NONCE): Buffer =>
  Buffer.concat([framesBytes(payloads), ackLine(nonce)])
/** Same JSON value, padded with legal inter-token whitespace to exactly targetBytes. */
const padPayload = (json: string, targetBytes: number): string => {
  assert.ok(Buffer.byteLength(json, 'utf8') >= 2 && json.startsWith('{'))
  return '{' + ' '.repeat(targetBytes - Buffer.byteLength(json, 'utf8')) + json.slice(1)
}
const PADDED = SIMPLE.map((p) => padPayload(p, 1400))
const PADDED_STREAM = validStream(PADDED) // 6*(1400+38)+89 = 8717 bytes > 8192

const make = (): T15EMaintenanceReadbackCollector => {
  const made = createT15EMaintenanceReadbackCollector({ nonce: NONCE })
  assert.equal(made.ok, true)
  if (!made.ok) throw new Error('fixture collector creation failed')
  return made.collector
}
const feed = (collector: T15EMaintenanceReadbackCollector, stream: Buffer, chunkSize: number): void => {
  for (let offset = 0; offset < stream.byteLength; offset += chunkSize) {
    collector.pushStdout(stream.subarray(offset, Math.min(offset + chunkSize, stream.byteLength)))
  }
}

describe('case 1: fragmentation-one-byte-padded', () => {
  it('>8192 NONEMPTY one-byte events coalesce to completion with equal span bytes', () => {
    assert.ok(PADDED_STREAM.byteLength > 8192) // 8717
    const collector = make()
    feed(collector, PADDED_STREAM, 1)
    const snap = collector.snapshot()
    assert.equal(snap.failure, null)
    assert.equal(snap.readbackComplete, true)
    assert.equal(snap.events, 8717)
    assert.equal(snap.stdoutBytes, 8717)
    const span = collector.readbackSpan()
    assert.ok(span !== null)
    assert.deepEqual(span, PADDED_STREAM)
  })
})

describe('case 2: grouping-independence (semantic projection; observed counters separate)', () => {
  it('whole/halves/one-byte/empties-between-markers agree on projection and span bytes', () => {
    const S2_MARK = 16 + 1400 + 17 + 4 + 1 // 1438: after S1's trailer LF = start of S2 begin marker (hand-checked)
    assert.equal(PADDED_STREAM.subarray(S2_MARK, S2_MARK + 15).toString('utf8'), 'T15E_MAINT_S2_B')
    const observe = (deliver: (c: T15EMaintenanceReadbackCollector) => void): { projection: unknown; span: Buffer; events: number; lateInputs: number } => {
      const collector = make()
      deliver(collector)
      const snap = collector.snapshot() // OBSERVED collector counters, never fixture return values
      const { authority, failure, readbackComplete, ended, disposed, stdoutBytes, events, lateInputs } = snap
      const span = collector.readbackSpan()
      assert.ok(span !== null)
      return { projection: { authority, failure, readbackComplete, ended, disposed, stdoutBytes }, span, events, lateInputs }
    }
    const whole = observe((c) => { c.pushStdout(PADDED_STREAM) })
    const halves = observe((c) => {
      const mid = Math.floor(PADDED_STREAM.byteLength / 2)
      c.pushStdout(PADDED_STREAM.subarray(0, mid)); c.pushStdout(PADDED_STREAM.subarray(mid))
    })
    const bytewise = observe((c) => { feed(c, PADDED_STREAM, 1) })
    const empties = observe((c) => {
      c.pushStdout(new Uint8Array(0)) // before first byte
      for (let offset = 0; offset < PADDED_STREAM.byteLength; offset++) {
        if (offset === S2_MARK) c.pushStdout(Buffer.alloc(0)) // genuine empty BETWEEN markers
        c.pushStdout(PADDED_STREAM.subarray(offset, offset + 1))
      }
      c.pushStdout(Buffer.alloc(0)) // after completion
    })
    assert.deepEqual(whole.projection, halves.projection)
    assert.deepEqual(whole.projection, bytewise.projection)
    assert.deepEqual(whole.projection, empties.projection)
    assert.deepEqual(halves.span, whole.span)
    assert.deepEqual(bytewise.span, whole.span)
    assert.deepEqual(empties.span, whole.span)
    assert.deepEqual(whole.projection, {
      authority: 'NONE', failure: null, readbackComplete: true, ended: false, disposed: false, stdoutBytes: 8717,
    })
    // OBSERVED snapshot.events asserted against independently specified delivery counts.
    assert.equal(whole.events, 1)
    assert.equal(halves.events, 2)
    assert.equal(bytewise.events, 8717)
    assert.equal(empties.events, 8717 + 3) // one-byte events + 3 genuine empties
    assert.equal(whole.lateInputs, 0)
    assert.equal(halves.lateInputs, 0)
    assert.equal(bytewise.lateInputs, 0)
    assert.equal(empties.lateInputs, 0)
  })
})

describe('case 3: split-boundaries (hand-checked multibyte fixture)', () => {
  it('two-chunk splits across marker/multi-digit-trailer/nonce/LF boundaries still complete', () => {
    const MB = ['{"x":"é€"}', ...SIMPLE.slice(1)] // payload: 6 ASCII + é(2B) + €(3B) + 2 ASCII = 13 bytes
    const stream = validStream(MB)
    const payload1 = Buffer.byteLength(MB[0], 'utf8')
    assert.equal(payload1, 13) // hand-checked multibyte length
    const digitsAt = 16 + payload1 + 17 // trailer digits start (begin 16 + payload + end marker 17)
    assert.equal(stream[digitsAt], 0x31) // '1'
    assert.equal(stream[digitsAt + 1], 0x33) // '3' — a genuinely multi-digit trailer
    assert.equal(stream[digitsAt + 2], 0x0a) // the single LF separator after the digits
    const splits = [
      8, // mid S1 begin marker (marker is 16 bytes)
      16 + payload1 + 7, // mid "\nT15E_MAINT_S1_E:" end marker (17 bytes)
      digitsAt + 1, // BETWEEN trailer digits '1' and '3'
      digitsAt + 2, // exactly at the LF (chunk A ends immediately before the LF)
      stream.byteLength - 89 + 24 + 30, // mid nonce digits inside the ACK
    ]
    for (const split of splits) {
      const collector = make()
      collector.pushStdout(stream.subarray(0, split))
      assert.equal(collector.snapshot().failure, null, `split ${split} must not fail early`)
      collector.pushStdout(stream.subarray(split))
      const snap = collector.snapshot()
      assert.equal(snap.failure, null, `split ${split}`)
      assert.equal(snap.readbackComplete, true, `split ${split}`)
      assert.deepEqual(collector.readbackSpan(), stream)
    }
  })
})

describe('case 4: same-chunk-complete-plus-garbage', () => {
  it('complete valid readback + garbage in ONE chunk => READBACK_MALFORMED, no span', () => {
    const collector = make()
    collector.pushStdout(Buffer.concat([validStream(), Buffer.from('garbage', 'utf8')]))
    const snap = collector.snapshot()
    assert.equal(snap.failure, 'READBACK_MALFORMED')
    assert.equal(snap.readbackComplete, false)
    assert.equal(collector.readbackSpan(), null)
  })
  it('capacity-passage-not-grammar-success: exactly 524288-byte chunk passes capacity then latches malformed', () => {
    const base = validStream()
    const collector = make()
    collector.pushStdout(Buffer.concat([base, Buffer.alloc(MAX_STREAM - base.byteLength, 0x78)]))
    assert.equal(collector.snapshot().failure, 'READBACK_MALFORMED') // capacity gate passed; grammar failed
  })
  it('524289-byte chunk => STREAM_OVERFLOW (capacity check, never healthy-512KiB grammar)', () => {
    const base = validStream()
    const collector = make()
    collector.pushStdout(Buffer.concat([base, Buffer.alloc(MAX_STREAM - base.byteLength + 1, 0x78)]))
    assert.equal(collector.snapshot().failure, 'STREAM_OVERFLOW')
    assert.equal(collector.snapshot().readbackComplete, false)
  })
})

describe('case 5: section-boundary-64kib', () => {
  it('payload padded to EXACTLY 65536 bytes completes (grammar success below capacity)', () => {
    const payloads = [padPayload(SIMPLE[0], MAX_SECTION), ...SIMPLE.slice(1)]
    const stream = validStream(payloads)
    const collector = make()
    collector.pushStdout(stream)
    const snap = collector.snapshot()
    assert.equal(snap.failure, null)
    assert.equal(snap.readbackComplete, true)
    assert.equal(snap.stdoutBytes, stream.byteLength)
    assert.deepEqual(collector.readbackSpan(), stream)
  })
  it('65537-byte payload => SECTION_OVERFLOW before storage growth', () => {
    const payloads = [padPayload(SIMPLE[0], MAX_SECTION + 1), ...SIMPLE.slice(1)]
    const collector = make()
    collector.pushStdout(validStream(payloads))
    assert.equal(collector.snapshot().failure, 'SECTION_OVERFLOW')
    assert.equal(collector.snapshot().readbackComplete, false)
  })
})

describe('case 6: max-valid-stream-completes', () => {
  it('six 65536-byte payloads complete at ~384KiB, disclosing 512KiB headroom', () => {
    const stream = validStream(SIMPLE.map((p) => padPayload(p, MAX_SECTION)))
    assert.equal(stream.byteLength, 6 * 65536 + 6 * (16 + 17 + 1) + 6 * 5 + 89) // 393539 — hand-checked framing (begin16+end17+LF1+5digits per section)
    assert.ok(stream.byteLength < MAX_STREAM) // exactly-512KiB-healthy impossible by construction
    const collector = make()
    collector.pushStdout(stream)
    const snap = collector.snapshot()
    assert.equal(snap.failure, null)
    assert.equal(snap.readbackComplete, true)
    assert.equal(snap.stdoutBytes, 393539)
    assert.deepEqual(collector.readbackSpan(), stream)
  })
})

describe('case 7: invalid-utf8-nul-accurate-trailers', () => {
  it('raw 0xff with a CORRECT trailer: cursor completes, unchanged parser rejects at completion => READBACK_MALFORMED', () => {
    const rawJson = Buffer.concat([Buffer.from('{"x":"a', 'utf8'), Buffer.from([0xff]), Buffer.from('"}', 'utf8')])
    const stream = validStream([rawJson, ...SIMPLE.slice(1)])
    const collector = make()
    collector.pushStdout(stream)
    const snap = collector.snapshot()
    assert.equal(snap.failure, 'READBACK_MALFORMED') // UTF8_INVALID surfaced via unchanged demux authority
    assert.equal(snap.readbackComplete, false)
    assert.equal(collector.readbackSpan(), null)
  })
  it('raw NUL with a CORRECT trailer likewise latches READBACK_MALFORMED at completion time', () => {
    const rawJson = Buffer.concat([Buffer.from('{"x":"a', 'utf8'), Buffer.from([0x00]), Buffer.from('"}', 'utf8')])
    const collector = make()
    collector.pushStdout(validStream([rawJson, ...SIMPLE.slice(1)]))
    assert.equal(collector.snapshot().failure, 'READBACK_MALFORMED')
    assert.equal(collector.snapshot().readbackComplete, false)
  })
})

describe('case 8: wrong-nonce-order-duplicates', () => {
  it('ACK with wrong/stale/uppercase nonce => READBACK_MALFORMED', () => {
    for (const wrong of ['f'.repeat(64), 'A'.repeat(64), '0'.repeat(63) + 'g']) {
      const collector = make()
      collector.pushStdout(Buffer.concat([framesBytes(SIMPLE), ackLine(wrong)]))
      assert.equal(collector.snapshot().failure, 'READBACK_MALFORMED', `nonce ${wrong.slice(0, 4)}...`)
      assert.equal(collector.snapshot().readbackComplete, false)
    }
  })
  it('S2-before-S1, S1..S6-then-S1-again, duplicate ACK (same chunk) => READBACK_MALFORMED', () => {
    // Section MARKERS emitted out of order (S2's framed section first, then S1):
    // after S2's trailer LF the cursor expects S3's begin marker, not S1's.
    const misordered = Buffer.concat([
      sectionBytes(2, SIMPLE[1]), Buffer.from('\n', 'utf8'),
      sectionBytes(1, SIMPLE[0]), Buffer.from('\n', 'utf8'),
      ...[3, 4, 5, 6].map((n) => Buffer.concat([sectionBytes(n, SIMPLE[n - 1]), Buffer.from('\n', 'utf8')])),
      ackLine(NONCE),
    ])
    for (const stream of [
      misordered,
      Buffer.concat([framesBytes(SIMPLE), sectionBytes(1, '{"again":1}'), Buffer.from('\n', 'utf8'), ackLine(NONCE)]),
      Buffer.concat([validStream(), ackLine(NONCE)]),
    ]) {
      const collector = make()
      collector.pushStdout(stream)
      assert.equal(collector.snapshot().failure, 'READBACK_MALFORMED')
      assert.equal(collector.snapshot().readbackComplete, false)
    }
  })
})

describe('case 9: intrinsic-shadows-ignored', () => {
  it('genuine view with throwing shadow metadata getters: accepted, ZERO shadow reads', () => {
    const real = validStream()
    const view = new Uint8Array(real)
    let shadowReads = 0
    for (const key of ['byteLength', 'byteOffset', 'buffer'] as const) {
      Object.defineProperty(view, key, {
        get() { shadowReads += 1; throw new Error(`shadow ${key} threw`) },
        configurable: true,
      })
    }
    const collector = make()
    collector.pushStdout(view)
    assert.equal(shadowReads, 0, 'shadow getters must never be consulted')
    assert.equal(collector.snapshot().failure, null)
    assert.equal(collector.snapshot().readbackComplete, true)
    assert.deepEqual(collector.readbackSpan(), real)
  })
  it('lying small byteLength shadow over a >512KiB real span still => STREAM_OVERFLOW', () => {
    const real = new Uint8Array(MAX_STREAM + 1)
    Object.defineProperty(real, 'byteLength', { get: () => 10, configurable: true })
    const collector = make()
    collector.pushStdout(real)
    assert.equal(collector.snapshot().failure, 'STREAM_OVERFLOW')
  })
  it('shadowed buffer/byteOffset cannot redirect collection: real bytes are read', () => {
    const real = validStream()
    const view = new Uint8Array(real.buffer, real.byteOffset, real.byteLength)
    const foreign = Buffer.from('zzforeign-memoryzz', 'utf8')
    Object.defineProperty(view, 'buffer', { get: () => foreign.buffer, configurable: true })
    Object.defineProperty(view, 'byteOffset', { get: () => foreign.byteOffset, configurable: true })
    Object.defineProperty(view, 'byteLength', { get: () => foreign.byteLength, configurable: true })
    const collector = make()
    collector.pushStdout(view)
    assert.equal(collector.snapshot().failure, null)
    assert.deepEqual(collector.readbackSpan(), real)
  })
})

describe('case 10: fixed-input-rejection (+ disclosed detached-view no-op)', () => {
  it('plain proxy / plain object / string / null => INPUT_INVALID; later healthy stream absorbed, never completes', () => {
    const collector = make()
    collector.pushStdout(new Proxy(new Uint8Array(8), {}))
    assert.equal(collector.snapshot().failure, 'INPUT_INVALID')
    collector.pushStdout(validStream())
    const snap = collector.snapshot()
    assert.equal(snap.failure, 'INPUT_INVALID')
    assert.equal(snap.readbackComplete, false)
    assert.equal(snap.lateInputs, 1)
    for (const bad of ['x' as unknown, null, undefined, 42]) {
      const probe = make()
      probe.pushStdout(bad)
      assert.equal(probe.snapshot().failure, 'INPUT_INVALID')
    }
  })
  it('throwing-capture proxy maps to INPUT_INVALID with no raw text anywhere in snapshots', () => {
    const collector = make()
    const hostile = new Proxy(new Uint8Array(8), { getPrototypeOf() { throw new Error('boom-trap') } })
    collector.pushStdout(hostile)
    assert.equal(collector.snapshot().failure, 'INPUT_INVALID')
    assert.equal(JSON.stringify(collector.snapshot()).includes('boom'), false)
  })
  it('detached view => INPUT_INVALID permanently (contained fresh native-view construction); later input absorbed', () => {
    const view = new Uint8Array(validStream())
    structuredClone(view, { transfer: [view.buffer] })
    assert.equal(view.byteLength, 0) // detached per ECMAScript
    const collector = make()
    collector.pushStdout(view)
    let snap = collector.snapshot()
    assert.equal(snap.failure, 'INPUT_INVALID')
    collector.pushStdout(validStream())
    snap = collector.snapshot()
    assert.equal(snap.failure, 'INPUT_INVALID')
    assert.equal(snap.readbackComplete, false)
    assert.equal(snap.lateInputs, 1)
    assert.equal(collector.readbackSpan(), null)
  })
  it('genuine non-detached empty views remain accepted no-ops', () => {
    const collector = make()
    collector.pushStdout(new Uint8Array(0))
    collector.pushStdout(Buffer.alloc(0))
    const snap = collector.snapshot()
    assert.equal(snap.failure, null)
    assert.equal(snap.events, 2)
    collector.pushStdout(validStream())
    assert.equal(collector.snapshot().readbackComplete, true)
  })
})

describe('case 11: overflow-before-copy (real alloc/copy/set mechanism)', () => {
  it('>512KiB trusted chunk rejects STREAM_OVERFLOW with ZERO alloc/copy/set/from calls', () => {
    const collector = make() // creation builds its fixed tables BEFORE instrumentation
    const chunk = new Uint8Array(MAX_STREAM + 2) // allocated BEFORE instrumentation
    const originalAlloc = Buffer.alloc
    const originalFrom = Buffer.from
    const originalCopy = Buffer.prototype.copy
    const originalSet = Uint8Array.prototype.set
    let allocCalls = 0
    let fromCalls = 0
    let copyCalls = 0
    let setCalls = 0
    try {
      Object.defineProperty(Buffer, 'alloc', { value: (...args: Parameters<typeof Buffer.alloc>) => { allocCalls += 1; return originalAlloc(...args) }, configurable: true, writable: true })
      Object.defineProperty(Buffer, 'from', { value: (...args: Parameters<typeof Buffer.from>) => { fromCalls += 1; return originalFrom(...args) }, configurable: true, writable: true })
      Object.defineProperty(Buffer.prototype, 'copy', { value: function (this: Buffer, ...args: Parameters<typeof Buffer.prototype.copy>) { copyCalls += 1; return originalCopy.apply(this, args) }, configurable: true, writable: true })
      Object.defineProperty(Uint8Array.prototype, 'set', { value: function (this: Uint8Array, ...args: Parameters<typeof Uint8Array.prototype.set>) { setCalls += 1; return originalSet.apply(this, args) }, configurable: true, writable: true })
      collector.pushStdout(chunk)
      assert.equal(collector.snapshot().failure, 'STREAM_OVERFLOW')
      assert.equal(allocCalls, 0, 'no growth allocation before the aggregate bound')
      assert.equal(fromCalls, 0, 'no Buffer.from before the aggregate bound')
      assert.equal(copyCalls, 0, 'no copy before the aggregate bound')
      assert.equal(setCalls, 0, 'no set before the aggregate bound')
    } finally {
      Object.defineProperty(Buffer, 'alloc', { value: originalAlloc, configurable: true, writable: true })
      Object.defineProperty(Buffer, 'from', { value: originalFrom, configurable: true, writable: true })
      Object.defineProperty(Buffer.prototype, 'copy', { value: originalCopy, configurable: true, writable: true })
      Object.defineProperty(Uint8Array.prototype, 'set', { value: originalSet, configurable: true, writable: true })
    }
    assert.equal(typeof Buffer.alloc, 'function', 'instrumentation restored')
  })
})

describe('case 12: copy-isolation', () => {
  it('readbackSpan() twice: distinct caller-owned Buffers; mutating one changes nothing else', () => {
    const stream = validStream()
    const collector = make()
    collector.pushStdout(stream)
    const a = collector.readbackSpan()
    const b = collector.readbackSpan()
    assert.ok(a !== null && b !== null && a !== b)
    assert.deepEqual(a, b)
    a[0] = a[0] ^ 0xff
    assert.deepEqual(b, stream)
    assert.deepEqual(collector.readbackSpan(), stream) // private bytes unchanged
    assert.deepEqual(collector.readbackSpan(), stream) // and again after copies
  })
})

describe('case 13: failure-lifecycle-orders', () => {
  it('STREAM_OVERFLOW -> end() -> dispose(): failure preserved; repeats are idempotent no-ops', () => {
    const collector = make()
    collector.pushStdout(new Uint8Array(MAX_STREAM + 1))
    const before = collector.snapshot()
    collector.end()
    const afterEnd = collector.snapshot()
    collector.dispose()
    collector.end()
    collector.dispose()
    collector.end()
    const afterAll = collector.snapshot()
    assert.equal(before.failure, 'STREAM_OVERFLOW')
    assert.equal(afterEnd.failure, 'STREAM_OVERFLOW')
    assert.equal(afterEnd.ended, true)
    assert.equal(afterAll.failure, 'STREAM_OVERFLOW')
    assert.equal(afterAll.ended, true)
    assert.equal(afterAll.disposed, true)
    assert.equal(JSON.stringify(before), JSON.stringify({ authority: 'NONE', failure: 'STREAM_OVERFLOW', readbackComplete: false, ended: false, disposed: false, stdoutBytes: 0, events: 1, lateInputs: 0 }))
  })
  it('STREAM_OVERFLOW -> dispose() -> end(): failure preserved; absorbed end leaves ended false', () => {
    const collector = make()
    collector.pushStdout(new Uint8Array(MAX_STREAM + 1))
    collector.dispose()
    collector.end() // absorbed no-op after disposal
    const snap = collector.snapshot()
    assert.equal(snap.failure, 'STREAM_OVERFLOW')
    assert.equal(snap.disposed, true)
    assert.equal(snap.ended, false)
  })
})

describe('case 14: post-disposal-null-no-rebuild', () => {
  it('dispose() nulls the span accessor; pushes absorbed; caller-owned copies persist', () => {
    const stream = validStream()
    const collector = make()
    collector.pushStdout(stream)
    const a = collector.readbackSpan()
    assert.ok(a !== null)
    const frozenBefore = collector.snapshot()
    collector.dispose()
    assert.equal(collector.readbackSpan(), null)
    collector.pushStdout(stream)
    const snap = collector.snapshot()
    assert.equal(snap.disposed, true)
    assert.equal(snap.failure, null)
    assert.equal(snap.lateInputs, 1)
    assert.equal(collector.readbackSpan(), null) // no rebuild
    assert.deepEqual(a, stream) // caller-owned copy persists outside collector ownership
    assert.equal(JSON.stringify(frozenBefore), JSON.stringify({ authority: 'NONE', failure: null, readbackComplete: true, ended: false, disposed: false, stdoutBytes: stream.byteLength, events: 1, lateInputs: 0 }))
  })
})

describe('case 15: immutable-metadata-vs-current-health', () => {
  it('complete snapshot S1 unchanged after later garbage event latches OUT_OF_PHASE (S2)', () => {
    const stream = validStream()
    const collector = make()
    collector.pushStdout(stream)
    const s1 = collector.snapshot()
    const s1Json = JSON.stringify(s1)
    collector.pushStdout(Buffer.from('late-garbage', 'utf8'))
    const s2 = collector.snapshot()
    assert.equal(s2.failure, 'OUT_OF_PHASE') // historical completion retained, current health failed
    assert.equal(s2.readbackComplete, true)
    assert.deepEqual(collector.readbackSpan(), stream) // span still available while not disposed
    assert.equal(JSON.stringify(s1), s1Json) // earlier frozen snapshot never mutated
    assert.equal(s1.failure, null)
  })
})

describe('case 16: creation', () => {
  it('shape violations => INPUT_INVALID; nonce violations => NONCE_INVALID; no raw error text', () => {
    const shapeCases: unknown[] = [
      {}, { nonce: NONCE, extra: 1 }, null, 'x', 42,
      (() => {
        const hostile: Record<string, unknown> = {}
        Object.defineProperty(hostile, 'nonce', { get() { throw new Error('boom-create') }, enumerable: true, configurable: true })
        return hostile
      })(),
    ]
    for (const input of shapeCases) {
      const made = createT15EMaintenanceReadbackCollector(input)
      assert.equal(made.ok, false)
      if (!made.ok) assert.equal(made.reason, 'INPUT_INVALID')
      assert.equal(JSON.stringify(made).includes('boom'), false)
    }
    const { proxy, revoke } = Proxy.revocable({ nonce: NONCE }, {})
    revoke()
    const revoked = createT15EMaintenanceReadbackCollector(proxy)
    assert.equal(revoked.ok, false)
    if (!revoked.ok) assert.equal(revoked.reason, 'INPUT_INVALID')
    for (const nonce of [
      NONCE.slice(1), NONCE + '0', NONCE.toUpperCase(), 'g'.repeat(64), 42, null,
    ]) {
      const made = createT15EMaintenanceReadbackCollector({ nonce })
      assert.equal(made.ok, false)
      if (!made.ok) assert.equal(made.reason, 'NONCE_INVALID')
    }
    const good = createT15EMaintenanceReadbackCollector({ nonce: NONCE })
    assert.equal(good.ok, true)
    if (good.ok) assert.equal(good.authority, 'NONE')
  })
})

describe('case 17: end-incomplete-truthful', () => {
  it('end() mid-phase: truthful non-completion, no failure latched, later pushes absorbed', () => {
    const stream = validStream()
    const collector = make()
    collector.pushStdout(stream.subarray(0, Math.floor(stream.byteLength / 2)))
    collector.end()
    const snap = collector.snapshot()
    assert.equal(snap.failure, null)
    assert.equal(snap.readbackComplete, false)
    assert.equal(snap.ended, true)
    assert.equal(collector.readbackSpan(), null)
    collector.pushStdout(stream.subarray(Math.floor(stream.byteLength / 2)))
    const after = collector.snapshot()
    assert.equal(after.failure, null)
    assert.equal(after.readbackComplete, false)
    assert.equal(after.lateInputs, 1)
    assert.equal(collector.readbackSpan(), null)
  })
})

describe('repair P1-2: section capacity precedes private growth/append', () => {
  it('SECTION_OVERFLOW: stdoutBytes counts only pre-overflow accepted bytes (16 + 65536)', () => {
    const stream = validStream([padPayload(SIMPLE[0], MAX_SECTION + 1), ...SIMPLE.slice(1)])
    const collector = make()
    collector.pushStdout(stream)
    const snap = collector.snapshot()
    assert.equal(snap.failure, 'SECTION_OVERFLOW')
    assert.equal(snap.stdoutBytes, 16 + MAX_SECTION) // begin marker + the first 65536 payload bytes ONLY
    assert.ok(snap.stdoutBytes < stream.byteLength)
  })
  it('guarded alloc/set path: no bulk copy covers the overflowing payload byte', () => {
    const stream = validStream([padPayload(SIMPLE[0], MAX_SECTION + 1), ...SIMPLE.slice(1)])
    const collector = make()
    const originalSet = Uint8Array.prototype.set
    const originalAlloc = Buffer.alloc
    let setBytes = 0
    const allocSizes: number[] = []
    try {
      Object.defineProperty(Uint8Array.prototype, 'set', { value: function (this: Uint8Array, array: ArrayLike<number>, offset?: number) { setBytes += array.length; return originalSet.call(this, array, offset) }, configurable: true, writable: true })
      Object.defineProperty(Buffer, 'alloc', { value: (...args: Parameters<typeof Buffer.alloc>) => { allocSizes.push(args[0] as number); return originalAlloc(...args) }, configurable: true, writable: true })
      collector.pushStdout(stream)
    } finally {
      Object.defineProperty(Uint8Array.prototype, 'set', { value: originalSet, configurable: true, writable: true })
      Object.defineProperty(Buffer, 'alloc', { value: originalAlloc, configurable: true, writable: true })
    }
    assert.equal(collector.snapshot().failure, 'SECTION_OVERFLOW')
    assert.ok(setBytes <= 16 + MAX_SECTION, `set bytes ${setBytes} must not cover the overflowing byte`)
    for (const size of allocSizes) assert.ok(size <= MAX_STREAM, 'growth stays within the fixed stream bound')
    assert.equal(typeof Uint8Array.prototype.set, 'function', 'instrumentation restored')
  })
})

describe('repair P1-3: absorbed end() after disposal', () => {
  it('dispose() first: later end() is an absorbed no-op, ended stays false', () => {
    const collector = make()
    collector.dispose()
    collector.end()
    const snap = collector.snapshot()
    assert.equal(snap.disposed, true)
    assert.equal(snap.ended, false) // ended means an EFFECTIVE accepted end before disposal
  })
  it('end() first: ended stays true through later dispose()', () => {
    const collector = make()
    collector.end()
    collector.dispose()
    const snap = collector.snapshot()
    assert.equal(snap.ended, true)
    assert.equal(snap.disposed, true)
  })
  it('absorbed end-after-dispose never disturbs a prior permanent failure', () => {
    const collector = make()
    collector.pushStdout(new Uint8Array(MAX_STREAM + 1))
    collector.dispose()
    collector.end()
    const snap = collector.snapshot()
    assert.equal(snap.failure, 'STREAM_OVERFLOW')
    assert.equal(snap.disposed, true)
    assert.equal(snap.ended, false)
  })
})

describe('repair P2-1: definitive trailer prefixes reject immediately', () => {
  const prefixOnly = (trailerTail: string): Buffer => Buffer.concat([
    Buffer.from('T15E_MAINT_S1_B\n', 'utf8'),
    Buffer.from('{"p":1}', 'utf8'),
    Buffer.from('\nT15E_MAINT_S1_E:', 'utf8'),
    Buffer.from(trailerTail, 'utf8'),
  ])
  it('non-digit trailer byte rejects before any LF and before end()', () => {
    const collector = make()
    collector.pushStdout(prefixOnly('x'))
    assert.equal(collector.snapshot().failure, 'READBACK_MALFORMED')
    assert.equal(collector.snapshot().failure !== null, true)
  })
  it('leading-zero continuation rejects before any LF and before end()', () => {
    const collector = make()
    collector.pushStdout(prefixOnly('01'))
    assert.equal(collector.snapshot().failure, 'READBACK_MALFORMED')
  })
  it('the 16th digit byte rejects AT the 16th byte (corrected timing), never appended', () => {
    const collector = make()
    collector.pushStdout(prefixOnly('1234567890123459')) // 15 valid digits then the 16th digit byte
    const snap = collector.snapshot()
    assert.equal(snap.failure, 'READBACK_MALFORMED')
    assert.equal(snap.stdoutBytes, 16 + 7 + 17 + 15, 'exactly the 15 valid digit bytes accepted; the 16th never appended')
  })
  it('15 valid digits without LF remain a healthy prefix (no premature rejection)', () => {
    const collector = make()
    collector.pushStdout(prefixOnly('123456789012345'))
    assert.equal(collector.snapshot().failure, null)
  })
})

describe('task134 P1: EVERY non-LF trailer byte is digit-validated before append', () => {
  const s1Prefix = (tail: string): Buffer => Buffer.concat([
    Buffer.from('T15E_MAINT_S1_B\n', 'utf8'),
    Buffer.from('{"p":1}', 'utf8'),
    Buffer.from('\nT15E_MAINT_S1_E:', 'utf8'),
    Buffer.from(tail, 'utf8'),
  ])
  it('non-digit AFTER a first valid digit rejects at x in the SAME event, before LF/end', () => {
    const collector = make()
    collector.pushStdout(s1Prefix('7x'))
    const snap = collector.snapshot()
    assert.equal(snap.failure, 'READBACK_MALFORMED')
    assert.equal(snap.stdoutBytes, 16 + 7 + 17 + 1, 'the 7 is accepted/appended; the x never is')
  })
  it('split delivery 7 | x: the x event rejects BEFORE LF/end(); failure permanent through end/dispose/repeats', () => {
    const collector = make()
    collector.pushStdout(s1Prefix('7'))
    assert.equal(collector.snapshot().failure, null, 'a lone valid first digit is a healthy prefix')
    collector.pushStdout(Buffer.from('x', 'utf8'))
    const rejected = collector.snapshot()
    assert.equal(rejected.failure, 'READBACK_MALFORMED')
    assert.equal(rejected.readbackComplete, false)
    collector.end()
    collector.dispose()
    collector.end()
    collector.dispose()
    const final = collector.snapshot()
    assert.equal(final.failure, 'READBACK_MALFORMED')
    assert.equal(final.ended, true)
    assert.equal(final.disposed, true)
    collector.pushStdout(s1Prefix('9')) // late input absorbed, never classified or appended
    const after = collector.snapshot()
    assert.equal(after.failure, 'READBACK_MALFORMED')
    assert.equal(after.lateInputs, 1)
  })
  it('independent classification: first non-digit rejects; later digit stays healthy; later non-digit rejects', () => {
    const rejectFirst = make()
    rejectFirst.pushStdout(s1Prefix('x'))
    assert.equal(rejectFirst.snapshot().failure, 'READBACK_MALFORMED')
    const healthyDigits = make()
    healthyDigits.pushStdout(s1Prefix('12'))
    assert.equal(healthyDigits.snapshot().failure, null)
    const rejectLater = make()
    rejectLater.pushStdout(s1Prefix('12y'))
    assert.equal(rejectLater.snapshot().failure, 'READBACK_MALFORMED')
  })
})

describe('task134 P2 coverage: splits INSIDE the multibyte UTF-8 encodings (coverage, not defect RED)', () => {
  it('hand-checked offsets 23 (inside é) and 25/26 (inside €) complete with exact span equality', () => {
    const MB = ['{"x":"é€"}', ...SIMPLE.slice(1)]
    const stream = validStream(MB)
    assert.equal(Buffer.byteLength(MB[0], 'utf8'), 13)
    // payload starts at 16; é = C3 A9 occupies 22-23; € = E2 82 AC occupies 24-26 (hand-checked)
    assert.equal(stream[22], 0xc3)
    assert.equal(stream[23], 0xa9)
    assert.equal(stream[24], 0xe2)
    assert.equal(stream[25], 0x82)
    assert.equal(stream[26], 0xac)
    for (const split of [23, 25, 26]) {
      const collector = make()
      collector.pushStdout(stream.subarray(0, split))
      assert.equal(collector.snapshot().failure, null, `split ${split} healthy prefix`)
      collector.pushStdout(stream.subarray(split))
      const snap = collector.snapshot()
      assert.equal(snap.failure, null, `split ${split}`)
      assert.equal(snap.readbackComplete, true, `split ${split}`)
      assert.deepEqual(collector.readbackSpan(), stream, `split ${split} exact span`)
    }
    // bytewise delivery of the same multibyte fixture
    const bytewise = make()
    feed(bytewise, stream, 1)
    assert.equal(bytewise.snapshot().readbackComplete, true)
    assert.deepEqual(bytewise.readbackSpan(), stream)
  })
})
