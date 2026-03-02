---
phase: quick
plan: 014
subsystem: admin-ui
tags: [prisma, departmentApprover, cross-department, shadcn-ui, server-actions]

# Dependency graph
requires:
  - phase: 07-configuration-and-administration
    provides: DepartmentApprover model and hierarchy management
provides:
  - Admin UI for managing cross-department approver assignments from user edit dialog
  - Server actions for DepartmentApprover CRUD with role-based validation
  - User table badge showing additional department count
affects: [hierarchy-management, approval-engine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useTransition for non-blocking server action calls in add/remove operations"
    - "Role-based department filtering in UI dropdown matching server-side validation"

key-files:
  created:
    - src/server-actions/department-assignments.ts
    - src/components/admin/additional-departments-section.tsx
  modified:
    - src/components/admin/edit-user-dialog.tsx
    - src/components/admin/user-table.tsx
    - src/server-actions/users.ts

key-decisions:
  - "Server-side eng/general separation enforced in addUserToDepartment; client dropdown pre-filters for UX"
  - "Admin role bypasses eng/general check but still blocked from home dept assignment"
  - "useTransition for add/remove keeps UI responsive during server action calls"

patterns-established:
  - "AdditionalDepartmentsSection as reusable pattern for managing cross-entity assignments with inline add/remove"

# Metrics
duration: 3min
completed: 2026-02-12
---

# Quick Task 014: Add Multi-Department Assignment UI Summary

**Cross-department approver assignment UI in Edit User dialog with server-side eng/general separation enforcement and user table badge indicator**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-12T12:23:11Z
- **Completed:** 2026-02-12T12:25:41Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Three server actions (get/add/remove) for managing DepartmentApprover records with proper admin auth and validation
- AdditionalDepartmentsSection component with current assignments list, filtered add form, and remove buttons
- Edit User dialog now shows additional department assignments below the user form
- User table displays "+N dept(s)" badge when a user has cross-department assignments

## Task Commits

Each task was committed atomically:

1. **Task 1: Create server actions for additional department management** - `8256989` (feat)
2. **Task 2: Create AdditionalDepartmentsSection component and integrate into EditUserDialog** - `6d0392b` (feat)

## Files Created/Modified
- `src/server-actions/department-assignments.ts` - Server actions for getUserAdditionalDepartments, addUserToDepartment, removeUserFromDepartment
- `src/components/admin/additional-departments-section.tsx` - Client component for viewing/adding/removing additional department assignments
- `src/components/admin/edit-user-dialog.tsx` - Added AdditionalDepartmentsSection below UserForm, scrollable dialog
- `src/components/admin/user-table.tsx` - Added "Additional Depts" column with Badge indicator
- `src/server-actions/users.ts` - Updated getUsers() to include _count of departmentApproverRoles, updated UserWithDepartment type

## Decisions Made
- Server-side engineering/general separation enforced in addUserToDepartment server action; client-side dropdown pre-filters for UX consistency
- Admin role bypasses eng/general department type check but still cannot be added to their own home department
- Used useTransition for add/remove operations to keep UI responsive during server action calls
- Inline error display matches existing user-form.tsx pattern (red box with border)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Multi-department assignment UI fully functional from admin user management
- Hierarchy page already displays cross-department approvers (built in Phase 7)
- No blockers identified

---
*Quick Task: 014*
*Completed: 2026-02-12*
