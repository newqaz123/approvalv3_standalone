import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

import {
  BUSINESS_ACTOR_EMAILS,
  approveCurrentStepViaUi,
  approveDefaultRequestChain as approveDefaultRequestChainFor,
  approveSolutionStepViaUi,
  createRequestViaUi,
  expectMyActionItemRow,
  expectNoRestartFinalApprovalControl,
  expectNoResubmitRequestControl,
  expectNoResubmitSolutionControl,
  expectRequestRowStatus,
  expectStaleRejectDenied,
  initiateFinalApprovalViaUi,
  rejectCurrentStepViaUi,
  rejectSolutionStepViaUi,
  requireBusinessEnv,
  resubmitRequestViaUi,
  resubmitSolutionViaUi,
  signIn,
  signedInSegment as signedInSegmentFor,
  slug,
  submitSolutionViaUi,
  uniqueBusinessTitle,
  withRecordedContext,
  type ActorSegmentLabel,
  type BusinessEnv,
  type CheckpointPage,
} from './business-flow-helpers'

/**
 * T14 — REJECTION AND RESUBMISSION (test-only recorded slice, one FRESH
 * request per case, "all-defaults" route configuration).
 *
 * CONFIRMED POLICY (plan T14; asserted, never weakened, never patched):
 *  - a rejection REQUIRES a reason (the UI keeps "Confirm Rejection"
 *    disabled while the reason textarea is empty; the server rejects a
 *    blank reason too — "Comments are required when rejecting");
 *  - the request returns to the correct revision stage: REQUEST rejection
 *    -> requester revises/resubmits (new attempt), SOLUTION rejection ->
 *    the Engineering submitter revises/resubmits, FINAL rejection -> the
 *    request returns to Engineering for redesign/cost change;
 *  - ONLY the permitted actor may revise/resubmit (request ownership /
 *    solution-authorship rules — Final-trigger permission is never confused
 *    with resubmit ownership);
 *  - an OLD STALE rejection is denied: after a resubmit creates a new
 *    attempt, a rejection dialog opened against the superseded step is
 *    refused server-side (canUserApprove resolves the CURRENT pending step
 *    only) — surfaced as the "An error occurred while rejecting" toast,
 *    never "Rejected successfully".
 *
 * Selectors are the proven clean-start reject controls
 * (tests/e2e/clean-start-approval-flow.spec.ts): approver-modal "Reject" ->
 * placeholder reason textarea -> "Confirm Rejection" -> "Rejected
 * successfully"; the solution variant uses solution-modal.tsx
 * "Reject Solution". Resubmit modals: request-resubmit-modal.tsx /
 * submitter-modal.tsx mode "resubmit" / final-approval-resubmit-modal.tsx.
 *
 * The stale-rejection segment holds the rejecting dialog open in its own
 * recorded context while the interposed reject -> resubmit -> approve run in
 * separate UNRECORDED plain contexts (the same multi-context pattern as the
 * clean-start concurrency spec) — the recording covers the stale actor whose
 * denial is the assertion; the interposed actors are named in the notes.
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

const SCENARIO_IDS = {
  T14A: 'T14A-request-reject-resubmit',
  T14B: 'T14B-solution-reject-resubmit',
  T14C: 'T14C-final-reject-resubmit',
} as const

async function signedInSegment(
  browser: Browser,
  label: ActorSegmentLabel,
  actorEmail: string,
  run: (tools: CheckpointPage) => Promise<{ notes: string }>,
): Promise<void> {
  await signedInSegmentFor(browser, env, label, actorEmail, run)
}

/** Unrecorded plain signed-in page for the interposed stale-sequence actions. */
async function plainSignedInPage(browser: Browser, envScope: BusinessEnv, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: envScope.baseURL })
  const page = await context.newPage()
  await signIn(page, email, envScope.e2ePassword)
  return { context, page }
}

async function approveDefaultRequestChain(browser: Browser, scenarioId: string, title: string): Promise<void> {
  await approveDefaultRequestChainFor(browser, env, scenarioId, title)
}

/** Drives a fresh request through Request approval + Engineering solution. */
async function prepareSolutionStage(browser: Browser, scenarioId: string, title: string, description: string): Promise<void> {
  await signedInSegment(
    browser,
    { scenario: scenarioId, phase: 'create-request', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, description)
      return { notes: `created ${title}` }
    },
  )
  await approveDefaultRequestChain(browser, scenarioId, title)
  await signedInSegment(
    browser,
    { scenario: scenarioId, phase: 'submit-solution', actor: 'engineerA' },
    BUSINESS_ACTOR_EMAILS.engineerA,
    async ({ page, checkpoint }) => {
      await submitSolutionViaUi(page, checkpoint, title, {
        title: `Engineering solution for ${title}`,
        description: `${scenarioId}: engineering solution submitted for the rejection case.`,
        cost: '1500',
        timeline: '1 week',
      })
      await checkpoint(`${slug(scenarioId)}-solution-submitted`)
      return { notes: 'Solution submitted by Engineer A' }
    },
  )
}

test.describe('route configuration: all-defaults', () => {
  test.skip(
    env.routesConfig !== 'all-defaults',
    `T14 belongs to the "all-defaults" route-configuration profile (active: "${env.routesConfig}")`,
  )

  test('T14A Request rejection requires a reason; requester resubmits; non-permitted actor denied; stale rejection after resubmit denied', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T14A')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14A, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T14A: REQUEST rejection and resubmission — required reason, permitted reviser, stale rejection denial.')
        return { notes: `created ${title}` }
      },
    )

    // Required reason + rejection by the current step-1 candidate.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14A, phase: 'reject-request', actor: 'supervisorP' },
      BUSINESS_ACTOR_EMAILS.supervisorP,
      async ({ page, checkpoint }) => {
        await rejectCurrentStepViaUi(page, title, 'T14A: request rejected for revision — missing budget detail.', { proveRequiredReason: true })
        await checkpoint(`${slug(SCENARIO_IDS.T14A)}-request-rejected`)
        return { notes: 'Supervisor P rejected the request WITH a required reason (Confirm Rejection stays disabled while the reason is empty)' }
      },
    )

    // Non-permitted actor: Staff B can VIEW the rejected request (sharing ON)
    // but gets NO resubmit control — rejection revision belongs to the requester.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14A, phase: 'negative-non-permitted-resubmit', actor: 'staffB' },
      BUSINESS_ACTOR_EMAILS.staffB,
      async ({ page, checkpoint }) => {
        await expectNoResubmitRequestControl(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T14A)}-staff-b-no-resubmit`)
        return { notes: 'Staff B (viewer) sees the read-only "Rejected Request" view — no Resubmit Request control' }
      },
    )

    // Permitted actor: the requester revises and resubmits (new attempt).
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14A, phase: 'resubmit-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await resubmitRequestViaUi(page, checkpoint, title, 'T14A REVISED: budget detail added after rejection; resubmitted by the original requester.')
        await checkpoint(`${slug(SCENARIO_IDS.T14A)}-request-resubmitted`)
        return { notes: 'Requester resubmitted the revised request — new attempt created' }
      },
    )

    // STALE rejection: the second approver holds a reject dialog opened while
    // attempt-2 step 1 was pending; underneath it Supervisor P rejects
    // attempt 2, the requester resubmits (attempt 3) and Supervisor P
    // approves attempt-3 step 1 — the stale dialog's Confirm Rejection is
    // then denied server-side (current pending step is no longer his).
    await withRecordedContext(
      browser,
      env,
      { scenario: SCENARIO_IDS.T14A, phase: 'stale-reject-after-resubmit-denied', actor: 'secondApprover' },
      async ({ page, checkpoint }) => {
        await signIn(page, BUSINESS_ACTOR_EMAILS.secondApprover, env.e2ePassword)
        await page.goto('/requests/my-actions')
        const row = page.getByRole('row', { name: new RegExp(`Open request ${title}`) })
        await row.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0, { timeout: 20_000 })
        await dialog.getByRole('button', { name: 'Reject' }).click()
        await expect(page.getByPlaceholder('Please explain the reason for rejection...')).toBeVisible({ timeout: 20_000 })

        const supervisor = await plainSignedInPage(browser, env, BUSINESS_ACTOR_EMAILS.supervisorP)
        try {
          await rejectCurrentStepViaUi(supervisor.page, title, 'T14A stale setup: Supervisor P rejects attempt 2.')
        } finally {
          await supervisor.context.close()
        }
        const requester = await plainSignedInPage(browser, env, BUSINESS_ACTOR_EMAILS.requesterA)
        try {
          await resubmitRequestViaUi(requester.page, async () => {}, title, 'T14A REVISED AGAIN: resubmitted (attempt 3) while a stale rejection dialog is held open.')
        } finally {
          await requester.context.close()
        }
        const supervisorAgain = await plainSignedInPage(browser, env, BUSINESS_ACTOR_EMAILS.supervisorP)
        try {
          await approveCurrentStepViaUi(supervisorAgain.page, title)
        } finally {
          await supervisorAgain.context.close()
        }

        await expectStaleRejectDenied(page, 'T14A STALE: rejection of a superseded step after resubmit — must be denied.')
        await checkpoint(`${slug(SCENARIO_IDS.T14A)}-stale-reject-denied`)
        return { notes: 'Stale rejection DENIED after resubmit (interposed actors in plain contexts: supervisorP reject attempt 2, requesterA resubmit attempt 3, supervisorP approve attempt-3 step 1)' }
      },
    )

    // The denial left the workflow intact: the request is live again at
    // step 2 for Section manager P (read-only proof).
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14A, phase: 'verify-attempt-live', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectMyActionItemRow(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T14A)}-attempt-3-live-at-step-2`)
        return { notes: 'After the stale-rejection denial the request is live at step 2 (Section manager P action item) — no corruption from the denial' }
      },
    )
  })

  test('T14B Solution rejection requires a reason; Engineering submitter resubmits; non-permitted actor denied', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T14B')
    await prepareSolutionStage(browser, SCENARIO_IDS.T14B, title, 'T14B: SOLUTION rejection and resubmission — required reason, permitted reviser.')

    // Required reason + rejection by the first solution-step candidate.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14B, phase: 'reject-solution', actor: 'supervisorE' },
      BUSINESS_ACTOR_EMAILS.supervisorE,
      async ({ page, checkpoint }) => {
        await rejectSolutionStepViaUi(page, title, 'T14B: solution rejected — cost estimate lacks vendor breakdown.', { proveRequiredReason: true })
        await checkpoint(`${slug(SCENARIO_IDS.T14B)}-solution-rejected`)
        return { notes: 'Supervisor E rejected the solution WITH a required reason (Confirm Rejection disabled while empty)' }
      },
    )

    // Non-permitted actor: Production 1 Staff B can VIEW the request but has
    // no solution revision rights.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14B, phase: 'negative-non-permitted-resubmit', actor: 'staffB' },
      BUSINESS_ACTOR_EMAILS.staffB,
      async ({ page, checkpoint }) => {
        await expectNoResubmitSolutionControl(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T14B)}-staff-b-no-solution-resubmit`)
        return { notes: 'Staff B (viewer) has NO Resubmit Solution / Submit Solution control — solution revision is Engineering-only' }
      },
    )

    // Permitted actor: the Engineering submitter revises and resubmits.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14B, phase: 'resubmit-solution', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await resubmitSolutionViaUi(page, checkpoint, title, {
          title: `Engineering solution for ${title}`,
          description: 'T14B REVISED: vendor breakdown added after rejection; resubmitted by the Engineering submitter.',
          cost: '1750',
          timeline: '10 days',
        })
        await checkpoint(`${slug(SCENARIO_IDS.T14B)}-solution-resubmitted`)
        return { notes: 'Engineer A resubmitted the revised solution — new solution attempt created' }
      },
    )

    // The new solution attempt is live again for the first solution candidate.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14B, phase: 'verify-attempt-live', actor: 'supervisorE' },
      BUSINESS_ACTOR_EMAILS.supervisorE,
      async ({ page, checkpoint }) => {
        await expectMyActionItemRow(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T14B)}-solution-attempt-live`)
        return { notes: 'After resubmission the solution approval is live again for Supervisor E (action item present)' }
      },
    )
  })

  test('T14C Final rejection requires a reason; Engineering revises the solution; non-permitted actor denied', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T14C')
    await prepareSolutionStage(browser, SCENARIO_IDS.T14C, title, 'T14C: FINAL rejection returns to Engineering — required reason, permitted reviser.')

    // Approve the solution chain, then the requester triggers Final.
    for (const [step, actor, email] of [
      ['supervisor', 'supervisorE', BUSINESS_ACTOR_EMAILS.supervisorE],
      ['section-manager', 'sectionManagerE', BUSINESS_ACTOR_EMAILS.sectionManagerE],
      ['department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
    ] as const) {
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T14C, phase: `solution-approval-${step}`, actor },
        email,
        async ({ page, checkpoint }) => {
          await approveSolutionStepViaUi(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T14C)}-solution-approved-${actor}`)
          return { notes: `Solution step approved (${actor})` }
        },
      )
    }
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14C, phase: 'trigger-final', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await initiateFinalApprovalViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T14C)}-final-triggered`)
        return { notes: 'Final approval triggered by the original requester' }
      },
    )

    // Required reason + rejection by the first Final-step candidate.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14C, phase: 'reject-final', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await rejectCurrentStepViaUi(page, title, 'T14C: final approval rejected — final estimate needs requester confirmation.', { proveRequiredReason: true })
        await checkpoint(`${slug(SCENARIO_IDS.T14C)}-final-rejected`)
        return { notes: 'Section manager P rejected the FINAL approval WITH a required reason (Confirm Rejection disabled while empty)' }
      },
    )

    // Non-permitted actor: Staff B (an authorized Final TRIGGER actor) still
    // has NO restart control — trigger permission is not resubmit ownership.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14C, phase: 'negative-non-permitted-restart', actor: 'staffB' },
      BUSINESS_ACTOR_EMAILS.staffB,
      async ({ page, checkpoint }) => {
        await expectNoRestartFinalApprovalControl(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T14C)}-staff-b-no-restart`)
        return { notes: 'Staff B (authorized trigger actor, but not the requester) has NO Restart Final Approval control' }
      },
    )

    // Requester cannot restart Final; the request is back with Engineering.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14C, phase: 'requester-cannot-restart-final', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectNoRestartFinalApprovalControl(page, title)
        await expectRequestRowStatus(page, title, 'Sent to Engineer')
        await checkpoint(`${slug(SCENARIO_IDS.T14C)}-requester-no-restart`)
        return { notes: 'Requester has NO Restart Final Approval control — Final reject returned the request to Engineering' }
      },
    )

    // Permitted actor: Engineering revises and resubmits the solution.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14C, phase: 'resubmit-solution', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await resubmitSolutionViaUi(page, checkpoint, title, {
          title: `Engineering solution for ${title}`,
          description: 'T14C REVISED: estimate reduced after Final rejection; resubmitted by Engineering.',
          cost: '1600',
          timeline: '9 days',
        })
        await checkpoint(`${slug(SCENARIO_IDS.T14C)}-solution-resubmitted`)
        return { notes: 'Engineer A resubmitted the revised solution after Final rejection' }
      },
    )

    // The new solution attempt is live again for the first solution candidate.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T14C, phase: 'verify-attempt-live', actor: 'supervisorE' },
      BUSINESS_ACTOR_EMAILS.supervisorE,
      async ({ page, checkpoint }) => {
        await expectMyActionItemRow(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T14C)}-solution-attempt-live`)
        return { notes: 'After Engineering resubmit the solution approval is live again for Supervisor E' }
      },
    )
  })
})
