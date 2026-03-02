---
status: resolved
trigger: "Engineer submits solution → approver not notified: FAIL"
created: "2026-02-22T02:00:00.000Z"
updated: "2026-02-22T02:30:00.000Z"
---

## Current Focus

hypothesis: "Notification code in solutions.ts might not be executing due to incorrect code path selection"
test: "Add debug logging to trace which branch executes"
expecting: "Either custom approvals or hierarchy branch should execute notification"
next_action: "Add console.log statements to trace execution path"

## Symptoms

expected: |
  When Engineer submits solution → department approvers should be notified

actual: |
  Engineer submits solution → approver NOT notified
  (QC lv5 not receiving notification when engineer submits solution)

errors: []
reproduction: |
  1. QC lv2 creates new improvement request
  2. Request goes to Engineer
  3. Engineer submits solution
  4. QC lv5 (approver) should receive notification - but doesn't
started: "After first fix was applied"

## Eliminated

## Evidence

- timestamp: "2026-02-22T02:05:00.000Z"
  checked: "src/server-actions/solutions.ts - submitSolution function (lines 200-225)"
  found: "Notification code exists for hierarchy-based approval chain - notifies requester's department first-level approvers"
  implication: "Code structure looks correct, but might not be executing"

- timestamp: "2026-02-22T02:10:00.000Z"
  checked: "src/server-actions/solutions.ts - submitSolution function (lines 140-159)"
  found: "Notification code also exists for custom approval chain - notifies customApproverIds"
  implication: "Two possible paths, need to trace which one executes"

- timestamp: "2026-02-22T02:15:00.000Z"
  checked: "src/server-actions/solutions.ts - createHierarchyApprovalChain (lines 295-350)"
  found: "Approval chain is created in ENGINEERING department (line 202: engineeringDept.id passed as departmentId)"
  implication: "Approvals are in engineering department, but notification code notifies requester's department!"

- timestamp: "2026-02-22T02:20:00.000Z"
  checked: "src/server-actions/solutions.ts - notification code (lines 209-224)"
  found: "Line 212: getApproversAtLevel(request.departmentId, 1) - uses requester's department (QC)"
  implication: "BUG: Should notify ENGINEERING department, not requester's department!"

- timestamp: "2026-02-22T02:25:00.000Z"
  checked: "src/server-actions/solutions.ts - rejectFinalApproval function (lines 1662-1685)"
  found: "Notifies engineering department and requester's department, but doesn't exclude the person who rejected"
  implication: "The rejector may receive notification about their own rejection - should exclude them"

## Resolution

root_cause: |
  Two bugs found:
  1. Notification code in solutions.ts used request.departmentId (requester's QC department) but should use engineeringDept.id. The approval chain is created in engineering department, so notifications should go to engineering approvers.
  2. rejectFinalApproval notifies both departments but doesn't exclude the person who rejected - they receive a notification about their own rejection.

fix: |
  1. **solutions.ts line 212**: Changed from:
       getApproversAtLevel(request.departmentId, 1)
     To:
       getApproversAtLevel(engineeringDept.id, 1)
  
  2. **solutions.ts rejectFinalApproval**: Added excludeUserIds parameter [userId] to both notifyUsersInDepartment calls to prevent the rejector from receiving notification about their own rejection.

verification: "TypeScript compiles without errors"
files_changed:
  - "src/server-actions/solutions.ts": 
    - Fixed notification to use engineeringDept.id instead of request.departmentId
    - Added exclusion of rejector from rejection notifications
