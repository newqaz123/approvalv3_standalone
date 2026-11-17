# Conservative cleanup results

Date: 2026-11-17 · Baseline: `293a5ec` · Initial delivery status: delivered, uncommitted

This report records the original pre-commit cleanup delivery. Subsequent headed T04B validation and controlled error diagnosis are documented in the [business-flow diagnosis](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/docs/superpowers/reports/2026-11-17-business-flow-errors-diagnosis.md).

## Removed

- **24 orphan source files**: old dashboard, status/final modals, desktop prototypes, obsolete approval/solution/detail buttons, drawer, interval hook and unused alert wrapper.
- **49 unused declarations** inside surviving modules, including 18 uncalled server actions. The active follow-up dashboard and canonical request/solution/approval paths remain.
- **32 abandoned one-off scripts**, including obsolete Clerk/department/numeric-level scripts and scripts using removed Prisma model names. Upload migration, readiness verification, upgrade verification and all deployment/backup shell tooling remain.
- Four unused dependencies (`@auth/prisma-adapter`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`) and redundant `@types/bcryptjs`.
- Three `test:phase7*` commands pointing to a missing test directory.
- Unused `actor.role` construction in 16 server-action call sites, four unused user-role selects, the modal router's wasted department fetch/state, ignored props, and a final-initiation button branch that could not render.

Declared the already-installed/locked `@tiptap/core@3.30.1` directly. Seven lockfile entries were pruned; **no surviving dependency version changed**.

Source-only diff: 22 lines added / 8,355 removed (**8,333 net lines removed**). Retired scripts account for another 2,806 removed lines. Updated tests and documentation are additional to those figures.

## Safety and preserved behavior

- All **49 page/route entry files remain**; API response contracts and supported URLs were not retired.
- Every file under `prisma/` is byte-identical to baseline. No migrations, seeds, production database operations, deployments or commits were run.
- Permissions remain activity/visibility/evidence/current-step based. Admin and sub-task role guards remain intact.
- `getUser` was **kept**: native admin-security tests call it by string through the action manifest, despite the initial static audit showing no importer.
- Kept the four test-only source modules (`server-actions/files.ts`, `file-upload-zone.tsx`, `resubmit-request-dialog.tsx`, `request-participants.ts`) and harness-only pickers to avoid weakening meaningful coverage.
- Existing role/level labels, compatibility statuses, unlinked pages/APIs, archived/legacy-deleted-record behavior and database structures remain.
- Preserved the unrelated untracked draft `docs/superpowers/plans/2026-09-03-xhr-solution-staged-attachments.md`.
- Changes were implemented in `.worktrees/conservative-cleanup`, independently reviewed, then byte-verified into the original checkout. The isolation worktree and ignored execution evidence are retained as a rollback/reference copy; nothing was merged.

## Verification

| Check | Result |
|---|---|
| Baseline `npm run check` | PASS: 3,608 regression passes, 2 skips, zero failures; management tests 78/78 |
| Post-cleanup `npm run check` in worktree | PASS: 3,610 regression passes, 2 skips, zero failures; management tests 78/78 |
| Delivered-checkout `npm run check` | PASS: same results |
| Remaining TypeScript scripts, separate type-check | PASS (scripts are excluded from the normal project check) |
| Isolated `npm run build` | PASS, exit 0; compilation, lint/type validation, page generation and route manifest completed |
| Independent read-only code review | No Critical, Important or Minor findings |
| Fresh TypeScript reachability analysis | **Zero orphan source files**; intentional test/harness-only code retained |
| TypeScript LanguageService reference cross-check | 62 non-production symbols checked; one known interface/lucide `User` name-clash flag, not a real dependency |
| Route paths / Prisma hashes / delivered bytes | All preserved; delivered code matched the reviewed and built worktree |
| `git diff --check` | PASS |
| `graphify update .` | PASS, AST-only/no LLM: 8,026 nodes, 16,900 edges, 437 communities |

Tests were added before the relevant changes and observed failing for the intended retirement/metadata/plumbing assertions. Existing source-text tests were narrowed only for retired cases. Active authorization/detail/retention checks remain, with new runtime coverage for dashboard query scoping and the role-independent action matrix.

Evidence: `scratch/stale-code-review/` (gitignored) contains baseline/delivered test logs, isolated build output, reference analysis, the independent review and the delivery patch. The original audit remains in `scratch/stale-code-review/REPORT.md`.

## Rulings and verification limits

- **Isolation/setup:** used APFS-cloned dependencies instead of a shared `node_modules` or lifecycle scripts, protecting the original environment. Both checkouts passed; a later clean install is still the normal deployment requirement.
- **No commits:** retained the ledger and reviewed the full uncommitted patch because `BASE..HEAD` is intentionally empty. The original checkout has the deliverable; the retained worktree is not a separate unpublished implementation.
- **Dynamic caller:** preserved `getUser` rather than trusting import-only dead-code analysis; removing it would break supported admin-security callers.
- **Build database isolation:** used an intentionally unusable loopback database URL and separate uploads directory. Four database read attempts logged connection-refused diagnostics during prerender; the build still completed. This proves compilation, not database integration.
- **Integration execution:** browser/native business/admin suites, production data and external cron configuration were not exercised. Their routes/action compatibility were preserved; this cleanup is not a full integration certification.
- **Dependency warning:** npm emitted the existing optional `nodemailer`/`@auth/core` peer-range warning. Auth/mail versions were not changed; resolving the warning requires a separate dependency decision.
- **Build warnings:** Edge-runtime Prisma/bcrypt warnings, hook/image/accessibility lint warnings, old Browserslist data and the nested-worktree root warning remain. They were not hidden or fixed by unrelated behavior changes.
- **Graph limits:** the SQL parser dependency is absent, one local settings JSON produced no nodes, and semantic document/community labels were not refreshed. The code AST was refreshed without API/LLM calls; the large graph uses an aggregated HTML view.

## Deferred intentionally

Database cleanup, removal of `UserRole.engineering`, profile/picker role/position wording, hard-coded rejection-level display, retired URL/prototype decisions, the remaining test-only modules and a broader warning-remediation campaign. These require behavior/product/deployment decisions beyond the approved conservative cleanup.
