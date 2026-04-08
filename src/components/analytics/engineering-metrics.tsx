'use client'

import { Wrench, Clock, Zap, ArrowUp, Activity, Loader2 } from 'lucide-react'
import type { EngineeringMetrics } from '@/types/analytics'
import { cn } from '@/lib/utils'

interface EngineeringMetricsProps {
  data: EngineeringMetrics
}

function formatDuration(hours: number): string {
  if (hours === 0) return '—'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  const days = hours / 24
  if (days < 7) return `${days.toFixed(1)}d`
  return `${(days / 7).toFixed(1)}w`
}

/**
 * Engineering Metrics component
 * Displays engineering cycle time KPIs (SentToEngineer → SendBackToRequester)
 */
export function EngineeringMetricsPanel({ data }: EngineeringMetricsProps) {
  const hasCompletedData = data.completedCount > 0

  const stats = [
    {
      label: 'Avg Cycle Time',
      value: data.avgCycleHours,
      icon: Clock,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Median',
      value: data.medianCycleHours,
      icon: Activity,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
    },
    {
      label: 'Fastest',
      value: data.minCycleHours,
      icon: Zap,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Slowest',
      value: data.maxCycleHours,
      icon: ArrowUp,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
  ]

  return (
    <div className="space-y-5">
      {/* Summary counters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2">
          <Wrench className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold text-emerald-700">{data.completedCount}</span>
          <span className="text-xs text-emerald-600">completed</span>
        </div>
        {data.inProgressCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
            <Loader2 className="h-4 w-4 text-amber-600 animate-spin" />
            <span className="text-sm font-semibold text-amber-700">{data.inProgressCount}</span>
            <span className="text-xs text-amber-600">in progress</span>
          </div>
        )}
      </div>

      {/* Cycle time stats */}
      {hasCompletedData ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {stats.map((stat) => {
              const Icon = stat.icon
              return (
                <div key={stat.label} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className={cn('rounded-md p-1.5', stat.bg)}>
                    <Icon className={cn('h-4 w-4', stat.color)} />
                  </div>
                  <div>
                    <p className="text-lg font-bold tracking-tight">{formatDuration(stat.value)}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Visual range bar */}
          {data.maxCycleHours > data.minCycleHours && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Engineering Cycle Range</p>
              <div className="relative h-3 w-full rounded-full bg-gradient-to-r from-emerald-100 via-blue-100 to-red-100">
                {(() => {
                  const range = data.maxCycleHours - data.minCycleHours
                  const avgPos = ((data.avgCycleHours - data.minCycleHours) / range) * 100
                  const medPos = ((data.medianCycleHours - data.minCycleHours) / range) * 100
                  return (
                    <>
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-blue-500"
                        style={{ left: `${Math.min(Math.max(avgPos, 2), 98)}%` }}
                        title={`Average: ${formatDuration(data.avgCycleHours)}`}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-violet-500"
                        style={{ left: `${Math.min(Math.max(medPos, 2), 98)}%` }}
                        title={`Median: ${formatDuration(data.medianCycleHours)}`}
                      />
                    </>
                  )
                })()}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{formatDuration(data.minCycleHours)}</span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-blue-500" /> Avg
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-violet-500" /> Med
                  </span>
                </div>
                <span>{formatDuration(data.maxCycleHours)}</span>
              </div>
            </div>
          )}

          {/* Recent cycles table */}
          {data.recentCycles.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Recent Engineering Cycles</p>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Request</th>
                      <th className="px-3 py-2 text-right font-medium">Cycle Time</th>
                      <th className="px-3 py-2 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.recentCycles.map((cycle) => (
                      <tr key={cycle.requestId} className="hover:bg-muted/30">
                        <td className="px-3 py-2 truncate max-w-[200px]" title={cycle.title}>
                          {cycle.title}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {cycle.cycleHours !== null ? formatDuration(cycle.cycleHours) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {cycle.sentBackAt ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              Done
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                              In Progress
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center h-[120px] text-muted-foreground text-sm">
          No completed engineering cycles yet
        </div>
      )}
    </div>
  )
}
