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

interface RestoreRequestModalProps {
  requestId: string
  requestTitle: string
}

export function RestoreRequestModal({
  requestId,
  requestTitle,
}: RestoreRequestModalProps) {
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
        setError(result.error || 'Failed to restore request')
      }
    } catch (err) {
      setError('An error occurred while restoring the request')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RotateCcw className="h-4 w-4 mr-1" />
          Restore
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-green-600" />
            Restore Request
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              Are you sure you want to restore this request?
            </span>
            <span className="block font-semibold">
              {requestTitle}
            </span>
            <span className="block text-sm text-muted-foreground">
              The request will be visible again in the main requests list.
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
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Restoring...' : 'Restore Request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
