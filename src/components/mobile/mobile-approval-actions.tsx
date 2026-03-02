'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
import { approveRequest, rejectRequest } from '@/server-actions/approvals'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface MobileApprovalActionsProps {
  requestId: string
  canApprove: boolean
  expectedUpdatedAt?: Date | string
  onSuccess?: () => void
  onFormInteraction?: () => void
}

export function MobileApprovalActions({
  requestId,
  canApprove,
  expectedUpdatedAt,
  onSuccess,
  onFormInteraction,
}: MobileApprovalActionsProps) {
  const router = useRouter()
  const [isApproving, setIsApproving] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [comments, setComments] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!canApprove) {
    return null
  }

  const handleApprove = async () => {
    setIsApproving(true)
    setError(null)

    try {
      const result = await approveRequest(requestId, comments || undefined, expectedUpdatedAt)

      if (result && 'stale' in result && result.stale) {
        setError('This request was updated by another user.')
        toast.error('This request was updated by another user.')
        return
      }

      toast.success('Request approved')
      onSuccess?.()
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve'
      setError(message)
      toast.error(message)
    } finally {
      setIsApproving(false)
    }
  }

  const handleReject = async () => {
    if (!comments.trim()) {
      setError('Please provide a reason')
      return
    }

    setIsRejecting(true)
    setError(null)

    try {
      const result = await rejectRequest(requestId, comments, expectedUpdatedAt)

      if (result && 'stale' in result && result.stale) {
        setError('This request was updated by another user.')
        toast.error('This request was updated by another user.')
        return
      }

      toast.success('Request rejected')
      setShowRejectDialog(false)
      setComments('')
      onSuccess?.()
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reject'
      setError(message)
      toast.error(message)
    } finally {
      setIsRejecting(false)
    }
  }

  const handleRejectClick = () => {
    setShowRejectDialog(true)
  }

  const handleCancelReject = () => {
    setShowRejectDialog(false)
    setComments('')
    setError(null)
  }

  // Default view: side-by-side buttons
  return (
    <>
      <div className="flex gap-3 min-h-[44px]">
        {/* Approve button - green, left side */}
        <Button
          onClick={handleApprove}
          disabled={isApproving}
          className={cn(
            "flex-1 h-[48px] min-h-[44px]",
            "bg-green-600 hover:bg-green-700 active:bg-green-800",
            "text-white font-semibold text-base",
            "transition-colors"
          )}
        >
          <Check className="mr-2 h-5 w-5" />
          {isApproving ? 'Approving...' : 'Approve'}
        </Button>

        {/* Reject button - red, right side */}
        <Button
          onClick={handleRejectClick}
          disabled={isRejecting}
          variant="destructive"
          className={cn(
            "flex-1 h-[48px] min-h-[44px]",
            "bg-red-600 hover:bg-red-700 active:bg-red-800",
            "text-white font-semibold text-base",
            "transition-colors"
          )}
        >
          <X className="mr-2 h-5 w-5" />
          Reject
        </Button>
      </div>

      {/* Rejection confirmation dialog - uses Radix AlertDialog with Portal */}
      <AlertDialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Request</AlertDialogTitle>
            <AlertDialogDescription>
              Please provide a reason for rejecting this request.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Textarea
            value={comments}
            onChange={(e) => {
              setComments(e.target.value)
              onFormInteraction?.()
            }}
            onFocus={() => onFormInteraction?.()}
            placeholder="Enter reason for rejection..."
            rows={4}
            className="mb-3 text-base"
            autoFocus
          />

          {error && (
            <p className="text-sm text-red-600 mb-3">{error}</p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowRejectDialog(false)
              setComments('')
              setError(null)
            }} className="h-[48px] min-h-[44px] text-base">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={isRejecting || !comments.trim()}
              className="h-[48px] min-h-[44px] text-base bg-red-600 hover:bg-red-700 focus:bg-red-700"
            >
              {isRejecting ? 'Rejecting...' : 'Confirm Rejection'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// Helper function for cn
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}
