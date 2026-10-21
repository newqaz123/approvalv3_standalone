import { Network } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { BackButton } from '@/components/admin/back-button'
import { ApprovalChainsPanel } from '@/components/organization/ApprovalChainsPanel'
import { CreateUnitDialog } from '@/components/organization/CreateUnitDialog'
import { OrganizationTabs } from '@/components/organization/OrganizationTabs'
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
  // One canvas at a time: no panel renders the flowchart workspace; the
  // positions/chains panels replace it instead of stacking above it.
  const panel = params.panel === 'positions' ? 'positions' : params.panel === 'chains' ? 'chains' : null
  const chainsScope = typeof params.scope === 'string' ? params.scope : null
  const chainsPhase = ['REQUEST', 'SOLUTION', 'FINAL'].includes(String(params.phase))
    ? (params.phase as ApprovalPhase)
    : null
  const chainsReadOnly = params.mode === 'view'
  const chainsEditor = panel === 'chains' && chainsScope && chainsPhase
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

      <OrganizationTabs active={panel ?? 'organization'} />

      {panel === 'positions' ? <PositionAdminPanel snapshot={snapshot} /> : null}
      {panel === 'chains' ? (
        <ApprovalChainsPanel
          data={await getApprovalChainsData()}
          initialEditor={chainsEditor}
        />
      ) : null}
      {panel === null ? (
        <>
          <CreateUnitDialog units={snapshot.units} />
          <OrganizationWorkspace snapshot={snapshot} />
        </>
      ) : null}
    </div>
  )
}
