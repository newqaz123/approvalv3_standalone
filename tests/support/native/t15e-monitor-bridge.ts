/**
 * T15E monitor BRIDGE (Task91) — fake-only slice. Bridges the Task86 monitor
 * core's SQL-string session interface (`T15EMonitorQuerySession.query(sql)`)
 * to the Task89 adapter's TYPED commands, with NO arbitrary SQL anywhere.
 *
 * Allowlist is EXACT string equality against the canonical generated SQL
 * (`T15E_MONITOR_CLEAR_SNAPSHOT_SQL` and `buildT15EMonitorIdentityQuery(pid)`
 * for the single coordinator pid fixed at bridge creation) — never a loose
 * PID regex. Unknown SQL is rejected WITHOUT any write.
 *
 * Row mapping is total and honest: successful absence => []; successful
 * presence => [ [pid, canonicalBackendStart, databaseId] ] (string cells,
 * the psql -A -t shape the Task86 decoder expects); EVERY failure — adapter
 * rejection, revocation, disposal, malformed frame, throw — becomes a fixed
 * thrown failure, NEVER [].
 *
 * Ownership: the CALLER owns the adapter and must dispose it in a finally
 * (bounded snapshot); the same pre-established connection serves every core
 * call and disposal. The monitor's OWN backend disappearance stays the
 * pending outer-runtime teardown proof — nothing here claims live backend
 * state. The factory pre-OPENS while the capability is live, BEFORE
 * coordination; metadata (backend + cluster) is frozen from the adapter.
 *
 * Task92: adapter.info() is historical connect metadata, NOT a liveness
 * proof. Every bridge entry, every post-await point, and every open/factory/
 * query success publication re-reads the adapter's synchronous acceptance
 * fence (captured capability + injected clock + disposed flag). The factory
 * checks the deadline of THAT invocation. No reopen and no mint.
 */

import {
  T15E_MONITOR_CLEAR_SNAPSHOT_SQL,
  buildT15EMonitorIdentityQuery,
  type T15EMonitorQuerySession,
  type T15EMonitorSessionFactory,
  type T15EMonitorSessionInfo,
} from './t15e-backend-monitor'
import type { T15EMonitorSessionAdapter } from './t15e-monitor-session-adapter'

const BRIDGE_FAILURE_MESSAGE = 'T15E monitor bridge rejected the query'

export type T15EMonitorBridgeOpenResult =
  | { ok: true; factory: T15EMonitorSessionFactory; info: Readonly<T15EMonitorSessionInfo> }
  | { ok: false; category: 'T15E_MONITOR_BRIDGE_OPEN_FAILED' }

function bridgeOpenFailed(): T15EMonitorBridgeOpenResult {
  return { ok: false, category: 'T15E_MONITOR_BRIDGE_OPEN_FAILED' }
}

export function openT15EMonitorBridge(input: {
  adapter: T15EMonitorSessionAdapter
  coordinatorPid: number
  deadlineEpochMs: number
}): Promise<T15EMonitorBridgeOpenResult> {
  const { adapter, coordinatorPid, deadlineEpochMs } = input
  // Entry fence before any open. Do not treat historical info as liveness,
  // and do not reopen or mint.
  if (adapter.checkAcceptance(deadlineEpochMs) !== null) return Promise.resolve(bridgeOpenFailed())
  const allowlistedIdentitySql = buildT15EMonitorIdentityQuery(coordinatorPid)
  if (allowlistedIdentitySql === null) return Promise.resolve(bridgeOpenFailed())
  return adapter.open(deadlineEpochMs).then((opened) => {
    // Post-await, before publishing open or the factory.
    if (adapter.checkAcceptance(deadlineEpochMs) !== null) return bridgeOpenFailed()
    if (!opened.ok) return bridgeOpenFailed()
    const info = adapter.info()
    if (info === null) return bridgeOpenFailed()
    // Same pre-established connection for every core call. `info` is frozen
    // historical metadata from connect time — not a liveness proof.
    const session: T15EMonitorQuerySession = {
      async query(sql: string, queryDeadlineEpochMs: number): Promise<unknown> {
        if (adapter.checkAcceptance(queryDeadlineEpochMs) !== null) {
          throw new Error(BRIDGE_FAILURE_MESSAGE)
        }
        if (sql === T15E_MONITOR_CLEAR_SNAPSHOT_SQL) {
          const cleared = await adapter.clearStatsSnapshot(queryDeadlineEpochMs)
          if (adapter.checkAcceptance(queryDeadlineEpochMs) !== null) {
            throw new Error(BRIDGE_FAILURE_MESSAGE)
          }
          if (!cleared.ok) throw new Error(BRIDGE_FAILURE_MESSAGE)
          if (adapter.checkAcceptance(queryDeadlineEpochMs) !== null) {
            throw new Error(BRIDGE_FAILURE_MESSAGE)
          }
          return [] // clear produces no identity rows
        }
        if (sql === allowlistedIdentitySql) {
          const looked = await adapter.lookupActivity(coordinatorPid, queryDeadlineEpochMs)
          if (adapter.checkAcceptance(queryDeadlineEpochMs) !== null) {
            throw new Error(BRIDGE_FAILURE_MESSAGE)
          }
          if (!looked.ok) throw new Error(BRIDGE_FAILURE_MESSAGE) // NEVER [] on failure
          if (!looked.found) {
            if (adapter.checkAcceptance(queryDeadlineEpochMs) !== null) {
              throw new Error(BRIDGE_FAILURE_MESSAGE)
            }
            return [] // the ONLY absence path: explicit valid absence while accepted
          }
          if (adapter.checkAcceptance(queryDeadlineEpochMs) !== null) {
            throw new Error(BRIDGE_FAILURE_MESSAGE)
          }
          return [[String(looked.pid), looked.backendStart, String(looked.databaseId)]]
        }
        // Unknown SQL: rejected outright, no write, fixed failure.
        throw new Error(BRIDGE_FAILURE_MESSAGE)
      },
    }
    const factory: T15EMonitorSessionFactory = async (factoryDeadlineEpochMs: number) => {
      // Invocation deadline + captured fence. Historical info is attached,
      // not re-read as proof. No reopen and no mint.
      if (adapter.checkAcceptance(factoryDeadlineEpochMs) !== null) return { ok: false }
      return { ok: true, session, info }
    }
    if (adapter.checkAcceptance(deadlineEpochMs) !== null) return bridgeOpenFailed()
    return { ok: true, factory, info }
  })
}
