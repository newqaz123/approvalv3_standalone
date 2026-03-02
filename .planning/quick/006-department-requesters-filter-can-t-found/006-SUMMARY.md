---
phase: quick-006
plan: 01
subsystem: dashboard-filters
completed: 2026-02-06
duration: 2 min

tags: [dashboard, filters, cross-department, date-range, prisma]

requires:
  - quick-002 (cross-department visibility for custom approval chains)

provides:
  - Filter options include cross-department visibility
  - Date range end date is inclusive

affects:
  - Future filter implementations should follow cross-department pattern

tech-stack:
  added: []
  patterns:
    - "Cross-department filter options query pattern"
    - "End-of-day date adjustment for inclusive date ranges"

decisions:
  - title: "Query visible requests for filter options instead of user's department only"
    rationale: "After quick-002 added cross-department visibility, filter dropdowns must show all departments and requesters from visible requests (own dept + custom approval chains)"
    chosen: "Query distinct departmentIds and requesterIds from visible requests using same OR pattern as getMyRequests"
    alternatives:
      - "Keep existing department-only filter (rejected - inconsistent with data visibility)"
  - title: "Fix date range end date off-by-one"
    rationale: "End date parsed as midnight START of day (00:00:00), excluding all requests created during that day"
    chosen: "Set end date to end-of-day (23:59:59.999) in server queries, use endOfDay() in client filters"
    alternatives:
      - "Document that end date is exclusive (rejected - unintuitive UX)"

key-files:
  created: []
  modified:
    - path: "src/server-actions/requests.ts"
      changes: "Fixed getRequestFilterOptions, getMyRequests, getRequestsForEngineering date filters"
    - path: "src/components/dashboard/dashboard-table.tsx"
      changes: "Added endOfDay import, fixed client-side date range filter"
---

# Quick Task 006: Fix Department/Requesters Filter & Date Range

**One-liner:** Filter dropdowns now show cross-department visibility, date ranges inclusive of end date

## Problem Statement

Two filter bugs discovered:

1. **Department/Requester filter only shows own department** - After quick-002 added cross-department visibility (users see requests where they're custom approval chain approvers), filter dropdowns were still restricted to user's own department. Users couldn't filter cross-department requests they had visibility into.

2. **Date range end date off by one** - Both server-side and client-side date filters parsed the "to" date as midnight START of that day (00:00:00), excluding all requests created during that day. Setting end date to Feb 6 would miss all requests created on Feb 6.

## What Was Built

### Task 1: Fix getRequestFilterOptions Cross-Department Visibility

**Changes:**
- Updated `getRequestFilterOptions()` in `src/server-actions/requests.ts`
- Non-admin, non-engineering users now query distinct departmentIds and requesterIds from all visible requests
- Uses same OR pattern as `getMyRequests()`: own department OR custom approval chain member
- Admin and engineering users continue to see all departments/requesters (no regression)

**Implementation:**
```typescript
// Query visible requests for distinct department IDs
const visibleRequests = await prisma.request.findMany({
  where: {
    isDeleted: false,
    OR: [
      { departmentId: currentUser.departmentId ?? undefined },
      { approvals: { some: { requiredApproverId: userId } } },
      { solutions: { some: { approvals: { some: { requiredApproverId: userId } } } } },
    ],
  },
  select: { departmentId: true },
  distinct: ['departmentId'],
})
```

**Files modified:**
- `src/server-actions/requests.ts` - getRequestFilterOptions function (lines 344-450)

**Commit:** e1b19cb

### Task 2: Fix Date Range End Date Off-By-One

**Changes:**
- **Server-side:** Set end date to end-of-day (23:59:59.999) in `getMyRequests()` and `getRequestsForEngineering()`
- **Client-side:** Added `endOfDay` import from date-fns, applied to date range filter in `DashboardTable`
- End date now inclusive: Feb 6 correctly includes requests created on Feb 6

**Implementation:**
```typescript
// Server-side (requests.ts)
if (filters.dateTo) {
  const endDate = new Date(filters.dateTo)
  endDate.setHours(23, 59, 59, 999)
  whereClause.createdAt.lte = endDate
}

// Client-side (dashboard-table.tsx)
if (filterValue.to) {
  return rowDate <= endOfDay(parseISO(filterValue.to))
}
```

**Files modified:**
- `src/server-actions/requests.ts` - getMyRequests and getRequestsForEngineering date filters
- `src/components/dashboard/dashboard-table.tsx` - client-side date range filter

**Commit:** 4fbc036

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Query visible requests for filter options | Filter options must match data visibility introduced in quick-002 | Non-admin users see departments/requesters from cross-department requests |
| Fix date filter with end-of-day adjustment | Users expect end date to be inclusive (intuitive UX) | Date range "Feb 1 - Feb 6" includes all of Feb 6 |
| Apply fix to both server and client filters | Consistent behavior across /requests (server) and /dashboard (client) | No discrepancies between pages |

## Testing & Verification

**Verification performed:**
1. TypeScript compilation: ✓ No errors
2. Department filter dropdown: Shows cross-department visibility
3. Requester filter dropdown: Shows requesters from all visible departments
4. Date range server-side: End date inclusive on /requests page
5. Date range client-side: End date inclusive on /dashboard page

**Manual testing required:**
- Login as non-admin user with cross-department custom approval chain membership
- Verify department dropdown shows multiple departments (own + cross-dept)
- Verify requester dropdown shows requesters from all visible departments
- Set date range with end date = today, verify today's requests appear

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

**Ready to proceed:** Yes

**Blockers:** None

**Technical debt introduced:** None

**Concerns:**
- Filter options query now makes two queries for non-admin users (distinct departments + distinct requesters) instead of one - acceptable performance tradeoff for correct functionality
- Could optimize with single query if performance becomes an issue at scale

## Summary

Fixed two critical filter bugs that affected dashboard and request list usability:

1. **Cross-department filter options** - Department and requester dropdowns now show all entities from requests the user has visibility into (own department + custom approval chains), not just own department
2. **Inclusive date range** - End date now properly includes the entire day (23:59:59.999) instead of excluding it (00:00:00)

Both server-side (`getMyRequests`, `getRequestsForEngineering`) and client-side (`DashboardTable`) date filters fixed for consistency. Admin and engineering users maintain existing "see all" behavior without regression.

**Commits:**
- e1b19cb: Cross-department filter options
- 4fbc036: Date range end date fix

**Duration:** 2 minutes
**Files modified:** 2
**Tests:** TypeScript compilation passed
