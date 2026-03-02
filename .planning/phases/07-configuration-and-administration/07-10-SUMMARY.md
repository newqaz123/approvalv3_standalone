---
phase: 07-configuration-and-administration
plan: 10
subsystem: admin
tags: [hierarchy, validation, external-approvers, badge, ui]

# Dependency graph
requires:
  - phase: 07-configuration-and-administration (plans 07-08, 07-09)
    provides: Hierarchy board with drag-and-drop, batch save, DepartmentApprover model
provides:
  - Relaxed hierarchy validation allowing gaps and non-Level-1 starts
  - External badge on hierarchy user cards for cross-department approvers
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Relaxed validation pattern: approval engine handles gaps, validation only enforces minimum requirements"

key-files:
  created: []
  modified:
    - src/server-actions/hierarchy.ts
    - src/components/admin/hierarchy-column.tsx
    - src/components/admin/hierarchy-user-card.tsx

key-decisions:
  - "Removed three overly strict validation rules rather than relaxing them - approval engine already handles gaps gracefully"
  - "Used orange color scheme (border-orange-300, text-orange-600, bg-orange-50) for External badge to visually distinguish cross-department approvers"

patterns-established: []

# Metrics
duration: 1min
completed: 2026-02-11
---

# Phase 7 Plan 10: Hierarchy Validation & External Badge Gap Closure Summary

**Relaxed hierarchy validation to allow gaps/non-Level-1 starts, added orange External badge on cross-department approver cards**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-11T15:16:30Z
- **Completed:** 2026-02-11T15:17:15Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Removed three overly strict validation checks from `validateHierarchyUpdates` that blocked legitimate hierarchy configurations (must-start-at-Level-1, no-gaps, no-empty-levels)
- Hierarchy validation now only rejects empty hierarchies (zero approvers), relying on the approval engine to skip empty levels gracefully
- Added orange "External" badge to hierarchy user cards for DepartmentApprover users, completing the data flow from `getHierarchyData()` through `hierarchy-column.tsx` to `hierarchy-user-card.tsx`

## Task Commits

Each task was committed atomically:

1. **Task 1: Relax hierarchy validation rules** - `b833459` (fix)
2. **Task 2: Add External badge to hierarchy user cards** - `7d6763e` (feat)

## Files Created/Modified
- `src/server-actions/hierarchy.ts` - Removed 3 overly strict validation rules from validateHierarchyUpdates, keeping only zero-approver check
- `src/components/admin/hierarchy-column.tsx` - Added `isExternal?: boolean` to User interface so prop flows through to card
- `src/components/admin/hierarchy-user-card.tsx` - Added `isExternal?: boolean` to props, imported Badge, renders orange "External" badge conditionally

## Decisions Made
- Removed validation rules entirely rather than relaxing them. The approval engine (`createApprovalChain` in `approvals.ts`) already handles gaps by skipping levels with no approvers (`if (hasInternalUsers || hasExternalApprovers)`), making these validation rules redundant and unnecessarily restrictive.
- Used orange color scheme for the External badge to clearly distinguish cross-department approvers from internal department members without being visually intrusive.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both UAT-identified gaps are now closed
- Hierarchy management feature is complete with flexible validation and clear visual indicators for external approvers
- No blockers remain

---
*Phase: 07-configuration-and-administration*
*Completed: 2026-02-11*
