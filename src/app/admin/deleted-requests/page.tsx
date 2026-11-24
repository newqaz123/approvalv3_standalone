import { requireAdmin } from '@/lib/auth'
import { getDeletedRequests } from '@/server-actions/requests'
import { Suspense } from 'react'
import { Trash2, RotateCcw, AlertTriangle, Filter } from 'lucide-react'
import { DeleteRequestModal } from '@/components/admin/delete-request-modal'
import { RestoreRequestModal } from '@/components/admin/restore-request-modal'
import { DeleteByDateRangeModal } from '@/components/admin/delete-by-date-range-modal'
import { BackButton } from '@/components/admin/back-button'
import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'

export default async function DeletedRequestsPage() {
  const t = createTranslator(await getRequestLocale())
  await requireAdmin()

  return (
    <div>
      <BackButton />
      <div className="w-full py-8">
        <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Trash2 className="h-8 w-8 text-destructive" />
          {t('admin.deletedRequests')}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t('admin.deletedRequestsDescription')}
        </p>
      </div>

      <Suspense fallback={<div>{t('admin.loadingDeleted')}</div>}>
        <DeletedRequestsList />
      </Suspense>
      </div>
    </div>
  )
}

async function DeletedRequestsList() {
  const t = createTranslator(await getRequestLocale())
  const deletedRequests = await getDeletedRequests()

  if (deletedRequests.length === 0) {
    return (
      <div className="text-center py-12 bg-muted rounded-lg">
        <p className="text-muted-foreground">{t('admin.noDeleted')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground font-medium">{t('admin.totalDeleted')}</p>
          <p className="text-2xl font-bold text-primary">{deletedRequests.length}</p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground font-medium">{t('admin.thisMonth')}</p>
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
          <p className="text-sm text-muted-foreground font-medium">{t('admin.thisYear')}</p>
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
            <h3 className="font-semibold text-amber-800 dark:text-amber-200">{t('admin.cleanupOptions')}</h3>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              {t('admin.cleanupDescription')}
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
          <h2 className="font-semibold">{t('admin.deletedRequestsCount', { count: deletedRequests.length })}</h2>
        </div>
        <div className="divide-y">
          {deletedRequests.map((request) => (
            <div key={request.id} className="p-4 hover:bg-muted/50">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm truncate">{request.title}</h3>
                  <div className="text-sm text-muted-foreground mt-1 space-y-1">
                    <p>{t('admin.requesterLabel')}{' '}{request.requester.name} ({request.requester.email})</p>
                    <p>{t('admin.departmentLabel')} {request.organizationUnit?.name}</p>
                    <p>{t('common.status')}: {request.status}</p>
                    <p>{t('admin.deletedByLabel')} {request.deletedByUser?.name || t('admin.unknown')}</p>
                    <p>{t('admin.deletedAtLabel')} {request.deletedAt ? new Date(request.deletedAt).toLocaleString() : t('admin.notApplicable')}</p>
                    {request.activities[0]?.comments && (
                      <p className="text-xs italic">{t('admin.reasonLabel')} {request.activities[0].comments}</p>
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
