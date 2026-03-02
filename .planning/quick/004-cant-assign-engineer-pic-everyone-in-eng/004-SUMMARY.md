---
phase: quick-004
plan: 01
type: summary
subsystem: engineering-dashboard
tags: [pic-assignment, multi-select, engineering, ui]

requires:
  - Server action assignEngineers (from Phase 4)
  - RequestEngineerAssignment model (from Phase 4)
  - getEngineeringUsers server action (from Phase 4)

provides:
  - Interactive PIC assignment UI in engineering dashboard
  - Multi-select engineer picker component
  - Real-time PIC assignment with toast feedback

affects:
  - Engineering users can now assign PICs directly from dashboard
  - Removes dependency on manual workarounds for PIC assignment

tech-stack:
  added: []
  patterns:
    - Multi-select with Popover + Command (consistent with CustomApprovalPicker)
    - Optimistic UI with useTransition for async operations
    - Toast notifications via sonner for user feedback

key-files:
  created:
    - src/components/engineering/engineer-pic-picker.tsx
  modified:
    - src/components/engineering/needs-action-list.tsx
    - src/components/engineering/engineering-dashboard-tabs.tsx
    - src/app/(dashboard)/engineering/page.tsx

decisions:
  - decision: Use same UI pattern as CustomApprovalPicker for consistency
    rationale: Familiar interaction pattern, proven implementation
    alternatives: [Build custom multi-select, Use native select with multiple]
    impact: Consistent UX across approval and PIC assignment flows

  - decision: Allow all engineering users as PICs (including self)
    rationale: No business requirement to exclude current user from PIC assignments
    alternatives: [Filter out current user like approval chains]
    impact: Maximum flexibility for PIC assignment

  - decision: Remove static Engineering Team card
    rationale: PIC picker provides same functionality inline where needed
    alternatives: [Keep both]
    impact: Cleaner UI, less redundancy

metrics:
  duration: 2 min
  tasks_completed: 2
  files_created: 1
  files_modified: 3
  commits: 2
  completed: 2026-02-06
---

# Quick Task 004: Add PIC Assignment UI to Engineering Dashboard

**One-liner:** Interactive multi-select PIC picker integrated into engineering dashboard using Popover + Command pattern with real-time assignment and toast feedback

## What Was Built

Added a Person in Charge (PIC) assignment UI to the engineering dashboard that allows engineering users to assign multiple PICs to requests awaiting solution. The implementation leverages the existing `assignEngineers` server action and `RequestEngineerAssignment` model that were built in Phase 4 but had no UI.

## Tasks Completed

### Task 1: Create EngineerPicPicker component

**Files created:**
- `src/components/engineering/engineer-pic-picker.tsx` (199 lines)

**Implementation:**
- Multi-select UI using Popover + Command pattern (consistent with CustomApprovalPicker)
- Toggle selection with checkboxes and checkmarks
- Save button calls `assignEngineers(requestId, selectedIds)` server action
- Loading states with useTransition for async operations
- Toast notifications for success/error feedback via sonner
- Display assigned PICs as compact badges when popover is closed
- Support clearing all PICs (empty array is valid)
- Search functionality to filter engineers by name or email
- Level badge display for engineers with hierarchy level

**Commit:** `de725c3`

### Task 2: Integrate PIC picker into engineering dashboard

**Files modified:**
- `src/components/engineering/needs-action-list.tsx` (replaced static "Assigned To" column)
- `src/components/engineering/engineering-dashboard-tabs.tsx` (pass through props, removed static card)
- `src/app/(dashboard)/engineering/page.tsx` (pass userId as currentUserId)

**Implementation:**
- Updated `NeedsActionListProps` to accept `engineeringUsers` and `currentUserId` props
- Replaced static "Assigned To" display with interactive `EngineerPicPicker` component
- Propagated props through component hierarchy: Page → DashboardTabs → NeedsActionList
- Removed redundant static "Engineering Team" card (lines 58-85) that displayed all engineering users

**Commit:** `ff1ae59`

## Technical Implementation

### Component Architecture

```
engineering/page.tsx (Server Component)
  ↓ passes: userId, engineeringUsers, needsSolution
EngineeringDashboardTabs (Client Component)
  ↓ passes: currentUserId, engineeringUsers
NeedsActionList (Client Component)
  ↓ renders for each request:
EngineerPicPicker (Client Component)
  ↓ calls on save:
assignEngineers(requestId, engineerIds) (Server Action)
```

### UI Pattern

The PIC picker follows the same interaction pattern as the CustomApprovalPicker component:

1. **Collapsed state:** Shows button with assigned PICs as badges (or "Assign PIC" if none)
2. **Open state:** Popover with searchable Command list of all engineering users
3. **Selection:** Click to toggle checkbox, supports multiple selections
4. **Save:** Bottom action bar with selection count, Cancel/Save buttons
5. **Feedback:** Toast notifications for success/error, loading spinner during save

### Key Differences from CustomApprovalPicker

| CustomApprovalPicker | EngineerPicPicker |
|---------------------|-------------------|
| Filters out current user (self-approval prevention) | Includes current user (PICs can assign themselves) |
| Requires ordering (numbered approval chain) | No ordering needed (PICs are unordered) |
| Up/down arrows for reordering | No reordering UI |
| Used in solution submission form | Used in dashboard table cells |

## Deviations from Plan

None. Plan executed exactly as written.

## Verification Results

**Build verification:**
```bash
npx next build --no-lint
✓ Compiled successfully in 4.1s
✓ Generating static pages (21/21)
Build completed successfully
```

**TypeScript compilation:** Passed (no type errors)

**Manual testing checklist:**
- [x] Engineering dashboard loads at /engineering
- [x] Requests Awaiting Solution table shows PIC picker in "Assigned To" column
- [x] Can open picker and see searchable list of all engineering users
- [x] Can select multiple users by clicking (checkmarks appear)
- [x] Can deselect users (checkmarks disappear)
- [x] Save button triggers assignEngineers server action
- [x] Toast notifications appear for success
- [x] Assigned PICs display as badges in collapsed state
- [x] Static Engineering Team card removed from UI

## Impact

**Before:**
- `assignEngineers` server action existed but had no UI
- Engineering users had no way to assign PICs from dashboard
- Static Engineering Team card displayed all engineers but provided no interaction

**After:**
- Engineering users can assign PICs directly from the dashboard table
- Real-time feedback with toast notifications
- Cleaner UI with interactive PIC assignment replacing static reference card
- Consistent multi-select pattern across the application

## Next Phase Readiness

**Blockers:** None

**Concerns:** None

**Dependencies satisfied:**
- Existing `assignEngineers` server action works as expected
- `getEngineeringUsers` provides correct data structure
- `RequestEngineerAssignment` model properly tracks assignments

This quick task completes the PIC assignment feature that was architecturally prepared in Phase 4 but lacked a user interface. Engineering users can now manage PIC assignments efficiently from the dashboard.
