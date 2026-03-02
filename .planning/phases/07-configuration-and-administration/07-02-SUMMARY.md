---
phase: 07-configuration-and-administration
plan: 02
subsystem: ui
tags: [admin, forms, react-hook-form, zod, shadcn, tanstack-table]

# Dependency graph
requires:
  - phase: 07-01
    provides: levelNames on Department schema, level on User schema
provides:
  - Edit dialogs for departments and users with pencil trigger buttons
  - Department form with approval level names configuration (up to 5 levels)
  - User form with approval level input field
  - Department table with Levels column showing configuration status
  - User table with Level column showing assigned level
affects:
  - 07-03-05: Level configuration UI foundation for future hierarchy management features

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Edit dialog pattern: Dialog wrapping existing form component with initialData prop
    - Level names as dynamic key-value list with add/remove functionality
    - Conditional field rendering: show level input only when department is selected

key-files:
  created:
    - src/components/admin/edit-department-dialog.tsx
    - src/components/admin/edit-user-dialog.tsx
  modified:
    - src/components/admin/department-form.tsx
    - src/components/admin/department-table.tsx
    - src/components/admin/user-form.tsx
    - src/components/admin/user-table.tsx
    - src/server-actions/departments.ts
    - src/server-actions/users.ts
    - src/app/admin/users/page.tsx

key-decisions:
  - "Level names stored as Record<string, string> mapping level number to display name"
  - "levelNames rendered as dynamic add/remove list (up to 5) in DepartmentForm"
  - "User level input shown conditionally only when department is selected"
  - "z.number() instead of z.coerce.number() to avoid Zod type inference issue with react-hook-form"

patterns-established:
  - "Edit dialog pattern: small pencil button opens Dialog wrapping existing Form component"
  - "Tables now accept departments prop to enable edit dialogs with full department list"

# Metrics
duration: 4min
completed: 2026-02-08
---

# Phase 07 Plan 02: Admin Management UI Enhancement Summary

**Department and User edit dialogs with level name configuration (levelNames JSON) and approval level assignment via enhanced admin forms**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-08T04:54:04Z
- **Completed:** 2026-02-08T04:58:04Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Added level names configuration UI to DepartmentForm (dynamic list up to 5 levels, add/remove)
- Created EditDepartmentDialog and EditUserDialog wrapping their respective forms
- Added "Level" column to UserTable and "Levels" column to DepartmentTable
- Updated updateDepartment and updateUser server actions to persist levelNames and level to Prisma

## Task Commits

Each task was committed atomically:

1. **Task 1: Enhance Department Form & Create Edit Dialog** - `b232ebd` (feat)
2. **Task 2: Enhance User Form & Create Edit Dialog** - `c80983b` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `src/components/admin/department-form.tsx` - Added levelNames dynamic list with add/remove
- `src/components/admin/edit-department-dialog.tsx` - New dialog wrapping DepartmentForm with pencil trigger
- `src/components/admin/department-table.tsx` - Added Levels column and EditDepartmentDialog in actions
- `src/server-actions/departments.ts` - Updated interfaces and create/update to include levelNames
- `src/components/admin/user-form.tsx` - Added level number input (conditional on department selection)
- `src/components/admin/edit-user-dialog.tsx` - New dialog wrapping UserForm with pencil trigger
- `src/components/admin/user-table.tsx` - Added Level column, EditUserDialog, departments prop
- `src/server-actions/users.ts` - Updated UpdateUserInput and updateUser to include level
- `src/app/admin/users/page.tsx` - Pass departments to UserTable

## Decisions Made
- `levelNames` passed to DepartmentForm as `Record<string, string> | null | undefined`; null coerced to undefined to satisfy Zod schema
- `z.number()` used instead of `z.coerce.number()` for the level field to avoid react-hook-form type inference issues with the coerce transform
- Edit dialogs use `router.refresh()` (Next.js App Router) to update server component data after save

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- TypeScript error: `z.coerce.number().optional().nullable()` produces `unknown` type with react-hook-form resolver — fixed by using `z.number()` with manual coercion in the `onChange` handler
- TypeScript error: `Record<string, string> | null` not assignable to Prisma Json field — fixed by using `?? undefined` instead of `?? null`

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Department level names can be configured via Admin UI
- User approval levels can be assigned via Admin UI
- Foundation for Plans 03-05 which build on the hierarchy configuration

---
*Phase: 07-configuration-and-administration*
*Completed: 2026-02-08*
