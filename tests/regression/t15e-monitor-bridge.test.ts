// T15E monitor BRIDGE (Task91) — integrated fake test: Task86 CORE ->
// BRIDGE -> Task89 ADAPTER -> persistent TRANSPORT -> FAKE CHILD. No real
// spawn/psql/DB/sockets; temp owned files + fake ports only.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { frameCommand } from '../support/native/t15e-overlap-protocol'
import { REQUIRED_DATABASE_NAME } from '../support/native/native-environment'
import {
  createOwnedRuntime,
  mintT15EOwnedRuntimeCapability,
  revokeOwnedRuntimeT15ECapabilities,
  type OwnedRuntime,
} from '../support/native/postgres-instance'
import { createT15EPersistentPsqlConfigFromCapability, type T15EPersistentPsqlTransport } from '../support/native/t15e-persistent-session-transport'
import {
  createT15EMonitorSessionAdapter,
  type T15EMonitorSessionAdapter,
  type T15EMonitorSessionOpenResult,
  type T15EMonitorSessionQueryResult,
} from '../support/native/t15e-monitor-session-adapter'
import { openT15EMonitorBridge } from '../support/native/t15e-monitor-bridge'
import { createT15EBackendMonitor, T15E_MONITOR_CLEAR_SNAPSHOT_SQL, buildT15EMonitorIdentityQuery } from '../support/native/t15e-backend-monitor'
import { isT15ECapabilityLive } from '../support/native/postgres-instance'

const NONCE = 'c'.repeat(32)
const START = 1_000_000
const MONITOR_PID = 901
const COORD_PID = 900
const CANON = '2026-01-01T00:00:00.000000Z'

class FakeTimer {
  firedFlag = false
  cancelled = false
  private release!: () => void
  readonly fired: Promise<void>
  constructor(readonly ms: number) {
    this.fired = new Promise<void>((r) => { this.release = r })
  }
  fire() { if (!this.firedFlag && !this.cancelled) { this.firedFlag = true; this.release() } }
  cancel() { this.cancelled = true }
}
class FakeTimers {
  readonly armed: FakeTimer[] = []
  schedule(ms: number) { const t = new FakeTimer(ms); this.armed.push(t); return t }
  allCancelled() { return this.armed.every((t) => t.cancelled) }
  firePending() {
    for (let i = this.armed.length - 1; i >= 0; i--) {
      const t = this.armed[i]
      if (!t.cancelled && !t.firedFlag) { t.fire(); return }
    }
    throw new Error('test bug: no pending timer')
  }
}
class FakeClock {
  now = START
  nowEpochMs() { return this.now }
}
class FakeStdin extends EventEmitter {
  writes: Buffer[] = []
  ended = false
  write(buffer: Buffer, callback?: (error: Error | null) => void) {
    this.writes.push(buffer)
    if (callback) setImmediate(() => callback(null))
    return true
  }
  end() { this.ended = true }
  simulateClose() { this.emit('close') }
}
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = new FakeStdin()
  killedSignals: string[] = []
  exited = false
  kill(signal?: string) { this.killedSignals.push(signal ?? 'SIGTERM'); return true }
  simulateExit(code: number | null, signal: string | null) {
    if (this.exited) return
    this.exited = true
    this.emit('exit', code, signal)
  }
}
class FakeSpawner {
  calls: unknown[] = []
  spawn = (exe: string, args: readonly string[], options: unknown) => {
    const child = new FakeChild()
    this.calls.push({ exe, args, options, child })
    return child as never
  }
  get last() { return this.calls[this.calls.length - 1] as { child: FakeChild } }
}
const flush = () => new Promise<void>((r) => setImmediate(r))

interface Rig {
  runtime: OwnedRuntime
  adapter: ReturnType<typeof createT15EMonitorSessionAdapter>
  spawner: FakeSpawner
  timers: FakeTimers
  clock: FakeClock
  tmpParent: string
}
async function makeRig(): Promise<Rig> {
  const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-task91-'))
  const runtime = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
  const capability = mintT15EOwnedRuntimeCapability(runtime)
  if (capability === null) throw new Error('mint failed')
  const derived = createT15EPersistentPsqlConfigFromCapability(capability, { runNonce: NONCE })
  if (!derived.ok) throw new Error('derive failed')
  const spawner = new FakeSpawner()
  const timers = new FakeTimers()
  const clock = new FakeClock()
  const adapter = createT15EMonitorSessionAdapter({
    config: derived.config,
    transportDeps: { spawnPsql: spawner.spawn as never, clock, scheduleTimer: (ms: number) => timers.schedule(ms) },
  })
  return { runtime, adapter, spawner, timers, clock, tmpParent }
}
async function emit(rig: Rig, seq: number, result: Record<string, unknown>) {
  rig.spawner.last.child.stdout.emit('data', Buffer.from(frameCommand(NONCE, seq, result), 'utf8'))
}
async function openBridge(rig: Rig) {
  const openedPromise = openT15EMonitorBridge({ adapter: rig.adapter, coordinatorPid: COORD_PID, deadlineEpochMs: START + 10_000 })
  await flush()
  await emit(rig, 0, {
    pid: MONITOR_PID, backendStart: CANON, databaseId: 7,
    dataDirectory: rig.runtime.paths.dataDir,
    serverPort: rig.runtime.ports.databasePort,
    databaseName: REQUIRED_DATABASE_NAME,
  })
  return openedPromise
}
function makeCoreMonitor(rig: Rig, factory: Parameters<typeof createT15EBackendMonitor>[0]['createQuerySession'], cluster: Parameters<typeof createT15EBackendMonitor>[0]['expectedCluster']) {
  return createT15EBackendMonitor({
    clock: rig.clock,
    scheduleTimer: (ms: number) => rig.timers.schedule(ms),
    createQuerySession: factory,
    expectedCluster: cluster,
    pollIntervalMs: 250,
  })
}

describe('T15E monitor bridge (Task91)', () => {
  it('CORE->BRIDGE->ADAPTER->TRANSPORT->fake child: present then absent, exact refresh order, single connection', async () => {
    const rig = await makeRig()
    try {
      const bridge = await openBridge(rig)
      assert.equal(bridge.ok, true)
      if (!bridge.ok) return
      assert.equal(bridge.info.monitorBackend.pid, MONITOR_PID)
      const core = makeCoreMonitor(rig, bridge.factory, bridge.info.cluster)
      const pending = core.confirmBackendGone(
        { pid: COORD_PID, backendStart: CANON, databaseId: 7 },
        START + 10_000,
      )
      await new Promise((r) => setTimeout(r, 10))
      const child = rig.spawner.last.child
      // poll 1: clear + activity (found) -> PRESENT
      await emit(rig, 1, { cleared: true })
      await flush()
      await emit(rig, 2, { found: true, pid: COORD_PID, backendStart: CANON, databaseId: 7 })
      await flush()
      rig.timers.firePending() // pace between polls
      await flush() // let the core issue poll-2's clear first
      // poll 2: clear AGAIN then activity (absent) -> GONE
      await emit(rig, 3, { cleared: true })
      await flush()
      await emit(rig, 4, { found: false })
      const result = await pending
      assert.equal(result.kind, 'GONE')
      if (result.kind === 'GONE') assert.equal(result.checks, 2)
      const sqls = child.stdin.writes.map((w) => w.toString('utf8'))
      assert.match(sqls[0], /SELECT_BACKEND_IDENTITY/)
      assert.equal(sqls[1].includes('pg_stat_clear_snapshot'), true)
      assert.match(sqls[2], /pg_stat_activity/)
      assert.equal(sqls[3].includes('pg_stat_clear_snapshot'), true, 'clear BEFORE every activity')
      assert.match(sqls[4], /pg_stat_activity/)
      assert.equal(rig.spawner.calls.length, 1, 'single owned monitor connection')
      assert.equal(rig.timers.allCancelled(), true)
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('unknown SQL is rejected without any write; failures NEVER map to []', async () => {
    const rig = await makeRig()
    try {
      const bridge = await openBridge(rig)
      if (!bridge.ok) throw new Error('bridge open failed')
      const writesBefore = rig.spawner.last.child.stdin.writes.length
      const session = (await bridge.factory(START + 5_000)) as unknown as { session: { query: (sql: string, d: number) => Promise<unknown> } }
      await assert.rejects(session.session.query('select 1', START + 5_000), /T15E monitor bridge/)
      await assert.rejects(
        session.session.query(buildT15EMonitorIdentityQuery(COORD_PID + 1) ?? 'select 1', START + 5_000),
        /T15E monitor bridge/,
      )
      assert.equal(rig.spawner.last.child.stdin.writes.length, writesBefore, 'no SQL issued for unknown queries')
      // failure -> thrown, never []
      const failingCore = makeCoreMonitor(rig, async () => ({ ok: false }), bridge.info.cluster)
      const failed = await failingCore.confirmBackendGone({ pid: COORD_PID, backendStart: CANON, databaseId: 7 }, START + 5_000)
      assert.equal(failed.kind, 'UNPROVEN')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('malformed activity frame, child exit, timeout, and revocation are all UNPROVEN — never GONE', async () => {
    // malformed
    {
      const rig = await makeRig()
      try {
        const bridge = await openBridge(rig)
        if (!bridge.ok) throw new Error('open failed')
        const core = makeCoreMonitor(rig, bridge.factory, bridge.info.cluster)
        const pending = core.confirmBackendGone({ pid: COORD_PID, backendStart: CANON, databaseId: 7 }, START + 5_000)
        await new Promise((r) => setTimeout(r, 10))
        await emit(rig, 1, { cleared: true })
        await flush()
        await emit(rig, 2, { found: true, pid: COORD_PID, backendStart: 'garbage', databaseId: 7 })
        assert.equal((await pending).kind, 'UNPROVEN')
      } finally { await fs.rm(rig.tmpParent, { recursive: true, force: true }) }
    }
    // child exit mid-query
    {
      const rig = await makeRig()
      try {
        const bridge = await openBridge(rig)
        if (!bridge.ok) throw new Error('open failed')
        const core = makeCoreMonitor(rig, bridge.factory, bridge.info.cluster)
        const pending = core.confirmBackendGone({ pid: COORD_PID, backendStart: CANON, databaseId: 7 }, START + 5_000)
        await new Promise((r) => setTimeout(r, 10))
        rig.spawner.last.child.simulateExit(1, null)
        assert.equal((await pending).kind, 'UNPROVEN')
      } finally { await fs.rm(rig.tmpParent, { recursive: true, force: true }) }
    }
    // timeout (held activity + deadline)
    {
      const rig = await makeRig()
      try {
        const bridge = await openBridge(rig)
        if (!bridge.ok) throw new Error('open failed')
        const core = makeCoreMonitor(rig, bridge.factory, bridge.info.cluster)
        const pending = core.confirmBackendGone({ pid: COORD_PID, backendStart: CANON, databaseId: 7 }, START + 5_000)
        await new Promise((r) => setTimeout(r, 10))
        await emit(rig, 1, { cleared: true })
        await flush()
        rig.clock.now = START + 6_000
        rig.timers.firePending()
        assert.equal((await pending).kind, 'UNPROVEN')
      } finally { await fs.rm(rig.tmpParent, { recursive: true, force: true }) }
    }
    // revocation mid-monitoring
    {
      const rig = await makeRig()
      try {
        const bridge = await openBridge(rig)
        if (!bridge.ok) throw new Error('open failed')
        const core = makeCoreMonitor(rig, bridge.factory, bridge.info.cluster)
        const pending = core.confirmBackendGone({ pid: COORD_PID, backendStart: CANON, databaseId: 7 }, START + 5_000)
        await new Promise((r) => setTimeout(r, 10))
        revokeOwnedRuntimeT15ECapabilities(rig.runtime)
        const result = await pending
        assert.equal(result.kind, 'UNPROVEN')
      } finally { await fs.rm(rig.tmpParent, { recursive: true, force: true }) }
    }
  })
  it('foreign cluster and coordinator==monitor pid are rejected by the CORE', async () => {
    const rig = await makeRig()
    try {
      const bridge = await openBridge(rig)
      if (!bridge.ok) throw new Error('open failed')
      const foreign = makeCoreMonitor(rig, bridge.factory, { ...bridge.info.cluster, dataDirectory: '/foreign/pgdata' })
      const r1 = await foreign.confirmBackendGone({ pid: COORD_PID, backendStart: CANON, databaseId: 7 }, START + 5_000)
      assert.equal(r1.kind === 'UNPROVEN' && r1.category, 'T15E_MONITOR_CLUSTER_MISMATCH')
      const samePid = makeCoreMonitor(rig, bridge.factory, bridge.info.cluster)
      const r2 = await samePid.confirmBackendGone({ pid: MONITOR_PID, backendStart: CANON, databaseId: 7 }, START + 5_000)
      assert.equal(r2.kind === 'UNPROVEN' && r2.category, 'T15E_MONITOR_SAME_BACKEND')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('a DISPOSED adapter makes bridge queries fail (never gone); caller disposes in finally', async () => {
    const rig = await makeRig()
    try {
      const bridge = await openBridge(rig)
      if (!bridge.ok) throw new Error('open failed')
      const core = makeCoreMonitor(rig, bridge.factory, bridge.info.cluster)
      const pending = core.confirmBackendGone({ pid: COORD_PID, backendStart: CANON, databaseId: 7 }, START + 5_000)
      await new Promise((r) => setTimeout(r, 10))
      const disposing = rig.adapter.dispose(START + 5_000) // resource owner disposes
      await flush()
      rig.spawner.last.child.simulateExit(0, null)
      rig.spawner.last.child.stdin.simulateClose()
      await disposing
      const result = await pending
      assert.equal(result.kind, 'UNPROVEN', 'disposed bridge query fails closed, never gone')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  // --- Task90 P2 acceptance-gap tests (controlled promise ordering) ---
  it('P2: activity SUCCESS resolved, then revoke before continuation -> NOT published ok', async () => {
    const rig = await makeRig()
    try {
      await openBridge(rig)
      let resolveQuery!: (value: unknown) => void
      const stub = {
        connect: async () => ({ ok: true, identity: { pid: MONITOR_PID, backendStart: CANON, databaseId: 7 } }),
        executeTrustedCommand: (cmd: { kind: string }) => {
          if (cmd.kind === 'SELECT_ACTIVITY_FOR_PID') {
            return new Promise((resolve) => { resolveQuery = resolve })
          }
          return Promise.resolve({ ok: true, frame: { seq: 1, total: 1, result: { cleared: true } } })
        },
        dispose: async () => ({ ok: true, childExited: false, cleanupFailures: [], terminalCleanup: 'complete', backendGoneConfirmed: false, pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION' }),
        verifiedCluster: () => ({ dataDirectory: rig.runtime.paths.dataDir, serverPort: 1, databaseName: 'n' }),
        state: () => 'READY' as const,
        close: async () => true,
      } as unknown as T15EPersistentPsqlTransport
      const adapter = createT15EMonitorSessionAdapter({
        config: makeAdapterConfig(rig),
        transportDeps: { clock: rig.clock } as never,
        createTransport: (() => ({ ok: true, transport: stub })) as never,
      })
      const opened = await adapter.open(START + 5_000)
      assert.equal(opened.ok, true)
      const lookup = adapter.lookupActivity(COORD_PID, START + 5_000)
      await flush()
      resolveQuery({ ok: true, frame: { seq: 2, total: 1, result: { found: false } } })
      revokeOwnedRuntimeT15ECapabilities(rig.runtime) // BEFORE the adapter continuation
      const result = await lookup
      assert.equal(result.ok, false, 'success resolved pre-revocation cannot be published')
      assert.notDeepEqual(result, { ok: true, found: false })
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('P2: clear success, then revoke -> NO activity issued', async () => {
    const rig = await makeRig()
    try {
      await openBridge(rig)
      let activityIssued = 0
      const stub = {
        connect: async () => ({ ok: true, identity: { pid: MONITOR_PID, backendStart: CANON, databaseId: 7 } }),
        executeTrustedCommand: (cmd: { kind: string }) => {
          if (cmd.kind === 'SELECT_ACTIVITY_FOR_PID') { activityIssued += 1 }
          return Promise.resolve({ ok: true, frame: { seq: 1, total: 1, result: cmd.kind === 'CLEAR_STATS_SNAPSHOT' ? { cleared: true } : { found: false } } })
        },
        dispose: async () => ({ ok: true, childExited: false, cleanupFailures: [], terminalCleanup: 'complete', backendGoneConfirmed: false, pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION' }),
        verifiedCluster: () => ({ dataDirectory: rig.runtime.paths.dataDir, serverPort: 1, databaseName: 'n' }),
        state: () => 'READY' as const,
        close: async () => true,
      } as unknown as T15EPersistentPsqlTransport
      const adapter = createT15EMonitorSessionAdapter({
        config: makeAdapterConfig(rig),
        transportDeps: { clock: rig.clock } as never,
        createTransport: (() => ({ ok: true, transport: stub })) as never,
      })
      const opened = await adapter.open(START + 5_000)
      assert.equal(opened.ok, true)
      const cleared = await adapter.clearStatsSnapshot(START + 5_000)
      assert.deepEqual(cleared, { ok: true })
      revokeOwnedRuntimeT15ECapabilities(rig.runtime)
      const result = await adapter.lookupActivity(COORD_PID, START + 5_000)
      assert.equal(result.ok === false && result.category, 'T15E_MONITOR_SESSION_REVOKED')
      assert.equal(activityIssued, 0, 'revoked before the activity boundary: NO activity SQL')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
})

function makeAdapterConfig(rig: Awaited<ReturnType<typeof makeRig>>) {
  const capability = mintT15EOwnedRuntimeCapability(rig.runtime)
  if (capability === null) throw new Error('stub mint failed')
  const derived = createT15EPersistentPsqlConfigFromCapability(capability, { runNonce: NONCE })
  if (!derived.ok) throw new Error('stub derive failed')
  return derived.config
}

// Task92 bridge acceptance gaps. Authority: the fresh Task91 review at
// subagent-artifacts/outputs/c0f438ac-8264-47c4-b9dd-b6b222ae2afc/t15e-transport-task76-77-fresh-review.md
// (file present; not a relay of an older copy).
//
// Interposition is the BRIDGE boundary: adapter methods are held until the
// test settles them, THEN the lifecycle changes, still BEFORE the bridge
// continuation. This is not the transport->adapter gap. info() stays a
// non-null historical object so a missing info() check cannot fake the proof.
// checkAcceptance is the real adapter fence (captured capability + injected
// clock + disposed flag). No reopen, no mint, no real spawn/DB.

describe('T15E monitor bridge acceptance gaps (Task92)', { timeout: 15_000 }, () => {
  const OPEN_DEADLINE = START + 30_000
  const SHORT_DEADLINE = START + 5_000
  const HISTORICAL_INFO = Object.freeze({
    monitorBackend: Object.freeze({ pid: MONITOR_PID, backendStart: CANON, databaseId: 7 }),
    cluster: Object.freeze({
      dataDirectory: '/owned/historical-pgdata',
      serverPort: 23456,
      databaseName: REQUIRED_DATABASE_NAME,
    }),
  })
  type Variant = 'revoke' | 'dispose' | 'exact-deadline'

  function hold<T>(): { promise: Promise<T>; settle: (value: T) => void } {
    let settle!: (value: T) => void
    const promise = new Promise<T>((resolve) => { settle = resolve })
    return { promise, settle }
  }
  function deferAdapter(real: Rig['adapter'], spec: {
    openHeld?: { promise: Promise<{ ok: true; info: typeof HISTORICAL_INFO }> }
    clearHeld?: { promise: Promise<{ ok: true }> }
    lookupHeld?: { promise: Promise<{ ok: true; found: false } | { ok: false; category: 'T15E_MONITOR_SESSION_QUERY_FAILED' } | { ok: true; found: true; pid: number; backendStart: string; databaseId: number }> }
    lookupResult?: { ok: true; found: false } | { ok: false; category: 'T15E_MONITOR_SESSION_QUERY_FAILED' } | { ok: true; found: true; pid: number; backendStart: string; databaseId: number }
  }) {
    let openCalls = 0
    let clearCalls = 0
    let lookupCalls = 0
    const adapter: T15EMonitorSessionAdapter = {
        open: (): Promise<T15EMonitorSessionOpenResult> => {
          openCalls += 1
          if (spec.openHeld) return spec.openHeld.promise
          return Promise.resolve({ ok: true, info: HISTORICAL_INFO })
        },
        clearStatsSnapshot: () => {
          clearCalls += 1
          if (spec.clearHeld) return spec.clearHeld.promise
          return Promise.resolve({ ok: true as const })
        },
        lookupActivity: (): Promise<T15EMonitorSessionQueryResult> => {
          lookupCalls += 1
          if (spec.lookupHeld) return spec.lookupHeld.promise
          return Promise.resolve(spec.lookupResult ?? { ok: true, found: false })
        },
        queryCoordinatorIdentity: (pid: number, deadlineEpochMs: number) => real.queryCoordinatorIdentity(pid, deadlineEpochMs),
        dispose: (deadlineEpochMs: number) => real.dispose(deadlineEpochMs),
        // Historical metadata. Must stay non-null so the broken bridge cannot
        // fail closed merely because info() is missing.
        info: () => HISTORICAL_INFO,
        checkAcceptance: (deadlineEpochMs: number) => real.checkAcceptance(deadlineEpochMs),
    }
    return {
      openCalls: () => openCalls,
      clearCalls: () => clearCalls,
      lookupCalls: () => lookupCalls,
      adapter,
    }
  }
  function injectBeforeContinuation(rig: Rig, adapter: Rig['adapter'], variant: Variant, deadlineEpochMs: number) {
    if (variant === 'revoke') {
      revokeOwnedRuntimeT15ECapabilities(rig.runtime)
      return null
    }
    if (variant === 'dispose') {
      // Real dispose flips the captured fence synchronously before returning.
      return adapter.dispose(deadlineEpochMs)
    }
    rig.clock.now = deadlineEpochMs
    return null
  }
  async function settleBridge<T>(promise: Promise<T>) {
    return promise.then(
      (value) => ({ kind: 'fulfilled' as const, value }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    )
  }

  it('adapter.open settled, then revoke/dispose/exact-deadline before the bridge continuation, is not published', async () => {
    const failures: string[] = []
    for (const variant of ['revoke', 'dispose', 'exact-deadline'] as const) {
      const rig = await makeRig()
      try {
        const openHeld = hold<{ ok: true; info: typeof HISTORICAL_INFO }>()
        const wrapped = deferAdapter(rig.adapter, { openHeld })
        const bridgePromise = openT15EMonitorBridge({
          adapter: wrapped.adapter,
          coordinatorPid: COORD_PID,
          deadlineEpochMs: SHORT_DEADLINE,
        })
        if (wrapped.openCalls() !== 1) {
          failures.push(`${variant}: open was not held at the bridge boundary (calls=${wrapped.openCalls()})`)
          continue
        }
        openHeld.settle({ ok: true, info: HISTORICAL_INFO })
        const cleanup = injectBeforeContinuation(rig, wrapped.adapter, variant, SHORT_DEADLINE)
        const bridge = await bridgePromise
        if (cleanup) await cleanup
        if (bridge.ok !== false || wrapped.openCalls() !== 1) {
          failures.push(`${variant}: published ok=${bridge.ok} openCalls=${wrapped.openCalls()} infoWasHistorical=true`)
        }
      } catch (error) {
        failures.push(`${variant}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    }
    assert.equal(failures.length, 0, failures.join('\n'))
  })

  it('lookup settled {found:false}, then revoke/dispose/exact-deadline before the bridge continuation, throws and never returns []', async () => {
    const failures: string[] = []
    const identitySql = buildT15EMonitorIdentityQuery(COORD_PID)
    if (identitySql === null) throw new Error('test bug: identity sql')
    for (const variant of ['revoke', 'dispose', 'exact-deadline'] as const) {
      const rig = await makeRig()
      try {
        const lookupHeld = hold<{ ok: true; found: false }>()
        const wrapped = deferAdapter(rig.adapter, { lookupHeld })
        const bridge = await openT15EMonitorBridge({
          adapter: wrapped.adapter,
          coordinatorPid: COORD_PID,
          deadlineEpochMs: OPEN_DEADLINE,
        })
        if (!bridge.ok) {
          failures.push(`${variant}: precondition open failed`)
          continue
        }
        const made = await bridge.factory(OPEN_DEADLINE)
        if (!made.ok) {
          failures.push(`${variant}: precondition factory failed while fence held`)
          continue
        }
        const queryPromise = made.session.query(identitySql, SHORT_DEADLINE)
        if (wrapped.lookupCalls() !== 1) {
          failures.push(`${variant}: lookup was not pending at the bridge boundary`)
          continue
        }
        lookupHeld.settle({ ok: true, found: false })
        const cleanup = injectBeforeContinuation(rig, wrapped.adapter, variant, SHORT_DEADLINE)
        const settled = await settleBridge(queryPromise)
        if (cleanup) await cleanup
        if (settled.kind !== 'rejected') {
          failures.push(`${variant}: published ${JSON.stringify(settled.value)}`)
        }
      } catch (error) {
        failures.push(`${variant}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    }
    assert.equal(failures.length, 0, failures.join('\n'))
  })

  it('stale factory after revoke/dispose/exact invocation deadline does not report ok', async () => {
    const failures: string[] = []
    for (const variant of ['revoke', 'dispose', 'exact-deadline'] as const) {
      const rig = await makeRig()
      try {
        const wrapped = deferAdapter(rig.adapter, {})
        const bridge = await openT15EMonitorBridge({
          adapter: wrapped.adapter,
          coordinatorPid: COORD_PID,
          deadlineEpochMs: OPEN_DEADLINE,
        })
        if (!bridge.ok) {
          failures.push(`${variant}: precondition open failed`)
          continue
        }
        const cleanup = injectBeforeContinuation(rig, wrapped.adapter, variant, SHORT_DEADLINE)
        const outcome = await bridge.factory(SHORT_DEADLINE)
        if (cleanup) await cleanup
        if (outcome.ok !== false) {
          failures.push(`${variant}: factory published ok=true after ${variant}`)
        }
      } catch (error) {
        failures.push(`${variant}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    }
    assert.equal(failures.length, 0, failures.join('\n'))
  })

  it('held clear success, then revoke before the bridge continuation, rejects and the next query issues no activity', async () => {
    const rig = await makeRig()
    try {
      const clearHeld = hold<{ ok: true }>()
      const wrapped = deferAdapter(rig.adapter, { clearHeld })
      const bridge = await openT15EMonitorBridge({
        adapter: wrapped.adapter,
        coordinatorPid: COORD_PID,
        deadlineEpochMs: OPEN_DEADLINE,
      })
      if (!bridge.ok) throw new Error('precondition open failed')
      const made = await bridge.factory(OPEN_DEADLINE)
      if (!made.ok) throw new Error('precondition factory failed')
      const identitySql = buildT15EMonitorIdentityQuery(COORD_PID)
      if (identitySql === null) throw new Error('test bug: identity sql')
      const clearPromise = made.session.query(T15E_MONITOR_CLEAR_SNAPSHOT_SQL, SHORT_DEADLINE)
      assert.equal(wrapped.clearCalls(), 1)
      assert.equal(wrapped.lookupCalls(), 0)
      clearHeld.settle({ ok: true })
      revokeOwnedRuntimeT15ECapabilities(rig.runtime)
      const settled = await settleBridge(clearPromise)
      assert.equal(settled.kind, 'rejected', `clear published ${JSON.stringify(settled.kind === 'fulfilled' ? settled.value : settled)}`)
      const next = await settleBridge(made.session.query(identitySql, SHORT_DEADLINE))
      assert.equal(next.kind, 'rejected', `activity published ${JSON.stringify(next.kind === 'fulfilled' ? next.value : next)}`)
      assert.equal(wrapped.lookupCalls(), 0, 'revocation prevented the activity command')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('bridge entry rejects a revoked adapter without calling open', async () => {
    const rig = await makeRig()
    try {
      const wrapped = deferAdapter(rig.adapter, {})
      revokeOwnedRuntimeT15ECapabilities(rig.runtime)
      const bridge = await openT15EMonitorBridge({
        adapter: wrapped.adapter,
        coordinatorPid: COORD_PID,
        deadlineEpochMs: SHORT_DEADLINE,
      })
      assert.equal(
        wrapped.openCalls() === 0 && bridge.ok === false,
        true,
        `entry revoke published ok=${bridge.ok} openCalls=${wrapped.openCalls()}`,
      )
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('query entry after revoke throws before lookupActivity', async () => {
    const rig = await makeRig()
    try {
      const wrapped = deferAdapter(rig.adapter, {})
      const bridge = await openT15EMonitorBridge({
        adapter: wrapped.adapter,
        coordinatorPid: COORD_PID,
        deadlineEpochMs: OPEN_DEADLINE,
      })
      if (!bridge.ok) throw new Error('precondition open failed')
      const made = await bridge.factory(OPEN_DEADLINE)
      if (!made.ok) throw new Error('precondition factory failed')
      const identitySql = buildT15EMonitorIdentityQuery(COORD_PID)
      if (identitySql === null) throw new Error('test bug: identity sql')
      revokeOwnedRuntimeT15ECapabilities(rig.runtime)
      const settled = await settleBridge(made.session.query(identitySql, SHORT_DEADLINE))
      assert.equal(
        settled.kind === 'rejected' && wrapped.lookupCalls() === 0,
        true,
        `query entry published ${settled.kind === 'fulfilled' ? JSON.stringify(settled.value) : settled.kind} lookupCalls=${wrapped.lookupCalls()}`,
      )
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('pins explicit valid absence to [] and presence to one row while the fence holds', async () => {
    const rig = await makeRig()
    try {
      const absent = deferAdapter(rig.adapter, {})
      const opened = await openT15EMonitorBridge({
        adapter: absent.adapter,
        coordinatorPid: COORD_PID,
        deadlineEpochMs: OPEN_DEADLINE,
      })
      if (!opened.ok) throw new Error('open failed')
      const made = await opened.factory(OPEN_DEADLINE)
      if (!made.ok) throw new Error('factory failed')
      const identitySql = buildT15EMonitorIdentityQuery(COORD_PID)
      if (identitySql === null) throw new Error('test bug: identity sql')
      assert.deepEqual(await made.session.query(identitySql, SHORT_DEADLINE), [])
      assert.deepEqual(await made.session.query(T15E_MONITOR_CLEAR_SNAPSHOT_SQL, SHORT_DEADLINE), [])
      const present = deferAdapter(rig.adapter, {
        lookupResult: { ok: true, found: true, pid: COORD_PID, backendStart: CANON, databaseId: 7 },
      })
      const openedPresent = await openT15EMonitorBridge({
        adapter: present.adapter,
        coordinatorPid: COORD_PID,
        deadlineEpochMs: OPEN_DEADLINE,
      })
      if (!openedPresent.ok) throw new Error('present open failed')
      const presentSession = await openedPresent.factory(OPEN_DEADLINE)
      if (!presentSession.ok) throw new Error('present factory failed')
      assert.deepEqual(await presentSession.session.query(identitySql, SHORT_DEADLINE), [[String(COORD_PID), CANON, '7']])
      await assert.rejects(
        presentSession.session.query('select 1', SHORT_DEADLINE),
        /T15E monitor bridge/,
      )
      assert.equal(present.lookupCalls(), 1, 'unknown SQL issues no activity')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('adapter failure still throws and never becomes []', async () => {
    const rig = await makeRig()
    try {
      const wrapped = deferAdapter(rig.adapter, {
        lookupResult: { ok: false, category: 'T15E_MONITOR_SESSION_QUERY_FAILED' },
      })
      const bridge = await openT15EMonitorBridge({
        adapter: wrapped.adapter,
        coordinatorPid: COORD_PID,
        deadlineEpochMs: OPEN_DEADLINE,
      })
      if (!bridge.ok) throw new Error('open failed')
      const made = await bridge.factory(OPEN_DEADLINE)
      if (!made.ok) throw new Error('factory failed')
      const identitySql = buildT15EMonitorIdentityQuery(COORD_PID)
      if (identitySql === null) throw new Error('test bug: identity sql')
      await assert.rejects(made.session.query(identitySql, SHORT_DEADLINE), /T15E monitor bridge/)
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
})
