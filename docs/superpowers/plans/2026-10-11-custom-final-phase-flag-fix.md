# Custom Final Phase Flag Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Newly created custom FINAL approvals are classified as FINAL, allowing only the current named approver to approve and displaying a separate FINAL stage.

**Architecture:** Fix the custom-attempt creation seam, not authorization consumers. `createCustomPersonAttempt` currently omits the request approval `isFinalApproval` field; Prisma defaults it to false. Capability lookup, transaction eligibility and modal classification consume that field. Normal FINAL creation already sets it correctly.

**Tech Stack:** TypeScript, Prisma, node:test/tsx, Next.js, existing headed Playwright manual harness.

**Spec:** Approved owner instruction “Fix and retest”; observed blocker in `test-results/manual-pd1-headed/20261011-000947-custom-final-continuation/summary.md`; existing `docs/superpowers/specs/2026-09-05-organization-approval-redesign-design.md`.

## Global Constraints
- Use the existing organization-approval-redesign worktree; preserve its dirty baseline, all failed records and existing requests. No commits, stashes, resets or broad refactors.
- No permission bypasses or weaker phase/current-instance/current-turn checks.
- No schema changes, migrations, seeds, configuration changes or SQL repairs. Existing faulty request remains Final Approval / 5 approved / 2 pending.
- Preserve exact ordered custom person IDs, routing mode, instance identity and no auto-approval semantics.
- Run `npm run check` after code changes and `graphify update .` after the fix.
- Browser testing uses only the identity-verified owned isolated runtime, headed slowMo 1500ms, viewport 1440x1000 and six-second checkpoint pauses. Never print credentials.

## Review Focus
- Custom FINAL request rows must explicitly carry `isFinalApproval: true`.
- Custom REQUEST request rows must not become FINAL rows.
- SOLUTION rows must not receive the request-only flag.
- Named-person order and current-turn restrictions must remain unchanged.
- Existing faulty persisted rows are not repaired by a creation-only change; distinguish fresh-case success from historical remediation.

### Task 1: Regression and minimal creation fix
**Files:** `src/lib/approval-engine/attempts.ts`; `tests/regression/clean-start-attempts.test.ts` (or a focused new regression file using the same in-memory harness if required).
**Interface:** Existing `createCustomPersonAttempt(tx, {requestId?, solutionId?, phase, orderedApproverIds, actorId})`; no signature change.

- [ ] Capture branch/HEAD/status and before-copies of the two owned files into new evidence; preserve pre-existing changes.
- [ ] Add real-builder tests proving custom FINAL request rows explicitly have true, custom REQUEST rows explicitly false, and SOLUTION rows contain no request-only flag. Also preserve ordered IDs, CUSTOM_PERSON mode and pending status.
- [ ] Run `npx tsx --test tests/regression/clean-start-attempts.test.ts` (plus any new file); retain RED evidence showing missing FINAL flag, not a setup/import error.
- [ ] In the request_approvals creation branch only, write `isFinalApproval: input.phase === 'FINAL'`. Do not add the field to solution_approvals or alter guards/consumers.
- [ ] Repeat focused tests to GREEN; run full `npm run check`; record command/exit/results without swallowing failures.
- [ ] Run `graphify update .`; capture the incremental fix diff against before-copies.
- [ ] Ask parent for patch-review clearance before any fresh browser business mutations.

### Task 2: Fresh combined custom-case verification
**Files:** New /tmp runner plus new test-results evidence only; reuse proven helpers and selector evidence, not original failed output paths.

- [ ] Repeat owned PostgreSQL/app/launcher identity gates; stop if unavailable or mismatched. Do not restart/reseed automatically.
- [ ] Create one uniquely titled fresh PD1 H1 request and approve its normal REQUEST route once per actor. Never mutate the historical faulty request.
- [ ] Submit custom SOLUTION once: Engineer 2 → Engineering Department Manager; verify reordering and saved ordered cards. Verify current/future/excluded controls, approve each once, and fresh requester handback.
- [ ] Prove Final editor toggle and reorder nonmutating; initiate custom FINAL once: H2 Supervisor → Factory Manager. Verify saved true FINAL classification, separate FINAL stage, 5 approved / 2 pending, current H2 approval control and future/excluded controls.
- [ ] Approve H2 once, verify Factory becomes current and H2 no longer current, approve Factory once, then verify Completed / 7 approved / 0 pending and both custom phases in readable screenshots.
- [ ] Verify h1-staff2 visibility and both PD2 staff loaded-list absence; do not claim direct-link denial.
- [ ] Flush attempting ledger before each business submit/confirm, then fresh persisted confirmation. On any failure preserve results and stop all further mutations; no automatic retries or duplicate clicks.
- [ ] Deliver a concise report linking fresh evidence, full checks and preserved failures; explicitly state old faulty request remains unremediated. Parent inspects patch and actual screenshots before acceptance.
