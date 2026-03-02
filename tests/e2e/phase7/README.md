# Phase 7 E2E Tests - Hierarchy Batch Save

Automated Playwright tests for Phase 7: Configuration & Administration.

## Test Coverage

### Tests 1-4: Hierarchy Batch Save Workflow

| Test | Description | Success Criteria |
|------|-------------|------------------|
| **Test 1** | Hierarchy Batch Save UI | Drag user → "Unsaved Changes" bar appears, no immediate save |
| **Test 2** | Hierarchy Reset | Click Reset → users revert to original positions, bar disappears |
| **Test 3** | Hierarchy Save | Click Save → loading spinner, success toast, changes persist after refresh |
| **Test 4** | Hierarchy Validation | Try to empty a level → error toast, changes rejected |

## Prerequisites

1. Application running on `http://localhost:3001`
2. Playwright installed: `npm install -D @playwright/test`
3. Browsers installed: `npx playwright install`

## Running Tests

### Run all Phase 7 tests:
```bash
npx playwright test tests/e2e/phase7/hierarchy-batch-save.spec.ts
```

### Run in headless mode (CI):
```bash
npx playwright test tests/e2e/phase7/hierarchy-batch-save.spec.ts --project=chromium
```

### Run with visible browser (debugging):
```bash
npx playwright test tests/e2e/phase7/hierarchy-batch-save.spec.ts --headed
```

### Run specific test:
```bash
npx playwright test tests/e2e/phase7/hierarchy-batch-save.spec.ts -g "Test 1"
```

### Run with HTML report:
```bash
npx playwright test tests/e2e/phase7/hierarchy-batch-save.spec.ts --reporter=html
```

## Test Configuration

Edit `testUser.md` to update test credentials:
- Admin: `patawatnew@gmail.com` / `warfuf-batno6-fimQoc`

## Logs & Debugging

Test logs are saved to: `tests/e2e/phase7/logs/test-run-{timestamp}.log`

Each log includes:
- Timestamp of each action
- Verification results (✓ PASS / ✗ FAIL)
- Corrections needed for rollback
- Original hierarchy state for restoration

## Data Safety

⚠️ **Important**: These tests modify hierarchy data!

- Tests capture original state before modifications
- Logs include rollback instructions
- Reset functionality is tested (Test 2)
- Changes persist only after explicit Save (Test 3)

## Troubleshooting

### Test fails: "No user cards found"
- Ensure you're logged in as admin
- Check that hierarchy has users configured
- Verify `/admin/hierarchy` page loads correctly

### Test fails: "Element not found"
- Check if data-testid attributes exist in UI
- Verify selectors match actual DOM structure
- Run with `--headed` flag to see what's happening

### Test fails: "Validation did not reject empty level"
- Some hierarchies may have minimum user requirements
- Check if system allows levels to be emptied
- May need to adjust test for your specific hierarchy structure

## HTML Report

After running tests, view detailed report:
```bash
npx playwright show-report
```

Report includes:
- Screenshots on failure
- Trace viewer for step-by-step debugging
- Console logs
- Network activity
