---
phase: quick-010
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server-actions/approvals.ts
  - src/components/requests/request-detail-modal.tsx
autonomous: true

must_haves:
  truths:
    - "Top-level users see only one set of approval buttons in FinalApproval status"
    - "Regular department approval still works correctly in ImprovementRequest status"
    - "Final approval actions still work correctly for eligible approvers"
  artifacts:
    - path: "src/server-actions/approvals.ts"
      provides: "canUserApprove excludes final approval records"
      contains: "isFinalApproval"
    - path: "src/components/requests/request-detail-modal.tsx"
      provides: "Guard against showing regular ApprovalActions during FinalApproval status"
  key_links:
    - from: "src/server-actions/approvals.ts"
      to: "prisma.requestApproval.findFirst"
      via: "isFinalApproval filter"
      pattern: "isFinalApproval.*false"
---

<objective>
Fix duplicate approval buttons showing in the Final Department Approval section of the request detail modal.

Purpose: When a request is in FinalApproval status and the user is a top-level approver (e.g., QC Level-5), both the regular ApprovalActions component and the FinalApprovalActions component render approve/reject buttons. This happens because `canUserApprove()` in approvals.ts does not exclude `isFinalApproval: true` records from its query, so it finds the pending final approval record and returns `canApprove: true`.

Output: Single, clear approval UI in the Final Department Approval section with no duplicate buttons.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/server-actions/approvals.ts (canUserApprove function, lines 120-171)
@src/components/requests/request-detail-modal.tsx (full modal rendering)
@src/components/solutions/final-approval-actions.tsx (FinalApprovalActions component)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix canUserApprove to exclude final approval records and guard modal UI</name>
  <files>
    src/server-actions/approvals.ts
    src/components/requests/request-detail-modal.tsx
  </files>
  <action>
  Two changes needed:

  **1. Server-side fix (primary fix) - src/server-actions/approvals.ts:**

  In the `canUserApprove` function (line ~138), add `isFinalApproval: false` to the Prisma `where` clause in the `requestApproval.findFirst` query. This prevents the function from matching final approval records when checking if a user can perform regular department approval.

  Change the query from:
  ```
  where: {
    requestId,
    requiredLevel: user.level,
    status: 'pending',
  }
  ```
  To:
  ```
  where: {
    requestId,
    requiredLevel: user.level,
    status: 'pending',
    isFinalApproval: false,
  }
  ```

  Also add the same `isFinalApproval: false` filter to the `previousApprovals` query (line ~159-165) to keep the sequential check consistent:
  ```
  where: {
    requestId,
    order: { lt: approval.order },
    status: 'pending',
    isFinalApproval: false,
  }
  ```

  **2. UI-side guard (defense in depth) - src/components/requests/request-detail-modal.tsx:**

  Add a status guard to the regular ApprovalActions rendering block (line ~464). The regular approval actions should NOT show when the request is in FinalApproval status, even if canApprove is true. Change:
  ```
  {canApprove && (
  ```
  To:
  ```
  {canApprove && request.status !== 'FinalApproval' && request.status !== 'Completed' && (
  ```

  This provides defense-in-depth: even if the server-side fix has an edge case, the UI won't show regular approval buttons during final approval flow.
  </action>
  <verify>
  1. `npx tsc --noEmit` - TypeScript compilation succeeds
  2. Manual verification: Open a request in FinalApproval status as a top-level user. Only ONE set of Approve/Reject buttons should appear in the "Final Department Approval" section.
  3. Regular department approval should still work for requests in ImprovementRequest status.
  </verify>
  <done>
  - Top-level users see exactly one Approve button in the Final Department Approval section
  - No duplicate approval UI appears in the request detail modal
  - Regular department approvals unaffected (isFinalApproval: false filter only excludes final records)
  </done>
</task>

</tasks>

<verification>
- TypeScript compiles without errors
- In FinalApproval status: only FinalApprovalActions buttons visible, no regular ApprovalActions
- In ImprovementRequest status: regular ApprovalActions still work as before
- The "Final approval in progress" info card shows without duplicate action buttons
</verification>

<success_criteria>
- Zero duplicate approval buttons in the Final Department Approval section
- Regular approval flow unaffected
- TypeScript compilation passes
</success_criteria>

<output>
After completion, create `.planning/quick/010-fix-duplicate-approval-buttons-in-final-/010-SUMMARY.md`
</output>
