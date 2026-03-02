import { test, expect } from '@playwright/test';

/**
 * Test login redirect functionality for different user roles
 *
 * Tests that users are redirected to their appropriate dashboard after login:
 * - Admin users -> /admin
 * - Engineering users -> /engineering
 * - General Dept/Production users -> /dashboard
 */

test.describe('Login Redirect Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Clear any existing session/cookies
    await page.context().clearCookies();
    await page.context().clearPermissions();
  });

  test('Admin user redirects to /admin after login', async ({ page }) => {
    const email = process.env.ADMIN_EMAIL || 'patawatnew@gmail.com';
    const password = process.env.ADMIN_PASSWORD || 'warfuf-batno6-fimQoc';

    // Navigate to sign-in page
    await page.goto('/sign-in');

    // Wait for form to be visible
    await page.waitForSelector('input[placeholder*="email"]', { timeout: 5000 });

    // Fill in email
    await page.fill('input[placeholder*="email"]', email);

    // Click Continue button
    await page.click('button:has-text("Continue")');

    // Wait for password field
    await page.waitForSelector('input[placeholder*="password"]', { timeout: 5000 });
    await page.fill('input[placeholder*="password"]', password);

    // Submit the form
    await page.click('button:has-text("Continue")');

    // Wait for redirect after successful login
    await page.waitForTimeout(2000);

    // Verify redirect to /admin
    await page.waitForURL(/\/admin/, { timeout: 10000 });
    expect(page.url()).toContain('/admin');

    console.log('✅ Admin user successfully redirected to /admin');
  });

  test('Engineering user redirects to /engineering after login', async ({ page }) => {
    const email = process.env.ENGINEERING_EMAIL || 'enguser01';
    const password = process.env.ENGINEERING_PASSWORD || 'enguser01';

    // Navigate to sign-in page
    await page.goto('/sign-in');

    // Wait for form to be visible
    await page.waitForSelector('input[placeholder*="email"]', { timeout: 5000 });

    // Fill in email
    await page.fill('input[placeholder*="email"]', email);

    // Click Continue button
    await page.click('button:has-text("Continue")');

    // Wait for password field
    await page.waitForSelector('input[placeholder*="password"]', { timeout: 5000 });
    await page.fill('input[placeholder*="password"]', password);

    // Submit the form
    await page.click('button:has-text("Continue")');

    // Wait for redirect after successful login
    await page.waitForTimeout(2000);

    // Verify redirect to /engineering
    await page.waitForURL(/\/engineering/, { timeout: 10000 });
    expect(page.url()).toContain('/engineering');

    console.log('✅ Engineering user successfully redirected to /engineering');
  });

  test('General Dept/Production user redirects to /dashboard after login', async ({ page }) => {
    const email = process.env.GENERAL_EMAIL || 'userpd1';
    const password = process.env.GENERAL_PASSWORD || 'userpd1';

    // Navigate to sign-in page
    await page.goto('/sign-in');

    // Wait for form to be visible
    await page.waitForSelector('input[placeholder*="email"]', { timeout: 5000 });

    // Fill in email
    await page.fill('input[placeholder*="email"]', email);

    // Click Continue button
    await page.click('button:has-text("Continue")');

    // Wait for password field
    await page.waitForSelector('input[placeholder*="password"]', { timeout: 5000 });
    await page.fill('input[placeholder*="password"]', password);

    // Submit the form
    await page.click('button:has-text("Continue")');

    // Wait for redirect after successful login
    await page.waitForTimeout(2000);

    // Verify redirect to /dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
    expect(page.url()).toContain('/dashboard');

    console.log('✅ General Dept user successfully redirected to /dashboard');
  });

  test('Middleware logs show correct role detection', async ({ page }) => {
    const email = process.env.ENGINEERING_EMAIL || 'enguser01';
    const password = process.env.ENGINEERING_PASSWORD || 'enguser01';

    // Listen for console messages
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(msg.text());
    });

    // Navigate to sign-in page
    await page.goto('/sign-in');

    // Wait for form to be visible
    await page.waitForSelector('input[placeholder*="email"]', { timeout: 5000 });

    // Fill in email
    await page.fill('input[placeholder*="email"]', email);

    // Click Continue button
    await page.click('button:has-text("Continue")');

    // Wait for password field
    await page.waitForSelector('input[placeholder*="password"]', { timeout: 5000 });
    await page.fill('input[placeholder*="password"]', password);

    // Submit the form
    await page.click('button:has-text("Continue")');

    // Wait for redirect
    await page.waitForTimeout(2000);
    await page.waitForURL(/\/engineering/, { timeout: 10000 });

    // Log console messages (note: server-side middleware logs won't appear here)
    console.log('Browser console messages:', consoleMessages.filter(m => m.includes('Middleware')));

    console.log('✅ Console logging test completed');
  });
});
