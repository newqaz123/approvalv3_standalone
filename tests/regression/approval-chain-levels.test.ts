import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getApprovalLevelsAboveSubmitter,
  MAX_APPROVAL_LEVEL,
  MIN_APPROVAL_LEVEL,
  normalizePersistedApprovalLevel,
  validateApprovalLevel,
} from '@/lib/approval-levels'

const read = (path: string) => readFileSync(path, 'utf8')

describe('approval-chain level generation contracts', () => {
  it('never emits required levels outside 1–10 for hierarchy chains', () => {
    const levels = getApprovalLevelsAboveSubmitter(1, MAX_APPROVAL_LEVEL)
    for (const level of levels) {
      assert.equal(validateApprovalLevel(level), level)
      assert.ok(level >= MIN_APPROVAL_LEVEL && level <= MAX_APPROVAL_LEVEL)
    }
    assert.equal(normalizePersistedApprovalLevel(0), null)
    assert.equal(normalizePersistedApprovalLevel(11), null)
    assert.equal(normalizePersistedApprovalLevel(null), null)
  })

  it('wires approvals and solutions chain builders to the shared level policy', () => {
    const approvals = read('src/server-actions/approvals.ts')
    const solutions = read('src/server-actions/solutions.ts')

    assert.match(approvals, /getApprovalLevelsAboveSubmitter/)
    assert.match(approvals, /normalizePersistedApprovalLevel|validateApprovalLevel/)
    assert.match(approvals, /gte:\s*MIN_APPROVAL_LEVEL|gte:\s*1/)
    assert.match(approvals, /lte:\s*MAX_APPROVAL_LEVEL|lte:\s*10/)

    assert.match(solutions, /getApprovalLevelsAboveSubmitter/)
    assert.match(solutions, /normalizePersistedApprovalLevel|validateApprovalLevel/)
  })

  it('uses shared labels for hierarchy columns', () => {
    const view = read('src/components/admin/hierarchy-view.tsx')
    assert.match(view, /getApprovalLevelLabel/)
  })

  it('targets solution submit/resubmit notifications from first pending approval data, not arithmetic [0]', () => {
    const solutions = read('src/server-actions/solutions.ts')
    const requests = read('src/server-actions/requests.ts')

    // Request path already derives the first notify level from returned pending approvals.
    assert.match(
      requests,
      /pendingApprovals\s*=\s*approvals\.filter\([\s\S]*?status\s*===\s*['"]pending['"][\s\S]*?pendingApprovals\[0\]\.requiredLevel/,
    )

    // Regression: arithmetic getApprovalLevelsAboveSubmitter(...)[0] (or levelsAbove[0]
    // populated only from that helper) must not drive solution first-approver notifications.
    // Sparse hierarchies skip empty levels when creating the chain, so submitter+1 can be empty.
    assert.equal(
      (solutions.match(/getApprovalLevelsAboveSubmitter\([\s\S]*?\)\s*\[\s*0\s*\]/g) || []).length,
      0,
      'solution notifications must not use getApprovalLevelsAboveSubmitter(...)[0]',
    )
    assert.doesNotMatch(
      solutions,
      /const\s+levelsAbove\s*=\s*getApprovalLevelsAboveSubmitter/,
    )

    // Submit path: capture returned hierarchy chain and take first pending requiredLevel.
    assert.match(
      solutions,
      /const\s+hierarchyApprovals\s*=\s*await\s+createHierarchyApprovalChain/,
    )
    assert.match(
      solutions,
      /hierarchyApprovals\.find\([\s\S]{0,80}?status\s*===\s*['"]pending['"][\s\S]{0,80}?requiredLevel/,
    )

    // Resubmit path: first notify level comes from created approvalData pending records.
    assert.match(
      solutions,
      /approvalData\.find\([\s\S]{0,80}?status\s*===\s*['"]pending['"][\s\S]{0,160}?requiredLevel/,
    )
  })
})
