# Next Steps for UI Replacement Implementation

## 🎯 Current Status: ~45% Complete

The foundation is solid! Core infrastructure, data adapters, permission checks, and dashboard integration are complete. The new modal system is working for viewing and approving/rejecting requests.

---

## 📋 Immediate Next Steps (Priority Order)

### 1. Complete Server Action Handlers in Modal Router

**File:** `src/components/requests/request-modal-router.tsx`

Add handlers for:
- **Submit Solution** (when engineering clicks button in CompletedRequestModal)
- **Submit Final Approval** (when requester dept clicks button in CompletedSolutionModal)
- **Resubmit Request** (when requester resubmits rejected request)
- **Resubmit Solution** (when engineering resubmits rejected solution)
- **Restart Final Approval** (when requester dept restarts rejected final approval)

**Server actions to import:**
```typescript
import { submitSolution } from '@/server-actions/solutions'
import { initiateFinalApproval } from '@/server-actions/final-approvals'
import { resubmitRequest } from '@/server-actions/requests'
```

### 2. Fetch Available Users for Custom Hierarchy

**File:** `src/components/requests/request-modal-router.tsx`

Currently passing empty array `[]` for `availableUsers` prop. Need to:
- Fetch users from the requester's department
- Filter by appropriate levels
- Pass to modals that support custom approval hierarchy

**Server action to use:**
```typescript
import { getUsersForCustomHierarchy } from '@/server-actions/users'
```

### 3. Update Engineering Dashboard

**Files to modify:**
- `src/components/engineering/needs-action-list.tsx`
- `src/components/engineering/engineering-dashboard-tabs.tsx`

**Changes needed:**
- Add click handlers to request cards
- Open `RequestModalRouter` instead of old modal
- Pass request ID and action completion callback
- Test "Submit Solution" button visibility for engineering users

### 4. Test End-to-End Workflows

**Test with users from `test_users.md`:**

#### Workflow 1: Request Approval
1. Login as `pd1@example.com` (Production L1)
2. Create new request
3. Login as `pd2@example.com` (Production L2)
4. Approve request
5. Verify status changes to "SentToEngineer"

#### Workflow 2: Solution Submission
1. Login as `eng1@example.com` (Engineering L1)
2. Open request in "SentToEngineer" status
3. Click "Submit Solution" button
4. Fill cost, timeline, files
5. Submit and verify status changes

#### Workflow 3: Rejection & Resubmit
1. Login as approver
2. Reject a request with reason
3. Login as original requester
4. Verify resubmit modal appears
5. Edit and resubmit
6. Verify back in approval flow

#### Workflow 4: Final Approval
1. Complete solution approval
2. Login as requester department user
3. Click "Submit Final Approval"
4. Choose standard or custom hierarchy
5. Submit and verify final approval starts

### 5. Mobile Testing

**Test on mobile viewport:**
- Resize browser to mobile width (375px)
- Test all modal interactions
- Verify drawer gestures work
- Check button layouts don't overflow
- Test file upload on mobile

### 6. Fix Any Issues Found

Based on testing, fix:
- Permission check bugs
- Data transformation errors
- UI/UX issues
- Server action integration problems

---

## 🔧 Code Snippets for Quick Implementation

### Add Submit Solution Handler

```typescript
const handleSubmitSolution = async (data: {
  title: string
  description: string
  cost: number
  timeline?: string
  files: File[]
}) => {
  if (isSubmitting) return
  setIsSubmitting(true)
  
  try {
    const result = await submitSolution(requestId, data)
    
    if (result.success) {
      toast.success('Solution submitted successfully')
      handleClose()
      router.refresh()
    } else {
      toast.error(result.message || 'Failed to submit solution')
    }
  } catch (error) {
    console.error('Submit solution error:', error)
    toast.error('An error occurred while submitting solution')
  } finally {
    setIsSubmitting(false)
  }
}
```

### Add Submit Final Approval Handler

```typescript
const handleSubmitFinalApproval = async (data: {
  useCustomHierarchy: boolean
  customApprovers?: string[]
}) => {
  if (isSubmitting) return
  setIsSubmitting(true)
  
  try {
    const result = await initiateFinalApproval(requestId, data)
    
    if (result.success) {
      toast.success('Final approval initiated')
      handleClose()
      router.refresh()
    } else {
      toast.error(result.message || 'Failed to initiate final approval')
    }
  } catch (error) {
    console.error('Final approval error:', error)
    toast.error('An error occurred')
  } finally {
    setIsSubmitting(false)
  }
}
```

---

## 📊 Progress Checklist

- [x] Data adapter layer
- [x] Permission check utilities
- [x] Modal router component
- [x] API endpoint for user department
- [x] Dashboard table integration
- [x] Approve/reject server actions
- [ ] Submit solution handler
- [ ] Submit final approval handler
- [ ] Resubmit handlers
- [ ] Fetch available users
- [ ] Engineering dashboard integration
- [ ] Mobile testing
- [ ] End-to-end workflow testing
- [ ] Bug fixes
- [ ] Cleanup old components

---

## 🎉 When Complete

After all steps are done:

1. **Remove old components:**
   - `src/components/requests/request-detail-modal.tsx`
   - Any other deprecated modal components

2. **Update documentation:**
   - Update README with new modal system
   - Document permission matrix
   - Add workflow diagrams

3. **Deploy to staging:**
   - Test with real users
   - Gather feedback
   - Make final adjustments

4. **Production deployment:**
   - Backup database
   - Deploy new UI
   - Monitor for issues

---

## 💡 Tips for Testing

1. **Use browser DevTools:**
   - Network tab to verify API calls
   - Console for error messages
   - React DevTools to inspect component state

2. **Test edge cases:**
   - What if user has no department?
   - What if request has no approvals?
   - What if solution has no files?

3. **Test permissions thoroughly:**
   - Try accessing actions you shouldn't have
   - Verify buttons hide/show correctly
   - Test with different user levels

4. **Test data refresh:**
   - After approve/reject, verify data updates
   - Check if other users see changes
   - Test concurrent actions

---

## 🚨 Known Limitations

1. **Loading States:** Modal router doesn't show loading skeleton yet
2. **Optimistic Updates:** No optimistic UI updates implemented
3. **Error Recovery:** Limited error recovery mechanisms
4. **Offline Support:** No offline capability

These can be addressed in future iterations if needed.

---

## 📞 Need Help?

If you encounter issues:

1. Check `IMPLEMENTATION_STATUS.md` for what's been done
2. Review `UI_REPLACEMENT_SUMMARY.md` for architecture overview
3. Check server action return types in `src/server-actions/`
4. Verify modal prop types in `src/components/requests/`
5. Test with different users from `test_users.md`

The foundation is solid - just need to wire up the remaining handlers and test thoroughly!
