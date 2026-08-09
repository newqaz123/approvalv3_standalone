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
})
