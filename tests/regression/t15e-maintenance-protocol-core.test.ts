// Task121 B1a1 — PURE fixed maintenance protocol: script generation + bounded
// fragment/coalesced demux + MODELED evidence phases. No injected child,
// writes, timers, revocation, or cleanup orchestration (B1a2). Synthetic
// fixtures only — the modeled SQL output shape is NOT native proof; commit /
// backend-gone / issuer acceptance are outside this model.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  T15E_MAINT_CORE_ARGV,
  buildT15EMaintenanceProtocolScripts,
  demuxT15EMaintenanceReadback,
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

const plainInput = () => ({
  roleName: ROLE,
  secret: SECRET,
  cluster: { ...CLUSTER },
  catalog: { tables: CATALOG.tables.map((t) => ({ ...t })), sequences: CATALOG.sequences.map((s) => ({ ...s })) },
  nonce: NONCE,
})

const readbackAck = (nonce: string): string => `T15E_MAINT_ACK_READBACK_${nonce}\n`

const sectionBytes = (n: number, payload: string): Buffer =>
  Buffer.from(`T15E_MAINT_S${n}_B\n${payload}\nT15E_MAINT_S${n}_E:${Buffer.byteLength(payload, 'utf8')}`, 'utf8')
const framesBytes = (payloads: readonly string[]): Buffer =>
  Buffer.concat(payloads.flatMap((payload, index) => [sectionBytes(index + 1, payload), Buffer.from('\n', 'utf8')]))
const syntheticFrames = (): readonly string[] => [
  '{"role_name":"t15e_app_run1","role_oid":4242,"rolcanlogin":true,"rolsuper":false,"rolcreatedb":false,"rolcreaterole":false,"rolinherit":false,"membership_role_oids":[],"database_name":"app_cleanstart_dev","database_oid":16384,"data_directory":"/owned-tmp/x/data","database_port":20111,"server_version_num":160001}',
  '{"database_connect":true,"database_temp":true,"schema_create":false,"schema_usage":true,"public_builtin_execute":true}',
  '{"relations":[{"schema":"public","name":"requests","privileges":["SELECT","INSERT","UPDATE","DELETE"]},{"schema":"public","name":"users","privileges":["SELECT","INSERT","UPDATE","DELETE"]}]}',
  '{"relations":[{"schema":"public","name":"requests_id_seq","privileges":["USAGE","SELECT"]}]}',
  '{"unpinned_accessible":[]}',
  '{"user_defined_function_grants":[]}',
]

describe('fixed scripts and argv (source-pinned)', () => {
  it('builds prologue + tails with phase-specific QUIET and nonce-bound ACK SELECTs', () => {
    const built = buildT15EMaintenanceProtocolScripts(plainInput())
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.equal(built.authority, 'NONE')
    assert.deepEqual([...built.argv], [...T15E_MAINT_CORE_ARGV])
    assert.equal(built.argv.includes('-q'), false)
    assert.equal(built.argv.includes('-c'), false)
    assert.match(built.argv.join(' '), /ON_ERROR_STOP=1/)
    assert.match(built.argv.join(' '), /ON_ERROR_ROLLBACK=off/)
    assert.match(built.argv.join(' '), /ECHO=none/)
    assert.match(built.argv.join(' '), /ECHO_HIDDEN=off/)
    assert.match(built.argv.join(' '), /pager=off/)
    assert.ok(built.prologue.startsWith('\\set QUIET on\nBEGIN;\n'))
    assert.ok(built.prologue.endsWith(`select 'T15E_MAINT_ACK_READBACK_${NONCE}';\n`))
    assert.equal(built.commitTail, `\\set QUIET off\nCOMMIT;\n\\set QUIET on\nselect 'T15E_MAINT_ACK_COMMIT_${NONCE}';\n`)
    assert.equal(built.rollbackTail, `\\set QUIET off\nROLLBACK;\n\\set QUIET on\nselect 'T15E_MAINT_ACK_ROLLBACK_${NONCE}';\n`)
    // Secret appears exactly once — inside the canonical CREATE in the prologue.
    assert.equal(built.prologue.split(SECRET).length - 1, 1)
    assert.equal('redactedStdin' in built, false)
    assert.equal(Object.isFrozen(built.validationContext), true)
  })

  it('rejects nonce != exact 64 lower-hex (32 rejected) with fixed failures', () => {
    for (const bad of [NONCE.slice(32), NONCE + '0', NONCE.toUpperCase(), NONCE.slice(0, 63) + 'G', '']) {
      const result = buildT15EMaintenanceProtocolScripts({ ...plainInput(), nonce: bad })
      assert.equal(result.ok, false, bad || 'empty')
      if (!result.ok) assert.equal(result.reason, 'NONCE_INVALID')
    }
  })
})

describe('captured context: no getter shift between prefix and validator', () => {
  it('nested cluster/catalog values are cloned to plain values BEFORE validation', () => {
    let portReads = 0
    const input = {
      roleName: ROLE,
      secret: SECRET,
      cluster: {
        dataDirectory: CLUSTER.dataDirectory,
        get databasePort() { portReads += 1; return portReads === 1 ? 20111 : 5432 },
        databaseName: CLUSTER.databaseName,
      },
      catalog: { tables: CATALOG.tables.map((t) => ({ ...t })), sequences: CATALOG.sequences.map((s) => ({ ...s })) },
      nonce: NONCE,
    }
    const built = buildT15EMaintenanceProtocolScripts(input)
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.ok(portReads <= 1, `cluster getter read ${portReads} times`)
    // Same context flows to validation: prefix port and context port agree.
    assert.equal((built.validationContext as { cluster: { databasePort: number } }).cluster.databasePort, 20111)
  })

  it('throwing nested getter during clone is a fixed rejection (accessors not supported)', () => {
    const input = {
      ...plainInput(),
      catalog: {
        get tables() { throw new Error('catalog getter boom') },
        sequences: CATALOG.sequences.map((s) => ({ ...s })),
      },
    }
    const result = buildT15EMaintenanceProtocolScripts(input)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'INPUT_INVALID')
      assert.equal(JSON.stringify(result).includes('boom'), false)
    }
  })
})

describe('bounded fragment/coalesced demux', () => {
  const stream = (chunks: readonly (Buffer | Uint8Array)[]): readonly (Buffer | Uint8Array)[] => chunks

  it('demuxes fragmented and coalesced streams identically to the exact 6-frame span + ACK', () => {
    const whole = Buffer.concat([framesBytes(syntheticFrames()), Buffer.from(readbackAck(NONCE), 'utf8')])
    const coalesced = demuxT15EMaintenanceReadback(stream([whole]), NONCE)
    assert.equal(coalesced.ok, true)
    if (!coalesced.ok) return
    assert.equal(coalesced.frames.equals(framesBytes(syntheticFrames())), true)
    assert.equal(coalesced.readbackAck, readbackAck(NONCE).slice(0, -1))
    // Fragmented at every 7-byte boundary.
    const pieces: Buffer[] = []
    for (let i = 0; i < whole.length; i += 7) pieces.push(whole.subarray(i, i + 7))
    const fragmented = demuxT15EMaintenanceReadback(stream(pieces), NONCE)
    assert.equal(fragmented.ok, true)
    if (!fragmented.ok) return
    assert.equal(fragmented.frames.equals(framesBytes(syntheticFrames())), true)
  })

  it('rejects trailing junk, coalesced garbage after a valid ACK, malformed/stale/duplicate ACK, duplicate frames', () => {
    const good = Buffer.concat([framesBytes(syntheticFrames()), Buffer.from(readbackAck(NONCE), 'utf8')])
    for (const [label, chunks] of [
      ['trailing junk', [good, Buffer.from('junk')]],
      ['coalesced garbage', [Buffer.concat([good, Buffer.from('x')])]],
      ['wrong nonce ack', [Buffer.concat([framesBytes(syntheticFrames()), Buffer.from(readbackAck('f'.repeat(64)), 'utf8')])]],
      ['duplicate ack', [Buffer.concat([good, Buffer.from(readbackAck(NONCE), 'utf8')])]],
      ['uppercase ack', [Buffer.concat([framesBytes(syntheticFrames()), Buffer.from(readbackAck(NONCE).toUpperCase(), 'utf8')])]],
      ['duplicate frames', [Buffer.concat([framesBytes(syntheticFrames()), good])]],
      ['empty stream', [Buffer.alloc(0)]],
    ] as const) {
      const result = demuxT15EMaintenanceReadback(stream(chunks as readonly (Buffer | Uint8Array)[]), NONCE)
      assert.equal(result.ok, false, label)
      if (!result.ok) {
        // Duplicate-ACK and duplicate-frames remainders both exceed the
        // 160-byte line bound and fail capacity-before-retain; every other
        // case is a grammar mismatch.
        const expected = label === 'duplicate ack' || label === 'duplicate frames' ? 'ACK_LINE_OVERFLOW' : 'DEMUX_INVALID'
        assert.equal(result.reason, expected, label)
      }
    }
  })

  it('enforces whole-stream capacity BEFORE copy and line bounds BEFORE retain', () => {
    const oversize = demuxT15EMaintenanceReadback(stream([Buffer.alloc(512 * 1024 + 1, 0x41)]), NONCE)
    assert.equal(oversize.ok, false)
    if (!oversize.ok) assert.equal(oversize.reason, 'STREAM_OVERFLOW')
    const longAck = 'a'.repeat(161)
    const overLine = demuxT15EMaintenanceReadback(stream([Buffer.concat([framesBytes(syntheticFrames()), Buffer.from(longAck, 'utf8')])]), NONCE)
    assert.equal(overLine.ok, false)
    if (!overLine.ok) assert.equal(overLine.reason, 'ACK_LINE_OVERFLOW')
    // 160-byte ACK line is the fixed bound (still rejected as non-matching, but bounded).
    const atBound = demuxT15EMaintenanceReadback(stream([Buffer.concat([framesBytes(syntheticFrames()), Buffer.from('a'.repeat(159) + '\n', 'utf8')])]), NONCE)
    assert.equal(atBound.ok, false)
  })

  it('non-ASCII payloads inside frames demux through the approved decoder', () => {
    const emoji = String.fromCodePoint(0x1f6e1)
    const payloads = [...syntheticFrames().slice(0, 5), `{"user_defined_function_grants":[]/*${emoji}*/}`.replace(`/*${emoji}*/`, '') + `,"note":"${emoji}"`]
    const whole = Buffer.concat([framesBytes(payloads), Buffer.from(readbackAck(NONCE), 'utf8')])
    const result = demuxT15EMaintenanceReadback(stream([whole]), NONCE)
    assert.equal(result.ok, true)
  })
})

describe('modeled evidence phases', () => {
  it('valid facts decide the COMMIT tail only; invalid-but-healthy facts decide ROLLBACK; malformed frames stay UNKNOWN', () => {
    const scripts = buildT15EMaintenanceProtocolScripts(plainInput())
    assert.equal(scripts.ok, true)
    if (!scripts.ok) return
    const valid = decideT15EMaintenanceTail({ scripts, chunks: [Buffer.concat([framesBytes(syntheticFrames()), Buffer.from(readbackAck(NONCE), 'utf8')])] })
    assert.equal(valid.ok, true)
    if (valid.ok) {
      assert.equal(valid.tail, 'COMMIT')
      assert.equal(valid.readback.ok, true)
      assert.equal(valid.authority, 'NONE')
    }
    const badFacts = [...syntheticFrames()]
    badFacts[1] = badFacts[1].replace('"schema_create":false', '"schema_create":true')
    const rollback = decideT15EMaintenanceTail({ scripts, chunks: [Buffer.concat([framesBytes(badFacts), Buffer.from(readbackAck(NONCE), 'utf8')])] })
    assert.equal(rollback.ok, true)
    if (rollback.ok) assert.equal(rollback.tail, 'ROLLBACK')
    const unknown = decideT15EMaintenanceTail({ scripts, chunks: [Buffer.from('garbage-not-frames')] })
    assert.equal(unknown.ok, false)
    if (!unknown.ok) assert.equal(unknown.reason, 'UNKNOWN_TXN')
  })

  it('tail evidence lattice: COMMIT confirmed, ROLLBACK confirmed, aborted COMMIT stays UNKNOWN', () => {
    const commit = modelT15EMaintenanceTail({ nonce: NONCE, expected: 'COMMIT', tagLine: 'COMMIT\n', ackLine: `T15E_MAINT_ACK_COMMIT_${NONCE}\n` })
    assert.equal(commit.outcome, 'COMMIT_CONFIRMED')
    const rollback = modelT15EMaintenanceTail({ nonce: NONCE, expected: 'ROLLBACK', tagLine: 'ROLLBACK\n', ackLine: `T15E_MAINT_ACK_ROLLBACK_${NONCE}\n` })
    assert.equal(rollback.outcome, 'ROLLBACK_CONFIRMED')
    const aborted = modelT15EMaintenanceTail({ nonce: NONCE, expected: 'COMMIT', tagLine: 'ROLLBACK\n', ackLine: `T15E_MAINT_ACK_COMMIT_${NONCE}\n` })
    assert.equal(aborted.outcome, 'UNKNOWN_COMMIT_NOT_CONFIRMED')
    for (const [label, tagLine, ackLine] of [
      ['stale ack', 'COMMIT\n', `T15E_MAINT_ACK_COMMIT_${'f'.repeat(64)}\n`],
      ['mismatched ack', 'COMMIT\n', `T15E_MAINT_ACK_ROLLBACK_${NONCE}\n`],
      ['extra tag', 'COMMIT\nCOMMIT\n', `T15E_MAINT_ACK_COMMIT_${NONCE}\n`],
      ['unknown tag', 'BEGIN\n', `T15E_MAINT_ACK_COMMIT_${NONCE}\n`],
    ] as const) {
      const result = modelT15EMaintenanceTail({ nonce: NONCE, expected: 'COMMIT', tagLine, ackLine })
      assert.equal(result.outcome.startsWith('UNKNOWN'), true, label)
    }
    // Evidence snapshots are frozen point-in-time: later inputs cannot mutate.
    const frozen = modelT15EMaintenanceTail({ nonce: NONCE, expected: 'COMMIT', tagLine: 'COMMIT\n', ackLine: `T15E_MAINT_ACK_COMMIT_${NONCE}\n` })
    assert.equal(Object.isFrozen(frozen), true)
    assert.equal('backendGoneConfirmed' in frozen ? (frozen as { backendGoneConfirmed: boolean }).backendGoneConfirmed : undefined, undefined)
  })

  it('oversized tag/ack lines are rejected before retain', () => {
    const long = 'x'.repeat(161) + '\n'
    const result = modelT15EMaintenanceTail({ nonce: NONCE, expected: 'COMMIT', tagLine: long, ackLine: `T15E_MAINT_ACK_COMMIT_${NONCE}\n` })
    assert.equal(result.outcome, 'UNKNOWN_EVIDENCE_INVALID')
  })
})
