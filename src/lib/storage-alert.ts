import prisma from '@/lib/prisma'
import { decryptEmailSecret } from '@/lib/email-crypto'
import {
  readEnvEmailConfig,
  resolveRuntimeEmailTransport,
} from '@/lib/email-settings'
import { formatStorageBytes } from '@/lib/storage-dashboard'

// Server-only alert engine. NOT a 'use server' module: nothing here is
// directly invocable from the client. The scheduler calls runStorageAlertCheck;
// admins change the threshold only through the gated server action.

export const STORAGE_ALERT_MIN_PCT = 50
export const STORAGE_ALERT_MAX_PCT = 95

const SETTINGS_ID = 'default'

type DiskMeasurement = {
  diskTotalBytes: number | null
  diskFreeBytes: number | null
}

type AlertSettings = {
  thresholdPct: number
  lastAlertOn: string | null
}

type StorageAlertEmail = {
  subject: string
  heading: string
  message: string
}

export type StorageAlertDependencies = {
  now: () => Date
  readSettings: () => Promise<AlertSettings>
  measureDisk: () => Promise<DiskMeasurement>
  listAdminEmails: () => Promise<string[]>
  claimAlertDay: (day: string, thresholdPct: number) => Promise<boolean>
  sendEmail: (input: {
    bcc: string[]
    email: StorageAlertEmail
  }) => Promise<void>
}

export function parseStorageAlertThreshold(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(
    STORAGE_ALERT_MAX_PCT,
    Math.max(STORAGE_ALERT_MIN_PCT, Math.round(parsed))
  )
}

function localDateKey(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function shouldSendStorageAlert(input: {
  thresholdPct: number
  usedPercent: number | null
  lastAlertOn: string | null
  now: Date
}): boolean {
  if (input.thresholdPct <= 0) return false
  if (input.usedPercent == null) return false
  if (input.usedPercent < input.thresholdPct) return false
  return input.lastAlertOn !== localDateKey(input.now)
}

export function buildStorageAlertEmail(input: {
  usedPercent: number
  usedBytes: number
  totalBytes: number
  freeBytes: number
  thresholdPct: number
  baseUrl: string
}): StorageAlertEmail {
  const { usedPercent, thresholdPct } = input
  const url = `${input.baseUrl.replace(/\/$/, '')}/admin/storage`

  return {
    subject: `[Approval System] Disk ${usedPercent}% full`,
    heading: 'Disk almost full',
    message: [
      `The server disk is ${usedPercent}% full, at or above your ${thresholdPct}% alert limit.`,
      '',
      `Used: ${formatStorageBytes(input.usedBytes)} of ${formatStorageBytes(input.totalBytes)}`,
      `Free: ${formatStorageBytes(input.freeBytes)}`,
      '',
      `Review storage and clean up archived requests: ${url}`,
    ].join('\n'),
  }
}

async function resolveTransport() {
  // instrumentation.ts is webpack-compiled even for the Node runtime. A
  // static Nodemailer import makes that compiler resolve Node core modules as
  // browser modules. Runtime require keeps this Node-only dependency external.
  const runtimeRequire = eval('require') as NodeRequire
  const nodemailer = runtimeRequire('nodemailer') as typeof import('nodemailer')
  const row = await prisma.email_settings.findUnique({ where: { id: 'default' } })
  return resolveRuntimeEmailTransport({
    row,
    env: readEnvEmailConfig(process.env),
    decrypt: (envelope, aad) => decryptEmailSecret(envelope, aad),
    createTransport: (options) => nodemailer.createTransport(options),
  })
}

async function measureServerDisk(): Promise<DiskMeasurement> {
  try {
    // See resolveTransport: this module is reachable from instrumentation,
    // whose compiler cannot bundle Node core modules. Resolve at runtime.
    const runtimeRequire = eval('require') as NodeRequire
    const fs = runtimeRequire('node:fs') as typeof import('node:fs')
    const path = runtimeRequire('node:path') as typeof import('node:path')
    const uploadRoot = path.resolve(
      process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads')
    )
    const target = fs.existsSync(uploadRoot) ? uploadRoot : process.cwd()
    const volume = fs.statfsSync(target)
    return {
      diskTotalBytes: Number(volume.bsize) * Number(volume.blocks),
      diskFreeBytes: Number(volume.bsize) * Number(volume.bavail),
    }
  } catch {
    return { diskTotalBytes: null, diskFreeBytes: null }
  }
}

const productionDependencies: StorageAlertDependencies = {
  now: () => new Date(),
  readSettings: async () => {
    const row = await prisma.retention_settings.findUnique({
      where: { id: SETTINGS_ID },
      select: { storageAlertThresholdPct: true, lastStorageAlertOn: true },
    })
    return {
      thresholdPct: row?.storageAlertThresholdPct ?? 0,
      lastAlertOn: row?.lastStorageAlertOn ?? null,
    }
  },
  measureDisk: measureServerDisk,
  listAdminEmails: async () => {
    const admins = await prisma.user.findMany({
      where: { role: 'admin', isActive: true },
      select: { email: true },
    })
    return admins.map((admin) => admin.email).filter(Boolean)
  },
  claimAlertDay: async (day, thresholdPct) => {
    // This conditional update is the cross-process lock. Only one scheduler
    // can change the guard from an older day to today. Matching the threshold
    // also prevents sending from a stale read after an admin changes it.
    const claimed = await prisma.retention_settings.updateMany({
      where: {
        id: SETTINGS_ID,
        storageAlertThresholdPct: thresholdPct,
        OR: [
          { lastStorageAlertOn: null },
          { lastStorageAlertOn: { not: day } },
        ],
      },
      data: { lastStorageAlertOn: day },
    })
    return claimed.count === 1
  },
  sendEmail: async ({ bcc, email }) => {
    const resolved = await resolveTransport()
    if (!resolved.ok) {
      throw new Error(`Email unavailable: ${resolved.reason}`)
    }

    await resolved.transporter.sendMail({
      from: resolved.from,
      to: resolved.from,
      bcc,
      subject: email.subject,
      text: email.message,
      html: `<p>${email.message.split('\n').map((line) => line || '&nbsp;').join('<br/>')}</p>`,
    })
  },
}

/**
 * Daily-clock entry point. It claims today's database guard before SMTP so
 * concurrent ticks/processes cannot send duplicate alerts. A failed delivery
 * remains claimed: this is deliberately at-most-once, not at-least-once.
 */
export async function runStorageAlertCheck(
  dependencyOverrides: Partial<StorageAlertDependencies> = {}
): Promise<{ sent: boolean; usedPercent: number | null; reason?: string }> {
  const dependencies = { ...productionDependencies, ...dependencyOverrides }

  let settings: AlertSettings
  try {
    settings = await dependencies.readSettings()
  } catch {
    return { sent: false, usedPercent: null, reason: 'settings-unavailable' }
  }

  const volume = await dependencies.measureDisk()
  if (volume.diskTotalBytes == null || volume.diskTotalBytes <= 0) {
    return { sent: false, usedPercent: null, reason: 'disk-unreadable' }
  }

  const usedBytes = volume.diskTotalBytes - (volume.diskFreeBytes ?? 0)
  const usedPercent = Math.min(
    100,
    Math.max(0, Math.round((usedBytes / volume.diskTotalBytes) * 100))
  )
  const now = dependencies.now()

  if (
    !shouldSendStorageAlert({
      thresholdPct: settings.thresholdPct,
      usedPercent,
      lastAlertOn: settings.lastAlertOn,
      now,
    })
  ) {
    return { sent: false, usedPercent }
  }

  const recipients = await dependencies.listAdminEmails()
  if (recipients.length === 0) {
    return { sent: false, usedPercent, reason: 'no-admin-recipients' }
  }

  let claimed = false
  try {
    claimed = await dependencies.claimAlertDay(
      localDateKey(now),
      settings.thresholdPct
    )
  } catch {
    return { sent: false, usedPercent, reason: 'claim-failed' }
  }
  if (!claimed) {
    return { sent: false, usedPercent, reason: 'already-claimed' }
  }

  const email = buildStorageAlertEmail({
    usedPercent,
    usedBytes,
    totalBytes: volume.diskTotalBytes,
    freeBytes: volume.diskFreeBytes ?? 0,
    thresholdPct: settings.thresholdPct,
    baseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  })

  try {
    await dependencies.sendEmail({ bcc: recipients, email })
  } catch (error) {
    // Message only — never log transport options, which carry credentials.
    console.error(
      '[storage-alert] Failed to send alert email:',
      error instanceof Error ? error.message : error
    )
    return { sent: false, usedPercent, reason: 'send-failed' }
  }

  return { sent: true, usedPercent }
}
