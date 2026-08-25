import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import {
  localDateKey,
  resolveRetentionPolicy,
  retentionCutoffDate,
  type RetentionPolicy,
} from '@/lib/retention-policy'
import { revalidateRequestViews } from '@/server-actions/request-view-invalidation'

// Server-only archive engine. NOT a 'use server' module: nothing here is
// directly invocable from the client. Callers must authenticate (admin or
// cron secret) before reaching applyRetentionArchive.

const SETTINGS_ID = 'default'

function asPolicyInput(row: {
  archiveEnabled: boolean
  archiveAfterDays: number
  archiveStatuses: unknown
  cleanupAfterDays: number
  archiveHour?: number
  archiveMinute?: number
} | null) {
  if (!row) return null
  return {
    archiveEnabled: row.archiveEnabled,
    archiveAfterDays: row.archiveAfterDays,
    archiveStatuses: row.archiveStatuses,
    cleanupAfterDays: row.cleanupAfterDays,
    archiveHour: row.archiveHour,
    archiveMinute: row.archiveMinute,
  }
}

export async function readRetentionSettingsRow() {
  try {
    return await prisma.retention_settings.findUnique({ where: { id: SETTINGS_ID } })
  } catch {
    return null
  }
}

export async function getResolvedRetentionPolicy(): Promise<RetentionPolicy> {
  const row = await readRetentionSettingsRow()
  return resolveRetentionPolicy(asPolicyInput(row), process.env)
}

export async function applyRetentionArchive(source: 'cron' | 'manual' | 'clock') {
  const policy = await getResolvedRetentionPolicy()
  if (!policy.archiveEnabled && source !== 'manual') {
    return { archived: 0, skipped: true as const, policy }
  }

  const cutoffDate = retentionCutoffDate(policy.archiveAfterDays)
  const result = await prisma.requests.updateMany({
    where: {
      status: { in: policy.archiveStatuses },
      updatedAt: { lt: cutoffDate },
      isArchived: false,
      isDeleted: false,
    },
    data: { isArchived: true },
  })

  try {
    await prisma.retention_settings.upsert({
      where: { id: SETTINGS_ID },
      update: { lastArchiveRunOn: localDateKey(new Date()) },
      create: {
        id: SETTINGS_ID,
        archiveEnabled: policy.archiveEnabled,
        archiveAfterDays: policy.archiveAfterDays,
        archiveStatuses: policy.archiveStatuses,
        cleanupAfterDays: policy.cleanupAfterDays,
        archiveHour: policy.archiveHour,
        archiveMinute: policy.archiveMinute,
        lastArchiveRunOn: localDateKey(new Date()),
      },
    })
  } catch {
    // Settings table may not exist yet during first boot.
  }

  if (result.count > 0) {
    revalidateRequestViews()
  }

  return { archived: result.count, skipped: false as const, policy, cutoffDate }
}

export function revalidateRetentionPage() {
  revalidatePath('/admin/retention')
}
