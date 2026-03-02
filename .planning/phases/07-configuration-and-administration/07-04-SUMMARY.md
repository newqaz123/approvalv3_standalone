---
phase: 07-configuration-and-administration
plan: 04
subsystem: ui, database, api
tags: [prisma, dnd-kit, server-actions, approval-engine, department-approver]

# Dependency graph
requires:
  - phase: 07-01
    provides: DepartmentApprover schema model, levelNames, isArchived on Request
  - phase: 07-03
    provides: Hierarchy management page with drag-and-drop HierarchyView component
provides:
  - getDepartmentHierarchy server action (internal + external approvers unified)
  - updateHierarchy server action (batch with validation)
  - HierarchyBoard component supporting external approver display and drag-and-drop
  - Approval engine recognizes DepartmentApprover records as valid approvers
affects:
  - approval workflow
  - cross-department approver assignments

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unified approver resolution: check both User.level and DepartmentApprover for any given level"
    - "Optimistic UI update with rollback on server action failure"

key-files:
  created:
    - src/components/admin/hierarchy/HierarchyBoard.tsx
  modified:
    - src/server-actions/hierarchy.ts
    - src/server-actions/approvals.ts
    - src/components/admin/hierarchy-view.tsx

key-decisions:
  - "External approvers identified by isExternal flag on HierarchyUser; drag routes to updateHierarchy for DepartmentApprover upsert"
  - "canUserApprove resolves cross-dept approval via DepartmentApprover lookup when user not in request department"
  - "Validation order: continuous levels, no empty levels, then persist"

patterns-established:
  - "Approver resolution pattern: always query both internal users and DepartmentApprover for a given level"

# Metrics
duration: 9min
completed: 2026-02-08
---

# Phase 07 Plan 04: Hierarchy Backend Integration Summary

**Drag-and-drop hierarchy persistence with external DepartmentApprover support and approval engine recognizing cross-department approvers**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-08T09:29:59Z
- **Completed:** 2026-02-08T09:38:03Z
- **Tasks:** 3
- **Files modified:** 4 (1 created)

## Accomplishments
- Server actions fetch and persist hierarchy data for both internal and external (DepartmentApprover) users
- HierarchyBoard component shows external approvers with "External" badge and routes drag updates correctly
- Approval engine (canUserApprove, createApprovalChain, getApproversAtLevel) considers DepartmentApprover records at every decision point

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement Hierarchy Persistence Logic** - `f8f8505` (feat)
2. **Task 2: Wire UI to Server Actions** - `12e62b8` (feat)
3. **Task 3: Update Approval Engine Logic** - `c128c13` (feat)

## Files Created/Modified
- `src/server-actions/hierarchy.ts` - Added getDepartmentHierarchy, updateHierarchy, validateHierarchyUpdates; updated getHierarchyData to include DepartmentApprovers
- `src/server-actions/approvals.ts` - Updated getMaxLevelInDepartment, createApprovalChain, getApproversAtLevel, canUserApprove, getRequestApprovals
- `src/components/admin/hierarchy-view.tsx` - Updated User interface with isExternal, onDragEnd routes external users through updateHierarchy
- `src/components/admin/hierarchy/HierarchyBoard.tsx` - New self-contained board component with External badge display

## Decisions Made
- External approvers in drag-and-drop are identified via `isExternal` boolean on the user object and routed through `updateHierarchy` (DepartmentApprover upsert) vs `updateUserLevel` (User.level update)
- `canUserApprove` now checks if user belongs to the request's department first; if not, falls back to `DepartmentApprover` lookup to determine effective level
- Validation rejects hierarchies with level gaps or empty levels to prevent broken approval chains

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 07 is now complete (all 5 plans done)
- Hierarchy configuration fully drives approval engine including cross-department approvers
- Admin can assign external approvers via hierarchy board drag-and-drop

---
*Phase: 07-configuration-and-administration*
*Completed: 2026-02-08*
