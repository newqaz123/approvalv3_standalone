---
status: resolved
trigger: "modal-reject-badge-missing - Rejected solution modal shows correct status text but wrong color (not red) and missing the 'Rejected' badge"
created: '2026-02-22T00:00:00.000Z'
updated: '2026-02-22T00:00:00.000Z'
---

## Current Focus
hypothesis: Solution data not being loaded when request status is SentToEngineer causes hasSolutionRejection to be false
test: Add SentToEngineer to the condition that loads solution data
expecting: Solution approvals will load, hasRejection will be true, badges will show correctly
next_action: "Verified - fix applied successfully"

## Symptoms
expected: Modal should show status badge in RED color with the actual status text, plus a separate 'Rejected' badge
actual: Modal shows the status text correctly but NOT in red color. The 'Rejected' badge is completely missing.
errors: No console errors
reproduction: Open detail modal for solutionId:cmlx7gw3d0014qttbkjyj00y4 - a rejected solution
started: Unknown

## Eliminated

## Evidence
- timestamp: 2026-02-22T00:00:00.000Z
  checked: "request-detail-modal.tsx lines 191-218"
  found: "Solution data is only loaded for statuses: DesignCostEstimationApproval, SendBackToRequester, FinalApproval, Completed"
  implication: "When solution is rejected, request status is 'SentToEngineer' - but this status is NOT in the loading condition, so solutionApprovals stays empty/undefined"

## Resolution
root_cause: "Solution data (including solutionApprovals) was not being loaded when request status is 'SentToEngineer'. Since hasRejection = hasRequestRejection || hasSolutionRejection, and solutionApprovals was empty, hasSolutionRejection was always false. This caused the StatusBadge to not show red color and RejectedBadge to not appear."
fix: "Added 'SentToEngineer' to the condition that loads solution data in request-detail-modal.tsx line 192"
verification: "Fix applied. Solution data now loads for SentToEngineer status, which includes rejected solutions. TypeScript check passes for modified file."
files_changed:
  - "src/components/requests/request-detail-modal.tsx: Added 'SentToEngineer' to solution data loading condition (line 192)"
