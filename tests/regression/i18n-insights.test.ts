import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createTranslator } from '../../src/lib/i18n/messages'
import { buildWorkflowPipelineView } from '../../src/lib/workflow-pipeline'

const en = createTranslator('en')
const th = createTranslator('th')

test('EngineeringResolutionTrendChart translates its metrics without changing series IDs', () => {
  const chart = readFileSync('src/components/analytics/engineering-resolution-trend-chart.tsx', 'utf8')
  for (const [id, english, thai] of [
    ['engineeringUnresolved', 'Engineering unresolved', 'งาน Engineering ที่ยังค้าง'],
    ['resolvedByEngineering', 'Resolved by Engineering', 'งานที่ Engineering จัดการแล้ว'],
  ] as const) {
    const key = `analytics.metric.${id}` as const
    assert.equal(en(key), english)
    assert.equal(th(key), thai)
    assert.ok(chart.includes(`dataKey="${id}"`))
  }
  assert.match(chart, /return t\(`analytics\.metric\.\$\{dataKey\}`\)/)
  assert.match(chart, /<Legend\s+formatter=\{\(value, entry\) => seriesLabel\(entry\.dataKey, value\)\}/)
  assert.match(chart, /<Tooltip\s+formatter=\{\(value, name, entry\) => \[value, seriesLabel\(entry\.dataKey, name\)\]\}/)
})

test('WorkflowPipelineChart uses raw stage labels but translates the surrounding request count', () => {
  const final = buildWorkflowPipelineView([]).inFlight.find(stage => stage.step === 'FinalApproval')!
  assert.equal(final.fullLabel, 'Final Approval')
  assert.equal(en('analytics.pipelineOpenCount', { status: final.fullLabel, count: 2 }), 'Final Approval, 2 open requests')
  assert.equal(th('analytics.pipelineOpenCount', { status: final.fullLabel, count: 2 }), 'Final Approval มี 2 Request ที่เปิดอยู่')
  const chart = readFileSync('src/components/analytics/workflow-pipeline-chart.tsx', 'utf8')
  assert.match(chart, /t\('analytics\.pipelineOpenCount', \{ status: stage\.fullLabel, count: stage\.count \}\)/)
  assert.match(chart, /\{stage\.shortLabel\}/)
})
