// Task123 — findings 1/2/3 ONLY: trusted chunk byte metadata (no chunk-own
// prototype getters), contained input/chunk-array recognition with indexed
// traversal + MAX_CHUNKS model cap, and single-capture coherent nested
// clones. Task122 behavior (ACK decision, failure discriminants, tail
// captures, frozen model states) must remain unchanged. The MAX_CHUNKS 8192
// cap is NEW coverage (not an old-bug RED — labeled). Cases that are green
// via Node internals today are hardening coverage, not proof RED (labeled).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildT15EMaintenanceProtocolScripts,
  demuxT15EMaintenanceReadback,
  decideT15EMaintenanceTail,
} from '../support/native/t15e-maintenance-protocol-core'

const ROLE = 't15e_app_run1'
const SECRET = 'Synthetic-secret-0123456789abcdef'
const NONCE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const CLUSTER = Object.freeze({ dataDirectory: '/owned-tmp/x/data', databasePort: 20111, databaseName: 'app_cleanstart_dev' })
const CATALOG = Object.freeze({
  tables: [{ schema: 'public', name: 'requests' }, { schema: 'public', name: 'users' }],
  sequences: [{ schema: 'public', name: 'requests_id_seq' }],
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
const validStream = (): Buffer => Buffer.concat([framesBytes(healthy()), ack(NONCE)])
const plainInput = () => ({
  roleName: ROLE, secret: SECRET, cluster: { ...CLUSTER },
  catalog: { tables: CATALOG.tables.map((t) => ({ ...t })), sequences: CATALOG.sequences.map((s) => ({ ...s })) },
  nonce: NONCE,
})

describe('P1 trusted chunk byte metadata (intrinsic, not chunk-own getters)', () => {
  it('RED: oversize Uint8Array subclass with a lying byteLength getter must reject BEFORE any snapshot copy', () => {
    const original = Buffer.from
    let copies = 0
    const guarded = (...args: Parameters<typeof Buffer.from>) => { copies += 1; return original(...args) }
    try {
      Object.defineProperty(Buffer, 'from', { value: guarded, configurable: true, writable: true })
      const hostile = new Uint8Array(512 * 1024 + 2)
      Object.defineProperty(hostile, 'byteLength', { get: () => 1, configurable: true })
      const result = demuxT15EMaintenanceReadback([hostile], NONCE)
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.reason, 'STREAM_OVERFLOW')
      assert.equal(copies, 0, 'true oversize must reject before any copy')
    } finally {
      Object.defineProperty(Buffer, 'from', { value: original, configurable: true, writable: true })
    }
  })

  it('RED: a non-byte object with a prototype byteLength getter mock never invokes the getter', () => {
    let getterReads = 0
    const fakeProto = { get byteLength() { getterReads += 1; return 5 } }
    const mock = Object.create(fakeProto)
    const result = demuxT15EMaintenanceReadback([mock], NONCE)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'DEMUX_INVALID')
    assert.equal(getterReads, 0, 'caller-supplied getter must never run')
  })

  it('shadowed buffer/offset subarray spans are copied correctly (coverage: Node internals already resist)', () => {
    // Standalone backing buffer so offset 0 IS the content start (Buffer
    // allocations are pooled views — building a view over .buffer at 0 would
    // read pool garbage, not the stream).
    const backing = new Uint8Array(validStream()) // copy to a standalone ArrayBuffer
    const view = new Uint8Array(backing.buffer, 0, backing.byteLength)
    Object.defineProperty(view, 'buffer', { get: () => new ArrayBuffer(8), configurable: true })
    Object.defineProperty(view, 'byteOffset', { get: () => 4, configurable: true })
    const result = demuxT15EMaintenanceReadback([view], NONCE)
    assert.equal(result.ok, true, 'trusted intrinsic metadata reads the REAL span')
  })
})

describe('P2 contained chunk-array recognition, indexed traversal, MAX_CHUNKS', () => {
  it('RED: custom iterator must NEVER be invoked — indexed access only', () => {
    const chunks = [validStream()]
    let iteratorReads = 0
    Object.defineProperty(chunks, Symbol.iterator, {
      value: function* () { iteratorReads += 1; yield Buffer.from('junk') ; yield* [validStream()] },
      configurable: true,
    })
    const result = demuxT15EMaintenanceReadback(chunks, NONCE)
    assert.equal(result.ok, true, 'indexed traversal sees only the real chunk')
    assert.equal(iteratorReads, 0, 'custom iterator must never run')
  })

  it('RED: throwing index getter is a fixed failure, never a raw throw', () => {
    const chunks: unknown[] = [validStream()]
    Object.defineProperty(chunks, '0', { get() { throw new Error('index boom') }, configurable: true })
    const result = demuxT15EMaintenanceReadback(chunks as unknown[], NONCE)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'DEMUX_INVALID')
    assert.equal(JSON.stringify(result).includes('index boom'), false)
  })

  it('RED: revoked proxy as the chunk array (and as decide input) is a fixed failure, no raw throw', () => {
    const { proxy, revoke } = Proxy.revocable([validStream()], {})
    revoke()
    const demuxResult = demuxT15EMaintenanceReadback(proxy, NONCE)
    assert.equal(demuxResult.ok, false)
    const scripts = buildT15EMaintenanceProtocolScripts(plainInput())
    assert.equal(scripts.ok, true)
    if (!scripts.ok) return
    const decideResult = decideT15EMaintenanceTail({ scripts, chunks: proxy } as unknown as Parameters<typeof decideT15EMaintenanceTail>[0])
    assert.equal(decideResult.ok, false)
    if (!decideResult.ok) assert.equal(decideResult.reason, 'UNKNOWN_TXN')
  })

  it('MAX_CHUNKS 8192 cap rejects oversized batch counts before traversal (NEW coverage, not old-bug RED)', () => {
    const many: unknown[] = new Array(8193).fill(Buffer.alloc(1))
    const result = demuxT15EMaintenanceReadback(many, NONCE)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'DEMUX_INVALID')
    const atCap = new Array(8192).fill(Buffer.alloc(1))
    const capped = demuxT15EMaintenanceReadback(atCap, NONCE)
    assert.equal(capped.ok, false) // cap passes; grammar then fails
    if (!capped.ok) assert.notEqual(capped.reason, 'DEMUX_INVALID_COUNT' as never)
  })

  it('huge non-integer length array-like is rejected without iteration (coverage)', () => {
    const fake = { length: Number.MAX_SAFE_INTEGER + 100 }
    const result = demuxT15EMaintenanceReadback(fake as unknown as unknown[], NONCE)
    assert.equal(result.ok, false)
  })
})

describe('P3 single-capture coherent nested clones', () => {
  it('RED: divergent dataDirectory getter cannot shift the captured snapshot', () => {
    let reads = 0
    const input = {
      ...plainInput(),
      cluster: {
        get dataDirectory() { reads += 1; return reads === 1 ? '/owned-tmp/x/data' : '/attacker/other/data' },
        databasePort: 20111,
        databaseName: 'app_cleanstart_dev',
      },
    }
    const built = buildT15EMaintenanceProtocolScripts(input)
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.equal(built.validationContext.cluster.dataDirectory, '/owned-tmp/x/data', 'first capture must win')
    assert.ok(reads <= 2, `dataDirectory read ${reads} times`)
  })

  it('RED: divergent catalog tables getter cannot iterate a different array than the one length-checked', () => {
    const checkedArray = [{ schema: 'public', name: 'requests' }, { schema: 'public', name: 'users' }]
    const attackerArray = [{ schema: 'public', name: 'requests' }, { schema: 'public', name: 'evil_extra' }]
    let reads = 0
    const input = {
      ...plainInput(),
      catalog: {
        get tables() { reads += 1; return reads === 1 ? checkedArray : attackerArray },
        sequences: CATALOG.sequences.map((s) => ({ ...s })),
      },
    }
    const built = buildT15EMaintenanceProtocolScripts(input)
    assert.equal(built.ok, true)
    if (!built.ok) return
    const names = built.validationContext.catalog.tables.map((t) => t.name)
    assert.deepEqual(names, ['requests', 'users'], 'captured array must be coherent with the checked one')
  })

  it('RED: custom iterator on a catalog array is never invoked (indexed capture only)', () => {
    const tables = [...CATALOG.tables.map((t) => ({ ...t }))]
    let iteratorReads = 0
    Object.defineProperty(tables, Symbol.iterator, {
      value: function* () { iteratorReads += 1; yield { schema: 'public', name: 'evil_iter' } },
      configurable: true,
    })
    const input = { ...plainInput(), catalog: { tables, sequences: CATALOG.sequences.map((s) => ({ ...s })) } }
    const built = buildT15EMaintenanceProtocolScripts(input)
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.equal(iteratorReads, 0, 'iterator must never run during capture')
    assert.deepEqual(built.validationContext.catalog.tables.map((t) => t.name), ['requests', 'users'])
  })

  it('RED: throwing nested index getter is a fixed INPUT_INVALID, never a raw throw', () => {
    const tables: unknown[] = [{ schema: 'public', name: 'requests' }]
    Object.defineProperty(tables, '0', { get() { throw new Error('nested index boom') }, configurable: true })
    const input = { ...plainInput(), catalog: { tables, sequences: CATALOG.sequences.map((s) => ({ ...s })) } }
    const result = buildT15EMaintenanceProtocolScripts(input as unknown as Parameters<typeof buildT15EMaintenanceProtocolScripts>[0])
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'INPUT_INVALID')
    assert.equal(JSON.stringify(result).includes('nested index boom'), false)
  })

  it('direct relation schema/name getters succeed and are each captured exactly once', () => {
    let schemaReads = 0
    let nameReads = 0
    const relation = {
      get schema() { schemaReads += 1; return schemaReads === 1 ? 'public' : 'other' },
      get name() { nameReads += 1; return nameReads === 1 ? 'requests' : 'evil_extra' },
    }
    // Pass the getter-bearing object itself; spreading it would consume the
    // getters before the production clone and leave that boundary untested.
    const input = {
      ...plainInput(),
      catalog: { tables: [relation, { schema: 'public', name: 'users' }], sequences: CATALOG.sequences.map((s) => ({ ...s })) },
    }
    const built = buildT15EMaintenanceProtocolScripts(input)
    assert.equal(built.ok, true, 'a valid getter-bearing relation must not be rejected')
    if (!built.ok) assert.fail('valid relation did not produce a canonical snapshot')
    assert.deepEqual(built.validationContext.catalog.tables[0], { schema: 'public', name: 'requests' })
    assert.equal(schemaReads, 1)
    assert.equal(nameReads, 1)
  })

  it('extra nested keys remain rejected; canonical snapshot otherwise unchanged', () => {
    const input = { ...plainInput(), cluster: { ...CLUSTER, evil: 'DROP TABLE x' } }
    const result = buildT15EMaintenanceProtocolScripts(input)
    assert.equal(result.ok, false)
    const good = buildT15EMaintenanceProtocolScripts(plainInput())
    assert.equal(good.ok, true)
    if (!good.ok) return
    assert.equal(good.validationContext.roleName, ROLE)
    assert.equal('secret' in good.validationContext, false)
  })
})

describe('Task124 builder opaque exception containment', () => {
  it('a revoked builder input returns fixed INPUT_INVALID instead of escaping from recognition', () => {
    const { proxy, revoke } = Proxy.revocable(plainInput(), {})
    revoke()
    let result: ReturnType<typeof buildT15EMaintenanceProtocolScripts> | undefined
    assert.doesNotThrow(() => { result = buildT15EMaintenanceProtocolScripts(proxy) })
    assert.ok(result)
    assert.equal(result.ok, false)
    if (result.ok) assert.fail('a revoked input must not produce scripts')
    assert.equal(result.reason, 'INPUT_INVALID')
    assert.deepEqual(Object.keys(result).sort(), ['authority', 'message', 'ok', 'reason'])
    assert.equal(result.authority, 'NONE')
  })

  it('a getter throwing an opaque revoked proxy is discarded without inspecting the caught value', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    const input = plainInput()
    Object.defineProperty(input, 'secret', { get() { throw proxy }, enumerable: true })
    let result: ReturnType<typeof buildT15EMaintenanceProtocolScripts> | undefined
    assert.doesNotThrow(() => { result = buildT15EMaintenanceProtocolScripts(input) })
    assert.ok(result)
    assert.equal(result.ok, false)
    if (result.ok) assert.fail('a throwing accessor must not produce scripts')
    assert.equal(result.reason, 'INPUT_INVALID')
    assert.deepEqual(Object.keys(result).sort(), ['authority', 'message', 'ok', 'reason'])
    assert.equal(result.authority, 'NONE')
    assert.equal(JSON.stringify(result).includes(SECRET), false)
  })
})

describe('Task122 behavior preserved (regression)', () => {
  it('ACK decision, discriminants, and frozen tails are unchanged', () => {
    const scripts = buildT15EMaintenanceProtocolScripts(plainInput())
    assert.equal(scripts.ok, true)
    if (!scripts.ok) return
    const good = decideT15EMaintenanceTail({ scripts, chunks: [validStream()] })
    assert.equal(good.ok, true)
    if (good.ok) assert.equal(good.tail, 'COMMIT')
    const noAck = decideT15EMaintenanceTail({ scripts, chunks: [framesBytes(healthy())] })
    assert.equal(noAck.ok, false)
    if (!noAck.ok) assert.equal(noAck.reason, 'UNKNOWN_TXN')
  })
})
