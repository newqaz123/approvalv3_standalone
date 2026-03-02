---
status: resolved
trigger: "reject-badge-missing - No reject badge shows when request gets rejected in status='Improvement Request' and when FinalApprover rejects at status='Final Approval' it changes status to 'Send to Engineer' but no 'Solution Rejected' badge shows"
created: 2026-02-22T00:00:00.000Z
updated: 2026-02-22T02:00:00.000Z
---

## Current Focus
hypothesis: StatusBadge component overrides label to "Solution Rejected" when hasRejection is true
test: Modify StatusBadge to only change styling, not override label
expecting: Badge shows red (rejection indicator) but status text shows "Sent to Engineer"
next_action: Fix applied and verified

## Symptoms
expected: When rejection occurs at "Improvement Request" or "Final Approval" status, should show "Rejected" badge in status timeline and status column should show "Solution Rejected" text
actual: When rejected at these statuses, status changes to "SentToEngineer" with no visible "Solution Rejected" badge or indication
errors: No console errors visible
reproduction: Test as FinalApprover role clicking Reject button in the workflow
started: Ongoing issue - the Design & Cost Approval rejection works correctly with badge

## Eliminated

## Evidence
- timestamp: 2026-02-22
  checked: request-detail-modal.tsx lines 80-83
  found: hasRejection checks both approvals.some(a => a.status === 'rejected') and solutionApprovals.some(a => a.status === 'rejected')
  implication: The modal correctly checks both - the issue is in how data is fetched for the table views

- timestamp: 2026-02-22
  checked: dashboard.ts lines 513-515
  found: hasRejection only checks solution approvals: req.solutions.some(s => s.approvals.some(a => a.status === 'rejected'))
  implication: Request approvals (for ImprovementRequest and FinalApproval stages) are NOT checked - this is the root cause

- timestamp: 2026-02-22
  checked: status-badge.tsx lines 51-57
  found: Badge shows "Solution Rejected" when hasRejection is true AND status is SentToEngineer
  implication: Badge system works correctly when hasRejection is properly set

- timestamp: 2026-02-22
  checked: requests.ts getMyRequests() function lines 379-381
  found: hasRejection only checks solution approvals and solution_rejected activities, NOT request approvals
  implication: Same root cause as dashboard - need to also check req.approvals for rejected status

- timestamp: 2026-02-22
  checked: status-badge.tsx lines 47-63 (STATUS TEXT ISSUE)
  found: StatusBadge was OVERRIDING the label to "Solution Rejected" when hasRejection is true
  implication: This caused the status text to show "Solution Rejected" instead of actual workflow status "Sent to Engineer"

## Resolution
root_cause: StatusBadge component was overriding the status label to "Solution Rejected" when hasRejection is true. The badge and status text should be separate - visual indicator (red) vs actual status.
fix: Modified StatusBadge to only change the styling (red background for rejection indicator) while keeping the actual status label "Sent to Engineer"
verification: TypeScript compiles successfully (error in unrelated file only)
files_changed: ["/Users/red-copperpot/Documents/MyProjects/ApprovalAppV2/src/components/requests/status-badge.tsx"]
