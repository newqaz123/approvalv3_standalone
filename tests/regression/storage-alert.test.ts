import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import {
  parseStorageAlertThreshold,
  shouldSendStorageAlert,
  buildStorageAlertEmail,
  runStorageAlertCheck,
  type StorageAlertDependencies,
} from '../../src/lib/storage-alert'

describe('parseStorageAlertThreshold', () => {
  it('returns 0 for off and clamps into the allowed band', () => {
    assert.equal(parseStorageAlertThreshold(0), 0)
    assert.equal(parseStorageAlertThreshold(null), 0)
    assert.equal(parseStorageAlertThreshold(undefined), 0)
    assert.equal(parseStorageAlertThreshold('not-a-number'), 0)
    assert.equal(parseStorageAlertThreshold(10), 50, 'below-min clamps up to 50')
    assert.equal(parseStorageAlertThreshold(75), 75)
    assert.equal(parseStorageAlertThreshold(99), 95, 'above-max clamps down to 95')
    assert.equal(parseStorageAlertThreshold(88.6), 89, 'rounds to whole percent')
  })
})

describe('shouldSendStorageAlert', () => {
  const now = new Date('2026-08-26T09:00:00')

  it('never alerts when the threshold is off or usage is unknown', () => {
    assert.equal(
      shouldSendStorageAlert({ thresholdPct: 0, usedPercent: 99, lastAlertOn: null, now }),
      false
    )
    assert.equal(
      shouldSendStorageAlert({ thresholdPct: 80, usedPercent: null, lastAlertOn: null, now }),
      false
    )
  })

  it('alerts at or above the threshold, not below it', () => {
    assert.equal(
      shouldSendStorageAlert({ thresholdPct: 80, usedPercent: 79, lastAlertOn: null, now }),
      false
    )
    assert.equal(
      shouldSendStorageAlert({ thresholdPct: 80, usedPercent: 80, lastAlertOn: null, now }),
      true
    )
    assert.equal(
      shouldSendStorageAlert({ thresholdPct: 80, usedPercent: 93, lastAlertOn: null, now }),
      true
    )
  })

  it('sends at most once per local day', () => {
    assert.equal(
      shouldSendStorageAlert({ thresholdPct: 80, usedPercent: 90, lastAlertOn: '2026-08-26', now }),
      false
    )
    assert.equal(
      shouldSendStorageAlert({ thresholdPct: 80, usedPercent: 90, lastAlertOn: '2026-08-25', now }),
      true
    )
  })
})

describe('buildStorageAlertEmail', () => {
  it('states the situation plainly with real numbers and a link', () => {
    const email = buildStorageAlertEmail({
      usedPercent: 87,
      usedBytes: 87 * 1024 ** 3,
      totalBytes: 100 * 1024 ** 3,
      freeBytes: 13 * 1024 ** 3,
      thresholdPct: 80,
      baseUrl: 'http://localhost:3002',
    })

    assert.equal(email.subject, '[Approval System] Disk 87% full')
    assert.match(email.heading, /Disk almost full/i)
    assert.match(email.message, /87%/)
    assert.match(email.message, /87 GB/)
    assert.match(email.message, /100 GB/)
    assert.match(email.message, /13 GB/)
    assert.match(email.message, /80%/)
    assert.match(email.message, /http:\/\/localhost:3002\/admin\/storage/)
  })
})

describe('runStorageAlertCheck orchestration', () => {
  function dependencies(overrides: Partial<StorageAlertDependencies> = {}): StorageAlertDependencies {
    return {
      now: () => new Date('2026-08-26T09:00:00'),
      readSettings: async () => ({ thresholdPct: 80, lastAlertOn: null }),
      measureDisk: async () => ({
        diskTotalBytes: 100 * 1024 ** 3,
        diskFreeBytes: 10 * 1024 ** 3,
      }),
      listAdminEmails: async () => ['one@example.com', 'two@example.com'],
      claimAlertDay: async () => true,
      sendEmail: async () => undefined,
      ...overrides,
    }
  }

  it('atomically allows only one concurrent sender to claim the day', async () => {
    let claimedOn: string | null = null
    let sends = 0
    const deps = dependencies({
      claimAlertDay: async (day) => {
        if (claimedOn === day) return false
        claimedOn = day
        return true
      },
      sendEmail: async () => {
        sends += 1
      },
    })

    const results = await Promise.all([
      runStorageAlertCheck(deps),
      runStorageAlertCheck(deps),
    ])

    assert.equal(results.filter((result) => result.sent).length, 1)
    assert.equal(sends, 1)
    assert.equal(claimedOn, '2026-08-26')
  })

  it('does not send when the database claim fails', async () => {
    let sends = 0
    const result = await runStorageAlertCheck(
      dependencies({
        claimAlertDay: async () => false,
        sendEmail: async () => {
          sends += 1
        },
      })
    )

    assert.equal(result.sent, false)
    assert.equal(result.reason, 'already-claimed')
    assert.equal(sends, 0)
  })

  it('passes recipients as BCC and never as a visible To list', async () => {
    const deliveries: Array<Parameters<StorageAlertDependencies['sendEmail']>[0]> = []
    await runStorageAlertCheck(
      dependencies({
        sendEmail: async (input) => {
          deliveries.push(input)
        },
      })
    )

    assert.deepEqual(deliveries[0]?.bcc, ['one@example.com', 'two@example.com'])
    assert.ok(!('to' in (deliveries[0] ?? {})), 'orchestration exposes no visible recipient list')
  })
})

describe('storage alert wiring', () => {
  it('stores the threshold and last-alert day on retention_settings', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    assert.match(schema, /storageAlertThresholdPct/)
    assert.match(schema, /lastStorageAlertOn/)
    assert.ok(
      existsSync('prisma/migrations/20260827000000_add_storage_alert/migration.sql'),
      'migration exists'
    )
  })

  it('checks the threshold from the daily clock without bundling nodemailer', () => {
    const scheduler = readFileSync('src/lib/retention-scheduler.ts', 'utf8')
    assert.match(scheduler, /runStorageAlertCheck/)

    const nextConfig = readFileSync('next.config.mjs', 'utf8')
    assert.match(nextConfig, /serverExternalPackages:\s*\[['"]nodemailer['"]\]/)

    const instrumentation = readFileSync('src/instrumentation.ts', 'utf8')
    assert.match(instrumentation, /NEXT_RUNTIME/)
    assert.match(instrumentation, /import\(['"]\.\/instrumentation\.node['"]\)/)
    assert.doesNotMatch(instrumentation, /retention-scheduler/)
  })

  it('exposes an admin-gated save action and the card on the storage page', () => {
    const action = readFileSync('src/server-actions/storage-dashboard.ts', 'utf8')
    assert.match(action, /export async function saveStorageAlertThreshold/)
    assert.match(action, /requireAdmin/)

    const dashboard = readFileSync('src/components/admin/storage-dashboard.tsx', 'utf8')
    assert.match(dashboard, /StorageAlertCard/)
    assert.match(
      dashboard,
      /data\.diskTotalBytes\s*-\s*data\.diskFreeBytes/,
      'alert preview uses whole-disk usage, not uploads-folder size'
    )

    const card = readFileSync('src/components/admin/storage-alert-card.tsx', 'utf8')
    assert.match(card, /Email all admins/)
    assert.match(card, /Checked regularly; at most one alert attempt per day\./)
    assert.doesNotMatch(card, /Checked once a day/)
    assert.match(card, /aria-live=["']polite["']/)
    assert.match(dashboard, /from '@\/components\/admin\/storage-alert-card'/, 'card is imported, not inline')
  })

  it('sends to active admins only and records the alert day', () => {
    const lib = readFileSync('src/lib/storage-alert.ts', 'utf8')
    assert.match(lib, /role: 'admin'/)
    assert.match(lib, /isActive: true/)
    assert.match(lib, /lastStorageAlertOn/)
    assert.match(lib, /updateMany/)
    assert.match(lib, /bcc:/)
    assert.doesNotMatch(lib, /^'use server'/m, 'transport internals must not be a server action module')
    assert.doesNotMatch(lib, /import nodemailer|from ['"]nodemailer['"]/, 'instrumentation must not bundle Node-only nodemailer')

    const action = readFileSync('src/server-actions/storage-dashboard.ts', 'utf8')
    const saveBlock = action.slice(
      action.indexOf('export async function saveStorageAlertThreshold'),
      action.indexOf('export async function createStoragePlanEvent')
    )
    assert.doesNotMatch(
      saveBlock,
      /lastStorageAlertOn:\s*null/,
      'changing a threshold must preserve the once-per-day guard'
    )
  })
})
