import { expect, test, type Browser } from '@playwright/test'

import {
  BUSINESS_ACTOR_EMAILS,
  approveCurrentStepViaUi,
  approveDefaultRequestChain as approveDefaultRequestChainFor,
  approveSolutionStepViaUi,
  createRequestViaUi,
  expectBellNoNotificationForRequest,
  expectBellNotificationForRequest,
  expectCompletedRequest,
  expectRequestRowStatus,
  initiateFinalApprovalViaUi,
  openRequestFromBell,
  requireBusinessEnv,
  signedInSegment as signedInSegmentFor,
  slug,
  submitSolutionViaUi,
  uniqueBusinessTitle,
  type ActorSegmentLabel,
  type CheckpointPage,
} from './business-flow-helpers'

/**
 * T12 — IN-APP NOTIFICATIONS at every transition (test-only recorded slice,
 * "all-defaults" route configuration).
 *
 * CONFIRMED POLICY (src/lib/notification-recipients.ts PARTICIPANTS_ONLY;
 * asserted through the REAL bell UI, never weakened, never patched):
 *  - viewing access NEVER subscribes: only event participants are notified;
 *  - approval_needed / final_approval_needed go to the CURRENT step's active
 *    captured candidates (never live position holders, never viewers);
 *  - status_changed goes to the requester only;
 *  - solution_ready goes to the requester (+ solution submitter);
 *  - approval_granted at completion ("Request Completed") goes to the
 *    requester.
 *
 * Recorded checkpoints on ONE fresh Requester-A-origin request driven through
 * the full default workflow (notification titles from the server actions):
 *  1. create            -> step-1 candidates (Supervisor P + second approver)
 *                          receive "New Approval Request" (approval_needed);
 *                          the bell LINK opens the routed request dialog;
 *  2. first request
 *     approval needed   -> after Supervisor P approves, Section manager P
 *                          (next current candidate) receives "Approval Needed";
 *  3. solution ready    -> after the solution chain completes, the requester
 *                          receives "Solution Ready for Review" (and the
 *                          solution submit notification went to Supervisor E
 *                          as the first solution-step candidate);
 *  4. final needed      -> after the requester triggers Final, Section
 *                          manager P (first Final-step candidate) receives
 *                          "Final Approval Needed";
 *  5. completed         -> the requester receives "Request Completed".
 *
 * NEGATIVE (Staff C, sibling-section VIEWER under sharing ON): after the
 * whole workflow, Staff C's bell contains NO notification referencing the
 * request — visibility granted by sharing is never a notification
 * subscription.
 *
 * Every actor phase runs in its own recorded context (video/trace/
 * checkpoints/manifest — business-flow-helpers). Email recipients for the
 * same checkpoints are owned by T13's runner-side mail evaluator
 * (tests/support/native/capture-workflow-mail-evidence.ts over
 * captured-mail.json); this spec sends no mail itself.
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

const SCENARIO_ID = 'T12A-in-app-notification-recipients'

async function signedInSegment(
  browser: Browser,
  label: ActorSegmentLabel,
  actorEmail: string,
  run: (tools: CheckpointPage) => Promise<{ notes: string }>,
): Promise<void> {
  await signedInSegmentFor(browser, env, label, actorEmail, run)
}

async function approveDefaultRequestChain(browser: Browser, title: string): Promise<void> {
  await approveDefaultRequestChainFor(browser, env, SCENARIO_ID, title)
}

/** One recorded solution-approval segment (solution-modal control). */
async function approveSolutionStep(
  browser: Browser,
  step: string,
  actor: string,
  email: string,
  title: string,
): Promise<void> {
  await signedInSegment(
    browser,
    { scenario: SCENARIO_ID, phase: `solution-approval-${step}`, actor },
    email,
    async ({ page, checkpoint }) => {
      await approveSolutionStepViaUi(page, title)
      await checkpoint(`${slug(SCENARIO_ID)}-solution-approved-${actor}`)
      return { notes: `Solution step approved (${actor})` }
    },
  )
}

test.describe('route configuration: all-defaults', () => {
  test.skip(
    env.routesConfig !== 'all-defaults',
    `T12 belongs to the "all-defaults" route-configuration profile (active: "${env.routesConfig}")`,
  )

  test('T12 in-app notification recipients at create, first approval needed, solution ready, final needed, completed; Staff C (viewer) gets none', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T12A')

    // 1. Create — approval_needed fires to the CURRENT step-1 candidates
    //    (captured group [second approver, Supervisor P]).
    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T12: in-app notification recipients at every transition (PARTICIPANTS_ONLY).')
        return { notes: `created ${title}` }
      },
    )

    // Checkpoint 1 — Supervisor P (current step-1 candidate) is notified at
    // create, and the bell LINK opens the routed request dialog.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'notification-create-approval-needed', actor: 'supervisorP' },
      BUSINESS_ACTOR_EMAILS.supervisorP,
      async ({ page, checkpoint }) => {
        await expectBellNotificationForRequest(page, title, 'New Approval Request')
        const dialog = await openRequestFromBell(page, title, 'New Approval Request')
        await expect(dialog.getByRole('button', { name: /^Approve/ })).toBeVisible({ timeout: 20_000 })
        await checkpoint(`${slug(SCENARIO_ID)}-create-notification-supervisor`)
        return { notes: 'Supervisor P (step-1 candidate) notified at create via the real bell; the notification link opened the routed approver dialog' }
      },
    )

    // The second captured step-1 candidate is notified too.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'notification-create-approval-needed', actor: 'secondApprover' },
      BUSINESS_ACTOR_EMAILS.secondApprover,
      async ({ page, checkpoint }) => {
        await expectBellNotificationForRequest(page, title, 'New Approval Request')
        await checkpoint(`${slug(SCENARIO_ID)}-create-notification-second-approver`)
        return { notes: 'Second approver (other step-1 candidate) notified at create — candidates, not viewers' }
      },
    )

    // Supervisor P decides step 1 (the standard recorded approval segment).
    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'request-approval-supervisor', actor: 'supervisorP' },
      BUSINESS_ACTOR_EMAILS.supervisorP,
      async ({ page, checkpoint }) => {
        await approveCurrentStepViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_ID)}-request-approved-supervisorP`)
        return { notes: 'Request step 1 approved (Supervisor P)' }
      },
    )

    // Checkpoint 2 — first request approval needed: Section manager P (the
    // NEXT current candidate) receives "Approval Needed", then decides.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'notification-approval-needed-section-manager', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectBellNotificationForRequest(page, title, 'Approval Needed')
        await checkpoint(`${slug(SCENARIO_ID)}-approval-needed-notification-section-manager`)
        await approveCurrentStepViaUi(page, title)
        return { notes: 'Section manager P notified "Approval Needed" as the next current candidate, then approved step 2' }
      },
    )

    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'request-approval-department-manager', actor: 'departmentManager' },
      BUSINESS_ACTOR_EMAILS.departmentManager,
      async ({ page, checkpoint }) => {
        await approveCurrentStepViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_ID)}-request-approved-departmentManager`)
        return { notes: 'Request step 3 approved (Department manager) — request now Sent to Engineer' }
      },
    )

    // The requester is notified of the status change (status_changed ->
    // requester only) before Engineering submits the solution.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'notification-status-changed-requester', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectBellNotificationForRequest(page, title, 'Request Status Changed')
        await checkpoint(`${slug(SCENARIO_ID)}-status-changed-notification-requester`)
        return { notes: 'Requester notified of the status change (status_changed -> requester only)' }
      },
    )

    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'submit-solution', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await submitSolutionViaUi(page, checkpoint, title, {
          title: `Engineering solution for ${title}`,
          description: 'T12: solution submitted so the solution-stage notifications fire.',
          cost: '1600',
          timeline: '2 weeks',
        })
        await checkpoint(`${slug(SCENARIO_ID)}-solution-submitted`)
        return { notes: 'Solution submitted by Engineer A' }
      },
    )

    // The first solution-step candidate (Supervisor E) is notified of the
    // submitted solution, then decides; the chain completes afterwards.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'notification-solution-submitted-supervisor', actor: 'supervisorE' },
      BUSINESS_ACTOR_EMAILS.supervisorE,
      async ({ page, checkpoint }) => {
        await expectBellNotificationForRequest(page, title, 'Solution Submitted for Approval')
        await checkpoint(`${slug(SCENARIO_ID)}-solution-submitted-notification-supervisor`)
        await approveSolutionStepViaUi(page, title)
        return { notes: 'Supervisor E (first solution-step candidate) notified, then approved solution step 1' }
      },
    )
    await approveSolutionStep(browser, 'section-manager', 'sectionManagerE', BUSINESS_ACTOR_EMAILS.sectionManagerE, title)
    await approveSolutionStep(browser, 'department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager, title)

    // Checkpoint 3 — solution ready: the requester is notified the solution
    // is ready for their review, then triggers Final.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'notification-solution-ready-requester', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectBellNotificationForRequest(page, title, 'Solution Ready for Review')
        await checkpoint(`${slug(SCENARIO_ID)}-solution-ready-notification-requester`)
        await initiateFinalApprovalViaUi(page, title)
        return { notes: 'Requester notified "Solution Ready for Review", then triggered Final' }
      },
    )

    // Checkpoint 4 — final needed: Section manager P (first Final-step
    // candidate) is notified, then decides.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'notification-final-needed-section-manager', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectBellNotificationForRequest(page, title, 'Final Approval Needed')
        await checkpoint(`${slug(SCENARIO_ID)}-final-needed-notification-section-manager`)
        await approveCurrentStepViaUi(page, title)
        return { notes: 'Section manager P notified "Final Approval Needed" as the current Final candidate, then approved Final step 1' }
      },
    )

    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'final-approval-department-manager', actor: 'departmentManager' },
      BUSINESS_ACTOR_EMAILS.departmentManager,
      async ({ page, checkpoint }) => {
        await expectBellNotificationForRequest(page, title, 'Final Approval Needed')
        await checkpoint(`${slug(SCENARIO_ID)}-final-needed-notification-department-manager`)
        await approveCurrentStepViaUi(page, title)
        return { notes: 'Department manager notified "Final Approval Needed" (next Final candidate), then approved — workflow Completed' }
      },
    )

    // Checkpoint 5 — completed: the requester is notified "Request Completed".
    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'notification-completed-requester', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectRequestRowStatus(page, title, 'Completed')
        await expectBellNotificationForRequest(page, title, 'Request Completed')
        await expectCompletedRequest(page, title)
        await checkpoint(`${slug(SCENARIO_ID)}-completed-notification-requester`)
        return { notes: 'Requester notified "Request Completed" (approval_granted -> requester) — workflow Completed' }
      },
    )

    // NEGATIVE — Staff C (sibling-section VIEWER, sharing ON): after the
    // ENTIRE workflow, the bell holds NO notification referencing the request.
    // Visibility granted by sharing is never a subscription.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_ID, phase: 'negative-viewer-not-notified', actor: 'staffC' },
      BUSINESS_ACTOR_EMAILS.staffC,
      async ({ page, checkpoint }) => {
        await expectBellNoNotificationForRequest(page, title)
        await checkpoint(`${slug(SCENARIO_ID)}-viewer-not-notified`)
        return { notes: 'Staff C (viewer via sharing ON) received ZERO in-app notifications for the request across every transition — PARTICIPANTS_ONLY' }
      },
    )
  })
})
