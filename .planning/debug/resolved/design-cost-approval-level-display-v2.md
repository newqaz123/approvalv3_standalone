---
status: resolved
trigger: "Design&CostApproval approval status shows 'Level X' instead of approver's name"
created: 2026-02-22T00:00:00Z
updated: 2026-02-22T00:00:00Z
---

## Current Focus
hypothesis: FIXED - Potential approvers for solution approvals were being looked up in the wrong department
test: Verified that solution approvals now use Engineering department for approver lookup
expecting: Badge shows "Engineering Level 3" instead of "Level 3"
next_action: Complete

## Symptoms
expected: Design&CostApproval approvals should display the actual approver's name (like "Engineering Level 3")
actual: Design&CostApproval approvals displayed "Level X" instead of the approver's name
errors: No error messages - just incorrect display
reproduction: View any DesignCostEstimationApproval approval status on dashboard or requests page
started: Never worked correctly - pre-existing bug

## Evidence

- timestamp: 2026-02-22
  checked: getApproversAtLevel usage in dashboard.ts and requests.ts
  found: When loading potentialApprovers for solution approvals, code used `req.departmentId` (request's department, e.g., QC) instead of the Engineering department
  implication: Since QC had no users at Level 3, potentialApprovers was empty, causing fallback to "Level 3"

- timestamp: 2026-02-22
  checked: Database data
  found: 
    - Solution submitted by "Engineering Level 2" from ENG department
    - Approval requires Level 3
    - "Engineering Level 3" exists in ENG department
    - No users at Level 3 in QC department (request's department)
  implication: The bug was looking in the wrong department

## Resolution

root_cause: When loading `potentialApprovers` for solution approvals (DesignCostEstimationApproval status), the code was looking up approvers in the **request's department** (e.g., QC) instead of the **Engineering department** where the solution was submitted from.

fix: 
1. Added `submittedBy.departmentId` to the solutions select query in:
   - `getMyCreatedRequests` (dashboard.ts)
   - `getAllRequests` (dashboard.ts)
   - `getMyRequests` (requests.ts)

2. Updated potential approvers logic to use:
   - `req.solutions[0]?.submittedBy?.departmentId` for solution approvals (Engineering department)
   - `req.departmentId` for request approvals (original department)

verification: User confirmed that DesignCostEstimationApproval now shows "Engineering Level 3" instead of "Level 3"

files_changed:
- src/server-actions/dashboard.ts
- src/server-actions/requests.ts
