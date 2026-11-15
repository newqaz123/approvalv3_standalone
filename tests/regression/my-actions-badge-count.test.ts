import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { actionableParentIds } from '../../src/lib/approval-engine/actionable'

// Business flow test finding: a Staff request with Section manager (order 2)
// and Department manager (order 3) both pending showed a "1" badge for the
// Department manager while their My Actions list was empty.
describe('My Actions badge counts only actionable approvals', () => {
  const pending = [
    { parentId: 'req-1', order: 2 },
    { parentId: 'req-1', order: 3 },
  ]

  it('does not count a step that is still waiting on an earlier pending step', () => {
    const mine = [{ parentId: 'req-1', order: 3 }]
    assert.equal(actionableParentIds(mine, pending).size, 0)
  })

  it('counts the step that is first in line', () => {
    const mine = [{ parentId: 'req-1', order: 2 }]
    assert.deepEqual([...actionableParentIds(mine, pending)], ['req-1'])
  })

  it('counts a later step once the earlier steps are no longer pending', () => {
    const mine = [{ parentId: 'req-1', order: 3 }]
    assert.deepEqual([...actionableParentIds(mine, [{ parentId: 'req-1', order: 3 }])], ['req-1'])
  })

  it('counts a document once even when the user holds several of its rows', () => {
    const mine = [{ parentId: 'req-1', order: 2 }, { parentId: 'req-1', order: 3 }]
    assert.equal(actionableParentIds(mine, pending).size, 1)
  })

  it('wires the pending-count route through the actionable filter', () => {
    const route = readFileSync('src/app/api/actions/pending-count/route.ts', 'utf8')
    assert.match(route, /actionableParentIds/)
  })
})
