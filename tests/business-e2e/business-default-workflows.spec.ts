import { expect, test, type Browser } from '@playwright/test'

import {
  BUSINESS_ACTOR_EMAILS,
  approveCurrentStepViaUi,
  approveSolutionStepViaUi,
  approveDefaultRequestChain as approveDefaultRequestChainFor,
  createRequestViaUi,
  expectNoApproveControl,
  expectNoApproveSolutionControl,
  expectNoMyActionItem,
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
 * T02 / T03 (positive slice) / T04 — DEFAULT business workflows, all-defaults
 * route configuration, test-only native runtime.
 *
 * PROFILE GATING: this suite belongs to the "all-defaults" fixture route
 * configuration only. The native runner seeds exactly one profile per run
 * (BUSINESS_ROUTES_CONFIG) — under an exception profile these scenarios would
 * exercise REPLACED chains and their default-chain expectations would be
 * wrong, so the whole file skips with an explicit reason instead of running
 * (the T01 smoke regression and the profile's own exception suite still run).
 *
 * Scope of this spec (each test uses its OWN fresh request so old approval
 * snapshots never leak between scenarios):
 *
 *  T02A — default Request chain, STAFF origin (Requester A, Production 1):
 *         Supervisor → Section manager → Department manager decide strictly
 *         in order. Negative checks mid-chain: the Department manager cannot
 *         decide out of order (no action item, no Approve control while the
 *         Section manager step is pending) and a same-unit Staff member
 *         outside the saved candidate group (Staff B) cannot decide either.
 *  T02B — default Request chain, SUPERVISOR origin (Supervisor P): the
 *         Supervisor's own rank is skipped (no self-approval — Supervisor P
 *         never becomes an approver of their own request) and the chain runs
 *         Section manager → Department manager.
 *  T03A — Engineering-only solution submission (positive): after the Request
 *         chain completes, Engineer A (Engineering Staff) submits the
 *         solution through the routed engineering modals; the first default
 *         Solution step then belongs to Supervisor E.
 *  T03B — same, but SUPERVISOR E submits the solution: the Supervisor's own
 *         rank is skipped (Supervisor E is not an approver of their own
 *         solution) and the first pending Solution step belongs to the
 *         Section manager E.
 *  T03C — negatives: after Request approval, Production 1 Staff, sibling-section
 *         Staff C, and the inactive user cannot submit a solution; no partial
 *         solution row is persisted.
 *  T04A — full all-default workflow, staff origin: Request chain → Engineer A
 *         solution → Supervisor E / Section manager E / Department manager
 *         Solution decisions → original requester triggers Final →
 *         Section manager P / Department manager Final decisions → Completed.
 *  T04B — full all-default workflow, supervisor origin: Supervisor P request
 *         (own rank skipped) + Supervisor E solution (own rank skipped), then
 *         the same remaining chain → Completed.
 *
 * Route/chain/candidate assertions against the persisted data (route version
 * ids, ordered required steps, Department-manager ceiling, captured
 * candidates/origin, transitions) are made by the RUNNER-OWNED psql evidence
 * layer (tests/support/native/capture-workflow-db-evidence.ts) after this
 * suite finishes and BEFORE the owned database is cleaned up — the browser
 * suite itself still receives no DATABASE_URL.
 *
 * Every actor phase runs in its own recorded context
 * (business-flow-helpers.ts withRecordedContext): video on, per-context
 * trace, checkpoint screenshots, JSON-lines manifest entries labelled
 * scenario/phase/actor in chronological order.
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

// File-level profile gate: skipped (never "pass") under every other route
// configuration. The DB-evidence evaluator records the mirrored entry
// (db-evidence/config/all-defaults → skipped) for the opposite direction.
test.skip(
  env.routesConfig !== 'all-defaults',
  `default-workflow scenarios T02–T04 belong to the "all-defaults" route-configuration profile (active: "${env.routesConfig}")`,
)

const SCENARIO_IDS = {
  T02A: 'T02A-default-request-chain-staff-origin',
  T02B: 'T02B-default-request-chain-supervisor-origin',
  T03A: 'T03A-engineering-solution-engineer-origin',
  T03B: 'T03B-engineering-solution-supervisor-rank-skip',
  T03C: 'T03C-engineering-solution-unauthorized-denied',
  T04A: 'T04A-all-defaults-full-workflow-staff-origin',
  T04B: 'T04B-all-defaults-full-workflow-supervisor-origin',
} as const

// Shared recorded-context segments (business-flow-helpers) bound to this
// spec's env so every call site keeps the reviewed one-line shape.
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

test('T02A staff-origin default Request chain decides in order; out-of-order and outside-candidate-group actors cannot decide', async ({ browser }) => {
  test.setTimeout(420_000)
  const title = uniqueBusinessTitle('T02A')

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02A, phase: 'create-request', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, 'T02A: staff-origin default Request chain (Supervisor → Section manager → Department manager).')
      return { notes: `created ${title}` }
    },
  )

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02A, phase: 'request-approval-supervisor', actor: 'supervisorP' },
    BUSINESS_ACTOR_EMAILS.supervisorP,
    async ({ page, checkpoint }) => {
      await approveCurrentStepViaUi(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T02A)}-request-approved-by-supervisor`)
      return { notes: 'Request step 1 (Supervisor) approved' }
    },
  )

  // Out of order: the Department manager is a saved candidate for the LAST
  // Request step only. While the Section manager step is pending they must
  // have no action item and no Approve control.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02A, phase: 'negative-out-of-order', actor: 'departmentManager' },
    BUSINESS_ACTOR_EMAILS.departmentManager,
    async ({ page, checkpoint }) => {
      await expectNoMyActionItem(page, title)
      await expectNoApproveControl(page, title, '/requests')
      await checkpoint(`${slug(SCENARIO_IDS.T02A)}-department-manager-out-of-order-denied`)
      return { notes: 'Department manager could not decide the pending Section manager step (no action item, read-only dialog)' }
    },
  )

  // Outside the saved candidate group: same-unit Staff B can view the request
  // but is not a candidate for any step.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02A, phase: 'negative-outside-candidate-group', actor: 'staffB' },
    BUSINESS_ACTOR_EMAILS.staffB,
    async ({ page, checkpoint }) => {
      await expectNoMyActionItem(page, title)
      await expectNoApproveControl(page, title, '/requests')
      await checkpoint(`${slug(SCENARIO_IDS.T02A)}-staff-b-outside-candidate-group-denied`)
      return { notes: 'Staff B (viewer, not a saved candidate) had no decision control' }
    },
  )

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02A, phase: 'request-approval-section-manager', actor: 'sectionManagerP' },
    BUSINESS_ACTOR_EMAILS.sectionManagerP,
    async ({ page, checkpoint }) => {
      await approveCurrentStepViaUi(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T02A)}-request-approved-by-section-manager`)
      return { notes: 'Request step 2 (Section manager) approved' }
    },
  )

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02A, phase: 'request-approval-department-manager', actor: 'departmentManager' },
    BUSINESS_ACTOR_EMAILS.departmentManager,
    async ({ page, checkpoint }) => {
      await approveCurrentStepViaUi(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T02A)}-request-approved-by-department-manager`)
      return { notes: 'Request step 3 (Department manager) approved — Department manager is the highest approver' }
    },
  )

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02A, phase: 'verify-sent-to-engineer', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await expectRequestRowStatus(page, title, 'Sent to Engineer')
      await checkpoint(`${slug(SCENARIO_IDS.T02A)}-sent-to-engineer`)
      return { notes: 'Request advanced to Sent to Engineer after the full default Request chain' }
    },
  )
})

test('T02B supervisor-origin default Request chain skips the Supervisor rank (no self-approval)', async ({ browser }) => {
  test.setTimeout(360_000)
  const title = uniqueBusinessTitle('T02B')

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02B, phase: 'create-request', actor: 'supervisorP' },
    BUSINESS_ACTOR_EMAILS.supervisorP,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, 'T02B: supervisor-origin default Request chain — own Supervisor rank is skipped.')
      return { notes: `created ${title}` }
    },
  )

  // Own rank skipped: the Supervisor-origin request must never offer the
  // Supervisor-originator a decision on their own request.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02B, phase: 'negative-no-self-approval', actor: 'supervisorP' },
    BUSINESS_ACTOR_EMAILS.supervisorP,
    async ({ page, checkpoint }) => {
      await expectNoMyActionItem(page, title)
      await expectNoApproveControl(page, title, '/requests')
      await checkpoint(`${slug(SCENARIO_IDS.T02B)}-supervisor-origin-no-self-approval`)
      return { notes: 'Supervisor P had no decision control on their own request (own rank skipped, no self-approval)' }
    },
  )

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02B, phase: 'request-approval-section-manager', actor: 'sectionManagerP' },
    BUSINESS_ACTOR_EMAILS.sectionManagerP,
    async ({ page, checkpoint }) => {
      await approveCurrentStepViaUi(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T02B)}-request-approved-by-section-manager`)
      return { notes: 'Request step (Section manager) approved — first required step for a Supervisor origin' }
    },
  )

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02B, phase: 'request-approval-department-manager', actor: 'departmentManager' },
    BUSINESS_ACTOR_EMAILS.departmentManager,
    async ({ page, checkpoint }) => {
      await approveCurrentStepViaUi(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T02B)}-request-approved-by-department-manager`)
      return { notes: 'Request step (Department manager) approved' }
    },
  )

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T02B, phase: 'verify-sent-to-engineer', actor: 'supervisorP' },
    BUSINESS_ACTOR_EMAILS.supervisorP,
    async ({ page, checkpoint }) => {
      await expectRequestRowStatus(page, title, 'Sent to Engineer')
      await checkpoint(`${slug(SCENARIO_IDS.T02B)}-sent-to-engineer`)
      return { notes: 'Supervisor-origin request advanced to Sent to Engineer with only Section manager + Department manager decisions' }
    },
  )
})

test('T03A Engineer A submits the solution; first default Solution step belongs to Supervisor E', async ({ browser }) => {
  test.setTimeout(420_000)
  const title = uniqueBusinessTitle('T03A')

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T03A, phase: 'create-request', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, 'T03A: Engineering-only solution submission (Engineer A origin).')
      return { notes: `created ${title}` }
    },
  )
  await approveDefaultRequestChain(browser, SCENARIO_IDS.T03A, title)

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T03A, phase: 'submit-solution', actor: 'engineerA' },
    BUSINESS_ACTOR_EMAILS.engineerA,
    async ({ page, checkpoint }) => {
      await submitSolutionViaUi(page, checkpoint, title, {
        title: `Engineering solution for ${title}`,
        description: 'T03A: default-chain engineering solution submitted by Engineer A.',
        cost: '1500',
        timeline: '2 weeks',
      })
      await checkpoint(`${slug(SCENARIO_IDS.T03A)}-solution-submitted`)
      return { notes: 'Solution submitted by Engineer A (Engineering Staff)' }
    },
  )

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T03A, phase: 'solution-approval-ready', actor: 'supervisorE' },
    BUSINESS_ACTOR_EMAILS.supervisorE,
    async ({ page, checkpoint }) => {
      const dialog = await openRequestByTitle(page, title, '/requests/my-actions')
      await expect(dialog.getByRole('button', { name: 'Approve Solution' })).toBeVisible({ timeout: 20_000 })
      await checkpoint(`${slug(SCENARIO_IDS.T03A)}-supervisor-e-is-current-solution-approver`)
      return { notes: 'First default Solution step (Supervisor E) is pending for Supervisor E' }
    },
  )
})

test('T03B Supervisor E submits the solution; own Supervisor rank is skipped and Section manager E decides first', async ({ browser }) => {
  test.setTimeout(420_000)
  const title = uniqueBusinessTitle('T03B')

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T03B, phase: 'create-request', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, 'T03B: Engineering-only solution submission (Supervisor E origin, own rank skipped).')
      return { notes: `created ${title}` }
    },
  )
  await approveDefaultRequestChain(browser, SCENARIO_IDS.T03B, title)

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T03B, phase: 'submit-solution', actor: 'supervisorE' },
    BUSINESS_ACTOR_EMAILS.supervisorE,
    async ({ page, checkpoint }) => {
      await submitSolutionViaUi(page, checkpoint, title, {
        title: `Engineering solution for ${title}`,
        description: 'T03B: default-chain engineering solution submitted by Supervisor E.',
        cost: '2500',
        timeline: '3 weeks',
      })
      await checkpoint(`${slug(SCENARIO_IDS.T03B)}-solution-submitted`)
      return { notes: 'Solution submitted by Supervisor E (Engineering Supervisor)' }
    },
  )

  // Own rank skipped: the Supervisor-origin solution must never offer the
  // Supervisor-originator a decision on their own solution.
  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T03B, phase: 'negative-no-self-approval', actor: 'supervisorE' },
    BUSINESS_ACTOR_EMAILS.supervisorE,
    async ({ page, checkpoint }) => {
      await expectNoMyActionItem(page, title)
      await expectNoApproveSolutionControl(page, title, '/requests')
      await checkpoint(`${slug(SCENARIO_IDS.T03B)}-supervisor-e-no-self-approval`)
      return { notes: 'Supervisor E had no decision control on their own solution (own rank skipped)' }
    },
  )

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T03B, phase: 'solution-approval-ready', actor: 'sectionManagerE' },
    BUSINESS_ACTOR_EMAILS.sectionManagerE,
    async ({ page, checkpoint }) => {
      const dialog = await openRequestByTitle(page, title, '/requests/my-actions')
      await expect(dialog.getByRole('button', { name: 'Approve Solution' })).toBeVisible({ timeout: 20_000 })
      await checkpoint(`${slug(SCENARIO_IDS.T03B)}-section-manager-e-is-current-solution-approver`)
      return { notes: 'First pending Solution step for a Supervisor-origin solution is Section manager E' }
    },
  )
})

test('T03C Production 1 Staff, sibling-section, and inactive users cannot submit a solution; no partial write', async ({ browser }) => {
  test.setTimeout(420_000)
  const title = uniqueBusinessTitle('T03C')

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T03C, phase: 'create-request', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, 'T03C: unauthorized users must not submit a solution after Request approval.')
      return { notes: `created ${title}` }
    },
  )
  await approveDefaultRequestChain(browser, SCENARIO_IDS.T03C, title)

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T03C, phase: 'verify-sent-to-engineer', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await expectRequestRowStatus(page, title, 'Sent to Engineer')
      await checkpoint(`${slug(SCENARIO_IDS.T03C)}-sent-to-engineer`)
      return { notes: 'Request waiting for Engineering; solution not submitted' }
    },
  )

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T03C, phase: 'denial-production-staff', actor: 'staffB' },
    BUSINESS_ACTOR_EMAILS.staffB,
    async ({ page, checkpoint }) => {
      await expectNoMyActionItem(page, title)
      await expectNoSubmitSolutionControl(page, title, '/requests')
      await checkpoint(`${slug(SCENARIO_IDS.T03C)}-staff-b-no-submit-solution`)
      return { notes: 'Production 1 Staff B can view but has no Submit Solution control' }
    },
  )

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T03C, phase: 'denial-sibling-section', actor: 'staffC' },
    BUSINESS_ACTOR_EMAILS.staffC,
    async ({ page, checkpoint }) => {
      await expectNoSubmitSolutionControl(page, title, '/requests')
      await expectNoMyActionItem(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T03C)}-staff-c-sees-no-submit`)
      return { notes: 'Sibling-section Staff C can VIEW (sharing ON / same department) but has no Submit Solution control' }
    },
  )

  await withRecordedContext(
    browser,
    env,
    { scenario: SCENARIO_IDS.T03C, phase: 'denial-inactive-sign-in', actor: 'inactiveUser' },
    async ({ page, checkpoint }) => {
      await page.goto('/sign-in')
      await page.locator('#email').fill(BUSINESS_ACTOR_EMAILS.inactiveUser)
      await page.locator('#password').fill(env.e2ePassword)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 20_000 })
      await expect(page).toHaveURL(/\/sign-in/)
      await checkpoint(`${slug(SCENARIO_IDS.T03C)}-inactive-denied`)
      return { notes: 'Inactive user denied sign-in; no session, no solution submit' }
    },
  )
})

test('T04A all-defaults full workflow: staff origin → solution by Engineer A → Final by original requester → Completed', async ({ browser }) => {
  test.setTimeout(600_000)
  const title = uniqueBusinessTitle('T04A')

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T04A, phase: 'create-request', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, 'T04A: full all-default workflow with a Production 1 Staff origin.')
      return { notes: `created ${title}` }
    },
  )
  await approveDefaultRequestChain(browser, SCENARIO_IDS.T04A, title)

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T04A, phase: 'submit-solution', actor: 'engineerA' },
    BUSINESS_ACTOR_EMAILS.engineerA,
    async ({ page, checkpoint }) => {
      await submitSolutionViaUi(page, checkpoint, title, {
        title: `Engineering solution for ${title}`,
        description: 'T04A: engineering solution for the all-default full workflow.',
        cost: '4200',
        timeline: '4 weeks',
      })
      await checkpoint(`${slug(SCENARIO_IDS.T04A)}-solution-submitted`)
      return { notes: 'Solution submitted by Engineer A' }
    },
  )

  for (const [phase, actor, email] of [
    ['solution-approval-supervisor', 'supervisorE', BUSINESS_ACTOR_EMAILS.supervisorE],
    ['solution-approval-section-manager', 'sectionManagerE', BUSINESS_ACTOR_EMAILS.sectionManagerE],
    ['solution-approval-department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
  ] as const) {
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T04A, phase, actor },
      email,
      async ({ page, checkpoint }) => {
        await approveSolutionStepViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T04A)}-solution-approved-${actor}`)
        return { notes: `Solution step approved (${actor})` }
      },
    )
  }

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T04A, phase: 'final-trigger', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await initiateFinalApprovalViaUi(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T04A)}-final-initiated-by-original-requester`)
      return { notes: 'Final approval triggered by the original requester (Requester A)' }
    },
  )

  for (const [phase, actor, email] of [
    ['final-approval-section-manager', 'sectionManagerP', BUSINESS_ACTOR_EMAILS.sectionManagerP],
    ['final-approval-department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
  ] as const) {
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T04A, phase, actor },
      email,
      async ({ page, checkpoint }) => {
        await approveCurrentStepViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T04A)}-final-approved-${actor}`)
        return { notes: `Final approval step approved (${actor})` }
      },
    )
  }

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T04A, phase: 'verify-completed', actor: 'requesterA' },
    BUSINESS_ACTOR_EMAILS.requesterA,
    async ({ page, checkpoint }) => {
      await expectRequestRowStatus(page, title, 'Completed')
      const dialog = await openRequestByTitle(page, title, '/requests')
      await expect(dialog.getByText('Final Approval Completed')).toBeVisible({ timeout: 20_000 })
      await checkpoint(`${slug(SCENARIO_IDS.T04A)}-completed`)
      return { notes: 'Workflow completed through the full default chain (Request → Solution → Final)' }
    },
  )
})

test('T04B all-defaults full workflow: Supervisor P origin and Supervisor E solution skip own ranks → Completed', async ({ browser }) => {
  test.setTimeout(540_000)
  const title = uniqueBusinessTitle('T04B')

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T04B, phase: 'create-request', actor: 'supervisorP' },
    BUSINESS_ACTOR_EMAILS.supervisorP,
    async ({ page, checkpoint }) => {
      await createRequestViaUi(page, checkpoint, title, 'T04B: full all-default workflow with a Production 1 Supervisor origin.')
      return { notes: `created ${title}` }
    },
  )

  for (const [phase, actor, email] of [
    ['request-approval-section-manager', 'sectionManagerP', BUSINESS_ACTOR_EMAILS.sectionManagerP],
    ['request-approval-department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
  ] as const) {
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T04B, phase, actor },
      email,
      async ({ page, checkpoint }) => {
        await approveCurrentStepViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T04B)}-request-approved-${actor}`)
        return { notes: `Request step approved (${actor}) — Supervisor rank skipped for the Supervisor origin` }
      },
    )
  }

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T04B, phase: 'submit-solution', actor: 'supervisorE' },
    BUSINESS_ACTOR_EMAILS.supervisorE,
    async ({ page, checkpoint }) => {
      await submitSolutionViaUi(page, checkpoint, title, {
        title: `Engineering solution for ${title}`,
        description: 'T04B: engineering solution submitted by Supervisor E (own rank skipped).',
        cost: '3100',
        timeline: '3 weeks',
      })
      await checkpoint(`${slug(SCENARIO_IDS.T04B)}-solution-submitted`)
      return { notes: 'Solution submitted by Supervisor E' }
    },
  )

  for (const [phase, actor, email] of [
    ['solution-approval-section-manager', 'sectionManagerE', BUSINESS_ACTOR_EMAILS.sectionManagerE],
    ['solution-approval-department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
  ] as const) {
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T04B, phase, actor },
      email,
      async ({ page, checkpoint }) => {
        await approveSolutionStepViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T04B)}-solution-approved-${actor}`)
        return { notes: `Solution step approved (${actor}) — Supervisor rank skipped for the Supervisor origin` }
      },
    )
  }

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T04B, phase: 'final-trigger', actor: 'supervisorP' },
    BUSINESS_ACTOR_EMAILS.supervisorP,
    async ({ page, checkpoint }) => {
      await initiateFinalApprovalViaUi(page, title)
      await checkpoint(`${slug(SCENARIO_IDS.T04B)}-final-initiated-by-original-requester`)
      return { notes: 'Final approval triggered by the original requester (Supervisor P)' }
    },
  )

  for (const [phase, actor, email] of [
    ['final-approval-section-manager', 'sectionManagerP', BUSINESS_ACTOR_EMAILS.sectionManagerP],
    ['final-approval-department-manager', 'departmentManager', BUSINESS_ACTOR_EMAILS.departmentManager],
  ] as const) {
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T04B, phase, actor },
      email,
      async ({ page, checkpoint }) => {
        await approveCurrentStepViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T04B)}-final-approved-${actor}`)
        return { notes: `Final approval step approved (${actor})` }
      },
    )
  }

  await signedInSegment(
    browser,
    { scenario: SCENARIO_IDS.T04B, phase: 'verify-completed', actor: 'supervisorP' },
    BUSINESS_ACTOR_EMAILS.supervisorP,
    async ({ page, checkpoint }) => {
      await expectRequestRowStatus(page, title, 'Completed')
      const dialog = await openRequestByTitle(page, title, '/requests')
      await expect(dialog.getByText('Final Approval Completed')).toBeVisible({ timeout: 20_000 })
      await checkpoint(`${slug(SCENARIO_IDS.T04B)}-completed`)
      return { notes: 'Workflow completed; both Supervisor ranks were skipped, no self-approval, Department manager ceiling held' }
    },
  )
})
