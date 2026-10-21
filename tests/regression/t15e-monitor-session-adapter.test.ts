// T15E monitor-session adapter (Task89) — INJECTED FAKES ONLY over the REAL
// adapter + persistent transport path: fake child/clock/timers, real producer
// allocation (fake port probe, temp owned files only). No spawn/psql/DB.
// Child exit is NEVER backend gone; the monitor's own backend disappearance
// stays a pending outer-runtime teardown proof.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { frameCommand } from '../support/native/t15e-overlap-protocol'
import { PG_BIN, REQUIRED_DATABASE_NAME } from '../support/native/native-environment'
import {
  createOwnedRuntime,
  mintT15EOwnedRuntimeCapability,
  revokeOwnedRuntimeT15ECapabilities,
  type OwnedRuntime,
} from '../support/native/postgres-instance'
import { createT15EPersistentPsqlConfigFromCapability } from '../support/native/t15e-persistent-session-transport'
import {
  createT15EMonitorSessionAdapter,
  type T15EMonitorSessionAdapterDeps,
} from '../support/native/t15e-monitor-session-adapter'
import type { T15EPersistentPsqlTransport } from '../support/native/t15e-persistent-session-transport'

const NONCE = 'b'.repeat(32)
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
  fire() {
    if (this.firedFlag || this.cancelled) return
    this.firedFlag = true
    this.release()
  }
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
async function makeRig(clusterOverrides: Record<string, unknown> = {}): Promise<Rig> {
  const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-task89-'))
  const runtime = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
  const capability = mintT15EOwnedRuntimeCapability(runtime)
  if (capability === null) throw new Error('mint failed')
  const derived = createT15EPersistentPsqlConfigFromCapability(capability, { runNonce: NONCE })
  if (!derived.ok) throw new Error(`derive failed: ${derived.reason}`)
  const spawner = new FakeSpawner()
  const timers = new FakeTimers()
  const clock = new FakeClock()
  const adapter = createT15EMonitorSessionAdapter({
    config: derived.config,
    transportDeps: {
      spawnPsql: spawner.spawn as never,
      clock,
      scheduleTimer: (ms: number) => timers.schedule(ms),
    },
  })
  void clusterOverrides
  return { runtime, adapter, spawner, timers, clock, tmpParent }
}
async function openVerified(rig: Rig, identityOverrides: Record<string, unknown> = {}) {
  const open = rig.adapter.open(rig.clock.now + 10_000)
  await flush()
  rig.spawner.last.child.stdout.emit(
    'data',
    Buffer.from(
      frameCommand(NONCE, 0, {
        pid: MONITOR_PID,
        backendStart: CANON,
        databaseId: 7,
        dataDirectory: rig.runtime.paths.dataDir,
        serverPort: rig.runtime.ports.databasePort,
        databaseName: REQUIRED_DATABASE_NAME,
        ...identityOverrides,
      }),
      'utf8',
    ),
  )
  return open
}
async function respond(rig: Rig, seq: number, result: Record<string, unknown>) {
  await flush()
  rig.spawner.last.child.stdout.emit('data', Buffer.from(frameCommand(NONCE, seq, result), 'utf8'))
  await flush() // let the NEXT command issue before the caller proceeds
}

describe('T15E monitor-session adapter (Task89)', () => {
  it('open verified -> clear -> activity query on one connection, fixed SQL only', async () => {
    const rig = await makeRig()
    try {
      const opened = await openVerified(rig)
      assert.equal(opened.ok, true)
      const info = rig.adapter.info()
      assert.notEqual(info, null)
      assert.equal(info!.monitorBackend.pid, MONITOR_PID)
      assert.equal(info!.cluster.dataDirectory, rig.runtime.paths.dataDir)
      assert.ok(Object.isFrozen(info!) && Object.isFrozen(info!.cluster), 'frozen metadata')
      const query = rig.adapter.queryCoordinatorIdentity(COORD_PID, rig.clock.now + 10_000)
      await flush()
      const child = rig.spawner.last.child
      // Strictly sequential: identity then clear; activity follows only after
      // the clear FRAME completes (single connection, no pipelining).
      let sqls = child.stdin.writes.map((w) => w.toString('utf8'))
      assert.equal(sqls.length, 2, 'identity + clear issued')
      assert.match(sqls[0], /SELECT_BACKEND_IDENTITY/)
      assert.match(sqls[1], /pg_stat_clear_snapshot/)
      await respond(rig, 1, { cleared: true })
      await flush()
      sqls = child.stdin.writes.map((w) => w.toString('utf8'))
      assert.equal(sqls.length, 3, 'activity issued after the clear frame')
      assert.match(sqls[2], /pg_stat_activity/)
      assert.match(sqls[2], new RegExp(`where s.pid = ${COORD_PID}`), 'validated pid binding')
      assert.match(sqls[2], /to_char\(s.backend_start at time zone 'UTC'/, 'canonical expr')
      await respond(rig, 2, { found: true, pid: COORD_PID, backendStart: CANON, databaseId: 7 })
      const result = await query
      assert.deepEqual(result, { ok: true, found: true, pid: COORD_PID, backendStart: CANON, databaseId: 7 })
      assert.equal(rig.spawner.calls.length, 1, 'single connection throughout')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('query before open is rejected NOT_OPEN', async () => {
    const rig = await makeRig()
    try {
      const result = await rig.adapter.queryCoordinatorIdentity(COORD_PID, rig.clock.now + 10_000)
      assert.deepEqual(result, { ok: false, category: 'T15E_MONITOR_SESSION_NOT_OPEN' })
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('wrong cluster identity: open fails, no monitor commands', async () => {
    const rig = await makeRig()
    try {
      const open = rig.adapter.open(rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.stdout.emit(
        'data',
        Buffer.from(
          frameCommand(NONCE, 0, {
            pid: MONITOR_PID, backendStart: CANON, databaseId: 7,
            dataDirectory: '/foreign/pgdata',
            serverPort: rig.runtime.ports.databasePort,
            databaseName: REQUIRED_DATABASE_NAME,
          }),
          'utf8',
        ),
      )
      const opened = await open
      assert.equal(opened.ok === false && opened.category, 'T15E_MONITOR_SESSION_CONNECT_FAILED')
      assert.equal(rig.spawner.last.child.stdin.writes.length, 1, 'identity only — no monitor SQL')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('querying the monitor OWN pid is rejected SAME_BACKEND', async () => {
    const rig = await makeRig()
    try {
      await openVerified(rig)
      const result = await rig.adapter.queryCoordinatorIdentity(MONITOR_PID, rig.clock.now + 10_000)
      assert.deepEqual(result, { ok: false, category: 'T15E_MONITOR_SESSION_SAME_BACKEND' })
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('valid absent row maps to found:false (the only absent path)', async () => {
    const rig = await makeRig()
    try {
      await openVerified(rig)
      const query = rig.adapter.queryCoordinatorIdentity(COORD_PID, rig.clock.now + 10_000)
      await flush()
      await respond(rig, 1, { cleared: true })
      await flush()
      await respond(rig, 2, { found: false })
      assert.deepEqual(await query, { ok: true, found: false })
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('malformed/parse-failure frames are MALFORMED, never absent', async () => {
    for (const bad of [
      { found: 'yes' },
      { found: true, pid: COORD_PID, backendStart: 'garbage', databaseId: 7 },
      { found: true, pid: -1, backendStart: CANON, databaseId: 7 },
      { found: true, pid: COORD_PID, backendStart: CANON },
    ]) {
      const rig = await makeRig()
      try {
        await openVerified(rig)
        const query = rig.adapter.queryCoordinatorIdentity(COORD_PID, rig.clock.now + 10_000)
        await flush()
        await respond(rig, 1, { cleared: true })
        await flush()
        await respond(rig, 2, bad)
        const result = await query
        assert.deepEqual(result, { ok: false, category: 'T15E_MONITOR_SESSION_MALFORMED' }, JSON.stringify(bad))
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    }
  })
  it('transport failure mid-query is QUERY_FAILED, never absent', async () => {
    const rig = await makeRig()
    try {
      await openVerified(rig)
      const query = rig.adapter.queryCoordinatorIdentity(COORD_PID, rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.simulateExit(1, null) // child dies before any frame
      const result = await query
      assert.deepEqual(result, { ok: false, category: 'T15E_MONITOR_SESSION_QUERY_FAILED' })
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('revoked capability rejects commands with REVOKED (no bypass)', async () => {
    const rig = await makeRig()
    try {
      await openVerified(rig)
      revokeOwnedRuntimeT15ECapabilities(rig.runtime)
      const result = await rig.adapter.queryCoordinatorIdentity(COORD_PID, rig.clock.now + 10_000)
      assert.deepEqual(result, { ok: false, category: 'T15E_MONITOR_SESSION_REVOKED' })
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('bounded dispose with pending writable NEVER claims terminal complete or backend gone', async () => {
    const rig = await makeRig()
    try {
      await openVerified(rig)
      rig.spawner.last.child.stdin.writes.length = 1 // hold everything after identity
      const disposing = rig.adapter.dispose(rig.clock.now + 30_000)
      await flush()
      assert.deepEqual(rig.spawner.last.child.killedSignals, ['SIGTERM'])
      rig.timers.firePending() // sigterm budget expires
      await flush()
      rig.timers.firePending() // sigkill budget expires
      await flush()
      const outcome = await disposing
      assert.equal(outcome.ok, false)
      assert.equal(outcome.terminalCleanup, 'pending', 'writable never closed: pending, not complete')
      assert.equal(outcome.backendGoneConfirmed, false, 'child exit is NEVER backend gone')
      assert.equal(outcome.pendingObligation, 'INDEPENDENT_BACKEND_GONE_CONFIRMATION')
      assert.equal(rig.timers.allCancelled(), true)
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
  it('metadata is immutable against later runtime mutation', async () => {
    const rig = await makeRig()
    try {
      await openVerified(rig)
      const info = rig.adapter.info()!
      const before = info.cluster.dataDirectory
      ;(rig.runtime.paths as { dataDir: string }).dataDir = '/attacker/pgdata'
      assert.equal(info.cluster.dataDirectory, before)
      assert.equal(rig.adapter.info()!.cluster.dataDirectory, before)
      ;(rig.runtime.paths as { dataDir: string }).dataDir = before
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  // -------------------------------------------------------------------------
  // Task90 (relay): adapter ACCEPTANCE gates. Overdue absence, invalid
  // deadlines, and revoke/dispose racing a resolved transport success must
  // all be rejected by the adapter's OWN checks.
  // -------------------------------------------------------------------------

  describe('T15E monitor adapter acceptance gates (Task90, relay)', () => {
    it('RED: held {found:false} activity frame resolved at/past the deadline can never be ok', async () => {
      for (const clockAdvanceTo of [START + 10_000, START + 11_000]) {
        const rig = await makeRig()
        try {
          await openVerified(rig)
          let resolveActivity!: () => void
          const child = rig.spawner.last.child
          const origEmit = child.stdout.emit.bind(child.stdout)
          child.stdout.emit = ((event: string, chunk: unknown) => {
            if (event === 'data' && Buffer.isBuffer(chunk) && chunk.toString('utf8').includes('"found"')) {
              // capture and hold the frame bytes for the activity query
              resolveActivity = () => { origEmit('data', chunk) }
              return true
            }
            return origEmit(event, chunk as never)
          }) as typeof child.stdout.emit
          const query = rig.adapter.queryCoordinatorIdentity(COORD_PID, rig.clock.now + 10_000)
          await flush()
          await respond(rig, 1, { cleared: true }) // clear completes
          await flush()
          assert.equal(child.stdin.writes.length, 3, 'activity command was issued')
          await respond(rig, 2, { found: false }) // hijacked: frame held, not delivered
          assert.notEqual(resolveActivity, undefined as never, 'activity frame is held')
          rig.clock.now = clockAdvanceTo // exact/past deadline; timer NOT fired
          resolveActivity() // delivers the held {found:false} frame
          const result = await query
          assert.equal(result.ok, false, `deadline ${clockAdvanceTo}: overdue absence can never be ok`)
          assert.notDeepEqual(result, { ok: true, found: false })
        } finally {
          await fs.rm(rig.tmpParent, { recursive: true, force: true })
        }
      }
    })
    it('RED: invalid (NaN/Infinity) and expired deadlines issue NO SQL at all', async () => {
      const rig = await makeRig()
      try {
        await openVerified(rig)
        const writesBefore = rig.spawner.last.child.stdin.writes.length
        for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, START - 1]) {
          const result = await rig.adapter.queryCoordinatorIdentity(COORD_PID, bad)
          assert.equal(result.ok, false, String(bad))
          assert.equal(rig.spawner.last.child.stdin.writes.length, writesBefore, 'no SQL issued')
        }
        const rig2 = await makeRig()
        try {
          const opened = await rig2.adapter.open(Number.NaN)
          assert.equal(opened.ok, false, 'NaN open rejected')
          assert.equal(rig2.spawner.calls.length, 0, 'no open factory work for an invalid deadline')
        } finally {
          await fs.rm(rig2.tmpParent, { recursive: true, force: true })
        }
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('RED: revoke AFTER transport success but BEFORE continuation must reject open (injected transport)', async () => {
      const rig = await makeRig()
      try {
        let resolveConnect!: (value: unknown) => void
        const stub = {
          connect: () => new Promise<unknown>((resolve) => { resolveConnect = resolve }),
          executeTrustedCommand: async () => ({ ok: false, category: 'T15E_MONITOR_SESSION_QUERY_FAILED', message: 'x' }),
          dispose: async () => ({ ok: true, childExited: false, cleanupFailures: [], terminalCleanup: 'complete', backendGoneConfirmed: false, pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION' }),
          verifiedCluster: () => ({ dataDirectory: rig.runtime.paths.dataDir, serverPort: 1, databaseName: 'x' }),
          state: () => 'READY' as const,
          close: async () => true,
        } as unknown as T15EPersistentPsqlTransport
        const deps: T15EMonitorSessionAdapterDeps = {
          config: makeStubConfig(rig),
          transportDeps: { clock: rig.clock } as never,
          createTransport: (() => ({ ok: true, transport: stub })) as never,
        }
        const adapter = createT15EMonitorSessionAdapter(deps)
        const pending = adapter.open(START + 5_000)
        await flush()
        resolveConnect({ ok: true, identity: { pid: MONITOR_PID, backendStart: CANON, databaseId: 7 } })
        revokeOwnedRuntimeT15ECapabilities(rig.runtime) // BEFORE the adapter continuation
        const opened = await pending
        assert.equal(opened.ok, false, 'success resolved pre-revocation must not be published post-revocation')
        if (opened.ok === false) {
          assert.equal(opened.category, 'T15E_MONITOR_SESSION_REVOKED')
        }
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('RED: dispose AFTER transport success but BEFORE continuation must reject; disposal after revoke still allowed', async () => {
      const rig = await makeRig()
      try {
        let resolveConnect!: (value: unknown) => void
        let disposeCalls = 0
        const stub = {
          connect: () => new Promise<unknown>((resolve) => { resolveConnect = resolve }),
          executeTrustedCommand: async () => ({ ok: false, category: 'T15E_MONITOR_SESSION_QUERY_FAILED', message: 'x' }),
          dispose: async () => { disposeCalls += 1; return { ok: true, childExited: false, cleanupFailures: [], terminalCleanup: 'complete', backendGoneConfirmed: false, pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION' as const } },
          verifiedCluster: () => ({ dataDirectory: 'd', serverPort: 1, databaseName: 'n' }),
          state: () => 'READY' as const,
          close: async () => true,
        } as unknown as T15EPersistentPsqlTransport
        const adapter = createT15EMonitorSessionAdapter({
          config: makeStubConfig(rig),
          transportDeps: { clock: rig.clock } as never,
          createTransport: (() => ({ ok: true, transport: stub })) as never,
        })
        const pending = adapter.open(START + 5_000)
        await flush()
        resolveConnect({ ok: true, identity: { pid: MONITOR_PID, backendStart: CANON, databaseId: 7 } })
        await adapter.dispose(START + 5_000) // disposal fence BEFORE continuation
        const opened = await pending
        assert.equal(opened.ok, false)
        if (opened.ok === false) assert.equal(opened.category, 'T15E_MONITOR_SESSION_DISPOSED')
        // Cleanup stays allowed after revocation (exact owned handle path).
        revokeOwnedRuntimeT15ECapabilities(rig.runtime)
        await adapter.dispose(START + 5_000)
        assert.equal(disposeCalls, 2, 'disposal remains available after revocation')
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
  })

  function makeStubConfig(rig: Awaited<ReturnType<typeof makeRig>>) {
    const capability = mintT15EOwnedRuntimeCapability(rig.runtime)
    if (capability === null) throw new Error('stub mint failed')
    const derived = createT15EPersistentPsqlConfigFromCapability(capability, { runNonce: NONCE })
    if (!derived.ok) throw new Error('stub derive failed')
    return derived.config
  }

  describe('T15E monitor adapter acceptance exposure (Task92)', () => {
    it('checkAcceptance is the captured fence, ignores historical info, and does not reopen', async () => {
      const rig = await makeRig()
      try {
        assert.equal(rig.spawner.calls.length, 0)
        assert.equal(rig.adapter.info(), null)
        assert.equal(rig.adapter.checkAcceptance(START + 5_000), null)
        assert.equal(rig.adapter.checkAcceptance(Number.NaN), 'T15E_MONITOR_SESSION_DEADLINE_EXCEEDED')
        rig.clock.now = START + 5_000
        assert.equal(rig.adapter.checkAcceptance(START + 5_000), 'T15E_MONITOR_SESSION_DEADLINE_EXCEEDED')
        rig.clock.now = START
        revokeOwnedRuntimeT15ECapabilities(rig.runtime)
        assert.equal(rig.adapter.checkAcceptance(START + 5_000), 'T15E_MONITOR_SESSION_REVOKED')
        await rig.adapter.dispose(START + 5_000)
        assert.equal(rig.adapter.checkAcceptance(START + 5_000), 'T15E_MONITOR_SESSION_DISPOSED')
        assert.equal(rig.spawner.calls.length, 0, 'acceptance check does not spawn or reopen')
        assert.equal(rig.adapter.info(), null)
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('activity success settled, then dispose before continuation, is not published as absence', async () => {
      const rig = await makeRig()
      try {
        let resolveActivity!: (value: unknown) => void
        let disposeCalls = 0
        const stub = {
          connect: async () => ({ ok: true, identity: { pid: MONITOR_PID, backendStart: CANON, databaseId: 7 } }),
          executeTrustedCommand: (cmd: { kind: string }) => {
            if (cmd.kind === 'SELECT_ACTIVITY_FOR_PID') {
              return new Promise((resolve) => { resolveActivity = resolve })
            }
            return Promise.resolve({ ok: true, frame: { seq: 1, total: 1, result: { cleared: true } } })
          },
          dispose: async () => {
            disposeCalls += 1
            return {
              ok: true, childExited: false, cleanupFailures: [], terminalCleanup: 'complete',
              backendGoneConfirmed: false, pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION' as const,
            }
          },
          verifiedCluster: () => ({ dataDirectory: rig.runtime.paths.dataDir, serverPort: 1, databaseName: 'n' }),
          state: () => 'READY' as const,
          close: async () => true,
        } as unknown as T15EPersistentPsqlTransport
        const adapter = createT15EMonitorSessionAdapter({
          config: makeStubConfig(rig),
          transportDeps: { clock: rig.clock } as never,
          createTransport: (() => ({ ok: true, transport: stub })) as never,
        })
        const opened = await adapter.open(START + 5_000)
        assert.equal(opened.ok, true)
        const historical = adapter.info()
        assert.notEqual(historical, null, 'info is historical metadata, not the fence')
        const lookup = adapter.lookupActivity(COORD_PID, START + 5_000)
        await flush()
        resolveActivity({ ok: true, frame: { seq: 2, total: 1, result: { found: false } } })
        await adapter.dispose(START + 5_000)
        const result = await lookup
        assert.equal(result.ok, false)
        if (!result.ok) assert.equal(result.category, 'T15E_MONITOR_SESSION_DISPOSED')
        assert.notDeepEqual(result, { ok: true, found: false })
        assert.equal(adapter.info(), historical, 'dispose does not erase historical info or claim backend gone')
        assert.equal(adapter.checkAcceptance(START + 5_000), 'T15E_MONITOR_SESSION_DISPOSED')
        assert.equal(disposeCalls, 1)
        assert.equal(rig.spawner.calls.length, 0)
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
  })
})

void PG_BIN
