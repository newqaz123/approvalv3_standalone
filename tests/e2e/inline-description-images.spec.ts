import { request as playwrightRequest, test, expect, type Locator, type Page } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'

/**
 * Inline description image browser gate — upload, controls, blocking,
 * retry/remove, persistence, authorization, template sharing, attachments.
 *
 * Opt-in Playwright release gate against a disposable authenticated
 * environment whose owner has already applied the inline-description-images
 * migration. Never silently skips: missing required variables fail setup with
 * a clear message so the gate cannot pass vacuously, and once enabled every
 * scenario executes real DOM and network assertions.
 *
 * Required:
 *  - TEST_BASE_URL                     (disposable migrated environment)
 *  - E2E_REQUESTER_EMAIL               (owner of the disposable rejected request)
 *  - E2E_REQUESTER_PASSWORD
 *  - E2E_INLINE_REQUEST_ID             (disposable rejected request the requester may resubmit)
 *  - E2E_INLINE_UNRELATED_EMAIL        (active account that CANNOT view E2E_INLINE_REQUEST_ID)
 *  - E2E_INLINE_UNRELATED_PASSWORD
 *  - E2E_INLINE_ADMIN_EMAIL            (admin who may edit the disposable template)
 *  - E2E_INLINE_ADMIN_PASSWORD
 *  - E2E_INLINE_TEMPLATE_ID            (disposable ACTIVE template; safe to overwrite)
 *  - E2E_INLINE_TEMPLATE_NAME          (template display name shown in the request form)
 *
 * Does not delete other data or target production. The resubmission test
 * consumes the disposable rejected request; the template test overwrites the
 * disposable template description and creates one new request. Without those
 * values the gate is PENDING on a disposable environment supplied by its owner.
 *
 * Implementation note (no live run during build): no disposable migrated
 * TEST_BASE_URL or credentials were supplied in this environment, so the live
 * gate is exercised here only via `playwright test --list`, `tsc --noEmit`
 * (through `npm run check`), and a missing-env run that must fail loudly.
 * Running the gate requires the inline-description-images migration to have
 * been applied by the environment owner; the spec never applies migrations.
 */

const REQUIRED_ENV = [
  'TEST_BASE_URL',
  'E2E_REQUESTER_EMAIL',
  'E2E_REQUESTER_PASSWORD',
  'E2E_INLINE_REQUEST_ID',
  'E2E_INLINE_UNRELATED_EMAIL',
  'E2E_INLINE_UNRELATED_PASSWORD',
  'E2E_INLINE_ADMIN_EMAIL',
  'E2E_INLINE_ADMIN_PASSWORD',
  'E2E_INLINE_TEMPLATE_ID',
  'E2E_INLINE_TEMPLATE_NAME',
] as const

/** Canonical stored source: /api/inline-images/<canonical UUID> only. */
const CANONICAL_SRC_RE =
  /^\/api\/inline-images\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A valid-format UUID that will never exist, for the migration canary. */
const MISSING_IMAGE_UUID = '00000000-0000-4000-8000-000000000000'

const BLOCKING_UPLOAD_MESSAGE = 'Wait for image uploads, or retry/remove failed images.'
const UPLOAD_FAILED_TEXT = 'Image upload failed'

/**
 * Real 16x16 PNG (solid color, verified with sharp) so server-side decode and
 * optimization always succeed. Identical bytes are reused under distinct fixed
 * filenames; the sanitized filename (minus extension) becomes each node's
 * default alt text, which is how the spec tells nodes apart.
 */
const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVR4nGO4FGBDEmIY1RAwGkqXhmvSAACoeF4Qrn9alwAAAABJRU5ErkJggg=='

const FIXTURE_DIR = join(tmpdir(), 'e2e-inline-description-images')

const PNG_FIXTURES = [
  'inline-toolbar.png',
  'inline-pasted.png',
  'inline-dropped.png',
  'inline-delayed.png',
  'inline-failing.png',
  'inline-removable.png',
  'inline-template.png',
] as const

const ATTACHMENT_FIXTURE = 'inline-attachment.pdf'

function pngPath(name: (typeof PNG_FIXTURES)[number]): string {
  return join(FIXTURE_DIR, name)
}

async function readFixtureBytes(path: string): Promise<number[]> {
  return Array.from(await readFile(path))
}

test.beforeAll(async () => {
  // RELEASE GATE: never skip. Fail loudly when the disposable environment is
  // not configured so the gate cannot pass vacuously.
  const missing = REQUIRED_ENV.filter((name) => {
    const value = process.env[name]
    return !value || value.trim() === ''
  })
  if (missing.length > 0) {
    throw new Error(
      `[inline-description-images] Missing required E2E environment variable(s): ${missing.join(', ')}. ` +
        'This release gate does not skip — supply all ten variables to run it ' +
        '(TEST_BASE_URL, E2E_REQUESTER_EMAIL, E2E_REQUESTER_PASSWORD, E2E_INLINE_REQUEST_ID, ' +
        'E2E_INLINE_UNRELATED_EMAIL, E2E_INLINE_UNRELATED_PASSWORD, E2E_INLINE_ADMIN_EMAIL, ' +
        'E2E_INLINE_ADMIN_PASSWORD, E2E_INLINE_TEMPLATE_ID, E2E_INLINE_TEMPLATE_NAME).',
    )
  }

  await mkdir(FIXTURE_DIR, { recursive: true })
  const png = Buffer.from(SAMPLE_PNG_BASE64, 'base64')
  for (const name of PNG_FIXTURES) {
    await writeFile(pngPath(name), png)
  }

  const pdf = await PDFDocument.create()
  pdf.addPage()
  await writeFile(join(FIXTURE_DIR, ATTACHMENT_FIXTURE), await pdf.save())
})

test.afterAll(async () => {
  await rm(FIXTURE_DIR, { recursive: true, force: true })
})

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in')
  await page.locator('input#email').fill(email)
  await page.locator('input#password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/(dashboard|requests|engineering|admin)\b/, { timeout: 20_000 })
}

/** Opens the rejected-request resubmission dialog through the deep link. */
async function openResubmitDialog(page: Page, requestId: string): Promise<Locator> {
  await page.goto(`/requests?requestId=${encodeURIComponent(requestId)}`)
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Resubmit Request' }),
  })
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(dialog.getByText(/Request Was Rejected/i)).toBeVisible()
  return dialog
}

/** Anything (Page or Locator) that can scope a CSS selector. */
type LocatorScope = { locator(selector: string): Locator }

/** The TipTap editable surface (present only once the lazy chunk has loaded). */
function richEditor(scope: LocatorScope): Locator {
  return scope.locator('.rich-text[role="textbox"]').first()
}

function imagePickerInput(scope: LocatorScope): Locator {
  return scope.locator('input[aria-label="Choose images"]').first()
}

function inlineImageNodes(scope: LocatorScope): Locator {
  return scope.locator('[data-inline-image-node]')
}

function stableImages(scope: LocatorScope): Locator {
  return scope.locator('[data-inline-image-node] img')
}

async function canonicalSrc(img: Locator): Promise<string> {
  const src = await img.getAttribute('src')
  expect(src, 'inline image src must be present').toBeTruthy()
  expect(src, 'inline image src must be the canonical private route, never a blob preview')
    .toMatch(CANONICAL_SRC_RE)
  return src as string
}

async function expectLoadedImage(img: Locator): Promise<void> {
  await expect
    .poll(
      async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth),
      { timeout: 15_000, message: 'authorized browser must receive real image bytes' },
    )
    .toBeGreaterThan(0)
}

/** Dispatches a real ClipboardEvent carrying one image File at the caret. */
async function pasteImageFile(editor: Locator, path: string): Promise<void> {
  const bytes = await readFixtureBytes(path)
  const name = path.split(/[\\/]/).pop() ?? path
  await editor.evaluate(
    (el, init) => {
      const transfer = new DataTransfer()
      transfer.items.add(
        new File([Uint8Array.from(init.bytes)], init.name, { type: 'image/png' }),
      )
      el.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      )
    },
    { name, bytes },
  )
}

/** Dispatches a real DragEvent (DataTransfer) with viewport drop coordinates. */
async function dropImageFile(page: Page, editor: Locator, path: string): Promise<void> {
  const bytes = await readFixtureBytes(path)
  const name = path.split(/[\\/]/).pop() ?? path
  const box = await editor.boundingBox()
  if (!box) throw new Error('Rich text editor has no bounding box for drop coordinates')

  const dataTransfer = await page.evaluateHandle(
    (init) => {
      const transfer = new DataTransfer()
      transfer.items.add(
        new File([Uint8Array.from(init.bytes)], init.name, { type: 'image/png' }),
      )
      return transfer
    },
    { name, bytes },
  )
  await editor.dispatchEvent('drop', {
    dataTransfer,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
    bubbles: true,
    cancelable: true,
  })
}

type UploadRouteMode = 'passthrough' | 'hold' | 'abort'

type InlineImageRouteInstrumentation = {
  /** One entry per POST /api/inline-images that reached the server or was aborted. */
  uploads: Array<{ kind: 'pass' | 'abort'; status: number }>
  /** Image ids seen in DELETE /api/inline-images/<id> requests. */
  deletes: string[]
  setMode(mode: UploadRouteMode): void
  releaseHold(): void
}

/**
 * Instruments the inline-image upload/delete routes without weakening them:
 * passthrough still hits the real server via route.fetch(). `hold` parks one
 * POST indefinitely (the delayed-route scenario), `abort` simulates a network
 * failure. DELETE calls are counted and continued.
 */
async function instrumentInlineImageRoutes(page: Page): Promise<InlineImageRouteInstrumentation> {
  const state: InlineImageRouteInstrumentation = {
    uploads: [],
    deletes: [],
    setMode() {
      throw new Error('setMode assigned below')
    },
    releaseHold() {
      throw new Error('releaseHold assigned below')
    },
  }
  let mode: UploadRouteMode = 'passthrough'
  let holdGate: Promise<void> = Promise.resolve()
  let releaseHold: () => void = () => {}

  state.setMode = (next: UploadRouteMode) => {
    if (next === 'hold') {
      holdGate = new Promise<void>((resolve) => {
        releaseHold = resolve
      })
    }
    mode = next
  }
  state.releaseHold = () => releaseHold()

  await page.route('**/api/inline-images', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    if (mode === 'abort') {
      state.uploads.push({ kind: 'abort', status: 0 })
      await route.abort('connectionreset')
      return
    }
    if (mode === 'hold') await holdGate
    const response = await route.fetch()
    state.uploads.push({ kind: 'pass', status: response.status() })
    await route.fulfill({ response })
  })

  await page.route('**/api/inline-images/*', async (route) => {
    const request = route.request()
    if (request.method() === 'DELETE') {
      const match = /\/api\/inline-images\/([^/?#]+)/.exec(new URL(request.url()).pathname)
      if (match) state.deletes.push(match[1])
    }
    await route.continue()
  })

  return state
}

/**
 * Authenticated canary: a well-formed UUID that cannot exist must 404. A 500
 * means the inline image tables are missing — the environment owner must
 * apply the migration; this spec never applies migrations itself.
 */
async function expectMigrationApplied(page: Page): Promise<void> {
  const canary = await page.request.get(`/api/inline-images/${MISSING_IMAGE_UUID}`)
  if (canary.status() === 500) {
    throw new Error(
      '[inline-description-images] GET /api/inline-images returned 500 for a random UUID — ' +
        'the disposable database is missing the inline-description-images migration. ' +
        'The environment owner must apply it; this gate never migrates.',
    )
  }
  expect(canary.status(), 'unknown inline image id must be 404, not 500/403').toBe(404)
}

test.describe('Inline description images (release gate)', () => {
  test('toolbar, paste, and drop uploads, image controls, upload blocking, retry, and remove', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    const email = process.env.E2E_REQUESTER_EMAIL as string
    const password = process.env.E2E_REQUESTER_PASSWORD as string
    const requestId = process.env.E2E_INLINE_REQUEST_ID as string

    await login(page, email, password)
    await expectMigrationApplied(page)

    const routes = await instrumentInlineImageRoutes(page)
    const dialog = await openResubmitDialog(page, requestId)
    const editor = richEditor(dialog)
    await expect(editor).toBeVisible({ timeout: 20_000 })

    const submitButton = dialog.getByRole('button', { name: 'Resubmit Request', exact: true })
    const blockingNotice = dialog.getByText(BLOCKING_UPLOAD_MESSAGE, { exact: true })

    // ── 1. Toolbar file selection: uploading placeholder, then canonical img ──
    // Hold the first POST so the placeholder state is observable, not racy.
    routes.setMode('hold')
    await imagePickerInput(dialog).setInputFiles(pngPath('inline-toolbar.png'))
    await expect(inlineImageNodes(dialog).first()).toBeVisible()
    await expect(inlineImageNodes(dialog).first()).toContainText('Uploading image…')
    await expect(inlineImageNodes(dialog).first().locator('[aria-busy="true"]')).toBeVisible()
    routes.releaseHold()

    const toolbarImg = stableImages(dialog).first()
    await expect(toolbarImg).toBeVisible({ timeout: 20_000 })
    await canonicalSrc(toolbarImg)
    await expect(toolbarImg).toHaveAttribute('alt', 'inline-toolbar')
    await expect(toolbarImg).toHaveAttribute('data-align', 'center')
    expect(routes.uploads.filter((upload) => upload.kind === 'pass')).toHaveLength(1)

    // ── 3. Alt text and alignment controls update sanitized attributes ──────
    await toolbarImg.click()
    const controls = dialog.getByRole('group', { name: 'Image controls' })
    await expect(controls).toBeVisible()
    await controls.getByLabel('Image alt text').fill('Renamed floor plan')
    await expect(toolbarImg).toHaveAttribute('alt', 'Renamed floor plan')

    const alignRight = controls.getByRole('button', { name: 'Align right' })
    await alignRight.click()
    await expect(alignRight).toHaveAttribute('aria-pressed', 'true')
    await expect(toolbarImg).toHaveAttribute('data-align', 'right')
    await expect(inlineImageNodes(dialog).first()).toHaveAttribute('data-align', 'right')

    const alignLeft = controls.getByRole('button', { name: 'Align left' })
    await alignLeft.click()
    await expect(toolbarImg).toHaveAttribute('data-align', 'left')
    await controls.getByRole('button', { name: 'Align center' }).click()
    await expect(toolbarImg).toHaveAttribute('data-align', 'center')

    // ── 2. Paste and drop each invoke the same upload route ─────────────────
    // Insertion happens at the current selection, so nodes are identified by
    // their sanitized default alt text rather than DOM order.
    await pasteImageFile(editor, pngPath('inline-pasted.png'))
    await expect(stableImages(dialog)).toHaveCount(2, { timeout: 20_000 })
    await expect(dialog.locator('img[alt="inline-pasted"]')).toHaveCount(1)
    await canonicalSrc(dialog.locator('img[alt="inline-pasted"]'))

    await dropImageFile(page, editor, pngPath('inline-dropped.png'))
    await expect(stableImages(dialog)).toHaveCount(3, { timeout: 20_000 })
    await expect(dialog.locator('img[alt="inline-dropped"]')).toHaveCount(1)
    await canonicalSrc(dialog.locator('img[alt="inline-dropped"]'))
    expect(
      routes.uploads.filter((upload) => upload.kind === 'pass'),
      'toolbar, paste, and drop all used POST /api/inline-images',
    ).toHaveLength(3)

    // ── 4a. Submit stays disabled while the upload route is delayed ─────────
    routes.setMode('hold')
    await imagePickerInput(dialog).setInputFiles(pngPath('inline-delayed.png'))
    await expect(inlineImageNodes(dialog).filter({ hasText: 'Uploading image…' })).toHaveCount(1)
    await expect(blockingNotice).toBeVisible()
    await expect(submitButton).toBeDisabled()
    routes.releaseHold()
    await expect(dialog.locator('img[alt="inline-delayed"]')).toHaveCount(1, {
      timeout: 20_000,
    })
    await canonicalSrc(dialog.locator('img[alt="inline-delayed"]'))

    // ── 4b. Submit stays disabled while a forced upload fails ───────────────
    routes.setMode('abort')
    await imagePickerInput(dialog).setInputFiles(pngPath('inline-failing.png'))
    const failedNode = inlineImageNodes(dialog).filter({ hasText: UPLOAD_FAILED_TEXT })
    await expect(failedNode).toHaveCount(1)
    // The alert wrapper also renders the Retry/Remove buttons, so assert the
    // error text as a substring instead of an exact match.
    await expect(failedNode.getByRole('alert')).toContainText(UPLOAD_FAILED_TEXT)
    await expect(blockingNotice).toBeVisible()
    await expect(submitButton).toBeDisabled()
    expect(routes.uploads.filter((upload) => upload.kind === 'abort')).toHaveLength(1)

    // ── 5a. Retry succeeds after the forced failure ─────────────────────────
    routes.setMode('passthrough')
    await failedNode.getByRole('button', { name: 'Retry' }).click()
    const retriedImg = dialog.locator('img[alt="inline-failing"]')
    await expect(retriedImg).toBeVisible({ timeout: 20_000 })
    await canonicalSrc(retriedImg)
    await expect(inlineImageNodes(dialog).filter({ hasText: UPLOAD_FAILED_TEXT })).toHaveCount(0)

    // ── 5b. Remove clears a failed draft and unblocks submission ────────────
    routes.setMode('abort')
    await imagePickerInput(dialog).setInputFiles(pngPath('inline-removable.png'))
    const removableNode = inlineImageNodes(dialog).filter({ hasText: UPLOAD_FAILED_TEXT })
    await expect(removableNode).toHaveCount(1)
    await removableNode.getByRole('button', { name: 'Remove' }).click()
    await expect(removableNode).toHaveCount(0)
    await expect(inlineImageNodes(dialog).filter({ hasText: UPLOAD_FAILED_TEXT })).toHaveCount(0)
    await expect(blockingNotice).toHaveCount(0)
    await expect(submitButton).toBeEnabled()

    // ── 5c. Removing a committed-in-editor draft calls the DELETE route ────
    const stableCountBeforeRemove = await stableImages(dialog).count()
    const removedImg = dialog.locator('img[alt="inline-delayed"]')
    const removedSrc = await canonicalSrc(removedImg)
    await removedImg.click()
    const removeControls = dialog.getByRole('group', { name: 'Image controls' })
    await expect(removeControls).toBeVisible()
    const deletesBeforeRemove = routes.deletes.length
    await removeControls.getByRole('button', { name: 'Remove' }).click()
    await expect(dialog.locator(`img[src="${removedSrc}"]`)).toHaveCount(0)
    await expect(stableImages(dialog)).toHaveCount(stableCountBeforeRemove - 1)
    await expect
      .poll(() => routes.deletes.length, { timeout: 15_000, message: 'draft DELETE must reach the server' })
      .toBeGreaterThan(deletesBeforeRemove)

    // ── Cancel cleans every remaining staged draft server-side ─────────────
    const stableBeforeCancel = await stableImages(dialog).count()
    expect(stableBeforeCancel).toBeGreaterThanOrEqual(4)
    const deletesBeforeCancel = routes.deletes.length
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })
    await expect
      .poll(() => routes.deletes.length, {
        timeout: 20_000,
        message: 'cancel must delete every remaining staged draft',
      })
      .toBeGreaterThanOrEqual(deletesBeforeCancel + stableBeforeCancel)
  })

  test('requester saves an inline image with the resubmission and reopens it', async ({ page }) => {
    test.setTimeout(180_000)

    const email = process.env.E2E_REQUESTER_EMAIL as string
    const password = process.env.E2E_REQUESTER_PASSWORD as string
    const requestId = process.env.E2E_INLINE_REQUEST_ID as string

    await login(page, email, password)

    const dialog = await openResubmitDialog(page, requestId)
    await expect(richEditor(dialog)).toBeVisible({ timeout: 20_000 })

    // Upload, then persist a non-default alt text and alignment.
    await imagePickerInput(dialog).setInputFiles(pngPath('inline-toolbar.png'))
    const editorImg = stableImages(dialog).first()
    await expect(editorImg).toBeVisible({ timeout: 20_000 })
    const savedSrc = await canonicalSrc(editorImg)

    await editorImg.click()
    const controls = dialog.getByRole('group', { name: 'Image controls' })
    await expect(controls).toBeVisible()
    await controls.getByLabel('Image alt text').fill('E2E committed inline image')
    await controls.getByRole('button', { name: 'Align right' }).click()
    await expect(editorImg).toHaveAttribute('data-align', 'right')

    await dialog.getByRole('button', { name: 'Resubmit Request', exact: true }).click()
    await expect(page.getByText('Request resubmitted successfully')).toBeVisible({
      timeout: 30_000,
    })

    // ── 6. Reopen the request detail and verify the private image renders ──
    await page.goto(`/requests/${encodeURIComponent(requestId)}`)
    const descriptionCard = page.locator('div.bg-white').filter({
      has: page.getByRole('heading', { name: 'Description', exact: true }),
    })
    const detailImg = descriptionCard.locator('span.rich-text img').first()
    await expect(detailImg).toBeVisible({ timeout: 20_000 })
    await expect(detailImg).toHaveAttribute('src', savedSrc)
    await expect(detailImg).toHaveAttribute('alt', 'E2E committed inline image')
    await expect(detailImg).toHaveAttribute('data-align', 'right')
    // Sanitized persistence: exactly the three approved attributes survive.
    const attributeNames = await detailImg.evaluate((el) =>
      Array.from(el.attributes)
        .map((attribute) => attribute.name)
        .sort(),
    )
    expect(attributeNames).toEqual(['alt', 'data-align', 'src'])
    await expectLoadedImage(detailImg)

    // The authorized requester streams the stored bytes with safe headers.
    const imageResponse = await page.request.get(savedSrc)
    expect(imageResponse.status()).toBe(200)
    expect(imageResponse.headers()['content-type'] ?? '').toMatch(/^image\//)
    expect(imageResponse.headers()['x-content-type-options'] ?? '').toBe('nosniff')
  })

  test('inline image reads enforce 401, 403, and 200 authorization', async ({ page }) => {
    test.setTimeout(120_000)

    const email = process.env.E2E_REQUESTER_EMAIL as string
    const password = process.env.E2E_REQUESTER_PASSWORD as string
    const unrelatedEmail = process.env.E2E_INLINE_UNRELATED_EMAIL as string
    const unrelatedPassword = process.env.E2E_INLINE_UNRELATED_PASSWORD as string
    const requestId = process.env.E2E_INLINE_REQUEST_ID as string
    const baseUrl = process.env.TEST_BASE_URL as string

    // Discover the committed image URL from the saved request description.
    await login(page, email, password)
    await page.goto(`/requests/${encodeURIComponent(requestId)}`)
    const descriptionCard = page.locator('div.bg-white').filter({
      has: page.getByRole('heading', { name: 'Description', exact: true }),
    })
    const detailImg = descriptionCard.locator('span.rich-text img').first()
    await expect(detailImg).toBeVisible({ timeout: 20_000 })
    const committedSrc = await canonicalSrc(detailImg)

    // ── 7a. Unauthenticated GET returns 401 ────────────────────────────────
    const anonymous = await playwrightRequest.newContext({ baseURL: baseUrl })
    const anonymousResponse = await anonymous.get(committedSrc)
    expect(anonymousResponse.status()).toBe(401)
    expect(await anonymousResponse.json()).toEqual({ error: 'Unauthorized' })
    await anonymous.dispose()

    // Authorized requester still receives the bytes.
    const requesterResponse = await page.request.get(committedSrc)
    expect(requesterResponse.status()).toBe(200)
    expect(requesterResponse.headers()['content-type'] ?? '').toMatch(/^image\//)

    // ── 7b. A different account without request visibility returns 403 ────
    await page.context().clearCookies()
    await login(page, unrelatedEmail, unrelatedPassword)
    const forbiddenResponse = await page.request.get(committedSrc)
    expect(forbiddenResponse.status()).toBe(403)
  })

  test('template image is committed by the template save and reused by a new request; attachment upload stays independent', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    const adminEmail = process.env.E2E_INLINE_ADMIN_EMAIL as string
    const adminPassword = process.env.E2E_INLINE_ADMIN_PASSWORD as string
    const requesterEmail = process.env.E2E_REQUESTER_EMAIL as string
    const requesterPassword = process.env.E2E_REQUESTER_PASSWORD as string
    const templateId = process.env.E2E_INLINE_TEMPLATE_ID as string
    const templateName = process.env.E2E_INLINE_TEMPLATE_NAME as string
    const editUrl = `/admin/templates/${encodeURIComponent(templateId)}`

    // ── 8a. Admin uploads one image and saves the template ─────────────────
    await login(page, adminEmail, adminPassword)
    await page.goto(editUrl)
    await expect(page.getByRole('heading', { name: 'Edit Template' })).toBeVisible()
    const templateEditor = richEditor(page)
    await expect(templateEditor).toBeVisible({ timeout: 20_000 })

    await imagePickerInput(page).setInputFiles(pngPath('inline-template.png'))
    const templateImg = stableImages(page).first()
    await expect(templateImg).toBeVisible({ timeout: 20_000 })
    const templateSrc = await canonicalSrc(templateImg)
    await expectLoadedImage(templateImg)

    await page.getByRole('button', { name: 'Update Template' }).click()
    await page.waitForURL(/\/admin\/templates$/, { timeout: 30_000 })

    // The saved template still renders the same committed image after edit.
    await page.goto(editUrl)
    await expect(richEditor(page)).toBeVisible({ timeout: 20_000 })
    const reopenedImg = stableImages(page).first()
    await expect(reopenedImg).toBeVisible({ timeout: 20_000 })
    await expect(reopenedImg).toHaveAttribute('src', templateSrc)
    await expectLoadedImage(reopenedImg)

    // ── 8b. Requester copies the template description into a new request ──
    await page.context().clearCookies()
    await login(page, requesterEmail, requesterPassword)
    await page.goto('/requests/new')
    await expect(page.getByRole('heading', { name: 'New Improvement Request' })).toBeVisible()

    // Legacy attachment uploads POST multipart to the page URL; the request
    // metadata server action never carries a File. This discriminator counts
    // only real attachment uploads.
    const attachmentUploads: number[] = []
    await page.route('**/requests/new', async (route) => {
      const httpRequest = route.request()
      if (
        httpRequest.method() === 'POST'
        && (httpRequest.headers()['content-type'] ?? '').includes('multipart/form-data')
      ) {
        const response = await route.fetch()
        attachmentUploads.push(response.status())
        await route.fulfill({ response })
        return
      }
      await route.continue()
    })

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: templateName }).click()
    const formImg = stableImages(page).first()
    await expect(formImg).toBeVisible({ timeout: 20_000 })
    await expect(formImg).toHaveAttribute('src', templateSrc)
    await expectLoadedImage(formImg)

    const uniqueTitle = `E2E inline template image ${Date.now()}`
    await page.getByPlaceholder('Brief summary of your request').fill(uniqueTitle)

    // ── 9. Existing attachment upload still succeeds independently ────────
    await page.locator('input#file-upload').setInputFiles(join(FIXTURE_DIR, ATTACHMENT_FIXTURE))
    await expect(page.getByText(ATTACHMENT_FIXTURE)).toBeVisible()

    await page.getByRole('button', { name: 'Create Request' }).click()
    await page.waitForURL((url) => url.pathname === '/requests', { timeout: 60_000 })
    expect(
      attachmentUploads,
      'exactly one legacy attachment upload, and it succeeded',
    ).toEqual([200])

    // ── 8c. The created request renders the shared template image ─────────
    const createdRow = page.getByRole('row', { name: uniqueTitle })
    await expect(createdRow).toBeVisible({ timeout: 20_000 })
    await createdRow.click()
    const createdDialog = page
      .getByRole('dialog')
      .filter({ has: page.locator(`img[src="${templateSrc}"]`) })
    await expect(createdDialog).toBeVisible({ timeout: 20_000 })
    await expect(createdDialog.locator(`img[src="${templateSrc}"]`).first()).toBeVisible()
    await expectLoadedImage(createdDialog.locator(`img[src="${templateSrc}"]`).first())
  })
})
