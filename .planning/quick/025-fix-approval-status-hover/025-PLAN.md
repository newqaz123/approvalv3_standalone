---
phase: quick-025
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/requests/approval-status-badge.tsx
autonomous: true

must_haves:
  truths:
    - "Hover tooltip displays for all 'Approving' statuses including 'Design & Cost Approval'"
    - "Tooltip shows approver names (e.g., 'QC Level 2 -B', 'Pattawat Wannawong') instead of level numbers (e.g., 'Level 2')"
    - "Tooltip only shows approval information for the current stage, not historical stages"
  artifacts:
    - path: "src/components/requests/approval-status-badge.tsx"
      provides: "Fixed approval status hover with approver names and current stage filtering"
  key_links:
    - from: "approval-status-badge.tsx"
      to: "approvals array"
      via: "Filter to show only current stage approvals (not isFinalApproval)"
      pattern: "approvals\\.filter.*!isFinalApproval"
    - from: "approval-status-badge.tsx"
      to: "display text"
      via: "Show requiredApprover.name if available, fallback to approver.name"
      pattern: "requiredApprover\\.name.*\\|\\|.*approver\\.name"
---

<objective>
Fix approval status hover tooltip to show approver names and filter to current stage only

Purpose: The current hover tooltip displays level numbers ("Level 2", "Level 4") instead of actual approver names, and shows all historical approval stages instead of just the current stage. This fix will improve usability by showing relevant, human-readable approval information.

Output: Updated ApprovalStatusBadge component that displays approver names and filters to current stage approvals only
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/015-approval-status-column-and-hover-hierarchy/015-SUMMARY.md
@src/components/requests/approval-status-badge.tsx
@src/server-actions/dashboard.ts

# Current Issues

1. **Hover not showing for "Design & Cost Approval"**: The `inProgress` logic checks `pendingCount > 0 && rejectedCount === 0`, but if some approvals are approved and some are pending, it still shows "—" instead of the Approving badge

2. **Shows levels instead of approver names**: Line 118 in approval-status-badge.tsx displays `Level {approval.requiredLevel}`, but should display the actual approver name from `approval.requiredApprover?.name` or `approval.approver?.name`

3. **Shows all stages instead of current stage**: The tooltip displays ALL approvals from the entire approval chain (including previous stages like "Level 2, Level 4" from department approval, then "Level 2, Level 4" from final approval). Should filter to show only the CURRENT stage's approvals.

# Data Structure

Approval object from dashboard.ts:
```typescript
approvals: Array<{
  id: string
  status: 'pending' | 'approved' | 'rejected'
  approver?: { name: string } | null
  requiredLevel: number
  requiredApproverId?: string
  requiredApprover?: { name: string } | null
  order: number
  approvedAt?: Date | null
  isCustomChain?: boolean
  isFinalApproval?: boolean
}>
```

The `isFinalApproval` field distinguishes between:
- Initial department approval stage (`isFinalApproval: false`)
- Final approval stage (`isFinalApproval: true`)

# Example from Screenshots

In image-5.png:
- Status column shows "Design & Cost Approval"
- Hover tooltip should show: "QC Level 2 -B", "Pattawat Wannawong" (the actual approvers)
- Currently shows: "Level 2", "Level 4" (the required levels, not names)
- Also shows historical approvals from previous stage

</context>

<tasks>

<task type="auto">
  <name>Fix Approving badge display logic</name>
  <files>src/components/requests/approval-status-badge.tsx</files>
  <action>
  Modify the `inProgress` calculation logic (line 39) to correctly identify when approval is in progress.

  Current logic:
  ```typescript
  const inProgress = pendingCount > 0 && rejectedCount === 0
  ```

  This correctly identifies in-progress state (pending approvals exist, no rejections). The issue is likely that approvals data isn't being loaded properly.

  Add a safety check to ensure approvals array exists and has items:
  ```typescript
  const inProgress = approvals.length > 0 && pendingCount > 0 && rejectedCount === 0
  ```

  Do NOT change the "—" display for completed/approved requests - this is intentional to reduce visual noise.
  </action>
  <verify>
  Create test request with "Design & Cost Approval" status, hover over Approval Status column, should see "Approving" badge (not "—")
  </verify>
  <done>
  Requests with pending approvals show "Approving" badge regardless of the stage type
  </done>
</task>

<task type="auto">
  <name>Show approver names instead of level numbers</name>
  <files>src/components/requests/approval-status-badge.tsx</files>
  <action>
  Replace the level number display with approver name display.

  Change line 117-119 from:
  ```typescript
  <span className="font-medium text-gray-700">
    Level {approval.requiredLevel}
  </span>
  ```

  To:
  ```typescript
  <span className="font-medium text-gray-700">
    {approval.requiredApprover?.name || approval.approver?.name || `Level ${approval.requiredLevel}`}
  </span>
  ```

  This displays:
  1. `requiredApprover.name` for custom approvers (e.g., "QC Level 2 -B")
  2. `approver.name` for users who have already approved
  3. Fallback to `Level X` if no name is available
  </action>
  <verify>
  Hover over "Approving" badge, tooltip should show names like "QC Level 2 -B", "Pattawat Wannawong" instead of "Level 2", "Level 4"
  </verify>
  <done>
  Tooltip displays human-readable approver names, not level numbers
  </done>
</task>

<task type="auto">
  <name>Filter approvals to show only current stage</name>
  <files>src/components/requests/approval-status-badge.tsx</files>
  <action>
  Filter the approvals array to show only the current stage's approvals, not all historical stages.

  The `isFinalApproval` field distinguishes between stages:
  - `isFinalApproval: false` = Initial department approval stage
  - `isFinalApproval: true` = Final approval stage (e.g., "Design & Cost Approval")

  Modify the filtering logic (after line 82) to separate approvals by stage and show only the relevant stage:

  ```typescript
  // Separate approvals by stage
  const initialStageApprovals = approvals.filter(a => !a.isFinalApproval)
  const finalStageApprovals = approvals.filter(a => a.isFinalApproval)

  // Determine which stage to display based on which has pending approvals
  const hasPendingInFinal = finalStageApprovals.some(a => a.status === 'pending')
  const currentStageApprovals = hasPendingInFinal ? finalStageApprovals : initialStageApprovals
  ```

  Then update the map loop (line 86) to use `currentStageApprovals` instead of `approvals`.

  This ensures:
  - During department approval stage: Only shows department approval hierarchy
  - During final approval stage: Only shows final approval hierarchy (e.g., "Design & Cost Approval" approvers)
  </action>
  <verify>
  1. For request in "Pending Approval" stage: Hover shows only department approval chain
  2. For request in "Design & Cost Approval" stage: Hover shows only final approval approvers (not department approvers)
  </verify>
  <done>
  Tooltip shows only the approval information for the current stage, not historical stages
  </done>
</task>

</tasks>

<verification>
1. Check that "Design & Cost Approval" status shows "Approving" badge (not "—")
2. Hover over Approving badge - verify tooltip shows approver names like "QC Level 2 -B", "Pattawat Wannawong"
3. Verify tooltip shows only current stage approvals (e.g., for "Design & Cost Approval", should show only final approvers, not department approvers)
4. Test with multiple request statuses to ensure filtering works correctly
</verification>

<success_criteria>
- Hover tooltip displays for all "Approving" statuses including "Design & Cost Approval"
- Tooltip shows approver names (e.g., "QC Level 2 -B", "Pattawat Wannawong") instead of level numbers
- Tooltip shows only current stage approval information, not historical stages
- No regression in existing "Pending Approval" stage hover behavior
</success_criteria>

<output>
After completion, create `.planning/quick/025-fix-approval-status-hover/025-SUMMARY.md`
</output>
