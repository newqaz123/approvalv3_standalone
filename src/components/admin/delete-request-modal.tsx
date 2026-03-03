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
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const getTitle = () => {
    switch (mode) {
      case 'single':
        return 'Permanently Delete Request'
      case 'older_than_1_year':
        return 'Delete Old Requests'
      case 'all':
        return 'Delete All Deleted Requests'
    }
  }

  const getDescription = () => {
    switch (mode) {
      case 'single':
        return `This will permanently delete "${requestTitle}" and all its data. This action CANNOT be undone.`
      case 'older_than_1_year':
        return `This will permanently delete ${count} requests deleted more than 1 year ago. This action CANNOT be undone.`
      case 'all':
        return `This will permanently delete all ${count} deleted requests. This action CANNOT be undone.`
    }
  }

  const getButtonText = () => {
    switch (mode) {
      case 'single':
        return 'Permanently Delete'
      case 'older_than_1_year':
        return `Delete ${count} Old Requests`
      case 'all':
        return `Delete All (${count})`
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('[DeleteRequestModal] handleSubmit called', { mode, requestId })
    setError(null)

    // For bulk operations, require confirmation text
    if (mode !== 'single' && confirmText !== 'PERMANENTLY DELETE') {
      setError('Please type "PERMANENTLY DELETE" to confirm')
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
        setError(result.error || 'Failed to delete requests')
      }
    } catch (err) {
      console.error('[DeleteRequestModal] Exception:', err)
      setError('An error occurred while deleting requests')
    } finally {
      setIsSubmitting(false)
    }
  }

  const defaultTrigger = (
    <Button variant="destructive" size="sm">
      <Trash2 className="h-4 w-4 mr-1" />
      {mode === 'single' ? 'Delete' : getButtonText()}
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
              ⚠️ This action CANNOT be undone!
            </span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode !== 'single' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Type &ldquo;PERMANENTLY DELETE&rdquo; to confirm
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
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={isSubmitting || (mode !== 'single' && confirmText !== 'PERMANENTLY DELETE')}
            >
              {isSubmitting ? 'Deleting...' : getButtonText()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
