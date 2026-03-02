# Verification Steps for Rejection Flow UI Fixes

## Issue Summary
Fixed three rejection flow UI issues:
1. Dashboard rejection badges not displaying
2. No UI refresh after clicking Reject button
3. Missing Edit & Resubmit functionality

## Changes Made

### 1. Dashboard Table Data Sync (dashboard-table.tsx)
- **Problem**: Component used `useState` without syncing to prop changes
- **Fix**: Added `useEffect` to update state when `initialData` prop changes
- **Lines**: 51-57

### 2. Dashboard Rejection Badge Rendering (dashboard-table.tsx)
- **Problem**: Rejection badge never rendered in dashboard columns
- **Fix**: Imported `RejectedBadge` and added conditional rendering in Title column
- **Lines**: 27 (import), 116-120 (rendering)

### 3. Resubmit Functionality (multiple files)
- **Created**: `ResubmitRequestDialog` component for editing and resubmitting
- **Added**: Edit & Resubmit section in request detail modal
- **Created**: `resubmitRequest` server action with validation

## Manual Verification Steps

### Test 1: Dashboard Rejection Badge Display
1. Navigate to http://localhost:3000/dashboard
2. Ensure you have a request with rejected approvals
3. **Verify**: Red rejection badge (X icon) appears next to request title in:
   - "Pending My Approval" tab (if applicable)
   - "My Requests" tab (if you're the requester)
   - "All Requests" tab
4. **Expected**: Badge shows on ALL dashboard tabs for rejected requests

### Test 2: Modal Rejection Badge and Status
1. Click on a request that has been rejected
2. **Verify**: Modal header shows both status badge AND rejection badge
3. **Expected**: Two badges visible in header description area

### Test 3: Reject Button UI Refresh
1. Find a pending request you can approve
2. Click "Reject" button
3. Enter rejection reason and confirm
4. **Verify**:
   - Modal updates immediately (shows rejection in approval progress)
   - Buttons are grayed out/disabled
   - No need to manually close and reopen modal
5. Close modal and check dashboard
6. **Verify**: Rejection badge now appears next to that request
7. **Expected**: Full UI refresh without manual page reload

### Test 4: Edit & Resubmit Button Visibility
1. As a requester, open a request that has been rejected
2. **Verify**: Yellow/amber alert box appears with:
   - "Request Rejected" heading
   - Explanation text
   - "Edit & Resubmit" button
3. **Conditions that must be met**:
   - Current user IS the requester
   - Request has at least one rejected approval
   - Request status is "ImprovementRequest"
4. **Expected**: Button only shows when ALL conditions met

### Test 5: Edit & Resubmit Workflow
1. Click "Edit & Resubmit" button
2. **Verify**: Dialog opens with:
   - Current title pre-filled
   - Current description pre-filled
   - Both fields are editable
   - Clear explanation of what will happen
3. Edit the title and/or description
4. Click "Resubmit Request"
5. **Verify**:
   - Dialog closes
   - Modal updates automatically
   - Request no longer shows rejection badge
   - Approval progress shows fresh pending approvals
   - Activity timeline shows "resubmitted" entry
6. Close modal and check dashboard
7. **Verify**: Rejection badge is GONE from dashboard (fresh start)
8. **Expected**: Complete reset of approval chain

### Test 6: Resubmit Authorization & Validation
1. Try to access resubmit on someone else's rejected request
2. **Expected**: Button does NOT appear (requester-only)
3. Try resubmit with empty title
4. **Expected**: Validation error shown
5. Try resubmit with title > 200 chars
6. **Expected**: Validation error shown
7. Try resubmit with empty description
8. **Expected**: Validation error shown

### Test 7: Dashboard Auto-Refresh Integration
1. Open dashboard
2. In another tab, reject a request
3. Wait 30 seconds (auto-refresh interval)
4. **Verify**: Dashboard updates and shows rejection badge
5. **Alternative**: Click manual refresh button
6. **Expected**: Immediate update with rejection badge

### Test 8: Activity Timeline
1. Resubmit a rejected request
2. Open the request modal
3. Scroll to Activity Timeline
4. **Verify**: "Resubmitted" activity entry appears with:
   - User who resubmitted
   - Timestamp
   - "Request resubmitted after rejection" comment
5. **Expected**: Clear audit trail of resubmission

## Expected Results Summary

✅ Rejection badges appear on all dashboard tabs
✅ Modal refreshes immediately after rejection
✅ Edit & Resubmit button appears for requesters with rejected requests
✅ Resubmit workflow allows editing title/description
✅ Resubmit clears all approvals and starts fresh
✅ Dashboard auto-refresh shows updated data
✅ Authorization prevents non-requesters from resubmitting
✅ Validation prevents invalid data

## Rollback Instructions

If issues are found, revert with:
```bash
git revert HEAD
```

Or manually revert these files:
- src/components/dashboard/dashboard-table.tsx
- src/components/requests/request-detail-modal.tsx
- src/components/requests/resubmit-request-dialog.tsx (delete)
- src/server-actions/requests.ts (remove resubmitRequest function)
