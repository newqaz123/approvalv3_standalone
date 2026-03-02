---
phase: 04-engineering-solutions
plan: 01
subsystem: database, server-actions, approvals
tags: [prisma, zod, server-actions, custom-approval-chains, engineering-workflow]

# Dependency graph
requires:
  - phase: 03-approval-engine
    provides: Request model with approval chain pattern, RequestApproval model, UserRole enum
provides:
  - Solution model for engineering solutions with cost estimates and timeline
  - SolutionApproval model supporting both hierarchy-based and custom sequential approval chains
  - RequestEngineerAssignment join table for engineer-to-request assignment tracking
  - Extended FileAttachment model supporting solution file attachments
  - Solution server actions (submitSolution, getSolutionByRequestId, getSolutionApprovals, etc.)
  - New RequestStatus values (DesignCostEstimationApproval, FinalApproval)
affects: [04-02, 04-03, 04-04, 04-05, 04-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Custom approval chain pattern with sequential approver ordering
    - Dual approval model support (requiredLevel for hierarchy, requiredApproverId for custom)
    - Transaction-based solution creation with approval chain generation
    - Auto-approval for top-level submitters in hierarchy chains

key-files:
  created:
    - src/server-actions/solutions.ts
  modified:
    - prisma/schema.prisma
    - src/components/requests/status-badge.tsx

key-decisions:
  - "Solution model uses separate table instead of columns on Request - enables multiple solution versions if needed, cleaner audit trail"
  - "SolutionApproval uses requiredLevel (nullable) + requiredApproverId (nullable) pattern - single model supports both hierarchy and custom chains"
  - "FileAttachment extended with optional solutionId - keeps single file table, query by requestId still works for request files"
  - "Custom chain automatically filters out submitter - prevents self-approval blocking submission"

patterns-established:
  - "Pattern 1: Custom approval chain creation - sequential order field with requiredApproverId for specific users"
  - "Pattern 2: Dual approval model - nullable requiredLevel (hierarchy) and nullable requiredApproverId (custom) in same model"
  - "Pattern 3: Transaction-based workflow transition - create solution, create approvals, update request status atomically"

# Metrics
duration: 18min
completed: 2026-02-02
---

# Phase 4 Plan 1: Solution Data Model and Custom Approval Chains Summary

**Prisma schema with Solution, SolutionApproval, RequestEngineerAssignment models and server actions for custom approval chain creation**

## Performance

- **Duration:** 18 min
- **Started:** 2026-02-02T09:27:48Z
- **Completed:** 2026-02-02T09:45:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Extended Prisma schema with Solution model for engineering solutions with costEstimate (Decimal), currency, timeline, and conceptDesign fields
- Created SolutionApproval model supporting both hierarchy-based approvals (requiredLevel) and custom sequential chains (requiredApproverId)
- Added RequestEngineerAssignment join table for engineer-to-request assignment tracking
- Extended FileAttachment model with optional solutionId for solution file attachments
- Created solutions.ts server actions with submitSolution, custom approval chain creation, and approval workflow functions
- Added DesignCostEstimationApproval and FinalApproval to RequestStatus enum
- Added solution_ready and final_approval_needed to NotificationType enum

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend Prisma schema with Solution model and approval chain enhancements** - `996d6f3` (feat)
2. **Task 2: Create solution server actions with custom approval chain support** - `c1db6a8` (feat)

## Files Created/Modified

- `prisma/schema.prisma` - Extended with Solution, SolutionApproval, RequestEngineerAssignment models; new RequestStatus and NotificationType values
- `src/server-actions/solutions.ts` - Solution submission, custom approval chain creation, approval workflow functions
- `src/components/requests/status-badge.tsx` - Added DesignCostEstimationApproval and FinalApproval status badges

## Decisions Made

- **Solution as separate model:** Chose separate Solution table instead of columns on Request - enables cleaner audit trail, supports multiple solution versions if needed later
- **Dual approval pattern:** Used nullable requiredLevel + nullable requiredApproverId in same model - single table supports both hierarchy and custom chains, simpler query patterns
- **FileAttachment extension:** Extended with optional solutionId rather than separate table - keeps single file metadata table, existing request file queries unaffected
- **Auto-filter submitter:** Custom approval chains automatically exclude submitter - prevents self-approval blocking submission, better UX

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added new status values to StatusBadge component**
- **Found during:** Task 1 (schema extension)
- **Issue:** New RequestStatus values (DesignCostEstimationApproval, FinalApproval) caused TypeScript errors in StatusBadge component
- **Fix:** Added status configurations for new enum values with appropriate colors (purple, indigo)
- **Files modified:** src/components/requests/status-badge.tsx
- **Verification:** TypeScript compiles without errors, all status values have badge definitions
- **Committed in:** 996d6f3 (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Auto-fix was necessary for TypeScript compilation after schema changes. No scope creep.

## Issues Encountered

None - plan executed smoothly with only expected TypeScript updates needed for new enum values.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Solution data model complete with all required fields (title, description, costEstimate, currency, timeline, conceptDesign)
- Custom approval chain infrastructure in place with both requiredLevel (hierarchy) and requiredApproverId (custom) support
- Server actions ready for solution submission and approval workflow
- Ready for 04-02 (Solution submission form UI) and 04-03 (Engineering dashboard)

---
*Phase: 04-engineering-solutions*
*Completed: 2026-02-02*
