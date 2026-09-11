import Link from 'next/link'
import { Network } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { BackButton } from '@/components/admin/back-button'
import { Button } from '@/components/ui/button'
import { ApprovalChainsPanel } from '@/components/organization/ApprovalChainsPanel'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'
import { PositionAdminPanel } from '@/components/organization/PositionAdminPanel'
import { getApprovalChainsData } from '@/server-actions/approval-routes'
import { getOrganizationWorkspaceData } from '@/server-actions/organization'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'

export const metadata = { title: 'Organization | Admin' }

export default async function OrganizationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()
  const params = await searchParams
  const snapshot = await getOrganizationWorkspaceData()
  const showPositions = params.panel === 'positions'
  const showChains = params.panel === 'chains'
  const chainsScope = typeof params.scope === 'string' ? params.scope : null
  const chainsPhase = ['REQUEST', 'SOLUTION', 'FINAL'].includes(String(params.phase))
    ? (params.phase as ApprovalPhase)
    : null
  const chainsReadOnly = params.mode === 'view'
  const chainsEditor = showChains && chainsScope && chainsPhase
    ? { scopeUnitId: chainsScope, phase: chainsPhase, readOnly: chainsReadOnly }
    : null

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
        <Button type="button" variant="outline" asChild>
          <Link href="/admin/organization?panel=chains" data-testid="header-approval-chains">
            Approval chains
          </Link>
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/admin/organization?panel=positions" data-testid="header-positions">Positions</Link>
        </Button>
        <Button type="button">Create unit</Button>
      </div>

      {showPositions ? <PositionAdminPanel snapshot={snapshot} /> : null}

      {showChains ? (
        <ApprovalChainsPanel
          data={await getApprovalChainsData()}
          initialEditor={chainsEditor}
        />
      ) : null}

      <OrganizationWorkspace snapshot={snapshot} />
    </div>
  )
}
