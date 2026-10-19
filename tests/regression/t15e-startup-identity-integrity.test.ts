// Task112 startup-identity integrity — PURE parsing/binding/read-workflow
// helpers plus HONEST STATIC producer call-site contracts. NOT behavioral
// startup proof: no pg_ctl/fs effects run here. Corrects Task111 overclaims:
// a changed pidfile PID alone was never sufficient reuse detection (same PID
// + new start must fail via the timestamp), and observed file identity is
// NOT hostile-process proof (OS PID-reuse limits remain).
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseOwnedPostmasterPidIdentity,
  verifyT15EObservedStartupBinding,
  boundedOwnedRead,
} from '../support/native/postgres-instance'

const ALLOC = Object.freeze({ dataDir: '/owned-tmp/business-test-x/data', databasePort: 20111 })
const VALID_PIDFILE =
  '4242\n' +
  `${ALLOC.dataDir}\n` +
  '1700000000\n' +
  `${ALLOC.databasePort}\n` +
  "/tmp/pg-socket\n" +
  '127.0.0.1\n' +
  '5\n' +
  'ready\n'

describe('parseOwnedPostmasterPidIdentity (strict, no permissive parsing)', () => {
  it('parses PID, canonical data-directory, start-time, and port lines', () => {
    const parsed = parseOwnedPostmasterPidIdentity(VALID_PIDFILE, ALLOC)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.deepEqual({ ...parsed.identity }, {
      postmasterPid: 4242,
      dataDirectory: ALLOC.dataDir,
      startTimeEpochSeconds: 1700000000,
      port: ALLOC.databasePort,
    })
  })

  it('rejects malformed PID/start-time/port values including trailing junk and non-positives', () => {
    const bad = [
      { content: `0\n${ALLOC.dataDir}\n1700000000\n${ALLOC.databasePort}\n`, reason: 'MALFORMED_PID' },
      { content: `-1\n${ALLOC.dataDir}\n1700000000\n${ALLOC.databasePort}\n`, reason: 'MALFORMED_PID' },
      { content: `4242x\n${ALLOC.dataDir}\n1700000000\n${ALLOC.databasePort}\n`, reason: 'MALFORMED_PID' },
      { content: ` 4242\n${ALLOC.dataDir}\n1700000000\n${ALLOC.databasePort}\n`, reason: 'MALFORMED_PID' },
      { content: `4242\n${ALLOC.dataDir}\nabc\n${ALLOC.databasePort}\n`, reason: 'MALFORMED_START_TIME' },
      { content: `4242\n${ALLOC.dataDir}\n0\n${ALLOC.databasePort}\n`, reason: 'MALFORMED_START_TIME' },
      { content: `4242\n${ALLOC.dataDir}\n1700000000\n20 111\n`, reason: 'MALFORMED_PORT' },
      { content: `4242\n${ALLOC.dataDir}\n`, reason: 'MISSING' },
      { content: '', reason: 'MISSING' },
    ] as const
    for (const { content, reason } of bad) {
      const parsed = parseOwnedPostmasterPidIdentity(content, ALLOC)
      assert.equal(parsed.ok, false, JSON.stringify(content))
      if (!parsed.ok) assert.equal(parsed.reason, reason, JSON.stringify(content))
    }
  })

  it('validates the data directory and port against the allocation before publication', () => {
    const dir = parseOwnedPostmasterPidIdentity(VALID_PIDFILE.replace(ALLOC.dataDir, '/somewhere/else'), ALLOC)
    assert.equal(dir.ok, false)
    if (!dir.ok) assert.equal(dir.reason, 'DIR_MISMATCH')
    const port = parseOwnedPostmasterPidIdentity(VALID_PIDFILE.replace(String(ALLOC.databasePort), '5432'), ALLOC)
    assert.equal(port.ok, false)
    if (!port.ok) assert.equal(port.reason, 'PORT_MISMATCH')
  })
})

describe('verifyT15EObservedStartupBinding (full-generation comparison)', () => {
  const OBSERVED = Object.freeze({
    dataDir: ALLOC.dataDir,
    databasePort: ALLOC.databasePort,
    postmasterPid: 4242,
    startTimeEpochSeconds: 1700000000,
  })
  const SAME = Object.freeze({
    postmasterPid: 4242,
    dataDirectory: OBSERVED.dataDir,
    startTimeEpochSeconds: 1700000000,
    port: OBSERVED.databasePort,
  })

  it('binds only when every generation field matches', () => {
    assert.equal(verifyT15EObservedStartupBinding({ observed: OBSERVED, pidfileNow: SAME, probe: null }).ok, true)
  })

  it('fails on same PID with a NEW start (changed timestamp), dir, or port', () => {
    // Task111 overclaim corrected: PID equality alone is NOT reuse safety.
    for (const pidfileNow of [
      null,
      { ...SAME, postmasterPid: 9999 },
      { ...SAME, startTimeEpochSeconds: 1700000001 }, // same PID, new start
      { ...SAME, dataDirectory: '/other/data' },
      { ...SAME, port: 5432 },
    ]) {
      assert.equal(verifyT15EObservedStartupBinding({ observed: OBSERVED, pidfileNow, probe: null }).ok, false, JSON.stringify(pidfileNow))
    }
  })
})

describe('boundedOwnedRead (deadline-owned read workflow, fake clock/timers)', () => {
  const makeArm = () => {
    const armed: Array<{ fired: Promise<void>; cancel(): void; cancelled: boolean }> = []
    return {
      armed,
      arm: (ms: number) => {
        let release: () => void = () => undefined
        const fired = new Promise<void>((resolve) => { release = resolve })
        const timer = { fired, cancelled: false, cancel() { timer.cancelled = true } }
        armed.push(timer)
        setTimeout(release, Math.max(ms, 0)) // the owned timer really fires
        return timer
      },
    }
  }

  it('never invokes the read when the deadline is already at/past or non-finite', async () => {
    for (const deadline of [5_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      let invoked = false
      const { arm } = makeArm()
      const result = await boundedOwnedRead({
        deadlineEpochMs: deadline,
        clock: { nowEpochMs: () => 5_000 },
        arm,
        read: () => { invoked = true; return Promise.resolve('value') },
      })
      assert.equal(result.ok, false)
      assert.equal(invoked, false, `deadline=${String(deadline)}`)
    }
  })

  it('returns DEADLINE when the read hangs until the timer fires; read result discarded honestly', async () => {
    const { arm } = makeArm()
    const result = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: { nowEpochMs: () => 1_000 },
      arm,
      read: () => new Promise<string>(() => undefined), // hangs forever
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_DEADLINE')
  })

  it('rejects a read that completes only after the clock passed the deadline (post-read recheck)', async () => {
    const { arm } = makeArm()
    let clockNow = 1_000
    const result = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: { nowEpochMs: () => clockNow },
      arm,
      read: () => new Promise<string>((resolve) => {
        clockNow = 6_000 // the read "completes" but the world moved past the deadline
        resolve('late value')
      }),
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_DEADLINE')
  })

  it('maps a throwing read to READ_FAILED and cancels the timer on success', async () => {
    const { armed, arm } = makeArm()
    const failed = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: { nowEpochMs: () => 1_000 },
      arm,
      read: () => Promise.reject(new Error('read blew up')),
    })
    assert.equal(failed.ok, false)
    if (!failed.ok) assert.equal(failed.category, 'T15E_STDIN_READ_FAILED')
    const ok = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: { nowEpochMs: () => 1_000 },
      arm,
      read: () => Promise.resolve(42),
    })
    assert.deepEqual(ok, { ok: true, value: 42 })
    assert.equal(armed.every((timer) => timer.cancelled), true)
  })
})

describe('producer startup call-site contracts (static, not behavioral proof)', () => {
  const source = readFileSync(new URL('../support/native/postgres-instance.ts', import.meta.url), 'utf8')
  const slice = (from: string, to: string): string => {
    const start = source.indexOf(from)
    assert.ok(start >= 0, `anchor not found: ${from}`)
    const end = source.indexOf(to, start)
    assert.ok(end >= 0, `anchor not found: ${to}`)
    return source.slice(start, end)
  }

  it('resolves the live exact allocation before any config/fs/pg_ctl effect and validates handle fields', () => {
    const body = slice('export async function startPostgres(', 'export function parseOwnedPostmasterPidIdentity')
    const allocation = body.indexOf('t15eOwnedRuntimeAllocations.get(runtime)')
    const config = body.indexOf('writeOwnedPostgresConfigAt(')
    const pgctl = body.indexOf("'pg_ctl'")
    assert.ok(allocation >= 0 && config > allocation, 'allocation resolved before config write')
    assert.ok(pgctl > allocation, 'allocation resolved before pg_ctl')
    assert.match(body, /t15eAllocationLive\.get\(runtime\) !== true/)
    assert.match(body, /runtime\.paths\.rootDir !== allocation\.rootDir/)
    assert.match(body, /runtime\.ports\.databasePort !== allocation\.databasePort/)
  })

  it('uses canonical allocation paths/port throughout IO/start/read and rechecks the same record before publication', () => {
    const body = slice('export async function startPostgres(', 'export function parseOwnedPostmasterPidIdentity')
    assert.match(body, /writeOwnedPostgresConfigAt\(allocation\.dataDir, allocation\.databasePort/)
    assert.match(body, /'-D', allocation\.dataDir/)
    assert.match(body, /allocation\.logsDir/)
    assert.match(body, /readOwnedPostmasterIdentity\(allocation\.dataDir/)
    // Concurrent-replacement guard: the SAME frozen record must still be current.
    assert.match(body, /t15eOwnedRuntimeAllocations\.get\(runtime\) !== allocation/)
    assert.match(body, /startTimeEpochSeconds: identity\.startTimeEpochSeconds/)
  })

  it('probe bounds BOTH identity reads with the captured deadline before spawn and before publication', () => {
    const probe = slice('async function probeOwnedClusterIdentity(', 'void probeOwnedClusterIdentity')
    const firstRead = probe.indexOf('boundedOwnedRead(')
    const secondRead = probe.indexOf('boundedOwnedRead(', firstRead + 1)
    const spawnAt = probe.indexOf('spawn(')
    assert.ok(firstRead >= 0 && secondRead > firstRead, 'two bounded identity reads')
    assert.ok(spawnAt > firstRead && spawnAt > secondRead === false ? spawnAt > firstRead : spawnAt > firstRead, 'a read precedes spawn')
    assert.ok(spawnAt > firstRead, 'pre-spawn read precedes spawn')
    assert.ok(probe.indexOf('verifyT15EObservedStartupBinding', spawnAt) > 0, 'post-run binding before final publication')
    assert.doesNotMatch(probe, /readPostmasterPid\(/)
    assert.doesNotMatch(probe, /runtime\.postmasterPid/)
  })
})
