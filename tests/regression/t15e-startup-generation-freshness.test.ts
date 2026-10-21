// Task114 — Task112 findings 1 (probe observed-record freshness) and 4
// (strict numeric bounds). Pure helper tests + STATIC probe call-site
// contracts. The private producer start path is NOT executed: regex contracts
// do not prove the production path behaviorally. PG 15/16 pidfile format
// remains synthetic compatibility only; no live query permission. Note: the
// Task113B helper result is ordinary data — tests verify NON-mutation, not
// "freezing".
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseOwnedPostmasterPidIdentity,
  verifyT15EObservedStartupBinding,
  verifyT15EObservedStartupFreshness,
} from '../support/native/postgres-instance'

const ALLOC = Object.freeze({ dataDir: '/owned-tmp/business-test-x/data', databasePort: 20111 })
const pidfileWith = (pid: string, start = '1700000000', port = String(ALLOC.databasePort)) =>
  `${pid}\n${ALLOC.dataDir}\n${start}\n${port}\n`

describe('parseOwnedPostmasterPidIdentity strict numeric bounds (finding 4)', () => {
  it('accepts valid edge values', () => {
    assert.equal(parseOwnedPostmasterPidIdentity(pidfileWith('1', '1', '1'), { ...ALLOC, databasePort: 1 }).ok, true)
    assert.equal(parseOwnedPostmasterPidIdentity(pidfileWith('2147483647', String(Number.MAX_SAFE_INTEGER), '65535'), { ...ALLOC, databasePort: 65535 }).ok, true)
  })

  it('rejects huge digits, MAX_SAFE_INTEGER rounding aliases, and PID overflow', () => {
    for (const pid of ['99999999999999999999', '9007199254740993', '2147483648', '9007199254740992' + '0']) {
      const parsed = parseOwnedPostmasterPidIdentity(pidfileWith(pid), ALLOC)
      assert.equal(parsed.ok, false, pid)
      if (!parsed.ok) assert.equal(parsed.reason, 'MALFORMED_PID', pid)
    }
  })

  it('rejects unsafe timestamps and out-of-range ports', () => {
    for (const start of ['9007199254740993', '99999999999999999999']) {
      const parsed = parseOwnedPostmasterPidIdentity(pidfileWith('4242', start), ALLOC)
      assert.equal(parsed.ok, false, start)
      if (!parsed.ok) assert.equal(parsed.reason, 'MALFORMED_START_TIME', start)
    }
    for (const port of ['65536', '0', '9007199254740993']) {
      const parsed = parseOwnedPostmasterPidIdentity(pidfileWith('4242', '1700000000', port), ALLOC)
      assert.equal(parsed.ok, false, port)
      if (!parsed.ok) assert.equal(parsed.reason, 'MALFORMED_PORT', port)
    }
  })
})

describe('verifyT15EObservedStartupBinding rejects unsafe injected values (finding 4)', () => {
  const OBSERVED = Object.freeze({
    dataDir: ALLOC.dataDir,
    databasePort: 20111,
    postmasterPid: 4242,
    startTimeEpochSeconds: 1700000000,
  })
  const IDENTITY = Object.freeze({
    postmasterPid: 4242,
    dataDirectory: OBSERVED.dataDir,
    startTimeEpochSeconds: 1700000000,
    port: OBSERVED.databasePort,
  })

  it('still binds a fully valid generation', () => {
    assert.equal(verifyT15EObservedStartupBinding({ observed: OBSERVED, pidfileNow: IDENTITY, probe: null }).ok, true)
  })

  it('rejects unsafe/non-finite OBSERVED values as not-owned', () => {
    for (const observed of [
      { ...OBSERVED, postmasterPid: 9007199254740993 },
      { ...OBSERVED, postmasterPid: Number.POSITIVE_INFINITY },
      { ...OBSERVED, startTimeEpochSeconds: 9007199254740993 },
      { ...OBSERVED, databasePort: 65536 },
      { ...OBSERVED, databasePort: 9007199254740993 },
    ]) {
      const result = verifyT15EObservedStartupBinding({ observed, pidfileNow: IDENTITY, probe: null })
      assert.equal(result.ok, false, JSON.stringify(observed))
      if (!result.ok) assert.equal(result.category, 'T15E_STDIN_NOT_OWNED')
    }
  })

  it('rejects unsafe pidfile-generation values as mismatch', () => {
    for (const pidfileNow of [
      { ...IDENTITY, postmasterPid: 9007199254740993 },
      { ...IDENTITY, postmasterPid: Number.POSITIVE_INFINITY },
      { ...IDENTITY, startTimeEpochSeconds: 9007199254740993 },
      { ...IDENTITY, port: 65536 },
    ]) {
      assert.equal(verifyT15EObservedStartupBinding({ observed: OBSERVED, pidfileNow, probe: null }).ok, false, JSON.stringify(pidfileNow))
    }
    assert.equal(
      verifyT15EObservedStartupBinding({ observed: OBSERVED, pidfileNow: IDENTITY, probe: { dataDirectory: OBSERVED.dataDir, databasePort: 9007199254740993 } }).ok,
      false,
    )
  })
})

describe('verifyT15EObservedStartupFreshness (pure injected-identity comparator, finding 1)', () => {
  const record = Object.freeze({ postmasterPid: 4242 })

  it('accepts only the EXACT captured record identity while live', () => {
    assert.deepEqual(verifyT15EObservedStartupFreshness({ current: record, captured: record, live: true }), { ok: true })
  })

  it('a concurrent start replacing the record defeats the old probe even with matching fields', () => {
    const replacement = Object.freeze({ ...record }) // structurally identical, different object
    const result = verifyT15EObservedStartupFreshness({ current: replacement, captured: record, live: true })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_NOT_OWNED')
    for (const current of [undefined, null]) {
      assert.equal(verifyT15EObservedStartupFreshness({ current, captured: record, live: true }).ok, false)
    }
    assert.equal(verifyT15EObservedStartupFreshness({ current: record, captured: record, live: false }).ok, false)
  })

  it('Task114B: absent captures (null and undefined) are invalid even when current matches exactly', () => {
    // Pure-helper contract defect: null/null and undefined/undefined used to
    // pass reference equality. NOT a demonstrated production bypass — the
    // private probe never calls this helper (it uses its stillCurrent closure
    // whose guards already reject missing records).
    for (const absent of [null, undefined]) {
      const result = verifyT15EObservedStartupFreshness({ current: absent, captured: absent, live: true })
      assert.equal(result.ok, false, `captured=${String(absent)}`)
      if (!result.ok) assert.equal(result.category, 'T15E_STDIN_NOT_OWNED')
    }
  })

  it('Task114B: primitive captures are rejected even when identical — the contract is a record object', () => {
    for (const primitive of ['record', 4242, true]) {
      const result = verifyT15EObservedStartupFreshness({ current: primitive, captured: primitive, live: true })
      assert.equal(result.ok, false, `captured=${String(primitive)}`)
      if (!result.ok) assert.equal(result.category, 'T15E_STDIN_NOT_OWNED')
    }
  })
})

describe('probe freshness call-site obligations (STATIC contract — not behavioral proof)', () => {
  it('rechecks the exact observed record after every await, before spawn and publication', () => {
    const source = readFileSync(new URL('../support/native/postgres-instance.ts', import.meta.url), 'utf8')
    const start = source.indexOf('async function probeOwnedClusterIdentity(')
    assert.ok(start >= 0)
    const probe = source.slice(start, source.indexOf('void probeOwnedClusterIdentity', start))
    // The exact-record identity comparison lives in one closure, invoked at
    // every awaited boundary — assert the definition AND its call sites.
    assert.match(probe, /t15eObservedStartup\.get\(handle\) === observed/)
    const checks = [...probe.matchAll(/!stillCurrent\(\)/g)].map((m) => m.index ?? -1)
    assert.ok(checks.length >= 3, `expected >=3 freshness rechecks, got ${checks.length}`)
    const spawnAt = probe.indexOf('spawn(')
    const lastAwaitAt = probe.lastIndexOf('boundedOwnedRead(')
    const publicationAt = probe.indexOf('matchT15EPrivateProbe(')
    assert.ok(spawnAt > 0 && lastAwaitAt > spawnAt && publicationAt > lastAwaitAt, 'probe anchors')
    assert.ok(checks[0] < spawnAt, 'freshness recheck precedes spawn')
    assert.ok(checks[checks.length - 1] > lastAwaitAt && checks[checks.length - 1] < publicationAt, 'final recheck after last read await, before publication')
  })
})
