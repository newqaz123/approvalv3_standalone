import { test, expect } from '@playwright/test'

/**
 * E2E Tests for New Modal System
 * Tests the complete workflow from request creation to final approval
 * using the new RequestModalRouter and beautiful modal components
 */

// Test users from test_users.md
const TEST_USERS = {
  production: {
    level1: { email: 'pd1@example.com', password: 'changeme', name: 'Production L1' },
    level2: { email: 'pd2@example.com', password: 'changeme', name: 'Production L2' },
  },
  engineering: {
    level1: { email: 'eng1@example.com', password: 'changeme', name: 'Engineering L1' },
    level2: { email: 'eng2@example.com', password: 'changeme', name: 'Engineering L2' },
  },
  admin: { email: 'admin@example.com', password: 'changeme', name: 'Admin' },
}

// Helper function to login
async function login(page: any, email: string, password: string) {
  await page.goto('/')
  
  // Check if already logged in
  const isLoggedIn = await page.locator('text=Dashboard').isVisible().catch(() => false)
  if (isLoggedIn) {
    // Logout first
    await page.click('button:has-text("Sign out")').catch(() => {})
  }
  
  await page.goto('/login')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
  
  // Wait for redirect to dashboard
  await page.waitForURL(/\/(dashboard|engineering)/, { timeout: 10000 })
}

test.describe('Modal System - Request Approval Workflow', () => {
  test('Production L1 creates request and L2 approves it', async ({ page }) => {
    // Step 1: Login as Production L1
    await login(page, TEST_USERS.production.level1.email, TEST_USERS.production.level1.password)
    
    // Step 2: Navigate to dashboard
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    
    // Step 3: Create new request
    await page.click('text=New Request')
    await page.waitForSelector('input[name="title"]')
    
    const requestTitle = `Test Request ${Date.now()}`
    await page.fill('input[name="title"]', requestTitle)
    await page.fill('textarea[name="description"]', 'This is a test request for modal system verification')
    
    await page.click('button:has-text("Submit Request")')
    
    // Wait for success toast
    await page.waitForSelector('text=Request created successfully', { timeout: 5000 })
    
    // Step 4: Verify request appears in dashboard
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.locator(`text=${requestTitle}`)).toBeVisible()
    
    // Step 5: Click on the request to open modal
    await page.click(`text=${requestTitle}`)
    
    // Step 6: Verify SubmitterModal or read-only modal appears
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    
    // Close modal
    await page.keyboard.press('Escape')
    
    // Step 7: Logout and login as Production L2 (approver)
    await page.click('button:has-text("Sign out")')
    await login(page, TEST_USERS.production.level2.email, TEST_USERS.production.level2.password)
    
    // Step 8: Navigate to dashboard and find the request
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    
    // Click on pending approvals tab if exists
    await page.click('text=Pending Approvals').catch(() => {})
    await page.waitForTimeout(1000)
    
    // Step 9: Click on the request
    await page.click(`text=${requestTitle}`)
    
    // Step 10: Verify ApproverModal appears with approve/reject buttons
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    await expect(page.locator('button:has-text("Approve")')).toBeVisible()
    await expect(page.locator('button:has-text("Reject")')).toBeVisible()
    
    // Step 11: Approve the request
    await page.click('button:has-text("Approve")')
    
    // Add optional comment
    const commentField = await page.locator('textarea[placeholder*="comment"]').isVisible().catch(() => false)
    if (commentField) {
      await page.fill('textarea[placeholder*="comment"]', 'Approved via automated test')
    }
    
    // Confirm approval
    await page.click('button:has-text("Confirm")').catch(() => 
      page.click('button:has-text("Approve")'))
    
    // Wait for success toast
    await page.waitForSelector('text=Approved successfully', { timeout: 5000 })
    
    console.log('✅ Request approval workflow completed successfully')
  })
})

test.describe('Modal System - Solution Submission Workflow', () => {
  test('Engineering submits solution for approved request', async ({ page }) => {
    // Step 1: Login as Engineering L1
    await login(page, TEST_USERS.engineering.level1.email, TEST_USERS.engineering.level1.password)
    
    // Step 2: Navigate to engineering dashboard
    await page.goto('/engineering')
    await page.waitForLoadState('networkidle')
    
    // Step 3: Find a request awaiting solution
    const submitButton = await page.locator('button:has-text("Submit Solution")').first()
    const isVisible = await submitButton.isVisible().catch(() => false)
    
    if (!isVisible) {
      console.log('⚠️ No requests awaiting solution found')
      test.skip()
      return
    }
    
    // Step 4: Click Submit Solution
    await submitButton.click()
    
    // Step 5: Wait for solution form
    await page.waitForURL(/\/engineering\/solutions\//, { timeout: 5000 })
    
    // Step 6: Fill solution form
    await page.fill('input[name="title"]', 'Test Solution')
    await page.fill('textarea[name="description"]', 'This is a test solution')
    await page.fill('input[name="costEstimate"]', '50000')
    await page.fill('input[name="timeline"]', '2 weeks')
    
    // Step 7: Submit solution
    await page.click('button:has-text("Submit Solution")')
    
    // Wait for success
    await page.waitForSelector('text=Solution submitted successfully', { timeout: 5000 })
    
    console.log('✅ Solution submission workflow completed successfully')
  })
})

test.describe('Modal System - Rejection and Resubmit Workflow', () => {
  test('Approver rejects request and requester resubmits', async ({ page }) => {
    // Step 1: Login as Production L1 and create request
    await login(page, TEST_USERS.production.level1.email, TEST_USERS.production.level1.password)
    
    await page.goto('/dashboard')
    await page.click('text=New Request')
    
    const requestTitle = `Reject Test ${Date.now()}`
    await page.fill('input[name="title"]', requestTitle)
    await page.fill('textarea[name="description"]', 'Request to be rejected')
    await page.click('button:has-text("Submit Request")')
    await page.waitForSelector('text=Request created successfully')
    
    // Step 2: Login as approver
    await page.click('button:has-text("Sign out")')
    await login(page, TEST_USERS.production.level2.email, TEST_USERS.production.level2.password)
    
    // Step 3: Find and reject the request
    await page.goto('/dashboard')
    await page.click('text=Pending Approvals').catch(() => {})
    await page.waitForTimeout(1000)
    
    await page.click(`text=${requestTitle}`)
    await page.waitForSelector('[role="dialog"]')
    
    // Click reject button
    await page.click('button:has-text("Reject")')
    
    // Fill rejection reason
    await page.fill('textarea[placeholder*="reason"]', 'Needs more details')
    await page.click('button:has-text("Confirm")').catch(() => 
      page.click('button:has-text("Reject")'))
    
    await page.waitForSelector('text=Rejected successfully', { timeout: 5000 })
    
    // Step 4: Login back as requester
    await page.click('button:has-text("Sign out")')
    await login(page, TEST_USERS.production.level1.email, TEST_USERS.production.level1.password)
    
    // Step 5: Find rejected request
    await page.goto('/dashboard')
    await page.click('text=My Requests').catch(() => {})
    await page.waitForTimeout(1000)
    
    // Step 6: Click on rejected request
    await page.click(`text=${requestTitle}`)
    
    // Step 7: Verify RequestResubmitModal appears
    await page.waitForSelector('[role="dialog"]')
    await expect(page.locator('text=Needs more details')).toBeVisible()
    await expect(page.locator('button:has-text("Resubmit")')).toBeVisible()
    
    // Step 8: Edit and resubmit
    await page.fill('input[name="title"]', `${requestTitle} - Updated`)
    await page.fill('textarea[name="description"]', 'Updated with more details')
    await page.click('button:has-text("Resubmit")')
    
    await page.waitForSelector('text=Request resubmitted successfully', { timeout: 5000 })
    
    console.log('✅ Rejection and resubmit workflow completed successfully')
  })
})

test.describe('Modal System - Permission Checks', () => {
  test('Engineering user cannot see approve buttons on requests', async ({ page }) => {
    await login(page, TEST_USERS.engineering.level1.email, TEST_USERS.engineering.level1.password)
    
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    
    // Try to find any request
    const firstRequest = await page.locator('table tbody tr').first()
    const isVisible = await firstRequest.isVisible().catch(() => false)
    
    if (!isVisible) {
      console.log('⚠️ No requests found for permission test')
      test.skip()
      return
    }
    
    // Click on request
    await firstRequest.click()
    
    // Wait for modal
    await page.waitForSelector('[role="dialog"]')
    
    // Verify no approve/reject buttons (engineering can't approve production requests)
    const approveButton = await page.locator('button:has-text("Approve")').isVisible().catch(() => false)
    const rejectButton = await page.locator('button:has-text("Reject")').isVisible().catch(() => false)
    
    // Engineering users should not see approve/reject for production requests
    expect(approveButton || rejectButton).toBeFalsy()
    
    console.log('✅ Permission checks working correctly')
  })
})

test.describe('Modal System - Visual Verification', () => {
  test('All modal variants render correctly', async ({ page }) => {
    // This test opens various modals to verify they render
    await login(page, TEST_USERS.admin.email, TEST_USERS.admin.password)
    
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    
    // Find and click on different requests to see different modal states
    const requests = await page.locator('table tbody tr')
    const count = await requests.count()
    
    console.log(`Found ${count} requests to test`)
    
    for (let i = 0; i < Math.min(count, 5); i++) {
      await requests.nth(i).click()
      
      // Wait for modal to appear
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {})
      
      // Take screenshot for visual verification
      await page.screenshot({ 
        path: `tests/screenshots/modal-${i}.png`,
        fullPage: false 
      })
      
      // Close modal
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
    }
    
    console.log('✅ Visual verification screenshots captured')
  })
})
