import { Network } from 'lucide-react'
import prisma from '@/lib/prisma'
import { BackButton } from '@/components/admin/back-button'
import { OrganizationEditor } from '@/components/admin/organization/OrganizationEditor'
import { getOrganizationAdminData } from '@/server-actions/organization'

export const metadata = { title: 'Organization | Admin' }

export default async function OrganizationPage() {
  const data = await getOrganizationAdminData()
  const [users, members] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true },
    }),
    prisma.reporting_group_members.findMany({
      select: { reportingGroupId: true, userId: true },
    }),
  ])

  return (
    <div className="w-full space-y-8 py-8">
      <div>
        <BackButton />
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Network className="h-8 w-8 text-muted-foreground" />
          Organization
        </h1>
        <p className="mt-2 text-muted-foreground">
          Administer typed units, positions, and reporting groups. Positions are independent of system
          roles. Deactivation is explicit and does not activate a replacement. Link to route editing and
          preview from the mapping panel below.
        </p>
      </div>

      <OrganizationEditor
        units={data.units}
        assignments={data.assignments}
        reportingGroups={data.reportingGroups}
        members={members}
        users={users}
        mappingCoverage={data.mappingCoverage}
        mappingCoverageNote={data.mappingCoverageNote}
        pendingInstanceCounts={data.pendingInstanceCounts}
      />
    </div>
  )
}
