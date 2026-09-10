// Clean-start downward-inclusive sharing-scope visibility predicate (Plan B Task 8).
// Visibility only: this module grants no mutation, approval, or notification
// rights. The engineering ROLE grants no blanket visibility. Child sharing
// settings never subtract from an ancestor member's complete subtree (A5
// sharingScopeUnitIds). Explicit parent managers retain descendant visibility
// via managedUnitIds independently of sharing scope.
import type { Prisma } from '@prisma/client'
import { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'

export interface RequestVisibilityActor {
  id: string
  role: 'admin' | 'general_dept' | 'engineering'
  isActive: boolean
  assignmentUnitId: string | null
  sharingScopeUnitIds: readonly string[]
  managedUnitIds: readonly string[]
}

export interface RequestVisibilityDb {
  findActor(userId: string): Promise<RequestVisibilityActor | null>
  findRequest(where: Prisma.requestsWhereInput): Promise<{ id: string } | null>
}

export async function buildRequestVisibilityWhere(
  db: RequestVisibilityDb,
  options: { userId: string; includeArchived: boolean },
): Promise<Prisma.requestsWhereInput> {
  const actor = await db.findActor(options.userId)
  if (!actor || !actor.isActive) return { id: { in: [] } }
  const base: Prisma.requestsWhereInput = {
    isDeleted: false,
    ...(options.includeArchived ? {} : { isArchived: false }),
  }
  if (actor.role === 'admin') return base
  const unitIds = [...new Set([...actor.sharingScopeUnitIds, ...actor.managedUnitIds])]
  const current = { OR: [...CURRENT_INSTANCE_ROW_FILTER] }
  const relationships: Prisma.requestsWhereInput[] = [
    { requesterId: actor.id },
    { organizationUnitId: { in: unitIds } },
    { approvals: { some: { approverId: actor.id, ...current } } },
    { approvals: { some: { requiredApproverId: actor.id, ...current } } },
    { approvals: { some: { candidateGroup: { members: { some: { userId: actor.id } } }, ...current } } },
    { solutions: { some: { approvals: { some: { approverId: actor.id, ...current } } } } },
    { solutions: { some: { approvals: { some: { requiredApproverId: actor.id, ...current } } } } },
    { solutions: { some: { approvals: { some: { candidateGroup: { members: { some: { userId: actor.id } } }, ...current } } } } },
  ]
  return { AND: [base, { OR: relationships }] }
}

export async function canViewRequestByPredicate(
  db: RequestVisibilityDb,
  userId: string,
  requestId: string,
): Promise<boolean> {
  const where = await buildRequestVisibilityWhere(db, { userId, includeArchived: true })
  const found = await db.findRequest({ AND: [{ id: requestId }, where] })
  return found !== null
}
