/**
 * Task 2 fix round 1: real behavior tests for the legacy-boundary null-ownership
 * guards and the explicit custom-chain discriminator, executed through the
 * sanctioned transpile+vm harness (tests/fixtures/organization-approval-harness.ts)
 * against the REAL server-action modules — not test-only policy replicas.
 *
 * P1-2/P1-4: version-0 legacy rows (null level, null designated approver) stay
 * readable, and organization-owned requests (null department) fail closed at
 * legacy approval/rejection/final/notification boundaries — no mutation, no
 * in-app notification rows, no SMTP, and never an audience built from
 * departmentless users.
 *
 * P1-1: the existing custom solution/submit/resubmit/final writers explicitly
 * persist routingMode CUSTOM_PERSON (compatibility integrityVersion 0).
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
const SOLUTION_ID = SCENARIO.solutionId

function noDepartmentWrites(harness: Harness): number {
  return harness.db.writes.length
}

describe('legacy approval boundary: null-department actor and organization-owned request', () => {
  function orgOwnedHarness(requestDepartmentId: string | null): Harness {
    return createHarness({
      departments: departmentRows(),
      users: [
        ...workflowUsers(),
        // Departmentless actor whose level matches the pending row: only the
        // null === null department-membership flaw could authorize them.
        { id: 'null-dept-level2', departmentId: null, level: 2, isActive: true, role: 'general', name: 'Null Dept Level Two', email: 'null-dept-2@example.test' },
      ],
      requests: [baselineRequest({ departmentId: requestDepartmentId, status: 'SentToEngineer' })],
      request_approvals: [
        {
          id: 'pending-1',
          requestId: REQUEST_ID,
          requiredLevel: 2,
          order: 1,
          status: 'pending',
          isCustomChain: false,
          isFinalApproval: false,
        },
      ],
    })
  }

  it('fails closed for a departmentless actor against an organization-owned request (no mutation, no in-app rows, no SMTP)', async () => {
    const harness = orgOwnedHarness(null)
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'null-dept-level2'

    const check = (await harness.approvals.canUserApprove(REQUEST_ID)) as { canApprove: boolean }
    assert.equal(check.canApprove, false, 'null actor department must not match a null request department')

    await assert.rejects(
      () => harness.approvals.approveRequest(REQUEST_ID),
      /cannot approve this request at this time/,
    )

    assert.equal(noDepartmentWrites(harness), 0, 'no write of any kind may occur')
    assert.equal(harness.db.rows.notifications.size, 0)
    assert.equal(harness.state.smtpMessages.length, 0)
  })

  it('still approves a valid department request for a same-department member (guards alter nothing legacy)', async () => {
    const harness = orgOwnedHarness('department-pd')
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'supervisor-1'

    const check = (await harness.approvals.canUserApprove(REQUEST_ID)) as { canApprove: boolean }
    assert.equal(check.canApprove, true)

    const result = (await harness.approvals.approveRequest(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)
    assert.ok(
      harness.db.writes.some(
        (write) => write.model === 'request_approvals' && (write.op === 'update' || write.op === 'updateMany'),
      ),
      'the approval itself must still persist',
    )
  })
})

describe('solution approval boundary: organization-owned request', () => {
  function orgOwnedSolutionHarness(): Harness {
    return createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [
        baselineRequest({ departmentId: null, status: 'DesignCostEstimationApproval' }),
      ],
      solutions: [baselineSolution()],
      solution_approvals: [
        {
          id: 'custom-pending',
          solutionId: SOLUTION_ID,
          requiredApproverId: SCENARIO.customApproverA,
          order: 1,
          status: 'pending',
          isCustomChain: true,
        },
      ],
    })
  }

  it('rejects solution approval before mutation: no writes, no departmentless-user audience, no SMTP', async () => {
    const harness = orgOwnedSolutionHarness()
    enableTestSmtp(harness.state)
    harness.state.authUserId = SCENARIO.customApproverA

    await assert.rejects(
      () => harness.solutions.approveSolution(SOLUTION_ID),
      /cannot approve this solution at this time/,
    )

    assert.equal(noDepartmentWrites(harness), 0)
    assert.equal(harness.db.rows.notifications.size, 0)
    assert.equal(harness.state.smtpMessages.length, 0)
  })
})

describe('final approval boundary: organization-owned request', () => {
  it('initiateFinalApproval fails closed for an organization-owned request before any chain write', { skip: 'B6-fix1: needs B10 clean-start-policy/action-harness (custom/fail-closed attempt-shape), not SNAPSHOT_GROUP seed expansion. Named replacement: tests/regression/clean-start-attempts.test.ts.' }, async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ departmentId: null, status: 'SendBackToRequester' })],
    })
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'null-org-1'

    await assert.rejects(
      () => harness.solutions.initiateFinalApproval(REQUEST_ID, false),
      /Organization-owned requests are not supported by legacy final approval/,
    )
    assert.equal(noDepartmentWrites(harness), 0)
    assert.equal(harness.db.rows.notifications.size, 0)
    assert.equal(harness.state.smtpMessages.length, 0)
  })

  it('approveFinalApproval fails closed for an organization-owned request (custom chain member also rejected)', async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ departmentId: null, status: 'FinalApproval' })],
      request_approvals: [
        {
          id: 'final-custom-pending',
          requestId: REQUEST_ID,
          requiredApproverId: SCENARIO.customApproverA,
          order: 1,
          status: 'pending',
          isCustomChain: true,
          isFinalApproval: true,
        },
      ],
    })
    enableTestSmtp(harness.state)
    harness.state.authUserId = SCENARIO.customApproverA

    await assert.rejects(
      () => harness.solutions.approveFinalApproval(REQUEST_ID),
      /cannot approve this request at this time/,
    )

    assert.equal(noDepartmentWrites(harness), 0)
    assert.equal(harness.db.rows.notifications.size, 0)
    assert.equal(harness.state.smtpMessages.length, 0)
  })
})

describe('department notification boundary', () => {
  it('notifyUsersInDepartment rejects a missing legacy department before any audience query, in-app row, or SMTP send', async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
    })
    enableTestSmtp(harness.state)

    // Focused instrumentation of the fake's real audience read: every
    // prisma.user.findMany the production notification path performs must be
    // observable, so "zero reads" is an observed fact, not an inference from
    // missing side effects.
    const originalUserFindMany = harness.db.user.findMany.bind(harness.db.user)
    let userAudienceReads = 0
    ;(harness.db.user as unknown as { findMany: typeof originalUserFindMany }).findMany = (
      ...args: Parameters<typeof originalUserFindMany>
    ) => {
      userAudienceReads += 1
      return originalUserFindMany(...args)
    }

    await assert.rejects(
      () =>
        harness.notifications.notifyUsersInDepartment(null as unknown as string, {
          type: 'solution_ready',
          title: 'Solution Ready',
          message: 'must never reach departmentless users',
        }),
      /without a legacy department/,
    )

    assert.equal(userAudienceReads, 0, 'no user audience query may run before the null-department rejection')
    assert.equal(harness.db.rows.notifications.size, 0, 'departmentless users must never be queried as an audience')
    assert.equal(harness.state.smtpMessages.length, 0)
    assert.equal(harness.db.rows.user.size, workflowUsers().length, 'no user rows were touched')
  })
})

describe('custom writers persist the explicit CUSTOM_PERSON discriminator (compatibility version 0)', () => {
  it('submitSolution custom chain stores routingMode CUSTOM_PERSON on every created row', { skip: 'B6-fix1: needs B10 clean-start-policy/action-harness (custom/fail-closed attempt-shape), not SNAPSHOT_GROUP seed expansion. Named replacement: tests/regression/clean-start-attempts.test.ts.' }, async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ status: 'SentToEngineer' })],
    })
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'engineer-1'

    const result = (await harness.solutions.submitSolution({
      requestId: REQUEST_ID,
      title: 'Pump retrofit solution',
      description: '<p>Retrofit the coolant pump assembly.</p>',
      inlineImageSessionId: '00000000-0000-4000-8000-000000000099',
      costEstimate: 1500,
      currency: 'THB',
      timeline: '3 weeks',
      useCustomApprovals: true,
      customApproverIds: [SCENARIO.customApproverA, SCENARIO.customApproverB],
    })) as { success: boolean; solutionId: string }
    assert.equal(result.success, true)

    const payload = harness.db.writes.find(
      (write) => write.model === 'solution_approvals' && write.op === 'createMany',
    )
    assert.ok(payload, 'custom chain createMany must be recorded')
    const rows = (payload!.data as Array<Record<string, unknown>>)
    assert.ok(rows.length > 0)
    for (const row of rows) {
      assert.equal(row.routingMode, 'CUSTOM_PERSON', 'custom rows must carry the explicit discriminator')
      assert.equal(
        'integrityVersion' in row,
        false,
        'compatibility rows keep the version-0 default (writers must not raise the version)',
      )
      assert.equal(row.isCustomChain, true)
    }
  })

  it('initiateFinalApproval custom chain stores routingMode CUSTOM_PERSON (level-0 compatibility rows stay version 0)', { skip: 'B6-fix1: needs B10 clean-start-policy/action-harness (custom/fail-closed attempt-shape), not SNAPSHOT_GROUP seed expansion. Named replacement: tests/regression/clean-start-attempts.test.ts.' }, async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ status: 'SendBackToRequester' })],
      solutions: [baselineSolution()],
    })
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'staff-1'

    const result = (await harness.solutions.initiateFinalApproval(
      REQUEST_ID,
      true,
      [SCENARIO.customApproverA, SCENARIO.customApproverB],
    )) as { success: boolean }
    assert.equal(result.success, true)

    const payload = harness.db.writes.find(
      (write) => write.model === 'request_approvals' && write.op === 'createMany',
    )
    assert.ok(payload, 'custom final chain createMany must be recorded')
    const rows = (payload!.data as Array<Record<string, unknown>>)
    assert.ok(rows.length > 0)
    for (const row of rows) {
      assert.equal(row.routingMode, 'CUSTOM_PERSON', 'custom final rows must carry the explicit discriminator')
      assert.equal('integrityVersion' in row, false, 'compatibility rows keep version 0')
      assert.equal(row.requiredLevel, 0, 'historical level-0 marker is preserved unchanged')
    }
  })

  it('resubmitSolution custom chain stores routingMode CUSTOM_PERSON on the rebuilt rows', { skip: 'B6-fix1: needs B10 clean-start-policy/action-harness (custom/fail-closed attempt-shape), not SNAPSHOT_GROUP seed expansion. Named replacement: tests/regression/clean-start-attempts.test.ts.' }, async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ status: 'SentToEngineer' })],
      solutions: [baselineSolution()],
      solution_approvals: [
        {
          id: 'sa-1',
          solutionId: SOLUTION_ID,
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          approverId: SCENARIO.engineeringSupervisorId,
          isCustomChain: false,
        },
      ],
    })
    enableTestSmtp(harness.state)
    harness.state.authUserId = 'engineer-1'

    const result = (await harness.solutions.resubmitSolution({
      requestId: REQUEST_ID,
      title: 'Pump retrofit solution (rev 2)',
      description: '<p>Reworked retrofit plan.</p>',
      inlineImageSessionId: '00000000-0000-4000-8000-000000000098',
      cost: 1750,
      currency: 'THB',
      timeline: '4 weeks',
      useCustomHierarchy: true,
      customApprovers: [SCENARIO.customApproverA, SCENARIO.customApproverB],
    })) as { success: boolean }
    assert.equal(result.success, true)

    const payload = harness.db.writes.find(
      (write) => write.model === 'solution_approvals' && write.op === 'createMany',
    )
    assert.ok(payload, 'rebuilt custom chain createMany must be recorded')
    const rows = (payload!.data as Array<Record<string, unknown>>)
    assert.ok(rows.length > 0)
    for (const row of rows) {
      assert.equal(row.routingMode, 'CUSTOM_PERSON', 'resubmitted custom rows must carry the discriminator')
      assert.equal('integrityVersion' in row, false, 'compatibility rows keep version 0')
    }
  })
})

describe('historical version-0 row shapes remain readable', () => {
  it('getRequestApprovals tolerates custom rows with deleted approvers and legacy rows with null levels', async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ status: 'ImprovementRequest' })],
      request_approvals: [
        {
          // Historical custom row whose designated account was deleted (SetNull).
          id: 'historical-custom',
          requestId: REQUEST_ID,
          requiredApproverId: null,
          requiredLevel: null,
          order: 1,
          status: 'approved',
          isCustomChain: true,
          isFinalApproval: false,
        },
        {
          // Historical hierarchy row with a null level.
          id: 'historical-null-level',
          requestId: REQUEST_ID,
          requiredLevel: null,
          order: 2,
          status: 'pending',
          isCustomChain: false,
          isFinalApproval: false,
        },
      ],
    })
    harness.state.authUserId = 'supervisor-1'

    const result = (await harness.approvals.getRequestApprovals(REQUEST_ID)) as Array<{
      id: string
      eligibleApprovers: Array<{ id: string }>
    }>
    assert.equal(result.length, 2)
    const nullLevelRow = result.find((row) => row.id === 'historical-null-level')
    assert.ok(nullLevelRow)
    assert.equal(
      Array.from(nullLevelRow.eligibleApprovers ?? []).length,
      0,
      'a null-level row has no lookup audience and fails closed to an empty list',
    )
  })
})

function snapshotGroupSeed(input: {
  phase: 'SOLUTION' | 'FINAL'
  actorId: string
  instanceId: string
  groupId: string
  approvalId: string
}): {
  organization_units: Array<Record<string, unknown>>
  approval_instances: Array<Record<string, unknown>>
  approval_candidate_groups: Array<Record<string, unknown>>
  approval_candidate_group_members: Array<Record<string, unknown>>
} {
  return {
    organization_units: [
      { id: 'section-pd1', name: 'PD1', unitType: 'SECTION', operationalType: 'GENERAL', isActive: true },
    ],
    approval_instances: [
      {
        id: input.instanceId,
        requestId: input.phase === 'SOLUTION' ? null : REQUEST_ID,
        solutionId: input.phase === 'SOLUTION' ? SOLUTION_ID : null,
        phase: input.phase,
        originUserId: input.phase === 'SOLUTION' ? 'engineer-1' : 'staff-1',
        originUnitId: 'section-pd1',
        originContext: {},
        routingMode: 'SNAPSHOT_GROUP',
        state: 'PENDING',
        attempt: 1,
        supersededAt: null,
      },
    ],
    approval_candidate_groups: [
      {
        id: input.groupId,
        approvalInstanceId: input.instanceId,
        requiredPosition: 'SUPERVISOR',
        scopeUnitId: 'section-pd1',
      },
    ],
    approval_candidate_group_members: [
      {
        id: `${input.groupId}-member-1`,
        candidateGroupId: input.groupId,
        userId: input.actorId,
        capturedDisplayName: input.actorId,
      },
    ],
  }
}

describe('NEW SNAPSHOT last-row on organization-owned requests (Task 9 fix 1 P0)', () => {
  it('approves the last SNAPSHOT SOLUTION row without department notify or rollback', async () => {
    const actorId = SCENARIO.engineeringSupervisorId
    const snapshot = snapshotGroupSeed({
      phase: 'SOLUTION',
      actorId,
      instanceId: 'instance-sol-snap-1',
      groupId: 'group-sol-snap-1',
      approvalId: 'sa-snap-1',
    })
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ departmentId: null, status: 'DesignCostEstimationApproval' })],
      solutions: [baselineSolution()],
      solution_approvals: [
        {
          id: 'sa-snap-1',
          solutionId: SOLUTION_ID,
          order: 1,
          status: 'pending',
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          instanceId: 'instance-sol-snap-1',
          candidateGroupId: 'group-sol-snap-1',
          requiredPosition: 'SUPERVISOR',
          requiredLevel: null,
          isCustomChain: false,
        },
      ],
      ...snapshot,
    })
    enableTestSmtp(harness.state)
    harness.state.authUserId = actorId

    const result = (await harness.solutions.approveSolution(SOLUTION_ID)) as { success: boolean }
    assert.equal(result.success, true)
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'SendBackToRequester')
    assert.equal(harness.db.rows.solution_approvals.get('sa-snap-1')?.status, 'approved')
    assert.equal(harness.db.rows.approval_instances.get('instance-sol-snap-1')?.state, 'APPROVED')
    assert.equal(harness.db.rows.notifications.size, 0, 'notifications.department must not run for a null department')
    assert.equal(harness.state.smtpMessages.length, 0)
  })

  it('approves the last SNAPSHOT FINAL row without department notify or rollback', async () => {
    const actorId = 'supervisor-1'
    const snapshot = snapshotGroupSeed({
      phase: 'FINAL',
      actorId,
      instanceId: 'instance-final-snap-1',
      groupId: 'group-final-snap-1',
      approvalId: 'fa-snap-1',
    })
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ departmentId: null, status: 'FinalApproval' })],
      request_approvals: [
        {
          id: 'fa-snap-1',
          requestId: REQUEST_ID,
          order: 1,
          status: 'pending',
          isFinalApproval: true,
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          instanceId: 'instance-final-snap-1',
          candidateGroupId: 'group-final-snap-1',
          requiredPosition: 'SUPERVISOR',
          requiredLevel: null,
          isCustomChain: false,
        },
      ],
      ...snapshot,
    })
    enableTestSmtp(harness.state)
    harness.state.authUserId = actorId

    const result = (await harness.solutions.approveFinalApproval(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'Completed')
    assert.equal(harness.db.requestApprovalsForRequest(REQUEST_ID)[0]?.status, 'approved')
    assert.equal(harness.db.rows.approval_instances.get('instance-final-snap-1')?.state, 'APPROVED')
    assert.equal(harness.db.rows.notifications.size, 0, 'notifications.department must not run for a null department')
    assert.equal(harness.state.smtpMessages.length, 0)
  })
})

describe('dashboard blocking counts filter current-instance identity (Task 9 fix 1 P1)', () => {
  it('includes a current SNAPSHOT step when superseded history has a lower pending order', async () => {
    const actorId = 'supervisor-1'
    const author = workflowUsers().find((user) => user.id === actorId)!
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ status: 'ImprovementRequest' })],
      organization_units: [
        { id: 'section-pd1', name: 'PD1', unitType: 'SECTION', operationalType: 'GENERAL', isActive: true },
      ],
      approval_instances: [
        {
          id: 'instance-superseded-dash',
          requestId: REQUEST_ID,
          phase: 'REQUEST',
          originUserId: 'staff-1',
          originUnitId: 'section-pd1',
          originContext: {},
          routingMode: 'SNAPSHOT_GROUP',
          state: 'PENDING',
          attempt: 1,
          supersededAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'instance-current-dash',
          requestId: REQUEST_ID,
          phase: 'REQUEST',
          originUserId: 'staff-1',
          originUnitId: 'section-pd1',
          originContext: {},
          routingMode: 'SNAPSHOT_GROUP',
          state: 'PENDING',
          attempt: 2,
          supersededAt: null,
        },
      ],
      approval_candidate_groups: [
        {
          id: 'group-superseded-dash',
          approvalInstanceId: 'instance-superseded-dash',
          requiredPosition: 'SUPERVISOR',
          scopeUnitId: 'section-pd1',
        },
        {
          id: 'group-current-dash',
          approvalInstanceId: 'instance-current-dash',
          requiredPosition: 'SUPERVISOR',
          scopeUnitId: 'section-pd1',
        },
      ],
      approval_candidate_group_members: [
        {
          id: 'member-superseded-dash',
          candidateGroupId: 'group-superseded-dash',
          userId: actorId,
          capturedDisplayName: 'Supervisor',
        },
        {
          id: 'member-current-dash',
          candidateGroupId: 'group-current-dash',
          userId: actorId,
          capturedDisplayName: 'Supervisor',
        },
      ],
      request_approvals: [
        {
          id: 'a-superseded-order-0',
          requestId: REQUEST_ID,
          order: 0,
          status: 'pending',
          isFinalApproval: false,
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          instanceId: 'instance-superseded-dash',
          candidateGroupId: 'group-superseded-dash',
          requiredPosition: 'SUPERVISOR',
          requiredLevel: null,
        },
        {
          id: 'a-current-order-1',
          requestId: REQUEST_ID,
          order: 1,
          status: 'pending',
          isFinalApproval: false,
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          instanceId: 'instance-current-dash',
          candidateGroupId: 'group-current-dash',
          requiredPosition: 'SUPERVISOR',
          requiredLevel: null,
        },
      ],
    })
    harness.state.authUserId = actorId
    harness.state.currentUser = {
      ...author,
      department: { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' },
    }

    const pending = (await harness.dashboard.getPendingMyApprovals()) as Array<{ id: string }>
    assert.equal(
      pending.filter((row) => row.id === REQUEST_ID).length,
      1,
      'superseded pending order=0 must not hide the current SNAPSHOT order=1 step',
    )
  })
})
