# Testing Patterns

**Analysis Date:** 2026-03-06

## Test Framework

**Runner:**
- **Playwright** v1.58.2 - E2E testing framework
- **Config:** `playwright.config.ts`
- **Type:** End-to-end (E2E) testing only

**Assertion Library:**
- Built-in Playwright assertions: `expect(page.locator()).toBeVisible()`

**Run Commands:**
```bash
npm run test:e2e              # Run all E2E tests
npm run test:e2e:ui           # Run with Playwright UI
npm run test:e2e:headed       # Run in headed mode (show browser)
npm run test:e2e:debug        # Run in debug mode
npm run test:phase7           # Run phase 7 specific tests
npm run test:phase7:headed    # Run phase 7 tests headed
npm run test:phase7:report    # Run phase 7 tests with HTML report
```

**No Unit Testing Framework:**
- **No Jest** detected
- **No Vitest** detected
- **No Mocha** detected
- **Testing limited to E2E with Playwright**

## Test File Organization

**Location:**
- **Pattern:** Separate test directory
- **Path:** `tests/e2e/`
- **Not co-located** with source code

**Naming:**
- **Pattern:** kebab-case with `.spec.ts` suffix
- **Example:** `modal-system.spec.ts`
- **Descriptive names** matching feature being tested

**Structure:**
```
tests/
├── e2e/
│   └── modal-system.spec.ts    # Modal system E2E tests
└── integration/                 # Empty directory (no integration tests)
```

**Test Organization by Feature:**
- Tests organized in `describe()` blocks by feature
- `test.describe('Modal System - Request Approval Workflow')` pattern
- Each workflow scenario in separate `test()` block

## Test Structure

**Suite Organization:**
```typescript
test.describe('Feature Name', () => {
  test('does something specific', async ({ page }) => {
    // Setup
    await login(page, email, password)

    // Actions
    await page.click('button')
    await page.fill('input', 'value')

    // Assertions
    await expect(page.locator('text')).toBeVisible()
  })
})
```

**Patterns:**
- **Setup:** Helper functions for common operations (login, navigation)
- **Teardown:** Not explicitly used - Playwright handles cleanup
- **Assertion:** Playwright's `expect()` with matchers
- **Page Object Model:** Not used - direct page manipulation

**Helper Functions:**
```typescript
// Login helper at top of test file
async function login(page: any, email: string, password: string) {
  await page.goto('/')
  await page.goto('/login')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|engineering)/, { timeout: 10000 })
}
```

**Test Data:**
- **Hardcoded test users** in test file:
  ```typescript
  const TEST_USERS = {
    production: {
      level1: { email: 'pd1@example.com', password: 'changeme', name: 'Production L1' },
      level2: { email: 'pd2@example.com', password: 'changeme', name: 'Production L2' }
    },
    engineering: { ... },
    admin: { ... }
  }
  ```
- **No fixture files** detected
- **Test data documented** in `test_users.md`

## Mocking

**Framework:** None detected

**Patterns:**
- **No mocking** in E2E tests - tests against real application
- **Real database** operations (not mocked)
- **Real authentication** flow (test users login with real credentials)
- **No API mocking** - tests hit actual API routes

**What to Mock:**
- **Not applicable** for E2E tests - everything is real

**What NOT to Mock:**
- **Nothing mocked** in current E2E approach
- Tests verify **actual system behavior** end-to-end

## Fixtures and Factories

**Test Data:**
- **No factory pattern** detected
- **Hardcoded test data** in test files
- **Test user credentials** stored in code and documented in `test_users.md`

**Location:**
- Test data inline in test files
- No separate fixture directory
- No data generation utilities

**Database State:**
- Tests assume **pre-existing test users** in database
- No database seeding in tests
- Test users must be manually created or seeded via Prisma seed script

## Coverage

**Requirements:** **None enforced**

**View Coverage:**
- **No coverage reports** configured
- **No coverage tools** detected (no nyc, c8, istanbul)
- **No coverage percentage** targets

**E2E Coverage:**
- Limited to **user-facing workflows**
- Critical paths tested:
  - Request creation
  - Approval workflow
  - Solution submission
  - Rejection and resubmit
  - Permission checks
  - Visual verification

## Test Types

**Unit Tests:**
- **Not used** - No unit test framework configured
- **No testing** of individual functions/components in isolation

**Integration Tests:**
- **Empty directory** at `tests/integration/`
- **No integration tests** detected
- This could be used for API route testing without full browser automation

**E2E Tests:**
- **Framework:** Playwright
- **Scope:** Full user workflows through browser
- **What's tested:**
  - Complete request approval workflow
  - Solution submission workflow
  - Rejection and resubmit workflow
  - Permission-based UI visibility
  - Visual rendering of modal variants

**Workflow Testing Pattern:**
```typescript
test('Production L1 creates request and L2 approves it', async ({ page }) => {
  // Step 1: Login as requester
  await login(page, 'user1@example.com', 'password')

  // Step 2: Create request
  await page.click('text=New Request')
  await page.fill('input[name="title"]', 'Test Request')
  await page.click('button:has-text("Submit")')

  // Step 3: Verify success
  await expect(page.locator('text=Request created successfully')).toBeVisible()

  // Step 4: Logout and login as approver
  await page.click('button:has-text("Sign out")')
  await login(page, 'approver@example.com', 'password')

  // Step 5: Approve request
  await page.click(`text=Test Request`)
  await page.click('button:has-text("Approve")')

  // Step 6: Verify approval
  await expect(page.locator('text=Approved successfully')).toBeVisible()
})
```

## Common Patterns

**Async Testing:**
- **All tests are async** - Playwright requires async/await
- **Pattern:** `async ({ page }) => { ... }`
- **Await all page interactions:** `await page.click()`, `await page.fill()`
- **Await assertions:** `await expect(...).toBeVisible()`

**Error Testing:**
- **Test error scenarios** in workflows:
  ```typescript
  test('Approver rejects request and requester resubmits', async ({ page }) => {
    // ... create request
    await page.click('button:has-text("Reject")')
    await page.fill('textarea[placeholder*="reason"]', 'Needs more details')
    await page.click('button:has-text("Confirm")')

    // Verify rejection visible
    await expect(page.locator('text=Needs more details')).toBeVisible()
  })
  ```

**Permission Testing:**
- **Verify UI elements** show/hide based on user role:
  ```typescript
  const approveButton = await page.locator('button:has-text("Approve")').isVisible().catch(() => false)
  expect(approveButton).toBeFalsy()
  ```

**Conditional Test Skipping:**
- **Skip tests** if prerequisites not met:
  ```typescript
  const isVisible = await submitButton.isVisible().catch(() => false)
  if (!isVisible) {
    console.log('⚠️ No requests awaiting solution found')
    test.skip()
    return
  }
  ```

**Visual Testing:**
- **Screenshots** for visual verification:
  ```typescript
  await page.screenshot({
    path: `tests/screenshots/modal-${i}.png`,
    fullPage: false
  })
  ```

**Configuration:**
- **Single worker** to avoid auth conflicts: `workers: 1`
- **Serial execution** for tests sharing state: `fullyParallel: false`
- **Automatic web server** startup before tests
- **Screenshots on failure:** `screenshot: 'only-on-failure'`
- **Trace on retry:** `trace: 'on-first-retry'`

---

*Testing analysis: 2026-03-06*
