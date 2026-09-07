/**
 * Final-approval phase and completion characterization: executes the REAL
 * initiateFinalApproval / approveFinalApproval / rejectFinalApproval /
 * markRequestComplete server actions through the transpile+vm harness and
 * asserts persisted rows/transitions plus the notifications produced by the
 * production notification module (in-app rows and real SMTP sends), including
 * the in-app-only channels (transactional notifications.create writes).
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
} from '../fixtures/organization-approval-harness'

const REQUEST_ID = SCENARIO.requestId

function finalHarness(requestStatus: string, extra?: {
  requestOverrides?: Record<string, unknown>
  request_approvals?: Array<Record<string, unknown>>
}): Harness {
  return createHarness({
    departments: departmentRows(),
    users: workflowUsers(),
    requests: [baselineRequest({ status: requestStatus, ...extra?.requestOverrides })],
    request_approvals: extra?.request_approvals ?? [],
    solutions: [baselineSolution()],
  })
}

describe('real initiateFinalApproval', () => {
  it('custom chain: persists first-step-only rows and notifies only the first custom approver', async () => {
    const harness = finalHarness('SendBackToRequester')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'staff-1'

    const result = (await harness.solutions.initiateFinalApproval(REQUEST_ID, true, [SCENARIO.customApproverA, SCENARIO.customApproverB])) as { success: boolean }
    assert.equal(result.success, true)

    const persisted = harness.db.requestApprovalsForRequest(REQUEST_ID)
    assert.deepEqual(
      persisted.map((row) => ({ requiredApproverId: row.requiredApproverId, order: row.order, status: row.status, isCustomChain: row.isCustomChain, isFinalApproval: row.isFinalApproval })),
      [
        { requiredApproverId: SCENARIO.customApproverA, order: 1, status: 'pending', isCustomChain: true, isFinalApproval: true },
        { requiredApproverId: SCENARIO.customApproverB, order: 2, status: 'pending', isCustomChain: true, isFinalApproval: true },
      ],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'FinalApproval')

    // First step only: the second custom approver must NOT be notified yet.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: SCENARIO.customApproverA, type: 'final_approval_needed' }],
    )
    assert.deepEqual(harness.state.smtpMessages.map((mail) => mail.to), ['custom-a@example.test'])
  })

  it('hierarchy chain: persists occupied levels above the initiator and notifies only the first level', async () => {
    const harness = finalHarness('SendBackToRequester')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'staff-1'

    const result = (await harness.solutions.initiateFinalApproval(REQUEST_ID, false)) as { success: boolean }
    assert.equal(result.success, true)

    const persisted = harness.db.requestApprovalsForRequest(REQUEST_ID)
    assert.deepEqual(
      persisted.map((row) => ({ requiredLevel: row.requiredLevel, order: row.order, status: row.status, isFinalApproval: row.isFinalApproval })),
      [
        { requiredLevel: 2, order: 1, status: 'pending', isFinalApproval: true },
        { requiredLevel: 4, order: 2, status: 'pending', isFinalApproval: true },
      ],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'FinalApproval')
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: 'supervisor-1', type: 'final_approval_needed' }],
    )
    assert.deepEqual(harness.state.smtpMessages.map((mail) => mail.to), ['supervisor-1@example.test'])
  })

  it('top-level initiator: auto-approves straight to Completed with an in-app-only requester notice', async () => {
    const harness = finalHarness('SendBackToRequester')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'department-manager-1' // level 4 == PD max

    const result = (await harness.solutions.initiateFinalApproval(REQUEST_ID, false)) as { success: boolean }
    assert.equal(result.success, true)

    const persisted = harness.db.requestApprovalsForRequest(REQUEST_ID)
    assert.deepEqual(
      persisted.map((row) => ({ status: row.status, approverId: row.approverId, isFinalApproval: row.isFinalApproval })),
      [{ status: 'approved', approverId: 'department-manager-1', isFinalApproval: true }],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'Completed')

    // Transactional notifications.create: in-app row, NO email.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type, title: row.title })),
      [{ userId: 'staff-1', type: 'status_changed', title: 'Request Completed' }],
    )
    assert.deepEqual(harness.state.smtpMessages, [])
  })

  it('refuses to initiate outside SendBackToRequester or from another department', async () => {
    const wrongStatus = finalHarness('DesignCostEstimationApproval')
    wrongStatus.state.authUserId = 'staff-1'
    await assert.rejects(
      wrongStatus.solutions.initiateFinalApproval(REQUEST_ID, false),
      /SendBackToRequester status to initiate final approval/,
    )

    const wrongDepartment = finalHarness('SendBackToRequester')
    wrongDepartment.state.authUserId = 'engineer-1'
    await assert.rejects(
      wrongDepartment.solutions.initiateFinalApproval(REQUEST_ID, false),
      /Only department members can initiate final approval/,
    )
  })
})

describe('real approveFinalApproval', () => {
  async function initiatedHierarchy(): Promise<Harness> {
    const harness = finalHarness('SendBackToRequester')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'staff-1'
    await harness.solutions.initiateFinalApproval(REQUEST_ID, false)
    return harness
  }

  it('records the intermediate approval and notifies only the next final step', async () => {
    const harness = await initiatedHierarchy()
    harness.state.smtpMessages.length = 0
    harness.db.rows.notifications.clear()
    harness.state.authUserId = 'supervisor-1'

    const result = (await harness.solutions.approveFinalApproval(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)

    const rows = harness.db.requestApprovalsForRequest(REQUEST_ID).sort((a, b) => (a.order as number) - (b.order as number))
    assert.deepEqual(
      rows.map((row) => ({ status: row.status, approverId: row.approverId })),
      [
        { status: 'approved', approverId: 'supervisor-1' },
        { status: 'pending', approverId: undefined },
      ],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'FinalApproval')
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: 'department-manager-1', type: 'final_approval_needed' }],
    )
    assert.deepEqual(harness.state.smtpMessages.map((mail) => mail.to), ['department-manager-1@example.test'])
  })

  it('completes the final chain into Completed and broadcasts approval_granted to the requester department excluding engineering users', async () => {
    const harness = await initiatedHierarchy()
    harness.state.authUserId = 'supervisor-1'
    await harness.solutions.approveFinalApproval(REQUEST_ID)

    harness.state.smtpMessages.length = 0
    harness.db.rows.notifications.clear()
    harness.state.authUserId = 'department-manager-1'
    const result = (await harness.solutions.approveFinalApproval(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)

    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'Completed')
    const activities = [...harness.db.rows.request_activities.values()].filter((row) => row.action === 'status_changed')
    assert.deepEqual(
      activities.map((row) => ({ from: row.fromStatus, to: row.toStatus })),
      [{ from: 'FinalApproval', to: 'Completed' }],
    )

    // Active requester-department users only. NOTE: in this scenario every
    // engineering user belongs to a different department, so the
    // department filter alone excludes them. The discriminating
    // engineering-exclusion scenario lives in the dedicated test below.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [
        { userId: 'staff-1', type: 'approval_granted' },
        { userId: 'supervisor-1', type: 'approval_granted' },
        { userId: 'department-manager-1', type: 'approval_granted' },
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

describe('real rejectFinalApproval', () => {
  it('rejects the chain, returns the request to SentToEngineer, and broadcasts both rework notifications', async () => {
    const harness = finalHarness('SendBackToRequester')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'staff-1'
    await harness.solutions.initiateFinalApproval(REQUEST_ID, false)

    harness.state.smtpMessages.length = 0
    harness.db.rows.notifications.clear()
    harness.state.authUserId = 'supervisor-1'
    const result = (await harness.solutions.rejectFinalApproval(REQUEST_ID, 'Design not ready for final sign-off')) as { success: boolean }
    assert.equal(result.success, true)

    const rows = harness.db.requestApprovalsForRequest(REQUEST_ID)
    assert.ok(rows.every((row) => row.status === 'rejected'))
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'SentToEngineer')
    const statusActivities = [...harness.db.rows.request_activities.values()].filter((row) => row.action === 'status_changed')
    assert.deepEqual(
      statusActivities.map((row) => ({ from: row.fromStatus, to: row.toStatus })),
      [{ from: 'FinalApproval', to: 'SentToEngineer' }],
    )

    // Engineering department (excluding the rejector) + requester department
    // (excluding the rejector — supervisor-1 belongs to it, so no self-notify).
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [
        { userId: 'engineer-1', type: 'approval_rejected' },
        { userId: SCENARIO.engineeringSupervisorId, type: 'approval_rejected' },
        { userId: SCENARIO.engineeringManagerId, type: 'approval_rejected' },
        { userId: 'staff-1', type: 'status_changed' },
        { userId: 'department-manager-1', type: 'status_changed' },
      ],
    )

    // Email channel: one department SMTP send per broadcast; the rejector is
    // excluded from both recipient lists.
    assert.equal(harness.state.smtpMessages.length, 2)
    assert.deepEqual(
      Array.from(harness.state.smtpMessages[0]!.to as string[]).sort(),
      ['eng-manager-1@example.test', 'eng-supervisor-1@example.test', 'engineer-1@example.test'],
    )
    assert.deepEqual(
      Array.from(harness.state.smtpMessages[1]!.to as string[]).sort(),
      ['department-manager-1@example.test', 'staff-1@example.test'],
    )
    // Production rewrites email subjects per event type: approval_rejected
    // becomes "Rejected: <request title>"; status_changed keeps its title.
    assert.deepEqual(
      harness.state.smtpMessages.map((mail) => mail.subject),
      ['Rejected: Baseline pump upgrade', 'Final Approval Rejected'],
    )
  })
})

describe('real markRequestComplete', () => {
  it('completes via the guarded transition and sends the requester an in-app-only notice', async () => {
    const harness = finalHarness('SendBackToRequester')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'engineer-1'

    const result = (await harness.solutions.markRequestComplete(REQUEST_ID, 'Installed and verified on site')) as { success: boolean }
    assert.equal(result.success, true)

    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'Completed')
    const completionWrite = harness.db.writes.filter((w) => w.model === 'requests' && w.op === 'updateMany').at(-1)
    assert.deepEqual(completionWrite?.data, { status: 'Completed' })

    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type, title: row.title })),
      [{ userId: 'staff-1', type: 'status_changed', title: 'Request Completed' }],
    )
    assert.deepEqual(harness.state.smtpMessages, [])
  })

  it('refuses non-engineering users and wrong statuses', async () => {
    const wrongRole = finalHarness('SendBackToRequester')
    wrongRole.state.authUserId = 'supervisor-1'
    await assert.rejects(wrongRole.solutions.markRequestComplete(REQUEST_ID), /Only engineering users can mark requests complete/)

    const wrongStatus = finalHarness('SentToEngineer')
    wrongStatus.state.authUserId = 'engineer-1'
    await assert.rejects(wrongStatus.solutions.markRequestComplete(REQUEST_ID), /SendBackToRequester status/)
  })
})


describe('real approveFinalApproval and rejectFinalApproval after CUSTOM initiation', () => {
  async function customInitiated(): Promise<Harness> {
    const harness = finalHarness('SendBackToRequester')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'staff-1'
    await harness.solutions.initiateFinalApproval(REQUEST_ID, true, [SCENARIO.customApproverA, SCENARIO.customApproverB])
    return harness
  }

  it('progression: approving custom step 1 notifies only custom step 2 and keeps FinalApproval', async () => {
    const harness = await customInitiated()
    harness.state.smtpMessages.length = 0
    harness.db.rows.notifications.clear()
    harness.state.authUserId = SCENARIO.customApproverA

    const result = (await harness.solutions.approveFinalApproval(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)

    const rows = harness.db.requestApprovalsForRequest(REQUEST_ID).sort((a, b) => (a.order as number) - (b.order as number))
    assert.deepEqual(
      rows.map((row) => ({ status: row.status, approverId: row.approverId, requiredApproverId: row.requiredApproverId })),
      [
        { status: 'approved', approverId: SCENARIO.customApproverA, requiredApproverId: SCENARIO.customApproverA },
        { status: 'pending', approverId: undefined, requiredApproverId: SCENARIO.customApproverB },
      ],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'FinalApproval')
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type, title: row.title })),
      [{ userId: SCENARIO.customApproverB, type: 'final_approval_needed', title: 'Final Approval Needed' }],
    )
    assert.deepEqual(harness.state.smtpMessages.map((mail) => mail.to), ['custom-b@example.test'])
  })

  it('completion: approving custom step 2 completes the request and broadcasts to the requester department', async () => {
    const harness = await customInitiated()
    harness.state.authUserId = SCENARIO.customApproverA
    await harness.solutions.approveFinalApproval(REQUEST_ID)

    harness.state.smtpMessages.length = 0
    harness.db.rows.notifications.clear()
    harness.state.authUserId = SCENARIO.customApproverB
    const result = (await harness.solutions.approveFinalApproval(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)

    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'Completed')
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [
        { userId: 'staff-1', type: 'approval_granted' },
        { userId: 'supervisor-1', type: 'approval_granted' },
        { userId: 'department-manager-1', type: 'approval_granted' },
      ],
    )
    assert.equal(harness.state.smtpMessages.length, 1)
    assert.deepEqual(Array.from(harness.state.smtpMessages[0]!.to as string[]).sort(), [
      'department-manager-1@example.test',
      'staff-1@example.test',
      'supervisor-1@example.test',
    ])
  })

  it('rejection: a custom approver rejects; request returns to SentToEngineer with both department broadcasts', async () => {
    const harness = await customInitiated()
    harness.state.smtpMessages.length = 0
    harness.db.rows.notifications.clear()
    harness.state.authUserId = SCENARIO.customApproverA

    const result = (await harness.solutions.rejectFinalApproval(REQUEST_ID, 'Custom chain rejects the design')) as { success: boolean }
    assert.equal(result.success, true)

    const rows = harness.db.requestApprovalsForRequest(REQUEST_ID)
    assert.ok(rows.every((row) => row.status === 'rejected'))
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'SentToEngineer')

    // Engineering department broadcast (rejector is not engineering) and
    // requester-department broadcast, both with email.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [
        { userId: 'engineer-1', type: 'approval_rejected' },
        { userId: SCENARIO.engineeringSupervisorId, type: 'approval_rejected' },
        { userId: SCENARIO.engineeringManagerId, type: 'approval_rejected' },
        { userId: 'staff-1', type: 'status_changed' },
        { userId: 'supervisor-1', type: 'status_changed' },
        { userId: 'department-manager-1', type: 'status_changed' },
      ],
    )
    assert.equal(harness.state.smtpMessages.length, 2)
    assert.deepEqual(
      Array.from(harness.state.smtpMessages[0]!.to as string[]).sort(),
      ['eng-manager-1@example.test', 'eng-supervisor-1@example.test', 'engineer-1@example.test'],
    )
    assert.deepEqual(
      Array.from(harness.state.smtpMessages[1]!.to as string[]).sort(),
      ['department-manager-1@example.test', 'staff-1@example.test', 'supervisor-1@example.test'],
    )
  })
})

describe('real approveFinalApproval completion: discriminating engineering exclusion', () => {
  it('when the requester department IS engineering, the department-derived exclusion removes its own members from the completion broadcast', async () => {
    // Overlap context: the requester's department IS the engineering
    // department, so without the production exclusion argument every active
    // engineering user would receive the completion broadcast. The broadcast
    // audience equals the exclusion list, which proves the exclusion has an
    // effect (removing it would add these recipients).
    const harness = createHarness({
      departments: departmentRows(),
      users: [
        { id: 'eng-requester-1', departmentId: 'department-engineering', level: 1, isActive: true, role: 'engineering', name: 'Engineering Requester', email: 'eng-requester-1@example.test' },
        { id: 'eng-approver-1', departmentId: 'department-engineering', level: 2, isActive: true, role: 'engineering', name: 'Engineering Approver', email: 'eng-approver-1@example.test' },
        { id: 'eng-approver-2', departmentId: 'department-engineering', level: 4, isActive: true, role: 'engineering', name: 'Engineering Manager', email: 'eng-approver-2@example.test' },
      ],
      requests: [baselineRequest({ status: 'SendBackToRequester', requesterId: 'eng-requester-1', departmentId: 'department-engineering' })],
      solutions: [baselineSolution()],
    })
    enableTestSmtp(harness.state)

    // Initiate the hierarchy final chain inside the engineering department
    // (initiator level 1 -> chain levels 2 and 4), then approve both steps.
    harness.state.authUserId = 'eng-requester-1'
    await harness.solutions.initiateFinalApproval(REQUEST_ID, false)
    harness.state.authUserId = 'eng-approver-1'
    await harness.solutions.approveFinalApproval(REQUEST_ID)

    harness.state.smtpMessages.length = 0
    harness.db.rows.notifications.clear()
    harness.state.authUserId = 'eng-approver-2'
    const result = (await harness.solutions.approveFinalApproval(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'Completed')

    // The exclusion list is derived from engineering-department membership
    // (solutions.ts approveFinalApproval) and the broadcast audience is the
    // same department: every candidate recipient is excluded, so nothing is
    // written or mailed. Removing the exclusion argument would notify the
    // active engineering users below and fail this assertion.
    const audience = [...harness.db.rows.user.values()].filter(
      (u) => u.departmentId === 'department-engineering' && u.isActive,
    )
    assert.ok(audience.length >= 3)
    assert.deepEqual([...harness.db.rows.notifications.values()], [])
    assert.deepEqual(harness.state.smtpMessages, [])
  })
})

// ---------------------------------------------------------------------------
// NEW-mode two-step FINAL lifecycle (final-review fix wave C1/I1)
// ---------------------------------------------------------------------------

function newModeLifecycleHarness(): Harness {
  return createHarness({ ...newModeOrgSeed(), departments: departmentRows() })
}

describe('NEW mode lifecycle: parent-unit manager request through two-step FINAL', () => {
  it('creates a null-department NEW request, initiates FINAL by direct origin membership, marks every final row final, and requires both steps to complete', async () => {
    const harness = newModeLifecycleHarness()
    enableNewMode(harness.state)
    enableTestSmtp(harness.state)

    // 1. Parent-unit manager (no legacy department) creates a NEW request.
    const parentMgr = harness.db.user.rows.get('parent-mgr')
    harness.state.currentUser = { ...parentMgr, department: null }
    const created = (await harness.requests.createRequest({
      title: 'Parent unit improvement',
      description: '<p>Parent unit needs a new fixture.</p>',
      inlineImageSessionId: scenarioUuid(90),
      stagedAttachmentIds: [],
    })) as { success: boolean; requestId?: string; error?: string }
    assert.equal(created.success, true, created.error)

    const requestId = created.requestId!
    const storedRequest = harness.db.requests.rows.get(requestId)
    // NEW creation: typed origin unit persisted once; null legacy department.
    assert.equal(storedRequest?.departmentId, null)
    assert.equal(storedRequest?.organizationUnitId, 'department-pd-unit')
    assert.equal(storedRequest?.status, 'ImprovementRequest')

    // 2. The two-step REQUEST snapshot (division then factory) approves and
    // sends the request to engineering.
    harness.state.authUserId = 'division-mgr'
    await harness.approvals.approveRequest(requestId)
    harness.state.authUserId = 'factory-mgr'
    await harness.approvals.approveRequest(requestId)
    assert.equal(harness.db.requests.rows.get(requestId)?.status, 'SentToEngineer')

    // 3. Engineering assigns and submits a solution; two-step SOLUTION
    // snapshot (supervisor then parent manager) approves back to the requester.
    const engineerTwo = harness.db.user.rows.get('new-eng-2')
    harness.state.authUserId = 'new-eng-2'
    harness.state.currentUser = { ...engineerTwo, department: { id: 'department-engineering', type: 'ENGINEERING', name: 'Engineering' } }
    await harness.requests.assignEngineers(requestId, ['new-eng-1'])
    harness.state.currentUser = null
    harness.state.authUserId = 'new-eng-1'
    const submitted = (await harness.solutions.submitSolution({
      requestId,
      title: 'Fixture retrofit',
      description: '<p>Retrofit the fixture assembly.</p>',
      inlineImageSessionId: scenarioUuid(91),
      costEstimate: 1200,
      currency: 'THB',
      timeline: '2 weeks',
    })) as { success: boolean; solutionId?: string; error?: string }
    assert.equal(submitted.success, true, submitted.error)

    const solutionId = submitted.solutionId!
    // First SOLUTION step candidate notified before acting (emitted payload).
    assert.deepEqual(
      harness.db.notificationsFor('new-supervisor-1').map((row) => ({ type: row.type, title: row.title })),
      [{ type: 'approval_needed', title: 'Solution Submitted for Approval' }],
    )
    harness.state.authUserId = 'new-supervisor-1'
    await harness.solutions.approveSolution(solutionId)
    harness.state.authUserId = 'parent-mgr'
    await harness.solutions.approveSolution(solutionId)
    assert.equal(harness.db.requests.rows.get(requestId)?.status, 'SendBackToRequester')

    // 4. Final initiation succeeds for the direct origin-unit member even
    // though the request has no legacy department (NEW typed origin).
    // Earlier phase notifications are cleared so the final-phase audience
    // assertions below see exactly the FINAL emissions.
    harness.db.rows.notifications.clear()
    const initiated = (await harness.solutions.initiateFinalApproval(requestId, false)) as { success: boolean }
    assert.equal(initiated.success, true)

    // C1: EVERY persisted NEW final row carries isFinalApproval identity.
    const finalRows = harness.db
      .requestApprovalsForRequest(requestId)
      .filter((row) => row.isFinalApproval === true)
      .sort((a, b) => (a.order as number) - (b.order as number))
    assert.equal(finalRows.length, 2)
    assert.deepEqual(
      finalRows.map((row) => ({ order: row.order, status: row.status, isFinalApproval: row.isFinalApproval, routingMode: row.routingMode })),
      [
        { order: 1, status: 'pending', isFinalApproval: true, routingMode: 'SNAPSHOT_GROUP' },
        { order: 2, status: 'pending', isFinalApproval: true, routingMode: 'SNAPSHOT_GROUP' },
      ],
    )
    // Captured candidate groups: step 1 division manager, step 2 factory manager.
    const groups = [...harness.db.rows.approval_candidate_groups.values()].sort((a, b) => (a.id > b.id ? 1 : -1))
    const groupIdsByOrder = new Map(finalRows.map((row) => [row.order as number, row.candidateGroupId as string]))
    const membersOf = (groupId: string) =>
      [...harness.db.rows.approval_candidate_group_members.values()]
        .filter((member) => member.candidateGroupId === groupId)
        .map((member) => member.userId)
    assert.equal(groupIdsByOrder.size, 2)
    assert.deepEqual(membersOf(groupIdsByOrder.get(1)!), ['division-mgr'])
    assert.deepEqual(membersOf(groupIdsByOrder.get(2)!), ['factory-mgr'])
    assert.ok(groups.length >= 2)

    // T10/next-step: only the FIRST final-step candidate is notified, with the
    // production payload (persisted rows through the real recipient resolver).
    assert.deepEqual(
      harness.db.notificationsFor('division-mgr').map((row) => ({ type: row.type, title: row.title, message: row.message })),
      [{ type: 'final_approval_needed', title: 'Final Approval Needed', message: `Request "Parent unit improvement" needs your final approval.` }],
    )
    assert.deepEqual(harness.db.notificationsFor('factory-mgr'), [])

    // First-step candidate is current and eligible; the last step is not yet.
    harness.state.authUserId = 'division-mgr'
    const firstEligible = (await harness.solutions.canUserApproveFinalApproval(requestId)) as { canApprove: boolean }
    assert.equal(firstEligible.canApprove, true)
    harness.state.authUserId = 'factory-mgr'
    const lastEligible = (await harness.solutions.canUserApproveFinalApproval(requestId)) as { canApprove: boolean }
    assert.equal(lastEligible.canApprove, false)

    // 5. First approval advances nothing terminal: the request stays in
    // FinalApproval and exactly one final step remains pending.
    harness.db.rows.notifications.clear()
    harness.state.authUserId = 'division-mgr'
    const firstApproval = (await harness.solutions.approveFinalApproval(requestId)) as { success: boolean }
    assert.equal(firstApproval.success, true)
    assert.equal(harness.db.requests.rows.get(requestId)?.status, 'FinalApproval')
    assert.equal(
      harness.db.requestApprovalsForRequest(requestId).filter((row) => row.status === 'pending' && row.isFinalApproval === true).length,
      1,
    )

    // T10 intermediate next-step: after approving the first step, the exact
    // emitted next-recipient payload goes to the LAST step's candidate — and
    // to nobody else.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({
        userId: row.userId,
        type: row.type,
        title: row.title,
        message: row.message,
      })),
      [{
        userId: 'factory-mgr',
        type: 'final_approval_needed',
        title: 'Final Approval Needed',
        message: 'Request "Parent unit improvement" needs your final approval.',
      }],
    )

    // 6. Only after the second (last) step approves does the request complete.
    harness.state.authUserId = 'factory-mgr'
    const lastEligibleAfterFirst = (await harness.solutions.canUserApproveFinalApproval(requestId)) as { canApprove: boolean }
    assert.equal(lastEligibleAfterFirst.canApprove, true)
    const secondApproval = (await harness.solutions.approveFinalApproval(requestId)) as { success: boolean }
    assert.equal(secondApproval.success, true)
    assert.equal(harness.db.requests.rows.get(requestId)?.status, 'Completed')
  })
})
