import { test, expect, type Page, type Locator } from '@playwright/test'

/**
 * Formatted description browser gate — edit, bold, newline, resubmit, reopen.
 *
 * Opt-in Playwright gate against a disposable authenticated requester
 * environment. Never silently skips: missing required variables fail setup
 * with a clear message so the gate cannot pass vacuously.
 *
 * Required:
 *  - TEST_BASE_URL
 *  - E2E_REQUESTER_EMAIL
 *  - E2E_REQUESTER_PASSWORD
 *  - E2E_FORMATTED_REQUEST_ID  (disposable rejected request the requester may resubmit)
 *
 * Does not delete attachments or target production data. Live pass requires a
 * locally seeded disposable request; without those values the gate is PENDING.
 */

const REQUIRED_ENV = [
  'TEST_BASE_URL',
  'E2E_REQUESTER_EMAIL',
  'E2E_REQUESTER_PASSWORD',
  'E2E_FORMATTED_REQUEST_ID',
] as const

const DESCRIPTION_SEED = 'Before **bold**\nAfter <script>alert(1)</script>'

test.beforeAll(() => {
  const missing = REQUIRED_ENV.filter((name) => {
    const value = process.env[name]
    return !value || value.trim() === ''
  })
  if (missing.length > 0) {
    throw new Error(
      `[formatted-descriptions] Missing required E2E environment variable(s): ${missing.join(', ')}. ` +
        'This release gate does not skip — supply all four variables to run it ' +
        '(TEST_BASE_URL, E2E_REQUESTER_EMAIL, E2E_REQUESTER_PASSWORD, E2E_FORMATTED_REQUEST_ID).',
    )
  }
})

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in')
  await page.locator('input#email').fill(email)
  await page.locator('input#password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/(dashboard|requests|engineering)\b/, { timeout: 20_000 })
}

async function selectTextInTextarea(
  textarea: Locator,
  target: string,
): Promise<void> {
  await textarea.evaluate((el, text) => {
    const node = el as HTMLTextAreaElement
    const start = node.value.indexOf(text)
    if (start < 0) {
      throw new Error(`Could not find selection target ${JSON.stringify(text)} in textarea value`)
    }
    node.focus()
    node.setSelectionRange(start, start + text.length)
  }, target)
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  return haystack.split(needle).length - 1
}

test.describe('Formatted description browser flow (release gate)', () => {
  test('requester bolds, resubmits, and sees safe rendered description', async ({ page }) => {
    test.setTimeout(120_000)

    const email = process.env.E2E_REQUESTER_EMAIL as string
    const password = process.env.E2E_REQUESTER_PASSWORD as string
    const requestId = process.env.E2E_FORMATTED_REQUEST_ID as string

    // ── Login ──────────────────────────────────────────────────────────
    await login(page, email, password)

    // ── Open real rejection / resubmission flow via deep link ──────────
    await page.goto(`/requests?requestId=${encodeURIComponent(requestId)}`)
    const resubmitDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: /Resubmit Request/i }),
    })
    await expect(resubmitDialog).toBeVisible({ timeout: 20_000 })
    await expect(resubmitDialog.getByText(/Request Was Rejected/i)).toBeVisible()

    const description = resubmitDialog.locator('textarea#description')
    await expect(description).toBeVisible()

    // ── Fill seed description (exact plan contract) ────────────────────
    await description.fill(DESCRIPTION_SEED)
    await expect(description).toHaveValue(DESCRIPTION_SEED)

    // ── Select "bold", apply toolbar Bold, assert non-vacuous change ──
    // Seed already contains **bold** once; capture pre-click so a no-op
    // toolbar click cannot pass. Required initial source string is unchanged.
    const valueBeforeBold = await description.inputValue()
    expect(valueBeforeBold).toBe(DESCRIPTION_SEED)
    expect(countOccurrences(valueBeforeBold, '**bold**')).toBe(1)

    await selectTextInTextarea(description, 'bold')
    await resubmitDialog.getByTestId('formatted-text-bold').click()

    await expect
      .poll(
        async () => {
          const value = await description.inputValue()
          return {
            changed: value !== valueBeforeBold,
            boldCount: countOccurrences(value, '**bold**'),
            value,
          }
        },
        {
          timeout: 5_000,
          message:
            'Bold control must change the textarea value and leave **bold** exactly once',
        },
      )
      .toEqual(
        expect.objectContaining({
          changed: true,
          boldCount: 1,
        }),
      )

    // ── Enter a newline beyond the seed newline, then resubmit ─────────
    // Seed already has one \n; place caret at true end-of-text (not just
    // end-of-line) and press Enter so the value gains a second newline.
    const newlinesBeforeEnter = countOccurrences(await description.inputValue(), '\n')
    expect(newlinesBeforeEnter).toBeGreaterThanOrEqual(1)

    await description.evaluate((el) => {
      const node = el as HTMLTextAreaElement
      node.focus()
      const end = node.value.length
      node.setSelectionRange(end, end)
    })
    await description.press('Enter')

    const valueBeforeSubmit = await description.inputValue()
    expect(countOccurrences(valueBeforeSubmit, '\n')).toBeGreaterThanOrEqual(2)
    expect(countOccurrences(valueBeforeSubmit, '\n')).toBeGreaterThan(newlinesBeforeEnter)
    expect(countOccurrences(valueBeforeSubmit, '**bold**')).toBe(1)
    expect(valueBeforeSubmit).toContain('<script>alert(1)</script>')

    await resubmitDialog.getByRole('button', { name: /Resubmit Request/i }).click()

    // request-resubmit-modal closes synchronously in handleSubmit before the
    // server action resolves — dialog dismissal is NOT success. Wait only for
    // the real handler toast from request-modal-router onResubmit.
    await expect(page.getByText('Request resubmitted successfully')).toBeVisible({
      timeout: 30_000,
    })

    // ── Reopen real request detail page and assert safe render ─────────
    await page.goto(`/requests/${encodeURIComponent(requestId)}`)
    await page.waitForURL(new RegExp(`/requests/${requestId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), {
      timeout: 20_000,
    })

    const requestDescription = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Description', exact: true }) })
      .first()
      .locator('p')
      .first()

    await expect(requestDescription).toBeVisible({ timeout: 20_000 })

    // Visible bold text rendered through <strong>
    await expect(requestDescription.locator('strong')).toContainText('bold')
    await expect(requestDescription).toContainText('bold')

    // Newline becomes a real <br> descendant
    await expect
      .poll(async () => requestDescription.locator('br').count(), {
        timeout: 5_000,
        message: 'rendered description must include at least one <br> for the newline',
      })
      .toBeGreaterThanOrEqual(1)

    // Script payload is text, not an executable element
    await expect(requestDescription).toContainText('<script>alert(1)</script>')
    await expect(requestDescription.locator('script')).toHaveCount(0)
  })
})
