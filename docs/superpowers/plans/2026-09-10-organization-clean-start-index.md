# Organization Clean Start — Plans Index, Dependencies, Verification, and Decisions

Date: 2026-09-10 (reconciled after owner resolved G1 option A and O2; spec updated accordingly). Base commit inspected: `7abcdf3` (branch `feat/organization-approval-redesign`, kept untouched for manual testing). Source spec: `docs/superpowers/specs/organization-clean-start-design.md` — owner-approved design AND owner-resolved G1/O2; still NOT authorization to touch any existing database.

## Documents

| # | Document | Tasks | Scope |
|---|---|---|---|
| A | `docs/superpowers/plans/2026-09-10-organization-clean-start-schema-foundation.md` | 8 (A1–A8) | Isolation + fresh-DB green baseline; pure organization domain (model, rooted tree, assignments/teams, rank guard, sharing, eligibility, option-A reporting path, readiness); real build + smoke. ALL NEW FILES — no existing file modified |
| B | `docs/superpowers/plans/2026-09-10-organization-clean-start-approval-access.md` | 15 (B1–B15) | Additive schema evolution; routes; option-A candidates; immutable builder/persistence; first-decision-wins decisions; attempts + submission gate + workflow rewiring; stranded restart; sharing visibility (module + caller rewiring); action policy; participants-only notifications; consumer sweep; disposable-CI constraints; browser flow; schema finalization (drop legacy, tighten, squash) |
| C | `docs/superpowers/plans/2026-09-10-organization-clean-start-tree-ui.md` | 10 (C1–C10) | Workspace page/loader + legacy admin-surface removal; tree; inline rename; hover/focus + touch controls; unit/person/team panels; position administration; approval-chains panel with option-A submitter test; browser verification + final sweep |

Total: 33 tasks, each with executable TDD steps (RED run with expected failure, GREEN run), a commit, and an independent review gate (33 gates).

## Execution isolation (binding for every task)

1. New worktree: `git worktree add ../approval-app-clean-start -b feat/organization-clean-start 7abcdf3`. The current worktree/branch (`feat/organization-approval-redesign` at `7abcdf3`) stays untouched; the spec is committed only inside the new branch (A1 Step 1).
2. Fresh databases only: dev `app_cleanstart_dev`; disposable CI `app_cleanstart_ci` via `CLEAN_START_CI_DATABASE_URL` (self-skipping suite with an equality guard against `DATABASE_URL`). NEVER reset, migrate, push, or seed `app_db` or `app_org_manual_7abcdf3`. No production migrations locally, ever — SQL constraints/races verified only in disposable CI (B13, re-validated after the B15 squash).
3. **Ports (corrected 2026-09-10):** port **3000 runs an unrelated application**; port **3001 is the original dev server**; port **3002 is the manual-test branch's server**. None may be stopped, restarted, or reused (`portly kill-port` forbidden on them). The clean-start worktree dev server uses **3100** exclusively (`npm run dev -- -p 3100`; `NEXTAUTH_URL="http://localhost:3100"`; Playwright `TEST_BASE_URL=http://localhost:3100`).
4. Every command runs through Portly: `portly status`, `job_id="$(portly temp '<command>' --path "$EXECUTION_WORKTREE" --timeout <bound>)"`, `portly wait "$job_id"`. `graphify update . --force` after structural changes.
5. **No concurrent writers in the same cwd.** The default execution is strictly serial, one writer, one worktree. If parallel tracks are ever desired, each track needs its OWN worktree and branch (no shared checkout), and because B and C both rewrite `src/server-actions/*` files, the only safe split is: Track 1 = A→B (worktree 1), Track 2 = C branched AFTER B2's gate in a separate worktree, merged back after B15 — with the caveat that C1 deletes files B does not touch while B9/B10/B12 touch request components C does not. **Recommendation: do not parallelize; the merge risk outweighs the gain.**

## Dependency honesty (corrected 2026-09-10)

- Within each plan, tasks are STRICTLY sequential: A1→A8, B1→B15, C1→C10. Later tasks compile against earlier interfaces (e.g. B4's builder consumes B2's route types and B3's candidates; B5's decisions consume B4's plan rows; B6 rewires server actions onto B4/B5; B7 uses B4/B5 builders; B9 rewires callers onto B8's predicate; B10–B12 build on B8/B9; B15 removes what B6–B12 orphaned).
- **Plan B requires ALL of Plan A** (B1's schema matches A's model names; B2–B6 consume A2–A6 interfaces; readiness at A7).
- **Plan C requires at minimum B2** (C1's route-source walk uses B2's selection semantics); **C8 requires A4**; **C9 requires B2+B7** and performs legacy-lib deletions B15 may have deferred (they are compiled-against by `src/server-actions/approval-routes.ts` until C9 rewrites it); **C10 requires everything**. There is no stage at which C tasks run before B2.
- The earlier claim that "B7–B13 are executable independently of B3–B6" was WRONG and is withdrawn: B7 (restart) builds attempts via B4/B5; B8+ depend transitively. With G1 resolved there is no gating fork at all — just the strict sequence above.
- Cross-plan interface contracts are pinned in each plan's handoff section; a task may not redefine them.

## Verification matrix (spec "Verification scope" → tasks)

| Spec verification bullet | Covered by |
|---|---|
| Arbitrary-depth trees, parent/cycle validation, one root and one active assignment | A2, A3; B1 (partial indexes), B13 (CI one-active-assignment/one-root races) |
| Team reporting-rank validation, multiple teams under one manager, exact positions, no sibling-team candidates | A3, A6, B3, C7 (shared-manager fixture), B14 spec 1 |
| Company default and ancestor-exception precedence per phase | B2 (invalid-nearer-fails + draft fall-through), C1 (routeSources), C9 (customize/view) |
| Shared candidate first-decision approval/rejection races | B5 (re-based fake races), B13 (true PostgreSQL concurrency in CI), B14 spec 1 (browser double-decision) |
| Position ceiling, vacant skipping and all-vacant completion | B4 (builder tests 1–4), C9 (submitter test surfaces auto-approval/no-eligible) |
| Configurable position names/ranks with blocking rank changes listing affected records | A4 (`assessPositionRankChange`), C8 (position admin UI surfacing the lists) |
| Immutable attempts across rename, moves, rank changes and deactivation; explicit restart | A4/C8 (no attempt writes), C6 action tests, B4 (snapshot copies), B7 (restart preserves old attempt/decisions) |
| Downward-inclusive sharing scopes incl. parent staff across child scopes, sibling isolation, parent-manager visibility without action widening | A5, B8, B9 (caller rewiring), B14 spec 2 (browser) |
| Participants-only notifications; no broadcasts; viewers never subscribed | B11 (explicit participant membership + viewer-receives-nothing negative test), B14 spec 2 |
| Inline rename, assignment moves/removal, duplicate team errors, stale forms and save feedback | C3, C6, C7, C2–C10 browser spec |
| Actual Next compilation plus browser interaction, not only source-contract tests | A1/A8, B14, C10 (`npm run build` + Playwright on 3100); B12's grep is explicitly a supplementary tripwire |

## Build-gate realism audit (corrected 2026-09-10)

The earlier plans rewrote the schema in A1 while deferring consumer rewrites to a late B task — every intermediate commit would have failed `tsc`/`next build`, and A9's "delete contradictory tests" step could have papered over that. Corrected structure:

- **Plan A is purely additive** (new files only; the fresh DB starts on the CURRENT schema). Gate A8 proves zero modifications to existing files.
- **B1 evolves the schema additively** (new nullable columns/tables; legacy untouched) so every B commit compiles with the full existing suite green.
- **Consumers are rewritten in B6, B9, B10, B11, B12** file-by-file; each of those tasks deletes or re-bases exactly the tests asserting the behavior it replaces, naming each deletion and its replacement (B5: transaction/concurrency; B6: rollout; B9: visibility/private-file; B10: action suites; B11: notification-compatibility; B12: approver-department-labels + baseline; C1: department/hierarchy admin suites).
- **B15 drops legacy models/columns/enums, tightens staged columns to NOT NULL, and squashes migrations** only after every consumer is rewritten; the removal DMMF assertions live there, not in A1/B1.
- Documented transitional states (not hidden): between B1 and B6 the legacy `createRequest` cannot submit on the fresh DB (seeded admin has no department); between B1 and B9 legacy visibility still answers list queries. Both protected databases are irrelevant to these states.
- Schema-snapshot constraint fixes from the audit: `one_active_company_root` uses a constant-expression unique index `ON organization_units ((1)) WHERE parentId IS NULL AND isActive` (the earlier `(id)` form enforced nothing); restart provenance gets a self-relation on `approval_instances`; all new position references use `Restrict` (deactivation is the removal path); `one_published_route_per_scope_phase` is asserted present rather than re-created; `capturedDisplayName` stays required.

## Legacy consumer inventory (inspected at 7abcdf3; where each is handled)

| Consumer | Evidence at 7abcdf3 | Handled in |
|---|---|---|
| `src/server-actions/requests.ts` | department gate 113–119/183/253, filters 392–393, includes 459–481/649/781, approver lookups 572–576/868–875, rollout import | B6 (gate + origin unit + rollout removal), B12 (filters) |
| `src/server-actions/solutions.ts` | 58 departmentId refs; submit/resubmit/final 286/1560/2419; rollout import | B6, B12 |
| `src/server-actions/files.ts` | inline visibility actors 99/214 | B10 |
| `src/lib/notification-recipients.ts` | `findLegacyApproverIds`, `findReviewedSectionRecipientIds` | B11 |
| `src/lib/request-visibility/*`, `src/lib/request-access.ts` | role/departmentType blanket access; 14 callers grep-verified | B8 (module), B9 (caller rewiring + deletion) |
| `src/server-actions/analytics.ts` | departmentId filters 49/67/82 | B12 |
| `src/lib/export.ts`, `request-export.ts`, `pdf.ts` | departmentName labels (export.ts 17/47–48/88/160–161; pdf.ts 3) | B12 (`unitPathNames`) |
| `src/server-actions/dashboard.ts` | legacy pending lookups 26/65–83/246–251/407–412 | B12 |
| `src/lib/budget-control.ts` + `src/server-actions/budget-control.ts` | 19 refs; `budget_codes.departmentId` | B1 (`unitId` column), B12 |
| `src/server-actions/auth.ts`, `src/lib/auth-config.ts` | session `departmentId` 21–41/73–94/112–132 | B12 (role-only session) |
| `src/server-actions/users.ts` | 16 refs | B12 |
| `src/server-actions/{audit,reports,engineering-sub-tasks}.ts`, `src/lib/{follow-up-dashboard,workflow-pipeline,modal-data-adapters,approver-search}.ts` | department/level fields | B12 |
| `src/app/(dashboard)/approval-chain/page.tsx` | department hierarchy copy 13/25/30 | B12 |
| `src/components/requests/*` (request-detail-modal `/api/departments/…` fetch 275–277, request-filters 22/137, final-approval-resubmit-modal 87/341/422, submitter/solution/final modals, lists, badge, router) | department labels and department-users API | B12 (+ new `src/app/api/organization/unit-users/route.ts`) |
| `src/server-actions/{departments,department-assignments,hierarchy}.ts`, admin pages/components, `src/app/api/departments/` | legacy admin surfaces | C1 |
| `src/lib/organization/mapping.ts`, `scripts/organization-import-dry-run.ts`, `scripts/apply-reviewed-organization-mapping.ts`, `tools/organization-mapping-schema.ts` | mapping digest machinery (last importer: `src/server-actions/organization.ts`) | C1 |
| `src/lib/approval-levels.ts`, `src/lib/approval-rollout.ts`, legacy approval-engine files, `src/lib/request-approval-transaction.ts`, legacy organization/{types,tree,repository}.ts, legacy approval-routes lib | level/rollout/legacy-engine machinery | B5–B6 (mechanics re-based, modules grep-gated), B15 + C9 (rest, first-task-without-importers rule) |
| `prisma/seed.ts` | 14 departments + level names | B14 (clean fixtures added), B15 (legacy seeding stripped) |

## Test classification map (distributed; no test deleted without a same-task replacement)

- **Deleted with C1** (legacy admin behavior intentionally removed): `department-levels`, `hierarchy-level-range`, `organization-import-dry-run`, `organization-mapping-apply`, `organization-admin-ui`, `tests/integration/organization-mapping-apply.integration.test.ts`.
- **Deleted/re-based in B**: `request-approval-transaction` + `approval-concurrency` + `organization-approval-baseline` (transaction cases) → `clean-start-engine-decisions` (B5); `organization-rollout` (B6, replaced by A7 readiness validation); `request-visibility` + `private-file-access` → `clean-start-visibility-callers` (B9); `organization-approval-{authorization,request-actions,solution-actions,final-actions}` + `approval-action-pending-state` + baseline permission cases → `clean-start-policy` (B10); `notification-compatibility` → `clean-start-participants` (B11); `approver-department-labels` → `clean-start-consumers` (B12).
- **Retained untouched**: formatted-text/inline-image/attachment/upload/email/retention/storage/sub-task/budget-mechanics/modal UX tests independent of departments/levels; `tests/tools/*`; `approval-engine-resolution`/`approval-route-resolution`/`approval-phase-adapters` remain green until the B15/C9 deletions of their subject modules, at which point any still-unre-based cases are deleted with the module and named in that task.

## Decisions (all formerly open items now resolved or recorded)

1. **G1 — RESOLVED by the owner, option A** (spec item 2): team members follow eligible exact-position members of their own team → the explicit reports-to person → the selected own-unit manager (included even when different from reports-to) → selected ancestor-unit managers; only configured positions; nobody twice; traversal inserts no steps. Implemented in A6/B3/B4/C9 with positive and negative tests; the former `TeamReportingPathUnresolvedError` scaffolding and artificial blocked-team tests are removed from all documents.
2. **O2 — RESOLVED by the owner** (spec line 62): status-change notifications to request participants only; no unit/sharing-scope broadcasts; approval-needed only to current eligible candidates; viewing never subscribes. Participant membership is explicitly defined in B11 from production evidence (requester, stored solution submitter, approval row actors, current-step candidate-group members, assigned engineers) — viewers are never equated with subscribers.
3. **N1 — consequence note (not a decision):** O2 removes the legacy engineering-department "New Task Available" broadcast; solution-eligible staff discover available work via request lists (visibility), not push notifications.
4. **O3 — modeling note (not open):** final-approval initiation keeps the previously approved typed-unit rule re-based (active assignment in the request's originating unit), carried from the approved 2026-09-05 redesign and flagged for explicit reviewer veto.

**Remaining blocking decisions: NONE.** The plan set is executable end-to-end in the strict order A1–A8 → B1–B15 → C1–C10 once the owner authorizes implementation.

## Spec coverage self-review (per writing-plans skill)

Direction/alternatives (whole set supersedes fixed levels; legacy dropped at B15); confirmed business rules (A2–A6, B2–B7, B8 sharing, B11 notifications, B6 origins, C8 position configuration, G1 option A and O2 as resolved); tree-first administration (C1–C10); approval defaults and exceptions (B1–B2, C9); solution-work eligibility (A5, B6, B10, C5); data and application changes (B1 additive, B15 final drop, A7 readiness replaces cutover/mapping, fresh DB); verification scope (matrix above). The spec's "Decisions still requiring clarification" items 1–5 are all marked Resolved in the updated spec and implemented as stated; no task invents authorization behavior.

## Honest readiness statement

These plans are detailed, interface-precise, test-first, and — after the 2026-09-10 reconciliation — free of blocking decisions and of build-sequence falsehoods: every task leaves `npm run check` and `npm run build` green, deletions are co-located with replacements, ports and isolation match reality (3000 unrelated app, 3001 original, 3002 manual-test, 3100 worktree), and dependencies are strictly sequential with C gated on B2. Residual risks: B5's port of transaction mechanics (gate B5 diffs it against the deleted originals), B12's grep-driven sweep (authoritative; must be extended, not skipped, if new files surface), the B15 migration squash requires a B13 CI re-run, and Playwright specs depend on the B14 seed fixtures. Execution is NOT authorized by these documents; the owner must authorize it, after which subagent-driven or inline execution per the writing-plans handoff applies.
