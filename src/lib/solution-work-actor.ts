// Server-side solution-work eligibility for an actor (H9).
// Eligibility is the unit "Can work on solutions" flag (inherited by
// descendants) via canSubmitSolutionWork / canWorkOnSolutions — the same rule
// solution submission uses. The user ROLE never grants or denies it.
import type { Prisma, PrismaClient } from '@prisma/client'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import { canSubmitSolutionWork } from '@/lib/permission-checks'

export interface SolutionWorkActorDb {
  findUser(userId: string): Promise<{ isActive: boolean } | null>
  findActiveAssignmentUnitIds(userId: string): Promise<string[]>
  findUnits(): Promise<OrganizationUnitNode[]>
}

export function createSolutionWorkActorDb(client: PrismaClient | Prisma.TransactionClient): SolutionWorkActorDb {
  return {
    findUser: (userId) => client.user.findUnique({ where: { id: userId }, select: { isActive: true } }),
    findActiveAssignmentUnitIds: async (userId) =>
      (
        await client.organization_assignments.findMany({
          where: { userId, isActive: true },
          select: { unitId: true },
        })
      ).map((row) => row.unitId),
    findUnits: () =>
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
  }
}

/** True iff the user is active and holds an active assignment in (a descendant of) an active unit flagged canWorkOnSolutions. */
export async function isActorSolutionWorker(db: SolutionWorkActorDb, userId: string): Promise<boolean> {
  const user = await db.findUser(userId)
  if (!user || !user.isActive) return false
  const unitIds = await db.findActiveAssignmentUnitIds(userId)
  if (unitIds.length === 0) return false
  const units = await db.findUnits()
  return unitIds.some((assignmentUnitId) =>
    canSubmitSolutionWork({ isActive: user.isActive, assignmentUnitId, units }),
  )
}
