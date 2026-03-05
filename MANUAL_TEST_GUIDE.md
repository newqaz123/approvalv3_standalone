# Manual Testing Guide for New Modal System

## 🎯 Purpose
This guide helps you manually test the new modal system to verify all workflows work correctly.

## 📋 Prerequisites
1. Development server running: `npm run dev`
2. Database seeded with test users from `test_users.md`
3. Browser ready for testing

---

## ✅ Test 1: Request Approval Workflow

### Step 1: Create Request (Production L1)
1. Login as `pd1@example.com` / `changeme`
2. Go to Dashboard
3. Click "New Request" button
4. Fill form:
   - Title: "Test Request - Modal System"
   - Description: "Testing new modal system"
5. Click "Submit Request"
6. **Expected**: Success toast, request appears in dashboard

### Step 2: View Request as Requester
1. Click on the request you just created
2. **Expected**: Modal opens showing request details
3. **Expected**: Read-only view (no approve/reject buttons for own request)
4. Close modal

### Step 3: Approve Request (Production L2)
1. Logout and login as `pd2@example.com` / `changeme`
2. Go to Dashboard → "Pending Approvals" tab
3. Click on the test request
4. **Expected**: ApproverModal opens with:
   - Request details visible
   - "Approve" button visible
   - "Reject" button visible
   - Approval stages shown
   - Activity timeline shown
5. Click "Approve"
6. Add comment (optional): "Approved for testing"
7. Click "Confirm"
8. **Expected**: Success toast "Approved successfully"
9. **Expected**: Modal closes, data refreshes

### Step 4: Verify Status Change
1. Refresh dashboard
2. Find the request
3. **Expected**: Status changed to "SentToEngineer"

---

## ✅ Test 2: Solution Submission Workflow

### Step 1: View Request as Engineering
1. Logout and login as `eng1@example.com` / `changeme`
2. Go to Engineering Dashboard
3. Find request in "Requests Awaiting Solution"
4. Click on the request
5. **Expected**: CompletedRequestModal opens with:
   - Request details
   - "Submit Solution" button visible
   - Approval stages completed
   - Activity timeline

### Step 2: Submit Solution
1. Click "Submit Solution" button
2. **Expected**: Navigate to solution submission page
3. Fill form:
   - Title: "Test Solution"
   - Description: "Solution for testing"
   - Cost Estimate: 50000
   - Currency: THB
   - Timeline: "2 weeks"
4. Click "Submit Solution"
5. **Expected**: Success toast, redirect to engineering dashboard

### Step 3: Approve Solution (Engineering L2)
1. Logout and login as `eng2@example.com` / `changeme`
2. Go to Engineering Dashboard
3. Find solution in "Solutions Awaiting Your Approval"
4. Click "Review & Approve"
5. **Expected**: ApproverModal opens in solution mode with:
   - Request details
   - Solution details (cost, timeline)
   - "Approve" and "Reject" buttons
6. Click "Approve"
7. Add comment: "Solution looks good"
8. Click "Confirm"
9. **Expected**: Success toast, status changes to "SendBackToRequester"

---

## ✅ Test 3: Final Approval Workflow

### Step 1: View Completed Solution
1. Logout and login as `pd1@example.com` / `changeme`
2. Go to Dashboard
3. Find the request (status: SendBackToRequester)
4. Click on it
5. **Expected**: CompletedSolutionModal opens with:
   - Request details
   - Solution details with cost
   - "Submit Final Approval" button visible
   - All approval stages shown

### Step 2: Submit Final Approval
1. Click "Submit Final Approval"
2. **Expected**: SubmitFinalApprovalModal opens
3. Choose "Standard Hierarchy" or "Custom Hierarchy"
4. Click "Submit"
5. **Expected**: Success toast "Final approval initiated successfully"
6. **Expected**: Status changes to "FinalApprovalInProgress"

### Step 3: Approve Final Approval
1. Logout and login as approver (e.g., `pd2@example.com`)
2. Go to Dashboard → "Pending Approvals"
3. Find the request
4. Click on it
5. **Expected**: ApproverModal opens in final approval mode
6. Click "Approve"
7. Add comment: "Final approval granted"
8. Click "Confirm"
9. **Expected**: Success toast, status changes to "Completed"

---

## ✅ Test 4: Rejection and Resubmit Workflow

### Step 1: Create and Reject Request
1. Login as `pd1@example.com` / `changeme`
2. Create new request: "Test Rejection"
3. Logout and login as `pd2@example.com` / `changeme`
4. Go to Dashboard → "Pending Approvals"
5. Click on "Test Rejection" request
6. Click "Reject"
7. Fill rejection reason: "Needs more details about cost"
8. Click "Confirm"
9. **Expected**: Success toast "Rejected successfully"

### Step 2: Resubmit as Requester
1. Logout and login as `pd1@example.com` / `changeme`
2. Go to Dashboard → "My Requests"
3. Click on rejected request
4. **Expected**: RequestResubmitModal opens with:
   - Rejection reason displayed
   - Rejected by name shown
   - Rejection date shown
   - Editable title and description
   - "Resubmit" button
5. Edit description: "Updated with cost details: 100,000 THB"
6. Click "Resubmit"
7. **Expected**: Success toast "Request resubmitted successfully"
8. **Expected**: Request back in approval flow

---

## ✅ Test 5: Permission Checks

### Test 5.1: Engineering Cannot Approve Production Requests
1. Login as `eng1@example.com` / `changeme`
2. Go to Dashboard
3. Click on any production request
4. **Expected**: Modal opens in read-only mode
5. **Expected**: NO "Approve" or "Reject" buttons visible

### Test 5.2: Production Cannot Submit Solutions
1. Login as `pd1@example.com` / `changeme`
2. Try to access `/engineering/solutions/[requestId]`
3. **Expected**: Access denied or redirect

### Test 5.3: Only Requester Department Can Submit Final Approval
1. Login as engineering user
2. Find request with status "SendBackToRequester"
3. Click on it
4. **Expected**: NO "Submit Final Approval" button visible

---

## ✅ Test 6: Mobile Responsiveness

### Step 1: Resize Browser
1. Resize browser to mobile width (375px)
2. Login and navigate to dashboard
3. **Expected**: Mobile card view appears instead of table

### Step 2: Test Mobile Modal
1. Click on a request card
2. **Expected**: Modal opens and is responsive
3. **Expected**: All buttons are accessible
4. **Expected**: Content doesn't overflow

---

## 📊 Checklist

- [ ] Request creation works
- [ ] ApproverModal shows for approvers with correct buttons
- [ ] Approve action works with toast notification
- [ ] Reject action works with toast notification
- [ ] CompletedRequestModal shows "Submit Solution" button for engineering
- [ ] Solution submission works
- [ ] Solution approval works
- [ ] CompletedSolutionModal shows "Submit Final Approval" button
- [ ] Final approval submission works
- [ ] Final approval approval works
- [ ] CompletedFinalModal shows for completed requests
- [ ] RequestResubmitModal shows for rejected requests
- [ ] Resubmit action works
- [ ] Permission checks prevent unauthorized actions
- [ ] Engineering users cannot approve production requests
- [ ] Production users cannot submit solutions
- [ ] Mobile view works correctly
- [ ] All modals close properly (ESC key, X button, outside click)
- [ ] Data refreshes after actions

---

## 🐛 Common Issues to Check

1. **Modal doesn't open**: Check browser console for errors
2. **Buttons not visible**: Check user permissions and department
3. **Actions fail**: Check network tab for API errors
4. **Data doesn't refresh**: Check if `onActionComplete` callback is working
5. **Toast doesn't appear**: Check if Sonner toast provider is set up

---

## 📸 Visual Verification

For each modal type, verify:
- ✅ Beautiful, modern design
- ✅ Proper spacing and layout
- ✅ Icons display correctly
- ✅ Colors match design system
- ✅ Animations are smooth
- ✅ No layout shifts
- ✅ Text is readable
- ✅ Buttons are clearly labeled

---

## 🎉 Success Criteria

All tests pass when:
1. All workflows complete without errors
2. Permissions are enforced correctly
3. Modals display beautifully on desktop and mobile
4. Toast notifications appear for all actions
5. Data refreshes after actions
6. No console errors
7. User experience is smooth and intuitive

---

## 📝 Notes

- Test with different screen sizes
- Test with keyboard navigation (Tab, Enter, Escape)
- Test with screen readers if possible
- Verify all text is clear and helpful
- Check loading states if network is slow

Good luck with testing! 🚀
