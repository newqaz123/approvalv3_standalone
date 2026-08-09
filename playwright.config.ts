import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
// An explicit external test target disables the local dev server so the suite
// runs against the supplied environment; otherwise the existing local dev
// server is started as before.
const externalBaseUrl = process.env.TEST_BASE_URL

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run tests serially to avoid conflicts with shared auth state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid concurrent login issues
  reporter: 'html',
  use: {
    baseURL: externalBaseUrl || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the local dev server before running tests, unless an explicit
  // external TEST_BASE_URL is configured (then the caller manages the target).
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
});
