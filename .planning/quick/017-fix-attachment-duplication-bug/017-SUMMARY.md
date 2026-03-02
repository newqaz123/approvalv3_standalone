---
phase: quick-017
plan: 01
subsystem: database
tags: [prisma, file-attachments, polymorphic-relations, data-integrity]

# Dependency graph
requires:
  - phase: 04-engineering-solutions
    provides: Solution and FileAttachment models with polymorphic relations
provides:
  - Fixed submitSolution() to preserve request attachment ownership
  - New confirmSolutionFileUpload() for solution-specific file uploads
  - Database cleanup script to fix existing duplicate attachments
  - Verified data integrity: all files have exactly ONE owner (requestId OR solutionId)
affects: [engineering-workflow, file-upload-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Polymorphic file attachment ownership (one file belongs to EITHER request OR solution)
    - Time-based duplicate resolution logic (file upload time vs solution creation time)

key-files:
  created:
    - scripts/fix-attachment-duplicates.ts
  modified:
    - src/server-actions/solutions.ts
    - src/server-actions/files.ts

key-decisions:
  - "Files uploaded with initial request only appear in Initial Request section"
  - "Files uploaded during solution submission only appear in Engineering Solution section"
  - "Database cleanup uses timestamp-based logic to determine original ownership"

patterns-established:
  - "Polymorphic relation pattern: FileAttachment has requestId OR solutionId (never both)"
  - "Explicit null setting: confirmSolutionFileUpload sets requestId: null to prevent duplication"

# Metrics
duration: 8min
completed: 2026-02-21
---

# Quick Task 017: Fix Attachment Duplication Bug Summary

**Fixed attachment duplication bug where files appeared in both Initial Request and Engineering Solution sections by removing problematic updateMany query and adding solution-specific file upload function**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-21T10:30:00Z
- **Completed:** 2026-02-21T10:38:00Z
- **Tasks:** 3
- **Files modified:** 2 modified, 1 created

## Accomplishments

- Fixed submitSolution() to stop adding solutionId to ALL request attachments
- Added confirmSolutionFileUpload() for solution-specific file uploads with requestId: null
- Created and ran cleanup script that fixed 5 duplicate attachments
- Verified data integrity: 0 duplicates remain in database

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix submitSolution() to preserve request attachment ownership** - `b2a4472` (fix)
2. **Task 2: Add confirmSolutionFileUpload() for solution-specific file uploads** - `de853a9` (feat)
3. **Task 3: Create database cleanup script to fix existing duplicates** - `cfa9f63` (feat)

**Plan metadata:** (no separate metadata commit for quick tasks)

## Files Created/Modified

- `src/server-actions/solutions.ts` - Removed lines 92-103 that set solutionId on all request attachments
- `src/server-actions/files.ts` - Added confirmSolutionFileUpload() function and ConfirmSolutionFileUploadInput interface
- `scripts/fix-attachment-duplicates.ts` - Database cleanup script with timestamp-based ownership logic

## Decisions Made

- **Root cause identified:** Lines 96-103 in solutions.ts used updateMany to set solutionId on ALL files with a given requestId, including original request files
- **Fix strategy:** Remove the problematic updateMany entirely. File linking should happen during upload via confirmFileUpload (for requests) or confirmSolutionFileUpload (for solutions)
- **Cleanup logic:** Use timestamp comparison (file createdAt vs solution createdAt) to determine whether a duplicate is a request file or solution file

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tasks completed successfully without issues.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Attachment duplication bug fully resolved
- Database cleanup completed: 5 duplicates fixed, 0 remaining
- Schema supports polymorphic relations correctly (files belong to EITHER request OR solution, never both)
- Future solution submissions should use confirmSolutionFileUpload() for file uploads to prevent duplication

---
*Quick Task: 017-fix-attachment-duplication-bug*
*Completed: 2026-02-21*
