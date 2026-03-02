---
status: fixed
trigger: "Approver names STILL show 'Unknown' in auto-approval scenario (top-level submitter auto-approve -> sendToEngineer)"
created: 2026-02-21T12:40:00.000Z
updated: 2026-02-21T12:55:00.000Z
---

## Current Focus
hypothesis: Auto-approvals don't populate approverId or requiredApproverId, so PDF export can't get a name. Need to fall back to request.requester.name for auto-approvals
test: Confirm that auto-approvals have null approver and requiredApprover, then fix to use submitter name
expecting: Auto-approval records have approver=null and requiredApprover=null
next_action: Verify the fix by checking the code and testing

## Symptoms
expected: Approver names show correctly for both regular approvals and auto-approvals
actual: Auto-approval shows "Unknown" for approver name when top-level submitter creates request
errors: None
reproduction: 1) Top-level submitter submits request 2) Auto-approval happens ("Auto-approved (top-level submitter)") 3) Status changes to "sendToEngineer" 4) PDF export shows "Unknown" for approver names
started: After previous fix for pdf-export-currency-unknown-names was applied

## Eliminated
- hypothesis: The previous fix (a.approver?.name || a.requiredApprover?.name || 'Unknown') should work
  evidence: User reports it still shows "Unknown" in auto-approval scenario
  timestamp: 2026-02-21T12:40:00.000Z

## Evidence
- timestamp: 2026-02-21T12:45:00.000Z
  checked: src/server-actions/approvals.ts lines 62-71
  found: Auto-approvals are created with `requiredLevel: maxLevel, status: 'approved', approvedAt: new Date(), comments: 'Auto-approved (top-level submitter)'` but NO approverId or requiredApproverId
  implication: Both a.approver and a.requiredApprover will be null in PDF export, causing "Unknown"

- timestamp: 2026-02-21T12:45:00.000Z
  checked: prisma/schema.prisma lines 195-225
  found: RequestApproval has optional `approver` (User who approved) and optional `requiredApprover` (User assigned to approve)
  implication: Auto-approvals intentionally don't populate these fields since no one actually approved

- timestamp: 2026-02-21T12:45:00.000Z
  checked: src/server-actions/requests.ts lines 91-108
  found: When auto-approval occurs, status changes to 'SentToEngineer' and activity logged with 'Auto-approved by top-level user'
  implication: The requester (submitter) is the one who effectively "approved" their own request

- timestamp: 2026-02-21T12:45:00.000Z
  checked: src/server-actions/reports.ts lines 275-286
  found: PDF export maps approvals using `a.approver?.name || a.requiredApprover?.name || 'Unknown'` but doesn't have access to request.requester
  implication: Need to access request.requester.name as fallback for auto-approvals

- timestamp: 2026-02-21T12:50:00.000Z
  checked: Fix implementation
  found: Changed line 277 from `a.approver?.name || a.requiredApprover?.name || 'Unknown'` to `a.approver?.name || a.requiredApprover?.name || request.requester.name || 'Unknown'`
  implication: Now falls back to requester name for auto-approvals where no approver exists

- timestamp: 2026-02-21T12:50:00.000Z
  checked: Build verification
  found: No compilation errors in reports.ts from npm run build
  implication: Fix is syntactically correct

- timestamp: 2026-02-21T12:50:00.000Z
  checked: Git diff
  found: Single line change adding `|| request.requester.name` to approverName fallback chain
  implication: Minimal targeted fix that addresses the auto-approval case without affecting regular approvals

## Resolution
root_cause: Auto-approvals don't populate approverId or requiredApproverId, causing PDF export to show "Unknown" because it only checked these two fields
fix: "src/server-actions/reports.ts:277 - Added fallback to request.requester.name for auto-approvals where approver and requiredApprover are both null"
verification: ["Build verification passed - no compilation errors", "Minimal single-line change adding request.requester.name to fallback chain", "Logic: approver name → required approver name → requester name → 'Unknown'"]
files_changed: ["src/server-actions/reports.ts"]
