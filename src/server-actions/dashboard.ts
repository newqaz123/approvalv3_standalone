'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { getCurrentUser } from '@/lib/cache/user-cache'

export type RequestListRow = {
  id: string
  title: string
  status: string
  createdAt: Date
  requesterId: string
  department: { name: string } | null
  requester: { id: string; name: string } | null
  _count: { fileAttachments: number }
  hasRejection?: boolean
  approvals: Array<{
    id: string
    status: 'pending' | 'approved' | 'rejected'
    approver?: { name: string } | null
    requiredApprover?: { name: string } | null
    requiredLevel: number
    order: number
    approvedAt?: Date | null
    isFinalApproval: boolean
  }>
}

/**
 * Get pending approvals for the current user
 * Returns requests where user is the next approver in the chain
 */
export async function getPendingMyApprovals(): Promise<RequestListRow[]> {
  const user = await getCurrentUser()

  if (!user) {
    return []
  }

  // Build OR conditions for approval query
  const orConditions: any[] = [
    // Custom chain approvals (always include)
    { requiredApproverId: user.id },
  ]

  // Add hierarchy-based approvals if user has a level
  if (user.level) {
    orConditions.push({ requiredLevel: user.level })
  }

  // Find all pending approvals for user's level OR custom approver ID
  const pendingApprovals = await prisma.request_approvals.findMany({
    where: {
      OR: orConditions,
      status: 'pending',
      request: {
        isDeleted: false,
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
      },
    },
    orderBy: {
      request: {
        createdAt: 'desc',
      },
    },
  })

  // Import getApproversAtLevel for loading potential approvers
  const { getApproversAtLevel } = await import('./approvals')

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
      // Check if this request has any rejected solution approvals
      const hasRejection = await prisma.solutions.count({
        where: {
          requestId: approval.requestId,
          approvals: {
            some: {
              status: 'rejected',
            },
          },
        },
      }) > 0

      if (!seenRequestIds.has(approval.request.id)) {
        seenRequestIds.add(approval.request.id)

        // Load potential approvers for pending approvals without requiredApprover
        const approvals = await Promise.all(approval.request.approvals.map(async (a) => {
          if (a.status === 'pending' && !a.requiredApprover && approval.request.departmentId) {
            try {
              const potentialApprovers = await getApproversAtLevel(approval.request.departmentId, a.requiredLevel)
              return {
                ...a,
                potentialApprovers: potentialApprovers.map(p => ({ name: p.name })),
              }
            } catch (error) {
              console.error('[getPendingMyApprovals] Error loading potential approvers:', error)
              return a
            }
          }
          return a
        }))

        actionableRequests.push({
          id: approval.request.id,
          title: approval.request.title,
          status: approval.request.status,
          createdAt: approval.request.createdAt,
          requesterId: approval.request.requesterId,
          department: approval.request.department,
          requester: approval.request.requester,
          _count: approval.request._count,
          hasRejection,
          approvals,
        })
      }
    }
  }

  // Query solution approvals
  const pendingSolutionApprovals = await prisma.solution_approvals.findMany({
    where: {
      OR: orConditions,
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
      // Check if this solution has any rejected approvals
      const hasRejection = await prisma.solution_approvals.count({
        where: {
          solutionId: approval.solutionId,
          status: 'rejected',
        },
      }) > 0

      const request = approval.solution.request

      // Deduplicate by request ID
      if (!seenRequestIds.has(request.id)) {
        seenRequestIds.add(request.id)

        // Load potential approvers for pending approvals without requiredApprover
        const approvals = await Promise.all(request.approvals.map(async (a) => {
          if (a.status === 'pending' && !a.requiredApprover && request.departmentId) {
            try {
              const potentialApprovers = await getApproversAtLevel(request.departmentId, a.requiredLevel)
              return {
                ...a,
                potentialApprovers: potentialApprovers.map(p => ({ name: p.name })),
              }
            } catch (error) {
              console.error('[getPendingMyApprovals] Error loading potential approvers:', error)
              return a
            }
          }
          return a
        }))

        actionableRequests.push({
          id: request.id,
          title: request.title,
          status: request.status,
          createdAt: request.createdAt,
          requesterId: request.requesterId,
          department: request.department,
          requester: request.requester,
          _count: request._count,
          hasRejection,
          approvals,
        })
      }
    }
  }

  return actionableRequests
}

/**
 * Get requests created by the current user
 */
export async function getMyCreatedRequests(): Promise<RequestListRow[]> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    throw new Error('Unauthorized')
  }

  const requests = await prisma.requests.findMany({
    where: {
      requesterId: userId,
      isDeleted: false,
    },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
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

  // Process requests and load potential approvers
  const processedRequests = await Promise.all(requests.map(async (req) => {
    // Determine which approvals to show based on status
    // DesignCostEstimationApproval shows solution approvals, otherwise show request approvals
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
      // If pending and no specific requiredApprover, load potential approvers at that level
      if (approval.status === 'pending' && !approval.requiredApprover && approvalDepartmentId) {
        try {
          const potentialApprovers = await getApproversAtLevel(approvalDepartmentId, approval.requiredLevel)
          return {
            ...approval,
            potentialApprovers: potentialApprovers.map(p => ({ name: p.name })),
          }
        } catch (error) {
          console.error('[getMyCreatedRequests] Error loading potential approvers:', error)
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
      requesterId: req.requesterId,
      department: req.department,
      requester: req.requester,
      _count: req._count,
      hasRejection: req.solutions.some(s =>
        s.approvals && Array.isArray(s.approvals) && s.approvals.some((a: any) => a.status === 'rejected')
      ) || req.approvals.some((a: any) => a.status === 'rejected'),
      approvals,
    }
  }))

  return processedRequests
}

/**
 * Get all requests visible to the current user
 * - Admins: all non-deleted requests
 * - Engineering: all non-deleted requests (for monitoring)
 * - General dept: requests from their department only
 */
export async function getAllRequests(): Promise<RequestListRow[]> {
  const currentUser = await getCurrentUser()

  if (!currentUser) {
    throw new Error('User not found')
  }

  // Build where clause based on user role and department type
  let whereClause: any

  if (currentUser.role === 'admin') {
    // Admins see all non-deleted requests
    whereClause = { isDeleted: false }
  } else if (currentUser.department?.type === 'ENGINEERING') {
    // Engineering users see all non-deleted requests for monitoring purposes
    whereClause = { isDeleted: false }
  } else {
    // General dept users see:
    // 1. Requests from their own department, OR
    // 2. Requests where they are a required approver in request approval chain, OR
    // 3. Requests where they are a required approver in solution approval chain
    whereClause = {
      isDeleted: false,
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

  const requests = await prisma.requests.findMany({
    where: whereClause,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
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

  // Process requests and load potential approvers
  const processedRequests = await Promise.all(requests.map(async (req) => {
    // Determine which approvals to show based on status
    // DesignCostEstimationApproval shows solution approvals, otherwise show request approvals
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
          console.error('[getAllRequests] Error loading potential approvers:', error)
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
      requesterId: req.requesterId,
      department: req.department,
      requester: req.requester,
      _count: req._count,
      hasRejection: req.solutions.some(s =>
        s.approvals && Array.isArray(s.approvals) && s.approvals.some((a: any) => a.status === 'rejected')
      ) || req.approvals.some((a: any) => a.status === 'rejected'),
      approvals,
    }
  }))

  return processedRequests
}
