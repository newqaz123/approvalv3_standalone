import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

/**
 * Admin-HTTP-security-only Playwright configuration (never the global one).
 *
 - Runs ONLY tests/admin-e2e against the isolated native runtime app: an
   explicit ADMIN_TEST_BASE_URL pointing at the runner-owned loopback port is
   mandatory (TEST_BASE_URL-style globals are ignored).
 - Every admin browser/HTTP test records video and a JSON report into the
   runner-owned evidence dir; traces are per-actor-context like the business
   suite.
 - No webServer: the native admin runner starts and owns the app process.
 - No DATABASE_URL is accepted here: browser/HTTP evidence only; admin DB
   assertions stay in the runner/psql layer
   (tests/support/native/capture-admin-security-db-evidence.ts).
 - ADMIN_APP_DIR is a READ-ONLY filesystem view of the isolated app copy the
   runner owns: the spec resolves REAL server-action ids from the
   app-generated .next/server/server-reference-manifest.json of THIS run. It
   is never a database handle.
 */

const baseURL = process.env.ADMIN_TEST_BASE_URL
const evidenceDir = process.env.ADMIN_EVIDENCE_DIR

if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) {
  throw new Error('admin config: ADMIN_TEST_BASE_URL must be an explicit owned loopback URL (http://127.0.0.1:<port>)')
}
if (!evidenceDir) {
  throw new Error('admin config: ADMIN_EVIDENCE_DIR must point at the runner-owned evidence directory')
}
if (process.env.DATABASE_URL) {
  throw new Error('admin config: refusing to run with a DATABASE_URL — the admin spec is browser/HTTP-evidence only')
}

export default defineConfig({
  // This config lives in tests/, so testDir resolves relative to tests/.
  testDir: './admin-e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 180_000,
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(evidenceDir, 'playwright-report.json') }],
  ],
  outputDir: path.join(evidenceDir, 'playwright-output'),
  preserveOutput: 'always',
  use: {
    baseURL,
    headless: true,
    video: 'on',
    // Each actor context starts/stops its own retained trace.
    trace: 'off',
    screenshot: 'on',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'admin-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
