'use client'

import { useState } from 'react'
import { Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { permanentlyDeleteRequests } from '@/server-actions/requests'
import { useRouter } from 'next/navigation'
import { useTranslations } from '@/lib/i18n/client'

interface DeleteRequestModalProps {
  mode: 'single' | 'older_than_1_year' | 'all'
  requestId?: string
  requestTitle?: string
  count?: number
}

export function DeleteRequestModal({
  mode,
  requestId,
  requestTitle,
  count,
}: DeleteRequestModalProps) {
  const t = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const getTitle = () => {
    switch (mode) {
      case 'single':
        return t('admin.deletePermanentTitle')
      case 'older_than_1_year':
        return t('admin.deleteOldRequests')
      case 'all':
        return t('admin.deleteAllDeleted')
    }
  }

  const getDescription = () => {
    switch (mode) {
      case 'single':
        return t('admin.deleteSingleDescription', { title: requestTitle ?? '' })
      case 'older_than_1_year':
        return t('admin.deleteOldDescription', { count: count ?? 0 })
      case 'all':
        return t('admin.deleteAllDescription', { count: count ?? 0 })
    }
  }

  const getButtonText = () => {
    switch (mode) {
      case 'single':
        return t('admin.deletePermanently')
      case 'older_than_1_year':
        return t('admin.deleteOldCount', { count: count ?? 0 })
      case 'all':
        return t('admin.deleteAllCount', { count: count ?? 0 })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('[DeleteRequestModal] handleSubmit called', { mode, requestId })
    setError(null)

    // For bulk operations, require confirmation text
    if (mode !== 'single' && confirmText !== 'PERMANENTLY DELETE') {
      setError(t('admin.permanentTokenError'))
      return
    }

    setIsSubmitting(true)

    try {
      console.log('[DeleteRequestModal] Calling permanentlyDeleteRequests...')
      const result = await permanentlyDeleteRequests({
        mode,
        requestId,
      })
      console.log('[DeleteRequestModal] Result:', result)

      if (result.success) {
        console.log('[DeleteRequestModal] Success, closing modal')
        setOpen(false)
        router.refresh()
      } else {
        console.log('[DeleteRequestModal] Error:', result.error)
        setError(t('admin.deleteRequestsFailed'))
      }
    } catch (err) {
      console.error('[DeleteRequestModal] Exception:', err)
      setError(t('admin.deleteRequestsError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const defaultTrigger = (
    <Button variant="destructive" size="sm">
      <Trash2 className="h-4 w-4 mr-1" />
      {mode === 'single' ? t('admin.delete') : getButtonText()}
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === 'single' ? defaultTrigger : <Button variant="destructive" size="sm">{getButtonText()}</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {getTitle()}
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">{getDescription()}</span>
            <span className="block font-semibold text-destructive">
              {t('admin.irreversibleWarning')}
            </span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode !== 'single' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t('admin.permanentTokenLabel')}
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="PERMANENTLY DELETE"
                className="w-full px-3 py-2 border rounded-md"
                required
              />
            </div>
          )}

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
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={isSubmitting || (mode !== 'single' && confirmText !== 'PERMANENTLY DELETE')}
            >
              {isSubmitting ? t('admin.deleting') : getButtonText()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
