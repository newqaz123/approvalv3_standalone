import { test, expect, type Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'

/**
 * Logged-in solution attachment upload E2E — release gate.
 *
 * Enters through the active modal flow (engineering dashboard row →
 * CompletedRequestModal → SubmitterModal(mode="solution")) and covers the
 * eager-staged upload choreography (staged XHR solution attachments) for the
 * solution-upload-reliability matrix:
 *  - oversized (10 MB + 1 byte) client-side rejection with NO stage request;
 *  - eager staging on selection: per file a PUT reserve plus a real
 *    `xhr.upload.onprogress` POST to /api/attachments/stage, rendering the
 *    live byte percent, the per-file `Uploaded` state and the N/M
 *    `files ready` counter while uploads are still in flight;
 *  - the solution modal's Submit Solution action enabled only when every
 *    staged item is ready (never while a reserve/upload is in flight or an
 *    item errored);
 *  - remove of a staged file issues the scoped draft DELETE;
 *  - a forced /api/attachments/stage upload failure surfaces the item error
 *    with its Retry action, and Retry re-stages only that item (one reserve +
 *    one upload) without ever submitting metadata;
 *  - a single real final submission from the modal whose metadata submit
 *    carries exactly the staged ready attachment IDs (fileIds) — no
 *    submit-time batch upload and no cleanup traffic on the submit path (the
 *    legacy submit-time ensureUploaded batch no longer exists on this
 *    surface);
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
 * Implementation note (validation): the modal-flow migration was verified via
 * `playwright test --list` discovery and `npm run check`; the live gate needs
 * the six environment variables plus a healthy managed server and was not
 * executed during this migration.
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

    // ── Login + open the solution modal from the engineering dashboard ──
    await login(page, engineeringEmail, engineeringPassword)
    await page.goto('/engineering')
    const engineeringRow = page.locator(
      `[data-testid="engineering-request-row"][data-request-id="${requestId}"]`,
    )
    await expect(engineeringRow).toBeVisible({ timeout: 20_000 })
    await engineeringRow.getByRole('button', { name: /Submit solution/i }).click()

    const requestDialog = page.getByRole('dialog').last()
    await expect(requestDialog).toBeVisible({ timeout: 20_000 })
    await requestDialog.getByRole('button', { name: 'Submit Solution' }).click()

    const solutionDialog = page
      .getByRole('dialog')
      .filter({ hasText: 'Submit Engineering Solution' })
    await expect(solutionDialog).toBeVisible({ timeout: 20_000 })

    // The modal form requires title + description to enable submission.
    await solutionDialog.locator('#solutionTitle').fill('E2E reliability matrix solution')
    // The description is the TipTap rich-text editor surface; this mirrors the
    // `.rich-text[role="textbox"]` convention of inline-description-images.spec.ts.
    const descriptionEditor = solutionDialog.locator('.rich-text[role="textbox"]')
    await descriptionEditor.click()
    await descriptionEditor.type('Deterministic solution attachment upload reliability verification.')
    await solutionDialog.locator('#cost').fill('50000')
    await solutionDialog.locator('#timeline').fill('2 weeks')
    const fileInput = solutionDialog
      .locator('label')
      .filter({ hasText: 'Click to upload files' })
      .locator('input[type="file"]')

    // Inspecting the original request must open the canonical deep link in a
    // new tab so it never resets the in-progress solution draft.
    await expect(solutionDialog.getByRole('link', { name: /View Original Request/ })).toHaveAttribute(
      'href',
      `/requests?requestId=${encodeURIComponent(requestId)}`,
    )

    // ── Instrumentation ────────────────────────────────────────────────
    // Staged uploads go to /api/attachments/stage: PUT (JSON reservation) →
    // XHR POST (multipart, real upload.onprogress) → DELETE (scoped draft
    // cleanup). The submitSolution metadata submit is a Next.js Server Action
    // POST carrying a `next-action` header with only JSON-serializable args
    // (string IDs/fields, no File); observing the header instead of a route
    // URL keeps the count independent of the page URL. That split lets the
    // spec observe staging precisely and pin exactly one metadata submit —
    // carrying the staged ready IDs — on the final modal submit.
    type StageUploadOutcome = { kind: 'pass' | 'forced-500'; status: number }
    const stageUploadOutcomes: StageUploadOutcome[] = []
    // postData() bodies of metadata submits (submitSolution). Counting them
    // lets the spec assert that staging, removal and Retry never submit
    // metadata and that exactly one real submission happens on the final
    // modal submit, carrying the staged ready attachment IDs.
    const metadataSubmits: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) {
        metadataSubmits.push(request.postData() ?? '')
      }
    })
    // attachmentId → fileName for every draft reserved via PUT and not yet
    // DELETEd. At submit time this is exactly the ready staged set, and the
    // committed attachment keeps the reserved draft's ID after adoption.
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
    await expect(solutionDialog.getByText(/exceeds 10MB/i)).toBeVisible()
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
    await expect(solutionDialog.getByText(FIXTURES.small.name)).toBeVisible()

    const submitButton = solutionDialog.getByRole('button', { name: 'Submit Solution' })
    // Eager staging means uploads are already in flight right after selection:
    // the live byte percent renders, the counter shows 0 of 4 ready, and
    // Submit Solution is blocked until every staged item is ready.
    await expect(submitButton).toBeDisabled()
    await expect(solutionDialog.getByText('0/4 files ready')).toBeVisible()
    await expect(solutionDialog.getByText(/\d+%$/).first()).toBeVisible({ timeout: 5_000 })
    expect(metadataSubmits, 'no metadata submit while staging').toHaveLength(0)

    // Every item reaches the Uploaded state and the counter settles at 4/4.
    await expect(solutionDialog.getByText('Uploaded', { exact: true })).toHaveCount(4, {
      timeout: 30_000,
    })
    await expect(solutionDialog.getByText('4/4 files ready')).toBeVisible()
    await expect(submitButton).toBeEnabled()

    // ── PHASE 3: remove one staged file — scoped draft DELETE, no submit ──
    const mediumRow = solutionDialog
      .locator('div.flex.items-start.gap-3.p-3.border.rounded-lg.bg-white')
      .filter({ hasText: FIXTURES.medium.name })
    await mediumRow.getByRole('button').last().click()
    await expect(solutionDialog.getByText(FIXTURES.medium.name)).toBeHidden({ timeout: 15_000 })
    await expect(solutionDialog.getByText('3/3 files ready')).toBeVisible()
    expect(metadataSubmits, 'removal never submits metadata').toHaveLength(0)

    // ── PHASE 4: forced staged-upload failure → item error + Retry ─────
    // Re-add the removed file with its upload POST forced to 500. Only that
    // item errors: the three untouched items stay Uploaded, the counter shows
    // 3 of 4 ready, Submit Solution stays blocked, and no metadata is sent.
    routeState.failNextStageUpload = true
    await fileInput.setInputFiles(join(FIXTURE_DIR, FIXTURES.medium.name))
    await expect(solutionDialog.getByText(/Simulated staged upload failure/)).toBeVisible({
      timeout: 15_000,
    })
    await expect(solutionDialog.getByText('Uploaded', { exact: true })).toHaveCount(3)
    await expect(solutionDialog.getByText('3/4 files ready')).toBeVisible()
    await expect(submitButton).toBeDisabled()
    const retryButton = solutionDialog.getByRole('button', { name: 'Retry' })
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
    await expect(solutionDialog.getByText('Uploaded', { exact: true })).toHaveCount(4, {
      timeout: 30_000,
    })
    await expect(solutionDialog.getByText('4/4 files ready')).toBeVisible()
    await expect(submitButton).toBeEnabled()

    // ── PHASE 6: final real submission from the modal — one submit ─────
    expect(
      stagedDraftById.size,
      'exactly the four ready staged drafts are reserved'
    ).toBe(4)
    expect(metadataSubmits, 'no metadata submit before the final submit').toHaveLength(0)
    const stageCountsBeforeSubmit = {
      reserve: routeState.reserveSeq,
      upload: routeState.stageUploadSeq,
      remove: routeState.stageDeleteSeq,
    }
    await submitButton.click()
    await expect(page.getByText('Solution submitted successfully')).toBeVisible({ timeout: 60_000 })
    await expect(solutionDialog).toBeHidden({ timeout: 20_000 })
    expect(metadataSubmits, 'exactly one metadata submit').toHaveLength(1)
    // Submit-time staging is gone: the modal submit triggers no reserve,
    // upload or cleanup traffic — it only adopts the already-staged drafts.
    expect(routeState.reserveSeq).toBe(stageCountsBeforeSubmit.reserve)
    expect(routeState.stageUploadSeq).toBe(stageCountsBeforeSubmit.upload)
    expect(routeState.stageDeleteSeq).toBe(stageCountsBeforeSubmit.remove)
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

    // ── PHASE 7: capture the Thai attachment id from the reservation map ─
    // Adoption keeps the reserved draft's ID, so the committed attachment is
    // addressable without visiting any request-detail surface.
    const attachmentId = [...stagedDraftById.entries()]
      .find(([, fileName]) => fileName === FIXTURES.thai.name)?.[0]
    expect(attachmentId, 'captured the Thai staged attachment id').toBeTruthy()
    const previewUrl = `/api/files/download?id=${encodeURIComponent(attachmentId as string)}&disposition=inline`
    const downloadUrl = `/api/files/download?id=${encodeURIComponent(attachmentId as string)}&disposition=attachment`

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

    // ── PHASE 9: signed-out denial (401) ─────────────────────────────
    await page.context().clearCookies()
    const deniedResponse = await page.request.get(downloadUrl)
    expect(deniedResponse.status()).toBe(401)

    // ── PHASE 10: unrelated general-department user denial (403) ─────
    await login(page, unrelatedEmail, unrelatedPassword)
    const forbiddenResponse = await page.request.get(downloadUrl)
    expect(forbiddenResponse.status()).toBe(403)
  })
})
