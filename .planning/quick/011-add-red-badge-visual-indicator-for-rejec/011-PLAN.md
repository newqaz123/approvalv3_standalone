---
phase: quick-011
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/requests/status-badge.tsx
  - src/components/requests/request-table.tsx
  - src/components/dashboard/dashboard-table.tsx
  - src/components/engineering/needs-action-list.tsx
  - src/components/engineering/engineering-dashboard-tabs.tsx
  - src/app/(dashboard)/engineering/page.tsx
  - src/server-actions/requests.ts
autonomous: true

must_haves:
  truths:
    - "Rejected-solution requests show RED status badge with 'Solution Rejected' label instead of yellow 'Sent to Engineer'"
    - "Red badge appears on /requests page, /dashboard page, /engineering page, and request detail modal"
    - "Requests in SentToEngineer status WITHOUT rejection still show yellow 'Sent to Engineer' badge"
    - "Engineering dashboard 'Needs Solution' section shows rejection indicator for resubmission requests"
  artifacts:
    - path: "src/components/requests/status-badge.tsx"
      provides: "StatusBadge with hasRejection-aware rendering"
    - path: "src/components/engineering/needs-action-list.tsx"
      provides: "Rejection indicator in engineering needs-solution table"
  key_links:
    - from: "StatusBadge"
      to: "request-table.tsx, dashboard-table.tsx"
      via: "hasRejection prop passed through to StatusBadge"
      pattern: "hasRejection.*StatusBadge"
---

<objective>
Add red visual indicator for requests with rejected solutions across all views.

Purpose: Users currently cannot distinguish between requests awaiting initial solution vs. requests that had a solution rejected and need resubmission. The yellow "Sent to Engineer" badge looks identical in both cases.

Output: StatusBadge shows red "Solution Rejected" when request is in SentToEngineer status with a rejected solution. This appears in /requests, /dashboard, /engineering, and the detail modal.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/components/requests/status-badge.tsx
@src/components/requests/rejected-badge.tsx
@src/components/requests/request-table.tsx
@src/components/dashboard/dashboard-table.tsx
@src/components/engineering/needs-action-list.tsx
@src/components/engineering/engineering-dashboard-tabs.tsx
@src/app/(dashboard)/engineering/page.tsx
@src/server-actions/requests.ts
@src/server-actions/dashboard.ts
@src/components/requests/request-detail-modal.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Enhance StatusBadge to show red rejection state</name>
  <files>
    src/components/requests/status-badge.tsx
    src/components/requests/request-table.tsx
    src/components/dashboard/dashboard-table.tsx
    src/components/requests/request-detail-modal.tsx
  </files>
  <action>
    Modify StatusBadge to accept an optional `hasRejection?: boolean` prop.

    In StatusBadge:
    - Add `hasRejection` to the props interface: `{ status: RequestStatus; hasRejection?: boolean }`
    - When `hasRejection === true` AND `status === RequestStatus.SentToEngineer`, override the config to show:
      - label: "Solution Rejected"
      - className: `bg-red-100 text-red-800 hover:bg-red-100 border-red-200`
    - All other statuses render unchanged.
    - Keep the existing RejectedBadge (small red X icon) alongside the StatusBadge - they serve complementary purposes (badge = status at a glance, icon = quick scan in title column).

    In request-table.tsx:
    - In the status column cell, pass `hasRejection={row.original.hasRejection}` to `<StatusBadge>`.
    - The `hasRejection` field already exists on `RequestListRow` type.

    In dashboard-table.tsx:
    - In the status column cell, pass `hasRejection={row.original.hasRejection}` to `<StatusBadge>`.
    - The `hasRejection` field already exists on the imported `RequestListRow` type.

    In request-detail-modal.tsx:
    - Find where `<StatusBadge status={request.status} />` is rendered (around line 338).
    - Pass `hasRejection={hasRejection}` to it (the `hasRejection` variable already exists, computed on line 75 from approvals).
    - This gives the detail modal a red status badge for rejected solutions.
  </action>
  <verify>
    Run `npx tsc --noEmit` to verify no type errors.
    Grep for `hasRejection` in StatusBadge to confirm the prop is used.
  </verify>
  <done>
    StatusBadge renders red "Solution Rejected" when hasRejection=true and status=SentToEngineer.
    The prop is passed in request-table, dashboard-table, and request-detail-modal.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add rejection indicator to engineering dashboard</name>
  <files>
    src/components/engineering/needs-action-list.tsx
    src/components/engineering/engineering-dashboard-tabs.tsx
    src/app/(dashboard)/engineering/page.tsx
    src/server-actions/requests.ts
  </files>
  <action>
    The engineering dashboard's "Requests Awaiting Solution" section (needs-action-list.tsx) and "All Engineering Requests" section (engineering-dashboard-tabs.tsx) do not currently show rejection status. Fix this.

    **Important context:** When a solution is rejected, the request goes back to SentToEngineer status. The old solution record still exists. The current `getRequestsNeedingEngineeringAction` function filters OUT requests that already have a solution (`!requestIdsWithSolution.includes(r.id)`). This means rejected-solution requests may NOT appear in the "Needs Solution" list. Check this first:

    In `src/server-actions/requests.ts`, function `getRequestsNeedingEngineeringAction` (around line 1226):
    - Instead of filtering out ALL requests with solutions, only filter out requests where the latest solution is NOT in a rejected state. A request with a rejected solution still needs a new solution submission.
    - Approach: Query solutions for the needsSolution requests, but also check if those solutions have any rejected approvals (SolutionApproval with status='rejected') OR if the request has activity with action='solution_rejected'.
    - Simpler approach: Don't filter by solution existence at all for requests in SentToEngineer status. If a request is SentToEngineer AND has a solution, that solution was rejected (otherwise the request would have progressed to DesignCostEstimationApproval). So the filter should be: remove requests that have a solution AND where request status has already moved past SentToEngineer. Since all requests here ARE SentToEngineer, include them all.
    - Actually, the simplest correct approach: A request in SentToEngineer with an existing solution means it needs resubmission. Include these requests, and add a `hasRejection: boolean` field to the returned data.
    - Modify the mapping to include `hasRejection: requestIdsWithSolution.includes(r.id)` for items that pass through.
    - Change the filter: Instead of `!requestIdsWithSolution.includes(r.id)`, include ALL requests. Requests WITH a solution are the rejected ones needing resubmission.

    In needs-action-list.tsx:
    - In the "Requests Awaiting Solution" table, add a rejection indicator.
    - Import `RejectedBadge` from `@/components/requests/rejected-badge`.
    - In the Title cell (TableCell with className="font-medium"), wrap content in a flex div and add `{request.hasRejection && <RejectedBadge size="sm" />}` after the title.
    - Change the "Submit Solution" button text to "Resubmit Solution" when `request.hasRejection` is true.

    In engineering-dashboard-tabs.tsx, `AllEngineeringRequests` component:
    - The status display (line 93-95) uses a plain span, not StatusBadge. Replace it with `<StatusBadge>` component and pass `hasRejection`.
    - Import `StatusBadge` from `@/components/requests/status-badge`.
    - To get hasRejection data: In the engineering page.tsx, the `allEngineeringRequests` query needs to include solution approval rejection data.

    In `src/app/(dashboard)/engineering/page.tsx`:
    - Modify the `allEngineeringRequests` Prisma query to include solutions with their approvals to detect rejection:
      ```
      include: {
        department: { select: { name: true } },
        requester: { select: { name: true } },
        solutions: {
          select: {
            approvals: {
              where: { status: 'rejected' },
              take: 1,
            },
          },
        },
        activities: {
          where: { action: 'solution_rejected' },
          take: 1,
        },
      }
      ```
    - Map the results to add `hasRejection: request.solutions.some(s => s.approvals.length > 0) || request.activities.length > 0`.
    - Pass the mapped data (with hasRejection) to `EngineeringDashboardTabs`.

    In engineering-dashboard-tabs.tsx `AllEngineeringRequests`:
    - Update the type for `requests` to include `hasRejection?: boolean`.
    - Replace the plain status span with `<StatusBadge status={request.status} hasRejection={request.hasRejection} />`.
  </action>
  <verify>
    Run `npx tsc --noEmit` to verify no type errors.
    Run `npm run build` to verify build succeeds.
    Grep for "Resubmit Solution" in needs-action-list.tsx.
    Grep for "hasRejection" in engineering-dashboard-tabs.tsx and engineering/page.tsx.
  </verify>
  <done>
    Engineering dashboard "Needs Solution" section shows RejectedBadge and "Resubmit Solution" button for rejected requests.
    Engineering dashboard "All Engineering Requests" section uses StatusBadge with red rejection styling.
    Requests with rejected solutions correctly appear in the "Needs Solution" list (not filtered out).
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no type errors
2. `npm run build` succeeds
3. Visual check: StatusBadge shows red "Solution Rejected" for rejected-solution requests
4. Visual check: Yellow "Sent to Engineer" still shown for fresh requests without rejection
5. All 4 views show the indicator: /requests, /dashboard, /engineering, detail modal
</verification>

<success_criteria>
- StatusBadge renders RED "Solution Rejected" when hasRejection=true and status=SentToEngineer
- All table views (/requests, /dashboard, /engineering) pass hasRejection to StatusBadge
- Detail modal shows red StatusBadge for rejected solutions
- Engineering "Needs Solution" list includes rejected requests (not filtered out) with visual distinction
- Fresh SentToEngineer requests (no rejection) still show yellow badge
- Build passes with no errors
</success_criteria>

<output>
After completion, create `.planning/quick/011-add-red-badge-visual-indicator-for-rejec/011-SUMMARY.md`
</output>
