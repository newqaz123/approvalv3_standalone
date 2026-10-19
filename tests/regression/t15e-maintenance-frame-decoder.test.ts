// Task117 — FIRST PART of the bounded PURE frame decoder: strict RAW-BYTE
// six-section framing, UTF-8, and bounds ONLY. JSON duplicate-key/exact-schema
// mapping and the complete fact validator are Task118 — an accepted frame
// here is NOT accepted facts (arbitrary payload semantics are out of scope),
// and nothing in this module establishes sqlOk/commit/role authority.
// Synthetic fixtures only (emoji allowed); no native execution implied.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  T15E_MAINT_FRAME_MAX_SECTION_BYTES,
  T15E_MAINT_FRAME_MAX_TOTAL_BYTES,
  parseT15EMaintenanceFrames,
} from '../support/native/t15e-maintenance-frame-decoder'
import { T15E_MAINT_SECTION_ORDER } from '../support/native/t15e-private-maintenance-protocol'

const sectionBytes = (n: number, payload: string): Buffer =>
  Buffer.from(`T15E_MAINT_S${n}_B\n${payload}\nT15E_MAINT_S${n}_E:${Buffer.byteLength(payload, 'utf8')}`, 'utf8')

/** Grammar-exact assembly: one LF between sections, one terminal LF. */
const joinSections = (parts: readonly Buffer[]): Buffer =>
  Buffer.concat(parts.flatMap((part) => [part, Buffer.from('\n', 'utf8')]))

const validStream = (payloads: readonly string[]): Buffer =>
  joinSections(payloads.map((payload, index) => sectionBytes(index + 1, payload)))

const SIMPLE = ['{"a":1}', '{"b":false}', '{"c":"x"}', '{"d":[]}', '{"e":{}}', '{"f":"g"}']

describe('valid framing parses into an immutable, data-only container', () => {
  it('accepts six ASCII sections with exact single-LF separators and one terminal LF', () => {
    const parsed = parseT15EMaintenanceFrames(validStream(SIMPLE))
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.authority, 'NONE')
    assert.deepEqual([...parsed.sections], SIMPLE)
    assert.deepEqual([...parsed.sectionOrder], [...T15E_MAINT_SECTION_ORDER])
    assert.equal(Object.isFrozen(parsed.sections), true)
    assert.equal(Object.isFrozen(parsed.sectionOrder), true)
  })

  it('partition-equivalent assembly of byte-identical streams yields identical results', () => {
    const whole = validStream(SIMPLE)
    const pieces: Buffer[] = []
    for (let i = 0; i < whole.length; i += 7) pieces.push(whole.subarray(i, i + 7))
    const parsed = parseT15EMaintenanceFrames(Buffer.concat(pieces))
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.deepEqual([...parsed.sections], SIMPLE)
  })

  it('non-ASCII payload trailers count BYTES (emoji) and strings survive input mutation', () => {
    const emoji = String.fromCodePoint(0x1f6e1)
    const payloads = [...SIMPLE.slice(0, 5), `{"grants":["shield${emoji}"]}`]
    const input = validStream(payloads)
    const parsed = parseT15EMaintenanceFrames(input)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.sections[5], payloads[5])
    input.fill(0x41) // caller mutates the original buffer afterwards
    assert.equal(parsed.sections[5], payloads[5], 'published strings must be independent copies')
  })

  it('framing-acceptance of arbitrary payload semantics is NOT fact acceptance (labeled)', () => {
    // Task117 accepts only FRAMING; nonsense payloads still parse. Task118
    // performs all semantic validation. This assertion documents that limit.
    const parsed = parseT15EMaintenanceFrames(validStream(['not-json', 'also not', 'x', 'y', 'z', 'w']))
    assert.equal(parsed.ok, true)
  })
})

describe('UTF-8 and trailer strictness', () => {
  it('rejects a 0xff payload with a forged replacement-length trailer', () => {
    const rawJson = Buffer.concat([
      Buffer.from('{"x":"a', 'utf8'),
      Buffer.from([0xff]),
      Buffer.from('"}', 'utf8'),
    ])
    const decodedReplacementLength = Buffer.byteLength(rawJson.toString('utf8'), 'utf8') // 7 - 1 + 3
    const stream = joinSections([
      Buffer.concat([
        Buffer.from('T15E_MAINT_S1_B\n', 'utf8'),
        rawJson,
        Buffer.from(`\nT15E_MAINT_S1_E:${decodedReplacementLength}`, 'utf8'),
      ]),
      ...[2, 3, 4, 5, 6].map((n) => sectionBytes(n, '{}')),
    ])
    const parsed = parseT15EMaintenanceFrames(stream)
    assert.equal(parsed.ok, false, 'replacement-length forgery must fail (length mismatch or UTF8 reject)')
  })

  it('rejects invalid trailers: non-digits, leading zero, unsafe magnitude, mismatched length', () => {
    for (const trailer of ['12x', '042', '99999999999999999999', '1e3', '']) {
      const head = Buffer.from(`T15E_MAINT_S1_B\n{}\nT15E_MAINT_S1_E:${trailer}`, 'utf8')
      const stream = joinSections([head, ...[2, 3, 4, 5, 6].map((n) => sectionBytes(n, '{}'))])
      const parsed = parseT15EMaintenanceFrames(stream)
      assert.equal(parsed.ok, false, `trailer=${JSON.stringify(trailer)}`)
      if (!parsed.ok) assert.equal(parsed.category, 'T15E_MAINT_FRAME_INVALID')
    }
    // Correct digits but wrong length value.
    const mismatch = joinSections([
      Buffer.from('T15E_MAINT_S1_B\n{}\nT15E_MAINT_S1_E:9', 'utf8'),
      ...[2, 3, 4, 5, 6].map((n) => sectionBytes(n, '{}')),
    ])
    assert.equal(parseT15EMaintenanceFrames(mismatch).ok, false)
  })
})

describe('bounds are enforced on RAW BYTES before retained copies', () => {
  it('rejects a section payload over 64 KiB even with a correct trailer', () => {
    const huge = 'x'.repeat(T15E_MAINT_FRAME_MAX_SECTION_BYTES + 1)
    const stream = joinSections([sectionBytes(1, huge), ...[2, 3, 4, 5, 6].map((n) => sectionBytes(n, '{}'))])
    const parsed = parseT15EMaintenanceFrames(stream)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.reason, 'SECTION_OVERFLOW')
  })

  it('rejects a raw stream over 512 KiB before any section parsing', () => {
    const oversized = Buffer.alloc(T15E_MAINT_FRAME_MAX_TOTAL_BYTES + 1, 0x41)
    const parsed = parseT15EMaintenanceFrames(oversized)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.reason, 'STREAM_OVERFLOW')
  })
})

describe('structural rejects: no partial success, no tolerance', () => {
  const rejectsWith = (stream: Buffer): void => {
    const parsed = parseT15EMaintenanceFrames(stream)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) {
      assert.equal(parsed.category, 'T15E_MAINT_FRAME_INVALID')
      assert.equal(parsed.sections, null)
      assert.equal(parsed.message, 'T15E maintenance frame failure')
    }
  }

  it('rejects truncation, missing, reordered, duplicated, and extra sections', () => {
    const whole = validStream(SIMPLE)
    rejectsWith(whole.subarray(0, whole.length - 20)) // truncated mid-payload
    rejectsWith(validStream([SIMPLE[0], SIMPLE[1], SIMPLE[3], SIMPLE[4], SIMPLE[5]])) // missing S3
    // Marker reorder: S2's marker where S1 belongs.
    rejectsWith(joinSections([
      sectionBytes(2, SIMPLE[1]),
      ...[3, 4, 5, 6].map((n) => sectionBytes(n, SIMPLE[n - 1])),
    ]))
    const dup = joinSections([sectionBytes(1, SIMPLE[0]), sectionBytes(1, SIMPLE[0]), ...[2, 3, 4, 5, 6].map((n) => sectionBytes(n, SIMPLE[n - 1]))])
    rejectsWith(dup) // duplicate S1
    const extra = Buffer.concat([validStream(SIMPLE), sectionBytes(7, '{}'), Buffer.from('\n', 'utf8')])
    rejectsWith(extra) // extra S7 after the terminal separator
  })

  it('rejects trailing blank LF, trailing bytes, delimiter mismatch, and nul bytes', () => {
    const whole = validStream(SIMPLE)
    rejectsWith(Buffer.concat([whole, Buffer.from('\n')])) // trailing blank LF
    rejectsWith(Buffer.concat([whole, Buffer.from('junk')])) // trailing bytes
    rejectsWith(joinSections([
      Buffer.from('T15E_MAINT_S1_B {}\nT15E_MAINT_S1_E:9', 'utf8'),
      ...[2, 3, 4, 5, 6].map((n) => sectionBytes(n, '{}')),
    ])) // delimiter mismatch (space after marker)
    const nul = joinSections([
      Buffer.concat([Buffer.from('T15E_MAINT_S1_B\n', 'utf8'), Buffer.from([0x7b, 0x00, 0x7d]), Buffer.from('\nT15E_MAINT_S1_E:3', 'utf8')]),
      ...[2, 3, 4, 5, 6].map((n) => sectionBytes(n, '{}')),
    ])
    rejectsWith(nul) // nul inside payload
  })

  it('rejects a malicious marker inside the payload when framing/trailer coherence fails', () => {
    const forged = 'x'.repeat(3) // payload would claim trailer 3
    const payloadWithFake = `${forged}\nT15E_MAINT_S1_E:3\nT15E_MAINT_S2_B\n{}` // embedded fake framing
    const stream = joinSections([
      Buffer.concat([
        Buffer.from('T15E_MAINT_S1_B\n', 'utf8'),
        Buffer.from(payloadWithFake, 'utf8'),
        Buffer.from(`\nT15E_MAINT_S1_E:${Buffer.byteLength(payloadWithFake, 'utf8')}`, 'utf8'),
      ]),
      ...[2, 3, 4, 5, 6].map((n) => sectionBytes(n, '{}')),
    ])
    // The first-found trailer yields a length mismatch against the forged
    // short payload: framing must reject rather than accept the fake split.
    assert.equal(parseT15EMaintenanceFrames(stream).ok, false)
  })

  it('rejects invalid input types without touching them further', () => {
    for (const bad of ['a string', {}, 42, null, undefined]) {
      const parsed = parseT15EMaintenanceFrames(bad as unknown as Buffer)
      assert.equal(parsed.ok, false, String(typeof bad))
      if (!parsed.ok) assert.equal(parsed.reason, 'INPUT_INVALID')
    }
  })
})
