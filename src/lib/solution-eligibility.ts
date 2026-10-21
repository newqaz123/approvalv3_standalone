// Clean-start solution-work eligibility (Plan A Task 5).
// Admins explicitly mark an organization unit Can work on solutions (for
// example Engineering); people actively assigned to that unit or ANY
// descendant may submit and revise solutions. The flag is inherited by all
// descendant units and is not a per-person capability, a legacy department
// type, or a role — and it confers no approval, visibility, or notification
// rights. No legacy consumer is wired to this module yet.
//
// Fail-closed consulted-chain semantics, mirroring hierarchy.ancestorUnitIds
// (the accepted Task 2 contract split: nearest-sharing validates globally;
// ancestor traversal validates the walked chain): the entire self -> root
// chain is validated BEFORE any flag is consulted, so an immediately flagged
// unit with a corrupt ancestor chain throws instead of silently returning
// true, and a missing target unit id or cyclic/missing-parent chain throws
// instead of silently returning false. Inactive flagged units never confer
// eligibility, but traversal continues through them.
import { ancestorUnitIds } from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'

/** True iff the assignment unit is non-null and the unit or any ancestor on its validated chain is active and flagged canWorkOnSolutions. */
export function canWorkOnSolutions(units: readonly OrganizationUnitNode[], assignmentUnitId: string | null): boolean {
  if (assignmentUnitId === null) return false
  const byId = new Map<string, OrganizationUnitNode>(units.map((unit) => [unit.id, unit]))
  for (const unitId of ancestorUnitIds(units, assignmentUnitId)) {
    const unit = byId.get(unitId)
    if (unit !== undefined && unit.isActive && unit.canWorkOnSolutions) return true
  }
  return false
}
