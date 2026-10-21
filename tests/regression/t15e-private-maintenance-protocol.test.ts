// Task116 — canonical maintenance prefix protocol (FIRST SMALL PART of pure
// Slice A): script DATA only; decoder is Task117; transport/issuer B1/B2
// separate. PURE/source tests: actual PostgreSQL validity is NOT claimed.
// Synthetic fixtures only; built stdin payloads are NEVER printed/logged —
// assertions are structural. Oversize: the full-builder overflow path is
// unreachable with current catalog caps (64 tables/32 sequences stay well
// under 64 KiB), so the bound checker is unit-tested directly — labeled
// coverage, not a full-builder RED.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  T15E_MAINT_MAX_STDIN_BYTES,
  T15E_MAINT_SECTION_ORDER,
  T15E_MAINT_TRANSPORT_OBLIGATIONS,
  buildT15EMaintenancePrefix,
  checkT15EMaintenanceStdinBound,
} from '../support/native/t15e-private-maintenance-protocol'

const SECRET = 'Synthetic-secret_0123456789abcdef'
const ROLE = 't15e_app_run1'
const CLUSTER = Object.freeze({
  dataDirectory: '/owned-tmp/business-test-x/data',
  databasePort: 20111,
  databaseName: 'app_cleanstart_dev',
})
const CATALOG = Object.freeze({
  tables: [{ schema: 'public', name: 'requests' }, { schema: 'public', name: 'users' }],
  sequences: [{ schema: 'public', name: 'requests_id_seq' }],
})

const build = () => buildT15EMaintenancePrefix({ roleName: ROLE, secret: SECRET, cluster: CLUSTER, catalog: CATALOG })

describe('buildT15EMaintenancePrefix canonical regeneration', () => {
  it('regenerates BEGIN + canonical CREATE/grants + single-snapshot readback, never COMMIT', () => {
    const built = build()
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.equal(built.authority, 'NONE')
    assert.ok(built.stdin.startsWith('BEGIN;\n'))
    assert.match(built.stdin, /CREATE ROLE "t15e_app_run1" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '[^']+';/)
    assert.match(built.stdin, /GRANT CONNECT ON DATABASE "app_cleanstart_dev" TO "t15e_app_run1";/)
    assert.match(built.stdin, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"\."requests" TO "t15e_app_run1";/)
    assert.match(built.stdin, /GRANT USAGE, SELECT ON SEQUENCE "public"\."requests_id_seq" TO "t15e_app_run1";/)
    assert.equal(built.stdin.includes('COMMIT'), false, 'prefix must never COMMIT')
    // The secret appears ONLY inside the CREATE statement payload; the
    // result carries NO redactedStdin field at all (Task116B).
    assert.equal(built.stdin.split(SECRET).length - 1, 1)
    assert.equal('redactedStdin' in built, false)
  })

  it('rejects extra properties: no caller plan/query/SQL/roleOid is ever concatenated', () => {
    for (const extra of [
      { roleOid: 12345 },
      { plan: { stage: 'PLAN' } },
      { sql: 'DROP ROLE x;' },
      { queries: ['select 1'] },
      { stdin: 'BEGIN; COMMIT;' },
    ]) {
      const built = buildT15EMaintenancePrefix({ roleName: ROLE, secret: SECRET, cluster: CLUSTER, catalog: CATALOG, ...extra })
      assert.equal(built.ok, false, JSON.stringify(Object.keys(extra)))
      if (!built.ok) {
        assert.equal(built.category, 'T15E_MAINT_MALFORMED')
        assert.equal(built.stdin, null)
        assert.equal(built.message, 'T15E maintenance prefix failure')
      }
    }
  })

  it('rejects malformed secrets and plan-rejected inputs with fixed categories', () => {
    for (const secret of ['short', "quote'in-secret-0123456789abcdefg", '']) {
      const built = buildT15EMaintenancePrefix({ roleName: ROLE, secret, cluster: CLUSTER, catalog: CATALOG })
      assert.equal(built.ok, false, 'secret case')
      if (!built.ok) assert.equal(built.category, 'T15E_MAINT_MALFORMED')
    }
    const rejected = buildT15EMaintenancePrefix({ roleName: 'not the role shape', secret: SECRET, cluster: CLUSTER, catalog: CATALOG })
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.equal(rejected.category, 'T15E_MAINT_PLAN_REJECTED')
  })

  it('preserves the approved policy vocabulary in the generated script', () => {
    const built = build()
    assert.equal(built.ok, true)
    if (!built.ok) return
    for (const forbidden of ['GRANT ALL', 'GRANT EXECUTE', 'GRANT CREATE', 'ALTER DEFAULT PRIVILEGES', 'REVOKE']) {
      assert.equal(built.stdin.includes(forbidden), false, forbidden)
    }
    // schemaCreate is a READBACK FACT (validator runs in Task117), observed
    // in the snapshot; builtin EXECUTE is observed via PUBLIC grantee 0.
    assert.equal(built.stdin.includes("(has_schema_privilege(r.oid, n.oid, 'CREATE') is true)"), true)
    assert.equal(built.stdin.includes('a.grantee = 0'), true)
    assert.equal(built.stdin.includes('pg_auth_members'), true)
  })
})

describe('single-snapshot framed readback structure', () => {
  it('emits six fixed-order sections, each payload materialized exactly once', () => {
    const built = build()
    assert.equal(built.ok, true)
    if (!built.ok) return
    const stdin = built.stdin
    assert.deepEqual([...built.sectionOrder], [...T15E_MAINT_SECTION_ORDER])
    // Exactly six materialized payload CTEs and six row_to_json renderings.
    assert.equal((stdin.match(/ as materialized \(select row_to_json\(q\.\*\)::text as payload/g) ?? []).length, 6)
    // Fixed section marker order S1..S6.
    let cursor = -1
    for (let n = 1; n <= 6; n++) {
      const begin = stdin.indexOf(`'T15E_MAINT_S${n}_B'`)
      assert.ok(begin > cursor, `section S${n} marker out of order`)
      cursor = begin
      assert.ok(stdin.includes(`'T15E_MAINT_S${n}_E:'`), `trailer marker S${n}`)
    }
    // Every section's payload AND trailer reference the SAME materialized
    // CTE column exactly twice (payload emission + octet_length trailer).
    for (let n = 1; n <= 6; n++) {
      const refs = stdin.match(new RegExp(`s${n}\\.payload`, 'g')) ?? []
      assert.equal(refs.length, 2, `s${n}.payload referenced exactly twice (payload + trailer)`)
      assert.ok(stdin.includes(`octet_length(convert_to(s${n}.payload, 'UTF8'))`), `trailer measures same bytes S${n}`)
    }
    // One statement, one snapshot: a single WITH introducing all six CTEs.
    assert.equal((stdin.match(/\bwith s1 as materialized/g) ?? []).length, 1)
  })

  it('documents frame grammar and transport obligations as data', () => {
    const built = build()
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.match(built.frameGrammar, /T15E_MAINT_S<n>_B\\n<json-payload>\\nT15E_MAINT_S<n>_E:<octets> for n=1\.\.6/)
    assert.match(built.frameGrammar, /EXACTLY ONE LF/)
    assert.match(built.frameGrammar, /EXACTLY ONE terminal LF/)
    assert.deepEqual({ ...built.transportObligations }, { ...T15E_MAINT_TRANSPORT_OBLIGATIONS })
    assert.equal(T15E_MAINT_TRANSPORT_OBLIGATIONS.maxTotalStdoutBytes, 512 * 1024)
    assert.equal(T15E_MAINT_TRANSPORT_OBLIGATIONS.maxStderrBytes, 4 * 1024)
  })
})

describe('stdin bound (64 KiB) — checker unit coverage', () => {
  it('accepts the boundary and rejects oversize/negative/non-integer without fragments', () => {
    assert.deepEqual(checkT15EMaintenanceStdinBound(T15E_MAINT_MAX_STDIN_BYTES), { ok: true })
    for (const length of [T15E_MAINT_MAX_STDIN_BYTES + 1, -1, 0.5, Number.NaN]) {
      const checked = checkT15EMaintenanceStdinBound(length)
      assert.equal(checked.ok, false, String(length))
      if (!checked.ok) assert.equal(checked.category, 'T15E_MAINT_STDIN_OVERFLOW')
    }
  })

  it('a maximal valid catalog stays under the bound (coverage: full-builder overflow unreachable with current caps)', () => {
    const longName = (prefix: string, index: number) => `${prefix}${String(index).padStart(3, '0')}${'x'.repeat(50)}`
    const catalog = {
      tables: Array.from({ length: 64 }, (_, index) => ({ schema: 'public', name: longName('t', index) })),
      sequences: Array.from({ length: 32 }, (_, index) => ({ schema: 'public', name: longName('s', index) })),
    }
    const built = buildT15EMaintenancePrefix({ roleName: ROLE, secret: SECRET, cluster: CLUSTER, catalog })
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.ok(Buffer.byteLength(built.stdin, 'utf8') <= T15E_MAINT_MAX_STDIN_BYTES)
  })
})
