import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAwaitingReworkAfterRejection } from '../../src/lib/request-rejection-state'

// Business flow test finding: "test 2" was rejected at the request stage,
// resubmitted, fully approved and moved to Sent to Engineer — and the list
// still drew it in red because of the old, superseded rejection.
const superseded = { instanceId: 'old', instance: { supersededAt: new Date('2026-11-15T12:45:00Z') } }
const current = { instanceId: 'new', instance: { supersededAt: null } }
const row = (status: string, attempt: object, isFinalApproval = false) => ({ status, isFinalApproval, ...attempt })

describe('a request is shown as rejected only while that rejection is waiting for rework', () => {
  it('is not rejected in Sent to Engineer when the only rejection is a superseded request attempt', () => {
    assert.equal(isAwaitingReworkAfterRejection({
      status: 'SentToEngineer',
      requestApprovals: [row('rejected', superseded), row('approved', current), row('approved', current)],
      solutionApprovals: [],
    }), false)
  })

  it('is not rejected in Sent to Engineer because of a current request-stage row', () => {
    assert.equal(isAwaitingReworkAfterRejection({
      status: 'SentToEngineer',
      requestApprovals: [row('rejected', current)],
      solutionApprovals: [],
    }), false)
  })

  it('is rejected in Improvement Request while the current request attempt is rejected', () => {
    assert.equal(isAwaitingReworkAfterRejection({
      status: 'ImprovementRequest',
      requestApprovals: [row('approved', current), row('rejected', current)],
      solutionApprovals: [],
    }), true)
  })

  it('stops being rejected in Improvement Request once the request is resubmitted', () => {
    assert.equal(isAwaitingReworkAfterRejection({
      status: 'ImprovementRequest',
      requestApprovals: [row('rejected', superseded), row('pending', current)],
      solutionApprovals: [],
    }), false)
  })

  it('is rejected in Sent to Engineer while the current solution attempt is rejected', () => {
    assert.equal(isAwaitingReworkAfterRejection({
      status: 'SentToEngineer',
      requestApprovals: [row('approved', current)],
      solutionApprovals: [row('rejected', current)],
    }), true)
  })

  it('is rejected in Sent to Engineer while the current final approval is rejected', () => {
    assert.equal(isAwaitingReworkAfterRejection({
      status: 'SentToEngineer',
      requestApprovals: [row('approved', current), row('rejected', current, true)],
      solutionApprovals: [row('approved', current)],
    }), true)
  })

  it('ignores superseded solution and final rejections', () => {
    assert.equal(isAwaitingReworkAfterRejection({
      status: 'SentToEngineer',
      requestApprovals: [row('rejected', superseded, true)],
      solutionApprovals: [row('rejected', superseded)],
    }), false)
  })

  it('is never rejected in other statuses', () => {
    for (const status of ['DesignCostEstimationApproval', 'SendBackToRequester', 'Completed', 'Cancelled']) {
      assert.equal(isAwaitingReworkAfterRejection({
        status,
        requestApprovals: [row('rejected', current), row('rejected', current, true)],
        solutionApprovals: [row('rejected', current)],
      }), false, status)
    }
  })

  it('treats legacy rows without an attempt as current', () => {
    assert.equal(isAwaitingReworkAfterRejection({
      status: 'ImprovementRequest',
      requestApprovals: [{ status: 'rejected', isFinalApproval: false, instanceId: null, instance: null }],
      solutionApprovals: [],
    }), true)
  })

  it('the request list and the dashboard lists use this rule', () => {
    const requests = readFileSync('src/server-actions/requests.ts', 'utf8')
    const start = requests.indexOf('export async function getMyRequests')
    const getMyRequests = requests.slice(start, requests.indexOf('\nexport async function', start + 1))
    assert.match(getMyRequests, /hasRejection: isAwaitingReworkAfterRejection\(/)

    const dashboard = readFileSync('src/server-actions/dashboard.ts', 'utf8')
    assert.match(dashboard, /getMyRequests\(\{ wrStatus: "all" \}\)/)
    assert.match(dashboard, /hasRejection: request\.hasRejection/)
  })

  // The Engineering page had its own rules ("a solution was ever rejected",
  // "the request has a solution"); it must follow the request table.
  it('the Engineering page follow-up tab uses this rule', () => {
    const page = readFileSync('src/app/(dashboard)/engineering/page.tsx', 'utf8')
    assert.match(page, /hasRejection: isAwaitingReworkAfterRejection\(/)
    assert.doesNotMatch(page, /solution_rejected/)
    assert.doesNotMatch(page, /where: \{ status: "rejected" \}/)
    // Rows of both chains carry their attempt so superseded ones are ignored.
    assert.equal((page.match(/instance: \{ select: \{ supersededAt: true \} \}/g) ?? []).length, 2)
  })

  it('the Engineering page needs-action tab uses this rule', () => {
    const requests = readFileSync('src/server-actions/requests.ts', 'utf8')
    const start = requests.indexOf('export async function getRequestsNeedingEngineeringAction')
    const fn = requests.slice(start, requests.indexOf('\nexport async function', start + 1))
    assert.match(fn, /hasRejection: isAwaitingReworkAfterRejection\(/)
    assert.doesNotMatch(fn, /requestIdsWithSolution/)
    assert.equal((fn.match(/instance: \{ select: \{ supersededAt: true \} \}/g) ?? []).length, 2)
  })
})
