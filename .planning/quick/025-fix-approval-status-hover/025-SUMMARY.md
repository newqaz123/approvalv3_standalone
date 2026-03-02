---
phase: quick-025
plan: 01
subsystem: ui
tags: [react, typescript, approvals, hover-card, dashboard]

# Dependency graph
requires:
  - phase: quick-015
    provides: ApprovalStatusBadge component and approval hierarchy display
provides:
  - Fixed ApprovalStatusBadge to display approver names instead of level numbers
  - Filtered approvals by current stage (initial vs final approval)
  - Load and display solution approvals for "Design & Cost Approval" status
  - Populated requiredApprover for DepartmentApprovers in approval chain creation
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []
    - Approval stage filtering based on isFinalApproval flag
    - Display prioritization: requiredApprover.name > approver.name > Level X
    - Solution approvals loaded for DesignCostEstimationApproval status

key-files:
  created: []
  modified:
    - src/components/requests/approval-status-badge.tsx
    - src/server-actions/dashboard.ts
    - src/server-actions/approvals.ts

key-decisions:
  - "Filter approvals to show only current stage based on isFinalApproval flag"
  - "Display approver names with fallback to level number when name unavailable"
  - "Load solution approvals when status is DesignCostEstimationApproval"
  - "Populate requiredApproverId for DepartmentApprovers to show their names in tooltips"

patterns-established:
  - "Approval stage separation: initial (isFinalApproval: false) vs final (isFinalApproval: true) vs solution approvals"
  - "Approver name display chain: requiredApprover.name || approver.name || Level X"
  - "Status-based approval loading: DesignCostEstimationApproval → solution.approvals, otherwise → request.approvals"

# Metrics
duration: 15min
completed: 2026-02-21
---

# Phase quick-025: Fix Approval Status Hover Summary

**Fixed approval status hover to show approver names instead of level numbers, and fixed "Design & Cost Approval" status to show "Approving" badge**

## Performance

- **Duration:** 15 min
- **Started:** 2026-02-21T14:27:14Z
- **Completed:** 2026-02-21T14:42:00Z
- **Tasks:** 5 (3 original + 2 additional)
- **Files modified:** 3

## Accomplishments

1. ✅ **Show only current stage approvals** - Filter by isFinalApproval flag
2. ✅ **Show approver names instead of levels** - Display requiredApprover.name/approver.name, updated tooltip layout
3. ✅ **Populate requiredApprover for DepartmentApprovers** - Updated createApprovalChain to set requiredApproverId
4. ✅ **Load solution approvals for Design & Cost Approval** - Dashboard now loads solution.approvals when status is DesignCostEstimationApproval
5. ✅ **Show "Approving" badge for Design & Cost Approval** - Solution approvals are now loaded and displayed correctly

## Issues Fixed

### Original Issues (from plan):
1. ✅ Shows levels instead of approver names - **FIXED**: Tooltip now shows "QC Level 2 -B" instead of "Level 2"
2. ✅ Shows all stages instead of current stage - **FIXED**: Filter by isFinalApproval to show only relevant stage

### Additional Issues Found:
3. ✅ "Design & Cost Approval" shows "—" instead of "Approving" - **FIXED**: Dashboard now loads solution.approvals for DesignCostEstimationApproval status
4. ✅ requiredApprover not populated for DepartmentApprovers - **FIXED**: Updated createApprovalChain to set requiredApproverId

## Task Commits

1. **Initial fix attempt** - `b2ff2cc` (fix) - Fixed stage filtering and approver name display
2. **Populate requiredApprover** - `0356ece` (fix) - Updated approval creation to set requiredApproverId for DepartmentApprovers
3. **Load solution approvals** - `1c46478` (fix) - Dashboard loads solution.approvals for DesignCostEstimationApproval status
4. **Remove debug logging** - `7fdaf2b` (fix) - Cleaned up debug statements

## Files Created/Modified

- `src/components/requests/approval-status-badge.tsx` - Updated tooltip display logic to show approver names as main text
- `src/server-actions/dashboard.ts` - Load solution.approvals for DesignCostEstimationApproval, map to approval format
- `src/server-actions/approvals.ts` - Populate requiredApproverId for DepartmentApprovers

## Decisions Made

1. **Approver Name Display**: Changed tooltip to show approver names as main text instead of level numbers
   - For approved/rejected: Show `approver.name` as main text, date below
   - For pending with requiredApprover: Show `requiredApprover.name` as main text
   - For pending without requiredApprover: Show level number with "Awaiting approval"

2. **Solution Approvals for Design & Cost**: When status is DesignCostEstimationApproval, load solution.approvals instead of request.approvals
   - Solution approvals are mapped to the same format as request approvals
   - isFinalApproval set to false for solution approvals (they're a separate phase)

3. **Populate requiredApprover**: Updated createApprovalChain to set requiredApproverId for DepartmentApprovers
   - Creates one approval per external DepartmentApprover
   - Each approval has requiredApproverId set to the specific approver's user ID
   - This makes their names show up in tooltips instead of just "Level X"

## Deviations from Plan

Added 2 extra tasks to fully fix the issues:
- Task 4: Populate requiredApprover for DepartmentApprovers (original code only set requiredLevel)
- Task 5: Load solution approvals for Design & Cost Approval status (dashboard wasn't loading solution approvals)

## Root Causes

1. **Tooltip showing levels**: requiredApprover field wasn't being populated when approvals were created, so it fell back to displaying "Level X"
2. **Design & Cost Approval showing "—"**: Dashboard only loaded request.approvals, but DesignCostEstimationApproval status uses solution.approvals (separate table)

## User Setup Required

None - no external service configuration required. However, existing approvals in the database won't have requiredApprover populated. To fix this for existing data, run a migration to backfill requiredApproverId based on DepartmentApprovers.

## Next Phase Readiness

Ready for next quick task or milestone completion. All approval status hover functionality is working correctly:
- ✅ Shows approver names instead of level numbers
- ✅ Shows only current stage approvals
- ✅ "Design & Cost Approval" status shows "Approving" badge with hover tooltip

---
*Phase: quick-025*
*Completed: 2026-02-21*
