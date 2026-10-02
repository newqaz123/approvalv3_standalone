// Task118A — FIRST PART of Task118: bounded STRICT JSON with DUPLICATE-KEY
// rejection ONLY. The six-section schema mapping and the full
// validateT15EAppRoleReadback integration are Task118B. This pure helper is
// NOT authenticated facts, an SQL snapshot, or a commit proof. Synthetic
// fixtures only; no raw JSON/parser errors are ever returned or logged.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseT15EBoundedJson } from '../support/native/t15e-maintenance-bounded-json'

describe('valid strict JSON', () => {
  it('parses simple and nested data into deep-frozen null-prototype objects', () => {
    const parsed = parseT15EBoundedJson('{"a":1,"nested":{"b":[true,false,null,"x"]}}')
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.authority, 'NONE')
    const root = parsed.value as Record<string, unknown>
    assert.equal(Object.getPrototypeOf(root), null)
    const nested = root.nested as Record<string, unknown>
    assert.equal(nested.b !== undefined, true)
    assert.equal(Object.isFrozen(root), true)
    assert.equal(Object.isFrozen(nested), true)
    assert.equal(Object.isFrozen(nested.b), true)
  })

  it('supports raw and escaped emoji, escaped quotes/backslash/control chars', () => {
    const emoji = String.fromCodePoint(0x1f6e1)
    const parsed = parseT15EBoundedJson(
      `{"raw":"shield${emoji}","esc":"shield\\ud83d\\udee1","q":"a\\"b","bs":"c\\\\d","nl":"e\\nf","tab":"g\\th","slash":"h/i"}`,
    )
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const root = parsed.value as Record<string, string>
    assert.equal(root.raw, `shield${emoji}`)
    assert.equal(root.esc, `shield${emoji}`)
    assert.equal(root.q, 'a"b')
    assert.equal(root.bs, 'c\\d')
    assert.equal(root.nl, 'e\nf')
    assert.equal(root.slash, 'h/i')
  })
})

describe('duplicate-key rejection (decoded keys, all nesting levels)', () => {
  const rejects = (text: string): void => {
    const parsed = parseT15EBoundedJson(text)
    assert.equal(parsed.ok, false, text)
    if (!parsed.ok) {
      assert.equal(parsed.category, 'T15E_MAINT_JSON_INVALID')
      if (parsed.reason !== 'DUPLICATE_KEY') assert.equal(parsed.reason, 'DUPLICATE_KEY')
      assert.equal(parsed.value, null)
    }
  }

  it('rejects direct duplicates', () => {
    rejects('{"a":1,"a":2}')
  })

  it('rejects escape-equivalent duplicates (role_oid vs role_\\u006fid)', () => {
    rejects('{"role_oid":1,"role_\\u006fid":2}')
  })

  it('rejects duplicates in nested objects and inside arrays', () => {
    rejects('{"outer":{"inner":{"x":1,"x":2}}}')
    rejects('{"list":[{"y":1},{"y":2,"y":3}]}')
    rejects('{"a":{"b":1},"c":{"b":1,"b":2}}')
  })

  it('same key in DIFFERENT sibling objects is not a duplicate', () => {
    const parsed = parseT15EBoundedJson('{"one":{"k":1},"two":{"k":2}}')
    assert.equal(parsed.ok, true)
  })
})

describe('depth and structural bounds', () => {
  const nest = (depth: number): string => {
    let text = '1'
    for (let i = 0; i < depth; i++) text = `[${text}]`
    return text
  }

  it('accepts depth 16 and rejects depth 17 (document root counts)', () => {
    assert.equal(parseT15EBoundedJson(nest(16)).ok, true)
    const deep = parseT15EBoundedJson(nest(17))
    assert.equal(deep.ok, false)
    if (!deep.ok) assert.equal(deep.reason, 'DEPTH_EXCEEDED')
  })

  it('enforces object member and array element bounds (off-by-one edges)', () => {
    const members = (count: number): string => `{"m${'x'.repeat(0)}0":0` + Array.from({ length: count - 1 }, (_, i) => `,"m${i + 1}":${i + 1}`).join('') + '}'
    assert.equal(parseT15EBoundedJson(members(64)).ok, true)
    const over = parseT15EBoundedJson(members(65))
    assert.equal(over.ok, false)
    if (!over.ok) assert.equal(over.reason, 'OBJECT_EXCEEDED')
    const elements = (count: number): string => `[${Array.from({ length: count }, (_, i) => i).join(',')}]`
    assert.equal(parseT15EBoundedJson(elements(128)).ok, true)
    const overArray = parseT15EBoundedJson(elements(129))
    assert.equal(overArray.ok, false)
    if (!overArray.ok) assert.equal(overArray.reason, 'ARRAY_EXCEEDED')
  })

  it('enforces node, decoded-string, and input byte bounds', () => {
    // 64 objects x 64 members exceeds 4096 nodes within member bounds.
    const big = `{"list":[${Array.from({ length: 64 }, (_, i) => `{"k${i}":0${Array.from({ length: 63 }, (_, j) => `,"f${j}":${j}`).join('')}}`).join(',')}]}`
    assert.ok(Buffer.byteLength(big, 'utf8') <= 64 * 1024)
    const nodes = parseT15EBoundedJson(big)
    assert.equal(nodes.ok, false)
    if (!nodes.ok) assert.equal(nodes.reason, 'NODES_EXCEEDED')
    const longString = `{"s":"${'a'.repeat(4096)}"}`
    assert.equal(parseT15EBoundedJson(longString).ok, true)
    const overString = parseT15EBoundedJson(`{"s":"${'a'.repeat(4097)}"}`)
    assert.equal(overString.ok, false)
    if (!overString.ok) assert.equal(overString.reason, 'STRING_TOO_LARGE')
    const oversizeInput = parseT15EBoundedJson(`"${'b'.repeat(64 * 1024 + 1)}"`)
    assert.equal(oversizeInput.ok, false)
    if (!oversizeInput.ok) assert.equal(oversizeInput.reason, 'INPUT_TOO_LARGE')
  })
})

describe('strict number contract (finite safe integers only)', () => {
  const rejectsNumber = (text: string): void => {
    const parsed = parseT15EBoundedJson(text)
    assert.equal(parsed.ok, false, text)
    if (!parsed.ok) assert.equal(parsed.reason, 'NUMBER_INVALID', text)
  }

  it('accepts canonical safe integers including edge values', () => {
    for (const text of ['0', '1', '-1', '4294967295', '9007199254740991']) {
      assert.equal(parseT15EBoundedJson(text).ok, true, text)
    }
  })

  it('rejects fractions, exponents, leading zeros, unsafe rounding, overflow, and -0', () => {
    for (const text of ['1.5', '1e3', '1E3', '01', '-01', '9007199254740993', '99999999999999999999', '-0']) {
      rejectsNumber(text)
    }
  })

  it('rejects NaN/Infinity and bare minus as syntax failures', () => {
    for (const text of ['NaN', 'Infinity', '-Infinity', '-']) {
      assert.equal(parseT15EBoundedJson(text).ok, false, text)
    }
  })
})

describe('string escapes, surrogates, and grammar strictness', () => {
  const rejects = (text: string): void => {
    assert.equal(parseT15EBoundedJson(text).ok, false, JSON.stringify(text))
  }

  it('rejects invalid escapes, control characters, NUL, and lone surrogates (raw and escaped)', () => {
    rejects('{"a":"x\\q"}') // invalid escape
    rejects('{"a":"x\ny"}') // raw control char
    rejects(`{"a":"x${String.fromCharCode(0x01)}y"}`) // raw control
    rejects('{"a":"x\\u0000y"}') // escaped NUL
    rejects(`{"a":"x${String.fromCharCode(0)}y"}`) // raw NUL
    rejects('{"a":"x\\ud800y"}') // escaped lone high surrogate
    rejects('{"a":"x\\udc00y"}') // escaped lone low surrogate
    rejects(`{"a":"x${String.fromCharCode(0xd800)}y"}`) // raw lone high surrogate
    rejects('{"a":"unterminated') // unterminated string
  })

  it('rejects trailing content, trailing commas, and comments', () => {
    rejects('{"a":1} {"b":2}')
    rejects('{"a":1,}')
    rejects('[1,]')
    rejects('{"a":/*c*/1}')
    rejects('  {"a":1}  x')
  })

  it('accepts surrounding JSON whitespace exactly (space, tab, LF, CR)', () => {
    assert.equal(parseT15EBoundedJson(' \t\r\n{"a":1}\r\n\t ').ok, true)
  })
})

describe('input contract and result hygiene', () => {
  it('accepts primitive strings only — no coercion, no hooks', () => {
    for (const bad of [42, null, undefined, {}, ['[]'], true, Symbol('x')]) {
      const parsed = parseT15EBoundedJson(bad as unknown as string)
      assert.equal(parsed.ok, false, String(typeof bad))
      if (!parsed.ok) assert.equal(parsed.reason, 'INPUT_INVALID')
    }
  })

  it('failures carry fixed diagnostics only — no raw JSON or parser internals', () => {
    const parsed = parseT15EBoundedJson('{"weird key with spaces":NaN}')
    assert.equal(parsed.ok, false)
    if (!parsed.ok) {
      assert.equal(parsed.message, 'T15E maintenance JSON failure')
      assert.equal(parsed.value, null)
      assert.equal(JSON.stringify(parsed).includes('weird key'), false)
      assert.equal(JSON.stringify(parsed).includes('NaN'), false)
    }
  })

  it('arbitrary keys do not gain authority (authority stays NONE)', () => {
    const parsed = parseT15EBoundedJson('{"__proto__":{"x":1},"authority":"MINT","ok":true}')
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.authority, 'NONE')
    const root = parsed.value as Record<string, unknown>
    assert.equal(Object.getPrototypeOf(root), null, '__proto__ stays an own data key, no setter')
    assert.deepEqual(Object.keys(root).sort(), ['__proto__', 'authority', 'ok'])
  })
})
