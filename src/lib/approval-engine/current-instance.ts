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

/** In-memory equivalent of CURRENT_INSTANCE_ROW_FILTER for already-loaded rows. */
export function isCurrentInstanceApproval(row: {
  instanceId?: string | null
  instance?: { supersededAt: Date | string | null } | null
}): boolean {
  if (row.instanceId == null) return true
  return row.instance != null && row.instance.supersededAt == null
}

/** Prisma predicate for a snapshot-group actionable row: persisted membership. */
export function snapshotGroupActionWhere(userId: string) {
  return {
    routingMode: 'SNAPSHOT_GROUP' as const,
    candidateGroup: { members: { some: { userId } } },
  }
}
