---
phase: 07-configuration-and-administration
plan: 05
subsystem: infra
tags: [vercel-cron, archival, retention, prisma, admin-ui]

# Dependency graph
requires:
  - phase: 07-01
    provides: isArchived field on Request model in Prisma schema
provides:
  - Automated daily archival of completed/cancelled requests via Vercel Cron
  - Manual admin retention controls (archive/soft-delete)
  - /admin/retention page for data lifecycle management
affects: [future phases that query requests should respect isArchived: false by default]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Vercel Cron job secured with CRON_SECRET Bearer token
    - Default isArchived: false filter on all user-facing request queries
    - Admin-only server actions for data lifecycle management
    - Soft-delete (isArchived=true + isActive=false) instead of hard delete to respect append-only audit trail trigger

key-files:
  created:
    - src/app/api/cron/archive/route.ts
    - src/components/admin/retention-controls.tsx
    - src/app/admin/retention/page.tsx
    - vercel.json
  modified:
    - src/server-actions/requests.ts

key-decisions:
  - "CRON_SECRET env var required for cron endpoint security - must be set in Vercel"
  - "Archive after 90 days configurable via ARCHIVE_AFTER_DAYS env var"
  - "getMyRequests excludes archived by default; pass includeArchived: true to override"
  - "permanentDeleteRequest uses soft-delete (isActive=false) not hard delete - append-only audit trail trigger blocks hard deletes"

patterns-established:
  - "Cron: GET route with Authorization: Bearer {CRON_SECRET} header check"
  - "Admin retention: archive (reversible) vs permanent delete (soft-delete via isActive=false, irreversible in UI)"

# Metrics
duration: 12min
completed: 2026-02-08
---

# Phase 7 Plan 05: Request Archival and Retention Summary

**Vercel Cron job archiving completed/cancelled requests after 90 days, with admin retention UI for manual archive/soft-delete at /admin/retention**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-08T04:46:00Z
- **Completed:** 2026-02-08T04:58:45Z
- **Tasks:** 3 auto tasks completed, checkpoint verified
- **Files modified:** 5

## Accomplishments
- Secure GET endpoint at `/api/cron/archive` archives old completed/cancelled requests
- Vercel Cron scheduled daily at midnight (`0 0 * * *`) in `vercel.json`
- All active request queries now exclude archived requests by default
- Admin can manually archive or soft-delete individual requests via `/admin/retention`
- Cron endpoint tested manually (archived 2 requests successfully)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Archival API Endpoint** - `47de775` (feat)
2. **Task 2: Configure Cron and Filters** - `54bcd97` (feat)
3. **Task 3: Implement Manual Retention Controls** - `ae14420` (feat)
4. **Post-checkpoint fix: Soft-delete instead of hard delete** - `9411e49` (fix)

## Files Created/Modified
- `src/app/api/cron/archive/route.ts` - GET endpoint for cron archival with Bearer auth
- `vercel.json` - Cron schedule: daily midnight run of /api/cron/archive
- `src/server-actions/requests.ts` - Added includeArchived filter, archiveRequest, permanentDeleteRequest (soft-delete), getAllRequestsForRetention
- `src/components/admin/retention-controls.tsx` - Archive/Delete buttons with confirmation dialog
- `src/app/admin/retention/page.tsx` - Admin table listing all requests with retention actions

## Decisions Made
- `CRON_SECRET` env var used for cron auth (Vercel injects this automatically when configured)
- Archive threshold default 90 days, configurable via `ARCHIVE_AFTER_DAYS` env var
- Soft-delete chosen for permanentDeleteRequest after discovering append-only audit trail trigger blocks hard deletes (PostgreSQL trigger from phase 06-01 prevents DELETE on RequestActivity, and cascading deletes would violate this)
- `getMyRequests` updated to default `isArchived: false` without breaking existing callers

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Soft-delete instead of hard delete for permanentDeleteRequest**
- **Found during:** Post-checkpoint verification
- **Issue:** Plan specified `prisma.request.delete` for permanent deletion, but the append-only audit trail trigger (from phase 06-01) blocks DELETE operations on RequestActivity. Cascade delete from Request would trigger this, causing a runtime error.
- **Fix:** Changed `permanentDeleteRequest` to perform a soft-delete by setting `isActive = false` and `isArchived = true` instead of a hard delete. The record is hidden from all UI but preserved in the database for audit integrity.
- **Files modified:** `src/server-actions/requests.ts`
- **Committed in:** `9411e49` (fix(07-05))

---

**Total deviations:** 1 auto-fixed (1 bug - incompatibility with existing append-only audit trail trigger)
**Impact on plan:** Soft-delete achieves the same UX goal (request disappears from UI) while respecting database-level immutability constraints. No scope creep.

## Issues Encountered
The append-only trigger on RequestActivity (installed in phase 06-01) blocked hard deletes via cascade. Resolved by switching to soft-delete pattern which is more appropriate for an audit-compliant system.

## User Setup Required
**External services require manual configuration:**
- Add `CRON_SECRET` environment variable to Vercel project settings
- Vercel will automatically populate the `Authorization` header when invoking the cron job
- Verify cron job appears in Vercel Dashboard -> Settings -> Cron Jobs after deploy

## Next Phase Readiness
- Archival system fully functional, verified by user (cron archived 2 requests, manual archive/delete work at /admin/retention)
- Plan 07-04 (Settings Management) remains to complete Phase 7

---
*Phase: 07-configuration-and-administration*
*Completed: 2026-02-08*
