---
status: diagnosed
phase: 04-gap-closure
source: 04-15-PLAN.md, 04-16-PLAN.md, 04-17-PLAN.md, 04-18-PLAN.md, 04-19-PLAN.md
started: 2026-02-04T11:00:00Z
updated: 2026-02-04T11:35:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete - awaiting issue diagnosis]

## Tests

### 1. Engineering Approver Buttons for Custom Chains
expected: Engineering and non-engineering users in custom approval chains can see and use approval buttons. Hierarchy-based approvals still restricted to engineering users. Users not in chains see no buttons.
result: issue
reported: "test 1a: engineering approver can't see approve/reject. test 1b: Non-engineering user can't see approve/reject. test 1c: engineering approver can't see approve/reject. test 1d: NO approval buttons shown"
severity: blocker

### 2. Solution Approval Progress Visual Hierarchy
expected: Solution Approval Progress shows numbered badges (1, 2, 3...), blue background highlighting for current pending approval, distinct visual styles for completed/pending/rejected approvals. Clear visual hierarchy showing approval chain progression.
result: pass

### 3. Engineering Dashboard Navigation
expected: "All Engineering Requests" tab switches view without 404 error using client-side filtering. "Review & Approve" button opens modal without full page navigation. URL remains /engineering. Modal actions work correctly.
result: pass

### 4. Modal Minimalism with Consolidated Approvals
expected: Single unified "Approval Progress" section (or clearly separated by type) using ApprovalProgress component consistently. No redundant approval progress sections. Activity History removed. Hierarchy visualization consistent across all approval types. Less visual clutter.
result: issue
reported: "4a,4b pass. 4c-4d skip. re-test after fix approve botton issue."
severity: major
reason: Partial pass - 4a and 4b passed (initial workflow and solution workflow), but 4c and 4d skipped pending approval button fix

### 5. Solution Submit Button Visibility
expected: Engineering users at top level of hierarchy can see green "Submit Solution" button when request status is "SentToEngineer". Button appears even if modal opens before authentication completes. Non-engineering users and non-top-level engineering users do not see button.
result: issue
reported: "5a:some engineering user(in this case is top engineering user) not see 'submit solution' in /request page but can see in /engineering Requests Awaiting Solution. 5b,5c skipped. 5d: engineering middle lever user see submit solution botton(this is what it should be. actually everyone in engineering department should see and submit solution!!)"
severity: major
reason: Two issues: (1) Submit button visible in /engineering dashboard but NOT in modal opened from /requests page (inconsistent visibility), (2) Business requirement clarification: ALL engineering users should see submit button, not just top-level

## Summary

total: 5
passed: 2
issues: 3
pending: 0
skipped: 0

## Gaps

<!-- YAML format for plan-phase --gaps consumption -->
- truth: "Engineering approvers see Approve and Reject buttons when they are in custom approval chain (regardless of role)"
  status: failed
  reason: "User reported: test 1a: engineering approver can't see approve/reject. test 1b: Non-engineering user can't see approve/reject. test 1c: engineering approver can't see approve/reject. test 1d: NO approval buttons shown"
  severity: blocker
  test: 1
  root_cause: "In request-detail-modal.tsx lines 118-126, the code loops through solutionApprovals and incorrectly passes approval.id to canUserApproveSolution(), but the function expects solution.id. The function queries prisma.solution.findUnique() with approval ID (wrong type), returns null, and sets canApproveSolution to false, so buttons never render."
  artifacts:
    - path: "src/components/requests/request-detail-modal.tsx"
      issue: "Line 120 passes approval.id instead of solutionData.id to canUserApproveSolution()"
      lines: [118-126]
    - path: "src/server-actions/solutions.ts"
      issue: "Function expects solutionId parameter but receives approval ID"
      lines: [449, 469-483]
  missing:
    - "Change line 120 from canUserApproveSolution(approval.id) to canUserApproveSolution(solutionData.id)"
    - "Remove unnecessary loop - only need to check once per solution, not once per approval"
  debug_session: ".planning/debug/approval-buttons-not-showing.md"
- truth: "Modal minimalism redesign completed for all workflow phases"
  status: partial
  reason: "User reported: 4a,4b pass. 4c-4d skip. re-test after fix approve botton issue."
  severity: major
  test: 4
  root_cause: "Cannot complete test 4c (final approval workflow) and 4d (completed request) without approval buttons working"
  artifacts: []
  missing:
    - "Fix approval button issue before re-testing 4c and 4d"
  debug_session: ""
- truth: "Submit button visible in request detail modal for all engineering users when status is SentToEngineer"
  status: failed
  reason: "User reported: Top engineering user not see 'submit solution' in /request page but can see in /engineering Requests Awaiting Solution. Engineering middle level user see submit solution button (user says: actually everyone in engineering department should see and submit solution!!)"
  severity: major
  test: 5
  root_cause: "request-detail-modal.tsx line 465 uses unreliable client-side userRole === 'engineering' check that fails when userRole state is undefined or not yet synced from Clerk metadata (useState/useEffect race condition). Engineering dashboard works because it has server-side role protection at page level, so needs-action-list doesn't need client-side role check. Button links to /engineering/solutions/[requestId] which has server-side authorization, so button visibility is informational, not a security boundary."
  artifacts:
    - path: "src/components/requests/request-detail-modal.tsx"
      issue: "Line 465 has unreliable userRole === 'engineering' condition that fails due to async state sync"
      lines: [465, 67-74]
    - path: "src/components/engineering/needs-action-list.tsx"
      issue: "Shows button without role check - works correctly"
      lines: [156-160]
    - path: "src/app/(dashboard)/engineering/page.tsx"
      issue: "Server-side role protection makes client checks unnecessary"
      lines: [31-33]
  missing:
    - "Remove && userRole === 'engineering' condition from line 465 in request-detail-modal.tsx"
    - "Business logic change: All engineering users should see submit button (not just top-level)"
  debug_session: ".planning/debug/submit-button-inconsistency.md"
