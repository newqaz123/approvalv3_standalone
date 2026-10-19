/**
 * T15E monitor-session adapter (Task89) — FIRST bounded integration slice.
 * Backs an INDEPENDENT monitor connection with the EXISTING persistent
 * transport (fake execution only: native factory code exists but is never
 * invoked; tests use fake children/clocks; no spawn/DB).
 *
 * Fixed surface: the adapter issues ONLY three trusted command kinds — the
 * transport's identity connect, CLEAR_STATS_SNAPSHOT, and
 * SELECT_ACTIVITY_FOR_PID (validated pid, canonical backendStart expression
 * shared with the coordinator SQL). No arbitrary SQL anywhere.
 *
 * Ordering boundary (NO privileged revocation bypass): the producer's
 * stop/remove revoke ALL capabilities at teardown entry, so a monitor session
 * MUST be opened while the producer allocation is LIVE and the coordinator-
 * gone confirmation MUST complete BEFORE producer teardown. If the capability
 * is revoked at any point, every operation fails UNPROVEN — there is no
 * monitor-privileged mint or bypass.
 *
 * Honesty contract: disposal NEVER equates child exit with backend gone; the
 * monitor's OWN backend disappearance requires the separate outer runtime
 * teardown proof (pending, not recursed here).
 */

import type {
  T15EPersistentPsqlConfig,
  T15EPersistentPsqlTransport,
} from './t15e-persistent-session-transport'
import { createT15EPersistentPsqlTransport } from './t15e-persistent-session-transport'
import { isValidT15ECanonicalBackendStart } from './t15e-backend-monitor'
import { isT15ECapabilityLive } from './postgres-instance'
import type { T15EChildDisposalOutcome } from './t15e-persistent-session-transport'

export const T15E_MONITOR_SESSION_ADAPTER_CONTRACT: readonly string[] = [
  'OPEN_WHILE_LIVE: the monitor session is established BEFORE the coordinator barrier, while the producer allocation is still live (stop/remove revoke all capabilities at teardown entry)',
  'CONFIRM_BEFORE_TEARDOWN: coordinator-gone confirmation must complete BEFORE producer stop/remove — after revocation every operation fails unproven',
  'SEPARATE_CONNECTION: its own transport child; the monitor backend pid must differ from the coordinator pid (same pid => rejected)',
  'FIXED_SURFACE_ONLY: identity connect, CLEAR_STATS_SNAPSHOT, SELECT_ACTIVITY_FOR_PID — nothing else',
  'NO_BACKEND_GONE_FROM_EXIT: child/writable closure is NEVER backend gone; the monitor own-backend disappearance is pending outer runtime teardown proof',
]

export type T15EMonitorSessionFailureCategory =
  | 'T15E_MONITOR_SESSION_NOT_OPEN'
  | 'T15E_MONITOR_SESSION_DEADLINE_EXCEEDED'
  | 'T15E_MONITOR_SESSION_DISPOSED'
  | 'T15E_MONITOR_SESSION_TRANSPORT_REJECTED'
  | 'T15E_MONITOR_SESSION_CONNECT_FAILED'
  | 'T15E_MONITOR_SESSION_REVOKED'
  | 'T15E_MONITOR_SESSION_QUERY_FAILED'
  | 'T15E_MONITOR_SESSION_MALFORMED'
  | 'T15E_MONITOR_SESSION_SAME_BACKEND'

export interface T15EMonitorSessionInfo {
  monitorBackend: { pid: number; backendStart: string; databaseId: number }
  cluster: { dataDirectory: string; serverPort: number; databaseName: string }
}

export type T15EMonitorSessionQueryResult =
  | { ok: true; found: false }
  | { ok: true; found: true; pid: number; backendStart: string; databaseId: number }
  | { ok: false; category: T15EMonitorSessionFailureCategory }

export type T15EMonitorSessionOpenResult =
  | { ok: true; info: Readonly<T15EMonitorSessionInfo> }
  | { ok: false; category: T15EMonitorSessionFailureCategory }

export interface T15EMonitorSessionAdapter {
  open(deadlineEpochMs: number): Promise<T15EMonitorSessionOpenResult>
  /** Typed single commands (Task91 bridge split): clear, then activity — the
   *  SAME single connection; each carries the full acceptance gates. */
  clearStatsSnapshot(deadlineEpochMs: number): Promise<{ ok: true } | { ok: false; category: T15EMonitorSessionFailureCategory }>
  lookupActivity(pid: number, deadlineEpochMs: number): Promise<T15EMonitorSessionQueryResult>
  queryCoordinatorIdentity(pid: number, deadlineEpochMs: number): Promise<T15EMonitorSessionQueryResult>
  dispose(deadlineEpochMs: number): Promise<T15EChildDisposalOutcome>
  info(): Readonly<T15EMonitorSessionInfo> | null
  /**
   * Synchronous acceptance fence over the CAPTURED capability, the injected
   * clock, and the adapter-disposed flag. Historical `info()` is not read
   * and is not a liveness proof. Does not reopen, mint, or issue SQL.
   * Returns null only while all three still accept `deadlineEpochMs`.
   */
  checkAcceptance(deadlineEpochMs: number): T15EMonitorSessionFailureCategory | null
}

export interface T15EMonitorSessionAdapterDeps {
  config: T15EPersistentPsqlConfig
  /** Injected transport dependencies (fake spawn/clock/timers in tests). */
  transportDeps: Parameters<typeof createT15EPersistentPsqlTransport>[1]
  createTransport?: typeof createT15EPersistentPsqlTransport
}

function frozenInfo(
  identity: { pid: number; backendStart: string; databaseId: number },
  cluster: { dataDirectory: string; serverPort: number; databaseName: string },
): Readonly<T15EMonitorSessionInfo> {
  return Object.freeze({
    monitorBackend: Object.freeze({ ...identity }),
    cluster: Object.freeze({ ...cluster }),
  })
}

/** Strict decode of the one-row activity frame. A parse/shape failure is an
 *  ERROR — it can NEVER become { found:false } (never absent-by-accident). */
function decodeActivityFrame(result: Record<string, unknown>): T15EMonitorSessionQueryResult {
  if (typeof result.found !== 'boolean') {
    return { ok: false, category: 'T15E_MONITOR_SESSION_MALFORMED' }
  }
  if (!result.found) return { ok: true, found: false }
  if (
    typeof result.pid !== 'number' || !Number.isInteger(result.pid) || result.pid <= 0 ||
    !isValidT15ECanonicalBackendStart(result.backendStart) ||
    typeof result.databaseId !== 'number' || !Number.isInteger(result.databaseId)
  ) {
    return { ok: false, category: 'T15E_MONITOR_SESSION_MALFORMED' }
  }
  return { ok: true, found: true, pid: result.pid, backendStart: result.backendStart, databaseId: result.databaseId }
}

export function createT15EMonitorSessionAdapter(
  deps: T15EMonitorSessionAdapterDeps,
): T15EMonitorSessionAdapter {
  // Task90/Task92 acceptance fence: an IMMUTABLE bound capability reference,
  // the injected clock, and a SYNCHRONOUS adapter-disposed flag. Shared by
  // every operation and by checkAcceptance. It does not read session info,
  // reopen, mint, or issue SQL. Historical info() is not a liveness proof.
  const boundCapability = deps.config.capability
  const clock = deps.transportDeps.clock
  let adapterDisposed = false
  const gate = (deadlineEpochMs: number): T15EMonitorSessionFailureCategory | null => {
    if (adapterDisposed) return 'T15E_MONITOR_SESSION_DISPOSED'
    if (typeof deadlineEpochMs !== 'number' || !Number.isFinite(deadlineEpochMs) || clock.nowEpochMs() >= deadlineEpochMs) {
      return 'T15E_MONITOR_SESSION_DEADLINE_EXCEEDED'
    }
    if (!isT15ECapabilityLive(boundCapability)) return 'T15E_MONITOR_SESSION_REVOKED'
    return null
  }
  const create = deps.createTransport ?? createT15EPersistentPsqlTransport
  const created = create(deps.config, deps.transportDeps)
  if (!created.ok) {
    return {
      open: async () => ({ ok: false, category: 'T15E_MONITOR_SESSION_TRANSPORT_REJECTED' }),
      clearStatsSnapshot: async () => ({ ok: false, category: 'T15E_MONITOR_SESSION_TRANSPORT_REJECTED' }),
      lookupActivity: async () => ({ ok: false, category: 'T15E_MONITOR_SESSION_TRANSPORT_REJECTED' }),
      queryCoordinatorIdentity: async () => ({ ok: false, category: 'T15E_MONITOR_SESSION_TRANSPORT_REJECTED' }),
      dispose: async () => {
        adapterDisposed = true
        return {
          ok: true, childExited: false, cleanupFailures: [], terminalCleanup: 'complete',
          backendGoneConfirmed: false, pendingObligation: 'INDEPENDENT_BACKEND_GONE_CONFIRMATION',
        }
      },
      info: () => null,
      checkAcceptance: (deadlineEpochMs) => gate(deadlineEpochMs),
    }
  }
  const transport: T15EPersistentPsqlTransport = created.transport
  let sessionInfo: Readonly<T15EMonitorSessionInfo> | null = null
  // Every gate runs BEFORE any SQL is issued and again after EVERY await,
  // immediately before publishing success — a transport success resolved
  // before a revoke/dispose can never be published afterwards, and an overdue
  // absence is never ok.
  return {
    async open(deadlineEpochMs: number): Promise<T15EMonitorSessionOpenResult> {
      const entry = gate(deadlineEpochMs)
      if (entry !== null) return { ok: false, category: entry }
      const connected = await transport.connect(deadlineEpochMs)
      // Post-await acceptance recheck BEFORE publishing success.
      const post = gate(deadlineEpochMs)
      if (post !== null) return { ok: false, category: post }
      if (!connected.ok) {
        return { ok: false, category: 'T15E_MONITOR_SESSION_CONNECT_FAILED' }
      }
      const cluster = transport.verifiedCluster()
      if (cluster === null) {
        return { ok: false, category: 'T15E_MONITOR_SESSION_CONNECT_FAILED' }
      }
      // NOTE: verifiedCluster() is HISTORICAL metadata — the cluster identity
      // observed and verified at connect time. It is NOT a liveness proof;
      // liveness is re-gated on every operation via the bound capability.
      sessionInfo = frozenInfo(connected.identity, cluster)
      return { ok: true, info: sessionInfo }
    },
    async clearStatsSnapshot(deadlineEpochMs: number): Promise<{ ok: true } | { ok: false; category: T15EMonitorSessionFailureCategory }> {
      if (sessionInfo === null) return { ok: false, category: 'T15E_MONITOR_SESSION_NOT_OPEN' }
      const entry = gate(deadlineEpochMs)
      if (entry !== null) return { ok: false, category: entry }
      const cleared = await transport.executeTrustedCommand({ kind: 'CLEAR_STATS_SNAPSHOT' }, deadlineEpochMs)
      const post = gate(deadlineEpochMs)
      if (post !== null) return { ok: false, category: post }
      if (!cleared.ok) {
        return {
          ok: false,
          category: cleared.category === 'T15E_CAPABILITY_REVOKED'
            ? 'T15E_MONITOR_SESSION_REVOKED'
            : 'T15E_MONITOR_SESSION_QUERY_FAILED',
        }
      }
      return { ok: true }
    },
    async lookupActivity(pid: number, deadlineEpochMs: number): Promise<T15EMonitorSessionQueryResult> {
      if (sessionInfo === null) return { ok: false, category: 'T15E_MONITOR_SESSION_NOT_OPEN' }
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
        return { ok: false, category: 'T15E_MONITOR_SESSION_MALFORMED' }
      }
      if (pid === sessionInfo.monitorBackend.pid) {
        return { ok: false, category: 'T15E_MONITOR_SESSION_SAME_BACKEND' }
      }
      const entry = gate(deadlineEpochMs)
      if (entry !== null) return { ok: false, category: entry }
      const queried = await transport.executeTrustedCommand({ kind: 'SELECT_ACTIVITY_FOR_PID', pid }, deadlineEpochMs)
      const post = gate(deadlineEpochMs)
      if (post !== null) return { ok: false, category: post }
      if (!queried.ok) {
        return queried.category === 'T15E_CAPABILITY_REVOKED'
          ? { ok: false, category: 'T15E_MONITOR_SESSION_REVOKED' }
          : { ok: false, category: 'T15E_MONITOR_SESSION_QUERY_FAILED' }
      }
      return decodeActivityFrame(queried.frame.result)
    },
    async queryCoordinatorIdentity(pid: number, deadlineEpochMs: number): Promise<T15EMonitorSessionQueryResult> {
      // Pre-checks BEFORE any SQL (same-backend rejection wastes no command):
      if (sessionInfo === null) return { ok: false, category: 'T15E_MONITOR_SESSION_NOT_OPEN' }
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
        return { ok: false, category: 'T15E_MONITOR_SESSION_MALFORMED' }
      }
      if (pid === sessionInfo.monitorBackend.pid) {
        return { ok: false, category: 'T15E_MONITOR_SESSION_SAME_BACKEND' }
      }
      // Fixed pair on the SAME connection: clear BEFORE every activity.
      const cleared = await this.clearStatsSnapshot(deadlineEpochMs)
      if (!cleared.ok) return cleared
      return this.lookupActivity(pid, deadlineEpochMs)
    },
    async dispose(deadlineEpochMs: number): Promise<T15EChildDisposalOutcome> {
      // Synchronous adapter fence FIRST: nothing may start or publish after
      // disposal began. Cleanup itself stays allowed (also after revocation)
      // so the exact owned handle is still torn down.
      adapterDisposed = true
      // Passes through the transport's STABLE disposal snapshots. Child exit
      // and writable closure are NEVER backend gone (backendGoneConfirmed is
      // the transport's constant false; the monitor's OWN backend requires
      // the pending outer runtime teardown proof — no recursion here).
      return transport.dispose(deadlineEpochMs)
    },
    info: () => sessionInfo,
    checkAcceptance: (deadlineEpochMs) => gate(deadlineEpochMs),
  }
}
