'use server'
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
  // Privileged admin audit: ordinary request visibility and list exclusions are not applied.
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
          organizationUnitId: true,
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
          organizationUnitId: true,
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
