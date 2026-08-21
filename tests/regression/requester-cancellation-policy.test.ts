import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateRequesterCancellation,
  getCancellationBlockedMessage,
  hasPendingApprovals,
} from '@/lib/cancellation-policy'

/**
 * Requester cancellation policy contracts.
 *
 * Approved policy:
 * - Only the original requester can cancel.
 * - Cancellation is allowed in SentToEngineer, SendBackToRequester, and a
 *   rejected ImprovementRequest awaiting requester resubmission.
 * - Cancellation is blocked while any request approval (including final
 *   approval) or any solution approval is pending.
 * - An active/non-rejected ImprovementRequest, Completed, Cancelled,
 *   DesignCostEstimationApproval, and FinalApproval are not cancellable.
 */

const REQUESTER_ID = 'requester-1'
const eligible = {
  userId: REQUESTER_ID,
  requesterId: REQUESTER_ID,
  hasPendingRequestApprovals: false,
  hasPendingSolutionApprovals: false,
}

describe('requester cancellation policy', () => {
  it('allows cancellation in SentToEngineer for the requester with no pending approvals', () => {
    assert.deepEqual(evaluateRequesterCancellation({ ...eligible, status: 'SentToEngineer' }), {
      canCancel: true,
      reason: null,
    })
  })

  it('allows the requester to cancel a rejected ImprovementRequest awaiting resubmission', () => {
    assert.deepEqual(
      evaluateRequesterCancellation({
        ...eligible,
        status: 'ImprovementRequest',
        hasRejectedRequestApproval: true,
      }),
      { canCancel: true, reason: null },
    )
  })

  it('blocks an ImprovementRequest that has not been rejected', () => {
    assert.deepEqual(
      evaluateRequesterCancellation({
        ...eligible,
        status: 'ImprovementRequest',
        hasRejectedRequestApproval: false,
      }),
      { canCancel: false, reason: 'status-not-cancellable' },
    )
  })

  it('allows cancellation in SendBackToRequester even with fully approved request, solution, and final approval chains', () => {
    assert.deepEqual(evaluateRequesterCancellation({ ...eligible, status: 'SendBackToRequester' }), {
      canCancel: true,
      reason: null,
    })

    // Approved approvals (including approved final approvals) must not block.
    const approvedChain: Array<{ status?: string | null; isFinalApproval?: boolean }> = [
      { status: 'approved' },
      { status: 'approved', isFinalApproval: true },
      { status: 'approved' },
    ]
    assert.equal(hasPendingApprovals(approvedChain), false)
  })

  it('allows cancellation in SentToEngineer when a solution was previously rejected', () => {
    assert.equal(
      hasPendingApprovals([{ status: 'rejected' }, { status: 'rejected' }]),
      false,
    )
    assert.deepEqual(
      evaluateRequesterCancellation({
        ...eligible,
        status: 'SentToEngineer',
        hasPendingSolutionApprovals: false,
      }),
      { canCancel: true, reason: null },
    )
  })

  it('blocks every non-cancellable status', () => {
    const blockedStatuses = [
      'Completed',
      'Cancelled',
      'DesignCostEstimationApproval',
      'FinalApproval',
    ] as const
    for (const status of blockedStatuses) {
      assert.deepEqual(
        evaluateRequesterCancellation({ ...eligible, status }),
        { canCancel: false, reason: 'status-not-cancellable' },
        `status ${status} must not be cancellable`,
      )
    }
  })

  it('blocks users who are not the original requester', () => {
    assert.deepEqual(
      evaluateRequesterCancellation({ ...eligible, status: 'SentToEngineer', userId: 'someone-else' }),
      { canCancel: false, reason: 'not-requester' },
    )
    assert.deepEqual(
      evaluateRequesterCancellation({ ...eligible, status: 'SendBackToRequester', userId: null }),
      { canCancel: false, reason: 'not-requester' },
    )
    assert.deepEqual(
      evaluateRequesterCancellation({ ...eligible, status: 'SentToEngineer', userId: undefined }),
      { canCancel: false, reason: 'not-requester' },
    )
  })

  it('blocks a rejected ImprovementRequest when any request approval is pending', () => {
    assert.deepEqual(
      evaluateRequesterCancellation({
        ...eligible,
        status: 'ImprovementRequest',
        hasRejectedRequestApproval: true,
        hasPendingRequestApprovals: true,
      }),
      { canCancel: false, reason: 'pending-request-approval' },
    )
  })

  it('blocks when any request approval is pending, including final approvals', () => {
    // A pending final approval row counts as a pending request approval.
    const chainWithPendingFinal: Array<{ status?: string | null; isFinalApproval?: boolean }> = [
      { status: 'approved' },
      { status: 'pending', isFinalApproval: true },
    ]
    assert.equal(hasPendingApprovals(chainWithPendingFinal), true)
    assert.deepEqual(
      evaluateRequesterCancellation({
        ...eligible,
        status: 'SendBackToRequester',
        hasPendingRequestApprovals: true,
      }),
      { canCancel: false, reason: 'pending-request-approval' },
    )
    assert.deepEqual(
      evaluateRequesterCancellation({
        ...eligible,
        status: 'SentToEngineer',
        hasPendingRequestApprovals: true,
      }),
      { canCancel: false, reason: 'pending-request-approval' },
    )
  })

  it('blocks when any solution approval is pending', () => {
    assert.deepEqual(
      evaluateRequesterCancellation({
        ...eligible,
        status: 'SentToEngineer',
        hasPendingSolutionApprovals: true,
      }),
      { canCancel: false, reason: 'pending-solution-approval' },
    )
    assert.deepEqual(
      evaluateRequesterCancellation({
        ...eligible,
        status: 'SendBackToRequester',
        hasPendingSolutionApprovals: true,
      }),
      { canCancel: false, reason: 'pending-solution-approval' },
    )
  })

  it('treats requester authorization as the first gate before status and pending approvals', () => {
    assert.deepEqual(
      evaluateRequesterCancellation({
        userId: 'someone-else',
        requesterId: REQUESTER_ID,
        status: 'ImprovementRequest',
        hasPendingRequestApprovals: true,
        hasPendingSolutionApprovals: true,
      }),
      { canCancel: false, reason: 'not-requester' },
    )
    assert.deepEqual(
      evaluateRequesterCancellation({
        userId: REQUESTER_ID,
        requesterId: REQUESTER_ID,
        status: 'FinalApproval',
        hasPendingRequestApprovals: true,
      }),
      { canCancel: false, reason: 'status-not-cancellable' },
    )
  })

  it('maps block reasons to user-facing server rejection messages', () => {
    assert.equal(
      getCancellationBlockedMessage('not-requester'),
      'Only the requester can cancel their own request',
    )
    assert.equal(
      getCancellationBlockedMessage('status-not-cancellable', 'Completed'),
      'Cannot cancel - request is Completed',
    )
    assert.equal(
      getCancellationBlockedMessage('pending-request-approval'),
      'Cannot cancel - a request approval is still pending',
    )
    assert.equal(
      getCancellationBlockedMessage('pending-solution-approval'),
      'Cannot cancel - a solution approval is still pending',
    )
  })

  it('detects pending approvals tolerantly from approval snapshots', () => {
    assert.equal(hasPendingApprovals(undefined), false)
    assert.equal(hasPendingApprovals(null), false)
    assert.equal(hasPendingApprovals([]), false)
    assert.equal(hasPendingApprovals([{ status: 'approved' }]), false)
    assert.equal(hasPendingApprovals([{ status: 'rejected' }]), false)
    assert.equal(hasPendingApprovals([{ status: 'pending' }]), true)
    assert.equal(
      hasPendingApprovals([{ status: 'approved' }, { status: 'pending' }]),
      true,
    )
  })
})
