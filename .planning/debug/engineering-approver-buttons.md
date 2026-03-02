---
status: resolved
trigger: "Engineering approvers don't see Approve/Reject buttons when request status is DesignCostEstimationApproval"
created: 2026-02-04T00:00:00Z
updated: 2026-02-04T00:00:00Z
---

## Current Focus
hypothesis: ROOT CAUSE FOUND - Button rendering requires BOTH canApproveSolution=true AND userRole='engineering' in request detail modal
test: Verified at line 418 in request-detail-modal.tsx
expecting: Buttons to show only when both conditions are met
next_action: Trace canUserApproveSolution logic to find why it returns false for engineering approvers

## Symptoms
expected: Engineering approvers should see "Approve" and "Reject" buttons when request status is "DesignCostEstimationApproval"
actual: Engineering approvers don't see the buttons
errors: None reported
reproduction: Submit solution, change status to DesignCostEstimationApproval, login as engineering approver, open request detail modal
started: Not specified (appears to be a newly discovered issue)

## Eliminated

## Evidence
- timestamp: 2026-02-04T00:00:00Z
  checked: RequestDetailModal component, lines 418-436
  found: Button rendering condition: `{canApproveSolution && userRole === 'engineering' && (`
  implication: Buttons show only when BOTH canApproveSolution=true AND userRole is 'engineering'

- timestamp: 2026-02-04T00:00:00Z
  checked: loadRequest function in RequestDetailModal, lines 111-118
  found: Loop through solutionApprovals and call canUserApproveSolution for each
  implication: canApproveSolution is set to true only if at least one approval returns canApprove=true

- timestamp: 2026-02-04T00:00:00Z
  checked: canUserApproveSolution function in solutions.ts, lines 449-545
  found: Critical check at line 486: `if (solution.request.status !== RequestStatus.DesignCostEstimationApproval)`
  implication: Returns {canApprove: false} if request status is NOT DesignCostEstimationApproval

- timestamp: 2026-02-04T00:00:00Z
  checked: canUserApproveSolution logic for custom chains, lines 503-513
  found: Only checks custom chain if user.role === UserRole.engineering
  implication: Custom chain approval checks require engineering role

- timestamp: 2026-02-04T00:00:00Z
  checked: canUserApproveSolution logic for hierarchy chains, lines 517-527
  found: Only checks hierarchy if user.level exists AND user.role === UserRole.engineering
  implication: Hierarchy approval checks require engineering role AND user level

- timestamp: 2026-02-04T00:00:00Z
  checked: Solution submission page, lines 65-76 in /src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx
  found: Fetches ALL active users without role filtering: `where: { isActive: true }`
  implication: Non-engineering users can be selected as custom approvers during solution submission

- timestamp: 2026-02-04T00:00:00Z
  checked: createCustomApprovalChain function in solutions.ts, lines 178-216
  found: No validation that approver IDs belong to engineering users
  implication: Custom approval chain can include non-engineering users

- timestamp: 2026-02-04T00:00:00Z
  checked: canUserApproveSolution custom chain logic, lines 503-513
  found: `if (user.role === UserRole.engineering)` - only checks custom approval if user is engineering
  implication: ROOT CAUSE - If a non-engineering user was selected as custom approver, the approval check will fail because it only runs for users with role === 'engineering'

## Resolution
root_cause: The canUserApproveSolution function in solutions.ts (lines 503-513) has a logic flaw in the custom chain approval check. The code is:

```typescript
if (user.role === UserRole.engineering) {
  // Check for custom chain approval
  approval = await prisma.solutionApproval.findFirst({
    where: {
      solutionId,
      status: 'pending',
      isCustomChain: true,
      requiredApproverId: userId,
    },
    orderBy: { order: 'asc' },
  })
}
```

This means the custom approval lookup is ONLY executed if `user.role === UserRole.engineering`. However, according to UAT requirements (04-engineering-solutions-UAT-v2.md, test 3), the solution submission form SHOULD allow selection of ANY active user (including non-engineering) as custom approvers.

**The contradiction:**
- UAT expects: Custom approvers can be ANY user from any department
- Code does: Allows selecting any user, but only checks approval eligibility for engineering users
- Result: Non-engineering users selected as custom approvers can never approve because the lookup never executes for them

The same issue affects the button rendering at request-detail-modal.tsx line 418 which requires `userRole === 'engineering'`, preventing non-engineering custom approvers from seeing the buttons at all.

fix: **Remove role restriction for custom chain approvals**

The fix must allow ANY user (regardless of role) to be in a custom approval chain and approve solutions:

1. **Update canUserApproveSolution in solutions.ts** (lines 503-513):
   - Remove `if (user.role === UserRole.engineering)` condition for custom chain lookup
   - Keep the role check for hierarchy-based approvals (engineering-only)
   - Allow any user to be found in custom approval chain if they're the requiredApproverId

2. **Update button rendering in request-detail-modal.tsx** (line 418):
   - Change condition from `{canApproveSolution && userRole === 'engineering' && (`
   - To: `{canApproveSolution && (`
   - Remove the engineering role requirement since custom approvers can be any role

3. **Add validation for security**:
   - Keep the approval check logic that verifies the user is actually in the approval chain
   - The security comes from being in the approval chain (requiredApproverId match), not from the role

verification:
1. Test with engineering user in custom approval chain - should see buttons and be able to approve
2. Test with non-engineering user (e.g., manager from another dept) in custom approval chain - should see buttons and be able to approve
3. Test hierarchy-based approvals - should still only work for engineering users at correct levels
4. Test that users NOT in approval chain cannot see buttons (security validation)

files_changed:
- src/server-actions/solutions.ts (remove role check for custom chain, lines 503-513)
- src/components/requests/request-detail-modal.tsx (remove engineering role requirement for buttons, line 418)
