'use client'

import { useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { CheckCircle2, XCircle, Users, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  initiateFinalApproval,
  approveFinalApproval,
  rejectFinalApproval,
} from '@/server-actions/solutions'
import { CustomApprovalPicker } from '@/components/solutions/custom-approval-picker'

interface InitiateFinalApprovalButtonProps {
  requestId: string
  departmentUsers: Array<{ id: string; name: string; email: string; level: number | null }>
  onSuccess?: () => void
}

/**
 * Button to initiate final department approval
 * Shown to department users when status is SendBackToRequester
 */
export function InitiateFinalApprovalButton({
  requestId,
  departmentUsers,
  onSuccess,
}: InitiateFinalApprovalButtonProps) {
  const { user } = useUser()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [useCustomChain, setUseCustomChain] = useState(false)
  const [customApprovers, setCustomApprovers] = useState<string[]>([])

  const handleSubmit = async () => {
    if (useCustomChain && customApprovers.length === 0) {
      toast.error('Please select at least one approver for the custom chain')
      return
    }

    setLoading(true)
    try {
      await initiateFinalApproval(
        requestId,
        useCustomChain,
        useCustomChain ? customApprovers : undefined
      )
      toast.success('Final approval initiated successfully')
      setOpen(false)
      setUseCustomChain(false)
      setCustomApprovers([])
      onSuccess?.()
    } catch (error: any) {
      console.error('Failed to initiate final approval:', error)
      toast.error(error.message || 'Failed to initiate final approval')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto"
      >
        <UserCheck className="h-4 w-4 mr-2" />
        Route for Final Approval
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Initiate Final Approval</DialogTitle>
            <DialogDescription>
              Choose how this solution should be routed for final department approval.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  setUseCustomChain(false)
                  setCustomApprovers([])
                }}
                className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                  !useCustomChain
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="font-medium">Use default department hierarchy</div>
                <div className="text-sm text-gray-600 mt-1">
                  Approvers will follow the configured approval hierarchy for your department.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setUseCustomChain(true)}
                className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                  useCustomChain
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="font-medium">Use custom approval chain</div>
                <div className="text-sm text-gray-600 mt-1">
                  Select specific people to approve in sequential order.
                </div>
              </button>
            </div>

            {useCustomChain && user && (
              <div className="pl-2">
                <CustomApprovalPicker
                  users={departmentUsers}
                  selectedIds={customApprovers}
                  onChange={setCustomApprovers}
                  currentUserId={user.id}
                  disabled={loading}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? 'Initiating...' : 'Initiate Final Approval'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface FinalApprovalActionsProps {
  requestId: string
  canApprove: boolean
  approval?: any
  onSuccess?: () => void
  expectedUpdatedAt?: Date | string
  onFormInteraction?: () => void
}

/**
 * Approve/reject buttons for final approval
 * Shown to approvers when status is FinalApproval
 */
export function FinalApprovalActions({
  requestId,
  canApprove,
  approval,
  onSuccess,
  expectedUpdatedAt,
  onFormInteraction,
}: FinalApprovalActionsProps) {
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectComment, setRejectComment] = useState('')
  const [loading, setLoading] = useState(false)

  const handleApprove = async () => {
    setLoading(true)
    try {
      const result = await approveFinalApproval(requestId, undefined, expectedUpdatedAt)

      if (result && 'stale' in result && result.stale) {
        toast.error('This request was updated by another user. Please refresh and try again.')
        return
      }

      toast.success('Final approval approved successfully')
      onSuccess?.()
    } catch (error: any) {
      console.error('Failed to approve:', error)
      toast.error(error.message || 'Failed to approve')
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    if (!rejectComment.trim()) {
      toast.error('Please provide a reason for rejection')
      return
    }

    setLoading(true)
    try {
      const result = await rejectFinalApproval(requestId, rejectComment, expectedUpdatedAt)

      if (result && 'stale' in result && result.stale) {
        toast.error('This request was updated by another user. Please refresh and try again.')
        return
      }

      toast.success('Final approval rejected. Request returned to engineering.')
      setRejectDialogOpen(false)
      setRejectComment('')
      onSuccess?.()
    } catch (error: any) {
      console.error('Failed to reject:', error)
      toast.error(error.message || 'Failed to reject')
    } finally {
      setLoading(false)
    }
  }

  if (!canApprove) {
    return null
  }

  return (
    <>
      <div className="flex gap-2">
        <Button
          onClick={handleApprove}
          disabled={loading}
          size="sm"
        >
          <CheckCircle2 className="h-4 w-4 mr-1" />
          Approve
        </Button>
        <Button
          onClick={() => setRejectDialogOpen(true)}
          variant="destructive"
          disabled={loading}
          size="sm"
        >
          <XCircle className="h-4 w-4 mr-1" />
          Reject
        </Button>
      </div>

      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Final Approval?</AlertDialogTitle>
            <AlertDialogDescription>
              This will return the request to engineering for revision. The engineering team will need to address your feedback and resubmit the solution.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4">
            <Label htmlFor="reject-comment">Reason for rejection *</Label>
            <Textarea
              id="reject-comment"
              placeholder="Please explain why this final approval is being rejected..."
              value={rejectComment}
              onChange={(e) => {
                setRejectComment(e.target.value)
                onFormInteraction?.()
              }}
              onFocus={() => onFormInteraction?.()}
              rows={4}
              className="mt-2"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleReject()
              }}
              disabled={loading || !rejectComment.trim()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading ? 'Rejecting...' : 'Reject & Return to Engineering'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface FinalApprovalStatusProps {
  approval?: any
}

/**
 * Display message about who is approving next
 * Shown when user cannot approve
 */
export function FinalApprovalStatus({ approval }: FinalApprovalStatusProps) {
  if (!approval) {
    return null
  }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <Users className="h-4 w-4" />
      <span>
        Awaiting approval from{' '}
        {approval.isCustomChain
          ? approval.requiredApprover?.name || 'Unknown'
          : `Level ${approval.requiredLevel}`}
      </span>
    </div>
  )
}
