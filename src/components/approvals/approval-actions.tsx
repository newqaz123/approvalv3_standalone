'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { approveRequest, rejectRequest } from '@/server-actions/approvals'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface ApprovalActionsProps {
  requestId: string
  canApprove: boolean
  onSuccess?: () => void
  expectedUpdatedAt?: Date | string
  onFormInteraction?: () => void
}

export function ApprovalActions({ requestId, canApprove, onSuccess, expectedUpdatedAt, onFormInteraction }: ApprovalActionsProps) {
  const router = useRouter()
  const [isApproving, setIsApproving] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)
  const [showRejectForm, setShowRejectForm] = useState(false)
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
        setError('This request was updated by another user. Please refresh and try again.')
        toast.error('This request was updated by another user. Please refresh and try again.')
        return
      }

      toast.success('Request approved successfully')
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
      setError('Please provide a reason for rejection')
      return
    }

    setIsRejecting(true)
    setError(null)

    try {
      const result = await rejectRequest(requestId, comments, expectedUpdatedAt)

      if (result && 'stale' in result && result.stale) {
        setError('This request was updated by another user. Please refresh and try again.')
        toast.error('This request was updated by another user. Please refresh and try again.')
        return
      }

      toast.success('Request rejected successfully')
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

  if (showRejectForm) {
    return (
      <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-red-900">Reject Request</h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowRejectForm(false)
              setComments('')
              setError(null)
            }}
          >
            Cancel
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-red-900">
            Reason for rejection *
          </label>
          <Textarea
            value={comments}
            onChange={(e) => {
              setComments(e.target.value)
              onFormInteraction?.()
            }}
            onFocus={() => onFormInteraction?.()}
            placeholder="Please explain why you're rejecting this request..."
            rows={3}
            className="bg-white"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <Button
          onClick={handleReject}
          disabled={isRejecting || !comments.trim()}
          variant="destructive"
          className="w-full"
        >
          {isRejecting ? 'Rejecting...' : 'Confirm Rejection'}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <h4 className="font-semibold text-blue-900">Your Approval Needed</h4>
      <p className="text-sm text-blue-700">
        This request requires your approval to proceed to the next step.
      </p>

      <div className="space-y-2">
        <label className="text-sm font-medium text-blue-900">
          Comments (optional)
        </label>
        <Textarea
          value={comments}
          onChange={(e) => {
            setComments(e.target.value)
            onFormInteraction?.()
          }}
          onFocus={() => onFormInteraction?.()}
          placeholder="Add any comments about your approval..."
          rows={2}
          className="bg-white"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleApprove}
          disabled={isApproving}
          className="flex-1 bg-green-600 hover:bg-green-700"
        >
          <Check className="mr-2 h-4 w-4" />
          {isApproving ? 'Approving...' : 'Approve'}
        </Button>

        <Button
          onClick={() => setShowRejectForm(true)}
          disabled={isRejecting}
          variant="destructive"
          className="flex-1"
        >
          <X className="mr-2 h-4 w-4" />
          Reject
        </Button>
      </div>
    </div>
  )
}
