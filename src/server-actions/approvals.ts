'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { revalidateRequestViews } from './request-view-invalidation'
import {
  type RequestStatusChangeResult,
} from '@/lib/request-approval-transaction'
import { RequestStatusConflictError } from '@/lib/request-status-transition'
import { markCurrentInstanceOutcome, CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/phase-adapters'
import {
  advanceApprovalAtomically,
  canUserApproveRequest,
  createPrismaApprovalTransactionDb,
} from '@/lib/approval-engine/transactions'
import {
  createPrismaNotificationRecipientDb,
  mapEventRecipients,
  resolveApprovalNeededRecipients,
} from '@/lib/notification-recipients'
import {
  evaluateRequestAction,
  existingApprovalDecision,
} from '@/lib/action-permissions'
import { requireAdmin } from '@/lib/auth'
import { APPROVAL_ENGINE_TRANSACTION_ISOLATION } from '@/lib/approval-engine/plan'
import {
  createCleanStartPhaseAttemptTx,
  previewReplacementChain as previewReplacementChainOnPorts,
  restartStrandedAttempt as restartStrandedAttemptOnPorts,
  type CleanStartAttemptStore,
  type ReplacementChainPreview,
  type RestartAttemptRecord,
  type RestartStrandedPorts,
} from '@/lib/approval-engine/attempts'

export type { ReplacementChainPreview }

/**
 * Check if data is stale based on updatedAt timestamp
 * Uses 1-second tolerance to account for database precision
 */
function isStaleData(currentUpdatedAt: Date, expectedUpdatedAt?: string | Date): boolean {
  if (!expectedUpdatedAt) return false
  const diff = Math.abs(currentUpdatedAt.getTime() - new Date(expectedUpdatedAt).getTime())
  return diff > 1000 // 1-second tolerance for database precision
}

function approvalTx(db: Prisma.TransactionClient | typeof prisma): Prisma.TransactionClient {
  return db as Prisma.TransactionClient
}

export async function canUserApprove(
  requestId: string
): Promise<{ canApprove: boolean; approval?: any }> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    return { canApprove: false }
  }

  // Current pending REQUEST step only: superseded history is never actionable.
  const approval = await prisma.request_approvals.findFirst({
    where: {
      requestId,
      status: 'pending',
      isFinalApproval: false,
      OR: [...CURRENT_INSTANCE_ROW_FILTER],
    },
    orderBy: { order: 'asc' },
    include: {
      request: {
        select: {
          status: true,
        },
      },
    },
  })

  if (!approval) {
    return { canApprove: false }
  }

  const eligibility = await canUserApproveRequest(
    createPrismaApprovalTransactionDb(approvalTx(prisma)),
    { approvalId: approval.id, actorId: userId },
  )

  return { canApprove: eligibility.canApprove, approval: eligibility.canApprove ? approval : undefined }
}

/**
 * Approve a request approval
 */
export async function approveRequest(
  requestId: string,
  comments?: string,
  expectedUpdatedAt?: string | Date
) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  const { canApprove, approval } = await canUserApprove(requestId)
  const approveAction = evaluateRequestAction('APPROVE_REQUEST', {
    actor: { id: userId, role: '', isActive: true, assignmentUnitId: null },
    request: {
      requesterId: '',
      organizationUnitId: null,
      status: approval?.request?.status ?? '',
    },
    canView: true,
    approval: { canApprove },
    assignedEngineer: false,
    existingActionDecisions: {
      APPROVE_REQUEST: existingApprovalDecision(Boolean(canApprove && approval)),
    },
  })
  if (!approveAction.allowed || !canApprove || !approval) {
    throw new Error('You cannot approve this request at this time')
  }

  // Check for stale data if expectedUpdatedAt is provided
  if (expectedUpdatedAt) {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.' }
    }
  }

  // Approve atomically through the race-safe transaction core: the
  // conditional pending update, activity, remaining-pending count, guarded
  // status transition, and instance outcome commit together. Notifications
  // are planned only by the winner and dispatched after commit.
  const result = await prisma.$transaction((tx) =>
    advanceApprovalAtomically(createPrismaApprovalTransactionDb(tx), {
      approvalId: approval.id,
      actorId: userId,
      phase: 'REQUEST',
      comments,
    }),
  )

  // Notifications stay outside the transaction: they fire only on the
  // committed result, so a rolled-back approval never notifies anyone.
  if (result.statusChange) {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { requesterId: true, title: true },
    })
    if (request) {
      const statusChange: RequestStatusChangeResult = {
        fromStatus: result.statusChange.from,
        toStatus: result.statusChange.to,
        requesterId: request.requesterId,
        title: request.title,
      }
      await notifyRequestStatusChange(requestId, statusChange)
    }
  } else if (result.pendingApprovals > 0) {
    await notifyNextApprover(requestId)
  }

  revalidateRequestViews()
  return { success: true }
}

/**
 * Reject a request approval
 */
export async function rejectRequest(
  requestId: string,
  comments: string,
  expectedUpdatedAt?: string | Date
) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  const { canApprove, approval } = await canUserApprove(requestId)
  const rejectAction = evaluateRequestAction('REJECT_REQUEST', {
    actor: { id: userId, role: '', isActive: true, assignmentUnitId: null },
    request: {
      requesterId: '',
      organizationUnitId: null,
      status: approval?.request?.status ?? '',
    },
    canView: true,
    approval: { canApprove },
    assignedEngineer: false,
    existingActionDecisions: {
      REJECT_REQUEST: existingApprovalDecision(Boolean(canApprove && approval)),
    },
  })
  if (!rejectAction.allowed || !canApprove || !approval) {
    throw new Error('You cannot reject this request at this time')
  }

  if (!comments) {
    throw new Error('Comments are required when rejecting')
  }

  // Check for stale data if expectedUpdatedAt is provided
  if (expectedUpdatedAt) {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.' }
    }
  }

  // Reject atomically: the matched row, the audit activity, the remaining
  // current pending rows, and the current instance's REJECTED outcome commit
  // together; a failure rolls all of it back.
  await prisma.$transaction(async (tx) => {
    const rejected = await tx.request_approvals.updateMany({
      where: {
        id: approval.id,
        status: 'pending',
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
      data: {
        approverId: userId,
        status: 'rejected',
        comments,
        approvedAt: new Date(),
      },
    })
    if (rejected.count !== 1) {
      throw new RequestStatusConflictError(
        'Cannot reject this request - it was changed by someone else. Please refresh and try again.',
      )
    }

    await tx.request_activities.create({
      data: {
        requestId,
        userId,
        action: 'rejected',
        comments,
      },
    })

    // Mark all remaining CURRENT approvals as rejected; superseded history
    // is never rewritten.
    await tx.request_approvals.updateMany({
      where: {
        requestId,
        status: 'pending',
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
      data: {
        status: 'rejected',
      },
    })

    // Record the outcome on the current REQUEST instance (PENDING only) so
    // no further action can target it. No new notification events here.
    await markCurrentInstanceOutcome(tx, { requestId, phase: 'REQUEST', outcome: 'REJECTED' })
  })

  // Notify requester of rejection with reason (post-commit)
  const { createNotification } = await import('./notifications')
  const rejectedRequest = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { title: true, requesterId: true },
  })

  if (rejectedRequest) {
    const recipients = mapEventRecipients({
      type: 'approval_rejected',
      requesterId: rejectedRequest.requesterId,
      decidedActorId: userId,
    })
    await Promise.all(
      recipients.map((recipientId) =>
        createNotification({
          userId: recipientId,
          type: 'approval_rejected',
          title: 'Request Rejected',
          message: `❌ Request Rejected: Your request "${rejectedRequest.title}" has been rejected. Reason: "${comments}"`,
          requestId,
        }),
      ),
    )
  }

  revalidateRequestViews()
  return { success: true }
}

/**
 * Notify about a status change that the approval transaction committed.
 *
 * Event mapping (O2): status_changed → requester only. The former
 * engineering-department task broadcast is removed (N1).
 * Runs only after the approval transaction committed, so notifications
 * never escape a rolled-back approval.
 */
async function notifyRequestStatusChange(
  requestId: string,
  change: RequestStatusChangeResult,
) {
  const recipients = mapEventRecipients({
    type: 'status_changed',
    requesterId: change.requesterId,
  })
  for (const userId of recipients) {
    await prisma.notifications.create({
      data: {
        userId,
        type: 'status_changed',
        title: 'Request Status Changed',
        message: `Your request status changed to ${change.toStatus}`,
        requestId,
      },
    })
  }
}

/**
 * Notify next approver in chain — current-step active candidates only
 * (plus custom requiredApproverId). Live department/level holders,
 * visibility descendants, and ancestor managers are never a substitute.
 */
async function notifyNextApprover(requestId: string) {
  const nextApproval = await prisma.request_approvals.findFirst({
    where: {
      requestId,
      status: 'pending',
      OR: [...CURRENT_INSTANCE_ROW_FILTER],
    },
    orderBy: { order: 'asc' },
    include: {
      request: {
        select: {
          title: true,
        },
      },
    },
  })

  if (!nextApproval) return

  const recipients = await resolveApprovalNeededRecipients(
    createPrismaNotificationRecipientDb(prisma),
    { approvalId: nextApproval.id, phase: nextApproval.isFinalApproval ? 'FINAL' : 'REQUEST' },
  )
  const { createNotification } = await import('./notifications')
  await Promise.all(
    recipients.map((userId) =>
      createNotification({
        userId,
        type: 'approval_needed',
        title: 'Approval Needed',
        message: `Request "${nextApproval.request.title}" needs your approval`,
        requestId,
      }),
    ),
  )
}

/**
 * Get approval status for a request with eligible approvers
 */
export async function getRequestApprovals(requestId: string) {
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { id: true },
  })

  if (!request) {
    return []
  }

  const approvals = await prisma.request_approvals.findMany({
    where: { requestId },
    include: {
      approver: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      requiredApprover: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      candidateGroup: {
        select: {
          members: {
            select: { userId: true, capturedDisplayName: true },
            take: 3,
          },
        },
      },
    },
    orderBy: { order: 'asc' },
  })

  return approvals.map((approval) => ({
    ...approval,
    eligibleApprovers: approval.status === 'pending'
      ? (approval.candidateGroup?.members ?? []).map((member) => ({
          id: member.userId,
          name: member.capturedDisplayName,
          level: null,
        }))
      : [],
  }))
}

function createProductionRestartPorts(
  db: Prisma.TransactionClient | typeof prisma,
  requireAdminFn: () => Promise<string | null>,
): RestartStrandedPorts {
  return {
    requireAdmin: requireAdminFn,
    async loadAttemptForRestart(instanceId) {
      const instance = await db.approval_instances.findUnique({
        where: { id: instanceId },
        include: {
          candidateGroups: {
            include: { members: true },
          },
        },
      })
      if (!instance) return null
      const userIds = [...new Set(instance.candidateGroups.flatMap((group) => group.members.map((member) => member.userId)))]
      const users = userIds.length === 0
        ? []
        : await db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, isActive: true },
          })
      const active = new Map(users.map((user) => [user.id, user.isActive]))
      const record: RestartAttemptRecord = {
        id: instance.id,
        phase: instance.phase,
        requestId: instance.requestId,
        solutionId: instance.solutionId,
        originUserId: instance.originUserId,
        attempt: instance.attempt,
        state: instance.state,
        supersededAt: instance.supersededAt,
        candidateGroups: instance.candidateGroups.map((group) => ({
          members: group.members.map((member) => ({
            userId: member.userId,
            user: { isActive: active.get(member.userId) === true },
          })),
        })),
      }
      return record
    },
    attemptTx: createCleanStartPhaseAttemptTx(db as unknown as CleanStartAttemptStore),
    request_activities: {
      create: (args) => db.request_activities.create({
        data: {
          userId: args.data.userId,
          action: args.data.action,
          comments: args.data.comments ?? undefined,
          ...(args.data.requestId ? { requestId: args.data.requestId } : {}),
        },
      }),
    },
  }
}

export async function previewReplacementChain(input: { instanceId: string }): Promise<ReplacementChainPreview> {
  const adminId = await requireAdmin()
  if (!adminId) throw new Error('Admin access required')
  return previewReplacementChainOnPorts(
    createProductionRestartPorts(prisma, async () => adminId),
    input,
  )
}

export async function restartStrandedAttempt(input: { instanceId: string; reason: string }): Promise<{ oldInstanceId: string; newInstanceId: string }> {
  const adminId = await requireAdmin()
  if (!adminId) throw new Error('Admin access required')
  const result = await prisma.$transaction(
    (tx) => restartStrandedAttemptOnPorts(
      createProductionRestartPorts(tx, async () => adminId),
      input,
    ),
    { isolationLevel: APPROVAL_ENGINE_TRANSACTION_ISOLATION },
  )
  revalidateRequestViews()
  return result
}
