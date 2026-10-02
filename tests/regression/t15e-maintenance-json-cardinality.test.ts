// Task118A2 — cardinality timing P1: array/object capacity must be checked
// BEFORE traversing the excess child. Overall input stays <= 64 KiB in every
// case so the input bound is never the winner. Grammar stays strict — no
// trailing comma or malformed JSON is accepted at a capacity boundary; the
// failure REASON at an at-capacity trailing comma becomes the cardinality
// failure (documented), never an acceptance.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseT15EBoundedJson } from '../support/native/t15e-maintenance-bounded-json'

const assertWithinInputBound = (text: string): void => {
  assert.ok(Buffer.byteLength(text, 'utf8') <= 64 * 1024, 'fixture must stay within the overall input bound')
}

// tail supplies the terminator (']' for a closed valid array; failure cases may leave it open)
const arrayWith = (count: number, tail: string): string => `[${Array.from({ length: count }, (_, i) => i).join(',')}${tail}`
const objectWith = (count: number, extra: string): string =>
  `{${Array.from({ length: count }, (_, i) => `"m${i}":${i}`).join(',')}${extra}}`

describe('array capacity is checked BEFORE the 129th element is traversed', () => {
  for (const [label, suffix] of [
    ['oversized 4097-byte string', `,"${'x'.repeat(4097)}"`],
    ['malformed unterminated string', ',"y'],
    ['deep child beyond depth 16', `,${'['.repeat(17)}1${']'.repeat(17)}`],
  ] as const) {
    it(`${label} -> ARRAY_EXCEEDED (not string/depth/syntax)`, () => {
      const text = arrayWith(128, suffix)
      assertWithinInputBound(text)
      const parsed = parseT15EBoundedJson(text)
      assert.equal(parsed.ok, false, label)
      if (!parsed.ok) assert.equal(parsed.reason, 'ARRAY_EXCEEDED', label)
    })
  }

  it('exact cap of 128 elements still parses; plain 129-number excess still ARRAY_EXCEEDED', () => {
    assert.equal(parseT15EBoundedJson(arrayWith(128, ']')).ok, true)
    const plain = parseT15EBoundedJson(arrayWith(129, ''))
    assert.equal(plain.ok, false)
    if (!plain.ok) assert.equal(plain.reason, 'ARRAY_EXCEEDED')
  })

  it('at-capacity trailing comma is a strict failure attributed to the cardinality bound (documented), never acceptance', () => {
    const trailing = parseT15EBoundedJson(arrayWith(128, ','))
    assert.equal(trailing.ok, false)
    if (!trailing.ok) assert.equal(trailing.reason, 'ARRAY_EXCEEDED')
    // Below capacity the trailing comma remains a syntax failure.
    const below = parseT15EBoundedJson('[1,]')
    assert.equal(below.ok, false)
    if (!below.ok) assert.equal(below.reason, 'SYNTAX')
  })
})

describe('object capacity is checked BEFORE the 65th member value (or key) is traversed', () => {
  for (const [label, extra] of [
    ['oversized 4097-byte string value', `,"m64":"${'x'.repeat(4097)}"`],
    ['malformed unterminated value', ',"m64":"y'],
    ['deep value beyond depth 16', `,"m64":${'['.repeat(17)}1${']'.repeat(17)}`],
  ] as const) {
    it(`${label} -> OBJECT_EXCEEDED (not string/depth/syntax)`, () => {
      const text = objectWith(64, extra)
      assertWithinInputBound(text)
      const parsed = parseT15EBoundedJson(text)
      assert.equal(parsed.ok, false, label)
      if (!parsed.ok) assert.equal(parsed.reason, 'OBJECT_EXCEEDED', label)
    })
  }

  it('exact cap of 64 members still parses; plain 65-member excess still OBJECT_EXCEEDED', () => {
    assert.equal(parseT15EBoundedJson(objectWith(64, '')).ok, true)
    const plain = parseT15EBoundedJson(objectWith(65, ''))
    assert.equal(plain.ok, false)
    if (!plain.ok) assert.equal(plain.reason, 'OBJECT_EXCEEDED')
  })

  it('documented precedence: at capacity, the cardinality reject fires before duplicate detection on the excess key', () => {
    // 65th member reuses an existing key: capacity rejects first — still a
    // strict failure, never a false acceptance.
    const text = objectWith(64, ',"m0":1')
    const parsed = parseT15EBoundedJson(text)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.reason, 'OBJECT_EXCEEDED')
  })

  it('duplicate keys BELOW capacity still fail as DUPLICATE_KEY', () => {
    const parsed = parseT15EBoundedJson('{"a":1,"a":2}')
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.reason, 'DUPLICATE_KEY')
  })
})
