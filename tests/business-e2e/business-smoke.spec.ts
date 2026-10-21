import { expect, test } from '@playwright/test'

import {
  BUSINESS_ACTOR_EMAILS,
  createRequestViaUi,
  requireBusinessEnv,
  signIn,
  withRecordedContext,
} from './business-flow-helpers'

/**
 * T01 — Request creation permissions (business smoke, test-only runtime).
 *
 * Every actor scenario is its OWN test with an EXPLICIT recording context,
 * so one actor failing never skips the others. Recording, evidence manifest
 * and screenshot plumbing live in ./business-flow-helpers.ts (extracted from
 * this spec unchanged); see that module for the ordering guarantees.
 *
 * Scenarios here (bounded first slice of T01, executed 3/3 in the reviewed
 * native full run):
 *  - requesterA signs in and creates a Production 1 request;
 *  - supervisorP signs in and creates a second Production 1 request;
 *  - inactiveUser cannot sign in — evidence is the server-denied
 *    "Invalid email or password" error rendered on /sign-in, not an
 *    arbitrary navigation timeout.
 */

const env = requireBusinessEnv()

test.beforeAll(() => {
  // Re-validate on every run start; requireBusinessEnv already threw at
  // import time if the runner-owned env is missing.
  requireBusinessEnv()
})

test('T01 requesterA signs in and creates a Production 1 request', async ({ browser }) => {
  const requesterTitle = `Business T01 requester A ${Date.now()}`
  await withRecordedContext(
    browser,
    env,
    { scenario: 'T01-request-creation', phase: 'create-request', actor: 'requesterA' },
    async ({ page, checkpoint }) => {
      await signIn(page, BUSINESS_ACTOR_EMAILS.requesterA, env.e2ePassword)
      await checkpoint('t01-requester-a-signed-in')
      await createRequestViaUi(
        page,
        checkpoint,
        requesterTitle,
        'Business smoke T01: Production 1 request created in the isolated native runtime.',
      )
      await checkpoint('t01-requester-a-request-created')
      return { notes: `created request: ${requesterTitle}` }
    },
  )
})

test('T01 supervisorP signs in and creates a Production 1 request', async ({ browser }) => {
  const supervisorTitle = `Business T01 supervisor P ${Date.now()}`
  await withRecordedContext(
    browser,
    env,
    { scenario: 'T01-request-creation', phase: 'create-request', actor: 'supervisorP' },
    async ({ page, checkpoint }) => {
      await signIn(page, BUSINESS_ACTOR_EMAILS.supervisorP, env.e2ePassword)
      await checkpoint('t01-supervisor-p-signed-in')
      await createRequestViaUi(
        page,
        checkpoint,
        supervisorTitle,
        'Business smoke T01: Production 1 request created in the isolated native runtime.',
      )
      await checkpoint('t01-supervisor-p-request-created')
      return { notes: `created request: ${supervisorTitle}` }
    },
  )
})

test('T01 inactiveUser is denied sign-in by the server check', async ({ browser }) => {
  await withRecordedContext(
    browser,
    env,
    { scenario: 'T01-request-creation', phase: 'sign-in-denied', actor: 'inactiveUser' },
    async ({ page, checkpoint }) => {
      await page.goto('/sign-in')
      await page.locator('#email').fill(BUSINESS_ACTOR_EMAILS.inactiveUser)
      await page.locator('#password').fill(env.e2ePassword)
      await page.getByRole('button', { name: 'Sign in' }).click()
      // Login-denied evidence: the server rejection is rendered on /sign-in
      // (src/app/(auth)/sign-in/[[...sign-in]]/page.tsx sets exactly this
      // text when credentials are refused), and navigation never leaves
      // /sign-in. This asserts denial directly instead of relying on a
      // navigation timeout as "proof".
      await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 20_000 })
      await expect(page).toHaveURL(/\/sign-in/)
      await checkpoint('t01-inactive-user-rejected')
      return { notes: 'inactive sign-in rejected server-side: "Invalid email or password" shown on /sign-in' }
    },
  )
})
