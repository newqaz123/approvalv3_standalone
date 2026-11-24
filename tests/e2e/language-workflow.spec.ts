import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { createTranslator } from '../../src/lib/i18n/messages'
import { readWorkflowMail } from '../support/i18n/workflow-mail'
import { startMailCapture } from '../support/native/mail-capture'
import { productionSurface } from '../support/i18n/production-surfaces'

const requestList = productionSurface('/requests')
const actionItems = productionSurface('/requests/my-actions')
const engineering = productionSurface('/engineering')

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
  await page.goto(`${productionSurface('/sign-in/[[...sign-in]]').path}?callbackUrl=${encodeURIComponent(path)}`)
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
  const path = `${requestList.path}?view=approval-workflow`
  await signIn(page, ALICE, path)
  await expect(page.getByRole('heading', { name: requestList.heading.en, exact: true })).toBeVisible()
  const filter = page.locator('[data-filter-tier="status"]')
  const statuses = filter.getByRole('checkbox')
  const englishStatuses = await statuses.evaluateAll((items) => items.map((item) => item.parentElement?.querySelector('label')?.textContent))
  const completed = filter.getByRole('checkbox', { name: 'Completed', exact: true })
  await completed.check()
  await chooseLanguage(page, 'th')
  await expect(page).toHaveURL(`${BASE_URL}${path}`)
  await expect(page.getByRole('heading', { name: requestList.heading.th, exact: true })).toBeVisible()
  await expect(completed).toBeChecked()
  expect(await statuses.evaluateAll((items) => items.map((item) => item.parentElement?.querySelector('label')?.textContent))).toEqual(englishStatuses)
  await expect(page.getByRole('button', { name: 'สร้าง Request', exact: true })).toBeVisible()
})

for (const [surface, email] of [[actionItems, 'casey@example.com'], [engineering, 'bob@example.com']] as const) {
  test(`${surface.pattern} renders both languages for its ${surface.role}`, async ({ page }) => {
    const unit = surface.role === 'engineer' ? await prisma.organization_units.findFirstOrThrow({
      where: { assignments: { some: { user: { email }, isActive: true } } },
    }) : undefined
    try {
      if (unit) await prisma.organization_units.update({ where: { id: unit.id }, data: { canWorkOnSolutions: true } })
      await signIn(page, email, surface.path)
      await expect(page.getByRole('heading', { name: surface.heading.en, exact: true })).toBeVisible()
      await chooseLanguage(page, 'th')
      await expect(page.getByRole('heading', { name: surface.heading.th, exact: true })).toBeVisible()
      await expect(page).toHaveURL(`${BASE_URL}${surface.path}`)
    } finally {
      await prisma.user.update({ where: { email }, data: { preferredLocale: 'en' } })
      if (unit) await prisma.organization_units.update({ where: { id: unit.id }, data: { canWorkOnSolutions: unit.canWorkOnSolutions } })
    }
  })
}

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
const WORKFLOW_MAIL_RECIPIENTS = [...WORKFLOW_ACCOUNTS, 'admin@example.com']

test('seeded Request, Solution and Final preserve workflow labels and outbound email across locales', async ({ browser }) => {
  test.setTimeout(480_000)
  const title = `Language workflow ชื่อเดิม ${Date.now()}`
  const pendingTitle = `${title} / Pending`
  const rejection = 'Please revise — เหตุผลเดิม'
  const comment = 'Approved as revised — ข้อคิดเห็นเดิม'
  const unit = await prisma.organization_units.findFirstOrThrow({ where: { assignments: { some: { user: { email: BOB }, isActive: true } } } })
  expect(process.env.SMTP_HOST ?? '').toBe('')
  expect(await prisma.email_settings.count()).toBe(0)
  expect(await prisma.requests.count({ where: { title: { in: [title, pendingTitle] } } })).toBe(0)
  const host = '127.0.0.1'
  const port = 35247
  const fromAddress = 'i18n-fixture@example.invalid'
  // The isolated Next server uses the sender's default public origin unless
  // the launcher also exports NEXT_PUBLIC_APP_URL for the Playwright worker.
  const mailBase = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  const capture = await startMailCapture({ host, port })
  let configured = false
  try {
    await prisma.email_settings.create({ data: { id: 'default', enabled: true, host, port, fromAddress } })
    configured = true
    await prisma.organization_units.update({ where: { id: unit.id }, data: { canWorkOnSolutions: true } })
    const en = await run('en')
    const th = await run('th')
    expect(th, 'wire mail from the same workflow in Thai and English').toEqual(en)
  } finally {
    if (configured) await prisma.email_settings.delete({ where: { id: 'default', host, port, fromAddress } })
    await prisma.organization_units.update({ where: { id: unit.id }, data: { canWorkOnSolutions: unit.canWorkOnSolutions } })
    await capture.close()
  }

  async function run(locale: 'en' | 'th') {
    const t = createTranslator(locale)
    const captureStart = capture.messages().length
    const contexts = new Map<string, Awaited<ReturnType<typeof browser.newContext>>>()
    const getPage = async (email: string) => {
      const existing = contexts.get(email)
      if (existing) return existing.pages()[0]
      const context = await browser.newContext({ baseURL: BASE_URL })
      contexts.set(email, context)
      const page = await context.newPage()
      await signIn(page, email, requestList.path)
      await expect(page.locator('html')).toHaveAttribute('lang', locale)
      return page
    }
    const open = async (page: Page, id: string, path: string = requestList.path, isDraft = false) => {
      const url = `${path}?requestId=${id}`
      await page.goto(url)
      await expect(page).toHaveURL(`${BASE_URL}${url}`)
      const dialog = page.getByRole('dialog')
      if (isDraft) await expect(dialog.locator('#title')).toHaveValue(title, { timeout: 25_000 })
      else await expect(dialog.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 25_000 })
      return dialog
    }
    const create = async (page: Page, name: string) => {
      await page.goto(requestList.path)
      await page.getByRole('button', { name: t('requests.newRequest'), exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('#title').fill(name)
      await dialog.locator('[contenteditable="true"]').first().fill('Keep this description — รายละเอียดเดิม')
      await dialog.getByRole('button', { name: t('requests.submitRequest'), exact: true }).click()
      await expect(page.getByText(t('requests.requestCreated'), { exact: true })).toBeVisible({ timeout: 25_000 })
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
        const dialog = await open(page, id, actionItems.path)
        await dialog.getByRole('button', { name: phase === 'SOLUTION' ? t('requests.approveSolutionHeading') : t('requests.approve'), exact: true }).click()
        if (phase !== 'SOLUTION') {
          const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: t('requests.confirmApproval'), exact: true }) })
          await confirmation.locator('textarea').fill(comment)
          await confirmation.getByRole('button', { name: t('requests.confirmApproval'), exact: true }).click()
        }
        await expect(page.getByText(t('requests.approved'), { exact: true })).toBeVisible({ timeout: 25_000 })
      }
      throw new Error(`Seeded ${phase} attempt did not finish within its configured steps`)
    }

    try {
      // Alternate approval candidates receive mail before they ever open the app.
      await prisma.user.updateMany({ where: { email: { in: WORKFLOW_MAIL_RECIPIENTS } }, data: { preferredLocale: locale } })
      const alice = await getPage(ALICE)
      const record = await create(alice, title)
      const casey = await getPage(CASEY)
      await open(casey, record.id, actionItems.path)
      await casey.getByRole('button', { name: t('requests.reject'), exact: true }).click()
      await casey.getByPlaceholder(t('requests.rejectionHint')).fill(rejection)
      await casey.getByRole('button', { name: t('requests.confirmRejection'), exact: true }).click()
      await expect(casey.getByText(t('requests.rejected'), { exact: true })).toBeVisible({ timeout: 25_000 })
      const revision = await open(alice, record.id, requestList.path, true)
      await expect(revision.getByText(rejection)).toHaveText(`“${rejection}”`)
      await revision.locator('[contenteditable="true"]').first().fill('Revised description — รายละเอียดเดิม')
      await revision.getByRole('button', { name: t('requests.resubmitRequest'), exact: true }).click()
      await expect(alice.getByText(t('requests.requestResubmitted'), { exact: true })).toBeVisible({ timeout: 25_000 })
      await finish(record.id, 'REQUEST')
      await expect.poll(async () => (await prisma.requests.findUniqueOrThrow({ where: { id: record.id } })).status).toBe('SentToEngineer')

      const bob = await getPage(BOB)
      await bob.goto(engineering.path, { waitUntil: 'domcontentloaded' })
      await expect(bob.getByRole('heading', { name: engineering.heading[locale] })).toBeVisible({ timeout: 60_000 })
      const engineeringQueue = bob.getByRole('heading', { name: 'Sent to Engineer', exact: true })
      await expect(async () => {
        if (!(await engineeringQueue.isVisible())) await bob.getByRole('button', { name: t('requests.followUpWork'), exact: true }).click()
        await expect(engineeringQueue).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 60_000 })
      const engineeringRow = bob.getByTestId('engineering-request-row').filter({ hasText: title })
      await engineeringRow.getByRole('button', { name: t('requests.assignPic'), exact: true }).click()
      await bob.getByRole('option').filter({ hasText: BOB }).click()
      await bob.getByRole('button', { name: t('requests.save'), exact: true }).click()
      await expect(bob.getByText(t('requests.picsAssigned', { count: 1 }), { exact: true })).toBeVisible()

      const solution = bob.getByRole('dialog')
      const submitSolution = solution.getByRole('button', { name: t('requests.submitSolution'), exact: true })
      await expect(async () => {
        if (!(await solution.isVisible())) await bob.getByText(title, { exact: true }).click()
        await expect(submitSolution).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 45_000 })
      await submitSolution.click()
      const form = bob.getByRole('dialog').filter({ has: bob.locator('#solutionTitle') })
      await form.locator('#solutionTitle').fill('Untranslated engineering plan')
      await form.locator('[contenteditable="true"]').first().fill('Engineering description เส้นทาง A')
      await form.locator('#cost').fill('250')
      await form.locator('#timeline').fill('2 weeks')
      await form.getByRole('button', { name: t('requests.submitSolution'), exact: true }).click()
      await expect.poll(() => prisma.solutions.count({ where: { requestId: record.id } }), { timeout: 25_000 }).toBe(1)
      await finish(record.id, 'SOLUTION')

      const final = await open(alice, record.id)
      await final.getByRole('button', { name: t('requests.submitFinalShort'), exact: true }).click()
      await alice.getByRole('dialog').filter({ has: alice.getByRole('heading', { name: t('requests.initiateFinal') }) }).getByRole('button', { name: t('requests.startFinal'), exact: true }).click()
      await expect(alice.getByText(t('requests.finalStarted'), { exact: true })).toBeVisible({ timeout: 25_000 })
      await finish(record.id, 'FINAL')
      expect((await prisma.requests.findUniqueOrThrow({ where: { id: record.id } })).status).toBe('Completed')
      const entries = await prisma.notifications.findMany({ where: { requestId: record.id }, select: { type: true } })
      expect(entries.map(entry => entry.type)).toEqual(expect.arrayContaining([
        'approval_needed', 'approval_rejected', 'request_assigned', 'solution_ready', 'final_approval_needed', 'approval_granted',
      ]))
      // Request status-change rows are written directly for the in-app bell.
      const mailEntries = entries.filter(entry => entry.type !== 'status_changed')
      await expect.poll(() => capture.messages().length - captureStart).toBe(mailEntries.length)
      const mail = capture.messages().slice(captureStart).map(message => {
        expect(message.from).toBe(fromAddress)
        expect(WORKFLOW_MAIL_RECIPIENTS).toEqual(expect.arrayContaining(message.to))
        return readWorkflowMail(message, record, mailBase)
      }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      expect(mail.map(item => item.subject)).toEqual(expect.arrayContaining([
        expect.stringMatching(/^Approval Needed:/), expect.stringMatching(/^Rejected:/), 'PIC Assignment',
        expect.stringMatching(/^Solution Ready:/), expect.stringMatching(/^Final Approval Needed:/), 'Request Completed',
      ]))
      if (locale === 'th') {
        await prisma.email_settings.update({ where: { id: 'default' }, data: { enabled: false } })
        const pending = await create(alice, pendingTitle)

        const sample = async (page: Page, locale: 'en' | 'th', mobile = false) => {
          await page.goto(requestList.path)
          await expect(page.locator('html')).toHaveAttribute('lang', locale)
          const labels: Array<string | null> = []
          for (const [name, status] of [[title, 'Completed'], [pendingTitle, 'Improvement Request']]) {
            const row = page.getByRole('row').filter({ hasText: name }).filter({ has: page.getByText(status, { exact: true }) })
            const card = page.getByRole('button').filter({ has: page.getByRole('heading', { name, exact: true }) })
            const item = mobile ? card : row
            await expect(item.getByText(name, { exact: true })).toBeVisible()
            labels.push(await item.getByText(status, { exact: true }).textContent())
            labels.push(await page.locator('[data-filter-tier="status"]').getByText(status, { exact: true }).textContent())
          }
          for (const [item, name, status] of [[record, title, 'Approved'], [pending, pendingTitle, 'Pending']] as const) {
            await page.goto(`${requestList.path}?requestId=${item.id}`)
            const dialog = page.getByRole('dialog')
            await expect(dialog.getByText(name, { exact: true })).toBeVisible({ timeout: 25_000 })
            const badges = dialog.getByText(status, { exact: true })
            await expect(badges.first()).toBeVisible()
            labels.push(...await badges.allTextContents())
            if (item.id === record.id) await expect(dialog.getByText(`“${comment}”`, { exact: true }).first()).toBeVisible()
          }
          return labels
        }
        await alice.goto(requestList.path)
        await chooseLanguage(alice, 'en')
        const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, baseURL: BASE_URL, storageState: await alice.context().storageState() })
        try {
          const phone = await mobile.newPage()
          const englishDesktop = await sample(alice, 'en')
          const englishMobile = await sample(phone, 'en', true)
          await alice.goto(requestList.path)
          await chooseLanguage(alice, 'th')
          expect(await sample(alice, 'th')).toEqual(englishDesktop)
          expect(await sample(phone, 'th', true)).toEqual(englishMobile)
        } finally {
          await mobile.close()
        }
      }
      return mail
    } finally {
      await prisma.user.updateMany({ where: { email: { in: WORKFLOW_MAIL_RECIPIENTS }, preferredLocale: 'th' }, data: { preferredLocale: 'en' } })
      await prisma.requests.deleteMany({ where: { title: { in: [title, pendingTitle] } } })
      await Promise.allSettled([...contexts.values()].map(context => context.close()))
    }
  }
})

async function openThaiImageDraft(page: Page) {
  const imageId = '123e4567-e89b-42d3-a456-426614174001'
  const src = `/api/inline-images/${imageId}`
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVR4nGO4FGBDEmIY1RAwGkqXhmvSAACoeF4Qrn9alwAAAABJRU5ErkJggg==', 'base64')
  const rawError = 'Fixture: internal image deletion failure'
  await page.route('**/api/inline-images', (route) => route.fulfill({ json: {
    id: imageId, src, alt: 'Workflow image', fileType: 'image/png', fileSize: png.length, width: 16, height: 16,
  } }))
  await page.route(`**${src}`, (route) => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 500, json: { error: rawError } })
    : route.fulfill({ contentType: 'image/png', body: png }))

  await page.goto('/test-harness/language-workflow?locale=th')
  await page.getByRole('button', { name: 'Open fixture draft' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file][accept^="image/"]').setInputFiles({ name: 'workflow.png', mimeType: 'image/png', buffer: png })
  const image = dialog.getByAltText('Workflow image', { exact: true })
  await expect(image).toBeVisible()
  await image.click()
  return { dialog, image, src, rawError }
}

test('Thai crop announces open, adjustment and reset', async ({ page }) => {
  const { dialog } = await openThaiImageDraft(page)
  await dialog.getByRole('button', { name: 'ครอบตัดรูปภาพ', exact: true }).click()
  const status = dialog.locator('.inline-image-crop-status')
  await expect(status).toHaveText('เปิดตัวแก้ไขการครอบตัดแล้ว')
  await dialog.getByRole('button', { name: 'เลื่อนขอบครอบตัดด้านขวา' }).press('ArrowLeft')
  await expect(status).toHaveText(/ครอบตัดกว้าง \d+% สูง \d+%/)
  await dialog.getByRole('button', { name: 'คืนค่าการครอบตัด' }).click()
  await expect(status).toHaveText('คืนค่าการครอบตัดเป็นรูปเดิมทั้งรูปแล้ว')
  await dialog.getByRole('button', { name: 'ยกเลิกครอบตัด' }).click()

})

test('Thai removal failures are visible after uploading an image', async ({ page }) => {
  const { dialog, image, src, rawError } = await openThaiImageDraft(page)
  const failedDelete = page.waitForResponse((response) => response.url().endsWith(src) && response.request().method() === 'DELETE')
  await dialog.getByRole('button', { name: 'นำรูปภาพออก', exact: true }).click()
  expect((await failedDelete).status()).toBe(500)
  await expect(dialog.getByRole('alert')).toHaveText('นำรูปภาพออกไม่ได้ ลองอีกครั้ง')
  await expect(dialog.getByText(rawError)).toHaveCount(0)
  await expect(image).toBeVisible()

  // Removing the selected image from TipTap also fails, restores the node and reports the same copy.
  const failedTransaction = page.waitForResponse((response) => response.url().endsWith(src) && response.request().method() === 'DELETE')
  await image.click()
  await page.keyboard.press('Backspace')
  expect((await failedTransaction).status()).toBe(500)
  await expect(dialog.getByRole('alert')).toHaveText('นำรูปภาพออกไม่ได้ ลองอีกครั้ง')
  await expect(dialog.getByText(rawError)).toHaveCount(0)
  await expect(image).toBeVisible()
})

type EnglishApprovalFixture = {
  createRequest: (email?: string, suffix?: string) => Promise<{ id: string; title: string }>
  signInAs: (email: string, path?: string) => Promise<Page>
}

const englishApprovalTest = test.extend<{ approval: EnglishApprovalFixture }>({
  approval: async ({ browser }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = []
    const title = `English approval control ${crypto.randomUUID()}`
    const signInAs = async (email: string, path: string = requestList.path) => {
      const context = await browser.newContext({ baseURL: BASE_URL })
      contexts.push(context)
      const page = await context.newPage()
      await signIn(page, email, path)
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      return page
    }
    const createRequest = async (email = ALICE, suffix = '') => {
      const page = await signInAs(email)
      const submittedTitle = `${title}${suffix}`
      await page.getByRole('button', { name: 'New Request', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('#title').fill(submittedTitle)
      await dialog.locator('[contenteditable="true"]').first().fill('English control for seeded approval routing')
      await dialog.getByRole('button', { name: 'Submit Request', exact: true }).click()
      await expect(page.getByText('Request created successfully', { exact: true })).toBeVisible({ timeout: 25_000 })
      return prisma.requests.findFirstOrThrow({ where: { title: submittedTitle }, select: { id: true, title: true } })
    }
    expect(await prisma.email_settings.count()).toBe(0)
    await prisma.email_settings.create({ data: { id: 'default', enabled: false, host: 'localhost', fromAddress: 'fixture@example.com' } })
    try {
      await use({ createRequest, signInAs })
    } finally {
      try {
        await prisma.requests.deleteMany({ where: { title: { startsWith: title } } })
      } finally {
        await prisma.email_settings.delete({ where: { id: 'default' } })
        await Promise.allSettled(contexts.map((context) => context.close()))
      }
    }
  },
})

function englishActionRow(page: Page, title: string) {
  return page.getByRole('row', { name: `Open request ${title}`, exact: true })
}

async function openEnglishReview(approval: EnglishApprovalFixture, email: string, title: string, path: string = actionItems.path) {
  const page = await approval.signInAs(email, path)
  await englishActionRow(page, title).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 25_000 })
  return { page, dialog }
}

englishApprovalTest('English control: own-team leads can approve, reports-to and ancestor cannot', async ({ approval }) => {
  const { title } = await approval.createRequest()
  for (const email of [CASEY, 'quinn@example.com']) {
    const { page, dialog } = await openEnglishReview(approval, email, title)
    if (email === CASEY) {
      await expect.poll(async () => {
        const response = await page.request.get('/api/actions/pending-count')
        expect(response.ok()).toBe(true)
        const { count } = await response.json() as { count: number }
        return count
      }).toBeGreaterThan(0)
    }
    await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
  }
  for (const email of ['riley@example.com', 'pat@example.com']) {
    const page = await approval.signInAs(email, actionItems.path)
    await expect(page.getByRole('heading', { name: actionItems.heading.en, exact: true })).toBeVisible()
    await expect(englishActionRow(page, title)).toHaveCount(0)
    await page.goto(requestList.path)
    await englishActionRow(page, title).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 25_000 })
    await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0)
  }
})

englishApprovalTest('English control: competing candidates cannot settle the same step twice', async ({ approval }) => {
  const { id, title } = await approval.createRequest()
  const casey = await openEnglishReview(approval, CASEY, title)
  const quinn = await openEnglishReview(approval, 'quinn@example.com', title)
  for (const { dialog } of [casey, quinn]) {
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Confirm Approval', exact: true })).toBeVisible()
  }
  await casey.dialog.getByRole('button', { name: 'Confirm Approval', exact: true }).click()
  await expect(casey.page.getByText('Approved successfully', { exact: true })).toBeVisible({ timeout: 25_000 })
  await quinn.dialog.getByRole('button', { name: 'Confirm Approval', exact: true }).click()
  await expect(quinn.page.getByText('An error occurred while approving', { exact: true })).toBeVisible({ timeout: 25_000 })
  const request = await prisma.requests.findUniqueOrThrow({ where: { id }, include: { approvals: true, activities: true } })
  expect(request.status).toBe('ImprovementRequest')
  expect(request.approvals.filter((row) => row.status === 'approved').map(({ order }) => order)).toEqual([1])
  expect(request.activities.filter(({ action }) => action === 'approved')).toHaveLength(1)
})

englishApprovalTest('English control: rejection returns the request to its author for revision', async ({ approval }) => {
  const { title } = await approval.createRequest()
  const { page, dialog } = await openEnglishReview(approval, CASEY, title)
  const reason = 'Please revise the engineering justification'
  await dialog.getByRole('button', { name: 'Reject', exact: true }).click()
  await dialog.getByPlaceholder('Please explain the reason for rejection...').fill(reason)
  await dialog.getByRole('button', { name: 'Confirm Rejection', exact: true }).click()
  await expect(page.getByText('Rejected successfully', { exact: true })).toBeVisible({ timeout: 25_000 })
  const requester = await approval.signInAs(ALICE)
  await englishActionRow(requester, title).click()
  const revision = requester.getByRole('dialog')
  await expect(revision.getByRole('heading', { name: 'Resubmit Request', exact: true })).toBeVisible({ timeout: 25_000 })
  await expect(revision.locator('#title')).toHaveValue(title)
  await expect(revision.getByText(`“${reason}”`, { exact: true })).toBeVisible()
})

englishApprovalTest('English control: admin restarts a stranded attempt with a reason and preserves decisions', async ({ approval }) => {
  englishApprovalTest.setTimeout(240_000)
  const { id, title } = await approval.createRequest()
  const { page, dialog } = await openEnglishReview(approval, CASEY, title)
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click()
  await dialog.locator('textarea').fill('First decision remains in history')
  await dialog.getByRole('button', { name: 'Confirm Approval', exact: true }).click()
  await expect(page.getByText('Approved successfully', { exact: true })).toBeVisible({ timeout: 25_000 })
  const old = await prisma.approval_instances.findFirstOrThrow({
    where: { requestId: id, phase: 'REQUEST', supersededAt: null },
    include: { requestApprovals: { orderBy: { order: 'asc' } }, candidateGroups: { include: { members: true } } },
  })
  expect(old.requestApprovals.filter(({ status }) => status === 'approved')).toHaveLength(1)
  const memberIds = [...new Set(old.candidateGroups.flatMap(({ members }) => members.map(({ userId }) => userId)))]
  expect(memberIds.length).toBeGreaterThan(0)
  const activeMembers = await prisma.user.findMany({ where: { id: { in: memberIds }, isActive: true }, select: { id: true } })
  const activeMemberIds = activeMembers.map(({ id }) => id)
  try {
    await prisma.user.updateMany({ where: { id: { in: activeMemberIds } }, data: { isActive: false } })
    const admin = await approval.signInAs('admin@example.com', '/admin/organization?panel=chains')
    await admin.getByTestId(`chains-stranded-restart-${old.id}`).click()
    const restart = admin.getByTestId('restart-attempt-dialog')
    await expect(restart.getByTestId('restart-preview')).toBeVisible({ timeout: 30_000 })
    const confirm = restart.getByTestId('restart-confirm')
    await expect(confirm).toBeDisabled()
    const reason = 'Original candidate snapshot is stranded'
    await restart.getByTestId('restart-reason-input').fill(reason)
    await confirm.click()
    await expect(restart.getByText('Restarted. The old attempt is preserved as history.', { exact: true })).toBeVisible({ timeout: 30_000 })
    const oldAfter = await prisma.approval_instances.findUniqueOrThrow({
      where: { id: old.id }, include: { requestApprovals: { orderBy: { order: 'asc' } } },
    })
    expect(oldAfter.supersededAt).not.toBeNull()
    expect(oldAfter.requestApprovals).toEqual(old.requestApprovals)
    const next = await prisma.approval_instances.findFirstOrThrow({ where: { requestId: id, restartOfInstanceId: old.id } })
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' }, select: { id: true } })
    expect(next).toMatchObject({ restartReason: reason, restartedById: adminUser.id })
  } finally {
    await prisma.user.updateMany({ where: { id: { in: activeMemberIds } }, data: { isActive: true } })
  }
  await openEnglishReview(approval, ALICE, title, requestList.path)
})

englishApprovalTest('Thai attachment download uses HTTP status and hides response text', async ({ approval }) => {
  const { id, title } = await approval.createRequest()
  const { requesterId } = await prisma.requests.findUniqueOrThrow({ where: { id }, select: { requesterId: true } })
  const attachment = await prisma.file_attachments.create({ data: {
    requestId: id, uploadedById: requesterId, fileName: 'Workflow fixture.pdf', fileType: 'application/pdf', fileSize: 1, filePath: 'unserved-workflow-fixture.pdf',
  } })
  const page = await approval.signInAs(ALICE)
  await chooseLanguage(page, 'th')
  await page.goto(`${requestList.path}?requestId=${id}`)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 25_000 })
  let status = 404
  const rawError = 'Fixture: internal attachment download failure'
  await page.route(`**/api/files/download?id=${attachment.id}&disposition=attachment`, (route) =>
    route.fulfill({ status, json: { error: rawError } }))
  for (const [code, copy] of [
    [404, 'ไฟล์นี้ไม่พร้อมใช้งานแล้ว'],
    [403, 'คุณไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้'],
    [500, 'ดาวน์โหลดไฟล์ไม่ได้ ลองอีกครั้ง'],
  ] as const) {
    status = code
    await dialog.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).click()
    await expect(page.getByText(copy, { exact: true })).toBeVisible()
    await expect(page.getByText(rawError)).toHaveCount(0)
  }
})

englishApprovalTest('English control: cross-unit view-only sharing does not grant approval or send notification', async ({ approval }) => {
  const units = await Promise.all([ALICE, BOB].map(email => prisma.organization_units.findFirstOrThrow({
    where: { assignments: { some: { user: { email }, isActive: true } } },
    select: { id: true, shareRequests: true },
  })))
  expect(new Set(units.map(unit => unit.id)).size).toBe(2)
  // The current seed shares horizontally when ON; disabling it isolates sister units
  // while preserving the ancestor's view-only access from the original control.
  const unitIds = units.map(unit => unit.id)
  await prisma.organization_units.updateMany({ where: { id: { in: unitIds } }, data: { shareRequests: false } })
  try {
    const a = await approval.createRequest(ALICE, ' / Section A')
    const b = await approval.createRequest(BOB, ' / Section B')
    const pat = await approval.signInAs('pat@example.com')
    await expect(englishActionRow(pat, a.title)).toBeVisible()
    await expect(englishActionRow(pat, b.title)).toBeVisible()
    await englishActionRow(pat, a.title).click()
    const dialog = pat.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: a.title, exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^(Approve|Reject)$/ })).toHaveCount(0)
    await pat.keyboard.press('Escape')
    await pat.getByRole('button', { name: /^Notifications/ }).click()
    const notices = pat.locator('[data-radix-popper-content-wrapper]')
    await expect(notices.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
    await expect(notices.getByText(a.title, { exact: false })).toHaveCount(0)
    const { id: patId } = await prisma.user.findUniqueOrThrow({ where: { email: 'pat@example.com' } })
    expect(await prisma.notifications.count({ where: { userId: patId, requestId: a.id } })).toBe(0)

    for (const [email, visible, hidden] of [[ALICE, a, b], [BOB, b, a]] as const) {
      const page = await approval.signInAs(email)
      await expect(englishActionRow(page, visible.title)).toBeVisible()
      await expect(englishActionRow(page, hidden.title)).toHaveCount(0)
    }
  } finally {
    await prisma.$transaction(units.map(({ id, shareRequests }) => prisma.organization_units.update({ where: { id }, data: { shareRequests } })))
  }
})
