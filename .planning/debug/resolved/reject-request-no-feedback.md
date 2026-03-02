---
status: resolved
trigger: "reject-request-no-feedback"
created: 2026-02-06T00:00:00Z
updated: 2026-02-06T00:25:00Z
---

## Current Focus

hypothesis: CONFIRMED - ApprovalActions component missing toast notification after successful rejection
test: Compare with other approval components (solution-approval-actions, final-approval-actions)
expecting: Other components show toast.success() after rejection, ApprovalActions does not
next_action: Add toast import and success notification to ApprovalActions component

## Symptoms

expected: Should show success notification then close modal
actual: Modal stays open, no feedback at all - button doesn't show loading, no errors, just stuck
errors: Console not checked yet - need to investigate
reproduction: Open request detail → Click reject → Enter reason → Submit
started: Never worked properly - this has always been an issue

## Eliminated

## Evidence

- timestamp: 2026-02-06T00:05:00Z
  checked: ApprovalActions component (approval-actions.tsx)
  found: handleReject function exists at line 51-75, has loading states, error handling, calls rejectRequest server action
  implication: Client-side reject handler looks correct

- timestamp: 2026-02-06T00:06:00Z
  checked: rejectRequest server action (approvals.ts)
  found: Function exists at line 247-312, handles rejection, updates approval status, logs activity, returns {success: true}
  implication: Server action looks correct and returns success

- timestamp: 2026-02-06T00:07:00Z
  checked: ApprovalActions handleReject function (line 51-75)
  found: After server action completes, calls onSuccess?.() and router.refresh()
  implication: Success callback should trigger modal to close

- timestamp: 2026-02-06T00:08:00Z
  checked: RequestDetailModal usage of ApprovalActions (line 460-470)
  found: onSuccess callback is passed at line 463-466, sets actionPerformedRef.current = true and calls loadRequest()
  implication: This should trigger refresh, but might NOT close modal or show notification

- timestamp: 2026-02-06T00:10:00Z
  checked: solution-approval-actions.tsx handleReject (line 78-100)
  found: Line 91 shows toast.success('Solution rejected - returned to engineering') after successful rejection
  implication: Other approval components DO show toast notifications

- timestamp: 2026-02-06T00:11:00Z
  checked: final-approval-actions.tsx handleReject (line 213-238)
  found: Line 228 shows toast.success('Final approval rejected. Request returned to engineering.')
  implication: Confirmed pattern - all approval components should show toast feedback

- timestamp: 2026-02-06T00:12:00Z
  checked: approval-actions.tsx imports and handleReject
  found: NO toast import at top of file, handleReject (line 51-75) has NO toast.success() call after successful rejection
  implication: ROOT CAUSE FOUND - missing toast notification in ApprovalActions component

## Resolution

root_cause: ApprovalActions component (src/components/approvals/approval-actions.tsx) is missing toast notifications after successful approve/reject actions. The component successfully calls the server action and triggers onSuccess callback, but provides no visual feedback to the user. All other similar approval components (solution-approval-actions, final-approval-actions) use toast.success() to notify users.

fix: Added toast import from 'sonner' and added toast.success() and toast.error() calls in both handleApprove and handleReject functions to provide visual feedback on all outcomes (success, error, stale data).

verification:
✅ TypeScript compilation passes with no errors
✅ Toast notifications added for all outcomes:
   - handleApprove: toast.success('Request approved successfully') on line 44
   - handleApprove: toast.error() for stale data and errors on lines 40, 50
   - handleReject: toast.success('Request rejected successfully') on line 74
   - handleReject: toast.error() for stale data and errors on lines 70, 80
✅ Pattern matches other approval components (solution-approval-actions.tsx)
✅ Fix addresses original symptom: users now receive visual feedback when rejecting/approving

files_changed: ['src/components/approvals/approval-actions.tsx']

## Follow-up Issue

After implementing toast notifications, user reported that toast shows correctly but modal doesn't close and table doesn't refresh.

**Additional Evidence:**
- Toast notification working (first fix successful)
- Modal staying open after rejection
- Table not refreshing after rejection

**Additional Root Cause:**
The onSuccess callback in RequestDetailModal was calling `loadRequest()` to reload data, but this doesn't close the modal. The modal needs to be explicitly closed by calling `handleOpenChange(false)`.

**Additional Fix:**
Changed the onSuccess callback in request-detail-modal.tsx (line 463-466) from:
```tsx
onSuccess={() => {
  actionPerformedRef.current = true
  loadRequest()
}}
```

To:
```tsx
onSuccess={() => {
  actionPerformedRef.current = true
  handleOpenChange(false)
}}
```

This properly:
- Sets the action performed flag
- Closes the modal
- Triggers onActionComplete callback (which refreshes the parent table)

**Commits:**
- 2140186: Added toast notifications
- ddf91f6: Fixed modal close and table refresh
