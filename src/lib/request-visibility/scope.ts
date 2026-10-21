// Request-list visibility: origin-unit sharing (ON = department including
// sisters; OFF = origin + ancestor bosses) plus approval participation,
// explicit managedUnitIds, and Engineering work access for SentToEngineer /
// DesignCostEstimationApproval. Visibility grants no mutation rights. The
// engineering ROLE still grants no blanket visibility.
import type { Prisma } from '@prisma/client'
import { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'
import { ancestorUnitIds, descendantUnitIds, NoSharingScopeError } from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import { visibleRequestOriginUnitIds } from '@/lib/organization/sharing'

export interface RequestVisibilityActor {
  id: string
  role: 'admin' | 'general_dept' | 'engineering'
  isActive: boolean
  assignmentUnitId: string | null
  sharingScopeUnitIds: readonly string[]
  managedUnitIds: readonly string[]
  /** True when the assignment unit or an ancestor can work on solutions. */
  canWorkOnSolutions?: boolean
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
  if (actor.canWorkOnSolutions) {
    relationships.push({
      status: { in: ['SentToEngineer', 'DesignCostEstimationApproval'] },
    })
  }
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

type VisibilityUnitRow = {
  id: string
  name: string
  parentId: string | null
  isActive: boolean
  shareRequests: boolean
  canWorkOnSolutions: boolean
  managerUserId: string | null
}

export type RequestVisibilityPrisma = {
  user: {
    findUnique(args: {
      where: { id: string }
      select: { id: true; isActive: true; role: true }
    }): Promise<{ id: string; isActive: boolean; role: string } | null>
  }
  organization_assignments: {
    findFirst(args: {
      where: { userId: string; isActive: boolean }
      select: { unitId: true }
    }): Promise<{ unitId: string } | null>
  }
  organization_units: {
    findMany(args: {
      select: {
        id: true
        name: true
        parentId: true
        isActive: true
        shareRequests: true
        canWorkOnSolutions: true
        managerUserId: true
      }
    }): Promise<VisibilityUnitRow[]>
  }
  requests: {
    findFirst(args: {
      where: Prisma.requestsWhereInput
      select: { id: true }
    }): Promise<{ id: string } | null>
  }
}

function asActorRole(role: string): RequestVisibilityActor['role'] {
  if (role === 'admin' || role === 'engineering') return role
  return 'general_dept'
}

function toUnitNode(unit: VisibilityUnitRow): OrganizationUnitNode {
  return {
    id: unit.id,
    name: unit.name,
    parentId: unit.parentId,
    isActive: unit.isActive,
    shareRequests: unit.shareRequests,
    canWorkOnSolutions: unit.canWorkOnSolutions,
    managerUserId: unit.managerUserId,
  }
}

export function createRequestVisibilityDb(client: RequestVisibilityPrisma): RequestVisibilityDb {
  return {
    async findActor(userId) {
      const user = await client.user.findUnique({
        where: { id: userId },
        select: { id: true, isActive: true, role: true },
      })
      if (!user) return null

      const assignment = await client.organization_assignments.findFirst({
        where: { userId, isActive: true },
        select: { unitId: true },
      })

      const units = await client.organization_units.findMany({
        select: {
          id: true,
          name: true,
          parentId: true,
          isActive: true,
          shareRequests: true,
          canWorkOnSolutions: true,
          managerUserId: true,
        },
      })
      const nodes = units.map(toUnitNode)

      let sharing: readonly string[] = []
      let canWorkOnSolutions = false
      if (assignment) {
        try {
          sharing = visibleRequestOriginUnitIds(nodes, assignment.unitId)
        } catch (error) {
          if (!(error instanceof NoSharingScopeError)) throw error
        }
        try {
          canWorkOnSolutions = ancestorUnitIds(nodes, assignment.unitId).some((id) => {
            const unit = nodes.find((row) => row.id === id)
            return unit?.canWorkOnSolutions === true
          })
        } catch {
          canWorkOnSolutions = false
        }
      }

      const managed = new Set<string>()
      for (const unit of units) {
        if (unit.managerUserId !== user.id) continue
        for (const id of descendantUnitIds(nodes, unit.id)) managed.add(id)
      }

      return {
        id: user.id,
        role: asActorRole(user.role),
        isActive: user.isActive,
        assignmentUnitId: assignment?.unitId ?? null,
        sharingScopeUnitIds: sharing,
        managedUnitIds: [...managed],
        canWorkOnSolutions,
      }
    },
    async findRequest(where) {
      return client.requests.findFirst({
        where,
        select: { id: true },
      })
    },
  }
}

export async function canUserViewRequest(userId: string, requestId: string): Promise<boolean> {
  const { default: prisma } = await import('@/lib/prisma')
  return canViewRequestByPredicate(createRequestVisibilityDb(prisma), userId, requestId)
}
