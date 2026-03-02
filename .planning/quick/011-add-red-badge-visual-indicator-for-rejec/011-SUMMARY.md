---
phase: quick-011
plan: 01
subsystem: ui
tags: [status-badge, rejected-solutions, visual-indicators, engineering-dashboard]

# Dependency graph
requires:
  - phase: quick-007
    provides: Solution resubmission workflow for rejected solutions
  - phase: 04-03
    provides: Solution approval/rejection workflow
provides:
  - Red "Solution Rejected" status badge for rejected-solution requests
  - Visual distinction between fresh requests and resubmission requests
  - Engineering dashboard rejection indicators
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional StatusBadge rendering based on hasRejection prop"
    - "Server-side rejection detection via solution approvals and activities"

key-files:
  created: []
  modified:
    - src/components/requests/status-badge.tsx
    - src/components/requests/request-table.tsx
    - src/components/dashboard/dashboard-table.tsx
    - src/components/requests/request-detail-modal.tsx
    - src/server-actions/requests.ts
    - src/components/engineering/needs-action-list.tsx
    - src/components/engineering/engineering-dashboard-tabs.tsx
    - src/app/(dashboard)/engineering/page.tsx

key-decisions:
  - "Override StatusBadge config when hasRejection=true and status=SentToEngineer to show red 'Solution Rejected' badge"
  - "Include ALL SentToEngineer requests in engineering 'Needs Solution' list (removed filter that excluded requests with solutions)"
  - "Detect rejection via solution approvals (status='rejected') OR activities (action='solution_rejected')"
  - "Show both red StatusBadge AND small RejectedBadge icon for complementary visual indicators"

patterns-established:
  - "hasRejection prop pattern: Query for rejection indicators server-side, pass as boolean prop through component tree"
  - "Button text conditional: 'Resubmit Solution' vs 'Submit Solution' based on rejection status"

# Metrics
duration: 3min
completed: 2026-02-07
---

# Quick Task 011: Add Red Badge Visual Indicator for Rejected Solutions Summary

**Red "Solution Rejected" status badge distinguishes rejected-solution requests from fresh requests across all views**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T16:38:09Z
- **Completed:** 2026-02-07T16:41:16Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- StatusBadge shows red "Solution Rejected" when hasRejection=true and status=SentToEngineer
- All table views (/requests, /dashboard, /engineering) display red badge for rejected solutions
- Engineering "Needs Solution" section includes rejected requests with RejectedBadge icon and "Resubmit Solution" button
- Fresh SentToEngineer requests maintain yellow "Sent to Engineer" badge

## Task Commits

Each task was committed atomically:

1. **Task 1: Enhance StatusBadge to show red rejection state** - `01436ab` (feat)
2. **Task 2: Add rejection indicator to engineering dashboard** - `144bf5f` (feat)

## Files Created/Modified
- `src/components/requests/status-badge.tsx` - Added hasRejection prop and conditional red rendering for rejected solutions
- `src/components/requests/request-table.tsx` - Pass hasRejection prop to StatusBadge
- `src/components/dashboard/dashboard-table.tsx` - Pass hasRejection prop to StatusBadge
- `src/components/requests/request-detail-modal.tsx` - Pass hasRejection prop to StatusBadge
- `src/server-actions/requests.ts` - Modified getRequestsNeedingEngineeringAction to include ALL SentToEngineer requests and add hasRejection field
- `src/components/engineering/needs-action-list.tsx` - Added RejectedBadge icon and conditional "Resubmit Solution" button text
- `src/components/engineering/engineering-dashboard-tabs.tsx` - Replace plain status span with StatusBadge component
- `src/app/(dashboard)/engineering/page.tsx` - Query solution approvals and activities to compute hasRejection flag

## Decisions Made

**1. Override StatusBadge config for rejected solutions**
- When hasRejection=true AND status=SentToEngineer, override to show red "Solution Rejected" badge
- Keeps existing RejectedBadge icon (small red X) alongside StatusBadge for complementary visual indicators
- StatusBadge provides status-at-a-glance in badge columns, RejectedBadge provides quick-scan icon in title column

**2. Include rejected requests in engineering "Needs Solution" list**
- Removed filter that excluded requests with solutions (line 1305: `.filter(r => !requestIdsWithSolution.includes(r.id))`)
- A request in SentToEngineer with an existing solution means the solution was rejected and needs resubmission
- Now includes ALL SentToEngineer requests, with hasRejection flag to distinguish fresh vs. rejected

**3. Detection via multiple sources**
- Detect rejection via solution approvals (status='rejected') OR activities (action='solution_rejected')
- Covers both custom approval chain rejections and hierarchy-based rejections
- Query pattern: `request.solutions.some(s => s.approvals.length > 0) || request.activities.length > 0`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Build failure due to Next.js/webpack runtime error**
- Initial `npm run build` failed with "Cannot read properties of undefined (reading 'call')" webpack runtime error
- Root cause: Stale .next cache directory
- Resolution: Cleaned build directory with `rm -rf .next` and re-ran build successfully
- Not related to code changes - Next.js configuration/cache issue

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Visual distinction complete for rejected-solution requests across all views:
- Users can now instantly identify which requests need resubmission vs. initial submission
- Engineering dashboard shows clear rejection indicators in both "Needs Solution" and "All Engineering Requests" sections
- Ready for production use

---
*Phase: quick-011*
*Completed: 2026-02-07*
