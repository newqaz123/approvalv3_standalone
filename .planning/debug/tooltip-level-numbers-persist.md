---
status: verifying
trigger: "tooltip-level-numbers-persist"
created: 2026-02-21T00:00:00Z
updated: 2026-02-21T00:00:00Z
---

## Current Focus
hypothesis: Fix implemented - populate potentialApprovers for pending internal-level approvals and display in tooltip
test: Navigated to dashboard and hovered over approval badge
expecting: Tooltip should now show potential approver names (e.g., "Pattawat Wannawong") instead of "Level 4"
next_action: Verify the fix works by checking the tooltip display

## Symptoms
expected: Tooltips should show approver names (e.g., "QC Level 2 -B") based on requiredApprover.name || approver.name
actual: Tooltips still show "Level 2"/"Level 4" on both Dashboard and /requests pages for all approvals
errors: No errors visible
reproduction: Hover over any approval status badge on Dashboard or /requests pages
timeline: Previous fix (commit ddf7295) added requiredApprover to data loading and "Approving" badge now works correctly, but tooltips still show level numbers

## Evidence
- timestamp: 2026-02-21
  checked: ApprovalStatusBadge component logic
  found: Component correctly implements quick-025 spec:
    - Line 132: For approved/rejected: `approval.approver?.name || Level ${approval.requiredLevel}`
    - Line 134: For pending: `approval.requiredApprover?.name || Level ${approval.requiredLevel}`
  implication: Component logic is correct, issue must be data-related

- timestamp: 2026-02-21
  checked: Database directly via script
  found:
    - Approved approvals: HAVE approver.name (e.g., "Pattawat Wannawong", "QC Level 2 -B")
    - Pending approvals: requiredApprover is null (internal-level approvals)
    - No DepartmentApprover type approvals in database
  implication: Data is correct. Pending internal-level approvals show "Level X" because requiredApprover is null (anyone at level can approve)

- timestamp: 2026-02-21
  checked: Request approval states
  found:
    - "General Inquiry : " has 1 approved (Level 4 by Pattawat) + 1 pending (Level 4, no requiredApprover)
    - "test01" has 1 approved (Level 4 by Pattawat) + 1 pending (Level 4, no requiredApprover)
  implication: Tooltip should show "Pattawat Wannawong" for approved and "Level 4" for pending

- timestamp: 2026-02-21
  checked: ApprovalStatusBadge component interface
  found: Field `potentialApprovers?: { name: string }[] | null` exists but is never populated
  implication: Feature exists but not implemented - could show who CAN approve pending internal-level approvals

## Eliminated

## Resolution
root_cause: Pending internal-level approvals (not DepartmentApprovers) have requiredApprover=null, causing tooltip to show "Level X" instead of potential approver names. The component had potentialApprovers field defined but it was never populated.
fix:
  1. Updated getMyCreatedRequests (dashboard.ts) to load potentialApprovers using getApproversAtLevel() for pending approvals without requiredApprover
  2. Updated getAllRequests (dashboard.ts) with same logic
  3. Updated getPendingMyApprovals (dashboard.ts) with same logic
  4. Updated getMyRequests (requests.ts) with same logic
  5. Updated ApprovalStatusBadge component to display potentialApprovers for pending internal-level approvals (showing names joined by " or ")
  6. Added departmentId to select statements to support loading potential approvers
verification: TypeScript compilation passes without errors. Next: Verify in browser that tooltips show approver names.
files_changed:
  - src/server-actions/dashboard.ts
  - src/server-actions/requests.ts
  - src/components/requests/approval-status-badge.tsx
