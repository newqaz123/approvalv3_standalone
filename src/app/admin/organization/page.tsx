import { Network } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { BackButton } from '@/components/admin/back-button'
import { Button } from '@/components/ui/button'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'
import { getOrganizationWorkspaceData } from '@/server-actions/organization'

export const metadata = { title: 'Organization | Admin' }

export default async function OrganizationPage() {
  await requireAdmin()
  const snapshot = await getOrganizationWorkspaceData()

  return (
    <div className="w-full space-y-8 py-8">
      <div>
        <BackButton />
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Network className="h-8 w-8 text-muted-foreground" />
          Organization & Approvals
        </h1>
        <p className="mt-2 text-muted-foreground">
          Administer the organization tree, assignments, and approval chains from one workspace.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline">Approval chains</Button>
        <Button type="button" variant="outline">Positions</Button>
        <Button type="button">Create unit</Button>
      </div>

      <OrganizationWorkspace snapshot={snapshot} />
    </div>
  )
}
