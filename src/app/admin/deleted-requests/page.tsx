import { requireAdmin } from '@/lib/auth'
import { getDeletedRequests } from '@/server-actions/requests'
import { Suspense } from 'react'
import { Trash2, RotateCcw, AlertTriangle, Filter } from 'lucide-react'
import { DeleteRequestModal } from '@/components/admin/delete-request-modal'
import { RestoreRequestModal } from '@/components/admin/restore-request-modal'
import { DeleteByDateRangeModal } from '@/components/admin/delete-by-date-range-modal'
import { BackButton } from '@/components/admin/back-button'

export default async function DeletedRequestsPage() {
  await requireAdmin()

  return (
    <div>
      <BackButton />
      <div className="container mx-auto py-8">
        <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Trash2 className="h-8 w-8 text-destructive" />
          Deleted Requests
        </h1>
        <p className="text-muted-foreground mt-2">
          Monitor and manage deleted requests. You can restore them or permanently delete to save disk space.
        </p>
      </div>

      <Suspense fallback={<div>Loading deleted requests...</div>}>
        <DeletedRequestsList />
      </Suspense>
      </div>
    </div>
  )
}

async function DeletedRequestsList() {
  const deletedRequests = await getDeletedRequests()

  if (deletedRequests.length === 0) {
    return (
      <div className="text-center py-12 bg-muted rounded-lg">
        <p className="text-muted-foreground">No deleted requests found</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground font-medium">Total Deleted</p>
          <p className="text-2xl font-bold text-primary">{deletedRequests.length}</p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground font-medium">This Month</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {deletedRequests.filter(r => {
              const deletedAt = new Date(r.deletedAt!)
              const now = new Date()
              return deletedAt.getMonth() === now.getMonth() &&
                     deletedAt.getFullYear() === now.getFullYear()
            }).length}
          </p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground font-medium">This Year</p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {deletedRequests.filter(r => {
              const deletedAt = new Date(r.deletedAt!)
              return deletedAt.getFullYear() === new Date().getFullYear()
            }).length}
          </p>
        </div>
      </div>

      {/* Cleanup actions */}
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-amber-800 dark:text-amber-200">Cleanup Options</h3>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              Permanently delete old requests to save database space. This action cannot be undone.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <DeleteRequestModal
                mode="older_than_1_year"
                count={deletedRequests.filter(r => {
                  const deletedAt = new Date(r.deletedAt!)
                  const oneYearAgo = new Date()
                  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
                  return deletedAt < oneYearAgo
                }).length}
              />
              <DeleteByDateRangeModal count={deletedRequests.length} />
              <DeleteRequestModal
                mode="all"
                count={deletedRequests.length}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Deleted requests list */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-muted px-4 py-3 border-b">
          <h2 className="font-semibold">Deleted Requests ({deletedRequests.length})</h2>
        </div>
        <div className="divide-y">
          {deletedRequests.map((request) => (
            <div key={request.id} className="p-4 hover:bg-muted/50">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm truncate">{request.title}</h3>
                  <div className="text-sm text-muted-foreground mt-1 space-y-1">
                    <p>Requester: {request.requester.name} ({request.requester.email})</p>
                    <p>Department: {request.department.name}</p>
                    <p>Status: {request.status}</p>
                    <p>Deleted by: {request.deletedByUser?.name || 'Unknown'}</p>
                    <p>Deleted at: {request.deletedAt ? new Date(request.deletedAt).toLocaleString() : 'N/A'}</p>
                    {request.activities[0]?.comments && (
                      <p className="text-xs italic">Reason: {request.activities[0].comments}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <RestoreRequestModal
                    requestId={request.id}
                    requestTitle={request.title}
                  />
                  <DeleteRequestModal
                    mode="single"
                    requestId={request.id}
                    requestTitle={request.title}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
