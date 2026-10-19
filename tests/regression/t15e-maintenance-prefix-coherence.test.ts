// Task116B — two prefix coherence P1s. PURE tests against CURRENT source,
// assertion-RED before fixes:
//  1. Newline framing: exactly one LF between sections; exactly one terminal
//     LF total (the psql record terminator); last embedded payload has NO
//     additional final LF; non-ASCII payload trailers measure the SAME bytes.
//  2. Input snapshot: every caller property read EXACTLY ONCE; CREATE uses
//     the CANONICAL plan role name; no redactedStdin in the result; secrets
//     never appear in diagnostics/metadata.
// No actual psql permitted — the byte model TRACES the emitted SQL
// composition, it does not execute it.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildT15EMaintenancePrefix } from '../support/native/t15e-private-maintenance-protocol'

const SECRET = 'Synthetic-secret-0123456789abcdef'
const OTHER_SECRET = 'Other-secret-0123456789abcdefg'
const CLUSTER = Object.freeze({ dataDirectory: '/owned-tmp/x/data', databasePort: 20111, databaseName: 'app_cleanstart_dev' })
const CATALOG = Object.freeze({
  tables: [{ schema: 'public', name: 'requests' }],
  sequences: [{ schema: 'public', name: 'requests_id_seq' }],
})

const buildPlain = () => buildT15EMaintenancePrefix({ roleName: 't15e_app_run1', secret: SECRET, cluster: CLUSTER, catalog: CATALOG })

/** Extract the single-snapshot final statement from the built script. */
function snapshotStatement(stdin: string): string {
  const start = stdin.indexOf('with s1 as materialized')
  assert.ok(start >= 0, 'snapshot statement present')
  return stdin.slice(start)
}

describe('P1-1 exact-byte newline framing (output model traces the emitted SQL composition)', () => {
  it('has no double-LF composition anywhere: no adjacent chr(10) concatenations', () => {
    const built = buildPlain()
    assert.equal(built.ok, true)
    if (!built.ok) return
    const statement = snapshotStatement(built.stdin)
    assert.equal(statement.includes('chr(10) || chr(10)'), false, 'adjacent LF concatenations must not exist')
  })

  it('last section embeds NO additional final LF: the select ends with the S6 trailer, not chr(10)', () => {
    const built = buildPlain()
    assert.equal(built.ok, true)
    if (!built.ok) return
    const statement = snapshotStatement(built.stdin)
    const fromAt = statement.indexOf('\nfrom ')
    assert.ok(fromAt > 0)
    const expression = statement.slice(0, fromAt)
    assert.ok(!/\|\| chr\(10\)\s*$/.test(expression), 'expression must end with the trailer, not a trailing LF')
    assert.match(expression, /octet_length\(convert_to\(s6\.payload, 'UTF8'\)\)$/)
  })

  it('model: each section is marker/LF/payload/LF/trailer, joined by exactly one LF — simulated stream has single separators, one terminal LF, and same-byte non-ASCII trailers', () => {
    const built = buildPlain()
    assert.equal(built.ok, true)
    if (!built.ok) return
    const statement = snapshotStatement(built.stdin)
    const expression = statement.slice(0, statement.indexOf('\nfrom '))
    // Trace the composition skeleton exactly as the SQL composes it.
    const sections: Array<{ marker: string; payloadAlias: string }> = []
    for (let n = 1; n <= 6; n++) {
      const pattern = new RegExp(
        `'T15E_MAINT_S${n}_B' \\|\\| chr\\(10\\) \\|\\| s${n}\\.payload \\|\\| chr\\(10\\) \\|\\| 'T15E_MAINT_S${n}_E:' \\|\\| octet_length\\(convert_to\\(s${n}\\.payload, 'UTF8'\\)\\)`,
      )
      assert.match(expression, pattern, `exact section skeleton S${n} (marker/LF/payload/LF/trailer, no trailing LF)`)
      sections.push({ marker: `T15E_MAINT_S${n}`, payloadAlias: `s${n}` })
    }
    // Sections joined by exactly ONE LF composition, fixed order S1..S6
    // (trailer-end -> single chr(10) -> next begin-marker, five times).
    const joins = expression.match(/octet_length\(convert_to\(s\d\.payload, 'UTF8'\)\) \|\| chr\(10\) \|\| 'T15E_MAINT_S\d_B'/g) ?? []
    assert.equal(joins.length, 5, 'exactly five single-LF section joins')
    // Simulate the emitted byte stream with synthetic payloads — including a
    // multi-byte non-ASCII payload — using the traced composition: the model
    // stream ends WITHOUT an embedded LF; the single terminal LF below models
    // the psql record terminator only.
    const payloads = [
      '{"k":"v"}',
      '{"schemaCreate":false}',
      '{"tables":["requests"]}',
      '{"sequences":["requests_id_seq"]}',
      '{"unpinned":[]}',
      `{"grants":["shield${String.fromCodePoint(0x1f6e1)}"]}`,
    ]
    const model = sections
      .map((section, index) => `${section.marker}_B\n${payloads[index]}\n${section.marker}_E:${Buffer.byteLength(payloads[index], 'utf8')}`)
      .join('\n') + '\n'
    assert.equal(model.includes('\n\n'), false, 'exactly one LF between sections, none doubled')
    assert.equal(model.endsWith('\n'), true)
    assert.equal(model.endsWith('\n\n'), false, 'exactly one terminal LF (psql record terminator)')
    // Same-bytes trailer check: multi-byte payload's trailer counts BYTES,
    // not UTF-16 code units.
    const emojiPayload = payloads[5]
    assert.ok(Buffer.byteLength(emojiPayload, 'utf8') !== emojiPayload.length, 'fixture must be multi-byte')
    assert.equal(model.includes(`T15E_MAINT_S6_E:${Buffer.byteLength(emojiPayload, 'utf8')}`), true)
  })
})

describe('P1-2 input snapshot: capture once, canonical role, no secret leakage', () => {
  const makeGetterInput = () => {
    let roleReads = 0
    let secretReads = 0
    return {
      input: {
        get roleName() { roleReads += 1; return roleReads === 1 ? 't15e_app_alpha' : 't15e_app_beta' },
        get secret() { secretReads += 1; return secretReads === 1 ? SECRET : OTHER_SECRET },
        cluster: { ...CLUSTER } as { dataDirectory: string; databasePort: number; databaseName: string },
        catalog: { tables: [...CATALOG.tables], sequences: [...CATALOG.sequences] },
      },
      roleReads: () => roleReads,
      secretReads: () => secretReads,
    }
  }

  it('reads roleName and secret exactly once and builds a coherent script from the captured values', () => {
    const harness = makeGetterInput()
    const built = buildT15EMaintenancePrefix(harness.input)
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.ok(harness.roleReads() <= 1, `roleName read ${harness.roleReads()} times`)
    assert.ok(harness.secretReads() <= 1, `secret read ${harness.secretReads()} times`)
    // Coherence: ONE captured role everywhere — CREATE uses the canonical
    // plan role name; a second-read role must not appear anywhere.
    assert.equal(built.stdin.includes('"t15e_app_alpha"'), true)
    assert.equal(built.stdin.includes('"t15e_app_beta"'), false)
    assert.equal(built.stdin.includes('t15e_app_beta'), false)
    // The FIRST secret value is the ephemeral stdin secret, exactly once.
    assert.equal(built.stdin.split(SECRET).length - 1, 1)
    assert.equal(built.stdin.includes(OTHER_SECRET), false)
  })

  it('removes redactedStdin from the result; diagnostics and metadata never contain either secret value', () => {
    const harness = makeGetterInput()
    const built = buildT15EMaintenancePrefix(harness.input)
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.equal('redactedStdin' in built, false, 'redactedStdin must not exist in the new prefix result')
    const { stdin: _ephemeralStdin, ...rest } = built
    const serialized = JSON.stringify(rest)
    assert.equal(serialized.includes(SECRET), false)
    assert.equal(serialized.includes(OTHER_SECRET), false)
  })

  it('getter divergence on the failure path cannot leak or half-build', () => {
    const harness = makeGetterInput()
    const invalidCluster: { dataDirectory: string; databasePort: number; databaseName: string } = {
      dataDirectory: 'relative/path',
      databasePort: 20111,
      databaseName: 'app_cleanstart_dev',
    }
    harness.input.cluster = invalidCluster
    const built = buildT15EMaintenancePrefix(harness.input)
    assert.equal(built.ok, false)
    if (built.ok) return
    assert.equal(built.stdin, null)
    assert.equal('redactedStdin' in built, false)
    assert.equal(JSON.stringify(built).includes(SECRET), false)
    assert.ok(harness.secretReads() <= 1, `secret read ${harness.secretReads()} times on failure path`)
  })
})
