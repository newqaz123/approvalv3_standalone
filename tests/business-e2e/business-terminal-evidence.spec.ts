import { expect, test, type Browser } from '@playwright/test'

import {
  BUSINESS_ACTOR_EMAILS,
  approveCurrentStepViaUi,
  approveDefaultRequestChain as approveDefaultRequestChainFor,
  approveSolutionStepViaUi,
  createRequestViaUi,
  expectCompletedRequest,
  expectNoApproveControl,
  expectNoCancelRequestControl,
  expectNoMyActionItem,
  expectNoSubmitFinalApprovalControl,
  expectNoSubmitSolutionControl,
  expectRequestRowStatus,
  initiateFinalApprovalViaUi,
  requireBusinessEnv,
  signedInSegment as signedInSegmentFor,
  slug,
  submitSolutionViaUi,
  uniqueBusinessTitle,
  type ActorSegmentLabel,
  type CheckpointPage,
} from './business-flow-helpers'

/**
 * T20 — COMPLETION, CANCELLATION AND EVIDENCE (test-only recorded slice, one
 * FRESH request per case, "all-defaults" route configuration).
 *
 * CONFIRMED POLICY (plan T20; asserted, never weakened, never patched):
 *  - a valid workflow finishes through every phase with its full audit
 *    history visible (the completed view explains each decision/transition);
 *  - cancellation is permitted where current policy allows it: ONLY the
 *    original requester, in SentToEngineer/SendBackToRequester with no
 *    pending approvals, with a reason;
 *  - terminal requests (Completed, Cancelled) expose NO further unauthorized
 *    workflow actions to viewers, trigger actors, or former approvers;
 *  - cleanup touches ONLY the isolated owned test runtime — the native
 *    runner already asserts this itself (runner-lifecycle sweeps the owned
 *    ports/runtime and records cleanupFailures in run-summary.json); this
 *    spec adds no cleanup of its own and claims none.
 *
 * Coverage note (honest): email/notification recipients for the completion
 * and cancellation transitions are owned by the T12/T13 evaluators, not
 * re-asserted here. No attachments are uploaded (unchanged slice boundary).
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

const SCENARIO_IDS = {
  T20A: 'T20A-completed-audit-and-lockdown',
  T20B: 'T20B-cancellation-and-lockdown',
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

test.describe('route configuration: all-defaults', () => {
  test.skip(
    env.routesConfig !== 'all-defaults',
    `T20 belongs to the "all-defaults" route-configuration profile (active: "${env.routesConfig}")`,
  )

  test('T20A a completed workflow keeps its audit history and exposes no further actions', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T20A')

    // Finish a valid all-defaults workflow end to end on a FRESH request.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20A, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T20A: a valid workflow driven to Completed for audit and terminal-lockdown evidence.')
        return { notes: `created ${title}` }
      },
    )
    await approveDefaultRequestChain(browser, SCENARIO_IDS.T20A, title)
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20A, phase: 'submit-solution', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await submitSolutionViaUi(page, checkpoint, title, {
          title: `Engineering solution for ${title}`,
          description: 'T20A: engineering solution for the completed-workflow case.',
          cost: '1600',
          timeline: '2 weeks',
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
        { scenario: SCENARIO_IDS.T20A, phase: `solution-approval-${step}`, actor },
        email,
        async ({ page, checkpoint }) => {
          await approveSolutionStepViaUi(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T20A)}-solution-approved-${actor}`)
          return { notes: `Solution step approved (${actor})` }
        },
      )
    }
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20A, phase: 'trigger-final', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await initiateFinalApprovalViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T20A)}-final-triggered`)
        return { notes: 'Final approval triggered by the original requester' }
      },
    )
    for (const [step, actor, email] of [
      ['section-manager', 'sectionManagerP', BUSINESS_ACTOR_EMAILS.sectionManagerP],
      ['department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
    ] as const) {
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T20A, phase: `final-approval-${step}`, actor },
        email,
        async ({ page, checkpoint }) => {
          await approveCurrentStepViaUi(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T20A)}-final-approved-${actor}`)
          return { notes: `Final step approved (${actor})` }
        },
      )
    }

    // AUDIT HISTORY: the completed view explains every phase decision and
    // transition (the full approval chain with statuses).
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20A, phase: 'audit-history', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectCompletedRequest(page, title)
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByText('Complete Approval Chain')).toBeVisible({ timeout: 20_000 })
        await expect(dialog.getByText('Department manager', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
        await checkpoint(`${slug(SCENARIO_IDS.T20A)}-audit-chain`)
        return { notes: 'Completed view shows the Final Approval Completed banner and the Complete Approval Chain audit (incl. the Department manager final decision)' }
      },
    )

    // TERMINAL LOCKDOWN: no further unauthorized workflow actions.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20A, phase: 'terminal-lockdown-viewer', actor: 'staffB' },
      BUSINESS_ACTOR_EMAILS.staffB,
      async ({ page, checkpoint }) => {
        await expectNoSubmitSolutionControl(page, title)
        await expectNoSubmitFinalApprovalControl(page, title)
        await expectNoApproveControl(page, title)
        await expectCompletedRequest(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T20A)}-staffb-locked`)
        return { notes: 'Staff B (viewer/trigger-eligible actor) sees the read-only completed view: no Submit Solution, no Final trigger, no Approve, Final Approval Completed banner' }
      },
    )
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20A, phase: 'terminal-lockdown-engineer', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await expectNoSubmitSolutionControl(page, title)
        await expectNoSubmitFinalApprovalControl(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T20A)}-engineer-locked`)
        return { notes: 'Engineer A (solution author) has no action on the Completed request — authorship grants no terminal action' }
      },
    )
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20A, phase: 'terminal-lockdown-former-approver', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T20A)}-approver-no-action`)
        return { notes: 'Section manager P (former Final approver) has no My Actions item on the Completed request' }
      },
    )
  })

  test('T20B the requester cancels where policy permits; the cancelled request is locked down', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T20B')

    // Policy window: request approved → Sent to Engineer, no solution
    // submitted yet (no pending solution approvals) — cancellable by the
    // ORIGINAL requester only.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20B, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T20B: the original requester cancels inside the permitted window.')
        return { notes: `created ${title}` }
      },
    )
    await approveDefaultRequestChain(browser, SCENARIO_IDS.T20B, title)

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20B, phase: 'cancel-by-requester', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        const dialog = page.getByRole('dialog')
        await page.goto('/requests')
        const row = page.getByRole('row', { name: new RegExp(`Open request ${title}`) })
        await expect(row).toBeVisible({ timeout: 30_000 })
        await row.click()
        await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0, { timeout: 20_000 })
        await dialog.getByRole('button', { name: 'Cancel Request' }).click()
        const confirmDialog = page.getByRole('alertdialog')
        await expect(confirmDialog.getByText('Cancel Request?')).toBeVisible({ timeout: 20_000 })
        const reason = confirmDialog.getByPlaceholder("Please explain why you're cancelling this request...")
        await expect(reason).toBeVisible({ timeout: 20_000 })
        await reason.fill('T20B: no longer needed — the requester cancels within the permitted window.')
        await checkpoint(`${slug(SCENARIO_IDS.T20B)}-cancel-reason`)
        await confirmDialog.getByRole('button', { name: 'Cancel Request' }).click()
        await expect(confirmDialog).toHaveCount(0, { timeout: 30_000 })
        await expectRequestRowStatus(page, title, 'Cancelled')
        await checkpoint(`${slug(SCENARIO_IDS.T20B)}-cancelled`)
        return { notes: 'Original requester cancelled WITH a reason inside the policy window — terminal status Cancelled' }
      },
    )

    // TERMINAL LOCKDOWN on the cancelled request.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20B, phase: 'terminal-lockdown-requester', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectNoCancelRequestControl(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T20B)}-requester-no-recancel`)
        return { notes: 'Requester re-opened the Cancelled request: the Cancel Request control is gone (no double cancel)' }
      },
    )
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20B, phase: 'terminal-lockdown-engineer', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await expectNoSubmitSolutionControl(page, title)
        await expectNoSubmitFinalApprovalControl(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T20B)}-engineer-locked`)
        return { notes: 'Engineer A cannot submit a solution or trigger Final on the Cancelled request' }
      },
    )
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T20B, phase: 'terminal-lockdown-former-approver', actor: 'supervisorP' },
      BUSINESS_ACTOR_EMAILS.supervisorP,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await expectNoApproveControl(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T20B)}-approver-locked`)
        return { notes: 'Supervisor P (former request approver) has no action item and no Approve control on the Cancelled request' }
      },
    )

    // Owned-runtime cleanup is NOT this spec\u2019s job: the native runner
    // already sweeps its owned DB/app/mail runtime and records the outcome
    // (run-summary.json cleanupFailures, owned runtime dir removed). The
    // ledger cites that existing assertion as T20\u2019s cleanup evidence.
  })
})
