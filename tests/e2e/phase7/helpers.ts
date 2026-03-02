import { test as base, expect, Page } from '@playwright/test';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Test configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = 'patawatnew@gmail.com';
const ADMIN_PASSWORD = 'warfuf-batno6-fimQoc';

// Logging setup
const LOG_DIR = join(process.cwd(), 'tests', 'e2e', 'phase7', 'logs');
const TEST_LOG_FILE = join(LOG_DIR, `test-run-${new Date().toISOString().replace(/:/g, '-')}.log`);

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

// Initialize log file
writeFileSync(TEST_LOG_FILE, `Phase 7 E2E Tests - Started at ${new Date().toISOString()}\n`);
writeFileSync(TEST_LOG_FILE, `Base URL: ${BASE_URL}\n`);
writeFileSync(TEST_LOG_FILE, `Admin User: ${ADMIN_EMAIL}\n`);
writeFileSync(TEST_LOG_FILE, '='.repeat(80) + '\n\n');

export function log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${type.toUpperCase()}]`;
  const logLine = `${prefix} ${message}\n`;
  
  appendFileSync(TEST_LOG_FILE, logLine);
  
  // Also log to console with colors
  const colors = {
    info: '\x1b[36m',    // cyan
    success: '\x1b[32m', // green
    error: '\x1b[31m',   // red
    warning: '\x1b[33m', // yellow
  };
  console.log(`${colors[type]}${prefix}\x1b[0m ${message}`);
}

export function logTestStart(testName: string) {
  log(`\n${'='.repeat(80)}`, 'info');
  log(`STARTING TEST: ${testName}`, 'info');
  log(`${'='.repeat(80)}\n`, 'info');
}

export function logTestEnd(testName: string, passed: boolean, duration: number) {
  log(`\n${'='.repeat(80)}`, passed ? 'success' : 'error');
  log(`TEST ${passed ? 'PASSED' : 'FAILED'}: ${testName}`, passed ? 'success' : 'error');
  log(`Duration: ${duration}ms`, 'info');
  log(`${'='.repeat(80)}\n`, passed ? 'success' : 'error');
}

export function logAction(action: string, details?: string) {
  const detailStr = details ? ` - ${details}` : '';
  log(`ACTION: ${action}${detailStr}`, 'info');
}

export function logVerification(verification: string, passed: boolean, details?: string) {
  const status = passed ? '✓ PASS' : '✗ FAIL';
  const detailStr = details ? ` (${details})` : '';
  log(`VERIFY: ${verification} - ${status}${detailStr}`, passed ? 'success' : 'error');
}

export function logCorrection(correction: string, reason: string) {
  log(`\n⚠ CORRECTION NEEDED:`, 'warning');
  log(`  Reason: ${reason}`, 'warning');
  log(`  Action: ${correction}`, 'warning');
  log(`  Rollback: Restore original hierarchy state before test\n`, 'warning');
}

// Extend test with authentication
export const test = base.extend<{
  adminPage: Page;
}>({
  adminPage: async ({ browser }, use) => {
    logTestStart('Admin Authentication Setup');
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    logAction('Navigating to login page');
    await page.goto(`${BASE_URL}/sign-in`);
    
    logAction('Waiting for Clerk form to load');
    await page.waitForSelector('input[name="identifier"]', { timeout: 10000 });
    
    logAction('Filling login credentials');
    await page.fill('input[name="identifier"]', ADMIN_EMAIL);
    await page.fill('input[name="password"]', ADMIN_PASSWORD);
    
    logAction('Clicking sign in button');
    await page.click('button:has-text("Sign in"), button:has-text("Continue")');
    
    logAction('Waiting for navigation to complete');
    await page.waitForURL(/\/(admin|dashboard)/, { timeout: 15000 });
    
    const currentUrl = page.url();
    logVerification('Login successful', true, `Redirected to ${currentUrl}`);
    
    await use(page);
    
    logAction('Closing admin browser context');
    await context.close();
  },
});

export { expect };
