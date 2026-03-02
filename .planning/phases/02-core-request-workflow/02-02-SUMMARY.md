---
phase: 02-core-request-workflow
plan: 02
subsystem: file-storage
tags: [local-storage, file-upload, nextjs-api, prisma, react-hook-form, zod]

# Dependency graph
requires:
  - phase: 02-core-request-workflow/02-01
    provides: Request data model with FileAttachment model
provides:
  - Local file storage system using public/uploads/ directory
  - File upload API route with multipart form handling
  - Request creation form with file attachment support
  - Server actions for file preparation and confirmation
affects: [02-03, file-downloads, request-management]

# Tech tracking
tech-stack:
  added: [local file storage, Node.js fs/promises, Next.js API routes]
  patterns: [local file serving, XHR progress tracking, form validation with Zod]

key-files:
  created: [lib/files.ts, app/api/upload/route.ts, server-actions/files.ts, server-actions/requests.ts, components/requests/file-upload-zone.tsx, components/requests/request-form.tsx, app/(dashboard)/requests/new/page.tsx]
  modified: [prisma/schema.prisma, .env.local]

key-decisions:
  - "Local file storage instead of S3 for easier VPS deployment"
  - "Files stored in public/uploads/[request-id]/ for organization"
  - "Next.js static file serving for downloads (no presigned URLs)"
  - "XHR for upload progress tracking (fetch API limitation)"

patterns-established:
  - "File upload pattern: prepare → upload to API → confirm metadata"
  - "Request form creates request first, then allows file uploads"
  - "Files served via static paths: /uploads/[request-id]/[filename]"
  - "Local storage with directory auto-creation and .gitignore"

# Metrics
duration: 15min
completed: 2026-01-31
---

# Phase 02: Core Request Workflow - Plan 02 Summary

**Request creation form with local file storage using Next.js API routes and multipart form uploads**

## Performance

- **Duration:** 15 min
- **Started:** 2026-01-31T04:23:35Z
- **Completed:** 2026-01-31T04:38:00Z
- **Tasks:** 9
- **Files modified:** 10

## Accomplishments

- Migrated FileAttachment schema from S3 (s3Key) to local storage (filePath)
- Created local file storage utilities with automatic directory creation
- Built file upload API route with multipart form handling and validation
- Implemented file upload zone component with XHR progress tracking
- Created request form with Zod validation and file attachment support
- Set up request creation page with full form workflow

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate FileAttachment.s3Key to filePath** - `e1e88c4` (feat)
2. **Task 2: Create local file utilities** - `b962eb5` (feat)
3. **Task 3: Create file upload API route** - `117309a` (feat)
4. **Task 4: Update server actions for local storage** - `b9e70b8` (feat)
5. **Task 5: Update file upload zone for API route** - `d09cb45` (feat)
6. **Task 6: Create request form component** - `69800ea` (feat)
7. **Task 7: Create request server actions** - `5148624` (feat)
8. **Task 8: Create request creation page** - `ca742ef` (feat)
9. **Task 9: Update env config for local storage** - `7cd9c82` (chore)
10. **Task 10: Add .gitignore for uploads** - `29a8a4a` (chore)

**Plan metadata:** Not yet committed

## Files Created/Modified

### Created
- `lib/files.ts` - Local file storage utilities (saveFile, generateFilePath, getFileUrl)
- `app/api/upload/route.ts` - File upload API endpoint with multipart form handling
- `server-actions/files.ts` - Server actions for file upload preparation and confirmation
- `server-actions/requests.ts` - Server actions for request CRUD operations
- `components/requests/file-upload-zone.tsx` - File upload component with progress tracking
- `components/requests/request-form.tsx` - Request creation form with validation
- `app/(dashboard)/requests/new/page.tsx` - Request creation page
- `public/uploads/.gitignore` - Prevents committing uploaded files

### Modified
- `prisma/schema.prisma` - Changed s3Key to filePath in FileAttachment model
- `.env.local` - Removed AWS credentials, added UPLOAD_DIR configuration
- `prisma/migrations/20260131042445_change_s3key_to_filepath/` - Database migration

## Decisions Made

**Local Storage vs S3:**
- User approved switching from S3 to local file storage for easier deployment to company VPS
- No external dependencies or AWS setup required
- Files stored in public/uploads/[request-id]/ for organization
- Next.js serves files directly via static file serving
- Simplified operations: no presigned URLs, no CORS configuration

**File Upload Implementation:**
- Chose XHR over fetch for upload progress tracking (fetch API doesn't support progress events)
- API route handles multipart form data directly
- Three-step process: prepare (validation) → upload (save to disk) → confirm (save metadata to Prisma)
- File path stored in database instead of S3 key

**Validation & Security:**
- File type validation on server (PDF, Word, Excel, Images)
- 10MB file size limit enforced
- Request ownership verification before upload
- Auth checks on all server actions

## Deviations from Plan

### Major Modification: S3 → Local Storage

**User-Requested Change (not a deviation rule):**
- **Requested by:** User during plan execution
- **Change:** Replace all S3 functionality with local file storage
- **Reason:** Easier deployment to company VPS without AWS dependencies
- **Impact:** Complete rewrite of file storage layer

### Implementation Details

**1. Schema Changes (Task 1)**
- Created migration to change s3Key → filePath in FileAttachment model
- Migration `20260131042445_change_s3key_to_filepath` applied successfully
- Database updated to store local file paths instead of S3 keys

**2. File Utilities (Task 2)**
- Created lib/files.ts instead of lib/s3.ts
- Functions: getUploadDir, generateFilePath, saveFile, getFileUrl
- Uses Node.js fs/promises for file operations
- Automatic directory creation with mkdir recursive

**3. API Route (Task 3)**
- Created app/api/upload/route.ts instead of using S3 presigned URLs
- Handles multipart form data with Next.js API route
- Validates file type, size, and request ownership
- Saves files to public/uploads/[request-id]/ with UUID prefix

**4. Server Actions (Task 4)**
- Updated prepareFileUpload to return /api/upload endpoint URL (not presigned S3 URL)
- Updated confirmFileUpload to save filePath instead of s3Key
- Added getDownloadUrl for local file URLs
- Removed all S3 SDK imports and presigned URL generation

**5. File Upload Zone (Task 5)**
- Updated to POST to /api/upload instead of PUT to S3 presigned URL
- Uses XHR for progress tracking (same as original plan)
- Fixed duplicate upload bug during implementation
- Same UI/UX experience, different backend endpoint

**6. Request Form & Page (Tasks 6-8)**
- Same implementation as original plan
- No changes to form validation or submission flow
- Works with new local storage backend

**7. Environment Configuration (Task 9)**
- Removed AWS credentials from .env.local (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET)
- Added optional UPLOAD_DIR=public/uploads
- No external service setup required

**Total impact:** Complete file storage system rewrite (9 modified files, 1 migration)
**User approval:** Explicitly approved before execution

## Issues Encountered

**Gitignore for uploaded files:**
- Initial attempt to add public/uploads/.gitignore was blocked by git
- Root .gitignore or pattern was ignoring the file
- Resolved by using `git add -f` to force add the .gitignore
- Now user uploads won't be committed to repository

**Duplicate upload bug (fixed during Task 5):**
- Initially wrote XHR upload followed by fetch upload
- Caused duplicate uploads and potential errors
- Fixed by storing upload response from XHR and reusing it
- Committed in same task commit (d09cb45)

## Authentication Gates

None - all authentication handled by existing Clerk middleware

## User Setup Required

None - no external service configuration required for local storage

Previous plan would have required:
- AWS account setup
- S3 bucket creation
- IAM user with programmatic access
- CORS configuration for presigned URLs

All replaced with local file storage requiring zero setup.

## Next Phase Readiness

**Ready for 02-03 (Request List & Detail View):**
- Request creation fully functional with file attachments
- File metadata stored in database with filePath
- Downloads will work via local paths (/uploads/[request-id]/[filename])
- No S3 dependencies, simpler deployment

**Considerations for future:**
- Local files need backup strategy in production
- Disk space monitoring required
- File cleanup on request deletion (not implemented yet)
- Can migrate to S3 later if needed (schema supports both)

**Rollback instructions documented:**
If user wants S3 later:
1. Revert schema change (filePath → s3Key)
2. Restore lib/s3.ts from plan documentation
3. Revert server-actions/files.ts to use presigned URLs
4. Update file-upload-zone.tsx back to S3 presigned URLs
5. Configure AWS credentials in .env.local

---
*Phase: 02-core-request-workflow*
*Plan: 02*
*Completed: 2026-01-31*
