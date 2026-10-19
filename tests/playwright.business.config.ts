import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

/**
 * Business-workflow-only Playwright configuration (never the global one).
 *
 - Runs ONLY tests/business-e2e against the isolated native runtime app:
   TEST_BASE_URL-style globals are ignored; an explicit BUSINESS_TEST_BASE_URL
   pointing at the runner-owned loopback port is mandatory.
 - Every business browser test records: video: 'on', trace: 'on', plus
   checkpoint screenshots taken by the spec into the evidence dir.
 - No webServer: the native runner starts and owns the app process.
 - No DATABASE_URL is accepted here: browser evidence only, business DB
   assertions stay in the runner/psql layer.
 */

const baseURL = process.env.BUSINESS_TEST_BASE_URL
const evidenceDir = process.env.BUSINESS_EVIDENCE_DIR

if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) {
  throw new Error('business config: BUSINESS_TEST_BASE_URL must be an explicit owned loopback URL (http://127.0.0.1:<port>)')
}
if (!evidenceDir) {
  throw new Error('business config: BUSINESS_EVIDENCE_DIR must point at the runner-owned evidence directory')
}
if (process.env.DATABASE_URL) {
  throw new Error('business config: refusing to run with a DATABASE_URL — the business spec is browser-evidence only')
}

export default defineConfig({
  // This config lives in tests/, so testDir resolves relative to tests/.
  // './tests/business-e2e' would resolve to tests/tests/business-e2e and
  // Playwright would report "No tests found" — keep it config-relative.
  testDir: './business-e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
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
    // Each explicit actor context starts/stops its own retained trace.
    // Runner-managed tracing would start it twice before navigation.
    trace: 'off',
    screenshot: 'on',
    actionTimeout: 15_000,
    // Admin routes already use a 90s goto because a warm Next dev server can
    // paint /requests before the load event fires. The 30s default timed out
    // T04A on a page that was already visible.
    navigationTimeout: 90_000,
  },
  projects: [
    {
      name: 'business-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
