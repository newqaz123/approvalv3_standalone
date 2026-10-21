// Task111 producer-private startup binding — PURE identity-comparison logic
// plus HONEST STATIC producer call-site contracts ONLY. These are NOT
// behavioral authenticated-startup proof: no start path, spawn, or DB is
// exercised. The private start path remains untested here by design (it
// requires real pg_ctl); the contracts pin where the private observed record
// is written, dropped, and consumed.
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { verifyT15EObservedStartupBinding } from '../support/native/postgres-instance'

// Task112 correction: binding compares the FULL generation (PID, dir, start
// timestamp, port) — same PID with a new start MUST fail. The old
// PID-only comparison was an overclaim and is corrected here.
const OBSERVED = Object.freeze({
  dataDir: '/owned-tmp/business-test-x/data',
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

describe('verifyT15EObservedStartupBinding (pure comparison logic only)', () => {
  it('binds only when the pidfile still shows the observed generation and SQL fields match', () => {
    assert.deepEqual(
      verifyT15EObservedStartupBinding({
        observed: OBSERVED,
        pidfileNow: IDENTITY,
        probe: { dataDirectory: OBSERVED.dataDir, databasePort: OBSERVED.databasePort },
      }),
      { ok: true },
    )
  })

  it('rejects a missing or changed pidfile generation (stopped/restarted/reused cluster)', () => {
    for (const pidfileNow of [null, { ...IDENTITY, postmasterPid: 9999 }, { ...IDENTITY, startTimeEpochSeconds: 1700000001 }]) {
      assert.equal(
        verifyT15EObservedStartupBinding({ observed: OBSERVED, pidfileNow, probe: null }).ok,
        false,
        `pidfile=${JSON.stringify(pidfileNow)}`,
      )
    }
  })

  it('rejects SQL-observable divergence from the observed startup record', () => {
    assert.equal(
      verifyT15EObservedStartupBinding({
        observed: OBSERVED,
        pidfileNow: IDENTITY,
        probe: { dataDirectory: '/somewhere/else/data', databasePort: 20111 },
      }).ok,
      false,
    )
    assert.equal(
      verifyT15EObservedStartupBinding({
        observed: OBSERVED,
        pidfileNow: IDENTITY,
        probe: { dataDirectory: OBSERVED.dataDir, databasePort: 5432 },
      }).ok,
      false,
    )
  })

  it('rejects a malformed observed PID as not-owned rather than mismatch', () => {
    const result = verifyT15EObservedStartupBinding({
      observed: { ...OBSERVED, postmasterPid: Number.NaN },
      pidfileNow: IDENTITY,
      probe: null,
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_NOT_OWNED')
  })
})

describe('producer private startup-record call-site contracts (static)', () => {
  const source = readFileSync(new URL('../support/native/postgres-instance.ts', import.meta.url), 'utf8')
  const slice = (from: string, to: string): string => {
    const start = source.indexOf(from)
    assert.ok(start >= 0, `anchor not found: ${from}`)
    const end = source.indexOf(to, start)
    assert.ok(end >= 0, `anchor not found: ${to}`)
    return source.slice(start, end)
  }

  it('records observed startup identity ONLY inside the internally owned start path', () => {
    const startBody = slice('export async function startPostgres(', 'export function parseOwnedPostmasterPidIdentity')
    assert.match(startBody, /t15eObservedStartup\.set\(/)
    // Gated on the private allocation registry and liveness, sourced from the
    // internally read pidfile, never from runtime.postmasterPid.
    assert.match(startBody, /t15eOwnedRuntimeAllocations\.get\(runtime\)/)
    assert.match(startBody, /t15eAllocationLive\.get\(runtime\)/) // gated on liveness (throw-form)
    const pidRead = startBody.indexOf('readOwnedPostmasterIdentity(')
    const record = startBody.indexOf('t15eObservedStartup.set(')
    assert.ok(pidRead >= 0 && record > pidRead, 'record written after the internal pid read')
    // The record is built from allocation fields + the internally read pid —
    // the observed object never references the mutable runtime mirror.
    const setAt = startBody.indexOf('t15eObservedStartup.set(runtime, Object.freeze({')
    const setEnd = startBody.indexOf('}))', setAt)
    assert.ok(setAt >= 0 && setEnd > setAt)
    assert.doesNotMatch(startBody.slice(setAt, setEnd), /runtime\./, 'observed record must not read runtime fields')
  })

  it('drops observed startup state synchronously when revocation begins', () => {
    const revokeBody = slice('export function revokeOwnedRuntimeT15ECapabilities(', '/** Probe-only.')
    assert.match(revokeBody, /t15eObservedStartup\.delete\(handle\)/)
  })

  it('the private probe binds to the observed startup record, re-reads the owned pidfile, and never trusts runtime fields', () => {
    const probeBody = slice('async function probeOwnedClusterIdentity(', 'void probeOwnedClusterIdentity')
    assert.match(probeBody, /t15eObservedStartup\.get\(handle\)/)
    // The old allocation null-PID blocker is gone; the STRICTER observed-record
    // requirement replaces it (undefined observed record => NOT_OWNED).
    assert.doesNotMatch(probeBody, /record\.postmasterPid === null/)
    // runtime.postmasterPid is never an authority inside the probe.
    assert.doesNotMatch(probeBody, /runtime\.postmasterPid/)
    // Pre-run and post-run bounded identity reads (Task112: full identity via
    // readOwnedPostmasterIdentity, deadline-bounded by boundedOwnedRead).
    const reads = probeBody.match(/readOwnedPostmasterIdentity\(/g) ?? []
    assert.ok(reads.length >= 2, `expected >=2 internal identity reads, got ${reads.length}`)
    // Liveness re-checked after the awaited child run.
    assert.ok(probeBody.indexOf('t15eAllocationLive.get(handle)') < probeBody.lastIndexOf('t15eAllocationLive.get(handle)'))
    // Verified data is compared against BOTH allocation and observed identity.
    assert.match(probeBody, /matchT15EPrivateProbe\(/)
    assert.match(probeBody, /verifyT15EObservedStartupBinding\(/)
    // Still uncalled, no mint/DDL, no PID claim in SQL.
    assert.match(source, /void probeOwnedClusterIdentity/)
    assert.doesNotMatch(probeBody, /CREATE ROLE|mint|grant/i)
  })

  it('keeps the canonical allocation frozen with a null postmasterPid (observed identity is a distinct record)', () => {
    assert.match(source, /postmasterPid: null,\n      \}\),\n    \)/)
  })
})
