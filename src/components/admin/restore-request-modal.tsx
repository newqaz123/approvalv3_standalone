'use client'

import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
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
import { restoreRequest } from '@/server-actions/requests'
import { useRouter } from 'next/navigation'
import { useTranslations } from '@/lib/i18n/client'

interface RestoreRequestModalProps {
  requestId: string
  requestTitle: string
}

export function RestoreRequestModal({
  requestId,
  requestTitle,
}: RestoreRequestModalProps) {
  const t = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    setIsSubmitting(true)

    try {
      const result = await restoreRequest({ requestId })

      if (result.success) {
        setOpen(false)
        router.refresh()
      } else {
        setError(t('admin.restoreFailed'))
      }
    } catch (err) {
      setError(t('admin.restoreError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RotateCcw className="h-4 w-4 mr-1" />
          {t('admin.restore')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-green-600" />
            {t('admin.restoreRequest')}
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              {t('admin.restoreQuestion')}
            </span>
            <span className="block font-semibold">
              {requestTitle}
            </span>
            <span className="block text-sm text-muted-foreground">
              {t('admin.restoreHelp')}
            </span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleRestore} className="space-y-4">
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
              disabled={isSubmitting}
            >
              {isSubmitting ? t('admin.restoring') : t('admin.restoreRequest')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
