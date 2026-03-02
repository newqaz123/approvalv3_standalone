import { requireAdmin } from '@/lib/auth'
import { getAllRequestsForRetention } from '@/server-actions/requests'
import { RetentionControls } from '@/components/admin/retention-controls'
import { Suspense } from 'react'
import { Badge } from '@/components/ui/badge'
import { Archive } from 'lucide-react'

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
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-600 font-medium">Active Requests</p>
          <p className="text-2xl font-bold text-blue-700">{activeCount}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-600 font-medium">Archived Requests</p>
          <p className="text-2xl font-bold text-amber-700">{archivedCount}</p>
        </div>
      </div>

      {/* Requests table */}
      <div className="border rounded-lg overflow-hidden">
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
                    {new Date(request.updatedAt).toLocaleDateString()}
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
