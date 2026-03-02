'use client'

import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface Approval {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  approver?: { name: string } | null
  requiredApprover?: { name: string } | null
  requiredLevel: number
  order: number
  approvedAt?: Date | null
  isFinalApproval?: boolean
  // For pending approvals, show potential approvers
  potentialApprovers?: { name: string }[] | null
}

interface ApprovalStatusBadgeProps {
  approvals: Approval[]
  requestStatus: string
  size?: 'default' | 'sm'
}

export function ApprovalStatusBadge({
  approvals,
  requestStatus,
  size = 'default',
}: ApprovalStatusBadgeProps) {
  // Calculate overall approval state
  const approvedCount = approvals.filter((a) => a.status === 'approved').length
  const rejectedCount = approvals.filter((a) => a.status === 'rejected').length
  const pendingCount = approvals.filter((a) => a.status === 'pending').length
  const totalCount = approvals.length

  // Determine badge display - simplified: only show "Approving" for in-progress, "-" for others
  const inProgress = approvals.length > 0 && pendingCount > 0 && rejectedCount === 0

  // If not in progress, just show "-"
  if (!inProgress) {
    return (
      <div className={cn('text-center text-gray-400', size === 'sm' && 'text-xs')}>
        —
      </div>
    )
  }

  // Separate approvals by stage to show only current stage
  const initialStageApprovals = approvals.filter(a => !a.isFinalApproval)
  const finalStageApprovals = approvals.filter(a => a.isFinalApproval)

  // Determine which stage to display based on which has pending approvals
  const hasPendingInFinal = finalStageApprovals.some(a => a.status === 'pending')
  const currentStageApprovals = hasPendingInFinal ? finalStageApprovals : initialStageApprovals

  // Format date for display
  const formatDate = (date: Date | null | undefined) => {
    if (!date) return null
    const d = new Date(date)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <Badge
          variant="default"
          className={cn(
            'font-normal cursor-help whitespace-nowrap bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border-yellow-300',
            size === 'sm' && 'text-[10px] px-2 py-0'
          )}
        >
          <span className="flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Approving
          </span>
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent
        className="w-64 p-0"
        side="bottom"
        align="center"
      >
        <div className="border-b px-3 py-2 bg-gray-50/50">
          <p className="text-sm font-medium text-gray-700">Approval Hierarchy</p>
        </div>
        <div className="p-2">
          <div className="space-y-0.5">
            {currentStageApprovals
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((approval) => {
                const isApproved = approval.status === 'approved'
                const isRejected = approval.status === 'rejected'
                const isPending = approval.status === 'pending'

                return (
                  <div
                    key={approval.id}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm',
                      isApproved && 'bg-green-50/50',
                      isRejected && 'bg-red-50/50',
                      isPending && 'bg-yellow-50/30'
                    )}
                  >
                    {/* Status icon */}
                    <div className="flex-shrink-0">
                      {isApproved && (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      )}
                      {isRejected && (
                        <XCircle className="h-4 w-4 text-red-600" />
                      )}
                      {isPending && (
                        <Clock className="h-4 w-4 text-yellow-600" />
                      )}
                    </div>

                    {/* Level and status text */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-700">
                          {/* Show approver name for approved/rejected, requiredApprover or potential approvers for pending */}
                          {isApproved || isRejected ? (
                            approval.approver?.name || `Level ${approval.requiredLevel}`
                          ) : approval.requiredApprover?.name ? (
                            approval.requiredApprover.name
                          ) : approval.potentialApprovers && approval.potentialApprovers.length > 0 ? (
                            // Show potential approvers (e.g., "User A or User B")
                            approval.potentialApprovers.map(p => p.name).join(' or ')
                          ) : (
                            `Level ${approval.requiredLevel}`
                          )}
                        </span>
                        <span className={cn(
                          'text-xs capitalize',
                          isApproved && 'text-green-700',
                          isRejected && 'text-red-700',
                          isPending && 'text-yellow-700'
                        )}>
                          {approval.status}
                        </span>
                      </div>

                      {/* Approved/rejected date */}
                      {(isApproved || isRejected) && approval.approvedAt && (
                        <div className="text-xs text-gray-500">
                          {formatDate(approval.approvedAt)}
                        </div>
                      )}

                      {/* Pending indicator */}
                      {isPending && !approval.requiredApprover && !approval.potentialApprovers && (
                        <div className="text-xs text-gray-500">
                          Awaiting approval
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
