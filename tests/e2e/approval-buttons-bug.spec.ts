import { test, expect } from '@playwright/test'

/**
 * Test to reproduce bug: PD1 level 1 approver not seeing approve/reject buttons
 * in solution approval modal after new UI/UX integration
 */

const TEST_USERS = {
  production: {
    pd1_level4: { email: 'pd1@example.com', password: 'changeme', name: 'Production L4' },
    pd2_level1: { email: 'pd21@example.com', password: 'changeme', name: 'Production L1' },
  },
}

async function login(page: any, email: string, password: string) {
  await page.goto('/')

  // Check if already logged in
  const isLoggedIn = await page.locator('text=Dashboard').isVisible().catch(() => false)
  if (isLoggedIn) {
    await page.click('button:has-text("Sign out")').catch(() => {})
  }

  await page.goto('/login')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')

  // Wait for redirect to dashboard
  await page.waitForURL(/\/(dashboard|engineering)/, { timeout: 10000 })
}

test.describe('Bug Reproduction - Approval Buttons Not Showing', () => {
  test('PD1 (Level 4) should see approve/reject buttons in solution approval modal', async ({ page }) => {
    console.log('🔍 Testing: PD1 approver should see approve/reject buttons')

    // Step 1: Login as pd1@example.com
    await login(page, TEST_USERS.production.pd1_level4.email, TEST_USERS.production.pd1_level4.password)
    console.log('✅ Logged in as pd1@example.com')

    // Step 2: Navigate to dashboard
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    console.log('✅ On dashboard')

    // Step 3: Look for solution approval requests
    console.log('🔍 Looking for solution approval requests...')

    // Check if there's a "Pending Approvals" or similar tab
    const pendingTab = await page.locator('text=Pending Approvals').isVisible().catch(() => false)
    if (pendingTab) {
      await page.click('text=Pending Approvals')
      await page.waitForTimeout(1000)
      console.log('✅ Clicked Pending Approvals tab')
    }

    // Step 4: Try to find any request/clickable element
    const requests = await page.locator('table tbody tr, [data-testid="request-item"], .request-item')
    const count = await requests.count()

    console.log(`Found ${count} request items`)

    if (count === 0) {
      console.log('⚠️ No requests found. Checking page content...')
      const pageContent = await page.content()
      console.log('Page contains:', pageContent.substring(0, 500))
      test.skip()
      return
    }

    // Step 5: Click on first request
    await requests.first().click()
    console.log('✅ Clicked on first request')

    // Step 6: Wait for modal to appear
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    console.log('✅ Modal appeared')

    // Step 7: Check for approve/reject buttons
    const approveButton = page.locator('button:has-text("Approve")')
    const rejectButton = page.locator('button:has-text("Reject")')

    const approveVisible = await approveButton.isVisible().catch(() => false)
    const rejectVisible = await rejectButton.isVisible().catch(() => false)

    console.log(`🔍 Approve button visible: ${approveVisible}`)
    console.log(`🔍 Reject button visible: ${rejectVisible}`)

    // Take screenshot for debugging
    await page.screenshot({
      path: 'tests/screenshots/bug-approval-buttons-not-showing.png',
      fullPage: false
    })

    // Check console for errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('❌ Browser console error:', msg.text())
      }
    })

    // THIS IS THE BUG: Buttons should be visible but are not
    if (!approveVisible || !rejectVisible) {
      console.log('❌ BUG REPRODUCED: Approve/Reject buttons not visible!')

      // Debug: Check what's actually in the modal
      const modalContent = await page.locator('[role="dialog"]').textContent()
      console.log('Modal content:', modalContent?.substring(0, 200))

      // Check if buttons exist in DOM but are hidden
      const approveInDOM = await page.locator('button:has-text("Approve")').count()
      const rejectInDOM = await page.locator('button:has-text("Reject")').count()

      console.log(`Approve button in DOM: ${approveInDOM}`)
      console.log(`Reject button in DOM: ${rejectInDOM}`)

      // Check CSS properties if in DOM
      if (approveInDOM > 0) {
        const approveElement = page.locator('button:has-text("Approve")').first()
        const display = await approveElement.evaluate((el: any) => {
          return window.getComputedStyle(el).display
        })
        const visibility = await approveElement.evaluate((el: any) => {
          return window.getComputedStyle(el).visibility
        })
        console.log(`Approve button CSS - display: ${display}, visibility: ${visibility}`)
      }
    }

    // This will fail, confirming the bug
    expect(approveVisible, 'Approve button should be visible for PD1 approver').toBe(true)
    expect(rejectVisible, 'Reject button should be visible for PD1 approver').toBe(true)

    console.log('✅ Test passed: Buttons are visible')
  })

  test('Check all requests to see if any show approve buttons', async ({ page }) => {
    console.log('🔍 Testing: Check all requests for approval button visibility')

    await login(page, TEST_USERS.production.pd1_level4.email, TEST_USERS.production.pd1_level4.password)
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    const requests = await page.locator('table tbody tr, [data-testid="request-item"], .request-item')
    const count = await requests.count()

    console.log(`Found ${count} requests to check`)

    for (let i = 0; i < Math.min(count, 5); i++) {
      console.log(`\n--- Checking request ${i + 1} ---`)

      await requests.nth(i).click()

      // Wait for modal
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {})

      // Check for buttons
      const approveVisible = await page.locator('button:has-text("Approve")').isVisible().catch(() => false)
      const rejectVisible = await page.locator('button:has-text("Reject")').isVisible().catch(() => false)

      console.log(`Request ${i + 1}: Approve=${approveVisible}, Reject=${rejectVisible}`)

      // Get modal title/type
      const modalTitle = await page.locator('[role="dialog"] h2, [role="dialog"] h3').first().textContent()
      console.log(`Modal title: ${modalTitle}`)

      // Close modal
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
    }

    console.log('\n✅ Checked all requests')
  })
})
