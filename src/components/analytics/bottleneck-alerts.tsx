'use client'

import { AlertTriangle, Clock } from 'lucide-react'
import type { Bottleneck } from '@/types/analytics'
import { cn } from '@/lib/utils'

interface BottleneckAlertsProps {
  data: Bottleneck[]
}

function formatWaitTime(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  const days = hours / 24
  return `${days.toFixed(1)}d`
}

/**
 * BottleneckAlerts shows workflow steps where requests are stuck
 * Sorted by average wait time (worst first)
 */
export function BottleneckAlerts({ data }: BottleneckAlertsProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="rounded-full bg-emerald-100 p-1">
          <Clock className="h-4 w-4 text-emerald-600" />
        </div>
        <p className="text-sm text-emerald-700">All workflow steps are flowing smoothly</p>
      </div>
    )
  }

  // Determine severity based on wait time
  function getSeverity(avgWaitHours: number): 'critical' | 'warning' | 'info' {
    if (avgWaitHours > 72) return 'critical'  // > 3 days
    if (avgWaitHours > 24) return 'warning'   // > 1 day
    return 'info'
  }

  const severityConfig = {
    critical: {
      border: 'border-red-200',
      bg: 'bg-red-50',
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
      textColor: 'text-red-700',
      badge: 'bg-red-100 text-red-700',
    },
    warning: {
      border: 'border-amber-200',
      bg: 'bg-amber-50',
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
      textColor: 'text-amber-700',
      badge: 'bg-amber-100 text-amber-700',
    },
    info: {
      border: 'border-blue-200',
      bg: 'bg-blue-50',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      textColor: 'text-blue-700',
      badge: 'bg-blue-100 text-blue-700',
    },
  }

  return (
    <div className="space-y-2">
      {data.map((bottleneck) => {
        const severity = getSeverity(bottleneck.avgWaitHours)
        const config = severityConfig[severity]

        return (
          <div
            key={bottleneck.step}
            className={cn(
              'flex items-center justify-between rounded-lg border px-4 py-3',
              config.border,
              config.bg
            )}
          >
            <div className="flex items-center gap-3">
              <div className={cn('rounded-full p-1', config.iconBg)}>
                <AlertTriangle className={cn('h-4 w-4', config.iconColor)} />
              </div>
              <div>
                <p className={cn('text-sm font-medium', config.textColor)}>
                  {bottleneck.count} request{bottleneck.count !== 1 ? 's' : ''} at {bottleneck.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  Avg wait: {formatWaitTime(bottleneck.avgWaitHours)}
                </p>
              </div>
            </div>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', config.badge)}>
              {severity === 'critical' ? 'Critical' : severity === 'warning' ? 'Warning' : 'Active'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
