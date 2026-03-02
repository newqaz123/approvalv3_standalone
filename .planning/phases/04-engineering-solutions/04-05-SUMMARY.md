---
phase: 04-engineering-solutions
plan: 05
subsystem: server-actions, components, approvals
tags: [final-approval, custom-approval-chains, department-workflow, request-completion]

# Dependency graph
requires:
  - phase: 04-engineering-solutions
    plan: 03
    provides: Solution approval workflow, status transitions
  - phase: 03-approval-engine
    provides: RequestApproval model, approval patterns, notification system
provides:
  - Final department approval workflow for solution sign-off
  - Custom approval chain support for final approvals
  - Request completion status transition from FinalApproval
  - Rejection loop back to engineering for solution revision
affects: [04-06, 04-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Final approval using RequestApproval model with isFinalApproval flag
    - Dual-mode final approval (custom chain or department hierarchy)
    - Three-stage completion: SendBackToRequester → FinalApproval → Completed
    - Transaction-based approval completion with requester notification

key-files:
  created:
    - src/components/solutions/final-approval-actions.tsx
    - src/app/api/departments/[departmentId]/users/route.ts
  modified:
    - prisma/schema.prisma
    - src/server-actions/solutions.ts
    - src/components/requests/request-detail-modal.tsx

key-decisions:
  - "Extended RequestApproval model instead of creating separate model - reuses existing infrastructure, simpler queries"
  - "Auto-filter initiator from custom approval chains - prevents self-approval blocking"
  - "Final rejection returns to SentToEngineer - allows engineering to revise and resubmit solution"
  - "Use button selection instead of RadioGroup for hierarchy/custom choice - better mobile UX, avoids shadcn/ui dependency issues"

patterns-established:
  - "Pattern 1: Final approval chain creation mirrors solution approval pattern with isFinalApproval flag"
  - "Pattern 2: Status transition SendBackToRequester → FinalApproval → Completed completes three-stage workflow"
  - "Pattern 3: Rejection loops back to SentToEngineer for iterative improvement"
  - "Pattern 4: Contextual UI sections based on request status (initiate, progress, summary)"

# Metrics
duration: 8min
completed: 2026-02-02
---

# Phase 4 Plan 5: Final Department Approval Summary

**Final department approval workflow with custom chain support, solution completion tracking, and rejection loop back to engineering**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-02T09:50:02Z
- **Completed:** 2026-02-02T09:58:09Z
- **Tasks:** 4
- **Files modified:** 5

## Accomplishments

- Extended RequestApproval model with final approval support (isFinalApproval, requiredApproverId, isCustomChain flags)
- Implemented final approval server actions (initiate, approve, reject) supporting both custom chains and hierarchy
- Created InitiateFinalApprovalButton component with hierarchy/custom chain selection dialog
- Integrated final approval workflow into request detail modal with contextual sections for each status
- Added department users API endpoint for custom approval picker integration
- Implemented rejection flow returning requests to SentToEngineer for engineering revision

## Task Commits

Each task was committed atomically:

1. **Task 1: Update RequestApproval model for final approval** - `6685f22` (feat)
2. **Task 2: Add final approval server actions** - `334a289` (feat)
3. **Task 3: Create final approval actions component** - `16acbd3` (feat)
4. **Task 4: Integrate final approval into request detail modal** - `12b24c7` (feat)

## Files Created/Modified

- `prisma/schema.prisma` - Extended RequestApproval with isFinalApproval, requiredApproverId, isCustomChain fields; added requiredToApproveForRequest relation to User
- `src/server-actions/solutions.ts` - Added initiateFinalApproval, approveFinalApproval, rejectFinalApproval, canUserApproveFinalApproval, createCustomFinalApprovalChain, createHierarchyFinalApprovalChain, notifyNextFinalApprover
- `src/components/solutions/final-approval-actions.tsx` - Created InitiateFinalApprovalButton with hierarchy/custom selection, FinalApprovalActions with approve/reject dialogs, FinalApprovalStatus display
- `src/components/requests/request-detail-modal.tsx` - Added final approval state management, contextual sections for SendBackToRequester/FinalApproval/Completed statuses, department users loading
- `src/app/api/departments/[departmentId]/users/route.ts` - Department users API endpoint for custom approval picker

## Decisions Made

- **RequestApproval extension:** Extended existing model instead of creating FinalApproval model - reuses approval infrastructure, simplifies queries, maintains consistency with solution approval pattern
- **Auto-filter initiator:** Custom approval chains automatically filter out initiator - prevents self-approval blocking submission, better UX
- **Rejection loop back:** Final rejection returns to SentToEngineer instead of keeping in FinalApproval - allows engineering to revise solution and resubmit, supports iterative improvement
- **Button selection UI:** Used button-based selection instead of RadioGroup for hierarchy/custom choice - better mobile responsiveness, avoids potential shadcn/ui component dependency issues
- **Separate approval records:** Final approvals use isFinalApproval flag instead of separate table - enables filtering final approvals, keeps single source of truth for request approvals

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tasks completed without issues.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Final approval workflow complete with full custom chain and hierarchy support
- Three-stage approval loop operational: Department → Engineering → Final Department → Completed
- Rejection flow allows engineering revision and resubmission
- Request detail modal supports all final approval statuses with appropriate actions
- Ready for 04-06 (Solution file upload integration) and 04-07 (Email notifications for approval workflow)

---
*Phase: 04-engineering-solutions*
*Completed: 2026-02-02*
