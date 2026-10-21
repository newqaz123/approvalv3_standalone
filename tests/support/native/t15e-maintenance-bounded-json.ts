/**
 * T15E bounded strict JSON (Task118A) — FIRST PART of Task118: strict JSON
 * with DUPLICATE-KEY rejection only. Six-section schema mapping and the full
 * validateT15EAppRoleReadback integration are Task118B. This pure helper is
 * NOT authenticated facts, an SQL snapshot, or a commit proof; arbitrary keys
 * never gain authority (`authority: 'NONE'` on both outcomes).
 *
 * Contract:
 * - Input: primitive string only (typeof check; no coercion, no hooks),
 *   <= 64 KiB UTF-8 bytes. Because the whole input is bounded, every
 *   materialized child is bounded by it — no giant allocations are possible
 *   from a public primitive input.
 * - Grammar: complete strict JSON (JSON whitespace only), no trailing tokens
 *   or comments; NaN/Infinity are not JSON.
 * - Numbers: finite safe-integer-only contract for observed facts. Fractions,
 *   exponents, leading zeros, unsafe rounding (e.g. 2^53+1), overflow, and
 *   the non-canonical signed zero "-0" are fixed NUMBER_INVALID failures.
 *   Range policies (OID 1..4294967295, ports) are Task118B.
 * - Strings: strict escapes; raw control characters (< 0x20, incl. NUL) and
 *   escaped \u0000 rejected; lone UTF-16 surrogates rejected raw AND escaped;
 *   valid emoji (raw or escaped surrogate pair) accepted; decoded strings
 *   <= 4096 UTF-8 bytes.
 * - Duplicate keys: keys are DECODED before comparison (escape-equivalent
 *   keys like role_oid / role_\u006fid are duplicates), checked at ALL
 *   nesting levels independently per object.
 * - Structure bounds enforced DURING traversal (before oversized children
 *   complete): depth <= 16 (root counts), <= 64 object members,
 *   <= 128 array elements, <= 4096 value nodes.
 * - Objects are created with NULL PROTOTYPES (no __proto__ setter surface);
 *   results are deep-frozen and read-only.
 * - Failures are deterministic fixed categories; no raw payload or parser
 *   internals are ever returned.
 */

export const T15E_MAINT_JSON_SAFE_MESSAGE = 'T15E maintenance JSON failure'
export const T15E_MAINT_JSON_MAX_INPUT_BYTES = 64 * 1024
export const T15E_MAINT_JSON_MAX_DEPTH = 16
export const T15E_MAINT_JSON_MAX_OBJECT_MEMBERS = 64
export const T15E_MAINT_JSON_MAX_ARRAY_ELEMENTS = 128
export const T15E_MAINT_JSON_MAX_STRING_BYTES = 4096
export const T15E_MAINT_JSON_MAX_NODES = 4096

export type T15EBoundedJsonFailureReason =
  | 'INPUT_INVALID'
  | 'INPUT_TOO_LARGE'
  | 'DEPTH_EXCEEDED'
  | 'OBJECT_EXCEEDED'
  | 'ARRAY_EXCEEDED'
  | 'STRING_TOO_LARGE'
  | 'NODES_EXCEEDED'
  | 'DUPLICATE_KEY'
  | 'NUMBER_INVALID'
  | 'STRING_INVALID'
  | 'TRAILING_CONTENT'
  | 'SYNTAX'

export type T15EBoundedJsonFailure = {
  ok: false
  authority: 'NONE'
  category: 'T15E_MAINT_JSON_INVALID'
  reason: T15EBoundedJsonFailureReason
  message: string
  value: null
}

export type T15EBoundedJsonOk = {
  ok: true
  authority: 'NONE'
  value: unknown
}

/** Internal failure sentinel — never confusable with parsed JSON data. */
class ParseFail {
  constructor(readonly reason: T15EBoundedJsonFailureReason) {}
}

function fail(reason: T15EBoundedJsonFailureReason): T15EBoundedJsonFailure {
  return { ok: false, authority: 'NONE', category: 'T15E_MAINT_JSON_INVALID', reason, message: T15E_MAINT_JSON_SAFE_MESSAGE, value: null }
}

const HEX_DIGITS = new Set('0123456789abcdefABCDEF'.split(''))

export function parseT15EBoundedJson(input: unknown): T15EBoundedJsonOk | T15EBoundedJsonFailure {
  if (typeof input !== 'string') return fail('INPUT_INVALID')
  if (Buffer.byteLength(input, 'utf8') > T15E_MAINT_JSON_MAX_INPUT_BYTES) return fail('INPUT_TOO_LARGE')

  const text = input
  let pos = 0
  let nodes = 0

  const countNode = (): ParseFail | null => {
    nodes += 1
    return nodes > T15E_MAINT_JSON_MAX_NODES ? new ParseFail('NODES_EXCEEDED') : null
  }

  const skipWs = (): void => {
    while (pos < text.length) {
      const code = text.charCodeAt(pos)
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) pos += 1
      else break
    }
  }

  const hex4 = (): number | null => {
    if (pos + 4 > text.length) return null
    let value = 0
    for (let i = 0; i < 4; i++) {
      const ch = text[pos + i]
      if (!HEX_DIGITS.has(ch)) return null
      value = value * 16 + Number.parseInt(ch, 16)
    }
    pos += 4
    return value
  }

  /** Parse a JSON string literal; returns the DECODED string or failure. */
  const parseString = (): string | ParseFail => {
    if (text.charCodeAt(pos) !== 0x22) return new ParseFail('SYNTAX')
    pos += 1
    let decoded = ''
    while (true) {
      if (pos >= text.length) return new ParseFail('STRING_INVALID') // unterminated
      const code = text.charCodeAt(pos)
      if (code === 0x22) {
        pos += 1
        if (Buffer.byteLength(decoded, 'utf8') > T15E_MAINT_JSON_MAX_STRING_BYTES) return new ParseFail('STRING_TOO_LARGE')
        return decoded
      }
      if (code === 0x5c) {
        pos += 1
        if (pos >= text.length) return new ParseFail('STRING_INVALID')
        const esc = text[pos]
        if (esc === '"') { decoded += '"'; pos += 1 }
        else if (esc === '\\') { decoded += '\\'; pos += 1 }
        else if (esc === '/') { decoded += '/'; pos += 1 }
        else if (esc === 'b') { decoded += '\b'; pos += 1 }
        else if (esc === 'f') { decoded += '\f'; pos += 1 }
        else if (esc === 'n') { decoded += '\n'; pos += 1 }
        else if (esc === 'r') { decoded += '\r'; pos += 1 }
        else if (esc === 't') { decoded += '\t'; pos += 1 }
        else if (esc === 'u') {
          pos += 1
          const unit = hex4()
          if (unit === null) return new ParseFail('STRING_INVALID')
          if (unit === 0x0000) return new ParseFail('STRING_INVALID') // escaped NUL
          if (unit >= 0xdc00 && unit <= 0xdfff) return new ParseFail('STRING_INVALID') // lone low surrogate
          if (unit >= 0xd800 && unit <= 0xdbff) {
            if (text.charCodeAt(pos) !== 0x5c || text.charCodeAt(pos + 1) !== 0x75) return new ParseFail('STRING_INVALID')
            pos += 2
            const low = hex4()
            if (low === null || low < 0xdc00 || low > 0xdfff) return new ParseFail('STRING_INVALID')
            decoded += String.fromCharCode(unit, low)
          } else {
            decoded += String.fromCharCode(unit)
          }
        } else {
          return new ParseFail('STRING_INVALID') // invalid escape
        }
        continue
      }
      if (code < 0x20) return new ParseFail('STRING_INVALID') // raw control char (incl. NUL)
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = pos + 1 < text.length ? text.charCodeAt(pos + 1) : 0
        if (next < 0xdc00 || next > 0xdfff) return new ParseFail('STRING_INVALID') // raw lone high surrogate
        decoded += String.fromCharCode(code, next)
        pos += 2
        continue
      }
      if (code >= 0xdc00 && code <= 0xdfff) return new ParseFail('STRING_INVALID') // raw lone low surrogate
      decoded += text[pos]
      pos += 1
    }
  }

  const parseNumber = (): number | ParseFail => {
    const start = pos
    let negative = false
    if (text.charCodeAt(pos) === 0x2d) {
      negative = true
      pos += 1
    }
    if (pos >= text.length) return new ParseFail('SYNTAX')
    const firstDigit = text.charCodeAt(pos)
    if (firstDigit === 0x30) {
      pos += 1
      if (pos < text.length && text.charCodeAt(pos) >= 0x30 && text.charCodeAt(pos) <= 0x39) {
        return new ParseFail('NUMBER_INVALID') // leading zero
      }
    } else if (firstDigit >= 0x31 && firstDigit <= 0x39) {
      while (pos < text.length && text.charCodeAt(pos) >= 0x30 && text.charCodeAt(pos) <= 0x39) pos += 1
    } else {
      return new ParseFail('SYNTAX')
    }
    if (pos < text.length) {
      const next = text[pos]
      if (next === '.' || next === 'e' || next === 'E') {
        return new ParseFail('NUMBER_INVALID') // fraction/exponent outside the integer contract
      }
    }
    const digits = text.slice(start + (negative ? 1 : 0), pos)
    if (digits.length > 16) return new ParseFail('NUMBER_INVALID') // overflow guard
    const value = negative ? -Number(digits) : Number(digits)
    if (!Number.isSafeInteger(value)) return new ParseFail('NUMBER_INVALID') // unsafe rounding / overflow
    if (negative && value === 0) return new ParseFail('NUMBER_INVALID') // documented: "-0" is non-canonical
    return value
  }

  const parseValue = (depth: number): unknown | ParseFail => {
    // Depth counts CONTAINERS only (the document root container is depth 1);
    // primitives cannot nest and do not consume depth.
    skipWs()
    if (pos >= text.length) return new ParseFail('SYNTAX')
    const code = text.charCodeAt(pos)
    if (code === 0x7b) {
      if (depth > T15E_MAINT_JSON_MAX_DEPTH) return new ParseFail('DEPTH_EXCEEDED')
      const nodeFail = countNode()
      if (nodeFail !== null) return nodeFail
      pos += 1
      const obj: Record<string, unknown> = Object.create(null)
      const seen = new Set<string>()
      skipWs()
      if (text.charCodeAt(pos) === 0x7d) {
        pos += 1
        return obj
      }
      while (true) {
        skipWs()
        const key = parseString()
        if (key instanceof ParseFail) return key
        if (seen.has(key)) return new ParseFail('DUPLICATE_KEY')
        seen.add(key)
        skipWs()
        if (text.charCodeAt(pos) !== 0x3a) return new ParseFail('SYNTAX')
        pos += 1
        const value = parseValue(depth + 1)
        if (value instanceof ParseFail) return value
        obj[key] = value
        skipWs()
        const sep = text.charCodeAt(pos)
        if (sep === 0x7d) { pos += 1; return obj }
        if (sep !== 0x2c) return new ParseFail('SYNTAX')
        // Capacity BEFORE any traversal of the excess member: at capacity a
        // consumed comma implies a next member (strict grammar has no
        // trailing commas), so the 65th member's key AND value are never
        // entered — and the cardinality reject also fires before duplicate
        // detection on an excess key (documented precedence: strict failure,
        // never a false acceptance).
        if (seen.size >= T15E_MAINT_JSON_MAX_OBJECT_MEMBERS) return new ParseFail('OBJECT_EXCEEDED')
        pos += 1
      }
    }
    if (code === 0x5b) {
      if (depth > T15E_MAINT_JSON_MAX_DEPTH) return new ParseFail('DEPTH_EXCEEDED')
      const nodeFail = countNode()
      if (nodeFail !== null) return nodeFail
      pos += 1
      const arr: unknown[] = []
      skipWs()
      if (text.charCodeAt(pos) === 0x5d) {
        pos += 1
        return arr
      }
      while (true) {
        const value = parseValue(depth + 1)
        if (value instanceof ParseFail) return value
        arr.push(value)
        skipWs()
        const sep = text.charCodeAt(pos)
        if (sep === 0x5d) { pos += 1; return arr }
        if (sep !== 0x2c) return new ParseFail('SYNTAX')
        // Capacity BEFORE the excess element's traversal: at capacity a
        // consumed comma implies a next element, so element 129 is never
        // entered (oversized/malformed/deep children report the cardinality
        // failure, not string/depth/syntax).
        if (arr.length >= T15E_MAINT_JSON_MAX_ARRAY_ELEMENTS) return new ParseFail('ARRAY_EXCEEDED')
        pos += 1
      }
    }
    if (code === 0x22) {
      const nodeFail = countNode()
      if (nodeFail !== null) return nodeFail
      return parseString()
    }
    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) {
      const nodeFail = countNode()
      if (nodeFail !== null) return nodeFail
      return parseNumber()
    }
    if (text.startsWith('true', pos)) { pos += 4; const f = countNode(); if (f !== null) return f; return true }
    if (text.startsWith('false', pos)) { pos += 5; const f = countNode(); if (f !== null) return f; return false }
    if (text.startsWith('null', pos)) { pos += 4; const f = countNode(); if (f !== null) return f; return null }
    return new ParseFail('SYNTAX')
  }

  const root = parseValue(1)
  if (root instanceof ParseFail) return fail(root.reason)
  skipWs()
  if (pos !== text.length) return fail('TRAILING_CONTENT')

  const deepFreeze = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) deepFreeze(item)
    } else {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        deepFreeze((value as Record<string, unknown>)[key])
      }
    }
    Object.freeze(value)
  }
  deepFreeze(root)

  return { ok: true, authority: 'NONE', value: root }
}
