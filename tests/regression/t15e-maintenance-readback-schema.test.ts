// Task118B — PURE six-section exact-schema / full-readback validation.
// (Task118B2 correction: sections 3/4 carry the canonical `relations` alias —
// source-pinned relationJson `end as relations` + prefix whole-row; wrong
// {tables}/{sequences} wire shapes are rejected, covered in the integrity
// suite as negative cases.)
// Fully synthetic fixtures (matching the generated query aliases); no real
// PG execution. sqlOk is CALLER-SUPPLIED TEST-DOMAIN STATUS — never derived
// from wire, never production SQL provenance/commit; pure exports cannot
// mint. Duplicate-key cases are lexical (built into the raw payload bytes,
// not silently collapsed by JSON.stringify).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateT15EMaintenanceReadback } from '../support/native/t15e-maintenance-readback-schema'

const ROLE = 't15e_app_run1'
const CLUSTER = Object.freeze({ dataDirectory: '/owned-tmp/x/data', databasePort: 20111, databaseName: 'app_cleanstart_dev' })
const CATALOG = Object.freeze({
  tables: [{ schema: 'public', name: 'requests' }, { schema: 'public', name: 'users' }],
  sequences: [{ schema: 'public', name: 'requests_id_seq' }],
})
const ROLE_OID = 4242
const DB_OID = 16384

const happySections = (): string[] => [
  `{"role_name":"${ROLE}","role_oid":${ROLE_OID},"rolcanlogin":true,"rolsuper":false,"rolcreatedb":false,"rolcreaterole":false,"rolinherit":false,"membership_role_oids":[],"database_name":"app_cleanstart_dev","database_oid":${DB_OID},"data_directory":"/owned-tmp/x/data","database_port":20111,"server_version_num":160001}`,
  '{"database_connect":true,"database_temp":true,"schema_create":false,"schema_usage":true,"public_builtin_execute":true}',
  '{"relations":[{"schema":"public","name":"requests","privileges":["SELECT","INSERT","UPDATE","DELETE"]},{"schema":"public","name":"users","privileges":["SELECT","INSERT","UPDATE","DELETE"]}]}',
  '{"relations":[{"schema":"public","name":"requests_id_seq","privileges":["USAGE","SELECT"]}]}',
  '{"unpinned_accessible":[]}',
  '{"user_defined_function_grants":[]}',
]

const frame = (n: number, payload: string): Buffer =>
  Buffer.from(`T15E_MAINT_S${n}_B\n${payload}\nT15E_MAINT_S${n}_E:${Buffer.byteLength(payload, 'utf8')}`, 'utf8')
const wire = (sections: readonly string[]): Buffer =>
  Buffer.concat(sections.flatMap((payload, index) => [frame(index + 1, payload), Buffer.from('\n', 'utf8')]))

const call = (overrides: Record<string, unknown> = {}, sections: readonly string[] = happySections()) =>
  validateT15EMaintenanceReadback({ roleName: ROLE, cluster: { ...CLUSTER }, catalog: { tables: [...CATALOG.tables], sequences: [...CATALOG.sequences] }, frames: wire(sections), sqlOk: true, ...overrides })

describe('happy path and status contract', () => {
  it('validates full synthetic facts and returns frozen data-only identity', () => {
    const result = call()
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.authority, 'NONE')
    assert.deepEqual(result.identity, { roleName: ROLE, roleOid: ROLE_OID, databaseName: 'app_cleanstart_dev', databaseOid: DB_OID })
    assert.equal(Object.isFrozen(result.facts), true)
  })

  it('sqlOk false / non-boolean / string "true" can NEVER become true via the wire', () => {
    for (const sqlOk of [false, 'true', 1, null, undefined]) {
      const result = call({ sqlOk })
      assert.equal(result.ok, false, String(typeof sqlOk))
      if (!result.ok) {
        assert.equal(result.reason, 'SQL_STATUS_INVALID')
        assert.equal(result.value, null)
      }
    }
  })
})

describe('failure matrix (fixed categories, no partial facts)', () => {
  const failsWith = (result: ReturnType<typeof call>, reason: string): void => {
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, reason)
      assert.equal(result.value, null)
      assert.equal(result.message, 'T15E maintenance readback failure')
      assert.equal(JSON.stringify(result).includes('T15E_MAINT_S1_B'), false, 'no raw wire in diagnostics')
    }
  }

  it('missing / extra / null / array-wrapped sections reject', () => {
    failsWith(call({}, happySections().slice(0, 5)), 'FRAMES_INVALID') // missing S6 wire
    const junked = [...happySections()]
    failsWith(call({}, junked.map((payload, i) => (i === 5 ? payload + 'junk' : payload))), 'SECTION_JSON_INVALID') // junk INSIDE a payload (trailer recomputed) -> strict JSON layer
    const nulled = [...happySections()]; nulled[1] = 'null'
    failsWith(call({}, nulled), 'SECTION_SCHEMA_INVALID') // null payload object
    const arrayWrapped = [...happySections()]; arrayWrapped[2] = '[]'
    failsWith(call({}, arrayWrapped), 'SECTION_SCHEMA_INVALID') // array payload, not singleton object
  })

  it('duplicate keys are caught LEXICALLY (escaped equivalents, in-section)', () => {
    const dup = [...happySections()]
    dup[1] = '{"database_connect":true,"database_\\u0063onnect":true,"database_temp":true,"schema_create":false,"schema_usage":true,"public_builtin_execute":true}'
    failsWith(call({}, dup), 'SECTION_JSON_INVALID')
  })

  it('missing / extra fields inside sections reject', () => {
    const missing = [...happySections()]; missing[1] = '{"database_connect":true,"database_temp":true,"schema_create":false,"schema_usage":true}'
    failsWith(call({}, missing), 'SECTION_SCHEMA_INVALID')
    const extraField = [...happySections()]; extraField[0] = happySections()[0].replace('"role_oid"', '"role_\\u006fid"') + '' // same key escaped: still exact
    assert.equal(call({}, extraField).ok, true)
    const extraReal = [...happySections()]; extraReal[4] = '{"unpinned_accessible":[],"surprise":1}'
    failsWith(call({}, extraReal), 'SECTION_SCHEMA_INVALID')
  })

  it('membership nonempty or invalid OID rejects', () => {
    const nonempty = [...happySections()]
    nonempty[0] = nonempty[0].replace('"membership_role_oids":[]', '"membership_role_oids":[99]')
    const r = call({}, nonempty)
    assert.equal(r.ok, false) // schema accepts a bounded list; the approved validator requires EMPTY
    if (!r.ok) assert.equal(r.reason, 'VALIDATOR_REJECTED')
    const badOid = [...happySections()]
    badOid[0] = badOid[0].replace('"membership_role_oids":[]', '"membership_role_oids":[4294967296]')
    failsWith(call({}, badOid), 'SECTION_SCHEMA_INVALID')
  })

  it('PG17, identity mismatch, unsafe OIDs, wrong flags, schemaCreate true propagate the approved validator', () => {
    const v17 = [...happySections()]; v17[0] = happySections()[0].replace('160001', '170001')
    failsWith(call({}, v17), 'SECTION_SCHEMA_INVALID') // schema-level 15/16 vocabulary gate
    const wrongRole = call({ roleName: 't15e_app_other' })
    assert.equal(wrongRole.ok, false) // plan regenerates for other role; identity mismatch
    if (!wrongRole.ok) assert.equal(wrongRole.reason, 'VALIDATOR_REJECTED')
    // An unsafe 16-digit number is rejected by the strict-JSON safe-integer
    // layer BEFORE the schema layer (correct layering).
    const unsafeOid = [...happySections()]; unsafeOid[0] = happySections()[0].replace(String(ROLE_OID), '9007199254740993')
    failsWith(call({}, unsafeOid), 'SECTION_JSON_INVALID')
    const superuser = [...happySections()]; superuser[0] = happySections()[0].replace('"rolsuper":false', '"rolsuper":true')
    const r1 = call({}, superuser); assert.equal(r1.ok, false)
    if (!r1.ok) assert.equal(r1.reason, 'VALIDATOR_REJECTED')
    const inherit = [...happySections()]; inherit[0] = happySections()[0].replace('"rolinherit":false', '"rolinherit":true')
    const r2 = call({}, inherit); assert.equal(r2.ok, false)
    if (!r2.ok) assert.equal(r2.reason, 'VALIDATOR_REJECTED')
    const schemaCreate = [...happySections()]; schemaCreate[1] = happySections()[1].replace('"schema_create":false', '"schema_create":true')
    const r3 = call({}, schemaCreate); assert.equal(r3.ok, false)
    if (!r3.ok) assert.equal(r3.reason, 'VALIDATOR_REJECTED')
    const nullBool = [...happySections()]; nullBool[1] = happySections()[1].replace('"database_connect":true', '"database_connect":null')
    failsWith(call({}, nullBool), 'SECTION_SCHEMA_INVALID')
  })

  it('privilege outside the allowlist, duplicate privileges, duplicate relations, extra unpinned, function grants all reject', () => {
    const outside = [...happySections()]
    outside[2] = outside[2].replace('["SELECT","INSERT","UPDATE","DELETE"]},', '["SELECT","GRANT OPTION"]},').replace('"privileges":["SELECT","INSERT","UPDATE","DELETE"]}]}', '"privileges":["SELECT","INSERT","UPDATE","DELETE"]}]}')
    outside[2] = '{"relations":[{"schema":"public","name":"requests","privileges":["SELECT","GRANT_OPTION"]}]}'
    failsWith(call({}, outside), 'SECTION_SCHEMA_INVALID')
    const dupPriv = [...happySections()]
    dupPriv[3] = '{"relations":[{"schema":"public","name":"requests_id_seq","privileges":["USAGE","USAGE"]}]}'
    failsWith(call({}, dupPriv), 'SECTION_SCHEMA_INVALID')
    const dupRel = [...happySections()]
    dupRel[2] = '{"relations":[{"schema":"public","name":"requests","privileges":["SELECT"]},{"schema":"public","name":"requests","privileges":["SELECT"]}]}'
    failsWith(call({}, dupRel), 'SECTION_SCHEMA_INVALID')
    const unpinnedEntry = [...happySections()]
    unpinnedEntry[4] = '{"unpinned_accessible":[{"schema":"public","name":"stray","relkind":"r"}]}'
    const ru = call({}, unpinnedEntry); assert.equal(ru.ok, false)
    if (!ru.ok) assert.equal(ru.reason, 'VALIDATOR_REJECTED')
    const badRelkind = [...happySections()]
    badRelkind[4] = '{"unpinned_accessible":[{"schema":"public","name":"stray","relkind":"x"}]}'
    failsWith(call({}, badRelkind), 'SECTION_SCHEMA_INVALID')
    const fn = [...happySections()]
    fn[5] = '{"user_defined_function_grants":["public.custom_fn"]}'
    const rf = call({}, fn); assert.equal(rf.ok, false)
    if (!rf.ok) assert.equal(rf.reason, 'VALIDATOR_REJECTED')
  })

  it('null overflow is never converted to empty; malformed frames reject', () => {
    const nullTables = [...happySections()]
    nullTables[2] = '{"relations":null}'
    failsWith(call({}, nullTables), 'SECTION_SCHEMA_INVALID')
    const broken = Buffer.from('not-frames-at-all')
    failsWith(call({ frames: broken }), 'FRAMES_INVALID')
  })
})

describe('input boundary (no getter runs on extra-key input; contained captures)', () => {
  it('extra sql/plan key + throwing getter rejects without invocation', () => {
    let reads = 0
    const input = {
      roleName: ROLE,
      get frames() { reads += 1; throw new Error('boom') },
      cluster: { ...CLUSTER },
      catalog: { tables: [...CATALOG.tables], sequences: [...CATALOG.sequences] },
      sqlOk: true,
      sql: 'DROP TABLE x',
    }
    const result = validateT15EMaintenanceReadback(input)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'SHAPE_INVALID')
    assert.equal(reads, 0)
  })

  it('throwing getter on valid shape is contained; plan rejection is fixed', () => {
    const hostile: Record<string, unknown> = { roleName: ROLE, cluster: { ...CLUSTER }, catalog: { tables: [...CATALOG.tables], sequences: [...CATALOG.sequences] }, frames: wire(happySections()), sqlOk: true }
    Object.defineProperty(hostile, 'sqlOk', { enumerable: true, get() { throw new Error('boom') } })
    const contained = validateT15EMaintenanceReadback(hostile)
    assert.equal(contained.ok, false)
    if (!contained.ok) assert.equal(contained.reason, 'INPUT_INVALID')
    const rejected = call({ roleName: 'not the role shape' })
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.equal(rejected.reason, 'PLAN_REJECTED')
  })
})
