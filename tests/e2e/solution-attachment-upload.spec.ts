import { test, expect, type Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'

/**
 * Logged-in solution attachment upload E2E — release gate.
 *
 * Covers the deterministic upload-reliability matrix from the
 * solution-upload-reliability plan:
 *  - accepted-size uploads: 512 KB, 2.1 MB, 9.5 MB boundary, plus a
 *    Thai-named PDF;
 *  - oversized (10 MB + 1 byte) client-side rejection with NO upload request;
 *  - partial-upload-failure resilience (second upload returns 500) and retry;
 *  - a single real final solution submission;
 *  - Thai filename `Content-Disposition` carrying `filename*=UTF-8''`
 *    (RFC 5987) for both inline preview and attachment download;
 *  - attachment access control: signed-out request → 401, and an unrelated
 *    general-department user without request visibility → 403.
 *
 * Deterministic fixtures are generated at runtime with pdf-lib and padded to
 * exact byte sizes by appending trailing bytes after the PDF %%EOF (ignored by
 * every conformant PDF reader). Fixtures live in the OS temp dir, are never
 * committed, and are removed in afterAll.
 *
 * This is a RELEASE GATE: it never silently skips. All six environment
 * variables are required up front; a missing variable throws a clear setup
 * error so the gate fails loudly instead of passing vacuously.
 *
 * Implementation note (no live run during build): no disposable dataset or
 * external TEST_BASE_URL was supplied, so the live gate is exercised only via
 * `playwright test --list`, `tsc --noEmit`, and `npm run check` here. The live
 * gate remains PENDING a disposable target.
 */

const REQUIRED_ENV = [
  'TEST_BASE_URL',
  'E2E_ENGINEERING_EMAIL',
  'E2E_ENGINEERING_PASSWORD',
  'E2E_SENT_TO_ENGINEER_REQUEST_ID',
  'E2E_UNRELATED_EMAIL',
  'E2E_UNRELATED_PASSWORD',
] as const

const KB = 1024
const MB = 1024 * KB
/** Mirrors src/lib/attachments/policy.ts MAX_ATTACHMENT_BYTES (10 MB). */
const MAX_ATTACHMENT_BYTES = 10 * MB

const FIXTURE_DIR = join(tmpdir(), 'e2e-solution-upload')
const FIXTURES = {
  small: { name: 'small-512k.pdf', bytes: 512 * KB },
  medium: { name: 'medium-2.1m.pdf', bytes: Math.round(2.1 * MB) },
  boundary: { name: 'boundary-9.5m.pdf', bytes: Math.round(9.5 * MB) },
  thai: { name: 'เอกสาร-ไทย.pdf', bytes: 512 * KB },
  oversized: { name: 'oversized-10m-plus1.pdf', bytes: MAX_ATTACHMENT_BYTES + 1 },
} as const

const createdPaths: string[] = []

/**
 * Build a valid PDF and pad it to an exact byte size. A blank page is added so
 * the file is a structurally valid PDF; trailing zero bytes after %%EOF are
 * ignored by conformant readers, so the on-disk size is deterministic while the
 * file remains a valid PDF for the upload pipeline.
 */
async function createPaddedPdf(filePath: string, targetBytes: number): Promise<void> {
  const doc = await PDFDocument.create()
  doc.addPage()
  const pdfBytes = await doc.save()
  const padding = Math.max(0, targetBytes - pdfBytes.byteLength)
  await writeFile(filePath, Buffer.concat([Buffer.from(pdfBytes), Buffer.alloc(padding)]))
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
      `[solution-attachment-upload] Missing required E2E environment variable(s): ${missing.join(', ')}. ` +
        'This release gate does not skip — supply all six variables to run it ' +
        '(TEST_BASE_URL, E2E_ENGINEERING_EMAIL, E2E_ENGINEERING_PASSWORD, ' +
        'E2E_SENT_TO_ENGINEER_REQUEST_ID, E2E_UNRELATED_EMAIL, E2E_UNRELATED_PASSWORD).'
    )
  }

  await mkdir(FIXTURE_DIR, { recursive: true })
  for (const key of Object.keys(FIXTURES) as Array<keyof typeof FIXTURES>) {
    const { name, bytes } = FIXTURES[key]
    const filePath = join(FIXTURE_DIR, name)
    await createPaddedPdf(filePath, bytes)
    createdPaths.push(filePath)
  }
})

test.afterAll(async () => {
  await Promise.all(createdPaths.map((filePath) => rm(filePath, { force: true })))
  await rm(FIXTURE_DIR, { recursive: true, force: true })
})

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in')
  await page.locator('input#email').fill(email)
  await page.locator('input#password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/(dashboard|engineering)\b/, { timeout: 20_000 })
}

test.describe('Logged-in solution attachment upload (release gate)', () => {
  test('engineering user uploads solution attachments across the reliability matrix', async ({ page }) => {
    test.setTimeout(240_000)

    const engineeringEmail = process.env.E2E_ENGINEERING_EMAIL as string
    const engineeringPassword = process.env.E2E_ENGINEERING_PASSWORD as string
    const requestId = process.env.E2E_SENT_TO_ENGINEER_REQUEST_ID as string
    const unrelatedEmail = process.env.E2E_UNRELATED_EMAIL as string
    const unrelatedPassword = process.env.E2E_UNRELATED_PASSWORD as string

    const solutionPath = `/engineering/solutions/${requestId}`

    // ── Login + navigate to the solution submission page ───────────────
    await login(page, engineeringEmail, engineeringPassword)
    await page.goto(solutionPath)
    await expect(page.getByRole('heading', { name: 'Submit Solution' })).toBeVisible()

    // The form requires title + description to reach the preview step.
    await page.locator('input[name="title"]').fill('E2E reliability matrix solution')
    await page
      .locator('textarea[name="description"]')
      .fill('Deterministic solution attachment upload reliability verification.')

    const fileInput = page.locator('input#solution-file-upload')

    // ── Route instrumentation ──────────────────────────────────────────
    // Server Actions POST to the current page URL. Uploads carry a File, so
    // Next serializes them as multipart/form-data; the metadata submit
    // (submitSolution) passes only JSON-serializable args (string IDs/fields)
    // and is serialized as text/plain — it never carries a File. This
    // content-type discriminator targets uploads precisely and never the
    // metadata submit, exactly as the brief requires.
    type UploadOutcome = { kind: 'pass' | 'forced-500'; status: number }
    const uploadOutcomes: UploadOutcome[] = []
    // Metadata submits (submitSolution) are POSTs whose body is JSON-serializable
    // (no File) → serialized as text/plain, never multipart. Counting them lets
    // the spec assert that Retry never submits metadata and that exactly one
    // real submission happens on the final Confirm.
    let metadataPostCount = 0
    const routeState = {
      uploadSeq: 0,
      failSecondUpload: false,
    }

    await page.route(`**/engineering/solutions/${requestId}`, async (route) => {
      const request = route.request()
      if (request.method() !== 'POST') {
        await route.continue()
        return
      }
      const contentType = request.headers()['content-type'] ?? ''
      if (!contentType.includes('multipart/form-data')) {
        // Metadata submit (submitSolution).
        metadataPostCount += 1
        await route.continue()
        return
      }
      // Upload Server Action (carries a File).
      routeState.uploadSeq += 1
      if (routeState.failSecondUpload && routeState.uploadSeq === 2) {
        uploadOutcomes.push({ kind: 'forced-500', status: 500 })
        await route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'Simulated upload failure (E2E partial-failure scenario)',
        })
        return
      }
      const response = await route.fetch()
      uploadOutcomes.push({ kind: 'pass', status: response.status() })
      await route.fulfill({ response })
    })

    // ── PHASE 1: oversized fixture is rejected client-side, no upload ──
    await fileInput.setInputFiles(join(FIXTURE_DIR, FIXTURES.oversized.name))
    await expect(page.getByText(/exceeds 10MB/i)).toBeVisible()
    expect(
      uploadOutcomes,
      'oversized fixture must not trigger an upload request'
    ).toHaveLength(0)

    // ── PHASE 2: select every accepted fixture ─────────────────────────
    await fileInput.setInputFiles([
      join(FIXTURE_DIR, FIXTURES.small.name),
      join(FIXTURE_DIR, FIXTURES.medium.name),
      join(FIXTURE_DIR, FIXTURES.boundary.name),
      join(FIXTURE_DIR, FIXTURES.thai.name),
    ])
    await expect(page.getByText(FIXTURES.small.name)).toBeVisible()

    // ── PHASE 3: partial failure — second upload (medium) returns 500 ──
    routeState.uploadSeq = 0
    routeState.failSecondUpload = true
    await page.getByRole('button', { name: 'Review & Submit' }).click()
    await expect(page.getByRole('button', { name: 'Confirm & Submit' })).toBeVisible()
    // Snapshot the upload count before the confirm so we can assert the batch
    // continued past the forced 500 (later items still uploaded).
    const uploadCountBeforeConfirm = uploadOutcomes.length
    await page.getByRole('button', { name: 'Confirm & Submit' }).click()
    // The batch catches the forced 500: the failed item reaches a terminal
    // `error` state (never stuck `uploading`), the later items still upload, and
    // the batch returns { success:false }. No metadata submit is attempted.
    expect(metadataPostCount, 'no metadata submit on upload failure').toBe(0)
    // The form returns to the edit view so the failed item is visibly errored
    // with its Retry action. The failed filename stays in the list.
    await expect(page.getByText(FIXTURES.medium.name)).toBeVisible()
    // The errored item exposes a Retry action (distinct from Confirm).
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    expect(
      uploadOutcomes.some((outcome) => outcome.kind === 'forced-500'),
      'the second upload request was answered with a 500'
    ).toBeTruthy()
    // The batch continued past the failure: all four uploads were attempted
    // during the confirm (3 passed + 1 forced-500), not aborted at item two.
    expect(
      uploadOutcomes.length - uploadCountBeforeConfirm,
      'the batch attempted all four uploads despite the mid-batch 500'
    ).toBe(4)

    // ── PHASE 4: retry the failed item — only it is re-uploaded, no commit ─
    // Retry calls ensureUploaded(), which reuses the three prior successes and
    // re-uploads ONLY the errored item — exactly one upload POST, no metadata.
    routeState.failSecondUpload = false
    const uploadCountBeforeRetry = uploadOutcomes.length
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect.poll(
      () => uploadOutcomes.length,
      { timeout: 30_000, message: 'only the failed item was re-uploaded by Retry' }
    ).toBe(uploadCountBeforeRetry + 1)
    expect(metadataPostCount, 'no metadata submit during retry').toBe(0)

    // ── PHASE 5: return to preview — all items Ready, still no commit ──
    await expect(page.getByRole('button', { name: 'Review & Submit' })).toBeEnabled()
    await page.getByRole('button', { name: 'Review & Submit' }).click()
    await expect(page.getByRole('button', { name: 'Confirm & Submit' })).toBeVisible()
    // All four accepted fixtures now show the Ready badge on the preview.
    await expect(page.getByText('Ready', { exact: true })).toHaveCount(4, {
      timeout: 30_000,
    })
    expect(metadataPostCount, 'no metadata submit before the final confirm').toBe(0)

    // ── PHASE 6: final real submission — exactly one metadata submit ──
    await page.getByRole('button', { name: 'Confirm & Submit' }).click()
    await expect(page).toHaveURL((url) => url.pathname === '/engineering', {
      timeout: 60_000,
    })
    expect(metadataPostCount, 'exactly one metadata submit on the final confirm').toBe(1)

    // Global upload assertions: no 413, and the only 500 was the intentional
    // partial-failure one (no passing upload returned a server error).
    expect(
      uploadOutcomes.some((outcome) => outcome.status === 413),
      'no upload returned 413'
    ).toBeFalsy()
    expect(
      uploadOutcomes.filter((outcome) => outcome.kind === 'pass' && outcome.status >= 500),
      'no passing upload returned 500'
    ).toHaveLength(0)
    expect(
      uploadOutcomes.filter((outcome) => outcome.kind === 'forced-500'),
      'exactly one intentional partial-failure 500'
    ).toHaveLength(1)

    // ── PHASE 7: capture the Thai attachment id from the request detail ──
    await page.goto(`/requests/${requestId}`)
    await expect(page.getByText('Solution Attachments')).toBeVisible()
    const thaiFilename = FIXTURES.thai.name
    const capturedId = await page.evaluate((filename: string) => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[download]'))
      const match = links.find((link) => {
        if (link.getAttribute('download') !== filename) return false
        return (link.getAttribute('href') ?? '').includes('/api/files/download')
      })
      if (!match) return null
      const href = match.getAttribute('href') ?? ''
      try {
        return new URL(href, window.location.origin).searchParams.get('id')
      } catch {
        return null
      }
    }, thaiFilename)
    expect(capturedId, 'captured the Thai attachment id from the request detail').toBeTruthy()
    const attachmentId = capturedId as string
    const previewUrl = `/api/files/download?id=${encodeURIComponent(attachmentId)}&disposition=inline`
    const downloadUrl = `/api/files/download?id=${encodeURIComponent(attachmentId)}&disposition=attachment`

    // ── PHASE 8: Thai filename Content-Disposition (preview + download) ──
    const previewResponse = await page.request.get(previewUrl)
    expect(previewResponse.status()).toBe(200)
    expect(
      (previewResponse.headers()['content-disposition'] ?? '').toLowerCase()
    ).toContain("filename*=utf-8''")

    const downloadResponse = await page.request.get(downloadUrl)
    expect(downloadResponse.status()).toBe(200)
    expect(
      (downloadResponse.headers()['content-disposition'] ?? '').toLowerCase()
    ).toContain("filename*=utf-8''")

    // ── PHASE 9: signed-out denial (401) ──────────────────────────────
    await page.context().clearCookies()
    const deniedResponse = await page.request.get(downloadUrl)
    expect(deniedResponse.status()).toBe(401)

    // ── PHASE 10: unrelated general-department user denial (403) ─────
    await login(page, unrelatedEmail, unrelatedPassword)
    const forbiddenResponse = await page.request.get(downloadUrl)
    expect(forbiddenResponse.status()).toBe(403)
  })
})
