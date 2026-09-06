import prisma from '@/lib/prisma'
import { descendantUnitIds } from '@/lib/organization/tree'
import type { OrganizationUnitNode } from '@/lib/organization/types'
import {
  canViewRequestByPredicate,
  type RequestVisibilityActor,
  type RequestVisibilityDb,
} from '@/lib/request-visibility/predicate'

/**
 * Request-visibility authorization for private attachment downloads.
 *
 * Rule (exact):
 *  - Missing / inactive user, missing request, or soft-deleted request → false.
 *  - Admin and engineering users (role `admin`/`engineering`, or a department /
 *    primary unit of type `ENGINEERING`) may view any non-deleted request.
 *  - Everyone else must have an explicit relationship: requester, originating
 *    organization unit in managedUnitIds (assigned units UNION descendants),
 *    actual/required approver history, or SNAPSHOT candidate-group membership.
 *
 * Archived requests are NOT blanket-denied: archive hiding is a list filter
 * only. Soft-deleted requests are always denied. Visibility is not action
 * eligibility.
 */
function asActorRole(role: string): RequestVisibilityActor['role'] {
  if (role === 'admin' || role === 'engineering') return role
  return 'general_dept'
}

function asDepartmentType(value: string | null | undefined): RequestVisibilityActor['departmentType'] {
  if (value === 'GENERAL' || value === 'ENGINEERING') return value
  return null
}

export function createPrismaRequestVisibilityDb(client = prisma): RequestVisibilityDb {
  return {
    async findActor(userId) {
      const user = await client.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          isActive: true,
          role: true,
          departmentId: true,
          department: { select: { type: true } },
        },
      })
      if (!user) return null

      const assignments = await client.organization_position_assignments.findMany({
        where: { userId, isActive: true },
        select: { unitId: true, isPrimary: true },
      })
      const units = await client.organization_units.findMany({
        select: {
          id: true,
          name: true,
          unitType: true,
          parentId: true,
          isActive: true,
          operationalType: true,
        },
      })
      const nodes: OrganizationUnitNode[] = units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        unitType: unit.unitType,
        parentId: unit.parentId,
        isActive: unit.isActive,
      }))
      const primary = assignments.find((assignment) => assignment.isPrimary)
      const primaryUnit = primary ? units.find((unit) => unit.id === primary.unitId) : undefined
      const departmentType =
        asDepartmentType(primaryUnit?.operationalType) ?? asDepartmentType(user.department?.type)

      const managed = new Set<string>()
      for (const assignment of assignments) {
        try {
          for (const id of descendantUnitIds(nodes, assignment.unitId)) managed.add(id)
        } catch {
          managed.add(assignment.unitId)
        }
      }

      return {
        id: user.id,
        role: asActorRole(user.role),
        isActive: user.isActive,
        departmentId: user.departmentId,
        departmentType,
        managedUnitIds: [...managed],
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

/** Adapter for ordinary request queries. Raw Prisma has no findActor/findRequest. */
export function createRequestVisibilityDb(client = prisma): RequestVisibilityDb {
  return createPrismaRequestVisibilityDb(client)
}

export async function canUserViewRequest(userId: string, requestId: string): Promise<boolean> {
  return canViewRequestByPredicate(createRequestVisibilityDb(), userId, requestId)
}
