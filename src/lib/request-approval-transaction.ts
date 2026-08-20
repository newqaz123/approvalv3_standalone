import type { Prisma, RequestStatus } from '@prisma/client'
import { updateRequestStatusExpecting } from './request-status-transition'

/**
 * Atomic request-approval core used by `approveRequest()`.
 *
 * The legacy flow committed the approval row update and its audit activity
 * first, then separately performed the guarded status transition. When the
 * requester's cancellation won that race, the guarded update threw AFTER the
 * approval writes had permanently committed, leaving a cancelled request
 * with an approved approval row and approval activities.
 *
 * This core runs inside one Prisma transaction: the approval mutation, the
 * approved activity, the remaining-pending count, the guarded status
 * transition, and the status-change activity all commit together, using the
 * transaction client throughout. A status conflict (e.g. cancellation
 * committed first) makes the guarded update throw inside the transaction,
 * so every write rolls back. The caller sends notifications only after this
 * core commits, based on the returned committed result.
 */

/** Minimal structural type satisfied by both `prisma` and a transaction client. */
export interface RequestApprovalTransactionDb {
  requests: {
    findUnique(args: {
      where: { id: string }
      select: { status: true; requesterId: true; title: true }
    }): Promise<{ status: RequestStatus; requesterId: string; title: string } | null>
    updateMany(args: Prisma.requestsUpdateManyArgs): Promise<{ count: number }>
  }
  request_approvals: {
    update(args: {
      where: { id: string }
      data: {
        approverId: string
        status: 'approved'
        comments?: string
        approvedAt: Date
      }
    }): Promise<unknown>
    count(args: { where: { requestId: string; status: 'pending' } }): Promise<number>
  }
  request_activities: {
    create(args: {
      data: {
        requestId: string
        userId: string
        action: string
        comments?: string | null
        fromStatus?: RequestStatus | null
        toStatus?: RequestStatus | null
      }
    }): Promise<unknown>
  }
}

/** Committed status transition, for the caller's post-commit notifications. */
export interface RequestStatusChangeResult {
  fromStatus: RequestStatus
  toStatus: RequestStatus
  requesterId: string
  title: string
}

export interface ApproveRequestApprovalResult {
  /** Pending request approvals remaining after this one committed. */
  pendingApprovals: number
  /**
   * Present when approving this approval completed the chain and the guarded
   * status transition committed. Absent when approvals remain pending, the
   * request row disappeared, or the status is outside the legacy
   * request-approval ladder (in which case no transition happens).
   */
  statusChange?: RequestStatusChangeResult
}

/** Legacy request-approval status ladder (see the former changeRequestStatus). */
function nextRequestStatusAfterApproval(status: RequestStatus): RequestStatus | null {
  switch (status) {
    case 'ImprovementRequest':
      return 'SentToEngineer'
    case 'SentToEngineer':
      return 'SendBackToRequester'
    case 'SendBackToRequester':
      return 'Completed'
    default:
      return null
  }
}

/**
 * Approve one request approval and, when it completes the approval chain,
 * perform the guarded status transition - atomically.
 *
 * Must run inside a transaction (e.g. `prisma.$transaction((tx) =>
 * approveRequestApproval(tx, ...))`). Throws `RequestStatusConflictError`
 * from the guarded transition when a competing transition (e.g. requester
 * cancellation) committed first; the caller must let the transaction roll
 * back everything this core wrote.
 */
export async function approveRequestApproval(
  db: RequestApprovalTransactionDb,
  input: {
    requestId: string
    approvalId: string
    approverId: string
    requiredLevel: number
    comments?: string
  },
): Promise<ApproveRequestApprovalResult> {
  // Approve the approval row
  await db.request_approvals.update({
    where: { id: input.approvalId },
    data: {
      approverId: input.approverId,
      status: 'approved',
      comments: input.comments,
      approvedAt: new Date(),
    },
  })

  // Log activity
  await db.request_activities.create({
    data: {
      requestId: input.requestId,
      userId: input.approverId,
      action: 'approved',
      comments: input.comments || `Approved at level ${input.requiredLevel}`,
    },
  })

  // Check if this was the last approval
  const pendingApprovals = await db.request_approvals.count({
    where: {
      requestId: input.requestId,
      status: 'pending',
    },
  })

  if (pendingApprovals > 0) {
    return { pendingApprovals }
  }

  const request = await db.requests.findUnique({
    where: { id: input.requestId },
    select: { status: true, requesterId: true, title: true },
  })

  if (!request) {
    return { pendingApprovals }
  }

  const newStatus = nextRequestStatusAfterApproval(request.status)

  if (!newStatus) {
    return { pendingApprovals }
  }

  // Shared expected-status guard: if the requester's cancellation committed
  // after the read above, this matches zero rows and throws, rolling back
  // the approval write and activities with it instead of overwriting
  // `Cancelled`.
  await updateRequestStatusExpecting(db, {
    requestId: input.requestId,
    expectedStatuses: [request.status],
    data: { status: newStatus },
    actionLabel: 'approve the request',
  })

  // Log status change
  await db.request_activities.create({
    data: {
      requestId: input.requestId,
      userId: request.requesterId,
      action: 'status_changed',
      fromStatus: request.status,
      toStatus: newStatus,
      comments: `Status changed from ${request.status} to ${newStatus}`,
    },
  })

  return {
    pendingApprovals,
    statusChange: {
      fromStatus: request.status,
      toStatus: newStatus,
      requesterId: request.requesterId,
      title: request.title,
    },
  }
}
