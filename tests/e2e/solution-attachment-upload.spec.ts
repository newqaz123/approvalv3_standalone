import { test, expect, type Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'

/**
 * Logged-in solution attachment upload E2E — release gate.
 *
 * Covers the eager-staged upload choreography (staged XHR solution
 * attachments) for the solution-upload-reliability matrix:
 *  - oversized (10 MB + 1 byte) client-side rejection with NO stage request;
 *  - eager staging on selection: per file a PUT reserve plus a real
 *    `xhr.upload.onprogress` POST to /api/attachments/stage, rendering the
 *    live byte percent, the per-file `Uploaded` state and the N/M
 *    `files ready` counter while uploads are still in flight;
 *  - Review & Submit / Confirm & Submit enabled only when every staged item
 *    is ready (never while a reserve/upload is in flight or an item errored);
 *  - remove of a staged file issues the scoped draft DELETE;
 *  - a forced /api/attachments/stage upload failure surfaces the item error
 *    with its Retry action, and Retry re-stages only that item (one reserve +
 *    one upload) without ever submitting metadata;
 *  - a single real final submission whose metadata submit carries exactly the
 *    staged ready attachment IDs (fileIds) — no submit-time batch upload and
 *    no cleanup traffic on the confirm path (the legacy submit-time
 *    ensureUploaded batch no longer exists on this surface);
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
 * Implementation note (no live run during this rework): the live gate is
 * exercised during Task 5 browser verification against the isolated worktree
 * server; here the spec is validated via `playwright test --list`,
 * `tsc --noEmit`, and `npm run check`.
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
    // The description is the TipTap rich-text editor surface; this mirrors the
    // `.rich-text[role="textbox"]` convention of inline-description-images.spec.ts.
    const descriptionEditor = page.locator('.rich-text[role="textbox"]').first()
    await expect(descriptionEditor).toBeVisible({ timeout: 20_000 })
    await descriptionEditor.click()
    await descriptionEditor.type('Deterministic solution attachment upload reliability verification.')

    const fileInput = page.locator('input#solution-file-upload')

    // ── Route instrumentation ──────────────────────────────────────────
    // Staged uploads go to /api/attachments/stage: PUT (JSON reservation) →
    // XHR POST (multipart, real upload.onprogress) → DELETE (scoped draft
    // cleanup). The only other POST on this surface is the submitSolution
    // Server Action metadata submit, which passes only JSON-serializable args
    // (string IDs/fields, no File) and is serialized as text/plain to the
    // page URL. That split lets the spec observe staging precisely and pin
    // exactly one metadata submit — carrying the staged ready IDs — on the
    // final Confirm.
    type StageUploadOutcome = { kind: 'pass' | 'forced-500'; status: number }
    const stageUploadOutcomes: StageUploadOutcome[] = []
    // postData() bodies of metadata submits (submitSolution). Counting them
    // lets the spec assert that staging, removal and Retry never submit
    // metadata and that exactly one real submission happens on the final
    // Confirm, carrying the staged ready attachment IDs.
    const metadataSubmits: string[] = []
    // attachmentId → fileName for every draft reserved via PUT and not yet
    // DELETEd. At confirm time this is exactly the ready staged set.
    const stagedDraftById = new Map<string, string>()
    const removedDraftIds = new Set<string>()
    const routeState = {
      reserveSeq: 0,
      stageUploadSeq: 0,
      stageDeleteSeq: 0,
      /** Holds each staged upload response so in-flight states are observable. */
      stageUploadDelayMs: 0,
      /** Fulfills the next staged upload POST with a 500 (forced failure). */
      failNextStageUpload: false,
    }

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

    await page.route(`**/engineering/solutions/${requestId}`, async (route) => {
      const request = route.request()
      if (request.method() !== 'POST') {
        await route.continue()
        return
      }
      // Metadata submit (submitSolution) — staging uploads never hit this URL.
      metadataSubmits.push(request.postData() ?? '')
      await route.continue()
    })

    await page.route('**/api/attachments/stage', async (route) => {
      const request = route.request()
      const method = request.method()
      if (method === 'PUT') {
        routeState.reserveSeq += 1
        const response = await route.fetch()
        try {
          const body = JSON.parse(await response.text()) as { attachmentId?: string }
          const requestFile = JSON.parse(request.postData() ?? '{}') as { fileName?: string }
          if (body.attachmentId) {
            stagedDraftById.set(body.attachmentId, requestFile.fileName ?? 'unknown')
          }
        } catch {
          // Bookkeeping must never break the pass-through.
        }
        await route.fulfill({ response })
        return
      }
      if (method === 'DELETE') {
        routeState.stageDeleteSeq += 1
        try {
          const body = JSON.parse(request.postData() ?? '{}') as { attachmentId?: string }
          if (body.attachmentId) {
            removedDraftIds.add(body.attachmentId)
            stagedDraftById.delete(body.attachmentId)
          }
        } catch {
          // Bookkeeping must never break the pass-through.
        }
        const response = await route.fetch()
        await route.fulfill({ response })
        return
      }
      if (method !== 'POST') {
        await route.continue()
        return
      }
      // XHR staged upload.
      routeState.stageUploadSeq += 1
      if (routeState.failNextStageUpload) {
        routeState.failNextStageUpload = false
        stageUploadOutcomes.push({ kind: 'forced-500', status: 500 })
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Simulated staged upload failure (E2E partial-failure scenario)',
          }),
        })
        return
      }
      if (routeState.stageUploadDelayMs > 0) await sleep(routeState.stageUploadDelayMs)
      const response = await route.fetch()
      stageUploadOutcomes.push({ kind: 'pass', status: response.status() })
      await route.fulfill({ response })
    })

    // ── PHASE 1: oversized fixture is rejected client-side, no request ──
    await fileInput.setInputFiles(join(FIXTURE_DIR, FIXTURES.oversized.name))
    await expect(page.getByText(/exceeds 10MB/i)).toBeVisible()
    expect(
      routeState.reserveSeq + routeState.stageUploadSeq,
      'oversized fixture must not trigger a stage request'
    ).toBe(0)
    expect(
      metadataSubmits,
      'oversized fixture must not trigger a metadata submit'
    ).toHaveLength(0)

    // ── PHASE 2: select every accepted fixture — eager staged XHR uploads ─
    // Hold each staged upload response for a moment so the in-flight states
    // (real byte percent, readiness counter, submit gating) are observable
    // instead of racy on a fast local connection.
    routeState.stageUploadDelayMs = 6_000
    await fileInput.setInputFiles([
      join(FIXTURE_DIR, FIXTURES.small.name),
      join(FIXTURE_DIR, FIXTURES.medium.name),
      join(FIXTURE_DIR, FIXTURES.boundary.name),
      join(FIXTURE_DIR, FIXTURES.thai.name),
    ])
    await expect(page.getByText(FIXTURES.small.name)).toBeVisible()

    const reviewButton = page.getByRole('button', { name: 'Review & Submit' })
    // Eager staging means uploads are already in flight right after selection:
    // the live byte percent renders, the counter shows 0 of 4 ready, and
    // Review & Submit is blocked until every staged item is ready.
    await expect(reviewButton).toBeDisabled()
    await expect(page.getByText('0/4 files ready')).toBeVisible()
    await expect(page.getByText(/\d+%$/).first()).toBeVisible({ timeout: 5_000 })
    expect(metadataSubmits, 'no metadata submit while staging').toHaveLength(0)

    // Every item reaches the Uploaded state and the counter settles at 4/4.
    await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(4, {
      timeout: 30_000,
    })
    await expect(page.getByText('4/4 files ready')).toBeVisible()
    await expect(reviewButton).toBeEnabled()

    // ── PHASE 3: remove one staged file — scoped draft DELETE, no submit ──
    const mediumRow = page
      .locator('div.flex.items-center.gap-3.p-3.border.rounded-lg.bg-white')
      .filter({ hasText: FIXTURES.medium.name })
    await mediumRow.getByRole('button').last().click()
    await expect(page.getByText(FIXTURES.medium.name)).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('3/3 files ready')).toBeVisible()
    expect(metadataSubmits, 'removal never submits metadata').toHaveLength(0)

    // ── PHASE 4: forced staged-upload failure → item error + Retry ─────
    // Re-add the removed file with its upload POST forced to 500. Only that
    // item errors: the three untouched items stay Uploaded, the counter shows
    // 3 of 4 ready, Review & Submit stays blocked, and no metadata is sent.
    routeState.failNextStageUpload = true
    await fileInput.setInputFiles(join(FIXTURE_DIR, FIXTURES.medium.name))
    await expect(page.getByText(/Simulated staged upload failure/)).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(3)
    await expect(page.getByText('3/4 files ready')).toBeVisible()
    await expect(reviewButton).toBeDisabled()
    const retryButton = page.getByRole('button', { name: 'Retry' })
    await expect(retryButton).toBeVisible()
    expect(
      stageUploadOutcomes.filter((outcome) => outcome.kind === 'forced-500'),
      'the staged upload request was answered with a 500'
    ).toHaveLength(1)
    expect(metadataSubmits, 'no metadata submit on staged-upload failure').toHaveLength(0)

    // ── PHASE 5: retry re-stages only the failed item, no commit ───────
    // Retry re-runs the reserve + upload XHR for the errored item under the
    // same stable attachmentId — exactly one PUT and one POST, no metadata.
    routeState.failNextStageUpload = false
    const reserveSeqBeforeRetry = routeState.reserveSeq
    const stageUploadSeqBeforeRetry = routeState.stageUploadSeq
    await retryButton.click()
    await expect.poll(
      () => routeState.stageUploadSeq,
      { timeout: 30_000, message: 'only the failed item was re-staged by Retry' }
    ).toBe(stageUploadSeqBeforeRetry + 1)
    expect(routeState.reserveSeq, 'Retry re-reserves the same item').toBe(
      reserveSeqBeforeRetry + 1
    )
    await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(4, {
      timeout: 30_000,
    })
    await expect(page.getByText('4/4 files ready')).toBeVisible()
    await expect(reviewButton).toBeEnabled()

    // ── PHASE 6: preview — all items Ready, still zero metadata submits ──
    expect(
      stagedDraftById.size,
      'exactly the four ready staged drafts are reserved'
    ).toBe(4)
    await reviewButton.click()
    const confirmButton = page.getByRole('button', { name: 'Confirm & Submit' })
    await expect(confirmButton).toBeVisible()
    await expect(confirmButton).toBeEnabled()
    // All four accepted fixtures now show the Ready badge on the preview.
    await expect(page.getByText('Ready', { exact: true })).toHaveCount(4)
    expect(metadataSubmits, 'no metadata submit before the final confirm').toHaveLength(0)
    const stageCountsBeforeConfirm = {
      reserve: routeState.reserveSeq,
      upload: routeState.stageUploadSeq,
      remove: routeState.stageDeleteSeq,
    }

    // ── PHASE 7: final real submission — one submit carrying staged IDs ──
    await confirmButton.click()
    await expect(page).toHaveURL((url) => url.pathname === '/engineering', {
      timeout: 60_000,
    })
    expect(metadataSubmits, 'exactly one metadata submit on the final confirm').toHaveLength(1)
    // Submit-time staging is gone: the confirm triggers no reserve, upload or
    // cleanup traffic — it only adopts the already-staged drafts.
    expect(routeState.reserveSeq).toBe(stageCountsBeforeConfirm.reserve)
    expect(routeState.stageUploadSeq).toBe(stageCountsBeforeConfirm.upload)
    expect(routeState.stageDeleteSeq).toBe(stageCountsBeforeConfirm.remove)
    // The single metadata submit carries exactly the staged ready attachment
    // IDs (fileIds) and none of the removed draft IDs.
    const submitBody = metadataSubmits[0]
    expect(submitBody, 'submit passes the fileIds argument').toContain('fileIds')
    for (const [attachmentId, fileName] of stagedDraftById) {
      expect(submitBody, `staged id for ${fileName} passed to submitSolution`).toContain(
        attachmentId
      )
    }
    for (const removedId of removedDraftIds) {
      expect(submitBody, 'removed draft id is not submitted').not.toContain(removedId)
    }

    // Global staged-upload assertions: no 413 (the oversized fixture was
    // rejected client-side before any request), and the only 5xx was the
    // intentional forced stage failure (no passing upload returned a server
    // error).
    expect(
      stageUploadOutcomes.some((outcome) => outcome.status === 413),
      'no staged upload returned 413'
    ).toBeFalsy()
    expect(
      stageUploadOutcomes.filter((outcome) => outcome.kind === 'pass' && outcome.status >= 500),
      'no passing staged upload returned a server error'
    ).toHaveLength(0)
    expect(
      stageUploadOutcomes.filter((outcome) => outcome.kind === 'forced-500'),
      'exactly one intentional staged-upload failure'
    ).toHaveLength(1)

    // ── PHASE 8: capture the Thai attachment id from the request detail ──
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

    // ── PHASE 9: Thai filename Content-Disposition (preview + download) ──
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

    // ── PHASE 10: signed-out denial (401) ─────────────────────────────
    await page.context().clearCookies()
    const deniedResponse = await page.request.get(downloadUrl)
    expect(deniedResponse.status()).toBe(401)

    // ── PHASE 11: unrelated general-department user denial (403) ─────
    await login(page, unrelatedEmail, unrelatedPassword)
    const forbiddenResponse = await page.request.get(downloadUrl)
    expect(forbiddenResponse.status()).toBe(403)
  })
})
