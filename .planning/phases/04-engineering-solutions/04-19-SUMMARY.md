---
phase: 04-engineering-solutions
plan: 19
subsystem: ui
tags: [clerk, prisma, react, state-management, role-based-authorization]

# Dependency graph
requires:
  - phase: 04-engineering-solutions
    provides: Engineering workflow, request detail modal, solution submission
provides:
  - Fixed submit button visibility for engineering users via Prisma fallback API
  - Enhanced userRole state management with proper dependency tracking
  - Robust authorization using Prisma as source of truth when Clerk metadata is stale
affects: []

# Tech tracking
tech-stack:
  added: [/api/user/role endpoint]
  patterns: [Prisma as source of truth for role data, state management with useEffect dependency tracking, fallback API for stale client data]

key-files:
  created:
    - src/app/api/user/role/route.ts
  modified:
    - src/components/requests/request-detail-modal.tsx

key-decisions:
  - "Use Prisma as source of truth for user role when Clerk metadata is stale"
  - "Add API endpoint for client-side role fetching as fallback mechanism"
  - "Enhance debug logging for submit button visibility troubleshooting"

patterns-established:
  - "Pattern: Fallback API for client-side stale data - query server when client cache is unreliable"
  - "Pattern: State management with useEffect for reactive updates when dependent data changes"

# Metrics
duration: 45min
completed: 2026-02-05
---

# Phase 04: Plan 19 Summary

**Fixed engineering user submit button visibility using Prisma fallback API when Clerk metadata is stale, with enhanced state management**

## Performance

- **Duration:** 45 min
- **Started:** 2026-02-05T22:01:00Z
- **Completed:** 2026-02-05T22:46:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- **Fixed submit button visibility** for engineering users by implementing Prisma fallback API endpoint
- **Enhanced userRole state management** with proper useEffect dependency tracking on user changes
- **Added comprehensive debug logging** for submit button visibility troubleshooting
- **Ensured all engineering users** can see submit button (not just top-level, per business requirements)

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert userRole to state with proper dependency tracking** - `135dba1` (feat)

**Plan metadata:** [To be committed]

## Files Created/Modified

- `src/app/api/user/role/route.ts` - New API endpoint to fetch user role from Prisma (source of truth) when Clerk metadata is stale
- `src/components/requests/request-detail-modal.tsx` - Enhanced userRole state management with Prisma fallback API call and comprehensive debug logging

## Devisions Made

- **Use Prisma as source of truth for user role** - When Clerk's publicMetadata is stale after admin updates user role, query Prisma directly for the current role value
- **Add API endpoint for client-side role fetching** - Created `/api/user/role` endpoint that queries Prisma User.role field as fallback mechanism
- **Enhance debug logging** - Added comprehensive logging for submit button visibility check to help troubleshoot role-related issues in future

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added Prisma fallback API for stale Clerk metadata**
- **Found during:** Task 1 (Submit button visibility testing)
- **Issue:** Initial plan only added state management, but testing revealed Clerk's publicMetadata can be stale after admin updates user role. Direct extraction from Clerk object didn't reflect Prisma (source of truth)
- **Fix:**
  - Created `/api/user/role/route.ts` API endpoint that queries Prisma User.role directly
  - Modified `loadRequest()` to fetch user role from API as fallback when Clerk metadata might be stale
  - Added comprehensive debug logging to track role values from both sources (Clerk: [value], Prisma: [value], Final: [value])
- **Files modified:**
  - src/app/api/user/role/route.ts (created)
  - src/components/requests/request-detail-modal.tsx (enhanced loadRequest with API call)
- **Verification:**
  - Test 1 passed: Top-level engineering user can see submit button
  - Test 2 passed: All engineering users (not just top-level) can see submit button
  - Test 3 passed: Non-engineering users do not see submit button
- **Committed in:** `135dba1` (part of Task 1 commit)

**Rationale:** This deviation was necessary because the original plan only addressed the reactive state management issue (useState + useEffect) but didn't account for Clerk metadata staleness. When admins update user roles in the admin panel, the change is written to Prisma immediately but Clerk's publicMetadata may not refresh immediately. By adding a Prisma fallback API, we ensure the UI always reflects the current role from the source of truth, making the system more robust and reliable.

---

**Total deviations:** 1 auto-fixed (1 missing critical functionality)
**Impact on plan:** Deviation was critical for correctness - Clerk metadata staleness is a known issue in Clerk-powered apps. The Prisma fallback ensures authorization always reflects current database state.

## Issues Encountered

**Issue: Initial state management fix didn't resolve button visibility**
- **Root cause:** Clerk's publicMetadata was stale after admin role updates, so even with proper state management, the value being set was outdated
- **Resolution:** Added Prisma fallback API to fetch current role from database as source of truth
- **Learning:** In Clerk integrations where admin operations update roles, always use database (not Clerk metadata) as authorization source of truth

## User Setup Required

None - no external service configuration required.

## Test Results

All UAT tests passed:

1. **Test 1: Top-level engineering user submit button** - PASSED
   - Top-level engineering users can see green "Submit Solution" button
   - Button displays correctly when request status is "SentToEngineer"

2. **Test 2: All engineering users can see submit button** - PASSED
   - Engineering users at any hierarchy level can see submit button
   - This matches business requirements (not restricted to top-level only)

3. **Test 3: Non-engineering users don't see submit button** - PASSED
   - Non-engineering users correctly don't see the submit button
   - Authorization is properly enforced

## Next Phase Readiness

- Submit button visibility issue fully resolved with robust Prisma fallback
- Ready for Phase 05: Dashboard & Visibility
- No blockers or concerns

---
*Phase: 04-engineering-solutions*
*Completed: 2026-02-05*
