import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

test('simple page load test', async ({ page }) => {
  console.log('Navigating to:', BASE_URL);
  
  // Just try to load the homepage first
  await page.goto(BASE_URL, { timeout: 30000 });
  
  console.log('Page loaded, URL:', page.url());
  
  // Take a screenshot to see what's there
  await page.screenshot({ path: 'homepage.png' });
  
  // Check if we're on sign-in page
  const signInText = await page.locator('text=/sign in|login/i').count();
  console.log('Sign in elements found:', signInText);
});
