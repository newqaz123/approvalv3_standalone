'use client'

import { useState, useEffect } from 'react'
import { Filter, AlertTriangle, Search } from 'lucide-react'
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
import { permanentlyDeleteRequests, previewDeleteByDateRange } from '@/server-actions/requests'
import { useRouter } from 'next/navigation'
import { useTranslations } from '@/lib/i18n/client'

interface DeleteByDateRangeModalProps {
  count: number
}

export function DeleteByDateRangeModal({ count }: DeleteByDateRangeModalProps) {
  const t = useTranslations()
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

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setPreview(null)
      setShowConfirm(false)
      setConfirmText('')
      setError(null)
    }
  }, [open])

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPreview(null)

    if (!dateFrom || !dateTo) {
      setError(t('admin.selectDateRange'))
      return
    }

    setIsPreviewing(true)

    try {
      const result = await previewDeleteByDateRange({ dateFrom, dateTo })

      if (result.success) {
        setPreview({
          count: result.count || 0,
          requests: result.requests || [],
        })
        setShowConfirm(true)
      } else {
        setError(t('admin.previewRequestsFailed'))
      }
    } catch (err) {
      setError(t('admin.previewRequestsError'))
    } finally {
      setIsPreviewing(false)
    }
  }

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (confirmText !== 'PERMANENTLY DELETE') {
      setError(t('admin.permanentTokenError'))
      return
    }

    setIsSubmitting(true)

    try {
      const result = await permanentlyDeleteRequests({
        mode: 'date_range',
        dateFrom,
        dateTo,
      })

      if (result.success) {
        setOpen(false)
        router.refresh()
      } else {
        setError(t('admin.deleteRequestsFailed'))
      }
    } catch (err) {
      setError(t('admin.deleteRequestsError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Filter className="h-4 w-4 mr-1" />
          {t('admin.deleteByDateRange')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t('admin.deleteByDateRange')}
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              {t('admin.deleteByDateRangeHelp')}
            </span>
            <span className="block font-semibold text-destructive">
              {t('admin.irreversibleWarning')}
            </span>
          </DialogDescription>
        </DialogHeader>

        {!showConfirm ? (
          // Step 1: Select dates and preview
          <form onSubmit={handlePreview} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dateFrom">{t('admin.fromDate')}</Label>
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
                <Label htmlFor="dateTo">{t('admin.toDate')}</Label>
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
                    {t('admin.previewing')}
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    {t('admin.preview')}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          // Step 2: Show preview and confirm
          <form onSubmit={handleDelete} className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <h3 className="font-semibold text-blue-900 mb-2">
                {t('admin.foundToDelete', { count: preview?.count || 0 })}
              </h3>
              <div className="max-h-60 overflow-y-auto space-y-2">
                {preview?.requests.map((request, index) => (
                  <div key={request.id} className="text-sm bg-white p-2 rounded border">
                    <p className="font-medium">{index + 1}. {request.title}</p>
                    <p className="text-xs text-gray-600">
                      {t('admin.requesterLabel')} {request.requester.name} ({request.requester.email})
                    </p>
                    <p className="text-xs text-gray-600">
                      {t('admin.deletedAtLabel')} {new Date(request.deletedAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
              <p className="text-sm font-semibold text-destructive">
                {t('admin.warningDeleteCount', { count: preview?.count || 0 })}
              </p>
              <p className="text-xs text-destructive mt-1">
                {t('admin.deleteDataWarning')}
              </p>
            </div>

            <div className="space-y-2">
              <Label>
                {t('admin.permanentTokenLabel')}
              </Label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="PERMANENTLY DELETE"
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
                {t('admin.back')}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={isSubmitting || confirmText !== 'PERMANENTLY DELETE'}
              >
                {isSubmitting ? t('admin.deleting') : t('admin.deleteRangeCount', { count: preview?.count || 0 })}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
