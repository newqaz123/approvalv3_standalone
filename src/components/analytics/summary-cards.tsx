import { ClipboardList, Clock, Timer, CheckCircle, TrendingUp, TrendingDown, Minus, Ban } from 'lucide-react'
import type { SummaryMetrics, TrendData } from '@/types/analytics'
import { cn } from '@/lib/utils'

interface SummaryCardsProps {
  summary: SummaryMetrics
  trends?: TrendData
}

function TrendBadge({ value, invertColor }: { value: number; invertColor?: boolean }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Minus className="h-3 w-3" />
        0%
      </span>
    )
  }

  const isPositive = value > 0
  // For some metrics like "pending" or "approval time", going UP is bad
  const isGood = invertColor ? !isPositive : isPositive

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isGood
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-red-50 text-red-700'
      )}
    >
      {isPositive ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {isPositive ? '+' : ''}{value}%
    </span>
  )
}

export function SummaryCards({ summary, trends }: SummaryCardsProps) {
  const metrics = [
    {
      title: 'Total Requests',
      value: summary.totalRequests ?? 0,
      formatted: String(summary.totalRequests ?? '—'),
      icon: ClipboardList,
      accent: 'bg-blue-500',
      iconBg: 'bg-blue-50',
      iconColor: 'text-blue-600',
      trend: trends?.totalRequestsChange,
      invertTrend: false,
    },
    {
      title: 'Pending',
      value: summary.pendingRequests ?? 0,
      formatted: String(summary.pendingRequests ?? '—'),
      icon: Clock,
      accent: 'bg-amber-500',
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600',
      trend: trends?.pendingRequestsChange,
      invertTrend: true,
    },
    {
      title: 'Avg Approval Time',
      value: summary.avgApprovalTime ?? 0,
      formatted:
        summary.avgApprovalTime !== undefined && summary.avgApprovalTime > 0
          ? `${summary.avgApprovalTime.toFixed(1)}h`
          : '—',
      icon: Timer,
      accent: 'bg-violet-500',
      iconBg: 'bg-violet-50',
      iconColor: 'text-violet-600',
      trend: trends?.avgApprovalTimeChange,
      invertTrend: true,
    },
    {
      title: 'Completion Rate',
      value: summary.approvalRate ?? 0,
      formatted:
        summary.approvalRate !== undefined && summary.approvalRate > 0
          ? `${summary.approvalRate.toFixed(1)}%`
          : '—',
      icon: CheckCircle,
      accent: 'bg-emerald-500',
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
      trend: trends?.approvalRateChange,
      invertTrend: false,
      subtitle: summary.cancelledCount > 0
        ? `${summary.cancelledCount} cancelled (excluded)`
        : undefined,
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric) => {
        const Icon = metric.icon
        return (
          <div
            key={metric.title}
            className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            {/* Top accent bar */}
            <div className={cn('absolute top-0 left-0 right-0 h-1', metric.accent)} />

            <div className="flex items-start justify-between pt-1">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">{metric.title}</p>
                <p className="text-2xl font-bold tracking-tight">{metric.formatted}</p>
              </div>
              <div className={cn('rounded-lg p-2', metric.iconBg)}>
                <Icon className={cn('h-5 w-5', metric.iconColor)} />
              </div>
            </div>

            {/* Trend indicator */}
            {trends && metric.trend !== undefined && (
              <div className="mt-3 flex items-center gap-1.5">
                <TrendBadge value={metric.trend} invertColor={metric.invertTrend} />
                <span className="text-xs text-muted-foreground">vs prev period</span>
              </div>
            )}

            {/* Subtitle (e.g. cancelled count) */}
            {'subtitle' in metric && metric.subtitle && (
              <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Ban className="h-3 w-3" />
                {metric.subtitle}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
