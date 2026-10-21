// T15E snapshot observer (Task97) — injected query session only. No live SQL.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildTrustedPsqlCommand } from '../support/native/t15e-persistent-session-transport'
import {
  buildT15EOverlapSnapshotCommandSql,
  captureT15EOverlapSnapshot,
  type T15EOwnedAppBinding,
  type T15ESnapshotQuerySession,
} from '../support/native/t15e-snapshot-observer'

const NONCE = 'e'.repeat(32)
const START = 1_000_000
const CANON = '2026-01-01T00:00:00.000000Z'
const COORD = { pid: 900, backendStart: CANON, databaseId: 7 }
const APP_A = { pid: 101, backendStart: CANON }
const APP_B = { pid: 102, backendStart: CANON }
const BINDING: T15EOwnedAppBinding = [APP_A, APP_B]

function row(input: {
  pid: number
  backendStart?: string
  databaseId?: number
  state?: string
  waitEventType?: string | null
  xactStart?: string | null
  blockingPids?: number[]
}) {
  return {
    pid: input.pid,
    backendStart: input.backendStart ?? CANON,
    databaseId: input.databaseId ?? 7,
    state: input.state ?? 'active',
    waitEventType: input.waitEventType === undefined ? 'Lock' : input.waitEventType,
    xactStart: input.xactStart === undefined ? CANON : input.xactStart,
    blockingPids: input.blockingPids ?? [],
  }
}

const MONITOR = { pid: 901, backendStart: CANON, databaseId: 7 }

function directRows() {
  return {
    truncated: false,
    rows: [
      row({ pid: 900, blockingPids: [], xactStart: CANON }),
      row({ pid: 901, blockingPids: [], xactStart: null }),
      row({ pid: 101, blockingPids: [900] }),
      row({ pid: 102, blockingPids: [900] }),
    ],
  }
}

function harness(spec: {
  rows?: Record<string, unknown>
  binding?: T15EOwnedAppBinding | null
  holdFailsAfterRead?: boolean
  deadlineAfterClear?: boolean
  monitorFailsAfterClear?: boolean
  readFails?: boolean
}) {
  const calls: string[] = []
  let holdOk = true
  let monitorOk = true
  const clock = { now: START, nowEpochMs() { return this.now } }
  const query: T15ESnapshotQuerySession = {
    async clearSnapshot() {
      calls.push('CLEAR')
      if (spec.deadlineAfterClear) clock.now = START + 3_000
      if (spec.monitorFailsAfterClear) monitorOk = false
      return { ok: true }
    },
    async readActivity() {
      calls.push('READ')
      if (spec.holdFailsAfterRead) holdOk = false
      if (spec.readFails) return { ok: false }
      return { ok: true, result: spec.rows ?? directRows() }
    },
  }
  return {
    calls,
    clock,
    run: () => captureT15EOverlapSnapshot({
      held: { ready: () => ({ ok: holdOk }) },
      deadlineEpochMs: START + 2_500,
      clock,
      monitor: {
        info: () => monitorOk ? {
          monitorBackend: { pid: 901 },
          cluster: { dataDirectory: '/owned', serverPort: 23456, databaseName: 'app_cleanstart_dev' },
        } : null,
        checkAcceptance: () => null,
      },
      expectedCluster: { dataDirectory: '/owned', databasePort: 23456, database: 'app_cleanstart_dev' },
      coordinator: COORD,
      monitorIdentity: MONITOR,
      appBinding: spec.binding === undefined ? BINDING : spec.binding,
      scheduleTimer: (ms: number) => {
        let release = () => undefined
        const fired = new Promise<void>((resolve) => { release = () => { resolve(); return undefined } })
        return { ms, fired, cancel() { release() } }
      },
      query,
    }),
  }
}

describe('T15E snapshot integrity counterexamples (Task98)', { timeout: 15_000, concurrency: 1 }, () => {
  it('a real four-row activity result including the monitor is proof, not an extra app', async () => {
    const result = await harness({
      rows: {
        truncated: false,
        rows: [
          row({ pid: 900, blockingPids: [] }),
          row({ pid: 901, blockingPids: [] }),
          row({ pid: 101, blockingPids: [900] }),
          row({ pid: 102, blockingPids: [900] }),
        ],
      },
    }).run()
    assert.equal(result.ok, true, `four-row published ${JSON.stringify(result)}`)
  })

  it('a missing or non-boolean truncated marker is malformed, not a silent proof', async () => {
    const missing = await harness({ rows: { rows: directRows().rows } }).run()
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.equal(missing.category, 'T15E_SNAPSHOT_MALFORMED')
    const text = await harness({ rows: { truncated: 'true', rows: directRows().rows } }).run()
    assert.equal(text.ok, false)
    if (!text.ok) assert.equal(text.category, 'T15E_SNAPSHOT_MALFORMED', 'string true is not a truncation flag')
  })

  it('mutating the caller deadline while clear is pending does not extend the budget', async () => {
    const calls: string[] = []
    const clock = { now: START, nowEpochMs() { return this.now } }
    const input = {
      held: { ready: () => ({ ok: true }) },
      deadlineEpochMs: START + 100,
      clock,
      monitor: {
        info: () => ({ monitorBackend: { pid: 901 }, cluster: { dataDirectory: '/owned', serverPort: 23456, databaseName: 'app_cleanstart_dev' } }),
        checkAcceptance: () => null,
      },
      expectedCluster: { dataDirectory: '/owned', databasePort: 23456, database: 'app_cleanstart_dev' },
      coordinator: COORD,
      monitorIdentity: MONITOR,
      appBinding: BINDING,
      scheduleTimer: () => ({ ms: 0, fired: new Promise<void>(() => undefined), cancel() {} }),
      query: {
        async clearSnapshot() {
          calls.push('CLEAR')
          input.deadlineEpochMs = START + 1_000_000
          clock.now = START + 200
          return { ok: true as const }
        },
        async readActivity() {
          calls.push('READ')
          return { ok: true as const, result: directRows() }
        },
      },
    }
    const result = await captureT15EOverlapSnapshot(input)
    assert.equal(result.ok, false)
    assert.deepEqual(calls, ['CLEAR'], `read after original expiry: ${calls.join(',')}`)
  })

  it('a never-settling clear times out unproven, and a synchronous throw is a fixed failure', async () => {
    const calls: string[] = []
    let rejectLate!: (error: Error) => void
    const timers: Array<{ fire(): void; cancelled: boolean }> = []
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    const pending = captureT15EOverlapSnapshot({
      held: { ready: () => ({ ok: true }) },
      deadlineEpochMs: START + 100,
      clock: { nowEpochMs: () => START },
      scheduleTimer: (ms) => {
        let release!: () => void
        const timer = {
          ms,
          cancelled: false,
          fired: new Promise<void>((resolve) => { release = resolve }),
          fire() { if (!timer.cancelled) release() },
          cancel() { timer.cancelled = true },
        }
        timers.push(timer)
        return timer
      },
      monitor: {
        info: () => ({ monitorBackend: { pid: 901 }, cluster: { dataDirectory: '/owned', serverPort: 23456, databaseName: 'app_cleanstart_dev' } }),
        checkAcceptance: () => null,
      },
      monitorIdentity: MONITOR,
      expectedCluster: { dataDirectory: '/owned', databasePort: 23456, database: 'app_cleanstart_dev' },
      coordinator: COORD,
      appBinding: BINDING,
      query: {
        clearSnapshot: () => new Promise((resolve, reject) => { rejectLate = reject; void resolve }),
        async readActivity() { calls.push('READ'); return { ok: true as const, result: directRows() } },
      },
    })
    await new Promise((resolve) => setImmediate(resolve))
    timers[0]?.fire()
    const timed = await pending
    assert.equal(timed.ok, false)
    if (!timed.ok) assert.equal(timed.category, 'T15E_SNAPSHOT_UNPROVEN')
    assert.deepEqual(calls, [])
    assert.equal(timers[0]?.cancelled, true)
    rejectLate(new Error('late clear rejection'))
    await new Promise((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', onUnhandled)
    assert.equal(unhandled.length, 0)
    const thrown = await captureT15EOverlapSnapshot({
      held: { ready: () => ({ ok: true }) },
      deadlineEpochMs: START + 100,
      clock: { nowEpochMs: () => START },
      scheduleTimer: () => ({ ms: 1, fired: new Promise<void>(() => undefined), cancel() {} }),
      monitor: {
        info: () => ({ monitorBackend: { pid: 901 }, cluster: { dataDirectory: '/owned', serverPort: 23456, databaseName: 'app_cleanstart_dev' } }),
        checkAcceptance: () => null,
      },
      monitorIdentity: MONITOR,
      expectedCluster: { dataDirectory: '/owned', databasePort: 23456, database: 'app_cleanstart_dev' },
      coordinator: COORD,
      appBinding: BINDING,
      query: {
        clearSnapshot() { throw new Error('sync clear') },
        async readActivity() { return { ok: true, result: directRows() } },
      },
    })
    assert.equal(thrown.ok, false)
    if (!thrown.ok) assert.equal(thrown.category, 'T15E_SNAPSHOT_QUERY_FAILED')
  })

  it('the monitor row cannot be a blocker or an omitted real activity row', async () => {
    const blocker = await harness({
      rows: {
        truncated: false,
        rows: [
          row({ pid: 900, blockingPids: [] }),
          row({ pid: 901, blockingPids: [900] }),
          row({ pid: 101, blockingPids: [900] }),
          row({ pid: 102, blockingPids: [900] }),
        ],
      },
    }).run()
    assert.equal(blocker.ok, false)
    if (!blocker.ok) assert.equal(blocker.category, 'T15E_SNAPSHOT_UNPROVEN')
    const viaMonitor = await harness({
      rows: {
        truncated: false,
        rows: [
          row({ pid: 900, blockingPids: [] }),
          row({ pid: 901, blockingPids: [] }),
          row({ pid: 101, blockingPids: [901] }),
          row({ pid: 102, blockingPids: [900] }),
        ],
      },
    }).run()
    assert.equal(viaMonitor.ok, false)
    if (!viaMonitor.ok) assert.equal(viaMonitor.category, 'T15E_SNAPSHOT_UNPROVEN')
  })
})

describe('T15E snapshot command boundary (Task99)', { timeout: 15_000, concurrency: 1 }, () => {
  function boundaryCapture(clock: { nowEpochMs(): number }, query: T15ESnapshotQuerySession) {
    return captureT15EOverlapSnapshot({
      held: { ready: () => ({ ok: true }) },
      deadlineEpochMs: START + 100,
      clock,
      scheduleTimer: (ms) => ({ ms, fired: new Promise<void>(() => undefined), cancel() {} }),
      monitor: {
        info: () => ({ monitorBackend: { pid: 901 }, cluster: { dataDirectory: '/owned', serverPort: 23456, databaseName: 'app_cleanstart_dev' } }),
        checkAcceptance: () => null,
      },
      monitorIdentity: MONITOR,
      expectedCluster: { dataDirectory: '/owned', databasePort: 23456, database: 'app_cleanstart_dev' },
      coordinator: COORD,
      appBinding: BINDING,
      query,
    })
  }

  it('CLEAR is not invoked when the outer budget check is positive and the next remaining sample is zero', async () => {
    const calls: string[] = []
    let samples = 0
    const result = await boundaryCapture({
      nowEpochMs() {
        samples += 1
        return samples === 1 ? START : START + 100
      },
    }, {
      async clearSnapshot() { calls.push('CLEAR'); return { ok: true } },
      async readActivity() { calls.push('READ'); return { ok: true, result: directRows() } },
    })
    assert.equal(result.ok, false)
    assert.deepEqual(calls, [], `clear ran after the budget sample hit zero: ${calls.join(',')}`)
  })

  it('READ is not invoked when the post-clear check is positive and the next remaining sample is zero', async () => {
    const calls: string[] = []
    let samples = 0
    const result = await boundaryCapture({
      nowEpochMs() {
        samples += 1
        return samples <= 3 ? START : START + 100
      },
    }, {
      async clearSnapshot() { calls.push('CLEAR'); return { ok: true } },
      async readActivity() { calls.push('READ'); return { ok: true, result: directRows() } },
    })
    assert.equal(result.ok, false)
    assert.deepEqual(calls, ['CLEAR'], `read ran after the budget sample hit zero: ${calls.join(',')}`)
  })

  it('a never-settling read times out unproven after an immediate clear, and the late rejection is consumed', async () => {
    const calls: string[] = []
    let rejectLate!: (error: Error) => void
    const timers: Array<{ fire(): void; cancelled: boolean }> = []
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    const pending = captureT15EOverlapSnapshot({
      held: { ready: () => ({ ok: true }) },
      deadlineEpochMs: START + 100,
      clock: { nowEpochMs: () => START },
      scheduleTimer: (ms) => {
        let release!: () => void
        const timer = {
          ms,
          cancelled: false,
          fired: new Promise<void>((resolve) => { release = resolve }),
          fire() { if (!timer.cancelled) release() },
          cancel() { timer.cancelled = true },
        }
        timers.push(timer)
        return timer
      },
      monitor: {
        info: () => ({ monitorBackend: { pid: 901 }, cluster: { dataDirectory: '/owned', serverPort: 23456, databaseName: 'app_cleanstart_dev' } }),
        checkAcceptance: () => null,
      },
      monitorIdentity: MONITOR,
      expectedCluster: { dataDirectory: '/owned', databasePort: 23456, database: 'app_cleanstart_dev' },
      coordinator: COORD,
      appBinding: BINDING,
      query: {
        async clearSnapshot() { calls.push('CLEAR'); return { ok: true } },
        readActivity: () => new Promise((resolve, reject) => { calls.push('READ'); rejectLate = reject; void resolve }),
      },
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(calls, ['CLEAR', 'READ'])
    const readTimer = timers[timers.length - 1]
    readTimer?.fire()
    const result = await pending
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_SNAPSHOT_UNPROVEN')
    assert.equal(timers.every((timer) => timer.cancelled), true)
    rejectLate(new Error('late read rejection'))
    await new Promise((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', onUnhandled)
    assert.equal(unhandled.length, 0)
  })
})

describe('T15E snapshot observer (Task97)', { timeout: 15_000 }, () => {
  it('fixed SQL clears the snapshot before activity, uses blocking pids, and selects no query text', () => {
    const built = buildT15EOverlapSnapshotCommandSql(NONCE, 3)
    assert.equal(built.ok, true)
    if (!built.ok) return
    const clearAt = built.sql.indexOf('pg_stat_clear_snapshot')
    const activityAt = built.sql.indexOf('pg_stat_activity')
    assert.ok(clearAt >= 0 && activityAt > clearAt)
    assert.match(built.sql, /pg_blocking_pids/)
    assert.equal(built.sql.includes('s.query'), false)
    assert.equal(built.sql.includes('wait_event '), false)
    const wrapped = buildTrustedPsqlCommand({ kind: 'SELECT_OVERLAP_SNAPSHOT' }, NONCE, 4)
    assert.equal(wrapped.ok, true)
    if (wrapped.ok) assert.match(wrapped.sql, /pg_stat_clear_snapshot/)
  })

  it('direct and transitive bound waiters prove; missing binding does not query', async () => {
    const direct = harness({})
    const proved = await direct.run()
    assert.equal(proved.ok, true)
    if (proved.ok) assert.equal(proved.overlap.topology, 'DIRECT_BOTH')
    assert.deepEqual(direct.calls, ['CLEAR', 'READ'])
    const chain = harness({
      rows: {
        truncated: false,
        rows: [
          row({ pid: 900, blockingPids: [] }),
          row({ pid: 901, blockingPids: [] }),
          row({ pid: 101, blockingPids: [900] }),
          row({ pid: 102, blockingPids: [101] }),
        ],
      },
    })
    const transitive = await chain.run()
    assert.equal(transitive.ok, true)
    if (transitive.ok) assert.equal(transitive.overlap.topology, 'TRANSITIVE')
    const unbound = harness({ binding: null })
    const refused = await unbound.run()
    assert.equal(refused.ok, false)
    if (!refused.ok) assert.equal(refused.category, 'T15E_SNAPSHOT_APP_BINDING_REQUIRED')
    assert.deepEqual(unbound.calls, [])
  })

  it('unknown node, cycle, duplicate pid, third app, malformed, truncated, and foreign coordinator are not proof', async () => {
    const cases: Array<{ name: string; rows: Record<string, unknown>; category: string }> = [
      { name: 'unknown', rows: { truncated: false, rows: [row({ pid: 900 }), row({ pid: 101, blockingPids: [999] }), row({ pid: 102, blockingPids: [900] })] }, category: 'T15E_SNAPSHOT_UNPROVEN' },
      { name: 'cycle', rows: { truncated: false, rows: [row({ pid: 900 }), row({ pid: 101, blockingPids: [102] }), row({ pid: 102, blockingPids: [101] })] }, category: 'T15E_SNAPSHOT_UNPROVEN' },
      { name: 'duplicate', rows: { truncated: false, rows: [row({ pid: 900 }), row({ pid: 101, blockingPids: [900] }), row({ pid: 101, blockingPids: [900] })] }, category: 'T15E_SNAPSHOT_MALFORMED' },
      { name: 'third', rows: { truncated: false, rows: [row({ pid: 900 }), row({ pid: 101, blockingPids: [900] }), row({ pid: 102, blockingPids: [900] }), row({ pid: 103, blockingPids: [900] })] }, category: 'T15E_SNAPSHOT_UNPROVEN' },
      { name: 'malformed', rows: { truncated: false, rows: [row({ pid: 900 }), { pid: 101, backendStart: CANON, databaseId: 7, state: 'waiting-on-update', waitEventType: 'Lock', xactStart: CANON, blockingPids: [900] }, row({ pid: 102, blockingPids: [900] })] }, category: 'T15E_SNAPSHOT_MALFORMED' },
      { name: 'truncated', rows: { truncated: true, rows: directRows().rows }, category: 'T15E_SNAPSHOT_TRUNCATED' },
      { name: 'foreign-start', rows: { truncated: false, rows: [row({ pid: 900, backendStart: '2026-02-02T00:00:00.000000Z' }), row({ pid: 101, blockingPids: [900] }), row({ pid: 102, blockingPids: [900] })] }, category: 'T15E_SNAPSHOT_UNPROVEN' },
    ]
    for (const item of cases) {
      const result = await harness({ rows: item.rows }).run()
      assert.equal(result.ok, false, item.name)
      if (!result.ok) assert.equal(result.category, item.category, item.name)
    }
  })

  it('held release, deadline, and monitor loss between query success and accept publish no proof', async () => {
    const released = harness({ holdFailsAfterRead: true })
    const releasedResult = await released.run()
    assert.equal(releasedResult.ok, false)
    if (!releasedResult.ok) assert.equal(releasedResult.category, 'T15E_SNAPSHOT_HOLD_NOT_READY')
    const late = harness({ deadlineAfterClear: true })
    const lateResult = await late.run()
    assert.equal(lateResult.ok, false)
    if (!lateResult.ok) assert.equal(lateResult.category, 'T15E_SNAPSHOT_DEADLINE')
    assert.deepEqual(late.calls, ['CLEAR'])
    const dropped = harness({ monitorFailsAfterClear: true })
    const droppedResult = await dropped.run()
    assert.equal(droppedResult.ok, false)
    if (!droppedResult.ok) assert.equal(droppedResult.category, 'T15E_SNAPSHOT_HOLD_NOT_READY')
  })
})
