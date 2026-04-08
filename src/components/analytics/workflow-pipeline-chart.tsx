'use client'

import type { WorkflowPipelineSegment } from '@/types/analytics'
import { cn } from '@/lib/utils'

interface WorkflowPipelineChartProps {
  /** Pipeline data showing status breakdown at each workflow step */
  data: WorkflowPipelineSegment[]
}

// Ordered workflow steps with labels and colors
const STEP_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  ImprovementRequest: { label: 'Improvement Request', color: 'bg-blue-500', bgColor: 'bg-blue-100' },
  SentToEngineer: { label: 'Sent to Engineer', color: 'bg-indigo-500', bgColor: 'bg-indigo-100' },
  DesignCostEstimationApproval: { label: 'Cost Estimation', color: 'bg-violet-500', bgColor: 'bg-violet-100' },
  SendBackToRequester: { label: 'Sent Back', color: 'bg-amber-500', bgColor: 'bg-amber-100' },
  FinalApproval: { label: 'Final Approval', color: 'bg-orange-500', bgColor: 'bg-orange-100' },
  Completed: { label: 'Completed', color: 'bg-emerald-500', bgColor: 'bg-emerald-100' },
  Cancelled: { label: 'Cancelled', color: 'bg-red-500', bgColor: 'bg-red-100' },
}

const STEP_ORDER = [
  'ImprovementRequest',
  'SentToEngineer',
  'DesignCostEstimationApproval',
  'SendBackToRequester',
  'FinalApproval',
  'Completed',
  'Cancelled',
]

/**
 * WorkflowPipelineChart displays request distribution across workflow steps
 * Custom horizontal bar visualization with clean labels and proportional bars
 */
export function WorkflowPipelineChart({ data }: WorkflowPipelineChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
        No pipeline data available
      </div>
    )
  }

  // Sum total count for each step
  const stepTotals = data.reduce((acc, seg) => {
    acc[seg.step] = (acc[seg.step] || 0) + seg.pending + seg.approved + seg.rejected
    return acc
  }, {} as Record<string, number>)

  // Sort by workflow order, only include steps with data
  const orderedSteps = STEP_ORDER.filter((step) => stepTotals[step] > 0)
  const maxCount = Math.max(...Object.values(stepTotals), 1)

  return (
    <div className="space-y-3">
      {orderedSteps.map((step) => {
        const config = STEP_CONFIG[step] || { label: step, color: 'bg-gray-500', bgColor: 'bg-gray-100' }
        const count = stepTotals[step] || 0
        const percentage = (count / maxCount) * 100

        return (
          <div key={step} className="flex items-center gap-3">
            <div className="w-[140px] shrink-0 text-right">
              <span className="text-sm text-muted-foreground">{config.label}</span>
            </div>
            <div className="flex-1 flex items-center gap-2">
              <div className={cn('h-8 rounded-md relative overflow-hidden', config.bgColor)} style={{ width: '100%' }}>
                <div
                  className={cn('h-full rounded-md transition-all duration-500', config.color)}
                  style={{ width: `${Math.max(percentage, 2)}%` }}
                />
              </div>
              <span className="w-10 text-right text-sm font-semibold tabular-nums">{count}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
