import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Business flow test finding: Engineering Supervisor submitted a solution, the
// Section manager rejected it and then resubmitted it himself. The solution
// still showed the supervisor as submitter, and the new route was built from
// the supervisor's position, so the Section manager had to approve his own
// resubmission. Owner decision: whoever resubmits becomes the submitter, and
// the route starts from them.
describe('the person who resubmits a solution becomes its submitter', () => {
  const source = readFileSync('src/server-actions/solutions.ts', 'utf8')
  const start = source.indexOf('export async function resubmitSolution(')
  const end = source.indexOf('\nexport async function', start + 1)
  const fn = source.slice(start, end === -1 ? undefined : end)

  it('stores the resubmitter and the resubmission time on the solution', () => {
    const update = fn.match(/tx\.solutions\.update\(\{[\s\S]*?\n    \}\)/)
    assert.ok(update, 'resubmitSolution must update the solution')
    assert.match(update[0], /submittedById: userId,/)
    assert.match(update[0], /submittedAt: new Date\(\),/)
  })

  it('builds the new approval attempt from the resubmitter, not the earlier submitter', () => {
    assert.doesNotMatch(fn, /solution\.submittedById/)
    assert.match(fn, /phase: 'SOLUTION',\s*originUserId: userId,/)
    assert.match(fn, /phase: 'SOLUTION',\s*actorId: userId,/)
    assert.match(fn, /solutionSubmitterIds: \[userId\]/)
  })

  it('writes the new submitter before the attempt is created, so the engine origin check agrees', () => {
    assert.ok(
      fn.indexOf('submittedById: userId,') < fn.indexOf('createSolutionApprovalAttempt('),
      'the solution row must carry the resubmitter before the route is built',
    )
  })
})
