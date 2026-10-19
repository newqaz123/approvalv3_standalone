import { expect, test, type Browser } from '@playwright/test'

import {
  BUSINESS_ACTOR_EMAILS,
  approveCurrentStepViaUi,
  approveDefaultRequestChain as approveDefaultRequestChainFor,
  approveFinalStepViaUiGuardingEmptyMyActions,
  approveSolutionStepViaUi,
  attemptFinalApprovalViaUi,
  createRequestViaUi,
  expectCompletedRequest,
  expectNoApproveControl,
  expectNoMyActionItem,
  expectNoSubmitFinalApprovalControl,
  expectRequestNotListed,
  expectRequestRowStatus,
  openRequestByTitle,
  openRequestByTitlePrefix,
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
 * T08 / T09 / T10 — FINAL TRIGGER AUTHORITY and FINAL-ORIGIN routing
 * (test-only recorded slices, one fixture route configuration per run).
 *
 * CONFIRMED POLICY (plan §1/§4/§6 — asserted here, never weakened, never
 * patched in production):
 *  - ORIGIN-UNIT actors — the ORIGINAL REQUESTER, other Production 1 Staff
 *    (Staff B), Supervisor P and Section manager P — MAY trigger Final after
 *    Solution approval (a separate fresh request per trigger actor);
 *  - the parent-department Department manager may NOT trigger Final: only an
 *    active assignment in the request ORIGIN unit may initiate Final (owner
 *    decision H6, canInitiateFinalApproval). T08E/T10C prove that DENIAL;
 *  - triggering is NOT approving: the trigger actor gains NO Final decision
 *    right (no action item / no Approve control) unless they are INDEPENDENTLY
 *    the current saved candidate of the pending Final step;
 *  - Engineering solution authorship ALONE grants no trigger right;
 *  - Final routing always follows the ORIGINAL REQUESTER's branch/position,
 *    never the trigger actor; the Department manager is the ceiling, no
 *    Director exists.
 *
 * KNOWN PRODUCT DEVIATIONS (plan technical appendix) — these tests DEMONSTRATE
 * them by failing honestly; production is NOT changed and the defects are NOT
 * encoded as expected results:
 *  - (former mismatch #1, origin-unit-only Final initiation, is now the
 *    INTENDED rule and is asserted as a denial by T08E/T10C);
 *  - expected mismatch #2: the attempt origin may persist as the TRIGGER
 *    actor instead of the original requester (initiateFinalApproval passes
 *    originUserId: userId) → the runner DB-evidence `final-origin` check
 *    fails for every non-requester trigger.
 *
 * Every scenario uses its OWN fresh request (created by Requester A so the
 * original-requester origin is FIXED while the trigger actor varies) and its
 * own recorded context per actor phase (scenario/config/phase/actor-labelled
 * videos, traces, checkpoints and manifest entries — business-flow-helpers).
 * Persisted truth (route ids, scopeUnitId, originUserId, ordered steps,
 * captured candidates, attempt counts, terminal statuses) is asserted by the
 * RUNNER-OWNED psql evidence layer
 * (tests/support/native/capture-workflow-db-evidence.ts) after the browser
 * suite finishes and BEFORE cleanup — the browser suite itself receives no
 * DATABASE_URL.
 *
 * PROFILE GATING (explicit skips, never silent passes):
 *  - T08 + T09 run under the "all-defaults" route configuration: Final stays
 *    the company default chain (Section manager P → Department manager), so
 *    the trigger-actor focus is pure authority (not routing);
 *  - T10 runs under the "final-exception" configuration: the Production 1
 *    requester-origin Final replacement (Department manager only, scope
 *    unit-production-1-section) versus the parent/company default makes a
 *    wrong trigger-origin visible in the PERSISTED route id, scope, ordered
 *    steps and candidates (Staff B shares the origin unit, so there a wrong
 *    origin shows in originUserId; the Department manager sits in the parent
 *    unit, so there the route itself would flip).
 *
 * T09 stage coverage (plan T09), all-defaults profile:
 *  - T09A "premature": the four unauthorized actors (Engineer A as solution
 *    author ONLY, Staff C in the sibling section, the inactive user, the
 *    unassigned user) attempt Final BEFORE Solution approval on a fresh
 *    request that intentionally never leaves the Solution-approval stage.
 *  - T09B "post-Completed": the same four actors attempt Final against the
 *    request completed by T04A EARLIER IN THE SAME RUN (file order is
 *    alphabetical and both files share the all-defaults gate:
 *    business-default-workflows.spec.ts runs before this file). The persisted
 *    no-second-attempt proof is the evaluator's `Business T04A/
 *    single-final-attempt` check; mail/notification absence for denied
 *    attempts is reviewed from the runner's captured-mail.json.
 *  - Every denial is server-side (no new attempt, no status change); the UI
 *    simply never offers the control. A person with an independent
 *    requester-hierarchy assignment is evaluated on THAT authority (T08's
 *    Staff B / hierarchy triggers prove authority-based evaluation, never
 *    blanket authorship denial).
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

/** The T09 post-Completed denials target the single T04A request of this run. */
const T04A_TITLE_PREFIX = 'Business T04A'

const SCENARIO_IDS = {
  T08A: 'T08A-final-trigger-requester-a',
  T08B: 'T08B-final-trigger-staff-b',
  T08C: 'T08C-final-trigger-supervisor-p',
  T08D: 'T08D-final-trigger-section-manager-p',
  T08E: 'T08E-final-trigger-department-manager',
  T09A: 'T09A-premature-final-denied',
  T09B: 'T09B-post-completed-final-denied',
  T10A: 'T10A-final-origin-requester-a-trigger',
  T10B: 'T10B-final-origin-staff-b-trigger',
  T10C: 'T10C-final-origin-department-manager-trigger',
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

/** One recorded solution-approval segment (solution-modal control). */
async function approveSolutionStep(
  browser: Browser,
  scenarioId: string,
  step: string,
  actor: string,
  email: string,
  title: string,
): Promise<void> {
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

/** Default-chain Solution approvals (company default in EVERY profile). */
async function approveDefaultSolutionChain(browser: Browser, scenarioId: string, title: string): Promise<void> {
  await approveSolutionStep(browser, scenarioId, 'supervisor', 'supervisorE', BUSINESS_ACTOR_EMAILS.supervisorE, title)
  await approveSolutionStep(browser, scenarioId, 'section-manager', 'sectionManagerE', BUSINESS_ACTOR_EMAILS.sectionManagerE, title)
  await approveSolutionStep(browser, scenarioId, 'department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager, title)
}

interface TriggerActor {
  /** Fixture actor key (manifest label). */
  actor: string
  email: string
  /** Human-readable authority basis for the trigger (manifest + guard notes). */
  authority: string
  /**
   * Whether a post-trigger negative is meaningful: the trigger actor must NOT
   * gain a decision right. Skipped when the actor is INDEPENDENTLY the current
   * saved candidate of the pending Final step (then an Approve control proves
   * candidacy, not trigger authority — the negative would prove nothing).
   */
  postTriggerNegative: boolean
}

/**
 * Proves the trigger actor gained NO Final decision right: no action item and
 * no Approve control (read-only dialog). Only meaningful when the actor is not
 * the current saved Final candidate (see TriggerActor.postTriggerNegative).
 */
async function proveTriggerIsNotApproval(
  browser: Browser,
  scenarioId: string,
  trigger: TriggerActor,
  title: string,
): Promise<void> {
  await signedInSegment(
    browser,
    { scenario: scenarioId, phase: 'negative-trigger-is-not-approval', actor: trigger.actor },
    trigger.email,
    async ({ page, checkpoint }) => {
      await expectNoMyActionItem(page, title)
      await expectNoApproveControl(page, title, '/requests')
      await checkpoint(`${slug(scenarioId)}-trigger-actor-has-no-final-decision-right`)
      return { notes: `${trigger.actor} triggered Final but gained NO Final decision right (no action item, read-only dialog) — triggering is not approving` }
    },
  )
}

/**
 * T08 shared preparation (all-defaults): fresh Requester-A-origin request
 * through the default Request and Solution chains, ending in
 * SendBackToRequester (ready for a Final trigger).
 */
async function prepareRequestForFinalTrigger(
  browser: Browser,
  scenarioId: string,
  title: string,
  trigger: TriggerActor,
): Promise<void> {
  await signedInSegment(
    browser,
    { scenario: scenarioId, phase: 'create-request', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, `T08 (${trigger.actor}): separate fresh request; Final trigger attempted by ${trigger.authority} after Solution approval; trigger ≠ approve.`)
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
        description: `T08: engineering solution approved on the default chain before ${trigger.actor} attempts Final.`,
        cost: '1800',
        timeline: '2 weeks',
      })
      await checkpoint(`${slug(scenarioId)}-solution-submitted`)
      return { notes: 'Solution submitted by Engineer A (Engineering Staff)' }
    },
  )
  await approveDefaultSolutionChain(browser, scenarioId, title)
}

/**
 * Denial segment for the parent-department Department manager: the request is
 * VISIBLE (ancestor-chain boss) at SendBackToRequester but the Final trigger
 * control is NOT offered — only an active assignment in the request ORIGIN
 * unit may initiate Final (canInitiateFinalApproval). The persisted proof (no
 * FINAL attempt from this actor) is the runner DB-evidence layer.
 */
async function proveParentManagerFinalDenied(
  browser: Browser,
  scenarioId: string,
  title: string,
): Promise<void> {
  await signedInSegment(
    browser,
    { scenario: scenarioId, phase: 'final-trigger-denied', actor: 'departmentManager' },
    BUSINESS_ACTOR_EMAILS.departmentManager,
    async ({ page, checkpoint }) => {
      await expectNoSubmitFinalApprovalControl(page, title, '/requests')
      await checkpoint(`${slug(scenarioId)}-parent-department-manager-final-denied`)
      return { notes: 'Parent Department manager sees the request but is NOT offered the Final trigger (origin-unit-only Final initiation)' }
    },
  )
}

/**
 * T08 shared workflow (all-defaults): prepared request, then Final triggered
 * by the given ORIGIN-UNIT actor, then the default Final chain decides
 * (Section manager P → Department manager) and the request completes. When
 * `trigger.postTriggerNegative` is set, the trigger actor is proven to hold
 * NO Final decision right afterwards.
 */
async function runFinalTriggerWorkflow(
  browser: Browser,
  scenarioId: string,
  title: string,
  trigger: TriggerActor,
): Promise<void> {
  await prepareRequestForFinalTrigger(browser, scenarioId, title, trigger)

  await signedInSegment(
    browser,
    { scenario: scenarioId, phase: 'final-trigger', actor: trigger.actor },
    trigger.email,
    async ({ page, checkpoint }) => {
      await attemptFinalApprovalViaUi(page, title, `${trigger.actor} (${trigger.authority})`)
      await checkpoint(`${slug(scenarioId)}-final-triggered-by-${trigger.actor}`)
      return { notes: `Final approval triggered by ${trigger.actor} (${trigger.authority}) — trigger succeeded, triggering is not approving` }
    },
  )

  if (trigger.postTriggerNegative) {
    await proveTriggerIsNotApproval(browser, scenarioId, trigger, title)
  }

  // The default FINAL chain (Section manager P → Department manager) decides
  // via the approver modal; each decision is its own recorded segment. The
  // guarded variant names the confirmed-plan violation (Final origin/self-
  // skip) when a post-trigger My Actions stays EMPTY — the preserved
  // 2026-09-18T13-10-08-805Z T08D run showed exactly that: the Section
  // manager P trigger self-skipped their own first Final rank, so their My
  // Actions had 0 items and the generic row timeout hid the reason.
  for (const [step, actor, email] of [
    ['section-manager', 'sectionManagerP', BUSINESS_ACTOR_EMAILS.sectionManagerP],
    ['department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
  ] as const) {
    await signedInSegment(
      browser,
      { scenario: scenarioId, phase: `final-approval-${step}`, actor },
      email,
      async ({ page, checkpoint }) => {
        await approveFinalStepViaUiGuardingEmptyMyActions(
          page,
          title,
          `${actor} (default-chain Final ${step} step after the ${trigger.actor} trigger)`,
        )
        await checkpoint(`${slug(scenarioId)}-final-approved-${actor}`)
        return { notes: `Final step approved (${actor})` }
      },
    )
  }

  await signedInSegment(
    browser,
    { scenario: scenarioId, phase: 'verify-completed', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await expectRequestRowStatus(page, title, 'Completed')
      await expectCompletedRequest(page, title)
      await checkpoint(`${slug(scenarioId)}-completed`)
      return { notes: 'Workflow Completed: trigger by ' + trigger.actor + ', Final decided by the default Section manager → Department manager chain' }
    },
  )
}

/**
 * T09 denial segment for a NON-VIEWING actor (the unassigned user): no action
 * item and the request is not even listed in their scope, so no Final control
 * is reachable at all. Sibling-section Staff C is NOT a non-viewer here: the
 * fixture seeds Production 1 Section sharing ON, so the sister section CAN
 * view the request (src/lib/organization/sharing.ts) and is denied only the
 * Final trigger (origin-unit-only initiation).
 */
async function proveFinalUnreachableForNonViewer(
  browser: Browser,
  scenarioId: string,
  phase: string,
  actor: string,
  email: string,
  title: string,
): Promise<void> {
  await signedInSegment(
    browser,
    { scenario: scenarioId, phase, actor },
    email,
    async ({ page, checkpoint }) => {
      await expectRequestNotListed(page, title)
      await expectNoMyActionItem(page, title)
      await checkpoint(`${slug(scenarioId)}-${phase}`)
      return { notes: `${actor} cannot see the request in their sharing scope (not listed) and has no action item — Final is unreachable server-side` }
    },
  )
}

/**
 * T09 sign-in denial for the inactive user (exact T01 server-denial proof).
 *
 * This segment deliberately does NOT use signedInSegment: its signIn helper
 * waits for navigation AWAY from /sign-in, which a server-denied inactive
 * sign-in never performs (the preserved 2026-09-18T13-10-08-805Z run timed
 * out exactly there). Mirror the T01 inactive proof instead: own recorded
 * context WITHOUT signIn, assert the server rejection text and that the URL
 * STAYS on /sign-in — inactive users must never gain a session.
 */
async function proveInactiveSignInDenied(
  browser: Browser,
  scenarioId: string,
  phase: string,
): Promise<void> {
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
      return { notes: 'Inactive user denied sign-in server-side ("Invalid email or password") — no session, no Final action possible' }
    },
  )
}

// ---------------------------------------------------------------------------
// T08 + T09 — all-defaults route configuration
// ---------------------------------------------------------------------------

test.describe('route configuration: all-defaults', () => {
  test.skip(
    env.routesConfig !== 'all-defaults',
    `T08/T09 belong to the "all-defaults" route-configuration profile (active: "${env.routesConfig}")`,
  )

  const TRIGGERS: ReadonlyArray<{ id: keyof typeof SCENARIO_IDS; trigger: TriggerActor }> = [
    {
      id: 'T08A',
      trigger: { actor: 'requesterA', email: BUSINESS_ACTOR_EMAILS.requesterA, authority: 'original requester (Requester A)', postTriggerNegative: true },
    },
    {
      id: 'T08B',
      trigger: { actor: 'staffB', email: BUSINESS_ACTOR_EMAILS.staffB, authority: 'other Production 1 Staff (Staff B)', postTriggerNegative: true },
    },
    {
      id: 'T08C',
      trigger: { actor: 'supervisorP', email: BUSINESS_ACTOR_EMAILS.supervisorP, authority: 'requester-unit Supervisor (Supervisor P)', postTriggerNegative: true },
    },
    {
      id: 'T08D',
      trigger: { actor: 'sectionManagerP', email: BUSINESS_ACTOR_EMAILS.sectionManagerP, authority: 'requester-unit Section manager (Section manager P)', postTriggerNegative: false },
    },
  ]

  for (const { id, trigger } of TRIGGERS) {
    test(`T08 ${trigger.actor} triggers Final after Solution approval; the trigger grants no Final decision right; default Final chain decides → Completed`, async ({ browser }) => {
      test.setTimeout(600_000)
      const title = uniqueBusinessTitle(id)
      await runFinalTriggerWorkflow(browser, SCENARIO_IDS[id], title, trigger)
    })
  }

  test('T08E the parent-department Department manager is DENIED the Final trigger (origin-unit-only rule); the request stays Sent Back to Requester with no Final attempt', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T08E')
    await prepareRequestForFinalTrigger(browser, SCENARIO_IDS.T08E, title, {
      actor: 'departmentManager',
      email: BUSINESS_ACTOR_EMAILS.departmentManager,
      authority: 'parent-department Department manager (not origin unit)',
      postTriggerNegative: false,
    })
    await proveParentManagerFinalDenied(browser, SCENARIO_IDS.T08E, title)

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T08E, phase: 'verify-status-unchanged', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectRequestRowStatus(page, title, 'Sent Back to Requester')
        await checkpoint(`${slug(SCENARIO_IDS.T08E)}-status-unchanged`)
        return { notes: 'Request still Sent Back to Requester — the denied parent-manager trigger created no Final attempt (persisted proof: DB evidence no-final-instance)' }
      },
    )
  })

  test('T09A premature Final attempts (solution author, sibling section, inactive, unassigned) before Solution approval are denied with no attempt and no status change', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T09A')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T09A, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T09A: premature Final attempts BEFORE Solution approval must be denied with no attempt and no status change.')
        return { notes: `created ${title}` }
      },
    )
    await approveDefaultRequestChain(browser, SCENARIO_IDS.T09A, title)

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T09A, phase: 'submit-solution', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await submitSolutionViaUi(page, checkpoint, title, {
          title: `Engineering solution for ${title}`,
          description: 'T09A: solution intentionally left pending so the premature Final attempts happen before Solution approval.',
          cost: '1400',
          timeline: '1 week',
        })
        await checkpoint(`${slug(SCENARIO_IDS.T09A)}-solution-submitted`)
        return { notes: 'Solution submitted by Engineer A — request now waits in Solution approval (premature stage for Final)' }
      },
    )

    // Denial 1 — Engineer A, solution AUTHORSHIP ONLY: authorship grants no
    // trigger right; they are also not a solution approver.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T09A, phase: 'denial-solution-author', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        const dialog = await openRequestByTitle(page, title, '/requests')
        await expect(dialog.getByRole('button', { name: 'Submit Final Approval' })).toHaveCount(0)
        await expect(dialog.getByRole('button', { name: 'Approve Solution' })).toHaveCount(0)
        await checkpoint(`${slug(SCENARIO_IDS.T09A)}-author-denied`)
        return { notes: 'Engineer A (solution author only) has no Final trigger control and no solution decision — authorship alone grants nothing' }
      },
    )

    // Denials 2/3 — sibling-section Staff C can VIEW (sharing ON on the
    // origin section) but has no Final trigger; the unassigned user cannot
    // even reach the request.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T09A, phase: 'denial-sibling-section', actor: 'staffC' },
      BUSINESS_ACTOR_EMAILS.staffC,
      async ({ page, checkpoint }) => {
        await expectNoSubmitFinalApprovalControl(page, title, '/requests')
        await expectNoMyActionItem(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T09A)}-sibling-sees-no-final-trigger`)
        return { notes: 'Staff C can VIEW (sharing ON / same department) but cannot trigger Final' }
      },
    )
    await proveFinalUnreachableForNonViewer(browser, SCENARIO_IDS.T09A, 'denial-unassigned', 'unassignedUser', BUSINESS_ACTOR_EMAILS.unassignedUser, title)

    // Denial 4 — inactive user: server-denied sign-in, no session at all.
    await proveInactiveSignInDenied(browser, SCENARIO_IDS.T09A, 'denial-inactive-sign-in')

    // Persisted-truth companion (evaluator): status unchanged at the Solution
    // stage, no FINAL instance, first pending Solution candidate unchanged.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T09A, phase: 'verify-status-unchanged', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectRequestRowStatus(page, title, 'Design & Cost Approval')
        await checkpoint(`${slug(SCENARIO_IDS.T09A)}-status-unchanged`)
        return { notes: 'Request still waits in Solution approval ("Design & Cost Approval") — no denial created an attempt or status change' }
      },
    )
  })

  test('T09B Final attempts after Completed (solution author, sibling section, inactive, unassigned) are denied with no extra attempt', async ({ browser }) => {
    test.setTimeout(300_000)

    // Denial 1 — Engineer A on the COMPLETED T04A request: completed-final
    // read-only view, no Submit Final Approval control, no action item.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T09B, phase: 'denial-completed-author', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, T04A_TITLE_PREFIX)
        const dialog = await openRequestByTitlePrefix(page, T04A_TITLE_PREFIX, '/requests')
        await expect(dialog.getByText('Final Approval Completed')).toBeVisible({ timeout: 20_000 })
        await expect(dialog.getByRole('button', { name: 'Submit Final Approval' })).toHaveCount(0)
        await checkpoint(`${slug(SCENARIO_IDS.T09B)}-completed-author-denied`)
        return { notes: 'Engineer A sees only the completed-final read-only view of the T04A request — no Final trigger control, no action item' }
      },
    )

    // Denials 2/3 — sibling-section Staff C can VIEW the completed request
    // (sharing ON) but has no Final trigger; the unassigned user cannot reach
    // it.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T09B, phase: 'denial-completed-sibling-section', actor: 'staffC' },
      BUSINESS_ACTOR_EMAILS.staffC,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, T04A_TITLE_PREFIX)
        const dialog = await openRequestByTitlePrefix(page, T04A_TITLE_PREFIX, '/requests')
        await expect(dialog.getByRole('button', { name: 'Submit Final Approval' })).toHaveCount(0)
        await checkpoint(`${slug(SCENARIO_IDS.T09B)}-sibling-completed-no-final`)
        return { notes: 'Staff C can VIEW the completed T04A request (sharing ON) but has no Final trigger' }
      },
    )
    await proveFinalUnreachableForNonViewer(browser, SCENARIO_IDS.T09B, 'denial-completed-unassigned', 'unassignedUser', BUSINESS_ACTOR_EMAILS.unassignedUser, T04A_TITLE_PREFIX)

    // Denial 4 — inactive user: server-denied sign-in.
    await proveInactiveSignInDenied(browser, SCENARIO_IDS.T09B, 'denial-completed-inactive-sign-in')
  })
})

// ---------------------------------------------------------------------------
// T10 — final-exception route configuration (distinguishable Final fixtures)
// ---------------------------------------------------------------------------

test.describe('route configuration: final-exception', () => {
  test.skip(
    env.routesConfig !== 'final-exception',
    `T10 belongs to the "final-exception" route-configuration profile (active: "${env.routesConfig}")`,
  )

  const TRIGGERS: ReadonlyArray<{
    id: keyof typeof SCENARIO_IDS
    trigger: TriggerActor
    /** Actor proven DENIED the Final trigger before `trigger` initiates (T10C). */
    deniedParentManagerFirst?: boolean
  }> = [
    {
      id: 'T10A',
      trigger: { actor: 'requesterA', email: BUSINESS_ACTOR_EMAILS.requesterA, authority: 'original requester (Requester A)', postTriggerNegative: true },
    },
    {
      id: 'T10B',
      trigger: { actor: 'staffB', email: BUSINESS_ACTOR_EMAILS.staffB, authority: 'other Production 1 Staff (Staff B)', postTriggerNegative: true },
    },
    {
      // The parent Department manager is DENIED (origin-unit-only rule); the
      // original requester then initiates so the scenario still reaches
      // Completed on the requester branch with exactly one FINAL attempt.
      id: 'T10C',
      trigger: { actor: 'requesterA', email: BUSINESS_ACTOR_EMAILS.requesterA, authority: 'original requester (Requester A) after the parent Department manager was denied', postTriggerNegative: true },
      deniedParentManagerFirst: true,
    },
  ]

  for (const { id, trigger, deniedParentManagerFirst } of TRIGGERS) {
    test(`T10 Final routing follows the ORIGINAL requester when ${deniedParentManagerFirst ? 'the parent Department manager is denied and ' : ''}${trigger.actor} triggers; Final exception chain (Department manager only) decides → Completed`, async ({ browser }) => {
      test.setTimeout(600_000)
      const title = uniqueBusinessTitle(id)

      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS[id], phase: 'create-request', actor: 'requesterA' },
        BUSINESS_ACTOR_EMAILS.requesterA,
        async ({ page, checkpoint }) => {
          await createRequestViaUi(page, checkpoint, title, `T10 (${trigger.actor}): equivalent Requester-A-origin request; Final must keep the ORIGINAL requester's branch regardless of the trigger actor.`)
          return { notes: `created ${title}` }
        },
      )
      await approveDefaultRequestChain(browser, SCENARIO_IDS[id], title)

      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS[id], phase: 'submit-solution', actor: 'engineerA' },
        BUSINESS_ACTOR_EMAILS.engineerA,
        async ({ page, checkpoint }) => {
          await submitSolutionViaUi(page, checkpoint, title, {
            title: `Engineering solution for ${title}`,
            description: `T10: engineering solution on the default chain before ${trigger.actor} triggers Final.`,
            cost: '2200',
            timeline: '2 weeks',
          })
          await checkpoint(`${slug(SCENARIO_IDS[id])}-solution-submitted`)
          return { notes: 'Solution submitted by Engineer A' }
        },
      )
      await approveDefaultSolutionChain(browser, SCENARIO_IDS[id], title)

      if (deniedParentManagerFirst) {
        await proveParentManagerFinalDenied(browser, SCENARIO_IDS[id], title)
      }

      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS[id], phase: 'final-trigger', actor: trigger.actor },
        trigger.email,
        async ({ page, checkpoint }) => {
          await attemptFinalApprovalViaUi(page, title, `${trigger.actor} (${trigger.authority})`)
          await checkpoint(`${slug(SCENARIO_IDS[id])}-final-triggered-by-${trigger.actor}`)
          return { notes: `Final triggered by ${trigger.actor} (${trigger.authority}) — persisted route/scope/steps/origin are compared by the evaluator against the original-requester rule` }
        },
      )

      if (trigger.postTriggerNegative) {
        await proveTriggerIsNotApproval(browser, SCENARIO_IDS[id], trigger, title)
      }

      // Replaced FINAL chain: Department manager only.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS[id], phase: 'final-approval-department-manager', actor: 'departmentManager' },
        BUSINESS_ACTOR_EMAILS.departmentManager,
        async ({ page, checkpoint }) => {
          await approveCurrentStepViaUi(page, title)
          await checkpoint(`${slug(SCENARIO_IDS[id])}-final-approved-department-manager`)
          return { notes: 'Final step approved (Department manager) — the replaced Production 1 requester-origin chain' }
        },
      )

      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS[id], phase: 'verify-completed', actor: 'requesterA' },
        BUSINESS_ACTOR_EMAILS.requesterA,
        async ({ page, checkpoint }) => {
          await expectRequestRowStatus(page, title, 'Completed')
          await expectCompletedRequest(page, title)
          await checkpoint(`${slug(SCENARIO_IDS[id])}-completed`)
          return { notes: 'Workflow Completed: FINAL stayed on the original requester\'s branch (final-exception, Department manager only) despite the ' + trigger.actor + ' trigger' }
        },
      )
    })
  }
})
