import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Prisma, RequestStatus } from '@prisma/client'
import { getApprovalLevelsAboveSubmitter } from '@/lib/approval-levels'
import { createApprovalChain } from '@/server-actions/approvals'
import {
  approveRequestApproval,
  type RequestApprovalTransactionDb,
} from '@/lib/request-approval-transaction'
import {
  buildRejectedRequestCancellationWhere,
  buildRejectedRequestResubmissionWhere,
  RequestStatusConflictError,
  updateRequestStatusExpecting,
} from '@/lib/request-status-transition'
import {
  evaluateRequesterCancellation,
  getCancellationBlockedMessage,
} from '@/lib/cancellation-policy'
import {
  runTransactionWithPostCommitNotifications,
  type PostCommitNotificationPlan,
} from '@/lib/post-commit-notifications'
import {
  canUserApproveAtLevel,
  canUserSubmitFinalApproval,
  canUserSubmitSolution,
  getAvailableActions,
  isUserAdmin,
  shouldShowActionButton,
} from '@/lib/permission-checks'
import {
  advanceApprovalAtomically,
  canUserApproveFinal,
  canUserApproveRequest,
  canUserApproveSolution,
} from '@/lib/approval-engine/transactions'
import {
  createFinalApprovalAttempt,
  createRequestApprovalAttempt,
  createSolutionApprovalAttempt,
} from '@/lib/approval-engine/phase-adapters'
import {
  evaluateRequestAction,
  existingApprovalDecision,
  type ActionDecision,
  type ActionPermissionContext,
  type RequestAction,
} from '@/lib/action-permissions'
import { resolveApprovalNeededRecipients } from '@/lib/notification-recipients'
import { canViewRequestByPredicate } from '@/lib/request-visibility/predicate'
import type { RequestVisibilityActor } from '@/lib/request-visibility/types'
import {
  LEGACY_CHAIN_EXPECTATIONS,
  LEGACY_NOTIFICATION_EXPECTATIONS,
  ORGANIZATION_APPROVAL_FIXTURE,
  createPhaseAdapterFixture,
  fakeVisibilityDbForPersistedAttempt,
  legacyRequestRows,
  notificationRecipientDbForPersisted,
  phaseStatusExpectation,
} from '../fixtures/organization-approval-fixtures'
import { ApprovalWorkflowDb } from '../fixtures/organization-approval-harness'

const read = (path: string) => readFileSync(path, 'utf8')

// ---------------------------------------------------------------------------
// Shared strict fake (organization-approval-harness): the same in-memory
// database the real server-action tests use. It executes only recognized
// operations and predicate shapes and throws on anything else, so a fake gap
// can never silently permit a write. Writes are recorded for persistence
// assertions.
// ---------------------------------------------------------------------------

type FakeRequestRow = Record<string, unknown>
type FakeRequestApprovalRow = Record<string, unknown>

function seedDb(options: {
  requests?: FakeRequestRow[]
  users?: FakeRequestRow[]
  externalApprovers?: FakeRequestRow[]
  requestApprovals?: FakeRequestApprovalRow[]
  solutions?: FakeRequestApprovalRow[]
  solutionApprovals?: FakeRequestApprovalRow[]
}): ApprovalWorkflowDb {
  const db = new ApprovalWorkflowDb()
  db.seed('requests', options.requests ?? [])
  db.seed('user', options.users ?? [])
  db.seed('department_approvers', options.externalApprovers ?? [])
  db.seed('request_approvals', options.requestApprovals ?? [])
  db.seed('solutions', options.solutions ?? [])
  db.seed('solution_approvals', options.solutionApprovals ?? [])
  return db
}

/** Row-list helpers over the shared fake's tables (vm-realm-safe). */
function activityRows(db: ApprovalWorkflowDb): Array<Record<string, unknown>> {
  return [...db.rows.request_activities.values()]
}

function notificationRows(db: ApprovalWorkflowDb): Array<Record<string, unknown>> {
  return [...db.rows.notifications.values()]
}

const REQUEST = { id: 'r1', requesterId: 'requester-1', title: 'Pump upgrade' } as const

const F = ORGANIZATION_APPROVAL_FIXTURE

/**
 * Runtime-only cast: `createApprovalChain` declares its db parameter as the
 * wide Prisma transaction client, but its body touches only the members this
 * fake implements (user.findFirst, department_approvers.findFirst/findMany,
 * request_approvals.createMany). The behavioral assertions below depend on
 * exactly those members through the real function body.
 */
function asPrismaTx(db: ApprovalWorkflowDb): Parameters<typeof createApprovalChain>[4] {
  return db as unknown as Parameters<typeof createApprovalChain>[4]
}

const baselineStaffing: Array<Record<string, unknown>> = [
  // Baseline PD department staffing: active internal staff at levels 1, 2, 4.
  // Level 3 has only an inactive internal (sparse, skipped); level 5 has no
  // internal staff and is covered by external department approvers. This is
  // scenario data for the fake db only - the fixture stays mapping-free.
  {
    id: F.requesterId,
    departmentId: F.departmentId,
    level: 1,
    isActive: true,
    role: 'general',
    name: 'Baseline Staff',
    email: 'staff-1@example.test',
  },
  {
    id: F.supervisorId,
    departmentId: F.departmentId,
    level: 2,
    isActive: true,
    role: 'general',
    name: 'Baseline Supervisor',
    email: 'supervisor-1@example.test',
  },
  {
    id: F.departmentManagerId,
    departmentId: F.departmentId,
    level: 4,
    isActive: true,
    role: 'general',
    name: 'Baseline Department Manager',
    email: 'department-manager-1@example.test',
  },
  {
    id: F.inactiveCandidateId,
    departmentId: F.departmentId,
    level: 3,
    isActive: false,
    role: 'general',
    name: 'Inactive Candidate',
    email: null,
  },
  {
    id: F.nullOrgUserId,
    departmentId: null,
    level: 1,
    isActive: true,
    role: 'general',
    name: 'Null Org User',
    email: 'null-org-1@example.test',
  },
]

const externalLevel5Approver: Record<string, unknown> = {
  id: 'ext-1',
  departmentId: F.departmentId,
  approverId: F.customCrossCheckApproverId,
  approverLevel: 5,
}

function baselineRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'req-1',
    status: 'ImprovementRequest',
    requesterId: F.requesterId,
    title: 'Baseline pump upgrade',
    departmentId: F.departmentId,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Brief skeleton: occupied legacy ladder, source seams
// ---------------------------------------------------------------------------

describe('organization approval redesign baseline', () => {
  it('records the occupied legacy ladder and preserves sparse-level arithmetic', () => {
    assert.deepEqual(getApprovalLevelsAboveSubmitter(1, 5), [2, 3, 4, 5])
    assert.deepEqual(
      [2, 3, 4, 5].filter((level) => LEGACY_CHAIN_EXPECTATIONS.sparseLevels.includes(level as 3 | 5)),
      LEGACY_CHAIN_EXPECTATIONS.sparseLevels,
    )
  })

  it('records phase origins, custom exceptions, and existing notification seams', () => {
    const requests = read('src/server-actions/requests.ts')
    const solutions = read('src/server-actions/solutions.ts')
    const notifications = read('src/server-actions/notifications.ts')
    assert.match(requests, /createApprovalChain/)
    assert.doesNotMatch(requests, /CustomApprovalPicker|customApproverIds/)
    assert.match(solutions, /createCustomApprovalChain/)
    assert.match(solutions, /createCustomFinalApprovalChain/)
    assert.match(notifications, /notifyUsersInDepartment/)
  })
})

// ---------------------------------------------------------------------------
// Request submit: real createApprovalChain through its existing db seam
// ---------------------------------------------------------------------------

describe('request submit chain creation (createApprovalChain)', () => {
  it('creates pending rows for occupied levels above a level-1 submitter, skipping sparse level 3 and routing level 5 to the external approver', async () => {
    const db = seedDb({
      users: baselineStaffing,
      externalApprovers: [externalLevel5Approver],
    })

    // Real production function; the db is its existing injected parameter.
    const approvals = await db.$transaction((tx) =>
      createApprovalChain('req-1', F.departmentId, 1, F.requesterId, asPrismaTx(tx)),
    )

    // Slim shape shared with later tasks via legacyRequestRows.
    assert.deepEqual(
      approvals.map((row) => ({
        requestId: row.requestId,
        requiredLevel: (row as { requiredLevel: number }).requiredLevel,
        order: (row as { order: number }).order,
        status: (row as { status: string }).status,
      })),
      legacyRequestRows({ requestId: 'req-1', levels: [2, 4, 5] }),
    )

    // Full routing shape: internal levels point at the active internal user,
    // the external level points at the DepartmentApprover's approver.
    assert.deepEqual(
      approvals.map((row) => ({
        requiredLevel: (row as { requiredLevel: number }).requiredLevel,
        requiredApproverId: (row as { requiredApproverId?: string }).requiredApproverId,
      })),
      [
        { requiredLevel: 2, requiredApproverId: F.supervisorId },
        { requiredLevel: 4, requiredApproverId: F.departmentManagerId },
        { requiredLevel: 5, requiredApproverId: F.customCrossCheckApproverId },
      ],
    )
    assert.ok(
      approvals.every((row) => (row as { status: string }).status === 'pending'),
    )

    // The persisted database write, not only the returned array: the recorded
    // createMany arguments and the resulting request_approvals rows.
    const createManyWrite = db.writes
      .filter((w) => w.model === 'request_approvals' && w.op === 'createMany')
      .at(-1)
    assert.ok(createManyWrite)
    assert.deepEqual(
      (createManyWrite!.data as Array<Record<string, unknown>>).map((row) => ({
        requiredLevel: row.requiredLevel,
        requiredApproverId: row.requiredApproverId,
        order: row.order,
        status: row.status,
      })),
      [
        { requiredLevel: 2, requiredApproverId: F.supervisorId, order: 1, status: 'pending' },
        { requiredLevel: 4, requiredApproverId: F.departmentManagerId, order: 2, status: 'pending' },
        { requiredLevel: 5, requiredApproverId: F.customCrossCheckApproverId, order: 3, status: 'pending' },
      ],
    )
    assert.equal(db.rows.request_approvals.size, 3)
  })

  it('auto-approves the chain when the submitter is top-level in the department', async () => {
    // Without the level-5 external approver the department max is 4, so the
    // level-4 department manager is top-level.
    const db = seedDb({ users: baselineStaffing })

    const approvals = await db.$transaction((tx) =>
      createApprovalChain('req-1', F.departmentId, 4, F.departmentManagerId, asPrismaTx(tx)),
    )

    assert.equal(approvals.length, 1)
    const autoRow = approvals[0] as {
      requiredLevel: number
      order: number
      status: string
      approverId?: string
      comments?: string
      approvedAt?: Date
    }
    assert.deepEqual(
      {
        requiredLevel: autoRow.requiredLevel,
        order: autoRow.order,
        status: autoRow.status,
        approverId: autoRow.approverId,
        comments: autoRow.comments,
      },
      {
        requiredLevel: 4,
        order: 1,
        status: 'approved',
        approverId: F.departmentManagerId,
        comments: 'Auto-approved (top-level submitter)',
      },
    )
    assert.ok(autoRow.approvedAt instanceof Date)

    // Persisted write and row, not only the returned array.
    const createManyWrite = db.writes
      .filter((w) => w.model === 'request_approvals' && w.op === 'createMany')
      .at(-1)
    assert.ok(createManyWrite)
    assert.equal(db.rows.request_approvals.size, 1)
    const persistedRow = [...db.rows.request_approvals.values()][0]!
    assert.deepEqual(
      {
        requiredLevel: persistedRow.requiredLevel,
        order: persistedRow.order,
        status: persistedRow.status,
        approverId: persistedRow.approverId,
        comments: persistedRow.comments,
      },
      {
        requiredLevel: 4,
        order: 1,
        status: 'approved',
        approverId: F.departmentManagerId,
        comments: 'Auto-approved (top-level submitter)',
      },
    )
  })
})

// ---------------------------------------------------------------------------
// Request approval progress/completion: real transaction core
// ---------------------------------------------------------------------------

describe('request approval progress and completion (approveRequestApproval)', () => {
  it('commits an intermediate approval without touching the request status and never notifies from the core', async () => {
    const db = seedDb({
      requests: [baselineRequest()],
      users: baselineStaffing,
      requestApprovals: [
        { id: 'a1', requestId: 'req-1', requiredLevel: 2, order: 1, status: 'pending' },
        { id: 'a2', requestId: 'req-1', requiredLevel: 4, order: 2, status: 'pending' },
      ],
    })

    const result = await db.$transaction((tx) =>
      approveRequestApproval(tx, {
        requestId: 'req-1',
        approvalId: 'a1',
        approverId: F.supervisorId,
        requiredLevel: 2,
      }),
    )

    assert.deepEqual(result, { pendingApprovals: 1 })
    assert.equal(db.requests.rows.get('req-1')?.status, 'ImprovementRequest')
    assert.equal(
      activityRows(db).some((a) => a.action === 'status_changed'),
      false,
    )
    // Notifications are the caller's post-commit concern, never the core's.
    assert.deepEqual(notificationRows(db), [])
  })

  it('completes the request-approval phase with the recorded REQUEST transition and status-change activity', async () => {
    const db = seedDb({
      requests: [baselineRequest()],
      users: baselineStaffing,
      requestApprovals: [
        { id: 'a1', requestId: 'req-1', requiredLevel: 2, order: 1, status: 'pending' },
      ],
    })

    const result = await db.$transaction((tx) =>
      approveRequestApproval(tx, {
        requestId: 'req-1',
        approvalId: 'a1',
        approverId: F.supervisorId,
        requiredLevel: 2,
      }),
    )

    assert.deepEqual(result.statusChange, {
      fromStatus: 'ImprovementRequest',
      toStatus: 'SentToEngineer',
      requesterId: F.requesterId,
      title: baselineRequest().title,
    })
    assert.deepEqual(
      {
        from: phaseStatusExpectation('REQUEST').from,
        to: phaseStatusExpectation('REQUEST').to,
      },
      { from: 'ImprovementRequest', to: 'SentToEngineer' },
    )
    assert.equal(db.requests.rows.get('req-1')?.status, 'SentToEngineer')
    assert.deepEqual(
      activityRows(db)
        .filter((a) => a.action === 'status_changed')
        .map((a) => ({ from: a.fromStatus, to: a.toStatus })),
      [{ from: 'ImprovementRequest', to: 'SentToEngineer' }],
    )
  })

  it('walks the full request-approval ladder to Completed', async () => {
    const ladder: ReadonlyArray<readonly [RequestStatus, RequestStatus]> = [
      ['ImprovementRequest', 'SentToEngineer'],
      ['SentToEngineer', 'SendBackToRequester'],
      ['SendBackToRequester', 'Completed'],
    ]
    for (const [fromStatus, toStatus] of ladder) {
      const db = seedDb({
        requests: [baselineRequest({ status: fromStatus })],
        users: baselineStaffing,
        requestApprovals: [
          { id: 'a1', requestId: 'req-1', requiredLevel: 2, order: 1, status: 'pending' },
        ],
      })

      const result = await db.$transaction((tx) =>
        approveRequestApproval(tx, {
          requestId: 'req-1',
          approvalId: 'a1',
          approverId: F.supervisorId,
          requiredLevel: 2,
        }),
      )

      assert.equal(result.statusChange?.fromStatus, fromStatus)
      assert.equal(result.statusChange?.toStatus, toStatus)
      assert.equal(db.requests.rows.get('req-1')?.status, toStatus)
    }
  })

  it('fails closed for a request outside the request-approval ladder and writes nothing', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'FinalApproval' })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: null,
          order: 1,
          status: 'pending',
          isFinalApproval: true,
        },
      ],
    })

    await assert.rejects(
      db.$transaction((tx) =>
        approveRequestApproval(tx, {
          requestId: 'req-1',
          approvalId: 'a1',
          approverId: F.supervisorId,
          requiredLevel: 2,
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )

    assert.equal(db.request_approvals.rows.get('a1')?.status, 'pending')
    assert.deepEqual(activityRows(db), [])
    assert.equal(db.requests.rows.get('req-1')?.status, 'FinalApproval')
  })
})

// ---------------------------------------------------------------------------
// Request cancel / resubmit coordination: real policy and guarded CAS
// ---------------------------------------------------------------------------

describe('request cancel and resubmit coordination', () => {
  it('allows cancellation only for the owner in a cancellable or rejected-ImprovementRequest state', () => {
    assert.deepEqual(
      evaluateRequesterCancellation({
        userId: F.requesterId,
        requesterId: F.requesterId,
        status: 'SentToEngineer',
      }),
      { canCancel: true, reason: null },
    )
    assert.deepEqual(
      evaluateRequesterCancellation({
        userId: F.requesterId,
        requesterId: F.requesterId,
        status: 'ImprovementRequest',
        hasRejectedRequestApproval: true,
      }),
      { canCancel: true, reason: null },
    )
  })

  it('blocks nonowners, wrong statuses, and pending approvals with the production messages', () => {
    const nonowner = evaluateRequesterCancellation({
      userId: F.nullOrgUserId,
      requesterId: F.requesterId,
      status: 'SentToEngineer',
    })
    assert.deepEqual(nonowner, { canCancel: false, reason: 'not-requester' })
    assert.equal(
      getCancellationBlockedMessage(nonowner.reason, 'SentToEngineer'),
      'Only the requester can cancel their own request',
    )

    const wrongStatus = evaluateRequesterCancellation({
      userId: F.requesterId,
      requesterId: F.requesterId,
      status: 'DesignCostEstimationApproval',
    })
    assert.deepEqual(wrongStatus, { canCancel: false, reason: 'status-not-cancellable' })
    assert.equal(
      getCancellationBlockedMessage(wrongStatus.reason, 'DesignCostEstimationApproval'),
      'Cannot cancel - request is DesignCostEstimationApproval',
    )

    assert.deepEqual(
      evaluateRequesterCancellation({
        userId: F.requesterId,
        requesterId: F.requesterId,
        status: 'SentToEngineer',
        hasPendingRequestApprovals: true,
      }),
      { canCancel: false, reason: 'pending-request-approval' },
    )
    assert.deepEqual(
      evaluateRequesterCancellation({
        userId: F.requesterId,
        requesterId: F.requesterId,
        status: 'SendBackToRequester',
        hasPendingSolutionApprovals: true,
      }),
      { canCancel: false, reason: 'pending-solution-approval' },
    )
    assert.equal(
      getCancellationBlockedMessage('pending-solution-approval'),
      'Cannot cancel - a solution approval is still pending',
    )
  })

  it('cancels through the guarded CAS when the rejected-request state matches', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z')
    const db = seedDb({
      requests: [baselineRequest({ updatedAt })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          approverId: F.historicalActorId,
          isFinalApproval: false,
        },
      ],
    })

    await db.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['ImprovementRequest'],
        additionalWhere: buildRejectedRequestCancellationWhere(updatedAt),
        data: { status: 'Cancelled' },
        actionLabel: 'cancel',
      }),
    )

    assert.equal(db.requests.rows.get('req-1')?.status, 'Cancelled')
  })

  it('blocks cancellation while a request or solution approval is pending, via the same CAS', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z')

    const pendingRequestApprovalDb = seedDb({
      requests: [baselineRequest({ updatedAt })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          approverId: F.historicalActorId,
          isFinalApproval: false,
        },
        { id: 'a2', requestId: 'req-1', requiredLevel: 4, order: 2, status: 'pending' },
      ],
    })

    await assert.rejects(
      pendingRequestApprovalDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['ImprovementRequest'],
          additionalWhere: buildRejectedRequestCancellationWhere(updatedAt),
          data: { status: 'Cancelled' },
          actionLabel: 'cancel',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
    assert.equal(pendingRequestApprovalDb.requests.rows.get('req-1')?.status, 'ImprovementRequest')

    // Every OTHER cancellation predicate is satisfied here (a rejected
    // non-final request approval exists, no request approval is pending, the
    // compare-and-set token matches): the pending SOLUTION approval alone
    // blocks the write.
    const pendingSolutionApprovalDb = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester', updatedAt })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          approverId: F.historicalActorId,
          isFinalApproval: false,
        },
      ],
      solutions: [{ id: 'sol-1', requestId: 'req-1', status: 'pending' }],
      solutionApprovals: [
        { id: 's1', solutionId: 'sol-1', requestId: 'req-1', requiredLevel: 2, order: 1, status: 'pending' },
      ],
    })

    await assert.rejects(
      pendingSolutionApprovalDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SendBackToRequester'],
          additionalWhere: buildRejectedRequestCancellationWhere(updatedAt),
          data: { status: 'Cancelled' },
          actionLabel: 'cancel',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
    assert.equal(pendingSolutionApprovalDb.requests.rows.get('req-1')?.status, 'SendBackToRequester')

    // Otherwise-identical scenario with the solution approval cleared: the
    // cancellation now succeeds, proving the pending-solution predicate was
    // the deciding one.
    const solutionClearedDb = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester', updatedAt })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          approverId: F.historicalActorId,
          isFinalApproval: false,
        },
      ],
      solutions: [{ id: 'sol-1', requestId: 'req-1', status: 'pending' }],
      solutionApprovals: [
        { id: 's1', solutionId: 'sol-1', requestId: 'req-1', requiredLevel: 2, order: 1, status: 'rejected' },
      ],
    })

    await solutionClearedDb.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['SendBackToRequester'],
        additionalWhere: buildRejectedRequestCancellationWhere(updatedAt),
        data: { status: 'Cancelled' },
        actionLabel: 'cancel',
      }),
    )
    assert.equal(solutionClearedDb.requests.rows.get('req-1')?.status, 'Cancelled')
  })

  it('loses the cancellation race when a competing transition commits before the guarded write', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z')
    const db = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester', updatedAt })],
      users: baselineStaffing,
    })

    // The guarded CAS is the window between the action's earlier status read
    // and its write. A competing workflow's status change lands inside this
    // transaction before the guarded write, commits independently, and
    // survives this transaction's rollback.
    await assert.rejects(
      db.$transaction(async (tx) => {
        db.commitConcurrently((tables) => {
          const row = tables.requests.rows.get('req-1')
          if (row) row.status = 'DesignCostEstimationApproval'
        })
        await updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SendBackToRequester'],
          data: { status: 'Cancelled' },
          actionLabel: 'cancel',
        })
      }),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )

    assert.equal(db.requests.rows.get('req-1')?.status, 'DesignCostEstimationApproval')
  })

  it('resubmits through the same-status CAS requiring an unchanged token and a rejected approval', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z')
    const db = seedDb({
      requests: [baselineRequest({ updatedAt })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          approverId: F.historicalActorId,
          isFinalApproval: false,
        },
      ],
    })

    const nextUpdatedAt = new Date(Math.max(Date.now(), updatedAt.getTime() + 1))
    await db.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['ImprovementRequest'],
        additionalWhere: buildRejectedRequestResubmissionWhere(updatedAt),
        data: { status: 'ImprovementRequest', updatedAt: nextUpdatedAt },
        actionLabel: 'resubmit request',
      }),
    )

    const row = db.requests.rows.get('req-1')
    assert.equal(row?.status, 'ImprovementRequest')
    assert.equal(row?.updatedAt.getTime(), nextUpdatedAt.getTime())
  })

  it('rejects resubmission for the wrong status and for a consumed compare-and-set token', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z')

    // Wrong status: resubmission only applies during the department approval phase.
    const wrongStatusDb = seedDb({
      requests: [baselineRequest({ status: 'SentToEngineer', updatedAt })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          isFinalApproval: false,
        },
      ],
    })
    await assert.rejects(
      wrongStatusDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['ImprovementRequest'],
          additionalWhere: buildRejectedRequestResubmissionWhere(updatedAt),
          data: { status: 'ImprovementRequest' },
          actionLabel: 'resubmit request',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )

    // Stale token: a concurrent same-status write consumed the compare-and-set.
    const staleTokenDb = seedDb({
      requests: [baselineRequest({ updatedAt: new Date(updatedAt.getTime() + 5_000) })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          isFinalApproval: false,
        },
      ],
    })
    await assert.rejects(
      staleTokenDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['ImprovementRequest'],
          additionalWhere: buildRejectedRequestResubmissionWhere(updatedAt),
          data: { status: 'ImprovementRequest' },
          actionLabel: 'resubmit request',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
  })
})

// ---------------------------------------------------------------------------
// Solution / final phase state machines: the real shared guarded transition
// driven with each action's exact production expected-status sets.
//
// The chain builders and recipient loops for these phases are module-private
// in solutions.ts (no injectable boundary); their stored notification
// contracts live in LEGACY_NOTIFICATION_EXPECTATIONS and are reported as
// residuals. What Task 1 can pin with real logic is the guarded status
// machine every one of those actions writes through.
// ---------------------------------------------------------------------------

describe('solution and final phase guarded transitions', () => {
  it('solution submit accepts only SentToEngineer into DesignCostEstimationApproval', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'SentToEngineer' })],
      users: baselineStaffing,
    })

    await db.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['SentToEngineer'],
        data: { status: 'DesignCostEstimationApproval' },
        actionLabel: 'submit solution',
      }),
    )
    assert.equal(db.requests.rows.get('req-1')?.status, 'DesignCostEstimationApproval')

    const cancelledDb = seedDb({
      requests: [baselineRequest({ status: 'Cancelled' })],
      users: baselineStaffing,
    })
    await assert.rejects(
      cancelledDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SentToEngineer'],
          data: { status: 'DesignCostEstimationApproval' },
          actionLabel: 'submit solution',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
    assert.equal(cancelledDb.requests.rows.get('req-1')?.status, 'Cancelled')
  })

  it('solution resubmit accepts SentToEngineer and DesignCostEstimationApproval origins', async () => {
    for (const origin of ['SentToEngineer', 'DesignCostEstimationApproval'] as const) {
      const db = seedDb({
        requests: [baselineRequest({ status: origin })],
        users: baselineStaffing,
      })

      await db.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SentToEngineer', 'DesignCostEstimationApproval'],
          data: { status: 'SendBackToRequester', updatedAt: new Date() },
          actionLabel: 'resubmit solution',
        }),
      )
      assert.equal(db.requests.rows.get('req-1')?.status, 'SendBackToRequester')
    }

    const cancelledDb = seedDb({
      requests: [baselineRequest({ status: 'Cancelled' })],
      users: baselineStaffing,
    })
    await assert.rejects(
      cancelledDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SentToEngineer', 'DesignCostEstimationApproval'],
          data: { status: 'SendBackToRequester' },
          actionLabel: 'resubmit solution',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
  })

  it('final initiation accepts only SendBackToRequester into FinalApproval or Completed', async () => {
    const hierarchyDb = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester' })],
      users: baselineStaffing,
    })
    await hierarchyDb.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['SendBackToRequester'],
        data: { status: 'FinalApproval' },
        actionLabel: 'initiate final approval',
      }),
    )
    assert.equal(hierarchyDb.requests.rows.get('req-1')?.status, 'FinalApproval')

    const autoDb = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester' })],
      users: baselineStaffing,
    })
    await autoDb.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['SendBackToRequester'],
        data: { status: 'Completed' },
        actionLabel: 'initiate final approval',
      }),
    )
    assert.equal(autoDb.requests.rows.get('req-1')?.status, 'Completed')

    const cancelledDb = seedDb({
      requests: [baselineRequest({ status: 'Cancelled' })],
      users: baselineStaffing,
    })
    await assert.rejects(
      cancelledDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SendBackToRequester'],
          data: { status: 'FinalApproval' },
          actionLabel: 'initiate final approval',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
  })

  it('manual completion accepts only SendBackToRequester into Completed', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester' })],
      users: baselineStaffing,
    })
    await db.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['SendBackToRequester'],
        data: { status: 'Completed' },
        actionLabel: 'mark the request complete',
      }),
    )
    assert.equal(db.requests.rows.get('req-1')?.status, 'Completed')

    const wrongStatusDb = seedDb({
      requests: [baselineRequest({ status: 'DesignCostEstimationApproval' })],
      users: baselineStaffing,
    })
    await assert.rejects(
      wrongStatusDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SendBackToRequester'],
          data: { status: 'Completed' },
          actionLabel: 'mark the request complete',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
  })

  it('pins the stored phase transition expectations to the legacy chain constants', () => {
    assert.deepEqual(phaseStatusExpectation('REQUEST'), LEGACY_CHAIN_EXPECTATIONS.requestCompletion)
    assert.deepEqual(
      phaseStatusExpectation('SOLUTION'),
      LEGACY_CHAIN_EXPECTATIONS.solutionCompletion,
    )
    assert.deepEqual(phaseStatusExpectation('FINAL'), LEGACY_CHAIN_EXPECTATIONS.finalCompletion)
  })
})

// ---------------------------------------------------------------------------
// Post-commit notification channel semantics: real orchestration module
// ---------------------------------------------------------------------------

describe('post-commit notification channel semantics (runTransactionWithPostCommitNotifications)', () => {
  const intermediateApproverNotice = LEGACY_NOTIFICATION_EXPECTATIONS.find(
    (entry) => entry.case === 'solution approval intermediate next approver',
  )
  const completedBroadcast = LEGACY_NOTIFICATION_EXPECTATIONS.find(
    (entry) => entry.case === 'final approval completed department broadcast',
  )

  it('dispatches queued plans only after commit, in order, with payload and exclusion passthrough', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'FinalApproval' })],
      users: baselineStaffing,
    })
    const dispatched: Array<Record<string, unknown>> = []

    const result = await runTransactionWithPostCommitNotifications({
      runTransaction: (work) => db.$transaction((tx) => work(tx)),
      work: async (_tx, notifications) => {
        notifications.user({
          userId: F.supervisorId,
          type: 'approval_needed',
          title: 'Solution Approval Needed',
          message: 'Solution "Baseline solution" needs your approval.',
          requestId: 'req-1',
        })
        notifications.department(
          F.departmentId,
          {
            type: 'approval_granted',
            title: 'Request Completed',
            message: '✅ Request Completed: "Baseline pump upgrade" has been fully approved and completed.',
            requestId: 'req-1',
          },
          [F.engineeringId],
        )
        // The committed workflow write the real actions perform.
        await db.request_activities.create({
          data: { requestId: 'req-1', userId: F.requesterId, action: 'status_changed' },
        })
        return 'committed' as const
      },
      dispatchers: {
        notifyUser: async (notification) => {
          dispatched.push({ target: 'user', notification })
          return notification
        },
        notifyDepartment: async (departmentId, notification, excludeUserIds) => {
          dispatched.push({ target: 'department', departmentId, notification, excludeUserIds })
          return departmentId
        },
      },
    })

    assert.equal(result, 'committed')
    assert.equal(activityRows(db).length, 1)
    assert.deepEqual(dispatched, [
      {
        target: 'user',
        notification: {
          userId: F.supervisorId,
          type: 'approval_needed',
          title: 'Solution Approval Needed',
          message: 'Solution "Baseline solution" needs your approval.',
          requestId: 'req-1',
        },
      },
      {
        target: 'department',
        departmentId: F.departmentId,
        notification: {
          type: 'approval_granted',
          title: 'Request Completed',
          message:
            '✅ Request Completed: "Baseline pump upgrade" has been fully approved and completed.',
          requestId: 'req-1',
        },
        excludeUserIds: [F.engineeringId],
      },
    ])

    // The recorded plans carry the stored expectations for these named cases:
    // event type, recipients, and the completion transition they follow.
    assert.ok(intermediateApproverNotice)
    assert.equal(intermediateApproverNotice.eventType, 'approval_needed')
    assert.equal(intermediateApproverNotice.channel, 'in_app+email')
    assert.deepEqual(intermediateApproverNotice.recipientIds, [F.supervisorId])
    assert.ok(completedBroadcast)
    assert.equal(completedBroadcast.eventType, 'approval_granted')
    assert.equal(completedBroadcast.channel, 'in_app_department_broadcast+email')
    assert.deepEqual(completedBroadcast.transition, {
      from: 'FinalApproval',
      to: 'Completed',
    })
  })

  it('discards every queued plan when the transaction rolls back', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester' })],
      users: baselineStaffing,
    })
    const dispatched: Array<Record<string, unknown>> = []

    await assert.rejects(
      runTransactionWithPostCommitNotifications({
        runTransaction: (work) => db.$transaction((tx) => work(tx)),
        work: async (_tx, notifications) => {
          notifications.user({
            userId: F.requesterId,
            type: 'solution_ready',
            title: 'Solution Ready for Review',
            message: 'Engineering solution for "Baseline pump upgrade" is ready for your review.',
            requestId: 'req-1',
          })
          await db.request_activities.create({
            data: { requestId: 'req-1', userId: F.requesterId, action: 'status_changed' },
          })
          throw new Error('workflow failed after queueing')
        },
        dispatchers: {
          notifyUser: async (notification) => {
            dispatched.push({ target: 'user', notification })
            return notification
          },
          notifyDepartment: async (departmentId, notification) => {
            dispatched.push({ target: 'department', departmentId, notification })
            return departmentId
          },
        },
      }),
      /workflow failed after queueing/,
    )

    assert.deepEqual(dispatched, [])
    assert.deepEqual(activityRows(db), [])
  })

  it('keeps a committed workflow successful when a post-commit dispatch fails', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester' })],
      users: baselineStaffing,
    })
    const dispatchErrors: PostCommitNotificationPlan[] = []

    const result = await runTransactionWithPostCommitNotifications({
      runTransaction: (work) => db.$transaction((tx) => work(tx)),
      work: async (_tx, notifications) => {
        notifications.user({
          userId: F.requesterId,
          type: 'solution_ready',
          title: 'Solution Ready for Review',
          message: 'Engineering solution for "Baseline pump upgrade" is ready for your review.',
          requestId: 'req-1',
        })
        return 'committed' as const
      },
      dispatchers: {
        notifyUser: async () => {
          throw new Error('smtp down')
        },
        notifyDepartment: async (departmentId, notification) => notification && departmentId,
      },
      onDispatchError: (plan) => {
        dispatchErrors.push(plan)
      },
    })

    assert.equal(result, 'committed')
    assert.equal(dispatchErrors.length, 1)
    assert.equal(dispatchErrors[0].target, 'user')
  })
})

// ---------------------------------------------------------------------------
// Viewer vs action authorization (real pure permission helpers)
// ---------------------------------------------------------------------------

describe('numeric and UI permission helpers (permission-checks) — identity-free unit coverage', () => {
  it('compares numeric levels only: higher-or-equal passes and null levels fail, with no identity or assignment semantics', () => {
    assert.equal(canUserApproveAtLevel(4, 2), true)
    assert.equal(canUserApproveAtLevel(2, 2), true)
    assert.equal(canUserApproveAtLevel(2, 4), false)
    assert.equal(canUserApproveAtLevel(null, 2), false)
    assert.equal(canUserApproveAtLevel(undefined, 2), false)
  })

  it('exposes UI action availability: engineering submit availability and absent review actions on SentToEngineer', () => {
    assert.equal(canUserSubmitSolution('ENGINEERING', 'general'), true)
    assert.equal(canUserSubmitSolution(null, 'engineering'), true)
    assert.equal(canUserSubmitSolution(null, 'general'), false)

    const unrelatedGeneralViewer = getAvailableActions(
      'SentToEngineer',
      'general',
      null,
      null,
      F.departmentId,
      1,
      false,
    )
    assert.deepEqual(unrelatedGeneralViewer, {
      canSubmitRequest: true,
      canSubmitSolution: false,
      canReviewRequest: false,
      canReviewSolution: false,
      canSubmitFinalApproval: false,
      canReviewFinalApproval: false,
      canExportPDF: false,
    })

    const engineeringViewer = getAvailableActions(
      'SentToEngineer',
      'engineering',
      'ENGINEERING',
      F.engineeringDepartmentId,
      F.departmentId,
      1,
      false,
    )
    // Engineering can act by submitting a solution, but cannot review the request.
    assert.equal(engineeringViewer.canSubmitSolution, true)
    assert.equal(engineeringViewer.canReviewRequest, false)
    assert.equal(engineeringViewer.canReviewSolution, false)
  })

  it('limits the final-approval UI action to the requester department and hides action buttons without eligibility', () => {
    assert.equal(
      canUserSubmitFinalApproval('u1', 'r1', F.departmentId, F.departmentId),
      true,
    )
    assert.equal(
      canUserSubmitFinalApproval('u1', 'r1', F.engineeringDepartmentId, F.departmentId),
      false,
    )
    assert.equal(canUserSubmitFinalApproval('u1', 'r1', null, F.departmentId), false)

    const unrelatedEngineering = shouldShowActionButton(
      'submit-final-approval',
      'engineering',
      'ENGINEERING',
      F.engineeringDepartmentId,
      F.departmentId,
      'SendBackToRequester',
      false,
    )
    assert.equal(unrelatedEngineering, false)

    const sameDepartmentMember = shouldShowActionButton(
      'submit-final-approval',
      'general',
      null,
      F.departmentId,
      F.departmentId,
      'SendBackToRequester',
      false,
    )
    assert.equal(sameDepartmentMember, true)

    assert.equal(
      shouldShowActionButton('approve', 'general', null, F.departmentId, F.departmentId, 'ImprovementRequest', false),
      false,
    )
    assert.equal(shouldShowActionButton('export-pdf', 'general', null, null, null, 'Completed', false), true)
    assert.equal(shouldShowActionButton('export-pdf', 'general', null, null, null, 'SentToEngineer', false), false)
  })

  it('keeps admin as a system role separate from positions', () => {
    assert.equal(isUserAdmin('admin'), true)
    assert.equal(isUserAdmin('general'), false)
    assert.equal(isUserAdmin('engineering'), false)

    const adminActions = getAvailableActions(
      'ImprovementRequest',
      'admin',
      null,
      F.departmentId,
      F.departmentId,
      1,
      false,
    )
    assert.equal(adminActions.canReviewRequest, true)
    assert.equal(adminActions.canSubmitSolution, true)
    assert.equal(adminActions.canSubmitFinalApproval, true)
  })
})

// ---------------------------------------------------------------------------
// Stored per-case notification contract sanity
// ---------------------------------------------------------------------------

describe('legacy notification expectation matrix', () => {
  it('stores event type, recipients, channel, and transition for every named legacy case with unique ids', () => {
    const cases = LEGACY_NOTIFICATION_EXPECTATIONS.map((entry) => entry.case)
    assert.equal(new Set(cases).size, cases.length)

    for (const entry of LEGACY_NOTIFICATION_EXPECTATIONS) {
      assert.ok(entry.eventType === null || typeof entry.eventType === 'string', entry.case)
      assert.ok(Array.isArray(entry.recipientIds), entry.case)
      assert.ok(entry.recipientsRule.length > 0, entry.case)
      assert.ok(
        ['in_app', 'in_app+email', 'in_app_department_broadcast+email'].includes(entry.channel),
        entry.case,
      )
      assert.ok(
        entry.transition === null ||
          (typeof entry.transition.from === 'string' && typeof entry.transition.to === 'string'),
        entry.case,
      )
      assert.match(
        entry.assertedVia,
        /^(recorded production delivery \(real action \+ notifications module, mocked SMTP\/DB\)|recorded db writes|recorded orchestration dispatch)/,
        entry.case,
      )
    }

    // Phase-specific contracts the redesign must preserve exactly.
    const byCase = (name: string) =>
      LEGACY_NOTIFICATION_EXPECTATIONS.find((entry) => entry.case === name)
    assert.ok(byCase('request submit approval needed'))
    assert.ok(byCase('solution submit custom chain all at submit'))
    assert.ok(byCase('final initiate custom chain first step only'))
    assert.ok(byCase('final approval completed department broadcast'))
    assert.ok(byCase('request cancelled'))
    assert.equal(byCase('request cancelled')?.eventType, null)
    assert.deepEqual(byCase('request cancelled')?.recipientIds, [])
  })
})

// ---------------------------------------------------------------------------
// Task 16 fix-1 cross-layer matrix: the real request/solution/final adapters
// persist snapshot steps, groups, and membership into the fixture store, and
// every downstream layer consumes THAT SAME persisted store — the real
// recipient resolver (return value, not the dispatch event; actual in-app/email
// emission is asserted by the Task 8/10 server-action harnesses), the real
// transaction core for eligibility and advancement, the real visibility
// predicate over the persisted document, and the real action policy composed
// from those actual verdicts. Expectations come from the shared fixture's
// phaseStatusExpectation, never from re-declared constants. The fixture store
// is a mechanical emulation of the Prisma transaction client's persistence;
// SQL locking evidence remains the Task 9/15 CI PostgreSQL suites.
// ---------------------------------------------------------------------------

/** Snapshot candidates captured at creation: one member deactivates afterwards. */
const PENDING_STEP_CANDIDATES = {
  SUPERVISOR: ['supervisor-1', 'inactive-1'],
  SECTION_MANAGER: ['section-manager-1'],
  DEPARTMENT_MANAGER: ['department-manager-1'],
}

/**
 * Actor records for the persisted identities under test plus a same-department
 * peer with no membership, an engineering outsider, and an ancestor manager.
 */
function visibilityActorsForPersisted(
  firstStepMembers: readonly string[],
): Record<string, RequestVisibilityActor> {
  const [firstMember] = firstStepMembers
  return {
    [firstMember!]: {
      id: firstMember!,
      role: 'general_dept',
      isActive: true,
      departmentId: F.departmentId,
      departmentType: 'GENERAL',
      managedUnitIds: [],
    },
    [F.inactiveCandidateId]: {
      id: F.inactiveCandidateId,
      role: 'general_dept',
      isActive: false,
      departmentId: F.departmentId,
      departmentType: 'GENERAL',
      managedUnitIds: [],
    },
    'staff-pd1-peer': {
      id: 'staff-pd1-peer',
      role: 'general_dept',
      isActive: true,
      departmentId: F.departmentId,
      departmentType: 'GENERAL',
      managedUnitIds: [],
    },
    [F.engineeringId]: {
      id: F.engineeringId,
      role: 'engineering',
      isActive: true,
      departmentId: F.engineeringDepartmentId,
      departmentType: 'ENGINEERING',
      managedUnitIds: [],
    },
    [F.departmentManagerId]: {
      id: F.departmentManagerId,
      role: 'general_dept',
      isActive: true,
      departmentId: F.departmentId,
      departmentType: 'GENERAL',
      managedUnitIds: ['department-pd', 'section-pd1'],
    },
  }
}

function capabilityContext(
  action: 'APPROVE_REQUEST' | 'APPROVE_SOLUTION' | 'APPROVE_FINAL',
  status: string,
  input: { actorId: string; role?: string; isActive?: boolean; canView: boolean; canApprove: boolean },
): ActionPermissionContext {
  const existingActionDecisions: Partial<Record<RequestAction, ActionDecision>> = {}
  existingActionDecisions[action] = existingApprovalDecision(input.canApprove)
  return {
    actor: {
      id: input.actorId,
      role: input.role ?? 'general_dept',
      isActive: input.isActive ?? true,
      departmentId: F.departmentId,
      departmentType: 'GENERAL',
    },
    request: {
      requesterId: F.requesterId,
      departmentId: null,
      organizationUnitId: 'section-pd1',
      status,
    },
    canView: input.canView,
    approval: { canApprove: input.canApprove },
    assignedEngineer: false,
    existingActionDecisions,
  }
}

describe('organization approval redesign cross-layer matrix', () => {
  it('covers all phase completion transitions without adding financial routing', () => {
    assert.deepEqual(phaseStatusExpectation('REQUEST'), { from: 'ImprovementRequest', to: 'SentToEngineer' })
    assert.deepEqual(phaseStatusExpectation('SOLUTION'), { from: 'DesignCostEstimationApproval', to: 'SendBackToRequester' })
    assert.deepEqual(phaseStatusExpectation('FINAL'), { from: 'FinalApproval', to: 'Completed' })
  })

  it('REQUEST: persisted membership resolves the approval_needed audience, gates persisted-candidate eligibility and visibility, and completes with the fixture transition', async () => {
    const adapterDb = createPhaseAdapterFixture({
      phase: 'REQUEST',
      planOutcome: 'PENDING',
      originUserId: F.requesterId,
      candidates: PENDING_STEP_CANDIDATES,
    })
    const created = await createRequestApprovalAttempt(adapterDb, { requestId: 'r1', requesterId: F.requesterId })

    // Persisted steps (fixture store: mechanical persistence emulation): one
    // pending SNAPSHOT_GROUP row per ordered route position.
    const rows = adapterDb.approvalRows().sort((a, b) => a.order - b.order)
    assert.deepEqual(
      rows.map((row) => ({
        requestId: row.requestId,
        isFinalApproval: row.isFinalApproval,
        order: row.order,
        requiredPosition: row.requiredPosition,
        requiredLevel: row.requiredLevel,
        requiredApproverId: row.requiredApproverId,
        status: row.status,
        routingMode: row.routingMode,
        integrityVersion: row.integrityVersion,
        hasCandidateGroup: row.candidateGroupId !== null,
      })),
      [
        { requestId: 'r1', isFinalApproval: false, order: 1, requiredPosition: 'SUPERVISOR', requiredLevel: null, requiredApproverId: null, status: 'pending', routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, hasCandidateGroup: true },
        { requestId: 'r1', isFinalApproval: false, order: 2, requiredPosition: 'SECTION_MANAGER', requiredLevel: null, requiredApproverId: null, status: 'pending', routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, hasCandidateGroup: true },
        { requestId: 'r1', isFinalApproval: false, order: 3, requiredPosition: 'DEPARTMENT_MANAGER', requiredLevel: null, requiredApproverId: null, status: 'pending', routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, hasCandidateGroup: true },
      ],
    )

    // Membership the adapter persisted for step 1 (captured active at creation;
    // one member deactivates afterwards, so live checks must drop them).
    const persistedMembers = adapterDb.candidateGroupMembers()
    const firstGroup = rows[0]!.candidateGroupId!
    assert.deepEqual(persistedMembers[firstGroup], [F.supervisorId, F.inactiveCandidateId])

    // Creation emits no phase transition; the store waits at the REQUEST origin.
    assert.equal(created.statusChange, undefined)
    assert.equal(adapterDb.requestStatus(), phaseStatusExpectation('REQUEST').from)
    assert.deepEqual(adapterDb.statusUpdates(), [])

    // Approval-needed audience: the REAL recipient resolver reading the SAME
    // persisted store. This asserts the resolver's RETURN — recipients are the
    // persisted active members of the adapter-created group, inactive dropped.
    // (The dispatched in-app/email events themselves are emitted and asserted
    // by the Task 8/10 server-action harnesses.)
    const audience = await resolveApprovalNeededRecipients(
      notificationRecipientDbForPersisted(adapterDb),
      { approvalId: rows[0]!.id, phase: 'REQUEST' },
    )
    assert.deepEqual(
      [...audience],
      persistedMembers[firstGroup]!.filter((memberId) => memberId !== F.inactiveCandidateId),
    )
    assert.deepEqual([...audience], [F.supervisorId])

    // Eligibility through the real transaction core over the SAME persisted
    // store; actor identities come from the persisted membership itself.
    const txView = adapterDb.approvalTransactionView()
    const [firstCandidate] = persistedMembers[firstGroup]!
    const memberEligibility = await canUserApproveRequest(txView, { approvalId: rows[0]!.id, actorId: firstCandidate! })
    assert.equal(memberEligibility.canApprove, true)

    // A persisted member who has since deactivated fails closed.
    const inactiveEligibility = await canUserApproveRequest(txView, { approvalId: rows[0]!.id, actorId: F.inactiveCandidateId })
    assert.equal(inactiveEligibility.canApprove, false)
    assert.equal(inactiveEligibility.reason, 'INACTIVE_USER')

    // A non-member of the persisted group is not a candidate.
    const outsiderEligibility = await canUserApproveRequest(txView, { approvalId: rows[0]!.id, actorId: F.engineeringId })
    assert.equal(outsiderEligibility.canApprove, false)
    assert.equal(outsiderEligibility.reason, 'NOT_CANDIDATE')

    // A later persisted step is not current while the earlier step is pending
    // (derived from the persisted rows, not a canned response).
    const laterEligibility = await canUserApproveRequest(txView, {
      approvalId: rows[1]!.id,
      actorId: persistedMembers[rows[1]!.candidateGroupId!]![0]!,
    })
    assert.equal(laterEligibility.canApprove, false)
    assert.equal(laterEligibility.reason, 'NOT_CURRENT_STEP')

    // Visibility decisions from the production predicate over the SAME
    // persisted document: the candidate member views through their persisted
    // candidacy, a same-department peer without membership does not, the
    // ancestor manager views through the persisted origin-unit linkage, and the
    // engineering outsider views through the broad engineering read.
    const visDb = await fakeVisibilityDbForPersistedAttempt({
      fixture: adapterDb,
      actors: visibilityActorsForPersisted(persistedMembers[firstGroup]!),
    })
    const candidateView = await canViewRequestByPredicate(visDb, firstCandidate!, 'r1')
    assert.equal(candidateView, true)
    const peerView = await canViewRequestByPredicate(visDb, 'staff-pd1-peer', 'r1')
    assert.equal(peerView, false)
    const managerView = await canViewRequestByPredicate(visDb, F.departmentManagerId, 'r1')
    assert.equal(managerView, true)
    const outsiderView = await canViewRequestByPredicate(visDb, F.engineeringId, 'r1')
    assert.equal(outsiderView, true)

    // Capabilities compose the ACTUAL eligibility and visibility verdicts.
    assert.deepEqual(
      evaluateRequestAction('APPROVE_REQUEST', capabilityContext('APPROVE_REQUEST', 'ImprovementRequest', {
        actorId: firstCandidate!,
        canView: candidateView,
        canApprove: memberEligibility.canApprove,
      })),
      { allowed: true, reason: 'ALLOWED' },
    )
    assert.deepEqual(
      evaluateRequestAction('APPROVE_REQUEST', capabilityContext('APPROVE_REQUEST', 'ImprovementRequest', {
        actorId: F.inactiveCandidateId,
        isActive: false,
        canView: await canViewRequestByPredicate(visDb, F.inactiveCandidateId, 'r1'),
        canApprove: inactiveEligibility.canApprove,
      })),
      { allowed: false, reason: 'INACTIVE' },
    )
    assert.deepEqual(
      evaluateRequestAction('APPROVE_REQUEST', capabilityContext('APPROVE_REQUEST', 'ImprovementRequest', {
        actorId: 'staff-pd1-peer',
        canView: peerView,
        canApprove: (await canUserApproveRequest(txView, { approvalId: rows[0]!.id, actorId: 'staff-pd1-peer' })).canApprove,
      })),
      { allowed: false, reason: 'NOT_VISIBLE' },
    )
    assert.deepEqual(
      evaluateRequestAction('APPROVE_REQUEST', capabilityContext('APPROVE_REQUEST', 'ImprovementRequest', {
        actorId: F.engineeringId,
        role: 'engineering',
        canView: outsiderView,
        canApprove: outsiderEligibility.canApprove,
      })),
      { allowed: false, reason: 'NOT_PENDING_APPROVAL' },
    )

    // Walking the persisted chain in order through the real core: intermediate
    // approvals emit no transition; the last persisted step completes the phase
    // with exactly the fixture transition, written once into the SAME store.
    const advances = []
    for (const row of rows) {
      advances.push(await advanceApprovalAtomically(txView, {
        approvalId: row.id,
        actorId: persistedMembers[row.candidateGroupId!]![0]!,
        phase: 'REQUEST',
      }))
    }
    assert.deepEqual(advances.map((advance) => advance.pendingApprovals), [2, 1, 0])
    assert.deepEqual(
      advances.map((advance) => advance.statusChange ?? null),
      [null, null, { from: phaseStatusExpectation('REQUEST').from, to: phaseStatusExpectation('REQUEST').to }],
    )
    assert.equal(txView.activities().length, rows.length)
    assert.equal(txView.instanceOutcome(rows[0]!.instanceId!), 'APPROVED')
    assert.equal(adapterDb.requestStatus(), phaseStatusExpectation('REQUEST').to)
    assert.deepEqual(adapterDb.statusUpdates(), [
      { from: phaseStatusExpectation('REQUEST').from, to: phaseStatusExpectation('REQUEST').to },
    ])
    assert.ok(adapterDb.approvalRows().every((row) => row.status === 'approved' && row.approverId !== null))
  })

  it('SOLUTION: persisted membership resolves the approval_needed audience, gates persisted-candidate eligibility and visibility, and completes with the fixture transition', async () => {
    const adapterDb = createPhaseAdapterFixture({
      phase: 'SOLUTION',
      planOutcome: 'PENDING',
      originUserId: F.engineeringId,
      candidates: PENDING_STEP_CANDIDATES,
    })
    const created = await createSolutionApprovalAttempt(adapterDb, {
      requestId: 'r1',
      solutionId: 's1',
      submittedById: F.engineeringId,
    })

    // Persisted steps land on solution_approvals; membership is snapshotted.
    const rows = adapterDb.approvalRows().sort((a, b) => a.order - b.order)
    assert.deepEqual(
      rows.map((row) => ({
        solutionId: row.solutionId,
        order: row.order,
        requiredPosition: row.requiredPosition,
        requiredLevel: row.requiredLevel,
        requiredApproverId: row.requiredApproverId,
        status: row.status,
        routingMode: row.routingMode,
        integrityVersion: row.integrityVersion,
        hasCandidateGroup: row.candidateGroupId !== null,
      })),
      [
        { solutionId: 's1', order: 1, requiredPosition: 'SUPERVISOR', requiredLevel: null, requiredApproverId: null, status: 'pending', routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, hasCandidateGroup: true },
        { solutionId: 's1', order: 2, requiredPosition: 'SECTION_MANAGER', requiredLevel: null, requiredApproverId: null, status: 'pending', routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, hasCandidateGroup: true },
        { solutionId: 's1', order: 3, requiredPosition: 'DEPARTMENT_MANAGER', requiredLevel: null, requiredApproverId: null, status: 'pending', routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, hasCandidateGroup: true },
      ],
    )
    const persistedMembers = adapterDb.candidateGroupMembers()
    const firstGroup = rows[0]!.candidateGroupId!
    assert.deepEqual(persistedMembers[firstGroup], [F.supervisorId, F.inactiveCandidateId])

    // Creation moves the store to the status the completion starts from, with a
    // single adapter-owned write.
    assert.deepEqual(created.statusChange, {
      from: 'SentToEngineer',
      to: phaseStatusExpectation('SOLUTION').from,
    })
    assert.equal(adapterDb.requestStatus(), phaseStatusExpectation('SOLUTION').from)
    assert.deepEqual(adapterDb.statusUpdates(), [
      { from: 'SentToEngineer', to: phaseStatusExpectation('SOLUTION').from },
    ])

    // Resolver RETURN over the SAME persisted store: persisted active members,
    // inactive dropped.
    const audience = await resolveApprovalNeededRecipients(
      notificationRecipientDbForPersisted(adapterDb),
      { approvalId: rows[0]!.id, phase: 'SOLUTION' },
    )
    assert.deepEqual(
      [...audience],
      persistedMembers[firstGroup]!.filter((memberId) => memberId !== F.inactiveCandidateId),
    )
    assert.deepEqual([...audience], [F.supervisorId])

    // Eligibility for the adapter's persisted step-1 candidate (supervisor-1,
    // read from the persisted group — never an independently seeded engineer).
    const txView = adapterDb.approvalTransactionView()
    const [firstCandidate] = persistedMembers[firstGroup]!
    const memberEligibility = await canUserApproveSolution(txView, { approvalId: rows[0]!.id, actorId: firstCandidate! })
    assert.equal(memberEligibility.canApprove, true)
    const inactiveEligibility = await canUserApproveSolution(txView, { approvalId: rows[0]!.id, actorId: F.inactiveCandidateId })
    assert.equal(inactiveEligibility.reason, 'INACTIVE_USER')
    // The engineering submitter is NOT a member of the persisted step-1 group.
    const outsiderEligibility = await canUserApproveSolution(txView, { approvalId: rows[0]!.id, actorId: F.engineeringId })
    assert.equal(outsiderEligibility.reason, 'NOT_CANDIDATE')
    const laterEligibility = await canUserApproveSolution(txView, {
      approvalId: rows[1]!.id,
      actorId: persistedMembers[rows[1]!.candidateGroupId!]![0]!,
    })
    assert.equal(laterEligibility.reason, 'NOT_CURRENT_STEP')

    // Visibility over the persisted document: solution approvals map under the
    // request's solutions, so the persisted candidate views and the
    // membership-less peer does not.
    const visDb = await fakeVisibilityDbForPersistedAttempt({
      fixture: adapterDb,
      actors: visibilityActorsForPersisted(persistedMembers[firstGroup]!),
    })
    const candidateView = await canViewRequestByPredicate(visDb, firstCandidate!, 'r1')
    assert.equal(candidateView, true)
    const peerView = await canViewRequestByPredicate(visDb, 'staff-pd1-peer', 'r1')
    assert.equal(peerView, false)
    const managerView = await canViewRequestByPredicate(visDb, F.departmentManagerId, 'r1')
    assert.equal(managerView, true)
    const outsiderView = await canViewRequestByPredicate(visDb, F.engineeringId, 'r1')
    assert.equal(outsiderView, true)

    // Capabilities from the actual verdicts.
    assert.deepEqual(
      evaluateRequestAction('APPROVE_SOLUTION', capabilityContext('APPROVE_SOLUTION', 'DesignCostEstimationApproval', {
        actorId: firstCandidate!,
        canView: candidateView,
        canApprove: memberEligibility.canApprove,
      })),
      { allowed: true, reason: 'ALLOWED' },
    )
    assert.deepEqual(
      evaluateRequestAction('APPROVE_SOLUTION', capabilityContext('APPROVE_SOLUTION', 'DesignCostEstimationApproval', {
        actorId: 'staff-pd1-peer',
        canView: peerView,
        canApprove: (await canUserApproveSolution(txView, { approvalId: rows[0]!.id, actorId: 'staff-pd1-peer' })).canApprove,
      })),
      { allowed: false, reason: 'NOT_VISIBLE' },
    )
    assert.deepEqual(
      evaluateRequestAction('APPROVE_SOLUTION', capabilityContext('APPROVE_SOLUTION', 'DesignCostEstimationApproval', {
        actorId: F.engineeringId,
        role: 'engineering',
        canView: outsiderView,
        canApprove: outsiderEligibility.canApprove,
      })),
      { allowed: false, reason: 'NOT_PENDING_APPROVAL' },
    )

    // Walking the persisted solution chain completes the phase in the store.
    const advances = []
    for (const row of rows) {
      advances.push(await advanceApprovalAtomically(txView, {
        approvalId: row.id,
        actorId: persistedMembers[row.candidateGroupId!]![0]!,
        phase: 'SOLUTION',
      }))
    }
    assert.deepEqual(advances.map((advance) => advance.pendingApprovals), [2, 1, 0])
    assert.deepEqual(
      advances.map((advance) => advance.statusChange ?? null),
      [null, null, { from: phaseStatusExpectation('SOLUTION').from, to: phaseStatusExpectation('SOLUTION').to }],
    )
    assert.equal(adapterDb.requestStatus(), phaseStatusExpectation('SOLUTION').to)
    assert.deepEqual(adapterDb.statusUpdates(), [
      { from: 'SentToEngineer', to: phaseStatusExpectation('SOLUTION').from },
      { from: phaseStatusExpectation('SOLUTION').from, to: phaseStatusExpectation('SOLUTION').to },
    ])
    assert.ok(adapterDb.approvalRows().every((row) => row.status === 'approved' && row.approverId !== null))
  })

  it('FINAL: persisted membership resolves the final_approval_needed audience, gates persisted-candidate eligibility and visibility, and completes with the fixture transition', async () => {
    const adapterDb = createPhaseAdapterFixture({
      phase: 'FINAL',
      planOutcome: 'PENDING',
      originUserId: F.departmentManagerId,
      candidates: PENDING_STEP_CANDIDATES,
    })
    const created = await createFinalApprovalAttempt(adapterDb, {
      requestId: 'r1',
      initiatorId: F.departmentManagerId,
    })

    // Persisted steps stay on request_approvals with isFinalApproval true.
    const rows = adapterDb.approvalRows().sort((a, b) => a.order - b.order)
    assert.deepEqual(
      rows.map((row) => ({
        requestId: row.requestId,
        isFinalApproval: row.isFinalApproval,
        order: row.order,
        requiredPosition: row.requiredPosition,
        requiredLevel: row.requiredLevel,
        requiredApproverId: row.requiredApproverId,
        status: row.status,
        routingMode: row.routingMode,
        integrityVersion: row.integrityVersion,
        hasCandidateGroup: row.candidateGroupId !== null,
      })),
      [
        { requestId: 'r1', isFinalApproval: true, order: 1, requiredPosition: 'SUPERVISOR', requiredLevel: null, requiredApproverId: null, status: 'pending', routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, hasCandidateGroup: true },
        { requestId: 'r1', isFinalApproval: true, order: 2, requiredPosition: 'SECTION_MANAGER', requiredLevel: null, requiredApproverId: null, status: 'pending', routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, hasCandidateGroup: true },
        { requestId: 'r1', isFinalApproval: true, order: 3, requiredPosition: 'DEPARTMENT_MANAGER', requiredLevel: null, requiredApproverId: null, status: 'pending', routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1, hasCandidateGroup: true },
      ],
    )
    const persistedMembers = adapterDb.candidateGroupMembers()
    const firstGroup = rows[0]!.candidateGroupId!
    assert.deepEqual(persistedMembers[firstGroup], [F.supervisorId, F.inactiveCandidateId])

    assert.deepEqual(created.statusChange, {
      from: 'SendBackToRequester',
      to: phaseStatusExpectation('FINAL').from,
    })
    assert.equal(adapterDb.requestStatus(), phaseStatusExpectation('FINAL').from)
    assert.deepEqual(adapterDb.statusUpdates(), [
      { from: 'SendBackToRequester', to: phaseStatusExpectation('FINAL').from },
    ])

    // Resolver RETURN over the SAME persisted store: persisted active members,
    // inactive dropped.
    const audience = await resolveApprovalNeededRecipients(
      notificationRecipientDbForPersisted(adapterDb),
      { approvalId: rows[0]!.id, phase: 'FINAL' },
    )
    assert.deepEqual(
      [...audience],
      persistedMembers[firstGroup]!.filter((memberId) => memberId !== F.inactiveCandidateId),
    )
    assert.deepEqual([...audience], [F.supervisorId])

    // Eligibility over the persisted FINAL rows for the persisted candidate.
    const txView = adapterDb.approvalTransactionView()
    const [firstCandidate] = persistedMembers[firstGroup]!
    const memberEligibility = await canUserApproveFinal(txView, { approvalId: rows[0]!.id, actorId: firstCandidate! })
    assert.equal(memberEligibility.canApprove, true)
    const inactiveEligibility = await canUserApproveFinal(txView, { approvalId: rows[0]!.id, actorId: F.inactiveCandidateId })
    assert.equal(inactiveEligibility.reason, 'INACTIVE_USER')
    const outsiderEligibility = await canUserApproveFinal(txView, { approvalId: rows[0]!.id, actorId: F.engineeringId })
    assert.equal(outsiderEligibility.reason, 'NOT_CANDIDATE')
    const laterEligibility = await canUserApproveFinal(txView, {
      approvalId: rows[1]!.id,
      actorId: persistedMembers[rows[1]!.candidateGroupId!]![0]!,
    })
    assert.equal(laterEligibility.reason, 'NOT_CURRENT_STEP')

    // Visibility over the persisted document and its final-phase approvals.
    const visDb = await fakeVisibilityDbForPersistedAttempt({
      fixture: adapterDb,
      actors: visibilityActorsForPersisted(persistedMembers[firstGroup]!),
    })
    const candidateView = await canViewRequestByPredicate(visDb, firstCandidate!, 'r1')
    assert.equal(candidateView, true)
    const peerView = await canViewRequestByPredicate(visDb, 'staff-pd1-peer', 'r1')
    assert.equal(peerView, false)
    const managerView = await canViewRequestByPredicate(visDb, F.departmentManagerId, 'r1')
    assert.equal(managerView, true)
    const outsiderView = await canViewRequestByPredicate(visDb, F.engineeringId, 'r1')
    assert.equal(outsiderView, true)

    // Capabilities from the actual verdicts.
    assert.deepEqual(
      evaluateRequestAction('APPROVE_FINAL', capabilityContext('APPROVE_FINAL', 'FinalApproval', {
        actorId: firstCandidate!,
        canView: candidateView,
        canApprove: memberEligibility.canApprove,
      })),
      { allowed: true, reason: 'ALLOWED' },
    )
    assert.deepEqual(
      evaluateRequestAction('APPROVE_FINAL', capabilityContext('APPROVE_FINAL', 'FinalApproval', {
        actorId: 'staff-pd1-peer',
        canView: peerView,
        canApprove: (await canUserApproveFinal(txView, { approvalId: rows[0]!.id, actorId: 'staff-pd1-peer' })).canApprove,
      })),
      { allowed: false, reason: 'NOT_VISIBLE' },
    )
    assert.deepEqual(
      evaluateRequestAction('APPROVE_FINAL', capabilityContext('APPROVE_FINAL', 'FinalApproval', {
        actorId: F.engineeringId,
        role: 'engineering',
        canView: outsiderView,
        canApprove: outsiderEligibility.canApprove,
      })),
      { allowed: false, reason: 'NOT_PENDING_APPROVAL' },
    )

    // Walking the persisted final chain completes the phase in the store.
    const advances = []
    for (const row of rows) {
      advances.push(await advanceApprovalAtomically(txView, {
        approvalId: row.id,
        actorId: persistedMembers[row.candidateGroupId!]![0]!,
        phase: 'FINAL',
      }))
    }
    assert.deepEqual(advances.map((advance) => advance.pendingApprovals), [2, 1, 0])
    assert.deepEqual(
      advances.map((advance) => advance.statusChange ?? null),
      [null, null, { from: phaseStatusExpectation('FINAL').from, to: phaseStatusExpectation('FINAL').to }],
    )
    assert.equal(adapterDb.requestStatus(), phaseStatusExpectation('FINAL').to)
    assert.deepEqual(adapterDb.statusUpdates(), [
      { from: 'SendBackToRequester', to: phaseStatusExpectation('FINAL').from },
      { from: phaseStatusExpectation('FINAL').from, to: phaseStatusExpectation('FINAL').to },
    ])
    assert.ok(adapterDb.approvalRows().every((row) => row.status === 'approved' && row.approverId !== null))
  })
})
