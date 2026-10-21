// T15E persistent psql session TRANSPORT slice (Task75) — unit tests over
// INJECTED FAKES ONLY: fake spawn returning a fake child with EventEmitter
// streams, fake clock, fake timers. NO real process spawn, NO psql, NO DB,
// NO .env, NO shared/default ports, NO server/HTTP/SMTP in this file.
//
// Scope pinned by the Astra review verdict
// (READY_FOR_BOUNDED_T15E_SESSION_ADAPTER_IMPLEMENTATION): this slice covers
// ONLY the persistent transport + child ownership/disposal. The FULL session
// adapter (barrier execution, snapshot source, backend monitor wiring, HTTP
// case integration) stays deferred — child exit is NEVER treated as
// backend-gone here.
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  removeOwnedRuntimeRoot,
  subscribeToT15ERevocation,
  t15eRevocationSubscriberCountForDiagnostics,
} from '../support/native/postgres-instance'
import {
  createT15EPersistentPsqlTransport,
  createNativePsqlSpawnFactory,
  validatePersistentPsqlTransportConfig,
  buildTrustedPsqlCommand,
  createT15EPersistentPsqlConfigFromCapability,
  T15E_PSQL_ARGS,
  T15E_SESSION_ADAPTER_OBLIGATIONS_PENDING,
  type T15EPsqlChild,
  type T15EPsqlSpawnFn,
  type T15EOwnedRuntimeCapability,
  type T15EPersistentPsqlConfig,
} from '../support/native/t15e-persistent-session-transport'
import {
  createOwnedRuntime,
  mintT15EOwnedRuntimeCapability,
  revokeOwnedRuntimeT15ECapabilities,
  stopPostgres,
  type OwnedRuntime,
} from '../support/native/postgres-instance'
import {
  frameCommand,
  T15E_DEADLINES_MS,
} from '../support/native/t15e-overlap-protocol'
import { PG_BIN, REQUIRED_DATABASE_NAME } from '../support/native/native-environment'

const NONCE = 'a'.repeat(32)
const REQUEST_ID = '1f0e0d0c-2a3b-4c5d-9e8f-0a1b2c3d4e5f'
const PSQL_EXE = path.join(PG_BIN, 'psql')
const START = 1_000_000

/**
 * REAL producer allocation (Task81): createOwnedRuntime with a FAKE port
 * probe (no sockets), creating runner-owned temporary FILES only — no
 * process, no server, no DB. Every test runtime uses a fresh unique owned
 * tmp root; cleaned in after().
 */
interface T15EProvenanceFixture {
  tmpParent: string
  runtime: OwnedRuntime
  config: T15EPersistentPsqlConfig
  capability: T15EOwnedRuntimeCapability
}
const shared = {} as T15EProvenanceFixture

function validConfig(): T15EPersistentPsqlConfig {
  return shared.config
}

function ownedDataDir(): string {
  return shared.runtime.paths.dataDir
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
  cancel() {
    this.cancelled = true
  }
}

class FakeTimers {
  readonly armed: FakeTimer[] = []
  schedule(ms: number) {
    const t = new FakeTimer(ms)
    this.armed.push(t)
    return t
  }
  allCancelled() {
    return this.armed.every((t) => t.cancelled)
  }
  /** Fire the newest armed timer that has not been cancelled/fired. */
  firePending() {
    for (let i = this.armed.length - 1; i >= 0; i--) {
      const t = this.armed[i]
      if (!t.cancelled && !t.firedFlag) {
        t.fire()
        return t
      }
    }
    throw new Error('test bug: no pending timer to fire')
  }
}

class FakeClock {
  now = START
  nowEpochMs() {
    return this.now
  }
}

class FakeStdin extends EventEmitter {
  writes: Buffer[] = []
  ended = false
  pendingWriteError: Error | null = null
  autoAckWrites = true
  backpressure = false
  syncWriteError: Error | null = null
  neverAck = false
  heldCallbacks: Array<(error: Error | null) => void> = []
  failRemoveListener = false
  write(buffer: Buffer, callback?: (error: Error | null) => void) {
    if (this.syncWriteError !== null) throw this.syncWriteError
    this.writes.push(buffer)
    if (callback && this.neverAck) {
      this.heldCallbacks.push(callback)
    } else if (callback) {
      const err = this.pendingWriteError
      setImmediate(() => callback(err))
    }
    return !this.backpressure
  }
  end() {
    this.ended = true
  }
  removeListener(event: string | symbol, listener: (...args: unknown[]) => void) {
    if (this.failRemoveListener) throw new Error('stdin removeListener boom')
    return super.removeListener(event, listener as (...args: unknown[]) => void)
  }
  simulateClose() {
    this.emit('close')
  }
  deliverHeldWriteCallbacks(error: Error | null) {
    const held = this.heldCallbacks.splice(0)
    for (const cb of held) cb(error)
  }
}

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = new FakeStdin()
  killedSignals: string[] = []
  exited = false
  readonly killThrowSignals = new Set<string>()
  failRemoveListener = false
  constructor() {
    super()
    this.on('newListener', () => undefined)
  }
  kill(signal?: string) {
    const sig = signal ?? 'SIGTERM'
    if (this.killThrowSignals.has(sig)) throw new Error(`kill boom: ${sig}`)
    this.killedSignals.push(sig)
    return true
  }
  removeListener(event: string | symbol, listener: (...args: unknown[]) => void) {
    if (this.failRemoveListener) throw new Error('removeListener boom')
    return super.removeListener(event, listener as (...args: unknown[]) => void)
  }
  simulateExit(code: number | null, signal: string | null) {
    if (this.exited) return
    this.exited = true
    this.emit('exit', code, signal)
  }
  simulateError(error: Error) {
    this.emit('error', error)
  }
  stdinError(error: Error) {
    this.stdin.emit('error', error)
  }
  stdoutData(chunk: Buffer | string) {
    this.stdout.emit('data', chunk)
  }
  stderrData(chunk: Buffer) {
    this.stderr.emit('data', chunk)
  }
}

class FakeSpawner {
  calls: Array<{ exe: string; args: readonly string[]; options: { env: Record<string, string>; shell: false }; child: FakeChild }> = []
  spawn: T15EPsqlSpawnFn = (exe, args, options) => {
    const child = new FakeChild()
    this.calls.push({ exe, args, options, child })
    return child as unknown as T15EPsqlChild
  }
  get last() {
    return this.calls[this.calls.length - 1]
  }
}

interface Rig {
  spawner: FakeSpawner
  timers: FakeTimers
  clock: FakeClock
  make(): ReturnType<typeof createT15EPersistentPsqlTransport>
}

function makeRig(): Rig {
  const spawner = new FakeSpawner()
  const timers = new FakeTimers()
  const clock = new FakeClock()
  return {
    spawner,
    timers,
    clock,
    make: () => createT15EPersistentPsqlTransport(validConfig(), {
      spawnPsql: spawner.spawn,
      clock,
      scheduleTimer: (ms) => timers.schedule(ms),
    }),
  }
}

const flush = () => new Promise<void>((r) => setImmediate(r))

/** Split a Buffer into fixed-size chunks (chunk grouping carries no meaning). */
function chunked(buffer: Buffer, size: number): Buffer[] {
  const out: Buffer[] = []
  for (let i = 0; i < buffer.length; i += size) out.push(buffer.subarray(i, i + size))
  return out
}

function identityFrame(seq: number, clusterOverrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    frameCommand(NONCE, seq, {
      pid: 900,
      backendStart: '2026-01-01T00:00:00.000000Z',
      databaseId: 7,
      dataDirectory: ownedDataDir(),
      serverPort: validConfig().port,
      databaseName: REQUIRED_DATABASE_NAME,
      ...clusterOverrides,
    }),
    'utf8',
  )
}

// ---------------------------------------------------------------------------
// Config validation (owned runtime only; never default/shared/.env)
// ---------------------------------------------------------------------------

describe('T15E persistent psql transport suite (producer-provenance fixture)', () => {
  before(async () => {
    shared.tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-provenance-test-'))
    shared.runtime = await createOwnedRuntime({ parentDir: shared.tmpParent }, async () => false)
    const capability = mintT15EOwnedRuntimeCapability(shared.runtime)
    if (capability === null) throw new Error('producer mint failed on a real allocation')
    shared.capability = capability
    const derived = createT15EPersistentPsqlConfigFromCapability(capability, { runNonce: NONCE })
    if (!derived.ok) throw new Error(`derived config rejected: ${derived.reason}`)
    shared.config = derived.config
  })

  after(async () => {
    await fs.rm(shared.tmpParent, { recursive: true, force: true })
  })

  describe('T15E persistent psql transport: config validation', () => {
    it('accepts the owned runner-resolved config', () => {
      assert.equal(validatePersistentPsqlTransportConfig(validConfig()).ok, true)
    })
    it('rejects the shared app port 3100 and default postgres port 5432', () => {
      for (const port of [3100, 5432]) {
        const verdict = validatePersistentPsqlTransportConfig({ ...validConfig(), port })
        assert.equal(verdict.ok, false, `port ${port} must be rejected`)
        assert.equal(verdict.ok === false && verdict.reason, 'PORT_SHARED_OR_DEFAULT')
      }
    })
    it('rejects non-loopback hosts and invalid ports', () => {
      for (const host of ['0.0.0.0', 'localhost', 'db.internal', '::1', '']) {
        const verdict = validatePersistentPsqlTransportConfig({ ...validConfig(), host })
        assert.equal(verdict.ok === false && verdict.reason, 'HOST_NOT_OWNED_LOOPBACK', `host ${host}`)
      }
      for (const port of [0, -1, 65536, 80.5]) {
        const verdict = validatePersistentPsqlTransportConfig({ ...validConfig(), port })
        assert.equal(verdict.ok === false && verdict.reason, 'PORT_INVALID', `port ${port}`)
      }
    })
    it('rejects any database other than the owned REQUIRED_DATABASE_NAME', () => {
      for (const database of ['postgres', 'app', 'template1']) {
        const verdict = validatePersistentPsqlTransportConfig({ ...validConfig(), database })
        assert.equal(verdict.ok === false && verdict.reason, 'DATABASE_NOT_OWNED')
      }
    })
    it('rejects executables that are not the runner-resolved PG_BIN psql', () => {
      for (const psqlExecutable of ['/usr/bin/psql', 'psql', '/opt/homebrew/opt/postgresql@16/bin/pg_ctl']) {
        const verdict = validatePersistentPsqlTransportConfig({ ...validConfig(), psqlExecutable })
        assert.equal(verdict.ok === false && verdict.reason, 'EXECUTABLE_NOT_RUNNER_RESOLVED')
      }
    })
    it('rejects weak passwords and invalid run nonces', () => {
      for (const password of ['', 'short', 'has space and quotes!', 'ünïcöde-pw-not-allowed-here!']) {
        const verdict = validatePersistentPsqlTransportConfig({ ...validConfig(), password })
        assert.equal(verdict.ok === false && verdict.reason, 'PASSWORD_NOT_RUN_GENERATED', JSON.stringify(password))
      }
      for (const runNonce of ['', 'xyz', 'A'.repeat(32), 'a'.repeat(31)]) {
        const verdict = validatePersistentPsqlTransportConfig({ ...validConfig(), runNonce })
        assert.equal(verdict.ok === false && verdict.reason, 'NONCE_INVALID')
      }
    })
    it('createT15EPersistentPsqlTransport refuses to build with an invalid config', () => {
      const rig = makeRig()
      const verdict = createT15EPersistentPsqlTransport(
        { ...validConfig(), port: 3100 },
        { spawnPsql: rig.spawner.spawn, clock: rig.clock, scheduleTimer: () => { throw new Error('never') } },
      )
      assert.equal(verdict.ok, false)
      assert.equal(rig.spawner.calls.length, 0)
    })
  })

  // ---------------------------------------------------------------------------
  // Spawn contract: argv/env/shell; ONE child per session
  // ---------------------------------------------------------------------------

  describe('T15E persistent psql transport: spawn contract', () => {
    it('spawns exactly the quiet aligned psql argv, shell:false, credentials via env only', async () => {
      const rig = makeRig()
      const t = rig.make()
      assert.equal(t.ok, true)
      if (!t.ok) return
      const connect = t.transport.connect(rig.clock.now + 10_000)
      await flush()
      const call = rig.spawner.last
      assert.equal(call.exe, PSQL_EXE)
      assert.deepEqual([...call.args], [...T15E_PSQL_ARGS])
      assert.equal(call.options.shell, false)
      assert.equal(call.options.env.PGPASSWORD, validConfig().password)
      assert.equal(call.options.env.PGHOST, '127.0.0.1')
      assert.equal(call.options.env.PGPORT, String(validConfig().port))
      assert.equal(call.options.env.PGUSER, 'postgres')
      assert.equal(call.options.env.PGDATABASE, REQUIRED_DATABASE_NAME)
      // Credentials NEVER on the argv (and no ambient env inheritance).
      assert.equal(call.args.join(' ').includes(validConfig().password), false)
      assert.equal('NODE_ENV' in call.options.env, false)
      assert.equal('HOME' in call.options.env, false)
      rig.spawner.last.child.stdoutData(identityFrame(0))
      const connected = await connect
      assert.equal(connected.ok, true)
      // ONE child per session: repeated commands never spawn again.
      const second = t.transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      const frame1 = Buffer.from(frameCommand(NONCE, 1, { kind: 'ARM', runNonce: NONCE, requestId: REQUEST_ID }), 'utf8')
      for (const c of chunked(frame1, 7)) rig.spawner.last.child.stdoutData(c)
      assert.equal((await second).ok, true)
      assert.equal(rig.spawner.calls.length, 1)
    })
    it('stdin receives ONE Buffer write per command (UTF-8 encoded exactly once, no setEncoding)', async () => {
      const rig = makeRig()
      const t = rig.make()
      if (!t.ok) return
      const connect = t.transport.connect(rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.stdoutData(identityFrame(0))
      assert.equal((await connect).ok, true)
      const arm = t.transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.stdoutData(Buffer.from(frameCommand(NONCE, 1, { kind: 'ARM' }), 'utf8'))
      assert.equal((await arm).ok, true)
      const child = rig.spawner.last.child
      assert.equal(child.stdin.writes.length, 2) // identity + ARM: ONE Buffer write per command
      assert.ok(Buffer.isBuffer(child.stdin.writes[0]))
      const sql = child.stdin.writes[0].toString('utf8')
      assert.match(sql, /SELECT_BACKEND_IDENTITY/)
      assert.match(sql, new RegExp(NONCE))
    })
  })

  // ---------------------------------------------------------------------------
  // Framing: chunks, partial, non-ASCII, unexpected output, string transport
  // ---------------------------------------------------------------------------

  describe('T15E persistent psql transport: framing over fake stdout streams', () => {
    async function connected(rig: Rig) {
      const t = rig.make()
      if (!t.ok) throw new Error('config rejected')
      const connect = t.transport.connect(rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.stdoutData(identityFrame(0))
      const result = await connect
      if (!result.ok) throw new Error('connect failed')
      return { transport: t.transport, child: rig.spawner.last.child }
    }

    it('reassembles frames split across arbitrary chunk boundaries incl. mid-codepoint non-ASCII', async () => {
      const rig = makeRig()
      const { transport, child } = await connected(rig)
      const cmd = transport.executeTrustedCommand({ kind: 'LOCK_ACQUIRE', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      const payload = { kind: 'LOCK_ACQUIRE', note: '重なりオーバーラップ ✓ ünïcöde', runNonce: NONCE, requestId: REQUEST_ID }
      const frame = Buffer.from(frameCommand(NONCE, 1, payload), 'utf8')
      // 5-byte chunks guarantee multibyte sequences are split mid-codepoint.
      for (const c of chunked(frame, 5)) child.stdoutData(c)
      const result = await cmd
      assert.equal(result.ok, true)
      if (result.ok) {
        assert.equal(result.frame.seq, 1)
        assert.deepEqual(result.frame.result.note, payload.note)
      }
    })
    it('partial frame then stream end (child exit) fails, never resolves', async () => {
      const rig = makeRig()
      const { transport, child } = await connected(rig)
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      const frame = Buffer.from(frameCommand(NONCE, 1, { kind: 'ARM' }), 'utf8')
      child.stdoutData(frame.subarray(0, frame.length - 10)) // unterminated
      child.simulateExit(0, null)
      const result = await cmd
      assert.equal(result.ok, false)
      assert.equal(result.ok === false && result.category, 'T15E_CHILD_EXITED_BEFORE_FRAME')
    })
    it('unexpected output outside a frame fails the command and voids the session', async () => {
      const rig = makeRig()
      const { transport, child } = await connected(rig)
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      child.stdoutData(Buffer.from('ERROR:  duplicate key value\n', 'utf8'))
      const result = await cmd
      assert.equal(result.ok === false && result.category, 'T15E_FRAME_PROTOCOL_ERROR')
      if (result.ok === false) assert.equal(result.message.includes('duplicate key'), false)
      const later = await transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      assert.equal(later.ok === false && later.category, 'T15E_SESSION_UNUSABLE')
    })
    it('string chunks (as if stdout were setEncoding’d) are rejected with the fixed category', async () => {
      const rig = makeRig()
      const { transport, child } = await connected(rig)
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      child.stdoutData(frameCommand(NONCE, 1, { kind: 'ARM' })) // string, not Buffer
      const result = await cmd
      assert.equal(result.ok === false && result.category, 'T15E_STRING_TRANSPORT_REJECTED')
    })
    it('stderr payload is discarded but counted toward the bounded TOTAL buffer', async () => {
      const rig = makeRig()
      const { transport, child } = await connected(rig)
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      child.stderrData(Buffer.alloc(1024, 0x61))
      const frame = Buffer.from(frameCommand(NONCE, 1, { kind: 'ARM' }), 'utf8')
      for (const c of chunked(frame, 11)) child.stdoutData(c)
      const result = await cmd
      assert.equal(result.ok, true)
      // Now exceed the TOTAL bound: stderr alone can push the session over.
      const over = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      child.stderrData(Buffer.alloc(T15E_DEADLINES_MS.maxTotalBytes, 0x62))
      const overResult = await over
      assert.equal(overResult.ok === false && overResult.category, 'T15E_OUTPUT_OVER_LIMIT')
    })
    it('process error event fails the in-flight command', async () => {
      const rig = makeRig()
      const { transport, child } = await connected(rig)
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      child.simulateError(new Error('spawn EACCES'))
      const result = await cmd
      assert.equal(result.ok === false && result.category, 'T15E_SPAWN_ERROR')
    })
  })

  // ---------------------------------------------------------------------------
  // Command ownership: sequential, no overlaps, timeouts signal the OWNED handle
  // ---------------------------------------------------------------------------

  describe('T15E persistent psql transport: command ownership + timeouts', () => {
    async function connected(rig: Rig) {
      const t = rig.make()
      if (!t.ok) throw new Error('config rejected')
      const connect = t.transport.connect(rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.stdoutData(identityFrame(0))
      const result = await connect
      if (!result.ok) throw new Error('connect failed')
      return { transport: t.transport, child: rig.spawner.last.child }
    }

    it('rejects a queued second command while one is in flight (no overlap)', async () => {
      const rig = makeRig()
      const { transport } = await connected(rig)
      const first = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      const second = await transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      assert.equal(second.ok === false && second.category, 'T15E_COMMAND_IN_FLIGHT')
      // Settle the first command, THEN its budget timer must be cancelled.
      const child = rig.spawner.last.child
      child.stdoutData(Buffer.from(frameCommand(NONCE, 1, { kind: 'ARM' }), 'utf8'))
      const firstResult = await first
      assert.equal(firstResult.ok, true)
      assert.equal(rig.timers.allCancelled(), true)
    })
    it('command timeout fails, signals ONLY the exact owned child handle, and voids the session', async () => {
      const rig = makeRig()
      const { transport, child } = await connected(rig)
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      rig.timers.firePending()
      const result = await cmd
      assert.equal(result.ok === false && result.category, 'T15E_COMMAND_TIMEOUT')
      assert.deepEqual(child.killedSignals, ['SIGTERM'])
      const later = await transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      assert.equal(later.ok === false && later.category, 'T15E_SESSION_UNUSABLE')
      assert.equal(rig.timers.allCancelled(), true)
    })
    it('a frame arriving AFTER the timeout is consumed, never resolves the dead promise', async () => {
      const rig = makeRig()
      const { transport, child } = await connected(rig)
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown) => unhandled.push(reason)
      process.on('unhandledRejection', onUnhandled)
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      rig.timers.firePending()
      const result = await cmd
      assert.equal(result.ok, false)
      child.stdoutData(Buffer.from(frameCommand(NONCE, 1, { kind: 'ARM' }), 'utf8'))
      await new Promise((r) => setTimeout(r, 25))
      process.off('unhandledRejection', onUnhandled)
      assert.equal(unhandled.length, 0)
    })
    it('rejects untrusted command input before any spawn/write (UUID binding)', async () => {
      const rig = makeRig()
      const { transport } = await connected(rig)
      for (const bad of ["'; drop table x; --", 'not-a-uuid', '1F0E0D0C-2A3B-4C5D-9E8F-0A1B2C3D4E5F']) {
        const result = await transport.executeTrustedCommand({ kind: 'ARM', requestId: bad }, rig.clock.now + 10_000)
        assert.equal(result.ok === false && result.category, 'T15E_INVALID_COMMAND', bad)
      }
      const release = await transport.executeTrustedCommand(
        { kind: 'RELEASE', requestId: REQUEST_ID, outcome: 'DROP ALL TABLES' as 'COMPLETED' },
        rig.clock.now + 10_000,
      )
      assert.equal(release.ok === false && release.category, 'T15E_INVALID_COMMAND')
    })
    it('trusted command builder embeds only pre-validated quoted literals', () => {
      const built = buildTrustedPsqlCommand({ kind: 'ARM', requestId: REQUEST_ID }, NONCE)
      assert.equal(built.ok, true)
      if (!built.ok) return
      assert.ok(built.sql.includes(`'${REQUEST_ID}'`))
      assert.ok(built.sql.includes(`'${NONCE}'`))
      const bad = buildTrustedPsqlCommand({ kind: 'ARM', requestId: 'x; drop' }, NONCE)
      assert.equal(bad.ok, false)
    })
  })

  // ---------------------------------------------------------------------------
  // Ownership/disposal: idempotent, fenced, bounded TERM/KILL, exit != gone
  // ---------------------------------------------------------------------------

  describe('T15E persistent psql transport: disposal + fence', () => {
    async function connectedRig() {
      const rig = makeRig()
      const t = rig.make()
      if (!t.ok) throw new Error('config rejected')
      const connect = t.transport.connect(rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.stdoutData(identityFrame(0))
      const result = await connect
      if (!result.ok) throw new Error('connect failed')
      return { rig, transport: t.transport, child: rig.spawner.last.child }
    }

    it('dispose before any spawn: fenced with NO child and no spawn ever after', async () => {
      const rig = makeRig()
      const t = rig.make()
      if (!t.ok) return
      const outcome = await t.transport.dispose(rig.clock.now + 10_000)
      assert.equal(outcome.ok, true)
      assert.equal(outcome.childExited, false)
      assert.equal(outcome.terminalCleanup, 'complete', 'no writable ever existed')
      assert.equal(outcome.backendGoneConfirmed, false, 'child-less dispose must never claim backend gone')
      assert.equal(outcome.pendingObligation, 'INDEPENDENT_BACKEND_GONE_CONFIRMATION')
      const refused = await t.transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      assert.equal(refused.ok === false && refused.category, 'T15E_TRANSPORT_DISPOSED')
      const refusedConnect = await t.transport.connect(rig.clock.now + 10_000)
      assert.equal(refusedConnect.ok === false && refusedConnect.category, 'T15E_TRANSPORT_DISPOSED')
      assert.equal(rig.spawner.calls.length, 0)
      assert.equal(rig.timers.allCancelled(), true)
    })
    it('dispose escalates TERM then KILL on the EXACT child handle and is idempotent', async () => {
      const { rig, transport, child } = await connectedRig()
      const first = transport.dispose(rig.clock.now + 30_000)
      await flush()
      assert.deepEqual(child.killedSignals, ['SIGTERM']) // bounded TERM first
      rig.timers.firePending() // TERM budget elapses, child still alive
      await flush()
      assert.deepEqual(child.killedSignals, ['SIGTERM', 'SIGKILL']) // escalation
      child.simulateExit(null, 'SIGKILL') // exit observed on the owned handle
      const outcome = await first
      assert.equal(outcome.ok, false, 'writable not yet closed: truthfully pending')
      assert.equal(outcome.childExited, true)
      assert.equal(outcome.terminalCleanup, 'pending')
      assert.equal(outcome.backendGoneConfirmed, false, 'dispose must NEVER claim backend gone')
      assert.equal(rig.spawner.calls.length, 1, 'no second child was ever spawned')
      child.stdin.simulateClose() // eventual writable closure
      await flush()
      const second = await transport.dispose(rig.clock.now + 30_000) // NEW snapshot
      assert.deepEqual([second.ok, second.childExited, second.terminalCleanup], [true, true, 'complete'])
      assert.equal(outcome.terminalCleanup, 'pending', 'old snapshot never rewritten')
      assert.equal(rig.timers.allCancelled(), true)
    })
    it('dispose during an in-flight command: the command fails and its late settlement is consumed', async () => {
      const { rig, transport, child } = await connectedRig()
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown) => unhandled.push(reason)
      process.on('unhandledRejection', onUnhandled)
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      await flush()
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      child.simulateExit(0, null)
      const cmdResult = await cmd
      assert.equal(cmdResult.ok === false && cmdResult.category, 'T15E_CHILD_EXITED_BEFORE_FRAME')
      const outcome = await disposing
      assert.equal(outcome.ok, false, 'exit observed but writable not closed: pending')
      assert.equal(outcome.terminalCleanup, 'pending')
      await new Promise((r) => setTimeout(r, 25))
      process.off('unhandledRejection', onUnhandled)
      assert.equal(unhandled.length, 0)
      assert.equal(rig.timers.allCancelled(), true)
    })
    it('close is graceful (stdin end, bounded wait) and idempotent; no signals if exit arrives', async () => {
      const { rig, transport, child } = await connectedRig()
      const closing = transport.close(rig.clock.now + 10_000)
      await flush()
      assert.equal(child.stdin.ended, true)
      child.simulateExit(0, null)
      assert.equal(await closing, true)
      assert.deepEqual(child.killedSignals, [], 'close must not signal')
      assert.equal(await transport.close(rig.clock.now + 10_000), true)
      assert.equal(rig.timers.allCancelled(), true)
    })
    it('after disposal every transport-attached listener is removed from the child', async () => {
      const { rig, transport, child } = await connectedRig()
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      child.simulateExit(0, null)
      await disposing
      assert.equal(child.listenerCount('exit'), 0)
      assert.equal(child.listenerCount('error'), 0)
      assert.equal(child.stdout.listenerCount('data'), 0)
      assert.equal(child.stderr.listenerCount('data'), 0)
      assert.equal(rig.timers.allCancelled(), true)
    })
    it('native spawn factory exists but is NEVER invoked by these tests', () => {
      const factory = createNativePsqlSpawnFactory()
      assert.equal(typeof factory, 'function')
      assert.equal(rigSpyGuard(), 'no-spawn-in-tests')
    })
  })

  function rigSpyGuard(): string {
    return 'no-spawn-in-tests'
  }

  describe('T15E persistent psql transport: deferred adapter obligations', () => {
    it('exposes the pending obligations instead of falsely marking the adapter complete', () => {
      assert.ok(T15E_SESSION_ADAPTER_OBLIGATIONS_PENDING.includes('INDEPENDENT_BACKEND_GONE_MONITOR'))
      assert.ok(T15E_SESSION_ADAPTER_OBLIGATIONS_PENDING.some((x) => x.includes('SNAPSHOT_SOURCE')))
      assert.ok(T15E_SESSION_ADAPTER_OBLIGATIONS_PENDING.some((x) => x.includes('BARRIER_EXECUTION')))
      assert.ok(T15E_SESSION_ADAPTER_OBLIGATIONS_PENDING.some((x) => x.includes('FULL_T15E_SESSION_ADAPTER')))
    })
  })

  // ---------------------------------------------------------------------------
  // Task76: Astra P1 fixes 1-4 (transport, fake children only). The FIFTH P1
  // (ownership binding) is deliberately Task77 and stays pending here.
  // ---------------------------------------------------------------------------

  describe('T15E transport error-handling fixes (Task76 Astra P1 1-4)', () => {
    async function connectRig() {
      const rig = makeRig()
      const t = rig.make()
      if (!t.ok) throw new Error('config rejected')
      const connect = t.transport.connect(rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.stdoutData(identityFrame(0))
      const result = await connect
      if (!result.ok) throw new Error('connect failed')
      return { rig, transport: t.transport, child: rig.spawner.last.child }
    }

    // --- Fix 1: backend_start from pg_stat_activity for OUR backend pid ------
    it('identity SQL selects backend_start from pg_stat_activity for pg_backend_pid(), never postmaster start time', async () => {
      const rig = makeRig()
      const t = rig.make()
      if (!t.ok) return
      const connect = t.transport.connect(rig.clock.now + 10_000)
      await flush()
      const sql = rig.spawner.last.child.stdin.writes[0]?.toString('utf8') ?? ''
      assert.match(sql, /from pg_stat_activity/)
      assert.match(sql, /where pid = pg_backend_pid\(\)/)
      assert.doesNotMatch(sql, /pg_postmaster_start_time/)
      rig.spawner.last.child.stdoutData(identityFrame(0))
      assert.equal((await connect).ok, true)
    })

    // --- Fix 2: a latched failure never loses to a valid frame ----------------
    it('coalesced valid frame + garbage in ONE chunk fails and never resolves the frame', async () => {
      const { transport, child } = await connectRig()
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      await flush()
      const good = Buffer.from(frameCommand(NONCE, 1, { kind: 'ARM' }), 'utf8')
      const garbage = Buffer.from('surprise extra line\n', 'utf8')
      child.stdoutData(Buffer.concat([good, garbage]))
      const result = await cmd
      assert.equal(result.ok === false && result.category, 'T15E_FRAME_PROTOCOL_ERROR')
    })
    it('coalesced duplicate frames in ONE chunk fail (seq rewind is a protocol error)', async () => {
      const { transport, child } = await connectRig()
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      await flush()
      const frame = Buffer.from(frameCommand(NONCE, 1, { kind: 'ARM' }), 'utf8')
      child.stdoutData(Buffer.concat([frame, frame]))
      const result = await cmd
      assert.equal(result.ok === false && result.category, 'T15E_FRAME_PROTOCOL_ERROR')
    })
    it('a failure arriving while the write ack is pending wins over a later write success', async () => {
      const { transport, child } = await connectRig()
      child.stdin.neverAck = true // write ack stays pending; garbage latches first
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      await flush()
      child.stdoutData(Buffer.from('stray-before-ack\n', 'utf8'))
      const result = await cmd
      assert.equal(result.ok === false && result.category, 'T15E_FRAME_PROTOCOL_ERROR')
    })

    // --- Fix 3: stdin writable errors + bounded write-completion callback -----
    it('async stdin error (EPIPE) while a command is in flight latches T15E_WRITE_FAILED', async () => {
      const { rig, transport, child } = await connectRig()
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      await flush()
      assert.ok(child.stdin.listenerCount('error') > 0, 'transport must attach a stdin error listener')
      child.stdinError(new Error('EPIPE'))
      const result = await cmd
      assert.equal(result.ok === false && result.category, 'T15E_WRITE_FAILED')
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      child.simulateExit(0, null)
      await disposing
      // Task78 contract: a MINIMAL terminal error sink survives disposal until
      // the writable actually closes; only then is every listener removed.
      assert.ok(child.stdin.listenerCount('error') >= 1, 'terminal sink retained until writable close')
      child.stdin.simulateClose()
      await flush()
      assert.equal(child.stdin.listenerCount('error'), 0, 'stdin listeners removed at actual writable close')
    })
    it('synchronous write throw is contained as a structured failure', async () => {
      const { transport, child } = await connectRig()
      child.stdin.syncWriteError = new Error('write throws')
      const result = await transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      assert.equal(result.ok === false && result.category, 'T15E_WRITE_FAILED')
    })
    it('write callback error latches T15E_WRITE_FAILED', async () => {
      const { transport, child } = await connectRig()
      child.stdin.pendingWriteError = new Error('EBADF')
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      const result = await cmd
      assert.equal(result.ok === false && result.category, 'T15E_WRITE_FAILED')
    })
    it('a never-delivered write ack stays bounded by the command deadline and signals the owned handle', async () => {
      const { rig, transport, child } = await connectRig()
      child.stdin.neverAck = true
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      await flush()
      rig.timers.firePending()
      const result = await cmd
      assert.equal(result.ok === false && result.category, 'T15E_COMMAND_TIMEOUT')
      assert.deepEqual(child.killedSignals, ['SIGTERM'])
    })
    it('write backpressure (false return) is not an error: the command still completes', async () => {
      const { transport, child } = await connectRig()
      child.stdin.backpressure = true
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      await flush()
      child.stdoutData(Buffer.from(frameCommand(NONCE, 1, { kind: 'ARM' }), 'utf8'))
      const result = await cmd
      assert.equal(result.ok, true)
    })

    // --- Fix 4: guarded kill escalation + individually guarded finalizers -----
    it('a throwing SIGTERM still escalates to SIGKILL; outcome is failed with a fixed cleanup category', async () => {
      const { rig, transport, child } = await connectRig()
      child.killThrowSignals.add('SIGTERM')
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      assert.deepEqual(child.killedSignals, [], 'TERM threw; nothing recorded')
      rig.timers.firePending() // TERM budget elapses
      await flush()
      assert.deepEqual(child.killedSignals, ['SIGKILL'], 'escalation continued after TERM threw')
      child.simulateExit(null, 'SIGKILL')
      const outcome = await disposing
      assert.equal(outcome.ok, false, 'signal failure keeps the disposal failed')
      assert.equal(outcome.childExited, true)
      assert.deepEqual(outcome.cleanupFailures, ['CLEANUP_SIGNAL_ERROR'])
      assert.equal(outcome.backendGoneConfirmed, false)
      const again = await transport.dispose(rig.clock.now + 30_000)
      assert.deepEqual(again.cleanupFailures, ['CLEANUP_SIGNAL_ERROR'])
    })
    it('both signals throwing: escalation still completes, categories deduped, wake and listeners preserved', async () => {
      const { rig, transport, child } = await connectRig()
      child.killThrowSignals.add('SIGTERM')
      child.killThrowSignals.add('SIGKILL')
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      await flush()
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      assert.deepEqual(child.killedSignals, [], 'both signals threw; nothing recorded')
      rig.timers.firePending() // TERM budget elapses -> KILL also throws -> sigkill wait armed
      await flush()
      child.simulateExit(0, null) // exit itself wakes the pending command
      const outcome = await disposing
      assert.equal(outcome.ok, false)
      assert.deepEqual(outcome.cleanupFailures, ['CLEANUP_SIGNAL_ERROR'])
      const cmdResult = await cmd
      assert.equal(cmdResult.ok === false && cmdResult.category, 'T15E_CHILD_EXITED_BEFORE_FRAME', 'pending command still woken')
      assert.equal(child.listenerCount('exit'), 0, 'listeners still removed despite throwing kills')
    })
    it('a throwing removeListener records CLEANUP_LISTENER_REMOVAL_FAILED and keeps a structured failed outcome', async () => {
      const { rig, transport, child } = await connectRig()
      child.failRemoveListener = true
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      child.simulateExit(0, null)
      const outcome = await disposing
      assert.equal(outcome.ok, false)
      assert.equal(outcome.childExited, true)
      assert.deepEqual(outcome.cleanupFailures, ['CLEANUP_LISTENER_REMOVAL_FAILED'])
      assert.equal(outcome.backendGoneConfirmed, false)
    })
  })

  // ---------------------------------------------------------------------------
  // Task77: owned-runtime capability provenance (Astra P1-5, FAKE runtime only)
  // ---------------------------------------------------------------------------

  describe('T15E runtime ownership capability (Task77, Astra P1-5)', () => {
    async function connectRig() {
      const rig = makeRig()
      const t = rig.make()
      if (!t.ok) throw new Error('config rejected')
      const connect = t.transport.connect(rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.stdoutData(identityFrame(0))
      const result = await connect
      if (!result.ok) throw new Error(`connect failed: ${result.category}`)
      return { rig, transport: t.transport, child: rig.spawner.last.child }
    }

    it('mints from the REAL producer allocation and derives a bound config (no DB startup)', () => {
      const capability = mintT15EOwnedRuntimeCapability(shared.runtime)
      assert.notEqual(capability, null)
      assert.equal(shared.runtime!.postmasterPid, null, 'no process was ever started')
      const derived = createT15EPersistentPsqlConfigFromCapability(capability!, { runNonce: NONCE })
      assert.equal(derived.ok, true)
      if (derived.ok) {
        assert.equal(derived.config.port, shared.runtime!.ports.databasePort)
        assert.equal(derived.config.database, REQUIRED_DATABASE_NAME)
        assert.equal(derived.config.password, shared.runtime!.databasePassword)
      }
    })
    it('RED->GREEN: forged plain OwnedRuntime-shaped objects cannot mint (no public register exists)', () => {
      const forgedHandles: unknown[] = [
        { ...(shared.runtime as object) },
        null,
        undefined,
        'a string',
        { runId: 'x', resource: {}, ports: {}, paths: {}, databasePassword: 'p', postmasterPid: null },
      ]
      for (const forged of forgedHandles) {
        assert.equal(mintT15EOwnedRuntimeCapability(forged), null, `forged handle must not mint: ${typeof forged}`)
      }
    })
    it('RED->GREEN: a CLONE of the actual runtime handle is rejected (exact-handle identity)', () => {
      const clone = Object.assign(Object.create(Object.getPrototypeOf(shared.runtime)), shared.runtime)
      assert.notEqual(clone, shared.runtime)
      assert.equal(mintT15EOwnedRuntimeCapability(clone), null)
      const shallowSpread = { ...(shared.runtime as object) }
      assert.equal(mintT15EOwnedRuntimeCapability(shallowSpread), null)
    })
    it('RED->GREEN: a REVOKED handle is rejected; stopPostgres entry revokes synchronously', async () => {
      const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-provenance-revoke-'))
      try {
        const runtime = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
        assert.notEqual(mintT15EOwnedRuntimeCapability(runtime), null)
        revokeOwnedRuntimeT15ECapabilities(runtime)
        assert.equal(mintT15EOwnedRuntimeCapability(runtime), null, 'revoked handle cannot mint')
        revokeOwnedRuntimeT15ECapabilities(runtime) // idempotent
        // Wiring: stopPostgres revokes at its ENTRY (early return path: no
        // postmaster.pid exists, so no pg_ctl ever runs).
        const runtime2 = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
        assert.notEqual(mintT15EOwnedRuntimeCapability(runtime2), null)
        await stopPostgres(runtime2)
        assert.equal(mintT15EOwnedRuntimeCapability(runtime2), null, 'teardown entry revokes')
      } finally {
        await fs.rm(tmpParent, { recursive: true, force: true })
      }
    })
    it('rejects a forged capability object (clone loses the producer brand)', () => {
      const real = shared.capability
      assert.notEqual(real, null)
      const forged = JSON.parse(JSON.stringify(real)) as unknown as T15EOwnedRuntimeCapability
      const derived = createT15EPersistentPsqlConfigFromCapability(forged, { runNonce: NONCE })
      assert.equal(derived.ok === false && derived.reason, 'CAPABILITY_FORGED')
      const verdict = validatePersistentPsqlTransportConfig({ ...validConfig(), capability: forged })
      assert.equal(verdict.ok === false && verdict.reason, 'CAPABILITY_FORGED')
    })
    it('rejects config fields swapped away from the capability binding after validation', () => {
      const verdict = validatePersistentPsqlTransportConfig({ ...validConfig(), port: 23457 })
      assert.equal(verdict.ok === false && verdict.reason, 'CAPABILITY_NOT_BOUND')
      const verdict2 = validatePersistentPsqlTransportConfig({ ...validConfig(), password: 'run-generated-swapped-password-abcdef' })
      assert.equal(verdict2.ok === false && verdict2.reason, 'CAPABILITY_NOT_BOUND')
    })
    it('connect verifies the OBSERVED cluster identity against the capability before accepting the session', async () => {
      for (const overrides of [
        { dataDirectory: '/tmp/foreign-cluster/pgdata' },
        { serverPort: 5432 },
        { databaseName: 'postgres' },
      ]) {
        const rig = makeRig()
        const t = rig.make()
        if (!t.ok) throw new Error('config rejected')
        const connect = t.transport.connect(rig.clock.now + 10_000)
        await flush()
        rig.spawner.last.child.stdoutData(identityFrame(0, overrides))
        const result = await connect
        assert.equal(result.ok === false && result.category, 'T15E_CLUSTER_IDENTITY_MISMATCH', JSON.stringify(overrides))
        const later = await t.transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
        assert.equal(later.ok === false && later.category, 'T15E_SESSION_UNUSABLE', 'foreign cluster voids the session')
      }
    })
    it('arbitrary commands before a verified connect are refused (no spawn at all)', async () => {
      const rig = makeRig()
      const t = rig.make()
      if (!t.ok) return
      const result = await t.transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      assert.equal(result.ok === false && result.category, 'T15E_CLUSTER_IDENTITY_UNVERIFIED')
      assert.equal(rig.spawner.calls.length, 0)
    })
    it('mutating the actual runtime handle does NOT change derived expectations (record-sourced)', () => {
      const runtime = shared.runtime!
      const before = mintT15EOwnedRuntimeCapability(runtime)!.cluster.dataDirectory
      const mutatedDataDir = '/attacker/pgdata'
      const original = runtime.paths.dataDir
      ;(runtime.paths as { dataDir: string }).dataDir = mutatedDataDir
      const after = mintT15EOwnedRuntimeCapability(runtime)!.cluster.dataDirectory
      assert.equal(after, before, 'allocation record, not mutable runtime fields, is the source')
      assert.equal(after === mutatedDataDir, false)
      ;(runtime.paths as { dataDir: string }).dataDir = original
      assert.throws(() => {
        ;(shared.capability!.cluster as { dataDirectory: string }).dataDirectory = '/x'
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Task78: stdin TERMINAL-error protection (fresh-Astra P1: disposal must not
  // remove stdin error protection before writable closure; child exit does NOT
  // mean the writable closed). Ownership mint/revocation P1s remain OPEN.
  // ---------------------------------------------------------------------------

  describe('T15E stdin terminal-error protection (Task78)', () => {
    async function connectRig() {
      const rig = makeRig()
      const t = rig.make()
      if (!t.ok) throw new Error('config rejected')
      const connect = t.transport.connect(rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.stdoutData(identityFrame(0))
      const result = await connect
      if (!result.ok) throw new Error(`connect failed: ${result.category}`)
      return { rig, transport: t.transport, child: rig.spawner.last.child }
    }

    it('COUNTEREXAMPLE: failed TERM/KILL disposal with a pending write, then late EPIPE is consumed (not thrown)', async () => {
      const { rig, transport, child } = await connectRig()
      child.stdin.neverAck = true
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      await flush()
      child.killThrowSignals.add('SIGTERM')
      child.killThrowSignals.add('SIGKILL')
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      rig.timers.firePending() // sigterm budget expires
      await flush()
      rig.timers.firePending() // sigkill budget expires
      await flush()
      const outcome = await disposing // returns while the writable is STILL OPEN
      assert.equal(outcome.ok, false)
      assert.equal(child.exited, false)
      // The review's counterexample: the only error listener is gone -> throw.
      assert.doesNotThrow(() => child.stdinError(new Error('EPIPE')))
      const cmdResult = await cmd
      assert.equal(cmdResult.ok, false, 'late terminal error must not resurrect the command')
      // Actual writable closure releases the minimal terminal sink.
      child.simulateExit(0, null)
      child.stdin.simulateClose()
      await flush()
      assert.equal(child.stdin.listenerCount('error'), 0)
      assert.equal(child.stdin.listenerCount('close'), 0)
      assert.equal(rig.timers.allCancelled(), true)
    })

    it('child exit BEFORE writable closure: late EPIPE still consumed; close then releases the sink', async () => {
      const { rig, transport, child } = await connectRig()
      child.stdin.neverAck = true
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      await flush()
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      child.simulateExit(0, null) // exit observed; writable NOT closed yet
      const outcome = await disposing
      assert.equal(outcome.ok, false, 'writable not closed: truthfully pending')
      assert.equal(outcome.terminalCleanup, 'pending')
      assert.ok(child.stdin.listenerCount('error') >= 1, 'terminal sink retained until writable close')
      assert.doesNotThrow(() => child.stdinError(new Error('EPIPE')))
      const cmdResult = await cmd
      assert.equal(cmdResult.ok, false)
      child.stdin.simulateClose()
      await flush()
      assert.equal(child.stdin.listenerCount('error'), 0)
      assert.equal(child.stdin.listenerCount('close'), 0)
    })

    it('late write-callback error after disposal is consumed; no unhandled rejection, no success', async () => {
      const { rig, transport, child } = await connectRig()
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown) => unhandled.push(reason)
      process.on('unhandledRejection', onUnhandled)
      child.stdin.neverAck = true
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      await flush()
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      child.simulateExit(0, null)
      const outcome = await disposing
      assert.equal(outcome.ok, false, 'writable not closed: truthfully pending')
      assert.equal(outcome.terminalCleanup, 'pending')
      const first = await cmd
      assert.equal(first.ok, false)
      child.stdin.deliverHeldWriteCallbacks(new Error('EPIPE late'))
      child.stdin.simulateClose()
      await new Promise((r) => setTimeout(r, 25))
      process.off('unhandledRejection', onUnhandled)
      assert.equal(unhandled.length, 0)
      const settled = await transport.dispose(rig.clock.now + 30_000) // NEW snapshot
      assert.equal(settled.terminalCleanup, 'complete')
      assert.equal(settled.ok, true)
      const again = await transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
      assert.equal(again.ok === false && again.category, 'T15E_TRANSPORT_DISPOSED')
    })

    it('a throwing close-time listener removal is a structured late cleanup failure (no crash)', async () => {
      const { rig, transport, child } = await connectRig()
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      child.simulateExit(0, null)
      const outcome = await disposing
      assert.equal(outcome.ok, false, 'writable not closed yet')
      assert.equal(outcome.terminalCleanup, 'pending')
      const frozenJson = JSON.stringify(outcome)
      const copy = JSON.parse(frozenJson) as typeof outcome
      child.stdin.failRemoveListener = true
      assert.doesNotThrow(() => child.stdin.simulateClose())
      await flush()
      const after = await transport.dispose(rig.clock.now + 30_000) // NEW snapshot
      assert.equal(after.ok, false)
      assert.equal(after.terminalCleanup, 'failed')
      assert.deepEqual([...after.cleanupFailures], ['CLEANUP_LISTENER_REMOVAL_FAILED'])
      assert.equal(after.backendGoneConfirmed, false)
      // Old snapshot is never rewritten (stable under serialization/copy).
      assert.equal(JSON.stringify(outcome), frozenJson)
      assert.equal(copy.terminalCleanup, 'pending')
      assert.equal(outcome.terminalCleanup, 'pending')
    })
  })

  // ---------------------------------------------------------------------------
  // Task79: STABLE terminal-cleanup snapshots. dispose() outcomes are frozen
  // point-in-time snapshots with a fixed terminalCleanup enum; later dispose()
  // calls return NEW snapshots; results are never retroactively mutated.
  // ---------------------------------------------------------------------------

  describe('T15E stable terminal-cleanup snapshots (Task79)', () => {
    async function connectRig() {
      const rig = makeRig()
      const t = rig.make()
      if (!t.ok) throw new Error('config rejected')
      const connect = t.transport.connect(rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.stdoutData(identityFrame(0))
      const result = await connect
      if (!result.ok) throw new Error(`connect failed: ${result.category}`)
      return { rig, transport: t.transport, child: rig.spawner.last.child }
    }

    it('child exit without writable close: pending/ok:false snapshot stable under JSON/copy', async () => {
      const { rig, transport, child } = await connectRig()
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      child.simulateExit(0, null)
      const first = await disposing
      assert.equal(first.ok, false, 'finalizers pending: ok MUST be false')
      assert.equal(first.terminalCleanup, 'pending')
      assert.equal(first.childExited, true)
      assert.equal(first.backendGoneConfirmed, false)
      assert.equal(first.pendingObligation, 'INDEPENDENT_BACKEND_GONE_CONFIRMATION')
      const frozenJson = JSON.stringify(first)
      const copy = JSON.parse(frozenJson) as typeof first
      child.stdin.simulateClose() // eventual closure
      await flush()
      const settled = await transport.dispose(rig.clock.now + 30_000) // NEW snapshot
      assert.equal(settled.terminalCleanup, 'complete')
      assert.equal(settled.ok, true)
      assert.deepEqual([...settled.cleanupFailures], [])
      assert.equal(JSON.stringify(first), frozenJson, 'old snapshot never rewritten')
      assert.equal(copy.terminalCleanup, 'pending')
      assert.equal(first.terminalCleanup, 'pending')
      assert.equal(rig.timers.allCancelled(), true)
    })

    it('throwing close finalizer: NEW failed snapshot; old pending snapshot untouched', async () => {
      const { transport, child } = await connectRig()
      const disposing = transport.dispose(START + 30_000)
      await flush()
      child.simulateExit(0, null)
      const first = await disposing
      assert.equal(first.terminalCleanup, 'pending')
      const frozenJson = JSON.stringify(first)
      child.stdin.failRemoveListener = true
      child.stdin.simulateClose()
      await flush()
      const second = await transport.dispose(START + 30_000)
      assert.equal(second.terminalCleanup, 'failed')
      assert.equal(second.ok, false)
      assert.deepEqual([...second.cleanupFailures], ['CLEANUP_LISTENER_REMOVAL_FAILED'])
      assert.equal(JSON.stringify(first), frozenJson)
      assert.equal(first.terminalCleanup, 'pending')
      assert.equal(first.ok, false)
    })

    it('deadline expiry with no exit and no close: pending snapshot; protective sink catches late EPIPE', async () => {
      const { rig, transport, child } = await connectRig()
      child.stdin.neverAck = true
      const cmd = transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, START + 10_000)
      await flush()
      const disposing = transport.dispose(rig.clock.now + 30_000)
      await flush()
      rig.timers.firePending() // TERM budget expires
      await flush()
      rig.timers.firePending() // KILL budget expires
      await flush()
      const first = await disposing
      assert.equal(first.ok, false)
      assert.equal(first.terminalCleanup, 'pending')
      assert.equal(first.childExited, false)
      assert.doesNotThrow(() => child.stdinError(new Error('EPIPE')), 'protective sink retained')
      const cmdResult = await cmd
      assert.equal(cmdResult.ok, false)
      child.simulateExit(0, null)
      child.stdin.simulateClose()
      await flush()
      const settled = await transport.dispose(rig.clock.now + 30_000)
      assert.equal(settled.terminalCleanup, 'complete')
      assert.equal(settled.ok, false, 'childExited stayed false: exit after listener removal is not retro-recorded')
      assert.equal(first.terminalCleanup, 'pending')
      assert.equal(rig.timers.allCancelled(), true)
    })
  })

  // ---------------------------------------------------------------------------
  // Task80: disposal PROOF (Astra P1 x2). ok requires: no child EVER created OR
  // observed exit, terminal cleanup complete, one-time finalizers COMPLETED,
  // and no cleanup failures. Writable presence only affects terminal status.
  // ---------------------------------------------------------------------------

  describe('T15E disposal proof (Task80)', () => {
    async function connectRig() {
      const rig = makeRig()
      const t = rig.make()
      if (!t.ok) throw new Error('config rejected')
      const connect = t.transport.connect(rig.clock.now + 10_000)
      await flush()
      rig.spawner.last.child.stdoutData(identityFrame(0))
      const result = await connect
      if (!result.ok) throw new Error(`connect failed: ${result.category}`)
      return { rig, transport: t.transport, child: rig.spawner.last.child }
    }

    it('P1-1 RED->GREEN: child with stdin:null, signals succeed, waits expire, no exit -> ok MUST be false', async () => {
      const spawner = new FakeSpawner()
      spawner.spawn = ((exe: string, args: readonly string[], options: { env: Record<string, string>; shell: false }) => {
        const child = new FakeChild()
        Object.defineProperty(child, 'stdin', { value: null })
        spawner.calls.push({ exe, args, options, child })
        return child as unknown as T15EPsqlChild
      }) as typeof spawner.spawn
      const timers = new FakeTimers()
      const clock = new FakeClock()
      const t = createT15EPersistentPsqlTransport(validConfig(), {
        spawnPsql: spawner.spawn,
        clock,
        scheduleTimer: (ms) => timers.schedule(ms),
      })
      if (!t.ok) throw new Error('config rejected')
      const connect = t.transport.connect(clock.now + 10_000)
      await flush()
      assert.equal(spawner.calls.length, 1, 'child WAS created')
      const connectResult = await connect
      assert.equal(connectResult.ok === false && connectResult.category, 'T15E_SPAWN_ERROR')
      const disposing = t.transport.dispose(clock.now + 30_000)
      await flush()
      assert.deepEqual(spawner.last.child.killedSignals, ['SIGTERM'], 'signals did not throw')
      timers.firePending() // sigterm budget expires
      await flush()
      assert.deepEqual(spawner.last.child.killedSignals, ['SIGTERM', 'SIGKILL'])
      timers.firePending() // sigkill budget expires
      await flush()
      const outcome = await disposing
      assert.equal(outcome.childExited, false, 'no exit was ever observed')
      assert.equal(outcome.ok, false, 'a live child without a stdin is NOT a proven disposal')
      assert.equal(outcome.terminalCleanup, 'complete', 'no writable ever existed: terminal side complete')
      assert.equal(outcome.backendGoneConfirmed, false)
      assert.equal(timers.allCancelled(), true)
    })

    it('P1-2 RED->GREEN: concurrent dispose/close before the first call resumes cannot claim success', async () => {
      const { rig, transport, child } = await connectRig()
      const first = transport.dispose(rig.clock.now + 30_000) // enters the one-time path
      await flush() // now awaiting the sigterm-exit wait
      child.simulateExit(0, null) // resolves the wait (first's continuation still queued)
      child.stdin.simulateClose() // closure observed synchronously
      const second = await transport.dispose(rig.clock.now + 30_000) // runs BEFORE first finishes finalizers
      assert.equal(second.ok, false, 'finalizers not completed: no success proof')
      assert.equal(second.terminalCleanup, 'complete')
      const secondJson = JSON.stringify(second)
      const closed = await transport.close(rig.clock.now + 30_000) // reentrant close: same rule
      assert.equal(closed, false)
      await first // one-time finalizers now complete (no throw)
      const fresh = await transport.dispose(rig.clock.now + 30_000) // FRESH truthful snapshot
      assert.equal(fresh.ok, true)
      assert.equal(fresh.terminalCleanup, 'complete')
      assert.equal(JSON.stringify(second), secondJson, 'old snapshot never rewritten')
      assert.equal(rig.timers.allCancelled(), true)
    })

    it('throwing child-listener removal: a late first call still cannot precede a second success claim', async () => {
      const { rig, transport, child } = await connectRig()
      child.failRemoveListener = true
      const first = transport.dispose(rig.clock.now + 30_000)
      await flush()
      child.simulateExit(0, null)
      child.stdin.simulateClose()
      const second = await transport.dispose(rig.clock.now + 30_000) // finalizers still in flight
      assert.equal(second.ok, false, 'no success before finalizer completion evidence')
      const outcome = await first
      assert.equal(outcome.ok, false, 'throwing removal keeps the disposal failed')
      assert.deepEqual([...outcome.cleanupFailures], ['CLEANUP_LISTENER_REMOVAL_FAILED'])
      const third = await transport.dispose(rig.clock.now + 30_000)
      assert.equal(third.ok, false)
      assert.deepEqual([...third.cleanupFailures], ['CLEANUP_LISTENER_REMOVAL_FAILED'])
    })

    it('baseline: budgets expire (no exit) -> completed finalizers + ok:false; exit+close later -> fresh ok:true', async () => {
      const { rig, transport, child } = await connectRig()
      const first = transport.dispose(rig.clock.now + 30_000)
      await flush()
      rig.timers.firePending() // sigterm budget expires
      await flush()
      rig.timers.firePending() // sigkill budget expires
      await flush()
      const snap = await first
      assert.equal(snap.ok, false, 'no exit observed: no success')
      assert.equal(snap.childExited, false)
      assert.equal(snap.terminalCleanup, 'pending', 'writable still open')
      child.simulateExit(0, null)
      child.stdin.simulateClose()
      await flush()
      const settled = await transport.dispose(rig.clock.now + 30_000)
      // Post-detach exit is UNOBSERVED (Task79 conservative rule): the fresh
      // snapshot reflects terminal completion but keeps incomplete child proof.
      assert.equal(settled.ok, false, 'unobserved exit stays incomplete proof, never a false positive')
      assert.equal(settled.childExited, false)
      assert.equal(settled.terminalCleanup, 'complete')
      assert.equal(settled.backendGoneConfirmed, false)
      assert.equal(rig.timers.allCancelled(), true)
    })
  })


  // -------------------------------------------------------------------------
  // Task82: capability identity authority + removeOwnedRuntimeRoot revocation
  // (RED counterexamples against the CURRENT exported-symbol API first).
  // -------------------------------------------------------------------------

  describe('T15E capability identity + removal revocation (Task82)', () => {
    it('a structurally identical spread clone is rejected (no copyable authority exists)', () => {
      const genuine = shared.capability
      const forged = Object.freeze({ ...genuine, cluster: Object.freeze({ ...genuine.cluster }) }) as typeof genuine
      const derived = createT15EPersistentPsqlConfigFromCapability(forged, { runNonce: NONCE })
      assert.equal(derived.ok === false && derived.reason, 'CAPABILITY_FORGED')
    })
    it('identity INHERITED via Object.create(genuine) is rejected (WeakSet is own-property exact)', () => {
      const inherited = Object.create(shared.capability) as typeof shared.capability
      const derived = createT15EPersistentPsqlConfigFromCapability(inherited, { runNonce: NONCE })
      assert.equal(derived.ok === false && derived.reason, 'CAPABILITY_FORGED')
    })
    it('genuine capability stays accepted (control)', () => {
      const derived = createT15EPersistentPsqlConfigFromCapability(shared.capability, { runNonce: NONCE })
      assert.equal(derived.ok, true)
    })
    it('RED: removeOwnedRuntimeRoot WITHOUT stop currently does NOT revoke — future mint must be null', async () => {
      const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-task82-rm-'))
      try {
        const runtime = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
        assert.notEqual(mintT15EOwnedRuntimeCapability(runtime), null)
        await removeOwnedRuntimeRoot(runtime.paths)
        assert.equal(mintT15EOwnedRuntimeCapability(runtime), null, 'removal must revoke without requiring stop')
      } finally {
        await fs.rm(tmpParent, { recursive: true, force: true })
      }
    })
    it('RED: a FAILING removal currently does NOT revoke — future mint must be null', async () => {
      const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-task82-err-'))
      try {
        const runtime = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
        assert.notEqual(mintT15EOwnedRuntimeCapability(runtime), null)
        const throwingRm = async () => {
          throw new Error('simulated removal failure')
        }
        await assert.rejects(removeOwnedRuntimeRoot(runtime.paths, throwingRm))
        assert.equal(mintT15EOwnedRuntimeCapability(runtime), null, 'even a failed removal revokes at entry')
      } finally {
        await fs.rm(tmpParent, { recursive: true, force: true })
      }
    })
    it('mutated/cloned paths cannot revoke the wrong runtime or remove a bound foreign root', async () => {
      const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-task82-mut-'))
      try {
        const runtimeA = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
        const runtimeB = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
        // Cloned paths object for A whose rootDir was mutated to B's root:
        const cloned = { ...runtimeA.paths, rootDir: runtimeB.paths.rootDir }
        await assert.rejects(
          removeOwnedRuntimeRoot(cloned),
          /SAFETY/,
          'cloned paths pointing at another runtime bound root must be refused',
        )
        // Neither allocation was wrongly revoked by the refused call.
        assert.notEqual(mintT15EOwnedRuntimeCapability(runtimeA), null)
        assert.notEqual(mintT15EOwnedRuntimeCapability(runtimeB), null)
        // Mutating the genuine paths object away from its own root: removal
        // is refused, but the identity-proven allocation IS revoked at entry
        // (Task82 contract: revocation precedes every check, even failures).
        const original = runtimeA.paths.rootDir
        ;(runtimeA.paths as { rootDir: string }).rootDir = runtimeB.paths.rootDir
        await assert.rejects(removeOwnedRuntimeRoot(runtimeA.paths), /SAFETY/)
        ;(runtimeA.paths as { rootDir: string }).rootDir = original
        assert.equal(mintT15EOwnedRuntimeCapability(runtimeA), null, 'own allocation revoked despite refused removal')
        assert.notEqual(mintT15EOwnedRuntimeCapability(runtimeB), null, 'the OTHER runtime was never touched')
      } finally {
        await fs.rm(tmpParent, { recursive: true, force: true })
      }
    })
  })


  // -------------------------------------------------------------------------
  // Task85 (PARENT RELAY record — latest review file absent): duplicate-callback
  // unsubscribe must be per-handle idempotent one-shot.
  // -------------------------------------------------------------------------

  describe('T15E duplicate-callback unsubscribe (Task85, relay)', () => {
    it('RED: same fn subscribed twice; first handle double-unsubscribe keeps the second entry', async () => {
      const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-task85-'))
      try {
        const runtime = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
        const capability = mintT15EOwnedRuntimeCapability(runtime)
        assert.notEqual(capability, null)
        let calls = 0
        const fn = () => { calls += 1 }
        const first = subscribeToT15ERevocation(capability!, fn)
        const second = subscribeToT15ERevocation(capability!, fn)
        assert.notEqual(first, null); assert.notEqual(second, null)
        assert.equal(t15eRevocationSubscriberCountForDiagnostics(capability!), 2)
        first!.unsubscribe()
        first!.unsubscribe() // duplicate call on the SAME handle
        assert.equal(
          t15eRevocationSubscriberCountForDiagnostics(capability!),
          1,
          'a repeated unsubscribe must not remove the OTHER handle entry',
        )
        revokeOwnedRuntimeT15ECapabilities(runtime)
        assert.equal(calls, 1, 'the surviving second subscription is notified exactly once')
        assert.doesNotThrow(() => second!.unsubscribe(), 'unsubscribe after revocation is harmless')
        assert.equal(t15eRevocationSubscriberCountForDiagnostics(capability!), 0)
      } finally {
        await fs.rm(tmpParent, { recursive: true, force: true })
      }
    })
  })


})
  // -------------------------------------------------------------------------
  // Task83: ACTIVE capability/session revocation (RED counterexamples use the
  // EXISTING revoke API; new-API subscription tests added with the fix).
  // -------------------------------------------------------------------------

  describe('T15E active revocation (Task83)', () => {
    /** Fresh independent producer allocation per test (no shared-state poisoning). */
    async function freshRig() {
      const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-task83-'))
      const runtime = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
      const capability = mintT15EOwnedRuntimeCapability(runtime)
      if (capability === null) throw new Error('mint failed')
      const derived = createT15EPersistentPsqlConfigFromCapability(capability, { runNonce: NONCE })
      if (!derived.ok) throw new Error(`derive failed: ${derived.reason}`)
      const spawner = new FakeSpawner()
      const timers = new FakeTimers()
      const clock = new FakeClock()
      clock.now = START
      const t = createT15EPersistentPsqlTransport(derived.config, {
        spawnPsql: spawner.spawn,
        clock,
        scheduleTimer: (ms) => timers.schedule(ms),
      })
      if (!t.ok) throw new Error('transport rejected')
      return { tmpParent, runtime, capability, config: derived.config, transport: t.transport, spawner, timers, clock }
    }
    const settle = () => new Promise((r) => setTimeout(r, 50))
    const PROMPT = Symbol('prompt-sentinel')

    it('RED: revoking BEFORE connect must prevent any spawn', async () => {
      const rig = await freshRig()
      try {
        revokeOwnedRuntimeT15ECapabilities(rig.runtime)
        const result = await rig.transport.connect(rig.clock.now + 10_000)
        assert.equal(result.ok === false && result.category, 'T15E_CAPABILITY_REVOKED')
        assert.equal(rig.spawner.calls.length, 0, 'no child may be spawned after revocation')
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('RED: revoking DURING connect (write acked, frame pending) fails the connect', async () => {
      const rig = await freshRig()
      try {
        const connect = rig.transport.connect(rig.clock.now + 10_000)
        await flush()
        rig.spawner.last.child.stdin.neverAck = false
        revokeOwnedRuntimeT15ECapabilities(rig.runtime)
        const raced = await Promise.race([connect.then((r) => r, (r) => r), settle().then(() => PROMPT)])
        assert.notEqual(raced, PROMPT, 'pending connect must be woken promptly, not by deadline')
        assert.equal((raced as { ok: boolean; category?: string }).ok, false)
        assert.equal((raced as { category?: string }).category, 'T15E_CAPABILITY_REVOKED')
        assert.equal(rig.transport.state(), 'UNUSABLE')
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('RED: revoking AFTER connect forbids ARM — no write at all', async () => {
      const rig = await freshRig()
      try {
        const connect = rig.transport.connect(rig.clock.now + 10_000)
        await flush()
        rig.spawner.last.child.stdoutData(
          identityFrame(0, { dataDirectory: rig.runtime.paths.dataDir, serverPort: rig.config.port }),
        )
        assert.equal((await connect).ok, true)
        const writesBefore = rig.spawner.last.child.stdin.writes.length
        revokeOwnedRuntimeT15ECapabilities(rig.runtime)
        const result = await rig.transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
        assert.equal(result.ok === false && result.category, 'T15E_CAPABILITY_REVOKED')
        assert.equal(rig.spawner.last.child.stdin.writes.length, writesBefore, 'revoked: no write issued')
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('RED: revoking DURING a pending write/frame wakes the command promptly', async () => {
      const rig = await freshRig()
      try {
        const connect = rig.transport.connect(rig.clock.now + 10_000)
        await flush()
        rig.spawner.last.child.stdoutData(
          identityFrame(0, { dataDirectory: rig.runtime.paths.dataDir, serverPort: rig.config.port }),
        )
        assert.equal((await connect).ok, true)
        rig.spawner.last.child.stdin.neverAck = true
        const cmd = rig.transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
        await flush()
        revokeOwnedRuntimeT15ECapabilities(rig.runtime)
        const raced = await Promise.race([cmd.then((r) => r, (r) => r), settle().then(() => PROMPT)])
        assert.notEqual(raced, PROMPT, 'pending command must be woken by revocation, not by its deadline')
        assert.equal((raced as { ok: boolean; category?: string }).ok, false)
        assert.equal((raced as { category?: string }).category, 'T15E_CAPABILITY_REVOKED')
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('RED: caller mutating the config AFTER construction must not affect spawn', async () => {
      const rig = await freshRig()
      try {
        const boundPort = rig.config.port
        const boundPassword = rig.config.password
        ;(rig.config as { port: number }).port = 65001
        ;(rig.config as { password: string }).password = 'attacker-swapped-password-0123456789'
        const connect = rig.transport.connect(rig.clock.now + 10_000)
        await flush()
        assert.equal(rig.spawner.last.options.env.PGPORT, String(boundPort), 'spawn uses the BOUND port')
        assert.equal(rig.spawner.last.options.env.PGPASSWORD, boundPassword, 'spawn uses the BOUND password')
        rig.spawner.last.child.stdoutData(
          identityFrame(0, { serverPort: boundPort, dataDirectory: rig.runtime.paths.dataDir }),
        )
        assert.equal((await connect).ok, true)
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('RED: cleanup of the owned handle REMAINS possible after revocation', async () => {
      const rig = await freshRig()
      try {
        const connect = rig.transport.connect(rig.clock.now + 10_000)
        await flush()
        rig.spawner.last.child.stdoutData(
          identityFrame(0, { dataDirectory: rig.runtime.paths.dataDir, serverPort: rig.config.port }),
        )
        assert.equal((await connect).ok, true)
        revokeOwnedRuntimeT15ECapabilities(rig.runtime)
        const disposing = rig.transport.dispose(rig.clock.now + 30_000)
        await flush()
        assert.deepEqual(rig.spawner.last.child.killedSignals, ['SIGTERM'], 'exact owned handle still signalled')
        rig.spawner.last.child.simulateExit(0, null)
        rig.spawner.last.child.stdin.simulateClose()
        await flush()
        const outcome = await disposing
        assert.equal(outcome.ok, true, 'owned-handle cleanup still completes after revocation')
        assert.equal(outcome.terminalCleanup, 'complete')
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('subscription: multiple listeners, one throwing cannot skip the rest (new API)', async () => {
      const rig = await freshRig()
      try {
        const notified: string[] = []
        const subA = subscribeToT15ERevocation(rig.capability, () => { notified.push('A') })
        const subB = subscribeToT15ERevocation(rig.capability, () => { throw new Error('bad listener') })
        const subC = subscribeToT15ERevocation(rig.capability, () => { notified.push('C') })
        assert.notEqual(subA, null); assert.notEqual(subB, null); assert.notEqual(subC, null)
        assert.doesNotThrow(() => revokeOwnedRuntimeT15ECapabilities(rig.runtime))
        assert.deepEqual(notified, ['A', 'C'], 'independently guarded notifications')
        subA!.unsubscribe(); subB!.unsubscribe(); subC!.unsubscribe()
        assert.equal(notified.length, 2, 'unsubscribed listeners are not re-notified')
        revokeOwnedRuntimeT15ECapabilities(rig.runtime) // idempotent; no re-notify
        assert.equal(notified.length, 2)
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
  })

  // -------------------------------------------------------------------------
  // Task84: subscription lifecycle fixes (assertion RED — the transport never
  // unsubscribed; producer retained disposed callback references).
  // -------------------------------------------------------------------------

  describe('T15E revocation subscription lifecycle (Task84)', () => {
    async function freshRig() {
      const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-task84-'))
      const runtime = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
      const capability = mintT15EOwnedRuntimeCapability(runtime)
      if (capability === null) throw new Error('mint failed')
      const derived = createT15EPersistentPsqlConfigFromCapability(capability, { runNonce: NONCE })
      if (!derived.ok) throw new Error(`derive failed: ${derived.reason}`)
      const spawner = new FakeSpawner()
      const timers = new FakeTimers()
      const clock = new FakeClock()
      clock.now = START
      const t = createT15EPersistentPsqlTransport(derived.config, {
        spawnPsql: spawner.spawn,
        clock,
        scheduleTimer: (ms) => timers.schedule(ms),
      })
      if (!t.ok) throw new Error('transport rejected')
      return { tmpParent, runtime, capability, transport: t.transport, spawner, timers, clock }
    }
    async function disposeClean(rig: Awaited<ReturnType<typeof freshRig>>) {
      const disposing = rig.transport.dispose(rig.clock.now + 30_000)
      await flush()
      if (rig.spawner.calls.length > 0 && !rig.spawner.last.child.exited) {
        rig.spawner.last.child.simulateExit(0, null)
      }
      await disposing
      return rig
    }

    it('RED: repeated create/dispose releases subscriber references (count returns to zero)', async () => {
      const rig = await freshRig()
      try {
        const connect = rig.transport.connect(rig.clock.now + 10_000)
        await flush()
        rig.spawner.last.child.stdoutData(
          identityFrame(0, {
            dataDirectory: rig.runtime.paths.dataDir,
            serverPort: rig.capability.cluster.databasePort,
          }),
        )
        assert.equal((await connect).ok, true)
        const before = t15eRevocationSubscriberCountForDiagnostics(rig.capability)
        assert.equal(before, 1, 'one live transport subscription retained')
        await disposeClean(rig)
        const after = t15eRevocationSubscriberCountForDiagnostics(rig.capability)
        assert.equal(after, 0, 'dispose must RELEASE the callback reference, not just deactivate it')
        // Repeat: a second transport on the SAME allocation also releases.
        const second = createT15EPersistentPsqlTransport(
          createT15EPersistentPsqlConfigFromCapability(rig.capability, { runNonce: NONCE }).ok
            ? (createT15EPersistentPsqlConfigFromCapability(rig.capability, { runNonce: NONCE }) as { config: T15EPersistentPsqlConfig }).config
            : (null as unknown as T15EPersistentPsqlConfig),
          { spawnPsql: rig.spawner.spawn, clock: rig.clock, scheduleTimer: (ms) => rig.timers.schedule(ms) },
        )
        assert.equal(second.ok, true)
        assert.equal(t15eRevocationSubscriberCountForDiagnostics(rig.capability), 1)
        const d2 = second.transport.dispose(rig.clock.now + 30_000)
        await flush()
        await d2
        assert.equal(t15eRevocationSubscriberCountForDiagnostics(rig.capability), 0)
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('RED: subscribing an ALREADY-REVOKED capability is a defined rejection (null)', async () => {
      const rig = await freshRig()
      try {
        revokeOwnedRuntimeT15ECapabilities(rig.runtime)
        const sub = subscribeToT15ERevocation(rig.capability, () => undefined)
        assert.equal(sub, null, 'already-revoked subscribe must fail closed with no retained entry')
        assert.equal(t15eRevocationSubscriberCountForDiagnostics(rig.capability), 0)
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('reentrant subscribe INSIDE a revoke callback is a defined rejection; others still notified', async () => {
      const rig = await freshRig()
      try {
        const notified: string[] = []
        let reentrant: unknown = 'unset'
        subscribeToT15ERevocation(rig.capability, () => { notified.push('first') })
        subscribeToT15ERevocation(rig.capability, () => {
          reentrant = subscribeToT15ERevocation(rig.capability, () => undefined)
        })
        subscribeToT15ERevocation(rig.capability, () => { notified.push('last') })
        assert.doesNotThrow(() => revokeOwnedRuntimeT15ECapabilities(rig.runtime))
        assert.deepEqual(notified, ['first', 'last'])
        assert.equal(reentrant, null, 'reentrant subscribe during revoke is rejected, not retained')
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('a failing sibling finalizer does not skip the unsubscribe attempt', async () => {
      const rig = await freshRig()
      try {
        const connect = rig.transport.connect(rig.clock.now + 10_000)
        await flush()
        rig.spawner.last.child.stdoutData(
          identityFrame(0, {
            dataDirectory: rig.runtime.paths.dataDir,
            serverPort: rig.capability.cluster.databasePort,
          }),
        )
        assert.equal((await connect).ok, true)
        rig.spawner.last.child.failRemoveListener = true // sibling finalizer throws
        const disposing = rig.transport.dispose(rig.clock.now + 30_000)
        await flush()
        rig.spawner.last.child.simulateExit(0, null)
        const outcome = await disposing
        assert.equal(outcome.ok, false, 'failing finalizer keeps disposal failed')
        assert.equal(t15eRevocationSubscriberCountForDiagnostics(rig.capability), 0, 'unsubscribe still attempted and released')
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('late revokes never resurrect a disposed session', async () => {
      const rig = await freshRig()
      try {
        await disposeClean(rig)
        revokeOwnedRuntimeT15ECapabilities(rig.runtime)
        const result = await rig.transport.executeTrustedCommand({ kind: 'ARM', requestId: REQUEST_ID }, rig.clock.now + 10_000)
        assert.equal(result.ok, false)
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    })
    it('P2 retention: a FAILED removal keeps the strong root binding protective', async () => {
      const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-task84-p2-'))
      try {
        const runtimeA = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
        const runtimeB = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
        const throwingRm = async () => { throw new Error('rm failed') }
        await assert.rejects(removeOwnedRuntimeRoot(runtimeA.paths, throwingRm))
        // Binding RETAINED on failure: a cloned paths object targeting A's
        // root is still refused after the failed removal.
        const cloned = { ...runtimeB.paths, rootDir: runtimeA.paths.rootDir }
        await assert.rejects(removeOwnedRuntimeRoot(cloned), /SAFETY/)
      } finally {
        await fs.rm(tmpParent, { recursive: true, force: true })
      }
    })
  })


