import { expect, type Browser, type BrowserContext, type Locator, type Page, type Video } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { BUSINESS_ROUTE_CONFIGURATION_NAMES } from '../support/business-workflow-fixture'

/** Fixture unit ids, re-exported for specs that target org-UI row test ids. */
export { BUSINESS_UNITS } from '../support/business-workflow-fixture'

/**
 * Shared, import-safe helpers for the business-workflow browser suite
 * (tests/business-e2e). Extracted from the T01 smoke spec so T02/T03/T04
 * default-workflow specs reuse the exact same recording, evidence-manifest
 * and UI-flow helpers instead of duplicating them.
 *
 * This module MUST stay test-definition-free (no `test(...)` calls): it is
 * imported by every business spec, and any test here would be duplicated in
 * each importing spec file.
 *
 * Recording contract (unchanged from the reviewed T01 slice, plus the
 * route-configuration label added by the T05–T07 slice):
 *  - every actor runs in its OWN browser context with video + trace on and
 *    `baseURL` set explicitly (browser.newContext does NOT inherit the
 *    Playwright config's use.baseURL);
 *  - context.close() always runs in finally so the video flushes to disk even
 *    when trace stop fails; recordings get deterministic scenario/phase/actor
 *    filenames (never blank, never overwritten);
 *  - checkpoint screenshots land under the runner-owned evidence directory;
 *  - a JSON-lines manifest appends one entry per actor segment in
 *    chronological order with scenario/config/phase/actor + evidence paths +
 *    status;
 *  - a caught failure is rethrown AFTER the evidence flush, so a swallowed
 *    error can never produce a false pass.
 *
 * Route-configuration profile: the native runner seeds exactly ONE fixture
 * route configuration per run (BUSINESS_ROUTES_CONFIG) and passes the same
 * validated name to the browser suite and the DB-evidence evaluator. Specs
 * skip scenarios that do not belong to the active profile via explicit
 * `test.skip(condition, reason)` so a skipped suite is never counted as
 * coverage.
 *
 * UI helpers below use ONLY selectors already proven by the green T01 run and
 * the existing tests/e2e/clean-start-approval-flow.spec.ts (row
 * `Open request <title>`, dialog headings, `Approve`/`Confirm Approval`,
 * `Submit Solution`/`Submit Engineering Solution`, `Approve Solution`,
 * `Submit Final Approval`/`Start Final Approval`, `Final Approval Completed`)
 * against the real components: request-modal-router.tsx → approver-modal.tsx,
 * completed-request-modal.tsx, submitter-modal.tsx (mode "solution"),
 * solution-modal.tsx, completed-solution-modal.tsx,
 * submit-final-approval-modal.tsx, completed-final-modal.tsx.
 */

export interface BusinessEnv {
  baseURL: string
  evidenceDir: string
  e2ePassword: string
  /** Active fixture route configuration seeded for THIS run (runner-supplied). */
  routesConfig: string
  /**
   * Owned test-mail capture port for THIS run (runner-supplied provenance
   * metadata for fixture mail-evidence correlation; NOT transport
   * configuration). Optional: the key is only present when set and valid.
   */
  businessMailPort?: string
}

export function requireBusinessEnv(): BusinessEnv {
  const baseURL = process.env.BUSINESS_TEST_BASE_URL
  const evidenceDir = process.env.BUSINESS_EVIDENCE_DIR
  const e2ePassword = process.env.BUSINESS_E2E_PASSWORD
  const routesConfig = process.env.BUSINESS_ROUTES_CONFIG
  const mailPort = process.env.BUSINESS_MAIL_PORT
  if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) {
    throw new Error('business spec: BUSINESS_TEST_BASE_URL must be the owned loopback app URL')
  }
  if (!evidenceDir) throw new Error('business spec: BUSINESS_EVIDENCE_DIR is required')
  if (!e2ePassword) throw new Error('business spec: BUSINESS_E2E_PASSWORD is required')
  if (!routesConfig) {
    throw new Error('business spec: BUSINESS_ROUTES_CONFIG is required (the fixture route configuration seeded for this run)')
  }
  if (!(BUSINESS_ROUTE_CONFIGURATION_NAMES as readonly string[]).includes(routesConfig)) {
    throw new Error(
      `business spec: unknown BUSINESS_ROUTES_CONFIG "${routesConfig}" (known configurations: ${BUSINESS_ROUTE_CONFIGURATION_NAMES.join(', ')})`,
    )
  }
  const env: BusinessEnv = { baseURL, evidenceDir, e2ePassword, routesConfig }
  // Optional owned test-mail capture port (provenance metadata only): when
  // present it MUST be a canonical ASCII decimal port string in 1..65535
  // (anchored [0-9]+, no leading zeros, sign, whitespace, fraction,
  // exponent, or trailing garbage). Absence stays legal for legacy callers;
  // the key is only added when present and valid, and the fixed refusal
  // never serializes the rejected value.
  if (mailPort !== undefined) {
    if (
      !/^[0-9]+$/.test(mailPort) ||
      (mailPort.length > 1 && mailPort.startsWith('0')) ||
      Number(mailPort) < 1 ||
      Number(mailPort) > 65535
    ) {
      throw new Error(
        'business spec: BUSINESS_MAIL_PORT must be a canonical decimal port string in 1..65535 (owned test-mail capture port)',
      )
    }
    env.businessMailPort = mailPort
  }
  return env
}

/** Fixture actor emails seeded by tests/support/native/seed-business-fixture.ts. */
export const BUSINESS_ACTOR_EMAILS = {
  requesterA: 'user-requester-a@business.test',
  staffB: 'user-staff-b@business.test',
  supervisorP: 'user-supervisor-p@business.test',
  sectionManagerP: 'user-section-manager-p@business.test',
  departmentManager: 'user-department-manager@business.test',
  engineerA: 'user-engineer-a@business.test',
  supervisorE: 'user-supervisor-e@business.test',
  sectionManagerE: 'user-section-manager-e@business.test',
  staffC: 'user-staff-c@business.test',
  admin: 'user-admin@business.test',
  inactiveUser: 'user-inactive@business.test',
  unassignedUser: 'user-unassigned@business.test',
  secondApprover: 'user-second-approver@business.test',
  staffVacantSup: 'user-staff-vacant-sup@business.test',
  staffVacantAll: 'user-staff-vacant-all@business.test',
} as const

export interface ActorSegmentLabel {
  /** Scenario id, e.g. 'T02A-default-request-chain'. */
  scenario: string
  /** Phase (+ optional step) inside the scenario, e.g. 'request-approval-supervisor'. */
  phase: string
  /** Fixture actor name, e.g. 'supervisorP'. */
  actor: string
}

export interface ActorEvidence {
  scenario: string
  /** Active fixture route configuration for the run (clip label component). */
  config: string
  phase: string
  actor: string
  status: 'Pass' | 'Fail' | 'Blocked'
  capturedAt: string
  video?: string
  trace?: string
  screenshots: string[]
  notes?: string
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function segmentSlug(env: BusinessEnv, label: ActorSegmentLabel): string {
  const base = slug(`${env.routesConfig}--${label.scenario}--${label.phase}--${label.actor}`)
  if (!base) throw new Error('business recording label must not produce an empty filename')
  return base
}

export async function appendManifest(env: BusinessEnv, entry: ActorEvidence): Promise<void> {
  await fs.appendFile(
    path.join(env.evidenceDir, 'evidence-manifest.jsonl'),
    JSON.stringify(entry) + '\n',
  )
}

export async function screenshot(env: BusinessEnv, page: Page, name: string): Promise<string> {
  const file = path.join(env.evidenceDir, 'screenshots', `${slug(name)}.png`)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await page.screenshot({ path: file, fullPage: true })
  return path.relative(env.evidenceDir, file)
}

export interface CheckpointPage {
  page: Page
  checkpoint: (name: string) => Promise<void>
  shots: string[]
}

export function makeCheckpointPage(env: BusinessEnv, page: Page): CheckpointPage {
  const shots: string[] = []
  return {
    page,
    shots,
    checkpoint: async (name: string) => {
      shots.push(await screenshot(env, page, name))
    },
  }
}

export interface SafeRecordingSecondaries {
  hasPrimary: boolean
  traceStopFailed: boolean
  contextCloseFailed: boolean
  videoPersistFailed: boolean
  manifestWriteFailed: boolean
  setupCleanupFailed: boolean
  failureShotFailed: boolean
  reportingFailed: boolean
  setupCleanupAttempted: boolean
  annotationExposed: boolean
}

export function createSafeRecordingSecondaries(): SafeRecordingSecondaries {
  return {
    hasPrimary: false,
    traceStopFailed: false,
    contextCloseFailed: false,
    videoPersistFailed: false,
    manifestWriteFailed: false,
    setupCleanupFailed: false,
    failureShotFailed: false,
    reportingFailed: false,
    setupCleanupAttempted: false,
    annotationExposed: false,
  }
}

export type SafeRecordingLedger = SafeRecordingSecondaries[]

/** Single shape: selecting the policy requires the collector (no optional-collector variant exists). */
export type RecordingOptions = {
  evidencePolicy: 'fixed-evidence-only'
  secondaries: SafeRecordingSecondaries
}

/**
 * Creates an explicit recording context for one actor segment, runs the
 * scenario phase, flushes video + trace + manifest, then RETHROWS the
 * original failure.
 *
 * Ordering guarantees:
 *  - context.close() runs in finally and is never skipped by a trace-stop
 *    failure, so the video recording always reaches disk;
 *  - accumulated checkpoint screenshots are kept on failure and the failure
 *    screenshot is appended to them in the manifest;
 *  - evidence flush steps are best-effort so they cannot mask the original
 *    error being rethrown.
 */
export async function withRecordedContext(
  browser: Browser,
  env: BusinessEnv,
  label: ActorSegmentLabel,
  run: (tools: CheckpointPage) => Promise<{ notes: string }>,
  options?: RecordingOptions,
): Promise<void> {
  // Whole trailing `options` argument optional — every existing caller (all
  // defaults, T16B, direct withRecordedContext users) is unchanged.
  if (options !== undefined && options.secondaries === undefined) {
    // Fail-closed wiring precondition (JS-level malformation of the single
    // union shape); thrown BEFORE any effect. Not a hostile-object framework.
    throw new Error('withRecordedContext: fixed-evidence-only requires the collector')
  }
  const secondaries = options?.secondaries
  const safe = secondaries !== undefined // aliased narrowing: inside if (safe), secondaries is bound
  const base = segmentSlug(env, label)
  const videoDir = path.join(env.evidenceDir, 'videos')
  const traceFile = path.join(env.evidenceDir, 'traces', `${base}.zip`)
  await fs.mkdir(videoDir, { recursive: true })
  await fs.mkdir(path.dirname(traceFile), { recursive: true })

  // browser.newContext does NOT inherit the config's use.baseURL — without
  // it, page.goto('/sign-in') cannot resolve the relative URL.
  const context: BrowserContext = await browser.newContext({
    baseURL: env.baseURL,
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
    viewport: { width: 1280, height: 800 },
  })
  let page: Page
  let video: Video | null
  let tools: CheckpointPage
  if (safe) {
    // Slender guard over the remaining context-owned setup (safe state is
    // already initialized above): record, attempt ONE close, rethrow exact.
    try {
      page = await context.newPage()
      video = page.video()
      tools = makeCheckpointPage(env, page)
    } catch (setupError) {
      secondaries.setupCleanupAttempted = true // INFO, stored first
      try {
        await context.close()
      } catch {
        secondaries.setupCleanupFailed = true // actual close failure (required)
      }
      throw setupError // exact setup primary — never read/coerced/replaced
    }
  } else {
    page = await context.newPage()
    video = page.video()
    tools = makeCheckpointPage(env, page)
  }
  let status: ActorEvidence['status'] = 'Blocked'
  let notes = ''
  let failureShot: string | undefined
  let failure: { thrown: unknown } | undefined
  let videoRelative: string | undefined

  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
    const result = await run(tools)
    status = 'Pass'
    notes = result.notes
  } catch (error) {
    failure = { thrown: error } // helper-owned exact container; value never read in safe mode
    status = 'Fail'
    if (safe) {
      secondaries.hasPrimary = true // INFO only — the wrapper owns the terminal decision
      notes = 'segment failed' // fixed note; the UNKNOWN PRIMARY is never read
    } else {
      notes = error instanceof Error ? error.message : String(error) // legacy default, pinned unchanged
    }
    try {
      failureShot = await screenshot(env, page, `${base}-failure`)
    } catch {
      if (safe) {
        secondaries.failureShotFailed = true // required category, stored first
      }
      // Best-effort screenshot during failure handling; error still rethrows.
    }
  } finally {
    try {
      await context.tracing.stop({ path: traceFile })
    } catch (traceError) {
      if (safe) {
        secondaries.traceStopFailed = true
        notes += ' | secondary:trace-stop-failed'
      } else {
        notes += ` (trace stop failed: ${traceError instanceof Error ? traceError.message : String(traceError)})`
      }
    }
    try {
      // The close flushes the video file; run it even if trace stop failed.
      await context.close()
    } catch {
      if (safe) {
        secondaries.contextCloseFailed = true
      }
      // Context already closed or browser gone; video rename below is best-effort.
    }
    if (video) {
      try {
        const recorded = await video.path()
        const target = path.join(videoDir, `${base}.webm`)
        await fs.rename(recorded, target)
        videoRelative = path.relative(env.evidenceDir, target)
      } catch {
        if (safe) {
          secondaries.videoPersistFailed = true
        }
        // Recording keeps its generated name under videos/ if rename fails.
      }
    }
    try {
      await appendManifest(env, {
        scenario: label.scenario,
        config: env.routesConfig,
        phase: label.phase,
        actor: label.actor,
        status,
        capturedAt: new Date().toISOString(),
        video: videoRelative,
        trace: path.relative(env.evidenceDir, traceFile),
        screenshots: failureShot ? [...tools.shots, failureShot] : tools.shots,
        notes,
      })
    } catch {
      if (safe) {
        secondaries.manifestWriteFailed = true // flag first; memory outlives the missing manifest
      }
      // Manifest is evidence bookkeeping; it must not mask a real failure.
    }
  }

  if (failure) throw failure.thrown
}

async function gotoApp(page: Page, path: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // A blocked font request can keep the load event open after the form
      // is already usable. Wait for load, but do not burn the whole test on it.
      await page.goto(path, { timeout: 20_000, waitUntil: 'load' })
      return
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_ABORTED/.test(message)) {
        if (attempt === 2) throw error
        await page.waitForTimeout(1_500)
        continue
      }
      if (/Timeout/.test(message) && await page.locator('body').isVisible().catch(() => false)) return
      throw error
    }
  }
  throw lastError
}

function retryableSignInError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_ABORTED|Timeout/.test(message)
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await gotoApp(page, '/sign-in')
      const emailField = page.locator('#email')
      const passwordField = page.locator('#password')
      await expect(emailField).toBeVisible({ timeout: 20_000 })
      // Controlled inputs lose a fill that lands before hydration. Keep filling
      // until both values survive a short pause, then submit once.
      await expect(async () => {
        await emailField.fill(email)
        await passwordField.fill(password)
        await page.waitForTimeout(250)
        await expect(emailField).toHaveValue(email)
        await expect(passwordField).toHaveValue(password)
      }).toPass({ timeout: 20_000 })
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.waitForURL((url) => !url.pathname.includes('/sign-in'), {
        timeout: 45_000,
        waitUntil: 'commit',
      })
      return
    } catch (error) {
      lastError = error
      if (attempt === 2 || !retryableSignInError(error)) throw error
      await page.waitForTimeout(2_000)
    }
  }
  throw lastError
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function uniqueBusinessTitle(scenarioKey: string): string {
  return `Business ${scenarioKey} ${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

/** Title prefixes the runner-side DB evidence capture matches requests by. */
export const BUSINESS_SCENARIO_TITLE_PREFIXES = [
  'Business T02A',
  'Business T02B',
  'Business T03A',
  'Business T03B',
  'Business T03C',
  'Business T04A',
  'Business T04B',
  'Business T05',
  'Business T06',
  'Business T07A',
  'Business T07B',
  'Business T08A',
  'Business T08B',
  'Business T08C',
  'Business T08D',
  'Business T08E',
  'Business T09A',
  'Business T10A',
  'Business T10B',
  'Business T10C',
  'Business T11A',
  'Business T11B',
  'Business T11C',
  'Business T12A',
  'Business T14A',
  'Business T14B',
  'Business T14C',
  'Business T15A',
  'Business T15B',
  'Business T15C',
  'Business T15D',
  'Business T16A',
  'Business T16B',
  'Business T17A',
  'Business T17B1',
  'Business T17B2',
  'Business T17C1',
  'Business T17C2',
  'Business T18A',
  'Business T18B',
  'Business T18C1',
  'Business T18C2',
  'Business T19A',
  'Business T19B',
  'Business T20A',
  'Business T20B',
] as const

/**
 * Opens a request by its table row (`Open request <title>` — request-table.tsx
 * aria-label) and returns the open dialog locator. Mirrors the proven
 * clean-start helper, including the wait for the "Loading request" skeleton
 * to disappear (request-modal-router.tsx).
 */
export async function openRequestByTitle(page: Page, title: string, listPath = '/requests'): Promise<Locator> {
  await gotoApp(page, listPath)
  const row = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0, {
    timeout: 20_000,
  })
  return dialog
}

/** Asserts the request's status badge inside its table row (status-badge.tsx labels). */
export async function expectRequestRowStatus(page: Page, title: string, badgeLabel: string): Promise<void> {
  await gotoApp(page, '/requests')
  const row = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row.getByText(badgeLabel, { exact: true })).toBeVisible({ timeout: 10_000 })
}

/** Asserts the request is NOT listed as an action item for the signed-in actor. */
export async function expectNoMyActionItem(page: Page, title: string): Promise<void> {
  await gotoApp(page, '/requests/my-actions')
  await expect(page.getByRole('row', { name: new RegExp(escapeRegExp(title)) })).toHaveCount(0)
}

/**
 * Request creation via the proven T01/clean-start controls: /requests →
 * "New Request" → "Submit New Request" dialog (#title + contenteditable
 * description) → "Submit Request" → "Request created successfully" toast and
 * the new row.
 */
export async function createRequestViaUi(
  page: Page,
  checkpoint: (name: string) => Promise<void>,
  title: string,
  description: string,
): Promise<void> {
  await gotoApp(page, '/requests')
  await page.getByRole('button', { name: 'New Request' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Submit New Request' })).toBeVisible({ timeout: 20_000 })
  await dialog.locator('#title').fill(title)
  const editor = dialog.locator('[contenteditable="true"]').first()
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await editor.click()
  await editor.fill(description)
  await checkpoint(`request-form-${slug(title)}`)
  await dialog.getByRole('button', { name: 'Submit Request' }).click()
  await expect(page.getByText('Request created successfully')).toBeVisible({ timeout: 30_000 })
  const row = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
  await expect(row).toBeVisible({ timeout: 30_000 })
}

/**
 * Approves the CURRENT pending step from /requests/my-actions via the
 * approver modal (approver-modal.tsx: "Approve" → "Confirm Approval" →
 * "Approved successfully" toast). Used for both the REQUEST phase
 * (ImprovementRequest, mode "request") and the FINAL phase (FinalApproval,
 * mode "final") because both render the same controls.
 */
export async function approveCurrentStepViaUi(page: Page, title: string): Promise<void> {
  const dialog = await openRequestByTitle(page, title, '/requests/my-actions')
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await dialog.getByRole('button', { name: 'Confirm Approval' }).click()
  await expect(page.getByText('Approved successfully')).toBeVisible({ timeout: 30_000 })
}

/** Read-only proof the actor cannot decide the current step: no Approve control. */
export async function expectNoApproveControl(page: Page, title: string, listPath = '/requests'): Promise<void> {
  const dialog = await openRequestByTitle(page, title, listPath)
  await expect(dialog.getByRole('button', { name: /^Approve/ })).toHaveCount(0)
}

/**
 * FINAL-chain approval variant for the T08 trigger workflows: identical to
 * approveCurrentStepViaUi EXCEPT that a request row which never appears in a
 * rendered /requests/my-actions list after a SUCCESSFUL Final trigger fails
 * with a NAMED confirmed-plan violation instead of a bare 30s row timeout.
 *
 * Plan §1/§6 keep the FINAL origin on the ORIGINAL REQUESTER, so a trigger
 * actor who independently holds the first Final rank (Section manager P on
 * the all-defaults chain) MUST remain the first Final approver after they
 * trigger. The known product deviation (plan technical appendix, expected
 * mismatch #2: the trigger path persists originUserId = the TRIGGER actor)
 * instead self-skips the trigger actor's own Final rank, leaves their My
 * Actions EMPTY and offers the next candidate (Department manager) first.
 * That is an honest Fail with a diagnosable reason: the empty My Actions is
 * NEVER encoded as expected and production is NOT changed. Any other row
 * failure (e.g. the list still loading) rethrows the original timeout.
 */
export async function approveFinalStepViaUiGuardingEmptyMyActions(
  page: Page,
  title: string,
  actorLabel: string,
): Promise<void> {
  await gotoApp(page, '/requests/my-actions')
  const row = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
  try {
    await expect(row).toBeVisible({ timeout: 30_000 })
  } catch (rowTimeout) {
    if ((await row.count()) === 0) {
      throw new Error(
        `Confirmed-plan violation (Final origin/self-skip): ${actorLabel} — My Actions rendered with NO item for "${title}" after the successful Final trigger. ` +
          'Plan §1/§6 require the FINAL origin to stay on the ORIGINAL REQUESTER so a trigger actor holding the first Final rank (Section manager P on the all-defaults chain) keeps that rank; ' +
          'the product persists originUserId = the TRIGGER ACTOR, which self-skips their own Final rank and offers the next candidate first — failing honestly, production unchanged.',
      )
    }
    throw rowTimeout
  }
  await row.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0, {
    timeout: 20_000,
  })
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await dialog.getByRole('button', { name: 'Confirm Approval' }).click()
  await expect(page.getByText('Approved successfully')).toBeVisible({ timeout: 30_000 })
}

/**
 * Engineering solution submission via the real routed modals:
 * request row (status SentToEngineer, engineering actor) → completed-request
 * modal "Submit Solution" → submitter modal "Submit Engineering Solution"
 * (#solutionTitle + contenteditable description + #cost + #timeline) →
 * "Submit Solution" → "Solution submitted successfully" toast.
 */
export async function submitSolutionViaUi(
  page: Page,
  checkpoint: (name: string) => Promise<void>,
  title: string,
  solution: { title: string; description: string; cost: string; timeline: string },
): Promise<void> {
  const dialog = await openRequestByTitle(page, title, '/requests')
  await dialog.getByRole('button', { name: 'Submit Solution' }).click()
  const form = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Submit Engineering Solution' }) })
  await expect(form).toBeVisible({ timeout: 20_000 })
  await form.locator('#solutionTitle').fill(solution.title)
  const editor = form.locator('[contenteditable="true"]').first()
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await editor.click()
  await editor.fill(solution.description)
  await form.locator('#cost').fill(solution.cost)
  await form.locator('#timeline').fill(solution.timeline)
  await checkpoint(`solution-form-${slug(title)}`)
  await form.getByRole('button', { name: 'Submit Solution' }).click()
  await expect(page.getByText('Solution submitted successfully')).toBeVisible({ timeout: 30_000 })
}

/**
 * Approves the CURRENT pending solution step from /requests/my-actions via
 * the solution modal (solution-modal.tsx SolutionApprovalActions:
 * "Approve Solution" → "Approved successfully" toast — no confirm dialog).
 */
export async function approveSolutionStepViaUi(page: Page, title: string): Promise<void> {
  const failureText = /An error occurred while approving|You cannot approve this solution|Failed to approve/
  let lastFailure = 'approval toast did not appear'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const dialog = await openRequestByTitle(page, title, '/requests/my-actions')
    await dialog.getByRole('button', { name: 'Approve Solution' }).click()
    const success = page.getByText('Approved successfully')
    const failure = page.getByText(failureText)
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (await success.isVisible().catch(() => false)) return
      if (await failure.isVisible().catch(() => false)) {
        lastFailure = (await failure.first().textContent()) ?? lastFailure
        break
      }
      await page.waitForTimeout(250)
    }
  }
  throw new Error(`Solution approval did not succeed: ${lastFailure}`)
}

/** Read-only proof the actor is not the current solution approver. */
export async function expectNoApproveSolutionControl(page: Page, title: string, listPath = '/requests'): Promise<void> {
  const dialog = await openRequestByTitle(page, title, listPath)
  await expect(dialog.getByRole('button', { name: 'Approve Solution' })).toHaveCount(0)
}

/** Read-only proof the actor cannot submit a solution (no Submit Solution control). */
export async function expectNoSubmitSolutionControl(page: Page, title: string, listPath = '/requests'): Promise<void> {
  const dialog = await openRequestByTitle(page, title, listPath)
  await expect(dialog.getByRole('button', { name: 'Submit Solution' })).toHaveCount(0)
}

/** Read-only proof the signed-in actor was NOT offered a Final trigger control. */
export async function expectNoSubmitFinalApprovalControl(page: Page, title: string, listPath = '/requests'): Promise<void> {
  const dialog = await openRequestByTitle(page, title, listPath)
  await expect(dialog.getByRole('button', { name: 'Submit Final Approval' })).toHaveCount(0)
}

/**
 * Visibility-denial proof: the request row is ABSENT from the request list
 * (the actor's sharing scope does not contain it), so no dialog-based action
 * is even reachable for this actor.
 */
export async function expectRequestNotListed(page: Page, title: string, listPath = '/requests'): Promise<void> {
  await gotoApp(page, listPath)
  await expect(page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })).toHaveCount(0)
}

/**
 * Opens a request whose title STARTS WITH the given prefix (e.g. the single
 * 'Business T04A' request of the current run). Used when a scenario asserts
 * against another same-run scenario's request — the T09 post-Completed Final
 * denials target the request completed by T04A — without inventing a new
 * workflow. Same proven row/dialog selectors as openRequestByTitle.
 */
export async function openRequestByTitlePrefix(page: Page, titlePrefix: string, listPath = '/requests'): Promise<Locator> {
  await gotoApp(page, listPath)
  const row = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(titlePrefix)}`) })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0, {
    timeout: 20_000,
  })
  return dialog
}

/**
 * Attempt Final submission for the CURRENTLY SIGNED-IN actor via the real
 * routed modals: request row (status SendBackToRequester) → completed-solution
 * modal "Submit Final Approval" → submit-final-approval modal ("Initiate Final
 * Approval" heading) "Start Final Approval" → "Final approval initiated
 * successfully" toast. Unlike initiateFinalApprovalViaUi below (whose callers
 * only ever run the ORIGINAL REQUESTER), this variant serves the T08/T10
 * trigger-authority scenarios for ANY authorized trigger actor.
 *
 * The CONFIRMED plan result is that the trigger SUCCEEDS (plan §1/§4 T08:
 * original requester, other Production 1 Staff, and the requester-unit
 * management hierarchy may trigger Final). If the product does not even
 * render the control — e.g. the exact-origin-unit eligibility gap that
 * excludes the parent Department manager (src/lib/permission-checks.ts
 * canInitiateFinalApproval; plan appendix expected mismatch #1) — this fails
 * the segment with a named policy reason instead of a bare selector timeout,
 * so the honest Fail carries a diagnosable manifest note. Production is NOT
 * patched and the defect is NOT encoded as an expected pass.
 */
export async function attemptFinalApprovalViaUi(page: Page, title: string, actorLabel: string): Promise<void> {
  const dialog = await openRequestByTitle(page, title, '/requests')
  const control = dialog.getByRole('button', { name: 'Submit Final Approval' })
  if ((await control.count()) === 0) {
    throw new Error(
      `Confirmed-plan violation: ${actorLabel} was NOT offered the Final trigger control on "${title}" at SendBackToRequester. ` +
        'Plan §1/§4 T08: original requester, other Production 1 Staff and the authorized requester-unit hierarchy MAY trigger Final; ' +
        'the product currently gates eligibility on exact assignment-unit equality (canInitiateFinalApproval) — failing honestly, production unchanged.',
    )
  }
  await control.click()
  const form = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Initiate Final Approval' }) })
  await expect(form).toBeVisible({ timeout: 20_000 })
  await form.getByRole('button', { name: 'Start Final Approval' }).click()
  await expect(page.getByText('Final approval initiated successfully')).toBeVisible({ timeout: 30_000 })
}

/**
 * Original-requester Final submission via the real routed modals:
 * request row (status SendBackToRequester, requester-side actor) →
 * completed-solution modal "Submit Final Approval" → submit-final-approval
 * modal ("Initiate Final Approval" heading) "Start Final Approval" →
 * "Final approval initiated successfully" toast.
 */
export async function initiateFinalApprovalViaUi(page: Page, title: string): Promise<void> {
  const dialog = await openRequestByTitle(page, title, '/requests')
  await dialog.getByRole('button', { name: 'Submit Final Approval' }).click()
  const form = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Initiate Final Approval' }) })
  await expect(form).toBeVisible({ timeout: 20_000 })
  await form.getByRole('button', { name: 'Start Final Approval' }).click()
  await expect(page.getByText('Final approval initiated successfully')).toBeVisible({ timeout: 30_000 })
}

/** Read-only proof: the terminal/cancelled request offers NO Cancel Request control. */
export async function expectNoCancelRequestControl(page: Page, title: string): Promise<Locator> {
  const dialog = await openRequestByTitle(page, title, '/requests')
  await expect(dialog.getByRole('button', { name: 'Cancel Request' })).toHaveCount(0)
  return dialog
}

/** Completed-state proof: completed-final modal banner (completed-final-modal.tsx). */
export async function expectCompletedRequest(page: Page, title: string): Promise<void> {
  const dialog = await openRequestByTitle(page, title, '/requests')
  await expect(dialog.getByText('Final Approval Completed')).toBeVisible({ timeout: 20_000 })
}

// ---
// In-app notification bell (T12) — the REAL bell UI
// (src/components/notifications/notification-bell.tsx + notification-list.tsx).
// Selectors proven by tests/e2e/clean-start-sharing-visibility.spec.ts: the
// icon-only bell trigger (svg.lucide-bell), the popover heading
// "Notifications" inside [data-radix-popper-content-wrapper], and per-entry
// "Request: {title}" text. Entries are buttons, so an entry for one request
// is located by filtering on BOTH the notification title and the request
// title (notifications from other same-run scenarios must never satisfy the
// assertion for this request).
// ---

/** Opens the bell popover and returns its content wrapper locator. */
export async function openNotificationBell(page: Page): Promise<Locator> {
  const bell = page.getByRole('button').filter({ has: page.locator('svg.lucide-bell') })
  await expect(bell).toBeVisible({ timeout: 20_000 })
  await bell.click()
  const popover = page.locator('[data-radix-popper-content-wrapper]')
  await expect(popover.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 20_000 })
  return popover
}

/**
 * Proves the signed-in actor received the expected in-app notification for
 * EXACTLY this request: a bell entry containing both the notification title
 * (e.g. "Approval Needed") and the request title.
 */
export async function expectBellNotificationForRequest(
  page: Page,
  requestTitle: string,
  notificationTitle: string,
): Promise<void> {
  const popover = await openNotificationBell(page)
  const entry = popover
    .getByRole('button')
    .filter({ hasText: requestTitle })
    .filter({ hasText: notificationTitle })
    .first()
  await expect(entry).toBeVisible({ timeout: 20_000 })
}

async function clickBellEntry(entry: Locator): Promise<void> {
  await expect(entry).toBeVisible({ timeout: 20_000 })
  // The popover animates and the list can refresh. Wait until the entry is
  // visible, then dispatch the click. The dialog assertion still proves it opened.
  await entry.click({ force: true })
}

/**
 * Proves the signed-in actor received NO in-app notification referencing
 * this request (PARTICIPANTS_ONLY: viewing access never subscribes).
 */
export async function expectBellNoNotificationForRequest(page: Page, requestTitle: string): Promise<void> {
  const popover = await openNotificationBell(page)
  await expect(popover.getByText(requestTitle)).toHaveCount(0)
}

/**
 * T12 link proof: clicking the bell entry for this request opens the routed
 * request dialog (an authorized, relevant page) — notification-bell.tsx
 * handleOpenRequest -> RequestModalRouter.
 */
export async function openRequestFromBell(page: Page, requestTitle: string, notificationTitle: string): Promise<Locator> {
  const popover = await openNotificationBell(page)
  const entry = popover
    .getByRole('button')
    .filter({ hasText: requestTitle })
    .filter({ hasText: notificationTitle })
    .first()
  await clickBellEntry(entry)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0, {
    timeout: 20_000,
  })
  return dialog
}

// ---
// Reject / resubmit (T14) — proven clean-start reject selectors
// (tests/e2e/clean-start-approval-flow.spec.ts "rejection returns the request
// for revision"): approver-modal "Reject" -> placeholder reason textarea ->
// "Confirm Rejection" -> "Rejected successfully" toast. The solution variant
// uses solution-modal.tsx SolutionApprovalActions ("Reject Solution" button,
// its own placeholder). Both forms enforce the REQUIRED reason in the UI:
// "Confirm Rejection" is disabled while the reason is empty, so the
// without-a-reason denial is provable by asserting that disabled state before
// filling the reason.
// ---

const REQUEST_REJECT_PLACEHOLDER = 'Please explain the reason for rejection...'
const SOLUTION_REJECT_PLACEHOLDER = "Please explain why you're rejecting this solution..."

/** Opens the request dialog from /requests/my-actions (shared reject base). */
async function openMyActionsDialog(page: Page, title: string): Promise<Locator> {
  return openRequestByTitle(page, title, '/requests/my-actions')
}

/** Read-only proof the request IS an action item for the signed-in actor. */
export async function expectMyActionItemRow(page: Page, title: string): Promise<void> {
  await gotoApp(page, '/requests/my-actions')
  const row = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
  await expect(row).toBeVisible({ timeout: 30_000 })
}

/**
 * Rejects the CURRENT pending REQUEST or FINAL step via the approver modal.
 * With `proveRequiredReason`, first asserts the UI denies a rejection WITHOUT
 * a reason ("Confirm Rejection" disabled while the reason is empty) before
 * filling it — the required-reason enforcement of plan T14.
 */
export async function rejectCurrentStepViaUi(
  page: Page,
  title: string,
  reason: string,
  options: { proveRequiredReason?: boolean } = {},
): Promise<void> {
  const dialog = await openMyActionsDialog(page, title)
  await dialog.getByRole('button', { name: 'Reject' }).click()
  const reasonField = page.getByPlaceholder(REQUEST_REJECT_PLACEHOLDER)
  await expect(reasonField).toBeVisible({ timeout: 20_000 })
  const confirm = page.getByRole('button', { name: 'Confirm Rejection' })
  if (options.proveRequiredReason) {
    await expect(confirm).toBeDisabled()
  }
  await reasonField.fill(reason)
  await confirm.click()
  await expect(page.getByText('Rejected successfully')).toBeVisible({ timeout: 30_000 })
}

/** Solution-modal variant of rejectCurrentStepViaUi (solution-modal.tsx). */
export async function rejectSolutionStepViaUi(
  page: Page,
  title: string,
  reason: string,
  options: { proveRequiredReason?: boolean } = {},
): Promise<void> {
  const dialog = await openMyActionsDialog(page, title)
  await dialog.getByRole('button', { name: 'Reject Solution' }).click()
  const reasonField = page.getByPlaceholder(SOLUTION_REJECT_PLACEHOLDER)
  await expect(reasonField).toBeVisible({ timeout: 20_000 })
  const confirm = page.getByRole('button', { name: 'Confirm Rejection' })
  if (options.proveRequiredReason) {
    await expect(confirm).toBeDisabled()
  }
  await reasonField.fill(reason)
  await confirm.click()
  await expect(page.getByText('Rejected successfully')).toBeVisible({ timeout: 30_000 })
}

/**
 * STALE-rejection denial proof (plan T14 "old stale rejection"): the actor
 * clicks "Confirm Rejection" on a dialog whose approval step was superseded
 * (rejected, resubmitted as a NEW attempt, then advanced past their step by
 * another actor). The server re-resolves eligibility at call time
 * (canUserApprove -> current pending step only), so the stale click must be
 * DENIED: the router surfaces the thrown server error as the
 * "An error occurred while rejecting" toast and NEVER "Rejected successfully".
 * The reason textarea is already revealed by the caller (the dialog was
 * opened while the step was still pending).
 */
export async function expectStaleRejectDenied(page: Page, reason: string): Promise<void> {
  const reasonField = page.getByPlaceholder(REQUEST_REJECT_PLACEHOLDER)
  await expect(reasonField).toBeVisible({ timeout: 20_000 })
  await reasonField.fill(reason)
  await page.getByRole('button', { name: 'Confirm Rejection' }).click()
  await expect(page.getByText('An error occurred while rejecting')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Rejected successfully')).toHaveCount(0)
}

/**
 * Permitted-actor REQUEST revision/resubmit (request-resubmit-modal.tsx:
 * heading "Resubmit Request", #title + RichTextEditor #description,
 * "Resubmit Request" button, "Request resubmitted successfully" toast).
 */
export async function resubmitRequestViaUi(
  page: Page,
  checkpoint: (name: string) => Promise<void>,
  title: string,
  revisedDescription: string,
): Promise<void> {
  const dialog = await openRequestByTitle(page, title, '/requests')
  await expect(dialog.getByRole('heading', { name: 'Resubmit Request' })).toBeVisible({ timeout: 20_000 })
  await dialog.locator('#title').fill(title)
  const editor = dialog.locator('[contenteditable="true"]').first()
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await editor.click()
  await editor.fill(revisedDescription)
  await checkpoint(`resubmit-request-form-${slug(title)}`)
  await dialog.getByRole('button', { name: 'Resubmit Request' }).click()
  await expect(page.getByText('Request resubmitted successfully')).toBeVisible({ timeout: 30_000 })
}

/**
 * Permitted-actor SOLUTION revision/resubmit (submitter-modal.tsx mode
 * "resubmit": heading "Resubmit Solution", prefilled #solutionTitle +
 * description + #cost + #timeline, "Resubmit Solution" button,
 * "Solution resubmitted successfully" toast).
 */
export async function resubmitSolutionViaUi(
  page: Page,
  checkpoint: (name: string) => Promise<void>,
  title: string,
  solution: { title: string; description: string; cost: string; timeline: string },
): Promise<void> {
  const dialog = await openRequestByTitle(page, title, '/requests')
  const openResubmit = dialog.getByRole('button', { name: 'Resubmit Solution' })
  if (await openResubmit.count()) {
    await openResubmit.click()
  }
  const form = page.getByRole('dialog', { name: /Resubmit Solution/ })
  await expect(form).toBeVisible({ timeout: 20_000 })
  // Resubmit mode has no solution-title input (that field is submit-only).
  const editor = form.locator('[contenteditable="true"]').first()
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await editor.click()
  await editor.fill(solution.description)
  await form.locator('#cost').fill(solution.cost)
  await form.locator('#timeline').fill(solution.timeline)
  await checkpoint(`resubmit-solution-form-${slug(title)}`)
  await form.getByRole('button', { name: 'Resubmit Solution' }).click()
  await expect(page.getByText('Solution resubmitted successfully')).toBeVisible({ timeout: 30_000 })
}

/**
 * Permitted-actor FINAL restart (final-approval-resubmit-modal.tsx:
 * "Restart Final Approval" button, "Final approval restarted successfully"
 * toast).
 */
export async function restartFinalApprovalViaUi(page: Page, title: string): Promise<void> {
  const dialog = await openRequestByTitle(page, title, '/requests')
  const restart = dialog.getByRole('button', { name: 'Restart Final Approval' })
  await expect(restart).toBeVisible({ timeout: 20_000 })
  await restart.click()
  await expect(page.getByText('Final approval restarted successfully')).toBeVisible({ timeout: 30_000 })
}

/** Read-only proof: actor cannot revise/resubmit the rejected REQUEST. */
export async function expectNoResubmitRequestControl(page: Page, title: string): Promise<Locator> {
  const dialog = await openRequestByTitle(page, title, '/requests')
  await expect(dialog.getByRole('heading', { name: 'Rejected Request' })).toBeVisible({ timeout: 20_000 })
  await expect(dialog.getByRole('button', { name: 'Resubmit Request' })).toHaveCount(0)
  return dialog
}

/** Read-only proof: actor cannot revise/resubmit the rejected SOLUTION. */
export async function expectNoResubmitSolutionControl(page: Page, title: string): Promise<Locator> {
  const dialog = await openRequestByTitle(page, title, '/requests')
  await expect(dialog.getByRole('button', { name: 'Resubmit Solution' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Submit Solution' })).toHaveCount(0)
  return dialog
}

/** Read-only proof: actor cannot restart the rejected FINAL approval. */
export async function expectNoRestartFinalApprovalControl(page: Page, title: string): Promise<Locator> {
  const dialog = await openRequestByTitle(page, title, '/requests')
  await expect(dialog.getByRole('button', { name: 'Restart Final Approval' })).toHaveCount(0)
  return dialog
}

// ---
// Shared scenario-phase segments (extracted from the default-workflow spec
// so the exception-profile specs reuse the identical recorded-context flow
// instead of copy-pasting it). These MUST stay test-definition-free like the
// rest of this module.
// ---

/** One signed-in actor phase inside its own recorded context. */
/** One signed-in actor phase inside its own recorded context (signIn stays INSIDE the callback). */
export async function signedInSegment(
  browser: Browser,
  env: BusinessEnv,
  label: ActorSegmentLabel,
  actorEmail: string,
  run: (tools: CheckpointPage) => Promise<{ notes: string }>,
  options?: RecordingOptions,
): Promise<void> {
  await withRecordedContext(
    browser,
    env,
    label,
    async (tools) => {
      await signIn(tools.page, actorEmail, env.e2ePassword)
      return run(tools)
    },
    options,
  )
}

/**
 * Request phase: the three default in-order decisions (staff-origin default
 * chain Supervisor → Section manager → Department manager). The REQUEST
 * phase is company-default in EVERY fixture route configuration, so this
 * segment is shared by the all-defaults and exception-profile specs.
 */
export async function approveDefaultRequestChain(
  browser: Browser,
  env: BusinessEnv,
  scenarioId: string,
  title: string,
): Promise<void> {
  for (const [phase, actor, email] of [
    ['request-approval-supervisor', 'supervisorP', BUSINESS_ACTOR_EMAILS.supervisorP],
    ['request-approval-section-manager', 'sectionManagerP', BUSINESS_ACTOR_EMAILS.sectionManagerP],
    ['request-approval-department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
  ] as const) {
    await signedInSegment(
      browser,
      env,
      { scenario: scenarioId, phase, actor },
      email,
      async ({ page, checkpoint }) => {
        await approveCurrentStepViaUi(page, title)
        await checkpoint(`${slug(scenarioId)}-request-approved-${actor}`)
        return { notes: `Request step approved (${actor}) — company default chain` }
      },
    )
  }
}

// ---
// Shared T15–T20 building blocks (all exercised through the REAL UI):
// the admin approval-chains panel (ApprovalChainsPanel.tsx + Create-
// ExceptionDialog + RouteEditorPanel + RouteExceptionDeletionSection), the
// admin users table (user-table.tsx deactivate/activate), the admin email
// settings form (email-settings-form.tsx), and the stranded-attempt restart
// (RestartAttemptDialog). Selectors below are the components' own
// data-testid hooks, so these helpers stay honest to the shipped UI.
// ---

/** Opens the admin approval-chains panel via its deep-link URL (no hover seam). */
export async function openApprovalChainsPanel(page: Page): Promise<void> {
  await gotoApp(page, '/admin/organization?panel=chains')
  await expect(page.getByTestId('chains-panel')).toBeVisible({ timeout: 30_000 })
}

/** Picks one option in a Radix Select by its trigger test id and option label. */
export async function selectRadixOption(page: Page, triggerTestId: string, optionLabel: string): Promise<void> {
  await page.getByTestId(triggerTestId).click()
  await page.getByRole('option', { name: optionLabel, exact: true }).click()
}

export interface UnitExceptionInput {
  /** Fixture unit id (e.g. unit-production-1-section) for row test ids. */
  unitId: string
  unitName: string
  /** UI phase label: 'Request' | 'Solution' | 'Final'. */
  phaseLabel: string
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  /** Number of FIRST editor steps to remove before publishing (0 keeps the seeded chain). */
  removeFirstSteps?: number
}

/**
 * Publishes a TEST-ONLY unit exception through the real org UI:
 * Create exception → (optionally remove leading steps) → Publish.
 * Mirrors the seeded test-only fixtures: the exception REPLACES the inherited
 * chain for the unit; the approval limit stays the Department manager.
 * Publish success is proven by the new published exception row (the editor's
 * transient "Published (version …)" notice unmounts with the editor).
 */
export async function createUnitExceptionViaUi(
  page: Page,
  checkpoint: (name: string) => Promise<void>,
  input: UnitExceptionInput,
): Promise<void> {
  await openApprovalChainsPanel(page)
  await page.getByTestId('chains-create-exception').first().click()
  await expect(page.getByTestId('chains-create-exception-dialog')).toBeVisible({ timeout: 20_000 })
  await selectRadixOption(page, 'chains-create-exception-unit-select', input.unitName)
  await selectRadixOption(page, 'chains-create-exception-phase-select', input.phaseLabel)
  await page.getByTestId('chains-create-exception-submit').click()
  // The editor panel has no single root test id; its unique limit select
  // anchors it (one editor per chains panel).
  await expect(page.getByTestId('route-editor-limit-select')).toBeVisible({ timeout: 20_000 })
  for (let index = 0; index < (input.removeFirstSteps ?? 0); index += 1) {
    await page.getByTestId('route-editor-remove-step-1').click()
  }
  await checkpoint(`exception-editor-${slug(`${input.unitId}-${input.phase}`)}`)
  await page.getByTestId('route-editor-publish').click()
  const publishedRow = page.getByTestId(`chains-exception-${input.unitId}-${input.phase}`)
  await expect(publishedRow).toBeVisible({ timeout: 30_000 })
  await expect(publishedRow.getByText('Custom at this unit')).toBeVisible({ timeout: 20_000 })
}

/** Removes a published unit exception through the real org UI (with confirm). */
export async function removeUnitExceptionViaUi(
  page: Page,
  checkpoint: (name: string) => Promise<void>,
  input: { unitId: string; phase: 'REQUEST' | 'SOLUTION' | 'FINAL'; phaseLabel: string },
): Promise<void> {
  await openApprovalChainsPanel(page)
  const row = page.getByTestId(`chains-exception-${input.unitId}-${input.phase}`)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.getByTestId(`chains-exception-delete-${input.unitId}-${input.phase}`).click()
  await expect(page.getByTestId('chains-exception-delete-confirmation')).toBeVisible({ timeout: 20_000 })
  await checkpoint(`exception-remove-confirm-${slug(`${input.unitId}-${input.phase}`)}`)
  await page.getByTestId('chains-exception-delete-confirm').click()
  await expect(page.getByTestId('chains-exception-delete-confirmation')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByTestId(`chains-exception-${input.unitId}-${input.phase}`)).toHaveCount(0, { timeout: 30_000 })
}

/**
 * Edits a published unit exception: removes the step currently at order N,
 * publishes, and proves the edit by the row's updated steps summary.
 */
export async function editUnitExceptionRemoveStepViaUi(
  page: Page,
  checkpoint: (name: string) => Promise<void>,
  input: {
    unitId: string
    phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
    removeStepOrder: number
    expectedStepsSummary: string
  },
): Promise<void> {
  await openApprovalChainsPanel(page)
  const row = page.getByTestId(`chains-exception-${input.unitId}-${input.phase}`)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.getByTestId(`chains-exception-customize-${input.unitId}-${input.phase}`).click()
  await expect(page.getByTestId('route-editor-limit-select')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId(`route-editor-remove-step-${input.removeStepOrder}`).click()
  await checkpoint(`exception-edit-${slug(`${input.unitId}-${input.phase}`)}`)
  await page.getByTestId('route-editor-publish').click()
  await expect(
    page.getByTestId(`chains-exception-${input.unitId}-${input.phase}`).getByText(input.expectedStepsSummary),
  ).toBeVisible({ timeout: 30_000 })
}

/** True when a published exception row still exists at the scope/phase (idempotent cleanup guard). */
export async function unitExceptionExists(page: Page, unitId: string, phase: 'REQUEST' | 'SOLUTION' | 'FINAL'): Promise<boolean> {
  await openApprovalChainsPanel(page)
  return (await page.getByTestId(`chains-exception-${unitId}-${phase}`).count()) > 0
}

/** Deactivates a user through the real admin users table (kebab → Deactivate → confirm). */
export async function deactivateUserViaUi(
  page: Page,
  checkpoint: (name: string) => Promise<void>,
  email: string,
): Promise<void> {
  await gotoApp(page, '/admin/users')
  const row = page.getByRole('row', { name: new RegExp(escapeRegExp(email)) })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.getByRole('button', { name: /Open menu/i }).click()
  await page.getByRole('menuitem', { name: 'Deactivate' }).click()
  await expect(page.getByRole('alertdialog').getByText('Deactivate User')).toBeVisible({ timeout: 20_000 })
  await checkpoint(`user-deactivate-${slug(email)}`)
  await page.getByRole('alertdialog').getByRole('button', { name: /^Deactivate$/ }).click()
  await expect(row.getByText('Inactive')).toBeVisible({ timeout: 30_000 })
}

/** Reactivates a user through the real admin users table (kebab → Activate). */
export async function activateUserViaUi(
  page: Page,
  checkpoint: (name: string) => Promise<void>,
  email: string,
): Promise<void> {
  await gotoApp(page, '/admin/users')
  const row = page.getByRole('row', { name: new RegExp(escapeRegExp(email)) })
  await expect(row).toBeVisible({ timeout: 30_000 })
  const inactive = row.getByText('Inactive', { exact: true })
  if (await inactive.count()) {
    await row.getByRole('button', { name: /Open menu/i }).click()
    await page.getByRole('menuitem', { name: 'Activate' }).click()
    await expect(row.getByText('Active', { exact: true })).toBeVisible({ timeout: 30_000 })
  }
  await checkpoint(`user-activate-${slug(email)}`)
}

/**
 * Saves a new SMTP port through the REAL admin email settings form and
 * returns the port value that was live BEFORE the change (for restore).
 * No production seam is touched: saveEmailSettings writes the settings row
 * only; transport resolution re-reads it per send.
 */
export async function setEmailSmtpPortViaUi(
  page: Page,
  checkpoint: (name: string) => Promise<void>,
  nextPort: string,
): Promise<string> {
  await gotoApp(page, '/admin/email')
  const portField = page.locator('#smtp-port')
  await expect(portField).toBeVisible({ timeout: 30_000 })
  const previousPort = await portField.inputValue()
  await portField.fill(nextPort)
  await checkpoint(`email-settings-port-${slug(nextPort)}`)
  await page.getByRole('button', { name: /Save/i }).click()
  await expect(page.getByText('Email settings saved')).toBeVisible({ timeout: 30_000 })
  await page.reload({ timeout: 90_000 })
  await expect(portField).toHaveValue(nextPort, { timeout: 30_000 })
  return previousPort
}
