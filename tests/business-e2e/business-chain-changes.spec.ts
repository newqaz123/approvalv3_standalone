import { expect, test, type Browser } from '@playwright/test'

import {
  BUSINESS_ACTOR_EMAILS,
  BUSINESS_UNITS,
  approveDefaultRequestChain as approveDefaultRequestChainFor,
  approveSolutionStepViaUi,
  createUnitExceptionViaUi,
  createRequestViaUi,
  editUnitExceptionRemoveStepViaUi,
  expectMyActionItemRow,
  expectNoMyActionItem,
  initiateFinalApprovalViaUi,
  removeUnitExceptionViaUi,
  requireBusinessEnv,
  signedInSegment as signedInSegmentFor,
  slug,
  submitSolutionViaUi,
  uniqueBusinessTitle,
  type ActorSegmentLabel,
  type CheckpointPage,
} from './business-flow-helpers'

/**
 * T17 — CHANGE CHAINS WHILE WORK IS IN PROGRESS (test-only recorded slice,
 * FRESH request per case, "all-defaults" route configuration).
 *
 * CONFIRMED POLICY (plan T17; asserted, never weakened, never patched):
 *  - a pending attempt KEEPS its captured chain and decisions when its unit
 *    exception is later edited or removed;
 *  - a NEWLY started attempt uses the CURRENT published configuration;
 *  - removing an exception restores normal ancestor/default selection for
 *    future attempts and deletes no approval history.
 *
 * The run profile is all-defaults (no seeded exceptions), so each case first
 * PUBLISHES the same TEST-ONLY unit exception the other profiles seed
 * (position-step replacement, approval limit stays the Department manager),
 * through the REAL admin org UI (ApprovalChainsPanel → Create exception →
 * RouteEditorPanel publish). Old-vs-new comparison is proven by my-actions
 * membership: the OLD attempt's captured candidates stay actionable while a
 * FRESH request picks up the current chain.
 *
 * Ordering hazard (recorded honestly): files run alphabetically and later
 * suites create Requester-A-origin requests, so every published exception is
 * REMOVED at the end of its case (idempotent finally) to restore the seeded
 * default selection.
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

const SCENARIO_IDS = {
  T17A: 'T17A-request-exception-edit-remove',
  T17B1: 'T17B1-solution-exception-old-attempt',
  T17B2: 'T17B2-solution-exception-new-attempt',
  T17C1: 'T17C1-final-exception-old-attempt',
  T17C2: 'T17C2-final-exception-new-attempt',
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

/** Idempotent exception cleanup so a failed case cannot poison later suites. */
async function cleanupExceptionIfPresent(
  browser: Browser,
  scenarioId: string,
  unitId: string,
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL',
): Promise<void> {
  await signedInSegment(
    browser,
    { scenario: scenarioId, phase: `cleanup-exception-${phase.toLowerCase()}`, actor: 'admin' },
    BUSINESS_ACTOR_EMAILS.admin,
    async ({ page }) => {
      await page.goto('/admin/organization?panel=chains', { timeout: 90_000 })
      const row = page.getByTestId(`chains-exception-${unitId}-${phase}`)
      if ((await row.count()) === 0) {
        return { notes: `cleanup: no ${phase} exception at ${unitId} — nothing to remove` }
      }
      await row.getByTestId(`chains-exception-delete-${unitId}-${phase}`).click()
      await page.getByTestId('chains-exception-delete-confirm').click()
      await expect(page.getByTestId(`chains-exception-${unitId}-${phase}`)).toHaveCount(0, { timeout: 30_000 })
      return { notes: `cleanup: removed leftover ${phase} exception at ${unitId}` }
    },
  )
}

/** Drives a fresh request to a submitted solution (old/new solution attempts). */
async function driveToSubmittedSolution(browser: Browser, scenarioId: string, title: string, description: string): Promise<void> {
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
        description: `${scenarioId}: engineering solution.`,
        cost: '1400',
        timeline: '1 week',
      })
      return { notes: 'Solution submitted by Engineer A' }
    },
  )
}

/** Drives a fresh request to SendBackToRequester (ready for the Final trigger). */
async function driveToFinalTriggerStage(browser: Browser, scenarioId: string, title: string, description: string): Promise<void> {
  await driveToSubmittedSolution(browser, scenarioId, title, description)
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
    `T17 belongs to the "all-defaults" route-configuration profile (active: "${env.routesConfig}")`,
  )

  test('T17A REQUEST exception: pending attempt keeps its captured chain; new requests follow current config', async ({ browser }) => {
    test.setTimeout(600_000)
    const titleOld = uniqueBusinessTitle('T17A')
    const titleEdited = `Business T17A ${Date.now()}-edit`
    const titleDefault = `Business T17A ${Date.now()}-default`

    try {
      // Publish the test-only REQUEST exception: Section manager → Department manager.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17A, phase: 'publish-request-exception', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await createUnitExceptionViaUi(page, checkpoint, {
            unitId: BUSINESS_UNITS.productionSection,
            unitName: 'Production 1 Section',
            phase: 'REQUEST',
            phaseLabel: 'Request',
            removeFirstSteps: 1,
          })
          return { notes: 'Published REQUEST exception at Production 1 Section: Section manager → Department manager (test-only replacement)' }
        },
      )

      // OLD attempt under the exception.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17A, phase: 'create-old-request', actor: 'requesterA' },
        BUSINESS_ACTOR_EMAILS.requesterA,
        async ({ page, checkpoint }) => {
          await createRequestViaUi(page, checkpoint, titleOld, 'T17A old attempt captured under the REQUEST exception.')
          return { notes: `created ${titleOld} (old attempt)` }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17A, phase: 'old-attempt-uses-exception', actor: 'supervisorP' },
        BUSINESS_ACTOR_EMAILS.supervisorP,
        async ({ page, checkpoint }) => {
          await expectNoMyActionItem(page, titleOld)
          await checkpoint(`${slug(SCENARIO_IDS.T17A)}-old-no-supervisor-step`)
          return { notes: 'Supervisor P has NO action — the exception chain captured Section manager first' }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17A, phase: 'old-attempt-uses-exception', actor: 'sectionManagerP' },
        BUSINESS_ACTOR_EMAILS.sectionManagerP,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, titleOld)
          await checkpoint(`${slug(SCENARIO_IDS.T17A)}-old-section-manager-step`)
          return { notes: 'Section manager P holds the old attempt step 1 (exception chain captured)' }
        },
      )

      // ADMIN EDITS the exception to Department manager only.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17A, phase: 'edit-request-exception', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await editUnitExceptionRemoveStepViaUi(page, checkpoint, {
            unitId: BUSINESS_UNITS.productionSection,
            phase: 'REQUEST',
            removeStepOrder: 1,
            expectedStepsSummary: 'Steps: Department manager · Approval limit: Department manager',
          })
          return { notes: 'Edited the REQUEST exception to Department manager only (version 2 published)' }
        },
      )

      // NEW request under the EDITED config; the old attempt is untouched.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17A, phase: 'create-edited-request', actor: 'requesterA' },
        BUSINESS_ACTOR_EMAILS.requesterA,
        async ({ page, checkpoint }) => {
          await createRequestViaUi(page, checkpoint, titleEdited, 'T17A new attempt under the edited REQUEST exception.')
          return { notes: `created ${titleEdited} (new attempt after edit)` }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17A, phase: 'edited-attempt-uses-current-config', actor: 'sectionManagerP' },
        BUSINESS_ACTOR_EMAILS.sectionManagerP,
        async ({ page, checkpoint }) => {
          await expectNoMyActionItem(page, titleEdited)
          // The KEY old-vs-new comparison in one segment: still actionable on
          // the OLD attempt, absent from the NEW one.
          await expectMyActionItemRow(page, titleOld)
          await checkpoint(`${slug(SCENARIO_IDS.T17A)}-old-kept-new-current`)
          return { notes: 'Section manager P: NO action for the NEW request (current config dropped the step) but STILL holds the OLD attempt step — captured chain unchanged' }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17A, phase: 'edited-attempt-uses-current-config', actor: 'departmentManager' },
        BUSINESS_ACTOR_EMAILS.departmentManager,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, titleEdited)
          await checkpoint(`${slug(SCENARIO_IDS.T17A)}-edited-department-step`)
          return { notes: 'Department manager holds the NEW request step 1 (edited exception: Department manager only)' }
        },
      )

      // ADMIN REMOVES the exception; a further fresh request inherits the
      // company default again (ancestor/default selection restored).
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17A, phase: 'remove-request-exception', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await removeUnitExceptionViaUi(page, checkpoint, {
            unitId: BUSINESS_UNITS.productionSection,
            phase: 'REQUEST',
            phaseLabel: 'Request',
          })
          return { notes: 'Removed the REQUEST exception — future attempts inherit the company default' }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17A, phase: 'create-default-request', actor: 'requesterA' },
        BUSINESS_ACTOR_EMAILS.requesterA,
        async ({ page, checkpoint }) => {
          await createRequestViaUi(page, checkpoint, titleDefault, 'T17A fresh attempt after exception removal.')
          return { notes: `created ${titleDefault} (after removal)` }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17A, phase: 'default-restored', actor: 'supervisorP' },
        BUSINESS_ACTOR_EMAILS.supervisorP,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, titleDefault)
          await checkpoint(`${slug(SCENARIO_IDS.T17A)}-default-restored`)
          return { notes: 'Supervisor P holds the post-removal request step 1 — company default restored for future attempts' }
        },
      )
    } finally {
      await cleanupExceptionIfPresent(browser, SCENARIO_IDS.T17A, BUSINESS_UNITS.productionSection, 'REQUEST')
    }
  })

  test('T17B1 SOLUTION exception: pending solution attempt keeps its captured chain', async ({ browser }) => {
    test.setTimeout(600_000)
    const titleOld = uniqueBusinessTitle('T17B1')

    try {
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17B1, phase: 'publish-solution-exception', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await createUnitExceptionViaUi(page, checkpoint, {
            unitId: BUSINESS_UNITS.engineeringSection,
            unitName: 'Engineering Section',
            phase: 'SOLUTION',
            phaseLabel: 'Solution',
            removeFirstSteps: 1,
          })
          return { notes: 'Published SOLUTION exception at Engineering Section: Section manager → Department manager (test-only replacement)' }
        },
      )

      await driveToSubmittedSolution(browser, SCENARIO_IDS.T17B1, titleOld, 'T17B1 old solution attempt captured under the SOLUTION exception.')

      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17B1, phase: 'old-attempt-uses-exception', actor: 'supervisorE' },
        BUSINESS_ACTOR_EMAILS.supervisorE,
        async ({ page, checkpoint }) => {
          await expectNoMyActionItem(page, titleOld)
          await checkpoint(`${slug(SCENARIO_IDS.T17B1)}-old-no-supervisor-step`)
          return { notes: 'Supervisor E has NO action — the SOLUTION exception captured Section manager E first' }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17B1, phase: 'old-attempt-uses-exception', actor: 'sectionManagerE' },
        BUSINESS_ACTOR_EMAILS.sectionManagerE,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, titleOld)
          await checkpoint(`${slug(SCENARIO_IDS.T17B1)}-old-section-manager-step`)
          return { notes: 'Section manager E holds the old solution attempt step 1 (exception chain captured)' }
        },
      )
    } finally {
      await cleanupExceptionIfPresent(browser, SCENARIO_IDS.T17B1, BUSINESS_UNITS.engineeringSection, 'SOLUTION')
    }
  })

  test('T17B2 SOLUTION exception removed: a NEW solution attempt uses the current default', async ({ browser }) => {
    test.setTimeout(600_000)
    const titleOld = uniqueBusinessTitle('T17B2-old')
    const titleNew = `Business T17B2 ${Date.now()}-new`

    try {
      // Re-publish the exception and recreate the OLD attempt (self-contained:
      // T17B1 may have failed or cleaned up), then remove the exception.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17B2, phase: 'publish-solution-exception', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await createUnitExceptionViaUi(page, checkpoint, {
            unitId: BUSINESS_UNITS.engineeringSection,
            unitName: 'Engineering Section',
            phase: 'SOLUTION',
            phaseLabel: 'Solution',
            removeFirstSteps: 1,
          })
          return { notes: 'Published SOLUTION exception at Engineering Section (Section manager → Department manager)' }
        },
      )
      await driveToSubmittedSolution(browser, SCENARIO_IDS.T17B2, titleOld, 'T17B2 old solution attempt under the exception.')
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17B2, phase: 'remove-solution-exception', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await removeUnitExceptionViaUi(page, checkpoint, {
            unitId: BUSINESS_UNITS.engineeringSection,
            phase: 'SOLUTION',
            phaseLabel: 'Solution',
          })
          return { notes: 'Removed the SOLUTION exception while the old solution attempt is still pending' }
        },
      )

      // NEW solution attempt after removal: company default restored.
      await driveToSubmittedSolution(browser, SCENARIO_IDS.T17B2, titleNew, 'T17B2 new solution attempt after exception removal.')
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17B2, phase: 'new-attempt-uses-default', actor: 'supervisorE' },
        BUSINESS_ACTOR_EMAILS.supervisorE,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, titleNew)
          await checkpoint(`${slug(SCENARIO_IDS.T17B2)}-new-default-chain`)
          return { notes: 'Supervisor E holds the NEW solution attempt step 1 — company default restored for new attempts' }
        },
      )
      // The OLD pending attempt keeps its captured exception chain.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17B2, phase: 'old-attempt-keeps-chain', actor: 'sectionManagerE' },
        BUSINESS_ACTOR_EMAILS.sectionManagerE,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, titleOld)
          await expectNoMyActionItem(page, titleNew)
          await checkpoint(`${slug(SCENARIO_IDS.T17B2)}-old-kept-new-current`)
          return { notes: 'Section manager E: STILL holds the OLD pending solution step (captured chain kept after removal) and has NO step in the NEW default attempt' }
        },
      )
    } finally {
      await cleanupExceptionIfPresent(browser, SCENARIO_IDS.T17B2, BUSINESS_UNITS.engineeringSection, 'SOLUTION')
    }
  })

  test('T17C1 FINAL exception: pending final attempt keeps its captured chain', async ({ browser }) => {
    test.setTimeout(600_000)
    const titleOld = uniqueBusinessTitle('T17C1')

    try {
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17C1, phase: 'publish-final-exception', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await createUnitExceptionViaUi(page, checkpoint, {
            unitId: BUSINESS_UNITS.productionSection,
            unitName: 'Production 1 Section',
            phase: 'FINAL',
            phaseLabel: 'Final',
            removeFirstSteps: 1,
          })
          return { notes: 'Published FINAL exception at Production 1 Section: Department manager only (test-only replacement)' }
        },
      )

      await driveToFinalTriggerStage(browser, SCENARIO_IDS.T17C1, titleOld, 'T17C1 old final attempt captured under the FINAL exception.')
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17C1, phase: 'trigger-final', actor: 'requesterA' },
        BUSINESS_ACTOR_EMAILS.requesterA,
        async ({ page, checkpoint }) => {
          await initiateFinalApprovalViaUi(page, titleOld)
          await checkpoint(`${slug(SCENARIO_IDS.T17C1)}-final-triggered`)
          return { notes: 'Final triggered on the old request (exception chain: Department manager only)' }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17C1, phase: 'old-attempt-uses-exception', actor: 'sectionManagerP' },
        BUSINESS_ACTOR_EMAILS.sectionManagerP,
        async ({ page, checkpoint }) => {
          await expectNoMyActionItem(page, titleOld)
          await checkpoint(`${slug(SCENARIO_IDS.T17C1)}-old-no-section-manager-step`)
          return { notes: 'Section manager P has NO final action — the FINAL exception captured Department manager only' }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17C1, phase: 'old-attempt-uses-exception', actor: 'departmentManager' },
        BUSINESS_ACTOR_EMAILS.departmentManager,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, titleOld)
          await checkpoint(`${slug(SCENARIO_IDS.T17C1)}-old-department-step`)
          return { notes: 'Department manager holds the old final attempt step (exception chain captured)' }
        },
      )
    } finally {
      await cleanupExceptionIfPresent(browser, SCENARIO_IDS.T17C1, BUSINESS_UNITS.productionSection, 'FINAL')
    }
  })

  test('T17C2 FINAL exception removed: a NEW final attempt uses the current default', async ({ browser }) => {
    test.setTimeout(600_000)
    const titleOld = uniqueBusinessTitle('T17C2-old')
    const titleNew = `Business T17C2 ${Date.now()}-new`

    try {
      // Self-contained: publish the exception, create the OLD final attempt,
      // then remove the exception while that attempt is pending.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17C2, phase: 'publish-final-exception', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await createUnitExceptionViaUi(page, checkpoint, {
            unitId: BUSINESS_UNITS.productionSection,
            unitName: 'Production 1 Section',
            phase: 'FINAL',
            phaseLabel: 'Final',
            removeFirstSteps: 1,
          })
          return { notes: 'Published FINAL exception at Production 1 Section (Department manager only)' }
        },
      )
      await driveToFinalTriggerStage(browser, SCENARIO_IDS.T17C2, titleOld, 'T17C2 old final attempt under the exception.')
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17C2, phase: 'trigger-final-old', actor: 'requesterA' },
        BUSINESS_ACTOR_EMAILS.requesterA,
        async ({ page, checkpoint }) => {
          await initiateFinalApprovalViaUi(page, titleOld)
          await checkpoint(`${slug(SCENARIO_IDS.T17C2)}-old-final-triggered`)
          return { notes: 'Final triggered on the old request under the exception' }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17C2, phase: 'remove-final-exception', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await removeUnitExceptionViaUi(page, checkpoint, {
            unitId: BUSINESS_UNITS.productionSection,
            phase: 'FINAL',
            phaseLabel: 'Final',
          })
          return { notes: 'Removed the FINAL exception while the old final attempt is still pending' }
        },
      )

      // NEW final attempt after removal: company default (Section manager →
      // Department manager) is used again.
      await driveToFinalTriggerStage(browser, SCENARIO_IDS.T17C2, titleNew, 'T17C2 new final attempt after exception removal.')
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17C2, phase: 'trigger-final-new', actor: 'requesterA' },
        BUSINESS_ACTOR_EMAILS.requesterA,
        async ({ page, checkpoint }) => {
          await initiateFinalApprovalViaUi(page, titleNew)
          await checkpoint(`${slug(SCENARIO_IDS.T17C2)}-new-final-triggered`)
          return { notes: 'Final triggered on the new request after removal' }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T17C2, phase: 'new-attempt-uses-default', actor: 'sectionManagerP' },
        BUSINESS_ACTOR_EMAILS.sectionManagerP,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, titleNew)
          // Old attempt keeps its captured chain: still NO Section-manager
          // final step on the request triggered under the exception.
          await expectNoMyActionItem(page, titleOld)
          await checkpoint(`${slug(SCENARIO_IDS.T17C2)}-new-default-old-kept`)
          return { notes: 'Section manager P holds the NEW final step (default restored) and still has NO step in the OLD exception attempt — captured chain kept' }
        },
      )
    } finally {
      await cleanupExceptionIfPresent(browser, SCENARIO_IDS.T17C2, BUSINESS_UNITS.productionSection, 'FINAL')
    }
  })
})
