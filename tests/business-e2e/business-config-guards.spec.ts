import { expect, test } from '@playwright/test'

import { createBusinessWorkflowFixture } from '../support/business-workflow-fixture'
import {
  BUSINESS_ACTOR_EMAILS,
  BUSINESS_UNITS,
  createUnitExceptionViaUi,
  requireBusinessEnv,
  selectRadixOption,
  signedInSegment as signedInSegmentFor,
  slug,
  withRecordedContext,
  type ActorSegmentLabel,
  type CheckpointPage,
} from './business-flow-helpers'

/**
 * T19 — INVALID CONFIGURATION AND AUTHORIZATION BYPASS (test-only recorded
 * slice, "all-defaults" route configuration; no workflow requests needed —
 * this case is configuration-surface evidence).
 *
 * CONFIRMED POLICY (plan T19; asserted, never weakened, never patched):
 * invalid or unauthorized changes fail WITHOUT partial writes; the last
 * valid configuration remains usable; drafts never become effective.
 *
 * What the real UI structurally enforces (verified in
 * RouteEditorPanel.tsx / ApprovalChainsPanel.tsx / approval-routes.ts):
 *  - duplicate positions: a position already used by another step is
 *    DISABLED in every other step's picker (and the server would refuse
 *    "Duplicate route position: …" — covered by the code-level regression
 *    tests/regression/clean-start-ui-chains.test.ts);
 *  - invalid rank order: the editor ALWAYS persists steps in ascending
 *    position-rank order (normalizeEditorSteps re-sorts on every change);
 *    a descending selection is re-normalized before it can be published;
 *  - steps above the approval limit: the client mirrors the server's
 *    findLimitConflicts refusal — the conflict alert renders and Publish is
 *    DISABLED (publishRoute would write nothing);
 *  - only ACTIVE positions are offered in the editor pickers;
 *  - a duplicate unit/phase exception: the Create-exception dialog refuses
 *    the pair ("cannot be duplicated") and offers Edit instead — no second
 *    published row is possible through the UI (the server's partial unique
 *    index one_published_route_per_scope_phase rejects any race);
 *  - unauthorized publish/actions: non-admins are redirected away from the
 *    admin surface by the admin layout; every chains server action re-checks
 *    admin authority server-side.
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  requireBusinessEnv()
})

const SCENARIO_IDS = {
  T19A: 'T19A-invalid-config-refused',
  T19B: 'T19B-duplicate-exception-and-unauthorized',
} as const

async function signedInSegment(
  browser: import('@playwright/test').Browser,
  label: ActorSegmentLabel,
  actorEmail: string,
  run: (tools: CheckpointPage) => Promise<{ notes: string }>,
): Promise<void> {
  await signedInSegmentFor(browser, env, label, actorEmail, run)
}

test.describe('route configuration: all-defaults', () => {
  test.skip(
    env.routesConfig !== 'all-defaults',
    `T19 belongs to the "all-defaults" route-configuration profile (active: "${env.routesConfig}")`,
  )

  test('T19A invalid route drafts are refused before any write (duplicates, rank order, limit)', async ({ browser }) => {
    test.setTimeout(600_000)

    // Probe 1 — duplicate position: a used position is disabled in other steps.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T19A, phase: 'duplicate-position-refused', actor: 'admin' },
      BUSINESS_ACTOR_EMAILS.admin,
      async ({ page, checkpoint }) => {
        await page.goto('/admin/organization?panel=chains', { timeout: 90_000 })
        await page.getByTestId('chains-root-customize-REQUEST').click()
        await expect(page.getByTestId('route-editor-limit-select')).toBeVisible({ timeout: 20_000 })
        await page.getByTestId('route-editor-add-step').click()
        await page.getByTestId('route-editor-step-4').click()
        for (const used of ['Supervisor (rank 2)', 'Section manager (rank 3)', 'Department manager (rank 4)']) {
          await expect(page.getByRole('option', { name: used, exact: true })).toBeDisabled()
        }
        await checkpoint(`${slug(SCENARIO_IDS.T19A)}-duplicate-position-disabled`)
        // Nothing was published: the discard is a plain reload (no write path).
        await page.reload({ timeout: 90_000 })
        return { notes: 'Duplicate positions: every already-used position is DISABLED in the new step\u2019s picker — no duplicate draft can be built, nothing published' }
      },
    )

    // Probe 2 — invalid rank order: a descending pick is re-normalized to
    // ascending BEFORE it can ever be published.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T19A, phase: 'rank-order-normalized', actor: 'admin' },
      BUSINESS_ACTOR_EMAILS.admin,
      async ({ page, checkpoint }) => {
        await page.goto('/admin/organization?panel=chains', { timeout: 90_000 })
        await page.getByTestId('chains-root-customize-REQUEST').click()
        await expect(page.getByTestId('route-editor-limit-select')).toBeVisible({ timeout: 20_000 })
        // Remove the Supervisor step, leaving [Section manager, Department
        // manager]; add a step and pick the LOWEST rank (Supervisor) LAST —
        // the editor must re-sort it to Step 1 (ascending persistence).
        await page.getByTestId('route-editor-remove-step-1').click()
        await page.getByTestId('route-editor-add-step').click()
        await selectRadixOption(page, 'route-editor-step-3', 'Supervisor (rank 2)')
        await expect(page.getByTestId('route-editor-step-1')).toContainText('Supervisor (rank 2)', { timeout: 10_000 })
        await expect(page.getByTestId('route-editor-step-2')).toContainText('Section manager (rank 3)')
        await checkpoint(`${slug(SCENARIO_IDS.T19A)}-rank-order-normalized`)
        await page.reload({ timeout: 90_000 })
        return { notes: 'Rank order: a descending pick (Supervisor added after Section manager) was re-normalized to ascending Step order before publish — an out-of-order chain cannot be written' }
      },
    )

    // Probe 3 — steps above the approval limit: conflict alert + Publish
    // disabled (the server returns the identical refusal and writes nothing).
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T19A, phase: 'limit-conflict-blocks-publish', actor: 'admin' },
      BUSINESS_ACTOR_EMAILS.admin,
      async ({ page, checkpoint }) => {
        await page.goto('/admin/organization?panel=chains', { timeout: 90_000 })
        await page.getByTestId('chains-root-customize-REQUEST').click()
        await expect(page.getByTestId('route-editor-limit-select')).toBeVisible({ timeout: 20_000 })
        // Lower the limit below existing steps: Section manager + Department
        // manager now exceed the Supervisor limit.
        await selectRadixOption(page, 'route-editor-limit-select', 'Supervisor (rank 2)')
        await expect(page.getByTestId('route-editor-conflicts')).toBeVisible({ timeout: 20_000 })
        await expect(page.getByTestId('route-editor-conflicts')).toContainText('EXCEEDS_LIMIT')
        await expect(page.getByTestId('route-editor-publish')).toBeDisabled()
        await checkpoint(`${slug(SCENARIO_IDS.T19A)}-limit-conflict-publish-disabled`)
        await page.reload({ timeout: 90_000 })
        return { notes: 'Limit conflict: steps above the lowered approval limit render the EXCEEDS_LIMIT alert and DISABLE Publish — the refusal happens before any transaction' }
      },
    )

    // Probe 4 — only ACTIVE positions are offered (inactive positions are
    // structurally unreachable; the server-side "Inactive route position"
    // refusal is covered by clean-start-ui-chains.test.ts). The count is the
    // fixture's active set, including Vacancy anchor, not a stale four.
    await signedInSegment(
      browser,
      { scenario: SCENARIO_IDS.T19A, phase: 'active-positions-only', actor: 'admin' },
      BUSINESS_ACTOR_EMAILS.admin,
      async ({ page, checkpoint }) => {
        const activeLabels = createBusinessWorkflowFixture().positions
          .filter((row) => row.isActive)
          .map((row) => `${row.name} (rank ${row.rank})`)
        await page.goto('/admin/organization?panel=chains', { timeout: 90_000 })
        await page.getByTestId('chains-root-customize-REQUEST').click()
        await expect(page.getByTestId('route-editor-limit-select')).toBeVisible({ timeout: 20_000 })
        await page.getByTestId('route-editor-step-1').click()
        const options = page.getByRole('option')
        await expect(options).toHaveCount(activeLabels.length, { timeout: 10_000 })
        for (const expected of activeLabels) {
          await expect(page.getByRole('option', { name: expected, exact: true })).toBeVisible()
        }
        await checkpoint(`${slug(SCENARIO_IDS.T19A)}-active-positions-only`)
        await page.reload({ timeout: 90_000 })
        return { notes: 'Only the ACTIVE fixture positions are offered, including Vacancy anchor; an inactive position cannot be drafted (server validation is regression-covered)' }
      },
    )
  })

  test('T19B a duplicate unit/phase exception is refused and unauthorized publish is denied; last valid config stays usable', async ({ browser }) => {
    test.setTimeout(600_000)

    try {
      // Publish ONE valid test-only exception (Engineering Section REQUEST —
      // a scope no other business scenario submits requests from, so this
      // cannot disturb the workflow suites).
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T19B, phase: 'publish-valid-exception', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await createUnitExceptionViaUi(page, checkpoint, {
            unitId: BUSINESS_UNITS.engineeringSection,
            unitName: 'Engineering Section',
            phase: 'REQUEST',
            phaseLabel: 'Request',
            removeFirstSteps: 2,
          })
          return { notes: 'Published a valid REQUEST exception at Engineering Section (Department manager only) — the last-valid-config baseline' }
        },
      )

      // Duplicate unit/phase: the Create-exception dialog refuses the pair
      // and offers Edit instead — no second publish is possible, and the
      // published v1 remains untouched.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T19B, phase: 'duplicate-exception-refused', actor: 'admin' },
        BUSINESS_ACTOR_EMAILS.admin,
        async ({ page, checkpoint }) => {
          await page.goto('/admin/organization?panel=chains', { timeout: 90_000 })
          await page.getByTestId('chains-create-exception').first().click()
          await expect(page.getByTestId('chains-create-exception-dialog')).toBeVisible({ timeout: 20_000 })
          await selectRadixOption(page, 'chains-create-exception-unit-select', 'Engineering Section')
          await selectRadixOption(page, 'chains-create-exception-phase-select', 'Request')
          await expect(page.getByTestId('chains-create-exception-existing')).toBeVisible({ timeout: 20_000 })
          await expect(page.getByTestId('chains-create-exception-existing')).toContainText('cannot be duplicated')
          await expect(page.getByTestId('chains-create-exception-submit')).toHaveCount(0)
          await checkpoint(`${slug(SCENARIO_IDS.T19B)}-duplicate-refused`)
          // The last valid configuration remains usable: the published row is intact.
          await page.getByTestId('chains-create-exception-cancel').click()
          const row = page.getByTestId(`chains-exception-${BUSINESS_UNITS.engineeringSection}-REQUEST`)
          await expect(row).toBeVisible({ timeout: 20_000 })
          await expect(row.getByText('Steps: Department manager · Approval limit: Department manager')).toBeVisible()
          return { notes: 'Duplicate unit/phase exception REFUSED ("cannot be duplicated", no Create button) and the published v1 remains usable' }
        },
      )

      // Unauthorized publish/actions: a non-admin is redirected away from
      // the admin surface, so no publish/restart/delete control is reachable.
      await signedInSegment(
        browser,
        { scenario: SCENARIO_IDS.T19B, phase: 'unauthorized-publish-denied', actor: 'requesterA' },
        BUSINESS_ACTOR_EMAILS.requesterA,
        async ({ page, checkpoint }) => {
          await page.goto('/admin/organization?panel=chains', { timeout: 90_000 })
          await expect(page).toHaveURL(/\/requests/, { timeout: 30_000 })
          await expect(page.getByTestId('chains-panel')).toHaveCount(0)
          await page.goto('/admin/users', { timeout: 90_000 })
          await expect(page).toHaveURL(/\/requests/, { timeout: 30_000 })
          await checkpoint(`${slug(SCENARIO_IDS.T19B)}-non-admin-denied`)
          return { notes: 'Requester A was redirected from BOTH /admin/organization and /admin/users to /requests — unauthorized publish/actions are unreachable (server actions re-check admin authority)' }
        },
      )
    } finally {
      // Idempotent cleanup: remove the test-only exception so the seeded
      // configuration is exactly restored for every later suite.
      await withRecordedContext(
        browser,
        env,
        { scenario: SCENARIO_IDS.T19B, phase: 'cleanup-exception', actor: 'admin' },
        async ({ page }) => {
          await page.goto('/admin/organization?panel=chains', { timeout: 90_000 })
          const row = page.getByTestId(`chains-exception-${BUSINESS_UNITS.engineeringSection}-REQUEST`)
          if ((await row.count()) === 0) {
            return { notes: 'cleanup: no REQUEST exception at Engineering Section — nothing to remove' }
          }
          await row.getByTestId(`chains-exception-delete-${BUSINESS_UNITS.engineeringSection}-REQUEST`).click()
          await page.getByTestId('chains-exception-delete-confirm').click()
          await expect(page.getByTestId(`chains-exception-${BUSINESS_UNITS.engineeringSection}-REQUEST`)).toHaveCount(0, { timeout: 30_000 })
          return { notes: 'cleanup: removed the test-only REQUEST exception at Engineering Section (seeded config restored)' }
        },
      )
    }
  })
})
