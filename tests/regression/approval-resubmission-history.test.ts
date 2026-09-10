/**
 * Task 8 resubmission history and rollout-gate contracts. Prior attempts are
 * superseded (rows and terminal outcomes preserved, attempt numbering
 * advances), first NEW resubmission wraps legacy rows into a historical
 * instance, pending/action/notification queries filter current instance
 * identity, and rejects/cancels record the instance outcome atomically. The
 * rollout gate keeps legacy as the default, reports shadow comparisons without
 * writes, and denies new-mode creation until activation support exists.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequestApprovalAttempt, createSolutionApprovalAttempt } from '@/lib/approval-engine/phase-adapters'
import { getApprovalRolloutMode } from '@/lib/approval-rollout'
import {
  SCENARIO,
  baselineRequest,
  createHarness,
  departmentRows,
  workflowUsers,
  type Harness,
} from '../fixtures/organization-approval-harness'
import {
  createPhaseAdapterDbWithRejectedAttempt,
  createPhaseAdapterFixture,
} from '../fixtures/organization-approval-fixtures'

const REQUEST_ID = SCENARIO.requestId

describe('first NEW resubmission wraps legacy rows', () => {
  it('wraps rejected legacy level rows into a historical LEGACY_LEVEL instance and creates attempt 2', async () => {
    const approvedAt = new Date('2026-01-05T09:30:00Z')
    const db = createPhaseAdapterFixture({
      phase: 'REQUEST',
      planOutcome: 'AUTO_APPROVED',
      legacyRows: [
        {
          id: 'legacy-row-1',
          requestId: 'r1',
          isFinalApproval: false,
          order: 1,
          status: 'rejected',
          approverId: 'supervisor-1',
          requiredLevel: 2,
          requiredApproverId: null,
          comments: 'Rejected level 2',
          approvedAt,
          isCustomChain: false,
          routingMode: 'LEGACY_LEVEL',
          integrityVersion: 0,
        },
        {
          id: 'legacy-row-2',
          requestId: 'r1',
          isFinalApproval: false,
          order: 2,
          status: 'approved',
          requiredLevel: 4,
          isCustomChain: false,
          routingMode: 'LEGACY_LEVEL',
          integrityVersion: 0,
        },
      ],
    })

    const result = await createRequestApprovalAttempt(db, { requestId: 'r1', requesterId: 'staff-1' })

    // The new attempt advances to 2 and the wrapped history keeps its rows.
    assert.equal(result.instance.attempt, 2)
    const wrapped = db.instances().find((instance) => instance.routingMode === 'LEGACY_LEVEL')
    assert.ok(wrapped, 'legacy rows are wrapped into a historical instance')
    assert.deepEqual(
      { attempt: wrapped?.attempt, state: wrapped?.state, phase: wrapped?.phase, supersededAt: wrapped?.supersededAt !== null, originUserId: wrapped?.originUserId, requestId: wrapped?.requestId },
      { attempt: 1, state: 'REJECTED', phase: 'REQUEST', supersededAt: true, originUserId: 'staff-1', requestId: 'r1' },
    )
    const wrappedRows = db.approvalRows().filter((row) => row.instanceId === wrapped?.id)
    assert.equal(wrappedRows.length, 2, 'wrapped rows are retained, never deleted or rewritten')
    assert.deepEqual(
      wrappedRows.map((row) => ({ id: row.id, status: row.status, requiredLevel: row.requiredLevel, approverId: row.approverId, approvedAt: row.approvedAt, integrityVersion: row.integrityVersion, comments: row.comments })),
      [
        { id: 'legacy-row-1', status: 'rejected', requiredLevel: 2, approverId: 'supervisor-1', approvedAt, integrityVersion: 0, comments: 'Rejected level 2' },
        { id: 'legacy-row-2', status: 'approved', requiredLevel: 4, approverId: null, approvedAt: null, integrityVersion: 0, comments: null },
      ],
    )
    assert.equal(db.priorAttemptState('r1', 'REQUEST'), 'SUPERSEDED')
    // The wrapped attempt is never current again.
    const current = db.instances().filter((instance) => instance.supersededAt === null)
    assert.deepEqual(current.map((instance) => instance.attempt), [2])
  })

  it('wraps legacy custom rows into a CUSTOM_PERSON instance preserving designated approvers', async () => {
    const db = createPhaseAdapterFixture({
      phase: 'SOLUTION',
      planOutcome: 'PENDING',
      legacyRows: [
        {
          id: 'legacy-custom-1',
          solutionId: 's1',
          order: 1,
          status: 'rejected',
          isCustomChain: true,
          routingMode: 'CUSTOM_PERSON',
          integrityVersion: 0,
          requiredApproverId: 'custom-approver-1',
          requiredLevel: null,
        },
      ],
    })

    const result = await createSolutionApprovalAttempt(db, { requestId: 'r1', solutionId: 's1', submittedById: 'engineer-1' })

    const wrapped = db.instances().find((instance) => instance.routingMode === 'CUSTOM_PERSON')
    assert.ok(wrapped, 'custom legacy rows wrap into a CUSTOM_PERSON instance')
    assert.deepEqual(
      { attempt: wrapped?.attempt, state: wrapped?.state, solutionId: wrapped?.solutionId, requestId: wrapped?.requestId, supersededAt: wrapped?.supersededAt !== null, originUserId: wrapped?.originUserId },
      { attempt: 1, state: 'REJECTED', solutionId: 's1', requestId: null, supersededAt: true, originUserId: 'engineer-1' },
    )
    const wrappedRow = db.approvalRows().find((row) => row.id === 'legacy-custom-1')
    assert.deepEqual(
      { instanceId: wrappedRow?.instanceId, requiredApproverId: wrappedRow?.requiredApproverId, status: wrappedRow?.status, isCustomChain: wrappedRow?.isCustomChain, order: wrappedRow?.order },
      { instanceId: wrapped?.id, requiredApproverId: 'custom-approver-1', status: 'rejected', isCustomChain: true, order: 1 },
    )
    assert.equal(result.instance.attempt, 2)
  })

  it('does not wrap when a current NEW instance already exists', async () => {
    const db = createPhaseAdapterFixture({
      phase: 'REQUEST',
      planOutcome: 'AUTO_APPROVED',
      priorAttempt: {
        attempt: 1,
        state: 'PENDING',
        rows: [
          {
            id: 'new-row-1',
            requestId: 'r1',
            isFinalApproval: false,
            order: 1,
            status: 'pending',
            isCustomChain: false,
            routingMode: 'SNAPSHOT_GROUP',
            integrityVersion: 1,
            requiredPosition: 'SUPERVISOR',
          },
        ],
      },
    })

    const result = await createRequestApprovalAttempt(db, { requestId: 'r1', requesterId: 'staff-1' })

    assert.equal(result.instance.attempt, 2)
    const wrapped = db.instances().find((instance) => instance.routingMode === 'LEGACY_LEVEL')
    assert.equal(wrapped, undefined, 'existing NEW history is superseded, not wrapped')
    const prior = db.instances().find((instance) => instance.attempt === 1)
    assert.equal(prior?.routingMode, 'SNAPSHOT_GROUP')
    assert.ok(prior?.supersededAt)
    assert.equal(db.priorAttemptRowsRemain('r1'), true)
  })
})

// ---------------------------------------------------------------------------
// Real-action history through the VM harness
// ---------------------------------------------------------------------------

function harnessWithInstances(options: {
  requestStatus: string
  approvals?: Array<Record<string, unknown>>
  solutionApprovals?: Array<Record<string, unknown>>
  solutions?: Array<Record<string, unknown>>
  instances?: Array<Record<string, unknown>>
}): Harness {
  const harness = createHarness({
    departments: departmentRows(),
    users: workflowUsers(),
    requests: [baselineRequest({ status: options.requestStatus })],
    request_approvals: options.approvals ?? [],
    solutions: options.solutions ?? [],
    solution_approvals: options.solutionApprovals ?? [],
    approval_instances: options.instances ?? [],
  })
  return harness
}

function wrappedInstance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'instance-wrapped-1',
    requestId: REQUEST_ID,
    solutionId: null,
    phase: 'REQUEST',
    routeVersionId: null,
    originUserId: 'staff-1',
    originUnitId: 'section-pd1',
    originContext: {},
    routingMode: 'LEGACY_LEVEL',
    state: 'REJECTED',
    attempt: 1,
    completionReason: null,
    supersededAt: new Date('2026-01-06T00:00:00Z'),
    createdAt: new Date('2026-01-05T00:00:00Z'),
    ...overrides,
  }
}

describe('pending, action, and notification queries filter current instance identity', () => {
  it('never authorizes an action on a wrapped pending row, even at a matching level', async () => {
    const wrapped = harnessWithInstances({
      requestStatus: 'ImprovementRequest',
      approvals: [
        { id: 'a1', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'pending', isFinalApproval: false, instanceId: 'instance-wrapped-1', routingMode: 'LEGACY_LEVEL', integrityVersion: 0 },
      ],
      instances: [wrappedInstance()],
    })
    wrapped.state.authUserId = 'supervisor-1'
    const decision = (await wrapped.approvals.canUserApprove(REQUEST_ID)) as { canApprove: boolean }
    assert.equal(decision.canApprove, false, 'wrapped history never looks current')

    // The otherwise identical current instance keeps the row actionable.
    const current = harnessWithInstances({
      requestStatus: 'ImprovementRequest',
      approvals: [
        { id: 'a1', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'pending', isFinalApproval: false, instanceId: 'instance-current-1', routingMode: 'LEGACY_LEVEL', integrityVersion: 0 },
      ],
      instances: [wrappedInstance({ id: 'instance-current-1', state: 'PENDING', supersededAt: null })],
    })
    current.state.authUserId = 'supervisor-1'
    const currentDecision = (await current.approvals.canUserApprove(REQUEST_ID)) as { canApprove: boolean }
    assert.equal(currentDecision.canApprove, true)
  })

  it('does not count wrapped pending approvals when cancelling', async () => {
    const harness = harnessWithInstances({
      requestStatus: 'SendBackToRequester',
      approvals: [
        { id: 'a-wrapped', requestId: REQUEST_ID, requiredLevel: 4, order: 1, status: 'pending', isFinalApproval: false, instanceId: 'instance-wrapped-1', routingMode: 'LEGACY_LEVEL', integrityVersion: 0 },
      ],
      solutions: [{
        id: SCENARIO.solutionId,
        requestId: REQUEST_ID,
        title: 'Solution',
        description: '<p>S</p>',
        costEstimate: 10,
        currency: 'THB',
        timeline: '1 week',
        submittedById: 'engineer-1',
      }],
      solutionApprovals: [
        { id: 'sa-wrapped', solutionId: SCENARIO.solutionId, requiredLevel: 2, order: 1, status: 'pending', isCustomChain: false, instanceId: 'instance-wrapped-sol', routingMode: 'LEGACY_LEVEL', integrityVersion: 0 },
      ],
      instances: [
        wrappedInstance(),
        wrappedInstance({ id: 'instance-wrapped-sol', solutionId: SCENARIO.solutionId, requestId: null, phase: 'SOLUTION' }),
      ],
    })
    harness.state.authUserId = 'staff-1'

    const result = (await harness.requests.cancelRequest({ requestId: REQUEST_ID, reason: 'No longer needed by the line' })) as { success: boolean }
    assert.equal(result.success, true, 'wrapped pending rows must not block cancellation')
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'Cancelled')
  })

  it('never notifies a wrapped pending row as the next approver and completes on the last current step', async () => {
    const harness = harnessWithInstances({
      requestStatus: 'ImprovementRequest',
      approvals: [
        { id: 'a1', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'approved', approverId: 'supervisor-1', isFinalApproval: false },
        { id: 'a-wrapped', requestId: REQUEST_ID, requiredLevel: 4, order: 2, status: 'pending', isFinalApproval: false, instanceId: 'instance-wrapped-1', routingMode: 'LEGACY_LEVEL', integrityVersion: 0 },
        { id: 'a3', requestId: REQUEST_ID, requiredLevel: 4, order: 3, status: 'pending', isFinalApproval: false },
      ],
      instances: [wrappedInstance()],
    })
    harness.state.authUserId = 'department-manager-1'

    const result = (await harness.approvals.approveRequest(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)
    // The wrapped level-4 pending row is invisible to the completion count:
    // a3 was the last CURRENT approval, so the phase completes into
    // SentToEngineer with the pinned engineering task broadcast — the wrapped
    // row neither blocks completion nor is notified.
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

  it('rejects onto the current instance outcome atomically without new notification events', async () => {
    const harness = harnessWithInstances({
      requestStatus: 'ImprovementRequest',
      approvals: [
        { id: 'a1', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'pending', isFinalApproval: false },
        { id: 'a-snap', requestId: REQUEST_ID, requiredLevel: null, order: 2, status: 'pending', isFinalApproval: false, requiredPosition: 'SECTION_MANAGER', instanceId: 'instance-current-1', routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, candidateGroupId: 'group-1' },
      ],
      instances: [wrappedInstance({ id: 'instance-current-1', state: 'PENDING', supersededAt: null, attempt: 2, routingMode: 'SNAPSHOT_GROUP' })],
    })
    harness.state.authUserId = 'supervisor-1'

    const result = (await harness.approvals.rejectRequest(REQUEST_ID, 'Needs rework')) as { success: boolean }
    assert.equal(result.success, true)

    assert.equal(harness.db.rows.approval_instances.get('instance-current-1')?.state, 'REJECTED')
    assert.equal(harness.db.rows.approval_instances.get('instance-current-1')?.supersededAt, null)
    const statuses = [...harness.db.rows.request_approvals.values()].map((row) => row.status).sort()
    assert.deepEqual(statuses, ['rejected', 'rejected'], 'the matched row and remaining current pending rows are rejected')
    // Only the existing rejection notification to the requester is emitted.
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: 'staff-1', type: 'approval_rejected' }],
    )
  })

  it('marks a pending current instance cancelled and preserves terminal outcomes', async () => {
    const pendingInstance = harnessWithInstances({
      requestStatus: 'SendBackToRequester',
      instances: [wrappedInstance({ id: 'instance-current-1', state: 'PENDING', supersededAt: null, attempt: 1, routingMode: 'SNAPSHOT_GROUP' })],
    })
    pendingInstance.state.authUserId = 'staff-1'
    const result = (await pendingInstance.requests.cancelRequest({ requestId: REQUEST_ID, reason: 'No longer needed by the line' })) as { success: boolean }
    assert.equal(result.success, true)
    assert.equal(pendingInstance.db.rows.approval_instances.get('instance-current-1')?.state, 'CANCELLED')

    const terminal = harnessWithInstances({
      requestStatus: 'SendBackToRequester',
      instances: [wrappedInstance({ id: 'instance-auto-1', state: 'AUTO_APPROVED', supersededAt: null, attempt: 1, routingMode: 'SNAPSHOT_GROUP' })],
    })
    terminal.state.authUserId = 'staff-1'
    const terminalResult = (await terminal.requests.cancelRequest({ requestId: REQUEST_ID, reason: 'No longer needed by the line' })) as { success: boolean }
    assert.equal(terminalResult.success, true)
    assert.equal(terminal.db.rows.approval_instances.get('instance-auto-1')?.state, 'AUTO_APPROVED', 'cancellation never overwrites a terminal instance outcome')
    assert.deepEqual([...terminal.db.rows.notifications.values()], [])
  })
})

describe('superseded pending rows never look current anywhere', () => {
  function supersededPendingHarness(extraApprovals: Array<Record<string, unknown>> = [], options: {
    requestStatus?: string
    extraInstances?: Array<Record<string, unknown>>
    solutions?: Array<Record<string, unknown>>
    solutionApprovals?: Array<Record<string, unknown>>
  } = {}): Harness {
    return harnessWithInstances({
      requestStatus: options.requestStatus ?? 'ImprovementRequest',
      approvals: [
        {
          id: 'a-super',
          requestId: REQUEST_ID,
          requiredLevel: 4,
          order: 1,
          status: 'pending',
          isFinalApproval: false,
          instanceId: 'instance-superseded-1',
          routingMode: 'LEGACY_LEVEL',
          integrityVersion: 0,
        },
        ...extraApprovals,
      ],
      solutions: options.solutions ?? [],
      solutionApprovals: options.solutionApprovals ?? [],
      instances: [
        wrappedInstance(),
        ...(options.extraInstances ?? []),
      ],
    })
  }

  function currentInstance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return wrappedInstance({ id: 'instance-current-1', state: 'PENDING', supersededAt: null, attempt: 2, ...overrides })
  }

  it('inbox actionability ignores superseded pending rows and still sees current-instance rows', async () => {
    const author = workflowUsers().find((u) => u.id === 'department-manager-1')!
    const hidden = supersededPendingHarness()
    hidden.state.currentUser = { ...author, department: { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' } }
    const hiddenItems = (await hidden.requests.getMyActionItems()) as Array<{ id: string }>
    assert.equal(
      hiddenItems.filter((item) => item.id === REQUEST_ID).length,
      0,
      'a pending row on a superseded instance is never offered as an action',
    )

    const visible = supersededPendingHarness(
      [
        {
          id: 'a-cur',
          requestId: REQUEST_ID,
          requiredLevel: 4,
          order: 2,
          status: 'pending',
          isFinalApproval: false,
          instanceId: 'instance-current-1',
          routingMode: 'LEGACY_LEVEL',
          integrityVersion: 0,
        },
      ],
      { extraInstances: [currentInstance()] },
    )
    visible.state.currentUser = { ...author, department: { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' } }
    const visibleItems = (await visible.requests.getMyActionItems()) as Array<{ id: string }>
    assert.equal(
      visibleItems.filter((item) => item.id === REQUEST_ID).length,
      1,
      'the identical row on the current instance stays actionable',
    )
  })

  it('blocking counts ignore superseded pending rows so the current step stays actionable', async () => {
    const author = workflowUsers().find((u) => u.id === 'department-manager-1')!
    const harness = supersededPendingHarness(
      [
        {
          id: 'a-cur',
          requestId: REQUEST_ID,
          requiredLevel: 4,
          order: 2,
          status: 'pending',
          isFinalApproval: false,
          instanceId: 'instance-current-1',
          routingMode: 'LEGACY_LEVEL',
          integrityVersion: 0,
        },
      ],
      { extraInstances: [currentInstance()] },
    )
    harness.state.currentUser = { ...author, department: { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' } }
    const items = (await harness.requests.getMyActionItems()) as Array<{ id: string }>
    assert.equal(
      items.filter((item) => item.id === REQUEST_ID).length,
      1,
      'the superseded order-1 pending row must not block the current order-2 step',
    )
  })

  it('engineering needsApproval ignores superseded solution pending rows', async () => {
    const solutionSeed = [{
      id: SCENARIO.solutionId,
      requestId: REQUEST_ID,
      title: 'Solution',
      description: '<p>S</p>',
      costEstimate: 10,
      currency: 'THB',
      timeline: '1 week',
      submittedById: 'engineer-1',
    }]
    const supersededRow = {
      id: 'sa-super',
      solutionId: SCENARIO.solutionId,
      requiredLevel: null,
      requiredApproverId: 'engineer-1',
      order: 1,
      status: 'pending',
      isCustomChain: true,
      instanceId: 'instance-superseded-sol',
      routingMode: 'CUSTOM_PERSON',
      integrityVersion: 1,
    }
    const hidden = harnessWithInstances({
      requestStatus: 'DesignCostEstimationApproval',
      solutions: solutionSeed,
      solutionApprovals: [supersededRow],
      instances: [wrappedInstance({ id: 'instance-superseded-sol', solutionId: SCENARIO.solutionId, requestId: null, phase: 'SOLUTION' })],
    })
    const hiddenResult = (await hidden.requests.getRequestsNeedingEngineeringAction('engineer-1')) as { needsApproval: Array<{ request: { id: string } }> }
    assert.equal(
      hiddenResult.needsApproval.filter((entry) => entry.request.id === REQUEST_ID).length,
      0,
      'a pending row on a superseded solution instance is never offered for approval',
    )

    const visible = harnessWithInstances({
      requestStatus: 'DesignCostEstimationApproval',
      solutions: solutionSeed,
      solutionApprovals: [{ ...supersededRow, id: 'sa-cur', instanceId: 'instance-current-sol' }],
      instances: [
        wrappedInstance({
          id: 'instance-current-sol',
          solutionId: SCENARIO.solutionId,
          requestId: null,
          phase: 'SOLUTION',
          state: 'PENDING',
          supersededAt: null,
          routingMode: 'CUSTOM_PERSON',
        }),
      ],
    })
    const visibleResult = (await visible.requests.getRequestsNeedingEngineeringAction('engineer-1')) as { needsApproval: Array<{ request: { id: string } }> }
    assert.equal(
      visibleResult.needsApproval.filter((entry) => entry.request.id === REQUEST_ID).length,
      1,
      'the identical row on the current solution instance stays offered',
    )
  })

  it('last-step approval completes the phase when only superseded pending rows remain', async () => {
    const harness = supersededPendingHarness([
      {
        id: 'a2',
        requestId: REQUEST_ID,
        requiredLevel: 4,
        order: 2,
        status: 'pending',
        isFinalApproval: false,
      },
    ])
    harness.state.authUserId = 'department-manager-1'

    const result = (await harness.approvals.approveRequest(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)
    assert.equal(
      harness.db.requests.rows.get(REQUEST_ID)?.status,
      'SentToEngineer',
      'superseded pending history must not block the phase completion',
    )
  })

  it('superseded pending request and solution rows do not block rejected-request cancellation', async () => {
    const harness = harnessWithInstances({
      requestStatus: 'ImprovementRequest',
      approvals: [
        { id: 'a-rejected', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'rejected', approverId: 'supervisor-1', isFinalApproval: false },
        {
          id: 'a-super',
          requestId: REQUEST_ID,
          requiredLevel: 4,
          order: 2,
          status: 'pending',
          isFinalApproval: false,
          instanceId: 'instance-superseded-1',
          routingMode: 'LEGACY_LEVEL',
          integrityVersion: 0,
        },
      ],
      solutions: [{
        id: SCENARIO.solutionId,
        requestId: REQUEST_ID,
        title: 'Solution',
        description: '<p>S</p>',
        costEstimate: 10,
        currency: 'THB',
        timeline: '1 week',
        submittedById: 'engineer-1',
      }],
      solutionApprovals: [{
        id: 'sa-super',
        solutionId: SCENARIO.solutionId,
        requiredLevel: 2,
        order: 1,
        status: 'pending',
        isCustomChain: false,
        instanceId: 'instance-superseded-sol',
        routingMode: 'LEGACY_LEVEL',
        integrityVersion: 0,
      }],
      instances: [
        wrappedInstance(),
        wrappedInstance({ id: 'instance-superseded-sol', solutionId: SCENARIO.solutionId, requestId: null, phase: 'SOLUTION' }),
      ],
    })
    harness.state.authUserId = 'staff-1'

    const result = (await harness.requests.cancelRequest({ requestId: REQUEST_ID, reason: 'No longer needed by the line' })) as { success: boolean }
    assert.equal(result.success, true, 'superseded pending history must not block cancellation')
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'Cancelled')
  })

  it('a committed NEW intermediate approve skips the legacy next-approver notification without throwing', async () => {
    const harness = harnessWithInstances({
      requestStatus: 'ImprovementRequest',
      approvals: [
        { id: 'a1', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'pending', isFinalApproval: false },
        {
          id: 'a-snap',
          requestId: REQUEST_ID,
          requiredLevel: null,
          order: 2,
          status: 'pending',
          isFinalApproval: false,
          requiredPosition: 'SECTION_MANAGER',
          instanceId: 'instance-current-1',
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          candidateGroupId: 'group-1',
        },
      ],
      instances: [wrappedInstance({ id: 'instance-current-1', state: 'PENDING', supersededAt: null, attempt: 1, routingMode: 'SNAPSHOT_GROUP' })],
    })
    harness.state.authUserId = 'supervisor-1'

    // A null-level SNAPSHOT row is next: the legacy level audience does not
    // exist, so the notification is a silent no-op, never a thrown error and
    // never a substituted audience.
    const result = (await harness.approvals.approveRequest(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)
    assert.equal(harness.db.rows.request_approvals.get('a1')?.status, 'approved')
    assert.deepEqual([...harness.db.rows.notifications.values()], [])
  })
})

// ---------------------------------------------------------------------------
// Rollout gate
// ---------------------------------------------------------------------------

describe('approval rollout gate', () => {
  it('defaults to legacy and accepts only the documented values', () => {
    assert.equal(getApprovalRolloutMode({}), 'legacy')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: undefined }), 'legacy')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: 'legacy' }), 'legacy')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: 'shadow' }), 'shadow')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: 'new' }), 'new')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: 'nwe' }), 'legacy', 'unknown values fall back to the legacy default')
  })

  it('denies new-mode request creation until activation support exists', { skip: 'B6-fix1: rollout/activation modes dropped (B15), not a SNAPSHOT_GROUP seed gap. Named replacement: tests/regression/clean-start-attempts.test.ts + B15.' }, async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
    })
    const author = workflowUsers().find((u) => u.id === 'staff-1')!
    harness.state.currentUser = { ...author, department: { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' } }
    harness.state.env.APPROVAL_ROUTING_MODE = 'new'

    const result = (await harness.requests.createRequest({
      title: 'Blocked by the gate',
      description: '<p>Gate test</p>',
      inlineImageSessionId: '00000000-0000-4000-8000-000000000097',
      stagedAttachmentIds: [],
    })) as { success: boolean; error?: string }

    assert.equal(result.success, false)
    assert.match(result.error ?? '', /not enabled|APPROVAL_ROUTING_MODE/i)
    assert.equal(harness.db.requests.rows.size, 0, 'a denied creation writes nothing')
    assert.equal(harness.db.rows.approval_instances.size, 0)
  })

  it('denies new-mode request resubmission with the same clear error', { skip: 'B6-fix1: rollout/activation modes dropped (B15), not a SNAPSHOT_GROUP seed gap. Named replacement: tests/regression/clean-start-attempts.test.ts + B15.' }, async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ status: 'ImprovementRequest' })],
      request_approvals: [
        { id: 'a1', requestId: REQUEST_ID, requiredLevel: 2, order: 1, status: 'rejected', approverId: 'supervisor-1', isFinalApproval: false },
      ],
    })
    harness.state.authUserId = 'staff-1'
    harness.state.env.APPROVAL_ROUTING_MODE = 'new'

    await assert.rejects(
      harness.requests.resubmitRequest({ requestId: REQUEST_ID }),
      /not enabled|APPROVAL_ROUTING_MODE/i,
    )
    assert.equal(harness.db.requestApprovalsForRequest(REQUEST_ID).length, 1, 'a denied resubmission deletes nothing')
  })

  it('keeps shadow creation on the legacy result while reporting the NEW comparison without writes', { skip: 'B6-fix1: rollout/activation modes dropped (B15), not a SNAPSHOT_GROUP seed gap. Named replacement: tests/regression/clean-start-attempts.test.ts + B15.' }, async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
    })
    const author = workflowUsers().find((u) => u.id === 'staff-1')!
    harness.state.currentUser = { ...author, department: { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' } }
    harness.state.env.APPROVAL_ROUTING_MODE = 'shadow'

    const result = (await harness.requests.createRequest({
      title: 'Shadow request',
      description: '<p>Shadow comparison</p>',
      inlineImageSessionId: '00000000-0000-4000-8000-000000000097',
      stagedAttachmentIds: [],
    })) as { success: boolean; requestId: string }
    assert.equal(result.success, true)

    // Identical legacy result: level rows and first-approver notification.
    const approvals = harness.db.requestApprovalsForRequest(result.requestId).sort((a, b) => (a.order as number) - (b.order as number))
    assert.deepEqual(
      approvals.map((row) => ({ requiredLevel: row.requiredLevel, order: row.order, status: row.status, routingMode: row.routingMode ?? 'LEGACY_LEVEL' })),
      [
        { requiredLevel: 2, order: 1, status: 'pending', routingMode: 'LEGACY_LEVEL' },
        { requiredLevel: 4, order: 2, status: 'pending', routingMode: 'LEGACY_LEVEL' },
      ],
    )
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: 'supervisor-1', type: 'approval_needed' }],
    )
    assert.equal(
      [...harness.db.rows.request_activities.values()].some((row) => row.action === 'status_changed'),
      false,
      'shadow never completes the phase',
    )

    // The unmapped NEW comparison is reported and never breaks submission.
    // The harness routes module console.error into state.consoleErrors.
    assert.equal(harness.state.consoleErrors.length, 1, 'the shadow comparison reports its resolution problem')
    assert.match(String(harness.state.consoleErrors[0]?.[0] ?? ''), /\[approval-rollout\]/)

    // No NEW-engine writes of any kind.
    assert.equal(harness.db.rows.approval_instances.size, 0)
  })
})
