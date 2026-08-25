'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import prisma from '@/lib/prisma'
import {
  formatArchiveClock,
  parseArchiveClock,
  resolveRetentionPolicy,
  retentionCutoffDate,
  type RetentionPolicy,
} from '@/lib/retention-policy'
import {
  applyRetentionArchive,
  readRetentionSettingsRow,
} from '@/lib/retention-archive'

// Every export here is an invocable Server Action and MUST check requireAdmin.
// Unauthenticated internals live in src/lib/retention-archive.ts instead.

const SETTINGS_ID = 'default'

export type RetentionSettingsView = RetentionPolicy & {
  eligibleCount: number
  archiveClock: string
  lastArchiveRunOn: string | null
  timezone: string
}

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

export async function getRetentionSettings(): Promise<RetentionSettingsView> {
  const adminId = await requireAdmin()
  if (!adminId) throw new Error('Unauthorized')

  const row = await readRetentionSettingsRow()
  const policy = resolveRetentionPolicy(asPolicyInput(row), process.env)
  const eligibleCount = await countEligibleForArchive(policy)
  return {
    ...policy,
    eligibleCount,
    archiveClock: formatArchiveClock(policy.archiveHour, policy.archiveMinute),
    lastArchiveRunOn: row?.lastArchiveRunOn ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

async function countEligibleForArchive(policy: RetentionPolicy): Promise<number> {
  if (!policy.archiveEnabled) return 0
  const cutoff = retentionCutoffDate(policy.archiveAfterDays)
  return prisma.requests.count({
    where: {
      isArchived: false,
      isDeleted: false,
      status: { in: policy.archiveStatuses },
      updatedAt: { lt: cutoff },
    },
  })
}

export async function saveRetentionSettings(input: {
  archiveEnabled: boolean
  archiveAfterDays: number
  archiveStatuses: string[]
  archiveClock: string
}): Promise<{ success: true; settings: RetentionSettingsView } | { success: false; error: string }> {
  const adminId = await requireAdmin()
  if (!adminId) return { success: false, error: 'Unauthorized - Admin access required' }

  const existing = await readRetentionSettingsRow()
  const clock = parseArchiveClock(input.archiveClock)
  const policy = resolveRetentionPolicy({
    archiveEnabled: input.archiveEnabled,
    archiveAfterDays: input.archiveAfterDays,
    archiveStatuses: input.archiveStatuses,
    cleanupAfterDays: existing?.cleanupAfterDays,
    archiveHour: clock.hour,
    archiveMinute: clock.minute,
  })

  await prisma.retention_settings.upsert({
    where: { id: SETTINGS_ID },
    update: {
      archiveEnabled: policy.archiveEnabled,
      archiveAfterDays: policy.archiveAfterDays,
      archiveStatuses: policy.archiveStatuses,
      cleanupAfterDays: policy.cleanupAfterDays,
      archiveHour: policy.archiveHour,
      archiveMinute: policy.archiveMinute,
      updatedById: adminId,
    },
    create: {
      id: SETTINGS_ID,
      archiveEnabled: policy.archiveEnabled,
      archiveAfterDays: policy.archiveAfterDays,
      archiveStatuses: policy.archiveStatuses,
      cleanupAfterDays: policy.cleanupAfterDays,
      archiveHour: policy.archiveHour,
      archiveMinute: policy.archiveMinute,
      updatedById: adminId,
    },
  })

  revalidatePath('/admin/retention')
  const eligibleCount = await countEligibleForArchive(policy)
  const row = await readRetentionSettingsRow()
  return {
    success: true,
    settings: {
      ...policy,
      eligibleCount,
      archiveClock: formatArchiveClock(policy.archiveHour, policy.archiveMinute),
      lastArchiveRunOn: row?.lastArchiveRunOn ?? null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  }
}

export async function runArchiveNow(): Promise<
  { success: true; archived: number } | { success: false; error: string }
> {
  const adminId = await requireAdmin()
  if (!adminId) return { success: false, error: 'Unauthorized - Admin access required' }

  try {
    const result = await applyRetentionArchive('manual')
    revalidatePath('/admin/retention')
    return { success: true, archived: result.archived }
  } catch (error) {
    console.error('Error running archive now:', error)
    return { success: false, error: 'Failed to run archive' }
  }
}
