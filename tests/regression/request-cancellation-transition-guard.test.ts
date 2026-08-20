import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { updateRequestStatusExpecting } from '@/lib/request-status-transition'
import { evaluateRequesterCancelControl } from '@/lib/cancellation-policy'

/**
 * Requester cancellation fallback-fix contracts.
 *
 * 1. Transition guard: every workflow that transitions a request OUT OF a
 *    cancellable status (SentToEngineer / SendBackToRequester) must flip the
 *    status through `updateRequestStatusExpecting`, the shared conditional
 *    expected-status update. If the requester's cancellation committed
 *    first, the conditional update matches zero rows and throws so the
 *    caller's transaction rolls back instead of overwriting `Cancelled`.
 *    (The atomic approval core that relies on this guard - the exact
 *    transaction approveRequest runs - is covered by
 *    request-approval-transaction.test.ts.)
 *
 * 2. Requester visibility: the cancel control's visibility follows the
 *    cancellation policy alone. `viewOnly` (set by the follow-up dashboard
 *    for SentToEngineer requests) suppresses other workflow actions but must
 *    never hide the requester's own cancel control.
 *
 * 3. All-solution aggregate: UI cancellation eligibility must use the
 *    server-computed all-solutions pending-approval aggregate instead of
 *    only the newest solution's approvals.
 *
 * Guard tests drive the production function with an in-memory stand-in for
 * the `UPDATE requests SET ... WHERE id = $1 AND status IN (...)` semantics
 * (a mismatching committed status updates zero rows), mirroring READ
 * COMMITTED behavior.
 */

type FakeRequestRow = { id: string; status: string; [key: string]: unknown }

/**
 * Models `UPDATE requests ... WHERE id = $1 AND status IN (...)`: a row whose
 * committed status is not one of the expected statuses is not matched, so
 * the update affects zero rows.
 */
class FakeRequestsTable {
  readonly rows = new Map<string, FakeRequestRow>()

  constructor(rows: FakeRequestRow[] = []) {
    for (const row of rows) this.rows.set(row.id, { ...row })
  }

  async updateMany(args: Prisma.requestsUpdateManyArgs): Promise<{ count: number }> {
    const where = args.where as
      | { id?: string; status?: string | { in?: string[] } }
      | undefined
    if (!where?.id) {
      return { count: 0 }
    }
    const row = this.rows.get(where.id)
    const expected =
      typeof where.status === 'string' ? [where.status] : where.status?.in ?? []
    if (!row || !expected.includes(row.status)) {
      return { count: 0 }
    }
    Object.assign(row, args.data)
    return { count: 1 }
  }
}

const REQUESTER_ID = 'requester-1'

// ---------------------------------------------------------------------------
// 1. Transition guard
// ---------------------------------------------------------------------------

describe('guarded request status transition', () => {
  it('applies the status change while the row is still in the expected status', async () => {
    const requests = new FakeRequestsTable([
      { id: 'r1', status: 'SentToEngineer', projectEstimateCost: 0 },
    ])

    await updateRequestStatusExpecting({ requests }, {
      requestId: 'r1',
      expectedStatuses: ['SentToEngineer'],
      data: { status: 'SendBackToRequester', projectEstimateCost: 500 },
      actionLabel: 'submit solution',
    })

    assert.equal(requests.rows.get('r1')?.status, 'SendBackToRequester')
    assert.equal(requests.rows.get('r1')?.projectEstimateCost, 500)
  })

  it('throws instead of overwriting when cancellation committed first', async () => {
    // Cancellation committed before the sibling workflow's status write:
    // the row is no longer in the status the workflow read beforehand.
    const requests = new FakeRequestsTable([{ id: 'r1', status: 'Cancelled' }])

    await assert.rejects(
      updateRequestStatusExpecting({ requests }, {
        requestId: 'r1',
        expectedStatuses: ['SentToEngineer'],
        data: { status: 'DesignCostEstimationApproval' },
        actionLabel: 'submit solution',
      }),
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
    const requests = new FakeRequestsTable([{ id: 'r1', status: 'SendBackToRequester' }])

    await assert.rejects(
      updateRequestStatusExpecting({ requests }, {
        requestId: 'missing',
        expectedStatuses: ['SendBackToRequester'],
        data: { status: 'Completed' },
        actionLabel: 'mark complete',
      }),
    )
  })

  it('allows the resubmit contract statuses but never a cancelled request', async () => {
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
      await updateRequestStatusExpecting({ requests }, {
        requestId: id,
        expectedStatuses: ['SentToEngineer', 'DesignCostEstimationApproval'],
        data: { status: 'DesignCostEstimationApproval' },
        actionLabel: 'resubmit solution',
      })
    }

    await assert.rejects(
      updateRequestStatusExpecting({ requests }, {
        requestId: 'cancelled',
        expectedStatuses: ['SentToEngineer', 'DesignCostEstimationApproval'],
        data: { status: 'SendBackToRequester' },
        actionLabel: 'resubmit solution',
      }),
    )
    assert.equal(requests.rows.get('cancelled')?.status, 'Cancelled')
  })
})

// ---------------------------------------------------------------------------
// 2. Requester cancel-control visibility (viewOnly-independent)
// ---------------------------------------------------------------------------

describe('requester cancel control visibility', () => {
  it('shows the cancel control for the requester in SentToEngineer even when the modal is view-only', () => {
    // FollowUpDashboard opens SentToEngineer requests with viewOnly=true.
    const decision = evaluateRequesterCancelControl({
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

  it('never lets viewOnly change the cancellation decision', () => {
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
      const withViewOnly = evaluateRequesterCancelControl({
        ...input,
        viewOnly: true,
      })
      const withoutViewOnly = evaluateRequesterCancelControl({
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

  it('blocks cancellation using the all-solutions pending-approval aggregate', () => {
    // An older solution still has a pending approval while the newest
    // solution's approvals are all rejected: the server counts both, so the
    // UI must not offer cancellation.
    const decision = evaluateRequesterCancelControl({
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

  it('falls back to the newest solution approvals when the aggregate is absent', () => {
    const decision = evaluateRequesterCancelControl({
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

  it('blocks pending request approvals and non-requesters regardless of viewOnly', () => {
    assert.deepEqual(
      evaluateRequesterCancelControl({
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
      evaluateRequesterCancelControl({
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
