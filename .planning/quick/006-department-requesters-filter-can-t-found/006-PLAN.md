---
phase: quick-006
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server-actions/requests.ts
  - src/components/dashboard/dashboard-table.tsx
autonomous: true

must_haves:
  truths:
    - "Department filter dropdown shows all departments visible to user (own dept + depts of cross-department requests)"
    - "Requester filter dropdown shows requesters from all visible departments (not just own department)"
    - "Date range filter with End date=Feb 6 includes requests created on Feb 6"
    - "Dashboard client-side date filter with End date=Feb 6 includes requests created on Feb 6"
  artifacts:
    - path: "src/server-actions/requests.ts"
      provides: "Fixed getRequestFilterOptions and date filter logic"
    - path: "src/components/dashboard/dashboard-table.tsx"
      provides: "Fixed client-side date range filter"
  key_links:
    - from: "src/server-actions/requests.ts:getRequestFilterOptions"
      to: "prisma.department.findMany + prisma.user.findMany"
      via: "cross-department visibility query"
    - from: "src/server-actions/requests.ts:getMyRequests"
      to: "whereClause.createdAt.lte"
      via: "end-of-day date adjustment"
---

<objective>
Fix two filter bugs in the dashboard and requests list:

1. **Department/Requester filter only shows own department** - `getRequestFilterOptions()` restricts non-admin users to their own department only. But since quick-002 added cross-department visibility (users see requests where they are custom approval chain approvers), the filter options must also include departments and requesters from those cross-department requests.

2. **Date range end date is off by one** - Both server-side (`getMyRequests`) and client-side (`DashboardTable`) date filters parse the "to" date as midnight START of that day (00:00:00), excluding all requests created during that day. Must set end date to end-of-day (23:59:59.999).

Purpose: Users can properly filter requests across all departments they have visibility into, and date range filtering is inclusive of the end date.
Output: Fixed filter options query and date range logic in both server and client.
</objective>

<context>
@src/server-actions/requests.ts (getRequestFilterOptions at line 344, date filter at line 209-217)
@src/components/dashboard/dashboard-table.tsx (client-side date filter at line 182-203)
@src/components/dashboard/table-filters.tsx (filter UI - no changes needed)
@src/components/requests/request-filters.tsx (request list filter UI - no changes needed)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix getRequestFilterOptions to include cross-department visibility</name>
  <files>src/server-actions/requests.ts</files>
  <action>
  In `getRequestFilterOptions()` (line 344), update the non-admin branch to include departments and requesters from requests the user can see via cross-department custom approval chains.

  Current logic (line 364-396) for non-admin users:
  - Departments: only own department (`{ id: currentUser.departmentId }`)
  - Requesters: only from own department (`{ departmentId: currentUser.departmentId }`)

  Also need to check if user is engineering (same pattern as getMyRequests - engineering sees all).

  **Fix for departments:** For non-admin, non-engineering users:
  1. Query distinct departmentIds from requests visible to the user (same OR pattern used in getMyRequests: own department OR requiredApproverId in request approvals OR requiredApproverId in solution approvals)
  2. Use those departmentIds to fetch department names

  Implementation approach - query visible requests for distinct department IDs, then fetch departments:
  ```typescript
  // For non-admin, non-engineering users
  const visibleRequests = await prisma.request.findMany({
    where: {
      isDeleted: false,
      OR: [
        { departmentId: currentUser.departmentId ?? undefined },
        { approvals: { some: { requiredApproverId: userId } } },
        { solutions: { some: { approvals: { some: { requiredApproverId: userId } } } } },
      ],
    },
    select: { departmentId: true, requesterId: true },
    distinct: ['departmentId'],
  })
  const visibleDeptIds = [...new Set(visibleRequests.map(r => r.departmentId))]
  ```
  Then query departments with `{ id: { in: visibleDeptIds } }`.

  **Fix for requesters:** Similarly, get distinct requester IDs from visible requests:
  ```typescript
  const visibleRequesters = await prisma.request.findMany({
    where: {
      isDeleted: false,
      OR: [
        { departmentId: currentUser.departmentId ?? undefined },
        { approvals: { some: { requiredApproverId: userId } } },
        { solutions: { some: { approvals: { some: { requiredApproverId: userId } } } } },
      ],
    },
    select: { requesterId: true },
    distinct: ['requesterId'],
  })
  const visibleRequesterIds = visibleRequesters.map(r => r.requesterId)
  ```
  Then query users with `{ id: { in: visibleRequesterIds } }`.

  For admin and engineering users, keep current behavior (all departments, all requesters who have created requests). Add engineering check: `currentUser.department?.type === 'ENGINEERING'` - need to also select `department.type` in the initial user query.
  </action>
  <verify>Build succeeds: `cd /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2 && npx tsc --noEmit 2>&1 | head -20`</verify>
  <done>Non-admin, non-engineering users see departments and requesters from all requests they have visibility into (own department + cross-department via custom approval chains). Admin and engineering users continue to see all departments and requesters.</done>
</task>

<task type="auto">
  <name>Task 2: Fix date range end date off-by-one in both server and client filters</name>
  <files>src/server-actions/requests.ts, src/components/dashboard/dashboard-table.tsx</files>
  <action>
  **Server-side fix** in `getMyRequests()` (line 209-217 of requests.ts):

  Change the dateTo handling from:
  ```typescript
  whereClause.createdAt.lte = new Date(filters.dateTo)
  ```
  To set end-of-day:
  ```typescript
  const endDate = new Date(filters.dateTo)
  endDate.setHours(23, 59, 59, 999)
  whereClause.createdAt.lte = endDate
  ```

  **Client-side fix** in `DashboardTable` (line 182-203 of dashboard-table.tsx):

  In the `createdAt` column's `filterFn`, the `to` date comparison needs end-of-day adjustment. Import `endOfDay` from date-fns (already imported: `format, isWithinInterval, parseISO`).

  Add `endOfDay` to the import from date-fns.

  Change the filter function:
  - When both from and to: use `isWithinInterval(rowDate, { start: parseISO(filterValue.from), end: endOfDay(parseISO(filterValue.to)) })`
  - When only to: use `rowDate <= endOfDay(parseISO(filterValue.to))`
  </action>
  <verify>Build succeeds: `cd /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2 && npx tsc --noEmit 2>&1 | head -20`</verify>
  <done>Setting End date to Feb 6, 2026 correctly includes requests created on Feb 6, 2026 in both the /requests page (server-side filter) and the /dashboard page (client-side filter).</done>
</task>

</tasks>

<verification>
1. TypeScript compiles without errors
2. On /requests page: Department filter shows departments from cross-department requests (not just own dept)
3. On /requests page: Requester filter shows requesters from all visible departments
4. On /requests page: Date range with End date = today includes today's requests
5. On /dashboard page: Date range with End date = today includes today's requests
</verification>

<success_criteria>
- Department dropdown shows all departments the user has visibility into
- Requester dropdown shows requesters from all visible departments
- Date range filter is inclusive of the end date (end date = Feb 6 includes Feb 6 requests)
- No TypeScript compilation errors
- No regression in admin/engineering user filter behavior
</success_criteria>

<output>
After completion, create `.planning/quick/006-department-requesters-filter-can-t-found/006-SUMMARY.md`
</output>
