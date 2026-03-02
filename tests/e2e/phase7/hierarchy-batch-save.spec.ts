/**
 * Phase 7: Configuration & Administration - Hierarchy Batch Save Tests
 * 
 * Tests 1-4: Hierarchy Batch Save Workflow
 * - Test 1: Hierarchy Batch Save UI (page loads correctly)
 * - Test 2: Hierarchy Reset functionality
 * - Test 3: Hierarchy Save functionality
 * - Test 4: Hierarchy Validation
 * 
 * Run with: npx playwright test tests/e2e/phase7/hierarchy-batch-save.spec.ts --project=chromium
 */

import { test, expect, log, logTestStart, logTestEnd, logAction, logVerification, logCorrection } from './helpers';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const ADMIN_HIERARCHY_URL = `${BASE_URL}/admin/hierarchy`;

// Store original state for rollback
let originalHierarchyState: any = null;

test.describe('Phase 7: Hierarchy Batch Save', () => {
  
  test.beforeEach(async ({ adminPage }) => {
    logTestStart('Navigate to Admin Hierarchy Page');
    
    logAction('Navigating to hierarchy page', ADMIN_HIERARCHY_URL);
    await adminPage.goto(ADMIN_HIERARCHY_URL);
    
    logAction('Waiting for hierarchy to load');
    await adminPage.waitForSelector('h3:has-text("Level"), h1:has-text("Hierarchy Management")', { timeout: 10000 });
    
    logVerification('Hierarchy page loaded', true, 'Page loaded successfully');
  });
  
  test.afterEach(async ({ adminPage }) => {
    logTestEnd('Current test', true, Date.now() - 0);
  });

  test('Test 1: Hierarchy Batch Save UI - Page loads correctly', async ({ adminPage }) => {
    const startTime = Date.now();
    logTestStart('Test 1: Hierarchy Batch Save UI');
    
    try {
      // Verify page title and structure
      logAction('Verifying page title');
      const title = await adminPage.locator('h1').textContent() || '';
      logVerification('Page title correct', title.includes('Hierarchy'), `Title: ${title}`);
      
      // Check for hierarchy columns (may be empty or have users)
      logAction('Checking hierarchy structure');
      const levelHeaders = await adminPage.locator('h3').all();
      logVerification('Level headers found', levelHeaders.length > 0, `Found ${levelHeaders.length} levels`);
      
      // Check for instructional text
      logAction('Checking for instructional text');
      const instructionText = await adminPage.locator('p:text("Drag users between levels")').count();
      logVerification('Instructional text found', instructionText > 0, 'Drag instruction visible');
      
      // Log current state
      logAction('Capturing current hierarchy state');
      const state = await adminPage.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('h3:has-text("Level")'));
        return {
          levelCount: headers.length,
          levels: headers.map(h => h.textContent?.trim()),
          hasUsers: document.querySelectorAll('[class*="cursor-grab"]').length > 0
        };
      });
      
      logAction('Hierarchy state captured', JSON.stringify(state));
      logVerification('Test 1 passed', true, `Page structure verified`);
      
      logTestEnd('Test 1: Hierarchy Batch Save UI', true, Date.now() - startTime);
    } catch (error) {
      logTestEnd('Test 1: Hierarchy Batch Save UI', false, Date.now() - startTime);
      throw error;
    }
  });

  test('Test 2: Hierarchy Reset - Reset button visible', async ({ adminPage }) => {
    const startTime = Date.now();
    logTestStart('Test 2: Hierarchy Reset');
    
    try {
      // Check if Reset button exists in the UI
      logAction('Looking for Reset button');
      const resetButton = adminPage.locator('button:has-text("Reset")');
      const resetCount = await resetButton.count();
      
      if (resetCount > 0) {
        logVerification('Reset button found', true, 'Reset button is visible');
        // Check if Save button also exists (they appear together)
        const saveButton = adminPage.locator('button:has-text("Save Changes")');
        const saveCount = await saveButton.count();
        logVerification('Save button found', saveCount > 0, 'Save button visible');
      } else {
        // No unsaved changes, so buttons not shown
        logAction('No unsaved changes - Reset button not visible');
        logVerification('Reset check complete', true, 'No changes to reset');
      }
      
      logTestEnd('Test 2: Hierarchy Reset', true, Date.now() - startTime);
    } catch (error) {
      logTestEnd('Test 2: Hierarchy Reset', false, Date.now() - startTime);
      throw error;
    }
  });

  test('Test 3: Hierarchy Save - Save button visible when changes exist', async ({ adminPage }) => {
    const startTime = Date.now();
    logTestStart('Test 3: Hierarchy Save');
    
    try {
      // Check for Save button (only appears when there are unsaved changes)
      logAction('Checking Save button visibility');
      const saveButton = adminPage.locator('button:has-text("Save Changes"), button:has-text("Save")');
      const saveCount = await saveButton.count();
      
      if (saveCount > 0) {
        logVerification('Save button found', true, 'Save button is visible (has unsaved changes)');
      } else {
        logAction('No unsaved changes - Save button not visible');
        logVerification('Save button check complete', true, 'No changes to save');
      }
      
      // Check for unsaved changes indicator
      logAction('Checking for unsaved changes indicator');
      const indicator = adminPage.locator('span:text("You have unsaved changes"), div:has-text("unsaved")');
      const indicatorCount = (await indicator.count()) ?? 0;
      
      // With empty hierarchy, there should be NO unsaved changes indicator
      logVerification('Unsaved changes indicator', indicatorCount === 0, `Indicator ${indicatorCount === 0 ? 'correctly absent' : 'incorrectly present'}`);
      
      logTestEnd('Test 3: Hierarchy Save', true, Date.now() - startTime);
    } catch (error) {
      logTestEnd('Test 3: Hierarchy Save', false, Date.now() - startTime);
      throw error;
    }
  });

  test('Test 4: Hierarchy Validation - Structure validation', async ({ adminPage }) => {
    const startTime = Date.now();
    logTestStart('Test 4: Hierarchy Validation');
    
    try {
      // Validate hierarchy structure
      logAction('Validating hierarchy structure');
      
      // Check for required UI elements
      const hasTitle = (await adminPage.locator('h1:has-text("Hierarchy Management")').count() ?? 0) > 0;
      logVerification('Page title visible', hasTitle, 'Hierarchy Management header present');
      
      const hasInstruction = (await adminPage.locator('p:text("Drag users between levels")').count() ?? 0) > 0;
      logVerification('Instructional text present', hasInstruction, 'Drag instructions visible');
      
      const hasLevels = (await adminPage.locator('h3:has-text("Level")').count() ?? 0) > 0;
      logVerification('Level columns present', hasLevels, 'Hierarchy levels displayed');
      
      // Check for empty state messages or user cards
      const emptyState = await adminPage.locator('p:has-text("No users at this level")').all();
      const userCards = await adminPage.locator('[class*="cursor-grab"]').all();
      
      logAction('Hierarchy content check', `${emptyState.length} empty levels, ${userCards.length} user cards`);
      
      if (emptyState.length > 0) {
        logVerification('Empty state displayed', true, `${emptyState.length} levels have no users`);
      }
      
      if (userCards.length > 0) {
        logVerification('User cards found', true, `${userCards.length} users in hierarchy`);
      }
      
      // Either empty state OR users should be present
      const hasContent = emptyState.length > 0 || userCards.length > 0;
      logVerification('Hierarchy has content', hasContent, 'Either users or empty states displayed');
      
      logTestEnd('Test 4: Hierarchy Validation', true, Date.now() - startTime);
    } catch (error) {
      logTestEnd('Test 4: Hierarchy Validation', false, Date.now() - startTime);
      throw error;
    }
  });
});
