/**
 * Current-instance identity filter for approval-row queries.
 *
 * Shared by the server actions and the lib workflow modules: legacy rows
 * (instanceId null) always count, NEW rows count only while their instance is
 * not superseded, so superseded resubmission history never looks current in
 * any pending, action, blocking, or notification query.
 *
 * This module is intentionally dependency-free so request-status-transition
 * and server-action query builders can share the filter without importing
 * the Prisma-backed transaction adapter.
 */
export const CURRENT_INSTANCE_ROW_FILTER = [
  { instanceId: null },
  { instance: { supersededAt: null } },
] as const

/** Prisma predicate for a snapshot-group actionable row: persisted membership. */
export function snapshotGroupActionWhere(userId: string) {
  return {
    routingMode: 'SNAPSHOT_GROUP' as const,
    candidateGroup: { members: { some: { userId } } },
  }
}
