// Request-origin sharing (owner-approved 2026-09-18):
//   ON  = share this unit's requests with the rest of the department
//         (parent + every sister unit under that parent).
//   OFF = only this unit (and its children) plus bosses on the ancestor
//         chain (section manager sits in the unit; department manager sits
//         on the parent). Sister units cannot see it.
// Engineering work access is NOT sharing: units with canWorkOnSolutions may
// still see requests that have been sent to Engineering (handled in
// request-visibility/scope.ts).
// Visibility only: this module grants no mutation, approval, or notification
// rights.
import { ancestorUnitIds, descendantUnitIds, nearestSharingScopeUnitId } from './hierarchy'
import type { OrganizationUnitNode } from './model'

/**
 * Legacy viewer-window helper: subtree of the nearest sharing-enabled
 * self-or-ancestor. Kept for existing call sites that are not request lists.
 */
export function sharingScopeUnitIds(units: readonly OrganizationUnitNode[], assignmentUnitId: string): string[] {
  return descendantUnitIds(units, nearestSharingScopeUnitId(units, assignmentUnitId))
}

/**
 * Origin-unit ids whose requests this viewer may see via the sharing switch.
 * Sharing ON on an origin → every assignment under that origin's parent
 * (the department) may see it, including sister sections.
 * Sharing OFF on an origin → only the origin subtree and ancestor units
 * (bosses), never sisters.
 */
export function visibleRequestOriginUnitIds(
  units: readonly OrganizationUnitNode[],
  viewerUnitId: string,
): string[] {
  const visible: string[] = []
  // Inactive origin units are NOT skipped: deactivating a unit must not hide
  // its existing requests, so they keep the same sharing rule as when the
  // unit was active. This is read-only visibility; creating new work
  // (submission, Final initiation, solution work) still requires an active
  // unit/assignment and is enforced elsewhere.
  for (const origin of units) {
    if (viewerCanSeeOrigin(units, viewerUnitId, origin)) visible.push(origin.id)
  }
  return visible
}

function viewerCanSeeOrigin(
  units: readonly OrganizationUnitNode[],
  viewerUnitId: string,
  origin: OrganizationUnitNode,
): boolean {
  if (origin.shareRequests) {
    const parentScopeId = origin.parentId ?? origin.id
    return descendantUnitIds(units, parentScopeId).includes(viewerUnitId)
  }
  if (descendantUnitIds(units, origin.id).includes(viewerUnitId)) return true
  return ancestorUnitIds(units, origin.id).includes(viewerUnitId)
}
