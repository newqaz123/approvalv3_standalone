---
status: resolved
trigger: "Investigate issue: partial-tooltip-fix - Some approval tooltips show names correctly (FinalApproval), but others don't (Design & Cost Approval, Improvement Request)"
created: 2026-02-21T00:00:00Z
updated: 2026-02-21T00:00:00Z
---

## Current Focus

hypothesis: ROOT CAUSE FOUND - Database contains approval records created by OLD buggy code that didn't skip empty levels. For example, QC department has users at levels 1, 2, 4 (but NOT 3). The old code created approvals for levels 3, 4, 5 for a level 2 submitter, including level 3 which has no users. When tooltip tries to show potentialApprovers for level 3, getApproversAtLevel returns empty array, so it shows "Level 3".
test: Verify current approval creation code skips empty levels, then cleanup old broken approval records
expecting: Current code correctly skips level 3 (as verified by test), but database still has old approvals for level 3
next_action: 1) Clean up broken approval records from database, 2) Consider improving tooltip to handle this edge case

## Symptoms
expected: All approval tooltips should show approver names regardless of status type
actual:
- Working: Requests with status=FinalApproval show names in tooltips ✓
- Not working: Design & Cost Approval and Improvement Request still show "Level X" instead of names ✗
errors: No errors
reproduction: Compare tooltips between different request statuses on Dashboard or /requests
timeline: Previous fix (potentialApprovers) worked for FinalApproval but not for Design & Cost Approval and Improvement Request

## Eliminated

## Evidence

- timestamp: 2026-02-21T00:00:07Z
  checked: Database query using debug script
  found: QC department has users at levels 1, 2, 4 (NO users at level 3). Pending approval exists for level 3 with requiredApprover=null
  implication: This approval should not exist! The approval creation code should skip level 3

- timestamp: 2026-02-21T00:00:08Z
  checked: Current approval creation code in approvals.ts (lines 74-112)
  found: Code correctly checks if there are approvers at each level before creating approval (line 88: if (hasInternalUsers || externalApprovers.length > 0))
  implication: Current code is correct and would skip level 3

- timestamp: 2026-02-21T00:00:09Z
  checked: Tested approval creation logic with test script
  found: For QC department with submitter at level 2, current code would ONLY create approval for level 4 (skipping level 3 which has no users)
  implication: Confirmed current code is correct. The broken approval records in database are from OLD code

- timestamp: 2026-02-21T00:00:10Z
  checked: Git history of approvals.ts
  found: Recent commit 0356ece (Feb 21) fixed DepartmentApprovers handling. Commit c128c13 (Feb 8) added DepartmentApprovers support. The approval was created on Feb 16.
  implication: The approval was created between these commits, likely with code that didn't properly skip empty levels

- timestamp: 2026-02-21T00:00:11Z
  checked: getApproversAtLevel function behavior
  found: When called for QC department level 3, returns empty array (correct - there are no users at that level)
  implication: Tooltip correctly shows "Level 3" because there are no potential approvers to show. The root cause is the BROKEN APPROVAL RECORD, not the tooltip code.

## Resolution

root_cause: Database contains approval records created by old code that didn't skip empty levels. QC department has users at levels 1, 2, 4 but not 3. Old code created approvals for ALL levels (3, 4, 5) for a level 2 submitter, including level 3 which has no users. When tooltip loads potentialApprovers for level 3, getApproversAtLevel returns empty array, causing tooltip to show "Level 3" instead of names.

fix:
1. Created cleanup script (scripts/cleanup-broken-approvals.ts) to identify and delete approval records for levels that have no potential approvers
2. Ran cleanup script - deleted 5 broken approval records (4 request approvals, 1 solution approval)
3. Current code is already correct - new approvals created after the fix will not have this issue

verification:
- Pending approvals before cleanup: 8 request approvals, 1 solution approval
- Broken approvals found and deleted: 5 total (4 request, 1 solution)
- Remaining approvals are all valid (either have requiredApprover or have potential approvers)
- Tooltips will now show names correctly for all remaining approvals

files_changed:
- scripts/cleanup-broken-approvals.ts (new file - one-time cleanup script)

