import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import {
  resolveRetentionPolicy,
  isEligibleForAutoArchive,
  buildRetentionBackupFolderName,
  buildRetentionBackupEntries,
  shouldRunDailyArchive,
  parseArchiveClock,
  RETENTION_DEFAULTS,
} from '../../src/lib/retention-policy'

describe('resolveRetentionPolicy', () => {
  it('uses defaults when nothing is saved', () => {
    const policy = resolveRetentionPolicy(null, {})
    assert.equal(policy.archiveEnabled, true)
    assert.equal(policy.archiveAfterDays, RETENTION_DEFAULTS.archiveAfterDays)
    assert.deepEqual(policy.archiveStatuses, ['Completed', 'Cancelled'])
    assert.equal(policy.cleanupAfterDays, RETENTION_DEFAULTS.cleanupAfterDays)
  })

  it('falls back to env when the database row is missing', () => {
    const policy = resolveRetentionPolicy(null, {
      ARCHIVE_AFTER_DAYS: '120',
      CLEANUP_THRESHOLD_DAYS: '400',
    })
    assert.equal(policy.archiveAfterDays, 120)
    assert.equal(policy.cleanupAfterDays, 400)
  })

  it('clamps days and drops unknown statuses', () => {
    const policy = resolveRetentionPolicy({
      archiveEnabled: false,
      archiveAfterDays: 2,
      archiveStatuses: ['Completed', 'NotAStatus'],
      cleanupAfterDays: 9000,
    })
    assert.equal(policy.archiveEnabled, false)
    assert.equal(policy.archiveAfterDays, 7)
    assert.deepEqual(policy.archiveStatuses, ['Completed'])
    assert.equal(policy.cleanupAfterDays, 3650)
  })
})

describe('isEligibleForAutoArchive', () => {
  const now = new Date('2026-08-25T00:00:00.000Z')
  const policy = resolveRetentionPolicy({
    archiveEnabled: true,
    archiveAfterDays: 90,
    archiveStatuses: ['Completed', 'Cancelled'],
    cleanupAfterDays: 365,
  })

  it('archives old completed requests only', () => {
    assert.equal(
      isEligibleForAutoArchive(
        {
          status: 'Completed',
          isArchived: false,
          isDeleted: false,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        policy,
        now
      ),
      true
    )
    assert.equal(
      isEligibleForAutoArchive(
        {
          status: 'ImprovementRequest',
          isArchived: false,
          isDeleted: false,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        policy,
        now
      ),
      false
    )
  })

  it('skips when auto-archive is off', () => {
    assert.equal(
      isEligibleForAutoArchive(
        {
          status: 'Completed',
          isArchived: false,
          isDeleted: false,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        { ...policy, archiveEnabled: false },
        now
      ),
      false
    )
  })
})

describe('shouldRunDailyArchive', () => {
  it('runs once per local day after the scheduled time', () => {
    const now = new Date('2026-08-26T02:05:00')
    assert.equal(
      shouldRunDailyArchive({
        archiveEnabled: true,
        hour: 2,
        minute: 0,
        lastRunOn: null,
        now,
      }),
      true
    )
    assert.equal(
      shouldRunDailyArchive({
        archiveEnabled: true,
        hour: 2,
        minute: 0,
        lastRunOn: '2026-08-26',
        now,
      }),
      false
    )
    assert.equal(
      shouldRunDailyArchive({
        archiveEnabled: true,
        hour: 3,
        minute: 0,
        lastRunOn: null,
        now,
      }),
      false
    )
  })

  it('parses HH:MM into a clock', () => {
    assert.deepEqual(parseArchiveClock('02:30'), { hour: 2, minute: 30 })
    assert.deepEqual(parseArchiveClock('bad'), { hour: 2, minute: 0 })
  })
})

describe('retention backup folders', () => {
  it('puts each request in its own folder with report.pdf and attachments/', () => {
    const folder = buildRetentionBackupFolderName(
      '11111111-1111-1111-1111-111111111111',
      'Pump / upgrade'
    )
    assert.equal(folder.startsWith('11111111-'), true)
    assert.doesNotMatch(folder, /[\\/]/)

    const entries = buildRetentionBackupEntries({
      requestId: '11111111-1111-1111-1111-111111111111',
      title: 'Pump / upgrade',
      reportPdf: Buffer.from('pdf'),
      attachments: [
        { fileName: 'drawing.pdf', bytes: Buffer.from('a') },
        { fileName: 'quote.xlsx', bytes: Buffer.from('b') },
      ],
    })

    assert.deepEqual(
      entries.map((entry) => entry.path),
      [
        `${folder}/report.pdf`,
        `${folder}/attachments/drawing.pdf`,
        `${folder}/attachments/quote.xlsx`,
      ]
    )
  })

  it('never emits a fake report.pdf when PDF generation failed', () => {
    const entries = buildRetentionBackupEntries({
      requestId: '11111111-1111-1111-1111-111111111111',
      title: 'Pump',
      reportPdf: null,
      reportError: 'boom',
      attachments: [],
    })

    assert.deepEqual(entries.map((entry) => entry.path), [
      '11111111-Pump/report.ERROR.txt',
    ])
    assert.match(entries[0].data.toString(), /boom/)
  })

  it('keeps unauthenticated archive internals out of the use-server module', () => {
    const actions = readFileSync('src/server-actions/retention.ts', 'utf8')
    assert.match(actions, /^'use server'/m)
    assert.doesNotMatch(actions, /export async function applyRetentionArchive/)
    assert.doesNotMatch(actions, /export async function getResolvedRetentionPolicy/)

    const lib = readFileSync('src/lib/retention-archive.ts', 'utf8')
    assert.doesNotMatch(lib, /^'use server'/m)
    assert.match(lib, /export async function applyRetentionArchive/)

    const cron = readFileSync('src/app/api/cron/archive/route.ts', 'utf8')
    assert.match(cron, /@\/lib\/retention-archive/)
  })

  it('hides archived requests from actionable queues', () => {
    const requestsActions = readFileSync('src/server-actions/requests.ts', 'utf8')
    const pendingCount = readFileSync('src/app/api/actions/pending-count/route.ts', 'utf8')
    const engineering = readFileSync('src/app/(dashboard)/engineering/page.tsx', 'utf8')
    const dashboard = readFileSync('src/server-actions/dashboard.ts', 'utf8')

    // Seam-specific: each actionable query body must contain its own filter.
    const bodyOf = (source: string, marker: string) => {
      const start = source.indexOf(marker)
      if (start === -1) throw new Error(`marker not found: ${marker}`)
      const end = source.indexOf('\nexport ', start + 1)
      return source.slice(start, end === -1 ? undefined : end)
    }

    const actionItems = bodyOf(requestsActions, 'export async function getMyActionItems')
    assert.match(actionItems, /isArchived: false/)
    assert.equal((actionItems.match(/isArchived: false/g) ?? []).length, 2, 'request + solution approval queues')

    const engineeringAction = bodyOf(requestsActions, 'export async function getRequestsNeedingEngineeringAction')
    assert.equal((engineeringAction.match(/isArchived: false/g) ?? []).length, 2)

    const engineeringList = bodyOf(requestsActions, 'export async function getRequestsForEngineering')
    assert.equal((engineeringList.match(/isArchived: false/g) ?? []).length, 1)

    assert.equal((pendingCount.match(/isArchived: false/g) ?? []).length, 2, 'both pending-count queries')

    // Engineering page: board query + six stat counts, each paired with isDeleted
    assert.match(
      engineering,
      /in: \["SentToEngineer", "SendBackToRequester", "FinalApproval"\],\s*\n\s*\},\s*\n\s*isDeleted: false,\s*\n\s*isArchived: false,/
    )
    assert.equal((engineering.match(/isArchived: false/g) ?? []).length, 7, 'board + 6 stat queries')

    const allRequests = bodyOf(dashboard, 'export async function getAllRequests')
    assert.equal((allRequests.match(/isArchived: false/g) ?? []).length, 3, 'all three visibility branches')
  })

  it('bulk archive audits only rows it actually archived', () => {
    const requestsActions = readFileSync('src/server-actions/requests.ts', 'utf8')
    const start = requestsActions.indexOf('bulkDeleteRequestsByDateRange')
    const body = requestsActions.slice(start, requestsActions.indexOf('PHASE 4', start))

    assert.match(body, /for \(const r of requests\)/)
    assert.match(body, /updated\.count === 1/)
    assert.match(body, /updatedIds\.map\(id =>/)
    // The audit rows are built from confirmed IDs only, not the raw candidate list
    assert.doesNotMatch(body, /data: requests\.map\(r => \(\{\s*\n\s*requestId: r\.id/)
  })
})

describe('retention feature wiring', () => {
  it('lets admins edit policy and download a foldered backup zip', () => {
    assert.equal(existsSync('src/app/admin/retention/page.tsx'), true)
    const page = readFileSync('src/app/admin/retention/page.tsx', 'utf8')
    const cron = readFileSync('src/app/api/cron/archive/route.ts', 'utf8')
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    assert.match(page, /RetentionPolicyForm/)
    assert.match(page, /RetentionRequestList/)
    assert.match(cron, /applyRetentionArchive/)
    assert.match(schema, /model retention_settings/)
    assert.equal(existsSync('src/app/api/admin/retention/backup/route.ts'), true)
    const backup = readFileSync('src/app/api/admin/retention/backup/route.ts', 'utf8')
    assert.match(backup, /requireAdmin/)
    assert.match(backup, /buildRetentionBackupEntries/)
  })
})
