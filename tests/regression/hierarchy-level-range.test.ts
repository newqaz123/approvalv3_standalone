import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getApprovalLevelsAboveSubmitter, getDisplayApprovalLevels } from '@/lib/approval-levels'

const read = (path: string) => readFileSync(path, 'utf8')

describe('hierarchy and approval-chain level range', () => {
  it('supports a level-1 submitter through a level-10 approver', () => {
    assert.deepEqual(getApprovalLevelsAboveSubmitter(1, 10), [2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('treats a level-10 submitter as top-level without creating higher levels', () => {
    assert.deepEqual(getApprovalLevelsAboveSubmitter(10, 10), [])
  })

  it('includes configured empty levels through level 10', () => {
    assert.deepEqual(getDisplayApprovalLevels({ '10': 'Director' }, [1]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('filters invalid persisted levels instead of exposing them as hierarchy buckets', () => {
    const source = read('src/server-actions/hierarchy.ts')
    assert.match(source, /normalizePersistedApprovalLevel/)
    assert.match(source, /getDisplayApprovalLevels/)
  })

  it('validates hierarchy updates and approval-chain level arguments', () => {
    const hierarchy = read('src/server-actions/hierarchy.ts')
    const approvals = read('src/server-actions/approvals.ts')
    const solutions = read('src/server-actions/solutions.ts')
    assert.match(hierarchy, /validateApprovalLevel/)
    assert.match(approvals, /validateApprovalLevel|getApprovalLevelsAboveSubmitter/)
    assert.match(solutions, /validateApprovalLevel|getApprovalLevelsAboveSubmitter/)
  })
})
