'use client'

import type { Translator } from '@/lib/i18n/messages'
import { useTranslations } from '@/lib/i18n/client'
import { Clock, Zap, ArrowDown, ArrowUp, Timer } from 'lucide-react'
import type { TimeMetrics } from '@/types/analytics'
import { cn } from '@/lib/utils'

interface TimeMetricsChartProps {
  data: TimeMetrics
}

function formatHours(hours: number, t: Translator): string {
  if (hours === 0) return '—'
  if (hours < 1) return t('insights.duration.minute', { value: Math.round(hours * 60) })
  if (hours < 24) return t('insights.duration.hour', { value: hours.toFixed(1) })
  return t('insights.duration.day', { value: (hours / 24).toFixed(1) })
}

/**
 * Time Metrics Display
 * Compact stat cards showing approval time statistics
 */
export function TimeMetricsChart({ data }: TimeMetricsChartProps) {
  const t = useTranslations()
  const isEmptyData =
    data.avgPerRequest === 0 &&
    data.avgPerApprovalLevel === 0 &&
    data.medianPerRequest === 0

  if (isEmptyData) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
        {t('analytics.approvalTimeEmpty')}
      </div>
    )
  }

  const stats = [
    {
      labelKey: 'analytics.metric.average' as const,
      value: data.avgPerRequest,
      icon: Clock,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      labelKey: 'analytics.metric.median' as const,
      value: data.medianPerRequest,
      icon: Timer,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
    },
    {
      labelKey: 'analytics.metric.fastest' as const,
      value: data.minPerRequest,
      icon: Zap,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      labelKey: 'analytics.metric.slowest' as const,
      value: data.maxPerRequest,
      icon: ArrowUp,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
  ]

  // Visual range bar (min to max)
  const range = data.maxPerRequest - data.minPerRequest
  const avgPosition = range > 0 ? ((data.avgPerRequest - data.minPerRequest) / range) * 100 : 50
  const medianPosition = range > 0 ? ((data.medianPerRequest - data.minPerRequest) / range) * 100 : 50

  return (
    <div className="space-y-5">
      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.labelKey} className="flex items-center gap-3 rounded-lg border p-3">
              <div className={cn('rounded-md p-1.5', stat.bg)}>
                <Icon className={cn('h-4 w-4', stat.color)} />
              </div>
              <div>
                <p className="text-lg font-bold tracking-tight">{formatHours(stat.value, t)}</p>
                <p className="text-xs text-muted-foreground">{t(stat.labelKey)}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Visual range indicator */}
      {range > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t('analytics.completionRange')}</p>
          <div className="relative h-3 w-full rounded-full bg-gradient-to-r from-emerald-100 via-blue-100 to-red-100">
            {/* Average marker */}
            <div
              className="absolute top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-blue-500"
              style={{ left: `${Math.min(Math.max(avgPosition, 2), 98)}%` }}
              title={t('analytics.averageValue', { value: formatHours(data.avgPerRequest, t) })}
            />
            {/* Median marker */}
            <div
              className="absolute top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-violet-500"
              style={{ left: `${Math.min(Math.max(medianPosition, 2), 98)}%` }}
              title={t('analytics.medianValue', { value: formatHours(data.medianPerRequest, t) })}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{formatHours(data.minPerRequest, t)}</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-blue-500" /> {t('analytics.avgShort')}</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-violet-500" /> {t('analytics.medShort')}</span>
            </div>
            <span>{formatHours(data.maxPerRequest, t)}</span>
          </div>
        </div>
      )}

      {/* Per approval level stat */}
      {data.avgPerApprovalLevel > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {t('analytics.avgPerLevel')} <span className="font-semibold text-foreground">{formatHours(data.avgPerApprovalLevel, t)}</span>
          </span>
        </div>
      )}
    </div>
  )
}
