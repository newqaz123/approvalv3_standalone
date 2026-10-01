// T15E protocol + overlap validation primitives (Task68) — PURE regression
// tests. No process spawn, no DB, no runtime, no runner wiring. These tests
// pin the corrected Astra contract (READY_FOR_BOUNDED_T15E_HELPER_IMPLEMENTATION,
// six constraints) at the pure-helper layer only. Lifecycle adapters are later
// work and are NOT exercised here.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RUN_NONCE_HEX_LENGTH,
  isValidCanonicalUuid,
  validateRunNonce,
  uuidSqlLiteral,
  hex32SqlLiteral,
  validateArmPayload,
  validateReadyPayload,
  createT15EPhaseMachine,
  createFramedResultParser,
  frameCommand,
  T15E_SAFE_ERROR_MESSAGE,
  classifyQueryText,
  verifyOverlapSnapshot,
  proveOutcome,
  validateDeadlinePlan,
  MAX_LOCK_HOLD_MS,
  T15E_DEADLINES_MS,
  defaultOverlapCheckConfig,
  type SanitizedActivitySnapshot,
  type T15EPhaseMachine,
} from '../support/native/t15e-overlap-protocol'

const NONCE = 'a'.repeat(32)
const NONCE2 = 'b'.repeat(32)
const REQUEST_ID = '0f0e0d0c-1a2b-4c3d-8e9f-a1b2c3d4e5f6'

function snapshot(
  overrides: Partial<SanitizedActivitySnapshot> = {},
): SanitizedActivitySnapshot {
  return {
    provenance: {
      capturedAtEpochMs: 1_000_000,
      source: 'future-capture',
      dbIdentifier: 'isolated-test-db',
    },
    coordinator: { pid: 900, backendStart: '2026-01-01T00:00:00Z', databaseId: 7 },
    sessions: [
      {
        pid: 900,
        backendStart: '2026-01-01T00:00:00Z',
        databaseId: 7,
        xactStart: '2026-01-01T00:01:00Z',
        blockingPids: [],
        queryCategory: 'UNKNOWN',
      },
      {
        pid: 101,
        backendStart: '2026-01-01T00:02:00Z',
        databaseId: 7,
        xactStart: '2026-01-01T00:03:00Z',
        blockingPids: [900],
        queryCategory: 'UNKNOWN',
      },
      {
        pid: 202,
        backendStart: '2026-01-01T00:04:00Z',
        databaseId: 7,
        xactStart: '2026-01-01T00:05:00Z',
        blockingPids: [101],
        queryCategory: 'UNKNOWN',
      },
    ],
    ...overrides,
  }
}

function armedMachine(runNonce = NONCE): T15EPhaseMachine {
  const m = createT15EPhaseMachine()
  const arm = validateArmPayload({ kind: 'ARM', runNonce, requestId: REQUEST_ID })
  assert.ok(arm.ok)
  const r = m.accept(arm.value)
  assert.ok(r.ok)
  return m
}

const bytesOf = (wire: string): Buffer => Buffer.from(wire, 'utf8')
const firstError = (events: Array<unknown>): unknown =>
  events.find((x) => x !== null && typeof x === 'object' && 'code' in (x as object)) ?? null

describe('T15E identity validation (strict canonical)', () => {
  it('accepts canonical lowercase RFC UUIDs and rejects everything else', () => {
    assert.equal(isValidCanonicalUuid(REQUEST_ID), true)
    assert.equal(isValidCanonicalUuid(crypto.randomUUID()), true)
    assert.equal(isValidCanonicalUuid(REQUEST_ID.toUpperCase()), false)
    assert.equal(isValidCanonicalUuid(REQUEST_ID.replace(/-/g, '')), false)
    assert.equal(isValidCanonicalUuid('0f0e0d0c-1a2b-7c3d-8e9f-a1b2c3d4e5f6'.replace('7c3d', 'cc3d')), false) // bad variant
    assert.equal(isValidCanonicalUuid(''), false)
    assert.equal(isValidCanonicalUuid(42), false)
    assert.equal(isValidCanonicalUuid(null), false)
  })
  it('run nonce must be exactly 32 lowercase hex chars', () => {
    assert.equal(validateRunNonce(NONCE), true)
    assert.equal(validateRunNonce(NONCE.slice(0, 31)), false)
    assert.equal(validateRunNonce(NONCE + '0'), false)
    assert.equal(validateRunNonce(NONCE.toUpperCase()), false)
    assert.equal(validateRunNonce('g'.repeat(RUN_NONCE_HEX_LENGTH)), false)
    assert.equal(validateRunNonce(undefined), false)
  })
  it('safe SQL literals only for pre-validated identifiers', () => {
    assert.equal(uuidSqlLiteral(REQUEST_ID), `'${REQUEST_ID}'`)
    assert.equal(uuidSqlLiteral('x; drop table'), null)
    assert.equal(hex32SqlLiteral(NONCE), `'${NONCE}'`)
    assert.equal(hex32SqlLiteral("a'"), null)
  })
})

describe('T15E phase payloads (fixed keys, no PID/credentials)', () => {
  it('ARM accepts exactly {kind,runNonce,requestId}', () => {
    const ok = validateArmPayload({ kind: 'ARM', runNonce: NONCE, requestId: REQUEST_ID })
    assert.equal(ok.ok, true)
    assert.equal(validateArmPayload({ kind: 'ARM', runNonce: NONCE }).ok, false)
    assert.equal(validateArmPayload({ kind: 'ARM', runNonce: NONCE, requestId: REQUEST_ID, extra: 1 }).ok, false)
  })
  it('rejects PID/credential/browser keys with a fixed safe reason', () => {
    for (const key of ['pid', 'password', 'credentials', 'connectionString', 'queryText', 'stderr', 'href']) {
      const bad = validateArmPayload({ kind: 'ARM', runNonce: NONCE, requestId: REQUEST_ID, [key]: 'leak' })
      assert.equal(bad.ok, false, key)
      if (!bad.ok) assert.equal(bad.reason, 'FORBIDDEN_PAYLOAD_KEY')
    }
  })
  it('READY requires a verified lock acknowledgment for the same run', () => {
    const good = validateReadyPayload({
      kind: 'READY',
      runNonce: NONCE,
      requestId: REQUEST_ID,
      lockAck: { runNonce: NONCE, requestId: REQUEST_ID, locked: true, acquireSentAtEpochMs: 5 },
    })
    assert.equal(good.ok, true)
    const staleAck = validateReadyPayload({
      kind: 'READY',
      runNonce: NONCE,
      requestId: REQUEST_ID,
      lockAck: { runNonce: NONCE2, requestId: REQUEST_ID, locked: true, acquireSentAtEpochMs: 5 },
    })
    assert.equal(staleAck.ok, false)
    const unlocked = validateReadyPayload({
      kind: 'READY',
      runNonce: NONCE,
      requestId: REQUEST_ID,
      lockAck: { runNonce: NONCE, requestId: REQUEST_ID, locked: false, acquireSentAtEpochMs: 5 },
    })
    assert.equal(unlocked.ok, false)
  })
})

describe('T15E phase state machine', () => {
  it('READY before verified lock is rejected', () => {
    const m = armedMachine()
    const r = m.accept({
      kind: 'READY',
      runNonce: NONCE,
      requestId: REQUEST_ID,
      lockAck: { runNonce: NONCE2, requestId: REQUEST_ID, locked: true, acquireSentAtEpochMs: 5 },
    } as never)
    assert.ok(!r.ok && r.reason === 'READY_BEFORE_VERIFIED_LOCK')
  })
  it('legal order ARM→READY→PROOF→RELEASE with same-run nonce', () => {
    const m = armedMachine()
    const ready = m.accept({
      kind: 'READY',
      runNonce: NONCE,
      requestId: REQUEST_ID,
      lockAck: { runNonce: NONCE, requestId: REQUEST_ID, locked: true, acquireSentAtEpochMs: 5 },
    } as never)
    assert.ok(ready.ok)
    const proof = m.accept({
      kind: 'PROOF',
      runNonce: NONCE,
      requestId: REQUEST_ID,
      overlap: { topology: 'TRANSITIVE', appBackendPids: [101, 202], coordinatorPid: 900 },
    } as never)
    assert.ok(proof.ok)
    const rel = m.accept({ kind: 'RELEASE', runNonce: NONCE, requestId: REQUEST_ID, outcome: 'VOIDED' } as never)
    assert.ok(rel.ok)
  })
  it('same-run nonce rejects stale phases', () => {
    const m = armedMachine(NONCE)
    const r = m.accept({ kind: 'RELEASE', runNonce: NONCE2, requestId: REQUEST_ID, outcome: 'VOIDED' } as never)
    assert.ok(!r.ok && r.reason === 'STALE_NONCE')
  })
  it('illegal order and replay are rejected', () => {
    const m = armedMachine()
    assert.ok(!m.accept({ kind: 'PROOF', runNonce: NONCE, requestId: REQUEST_ID, overlap: null } as never).ok)
    const m2 = armedMachine()
    assert.ok(!m2.accept({ kind: 'ARM', runNonce: NONCE, requestId: REQUEST_ID }).ok)
  })
})

describe('T15E bounded psql per-command nonce framing', () => {
  const cfg = {
    expectedRunNonce: NONCE,
    maxLineBytes: 64,
    maxFrameBytes: 256,
    maxTotalBytes: 1024,
  }
  it('parses a fixed JSON result across arbitrary byte splits', () => {
    const p = createFramedResultParser(cfg)
    const wire = frameCommand(NONCE, 0, { ok: true, n: 1 })
    const bytes = bytesOf(wire)
    const out: unknown[] = []
    for (let i = 0; i < bytes.length; i++) out.push(...p.push(bytes.subarray(i, i + 1)))
    assert.equal(p.finish(), null)
    assert.equal(out.length, 1)
    assert.deepEqual(out[0], { seq: 0, total: Buffer.byteLength(JSON.stringify({ ok: true, n: 1 }), 'utf8'), result: { ok: true, n: 1 } })
  })
  it('rejects wrong nonce, unexpected tag, pre-frame output with fixed safe error', () => {
    for (const wire of [
      frameCommand(NONCE2, 0, { ok: true }),
      'noise-before-frame\n' + frameCommand(NONCE, 0, { ok: true }),
      'T15E_X1:' + NONCE + ':0:\n',
    ]) {
      const p = createFramedResultParser(cfg)
      const err = firstError(p.push(bytesOf(wire)))
      assert.ok(err, wire.slice(0, 20))
      assert.deepEqual(err, { code: 'T15E_FRAME_PROTOCOL_ERROR', message: T15E_SAFE_ERROR_MESSAGE })
    }
  })
  it('rejects oversize TOTAL and aggregate oversize', () => {
    const p = createFramedResultParser(cfg)
    const forged = `T15E_B1:${NONCE}:0:\n{"x":1}\nT15E_E1:${NONCE}:0:999999:\n`
    const err = firstError(p.push(bytesOf(forged)))
    assert.ok(err, 'forged TOTAL')
    const p2 = createFramedResultParser(cfg)
    let err2: unknown = null
    for (let i = 0; i < 20 && !err2; i++) {
      err2 = firstError(p2.push(bytesOf(frameCommand(NONCE, i, { ok: true, i }))))
    }
    assert.ok(err2, 'aggregate oversize')
  })
  it('rejects oversized partial lines, unterminated frames, multi-JSON frames', () => {
    const p = createFramedResultParser(cfg)
    const err = firstError(p.push(Buffer.alloc(cfg.maxLineBytes + 1, 0x78)))
    assert.ok(err, 'partial line bound')
    const p2 = createFramedResultParser(cfg)
    p2.push(bytesOf(`T15E_B1:${NONCE}:0:\n{"a":1}\n`))
    assert.ok(p2.finish() !== null, 'unterminated frame')
    const p3 = createFramedResultParser(cfg)
    const wire = `T15E_B1:${NONCE}:0:\n{"a":1}\n{"b":2}\nT15E_E1:${NONCE}:0:18:\n`
    const err3 = firstError(p3.push(bytesOf(wire)))
    assert.ok(err3, 'two JSON lines in one frame')
  })
  it('error payloads never echo input', () => {
    const p = createFramedResultParser(cfg)
    const secret = 'leaky-secret-diagnostic'
    const err = firstError(p.push(bytesOf(secret + '\n')))
    assert.ok(err)
    assert.equal(JSON.stringify(err).includes(secret), false)
  })
})

describe('T15E pure overlap verifier (sanitized snapshots)', () => {
  const cfg = defaultOverlapCheckConfig(1_000_000 + T15E_DEADLINES_MS.snapshotMaxAge - 1)
  it('accepts TRANSITIVE A→coordinator, B→A', () => {
    const r = verifyOverlapSnapshot(snapshot(), cfg)
    assert.ok(r.ok)
    assert.equal(r.topology, 'TRANSITIVE')
  })
  it('accepts DIRECT_BOTH', () => {
    const s = snapshot()
    s.sessions[2] = { ...s.sessions[2], blockingPids: [900] }
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(r.ok && r.topology === 'DIRECT_BOTH')
  })
  it('fails STALE_COORDINATOR_SNAPSHOT on old capture', () => {
    const r = verifyOverlapSnapshot(snapshot(), defaultOverlapCheckConfig(5_000_000))
    assert.ok(!r.ok && r.reason === 'STALE_COORDINATOR_SNAPSHOT')
  })
  it('fails MISSING_COORDINATOR', () => {
    const s = snapshot()
    s.sessions = s.sessions.filter((x) => x.pid !== 900)
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(!r.ok && r.reason === 'MISSING_COORDINATOR')
  })
  it('fails EXACTLY_TWO_APP_BACKENDS for a third backend', () => {
    const s = snapshot()
    s.sessions.push({
      pid: 303,
      backendStart: '2026-01-01T00:06:00Z',
      databaseId: 7,
      xactStart: '2026-01-01T00:07:00Z',
      blockingPids: [900],
      queryCategory: 'UNKNOWN',
    })
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(!r.ok && r.reason === 'EXACTLY_TWO_APP_BACKENDS')
  })
  it('fails XACT_NOT_ACTIVE when an app backend has no transaction', () => {
    const s = snapshot()
    s.sessions[2] = { ...s.sessions[2], xactStart: null }
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(!r.ok && r.reason === 'XACT_NOT_ACTIVE')
  })
  it('fails UNKNOWN_NODE on foreign blocking pid', () => {
    const s = snapshot()
    s.sessions[1] = { ...s.sessions[1], blockingPids: [4242] }
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(!r.ok && r.reason === 'UNKNOWN_NODE')
  })
  it('fails CYCLE', () => {
    const s = snapshot()
    s.sessions[1] = { ...s.sessions[1], blockingPids: [202] }
    s.sessions[2] = { ...s.sessions[2], blockingPids: [101] }
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(!r.ok && r.reason === 'CYCLE')
  })
  it('fails ROOT_NOT_REACHED when a chain misses the coordinator', () => {
    const s = snapshot()
    s.sessions[1] = { ...s.sessions[1], blockingPids: [] }
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(!r.ok && r.reason === 'ROOT_NOT_REACHED')
  })
  it('fails DATABASE_MISMATCH and FOREIGN blocked coordinator', () => {
    const s = snapshot()
    s.sessions[2] = { ...s.sessions[2], databaseId: 8 }
    assert.ok(!verifyOverlapSnapshot(s, cfg).ok)
    const s2 = snapshot()
    s2.sessions[0] = { ...s2.sessions[0], blockingPids: [101] }
    const r2 = verifyOverlapSnapshot(s2, cfg)
    assert.ok(!r2.ok && r2.reason === 'FOREIGN')
  })
  it('bounded: snapshot over maxSessions fails; failures never echo pids', () => {
    const s = snapshot()
    s.sessions.push(...Array.from({ length: T15E_DEADLINES_MS.maxSessions }, (_, i) => ({
      pid: 500 + i,
      backendStart: '2026-01-01T00:06:00Z',
      databaseId: 7,
      xactStart: '2026-01-01T00:07:00Z',
      blockingPids: [],
      queryCategory: 'UNKNOWN' as const,
    })))
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(!r.ok && r.reason === 'SNAPSHOT_OVERBOUND')
    const r2 = verifyOverlapSnapshot(snapshot(), defaultOverlapCheckConfig(5_000_000))
    assert.ok(!r2.ok && JSON.stringify(r2).includes('900') === false)
  })
})

describe('T15E fail-closed classification and outcome proof', () => {
  it('query classifier defers to future adapter: always UNKNOWN', () => {
    assert.equal(classifyQueryText('SELECT * FROM whatever'), 'UNKNOWN')
    assert.equal(classifyQueryText(undefined), 'UNKNOWN')
  })
  it('outcome proof requires overlap AND actual success AND named source category', () => {
    assert.ok(!proveOutcome({ overlapVerified: true, actualSuccess: true, sourceConflictCategory: 'UNKNOWN' }).ok)
    assert.ok(!proveOutcome({ overlapVerified: false, actualSuccess: true, sourceConflictCategory: 'UNKNOWN' }).ok)
    assert.ok(!proveOutcome({ overlapVerified: true, actualSuccess: false, sourceConflictCategory: 'UNKNOWN' }).ok)
  })
})

// -------------------------------------------------------------------------
// Task69: Astra integrity fixes — reviewer counterexamples (BLOCK findings).
// -------------------------------------------------------------------------

describe('T15E fix1: phase machine binds every phase to the armed request', () => {
  const OTHER_REQUEST = '11223344-5566-4788-99aa-bbccddeeff00'
  it('READY for a different request with a self-consistent ack is rejected', () => {
    const m = armedMachine()
    const r = m.accept({
      kind: 'READY',
      runNonce: NONCE,
      requestId: OTHER_REQUEST,
      lockAck: { runNonce: NONCE, requestId: OTHER_REQUEST, locked: true, acquireSentAtEpochMs: 5 },
    } as never)
    assert.ok(!r.ok, 'must not accept READY for request B after ARM for request A')
    if (!r.ok) assert.equal(r.reason, 'REQUEST_MISMATCH')
  })
  it('lock ack identity must match the armed request', () => {
    const m = armedMachine()
    const r = m.accept({
      kind: 'READY',
      runNonce: NONCE,
      requestId: REQUEST_ID,
      lockAck: { runNonce: NONCE, requestId: OTHER_REQUEST, locked: true, acquireSentAtEpochMs: 5 },
    } as never)
    assert.ok(!r.ok)
  })
  it('PROOF and RELEASE cannot change request identity', () => {
    const m = armedMachine()
    assert.ok(
      m.accept({
        kind: 'READY',
        runNonce: NONCE,
        requestId: REQUEST_ID,
        lockAck: { runNonce: NONCE, requestId: REQUEST_ID, locked: true, acquireSentAtEpochMs: 5 },
      } as never).ok,
    )
    const proof = m.accept({
      kind: 'PROOF',
      runNonce: NONCE,
      requestId: OTHER_REQUEST,
      overlap: { topology: 'DIRECT_BOTH', appBackendPids: [101, 202], coordinatorPid: 900 },
    } as never)
    assert.ok(!proof.ok && proof.reason === 'REQUEST_MISMATCH')
    const proofOk = m.accept({
      kind: 'PROOF',
      runNonce: NONCE,
      requestId: REQUEST_ID,
      overlap: { topology: 'DIRECT_BOTH', appBackendPids: [101, 202], coordinatorPid: 900 },
    } as never)
    assert.ok(proofOk.ok)
    const rel = m.accept({ kind: 'RELEASE', runNonce: NONCE, requestId: OTHER_REQUEST, outcome: 'VOIDED' } as never)
    assert.ok(!rel.ok && rel.reason === 'REQUEST_MISMATCH')
  })
  it('proof topology enum uses own membership; toString/constructor are not topologies', () => {
    const m = armedMachine()
    assert.ok(
      m.accept({
        kind: 'READY',
        runNonce: NONCE,
        requestId: REQUEST_ID,
        lockAck: { runNonce: NONCE, requestId: REQUEST_ID, locked: true, acquireSentAtEpochMs: 5 },
      } as never).ok,
    )
    for (const topology of ['toString', 'constructor', 'hasOwnProperty', 'TRANSITIVE ']) {
      const r = m.accept({
        kind: 'PROOF',
        runNonce: NONCE,
        requestId: REQUEST_ID,
        overlap: { topology, appBackendPids: [101, 202], coordinatorPid: 900 },
      } as never)
      assert.ok(!r.ok, topology)
    }
  })
  it('proof PIDs must be two distinct positive integers', () => {
    const m = armedMachine()
    assert.ok(
      m.accept({
        kind: 'READY',
        runNonce: NONCE,
        requestId: REQUEST_ID,
        lockAck: { runNonce: NONCE, requestId: REQUEST_ID, locked: true, acquireSentAtEpochMs: 5 },
      } as never).ok,
    )
    for (const appBackendPids of [[101, 101], [0, 101], [-1, 101], [1.5, 101], [101], [101, 202, 303]]) {
      const r = m.accept({
        kind: 'PROOF',
        runNonce: NONCE,
        requestId: REQUEST_ID,
        overlap: { topology: 'TRANSITIVE', appBackendPids, coordinatorPid: 900 },
      } as never)
      assert.ok(!r.ok, JSON.stringify(appBackendPids))
    }
  })
})

describe('T15E fix2: overlap verifier rejects duplicate PIDs and hidden cycles', () => {
  const cfg = defaultOverlapCheckConfig(1_000_000 + T15E_DEADLINES_MS.snapshotMaxAge - 1)
  it('same PID with different backendStart is rejected, not two identities', () => {
    const s = snapshot()
    s.sessions[2] = { ...s.sessions[2], pid: 101, backendStart: '2026-01-01T09:09:09Z', blockingPids: [900] }
    s.sessions[1] = { ...s.sessions[1], blockingPids: [900] }
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(!r.ok && r.reason === 'DUPLICATE_SESSION_PID', 'duplicate pid must fail')
  })
  it("reviewer counterexample A->[coord,B], B->[A] is a cycle, never TRANSITIVE", () => {
    const s = snapshot()
    s.sessions[1] = { ...s.sessions[1], blockingPids: [900, 202] }
    s.sessions[2] = { ...s.sessions[2], blockingPids: [101] }
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(!r.ok && r.reason === 'CYCLE')
  })
  it('permuted session order yields the same verdict and sorted PIDs', () => {
    const s = snapshot()
    s.sessions = [s.sessions[2], s.sessions[0], s.sessions[1]]
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(r.ok)
    assert.equal(r.topology, 'TRANSITIVE')
    assert.deepEqual(r.appBackendPids, [101, 202])
    const d = snapshot()
    d.sessions[2] = { ...d.sessions[2], blockingPids: [900] }
    d.sessions = [d.sessions[1], d.sessions[2], d.sessions[0]]
    const rd = verifyOverlapSnapshot(d, cfg)
    assert.ok(rd.ok && rd.topology === 'DIRECT_BOTH')
    assert.deepEqual(rd.appBackendPids, [101, 202])
  })
  it('duplicate coordinator PID entry is rejected too', () => {
    const s = snapshot()
    s.sessions.push({ ...s.sessions[0], backendStart: '2026-01-01T08:08:08Z' })
    const r = verifyOverlapSnapshot(s, cfg)
    assert.ok(!r.ok && r.reason === 'DUPLICATE_SESSION_PID')
  })
})

describe('T15E fix3: one absolute 3s send-to-release deadline shared by acquire/observe/release', () => {
  it('exact reviewed constants: acquire fits, hold is absolute, release reserved', () => {
    assert.equal(T15E_DEADLINES_MS.lockAcquire, 1000)
    assert.equal(T15E_DEADLINES_MS.lockHoldSendToRelease, 3000)
    assert.equal(T15E_DEADLINES_MS.releaseReserve, 500)
    assert.ok(T15E_DEADLINES_MS.lockAcquire + T15E_DEADLINES_MS.releaseReserve <= T15E_DEADLINES_MS.lockHoldSendToRelease)
    assert.ok(validateDeadlinePlan(T15E_DEADLINES_MS).ok)
  })
  it('old contradictory defaults (15s acquire vs 3s hold) are rejected', () => {
    const r = validateDeadlinePlan({ ...T15E_DEADLINES_MS, lockAcquire: 15_000 })
    assert.ok(!r.ok && r.reason === 'ACQUIRE_PLUS_RESERVE_EXCEEDS_HOLD')
  })
  it('acquisition beyond the hold budget is rejected', () => {
    const over = validateDeadlinePlan({ ...T15E_DEADLINES_MS, lockAcquire: 2_600 })
    assert.ok(!over.ok && over.reason === 'ACQUIRE_PLUS_RESERVE_EXCEEDS_HOLD')
    const additive = validateDeadlinePlan({ ...T15E_DEADLINES_MS, lockAcquire: 2_700, releaseReserve: 400 })
    assert.ok(!additive.ok)
  })
  it('missing or non-positive release reserve is rejected', () => {
    for (const bad of [0, -1]) {
      const r = validateDeadlinePlan({ ...T15E_DEADLINES_MS, releaseReserve: bad })
      assert.ok(!r.ok && r.reason === 'NON_POSITIVE_BUDGET', String(bad))
    }
    const squeeze = validateDeadlinePlan({ ...T15E_DEADLINES_MS, releaseReserve: 2_050 })
    assert.ok(!squeeze.ok && squeeze.reason === 'ACQUIRE_PLUS_RESERVE_EXCEEDS_HOLD')
  })
  it('HARD MAX: non-configurable 3000ms cap rejects holds regardless of watchdog', () => {
    // Reviewer's exact case: hold 60000 under watchdog 120000 must NOT pass.
    const r = validateDeadlinePlan({ ...T15E_DEADLINES_MS, lockHoldSendToRelease: 60_000, overallWatchdog: 120_000 })
    assert.ok(!r.ok && r.reason === 'HOLD_EXCEEDS_HARD_MAX')
    const overByOne = validateDeadlinePlan({ ...T15E_DEADLINES_MS, lockHoldSendToRelease: 3_001 })
    assert.ok(!overByOne.ok && overByOne.reason === 'HOLD_EXCEEDS_HARD_MAX')
    assert.equal(MAX_LOCK_HOLD_MS, 3000)
    // 3000 exactly, and smaller legitimate plans, remain valid.
    assert.ok(validateDeadlinePlan(T15E_DEADLINES_MS).ok)
    assert.ok(
      validateDeadlinePlan({
        ...T15E_DEADLINES_MS,
        lockAcquire: 500,
        releaseReserve: 400,
        lockHoldSendToRelease: 1_500,
      }).ok,
    )
  })
  it('hold bound by watchdog; post-deadline cleanup never extends the hold', () => {
    const holdTooBig = validateDeadlinePlan({ ...T15E_DEADLINES_MS, lockHoldSendToRelease: 130_000 })
    assert.ok(!holdTooBig.ok && holdTooBig.reason === 'HOLD_EXCEEDS_HARD_MAX')
    const tinyWatchdog = validateDeadlinePlan({ ...T15E_DEADLINES_MS, overallWatchdog: 2_000 })
    assert.ok(!tinyWatchdog.ok && tinyWatchdog.reason === 'HOLD_EXCEEDS_WATCHDOG')
    // Cleanup budgets may exceed the hold — removing an owned resource after
    // the deadline is allowed — but that never validates a longer hold.
    const slowCleanup = validateDeadlinePlan({ ...T15E_DEADLINES_MS, rollback: 6_000, sigterm: 6_000, sigkill: 6_000 })
    assert.ok(slowCleanup.ok)
  })
})

describe('T15E fix4: Buffer-only transport, fatal UTF-8, chunk-independent', () => {
  const cfg = {
    expectedRunNonce: NONCE,
    maxLineBytes: 64,
    maxFrameBytes: 256,
    maxTotalBytes: 4096,
  }
  it('string chunks are rejected at runtime with a fixed category (no split-surrogate semantics)', () => {
    const p = createFramedResultParser(cfg)
    // A lone high surrogate as a STRING chunk: even though encodeable, string
    // transport is contractually rejected — the producer must encode once.
    const r = p.push('😀'.slice(0, 1) as never)
    assert.deepEqual(r, [{ code: 'T15E_STRING_TRANSPORT_REJECTED', message: T15E_SAFE_ERROR_MESSAGE }])
    // Parser stays failed: a following valid Buffer frame yields nothing.
    const after = p.push(bytesOf(frameCommand(NONCE, 0, { ok: true })))
    assert.equal(after.length, 0)
  })
  it('one coalesced Buffer push equals byte-by-byte pushes for multiple frames', () => {
    const wire = frameCommand(NONCE, 0, { ok: true, n: 0 }) + frameCommand(NONCE, 1, { ok: true, n: 1 })
    const bytes = bytesOf(wire)
    const p = createFramedResultParser(cfg)
    const coalesced = p.push(bytes).filter((x) => !('code' in x))
    assert.equal(p.finish(), null)
    const p2 = createFramedResultParser(cfg)
    const split: unknown[] = []
    for (let i = 0; i < bytes.length; i++) split.push(...p2.push(bytes.subarray(i, i + 1)))
    assert.equal(p2.finish(), null)
    assert.equal(coalesced.length, 2)
    assert.deepEqual(coalesced, split)
  })
  it('a large well-formed Buffer is fully consumed regardless of its size', () => {
    const p = createFramedResultParser(cfg)
    let wire = ''
    for (let i = 0; i < 6; i++) wire += frameCommand(NONCE, i, { ok: true, i })
    const out = p.push(bytesOf(wire)).filter((x) => !('code' in x))
    assert.equal(p.finish(), null)
    assert.equal(out.length, 6)
    assert.deepEqual(out.map((x) => (x as { seq: number }).seq), [0, 1, 2, 3, 4, 5])
  })
  it('byte bounds are UTF-8 bytes, not UTF-16 code units', () => {
    const p = createFramedResultParser(cfg)
    const json = JSON.stringify({ n: 'Ω'.repeat(40) })
    assert.ok(json.length < cfg.maxLineBytes)
    assert.ok(Buffer.byteLength(json, 'utf8') > cfg.maxLineBytes)
    const wire = `T15E_B1:${NONCE}:0:\n${json}\n`
    const err = firstError(p.push(bytesOf(wire)))
    assert.ok(err, 'multibyte oversize line must fail')
  })
  it('valid 4-byte emoji reassembles at EVERY byte partition', () => {
    const result = { note: 'OK 😀🎉 Ω ✓' }
    const bytes = bytesOf(frameCommand(NONCE, 0, result))
    assert.ok(Buffer.byteLength('😀', 'utf8') === 4)
    for (let i = 1; i < bytes.length; i++) {
      const p = createFramedResultParser({ ...cfg, maxLineBytes: 512, maxFrameBytes: 512 })
      const out = [
        ...p.push(bytes.subarray(0, i)),
        ...p.push(bytes.subarray(i)),
      ].filter((x) => !('code' in x))
      assert.equal(p.finish(), null, `partition at byte ${i}`)
      assert.equal(out.length, 1, `partition at byte ${i}`)
      assert.deepEqual(out[0], {
        seq: 0,
        total: Buffer.byteLength(JSON.stringify(result), 'utf8'),
        result,
      })
    }
  })
  it('malformed UTF-8 inside a line fails closed — never replacement chars', () => {
    const prefix = Buffer.from(`T15E_B1:${NONCE}:0:\n{"n":"`, 'utf8')
    const suffix = Buffer.from('"}\n', 'utf8')
    for (const bad of [
      Buffer.from([0xff]), // invalid lead byte
      Buffer.from([0x80]), // lone continuation
      Buffer.from([0xf0, 0x9f, 0x98]), // truncated 4-byte sequence
      Buffer.from([0xc0, 0x80]), // overlong encoding
    ]) {
      const p = createFramedResultParser({ ...cfg, maxLineBytes: 512, maxFrameBytes: 512 })
      const wire = Buffer.concat([prefix, bad, suffix])
      const err = firstError(p.push(wire))
      assert.ok(err, `bad bytes ${bad.toString('hex')} must fail, not silently decode`)
      assert.deepEqual(err, { code: 'T15E_FRAME_PROTOCOL_ERROR', message: T15E_SAFE_ERROR_MESSAGE })
    }
  })
  it('multibyte partial line split across pushes is bounded in bytes', () => {
    const p = createFramedResultParser(cfg)
    const chunk = Buffer.from('Ω'.repeat(64), 'utf8') // 128 bytes
    const err = firstError([
      ...p.push(chunk.subarray(0, 40)),
      ...p.push(chunk.subarray(40)),
    ])
    assert.ok(err, 'byte-oversize partial line must fail even when chunk sizes are small')
  })
})
