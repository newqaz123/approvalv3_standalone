---
phase: quick-016
plan: 01
subsystem: ui-organization
tags: [modal-layout, attachments-grouping, approvals-grouping, pdf-export, readability]

# Dependency graph
requires:
  - phase: 13-pdf-excel-reporting
    plan: 03
    provides: ExportPDFButton component and PDF generation
provides:
  - Reorganized request detail modal with grouped attachments and approvals
  - Single "All Attachments" section with categorized sub-sections
  - Consolidated approval sections for improved readability
  - PDF layout matching modal structure
affects:
  - User experience for viewing requests with multiple attachment types
  - PDF export consistency with modal view

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Conditional rendering for attachment grouping
    - Section-based layout organization
    - Consistent structure between modal and PDF exports
    - Count-based headers for attachment groups

key-files:
  created: []
  modified:
    - src/components/requests/request-detail-modal.tsx
    - src/lib/pdf.ts

key-decisions:
  - "Single 'All Attachments' section with Initial Request and Engineering Solution sub-groups"
  - "Attachment groups show count in header for quick reference"
  - "All approval sections grouped together after attachments"
  - "PDF structure mirrors modal layout for consistency"

patterns-established:
  - "Grouped attachments pattern: All Attachments → categorized sub-sections"
  - "Approval consolidation pattern: All approval types grouped in single block"
  - "Layout order: Description → Requester → Engineering Solution → All Attachments → All Approvals → Activity Timeline"

# Metrics
duration: 2min
completed: 2026-02-21
---

# Quick Task 016: Rearrange Data Field in Detail Modal Summary

**Reorganized request detail modal to group all attachments by stage and consolidate all approval sections, with matching PDF export layout**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-21T04:31:47Z
- **Completed:** 2026-02-21T04:33:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- **Single "All Attachments" section** replacing scattered attachment displays
  - Initial Request Attachments sub-group with count
  - Engineering Solution Attachments sub-group with count
  - Each attachment shows name, size, uploader, date, and download button
- **Consolidated approval sections** grouped together in logical order
  - Engineering Solution Approval (if solution exists)
  - Final Department Approval (initiation and progress)
  - Regular Department Approval (if no solution)
- **Updated PDF layout** to match modal reorganization
  - Same attachment grouping structure
  - Consistent section ordering
- **Improved readability** especially for SendBackToRequester/Completed statuses

## Task Commits

Each task was committed atomically:

1. **Task 1: Reorganize modal layout** - `82a3e1a` (feat)
2. **Task 2: Update PDF layout** - `e529a52` (feat)

## Files Created/Modified

### Modified
- `src/components/requests/request-detail-modal.tsx` - Reorganized layout with grouped attachments and approvals
- `src/lib/pdf.ts` - Updated PDF structure to match modal

## Changes Made

### Modal Layout Reorganization (request-detail-modal.tsx)

**Before:**
- Solution attachments displayed within Engineering Solution section
- Request attachments displayed separately at bottom
- Approval sections scattered throughout modal

**After:**
- Single "All Attachments" section after Engineering Solution
  - "Initial Request Attachments (N)" sub-group
  - "Engineering Solution Attachments (N)" sub-group
- All approval sections grouped together:
  - Engineering Solution Approval
  - Final Department Approval (initiation/progress)
  - Regular Department Approval
- Layout order:
  1. Description
  2. Requester Info
  3. Engineering Solution
  4. All Attachments (grouped)
  5. All Approvals (grouped)
  6. Activity Timeline

### PDF Layout Update (pdf.ts)

**Before:**
- Separate "Request Attachments" and "Solution Attachments" sections
- Solution attachments nested within Engineering Solution section

**After:**
- Single "All Attachments" section with sub-groups
- "Initial Request Attachments (N)" subsection
- "Engineering Solution Attachments (N)" subsection
- Matches modal structure exactly

## Decisions Made

- **Grouped attachments by stage** - Makes it easier to find all related documents in one place while maintaining context about which stage they belong to
- **Count in headers** - Shows "Initial Request Attachments (3)" so users know how many files to expect
- **Approval consolidation** - All approval types grouped together makes the approval workflow clearer
- **PDF-modal consistency** - PDF export matches modal layout for better user experience

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None.

## Verification Results

All verification criteria met:
- ✅ Modal attachments grouped by stage with counts
- ✅ Modal approvals grouped together in correct order
- ✅ PDF layout mirrors modal changes
- ✅ No duplicate information displays
- ✅ All statuses display correctly
- ✅ Build successful with no TypeScript errors

## Benefits

- **Improved readability** - All attachments accessible from single section
- **Better organization** - Clear separation between request and solution attachments
- **Consistent experience** - PDF export matches modal view
- **Easier navigation** - Approval workflow clearer with consolidated sections

---

*Quick Task: 016-rearrange-data-field-in-detail-modal*
*Plan: 01*
*Completed: 2026-02-21*
