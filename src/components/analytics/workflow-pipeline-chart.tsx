'use client'

import { Check, X } from 'lucide-react'
import type { WorkflowPipelineSegment } from '@/types/analytics'
import {
  buildWorkflowPipelineView,
  type PipelineStageView,
  type WorkflowPipelineView,
} from '@/lib/workflow-pipeline'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { PIPELINE_STAGE_COLORS } from '@/components/analytics/chart-utils'
import { cn } from '@/lib/utils'

interface WorkflowPipelineChartProps {
  data: WorkflowPipelineSegment[]
}

function RequestList({ stage }: { stage: PipelineStageView }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-1.5 text-xs">
        <span className="font-semibold">{stage.fullLabel}</span>
        <span className="text-muted-foreground">· {stage.count}</span>
      </div>
      {stage.count === 0 || stage.previews.length === 0 ? (
        <p className="text-xs text-muted-foreground">No open requests</p>
      ) : (
        <ul className="space-y-0.5">
          {stage.previews.map((item) => (
            <li key={item.id} className="truncate text-xs">
              {item.title || 'Untitled'}
            </li>
          ))}
          {stage.moreCount > 0 && (
            <li className="text-xs text-muted-foreground">+{stage.moreCount} more</li>
          )}
        </ul>
      )}
    </div>
  )
}

function ExitChip({
  stage,
  tone,
}: {
  stage: PipelineStageView
  tone: 'success' | 'muted'
}) {
  const Icon = tone === 'success' ? Check : X
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-[26px] items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium',
            tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {stage.shortLabel} {stage.count}
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-56 p-3" side="bottom" align="end">
        <RequestList stage={stage} />
      </HoverCardContent>
    </HoverCard>
  )
}

export function WorkflowPipelineExits({ view }: { view: WorkflowPipelineView }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <ExitChip stage={view.completed} tone="success" />
      <ExitChip stage={view.cancelled} tone="muted" />
      <span className="inline-flex h-[26px] items-center rounded-full bg-muted px-2.5 text-xs font-medium">
        {view.inFlightTotal} in flight
      </span>
    </div>
  )
}

function stageBarClass(stage: PipelineStageView) {
  return cn(
    'flex h-8 w-full items-center justify-center rounded-lg text-xs font-semibold tabular-nums',
    stage.count === 0
      ? 'border border-dashed border-border bg-muted/40 text-muted-foreground'
      : cn(PIPELINE_STAGE_COLORS[stage.step] ?? 'bg-blue-500', 'text-white'),
  )
}

export function WorkflowPipelineChart({ data }: WorkflowPipelineChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
        No pipeline data available
      </div>
    )
  }

  const view = buildWorkflowPipelineView(data)
  const lastIndex = view.inFlight.length - 1

  return (
    <div>
      <div className="flex w-full gap-1 overflow-visible">
        {view.inFlight.map((stage, index) => (
          <div
            key={stage.step}
            className="relative flex min-w-0 flex-col"
            style={{
              flex: stage.count > 0 ? `${stage.flexGrow} 1 0` : '0 0 36px',
            }}
          >
            <HoverCard openDelay={150} closeDelay={80}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  className={stageBarClass(stage)}
                  aria-label={`${stage.fullLabel}, ${stage.count} open requests`}
                >
                  {stage.count}
                </button>
              </HoverCardTrigger>
              <HoverCardContent
                className="w-56 p-3"
                side="top"
                align={index === 0 ? 'start' : index >= lastIndex - 1 ? 'end' : 'center'}
              >
                <RequestList stage={stage} />
              </HoverCardContent>
            </HoverCard>
            <span className="mt-2 text-center text-xs font-medium leading-tight">{stage.shortLabel}</span>
          </div>
        ))}
      </div>
      {view.bottleneck && (
        <p className="mt-2 text-xs text-muted-foreground">
          {view.bottleneck.label} holds the most volume relative to its neighbors.
        </p>
      )}
    </div>
  )
}
