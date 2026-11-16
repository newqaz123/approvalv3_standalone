// Request-list visibility: origin-unit sharing (ON = department including
// sisters; OFF = origin + ancestor bosses) plus approval participation,
// explicit managedUnitIds, and Engineering work access for SentToEngineer /
// DesignCostEstimationApproval. Visibility grants no mutation rights. The
// engineering ROLE still grants no blanket visibility. An explicit inherited
// engineeringCanViewAllRequests flag broadens reads only; mutation callers
// exclude that grant and retain the pre-existing visibility relationships.
// Sub-task/WR work is the one exception: solution workers reach every request
// in a sub-task stage (includeSubTaskWork), because that work continues after
// the solution is approved.
import type { Prisma } from '@prisma/client'
import { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'
import { ancestorUnitIds, descendantUnitIds, NoSharingScopeError } from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import { canWorkOnSolutions as hasSolutionWorkEligibility } from '@/lib/solution-eligibility'
import { visibleRequestOriginUnitIds } from '@/lib/organization/sharing'
import { ENGINEERING_SUB_TASK_VISIBLE_STATUSES } from '@/lib/engineering-sub-tasks'

const SOLUTION_WORK_STATUSES = ['SentToEngineer', 'DesignCostEstimationApproval'] as const

export interface RequestVisibilityActor {
  id: string
  role: 'admin' | 'general_dept'
  isActive: boolean
  assignmentUnitId: string | null
  sharingScopeUnitIds: readonly string[]
  managedUnitIds: readonly string[]
  /** True when the assignment unit or an ancestor can work on solutions. */
  canWorkOnSolutions?: boolean
  /** Effective inherited read-only grant, requiring active solution-work eligibility. */
  engineeringCanViewAllRequests?: boolean
}

export interface RequestVisibilityDb {
  findActor(userId: string): Promise<RequestVisibilityActor | null>
  findRequest(where: Prisma.requestsWhereInput): Promise<{ id: string } | null>
}

export interface RequestVisibilityOptions {
  /** Mutation checks must exclude the read-only Engineering grant. Defaults to true. */
  includeEngineeringViewAll?: boolean
  /**
   * Adds every request in a sub-task stage for solution workers. Lists and
   * mutations default to false; single-request reads default to true unless
   * the caller is a mutation check (includeEngineeringViewAll: false).
   */
  includeSubTaskWork?: boolean
}

export async function buildRequestVisibilityWhere(
  db: RequestVisibilityDb,
  options: { userId: string; includeArchived: boolean } & RequestVisibilityOptions,
): Promise<Prisma.requestsWhereInput> {
  const actor = await db.findActor(options.userId)
  if (!actor || !actor.isActive) return { id: { in: [] } }
  const base: Prisma.requestsWhereInput = {
    isDeleted: false,
    ...(options.includeArchived ? {} : { isArchived: false }),
  }
  if (actor.role === 'admin') return base
  if (options.includeEngineeringViewAll !== false && actor.canWorkOnSolutions === true && actor.engineeringCanViewAllRequests === true) {
    return base
  }
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
      status: {
        in: options.includeSubTaskWork === true
          ? [...new Set([...SOLUTION_WORK_STATUSES, ...ENGINEERING_SUB_TASK_VISIBLE_STATUSES])]
          : [...SOLUTION_WORK_STATUSES],
      },
    })
  }
  return { AND: [base, { OR: relationships }] }
}

export async function canViewRequestByPredicate(
  db: RequestVisibilityDb,
  userId: string,
  requestId: string,
  options: RequestVisibilityOptions = {},
): Promise<boolean> {
  // A solution worker must be able to open the request whose sub-tasks they
  // manage. Mutation checks stay fail-closed and opt in explicitly.
  const includeSubTaskWork = options.includeSubTaskWork ?? options.includeEngineeringViewAll !== false
  const where = await buildRequestVisibilityWhere(db, { ...options, includeSubTaskWork, userId, includeArchived: true })
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
  engineeringCanViewAllRequests?: boolean
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
        engineeringCanViewAllRequests: true
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
  if (role === 'admin') return role
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
    engineeringCanViewAllRequests: unit.engineeringCanViewAllRequests ?? false,
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
          engineeringCanViewAllRequests: true,
          managerUserId: true,
        },
      })
      const nodes = units.map(toUnitNode)

      let sharing: readonly string[] = []
      let canWorkOnSolutions = false
      let engineeringCanViewAllRequests = false
      if (assignment) {
        try {
          sharing = visibleRequestOriginUnitIds(nodes, assignment.unitId)
        } catch (error) {
          if (!(error instanceof NoSharingScopeError)) throw error
        }
        try {
          const ancestors = ancestorUnitIds(nodes, assignment.unitId)
          canWorkOnSolutions = ancestors.some((id) => {
            const unit = nodes.find((row) => row.id === id)
            return unit?.canWorkOnSolutions === true
          })
          engineeringCanViewAllRequests = hasSolutionWorkEligibility(nodes, assignment.unitId)
            && ancestors.some((id) => {
              const unit = nodes.find((row) => row.id === id)
              return unit?.isActive === true && unit.engineeringCanViewAllRequests === true
            })
        } catch {
          canWorkOnSolutions = false
          engineeringCanViewAllRequests = false
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
        engineeringCanViewAllRequests,
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

export async function canUserViewRequest(
  userId: string,
  requestId: string,
  options: RequestVisibilityOptions = {},
): Promise<boolean> {
  const { default: prisma } = await import('@/lib/prisma')
  return canViewRequestByPredicate(createRequestVisibilityDb(prisma), userId, requestId, options)
}
