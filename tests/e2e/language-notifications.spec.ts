import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { startMailCapture, type CapturedSmtpMessage } from '../support/native/mail-capture'
import { productionSurface } from '../support/i18n/production-surfaces'

const BASE = 'http://localhost:32143'
const DB = 'postgresql://th_en_local@127.0.0.1:55473/app_cleanstart_dev'
const EMAIL = 'alice@example.com'
const requestId = randomUUID()
const notificationId = randomUUID()
const otherNotificationId = randomUUID()
const otherTitle = 'Private notification for another user'
const legacyId = randomUUID()
const requestTitle = `Request {reason} — ชื่อเดิม ${requestId}`
const reason = 'Rework <b>this</b> — เหตุผลเดิม'
const legacyTitle = 'Stored legacy notice — เดิม'
const legacyBody = 'Legacy body {requestTitle} <b>is plain text</b>'
const englishMessage = `❌ Request Rejected: Your request "${requestTitle}" has been rejected. Reason: "${reason}"`
const thaiMessage = `❌ ไม่อนุมัติ Request "${requestTitle}" เหตุผล: "${reason}"`
let prisma: PrismaClient
let user: { id: string; preferredLocale: string }


async function switchLanguage(page: Page, locale: 'th' | 'en') {
  await page.getByRole('button', { name: /^(Open user menu|เปิดเมนูผู้ใช้)$/ }).click()
  await page.getByRole('menuitemradio', { name: locale === 'th' ? 'ไทย' : 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', locale, { timeout: 45_000 })
  await page.keyboard.press('Escape')
}

test.setTimeout(180_000)
test.use({ navigationTimeout: 90_000, actionTimeout: 15_000 })
test.beforeAll(async () => {
  if (process.env.TEST_BASE_URL !== BASE || process.env.DATABASE_URL !== DB) {
    throw new Error(`Language notification tests require ${BASE} and the isolated PostgreSQL fixture target`)
  }
  prisma = new PrismaClient({ datasources: { db: { url: DB } } })
  user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true, preferredLocale: true } })
  await prisma.user.update({ where: { id: user.id }, data: { preferredLocale: 'en' } })
  const unit = await prisma.organization_units.findFirstOrThrow({ where: { parentId: null, isActive: true } })
  await prisma.requests.create({ data: { id: requestId, title: requestTitle, description: 'Original Request details', status: 'ImprovementRequest', requesterId: user.id, organizationUnitId: unit.id } })
  await prisma.$executeRaw`
    INSERT INTO notifications (id, "userId", type, title, message)
    VALUES (${legacyId}, ${user.id}, 'status_changed', ${legacyTitle}, ${legacyBody})
  `
  const otherUser = await prisma.user.findUniqueOrThrow({ where: { email: 'bob@example.com' } })
  await prisma.$executeRaw`
    INSERT INTO notifications (id, "userId", type, title, message, "requestId")
    VALUES (${otherNotificationId}, ${otherUser.id}, 'approval_rejected', ${otherTitle}, 'Private body', ${requestId})
  `
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
  await prisma.$executeRaw`
    INSERT INTO notifications (id, "userId", type, title, message, "requestId", "createdAt")
    VALUES (${notificationId}, ${user.id}, 'approval_rejected', 'Request Rejected', ${englishMessage}, ${requestId}, ${twoHoursAgo.toISOString()}::timestamp)
  `
  // Allow the pre-schema RED run to reach the real list with the legacy English pair.
  const [schema] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'displayKey') AS present
  `
  if (schema.present) {
    await prisma.$executeRaw`
      UPDATE notifications SET "displayKey" = 'requestRejected', "displayValues" = ${JSON.stringify({ requestTitle, reason })}::jsonb
      WHERE id = ${notificationId}
    `
  }
})

test.afterAll(async () => {
  if (!prisma) return
  try {
    await prisma.$executeRaw`DELETE FROM notifications WHERE id IN (${notificationId}, ${otherNotificationId})`
    await prisma.$executeRaw`DELETE FROM notifications WHERE id = ${legacyId}`
    await prisma.requests.deleteMany({ where: { id: requestId } })
    if (user) await prisma.user.update({ where: { id: user.id }, data: { preferredLocale: user.preferredLocale } })
  } finally {
    await prisma.$disconnect()
  }
})

async function signIn(page: Page, email = EMAIL) {
  const path = productionSurface('/requests').path
  await page.goto(`${productionSurface('/sign-in/[[...sign-in]]').path}?callbackUrl=${encodeURIComponent(path)}`)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(process.env.E2E_PASSWORD || 'changeme')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${BASE}${path}`, { timeout: 60_000 })
}

const notificationBell = (page: Page) => page.getByRole('button').filter({ has: page.locator('svg.lucide-bell.h-5') })

test('an interrupted notification load shows a retry, not an empty inbox', async ({ page }) => {
  let interrupted = 0
  let recovered = 0
  let allowListRequest = false
  let releaseRetry!: () => void
  const holdRetry = new Promise<void>(resolve => { releaseRetry = resolve })
  await page.route(`${BASE}/requests`, async route => {
    const request = route.request()
    if (request.method() === 'POST' && request.headers()['next-action'] && request.postData() === JSON.stringify([user.id, 20])) {
      if (!allowListRequest) {
        interrupted++
        return route.abort('connectionreset')
      }
      recovered++
      await holdRetry
    }
    await route.continue()
  })
  try {
    await signIn(page)
    const bell = notificationBell(page)
    await bell.click()
    const error = page.getByRole('alert').filter({ hasText: 'Failed to load notifications' })
    await expect(error).toBeVisible()
    expect(interrupted).toBeGreaterThan(0)
    await expect(page.getByText('No notifications', { exact: true })).toHaveCount(0)
    await expect(page.getByText(englishMessage, { exact: true })).toHaveCount(0)

    allowListRequest = true
    const retry = page.getByRole('button', { name: 'Try again', exact: true })
    await retry.click()
    await expect(retry).toBeDisabled()
    await expect.poll(() => recovered).toBe(1)
    releaseRetry()
    await expect(page.getByText(englishMessage, { exact: true })).toBeVisible()
    await expect(bell).toHaveAccessibleName('Notifications, 2 unread')
    await expect(error).toHaveCount(0)
  } finally {
    releaseRetry()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('notification Retry stays disabled during a background poll with cached rows', async ({ page }) => {
  await page.clock.install()
  let phase: 'initial' | 'fail' | 'hold' = 'initial'
  let polled = 0
  let releasePoll!: () => void
  const heldPoll = new Promise<void>(resolve => { releasePoll = resolve })
  await page.route(`${BASE}/requests`, async route => {
    const request = route.request()
    if (request.method() === 'POST' && request.headers()['next-action'] && request.postData() === JSON.stringify([user.id, 20])) {
      if (phase === 'fail') return route.abort('connectionreset')
      if (phase === 'hold') {
        polled++
        await heldPoll
      }
    }
    await route.continue()
  })
  try {
    await signIn(page)
    const bell = notificationBell(page)
    await bell.click()
    const body = page.getByText(englishMessage, { exact: true })
    await expect(body).toBeVisible()
    phase = 'fail'
    await page.clock.fastForward(30_000)
    const retry = page.getByRole('button', { name: 'Try again', exact: true })
    await expect(retry).toBeEnabled()
    await expect(body).toBeVisible()

    phase = 'hold'
    await page.clock.fastForward(30_000)
    await expect.poll(() => polled).toBe(1)
    await expect(retry).toBeDisabled()
    await expect(body).toBeVisible()
    await expect(bell).toHaveAccessibleName('Notifications, 2 unread')
    releasePoll()
    await expect(retry).toHaveCount(0)
  } finally {
    releasePoll()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('a successful notification load can show an empty inbox', async ({ page }) => {
  const email = 'admin@example.com'
  const account = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
  expect(await prisma.notifications.count({ where: { userId: account.id } })).toBe(0)
  const loaded = page.waitForResponse(response => response.ok() && response.url() === `${BASE}/requests` &&
    !!response.request().headers()['next-action'] && response.request().postData() === JSON.stringify([account.id, 20]))
  await signIn(page, email)
  await loaded
  await notificationBell(page).click()
  await expect(page.getByText('No notifications', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
})

test('the same unread notification changes language without changing the stored pair, Request link, or read state', async ({ page }) => {
  await signIn(page)
  const url = page.url()
  const bell = notificationBell(page)
  await bell.click()
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(englishMessage, { exact: true })).toBeVisible()
  await expect(page.getByText(/2 hours ago/)).toBeVisible()
  await expect(page.getByText(legacyBody, { exact: true })).toBeVisible()
  await expect(page.getByText(otherTitle, { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await switchLanguage(page, 'th')
  await expect(page).toHaveURL(url)
  await bell.click()
  await expect(page.getByRole('heading', { name: 'การแจ้งเตือน', exact: true })).toBeVisible()
  await expect(bell).toHaveAccessibleName('การแจ้งเตือน ยังไม่ได้อ่าน 2 รายการ')
  const row = page.getByRole('button').filter({ has: page.getByText(thaiMessage, { exact: true }) })
  await expect(row.getByText('ไม่อนุมัติ Request', { exact: true })).toBeVisible()
  await expect(row.getByText(/2 ชั่วโมง/)).toBeVisible()
  await expect(row.locator('b')).toHaveCount(0)
  await expect(page.getByText(legacyTitle, { exact: true })).toBeVisible()
  await expect(page.getByText(legacyBody, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้วทั้งหมด', exact: true })).toBeVisible()
  const [stored] = await prisma.$queryRaw<{ title: string; message: string; isRead: boolean; readAt: Date | null; requestId: string }[]>`
    SELECT title, message, "isRead", "readAt", "requestId" FROM notifications WHERE id = ${notificationId}
  `
  expect(stored).toEqual({ title: 'Request Rejected', message: englishMessage, isRead: false, readAt: null, requestId })

  await row.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(requestTitle, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(url)
  await expect.poll(() => prisma.$queryRaw<{ isRead: boolean }[]>`SELECT "isRead" FROM notifications WHERE id = ${notificationId}`).toEqual([{ isRead: true }])
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await switchLanguage(page, 'en')
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread')
  await bell.click()
  await expect(page.getByText(englishMessage, { exact: true })).toBeVisible()
  await expect(page.getByText(legacyBody, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Mark all as read', exact: true }).click()
  await expect(page.getByText('Marked 1 notifications as read', { exact: true })).toBeVisible()
  await expect(bell).toHaveAccessibleName('Notifications')
  await expect(page).toHaveURL(url)
  await expect.poll(() => prisma.$queryRaw<{ isRead: boolean }[]>`SELECT "isRead" FROM notifications WHERE id = ${legacyId}`).toEqual([{ isRead: true }])
  expect(await prisma.$queryRaw<{ isRead: boolean }[]>`SELECT "isRead" FROM notifications WHERE id = ${otherNotificationId}`).toEqual([{ isRead: false }])
})

// Keep every MIME part and its transfer encoding. Ignore only SMTP envelope time,
// Date/Message-ID headers and Nodemailer's random multipart boundary.
function capturedMail({ raw, from, to }: CapturedSmtpMessage) {
  const split = raw.indexOf('\n\n')
  expect(split).toBeGreaterThan(0)
  const headers = raw.slice(0, split).replace(/\n[ \t]+/g, ' ')
  const subject = /^Subject: (.+)$/im.exec(headers)?.[1]
  expect(subject).toBeTruthy()
  const boundary = /boundary="([^"]+)"/i.exec(headers)?.[1]
  const body = raw.slice(split + 2)
  if (!boundary) {
    expect(headers).toMatch(/^Content-Type: text\/plain/im)
    return { from, to, subject, plain: body, html: null }
  }
  const [preamble, plain, html, end] = body.split(`--${boundary}`)
  expect(preamble).toBe('')
  expect(end.trim()).toBe('--')
  expect(plain).toMatch(/Content-Type: text\/plain/)
  expect(html).toMatch(/Content-Type: text\/html/)
  return { from, to, subject, plain, html }
}

test('notification, admin probe and storage mail preserve the captured subject, plain text and HTML across locale changes', async ({ page }) => {
  const requests = productionSurface('/requests')
  await page.goto(`${productionSurface('/sign-in/[[...sign-in]]').path}?callbackUrl=${encodeURIComponent(requests.path)}`)
  await page.locator('#email').fill(EMAIL)
  await page.locator('#password').fill(process.env.E2E_PASSWORD || 'changeme')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${BASE}${requests.path}`, { timeout: 60_000 })
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  // Fail before calling the sender if its fallback could go anywhere other than this capture.
  expect(process.env.SMTP_HOST ?? '').toBe('')
  expect(await prisma.email_settings.count()).toBe(0)
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } })
  const capture = await startMailCapture({ host: '127.0.0.1', port: 35247 })
  const fromAddress = 'i18n-fixture@example.invalid'
  const host = capture.plan.host
  const port = capture.port
  let configured = false
  try {
    await prisma.email_settings.create({ data: { host, port, fromAddress, enabled: true } })
    configured = true
    const send = (locale: 'en' | 'th', mode: 'families' | 'changed-body') => promisify(execFile)(process.execPath, [
      '--import', 'tsx', 'tests/support/i18n/send-compatibility-mail.ts', requestId, locale, mode,
    ], { env: { NODE_ENV: 'test', DATABASE_URL: DB, TEST_BASE_URL: BASE, NEXT_PUBLIC_APP_URL: BASE }, timeout: 30_000 })
    async function sendFamilies(locale: 'en' | 'th') {
      await prisma.user.update({ where: { id: admin.id }, data: { preferredLocale: locale } })
      const start = capture.messages().length
      await send(locale, 'families')
      const messages = capture.messages().slice(start).map(capturedMail)
      expect(messages).toHaveLength(7)
      expect(messages.map(message => message.from)).toEqual(Array(7).fill(fromAddress))
      expect(messages[0].to).toEqual([EMAIL])
      expect(messages[5].subject).toBe('Approval App test email')
      expect(messages.map(message => !!message.html)).toEqual([true, true, true, true, true, false, true])
      return messages
    }

    const en = await sendFamilies('en')
    await switchLanguage(page, 'th')
    expect(await sendFamilies('th')).toEqual(en)
    const count = capture.messages().length
    await send('th', 'changed-body')
    expect(capture.messages()).toHaveLength(count + 1)
    const changed = capturedMail(capture.messages().at(-1)!)
    expect(changed.subject).toBe(en[0].subject)
    expect(changed.plain).not.toBe(en[0].plain)
    expect(changed.html).not.toBe(en[0].html)
  } finally {
    if (configured) await prisma.email_settings.delete({ where: { id: 'default', host, port, fromAddress } })
    await prisma.notifications.deleteMany({ where: { requestId, id: { notIn: [notificationId, otherNotificationId] } } })
    await prisma.user.update({ where: { id: admin.id }, data: { preferredLocale: admin.preferredLocale } })
    await capture.close()
    await prisma.user.update({ where: { id: user.id }, data: { preferredLocale: 'en' } })
  }
})
