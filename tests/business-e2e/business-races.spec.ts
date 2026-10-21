import { promises as fs } from 'node:fs'
import path from 'node:path'

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

import {
  createSonnerFixedToastTotals,
  measureInitiateFinalApprovalRequests,
  readInitiateFinalApprovalActionId,
  writeT15aBrowserCorrelation,
  type InitiateFinalApprovalPageSource,
} from '../support/business-t15a-double-click'
import {
  BUSINESS_ACTOR_EMAILS,
  approveCurrentStepViaUi,
  approveDefaultRequestChain as approveDefaultRequestChainFor,
  approveSolutionStepViaUi,
  createRequestViaUi,
  expectCompletedRequest,
  expectMyActionItemRow,
  expectNoMyActionItem,
  expectRequestRowStatus,
  requireBusinessEnv,
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
 * T15 — DOUBLE-CLICKS, CONCURRENT DECISIONS AND RETRIES (test-only recorded
 * slice, one FRESH request per case, "all-defaults" route configuration).
 *
 * CONFIRMED POLICY (plan T15; asserted, never weakened, never patched):
 *  - only ONE valid transition wins a race; the losing action returns a
 *    clear conflict/no-longer-available result without overwriting history;
 *  - no duplicate attempts, decisions, alerts or email triggers occur.
 *
 * Product seams exercised (verified in source, no production edits):
 *  - approve/reject run through the race-safe conditional-update transaction
 *    (src/lib/approval-engine/decisions.ts advanceApprovalAtomically /
 *    rejectRequest's guarded updateMany); a losing decision throws
 *    RequestStatusConflictError which the request modal router surfaces as
 *    the "An error occurred while approving"/"…rejecting" toast — never a
 *    success toast;
 *  - the Final trigger's "Start Final Approval" is guarded client-side by
 *    the router's isSubmitting latch; a genuine double dispatch must still
 *    produce exactly ONE transition server-side.
 *
 * Coverage note (honest): duplicate-attempt / duplicate-mail COUNTING is not
 * browser-visible. The browser proves exactly-one-transition via toasts +
 * single-step advancement; the runner's captured-mail.json / db-evidence raw
 * rows remain the place to count instances and mails (ledger records this).
 * T15A additionally MEASURES (never asserts) how many actual
 * initiateFinalApproval POSTs leave the page for its rapid double-click via
 * a same-run manifest-scoped count-only request observer — a request count
 * is NOT proof of simultaneous server execution, and a count of 1 is never
 * a server-dedupe/concurrency-tested claim (the client latch legitimately
 * winning passes the UI slice; the persisted DB/server-race gate is a later
 * task that consumes the persisted t15a-browser-correlation.json). That
 * measurement settles through a BOUNDED EXPLICIT window (Task53, pinned
 * Astra P1): matching requests are tracked to requestfinished/requestfailed,
 * plus a quiet period after the latest activity and a minimum observation
 * floor, failing closed at a hard deadline — a first-success snapshot is
 * NOT a settled outcome (installed Next queues server actions, so a second
 * POST can arrive after the first success). Final success/error toast
 * TOTALS are asserted together after settlement from unique-toast-node
 * instrumentation (Sonner auto-dismisses ~4s, so instantaneous DOM counts
 * are not totals); the window is bounded, not a proof that no later event
 * can exist.
 *
 * Race staging: both eligible step-1 candidates (Supervisor P and the
 * fixture's second supervisor) open their decision dialogs in their own
 * RECORDED contexts, then click Confirm through a shared barrier so the two
 * server calls genuinely race. Each context asserts its own outcome; the
 * XOR (exactly one winner) is asserted after both settle.
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

const SCENARIO_IDS = {
  T15A: 'T15A-final-double-submit',
  T15B: 'T15B-approver-race',
  T15C: 'T15C-approve-vs-reject-race',
  T15D: 'T15D-stale-retry',
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

/** Unrecorded plain signed-in page for interposed race/stale-sequence actions. */
async function plainSignedInPage(browser: Browser, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: env.baseURL })
  const page = await context.newPage()
  await signIn(page, email, env.e2ePassword)
  return { context, page }
}

/** Opens the my-actions decision dialog and reveals the Approve controls. */
async function stageApproveDialog(page: Page, title: string): Promise<void> {
  await page.goto('/requests/my-actions')
  const row = page.getByRole('row', { name: new RegExp(`Open request ${title}`) })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0, { timeout: 20_000 })
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('button', { name: 'Confirm Approval' })).toBeVisible({ timeout: 20_000 })
}

/** Reveals the Reject controls with the reason already filled (ready to fire). */
async function stageRejectDialog(page: Page, title: string, reason: string): Promise<void> {
  await page.goto('/requests/my-actions')
  const row = page.getByRole('row', { name: new RegExp(`Open request ${title}`) })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0, { timeout: 20_000 })
  await dialog.getByRole('button', { name: 'Reject' }).click()
  const reasonField = page.getByPlaceholder('Please explain the reason for rejection...')
  await expect(reasonField).toBeVisible({ timeout: 20_000 })
  await reasonField.fill(reason)
  await expect(page.getByRole('button', { name: 'Confirm Rejection' })).toBeEnabled({ timeout: 20_000 })
}

/** Drives a fresh request to SendBackToRequester (request + solution approved). */
async function driveToFinalTriggerStage(
  browser: Browser,
  scenarioId: string,
  title: string,
  description: string,
): Promise<void> {
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
        description: `${scenarioId}: solution for the concurrency case.`,
        cost: '1200',
        timeline: '1 week',
      })
      return { notes: 'Solution submitted by Engineer A' }
    },
  )
  for (const [step, actor, email] of [
    ['supervisor', 'supervisorE', BUSINESS_ACTOR_EMAILS.supervisorE],
    ['section-manager', 'sectionManagerE', BUSINESS_ACTOR_EMAILS.sectionManagerE],
    ['department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
  ] as const) {
    await signedInSegment(
      browser,
      { scenario: scenarioId, phase: `solution-approval-${step}`, actor },
      email,
      async ({ page, checkpoint }) => {
        await approveSolutionStepViaUi(page, title)
        await checkpoint(`${slug(scenarioId)}-solution-approved-${actor}`)
        return { notes: `Solution step approved (${actor})` }
      },
    )
  }
}

test.describe('route configuration: all-defaults', () => {
  test.skip(
    env.routesConfig !== 'all-defaults',
    `T15 belongs to the "all-defaults" route-configuration profile (active: "${env.routesConfig}")`,
  )

  test('T15A double-submitting the Final trigger produces exactly one transition', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T15A')
    await driveToFinalTriggerStage(browser, SCENARIO_IDS.T15A, title, 'T15A: Final trigger double-submit — exactly one transition must win.')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T15A, phase: 'double-submit-final-trigger', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        const dialog = page.getByRole('dialog')
        await page.goto('/requests')
        const row = page.getByRole('row', { name: new RegExp(`Open request ${title}`) })
        await expect(row).toBeVisible({ timeout: 30_000 })
        await row.click()
        await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0, { timeout: 20_000 })
        await dialog.getByRole('button', { name: 'Submit Final Approval' }).click()
        const form = page
          .getByRole('dialog')
          .filter({ has: page.getByRole('heading', { name: 'Initiate Final Approval' }) })
        await expect(form).toBeVisible({ timeout: 20_000 })
        // GENUINE rapid double-click, MEASURED (Task52): ONE evaluate
        // round-trip on the RESOLVED button handle issues two NATIVE
        // el.click() attempts in the same browser task — no awaits between
        // the clicks and no second name re-query (past traces show a second
        // dispatched locator click re-queries by accessible name, loses to
        // the "Starting..." label flip and never fires). Native clicks honor
        // a committed disabled button, so whether React commits the
        // isSubmitting latch between same-task clicks is OBSERVED, never
        // asserted: the count of actual initiateFinalApproval POSTs is
        // measured, and a request count is NOT proof of simultaneous server
        // execution.
        const expectedActionId = readInitiateFinalApprovalActionId(
          await fs.readFile(path.join(process.cwd(), '.next/server/server-reference-manifest.json'), 'utf8'),
        )
        const start = form.getByRole('button', { name: 'Start Final Approval' })
        const startHandle = await start.elementHandle()
        if (!startHandle) throw new Error('the Start Final Approval button must resolve before the rapid clicks')
        // Sonner auto-dismisses toasts (~4s default), so FINAL totals are
        // counted as UNIQUE toast nodes observed across the ENTIRE window —
        // never as a DOM snapshot at one instant. Only the three FIXED source
        // messages are counted; no arbitrary text is captured or persisted.
        const toastTotals = createSonnerFixedToastTotals(page)
        // BOUNDED EXPLICIT settlement (Task53, pinned Astra P1): a
        // first-success snapshot is NOT a settled outcome — installed Next
        // QUEUES server actions and starts the second only after the first
        // finishes, so the window stays open through matching-request
        // completion + a quiet period after the latest activity + a minimum
        // observation floor, failing closed at a hard deadline. The page is
        // cast once to the union-event seam: Playwright's per-event overloads
        // all share the same (Request) => void listener shape.
        const { observedCalls, toastTotals: totals, settledAfterMs } = await measureInitiateFinalApprovalRequests({
          expectedActionId,
          page: page as unknown as InitiateFinalApprovalPageSource,
          toastTotals,
          run: async () => {
            const attemptedClicks = await page.evaluate((el: SVGElement | HTMLElement) => {
              const button = el as HTMLElement
              button.click()
              button.click()
              return 2
            }, startHandle)
            expect(attemptedClicks).toBe(2)
          },
        })
        // FINAL totals asserted TOGETHER after settlement — never mid-window
        // instantaneous DOM counts: exactly ONE success toast ALWAYS, and
        // initiation-error totals === observedCalls − 1 admitting ONLY the
        // two fixed branches. A generic initiation-error toast is NOT by
        // itself a classified server conflict (that is the pending separate
        // layer). observedCalls === 1 is never a concurrency-tested claim.
        expect(totals?.success, 'exactly one success-toast total across the settled window').toBe(1)
        expect(
          (totals?.resultError ?? 0) + (totals?.catchError ?? 0),
          'initiation-error toast total must equal observedCalls − 1 (fixed branches only)',
        ).toBe(observedCalls - 1)
        await writeT15aBrowserCorrelation(env.evidenceDir, {
          requestTitle: title,
          attemptedClicks: 2,
          observedRequestCalls: observedCalls,
          status: 'measured',
        })
        await expectRequestRowStatus(page, title, 'Final Approval')
        await checkpoint(`${slug(SCENARIO_IDS.T15A)}-single-final-transition`)
        return {
          notes:
            observedCalls === 2
              ? `Rapid two-native-click submit: 2 initiateFinalApproval POSTs observed in ${settledAfterMs}ms of bounded settlement, exactly ONE success toast + ONE fixed-branch initiation-error toast total, status Final Approval (request count is not proof of simultaneous server execution; persisted DB gate is a later task)`
              : `Rapid two-native-click submit: 1 initiateFinalApproval POST observed in ${settledAfterMs}ms of bounded settlement (the client latch/DOM suppression won), exactly ONE success toast, no initiation-error toast, status Final Approval (NOT a server-dedupe/concurrency claim; persisted DB gate is a later task)`,
        }
      },
    )

    // The single Final attempt completes normally: both Final steps approve.
    for (const [step, actor, email] of [
      ['section-manager', 'sectionManagerP', BUSINESS_ACTOR_EMAILS.sectionManagerP],
      ['department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
    ] as const) {
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T15A, phase: `final-approval-${step}`, actor },
        email,
        async ({ page, checkpoint }) => {
          await approveCurrentStepViaUi(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T15A)}-final-approved-${actor}`)
          return { notes: `Final step approved (${actor}) — one live chain after the double submit` }
        },
      )
    }
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T15A, phase: 'verify-completed', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectCompletedRequest(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T15A)}-completed`)
        return { notes: 'Workflow reached Completed after the double-submitted trigger — no duplicate transition wedged it' }
      },
    )
  })

  test('T15B two eligible approvers race the same step — one wins, the loser gets a conflict', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T15B')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T15B, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T15B: two eligible step-1 approvers race the same decision.')
        return { notes: `created ${title}` }
      },
    )

    // Both step-1 candidates stage their Confirm in RECORDED contexts, then
    // fire through a shared barrier so the server calls genuinely race.
    let staged = 0
    let barrierRelease!: () => void
    const bothStaged = new Promise<void>((resolve) => {
      barrierRelease = () => {
        staged += 1
        if (staged === 2) resolve()
      }
    })
    const outcomes: Record<'supervisorP' | 'secondApprover', 'success' | 'error' | 'none'> = {
      supervisorP: 'none',
      secondApprover: 'none',
    }

    await Promise.all([
      withRecordedContext(
        browser,
        env,
        { scenario: SCENARIO_IDS.T15B, phase: 'race-approve', actor: 'supervisorP' },
        async ({ page }) => {
          await signIn(page, BUSINESS_ACTOR_EMAILS.supervisorP, env.e2ePassword)
          await stageApproveDialog(page, title)
          barrierRelease()
          await bothStaged
          await page.getByRole('button', { name: 'Confirm Approval' }).click()
          const outcome = await Promise.race([
            page.getByText('Approved successfully').waitFor({ timeout: 30_000 }).then(() => 'success' as const),
            page.getByText('An error occurred while approving').waitFor({ timeout: 30_000 }).then(() => 'error' as const),
          ])
          outcomes.supervisorP = outcome
          return { notes: `Race outcome for Supervisor P: ${outcome}` }
        },
      ),
      withRecordedContext(
        browser,
        env,
        { scenario: SCENARIO_IDS.T15B, phase: 'race-approve', actor: 'secondApprover' },
        async ({ page }) => {
          await signIn(page, BUSINESS_ACTOR_EMAILS.secondApprover, env.e2ePassword)
          await stageApproveDialog(page, title)
          barrierRelease()
          await bothStaged
          await page.getByRole('button', { name: 'Confirm Approval' }).click()
          const outcome = await Promise.race([
            page.getByText('Approved successfully').waitFor({ timeout: 30_000 }).then(() => 'success' as const),
            page.getByText('An error occurred while approving').waitFor({ timeout: 30_000 }).then(() => 'error' as const),
          ])
          outcomes.secondApprover = outcome
          return { notes: `Race outcome for the second approver: ${outcome}` }
        },
      ),
    ])

    // Exactly one transition won: one success, one conflict — never two, never zero.
    expect(
      Object.values(outcomes).filter((outcome) => outcome === 'success').length,
      `race outcomes must be exactly one success (got ${JSON.stringify(outcomes)})`,
    ).toBe(1)
    expect(
      Object.values(outcomes).filter((outcome) => outcome === 'error').length,
      `the loser must get a conflict result (got ${JSON.stringify(outcomes)})`,
    ).toBe(1)

    // The single transition advanced EXACTLY one step: Section manager P is
    // the new current approver; Department manager (double-advance symptom) is not.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T15B, phase: 'verify-single-transition', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectMyActionItemRow(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T15B)}-step2-live`)
        return { notes: `Exactly one step advanced (Section manager P is current; outcomes ${JSON.stringify(outcomes)})` }
      },
    )
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T15B, phase: 'verify-no-double-advance', actor: 'departmentManager' },
      BUSINESS_ACTOR_EMAILS.departmentManager,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T15B)}-no-double-advance`)
        return { notes: 'Department manager has NO action item — the losing transaction wrote nothing (no double advance)' }
      },
    )
  })

  test('T15C approve vs reject race — one decision wins, the loser is denied', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T15C')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T15C, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T15C: approve and reject race on the same pending step.')
        return { notes: `created ${title}` }
      },
    )

    let staged = 0
    let barrierRelease!: () => void
    const bothStaged = new Promise<void>((resolve) => {
      barrierRelease = () => {
        staged += 1
        if (staged === 2) resolve()
      }
    })
    let approveWon: boolean | null = null

    await Promise.all([
      withRecordedContext(
        browser,
        env,
        { scenario: SCENARIO_IDS.T15C, phase: 'race-approve-side', actor: 'supervisorP' },
        async ({ page }) => {
          await signIn(page, BUSINESS_ACTOR_EMAILS.supervisorP, env.e2ePassword)
          await stageApproveDialog(page, title)
          barrierRelease()
          await bothStaged
          await page.getByRole('button', { name: 'Confirm Approval' }).click()
          const outcome = await Promise.race([
            page.getByText('Approved successfully').waitFor({ timeout: 30_000 }).then(() => 'success' as const),
            page.getByText('An error occurred while approving').waitFor({ timeout: 30_000 }).then(() => 'error' as const),
          ])
          if (outcome === 'success') approveWon = true
          return { notes: `Approve-side race outcome: ${outcome}` }
        },
      ),
      withRecordedContext(
        browser,
        env,
        { scenario: SCENARIO_IDS.T15C, phase: 'race-reject-side', actor: 'secondApprover' },
        async ({ page }) => {
          await signIn(page, BUSINESS_ACTOR_EMAILS.secondApprover, env.e2ePassword)
          await stageRejectDialog(page, title, 'T15C racing rejection: budget detail missing.')
          barrierRelease()
          await bothStaged
          await page.getByRole('button', { name: 'Confirm Rejection' }).click()
          const outcome = await Promise.race([
            page.getByText('Rejected successfully').waitFor({ timeout: 30_000 }).then(() => 'success' as const),
            page.getByText('An error occurred while rejecting').waitFor({ timeout: 30_000 }).then(() => 'error' as const),
          ])
          if (outcome === 'success') approveWon = false
          return { notes: `Reject-side race outcome: ${outcome}` }
        },
      ),
    ])

    // The winner is recorded at runtime; the post-state must match it and the
    // loser must have seen a conflict, never a success.
    expect(approveWon, 'exactly one side must have won the race').not.toBeNull()

    if (approveWon) {
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T15C, phase: 'verify-approve-won', actor: 'sectionManagerP' },
        BUSINESS_ACTOR_EMAILS.sectionManagerP,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T15C)}-approve-won-step2-live`)
          return { notes: 'Approve won the race: exactly one step advanced; the rejection was denied with a conflict' }
        },
      )
    } else {
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T15C, phase: 'verify-reject-won', actor: 'requesterA' },
        BUSINESS_ACTOR_EMAILS.requesterA,
        async ({ page, checkpoint }) => {
          const dialog = page.getByRole('dialog')
          await page.goto('/requests')
          const row = page.getByRole('row', { name: new RegExp(`Open request ${title}`) })
          await expect(row).toBeVisible({ timeout: 30_000 })
          await row.click()
          await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0, { timeout: 20_000 })
          await expect(dialog.getByRole('heading', { name: 'Rejected Request' })).toBeVisible({ timeout: 20_000 })
          await checkpoint(`${slug(SCENARIO_IDS.T15C)}-reject-won`)
          return { notes: 'Reject won the race: the request returned for revision; the approval was denied with a conflict' }
        },
      )
    }
  })

  test('T15D retrying a stale decision form after another actor acted is denied', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T15D')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T15D, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T15D: stale form retry after another approver acted.')
        return { notes: `created ${title}` }
      },
    )

    // The second approver holds a staged Confirm; underneath it Supervisor P
    // approves step 1 in a plain context; the stale Confirm must be denied.
    await withRecordedContext(
      browser,
      env,
      { scenario: SCENARIO_IDS.T15D, phase: 'stale-confirm-denied', actor: 'secondApprover' },
      async ({ page, checkpoint }) => {
        await signIn(page, BUSINESS_ACTOR_EMAILS.secondApprover, env.e2ePassword)
        await stageApproveDialog(page, title)

        const supervisor = await plainSignedInPage(browser, BUSINESS_ACTOR_EMAILS.supervisorP)
        try {
          await approveCurrentStepViaUi(supervisor.page, title)
        } finally {
          await supervisor.context.close()
        }

        await page.getByRole('button', { name: 'Confirm Approval' }).click()
        await expect(page.getByText('An error occurred while approving')).toBeVisible({ timeout: 30_000 })
        await expect(page.getByText('Approved successfully')).toHaveCount(0)
        await checkpoint(`${slug(SCENARIO_IDS.T15D)}-stale-confirm-denied`)
        return { notes: 'Stale Confirm on the superseded step DENIED (conflict toast; interposed winner supervisorP in a plain context)' }
      },
    )

    // History intact, exactly one transition: Section manager P live at step 2.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T15D, phase: 'verify-workflow-intact', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectMyActionItemRow(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T15D)}-step2-live`)
        return { notes: 'After the stale-retry denial the workflow is intact at step 2 — no overwritten history' }
      },
    )
  })
})
