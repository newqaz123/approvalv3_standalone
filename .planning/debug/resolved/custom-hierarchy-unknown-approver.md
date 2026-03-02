---
status: resolved
trigger: "Investigate issue: custom-hierarchy-unknown-approver"
created: 2026-02-06T00:00:00Z
updated: 2026-02-06T00:15:00Z
---

## Current Focus

hypothesis: CONFIRMED - Added requiredApprover include to getRequestApprovals
test: Code verification completed - pattern matches getSolutionApprovals
expecting: Fix complete - approver names will now display for custom hierarchies
next_action: Archive debug session and commit fix

## Symptoms

expected: Show all approver names in progress display - the approval progress should display the actual names of approvers from the custom hierarchy
actual: All approvers in the progress show as "Unknown Approver"
errors: Console logs show DialogContent accessibility warnings (likely unrelated) and a Decimal serialization error. The main relevant log is: "[Log] [RequestDetailModal] User role from API: – 'general_dept'"
reproduction: View approval progress after submission final approval
started: Always been this way - custom hierarchies never showed approver names correctly

## Eliminated

## Evidence

- timestamp: 2026-02-06T00:05:00Z
  checked: approval-progress.tsx line 89
  found: Component tries to display `approval.requiredApprover?.name || 'Unknown Approver'`
  implication: The component expects requiredApprover object to be populated

- timestamp: 2026-02-06T00:06:00Z
  checked: solutions.ts getSolutionApprovals (lines 375-453)
  found: Includes `requiredApprover` with user details in the query (lines 410-417)
  implication: Solution approvals correctly fetch requiredApprover data for custom chains

- timestamp: 2026-02-06T00:07:00Z
  checked: approvals.ts getRequestApprovals (lines 413-470)
  found: Only includes `approver` (lines 426-433), does NOT include `requiredApprover` field
  implication: Request approvals (including final approvals) never fetch the requiredApprover data needed for custom hierarchies

- timestamp: 2026-02-06T00:10:00Z
  checked: schema.prisma RequestApproval model
  found: requiredApprover relation exists on RequestApproval model (line 205)
  implication: The database schema supports this relationship, confirming the fix is valid

- timestamp: 2026-02-06T00:11:00Z
  checked: Comparison with getSolutionApprovals pattern
  found: getSolutionApprovals includes both approver and requiredApprover - exact same pattern needed
  implication: Applied identical pattern to getRequestApprovals to match working implementation

## Resolution

root_cause: getRequestApprovals() in src/server-actions/approvals.ts only includes the `approver` relation but not the `requiredApprover` relation. Custom hierarchies store the approver in requiredApproverId/requiredApprover, so when getRequestApprovals doesn't fetch this relation, the UI shows "Unknown Approver". getSolutionApprovals() correctly includes both relations, which is why solution approvals work but final approvals (which use getRequestApprovals) don't.
fix: Added requiredApprover include to getRequestApprovals query at lines 434-441, matching the exact pattern from getSolutionApprovals. This ensures custom hierarchy approver names are fetched from the database and passed to the UI component.
verification: Code review confirmed fix matches working pattern in getSolutionApprovals. Schema verification confirmed requiredApprover relation exists on RequestApproval model. The fix is minimal, targeted, and follows existing patterns in the codebase.
files_changed: ["src/server-actions/approvals.ts"]
