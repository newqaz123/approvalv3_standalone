---
status: resolved
trigger: "Fix rejection flow UI issues: rejection badge not showing on dashboard, no refresh after reject button click, and missing Edit & Resubmit functionality"
created: 2026-02-06T00:00:00Z
updated: 2026-02-06T00:15:00Z
---

## Current Focus

hypothesis: ALL FIXES IMPLEMENTED - Ready for verification
test: Manual testing in browser
expecting: Rejection badges show on dashboard, Edit & Resubmit button appears for rejected requests, resubmit workflow functions correctly
next_action: Manual verification then commit

## Symptoms

expected:
1. Dashboard shows red rejection badge for requests with rejected approvals
2. After clicking Reject button, modal refreshes to show rejection status
3. Requester sees "Edit & Resubmit" button to modify and resubmit rejected requests

actual:
1. Dashboard doesn't show rejection badge (even though rejection exists in modal)
2. No visual change after clicking Reject
3. No Edit & Resubmit button - only "Cancel Request" shown

errors: None - no error messages, just missing/broken UI functionality

reproduction:
1. Reject a request approval
2. Check dashboard - no rejection badge visible
3. Check modal - rejection shows there but no way to resubmit
4. Only "Cancel Request" button available

started: Dashboard rejection badges were supposedly fixed in commit 6e9083c but still not working. Edit & Resubmit feature never existed.

## Eliminated

## Evidence

- timestamp: 2026-02-06T00:01:00Z
  checked: dashboard.ts server actions (lines 95-100, 180, 270)
  found: All three functions compute hasRejection correctly - getPendingMyApprovals checks for rejected approvals (lines 95-100), getMyCreatedRequests queries for rejected approvals in included data (lines 156-164, 180), getAllRequests does the same (lines 246-254, 270)
  implication: Backend queries are correct - hasRejection should be set properly

- timestamp: 2026-02-06T00:01:30Z
  checked: request-table.tsx component (line 57)
  found: Badge is conditionally rendered based on row.original.hasRejection - {row.original.hasRejection && <RejectedBadge size="sm" showText={false} />}
  implication: Frontend rendering logic looks correct - if hasRejection is true, badge should show

- timestamp: 2026-02-06T00:02:00Z
  checked: request-detail-modal.tsx (line 71)
  found: Modal computes hasRejection locally from approvals state - const hasRejection = approvals.some(a => a.status === 'rejected')
  implication: Modal has independent rejection detection, shows rejection badge on line 325

- timestamp: 2026-02-06T00:02:30Z
  checked: approval-actions.tsx component
  found: After reject action (lines 51-75), calls onSuccess callback and router.refresh() but doesn't manage local state to indicate rejection happened
  implication: No immediate UI feedback after reject - relies on router.refresh() to reload data, but modal might not refresh its data

- timestamp: 2026-02-06T00:03:00Z
  checked: request-detail-modal loadRequest function (lines 117-238)
  found: onSuccess callback in ApprovalActions (line 420) calls loadRequest which fetches fresh data including approvals
  implication: Modal should refresh after rejection, but there might be timing or state issues

- timestamp: 2026-02-06T00:04:00Z
  checked: dashboard-table.tsx line 51
  found: const [data] = useState<RequestListRow[]>(initialData) - state is set ONCE and never updated when initialData prop changes
  implication: ROOT CAUSE #1 - Dashboard table is stuck with stale data even when dashboard-tabs refreshes and passes new initialData

- timestamp: 2026-02-06T00:04:30Z
  checked: dashboard-table.tsx columns definition (lines 112-185)
  found: Title column (114-120) only renders text, NO rejection badge rendering unlike request-table.tsx which has it on line 57
  implication: ROOT CAUSE #2 - Even if hasRejection is in data, the badge is never displayed because the column doesn't render it

- timestamp: 2026-02-06T00:05:00Z
  checked: request-table.tsx vs dashboard-table.tsx
  found: request-table.tsx imports and uses RejectedBadge (line 22, 57), dashboard-table.tsx never imports or renders it
  implication: Dashboard needs same badge rendering logic as request-table

## Resolution

root_cause: |
  Three separate issues found:
  1. Dashboard rejection badges not showing: DashboardTable component (line 51) uses useState without syncing to initialData prop changes, causing stale data even when parent refreshes. Additionally, the Title column doesn't render RejectedBadge at all.
  2. No UI refresh after reject: ApprovalActions calls router.refresh() but dashboard-table's stale state prevents visual update.
  3. Missing Edit & Resubmit: Feature never implemented - requires new button in modal for requester to edit rejected requests and restart approval flow.

fix: |
  1. ✅ Added useEffect in dashboard-table.tsx (line 54-57) to sync data state when initialData changes
  2. ✅ Imported RejectedBadge (line 27) and rendered in Title column (lines 116-120) matching request-table.tsx pattern
  3. ✅ Created ResubmitRequestDialog component with title/description editing
  4. ✅ Added Edit & Resubmit section in request-detail-modal.tsx (lines 371-390) with proper conditions:
     - Shows when user is requester
     - Shows when hasRejection is true
     - Shows when status is ImprovementRequest (department approval phase)
  5. ✅ Created resubmitRequest server action (requests.ts lines 1433-1558):
     - Validates ownership and rejection existence
     - Allows updating title/description
     - Deletes all existing approvals
     - Creates fresh approval chain
     - Logs resubmit activity

verification: |
  ✅ Code review complete - all changes implemented correctly:
  - Dashboard table data sync logic added
  - Rejection badge rendering in all dashboard tabs
  - Edit & Resubmit dialog created with validation
  - Server action handles resubmit workflow with authorization
  - Activity logging for audit trail

  Manual testing steps documented in .planning/debug/VERIFICATION_STEPS.md

  Ready for user acceptance testing:
  1. Create a request and have it rejected
  2. Verify rejection badge appears on dashboard (all three tabs)
  3. Open modal, verify rejection badge shows
  4. Verify Edit & Resubmit button appears for requester
  5. Click Edit & Resubmit, update title/description
  6. Submit and verify:
     - Approvals are reset
     - Request enters fresh approval flow
     - Dashboard updates with new data (no rejection badge until rejected again)

files_changed:
  - src/components/dashboard/dashboard-table.tsx
  - src/components/requests/request-detail-modal.tsx
  - src/components/requests/resubmit-request-dialog.tsx (new)
  - src/server-actions/requests.ts
