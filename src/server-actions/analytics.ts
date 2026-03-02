'use server'

import { auth } from '@clerk/nextjs/server'
import prisma from '@/lib/prisma'
import { subDays, startOfDay, endOfDay, differenceInMinutes } from 'date-fns'
import type {
  AnalyticsData,
  AnalyticsFilters,
  WorkflowPipelineSegment,
  TimeMetrics,
  SummaryMetrics,
} from '@/types/analytics'

/**
 * Get analytics data with applied filters
 * Returns complete analytics data structure for dashboard
 */
export async function getAnalyticsData(filters: AnalyticsFilters): Promise<AnalyticsData> {
  const { userId } = await auth()

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Calculate date range filter
  const dateFilter = getDateRangeFilter(filters.dateRange)

  // Build where clause for Prisma queries
  const whereClause: any = {
    isDeleted: false,
    ...(dateFilter && { createdAt: dateFilter }),
    ...(filters.departmentId && { departmentId: filters.departmentId }),
    ...(filters.status && { status: filters.status }),
    ...(filters.requesterId && { requesterId: filters.requesterId }),
  }

  // Fetch all data sources in parallel to eliminate waterfalls
  // These fetch operations are independent and can execute concurrently
  const [pipeline, departments, timeMetrics, summary] = await Promise.all([
    fetchPipelineData(whereClause),
    fetchDepartmentData(whereClause),
    fetchTimeMetrics(whereClause),
    fetchSummaryMetrics(whereClause),
  ])

  return {
    pipeline,
    departments,
    timeMetrics,
    summary,
  }
}

/**
 * Get analytics filter options
 * Returns departments and users for filter dropdowns
 */
export async function getAnalyticsFilters(): Promise<{
  departments: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
}> {
  const { userId } = await auth()

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Fetch all departments
  const departments = await prisma.department.findMany({
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      name: 'asc',
    },
  })

  // Fetch all active users
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      name: 'asc',
    },
  })

  return {
    departments,
    users,
  }
}

/**
 * Calculate date range filter from preset
 */
function getDateRangeFilter(preset: AnalyticsFilters['dateRange']) {
  if (preset === 'all') {
    return undefined
  }

  const now = new Date()
  const daysMap = { '7days': 7, '30days': 30, '90days': 90 }
  const days = daysMap[preset]

  if (!days) {
    return undefined
  }

  return {
    gte: startOfDay(subDays(now, days)),
    lte: endOfDay(now),
  }
}

/**
 * Fetch workflow pipeline data
 * Groups requests by status and counts each status
 */
async function fetchPipelineData(
  whereClause: any
): Promise<WorkflowPipelineSegment[]> {
  // Get all requests matching the filter
  const requests = await prisma.request.findMany({
    where: whereClause,
    select: {
      status: true,
    },
  })

  // Group by status
  const statusCounts = requests.reduce(
    (acc, req) => {
      acc[req.status] = (acc[req.status] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  // Map to workflow segments
  const statusMap: Record<string, 'pending' | 'approved' | 'rejected'> = {
    ImprovementRequest: 'pending',
    SentToEngineer: 'pending',
    DesignCostEstimationApproval: 'pending',
    SendBackToRequester: 'pending',
    FinalApproval: 'pending',
    Completed: 'approved',
    Cancelled: 'rejected',
  }

  // Build pipeline segments for each status
  const segments: WorkflowPipelineSegment[] = Object.keys(statusCounts).map((status) => {
    const statusType = statusMap[status] || 'pending'
    return {
      step: status,
      pending: statusType === 'pending' ? statusCounts[status] : 0,
      approved: statusType === 'approved' ? statusCounts[status] : 0,
      rejected: statusType === 'rejected' ? statusCounts[status] : 0,
    }
  })

  return segments
}

/**
 * Fetch department breakdown data
 * Groups requests by department and counts each
 */
async function fetchDepartmentData(
  whereClause: any
): Promise<Array<{ name: string; value: number }>> {
  const requests = await prisma.request.findMany({
    where: whereClause,
    select: {
      department: {
        select: {
          name: true,
        },
      },
    },
  })

  // Group by department name
  const deptCounts = requests.reduce((acc, req) => {
    const deptName = req.department?.name || 'Unknown'
    acc[deptName] = (acc[deptName] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Convert to array format
  return Object.entries(deptCounts).map(([name, value]) => ({ name, value: value as number }))
}

/**
 * Fetch and calculate time metrics
 * Calculates approval time statistics from completed requests
 */
async function fetchTimeMetrics(whereClause: any): Promise<TimeMetrics> {
  // Fetch completed requests with their approval dates
  const requests = await prisma.request.findMany({
    where: {
      ...whereClause,
      status: 'Completed',
    },
    select: {
      id: true,
      createdAt: true,
      approvals: {
        where: {
          approvedAt: { not: null },
        },
        select: {
          approvedAt: true,
        },
        orderBy: {
          approvedAt: 'asc',
        },
      },
    },
  })

  // Calculate approval times
  const approvalTimes: number[] = []
  const approvalLevelTimes: number[] = []

  for (const request of requests) {
    if (request.approvals.length > 0) {
      // Get the first and last approval dates
      const firstApproval = request.approvals[0].approvedAt!
      const lastApproval = request.approvals[request.approvals.length - 1].approvedAt!

      // Total time from request creation to final approval (in hours)
      const totalTime = differenceInMinutes(lastApproval, request.createdAt) / 60
      approvalTimes.push(totalTime)

      // Calculate time per approval level
      for (let i = 0; i < request.approvals.length; i++) {
        const approval = request.approvals[i]
        if (approval.approvedAt) {
          const prevDate = i === 0 ? request.createdAt : request.approvals[i - 1].approvedAt!
          const levelTime = differenceInMinutes(approval.approvedAt, prevDate) / 60
          approvalLevelTimes.push(levelTime)
        }
      }
    }
  }

  // Handle empty data case
  if (approvalTimes.length === 0) {
    return {
      avgPerRequest: 0,
      avgPerApprovalLevel: 0,
      medianPerRequest: 0,
      minPerRequest: 0,
      maxPerRequest: 0,
    }
  }

  // Calculate statistics
  const avgPerRequest =
    approvalTimes.reduce((sum, time) => sum + time, 0) / approvalTimes.length
  const avgPerApprovalLevel =
    approvalLevelTimes.length > 0
      ? approvalLevelTimes.reduce((sum, time) => sum + time, 0) / approvalLevelTimes.length
      : 0
  const minPerRequest = Math.min(...approvalTimes)
  const maxPerRequest = Math.max(...approvalTimes)

  // Calculate median
  const sorted = [...approvalTimes].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianPerRequest =
    sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2

  return {
    avgPerRequest: Number(avgPerRequest.toFixed(2)),
    avgPerApprovalLevel: Number(avgPerApprovalLevel.toFixed(2)),
    medianPerRequest: Number(medianPerRequest.toFixed(2)),
    minPerRequest: Number(minPerRequest.toFixed(2)),
    maxPerRequest: Number(maxPerRequest.toFixed(2)),
  }
}

/**
 * Fetch and calculate summary metrics
 * Provides quick overview statistics
 */
async function fetchSummaryMetrics(whereClause: any): Promise<SummaryMetrics> {
  // Fetch all matching requests
  const requests = await prisma.request.findMany({
    where: whereClause,
    select: {
      status: true,
      createdAt: true,
      approvals: {
        where: {
          approvedAt: { not: null },
        },
        select: {
          approvedAt: true,
        },
      },
    },
  })

  // Handle empty data case
  if (requests.length === 0) {
    return {
      totalRequests: 0,
      pendingRequests: 0,
      avgApprovalTime: 0,
      approvalRate: 0,
    }
  }

  // Calculate total requests
  const totalRequests = requests.length

  // Calculate pending requests (all non-completed statuses)
  const pendingRequests = requests.filter((req) => req.status !== 'Completed' && req.status !== 'Cancelled').length

  // Calculate average approval time (for completed requests only)
  const completedRequests = requests.filter((req) => req.status === 'Completed')
  let avgApprovalTime = 0

  if (completedRequests.length > 0) {
    const approvalTimes = completedRequests
      .map((req) => {
        const lastApproval = req.approvals[req.approvals.length - 1]?.approvedAt
        if (lastApproval) {
          return differenceInMinutes(lastApproval, req.createdAt) / 60
        }
        return null
      })
      .filter((time): time is number => time !== null)

    if (approvalTimes.length > 0) {
      avgApprovalTime = approvalTimes.reduce((sum, time) => sum + time, 0) / approvalTimes.length
    }
  }

  // Calculate approval rate
  const approvalRate = totalRequests > 0 ? (completedRequests.length / totalRequests) * 100 : 0

  return {
    totalRequests,
    pendingRequests,
    avgApprovalTime: Number(avgApprovalTime.toFixed(2)),
    approvalRate: Number(approvalRate.toFixed(2)),
  }
}
