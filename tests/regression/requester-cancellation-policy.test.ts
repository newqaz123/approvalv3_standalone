import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Requester cancellation policy contracts.
 *
 * Approved policy:
 * - Only the original requester can cancel.
 * - Cancellation is allowed only in request statuses SentToEngineer and
 *   SendBackToRequester.
 * - Cancellation is blocked while any request approval (including final
 *   approval) or any solution approval is pending.
 * - Completed, Cancelled, ImprovementRequest, DesignCostEstimationApproval,
 *   and FinalApproval are not cancellable.
 *
 * The production module is loaded dynamically (memoized) so a missing policy
 * surfaces as an assertion failure (missing behavior) instead of crashing the
 * suite with a module-resolution error.
 */
type PolicyModule = {
  CANCELLABLE_REQUEST_STATUSES?: readonly string[]
  isCancellableRequestStatus?: (status: string) => boolean
  hasPendingApprovals?: (
    approvals?: ReadonlyArray<{ status?: string | null }> | null,
  ) => boolean
  evaluateRequesterCancellation?: (check: {
    userId?: string | null
    requesterId?: string | null
    status?: string | null
    hasPendingRequestApprovals?: boolean
    hasPendingSolutionApprovals?: boolean
  }) => { canCancel: boolean; reason: string | null }
  getCancellationBlockedMessage?: (
    reason: string,
    status?: string | null,
  ) => string
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

type Check = Parameters<NonNullable<PolicyModule['evaluateRequesterCancellation']>>[0]

async function evaluate(check: Check) {
  const policy = await loadPolicy()
  return policy?.evaluateRequesterCancellation?.(check)
}

const REQUESTER_ID = 'requester-1'
const eligible = {
  userId: REQUESTER_ID,
  requesterId: REQUESTER_ID,
  hasPendingRequestApprovals: false,
  hasPendingSolutionApprovals: false,
}

describe('requester cancellation policy', () => {
  it('exposes the shared cancellation policy module', async () => {
    const policy = await loadPolicy()
    assert.ok(policy, 'shared cancellation policy module must exist')
    assert.equal(typeof policy?.evaluateRequesterCancellation, 'function')
  })

  it('allows cancellation in SentToEngineer for the requester with no pending approvals', async () => {
    assert.deepEqual(await evaluate({ ...eligible, status: 'SentToEngineer' }), {
      canCancel: true,
      reason: null,
    })
  })

  it('allows cancellation in SendBackToRequester even with fully approved request, solution, and final approval chains', async () => {
    assert.deepEqual(await evaluate({ ...eligible, status: 'SendBackToRequester' }), {
      canCancel: true,
      reason: null,
    })

    // Approved approvals (including approved final approvals) must not block.
    const policy = await loadPolicy()
    assert.equal(
      policy?.hasPendingApprovals?.([
        { status: 'approved' },
        { status: 'approved', isFinalApproval: true } as never,
        { status: 'approved' },
      ]),
      false,
    )
  })

  it('allows cancellation in SentToEngineer when a solution was previously rejected', async () => {
    const policy = await loadPolicy()
    assert.equal(
      policy?.hasPendingApprovals?.([{ status: 'rejected' }, { status: 'rejected' }]),
      false,
    )
    assert.deepEqual(
      await evaluate({ ...eligible, status: 'SentToEngineer', hasPendingSolutionApprovals: false }),
      { canCancel: true, reason: null },
    )
  })

  it('blocks every non-cancellable status', async () => {
    const blockedStatuses = [
      'ImprovementRequest',
      'Completed',
      'Cancelled',
      'DesignCostEstimationApproval',
      'FinalApproval',
    ]
    for (const status of blockedStatuses) {
      assert.deepEqual(
        await evaluate({ ...eligible, status }),
        { canCancel: false, reason: 'status-not-cancellable' },
        `status ${status} must not be cancellable`,
      )
    }
  })

  it('publishes exactly the two cancellable statuses', async () => {
    const policy = await loadPolicy()
    assert.deepEqual(policy?.CANCELLABLE_REQUEST_STATUSES, ['SentToEngineer', 'SendBackToRequester'])
    assert.equal(policy?.isCancellableRequestStatus?.('SentToEngineer'), true)
    assert.equal(policy?.isCancellableRequestStatus?.('SendBackToRequester'), true)
    assert.equal(policy?.isCancellableRequestStatus?.('FinalApproval'), false)
    assert.equal(policy?.isCancellableRequestStatus?.(''), false)
  })

  it('blocks users who are not the original requester', async () => {
    assert.deepEqual(
      await evaluate({ ...eligible, status: 'SentToEngineer', userId: 'someone-else' }),
      { canCancel: false, reason: 'not-requester' },
    )
    assert.deepEqual(
      await evaluate({ ...eligible, status: 'SendBackToRequester', userId: null }),
      { canCancel: false, reason: 'not-requester' },
    )
    assert.deepEqual(
      await evaluate({ ...eligible, status: 'SentToEngineer', userId: undefined }),
      { canCancel: false, reason: 'not-requester' },
    )
  })

  it('blocks when any request approval is pending, including final approvals', async () => {
    const policy = await loadPolicy()

    // A pending final approval row counts as a pending request approval.
    assert.equal(
      policy?.hasPendingApprovals?.([
        { status: 'approved' },
        { status: 'pending', isFinalApproval: true } as never,
      ]),
      true,
    )
    assert.deepEqual(
      await evaluate({ ...eligible, status: 'SendBackToRequester', hasPendingRequestApprovals: true }),
      { canCancel: false, reason: 'pending-request-approval' },
    )
    assert.deepEqual(
      await evaluate({ ...eligible, status: 'SentToEngineer', hasPendingRequestApprovals: true }),
      { canCancel: false, reason: 'pending-request-approval' },
    )
  })

  it('blocks when any solution approval is pending', async () => {
    assert.deepEqual(
      await evaluate({ ...eligible, status: 'SentToEngineer', hasPendingSolutionApprovals: true }),
      { canCancel: false, reason: 'pending-solution-approval' },
    )
    assert.deepEqual(
      await evaluate({ ...eligible, status: 'SendBackToRequester', hasPendingSolutionApprovals: true }),
      { canCancel: false, reason: 'pending-solution-approval' },
    )
  })

  it('treats requester authorization as the first gate before status and pending approvals', async () => {
    assert.deepEqual(
      await evaluate({
        userId: 'someone-else',
        requesterId: REQUESTER_ID,
        status: 'ImprovementRequest',
        hasPendingRequestApprovals: true,
        hasPendingSolutionApprovals: true,
      }),
      { canCancel: false, reason: 'not-requester' },
    )
    assert.deepEqual(
      await evaluate({
        userId: REQUESTER_ID,
        requesterId: REQUESTER_ID,
        status: 'FinalApproval',
        hasPendingRequestApprovals: true,
      }),
      { canCancel: false, reason: 'status-not-cancellable' },
    )
  })

  it('maps block reasons to user-facing server rejection messages', async () => {
    const policy = await loadPolicy()
    assert.equal(
      policy?.getCancellationBlockedMessage?.('not-requester'),
      'Only the requester can cancel their own request',
    )
    assert.equal(
      policy?.getCancellationBlockedMessage?.('status-not-cancellable', 'Completed'),
      'Cannot cancel - request is Completed',
    )
    assert.equal(
      policy?.getCancellationBlockedMessage?.('pending-request-approval'),
      'Cannot cancel - a request approval is still pending',
    )
    assert.equal(
      policy?.getCancellationBlockedMessage?.('pending-solution-approval'),
      'Cannot cancel - a solution approval is still pending',
    )
  })

  it('detects pending approvals tolerantly from approval snapshots', async () => {
    const policy = await loadPolicy()
    assert.equal(policy?.hasPendingApprovals?.(undefined), false)
    assert.equal(policy?.hasPendingApprovals?.(null), false)
    assert.equal(policy?.hasPendingApprovals?.([]), false)
    assert.equal(policy?.hasPendingApprovals?.([{ status: 'approved' }]), false)
    assert.equal(policy?.hasPendingApprovals?.([{ status: 'rejected' }]), false)
    assert.equal(policy?.hasPendingApprovals?.([{ status: 'pending' }]), true)
    assert.equal(
      policy?.hasPendingApprovals?.([{ status: 'approved' }, { status: 'pending' }]),
      true,
    )
  })
})
