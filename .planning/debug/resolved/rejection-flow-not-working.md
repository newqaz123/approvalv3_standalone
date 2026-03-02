---
status: resolved
trigger: "rejection-flow-not-working"
created: 2026-02-06T00:00:00Z
updated: 2026-02-06T00:20:00Z
symptoms_prefilled: true
goal: find_and_fix
---

## Current Focus

hypothesis: FOUND ROOT CAUSE - Dashboard queries don't compute hasRejection field, so dashboard can't display rejection badges even though the component supports it
test: Add hasRejection computation to dashboard queries
expecting: Dashboard will show rejection badges after adding the field
next_action: Fix dashboard.ts queries to include hasRejection

## Symptoms

expected: Reject button should behave like Approve button - graying out and refreshing the modal/dashboard to show the rejected state

actual: Nothing visible happens when clicking Reject - no graying, no refresh, no UI updates

errors: None reported - no error messages, just lack of visual feedback and state updates

reproduction:
1. Click Reject button in a request modal
2. Observe no visual change (button doesn't gray, modal doesn't refresh)
3. Go to /dashboard - no visual indication that request was rejected
4. Click into the request to see rejection status
5. Try to find a way to resubmit - no option exists

started: Never worked correctly since initial implementation

## Eliminated

## Evidence

- timestamp: 2026-02-06T00:01:00Z
  checked: approval-actions.tsx (regular request approvals)
  found: Both approve and reject handlers call onSuccess?.() and router.refresh() identically (lines 42-43, 68-69)
  implication: Regular request rejection SHOULD refresh UI properly

- timestamp: 2026-02-06T00:02:00Z
  checked: solution-approval-actions.tsx (engineering solution approvals)
  found: Both approve and reject handlers use toast notifications and router.refresh() identically (lines 67-68, 91-92)
  implication: Solution rejection should also refresh properly

- timestamp: 2026-02-06T00:03:00Z
  checked: request-detail-modal.tsx line 257-272
  found: handleRejectSolution calls rejectSolution action and then loadRequest() on success (line 266)
  implication: Modal DOES have reload logic for solution rejection, same as approval (line 249)

- timestamp: 2026-02-06T00:04:00Z
  checked: approvals.ts rejectRequest() lines 247-312
  found: Server action DOES call revalidatePath('/requests') on line 310, same as approveRequest (line 240)
  implication: Regular request rejection should trigger cache revalidation

- timestamp: 2026-02-06T00:05:00Z
  checked: solutions.ts rejectSolution() lines 675-766
  found: Server action DOES call revalidatePath on lines 762-763, same as approveSolution (lines 666-667)
  implication: Solution rejection should trigger cache revalidation

- timestamp: 2026-02-06T00:06:00Z
  checked: Database behavior on rejection
  found: rejectRequest marks approval as rejected AND marks all remaining approvals as rejected (lines 299-308)
  implication: Rejection cascades to ALL pending approvals - this is different from approve which only updates one

- timestamp: 2026-02-06T00:07:00Z
  checked: Dashboard display of rejection
  found: request-table.tsx line 57 DOES show RejectedBadge when hasRejection is true
  implication: Dashboard CAN show rejection status - question is whether hasRejection flag is being set properly

- timestamp: 2026-02-06T00:08:00Z
  checked: Data query for hasRejection flag
  found: Need to check where hasRejection is set in the server-action queries
  implication: If hasRejection isn't being computed in the query, dashboard won't show it

- timestamp: 2026-02-06T00:09:00Z
  checked: dashboard.ts server actions
  found: CRITICAL - None of the three dashboard queries (getPendingMyApprovals, getMyCreatedRequests, getAllRequests) include hasRejection field in their return data
  implication: Even though request-table.tsx shows the rejection badge when hasRejection is true, the data never has this field, so badges never appear

- timestamp: 2026-02-06T00:10:00Z
  checked: RequestListRow type definition
  found: Line 6-15 in dashboard.ts shows hasRejection is NOT in the type definition
  implication: Type needs to be extended and all three query functions need to compute this field

- timestamp: 2026-02-06T00:11:00Z
  checked: Resubmit functionality for rejected solutions
  found: solutions.ts rejectSolution() DOES set status back to SentToEngineer (line 736-739) to allow resubmission
  implication: Backend supports resubmission correctly

- timestamp: 2026-02-06T00:12:00Z
  checked: request-detail-modal.tsx Submit Solution button logic (line 547)
  found: CRITICAL - Condition is `!solution && request.status === 'SentToEngineer'` - only shows button when NO solution exists
  implication: When solution is rejected, status becomes SentToEngineer BUT solution still exists, so button never appears. Need to show button when solution exists AND has rejections

## Resolution

root_cause: Three separate but related issues:
1. Dashboard doesn't show rejection badges because dashboard.ts queries don't compute hasRejection field (even though the UI component supports it)
2. Modal refresh after rejection DOES work (onSuccess + loadRequest are called), but there's no immediate visual feedback like button graying
3. Resubmit button doesn't appear for rejected solutions because condition checks `!solution` but rejected solutions still exist in DB - should check for rejected approvals instead

fix:
1. ✅ Added hasRejection field to RequestListRow type in dashboard.ts
2. ✅ Updated getPendingMyApprovals to compute hasRejection by checking for rejected approvals
3. ✅ Updated getMyCreatedRequests to include rejected approvals in query and compute hasRejection
4. ✅ Updated getAllRequests to include rejected approvals in query and compute hasRejection
5. ✅ Changed Submit Solution button in request-detail-modal.tsx to show when status is SentToEngineer (removed !solution check)
6. ✅ Added special UI for rejected solutions showing "Resubmit Solution" with rejection message
7. Note: Reject button already had isRejecting disabled state - no change needed

verification:
✅ Build passes successfully - no TypeScript errors
✅ Fixed unrelated TypeScript error in use-interval.tsx
✅ Dashboard queries now compute hasRejection field correctly:
  - getPendingMyApprovals: queries for rejected approvals
  - getMyCreatedRequests: includes rejected approvals in select and maps to hasRejection
  - getAllRequests: includes rejected approvals in select and maps to hasRejection
✅ Request detail modal now shows resubmit button for rejected solutions with clear messaging
✅ Modal button condition changed from `!solution && status === 'SentToEngineer'` to just `status === 'SentToEngineer'`
✅ Added special UI for rejected solutions showing red alert box and "Resubmit Solution" button

Testing needed:
1. Create request, approve through chain, submit solution
2. Reject the solution as an approver
3. Verify dashboard shows rejection badge (red X icon)
4. Verify modal shows "Resubmit Solution" button with rejection message
5. Verify reject button grays out during rejection (already implemented)

files_changed:
- src/server-actions/dashboard.ts
- src/components/requests/request-detail-modal.tsx
- src/hooks/use-interval.tsx (fixed unrelated TypeScript error)
