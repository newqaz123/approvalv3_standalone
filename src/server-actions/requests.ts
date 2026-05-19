'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { revalidateRequestViews } from './request-view-invalidation'
import { z } from 'zod'
import { createApprovalChain, getApproversAtLevel } from './approvals'
import { requireAdmin } from '@/lib/auth'
import { promises as fs } from 'fs'
import path from 'path'
import { getCurrentUser, getUserById } from '@/lib/cache/user-cache'

// Zod schema for request validation
const createRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().min(1, 'Description is required').max(5000, 'Description too long'),
})

export interface CreateRequestInput {
  title: string
  description: string
}

/**
 * Create a new request with automatic logging to audit trail
 */
export async function createRequest(input: CreateRequestInput) {
  const user = await getCurrentUser()

  if (!user || !user.departmentId) {
    return {
      success: false,
      error: 'User must belong to a department to create requests',
    }
  }

  // Validate input
  const validatedFields = createRequestSchema.safeParse(input)

  if (!validatedFields.success) {
    return {
      success: false,
      errors: validatedFields.error.flatten().fieldErrors,
    }
  }

  // Create request in a transaction with activity log
  const request = await prisma.$transaction(async (tx) => {
    const newRequest = await tx.requests.create({
      data: {
        title: validatedFields.data.title,
        description: validatedFields.data.description,
        requesterId: user.id,
        departmentId: user.departmentId!, // Non-null assertion since we checked above
        status: 'ImprovementRequest',
      },
    })

    // Log creation in audit trail
    await tx.request_activities.create({
      data: {
        requestId: newRequest.id,
        action: 'created',
        toStatus: 'ImprovementRequest',
        comments: `Request created: ${validatedFields.data.title}`,
        userId: user.id,
      },
    })

    return newRequest
  })

  // Create approval chain based on user's level
  const userLevel = user.level || 1
  const approvals = await createApprovalChain(
    request.id,
    user.departmentId,
    userLevel,
    user.id
  )

  // Notify department approvers if there are pending approvals (not auto-approved)
  const pendingApprovals = approvals.filter(a => a.status === 'pending')
  if (pendingApprovals.length > 0) {
    const firstLevel = pendingApprovals[0].requiredLevel
    const { getApproversAtLevel } = await import('./approvals')
    const approvers = await getApproversAtLevel(user.departmentId, firstLevel)
    
    // Notify each approver
    const { createNotification } = await import('./notifications')
    for (const approver of approvers) {
      await createNotification({
        userId: approver.id,
        type: 'approval_needed',
        title: 'New Approval Request',
        message: `📋 New Approval Request: "${request.title}" requires your approval (Level ${firstLevel}).`,
        requestId: request.id,
      })
    }
  }

  // If user is top-level (auto-approved), change status immediately
  const isTopLevel = approvals.length > 0 && approvals[0].status === 'approved'
  if (isTopLevel) {
    await prisma.requests.update({
      where: { id: request.id },
      data: { status: 'SentToEngineer' },
    })

    await prisma.request_activities.create({
      data: {
        requestId: request.id,
        userId: user.id,
        action: 'status_changed',
        fromStatus: 'ImprovementRequest',
        toStatus: 'SentToEngineer',
        comments: 'Auto-approved by top-level user',
      },
    })
  }

  revalidateRequestViews(request.id)
  revalidatePath('/requests/new')

  return { success: true, requestId: request.id }
}

export interface GetRequestsFilters {
  status?: string
  statuses?: string[]
  departmentId?: string
  requesterId?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  includeArchived?: boolean
}

/**
 * Get requests visible to the current user:
 * - Admins see ALL requests across all departments
 * - Regular users see all requests from their department
 */
export async function getMyRequests(filters?: GetRequestsFilters) {
  const currentUser = await getCurrentUser()

  if (!currentUser) {
    throw new Error('User not found')
  }

  // Build where clause based on user role and department type
  // By default exclude archived requests unless caller opts in
  const showArchived = filters?.includeArchived === true
  let whereClause: any

  if (currentUser.role === 'admin') {
    // Admins see all non-deleted requests
    whereClause = { isDeleted: false, ...(showArchived ? {} : { isArchived: false }) }
  } else if (currentUser.department?.type === 'ENGINEERING') {
    // Engineering users see all non-deleted requests for monitoring purposes
    whereClause = { isDeleted: false, ...(showArchived ? {} : { isArchived: false }) }
  } else {
    // General dept users see:
    // 1. Requests from their own department, OR
    // 2. Requests where they are a required approver in request approval chain, OR
    // 3. Requests where they are a required approver in solution approval chain
    whereClause = {
      isDeleted: false,
      ...(showArchived ? {} : { isArchived: false }),
      OR: [
        // Requests from user's own department
        { departmentId: currentUser.departmentId ?? undefined },
        // Requests where user is a required approver in request approval chain
        {
          approvals: {
            some: {
              requiredApproverId: currentUser.id,
            },
          },
        },
        // Requests where user is a required approver in solution approval chain
        {
          solutions: {
            some: {
              approvals: {
                some: {
                  requiredApproverId: currentUser.id,
                },
              },
            },
          },
        },
      ],
    }
  }

  // Apply filters
  if (filters) {
    if (filters.statuses && filters.statuses.length > 0) {
      whereClause.status = { in: filters.statuses as any }
    } else if (filters.status) {
      whereClause.status = filters.status
    }
    if (filters.departmentId) {
      whereClause.departmentId = filters.departmentId
    }
    if (filters.requesterId) {
      whereClause.requesterId = filters.requesterId
    }
    if (filters.dateFrom || filters.dateTo) {
      whereClause.createdAt = {}
      if (filters.dateFrom) {
        whereClause.createdAt.gte = new Date(filters.dateFrom)
      }
      if (filters.dateTo) {
        const endDate = new Date(filters.dateTo)
        endDate.setHours(23, 59, 59, 999)
        whereClause.createdAt.lte = endDate
      }
    }
    if (filters.search) {
      whereClause.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { id: { contains: filters.search, mode: 'insensitive' } },
        { requester: { name: { contains: filters.search, mode: 'insensitive' } } },
      ]
    }
  }

  const requests = await prisma.requests.findMany({
    where: whereClause,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      requesterId: true,
      departmentId: true,
      department: {
        select: {
          name: true,
        },
      },
      requester: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          fileAttachments: true,
        },
      },
      solutions: {
        select: {
          id: true,
          submittedBy: {
            select: {
              departmentId: true,
            },
          },
          approvals: {
            select: {
              id: true,
              status: true,
              approver: {
                select: { name: true },
              },
              requiredApprover: {
                select: { name: true },
              },
              requiredLevel: true,
              order: true,
              approvedAt: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
      activities: {
        where: { action: 'solution_rejected' },
        take: 1,
      },
      engineerAssignments: {
        select: {
          engineer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      approvals: {
        orderBy: {
          order: 'asc',
        },
        select: {
          id: true,
          status: true,
          requiredLevel: true,
          order: true,
          approvedAt: true,
          isFinalApproval: true,
          approver: {
            select: {
              name: true,
            },
          },
          requiredApprover: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  // Import getApproversAtLevel for loading potential approvers
  const { getApproversAtLevel } = await import('./approvals')

  // Map requests to include proper approvals based on status
  // DesignCostEstimationApproval shows solution approvals, otherwise show request approvals
  const requestsWithApprovals = await Promise.all(requests.map(async (req) => {
    const useSolutionApprovals = req.status === 'DesignCostEstimationApproval' && req.solutions.length > 0

    // Map solution approvals to request approval format
    const solutionApprovals = useSolutionApprovals && req.solutions[0]?.approvals
      ? req.solutions[0].approvals.map(sa => ({
          id: sa.id,
          status: sa.status,
          approver: sa.approver ? { name: sa.approver.name } : null,
          requiredApprover: sa.requiredApprover ? { name: sa.requiredApprover.name } : null,
          requiredLevel: sa.requiredLevel ?? 0,
          order: sa.order,
          approvedAt: sa.approvedAt,
          isFinalApproval: false, // Solution approvals are not final approvals
        }))
      : []

    const rawApprovals = useSolutionApprovals ? solutionApprovals : req.approvals

    // For solution approvals, use the Engineering department (submitter's department)
    // For request approvals, use the request's department
    const approvalDepartmentId = useSolutionApprovals && req.solutions[0]?.submittedBy?.departmentId
      ? req.solutions[0].submittedBy.departmentId
      : req.departmentId

    // Load potential approvers for pending approvals that don't have a requiredApprover
    const approvals = await Promise.all(rawApprovals.map(async (approval) => {
      // If pending and no specific requiredApprover, load potential approvers at this level
      if (approval.status === 'pending' && !approval.requiredApprover && approvalDepartmentId) {
        try {
          const potentialApprovers = await getApproversAtLevel(approvalDepartmentId, approval.requiredLevel)
          return {
            ...approval,
            potentialApprovers: potentialApprovers.map(p => ({ name: p.name })),
          }
        } catch (error) {
          console.error('[getMyRequests] Error loading potential approvers:', error)
          return approval
        }
      }
      return approval
    }))

    return {
      id: req.id,
      title: req.title,
      status: req.status,
      createdAt: req.createdAt,
      updatedAt: req.updatedAt,
      requesterId: req.requesterId,
      department: req.department,
      requester: req.requester,
      _count: req._count,
      hasRejection: req.solutions.some(s =>
        s.approvals && Array.isArray(s.approvals) && s.approvals.some((a: any) => a.status === 'rejected')
      ) || req.approvals.some((a: any) => a.status === 'rejected') || req.activities.length > 0,
      engineerAssignments: req.engineerAssignments,
      approvals,
    }
  }))

  return requestsWithApprovals
}

/**
 * Get a single request by ID with all details
 */
export async function getRequest(id: string) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    throw new Error('Unauthorized')
  }

  const request = await prisma.requests.findUnique({
    where: { id },
    include: {
      requester: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      department: {
        select: {
          name: true,
        },
      },
      fileAttachments: {
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          filePath: true,
          description: true,
          createdAt: true,
          uploadedBy: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      activities: {
        select: {
          id: true,
          action: true,
          fromStatus: true,
          toStatus: true,
          comments: true,
          createdAt: true,
          user: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      },
      approvals: {
        select: {
          id: true,
          status: true,
          comments: true,
          isFinalApproval: true,
          requiredLevel: true,
          order: true,
          createdAt: true,
          approvedAt: true,
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
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      solutions: {
        select: {
          id: true,
          title: true,
          description: true,
          costEstimate: true,
          currency: true,
          timeline: true,
          submittedAt: true,
          createdAt: true,
          updatedAt: true,
          submittedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              departmentId: true,
            },
          },
          approvals: {
            select: {
              id: true,
              status: true,
              comments: true,
              requiredLevel: true,
              order: true,
              createdAt: true,
              approvedAt: true,
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
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
          fileAttachments: {
            select: {
              id: true,
              fileName: true,
              fileType: true,
              fileSize: true,
              filePath: true,
              description: true,
              createdAt: true,
              uploadedBy: {
                select: {
                  name: true,
                },
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
    },
  })

  // Convert Decimal to number for client components
  if (request?.projectEstimateCost !== null && request?.projectEstimateCost !== undefined) {
    request.projectEstimateCost = Number(request.projectEstimateCost) as any
  }

  if (request?.solutions?.[0]) {
    request.solutions[0].costEstimate = Number(request.solutions[0].costEstimate) as any
  }

  if (request) {
    const addPotentialApprovers = async <T extends {
      status: string
      requiredLevel: number | null
      requiredApprover?: { id: string; name: string | null; email: string } | null
    }>(approvals: T[], departmentId: string | null | undefined) => {
      return Promise.all(approvals.map(async (approval) => {
        if (approval.status !== 'pending' || approval.requiredApprover || !approval.requiredLevel || !departmentId) {
          return approval
        }

        try {
          const potentialApprovers = await getApproversAtLevel(departmentId, approval.requiredLevel)
          return {
            ...approval,
            potentialApprovers: potentialApprovers.map((approver) => ({ name: approver.name })),
          }
        } catch (error) {
          console.error('[getRequest] Error loading potential approvers:', error)
          return approval
        }
      }))
    }

    request.approvals = await addPotentialApprovers(request.approvals, request.departmentId) as any

    if (request.solutions?.[0]) {
      const solutionDepartmentId = request.solutions[0].submittedBy?.departmentId
      request.solutions[0].approvals = await addPotentialApprovers(
        request.solutions[0].approvals,
        solutionDepartmentId
      ) as any
    }
  }

  return request
}

/**
 * Get filter options (departments and requesters)
 */
export async function getRequestFilterOptions() {
  const currentUser = await getCurrentUser()

  if (!currentUser) {
    throw new Error('User not found')
  }

  const isAdmin = currentUser.role === 'admin'
  const isEngineering = currentUser.department?.type === 'ENGINEERING'

  // Get departments based on user role
  let departments
  if (isAdmin || isEngineering) {
    // Admin and engineering users see all departments
    departments = await prisma.departments.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    })
  } else {
    // Non-admin, non-engineering: get departments from visible requests
    // (own dept + cross-department via custom approval chains)
    const visibleRequests = await prisma.requests.findMany({
      where: {
        isDeleted: false,
        OR: [
          { departmentId: currentUser.departmentId ?? undefined },
          { approvals: { some: { requiredApproverId: currentUser.id } } },
          { solutions: { some: { approvals: { some: { requiredApproverId: currentUser.id } } } } },
        ],
      },
      select: { departmentId: true },
      distinct: ['departmentId'],
    })

    const visibleDeptIds = [...new Set(visibleRequests.map(r => r.departmentId))]

    departments = await prisma.departments.findMany({
      where: { id: { in: visibleDeptIds } },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    })
  }

  // Get requesters (users who have created requests in visible departments)
  let requesters
  if (isAdmin || isEngineering) {
    // Admin and engineering users see all requesters who have created requests
    requesters = await prisma.user.findMany({
      where: { createdRequests: { some: {} } },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    })
  } else {
    // Non-admin, non-engineering: get requesters from visible requests
    const visibleRequests = await prisma.requests.findMany({
      where: {
        isDeleted: false,
        OR: [
          { departmentId: currentUser.departmentId ?? undefined },
          { approvals: { some: { requiredApproverId: currentUser.id } } },
          { solutions: { some: { approvals: { some: { requiredApproverId: currentUser.id } } } } },
        ],
      },
      select: { requesterId: true },
      distinct: ['requesterId'],
    })

    const visibleRequesterIds = visibleRequests.map(r => r.requesterId)

    requesters = await prisma.user.findMany({
      where: { id: { in: visibleRequesterIds } },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    })
  }

  return { departments, requesters }
}

/**
 * Get requests that need the current user's action (pending approvals)
 */
export async function getMyActionItems() {
  const user = await getCurrentUser()

  if (!user) {
    return []
  }

  // Build OR conditions for request_approvals (department-aware)
  const requestOrConditions: any[] = [
    // Custom chain approvals (always include)
    { requiredApproverId: user.id },
  ]

  // Add hierarchy-based approvals scoped to user's own department
  if (user.level && user.departmentId) {
    requestOrConditions.push({
      requiredLevel: user.level,
      request: { departmentId: user.departmentId },
    })
  }

  // Add cross-department approver assignments
  const crossDeptApprovals = await prisma.department_approvers.findMany({
    where: { approverId: user.id },
    select: { departmentId: true, approverLevel: true },
  })
  for (const cda of crossDeptApprovals) {
    requestOrConditions.push({
      requiredLevel: cda.approverLevel,
      request: { departmentId: cda.departmentId },
    })
  }

  // Build OR conditions for solution_approvals (engineering-role-aware)
  const solutionOrConditions: any[] = [
    { requiredApproverId: user.id },
  ]
  // Only match by level for engineering users (matches canUserApproveSolution logic)
  if (user.level && user.role === 'engineering') {
    solutionOrConditions.push({ requiredLevel: user.level })
  }

  // Find all pending approvals for user's level OR custom approver ID
  const pendingApprovals = await prisma.request_approvals.findMany({
    where: {
      OR: requestOrConditions,
      status: 'pending',
      request: {
        isDeleted: false, // Exclude soft-deleted requests
      },
    },
    include: {
      request: {
        include: {
          department: {
            select: {
              name: true,
            },
          },
          requester: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              fileAttachments: true,
            },
          },
        },
      },
    },
    orderBy: {
      request: {
        createdAt: 'desc',
      },
    },
  })

  // Check if each approval is actually actionable (no pending approvals before it)
  const actionableRequests = []
  const seenRequestIds = new Set<string>()

  for (const approval of pendingApprovals) {
    // Check if there are any pending approvals with lower order
    const blockingApprovals = await prisma.request_approvals.count({
      where: {
        requestId: approval.requestId,
        order: { lt: approval.order },
        status: 'pending',
      },
    })

    // Only include if no blocking approvals
    if (blockingApprovals === 0) {
      if (!seenRequestIds.has(approval.request.id)) {
        seenRequestIds.add(approval.request.id)
        actionableRequests.push({
          id: approval.request.id,
          title: approval.request.title,
          status: approval.request.status,
          createdAt: approval.request.createdAt,
          updatedAt: approval.request.updatedAt,
          requesterId: approval.request.requesterId,
          department: approval.request.department,
          requester: approval.request.requester,
          _count: approval.request._count,
        })
      }
    }
  }

  // Query solution approvals
  const pendingSolutionApprovals = await prisma.solution_approvals.findMany({
    where: {
      OR: solutionOrConditions,
      status: 'pending',
      solution: {
        request: {
          isDeleted: false,
        },
      },
    },
    include: {
      solution: {
        include: {
          request: {
            include: {
              department: {
                select: {
                  name: true,
                },
              },
              requester: {
                select: {
                  id: true,
                  name: true,
                },
              },
              _count: {
                select: {
                  fileAttachments: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: {
      solution: {
        request: {
          createdAt: 'desc',
        },
      },
    },
  })

  // Check actionability for solution approvals
  for (const approval of pendingSolutionApprovals) {
    // Check if there are any pending approvals with lower order
    const blockingSolutionApprovals = await prisma.solution_approvals.count({
      where: {
        solutionId: approval.solutionId,
        order: { lt: approval.order },
        status: 'pending',
      },
    })

    // Only include if no blocking approvals
    if (blockingSolutionApprovals === 0) {
      const request = approval.solution.request

      // Deduplicate by request ID
      if (!seenRequestIds.has(request.id)) {
        seenRequestIds.add(request.id)
        actionableRequests.push({
          id: request.id,
          title: request.title,
          status: request.status,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt,
          requesterId: request.requesterId,
          department: request.department,
          requester: request.requester,
          _count: request._count,
        })
      }
    }
  }

  // Sort by createdAt desc
  actionableRequests.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return actionableRequests
}

const cancelRequestSchema = z.object({
  requestId: z.string().min(1),
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(500, 'Reason too long'),
})

/**
 * Cancel a request (only requester can cancel, only before any approvals)
 */
export async function cancelRequest(input: { requestId: string; reason: string }) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Validate input
  const validatedFields = cancelRequestSchema.safeParse(input)
  if (!validatedFields.success) {
    return {
      success: false,
      errors: validatedFields.error.flatten().fieldErrors,
    }
  }

  const { requestId, reason } = validatedFields.data

  // Get request with approvals
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    include: {
      approvals: {
        where: { status: 'approved' },
      },
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  // Check ownership
  if (request.requesterId !== userId) {
    throw new Error('Only the requester can cancel their own request')
  }

  // Check for existing approved approvals
  // Can cancel as long as ALL approvals are still 'pending' (no one has approved yet)
  // This applies to ANY status - if approval process hasn't started, requester can cancel
  if (request.approvals.length > 0) {
    throw new Error('Cannot cancel - approval process has already started (someone has approved)')
  }

  // Additional check: Don't allow cancelling completed or cancelled requests
  if (request.status === 'Completed' || request.status === 'Cancelled') {
    throw new Error(`Cannot cancel - request is ${request.status}`)
  }

  // Perform cancellation in transaction
  await prisma.$transaction([
    // Update request status
    prisma.requests.update({
      where: { id: requestId },
      data: { status: 'Cancelled' },
    }),
    // Mark all pending approvals as rejected (cleanup)
    prisma.request_approvals.updateMany({
      where: {
        requestId,
        status: 'pending',
      },
      data: { status: 'rejected' },
    }),
    // Log activity
    prisma.request_activities.create({
      data: {
        requestId,
        userId,
        action: 'cancelled',
        fromStatus: 'ImprovementRequest',
        toStatus: 'Cancelled',
        comments: reason,
      },
    }),
  ])

  revalidateRequestViews(requestId)

  return { success: true }
}

const deleteRequestSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(500, 'Reason too long'),
})

/**
 * Delete a request (ADMIN ONLY)
 * - Marks request as deleted (soft delete)
 * - Cleans up file attachments from disk
 * - Preserves audit trail in activities
 * - Logs deletion action
 */
export async function deleteRequest(input: { requestId: string; reason: string }) {
  // Verify user is admin
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  // Validate input
  const validatedFields = deleteRequestSchema.safeParse(input)
  if (!validatedFields.success) {
    return {
      success: false,
      errors: validatedFields.error.flatten().fieldErrors,
    }
  }

  const { requestId, reason } = validatedFields.data

  try {
    // Get request with file attachments before soft delete
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      include: {
        fileAttachments: true,
      },
    })

    if (!request) {
      return {
        success: false,
        error: 'Request not found',
      }
    }

    // Check if already deleted
    if (request.isDeleted) {
      return {
        success: false,
        error: 'Request is already deleted',
      }
    }

    // Get file paths for cleanup
    const filePaths = request.fileAttachments.map(f =>
      path.join(process.cwd(), 'public', f.filePath.replace(/^\//, ''))
    )

    // Perform soft delete and log activity in transaction
    await prisma.$transaction([
      // Soft delete the request
      prisma.requests.update({
        where: { id: requestId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: adminUserId,
        },
      }),
      // Log deletion in audit trail
      prisma.request_activities.create({
        data: {
          requestId,
          action: 'deleted',
          fromStatus: request.status,
          toStatus: request.status,
          comments: `Request deleted by admin. Reason: ${reason}`,
          userId: adminUserId,
        },
      }),
    ])

    // Clean up files from disk (after transaction succeeds)
    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath)
      } catch (error) {
        // Log warning but don't fail the operation
        console.warn(`Failed to delete file at ${filePath}:`, error)
      }
    }

    revalidateRequestViews(requestId)
    revalidatePath('/admin')

    return {
      success: true,
      message: 'Request deleted successfully',
    }
  } catch (error) {
    console.error('Error deleting request:', error)
    return {
      success: false,
      error: 'Failed to delete request',
    }
  }
}

/**
 * Get deleted requests (ADMIN ONLY)
 * For audit/restore purposes
 */
export async function getDeletedRequests() {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    throw new Error('Unauthorized - Admin access required')
  }

  const requests = await prisma.requests.findMany({
    where: { isDeleted: true },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      deletedAt: true,
      requester: {
        select: {
          name: true,
          email: true,
        },
      },
      department: {
        select: {
          name: true,
        },
      },
      deletedByUser: {
        select: {
          name: true,
        },
      },
      activities: {
        where: { action: 'deleted' },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: {
      deletedAt: 'desc',
    },
  })

  return requests
}

/**
 * Permanently delete requests (ADMIN ONLY)
 * - Hard delete from database
 * - Cannot be undone
 * - Used for cleanup of old deleted requests
 */
export async function permanentlyDeleteRequests(input: {
  mode: 'single' | 'older_than_1_year' | 'all' | 'date_range'
  requestId?: string
  dateFrom?: string
  dateTo?: string
}) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    let whereClause: any = { isDeleted: true }

    // Apply filters based on mode
    if (input.mode === 'single' && input.requestId) {
      whereClause.id = input.requestId
    } else if (input.mode === 'older_than_1_year') {
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      whereClause.deletedAt = { lt: oneYearAgo }
    } else if (input.mode === 'date_range' && input.dateFrom && input.dateTo) {
      whereClause.deletedAt = {
        gte: new Date(input.dateFrom),
        lte: new Date(input.dateTo),
      }
    }
    // 'all' mode uses the base isDeleted: true filter

    // Count requests to be deleted
    const count = await prisma.requests.count({ where: whereClause })

    if (count === 0) {
      return {
        success: false,
        error: 'No requests found matching the criteria',
      }
    }

    // Permanent delete (will cascade to fileAttachments, activities, approvals, notifications)
    try {
      // First, get request info for audit logging
      const requestInfo = input.mode === 'single' && input.requestId 
        ? await prisma.requests.findUnique({
            where: { id: input.requestId },
            select: { title: true, requesterId: true }
          })
        : null

      // Use transaction to ensure bypass flag and delete happen in same session
      const result = await prisma.$transaction(async (tx) => {
        // Enable audit bypass for admin hard delete
        await tx.$executeRaw`SET LOCAL app.bypass_audit = 'true'`
        
        // Log the permanent delete action before deleting (this will be deleted too, but we try)
        if (input.mode === 'single' && input.requestId && requestInfo) {
          try {
            await tx.request_activities.create({
              data: {
                requestId: input.requestId,
                userId: adminUserId,
                action: 'permanently_deleted',
                comments: `Request permanently deleted by admin. Title: "${requestInfo.title}"`,
                createdAt: new Date(),
              },
            })
          } catch {
            // Ignore if logging fails - we're about to delete everything anyway
          }
        }
        
        const deleteResult = await tx.requests.deleteMany({
          where: whereClause,
        })
        
        return deleteResult
      })

      // Log admin action separately (outside the transaction that deletes everything)
      await prisma.request_activities.create({
        data: {
          action: 'admin_permanent_delete',
          comments: `Admin permanently deleted ${result.count} request(s). Mode: ${input.mode}${input.requestId ? `, RequestId: ${input.requestId}` : ''}`,
          userId: adminUserId,
          createdAt: new Date(),
        },
      })

      revalidateRequestViews()

      return {
        success: true,
        message: `Permanently deleted ${result.count} requests`,
        count: result.count,
      }
    } catch (deleteError: any) {
      console.error('[permanentlyDeleteRequests] Delete error:', deleteError)
      // Check if this is the audit trail protection error (should not happen with bypass)
      if (deleteError.message?.includes('Cannot modify audit trail') || 
          deleteError.message?.includes('append-only')) {
        return {
          success: false,
          error: 'Permanent delete blocked by audit trail. Migration may not be applied correctly.',
        }
      }
      throw deleteError
    }
  } catch (error) {
    console.error('Error permanently deleting requests:', error)
    return {
      success: false,
      error: 'Failed to permanently delete requests',
    }
  }
}

/**
 * Restore a deleted request (ADMIN ONLY)
 * - Removes soft delete flags
 * - Request becomes visible again
 */
export async function restoreRequest(input: { requestId: string }) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    // Check if request exists and is deleted
    const request = await prisma.requests.findUnique({
      where: { id: input.requestId },
    })

    if (!request) {
      return {
        success: false,
        error: 'Request not found',
      }
    }

    if (!request.isDeleted) {
      return {
        success: false,
        error: 'Request is not deleted',
      }
    }

    // Restore the request
    await prisma.requests.update({
      where: { id: input.requestId },
      data: {
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
      },
    })

    // Log restoration
    await prisma.request_activities.create({
      data: {
        requestId: input.requestId,
        action: 'restored',
        comments: `Request restored by admin`,
        userId: adminUserId,
      },
    })

    revalidateRequestViews(input.requestId)

    return {
      success: true,
      message: 'Request restored successfully',
    }
  } catch (error) {
    console.error('Error restoring request:', error)
    return {
      success: false,
      error: 'Failed to restore request',
    }
  }
}

/**
 * Preview count of requests that would be deleted by date range
 * For admin confirmation before bulk delete
 */
export async function previewDeleteByDateRange(input: {
  dateFrom: string
  dateTo: string
}) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    const fromDate = new Date(input.dateFrom)
    const toDate = new Date(input.dateTo)
    // Include entire end date by setting to end of day
    toDate.setHours(23, 59, 59, 999)

    const requests = await prisma.requests.findMany({
      where: {
        isDeleted: true,
        deletedAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      select: {
        id: true,
        title: true,
        deletedAt: true,
        requester: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        deletedAt: 'desc',
      },
    })

    return {
      success: true,
      count: requests.length,
      requests,
    }
  } catch (error) {
    console.error('Error previewing delete:', error)
    return {
      success: false,
      error: 'Failed to preview requests',
    }
  }
}

/**
 * Bulk soft delete requests by creation date range (ADMIN ONLY)
 * - Preview mode: shows count and list of requests that would be deleted
 * - Delete mode: performs soft delete on all matching requests
 */
export async function bulkDeleteRequestsByDateRange(input: {
  mode: 'preview' | 'delete'
  dateFrom: string
  dateTo: string
}) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    const fromDate = new Date(input.dateFrom)
    const toDate = new Date(input.dateTo)
    // Include entire end date by setting to end of day
    toDate.setHours(23, 59, 59, 999)

    // Find requests created within date range (excluding already deleted ones)
    const requests = await prisma.requests.findMany({
      where: {
        isDeleted: false,
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        requester: {
          select: {
            name: true,
            email: true,
          },
        },
        department: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    if (input.mode === 'preview') {
      return {
        success: true,
        count: requests.length,
        requests,
      }
    }

    // Delete mode - perform soft delete
    const result = await prisma.requests.updateMany({
      where: {
        id: { in: requests.map(r => r.id) },
      },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: adminUserId,
      },
    })

    // Log deletion for each request
    await prisma.request_activities.createMany({
      data: requests.map(r => ({
        requestId: r.id,
        action: 'deleted',
        fromStatus: r.status,
        toStatus: r.status,
        comments: `Bulk deleted by admin. Created: ${new Date(r.createdAt).toLocaleString()}`,
        userId: adminUserId,
      })),
    })

    revalidateRequestViews()

    return {
      success: true,
      count: result.count,
      message: `Soft deleted ${result.count} requests`,
    }
  } catch (error) {
    console.error('Error bulk deleting requests:', error)
    return {
      success: false,
      error: 'Failed to bulk delete requests',
    }
  }
}

// ============================================================================
// PHASE 4: Engineering Dashboard Functions
// ============================================================================

export interface NeedsActionResult {
  needsSolution: Array<{
    request: any
    assignedEngineers: any[]
  }>
  needsApproval: Array<{
    request: any
    solution: any
    approval: any
  }>
}

/**
 * Get requests that need the current engineering user's action
 * Returns two categories:
 * 1. Requests needing solution submission (SentToEngineer status)
 * 2. Solutions needing user's approval (DesignCostEstimationApproval status)
 */
export async function getRequestsNeedingEngineeringAction(userId: string): Promise<NeedsActionResult> {
  const user = await getUserById(userId)

  if (!user || user.role !== 'engineering') {
    return { needsSolution: [], needsApproval: [] }
  }

  // Get engineering department
  const engineeringDept = await prisma.departments.findFirst({
    where: { type: 'ENGINEERING' },
    select: { id: true },
  })

  if (!engineeringDept) {
    return { needsSolution: [], needsApproval: [] }
  }

  // Category 1: Requests needing solution submission
  // Status = SentToEngineer, no solution submitted yet
  const needsSolution = await prisma.requests.findMany({
    where: {
      status: 'SentToEngineer',
      isDeleted: false,
    },
    include: {
      department: {
        select: {
          id: true,
          name: true,
        },
      },
      requester: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      engineerAssignments: {
        include: {
          engineer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  })

  // Check which requests have solutions (for rejection detection)
  // A request in SentToEngineer with a solution means the solution was rejected
  const requestIdsWithSolution = (
    await prisma.solutions.findMany({
      where: {
        requestId: { in: needsSolution.map(r => r.id) },
      },
      select: { requestId: true },
    })
  ).map(s => s.requestId)

  // Include ALL SentToEngineer requests (both fresh and rejected)
  // Requests with solutions are the rejected ones needing resubmission
  const needsSolutionFiltered = needsSolution
    .map(request => ({
      request: {
        ...request,
        hasRejection: requestIdsWithSolution.includes(request.id),
      },
      assignedEngineers: request.engineerAssignments.map(ea => ea.engineer),
    }))

  // Category 2: Solutions needing user's approval
  // For custom chains: requiredApproverId === userId AND status === pending AND all previous orders approved
  // For hierarchy: requiredLevel === user.level AND status === pending AND all previous orders approved
  const needsApproval = await prisma.solutions.findMany({
    where: {
      request: {
        status: 'DesignCostEstimationApproval',
        isDeleted: false,
      },
    },
    include: {
      request: {
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
        },
      },
    },
  })

  // Filter approvals that need this user's action
  const needsApprovalFiltered = []

  for (const solution of needsApproval) {
    // Get pending approvals for this solution
    const pendingApprovals = await prisma.solution_approvals.findMany({
      where: {
        solutionId: solution.id,
        status: 'pending',
      },
      orderBy: {
        order: 'asc',
      },
    })

    // Find the next actionable approval (first in sequence with no pending before it)
    for (const approval of pendingApprovals) {
      // Check if there are any pending approvals before this one
      const blockingApprovals = await prisma.solution_approvals.count({
        where: {
          solutionId: solution.id,
          order: { lt: approval.order },
          status: 'pending',
        },
      })

      if (blockingApprovals === 0) {
        // This is the next actionable approval
        // Check if it's for this user
        const isForUser =
          (approval.requiredApproverId === userId) ||
          (approval.requiredLevel === user.level && !approval.isCustomChain)

        if (isForUser) {
          needsApprovalFiltered.push({
            request: solution.request,
            solution: {
              ...solution,
              costEstimate: Number(solution.costEstimate),
            },
            approval,
          })
          break // Only add one approval per solution
        }
      }
    }
  }

  return {
    needsSolution: needsSolutionFiltered,
    needsApproval: needsApprovalFiltered,
  }
}

/**
 * Assign engineers to a request
 * Validates caller is engineering user and request is in SentToEngineer status
 */
export async function assignEngineers(requestId: string, engineerIds: string[]) {
  const user = await getCurrentUser()

  if (!user || user.role !== 'engineering') {
    throw new Error('Only engineering users can assign engineers')
  }

  // Validate request exists and is in correct status
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { status: true, title: true },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  if (request.status !== 'SentToEngineer') {
    throw new Error('Can only assign engineers to requests in SentToEngineer status')
  }

  // Validate all engineers exist and are in engineering department
  const engineeringDept = await prisma.departments.findFirst({
    where: { type: 'ENGINEERING' },
    select: { id: true },
  })

  if (!engineeringDept) {
    throw new Error('Engineering department not found')
  }

  const engineers = await prisma.user.findMany({
    where: {
      id: { in: engineerIds },
      departmentId: engineeringDept.id,
      role: 'engineering',
    },
    select: { id: true },
  })

  if (engineers.length !== engineerIds.length) {
    throw new Error('One or more engineers not found or not in engineering department')
  }

  // Delete existing assignments
  await prisma.request_engineer_assignments.deleteMany({
    where: { requestId },
  })

  // Create new assignments
  if (engineerIds.length > 0) {
    await prisma.request_engineer_assignments.createMany({
      data: engineerIds.map(engineerId => ({
        requestId,
        engineerId,
        assignedById: user.id,
      })),
    })
  }

  // Log activity
  await prisma.request_activities.create({
    data: {
      requestId,
      userId: user.id,
      action: 'engineers_assigned',
      comments: `${engineerIds.length} engineer(s) assigned to request`,
    },
  })

  // Notify assigned engineers (reusing request variable from above)
  if (engineerIds.length > 0 && request) {
    const { createNotification } = await import('./notifications')
    await Promise.all(
      engineerIds.map(engineerId =>
        createNotification({
          userId: engineerId,
          type: 'request_assigned',
          title: 'PIC Assignment',
          message: `👤 PIC Assignment: You have been assigned to "${request.title}". Please review and submit your solution.`,
          requestId,
        })
      )
    )
  }

  revalidateRequestViews(requestId)

  return { success: true }
}

/**
 * Get all engineering users
 * Used for Person in Charge selector
 */
export async function getEngineeringUsers() {
  const currentUser = await getCurrentUser()
  if (!currentUser) {
    throw new Error('Unauthorized')
  }

  const engineeringDept = await prisma.departments.findFirst({
    where: { type: 'ENGINEERING' },
    select: { id: true },
  })

  if (!engineeringDept) {
    return []
  }

  const users = await prisma.user.findMany({
    where: {
      departmentId: engineeringDept.id,
      role: 'engineering',
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      level: true,
    },
    orderBy: [
      { level: 'desc' },
      { name: 'asc' },
    ],
  })

  return users
}

export interface GetRequestsForEngineeringFilters {
  departmentId?: string
  assignedEngineerId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

/**
 * Get requests for engineering view
 * Base query: status IN (SentToEngineer, DesignCostEstimationApproval)
 */
export async function getRequestsForEngineering(filters?: GetRequestsForEngineeringFilters) {
  const user = await getCurrentUser()

  if (!user || user.role !== 'engineering') {
    throw new Error('Only engineering users can access engineering requests')
  }

  // Build where clause
  const whereClause: any = {
    status: {
      in: ['SentToEngineer', 'DesignCostEstimationApproval'],
    },
    isDeleted: false,
  }

  // Apply filters
  if (filters) {
    if (filters.departmentId) {
      whereClause.departmentId = filters.departmentId
    }
    if (filters.assignedEngineerId) {
      whereClause.engineerAssignments = {
        some: {
          engineerId: filters.assignedEngineerId,
        },
      }
    }
    if (filters.status) {
      whereClause.status = filters.status
    }
    if (filters.dateFrom || filters.dateTo) {
      whereClause.createdAt = {}
      if (filters.dateFrom) {
        whereClause.createdAt.gte = new Date(filters.dateFrom)
      }
      if (filters.dateTo) {
        const endDate = new Date(filters.dateTo)
        endDate.setHours(23, 59, 59, 999)
        whereClause.createdAt.lte = endDate
      }
    }
    if (filters.search) {
      whereClause.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { id: { contains: filters.search, mode: 'insensitive' } },
        { requester: { name: { contains: filters.search, mode: 'insensitive' } } },
      ]
    }
  }

  const requests = await prisma.requests.findMany({
    where: whereClause,
    include: {
      department: {
        select: {
          name: true,
        },
      },
      requester: {
        select: {
          id: true,
          name: true,
        },
      },
      engineerAssignments: {
        include: {
          engineer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      solutions: {
        take: 1,
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          title: true,
          costEstimate: true,
          currency: true,
          submittedAt: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  return requests
}

/**
 * Resubmit a rejected request
 * - Validates that request has rejections and requester owns it
 * - Optionally updates title and description
 * - Deletes all existing approvals (rejected and approved)
 * - Creates fresh approval chain
 * - Resets status to ImprovementRequest
 * - Logs activity
 */
export async function resubmitRequest(input: {
  requestId: string
  title?: string
  description?: string
}) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get request with approvals
  const request = await prisma.requests.findUnique({
    where: { id: input.requestId },
    include: {
      approvals: true,
      requester: {
        include: {
          department: true,
        },
      },
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  // Verify requester ownership
  if (request.requesterId !== userId) {
    throw new Error('Only the requester can resubmit this request')
  }

  // Verify request has rejections
  const hasRejection = request.approvals.some((a) => a.status === 'rejected')
  if (!hasRejection) {
    throw new Error('Request does not have any rejections')
  }

  // Verify status allows resubmit (ImprovementRequest means department approval phase)
  if (request.status !== 'ImprovementRequest') {
    throw new Error(
      'Request can only be resubmitted during department approval phase'
    )
  }

  // Validate optional updates
  if (input.title !== undefined) {
    const titleValidation = z
      .string()
      .min(1, 'Title is required')
      .max(200, 'Title too long')
      .safeParse(input.title)
    if (!titleValidation.success) {
      throw new Error(titleValidation.error.issues[0].message)
    }
  }

  if (input.description !== undefined) {
    const descValidation = z
      .string()
      .min(1, 'Description is required')
      .max(5000, 'Description too long')
      .safeParse(input.description)
    if (!descValidation.success) {
      throw new Error(descValidation.error.issues[0].message)
    }
  }

  // Perform resubmit in transaction
  const result = await prisma.$transaction(async (tx) => {
    // Update request if title/description provided
    const updateData: any = {}
    if (input.title !== undefined) updateData.title = input.title
    if (input.description !== undefined)
      updateData.description = input.description

    const updatedRequest = await tx.requests.update({
      where: { id: input.requestId },
      data: updateData,
    })

    // Delete all existing approvals
    await tx.request_approvals.deleteMany({
      where: {
        requestId: input.requestId,
      },
    })

    // Log resubmit activity
    await tx.request_activities.create({
      data: {
        requestId: input.requestId,
        action: 'resubmitted',
        toStatus: 'ImprovementRequest',
        comments: 'Request resubmitted after rejection',
        userId,
      },
    })

    return updatedRequest
  })

  // Create fresh approval chain
  const userLevel = request.requester.level || 1
  const departmentId = request.requester.departmentId!
  await createApprovalChain(input.requestId, departmentId, userLevel, userId)

  revalidateRequestViews(input.requestId)

  return { success: true, request: result }
}

// ---------------------------------------------------------------------------
// Retention management (ADMIN ONLY)
// ---------------------------------------------------------------------------

/**
 * Archive a single request (ADMIN ONLY)
 * Marks request as archived so it is hidden from default listings.
 */
export async function archiveRequest(requestId: string) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { id: true, isArchived: true, isDeleted: true },
    })

    if (!request) {
      return { success: false, error: 'Request not found' }
    }

    if (request.isDeleted) {
      return { success: false, error: 'Cannot archive a deleted request' }
    }

    if (request.isArchived) {
      return { success: false, error: 'Request is already archived' }
    }

    await prisma.$transaction([
      prisma.requests.update({
        where: { id: requestId },
        data: { isArchived: true },
      }),
      prisma.request_activities.create({
        data: {
          requestId,
          action: 'archived',
          comments: 'Request archived by admin',
          userId: adminUserId,
        },
      }),
    ])

    revalidateRequestViews(requestId)

    return { success: true }
  } catch (error) {
    console.error('Error archiving request:', error)
    return { success: false, error: 'Failed to archive request' }
  }
}

/**
 * Permanently hard-delete a single request (ADMIN ONLY)
 * Cannot be undone. Removes all associated data.
 */
export async function permanentDeleteRequest(requestId: string) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { id: true },
    })

    if (!request) {
      return { success: false, error: 'Request not found' }
    }

    // Soft delete — hard delete is blocked by the append-only audit trail trigger on request_activities
    await prisma.requests.update({
      where: { id: requestId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: adminUserId,
      },
    })

    revalidateRequestViews(requestId)

    return { success: true }
  } catch (error) {
    console.error('Error permanently deleting request:', error)
    return { success: false, error: 'Failed to delete request' }
  }
}

/**
 * Get all requests for the retention management page (ADMIN ONLY)
 * Includes archived requests. Can be filtered.
 */
export async function getAllRequestsForRetention(includeArchived: boolean = true) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    throw new Error('Unauthorized - Admin access required')
  }

  const whereClause: any = { isDeleted: false }
  if (!includeArchived) {
    whereClause.isArchived = false
  }

  const requests = await prisma.requests.findMany({
    where: whereClause,
    select: {
      id: true,
      title: true,
      status: true,
      isArchived: true,
      createdAt: true,
      updatedAt: true,
      requester: {
        select: { name: true, email: true },
      },
      department: {
        select: { name: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return requests
}
