'use client'

import { useState } from 'react'
import { CheckCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { markRequestComplete } from '@/server-actions/solutions'

interface MarkCompleteButtonProps {
  requestId: string
  requestTitle: string
  disabled?: boolean
  onSuccess?: () => void
}

export function MarkCompleteButton({
  requestId,
  requestTitle,
  disabled = false,
  onSuccess,
}: MarkCompleteButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [completionNote, setCompletionNote] = useState('')

  const handleMarkComplete = async () => {
    setLoading(true)
    try {
      await markRequestComplete(requestId, completionNote || undefined)
      toast.success('Request marked as complete')
      setOpen(false)
      // Call onSuccess callback if provided, otherwise fallback to page reload
      if (onSuccess) {
        onSuccess()
      } else {
        window.location.reload()
      }
    } catch (error) {
      console.error('Failed to mark request as complete:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to mark request as complete')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!loading) {
      setOpen(newOpen)
      if (!newOpen) {
        // Reset note when closing
        setCompletionNote('')
      }
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={disabled || loading}
        className="bg-green-600 hover:bg-green-700 text-white"
      >
        <CheckCircle className="h-4 w-4 mr-1" />
        Mark as Complete
      </Button>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Request as Complete?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the request &quot;{requestTitle}&quot; as completed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4">
            <label htmlFor="completion-note" className="text-sm font-medium text-gray-700 mb-2 block">
              Add a completion note (optional)
            </label>
            <Textarea
              id="completion-note"
              placeholder="Enter any additional notes about the completion..."
              value={completionNote}
              onChange={(e) => setCompletionNote(e.target.value)}
              rows={3}
              disabled={loading}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleMarkComplete()
              }}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Marking as complete...
                </>
              ) : (
                'Mark as Complete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
