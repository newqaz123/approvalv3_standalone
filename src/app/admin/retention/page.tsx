import { Archive } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getAllRequestsForRetention } from '@/server-actions/requests'
import { getRetentionSettings } from '@/server-actions/retention'
import { isEligibleForAutoArchive } from '@/lib/retention-policy'
import { RetentionPolicyForm } from '@/components/admin/retention-policy-form'
import { RetentionRequestList } from '@/components/admin/retention-request-list'
import { BackButton } from '@/components/admin/back-button'

export const metadata = { title: 'Request Retention | Admin' }

export default async function RetentionPage() {
  await requireAdmin()
  const [settings, requests] = await Promise.all([
    getRetentionSettings(),
    getAllRequestsForRetention(true),
  ])

  const rows = requests.map((request) => ({
    id: request.id,
    title: request.title,
    status: request.status,
    isArchived: request.isArchived,
    updatedAt: request.updatedAt.toISOString(),
    departmentName: request.department?.name ?? null,
    eligible: isEligibleForAutoArchive(
      {
        status: request.status,
        isArchived: request.isArchived,
        isDeleted: false,
        updatedAt: request.updatedAt,
      },
      settings
    ),
  }))

  return (
    <div className="w-full space-y-8 py-8">
      <div>
        <BackButton />
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Archive className="h-8 w-8 text-muted-foreground" />
          Request Retention
        </h1>
        <p className="mt-2 text-muted-foreground">
          Archive hides a request. Unarchive brings it back. Hard-delete is only for archived rows and cannot be undone.
        </p>
      </div>

      <RetentionPolicyForm initial={settings} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium text-muted-foreground">Active</p>
          <p className="mt-1 text-2xl font-bold">{requests.filter((request) => !request.isArchived).length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium text-muted-foreground">Archived</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">
            {requests.filter((request) => request.isArchived).length}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium text-muted-foreground">Ready to auto-archive</p>
          <p className="mt-1 text-2xl font-bold">{settings.eligibleCount}</p>
        </div>
      </div>

      <RetentionRequestList requests={rows} />
    </div>
  )
}
