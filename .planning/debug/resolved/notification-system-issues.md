---
status: resolved
trigger: "Notification system not working correctly for multiple stages"
created: "2026-02-22T00:00:00.000Z"
updated: "2026-02-22T00:35:00.000Z"
---

## Current Focus

hypothesis: "Fixes implemented - verifying compilation"
test: "TypeScript compilation check"
expecting: "No errors"
next_action: "Document the fix in Resolution section"

## Symptoms

expected: |
  1. When new improvement request is created → department approvers should be notified
  2. When Engineer submits solution → department approvers should be notified  
  3. When Final Approval Rejected → should notify BOTH Engineers AND Requester's department

actual: |
  1. No notification to approvers when new request created (QC lv2 creates, QC lv5 approver not notified)
  2. No notification to approvers when Engineer submits solution
  3. Only FinalApproval stage has notifications working to approvers
  4. Currently Final Approval Rejected only notifies Engineers (not Requester's department)

errors: []
reproduction: |
  1. Login as QC lv2 (requester), create new improvement request
  2. Login as QC lv5 (approver) - no notification received
  3. After engineer works and submits solution, approvers not notified
  4. Only when reaching FinalApproval stage do approvers get notified
started: "Unknown - appears to be missing functionality"

## Eliminated

## Evidence

- timestamp: "2026-02-22T00:05:00.000Z"
  checked: "src/server-actions/notifications.ts"
  found: "Notification helper functions exist: createNotification, notifyUsersInDepartment"
  implication: "These are the building blocks but need to be called at the right times"

- timestamp: "2026-02-22T00:10:00.000Z"
  checked: "src/server-actions/requests.ts - createRequest function (lines 50-115)"
  found: "New requests are created with status 'ImprovementRequest' but NO notification is sent to department approvers"
  implication: "First missing notification: Department approvers not notified when request is created"

- timestamp: "2026-02-22T00:15:00.000Z"
  checked: "src/server-actions/solutions.ts - submitSolution function (lines 130-209)"
  found: "Status changes to 'DesignCostEstimationApproval' when solution is submitted, but NO notification to department approvers"
  implication: "Second missing notification: Department approvers not notified when engineer submits solution"

- timestamp: "2026-02-22T00:20:00.000Z"
  checked: "src/server-actions/solutions.ts - rejectFinalApproval function (lines 1634-1643)"
  found: "Only notifies engineering department, NOT the requester's department"
  implication: "Third issue: Final Approval Rejected should also notify requester's department"

## Resolution

root_cause: "Three missing notification triggers: 1) No notification when request is created (ImprovementRequest stage) 2) No notification when engineer submits solution (DesignCostEstimationApproval) 3) Final Approval Rejected only notifies engineers, not requester's department"

fix: |
  Added notification logic in three places:
  
  1. **requests.ts (createRequest function)**: After creating approval chain, notify first-level department approvers about new approval request
  
  2. **solutions.ts (submitSolution function)**: 
     - For custom approval chain: Notify each custom approver when solution is submitted
     - For hierarchy-based chain: Notify requester's department first-level approvers when status changes to DesignCostEstimationApproval
  
  3. **solutions.ts (rejectFinalApproval function)**: Added notification to requester's department in addition to engineering department

verification: "TypeScript compiles without errors - manual testing recommended to verify notifications are received correctly"

files_changed:
  - "src/server-actions/requests.ts": Added notification to department approvers when request is created
  - "src/server-actions/solutions.ts": Added notifications when solution is submitted and when final approval is rejected