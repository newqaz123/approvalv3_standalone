// Clean-start unit-subtree assignee listing (Plan B Task 12).
// Authorization uses the Task 8 visibility actor: admin, sharing scope, or
// managed descendants. Listing itself is not request visibility.
import { descendantUnitIds } from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import type { RequestVisibilityActor } from '@/lib/request-visibility/scope'
import { unitPathNames } from '@/lib/unit-labels'

export interface UnitUserRow {
  id: string
  name: string
  email: string
  positionName: string
  unitPathNames: string[]
}

export interface UnitUsersAssignmentRow {
  userId: string
  unitId: string
  isActive: boolean
  positionName: string
  user: { id: string; name: string; email: string; isActive: boolean } | null
}

export interface UnitUsersQueryDb {
  units: readonly OrganizationUnitNode[]
  assignments: readonly UnitUsersAssignmentRow[]
}

export type UnitUsersAuthResult = 'ok' | 'unauthorized' | 'forbidden'

export function authorizeUnitUsersQuery(
  actor: RequestVisibilityActor | null,
  unitId: string,
): UnitUsersAuthResult {
  if (!actor) return 'unauthorized'
  if (!actor.isActive) return 'forbidden'
  if (actor.role === 'admin') return 'ok'
  if (actor.sharingScopeUnitIds.includes(unitId)) return 'ok'
  if (actor.managedUnitIds.includes(unitId)) return 'ok'
  return 'forbidden'
}

export function listActiveUnitSubtreeUsers(
  db: UnitUsersQueryDb,
  unitId: string,
): UnitUserRow[] {
  const subtree = new Set(descendantUnitIds(db.units, unitId))
  const rows: UnitUserRow[] = []
  const seen = new Set<string>()
  for (const assignment of db.assignments) {
    if (!assignment.isActive) continue
    if (!subtree.has(assignment.unitId)) continue
    const user = assignment.user
    if (!user || !user.isActive) continue
    if (seen.has(user.id)) continue
    seen.add(user.id)
    rows.push({
      id: user.id,
      name: user.name,
      email: user.email,
      positionName: assignment.positionName,
      unitPathNames: unitPathNames(db.units, assignment.unitId),
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return rows
}
