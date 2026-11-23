'use client'

import { useTranslations } from '@/lib/i18n/client'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Archive, AlertTriangle, Calendar, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { bulkDeleteRequestsByDateRange } from '@/server-actions/requests'
import { useRouter } from 'next/navigation'

export function BulkDeleteByDateRange() {
  const t = useTranslations()
  const { data: session } = useSession(); const user = session?.user
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [preview, setPreview] = useState<{ count: number; requests: any[] } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  // Check if user is admin
  const isAdmin = user?.role === 'admin'

  // Reset state when dialog closes (must be before early return)
  useEffect(() => {
    if (!open) {
      setPreview(null)
      setShowConfirm(false)
      setConfirmText('')
      setError(null)
    }
  }, [open])

  if (!isAdmin) {
    return null // Don't show for non-admin users
  }

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPreview(null)

    if (!dateFrom || !dateTo) {
      setError(t('requests.selectBothDates'))
      return
    }

    setIsPreviewing(true)

    try {
      const result = await bulkDeleteRequestsByDateRange({
        mode: 'preview',
        dateFrom,
        dateTo,
      })

      if (result.success) {
        setPreview({
          count: result.count || 0,
          requests: result.requests || [],
        })
        setShowConfirm(true)
      } else {
        setError(t('requests.error.archivePreview'))
      }
    } catch (err) {
      setError(t('requests.error.archivePreviewUnexpected'))
    } finally {
      setIsPreviewing(false)
    }
  }

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (confirmText !== 'ARCHIVE') {
      setError(t('requests.archiveConfirmationRequired'))
      return
    }

    setIsSubmitting(true)

    try {
      const result = await bulkDeleteRequestsByDateRange({
        mode: 'delete',
        dateFrom,
        dateTo,
      })

      if (result.success) {
        setOpen(false)
        router.refresh()
      } else {
        setError(t('requests.error.bulkArchive'))
      }
    } catch (err) {
      setError(t('requests.error.bulkArchiveUnexpected'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Archive className="h-4 w-4 mr-1" />
          {t('requests.bulkArchiveByDate')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            {t('requests.bulkArchiveTitle')}
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              {t('requests.bulkArchiveHelp')}
            </span>
            <span className="block font-semibold text-amber-600 dark:text-amber-400">
              {t('requests.bulkArchiveWarning')}
            </span>
          </DialogDescription>
        </DialogHeader>

        {!showConfirm ? (
          // Step 1: Select dates and preview
          <form onSubmit={handlePreview} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dateFrom">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  {t('requests.createdFrom')}
                </Label>
                <input
                  id="dateFrom"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dateTo">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  {t('requests.createdTo')}
                </Label>
                <input
                  id="dateTo"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm">
              <p className="text-blue-800">
                {t('requests.archiveDateRange', { start: dateFrom || t('requests.startDate'), end: dateTo || t('requests.endDate') })}
              </p>
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPreviewing}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant="default"
                disabled={isPreviewing || !dateFrom || !dateTo}
              >
                {isPreviewing ? (
                  <>
                    <Search className="h-4 w-4 mr-2 animate-spin" />
                    {t('requests.previewing')}</>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    {t('requests.preview')}</>
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          // Step 2: Show preview and confirm
          <form onSubmit={handleDelete} className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <h3 className="font-semibold text-blue-900 mb-2">
                {t('requests.archiveFound', { count: preview?.count || 0 })}
              </h3>
              <div className="max-h-60 overflow-y-auto space-y-2">
                {preview?.requests.map((request: any, index: number) => (
                  <div key={request.id} className="text-sm bg-white p-2 rounded border">
                    <p className="font-medium">{index + 1}. {request.title}</p>
                    <p className="text-xs text-gray-600">
                      {t('requests.requesterColon')}{' '}{request.requester?.name} ({request.requester?.email})
                    </p>
                    <p className="text-xs text-gray-600">
                      {t('requests.statusColon')}{' '}{request.status}
                    </p>
                    <p className="text-xs text-gray-600">
                      {t('requests.createdColon')}{' '}{new Date(request.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                {t('requests.archiveWarningCount', { count: preview?.count || 0 })}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                {t('requests.archiveRestoreHelp')}
              </p>
            </div>

            <div className="space-y-2">
              <Label>
                {t('requests.archiveConfirmation')}
              </Label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="ARCHIVE"
                className="w-full px-3 py-2 border rounded-md"
                required
              />
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowConfirm(false)}
                disabled={isSubmitting}
              >
                {t('requests.back')}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || confirmText !== 'ARCHIVE'}
              >
                {isSubmitting ? t('requests.archiving') : t('requests.archiveCount', { count: preview?.count || 0 })}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
