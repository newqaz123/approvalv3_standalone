import assert from 'node:assert/strict'
import nodemailer from 'nodemailer'
import { sendTestEmailCore } from '@/lib/email-settings-action-core'
import prisma from '@/lib/prisma'
import { runStorageAlertCheck } from '@/lib/storage-alert'
import { createNotification } from '@/server-actions/notifications'

// Run through tsx (not Playwright's browser-spec loader) so NextAuth resolves
// its Next.js module imports. The parent owns the capture server and fixtures.
async function sendCompatibilityMail() {
  const [, , requestId, locale, mode] = process.argv
  const base = 'http://localhost:32143'
  const address = 'i18n-fixture@example.invalid'
  const host = '127.0.0.1'
  const port = 35247
  assert.equal(process.env.TEST_BASE_URL, base)
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, base)
  assert.equal(process.env.DATABASE_URL, 'postgresql://th_en_local@127.0.0.1:55473/app_cleanstart_dev')
  assert.equal(process.env.SMTP_HOST, undefined)
  assert.ok(locale === 'en' || locale === 'th')
  assert.ok(mode === 'families' || mode === 'changed-body')
  const [settings, admin, request] = await Promise.all([
    prisma.email_settings.findUniqueOrThrow({ where: { id: 'default' } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }),
    prisma.requests.findUniqueOrThrow({ where: { id: requestId }, include: { requester: true } }),
  ])
  assert.equal(settings.host, host)
  assert.equal(settings.port, port)
  assert.equal(settings.fromAddress, address)
  assert.equal(settings.enabled, true)
  assert.equal(settings.username, null)
  assert.equal(settings.passwordEncrypted, null)
  const { requester, title: requestTitle } = request
  assert.equal(requester.email, 'alice@example.com')
  assert.ok(requestTitle.endsWith(requestId))
  assert.equal(requester.preferredLocale, locale)
  assert.equal(admin.preferredLocale, locale)

  const reason = 'Rework <b>this</b> — เหตุผลเดิม'
  const message = mode === 'changed-body'
    ? 'Changed body fixture'
    : `❌ Request Rejected: Your request "${requestTitle}" has been rejected. Reason: "${reason}"`
  const types = ['approval_needed', 'approval_rejected', 'solution_ready', 'final_approval_needed', 'request_assigned'] as const
  for (const type of mode === 'changed-body' ? [types[0]] : types) {
    await createNotification({
      userId: requester.id, requestId, type, title: 'Request Rejected', message,
      display: { key: 'requestRejected', values: { requestTitle, reason } },
    })
  }
  if (mode === 'changed-body') return

  const probe = await sendTestEmailCore(admin.id, {
    enabled: true, provider: 'custom', host, port, noAuth: true, username: '', password: '', fromAddress: address,
  }, {
    store: {
      findAdminEmail: async id => (await prisma.user.findUnique({ where: { id } }))?.email ?? null,
      findEmailSettings: () => prisma.email_settings.findUnique({ where: { id: 'default' } }),
    },
    createTransport: options => {
      assert.equal(options.host, host)
      assert.equal(options.port, port)
      return nodemailer.createTransport(options)
    },
    env: {},
  })
  assert.deepEqual(probe, { success: true })
  // Real sender, fixed disk reading and day; no scheduler claim or setting write.
  const storage = await runStorageAlertCheck({
    now: () => new Date('2026-11-23T12:00:00Z'),
    readSettings: async () => ({ thresholdPct: 50, lastAlertOn: null }),
    measureDisk: async () => ({ diskTotalBytes: 100, diskFreeBytes: 25 }),
    claimAlertDay: async () => true,
  })
  assert.deepEqual(storage, { sent: true, usedPercent: 75 })
}

sendCompatibilityMail().catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
