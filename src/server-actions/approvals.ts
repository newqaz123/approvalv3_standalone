'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { revalidateRequestViews } from './request-view-invalidation'

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
async function getMaxLevelInDepartment(departmentId: string): Promise<number> {
  const [maxUser, maxExternal] = await Promise.all([
    prisma.user.findFirst({
      where: {
        departmentId,
        isActive: true,
        level: { not: null },
      },
      orderBy: { level: 'desc' },
      select: { level: true },
    }),
    prisma.department_approvers.findFirst({
      where: { departmentId },
      orderBy: { approverLevel: 'desc' },
      select: { approverLevel: true },
    }),
  ])

  const internalMax = maxUser?.level || 0
  const externalMax = maxExternal?.approverLevel || 0
  return Math.max(internalMax, externalMax) || 1
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
  submitterId?: string
) {
  const maxLevel = await getMaxLevelInDepartment(departmentId)

  const approvals = []
  let order = 1

  // If submitter is top-level, create auto-approved self-approval
  if (submitterLevel >= maxLevel) {
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
    for (let level = submitterLevel + 1; level <= maxLevel; level++) {
      // Check if there are active approvers at this level (internal or external)
      // Also get one internal user ID to use as requiredApprover for display purposes
      const [internalUser, externalApprovers] = await Promise.all([
        prisma.user.findFirst({
          where: { departmentId, level, isActive: true },
          select: { id: true },
        }),
        prisma.department_approvers.findMany({
          where: { departmentId, approverLevel: level },
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
              requiredLevel: level,
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
            requiredLevel: level,
            requiredApproverId: internalUser.id,
            order: order++,
            status: 'pending' as const,
          })
        }
      }
    }
  }

  if (approvals.length > 0) {
    await prisma.request_approvals.createMany({ data: approvals })
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
export async function canUserApprove(
  requestId: string
): Promise<{ canApprove: boolean; approval?: any }> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    return { canApprove: false }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { level: true, departmentId: true },
  })

  if (!user) {
    return { canApprove: false }
  }

  // Get the request to check department
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { departmentId: true, status: true },
  })

  if (!request) {
    return { canApprove: false }
  }

  // Determine effective level for this user in this department
  // Check if user is an internal approver for the request's department
  let effectiveLevel = user.departmentId === request.departmentId ? user.level : null

  // Also check if user is a cross-department approver (DepartmentApprover)
  if (!effectiveLevel) {
    const deptApprover = await prisma.department_approvers.findFirst({
      where: { departmentId: request.departmentId, approverId: userId },
      select: { approverLevel: true },
    })
    if (deptApprover) {
      effectiveLevel = deptApprover.approverLevel
    }
  }

  if (!effectiveLevel) {
    return { canApprove: false }
  }

  // Find pending approval for this user's effective level
  const approval = await prisma.request_approvals.findFirst({
    where: {
      requestId,
      requiredLevel: effectiveLevel,
      status: 'pending',
      isFinalApproval: false,
    },
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

  // Check if this is the current approval in sequence
  const previousApprovals = await prisma.request_approvals.findMany({
    where: {
      requestId,
      order: { lt: approval.order },
      status: 'pending',
      isFinalApproval: false,
    },
  })

  // Can only approve if all previous approvals are done
  const canApprove = previousApprovals.length === 0

  return { canApprove, approval }
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
  if (!canApprove || !approval) {
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

  // Update approval
  await prisma.request_approvals.update({
    where: { id: approval.id },
    data: {
      approverId: userId,
      status: 'approved',
      comments,
      approvedAt: new Date(),
    },
  })

  // Log activity
  await prisma.request_activities.create({
    data: {
      requestId,
      userId,
      action: 'approved',
      comments: comments || `Approved at level ${approval.requiredLevel}`,
    },
  })

  // Check if this was the last approval
  const pendingApprovals = await prisma.request_approvals.count({
    where: {
      requestId,
      status: 'pending',
    },
  })

  // If no more pending approvals, change status
  if (pendingApprovals === 0) {
    await changeRequestStatus(requestId)
  } else {
    // Notify next approver
    await notifyNextApprover(requestId)
  }

  revalidateRequestViews(requestId)
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
  if (!canApprove || !approval) {
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

  // Update approval
  await prisma.request_approvals.update({
    where: { id: approval.id },
    data: {
      approverId: userId,
      status: 'rejected',
      comments,
      approvedAt: new Date(),
    },
  })

  // Log activity
  await prisma.request_activities.create({
    data: {
      requestId,
      userId,
      action: 'rejected',
      comments,
    },
  })

  // Notify requester of rejection with reason
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

  // Mark all remaining approvals as rejected
  await prisma.request_approvals.updateMany({
    where: {
      requestId,
      status: 'pending',
    },
    data: {
      status: 'rejected',
    },
  })

  revalidateRequestViews(requestId)
  return { success: true }
}

/**
 * Change request status based on current status
 */
async function changeRequestStatus(requestId: string) {
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { status: true, requesterId: true, departmentId: true, title: true },
  })

  if (!request) return

  let newStatus: string | null = null

  switch (request.status) {
    case 'ImprovementRequest':
      newStatus = 'SentToEngineer'
      break
    case 'SentToEngineer':
      newStatus = 'SendBackToRequester'
      break
    case 'SendBackToRequester':
      newStatus = 'Completed'
      break
  }

  if (newStatus) {
    await prisma.requests.update({
      where: { id: requestId },
      data: { status: newStatus as any },
    })

    // Log status change
    await prisma.request_activities.create({
      data: {
        requestId,
        userId: request.requesterId,
        action: 'status_changed',
        fromStatus: request.status as any,
        toStatus: newStatus as any,
        comments: `Status changed from ${request.status} to ${newStatus}`,
      },
    })

    // Create notification based on new status
    if (newStatus === 'SentToEngineer') {
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
            message: `🔧 New Task Available: "${request.title}" has been approved and needs engineering solution.`,
            requestId,
          }
        )
      }
    } else {
      // Other status changes - notify requester
      await prisma.notifications.create({
        data: {
          userId: request.requesterId,
          type: 'status_changed',
          title: 'Request Status Changed',
          message: `Your request status changed to ${newStatus}`,
          requestId,
        },
      })
    }
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

      return {
        ...approval,
        eligibleApprovers,
      }
    })
  )

  return approvalsWithEligible
}
