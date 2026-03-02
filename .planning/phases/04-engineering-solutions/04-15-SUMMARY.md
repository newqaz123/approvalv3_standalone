---
phase: 04-engineering-solutions
plan: 15
subsystem: "Custom Approval Chain Authorization"
tags: ["authorization", "custom-approval-chains", "role-restrictions", "cross-department"]

dependency_graph:
  requires:
    - "04-01 (Solution data model with custom approval chains)"
    - "04-10 (Fix custom approval chain to show all users)"
  provides:
    - "Cross-department custom approval chain functionality"
    - "Role-agnostic custom approver authorization"
  affects:
    - "04-16 (Visual hierarchy for Solution Approval Progress) - depends on working approval buttons"

tech_stack:
  added: []
  patterns:
    - "Role-based conditional logic - different rules for custom vs hierarchy approvals"
    - "Server-side authorization validation - security at canUserApproveSolution level"
    - "UI rendering based on authorization result - not preemptive role filtering"

key_files:
  created: []
  modified:
    - path: "src/server-actions/solutions.ts"
      changes: "Removed engineering role check from custom chain approval lookup (lines 503-512)"
      impact: "Non-engineering users can now pass authorization checks for custom chains"
    - path: "src/components/requests/request-detail-modal.tsx"
      changes: "Removed userRole === 'engineering' condition from button rendering (line 426)"
      impact: "Non-engineering custom approvers can see and use approval buttons"

decisions_made:
  - title: "Remove role restrictions for custom approval chains"
    context: "Custom chains allow selecting any active user as approver, but code restricted buttons and authorization to engineering role only"
    decision: "Remove engineering role requirement from both server-side authorization (solutions.ts) and UI button rendering (request-detail-modal.tsx) for custom chains"
    rationale: "Security comes from requiredApproverId match, not role check. Custom chains are designed for cross-department approval (finance, management, etc.). Role restriction breaks this design intent."
    alternatives_considered:
      - "Keep role restriction and limit custom chains to engineering only - rejected, breaks cross-department use case"
      - "Add separate 'custom_approver' role - rejected, unnecessary complexity, requiredApproverId provides sufficient security"

metrics:
  duration: "15 minutes"
  completed: "2026-02-05"
  commits: 3
  tests_verified: "5/5 tests passed"

deviations_from_plan: "1 bug auto-fixed during verification"

authentication_gates: "None encountered"
---

# Phase 04 Plan 15: Fix Approval Button Visibility for Custom Approvers Summary

**One-liner:** Removed engineering role restrictions from custom approval chain authorization to enable cross-department approvers (finance, management, etc.) to see and use approval buttons.

## Overview

Fixed a critical gap where custom approval chains allowed selecting any active user (including non-engineering users like finance managers) as approvers, but the code restricted both authorization checks and button visibility to engineering users only. This made cross-department custom chains non-functional.

## Implementation Details

### Task 1: Remove role restriction for custom chain approval checks

**File:** `src/server-actions/solutions.ts` (lines 503-527)

**Change:** Removed the `if (user.role === UserRole.engineering)` wrapper around the custom chain approval lookup.

**Before:**
```typescript
if (user.role === UserRole.engineering) {
  // Check for custom chain approval
  approval = await prisma.solutionApproval.findFirst({...})
}
```

**After:**
```typescript
// Check for custom chain approval (any role can be in custom chain)
approval = await prisma.solutionApproval.findFirst({
  where: {
    solutionId,
    status: 'pending',
    isCustomChain: true,
    requiredApproverId: userId,
  },
  orderBy: { order: 'asc' },
})
```

**Security maintained:** The `requiredApproverId: userId` match ensures only specifically selected approvers can approve, regardless of role.

**Preserved:** Hierarchy-based approval check (lines 515-525) still requires engineering role - this is correct behavior.

### Task 2: Remove engineering role requirement from approval button rendering

**File:** `src/components/requests/request-detail-modal.tsx` (line 426)

**Change:** Removed `userRole === 'engineering'` condition from button visibility check.

**Before:**
```typescript
{canApproveSolution && userRole === 'engineering' && (
  <div className="flex gap-2 pt-2">
    <Button onClick={handleApproveSolution} size="sm">
      Approve Solution
    </Button>
    ...
  </div>
)}
```

**After:**
```typescript
{canApproveSolution && (
  <div className="flex gap-2 pt-2">
    <Button onClick={handleApproveSolution} size="sm">
      Approve Solution
    </Button>
    ...
  </div>
)}
```

**Why this is safe:** The `canApproveSolution` value comes from `canUserApproveSolution()` server action, which already validates:
- User is in custom approval chain (any role) OR
- User is engineering at correct hierarchy level

UI doesn't need redundant role check - security is enforced server-side.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed approval.id parameter bug in approveSolution function**

- **Found during:** User verification testing
- **Issue:** approval.id was being passed to approveSolution() instead of solutionId, causing 500 error during approval
- **Root cause:** Code review mismatch - function signature expects solutionId but UI was passing approval.id from loop variable
- **Fix:** Changed approveSolution(approval.id) to approveSolution(approval.solutionId) in request-detail-modal.tsx
- **Files modified:** src/components/requests/request-detail-modal.tsx
- **Verification:** User tested approval workflow - buttons now work correctly for all scenarios
- **Committed in:** 30c3b14 (separate fix commit after plan tasks)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix necessary for functionality. No scope creep.

## Authentication Gates

None encountered during execution.

## Commits

| Commit | Hash | Message |
|--------|------|---------|
| Task 1 | 35b02a5 | fix(04-15): remove role restriction for custom chain approval checks |
| Task 2 | 9af1fd7 | fix(04-15): remove engineering role requirement from approval button rendering |
| Bug Fix | 30c3b14 | fix(04-15): fix approval button visibility - pass solutionId instead of approval.id |
| Docs | 05f2915 | docs(04-15): complete fix approval button visibility for custom approvers plan |

## Verification Results

User approved all 5 test cases:

✅ **Test 1:** Engineering user in custom approval chain sees Approve/Reject buttons
✅ **Test 2:** Non-engineering user in custom approval chain sees Approve/Reject buttons
✅ **Test 3:** Engineering user in hierarchy-based approval sees Approve/Reject buttons
✅ **Test 4:** Requesters don't see approval buttons for their own requests (security maintained)
✅ **Test 5:** Unrelated users don't see approval buttons (security maintained)

**Security validation confirmed:**
- Approval eligibility validated server-side via canUserApproveSolution()
- requiredApproverId match provides security for custom chains
- Hierarchy approvals still require engineering role
- No security bypasses introduced

**Bug discovered and fixed during testing:**
The approval.id → solutionId bug was discovered when user tested the approval buttons. This caused a 500 error when clicking approve. Fixed immediately and verified working.

## Next Phase Readiness

**✅ Complete:** All verification tests passed, bug fixed, plan fully functional.

**Ready for next gap closure plan:**
- Custom approval chains now work as designed across all departments
- Approval buttons display correctly for all eligible users
- Authorization logic centralized in server actions
- No blockers or concerns

**Related gaps:** This fix fully resolves the "Non-engineering custom approvers can't see approval buttons" gap diagnosed in 04-gap-closure-UAT.md.

---

**Executed:** 2026-02-04
**Committer:** Red-Copperpot
**Session:** Gap closure execution for Phase 04 UAT issues
