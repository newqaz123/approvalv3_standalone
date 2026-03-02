---
status: investigating
trigger: "Approval buttons not showing for anyone in request detail modal after plan 04-15 execution"
created: 2026-02-04T12:00:00Z
updated: 2026-02-04T12:05:00Z
---

## Current Focus
hypothesis: The function canUserApproveSolution is being called with wrong parameter (approval.id instead of solution.id)
test: Trace the execution flow in request-detail-modal.tsx lines 118-126
expecting: Will find that approval.id is passed to canUserApproveSolution instead of solution.id
next_action: Verify this is the issue and trace the correct parameter usage

## Symptoms
expected: Approval buttons should show for users who have approval authority (engineering users in custom chains, non-engineering users in custom chains, engineering users in hierarchy-based approvals)
actual: NO approval buttons are showing for anyone in the request detail modal
errors: None reported
reproduction: Open request detail modal for any request - no approval buttons visible
started: After commits 35b02a5 and 9af1fd7 from plan 04-15 execution

## Eliminated

## Evidence
- timestamp: 2026-02-04T12:05:00Z
  checked: request-detail-modal.tsx lines 118-126
  found: CRITICAL BUG - Loop through solutionApprovals array and call canUserApproveSolution(approval.id)
  implication: The function expects solutionId but is receiving approval.id (wrong type of ID)

- timestamp: 2026-02-04T12:05:00Z
  checked: canUserApproveSolution function signature in solutions.ts line 449
  found: Function signature is canUserApproveSolution(solutionId: string) - expects solution ID
  implication: Passing approval.id causes the function to fail finding the solution, returning { canApprove: false }

- timestamp: 2026-02-04T12:05:00Z
  checked: solutions.ts lines 469-483 (function logic)
  found: Function queries prisma.solution.findUnique({ where: { id: solutionId } }) - will fail if solutionId is actually approval.id
  implication: This causes canApprove to always be false, so buttons never show

## Resolution
root_cause:
fix:
verification:
files_changed: []
