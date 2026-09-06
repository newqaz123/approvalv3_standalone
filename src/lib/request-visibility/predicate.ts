import type { Prisma } from '@prisma/client'
import type {
  RequestVisibilityActor,
  RequestVisibilityDb,
  RequestVisibilityOptions,
} from '@/lib/request-visibility/types'

export type {
  RequestVisibilityActor,
  RequestVisibilityDb,
  RequestVisibilityOptions,
}

export async function buildRequestVisibilityWhere(
  db: RequestVisibilityDb,
  options: RequestVisibilityOptions,
): Promise<Prisma.requestsWhereInput> {
  const actor = await db.findActor(options.userId)
  if (!actor || !actor.isActive) return { id: { in: [] } }
  const base = { isDeleted: false, ...(options.includeArchived ? {} : { isArchived: false }) }
  if (actor.role === 'admin' || actor.role === 'engineering' || actor.departmentType === 'ENGINEERING') return base
  const relationships: Prisma.requestsWhereInput[] = [
    { requesterId: actor.id },
    { organizationUnitId: { in: [...actor.managedUnitIds] } },
    { approvals: { some: { approverId: actor.id } } },
    { approvals: { some: { requiredApproverId: actor.id } } },
    { approvals: { some: { candidateGroup: { members: { some: { userId: actor.id } } } } } },
    { solutions: { some: { approvals: { some: { approverId: actor.id } } } } },
    { solutions: { some: { approvals: { some: { requiredApproverId: actor.id } } } } },
    { solutions: { some: { approvals: { some: { candidateGroup: { members: { some: { userId: actor.id } } } } } } } },
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
