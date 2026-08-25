export type AttachmentOwner = 'request' | 'solution' | 'other'

export type AttachmentStorageRow = {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  createdAt: Date
  requestId: string | null
  solutionId: string | null
}

export type LargestStoredFile = {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  createdAt: Date
  owner: AttachmentOwner
}

export type AttachmentStorageTotals = {
  recordedAttachmentBytes: number
  attachmentCount: number
  requestAttachmentBytes: number
  requestAttachmentCount: number
  solutionAttachmentBytes: number
  solutionAttachmentCount: number
  largestFiles: LargestStoredFile[]
}

export type UploadVolumeUsage = {
  uploadDirBytes: number | null
  uploadDirError: string | null
  diskTotalBytes: number | null
  diskFreeBytes: number | null
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const formatted = unitIndex === 0 || Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace(/\.0$/, '')

  return `${formatted} ${UNITS[unitIndex]}`
}

export function classifyAttachmentOwner(attachment: {
  requestId: string | null
  solutionId: string | null
}): AttachmentOwner {
  if (attachment.requestId) return 'request'
  if (attachment.solutionId) return 'solution'
  return 'other'
}

export function aggregateAttachmentStorage(
  rows: AttachmentStorageRow[],
  largestLimit = 10
): AttachmentStorageTotals {
  const totals: AttachmentStorageTotals = {
    recordedAttachmentBytes: 0,
    attachmentCount: rows.length,
    requestAttachmentBytes: 0,
    requestAttachmentCount: 0,
    solutionAttachmentBytes: 0,
    solutionAttachmentCount: 0,
    largestFiles: [],
  }

  for (const file of rows) {
    const owner = classifyAttachmentOwner(file)
    totals.recordedAttachmentBytes += file.fileSize
    if (owner === 'request') {
      totals.requestAttachmentBytes += file.fileSize
      totals.requestAttachmentCount += 1
    } else if (owner === 'solution') {
      totals.solutionAttachmentBytes += file.fileSize
      totals.solutionAttachmentCount += 1
    }
  }

  totals.largestFiles = [...rows]
    .sort((a, b) => b.fileSize - a.fileSize)
    .slice(0, largestLimit)
    .map((file) => ({
      id: file.id,
      fileName: file.fileName,
      fileSize: file.fileSize,
      fileType: file.fileType,
      createdAt: file.createdAt,
      owner: classifyAttachmentOwner(file),
    }))

  return totals
}

export function diskUsedPercent(
  usedBytes: number | null,
  totalBytes: number | null
): number | null {
  if (usedBytes == null || totalBytes == null || totalBytes <= 0) {
    return null
  }

  return Math.min(100, Math.max(0, Math.round((usedBytes / totalBytes) * 100)))
}

const VISIBLE_SHARE_THRESHOLD_PCT = 1.5
const MIN_SEGMENT_PCT = 2

export type VolumeStripShares = {
  /** capacity = share of whole disk; folder = split within the upload folder */
  mode: 'capacity' | 'folder'
  recordedPct: number
  otherPct: number
  freePct: number | null
}

function withVisibleFloor(recordedPct: number, otherPct: number): [number, number] {
  const flooredRecorded = recordedPct > 0 ? Math.max(recordedPct, MIN_SEGMENT_PCT) : 0
  const flooredOther = otherPct > 0 ? Math.max(otherPct, MIN_SEGMENT_PCT) : 0
  if (flooredRecorded + flooredOther <= 100) return [flooredRecorded, flooredOther]
  // Over 100% after flooring: shrink the larger segment so the floored
  // minimum stays exactly at its floor (never rescale the small one away).
  return flooredRecorded <= flooredOther
    ? [flooredRecorded, Math.max(0, 100 - flooredRecorded)]
    : [Math.max(0, 100 - flooredOther), flooredOther]
}

export function resolveVolumeStripShares(input: {
  uploadDirBytes: number | null
  recordedBytes: number
  capacityBytes: number | null
}): VolumeStripShares {
  const used = input.uploadDirBytes
  if (used == null || !Number.isFinite(used) || used <= 0) {
    return { mode: 'folder', recordedPct: 0, otherPct: 0, freePct: null }
  }

  // Robustness guards: strip math only sees finite recorded bytes clamped to
  // [0, used] so NaN/negative/oversized inputs can never produce NaN widths
  // or shares over 100%. Textual reporting keeps the raw values elsewhere.
  const recorded =
    Number.isFinite(input.recordedBytes)
      ? Math.min(Math.max(input.recordedBytes, 0), used)
      : 0
  const other = used - recorded

  const capacity = input.capacityBytes
  if (capacity != null && Number.isFinite(capacity) && capacity > 0) {
    const usedShare = (used / capacity) * 100
    if (usedShare >= VISIBLE_SHARE_THRESHOLD_PCT) {
      return {
        mode: 'capacity',
        recordedPct: (recorded / capacity) * 100,
        otherPct: (other / capacity) * 100,
        freePct: Math.max(0, 100 - usedShare),
      }
    }
  }

  // Disk share is invisible (<1.5%): show the split inside the upload folder
  // instead, keeping every non-zero segment at least 2% wide so colors render.
  const [recordedPct, otherPct] = withVisibleFloor(
    (input.recordedBytes / used) * 100,
    (other / used) * 100
  )
  return { mode: 'folder', recordedPct, otherPct, freePct: null }
}

export type RetentionDatedRow = {
  id: string
  updatedAt: Date | string
}

function parseLocalDay(value: string | undefined, endOfDay: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  // Reject calendar-invalid strings like 2026-02-30 that JS silently rolls
  // over to the next month instead of reporting Invalid Date.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

export function filterRetentionRowsByUpdatedDate<
  T extends RetentionDatedRow
>(rows: T[], dateFrom?: string, dateTo?: string): T[] {
  const from = parseLocalDay(dateFrom, false)
  const to = parseLocalDay(dateTo, true)
  if (!from && !to) return rows

  return rows.filter((row) => {
    const updated = new Date(row.updatedAt)
    if (from && updated < from) return false
    if (to && updated > to) return false
    return true
  })
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const DEFAULT_MONTHS_AHEAD = 12
const DEFAULT_SLOPE_WINDOW = 6

export type StorageTrendPoint = {
  month: string
  label: string
  actualBytes: number | null
  estimatedBytes: number | null
}

export type StoragePlanEventView = {
  id: string
  label: string
  plannedDate: string
  month: string
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

export function utcMonthKey(date: Date | string): string {
  const value = toDate(date)
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`
}

export function utcMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  return `${MONTH_NAMES[(month || 1) - 1]} ${year}`
}

export function addUtcMonthKey(monthKey: string, count: number): string {
  const [year, month] = monthKey.split('-').map(Number)
  return utcMonthKey(new Date(Date.UTC(year, (month || 1) - 1 + count, 1)))
}

function compareMonthKey(a: string, b: string): number {
  return a.localeCompare(b)
}

export function toIsoDate(date: Date | string): string {
  return toDate(date).toISOString().slice(0, 10)
}

export function buildStorageTrendChart(
  files: Array<{ fileSize: number; createdAt: Date | string }>,
  now: Date,
  options?: { monthsAhead?: number; slopeWindow?: number }
): StorageTrendPoint[] {
  const nowMonth = utcMonthKey(now)
  const addedByMonth = new Map<string, number>()

  for (const file of files) {
    const month = utcMonthKey(file.createdAt)
    if (compareMonthKey(month, nowMonth) > 0) continue
    addedByMonth.set(month, (addedByMonth.get(month) ?? 0) + file.fileSize)
  }

  if (addedByMonth.size === 0) return []

  const firstMonth = [...addedByMonth.keys()].sort(compareMonthKey)[0]
  const actuals: Array<{ month: string; actualBytes: number }> = []
  let running = 0
  for (
    let month = firstMonth;
    compareMonthKey(month, nowMonth) <= 0;
    month = addUtcMonthKey(month, 1)
  ) {
    running += addedByMonth.get(month) ?? 0
    actuals.push({ month, actualBytes: running })
  }

  const windowSize = Math.min(options?.slopeWindow ?? DEFAULT_SLOPE_WINDOW, actuals.length)
  const window = actuals.slice(-windowSize)
  const slope =
    window.length < 2
      ? 0
      : (window[window.length - 1].actualBytes - window[0].actualBytes) / (window.length - 1)

  const lastActual = actuals[actuals.length - 1]
  const monthsAhead = options?.monthsAhead ?? DEFAULT_MONTHS_AHEAD
  const points: StorageTrendPoint[] = actuals.map((point, index) => ({
    month: point.month,
    label: utcMonthLabel(point.month),
    actualBytes: point.actualBytes,
    estimatedBytes: index === actuals.length - 1 ? point.actualBytes : null,
  }))

  for (let step = 1; step <= monthsAhead; step += 1) {
    const month = addUtcMonthKey(lastActual.month, step)
    points.push({
      month,
      label: utcMonthLabel(month),
      actualBytes: null,
      estimatedBytes: Math.max(0, Math.round(lastActual.actualBytes + slope * step)),
    })
  }

  return points
}

export function estimateBytesAtMonth(
  points: StorageTrendPoint[],
  month: string
): number | null {
  const point = points.find((item) => item.month === month)
  if (!point) return null
  return point.estimatedBytes ?? point.actualBytes
}

export function isMissingStoragePlanTable(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2021') {
    return false
  }
  const table =
    'meta' in error && error.meta && typeof error.meta === 'object' && 'table' in error.meta
      ? String(error.meta.table)
      : ''
  return table.includes('storage_plan_events')
}

export function toStoragePlanEventView(event: {
  id: string
  label: string
  plannedDate: Date | string
}): StoragePlanEventView {
  const plannedDate = toIsoDate(event.plannedDate)
  return {
    id: event.id,
    label: event.label,
    plannedDate,
    month: utcMonthKey(event.plannedDate),
  }
}
