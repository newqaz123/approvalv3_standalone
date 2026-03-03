'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

/**
 * Query options for paginated audit trail queries
 */
export interface AuditQueryOptions {
  skip?: number
  take?: number
  dateFrom?: Date
  dateTo?: Date
}

/**
 * Get audit trail for a specific request
 * Returns all RequestActivity records for the request with related user and request data
 *
 * @param requestId - ID of the request to query
 * @returns Array of activity records ordered by createdAt DESC (newest first)
 * @throws Error if not authenticated or not admin
 */
export async function getAuditTrailForRequest(requestId: string) {
  // Admin-only access
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    throw new Error('Unauthorized - Admin access required')
  }

  const activities = await prisma.request_activities.findMany({
    where: {
      requestId: requestId,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      request: {
        select: {
          id: true,
          title: true,
          departmentId: true,
          status: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  return activities
}

/**
 * Get audit trail for a date range
 * Returns RequestActivity records within the specified date range
 * Supports pagination for large result sets
 *
 * @param startDate - Start of date range (inclusive)
 * @param endDate - End of date range (inclusive)
 * @param options - Optional pagination (skip, take)
 * @returns Array of activity records ordered by createdAt DESC (newest first)
 * @throws Error if not authenticated or not admin
 */
export async function getAuditTrailForDateRange(
  startDate: Date,
  endDate: Date,
  options?: AuditQueryOptions
) {
  // Admin-only access
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    throw new Error('Unauthorized - Admin access required')
  }

  const activities = await prisma.request_activities.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      request: {
        select: {
          id: true,
          title: true,
          departmentId: true,
          status: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: options?.take || 100,
    skip: options?.skip || 0,
  })

  return activities
}

/**
 * Get audit trail for a specific user
 * Returns all activities performed by the user
 *
 * Access control:
 * - Admins can see all user activities
 * - Regular users can only see their own activities
 *
 * @param userId - ID of the user to query
 * @param options - Optional pagination and date range filter
 * @returns Array of activity records ordered by createdAt DESC (newest first)
 * @throws Error if not authenticated or unauthorized
 */
export async function getAuditTrailForUser(
  userId: string,
  options?: AuditQueryOptions
) {
  const { user: _authUser } = (await auth()) ?? {}; const currentUserId = _authUser?.id

  if (!currentUserId) {
    throw new Error('Unauthorized')
  }

  // Check if current user is admin
  const currentUser = await prisma.user.findUnique({
    where: { id: currentUserId },
    select: { role: true },
  })

  if (!currentUser) {
    throw new Error('User not found')
  }

  // Access control: Admins see all, users see only their own
  const isAdmin = currentUser.role === 'admin'
  if (!isAdmin && currentUserId !== userId) {
    throw new Error('Unauthorized - Can only view own activity history')
  }

  // Build where clause
  const whereClause: any = {
    userId: userId,
  }

  // Apply optional date range filter
  if (options?.dateFrom || options?.dateTo) {
    whereClause.createdAt = {}
    if (options.dateFrom) {
      whereClause.createdAt.gte = options.dateFrom
    }
    if (options.dateTo) {
      whereClause.createdAt.lte = options.dateTo
    }
  }

  const activities = await prisma.request_activities.findMany({
    where: whereClause,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      request: {
        select: {
          id: true,
          title: true,
          departmentId: true,
          status: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: options?.take || 100,
    skip: options?.skip || 0,
  })

  return activities
}
