import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { ClipboardList, Clock, Timer, CheckCircle } from 'lucide-react'
import type { SummaryMetrics } from '@/types/analytics'

interface SummaryCardsProps {
  summary: SummaryMetrics
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  const metrics = [
    {
      title: 'Total Requests',
      value: summary.totalRequests ?? '—',
      icon: ClipboardList,
      color: 'text-blue-600',
    },
    {
      title: 'Pending',
      value: summary.pendingRequests ?? '—',
      icon: Clock,
      color: 'text-yellow-600',
    },
    {
      title: 'Avg Approval Time',
      value: summary.avgApprovalTime !== undefined && summary.avgApprovalTime > 0
        ? `${summary.avgApprovalTime.toFixed(1)} hours`
        : '—',
      icon: Timer,
      color: 'text-purple-600',
    },
    {
      title: 'Approval Rate',
      value: summary.approvalRate !== undefined && summary.approvalRate > 0
        ? `${summary.approvalRate.toFixed(1)}%`
        : '—',
      icon: CheckCircle,
      color: 'text-green-600',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {metrics.map((metric) => {
        const Icon = metric.icon
        return (
          <Card key={metric.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="text-sm font-medium text-muted-foreground">
                {metric.title}
              </div>
              <Icon className={`h-4 w-4 ${metric.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
