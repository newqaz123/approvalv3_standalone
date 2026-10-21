// Task113 — boundedOwnedRead containment + deadline ownership (Task112
// findings 2/3 ONLY). Pure helper workflow tests with fake clock/timers plus
// static probe gate contracts (the private probe itself cannot be exercised
// behaviorally). Findings 1 (startup-record freshness) and 4 (numeric/finite
// safe bounds) remain Task114 — NOT claimed here. No authority export, no
// test setter. The race NEVER cancels the filesystem operation: it only
// clears the real timer; a late read result is discarded by the race.
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boundedOwnedRead } from '../support/native/postgres-instance'

const makeArm = () => {
  const armed: Array<{ fired: Promise<void>; cancel(): void; cancelled: boolean; firedFlag: boolean }> = []
  return {
    armed,
    arm: (ms: number) => {
      let release: () => void = () => undefined
      const fired = new Promise<void>((resolve) => { release = resolve })
      const timer = {
        fired,
        cancelled: false,
        firedFlag: false,
        cancel() { timer.cancelled = true },
      }
      armed.push(timer)
      setTimeout(() => { timer.firedFlag = true; release() }, Math.max(ms, 0))
      return timer
    },
  }
}

describe('boundedOwnedRead deadline ownership and containment (Task113)', () => {
  it('uses the deadline captured at entry: mutating input.deadline cannot extend the budget', async () => {
    const { arm } = makeArm()
    let clockNow = 1_000
    const input = {
      deadlineEpochMs: 5_000,
      clock: { nowEpochMs: () => clockNow },
      arm,
      read: () => new Promise<string>((resolve) => {
        clockNow = 6_000 // clock passes the ORIGINAL deadline
        input.deadlineEpochMs = 9_000 // attacker/caller mutates the input object
        resolve('late value')
      }),
    }
    const result = await boundedOwnedRead(input)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_DEADLINE')
    // Captured input cannot be extended even at the post-read gate.
    assert.equal(input.deadlineEpochMs, 9_000) // untouched caller object
  })

  it('contains a synchronously throwing arm as a fixed failure with no timer effects', async () => {
    let readInvoked = false
    const result = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: { nowEpochMs: () => 1_000 },
      arm: () => { throw new Error('arm threw') },
      read: () => { readInvoked = true; return Promise.resolve('x') },
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_TIMER_FAILED')
    assert.equal(readInvoked, false)
  })

  it('contains a synchronously THROWING read (not Promise.reject) as READ_FAILED and still cancels the armed timer', async () => {
    const { armed, arm } = makeArm()
    const result = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: { nowEpochMs: () => 1_000 },
      arm,
      read: () => { throw new Error('read threw synchronously') },
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_READ_FAILED')
    assert.equal(armed.every((timer) => timer.cancelled), true)
  })

  it('maps a rejecting timer.fired to a fixed failure instead of escaping', async () => {
    let cancelAttempted = false
    const result = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: { nowEpochMs: () => 1_000 },
      arm: () => {
        let reject: (error: Error) => void = () => undefined
        const fired = new Promise<void>((_, r) => { reject = r })
        queueMicrotask(() => reject(new Error('fired rejected')))
        return { fired, cancel() { cancelAttempted = true } }
      },
      read: () => new Promise<string>(() => undefined), // never settles
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_TIMER_FAILED')
    assert.equal(cancelAttempted, true)
  })

  it('a throwing cancel after a successful read DEFEATS success with a fixed failure', async () => {
    const result = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: { nowEpochMs: () => 1_000 },
      arm: () => ({
        fired: new Promise<void>(() => undefined),
        cancel() { throw new Error('cancel threw') },
      }),
      read: () => Promise.resolve('fast value'),
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_TIMER_FAILED')
  })

  it('consumes a deferred read rejection after the deadline won, leaving no active timer', async () => {
    const { armed, arm } = makeArm()
    let rejectRead: (error: Error) => void = () => undefined
    const result = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: { nowEpochMs: () => 1_000 },
      arm,
      read: () => new Promise<string>((_, reject) => { rejectRead = reject }),
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_DEADLINE')
    rejectRead(new Error('late rejection after deadline')) // must be consumed
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    assert.equal(armed.every((timer) => timer.firedFlag || timer.cancelled), true)
  })
})

describe('probe own post-await deadline gates (static contract; private probe not behaviorally exercisable)', () => {
  it('gates after BOTH bounded reads: before spawn and before final publication', () => {
    const source = readFileSync(new URL('../support/native/postgres-instance.ts', import.meta.url), 'utf8')
    const start = source.indexOf('async function probeOwnedClusterIdentity(')
    assert.ok(start >= 0)
    const probe = source.slice(start, source.indexOf('void probeOwnedClusterIdentity', start))
    const gates = [...probe.matchAll(/deadlineEpochMs > clock\.nowEpochMs\(\)/g)].map((m) => m.index ?? -1)
    assert.ok(gates.length >= 2, `expected >=2 own gates, got ${gates.length}`)
    const spawnAt = probe.indexOf('spawn(')
    const matchedAt = probe.indexOf('const matched =')
    assert.ok(spawnAt > 0 && matchedAt > spawnAt, 'probe structure anchors')
    assert.ok(gates[0] < spawnAt, 'first gate precedes spawn')
    assert.ok(gates[gates.length - 1] > spawnAt && gates[gates.length - 1] < matchedAt, 'final gate precedes publication checks')
  })
})
