# Conservative Dead-Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Delete proven-dead implementations and redundant role plumbing without changing production behavior or stored data.

**Architecture:** Keep Next.js entry points, active policy helpers and the live modal/router tree as the compatibility boundary. Re-verify each deletion with TypeScript reference analysis, update only tests that pin retired implementations, and make changes in four independently verified batches.

**Tech Stack:** Next.js 15.5.23, TypeScript 5, React 19, Prisma 6, Node test runner via tsx.

**Spec:** `docs/superpowers/specs/2026-11-17-conservative-dead-code-cleanup-design.md` (approved).

## Global Constraints

- No schema changes, migrations, seeds, data mutations, deployments, or production database commands.
- Keep all `src/app/**/page.tsx` and `route.ts` entry points and all preview/harness routes.
- Preserve user-visible role/level wording, modal routing, permission decisions and existing endpoint contracts.
- Preserve active security and attachment regression coverage; test-only source is not automatically disposable.
- No dependency upgrades. Package metadata must match the installed/locked versions.
- Preserve the pre-existing untracked `docs/superpowers/plans/2026-09-03-xhr-solution-staged-attachments.md`.
- No commits, merges or deployment. Deliver uncommitted changes in the original checkout, isolated during implementation when practical.
- Run `npm run check` after code changes and `graphify update .` after final source changes.

## Review Focus

1. Dynamic/native action callers: a name referenced through action manifests or string-loading test harnesses must not be deleted; verify searches across all tests/tools before removing server actions (Task 2).
2. Source-text tests: removing dead cases must not drop assertions on a surviving request/modal or authorization gate (Tasks 1–2).
3. Unit eligibility vs role: removing `actor.role` must not remove the database/admin role reads needed by `existingManageSubTasksDecision`, visibility, or admin guards (Task 3).
4. Side effects: unused local initializers and hook invocations may execute work; remove unused imports, but do not erase effectful calls based only on unused-variable diagnostics (Tasks 2–3).
5. External URLs and persisted data: entry points and `prisma/**` must match baseline, even for unlinked routes; record a before/after route list and schema hashes (Task 4).

---

## Baseline

- HEAD `293a5ec`.
- `npm run check`: PASS (management suite plus 3,610 regression tests; 3,608 pass, 2 skips, zero failures).
- Full output: `scratch/stale-code-review/baseline-check.log` (ignored).
- TypeScript reference analysis re-run: 24 orphan source files; candidate symbol counts match the audit. `verify-ls` has one known lucide/interface `User` name-clash flag, not a real production dependency.
- Native lens/LSP tools were not exposed by tool discovery; use the installed TypeScript compiler and LanguageService reference checks as the code-intelligence fallback.

## File map

- New `tests/regression/conservative-cleanup.test.ts`: focused retirement/compatibility assertions for Tasks 1, 2 and 4.
- New `tests/regression/role-context-cleanup.test.ts`: policy matrix and router-fetch/prop assertions for Task 3.
- Modify the existing regression tests named in the audit only where they enumerate retired implementations; no wholesale test-suite deletion.
- Product files removed/modified are enumerated per task below. Preserve the four audit test-only files and the harness-only picker implementations.
- Update this plan with checked steps and record final verification/deferred candidates in a concise cleanup report.

### Task 1: Retire the unreachable component trees

**Files to delete (24):**

- `src/components/approvals/{approval-actions,approval-progress,solution-approval-actions}.tsx`
- `src/components/dashboard/{activity-timeline,dashboard-table,dashboard-tabs,table-filters,table-pagination}.tsx`
- `src/components/mobile/{mobile-approval-actions,request-drawer}.tsx`
- `src/components/reports/export-pdf-button.tsx`
- `src/components/requests/{delete-request-dialog,final-approval-modal,request-detail-desktop-example,request-detail-desktop-v2,request-detail-desktop,stale-data-banner,status-modal}.tsx`
- `src/components/solutions/{final-approval-actions,mark-complete-button,reject-solution-dialog,solution-detail}.tsx`
- `src/components/ui/alert.tsx`
- `src/hooks/use-interval.tsx`

**Tests to create/adjust:** `conservative-cleanup`, `approval-display-snapshots`, `clean-start-consumers`, `engineering-sub-tasks`, `export-builder-wiring`, `file-preview`, `formatted-description-rendering`, `mobile-safari-fixes`, `private-storage-wiring`, `request-modal-header`, `requests-desktop-ux` (all `tests/regression/*.test.ts`).

**Interfaces:** Consumes the existing live `RequestModalRouter`/`SubmitterModal` and `FollowUpDashboard`; produces the same live entry-point/import contracts with the obsolete trees absent.

- [x] **Step 1:** Add a retirement test listing all 24 exact paths; assert each is absent and no surviving source imports its module path. Assert the active router/modal, follow-up dashboard, unit-user/role APIs and both workflow pages remain present. Run `npx tsx --test tests/regression/conservative-cleanup.test.ts`; expected RED because the orphan paths exist.
- [x] **Step 2:** Check each candidate's importers with `scratch/stale-code-review/query.cjs files` / TypeScript references and text mentions. Delete only the listed, confirmed orphan files.
- [x] **Step 3:** Remove retired paths from existing parameterized source-contract tests. Replace tests whose sole target was an old drawer/filter/export/detail implementation with equivalent assertions on the surviving dialog/filter/export/router path where that behavior remains supported; remove only cases for retired-only behavior.
- [x] **Step 4:** Run the focused regression files above, then `npm run check`. Both must pass before proceeding; inspect the diff to confirm all remaining modal variants still participate in their original test loops.

### Task 2: Remove unused declarations without weakening authorization

**Files:** `src/lib/{auth,auth-config,permission-checks,modal-data-adapters,engineering-resolution-trend,retention-archive,workflow-pipeline}.ts`, `src/lib/cache/user-cache.ts`; `src/server-actions/{approvals,audit,dashboard,engineering-sub-tasks,requests,solutions,templates,users}.ts`; the partial UI/hook files in audit section 3.

**Tests:** Extend `conservative-cleanup`; adjust `code-review-hardening`, `clean-start-consumers`, `engineering-sub-tasks`, `retention-policy`, `solution-work-unit-eligibility` only for removed actions.

**Interfaces:** Keep `requireAdmin`, `getCurrentUser`, `getFollowUpDashboard`, `getRequest`, and every action referenced by the native/admin/business manifest consumers. Remove only the unused names listed in audit section 3 after Task 1.

- [x] **Step 1:** Add tests asserting retired auth helpers and old dashboard/action exports are absent while `requireAdmin`, `getCurrentUser`, `getFollowUpDashboard` and active submission/approval actions remain. Run the focused cleanup test; expected RED on old exports.
- [x] **Step 2:** Recheck all candidate action names against dynamic imports, `tests/support/**`, test VM/string loaders and action manifest registries. If any supported caller exists, keep that function and document the exception.
- [x] **Step 3:** Remove the verified declarations using TypeScript AST statement boundaries, not broad substring ranges. Do not remove `getFollowUpDashboard` from the otherwise-dead dashboard action module. Remove now-unused pure imports. Review each declaration group to preserve live siblings and initializer effects.
- [x] **Step 4:** Replace the H4 assertions about retired `getRequestApprovals` with assertions on active `getRequest(id)`: authentication and `canUserViewRequest(userId, id)` occur before `prisma.requests.findUnique`, and denial returns `null`. Keep every other hardening test.
- [x] **Step 5:** Retain retention/eligibility assertions for every active list/submit/assign/complete path, dropping only cases that target retired actions. Run the focused tests, `npx tsc --noEmit`, then `npm run check`.

### Task 3: Remove redundant role and department wiring

**Files:** `src/lib/action-permissions.ts`; surviving `evaluateRequestAction` call sites in `src/server-actions/{approvals,engineering-sub-tasks,files,request-action-capabilities,requests,solutions}.ts`; `src/components/requests/{request-modal-router,completed-request-modal,completed-solution-modal,solution-modal}.tsx`; existing context fixtures in regression tests.

**Interfaces:** `ActionPermissionContext.actor` no longer requires `role`; retain `id`, `isActive`, and `assignmentUnitId` in this conservative pass. `evaluateRequestAction(action, context): ActionDecision` behavior is unchanged. Role-based admin/visibility/sub-task policy inputs remain unchanged. The department endpoint and navigation callers remain unchanged.

- [x] **Step 1:** Create `role-context-cleanup.test.ts` with a runtime decision matrix: for every `REQUEST_ACTIONS` member, inactive => INACTIVE, hidden => NOT_VISIBLE, missing decision => WRONG_ROLE, denied evidence stays denied, allowed evidence stays allowed except current-step actions without `canApprove`. Compare contexts with/without irrelevant legacy role values. Add source/AST assertions that `ActionPermissionContext.actor` has no `role` and the modal router no longer fetches department data. Run; expected RED only on the structural assertions.
- [x] **Step 2:** Remove only `actor.role` from the context type and its construction at every call site/test fixture. Preserve `userRole` passed to `existingManageSubTasksDecision` and all DB-backed admin/visibility reads. Only drop a Prisma `role` select if its entire enclosing function has no other role consumer.
- [x] **Step 3:** Remove `userDepartmentType`/`userDepartmentId` state and the department lookup from the router, plus ignored props on completed modals. For the solution modal's department-name-only dead branch, first verify it has no surviving caller that supplies a matching department; otherwise preserve that compatibility prop/branch and record it as deferred. Do not enable a previously hidden button.
- [x] **Step 4:** Clean unused pure imports in the touched live files. Keep unused callback parameters or execute initializers if removing them could alter behavior; do not change compatibility statuses or visible wording.
- [x] **Step 5:** Run the new policy matrix, `action-permissions`, `clean-start-policy`, `solution-work-users`, `engineering-view-all-requests`, `code-review-hardening`, modal-routing regressions and then `npm run check`. Confirm navigation still fetches `/api/user/department`.

### Task 4: Retire abandoned tooling and verify the whole diff

**Files:** `package.json`, `package-lock.json`; obsolete `scripts/*.ts` enumerated in audit section 6; `docs/ADMIN-DELETE-FEATURE.md` if it points to a removed script; this plan and a new cleanup report.

**Interfaces:** Preserve `npm run check`, `test:manage`, `business:native`, `admin:native`, `migrate:uploads`, `seed:dev`, `upgrade:verify`, deployment/backup/restore shell entry points and `scripts/verify-clean-start-readiness.ts`.

- [x] **Step 1:** Extend `conservative-cleanup.test.ts` to assert the five unused packages and three `test:phase7*` script names are absent, `@tiptap/core` is a direct dependency matching the installed version, and operational scripts/routes remain. Run; expected RED on stale metadata.
- [x] **Step 2:** Delete only broken/abandoned one-off TypeScript scripts confirmed by package/CI/deployment/doc checks. Leave any uncertain utility and all shell/upgrade/upload/readiness scripts. Update current operator instructions pointing at a removed script, without rewriting historical plans.
- [x] **Step 3:** Remove `@auth/prisma-adapter`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@types/bcryptjs`, and `test:phase7*`. Add the current locked `@tiptap/core` version directly. Update the lockfile with lifecycle scripts disabled and without unrelated version upgrades; inspect package resolution changes.
- [x] **Step 4:** Run `npm run check` after metadata/source changes. Re-run TypeScript reference analysis on the final tree and record removed/deferred counts. Compare all route entry paths and Prisma file hashes to baseline. Run `git diff --check` and inspect the complete diff.
- [x] **Step 5:** Run an isolated Next build/compile with an unusable local database URL and no shared `.next` with the existing dev server. If a pre-existing tooling/database requirement prevents completion, report that accurately; do not run migrations or weaken tests to hide it.
- [x] **Step 6:** Transfer verified uncommitted changes from an isolated worktree to the original checkout if one was used, without overwriting unrelated/untracked user work. Run `npm run check` on the delivered tree.
- [x] **Step 7:** Run `graphify update .` in the delivered checkout. Write the concise result report with exact test/build output, removed counts, preserved compatibility endpoints, deferred test-only source, and no commit/deploy claim.

## Execution and checkpoints

Direct execution is the default unless the owner authorizes delegation. Pause rather than crossing a safety boundary. A failing batch remains in progress until understood and resolved; never mark it complete because a later batch is waiting.

Before execution, review this plan against the approved design. Then execute Tasks 1–4 in order; no automatic commits (the spec overrides the skill's usual commit steps).
