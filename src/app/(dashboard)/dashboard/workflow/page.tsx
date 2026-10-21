import { auth } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { unitPathNames } from '@/lib/unit-labels'
import type { OrganizationUnitNode } from '@/lib/organization/model'

export default async function WorkflowPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  const assignment = await prisma.organization_assignments.findFirst({
    where: { userId: session.user.id, isActive: true },
    select: { unitId: true },
  })

  const units = await prisma.organization_units.findMany({
    select: {
      id: true,
      name: true,
      parentId: true,
      isActive: true,
      shareRequests: true,
      canWorkOnSolutions: true,
      managerUserId: true,
    },
  }) as OrganizationUnitNode[]

  const path = assignment ? unitPathNames(units, assignment.unitId) : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Approval Workflow</h1>
        <p className="text-muted-foreground">
          Approval follows published organization routes for your assignment unit, not numeric department levels.
        </p>
      </div>
      {path.length > 0 ? (
        <p className="text-sm text-muted-foreground">Your unit: {path.join(' / ')}</p>
      ) : (
        <p className="text-muted-foreground">
          You are not assigned to an organization unit. Please contact your administrator.
        </p>
      )}
    </div>
  )
}
