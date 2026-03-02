---
status: resolved
trigger: "modal-not-refreshing-after-approval"
created: 2026-02-06T00:00:00Z
updated: 2026-02-06T00:00:20Z
---

## Current Focus

hypothesis: Fix applied - state now always updates based on API result
test: Code review to verify the fix is correct and complete
expecting: Code should now properly set canApproveSolution to false after approval
next_action: Review the fix and verify logic flow

## Symptoms

expected: Buttons should gray out and a new modal should appear (like other modals in the app behave)

actual: Approve/Reject buttons remain active and clickable even after approval is submitted. The approval IS saved to the database correctly, but the UI doesn't update until manual page refresh.

errors: None reported - the approval action succeeds silently

reproduction:
1. Engineer submits a solution
2. Use custom hierarchy approval workflow
3. Approver opens the request modal from QC/Approver dashboard
4. Approver clicks "Approve Solution"
5. Backend saves the approval successfully
6. UI does not update - buttons still show as active
7. Manual page refresh shows correct approved state

started: Just noticed today - appears to be recent regression or newly discovered existing bug

context: The screenshot shows:
- Request titled "Send request from QC LV2 1" with "Sent Back to Requester" status
- Engineering Solution section with Approve/Reject buttons
- Engineering Solution Approval section showing "QC Level 2 -B" already approved
- After approval, buttons should disappear/disable but they don't

## Eliminated

## Evidence

- timestamp: 2026-02-06T00:01:00Z
  checked: solution-approval-actions.tsx (lines 59-76)
  found: handleApprove calls router.refresh() after success, NOT loadRequest() from parent modal
  implication: router.refresh() doesn't update modal state - it refreshes server components but modal is client state

- timestamp: 2026-02-06T00:02:00Z
  checked: request-detail-modal.tsx (lines 509-527)
  found: OLD approval buttons using handleApproveSolution/handleRejectSolution which correctly call loadRequest()
  implication: There are TWO different approval button implementations in the same modal

- timestamp: 2026-02-06T00:03:00Z
  checked: request-detail-modal.tsx component structure
  found: Modal renders <SolutionApprovalActions> component (imported but not visible in current render)
  implication: Need to check where SolutionApprovalActions is being used vs the old buttons

- timestamp: 2026-02-06T00:04:00Z
  checked: solution-detail.tsx usage of SolutionApprovalActions
  found: solution-detail.tsx uses SolutionApprovalActions correctly (lines 263-272) - this is used in standalone solution pages
  implication: The new component exists and is used elsewhere, just not in the modal

- timestamp: 2026-02-06T00:05:00Z
  checked: request-detail-modal.tsx lines 509-527 - the old buttons
  found: OLD approval implementation using prompt() for reject reason and calling handleApproveSolution/handleRejectSolution which DO call loadRequest() after success
  implication: Modal has old implementation that should be replaced with SolutionApprovalActions component

- timestamp: 2026-02-06T00:06:00Z
  checked: SolutionApprovalActions component callback pattern
  found: Component calls router.refresh() which only refreshes server components, not client state in modal
  implication: SolutionApprovalActions needs an onSuccess callback like ApprovalActions has

- timestamp: 2026-02-06T00:07:00Z
  checked: loadRequest() implementation lines 184-189
  found: BUG! checkResult only updates canApproveSolution to TRUE if user can approve. After approval, canApprove=false, so it never resets canApproveSolution back to false
  implication: After approval, buttons remain active because canApproveSolution state is never set back to false

## Resolution

root_cause: In request-detail-modal.tsx lines 184-189, the code only sets canApproveSolution=true when canUserApproveSolution returns true. After a user approves, canUserApproveSolution will return false (user already approved), but the code doesn't handle this case - it leaves canApproveSolution in its old TRUE state. This causes the approval buttons to remain active/visible even after approval.

The conditional logic should ALWAYS update the state based on the API result:
```typescript
// CURRENT (WRONG):
if (checkResult.canApprove) {
  setCanApproveSolution(true)
  setSolutionApprovalId(checkResult.approval.id)
}

// SHOULD BE:
setCanApproveSolution(checkResult.canApprove)
if (checkResult.canApprove) {
  setSolutionApprovalId(checkResult.approval.id)
} else {
  setSolutionApprovalId(null)
}
```

fix: Updated request-detail-modal.tsx lines 186-191 to always update canApproveSolution state based on API result, not just when true. Also properly reset solutionApprovalId to null when user cannot approve.

verification:
- Code review PASSED:
  * Line 186: setCanApproveSolution(checkResult.canApprove) now ALWAYS updates state
  * Lines 187-191: Properly handles both true and false cases for solutionApprovalId
  * Line 511: Buttons are conditionally rendered with {canApproveSolution && ...}
  * Flow verified: approve -> loadRequest -> canUserApproveSolution returns false -> state updates to false -> buttons disappear
- Logic flow verified: After approval, canUserApproveSolution will return {canApprove: false}, which will now update the state, causing the conditional render to hide the buttons
- Similar logic for final approval (line 203) already correct - uses same pattern

files_changed:
  - src/components/requests/request-detail-modal.tsx
