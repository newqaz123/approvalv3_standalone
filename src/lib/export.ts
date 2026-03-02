import { Parser } from 'json2csv'
import { format } from 'date-fns'
import type { RequestActivity, User, Request, RequestApproval, FileAttachment } from '@prisma/client'

/**
 * Activity with related user and request data (from audit query API)
 */
export type AuditActivityRecord = RequestActivity & {
  user: {
    id: string
    name: string
    email: string
  }
  request: {
    id: string
    title: string
    departmentId: string
    status: string
  } | null
}

/**
 * CSV row structure for audit trail export
 * One row per activity with flat structure
 */
export interface AuditCSVRow {
  timestamp: string // ISO 8601
  timestampLocale: string // Formatted: "31/01/2025 2:30 PM"
  userId: string
  userName: string
  userEmail: string
  action: string
  requestId: string
  requestTitle: string
  fromStatus: string | null
  toStatus: string | null
  comments: string | null
}

/**
 * JSON export structure for audit trail
 * Grouped by request with nested arrays
 */
export interface AuditExportJSON {
  requestId: string
  requestTitle: string
  departmentId: string
  departmentName: string | null
  createdAt: string
  status: string
  requester: {
    userId: string
    userName: string | null
    email: string | null
  }
  approvals: Array<{
    approvalId: string
    approverName: string | null
    requiredLevel: number | null
    status: string
    approvedAt: string | null
    comments: string | null
  }>
  files: Array<{
    fileId: string
    fileName: string
    uploadedBy: string | null
    uploadedAt: string
  }>
  activities: Array<{
    activityId: string
    timestamp: string
    timestampLocale: string
    userId: string
    userName: string
    action: string
    fromStatus: string | null
    toStatus: string | null
    comments: string | null
  }>
}

/**
 * Full request snapshot for JSON export with all related data
 */
export type RequestSnapshot = Request & {
  requester: User
  department: {
    id: string
    name: string
  } | null
  approvals: (RequestApproval & {
    approver: User | null
  })[]
  fileAttachments: (FileAttachment & {
    uploadedBy: User
  })[]
  activities: (RequestActivity & {
    user: User
  })[]
}

/**
 * Generate CSV export from audit activity records
 * One row per action with flat structure
 *
 * @param activities - Array of audit activity records from query API
 * @returns CSV string with headers
 */
export function generateCSVExport(activities: AuditActivityRecord[]): string {
  // Convert activities to CSV rows
  const rows: AuditCSVRow[] = activities.map((activity) => ({
    timestamp: activity.createdAt.toISOString(),
    timestampLocale: format(activity.createdAt, 'dd/MM/yyyy h:mm a'),
    userId: activity.user.id,
    userName: activity.user.name,
    userEmail: activity.user.email,
    action: activity.action,
    requestId: activity.request?.id || 'SYSTEM',
    requestTitle: activity.request?.title || 'System Activity',
    fromStatus: activity.fromStatus || null,
    toStatus: activity.toStatus || null,
    comments: activity.comments || null,
  }))

  // Define CSV field order
  const fields = [
    'timestamp',
    'timestampLocale',
    'userId',
    'userName',
    'userEmail',
    'action',
    'requestId',
    'requestTitle',
    'fromStatus',
    'toStatus',
    'comments',
  ]

  // Generate CSV using json2csv with proper escaping
  const parser = new Parser({ fields })
  const csv = parser.parse(rows)

  return csv
}

/**
 * Generate JSON export from request snapshot
 * Grouped by request with nested arrays
 *
 * @param requests - Array of full request snapshots with related data
 * @returns JSON string (formatted)
 */
export function generateJSONExport(requests: RequestSnapshot[]): string {
  // Convert requests to export format
  const exportData: AuditExportJSON[] = requests.map((request) => ({
    requestId: request.id,
    requestTitle: request.title,
    departmentId: request.departmentId,
    departmentName: request.department?.name || null,
    createdAt: request.createdAt.toISOString(),
    status: request.status,
    requester: {
      userId: request.requester.id,
      userName: request.requester.name || null,
      email: request.requester.email || null,
    },
    approvals: request.approvals.map((approval) => ({
      approvalId: approval.id,
      approverName: approval.approver?.name || null,
      requiredLevel: approval.requiredLevel || null,
      status: approval.status,
      approvedAt: approval.approvedAt?.toISOString() || null,
      comments: approval.comments || null,
    })),
    files: request.fileAttachments.map((file) => ({
      fileId: file.id,
      fileName: file.fileName,
      uploadedBy: file.uploadedBy.name || null,
      uploadedAt: file.createdAt.toISOString(),
    })),
    activities: request.activities.map((activity) => ({
      activityId: activity.id,
      timestamp: activity.createdAt.toISOString(),
      timestampLocale: format(activity.createdAt, 'dd/MM/yyyy h:mm a'),
      userId: activity.user.id,
      userName: activity.user.name,
      action: activity.action,
      fromStatus: activity.fromStatus || null,
      toStatus: activity.toStatus || null,
      comments: activity.comments || null,
    })),
  }))

  // Format JSON with 2-space indentation
  return JSON.stringify(exportData, null, 2)
}
