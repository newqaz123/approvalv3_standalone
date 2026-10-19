// T15E independent BACKEND-GONE monitor (Task86) — INJECTED FAKES ONLY.
// No real spawn/psql/DB/sockets/server/browser/HTTP/SMTP/.env. Child exit is
// NEVER backend gone; gone requires a valid full-query snapshot on a
// DISTINCT, same-verified-cluster monitor connection.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createT15EBackendMonitor,
  buildT15EMonitorIdentityQuery,
  T15E_MONITOR_CLEAR_SNAPSHOT_SQL,
  type T15EMonitorBackendIdentity,
  type T15EMonitorClusterIdentity,
  type T15EMonitorQuerySession,
  type T15EMonitorSessionFactory,
} from '../support/native/t15e-backend-monitor'

const START = 1_000_000
const COORD: T15EMonitorBackendIdentity = { pid: 900, backendStart: '2026-01-01T00:00:00.000000Z', databaseId: 7 }
const MONITOR_BACKEND: T15EMonitorBackendIdentity = { pid: 901, backendStart: '2026-01-01T00:00:01.000000Z', databaseId: 7 }
const CLUSTER: T15EMonitorClusterIdentity = { dataDirectory: '/owned/pgdata', serverPort: 23456, databaseName: 'app_cleanstart_dev' }

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
  schedule(ms: number) {
    const t = new FakeTimer(ms)
    this.armed.push(t)
    return t
  }
  allCancelled() { return this.armed.every((t) => t.cancelled) }
  firePending() {
    for (let i = this.armed.length - 1; i >= 0; i--) {
      const t = this.armed[i]
      if (!t.cancelled && !t.firedFlag) { t.fire(); return t }
    }
    throw new Error('test bug: no pending timer')
  }
}

class FakeClock {
  now = START
  nowEpochMs() { return this.now }
}

interface Rig {
  timers: FakeTimers
  clock: FakeClock
  sqlLog: string[]
  make(overrides?: {
    sessionFactory?: T15EMonitorSessionFactory
    pollIntervalMs?: number
  }): ReturnType<typeof createT15EBackendMonitor>
}

function makeRig(rows: () => unknown): Rig {
  const timers = new FakeTimers()
  const clock = new FakeClock()
  const sqlLog: string[] = []
  const session: T15EMonitorQuerySession = {
    async query(sql: string) {
      sqlLog.push(sql)
      const result = rows()
      if (result instanceof Error) throw result
      return result
    },
  }
  const sessionFactory: T15EMonitorSessionFactory = async () => ({
    ok: true,
    session,
    info: { monitorBackend: MONITOR_BACKEND, cluster: CLUSTER },
  })
  return {
    timers,
    clock,
    sqlLog,
    make: (overrides) =>
      createT15EBackendMonitor({
        clock,
        scheduleTimer: (ms) => timers.schedule(ms),
        createQuerySession: overrides?.sessionFactory ?? sessionFactory,
        expectedCluster: CLUSTER,
        pollIntervalMs: overrides?.pollIntervalMs ?? 250,
      }),
  }
}

const flush = () => new Promise<void>((r) => setImmediate(r))

describe('T15E backend-gone monitor (Task86)', () => {
  it('exact target PRESENT => not gone, checks >= 1, clear-snapshot before every check', async () => {
    const rig = makeRig(() => [['900', '2026-01-01T00:00:00.000000Z', '7']])
    const pending = rig.make().confirmBackendGone(COORD, START + 5_000)
    await flush()
    rig.timers.firePending() // pace timer between polls
    rig.clock.now = START + 6_000 // caller-absolute deadline elapses
    const result = await pending
    assert.equal(result.kind, 'PRESENT')
    if (result.kind === 'PRESENT') assert.ok(result.checks >= 1)
    assert.equal(rig.sqlLog[0], T15E_MONITOR_CLEAR_SNAPSHOT_SQL, 'clear snapshot first')
    assert.match(rig.sqlLog[1] ?? '', /pg_stat_activity/)
  })
  it('target ABSENT with a valid full snapshot => GONE', async () => {
    const rig = makeRig(() => [])
    const result = await rig.make().confirmBackendGone(COORD, START + 5_000)
    assert.equal(result.kind, 'GONE')
    if (result.kind === 'GONE') assert.ok(result.checks >= 1)
  })
  it('SAME PID with a NEW backendStart => PID reused => the OLD backend is gone (precise)', async () => {
    const rig = makeRig(() => [['900', '2026-02-02T00:00:00.000000Z', '7']])
    const result = await rig.make().confirmBackendGone(COORD, START + 5_000)
    assert.equal(result.kind, 'GONE')
  })
  it('foreign DATABASE (datid mismatch) => UNPROVEN, never gone', async () => {
    const rig = makeRig(() => [['900', '2026-01-01T00:00:00.000000Z', '99']])
    const result = await rig.make().confirmBackendGone(COORD, START + 5_000)
    assert.equal(result.kind, 'UNPROVEN')
    if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_DATABASE_MISMATCH')
  })
  it('session cluster MISMATCH vs expected cluster => UNPROVEN', async () => {
    const rig = makeRig(() => [])
    const foreign: T15EMonitorSessionFactory = async () => ({
      ok: true,
      session: { async query() { return [] } },
      info: { monitorBackend: MONITOR_BACKEND, cluster: { ...CLUSTER, dataDirectory: '/foreign/pgdata' } },
    })
    const result = await rig.make({ sessionFactory: foreign }).confirmBackendGone(COORD, START + 5_000)
    assert.equal(result.kind, 'UNPROVEN')
    if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_CLUSTER_MISMATCH')
  })
  it('monitor backend pid EQUALS coordinator pid => rejected (not a distinct connection)', async () => {
    const rig = makeRig(() => [])
    const same: T15EMonitorSessionFactory = async () => ({
      ok: true,
      session: { async query() { return [] } },
      info: { monitorBackend: { ...MONITOR_BACKEND, pid: COORD.pid }, cluster: CLUSTER },
    })
    const result = await rig.make({ sessionFactory: same }).confirmBackendGone(COORD, START + 5_000)
    assert.equal(result.kind, 'UNPROVEN')
    if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_SAME_BACKEND')
  })
  it('refresh order: clear snapshot precedes the identity query on EVERY poll', async () => {
    let identityPolls = 0
    const rig = makeRig(() => {
      // rows() is called for the CLEAR prelude too; only identity queries count.
      if (rig.sqlLog.length > 0 && !rig.sqlLog[rig.sqlLog.length - 1].includes('pg_stat_activity')) {
        return [] // clear-snapshot result payload (ignored by the monitor)
      }
      return identityPolls++ === 0 ? [['900', '2026-01-01T00:00:00.000000Z', '7']] : []
    })
    const monitor = rig.make({ pollIntervalMs: 250 })
    const pending = monitor.confirmBackendGone(COORD, START + 10_000)
    await new Promise((r) => setTimeout(r, 10)) // deep flush of the query chain
    rig.timers.firePending() // pace timer between polls
    const result = await pending
    assert.equal(result.kind, 'GONE', 'second poll observes absence')
    if (result.kind === 'GONE') assert.equal(result.checks, 2)
    assert.equal(rig.sqlLog[0], T15E_MONITOR_CLEAR_SNAPSHOT_SQL)
    assert.match(rig.sqlLog[1] ?? '', /pg_stat_activity/)
    assert.equal(rig.sqlLog[2], T15E_MONITOR_CLEAR_SNAPSHOT_SQL, 'cleared again before poll 2')
    assert.match(rig.sqlLog[3] ?? '', /pg_stat_activity/)
    assert.equal(rig.timers.allCancelled(), true)
  })
  it('a HANGING query stays bounded by the caller-absolute deadline; late settlement is consumed', async () => {
    const rig = makeRig(() => new Error('unused'))
    const hang: T15EMonitorSessionFactory = async () => ({
      ok: true,
      session: {
        query(sql: string) {
          rig.sqlLog.push(sql)
          return new Promise<unknown>(() => undefined) // never settles
        },
      },
      info: { monitorBackend: MONITOR_BACKEND, cluster: CLUSTER },
    })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    const pending = rig.make({ sessionFactory: hang }).confirmBackendGone(COORD, START + 5_000)
    await flush()
    rig.timers.firePending() // deadline-bound timer fires
    const result = await pending
    assert.equal(result.kind, 'UNPROVEN')
    if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_TIMEOUT')
    await new Promise((r) => setTimeout(r, 25))
    process.off('unhandledRejection', onUnhandled)
    assert.equal(unhandled.length, 0, 'late rejection consumed, never unhandled')
    assert.equal(rig.timers.allCancelled(), true)
  })
  it('MALFORMED responses (duplicate rows, garbage) fail closed => UNPROVEN', async () => {
    for (const malformed of [
      [['900', '2026-01-01T00:00:00.000000Z', '7'], ['900', '2026-01-01T00:00:00.000000Z', '7']], // duplicate/ambiguous
      'not-an-array',
      [['900']], // wrong arity
      [['abc', '2026-01-01T00:00:00.000000Z', '7']], // non-numeric pid
      [[901, '2026-01-01T00:00:00.000000Z', '7']], // wrong pid row
    ]) {
      const rig = makeRig(() => malformed)
      const result = await rig.make().confirmBackendGone(COORD, START + 5_000)
      assert.equal(result.kind, 'UNPROVEN', JSON.stringify(malformed))
      if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_MALFORMED_RESPONSE')
    }
  })
  it('cleanup-time monitor FAILURE (query throw / session unavailable) can NEVER report gone', async () => {
    const throwing = makeRig(() => new Error('connection reset'))
    const threw = await throwing.make().confirmBackendGone(COORD, START + 5_000)
    assert.equal(threw.kind, 'UNPROVEN')
    if (threw.kind === 'UNPROVEN') assert.equal(threw.category, 'T15E_MONITOR_QUERY_FAILED')
    const unavailable: T15EMonitorSessionFactory = async () => ({ ok: false })
    const rig2 = makeRig(() => [])
    const noSession = await rig2.make({ sessionFactory: unavailable }).confirmBackendGone(COORD, START + 5_000)
    assert.equal(noSession.kind, 'UNPROVEN')
    if (noSession.kind === 'UNPROVEN') assert.equal(noSession.category, 'T15E_MONITOR_SESSION_UNAVAILABLE')
  })
  it('validated fixed SQL: pid is strictly validated, no arbitrary fragments', () => {
    assert.equal(
      buildT15EMonitorIdentityQuery(900),
      'select pid, ' +
        "to_char(backend_start at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')" +
        ', datid from pg_stat_activity where pid = 900;',
    )
    for (const bad of [0, -1, 1.5, NaN]) {
      assert.equal(buildT15EMonitorIdentityQuery(bad), null)
    }
  })

  // -------------------------------------------------------------------------
  // Task87 (PARENT RELAY, latest review absent): proof-integrity P1s.
  // -------------------------------------------------------------------------

  describe('T15E monitor proof integrity (Task87, relay)', () => {
    it('RED: equivalent-instant/other-timezone/garbage backendStart is UNPROVEN, never GONE', async () => {
      for (const badStart of [
        '2025-12-31T19:00:00-05:00', // same instant, noncanonical timezone text
        '2026-01-01T00:00:00.000000+00:00', // equivalent offset form
        'garbage',
        '2026-01-01T00:00:00Z', // missing microseconds: noncanonical
      ]) {
        const rig = makeRig(() => [['900', badStart, '7']])
        const result = await rig.make().confirmBackendGone(COORD, START + 5_000)
        assert.equal(result.kind, 'UNPROVEN', badStart)
        if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_MALFORMED_RESPONSE', badStart)
      }
    })
    it('RED: rows arriving AFTER the absolute clock deadline can never produce GONE', async () => {
      const rig = makeRig(() => [])
      let resolveQuery!: (value: unknown) => void
      const lateSession: T15EMonitorSessionFactory = async () => ({
        ok: true,
        session: {
          query() {
            return new Promise<unknown>((resolve) => { resolveQuery = resolve })
          },
        },
        info: { monitorBackend: MONITOR_BACKEND, cluster: CLUSTER },
      })
      const pending = rig.make({ sessionFactory: lateSession }).confirmBackendGone(COORD, START + 5_000)
      await flush()
      rig.clock.now = START + 6_000 // absolute deadline passed; timer NOT fired
      resolveQuery([]) // late empty rows
      const result = await pending
      assert.notEqual(result.kind, 'GONE')
      assert.equal(result.kind, 'UNPROVEN')
      if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_TIMEOUT')
      assert.equal(rig.timers.allCancelled(), true)
    })
    it('RED: an already-exhausted budget performs NO work (factory/thunk never invoked)', async () => {
      let factoryCalls = 0
      const throwingFactory: T15EMonitorSessionFactory = () => {
        factoryCalls += 1
        throw new Error('sync thunk must not run')
      }
      const rig = makeRig(() => [])
      const result = await rig.make({ sessionFactory: throwingFactory }).confirmBackendGone(COORD, START - 1)
      assert.equal(result.kind, 'UNPROVEN')
      if (result.kind === 'UNPROVEN') {
        // Pre-exhausted deadline: the loop refuses before any work; the
        // in-flight exhaustion path returns TIMEOUT, this one DEADLINE_EXCEEDED.
        assert.equal(result.category, 'T15E_MONITOR_DEADLINE_EXCEEDED')
      }
      assert.equal(factoryCalls, 0, 'no thunk invocation after budget exhaustion')
    })
    it('RED: mutating the target identity / expected cluster mid-flight never changes the proof', async () => {
      const rig = makeRig(() => [['900', '2026-01-01T00:00:00.000000Z', '7']])
      let resolveQuery!: (value: unknown) => void
      const heldSession: T15EMonitorSessionFactory = async () => ({
        ok: true,
        session: {
          query(sql: string) {
            if (sql.includes('pg_stat_activity')) {
              return new Promise<unknown>((resolve) => { resolveQuery = resolve })
            }
            return Promise.resolve([])
          },
        },
        info: { monitorBackend: MONITOR_BACKEND, cluster: CLUSTER },
      })
      const originalStart = COORD.backendStart
      const originalClusterDataDir = CLUSTER.dataDirectory
      const pending = rig.make({ sessionFactory: heldSession }).confirmBackendGone(COORD, START + 5_000)
      await flush()
      // Caller mutates the SHARED objects while the identity query is pending.
      COORD.backendStart = 'garbage'
      CLUSTER.dataDirectory = '/attacker/pgdata'
      resolveQuery([['900', '2026-01-01T00:00:00.000000Z', '7']])
      await flush()
      rig.timers.firePending() // pace timer
      rig.clock.now = START + 6_000 // deadline elapses with the ORIGINAL proof
      const result = await pending
      COORD.backendStart = originalStart
      CLUSTER.dataDirectory = originalClusterDataDir
      assert.equal(result.kind, 'PRESENT', 'the frozen pre-await copies govern the proof')
      if (result.kind === 'PRESENT') assert.ok(result.checks >= 1)
    })
    it('canonical representation: distinct 1-microsecond identities are DIFFERENT backends', async () => {
      const rig = makeRig(() => [['900', '2026-01-01T00:00:00.000001Z', '7']])
      const result = await rig.make().confirmBackendGone(COORD, START + 5_000)
      assert.equal(result.kind, 'GONE', 'one microsecond apart is a different backend (old gone)')
    })
    it('noncanonical TARGET backendStart is rejected UNPROVEN up front', async () => {
      const rig = makeRig(() => [])
      const result = await rig.make().confirmBackendGone(
        { pid: 900, backendStart: '2026-01-01T00:00:00Z', databaseId: 7 },
        START + 5_000,
      )
      assert.equal(result.kind, 'UNPROVEN')
      if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_MALFORMED_RESPONSE')
    })
  })


})
  // -------------------------------------------------------------------------
  // Task88 (relay P2, TEST-ONLY): precise deadline coverage. The Task87 fake
  // held EVERY query (the first is the clear-snapshot prelude), so the
  // identity query was never reached. These tests resolve clear immediately,
  // hold ONLY the identity query, and pin the between-stage budget guards.
  // -------------------------------------------------------------------------

  describe('T15E monitor deadline coverage (Task88, relay)', () => {
    function heldIdentityRig() {
      const rig = makeRig(() => [])
      let resolveIdentity!: (value: unknown) => void
      const factory: T15EMonitorSessionFactory = async () => ({
        ok: true,
        session: {
          query(sql: string) {
            rig.sqlLog.push(sql)
            if (sql.includes('pg_stat_activity')) {
              return new Promise<unknown>((resolve) => { resolveIdentity = resolve })
            }
            return Promise.resolve([]) // clear-snapshot completes immediately
          },
        },
        info: { monitorBackend: MONITOR_BACKEND, cluster: CLUSTER },
      })
      return { rig, factory, resolveIdentityRef: () => resolveIdentity }
    }
    async function runLateIdentity(clockAdvanceTo: number) {
      const { rig, factory, resolveIdentityRef } = heldIdentityRig()
      const pending = rig.make({ sessionFactory: factory }).confirmBackendGone(COORD, START + 5_000)
      await new Promise((r) => setTimeout(r, 10)) // deep flush: clear done, identity ISSUED and held
      const identityIssued = rig.sqlLog.some((sql) => sql.includes('pg_stat_activity'))
      assert.equal(identityIssued, true, 'identity query must actually be observed')
      rig.clock.now = clockAdvanceTo // absolute deadline reached/passed; timer NOT fired
      resolveIdentityRef()([]) // late EMPTY rows
      const result = await pending
      return { rig, result }
    }
    it('late EMPTY identity rows at the EXACT deadline => UNPROVEN, never GONE', async () => {
      const { rig, result } = await runLateIdentity(START + 5_000)
      assert.notEqual(result.kind, 'GONE')
      assert.equal(result.kind, 'UNPROVEN')
      if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_TIMEOUT')
      assert.equal(rig.timers.allCancelled(), true)
    })
    it('late EMPTY identity rows PAST the deadline => UNPROVEN, never GONE', async () => {
      const { result } = await runLateIdentity(START + 6_000)
      assert.notEqual(result.kind, 'GONE')
      assert.equal(result.kind, 'UNPROVEN')
      if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_TIMEOUT')
    })
    it('factory completion consuming the budget issues NO clear-snapshot', async () => {
      const rig = makeRig(() => [])
      let resolveFactory!: (value: { ok: true; session: T15EMonitorQuerySession; info: unknown }) => void
      const heldFactory: T15EMonitorSessionFactory = () =>
        new Promise((resolve) => { resolveFactory = resolve as typeof resolveFactory })
      const pending = rig.make({ sessionFactory: heldFactory }).confirmBackendGone(COORD, START + 5_000)
      await new Promise((r) => setTimeout(r, 10))
      rig.clock.now = START + 6_000 // budget consumed while the factory was pending
      resolveFactory({
        ok: true,
        session: { async query(sql: string) { rig.sqlLog.push(sql); return [] } },
        info: { monitorBackend: MONITOR_BACKEND, cluster: CLUSTER },
      })
      const result = await pending
      assert.equal(result.kind, 'UNPROVEN')
      if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_TIMEOUT')
      assert.equal(rig.sqlLog.length, 0, 'no clear-snapshot (and no identity) after budget consumption')
    })
    it('clear-snapshot completion consuming the budget issues NO identity query', async () => {
      const rig = makeRig(() => [])
      let resolveClear!: (value: unknown) => void
      const factory: T15EMonitorSessionFactory = async () => ({
        ok: true,
        session: {
          query(sql: string) {
            rig.sqlLog.push(sql)
            if (sql === T15E_MONITOR_CLEAR_SNAPSHOT_SQL) {
              return new Promise<unknown>((resolve) => { resolveClear = resolve })
            }
            return Promise.resolve([])
          },
        },
        info: { monitorBackend: MONITOR_BACKEND, cluster: CLUSTER },
      })
      const pending = rig.make({ sessionFactory: factory }).confirmBackendGone(COORD, START + 5_000)
      await new Promise((r) => setTimeout(r, 10))
      assert.equal(rig.sqlLog[0], T15E_MONITOR_CLEAR_SNAPSHOT_SQL, 'clear was issued and is held')
      rig.clock.now = START + 6_000 // budget consumed while clear was pending
      resolveClear([])
      const result = await pending
      assert.equal(result.kind, 'UNPROVEN')
      if (result.kind === 'UNPROVEN') assert.equal(result.category, 'T15E_MONITOR_TIMEOUT')
      assert.equal(
        rig.sqlLog.some((sql) => sql.includes('pg_stat_activity')),
        false,
        'no identity query after budget consumption',
      )
      assert.equal(rig.timers.allCancelled(), true)
    })
  })
  
