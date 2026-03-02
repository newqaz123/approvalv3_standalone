---
phase: 07-configuration-and-administration
plan: 03
subsystem: ui
tags: [dnd-kit, hierarchy, admin, workflow, read-only, drag-and-drop]

# Dependency graph
requires:
  - phase: 07-01
    provides: levelNames on Department schema, DepartmentApprover model
provides:
  - Hierarchy Management page at /admin/hierarchy (editable, admin-only)
  - Workflow page at /dashboard/workflow (read-only, all users)
  - readOnly prop on HierarchyView disabling drag-and-drop
  - customLabel prop on HierarchyColumn showing custom level names
  - DepartmentSelector client component for URL-based department switching
  - getHierarchyDataForUser server action (no admin restriction)
  - getDepartmentsForHierarchyView server action (role-scoped)
affects:
  - future phases using hierarchy display
  - navigation/menu updates to add workflow and hierarchy links

# Tech tracking
tech-stack:
  added: []
  patterns: [URL search params for department selection, conditional DndContext rendering for read-only mode]

key-files:
  created:
    - src/app/admin/hierarchy/page.tsx
    - src/app/(dashboard)/dashboard/workflow/page.tsx
    - src/components/admin/department-selector.tsx
  modified:
    - src/components/admin/hierarchy-view.tsx
    - src/components/admin/hierarchy-column.tsx
    - src/server-actions/hierarchy.ts

key-decisions:
  - "Render without DndContext in readOnly mode instead of just disabling sensors - cleaner, no DnD overhead for read-only users"
  - "URL-based department selection (?departmentId=) enables bookmarkable, shareable links"
  - "Workflow page placed at src/app/(dashboard)/dashboard/workflow/page.tsx to match actual route group structure"
  - "Role-scoped department visibility: admins/engineering see all, general users see own department"
  - "Added disabled prop to useDroppable in HierarchyColumn to prevent drop zone activation"

patterns-established:
  - "readOnly prop pattern: conditional DndContext wrapping for disabling drag-and-drop"
  - "Server action variants: getHierarchyData (admin-only) vs getHierarchyDataForUser (authenticated users)"

# Metrics
duration: 6min
completed: 2026-02-08
---

# Phase 07 Plan 03: Hierarchy Management Page and Read-Only Workflow View Summary

**Admin hierarchy management page at /admin/hierarchy with DnD editing, plus read-only /dashboard/workflow accessible to all users showing custom level names**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-08T04:54:38Z
- **Completed:** 2026-02-08T05:00:37Z
- **Tasks:** 3
- **Files modified:** 5 + created 3 = 8 total

## Accomplishments

- Hierarchy components enhanced with `readOnly` prop (disables DndContext entirely) and `customLabel` prop showing custom level names from department.levelNames
- Admin Hierarchy Management page at `/admin/hierarchy` with department selector dropdown and full drag-and-drop editing
- Read-only Workflow page at `/dashboard/workflow` available to all users showing department approval hierarchy

## Task Commits

Each task was committed atomically:

1. **Task 1: Enhance Hierarchy Components** - `4e99f66` (feat)
2. **Task 2: Create Admin Hierarchy Page (Editable)** - `cfa403f` (feat)
3. **Task 3: Create Read-Only Workflow View** - `8361dd8` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/components/admin/hierarchy-view.tsx` - Added readOnly prop, levelNames parsing, conditional DndContext
- `src/components/admin/hierarchy-column.tsx` - Added customLabel prop with "Level N" fallback, disabled useDroppable
- `src/server-actions/hierarchy.ts` - Added levelNames to return, plus getHierarchyDataForUser and getDepartmentsForHierarchyView
- `src/app/admin/hierarchy/page.tsx` - New admin hierarchy management page with department selector
- `src/app/(dashboard)/dashboard/workflow/page.tsx` - New read-only workflow view for all users
- `src/components/admin/department-selector.tsx` - New client component for URL-based department switching

## Decisions Made

- Render without DndContext entirely in readOnly mode - cleaner than disabling sensors, avoids DnD overhead for view-only users
- Used URL search params for department selection - bookmarkable, server-rendered, no client state
- Placed workflow page at `src/app/(dashboard)/dashboard/workflow/page.tsx` to match actual route group structure (not `src/app/dashboard/workflow/page.tsx` as specified in plan)
- Role-scoped visibility: admins and engineering see all departments in workflow view, general users see only their own
- Added `disabled` prop to `useDroppable` in HierarchyColumn to prevent drop targets activating when drag is disabled

## Deviations from Plan

### Path Correction

**1. [Rule 3 - Blocking] Workflow page placed in correct route group**
- **Found during:** Task 3 (Create Read-Only Workflow View)
- **Issue:** Plan specified `src/app/dashboard/workflow/page.tsx` but project uses `(dashboard)` route group - path `src/app/dashboard/` does not exist
- **Fix:** Created page at `src/app/(dashboard)/dashboard/workflow/page.tsx` which serves the same `/dashboard/workflow` URL
- **Files modified:** src/app/(dashboard)/dashboard/workflow/page.tsx
- **Verification:** TypeScript compiles without errors; path matches actual routing convention
- **Committed in:** 8361dd8 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking path correction)
**Impact on plan:** Path correction ensures page is reachable. No functionality change.

## Issues Encountered

None beyond the path correction above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Hierarchy management page and workflow view are complete
- Navigation links to /admin/hierarchy and /dashboard/workflow not yet added to Navbar (future task)
- Plans 07-04 and 07-05 can proceed independently

---
*Phase: 07-configuration-and-administration*
*Completed: 2026-02-08*
