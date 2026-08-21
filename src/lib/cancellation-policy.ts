/**
 * Shared requester cancellation policy.
 *
 * Single source of truth used by both the client-side eligibility checks
 * (request modal router, request detail modal) and the authoritative
 * server-side enforcement in `cancelRequest()`.
 *
 * Approved policy:
 * - Only the original requester can cancel.
 * - Cancellation is allowed in `SentToEngineer`, `SendBackToRequester`, and
 *   a rejected `ImprovementRequest` awaiting requester resubmission.
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
  isFinalApproval?: boolean | null
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
  hasRejectedRequestApproval?: boolean
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

  const isRejectedImprovementRequest =
    check.status === 'ImprovementRequest' && check.hasRejectedRequestApproval === true

  if (
    !check.status ||
    (!isCancellableRequestStatus(check.status) && !isRejectedImprovementRequest)
  ) {
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

export interface RequesterCancelControlRequest {
  requesterId?: string | null
  status?: string | null
  approvals?: readonly CancellationApprovalSnapshot[] | null
  /**
   * Server-computed aggregate: any pending solution approval on ANY solution
   * of the request (exposed by getRequest). Matches the authoritative count
   * the server cancellation action performs across all solutions.
   */
  hasPendingSolutionApprovals?: boolean | null
  /** Fallback when the aggregate is unavailable: the newest solution. */
  solutions?: ReadonlyArray<{
    approvals?: readonly CancellationApprovalSnapshot[] | null
  }> | null
}

export interface RequesterCancelControlInput {
  userId?: string | null
  request?: RequesterCancelControlRequest | null
  /**
   * Accepted for call-site symmetry but deliberately ignored: read-only
   * request views (e.g. the follow-up dashboard) suppress other workflow
   * actions, never the requester's own cancel control.
   */
  viewOnly?: boolean | null
}

/**
 * Visibility decision for the requester's cancel control.
 *
 * Cancellation visibility follows the cancellation policy alone:
 * - only the original requester sees the control,
 * - in `SentToEngineer` / `SendBackToRequester`, or in a rejected
 *   `ImprovementRequest` awaiting resubmission,
 * - never while a request (incl. final) approval or ANY solution approval
 *   across the whole request is still pending (server-computed aggregate,
 *   falling back to the newest solution's approvals when absent).
 *
 * `viewOnly` does not participate in this decision. The authoritative
 * re-checks still run in `cancelRequest()`.
 */
export function evaluateRequesterCancelControl(
  input: RequesterCancelControlInput,
): RequesterCancellationDecision {
  const request = input.request ?? {}
  const aggregate = request.hasPendingSolutionApprovals
  const hasPendingSolutionApprovals =
    aggregate ?? hasPendingApprovals(request.solutions?.[0]?.approvals)

  return evaluateRequesterCancellation({
    userId: input.userId,
    requesterId: request.requesterId,
    status: request.status,
    hasRejectedRequestApproval: request.approvals?.some(
      (approval) =>
        approval?.status === 'rejected' && approval?.isFinalApproval !== true,
    ),
    hasPendingRequestApprovals: hasPendingApprovals(request.approvals),
    hasPendingSolutionApprovals,
  })
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
