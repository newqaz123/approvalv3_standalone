import { test, expect } from '@playwright/test';

/**
 * Test login redirect for additional test users
 *
 * Testing:
 * - test03@gmail.com (general_dept) -> /dashboard
 * - patawatnew (engineering) -> /engineering
 */

test.describe('Additional User Login Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Clear any existing session/cookies
    await page.context().clearCookies();
    await page.context().clearPermissions();
  });

  test('test03@gmail.com (general_dept) redirects to /dashboard after login', async ({ page }) => {
    const email = 'test03@gmail.com';
    const password = 'burvox-qeMfad-7jimzu';

    console.log('🧪 Starting test03@gmail.com (general_dept) test...');
    console.log('📍 Navigating to sign-in page');
    await page.goto('/sign-in');
    await page.waitForTimeout(2000); // Pause for visibility

    console.log('📍 Waiting for form to be visible');
    await page.waitForSelector('input[placeholder*="email"]', { timeout: 5000 });
    await page.waitForTimeout(1000);

    console.log(`📍 Filling in email: ${email}`);
    await page.fill('input[placeholder*="email"]', email);
    await page.waitForTimeout(1500); // Pause to see email being filled

    console.log('📍 Clicking Continue button');
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(2000); // Pause to see transition

    console.log('📍 Waiting for password field');
    await page.waitForSelector('input[placeholder*="password"]', { timeout: 5000 });
    await page.waitForTimeout(1000);

    console.log('📍 Filling in password');
    await page.fill('input[placeholder*="password"]', password);
    await page.waitForTimeout(1500); // Pause to see password being filled

    console.log('📍 Submitting form');
    await page.click('button:has-text("Continue")');

    console.log('⏳ Waiting for redirect after login...');
    await page.waitForTimeout(3000); // Longer pause to observe redirect

    console.log('📍 Verifying redirect to /dashboard (expected for general_dept)');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
    expect(page.url()).toContain('/dashboard');

    console.log('✅ test03@gmail.com successfully redirected to /dashboard');
    await page.waitForTimeout(3000); // Pause before next test
  });

  test('patawatnew (engineering) redirects to /engineering after login', async ({ page }) => {
    const email = 'patawatnew@hotmail.com';
    const password = 'fekQi6-meztas-muttav';

    console.log('🧪 Starting patawatnew@hotmail.com (engineering) test...');
    console.log('📍 Navigating to sign-in page');
    await page.goto('/sign-in');
    await page.waitForTimeout(2000); // Pause for visibility

    console.log('📍 Waiting for form to be visible');
    await page.waitForSelector('input[placeholder*="email"]', { timeout: 5000 });
    await page.waitForTimeout(1000);

    console.log(`📍 Filling in email: ${email}`);
    await page.fill('input[placeholder*="email"]', email);
    await page.waitForTimeout(1500); // Pause to see email being filled

    console.log('📍 Clicking Continue button');
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(2000); // Pause to see transition

    console.log('📍 Waiting for password field');
    await page.waitForSelector('input[placeholder*="password"]', { timeout: 5000 });
    await page.waitForTimeout(1000);

    console.log('📍 Filling in password');
    await page.fill('input[placeholder*="password"]', password);
    await page.waitForTimeout(1500); // Pause to see password being filled

    console.log('📍 Submitting form');
    await page.click('button:has-text("Continue")');

    console.log('⏳ Waiting for redirect after login...');
    await page.waitForTimeout(3000); // Longer pause to observe redirect

    console.log('📍 Verifying redirect to /engineering (expected for engineering role)');
    await page.waitForURL(/\/engineering/, { timeout: 10000 });
    expect(page.url()).toContain('/engineering');

    console.log('✅ patawatnew@hotmail.com successfully redirected to /engineering');
    await page.waitForTimeout(3000); // Pause before next test
  });
});
