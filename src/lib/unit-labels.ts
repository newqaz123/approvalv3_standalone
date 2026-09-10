// Clean-start unit display and subtree filters (Plan B Task 12).
// unitPathNames is root-last: [unit, parent, ..., root].
import { ancestorUnitIds, descendantUnitIds } from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'

export function unitPathNames(units: readonly OrganizationUnitNode[], unitId: string): string[] {
  const byId = new Map<string, OrganizationUnitNode>()
  for (const unit of units) byId.set(unit.id, unit)
  return ancestorUnitIds(units, unitId).map((id) => {
    const unit = byId.get(id)
    if (!unit) {
      throw new Error(`unitPathNames: unit id "${id}" is missing from the given units`)
    }
    return unit.name
  })
}

export function buildUnitSubtreeRequestFilter(
  units: readonly OrganizationUnitNode[],
  unitId: string,
): { organizationUnitId: { in: string[] } } {
  return { organizationUnitId: { in: descendantUnitIds(units, unitId) } }
}
