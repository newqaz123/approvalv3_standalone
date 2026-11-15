import type { OrganizationUnitNode } from '@/lib/organization/model'
import { canWorkOnSolutions } from '@/lib/solution-eligibility'

type SolutionWorkUser = { id: string; name: string; email: string }

type PrismaClientLike = {
  user: {
    findMany(args: {
      where: { isActive: true }
      select: {
        id: true
        name: true
        email: true
        organizationAssignments: { where: { isActive: true }; select: { unitId: true } }
      }
      orderBy: { name: 'asc' }
    }): Promise<Array<SolutionWorkUser & { organizationAssignments: Array<{ unitId: string }> }>>
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
    }): Promise<OrganizationUnitNode[]>
  }
}

export async function listSolutionWorkUsers(client: PrismaClientLike): Promise<SolutionWorkUser[]> {
  const [users, units] = await Promise.all([
    client.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        organizationAssignments: { where: { isActive: true }, select: { unitId: true } },
      },
      orderBy: { name: 'asc' },
    }),
    client.organization_units.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
        isActive: true,
        shareRequests: true,
        canWorkOnSolutions: true,
        managerUserId: true,
      },
    }),
  ])
  return users
    .filter((user) => user.organizationAssignments.some((assignment) => canWorkOnSolutions(units, assignment.unitId)))
    .map(({ id, name, email }) => ({ id, name, email }))
}

export async function filterSolutionWorkUserIds(client: PrismaClientLike, userIds: string[]): Promise<string[]> {
  const requested = new Set(userIds)
  const users = await listSolutionWorkUsers(client)
  return users.filter((user) => requested.has(user.id)).map((user) => user.id)
}
