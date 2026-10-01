/**
 * T15E bounded overlap lifecycle orchestrator (Task72) — PURE async core with
 * INJECTED FAKES ONLY. No real process spawn, no psql, no DB, no fs, no real
 * timers, no wiring: every effectful boundary (session adapter, clock,
 * cancellable timers, snapshot source, independent backend monitor) is an
 * injected dependency. The real adapter/runtime slices are later work.
 *
 * Invariants implemented here (Astra Task71 -> Task72 contract):
 * - ARM is validated FIRST (pure) before any adapter call; the overall
 *   watchdog timer is armed BEFORE the acquisition is sent.
 * - ONE absolute hold budget (acquisition-SEND -> release, <= 3000ms hard max
 *   via validateDeadlinePlan): acquire, observe, and release-reserve all share
 *   it; a delayed acquire consumes it. No response arriving after its deadline
 *   is ever accepted (late ack / late poll / late release ack are rejected).
 * - READY only after a VERIFIED lock ack bound to the same run nonce and the
 *   armed request ("wrong row" acks never advance the phase machine).
 * - clearSnapshot() is called before EVERY poll; snapshots are verified with
 *   verifyOverlapSnapshot (cycle/invalid graphs are rejected, never proof).
 * - On proof, rollback+RELEASE must be acked within the hold deadline BEFORE
 *   success; success additionally requires session close AND backend-gone
 *   confirmation from the INDEPENDENT monitor (child exit proves nothing).
 * - Every await is individually bounded by the remaining budget (no hanging
 *   reads/rollback); bounded cleanup may exceed the 3s hold (rollback budget,
 *   SIGTERM -> SIGKILL escalation on the EXACT owned handle via the adapter)
 *   but a late/missing rollback ack invalidates the hold proof.
 * - No cancellation fiction: pending calls may still settle late and affect
 *   the session, so cleanup ALWAYS runs; late promise rejections are consumed
 *   (never unhandled) and routed through registered late-failure listeners
 *   that are disposed at run end. Timer bookkeeping cancels every armed timer.
 * - The primary failure is preserved with fixed secondary cleanup categories;
 *   signal errors are recorded, never swallowed. Run nonce / request UUID are
 *   frozen and stay immutable across every adapter callback.
 *
 * Task73 integrity fixes (Astra P1 review, BLOCK -> fixes):
 * 1. The connected identity is validated and stored as a FROZEN DEFENSIVE
 *    COPY; an accepted snapshot's coordinator must match pid, backendStart,
 *    AND databaseId of that copy — a self-consistent snapshot rooted at a
 *    foreign coordinator is never proof.
 * 2. The whole acquired-resource lifecycle is encompassed by try/catch with
 *    always-run bounded cleanup: synchronous adapter invocation failures
 *    (adapters are invoked through thunks inside the bounded wrapper) and a
 *    throwing clearSnapshot() are caught with the fixed primary ADAPTER_THROW;
 *    every cleanup step is individually guarded so a throwing step cannot
 *    skip rollback/terminate/monitor/dispose/timer-cancel/listener-dispose,
 *    and the first primary category is always preserved.
 * 3. Disposal FENCE contract (connect timeout): a connect that fulfills late
 *    must not create an untracked backend. On connect failure the orchestrator
 *    demands a bounded dispose() acknowledgment; an acked fence guarantees no
 *    future backend (late identities are ignored — no arbitrary PID kills for
 *    unknown identities). If the fence cannot be proven, any late identity is
 *    captured and given bounded OWNED cleanup (exact-handle SIGTERM/SIGKILL)
 *    plus independent gone confirmation, and the unproven fence is recorded.
 * 4. Adapter-reported late failures LATCH a fixed failure category
 *    (LATE_ADAPTER_FAILURE): a latched late failure before final success can
 *    never coexist with ok:true, while an already-set primary failure is
 *    preserved (first-primary precedence).
 */

import {
  T15E_DEADLINES_MS,
  T15E_SAFE_ERROR_MESSAGE,
  createT15EPhaseMachine,
  validateArmPayload,
  validateDeadlinePlan,
  validateLockAcknowledgment,
  verifyOverlapSnapshot,
  type ArmPayload,
  type DeadlinePlan,
  type OverlapVerificationOk,
  type PhaseStage,
  type ReleasePayload,
  type SanitizedActivitySnapshot,
} from './t15e-overlap-protocol'

// ---------------------------------------------------------------------------
// Injected boundaries (fakes in tests; real adapters are a later slice)
// ---------------------------------------------------------------------------

export interface T15EClock {
  nowEpochMs(): number
}

export interface T15EArmedTimer {
  readonly ms: number
  readonly fired: Promise<void>
  /** Idempotent: cancelling a fired timer is a harmless no-op. */
  cancel(): void
}
export type T15ETimerScheduler = (ms: number) => T15EArmedTimer

/** Verified coordinator/backend identity for the owned session handle. */
export type T15EBackendIdentity = { pid: number; backendStart: string; databaseId: number }

export interface T15ESessionAdapter {
  /** Open the owned session and report the coordinator identity (or null). */
  connect(deadlineEpochMs: number): Promise<T15EBackendIdentity | null>
  /** Deliver ARM; resolves true iff acknowledged before the deadline. */
  sendArm(payload: Readonly<ArmPayload>, deadlineEpochMs: number): Promise<boolean>
  /** Deliver the lock acquisition; resolves the RAW ack row (untrusted). */
  sendLockAcquire(payload: Readonly<ArmPayload>, deadlineEpochMs: number): Promise<unknown>
  /** Deliver rollback+RELEASE; resolves true iff the rollback is acked. */
  sendRelease(
    payload: Readonly<ReleasePayload>,
    deadlineEpochMs: number,
    phase: 'hold' | 'cleanup',
  ): Promise<boolean>
  close(deadlineEpochMs: number): Promise<boolean>
  /** Signal the EXACT owned handle; resolves true iff it reported exit. */
  signal(
    identity: Readonly<T15EBackendIdentity>,
    signal: 'SIGTERM' | 'SIGKILL',
    deadlineEpochMs: number,
  ): Promise<boolean>
  /**
   * DISPOSAL FENCE: resolves true only when the adapter guarantees a pending
   * or failed connection attempt can no longer materialize an untracked
   * backend. False/timeout/throw means the fence is UNPROVEN: the run fails
   * explicitly with a fixed cleanup category (never a silent untracked
   * backend). No arbitrary PID kill is performed for unknown identities.
   */
  dispose(deadlineEpochMs: number): Promise<boolean>
  /** Register a late-failure listener; returns its disposer. */
  onLateFailure(listener: (failure: unknown) => void): () => void
}

export interface T15ESnapshotSource {
  /** MUST be invoked before EVERY poll: prevents stale snapshot reuse. */
  clearSnapshot(): void
  /** One bounded poll; may hang (the orchestrator bounds it) or return null. */
  poll(deadlineEpochMs: number): Promise<unknown>
}

/** INDEPENDENT adapter: child exit alone proves nothing about the backend. */
export interface T15EBackendMonitor {
  confirmBackendGone(
    identity: Readonly<T15EBackendIdentity>,
    deadlineEpochMs: number,
  ): Promise<boolean>
}

export interface T15ELifecycleDeps {
  clock: T15EClock
  scheduleTimer: T15ETimerScheduler
  session: T15ESessionAdapter
  snapshotSource: T15ESnapshotSource
  backendMonitor: T15EBackendMonitor
}

// ---------------------------------------------------------------------------
// Fixed result vocabulary (no dynamic messages — safe errors only)
// ---------------------------------------------------------------------------

export type T15EPrimaryFailureCategory =
  | 'PLAN_INVALID'
  | 'ARM_INVALID'
  | 'CONNECT_FAILED'
  | 'IDENTITY_INVALID'
  | 'ARM_NACK'
  | 'LOCK_ACK_INVALID'
  | 'LOCK_ACK_TIMEOUT'
  | 'ADAPTER_THROW'
  | 'HOLD_DEADLINE_EXCEEDED'
  | 'NO_OVERLAP_PROOF'
  | 'RELEASE_ACK_MISSING'
  | 'SESSION_CLOSE_FAILED'
  | 'BACKEND_STILL_ALIVE'
  | 'LATE_ADAPTER_FAILURE'
  | 'CLEANUP_FAILED'

export type T15ECleanupCategory =
  | 'CLEANUP_IDENTITY_UNKNOWN'
  | 'CLEANUP_ROLLBACK_TIMEOUT'
  | 'CLEANUP_SIGNAL_ERROR'
  | 'CLEANUP_SIGKILL_FAILED'
  | 'CLEANUP_BACKEND_GONE_UNCONFIRMED'
  | 'CLEANUP_SESSION_CLOSE_FAILED'
  | 'CLEANUP_DISPOSAL_UNPROVEN'
  | 'CLEANUP_UNKNOWN'
  | 'CLEANUP_TIMER_CANCEL_FAILED'
  | 'CLEANUP_DISPOSER_FAILED'

export type T15ERunResult =
  | {
      ok: true
      runNonce: string
      requestId: string
      overlap: OverlapVerificationOk
      releasedAtEpochMs: number
      cleanup: T15ECleanupCategory[]
    }
  | {
      ok: false
      runNonce: string
      requestId: string
      stage: PhaseStage
      primary: { category: T15EPrimaryFailureCategory; message: string }
      cleanup: T15ECleanupCategory[]
    }

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

function isValidBackendIdentity(value: unknown): value is T15EBackendIdentity {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<T15EBackendIdentity>
  return (
    typeof v.pid === 'number' &&
    Number.isInteger(v.pid) &&
    v.pid > 0 &&
    typeof v.backendStart === 'string' &&
    v.backendStart.length > 0 &&
    v.backendStart.length <= 64 &&
    typeof v.databaseId === 'number' &&
    Number.isInteger(v.databaseId)
  )
}

/** Frozen defensive copy: adapters can never rebind the stored identity. */
function frozenIdentityCopy(value: T15EBackendIdentity): Readonly<T15EBackendIdentity> {
  return deepFreeze({
    pid: value.pid,
    backendStart: value.backendStart,
    databaseId: value.databaseId,
  })
}

type BoundedOutcome<T> =
  | { kind: 'value'; value: T }
  | { kind: 'error'; error: unknown }
  | { kind: 'timeout' }

/**
 * Invoke `thunk` and await its promise with an explicit remaining-budget
 * bound. Adapters are invoked THROUGH the thunk so a SYNCHRONOUS throw is
 * captured as an error outcome instead of escaping the lifecycle. The losing
 * side is never trusted: on timeout the promise keeps a settlement consumer so
 * a late rejection can never surface as unhandled (it is routed to `onLate`
 * instead), and the deadline timer is always cancelled. If the budget is
 * already exhausted the call times out immediately but still consumes late
 * settlement.
 */
export async function awaitBounded<T>(
  thunk: () => Promise<T>,
  budgetMs: number,
  scheduleTimer: T15ETimerScheduler,
  onLate: (result: PromiseSettledResult<T>) => void,
): Promise<BoundedOutcome<T>> {
  let settled = false
  let observed: Promise<BoundedOutcome<T>>
  try {
    observed = thunk().then(
      (value) => {
        if (settled) onLate({ status: 'fulfilled', value })
        return { kind: 'value' as const, value }
      },
      (error) => {
        if (settled) onLate({ status: 'rejected' as const, reason: error })
        return { kind: 'error' as const, error }
      },
    )
  } catch (error) {
    // Synchronous adapter invocation failure: no promise exists to consume.
    return { kind: 'error', error }
  }
  if (!(budgetMs > 0)) {
    settled = true
    return { kind: 'timeout' }
  }
  const timer = scheduleTimer(budgetMs)
  const outcome = await Promise.race([
    observed,
    timer.fired.then(() => ({ kind: 'timeout' as const })),
  ])
  settled = true
  timer.cancel()
  return outcome as BoundedOutcome<T>
}

/** Internal control-flow signal: fail the run with a fixed primary category. */
class T15EFailSignal {
  constructor(
    readonly category: T15EPrimaryFailureCategory,
    readonly stageAtThrow: PhaseStage,
  ) {}
}

interface T15ERunState {
  identity: Readonly<T15EBackendIdentity> | null
  connectPromise: Promise<T15EBackendIdentity | null> | null
  lateIdentity: Readonly<T15EBackendIdentity> | null
  releaseAcked: boolean
  identityUnknown: boolean
  fenceAcked: boolean
  confirmedGone: boolean
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runT15EOverlapLifecycle(
  deps: T15ELifecycleDeps,
  input: { runNonce: string; requestId: string },
  plan: DeadlinePlan = T15E_DEADLINES_MS,
): Promise<T15ERunResult> {
  const { clock, session, snapshotSource, backendMonitor } = deps
  const runNonce = input.runNonce
  const requestId = input.requestId

  const armedTimers: T15EArmedTimer[] = []
  const armTimer = (ms: number): T15EArmedTimer => {
    const t = deps.scheduleTimer(Math.max(0, ms))
    armedTimers.push(t)
    return t
  }
  const lateFailures: unknown[] = []
  let lateFailureLatched = false
  const latchLateFailure = () => {
    lateFailureLatched = true
  }
  const machine = createT15EPhaseMachine()

  const frozenRelease = (outcome: 'COMPLETED' | 'VOIDED'): Readonly<ReleasePayload> =>
    deepFreeze({ kind: 'RELEASE', runNonce, requestId, outcome }) as Readonly<ReleasePayload>

  let disposeLateFailure: () => void = () => undefined
  try {
    disposeLateFailure = session.onLateFailure((failure) => {
      // Task73 P1-4: a reported adapter failure latches a fixed category and
      // can never coexist with ok:true.
      latchLateFailure()
      lateFailures.push(failure)
    })
  } catch {
    disposeLateFailure = () => undefined
    return {
      ok: false,
      runNonce,
      requestId,
      stage: 'IDLE',
      primary: { category: 'ADAPTER_THROW', message: T15E_SAFE_ERROR_MESSAGE },
      cleanup: [],
    }
  }

  /**
   * Final disposal (Task74 P3): every timer cancel and the listener disposer
   * are guarded INDIVIDUALLY — one throwing cancel never skips the remaining
   * timers or the listener disposal; failures are recorded as fixed cleanup
   * categories and never replace the primary error.
   */
  const finish = (): T15ECleanupCategory[] => {
    const cats: T15ECleanupCategory[] = []
    for (const t of armedTimers) {
      try {
        t.cancel()
      } catch {
        if (!cats.includes('CLEANUP_TIMER_CANCEL_FAILED')) cats.push('CLEANUP_TIMER_CANCEL_FAILED')
      }
    }
    try {
      disposeLateFailure()
    } catch {
      cats.push('CLEANUP_DISPOSER_FAILED')
    }
    return cats
  }

  /**
   * Bounded cleanup: may exceed the 3s hold; NEVER restores a proof. Every
   * step is individually guarded (thunked + try/caught) so one throwing step
   * cannot skip the remaining disposal, timer cancellation, or listener
   * disposal. Fixed secondary categories only; deduplicated.
   */
  const runCleanup = async (state: T15ERunState): Promise<T15ECleanupCategory[]> => {
    const cats: T15ECleanupCategory[] = []
    const record = (c: T15ECleanupCategory) => {
      if (!cats.includes(c)) cats.push(c)
    }
    const bounded = <T>(thunk: () => Promise<T>, ms: number) =>
      awaitBounded(thunk, ms, armTimer, () => undefined)
    const terminateOwned = async (
      target: Readonly<T15EBackendIdentity>,
    ): Promise<void> => {
      let signalError = false
      const termed = await bounded(
        () => session.signal(target, 'SIGTERM', clock.nowEpochMs() + plan.sigterm),
        plan.sigterm,
      )
      if (termed.kind === 'error') signalError = true
      if (termed.kind !== 'value' || termed.value !== true) {
        const killed = await bounded(
          () => session.signal(target, 'SIGKILL', clock.nowEpochMs() + plan.sigkill),
          plan.sigkill,
        )
        if (killed.kind === 'error') signalError = true
        if (killed.kind !== 'value' || killed.value !== true) record('CLEANUP_SIGKILL_FAILED')
      }
      // Signal errors are recorded, never swallowed.
      if (signalError) record('CLEANUP_SIGNAL_ERROR')
      const gone = await bounded(
        () => backendMonitor.confirmBackendGone(target, clock.nowEpochMs() + plan.backendGoneConfirm),
        plan.backendGoneConfirm,
      )
      if (gone.kind !== 'value' || gone.value !== true) record('CLEANUP_BACKEND_GONE_UNCONFIRMED')
    }
    if (state.identity !== null) {
      if (!state.releaseAcked) {
        const rollback = await bounded(
          () =>
            session.sendRelease(
              frozenRelease('VOIDED'),
              clock.nowEpochMs() + plan.rollback,
              'cleanup',
            ),
          plan.rollback,
        )
        if (rollback.kind !== 'value' || rollback.value !== true) {
          record('CLEANUP_ROLLBACK_TIMEOUT')
        }
      }
      if (!state.confirmedGone) await terminateOwned(state.identity)
    } else {
      if (state.identityUnknown) record('CLEANUP_IDENTITY_UNKNOWN')
      if (!state.fenceAcked) {
        // Task73 P1-3: an unproven fence means a late-fulfilled connect may
        // still materialize an OWNED backend. Wait bounded for its identity,
        // then run exact-handle termination + independent gone confirmation.
        if (state.connectPromise !== null) {
          const lateWait = await bounded(
            () => state.connectPromise as Promise<T15EBackendIdentity | null>,
            plan.rollback,
          )
          // Only a STILL-PENDING connect can materialize an untracked backend
          // later; a settled one (even with garbage identity) cannot.
          if (lateWait.kind === 'timeout') record('CLEANUP_DISPOSAL_UNPROVEN')
        }
        if (state.lateIdentity !== null) await terminateOwned(state.lateIdentity)
        else if (state.connectPromise === null) record('CLEANUP_DISPOSAL_UNPROVEN')
      }
    }
    const closed = await bounded(
      () => session.close(clock.nowEpochMs() + plan.rollback),
      plan.rollback,
    )
    if (closed.kind !== 'value' || closed.value !== true) record('CLEANUP_SESSION_CLOSE_FAILED')
    if (!state.fenceAcked) {
      const disposed = await bounded(
        () => session.dispose(clock.nowEpochMs() + plan.rollback),
        plan.rollback,
      )
      if (disposed.kind !== 'value' || disposed.value !== true) record('CLEANUP_DISPOSAL_UNPROVEN')
    }
    return cats
  }

  // --- Stage 0: validate plan + ARM BEFORE any adapter call ----------------
  if (!validateDeadlinePlan(plan).ok) {
    finish()
    return {
      ok: false,
      runNonce,
      requestId,
      stage: 'IDLE',
      primary: { category: 'PLAN_INVALID', message: T15E_SAFE_ERROR_MESSAGE },
      cleanup: [],
    }
  }
  const armCheck = validateArmPayload({ kind: 'ARM', runNonce, requestId })
  if (!armCheck.ok) {
    finish()
    return {
      ok: false,
      runNonce,
      requestId,
      stage: 'IDLE',
      primary: { category: 'ARM_INVALID', message: T15E_SAFE_ERROR_MESSAGE },
      cleanup: [],
    }
  }
  const armPayload = deepFreeze({ ...armCheck.value }) as Readonly<ArmPayload>
  const armAccepted = machine.accept(armPayload)
  if (!armAccepted.ok) {
    finish()
    return {
      ok: false,
      runNonce,
      requestId,
      stage: machine.stage(),
      primary: { category: 'ARM_INVALID', message: T15E_SAFE_ERROR_MESSAGE },
      cleanup: [],
    }
  }

  const state: T15ERunState = {
    identity: null,
    connectPromise: null,
    lateIdentity: null,
    releaseAcked: false,
    identityUnknown: false,
    fenceAcked: false,
    confirmedGone: false,
  }

  const startAt = clock.nowEpochMs()
  const watchdogEnd = startAt + plan.overallWatchdog
  // Watchdog is ARMED before connect/acquire so the whole run stays bounded
  // even if an adapter misbehaves; every step below is additionally clamped to
  // the remaining watchdog budget.
  const watchdog = armTimer(plan.overallWatchdog)
  watchdog.fired.then(
    () => undefined,
    () => undefined,
  )

  const remainingTo = (deadline: number) => Math.min(deadline, watchdogEnd) - clock.nowEpochMs()
  const bounded = <T>(thunk: () => Promise<T>, deadline: number) =>
    awaitBounded(thunk, remainingTo(deadline), armTimer, (r) => {
      if (r.status === 'rejected') latchLateFailure()
    })

  let primaryCat: T15EPrimaryFailureCategory | null = null
  let primaryStage: PhaseStage = 'IDLE'
  let proof: OverlapVerificationOk | null = null
  let releasedAtEpochMs = 0
  const failNow = (category: T15EPrimaryFailureCategory): never => {
    if (primaryCat === null) {
      primaryCat = category
      primaryStage = machine.stage()
    }
    throw new T15EFailSignal(category, primaryStage)
  }

  try {
    // --- Stage 1: connect + verify coordinator identity --------------------
    const connectPromiseBox: { promise: Promise<T15EBackendIdentity | null> | null } = {
      promise: null,
    }
    const connected = await bounded(
      () => {
        connectPromiseBox.promise = session.connect(clock.nowEpochMs() + plan.connect)
        return connectPromiseBox.promise
      },
      clock.nowEpochMs() + plan.connect,
    )
    state.connectPromise = connectPromiseBox.promise
    if (connected.kind !== 'value' || connected.value === null) {
      // Task73 P1-3: a connect that fulfills LATE must not create an
      // untracked backend. Demand the disposal fence, bounded.
      const fence = await bounded(
        () => session.dispose(clock.nowEpochMs() + plan.rollback),
        clock.nowEpochMs() + plan.rollback,
      )
      state.fenceAcked = fence.kind === 'value' && fence.value === true
      if (!state.fenceAcked) {
        // Capture a late identity for bounded OWNED cleanup; consume the
        // settlement either way (never an unhandled late rejection).
        state.connectPromise?.then(
          (v) => {
            if (isValidBackendIdentity(v)) state.lateIdentity = frozenIdentityCopy(v)
          },
          () => undefined,
        )
      }
      failNow('CONNECT_FAILED')
    }
    const rawIdentity = connected.kind === 'value' ? connected.value : null
    const rawValid =
      rawIdentity !== null && isValidBackendIdentity(rawIdentity) ? rawIdentity : null
    if (rawValid === null) {
      // Unknown identity: disposal cannot target an exact handle -> void run.
      state.identityUnknown = true
      failNow('IDENTITY_INVALID')
    } else {
      // Task73 P1-1: FROZEN DEFENSIVE COPY — the adapter cannot rebind it.
      state.identity = frozenIdentityCopy(rawValid)
    }

    const armAck = await bounded(
      () => session.sendArm(armPayload, watchdogEnd),
      clock.nowEpochMs() + plan.lockAcquire,
    )
    if (armAck.kind !== 'value' || armAck.value !== true) failNow('ARM_NACK')

    // --- Stage 2: acquisition — the ONE absolute hold budget starts HERE ---
    const acquireSentAt = clock.nowEpochMs()
    const holdEnd = acquireSentAt + plan.lockHoldSendToRelease
    const observeDeadline = holdEnd - plan.releaseReserve

    const ackOutcome = await bounded(
      () => session.sendLockAcquire(armPayload, Math.min(acquireSentAt + plan.lockAcquire, holdEnd)),
      Math.min(acquireSentAt + plan.lockAcquire, holdEnd),
    )
    if (ackOutcome.kind === 'timeout') failNow('LOCK_ACK_TIMEOUT')
    const ackCheck = validateLockAcknowledgment(ackOutcome.kind === 'value' ? ackOutcome.value : null)
    // Wrong row / wrong run / wrong request: never READY.
    const ack =
      ackCheck.ok && ackCheck.value.runNonce === runNonce && ackCheck.value.requestId === requestId
        ? ackCheck.value
        : null
    if (ack === null) {
      failNow('LOCK_ACK_INVALID')
    }
    // Late READY: an ack arriving after the absolute hold deadline is rejected —
    // no response after the deadline is accepted, even if well-formed.
    if (clock.nowEpochMs() > holdEnd) failNow('HOLD_DEADLINE_EXCEEDED')
    const readyAccepted = machine.accept({
      kind: 'READY',
      runNonce,
      requestId,
      lockAck: ack,
    })
    if (!readyAccepted.ok) failNow('LOCK_ACK_INVALID')

    // --- Stage 3: observe — clearSnapshot before EVERY poll ----------------
    while (proof === null) {
      if (clock.nowEpochMs() >= observeDeadline || clock.nowEpochMs() >= watchdogEnd) break
      // Task73 P1-2: a synchronously throwing clearSnapshot is contained.
      try {
        snapshotSource.clearSnapshot()
      } catch {
        failNow('ADAPTER_THROW')
      }
      const polled = await bounded(
        () => snapshotSource.poll(Math.min(observeDeadline, watchdogEnd)),
        Math.min(observeDeadline, watchdogEnd),
      )
      if (polled.kind === 'timeout') break // blocked poll: bounded, never hangs
      if (clock.nowEpochMs() >= observeDeadline) break // late poll: discarded
      if (polled.kind === 'value' && polled.value !== null && polled.value !== undefined) {
        const verified = verifyOverlapSnapshot(polled.value, {
          nowEpochMs: clock.nowEpochMs(),
          maxSnapshotAgeMs: plan.snapshotMaxAge,
          maxSessions: T15E_DEADLINES_MS.maxSessions,
        })
        if (verified.ok) {
          // Task73 P1-1: the snapshot coordinator MUST equal the frozen
          // connected identity on ALL fields — a self-consistent snapshot
          // rooted at a FOREIGN coordinator is never proof.
          const snapCoord = (polled.value as SanitizedActivitySnapshot).coordinator
          const owned = state.identity
          if (
            owned !== null &&
            snapCoord.pid === owned.pid &&
            snapCoord.backendStart === owned.backendStart &&
            snapCoord.databaseId === owned.databaseId
          ) {
            // Task74 P2: a latched adapter failure blocks PROOF PUBLICATION
            // itself — an observation-time failure can never emit a proof.
            if (lateFailureLatched) failNow('LATE_ADAPTER_FAILURE')
            const proofAccepted = machine.accept({
              kind: 'PROOF',
              runNonce,
              requestId,
              overlap: {
                topology: verified.topology,
                appBackendPids: verified.appBackendPids,
                coordinatorPid: verified.coordinatorPid,
              },
            })
            if (proofAccepted.ok) proof = verified
          }
          // Foreign coordinator: not proof; keep polling (bounded).
        }
      }
      if (proof === null) {
        const pace = armTimer(
          Math.min(
            plan.pollInterval,
            observeDeadline - clock.nowEpochMs(),
            watchdogEnd - clock.nowEpochMs(),
          ),
        )
        await pace.fired.then(
          () => undefined,
          () => undefined,
        )
        pace.cancel()
      }
    }
    if (proof === null) failNow('NO_OVERLAP_PROOF')

    // --- Stage 4: rollback+release BEFORE success, inside the hold ---------
    const releasePayload = frozenRelease('COMPLETED')
    const releaseAck = await bounded(
      () => session.sendRelease(releasePayload, holdEnd, 'hold'),
      holdEnd,
    )
    if (releaseAck.kind !== 'value' || releaseAck.value !== true) {
      // Missing rollback ack: proof invalidated; cleanup may exceed 3s.
      failNow('RELEASE_ACK_MISSING')
    }
    if (clock.nowEpochMs() > holdEnd) {
      // Rollback acked LATE: the hold proof is invalidated.
      failNow('HOLD_DEADLINE_EXCEEDED')
    }
    state.releaseAcked = true
    // Task74 P2: a latched adapter failure blocks PUBLICATION of
    // RELEASE {outcome:'COMPLETED'}.
    if (lateFailureLatched) failNow('LATE_ADAPTER_FAILURE')
    // PHASE CONTRACT: publishing RELEASE(COMPLETED) certifies ONLY that the
    // LOCK was released within the hold deadline — it is NEVER whole-run
    // acceptance. The final structured result is the sole acceptance
    // authority: any later cleanup failure invalidates the run, and a future
    // runner must not treat a published release as overall success.
    const releaseAccepted = machine.accept(releasePayload)
    if (!releaseAccepted.ok) failNow('RELEASE_ACK_MISSING')
    releasedAtEpochMs = clock.nowEpochMs()

    // --- Stage 5: close + INDEPENDENT backend-gone confirmation -----------
    const closed = await bounded(() => session.close(watchdogEnd), watchdogEnd)
    if (closed.kind !== 'value' || closed.value !== true) failNow('SESSION_CLOSE_FAILED')
    const gone = await bounded(
      () =>
        backendMonitor.confirmBackendGone(
          state.identity as Readonly<T15EBackendIdentity>,
          clock.nowEpochMs() + plan.backendGoneConfirm,
        ),
      clock.nowEpochMs() + plan.backendGoneConfirm,
    )
    if (gone.kind !== 'value' || gone.value !== true) {
      // Child exit is NOT backend gone.
      failNow('BACKEND_STILL_ALIVE')
    }
    state.confirmedGone = true
  } catch (e) {
    if (e instanceof T15EFailSignal) {
      if (primaryCat === null) {
        primaryCat = e.category
        primaryStage = e.stageAtThrow
      }
    } else if (primaryCat === null) {
      // Unexpected synchronous failure inside the lifecycle: contained with a
      // fixed primary; cleanup still runs below.
      primaryCat = 'ADAPTER_THROW'
      primaryStage = machine.stage()
    }
  }

  // ALWAYS attempt bounded cleanup (each step individually guarded), then
  // cancel every armed timer and dispose the late-failure listener — each
  // individually guarded (Task74 P3). An UNEXPECTED cleanup exception is
  // retained as the fixed category CLEANUP_UNKNOWN, never erased (Task74 P1).
  let cleanupCats: T15ECleanupCategory[] = []
  try {
    cleanupCats = await runCleanup(state)
  } catch {
    cleanupCats = ['CLEANUP_UNKNOWN']
  }
  for (const c of finish()) {
    if (!cleanupCats.includes(c)) cleanupCats.push(c)
  }

  // Task74 P2: re-check the latch AFTER cleanup, before the final return — a
  // failure reported during observation, release, or cleanup can never
  // coexist with ok:true.
  if (primaryCat === null && lateFailureLatched) {
    primaryCat = 'LATE_ADAPTER_FAILURE'
    primaryStage = machine.stage()
  }
  // Task74 P1: ANY cleanup failure prevents success (first primary preserved).
  if (primaryCat === null && cleanupCats.length > 0) {
    primaryCat = 'CLEANUP_FAILED'
    primaryStage = machine.stage()
  }

  if (primaryCat !== null) {
    return {
      ok: false,
      runNonce,
      requestId,
      stage: primaryStage,
      primary: { category: primaryCat, message: T15E_SAFE_ERROR_MESSAGE },
      cleanup: cleanupCats,
    }
  }
  return {
    ok: true,
    runNonce,
    requestId,
    overlap: proof as OverlapVerificationOk,
    releasedAtEpochMs,
    cleanup: cleanupCats,
  }
}
