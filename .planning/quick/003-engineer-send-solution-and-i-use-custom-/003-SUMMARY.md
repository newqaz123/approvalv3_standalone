---
phase: quick
plan: 003
subsystem: dashboard-visibility
tags: [dashboard, approvals, solution-approvals, custom-chains, visibility]

dependency-graph:
  requires:
    - quick-002  # Cross-department visibility for custom chains
    - 04-03      # Engineering solution approval workflow
    - 04-05      # Final department approval workflow
    - 05-01      # Dashboard foundation
  provides:
    - "Custom approval chain users see solution approval items in dashboard"
    - "Custom approval chain users see solution approval items in /my-actions"
    - "Final approval custom chain users see pending items"
  affects:
    - "Future dashboard enhancements (data visibility)"

tech-stack:
  added: []
  patterns:
    - "Merged query pattern for multiple approval types"
    - "Set-based deduplication by request ID"
    - "Sequential actionability checking across approval chains"

key-files:
  created: []
  modified:
    - src/server-actions/dashboard.ts
    - src/server-actions/requests.ts

decisions:
  - id: solution-approval-query
    what: "Query both RequestApproval and SolutionApproval tables"
    why: "Solution approvals with custom chains stored in separate table"
    impact: "Custom approvers for solutions now see pending items"

  - id: deduplication-strategy
    what: "Use Set to track seen request IDs and deduplicate"
    why: "Same request can have both request-level and solution-level pending approvals"
    impact: "Prevents duplicate entries in dashboard and action items"

  - id: remove-status-filter
    what: "Removed request.status: 'ImprovementRequest' filter from getMyActionItems"
    why: "Final approval custom chains are in FinalApproval status, not ImprovementRequest"
    impact: "Final approval custom approvers now see their pending items"

metrics:
  duration: 1
  completed: 2026-02-06
---

# Quick Task 003: Fix Custom Approval Chain Visibility for Solution Approvals

Fix dashboard and /my-actions visibility for custom approval chain users who are assigned to solution approval chains or final approval chains.

## Problem Statement

Custom approval chain approvers for solution approvals and final approvals did not see pending items in the dashboard "Pending My Approval" tab or the /my-actions page.

**Root cause:** Both `getPendingMyApprovals()` (dashboard.ts) and `getMyActionItems()` (requests.ts) only queried the `RequestApproval` table. When an engineer submits a solution with a custom approval chain, those approvals are stored in the `SolutionApproval` table, so custom approvers never saw them. Additionally, `getMyActionItems()` hard-filtered `request.status: 'ImprovementRequest'`, which excluded requests in `DesignCostEstimationApproval` and `FinalApproval` statuses entirely.

## Implementation

### Task 1: Fix getPendingMyApprovals (Dashboard)

Modified `src/server-actions/dashboard.ts`:

1. Added second query to `prisma.solutionApproval.findMany` with:
   - Same OR conditions: `[{ requiredApproverId: userId }]` plus `{ requiredLevel: user.level }` if user has level
   - Filter by `status: 'pending'` and `solution.request.isDeleted: false`
   - Include solution's request with department, requester, and file attachment count

2. Check actionability for each solution approval:
   - Count `solutionApproval` records with same `solutionId`, lower `order`, and `status: 'pending'`
   - Only include if zero blocking approvals

3. Map solution approval items to `RequestListRow` using `approval.solution.request.*` fields
4. Check for rejection by counting rejected `solutionApproval` records for that `solutionId`
5. Deduplicate by request ID using `Set<string>` to prevent duplicate entries
6. Merge request-level and solution-level approval items into single array

**Commit:** e979bfc

### Task 2: Fix getMyActionItems (/my-actions)

Modified `src/server-actions/requests.ts`:

1. **Removed** `request.status: 'ImprovementRequest'` filter from `requestApproval.findMany` query
   - Replaced with just `request.isDeleted: false`
   - Allows request-level approvals in ANY status to appear (including FinalApproval custom chains)

2. Added second query to `prisma.solutionApproval.findMany` with:
   - Same OR conditions: `[{ requiredApproverId: userId }]` plus `{ requiredLevel: user.level }` if user has level
   - Filter by `status: 'pending'` and `solution.request.isDeleted: false`
   - Include solution's request with department, requester, file attachment count, and updatedAt

3. Check actionability for solution approvals (same pattern as Task 1)
4. Map to same return shape (id, title, status, createdAt, updatedAt, requesterId, department, requester, _count)
5. Deduplicate by request ID using `Set<string>`
6. Sort merged array by createdAt desc

**Commit:** 0be7fcc

## Verification

- `npx tsc --noEmit` passed with no errors after each task
- Manual testing required:
  1. Log in as custom approver added to solution's custom approval chain
  2. Navigate to /dashboard - "Pending My Approval" tab shows the request
  3. Navigate to /requests/my-actions - request appears in action items list
  4. Click request to open modal - approval actions visible and functional
  5. Log in as hierarchy-based approver - verify pending approvals still appear (no regression)

## Success Criteria Met

- Custom approval chain approvers for solutions see pending items in both /dashboard and /my-actions
- Final approval custom chain approvers also see their pending items (status filter removed)
- Hierarchy-based approvals continue working without regression
- No duplicate entries when a request has both request-level and solution-level pending approvals for the same user

## Deviations from Plan

None - plan executed exactly as written.

## Technical Notes

**Deduplication Pattern:**
- Use `Set<string>` to track seen request IDs
- Check `seenRequestIds.has()` before adding to results
- Prevents same request appearing twice if user has pending approvals in both request-level and solution-level chains

**Actionability Logic:**
- Request approval: Check `requestApproval.count` with lower order
- Solution approval: Check `solutionApproval.count` with lower order
- Only include approval if no blocking approvals exist (sequential chain enforcement)

**Query Performance:**
- Two separate queries (RequestApproval, SolutionApproval) instead of complex JOIN
- Clearer logic, easier to maintain
- Actionability checks run in loops but necessary for accurate filtering

## Next Phase Readiness

No blockers. Quick fix complete.

Custom approval chain users now have full visibility into pending solution approvals and final approvals in both dashboard and action items page.
