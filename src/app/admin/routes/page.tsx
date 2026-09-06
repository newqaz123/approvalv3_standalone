import { GitBranch } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { BackButton } from '@/components/admin/back-button'
import { RouteEditor } from '@/components/admin/routes/RouteEditor'
import type { ApprovalPhase } from '@/lib/approval-routes/types'

export const metadata = { title: 'Approval Routes | Admin' }

export default async function ApprovalRoutesPage() {
  await requireAdmin()

  const [units, users, publishedRoutes] = await Promise.all([
    prisma.organization_units.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, unitType: true },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.approval_route_versions.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ scopeUnitId: 'asc' }, { phase: 'asc' }],
      select: {
        id: true,
        scopeUnitId: true,
        phase: true,
        version: true,
        maximumPositionLevel: true,
      },
    }),
  ])

  return (
    <div className="w-full space-y-8 py-8">
      <div>
        <BackButton />
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <GitBranch className="h-8 w-8 text-muted-foreground" />
          Approval Routes
        </h1>
        <p className="mt-2 text-muted-foreground">
          Configure ordered upward approver positions per scope and phase. The nearest published route
          on the submitter&apos;s branch is used, and positions at or below the submitter are skipped.
        </p>
      </div>

      <RouteEditor
        units={units}
        users={users}
        publishedRoutes={publishedRoutes.map((route) => ({
          id: route.id,
          scopeUnitId: route.scopeUnitId,
          phase: route.phase as ApprovalPhase,
          version: route.version,
          maximumPositionLevel: route.maximumPositionLevel,
        }))}
      />
    </div>
  )
}
