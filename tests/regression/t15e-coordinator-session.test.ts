// T15E coordinator session (Task93) — fake child/clock only. No real spawn,
// psql, DB, sockets, or native factory execution.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REQUIRED_DATABASE_NAME } from '../support/native/native-environment'
import {
  createOwnedRuntime,
  mintT15EOwnedRuntimeCapability,
  revokeOwnedRuntimeT15ECapabilities,
} from '../support/native/postgres-instance'
import { frameCommand } from '../support/native/t15e-overlap-protocol'
import { createT15EPhaseMachine } from '../support/native/t15e-overlap-protocol'
import { createT15EPersistentPsqlConfigFromCapability } from '../support/native/t15e-persistent-session-transport'
import { buildCoordinatorFixedCommandSql, T15E_COORDINATOR_ARM_STAGE } from '../support/native/t15e-coordinator-commands'
import { createT15ECoordinatorSession } from '../support/native/t15e-coordinator-session'
import { createT15EMonitorSessionAdapter } from '../support/native/t15e-monitor-session-adapter'
import type { T15EPersistentPsqlTransport } from '../support/native/t15e-persistent-session-transport'

const NONCE = 'd'.repeat(32)
const START = 1_000_000
const REQUEST_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CANON = '2026-01-01T00:00:00.000000Z'
const MONITOR_PID = 901
const COORD_PID = 902

class FakeTimer {
  firedFlag = false
  cancelled = false
  private release!: () => void
  readonly fired: Promise<void>
  constructor(readonly ms: number) {
    this.fired = new Promise<void>((resolve) => { this.release = resolve })
  }
  fire() { if (!this.firedFlag && !this.cancelled) { this.firedFlag = true; this.release() } }
  cancel() { this.cancelled = true }
}
class FakeTimers {
  readonly armed: FakeTimer[] = []
  schedule(ms: number) { const timer = new FakeTimer(ms); this.armed.push(timer); return timer }
}
class FakeClock {
  now = START
  nowEpochMs() { return this.now }
}
class FakeStdin extends EventEmitter {
  writes: Buffer[] = []
  write(buffer: Buffer, callback?: (error: Error | null) => void) {
    this.writes.push(buffer)
    if (callback) setImmediate(() => callback(null))
    return true
  }
  end() { this.emit('close') }
}
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = new FakeStdin()
  kill() { return true }
  simulateExit(code: number | null, signal: string | null) { this.emit('exit', code, signal) }
}
class FakeSpawner {
  readonly calls: Array<{ child: FakeChild }> = []
  spawn = () => {
    const child = new FakeChild()
    this.calls.push({ child })
    return child as never
  }
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

async function makeRuntime() {
  const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 't15e-task93-'))
  const runtime = await createOwnedRuntime({ parentDir: tmpParent }, async () => false)
  const capability = mintT15EOwnedRuntimeCapability(runtime)
  if (capability === null) throw new Error('mint failed')
  const derived = createT15EPersistentPsqlConfigFromCapability(capability, { runNonce: NONCE })
  if (!derived.ok) throw new Error('derive failed')
  const spawner = new FakeSpawner()
  const timers = new FakeTimers()
  const clock = new FakeClock()
  const transportDeps = {
    spawnPsql: spawner.spawn as never,
    clock,
    scheduleTimer: (ms: number) => timers.schedule(ms),
  }
  return { tmpParent, runtime, capability, config: derived.config, spawner, timers, clock, transportDeps }
}

function identityFrame(runtime: Awaited<ReturnType<typeof makeRuntime>>['runtime'], pid: number) {
  return {
    pid,
    backendStart: CANON,
    databaseId: 7,
    dataDirectory: runtime.paths.dataDir,
    serverPort: runtime.ports.databasePort,
    databaseName: REQUIRED_DATABASE_NAME,
  }
}

function emit(child: FakeChild, seq: number, result: Record<string, unknown>) {
  child.stdout.emit('data', Buffer.from(frameCommand(NONCE, seq, result), 'utf8'))
}

describe('T15E coordinator session (Task93)', { timeout: 15_000 }, () => {
  it('same coordinator child writes BEGIN, FOR NO KEY UPDATE, and ROLLBACK; released evidence is not phase READY', async () => {
    const rig = await makeRuntime()
    try {
      const monitor = createT15EMonitorSessionAdapter({ config: rig.config, transportDeps: rig.transportDeps })
      const opening = monitor.open(START + 10_000)
      await flush()
      emit(rig.spawner.calls[0].child, 0, identityFrame(rig.runtime, MONITOR_PID))
      assert.equal((await opening).ok, true)

      const session = createT15ECoordinatorSession({
        config: rig.config,
        transportDeps: rig.transportDeps,
        monitor,
      })
      const connecting = session.connect(START + 10_000)
      await flush()
      const child = rig.spawner.calls[1].child
      emit(child, 0, identityFrame(rig.runtime, COORD_PID))
      const connected = await connecting
      assert.equal(connected.ok, true)

      const arming = session.armStage(REQUEST_ID, START + 2_000)
      await flush()
      emit(child, 1, {
        found: true, requestId: REQUEST_ID, status: T15E_COORDINATOR_ARM_STAGE, runNonce: NONCE,
      })
      assert.equal((await arming).ok, true)

      const pending = session.acquireThenRollback(REQUEST_ID, START + 2_000)
      await flush()
      emit(child, 2, { begun: true })
      await flush()
      emit(child, 3, {
        found: true,
        requestId: REQUEST_ID,
        status: T15E_COORDINATOR_ARM_STAGE,
        runNonce: NONCE,
        pid: COORD_PID,
        backendStart: CANON,
        databaseId: 7,
      })
      await flush()
      emit(child, 4, { rolledBack: true })
      const acquired = await pending
      assert.equal(acquired.ok, true)
      if (!acquired.ok) return
      assert.equal(acquired.readyEligible, false)
      assert.equal(acquired.historical.currentlyLocked, false)
      assert.equal(acquired.historical.lockReleased, true)
      assert.equal(acquired.historical.rollbackAcknowledged, true)
      assert.equal(acquired.acquireSentAtEpochMs, START)
      const machine = createT15EPhaseMachine()
      assert.equal(machine.accept({ kind: 'ARM', runNonce: NONCE, requestId: REQUEST_ID }).ok, true)
      assert.equal(machine.accept(acquired.historical).ok, false)
      assert.equal(machine.stage(), 'ARMED')

      assert.equal(rig.spawner.calls.length, 2, 'monitor child is not the coordinator child')
      const sql = child.stdin.writes.map((chunk) => chunk.toString('utf8')).join('\n')
      assert.match(sql, /\bBEGIN;/)
      assert.match(sql, /for no key update/i)
      assert.doesNotMatch(sql, /\bfor update\b/i)
      assert.match(sql, /\bROLLBACK;/)
      assert.match(sql, new RegExp(REQUEST_ID))
      assert.match(sql, /SendBackToRequester/)
      assert.equal(sql.includes("'; drop"), false)
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('rejects quoted and non-canonical request ids before any coordinator write', async () => {
    const built = buildCoordinatorFixedCommandSql(
      { kind: 'COORDINATOR_LOCK_NO_KEY_UPDATE', requestId: "11111111-1111-4111-8111-111111111111'; drop table requests;--" },
      NONCE,
      1,
    )
    assert.equal(built.ok, false)
    const rig = await makeRuntime()
    try {
      const monitor = createT15EMonitorSessionAdapter({ config: rig.config, transportDeps: rig.transportDeps })
      const opening = monitor.open(START + 5_000)
      await flush()
      emit(rig.spawner.calls[0].child, 0, identityFrame(rig.runtime, MONITOR_PID))
      await opening
      const session = createT15ECoordinatorSession({ config: rig.config, transportDeps: rig.transportDeps, monitor })
      const connecting = session.connect(START + 5_000)
      await flush()
      emit(rig.spawner.calls[1].child, 0, identityFrame(rig.runtime, COORD_PID))
      assert.equal((await connecting).ok, true)
      const writes = rig.spawner.calls[1].child.stdin.writes.length
      const rejected = await session.armStage("'; drop table requests;--", START + 5_000)
      assert.equal(rejected.ok, false)
      if (!rejected.ok) assert.equal(rejected.category, 'T15E_COORDINATOR_INVALID_REQUEST')
      assert.equal(rig.spawner.calls[1].child.stdin.writes.length, writes)
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('monitor must already be open; an oversized hold is rejected without BEGIN; dispose is not backend gone', async () => {
    const rig = await makeRuntime()
    try {
      let connectCalls = 0
      const session = createT15ECoordinatorSession({
        config: rig.config,
        transportDeps: rig.transportDeps,
        monitor: { info: () => null, checkAcceptance: () => null },
        createTransport: (() => ({
          ok: true,
          transport: { connect: async () => { connectCalls += 1; throw new Error('connect must not run') } },
        })) as never,
      })
      const blocked = await session.connect(START + 1_000)
      assert.equal(blocked.ok, false)
      if (!blocked.ok) assert.equal(blocked.category, 'T15E_COORDINATOR_MONITOR_NOT_PREESTABLISHED')
      assert.equal(connectCalls, 0)

      const commands: string[] = []
      const opened = openStubSession(rig, {
        executeTrustedCommand: async (command: { kind: string }) => {
          commands.push(command.kind)
          if (command.kind === 'COORDINATOR_ARM_STAGE') {
            return { ok: true, frame: { seq: 1, total: 1, result: { found: true, requestId: REQUEST_ID, status: T15E_COORDINATOR_ARM_STAGE, runNonce: NONCE } } }
          }
          throw new Error(`unexpected ${command.kind}`)
        },
      })
      assert.equal((await opened.connect(START + 1_000)).ok, true)
      assert.equal((await opened.armStage(REQUEST_ID, START + 3_001)).ok, true)
      const oversized = await opened.acquireThenRollback(REQUEST_ID, START + 3_001)
      assert.equal(oversized.ok, false)
      if (!oversized.ok) assert.equal(oversized.category, 'T15E_COORDINATOR_HOLD_EXCEEDS_HARD_MAX')
      assert.equal(commands.includes('COORDINATOR_BEGIN'), false)
      const disposed = await opened.dispose(START + 1_000)
      assert.equal(disposed.backendGoneConfirmed, false)
      assert.equal(disposed.pendingObligation, 'INDEPENDENT_BACKEND_GONE_CONFIRMATION')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('wrong row, wrong status, missing row, and no ack are not READY-eligible and still roll back', async () => {
    const rig = await makeRuntime()
    try {
      const cases = [
        { name: 'wrong-id', result: { ok: true, found: true, requestId: OTHER_ID, status: T15E_COORDINATOR_ARM_STAGE } },
        { name: 'wrong-status', result: { ok: true, found: true, requestId: REQUEST_ID, status: 'Completed' } },
        { name: 'missing', result: { ok: true, found: false } },
        { name: 'no-ack', result: { ok: false } },
      ] as const
      for (const item of cases) {
        const kinds: string[] = []
        const session = openStubSession(rig, {
          executeTrustedCommand: async (command: { kind: string }) => {
            kinds.push(command.kind)
            if (command.kind === 'COORDINATOR_ARM_STAGE') {
              return armFrame()
            }
            if (command.kind === 'COORDINATOR_BEGIN') return { ok: true, frame: { seq: 2, total: 1, result: { begun: true } } }
            if (command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE') {
              if (!item.result.ok) return { ok: false, category: 'T15E_COMMAND_TIMEOUT', message: 'x' }
              return { ok: true, frame: { seq: 3, total: 1, result: { ...item.result, runNonce: NONCE, pid: COORD_PID, backendStart: CANON, databaseId: 7 } } }
            }
            if (command.kind === 'COORDINATOR_ROLLBACK') return { ok: true, frame: { seq: 4, total: 1, result: { rolledBack: true } } }
            throw new Error(command.kind)
          },
        })
        assert.equal((await session.connect(START + 1_000)).ok, true)
        assert.equal((await session.armStage(REQUEST_ID, START + 1_000)).ok, true)
        const acquired = await session.acquireThenRollback(REQUEST_ID, START + 1_000)
        assert.equal(acquired.readyEligible, false, item.name)
        assert.equal(acquired.ok, false, item.name)
        assert.equal(kinds.includes('COORDINATOR_ROLLBACK'), true, item.name)
        const machine = createT15EPhaseMachine()
        assert.equal(machine.accept({ kind: 'ARM', runNonce: NONCE, requestId: REQUEST_ID }).ok, true)
        assert.equal(machine.stage(), 'ARMED', item.name)
      }
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('late ack, revocation, and dispose before continuation are not eligible; sync throw still rolls back', async () => {
    const rig = await makeRuntime()
    try {
      let releaseLock!: (value: unknown) => void
      const deadlines: number[] = []
      const late = openStubSession(rig, {
        executeTrustedCommand: (command: { kind: string }, deadline: number) => {
          deadlines.push(deadline)
          if (command.kind === 'COORDINATOR_ARM_STAGE') return Promise.resolve(armFrame())
          if (command.kind === 'COORDINATOR_BEGIN') return Promise.resolve({ ok: true, frame: { seq: 2, total: 1, result: { begun: true } } })
          if (command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE') {
            return new Promise((resolve) => { releaseLock = resolve as (value: unknown) => void })
          }
          return Promise.resolve({ ok: true, frame: { seq: 4, total: 1, result: { rolledBack: true } } })
        },
      })
      assert.equal((await late.connect(START + 1_000)).ok, true)
      assert.equal((await late.armStage(REQUEST_ID, START + 1_000)).ok, true)
      const pending = late.acquireThenRollback(REQUEST_ID, START + 1_000)
      await flush()
      releaseLock({ ok: true, frame: { seq: 3, total: 1, result: lockRow() } })
      rig.clock.now = START + 1_000
      const lateResult = await pending
      assert.equal(lateResult.readyEligible, false)
      assert.equal(lateResult.ok, false)
      if (!lateResult.ok) assert.equal(lateResult.category, 'T15E_COORDINATOR_DEADLINE_EXCEEDED')
      assert.equal(deadlines.every((deadline) => deadline <= START + 1_000), true)

      rig.clock.now = START
      let releaseDispose!: (value: unknown) => void
      const disposedKinds: string[] = []
      const disposing = openStubSession(rig, {
        executeTrustedCommand: (command: { kind: string }) => {
          disposedKinds.push(command.kind)
          if (command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE') {
            return new Promise((resolve) => { releaseDispose = resolve as (value: unknown) => void })
          }
          if (command.kind === 'COORDINATOR_ARM_STAGE') return Promise.resolve(armFrame())
          if (command.kind === 'COORDINATOR_BEGIN') return Promise.resolve({ ok: true, frame: { seq: 2, total: 1, result: { begun: true } } })
          return Promise.resolve({ ok: true, frame: { seq: 4, total: 1, result: { rolledBack: true } } })
        },
      })
      assert.equal((await disposing.connect(START + 1_000)).ok, true)
      assert.equal((await disposing.armStage(REQUEST_ID, START + 1_000)).ok, true)
      const disposePending = disposing.acquireThenRollback(REQUEST_ID, START + 1_000)
      await flush()
      releaseDispose({ ok: true, frame: { seq: 3, total: 1, result: lockRow() } })
      await disposing.dispose(START + 1_000)
      const disposedResult = await disposePending
      assert.equal(disposedResult.readyEligible, false)
      if (!disposedResult.ok) assert.equal(disposedResult.category, 'T15E_COORDINATOR_DISPOSED')
      assert.equal(disposedKinds.includes('COORDINATOR_ROLLBACK'), true)

      const throwingKinds: string[] = []
      const throwing = openStubSession(rig, {
        executeTrustedCommand: (command: { kind: string }) => {
          throwingKinds.push(command.kind)
          if (command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE') throw new Error('sync lock failure')
          if (command.kind === 'COORDINATOR_ARM_STAGE') return Promise.resolve(armFrame())
          if (command.kind === 'COORDINATOR_BEGIN') return Promise.resolve({ ok: true, frame: { seq: 2, total: 1, result: { begun: true } } })
          return Promise.resolve({ ok: true, frame: { seq: 4, total: 1, result: { rolledBack: true } } })
        },
      })
      assert.equal((await throwing.connect(START + 1_000)).ok, true)
      assert.equal((await throwing.armStage(REQUEST_ID, START + 1_000)).ok, true)
      const thrown = await throwing.acquireThenRollback(REQUEST_ID, START + 1_000)
      assert.equal(thrown.ok, false)
      if (!thrown.ok) assert.equal(thrown.category, 'T15E_COORDINATOR_ADAPTER_THROW')
      assert.equal(thrown.readyEligible, false)
      assert.equal(throwingKinds.includes('COORDINATOR_ROLLBACK'), true)

      const revokedKinds: string[] = []
      const revoked = openStubSession(rig, {
        executeTrustedCommand: (command: { kind: string }) => {
          revokedKinds.push(command.kind)
          if (command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE') {
            return new Promise((resolve) => { releaseLock = resolve as (value: unknown) => void })
          }
          if (command.kind === 'COORDINATOR_ARM_STAGE') return Promise.resolve(armFrame())
          if (command.kind === 'COORDINATOR_BEGIN') return Promise.resolve({ ok: true, frame: { seq: 2, total: 1, result: { begun: true } } })
          return Promise.resolve({ ok: true, frame: { seq: 4, total: 1, result: { rolledBack: true } } })
        },
      })
      rig.clock.now = START
      assert.equal((await revoked.connect(START + 1_000)).ok, true)
      assert.equal((await revoked.armStage(REQUEST_ID, START + 1_000)).ok, true)
      const revoking = revoked.acquireThenRollback(REQUEST_ID, START + 1_000)
      await flush()
      releaseLock({ ok: true, frame: { seq: 3, total: 1, result: lockRow() } })
      revokeOwnedRuntimeT15ECapabilities(rig.runtime)
      const revokedResult = await revoking
      assert.equal(revokedResult.readyEligible, false)
      if (!revokedResult.ok) assert.equal(revokedResult.category, 'T15E_COORDINATOR_REVOKED')
      assert.equal(revokedKinds.includes('COORDINATOR_ROLLBACK'), true)
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
})

describe('T15E coordinator integrity counterexamples (Task94)', { timeout: 15_000, concurrency: 1 }, () => {
  it('requests.id is TEXT and lock/ARM predicates use a validated text literal, not ::uuid', async () => {
    const migration = await fs.readFile(
      path.join(process.cwd(), 'prisma/migrations/00000000000001_clean_start_init/migration.sql'),
      'utf8',
    )
    const schema = await fs.readFile(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    const table = migration.slice(migration.indexOf('CREATE TABLE "requests"'))
    const tableBody = table.slice(0, table.indexOf(');'))
    assert.match(tableBody, /"id" TEXT NOT NULL/)
    assert.match(schema, /model requests \{[\s\S]*?id\s+String/)
    assert.doesNotMatch(schema.slice(schema.indexOf('model requests')), /id\s+String\s+@db\.Uuid/)
    for (const kind of ['COORDINATOR_ARM_STAGE', 'COORDINATOR_LOCK_NO_KEY_UPDATE'] as const) {
      const built = buildCoordinatorFixedCommandSql({ kind, requestId: REQUEST_ID }, NONCE, 2)
      assert.equal(built.ok, true, kind)
      if (!built.ok) return
      assert.doesNotMatch(built.sql, /::uuid/, kind)
      assert.match(built.sql, new RegExp(`id = '${REQUEST_ID}'`), kind)
      assert.doesNotMatch(built.sql, /id = '[^']+'::uuid/, kind)
    }
  })

  it('BEGIN pending: a second acquire is rejected before any write or rollback; the first still rolls back', async () => {
    const rig = await makeRuntime()
    try {
      const kinds: string[] = []
      let beginStarted = false
      let releaseBegin!: (value: unknown) => void
      let releaseLock!: (value: unknown) => void
      const session = openStubSession(rig, {
        executeTrustedCommand: (command: { kind: string }) => {
          kinds.push(command.kind)
          if (command.kind === 'COORDINATOR_ARM_STAGE') return Promise.resolve(armFrame())
          if (command.kind === 'COORDINATOR_BEGIN') {
            if (beginStarted) return Promise.resolve({ ok: false, category: 'T15E_COMMAND_IN_FLIGHT', message: 'x' })
            beginStarted = true
            return new Promise((resolve) => { releaseBegin = resolve as (value: unknown) => void })
          }
          if (command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE') {
            return new Promise((resolve) => { releaseLock = resolve as (value: unknown) => void })
          }
          if (command.kind === 'COORDINATOR_ROLLBACK') {
            return Promise.resolve({ ok: true, frame: { seq: 4, total: 1, result: { rolledBack: true } } })
          }
          return Promise.resolve({ ok: false, category: 'T15E_COMMAND_IN_FLIGHT', message: 'x' })
        },
      })
      assert.equal((await session.connect(START + 1_000)).ok, true)
      assert.equal((await session.armStage(REQUEST_ID, START + 1_000)).ok, true)
      const first = session.acquireThenRollback(REQUEST_ID, START + 1_000)
      await flush()
      const beforeSecond = kinds.slice()
      const second = await session.acquireThenRollback(REQUEST_ID, START + 1_000)
      assert.equal(second.ok, false)
      if (!second.ok) assert.equal(second.category, 'T15E_COORDINATOR_OPERATION_OVERLAP')
      assert.deepEqual(kinds, beforeSecond, `second acquire wrote ${kinds.slice(beforeSecond.length).join(',')}`)
      assert.equal(kinds.filter((kind) => kind === 'COORDINATOR_ROLLBACK').length, 0)
      releaseBegin({ ok: true, frame: { seq: 2, total: 1, result: { begun: true } } })
      await flush()
      releaseLock({ ok: true, frame: { seq: 3, total: 1, result: lockRow() } })
      const firstResult = await first
      assert.equal(kinds.filter((kind) => kind === 'COORDINATOR_ROLLBACK').length, 1)
      assert.equal(firstResult.ok, true)
      if (firstResult.ok) assert.equal(firstResult.rolledBack, true)
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('a failed rollback is unproven and blocks the next acquire without a false cleanup success', async () => {
    const rig = await makeRuntime()
    try {
      const kinds: string[] = []
      const session = openStubSession(rig, {
        executeTrustedCommand: (command: { kind: string }) => {
          kinds.push(command.kind)
          if (command.kind === 'COORDINATOR_ARM_STAGE') return Promise.resolve(armFrame())
          if (command.kind === 'COORDINATOR_BEGIN') return Promise.resolve({ ok: true, frame: { seq: 2, total: 1, result: { begun: true } } })
          if (command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE') return Promise.resolve({ ok: true, frame: { seq: 3, total: 1, result: lockRow() } })
          return Promise.resolve({ ok: false, category: 'T15E_COMMAND_IN_FLIGHT', message: 'x' })
        },
      })
      assert.equal((await session.connect(START + 1_000)).ok, true)
      assert.equal((await session.armStage(REQUEST_ID, START + 1_000)).ok, true)
      const first = await session.acquireThenRollback(REQUEST_ID, START + 1_000)
      assert.equal(first.ok, false)
      if (!first.ok) {
        assert.equal(first.rolledBack, false)
        assert.equal(first.category, 'T15E_COORDINATOR_TRANSACTION_UNPROVEN')
      }
      const writes = kinds.length
      const second = await session.acquireThenRollback(REQUEST_ID, START + 1_000)
      assert.equal(second.ok, false)
      if (!second.ok) assert.equal(second.category, 'T15E_COORDINATOR_TRANSACTION_UNPROVEN')
      assert.equal(kinds.length, writes, 'unproven transaction blocks the next acquire before any write')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('acquire-and-rollback evidence is historical and cannot be accepted as phase READY', async () => {
    const rig = await makeRuntime()
    try {
      const session = openStubSession(rig, {
        executeTrustedCommand: (command: { kind: string }) => {
          if (command.kind === 'COORDINATOR_ARM_STAGE') return Promise.resolve(armFrame())
          if (command.kind === 'COORDINATOR_BEGIN') return Promise.resolve({ ok: true, frame: { seq: 2, total: 1, result: { begun: true } } })
          if (command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE') return Promise.resolve({ ok: true, frame: { seq: 3, total: 1, result: lockRow() } })
          return Promise.resolve({ ok: true, frame: { seq: 4, total: 1, result: { rolledBack: true } } })
        },
      })
      assert.equal((await session.connect(START + 1_000)).ok, true)
      assert.equal((await session.armStage(REQUEST_ID, START + 1_000)).ok, true)
      const acquired = await session.acquireThenRollback(REQUEST_ID, START + 1_000)
      assert.equal(acquired.ok, true)
      if (!acquired.ok) return
      const published = 'ready' in acquired ? acquired.ready : null
      assert.equal(published, null, `released lock published ${JSON.stringify(published)}`)
      assert.equal(acquired.historical.currentlyLocked, false)
      assert.equal(acquired.historical.lockReleased, true)
      assert.equal(acquired.historical.rollbackAcknowledged, true)
      assert.equal(acquired.historical.kind, 'HISTORICAL_ACQUISITION')
      const machine = createT15EPhaseMachine()
      assert.equal(machine.accept({ kind: 'ARM', runNonce: NONCE, requestId: REQUEST_ID }).ok, true)
      assert.equal(machine.accept(acquired.historical).ok, false)
      assert.equal(machine.stage(), 'ARMED')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('matching monitor cluster and a distinct backend may arm; same backend and a foreign cluster write no ARM/BEGIN', async () => {
    const rig = await makeRuntime()
    try {
      const acceptedKinds: string[] = []
      const accepted = openStubSession(rig, {
        executeTrustedCommand: (command: { kind: string }) => {
          acceptedKinds.push(command.kind)
          if (command.kind === 'COORDINATOR_ARM_STAGE') return Promise.resolve(armFrame())
          return Promise.resolve({ ok: true, frame: { seq: 1, total: 1, result: { begun: true, rolledBack: true } } })
        },
      })
      assert.equal((await accepted.connect(START + 1_000)).ok, true)
      assert.equal((await accepted.armStage(REQUEST_ID, START + 1_000)).ok, true)
      assert.equal(acceptedKinds.includes('COORDINATOR_ARM_STAGE'), true)

      const sameKinds: string[] = []
      const sameBackend = createT15ECoordinatorSession({
        config: rig.config,
        transportDeps: rig.transportDeps,
        monitor: {
          info: () => ({
            monitorBackend: { pid: COORD_PID, backendStart: CANON, databaseId: 7 },
            cluster: { dataDirectory: rig.runtime.paths.dataDir, serverPort: rig.runtime.ports.databasePort, databaseName: REQUIRED_DATABASE_NAME },
          }),
          checkAcceptance: () => null,
        },
        createTransport: (() => ({
          ok: true,
          transport: {
            connect: async () => ({ ok: true, identity: { pid: COORD_PID, backendStart: CANON, databaseId: 7 } }),
            verifiedCluster: () => ({
              dataDirectory: rig.runtime.paths.dataDir,
              serverPort: rig.runtime.ports.databasePort,
              databaseName: REQUIRED_DATABASE_NAME,
            }),
            executeTrustedCommand: async (command: { kind: string }) => {
              sameKinds.push(command.kind)
              return { ok: true, frame: { seq: 1, total: 1, result: armFrame().frame.result } }
            },
            dispose: async () => ({ ok: true, childExited: false, cleanupFailures: [], terminalCleanup: 'complete', backendGoneConfirmed: false, pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION' }),
          },
        })) as never,
      })
      const sameConnect = await sameBackend.connect(START + 1_000)
      const sameArm = await sameBackend.armStage(REQUEST_ID, START + 1_000)
      assert.equal(sameConnect.ok, false)
      if (!sameConnect.ok) assert.equal(sameConnect.category, 'T15E_COORDINATOR_MONITOR_SAME_BACKEND')
      assert.equal(sameArm.ok, false)
      assert.equal(sameKinds.includes('COORDINATOR_ARM_STAGE'), false)
      assert.equal(sameKinds.includes('COORDINATOR_BEGIN'), false)

      let foreignConnects = 0
      const foreignKinds: string[] = []
      const foreign = createT15ECoordinatorSession({
        config: rig.config,
        transportDeps: rig.transportDeps,
        monitor: {
          info: () => ({
            monitorBackend: { pid: MONITOR_PID, backendStart: CANON, databaseId: 1 },
            cluster: { dataDirectory: '/foreign/pgdata', serverPort: rig.runtime.ports.databasePort, databaseName: REQUIRED_DATABASE_NAME },
          }),
          checkAcceptance: () => null,
        },
        createTransport: (() => ({
          ok: true,
          transport: {
            connect: async () => { foreignConnects += 1; return { ok: true, identity: { pid: COORD_PID, backendStart: CANON, databaseId: 7 } } },
            verifiedCluster: () => ({
              dataDirectory: rig.runtime.paths.dataDir,
              serverPort: rig.runtime.ports.databasePort,
              databaseName: REQUIRED_DATABASE_NAME,
            }),
            executeTrustedCommand: async (command: { kind: string }) => {
              foreignKinds.push(command.kind)
              return armFrame()
            },
            dispose: async () => ({ ok: true, childExited: false, cleanupFailures: [], terminalCleanup: 'complete', backendGoneConfirmed: false, pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION' }),
          },
        })) as never,
      })
      const foreignConnect = await foreign.connect(START + 1_000)
      const foreignArm = await foreign.armStage(REQUEST_ID, START + 1_000)
      assert.equal(foreignConnect.ok, false)
      if (!foreignConnect.ok) assert.equal(foreignConnect.category, 'T15E_COORDINATOR_MONITOR_CLUSTER_MISMATCH')
      assert.equal(foreignArm.ok, false)
      assert.equal(foreignConnects, 0)
      assert.equal(foreignKinds.length, 0)
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
})

describe('T15E held coordinator lock (Task95)', { timeout: 15_000, concurrency: 1 }, () => {
  it('holds without ROLLBACK until explicit release; READY is valid only while held', async () => {
    const rig = await makeRuntime()
    try {
      const monitor = createT15EMonitorSessionAdapter({ config: rig.config, transportDeps: rig.transportDeps })
      const opening = monitor.open(START + 10_000)
      await flush()
      emit(rig.spawner.calls[0].child, 0, identityFrame(rig.runtime, MONITOR_PID))
      assert.equal((await opening).ok, true)
      const session = createT15ECoordinatorSession({ config: rig.config, transportDeps: rig.transportDeps, monitor })
      const connecting = session.connect(START + 10_000)
      await flush()
      const child = rig.spawner.calls[1].child
      emit(child, 0, identityFrame(rig.runtime, COORD_PID))
      assert.equal((await connecting).ok, true)
      const arming = session.armStage(REQUEST_ID, START + 10_000)
      await flush()
      emit(child, 1, { found: true, requestId: REQUEST_ID, status: T15E_COORDINATOR_ARM_STAGE, runNonce: NONCE })
      assert.equal((await arming).ok, true)
      const timersBefore = rig.timers.armed.length
      const pending = session.acquireHeld(REQUEST_ID, START + 3_000)
      await flush()
      assert.ok(rig.timers.armed.slice(timersBefore).some((timer) => timer.ms === 2_500), 'watchdog armed before BEGIN completes')
      const sqlAtBegin = child.stdin.writes.map((chunk) => chunk.toString('utf8')).join('\n')
      assert.match(sqlAtBegin, /\bBEGIN;/)
      assert.doesNotMatch(sqlAtBegin, /\bROLLBACK;/)
      emit(child, 2, { begun: true })
      await flush()
      const sqlAtLock = child.stdin.writes.map((chunk) => chunk.toString('utf8')).join('\n')
      assert.match(sqlAtLock, /for no key update/i)
      assert.doesNotMatch(sqlAtLock, /\bROLLBACK;/)
      emit(child, 3, lockRow())
      const acquired = await pending
      assert.equal(acquired.ok, true)
      if (!acquired.ok || !('held' in acquired)) return
      const machine = createT15EPhaseMachine()
      assert.equal(machine.accept({ kind: 'ARM', runNonce: NONCE, requestId: REQUEST_ID }).ok, true)
      const proof = acquired.held.ready()
      assert.equal(proof.ok, true)
      if (!proof.ok) return
      assert.equal(machine.accept(proof.ready).ok, true)
      assert.equal(machine.stage(), 'READY')
      const releasing = acquired.held.release()
      await flush()
      emit(child, 4, { rolledBack: true })
      const released = await releasing
      assert.equal(released.ok, true)
      if (!released.ok) return
      assert.equal(released.readyEligible, false)
      assert.equal(released.historical.currentlyLocked, false)
      assert.equal(released.historical.lockReleased, true)
      assert.equal(acquired.held.ready().ok, false)
      const after = createT15EPhaseMachine()
      assert.equal(after.accept({ kind: 'ARM', runNonce: NONCE, requestId: REQUEST_ID }).ok, true)
      assert.equal(after.accept(released.historical).ok, false)
      assert.equal(after.stage(), 'ARMED')
      assert.match(child.stdin.writes.map((chunk) => chunk.toString('utf8')).join('\n'), /\bROLLBACK;/)
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('abandon fires the reserve watchdog once; late, repeated, and overlapping release do not fake proof', async () => {
    const rig = await makeRuntime()
    try {
      const kinds: string[] = []
      let releaseRollback!: (value: unknown) => void
      const session = openStubSession(rig, {
        executeTrustedCommand: (command: { kind: string }) => {
          kinds.push(command.kind)
          if (command.kind === 'COORDINATOR_ARM_STAGE') return Promise.resolve(armFrame())
          if (command.kind === 'COORDINATOR_BEGIN') return Promise.resolve({ ok: true, frame: { seq: 2, total: 1, result: { begun: true } } })
          if (command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE') return Promise.resolve({ ok: true, frame: { seq: 3, total: 1, result: lockRow() } })
          return new Promise((resolve) => { releaseRollback = resolve as (value: unknown) => void })
        },
      })
      assert.equal((await session.connect(START + 1_000)).ok, true)
      assert.equal((await session.armStage(REQUEST_ID, START + 3_000)).ok, true)
      const acquired = await session.acquireHeld(REQUEST_ID, START + 3_000)
      assert.equal(acquired.ok, true)
      if (!acquired.ok || !('held' in acquired)) return
      assert.equal(kinds.includes('COORDINATOR_ROLLBACK'), false)
      assert.equal(acquired.held.ready().ok, true)
      const watchdog = rig.timers.armed.find((timer) => timer.ms === 2_500)
      assert.ok(watchdog, 'watchdog must be armed before the hold is published')
      watchdog.fire()
      await flush()
      assert.equal(kinds.filter((kind) => kind === 'COORDINATOR_ROLLBACK').length, 1)
      assert.equal(acquired.held.ready().ok, false)
      const again = await acquired.held.release()
      assert.equal(again.ok, false)
      if (!again.ok) assert.equal(again.category, 'T15E_COORDINATOR_STALE_RELEASE')
      assert.equal(kinds.filter((kind) => kind === 'COORDINATOR_ROLLBACK').length, 1)
      rig.clock.now = START + 3_000
      releaseRollback({ ok: true, frame: { seq: 4, total: 1, result: { rolledBack: true } } })
      await flush()
      const second = await session.acquireHeld(REQUEST_ID, START + 6_000)
      assert.equal(second.ok, false)
      if (!second.ok) assert.equal(second.category, 'T15E_COORDINATOR_TRANSACTION_UNPROVEN')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('revoke and dispose invalidate READY; dispose does not claim backend gone', async () => {
    const rig = await makeRuntime()
    try {
      const session = openStubSession(rig, {
        executeTrustedCommand: (command: { kind: string }) => {
          if (command.kind === 'COORDINATOR_ARM_STAGE') return Promise.resolve(armFrame())
          if (command.kind === 'COORDINATOR_BEGIN') return Promise.resolve({ ok: true, frame: { seq: 2, total: 1, result: { begun: true } } })
          if (command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE') return Promise.resolve({ ok: true, frame: { seq: 3, total: 1, result: lockRow() } })
          return Promise.resolve({ ok: true, frame: { seq: 4, total: 1, result: { rolledBack: true } } })
        },
      })
      assert.equal((await session.connect(START + 1_000)).ok, true)
      assert.equal((await session.armStage(REQUEST_ID, START + 3_000)).ok, true)
      const acquired = await session.acquireHeld(REQUEST_ID, START + 3_000)
      if (!acquired.ok || !('held' in acquired)) throw new Error('hold failed')
      revokeOwnedRuntimeT15ECapabilities(rig.runtime)
      const revoked = acquired.held.ready()
      assert.equal(revoked.ok, false)
      if (!revoked.ok) assert.equal(revoked.category, 'T15E_COORDINATOR_REVOKED')
      const disposed = await session.dispose(START + 3_000)
      assert.equal(disposed.backendGoneConfirmed, false)
      assert.equal(acquired.held.ready().ok, false)
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })
})

describe('T15E held transport validity (Task96)', { timeout: 15_000, concurrency: 1 }, () => {
  it('child exit after a held acquire invalidates READY even if the monitor and capability stay live', async () => {
    const rig = await makeRuntime()
    try {
      const { session, child, held } = await holdOnRealChild(rig)
      assert.equal(session.info() !== null, true)
      child.simulateExit(1, null)
      const proof = held.ready()
      assert.equal(proof.ok, false, `exit published ${JSON.stringify(proof)}`)
      if (!proof.ok) assert.equal(proof.category, 'T15E_COORDINATOR_TRANSPORT_UNUSABLE')
      const again = await session.acquireHeld(REQUEST_ID, START + 3_000)
      assert.equal(again.ok, false)
      if (!again.ok) assert.equal(again.category, 'T15E_COORDINATOR_TRANSACTION_UNPROVEN')
      const disposed = await session.dispose(START + 3_000)
      assert.equal(disposed.backendGoneConfirmed, false)
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('malformed stdout and stdin error while held are not READY', async () => {
    const rig = await makeRuntime()
    try {
      const malformed = await holdOnRealChild(rig)
      malformed.child.stdout.emit('data', Buffer.from('unexpected-stdout\n'))
      const protocol = malformed.held.ready()
      assert.equal(protocol.ok, false, `protocol published ${JSON.stringify(protocol)}`)
      if (!protocol.ok) assert.equal(protocol.category, 'T15E_COORDINATOR_TRANSPORT_UNUSABLE')
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
      const rig2 = await makeRuntime()
      try {
        const stdin = await holdOnRealChild(rig2)
        stdin.child.stdin.emit('error', new Error('EPIPE'))
        const write = stdin.held.ready()
        assert.equal(write.ok, false, `stdin published ${JSON.stringify(write)}`)
        if (!write.ok) assert.equal(write.category, 'T15E_COORDINATOR_TRANSPORT_UNUSABLE')
      } finally {
        await fs.rm(rig2.tmpParent, { recursive: true, force: true })
      }
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('transport ack then child-exit before the adapter continuation does not publish READY', async () => {
    const rig = await makeRuntime()
    try {
      let releaseLock!: (value: unknown) => void
      let transportState: 'READY' | 'UNUSABLE' = 'READY'
      const session = openStubSession(rig, {
        state: () => transportState,
        executeTrustedCommand: (command: { kind: string }) => {
          if (command.kind === 'COORDINATOR_ARM_STAGE') return Promise.resolve(armFrame())
          if (command.kind === 'COORDINATOR_BEGIN') return Promise.resolve({ ok: true, frame: { seq: 2, total: 1, result: { begun: true } } })
          if (command.kind === 'COORDINATOR_LOCK_NO_KEY_UPDATE') {
            return new Promise((resolve) => { releaseLock = resolve as (value: unknown) => void })
          }
          return Promise.resolve({ ok: false, category: 'T15E_SESSION_UNUSABLE', message: 'x' })
        },
      })
      assert.equal((await session.connect(START + 1_000)).ok, true)
      assert.equal((await session.armStage(REQUEST_ID, START + 3_000)).ok, true)
      const pending = session.acquireHeld(REQUEST_ID, START + 3_000)
      await flush()
      releaseLock({ ok: true, frame: { seq: 3, total: 1, result: lockRow() } })
      transportState = 'UNUSABLE'
      const acquired = await pending
      assert.equal(acquired.ok, false, `gap published ${JSON.stringify(acquired.ok ? { held: true } : acquired)}`)
      if (!acquired.ok) assert.equal(acquired.category, 'T15E_COORDINATOR_TRANSPORT_UNUSABLE')
      const again = await session.acquireHeld(REQUEST_ID, START + 3_000)
      assert.equal(again.ok, false)
      if (!again.ok) assert.equal(again.category, 'T15E_COORDINATOR_TRANSACTION_UNPROVEN')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('lock ack settled then child exit before continuation does not publish READY', async () => {
    const rig = await makeRuntime()
    try {
      const opened = await openCoordinator(rig)
      const pending = opened.session.acquireHeld(REQUEST_ID, START + 3_000)
      await flush()
      emit(opened.child, 2, { begun: true })
      await flush()
      emit(opened.child, 3, lockRow())
      opened.child.simulateExit(1, null)
      const acquired = await pending
      assert.equal(acquired.ok, false, `gap published ${JSON.stringify(acquired.ok ? { held: true } : acquired)}`)
      if (!acquired.ok) assert.notEqual(acquired.category, 'T15E_COORDINATOR_LOCK_NOT_ELIGIBLE')
    } finally {
      await fs.rm(rig.tmpParent, { recursive: true, force: true })
    }
  })

  it('reserve expiry while BEGIN or LOCK is pending yields no READY and one unproven cleanup', async () => {
    for (const stage of ['begin', 'lock'] as const) {
      const rig = await makeRuntime()
      try {
        const opened = await openCoordinator(rig)
        const pending = opened.session.acquireHeld(REQUEST_ID, START + 3_000)
        await flush()
        if (stage === 'lock') {
          emit(opened.child, 2, { begun: true })
          await flush()
        }
        const watchdog = rig.timers.armed.find((timer) => timer.ms === 2_500 && !timer.cancelled)
        assert.ok(watchdog, stage)
        watchdog.fire()
        await flush()
        rig.clock.now = START + 3_000
        for (const timer of rig.timers.armed) {
          if (!timer.cancelled && !timer.firedFlag) timer.fire()
        }
        const acquired = await pending
        assert.equal(acquired.ok, false, stage)
        if (!acquired.ok) {
          assert.equal(acquired.rolledBack, false, stage)
          assert.ok(
            acquired.category === 'T15E_COORDINATOR_TRANSACTION_UNPROVEN' ||
              acquired.category === 'T15E_COORDINATOR_TRANSPORT_UNUSABLE',
            stage,
          )
        }
        const sql = opened.child.stdin.writes.map((chunk) => chunk.toString('utf8')).join('\n')
        assert.equal((sql.match(/\bROLLBACK;/g) ?? []).length <= 1, true, stage)
        assert.equal(rig.timers.armed.every((timer) => timer.cancelled || timer.firedFlag), true, stage)
        emit(opened.child, stage === 'begin' ? 2 : 3, lockRow())
        await flush()
        const again = await opened.session.acquireHeld(REQUEST_ID, START + 6_000)
        assert.equal(again.ok, false, stage)
        if (!again.ok) assert.equal(again.category, 'T15E_COORDINATOR_TRANSACTION_UNPROVEN', stage)
      } finally {
        await fs.rm(rig.tmpParent, { recursive: true, force: true })
      }
    }
  })
})

async function openCoordinator(rig: Awaited<ReturnType<typeof makeRuntime>>) {
  const monitor = createT15EMonitorSessionAdapter({ config: rig.config, transportDeps: rig.transportDeps })
  const opening = monitor.open(START + 10_000)
  await flush()
  emit(rig.spawner.calls[0].child, 0, identityFrame(rig.runtime, MONITOR_PID))
  if (!(await opening).ok) throw new Error('monitor open failed')
  const session = createT15ECoordinatorSession({ config: rig.config, transportDeps: rig.transportDeps, monitor })
  const connecting = session.connect(START + 10_000)
  await flush()
  const child = rig.spawner.calls[1].child
  emit(child, 0, identityFrame(rig.runtime, COORD_PID))
  if (!(await connecting).ok) throw new Error('coordinator connect failed')
  const arming = session.armStage(REQUEST_ID, START + 10_000)
  await flush()
  emit(child, 1, { found: true, requestId: REQUEST_ID, status: T15E_COORDINATOR_ARM_STAGE, runNonce: NONCE })
  if (!(await arming).ok) throw new Error('arm failed')
  return { session, child }
}

async function holdOnRealChild(rig: Awaited<ReturnType<typeof makeRuntime>>) {
  const opened = await openCoordinator(rig)
  const pending = opened.session.acquireHeld(REQUEST_ID, START + 3_000)
  await flush()
  emit(opened.child, 2, { begun: true })
  await flush()
  emit(opened.child, 3, lockRow())
  const acquired = await pending
  if (!acquired.ok || !('held' in acquired)) throw new Error('hold failed')
  return { session: opened.session, child: opened.child, held: acquired.held }
}

function lockRow() {
  return {
    found: true,
    requestId: REQUEST_ID,
    status: T15E_COORDINATOR_ARM_STAGE,
    runNonce: NONCE,
    pid: COORD_PID,
    backendStart: CANON,
    databaseId: 7,
  }
}
function armFrame() {
  return { ok: true as const, frame: { seq: 1, total: 1, result: { found: true, requestId: REQUEST_ID, status: T15E_COORDINATOR_ARM_STAGE, runNonce: NONCE } } }
}
function openStubSession(
  rig: Awaited<ReturnType<typeof makeRuntime>>,
  transport: Partial<T15EPersistentPsqlTransport> & {
    executeTrustedCommand: T15EPersistentPsqlTransport['executeTrustedCommand']
  },
) {
  const stub = {
    connect: async () => ({ ok: true as const, identity: { pid: COORD_PID, backendStart: CANON, databaseId: 7 } }),
    verifiedCluster: () => ({
      dataDirectory: rig.runtime.paths.dataDir,
      serverPort: rig.runtime.ports.databasePort,
      databaseName: REQUIRED_DATABASE_NAME,
    }),
    state: () => 'READY' as const,
    dispose: async () => ({
      ok: true,
      childExited: true,
      cleanupFailures: [],
      terminalCleanup: 'complete' as const,
      backendGoneConfirmed: false as const,
      pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION' as const,
    }),
    ...transport,
  }
  return createT15ECoordinatorSession({
    config: rig.config,
    transportDeps: rig.transportDeps,
    monitor: {
      info: () => ({
        monitorBackend: { pid: MONITOR_PID, backendStart: CANON, databaseId: 1 },
        cluster: { dataDirectory: rig.runtime.paths.dataDir, serverPort: rig.runtime.ports.databasePort, databaseName: REQUIRED_DATABASE_NAME },
      }),
      checkAcceptance: (deadline) => {
        if (rig.clock.nowEpochMs() >= deadline) return 'T15E_MONITOR_SESSION_DEADLINE_EXCEEDED'
        return null
      },
    },
    createTransport: (() => ({ ok: true, transport: stub })) as never,
  })
}
