---
phase: quick-026
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/approvals/approval-progress.tsx
autonomous: true

must_haves:
  truths:
    - "Engineering Solution Approval section shows approver names instead of generic text"
    - "Final Approval progress shows approver names instead of 'Level X Approval'"
    - "Improvement Request progress shows approver names instead of 'Level X Approval'"
  artifacts:
    - path: "src/components/approvals/approval-progress.tsx"
      provides: "Approval progress displaying approver names with proper fallback logic"
  key_links:
    - from: "approval-progress.tsx"
      to: "approver name display"
      via: "Prioritize requiredApprover.name > approver.name > Level X"
      pattern: "requiredApprover\\?\\.name.*\\|\\|.*approver\\?\\.name"
---

<objective>
Fix approval progress display to show approver names instead of "Level X Approval" generic text

Purpose: The detail modal's approval hierarchy progress currently displays "Level X Approval" for regular department approvals instead of showing the actual approver's name. This fix mirrors the changes made in quick-025 for the dashboard hover tooltip, providing consistent, human-readable approval information throughout the UI.

Output: Updated ApprovalProgress component that displays approver names with proper fallback logic
</objective>

<execution_context>
@~/.config/opencode/get-shit-done/workflows/execute-plan.md
@~/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/025-fix-approval-status-hover/025-SUMMARY.md
@src/components/approvals/approval-progress.tsx

# Current Issues

The ApprovalProgress component (line 87-95) has logic to check if it's a custom chain:
```typescript
{isCustomChain ? (
  <p className="text-sm font-medium">
    {approval.requiredApprover?.name || 'Unknown Approver'}
  </p>
) : (
  <p className="text-sm font-medium">
    Level {approval.requiredLevel} Approval
  </p>
)}
```

The problem is that for regular department approvals, even when `requiredApprover` is populated, the logic falls through to show "Level X Approval". This affects:
1. Engineering Solution Approval section (status="Design & Cost Approval")
2. Final Approval progress (status="Final Approval")
3. Department Approval progress (status="Improvement Request")

# Data Structure

Approval object (same as quick-025):
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

# Solution from Quick 025

Quick-025 established the pattern for displaying approver names:
```typescript
{approval.requiredApprover?.name || approval.approver?.name || `Level ${approval.requiredLevel}`}
```

This displays:
1. `requiredApprover.name` for custom approvers (e.g., "QC Level 2 -B")
2. `approver.name` for users who have already approved
3. Fallback to `Level X` if no name is available

Apply this same pattern to ApprovalProgress component for consistency.

</context>

<tasks>

<task type="auto">
  <name>Update ApprovalProgress to show approver names</name>
  <files>src/components/approvals/approval-progress.tsx</files>
  <action>
  Replace the custom chain check with unified approver name display logic.

  Change lines 87-95 from:
  ```typescript
  {isCustomChain ? (
    <p className="text-sm font-medium">
      {approval.requiredApprover?.name || 'Unknown Approver'}
    </p>
  ) : (
    <p className="text-sm font-medium">
      Level {approval.requiredLevel} Approval
    </p>
  )}
  ```

  To:
  ```typescript
  <p className="text-sm font-medium">
    {approval.requiredApprover?.name || approval.approver?.name || `Level ${approval.requiredLevel} Approval`}
  </p>
  ```

  This displays:
  1. `requiredApprover.name` for pending approvals with assigned approver (e.g., "QC Level 2 -B")
  2. `approver.name` for already approved/rejected approvals
  3. Fallback to `Level X Approval` only if no name is available

  Remove the `isCustomChain` check as it's no longer needed with unified logic.
  </action>
  <verify>
  Open detail modal for request with status="Design & Cost Approval", verify Engineering Solution Approval section shows approver names
  Open detail modal for request with status="Final Approval", verify Final Department Approval section shows approver names
  Open detail modal for request with status="Improvement Request", verify Department Approval section shows approver names
  </verify>
  <done>
  Approval progress displays approver names (requiredApprover.name or approver.name) instead of generic "Level X Approval" text
  </done>
</task>

</tasks>

<verification>
1. Check Engineering Solution Approval section shows approver names
2. Check Final Approval progress shows approver names
3. Check Improvement Request progress shows approver names
4. Verify fallback to "Level X Approval" only when no approver name is available
</verification>

<success_criteria>
- Engineering Solution Approval section displays approver names instead of generic text
- Final Approval progress displays approver names instead of "Level X Approval"
- Department Approval progress displays approver names for "Improvement Request" status
- Consistent with quick-025 approver name display pattern
</success_criteria>

<output>
After completion, create `.planning/quick/026-improve-ui-ux-in-detail-modal-approval-d/026-SUMMARY.md`
</output>
