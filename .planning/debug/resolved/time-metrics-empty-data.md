---
status: resolved
trigger: "Investigate why the Time Metrics Chart shows 'No time data available' instead of displaying approval time statistics"
created: 2026-02-20T00:00:00.000Z
updated: 2026-02-21T00:00:01.000Z
---

## Resolution
root_cause: The `fetchTimeMetrics` function in `src/server-actions/analytics.ts` uses `differenceInDays()` to calculate approval times. This function only counts complete calendar days (rounds down), causing it to return 0 for any approval that completes in less than 24 hours or on the same calendar day. Since the TimeMetricsChart component displays "No time data available" when ALL metrics are 0, valid approval times that take less than a full day result in an empty state message.

**Specific Issue:**
- Line 241 in analytics.ts: `const totalTime = differenceInDays(lastApproval, request.createdAt)`
- Line 249 in analytics.ts: `const levelTime = differenceInDays(approval.approvedAt, prevDate)`
- These return 0 for any time < 24 hours
- Actual sample approval took ~17.5 hours (0.73 days) but was calculated as 0 days

fix: Replace `differenceInDays()` with `differenceInMinutes() / 1440` to calculate fractional days instead of whole days.

**Changes made to src/server-actions/analytics.ts:**
- Line 5: Changed import from `differenceInDays` to `differenceInMinutes`
- Line 241: Changed `differenceInDays(lastApproval, request.createdAt)` to `differenceInMinutes(lastApproval, request.createdAt) / 1440`
- Line 249: Changed `differenceInDays(approval.approvedAt, prevDate)` to `differenceInMinutes(approval.approvedAt, prevDate) / 1440`
- Line 339: Changed `differenceInDays(lastApproval, req.createdAt)` to `differenceInMinutes(lastApproval, req.createdAt) / 1440`

verification: After applying the fix:
- Before: All metrics = 0 days, TimeMetricsChart showed "No time data available"
- After: avgPerRequest = 0.73 days, medianPerRequest = 0.73 days, minPerRequest = 0.73 days, maxPerRequest = 0.73 days
- Empty data check: PASS (will show chart with actual data)
- Test script confirms: TimeMetricsChart will now display values instead of empty message

files_changed:
- src/server-actions/analytics.ts (lines 5, 241, 249, 339)

## Symptoms
expected: Time Metrics Chart showing Average, Median, Minimum, Maximum approval times in days
actual: "No time data available" message displayed
errors: No error messages reported - incorrect data display
reproduction: View Analytics Dashboard, Time Metrics Chart section shows empty message instead of metrics
started: Phase 12 UAT Test 4 failure

## Eliminated

## Evidence
- timestamp: 2026-02-20T00:00:00.000Z
  checked: Code analysis of time-metrics-chart.tsx
  found: Component displays "No time data available" when ALL metrics are 0 (lines 25-30)
  implication: If fetchTimeMetrics returns all zeros, the empty state triggers

- timestamp: 2026-02-20T00:00:00.000Z
  checked: Code analysis of fetchTimeMetrics in analytics.ts (lines 206-290)
  found: Uses `differenceInDays(lastApproval, request.createdAt)` to calculate approval time
  implication: If this returns 0 for valid approvals, all metrics will be 0

- timestamp: 2026-02-20T00:00:00.000Z
  checked: Database query for completed requests with approvals in last 30 days
  found: 1 completed request exists with 2 approvals
  implication: Data exists in database, so it's not an empty data issue

- timestamp: 2026-02-20T00:00:00.000Z
  checked: Sample request approval times
  found:
    - Request created: Feb 06 15:35:56
    - First approval: Feb 06 15:35:57 (same day, 1 second later)
    - Last approval: Feb 07 09:03:13 (next day)
    - Total time calculated: 0 days
  implication: ROOT CAUSE: `differenceInDays` only counts complete calendar days, not fractional days

- timestamp: 2026-02-20T00:00:00.000Z
  checked: date-fns differenceInDays behavior
  found: differenceInDays returns the number of full days between two dates (rounds down)
  implication: Feb 06 to Feb 07 = 0 or 1 depending on exact times, but any same-day approval = 0

- timestamp: 2026-02-21T00:00:00.000Z
  checked: Precise approval time calculations with multiple methods
  found:
    - Sample request: Created Feb 06 08:35:56, Last approval Feb 07 02:03:13
    - Using differenceInDays: 0 days (WRONG)
    - Using differenceInHours / 24: 0.71 days (CORRECT)
    - Using differenceInMinutes / 1440: 0.73 days (MOST PRECISE)
  implication: The fix is to use fractional day calculation instead of whole days
