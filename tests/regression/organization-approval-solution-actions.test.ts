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
  enableNewMode,
  enableTestSmtp,
  newModeOrgSeed,
  scenarioUuid,
  workflowUsers,
  type Harness,
  type HarnessSeed,
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

// ---------------------------------------------------------------------------
// NEW-mode solution resubmission (final-review fix wave I1/I3/I5/T10)
// ---------------------------------------------------------------------------

/**
 * Seeded NEW-mode request in SentToEngineer with an assigned engineer, so the
 * REAL submitSolution/resubmitSolution actions run against the typed origin
 * (section-pd1) without re-running the whole request-approval ladder. The
 * request has a null legacy department: NEW typed-origin requests do not need
 * one, and the resubmission gate must not reject them.
 */
function newModeSolutionHarness(requestId: string, solutionId: string): Harness {
  const harness = createHarness({
    ...newModeOrgSeed(),
    departments: departmentRows(),
    requests: [{
      id: requestId,
      status: 'SentToEngineer',
      requesterId: 'new-staff-1',
      title: 'New-mode fixture request',
      description: '<p>Fixture request body</p>',
      departmentId: null,
      organizationUnitId: 'section-pd1',
      isDeleted: false,
      isArchived: false,
    }],
    request_engineer_assignments: [
      { id: 'asg-eng-new', requestId, engineerId: 'new-eng-1', assignedAt: new Date(), assignedById: 'new-eng-2' },
    ],
  })
  enableNewMode(harness.state)
  return harness
}

function resubmissionInput(requestId: string): Record<string, unknown> {
  return {
    requestId,
    title: 'Fixture retrofit (revised)',
    description: '<p>Revised fixture retrofit plan.</p>',
    inlineImageSessionId: scenarioUuid(92),
    cost: 1350,
    currency: 'THB',
    timeline: '3 weeks',
    useCustomHierarchy: false,
  }
}

describe('NEW mode solution resubmission', () => {
  it('lets an authorized second engineer resubmit a rejected solution: routing origin stays the stored submitter, actor is the reviser, and only the first-step candidate is notified', async () => {
    const REQUEST_ID = scenarioUuid(51)
    const harness = newModeSolutionHarness(REQUEST_ID, scenarioUuid(52))
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'new-eng-1'

    // Real submission by engineer one (the stored submitter/author).
    const submitted = (await harness.solutions.submitSolution({
      requestId: REQUEST_ID,
      title: 'Fixture retrofit',
      description: '<p>Retrofit the fixture assembly.</p>',
      inlineImageSessionId: scenarioUuid(93),
      costEstimate: 1200,
      currency: 'THB',
      timeline: '2 weeks',
    })) as { success: boolean; solutionId?: string; error?: string }
    assert.equal(submitted.success, true, submitted.error)
    const solutionId = submitted.solutionId!
    assert.equal(harness.db.solutions.rows.get(solutionId)?.submittedById, 'new-eng-1')
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'DesignCostEstimationApproval')

    // First-step candidate rejects the solution.
    harness.db.rows.notifications.clear()
    harness.state.authUserId = 'new-supervisor-1'
    await harness.solutions.rejectSolution(solutionId, 'Wrong fixture geometry')
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'SentToEngineer')

    // Authorized SECOND engineer (same preserved engineering role rule)
    // resubmits. The request has no legacy department (NEW typed origin).
    harness.db.rows.notifications.clear()
    harness.state.authUserId = 'new-eng-2'
    const resubmitted = (await harness.solutions.resubmitSolution(resubmissionInput(REQUEST_ID))) as { success: boolean; solutionId?: string; error?: string }
    assert.equal(resubmitted.success, true, resubmitted.error)

    // I5: no authorship transfer — the stored submitter is untouched; the
    // routing origin (attempt instance) is the stored submitter's branch.
    assert.equal(harness.db.solutions.rows.get(solutionId)?.submittedById, 'new-eng-1')
    const instances = [...harness.db.rows.approval_instances.values()]
      .filter((row) => row.solutionId === solutionId)
      .sort((a, b) => (a.attempt as number) - (b.attempt as number))
    assert.equal(instances.length, 2)
    assert.equal(instances[1]?.originUserId, 'new-eng-1')
    assert.equal(instances[1]?.supersededAt, null)

    // The reviser is recorded as the ACTOR on the activity log only.
    const resubmitActivities = [...harness.db.rows.request_activities.values()]
      .filter((row) => row.action === 'solution_resubmitted')
    assert.equal(resubmitActivities.length, 1)
    assert.equal(resubmitActivities[0]?.userId, 'new-eng-2')

    // T10 SOLUTION next-step: the persisted first pending step's captured
    // candidate group feeds the real recipient resolver — the emitted payload
    // goes to the first-step candidate with the production wording, and the
    // second-step candidate is not notified yet.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({
        userId: row.userId,
        type: row.type,
        title: row.title,
        message: row.message,
      })),
      [{
        userId: 'new-supervisor-1',
        type: 'approval_needed',
        title: 'Solution Resubmitted',
        message: '📤 Solution resubmitted for "New-mode fixture request". Please review the updated solution.',
      }],
    )

    // T10 intermediate next-step: after approving the first step, the exact
    // emitted next-recipient payload goes to the second step's candidate
    // (parent-mgr) with the production wording — and to nobody else.
    harness.db.rows.notifications.clear()
    harness.state.authUserId = 'new-supervisor-1'
    const firstApproval = (await harness.solutions.approveSolution(solutionId)) as { success: boolean }
    assert.equal(firstApproval.success, true)
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({
        userId: row.userId,
        type: row.type,
        title: row.title,
        message: row.message,
      })),
      [{
        userId: 'parent-mgr',
        type: 'approval_needed',
        title: 'Solution Approval Needed',
        message: 'Solution "Fixture retrofit (revised)" needs your approval.',
      }],
    )
  })

  it('denies a second resubmission while the current attempt is pending, even though the superseded attempt was rejected', async () => {
    const REQUEST_ID = scenarioUuid(53)
    const harness = newModeSolutionHarness(REQUEST_ID, scenarioUuid(54))
    harness.state.authUserId = 'new-eng-1'

    const submitted = (await harness.solutions.submitSolution({
      requestId: REQUEST_ID,
      title: 'Fixture retrofit',
      description: '<p>Retrofit the fixture assembly.</p>',
      inlineImageSessionId: scenarioUuid(94),
      costEstimate: 1200,
      currency: 'THB',
      timeline: '2 weeks',
    })) as { success: boolean; solutionId?: string; error?: string }
    assert.equal(submitted.success, true, submitted.error)
    const solutionId = submitted.solutionId!

    harness.state.authUserId = 'new-supervisor-1'
    await harness.solutions.rejectSolution(solutionId, 'Not robust enough')

    harness.state.authUserId = 'new-eng-1'
    const first = (await harness.solutions.resubmitSolution(resubmissionInput(REQUEST_ID))) as { success: boolean; error?: string }
    assert.equal(first.success, true, first.error)
    // Current attempt is pending again (request back in DesignCostEstimationApproval).
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'DesignCostEstimationApproval')

    // The only rejection belongs to the SUPERSEDED attempt; it is display
    // history and must not authorize another resubmission.
    await assert.rejects(
      harness.solutions.resubmitSolution(resubmissionInput(REQUEST_ID)),
      /Can only resubmit rejected solutions/,
    )
    // No third attempt was created and the chain was not rebuilt.
    const attempts = [...harness.db.rows.approval_instances.values()]
      .filter((row) => row.solutionId === solutionId)
    assert.equal(attempts.length, 2)
  })
})

// ---------------------------------------------------------------------------
// Gate validates the STORED routing origin, not the reviser (re-review P1)
// ---------------------------------------------------------------------------

/** newModeOrgSeed with the second engineer relocated to the PD2 branch: a
 * valid organization branch whose unit path has NO published SOLUTION route
 * (SOLUTION routes exist at section-pd1 and section-eng only). */
function seedWithReviserOnRoutelessBranch(): HarnessSeed {
  const seed = newModeOrgSeed()
  seed.organization_position_assignments = seed.organization_position_assignments!.map((assignment) =>
    assignment.userId === 'new-eng-2'
      ? { ...assignment, unitId: 'section-pd2', positionCode: 'SECTION_MANAGER', reportingGroupId: null }
      : assignment,
  )
  // Reporting-group membership must stay consistent with the new assignment.
  seed.reporting_group_members = seed.reporting_group_members!.filter((member) => member.userId !== 'new-eng-2')
  return seed
}

function sentToEngineerRequestRow(requestId: string): Record<string, unknown> {
  return {
    id: requestId,
    status: 'SentToEngineer',
    requesterId: 'new-staff-1',
    title: 'Stored-origin gate request',
    description: '<p>Body</p>',
    departmentId: null,
    organizationUnitId: 'section-pd1',
    isDeleted: false,
    isArchived: false,
  }
}

describe('NEW resubmission gate uses the stored submitter origin (re-review P1)', () => {
  it('succeeds when the reviser branch has no SOLUTION route but the stored submitter branch does; reviser stays actor, origin unchanged', async () => {
    const REQUEST_ID = scenarioUuid(58)
    const harness = createHarness({
      ...seedWithReviserOnRoutelessBranch(),
      departments: departmentRows(),
      requests: [sentToEngineerRequestRow(REQUEST_ID)],
      request_engineer_assignments: [
        { id: 'asg-assign-eng1', requestId: REQUEST_ID, engineerId: 'new-eng-1', assignedAt: new Date(), assignedById: 'new-eng-2' },
      ],
    })
    enableNewMode(harness.state)
    harness.state.authUserId = 'new-eng-1'

    const submitted = (await harness.solutions.submitSolution({
      requestId: REQUEST_ID,
      title: 'Fixture retrofit',
      description: '<p>Retrofit the fixture assembly.</p>',
      inlineImageSessionId: scenarioUuid(96),
      costEstimate: 1200,
      currency: 'THB',
      timeline: '2 weeks',
    })) as { success: boolean; solutionId?: string; error?: string }
    assert.equal(submitted.success, true, submitted.error)
    const solutionId = submitted.solutionId!

    harness.state.authUserId = 'new-supervisor-1'
    await harness.solutions.rejectSolution(solutionId, 'Needs revision')

    // Authorized reviser new-eng-2 sits on the PD2 branch (no SOLUTION route
    // coverage). The gate must validate the STORED submitter origin instead.
    harness.db.rows.notifications.clear()
    harness.state.authUserId = 'new-eng-2'
    const resubmitted = (await harness.solutions.resubmitSolution(resubmissionInput(REQUEST_ID))) as { success: boolean; error?: string }
    assert.equal(resubmitted.success, true, resubmitted.error)

    assert.equal(harness.db.solutions.rows.get(solutionId)?.submittedById, 'new-eng-1')
    const instances = [...harness.db.rows.approval_instances.values()]
      .filter((row) => row.solutionId === solutionId)
      .sort((a, b) => (a.attempt as number) - (b.attempt as number))
    assert.equal(instances.length, 2)
    assert.equal(instances[1]?.originUserId, 'new-eng-1')
    const activities = [...harness.db.rows.request_activities.values()].filter((row) => row.action === 'solution_resubmitted')
    assert.equal(activities.length, 1)
    assert.equal(activities[0]?.userId, 'new-eng-2')
  })

  it('fails with a configuration error when the STORED submitter branch lacks SOLUTION coverage, even from a covered reviser', async () => {
    const REQUEST_ID = scenarioUuid(59)
    const SOLUTION_ID = scenarioUuid(60)
    const seed = newModeOrgSeed()
    // Move the ORIGINAL engineer (stored submitter) to the routeless PD2
    // branch; the reviser stays on covered section-pd1.
    seed.organization_position_assignments = seed.organization_position_assignments!.map((assignment) =>
      assignment.userId === 'new-eng-1'
        ? { ...assignment, unitId: 'section-pd2', positionCode: 'SECTION_MANAGER', reportingGroupId: null }
        : assignment,
    )
    seed.reporting_group_members = seed.reporting_group_members!.filter((member) => member.userId !== 'new-eng-1')
    const harness = createHarness({
      ...seed,
      departments: departmentRows(),
      requests: [sentToEngineerRequestRow(REQUEST_ID)],
      solutions: [{
        id: SOLUTION_ID,
        requestId: REQUEST_ID,
        title: 'Orphaned-branch solution',
        description: '<p>Body</p>',
        costEstimate: 500,
        currency: 'THB',
        timeline: '1 week',
        submittedById: 'new-eng-1',
      }],
      // Legacy rejection row (instanceId null counts as current) satisfies
      // the rejection prerequisite without a full submission flow.
      solution_approvals: [{
        id: 'sa-orphan-rejected',
        solutionId: SOLUTION_ID,
        requiredLevel: 2,
        order: 1,
        status: 'rejected',
        isCustomChain: false,
      }],
    })
    enableNewMode(harness.state)
    // Covered reviser (section-pd1) attempts the resubmission.
    harness.state.authUserId = 'new-eng-2'

    await assert.rejects(
      harness.solutions.resubmitSolution(resubmissionInput(REQUEST_ID)),
      /No published route for SOLUTION in the origin branch/,
    )
    // Nothing persisted: no new attempt, no activity.
    assert.equal([...harness.db.rows.approval_instances.values()].filter((row) => row.solutionId === SOLUTION_ID).length, 0)
    assert.equal([...harness.db.rows.request_activities.values()].filter((row) => row.action === 'solution_resubmitted').length, 0)
  })
})
