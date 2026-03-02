# Phase 3: Approval Engine - Complete Testing Guide

## Phase 3 Scope

This guide covers **ALL Phase 3 features**:

- **Phase 3.1**: Core Approval Logic (Tests 1-12)
- **Phase 3.2**: Request Cancellation & Hierarchy Management (Tests 13-24)

---

## Quick Test Checklist

For **rapid testing**, start with these high-priority tests:

### Core Approval Flow (Phase 3.1)
- [ ] **Test 1**: Level 1 user creates request - verifies approval chain creation
- [ ] **Test 2**: Mid-level approval - verifies sequential approval
- [ ] **Test 3**: Top-level approval - verifies status change to SentToEngineer
- [ ] **Test 4**: Top-level user auto-approve - verifies skip logic
- [ ] **Test 6**: Rejection flow - verifies chain stops on rejection

### Cancellation (Phase 3.2) ⭐ NEW
- [ ] **Test 13**: Requester cancels own request - verifies cancellation workflow
- [ ] **Test 14**: Cancel button visibility - verifies access control

### Hierarchy Management (Phase 3.2) ⭐ NEW
- [ ] **Test 16**: Hierarchy view navigation - verifies admin can view hierarchy
- [ ] **Test 17**: Drag-and-drop UI - verifies visual interface
- [ ] **Test 18**: Hierarchy blocking - verifies pending approval validation
- [ ] **Test 19**: Database persistence - verifies level changes save

**Time estimate**: ~30-45 minutes for core tests

For **comprehensive testing**, complete all 24 tests in this guide.

## ⚠️ Pre-Test Setup

### 1. Ensure Database is Updated
```bash
# Check database is synced with schema
npx prisma db push

# Regenerate Prisma Client
npx prisma generate
```

### 2. Setup User Levels and Names
```bash
# Assign approval levels and descriptive names to all users
npx tsx scripts/assign-user-levels-manual.ts
```

**Expected Output:**
```
✅ patawatnew@hotmail.com    → Level 5 | Admin (QC Level 5)
✅ test01@gmail.com          → Level 2 | QC Level 2
✅ test02@gmail.com          → Level 1 | QC Level 1
✅ userpd1@gmail.com         → Level 3 | PD1 Level 3
✅ userpd1_1@gmail.com       → Level 2 | PD1 Level 2
✅ enguser01@gmail.com       → Level 3 | Engineering Level 3

Final Configuration:
  Quality Control:
    Level 5: Admin (QC Level 5)
    Level 2: QC Level 2
    Level 1: QC Level 1

  Production Department 1:
    Level 3: PD1 Level 3
    Level 2: PD1 Level 2

  Engineering:
    Level 3: Engineering Level 3
```

### 3. Verify Setup
```bash
# Open Prisma Studio
npx prisma studio

# Check:
# 1. users table → all users have 'level' field populated
# 2. request_approvals table exists
# 3. notifications table exists
```

---

## What Was Built in Phase 3.1

### Level-Based Approval System ✅
- Automatic approval chain creation based on submitter's level
- Approvals start at (submitter level + 1)
- Sequential approvals: Level 1 → 2 → 3 → ... → Top
- Any one person at each level can approve
- Top-level submitters auto-approve (immediate status change)
- Status changes only when top-level approves

### Approval UI Components ✅
- Approval progress visualization
- Approve/Reject action buttons
- Approval history with timestamps and comments
- Real-time approval status updates

### Status Flow ✅
```
ImprovementRequest → SentToEngineer → SendBackToRequester → Completed
```

---

## Test User Reference

| Email | Password | Name | Department | Level |
|-------|----------|------|------------|-------|
| patawatnew@hotmail.com | warfuf-batno6-fimQoc | Admin (QC Level 5) | Quality Control | 5 |
| test01@gmail.com | pafdy2-mybsiq-vUrgiv | QC Level 2 | Quality Control | 2 |
| test02@gmail.com | [password] | QC Level 1 | Quality Control | 1 |
| userpd1@gmail.com | [password] | PD1 Level 3 | Production Dept 1 | 3 |
| userpd1_1@gmail.com | [password] | PD1 Level 2 | Production Dept 1 | 2 |
| enguser01@gmail.com | [password] | Engineering Level 3 | Engineering | 3 |

---

## Test Suite

### Test 1: Level 1 User Creates Request (Full Approval Chain) ⭐

**Objective:** Verify approval chain creation and sequential approvals

**Login as:** test02@gmail.com (Level 1, QC Dept)

**Steps:**
1. Navigate to http://localhost:3005/requests/new
2. Create request:
   - Title: "Test: Level 1 User - Full Chain"
   - Description: "Testing approval chain from Level 1"
3. Click "Create Request"
4. Navigate to `/requests` and click on the new request

**Expected Results:**
- ✅ Request created successfully
- ✅ Status: `ImprovementRequest`
- ✅ Approval Progress shows:
  ```
  Level 2 Approval - Pending ⏳
  Level 5 Approval - Pending ⏳
  ```
- ✅ No "Your Approval Needed" section (can't approve own request)
- ✅ Activity log shows "Request created"

**Database Verification:**
```sql
-- Check approval records created
SELECT * FROM request_approvals
WHERE "requestId" = '[request-id]'
ORDER BY "order" ASC;

-- Should show:
-- order=1, requiredLevel=2, status=pending
-- order=2, requiredLevel=5, status=pending
```

---

### Test 2: Mid-Level Approval (Level 2)

**Objective:** Verify mid-level user can approve and chain progresses

**Login as:** test01@gmail.com (Level 2, QC Dept)

**Steps:**
1. Navigate to `/requests`
2. Click on the request from Test 1
3. Verify "Your Approval Needed" section appears
4. Add comment: "Approved by Level 2 user"
5. Click "Approve" button
6. Wait for page refresh

**Expected Results:**
- ✅ Success message appears
- ✅ Approval Progress updates:
  ```
  Level 2 Approval - Approved ✅
    test01@gmail.com
    "Approved by Level 2 user"
    [timestamp]

  Level 5 Approval - Pending ⏳
  ```
- ✅ Status still: `ImprovementRequest` (waiting for Level 5)
- ✅ Activity log shows approval action
- ✅ "Your Approval Needed" section disappears

**Database Check:**
```sql
SELECT * FROM request_approvals
WHERE "requestId" = '[request-id]' AND "requiredLevel" = 2;

-- Should show: status=approved, approverId=[user-id], approvedAt=[timestamp]
```

---

### Test 3: Top-Level Approval (Status Change)

**Objective:** Verify top-level approval triggers status change

**Login as:** patawatnew@hotmail.com (Level 5, Admin)

**Steps:**
1. Navigate to `/requests`
2. Click on the same request
3. Verify "Your Approval Needed" section appears
4. Add comment: "Final approval - sending to Engineering"
5. Click "Approve"

**Expected Results:**
- ✅ Success message
- ✅ Approval Progress fully complete:
  ```
  Level 2 Approval - Approved ✅
  Level 5 Approval - Approved ✅
  ```
- ✅ **Status changes**: `ImprovementRequest` → `SentToEngineer`
- ✅ Status badge changes from blue to yellow
- ✅ Activity log shows:
  - "Approved at level 5"
  - "Status changed from ImprovementRequest to SentToEngineer"

**Database Check:**
```sql
-- Check request status changed
SELECT status FROM requests WHERE id = '[request-id]';
-- Should return: SentToEngineer

-- Check all approvals complete
SELECT status FROM request_approvals
WHERE "requestId" = '[request-id]';
-- All should be: approved
```

---

### Test 4: Top-Level User Creates Request (Auto-Approve)

**Objective:** Verify top-level users get auto-approval and immediate status change

**Login as:** patawatnew@hotmail.com (Level 5, Admin)

**Steps:**
1. Navigate to `/requests/new`
2. Create request:
   - Title: "Test: Top-Level User Auto-Approve"
   - Description: "Should skip ImprovementRequest status"
3. Click "Create Request"
4. Immediately view the request details

**Expected Results:**
- ✅ Request created
- ✅ **Status immediately**: `SentToEngineer` (skipped approval)
- ✅ Approval Progress shows:
  ```
  Level 5 Approval - Approved ✅
    patawatnew@hotmail.com
    "Auto-approved (top-level submitter)"
    [timestamp]
  ```
- ✅ Activity log shows:
  - "Request created"
  - "Auto-approved by top-level user"
  - "Status changed to SentToEngineer"

---

### Test 5: Level 2 User Creates Request (Partial Chain)

**Objective:** Verify approval chain starts at (user level + 1)

**Login as:** test01@gmail.com (Level 2, QC Dept)

**Steps:**
1. Create new request:
   - Title: "Test: Level 2 User - Partial Chain"
   - Description: "Should only need Level 5 approval"
2. View request details

**Expected Results:**
- ✅ Request created
- ✅ Status: `ImprovementRequest`
- ✅ Approval Progress shows ONLY:
  ```
  Level 5 Approval - Pending ⏳
  ```
- ✅ No Level 2 approval (submitter's level skipped)
- ✅ No Level 1 approval (below submitter)

**Login as:** patawatnew@hotmail.com (Level 5)
- Approve the request
- ✅ Status changes to `SentToEngineer`

---

### Test 6: Rejection Flow

**Objective:** Verify rejection stops approval chain

**Login as:** test02@gmail.com (Level 1, QC Dept)

**Steps:**
1. Create new request:
   - Title: "Test: Rejection Flow"
   - Description: "This will be rejected"

**Login as:** test01@gmail.com (Level 2, QC Dept)

**Steps:**
2. Open the request
3. Click "Reject" button
4. Add rejection reason: "Budget not approved - needs revision"
5. Click "Confirm Rejection"

**Expected Results:**
- ✅ Rejection recorded
- ✅ Approval Progress shows:
  ```
  Level 2 Approval - Rejected ❌
    test01@gmail.com
    "Budget not approved - needs revision"

  Level 5 Approval - Rejected ❌ (auto-rejected)
  ```
- ✅ Status remains: `ImprovementRequest`
- ✅ Activity log shows rejection
- ✅ All pending approvals marked as rejected
- ✅ No further approvals possible

**Database Check:**
```sql
SELECT status FROM request_approvals
WHERE "requestId" = '[request-id]';
-- All should be: rejected
```

---

### Test 7: Multiple Approvers at Same Level

**Objective:** Verify only ONE person at each level needs to approve

**Setup:** Ensure there are multiple users at Level 2 in QC Dept

**Login as:** test02@gmail.com (Level 1, QC Dept)

**Steps:**
1. Create new request

**Login as:** test01@gmail.com (Level 2 - User A)

**Steps:**
2. Open request
3. Verify "Your Approval Needed" appears
4. Approve the request

**Login as:** Another Level 2 user in QC Dept (User B)

**Steps:**
5. Open same request
6. Verify "Your Approval Needed" does NOT appear
7. Approval Progress shows User A already approved

**Expected Results:**
- ✅ User A can approve
- ✅ After User A approves, User B cannot approve
- ✅ Only ONE approval needed per level
- ✅ Moves to next level (Level 5)

---

### Test 8: Cross-Department Isolation

**Objective:** Verify approvals are department-specific

**Login as:** userpd1@gmail.com (Level 3, Production Dept 1)

**Steps:**
1. Create new request:
   - Title: "Test: Production Dept Request"
   - Description: "PD1 department request"

**Login as:** patawatnew@hotmail.com (Level 5, QC Dept)

**Steps:**
2. Navigate to `/requests`
3. Try to find the Production Dept request

**Expected Results:**
- ✅ If user is admin: Can see the request
- ✅ If user is not admin: Cannot see request (different department)
- ✅ QC users cannot approve Production requests
- ✅ Only Production Dept users can approve Production requests

---

### Test 9: Approval Progress UI Validation

**Objective:** Verify approval progress displays correctly

**Create a request with full approval chain (Level 1 user)**

**Check the Approval Progress section shows:**
- ✅ Vertical timeline layout
- ✅ Connecting lines between levels
- ✅ Status icons:
  - Clock ⏳ for pending
  - Checkmark ✅ for approved
  - X ❌ for rejected
- ✅ Level number (e.g., "Level 2 Approval")
- ✅ Approver info when approved:
  - Name
  - Email
  - Timestamp
- ✅ "Awaiting any Level X user" when pending
- ✅ Comments displayed in italics
- ✅ Status badges:
  - Green for approved
  - Red for rejected
  - Gray for pending

---

### Test 10: Approval Actions UI Validation

**Objective:** Verify approve/reject buttons work correctly

**When you CAN approve:**
- ✅ Blue box titled "Your Approval Needed"
- ✅ Information text about approval
- ✅ Comments textarea (optional)
- ✅ Green "Approve" button with checkmark icon
- ✅ Red "Reject" button with X icon

**Click "Reject":**
- ✅ Form changes to red rejection form
- ✅ Title: "Reject Request"
- ✅ Cancel button appears
- ✅ Comments textarea (required)
- ✅ "Confirm Rejection" button disabled until comment entered
- ✅ Validation: Cannot submit without comment

**When you CANNOT approve:**
- ✅ No approval actions section shown
- ✅ Only progress display visible

---

### Test 11: Activity Log Integration

**Objective:** Verify approval actions appear in activity log

**Create and approve a request through full chain**

**Check Activity History shows:**
- ✅ "Request created" entry
- ✅ "Approved" entry for each level
  - User name
  - Timestamp
  - Comments (if provided)
- ✅ "Status changed" entries
  - From status → To status
  - Auto-generated comment
- ✅ Chronological order (newest first)
- ✅ All actions by all users

**For rejected request:**
- ✅ "Rejected" entry with reason
- ✅ User name and timestamp

---

### Test 12: Engineering Department Visibility

**Objective:** Verify engineering users can see ALL requests for monitoring

**Purpose:** Engineering department needs visibility into all department requests for monitoring workflow progress across the organization.

**Prerequisites:** Multiple requests in various statuses from different departments

**Login as:** enguser01@gmail.com (Level 3, Engineering)

**Steps:**
1. Navigate to `/requests`
2. Check the request list
3. Verify you see requests from ALL departments
4. Verify you see requests in ALL statuses
5. Click on different requests to view details

**Expected Results:**
- ✅ Request list shows requests from ALL departments (QC, PD1, PD2, etc.)
- ✅ Request list shows ALL statuses (ImprovementRequest, SentToEngineer, Cancelled, etc.)
- ✅ Each request shows correct department name
- ✅ Each request shows current status badge
- ✅ Engineering user can view all request details
- ✅ Can filter by department, status, date, etc.

**What's NOT Working Yet (Expected for Phase 3):**
- ❌ Cannot submit engineering solutions (Phase 4 feature)
- ❌ No "Add Solution" button or form (coming in Phase 4)
- ❌ Engineering approval workflow not yet implemented (Phase 4)

**Database Verification:**
```sql
-- Verify engineering user has correct department type
SELECT u.name, u.email, d.type as dept_type
FROM users u
JOIN departments d ON u."departmentId" = d.id
WHERE u.email = 'enguser01@gmail.com';
-- Should show: dept_type = 'ENGINEERING'
```

---

## Phase 3.2: Request Cancellation & Hierarchy Management

### Test 13: Requester Cancels Own Request (Before Approvals) ⭐

**Objective:** Verify requesters can cancel their own requests before any approvals

**Login as:** test02@gmail.com (Level 1, QC Dept)

**Steps:**
1. Navigate to `/requests/new`
2. Create new request:
   - Title: "Test: Request Cancellation"
   - Description: "This will be cancelled"
3. Click "Create Request"
4. Immediately click on the new request to view details
5. Verify "Cancel Request" button appears
6. Click "Cancel Request"
7. Enter cancellation reason: "Testing cancellation - no longer needed"
8. Click "Cancel Request" (confirm)

**Expected Results:**
- ✅ "Cancel Request" button visible in request detail modal
- ✅ Confirmation dialog appears with title "Cancel Request?"
- ✅ Textarea for cancellation reason (required field)
- ✅ Submit button disabled until reason has 10+ characters
- ✅ After confirmation: Status changes to `Cancelled`
- ✅ Status badge shows gray "Cancelled" styling
- ✅ Activity log shows:
  - "Request created"
  - "Cancelled" with reason provided
- ✅ All pending approvals marked as rejected
- ✅ Cancel button no longer visible
- ✅ Request appears as read-only (no further actions possible)

**Database Verification:**
```sql
-- Check request status
SELECT status FROM requests WHERE id = '[request-id]';
-- Should return: Cancelled

-- Check approval cleanup
SELECT status FROM request_approvals
WHERE "requestId" = '[request-id]';
-- All should be: rejected

-- Check activity log
SELECT * FROM request_activities
WHERE "requestId" = '[request-id]' AND action = 'cancelled';
-- Should show cancellation record with reason
```

---

### Test 14: Cancel Button Visibility Rules

**Objective:** Verify cancel button only appears when appropriate

**Test Scenario A: Requester's Own Request**
**Login as:** test02@gmail.com (Level 1)
- Create request
- ✅ Cancel button visible

**Test Scenario B: Other User's Request**
**Login as:** test01@gmail.com (Level 2)
- Open request created by test02@gmail.com
- ❌ Cancel button NOT visible

**Test Scenario C: Request with Approved Approvals**
**Login as:** test02@gmail.com (Level 1)
- Create request
- **Login as:** test01@gmail.com (Level 2)
- Approve the request
- **Login as:** test02@gmail.com
- Open the request
- ❌ Cancel button NOT visible (already has approvals)

**Test Scenario D: Request in Final Statuses**
**Login as:** test02@gmail.com
- Open request with status `Completed` or `Cancelled`
- ❌ Cancel button NOT visible (request already finalized)

**Expected Results:**
- ✅ Cancel button visible for: requester + no approved approvals + not Completed/Cancelled
- ✅ Status does NOT matter - can cancel any status as long as no approvals yet
- ✅ Cancel button hidden if: any approved approvals exist
- ✅ Cancel button hidden if: status is Completed or Cancelled
- ✅ Cancel button hidden if: not the requester

---

### Test 15: Cancellation Validation Rules

**Objective:** Verify cancellation validation prevents invalid cancellations

**Test A: Reason Too Short**
1. Click "Cancel Request"
2. Enter reason: "No" (2 characters)
3. ❌ Submit button disabled
4. ❌ Validation error: "Reason must be at least 10 characters"

**Test B: Reason Too Long**
1. Enter reason: 600+ characters
2. ❌ Validation error: "Reason too long (max 500 characters)"

**Test C: Non-Owner Attempt**
1. **Login as:** test01@gmail.com (Level 2)
2. Try to cancel request owned by test02@gmail.com
3. ❌ Error: "Only the requester can cancel their own request"

**Test D: Request with Approved Approvals**
1. **Login as:** test02@gmail.com
2. Try to cancel request with approved approval
3. ❌ Error: "Cannot cancel - request has already been approved"

**Test E: Completed/Cancelled Requests**
1. **Login as:** test02@gmail.com
2. Try to cancel request with status `Completed` or `Cancelled`
3. ❌ Error: "Cannot cancel - request is Completed" (or Cancelled)

---

### Test 16: Hierarchy View - Basic Navigation ⭐

**Objective:** Verify admins can access and view department hierarchy

**Login as:** patawatnew@hotmail.com (Admin, QC Dept)

**Steps:**
1. Navigate to `/admin/departments`
2. Find "Quality Control" department
3. Click the actions menu (three dots)
4. Click "View Hierarchy" link
5. Verify hierarchy page loads

**Expected Results:**
- ✅ Page title: "Quality Control - Approval Hierarchy"
- ✅ URL: `/admin/departments/[dept-id]/hierarchy`
- ✅ Back to Departments link visible
- ✅ Hierarchy displays Trello-style vertical columns
- ✅ Each column shows:
  - Level header (e.g., "Level 5")
  - Level label (e.g., "Department Head")
  - User count (e.g., "1 user")
- ✅ Users displayed as cards in appropriate level columns
- ✅ Each user card shows:
  - User name
  - User email
  - Cursor-grab icon on hover

**Expected Hierarchy for Quality Control:**
```
Level 5: 1 user (Admin)
Level 2: 1 user (QC Level 2)
Level 1: 1 user (QC Level 1)
```

---

### Test 17: Hierarchy Visualization - Drag-and-Drop UI

**Objective:** Verify drag-and-drop interface works correctly

**Prerequisites:** No pending approvals in department

**Login as:** patawatnew@hotmail.com (Admin)

**Steps:**
1. Navigate to Quality Control hierarchy view
2. Hover over a user card
3. Verify cursor changes to "grab"
4. Click and drag user card
5. Verify visual feedback:
   - Card becomes semi-transparent
   - Blue ring appears around card
6. Drag over different level column
7. Verify column highlights (blue background)
8. Release to drop
9. Verify user moves to new column
10. Check toast notification appears

**Expected Results:**
- ✅ Drag works with mouse
- ✅ Visual feedback during drag (opacity, ring)
- ✅ Drop target highlights when hovering
- ✅ User card moves to new level immediately (optimistic update)
- ✅ Toast notification: "Moved [user name] to Level [N]"
- ✅ All other users remain in their original positions
- ✅ User count updates on both columns

**Keyboard Accessibility:**
1. Tab to user card
2. Press Space to enter drag mode
3. Use arrow keys to move between levels
4. Press Space to drop
- ✅ Keyboard navigation works

---

### Test 18: Hierarchy Blocking - Pending Approvals

**Objective:** Verify hierarchy changes blocked when approvals pending

**Setup:**
1. **Login as:** test02@gmail.com (Level 1)
2. Create new request (creates pending approvals)

**Login as:** patawatnew@hotmail.com (Admin)

**Steps:**
1. Navigate to Quality Control hierarchy view
2. Verify warning alert appears:
   - ⚠️ Icon: AlertTriangle
   - Title: "Hierarchy Changes Blocked"
   - Message: "Cannot modify hierarchy - 1 request(s) have pending approvals..."
3. Try to drag a user card
4. Verify drag is disabled:
   - Cursor shows "not-allowed"
   - Card appears semi-transparent (60% opacity)
   - Cannot grab or move card
5. Verify error message if attempting drag

**Expected Results:**
- ✅ Warning banner displayed at top of page
- ✅ All drag operations disabled
- ✅ User cards show "disabled" styling
- ✅ Pending approval count accurate
- ✅ After approving/cancelling all pending requests:
  - Warning disappears
  - Drag-and-drop re-enabled

---

### Test 19: Hierarchy Persistence - Database Updates

**Objective:** Verify drag-and-drop changes persist to database

**Login as:** patawatnew@hotmail.com (Admin)

**Steps:**
1. Navigate to Quality Control hierarchy view
2. Drag "QC Level 2" user from Level 2 to Level 3
3. Wait for toast success message
4. Refresh the page (F5 or Cmd+R)
5. Verify user still shows in Level 3 column
6. Navigate away and back to hierarchy view
7. Verify user remains in Level 3

**Database Verification:**
```sql
-- Check user level updated
SELECT name, email, level FROM users
WHERE email = 'test01@gmail.com';
-- Should show: level = 3

-- Check audit trail
SELECT * FROM request_activities
WHERE action = 'hierarchy_changed'
ORDER BY "createdAt" DESC
LIMIT 1;
-- Should show:
-- action = 'hierarchy_changed'
-- comments = 'Changed [user name]''s level from 2 to 3 in department'
-- userId = [admin user id]
```

**Expected Results:**
- ✅ User level persists across page refresh
- ✅ Database `level` field updated
- ✅ Audit trail entry created
- ✅ Admin name logged in activity

---

### Test 20: Hierarchy Change History Display

**Objective:** Verify change history shows recent modifications

**Prerequisites:** Complete Test 19 (make at least one hierarchy change)

**Login as:** patawatnew@hotmail.com (Admin)

**Steps:**
1. Navigate to Quality Control hierarchy view
2. Scroll to bottom of page
3. Verify "Recent Changes" section appears
4. Check change history shows:
   - Timestamp (formatted: "Feb 1, 2026 14:30")
   - Admin name
   - Change description

**Expected Results:**
- ✅ Section titled "Recent Changes"
- ✅ Shows last 5 hierarchy changes
- ✅ Most recent changes at top
- ✅ Format: "[Timestamp] — [Admin Name]: [Change description]"
- ✅ Timestamp human-readable
- ✅ No duplicate entries

**Sample Display:**
```
Recent Changes

Feb 1, 2026 14:35 — Admin (QC Level 5): Changed QC Level 2's level from 2 to 3 in department
Feb 1, 2026 14:30 — Admin (QC Level 5): Changed QC Level 1's level from 1 to 2 in department
```

---

### Test 21: Hierarchy Error Handling - Rollback on Failure

**Objective:** Verify UI rolls back on server errors

**Login as:** patawatnew@hotmail.com (Admin)

**Steps:**
1. Open browser DevTools (F12)
2. Go to Network tab
3. Set throttling to "Offline"
4. Navigate to hierarchy view
5. Drag a user card to different level
6. Wait for error
7. Set throttling back to "Online"
8. Refresh page

**Expected Results:**
- ✅ Optimistic update: User card moves immediately on drag
- ✅ After network error: Toast shows error message
- ✅ User card rolls back to original position
- ✅ Error message: "Failed to update level" or similar
- ✅ Page refresh shows user in original position
- ✅ No data corruption in database

**Alternative Test (Pending Approvals):**
1. Have pending approvals in department
2. Try to drag user (should be blocked)
3. Verify card doesn't move
4. Verify warning message

---

## Phase 3.2: Cross-Feature Integration Tests

### Test 22: Cancel → Create New Request Workflow

**Objective:** Verify user can create new request after cancellation

**Login as:** test02@gmail.com

**Steps:**
1. Create request
2. Cancel it with valid reason
3. Navigate to `/requests/new`
4. Create another request:
   - Title: "Test: New Request After Cancellation"
   - Description: "Testing that cancellation doesn't block new requests"
5. Submit

**Expected Results:**
- ✅ Can create new request after cancellation
- ✅ Previous cancellation doesn't affect new request
- ✅ New request gets fresh approval chain
- ✅ No leftover state from cancelled request

---

### Test 23: Hierarchy Change → New Request Approval Chain

**Objective:** Verify hierarchy changes affect new request approval chains

**Login as:** patawatnew@hotmail.com (Admin)

**Steps:**
1. Navigate to hierarchy view
2. Move a user from Level 2 to Level 4
3. **Login as:** test02@gmail.com (Level 1)
4. Create new request

**Expected Results:**
- ✅ New request approval chain reflects updated hierarchy
- ✅ If submitter is Level 1, chain starts at Level 2 (or next level with users)
- ✅ Moved user appears at correct level in approval chain
- ✅ Approval respects user's NEW level

---

### Test 24: Multiple Admins Concurrent Hierarchy Changes

**Objective:** Verify optimistic locking prevents conflicts

**Setup:** Two browser windows or different devices

**Window A - Admin A:**
1. Login as patawatnew@hotmail.com
2. Open hierarchy view
3. Note user's current level

**Window B - Admin B:**
1. Login as another admin user
2. Open hierarchy view
3. Drag same user to different level
4. Wait for success

**Window A - Admin A:**
1. Try to drag same user to another level
2. Verify error or automatic refresh

**Expected Results:**
- ✅ Second admin gets error: "User was modified by another admin"
- ✅ UI shows current state after refresh
- ✅ No data corruption
- ✅ Both admins see final correct state

---

## Edge Cases & Error Handling

### Edge Case 1: User Without Level
**Setup:** User with `level = null`
**Expected:** Request creation should fail or default to Level 1

### Edge Case 2: Department Without Users
**Expected:** Cannot create approval chain, graceful error

### Edge Case 3: Concurrent Approvals
**Test:** Two users at same level try to approve simultaneously
**Expected:** First one wins, second gets error "Already approved at this level"

### Edge Case 4: User Changes Level Mid-Approval
**Test:** User's level changes while request is pending their approval
**Expected:** Approval still valid based on original required level

### Edge Case 5: Request Modified After Approval
**Expected:** Approvals remain valid, activity log shows modification

---

## Performance Tests

### Performance Test 1: Approval Chain with Many Levels
**Setup:** Create department with 10 levels
**Expected:** All levels created correctly, page loads < 2s

### Performance Test 2: Many Requests with Approvals
**Setup:** Create 50+ requests with various approval states
**Expected:** List page loads < 3s, filtering works

---

## Database Integrity Checks

Run these SQL queries after testing:

```sql
-- 1. Check all requests have approval records
SELECT r.id, r.title, r.status, COUNT(ra.id) as approval_count
FROM requests r
LEFT JOIN request_approvals ra ON r.id = ra."requestId"
WHERE r.status IN ('ImprovementRequest', 'SentToEngineer')
GROUP BY r.id, r.title, r.status
HAVING COUNT(ra.id) = 0;
-- Should return 0 rows (all requests have approvals)

-- 2. Check approval sequence integrity
SELECT ra.*, r.status
FROM request_approvals ra
JOIN requests r ON ra."requestId" = r.id
WHERE ra."order" > 1
  AND NOT EXISTS (
    SELECT 1 FROM request_approvals ra2
    WHERE ra2."requestId" = ra."requestId"
      AND ra2."order" = ra."order" - 1
  );
-- Should return 0 rows (no gaps in approval sequence)

-- 3. Check orphaned approvals
SELECT ra.*
FROM request_approvals ra
LEFT JOIN requests r ON ra."requestId" = r.id
WHERE r.id IS NULL;
-- Should return 0 rows

-- 4. Check approval status consistency
SELECT ra.*
FROM request_approvals ra
JOIN requests r ON ra."requestId" = r.id
WHERE r.status != 'ImprovementRequest'
  AND r.status != 'SentToEngineer'
  AND r.status != 'SendBackToRequester'
  AND ra.status = 'pending';
-- Should return 0 rows (no pending approvals on completed requests)
```

---

## Success Criteria ✅

Phase 3 passes if ALL criteria met:

### Phase 3.1: Core Approval Logic
- [ ] Level-based approval chains create correctly
- [ ] Approval starts at (submitter level + 1)
- [ ] Any one user at each level can approve
- [ ] Sequential approval enforced (can't skip levels)
- [ ] Top-level approval triggers status change
- [ ] Top-level submitters auto-approve
- [ ] Rejection stops approval chain
- [ ] Approval progress displays correctly
- [ ] Approve/Reject buttons work
- [ ] Activity log records all approval actions
- [ ] Comments saved with approvals
- [ ] Cross-department isolation works
- [ ] Engineering department approvals work

### Phase 3.2: Cancellation & Hierarchy Management
- [ ] Requesters can cancel own requests before approvals
- [ ] Cancel button only visible when eligible
- [ ] Cancellation requires minimum 10-character reason
- [ ] Cancelled requests show proper status and are read-only
- [ ] Cancellation logged in audit trail with reason
- [ ] Pending approvals marked rejected on cancellation
- [ ] Admins can access hierarchy view from department page
- [ ] Hierarchy displays users in Trello-style vertical columns
- [ ] Each level column shows level number, label, and user count
- [ ] Drag-and-drop works with mouse and keyboard
- [ ] Visual feedback during drag (opacity, ring, highlighting)
- [ ] Hierarchy changes persist to database
- [ ] Every hierarchy change logged in audit trail
- [ ] Hierarchy blocked when pending approvals exist
- [ ] Optimistic updates with rollback on error
- [ ] Change history displays recent modifications

### General Requirements
- [ ] No database integrity issues
- [ ] UI responsive and intuitive
- [ ] TypeScript compiles without errors
- [ ] No console errors or warnings

---

## Known Issues & Limitations

### Phase 3 Scope:
- ✅ Level-based approvals (ImprovementRequest, SentToEngineer)
- ✅ Request cancellation before approvals
- ✅ Hierarchy visualization with drag-and-drop
- ✅ Hierarchy change audit logging
- ⏳ Engineering solution submission and approval - **Phase 4**
- ⏳ Dashboard views (My Requests, Pending My Approval) - **Phase 5**
- ⏳ In-app notifications - **Future phase**
- ⏳ Email notifications - **Future phase**

### Current Limitations:
1. **No notification system** - Users must manually check for pending approvals
2. **No engineering solution workflow** - Solution submission in Phase 4
3. **Cannot reassign approvals** - If approver unavailable, cannot delegate
4. **Hierarchy history limited to 5 changes** - Can view only recent modifications
5. **No bulk user level changes** - Must drag users one at a time
6. **No hierarchy templates** - Cannot save/load hierarchy configurations

---

## Test Completion Tracker

Use this section to track your testing progress:

### Phase 3.1: Core Approval Logic (Tests 1-12)

| Test | Description | Status | Notes |
|------|-------------|--------|-------|
| 1 | Level 1 creates request | ⬜ | Approval chain created |
| 2 | Mid-level approval | ⬜ | Sequential advance |
| 3 | Top-level approval | ⬜ | Status → SentToEngineer |
| 4 | Top-level auto-approve | ⬜ | Skip logic works |
| 5 | Any-one-per-level | ⬜ | Single approval sufficient |
| 6 | Rejection flow | ⬜ | Chain stops on reject |
| 7 | Multiple approvers same level | ⬜ | Only one needed |
| 8 | Requester at top level | ⬜ | Auto-skip to engineering |
| 9 | Approval progress display | ⬜ | Visual indicators work |
| 10 | Activity logging | ⬜ | All actions logged |
| 11 | Status transitions | ⬜ | Correct state changes |
| 12 | Engineering visibility | ⬜ | Sees all requests |

**Phase 3.1 Status:** ___ / 12 tests passed

---

### Phase 3.2: Cancellation & Hierarchy (Tests 13-24)

| Test | Description | Status | Notes |
|------|-------------|--------|-------|
| 13 | Requester cancels own request | ⬜ | Cancellation workflow |
| 14 | Cancel button visibility | ⬜ | Access control |
| 15 | Cancellation validation | ⬜ | Error handling |
| 16 | Hierarchy view navigation | ⬜ | Admin access |
| 17 | Drag-and-drop UI | ⬜ | Visual interface |
| 18 | Hierarchy blocking | ⬜ | Pending approval validation |
| 19 | Hierarchy persistence | ⬜ | Database updates |
| 20 | Change history display | ⬜ | Audit trail |
| 21 | Error rollback | ⬜ | Failure handling |
| 22 | Cancel → create workflow | ⬜ | No state pollution |
| 23 | Hierarchy → approval chain | ⬜ | Dynamic updates |
| 24 | Concurrent changes | ⬜ | Optimistic locking |

**Phase 3.2 Status:** ___ / 12 tests passed

---

### Overall Phase 3 Status

**Total Progress:** ___ / 24 tests passed

**Phase 3.1 (Core Approval):** ⬜ Not Started | ⏳ In Progress | ✅ Complete
**Phase 3.2 (Cancellation & Hierarchy):** ⬜ Not Started | ⏳ In Progress | ✅ Complete

**Known Issues:**
- ___________________________________________________________________
- ___________________________________________________________________

**Blockers:**
- ___________________________________________________________________
- ___________________________________________________________________

**Next Steps:**
- ___________________________________________________________________

---

## Quick Commands Reference

```bash
# Setup user levels
npx tsx scripts/setup-user-levels.ts

# Open Prisma Studio
npx prisma studio

# Sync database schema
npx prisma db push

# Regenerate Prisma Client
npx prisma generate

# Start dev server
npm run dev

# View database in GUI
# http://localhost:5555 (Prisma Studio)

# Test app
# http://localhost:3005
```

---

## Next Steps: Phase 4 & Beyond

After Phase 3 testing passes:

**Phase 4: Engineering Solutions**
- Engineering solution submission form
- Engineering approval workflow
- Manual completion marking
- Solution file attachments

**Phase 5: Dashboard & Visibility**
- "My Requests" view
- "Pending My Approval" view
- Search and filter functionality
- Activity timeline

**Future Phases:**
- Phase 6: Audit & Compliance
- Phase 7: Configuration & Administration
- Phase 8: Complete Admin User & Department Management

**Happy Testing! 🚀**

Report any bugs or unexpected behavior for fixes before Phase 4!
