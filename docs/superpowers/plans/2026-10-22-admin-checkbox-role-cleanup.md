# Admin Checkbox and Role Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin/users` offers only an Administrator checkbox, and every engineering ability follows the unit setting "Can work on solutions".

**Architecture:** `users.role` stays in the database but code only asks "is admin?". Engineering checks that read `role === 'engineering'` switch to the existing solution-worker rule (`isActorSolutionWorker` / `canWorkOnSolutions`). Pure decision helpers take a boolean; server actions resolve that boolean from the database.

**Tech Stack:** Next.js 15 (server actions), Prisma 6, React Hook Form + zod, `node:test` via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-22-admin-checkbox-role-cleanup-design.md`

## Global Constraints

- No database migration. Do not edit `prisma/schema.prisma` or `prisma/migrations/`.
- New and demoted non-admin users are stored with `role: 'general_dept'`.
- Do not change approval chains or request visibility rules (`buildRequestVisibilityWhere` output must be unchanged).
- Checkbox copy, exact: label `Administrator`, help text `Can open the Admin area.`
- Guard error messages, exact:
  - `You cannot remove your own administrator access`
  - `At least one active administrator is required`
- After every task: `npm run check` must be green. Commit per task. After the last task run `graphify update .`.
- Work on a branch `feature/admin-checkbox-role-cleanup` (worktree per superpowers:using-git-worktrees). The uncommitted `package.json` / `package-lock.json` tiptap changes on `main` are not part of this work; leave them alone.

## Review Focus

1. A legacy user row that still has `role = 'engineering'` and no unit: must behave as a plain non-admin everywhere (no engineering access, no crash, shown with a blank Role cell). → test in Task 2 and Task 4.
2. A solution worker whose unit is deactivated, or whose account is inactive: loses assign-engineers and sub-task management. → test in Task 2.
3. Two admins demoting each other at the same moment: at least one active admin must remain. → Task 1 runs the count and the write in one transaction; test in Task 1.
4. Editing an admin's name or email without touching the checkbox: must not trip the last-admin guard. → test in Task 1.
5. A request that already has assigned engineers who are no longer solution workers: the request still opens and shows them; only new assignment is restricted. → test in Task 3.

---

### Task 1: User actions accept `isAdmin` and guard against lock-out

**Files:**
- Create: `src/lib/user-role.ts`
- Modify: `src/server-actions/users.ts` (types at top, `createUser`, `updateUser`, `deactivateUser`)
- Test: `tests/regression/user-admin-flag.test.ts` (new); update `tests/regression/admin-action-authorization.test.ts` where it passes `role` to `createUser`/`updateUser`

**Interfaces:**
- Produces (`src/lib/user-role.ts`):
  - `export type UserRole = 'admin' | 'general_dept' | 'engineering'` (the only definition in `src/`)
  - `export function roleForAdminFlag(isAdmin: boolean): 'admin' | 'general_dept'`
  - `export function isAdminRole(role: string | null | undefined): boolean`
  - `export function adminChangeBlockedReason(input: { actorId: string; targetId: string; targetIsActiveAdmin: boolean; nextIsActiveAdmin: boolean; otherActiveAdminCount: number }): string | null` — returns one of the two exact guard messages or `null`. Self-demotion message wins when both apply.
- Produces (`src/server-actions/users.ts`):
  - `CreateUserInput = { name: string; email: string; isAdmin: boolean; password?: string }`
  - `UpdateUserInput = { id: string; name: string; email: string; isAdmin?: boolean }` (`undefined` = leave role unchanged)
  - `UserWithDepartment` and `CurrentUserProfile` keep `role: UserRole`, imported from `@/lib/user-role`. `users.ts` no longer declares `UserRole` itself (a `'use server'` file may still `export type`; re-export it so existing imports compile).

- [ ] **Step 1: Write failing tests** in `tests/regression/user-admin-flag.test.ts`:
  - `roleForAdminFlag(true) === 'admin'`, `roleForAdminFlag(false) === 'general_dept'`
  - `isAdminRole('admin')` true; `'engineering'`, `'general_dept'`, `null` false
  - `adminChangeBlockedReason`: actor demotes self → `You cannot remove your own administrator access`; demote/deactivate another admin with `otherActiveAdminCount: 0` → `At least one active administrator is required`; with `otherActiveAdminCount: 1` → `null`; `targetIsActiveAdmin: true, nextIsActiveAdmin: true` (name-only edit, Review Focus 4) → `null`; target not an admin → `null`
  - Using the harness style of `admin-action-authorization.test.ts` (real `users.ts`, faked prisma): `updateUser({ isAdmin: false })` on the only active admin rejects and performs no `user.update`; `deactivateUser` on the only active admin rejects; `createUser({ isAdmin: true })` writes `role: 'admin'`; `createUser({ isAdmin: false })` writes `role: 'general_dept'`; `updateUser` without `isAdmin` leaves a legacy `engineering` row's role untouched
  - The count and the write happen inside one `prisma.$transaction` call (Review Focus 3): assert the fake's `$transaction` was invoked and `user.update` ran on the transaction client
- [ ] **Step 2:** Run `npx tsx --test tests/regression/user-admin-flag.test.ts` → FAIL (module not found)
- [ ] **Step 3:** Implement `src/lib/user-role.ts` and change `users.ts`. In `updateUser`/`deactivateUser`, count other active admins (`role: 'admin', isActive: true, id: { not: targetId }`) and write inside `prisma.$transaction(async (tx) => …)` with `isolationLevel: 'Serializable'`. Keep the existing audit row and `_warning` behaviour.
- [ ] **Step 4:** Run the new test and `tests/regression/admin-action-authorization.test.ts` → PASS
- [ ] **Step 5:** `npm run check`, then commit `feat(users): store admin as a yes/no flag and block admin lock-out`

### Task 2: Engineering decisions follow the solution-worker rule

**Files:**
- Modify: `src/lib/permission-checks.ts` (`canUserAssignEngineers`, header comment), `src/lib/engineering-sub-tasks.ts` (`canManageEngineeringSubTasks`), `src/lib/action-permissions.ts` (`existingAssignEngineersDecision`, `existingManageSubTasksDecision`), `src/lib/request-visibility/scope.ts` (`asActorRole`, actor `role` type only)
- Test: `tests/regression/action-permissions.test.ts`, `tests/regression/engineering-sub-tasks.test.ts`, `tests/regression/clean-start-policy.test.ts`

**Interfaces:**
- Produces:
  - `canUserAssignEngineers(input: { isActive: boolean; isSolutionWorker: boolean }): boolean`
  - `canManageEngineeringSubTasks(user?: { role?: string | null; isActive?: boolean | null; isSolutionWorker?: boolean } | null): boolean` — true for active admin or active solution worker
  - `existingAssignEngineersDecision(input: { isActive: boolean; isSolutionWorker: boolean; status: string }): ActionDecision`
  - `existingManageSubTasksDecision(input: { userRole: string | null | undefined; isActive?: boolean | null; isSolutionWorker: boolean; status: string }): ActionDecision`
  - Denial reason stays `WRONG_ROLE`.

- [ ] **Step 1: Update/add failing tests:**
  - `canUserAssignEngineers({ isActive: true, isSolutionWorker: true })` true; `isSolutionWorker: false` false; `isActive: false` false (Review Focus 2)
  - `canManageEngineeringSubTasks({ role: 'engineering' })` **false** (Review Focus 1); `{ role: 'general_dept', isSolutionWorker: true }` true; `{ role: 'admin' }` true; `{ role: 'admin', isActive: false }` false; `{ isSolutionWorker: true, isActive: false }` false
  - Decision helpers: solution worker + `SentToEngineer` → `ALLOWED`; non-worker → `WRONG_ROLE`; worker + other status → `WRONG_STATUS`
  - `buildRequestVisibilityWhere` for a legacy `role: 'engineering'` actor with `canWorkOnSolutions: false` equals the result for the same actor with `role: 'general_dept'`
- [ ] **Step 2:** Run the three test files → FAIL on the new assertions
- [ ] **Step 3:** Implement the signatures above. In `scope.ts`, narrow the actor role to `'admin' | 'general_dept'` and map everything non-admin to `general_dept`; do not change the generated `where`.
- [ ] **Step 4:** Run the three test files → PASS (`tsc` will still fail on callers until Task 3; that is expected inside this task only)
- [ ] **Step 5:** Do **not** commit yet — Task 3 fixes the callers; Tasks 2 and 3 share one commit.

### Task 3: Server actions and the request modal use the new decisions

**Files:**
- Modify: `src/server-actions/requests.ts` (`assignEngineers` ~L1947–2060, `getEngineeringUsers` ~L2066, `getRequestsForEngineering` ~L2103), `src/server-actions/request-action-capabilities.ts` (~L248–256), `src/server-actions/engineering-sub-tasks.ts` (`requireSubTaskManager`, ~L70, ~L322), `src/components/requests/request-modal-router.tsx` (~L317)
- Create: `src/lib/solution-work-users.ts`
- Test: `tests/regression/solution-work-users.test.ts` (new); update `tests/regression/engineering-sub-tasks.test.ts` wiring assertions, `tests/regression/clean-start-solution-eligibility.test.ts`, `tests/regression/solution-work-unit-eligibility.test.ts`

**Interfaces:**
- Consumes: Task 2 signatures; `isActorSolutionWorker(db, userId)` and `createSolutionWorkActorDb(prisma)` from `src/lib/solution-work-actor.ts`; `canWorkOnSolutions(units, unitId)` from `src/lib/solution-eligibility.ts`.
- Produces (`src/lib/solution-work-users.ts`):
  - `export async function listSolutionWorkUsers(client: PrismaClientLike): Promise<Array<{ id: string; name: string; email: string }>>` — active users with at least one active assignment whose unit passes `canWorkOnSolutions`; ordered by name; each user once.
  - `export async function filterSolutionWorkUserIds(client: PrismaClientLike, userIds: string[]): Promise<string[]>`

- [ ] **Step 1: Write failing tests** in `tests/regression/solution-work-users.test.ts` with a fake client:
  - user in a flagged unit → listed; user in a child of a flagged unit → listed; user in an unflagged unit → not listed; inactive user → not listed; flagged unit inactive → not listed (Review Focus 2); user with two qualifying assignments → listed once; legacy `role: 'engineering'` user with no assignment → not listed (Review Focus 1)
  - `filterSolutionWorkUserIds` returns only the qualifying ids, preserving none of the others
  - Source-wiring assertions (same style as existing `engineering-sub-tasks.test.ts`): `src/server-actions/requests.ts` no longer contains `role: 'engineering'` or `role !== 'engineering'`
- [ ] **Step 2:** Run → FAIL
- [ ] **Step 3:** Implement `solution-work-users.ts`, then change the callers:
  - `assignEngineers`, `getRequestsForEngineering`: guard with `isActorSolutionWorker`; keep the existing error texts.
  - `assignEngineers` validation of `engineerIds`: use `filterSolutionWorkUserIds`; keep the existing "invalid engineer" error. Do not touch already-stored assignments (Review Focus 5).
  - `getEngineeringUsers`: return `listSolutionWorkUsers(prisma)`.
  - Capability builders pass `isSolutionWorker` (resolve once per call) to both decision helpers.
  - `requireSubTaskManager` and the `~L322` early return: resolve `isSolutionWorker` and pass it.
  - `request-modal-router.tsx`: `canAct("MANAGE_SUB_TASKS")` alone decides; drop the client-side `canManageEngineeringSubTasks(user)` call and its import.
- [ ] **Step 4:** Add a test that a request whose stored engineers are no longer solution workers still returns them from the request loader used by the modal (Review Focus 5); run all touched test files → PASS
- [ ] **Step 5:** `npm run check`, then commit Tasks 2+3: `feat(engineering): take engineering abilities from the unit setting, not the user role`

### Task 4: Users page shows an Administrator checkbox

**Files:**
- Modify: `src/components/admin/user-form.tsx`, `src/components/admin/edit-user-dialog.tsx`, `src/components/admin/user-table.tsx` (~L90–103 and ~L210–225), `src/app/admin/users/page.tsx` if it maps `role`
- Test: `tests/regression/admin-users-admin-checkbox.test.ts` (new, source-wiring style)

**Interfaces:**
- Consumes: Task 1 `CreateUserInput`, `UpdateUserInput`, `isAdminRole`.
- Produces: `UserFormValues = { name: string; email: string; isAdmin: boolean; password?: string }`; `EditUserDialog` prop `user: { id: string; name: string; email: string; isAdmin: boolean }`.

- [ ] **Step 1: Write failing tests:**
  - `user-form.tsx` contains `Administrator` and `Can open the Admin area.`, and contains none of `General Department User`, `Engineering User`, `SelectItem`
  - `user-table.tsx` contains neither `General Dept` nor `Engineering`; it calls `isAdminRole`
  - `edit-user-dialog.tsx` does not contain `'general_dept'`
  - `grep`-style check: `'admin' | 'general_dept' | 'engineering'` appears in exactly one file under `src/` (`src/lib/user-role.ts`)
- [ ] **Step 2:** Run → FAIL
- [ ] **Step 3:** Implement. Use the existing `src/components/ui/checkbox.tsx` if present, otherwise a native `<input type="checkbox">` styled like other forms. Default unchecked on create. Table cell: `Admin` when `isAdminRole(role)`, otherwise empty (covers legacy `engineering` rows — Review Focus 1). Show the server's guard message in the form's existing error box.
- [ ] **Step 4:** Run → PASS
- [ ] **Step 5:** `npm run check`, then commit `feat(admin): replace the Role dropdown with an Administrator checkbox`

### Task 5: Landing pages and the duplicate admin layout

**Files:**
- Modify: `src/middleware.ts` (L70–78, `getRoleDashboard`), `src/app/admin/layout.tsx` (L26–33)
- Delete: `src/app/(admin)/layout.tsx`
- Test: `tests/regression/middleware-admin-redirect-origin.test.ts`, `tests/regression/authenticated-shell-navbar.test.ts`, `tests/regression/flowchart-visual-polish.test.ts`; check `src/lib/storage-alert.ts` for a `(admin)` path reference

- [ ] **Step 1: Update tests first:**
  - `getRoleDashboard`: `'admin'` → `/admin`; `'engineering'`, `'general_dept'`, any other string → `/requests/my-actions`
  - `/dashboard` with a non-admin → no redirect to `/engineering`
  - `src/app/admin/layout.tsx` redirects every non-admin to `/requests` and no longer contains `engineering`
  - `src/app/(admin)/layout.tsx` does not exist; remove it from any file list the three tests read
- [ ] **Step 2:** Run the three files → FAIL
- [ ] **Step 3:** Implement and delete the file. Update the comment in `engineering/page.tsx` that mentions `/dashboard` bouncing engineering-role users.
- [ ] **Step 4:** Run → PASS; `grep -rn "'engineering'" src --include=*.ts --include=*.tsx` shows only `src/lib/user-role.ts`
- [ ] **Step 5:** `npm run check`, then commit `refactor(auth): send non-admins to My Actions and drop the copied admin layout`

### Task 6: Fixtures, browser pass, duplicate report

**Files:**
- Modify: `tests/support/native/seed-business-fixture-plan.ts`, `tests/support/admin-security/admin-security-fixture.ts`, `tests/regression/native-seed-order.test.ts`, `tests/regression/clean-start-files-access.test.ts`, `tests/regression/clean-start-visibility-callers.test.ts`, `tests/regression/clean-start-visibility-scope.test.ts`, `tests/e2e/engineering-sub-tasks.spec.ts`, `prisma/seed-dev.ts` if it sets `role: 'engineering'`
- Create: `docs/superpowers/reports/2026-10-22-duplicate-code-report.md`

- [ ] **Step 1:** In each fixture, replace `role: 'engineering'` users with `role: 'general_dept'` users assigned to a unit with `canWorkOnSolutions: true`. Where a test's point is the legacy row, keep `'engineering'` and say so in the test name.
- [ ] **Step 2:** `npm run check` → all green, 0 fail.
- [ ] **Step 3: Browser pass** against the running dev server (agent-browser skill), signed in as the admin:
  - Create a user with Administrator unticked → table Role cell blank
  - Edit that user, tick Administrator → cell shows `Admin`
  - Edit own account, untick Administrator → `You cannot remove your own administrator access`
  - Sign in as a user in a "Can work on solutions" unit → Engineering menu visible; on a `SentToEngineer` request the assign-engineers control lists solution workers
  - Record what was seen (pass/fail per line) in the commit body
- [ ] **Step 4: Duplicate scan (report only, no code removal):** run `npx jscpd src --min-lines 12 --min-tokens 80 --reporters json --output scratch/jscpd` and write the report: total duplication %, then the clones grouped by area, largest first, each with both file paths and line ranges and a one-line suggestion. Flag the create/edit user dialogs if still near-identical.
- [ ] **Step 5:** `graphify update .`; commit `test: move engineering fixtures to solution-work units; docs: duplicate code report`
