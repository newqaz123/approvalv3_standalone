import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PIPELINE_PREVIEW_LIMIT,
  buildWorkflowPipelineView,
} from '@/lib/workflow-pipeline'
import type { WorkflowPipelineSegment } from '@/types/analytics'

const read = (path: string) => readFileSync(path, 'utf8')

function segment(
  step: string,
  count: number,
  previews: Array<{ id: string; title: string }> = [],
): WorkflowPipelineSegment {
  const pending = step === 'Completed' || step === 'Cancelled' ? 0 : count
  const approved = step === 'Completed' ? count : 0
  const rejected = step === 'Cancelled' ? count : 0
  return { step, pending, approved, rejected, previews }
}

describe('buildWorkflowPipelineView', () => {
  it('keeps all in-flight stages in path order, including zeros, and treats Completed/Cancelled as exits', () => {
    const view = buildWorkflowPipelineView([
      segment('SentToEngineer', 4, [{ id: 'e1', title: 'Conveyor' }]),
      segment('ImprovementRequest', 3),
      segment('Completed', 2),
      segment('Cancelled', 5),
    ])

    assert.deepEqual(
      view.inFlight.map((s) => [s.step, s.count]),
      [
        ['ImprovementRequest', 3],
        ['SentToEngineer', 4],
        ['DesignCostEstimationApproval', 0],
        ['SendBackToRequester', 0],
        ['FinalApproval', 0],
      ],
    )
    assert.equal(view.inFlightTotal, 7)
    assert.equal(view.completed.count, 2)
    assert.equal(view.cancelled.count, 5)
    assert.ok(!view.inFlight.some((s) => s.step === 'Completed' || s.step === 'Cancelled'))
  })

  it('sets flexGrow to the count so column width encodes volume; zeros stay at 0', () => {
    const view = buildWorkflowPipelineView([
      segment('ImprovementRequest', 3),
      segment('SentToEngineer', 4),
      segment('DesignCostEstimationApproval', 2),
    ])

    assert.deepEqual(
      view.inFlight.map((s) => s.flexGrow),
      [3, 4, 2, 0, 0],
    )
    assert.equal(view.bottleneck?.step, 'SentToEngineer')
    assert.match(view.bottleneck?.label ?? '', /Engineer/)
  })

  it('caps hover previews at 4 and reports the remainder as moreCount', () => {
    const previews = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`,
      title: `Request ${i + 1}`,
    }))
    const view = buildWorkflowPipelineView([segment('SentToEngineer', 6, previews)])
    const engineer = view.inFlight.find((s) => s.step === 'SentToEngineer')

    assert.equal(PIPELINE_PREVIEW_LIMIT, 4)
    assert.equal(engineer?.previews.length, 4)
    assert.equal(engineer?.moreCount, 2)
    assert.deepEqual(
      engineer?.previews.map((p) => p.title),
      ['Request 1', 'Request 2', 'Request 3', 'Request 4'],
    )
  })

  it('hides the bottleneck callout when no in-flight work exists', () => {
    const view = buildWorkflowPipelineView([segment('Cancelled', 5)])
    assert.equal(view.inFlightTotal, 0)
    assert.equal(view.bottleneck, null)
  })
})

describe('workflow pipeline chart wiring', () => {
  it('renders a proportional strip with HoverCard request lists and header exit chips', () => {
    const chart = read('src/components/analytics/workflow-pipeline-chart.tsx')
    assert.match(chart, /HoverCard/)
    assert.match(chart, /HoverCardTrigger/)
    assert.match(chart, /HoverCardContent/)
    assert.match(chart, /flexGrow/)
    assert.match(chart, /view\.completed/)
    assert.match(chart, /view\.cancelled/)
    assert.match(chart, /\+\{.*moreCount/)
    assert.match(chart, /bg-blue-500/)
    assert.match(chart, /h-8/)
    assert.doesNotMatch(chart, /bg-zinc-950/)
    assert.doesNotMatch(chart, /h-11/)
    assert.doesNotMatch(chart, /bg-red-500/)
  })

  it('does not put Completed or Cancelled on the in-flight rail', () => {
    const lib = read('src/lib/workflow-pipeline.ts')
    assert.match(lib, /IN_FLIGHT_STEPS/)
    assert.doesNotMatch(
      lib.match(/IN_FLIGHT_STEPS[\s\S]*?\]/)?.[0] ?? '',
      /Completed|Cancelled/,
    )
  })

  it('loads recent request titles with pipeline counts', () => {
    const action = read('src/server-actions/analytics.ts')
    assert.match(action, /fetchPipelineData/)
    assert.match(action, /title:\s*true/)
    assert.match(action, /previews/)
  })
})
