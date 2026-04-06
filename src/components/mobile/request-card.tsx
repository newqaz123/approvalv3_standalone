'use client'

import { FileText, ChevronRight, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { StatusBadge } from '@/components/requests/status-badge'
import { RejectedBadge } from '@/components/requests/rejected-badge'
import { ApprovalStatusBadge } from '@/components/requests/approval-status-badge'

// Use the same RequestListRow type from request-table
export type RequestListRow = {
  id: string
  title: string
  status: string
  createdAt: Date
  requesterId: string
  department: { name: string } | null
  requester: { id: string; name: string } | null
  _count: { fileAttachments: number }
  hasRejection?: boolean
  approvals?: Array<{
    id: string
    status: 'pending' | 'approved' | 'rejected'
    approver?: { name: string } | null
    requiredLevel: number
    order: number
    approvedAt?: Date | null
  }>
  // Additional fields for dashboard cards
  approvalLevel?: number
  totalApprovalLevels?: number
  approvalCount?: number
  totalApprovals?: number
}

interface RequestCardProps {
  request: RequestListRow
  onTap: (requestId: string) => void
  showRequester?: boolean
  showDepartment?: boolean
  showApprovalProgress?: boolean
}

export function RequestCard({
  request,
  onTap,
  showRequester = false,
  showDepartment = false,
  showApprovalProgress = false,
}: RequestCardProps) {
  const date = new Date(request.createdAt)
  const fileCount = request._count?.fileAttachments || 0

  return (
    <button
      onClick={() => onTap(request.id)}
      className="w-full text-left bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md active:bg-gray-50 transition-all min-h-[64px] flex flex-col justify-between"
    >
      {/* Top row: Title + Chevron */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-medium text-gray-900 flex-1 line-clamp-2">
          {request.title}
          {request.hasRejection && (request.status === 'ImprovementRequest' || request.status === 'SentToEngineer') && (
            <span className="ml-2 inline-flex items-center">
              <RejectedBadge size="sm" showText={false} />
            </span>
          )}
        </h3>
        <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />
      </div>

      {/* Middle row: Status badge + Key info */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <StatusBadge
          status={request.status as any}
          hasRejection={request.hasRejection && (request.status === 'ImprovementRequest' || request.status === 'SentToEngineer')}
        />

        {/* Approval status badge */}
        {request.approvals && request.approvals.length > 0 && (
          <ApprovalStatusBadge
            key={`approvals-${request.id}-${request.approvals?.map(a => a.status).join('-')}`}
            approvals={request.approvals}
            requestStatus={request.status}
            size="sm"
          />
        )}

        {/* Date */}
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <Clock className="h-3 w-3" />
          {format(date, 'MMM d, yyyy')}
        </span>

        {/* File count if present */}
        {fileCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <FileText className="h-3 w-3" />
            {fileCount}
          </span>
        )}
      </div>

      {/* Bottom row: Additional context (requester, department, approval progress) */}
      {(showRequester || showDepartment || showApprovalProgress) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 border-t border-gray-100 pt-2 mt-1">
          {showRequester && request.requester?.name && (
            <div className="flex items-center gap-1">
              <span className="font-medium">Requester:</span>
              <span>{request.requester.name}</span>
            </div>
          )}

          {showDepartment && request.department?.name && (
            <div className="flex items-center gap-1">
              <span className="font-medium">Dept:</span>
              <span>{request.department.name}</span>
            </div>
          )}

          {showApprovalProgress && request.approvalLevel !== undefined && request.totalApprovalLevels !== undefined && (
            <div className="flex items-center gap-1">
              <span className="font-medium">Approval:</span>
              <span>
                Level {request.approvalLevel} of {request.totalApprovalLevels}
              </span>
            </div>
          )}

          {showApprovalProgress && request.approvalCount !== undefined && request.totalApprovals !== undefined && (
            <div className="flex items-center gap-1">
              <span className="font-medium">Approvals:</span>
              <span>
                {request.approvalCount}/{request.totalApprovals}
              </span>
            </div>
          )}
        </div>
      )}
    </button>
  )
}

// Empty state component for mobile card views
interface RequestCardsEmptyStateProps {
  message?: string
  submessage?: string
}

export function RequestCardsEmptyState({
  message = 'No requests found',
  submessage = 'Create your first request to get started',
}: RequestCardsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-gray-500">
      <FileText className="h-12 w-12 mb-3 opacity-50" />
      <p className="font-medium text-gray-700">{message}</p>
      <p className="text-sm mt-1">{submessage}</p>
    </div>
  )
}
