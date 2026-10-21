/**
 * T15E coordinator session (Task93) — FIRST bounded slice. Fake-tested only.
 *
 * What this is: a verified persistent owned connection that can connect, ARM
 * the source stage SendBackToRequester, lock `requests` with FOR NO KEY
 * UPDATE in that same connection, and roll back. Acceptance is rechecked
 * before every write and after every await. The caller deadline is never
 * replaced with now+3000.
 *
 * What this is not: a T15ESessionAdapter. No signal(), no boolean dispose
 * fence, no snapshot/poll/HTTP/runner. Child exit is not backend gone.
 * Monitor ordering is required: coordination refuses unless the monitor
 * proof is already open and its fence accepts. This module never mints,
 * revokes, or tears the producer down.
 */

import { isValidT15ECanonicalBackendStart } from './t15e-backend-monitor'
import { T15E_COORDINATOR_ARM_STAGE } from './t15e-coordinator-commands'
import type { T15EMonitorSessionFailureCategory, T15EMonitorSessionInfo } from './t15e-monitor-session-adapter'
import {
  MAX_LOCK_HOLD_MS,
  T15E_DEADLINES_MS,
  T15E_SAFE_ERROR_MESSAGE,
  isValidCanonicalUuid,
  validateRunNonce,
  type ReadyPayload,
} from './t15e-overlap-protocol'
import { isT15ECapabilityLive } from './postgres-instance'
import {
  createT15EPersistentPsqlTransport,
  type T15EChildDisposalOutcome,
  type T15EPersistentPsqlConfig,
  type T15EPersistentPsqlTransport,
} from './t15e-persistent-session-transport'

export const T15E_COORDINATOR_SESSION_OBLIGATIONS_PENDING = [
  'FULL_T15E_SESSION_ADAPTER_SIGNAL_AND_BOOLEAN_DISPOSE_FENCE',
  'STABLE_TERMINAL_CLEANUP_PLUS_INDEPENDENT_BACKEND_GONE',
  'SNAPSHOT_POLL_BARRIER',
  'HTTP_AND_RUNNER_WIRING',
  'HELD_LOCK_WATCHDOG_OWNED_BY_THIS_SESSION_NOT_THE_LIFECYCLE',
  'DO_NOT_PASS_THIS_SESSION_TO_THE_LIFECYCLE_UNTIL_ONE_WATCHDOG_OWNER',
] as const

export const T15E_COORDINATOR_SESSION_CONTRACT = [
  'MONITOR_PREESTABLISHED: monitor info must exist, checkAcceptance must pass, its frozen cluster must match this allocation, and its backend pid must differ after connect',
  'NO_TEARDOWN_BYPASS: never mint, revoke, or stop the producer',
  'NO_BUDGET_RESET: the caller deadline is not replaced with now+3000',
  'DISPOSE_IS_NOT_BACKEND_GONE: dispose passes the transport snapshot through and forces backendGoneConfirmed false',
  'PARTIAL: signal, snapshot, poll, HTTP, and runner wiring are not implemented',
] as const

export type T15ECoordinatorFailureCategory =
  | 'T15E_COORDINATOR_MONITOR_NOT_PREESTABLISHED'
  | 'T15E_COORDINATOR_MONITOR_CLUSTER_MISMATCH'
  | 'T15E_COORDINATOR_MONITOR_SAME_BACKEND'
  | 'T15E_COORDINATOR_OPERATION_OVERLAP'
  | 'T15E_COORDINATOR_TRANSACTION_UNPROVEN'
  | 'T15E_COORDINATOR_LOCK_NOT_HELD'
  | 'T15E_COORDINATOR_HOLD_EXPIRED'
  | 'T15E_COORDINATOR_RELEASE_RESERVE_UNAVAILABLE'
  | 'T15E_COORDINATOR_STALE_RELEASE'
  | 'T15E_COORDINATOR_TRANSPORT_UNUSABLE'
  | 'T15E_COORDINATOR_DEADLINE_EXCEEDED'
  | 'T15E_COORDINATOR_HOLD_EXCEEDS_HARD_MAX'
  | 'T15E_COORDINATOR_DISPOSED'
  | 'T15E_COORDINATOR_REVOKED'
  | 'T15E_COORDINATOR_CONNECT_FAILED'
  | 'T15E_COORDINATOR_IDENTITY_INVALID'
  | 'T15E_COORDINATOR_CLUSTER_UNVERIFIED'
  | 'T15E_COORDINATOR_ARM_REJECTED'
  | 'T15E_COORDINATOR_LOCK_NOT_ELIGIBLE'
  | 'T15E_COORDINATOR_ACK_TIMEOUT'
  | 'T15E_COORDINATOR_TRANSPORT_REJECTED'
  | 'T15E_COORDINATOR_ADAPTER_THROW'
  | 'T15E_COORDINATOR_ROLLBACK_FAILED'
  | 'T15E_COORDINATOR_INVALID_REQUEST'
  | 'T15E_COORDINATOR_NOT_OPEN'

export interface T15ECoordinatorIdentity {
  pid: number
  backendStart: string
  databaseId: number
}

export interface T15ECoordinatorMonitorProof {
  info(): Readonly<T15EMonitorSessionInfo> | null
  checkAcceptance(deadlineEpochMs: number): T15EMonitorSessionFailureCategory | null
}

/** Historical evidence that a lock was taken and then released. Not a
 *  protocol READY payload and not a claim that a row is currently locked. */
export interface T15ECoordinatorHistoricalAcquisition {
  kind: 'HISTORICAL_ACQUISITION'
  runNonce: string
  requestId: string
  acquireSentAtEpochMs: number
  lockReleased: true
  rollbackAcknowledged: true
  currentlyLocked: false
}

export type T15ECoordinatorAcquireResult =
  | {
      ok: true
      readyEligible: false
      historical: T15ECoordinatorHistoricalAcquisition
      acquireSentAtEpochMs: number
      rolledBack: true
    }
  | {
      ok: false
      readyEligible: false
      category: T15ECoordinatorFailureCategory
      rolledBack: boolean
      message: string
    }

export interface T15EHeldLock {
  /** Protocol READY only while this transaction is still held and the gate is fresh. */
  ready(): { ok: true; ready: ReadyPayload } | { ok: false; category: T15ECoordinatorFailureCategory; message: string }
  /** Explicit ROLLBACK. Success is historical release evidence, not a current lock. */
  release(): Promise<T15ECoordinatorAcquireResult>
}

export interface T15ECoordinatorSession {
  connect(deadlineEpochMs: number): Promise<{ ok: true; identity: Readonly<T15ECoordinatorIdentity> } | { ok: false; category: T15ECoordinatorFailureCategory; message: string }>
  armStage(requestId: string, deadlineEpochMs: number): Promise<{ ok: true } | { ok: false; category: T15ECoordinatorFailureCategory; message: string }>
  /** BEGIN + lock + mandatory rollback. Historical evidence only; not READY. */
  acquireThenRollback(requestId: string, deadlineEpochMs: number): Promise<T15ECoordinatorAcquireResult>
  /**
   * BEGIN + lock, then HOLD. This session is the only watchdog owner: a
   * cancellable timer is armed before BEGIN and starts ROLLBACK at
   * holdEnd - releaseReserve. Do not also drive this session from the
   * lifecycle orchestrator (that would be a second transaction owner).
   */
  acquireHeld(requestId: string, deadlineEpochMs: number): Promise<
    | { ok: true; held: T15EHeldLock }
    | T15ECoordinatorAcquireResult
  >
  /** Caller-owned cleanup. Never a backend-gone proof. */
  dispose(deadlineEpochMs: number): Promise<T15EChildDisposalOutcome>
  checkAcceptance(deadlineEpochMs: number): T15ECoordinatorFailureCategory | null
  /** Synchronous transport acceptance. READY is the only usable state; not historical metadata. */
  acceptedTransportState(): 'READY' | 'NOT_ACCEPTED'
  info(): Readonly<T15ECoordinatorIdentity> | null
}

export interface T15ECoordinatorSessionDeps {
  config: T15EPersistentPsqlConfig
  transportDeps: Parameters<typeof createT15EPersistentPsqlTransport>[1]
  monitor: T15ECoordinatorMonitorProof
  createTransport?: typeof createT15EPersistentPsqlTransport
}

function fail(category: T15ECoordinatorFailureCategory, rolledBack = false): T15ECoordinatorAcquireResult {
  return { ok: false, readyEligible: false, category, rolledBack, message: T15E_SAFE_ERROR_MESSAGE }
}

function isIdentity(value: unknown): value is T15ECoordinatorIdentity {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<T15ECoordinatorIdentity>
  return (
    typeof v.pid === 'number' && Number.isInteger(v.pid) && v.pid > 0 &&
    isValidT15ECanonicalBackendStart(v.backendStart) &&
    typeof v.databaseId === 'number' && Number.isInteger(v.databaseId)
  )
}

export function createT15ECoordinatorSession(deps: T15ECoordinatorSessionDeps): T15ECoordinatorSession {
  const boundCapability = deps.config.capability
  const clock = deps.transportDeps.clock
  const runNonce = deps.config.runNonce
  let disposed = false
  let operationInFlight = false
  let txState: 'idle' | 'open' | 'unproven' = 'idle'
  let txOwner: object | null = null
  let heldWatch: {
    owner: object
    requestId: string
    acquireSentAt: number
    holdEnd: number
    releaseStart: number
    timer: { cancel(): void; fired: Promise<void> }
    releaseStarted: boolean
    voidRequested: boolean
    commandInFlight: boolean
  } | null = null
  let identity: Readonly<T15ECoordinatorIdentity> | null = null
  let armedRequestId: string | null = null
  const create = deps.createTransport ?? createT15EPersistentPsqlTransport
  const created = create(deps.config, deps.transportDeps)
  const transport: T15EPersistentPsqlTransport | null = created.ok ? created.transport : null

  const gate = (deadlineEpochMs: number): T15ECoordinatorFailureCategory | null => {
    if (disposed) return 'T15E_COORDINATOR_DISPOSED'
    if (typeof deadlineEpochMs !== 'number' || !Number.isFinite(deadlineEpochMs) || clock.nowEpochMs() >= deadlineEpochMs) {
      return 'T15E_COORDINATOR_DEADLINE_EXCEEDED'
    }
    if (!isT15ECapabilityLive(boundCapability)) return 'T15E_COORDINATOR_REVOKED'
    const monitorInfo = deps.monitor.info()
    if (monitorInfo === null || deps.monitor.checkAcceptance(deadlineEpochMs) !== null) {
      return 'T15E_COORDINATOR_MONITOR_NOT_PREESTABLISHED'
    }
    const expected = boundCapability.cluster
    if (
      monitorInfo.cluster.dataDirectory !== expected.dataDirectory ||
      monitorInfo.cluster.serverPort !== expected.databasePort ||
      monitorInfo.cluster.databaseName !== expected.database
    ) {
      return 'T15E_COORDINATOR_MONITOR_CLUSTER_MISMATCH'
    }
    if (identity !== null && monitorInfo.monitorBackend.pid === identity.pid) {
      return 'T15E_COORDINATOR_MONITOR_SAME_BACKEND'
    }
    return null
  }

  const transportAccepted = (): boolean => transport !== null && transport.state() === 'READY'
  const markHeldUncertain = (owner: object, timer: { cancel(): void }): void => {
    if (txState === 'open' && txOwner === owner) txState = 'unproven'
    timer.cancel()
  }

  const operationGate = (): T15ECoordinatorFailureCategory | null => {
    if (operationInFlight || txState === 'open') return 'T15E_COORDINATOR_OPERATION_OVERLAP'
    if (txState === 'unproven') return 'T15E_COORDINATOR_TRANSACTION_UNPROVEN'
    return null
  }

  async function rollbackOwned(owner: object, deadlineEpochMs: number): Promise<boolean> {
    if (txOwner !== owner || txState !== 'open' || transport === null) return false
    try {
      const rolled = await transport.executeTrustedCommand({ kind: 'COORDINATOR_ROLLBACK' }, deadlineEpochMs)
      if (txOwner !== owner) return false
      if (rolled.ok === true && rolled.frame.result.rolledBack === true) {
        txState = 'idle'
        txOwner = null
        return true
      }
      txState = 'unproven'
      return false
    } catch {
      if (txOwner === owner) txState = 'unproven'
      return false
    }
  }

  async function releaseHeld(owner: object, deadlineEpochMs: number): Promise<boolean> {
    const watch = heldWatch
    if (txOwner !== owner || txState !== 'open' || transport === null) return false
    if (watch !== null && watch.owner === owner) {
      if (watch.releaseStarted) return false
      watch.releaseStarted = true
      watch.timer.cancel()
    }
    try {
      const rolled = await transport.executeTrustedCommand({ kind: 'COORDINATOR_ROLLBACK' }, deadlineEpochMs)
      if (txOwner !== owner) return false
      if (rolled.ok === true && rolled.frame.result.rolledBack === true && clock.nowEpochMs() < deadlineEpochMs) {
        txState = 'idle'
        txOwner = null
        if (heldWatch?.owner === owner) heldWatch = null
        return true
      }
      txState = 'unproven'
      return false
    } catch {
      if (txOwner === owner) txState = 'unproven'
      return false
    }
  }

  return {
    checkAcceptance: (deadlineEpochMs) => gate(deadlineEpochMs),
    acceptedTransportState: () => (transportAccepted() ? 'READY' : 'NOT_ACCEPTED'),
    info: () => identity,
    async connect(deadlineEpochMs) {
      const entry = gate(deadlineEpochMs)
      if (entry !== null) return { ok: false, category: entry, message: T15E_SAFE_ERROR_MESSAGE }
      if (transport === null || !validateRunNonce(runNonce)) {
        return { ok: false, category: 'T15E_COORDINATOR_TRANSPORT_REJECTED', message: T15E_SAFE_ERROR_MESSAGE }
      }
      let connected: Awaited<ReturnType<T15EPersistentPsqlTransport['connect']>>
      try {
        connected = await transport.connect(deadlineEpochMs)
      } catch {
        return { ok: false, category: 'T15E_COORDINATOR_ADAPTER_THROW', message: T15E_SAFE_ERROR_MESSAGE }
      }
      const post = gate(deadlineEpochMs)
      if (post !== null) return { ok: false, category: post, message: T15E_SAFE_ERROR_MESSAGE }
      if (!connected.ok || !isIdentity(connected.identity)) {
        return { ok: false, category: 'T15E_COORDINATOR_CONNECT_FAILED', message: T15E_SAFE_ERROR_MESSAGE }
      }
      const cluster = transport.verifiedCluster()
      const expected = boundCapability.cluster
      if (
        cluster === null ||
        cluster.dataDirectory !== expected.dataDirectory ||
        cluster.serverPort !== expected.databasePort ||
        cluster.databaseName !== expected.database
      ) {
        return { ok: false, category: 'T15E_COORDINATOR_CLUSTER_UNVERIFIED', message: T15E_SAFE_ERROR_MESSAGE }
      }
      identity = Object.freeze({ ...connected.identity })
      const aligned = gate(deadlineEpochMs)
      if (aligned !== null) {
        identity = null
        return { ok: false, category: aligned, message: T15E_SAFE_ERROR_MESSAGE }
      }
      return { ok: true, identity }
    },
    async armStage(requestId, deadlineEpochMs) {
      const entry = gate(deadlineEpochMs)
      if (entry !== null) return { ok: false, category: entry, message: T15E_SAFE_ERROR_MESSAGE }
      const busy = operationGate()
      if (busy !== null) return { ok: false, category: busy, message: T15E_SAFE_ERROR_MESSAGE }
      if (identity === null || transport === null) {
        return { ok: false, category: 'T15E_COORDINATOR_NOT_OPEN', message: T15E_SAFE_ERROR_MESSAGE }
      }
      if (!isValidCanonicalUuid(requestId)) {
        return { ok: false, category: 'T15E_COORDINATOR_INVALID_REQUEST', message: T15E_SAFE_ERROR_MESSAGE }
      }
      let armed: Awaited<ReturnType<T15EPersistentPsqlTransport['executeTrustedCommand']>>
      try {
        armed = await transport.executeTrustedCommand({ kind: 'COORDINATOR_ARM_STAGE', requestId }, deadlineEpochMs)
      } catch {
        return { ok: false, category: 'T15E_COORDINATOR_ADAPTER_THROW', message: T15E_SAFE_ERROR_MESSAGE }
      }
      const post = gate(deadlineEpochMs)
      if (post !== null) return { ok: false, category: post, message: T15E_SAFE_ERROR_MESSAGE }
      const row = armed.ok ? armed.frame.result : null
      if (
        row === null ||
        row.found !== true ||
        row.requestId !== requestId ||
        row.status !== T15E_COORDINATOR_ARM_STAGE ||
        row.runNonce !== runNonce
      ) {
        armedRequestId = null
        return { ok: false, category: 'T15E_COORDINATOR_ARM_REJECTED', message: T15E_SAFE_ERROR_MESSAGE }
      }
      armedRequestId = requestId
      return { ok: true }
    },
    async acquireThenRollback(requestId, deadlineEpochMs) {
      const entry = gate(deadlineEpochMs)
      if (entry !== null) return fail(entry)
      if (identity === null || transport === null) return fail('T15E_COORDINATOR_NOT_OPEN')
      if (!isValidCanonicalUuid(requestId) || armedRequestId !== requestId) {
        return fail('T15E_COORDINATOR_INVALID_REQUEST')
      }
      const now = clock.nowEpochMs()
      if (deadlineEpochMs - now > MAX_LOCK_HOLD_MS) return fail('T15E_COORDINATOR_HOLD_EXCEEDS_HARD_MAX')
      const busy = operationGate()
      if (busy !== null) return fail(busy)
      const acquireSentAtEpochMs = now
      const holdDeadline = Math.min(deadlineEpochMs, acquireSentAtEpochMs + MAX_LOCK_HOLD_MS)
      const owner = {}
      operationInFlight = true
      txState = 'open'
      txOwner = owner
      try {
        let begun: Awaited<ReturnType<T15EPersistentPsqlTransport['executeTrustedCommand']>>
        try {
          begun = await transport.executeTrustedCommand({ kind: 'COORDINATOR_BEGIN' }, holdDeadline)
        } catch {
          const rolledBack = await rollbackOwned(owner, holdDeadline)
          return fail(rolledBack ? 'T15E_COORDINATOR_ADAPTER_THROW' : 'T15E_COORDINATOR_TRANSACTION_UNPROVEN', rolledBack)
        }
        if (gate(holdDeadline) !== null || !begun.ok || begun.frame.result.begun !== true) {
          const rolledBack = await rollbackOwned(owner, holdDeadline)
          const category = gate(holdDeadline) ?? (rolledBack ? 'T15E_COORDINATOR_TRANSPORT_REJECTED' : 'T15E_COORDINATOR_TRANSACTION_UNPROVEN')
          return fail(category, rolledBack)
        }
        let locked: Awaited<ReturnType<T15EPersistentPsqlTransport['executeTrustedCommand']>>
        try {
          locked = await transport.executeTrustedCommand(
            { kind: 'COORDINATOR_LOCK_NO_KEY_UPDATE', requestId },
            holdDeadline,
          )
        } catch {
          const rolledBack = await rollbackOwned(owner, holdDeadline)
          return fail(rolledBack ? 'T15E_COORDINATOR_ADAPTER_THROW' : 'T15E_COORDINATOR_TRANSACTION_UNPROVEN', rolledBack)
        }
        const postLock = gate(holdDeadline)
        const row = locked.ok ? locked.frame.result : null
        const matched = row !== null &&
          row.found === true &&
          row.requestId === requestId &&
          row.status === T15E_COORDINATOR_ARM_STAGE &&
          row.runNonce === runNonce &&
          row.pid === identity.pid &&
          row.backendStart === identity.backendStart &&
          row.databaseId === identity.databaseId
        const rolledBack = await rollbackOwned(owner, holdDeadline)
        const postRollback = gate(holdDeadline)
        if (!rolledBack) return fail('T15E_COORDINATOR_TRANSACTION_UNPROVEN', false)
        if (postLock !== null || postRollback !== null) {
          return fail(postLock ?? postRollback ?? 'T15E_COORDINATOR_ACK_TIMEOUT', true)
        }
        if (!locked.ok || !matched) return fail('T15E_COORDINATOR_LOCK_NOT_ELIGIBLE', true)
        return {
          ok: true,
          readyEligible: false,
          historical: {
            kind: 'HISTORICAL_ACQUISITION',
            runNonce,
            requestId,
            acquireSentAtEpochMs,
            lockReleased: true,
            rollbackAcknowledged: true,
            currentlyLocked: false,
          },
          acquireSentAtEpochMs,
          rolledBack: true,
        }
      } finally {
        operationInFlight = false
      }
    },
    async acquireHeld(requestId, deadlineEpochMs) {
      const entry = gate(deadlineEpochMs)
      if (entry !== null) return fail(entry)
      if (identity === null || transport === null) return fail('T15E_COORDINATOR_NOT_OPEN')
      const heldIdentity = identity
      const liveTransport = transport
      if (!isValidCanonicalUuid(requestId) || armedRequestId !== requestId) {
        return fail('T15E_COORDINATOR_INVALID_REQUEST')
      }
      const now = clock.nowEpochMs()
      const windowMs = deadlineEpochMs - now
      if (windowMs > MAX_LOCK_HOLD_MS) return fail('T15E_COORDINATOR_HOLD_EXCEEDS_HARD_MAX')
      if (windowMs <= T15E_DEADLINES_MS.releaseReserve) {
        return fail('T15E_COORDINATOR_RELEASE_RESERVE_UNAVAILABLE')
      }
      const busy = operationGate()
      if (busy !== null) return fail(busy)
      const acquireSentAt = now
      const holdEnd = acquireSentAt + windowMs
      const releaseStart = holdEnd - T15E_DEADLINES_MS.releaseReserve
      const owner = {}
      const timer = deps.transportDeps.scheduleTimer(releaseStart - clock.nowEpochMs())
      const watch = {
        owner,
        requestId,
        acquireSentAt,
        holdEnd,
        releaseStart,
        timer,
        releaseStarted: false,
        voidRequested: false,
        commandInFlight: false,
      }
      heldWatch = watch
      timer.fired.then(() => {
        if (heldWatch !== watch) return
        if (watch.commandInFlight) {
          watch.voidRequested = true
          return
        }
        void releaseHeld(owner, holdEnd)
      })
      operationInFlight = true
      txState = 'open'
      txOwner = owner
      const finishHeld = async (): Promise<T15ECoordinatorAcquireResult | { ok: true; held: T15EHeldLock }> => {
        watch.commandInFlight = true
        try {
          const begun = await liveTransport.executeTrustedCommand({ kind: 'COORDINATOR_BEGIN' }, holdEnd)
          if (!begun.ok || begun.frame.result.begun !== true || gate(holdEnd) !== null || watch.voidRequested) {
            watch.commandInFlight = false
            const rolledBack = await releaseHeld(owner, holdEnd)
            return fail(rolledBack ? 'T15E_COORDINATOR_TRANSPORT_REJECTED' : 'T15E_COORDINATOR_TRANSACTION_UNPROVEN', rolledBack)
          }
          const locked = await liveTransport.executeTrustedCommand(
            { kind: 'COORDINATOR_LOCK_NO_KEY_UPDATE', requestId },
            holdEnd,
          )
          const row = locked.ok ? locked.frame.result : null
          const matched = gate(holdEnd) === null && row !== null &&
            row.found === true &&
            row.requestId === requestId &&
            row.status === T15E_COORDINATOR_ARM_STAGE &&
            row.runNonce === runNonce &&
            row.pid === heldIdentity.pid &&
            row.backendStart === heldIdentity.backendStart &&
            row.databaseId === heldIdentity.databaseId &&
            clock.nowEpochMs() < watch.releaseStart
          watch.commandInFlight = false
          if (!transportAccepted()) {
            markHeldUncertain(owner, watch.timer)
            return fail('T15E_COORDINATOR_TRANSPORT_UNUSABLE')
          }
          if (!matched || watch.voidRequested || watch.releaseStarted) {
            const rolledBack = watch.releaseStarted ? false : await releaseHeld(owner, holdEnd)
            return fail(rolledBack ? 'T15E_COORDINATOR_LOCK_NOT_ELIGIBLE' : 'T15E_COORDINATOR_TRANSACTION_UNPROVEN', rolledBack)
          }
          const held: T15EHeldLock = {
            ready() {
              if (!transportAccepted()) {
                markHeldUncertain(owner, watch.timer)
                return { ok: false, category: 'T15E_COORDINATOR_TRANSPORT_UNUSABLE', message: T15E_SAFE_ERROR_MESSAGE }
              }
              if (heldWatch !== watch || txState !== 'open' || watch.releaseStarted || txOwner !== owner) {
                return { ok: false, category: 'T15E_COORDINATOR_LOCK_NOT_HELD', message: T15E_SAFE_ERROR_MESSAGE }
              }
              if (clock.nowEpochMs() >= watch.releaseStart) {
                return { ok: false, category: 'T15E_COORDINATOR_HOLD_EXPIRED', message: T15E_SAFE_ERROR_MESSAGE }
              }
              const fresh = gate(watch.holdEnd)
              if (fresh !== null) return { ok: false, category: fresh, message: T15E_SAFE_ERROR_MESSAGE }
              return {
                ok: true,
                ready: {
                  kind: 'READY',
                  runNonce,
                  requestId,
                  lockAck: { runNonce, requestId, locked: true, acquireSentAtEpochMs: acquireSentAt },
                },
              }
            },
            async release() {
              if (heldWatch !== watch || watch.owner !== owner || watch.releaseStarted || txState !== 'open') {
                return fail('T15E_COORDINATOR_STALE_RELEASE')
              }
              const rolledBack = await releaseHeld(owner, watch.holdEnd)
              if (!rolledBack || clock.nowEpochMs() >= watch.holdEnd) {
                return fail('T15E_COORDINATOR_TRANSACTION_UNPROVEN', false)
              }
              return {
                ok: true,
                readyEligible: false,
                historical: {
                  kind: 'HISTORICAL_ACQUISITION',
                  runNonce,
                  requestId,
                  acquireSentAtEpochMs: acquireSentAt,
                  lockReleased: true,
                  rollbackAcknowledged: true,
                  currentlyLocked: false,
                },
                acquireSentAtEpochMs: acquireSentAt,
                rolledBack: true,
              }
            },
          }
          return { ok: true, held }
        } catch {
          watch.commandInFlight = false
          const rolledBack = await releaseHeld(owner, holdEnd)
          return fail(rolledBack ? 'T15E_COORDINATOR_ADAPTER_THROW' : 'T15E_COORDINATOR_TRANSACTION_UNPROVEN', rolledBack)
        } finally {
          operationInFlight = false
          watch.commandInFlight = false
          if (watch.voidRequested && txState === 'open' && txOwner === owner && !watch.releaseStarted) {
            await releaseHeld(owner, holdEnd)
          }
        }
      }
      return finishHeld()
    },
    async dispose(deadlineEpochMs) {
      // Fence first. An established hold is released by this same owner.
      // An in-flight command keeps its own rollback. Child exit is not backend gone.
      disposed = true
      const watch = heldWatch
      if (watch !== null) watch.voidRequested = true
      if (watch !== null && !watch.commandInFlight && txState === 'open' && txOwner === watch.owner) {
        await releaseHeld(watch.owner, Math.min(deadlineEpochMs, watch.holdEnd))
      }
      if (transport === null) {
        return {
          ok: true,
          childExited: false,
          cleanupFailures: [],
          terminalCleanup: 'complete',
          backendGoneConfirmed: false,
          pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION',
        }
      }
      const outcome = await transport.dispose(deadlineEpochMs)
      return {
        ok: outcome.ok,
        childExited: outcome.childExited,
        cleanupFailures: outcome.cleanupFailures,
        terminalCleanup: outcome.terminalCleanup,
        backendGoneConfirmed: false,
        pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION',
      }
    },
  }
}
