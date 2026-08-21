import type { Prisma, RequestStatus } from '@prisma/client'

/**
 * Shared guarded request status transition.
 *
 * Every transaction that transitions a request out of a cancellable status -
 * requester cancellation, solution submission/resubmission, manual
 * completion, final approval initiation, and the legacy request-approval
 * status change - must write through `updateRequestStatusExpecting`. Rejected
 * request resubmission also uses it as a same-status compare-and-set so it
 * coordinates with cancellation through the same protocol.
 *
 * The UPDATE is conditional on the row still being in one of the
 * `expectedStatuses` (an expected-status / compare-and-set update). Callers
 * may also supply `additionalWhere` when status alone cannot represent the
 * state being coordinated (for example, rejected approval rows that a
 * concurrent request resubmission removes). Under
 * READ COMMITTED this closes the check-then-act window between a workflow's
 * status read and its status write: if the competing transition (e.g.
 * requester cancellation) committed first, this update matches zero rows
 * and throws, so everything the caller created earlier in the same
 * transaction (solutions, approvals, activities) rolls back instead of
 * overwriting the new status.
 */

/** Minimal structural type satisfied by both `prisma` and a transaction client. */
export interface GuardedRequestStatusDb {
  requests: {
    updateMany(args: Prisma.requestsUpdateManyArgs): Promise<{ count: number }>
  }
}

/**
 * Rejected-request state required by requester cancellation. `updatedAt` is
 * the scalar compare-and-set token shared with same-status resubmission;
 * relation predicates keep the business policy atomic with the status write.
 */
export function buildRejectedRequestCancellationWhere(
  expectedUpdatedAt: Date,
): Prisma.requestsWhereInput {
  return {
    AND: [
      { updatedAt: expectedUpdatedAt },
      {
        approvals: {
          some: { status: 'rejected', isFinalApproval: false },
        },
      },
      { approvals: { none: { status: 'pending' } } },
      {
        solutions: {
          none: { approvals: { some: { status: 'pending' } } },
        },
      },
    ],
  }
}

/** Rejected-request state required before resubmission removes approvals. */
export function buildRejectedRequestResubmissionWhere(
  expectedUpdatedAt: Date,
): Prisma.requestsWhereInput {
  return {
    AND: [
      { updatedAt: expectedUpdatedAt },
      {
        approvals: {
          some: { status: 'rejected', isFinalApproval: false },
        },
      },
    ],
  }
}

/** Thrown when a guarded status transition matched zero rows. */
export class RequestStatusConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RequestStatusConflictError'
  }
}

/**
 * Conditionally update the request status, requiring the row to still be in
 * one of `expectedStatuses`. A zero-row update throws so the caller's
 * transaction rolls back; callers must NOT catch this error inside the
 * transaction.
 */
export async function updateRequestStatusExpecting(
  db: GuardedRequestStatusDb,
  options: {
    requestId: string
    /** Statuses the row may still be in for this transition to apply. */
    expectedStatuses: readonly RequestStatus[]
    /** Additional current-state predicates that must still match atomically. */
    additionalWhere?: Prisma.requestsWhereInput
    data: Prisma.requestsUpdateManyMutationInput
    actionLabel?: string
  },
): Promise<void> {
  const expectedStatusWhere: Prisma.requestsWhereInput = {
    id: options.requestId,
    status: { in: options.expectedStatuses as RequestStatus[] },
  }
  const where: Prisma.requestsWhereInput = options.additionalWhere
    ? { AND: [expectedStatusWhere, options.additionalWhere] }
    : expectedStatusWhere

  const updated = await db.requests.updateMany({
    where,
    data: options.data,
  })

  if (updated.count !== 1) {
    throw new RequestStatusConflictError(
      `Cannot ${options.actionLabel ?? 'update the request'} - the request was changed by someone else. Please refresh and try again.`,
    )
  }
}
