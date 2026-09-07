/**
 * Request-phase workflow characterization: executes the REAL resubmitRequest,
 * cancelRequest, and approveRequest server actions through the transpile+vm
 * harness, asserting persisted rows, persisted transitions, ownership/status
 * negatives, and production notification deliveries.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCENARIO,
  baselineRequest,
  createHarness,
  departmentRows,
  enableTestSmtp,
  workflowUsers,
  type Harness,
} from '../fixtures/organization-approval-harness'

const REQUEST_ID = SCENARIO.requestId

function requestHarness(requestStatus: string, approvals: Array<Record<string, unknown>> = [], requestOverrides: Record<string, unknown> = {}): Harness {
  return createHarness({
    departments: departmentRows(),
    users: workflowUsers(),
    requests: [baselineRequest({ status: requestStatus, ...requestOverrides })],
    request_approvals: approvals,
  })
}

function pendingApproval(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'pending', isFinalApproval: false, ...overrides }
}

describe('real createRequest', () => {
  function creationHarness(userId: string): Harness {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
    })
    // createRequest resolves the author through the user-cache boundary.
    const author = workflowUsers().find((u) => u.id === userId)!
    harness.state.currentUser = {
      ...author,
      department: { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' },
    }
    return harness
  }

  function creationInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      title: 'New coolant line request',
      description: '<p>Coolant line needs a new pump.</p>',
      inlineImageSessionId: '00000000-0000-4000-8000-000000000097',
      stagedAttachmentIds: [],
      ...overrides,
    }
  }

  it('persists the request, its approval chain, and notifies the first-approver level with the production event', async () => {
    const harness = creationHarness('staff-1')
    enableTestSmtp(harness.state)

    const result = (await harness.requests.createRequest(creationInput())) as { success: boolean; requestId: string }
    assert.equal(result.success, true)

    const requestId = result.requestId
    const persistedRequest = harness.db.requests.rows.get(requestId)
    assert.deepEqual(
      {
        title: persistedRequest?.title,
        requesterId: persistedRequest?.requesterId,
        departmentId: persistedRequest?.departmentId,
        status: persistedRequest?.status,
      },
      {
        title: 'New coolant line request',
        requesterId: 'staff-1',
        departmentId: 'department-pd',
        status: 'ImprovementRequest',
      },
    )

    // Persisted chain from the level-1 submitter in PD (levels 2 and 4).
    const approvals = harness.db.requestApprovalsForRequest(requestId).sort((a, b) => (a.order as number) - (b.order as number))
    assert.deepEqual(
      approvals.map((row) => ({ requiredLevel: row.requiredLevel, order: row.order, status: row.status })),
      [
        { requiredLevel: 2, order: 1, status: 'pending' },
        { requiredLevel: 4, order: 2, status: 'pending' },
      ],
    )
    assert.ok([...harness.db.rows.request_activities.values()].some((row) => row.action === 'created'))

    // Production first-approver notification: level-2 approvers, in-app + email.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type, title: row.title })),
      [{ userId: 'supervisor-1', type: 'approval_needed', title: 'New Approval Request' }],
    )
    assert.deepEqual(harness.state.smtpMessages.map((mail) => mail.to), ['supervisor-1@example.test'])
  })

  it('auto-approves creation for a top-level author: status SentToEngineer and no invented notifications', async () => {
    const harness = creationHarness('department-manager-1')
    enableTestSmtp(harness.state)

    const result = (await harness.requests.createRequest(creationInput())) as { success: boolean; requestId: string }
    assert.equal(result.success, true)

    assert.equal(harness.db.requests.rows.get(result.requestId)?.status, 'SentToEngineer')
    const approvals = harness.db.requestApprovalsForRequest(result.requestId)
    assert.deepEqual(
      approvals.map((row) => ({ status: row.status, approverId: row.approverId, comments: row.comments })),
      [{ status: 'approved', approverId: 'department-manager-1', comments: 'Auto-approved (top-level submitter)' }],
    )
    assert.deepEqual(
      [...harness.db.rows.request_activities.values()].map((row) => row.action),
      ['created', 'status_changed'],
    )

    // Auto-approved creation invents no notifications: no approver notice and
    // no engineering task broadcast (that belongs to the request-approval
    // completion step, exercised separately).
    assert.deepEqual([...harness.db.rows.notifications.values()], [])
    assert.deepEqual(harness.state.smtpMessages, [])
  })

  it('refuses authors without a department', async () => {
    const harness = creationHarness('null-org-1')
    const result = (await harness.requests.createRequest(creationInput())) as { success: boolean; error?: string }
    assert.equal(result.success, false)
    assert.match(result.error ?? '', /department/)
    assert.equal(harness.db.requests.rows.size, 0)
  })
})

describe('real approveRequest', () => {
  it('records the intermediate approval, leaves the status, and notifies the next pending level', async () => {
    const harness = requestHarness('ImprovementRequest', [
      pendingApproval('a1'),
      { id: 'a2', requestId: REQUEST_ID, requiredLevel: 4, order: 2, status: 'pending', isFinalApproval: false },
    ])
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'supervisor-1'

    const result = (await harness.approvals.approveRequest(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)

    const rows = harness.db.requestApprovalsForRequest(REQUEST_ID).sort((a, b) => (a.order as number) - (b.order as number))
    assert.deepEqual(
      rows.map((row) => ({ status: row.status, approverId: row.approverId })),
      [
        { status: 'approved', approverId: 'supervisor-1' },
        { status: 'pending', approverId: undefined },
      ],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'ImprovementRequest')

    // notifyNextApprover resolves level 4 approvers through getApproversAtLevel.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: 'department-manager-1', type: 'approval_needed' }],
    )
    assert.deepEqual(harness.state.smtpMessages.map((mail) => mail.to), ['department-manager-1@example.test'])
  })

  it('completes the ImprovementRequest phase into SentToEngineer and broadcasts request_assigned to engineering', async () => {
    const harness = requestHarness('ImprovementRequest', [pendingApproval('a1')])
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'supervisor-1'

    const result = (await harness.approvals.approveRequest(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)

    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'SentToEngineer')
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [
        { userId: 'engineer-1', type: 'request_assigned' },
        { userId: SCENARIO.engineeringSupervisorId, type: 'request_assigned' },
        { userId: SCENARIO.engineeringManagerId, type: 'request_assigned' },
      ],
    )
  })

  it('completes the ladder tail into Completed and notifies the requester of the status change', async () => {
    const harness = requestHarness('SendBackToRequester', [pendingApproval('a1', { requiredLevel: 4 })])
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'department-manager-1'

    const result = (await harness.approvals.approveRequest(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)

    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'Completed')
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: 'staff-1', type: 'status_changed' }],
    )
  })

  it('refuses users without a pending approval assignment at their level', async () => {
    const harness = requestHarness('ImprovementRequest', [pendingApproval('a1')])
    harness.state.authUserId = 'department-manager-1' // level 4, no pending level-4 row
    await assert.rejects(
      harness.approvals.approveRequest(REQUEST_ID),
      /You cannot approve this request at this time/,
    )
    harness.state.authUserId = 'null-org-1' // unrelated, unassigned
    await assert.rejects(
      harness.approvals.approveRequest(REQUEST_ID),
      /You cannot approve this request at this time/,
    )
  })

  it('refuses an assigned out-of-order approver while earlier steps are pending', async () => {
    const harness = requestHarness('ImprovementRequest', [
      pendingApproval('a1'),
      { id: 'a2', requestId: REQUEST_ID, requiredLevel: 4, order: 2, status: 'pending', isFinalApproval: false },
    ])
    harness.state.authUserId = 'department-manager-1'
    await assert.rejects(
      harness.approvals.approveRequest(REQUEST_ID),
      /You cannot approve this request at this time/,
    )
  })
})

describe('real resubmitRequest', () => {
  it('deletes the rejected chain, rebuilds it from the requester level, and keeps the status', async () => {
    const harness = requestHarness('ImprovementRequest', [
      { id: 'a1', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'rejected', approverId: 'supervisor-1', isFinalApproval: false },
      { id: 'a2', requestId: REQUEST_ID, requiredLevel: 4, order: 2, status: 'approved', isFinalApproval: false },
    ])
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'staff-1'
    const beforeUpdatedAt = harness.db.requests.rows.get(REQUEST_ID)?.updatedAt as Date

    const result = (await harness.requests.resubmitRequest({ requestId: REQUEST_ID })) as { success: boolean }
    assert.equal(result.success, true)

    // Old rows gone; fresh chain persisted from the requester's level 1.
    const persisted = harness.db.requestApprovalsForRequest(REQUEST_ID).sort((a, b) => (a.order as number) - (b.order as number))
    assert.deepEqual(
      persisted.map((row) => ({ requiredLevel: row.requiredLevel, order: row.order, status: row.status, requiredApproverId: row.requiredApproverId })),
      [
        { requiredLevel: 2, order: 1, status: 'pending', requiredApproverId: 'supervisor-1' },
        { requiredLevel: 4, order: 2, status: 'pending', requiredApproverId: 'department-manager-1' },
      ],
    )
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'ImprovementRequest')
    assert.ok(((harness.db.requests.rows.get(REQUEST_ID)?.updatedAt as Date).getTime()) > beforeUpdatedAt.getTime())
    assert.ok(
      [...harness.db.rows.request_activities.values()].some((row) => row.action === 'resubmitted'),
    )
    // Resubmission is notification-silent through every channel: no in-app
    // rows and no SMTP sends.
    assert.deepEqual([...harness.db.rows.notifications.values()], [])
    assert.deepEqual(harness.state.smtpMessages, [])
  })

  it('refuses non-requesters and requests without rejections', async () => {
    const nonowner = requestHarness('ImprovementRequest', [pendingApproval('a1', { status: 'rejected' })])
    nonowner.state.authUserId = 'null-org-1'
    await assert.rejects(nonowner.requests.resubmitRequest({ requestId: REQUEST_ID }), /Only the requester can resubmit/)

    const noRejection = requestHarness('ImprovementRequest', [pendingApproval('a1')])
    noRejection.state.authUserId = 'staff-1'
    await assert.rejects(noRejection.requests.resubmitRequest({ requestId: REQUEST_ID }), /does not have any rejections/)

    const wrongStatus = requestHarness('SentToEngineer', [pendingApproval('a1', { status: 'rejected' })])
    wrongStatus.state.authUserId = 'staff-1'
    await assert.rejects(wrongStatus.requests.resubmitRequest({ requestId: REQUEST_ID }), /department approval phase/)
  })
})

describe('real cancelRequest', () => {
  it('cancels for the owner in a cancellable status and writes only the cancelled activity', async () => {
    const harness = requestHarness('SentToEngineer')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'staff-1'

    const result = (await harness.requests.cancelRequest({ requestId: REQUEST_ID, reason: 'No longer needed by the line' })) as { success: boolean }
    assert.equal(result.success, true)

    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'Cancelled')
    const activities = [...harness.db.rows.request_activities.values()]
    assert.deepEqual(
      activities.map((row) => ({ action: row.action, from: row.fromStatus, to: row.toStatus })),
      [{ action: 'cancelled', from: 'SentToEngineer', to: 'Cancelled' }],
    )
    // Cancellation notifies no one.
    assert.deepEqual([...harness.db.rows.notifications.values()], [])
    assert.deepEqual(harness.state.smtpMessages, [])
  })

  it('blocks nonowners, wrong statuses, and pending approvals with the production messages', async () => {
    const nonowner = requestHarness('SentToEngineer')
    nonowner.state.authUserId = 'null-org-1'
    await assert.rejects(
      nonowner.requests.cancelRequest({ requestId: REQUEST_ID, reason: 'No longer needed by the line' }),
      /Only the requester can cancel their own request/,
    )

    const wrongStatus = requestHarness('DesignCostEstimationApproval')
    wrongStatus.state.authUserId = 'staff-1'
    await assert.rejects(
      wrongStatus.requests.cancelRequest({ requestId: REQUEST_ID, reason: 'No longer needed by the line' }),
      /Cannot cancel - request is DesignCostEstimationApproval/,
    )

    const pendingRequestApproval = requestHarness('ImprovementRequest', [
      { id: 'a1', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'rejected', isFinalApproval: false },
      pendingApproval('a2', { requiredLevel: 4, order: 2 }),
    ])
    pendingRequestApproval.state.authUserId = 'staff-1'
    await assert.rejects(
      pendingRequestApproval.requests.cancelRequest({ requestId: REQUEST_ID, reason: 'No longer needed by the line' }),
      /Cannot cancel - a request approval is still pending/,
    )
  })

  it('blocks on a pending solution approval and succeeds once it clears (paired case)', async () => {
    const seedApprovals = (): Array<Record<string, unknown>> => [
      // The cancellation guard's other predicates are satisfied: a rejected
      // non-final request approval exists and no request approval is pending.
      { id: 'a1', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'rejected', approverId: 'supervisor-1', isFinalApproval: false },
    ]
    const blocked = requestHarness('ImprovementRequest', seedApprovals(), {})
    blocked.db.seed('solutions', [{ ...baselineSeedSolution() }])
    blocked.db.seed('solution_approvals', [
      { id: 'sa-1', solutionId: SCENARIO.solutionId, requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'pending', isCustomChain: false },
    ])
    blocked.state.authUserId = 'staff-1'
    await assert.rejects(
      blocked.requests.cancelRequest({ requestId: REQUEST_ID, reason: 'No longer needed by the line' }),
      /Cannot cancel - a solution approval is still pending/,
    )
    assert.equal(blocked.db.requests.rows.get(REQUEST_ID)?.status, 'ImprovementRequest')

    // Otherwise-identical scenario with the solution approval cleared.
    const allowed = requestHarness('ImprovementRequest', seedApprovals(), {})
    allowed.db.seed('solutions', [{ ...baselineSeedSolution() }])
    allowed.db.seed('solution_approvals', [
      { id: 'sa-1', solutionId: SCENARIO.solutionId, requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'rejected', isCustomChain: false },
    ])
    allowed.state.authUserId = 'staff-1'
    const result = (await allowed.requests.cancelRequest({ requestId: REQUEST_ID, reason: 'No longer needed by the line' })) as { success: boolean }
    assert.equal(result.success, true)
    assert.equal(allowed.db.requests.rows.get(REQUEST_ID)?.status, 'Cancelled')
  })
})

function baselineSeedSolution(): Record<string, unknown> {
  return {
    id: SCENARIO.solutionId,
    requestId: REQUEST_ID,
    title: 'Blocked solution',
    description: '<p>Solution</p>',
    costEstimate: 100,
    currency: 'THB',
    timeline: '1 week',
    submittedById: 'engineer-1',
  }
}

// ---------------------------------------------------------------------------
// NEW-mode request resubmission + transaction isolation (fix wave I3/I4)
// ---------------------------------------------------------------------------

import { APPROVAL_ENGINE_TRANSACTION_ISOLATION } from '@/lib/approval-engine/instances'
import {
  enableNewMode,
  newModeOrgSeed,
  scenarioUuid,
} from '../fixtures/organization-approval-harness'

describe('NEW mode resubmission authorization (current-attempt identity)', () => {
  it('denies a second resubmission while the current attempt is pending: a superseded rejection is display history, not authorization', async () => {
    const REQUEST_ID = scenarioUuid(61)
    const harness = createHarness({
      ...newModeOrgSeed(),
      departments: departmentRows(),
      requests: [{
        id: REQUEST_ID,
        status: 'ImprovementRequest',
        requesterId: 'new-staff-1',
        title: 'Resubmission window request',
        description: '<p>Body</p>',
        departmentId: null,
        organizationUnitId: 'section-pd1',
        isDeleted: false,
        isArchived: false,
        updatedAt: new Date('2026-02-02T00:00:00Z'),
      }],
      approval_instances: [
        { id: 'inst-superseded', requestId: REQUEST_ID, phase: 'REQUEST', routeVersionId: 'route-req-pd', originUserId: 'new-staff-1', originUnitId: 'section-pd1', routingMode: 'SNAPSHOT_GROUP', state: 'REJECTED', attempt: 1, supersededAt: new Date('2026-02-03T00:00:00Z') },
        { id: 'inst-current', requestId: REQUEST_ID, phase: 'REQUEST', routeVersionId: 'route-req-pd', originUserId: 'new-staff-1', originUnitId: 'section-pd1', routingMode: 'SNAPSHOT_GROUP', state: 'PENDING', attempt: 2, supersededAt: null },
      ],
      approval_candidate_groups: [
        { id: 'cg-superseded', approvalInstanceId: 'inst-superseded', requiredPosition: 'DIVISION_MANAGER', scopeUnitId: 'division-1', capturedAt: new Date() },
        { id: 'cg-current', approvalInstanceId: 'inst-current', requiredPosition: 'DIVISION_MANAGER', scopeUnitId: 'division-1', capturedAt: new Date() },
      ],
      request_approvals: [
        { id: 'ra-rejected', requestId: REQUEST_ID, order: 1, status: 'rejected', isFinalApproval: false, routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, instanceId: 'inst-superseded', requiredPosition: 'DIVISION_MANAGER', candidateGroupId: 'cg-superseded' },
        { id: 'ra-pending', requestId: REQUEST_ID, order: 1, status: 'pending', isFinalApproval: false, routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, instanceId: 'inst-current', requiredPosition: 'DIVISION_MANAGER', candidateGroupId: 'cg-current' },
      ],
    })
    enableNewMode(harness.state)
    harness.state.authUserId = 'new-staff-1'

    // The only rejection belongs to the SUPERSEDED attempt; the current
    // attempt is still pending, so nothing authorizes another resubmission.
    await assert.rejects(
      harness.requests.resubmitRequest({ requestId: REQUEST_ID }),
      /does not have any rejections|changed by someone else/,
    )
    // No third attempt was created.
    assert.equal(
      [...harness.db.rows.approval_instances.values()].filter((row) => row.requestId === REQUEST_ID).length,
      2,
    )
  })
})

describe('NEW creation transactions request engine SERIALIZABLE isolation', () => {
  function isolationHarness(mode: 'new' | 'legacy') {
    const harness = createHarness({
      departments: departmentRows(),
      // NEW mode uses its own org users (the author has a typed origin);
      // legacy uses the standard workflow users.
      ...(mode === 'new' ? newModeOrgSeed() : { users: workflowUsers() }),
    })
    if (mode === 'new') enableNewMode(harness.state)
    const author = harness.db.user.rows.get(mode === 'new' ? 'new-staff-1' : 'staff-1')
    harness.state.currentUser = {
      ...author,
      department: mode === 'new' ? null : { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' },
    }
    return harness
  }

  function creationInput(): Record<string, unknown> {
    return {
      title: 'Isolation probe request',
      description: '<p>Isolation probe body.</p>',
      inlineImageSessionId: scenarioUuid(95),
      stagedAttachmentIds: [],
    }
  }

  it('records Serializable isolation for the NEW creation transaction', async () => {
    const harness = isolationHarness('new')
    const created = (await harness.requests.createRequest(creationInput())) as { success: boolean; requestId?: string; error?: string }
    assert.equal(created.success, true, created.error)
    const options = harness.db.transactionOptions.at(-1) as Record<string, unknown> | undefined
    // Realm-safe field comparison (vm-built objects differ in prototype).
    assert.equal(options?.isolationLevel, APPROVAL_ENGINE_TRANSACTION_ISOLATION)
    assert.deepEqual(Object.keys(options ?? {}), ['isolationLevel'])
  })

  it('keeps legacy creation transactions on the default isolation', async () => {
    const harness = isolationHarness('legacy')
    const created = (await harness.requests.createRequest(creationInput())) as { success: boolean; requestId?: string; error?: string }
    assert.equal(created.success, true, created.error)
    const options = harness.db.transactionOptions.at(-1)
    assert.equal(options, undefined)
  })
})
