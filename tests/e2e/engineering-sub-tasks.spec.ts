import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { encode } from 'next-auth/jwt'

const TEST_USERS = {
  engineering: { email: 'eng1@example.com', password: 'changeme' },
}

const prisma = new PrismaClient()

test.afterAll(async () => {
  await prisma.$disconnect()
})

async function login(page: any, email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      departmentId: true,
      forcePasswordChange: true,
      isActive: true,
    },
  })

  expect(user, `Test user ${email} must exist`).toBeTruthy()
  expect(user?.isActive, `Test user ${email} must be active`).toBe(true)
  expect(user?.role, `Test user ${email} must be engineering`).toBe('engineering')
  expect(password, 'Engineering test password must be configured').toBeTruthy()

  const maxAgeSeconds = 7 * 24 * 60 * 60
  const expires = Math.floor(Date.now() / 1000) + maxAgeSeconds
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'dev-secret-change-in-production-abc123'
  const cookieName = 'authjs.session-token'
  const sessionToken = await encode({
    secret,
    salt: cookieName,
    token: {
      name: user!.name,
      email: user!.email,
      sub: user!.id,
      id: user!.id,
      role: user!.role,
      departmentId: user!.departmentId,
      forcePasswordChange: user!.forcePasswordChange,
      iat: Math.floor(Date.now() / 1000),
      exp: expires,
      jti: randomUUID(),
    },
    maxAge: maxAgeSeconds,
  })

  await page.context().addCookies([{
    name: cookieName,
    value: sessionToken,
    url: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3001',
    httpOnly: true,
    sameSite: 'Lax',
    expires,
  }])

  await page.goto('/engineering')
  await page.waitForURL(/\/engineering/, { timeout: 10000 })
}

test.describe('engineering sub-tasks', () => {
  test('engineer manages request sub-tasks and WR from a collapsed panel', async ({ page }) => {
    test.setTimeout(90_000)

    await login(page, TEST_USERS.engineering.email, TEST_USERS.engineering.password)

    await page.goto('/engineering')
    await page.waitForLoadState('networkidle')

    const openAllEngineeringRequests = async () => {
      await page.waitForLoadState('networkidle').catch(() => undefined)
      const allRequestsHeading = page.getByRole('heading', { name: 'All Engineering Requests' })
      if (await allRequestsHeading.isVisible().catch(() => false)) return

      await page.getByRole('button', { name: 'All Engineering Requests' }).click()
      await expect(allRequestsHeading).toBeVisible({ timeout: 10000 })
    }

    await openAllEngineeringRequests()

    const visibleRows = [
      page.locator('[data-testid="engineering-request-row"][data-request-status="SentToEngineer"]').first(),
      page.locator('[data-testid="engineering-request-row"][data-request-status="SendBackToRequester"]').first(),
      page.locator('[data-testid="engineering-request-row"][data-request-status="FinalApproval"]').first(),
      page.locator('[data-testid="engineering-request-row"][data-request-status="Completed"]').first(),
    ]

    let selectedRow = visibleRows[0]
    let foundRow = false
    for (const row of visibleRows) {
      if (await row.isVisible().catch(() => false)) {
        selectedRow = row
        foundRow = true
        break
      }
    }

    test.skip(!foundRow, 'No engineering request with visible sub-task stage found in seeded data')

    const selectedRequestId = await selectedRow.getAttribute('data-request-id')
    expect(selectedRequestId).toBeTruthy()
    const selectedRequestRow = () => page.locator(`[data-testid="engineering-request-row"][data-request-id="${selectedRequestId}"]`)
    const waitForActionReload = async () => {
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 })
      await expect(page.getByRole('heading', { name: 'Engineering Dashboard' })).toBeVisible({ timeout: 15000 })
      await page.waitForLoadState('networkidle').catch(() => undefined)
    }
    const openSelectedRequest = async () => {
      if (await page.getByRole('dialog').isVisible().catch(() => false)) return

      await openAllEngineeringRequests()
      await selectedRequestRow().click()
      await expect(page.getByRole('dialog')).toBeVisible()
    }

    await selectedRow.click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const subTasksTrigger = page.getByRole('button', { name: /Sub-tasks/ })
    await expect(subTasksTrigger).toBeVisible()
    await expect(page.getByText('Work requisition received')).toBeHidden()

    await subTasksTrigger.click()
    await expect(page.getByText('Work requisition received')).toBeVisible()

    const subTaskDescription = `Piping work ${Date.now()}`
    const createdTaskCard = () => page.locator('[data-testid="sub-task-card"]').filter({ hasText: subTaskDescription })
    let originalWrChecked: boolean | null = null
    let createdSubTask = false

    const ensureSubTasksExpanded = async () => {
      if (await page.getByText('Work requisition received').isHidden().catch(() => false)) {
        await page.getByRole('button', { name: /Sub-tasks/ }).click()
      }
    }

    const cleanup = async () => {
      await openSelectedRequest()

      await ensureSubTasksExpanded()

      if (createdSubTask) {
        const createdTask = createdTaskCard()
        if (await createdTask.isVisible().catch(() => false)) {
          await createdTask.getByRole('button', { name: 'Delete' }).click()
          await waitForActionReload()
        }
      }

      if (originalWrChecked !== null) {
        await openSelectedRequest()
        await ensureSubTasksExpanded()
        const wrCheckbox = page.getByLabel('Work requisition received')
        await expect(wrCheckbox).toBeVisible({ timeout: 10000 })
        const currentWrChecked = await wrCheckbox.isChecked()
        if (currentWrChecked !== originalWrChecked) {
          await wrCheckbox.click()
          await waitForActionReload()
        }
      }
    }

    try {
      await page.getByRole('button', { name: 'Add sub-task' }).click()
      const addSubTaskDialog = page.getByTestId('add-sub-task-dialog')
      await expect(addSubTaskDialog).toBeVisible()
      await addSubTaskDialog.getByPlaceholder('Describe the engineering follow-up work').fill(subTaskDescription)
      await addSubTaskDialog.getByRole('combobox').first().click()
      await page.getByRole('option', { name: 'Site survey' }).click()
      await page.getByTestId('add-sub-task-save').click()
      await expect(addSubTaskDialog).toBeHidden({ timeout: 15000 })
      await waitForActionReload()
      createdSubTask = true

      await openSelectedRequest()
      await ensureSubTasksExpanded()
      await expect(createdTaskCard()).toBeVisible()
      await expect(createdTaskCard().getByText(/Last edited/)).toBeVisible()

      const wrCheckbox = page.getByLabel('Work requisition received')
      originalWrChecked = await wrCheckbox.isChecked()
      if (originalWrChecked) {
        await wrCheckbox.click()
        await waitForActionReload()
        await openSelectedRequest()
        await ensureSubTasksExpanded()
        await expect(page.getByText('No WR')).toBeVisible()
      }
      await page.getByLabel('Work requisition received').click()
      await waitForActionReload()
      await openSelectedRequest()
      await ensureSubTasksExpanded()
      await expect(page.getByText('WR received')).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()

      await openSelectedRequest()
      await expect(page.getByRole('button', { name: /Sub-tasks/ })).toBeVisible()
      await expect(page.getByText('Work requisition received')).toBeHidden()
    } finally {
      await cleanup()
    }
  })
})
