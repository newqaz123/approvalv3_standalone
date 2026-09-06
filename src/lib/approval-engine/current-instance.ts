/**
 * Current-instance identity filter for approval-row queries.
 *
 * Shared by the server actions and the lib workflow modules: legacy rows
 * (instanceId null) always count, NEW rows count only while their instance is
 * not superseded, so superseded resubmission history never looks current in
 * any pending, action, blocking, or notification query.
 *
 * This module is intentionally dependency-free: both `request-status-transition.ts`
 * and `request-approval-transaction.ts` sit inside the import closure of the
 * approval engine, so a shared import here (instead of from
 * `phase-adapters.ts`) keeps the lib graph acyclic.
 */
export const CURRENT_INSTANCE_ROW_FILTER = [
  { instanceId: null },
  { instance: { supersededAt: null } },
] as const
