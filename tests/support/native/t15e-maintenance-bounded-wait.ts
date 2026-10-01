/**
 * B1a2a: injected, lazy, bounded wait only. No child, IO driver, authority,
 * backend observation or operation cancellation. Clock protection is per-wait;
 * a future session must independently own its cross-wait gates and cleanup.
 */
import { types } from 'node:util'
import type { T15EClock, T15ETimerScheduler } from './t15e-overlap-lifecycle'

const isPromise = types.isPromise
const promiseThen = Promise.prototype.then

export type T15EMaintenanceWaitToken = Readonly<{ isLive(): boolean }>
export type T15EMaintenanceWaitReason =
  | 'VALUE' | 'INPUT_INVALID' | 'EXPIRED' | 'CLOCK_FAILED' | 'STATE_FAILED'
  | 'FAILURE_LATCHED' | 'SUBSCRIBE_FAILED' | 'SCHEDULER_FAILED' | 'TIMER_FAILED'
  | 'OPERATION_FAILED' | 'CANCEL_FAILED' | 'UNSUBSCRIBE_FAILED'
export type T15EMaintenanceWaitResult = Readonly<{
  ok: boolean
  authority: 'NONE'
  reason: T15EMaintenanceWaitReason
  timerFailed: boolean
  cancelFailed: boolean
  unsubscribeFailed: boolean
}>
export type T15EMaintenanceWaitInput = {
  deadlineEpochMs: number
  clock: T15EClock
  scheduleTimer: T15ETimerScheduler
  failureSource: {
    hasFailure(): boolean
    subscribe(listener: () => void): () => void
  }
  operation(token: T15EMaintenanceWaitToken): void | PromiseLike<void>
}

type Captured = {
  deadline: number
  now: () => number
  hasFailure: () => boolean
  subscribe: (listener: () => void) => unknown
  schedule: (ms: number) => unknown
  operation: (token: T15EMaintenanceWaitToken) => unknown
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
// A returned resource is already owned; callable structural timer containers
// must not bypass independent fired/cancel capture merely for being functions.
function resourceContainer(value: unknown): value is Record<string, unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}
function capture(input: unknown): Captured | null {
  try {
    if (!record(input)) return null
    const deadline = input.deadlineEpochMs
    const clock = input.clock
    const source = input.failureSource
    const schedule = input.scheduleTimer
    const operation = input.operation
    if (!record(clock) || !record(source)) return null
    const now = clock.nowEpochMs
    const hasFailure = source.hasFailure
    const subscribe = source.subscribe
    if (typeof deadline !== 'number' || !Number.isSafeInteger(deadline) || deadline <= 0 ||
        typeof now !== 'function' || typeof hasFailure !== 'function' ||
        typeof subscribe !== 'function' || typeof schedule !== 'function' || typeof operation !== 'function') return null
    return {
      deadline, now: now.bind(clock), hasFailure: hasFailure.bind(source),
      subscribe: subscribe.bind(source), schedule: schedule as Captured['schedule'],
      operation: operation as Captured['operation'],
    }
  } catch { return null } // Thrown values remain opaque, including revoked proxies.
}

export async function runT15EMaintenanceBoundedWait(input: unknown): Promise<T15EMaintenanceWaitResult> {
  const config = capture(input)
  let timerFailed = false
  let cancelFailed = false
  let unsubscribeFailed = false
  const snapshot = (reason: T15EMaintenanceWaitReason): T15EMaintenanceWaitResult => Object.freeze({
    ok: reason === 'VALUE', authority: 'NONE', reason, timerFailed, cancelFailed, unsubscribeFailed,
  })
  if (config === null) return snapshot('INPUT_INVALID')

  let lastNow = -1
  let sourceFailed = false
  let published = false
  const gate = (): T15EMaintenanceWaitReason | null => {
    let now: number
    try { now = config.now() } catch { return 'CLOCK_FAILED' }
    if (!Number.isSafeInteger(now) || now < 0 || now < lastNow) return 'CLOCK_FAILED'
    lastNow = now
    if (now >= config.deadline) return 'EXPIRED'
    let failed: boolean
    try { failed = config.hasFailure() } catch { return 'STATE_FAILED' }
    if (typeof failed !== 'boolean') return 'STATE_FAILED'
    if (failed) sourceFailed = true
    return sourceFailed ? 'FAILURE_LATCHED' : null
  }
  const initial = gate()
  if (initial !== null) return snapshot(initial)

  let live = true
  let primary: T15EMaintenanceWaitReason | null = null
  let cancel: (() => void) | null = null
  let cancelAttempted = false
  let unsubscribe: (() => void) | null = null
  let resolveSettled!: (reason: T15EMaintenanceWaitReason) => void
  const settled = new Promise<T15EMaintenanceWaitReason>(resolve => { resolveSettled = resolve })
  const cancelOwned = () => {
    if (cancel === null || cancelAttempted) return
    cancelAttempted = true
    try { cancel() } catch { cancelFailed = true }
  }
  const finish = (reason: T15EMaintenanceWaitReason) => {
    if (primary !== null) return
    primary = reason
    live = false // Synchronous ownership fence BEFORE any reentrant finalizer.
    cancelOwned()
    resolveSettled(reason) // A throwing cancel cannot strand resolution.
  }
  const check = () => {
    const failure = gate()
    if (failure !== null) finish(failure)
  }
  const token: T15EMaintenanceWaitToken = Object.freeze({
    isLive() {
      if (!live) return false
      check()
      return live
    },
  })
  const onFailure = () => {
    if (published) return
    sourceFailed = true
    finish('FAILURE_LATCHED')
  }

  try {
    const acquired = config.subscribe(onFailure)
    if (typeof acquired !== 'function') {
      unsubscribeFailed = true
      finish('SUBSCRIBE_FAILED')
    } else unsubscribe = acquired as () => void
  } catch {
    // Partial registration may exist, but its remover is unavailable.
    unsubscribeFailed = true
    finish('SUBSCRIBE_FAILED')
  }
  if (primary === null) check() // Replay failure latched before listener registration.

  if (primary === null) {
    let timer: unknown
    let acquired = false
    try {
      timer = config.schedule(config.deadline - lastNow)
      acquired = true
    } catch { finish('SCHEDULER_FAILED') }
    // A synchronous failure can settle the wait DURING schedule(). Its
    // subsequently returned timer still belongs to us and must be consumed.
    if (acquired) {
      let captureFailed = false
      try {
        if (!resourceContainer(timer)) captureFailed = true
        else {
          // Fired is captured/consumed before cancel is read. These captures
          // are independently attempted: a throwing fired getter cannot skip
          // acquiring and disposing an otherwise available cancel method.
          try {
            const fired = timer.fired
            if (!isPromise(fired)) captureFailed = true
            // Attach directly to the genuine Promise (including subclasses):
            // Promise.resolve(subclass) adds an assimilation job which could
            // run the pre-IO continuation before the rejection consumer.
            else promiseThen.call(fired,
              () => { if (!published) finish('EXPIRED') },
              () => { if (!published) { timerFailed = true; finish('TIMER_FAILED') } },
            )
          } catch { captureFailed = true }
          try {
            const method = timer.cancel
            if (typeof method !== 'function') { cancelFailed = true; captureFailed = true }
            else cancel = method.bind(timer)
          } catch { cancelFailed = true; captureFailed = true }
        }
      } catch { cancelFailed = true; captureFailed = true }
      if (captureFailed) finish('SCHEDULER_FAILED')
      // A getter/subscription callback may have settled before cancel capture.
      if (primary !== null) cancelOwned()
    }
  }

  // Deliver already-settled timer signals before allowing operation IO.
  await Promise.resolve()
  if (primary === null) check()
  if (primary === null) {
    try {
      const signal = config.operation(token)
      // Always consume an invoked thunk's returned signal, even if token
      // checking synchronously fenced the wait before the thunk returned.
      // Promise.resolve(native) returns it unchanged; its own then getter
      // must not be consulted before attaching intrinsic native consumers.
      const consumed = isPromise(signal) ? signal : Promise.resolve(signal)
      promiseThen.call(consumed, () => finish('VALUE'), () => finish('OPERATION_FAILED'))
    } catch { finish('OPERATION_FAILED') }
  }
  let outcome = await settled

  // Unsubscribe independently of timer cancellation; token is already dead.
  if (unsubscribe !== null) {
    const ownedUnsubscribe = unsubscribe
    unsubscribe = null
    try { ownedUnsubscribe() } catch { unsubscribeFailed = true }
  }
  const finalGate = () => {
    const failure = gate()
    if (outcome === 'VALUE' && failure !== null) outcome = failure
  }
  finalGate()
  // Consumers/finalizer-queued failure observations get a publication boundary.
  await Promise.resolve()
  finalGate()
  if (outcome === 'VALUE') {
    if (timerFailed) outcome = 'TIMER_FAILED'
    else if (cancelFailed) outcome = 'CANCEL_FAILED'
    else if (unsubscribeFailed) outcome = 'UNSUBSCRIBE_FAILED'
  }
  published = true
  return snapshot(outcome)
}
