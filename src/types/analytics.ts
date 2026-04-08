/**
 * Analytics type definitions for the dashboard
 * Provides data structures for charts and metrics
 */

export type DateRangePreset = '7days' | '30days' | '90days' | 'all'

/**
 * Filters for analytics data queries
 */
export interface AnalyticsFilters {
  /** Date range preset for filtering */
  dateRange: DateRangePreset
  /** Optional department filter */
  departmentId?: string
  /** Optional status filter (pending, approved, rejected, etc.) */
  status?: string
  /** Optional requester filter */
  requesterId?: string
}

/**
 * Workflow pipeline segment data
 * Represents status distribution at a single workflow step
 */
export interface WorkflowPipelineSegment {
  /** Workflow step name (e.g., "ImprovementRequest", "SentToEngineer") */
  step: string
  /** Count of pending requests at this step */
  pending: number
  /** Count of approved requests at this step */
  approved: number
  /** Count of rejected requests at this step */
  rejected: number
}

/**
 * Time-based metrics for approval performance
 */
export interface TimeMetrics {
  /** Average approval time per request (in days) */
  avgPerRequest: number
  /** Average approval time per approval level (in days) */
  avgPerApprovalLevel: number
  /** Median approval time per request (in days) */
  medianPerRequest: number
  /** Minimum approval time per request (in days) */
  minPerRequest: number
  /** Maximum approval time per request (in days) */
  maxPerRequest: number
}

/**
 * Summary metrics for the analytics dashboard
 */
export interface SummaryMetrics {
  /** Total number of requests in the filtered data */
  totalRequests: number
  /** Number of currently pending requests */
  pendingRequests: number
  /** Number of cancelled requests */
  cancelledCount: number
  /** Average approval time in hours */
  avgApprovalTime: number
  /** Completion rate as percentage (0-100), excludes cancelled from denominator */
  approvalRate: number
}

/**
 * Per-department average approval speed
 */
export interface DepartmentApprovalSpeed {
  /** Department name */
  name: string
  /** Total average approval time in hours */
  avgHours: number
  /** Number of completed requests used for calculation */
  completedCount: number
  /** Avg time for improvement approval step (Created → SentToEngineer) in hours */
  avgImprovementHours: number
  /** Avg time for engineering step (SentToEngineer → SendBackToRequester) in hours */
  avgEngineeringHours: number
  /** Avg time for final approval step (SendBackToRequester → Completed) in hours */
  avgFinalApprovalHours: number
}

/**
 * Trend comparison data vs previous period
 */
export interface TrendData {
  /** Percentage change in total requests vs previous period */
  totalRequestsChange: number
  /** Percentage change in pending requests vs previous period */
  pendingRequestsChange: number
  /** Percentage change in avg approval time vs previous period */
  avgApprovalTimeChange: number
  /** Percentage change in approval rate vs previous period */
  approvalRateChange: number
}

/**
 * Timeline data point for request volume chart
 */
export interface TimelinePoint {
  /** Date label (e.g., "Jan 15") */
  date: string
  /** Number of requests created on this date */
  created: number
  /** Number of requests completed on this date */
  completed: number
}

/**
 * Bottleneck alert for stuck requests
 */
export interface Bottleneck {
  /** Workflow step name */
  step: string
  /** Human-readable step label */
  label: string
  /** Number of requests stuck at this step */
  count: number
  /** Average wait time in hours */
  avgWaitHours: number
}

/**
 * Individual engineering cycle for a single request
 */
export interface EngineeringCycle {
  /** Request ID */
  requestId: string
  /** Request title */
  title: string
  /** When the request was sent to engineering */
  sentToEngineerAt: string
  /** When the request was sent back to requester (null if still in engineering) */
  sentBackAt: string | null
  /** Cycle time in hours (null if still in progress) */
  cycleHours: number | null
}

/**
 * Engineering KPI metrics
 * Tracks engineering work time: SentToEngineer → SendBackToRequester
 */
export interface EngineeringMetrics {
  /** Average engineering cycle time in hours */
  avgCycleHours: number
  /** Median engineering cycle time in hours */
  medianCycleHours: number
  /** Fastest engineering cycle time in hours */
  minCycleHours: number
  /** Slowest engineering cycle time in hours */
  maxCycleHours: number
  /** Total completed engineering cycles in the period */
  completedCount: number
  /** Number of requests currently with engineering */
  inProgressCount: number
  /** Individual cycle records (recent, for detail view) */
  recentCycles: EngineeringCycle[]
}

/**
 * Complete analytics data structure
 * Contains all data needed for the analytics dashboard
 */
export interface AnalyticsData {
  /** Workflow pipeline data grouped by status */
  pipeline: WorkflowPipelineSegment[]
  /** Department breakdown data */
  departments: Array<{ name: string; value: number }>
  /** Time-based approval metrics */
  timeMetrics: TimeMetrics
  /** Summary metrics for quick overview */
  summary: SummaryMetrics
  /** Trend comparison vs previous period */
  trends: TrendData
  /** Request volume timeline */
  timeline: TimelinePoint[]
  /** Bottleneck alerts for stuck requests */
  bottlenecks: Bottleneck[]
  /** Engineering KPI metrics */
  engineeringMetrics: EngineeringMetrics
  /** Per-department approval speed for racing track chart */
  departmentSpeeds: DepartmentApprovalSpeed[]
}
