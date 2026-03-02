import { Badge } from '@/components/ui/badge'
import { RequestStatus } from '@prisma/client'

interface StatusBadgeProps {
  status: RequestStatus
  hasRejection?: boolean
}

const statusConfig = {
  [RequestStatus.ImprovementRequest]: {
    label: 'Improvement Request',
    variant: 'default' as const,
    className: 'bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200',
  },
  [RequestStatus.SentToEngineer]: {
    label: 'Sent to Engineer',
    variant: 'default' as const,
    className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200',
  },
  [RequestStatus.DesignCostEstimationApproval]: {
    label: 'Design & Cost Approval',
    variant: 'default' as const,
    className: 'bg-purple-100 text-purple-800 hover:bg-purple-100 border-purple-200',
  },
  [RequestStatus.SendBackToRequester]: {
    label: 'Sent Back to Requester',
    variant: 'default' as const,
    className: 'bg-orange-100 text-orange-800 hover:bg-orange-100 border-orange-200',
  },
  [RequestStatus.FinalApproval]: {
    label: 'Final Approval',
    variant: 'default' as const,
    className: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-100 border-indigo-200',
  },
  [RequestStatus.Completed]: {
    label: 'Completed',
    variant: 'default' as const,
    className: 'bg-green-100 text-green-800 hover:bg-green-100 border-green-200',
  },
  [RequestStatus.Cancelled]: {
    label: 'Cancelled',
    variant: 'default' as const,
    className: 'bg-gray-100 text-gray-800 hover:bg-gray-100 border-gray-200',
  },
}

export function StatusBadge({ status, hasRejection }: StatusBadgeProps) {
  // Get base config for this status
  const config = { ...statusConfig[status] }

  // Add red styling for rejection indicator, but keep actual status text
  if (hasRejection && (status === RequestStatus.SentToEngineer || status === RequestStatus.ImprovementRequest)) {
    config.className = 'bg-red-100 text-red-800 hover:bg-red-100 border-red-200'
  }

  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  )
}
