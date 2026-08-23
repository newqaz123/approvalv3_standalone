import type { PipelineRequestPreview, WorkflowPipelineSegment } from '@/types/analytics'

export const PIPELINE_PREVIEW_LIMIT = 4

export const IN_FLIGHT_STEPS = [
  'ImprovementRequest',
  'SentToEngineer',
  'DesignCostEstimationApproval',
  'SendBackToRequester',
  'FinalApproval',
] as const

export type InFlightStep = (typeof IN_FLIGHT_STEPS)[number]

const STEP_LABELS: Record<string, { short: string; full: string }> = {
  ImprovementRequest: { short: 'Request', full: 'Improvement Request' },
  SentToEngineer: { short: 'Engineer', full: 'Sent to Engineer' },
  DesignCostEstimationApproval: { short: 'Cost est', full: 'Cost Estimation' },
  SendBackToRequester: { short: 'Sent back', full: 'Sent Back' },
  FinalApproval: { short: 'Final', full: 'Final Approval' },
  Completed: { short: 'Completed', full: 'Completed' },
  Cancelled: { short: 'Cancelled', full: 'Cancelled' },
}

export interface PipelineStageView {
  step: string
  shortLabel: string
  fullLabel: string
  count: number
  flexGrow: number
  previews: PipelineRequestPreview[]
  moreCount: number
}

export interface WorkflowPipelineView {
  inFlight: PipelineStageView[]
  completed: PipelineStageView
  cancelled: PipelineStageView
  inFlightTotal: number
  bottleneck: { step: string; label: string } | null
}

export function segmentCount(seg?: WorkflowPipelineSegment): number {
  if (!seg) return 0
  return seg.pending + seg.approved + seg.rejected
}

function toStageView(step: string, seg?: WorkflowPipelineSegment): PipelineStageView {
  const count = segmentCount(seg)
  const labels = STEP_LABELS[step] ?? { short: step, full: step }
  const previews = (seg?.previews ?? []).slice(0, PIPELINE_PREVIEW_LIMIT)
  return {
    step,
    shortLabel: labels.short,
    fullLabel: labels.full,
    count,
    flexGrow: count,
    previews,
    moreCount: Math.max(0, count - previews.length),
  }
}

export function buildWorkflowPipelineView(
  data: WorkflowPipelineSegment[],
): WorkflowPipelineView {
  const byStep = new Map(data.map((seg) => [seg.step, seg]))
  const inFlight = IN_FLIGHT_STEPS.map((step) => toStageView(step, byStep.get(step)))
  const inFlightTotal = inFlight.reduce((sum, stage) => sum + stage.count, 0)
  const peak = inFlight.reduce<PipelineStageView | null>((best, stage) => {
    if (stage.count <= 0) return best
    if (!best || stage.count > best.count) return stage
    return best
  }, null)

  return {
    inFlight,
    completed: toStageView('Completed', byStep.get('Completed')),
    cancelled: toStageView('Cancelled', byStep.get('Cancelled')),
    inFlightTotal,
    bottleneck: peak
      ? { step: peak.step, label: peak.shortLabel }
      : null,
  }
}
