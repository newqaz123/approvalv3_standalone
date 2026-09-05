/**
 * Solution-phase workflow characterization: executes the REAL submitSolution /
 * approveSolution / rejectSolution / resubmitSolution server actions through
 * the transpile+vm harness (see tests/fixtures/organization-approval-harness.ts)
 * and asserts the persisted approval rows, persisted status transitions, and
 * the notifications actually produced by the production notification module
 * (in-app rows in the fake DB plus real SMTP sends against a mocked
 * transporter).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCENARIO,
  baselineRequest,
  baselineSolution,
  createHarness,
  departmentRows,
  enableTestSmtp,
  workflowUsers,
  type Harness,
} from '../fixtures/organization-approval-harness'

const REQUEST_ID = SCENARIO.requestId

/** Standard engineering staffing: levels 2 and 4 staffed, 3 sparse, max 4. */
function solutionHarness(requestStatus: string, extra?: {
  solutions?: Array<Record<string, unknown>>
  solution_approvals?: Array<Record<string, unknown>>
  requestOverrides?: Record<string, unknown>
}): Harness {
  return createHarness({
    departments: departmentRows(),
    users: workflowUsers(),
    requests: [baselineRequest({ status: requestStatus, ...extra?.requestOverrides })],
    solutions: extra?.solutions ?? [],
    solution_approvals: extra?.solution_approvals ?? [],
  })
}

function submitInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: REQUEST_ID,
    title: 'Pump retrofit solution',
    description: '<p>Retrofit the coolant pump assembly.</p>',
    inlineImageSessionId: '00000000-0000-4000-8000-000000000099',
    costEstimate: 1500,
    currency: 'THB',
    timeline: '3 weeks',
    ...overrides,
  }
}

describe('real submitSolution: hierarchy chain (normal)', () => {
  it('creates pending rows for occupied engineering levels above the submitter, moves the request to DesignCostEstimationApproval, and notifies only the first pending level', async () => {
    const harness = solutionHarness('SentToEngineer')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'engineer-1'

    const result = (await harness.solutions.submitSolution(submitInput())) as { success: boolean; solutionId: string }
    assert.equal(result.success, true)

    // Persisted chain rows (not the return value): L2 and L4 pending, level 3 sparse.
    const persisted = harness.db.solutionApprovalsForSolution(result.solutionId)
    assert.deepEqual(
      persisted.map((row) => ({ requiredLevel: row.requiredLevel, order: row.order, status: row.status, isCustomChain: row.isCustomChain })),
      [
        { requiredLevel: 2, order: 1, status: 'pending', isCustomChain: false },
        { requiredLevel: 4, order: 2, status: 'pending', isCustomChain: false },
      ],
    )

    // Persisted guarded transition.
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'DesignCostEstimationApproval')
    const submitWrites = harness.db.writes.filter((w) => w.model === 'requests' && w.op === 'updateMany')
    assert.deepEqual(submitWrites.at(-1)?.data, { status: 'DesignCostEstimationApproval' })

    // Production notifications: exactly the first pending level (L2) is notified.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: SCENARIO.engineeringSupervisorId, type: 'approval_needed' }],
    )
    assert.deepEqual(
      harness.state.smtpMessages.map((mail) => mail.to),
      ['eng-supervisor-1@example.test'],
    )
  })
})

describe('real submitSolution: custom chain', () => {
  it('creates one row per unique non-submitter custom approver and notifies ALL of them at submit', async () => {
    const harness = solutionHarness('SentToEngineer')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'engineer-1'

    const result = (await harness.solutions.submitSolution(submitInput({
      useCustomApprovals: true,
      customApproverIds: [SCENARIO.customApproverA, SCENARIO.customApproverB, SCENARIO.customApproverA, 'engineer-1'],
    }))) as { success: boolean; solutionId: string }
    assert.equal(result.success, true)

    // Persisted rows: submitter and duplicate removed, submitted order kept.
    const persisted = harness.db.solutionApprovalsForSolution(result.solutionId)
    assert.deepEqual(
      persisted.map((row) => ({ requiredApproverId: row.requiredApproverId, order: row.order, status: row.status, isCustomChain: row.isCustomChain })),
      [
        { requiredApproverId: SCENARIO.customApproverA, order: 1, status: 'pending', isCustomChain: true },
        { requiredApproverId: SCENARIO.customApproverB, order: 2, status: 'pending', isCustomChain: true },
      ],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'DesignCostEstimationApproval')

    // All-at-submit: the production loop notifies the RAW submitted id list —
    // including duplicates and the submitter if present — while the persisted
    // chain rows are the sanitized unique non-submitter set. This asymmetry is
    // existing behavior this baseline preserves.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => row.userId),
      [SCENARIO.customApproverA, SCENARIO.customApproverB, SCENARIO.customApproverA, 'engineer-1'],
    )
    assert.deepEqual(
      harness.state.smtpMessages.map((mail) => mail.to),
      ['custom-a@example.test', 'custom-b@example.test', 'custom-a@example.test', 'engineer-1@example.test'],
    )
  })
})

describe('real submitSolution: top-level auto-approval', () => {
  it('auto-approves the chain, sends the request back to the requester, and notifies only the requester', async () => {
    const harness = solutionHarness('SentToEngineer')
    enableTestSmtp(harness.state)
    harness.state.authUserId = SCENARIO.engineeringManagerId // level 4 == engineering max

    const result = (await harness.solutions.submitSolution(submitInput())) as { success: boolean; solutionId: string }
    assert.equal(result.success, true)

    const persisted = harness.db.solutionApprovalsForSolution(result.solutionId)
    assert.deepEqual(
      persisted.map((row) => ({ requiredLevel: row.requiredLevel, order: row.order, status: row.status, approverId: row.approverId })),
      [{ requiredLevel: 4, order: 1, status: 'approved', approverId: SCENARIO.engineeringManagerId }],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'SendBackToRequester')
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.projectEstimateCost, 1500)

    // Only the requester's solution_ready notification; no approver notifications.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: 'staff-1', type: 'solution_ready' }],
    )
    assert.deepEqual(harness.state.smtpMessages.map((mail) => mail.to), ['staff-1@example.test'])
  })
})

describe('real approveSolution: intermediate progress and completion', () => {
  async function submittedNormal(): Promise<Harness> {
    const harness = solutionHarness('SentToEngineer')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'engineer-1'
    await harness.solutions.submitSolution(submitInput())
    return harness
  }

  it('records the intermediate approval, leaves the status, and notifies the next pending level', async () => {
    const harness = await submittedNormal()
    const solutionId = [...harness.db.rows.solutions.keys()][0]!
    harness.state.smtpMessages.length = 0
    harness.db.rows.notifications.clear()

    harness.state.authUserId = SCENARIO.engineeringSupervisorId
    const result = (await harness.solutions.approveSolution(solutionId)) as { success: boolean }
    assert.equal(result.success, true)

    const rows = harness.db.solutionApprovalsForSolution(solutionId).sort((a, b) => (a.order as number) - (b.order as number))
    assert.deepEqual(
      rows.map((row) => ({ status: row.status, approverId: row.approverId })),
      [
        { status: 'approved', approverId: SCENARIO.engineeringSupervisorId },
        { status: 'pending', approverId: undefined },
      ],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'DesignCostEstimationApproval')

    // Next pending level (L4) is notified through the production boundary.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: SCENARIO.engineeringManagerId, type: 'approval_needed' }],
    )
    assert.deepEqual(harness.state.smtpMessages.map((mail) => mail.to), ['eng-manager-1@example.test'])
  })

  it('completes the final step into SendBackToRequester and broadcasts solution_ready to the requester department', async () => {
    const harness = await submittedNormal()
    const solutionId = [...harness.db.rows.solutions.keys()][0]!
    harness.state.authUserId = SCENARIO.engineeringSupervisorId
    await harness.solutions.approveSolution(solutionId)

    harness.state.smtpMessages.length = 0
    harness.db.rows.notifications.clear()
    harness.state.authUserId = SCENARIO.engineeringManagerId
    const result = (await harness.solutions.approveSolution(solutionId)) as { success: boolean }
    assert.equal(result.success, true)

    // Production uses an unguarded update for the solution-approval completion.
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'SendBackToRequester')
    const completionUpdate = harness.db.writes.filter((w) => w.model === 'requests' && w.op === 'update').at(-1)
    assert.deepEqual(completionUpdate?.data, { status: 'SendBackToRequester', projectEstimateCost: 1500 })

    // Department broadcast: every ACTIVE requester-department user, no exclusions.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [
        { userId: 'staff-1', type: 'solution_ready' },
        { userId: 'supervisor-1', type: 'solution_ready' },
        { userId: 'department-manager-1', type: 'solution_ready' },
      ],
    )
    // One department SMTP send with all recipients (notifyUsersInDepartment).
    assert.equal(harness.state.smtpMessages.length, 1)
    assert.deepEqual(Array.from(harness.state.smtpMessages[0]!.to as string[]), [
      'staff-1@example.test',
      'supervisor-1@example.test',
      'department-manager-1@example.test',
    ])
  })
})

describe('real rejectSolution', () => {
  it('rejects the chain, returns the request to SentToEngineer, and notifies the submitter', async () => {
    const harness = solutionHarness('DesignCostEstimationApproval', {
      solutions: [baselineSolution()],
      solution_approvals: [
        { id: 'sa-1', solutionId: SCENARIO.solutionId, requiredLevel: 2, order: 1, status: 'pending', isCustomChain: false },
        { id: 'sa-2', solutionId: SCENARIO.solutionId, requiredLevel: 4, order: 2, status: 'pending', isCustomChain: false },
      ],
    })
    enableTestSmtp(harness.state)
    harness.state.authUserId = SCENARIO.engineeringSupervisorId

    const result = (await harness.solutions.rejectSolution(SCENARIO.solutionId, 'Cost estimate too high')) as { success: boolean }
    assert.equal(result.success, true)

    const rows = harness.db.solutionApprovalsForSolution(SCENARIO.solutionId)
    assert.ok(rows.every((row) => row.status === 'rejected'))
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'SentToEngineer')
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: 'engineer-1', type: 'approval_rejected' }],
    )
    assert.deepEqual(harness.state.smtpMessages.map((mail) => mail.to), ['engineer-1@example.test'])
  })
})

describe('real resubmitSolution: custom, normal, and auto', () => {
  async function rejectedSolutionHarness(): Promise<Harness> {
    const harness = solutionHarness('SentToEngineer', {
      solutions: [baselineSolution()],
      solution_approvals: [
        { id: 'sa-1', solutionId: SCENARIO.solutionId, requiredLevel: 2, order: 1, status: 'rejected', approverId: SCENARIO.engineeringSupervisorId, isCustomChain: false },
      ],
    })
    enableTestSmtp(harness.state)
    return harness
  }

  function resubmitInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      requestId: REQUEST_ID,
      title: 'Pump retrofit solution (rev 2)',
      description: '<p>Reworked retrofit plan.</p>',
      inlineImageSessionId: '00000000-0000-4000-8000-000000000098',
      cost: 1750,
      currency: 'THB',
      timeline: '4 weeks',
      useCustomHierarchy: false,
      ...overrides,
    }
  }

  it('rebuilds a custom chain, resets the request to DesignCostEstimationApproval, and notifies every custom approver', async () => {
    const harness = await rejectedSolutionHarness()
    harness.state.authUserId = 'engineer-1'

    const result = (await harness.solutions.resubmitSolution(resubmitInput({
      useCustomHierarchy: true,
      customApprovers: [SCENARIO.customApproverA, SCENARIO.customApproverB],
    }))) as { success: boolean; solutionId: string }
    assert.equal(result.success, true)
    assert.equal(result.solutionId, SCENARIO.solutionId)

    // Old chain deleted, new custom chain persisted.
    const persisted = harness.db.solutionApprovalsForSolution(SCENARIO.solutionId)
    assert.deepEqual(
      persisted.map((row) => ({ requiredApproverId: row.requiredApproverId, order: row.order, status: row.status, isCustomChain: row.isCustomChain })),
      [
        { requiredApproverId: SCENARIO.customApproverA, order: 1, status: 'pending', isCustomChain: true },
        { requiredApproverId: SCENARIO.customApproverB, order: 2, status: 'pending', isCustomChain: true },
      ],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'DesignCostEstimationApproval')
    const updatedSolution = harness.db.rows.solutions.get(SCENARIO.solutionId)
    assert.equal(updatedSolution?.title, 'Pump retrofit solution (rev 2)')
    assert.equal(updatedSolution?.costEstimate, 1750)

    // Both custom approvers are notified with the production event and email.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type, title: row.title })),
      [
        { userId: SCENARIO.customApproverA, type: 'approval_needed', title: 'Solution Resubmitted' },
        { userId: SCENARIO.customApproverB, type: 'approval_needed', title: 'Solution Resubmitted' },
      ],
    )
    assert.deepEqual(
      harness.state.smtpMessages.map((mail) => mail.to),
      ['custom-a@example.test', 'custom-b@example.test'],
    )
  })

  it('rebuilds the hierarchy chain, notifies only the first pending level, and moves the request to DesignCostEstimationApproval', async () => {
    const harness = await rejectedSolutionHarness()
    harness.state.authUserId = 'engineer-1'
    harness.state.smtpMessages.length = 0

    const result = (await harness.solutions.resubmitSolution(resubmitInput())) as { success: boolean }
    assert.equal(result.success, true)

    const persisted = harness.db.solutionApprovalsForSolution(SCENARIO.solutionId).sort((a, b) => (a.order as number) - (b.order as number))
    assert.deepEqual(
      persisted.map((row) => ({ requiredLevel: row.requiredLevel, order: row.order, status: row.status, isCustomChain: row.isCustomChain })),
      [
        { requiredLevel: 2, order: 1, status: 'pending', isCustomChain: false },
        { requiredLevel: 4, order: 2, status: 'pending', isCustomChain: false },
      ],
    )
    // Only the first pending level is notified, with the production event.
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'DesignCostEstimationApproval')
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type, title: row.title })),
      [{ userId: SCENARIO.engineeringSupervisorId, type: 'approval_needed', title: 'Solution Resubmitted' }],
    )
    assert.deepEqual(harness.state.smtpMessages.map((mail) => mail.to), ['eng-supervisor-1@example.test'])
  })

  it('auto-approves for a top-level submitter and broadcasts solution_ready to the requester department', async () => {
    const harness = await rejectedSolutionHarness()
    harness.state.authUserId = SCENARIO.engineeringManagerId
    harness.state.smtpMessages.length = 0

    const result = (await harness.solutions.resubmitSolution(resubmitInput())) as { success: boolean }
    assert.equal(result.success, true)

    const persisted = harness.db.solutionApprovalsForSolution(SCENARIO.solutionId)
    assert.deepEqual(
      persisted.map((row) => ({ status: row.status, approverId: row.approverId, requiredLevel: row.requiredLevel })),
      [{ status: 'approved', approverId: SCENARIO.engineeringManagerId, requiredLevel: 4 }],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'SendBackToRequester')

    // Auto path: requester-department broadcast, no per-approver notifications.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [
        { userId: 'staff-1', type: 'solution_ready' },
        { userId: 'supervisor-1', type: 'solution_ready' },
        { userId: 'department-manager-1', type: 'solution_ready' },
      ],
    )
    // One department SMTP send with all recipients (notifyUsersInDepartment).
    assert.equal(harness.state.smtpMessages.length, 1)
    assert.deepEqual(Array.from(harness.state.smtpMessages[0]!.to as string[]), [
      'staff-1@example.test',
      'supervisor-1@example.test',
      'department-manager-1@example.test',
    ])
  })

  it('refuses to resubmit a solution that has no rejection', async () => {
    const harness = solutionHarness('SentToEngineer', {
      solutions: [baselineSolution()],
      solution_approvals: [
        { id: 'sa-1', solutionId: SCENARIO.solutionId, requiredLevel: 2, order: 1, status: 'pending', isCustomChain: false },
      ],
    })
    harness.state.authUserId = 'engineer-1'
    await assert.rejects(
      harness.solutions.resubmitSolution(resubmitInput()),
      /Can only resubmit rejected solutions/,
    )
  })
})
