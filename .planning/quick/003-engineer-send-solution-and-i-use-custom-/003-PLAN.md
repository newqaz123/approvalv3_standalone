---
phase: quick
plan: 003
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server-actions/dashboard.ts
  - src/server-actions/requests.ts
autonomous: true

must_haves:
  truths:
    - "Custom approver for solution approval chain sees request in Pending My Approval tab on /dashboard"
    - "Custom approver for solution approval chain sees request in /my-actions page"
    - "Custom approver for final approval chain sees request in Pending My Approval tab on /dashboard"
    - "Custom approver for final approval chain sees request in /my-actions page"
    - "Existing hierarchy-based approvals still appear correctly (no regression)"
  artifacts:
    - path: "src/server-actions/dashboard.ts"
      provides: "getPendingMyApprovals queries both RequestApproval and SolutionApproval"
    - path: "src/server-actions/requests.ts"
      provides: "getMyActionItems queries both RequestApproval and SolutionApproval"
  key_links:
    - from: "src/server-actions/dashboard.ts"
      to: "prisma.solutionApproval"
      via: "findMany query in getPendingMyApprovals"
      pattern: "solutionApproval\\.findMany"
    - from: "src/server-actions/requests.ts"
      to: "prisma.solutionApproval"
      via: "findMany query in getMyActionItems"
      pattern: "solutionApproval\\.findMany"
---

<objective>
Fix: Custom approval chain approvers for solution approvals and final approvals do not see pending items in the dashboard "Pending My Approval" tab or the /my-actions page.

Root cause: Both `getPendingMyApprovals()` (dashboard.ts) and `getMyActionItems()` (requests.ts) only query the `RequestApproval` table. When an engineer submits a solution with a custom approval chain, those approvals are stored in the `SolutionApproval` table -- so custom approvers never see them. Additionally, `getMyActionItems()` hard-filters `request.status: 'ImprovementRequest'`, which excludes requests in `DesignCostEstimationApproval` and `FinalApproval` statuses entirely.

Fix approach: Add a second query to `SolutionApproval` in both functions, merge results with existing `RequestApproval` results (deduplicating by request ID), and remove the `ImprovementRequest` status filter from `getMyActionItems`.

Output: Both dashboard functions return solution approval chain items alongside request approval chain items.
</objective>

<context>
@.planning/STATE.md
@src/server-actions/dashboard.ts
@src/server-actions/requests.ts
@prisma/schema.prisma
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix getPendingMyApprovals to include SolutionApproval items</name>
  <files>src/server-actions/dashboard.ts</files>
  <action>
In `getPendingMyApprovals()` (dashboard.ts), after the existing `prisma.requestApproval.findMany` query and its actionability check loop, add a SECOND query to `prisma.solutionApproval.findMany` with:

1. Query `solutionApproval` where:
   - `OR: [{ requiredApproverId: userId }]` plus `{ requiredLevel: user.level }` if user has level
   - `status: 'pending'`
   - `solution.request.isDeleted: false`

2. Include the solution's request with same fields (department.name, requester.id+name, _count.fileAttachments) via `solution: { include: { request: { include: ... } } }`

3. For each pending solution approval, check actionability the same way -- count `solutionApproval` records with same `solutionId`, lower `order`, and `status: 'pending'`. Only include if zero blocking approvals.

4. Map each actionable solution approval to the same `RequestListRow` shape using `approval.solution.request.*` fields. Also check for hasRejection by counting rejected solutionApprovals for that solutionId.

5. Merge solution approval results into `actionableRequests` array. Deduplicate by request ID (use a Set to track seen IDs) so the same request does not appear twice if it has both request-level and solution-level pending approvals.

6. Return the merged, deduplicated array.
  </action>
  <verify>
Run `npx tsc --noEmit` to verify no type errors. Manually test: log in as the custom approver user, check /dashboard "Pending My Approval" tab shows the request that has a solution with custom approval chain.
  </verify>
  <done>Custom approver for solution approval chain sees the request in the dashboard "Pending My Approval" tab. Hierarchy-based request approvals still appear (no regression).</done>
</task>

<task type="auto">
  <name>Task 2: Fix getMyActionItems to include SolutionApproval items and remove ImprovementRequest filter</name>
  <files>src/server-actions/requests.ts</files>
  <action>
In `getMyActionItems()` (requests.ts):

1. REMOVE the `request.status: 'ImprovementRequest'` filter from the existing `requestApproval.findMany` query. Replace with just `request.isDeleted: false` (matching the pattern in dashboard.ts `getPendingMyApprovals`). This allows request-level approvals in ANY status to appear (including FinalApproval status with isFinalApproval custom chains).

2. Add a SECOND query to `prisma.solutionApproval.findMany` with:
   - Same OR conditions: `[{ requiredApproverId: userId }]` plus `{ requiredLevel: user.level }` if user has level
   - `status: 'pending'`
   - `solution.request.isDeleted: false`
   - Include `solution.request` with department.name, requester.id+name, _count.fileAttachments, and updatedAt

3. For each pending solution approval, check actionability -- count `solutionApproval` records with same `solutionId`, lower `order`, `status: 'pending'`. Only include if zero blocking.

4. Map to same return shape (`id`, `title`, `status`, `createdAt`, `updatedAt`, `requesterId`, `department`, `requester`, `_count`).

5. Merge and deduplicate by request ID (same Set pattern as Task 1).

6. Return merged array sorted by createdAt desc.
  </action>
  <verify>
Run `npx tsc --noEmit` to verify no type errors. Manually test: log in as the custom approver user, navigate to /requests/my-actions and verify the solution-approval request appears in the list.
  </verify>
  <done>Custom approver sees solution approval items in /my-actions. Removing the ImprovementRequest filter also fixes final approval custom chain visibility. No regression for hierarchy-based approvals.</done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no errors
2. Log in as a custom approver who was added to a solution's custom approval chain
3. Navigate to /dashboard -- "Pending My Approval" tab shows the request
4. Navigate to /requests/my-actions -- the request appears in the action items list
5. Click the request to open modal -- approval actions are visible and functional
6. Log in as a hierarchy-based approver -- verify their pending approvals still appear (no regression)
</verification>

<success_criteria>
- Custom approval chain approvers for solutions see pending items in both /dashboard and /my-actions
- Final approval custom chain approvers also see their pending items
- Hierarchy-based approvals continue working without regression
- No duplicate entries when a request has both request-level and solution-level pending approvals for the same user
</success_criteria>

<output>
After completion, create `.planning/quick/003-engineer-send-solution-and-i-use-custom-/003-SUMMARY.md`
</output>
