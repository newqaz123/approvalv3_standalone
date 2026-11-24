import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'

const BASE_URL = 'http://localhost:32143'
const DATABASE_URL = 'postgresql://th_en_local@127.0.0.1:55473/app_cleanstart_dev'
const ALICE = 'alice@example.com'
const ADMIN = 'admin@example.com'
const PASSWORD = process.env.E2E_PASSWORD || 'changeme'
const fixtureId = randomUUID()
const title = `Insights fixture ${fixtureId} — ชื่อเดิม`
const budgetCode = `INS-${fixtureId}`
let prisma: PrismaClient
let originalPreferences: { id: string; preferredLocale: string }[] = []

test.setTimeout(180_000)
test.use({ navigationTimeout: 90_000, actionTimeout: 15_000 })
test.beforeAll(async () => {
  if (process.env.TEST_BASE_URL !== BASE_URL || process.env.DATABASE_URL !== DATABASE_URL) {
    throw new Error(`Language insights tests require ${BASE_URL} and the isolated PostgreSQL fixture target`)
  }
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } })
  originalPreferences = await prisma.user.findMany({ where: { email: { in: [ALICE, ADMIN] } }, select: { id: true, preferredLocale: true } })
  await prisma.user.updateMany({ where: { id: { in: originalPreferences.map(user => user.id) } }, data: { preferredLocale: 'en' } })
  const alice = await prisma.user.findUniqueOrThrow({ where: { email: ALICE }, select: { id: true } })
  const { unitId } = await prisma.organization_assignments.findFirstOrThrow({ where: { userId: alice.id, isActive: true }, select: { unitId: true } })
  await prisma.budget_codes.create({ data: { id: fixtureId, code: budgetCode.toUpperCase(), displayCode: budgetCode, name: 'Fixture budget — ชื่อเดิม', unitId, createdById: alice.id, budgetAmount: 54321 } })
  await prisma.requests.createMany({ data: [
    { id: `${fixtureId}-approval`, title, description: 'Insights fixture', status: 'FinalApproval', requesterId: alice.id, organizationUnitId: unitId, projectEstimateCost: 12345 },
    { id: `${fixtureId}-engineering`, title: `${title} / Engineering`, description: 'Insights fixture', status: 'SentToEngineer', requesterId: alice.id, organizationUnitId: unitId, budgetCodeId: fixtureId, projectEstimateCost: 23456 },
  ] })
})
test.afterEach(async () => {
  await prisma?.user.updateMany({ where: { id: { in: originalPreferences.map(user => user.id) } }, data: { preferredLocale: 'en' } })
})
test.afterAll(async () => {
  if (!prisma) return
  try {
    await prisma.requests.deleteMany({ where: { id: { in: [`${fixtureId}-approval`, `${fixtureId}-engineering`] } } })
    await prisma.budget_codes.deleteMany({ where: { id: fixtureId } })
    for (const user of originalPreferences) {
      await prisma.user.update({ where: { id: user.id }, data: { preferredLocale: user.preferredLocale } })
    }
  } finally {
    await prisma.$disconnect()
  }
})

async function signIn(page: Page, email: string, path: string) {
  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent(path)}`)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${BASE_URL}${path}`, { timeout: 45_000 })
}

async function chooseLanguage(page: Page, locale: 'en' | 'th') {
  await page.getByRole('button', { name: /^(Open user menu|เปิดเมนูผู้ใช้)$/ }).click()
  await page.getByRole('menuitemradio', { name: locale === 'th' ? 'ไทย' : 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', locale, { timeout: 25_000 })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

test('Dashboard preserves the request and badge, and Workflow preserves the assigned unit', async ({ page }) => {
  await signIn(page, ALICE, '/dashboard')
  const request = page.getByRole('button', { name: new RegExp(`^${title} Final Approval|^${title} ★`) })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Improvement Requests — Your department')
  await expect(request.getByText('Final Approval', { exact: true })).toBeVisible()
  await expectEmptyDrawer('Needs attention', 'No requests here.', 'Close drawer')
  await chooseLanguage(page, 'th')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Request ปรับปรุงงาน — หน่วยงานของคุณ')
  await expect(request.getByText('Final Approval', { exact: true })).toBeVisible()
  await expectEmptyDrawer('ควรติดตาม', 'ไม่มี Request ในรายการนี้', 'ปิดรายการ')
  await page.goto('/dashboard/workflow')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ขั้นตอนอนุมัติ')
  const unit = (await page.getByText(/^หน่วยงานของคุณ: /).innerText()).split(': ')[1]
  expect(unit).toBeTruthy()
  await chooseLanguage(page, 'en')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Approval Workflow')
  await expect(page.getByText(`Your unit: ${unit}`, { exact: true })).toBeVisible()

  async function expectEmptyDrawer(label: string, empty: string, close: string) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
    const drawer = page.getByRole('complementary').filter({ has: page.getByRole('heading', { name: label, exact: true }) })
    await expect(drawer.getByText(empty, { exact: true })).toBeVisible()
    await drawer.getByRole('button', { name: close }).click()
    await expect(drawer).toHaveCount(0)
  }
})

test('Workflow shows bilingual guidance for a seeded account without an assignment', async ({ page }) => {
  await signIn(page, ADMIN, '/dashboard/workflow')
  await expect(page.getByText('You are not assigned to an organization unit. Please contact your administrator.')).toBeVisible()
  await chooseLanguage(page, 'th')
  await expect(page.getByText('คุณยังไม่มีหน่วยงานที่ได้รับมอบหมาย กรุณาติดต่อผู้ดูแลระบบ')).toBeVisible()
})

test('Analytics translates chart legends and loading/empty copy without changing chart data or Status labels', async ({ page }) => {
  await signIn(page, ALICE, '/analytics?dateRange=30days')
  const heading = page.getByRole('heading', { level: 1 })
  const legend = page.locator('.recharts-legend-item-text')
  const chartRows = page.getByRole('table').locator('tbody tr')
  await expect(heading).toHaveText('Analytics')
  await expect(legend).toHaveText(['Engineering unresolved', 'Resolved by Engineering'], { timeout: 25_000 })
  const englishRows = await chartRows.allTextContents()
  expect(englishRows.length).toBeGreaterThan(0)
  expect(await chartRows.locator('td:first-of-type').allTextContents()).toContain('1')
  const statusName = 'Final Approval'

  async function filterStatus(allStatuses: string, loading: string, empty: string) {
    await page.getByRole('button', { name: /^(Filters|ตัวกรอง)/ }).click()
    await page.getByRole('combobox').filter({ hasText: allStatuses }).click()
    await expect(page.getByRole('option', { name: statusName, exact: true })).toBeVisible()
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route('**/analytics*', async route => {
      const request = route.request()
      if (request.method() === 'POST' && request.postData()?.includes('Cancelled')) await held
      await route.continue()
    })
    try {
      await page.getByRole('option', { name: 'Cancelled', exact: true }).click()
      await expect(page.getByText(loading, { exact: true })).toBeVisible()
    } finally {
      release()
      await page.unrouteAll({ behavior: 'wait' })
    }
    await expect(page).toHaveURL(/status=Cancelled/, { timeout: 25_000 })
    await expect(page.getByText(empty, { exact: true })).toBeVisible()
  }

  await chooseLanguage(page, 'th')
  await expect(heading).toHaveText('วิเคราะห์ข้อมูล')
  await expect(legend).toHaveText(['งาน Engineering ที่ยังค้าง', 'งานที่ Engineering จัดการแล้ว'])
  expect(await chartRows.allTextContents()).toEqual(englishRows)
  await filterStatus('ทุกสถานะ', 'กำลังอัปเดตข้อมูล...', 'ไม่มีข้อมูลแนวโน้มงาน Engineering')
  await chooseLanguage(page, 'en')
  await expect(page).toHaveURL(/status=Cancelled/)
  await expect(page.getByRole('combobox').filter({ hasText: 'Cancelled' })).toBeVisible()
  await expect(page.getByText('No engineering resolution data available', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(legend).toHaveText(['Engineering unresolved', 'Resolved by Engineering'])
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await filterStatus('All Statuses', 'Updating analytics...', 'No engineering resolution data available')
})

test('Budget preserves the saved Requests view, filter value, Status and THB amounts', async ({ page }) => {
  const ready = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/budget-monitor' && response.request().method() === 'POST' && response.ok(),
  { timeout: 45_000 })
  await signIn(page, ALICE, '/budget-monitor')
  // The first debounced data fetch proves the client has hydrated.
  await ready
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveText('Budget Monitor')
  await expect(page.getByText('54,321', { exact: true })).toBeVisible()
  const englishReport = await downloadReport('Reports')
  expect(englishReport.sheet).toContain(`${title} / Engineering`)
  expect(englishReport.sheet).toContain('SentToEngineer')
  await page.getByRole('tab', { name: /^Requests/ }).click()
  const search = page.locator('#budget-monitor-search-md')
  await search.fill(title)
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: title, exact: true }) })
  await expect(row.getByRole('cell', { name: 'FinalApproval', exact: true })).toBeVisible()
  const amount = row.getByRole('button', { name: '12,345', exact: true })
  await expect(amount).toBeVisible()
  await page.getByRole('combobox').filter({ hasText: 'All statuses' }).click()
  await page.getByRole('option', { name: 'FinalApproval', exact: true }).click()
  await expect(page.getByRole('button', { name: 'FinalApproval' })).toBeVisible()
  await chooseLanguage(page, 'th')
  await expect(heading).toHaveText('ติดตามงบ')
  await expect(page.getByRole('tab', { name: /^Request/ })).toHaveAttribute('aria-selected', 'true')
  expect(await page.evaluate(() => localStorage.getItem('budget-monitor-view'))).toBe('requests')
  await expect(search).toHaveValue(title)
  await expect(page.getByRole('button', { name: 'FinalApproval' })).toBeVisible()
  await expect(row.getByRole('cell', { name: 'FinalApproval', exact: true })).toBeVisible()
  await expect(amount).toBeVisible()
  await search.fill(`missing-${fixtureId}`)
  await expect(page.getByText('ไม่มี Request ที่ตรงกับตัวกรอง')).toBeVisible()
  await page.getByRole('button', { name: 'ล้าง', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(row).toBeVisible()
  expect(await downloadReport('รายงาน')).toEqual(englishReport)
  await search.fill(`missing-${fixtureId}`)
  await chooseLanguage(page, 'en')
  await expect(page.getByText('No requests match these filters.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('tab', { name: /^Requests/ })).toHaveAttribute('aria-selected', 'true')

  async function downloadReport(label: string) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 45_000 }),
      page.getByRole('button', { name: label, exact: true }).click({ timeout: 30_000 }),
    ])
    const workbook = XLSX.read(await readFile(await download.path()), { type: 'buffer' })
    expect(workbook.SheetNames).toEqual(['Budget Monitor'])
    return { fileName: download.suggestedFilename(), sheet: XLSX.utils.sheet_to_csv(workbook.Sheets['Budget Monitor']) }
  }
})
