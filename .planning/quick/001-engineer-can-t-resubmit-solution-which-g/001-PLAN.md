# Plan: Fix Engineer Resubmit Solution Button

## Issue
When an engineer clicks the orange "Resubmit Solution" button on a rejected solution, nothing happens. The button click handler is not triggering the resubmission modal.

## Root Cause Analysis
1. The "Resubmit Solution" button exists in `solution-modal.tsx` (line 599-608)
2. When clicked, it calls `onResubmit` prop
3. In `request-modal-router.tsx`, `onResubmit` is set to `() => setShowResubmitSolutionModal(true)` (line 460)
4. This should open a resubmit modal that's rendered outside the switch statement (lines 800-845)
5. However, there's a duplicate `case 'resubmit-solution':` at lines 634-653 that does nothing but log to console
6. The router might be routing to this case instead of letting the solution modal handle the button click

## Tasks

### Task 1: Remove duplicate 'resubmit-solution' case that does nothing
**File:** `src/components/requests/request-modal-router.tsx`
**Lines:** 634-653
**Action:** Remove the duplicate `case 'resubmit-solution':` block that's interfering with the proper flow

### Task 2: Verify the resubmission modal is properly connected
**File:** `src/components/requests/request-modal-router.tsx`
**Lines:** 800-845
**Action:** Ensure the standalone resubmission modal (triggered by `showResubmitSolutionModal` state) has all the necessary props and handlers

## Expected Outcome
- Engineer clicks "Resubmit Solution" button
- Resubmission modal opens with existing solution data
- Engineer can modify the solution and resubmit
- Solution is updated with new approval flow

## Verification
1. Open a rejected solution in the modal
2. Click the "Resubmit Solution" button
3. Verify the resubmission modal appears
4. Verify the modal contains the existing solution data
5. Test resubmitting with updated data
