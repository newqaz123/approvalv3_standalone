import { expect, test, type Browser } from '@playwright/test'

import {
  BUSINESS_ACTOR_EMAILS,
  approveCurrentStepViaUi,
  createRequestViaUi,
  expectBellNotificationForRequest,
  expectMyActionItemRow,
  expectNoMyActionItem,
  requireBusinessEnv,
  setEmailSmtpPortViaUi,
  signIn,
  signedInSegment as signedInSegmentFor,
  createSafeRecordingSecondaries,
  slug,
  uniqueBusinessTitle,
  withRecordedContext,
  type RecordingOptions,
  type SafeRecordingLedger,
  type ActorSegmentLabel,
  type CheckpointPage,
} from './business-flow-helpers'

/**
 * T16 — EMAIL FAILURE VS TRANSACTION FAILURE (test-only recorded slice,
 * FRESH request per case, "all-defaults" route configuration).
 *
 * CONFIRMED POLICY (plan T16; asserted, never weakened, never patched):
 *  - an email failure AFTER a committed workflow transaction must NOT undo
 *    the committed approval, and must not suppress the in-app notification;
 *  - a FAILED workflow transaction (rolled back before commit) must produce
 *    no successful workflow write and no misleading success notification or
 *    email; retrying must not duplicate the business action.
 *
 * Seams (verified in source — NO production edits, nothing faked):
 *  - Mail failure is forced through the REAL admin email settings UI
 *    (/admin/email, email-settings-form.tsx → saveEmailSettings writes the
 *    settings row only; notifications.ts re-resolves the transport per send).
 *    Repointing the SMTP port to a closed loopback port (9) makes every
 *    sendMail throw; notifications.ts swallows that per-send failure
 *    (createNotification .catch + sendEmailNotification try/catch), so the
 *    committed decision and the in-app notification row survive. The port
 *    value live BEFORE the change is read from the form and RESTORED in a
 *    finally, so the run's loopback capture keeps working for later tests.
 *    (The browser suite is deliberately given no SMTP env — the restore value
 *    comes from the form itself.)
 *  - Transaction failure is forced deterministically through the same
 *    race-safe conditional update T15 exercises: the stale decider's
 *    Confirm runs after another approver committed, so the guarded update
 *    matches zero rows, throws RequestStatusConflictError and the whole
 *    transaction rolls back — surfaced as the "An error occurred while
 *    approving" toast, never a success toast.
 *
 * Coverage notes (honest): "no mail was sent while broken" and "no
 * misleading success mail" are runner-side evidence (captured-mail.json +
 * app logs), not browser-visible; the ledger records them as such. The
 * in-app notification survival IS browser-provable via the bell.
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

const SCENARIO_IDS = {
  T16A: 'T16A-mail-failure-after-commit',
  T16B: 'T16B-transaction-failure-no-success-write',
} as const

const REQUIRED_SECONDARY_KINDS = ['traceStopFailed', 'contextCloseFailed', 'videoPersistFailed',
  'manifestWriteFailed', 'setupCleanupFailed', 'failureShotFailed', 'reportingFailed'] as const // closed set; INFO kinds excluded

class SafeRecordingSecondaryFailure extends Error {
  constructor(kinds: string[]) {
    super(`safe-recording-required-secondary-failed: ${kinds.join(',')}`)
  }
}

async function signedInSegment(
  browser: Browser,
  label: ActorSegmentLabel,
  actorEmail: string,
  run: (tools: CheckpointPage) => Promise<{ notes: string }>,
  ledger?: SafeRecordingLedger,
): Promise<void> {
  if (label.scenario !== SCENARIO_IDS.T16A) {
    await signedInSegmentFor(browser, env, label, actorEmail, run) // T16B + defaults: NO policy, collector, ledger, annotation
    return
  }
  if (ledger === undefined) {
    throw new Error('t16a-safe-recording: T16A invocation requires the test-owned ledger') // wiring precondition, BEFORE delegation
  }
  const secondaries = createSafeRecordingSecondaries() // FRESH plain literal per invocation — no reuse, no stale flags
  ledger.push(secondaries) // retained in the TEST-OWNED ledger BEFORE delegation/reporting
  let delegated: { thrown: unknown } | undefined // wrapper-OWNED presence container
  try {
    await signedInSegmentFor(browser, env, label, actorEmail, run, {
      evidencePolicy: 'fixed-evidence-only',
      secondaries,
    })
  } catch (delegatedRejection) {
    delegated = { thrown: delegatedRejection } // stored UNREAD: no inspect/coerce/mutate/wrap/cause/aggregate
  }
  try {
    test.info().annotations.push({
      type: 't16a-safe-recording-secondaries',
      description: JSON.stringify({
        scenario: label.scenario, // explicit known strings + fixed booleans ONLY — never a primary unknown
        phase: label.phase,
        hasPrimary: secondaries.hasPrimary,
        traceStopFailed: secondaries.traceStopFailed,
        contextCloseFailed: secondaries.contextCloseFailed,
        videoPersistFailed: secondaries.videoPersistFailed,
        manifestWriteFailed: secondaries.manifestWriteFailed,
        setupCleanupFailed: secondaries.setupCleanupFailed,
        failureShotFailed: secondaries.failureShotFailed,
        reportingFailed: secondaries.reportingFailed,
        setupCleanupAttempted: secondaries.setupCleanupAttempted,
        annotationExposed: secondaries.annotationExposed,
      }),
    })
    secondaries.annotationExposed = true // INFO
  } catch {
    secondaries.reportingFailed = true // REQUIRED flag on the RETAINED object, set BEFORE the terminal decision
  }
  if (delegated !== undefined) {
    throw delegated.thrown // exact primary FIRST — presence container, never truthiness, never helper hasPrimary
  }
  const required = REQUIRED_SECONDARY_KINDS.filter((kind) => secondaries[kind])
  if (required.length > 0) {
    throw new SafeRecordingSecondaryFailure(required) // no-primary fail-closed with fixed kinds
  }
}

test.describe('route configuration: all-defaults', () => {
  test.skip(
    env.routesConfig !== 'all-defaults',
    `T16 belongs to the "all-defaults" route-configuration profile (active: "${env.routesConfig}")`,
  )

  test('T16A a forced mail failure after commit does not undo the committed approval', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T16A')
    const ledger: SafeRecordingLedger = [] // test-owned; created BEFORE the first segment; survives every rejection

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T16A, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T16A: committed approval must survive a forced mail transport failure.')
        return { notes: `created ${title}` }
      },
      ledger,
    )
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T16A, phase: 'request-approval-step1', actor: 'supervisorP' },
      BUSINESS_ACTOR_EMAILS.supervisorP,
      async ({ page, checkpoint }) => {
        await approveCurrentStepViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T16A)}-step1-approved`)
        return { notes: 'Step 1 approved — step 2 pending at Section manager P (the probe decision target)' }
      },
      ledger,
    )

    // Break the mail transport through the REAL admin email settings UI,
    // remembering the live port so it can ALWAYS be restored.
    let originalPort = ''
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T16A, phase: 'break-mail-transport', actor: 'admin' },
      BUSINESS_ACTOR_EMAILS.admin,
      async ({ page, checkpoint }) => {
        originalPort = await setEmailSmtpPortViaUi(page, checkpoint, '9')
        return { notes: `Admin repointed the SMTP port to closed loopback port 9 via /admin/email (was ${originalPort}) — every sendMail now fails` }
      },
      ledger,
    )

    try {
      // The probe decision: an approval whose post-commit notifications
      // must fail to email but must NOT roll back.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T16A, phase: 'approve-while-mail-broken', actor: 'sectionManagerP' },
        BUSINESS_ACTOR_EMAILS.sectionManagerP,
        async ({ page, checkpoint }) => {
          await approveCurrentStepViaUi(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T16A)}-approved-while-mail-broken`)
          return { notes: 'Step 2 approved WITH the mail transport broken — the decision committed ("Approved successfully")' }
        },
        ledger,
      )

      // Committed proof 1: the workflow advanced exactly one step — the
      // Department manager is the new current approver.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T16A, phase: 'verify-advance', actor: 'departmentManager' },
        BUSINESS_ACTOR_EMAILS.departmentManager,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T16A)}-step3-live`)
          return { notes: 'Committed proof: step 3 is live at the Department manager — the approval survived the mail failure' }
        },
        ledger,
      )

      // Committed proof 2: the in-app notification for the next approver was
      // still created (the email failure suppressed only the email).
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T16A, phase: 'verify-inapp-notification-survived', actor: 'departmentManager' },
        BUSINESS_ACTOR_EMAILS.departmentManager,
        async ({ page, checkpoint }) => {
          await expectBellNotificationForRequest(page, title, 'Approval Needed')
          await checkpoint(`${slug(SCENARIO_IDS.T16A)}-bell-notification-survived`)
          return { notes: 'In-app "Approval Needed" notification delivered despite the broken mail transport — only the email failed' }
        },
        ledger,
      )
    } finally {
      // ALWAYS restore the capture transport, even when a probe failed.
      if (originalPort) {
        await signedInSegment(
          browser,
          { scenario: SCENARIO_IDS.T16A, phase: 'restore-mail-transport', actor: 'admin' },
          BUSINESS_ACTOR_EMAILS.admin,
          async ({ page, checkpoint }) => {
            const restored = await setEmailSmtpPortViaUi(page, checkpoint, originalPort)
            expect(restored, 'the restore must return the broken port it replaced').toBe('9')
            return { notes: `Admin restored the SMTP port to the runner capture (${originalPort}) with reload-persisted proof` }
          },
          ledger,
        )
      }
    }
  })

  test('T16B a failed decision transaction writes no success state and no success notification', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T16B')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T16B, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T16B: a rolled-back decision transaction must write nothing.')
        return { notes: `created ${title}` }
      },
    )

    // The second approver stages a Confirm that is doomed to lose: underneath
    // it Supervisor P commits the step, so the guarded conditional update in
    // the stale transaction matches zero rows and the whole transaction
    // rolls back.
    const supervisor = await (async () => {
      const context = await browser.newContext({ baseURL: env.baseURL })
      const page = await context.newPage()
      await signIn(page, BUSINESS_ACTOR_EMAILS.supervisorP, env.e2ePassword)
      return { context, page }
    })()

    await withRecordedContext(
      browser,
      env,
      { scenario: SCENARIO_IDS.T16B, phase: 'failed-transaction-denied', actor: 'secondApprover' },
      async ({ page, checkpoint }) => {
        await signIn(page, BUSINESS_ACTOR_EMAILS.secondApprover, env.e2ePassword)
        await page.goto('/requests/my-actions')
        const row = page.getByRole('row', { name: new RegExp(`Open request ${title}`) })
        await expect(row).toBeVisible({ timeout: 30_000 })
        await row.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0, { timeout: 20_000 })
        await dialog.getByRole('button', { name: 'Approve' }).click()
        await expect(page.getByRole('button', { name: 'Confirm Approval' })).toBeVisible({ timeout: 20_000 })

        try {
          await approveCurrentStepViaUi(supervisor.page, title)
        } finally {
          await supervisor.context.close()
        }

        // The doomed transaction: conflict, never success.
        await page.getByRole('button', { name: 'Confirm Approval' }).click()
        await expect(page.getByText('An error occurred while approving')).toBeVisible({ timeout: 30_000 })
        await expect(page.getByText('Approved successfully')).toHaveCount(0)

        // RETRY does not duplicate the business action: after a refresh the
        // superseded step is gone from the loser's actions entirely.
        await page.goto('/requests/my-actions')
        await expect(page.getByRole('row', { name: new RegExp(`Open request ${title}`) })).toHaveCount(0)
        await checkpoint(`${slug(SCENARIO_IDS.T16B)}-failed-tx-denied-and-retry-clean`)
        return { notes: 'Rolled-back transaction: conflict toast (never success); refreshed retry finds no actionable step — nothing was written (winner supervisorP ran in a plain context)' }
      },
    )

    // No success NOTIFICATION was written for the failed action: the loser's
    // bell still holds exactly the create-time entry for this request (the
    // "Approval Needed" from creation), and no later event exists because the
    // next-approver notification goes to Section manager P, not the loser.
    await withRecordedContext(
      browser,
      env,
      { scenario: SCENARIO_IDS.T16B, phase: 'no-notification-for-failed-action', actor: 'secondApprover' },
      async ({ page, checkpoint }) => {
        const bell = page.getByRole('button').filter({ has: page.locator('svg.lucide-bell') })
        await signIn(page, BUSINESS_ACTOR_EMAILS.secondApprover, env.e2ePassword)
        await expect(bell).toBeVisible({ timeout: 20_000 })
        await bell.click()
        const popover = page.locator('[data-radix-popper-content-wrapper]')
        await expect(popover.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 20_000 })
        const entries = popover.getByRole('button').filter({ hasText: title })
        await expect(entries).toHaveCount(1, { timeout: 20_000 })
        await expect(entries.first()).toContainText('New Approval Request')
        await checkpoint(`${slug(SCENARIO_IDS.T16B)}-single-create-notification-only`)
        return { notes: 'Loser\u2019s bell holds exactly ONE entry for this request (the create-time "New Approval Request") — the failed transaction wrote no success notification' }
      },
    )

    // Exactly one committed transition exists: Section manager P at step 2;
    // no double advance.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T16B, phase: 'verify-single-write', actor: 'departmentManager' },
      BUSINESS_ACTOR_EMAILS.departmentManager,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T16B)}-no-double-advance`)
        return { notes: 'Department manager has no action item — the failed transaction wrote no workflow state' }
      },
    )
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T16B, phase: 'verify-single-write', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectMyActionItemRow(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T16B)}-step2-live`)
        return { notes: 'Only the winner\u2019s transition exists: step 2 live at Section manager P' }
      },
    )
  })
})
