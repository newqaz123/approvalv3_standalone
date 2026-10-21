// Task118B2 — composition integrity P1s against CURRENT code:
//  1. Sections 3/4 wire field is `relations` (source: relationJson emits
//     `end as relations`; prefix whole-row preserves it) — old
//     `{tables:...}`/`{sequences:...}` section shapes must be REJECTED.
//  2. EMPTY relations permitted ONLY for sequences when the canonical plan
//     catalog has zero sequences (plan requires >=1 table).
//  3. Contained boundary: revoked-proxy isRecord probe and nested
//     cluster-getter exceptions during plan regeneration are FIXED failures.
//  4. Validated identity is frozen before publish (data-only, readonly).
// Synthetic fixtures matching the generated aliases only — NOT actual PG
// validity. sqlOk stays caller test-domain data, never SQL provenance.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateT15EMaintenanceReadback } from '../support/native/t15e-maintenance-readback-schema'

const ROLE = 't15e_app_run1'
const CLUSTER = Object.freeze({ dataDirectory: '/owned-tmp/x/data', databasePort: 20111, databaseName: 'app_cleanstart_dev' })
const TABLES = Object.freeze([{ schema: 'public', name: 'requests' }, { schema: 'public', name: 'users' }])
const SEQS = Object.freeze([{ schema: 'public', name: 'requests_id_seq' }])

const identityPayload = (port = 20111) =>
  `{"role_name":"${ROLE}","role_oid":4242,"rolcanlogin":true,"rolsuper":false,"rolcreatedb":false,"rolcreaterole":false,"rolinherit":false,"membership_role_oids":[],"database_name":"app_cleanstart_dev","database_oid":16384,"data_directory":"/owned-tmp/x/data","database_port":${port},"server_version_num":160001}`
const effectivePayload = '{"database_connect":true,"database_temp":true,"schema_create":false,"schema_usage":true,"public_builtin_execute":true}'

const frame = (n: number, payload: string): Buffer =>
  Buffer.from(`T15E_MAINT_S${n}_B\n${payload}\nT15E_MAINT_S${n}_E:${Buffer.byteLength(payload, 'utf8')}`, 'utf8')
const wire = (sections: readonly string[]): Buffer =>
  Buffer.concat(sections.flatMap((payload, index) => [frame(index + 1, payload), Buffer.from('\n', 'utf8')]))

type Call = { tables: typeof TABLES; sequences: typeof SEQS; s3: string; s4: string; sqlOk?: boolean }
const call = (opts: Call) => validateT15EMaintenanceReadback({
  roleName: ROLE,
  cluster: { ...CLUSTER },
  catalog: { tables: opts.tables.map((t) => ({ ...t })), sequences: opts.sequences.map((sq) => ({ ...sq })) },
  frames: wire([
    identityPayload(),
    effectivePayload,
    opts.s3,
    opts.s4,
    '{"unpinned_accessible":[]}',
    '{"user_defined_function_grants":[]}',
  ]),
  sqlOk: opts.sqlOk ?? true,
})

const canonicalS3 = (names: readonly string[]): string =>
  `{"relations":[${names.map((name) => `{"schema":"public","name":"${name}","privileges":["SELECT","INSERT","UPDATE","DELETE"]}`).join(',')}]}`
const canonicalS4 = (names: readonly string[]): string =>
  `{"relations":[${names.map((name) => `{"schema":"public","name":"${name}","privileges":["USAGE","SELECT"]}`).join(',')}]}`

describe('P1-1 canonical `relations` alias (source-pinned)', () => {
  it('RED: canonical alias sections succeed end-to-end', () => {
    const result = call({ tables: TABLES, sequences: SEQS, s3: canonicalS3(['requests', 'users']), s4: canonicalS4(['requests_id_seq']) })
    assert.equal(result.ok, true)
  })

  it('old wrong {tables}/{sequences} section shapes are rejected even when otherwise valid', () => {
    for (const [s3, s4] of [
      ['{"tables":[{"schema":"public","name":"requests","privileges":["SELECT","INSERT","UPDATE","DELETE"]}]}', canonicalS4(['requests_id_seq'])],
      [canonicalS3(['requests', 'users']), '{"sequences":[{"schema":"public","name":"requests_id_seq","privileges":["USAGE","SELECT"]}]}'],
    ] as const) {
      const result = call({ tables: TABLES, sequences: SEQS, s3, s4 })
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.reason, 'SECTION_SCHEMA_INVALID')
    }
  })

  it('static contract: relationJson emits `as relations` and the prefix preserves whole rows', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const plan = readFileSync(new URL('../support/native/t15e-app-role-plan.ts', import.meta.url), 'utf8')
    assert.match(plan, /end as relations from pg_roles r where/)
    const prefix = readFileSync(new URL('../support/native/t15e-private-maintenance-protocol.ts', import.meta.url), 'utf8')
    assert.match(prefix, /row_to_json\(q\.\*\)::text as payload/)
  })
})

describe('P1-2 empty relations only for empty canonical sequences', () => {
  it('RED: canonical plan with zero sequences + {"relations":[]} succeeds', () => {
    const result = call({ tables: TABLES, sequences: [], s3: canonicalS3(['requests', 'users']), s4: '{"relations":[]}' })
    assert.equal(result.ok, true)
  })

  it('nonempty sequence plan + empty readback still fails the approved validator (GRANT_MISMATCH)', () => {
    const result = call({ tables: TABLES, sequences: SEQS, s3: canonicalS3(['requests', 'users']), s4: '{"relations":[]}' })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'VALIDATOR_REJECTED')
      assert.equal(result.category, 'T15E_APP_ROLE_GRANT_MISMATCH')
    }
  })
})

describe('P1-3 contained boundary (fixed failures, raw throws discarded)', () => {
  it('RED: revoked proxy maps to fixed INPUT_INVALID, never a raw throw', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    const result = validateT15EMaintenanceReadback(proxy)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'INPUT_INVALID')
      assert.equal(result.value, null)
    }
  })

  it('RED: nested cluster getter throwing during plan regeneration is a fixed PLAN_REJECTED (documented classification)', () => {
    const hostile = {
      roleName: ROLE,
      cluster: {
        get databasePort(): number { throw new Error('nested boom') },
        dataDirectory: CLUSTER.dataDirectory,
        databaseName: CLUSTER.databaseName,
      },
      catalog: { tables: TABLES.map((t) => ({ ...t })), sequences: SEQS.map((s) => ({ ...s })) },
      frames: wire([identityPayload(), effectivePayload, canonicalS3(['requests']), canonicalS4(['requests_id_seq']), '{"unpinned_accessible":[]}', '{"user_defined_function_grants":[]}']),
      sqlOk: true,
    }
    const result = validateT15EMaintenanceReadback(hostile)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'PLAN_REJECTED')
      assert.equal(JSON.stringify(result).includes('nested boom'), false)
      assert.equal(result.value, null)
    }
  })
})

describe('P2 frozen validated identity (data-only readonly)', () => {
  it('RED: identity is frozen before publish and mutation cannot change it', () => {
    const result = call({ tables: TABLES, sequences: SEQS, s3: canonicalS3(['requests', 'users']), s4: canonicalS4(['requests_id_seq']) })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(Object.isFrozen(result.identity), true)
    const before = { ...result.identity }
    try {
      ;(result.identity as unknown as Record<string, unknown>).roleOid = 99999
    } catch {
      // frozen objects throw in strict mode — also acceptable
    }
    assert.deepEqual({ ...result.identity }, before)
    assert.equal(Object.isFrozen(result.facts), true)
  })
})
