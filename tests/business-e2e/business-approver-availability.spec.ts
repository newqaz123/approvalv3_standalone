import { expect, test, type Browser } from '@playwright/test'

import {
  BUSINESS_ACTOR_EMAILS,
  approveCurrentStepViaUi,
  activateUserViaUi,
  createRequestViaUi,
  deactivateUserViaUi,
  escapeRegExp,
  expectMyActionItemRow,
  expectNoMyActionItem,
  expectRequestRowStatus,
  requireBusinessEnv,
  signedInSegment as signedInSegmentFor,
  slug,
  uniqueBusinessTitle,
  withRecordedContext,
  type ActorSegmentLabel,
  type CheckpointPage,
} from './business-flow-helpers'
import { CleanupStepAbsentError, runStrandedReplacementCleanupGuarded } from '../support/business-t18b-cleanup'
import { writeT18c2BrowserCorrelation } from '../support/business-t18c2-correlation'
import {
  T18B_RESTART_REASON,
  collectCreateRequestObservations,
  readCreateRequestActionId,
  readCreatedRequestIdFromCreateAction,
  selectStrandedRowForRequest,
  writeT18bBrowserCorrelation,
} from '../support/business-t18b-correlation'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'

/**
 * T18 — INACTIVE/MISSING APPROVERS AND RESTART (test-only recorded slice,
 * FRESH request per case, "all-defaults" route configuration).
 *
 * CONFIRMED POLICY (plan T18 + plan §6 resolved rules; asserted, never
 * weakened, never patched):
 *  - an inactive user cannot approve (and cannot even sign in — server-side
 *    "Invalid email or password");
 *  - an unrelated senior user is NEVER silently substituted for a missing
 *    candidate; a vacant required position is SKIPPED and recorded as
 *    VACANT_POSITION;
 *  - an admin may restart a stranded attempt (ALL captured candidates
 *    inactive) with a REQUIRED reason; the old attempt and its decisions are
 *    preserved and the new attempt is built from CURRENT configuration;
 *  - a restart is admin-only: non-admins cannot reach the restart surface.
 *
 * Seams exercised through the REAL UI (verified in source, no production
 * edits): the admin users table deactivate/activate (user-table.tsx), the
 * admin approval-chains panel "Stranded attempts" list +
 * RestartAttemptDialog (required reason, replacement-chain preview), and the
 * read-only SubmitterTestDialog preview that reports per-step
 * "Skipped: VACANT_POSITION".
 *
 * Fixture actors: the second supervisor (secondApprover) is the co-candidate
 * on step 1; staffVacantSup sits on a team with NO supervisor so the
 * Supervisor step is vacant from the start; staffVacantAll sits on the
 * ISOLATED vacancy branch (managerless unit-vacancy-branch under the
 * managerless company root) whose only real path step is the team's
 * same-unit anchor on the dedicated position-vacancy-anchor — a position no
 * published route step requires — so EVERY step is vacant at creation and
 * the engine's COMPLETED_NO_ELIGIBLE_STEPS branch decides the REQUEST phase.
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

const SCENARIO_IDS = {
  T18A: 'T18A-deactivate-saved-approver',
  T18B: 'T18B-strand-and-admin-restart',
  T18C1: 'T18C1-vacant-required-position',
  T18C2: 'T18C2-all-steps-vacant',
} as const

async function signedInSegment(
  browser: Browser,
  label: ActorSegmentLabel,
  actorEmail: string,
  run: (tools: CheckpointPage) => Promise<{ notes: string }>,
): Promise<void> {
  await signedInSegmentFor(browser, env, label, actorEmail, run)
}

/** Sign-in denial proof for a DEACTIVATED account (T01/T09 pattern, no signIn helper). */
async function proveDeactivatedSignInDenied(
  browser: Browser,
  scenarioId: string,
  phase: string,
  actor: string,
  email: string,
): Promise<void> {
  await withRecordedContext(
    browser,
    env,
    { scenario: scenarioId, phase, actor },
    async ({ page, checkpoint }) => {
      await page.goto('/sign-in')
      await page.locator('#email').fill(email)
      await page.locator('#password').fill(env.e2ePassword)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 20_000 })
      await expect(page).toHaveURL(/\/sign-in/)
      await checkpoint(`${slug(scenarioId)}-${phase}`)
      return { notes: `Deactivated ${actor} denied sign-in server-side ("Invalid email or password") — no session, no decision possible` }
    },
  )
}

test.describe('route configuration: all-defaults', () => {
  test.skip(
    env.routesConfig !== 'all-defaults',
    `T18 belongs to the "all-defaults" route-configuration profile (active: "${env.routesConfig}")`,
  )

  test('T18A deactivating a saved approver: no session, no silent substitution, remaining candidate decides', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T18A')

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T18A, phase: 'create-request', actor: 'requesterA' },
      BUSINESS_ACTOR_EMAILS.requesterA,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T18A: a saved approver is deactivated while the step is pending.')
        return { notes: `created ${title} (step 1 candidates: Supervisor P + the second approver)` }
      },
    )

    try {
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18A, phase: 'deactivate-supervisor', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await deactivateUserViaUi(page, checkpoint, BUSINESS_ACTOR_EMAILS.supervisorP)
          return { notes: 'Admin deactivated Supervisor P through the real users table while step 1 is pending' }
        },
      )

      await proveDeactivatedSignInDenied(
        browser,
        SCENARIO_IDS.T18A,
        'deactivated-sign-in-denied',
        'supervisorP',
        BUSINESS_ACTOR_EMAILS.supervisorP,
      )

      // NO silent senior substitution: the step stays with its remaining live
      // candidate; the Department manager is not handed the supervisor step.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18A, phase: 'no-senior-substitution', actor: 'departmentManager' },
        BUSINESS_ACTOR_EMAILS.departmentManager,
        async ({ page, checkpoint }) => {
          await expectNoMyActionItem(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T18A)}-no-substitution`)
          return { notes: 'Department manager has NO action item — the deactivated supervisor\u2019s step was not silently handed to a senior' }
        },
      )

      // The remaining active candidate decides; the workflow advances normally.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18A, phase: 'remaining-candidate-decides', actor: 'secondApprover' },
        BUSINESS_ACTOR_EMAILS.secondApprover,
        async ({ page, checkpoint }) => {
          await approveCurrentStepViaUi(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T18A)}-second-approver-approved`)
          return { notes: 'The second approver (remaining active candidate) approved step 1' }
        },
      )
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18A, phase: 'workflow-advanced', actor: 'sectionManagerP' },
        BUSINESS_ACTOR_EMAILS.sectionManagerP,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T18A)}-step2-live`)
          return { notes: 'Workflow advanced to step 2 (Section manager P) — deactivation removed eligibility, not the chain' }
        },
      )
    } finally {
      // Restore the fixture actor so later suites keep their supervisor.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18A, phase: 'reactivate-supervisor', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await activateUserViaUi(page, checkpoint, BUSINESS_ACTOR_EMAILS.supervisorP)
          return { notes: 'Admin reactivated Supervisor P (fixture restored)' }
        },
      )
    }
  })

  test('T18B stranded attempt: unauthorized restart denied; admin restart with reason rebuilds from current config', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T18B')
    const SPARE_EMAIL = BUSINESS_ACTOR_EMAILS.unassignedUser
    // The stranded list renders phase/attempt/origin only (ApprovalChainsPanel),
    // so that text cannot prove this request. The browser records the exact
    // created title plus the selected row's instance id; the runner correlates
    // them. This spec never reads DATABASE_URL.
    let createdRequestId = ''
    let oldInstanceId = ''
    const strandedRowText = 'REQUEST · attempt 1 · origin user-supervisor-p'

    const openChainsPanel = async (page: Page): Promise<void> => {
      await page.goto('/admin/organization?panel=chains', { timeout: 90_000 })
      await expect(page.getByTestId('chains-panel')).toBeVisible({ timeout: 30_000 })
    }
    const strandedRows = (page: Page) =>
      page.locator('li[data-testid^="chains-stranded-"]').filter({ hasText: strandedRowText })
    const recordBrowserIdentity = async (): Promise<void> => {
      await writeT18bBrowserCorrelation(env.evidenceDir, {
        requestTitle: title,
        requestId: createdRequestId,
        oldInstanceId,
      })
    }
    const selectOwnedStrandedRow = async (page: Page) => {
      const rows = await page.locator('li[data-testid^="chains-stranded-"]').evaluateAll((elements) => elements.map((element) => ({
        instanceId: (element.getAttribute('data-testid') ?? '').replace('chains-stranded-', ''),
        requestId: element.getAttribute('data-request-id'),
      })))
      const selected = selectStrandedRowForRequest(rows, createdRequestId)
      const row = page.locator(`li[data-testid="chains-stranded-${selected.instanceId}"]`)
      await expect(row).toHaveCount(1)
      await expect(row).toHaveAttribute('data-request-id', createdRequestId)
      return { row, instanceId: selected.instanceId }
    }

    const assignSpareViaOrgUi = async (page: Page, checkpoint: (name: string) => Promise<void>): Promise<void> => {
      await page.goto('/admin/organization', { timeout: 90_000 })
      await expect(page.getByTestId('organization-tree')).toBeVisible({ timeout: 90_000 })
      await page.getByTestId('unassigned-dock-toggle').click()
      await page.getByTestId('unassigned-person-user-unassigned').click()
      const panel = page.getByTestId('person-assignment-panel')
      await expect(panel).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('assignment-unit-select').click()
      // UnitTreeSelect sets aria-label to the unit name. Exact name avoids
      // "Production 1 Section".
      await page.getByRole('option', { name: 'Production 1', exact: true }).click()
      await page.getByTestId('assignment-position-select').click()
      await page.getByRole('option', { name: 'Department manager', exact: true }).click()
      await page.getByTestId('assignment-team-select').click()
      await page.getByRole('option', { name: 'No team', exact: true }).click()
      await panel.getByRole('button', { name: 'Assign' }).click()
      await expect(panel).toHaveCount(0, { timeout: 30_000 })
      await checkpoint('t18b-spare-assigned-department-manager')
    }
    const openProduction1UnitPanel = async (page: Page): Promise<void> => {
      await page.goto('/admin/organization', { timeout: 90_000 })
      await expect(page.getByTestId('organization-tree')).toBeVisible({ timeout: 90_000 })
      // unit-toggle only expands/collapses and stopPropagation. Selection is
      // the unit header (always visible). unit-manage is hover-hidden.
      const companyToggle = page.getByTestId('unit-toggle-unit-company')
      if ((await companyToggle.count()) > 0 && (await companyToggle.getAttribute('aria-expanded')) === 'false') {
        await companyToggle.click()
      }
      const header = page.getByTestId('unit-header-unit-production-1')
      await expect(header).toBeVisible({ timeout: 30_000 })
      // Header onClick selects the unit. Offset past the 32px expand toggle,
      // which stopPropagation and must not be the hit target.
      await header.click({ position: { x: 96, y: 16 } })
      await expect(page.getByTestId('organization-manage-drawer')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('unit-manager-select')).toBeVisible({ timeout: 30_000 })
    }
    const managerOption = (page: Page, personName: string) =>
      page.getByRole('option', { name: new RegExp(`^${escapeRegExp(personName)}\\b`) })
    const expectProductionManager = async (page: Page, personName: 'Department manager' | 'Unassigned user'): Promise<void> => {
      const managerSelect = page.getByTestId('unit-manager-select')
      await expect(managerSelect).toBeVisible({ timeout: 30_000 })
      await expect(managerSelect).toContainText(personName)
      if (personName === 'Department manager') {
        // The spare's position label is also "Department manager"; the person
        // name is what distinguishes the original pointer.
        await expect(managerSelect).not.toContainText('Unassigned user')
      }
    }
    const setProductionManagerViaOrgUi = async (
      page: Page,
      checkpoint: (name: string) => Promise<void>,
      managerLabel: 'Unassigned user' | 'Department manager',
    ): Promise<void> => {
      await openProduction1UnitPanel(page)
      await page.getByTestId('unit-manager-select').click()
      await managerOption(page, managerLabel).click()
      await expectProductionManager(page, managerLabel)
      await checkpoint(`t18b-production-manager-${managerLabel === 'Unassigned user' ? 'spare' : 'original'}`)
    }
    const expectSpareUnassigned = async (page: Page): Promise<void> => {
      await page.goto('/admin/organization', { timeout: 90_000 })
      await expect(page.getByTestId('organization-tree')).toBeVisible({ timeout: 90_000 })
      await expect(page.getByTestId('person-chip-user-unassigned')).toHaveCount(0)
      await page.getByTestId('unassigned-dock-toggle').click()
      await expect(page.getByTestId('unassigned-person-user-unassigned')).toBeVisible({ timeout: 30_000 })
    }

    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T18B, phase: 'baseline-verify-spare-and-manager', actor: 'admin' },
      BUSINESS_ACTOR_EMAILS.admin,
      async ({ page, checkpoint }) => {
        await openProduction1UnitPanel(page)
        await expectProductionManager(page, 'Department manager')
        await expectSpareUnassigned(page)
        await page.goto('/admin/users', { timeout: 90_000 })
        const baselineSpareRow = page.getByRole('row', { name: new RegExp(escapeRegExp(SPARE_EMAIL)) })
        await expect(baselineSpareRow.getByText('Active', { exact: true })).toBeVisible({ timeout: 30_000 })
        await expect(baselineSpareRow.getByText('General Dept')).toBeVisible({ timeout: 30_000 })
        await checkpoint('t18b-baseline-verified')
        return { notes: `Baseline: spare ${SPARE_EMAIL} active general_dept with no active assignment/team; Production 1 manager is the original Department manager` }
      },
    )

    let primary: unknown
    let hasPrimary = false
    try {
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18B, phase: 'create-supervisor-request', actor: 'supervisorP' },
        BUSINESS_ACTOR_EMAILS.supervisorP,
        async ({ page, checkpoint }) => {
          const expectedActionId = readCreateRequestActionId(
            await fs.readFile(path.join(process.cwd(), '.next/server/server-reference-manifest.json'), 'utf8'),
          )
          const observations = await collectCreateRequestObservations({
            expectedActionId,
            arm: (listener) => page.on('response', listener),
            disarm: (listener) => page.off('response', listener),
            run: () => createRequestViaUi(page, checkpoint, title, 'T18B: every captured approver goes inactive while the attempt is pending.'),
            onSecondaryRead: async (kind) => {
              await checkpoint(`t18b-create-response-read-${kind}`)
            },
          })
          createdRequestId = await readCreatedRequestIdFromCreateAction({
            expectedActionId,
            expectedTitle: title,
            observations,
          })
          return { notes: `created exact request ${title} id ${createdRequestId} from the correlated createRequest action result` }
        },
      )

      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18B, phase: 'establish-original-captures', actor: 'sectionManagerP' },
        BUSINESS_ACTOR_EMAILS.sectionManagerP,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T18B)}-step1-live-at-section-manager`)
          return { notes: `Step 1 of ${title} is live at the captured Section manager P` }
        },
      )

      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18B, phase: 'deactivate-all-candidates', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await deactivateUserViaUi(page, checkpoint, BUSINESS_ACTOR_EMAILS.sectionManagerP)
          await deactivateUserViaUi(page, checkpoint, BUSINESS_ACTOR_EMAILS.departmentManager)
          await openChainsPanel(page)
          const owned = await selectOwnedStrandedRow(page)
          oldInstanceId = owned.instanceId
          expect(oldInstanceId, 'instance id must not be the origin label').not.toContain('origin')
          await expect(owned.row).toContainText(strandedRowText)
          await recordBrowserIdentity()
          await checkpoint(`${slug(SCENARIO_IDS.T18B)}-stranded-both-originals-inactive`)
          return { notes: `Both ORIGINAL captured members of ${title} deactivated. Identity before any restart: requestId=${createdRequestId} oldInstanceId=${oldInstanceId}` }
        },
      )

      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18B, phase: 'unauthorized-restart-denied', actor: 'requesterA' },
        BUSINESS_ACTOR_EMAILS.requesterA,
        async ({ page, checkpoint }) => {
          await page.goto('/admin/organization?panel=chains', { timeout: 90_000 })
          await expect(page).toHaveURL(/\/requests/, { timeout: 30_000 })
          await expect(page.getByTestId('chains-panel')).toHaveCount(0)
          await checkpoint(`${slug(SCENARIO_IDS.T18B)}-non-admin-redirected`)
          return { notes: 'Requester A was redirected from /admin/organization to /requests — the restart surface is admin-only' }
        },
      )

      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18B, phase: 'assign-spare-and-set-manager', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await assignSpareViaOrgUi(page, checkpoint)
          await setProductionManagerViaOrgUi(page, checkpoint, 'Unassigned user')
          return { notes: 'Spare assigned Production 1 / Department manager / no team and selected as Production 1 manager. Both originals stay inactive, so the old snapshot remains stranded.' }
        },
      )

      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18B, phase: 'admin-restart-with-reason', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await openChainsPanel(page)
          const owned = await selectOwnedStrandedRow(page)
          expect(owned.instanceId === oldInstanceId, `restart target ${owned.instanceId} must match the pre-restart instance ${oldInstanceId} for request ${createdRequestId}`).toBe(true)
          await recordBrowserIdentity()
          await owned.row.getByRole('button', { name: 'Restart…' }).click()
          const dialog = page.getByTestId('restart-attempt-dialog')
          await expect(dialog).toBeVisible({ timeout: 20_000 })
          const previewSteps = dialog.locator('[data-testid^="restart-preview-step-"]')
          await expect(previewSteps).toHaveCount(2, { timeout: 30_000 })
          await expect(previewSteps.filter({ hasText: 'skipped (vacant)' })).toHaveCount(1)
          await expect(previewSteps.filter({ hasText: 'Unassigned user' })).toHaveCount(1)
          await expect(page.getByTestId('restart-confirm')).toBeDisabled()
          await page.getByTestId('restart-reason-input').fill(T18B_RESTART_REASON)
          await checkpoint(`${slug(SCENARIO_IDS.T18B)}-restart-dialog-preview`)
          await page.getByTestId('restart-confirm').click()
          await expect(page.getByText('Restarted. The old attempt is preserved as history.')).toBeVisible({ timeout: 30_000 })
          await checkpoint(`${slug(SCENARIO_IDS.T18B)}-restart-confirmed`)
          await expect(strandedRows(page)).toHaveCount(0, { timeout: 30_000 })
          return { notes: `Admin restarted ${title} instance ${oldInstanceId} with the exact reason. Preview showed Section vacancy plus the spare. History proof is the runner DB correlation, not this origin label.` }
        },
      )

      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T18B, phase: 'replacement-live-at-spare', actor: 'unassignedUser' },
        SPARE_EMAIL,
        async ({ page, checkpoint }) => {
          await expectMyActionItemRow(page, title)
          await checkpoint(`${slug(SCENARIO_IDS.T18B)}-replacement-live-at-spare`)
          return { notes: `The spare holds the live step of ${title}; the vacant Section step was skipped, not substituted` }
        },
      )
    } catch (error) {
      hasPrimary = true
      primary = error
    }

    const session: { page?: Page; checkpoint?: (name: string) => Promise<void> } = {}
    const safeCheckpoint = async (name: string): Promise<void> => {
      if (!session.checkpoint) throw new Error('T18B cleanup checkpoint is unavailable')
      try {
        await session.checkpoint(name)
      } catch {
        // Checkpoint/evidence failure must not abort a feasible restoration step.
      }
    }
    await runStrandedReplacementCleanupGuarded(
      {
        reactivateSectionManager: async () => {
          if (!session.page) throw new Error('T18B cleanup session was not opened')
          await activateUserViaUi(session.page, safeCheckpoint, BUSINESS_ACTOR_EMAILS.sectionManagerP)
        },
        reactivateDepartmentManager: async () => {
          if (!session.page) throw new Error('T18B cleanup session was not opened')
          await activateUserViaUi(session.page, safeCheckpoint, BUSINESS_ACTOR_EMAILS.departmentManager)
        },
        restoreOriginalUnitManager: async () => {
          if (!session.page) throw new Error('T18B cleanup session was not opened')
          await setProductionManagerViaOrgUi(session.page, safeCheckpoint, 'Department manager')
          await expectProductionManager(session.page, 'Department manager')
        },
        removeTemporarySpareAssignment: async () => {
          if (!session.page) throw new Error('T18B cleanup session was not opened')
          await openProduction1UnitPanel(session.page)
          // openProduction1UnitPanel leaves the manage drawer open and its
          // overlay covers the tree, so the spare chip behind it can never
          // receive the click (2026-09-25 focused-run actionability timeout,
          // removal never invoked). Close the drawer via its own header
          // Close button — scoped to the drawer, not an ambiguous page-wide
          // match — and prove it unmounted (InTreeModal renders null when
          // closed) BEFORE touching the tree chip. The chip click then
          // re-opens the drawer with the person assignment panel.
          const manageDrawer = session.page.getByTestId('organization-manage-drawer')
          await manageDrawer.getByRole('button', { name: 'Close' }).click()
          await expect(manageDrawer).toHaveCount(0)
          const spareChip = session.page.getByTestId('person-chip-user-unassigned')
          if ((await spareChip.count()) === 0) {
            throw new CleanupStepAbsentError('remove-spare-assignment')
          }
          await spareChip.click()
          const panel = session.page.getByTestId('person-assignment-panel')
          await expect(panel).toBeVisible({ timeout: 30_000 })
          await panel.getByTestId('assignment-remove').click()
          await expect(panel).toHaveCount(0, { timeout: 30_000 })
          await expect(session.page.getByTestId('person-chip-user-unassigned')).toHaveCount(0)
          await safeCheckpoint('t18b-spare-assignment-removed')
        },
        verifyRestoration: async () => {
          if (!session.page) throw new Error('T18B cleanup session was not opened')
          await session.page.goto('/admin/users', { timeout: 90_000 })
          for (const email of [BUSINESS_ACTOR_EMAILS.sectionManagerP, BUSINESS_ACTOR_EMAILS.departmentManager, SPARE_EMAIL]) {
            const row = session.page.getByRole('row', { name: new RegExp(escapeRegExp(email)) })
            await expect(row.getByText('Active', { exact: true })).toBeVisible({ timeout: 30_000 })
          }
          const spareRow = session.page.getByRole('row', { name: new RegExp(escapeRegExp(SPARE_EMAIL)) })
          await expect(spareRow.getByText('General Dept')).toBeVisible({ timeout: 30_000 })
          await openProduction1UnitPanel(session.page)
          await expectProductionManager(session.page, 'Department manager')
          await expectSpareUnassigned(session.page)
          await safeCheckpoint('t18b-restoration-verified')
        },
      },
      {
        primary,
        hasPrimary,
        enter: async (run) => {
          await signedInSegment(
            browser,
            { scenario: SCENARIO_IDS.T18B, phase: 'restore-fixture', actor: 'admin' },
            BUSINESS_ACTOR_EMAILS.admin,
            async ({ page, checkpoint }) => {
              session.page = page
              session.checkpoint = checkpoint
              await run()
              return { notes: 'Cleanup used the guarded seam: each original reactivated independently; spare assignment removed only after the original manager pointer was confirmed; audit history retained' }
            },
          )
        },
        report: async (outcome) => {
          await safeCheckpoint(`t18b-cleanup-completed-${outcome.completed}`)
          if (outcome.failures.length > 0) {
            await safeCheckpoint(`t18b-cleanup-failures-${outcome.failures.map((failure) => `${failure.step}:${failure.category}`).join('+')}`)
          }
          if (outcome.blocked) {
            await safeCheckpoint(`t18b-cleanup-blocked-${outcome.blocked.step}-${outcome.blocked.reason}`)
          }
        },
      },
    )
  })

  test('T18C1 a vacant required position from the start is skipped VACANT_POSITION, never silently substituted', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T18C1')

    // staffVacantSup sits on a team with NO supervisor and their reporting
    // path starts at the Section manager: the Supervisor step is vacant from
    // the moment the attempt is created.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T18C1, phase: 'create-vacant-sup-request', actor: 'staffVacantSup' },
      BUSINESS_ACTOR_EMAILS.staffVacantSup,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T18C1: the Supervisor step is vacant from the start for this submitter.')
        return { notes: `created ${title} by the staff-with-vacant-supervisor account` }
      },
    )

    // No substitution: Supervisor P (active globally, but not on this
    // submitter's team or path) receives nothing.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T18C1, phase: 'no-substitution', actor: 'supervisorP' },
      BUSINESS_ACTOR_EMAILS.supervisorP,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T18C1)}-no-substitution`)
        return { notes: 'Supervisor P has NO action item — the vacant step was skipped, not given to an unrelated supervisor' }
      },
    )
    // The chain starts at the Section manager (the vacancy's next live step).
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T18C1, phase: 'next-live-step', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectMyActionItemRow(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T18C1)}-section-manager-first`)
        return { notes: 'Section manager P holds step 1 — the vacant Supervisor step was skipped ahead of them' }
      },
    )

    // Explicit VACANT_POSITION record through the real read-only admin
    // preview (SubmitterTestDialog reports the skip reason per step).
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T18C1, phase: 'admin-preview-vacant-skip', actor: 'admin' },
      BUSINESS_ACTOR_EMAILS.admin,
      async ({ page, checkpoint }) => {
        await page.goto('/admin/organization?panel=chains', { timeout: 90_000 })
        await expect(page.getByTestId('chains-panel')).toBeVisible({ timeout: 30_000 })
        await page.getByTestId('chains-root-customize-REQUEST').click()
        await expect(page.getByTestId('route-editor-limit-select')).toBeVisible({ timeout: 20_000 })
        await page.getByTestId('route-editor-test-submitter').click()
        await expect(page.getByTestId('submitter-test-dialog')).toBeVisible({ timeout: 20_000 })
        await page.getByTestId('submitter-test-user-select').click()
        await page.getByRole('option', { name: 'Staff with vacant supervisor', exact: true }).click()
        await page.getByTestId('submitter-test-run').click()
        const skip = page.getByTestId('submitter-test-skip-1')
        await expect(skip).toBeVisible({ timeout: 30_000 })
        await expect(skip).toContainText('VACANT_POSITION')
        await checkpoint(`${slug(SCENARIO_IDS.T18C1)}-vacant-position-recorded`)
        return { notes: 'Admin preview reports Step 1 Supervisor as "Skipped: VACANT_POSITION" for this submitter — recorded, not substituted' }
      },
    )
  })

  test('T18C2 every step vacant at creation: the engine auto-completes without approvals (recorded product behavior)', async ({ browser }) => {
    test.setTimeout(600_000)
    const title = uniqueBusinessTitle('T18C2')

    // staffVacantAll sits on the isolated vacancy branch: their real reporting
    // path holds only the dedicated anchor (position matches no route step),
    // so every chain step is vacant at creation and the engine's
    // COMPLETED_NO_ELIGIBLE_STEPS branch decides the REQUEST phase. This
    // records the implemented vacancy policy honestly (plan §6 rule 4 +
    // "newly created vacant-step outcomes are checked separately").
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T18C2, phase: 'create-all-vacant-request', actor: 'staffVacantAll' },
      BUSINESS_ACTOR_EMAILS.staffVacantAll,
      async ({ page, checkpoint }) => {
        await createRequestViaUi(page, checkpoint, title, 'T18C2: every required step is vacant at creation for this submitter.')
        // Requester-owned visibility segment: the isolated branch keeps this
        // request out of every workflow approver's sharing scope, so the
        // 'Sent to Engineer' outcome row is asserted here — requesters always
        // see their own rows (request-visibility/scope.ts requesterId).
        await expectRequestRowStatus(page, title, 'Sent to Engineer')
        // REQUIRED (Task24) runner-owned DB correlation: the exact unique
        // title is the browser-recorded identity. The runner's read-only DB
        // evaluator matches exactly one request by this title and asserts the
        // persisted all-vacant auto-completion outcome. This spec never
        // receives DATABASE_URL; the scenario performs no destructive
        // mutation after creation, so the exact title alone is identity.
        await writeT18c2BrowserCorrelation(env.evidenceDir, { requestTitle: title })
        await checkpoint(`${slug(SCENARIO_IDS.T18C2)}-auto-completed`)
        return { notes: `created ${title} by the all-steps-vacant account; the REQUEST phase auto-completed without decisions (row shows 'Sent to Engineer')` }
      },
    )

    // Recorded outcome: no step was ever actionable — the request went
    // straight past REQUEST approval (auto-completed without decisions).
    // The absent action item is NOT by itself proof of zero approvals (an
    // unrelated manager could simply not be a candidate); the DB-side proof
    // of zero approval rows is Task24's runner-owned assertion.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T18C2, phase: 'no-approver-ever-actionable', actor: 'sectionManagerP' },
      BUSINESS_ACTOR_EMAILS.sectionManagerP,
      async ({ page, checkpoint }) => {
        await expectNoMyActionItem(page, title)
        await checkpoint(`${slug(SCENARIO_IDS.T18C2)}-no-approver-actionable`)
        return { notes: 'Unrelated workflow manager never received an action item (isolated branch) — absence alone is not the zero-approvals proof; the runner-owned DB evaluator (Task24) asserts zero approval rows' }
      },
    )
  })
})
