# Admin Delete Feature Documentation

## Overview

The approval system includes a comprehensive **soft delete** feature that allows admins to delete requests while preserving all audit trails. Deleted requests can be restored or permanently deleted to save database space.

## Table of Contents

- [Soft Delete vs Hard Delete](#soft-delete-vs-hard-delete)
- [Deleting Requests](#deleting-requests)
- [Monitoring Deleted Requests](#monitoring-deleted-requests)
- [Bulk Delete by Date Range](#bulk-delete-by-date-range)
- [Restoring Deleted Requests](#restoring-deleted-requests)
- [Permanent Deletion Options](#permanent-deletion-options)
- [Automated Cleanup](#automated-cleanup)

---

## Soft Delete vs Hard Delete

### Soft Delete (Default)
- Marks request as `isDeleted: true`
- Preserves all data in database
- Maintains audit trail
- Files remain on disk
- **Can be restored**

### Hard Delete (Permanent)
- Removes record from database
- Cascades to related records (files, activities, approvals, notifications)
- **Cannot be undone**
- Files are removed from disk

---

## Deleting Requests

### Individual Request Deletion

**Who can delete:** Admins only

**Steps:**
1. Navigate to any request detail
2. Click the "Delete" button (red, with trash icon)
3. Enter a reason (min. 10 characters)
4. Confirm deletion

**What happens:**
- Request marked as deleted (`isDeleted: true`)
- Deleted by and deleted at timestamp recorded
- Reason logged in activity log
- Request disappears from all active views
- Files remain on disk (cleanup happens on permanent delete)

**Example:**
```
Request: "Test Request - With PDF"
Status: ImprovementRequest → Soft Deleted
Deleted by: Pattawat Wannawong (Admin)
Reason: "Test deletion"
```

---

## Monitoring Deleted Requests

### Access the Deleted Requests Page

**URL:** `/admin/deleted-requests`

**Who can view:** Admins only

**What you'll see:**
- Total count of deleted requests
- Requests deleted this month
- Requests deleted this year
- Full list with details:
  - Request title
  - Requester name and email
  - Department
  - Status at time of deletion
  - Deleted by (admin name)
  - Deletion timestamp
  - Deletion reason

### Summary Stats

```
Total Deleted: 4
This Month: 2
This Year: 4
```

---

## Bulk Delete by Date Range

### Delete Active Requests in Bulk

**Location:** `/requests` page

**Who can use:** Admins only

**Steps:**
1. Go to `/requests`
2. Click "Bulk Delete by Date" button (admin only)
3. **Step 1 - Preview:**
   - Select "From Date" (creation date)
   - Select "To Date" (creation date)
   - Click "Preview"
   - Review list of requests that will be deleted
4. **Step 2 - Confirm:**
   - Type `DELETE` to confirm
   - Click "Delete X Requests"

**Example:**
```
From: 2026-01-01
To: 2026-01-31
Preview: 15 requests found
→ Delete 15 Requests
```

### What Gets Deleted
- All **active requests** created within the date range
- Only active (non-deleted) requests
- Soft deleted - can be restored later

---

## Restoring Deleted Requests

### How to Restore

**From:** `/admin/deleted-requests`

**Steps:**
1. Find the deleted request in the list
2. Click "Restore" button (green, with refresh icon)
3. Confirm restoration

**What happens:**
- `isDeleted` set back to `false`
- `deletedAt` and `deletedBy` cleared
- Request reappears in `/requests`
- Restoration logged in activity log
- All data preserved (files, approvals, activities)

**When to Restore:**
- Accidentally deleted request
- Need to review old request data
- Re-opening a closed request

---

## Permanent Deletion Options

### Available at `/admin/deleted-requests`

#### Option 1: Delete Old Requests

**Description:** Permanently delete requests deleted more than 1 year ago

**Use case:** Regular cleanup of old deleted requests

**Button:** "Delete X Old Requests" (where X = count)

#### Option 2: Delete by Date Range

**Description:** Select custom date range of deletion date

**Use case:** Targeted cleanup of specific period

**Steps:**
1. Click "Delete by Date Range" button
2. **Step 1 - Preview:**
   - Select "From Date" and "To Date" (based on `deletedAt` timestamp)
   - Click "Preview"
   - See exactly what will be deleted
3. **Step 2 - Confirm:**
   - Type `PERMANENTLY DELETE`
   - Click "Permanently Delete X Requests"

**Example:**
```
From: 2025-01-01
To: 2025-12-31
Preview: 150 requests to permanently delete
Confirm: PERMANENTLY DELETE
→ 150 requests permanently deleted
```

#### Option 3: Delete All

**Description:** Permanently delete ALL deleted requests

**Use case:** Full cleanup (use with caution)

**Button:** "Delete All (X)" where X = total count

#### Option 4: Individual Permanent Delete

**Description:** Permanently delete a single request

**Use case:** Remove specific request

**Button:** "Delete" button next to each request in the list

### What Gets Permanently Deleted

When you permanently delete a request:
- ✅ Request record removed from database
- ✅ File attachments metadata deleted
- ✅ Activity logs deleted
- ✅ Approval records deleted
- ✅ Notifications deleted
- ✅ **Physical files deleted from disk** (`public/uploads/`)
- ❌ User records **preserved** (not affected)
- ❌ Department records **preserved** (not affected)

### Warning

⚠️ **Permanent deletion CANNOT be undone**

All data is removed from the database and files are deleted from disk. There is no recovery mechanism.

---

## Automated Cleanup

### Cleanup Script

**Location:** `scripts/cleanup-deleted-requests.ts`

**What it does:**
- Finds requests soft-deleted older than specified threshold
- Permanently deletes them from database
- Removes files from disk
- Logs summary of actions

### Usage

#### Manual Run

```bash
# Preview mode (safe - shows what will be deleted)
npx tsx scripts/cleanup-deleted-requests.ts --dry-run

# Live run (will actually delete)
npx tsx scripts/cleanup-deleted-requests.ts

# Custom threshold (e.g., 6 months instead of 1 year)
npx tsx scripts/cleanup-deleted-requests.ts --threshold=180
```

#### Environment Variables

```bash
# Set default threshold in days
CLEANUP_THRESHOLD_DAYS=365 npx tsx scripts/cleanup-deleted-requests.ts

# Dry run mode
DRY_RUN=true npx tsx scripts/cleanup-deleted-requests.ts
```

### Scheduling with Cron

#### Monthly Cleanup (Recommended)

Runs on the 1st of each month at midnight:

```bash
crontab -e
```

Add this line:
```
0 0 1 * * cd /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2 && npx tsx scripts/cleanup-deleted-requests.ts >> /var/log/cleanup-requests.log 2>&1
```

#### Yearly Cleanup

Runs on January 1st at midnight:

```
0 0 1 1 * cd /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2 && npx tsx scripts/cleanup-deleted-requests.ts --threshold=365 >> /var/log/cleanup-requests.log 2>&1
```

### Log Monitoring

Check cleanup logs:
```bash
tail -f /var/log/cleanup-requests.log
```

Example output:
```
🗑️  Starting cleanup of deleted requests...

Configuration:
  Threshold: 365 days
  Mode: LIVE (will delete data)
  Cutoff date: 2025-02-01T00:00:00.000Z

Found 25 requests to permanently delete:

  1. Old Request from 2024
     ID: cmlxxx
     Requester: John Doe (john@example.com)
     Deleted at: 1/15/2024, 3:30:00 PM

⚠️  Permanently deleting requests...
✅ Successfully deleted 25 requests.

═══════════════════════════════════════
Cleanup Summary
═══════════════════════════════════════
Total found:      25
Total deleted:    25
Errors:           0
═══════════════════════════════════════
```

---

## API Reference

### Server Actions

#### `deleteRequest(input)`

Delete a single request (soft delete).

**Input:**
```typescript
{
  requestId: string
  reason: string // min 10 characters
}
```

**Returns:**
```typescript
{
  success: boolean
  error?: string
}
```

**Example:**
```typescript
await deleteRequest({
  requestId: 'cml123abc',
  reason: 'Duplicate request, removing old version'
})
```

---

#### `bulkDeleteRequestsByDateRange(input)`

Bulk delete active requests by creation date range.

**Input:**
```typescript
{
  mode: 'preview' | 'delete'
  dateFrom: string // ISO date string
  dateTo: string   // ISO date string
}
```

**Returns (preview mode):**
```typescript
{
  success: boolean
  count?: number
  requests?: Array<{
    id: string
    title: string
    status: string
    createdAt: Date
    requester: { name: string; email: string }
  }>
}
```

**Returns (delete mode):**
```typescript
{
  success: boolean
  count?: number
  message?: string
}
```

**Example:**
```typescript
// Preview
const result = await bulkDeleteRequestsByDateRange({
  mode: 'preview',
  dateFrom: '2026-01-01',
  dateTo: '2026-01-31'
})
console.log(`Found ${result.count} requests to delete`)

// Delete
await bulkDeleteRequestsByDateRange({
  mode: 'delete',
  dateFrom: '2026-01-01',
  dateTo: '2026-01-31'
})
```

---

#### `permanentlyDeleteRequests(input)`

Permanently delete soft-deleted requests.

**Input:**
```typescript
{
  mode: 'single' | 'older_than_1_year' | 'all' | 'date_range'
  requestId?: string  // for mode: 'single'
  dateFrom?: string   // for mode: 'date_range'
  dateTo?: string     // for mode: 'date_range'
}
```

**Returns:**
```typescript
{
  success: boolean
  error?: string
  count?: number
  message?: string
}
```

---

#### `restoreRequest(input)`

Restore a soft-deleted request.

**Input:**
```typescript
{
  requestId: string
}
```

**Returns:**
```typescript
{
  success: boolean
  error?: string
  message?: string
}
```

---

#### `getDeletedRequests()`

Get list of all deleted requests (admin only).

**Returns:**
```typescript
Array<{
  id: string
  title: string
  status: string
  createdAt: Date
  deletedAt: Date | null
  requester: { name: string; email: string }
  department: { name: string }
  deletedByUser: { name: string }
  activities: Array<{
    comments: string
    createdAt: Date
  }>
}>
```

---

## Database Schema

### Request Model - Soft Delete Fields

```prisma
model Request {
  // ... other fields

  // Soft delete fields
  isDeleted      Boolean   @default(false)
  deletedAt      DateTime?
  deletedBy      String?
  deletedByUser  User?     @relation("RequestDeleter", fields: [deletedBy], references: [id])

  @@index([isDeleted])
}
```

### Cascade Behavior

When a request is permanently deleted:

- **Cascade to FileAttachment** ✅
- **Cascade to RequestActivity** ✅
- **Cascade to RequestApproval** ✅
- **Cascade to Notification** ✅
- **User** ❌ (preserved)
- **Department** ❌ (preserved)

---

## Best Practices

### 1. Use Soft Delete First
- Always try soft delete before permanent deletion
- Gives you time to review and restore if needed

### 2. Regular Cleanup
- Schedule monthly or quarterly cleanup
- Use `--dry-run` first to preview what will be deleted

### 3. Monitor Before Cleanup
- Check `/admin/deleted-requests` before running cleanup
- Verify important requests are restored if needed

### 4. Document Reasons
- Always provide clear deletion reasons
- Helps with audit trail and debugging

### 5. Test Preview First
- Always use preview mode before bulk deletion
- Review the list before confirming

---

## Troubleshooting

### Issue: Deleted requests still showing in "My Actions"

**Solution:** Fixed - Filter now excludes `isDeleted: true` requests

### Issue: Can't see delete button

**Cause:** Not logged in as admin

**Solution:** Ensure your user role is `admin` in the database

### Issue: Files not deleted from disk after permanent delete

**Cause:** File path issues or permissions

**Solution:** Check file exists in `public/uploads/` and check permissions

### Issue: Bulk delete by date shows no requests

**Cause:** No requests created in that date range, or already deleted

**Solution:** Use preview mode to verify, adjust date range

---

## Security Considerations

1. **Admin Only:** All delete operations require admin role
2. **Audit Trail:** Every deletion is logged with:
   - Who deleted (admin user)
   - When deleted (timestamp)
   - Reason (provided by admin)
3. **Confirmation Required:**
   - Individual delete: Reason required (min 10 chars)
   - Bulk delete: Must type confirmation phrase
   - Permanent delete: Must type "PERMANENTLY DELETE"

---

## Summary

| Feature | Location | Admin Only | Undoable |
|---------|----------|------------|----------|
| Delete Request | Request detail | ✅ | ✅ (Restore) |
| Bulk Delete by Date | `/requests` | ✅ | ✅ (Restore) |
| View Deleted | `/admin/deleted-requests` | ✅ | N/A |
| Restore | `/admin/deleted-requests` | ✅ | N/A |
| Delete Old (>1yr) | `/admin/deleted-requests` | ✅ | ❌ |
| Delete by Date Range | `/admin/deleted-requests` | ✅ | ❌ |
| Delete All | `/admin/deleted-requests` | ✅ | ❌ |
| Automated Cleanup | CLI script | ✅ | ❌ |

---

## Support

For issues or questions:
- Check the database: Ensure `isDeleted` index exists
- Check logs: Look for Prisma errors
- Verify permissions: Ensure admin role in database

**Last Updated:** February 1, 2026
