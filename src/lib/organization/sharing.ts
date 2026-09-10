// Clean-start downward-inclusive sharing scope (Plan A Task 5).
// A person uses the nearest ACTIVE sharing-enabled self-or-ancestor unit as
// their viewing scope and can view requests originating in that unit and all
// of its descendants. This is the exact composition of the Task 2 hierarchy
// helpers: the nearest-sharing lookup validates the tree globally first, and
// the descendant sweep then returns the COMPLETE subtree — child sharing
// settings never remove descendants from an ancestor member's scope (spec:
// Operations sharing contains separately sharing-enabled Sections A and B;
// Pat in Operations sees both, Alice in A sees A, Bob in B sees B).
// Visibility only: this module grants no mutation, approval, or notification
// rights, and imports nothing from the legacy organization modules.
import { descendantUnitIds, nearestSharingScopeUnitId } from './hierarchy'
import type { OrganizationUnitNode } from './model'

/** Unit ids of the assignment's viewing scope: the full subtree of the nearest active sharing-enabled self-or-ancestor unit. */
export function sharingScopeUnitIds(units: readonly OrganizationUnitNode[], assignmentUnitId: string): string[] {
  return descendantUnitIds(units, nearestSharingScopeUnitId(units, assignmentUnitId))
}
