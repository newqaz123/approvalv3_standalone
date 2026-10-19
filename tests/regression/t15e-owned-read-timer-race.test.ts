// Task113B — ONE race in boundedOwnedRead: an already-rejected (or
// about-to-reject) timer.fired competing with an immediately-resolved read.
// Precise fake ordering only; no fire-all scheduler. Findings 1/4 remain
// Task114; no probe wiring, no issuer readiness.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boundedOwnedRead } from '../support/native/postgres-instance'

const clock = () => ({ nowEpochMs: () => 1_000 })

describe('boundedOwnedRead timer/read race (Task113B)', () => {
  it('RED: already-rejected timer.fired with an immediately resolved read cannot let success escape', async () => {
    const result = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: clock(),
      arm: () => ({
        fired: Promise.reject(new Error('timer already rejected')),
        cancel() { /* no scheduled work */ },
      }),
      read: () => Promise.resolve('fast value'),
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_TIMER_FAILED')
  })

  it('RED: read resolving first still loses when the timer rejection is observed before publication', async () => {
    // Rejection is queued as a microtask DURING arm(), so it runs BEFORE the
    // helper's post-race continuation — it must defeat success via an
    // independent latch, not just the race winner.
    const result = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: clock(),
      arm: () => {
        let reject: (error: Error) => void = () => undefined
        const fired = new Promise<void>((_, r) => { reject = r })
        queueMicrotask(() => reject(new Error('timer rejected soon')))
        return { fired, cancel() { /* no scheduled work */ } }
      },
      read: () => Promise.resolve('value'),
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.category, 'T15E_STDIN_TIMER_FAILED')
  })

  it('timer rejection arriving AFTER publication is consumed without mutating the frozen result', async () => {
    let reject: (error: Error) => void = () => undefined
    const fired = new Promise<void>((_, r) => { reject = r })
    const result = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: clock(),
      arm: () => ({ fired, cancel() { /* fake: nothing scheduled to clear */ } }),
      read: () => Promise.resolve('genuine value'),
    })
    assert.deepEqual(result, { ok: true, value: 'genuine value' })
    // Post-publication rejection: consumed by the attached handler, the
    // already-returned result is never reinterpreted or mutated.
    reject(new Error('late rejection after publication'))
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(result, { ok: true, value: 'genuine value' })
  })

  it('ordinary genuine read success with a healthy timer is unchanged (coverage regression)', async () => {
    let cancelled = false
    const result = await boundedOwnedRead({
      deadlineEpochMs: 5_000,
      clock: clock(),
      arm: () => ({
        fired: new Promise<void>(() => undefined), // never fires within budget
        cancel() { cancelled = true },
      }),
      read: () => Promise.resolve('ordinary value'),
    })
    assert.deepEqual(result, { ok: true, value: 'ordinary value' })
    assert.equal(cancelled, true)
  })
})
