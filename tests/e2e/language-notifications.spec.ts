import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const BASE = 'http://localhost:32143'
const DB = 'postgresql://th_en_local@127.0.0.1:55473/app_cleanstart_dev'
const EMAIL = 'alice@example.com'
const requestId = randomUUID()
const notificationId = randomUUID()
const otherNotificationId = randomUUID()
const otherTitle = 'Private notification for another user'
const legacyId = 'b3608961-e034-4773-86c8-9293dcbda266'
const requestTitle = `Request {reason} — ชื่อเดิม ${requestId}`
const reason = 'Rework <b>this</b> — เหตุผลเดิม'
const legacyTitle = 'Stored legacy notice — เดิม'
const legacyBody = 'Legacy body {requestTitle} <b>is plain text</b>'
const englishMessage = `❌ Request Rejected: Your request "${requestTitle}" has been rejected. Reason: "${reason}"`
const thaiMessage = `❌ ไม่อนุมัติ Request "${requestTitle}" เหตุผล: "${reason}"`
let prisma: PrismaClient
let user: { id: string; preferredLocale: string }
let insertedLegacy = false

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
  insertedLegacy = (await prisma.$executeRaw`
    INSERT INTO notifications (id, "userId", type, title, message)
    VALUES (${legacyId}, ${user.id}, 'status_changed', ${legacyTitle}, ${legacyBody})
    ON CONFLICT (id) DO NOTHING
  `) === 1
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
    if (insertedLegacy) await prisma.$executeRaw`DELETE FROM notifications WHERE id = ${legacyId}`
    await prisma.requests.deleteMany({ where: { id: requestId } })
    if (user) await prisma.user.update({ where: { id: user.id }, data: { preferredLocale: user.preferredLocale } })
  } finally {
    await prisma.$disconnect()
  }
})

test('the same unread notification changes language without changing the stored pair, Request link, or read state', async ({ page }) => {
  await page.goto('/sign-in?callbackUrl=%2Frequests')
  await page.locator('#email').fill(EMAIL)
  await page.locator('#password').fill(process.env.E2E_PASSWORD || 'changeme')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${BASE}/requests`, { timeout: 60_000 })

  const url = page.url()
  const bell = page.getByRole('button').filter({ has: page.locator('svg.lucide-bell.h-5') })
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
