'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { subDays, startOfDay, endOfDay, differenceInMinutes, format } from 'date-fns'
import type {
  AnalyticsData,
  AnalyticsFilters,
  WorkflowPipelineSegment,
  TimeMetrics,
  SummaryMetrics,
  TrendData,
  TimelinePoint,
  Bottleneck,
  EngineeringMetrics,
  EngineeringCycle,
  DepartmentApprovalSpeed,
} from '@/types/analytics'

/**
 * Get analytics data with applied filters
 * Returns complete analytics data structure for dashboard
 */
export async function getAnalyticsData(filters: AnalyticsFilters): Promise<AnalyticsData> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

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

  // Calculate previous period where clause for trend comparison
  const prevDateFilter = getPreviousPeriodFilter(filters.dateRange)
  const prevWhereClause: any = {
    isDeleted: false,
    ...(prevDateFilter && { createdAt: prevDateFilter }),
    ...(filters.departmentId && { departmentId: filters.departmentId }),
    ...(filters.status && { status: filters.status }),
    ...(filters.requesterId && { requesterId: filters.requesterId }),
  }

  // Fetch all data sources in parallel to eliminate waterfalls
  const [pipeline, departments, timeMetrics, summary, prevSummary, timeline, bottlenecks, engineeringMetrics, departmentSpeeds] = await Promise.all([
    fetchPipelineData(whereClause),
    fetchDepartmentData(whereClause),
    fetchTimeMetrics(whereClause),
    fetchSummaryMetrics(whereClause),
    fetchSummaryMetrics(prevWhereClause),
    fetchTimeline(whereClause, filters.dateRange),
    fetchBottlenecks(),
    fetchEngineeringMetrics(whereClause),
    fetchDepartmentSpeeds(whereClause),
  ])

  // Calculate trends by comparing current vs previous period
  const trends = calculateTrends(summary, prevSummary)

  return {
    pipeline,
    departments,
    timeMetrics,
    summary,
    trends,
    timeline,
    bottlenecks,
    engineeringMetrics,
    departmentSpeeds,
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
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Fetch all departments
  const departments = await prisma.departments.findMany({
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
  const requests = await prisma.requests.findMany({
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
  const requests = await prisma.requests.findMany({
    where: {
      ...whereClause,
      status: { not: 'Cancelled' },
    },
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
  const requests = await prisma.requests.findMany({
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
  const requests = await prisma.requests.findMany({
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
      cancelledCount: 0,
      avgApprovalTime: 0,
      approvalRate: 0,
    }
  }

  // Calculate total requests
  const totalRequests = requests.length

  // Calculate cancelled count
  const cancelledCount = requests.filter((req) => req.status === 'Cancelled').length

  // Calculate pending requests (all non-completed, non-cancelled statuses)
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

  // Calculate completion rate: completed / (total - cancelled)
  // Cancelled requests are excluded from the denominator since they aren't actionable
  const activeDenominator = totalRequests - cancelledCount
  const approvalRate = activeDenominator > 0 ? (completedRequests.length / activeDenominator) * 100 : 0

  return {
    totalRequests,
    pendingRequests,
    cancelledCount,
    avgApprovalTime: Number(avgApprovalTime.toFixed(2)),
    approvalRate: Number(approvalRate.toFixed(2)),
  }
}

/**
 * Calculate previous period date filter for trend comparison
 * e.g., if current = last 30 days, previous = 30-60 days ago
 */
function getPreviousPeriodFilter(preset: AnalyticsFilters['dateRange']) {
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
    gte: startOfDay(subDays(now, days * 2)),
    lte: endOfDay(subDays(now, days)),
  }
}

/**
 * Fetch request volume timeline data
 * Returns daily created/completed counts for the date range
 */
async function fetchTimeline(
  whereClause: any,
  dateRange: AnalyticsFilters['dateRange']
): Promise<TimelinePoint[]> {
  const requests = await prisma.requests.findMany({
    where: whereClause,
    select: {
      createdAt: true,
      status: true,
      updatedAt: true,
    },
  })

  // Determine the number of days to show
  const daysMap: Record<string, number> = { '7days': 7, '30days': 30, '90days': 90, 'all': 90 }
  const days = daysMap[dateRange] || 30

  // Build day-by-day map
  const timeline: TimelinePoint[] = []
  const now = new Date()

  for (let i = days - 1; i >= 0; i--) {
    const date = subDays(now, i)
    const dateStr = format(date, 'MMM dd')
    const dayStart = startOfDay(date)
    const dayEnd = endOfDay(date)

    const created = requests.filter(
      (r) =>
        r.status !== 'Cancelled' &&
        r.createdAt >= dayStart &&
        r.createdAt <= dayEnd
    ).length

    const completed = requests.filter(
      (r) =>
        r.status === 'Completed' &&
        r.updatedAt >= dayStart &&
        r.updatedAt <= dayEnd
    ).length

    timeline.push({ date: dateStr, created, completed })
  }

  return timeline
}

/**
 * Fetch bottleneck data - requests stuck at each workflow step
 * Only considers non-terminal statuses with significant wait times
 */
async function fetchBottlenecks(): Promise<Bottleneck[]> {
  const stepLabels: Record<string, string> = {
    ImprovementRequest: 'Improvement Request',
    SentToEngineer: 'Sent to Engineer',
    DesignCostEstimationApproval: 'Cost Estimation',
    SendBackToRequester: 'Sent Back to Requester',
    FinalApproval: 'Final Approval',
  }

  const activeStatuses = Object.keys(stepLabels)

  const requests = await prisma.requests.findMany({
    where: {
      isDeleted: false,
      status: { in: activeStatuses as any },
    },
    select: {
      status: true,
      updatedAt: true,
    },
  })

  const now = new Date()
  const stepGroups: Record<string, number[]> = {}

  for (const req of requests) {
    const status = req.status as string
    if (!stepGroups[status]) {
      stepGroups[status] = []
    }
    const waitHours = differenceInMinutes(now, req.updatedAt) / 60
    stepGroups[status].push(waitHours)
  }

  const bottlenecks: Bottleneck[] = Object.entries(stepGroups)
    .map(([step, waitTimes]) => ({
      step,
      label: stepLabels[step] || step,
      count: waitTimes.length,
      avgWaitHours: Number(
        (waitTimes.reduce((s, t) => s + t, 0) / waitTimes.length).toFixed(1)
      ),
    }))
    .filter((b) => b.count > 0)
    .sort((a, b) => b.avgWaitHours - a.avgWaitHours)

  return bottlenecks
}

/**
 * Fetch engineering KPI metrics
 * Calculates cycle time from SentToEngineer → SendBackToRequester using request_activities
 */
async function fetchEngineeringMetrics(whereClause: any): Promise<EngineeringMetrics> {
  // Get all requests that have been sent to engineering (matching the main filter)
  const requestIds = await prisma.requests.findMany({
    where: whereClause,
    select: { id: true, title: true, status: true },
  })

  const requestIdList = requestIds.map((r) => r.id)
  const requestTitleMap = new Map(requestIds.map((r) => [r.id, r.title]))

  if (requestIdList.length === 0) {
    return {
      avgCycleHours: 0,
      medianCycleHours: 0,
      minCycleHours: 0,
      maxCycleHours: 0,
      completedCount: 0,
      inProgressCount: 0,
      recentCycles: [],
    }
  }

  // Find all "SentToEngineer" status change events
  const sentToEngineerEvents = await prisma.request_activities.findMany({
    where: {
      requestId: { in: requestIdList },
      action: 'status_changed',
      toStatus: 'SentToEngineer',
    },
    select: {
      requestId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  // Find all "SendBackToRequester" status change events
  const sentBackEvents = await prisma.request_activities.findMany({
    where: {
      requestId: { in: requestIdList },
      action: 'status_changed',
      toStatus: 'SendBackToRequester',
    },
    select: {
      requestId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  // Build lookup: requestId → last SentToEngineer timestamp
  // Use LAST occurrence so rework cycles (reject → resubmit) show final successful times
  const sentToEngMap = new Map<string, Date>()
  for (const evt of sentToEngineerEvents) {
    if (evt.requestId) {
      sentToEngMap.set(evt.requestId, evt.createdAt)
    }
  }

  // Build lookup: requestId → last SendBackToRequester timestamp
  const sentBackMap = new Map<string, Date>()
  for (const evt of sentBackEvents) {
    if (evt.requestId) {
      sentBackMap.set(evt.requestId, evt.createdAt)
    }
  }

  const completedCycles: number[] = []
  const allCycles: EngineeringCycle[] = []
  let inProgressCount = 0

  for (const [requestId, sentAt] of sentToEngMap.entries()) {
    const backAt = sentBackMap.get(requestId)
    const title = requestTitleMap.get(requestId) || 'Untitled'

    if (backAt) {
      const cycleHours = differenceInMinutes(backAt, sentAt) / 60
      completedCycles.push(cycleHours)
      allCycles.push({
        requestId,
        title,
        sentToEngineerAt: sentAt.toISOString(),
        sentBackAt: backAt.toISOString(),
        cycleHours: Number(cycleHours.toFixed(1)),
      })
    } else {
      // Still in engineering pipeline
      inProgressCount++
      allCycles.push({
        requestId,
        title,
        sentToEngineerAt: sentAt.toISOString(),
        sentBackAt: null,
        cycleHours: null,
      })
    }
  }

  // Calculate stats
  if (completedCycles.length === 0) {
    return {
      avgCycleHours: 0,
      medianCycleHours: 0,
      minCycleHours: 0,
      maxCycleHours: 0,
      completedCount: 0,
      inProgressCount,
      recentCycles: allCycles.slice(0, 10),
    }
  }

  const sorted = [...completedCycles].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const avg = completedCycles.reduce((s, t) => s + t, 0) / completedCycles.length

  // Sort recent cycles by sentToEngineerAt descending
  allCycles.sort((a, b) => new Date(b.sentToEngineerAt).getTime() - new Date(a.sentToEngineerAt).getTime())

  return {
    avgCycleHours: Number(avg.toFixed(1)),
    medianCycleHours: Number(median.toFixed(1)),
    minCycleHours: Number(Math.min(...completedCycles).toFixed(1)),
    maxCycleHours: Number(Math.max(...completedCycles).toFixed(1)),
    completedCount: completedCycles.length,
    inProgressCount,
    recentCycles: allCycles.slice(0, 10),
  }
}

/**
 * Fetch per-department average approval speed with step-level breakdown
 * Uses request_activities to calculate time spent at each workflow step:
 *   - Improvement Approval: Created → SentToEngineer
 *   - Engineering: SentToEngineer → SendBackToRequester
 *   - Final Approval: SendBackToRequester → Completed
 */
async function fetchDepartmentSpeeds(whereClause: any): Promise<DepartmentApprovalSpeed[]> {
  // Get completed requests with their department
  const requests = await prisma.requests.findMany({
    where: {
      ...whereClause,
      status: 'Completed',
    },
    select: {
      id: true,
      createdAt: true,
      department: {
        select: { name: true },
      },
    },
  })

  if (requests.length === 0) return []

  const requestIds = requests.map((r) => r.id)

  // Fetch all relevant status change activities for these requests in one query
  const activities = await prisma.request_activities.findMany({
    where: {
      requestId: { in: requestIds },
      action: 'status_changed',
      toStatus: { in: ['SentToEngineer', 'SendBackToRequester', 'Completed'] as any },
    },
    select: {
      requestId: true,
      toStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  // Build lookup: requestId → { toStatus → last timestamp }
  // Use LAST occurrence so rework cycles (reject → resubmit) show final successful times
  const activityMap = new Map<string, Record<string, Date>>()
  for (const act of activities) {
    if (!act.requestId) continue
    if (!activityMap.has(act.requestId)) {
      activityMap.set(act.requestId, {})
    }
    const map = activityMap.get(act.requestId)!
    const status = act.toStatus as string
    // Always overwrite with latest occurrence
    map[status] = act.createdAt
  }

  // Calculate per-step times grouped by department
  interface StepTimes {
    total: number[]
    improvement: number[]
    engineering: number[]
    finalApproval: number[]
  }
  const deptData: Record<string, StepTimes> = {}

  for (const req of requests) {
    const deptName = req.department?.name || 'Unknown'
    const transitions = activityMap.get(req.id)
    if (!transitions) continue

    const sentToEng = transitions['SentToEngineer']
    const sentBack = transitions['SendBackToRequester']
    const completed = transitions['Completed']

    if (!deptData[deptName]) {
      deptData[deptName] = { total: [], improvement: [], engineering: [], finalApproval: [] }
    }

    // Improvement step: Created → SentToEngineer
    if (sentToEng) {
      const hours = differenceInMinutes(sentToEng, req.createdAt) / 60
      deptData[deptName].improvement.push(hours)
    }

    // Engineering step: SentToEngineer → SendBackToRequester
    if (sentToEng && sentBack) {
      const hours = differenceInMinutes(sentBack, sentToEng) / 60
      deptData[deptName].engineering.push(hours)
    }

    // Final approval step: SendBackToRequester → Completed
    if (sentBack && completed) {
      const hours = differenceInMinutes(completed, sentBack) / 60
      deptData[deptName].finalApproval.push(hours)
    }

    // Total: Created → Completed (or last known transition)
    const endTime = completed || sentBack || sentToEng
    if (endTime) {
      const hours = differenceInMinutes(endTime, req.createdAt) / 60
      deptData[deptName].total.push(hours)
    }
  }

  // Helper to calculate average
  const avg = (arr: number[]) =>
    arr.length > 0 ? Number((arr.reduce((s, t) => s + t, 0) / arr.length).toFixed(1)) : 0

  // Calculate averages and sort by total speed (fastest first)
  return Object.entries(deptData)
    .map(([name, times]) => ({
      name,
      avgHours: avg(times.total),
      completedCount: times.total.length,
      avgImprovementHours: avg(times.improvement),
      avgEngineeringHours: avg(times.engineering),
      avgFinalApprovalHours: avg(times.finalApproval),
    }))
    .sort((a, b) => a.avgHours - b.avgHours)
}

function calculateTrends(current: SummaryMetrics, previous: SummaryMetrics): TrendData {
  function pctChange(curr: number, prev: number): number {
    if (prev === 0) return curr > 0 ? 100 : 0
    return Number((((curr - prev) / prev) * 100).toFixed(1))
  }

  return {
    totalRequestsChange: pctChange(current.totalRequests, previous.totalRequests),
    pendingRequestsChange: pctChange(current.pendingRequests, previous.pendingRequests),
    avgApprovalTimeChange: pctChange(current.avgApprovalTime, previous.avgApprovalTime),
    approvalRateChange: pctChange(current.approvalRate, previous.approvalRate),
  }
}
