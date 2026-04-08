'use client'

import { DEPT_COLORS } from './chart-utils'

interface DepartmentBreakdownChartProps {
  /** Department data with name and request count */
  data: Array<{ name: string; value: number }>
}

/**
 * DepartmentBreakdownChart displays request distribution by department
 * Horizontal bar chart with percentage labels - much clearer than pie chart
 */
export function DepartmentBreakdownChart({
  data,
}: DepartmentBreakdownChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No department data available
      </div>
    )
  }

  // Sort descending by value
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const total = sorted.reduce((sum, d) => sum + d.value, 0)
  const maxValue = sorted[0]?.value || 1

  return (
    <div className="space-y-3">
      {sorted.map((dept, index) => {
        const percentage = total > 0 ? ((dept.value / total) * 100).toFixed(0) : '0'
        const barWidth = (dept.value / maxValue) * 100
        const color = DEPT_COLORS[index % DEPT_COLORS.length]

        return (
          <div key={dept.name} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium truncate">{dept.name}</span>
              <span className="text-muted-foreground tabular-nums ml-2">
                {dept.value} <span className="text-xs">({percentage}%)</span>
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-muted/50 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(barWidth, 2)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
