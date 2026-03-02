---
phase: 04-engineering-solutions
plan: 02
subsystem: ui, forms, file-upload
tags: [react-hook-form, zod, custom-approval-chain, file-upload, solution-submission, shadcn-ui]

# Dependency graph
requires:
  - phase: 04-01
    provides: Solution model, SolutionApproval model, submitSolution server action, RequestStatus values
provides:
  - Solution submission form with cost estimate validation and file uploads
  - Custom approval picker with sequential approver selection
  - Solution preview component for pre-submission review
  - Solution file upload component supporting PDF, images, CAD files, Office docs
  - Solution submission page route at /engineering/solutions/[requestId]
affects: [04-03, 04-04, 04-05, 04-06]

# Tech tracking
tech-stack:
  added: [cmdk (command component), @radix-ui/react-popover, @radix-ui/react-switch]
  patterns:
    - Preview-before-submit pattern for irreversible submissions
    - Custom approval chain builder with drag reordering
    - Multi-file upload with progress tracking and validation
    - React Hook Form with Zod resolver for type-safe form validation

key-files:
  created:
    - src/components/solutions/custom-approval-picker.tsx
    - src/components/solutions/solution-preview.tsx
    - src/components/solutions/solution-file-upload.tsx
    - src/components/solutions/solution-form.tsx
    - src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx
    - src/components/ui/popover.tsx
    - src/components/ui/command.tsx
    - src/components/ui/switch.tsx
  modified: []

key-decisions:
  - "Preview-before-submit pattern - prevents accidental submission, allows review of all data before final commit"
  - "Custom approval chain as sequential list - users understand approval order clearly"
  - "File upload via existing /api/upload endpoint - reuses proven file handling pattern"
  - "Auto-filter current user from approvers - prevents self-approval blocking submission"

patterns-established:
  - "Pattern 1: Preview-before-submit - form data → preview read-only → confirm submit → execute action"
  - "Pattern 2: Custom approval chain builder - searchable user list with sequential ordering"
  - "Pattern 3: Multi-file upload with drag-drop - validation, progress tracking, remove functionality"

# Metrics
duration: 7min
completed: 2026-02-02
---

# Phase 4 Plan 2: Solution Submission Form Summary

**Solution submission form with cost estimate validation, custom approval chain picker, multi-file uploads, and preview-before-submit flow**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-02T09:38:27Z
- **Completed:** 2026-02-02T09:45:35Z
- **Tasks:** 5
- **Files created:** 8

## Accomplishments

- Created custom approval picker component with sequential approver selection and reordering
- Built solution preview component for pre-submission review with THB currency formatting
- Implemented solution file upload component supporting PDF, images, CAD files, and Office docs
- Developed main solution form with React Hook Form, Zod validation, and preview flow
- Created solution submission page route with server-side auth and role validation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create custom approval picker component** - `60b375c` (feat)
2. **Task 2: Create solution preview component** - `ca6b7cb` (feat)
3. **Task 3: Create solution file upload component** - `1e8482b` (feat)
4. **Task 4: Create main solution form component** - `10dc5a8` (feat)
5. **Task 5: Create solution submission page route** - `88de46a` (feat)
6. **Chore: Install shadcn/ui components** - `8a1d63d` (chore)

**Plan metadata:** (pending in final commit)

## Files Created/Modified

- `src/components/solutions/custom-approval-picker.tsx` - Sequential approver selection with search/filter and up/down reordering
- `src/components/solutions/solution-preview.tsx` - Pre-submission review with formatted costs and approval chain display
- `src/components/solutions/solution-file-upload.tsx` - Drag-drop file upload with validation (PDF, images, CAD, Office docs)
- `src/components/solutions/solution-form.tsx` - Main form with React Hook Form, Zod validation, file uploads, preview flow
- `src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx` - Solution submission page with server-side validation
- `src/components/ui/popover.tsx` - shadcn/ui Popover component for user search
- `src/components/ui/command.tsx` - shadcn/ui Command component for combobox functionality
- `src/components/ui/switch.tsx` - shadcn/ui Switch component for custom approval toggle

## Decisions Made

- **Preview-before-submit pattern:** Irreversible submissions require explicit confirmation step after reviewing all entered data
- **Sequential approval chain display:** Numbered badges (1, 2, 3...) clearly show approval order to users
- **File type extension checking:** CAD files use application/octet-stream MIME type, validated by file extension
- **Auto-filter submitter:** Custom approval picker automatically removes current user from available options to prevent self-approval
- **Reused upload pattern:** File upload uses existing /api/upload endpoint and prepareFileUpload/confirmFileUpload server actions for consistency

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing shadcn/ui components**
- **Found during:** Task 1 (CustomApprovalPicker component creation)
- **Issue:** Plan specified using Popover, Command, and Switch components which were not installed
- **Fix:** Ran `npx shadcn@latest add popover command switch --yes` to install required components
- **Files modified:** src/components/ui/popover.tsx, src/components/ui/command.tsx, src/components/ui/switch.tsx (created)
- **Verification:** Components render without errors, TypeScript compiles
- **Committed in:** 8a1d63d (chore commit after task commits)

**2. [Rule 1 - Bug] Fixed Zod schema validation error for costEstimate**
- **Found during:** Task 4 (SolutionForm component creation)
- **Issue:** `invalid_type_error` option not supported in newer Zod version, causing TypeScript error
- **Fix:** Changed to `.number({ message: 'Enter a valid cost' })` syntax compatible with Zod v4
- **Files modified:** src/components/solutions/solution-form.tsx
- **Verification:** TypeScript compiles without errors, form validation works correctly
- **Committed in:** 10dc5a8 (part of Task 4 commit)

**3. [Rule 1 - Bug] Fixed Zod schema default values and optional fields**
- **Found during:** Task 4 (TypeScript compilation)
- **Issue:** `.default()` and `.or(z.literal(''))` patterns incompatible with zodResolver type inference
- **Fix:** Removed `.default()` from currency and useCustomApprovals, changed optional fields to simple `.optional()`
- **Files modified:** src/components/solutions/solution-form.tsx
- **Verification:** TypeScript compiles, form initializes with correct default values in component code
- **Committed in:** 10dc5a8 (part of Task 4 commit)

**4. [Rule 1 - Bug] Fixed TypeScript implicit any errors in customApprovers mapping**
- **Found during:** Task 4 (TypeScript compilation)
- **Issue:** Array filter and map functions had implicit any type parameters
- **Fix:** Added explicit type annotations for all callback parameters in customApprovers chain
- **Files modified:** src/components/solutions/solution-form.tsx
- **Verification:** TypeScript compiles without errors
- **Committed in:** 10dc5a8 (part of Task 4 commit)

---

**Total deviations:** 4 auto-fixed (1 blocking, 3 bugs)
**Impact on plan:** All auto-fixes necessary for functionality. No scope creep. shadcn component installation was planned dependency, Zod fixes corrected version compatibility issues.

## Issues Encountered

None - plan executed smoothly with expected dependency installation and TypeScript type fixes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Solution submission form complete with all required fields and validation
- Custom approval chain picker ready for use
- File upload component supports all required file types per WFL-05
- Preview-before-submit flow prevents accidental submissions
- Ready for 04-03 (Engineering dashboard) and 04-04 (Solution approval workflow UI)

---
*Phase: 04-engineering-solutions*
*Completed: 2026-02-02*
