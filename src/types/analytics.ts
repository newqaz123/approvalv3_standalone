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
  /** Average approval time in days */
  avgApprovalTime: number
  /** Approval rate as percentage (0-100) */
  approvalRate: number
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
}
