/**
 * Shared requester cancellation policy.
 *
 * Single source of truth used by both the client-side eligibility checks
 * (request modal router, request detail modal) and the authoritative
 * server-side enforcement in `cancelRequest()`.
 *
 * Approved policy:
 * - Only the original requester can cancel.
 * - Cancellation is allowed only in `SentToEngineer` and `SendBackToRequester`.
 * - Cancellation is blocked while any request approval (including final
 *   approval) or any solution approval is pending.
 * - Approvals, solutions, files, engineer assignments, and subtasks are
 *   preserved; only the request status changes to `Cancelled`.
 */

export const CANCELLABLE_REQUEST_STATUSES = [
  'SentToEngineer',
  'SendBackToRequester',
] as const

export type CancellableRequestStatus = (typeof CANCELLABLE_REQUEST_STATUSES)[number]

export function isCancellableRequestStatus(status: string): boolean {
  return CANCELLABLE_REQUEST_STATUSES.includes(status as CancellableRequestStatus)
}

export interface CancellationApprovalSnapshot {
  status?: string | null
}

/**
 * True when any approval in the snapshot is still pending.
 * Callers must pass request approvals (including final approval rows) and
 * solution approvals of the request's solutions.
 */
export function hasPendingApprovals(
  approvals?: readonly CancellationApprovalSnapshot[] | null,
): boolean {
  return Boolean(approvals?.some((approval) => approval?.status === 'pending'))
}

export interface RequesterCancellationCheck {
  userId?: string | null
  requesterId?: string | null
  status?: string | null
  hasPendingRequestApprovals?: boolean
  hasPendingSolutionApprovals?: boolean
}

export type CancellationBlockReason =
  | 'not-requester'
  | 'status-not-cancellable'
  | 'pending-request-approval'
  | 'pending-solution-approval'

export interface RequesterCancellationAllowed {
  canCancel: true
  reason: null
}

export interface RequesterCancellationBlocked {
  canCancel: false
  reason: CancellationBlockReason
}

export type RequesterCancellationDecision =
  | RequesterCancellationAllowed
  | RequesterCancellationBlocked

/**
 * Evaluate whether the current user may cancel the request.
 * Authorization (requester identity) is checked first, then the request
 * status, then pending request/final approvals, then pending solution
 * approvals.
 */
export function evaluateRequesterCancellation(
  check: RequesterCancellationCheck,
): RequesterCancellationDecision {
  if (!check.userId || !check.requesterId || check.userId !== check.requesterId) {
    return { canCancel: false, reason: 'not-requester' }
  }

  if (!check.status || !isCancellableRequestStatus(check.status)) {
    return { canCancel: false, reason: 'status-not-cancellable' }
  }

  if (check.hasPendingRequestApprovals) {
    return { canCancel: false, reason: 'pending-request-approval' }
  }

  if (check.hasPendingSolutionApprovals) {
    return { canCancel: false, reason: 'pending-solution-approval' }
  }

  return { canCancel: true, reason: null }
}

/**
 * Map a block reason to the user-facing rejection message thrown by the
 * authoritative server action.
 */
export function getCancellationBlockedMessage(
  reason: CancellationBlockReason,
  status?: string | null,
): string {
  switch (reason) {
    case 'not-requester':
      return 'Only the requester can cancel their own request'
    case 'status-not-cancellable':
      return `Cannot cancel - request is ${status ?? 'not in a cancellable status'}`
    case 'pending-request-approval':
      return 'Cannot cancel - a request approval is still pending'
    case 'pending-solution-approval':
      return 'Cannot cancel - a solution approval is still pending'
  }
}
