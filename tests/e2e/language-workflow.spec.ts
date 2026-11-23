import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const BASE_URL = 'http://localhost:32143'
const DATABASE_URL = 'postgresql://th_en_local@127.0.0.1:55473/app_cleanstart_dev'
const ALICE = 'alice@example.com'
const PASSWORD = process.env.E2E_PASSWORD || 'changeme'
let prisma: PrismaClient

test.setTimeout(120_000)
test.use({ actionTimeout: 15_000, navigationTimeout: 90_000 })
test.beforeAll(async () => {
  if (process.env.TEST_BASE_URL !== BASE_URL || process.env.DATABASE_URL !== DATABASE_URL) {
    throw new Error(`Language workflow tests require ${BASE_URL} and the isolated PostgreSQL fixture target`)
  }
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } })
})
test.afterEach(async () => {
  await prisma?.user.updateMany({ where: { email: ALICE, preferredLocale: 'th' }, data: { preferredLocale: 'en' } })
})
test.afterAll(async () => { await prisma?.$disconnect() })

async function signIn(page: Page, email: string, path: string) {
  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent(path)}`)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${BASE_URL}${path}`, { timeout: 25_000 })
}

async function chooseLanguage(page: Page, locale: 'en' | 'th') {
  await page.getByRole('button', { name: /^(Open user menu|เปิดเมนูผู้ใช้)$/ }).click()
  await page.getByRole('menuitemradio', { name: locale === 'th' ? 'ไทย' : 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', locale, { timeout: 20_000 })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

test('Thai refresh keeps the active Status filter and the requests URL', async ({ page }) => {
  const path = '/requests?view=approval-workflow'
  await signIn(page, ALICE, path)
  const filter = page.locator('[data-filter-tier="status"]')
  const statuses = filter.getByRole('checkbox')
  const englishStatuses = await statuses.evaluateAll((items) => items.map((item) => item.parentElement?.querySelector('label')?.textContent))
  const completed = filter.getByRole('checkbox', { name: 'Completed', exact: true })
  await completed.check()
  await chooseLanguage(page, 'th')
  await expect(page).toHaveURL(`${BASE_URL}${path}`)
  await expect(completed).toBeChecked()
  expect(await statuses.evaluateAll((items) => items.map((item) => item.parentElement?.querySelector('label')?.textContent))).toEqual(englishStatuses)
  await expect(page.getByRole('button', { name: 'สร้าง Request', exact: true })).toBeVisible()
})

test('an open request draft survives server-rendered locale prop reconciliation', async ({ page }) => {
  await page.goto('/test-harness/language-workflow')
  await page.getByRole('button', { name: 'Open fixture draft' }).click()
  const dialog = page.getByRole('dialog')
  const title = dialog.locator('#title')
  await title.fill('Draft retains เส้นทาง A')
  await page.locator('#reconcile-workflow-locale').evaluate((button: HTMLButtonElement) => button.click())
  await expect(page).toHaveURL(`${BASE_URL}/test-harness/language-workflow?locale=th`)
  await expect(dialog.getByRole('button', { name: 'ส่ง Request', exact: true })).toBeVisible()
  await expect(title).toHaveValue('Draft retains เส้นทาง A')
})

const BOB = 'bob@example.com'
const CASEY = 'casey@example.com'
const WORKFLOW_ACCOUNTS = [
  ALICE, BOB, CASEY, 'quinn@example.com', 'riley@example.com', 'dana@example.com', 'pat@example.com', 'morgan@example.com',
]

test('seeded Request, Solution and Final include rejection, rework and stable workflow labels', async ({ browser }) => {
  test.setTimeout(360_000)
  const title = `Language workflow ชื่อเดิม ${Date.now()}`
  const pendingTitle = `${title} / Pending`
  const rejection = 'Please revise — เหตุผลเดิม'
  const comment = 'Approved as revised — ข้อคิดเห็นเดิม'
  const contexts = new Map<string, Awaited<ReturnType<typeof browser.newContext>>>()
  const getPage = async (email: string) => {
    const existing = contexts.get(email)
    if (existing) return existing.pages()[0]
    const context = await browser.newContext({ baseURL: BASE_URL })
    contexts.set(email, context)
    const page = await context.newPage()
    await signIn(page, email, '/requests')
    await chooseLanguage(page, 'th')
    return page
  }
  const open = async (page: Page, id: string, path = '/requests', isDraft = false) => {
    const url = `${path}?requestId=${id}`
    await page.goto(url)
    await expect(page).toHaveURL(`${BASE_URL}${url}`)
    const dialog = page.getByRole('dialog')
    if (isDraft) await expect(dialog.locator('#title')).toHaveValue(title, { timeout: 25_000 })
    else await expect(dialog.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 25_000 })
    return dialog
  }
  const create = async (page: Page, name: string) => {
    await page.goto('/requests')
    await page.getByRole('button', { name: 'สร้าง Request', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#title').fill(name)
    await dialog.locator('[contenteditable="true"]').first().fill('Keep this description — รายละเอียดเดิม')
    await dialog.getByRole('button', { name: 'ส่ง Request', exact: true }).click()
    await expect(page.getByText('สร้าง Request แล้ว', { exact: true })).toBeVisible({ timeout: 25_000 })
    return prisma.requests.findFirstOrThrow({ where: { title: name } })
  }
  const step = async (id: string, phase: 'REQUEST' | 'SOLUTION' | 'FINAL') => {
    const instance = await prisma.approval_instances.findFirstOrThrow({
      where: { ...(phase === 'SOLUTION' ? { solution: { requestId: id } } : { requestId: id }), phase, supersededAt: null },
      include: {
        candidateGroups: { include: { members: true } },
        requestApprovals: { where: { status: 'pending' }, orderBy: { order: 'asc' } },
        solutionApprovals: { where: { status: 'pending' }, orderBy: { order: 'asc' } },
      },
    })
    const approval = (phase === 'SOLUTION' ? instance.solutionApprovals : instance.requestApprovals)[0]
    if (!approval) return null
    const group = instance.candidateGroups.find((candidate) => candidate.id === approval.candidateGroupId)
    const userIds = approval.requiredApproverId ? [approval.requiredApproverId] : group?.members.map((member) => member.userId) ?? []
    const user = await prisma.user.findFirst({ where: { id: { in: userIds }, email: { in: WORKFLOW_ACCOUNTS } }, orderBy: { email: 'asc' } })
    if (!user) throw new Error(`No seeded candidate found for ${phase} step ${approval.order} (${instance.routingMode}, ${userIds.length} candidates)`)
    return user.email
  }
  const finish = async (id: string, phase: 'REQUEST' | 'SOLUTION' | 'FINAL') => {
    for (let approvals = 0; approvals < 5; approvals++) {
      const email = await step(id, phase)
      if (!email) return
      const page = await getPage(email)
      const dialog = await open(page, id, '/requests/my-actions')
      await dialog.getByRole('button', { name: phase === 'SOLUTION' ? 'อนุมัติ Solution' : 'อนุมัติ', exact: true }).click()
      if (phase !== 'SOLUTION') {
        const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'ยืนยันการอนุมัติ', exact: true }) })
        await confirmation.locator('textarea').fill(comment)
        await confirmation.getByRole('button', { name: 'ยืนยันการอนุมัติ', exact: true }).click()
      }
      await expect(page.getByText('อนุมัติแล้ว', { exact: true })).toBeVisible({ timeout: 25_000 })
    }
    throw new Error(`Seeded ${phase} attempt did not finish within its configured steps`)
  }

  const unit = await prisma.organization_units.findFirstOrThrow({ where: { assignments: { some: { user: { email: BOB }, isActive: true } } } })
  expect(await prisma.email_settings.count()).toBe(0)
  await prisma.email_settings.create({ data: { id: 'default', enabled: false, host: 'localhost', fromAddress: 'fixture@example.com' } })
  try {
    await prisma.organization_units.update({ where: { id: unit.id }, data: { canWorkOnSolutions: true } })
    const alice = await getPage(ALICE)
    const record = await create(alice, title)
    const casey = await getPage(CASEY)
    await open(casey, record.id, '/requests/my-actions')
    await casey.getByRole('button', { name: 'ไม่อนุมัติ', exact: true }).click()
    await casey.getByPlaceholder('ระบุเหตุผลที่ไม่อนุมัติ...').fill(rejection)
    await casey.getByRole('button', { name: 'ยืนยันการไม่อนุมัติ', exact: true }).click()
    await expect(casey.getByText('บันทึกการไม่อนุมัติแล้ว', { exact: true })).toBeVisible({ timeout: 25_000 })
    const revision = await open(alice, record.id, '/requests', true)
    await expect(revision.getByText(rejection)).toHaveText(`“${rejection}”`)
    await revision.locator('[contenteditable="true"]').first().fill('Revised description — รายละเอียดเดิม')
    await revision.getByRole('button', { name: 'ส่ง Request ใหม่', exact: true }).click()
    await expect(alice.getByText('ส่ง Request ใหม่แล้ว', { exact: true })).toBeVisible({ timeout: 25_000 })
    await finish(record.id, 'REQUEST')
    await expect.poll(async () => (await prisma.requests.findUniqueOrThrow({ where: { id: record.id } })).status).toBe('SentToEngineer')

    const bob = await getPage(BOB)
    await bob.goto('/engineering', { waitUntil: 'domcontentloaded' })
    await expect(bob.getByRole('heading', { name: 'ภาพรวมงานวิศวกรรม' })).toBeVisible({ timeout: 60_000 })
    const engineeringQueue = bob.getByRole('heading', { name: 'Sent to Engineer', exact: true })
    await expect(async () => {
      if (!(await engineeringQueue.isVisible())) await bob.getByRole('button', { name: 'งานติดตาม', exact: true }).click()
      await expect(engineeringQueue).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 60_000 })
    await bob.getByText(title, { exact: true }).click()
    const solution = bob.getByRole('dialog')
    await solution.getByRole('button', { name: 'ส่ง Solution', exact: true }).click()
    const form = bob.getByRole('dialog').filter({ has: bob.locator('#solutionTitle') })
    await form.locator('#solutionTitle').fill('Untranslated engineering plan')
    await form.locator('[contenteditable="true"]').first().fill('Engineering description เส้นทาง A')
    await form.locator('#cost').fill('250')
    await form.locator('#timeline').fill('2 weeks')
    await form.getByRole('button', { name: 'ส่ง Solution', exact: true }).click()
    await expect.poll(() => prisma.solutions.count({ where: { requestId: record.id } }), { timeout: 25_000 }).toBe(1)
    await finish(record.id, 'SOLUTION')

    const final = await open(alice, record.id)
    await final.getByRole('button', { name: 'ส่งให้อนุมัติรอบ Final', exact: true }).click()
    await alice.getByRole('dialog').filter({ has: alice.getByRole('heading', { name: 'เริ่มอนุมัติรอบ Final' }) }).getByRole('button', { name: 'ส่งให้อนุมัติรอบ Final', exact: true }).click()
    await expect(alice.getByText('ส่งให้อนุมัติรอบ Final แล้ว', { exact: true })).toBeVisible({ timeout: 25_000 })
    await finish(record.id, 'FINAL')
    expect((await prisma.requests.findUniqueOrThrow({ where: { id: record.id } })).status).toBe('Completed')
    const pending = await create(alice, pendingTitle)

    const sample = async (page: Page) => {
      await page.goto('/requests')
      const labels: Array<string | null> = []
      for (const [name, status] of [[title, 'Completed'], [pendingTitle, 'Improvement Request']]) {
        const row = page.getByRole('row').filter({ hasText: name }).filter({ has: page.getByText(status, { exact: true }) })
        const card = page.getByRole('button').filter({ has: page.getByRole('heading', { name, exact: true }) })
        const item = row.or(card)
        await expect(item.getByText(name, { exact: true })).toBeVisible()
        labels.push(await item.getByText(status, { exact: true }).textContent())
        labels.push(await page.locator('[data-filter-tier="status"]').getByText(status, { exact: true }).textContent())
      }
      for (const [item, name, status] of [[record, title, 'Approved'], [pending, pendingTitle, 'Pending']] as const) {
        await page.goto(`/requests?requestId=${item.id}`)
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByText(name, { exact: true })).toBeVisible()
        const badges = dialog.getByText(status, { exact: true })
        await expect(badges.first()).toBeVisible()
        labels.push(...await badges.allTextContents())
        if (item.id === record.id) await expect(dialog.getByText(`“${comment}”`, { exact: true }).first()).toBeVisible()
      }
      return labels
    }
    await alice.goto('/requests')
    await chooseLanguage(alice, 'en')
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, baseURL: BASE_URL, storageState: await alice.context().storageState() })
    try {
      const phone = await mobile.newPage()
      const englishDesktop = await sample(alice)
      const englishMobile = await sample(phone)
      await alice.goto('/requests')
      await chooseLanguage(alice, 'th')
      expect(await sample(alice)).toEqual(englishDesktop)
      expect(await sample(phone)).toEqual(englishMobile)
    } finally {
      await mobile.close()
    }
  } finally {
    await prisma.user.updateMany({ where: { email: { in: WORKFLOW_ACCOUNTS }, preferredLocale: 'th' }, data: { preferredLocale: 'en' } })
    await prisma.organization_units.update({ where: { id: unit.id }, data: { canWorkOnSolutions: unit.canWorkOnSolutions } })
    await prisma.email_settings.delete({ where: { id: 'default' } })
    await prisma.requests.deleteMany({ where: { title: { in: [title, pendingTitle] } } })
    await Promise.allSettled([...contexts.values()].map((context) => context.close()))
  }
})
