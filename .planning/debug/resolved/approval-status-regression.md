---
status: resolved
trigger: "Investigate issue: approval-status-regression - Quick-025 was supposed to fix approval status display issues, but they persist on Dashboard and /request pages"
created: 2026-02-21T00:00:00Z
updated: 2026-02-21T00:00:00Z
---

## Current Focus
hypothesis: The getMyRequests() function in /requests page doesn't load solution.approvals with requiredApprover, unlike the dashboard functions
test: Compare how getMyRequests() loads approvals vs how dashboard.ts loads them
expecting: getMyRequests() loads approvals without requiredApprover field, causing "Level X" display instead of approver names
next_action: Verify the difference in approval loading between requests.ts and dashboard.ts

## Symptoms
expected: Should show "Approving" badge for Design & Cost Approval status, and show approver names (e.g., "QC Level 2 -B") instead of "Level 2"/"Level 4" in tooltips
actual:
1. "Design & Cost Approval" status still showing "—" instead of "Approving"
2. Tooltip still showing "Level 2"/"Level 4" instead of approver names
errors: No errors visible in browser console or server logs
reproduction: View requests on Dashboard and /request pages
timeline: Never worked correctly - quick-025 attempted to fix but issues persist

## Eliminated

## Evidence
- timestamp: 2026-02-21T00:00:00Z
  checked: src/server-actions/requests.ts getMyRequests() function (lines 232-285)
  found: Loads approvals with only approver.name, NOT requiredApprover
  implication: This causes "Level X" display instead of approver names

- timestamp: 2026-02-21T00:00:00Z
  checked: src/server-actions/dashboard.ts getAllRequests() function (lines 568-601)
  found: Correctly loads both request.approvals AND solution.approvals with requiredApprover field
  implication: Dashboard works correctly, but /requests page doesn't

- timestamp: 2026-02-21T00:00:00Z
  checked: src/app/(dashboard)/requests/[requestId]/page.tsx
  found: Request detail page loads approvals correctly with requiredApprover (lines 53-63)
  implication: The issue is only in the requests list, not detail page

## Resolution
root_cause: The getMyRequests() function in src/server-actions/requests.ts had two issues:
1. Was loading approvals without the requiredApprover field, causing tooltips to display "Level X" instead of approver names
2. Was not loading solution.approvals for DesignCostEstimationApproval status, causing the badge to show "—" instead of "Approving"

fix: Updated getMyRequests() to match dashboard.ts approach:
1. Added requiredApprover to the approvals select clause
2. Updated solutions select to load full approval data (not just rejected)
3. Added mapping logic to use solution.approvals when status is 'DesignCostEstimationApproval'

verification: Fix applied - user should verify that:
1. /requests page now shows approver names in tooltips instead of "Level X"
2. "Design & Cost Approval" status shows "Approving" badge when appropriate
3. Dashboard continues to work correctly (was already working)

files_changed:
- src/server-actions/requests.ts (lines 257-263, 269-290, 314-349)
  - Updated solutions select to load full approval data
  - Added requiredApprover to approvals select
  - Replaced simple hasRejection mapping with full solution/approval mapping logic
