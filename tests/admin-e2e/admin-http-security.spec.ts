import { expect, test, type APIResponse, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES,
  adminSensitiveLeakMarkers,
  createAdminSecurityFixture,
  expectedFinalTemplateStates,
  type AdminDenialPersonaKey,
} from '../support/admin-security/admin-security-fixture'
import {
  ADMIN_GUARDED_ACTION_EXPORTS,
  encodeActionArgsBody,
  findActionId,
  parseServerReferenceManifest,
  resolveRequiredUiWireActionIds,
  serializeRequiredActionMapping,
  type AdminActionFile,
  type GuardedActionSpec,
  type RequiredActionMappingEntry,
} from '../support/admin-security/admin-action-wire'
import { captureActionWires, settleThenPersistAndDispose, type ActionWireCapture } from '../support/admin-security/admin-action-wire-capture'
import {
  createPersonaPhaseEvidence,
  markPersonaOperation,
  runPersonaLifecycle,
  type PersonaPhaseEvidence,
} from '../support/admin-security/admin-persona-cleanup'
import { ADMIN_RETENTION_API_EXPECTATIONS } from '../support/admin-security/admin-retention-api-contract'

/**
 * Admin HTTP-security suite (isolated native runtime, browser/HTTP evidence
 * only — NEVER a DATABASE_URL; durable non-mutation proof lives in the
 * runner-owned psql evidence module).
 *
 * Closes the four outstanding items of the Astra admin-action-guard review
 * against the REAL application with REAL protocol:
 *
 *  A1 direct unauthorized Server Action POSTs + admin API calls are denied
 *     without mutation; authorized equivalents still work.
 *  A2 role-aware denial destinations: engineering ROLE → /engineering;
 *     engineering MEMBERSHIP without the role → /requests; other non-admins
 *     → /requests.
 *  A3 same-origin/session preservation on 127.0.0.1 without a login bounce.
 *  A4 anonymous denial + authorized-admin page access.
 *
 * REAL protocol, no fakes:
 *  - Server-action ids are resolved from the app-generated
 *    `.next/server/server-reference-manifest.json` of THIS run's app copy
 *    (written by next dev as the admin routes compile), never invented.
 *  - The six UI-invocable mutating actions are driven once through the REAL
 *    admin UI as an authorized admin; their wire (next-action header + body)
 *    is captured by request interception and byte-compared with the bodies
 *    built here, so the constructed protocol cannot drift from the app's
 *    own encoding.
 *  - The four read actions are invoked with protocol-identical constructed
 *    bodies (React encodeReply root-field semantics) and are validated by
 *    authorized positive controls BEFORE any denial replay relies on them.
 *  - The retention admin APIs are exercised with the REAL archived fixture
 *    request id for denials; authorized controls reach only the routes'
 *    validation-error paths — the destructive success actions (backup zip
 *    generation, hard delete) are NEVER executed as a shortcut.
 *  - Inactive-admin denial is fully app-driven: a standby admin signs in
 *    while ACTIVE, then is deactivated through the real admin UI, so their
 *    pre-existing session must be denied by the database-backed guard.
 *
 * Denial replay contract (Astra admin-harness review, findings 4 and 5):
 *  - ALL TEN registered actions are replayed anonymously (middleware
 *    redirect, no leak) and by EVERY authenticated unauthorized persona
 *    (three ordinary roles + the inactive admin).
 *  - Every authenticated denial must carry the EXPECTED authorization-error
 *    signature — HTTP 500 flight response whose dev body contains the module
 *    guard message — not merely any >= 400 status. A mutation followed by an
 *    unrelated server/render failure can no longer satisfy the checks.
 *  - Every unauthorized persona's READ-action denial bodies are checked
 *    against the full sensitive fixture marker set (emails, template
 *    identifiers/content, request identifiers/content) — shared across all
 *    personas, including the inactive admin.
 *  - toggleTemplateStatus denials target ONE DEDICATED witness template per
 *    persona, so repeated unauthorized toggles can never cancel out; the
 *    runner's DB evidence checks each witness independently.
 *
 * Order note: tests are serial; the authorized-admin phase runs before the
 * anonymous/denial replays because the app manifest only carries the admin
 * action ids after the admin pages have compiled in the dev server.
 */

const fixture = createAdminSecurityFixture()
const EMAILS: Record<string, string> = Object.fromEntries(fixture.users.map((u) => [u.id, u.email]))
const LEAK_MARKERS = adminSensitiveLeakMarkers(fixture)

function requireAdminEnv() {
  const baseURL = process.env.ADMIN_TEST_BASE_URL
  const evidenceDir = process.env.ADMIN_EVIDENCE_DIR
  const e2ePassword = process.env.ADMIN_E2E_PASSWORD
  const appDir = process.env.ADMIN_APP_DIR
  if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) {
    throw new Error('admin spec: ADMIN_TEST_BASE_URL must be the owned loopback app URL')
  }
  if (!evidenceDir) throw new Error('admin spec: ADMIN_EVIDENCE_DIR is required')
  if (!e2ePassword) throw new Error('admin spec: ADMIN_E2E_PASSWORD is required')
  if (!appDir) throw new Error('admin spec: ADMIN_APP_DIR is required (read-only view of the isolated app copy)')
  if (process.env.DATABASE_URL) {
    throw new Error('admin spec: refusing to run with a DATABASE_URL — browser/HTTP evidence only')
  }
  return { baseURL, evidenceDir, e2ePassword, appDir }
}

const env = requireAdminEnv()
const appOrigin = new URL(env.baseURL).origin
const originPattern = appOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function newPersonaContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: env.baseURL,
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: path.join(env.evidenceDir, 'videos'), size: { width: 1280, height: 800 } },
  })
}

/**
 * Persona context lifecycle via the SHARED REAL SEAM (runPersonaLifecycle —
 * Astra run-7 + round-11 reviews): fixed start/completion/failure marks for
 * context creation, page creation, the sign-in wrapper AND each real
 * signIn await (navigation, email-fill, password-fill, submit-click,
 * URL-wait — the last STARTED operation is identifiable even unfinished);
 * then a deadline-bounded fail-closed close with primary-precedence
 * semantics. Evidence carries only ids, fixed labels, monotonic timestamps,
 * and classifier categories — never credentials, arguments, URLs, error
 * strings, or filepaths. The actual UI/security operations are untouched.
 * The runner-owned boundary remains the final cleanup.
 */
let nextPersonaContextId = 1
const personaPhaseEvidence: PersonaPhaseEvidence[] = []

async function withPersonaContext<T>(
  browser: Browser,
  email: string | null,
  run: (context: BrowserContext, page: Page) => Promise<T>,
): Promise<T> {
  const contextId = nextPersonaContextId++
  const evidence = createPersonaPhaseEvidence(contextId)
  personaPhaseEvidence.push(evidence)
  return runPersonaLifecycle<BrowserContext, Page, T>(
    {
      createContext: () => newPersonaContext(browser),
      createPage: (context) => context.newPage(),
      signIn: email ? (page, innerEvidence) => signIn(page, email, innerEvidence) : undefined,
      callback: (context, page) => run(context, page),
      close: (context) => context.close(),
    },
    evidence,
  )
}

async function signIn(page: Page, email: string, evidence?: PersonaPhaseEvidence): Promise<void> {
  // Each awaited operation gets its own fixed start/completion/failure
  // marks (no arguments, URLs, credentials, or error text — classifier
  // categories only), so a stalled sign-in identifies its pending await.
  const marked = <T>(stage: string, operation: () => Promise<T>): Promise<T> =>
    evidence ? markPersonaOperation(evidence, stage, operation) : operation()
  await marked('sign-in-navigation', () => page.goto('/sign-in'))
  await marked('sign-in-email-fill', () => page.locator('#email').fill(email))
  await marked('sign-in-password-fill', () => page.locator('#password').fill(env.e2ePassword))
  await marked('sign-in-submit-click', () => page.getByRole('button', { name: 'Sign in' }).click())
  await marked('sign-in-url-wait', () => page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 30_000 }))
}

/**
 * Session-preserved proof: the authenticated shell renders (dashboard/admin
 * layouts bounce unauthenticated users to /sign-in instead).
 */
async function expectStillSignedIn(page: Page): Promise<void> {
  await expect(page.locator('main[data-auth-shell]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open user menu' })).toBeVisible()
}

/**
 * Shared exact Internal Name row locator for the admin templates table
 * (Astra harness repair review P1): row selection must NEVER be
 * substring-based — every template-toggle-guard-* witness name CONTAINS the
 * template-toggle control target, so `hasText` row matching selects five
 * rows and trips Playwright strict mode before any coverage runs. Scoping to
 * the exact Internal Name cell keeps every template row locator unique; the
 * selection semantics are locked against the COMPLETE fixture (all four
 * witnesses included) by tests/regression/admin-security-fixture.test.ts
 * (adminTemplateRowMatchesInternalName).
 */
function templateRow(page: Page, internalName: string): Locator {
  return page.locator('tr').filter({ has: page.getByRole('cell', { name: internalName, exact: true }) })
}

// ---------------------------------------------------------------------------
// Action-wire helpers (real protocol)
// ---------------------------------------------------------------------------

// The action-wire CAPTURE hook (page request interception) lives in
// tests/support/admin-security/admin-action-wire-capture.ts: it is
// lifecycle-safe (tracked pending captures, detach, drain-and-propagate
// settle) so a pending request.allHeaders() rejection can never race
// context teardown as an unhandled rejection (isolated run 3 failure).
// Its contract is locked by tests/regression/admin-action-wire-capture.test.ts.

interface ActionWireInput {
  path: string
  actionId: string
  args: readonly unknown[]
  stateTree?: string | null
  nextUrl?: string | null
}

async function postActionWire(context: BrowserContext, wire: ActionWireInput): Promise<APIResponse> {
  const headers: Record<string, string> = {
    'next-action': wire.actionId,
    accept: 'text/x-component',
  }
  if (wire.stateTree) headers['next-router-state-tree'] = wire.stateTree
  if (wire.nextUrl) headers['next-url'] = wire.nextUrl
  // maxRedirects 0 keeps the middleware's anonymous redirect observable
  // instead of silently following it into the sign-in page. The plain-string
  // body is decoded by Next's non-multipart action path regardless of
  // content-type (verified in next/dist server action-handler).
  return context.request.post(wire.path, {
    headers,
    data: encodeActionArgsBody(wire.args),
    maxRedirects: 0,
    failOnStatusCode: false,
  })
}

async function assertActionNotFoundHeaderAbsent(response: APIResponse, label: string): Promise<void> {
  const headers = await response.headers()
  expect(headers['x-nextjs-action-not-found'] ?? null, `${label}: action id must be recognized by the app`).toBeNull()
}

/**
 * Expected DENIAL signature for an authenticated unauthorized persona
 * (Astra finding 5), statically validated against the framework sources of
 * next 15.5.23 (the runner spawns `next dev`):
 *
 *  - node_modules/next/dist/server/app-render/action-handler.js: a fetch
 *    action whose action function throws (the guard throws BEFORE any
 *    read/write) answers with `res.statusCode = 500` and a flight response —
 *    there is no other status for a throwing action, so "any >= 400" would
 *    also accept middleware bounces (3xx) and unrelated failures;
 *  - node_modules/next/dist/server/app-render/app-render.js: the rejected
 *    action result is part of the flight payload (`a: options.actionResult`);
 *  - react-server-dom-webpack DEV serialization
 *    (server.node.development.js, emitErrorChunk) writes the rejected
 *    promise's `message` into the stream, so the body carries the module's
 *    exact guard error text (locked against the sources by
 *    tests/regression/admin-action-wire.test.ts).
 *
 * Returns the response body for the caller's leak checks.
 */
async function expectDeniedByGuard(response: APIResponse, label: string, spec: GuardedActionSpec): Promise<string> {
  expect(
    response.status(),
    `${label} ${spec.exportName} must be denied by the guard with the framework's exact 500 action-error status, got ${response.status()}`
  ).toBe(500)
  const headers = await response.headers()
  expect(headers['location'] ?? null, `${label} ${spec.exportName}: denial must not be a redirect`).toBeNull()
  expect(
    (headers['content-type'] ?? '').startsWith('text/x-component'),
    `${label} ${spec.exportName}: denial must be a flight response`
  ).toBe(true)
  await assertActionNotFoundHeaderAbsent(response, `${label} ${spec.exportName}`)
  const body = await response.text()
  expect(
    body,
    `${label} ${spec.exportName}: dev flight body must carry the authorization-error signature of ${spec.file}`
  ).toContain(spec.guardMessage)
  return body
}

/**
 * Shared read-body leak check (Astra finding 4): every unauthorized persona
 * — ordinary roles, the inactive admin, and the anonymous redirect — gets
 * the SAME sensitive-marker set: fixture emails, template identifiers and
 * content, request identifiers and content.
 */
function expectNoFixtureLeaks(label: string, exportName: string, body: string): void {
  for (const { marker, kind } of LEAK_MARKERS) {
    expect(body, `${label} ${exportName} must not leak ${kind} fixture data (${marker})`).not.toContain(marker)
  }
}

/** Resolve the app-generated action ids from THIS run's manifest (bounded retry while dev compiles). */
async function resolveAllGuardedActionIds(): Promise<Map<string, string>> {
  const manifestPath = path.join(env.appDir, '.next', 'server', 'server-reference-manifest.json')
  const deadline = Date.now() + 60_000
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      const ids = parseServerReferenceManifest(readFileSync(manifestPath, 'utf8'))
      for (const spec of ADMIN_GUARDED_ACTION_EXPORTS) {
        findActionId(ids, spec.file, spec.exportName)
      }
      return ids
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
  }
  throw new Error(
    `admin spec: could not resolve every guarded action id from the app manifest within 60s: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}

/**
 * Denial-replay arguments. They deliberately target NEVER-control-touched
 * guard records, so a broken guard leaves visible final-state evidence:
 *  - user actions target user-eng-member-general / user-admin-standby
 *    (monotonic mutations — always visible in the runner DB evidence);
 *  - template setDefault/delete/get actions target the shared template-guard
 *    (monotonic mutations — always visible);
 *  - toggleTemplateStatus targets the persona's OWN dedicated witness
 *    template (ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES): the toggle is
 *    self-inverse, so a single shared target could let four unauthorized
 *    replays cancel out and hide a broken guard (Astra finding 5). The
 *    anonymous replay cannot execute any action (middleware redirects first)
 *    and uses the shared template-guard.
 */
function denialArgs(exportName: string, persona?: AdminDenialPersonaKey): readonly unknown[] {
  switch (exportName) {
    case 'getUsers':
      return []
    case 'getUser':
      return ['user-eng-member-general']
    case 'getTemplates':
      return []
    case 'getTemplate':
      return ['template-guard']
    case 'resetUserPassword':
      return ['user-eng-member-general', 'Denied-Replay-999!']
    case 'toggleTemplateStatus':
      return [persona ? ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES[persona] : 'template-guard']
    case 'setTemplateDefault':
      return ['template-guard']
    case 'deleteTemplate':
      return ['template-guard']
    case 'deactivateUser':
      return ['user-eng-member-general']
    case 'activateUser':
      return ['user-admin-standby']
    default:
      throw new Error(`admin spec: no denial args defined for ${exportName}`)
  }
}

/** Shared serial state; contexts are closed in afterAll. */
const state: {
  admin?: BrowserContext
  standby?: BrowserContext
  actionIds?: Map<string, string>
  requiredActionMapping?: readonly RequiredActionMappingEntry[]
  stateTrees: Record<string, string | null>
  wireCapture?: ActionWireCapture
} = { stateTrees: {} }

test.describe.configure({ mode: 'serial' })

test.afterAll(async ({}, testInfo) => {
  // Settlement + evidence + disposal via the reviewed integration seam
  // (Astra round-6): bounded settle → close every context → serialize +
  // attach the sanitized diagnostic artifact AFTER cleanup → UNCONDITIONAL
  // dispose of every page listener. An attachment/serialization failure
  // never skips disposal; a settlement failure stays the PRIMARY error;
  // with no primary, the evidence failure itself propagates. The artifact
  // is a point-in-time snapshot after cleanup — later errors stay handled
  // in memory but are not streamed. context.close() awaits remain
  // unbounded (pre-existing browser semantics — not claimed otherwise).
  // Ordering locked by tests/regression/admin-action-wire-capture.test.ts
  // (settleThenPersistAndDispose seam tests).
  let primary: unknown
  let hasPrimary = false
  try {
    await settleThenPersistAndDispose(state.wireCapture, [state.admin, state.standby], {
      attachDiagnostics: (serialized) =>
        testInfo.attach('admin-action-wire-capture-diagnostics', {
          body: serialized,
          contentType: 'application/json',
        }),
    })
  } catch (error) {
    hasPrimary = true
    primary = error
  }
  // Persona phase-timing evidence (run-7 review): bounded, sanitized, and
  // persisted AFTER the capture/cleanup seam so an evidence-persistence
  // failure can never prevent cleanup or mask the primary failure.
  try {
    await testInfo.attach('admin-persona-phase-timing', {
      body: JSON.stringify(personaPhaseEvidence.map((evidence) => JSON.parse(evidence.serialize()))),
      contentType: 'application/json',
    })
  } catch (evidenceError) {
    if (!hasPrimary) throw evidenceError
  }
  if (hasPrimary) throw primary
})

// ---------------------------------------------------------------------------
// A2/A3 role-aware denial destinations with same-origin/session preservation
// (no action ids needed — pure page-level behavior)
// ---------------------------------------------------------------------------

test('engineering ROLE user: /admin denial lands on /engineering on the same origin, session preserved', async ({ browser }) => {
  await withPersonaContext(browser, EMAILS['user-engineering'], async (_context, page) => {
    await page.goto('/admin/users')
    await expect(page).toHaveURL(new RegExp(`^${originPattern}/engineering`))
    await expectStillSignedIn(page)
  })
})

test('engineering MEMBERSHIP without engineering role still lands on /requests', async ({ browser }) => {
  await withPersonaContext(browser, EMAILS['user-eng-member-general'], async (_context, page) => {
    await page.goto('/admin/users')
    await expect(page).toHaveURL(new RegExp(`^${originPattern}/requests`))
    await expectStillSignedIn(page)
  })
})

test('general_dept user: /admin denial lands on /requests, session preserved', async ({ browser }) => {
  await withPersonaContext(browser, EMAILS['user-general'], async (_context, page) => {
    await page.goto('/admin/users')
    await expect(page).toHaveURL(new RegExp(`^${originPattern}/requests`))
    await expectStillSignedIn(page)
  })
})

// ---------------------------------------------------------------------------
// Standby admin: mint a REAL session while ACTIVE (deactivated later, in the
// admin phase, through the real UI — the app-driven inactive-admin persona)
// ---------------------------------------------------------------------------

test('standby admin signs in while active (session minted for the later inactive-admin denial)', async ({ browser }) => {
  state.standby = await newPersonaContext(browser)
  const page = await state.standby.newPage()
  await signIn(page, EMAILS['user-admin-standby'])
  // Active admin CAN open admin pages right now.
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// A4 + A1 authorized admin: page access, manifest action ids, read-action
// positive controls, UI-driven mutating controls with real wire capture
// ---------------------------------------------------------------------------

test('authorized admin: pages render, all ten guarded action ids resolve, read-action controls return real data', async ({ browser }, testInfo) => {
  state.admin = await newPersonaContext(browser)
  const page = await state.admin.newPage()
  await signIn(page, EMAILS['user-admin'])

  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  // Authorized-admin page access doubles as the getUsers server-render proof.
  for (const id of ['user-target', 'user-engineering', 'user-eng-member-general']) {
    await expect(page.locator('tr', { hasText: EMAILS[id] })).toBeVisible()
  }

  await page.goto('/admin/templates')
  await expect(page.getByRole('heading', { name: 'Request Templates' })).toBeVisible()
  for (const template of fixture.templates) {
    await expect(templateRow(page, template.name)).toBeVisible()
  }

  // Both admin pages compiled: the app-generated manifest must now carry
  // every guarded export (a missing id fails loudly = explicit coverage gap).
  state.actionIds = await resolveAllGuardedActionIds()
  expect(state.actionIds.size).toBeGreaterThanOrEqual(20)

  // Astra run-6 review — runtime-derived conditional capture: resolve the
  // six REQUIRED ui-wire exports' IDs from THIS run's manifest (never a
  // hardcoded ID or pathname — the run-6 stuck ID's export identity is
  // unknown). Resolution fails closed on missing/duplicate IDs; the safe
  // bounded export→ID mapping is persisted immediately (export names and
  // IDs only — no bodies, credentials, or loader paths), and only THEN is
  // the capture installed — before any mutation control runs — restricted
  // to that explicit set. Unrelated actions are evidenced as not-required
  // but never invoke allHeaders(); if the stuck ID resolves as required,
  // its capture/failure stays (no silent ignore).
  state.requiredActionMapping = resolveRequiredUiWireActionIds(state.actionIds)
  await testInfo.attach('admin-required-action-id-mapping', {
    body: serializeRequiredActionMapping(state.requiredActionMapping),
    contentType: 'application/json',
  })
  state.wireCapture = captureActionWires(page, {
    requiredActionIds: state.requiredActionMapping.map((entry) => entry.actionId),
  })

  // Read-action positive controls: protocol-identical constructed bodies
  // must return REAL data for the authorized admin — this validates the wire
  // encoding before any denial replay relies on it.
  const readControls: Array<{ file: AdminActionFile; exportName: string; path: string; args: readonly unknown[]; marker: string }> = [
    { file: 'server-actions/users.ts', exportName: 'getUsers', path: '/admin/users', args: [], marker: EMAILS['user-target'] },
    { file: 'server-actions/users.ts', exportName: 'getUser', path: '/admin/users', args: ['user-target'], marker: EMAILS['user-target'] },
    { file: 'server-actions/templates.ts', exportName: 'getTemplates', path: '/admin/templates', args: [], marker: 'template-anchor' },
    { file: 'server-actions/templates.ts', exportName: 'getTemplate', path: '/admin/templates', args: ['template-anchor'], marker: 'template-anchor' },
  ]
  for (const control of readControls) {
    const response = await postActionWire(state.admin, {
      path: control.path,
      actionId: findActionId(state.actionIds, control.file, control.exportName),
      args: control.args,
    })
    expect(response.status(), `${control.exportName} authorized control status`).toBe(200)
    await assertActionNotFoundHeaderAbsent(response, `${control.exportName} authorized control`)
    expect((response.headers()['content-type'] ?? '').startsWith('text/x-component'), `${control.exportName} authorized RSC payload`).toBe(true)
    const body = await response.text()
    expect(body, `${control.exportName} authorized control must return the real fixture data`).toContain(control.marker)
  }
})

test('authorized admin: real UI controls mutate disposable fixtures and capture the six mutating action wires', async () => {
  const page = state.admin!.pages()[0]

  // --- users page ---------------------------------------------------------
  await page.goto('/admin/users')
  const targetRow = page.locator('tr', { hasText: EMAILS['user-target'] })
  const standbyRow = page.locator('tr', { hasText: EMAILS['user-admin-standby'] })

  // deactivateUser (disposable target)
  await targetRow.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitem', { name: 'Deactivate' }).click()
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click()
  await expect(targetRow.getByText('Inactive')).toBeVisible({ timeout: 30_000 })

  // activateUser (target restored)
  await targetRow.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitem', { name: 'Activate' }).click()
  await expect(targetRow.getByText('Active', { exact: true })).toBeVisible({ timeout: 30_000 })

  // resetUserPassword (target's password — disposable fixture record)
  await targetRow.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitem', { name: 'Reset Password' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('#newPassword').fill('Reset-Control-123!')
  await dialog.locator('#confirmPassword').fill('Reset-Control-123!')
  await dialog.getByRole('button', { name: 'Reset Password' }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })

  // deactivateUser (standby admin) — turns the standby context into the
  // app-driven inactive-admin persona for the denial phase.
  await standbyRow.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitem', { name: 'Deactivate' }).click()
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click()
  await expect(standbyRow.getByText('Inactive')).toBeVisible({ timeout: 30_000 })

  // --- templates page -----------------------------------------------------
  await page.goto('/admin/templates')
  const toggleRow = templateRow(page, 'template-toggle')
  const defaultRow = templateRow(page, 'template-default')
  const deleteRow = templateRow(page, 'template-delete')

  // toggleTemplateStatus (template-toggle: active → inactive)
  await toggleRow.getByTitle('Deactivate').click()
  await expect(toggleRow.getByText('Inactive')).toBeVisible({ timeout: 30_000 })

  // setTemplateDefault (template-default becomes the only default)
  await defaultRow.getByRole('button', { name: 'Set as Default' }).click()
  await expect(defaultRow.getByText('Yes')).toBeVisible({ timeout: 30_000 })

  // deleteTemplate (template-delete) — native confirm() dialog
  page.once('dialog', (dialog) => void dialog.accept())
  await deleteRow.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(deleteRow).toHaveCount(0, { timeout: 30_000 })

  // --- wire capture bookkeeping -------------------------------------------
  // Astra fresh run-4 review: detach IMMEDIATELY after the final UI
  // assertion, BEFORE draining — collection freezes the moment the six
  // mutating wires have fired, so unrelated late traffic can no longer
  // enter the settlement set (already-pending headers are unaffected).
  state.wireCapture!.detach()
  await page.waitForTimeout(1_000)
  // Bounded diagnostic settlement: a never-settling allHeaders() fails
  // visibly as CaptureSettlementTimeoutError carrying sanitized
  // pending-request metadata (never timeout-as-success) instead of hanging
  // the test; real capture errors still propagate raw. The wire assertions
  // below still require ALL SIX captures with byte-identical bodies.
  await state.wireCapture!.settle()
  const expectedCaptures: Array<{ file: AdminActionFile; exportName: string; args: readonly unknown[] }> = [
    { file: 'server-actions/users.ts', exportName: 'deactivateUser', args: ['user-target'] },
    { file: 'server-actions/users.ts', exportName: 'activateUser', args: ['user-target'] },
    { file: 'server-actions/users.ts', exportName: 'resetUserPassword', args: ['user-target', 'Reset-Control-123!'] },
    { file: 'server-actions/templates.ts', exportName: 'toggleTemplateStatus', args: ['template-toggle'] },
    { file: 'server-actions/templates.ts', exportName: 'setTemplateDefault', args: ['template-default'] },
    { file: 'server-actions/templates.ts', exportName: 'deleteTemplate', args: ['template-delete'] },
  ]
  for (const expected of expectedCaptures) {
    const wantedId = findActionId(state.actionIds!, expected.file, expected.exportName)
    const captured = state.wireCapture!.captured.filter((wire) => wire.actionId === wantedId)
    expect(captured.length, `${expected.exportName} must be captured from the real admin UI`).toBeGreaterThanOrEqual(1)
    expect(captured[0].postData, `${expected.exportName} captured wire body must equal the harness encoding`).toBe(
      encodeActionArgsBody(expected.args)
    )
    const pagePath = expected.file === 'server-actions/users.ts' ? '/admin/users' : '/admin/templates'
    if (state.stateTrees[pagePath] === undefined && captured[0].stateTree) {
      state.stateTrees[pagePath] = captured[0].stateTree
    }
  }
})

// ---------------------------------------------------------------------------
// A4 anonymous denial (wire + APIs; needs the manifest from the phase above)
// ---------------------------------------------------------------------------

test('anonymous: admin pages redirect to sign-in, ALL TEN action wires redirect without leak, admin APIs deny', async ({ browser }) => {
  await withPersonaContext(browser, null, async (context, page) => {
    await page.goto('/admin/users')
    // next dev's middleware may normalize the redirect host to localhost for
    // anonymous redirects; what matters is that no admin content is served and
    // the sign-in page carries the admin callbackUrl.
    await expect(page).toHaveURL(/\/sign-in/)
    expect(page.url()).toContain('callbackUrl=%2Fadmin%2Fusers')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

    // Every one of the ten registered actions must be redirected by the
    // middleware — none may execute or leak fixture data (Astra finding 4:
    // the original phase replayed only getUsers).
    for (const spec of ADMIN_GUARDED_ACTION_EXPORTS) {
      const response = await postActionWire(context, {
        path: spec.pagePath,
        actionId: findActionId(state.actionIds!, spec.file, spec.exportName),
        args: denialArgs(spec.exportName),
        stateTree: state.stateTrees[spec.pagePath] ?? null,
      })
      expect(
        response.status(),
        `anonymous ${spec.exportName} POST must be redirected, not executed, got ${response.status()}`
      ).toBeGreaterThanOrEqual(300)
      expect(response.status(), `anonymous ${spec.exportName} must not reach the action`).toBeLessThan(400)
      const headers = await response.headers()
      const location = headers['location'] ?? ''
      expect(
        new URL(location, env.baseURL).pathname,
        `anonymous ${spec.exportName} redirect must target sign-in`
      ).toBe('/sign-in')
      if (spec.capture === 'constructed') {
        expectNoFixtureLeaks('anonymous', spec.exportName, await response.text())
      }
    }

    // Admin APIs: 401 JSON, no redirect, no mutation (DB evidence asserts the
    // archived guard request survived every persona's call).
    for (const apiPath of ['/api/admin/retention/backup', '/api/admin/retention/hard-delete']) {
      const apiResponse = await context.request.post(apiPath, {
        data: JSON.stringify({ requestIds: [fixture.request.id] }),
        headers: { 'content-type': 'application/json' },
        maxRedirects: 0,
        failOnStatusCode: false,
      })
      expect(apiResponse.status(), `${apiPath} anonymous`).toBe(401)
      expect(await apiResponse.json()).toEqual(ADMIN_RETENTION_API_EXPECTATIONS.unauthorizedBody)
    }
  })
})

// ---------------------------------------------------------------------------
// A1 denial replays: all ten guarded actions × every unauthorized persona
// ---------------------------------------------------------------------------

const denialPersonas: Array<{ key: AdminDenialPersonaKey; label: string; email: string }> = [
  { key: 'general-dept', label: 'general_dept', email: EMAILS['user-general'] },
  { key: 'engineering-role', label: 'engineering-role', email: EMAILS['user-engineering'] },
  { key: 'engineering-member', label: 'engineering-member-general-role', email: EMAILS['user-eng-member-general'] },
]

test('unauthorized personas: all ten guarded action POSTs are denied with the guard signature, without mutation', async ({ browser }) => {
  for (const persona of denialPersonas) {
    await withPersonaContext(browser, persona.email, async (context) => {
      for (const spec of ADMIN_GUARDED_ACTION_EXPORTS) {
        const response = await postActionWire(context, {
          path: spec.pagePath,
          actionId: findActionId(state.actionIds!, spec.file, spec.exportName),
          args: denialArgs(spec.exportName, persona.key),
          stateTree: state.stateTrees[spec.pagePath] ?? null,
          nextUrl: spec.pagePath,
        })
        const body = await expectDeniedByGuard(response, persona.label, spec)
        if (spec.capture === 'constructed') {
          expectNoFixtureLeaks(persona.label, spec.exportName, body)
        }
      }
    })
  }
})

test('inactive-admin session (deactivated through the real UI): all ten guarded action POSTs are denied with the guard signature', async () => {
  const context = state.standby!
  for (const spec of ADMIN_GUARDED_ACTION_EXPORTS) {
    const response = await postActionWire(context, {
      path: spec.pagePath,
      actionId: findActionId(state.actionIds!, spec.file, spec.exportName),
      args: denialArgs(spec.exportName, 'inactive-admin'),
      stateTree: state.stateTrees[spec.pagePath] ?? null,
      nextUrl: spec.pagePath,
    })
    const body = await expectDeniedByGuard(response, 'inactive-admin', spec)
    // Shared read-body leak checks apply to the inactive admin too (Astra
    // finding 4: the original loop checked only status/header).
    if (spec.capture === 'constructed') {
      expectNoFixtureLeaks('inactive-admin', spec.exportName, body)
    }
  }
  // Page-level: the deactivated admin's session still passes middleware
  // (valid JWT) and the admin layout (role-only check), but the page's own
  // data loading calls getUsers(), whose guard must throw — so no user rows
  // may render for this session.
  const page = context.pages()[0]
  await page.goto('/admin/users')
  await expect(page.locator('tr', { hasText: EMAILS['user-target'] })).toHaveCount(0)
  await expect(page.locator('tr', { hasText: EMAILS['user-general'] })).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// A1 admin APIs: unauthorized denial + authorized validation-path controls
// (never the destructive success actions)
// ---------------------------------------------------------------------------

test('retention admin APIs: unauthorized personas denied; authorized controls pass auth via validation errors only', async ({ browser }) => {
  const unauthorized: Array<{ label: string; context: BrowserContext }> = []
  for (const persona of denialPersonas) {
    // Persona contexts are guaranteed-closed even if an assertion fails.
    const context = await newPersonaContext(browser)
    try {
      const page = await context.newPage()
      await signIn(page, persona.email)
      unauthorized.push({ label: persona.label, context })
    } catch (error) {
      await context.close().catch(() => undefined)
      throw error
    }
  }
  unauthorized.push({ label: 'inactive-admin', context: state.standby! })

  try {
    for (const entry of unauthorized) {
      for (const apiPath of ['/api/admin/retention/backup', '/api/admin/retention/hard-delete']) {
        const response = await entry.context.request.post(apiPath, {
          data: JSON.stringify({ requestIds: [fixture.request.id] }),
          headers: { 'content-type': 'application/json' },
          maxRedirects: 0,
          failOnStatusCode: false,
        })
        expect(response.status(), `${entry.label} ${apiPath}`).toBe(401)
        expect(await response.json(), `${entry.label} ${apiPath} body`).toEqual(ADMIN_RETENTION_API_EXPECTATIONS.unauthorizedBody)
      }
    }
  } finally {
    for (const entry of unauthorized) {
      if (entry.label !== 'inactive-admin') await entry.context.close().catch(() => undefined)
    }
  }

  // Anonymous: auth precedes validation even for an empty list.
  await withPersonaContext(browser, null, async (context) => {
    const anonymousBackup = await context.request.post('/api/admin/retention/backup', {
      data: JSON.stringify({ requestIds: [] }),
      headers: { 'content-type': 'application/json' },
      failOnStatusCode: false,
    })
    expect(anonymousBackup.status(), 'anonymous empty-list backup must still be 401').toBe(401)
    expect(await anonymousBackup.json()).toEqual(ADMIN_RETENTION_API_EXPECTATIONS.unauthorizedBody)
  })

  // Authorized controls deliberately stop at the routes' validation-error
  // paths: 400/404 here PROVES the 401 authorization gate was passed without
  // generating a backup zip or hard-deleting anything. The expected messages
  // are pinned to the ACTUAL sources (Astra finding 2: the empty-array branch
  // of the backup route answers "Select at least one request", NOT the later
  // "Select between 1 and N requests" branch).
  const adminBackupEmpty = await state.admin!.request.post('/api/admin/retention/backup', {
    data: JSON.stringify({ requestIds: [] }),
    headers: { 'content-type': 'application/json' },
    failOnStatusCode: false,
  })
  expect(adminBackupEmpty.status(), 'authorized backup passes auth (validation error, NOT a zip)').toBe(400)
  expect((await adminBackupEmpty.json()).error, 'authorized backup empty-list validation message').toContain(
    ADMIN_RETENTION_API_EXPECTATIONS.backup.emptyRequestIdsMessage
  )

  const adminBackupUnknownId = await state.admin!.request.post('/api/admin/retention/backup', {
    data: JSON.stringify({ requestIds: ['request-does-not-exist'] }),
    headers: { 'content-type': 'application/json' },
    failOnStatusCode: false,
  })
  expect(adminBackupUnknownId.status(), 'authorized backup with unknown id reaches the read-only lookup (404, NOT a zip)').toBe(404)

  const adminHardDeleteEmpty = await state.admin!.request.post('/api/admin/retention/hard-delete', {
    data: JSON.stringify({ requestIds: [] }),
    headers: { 'content-type': 'application/json' },
    failOnStatusCode: false,
  })
  expect(adminHardDeleteEmpty.status(), 'authorized hard-delete passes auth (validation error, NO deletion)').toBe(400)
  expect((await adminHardDeleteEmpty.json()).error, 'authorized hard-delete empty-list validation message').toContain(
    ADMIN_RETENTION_API_EXPECTATIONS.hardDelete.emptyRequestIdsMessage
  )
})

// ---------------------------------------------------------------------------
// Final authorized read-back (through the app, not just the runner's psql)
// ---------------------------------------------------------------------------

test('final authorized read-back: denial replays changed nothing the controls did not do', async () => {
  const page = state.admin!.pages()[0]

  await page.goto('/admin/users')
  const guardRow = page.locator('tr', { hasText: EMAILS['user-eng-member-general'] })
  await expect(guardRow.getByText('Active', { exact: true }), 'denial replay target must still be active').toBeVisible()
  const targetRow = page.locator('tr', { hasText: EMAILS['user-target'] })
  await expect(targetRow.getByText('Active', { exact: true }), 'authorized activate control result intact').toBeVisible()
  const standbyRow = page.locator('tr', { hasText: EMAILS['user-admin-standby'] })
  await expect(standbyRow.getByText('Inactive'), 'authorized deactivate control result intact').toBeVisible()

  await page.goto('/admin/templates')
  for (const expected of expectedFinalTemplateStates()) {
    const row = templateRow(page, expected.id)
    if (expected.present) {
      await expect(row).toBeVisible()
      // Exact match is mandatory: every template-toggle-guard-* witness
      // name/title/description contains "inactive-admin", whose substring
      // also matches 'Active'/'Inactive' in those cells (browser strict-mode
      // violation). Locked by tests/regression/admin-security-fixture.test.ts
      // (adminTemplateRowNonStatusText).
      await expect(
        row.getByText(expected.isActive ? 'Active' : 'Inactive', { exact: true }),
        `${expected.id} final status must read exactly ${expected.isActive ? 'Active' : 'Inactive'}`,
      ).toBeVisible()
    } else {
      await expect(row).toHaveCount(0)
    }
  }
})
