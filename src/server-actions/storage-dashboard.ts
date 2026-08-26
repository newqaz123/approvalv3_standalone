'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { getUploadRoot } from '@/lib/attachments/storage'
import {
  aggregateAttachmentStorage,
  buildStorageTrendChart,
  isMissingStoragePlanTable,
  toStoragePlanEventView,
  utcMonthKey,
  type AttachmentStorageTotals,
  type StoragePlanEventView,
  type StorageTrendPoint,
  type UploadVolumeUsage,
} from '@/lib/storage-dashboard'
import { measureUploadVolume } from '@/lib/storage-volume'
import { parseStorageAlertThreshold } from '@/lib/storage-alert'
import { RETENTION_DEFAULTS } from '@/lib/retention-policy'

export type StorageDashboardData = AttachmentStorageTotals &
  UploadVolumeUsage & {
    databaseBytes: number | null
    alertThresholdPct: number
    lastStorageAlertOn: string | null
    trend: StorageTrendPoint[]
    planEvents: StoragePlanEventView[]
  }

export type StoragePlanEventResult =
  | { success: true }
  | { success: false; error: string }

const LABEL_MAX = 80
const DEFAULT_MONTHS_AHEAD = 12

function toByteCount(value: unknown): number | null {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function loadPlanEvents() {
  try {
    return await prisma.storage_plan_events.findMany({
      orderBy: { plannedDate: 'asc' },
      select: { id: true, label: true, plannedDate: true },
    })
  } catch (error) {
    if (isMissingStoragePlanTable(error)) return []
    throw error
  }
}

async function readDatabaseBytes(): Promise<number | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ size: unknown }>>`
      SELECT pg_database_size(current_database()) AS size
    `
    return toByteCount(rows[0]?.size)
  } catch {
    return null
  }
}

function monthsBetween(fromMonth: string, toMonth: string): number {
  const [fromYear, fromMonthNumber] = fromMonth.split('-').map(Number)
  const [toYear, toMonthNumber] = toMonth.split('-').map(Number)
  return (toYear - fromYear) * 12 + (toMonthNumber - fromMonthNumber)
}

function parsePlanDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

async function readAlertSettings(): Promise<{ thresholdPct: number; lastAlertOn: string | null }> {
  try {
    const row = await prisma.retention_settings.findUnique({
      where: { id: 'default' },
      select: { storageAlertThresholdPct: true, lastStorageAlertOn: true },
    })
    return {
      thresholdPct: row?.storageAlertThresholdPct ?? 0,
      lastAlertOn: row?.lastStorageAlertOn ?? null,
    }
  } catch {
    return { thresholdPct: 0, lastAlertOn: null }
  }
}

export async function getStorageDashboardData(): Promise<StorageDashboardData> {
  const adminId = await requireAdmin()
  if (!adminId) {
    throw new Error('Unauthorized')
  }

  const [attachments, volume, databaseBytes, planRows, alert] = await Promise.all([
    prisma.file_attachments.findMany({
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        fileType: true,
        createdAt: true,
        requestId: true,
        solutionId: true,
      },
    }),
    measureUploadVolume(getUploadRoot()),
    readDatabaseBytes(),
    loadPlanEvents(),
    readAlertSettings(),
  ])

  const now = new Date()
  const nowMonth = utcMonthKey(now)
  const farthestPlanMonths = planRows.map((event) =>
    monthsBetween(nowMonth, utcMonthKey(event.plannedDate))
  )
  const monthsAhead = Math.max(DEFAULT_MONTHS_AHEAD, ...farthestPlanMonths, 0)

  return {
    ...aggregateAttachmentStorage(attachments),
    ...volume,
    databaseBytes,
    alertThresholdPct: alert.thresholdPct,
    lastStorageAlertOn: alert.lastAlertOn,
    trend: buildStorageTrendChart(attachments, now, { monthsAhead }),
    planEvents: planRows.map(toStoragePlanEventView),
  }
}

export async function saveStorageAlertThreshold(thresholdPct: number): Promise<
  { success: true; thresholdPct: number } | { success: false; error: string }
> {
  const adminId = await requireAdmin()
  if (!adminId) {
    return { success: false, error: 'Unauthorized - Admin access required' }
  }

  const normalized = parseStorageAlertThreshold(thresholdPct)

  try {
    await prisma.retention_settings.upsert({
      where: { id: 'default' },
      update: {
        storageAlertThresholdPct: normalized,
        // Preserve lastStorageAlertOn: changing the threshold must not permit
        // a second alert attempt on the same local day.
        updatedById: adminId,
      },
      create: {
        id: 'default',
        archiveStatuses: RETENTION_DEFAULTS.archiveStatuses,
        storageAlertThresholdPct: normalized,
        updatedById: adminId,
      },
    })
  } catch {
    return { success: false, error: 'Could not save the alert threshold' }
  }

  revalidatePath('/admin/storage')
  return { success: true, thresholdPct: normalized }
}

export async function createStoragePlanEvent(input: {
  label: string
  plannedDate: string
}): Promise<StoragePlanEventResult> {
  const adminId = await requireAdmin()
  if (!adminId) {
    return { success: false, error: 'Unauthorized - Admin access required' }
  }

  const label = input.label.trim()
  if (!label) {
    return { success: false, error: 'Enter a label for this date' }
  }
  if (label.length > LABEL_MAX) {
    return { success: false, error: `Label must be ${LABEL_MAX} characters or fewer` }
  }

  const plannedDate = parsePlanDate(input.plannedDate)
  if (!plannedDate) {
    return { success: false, error: 'Enter a valid date' }
  }

  try {
    await prisma.storage_plan_events.create({
      data: {
        label,
        plannedDate,
        createdById: adminId,
      },
    })
  } catch (error) {
    if (isMissingStoragePlanTable(error)) {
      return { success: false, error: 'Plan dates are not available until the storage migration is applied' }
    }
    throw error
  }
  revalidatePath('/admin/storage')
  return { success: true }
}

export async function deleteStoragePlanEvent(id: string): Promise<StoragePlanEventResult> {
  const adminId = await requireAdmin()
  if (!adminId) {
    return { success: false, error: 'Unauthorized - Admin access required' }
  }

  if (!id) {
    return { success: false, error: 'Missing plan date' }
  }

  try {
    await prisma.storage_plan_events.delete({ where: { id } })
  } catch (error) {
    if (isMissingStoragePlanTable(error)) {
      return { success: false, error: 'Plan dates are not available until the storage migration is applied' }
    }
    throw error
  }
  revalidatePath('/admin/storage')
  return { success: true }
}
