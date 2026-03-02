---
phase: 07-configuration-and-administration
plan: 01
subsystem: database
tags: [prisma, postgresql, schema, migration, seed, hierarchy, approval]

# Dependency graph
requires:
  - phase: 03-approval-engine
    provides: RequestApproval model and level-based hierarchy
  - phase: 01-02
    provides: Prisma schema foundation with User and Department models
provides:
  - DepartmentApprover model for cross-department approver assignments
  - levelNames Json field on Department for configurable level naming
  - isArchived Boolean on Request for archival support
  - Seed script with realistic hierarchy data
affects:
  - 07-02-approval-hierarchy-builder-ui
  - 07-03-admin-configuration-tools
  - Any future feature reading department level names or cross-department approvals

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Upsert pattern for idempotent seed scripts
    - Json field for flexible configuration maps (level Int -> name String)

key-files:
  created:
    - prisma/seed.ts
    - prisma/migrations/20260208000000_add_hierarchy_config/migration.sql
  modified:
    - prisma/schema.prisma
    - package.json

key-decisions:
  - "Used db push + manual migration file due to pre-existing migration drift (schema had evolved beyond migration history)"
  - "Stored levelNames as Json? instead of separate table - flexible map structure avoids extra joins for UI rendering"
  - "DepartmentApprover unique constraint on [departmentId, approverId, approverLevel] - prevents duplicate assignments"
  - "Seed uses upsert for idempotency - can be re-run without errors"

patterns-established:
  - "Upsert-based seeds: all seed operations use upsert to be idempotent and safe to re-run"
  - "Json field for config maps: levelNames stores {level: name} map for flexible UI display"

# Metrics
duration: 4min
completed: 2026-02-08
---

# Phase 7 Plan 01: Update Schema for Hierarchy Configuration Summary

**Prisma schema extended with DepartmentApprover model, configurable levelNames per department, and request archival flag, seeded with realistic hierarchy data**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-08T04:47:30Z
- **Completed:** 2026-02-08T04:51:44Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `DepartmentApprover` model enabling cross-department approver assignments with unique constraint on [departmentId, approverId, approverLevel]
- Added `levelNames Json?` to `Department` model for configurable level naming (e.g., Supervisor, Manager, Director)
- Added `isArchived Boolean` to `Request` model for archival status support
- Created `prisma/seed.ts` with upsert-based seeding that populates all departments with level names and creates a sample DepartmentApprover

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Schema for Hierarchy Configuration** - `02e190c` (feat)
2. **Task 2: Update Seed Script with Hierarchy Data** - `6de9d63` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `prisma/schema.prisma` - Added DepartmentApprover model, levelNames on Department, isArchived on Request
- `prisma/migrations/20260208000000_add_hierarchy_config/migration.sql` - Migration SQL for Phase 7 changes
- `prisma/seed.ts` - New seed script with hierarchy data using upsert pattern
- `package.json` - Added `prisma.seed` configuration pointing to tsx seed script

## Decisions Made
- Used `db push` for initial schema sync then created manual migration file, because the database schema had evolved beyond the migration history (migrations were missing several phases of changes applied via db push previously). The migration file documents the Phase 7 changes specifically.
- `levelNames` stored as `Json?` rather than a separate table - this enables flexible map rendering in UI (level number -> display name) without extra joins
- `DepartmentApprover` unique constraint on `[departmentId, approverId, approverLevel]` prevents duplicate cross-department assignments while allowing same user to approve at different levels in same department
- Seed script uses upsert for all operations ensuring it can be re-run safely without errors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-existing migration drift required alternative migration strategy**
- **Found during:** Task 1 (Schema update)
- **Issue:** `prisma migrate dev` detected database schema not in sync with migration history (many phases of changes applied via db push, not tracked in migrations). Could not proceed with standard migrate dev.
- **Fix:** Used `prisma db push` to sync schema to database, created manual migration SQL file documenting Phase 7 changes, marked as applied with `prisma migrate resolve --applied`
- **Files modified:** prisma/migrations/20260208000000_add_hierarchy_config/migration.sql
- **Verification:** `prisma format` and `prisma validate` pass; database has all new fields and DepartmentApprover table
- **Committed in:** 02e190c (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix resolved pre-existing infrastructure issue. Schema changes applied successfully. No scope creep.

## Issues Encountered
- Migration history drift: Previous schema changes were applied directly to the database via `db push` rather than through `prisma migrate dev`, causing the migration history to be out of sync. Resolved by using `db push` + manual migration file + `prisma migrate resolve --applied`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `DepartmentApprover` model ready for Phase 7 hierarchy builder UI (07-02)
- `levelNames` on Department ready for admin configuration tools (07-03)
- `isArchived` on Request ready for archival UI
- Database seeded with sample hierarchy data for development testing

---
*Phase: 07-configuration-and-administration*
*Completed: 2026-02-08*
