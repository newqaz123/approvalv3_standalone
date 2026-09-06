'use server'

import { auth } from '@/lib/auth-config'
import {
  getApprovalLevelsAboveSubmitter,
  MAX_APPROVAL_LEVEL,
  MIN_APPROVAL_LEVEL,
  normalizePersistedApprovalLevel,
  validateApprovalLevel,
} from '@/lib/approval-levels'
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
  resolveApprovalNeededRecipients,
} from '@/lib/notification-recipients'
import {
  evaluateRequestAction,
  existingApprovalDecision,
} from '@/lib/action-permissions'

/**
 * Check if data is stale based on updatedAt timestamp
 * Uses 1-second tolerance to account for database precision
 */
function isStaleData(currentUpdatedAt: Date, expectedUpdatedAt?: string | Date): boolean {
  if (!expectedUpdatedAt) return false
  const diff = Math.abs(currentUpdatedAt.getTime() - new Date(expectedUpdatedAt).getTime())
  return diff > 1000 // 1-second tolerance for database precision
}

/**
 * Get max level in a department (considers both internal users and external DepartmentApprovers)
 */
async function getMaxLevelInDepartment(
  departmentId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const [maxUser, maxExternal] = await Promise.all([
    db.user.findFirst({
      where: {
        departmentId,
        isActive: true,
        level: { gte: MIN_APPROVAL_LEVEL, lte: MAX_APPROVAL_LEVEL },
      },
      orderBy: { level: 'desc' },
      select: { level: true },
    }),
    db.department_approvers.findFirst({
      where: {
        departmentId,
        approverLevel: { gte: MIN_APPROVAL_LEVEL, lte: MAX_APPROVAL_LEVEL },
      },
      orderBy: { approverLevel: 'desc' },
      select: { approverLevel: true },
    }),
  ])

  const internalMax = normalizePersistedApprovalLevel(maxUser?.level) ?? 0
  const externalMax = normalizePersistedApprovalLevel(maxExternal?.approverLevel) ?? 0
  return Math.max(internalMax, externalMax, MIN_APPROVAL_LEVEL)
}

/**
 * Create approval chain for a request
 * Business rule:
 * - Level 1 (entry-level): needs approval from ALL levels above (LV2, LV3, LV4, LV5...)
 * - Level 2+: needs approval from ALL levels above (LV3, LV4, LV5...)
 * - Skip levels that have no active users
 * - Top-level: auto-approved
 */
export async function createApprovalChain(
  requestId: string,
  departmentId: string,
  submitterLevel: number,
  submitterId?: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const maxLevel = validateApprovalLevel(await getMaxLevelInDepartment(departmentId, db))
  const normalizedSubmitter =
    normalizePersistedApprovalLevel(submitterLevel) ?? MIN_APPROVAL_LEVEL

  const approvals = []
  let order = 1

  // If submitter is top-level, create auto-approved self-approval
  if (normalizedSubmitter >= maxLevel) {
    approvals.push({
      requestId,
      requiredLevel: maxLevel,
      order: 1,
      status: 'approved' as const,
      approverId: submitterId,
      approvedAt: new Date(),
      comments: 'Auto-approved (top-level submitter)',
    })
  } else {
    // Create approvals for ALL levels between submitter's level and max level
    // Example: LV2 submitter → needs LV3, LV4, LV5 approvals (sequential)
    for (const level of getApprovalLevelsAboveSubmitter(normalizedSubmitter, maxLevel)) {
      const requiredLevel = validateApprovalLevel(level)

      // Check if there are active approvers at this level (internal or external)
      // Also get one internal user ID to use as requiredApprover for display purposes
      const [internalUser, externalApprovers] = await Promise.all([
        db.user.findFirst({
          where: {
            departmentId,
            level: requiredLevel,
            isActive: true,
          },
          select: { id: true },
        }),
        db.department_approvers.findMany({
          where: { departmentId, approverLevel: requiredLevel },
          select: { id: true, approverId: true },
        }),
      ])

      // Only create approval if there are approvers at this level
      if (internalUser || externalApprovers.length > 0) {
        // If there are external DepartmentApprovers, create one approval per external approver
        // Otherwise, create a single approval for any internal user at that level
        if (externalApprovers.length > 0) {
          // Create one approval for each external DepartmentApprover
          for (const externalApprover of externalApprovers) {
            approvals.push({
              requestId,
              requiredLevel,
              requiredApproverId: externalApprover.approverId,
              order: order++,
              status: 'pending' as const,
            })
          }
        } else if (internalUser) {
          // Only internal users at this level - set requiredApproverId to any user at this level
          // This enables displaying the approver name in the UI
          approvals.push({
            requestId,
            requiredLevel,
            requiredApproverId: internalUser.id,
            order: order++,
            status: 'pending' as const,
          })
        }
      }
    }
  }

  if (approvals.length > 0) {
    await db.request_approvals.createMany({ data: approvals })
  }

  return approvals
}

/**
 * Get users who can approve at a specific level
 * Includes both internal (User.level) and external (DepartmentApprover) approvers
 */
export async function getApproversAtLevel(
  departmentId: string,
  level: number
) {
  const [internalUsers, externalApprovers] = await Promise.all([
    prisma.user.findMany({
      where: { departmentId, level, isActive: true },
      select: { id: true, name: true, email: true, level: true },
    }),
    prisma.department_approvers.findMany({
      where: { departmentId, approverLevel: level },
      include: {
        approver: {
          select: { id: true, name: true, email: true, level: true },
        },
      },
    }),
  ])

  // Combine and deduplicate by user id
  const approverMap = new Map<string, { id: string; name: string; email: string; level: number | null }>()

  for (const user of internalUsers) {
    approverMap.set(user.id, user)
  }

  for (const da of externalApprovers) {
    if (!approverMap.has(da.approver.id)) {
      // Use the department-specific level (approverLevel) rather than their own User.level
      approverMap.set(da.approver.id, {
        ...da.approver,
        level,
      })
    }
  }

  return Array.from(approverMap.values())
}

/**
 * Check if current user can approve a specific approval
 * Considers both internal (User.level) and external (DepartmentApprover) roles
 */
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
          departmentId: true,
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
    actor: { id: userId, role: '', isActive: true, departmentId: null, departmentType: null },
    request: {
      requesterId: '',
      departmentId: approval?.request?.departmentId ?? null,
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
    actor: { id: userId, role: '', isActive: true, departmentId: null, departmentType: null },
    request: {
      requesterId: '',
      departmentId: approval?.request?.departmentId ?? null,
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
    await createNotification({
      userId: rejectedRequest.requesterId,
      type: 'approval_rejected',
      title: 'Request Rejected',
      message: `❌ Request Rejected: Your request "${rejectedRequest.title}" has been rejected. Reason: "${comments}"`,
      requestId,
    })
  }

  revalidateRequestViews()
  return { success: true }
}

/**
 * Notify about a status change that the approval transaction committed.
 *
 * Notification behavior of the former changeRequestStatus: engineering gets
 * notified when a request first reaches SentToEngineer; every other status
 * change notifies the requester. Runs only after the approval transaction
 * committed, so notifications never escape a rolled-back approval.
 */
async function notifyRequestStatusChange(
  requestId: string,
  change: RequestStatusChangeResult,
) {
  if (change.toStatus === 'SentToEngineer') {
    // Notify all engineering users
    const engineeringDept = await prisma.departments.findFirst({
      where: { type: 'ENGINEERING' },
      select: { id: true },
    })

    if (engineeringDept) {
      const { notifyUsersInDepartment } = await import('./notifications')
      await notifyUsersInDepartment(
        engineeringDept.id,
        {
          type: 'request_assigned',
          title: 'New Task Available',
          message: `🔧 New Task Available: "${change.title}" has been approved and needs engineering solution.`,
          requestId,
        }
      )
    }
  } else {
    // Other status changes - notify requester
    await prisma.notifications.create({
      data: {
        userId: change.requesterId,
        type: 'status_changed',
        title: 'Request Status Changed',
        message: `Your request status changed to ${change.toStatus}`,
        requestId,
      },
    })
  }
}

/**
 * Notify next approver in chain
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
          departmentId: true,
        },
      },
    },
  })

  if (!nextApproval) return

  // NEW SNAPSHOT_GROUP rows notify only the persisted current-step candidate
  // group (active users, identity-deduped). Live position holders, visibility
  // descendants, and ancestor managers are never a substitute audience.
  if (nextApproval.routingMode === 'SNAPSHOT_GROUP') {
    const recipients = await resolveApprovalNeededRecipients(
      createPrismaNotificationRecipientDb(prisma),
      { approvalId: nextApproval.id, phase: 'REQUEST' },
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
    return
  }

  // Legacy notification boundaries require the request's department and the
  // pending row's level. A missing value is an unsupported (organization-owned)
  // state: reject explicitly instead of querying a substituted audience.
  if (nextApproval.request.departmentId === null || nextApproval.requiredLevel === null) {
    throw new Error('Cannot notify the next approver: organization-owned requests are not supported by legacy notifications yet')
  }

  // Get users at this level
  const approvers = await getApproversAtLevel(
    nextApproval.request.departmentId,
    nextApproval.requiredLevel
  )

  // Create notifications for all approvers at this level
  const { createNotification } = await import('./notifications')
  await Promise.all(
    approvers.map((approver) =>
      createNotification({
        userId: approver.id,
        type: 'approval_needed',
        title: 'Approval Needed',
        message: `Request "${nextApproval.request.title}" needs your approval`,
        requestId,
      })
    )
  )
}

/**
 * Get approval status for a request with eligible approvers
 */
export async function getRequestApprovals(requestId: string) {
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { departmentId: true },
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
          level: true,
        },
      },
      requiredApprover: {
        select: {
          id: true,
          name: true,
          email: true,
          level: true,
        },
      },
    },
    orderBy: { order: 'asc' },
  })

  // For each approval, get eligible approvers (users at that level)
  const approvalsWithEligible = await Promise.all(
    approvals.map(async (approval) => {
      // If pending, get eligible approvers
      let eligibleApprovers: Array<{ id: string; name: string; level: number | null }> = []

      if (approval.status === 'pending') {
        // Read-only eligibility display: without the request's legacy department
        // or the row's level there is nothing to look up. Fail closed to an
        // empty eligibility list instead of querying a substituted audience.
        if (request.departmentId !== null && approval.requiredLevel !== null) {
          // Get both internal and external approvers at this level
          const allApprovers = await getApproversAtLevel(
            request.departmentId,
            approval.requiredLevel
          )
          // Filter out users with null level and limit to first 3
          eligibleApprovers = allApprovers
            .filter(u => u.level !== null)
            .slice(0, 3)
        }
      }

      return {
        ...approval,
        eligibleApprovers,
      }
    })
  )

  return approvalsWithEligible
}
