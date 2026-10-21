// Regression: ApproverModal header badge status resolution (display boundary).
// Root cause (2026-10-11-final-pending-header-fix): the router passes the RAW
// persisted status (e.g. "FinalApproval") while ApproverModal's statusConfig
// uses UI keys ("final_approval"); the bare `statusConfig[data.status] ||
// statusConfig.request` lookup silently fell back to the Request badge.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveApproverHeaderStatus } from '@/lib/approval-header-status'

describe('resolveApproverHeaderStatus (display boundary only)', () => {
  it('maps raw persisted FinalApproval to the final_approval header key', () => {
    assert.equal(resolveApproverHeaderStatus('FinalApproval'), 'final_approval')
  })

  it('maps raw persisted FinalRejected to the final_rejected header key', () => {
    assert.equal(resolveApproverHeaderStatus('FinalRejected'), 'final_rejected')
  })

  it('keeps existing UI-key inputs unchanged (no regression on normalized callers)', () => {
    for (const key of ['request', 'solution', 'solution_rejected', 'final_approval', 'final_rejected']) {
      assert.equal(resolveApproverHeaderStatus(key), key)
    }
  })

  it('falls back to request for every other raw status (unchanged fallback behavior)', () => {
    for (const raw of ['ImprovementRequest', 'SentToEngineer', 'DesignCostEstimationApproval', 'SendBackToRequester', 'Completed', 'Cancelled', 'RequestRejected', 'SolutionRejected']) {
      assert.equal(resolveApproverHeaderStatus(raw), 'request')
    }
  })

  it('never returns inherited/prototype values for adversarial or arbitrary unknown keys', () => {
    for (const raw of ['constructor', 'toString', '__proto__', 'hasOwnProperty', '', 'random-unknown']) {
      assert.equal(resolveApproverHeaderStatus(raw), 'request', `raw ${JSON.stringify(raw)} must fall back to request`)
    }
  })
})

describe('ApproverModal wiring uses the display resolver (wiring coverage; rendered behavior is verified in the read-only browser retest)', () => {
  const source = readFileSync('src/components/requests/approver-modal.tsx', 'utf8')

  it('resolves the header status through resolveApproverHeaderStatus(data.status)', () => {
    assert.match(source, /resolveApproverHeaderStatus\(data\.status\)/)
  })

  it('no longer uses the bare fallback lookup that silently selected Request', () => {
    assert.doesNotMatch(source, /statusConfig\[data\.status\]\s*\|\|\s*statusConfig\.request/)
  })
})
