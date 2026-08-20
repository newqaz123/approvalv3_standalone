import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Requester cancellation fallback-fix contracts.
 *
 * Review findings covered here (RED -> GREEN):
 *
 * 1. Transition guard: every workflow that transitions a request OUT OF a
 *    cancellable status (SentToEngineer / SendBackToRequester) - solution
 *    submission/resubmission, manual completion, final approval initiation,
 *    and the legacy request-approval status change - must use a conditional
 *    expected-status update. If the requester's cancellation committed first,
 *    the conditional update matches zero rows and MUST throw so everything
 *    created in the same transaction (solutions, approvals, activities)
 *    rolls back instead of overwriting `Cancelled`.
 *
 * 2. Requester visibility: the cancel control's visibility follows the
 *    cancellation policy alone. `viewOnly` (set by the follow-up dashboard
 *    for SentToEngineer requests) suppresses other workflow actions but must
 *    never hide the requester's own cancel control.
 *
 * 3. All-solution aggregate: the server cancellation action counts pending
 *    solution approvals across ALL solutions of the request, so UI
 *    eligibility must use that same aggregate instead of only the newest
 *    solution's approvals.
 *
 * Tests drive real extracted behavior with an in-memory stand-in for the
 * `UPDATE requests SET ... WHERE id = $1 AND status = $2` semantics (a
 * mismatching committed status updates zero rows), mirroring READ COMMITTED
 * behavior. Production modules are imported dynamically (memoized) so a
 * missing export surfaces as an assertion failure, not a suite crash.
 */

// ---------------------------------------------------------------------------
// In-memory stand-ins
// ---------------------------------------------------------------------------

type FakeRequestRow = { id: string; status: string; [key: string]: unknown }

/**
 * Models `UPDATE requests ... WHERE id = $1 AND status IN (...)`:
 * a row whose committed status is not one of the expected statuses is not
 * matched, so the update affects zero rows.
 */
class FakeRequestsTable {
  readonly rows = new Map<string, FakeRequestRow>()

  constructor(rows: FakeRequestRow[] = []) {
    for (const row of rows) this.rows.set(row.id, { ...row })
  }

  async updateMany(args: {
    where: { id: string; status: string | { in: string[] } }
    data: Record<string, unknown>
  }): Promise<{ count: number }> {
    const row = this.rows.get(args.where.id)
    const expected =
      typeof args.where.status === 'string'
        ? [args.where.status]
        : args.where.status.in
    if (!row || !expected.includes(row.status)) {
      return { count: 0 }
    }
    Object.assign(row, args.data)
    return { count: 1 }
  }
}

interface BufferedCreate {
  collection: 'solutions' | 'solution_approvals' | 'request_activities'
  row: Record<string, unknown>
}

/**
 * Minimal transactional harness: rows created inside `runInTransaction` are
 * buffered and only committed when the callback resolves. A throw discards
 * the buffer, mirroring `prisma.$transaction` rollback, which is the
 * behavior the guarded transition relies on ("throw inside the transaction
 * so all created approvals/solutions/activities roll back").
 */
class FakeTransactionalDb {
  readonly requests = new FakeRequestsTable()
  readonly committed: Record<string, Record<string, unknown>[]> = {
    solutions: [],
    solution_approvals: [],
    request_activities: [],
  }
  private buffer: BufferedCreate[] = []

  async runInTransaction<T>(
    fn: (tx: {
      requests: FakeRequestsTable
      create: (
        collection: BufferedCreate['collection'],
        row: Record<string, unknown>,
      ) => Promise<void>
    }) => Promise<T>,
  ): Promise<T> {
    this.buffer = []
    try {
      const result = await fn({
        requests: this.requests,
        create: async (collection, row) => {
          this.buffer.push({ collection, row })
        },
      })
      for (const write of this.buffer) {
        this.committed[write.collection].push(write.row)
      }
      return result
    } catch (error) {
      this.buffer = []
      throw error
    }
  }
}

// ---------------------------------------------------------------------------
// Module loaders (missing modules must fail assertions, not crash the suite)
// ---------------------------------------------------------------------------

type GuardModule = {
  updateRequestStatusExpecting?: (
    db: unknown,
    options: {
      requestId: string
      expectedStatuses: readonly string[]
      data: Record<string, unknown>
      actionLabel?: string
    },
  ) => Promise<void>
}

let cachedGuard: GuardModule | null | undefined

async function loadGuard(): Promise<GuardModule | null> {
  if (cachedGuard === undefined) {
    cachedGuard = await import('@/lib/request-status-transition').then(
      (mod) => mod as GuardModule,
      () => null,
    )
  }
  return cachedGuard
}

type PolicyModule = {
  evaluateRequesterCancelControl?: (input: {
    userId?: string | null
    request?:
      | {
          requesterId?: string | null
          status?: string | null
          approvals?: ReadonlyArray<{ status?: string | null }> | null
          hasPendingSolutionApprovals?: boolean | null
          solutions?: ReadonlyArray<{
            approvals?: ReadonlyArray<{ status?: string | null }> | null
          }> | null
        }
      | null
    viewOnly?: boolean | null
  }) => { canCancel: boolean; reason: string | null }
}

let cachedPolicy: PolicyModule | null | undefined

async function loadPolicy(): Promise<PolicyModule | null> {
  if (cachedPolicy === undefined) {
    cachedPolicy = await import('@/lib/cancellation-policy').then(
      (mod) => mod as PolicyModule,
      () => null,
    )
  }
  return cachedPolicy
}

const REQUESTER_ID = 'requester-1'

// ---------------------------------------------------------------------------
// 1. Transition guard
// ---------------------------------------------------------------------------

describe('guarded request status transition', () => {
  it('exposes the shared expected-status transition guard', async () => {
    const guard = await loadGuard()
    assert.ok(guard, 'src/lib/request-status-transition must exist')
    assert.equal(
      typeof guard?.updateRequestStatusExpecting,
      'function',
      'updateRequestStatusExpecting must be exported',
    )
  })

  it('applies the status change while the row is still in the expected status', async () => {
    const guard = await loadGuard()
    assert.ok(guard, 'guard module must exist')
    const requests = new FakeRequestsTable([
      { id: 'r1', status: 'SentToEngineer', projectEstimateCost: 0 },
    ])

    await guard!.updateRequestStatusExpecting!(
      { requests },
      {
        requestId: 'r1',
        expectedStatuses: ['SentToEngineer'],
        data: { status: 'SendBackToRequester', projectEstimateCost: 500 },
        actionLabel: 'submit solution',
      },
    )

    assert.equal(requests.rows.get('r1')?.status, 'SendBackToRequester')
    assert.equal(requests.rows.get('r1')?.projectEstimateCost, 500)
  })

  it('throws instead of overwriting when cancellation committed first', async () => {
    const guard = await loadGuard()
    assert.ok(guard, 'guard module must exist')
    // Cancellation committed before the sibling workflow's status write:
    // the row is no longer in the status the workflow read beforehand.
    const requests = new FakeRequestsTable([{ id: 'r1', status: 'Cancelled' }])

    await assert.rejects(
      guard!.updateRequestStatusExpecting!(
        { requests },
        {
          requestId: 'r1',
          expectedStatuses: ['SentToEngineer'],
          data: { status: 'DesignCostEstimationApproval' },
          actionLabel: 'submit solution',
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /changed by someone else|refresh/i)
        return true
      },
    )

    // The cancelled request must remain cancelled.
    assert.equal(requests.rows.get('r1')?.status, 'Cancelled')
  })

  it('throws when the request no longer exists', async () => {
    const guard = await loadGuard()
    assert.ok(guard, 'guard module must exist')
    const requests = new FakeRequestsTable([{ id: 'r1', status: 'SendBackToRequester' }])

    await assert.rejects(
      guard!.updateRequestStatusExpecting!(
        { requests },
        {
          requestId: 'missing',
          expectedStatuses: ['SendBackToRequester'],
          data: { status: 'Completed' },
          actionLabel: 'mark complete',
        },
      ),
    )
  })

  it('allows the resubmit contract statuses but never a cancelled request', async () => {
    const guard = await loadGuard()
    assert.ok(guard, 'guard module must exist')
    // resubmitSolution legitimately runs from SentToEngineer (rejected
    // solution / rejected final approval) and from the legacy
    // DesignCostEstimationApproval-with-rejection route - but never from a
    // request the requester already cancelled.
    const requests = new FakeRequestsTable([
      { id: 'from-engineer', status: 'SentToEngineer' },
      { id: 'from-approval', status: 'DesignCostEstimationApproval' },
      { id: 'cancelled', status: 'Cancelled' },
    ])

    for (const id of ['from-engineer', 'from-approval']) {
      await guard!.updateRequestStatusExpecting!(
        { requests },
        {
          requestId: id,
          expectedStatuses: ['SentToEngineer', 'DesignCostEstimationApproval'],
          data: { status: 'DesignCostEstimationApproval' },
          actionLabel: 'resubmit solution',
        },
      )
    }

    await assert.rejects(
      guard!.updateRequestStatusExpecting!(
        { requests },
        {
          requestId: 'cancelled',
          expectedStatuses: ['SentToEngineer', 'DesignCostEstimationApproval'],
          data: { status: 'SendBackToRequester' },
          actionLabel: 'resubmit solution',
        },
      ),
    )
    assert.equal(requests.rows.get('cancelled')?.status, 'Cancelled')
  })
})

// ---------------------------------------------------------------------------
// 2. Sibling workflow rollback contract
// ---------------------------------------------------------------------------

describe('sibling workflow rollback contract', () => {
  async function runSiblingWorkflow(
    db: FakeTransactionalDb,
    guard: GuardModule,
    options: { requestId: string; fromStatus: string; toStatus: string },
  ) {
    // Mirrors the shape of submitSolution's transaction: rows are created
    // first, the status flip is the guarded step, and a zero-row update
    // must abort the whole transaction.
    await db.runInTransaction(async (tx) => {
      await tx.create('solutions', { id: 'sol-1', requestId: options.requestId })
      await tx.create('solution_approvals', {
        id: 'sa-1',
        solutionId: 'sol-1',
        status: 'pending',
      })
      await guard.updateRequestStatusExpecting!(tx, {
        requestId: options.requestId,
        expectedStatuses: [options.fromStatus],
        data: { status: options.toStatus },
        actionLabel: 'submit solution',
      })
      await tx.create('request_activities', {
        requestId: options.requestId,
        action: 'solution_submitted',
      })
    })
  }

  it('rolls back created solutions/approvals/activities when cancellation wins the race', async () => {
    const guard = await loadGuard()
    assert.ok(guard, 'guard module must exist')
    const db = new FakeTransactionalDb()
    db.requests.rows.set('r1', { id: 'r1', status: 'Cancelled' })

    await assert.rejects(
      runSiblingWorkflow(db, guard!, {
        requestId: 'r1',
        fromStatus: 'SentToEngineer',
        toStatus: 'DesignCostEstimationApproval',
      }),
    )

    // The zero-row transition threw inside the transaction, so every row the
    // workflow created must be rolled back and the request stays cancelled.
    assert.deepEqual(db.committed.solutions, [])
    assert.deepEqual(db.committed.solution_approvals, [])
    assert.deepEqual(db.committed.request_activities, [])
    assert.equal(db.requests.rows.get('r1')?.status, 'Cancelled')
  })

  it('commits the workflow when the request is still in the cancellable status', async () => {
    const guard = await loadGuard()
    assert.ok(guard, 'guard module must exist')
    const db = new FakeTransactionalDb()
    db.requests.rows.set('r1', { id: 'r1', status: 'SentToEngineer' })

    await runSiblingWorkflow(db, guard!, {
      requestId: 'r1',
      fromStatus: 'SentToEngineer',
      toStatus: 'DesignCostEstimationApproval',
    })

    assert.equal(db.committed.solutions.length, 1)
    assert.equal(db.committed.solution_approvals.length, 1)
    assert.equal(db.committed.request_activities.length, 1)
    assert.equal(db.requests.rows.get('r1')?.status, 'DesignCostEstimationApproval')
  })
})

// ---------------------------------------------------------------------------
// 3. Requester cancel-control visibility (viewOnly-independent)
// ---------------------------------------------------------------------------

describe('requester cancel control visibility', () => {
  it('exposes the cancel-control visibility helper', async () => {
    const policy = await loadPolicy()
    assert.ok(policy, 'cancellation policy module must exist')
    assert.equal(
      typeof policy?.evaluateRequesterCancelControl,
      'function',
      'evaluateRequesterCancelControl must be exported by the cancellation policy',
    )
  })

  it('shows the cancel control for the requester in SentToEngineer even when the modal is view-only', async () => {
    const policy = await loadPolicy()
    assert.ok(policy, 'policy module must exist')
    // FollowUpDashboard opens SentToEngineer requests with viewOnly=true.
    const decision = policy!.evaluateRequesterCancelControl!({
      userId: REQUESTER_ID,
      request: {
        requesterId: REQUESTER_ID,
        status: 'SentToEngineer',
        approvals: [],
        hasPendingSolutionApprovals: false,
      },
      viewOnly: true,
    })
    assert.deepEqual(decision, { canCancel: true, reason: null })
  })

  it('never lets viewOnly change the cancellation decision', async () => {
    const policy = await loadPolicy()
    assert.ok(policy, 'policy module must exist')

    const cases = [
      {
        userId: REQUESTER_ID,
        request: {
          requesterId: REQUESTER_ID,
          status: 'SendBackToRequester',
          approvals: [],
          hasPendingSolutionApprovals: false,
        },
      },
      {
        userId: REQUESTER_ID,
        request: {
          requesterId: REQUESTER_ID,
          status: 'SentToEngineer',
          approvals: [{ status: 'pending' }],
          hasPendingSolutionApprovals: false,
        },
      },
      {
        userId: 'someone-else',
        request: {
          requesterId: REQUESTER_ID,
          status: 'SentToEngineer',
          approvals: [],
          hasPendingSolutionApprovals: false,
        },
      },
    ]

    for (const input of cases) {
      const withViewOnly = policy!.evaluateRequesterCancelControl!({
        ...input,
        viewOnly: true,
      })
      const withoutViewOnly = policy!.evaluateRequesterCancelControl!({
        ...input,
        viewOnly: false,
      })
      assert.deepEqual(
        withViewOnly,
        withoutViewOnly,
        'viewOnly must not affect cancellation visibility',
      )
    }
  })

  it('blocks cancellation using the all-solutions pending-approval aggregate', async () => {
    const policy = await loadPolicy()
    assert.ok(policy, 'policy module must exist')
    // An older solution still has a pending approval while the newest
    // solution's approvals are all rejected: the server counts both, so the
    // UI must not offer cancellation.
    const decision = policy!.evaluateRequesterCancelControl!({
      userId: REQUESTER_ID,
      request: {
        requesterId: REQUESTER_ID,
        status: 'SentToEngineer',
        approvals: [],
        hasPendingSolutionApprovals: true,
        solutions: [{ approvals: [{ status: 'rejected' }, { status: 'rejected' }] }],
      },
      viewOnly: false,
    })
    assert.deepEqual(decision, { canCancel: false, reason: 'pending-solution-approval' })
  })

  it('falls back to the newest solution approvals when the aggregate is absent', async () => {
    const policy = await loadPolicy()
    assert.ok(policy, 'policy module must exist')
    const decision = policy!.evaluateRequesterCancelControl!({
      userId: REQUESTER_ID,
      request: {
        requesterId: REQUESTER_ID,
        status: 'SendBackToRequester',
        approvals: [],
        hasPendingSolutionApprovals: undefined,
        solutions: [{ approvals: [{ status: 'pending' }] }],
      },
    })
    assert.deepEqual(decision, { canCancel: false, reason: 'pending-solution-approval' })
  })

  it('blocks pending request approvals and non-requesters regardless of viewOnly', async () => {
    const policy = await loadPolicy()
    assert.ok(policy, 'policy module must exist')

    assert.deepEqual(
      policy!.evaluateRequesterCancelControl!({
        userId: REQUESTER_ID,
        request: {
          requesterId: REQUESTER_ID,
          status: 'SendBackToRequester',
          approvals: [{ status: 'pending' }],
          hasPendingSolutionApprovals: false,
        },
        viewOnly: true,
      }),
      { canCancel: false, reason: 'pending-request-approval' },
    )

    assert.deepEqual(
      policy!.evaluateRequesterCancelControl!({
        userId: 'someone-else',
        request: {
          requesterId: REQUESTER_ID,
          status: 'SentToEngineer',
          approvals: [],
          hasPendingSolutionApprovals: false,
        },
        viewOnly: true,
      }),
      { canCancel: false, reason: 'not-requester' },
    )
  })
})
