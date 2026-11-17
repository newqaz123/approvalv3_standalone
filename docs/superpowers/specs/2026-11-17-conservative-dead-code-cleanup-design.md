# Conservative dead-code cleanup

Date: 2026-11-17
Status: Approved by the owner (Conservative; approve and proceed)
Baseline: `293a5ec`

## Intent

Remove stale code identified in `scratch/stale-code-review/REPORT.md` without changing the running app's permissions, workflows, visible UI, URLs, or stored data. The owner selected **Conservative** rather than Minimal or Broader cleanup.

## Approaches

1. **Conservative — selected:** remove verified unreachable implementation trees, unreferenced declarations, abandoned scripts, unused packages, and redundant role/department plumbing. Adjust tests that only assert on retired implementations. Preserve all route entry points, database structures, and user-facing behavior.
2. **Minimal — not selected:** only imports, packages, and scripts. Lower review effort but leaves the duplicate modal and dashboard implementations that are still receiving maintenance.
3. **Broader — deferred:** retire URLs and prototypes, replace role/level UI, and simplify schema. These affect users, external callers, or persisted data and are outside this cleanup.

## Safety constraints

- No schema changes, migrations, seeds, data mutations, deployments, or production database commands.
- Keep all `src/app/**/page.tsx` and `route.ts` entry points, including `/api/user/role`, `/api/organization/unit-users`, `/api/cron/archive`, `/admin/deleted-requests`, both approval/workflow stub pages, and the sequential preview.
- Keep current authentication, admin guards, organization/position logic, visibility, budget, notifications, attachment staging, retention, and approval semantics.
- Keep profile role labels, picker search semantics, rejection display, compatibility statuses, and other visible behavior unchanged.
- Do not delete a function just because its name appears nowhere in imports. Check direct calls, dynamic imports, namespace uses, framework entry points, test harnesses, action manifests, and string-based test loading.
- Preserve the pre-existing untracked `docs/superpowers/plans/2026-09-03-xhr-solution-staged-attachments.md` and any unrelated changes appearing during the task.
- Do not commit, merge, or deploy as part of this task. Leave an inspectable diff.

## Cleanup batches

### A. Confirmed orphan implementation trees

Re-verify and remove the 24 orphan source files listed in audit section 2: the old dashboard components and interval hook; old request desktop examples, generic status/final modal implementations; obsolete approval/solution buttons and detail views; unused drawer, activity timeline, PDF button, stale banner, and alert wrapper.

Delete dependent declarations only after their last surviving caller is gone. In particular, keep `getFollowUpDashboard`, the active `RequestModalRouter` and its modal implementations, and all components used by the preview and harness pages.

### B. Unreferenced declarations

Remove confirmed unused declarations within live modules from audit section 3, including old role/session wrappers, the unused user-cache lookup, dead dashboard query actions, unused template/solution/approval readers, obsolete soft-delete entry action, and unused UI exports. Preserve any candidate that a fresh reference check shows is still used by a supported route or test harness.

Existing exported server actions are reviewed against the native business/admin test action manifests and string-loading harnesses before removal. Remove only actions with no supported application or harness caller.

### C. Redundant role/department plumbing

- Remove unused role context fields and corresponding construction only where the policy evaluator does not read them. Do not remove database role reads used for admin authorization elsewhere.
- Remove the request modal router's unnecessary department fetch/state and ignored role/department props after verifying all surviving callers. Keep the department endpoint itself because navigation consumes it.
- Remove other unused imports, types, props, and local bindings only when doing so cannot discard an initializer's side effects.
- Keep test-only policy utilities and the `server-actions/files.ts` legacy attachment cluster in this pass if removing them would require replacing meaningful authorization/attachment coverage. A production-unreachable test subject is not automatically disposable.
- Keep approver pickers used by the hierarchy-pickers test harness.

### D. Scripts and package metadata

- Remove abandoned Clerk/department/numeric-level scripts and broken one-off scripts only after checking package scripts, deployment tooling, CI, and operator documentation. Retain migrations/upgrade verification, upload migration, readiness verification, and all deployment/backup scripts.
- Remove unused `@auth/prisma-adapter`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, and redundant `@types/bcryptjs` if fresh checks confirm the audit.
- Remove the three `test:phase7*` commands targeting the missing folder.
- Declare the already-installed `@tiptap/core` version directly if lockfile inspection confirms its current imports rely on a transitive dependency; do not upgrade unrelated dependencies.
- Regenerate only the relevant lockfile entries, avoid broad dependency updates, and inspect the resulting diff.
- Correct current operator documentation that would otherwise instruct users to run a removed script. Preserve historical design/plan documents as history.

## Test policy

Add focused cleanup regression tests before implementation. They must initially fail for the intended reason and then pass after the relevant deletion/refactor. Cover:

- retired implementation paths cannot return and no active module imports them;
- protected route entry points remain present;
- permissions and modal routing remain capability-based after removing unused context;
- package scripts no longer reference missing phase-7 suites.

When a source-text regression enumerates deleted UI files, remove only those retired cases and retain assertions for every surviving implementation. Where a security assertion only targets a retired reader, preserve or strengthen equivalent assertions on the active request/detail path rather than dropping a whole security suite to make tests green.

No mass deletion of tests, snapshot blind updates, weakening of allow/deny checks, or skip flags to hide failures.

## Verification and stop conditions

1. Record `npm run check` baseline before implementation. Any pre-existing failure is a blocker to understand, not permission to remove unrelated tests.
2. For each batch, run the focused regressions and type checking; run `npm run check` after code changes.
3. Re-run unused/reference analysis on the final tree and inspect the complete diff for route, schema, auth, or unrelated changes.
4. Run `graphify update .` (AST-only) after source changes.
5. Run an isolated production compilation/build only if it can avoid production data and the existing development server's output directory. No local production migration.

If a candidate is not provably unused, preserve it and list it as deferred. Stop and ask before changing user-visible behavior, removing a route, or touching database structures.

## Delivery

A concise summary of removed files/functions/packages, exact verification results, preserved/deferred candidates, and links to the implementation plan and cleanup report. Changes remain uncommitted and reviewable.
