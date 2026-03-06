'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { RequestStatus, UserRole } from '@prisma/client'
import { submitSolutionSchema, SubmitSolutionInput } from '@/lib/schemas/solution-schemas'

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
 * Submit an engineering solution for a request
 * Creates the solution record and approval chain in a transaction
 */
export async function submitSolution(input: SubmitSolutionInput) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get current user with role and level
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, departmentId: true, level: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  if (!user.departmentId) {
    throw new Error('User must be assigned to a department to submit solutions. Please contact an administrator.')
  }

  if (user.role !== UserRole.engineering) {
    throw new Error('Only engineering users can submit solutions')
  }

  // Validate input
  const validated = submitSolutionSchema.parse(input)

  // Validate request exists and is in correct status
  const request = await prisma.requests.findUnique({
    where: { id: validated.requestId },
    select: {
      id: true,
      title: true,
      status: true,
      departmentId: true,
      requesterId: true,
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  if (request.status !== RequestStatus.SentToEngineer) {
    throw new Error(`Request must be in SentToEngineer status to submit solution. Current status: ${request.status}`)
  }

  // Get engineering department ID for hierarchy-based approvals
  const engineeringDept = await prisma.departments.findFirst({
    where: { type: 'ENGINEERING' },
    select: { id: true },
  })

  if (!engineeringDept) {
    throw new Error('Engineering department not found')
  }

  // Transaction: Create solution, approval chain, and update request status
  const result = await prisma.$transaction(async (tx) => {
    // Find when status first changed to SentToEngineer (from activity log)
    const statusChangeActivity = await tx.request_activities.findFirst({
      where: {
        requestId: validated.requestId,
        action: 'status_changed',
        toStatus: 'SentToEngineer',
      },
      select: {
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc', // Get the FIRST status change to SentToEngineer
      },
    })

    const sentToEngineerAt = statusChangeActivity?.createdAt

    // Create solution record
    const solution = await tx.solutions.create({
      data: {
        requestId: validated.requestId,
        title: validated.title,
        description: validated.description,
        costEstimate: validated.costEstimate ?? 0,
        currency: validated.currency,
        timeline: validated.timeline,
        conceptDesign: validated.conceptDesign,
        submittedById: user.id,
      },
    })

    // Link specific files uploaded during solution submission to solution
    // Only transfer files that were explicitly uploaded as part of this solution (via fileIds)
    if (validated.fileIds && validated.fileIds.length > 0) {
      await tx.file_attachments.updateMany({
        where: {
          id: { in: validated.fileIds },
          requestId: validated.requestId,
          solutionId: null,
        },
        data: {
          solutionId: solution.id,
          requestId: null,
        },
      })
    }

    // Check if submitter is top-level in engineering (for auto-approval)
    const maxUser = await tx.user.findFirst({
      where: {
        departmentId: engineeringDept.id,
        isActive: true,
        level: { not: null },
      },
      orderBy: { level: 'desc' },
      select: { level: true },
    })

    const maxLevel = maxUser?.level || 1
    const isTopLevelSubmitter = user.level && user.level >= maxLevel

    // Create approval chain based on selection
    if (validated.useCustomApprovals && validated.customApproverIds && validated.customApproverIds.length > 0) {
      // Custom approval chain (never auto-approved)
      await createCustomApprovalChain(tx, solution.id, validated.customApproverIds, user.id)
      // Update request status to DesignCostEstimationApproval
      await tx.requests.update({
        where: { id: validated.requestId },
        data: { status: RequestStatus.DesignCostEstimationApproval },
      })

      // Notify custom approvers about the solution submission
      const { createNotification } = await import('./notifications')
      for (const approverId of validated.customApproverIds) {
        await createNotification({
          userId: approverId,
          type: 'approval_needed',
          title: 'Solution Submitted for Approval',
          message: `📤 Solution Submitted: "${request.title}" has a new solution ready for your approval.`,
          requestId: request.id,
        })
      }
    } else if (isTopLevelSubmitter) {
      // Top-level submitter with hierarchy - auto-approve and go directly to SendBackToRequester
      await tx.solution_approvals.create({
        data: {
          solutionId: solution.id,
          requiredLevel: maxLevel,
          order: 1,
          status: 'approved',
          approverId: user.id,
          approvedAt: new Date(),
          comments: 'Auto-approved (top-level submitter)',
          isCustomChain: false,
        },
      })
      // Skip approval phase, go directly to SendBackToRequester
      await tx.requests.update({
        where: { id: validated.requestId },
        data: { status: RequestStatus.SendBackToRequester },
      })
      // Log status change
      await tx.request_activities.create({
        data: {
          requestId: validated.requestId,
          userId: request.requesterId,
          action: 'status_changed',
          fromStatus: RequestStatus.SentToEngineer,
          toStatus: RequestStatus.SendBackToRequester,
          comments: `Solution "${validated.title}" auto-approved (top-level submitter). Request sent back to requester for final review.`,
        },
      })
      // Create notification for requester
      await tx.notifications.create({
        data: {
          userId: request.requesterId,
          type: 'solution_ready',
          title: 'Solution Ready for Review',
          message: `Engineering solution for "${request.title}" is ready for your review.`,
          requestId: validated.requestId,
        },
      })
    } else {
      // Default hierarchy-based approval chain
      await createHierarchyApprovalChain(tx, solution.id, engineeringDept.id, user.level || 1, user.id)
      // Update request status to DesignCostEstimationApproval
      await tx.requests.update({
        where: { id: validated.requestId },
        data: { status: RequestStatus.DesignCostEstimationApproval },
      })

      // Notify engineering department approvers about the solution submission
      const { getApproversAtLevel } = await import('./approvals')
      // Get the first level of approvers that have pending approvals (submitter's level + 1)
      const firstPendingLevel = (user.level || 1) + 1
      const firstLevelApprovers = await getApproversAtLevel(engineeringDept.id, firstPendingLevel)
      
      // Notify each approver
      const { createNotification } = await import('./notifications')
      for (const approver of firstLevelApprovers) {
        await createNotification({
          userId: approver.id,
          type: 'approval_needed',
          title: 'Solution Submitted for Approval',
          message: `📤 Solution Submitted: "${request.title}" has a new solution ready for your approval.`,
          requestId: request.id,
        })
      }
    }

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId: validated.requestId,
        userId: user.id,
        action: 'solution_submitted',
        comments: `Solution submitted: "${validated.title}" with cost estimate ${validated.costEstimate} ${validated.currency}`,
      },
    })

    return solution
  })

  revalidatePath('/requests')
  revalidatePath('/engineering')

  return { success: true, solutionId: result.id }
}

/**
 * Create a custom approval chain for a solution
 * Filters out submitter and validates uniqueness
 */
async function createCustomApprovalChain(
  tx: any,
  solutionId: string,
  approverIds: string[],
  submitterId: string
) {
  // Filter out submitter from approver list (auto-skip if included)
  const filteredApprovers = approverIds.filter(id => id !== submitterId)

  // Validate uniqueness
  const uniqueApprovers = [...new Set(filteredApprovers)]

  if (uniqueApprovers.length === 0) {
    throw new Error('Custom approval chain must have at least one approver after removing submitter')
  }

  // Verify all approvers exist
  const approvers = await tx.user.findMany({
    where: { id: { in: uniqueApprovers } },
    select: { id: true, name: true },
  })

  if (approvers.length !== uniqueApprovers.length) {
    throw new Error('One or more approvers not found')
  }

  // Create approval records with sequential order
  const approvals = uniqueApprovers.map((approverId, index) => ({
    solutionId,
    requiredApproverId: approverId,
    order: index + 1,
    status: 'pending' as const,
    isCustomChain: true,
  }))

  await tx.solution_approvals.createMany({ data: approvals })

  return approvals
}

/**
 * Create a hierarchy-based approval chain for a solution
 * Reuses the logic from approvals.ts createApprovalChain
 * All levels above submitter need to approve
 */
async function createHierarchyApprovalChain(
  tx: any,
  solutionId: string,
  departmentId: string,
  submitterLevel: number,
  submitterId: string
) {
  // Get max level in department
  const maxUser = await tx.user.findFirst({
    where: {
      departmentId,
      isActive: true,
      level: { not: null },
    },
    orderBy: { level: 'desc' },
    select: { level: true },
  })

  const maxLevel = maxUser?.level || 1

  const approvals = []
  let order = 1

  // If submitter is top-level, create auto-approved record
  if (submitterLevel >= maxLevel) {
    approvals.push({
      solutionId,
      requiredLevel: maxLevel,
      order: 1,
      status: 'approved' as const,
      approverId: submitterId,
      approvedAt: new Date(),
      comments: 'Auto-approved (top-level submitter)',
      isCustomChain: false,
    })
  } else {
    // Create approvals for all levels between submitter and max level
    for (let level = submitterLevel + 1; level <= maxLevel; level++) {
      // Check if there are active users at this level
      const hasUsersAtLevel = await tx.user.findFirst({
        where: {
          departmentId,
          level,
          isActive: true,
        },
        select: { id: true },
      })

      if (hasUsersAtLevel) {
        approvals.push({
          solutionId,
          requiredLevel: level,
          order: order++,
          status: 'pending' as const,
          isCustomChain: false,
        })
      }
    }
  }

  if (approvals.length > 0) {
    await tx.solution_approvals.createMany({ data: approvals })
  }

  return approvals
}

/**
 * Get solution by ID with related data
 */
export async function getSolutionBySolutionId(solutionId: string) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  const solution = await prisma.solutions.findUnique({
    where: { id: solutionId },
    include: {
      submittedBy: {
        select: { id: true, name: true, email: true },
      },
      request: {
        select: {
          id: true,
          title: true,
          status: true,
          requesterId: true,
        },
      },
      fileAttachments: {
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          filePath: true,
          createdAt: true,
        },
      },
    },
  })

  // Convert Decimal to number for client component serialization
  if (solution) {
    return {
      ...solution,
      costEstimate: Number(solution.costEstimate),
    }
  }

  return solution
}

/**
 * Get solution by request ID
 * Returns the solution if one exists for the request
 */
export async function getSolutionByRequestId(requestId: string) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  const solution = await prisma.solutions.findFirst({
    where: { requestId },
    include: {
      submittedBy: {
        select: { id: true, name: true, email: true },
      },
      fileAttachments: {
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          filePath: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Convert Decimal to number for client component serialization
  if (solution) {
    return {
      ...solution,
      costEstimate: Number(solution.costEstimate),
    }
  }

  return solution
}

/**
 * Get solution approvals with eligible approvers
 * For custom chains, returns the specific required approver
 * For hierarchy chains, returns all eligible users at each level
 */
export async function getSolutionApprovals(solutionId: string) {
  const solution = await prisma.solutions.findUnique({
    where: { id: solutionId },
    include: {
      request: {
        select: { departmentId: true },
      },
    },
  })

  if (!solution) {
    return []
  }

  // Get engineering department ID
  const engineeringDept = await prisma.departments.findFirst({
    where: { type: 'ENGINEERING' },
    select: { id: true },
  })

  if (!engineeringDept) {
    return []
  }

  const approvals = await prisma.solution_approvals.findMany({
    where: { solutionId },
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

  // For hierarchy-based approvals, add eligible approvers at each level
  const approvalsWithEligible = await Promise.all(
    approvals.map(async (approval) => {
      let eligibleApprovers: Array<{ id: string; name: string; level: number | null }> = []

      // For hierarchy-based pending approvals, get eligible users at this level
      if (approval.status === 'pending' && !approval.isCustomChain && approval.requiredLevel) {
        const users = await prisma.user.findMany({
          where: {
            departmentId: engineeringDept.id,
            level: approval.requiredLevel,
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            level: true,
          },
          take: 10,
        })
        eligibleApprovers = users.filter(u => u.level !== null)
      }

      return {
        ...approval,
        eligibleApprovers,
      }
    })
  )

  return approvalsWithEligible
}

/**
 * Check if current user can approve a specific solution
 * Returns the approval record if user can approve
 */
export async function canUserApproveSolution(solutionId: string): Promise<{
  canApprove: boolean
  approval?: any
  solution?: any
}> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    return { canApprove: false }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, level: true, departmentId: true, role: true },
  })

  if (!user) {
    return { canApprove: false }
  }

  // Get solution with request status
  const solution = await prisma.solutions.findUnique({
    where: { id: solutionId },
    include: {
      request: {
        select: {
          status: true,
          departmentId: true,
        },
      },
    },
  })

  if (!solution) {
    return { canApprove: false }
  }

  // Check if request is in correct status
  if (solution.request.status !== RequestStatus.DesignCostEstimationApproval) {
    // Convert Decimal to number before returning
    return {
      canApprove: false,
      solution: {
        ...solution,
        costEstimate: Number(solution.costEstimate),
      },
    }
  }

  // Get engineering department ID
  const engineeringDept = await prisma.departments.findFirst({
    where: { type: 'ENGINEERING' },
    select: { id: true },
  })

  if (!engineeringDept) {
    return { canApprove: false }
  }

  // Find pending approval for this user
  let approval: any = null

  // Check for custom chain approval (any role can be in custom chain)
  approval = await prisma.solution_approvals.findFirst({
    where: {
      solutionId,
      status: 'pending',
      isCustomChain: true,
      requiredApproverId: userId,
    },
    orderBy: { order: 'asc' },
  })

  // If no custom chain approval, check hierarchy approval (engineering only)
  if (!approval && user.level && user.role === UserRole.engineering) {
    approval = await prisma.solution_approvals.findFirst({
      where: {
        solutionId,
        status: 'pending',
        isCustomChain: false,
        requiredLevel: user.level,
      },
      orderBy: { order: 'asc' },
    })
  }

  if (!approval) {
    // Convert Decimal to number before returning
    return {
      canApprove: false,
      solution: {
        ...solution,
        costEstimate: Number(solution.costEstimate),
      },
    }
  }

  // Check if all previous approvals are completed
  const previousApprovals = await prisma.solution_approvals.findMany({
    where: {
      solutionId,
      order: { lt: approval.order },
      status: 'pending',
    },
  })

  const canApprove = previousApprovals.length === 0

  // Convert Decimal to number before returning
  const serializedSolution = {
    ...solution,
    costEstimate: Number(solution.costEstimate),
  }

  return { canApprove, approval, solution: serializedSolution }
}

/**
 * Approve a solution
 */
export async function approveSolution(solutionId: string, comments?: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  const { canApprove, approval, solution } = await canUserApproveSolution(solutionId)
  if (!canApprove || !approval) {
    throw new Error('You cannot approve this solution at this time')
  }

  // Check for stale data if expectedUpdatedAt is provided (check request's updatedAt)
  if (expectedUpdatedAt && solution) {
    const request = await prisma.requests.findUnique({
      where: { id: solution.requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.' }
    }
  }

  // Use transaction for atomicity
  await prisma.$transaction(async (tx) => {
    // Update approval
    await tx.solution_approvals.update({
      where: { id: approval.id },
      data: {
        approverId: userId,
        status: 'approved',
        comments,
        approvedAt: new Date(),
      },
    })

    // Get solution details for logging
    const solutionData = await tx.solutions.findUnique({
      where: { id: solutionId },
      select: { requestId: true, title: true },
    })

    if (!solutionData) {
      throw new Error('Solution not found')
    }

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId: solutionData.requestId,
        userId,
        action: 'solution_approved',
        comments: comments || `Solution "${solutionData.title}" approved at step ${approval.order}`,
      },
    })

    // Check if this was the last approval
    const pendingApprovals = await tx.solution_approvals.count({
      where: {
        solutionId,
        status: 'pending',
      },
    })

    // If no more pending approvals, transition request status
    if (pendingApprovals === 0) {
      // Update request status to SendBackToRequester
      await tx.requests.update({
        where: { id: solutionData.requestId },
        data: { status: RequestStatus.SendBackToRequester },
      })

      // Get request for notification (include departmentId for department-wide notification)
      const request = await tx.requests.findUnique({
        where: { id: solutionData.requestId },
        select: { requesterId: true, title: true, departmentId: true },
      })

      if (request) {
        // Log status change
        await tx.request_activities.create({
          data: {
            requestId: solutionData.requestId,
            userId: request.requesterId,
            action: 'status_changed',
            fromStatus: RequestStatus.DesignCostEstimationApproval,
            toStatus: RequestStatus.SendBackToRequester,
            comments: `Solution "${solutionData.title}" approved. Request sent back to requester for final review.`,
          },
        })

        // Notify all users in requester's department
        const { notifyUsersInDepartment } = await import('./notifications')
        await notifyUsersInDepartment(
          request.departmentId,
          {
            type: 'solution_ready',
            title: 'Solution Ready for Review',
            message: `📤 Ready for Review: "${request.title}" has been completed and awaits your department's final review.`,
            requestId: solutionData.requestId,
          }
        )
      }
    } else {
      // Notify next approver in chain
      await notifyNextSolutionApprover(tx, solutionId)
    }
  })

  revalidatePath('/requests')
  revalidatePath('/engineering')

  return { success: true }
}

/**
 * Reject a solution
 */
export async function rejectSolution(solutionId: string, comments: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  if (!comments || comments.trim().length === 0) {
    throw new Error('Comments are required when rejecting')
  }

  const { canApprove, approval, solution } = await canUserApproveSolution(solutionId)
  if (!canApprove || !approval || !solution) {
    throw new Error('You cannot reject this solution at this time')
  }

  // Check for stale data if expectedUpdatedAt is provided (check request's updatedAt)
  if (expectedUpdatedAt) {
    const request = await prisma.requests.findUnique({
      where: { id: solution.requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.' }
    }
  }

  // Use transaction for atomicity
  await prisma.$transaction(async (tx) => {
    // Update approval to rejected
    await tx.solution_approvals.update({
      where: { id: approval.id },
      data: {
        approverId: userId,
        status: 'rejected',
        comments,
        approvedAt: new Date(),
      },
    })

    // Mark all remaining pending approvals as rejected
    await tx.solution_approvals.updateMany({
      where: {
        solutionId,
        status: 'pending',
      },
      data: {
        status: 'rejected',
      },
    })

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId: solution.requestId,
        userId,
        action: 'solution_rejected',
        comments,
      },
    })

    // Return request to SentToEngineer status for resubmission
    await tx.requests.update({
      where: { id: solution.requestId },
      data: { status: RequestStatus.SentToEngineer },
    })

    // Get solution details for notification
    const solutionData = await tx.solutions.findUnique({
      where: { id: solutionId },
      select: { submittedById: true, title: true },
    })

    if (solutionData) {
      // Create notification for solution submitter
      await tx.notifications.create({
        data: {
          userId: solutionData.submittedById,
          type: 'approval_rejected',
          title: 'Solution Rejected',
          message: `Your solution "${solutionData.title}" was rejected and returned for resubmission.`,
          requestId: solution.requestId,
        },
      })
    }
  })

  revalidatePath('/requests')
  revalidatePath('/engineering')

  return { success: true }
}

/**
 * Mark a request as completed (manual completion by engineering)
 * Allows engineering to track completion without formal final approval
 */
export async function markRequestComplete(requestId: string, completionNote?: string) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get current user with role
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, name: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  if (user.role !== UserRole.engineering) {
    throw new Error('Only engineering users can mark requests complete')
  }

  // Validate request exists and is in correct status
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      title: true,
      status: true,
      requesterId: true,
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  if (request.status !== RequestStatus.SendBackToRequester) {
    throw new Error(`Request can only be marked complete when in SendBackToRequester status. Current status: ${request.status}`)
  }

  // Use transaction for atomicity
  await prisma.$transaction(async (tx) => {
    // Update request status to Completed
    await tx.requests.update({
      where: { id: requestId },
      data: { status: RequestStatus.Completed },
    })

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId,
        userId: user.id,
        action: 'manually_completed',
        fromStatus: RequestStatus.SendBackToRequester,
        toStatus: RequestStatus.Completed,
        comments: completionNote || 'Manually marked as completed by engineering',
      },
    })

    // Create notification for requester
    await tx.notifications.create({
      data: {
        userId: request.requesterId,
        type: 'status_changed',
        title: 'Request Completed',
        message: `Your request "${request.title}" has been marked as completed`,
        requestId,
      },
    })
  })

  revalidatePath('/requests')
  revalidatePath('/engineering')

  return { success: true }
}

/**
 * Check if current user can mark a request as complete
 */
export async function canMarkComplete(requestId: string): Promise<{
  canMark: boolean
  reason?: string
}> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    return { canMark: false, reason: 'Not authenticated' }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  })

  if (!user) {
    return { canMark: false, reason: 'User not found' }
  }

  if (user.role !== UserRole.engineering) {
    return { canMark: false, reason: 'Only engineering users can mark requests complete' }
  }

  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { status: true },
  })

  if (!request) {
    return { canMark: false, reason: 'Request not found' }
  }

  if (request.status !== RequestStatus.SendBackToRequester) {
    return { canMark: false, reason: `Request must be in SendBackToRequester status. Current: ${request.status}` }
  }

  return { canMark: true }
}

/**
 * Notify next approver in solution approval chain
 */
async function notifyNextSolutionApprover(tx: any, solutionId: string) {
  const nextApproval = await tx.solution_approvals.findFirst({
    where: {
      solutionId,
      status: 'pending',
    },
    orderBy: { order: 'asc' },
    include: {
      solution: {
        select: {
          title: true,
          requestId: true,
        },
      },
    },
  })

  if (!nextApproval) return

  // For custom chain: notify specific requiredApproverId
  if (nextApproval.isCustomChain && nextApproval.requiredApproverId) {
    await tx.notifications.create({
      data: {
        userId: nextApproval.requiredApproverId,
        type: 'approval_needed',
        title: 'Solution Approval Needed',
        message: `Solution "${nextApproval.solution.title}" needs your approval.`,
        requestId: nextApproval.solution.requestId,
      },
    })
    return
  }

  // For hierarchy chain: notify all users at requiredLevel in engineering dept
  if (nextApproval.requiredLevel) {
    const engineeringDept = await tx.departments.findFirst({
      where: { type: 'ENGINEERING' },
      select: { id: true },
    })

    if (engineeringDept) {
      const approvers = await tx.user.findMany({
        where: {
          departmentId: engineeringDept.id,
          level: nextApproval.requiredLevel,
          isActive: true,
        },
        select: { id: true },
      })

      // Create notifications for all approvers at this level
      const notifications = approvers.map((approver: { id: string }) => ({
        userId: approver.id,
        type: 'approval_needed' as const,
        title: 'Solution Approval Needed',
        message: `Solution "${nextApproval.solution.title}" needs your approval.`,
        requestId: nextApproval.solution.requestId,
      }))

      if (notifications.length > 0) {
        await tx.notifications.createMany({ data: notifications })
      }
    }
  }
}

// ============================================================================
// FINAL APPROVAL WORKFLOW (Phase 4 Plan 5)
// ============================================================================

/**
 * Initiate final department approval for a solution
 * Creates RequestApproval records for final department sign-off
 */
export async function initiateFinalApproval(
  requestId: string,
  useCustomChain: boolean,
  customApproverIds?: string[]
) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get current user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, departmentId: true, level: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  // Validate request exists and is in correct status
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      title: true,
      status: true,
      departmentId: true,
      requesterId: true,
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  if (request.status !== RequestStatus.SendBackToRequester) {
    throw new Error(`Request must be in SendBackToRequester status to initiate final approval. Current status: ${request.status}`)
  }

  // Validate caller is in request's department
  if (user.departmentId !== request.departmentId) {
    throw new Error('Only department members can initiate final approval')
  }

  // Get max level in department for top-level check
  const maxUser = await prisma.user.findFirst({
    where: {
      departmentId: request.departmentId,
      isActive: true,
      level: { not: null },
    },
    orderBy: { level: 'desc' },
    select: { level: true },
  })

  const maxLevel = maxUser?.level || 1
  const isTopLevelInitiator = user.level && user.level >= maxLevel

  // Use transaction for atomicity
  await prisma.$transaction(async (tx) => {
    // Create final approval chain
    if (useCustomChain && customApproverIds && customApproverIds.length > 0) {
      // Custom approval chain (never auto-approved)
      await createCustomFinalApprovalChain(tx, requestId, customApproverIds, userId)
      // Update request status to FinalApproval
      await tx.requests.update({
        where: { id: requestId },
        data: { status: RequestStatus.FinalApproval },
      })
    } else if (isTopLevelInitiator) {
      // Top-level initiator with hierarchy - auto-approve and go directly to Completed
      await tx.request_approvals.create({
        data: {
          requestId,
          requiredLevel: maxLevel,
          order: 1,
          status: 'approved',
          approverId: user.id,
          approvedAt: new Date(),
          comments: 'Auto-approved (top-level initiator)',
          isCustomChain: false,
          isFinalApproval: true,
        },
      })
      // Skip approval phase, go directly to Completed
      await tx.requests.update({
        where: { id: requestId },
        data: { status: RequestStatus.Completed },
      })
      // Log status change
      await tx.request_activities.create({
        data: {
          requestId,
          userId: request.requesterId,
          action: 'status_changed',
          fromStatus: RequestStatus.SendBackToRequester,
          toStatus: RequestStatus.Completed,
          comments: `Final approval auto-approved (top-level initiator). Request marked as completed.`,
        },
      })
      // Create notification for requester
      await tx.notifications.create({
        data: {
          userId: request.requesterId,
          type: 'status_changed',
          title: 'Request Completed',
          message: `Your request "${request.title}" has been completed.`,
          requestId,
        },
      })
    } else {
      // Use department hierarchy
      await createHierarchyFinalApprovalChain(tx, requestId, request.departmentId, userId)
      // Update request status to FinalApproval
      await tx.requests.update({
        where: { id: requestId },
        data: { status: RequestStatus.FinalApproval },
      })
    }

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId,
        userId,
        action: 'final_approval_initiated',
        comments: useCustomChain
          ? `Final approval initiated with custom approval chain`
          : isTopLevelInitiator
          ? `Final approval auto-approved (top-level initiator)`
          : `Final approval initiated with department hierarchy`,
      },
    })

    // Notify first approver(s) only if not top-level
    if (!useCustomChain && !isTopLevelInitiator) {
      await notifyNextFinalApprover(tx, requestId)
    } else if (useCustomChain) {
      await notifyNextFinalApprover(tx, requestId)
    }
  })

  revalidatePath('/requests')
  revalidatePath('/dashboard')

  return { success: true }
}

/**
 * Create custom final approval chain
 * Filters out initiator and validates uniqueness
 */
async function createCustomFinalApprovalChain(
  tx: any,
  requestId: string,
  approverIds: string[],
  initiatorId: string
) {
  // Filter out initiator from approver list
  const filteredApprovers = approverIds.filter(id => id !== initiatorId)

  // Validate uniqueness
  const uniqueApprovers = [...new Set(filteredApprovers)]

  if (uniqueApprovers.length === 0) {
    throw new Error('Custom approval chain must have at least one approver after removing initiator')
  }

  // Verify all approvers exist
  const approvers = await tx.user.findMany({
    where: { id: { in: uniqueApprovers } },
    select: { id: true, name: true },
  })

  if (approvers.length !== uniqueApprovers.length) {
    throw new Error('One or more approvers not found')
  }

  // Create approval records with sequential order
  const approvals = uniqueApprovers.map((approverId, index) => ({
    requestId,
    requiredApproverId: approverId,
    requiredLevel: 0, // Not used for custom chains
    order: index + 1,
    status: 'pending' as const,
    isCustomChain: true,
    isFinalApproval: true,
  }))

  await tx.request_approvals.createMany({ data: approvals })

  return approvals
}

/**
 * Create hierarchy-based final approval chain
 * Uses department's approval hierarchy (like Phase 3)
 */
async function createHierarchyFinalApprovalChain(
  tx: any,
  requestId: string,
  departmentId: string,
  initiatorId: string
) {
  // Get initiator's level
  const initiator = await tx.user.findUnique({
    where: { id: initiatorId },
    select: { level: true },
  })

  const initiatorLevel = initiator?.level || 1

  // Get max level in department
  const maxUser = await tx.user.findFirst({
    where: {
      departmentId,
      isActive: true,
      level: { not: null },
    },
    orderBy: { level: 'desc' },
    select: { level: true },
  })

  const maxLevel = maxUser?.level || 1

  const approvals = []
  let order = 1

  // If initiator is top-level, auto-approve
  if (initiatorLevel >= maxLevel) {
    approvals.push({
      requestId,
      requiredLevel: maxLevel,
      order: 1,
      status: 'approved' as const,
      approverId: initiatorId,
      approvedAt: new Date(),
      comments: 'Auto-approved (top-level initiator)',
      isCustomChain: false,
      isFinalApproval: true,
    })
  } else {
    // Create approvals for all levels between initiator and max level
    for (let level = initiatorLevel + 1; level <= maxLevel; level++) {
      const hasUsersAtLevel = await tx.user.findFirst({
        where: {
          departmentId,
          level,
          isActive: true,
        },
        select: { id: true },
      })

      if (hasUsersAtLevel) {
        approvals.push({
          requestId,
          requiredLevel: level,
          order: order++,
          status: 'pending' as const,
          isCustomChain: false,
          isFinalApproval: true,
        })
      }
    }
  }

  if (approvals.length > 0) {
    await tx.request_approvals.createMany({ data: approvals })
  }

  return approvals
}

/**
 * Notify next final approver in chain
 */
async function notifyNextFinalApprover(tx: any, requestId: string) {
  const nextApproval = await tx.request_approvals.findFirst({
    where: {
      requestId,
      status: 'pending',
      isFinalApproval: true,
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

  // For custom chain: notify specific requiredApproverId
  if (nextApproval.isCustomChain && nextApproval.requiredApproverId) {
    await tx.notifications.create({
      data: {
        userId: nextApproval.requiredApproverId,
        type: 'final_approval_needed',
        title: 'Final Approval Needed',
        message: `Request "${nextApproval.request.title}" needs your final approval.`,
        requestId,
      },
    })
    return
  }

  // For hierarchy chain: notify all users at requiredLevel in request's department
  if (nextApproval.requiredLevel) {
    const approvers = await tx.user.findMany({
      where: {
        departmentId: nextApproval.request.departmentId,
        level: nextApproval.requiredLevel,
        isActive: true,
      },
      select: { id: true },
    })

    const notifications = approvers.map((approver: { id: string }) => ({
      userId: approver.id,
      type: 'final_approval_needed' as const,
      title: 'Final Approval Needed',
      message: `Request "${nextApproval.request.title}" needs your final approval.`,
      requestId,
    }))

    if (notifications.length > 0) {
      await tx.notifications.createMany({ data: notifications })
    }
  }
}

/**
 * Check if current user can approve final approval
 */
export async function canUserApproveFinalApproval(requestId: string): Promise<{
  canApprove: boolean
  approval?: any
}> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    return { canApprove: false }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, level: true, departmentId: true },
  })

  if (!user) {
    return { canApprove: false }
  }

  // Check request status
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { status: true },
  })

  if (!request || request.status !== RequestStatus.FinalApproval) {
    return { canApprove: false }
  }

  // Find pending approval for this user
  let approval: any = null

  // Check for custom chain approval
  approval = await prisma.request_approvals.findFirst({
    where: {
      requestId,
      status: 'pending',
      isFinalApproval: true,
      isCustomChain: true,
      requiredApproverId: userId,
    },
    orderBy: { order: 'asc' },
  })

  // If no custom chain approval, check hierarchy approval
  if (!approval && user.level) {
    approval = await prisma.request_approvals.findFirst({
      where: {
        requestId,
        status: 'pending',
        isFinalApproval: true,
        isCustomChain: false,
        requiredLevel: user.level,
      },
      orderBy: { order: 'asc' },
    })
  }

  if (!approval) {
    return { canApprove: false }
  }

  // Check if all previous approvals are completed
  const previousApprovals = await prisma.request_approvals.findMany({
    where: {
      requestId,
      isFinalApproval: true,
      order: { lt: approval.order },
      status: 'pending',
    },
  })

  const canApprove = previousApprovals.length === 0

  return { canApprove, approval }
}

/**
 * Approve final approval
 */
export async function approveFinalApproval(requestId: string, comments?: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  const { canApprove, approval } = await canUserApproveFinalApproval(requestId)
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

  // Use transaction for atomicity
  await prisma.$transaction(async (tx) => {
    // Update approval
    await tx.request_approvals.update({
      where: { id: approval.id },
      data: {
        approverId: userId,
        status: 'approved',
        comments,
        approvedAt: new Date(),
      },
    })

    // Get request details for logging
    const request = await tx.requests.findUnique({
      where: { id: requestId },
      select: { requesterId: true, title: true, departmentId: true },
    })

    if (!request) {
      throw new Error('Request not found')
    }

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId,
        userId,
        action: 'final_approval_approved',
        comments: comments || `Final approval approved at step ${approval.order}`,
      },
    })

    // Check if this was the last approval
    const pendingApprovals = await tx.request_approvals.count({
      where: {
        requestId,
        isFinalApproval: true,
        status: 'pending',
      },
    })

    // If no more pending approvals, mark as completed
    if (pendingApprovals === 0) {
      await tx.requests.update({
        where: { id: requestId },
        data: { status: RequestStatus.Completed },
      })

      // Log completion
      await tx.request_activities.create({
        data: {
          requestId,
          userId: request.requesterId,
          action: 'status_changed',
          fromStatus: RequestStatus.FinalApproval,
          toStatus: RequestStatus.Completed,
          comments: `All final approvals completed. Request marked as completed.`,
        },
      })

      // Get engineering department to exclude engineers from requester dept notification
      const engineeringDept = await tx.departments.findFirst({
        where: { type: 'ENGINEERING' },
        select: { id: true },
      })

      // Get engineering users to exclude
      const engineeringUsers = engineeringDept
        ? await tx.user.findMany({
            where: { departmentId: engineeringDept.id },
            select: { id: true },
          })
        : []

      const engineeringUserIds = engineeringUsers.map(u => u.id)

      // Notify all users in requester's department (except engineering users)
      const { notifyUsersInDepartment } = await import('./notifications')
      await notifyUsersInDepartment(
        request.departmentId,
        {
          type: 'approval_granted',
          title: 'Request Completed',
          message: `✅ Request Completed: "${request.title}" has been fully approved and completed.`,
          requestId,
        },
        engineeringUserIds // Exclude engineering users (they don't need completion notification)
      )
    } else {
      // Notify next approver
      await notifyNextFinalApprover(tx, requestId)
    }
  })

  revalidatePath('/requests')
  revalidatePath('/dashboard')

  return { success: true }
}

/**
 * Reject final approval
 * Returns request to engineering for revision
 */
export async function rejectFinalApproval(requestId: string, comments: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  if (!comments || comments.trim().length === 0) {
    throw new Error('Comments are required when rejecting')
  }

  const { canApprove, approval } = await canUserApproveFinalApproval(requestId)
  if (!canApprove || !approval) {
    throw new Error('You cannot reject this request at this time')
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

  // Use transaction for atomicity
  await prisma.$transaction(async (tx) => {
    // Update approval to rejected
    await tx.request_approvals.update({
      where: { id: approval.id },
      data: {
        approverId: userId,
        status: 'rejected',
        comments,
        approvedAt: new Date(),
      },
    })

    // Mark all remaining final approvals as rejected
    await tx.request_approvals.updateMany({
      where: {
        requestId,
        isFinalApproval: true,
        status: 'pending',
      },
      data: {
        status: 'rejected',
      },
    })

    // Get request details
    const request = await tx.requests.findUnique({
      where: { id: requestId },
      select: { title: true, departmentId: true },
    })

    if (!request) {
      throw new Error('Request not found')
    }

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId,
        userId,
        action: 'final_approval_rejected',
        comments,
      },
    })

    // Return request to SentToEngineer status for engineering revision
    await tx.requests.update({
      where: { id: requestId },
      data: { status: RequestStatus.SentToEngineer },
    })

    // Get engineering department to notify all engineers
    const engineeringDept = await tx.departments.findFirst({
      where: { type: 'ENGINEERING' },
      select: { id: true },
    })

    if (engineeringDept && request) {
      const { notifyUsersInDepartment } = await import('./notifications')
      await notifyUsersInDepartment(
        engineeringDept.id,
        {
          type: 'approval_rejected',
          title: 'Final Approval Rejected',
          message: `❌ Final Rejection: "${request.title}" was rejected during final approval. Reason: "${comments}". Please revise the solution.`,
          requestId,
        },
        [userId] // Exclude the person who rejected
      )

      // Also notify requester's department about the rejection (excluding the rejector if they're in that department)
      if (request.departmentId) {
        await notifyUsersInDepartment(
          request.departmentId,
          {
            type: 'status_changed',
            title: 'Final Approval Rejected',
            message: `❌ Final Approval Rejected: "${request.title}" was rejected during final approval. The request has been returned to engineering for revision.`,
            requestId,
          },
          [userId] // Exclude the person who rejected
        )
      }
    }
  })

  revalidatePath('/requests')
  revalidatePath('/engineering')
  revalidatePath('/dashboard')

  return { success: true }
}

/**
 * Resubmit an engineering solution after rejection
 * Updates the existing solution with new details and resets the approval chain
 */
export async function resubmitSolution(input: {
  requestId: string
  title: string
  description: string
  cost: number
  currency: string
  timeline: string
  files: File[]
  deletedFileIds?: string[]
  useCustomHierarchy: boolean
  customApprovers: string[]
}) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get current user with role and level
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, departmentId: true, level: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  if (!user.departmentId) {
    throw new Error('User must be assigned to a department to submit solutions')
  }

  if (user.role !== UserRole.engineering) {
    throw new Error('Only engineering users can resubmit solutions')
  }

  // Validate request exists and has a rejected solution
  const request = await prisma.requests.findUnique({
    where: { id: input.requestId },
    include: {
      solutions: {
        include: {
          approvals: {
            where: { status: 'rejected' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          fileAttachments: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      department: true,
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  const solution = request.solutions[0]
  if (!solution) {
    throw new Error('No solution found for this request')
  }

  if (!solution.approvals.some(a => a.status === 'rejected')) {
    throw new Error('Can only resubmit rejected solutions')
  }

  // Start transaction
  const result = await prisma.$transaction(async (tx) => {
    // Update solution details
    const updatedSolution = await tx.solutions.update({
      where: { id: solution.id },
      data: {
        title: input.title,
        description: input.description,
        costEstimate: input.cost,
        currency: input.currency,
        timeline: input.timeline,
        updatedAt: new Date(),
      },
    })

    // Handle file attachments
    if (input.deletedFileIds && input.deletedFileIds.length > 0) {
      await tx.file_attachments.deleteMany({
        where: {
          id: { in: input.deletedFileIds },
          solutionId: solution.id,
        },
      })
    }

    // Add new files
    if (input.files.length > 0) {
      const fileData = input.files.map(file => ({
        solutionId: solution.id,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        filePath: `/uploads/solutions/${solution.id}/${file.name}`,
        uploadedById: userId,
      }))

      await tx.file_attachments.createMany({
        data: fileData,
      })
    }

    // Delete old rejected approvals
    await tx.solution_approvals.deleteMany({
      where: {
        solutionId: solution.id,
      },
    })

    // Create new approval chain
    const approvalData = []
    
    if (input.useCustomHierarchy && input.customApprovers.length > 0) {
      // Custom approval chain
      input.customApprovers.forEach((approverId, index) => {
        approvalData.push({
          solutionId: solution.id,
          requiredApproverId: approverId,
          order: index + 1,
          status: 'pending',
          isCustomChain: true,
        })
      })
    } else {
      // Get engineering department ID for hierarchy-based approvals
      const engineeringDept = await tx.departments.findFirst({
        where: { type: 'ENGINEERING' },
        select: { id: true },
      })

      if (!engineeringDept) {
        throw new Error('Engineering department not found')
      }

      // Create hierarchy-based approval chain directly (not using createHierarchyApprovalChain to avoid double creation)
      const maxUser = await tx.user.findFirst({
        where: {
          departmentId: engineeringDept.id,
          isActive: true,
          level: { not: null },
        },
        orderBy: { level: 'desc' },
        select: { level: true },
      })

      const maxLevel = maxUser?.level || 1
      const submitterLevel = user.level || 1

      // If submitter is top-level, create auto-approved record
      if (submitterLevel >= maxLevel) {
        approvalData.push({
          solutionId: solution.id,
          requiredLevel: maxLevel,
          order: 1,
          status: 'approved' as const,
          approverId: userId,
          approvedAt: new Date(),
          comments: 'Auto-approved (top-level submitter)',
          isCustomChain: false,
        })
      } else {
        // Create approvals for all levels between submitter and max level
        let order = 1
        for (let level = submitterLevel + 1; level <= maxLevel; level++) {
          // Check if there are active users at this level
          const hasUsersAtLevel = await tx.user.findFirst({
            where: {
              departmentId: engineeringDept.id,
              level,
              isActive: true,
            },
            select: { id: true },
          })

          if (hasUsersAtLevel) {
            approvalData.push({
              solutionId: solution.id,
              requiredLevel: level,
              order: order++,
              status: 'pending' as const,
              isCustomChain: false,
            })
          }
        }
      }
    }

    await tx.solution_approvals.createMany({
      data: approvalData,
    })

    // Update request status back to DesignCostEstimationApproval
    await tx.requests.update({
      where: { id: input.requestId },
      data: {
        status: RequestStatus.DesignCostEstimationApproval,
        updatedAt: new Date(),
      },
    })

    // Add activity log
    await tx.request_activities.create({
      data: {
        requestId: input.requestId,
        userId,
        action: 'solution_resubmitted',
        comments: `Solution resubmitted: "${input.title}"`,
      },
    })

    return updatedSolution
  })

  // Send notifications to approvers
  const { notifyUsersInDepartment } = await import('./notifications')
  if (request.department) {
    await notifyUsersInDepartment(
      request.department.id,
      {
        type: 'approval_needed',
        title: 'Solution Resubmitted',
        message: `📤 Solution resubmitted for "${request.title}". Please review the updated solution.`,
        requestId: input.requestId,
      },
      [userId] // Exclude submitter
    )
  }

  revalidatePath('/requests')
  revalidatePath('/engineering')
  revalidatePath('/dashboard')

  return { success: true, solutionId: result.id }
}
