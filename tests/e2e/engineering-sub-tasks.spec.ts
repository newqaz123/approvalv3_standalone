import { expect, test } from '@playwright/test'

const TEST_USERS = {
  engineering: { email: 'eng1@example.com', password: 'changeme' },
}

async function login(page: any, email: string, password: string) {
  await page.goto('/sign-in')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|engineering)/, { timeout: 10000 })
}

test.describe('engineering sub-tasks', () => {
  test('engineer manages request sub-tasks and WR from a collapsed panel', async ({ page }) => {
    await login(page, TEST_USERS.engineering.email, TEST_USERS.engineering.password)

    await page.goto('/engineering')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'All Engineering Requests' }).click()

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

    await selectedRow.click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const subTasksTrigger = page.getByRole('button', { name: /Sub-tasks/ })
    await expect(subTasksTrigger).toBeVisible()
    await expect(page.getByText('Work requisition received')).toBeHidden()

    await subTasksTrigger.click()
    await expect(page.getByText('Work requisition received')).toBeVisible()

    const subTaskDescription = `Piping work ${Date.now()}`
    await page.getByRole('button', { name: 'Add sub-task' }).click()
    await page.getByPlaceholder('Describe the engineering follow-up work').fill(subTaskDescription)
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Site survey' }).click()
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText(subTaskDescription)).toBeVisible()
    await expect(page.getByText(/Last edited/)).toBeVisible()

    const wrCheckbox = page.getByLabel('Work requisition received')
    const originalWrChecked = await wrCheckbox.isChecked()
    if (originalWrChecked) {
      await wrCheckbox.uncheck()
      await expect(page.getByText('No WR')).toBeVisible()
    }
    await wrCheckbox.check()
    await expect(page.getByText('WR received')).toBeVisible()

    const createdTask = page
      .locator('div')
      .filter({ hasText: subTaskDescription })
      .filter({ has: page.getByRole('button', { name: 'Delete' }) })
      .first()
    await createdTask.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText(subTaskDescription)).toBeHidden()

    if (!originalWrChecked) {
      await wrCheckbox.uncheck()
      await expect(page.getByText('No WR')).toBeVisible()
    }

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()

    await selectedRow.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('button', { name: /Sub-tasks/ })).toBeVisible()
    await expect(page.getByText('Work requisition received')).toBeHidden()
  })
})
