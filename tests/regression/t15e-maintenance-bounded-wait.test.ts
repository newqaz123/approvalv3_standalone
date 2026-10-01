import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  runT15EMaintenanceBoundedWait as wait,
  type T15EMaintenanceWaitToken,
} from '../support/native/t15e-maintenance-bounded-wait'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function drain() { for (let i = 0; i < 8; i++) await Promise.resolve() }
function opaque() { const p = Proxy.revocable({}, {}); p.revoke(); return p.proxy }
function fixture() {
  const fired = deferred()
  const operation = deferred()
  const state = {
    now: 10, failed: false, armed: [] as number[], calls: 0, cancels: 0,
    unsubs: 0, token: null as T15EMaintenanceWaitToken | null,
    listener: null as (() => void) | null,
    onCancel: () => {}, onUnsubscribe: () => {},
  }
  const input = {
    deadlineEpochMs: 100,
    clock: { nowEpochMs: () => state.now },
    scheduleTimer: (ms: number) => {
      state.armed.push(ms)
      return { ms, fired: fired.promise, cancel: () => { state.cancels++; state.onCancel() } }
    },
    failureSource: {
      hasFailure: () => state.failed,
      subscribe: (listener: () => void) => {
        state.listener = listener
        return () => { state.unsubs++; state.onUnsubscribe() }
      },
    },
    operation: (token: T15EMaintenanceWaitToken): void | PromiseLike<void> => {
      state.calls++; state.token = token; return operation.promise
    },
  }
  return { input, state, fired, operation }
}

describe('T15E maintenance bounded wait — fake-only contract', () => {
  it('publishes VALUE only after fencing and independently disposing both owners', async () => {
    const h = fixture()
    const result = wait(h.input)
    await drain()
    assert.equal(h.state.calls, 1)
    assert.equal(h.state.token!.isLive(), true)
    h.operation.resolve()
    const observed = await result
    assert.deepEqual(observed, {
      ok: true, authority: 'NONE', reason: 'VALUE', timerFailed: false,
      cancelFailed: false, unsubscribeFailed: false,
    })
    assert.deepEqual(h.state.armed, [90])
    assert.equal(h.state.cancels, 1)
    assert.equal(h.state.unsubs, 1)
    assert.equal(h.state.token!.isLive(), false)
    assert.ok(Object.isFrozen(observed))
    assert.ok(Object.isFrozen(h.state.token))
  })

  for (const deadline of [NaN, Infinity, 0, -1, 10.5, Number.MAX_SAFE_INTEGER + 1]) {
    it(`rejects invalid deadline ${deadline} before acquiring anything`, async () => {
      const h = fixture(); h.input.deadlineEpochMs = deadline
      assert.equal((await wait(h.input)).reason, 'INPUT_INVALID')
      assert.equal(h.state.calls, 0); assert.deepEqual(h.state.armed, []); assert.equal(h.state.unsubs, 0)
    })
  }
  for (const deadline of [9, 10]) {
    it(`rejects past/exact deadline ${deadline} before subscription or IO`, async () => {
      const h = fixture(); h.input.deadlineEpochMs = deadline
      assert.equal((await wait(h.input)).reason, 'EXPIRED')
      assert.equal(h.state.calls, 0); assert.deepEqual(h.state.armed, []); assert.equal(h.state.unsubs, 0)
    })
  }
  for (const now of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
    it(`rejects unsafe clock sample ${now}`, async () => {
      const h = fixture(); h.state.now = now
      assert.equal((await wait(h.input)).reason, 'CLOCK_FAILED')
      assert.equal(h.state.calls, 0); assert.deepEqual(h.state.armed, [])
    })
  }
  it('contains revoked input and opaque capture/getter errors', async () => {
    assert.equal((await wait(opaque())).reason, 'INPUT_INVALID')
    const h = fixture()
    Object.defineProperty(h.input, 'clock', { get() { throw opaque() } })
    assert.equal((await wait(h.input)).reason, 'INPUT_INVALID')
  })
  it('contains an opaque clock exception without timer or operation', async () => {
    const h = fixture(); h.input.clock.nowEpochMs = () => { throw opaque() }
    assert.equal((await wait(h.input)).reason, 'CLOCK_FAILED')
    assert.equal(h.state.calls, 0); assert.deepEqual(h.state.armed, [])
  })
  it('rejects pre-latched failure before subscription and timer', async () => {
    const h = fixture(); h.state.failed = true
    assert.equal((await wait(h.input)).reason, 'FAILURE_LATCHED')
    assert.equal(h.state.calls, 0); assert.deepEqual(h.state.armed, []); assert.equal(h.state.unsubs, 0)
  })
  it('contains state-probe exceptions', async () => {
    const h = fixture(); h.input.failureSource.hasFailure = () => { throw opaque() }
    assert.equal((await wait(h.input)).reason, 'STATE_FAILED')
    assert.equal(h.state.calls, 0)
  })
  it('fences callback-before-subscribe-return and still disposes its acquired unsubscribe', async () => {
    const h = fixture()
    h.input.failureSource.subscribe = listener => {
      listener()
      return () => { h.state.unsubs++ }
    }
    assert.equal((await wait(h.input)).reason, 'FAILURE_LATCHED')
    assert.equal(h.state.unsubs, 1); assert.equal(h.state.calls, 0); assert.deepEqual(h.state.armed, [])
  })
  it('replays failure set during subscription without callback delivery', async () => {
    const h = fixture()
    h.input.failureSource.subscribe = () => {
      h.state.failed = true
      return () => { h.state.unsubs++ }
    }
    assert.equal((await wait(h.input)).reason, 'FAILURE_LATCHED')
    assert.equal(h.state.unsubs, 1); assert.equal(h.state.calls, 0); assert.deepEqual(h.state.armed, [])
  })
  it('contains partial subscription throws and never claims successful disposal', async () => {
    const h = fixture()
    h.input.failureSource.subscribe = listener => { h.state.listener = listener; throw opaque() }
    const observed = await wait(h.input)
    assert.equal(observed.ok, false); assert.equal(observed.reason, 'SUBSCRIBE_FAILED')
    assert.equal(observed.unsubscribeFailed, true); assert.equal(h.state.calls, 0)
    h.state.listener!(); await drain()
    assert.equal(observed.reason, 'SUBSCRIBE_FAILED')
  })
  it('a pending source event wakes/fences immediately rather than waiting on held timer', async () => {
    const h = fixture(); const result = wait(h.input); await drain()
    assert.equal(h.state.calls, 1)
    h.state.listener!()
    assert.equal(h.state.token!.isLive(), false)
    assert.equal((await result).reason, 'FAILURE_LATCHED')
    assert.equal(h.state.cancels, 1)
    h.operation.reject(opaque()); await drain()
  })
  for (const kind of ['reject', 'resolve'] as const) {
    it(`already-${kind}ed timer prevents operation invocation`, async () => {
      const h = fixture()
      h.input.scheduleTimer = ms => {
        h.state.armed.push(ms)
        return {
          ms, fired: kind === 'reject' ? Promise.reject(opaque()) : Promise.resolve(),
          cancel: () => { h.state.cancels++ },
        }
      }
      const observed = await wait(h.input)
      assert.equal(observed.reason, kind === 'reject' ? 'TIMER_FAILED' : 'EXPIRED')
      assert.equal(observed.timerFailed, kind === 'reject')
      assert.equal(h.state.calls, 0); assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1)
    })
  }
  it('already-rejected genuine Promise subclass is observed before operation IO', async () => {
    class TimerPromise extends Promise<void> {}
    const h = fixture()
    h.input.scheduleTimer = ms => ({
      ms, fired: new TimerPromise((_, reject) => { reject(opaque()) }),
      cancel: () => { h.state.cancels++ },
    })
    const observed = await wait(h.input)
    assert.equal(observed.reason, 'TIMER_FAILED')
    assert.equal(h.state.calls, 0); assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1)
  })
  it('consumes the acquired timer rejection when reading cancel throws', async () => {
    const h = fixture()
    h.input.scheduleTimer = ms => ({
      ms, fired: Promise.reject(opaque()),
      get cancel(): () => void { throw opaque() },
    })
    const observed = await wait(h.input)
    assert.equal(observed.reason, 'SCHEDULER_FAILED')
    assert.equal(observed.cancelFailed, true); assert.equal(observed.timerFailed, true)
    assert.equal(h.state.calls, 0); assert.equal(h.state.unsubs, 1)
    await drain()
  })
  it('attempts acquired cancel even when reading fired throws', async () => {
    const h = fixture()
    h.input.scheduleTimer = ms => ({
      ms, get fired(): Promise<void> { throw opaque() },
      cancel: () => { h.state.cancels++ },
    })
    const observed = await wait(h.input)
    assert.equal(observed.reason, 'SCHEDULER_FAILED')
    assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1); assert.equal(h.state.calls, 0)
  })
  it('captures/disposes a returned timer even when scheduler synchronously delivers failure', async () => {
    const h = fixture()
    h.input.scheduleTimer = ms => {
      h.state.listener!()
      return { ms, fired: h.fired.promise, cancel: () => { h.state.cancels++ } }
    }
    const observed = await wait(h.input)
    assert.equal(observed.reason, 'FAILURE_LATCHED')
    assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1); assert.equal(h.state.calls, 0)
    h.fired.reject(opaque()); await drain()
    assert.equal(observed.timerFailed, false) // Late rejection is consumed, not retrospectively recorded.
  })
  it('owns callable timer fields and consumes rejection with exactly-once disposal', async () => {
    const h = fixture()
    h.input.scheduleTimer = ms => Object.assign(() => undefined, {
      ms, fired: h.fired.promise, cancel: () => { h.state.cancels++ },
    })
    const result = wait(h.input); await drain()
    assert.equal(h.state.calls, 1)
    h.fired.reject('SYNTHETIC_CALLABLE_TIMER_REJECTION')
    const observed = await result
    assert.equal(observed.reason, 'TIMER_FAILED'); assert.equal(observed.timerFailed, true)
    assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1)
  })
  it('owns callable already-rejected timer returned after synchronous scheduler failure event', async () => {
    const h = fixture()
    h.input.scheduleTimer = ms => {
      h.state.listener!()
      return Object.assign(() => undefined, {
        ms, fired: Promise.reject<void>('SYNTHETIC_CALLBACK_CALLABLE_TIMER_REJECTION'),
        cancel: () => { h.state.cancels++ },
      })
    }
    const observed = await wait(h.input)
    assert.equal(observed.reason, 'FAILURE_LATCHED')
    assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1)
    assert.equal(observed.timerFailed, true); assert.equal(h.state.calls, 0)
    await drain()
  })
  it('contains scheduler throws and still unsubscribes', async () => {
    const h = fixture(); h.input.scheduleTimer = () => { throw opaque() }
    assert.equal((await wait(h.input)).reason, 'SCHEDULER_FAILED')
    assert.equal(h.state.calls, 0); assert.equal(h.state.unsubs, 1)
  })
  it('timer rejection defeats synchronous fast operation VALUE', async () => {
    const h = fixture()
    h.input.operation = token => { h.state.calls++; h.state.token = token; h.fired.reject(opaque()) }
    const observed = await wait(h.input)
    assert.equal(observed.reason, 'TIMER_FAILED'); assert.equal(observed.ok, false)
    assert.equal(observed.timerFailed, true); assert.equal(h.state.token!.isLive(), false)
  })
  for (const kind of ['resolve', 'reject'] as const) {
    it(`consumes native operation ${kind} without reading its own throwing then getter`, async () => {
      const h = fixture(); let thenReads = 0
      Object.defineProperty(h.operation.promise, 'then', { get() { thenReads++; throw opaque() } })
      const result = wait(h.input); await drain()
      assert.equal(h.state.calls, 1)
      assert.equal(thenReads, 0) // Genuine native consumers must bypass the own accessor.
      if (kind === 'resolve') h.operation.resolve(); else h.operation.reject('SYNTHETIC_OPERATION_REJECTION')
      const observed = await result
      assert.equal(observed.reason, kind === 'resolve' ? 'VALUE' : 'OPERATION_FAILED')
      assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1); assert.equal(thenReads, 0)
    })
  }
  for (const kind of ['resolve', 'reject'] as const) {
    it(`retains normalization and consumption for non-native PromiseLike ${kind}`, async () => {
      const h = fixture(); let thenCalls = 0
      const signal: PromiseLike<void> = {
        then(onFulfilled, onRejected) {
          thenCalls++
          const outcome = kind === 'resolve' ? Promise.resolve() : Promise.reject<void>('SYNTHETIC_THENABLE_REJECTION')
          return outcome.then(onFulfilled, onRejected)
        },
      }
      h.input.operation = token => { h.state.calls++; h.state.token = token; return signal }
      const observed = await wait(h.input)
      assert.equal(observed.reason, kind === 'resolve' ? 'VALUE' : 'OPERATION_FAILED')
      assert.equal(thenCalls, 1); assert.equal(h.state.calls, 1)
      assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1)
    })
  }
  it('consumes already-rejected native promise with own then getter after synchronous token fencing', async () => {
    const h = fixture(); let thenReads = 0
    h.input.operation = token => {
      h.state.calls++; h.state.token = token; h.state.now = 100
      assert.equal(token.isLive(), false)
      const signal = Promise.reject<void>('SYNTHETIC_FENCED_OPERATION_REJECTION')
      Object.defineProperty(signal, 'then', { get() { thenReads++; throw opaque() } })
      return signal
    }
    const observed = await wait(h.input)
    assert.equal(observed.reason, 'EXPIRED')
    assert.equal(thenReads, 0); assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1)
    await drain()
  })
  for (const kind of ['throw', 'reject'] as const) {
    it(`contains operation ${kind} without exposing error value`, async () => {
      const h = fixture()
      h.input.operation = token => {
        h.state.calls++; h.state.token = token
        if (kind === 'throw') throw opaque()
        return Promise.reject(opaque())
      }
      const observed = await wait(h.input)
      assert.equal(observed.reason, 'OPERATION_FAILED')
      assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1)
      assert.deepEqual(Object.keys(observed).sort(), ['authority', 'cancelFailed', 'ok', 'reason', 'timerFailed', 'unsubscribeFailed'])
    })
  }
  it('consumes returned rejection even after synchronous token clock fencing', async () => {
    const h = fixture()
    h.input.operation = token => {
      h.state.calls++; h.state.token = token; h.state.now = 100
      assert.equal(token.isLive(), false)
      return Promise.reject(opaque())
    }
    assert.equal((await wait(h.input)).reason, 'EXPIRED')
    assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1); await drain()
  })
  it('a backward clock observed by live token permanently fences wait', async () => {
    const h = fixture(); const result = wait(h.input); await drain()
    assert.equal(h.state.calls, 1)
    h.state.now = 9
    assert.equal(h.state.token!.isLive(), false)
    h.state.now = 10
    assert.equal(h.state.token!.isLive(), false)
    assert.equal((await result).reason, 'CLOCK_FAILED')
    h.operation.resolve(); await drain()
  })
  it('rejects a backward clock before operation after subscription', async () => {
    const h = fixture()
    h.input.failureSource.subscribe = () => { h.state.now = 9; return () => { h.state.unsubs++ } }
    assert.equal((await wait(h.input)).reason, 'CLOCK_FAILED')
    assert.equal(h.state.calls, 0); assert.equal(h.state.unsubs, 1)
  })
  it('cancel reentry sees a synchronously dead token; throwing cancel cannot skip unsubscribe', async () => {
    const h = fixture()
    h.state.onCancel = () => { assert.equal(h.state.token!.isLive(), false); throw opaque() }
    const result = wait(h.input); await drain(); assert.equal(h.state.calls, 1)
    h.operation.resolve()
    const observed = await result
    assert.equal(observed.reason, 'CANCEL_FAILED'); assert.equal(observed.cancelFailed, true)
    assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1)
  })
  it('unsubscribe reentry sees dead token and cannot skip timer disposal', async () => {
    const h = fixture()
    h.state.onUnsubscribe = () => { assert.equal(h.state.token!.isLive(), false); throw opaque() }
    const result = wait(h.input); await drain(); assert.equal(h.state.calls, 1)
    h.operation.resolve()
    const observed = await result
    assert.equal(observed.reason, 'UNSUBSCRIBE_FAILED'); assert.equal(observed.unsubscribeFailed, true)
    assert.equal(h.state.cancels, 1); assert.equal(h.state.unsubs, 1)
  })
  it('preserves operation primary failure while recording both throwing finalizers', async () => {
    const h = fixture()
    h.state.onCancel = () => { throw opaque() }; h.state.onUnsubscribe = () => { throw opaque() }
    const result = wait(h.input); await drain(); assert.equal(h.state.calls, 1)
    h.operation.reject(opaque())
    const observed = await result
    assert.equal(observed.reason, 'OPERATION_FAILED')
    assert.equal(observed.cancelFailed, true); assert.equal(observed.unsubscribeFailed, true)
  })
  for (const stage of ['cancel', 'unsubscribe'] as const) {
    it(`expiry during ${stage} defeats provisional VALUE`, async () => {
      const h = fixture()
      if (stage === 'cancel') h.state.onCancel = () => { h.state.now = 100 }
      else h.state.onUnsubscribe = () => { h.state.now = 100 }
      const result = wait(h.input); await drain(); assert.equal(h.state.calls, 1)
      h.operation.resolve()
      assert.equal((await result).reason, 'EXPIRED')
    })
    it(`source failure during ${stage} defeats provisional VALUE`, async () => {
      const h = fixture()
      const fail = () => { h.state.listener!() }
      if (stage === 'cancel') h.state.onCancel = fail
      else h.state.onUnsubscribe = fail
      const result = wait(h.input); await drain(); assert.equal(h.state.calls, 1)
      h.operation.resolve()
      assert.equal((await result).reason, 'FAILURE_LATCHED')
    })
  }
  it('timer rejection during cancel defeats provisional VALUE before publication', async () => {
    const h = fixture(); h.state.onCancel = () => { h.fired.reject(opaque()) }
    const result = wait(h.input); await drain(); assert.equal(h.state.calls, 1)
    h.operation.resolve()
    const observed = await result
    assert.equal(observed.reason, 'TIMER_FAILED'); assert.equal(observed.timerFailed, true)
  })
  it('publication microtask boundary observes a queued expiry from unsubscribe', async () => {
    const h = fixture(); h.state.onUnsubscribe = () => { queueMicrotask(() => { h.state.now = 100 }) }
    const result = wait(h.input); await drain(); assert.equal(h.state.calls, 1)
    h.operation.resolve()
    assert.equal((await result).reason, 'EXPIRED')
  })
  for (const kind of ['reject', 'resolve'] as const) {
    it(`late operation ${kind} after timeout cannot restore published failure`, async () => {
      const h = fixture(); const result = wait(h.input); await drain(); assert.equal(h.state.calls, 1)
      h.fired.resolve()
      assert.equal(h.state.token!.isLive(), true) // Promise handler has not run yet.
      const observed = await result; const before = JSON.stringify(observed)
      assert.equal(observed.reason, 'EXPIRED'); assert.equal(h.state.token!.isLive(), false)
      if (kind === 'reject') h.operation.reject(opaque()); else h.operation.resolve()
      await drain()
      assert.equal(JSON.stringify(observed), before); assert.equal(h.state.cancels, 1)
    })
  }
  it('late timer rejection/source event cannot mutate a published frozen VALUE', async () => {
    const h = fixture(); const result = wait(h.input); await drain(); assert.equal(h.state.calls, 1)
    h.operation.resolve()
    const observed = await result; const before = JSON.stringify(observed)
    assert.equal(observed.reason, 'VALUE')
    h.fired.reject(opaque()); h.state.failed = true; h.state.listener!(); await drain()
    assert.equal(JSON.stringify(observed), before); assert.equal(h.state.token!.isLive(), false)
  })
  it('captures caller deadline/functions once so replacement cannot extend acceptance', async () => {
    const h = fixture(); const result = wait(h.input); await drain(); assert.equal(h.state.calls, 1)
    h.input.deadlineEpochMs = 10000
    h.input.clock.nowEpochMs = () => 0
    h.input.failureSource.hasFailure = () => false
    h.input.operation = () => { throw new Error('replacement operation must not run') }
    h.state.now = 100
    h.operation.resolve()
    assert.equal((await result).reason, 'EXPIRED'); assert.equal(h.state.calls, 1)
  })
})
