# Phase 2: Core Request Workflow - Manual Testing Guide

## ⚠️ IMPORTANT: Pre-Test Setup

Before you can test Phase 2, you need users and departments in the database.

### Option A: Quick Setup (Recommended for Testing)

Run the automated setup script:

```bash
npx tsx scripts/setup-test-data.ts
```

This will:
- ✅ Create 4 test departments (Engineering, QC, PD1, Admin)
- ✅ Assign existing users to departments
- ✅ Show current user setup

### Option B: Manual Setup via Admin Panel

1. **Sign up or log in to the app** at http://localhost:3005
   - Your first user will be created in Clerk
   - Check the webhook logs to verify Prisma user creation

2. **Access Admin Panel** at http://localhost:3005/admin
   - If you're not an admin, update your role in Clerk Dashboard or Prisma Studio

3. **Create Departments:**
   - Go to Admin → Departments
   - Create at least one department:
     - ID: `QC`
     - Name: `Quality Control`
     - Type: `GENERAL`

4. **Assign User to Department:**
   - Go to Admin → Users
   - Edit your user
   - Assign to the department you created
   - Save

5. **Verify Setup:**
   ```bash
   npx tsx scripts/setup-test-data.ts
   ```
   This will show your current user and department setup.

---

## Prerequisites Checklist

Before testing, verify:

- [ ] ✅ Dev server running on http://localhost:3005
- [ ] ✅ At least 1 department exists
- [ ] ✅ At least 1 user with department assigned
- [ ] ✅ You can log in successfully
- [ ] ✅ Database migrated (`npx prisma migrate dev`)

**Quick Check:**
```bash
# Open Prisma Studio to verify data
npx prisma studio
```

---

## What Was Built in Phase 2

### 02-01: Request Data Model ✅
- Request table with status tracking
- FileAttachment table for file metadata
- RequestActivity table for audit trail
- 5 workflow statuses

### 02-02: Request Creation with File Upload ✅
- Request creation form with validation
- Local file storage in `public/uploads/[request-id]/`
- File upload with progress tracking
- Supports: PDF, Word, Excel, Images (10MB limit)

### 02-03: Request List and Detail Views ✅
- Request list page with TanStack Table
- Request detail modal with files and activity log
- Status badges with color coding
- **Department-wide visibility**: Users see all requests from their department
- **Admin visibility**: Admins see all requests across all departments
- Requester column to identify who created each request

---

## Test Suite

### Test 1: Create Request Without Files ⭐ START HERE

**Objective:** Verify basic request creation flow

**Prerequisites:**
- ✅ User is logged in
- ✅ User has department assigned

**Steps:**
1. Navigate to http://localhost:3005/requests/new
2. Fill in the form:
   - **Title:** "Test Request - Basic"
   - **Description:** "This is a test request without any files"
3. Click **"Create Request"**

**Expected Results:**
- ✅ Success message appears
- ✅ Redirected to `/requests` page
- ✅ New request appears in the list
- ✅ Status shows "ImprovementRequest" (blue badge)
- ✅ File count shows "0 files"
- ✅ Created date is today
- ✅ Department name is displayed

**Database Verification:**
```sql
-- In Prisma Studio or psql:
SELECT * FROM requests ORDER BY "createdAt" DESC LIMIT 1;

-- Check activity log (should have 1 "created" entry)
SELECT * FROM request_activities
WHERE "requestId" = '[copy-request-id-from-above]'
ORDER BY "createdAt" DESC;
```

**If you see errors:**
- ❌ "User must belong to a department" → Run setup script or assign department
- ❌ "Unauthorized" → Make sure you're logged in
- ❌ "Validation error" → Check required fields are filled

---

### Test 2: Form Validation

**Objective:** Verify form validation works correctly

#### Test 2a: Empty Fields
1. Navigate to `/requests/new`
2. Leave title and description empty
3. Click "Create Request"

**Expected:**
- ❌ Error message: "Title is required"
- ❌ Error message: "Description is required"

#### Test 2b: Title Too Long
1. Enter title with 201+ characters
2. Fill valid description
3. Submit

**Expected:** ❌ Error: "Title too long"

#### Test 2c: Description Too Long
1. Enter valid title
2. Enter description with 5001+ characters
3. Submit

**Expected:** ❌ Error: "Description too long"

---

### Test 3: Create Request With Single File

**Objective:** Verify file upload functionality

**Steps:**
1. Navigate to `/requests/new`
2. Fill form:
   - **Title:** "Test Request - With PDF"
   - **Description:** "Request with a PDF attachment"
3. Click **"Create Request"** (this creates the request first)
4. After redirect, find your request and click to open detail
5. Click **"Attach Files"** or drag file to upload area
6. Select a PDF file (< 10MB)
7. Add description: "Project proposal document"
8. Click upload/confirm

**Expected Results:**
- ✅ Upload progress bar appears (0% → 100%)
- ✅ File uploads successfully
- ✅ File appears in attached files list
- ✅ Shows: filename, size, type, description
- ✅ Download link/button appears
- ✅ Click download → file downloads correctly

**File System Verification:**
```bash
# Check files were created
ls -lh public/uploads/

# Should see directory named with request ID
ls -lh public/uploads/[request-id]/

# Should see your uploaded PDF
```

**Database Check:**
```sql
-- Check file metadata saved
SELECT * FROM file_attachments
WHERE "requestId" = '[request-id]';

-- Should show:
-- - fileName, fileType, fileSize
-- - filePath (e.g., "uploads/req123/abc-xyz-file.pdf")
-- - uploadedById (your user ID)
```

---

### Test 4: Multiple File Upload

**Objective:** Test attaching multiple files

**Steps:**
1. Create a new request: "Multi-File Test"
2. Upload 3 different files:
   - 📄 PDF document
   - 📊 Excel spreadsheet (.xlsx)
   - 🖼️ Image (JPG or PNG)
3. Add unique description to each file

**Expected Results:**
- ✅ All 3 files upload successfully
- ✅ Each file keeps its description
- ✅ Files appear in upload order
- ✅ All download links work
- ✅ Request list shows "3 files"
- ✅ Activity log shows 3 "file_attached" entries

---

### Test 5: File Upload Validation

**Objective:** Test upload restrictions

#### Test 5a: Invalid File Type
1. Create a request
2. Try uploading: `.exe`, `.zip`, or other unsupported type

**Expected:** ❌ Error about unsupported file type

#### Test 5b: File Too Large
1. Create a request
2. Try uploading file > 10MB

**Expected:** ❌ Error: "File size exceeds 10MB limit"

#### Test 5c: No File Selected
1. Open request detail
2. Click upload without selecting file

**Expected:** ❌ Error or disabled upload button

---

### Test 6: Request List View (Department-Wide Visibility)

**Objective:** Verify department-wide visibility and listing

**Setup:** Create 5 different requests with various titles

**Steps:**
1. Navigate to `/requests`
2. Observe the list

**Expected Results:**
- ✅ All requests from YOUR DEPARTMENT appear (including colleagues' requests)
- ✅ Newest requests at the top
- ✅ Each row shows:
  - Request title
  - **Requester name** (who created the request)
  - Status badge (colored)
  - Department name
  - File count (e.g., "3 files")
  - Creation date

**Status Badge Colors:**
- 🔵 **ImprovementRequest** → Blue
- 🟡 **SentToEngineer** → Yellow
- 🟣 **DesignCostEstimationApproval** → Purple
- 🟢 **SendBackToRequester** → Green
- ⚫ **Completed** → Gray

**Department Visibility Test:**
1. Note which department you belong to (e.g., QC)
2. Check that all displayed requests show YOUR department name
3. Verify you can see requests created by other users in your department
4. Your own requests show your name in the "Requester" column

---

### Test 6b: Multi-User Department Visibility

**Objective:** Verify department-wide visibility works correctly with multiple users

**Prerequisites:**
- ✅ Two or more users in the same department
- ✅ At least one admin user (optional, for admin visibility test)

**Steps:**

#### Part 1: Same Department Users See Each Other's Requests
1. **As User A (QC Department):**
   - Log in
   - Create a request: "User A's Request - QC"
   - Log out

2. **As User B (QC Department):**
   - Log in
   - Navigate to `/requests`
   - **Expected:** ✅ You see BOTH:
     - User A's request (Requester column shows "User A")
     - Any of your own requests (Requester column shows your name)

#### Part 2: Different Department Users Don't See Each Other's Requests
1. **As User C (Engineering Department):**
   - Log in
   - Create a request: "User C's Request - Engineering"
   - Navigate to `/requests`
   - **Expected:** ✅ You see ONLY:
     - Engineering department requests
     - You do NOT see QC department requests

#### Part 3: Admin Visibility (All Departments)
1. **As Admin User:**
   - Log in
   - Navigate to `/requests`
   - **Expected:** ✅ You see ALL requests:
     - QC department requests
     - Engineering department requests
     - All other department requests
     - Requester column shows each user's name
     - Department column shows each request's department

**Key Verification Points:**
- ✅ Regular users see only their department's requests (read-only for others')
- ✅ Admins see all requests across all departments
- ✅ "Requester" column clearly identifies who created each request
- ✅ No permission to edit/cancel others' requests (will be enforced when those features are added)

---

### Test 7: Request Detail Modal

**Objective:** Test detail view completeness

**Steps:**
1. From `/requests`, click any request row
2. Modal opens

**Expected Modal Contents:**

**Header:**
- ✅ Request title
- ✅ Status badge
- ✅ Close button (X)

**Details Section:**
- ✅ Requester name and email
- ✅ Department name
- ✅ Full description
- ✅ Created date/time
- ✅ Last updated date/time

**Files Section:**
- ✅ List of all attached files
- ✅ For each file:
  - File name
  - File size (formatted, e.g., "2.3 MB")
  - File type/extension
  - Description (if provided)
  - Uploader name
  - Upload date
  - Download button

**Activity Timeline:**
- ✅ Chronological list of events (newest first)
- ✅ "Created" event with timestamp
- ✅ File upload events
- ✅ User names who performed actions
- ✅ Comments/details for each action

**Interactions:**
- ✅ Can scroll if content is long
- ✅ Can close with X button
- ✅ Can close by clicking outside modal
- ✅ Download buttons work

---

### Test 8: File Download

**Objective:** Verify downloads work correctly

**Steps:**
1. Open request with files
2. Click download for each file type:
   - PDF
   - Excel
   - Image
   - Word doc

**Expected for Each:**
- ✅ File downloads to browser
- ✅ Correct filename
- ✅ File opens in appropriate app
- ✅ Content is intact (not corrupted)

**Direct URL Test:**
```
http://localhost:3005/uploads/[request-id]/[filename]
```
- ✅ File displays/downloads
- ✅ Correct MIME type

---

### Test 9: Activity Timeline Accuracy

**Objective:** Verify audit trail

**Steps:**
1. Create new request
2. Upload 2 files
3. View request detail → Activity tab

**Expected Activity Log (newest first):**

```
3. [Your Name] attached file: [file2.xlsx]
   [timestamp, e.g., "2 minutes ago"]

2. [Your Name] attached file: [file1.pdf]
   [timestamp, e.g., "5 minutes ago"]

1. [Your Name] created request
   Status: → ImprovementRequest
   Comments: "Request created: [title]"
   [timestamp, e.g., "10 minutes ago"]
```

**Verify:**
- ✅ All actions logged
- ✅ Correct chronological order
- ✅ Accurate timestamps
- ✅ User names correct
- ✅ Status transitions clear

---

### Test 10: Department Association

**Objective:** Requests link to user's department

**Steps:**
1. Note your current department
2. Create a request
3. Check request list and detail

**Expected:**
- ✅ Department field shows YOUR department
- ✅ Consistent across list and detail views

**Multi-Department Test:**
1. Create admin user in different department
2. Create request as that user
3. Verify department is correctly assigned

---

### Test 11: User Without Department (Error Case)

**Objective:** Test error handling

**Setup:**
```sql
-- In Prisma Studio, set a user's departmentId to NULL
UPDATE users SET "departmentId" = NULL WHERE id = '[user-id]';
```

**Steps:**
1. Log in as that user
2. Try creating request

**Expected:**
- ❌ Error: "User must belong to a department to create requests"
- ❌ Request NOT created in database

**Cleanup:**
```bash
# Re-run setup script to fix
npx tsx scripts/setup-test-data.ts
```

---

### Test 12: File Upload Progress Tracking

**Objective:** Verify progress indicator

**Steps:**
1. Create request
2. Upload a large file (5-10 MB)
3. Watch progress bar

**Expected:**
- ✅ Progress starts at 0%
- ✅ Updates smoothly (not jumpy)
- ✅ Reaches 100% before "Upload complete"
- ✅ Success message appears

---

### Test 13: Concurrent Uploads

**Objective:** Multiple files at once

**Steps:**
1. Create request
2. Select 3 files and upload together (if UI allows)

**Expected:**
- ✅ All upload successfully
- ✅ No duplicate files
- ✅ Correct file count
- ✅ All in activity log

---

### Test 14: Page Performance

**Objective:** Test with many requests

**Setup:** Create 20+ requests

**Steps:**
1. Go to `/requests`
2. Check load time

**Expected:**
- ✅ Loads in < 2 seconds
- ✅ No lag when scrolling
- ✅ Clicking requests opens modal quickly

---

### Test 15: Direct File Access

**Objective:** Verify static serving

**Steps:**
1. Upload file, note path from database
2. Visit: `http://localhost:3005/uploads/[request-id]/[filename]`

**Expected:**
- ✅ File displays/downloads
- ✅ Works without login (⚠️ security note for later)

---

## Edge Cases

### Special Characters in Filename
Upload: `My File (v2) [FINAL].pdf`
- ✅ Filename preserved
- ✅ File accessible

### Duplicate Filenames
Upload `report.pdf` twice to same request
- ✅ Both saved (UUID prefix prevents collision)

### Browser Refresh During Upload
- Start upload
- Refresh page mid-upload
- ✅ Fails gracefully, no orphaned files

---

## Database Integrity Checks

After testing, run these SQL queries:

```sql
-- Check all requests have valid references
SELECT r.id, r.title, u.name as requester, d.name as department
FROM requests r
LEFT JOIN users u ON r."requesterId" = u.id
LEFT JOIN departments d ON r."departmentId" = d.id;

-- Find orphaned file attachments (should be 0)
SELECT fa.id, fa."fileName", r.title
FROM file_attachments fa
LEFT JOIN requests r ON fa."requestId" = r.id
WHERE r.id IS NULL;

-- Check all requests have activity logs (should be 0)
SELECT r.id, r.title, COUNT(ra.id) as activity_count
FROM requests r
LEFT JOIN request_activities ra ON r.id = ra."requestId"
GROUP BY r.id, r.title
HAVING COUNT(ra.id) = 0;
```

All queries should return 0 problematic rows.

---

## Success Criteria ✅

Phase 2 passes if:

- [x] Users can create requests with title and description
- [x] Form validation prevents invalid data
- [x] Files upload with progress tracking
- [x] Multiple files supported per request
- [x] File types and sizes are validated
- [x] Request list shows all department requests (department-wide visibility)
- [x] Requester column displays who created each request
- [x] Regular users see only their department's requests
- [x] Admin users see all requests across all departments
- [x] Status badges display correct colors
- [x] Request detail modal shows complete info
- [x] Activity timeline logs all actions
- [x] Downloads work for all file types
- [x] Department association is correct
- [x] Error handling is clear and helpful

---

## Known Limitations

From Phase 2 implementation:

1. **Local File Storage**
   - ⚠️ Files not replicated like S3
   - ⚠️ Need backup strategy in production
   - ⚠️ Disk space monitoring required

2. **File Cleanup**
   - ⚠️ Orphaned files accumulate on deletion
   - Future: Implement cleanup on request delete

3. **Static File Access**
   - ⚠️ No auth check on downloads
   - Future: Protected download endpoint

4. **List Pagination**
   - ⚠️ Shows all requests (no pagination yet)
   - Future: Add pagination for scale

5. **Request Permissions**
   - ⚠️ Cancel/edit restrictions not enforced yet
   - Currently view-only for department colleagues' requests
   - Future: Implement cancel button (only for request owner)
   - Future: Implement edit restrictions (only owner can modify)

---

## Quick Commands Reference

```bash
# Run database setup
npx tsx scripts/setup-test-data.ts

# Open Prisma Studio (GUI for database)
npx prisma studio

# Check uploaded files
ls -lh public/uploads/

# Clear all test data (careful!)
npx prisma migrate reset

# Restart dev server
npm run dev
```

---

**Happy Testing! 🚀**

Start with Test 1 and work through sequentially. Report any bugs you find!
