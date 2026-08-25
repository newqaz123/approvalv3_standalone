export const RETENTION_REQUEST_STATUSES = [
  'ImprovementRequest',
  'SentToEngineer',
  'SendBackToRequester',
  'DesignCostEstimationApproval',
  'FinalApproval',
  'Completed',
  'Cancelled',
] as const

export type RetentionRequestStatus = (typeof RETENTION_REQUEST_STATUSES)[number]

export const RETENTION_DEFAULTS = {
  archiveEnabled: true,
  archiveAfterDays: 90,
  archiveStatuses: ['Completed', 'Cancelled'] as RetentionRequestStatus[],
  cleanupAfterDays: 365,
  archiveHour: 2,
  archiveMinute: 0,
  minDays: 7,
  maxDays: 3650,
}

export type RetentionPolicy = {
  archiveEnabled: boolean
  archiveAfterDays: number
  archiveStatuses: RetentionRequestStatus[]
  cleanupAfterDays: number
  archiveHour: number
  archiveMinute: number
}

export type RetentionPolicyInput = {
  archiveEnabled?: boolean
  archiveAfterDays?: number | null
  archiveStatuses?: unknown
  cleanupAfterDays?: number | null
  archiveHour?: number | null
  archiveMinute?: number | null
}

export type RetentionBackupAttachment = {
  fileName: string
  bytes: Buffer
}

export type RetentionBackupRequest = {
  requestId: string
  title: string
  reportPdf: Buffer | null
  /** When set, the PDF could not be generated; an explicit error file is emitted instead. */
  reportError?: string
  attachments: RetentionBackupAttachment[]
}

export type RetentionBackupEntry = {
  path: string
  data: Buffer
}

function parseDayCount(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(RETENTION_DEFAULTS.maxDays, Math.max(RETENTION_DEFAULTS.minDays, Math.round(parsed)))
}

function parseStatuses(value: unknown): RetentionRequestStatus[] {
  if (!Array.isArray(value)) return [...RETENTION_DEFAULTS.archiveStatuses]
  const allowed = new Set<string>(RETENTION_REQUEST_STATUSES)
  const statuses = value
    .filter((item): item is string => typeof item === 'string')
    .filter((item): item is RetentionRequestStatus => allowed.has(item))
  return statuses.length > 0 ? statuses : [...RETENTION_DEFAULTS.archiveStatuses]
}

export function resolveRetentionPolicy(
  stored: RetentionPolicyInput | null | undefined,
  env: Record<string, string | undefined> = process.env
): RetentionPolicy {
  if (!stored) {
    return {
      archiveEnabled: RETENTION_DEFAULTS.archiveEnabled,
      archiveAfterDays: parseDayCount(env.ARCHIVE_AFTER_DAYS, RETENTION_DEFAULTS.archiveAfterDays),
      archiveStatuses: [...RETENTION_DEFAULTS.archiveStatuses],
      cleanupAfterDays: parseDayCount(env.CLEANUP_THRESHOLD_DAYS, RETENTION_DEFAULTS.cleanupAfterDays),
      archiveHour: RETENTION_DEFAULTS.archiveHour,
      archiveMinute: RETENTION_DEFAULTS.archiveMinute,
    }
  }

  return {
    archiveEnabled: stored.archiveEnabled !== false,
    archiveAfterDays: parseDayCount(stored.archiveAfterDays, RETENTION_DEFAULTS.archiveAfterDays),
    archiveStatuses: parseStatuses(stored.archiveStatuses),
    cleanupAfterDays: parseDayCount(stored.cleanupAfterDays, RETENTION_DEFAULTS.cleanupAfterDays),
    archiveHour: parseClockPart(stored.archiveHour, 23, RETENTION_DEFAULTS.archiveHour),
    archiveMinute: parseClockPart(stored.archiveMinute, 59, RETENTION_DEFAULTS.archiveMinute),
  }
}

function parseClockPart(value: unknown, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(0, Math.round(parsed)))
}

export function parseArchiveClock(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) {
    return { hour: RETENTION_DEFAULTS.archiveHour, minute: RETENTION_DEFAULTS.archiveMinute }
  }
  return {
    hour: parseClockPart(match[1], 23, RETENTION_DEFAULTS.archiveHour),
    minute: parseClockPart(match[2], 59, RETENTION_DEFAULTS.archiveMinute),
  }
}

export function localDateKey(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatArchiveClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function shouldRunDailyArchive(input: {
  archiveEnabled: boolean
  hour: number
  minute: number
  lastRunOn: string | null
  now: Date
}): boolean {
  if (!input.archiveEnabled) return false
  if (input.lastRunOn === localDateKey(input.now)) return false
  const current = input.now.getHours() * 60 + input.now.getMinutes()
  const target = input.hour * 60 + input.minute
  return current >= target
}

export function retentionCutoffDate(days: number, now = new Date()): Date {
  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  return cutoff
}

export function isEligibleForAutoArchive(
  request: {
    status: string
    isArchived: boolean
    isDeleted: boolean
    updatedAt: Date | string
  },
  policy: RetentionPolicy,
  now = new Date()
): boolean {
  if (!policy.archiveEnabled || request.isArchived || request.isDeleted) return false
  if (!policy.archiveStatuses.includes(request.status as RetentionRequestStatus)) return false
  return new Date(request.updatedAt) < retentionCutoffDate(policy.archiveAfterDays, now)
}

export function sanitizeRetentionName(input: string, maxLength = 40): string {
  const cleaned = input
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength)
  return cleaned || 'request'
}

export function buildRetentionBackupFolderName(requestId: string, title: string): string {
  return `${requestId.slice(0, 8)}-${sanitizeRetentionName(title)}`
}

export function uniqueAttachmentName(fileName: string, used: Set<string>): string {
  const safe = sanitizeRetentionName(fileName.replace(/\.[^.]+$/, ''), 60)
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()}` : ''
  let candidate = `${safe}${extension}`
  let index = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${safe}-${index}${extension}`
    index += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}

export function buildRetentionBackupEntries(item: RetentionBackupRequest): RetentionBackupEntry[] {
  const folder = buildRetentionBackupFolderName(item.requestId, item.title)
  const used = new Set<string>()
  const entries: RetentionBackupEntry[] =
    item.reportPdf != null && !item.reportError
      ? [{ path: `${folder}/report.pdf`, data: item.reportPdf }]
      : [
          {
            path: `${folder}/report.ERROR.txt`,
            data: Buffer.from(
              `The PDF report for this request could not be generated.\n${item.reportError ?? 'Unknown error'}\n`,
              'utf8'
            ),
          },
        ]

  for (const attachment of item.attachments) {
    entries.push({
      path: `${folder}/attachments/${uniqueAttachmentName(attachment.fileName, used)}`,
      data: attachment.bytes,
    })
  }

  return entries
}
