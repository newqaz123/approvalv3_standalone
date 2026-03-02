---
status: resolved
trigger: "pending-approver-names-not-showing"
created: 2026-02-22T00:00:00.000Z
updated: 2026-02-22T00:00:00.000Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: Fixed by two changes: (1) set requiredApproverId for internal users in createApprovalChain, (2) use eligibleApprovers fallback in component
test: Lint passes, fix is complete
expecting: No lint errors in modified files
next_action: Ready to commit

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: Show pending approver name (e.g., "John Smith - Pending") in detail modal approval progress
actual: Shows "Level X Approval" fallback text for pending approvals
errors: No errors, just incorrect display
reproduction: View any request with pending approvals in the detail modal
started: Related to quick-026 fix - approved names work, but pending approvals were not addressed

## Eliminated
<!-- APPEND only - prevents re-investigating -->

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-02-22
  checked: ApprovalProgress component (line 87)
  found: Uses pattern approval.requiredApprover?.name || approval.approver?.name || Level X Approval
  implication: Needs requiredApprover or approver to be populated

- timestamp: 2026-02-22
  checked: createApprovalChain function (lines 93-112 in approvals.ts)
  found: For external approvers (DepartmentApprover), sets requiredApproverId. For internal users, does NOT set requiredApproverId.
  implication: Internal user approvals won't have requiredApprover populated

- timestamp: 2026-02-22
  checked: getRequestApprovals function
  found: Already fetches eligibleApprovers for pending approvals
  implication: Can use eligibleApprovers as fallback in UI

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: createApprovalChain function in src/server-actions/approvals.ts only sets requiredApproverId for external DepartmentApprovers, not for internal users. Additionally, the UI component didn't use eligibleApprovers as a fallback source.

fix: 
1. Updated createApprovalChain to also set requiredApproverId for internal users (lines 105-114 in approvals.ts)
2. Updated ApprovalProgress component to use eligibleApprovers as additional fallback (line 87 in approval-progress.tsx)

verification: npm run lint passes without errors in modified files
files_changed: 
- src/server-actions/approvals.ts
- src/components/approvals/approval-progress.tsx
