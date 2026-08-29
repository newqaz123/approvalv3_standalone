import { request as playwrightRequest, test, expect, type Locator, type Page } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'

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
const EDIT_BLOCKING_MESSAGE = 'Apply or cancel the image edit before saving.'
const UPLOAD_FAILED_TEXT = 'Image upload failed'

const TEXT_COLOR_VALUES = {
  ink: '#1E293B',
  slate: '#475569',
  blue: '#1D4ED8',
  teal: '#0F766E',
  green: '#15803D',
  amber: '#B45309',
  red: '#B91C1C',
} as const

const HIGHLIGHT_COLOR_VALUES = {
  yellow: '#FEF3C7',
  blue: '#DBEAFE',
  green: '#D1FAE5',
  pink: '#FCE7F3',
  violet: '#EDE9FE',
  red: '#FEE2E2',
  gray: '#E2E8F0',
} as const

type SerializedImagePresentation = {
  src: string
  width: string | null
  naturalWidth: string | null
  naturalHeight: string | null
  cropX: string | null
  cropY: string | null
  cropWidth: string | null
  cropHeight: string | null
}

/**
 * A real 320x180 PNG (solid color, resized and verified with sharp) so the
 * server-side decode, optimization, and interactive crop/resize surfaces are
 * all large enough for real pointer gestures. Identical bytes are reused under
 * distinct fixed filenames; the sanitized filename (minus extension) becomes
 * each node's default alt text, which is how the spec tells nodes apart.
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
  const png = await sharp(Buffer.from(SAMPLE_PNG_BASE64, 'base64'))
    .resize(320, 180)
    .png()
    .toBuffer()
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

async function serializedPresentation(img: Locator): Promise<SerializedImagePresentation> {
  return {
    src: await canonicalSrc(img),
    width: await img.getAttribute('data-width'),
    naturalWidth: await img.getAttribute('data-natural-width'),
    naturalHeight: await img.getAttribute('data-natural-height'),
    cropX: await img.getAttribute('data-crop-x'),
    cropY: await img.getAttribute('data-crop-y'),
    cropWidth: await img.getAttribute('data-crop-width'),
    cropHeight: await img.getAttribute('data-crop-height'),
  }
}

async function dragResizeHandle(
  page: Page,
  scope: LocatorScope,
  image: Locator,
  delta = 80,
): Promise<SerializedImagePresentation> {
  await image.click()
  // The top-right handle avoids the fixed modal footer when the editor has
  // scrolled the image's lower edge beneath it.
  const handle = scope.locator('button[aria-label="Resize image top-right"]')
  await expect(handle).toBeVisible()
  const beforeWidth = await image.evaluate((element) => element.getBoundingClientRect().width)
  const box = await handle.boundingBox()
  if (!box) throw new Error('Resize handle has no bounding box for a real pointer drag')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + delta, startY + delta, { steps: 5 })
  await page.mouse.up()

  await expect
    .poll(
      async () => Number(await image.getAttribute('data-width')),
      { timeout: 15_000, message: 'real resize drag must commit data-width' },
    )
    .toBeGreaterThan(Math.round(beforeWidth))
  return serializedPresentation(image)
}

async function enterCrop(scope: LocatorScope, image: Locator): Promise<Locator> {
  await image.click()
  const toolbar = scope.locator('[role="toolbar"][aria-label="Image actions"]')
  await expect(toolbar).toBeVisible()
  await toolbar.getByRole('button', { name: 'Crop image' }).click()
  const crop = scope.locator('[data-inline-image-crop="true"]')
  await expect(crop).toBeVisible()
  return crop
}

async function chooseCropPreset(crop: Locator, preset: 'free' | 'original' | '1:1' | '4:3' | '16:9') {
  const button = crop.getByRole('button', { name: `Crop aspect ${preset}` })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

async function increaseCropZoom(crop: Locator, steps = 8): Promise<string> {
  const zoom = crop.getByRole('slider', { name: 'Image zoom' })
  await zoom.focus()
  for (let index = 0; index < steps; index += 1) await zoom.press('ArrowRight')
  const value = await zoom.inputValue()
  expect(Number(value), 'crop zoom must respond to keyboard input').toBeGreaterThan(1)
  return value
}

async function panCropSurface(page: Page, crop: Locator): Promise<void> {
  const region = crop.getByRole('group', { name: 'Crop region' })
  const beforeStyle = await region.getAttribute('style')
  const box = await region.boundingBox()
  if (!box) throw new Error('Crop region has no bounding box for a real pan gesture')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + Math.min(24, box.width / 4), startY, { steps: 4 })
  await page.mouse.up()
  await expect
    .poll(
      () => region.getAttribute('style'),
      { timeout: 15_000, message: 'real crop pan must change the crop region' },
    )
    .not.toBe(beforeStyle)
}

async function selectTextOccurrence(editor: Locator, text: string, occurrence = 0): Promise<void> {
  const found = await editor.evaluate(
    (root, target) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let seen = 0
      let current: Node | null = walker.nextNode()
      while (current) {
        const value = current.nodeValue ?? ''
        let offset = value.indexOf(target.text)
        while (offset !== -1) {
          if (seen === target.occurrence) {
            const range = document.createRange()
            range.setStart(current, offset)
            range.setEnd(current, offset + target.text.length)
            const selection = window.getSelection()
            selection?.removeAllRanges()
            selection?.addRange(range)
            return true
          }
          seen += 1
          offset = value.indexOf(target.text, offset + target.text.length)
        }
        current = walker.nextNode()
      }
      return false
    },
    { text, occurrence },
  )
  expect(found, `editor text occurrence ${text} must exist`).toBe(true)
}

async function pasteUnsupportedColorHtml(editor: Locator): Promise<void> {
  await editor.focus()
  await editor.press('Control+End')
  await editor.evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.setData(
      'text/html',
      '<span style="color:#ff00ff;background-color:#123456">unsupported-color</span>',
    )
    transfer.setData('text/plain', 'unsupported-color')
    element.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    }))
  })
  await expect(editor).toContainText('unsupported-color')
  await expect(editor.locator('span[data-text-color][style], mark[data-highlight][style]')).toHaveCount(0)
  const hostileStyles = await editor.evaluate((root) =>
    Array.from(root.querySelectorAll('[style]'))
      .map((element) => element.getAttribute('style') ?? '')
      .filter((style) => /ff00ff|123456/i.test(style)),
  )
  expect(hostileStyles).toEqual([])
}

async function applyColorToken(
  page: Page,
  editor: Locator,
  controls: Locator,
  kind: 'text' | 'highlight',
  token: string,
  marker: string,
): Promise<void> {
  await selectTextOccurrence(editor, marker)
  const label = kind === 'text' ? 'Text color' : 'Highlight'
  const paletteLabel = `${label} palette`
  const trigger = controls.getByRole('button', { name: label })
  await trigger.click()
  const palette = page.locator(`[aria-label="${paletteLabel}"]`).first()
  await expect(palette).toBeVisible()
  const swatch = palette.locator(`[data-color-kind="${kind}"][data-color-token="${token}"]`)
  await expect(swatch).toHaveAttribute('data-color-value', kind === 'text'
    ? TEXT_COLOR_VALUES[token as keyof typeof TEXT_COLOR_VALUES]
    : HIGHLIGHT_COLOR_VALUES[token as keyof typeof HIGHLIGHT_COLOR_VALUES])
  await swatch.click()
  await expect(trigger).toHaveAttribute('data-active-token', token)
  await expect(editor.locator(`[data-${kind === 'text' ? 'text-color' : 'highlight'}="${token}"]`)).toContainText(marker)
}

function normalizedMarkup(markup: string): string {
  return markup.replace(/\s+/g, '').toLowerCase()
}

function normalizedInlineStyle(style: string | null): string {
  return (style ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\/1(?=;|$)/g, '')
    .split(';')
    .filter(Boolean)
    .sort()
    .join(';')
}

async function expectMaterializedPalette(scope: LocatorScope): Promise<void> {
  const markup = normalizedMarkup(await scope.locator('span.rich-text').innerHTML())
  for (const value of Object.values(TEXT_COLOR_VALUES)) {
    expect(markup).toContain(`color:${value.toLowerCase()}`)
  }
  for (const value of Object.values(HIGHLIGHT_COLOR_VALUES)) {
    expect(markup).toContain(`background-color:${value.toLowerCase()}`)
  }
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
  test.describe.configure({ mode: 'serial' })
  test('scenarios 1-2 and 4: floating toolbar, real resize, reset, uploads, and cleanup', async ({
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

    // ── 1. Selection uses only the floating toolbar, never the old row ──────
    await toolbarImg.click()
    const floatingToolbar = dialog.getByRole('toolbar', { name: 'Image actions' })
    await expect(floatingToolbar).toBeVisible()
    await expect(dialog.getByRole('group', { name: 'Image controls' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /^Resize image / })).toHaveCount(4)

    // ── 2. A real pointer drag changes serialized width; Reset removes it ───
    const resizedPresentation = await dragResizeHandle(page, dialog, toolbarImg)
    expect(resizedPresentation.width).toBeTruthy()
    await floatingToolbar.getByRole('button', { name: 'Reset image size' }).click()
    await expect(toolbarImg).not.toHaveAttribute('data-width', /.+/)

    // ── 3. Alt text and alignment controls update sanitized attributes ──────
    const controls = dialog.getByRole('toolbar', { name: 'Image actions' })
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
    const removeControl = dialog
      .getByRole('toolbar', { name: 'Image actions' })
      .getByRole('button', { name: 'Remove image' })
    await expect(removeControl).toBeVisible()
    const deletesBeforeRemove = routes.deletes.length
    await removeControl.click()
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

  test('scenarios 3, 5, 6, 8, and 9: crop lifecycle, persistence, palette round-trip, and responsive controls', async ({ page }) => {
    test.setTimeout(300_000)

    const email = process.env.E2E_REQUESTER_EMAIL as string
    const password = process.env.E2E_REQUESTER_PASSWORD as string
    const requestId = process.env.E2E_INLINE_REQUEST_ID as string

    await login(page, email, password)
    await expectMigrationApplied(page)

    const dialog = await openResubmitDialog(page, requestId)
    const editor = richEditor(dialog)
    await expect(editor).toBeVisible({ timeout: 20_000 })
    const submitButton = dialog.getByRole('button', { name: 'Resubmit Request', exact: true })
    const textMarkers = Object.keys(TEXT_COLOR_VALUES).map((token) => `palette-text-${token}`)
    const highlightMarkers = Object.keys(HIGHLIGHT_COLOR_VALUES).map((token) => `palette-highlight-${token}`)

    // Put palette markers into the empty tail before inserting an image. This
    // avoids replacing a selected image node when the text is typed.
    await editor.focus()
    await editor.press('Control+End')
    await editor.type(` ${[...textMarkers, ...highlightMarkers].join(' ')}`)

    // Upload, resize, and persist a non-default alt text and alignment.
    await imagePickerInput(dialog).setInputFiles(pngPath('inline-toolbar.png'))
    const editorImg = stableImages(dialog).first()
    await expect(editorImg).toBeVisible({ timeout: 20_000 })
    await expectLoadedImage(editorImg)
    const resizedPresentation = await dragResizeHandle(page, dialog, editorImg)
    await expect(editorImg).toHaveAttribute('data-width', resizedPresentation.width as string)

    const toolbar = dialog.getByRole('toolbar', { name: 'Image actions' })
    await toolbar.getByLabel('Image alt text').fill('E2E committed inline image')
    await toolbar.getByRole('button', { name: 'Align right' }).click()
    await expect(editorImg).toHaveAttribute('data-align', 'right')
    const baselinePresentation = await serializedPresentation(editorImg)

    // ── 5. Exercise every crop preset, pan, zoom, Cancel, Reset, Apply ────
    let crop = await enterCrop(dialog, editorImg)
    const cropControls = crop.getByRole('group', { name: 'Crop controls' })
    await expect(cropControls).toBeVisible()
    for (const preset of ['free', 'original', '1:1'] as const) {
      await chooseCropPreset(crop, preset)
    }
    await panCropSurface(page, crop)
    const zoomBeforeCancel = await increaseCropZoom(crop)
    expect(Number(zoomBeforeCancel)).toBeGreaterThan(1)
    for (const preset of ['4:3', '16:9'] as const) {
      await chooseCropPreset(crop, preset)
    }
    await crop.getByRole('button', { name: 'Cancel crop' }).click()
    await expect(crop).toHaveCount(0)
    expect(await serializedPresentation(editorImg)).toEqual(baselinePresentation)

    // Escape cancels a second draft without dismissing the resubmission dialog.
    crop = await enterCrop(dialog, editorImg)
    await chooseCropPreset(crop, '1:1')
    await increaseCropZoom(crop, 3)
    await page.keyboard.press('Escape')
    await expect(crop).toHaveCount(0)
    await expect(dialog).toBeVisible()
    expect(await serializedPresentation(editorImg)).toEqual(baselinePresentation)

    // ── 6. While crop is live, saving is disabled with the exact guidance. ─
    crop = await enterCrop(dialog, editorImg)
    await chooseCropPreset(crop, '1:1')
    await expect(submitButton).toBeDisabled()
    await expect(dialog.getByText(EDIT_BLOCKING_MESSAGE, { exact: true })).toBeVisible()

    // Reset returns to Original/zoom 1, then a non-full crop is applied.
    await increaseCropZoom(crop, 4)
    await crop.getByRole('button', { name: 'Reset crop' }).click()
    await expect(crop.getByRole('button', { name: 'Crop aspect original' })).toHaveAttribute('aria-pressed', 'true')
    await expect(crop.getByRole('slider', { name: 'Image zoom' })).toHaveValue('1')
    await chooseCropPreset(crop, '4:3')
    await increaseCropZoom(crop, 4)
    await panCropSurface(page, crop)
    await crop.getByRole('button', { name: 'Apply crop' }).click()
    await expect(crop).toHaveCount(0)
    await expect(submitButton).toBeEnabled()

    const savedPresentation = await serializedPresentation(editorImg)
    expect(savedPresentation.src).toBe(baselinePresentation.src)
    expect(savedPresentation.width).toBe(baselinePresentation.width)
    expect(savedPresentation.naturalWidth).toBe('320')
    expect(savedPresentation.naturalHeight).toBe('180')
    for (const value of [savedPresentation.cropX, savedPresentation.cropY, savedPresentation.cropWidth, savedPresentation.cropHeight]) {
      expect(value).toBeTruthy()
    }
    const editorCropFrame = editorImg.locator('xpath=..')
    await expect(editorCropFrame).toHaveClass(/inline-image-crop-frame/)
    const editorFrameStyle = await editorCropFrame.getAttribute('style')
    const editorCropImageStyle = await editorImg.getAttribute('style')
    expect(editorFrameStyle).toContain('aspect-ratio')
    expect(editorCropImageStyle).toContain('%')

    // ── 8. Every Calm Document token applies to semantic editor marks. ────
    const colorControls = dialog.locator('[aria-label="Text color and highlight controls"]')
    await expect(colorControls).toBeVisible()
    for (const [index, token] of Object.keys(TEXT_COLOR_VALUES).entries()) {
      await applyColorToken(page, editor, colorControls, 'text', token, textMarkers[index] as string)
    }
    for (const [index, token] of Object.keys(HIGHLIGHT_COLOR_VALUES).entries()) {
      await applyColorToken(page, editor, colorControls, 'highlight', token, highlightMarkers[index] as string)
    }
    await pasteUnsupportedColorHtml(editor)

    // ── 9. Narrow toolbar uses More and crop remains usable at 360px. ─────
    await page.setViewportSize({ width: 360, height: 800 })
    const wideColors = colorControls.locator('.rich-text-color-controls-wide')
    const compactColors = colorControls.locator('.rich-text-color-controls-compact')
    await expect(wideColors).toBeHidden()
    await expect(compactColors).toBeVisible()
    const moreFormatting = compactColors.getByRole('button', { name: 'More formatting' })
    await expect(moreFormatting).toBeVisible()
    await moreFormatting.click()
    await expect(page.locator('[aria-label="More formatting"]').last()).toBeVisible()
    await page.keyboard.press('Escape')

    crop = await enterCrop(dialog, editorImg)
    await expect(crop.getByRole('button', { name: 'Apply crop' })).toBeVisible()
    await expect(crop.getByRole('button', { name: 'Cancel crop' })).toBeVisible()
    await expect(crop.locator('.inline-image-crop-surface')).toBeVisible()
    await chooseCropPreset(crop, '1:1')
    await crop.getByRole('button', { name: 'Cancel crop' }).click()
    await expect(crop).toHaveCount(0)
    await page.setViewportSize({ width: 1280, height: 900 })

    await dialog.getByRole('button', { name: 'Resubmit Request', exact: true }).click()
    await expect(page.getByText('Request resubmitted successfully')).toBeVisible({
      timeout: 30_000,
    })

    // ── 3. Reopen and compare canonical storage plus saved crop rendering. ─
    await page.goto(`/requests/${encodeURIComponent(requestId)}`)
    const descriptionCard = page.locator('div.bg-white').filter({
      has: page.getByRole('heading', { name: 'Description', exact: true }),
    })
    const detailImg = descriptionCard.locator('span.rich-text img').first()
    await expect(detailImg).toBeVisible({ timeout: 20_000 })
    await expect(detailImg).toHaveAttribute('src', savedPresentation.src)
    await expect(detailImg).toHaveAttribute('alt', 'E2E committed inline image')
    await expectLoadedImage(detailImg)
    const savedFrame = detailImg.locator('xpath=..')
    await expect(savedFrame).toHaveAttribute('data-align', 'right')
    await expect(savedFrame).toHaveClass(/rich-text__image-frame/)
    expect(normalizedInlineStyle(await savedFrame.getAttribute('style'))).toBe(
      normalizedInlineStyle(editorFrameStyle),
    )
    expect(normalizedInlineStyle(await detailImg.getAttribute('style'))).toBe(
      normalizedInlineStyle(editorCropImageStyle),
    )
    await expectMaterializedPalette(descriptionCard)

    const imageResponse = await page.request.get(savedPresentation.src)
    expect(imageResponse.status()).toBe(200)
    expect(imageResponse.headers()['content-type'] ?? '').toMatch(/^image\//)
    expect(imageResponse.headers()['x-content-type-options'] ?? '').toBe('nosniff')
  })

  test('scenario 10: canonical private-image reads enforce 401, 403, and 200 authorization', async ({ page }) => {
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

  test('scenario 7 and 10: cropped template copies diverge independently; attachments stay independent', async ({
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

    // Commit a non-default template crop before copying it to a request.
    let templateCrop = await enterCrop(page, templateImg)
    await chooseCropPreset(templateCrop, '4:3')
    await increaseCropZoom(templateCrop, 3)
    await panCropSurface(page, templateCrop)
    await templateCrop.getByRole('button', { name: 'Apply crop' }).click()
    await expect(templateCrop).toHaveCount(0)
    const templatePresentation = await serializedPresentation(templateImg)
    expect(templatePresentation.src).toBe(templateSrc)
    expect(templatePresentation.cropWidth).toBeTruthy()
    const templateCropFrame = templateImg.locator('xpath=..')
    const templateFrameStyle = await templateCropFrame.getAttribute('style')
    const templateCropImageStyle = await templateImg.getAttribute('style')

    await page.getByRole('button', { name: 'Update Template' }).click()
    await page.waitForURL(/\/admin\/templates$/, { timeout: 30_000 })

    // The saved template still renders the same committed image after edit.
    await page.goto(editUrl)
    await expect(richEditor(page)).toBeVisible({ timeout: 20_000 })
    const reopenedImg = stableImages(page).first()
    await expect(reopenedImg).toBeVisible({ timeout: 20_000 })
    expect(await serializedPresentation(reopenedImg)).toEqual(templatePresentation)
    await expect(reopenedImg).toHaveAttribute('src', templateSrc)
    await expectLoadedImage(reopenedImg)
    expect(normalizedInlineStyle(await reopenedImg.locator('xpath=..').getAttribute('style'))).toBe(
      normalizedInlineStyle(templateFrameStyle),
    )
    expect(normalizedInlineStyle(await reopenedImg.getAttribute('style'))).toBe(
      normalizedInlineStyle(templateCropImageStyle),
    )

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
    expect(await serializedPresentation(formImg)).toEqual(templatePresentation)

    // A request crop changes only the copied presentation; the private image
    // URL remains shared with the template.
    const requestCrop = await enterCrop(page, formImg)
    await chooseCropPreset(requestCrop, '1:1')
    await increaseCropZoom(requestCrop, 2)
    await requestCrop.getByRole('button', { name: 'Apply crop' }).click()
    await expect(requestCrop).toHaveCount(0)
    const requestPresentation = await serializedPresentation(formImg)
    expect(requestPresentation.src).toBe(templatePresentation.src)
    expect(requestPresentation).not.toEqual(templatePresentation)
    expect(
      [requestPresentation.cropX, requestPresentation.cropY, requestPresentation.cropWidth, requestPresentation.cropHeight],
    ).not.toEqual([
      templatePresentation.cropX,
      templatePresentation.cropY,
      templatePresentation.cropWidth,
      templatePresentation.cropHeight,
    ])
    const requestCropFrame = formImg.locator('xpath=..')
    const requestFrameStyle = await requestCropFrame.getAttribute('style')
    const requestCropImageStyle = await formImg.getAttribute('style')

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
    const createdImg = createdDialog.locator(`img[src="${templateSrc}"]`).first()
    await expect(createdImg).toBeVisible()
    await expectLoadedImage(createdImg)
    const createdFrame = createdImg.locator('xpath=..')
    await expect(createdFrame).toHaveClass(/rich-text__image-frame/)
    expect(normalizedInlineStyle(await createdFrame.getAttribute('style'))).toBe(
      normalizedInlineStyle(requestFrameStyle),
    )
    expect(normalizedInlineStyle(await createdImg.getAttribute('style'))).toBe(
      normalizedInlineStyle(requestCropImageStyle),
    )

    // Request edits must not mutate the source template's crop metadata.
    await page.context().clearCookies()
    await login(page, adminEmail, adminPassword)
    await page.goto(editUrl)
    await expect(richEditor(page)).toBeVisible({ timeout: 20_000 })
    const templateAfterRequest = stableImages(page).first()
    await expect(templateAfterRequest).toBeVisible({ timeout: 20_000 })
    expect(await serializedPresentation(templateAfterRequest)).toEqual(templatePresentation)
    await expect(templateAfterRequest).toHaveAttribute('src', templateSrc)
  })
})
