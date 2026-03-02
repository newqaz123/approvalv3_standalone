'use client'

import { useState } from 'react'
import { CheckCircle, XCircle } from 'lucide-react'
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
import { toast } from 'sonner'
import { approveSolution, rejectSolution } from '@/server-actions/solutions'
import { useRouter } from 'next/navigation'

interface SolutionApprovalActionsProps {
  solutionId: string
  canApprove: boolean
  currentApproval?: {
    id: string
    requiredLevel: number | null
    requiredApproverId: string | null
    isCustomChain: boolean
  }
}

export function SolutionApprovalActions({
  solutionId,
  canApprove,
  currentApproval,
}: SolutionApprovalActionsProps) {
  const router = useRouter()
  const [isApproving, setIsApproving] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)
  const [showApproveDialog, setShowApproveDialog] = useState(false)
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [approveComments, setApproveComments] = useState('')
  const [rejectComments, setRejectComments] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Show status text when user cannot approve
  if (!canApprove) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center">
        <p className="text-sm text-gray-600">
          {currentApproval
            ? 'Waiting for previous approvers'
            : 'Not your turn to approve'}
        </p>
      </div>
    )
  }

  const handleApprove = async () => {
    setIsApproving(true)
    setError(null)

    try {
      await approveSolution(solutionId, approveComments || undefined)
      setShowApproveDialog(false)
      setApproveComments('')
      toast.success('Solution approved')
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve solution'
      setError(message)
      toast.error(message)
    } finally {
      setIsApproving(false)
    }
  }

  const handleReject = async () => {
    if (!rejectComments.trim() || rejectComments.trim().length < 10) {
      setError('Please provide at least 10 characters for rejection reason')
      return
    }

    setIsRejecting(true)
    setError(null)

    try {
      await rejectSolution(solutionId, rejectComments)
      setShowRejectDialog(false)
      setRejectComments('')
      toast.success('Solution rejected - returned to engineering')
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reject solution'
      setError(message)
      toast.error(message)
    } finally {
      setIsRejecting(false)
    }
  }

  return (
    <>
      <div className="flex gap-2">
        {/* Approve Button */}
        <Button
          onClick={() => setShowApproveDialog(true)}
          disabled={isApproving || isRejecting}
          className="flex-1 bg-green-600 hover:bg-green-700"
        >
          <CheckCircle className="mr-2 h-4 w-4" />
          Approve
        </Button>

        {/* Reject Button */}
        <Button
          onClick={() => setShowRejectDialog(true)}
          disabled={isApproving || isRejecting}
          variant="destructive"
          className="flex-1"
        >
          <XCircle className="mr-2 h-4 w-4" />
          Reject
        </Button>
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}

      {/* Approve Confirmation Dialog */}
      <AlertDialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Solution</AlertDialogTitle>
            <AlertDialogDescription>
              Do you want to approve this engineering solution? You can add optional comments below.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4">
            <label className="mb-2 block text-sm font-medium">
              Comments (optional)
            </label>
            <Textarea
              value={approveComments}
              onChange={(e) => setApproveComments(e.target.value)}
              placeholder="Add any comments about your approval..."
              rows={3}
            />
          </div>

          {error && (
            <p className="mb-4 text-sm text-red-600">{error}</p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowApproveDialog(false)
              setApproveComments('')
              setError(null)
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApprove}
              disabled={isApproving}
              className="bg-green-600 hover:bg-green-700"
            >
              {isApproving ? 'Approving...' : 'Confirm Approval'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Confirmation Dialog */}
      <AlertDialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Solution</AlertDialogTitle>
            <AlertDialogDescription>
              This will return the solution to engineering for resubmission. Please provide a reason for rejection.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4">
            <label className="mb-2 block text-sm font-medium">
              Rejection reason *
            </label>
            <Textarea
              value={rejectComments}
              onChange={(e) => setRejectComments(e.target.value)}
              placeholder="Please explain why you're rejecting this solution (min 10 characters)..."
              rows={4}
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              {rejectComments.trim().length} / 10 minimum characters
            </p>
          </div>

          {error && (
            <p className="mb-4 text-sm text-red-600">{error}</p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowRejectDialog(false)
              setRejectComments('')
              setError(null)
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={isRejecting || rejectComments.trim().length < 10}
              className="bg-red-600 hover:bg-red-700"
            >
              {isRejecting ? 'Rejecting...' : 'Confirm Rejection'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
