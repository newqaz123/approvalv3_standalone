# Post-Commit Workflow Notifications Implementation Plan

> **Goal:** Prevent slow SMTP/global-Prisma notification work from expiring interactive Prisma transactions or leaving orphan notifications when workflow writes roll back.

## Root cause

`rejectFinalApproval()` invokes two `notifyUsersInDepartment()` calls inside a Prisma interactive transaction. That helper writes through the global Prisma client and awaits SMTP. The observed SMTP work took 9.5–10.2 seconds, exceeding Prisma's 5-second transaction timeout. The workflow transaction rolled back while globally written notifications committed independently.

The same unsafe pattern is reachable from adjacent solution/final-approval transaction paths.

## Constraints

- Do not increase Prisma's transaction timeout.
- Do not fire-and-forget notifications.
- Preserve existing workflow mutations, notification payloads, recipients, and exclusions.
- Keep direct `tx.notifications.create()` writes that perform only transactional database I/O.
- Treat post-commit notification delivery as best effort: log dispatch failures without reporting a committed workflow mutation as rolled back.
- Do not modify migrations or budget-control code.

## Task 1: Add the post-commit notification transaction primitive (TDD)

**Files:**
- Create `src/lib/post-commit-notifications.ts`
- Create `tests/regression/post-commit-notifications.test.ts`

1. Write behavioral tests proving:
   - transaction commit completes before a deferred notifier starts;
   - a rolled-back transaction dispatches nothing;
   - independent notifications dispatch concurrently;
   - dispatch failure is logged but does not reverse or falsely fail the committed workflow result.
2. Run the focused test and observe the expected RED failure.
3. Implement the minimal generic transaction wrapper and enqueue-only collector.
4. Run the focused test to GREEN.

## Task 2: Move every affected solution/final notification out of transactions

**File:** `src/server-actions/solutions.ts`

1. Add a local Prisma adapter around the tested post-commit wrapper.
2. Replace unsafe notification delivery inside transactions in:
   - `approveSolution()`
   - `rejectSolution()`
   - `initiateFinalApproval()`
   - `approveFinalApproval()`
   - `rejectFinalApproval()`
   - auto-approved `resubmitSolution()`
3. Convert `notifyNextSolutionApprover()` and `notifyNextFinalApprover()` into transaction-safe plan collectors that only query through `tx` and enqueue descriptions.
4. Preserve direct transaction-client notification rows that do not invoke SMTP.
5. Run focused and full regression tests.

## Task 3: Verify the reported failure and clean orphan test data

1. Confirm `test notifications 04` is still `FinalApproval` with a pending final approval before retesting.
2. Exercise rejection through the running feature server.
3. Verify the request becomes `SentToEngineer`, final approvals become rejected, and the rejection activity commits.
4. Verify no P2028 occurs and notification delivery starts after commit.
5. Delete only the 10 pre-fix orphan `Final Approval Rejected` notifications for this request, preserving the post-fix notification set and every workflow/audit record.

## Task 4: Independent review and fresh verification

1. Request a fresh read-only review of correctness, transaction boundaries, notification semantics, and test quality.
2. Address Critical/Important findings.
3. Run:
   - focused new regression test;
   - full regression suite;
   - `npm run test:manage`;
   - `npm run check` (compare with the known budget-control baseline errors);
   - `git diff --check` and `git status --short`.
4. Run `graphify update .`.
5. Keep the feature branch/worktree unmerged unless the user explicitly chooses integration.
