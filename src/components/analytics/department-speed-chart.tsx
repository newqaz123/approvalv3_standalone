'use client'

import { Trophy } from 'lucide-react'
import type { DepartmentApprovalSpeed } from '@/types/analytics'
import { cn } from '@/lib/utils'

interface DepartmentSpeedChartProps {
  data: DepartmentApprovalSpeed[]
}

const STEP_CONFIG = [
  { key: 'avgImprovementHours' as const, label: 'Improvement Approval', color: 'bg-blue-500', textColor: 'text-blue-600', dotColor: 'bg-blue-500' },
  { key: 'avgEngineeringHours' as const, label: 'Engineering', color: 'bg-amber-500', textColor: 'text-amber-600', dotColor: 'bg-amber-500' },
  { key: 'avgFinalApprovalHours' as const, label: 'Final Approval', color: 'bg-emerald-500', textColor: 'text-emerald-600', dotColor: 'bg-emerald-500' },
]

function formatDuration(hours: number): string {
  if (hours === 0) return '—'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  const days = hours / 24
  return `${days.toFixed(1)}d`
}

/**
 * Department Approval Speed - Stacked Racing Track Chart
 * Shows per-department avg approval speed with step-level breakdown
 * Steps: Improvement Approval → Engineering → Final Approval
 * Departments sorted fastest → slowest
 */
export function DepartmentSpeedChart({ data }: DepartmentSpeedChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
        No completed requests to calculate department speeds
      </div>
    )
  }

  const maxHours = Math.max(...data.map((d) => d.avgHours))

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {STEP_CONFIG.map((step) => (
          <span key={step.key} className="flex items-center gap-1.5">
            <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', step.dotColor)} />
            <span className="text-muted-foreground">{step.label}</span>
          </span>
        ))}
      </div>

      {/* Racing lanes */}
      <div className="space-y-3">
        {data.map((dept, index) => {
          const totalPct = maxHours > 0 ? (dept.avgHours / maxHours) * 100 : 0
          const isFirst = index === 0

          // Calculate each step's proportion within this department's total bar
          const stepSegments = STEP_CONFIG.map((step) => {
            const hours = dept[step.key]
            const pct = dept.avgHours > 0 ? (hours / dept.avgHours) * totalPct : 0
            return { ...step, hours, pct }
          })

          return (
            <div key={dept.name} className="group">
              {/* Lane row */}
              <div className="flex items-center gap-3">
                {/* Position */}
                <div
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    isFirst
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {isFirst ? <Trophy className="h-3.5 w-3.5" /> : index + 1}
                </div>

                {/* Department name */}
                <span className="w-28 shrink-0 truncate text-sm font-medium" title={dept.name}>
                  {dept.name}
                </span>

                {/* Stacked track bar */}
                <div className="relative flex-1 h-7 rounded-full bg-muted/40 overflow-hidden">
                  {/* Grid lines */}
                  {[25, 50, 75].map((pct) => (
                    <div
                      key={pct}
                      className="absolute top-0 bottom-0 w-px bg-muted-foreground/10 z-[1]"
                      style={{ left: `${pct}%` }}
                    />
                  ))}

                  {/* Stacked segments */}
                  <div className="flex h-full" style={{ width: `${Math.max(totalPct, 6)}%` }}>
                    {stepSegments.map((seg) => {
                      if (seg.pct <= 0) return null
                      // Each segment's width is its proportion of the total bar width
                      const segWidthInBar = dept.avgHours > 0
                        ? (seg.hours / dept.avgHours) * 100
                        : 0
                      return (
                        <div
                          key={seg.key}
                          className={cn('h-full first:rounded-l-full last:rounded-r-full', seg.color)}
                          style={{ width: `${segWidthInBar}%` }}
                          title={`${seg.label}: ${formatDuration(seg.hours)}`}
                        />
                      )
                    })}
                  </div>
                </div>

                {/* Total time label */}
                <div className="w-16 shrink-0 text-right">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatDuration(dept.avgHours)}
                  </span>
                </div>
              </div>

              {/* Step detail on hover */}
              <div className="hidden group-hover:flex items-center gap-3 pl-[164px] pr-[76px] mt-1 text-[11px]">
                {stepSegments.map((seg) => (
                  <span key={seg.key} className={cn('flex items-center gap-1', seg.textColor)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', seg.dotColor)} />
                    {seg.label}: <span className="font-semibold">{formatDuration(seg.hours)}</span>
                  </span>
                ))}
                <span className="text-muted-foreground ml-auto">{dept.completedCount} completed</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Scale */}
      <div className="flex items-center gap-3 pl-[164px]">
        <div className="flex-1 flex justify-between text-[10px] text-muted-foreground">
          <span>0</span>
          <span>{formatDuration(maxHours * 0.25)}</span>
          <span>{formatDuration(maxHours * 0.5)}</span>
          <span>{formatDuration(maxHours * 0.75)}</span>
          <span>{formatDuration(maxHours)}</span>
        </div>
        <div className="w-16" />
      </div>
    </div>
  )
}
