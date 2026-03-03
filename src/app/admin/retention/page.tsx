import { requireAdmin } from '@/lib/auth'
import { getAllRequestsForRetention } from '@/server-actions/requests'
import { RetentionControls } from '@/components/admin/retention-controls'
import { Suspense } from 'react'
import { Badge } from '@/components/ui/badge'
import { Archive, FileText, Calendar, Building, Hash } from 'lucide-react'
import { AdminCard, AdminCardsEmptyState } from '@/components/mobile/admin-card'

export default async function RetentionPage() {
  await requireAdmin()

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Archive className="h-8 w-8 text-muted-foreground" />
          Request Retention
        </h1>
        <p className="text-muted-foreground mt-2">
          Manage request lifecycle. Archive old requests to keep lists fast,
          or permanently delete requests that are no longer needed.
          Requests older than 90 days are archived automatically by cron.
        </p>
      </div>

      <Suspense fallback={<div>Loading requests...</div>}>
        <RetentionList />
      </Suspense>
    </div>
  )
}

async function RetentionList() {
  // Load all non-deleted requests including archived ones
  const requests = await getAllRequestsForRetention(true)

  const activeCount = requests.filter((r) => !r.isArchived).length
  const archivedCount = requests.filter((r) => r.isArchived).length

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground font-medium">Active Requests</p>
          <p className="text-2xl font-bold text-primary">{activeCount}</p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground font-medium">Archived Requests</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{archivedCount}</p>
        </div>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {requests.length > 0 ? (
          requests.map((request) => (
            <AdminCard
              key={request.id}
              title={request.title}
              status={{
                label: request.isArchived ? 'Archived' : 'Active',
                variant: request.isArchived ? 'secondary' : 'default',
              }}
              details={[
                {
                  label: 'ID',
                  value: request.id.slice(0, 8) + '...',
                  icon: <Hash className="h-3.5 w-3.5" />,
                },
                {
                  label: 'Status',
                  value: request.status,
                  icon: <FileText className="h-3.5 w-3.5" />,
                },
                {
                  label: 'Updated',
                  value: new Date(request.updatedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
                  icon: <Calendar className="h-3.5 w-3.5" />,
                },
              ]}
              badges={[]}
              actions={[
                {
                  label: request.isArchived ? 'Unarchive' : 'Archive',
                  onClick: () => {}, // Handled by RetentionControls
                },
              ]}
            />
          ))
        ) : (
          <AdminCardsEmptyState message="No requests found" />
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">ID</th>
              <th className="text-left px-4 py-3 font-medium">Title</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Archived</th>
              <th className="text-left px-4 py-3 font-medium">Department</th>
              <th className="text-left px-4 py-3 font-medium">Updated</th>
              <th className="text-left px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {requests.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No requests found
                </td>
              </tr>
            ) : (
              requests.map((request) => (
                <tr key={request.id} className={request.isArchived ? 'bg-muted/30' : ''}>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {request.id.slice(0, 8)}...
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate" title={request.title}>
                    {request.title}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{request.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {request.isArchived ? (
                      <Badge variant="secondary">Archived</Badge>
                    ) : (
                      <Badge variant="default">Active</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {request.department?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(request.updatedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <RetentionControls
                      requestId={request.id}
                      isArchived={request.isArchived}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
