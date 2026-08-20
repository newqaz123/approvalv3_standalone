import type { Prisma, RequestStatus } from '@prisma/client'

/**
 * Shared guarded request status transition.
 *
 * Every transaction that transitions a request OUT OF a cancellable status
 * (`SentToEngineer` / `SendBackToRequester`) - requester cancellation,
 * solution submission/resubmission, manual completion, final approval
 * initiation, and the legacy request-approval status change - must flip the
 * status through `updateRequestStatusExpecting` so all sides share one
 * coordination protocol.
 *
 * The UPDATE is conditional on the row still being in one of the
 * `expectedStatuses` (an expected-status / compare-and-set update). Under
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
    data: Prisma.requestsUpdateManyMutationInput
    actionLabel?: string
  },
): Promise<void> {
  const updated = await db.requests.updateMany({
    where: {
      id: options.requestId,
      status: { in: options.expectedStatuses as RequestStatus[] },
    },
    data: options.data,
  })

  if (updated.count !== 1) {
    throw new RequestStatusConflictError(
      `Cannot ${options.actionLabel ?? 'update the request'} - the request was changed by someone else. Please refresh and try again.`,
    )
  }
}
