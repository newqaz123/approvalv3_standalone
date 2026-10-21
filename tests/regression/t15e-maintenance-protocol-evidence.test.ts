// Task122 — findings 4/5/6 + secret/chronology P2s against CURRENT code.
// Findings 1/2/3 (byte copy, input exception, nested clone) remain Task123
// and are explicitly NOT claimed fixed here. Synthetic fixtures only.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildT15EMaintenanceProtocolScripts,
  decideT15EMaintenanceTail,
  modelT15EMaintenanceTail,
} from '../support/native/t15e-maintenance-protocol-core'

const ROLE = 't15e_app_run1'
const SECRET = 'Synthetic-secret-0123456789abcdef'
const NONCE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const CLUSTER = Object.freeze({ dataDirectory: '/owned-tmp/x/data', databasePort: 20111, databaseName: 'app_cleanstart_dev' })
const CATALOG = Object.freeze({
  tables: [{ schema: 'public', name: 'requests' }, { schema: 'public', name: 'users' }],
  sequences: [{ schema: 'public', name: 'requests_id_seq' }],
})

const scripts = () => buildT15EMaintenanceProtocolScripts({
  roleName: ROLE, secret: SECRET, cluster: { ...CLUSTER },
  catalog: { tables: CATALOG.tables.map((t) => ({ ...t })), sequences: CATALOG.sequences.map((s) => ({ ...s })) },
  nonce: NONCE,
})

const sectionBytes = (n: number, payload: string): Buffer =>
  Buffer.from(`T15E_MAINT_S${n}_B\n${payload}\nT15E_MAINT_S${n}_E:${Buffer.byteLength(payload, 'utf8')}`, 'utf8')
const framesBytes = (payloads: readonly string[]): Buffer =>
  Buffer.concat(payloads.flatMap((payload, index) => [sectionBytes(index + 1, payload), Buffer.from('\n', 'utf8')]))
const healthy = (): readonly string[] => [
  `{"role_name":"${ROLE}","role_oid":4242,"rolcanlogin":true,"rolsuper":false,"rolcreatedb":false,"rolcreaterole":false,"rolinherit":false,"membership_role_oids":[],"database_name":"app_cleanstart_dev","database_oid":16384,"data_directory":"/owned-tmp/x/data","database_port":20111,"server_version_num":160001}`,
  '{"database_connect":true,"database_temp":true,"schema_create":false,"schema_usage":true,"public_builtin_execute":true}',
  '{"relations":[{"schema":"public","name":"requests","privileges":["SELECT","INSERT","UPDATE","DELETE"]},{"schema":"public","name":"users","privileges":["SELECT","INSERT","UPDATE","DELETE"]}]}',
  '{"relations":[{"schema":"public","name":"requests_id_seq","privileges":["USAGE","SELECT"]}]}',
  '{"unpinned_accessible":[]}',
  '{"user_defined_function_grants":[]}',
]
const ack = (nonce: string): Buffer => Buffer.from(`T15E_MAINT_ACK_READBACK_${nonce}\n`, 'utf8')
const stream = (payloads: readonly string[], nonce: string): Buffer => Buffer.concat([framesBytes(payloads), ack(nonce)])

describe('P4: decideT15EMaintenanceTail internally demuxes the full chunk batch', () => {
  it('RED: bare 6 frames WITHOUT READBACK_ACK can never COMMIT -> UNKNOWN', () => {
    const built = scripts()
    assert.equal(built.ok, true)
    if (!built.ok) return
    const result = decideT15EMaintenanceTail({ scripts: built, chunks: [framesBytes(healthy())] })
    assert.equal(result.ok, false, 'missing ACK must be UNKNOWN')
    if (!result.ok) assert.equal(result.reason, 'UNKNOWN_TXN')
  })

  it('correct ACK + valid facts -> COMMIT; wrong/stale/extra/coalesced-garbage ACK -> UNKNOWN', () => {
    const built = scripts()
    assert.equal(built.ok, true)
    if (!built.ok) return
    const good = decideT15EMaintenanceTail({ scripts: built, chunks: [stream(healthy(), NONCE)] })
    assert.equal(good.ok, true)
    if (good.ok) assert.equal(good.tail, 'COMMIT')
    for (const chunks of [
      [Buffer.concat([framesBytes(healthy()), ack('f'.repeat(64))])], // wrong nonce
      [framesBytes(healthy()), ack(NONCE), ack(NONCE)], // extra ack
      [Buffer.concat([stream(healthy(), NONCE), Buffer.from('garbage')])], // coalesced garbage
      [framesBytes(healthy())], // missing
    ] as const) {
      const result = decideT15EMaintenanceTail({ scripts: built, chunks: [...chunks] })
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.reason, 'UNKNOWN_TXN')
    }
  })
})

describe('P5: ROLLBACK eligibility is discriminated and truthful', () => {
  it('RED: schema-identity-missing readback -> UNKNOWN, not ROLLBACK', () => {
    const built = scripts()
    assert.equal(built.ok, true)
    if (!built.ok) return
    const missingIdentity = [...healthy()]
    missingIdentity[0] = '{"role_oid":4242}' // identity schema broken
    const result = decideT15EMaintenanceTail({ scripts: built, chunks: [stream(missingIdentity, NONCE)] })
    assert.equal(result.ok, false, 'schema failure must be UNKNOWN')
    if (!result.ok) assert.equal(result.reason, 'UNKNOWN_TXN')
  })

  it('RED: genuine policy rejection reports readback.ok false truthfully (no ok:true null facts)', () => {
    const built = scripts()
    assert.equal(built.ok, true)
    if (!built.ok) return
    const superuser = [...healthy()]
    superuser[0] = superuser[0].replace('"rolsuper":false', '"rolsuper":true')
    const result = decideT15EMaintenanceTail({ scripts: built, chunks: [stream(superuser, NONCE)] })
    assert.equal(result.ok, true, 'healthy ACK + policy rejection => fixed ROLLBACK decision')
    if (!result.ok) return
    assert.equal(result.tail, 'ROLLBACK')
    assert.equal(result.readback.ok, false, 'reported readback failure must be truthful')
    if (!result.readback.ok) {
      assert.equal(result.readback.category, 'T15E_APP_ROLE_FLAGS')
      assert.equal(result.readback.facts, null)
      assert.equal(result.readback.identity, null)
    }
  })

  it('schemaCREATE and membership policy rejections are also fixed ROLLBACK', () => {
    const built = scripts()
    assert.equal(built.ok, true)
    if (!built.ok) return
    const schemaCreate = [...healthy()]
    schemaCreate[1] = schemaCreate[1].replace('"schema_create":false', '"schema_create":true')
    const r1 = decideT15EMaintenanceTail({ scripts: built, chunks: [stream(schemaCreate, NONCE)] })
    assert.equal(r1.ok, true)
    if (r1.ok) assert.equal(r1.tail, 'ROLLBACK')
    const membership = [...healthy()]
    membership[0] = membership[0].replace('"membership_role_oids":[]', '"membership_role_oids":[99]')
    const r2 = decideT15EMaintenanceTail({ scripts: built, chunks: [stream(membership, NONCE)] })
    assert.equal(r2.ok, true)
    if (r2.ok) assert.equal(r2.tail, 'ROLLBACK')
  })

  it('malformed JSON inside a section -> UNKNOWN (not ROLLBACK, no tail)', () => {
    const built = scripts()
    assert.equal(built.ok, true)
    if (!built.ok) return
    const badJson = [...healthy()]
    badJson[2] = '{"relations":['
    const result = decideT15EMaintenanceTail({ scripts: built, chunks: [stream(badJson, NONCE)] })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'UNKNOWN_TXN')
  })
})

describe('P6: modelT15EMaintenanceTail guarded once, closed expected', () => {
  it('RED: divergent expected getter (COMMIT first, ROLLBACK second) cannot confirm ROLLBACK from ROLLBACK tag + COMMIT ack', () => {
    let reads = 0
    const hostile = {
      nonce: NONCE,
      get expected(): string { reads += 1; return reads === 1 ? 'COMMIT' : 'ROLLBACK' },
      tagLine: 'ROLLBACK\n',
      ackLine: `T15E_MAINT_ACK_COMMIT_${NONCE}\n`,
    }
    const result = modelT15EMaintenanceTail(hostile as unknown as Parameters<typeof modelT15EMaintenanceTail>[0])
    assert.equal(result.outcome, 'UNKNOWN_COMMIT_NOT_CONFIRMED', 'captured-once expected must interpret against COMMIT')
    assert.ok(reads <= 1, `expected read ${reads} times`)
  })

  it('RED: invalid expected strings are a fixed UNKNOWN before any ACK interpretation', () => {
    for (const expected of ['commit', 'ABORT', '', 'Commit'] as const) {
      const result = modelT15EMaintenanceTail({ nonce: NONCE, expected, tagLine: 'COMMIT\n', ackLine: `T15E_MAINT_ACK_COMMIT_${NONCE}\n` } as unknown as Parameters<typeof modelT15EMaintenanceTail>[0])
      assert.equal(result.outcome, 'UNKNOWN_EVIDENCE_INVALID', String(expected))
    }
  })

  it('throwing getter and revoked proxy are guarded fixed UNKNOWN with no raw error', () => {
    const hostile: Record<string, unknown> = { nonce: NONCE, expected: 'COMMIT', tagLine: 'COMMIT\n', ackLine: `T15E_MAINT_ACK_COMMIT_${NONCE}\n` }
    Object.defineProperty(hostile, 'tagLine', { enumerable: true, get() { throw new Error('tag boom') } })
    const thrown = modelT15EMaintenanceTail(hostile as unknown as Parameters<typeof modelT15EMaintenanceTail>[0])
    assert.equal(thrown.outcome, 'UNKNOWN_EVIDENCE_INVALID')
    assert.equal(JSON.stringify(thrown).includes('boom'), false)
    const { proxy, revoke } = Proxy.revocable({ nonce: NONCE, expected: 'COMMIT', tagLine: 'COMMIT\n', ackLine: 'x\n' }, {})
    revoke()
    const revoked = modelT15EMaintenanceTail(proxy as unknown as Parameters<typeof modelT15EMaintenanceTail>[0])
    assert.equal(revoked.outcome, 'UNKNOWN_EVIDENCE_INVALID')
  })

  it('preserves aborted-COMMIT UNKNOWN, true CONFIRMED outcomes, and frozen historical snapshots', () => {
    assert.equal(modelT15EMaintenanceTail({ nonce: NONCE, expected: 'COMMIT', tagLine: 'ROLLBACK\n', ackLine: `T15E_MAINT_ACK_COMMIT_${NONCE}\n` }).outcome, 'UNKNOWN_COMMIT_NOT_CONFIRMED')
    assert.equal(modelT15EMaintenanceTail({ nonce: NONCE, expected: 'COMMIT', tagLine: 'COMMIT\n', ackLine: `T15E_MAINT_ACK_COMMIT_${NONCE}\n` }).outcome, 'COMMIT_CONFIRMED')
    assert.equal(modelT15EMaintenanceTail({ nonce: NONCE, expected: 'ROLLBACK', tagLine: 'ROLLBACK\n', ackLine: `T15E_MAINT_ACK_ROLLBACK_${NONCE}\n` }).outcome, 'ROLLBACK_CONFIRMED')
    const frozen = modelT15EMaintenanceTail({ nonce: NONCE, expected: 'COMMIT', tagLine: 'COMMIT\n', ackLine: `T15E_MAINT_ACK_COMMIT_${NONCE}\n` })
    assert.equal(Object.isFrozen(frozen), true)
  })
})

describe('P2: validationContext carries no secret', () => {
  it('RED: serialized context contains no secret key or value; canonical snapshot otherwise unchanged', () => {
    const built = scripts()
    assert.equal(built.ok, true)
    if (!built.ok) return
    const serialized = JSON.stringify(built.validationContext)
    assert.equal(serialized.includes(SECRET), false)
    assert.equal('secret' in built.validationContext, false)
    assert.equal(built.validationContext.roleName, ROLE)
    assert.equal(built.validationContext.cluster.databasePort, 20111)
    assert.equal(built.validationContext.nonce, NONCE)
  })
})
