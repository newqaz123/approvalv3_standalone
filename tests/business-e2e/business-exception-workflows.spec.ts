import { test, type Browser } from '@playwright/test'

import {
  BUSINESS_ACTOR_EMAILS,
  approveCurrentStepViaUi,
  approveDefaultRequestChain as approveDefaultRequestChainFor,
  approveSolutionStepViaUi,
  createRequestViaUi,
  expectCompletedRequest,
  expectNoApproveControl,
  expectNoApproveSolutionControl,
  expectNoMyActionItem,
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
 * T05 / T06 / T07 — UNIT-EXCEPTION business workflows (test-only recorded
 * slices, one fixture route configuration per run).
 *
 * The chains exercised here are the confirmed UNIT POSITION EXCEPTIONS of
 * plan §3 (published unit routes made of position steps) — NOT named-person
 * chains, which are a different mechanism and out of scope:
 *
 *  T05 (profile "solution-exception") — Solution replacement ONLY: the
 *      Engineering-section solution chain is replaced by Section manager E →
 *      Department manager (scope unit-engineering-section). Request and Final
 *      stay on the company defaults (Supervisor → Section manager → Department
 *      manager; Section manager → Department manager). In-UI replacement
 *      proof: Supervisor E (first default-chain solution approver) has NO
 *      action item and NO "Approve Solution" control — the replacement chain
 *      REPLACES the default, it never appends to or duplicates it.
 *  T06 (profile "final-exception") — Final replacement ONLY: the Production 1
 *      requester-origin final chain is replaced by Department manager ONLY
 *      (scope unit-production-1-section). Request and Solution stay defaults.
 *      In-UI replacement proof: Section manager P (first default final
 *      approver) has no action item and no Approve control after the Final
 *      trigger; the recorded route source is verified by the evaluator, not
 *      merely the displayed position list.
 *  T07A/T07B (profile "solution-and-final-exceptions") — BOTH exceptions on
 *      two FRESH workflows: staff origins (Requester A + Engineer A) and
 *      supervisor origins (Supervisor P + Supervisor E) with own-rank
 *      skipping (Supervisor P never approves their own request; Supervisor E
 *      is never an approver of their own solution). Each phase must
 *      independently select its replacement/default chain with no exception
 *      leaking into another phase, and the Department manager remains the
 *      highest approver.
 *
 * Final is triggered ONLY by the ORIGINAL REQUESTER in this slice — other
 * eligible actors (Staff B, hierarchy) and their routing stability are T08
 * and T10 and remain a later, separately written slice.
 *
 * Every scenario uses its OWN fresh request so old approval snapshots never
 * leak between scenarios. Route ids, referenced route scope, ordered
 * required steps, captured candidates, origins, approvers, phase flags and
 * the Department-manager ceiling are asserted against the ACTUAL persisted
 * database rows by the runner-owned psql evidence layer
 * (tests/support/native/capture-workflow-db-evidence.ts, per-profile
 * expectations) after this suite finishes and BEFORE the owned database is
 * cleaned up — the browser suite itself still receives no DATABASE_URL.
 *
 * Every actor phase runs in its own recorded context (scenario/config/phase/
 * actor-labelled videos, traces, checkpoints and manifest entries — see
 * business-flow-helpers.ts).
 *
 * PROFILE GATING: each describe below skips with an explicit reason unless
 * the runner-seeded BUSINESS_ROUTES_CONFIG matches its profile, so a skipped
 * suite is visible and is never counted as coverage (the evaluator records
 * the mirrored skipped entries for the non-selected profiles).
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

const SCENARIO_IDS = {
  T05: 'T05-solution-exception-replacement-only',
  T06: 'T06-final-exception-replacement-only',
  T07A: 'T07A-both-exceptions-staff-origins',
  T07B: 'T07B-both-exceptions-supervisor-origins-rank-skip',
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
 * Approves a fixed list of phase steps, each in its own recorded context.
 * `control` selects the real modal control for the phase: 'approve' for the
 * REQUEST/FINAL approver modal (approver-modal.tsx) and 'approve-solution'
 * for the SOLUTION modal (solution-modal.tsx).
 */
async function approveSteps(
  browser: Browser,
  scenarioId: string,
  phasePrefix: 'request-approval' | 'solution-approval' | 'final-approval',
  control: 'approve' | 'approve-solution',
  title: string,
  steps: ReadonlyArray<{ step: string; actor: string; email: string }>,
): Promise<void> {
  for (const { step, actor, email } of steps) {
    await signedInSegment(
      browser,
      { scenario: scenarioId, phase: `${phasePrefix}-${step}`, actor },
      email,
      async ({ page, checkpoint }) => {
        if (control === 'approve-solution') {
          await approveSolutionStepViaUi(page, title)
        } else {
          await approveCurrentStepViaUi(page, title)
        }
        await checkpoint(`${slug(scenarioId)}-${phasePrefix}-approved-${actor}`)
        return { notes: `${phasePrefix} step approved (${actor})` }
      },
    )
  }
}

// ---------------------------------------------------------------------------
// T05 — Solution unit exception only (profile: solution-exception)
// ---------------------------------------------------------------------------

test.describe('route configuration: solution-exception', () => {
  test.skip(
    env.routesConfig !== 'solution-exception',
    `T05 belongs to the "solution-exception" route-configuration profile (active: "${env.routesConfig}")`,
  )

  test('T05 Solution replacement chain only: Section manager E → Department manager decide; Supervisor E never becomes an approver; Request/Final stay default', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T05')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T05, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T05: Solution unit exception only — Section manager → Department manager replacement chain (Engineering scope).')
        return { notes: `created ${title}` }
      },
    )
    await approveDefaultRequestChain(browser, SCENARIO_IDS.T05, title)

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T05, phase: 'submit-solution', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await submitSolutionViaUi(page, checkpoint, title, {
          title: `Engineering solution for ${title}`,
          description: 'T05: engineering solution approved through the Section manager → Department manager replacement chain.',
          cost: '2100',
          timeline: '2 weeks',
        })
        await checkpoint(`${slug(SCENARIO_IDS.T05)}-solution-submitted`)
        return { notes: 'Solution submitted by Engineer A (Engineering Staff)' }
      },
    )

    // Replacement (not append) proof: under the all-default profile the first
    // Solution step belongs to Supervisor E; the replacement chain must not
    // offer them any decision on this solution.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T05, phase: 'negative-supervisor-not-in-replacement-chain', actor: 'supervisorE' },
      BUSINESS_ACTOR_EMAILS.supervisorE,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await expectNoApproveSolutionControl(page, title, '/requests')
        await checkpoint(`${slug(SCENARIO_IDS.T05)}-supervisor-e-not-a-solution-approver`)
        return { notes: 'Supervisor E had no decision control — the replacement chain replaced (not appended to) the default Solution chain' }
      },
    )

    await approveSteps(browser, SCENARIO_IDS.T05, 'solution-approval', 'approve-solution', title, [
      { step: 'section-manager', actor: 'sectionManagerE', email: BUSINESS_ACTOR_EMAILS.sectionManagerE },
      { step: 'department-manager', actor: 'departmentManager', email: BUSINESS_ACTOR_EMAILS.departmentManager },
    ])

    // Final stays on the company default chain — the Solution exception must
    // not leak into the Final phase.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T05, phase: 'final-trigger', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await initiateFinalApprovalViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T05)}-final-initiated-by-original-requester`)
        return { notes: 'Final approval triggered by the original requester (Requester A) — Final still on the default chain' }
      },
    )
    await approveSteps(browser, SCENARIO_IDS.T05, 'final-approval', 'approve', title, [
      { step: 'section-manager', actor: 'sectionManagerP', email: BUSINESS_ACTOR_EMAILS.sectionManagerP },
      { step: 'department-manager', actor: 'departmentManager', email: BUSINESS_ACTOR_EMAILS.departmentManager },
    ])

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T05, phase: 'verify-completed', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectRequestRowStatus(page, title, 'Completed')
        await expectCompletedRequest(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T05)}-completed`)
        return { notes: 'Workflow Completed: default Request chain, replaced Solution chain, default Final chain' }
      },
    )
  })
})

// ---------------------------------------------------------------------------
// T06 — Final unit exception only (profile: final-exception)
// ---------------------------------------------------------------------------

test.describe('route configuration: final-exception', () => {
  test.skip(
    env.routesConfig !== 'final-exception',
    `T06 belongs to the "final-exception" route-configuration profile (active: "${env.routesConfig}")`,
  )

  test('T06 Final replacement chain only: Department manager alone decides Final; Section manager P never becomes a Final approver; Request/Solution stay default', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T06')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T06, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T06: Final unit exception only — Department manager replacement chain (Production 1 requester-origin branch).')
        return { notes: `created ${title}` }
      },
    )
    await approveDefaultRequestChain(browser, SCENARIO_IDS.T06, title)

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T06, phase: 'submit-solution', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await submitSolutionViaUi(page, checkpoint, title, {
          title: `Engineering solution for ${title}`,
          description: 'T06: engineering solution approved through the unchanged default Solution chain.',
          cost: '1700',
          timeline: '2 weeks',
        })
        await checkpoint(`${slug(SCENARIO_IDS.T06)}-solution-submitted`)
        return { notes: 'Solution submitted by Engineer A' }
      },
    )

    // The Solution phase stays on the company default chain.
    await approveSteps(browser, SCENARIO_IDS.T06, 'solution-approval', 'approve-solution', title, [
      { step: 'supervisor', actor: 'supervisorE', email: BUSINESS_ACTOR_EMAILS.supervisorE },
      { step: 'section-manager', actor: 'sectionManagerE', email: BUSINESS_ACTOR_EMAILS.sectionManagerE },
      { step: 'department-manager', actor: 'departmentManager', email: BUSINESS_ACTOR_EMAILS.departmentManager },
    ])

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T06, phase: 'final-trigger', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await initiateFinalApprovalViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T06)}-final-initiated-by-original-requester`)
        return { notes: 'Final approval triggered by the original requester (Requester A)' }
      },
    )

    // Replacement (not append) proof: under the all-default profile the first
    // Final step belongs to Section manager P; the replacement chain must not
    // offer them any decision on this request.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T06, phase: 'negative-section-manager-not-in-replacement-chain', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await expectNoApproveControl(page, title, '/requests')
        await checkpoint(`${slug(SCENARIO_IDS.T06)}-section-manager-p-not-a-final-approver`)
        return { notes: 'Section manager P had no decision control — the replacement chain replaced (not appended to) the default Final chain' }
      },
    )

    await approveSteps(browser, SCENARIO_IDS.T06, 'final-approval', 'approve', title, [
      { step: 'department-manager', actor: 'departmentManager', email: BUSINESS_ACTOR_EMAILS.departmentManager },
    ])

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T06, phase: 'verify-completed', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectRequestRowStatus(page, title, 'Completed')
        await expectCompletedRequest(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T06)}-completed`)
        return { notes: 'Workflow Completed: default Request and Solution chains, replaced Final chain (Department manager only)' }
      },
    )
  })
})

// ---------------------------------------------------------------------------
// T07A / T07B — both exceptions together (profile: solution-and-final-exceptions)
// ---------------------------------------------------------------------------

test.describe('route configuration: solution-and-final-exceptions', () => {
  test.skip(
    env.routesConfig !== 'solution-and-final-exceptions',
    `T07A/T07B belong to the "solution-and-final-exceptions" route-configuration profile (active: "${env.routesConfig}")`,
  )

  test('T07A both exceptions, staff origins: default Request → replaced Solution → replaced Final (Department manager only) → Completed', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T07A')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07A, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T07A: both unit exceptions with staff origins (Requester A request, Engineer A solution).')
        return { notes: `created ${title}` }
      },
    )
    await approveDefaultRequestChain(browser, SCENARIO_IDS.T07A, title)

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07A, phase: 'submit-solution', actor: 'engineerA' },
      BUSINESS_ACTOR_EMAILS.engineerA,
      async ({ page, checkpoint }) => {
        await submitSolutionViaUi(page, checkpoint, title, {
          title: `Engineering solution for ${title}`,
          description: 'T07A: engineering solution approved through the Section manager → Department manager replacement chain.',
          cost: '2600',
          timeline: '3 weeks',
        })
        await checkpoint(`${slug(SCENARIO_IDS.T07A)}-solution-submitted`)
        return { notes: 'Solution submitted by Engineer A' }
      },
    )

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07A, phase: 'negative-supervisor-not-in-replacement-chain', actor: 'supervisorE' },
      BUSINESS_ACTOR_EMAILS.supervisorE,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await expectNoApproveSolutionControl(page, title, '/requests')
        await checkpoint(`${slug(SCENARIO_IDS.T07A)}-supervisor-e-not-a-solution-approver`)
        return { notes: 'Supervisor E had no decision control on the replaced Solution chain' }
      },
    )

    await approveSteps(browser, SCENARIO_IDS.T07A, 'solution-approval', 'approve-solution', title, [
      { step: 'section-manager', actor: 'sectionManagerE', email: BUSINESS_ACTOR_EMAILS.sectionManagerE },
      { step: 'department-manager', actor: 'departmentManager', email: BUSINESS_ACTOR_EMAILS.departmentManager },
    ])

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07A, phase: 'final-trigger', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await initiateFinalApprovalViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T07A)}-final-initiated-by-original-requester`)
        return { notes: 'Final approval triggered by the original requester (Requester A)' }
      },
    )

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07A, phase: 'negative-section-manager-not-in-replacement-chain', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await expectNoApproveControl(page, title, '/requests')
        await checkpoint(`${slug(SCENARIO_IDS.T07A)}-section-manager-p-not-a-final-approver`)
        return { notes: 'Section manager P had no decision control on the replaced Final chain' }
      },
    )

    await approveSteps(browser, SCENARIO_IDS.T07A, 'final-approval', 'approve', title, [
      { step: 'department-manager', actor: 'departmentManager', email: BUSINESS_ACTOR_EMAILS.departmentManager },
    ])

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07A, phase: 'verify-completed', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await expectRequestRowStatus(page, title, 'Completed')
        await expectCompletedRequest(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T07A)}-completed`)
        return { notes: 'Workflow Completed: each phase independently selected its intended default/replacement chain, no cross-phase leakage' }
      },
    )
  })

  test('T07B both exceptions, supervisor origins with own-rank skipping: Supervisor P and Supervisor E never approve their own work → Completed', async ({ browser }) => {
    test.setTimeout(540_000)
    const title = uniqueBusinessTitle('T07B')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07B, phase: 'create-request', actor: 'supervisorP' },
      BUSINESS_ACTOR_EMAILS.supervisorP,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T07B: both unit exceptions with supervisor origins — own Supervisor rank skipped, no self-approval.')
        return { notes: `created ${title}` }
      },
    )

    // Own rank skipped: the Supervisor-origin request must never offer the
    // Supervisor-originator a decision on their own request.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07B, phase: 'negative-no-self-approval', actor: 'supervisorP' },
      BUSINESS_ACTOR_EMAILS.supervisorP,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await expectNoApproveControl(page, title, '/requests')
        await checkpoint(`${slug(SCENARIO_IDS.T07B)}-supervisor-origin-no-self-approval`)
        return { notes: 'Supervisor P had no decision control on their own request (own rank skipped, no self-approval)' }
      },
    )

    // Supervisor-origin REQUEST chain: the Supervisor's own rank was omitted,
    // so Section manager P → Department manager decide (plain Approve control).
    await approveSteps(browser, SCENARIO_IDS.T07B, 'request-approval', 'approve', title, [
      { step: 'section-manager', actor: 'sectionManagerP', email: BUSINESS_ACTOR_EMAILS.sectionManagerP },
      { step: 'department-manager', actor: 'departmentManager', email: BUSINESS_ACTOR_EMAILS.departmentManager },
    ])

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07B, phase: 'submit-solution', actor: 'supervisorE' },
      BUSINESS_ACTOR_EMAILS.supervisorE,
      async ({ page, checkpoint }) => {
        await submitSolutionViaUi(page, checkpoint, title, {
          title: `Engineering solution for ${title}`,
          description: 'T07B: engineering solution submitted by Supervisor E (replacement chain holds no supervisor step).',
          cost: '3300',
          timeline: '3 weeks',
        })
        await checkpoint(`${slug(SCENARIO_IDS.T07B)}-solution-submitted`)
        return { notes: 'Solution submitted by Supervisor E' }
      },
    )

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07B, phase: 'negative-no-self-approval', actor: 'supervisorE' },
      BUSINESS_ACTOR_EMAILS.supervisorE,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await expectNoApproveSolutionControl(page, title, '/requests')
        await checkpoint(`${slug(SCENARIO_IDS.T07B)}-supervisor-e-no-self-approval`)
        return { notes: 'Supervisor E had no decision control on their own solution (replacement chain replaced the default, no self-approval)' }
      },
    )

    await approveSteps(browser, SCENARIO_IDS.T07B, 'solution-approval', 'approve-solution', title, [
      { step: 'section-manager', actor: 'sectionManagerE', email: BUSINESS_ACTOR_EMAILS.sectionManagerE },
      { step: 'department-manager', actor: 'departmentManager', email: BUSINESS_ACTOR_EMAILS.departmentManager },
    ])

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07B, phase: 'final-trigger', actor: 'supervisorP' },
      BUSINESS_ACTOR_EMAILS.supervisorP,
      async ({ page, checkpoint }) => {
        await initiateFinalApprovalViaUi(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T07B)}-final-initiated-by-original-requester`)
        return { notes: 'Final approval triggered by the original requester (Supervisor P)' }
      },
    )

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07B, phase: 'negative-section-manager-not-in-replacement-chain', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await expectNoApproveControl(page, title, '/requests')
        await checkpoint(`${slug(SCENARIO_IDS.T07B)}-section-manager-p-not-a-final-approver`)
        return { notes: 'Section manager P had no decision control on the replaced Final chain' }
      },
    )

    await approveSteps(browser, SCENARIO_IDS.T07B, 'final-approval', 'approve', title, [
      { step: 'department-manager', actor: 'departmentManager', email: BUSINESS_ACTOR_EMAILS.departmentManager },
    ])

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T07B, phase: 'verify-completed', actor: 'supervisorP' },
      BUSINESS_ACTOR_EMAILS.supervisorP,
      async ({ page, checkpoint }) => {
        await expectRequestRowStatus(page, title, 'Completed')
        await expectCompletedRequest(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T07B)}-completed`)
        return { notes: 'Workflow Completed: both supervisor ranks were skipped without self-approval, both exceptions held, Department manager ceiling held' }
      },
    )
  })
})
