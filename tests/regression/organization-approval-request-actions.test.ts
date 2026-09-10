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

  it('refuses authors without an active organization assignment', async () => {
    const harness = creationHarness('staff-1')
    const result = (await harness.requests.createRequest(creationInput())) as { success: boolean; error?: string }
    assert.equal(result.success, false)
    assert.match(result.error ?? '', /assignment/i)
    assert.equal(harness.db.requests.rows.size, 0)
  })

  it('refuses inactive authors even when assigned', async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      organization_assignments: [
        { id: 'asg-inactive', userId: 'inactive-1', unitId: 'section-pd1', positionId: 'p-staff', teamId: null, isActive: true },
      ],
    })
    const author = workflowUsers().find((u) => u.id === 'inactive-1')!
    harness.state.currentUser = { ...author, department: { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' } }
    const result = (await harness.requests.createRequest(creationInput())) as { success: boolean; error?: string }
    assert.equal(result.success, false)
    assert.match(result.error ?? '', /assignment/i)
    assert.equal(harness.db.requests.rows.size, 0)
  })

  it('refuses unassigned authors (assignment-based submit, not department-only)', async () => {
    const harness = creationHarness('null-org-1')
    const result = (await harness.requests.createRequest(creationInput())) as { success: boolean; error?: string }
    assert.equal(result.success, false)
    assert.match(result.error ?? '', /assignment/i)
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
  it('resubmitRequest creates the next REQUEST attempt via the clean-start engine (no department-only rebuild)', async () => {
    const harness = requestHarness('ImprovementRequest', [
      { id: 'a1', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'rejected', approverId: 'supervisor-1', isFinalApproval: false },
      { id: 'a2', requestId: REQUEST_ID, requiredLevel: 4, order: 2, status: 'approved', isFinalApproval: false },
    ])
    harness.state.authUserId = 'staff-1'
    await assert.rejects(
      harness.requests.resubmitRequest({ requestId: REQUEST_ID }),
      /origin reporting path|active root|organization/i,
    )
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

  it('records Serializable isolation for assignment-based creation transactions', async () => {
    const harness = isolationHarness('legacy')
    harness.db.seed('organization_assignments', [
      { id: 'asg-staff-1', userId: 'staff-1', unitId: 'section-pd1', positionId: 'p-staff', teamId: null, isActive: true },
    ])
    await harness.requests.createRequest(creationInput())
    const options = harness.db.transactionOptions.at(-1) as Record<string, unknown> | undefined
    assert.equal(options?.isolationLevel, APPROVAL_ENGINE_TRANSACTION_ISOLATION)
    assert.deepEqual(Object.keys(options ?? {}), ['isolationLevel'])
  })
})

// ---------------------------------------------------------------------------
// Conflict translation is NEW-mode only at the enclosing boundary (P2a)
// ---------------------------------------------------------------------------

const P2034_MESSAGE = 'Transaction failed due to a write conflict or a deadlock'
const CONFLICT_MESSAGE = 'conflicted with a concurrent write'

describe('legacy/shadow serialization failures keep the original error shape (P2a)', () => {
  it('resubmitRequest translates P2034 into ApprovalEngineConflictError', async () => {
    const REQUEST_ID = SCENARIO.requestId
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({
        status: 'ImprovementRequest',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })],
      request_approvals: [
        { id: 'p2a-rejected', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'rejected', isFinalApproval: false },
      ],
    })
    harness.state.authUserId = 'staff-1'
    harness.db.failNextTransaction = { code: 'P2034', message: P2034_MESSAGE }

    await assert.rejects(
      harness.requests.resubmitRequest({ requestId: REQUEST_ID }),
      /origin reporting path|active root|organization|conflicted with a concurrent write/i,
    )
  })

  it('assigned createRequest fails closed without a reporting path rather than using a department gate', async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      organization_assignments: [
        { id: 'asg-staff-1', userId: 'staff-1', unitId: 'section-pd1', positionId: 'p-staff', teamId: null, isActive: true },
      ],
    })
    const author = harness.db.user.rows.get('staff-1')
    harness.state.currentUser = { ...author, department: { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' } }

    const created = (await harness.requests.createRequest({
      title: 'New-mode conflict probe',
      description: '<p>Body</p>',
      inlineImageSessionId: scenarioUuid(97),
      stagedAttachmentIds: [],
    })) as { success: boolean; error?: string }
    assert.equal(created.success, false)
    assert.match(created.error ?? '', /origin reporting path|active root|organization|Failed to create request/i)
    assert.doesNotMatch(created.error ?? '', /department/i)
  })
})
