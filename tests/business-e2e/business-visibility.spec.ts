import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

import { BUSINESS_UNITS } from '../support/business-workflow-fixture'

import {
  BUSINESS_ACTOR_EMAILS,
  approveCurrentStepViaUi,
  approveDefaultRequestChain as approveDefaultRequestChainFor,
  approveSolutionStepViaUi,
  createRequestViaUi,
  expectCompletedRequest,
  expectNoMyActionItem,
  expectNoSubmitFinalApprovalControl,
  expectNoSubmitSolutionControl,
  expectRequestNotListed,
  expectRequestRowStatus,
  initiateFinalApprovalViaUi,
  openRequestByTitle,
  requireBusinessEnv,
  signedInSegment as signedInSegmentFor,
  slug,
  submitSolutionViaUi,
  uniqueBusinessTitle,
  withRecordedContext,
  type ActorSegmentLabel,
  type CheckpointPage,
} from './business-flow-helpers'

/**
 * T11 — VISIBILITY AT STAGES, bounded first slice (all-defaults profile).
 *
 * Derived from the seeded fixture tree (tests/support/business-workflow-fixture.ts)
 * Origin-unit sharing (src/lib/organization/sharing.ts):
 *   ON  = sister units under the same parent can see the request
 *   OFF = only the origin unit + managers above it
 * Engineering canWorkOnSolutions still sees SentToEngineer work.
 *
 *  T11A sharing ON: Requester A, Staff B, Engineer A, Department manager,
 *      and Staff C (sister section) YES; inactive NO. Visibility ≠ actions.
 *  T11B sharing OFF: same-section + bosses + Engineering (work access) YES;
 *      Staff C NO. Admin restores ON afterwards.
 *  T11C completed (sharing ON): previous viewers including Staff C still see
 *      it read-only; no unauthorized pending actions.
 *
 *  Bounded-slice exclusions (recorded, never faked):
 *   - Attachments/solution files: BLOCKED for this slice — no proven upload
 *     helper exists for the business fixture (tests/e2e/solution-attachment-upload.spec.ts
 *     is a separate release-gate spec on its own environment, not a reusable
 *     helper). No attachment coverage is claimed here.
 *   - Direct URL access: SKIPPED with this note — the request id is not
 *     exposed in the list UI or URL during this flow (rows open dialogs
 *     without changing the URL). A /requests?requestId=<id> deep-link seam
 *     exists (request-deep-link-modal.tsx) but the id is not obtainable from
 *     browser-only evidence, so denied-actor direct-URL leakage stays
 *     unclaimed in this slice.
 *   - Notification/email recipients: owned by T12/T13; not asserted here.
 *
 * The three tests share ONE request (serial worker, declaration order):
 * T11A / T11B / T11C each use their OWN fresh request so a Playwright worker
 * restart cannot wipe shared module state. Sharing is restored ON at the end
 * of T11B, and T11C begins with an idempotent admin ensure-ON segment so a
 * mid-T11B failure cannot silently leave the
 * fixture sharing OFF.
 *
 * PROFILE GATING: all-defaults only (visibility/sharing semantics do not
 * depend on the route configuration, but this bounded slice records its
 * worksheet expectations against the default chains; under an exception
 * profile the whole file skips with an explicit reason — never a silent
 * pass). No DB-evidence evaluator checks are claimed for T11 (browser-only
 * evidence: per-actor manifest entries, videos, traces, screenshots).
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

// File-level profile gate: skipped (never "pass") under every other route
// configuration, mirroring business-default-workflows.spec.ts.
test.skip(
  env.routesConfig !== 'all-defaults',
  `T11 visibility scenarios belong to the "all-defaults" route-configuration profile (active: "${env.routesConfig}")`,
)

const SCENARIO_IDS = {
  T11A: 'T11A-visibility-sharing-on-awaiting-engineering',
  T11B: 'T11B-visibility-sharing-off-awaiting-engineering',
  T11C: 'T11C-visibility-completed',
} as const

async function signedInSegment(
  browser: Browser,
  label: ActorSegmentLabel,
  actorEmail: string,
  run: (tools: CheckpointPage) => Promise<{ notes: string }>,
): Promise<void> {
  await signedInSegmentFor(browser, env, label, actorEmail, run)
}

async function approveDefaultRequestChain(browser: Browser, scenarioId: string, title: string): Promise<void> {
  await approveDefaultRequestChainFor(browser, env, scenarioId, title)
}

/**
 * T11 inactive-user proof (mirrors the T01/T09A server-denial proof): own
 * recorded context WITHOUT signIn — the shared signIn helper waits for
 * navigation away from /sign-in, which a server-denied inactive sign-in never
 * performs. Assert the server rejection text and that the URL STAYS on
 * /sign-in: inactive users must never gain a session, so they have no list
 * visibility at all.
 */
async function proveInactiveSignInDenied(browser: Browser, scenarioId: string, phase: string): Promise<void> {
  await withRecordedContext(
    browser,
    env,
    { scenario: scenarioId, phase, actor: 'inactiveUser' },
    async ({ page, checkpoint }) => {
      await page.goto('/sign-in')
      await page.locator('#email').fill(BUSINESS_ACTOR_EMAILS.inactiveUser)
      await page.locator('#password').fill(env.e2ePassword)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 20_000 })
      await expect(page).toHaveURL(/\/sign-in/)
      await checkpoint(`${slug(scenarioId)}-${phase}`)
      return { notes: 'Inactive user denied sign-in server-side ("Invalid email or password") — no session, no request-list visibility' }
    },
  )
}

/**
 * Opens the real organization UI's unit manage drawer for the given unit and
 * returns its Request-visibility switch (proven clean-start selectors:
 * unit-header hover → unit-manage → organization-manage-drawer). Default
 * expanded tree rows need no manual expansion.
 */
async function openUnitSharingSwitch(page: Page, unitId: string): Promise<Locator> {
  // First visit of /admin/organization can cold-compile for >30s in the native
  // Next server (T11B 2026-09-18T16-17-39 run: GET 200 in 31.6s vs 30s nav timeout).
  await page.goto('/admin/organization', { timeout: 90_000, waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('organization-tree')).toBeVisible({ timeout: 90_000 })
  const header = page.getByTestId(`unit-header-${unitId}`)
  await header.hover()
  // TEST-ONLY: hover-reveal (`invisible` / group-hover:visible) stays visibility:hidden
  // under Playwright, and force-click still requires a visible box (1.58.2).
  // Unhide the action strip in this page only so the real Manage onClick runs.
  await page.addStyleTag({
    content:
      '[data-testid^="unit-hover-actions-"] { display: flex !important; visibility: visible !important; opacity: 1 !important; }',
  })
  const manage = page.getByTestId(`unit-manage-${unitId}`)
  await expect(manage).toBeVisible({ timeout: 20_000 })
  await manage.click()
  await expect(page.getByTestId('organization-manage-drawer')).toBeVisible({ timeout: 20_000 })
  const sharingSwitch = page.getByTestId('unit-share-requests')
  await expect(sharingSwitch).toBeVisible({ timeout: 20_000 })
  return sharingSwitch
}

/**
 * T11B admin toggle through the REAL org UI: flips Production 1 Section's
 * Request-visibility switch (UnitSidePanel SHARE_REQUESTS_LABEL = 'Share
 * requests within this unit and all its descendants'), saves, then proves
 * the PERSISTED state with a reload — the saved drawer closes itself
 * (owner-approved modal UX), so the tree's sharing badge is the immediate
 * feedback and the reloaded badge is the persisted proof.
 */
async function setProductionSectionSharing(
  browser: Browser,
  scenarioId: string,
  phase: string,
  enabled: boolean,
): Promise<void> {
  await signedInSegment(
    browser,
    { scenario: scenarioId, phase, actor: 'admin' },
    BUSINESS_ACTOR_EMAILS.admin,
    async ({ page, checkpoint }) => {
      const sharingSwitch = await openUnitSharingSwitch(page, BUSINESS_UNITS.productionSection)
      if (enabled) {
        // Restore path: the unit is currently OFF.
        await expect(sharingSwitch).not.toBeChecked()
      } else {
        // Toggle path: the seeded state is ON.
        await expect(sharingSwitch).toBeChecked()
      }
      await sharingSwitch.click()
      await page.getByTestId('unit-settings-save').click()
      const badge = page.getByTestId(`sharing-badge-${BUSINESS_UNITS.productionSection}`)
      if (enabled) {
        await expect(badge).toBeVisible({ timeout: 20_000 })
      } else {
        await expect(badge).toHaveCount(0, { timeout: 20_000 })
      }
      // Persisted-state proof: the setting survived the save round trip.
      await page.reload()
      await expect(page.getByTestId('organization-tree')).toBeVisible({ timeout: 30_000 })
      if (enabled) {
        await expect(page.getByTestId(`sharing-badge-${BUSINESS_UNITS.productionSection}`)).toBeVisible({ timeout: 20_000 })
      } else {
        await expect(page.getByTestId(`sharing-badge-${BUSINESS_UNITS.productionSection}`)).toHaveCount(0, { timeout: 20_000 })
      }
      await checkpoint(`${slug(scenarioId)}-${phase}-sharing-${enabled ? 'on' : 'off'}`)
      return {
        notes: `Admin set Production 1 Section request sharing ${enabled ? 'ON (seed state restored)' : 'OFF'} via the real org UI and proved the persisted state after reload`,
      }
    },
  )
}

/**
 * T11C hygiene segment: idempotently ensure Production 1 Section sharing is
 * back ON (seed state) before completing the workflow, so a T11B failure
 * that left sharing OFF cannot silently change T11C's fixture conditions.
 */
async function ensureProductionSectionSharingOn(browser: Browser, scenarioId: string): Promise<void> {
  await signedInSegment(
    browser,
    { scenario: scenarioId, phase: 'ensure-sharing-on', actor: 'admin' },
    BUSINESS_ACTOR_EMAILS.admin,
    async ({ page, checkpoint }) => {
      const sharingSwitch = await openUnitSharingSwitch(page, BUSINESS_UNITS.productionSection)
      let toggled = false
      if (!(await sharingSwitch.isChecked())) {
        await sharingSwitch.click()
        await page.getByTestId('unit-settings-save').click()
        await expect(page.getByTestId(`sharing-badge-${BUSINESS_UNITS.productionSection}`)).toBeVisible({ timeout: 20_000 })
        toggled = true
      } else {
        await page.keyboard.press('Escape')
      }
      await checkpoint(`${slug(scenarioId)}-sharing-ensured-on`)
      return {
        notes: toggled
          ? 'T11C precondition: sharing had drifted OFF and was restored ON via the real org UI'
          : 'T11C precondition: Production 1 Section sharing already ON (seed state intact)',
      }
    },
  )
}

test('T11A sharing ON at awaiting-Engineering: scoped viewers see the request, sibling/inactive do not; visibility grants no solution or Final action', async ({ browser }) => {
  test.setTimeout(420_000)
  const title = uniqueBusinessTitle('T11A')

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11A, phase: 'create-request', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, 'T11A: visibility at Request approved / awaiting Engineering with Production 1 Section sharing ON.')
      return { notes: `created ${title}` }
    },
  )
  await approveDefaultRequestChain(browser, SCENARIO_IDS.T11A, title)

  // Checkpoint proof: the request waits for Engineering ("Sent to Engineer").
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11A, phase: 'verify-sent-to-engineer', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await expectRequestRowStatus(page, title, 'Sent to Engineer')
      await checkpoint(`${slug(SCENARIO_IDS.T11A)}-sent-to-engineer`)
      return { notes: 'Checkpoint reached: Request approved, awaiting Engineering (sharing ON)' }
    },
  )

  // Staff B — same-unit viewer: LISTED, but visibility grants no action.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11A, phase: 'visibility-staff-b', actor: 'staffB' },
    BUSINESS_ACTOR_EMAILS.staffB,
    async ({ page, checkpoint }) => {
      await expectNoMyActionItem(page, title)
      await expectNoSubmitSolutionControl(page, title, '/requests')
      await expectNoSubmitFinalApprovalControl(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T11A)}-staff-b-viewer-no-actions`)
      return { notes: 'Staff B (Production 1 Section scope) sees the request; no Submit Solution, no Final trigger, no action item' }
    },
  )

  // Engineer A — inherited Production 1 scope (Engineering sharing OFF):
  // LISTED and holds the Submit Solution control (canWorkOnSolutions), but
  // still no Final trigger at this stage.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11A, phase: 'visibility-engineer-a', actor: 'engineerA' },
    BUSINESS_ACTOR_EMAILS.engineerA,
    async ({ page, checkpoint }) => {
      const dialog = await openRequestByTitle(page, title, '/requests')
      await expect(dialog.getByRole('button', { name: 'Submit Solution' })).toBeVisible({ timeout: 20_000 })
      await expect(dialog.getByRole('button', { name: 'Submit Final Approval' })).toHaveCount(0)
      await checkpoint(`${slug(SCENARIO_IDS.T11A)}-engineer-a-sees-and-can-submit-solution`)
      return { notes: 'Engineer A sees the request via the inherited Production 1 sharing scope and HAS the Submit Solution control (visibility ≠ same capability class as viewers); no Final trigger' }
    },
  )

  // Parent Department manager — Production 1 assignment subtree: LISTED,
  // read-only at this checkpoint (no pending step is theirs).
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11A, phase: 'visibility-department-manager', actor: 'departmentManager' },
    BUSINESS_ACTOR_EMAILS.departmentManager,
    async ({ page, checkpoint }) => {
      const dialog = await openRequestByTitle(page, title, '/requests')
      await expect(dialog.getByRole('button', { name: 'Submit Solution' })).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: 'Submit Final Approval' })).toHaveCount(0)
      await checkpoint(`${slug(SCENARIO_IDS.T11A)}-department-manager-viewer-no-actions`)
      return { notes: 'Parent Department manager (Production 1 subtree) sees the request; read-only at awaiting-Engineering' }
    },
  )

  // Staff C — sister section, same department, sharing ON: CAN see, no actions.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11A, phase: 'visibility-staff-c', actor: 'staffC' },
    BUSINESS_ACTOR_EMAILS.staffC,
    async ({ page, checkpoint }) => {
      await expectNoSubmitSolutionControl(page, title, '/requests')
      await expectNoSubmitFinalApprovalControl(page, title)
      await expectNoMyActionItem(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T11A)}-staff-c-sees-no-actions`)
      return { notes: 'Staff C (sister section, sharing ON) can VIEW the request; visibility grants no Submit Solution / Final / action item' }
    },
  )

  // Inactive user: server-denied sign-in — no session, no visibility at all.
  await proveInactiveSignInDenied(browser, SCENARIO_IDS.T11A, 'denial-inactive-sign-in')
})

test('T11B sharing OFF (real org UI toggle): Production 1 subtree + ancestor managers + Engineering (work access) still see the SAME request, sister-section Staff C does not; sharing restored ON', async ({ browser }) => {
  test.setTimeout(480_000)
  const title = uniqueBusinessTitle('T11B')

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11B, phase: 'create-request', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, 'T11B: visibility after Production 1 Section sharing OFF (own fresh request).')
      return { notes: `created ${title}` }
    },
  )
  await approveDefaultRequestChain(browser, SCENARIO_IDS.T11B, title)

  // Admin turns Production 1 Section sharing OFF through the real org UI.
  await setProductionSectionSharing(browser, SCENARIO_IDS.T11B, 'toggle-sharing-off', false)

  // Requester A — own unit's sharing now OFF: inherits Production 1 (nearest
  // sharing-enabled ancestor) → WIDENED to the Production 1 subtree, still
  // listed. Sharing OFF is not private.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11B, phase: 'visibility-requester-a', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await expectRequestRowStatus(page, title, 'Sent to Engineer')
      await expectNoSubmitFinalApprovalControl(page, title, '/requests')
      await checkpoint(`${slug(SCENARIO_IDS.T11B)}-requester-a-still-sees`)
      return { notes: 'Requester A still sees the request after own-unit sharing OFF (inherited Production 1 scope — widened, not private)' }
    },
  )

  // Staff B — same widened Production 1 subtree: still listed; visibility
  // still grants no solution capability.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11B, phase: 'visibility-staff-b', actor: 'staffB' },
    BUSINESS_ACTOR_EMAILS.staffB,
    async ({ page, checkpoint }) => {
      await expectNoSubmitSolutionControl(page, title, '/requests')
      await expectNoSubmitFinalApprovalControl(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T11B)}-staff-b-still-sees-no-actions`)
      return { notes: 'Staff B still sees the request (Production 1 subtree) and still has no Submit Solution / Final control — canWorkOnSolutions is untouched by sharing' }
    },
  )

  // Engineer A — unchanged inherited Production 1 scope: still listed, still
  // holds the Submit Solution control.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11B, phase: 'visibility-engineer-a', actor: 'engineerA' },
    BUSINESS_ACTOR_EMAILS.engineerA,
    async ({ page, checkpoint }) => {
      const dialog = await openRequestByTitle(page, title, '/requests')
      await expect(dialog.getByRole('button', { name: 'Submit Solution' })).toBeVisible({ timeout: 20_000 })
      await checkpoint(`${slug(SCENARIO_IDS.T11B)}-engineer-a-still-can-submit-solution`)
      return { notes: 'Engineer A visibility and solution capability unchanged by the Production 1 Section toggle' }
    },
  )

  // Staff C — sharing OFF on the origin: sister sections cannot see it.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11B, phase: 'visibility-staff-c', actor: 'staffC' },
    BUSINESS_ACTOR_EMAILS.staffC,
    async ({ page, checkpoint }) => {
      await expectRequestNotListed(page, title)
      await expectNoMyActionItem(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T11B)}-staff-c-not-listed-sharing-off`)
      return { notes: 'Staff C cannot see the request while Production 1 Section sharing is OFF' }
    },
  )

  // Restore the seeded sharing ON state through the same real UI path.
  await setProductionSectionSharing(browser, SCENARIO_IDS.T11B, 'restore-sharing-on', true)
})

test('T11C completed request: previous viewers (including sister-section Staff C, sharing ON) still see it read-only with no unauthorized pending actions', async ({ browser }) => {
  test.setTimeout(600_000)
  const title = uniqueBusinessTitle('T11C')

  // Hygiene: sharing back to the seeded ON state (idempotent) before this
  // independent completed-request flow.
  await ensureProductionSectionSharingOn(browser, SCENARIO_IDS.T11C)

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11C, phase: 'create-request', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, 'T11C: completed-request visibility (own fresh request).')
      return { notes: `created ${title}` }
    },
  )
  await approveDefaultRequestChain(browser, SCENARIO_IDS.T11C, title)

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11C, phase: 'submit-solution', actor: 'engineerA' },
    BUSINESS_ACTOR_EMAILS.engineerA,
    async ({ page, checkpoint }) => {
      await submitSolutionViaUi(page, checkpoint, title, {
        title: `Engineering solution for ${title}`,
        description: 'T11C: solution for the completed-request visibility checkpoint.',
        cost: '1200',
        timeline: '2 weeks',
      })
      await checkpoint(`${slug(SCENARIO_IDS.T11C)}-solution-submitted`)
      return { notes: 'Solution submitted by Engineer A to drive the shared request to Completed' }
    },
  )

  for (const [phase, actor, email] of [
    ['solution-approval-supervisor', 'supervisorE', BUSINESS_ACTOR_EMAILS.supervisorE],
    ['solution-approval-section-manager', 'sectionManagerE', BUSINESS_ACTOR_EMAILS.sectionManagerE],
    ['solution-approval-department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
  ] as const) {
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T11C, phase, actor },
      email,
      async ({ page, checkpoint }) => {
        await approveSolutionStepViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T11C)}-solution-approved-${actor}`)
        return { notes: `Solution step approved (${actor})` }
      },
    )
  }

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11C, phase: 'final-trigger', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await initiateFinalApprovalViaUi(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T11C)}-final-initiated`)
      return { notes: 'Final approval triggered by the original requester (Requester A)' }
    },
  )

  for (const [phase, actor, email] of [
    ['final-approval-section-manager', 'sectionManagerP', BUSINESS_ACTOR_EMAILS.sectionManagerP],
    ['final-approval-department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
  ] as const) {
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T11C, phase, actor },
      email,
      async ({ page, checkpoint }) => {
        await approveCurrentStepViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T11C)}-final-approved-${actor}`)
        return { notes: `Final approval step approved (${actor})` }
      },
    )
  }

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11C, phase: 'verify-completed', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await expectCompletedRequest(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T11C)}-completed`)
      return { notes: 'Shared request reached Completed — T11C checkpoint ready' }
    },
  )

  // Staff B — was a viewer at every earlier checkpoint: still listed with the
  // Completed badge and NO unauthorized pending action (terminal request).
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11C, phase: 'completed-visibility-staff-b', actor: 'staffB' },
    BUSINESS_ACTOR_EMAILS.staffB,
    async ({ page, checkpoint }) => {
      await expectRequestRowStatus(page, title, 'Completed')
      await expectNoMyActionItem(page, title)
      const dialog = await openRequestByTitle(page, title, '/requests')
      await expect(dialog.getByRole('button', { name: 'Submit Solution' })).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: 'Submit Final Approval' })).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: /^Approve/ })).toHaveCount(0)
      await checkpoint(`${slug(SCENARIO_IDS.T11C)}-staff-b-completed-read-only`)
      return { notes: 'Staff B still sees the Completed request read-only: no Submit Solution, no Final trigger, no Approve control, no action item' }
    },
  )

  // Engineer A — still sees the completed request he authored the solution
  // for; authorship grants no pending action on a terminal request.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11C, phase: 'completed-visibility-engineer-a', actor: 'engineerA' },
    BUSINESS_ACTOR_EMAILS.engineerA,
    async ({ page, checkpoint }) => {
      const dialog = await openRequestByTitle(page, title, '/requests')
      await expect(dialog.getByText('Final Approval Completed')).toBeVisible({ timeout: 20_000 })
      await expect(dialog.getByRole('button', { name: 'Submit Solution' })).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: 'Submit Final Approval' })).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: /^Approve/ })).toHaveCount(0)
      await checkpoint(`${slug(SCENARIO_IDS.T11C)}-engineer-a-completed-read-only`)
      return { notes: 'Engineer A still sees the Completed request (solution authorship); no pending action offered' }
    },
  )

  // Staff C — sharing ON (restored): sister section can see Completed read-only.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T11C, phase: 'completed-visibility-staff-c', actor: 'staffC' },
    BUSINESS_ACTOR_EMAILS.staffC,
    async ({ page, checkpoint }) => {
      await expectRequestRowStatus(page, title, 'Completed')
      await expectNoMyActionItem(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T11C)}-staff-c-completed-read-only`)
      return { notes: 'Staff C sees the Completed request (sharing ON / same department) read-only' }
    },
  )
})
