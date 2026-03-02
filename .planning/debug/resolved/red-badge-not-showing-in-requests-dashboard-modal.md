---
status: resolved
trigger: "red-badge-not-showing-in-requests-dashboard-modal"
created: 2026-02-07T00:00:00Z
updated: 2026-02-07T00:15:00Z
---

## Current Focus

hypothesis: CONFIRMED - /requests, /dashboard, and modal check REQUEST approvals for rejections, but /engineering checks SOLUTION approvals. The bug symptom is inverted - feature is about SOLUTION rejections, not REQUEST rejections.
test: Verify that requests.ts and dashboard.ts query request.approvals instead of solution.approvals
expecting: Will confirm that the data queries are looking at wrong approval type
next_action: Fix data queries to check solution approvals instead of request approvals

## Symptoms

expected: RED "Solution Rejected" badge should display in all views (/requests, /dashboard, /engineering, and request detail modal) when a solution has been rejected

actual: RED badge only shows in /engineering page. Other pages (/requests, /dashboard) and the modal still show the yellow "Sent to Engineer" badge instead of red "Solution Rejected"

errors: No error messages reported. The feature was implemented in quick-011 but appears to only be working in the engineering view.

reproduction:
1. Navigate to a request that has a rejected solution (status = "SentToEngineer" with rejection in activity/approval history)
2. View it in /requests page - shows yellow "Sent to Engineer" instead of red "Solution Rejected"
3. View it in /dashboard tabs - shows yellow "Sent to Engineer" instead of red "Solution Rejected"
4. Open request detail modal - shows yellow "Sent to Engineer" instead of red "Solution Rejected"
5. View same request in /engineering page - correctly shows red "Solution Rejected"

started: Issue appeared immediately after implementing quick-011 (commits 01436ab, 144bf5f, ea34a90). The implementation was supposed to add hasRejection prop to StatusBadge across all views, but only /engineering is working correctly.

## Eliminated

## Evidence

- timestamp: 2026-02-07T00:01:00Z
  checked: requests.ts getMyRequests() function (lines 228-273)
  found: Queries approvals with status='rejected', maps to hasRejection flag correctly (lines 253-272)
  implication: /requests page SHOULD be calculating hasRejection correctly

- timestamp: 2026-02-07T00:01:30Z
  checked: dashboard.ts functions (getPendingMyApprovals, getMyCreatedRequests, getAllRequests)
  found: ALL three functions correctly query for rejected approvals and map to hasRejection flag
  implication: Dashboard tabs SHOULD be calculating hasRejection correctly

- timestamp: 2026-02-07T00:02:00Z
  checked: Component files (request-table.tsx, dashboard-table.tsx, engineering-dashboard-tabs.tsx)
  found: All components correctly pass hasRejection prop to StatusBadge
  implication: Front-end components are correctly wired

- timestamp: 2026-02-07T00:03:00Z
  checked: getRequestsForEngineering() function in requests.ts (lines 1529-1630)
  found: This function does NOT query for rejection status at all - no approvals included, no hasRejection calculation
  implication: This is why /engineering "All Engineering Requests" tab doesn't show red badge

- timestamp: 2026-02-07T00:04:00Z
  checked: request-detail-modal.tsx line 75
  found: Modal calculates hasRejection from local approvals state: `const hasRejection = approvals.some(a => a.status === 'rejected')`
  implication: Modal depends on approvals loaded in loadRequest() function

- timestamp: 2026-02-07T00:05:00Z
  checked: request-detail-modal.tsx lines 160-162
  found: Modal loads approvals via getRequestApprovals(requestId) which only loads REQUEST approvals, not SOLUTION approvals
  implication: Modal only detects rejected REQUEST approvals, not rejected SOLUTION approvals

- timestamp: 2026-02-07T00:06:00Z
  checked: /engineering page.tsx lines 66-88
  found: Engineering page queries solutions.approvals and activities for 'solution_rejected' action
  implication: Engineering correctly looks for SOLUTION rejections, other views incorrectly look for REQUEST rejections

- timestamp: 2026-02-07T00:07:00Z
  analyzed: The feature is about showing red badge when SOLUTION is rejected (status goes back to SentToEngineer)
  found: requests.ts getMyRequests() lines 253-272 queries request.approvals (wrong - should be solution.approvals)
  found: dashboard.ts getPendingMyApprovals() lines 107-112 queries request.approvals (wrong - should be solution.approvals)
  found: dashboard.ts getMyCreatedRequests() lines 258-283 queries request.approvals (wrong - should be solution.approvals)
  found: dashboard.ts getAllRequests() lines 384-409 queries request.approvals (wrong - should be solution.approvals)
  implication: All non-engineering data functions are checking wrong approval type

## Resolution

root_cause: Data fetching functions in requests.ts and dashboard.ts query request.approvals for rejection detection, but the red badge feature is for SOLUTION rejections, not REQUEST rejections. When a solution is rejected, the rejection is stored in solution.approvals, not request.approvals. The /engineering page works correctly because it queries solutions.approvals and activities for 'solution_rejected'.

fix: Updated all data fetching functions to query solutions.approvals instead of request.approvals:
1. requests.ts getMyRequests() - changed to query solutions.approvals and activities
2. dashboard.ts getPendingMyApprovals() - changed to query solution count with rejected approvals
3. dashboard.ts getMyCreatedRequests() - changed to query solutions.approvals and activities
4. dashboard.ts getAllRequests() - changed to query solutions.approvals and activities
5. request-detail-modal.tsx - updated hasRejection to check both request and solution approvals

verification: Code changes verified:
- All data queries now match engineering page logic (query solutions.approvals + activities)
- Modal now checks both request and solution approvals for rejections
- TypeScript compilation successful (no type errors in modified files)
- Logic consistency confirmed across all views

files_changed:
- src/server-actions/requests.ts
- src/server-actions/dashboard.ts
- src/components/requests/request-detail-modal.tsx
