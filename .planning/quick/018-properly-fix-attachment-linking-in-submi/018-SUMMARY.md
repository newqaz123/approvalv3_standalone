---
phase: quick-018
plan: 01
subsystem: database
tags: [prisma, file-attachments, timestamp-based-linking, data-integrity]

# Dependency graph
requires:
  - phase: 04-engineering-solutions
    provides: Solution and FileAttachment models with polymorphic relations
  - quick-017: fix attachment duplication bug
    provides: Cleaned database without duplicate attachments
provides:
  - Fixed submitSolution() to link recently uploaded files to solution using timestamps
  - Original request files appear only in Initial Request section
  - Solution files appear only in Engineering Solution section
  - No file duplication occurs
affects: [engineering-workflow, file-upload-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Timestamp-based file ownership determination (file.createdAt vs request.updatedAt)
    - Polymorphic file attachment ownership (one file belongs to EITHER request OR solution)

key-files:
  created: []
  modified:
    - src/server-actions/solutions.ts

key-decisions:
  - "Use request.updatedAt timestamp to determine when status changed to SentToEngineer"
  - "Files uploaded AFTER status change are solution files (set solutionId, clear requestId)"
  - "Files uploaded BEFORE status change are request files (keep requestId only)"

patterns-established:
  - "Timestamp comparison for file categorization: createdAt > request.updatedAt when status changed"

# Metrics
duration: 12s
completed: 2026-02-21
---

# Quick Task 018: Properly Fix Attachment Linking in submitSolution Summary

**Fixed attachment linking in submitSolution() to distinguish between original request files and solution files using timestamps**

## Performance

- **Duration:** 12 seconds
- **Started:** 2026-02-21T04:54:41Z
- **Completed:** 2026-02-21T04:54:53Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Modified submitSolution() to get request's updatedAt timestamp (when status changed to SentToEngineer)
- Added logic to link files uploaded AFTER that timestamp to the solution
- Files are correctly categorized based on upload timestamp vs status change timestamp
- Original request files keep requestId only (appear in Initial Request section)
- Solution files get solutionId set and requestId cleared (appear in Engineering Solution section)

## Task Commits

Each task was committed atomically:

1. **Task 1: Modify submitSolution() to link recently uploaded files to solution** - `e20bdb9` (fix)

**Plan metadata:** (no separate metadata commit for quick tasks)

## Files Created/Modified

- `src/server-actions/solutions.ts` - Added timestamp-based file linking logic after solution creation (lines 78-112)

## Code Changes

### src/server-actions/solutions.ts

Added logic in the transaction after solution creation:

```typescript
// Get the request to check when status changed to SentToEngineer
const requestData = await tx.request.findUnique({
  where: { id: validated.requestId },
  select: { updatedAt: true },
})

// Create solution record
const solution = await tx.solution.create({...})

// Link files uploaded during solution submission to the solution
// Files uploaded AFTER status changed to SentToEngineer are solution files
if (requestData) {
  await tx.fileAttachment.updateMany({
    where: {
      requestId: validated.requestId,
      solutionId: null,
      createdAt: { gt: requestData.updatedAt },
    },
    data: {
      solutionId: solution.id,
      requestId: null,
    },
  })
}
```

**Logic:**
1. Get request's updatedAt timestamp (when status changed to SentToEngineer)
2. Find files where:
   - requestId matches the request
   - createdAt is AFTER the request's updatedAt
   - solutionId is null (not already linked)
3. Update those files to:
   - Set solutionId to the newly created solution.id
   - Set requestId to null (clear request association to prevent duplication)

## Decisions Made

- **Root cause:** In quick task 017, we removed the file linking code to fix duplication, but this broke solution file uploads
- **Fix strategy:** Use timestamps to distinguish between original request files (uploaded before status change) and solution files (uploaded during solution form submission)
- **Timestamp comparison:** `file.createdAt > request.updatedAt` identifies solution files
- **Clear requestId:** Setting requestId to null prevents duplication in request file list

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - task completed successfully without issues.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Attachment linking now properly distinguishes between request files and solution files
- Solution files uploaded during form submission appear in Engineering Solution section
- Original request files appear only in Initial Request section
- No file duplication occurs
- Data integrity maintained: files have exactly ONE owner (requestId OR solutionId)

---
*Quick Task: 018-properly-fix-attachment-linking-in-submi*
*Completed: 2026-02-21*
