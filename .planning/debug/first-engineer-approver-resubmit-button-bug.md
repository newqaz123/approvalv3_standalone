# Bug Fix: First Engineer Approver Seeing Resubmit Button Instead of Approve/Reject

## Issue
When a final approval is rejected and status changes to `SentToEngineer`, the First Engineer approver opens the modal and sees "Resubmit Solution" button instead of approve/reject buttons.

## Root Cause
In `request-modal-router.tsx` line 470, the status was set to `'solution_rejected'` for ALL users when there was any rejection:
```typescript
status: (hasSolutionRejection || hasFinalRejection) ? 'solution_rejected' : 'solution',
```

The solution modal only shows approve/reject buttons when `status === 'solution'` (line 820), so approvers were seeing the resubmit button instead.

## Fix
**Two changes were needed:**

1. **Line 470** - Changed status logic to only set `'solution_rejected'` for non-approvers:
```typescript
status: ((hasSolutionRejection || hasFinalRejection) && !canApprove) ? 'solution_rejected' : 'solution',
```

2. **Line 483** - Added status check to `onResubmit` callback to only show resubmit button when status is `SentToEngineer`:
```typescript
onResubmit={(!canApprove && requestData.status === 'SentToEngineer' && isEngineering && (hasSolutionRejection || hasFinalRejection)) ? () => {
  setShowResubmitSolutionModal(true)
} : undefined}
```

**Critical:** The resubmit button should ONLY show when:
- User is NOT an approver (`!canApprove`)
- Status is `SentToEngineer` (needs resubmission)
- User is from engineering department (`isEngineering`)
- There is a rejection in history

This prevents non-approver engineers from seeing the resubmit button when the solution is already in the approval process (`DesignCostEstimationApproval`).

Now:
- **Approvers** see status `'solution'` + no `onResubmit` callback → **only approve/reject buttons shown** ✅
- **Non-approvers** (engineers who need to resubmit) see status `'solution_rejected'` + `onResubmit` callback → **only resubmit button shown** ✅

## Expected Behavior After Fix

### Scenario 1: Solution Rejected, Needs Resubmission
1. Final approval gets rejected → status changes to `SentToEngineer`
2. **Engineering (non-approver)** opens modal → sees:
   - Rejection banner with "Resubmit Solution" button ✅
   - Solution details
   - NO approve/reject buttons ✅

### Scenario 2: Solution Resubmitted, In Approval Process
3. Engineering resubmits solution → status changes to `DesignCostEstimationApproval`
4. **First Engineer approver** opens modal → sees:
   - Rejection banner (informational only, NO button) ✅
   - Solution details
   - **Approve/Reject buttons** at bottom ✅
5. **Other Engineering (non-approver)** opens modal → sees:
   - Rejection banner (informational only, NO button) ✅
   - Solution details
   - NO approve/reject buttons ✅
   - NO resubmit button ✅ (because status is DesignCostEstimationApproval, not SentToEngineer)

## Test Scenario
1. Create a request that goes through full workflow
2. Reject at final approval stage
3. Verify engineering sees resubmit button
4. Resubmit the solution
5. Log in as First Engineer approver
6. Open the modal
7. **Verify**: Should see approve/reject buttons, NOT resubmit button

## Files Changed
- `/src/components/requests/request-modal-router.tsx` (line 470)
