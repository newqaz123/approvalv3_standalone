'use client'

import { Check, Clock, X, User } from 'lucide-react'
import { format } from 'date-fns'
import { RejectedBadge } from '@/components/requests/rejected-badge'

interface Approval {
  id: string
  requiredLevel?: number | null
  requiredApprover?: {
    id: string
    name: string
    email: string
  } | null
  order: number
  status: 'pending' | 'approved' | 'rejected'
  comments: string | null
  approvedAt: Date | null
  approver?: {
    id: string
    name: string
    email: string
    level?: number
  } | null
  eligibleApprovers?: Array<{
    id: string
    name: string
    level: number
  }>
  isCustomChain?: boolean
}

interface ApprovalProgressProps {
  approvals: Approval[]
}

export function ApprovalProgress({ approvals }: ApprovalProgressProps) {
  if (approvals.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No approvals required
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {approvals.map((approval, index) => {
        const isPending = approval.status === 'pending'
        const isApproved = approval.status === 'approved'
        const isRejected = approval.status === 'rejected'
        const isCurrent = isPending && index === approvals.findIndex(a => a.status === 'pending')

        return (
          <div
            key={approval.id}
            className={`relative rounded-lg border p-4 ${
              isCurrent
                ? 'border-blue-300 bg-blue-50'
                : isRejected
                ? 'border-red-200 bg-red-50'
                : 'border-gray-200'
            }`}
          >
            {/* Order Number */}
            <div className="absolute left-2 top-1/2 -translate-y-1/2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  isApproved
                    ? 'bg-green-100 text-green-700'
                    : isRejected
                    ? 'bg-red-100 text-red-700'
                    : isCurrent
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {index + 1}
              </div>
            </div>

            <div className="ml-12 space-y-2">
              {/* Approver Info */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {approval.requiredApprover?.name || approval.approver?.name || approval.eligibleApprovers?.[0]?.name || `Level ${approval.requiredLevel} Approval`}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                    isApproved
                      ? 'bg-green-600 text-white'
                      : isRejected
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {isPending && <Clock className="mr-1 h-3 w-3" />}
                  {isApproved && <Check className="mr-1 h-3 w-3" />}
                  {isRejected && <X className="mr-1 h-3 w-3" />}
                  {approval.status.charAt(0).toUpperCase() + approval.status.slice(1)}
                </span>
              </div>

              {/* Approval Details */}
              {approval.approver && (
                <div className="text-sm text-gray-600">
                  <p>Approved by: {approval.approver.name}</p>
                  {approval.approvedAt && (
                    <p className="text-xs text-gray-500">
                      {format(new Date(approval.approvedAt), 'PPP p')}
                    </p>
                  )}
                </div>
              )}

              {/* Comments */}
              {approval.comments && (
                <div className="rounded-md bg-white p-2 text-sm text-gray-700">
                  <p className="font-medium">Comments:</p>
                  <p className="whitespace-pre-wrap">{approval.comments}</p>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
