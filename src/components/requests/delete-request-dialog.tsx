'use client'

import { useState } from 'react'
import { Trash2, AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { deleteRequest } from '@/server-actions/requests'
import { useRouter } from 'next/navigation'

interface DeleteRequestDialogProps {
  requestId: string
  requestTitle: string
  trigger?: React.ReactNode
  onDelete?: () => void
}

export function DeleteRequestDialog({
  requestId,
  requestTitle,
  trigger,
  onDelete,
}: DeleteRequestDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (reason.length < 10) {
      setError('Reason must be at least 10 characters')
      return
    }

    setIsSubmitting(true)

    try {
      const result = await deleteRequest({ requestId, reason })

      if (result.success) {
        setOpen(false)
        router.refresh()
        onDelete?.()
      } else {
        setError(result.error || 'Failed to delete request')
      }
    } catch (err) {
      setError('An error occurred while deleting the request')
    } finally {
      setIsSubmitting(false)
    }
  }

  const defaultTrigger = (
    <Button variant="destructive" size="sm">
      <Trash2 className="h-4 w-4 mr-1" />
      Delete
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Request
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                Are you sure you want to delete this request? This action will:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li>Mark the request as deleted (soft delete)</li>
                <li>Delete all attached files from disk</li>
                <li>Preserve audit trail and activity logs</li>
              </ul>
              <p className="font-semibold pt-2">
                {requestTitle}
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reason">
              Reason for deletion <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reason"
              placeholder="Please provide a reason for deleting this request (min. 10 characters)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
            />
            <p className="text-xs text-muted-foreground">
              This will be logged in the audit trail.
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
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={isSubmitting || reason.length < 10}
            >
              {isSubmitting ? 'Deleting...' : 'Delete Request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
