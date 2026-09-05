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
  enableTestSmtp,
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

    // Active requester-department users only; all engineering users excluded
    // (including the inactive-check-exempt raw exclusion list).
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
