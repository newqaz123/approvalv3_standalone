---
phase: quick
plan: 002
subsystem: api
tags: [prisma, server-actions, authorization, visibility, custom-approval-chains]

# Dependency graph
requires:
  - phase: 04-05
    provides: Custom approval chains for final department approval
  - phase: 04-01
    provides: Solution approval model with custom chains
provides:
  - Cross-department request visibility for custom approval chain members
  - Updated visibility logic in getMyRequests() and getDashboardRequests()
  - Updated action items logic in getMyActionItems() and getPendingMyApprovals()
affects: [dashboard, requests, approvals]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OR clause visibility pattern for cross-department approvers"
    - "Conditional OR query building for hierarchy and custom chain approvals"

key-files:
  created: []
  modified:
    - src/server-actions/requests.ts
    - src/server-actions/dashboard.ts

key-decisions:
  - "Use Prisma nested relation filtering with OR clause for cross-department visibility"
  - "Support users without level field by conditionally including level check in OR conditions"
  - "Apply same visibility pattern to both requests page and dashboard for consistency"

patterns-established:
  - "OR-based visibility: departmentId match OR requiredApproverId in request approvals OR requiredApproverId in solution approvals"
  - "Conditional OR conditions: Include hierarchy-based checks only if user has a level"

# Metrics
duration: 1min
completed: 2026-02-06
---

# Quick Task 002: Cross-Department Visibility for Custom Approval Chains

**Users in custom approval chains can now see and act on cross-department requests via OR clause visibility filtering**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-06T10:24:34Z
- **Completed:** 2026-02-06T10:25:34Z
- **Tasks:** 2 (combined in single commit)
- **Files modified:** 2

## Accomplishments
- General department users in custom approval chains can see requests from other departments
- Updated visibility logic in 4 functions: getMyRequests, getAllRequests (dashboard), getMyActionItems, getPendingMyApprovals
- Users not in cross-department chains maintain existing department-scoped visibility
- Admin and engineering users retain existing "see all" permissions

## Task Commits

1. **Tasks 1 & 2: Update visibility logic for custom approval chains** - `a54f28e` (feat)

## Files Created/Modified
- `src/server-actions/requests.ts` - Updated getMyRequests() and getMyActionItems() with OR clause for cross-department custom approvers
- `src/server-actions/dashboard.ts` - Updated getAllRequests() and getPendingMyApprovals() with OR clause for cross-department custom approvers

## Decisions Made

**Used Prisma nested relation filtering for visibility:**
- `approvals.some.requiredApproverId` for request approval chain membership
- `solutions.some.approvals.some.requiredApproverId` for solution approval chain membership
- Generates efficient SQL EXISTS subqueries

**Support users without hierarchy level:**
- Changed early return from `if (!user || !user.level)` to `if (!user)`
- Build conditional OR array that always includes `requiredApproverId` check
- Only add `requiredLevel` check if user has a level value
- Enables custom chain approvals for users without hierarchy position

**Consistency across pages:**
- Applied same OR pattern to both `/requests` (getMyRequests) and `/dashboard` (getAllRequests)
- Applied same OR pattern to both action item queries (getMyActionItems, getPendingMyApprovals)
- Ensures uniform visibility regardless of entry point

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - TypeScript and Prisma validation passed on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Cross-department custom approval chains are now fully functional:
- Users can see cross-department requests they're assigned to approve
- Users can act on cross-department approvals from their action items
- Existing department boundaries maintained for users not in custom chains
- No visibility regressions for admin or engineering roles

---
*Phase: quick*
*Completed: 2026-02-06*
