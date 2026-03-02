---
phase: quick-019
plan: 01
subsystem: database
tags: [prisma, file-attachments, activity-log, timestamp-based-linking, data-integrity]

# Dependency graph
requires:
  - phase: 04-engineering-solutions
    provides: Solution and FileAttachment models with polymorphic relations
  - quick-018: properly fix attachment linking in submitSolution
    provides: Timestamp-based file linking using request.updatedAt
provides:
  - Fixed submitSolution() to use activity log for accurate SentToEngineer timestamp
  - File linking works correctly even with multiple status changes
  - Original request files appear only in Initial Request section
  - Solution files appear only in Engineering Solution section
  - Edge case handled: auto-approval → file upload → solution submission
affects: [engineering-workflow, file-upload-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Activity log-based timestamp queries for accurate state change tracking
    - Polymorphic file attachment ownership (one file belongs to EITHER request OR solution)
    - First occurrence queries using orderBy: { createdAt: 'asc' }

key-files:
  created: []
  modified:
    - src/server-actions/solutions.ts

key-decisions:
  - "Use requestActivity.findFirst to find FIRST status change to SentToEngineer"
  - "Query with action: 'status_changed' and toStatus: 'SentToEngineer' for accuracy"
  - "Files uploaded AFTER actual SentToEngineer timestamp are solution files"
  - "Multiple status changes no longer affect file categorization logic"

patterns-established:
  - "Activity log as source of truth for state change timestamps instead of model.updatedAt"
  - "First occurrence pattern: orderBy: { createdAt: 'asc' } for initial state change"

# Metrics
duration: 1min
completed: 2026-02-21
---

# Quick Task 019: Fix File Linking - Use Activity Log Timestamp Summary

**Fixed file linking in submitSolution() to use activity log for accurate SentToEngineer timestamp instead of request.updatedAt**

## Performance

- **Duration:** 1 minute (115 seconds)
- **Started:** 2026-02-21T09:58:58Z
- **Completed:** 2026-02-21T09:59:53Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Modified submitSolution() to query RequestActivity table for SentToEngineer timestamp
- Replaced request.updatedAt query with requestActivity.findFirst using action and toStatus filters
- Added orderBy: { createdAt: 'asc' } to get FIRST occurrence of status change
- File linking now uses sentToEngineerAt timestamp instead of requestData.updatedAt
- Edge case fixed: auto-approval → file upload → solution submission no longer miscategorizes files

## Task Commits

Each task was committed atomically:

1. **Task 1: Modify submitSolution() to use activity log for accurate SentToEngineer timestamp** - `ab61a9f` (fix)

**Plan metadata:** (no separate metadata commit for quick tasks)

## Files Created/Modified

- `src/server-actions/solutions.ts` - Replaced request.updatedAt query with requestActivity.findFirst for accurate SentToEngineer timestamp (lines 78-98)

## Code Changes

### src/server-actions/solutions.ts

**BEFORE (buggy code using request.updatedAt):**
```typescript
// Get the request to check when status changed to SentToEngineer
const requestData = await tx.request.findUnique({
  where: { id: validated.requestId },
  select: { updatedAt: true },
})

// Link files uploaded during solution submission to the solution
if (requestData) {
  await tx.fileAttachment.updateMany({
    where: {
      requestId: validated.requestId,
      solutionId: null,
      createdAt: { gt: requestData.updatedAt }, // WRONG: uses latest status change!
    },
    data: {
      solutionId: solution.id,
      requestId: null,
    },
  })
}
```

**AFTER (fixed code using activity log):**
```typescript
// Find when status first changed to SentToEngineer (from activity log)
const statusChangeActivity = await tx.requestActivity.findFirst({
  where: {
    requestId: validated.requestId,
    action: 'status_changed',
    toStatus: 'SentToEngineer',
  },
  select: {
    createdAt: true,
  },
  orderBy: {
    createdAt: 'asc', // Get the FIRST status change to SentToEngineer
  },
})

const sentToEngineerAt = statusChangeActivity?.createdAt

// Link files uploaded AFTER status changed to SentToEngineer to the solution
if (sentToEngineerAt) {
  await tx.fileAttachment.updateMany({
    where: {
      requestId: validated.requestId,
      solutionId: null,
      createdAt: { gt: sentToEngineerAt }, // CORRECT: uses actual SentToEngineer timestamp!
    },
    data: {
      solutionId: solution.id,
      requestId: null,
    },
  })
}
```

**Key improvements:**
1. Queries RequestActivity table instead of Request table
2. Filters by `action: 'status_changed'` and `toStatus: 'SentToEngineer'`
3. Orders by `createdAt: 'asc'` to get FIRST occurrence (not latest)
4. Uses `sentToEngineerAt` for file comparison (actual timestamp when status first changed)

## Decisions Made

- **Root cause:** In quick task 018, we used `request.updatedAt` which changes with EVERY status update, not just the first time it changed to SentToEngineer
- **Example bug scenario:**
  - Request created at 09:37:11
  - Auto-approved → status changed to SentToEngineer at 09:37:12 (1 second later!)
  - Requester uploaded IMG_7108.jpeg at 09:37:14 (thinking it was still initial stage)
  - Solution submitted at 09:39:47
  - Status changed to SendBackToRequester at 09:39:47 (request.updatedAt becomes 09:39:47)
  - **Bug:** File uploaded at 09:37:14 is compared to 09:39:47, incorrectly categorized as solution file
- **Fix strategy:** Query activity log to find ACTUAL timestamp when status first changed to SentToEngineer
- **Activity log benefits:**
  - Immutable record of all state changes
  - Each status change creates a new RequestActivity entry
  - Can query for FIRST occurrence using orderBy: { createdAt: 'asc' }

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - task completed successfully without issues.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- File linking logic now correctly identifies when status first changed to SentToEngineer
- Multiple status changes no longer break file categorization
- Edge case handled: auto-approval → file upload → solution submission
- Solution files uploaded after actual SentToEngineer timestamp are properly linked to solution
- Data integrity maintained: files have exactly ONE owner (requestId OR solutionId)

---
*Quick Task: 019-fix-file-linking-use-activity-log-timest*
*Completed: 2026-02-21*
