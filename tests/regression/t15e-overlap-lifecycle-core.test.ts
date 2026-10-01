// T15E bounded overlap lifecycle core (Task72) — regression tests over the
// PURE async orchestrator with INJECTED FAKES ONLY. No real process spawn, no
// psql, no DB, no fs, no real timers: clock/timer/session/snapshot/monitor are
// all fakes supplied by these tests. Pins: budget arithmetic (one absolute
// <=3000ms hold incl. acquire/observe/release reserve), watchdog armed before
// acquire, no READY before a verified same-run lock ack, late responses after
// a deadline are never accepted, clearSnapshot before EVERY poll, cycle graphs
// rejected, rollback SIGTERM->SIGKILL escalation, child exit != backend gone,
// full timer/listener cleanup, late rejections consumed, nonce immutability.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runT15EOverlapLifecycle, type T15ELifecycleDeps } from '../support/native/t15e-overlap-lifecycle'
import {
  T15E_DEADLINES_MS,
  type DeadlinePlan,
  type SanitizedActivitySnapshot,
} from '../support/native/t15e-overlap-protocol'

const NONCE = 'c'.repeat(32)
const REQUEST_ID = '1f0e0d0c-2a3b-4c5d-9e8f-0a1b2c3d4e5f'
const START = 1_000_000
const HOLD = T15E_DEADLINES_MS.lockHoldSendToRelease // 3000
const RESERVE = T15E_DEADLINES_MS.releaseReserve // 500
const ACQUIRE = T15E_DEADLINES_MS.lockAcquire // 1000
const POLL = T15E_DEADLINES_MS.pollInterval // 250
const WATCHDOG = T15E_DEADLINES_MS.overallWatchdog // 120000

type Identity = { pid: number; backendStart: string; databaseId: number }
const IDENTITY: Identity = { pid: 900, backendStart: '2026-01-01T00:00:00Z', databaseId: 7 }

type Gate<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
function gate<T>(): Gate<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise<void>((r) => setImmediate(r))
async function play(steps: Array<() => void>) {
  for (const s of steps) {
    s()
    await flush()
    await flush()
  }
}

function proofSnapshot(capturedAt = START): SanitizedActivitySnapshot {
  return {
    provenance: { capturedAtEpochMs: capturedAt, source: 'fake-capture', dbIdentifier: 'iso-db' },
    coordinator: { pid: 900, backendStart: IDENTITY.backendStart, databaseId: 7 },
    sessions: [
      { pid: 900, backendStart: IDENTITY.backendStart, databaseId: 7, xactStart: 't', blockingPids: [], queryCategory: 'UNKNOWN' },
      { pid: 101, backendStart: 'a', databaseId: 7, xactStart: 't', blockingPids: [900], queryCategory: 'UNKNOWN' },
      { pid: 202, backendStart: 'b', databaseId: 7, xactStart: 't', blockingPids: [101], queryCategory: 'UNKNOWN' },
    ],
  }
}

function cycleSnapshot(): SanitizedActivitySnapshot {
  const s = proofSnapshot()
  // 101 <-> 202 mutual block: cycle, coordinator unreached.
  s.sessions[1].blockingPids = [900, 202]
  s.sessions[2].blockingPids = [101]
  return s
}

class FakeTimer {
  firedFlag = false
  cancelled = false
  private release!: () => void
  readonly fired: Promise<void>
  constructor(readonly ms: number) {
    this.fired = new Promise<void>((r) => {
      this.release = r
    })
  }
  fire() {
    if (this.firedFlag || this.cancelled) return
    this.firedFlag = true
    this.release()
  }
  failCancel = false
  cancel() {
    if (this.failCancel) throw new Error('cancel boom')
    this.cancelled = true
  }
}

class FakeClock {
  now = START
  nowEpochMs() {
    return this.now
  }
  advance(ms: number) {
    this.now += ms
  }
}

class SessionFake {
  readonly connect = gate<Identity | null>()
  readonly arm = gate<boolean>()
  readonly lockAck = gate<unknown>()
  readonly release = gate<boolean>()
  readonly releaseCleanup = gate<boolean>()
  readonly close = gate<boolean>()
  readonly signals: Array<'SIGTERM' | 'SIGKILL'> = []
  readonly signalIdentities: number[] = []
  disposeBehavior: (() => Promise<boolean>) | null = null
  readonly signalGates = new Map<"SIGTERM" | "SIGKILL", Gate<boolean>>()
  readonly gone = gate<boolean>()
  disposers: Array<(failure: unknown) => void> = []
  mutationAttempts = 0
  seenNonces: string[] = []
  disposerThrows = false
  onLateFailure(fn: (failure: unknown) => void) {
    this.disposers.push(fn)
    return () => {
      if (this.disposerThrows) throw new Error('disposer boom')
      this.disposers = this.disposers.filter((d) => d !== fn)
    }
  }
  signalGate(sig: 'SIGTERM' | 'SIGKILL') {
    if (!this.signalGates.has(sig)) this.signalGates.set(sig, gate<boolean>())
    return this.signalGates.get(sig)!
  }
  tryMutate(payload: unknown) {
    this.mutationAttempts++
    try {
      ;(payload as { runNonce?: string }).runNonce = 'f'.repeat(32)
      ;(payload as { requestId?: string }).requestId = 'ffffffff-1111-4222-8333-444455556666'
    } catch {
      // frozen payload: assignment throws in strict mode — expected
    }
  }
}

interface Harness {
  clock: FakeClock
  timers: FakeTimer[]
  timerArms: number[]
  session: SessionFake
  snapshotCalls: string[]
  pollGates: Array<Gate<unknown>>
  monitorLog: string[]
  deps: T15ELifecycleDeps
  run(overrides?: { plan?: Partial<DeadlinePlan>; nonce?: string; requestId?: string }): Promise<unknown>
}

function makeHarness(): Harness {
  const clock = new FakeClock()
  const timers: FakeTimer[] = []
  const timerArms: number[] = []
  const session = new SessionFake()
  const snapshotCalls: string[] = []
  const pollGates: Array<Gate<unknown>> = []
  const monitorLog: string[] = []
  const deps: T15ELifecycleDeps = {
    clock,
    scheduleTimer: (ms: number) => {
      const t = new FakeTimer(ms)
      timers.push(t)
      timerArms.push(ms)
      return t
    },
    session: {
      connect: () => session.connect.promise,
      sendArm: (payload: unknown) => {
        session.tryMutate(payload)
        session.seenNonces.push((payload as { runNonce: string }).runNonce)
        return session.arm.promise
      },
      sendLockAcquire: (payload: unknown) => {
        session.tryMutate(payload)
        session.seenNonces.push((payload as { runNonce: string }).runNonce)
        return session.lockAck.promise
      },
      sendRelease: (_payload: unknown, _deadlineEpochMs: number, phase: 'hold' | 'cleanup') =>
        (phase === 'hold' ? session.release : session.releaseCleanup).promise,
      close: () => session.close.promise,
      signal: (identity: { pid: number }, sig: 'SIGTERM' | 'SIGKILL') => {
        session.signals.push(sig)
        session.signalIdentities.push(identity.pid)
        return session.signalGate(sig).promise
      },
      dispose: () => (session.disposeBehavior ? session.disposeBehavior() : Promise.resolve(true)),
      onLateFailure: (fn: (failure: unknown) => void) => session.onLateFailure(fn),
    },
    snapshotSource: {
      clearSnapshot: () => snapshotCalls.push('clear'),
      poll: () => {
        snapshotCalls.push('poll')
        const g = gate<unknown>()
        pollGates.push(g)
        return g.promise
      },
    },
    backendMonitor: {
      confirmBackendGone: () => {
        monitorLog.push('gone-check')
        return session.gone.promise
      },
    },
  }
  return {
    clock,
    timers,
    timerArms,
    session,
    snapshotCalls,
    pollGates,
    monitorLog,
    deps,
    run: (overrides = {}) =>
      runT15EOverlapLifecycle(
        deps,
        { runNonce: overrides.nonce ?? NONCE, requestId: overrides.requestId ?? REQUEST_ID },
        overrides.plan ? { ...T15E_DEADLINES_MS, ...overrides.plan } : undefined,
      ) as Promise<unknown>,
  }
}

const validAck = (over: Record<string, unknown> = {}) => ({
  runNonce: NONCE,
  requestId: REQUEST_ID,
  locked: true,
  acquireSentAtEpochMs: START,
  ...over,
})

describe('T15E lifecycle core (injected fakes)', () => {
  it('happy path: ARM validated first, watchdog armed before acquire, proof -> release ack -> close -> backend gone -> success', async () => {
    const h = makeHarness()
    const p = h.run()
    // ARM validation happens before ANY adapter call: first await is connect.
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => h.pollGates[0].resolve(proofSnapshot()),
      () => h.session.release.resolve(true),
      () => h.session.close.resolve(true),
      () => h.session.gone.resolve(true),
    ])
    const r = (await p) as { ok: boolean; overlap?: { topology: string }; releasedAtEpochMs?: number }
    assert.equal(r.ok, true)
    assert.equal(r.overlap?.topology, 'TRANSITIVE')
    assert.equal(r.releasedAtEpochMs, START)
    // Watchdog is the FIRST timer armed, before connect/acquire timers.
    assert.equal(h.timerArms[0], WATCHDOG)
    // clearSnapshot before EVERY poll.
    assert.deepEqual(h.snapshotCalls, ['clear', 'poll'])
    assert.deepEqual(h.monitorLog, ['gone-check'])
  })

  it('invalid ARM identity fails before any adapter call; no connect', async () => {
    const h = makeHarness()
    const r = (await h.run({ nonce: 'zz' })) as { ok: boolean; primary: { category: string } }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'ARM_INVALID')
    assert.equal(h.timerArms.length, 0)
    assert.equal(h.snapshotCalls.length, 0)
  })

  it('invalid plan (hold > hard max) fails void without adapter calls', async () => {
    const h = makeHarness()
    const r = (await h.run({ plan: { lockHoldSendToRelease: 3001 } })) as { ok: boolean; primary: { category: string } }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'PLAN_INVALID')
    assert.equal(h.timerArms.length, 0)
  })

  it('delayed acquire consumes the ONE hold budget: ack ok but no observation window -> void', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([() => h.session.connect.resolve(IDENTITY), () => h.session.arm.resolve(true)])
    // Acquire ack arrives late in the hold (2600 of 3000 used): observe
    // deadline (hold - reserve = 2500) already passed -> NO_OVERLAP_PROOF.
    h.clock.advance(2600)
    await play([
      () => h.session.lockAck.resolve(validAck()),
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; stage: string }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'NO_OVERLAP_PROOF')
    assert.equal(r.stage, 'READY') // READY accepted (ack on time) but proof impossible
    assert.equal(h.pollGates.length, 0) // never polled
  })

  it('wrong-row lock ack (other request) never reaches READY; run voids', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck({ requestId: '9a8b7c6d-5e4f-4a3b-8c2d-1e2f3a4b5c6d' })),
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; stage: string }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'LOCK_ACK_INVALID')
    assert.equal(r.stage, 'ARMED') // no READY before a verified same-run ack
  })

  it('late READY: ack arriving after the absolute hold deadline is rejected', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([() => h.session.connect.resolve(IDENTITY), () => h.session.arm.resolve(true)])
    h.clock.advance(HOLD + 10)
    await play([
      () => h.session.lockAck.resolve(validAck()),
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; stage: string }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'HOLD_DEADLINE_EXCEEDED')
    assert.equal(r.stage, 'ARMED')
  })

  it('refresh order: clearSnapshot before EVERY poll across multiple polls', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => h.pollGates[0].resolve(null), // first poll: nothing yet
      () => h.timers[h.timers.length - 1].fire(), // pace timer (250ms)
      () => h.pollGates[1].resolve(proofSnapshot()),
      () => h.session.release.resolve(true),
      () => h.session.close.resolve(true),
      () => h.session.gone.resolve(true),
    ])
    const r = (await p) as { ok: boolean }
    assert.equal(r.ok, true)
    assert.equal(h.timerArms.includes(POLL), true) // pace used pollInterval
    assert.deepEqual(h.snapshotCalls, ['clear', 'poll', 'clear', 'poll'])
  })

  it('blocked poll: hanging read is bounded -> void, no hanging await', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
    ])
    // Do NOT resolve the poll; fire the poll budget timer (hold - reserve).
    const pollDeadline = h.timers.find((t) => t.ms === HOLD - RESERVE && !t.cancelled && !t.firedFlag)!
    pollDeadline.fire()
    await play([
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string } }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'NO_OVERLAP_PROOF')
  })

  it('late poll: valid proof snapshot arriving after the observe deadline is discarded', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
    ])
    h.clock.advance(HOLD) // now past observe deadline (hold - reserve)
    await play([
      () => h.pollGates[0].resolve(proofSnapshot(START + HOLD)), // would-be proof
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string } }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'NO_OVERLAP_PROOF')
    assert.equal(h.session.seenNonces.length, 2) // arm + acquire only; no success release
  })

  it('cycle graph is rejected as overlap proof; run voids without proof', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => h.pollGates[0].resolve(cycleSnapshot()), // rejected by verifyOverlapSnapshot
    ])
    // deadline passed while pacing -> loop exits with no proof
    h.clock.advance(HOLD)
    const pace = h.timers.find((t) => t.ms === POLL && !t.firedFlag && !t.cancelled)!
    pace.fire()
    await play([
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string } }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'NO_OVERLAP_PROOF')
  })

  it('rollback timeout escalates SIGTERM then SIGKILL; primary failure preserved, cleanup secondary', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => h.pollGates[0].resolve(proofSnapshot()),
    ])
    // Hold-path release never acks: fire its deadline timer -> RELEASE_ACK_MISSING.
    const relTimer = h.timers.find((t) => !t.firedFlag && !t.cancelled && t.ms === HOLD)!
    relTimer.fire()
    // Cleanup rollback also times out -> escalate.
    await flush()
    const rbTimer = h.timers.find((t) => !t.firedFlag && !t.cancelled && t.ms === T15E_DEADLINES_MS.rollback)!
    rbTimer.fire()
    await play([
      () => h.session.signalGate('SIGTERM').resolve(false), // child survives TERM
      () => h.session.signalGate('SIGKILL').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'RELEASE_ACK_MISSING')
    assert.deepEqual(r.cleanup, ['CLEANUP_ROLLBACK_TIMEOUT'])
    assert.deepEqual(h.session.signals, ['SIGTERM', 'SIGKILL'])
  })

  it('child exit is NOT backend gone: monitor says alive -> failure', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => h.pollGates[0].resolve(proofSnapshot()),
      () => h.session.release.resolve(true),
      () => h.session.close.resolve(true), // child exited...
      () => h.session.gone.resolve(false), // ...but independent monitor sees it alive
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'BACKEND_STILL_ALIVE')
    assert.equal(h.session.signals.includes('SIGTERM'), true)
  })

  it('unknown backend identity fails void; no exact-handle signal attempted', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([
      () => h.session.connect.resolve({ pid: 0, backendStart: '', databaseId: 7 }),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'IDENTITY_INVALID')
    assert.deepEqual(r.cleanup, ['CLEANUP_IDENTITY_UNKNOWN'])
    assert.equal(h.session.signals.length, 0)
  })

  it('all timers cancelled and late-failure listeners disposed at run end', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([() => h.session.connect.resolve(IDENTITY), () => h.session.arm.resolve(true)])
    // Both the ARM ack and the acquisition use the lockAcquire budget (1000ms);
    // target the LATEST armed timer — the acquisition one (earlier ones are
    // already cancelled by their losing races).
    const acquireTimer = [...h.timers].reverse().find((t) => t.ms === ACQUIRE && !t.cancelled)!
    acquireTimer.fire() // acquire budget out
    await play([
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string } }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'LOCK_ACK_TIMEOUT')
    assert.equal(h.timers.length > 0, true)
    for (const t of h.timers) assert.equal(t.cancelled, true, `timer ${t.ms} not cancelled`)
    assert.equal(h.session.disposers.length, 0) // listener disposed
  })

  it('late failures of raced calls are consumed: no unhandled rejection, nonce/UUID immutable across callbacks', async () => {
    const h = makeHarness()
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
    ])
    // Poll hangs; fire its budget timer (hold - reserve) -> run voids.
    const pollDeadline = h.timers.find((t) => t.ms === HOLD - RESERVE && !t.cancelled && !t.firedFlag)!
    pollDeadline.fire()
    await play([
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean }
    assert.equal(r.ok, false)
    // Late rejection arrives AFTER the run finished.
    h.pollGates[0].reject(new Error('late poll boom'))
    // Late ack for the finished run also rejected late (pending hold-release? none here)
    await new Promise((res) => setTimeout(res, 20))
    process.off('unhandledRejection', onUnhandled)
    assert.deepEqual(unhandled, [])
    // Adapters attempted mutation on every payload; identity still immutable.
    assert.ok(h.session.mutationAttempts >= 2)
    assert.ok(h.session.seenNonces.every((n) => n === NONCE))
  })
  // ------- Task73: Astra P1 integrity regressions (written RED first) -------


  it('P1-1: self-consistent FOREIGN snapshot coordinator is never proof', async () => {
    const h = makeHarness()
    const foreign = proofSnapshot()
    const FOREIGN_START = '2026-02-02T00:00:00Z'
    foreign.coordinator = { pid: 901, backendStart: FOREIGN_START, databaseId: 7 }
    // Re-root the ENTIRE graph at the foreign coordinator so the snapshot is
    // fully self-consistent (verifyOverlapSnapshot alone accepts it).
    foreign.sessions[0] = { ...foreign.sessions[0], pid: 901, backendStart: FOREIGN_START, blockingPids: [] }
    foreign.sessions[1] = { ...foreign.sessions[1], blockingPids: [901] }
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => h.pollGates[0].resolve(foreign),
    ])
    h.clock.advance(HOLD)
    // If (incorrectly) proven, no pace timer exists; if correctly unproven, the
    // pace timer must fire so the loop exits. Resolve BOTH paths' gates so the
    // test is bounded either way.
    h.timers.find((t) => t.ms === POLL && !t.firedFlag && !t.cancelled)?.fire()
    await play([
      () => h.session.release.resolve(true), // hold path (RED would take this)
      () => h.session.close.resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.releaseCleanup.resolve(true), // cleanup path (GREEN)
      () => h.session.signalGate('SIGTERM').resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string } }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'NO_OVERLAP_PROOF')
    assert.equal(h.session.seenNonces.length, 2) // no success release sent
  })

  it('P1-1: connected identity is a frozen defensive copy; adapter mutation cannot rebind it', async () => {
    const h = makeHarness()
    const p = h.run()
    // The adapter mutates its OWN returned identity object after connect.
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => {
        ;(IDENTITY as { pid?: number }).pid = 666 // mutate adapter-owned object
      },
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => h.pollGates[0].resolve(proofSnapshot()), // coordinator 900 must still bind
    ])
    // release times out -> cleanup signals the EXACT frozen identity (pid 900)
    const relTimer = h.timers.find((t) => !t.firedFlag && !t.cancelled && t.ms === HOLD)!
    relTimer.fire()
    await play([
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string } }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'RELEASE_ACK_MISSING')
    assert.deepEqual(h.session.signalIdentities, [900]) // frozen copy, not mutated 666
    delete (IDENTITY as { pid?: number }).pid
    ;(IDENTITY as { pid?: number }).pid = 900
  })

  it('P1-2: clearSnapshot synchronous throw is caught; bounded cleanup still fully runs', async () => {
    const h = makeHarness()
    let clearThrows = false
    h.deps.snapshotSource.clearSnapshot = () => {
      if (clearThrows) throw new Error('clear boom')
    }
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      // Arm the throw in the SAME step as the ack resolution: the orchestrator
      // resumes into observation during the following flush, so the FIRST
      // clearSnapshot call already throws synchronously.
      () => {
        clearThrows = true
        h.session.lockAck.resolve(validAck())
      },
    ])
    // Observation starts: first clearSnapshot call throws synchronously.
    await play([
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'ADAPTER_THROW')
    assert.deepEqual(r.cleanup, [])
    for (const t of h.timers) assert.equal(t.cancelled, true)
    assert.equal(h.session.disposers.length, 0)
  })

  it('P1-2: cleanup step throwing synchronously does not skip remaining disposal', async () => {
    const h = makeHarness()
    let releaseThrows = false
    h.deps.session.sendRelease = (_payload: unknown, _d: number, phase: 'hold' | 'cleanup') => {
      if (phase === 'cleanup' && releaseThrows) throw new Error('release boom')
      return Promise.resolve(false)
    }
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => {
        releaseThrows = true
        h.session.lockAck.resolve(validAck())
      },
      () => h.pollGates[0].resolve(null), // no snapshot yet
    ])
    h.clock.advance(HOLD) // observation window exhausted
    const pace = h.timers.find((t) => t.ms === POLL && !t.firedFlag && !t.cancelled)!
    pace.fire()
    await play([
      // cleanup rollback throws synchronously; the rest must still run
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    // NO_OVERLAP_PROOF -> cleanup rollback throws synchronously
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'NO_OVERLAP_PROOF') // primary preserved
    assert.deepEqual(r.cleanup, ['CLEANUP_ROLLBACK_TIMEOUT'])
    assert.deepEqual(h.session.signals, ['SIGTERM']) // termination still attempted
    assert.equal(h.monitorLog.includes('gone-check'), true) // monitor still attempted
    for (const t of h.timers) assert.equal(t.cancelled, true)
    assert.equal(h.session.disposers.length, 0)
  })

  it('P1-3: connect timeout + disposal FENCE ack -> no backend can live untracked; late identity ignored', async () => {
    const h = makeHarness()
    const disposeGate = gate<boolean>()
    h.session.disposeBehavior = () => disposeGate.promise
    const connectGate = h.session.connect
    const p = h.run()
    // Connect hangs; fire the connect budget timer (10s).
    const connectTimer = h.timers.find((t) => t.ms === T15E_DEADLINES_MS.connect && !t.firedFlag && !t.cancelled)!
    connectTimer.fire()
    await play([
      () => disposeGate.resolve(true), // fence ack: no future backend
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'CONNECT_FAILED')
    assert.deepEqual(r.cleanup, [])
    // Late-fulfilled connect arrives AFTER cleanup: must be consumed, untracked.
    const late = { ...IDENTITY, pid: 777 }
    await play([() => connectGate.resolve(late)])
    assert.equal(h.session.signals.length, 0) // no arbitrary/unknown kill
    assert.deepEqual(h.session.signalIdentities, [])
    for (const t of h.timers) assert.equal(t.cancelled, true)
  })

  it('P1-3: fence UNPROVEN + late identity -> bounded OWNED cleanup + independent gone', async () => {
    const h = makeHarness()
    const disposeGate = gate<boolean>()
    h.session.disposeBehavior = () => disposeGate.promise
    const connectGate = h.session.connect
    const p = h.run()
    const connectTimer = h.timers.find((t) => t.ms === T15E_DEADLINES_MS.connect && !t.firedFlag && !t.cancelled)!
    connectTimer.fire()
    await play([
      () => disposeGate.resolve(false), // fence unproven
      () => connectGate.resolve({ ...IDENTITY, pid: 888 }), // late identity arrives
      () => h.session.signalGate('SIGTERM').resolve(true), // owned cleanup on 888
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'CONNECT_FAILED') // first primary preserved
    assert.deepEqual(r.cleanup, ['CLEANUP_DISPOSAL_UNPROVEN'])
    assert.deepEqual(h.session.signalIdentities, [888]) // exact late identity only
    assert.equal(h.monitorLog.includes('gone-check'), true)
  })

  it('P1-4: adapter late failure reported during observation can never yield ok:true', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => h.pollGates[0].resolve(proofSnapshot()),
      () => (h.session.disposers[0] as (f: unknown) => void)(new Error('adapter late failure')),
      () => h.session.release.resolve(true),
      () => h.session.close.resolve(true),
      () => h.session.gone.resolve(true),
      // Task74: the latch blocks RELEASE publication, so cleanup terminates
      // the (never confirmed-gone) owned handle.
      () => h.session.signalGate('SIGTERM').resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; stage: string; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'LATE_ADAPTER_FAILURE')
    // Task74: the latch now blocks PUBLICATION of RELEASE(COMPLETED): PROOF is
    // published but the completed release never is.
    assert.equal(r.stage, 'PROVEN')
    assert.deepEqual(r.cleanup, [])
  })

  it('P1-4: latched late rejection preserves the FIRST primary; no unhandled rejection', async () => {
    const h = makeHarness()
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
    ])
    const pollDeadline = h.timers.find((t) => t.ms === HOLD - RESERVE && !t.cancelled && !t.firedFlag)!
    pollDeadline.fire()
    await play([
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string } }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'NO_OVERLAP_PROOF') // first primary wins
    h.pollGates[0].reject(new Error('late poll rejection')) // latched, consumed
    await new Promise((res) => setTimeout(res, 20))
    process.off('unhandledRejection', onUnhandled)
    assert.deepEqual(unhandled, [])
  })

  // ------- Task74: Astra P1 fail-closed finalization (written RED first) -----

  it('P74-1: happy flow + dispose false -> NEVER ok:true; fixed cleanup cat retained', async () => {
    const h = makeHarness()
    h.session.disposeBehavior = () => Promise.resolve(false)
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => h.pollGates[0].resolve(proofSnapshot()),
      () => h.session.release.resolve(true),
      () => h.session.close.resolve(true),
      () => h.session.gone.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'CLEANUP_FAILED')
    assert.deepEqual(r.cleanup, ['CLEANUP_DISPOSAL_UNPROVEN'])
  })

  it('P74-1: happy flow + dispose REJECT -> fail-closed, not ok:true', async () => {
    const h = makeHarness()
    h.session.disposeBehavior = () => Promise.reject(new Error('dispose boom'))
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => h.pollGates[0].resolve(proofSnapshot()),
      () => h.session.release.resolve(true),
      () => h.session.close.resolve(true),
      () => h.session.gone.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'CLEANUP_FAILED')
    assert.deepEqual(r.cleanup, ['CLEANUP_DISPOSAL_UNPROVEN'])
  })

  it('P74-1: cleanup close failure after successful hold close -> fail-closed', async () => {
    const h = makeHarness()
    let closeCalls = 0
    h.deps.session.close = () => {
      closeCalls++
      return Promise.resolve(closeCalls === 1) // stage-5 close ok, cleanup close fails
    }
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => h.pollGates[0].resolve(proofSnapshot()),
      () => h.session.release.resolve(true),
      () => h.session.gone.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'CLEANUP_FAILED')
    assert.deepEqual(r.cleanup, ['CLEANUP_SESSION_CLOSE_FAILED'])
  })

  it('P74-1: synchronous dispose throw in cleanup is fail-closed; earlier primary preserved', async () => {
    const h = makeHarness()
    h.deps.session.dispose = () => {
      throw new Error('unexpected dispose throw')
    }
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck({ requestId: '9a8b7c6d-5e4f-4a3b-8c2d-1e2f3a4b5c6d' })),
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'LOCK_ACK_INVALID') // first primary preserved
    assert.deepEqual(r.cleanup, ['CLEANUP_DISPOSAL_UNPROVEN']) // retained, never wiped
  })

  it('P74-2: latch BEFORE proof publication -> no PROOF, stage stays READY', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck()),
      () => {
        // Same step: proof snapshot resolves AND the adapter reports a late
        // failure -> the latch must block PROOF publication itself.
        h.pollGates[0].resolve(proofSnapshot())
        ;(h.session.disposers[0] as (f: unknown) => void)(new Error('late at proof'))
      },
      () => h.session.release.resolve(true),
      () => h.session.close.resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; stage: string }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'LATE_ADAPTER_FAILURE')
    assert.equal(r.stage, 'READY') // PROOF never published
  })

  it('P74-3: first timer cancel throws -> remaining timers AND listener disposer still run; disposer throw -> structured fail', async () => {
    const h = makeHarness()
    const p = h.run()
    await play([
      () => h.session.connect.resolve(IDENTITY),
      () => h.session.arm.resolve(true),
      () => h.session.lockAck.resolve(validAck({ requestId: '9a8b7c6d-5e4f-4a3b-8c2d-1e2f3a4b5c6d' })),
      () => {
        h.timers[0].failCancel = true // FIRST cancel throws
        h.session.disposerThrows = true // disposer also throws
      },
      () => h.session.releaseCleanup.resolve(true),
      () => h.session.signalGate('SIGTERM').resolve(true),
      () => h.session.gone.resolve(true),
      () => h.session.close.resolve(true),
    ])
    const r = (await p) as { ok: boolean; primary: { category: string }; cleanup: string[] }
    assert.equal(r.ok, false)
    assert.equal(r.primary.category, 'LOCK_ACK_INVALID') // primary never replaced
    assert.deepEqual(r.cleanup, ['CLEANUP_TIMER_CANCEL_FAILED', 'CLEANUP_DISPOSER_FAILED'])
    // The first (throwing) timer is not marked cancelled, but every OTHER
    // timer still got its cancel call.
    for (let i = 1; i < h.timers.length; i++) {
      assert.equal(h.timers[i].cancelled, true, `timer ${i} (${h.timers[i].ms}) not cancelled`)
    }
    assert.equal(h.session.disposers.length, 1) // disposer attempted (threw before clearing)
  })
})