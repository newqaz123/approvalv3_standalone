# Next Tasks Tracker (started 2026-10-19)

Worktree: `.worktrees/organization-approval-redesign` · Branch: `pi-subagents/setup-preflight-7aabdf7-b8d5-s0-t0`

Legend: ⬜ todo · 🔄 in progress · ✅ done · ⏸ needs owner decision

## 1. Save work (commit)
- ✅ Baseline: tsc clean; 4080 tests, 4076 pass, 3 fail (known), 1 skipped — `test-results/next-tasks-20261019/baseline-check.log`
- ✅ Keep junk out of git (`scratch/`, `failures/`, `docs/superpowers/e2e-runs/` 16 GB, `sql-probe.cjs`)
- ✅ Commit: organization UI (`150423e`)
- ✅ Commit: approval engine / permissions / server actions (`b8dd40c`), admin layouts + middleware (`10b3e0f`)
- ✅ Commit: tests + test harness (`b5d6408`)
- ✅ Commit: docs (`e4cfac5`)

## 2. Fix FINAL rejection label
- ✅ Find where "SOLUTION REJECTED" is chosen for a FINAL rejection
- ✅ Regression test + fix, commit `1836a76` (`tests/regression/final-rejection-label.test.ts`; `solution-modal.tsx`, `request-modal-router.tsx`)
- ✅ Re-run RRM-043 + RRM-044 in real UI — both passed; badge shows FINAL APPROVAL REJECTED

## 3. Clean up test tooling
- ✅ Replace current rejection driver with working `-legacy` version (`08950dc`)
- ✅ Remove clock-calibration / assurance code (1.16 MB → 336 KB)
- ✅ Fix 3 known failing tests (gone with the assurance code) (2× RRM023 `getAttribute` fake locator, 1× stale `/tmp/.../owned-stop.json`)
- ✅ `npm run check` fully green: 3288 tests, 0 fail, 1 skipped
- ✅ Archived to `test-results/_archive/assurance-20261013/`
- ✅ Runner now deletes its throwaway runtime after a clean stop (disk filled up: 104 GB of leftovers removed)

## 4. Slow request modal
- ⬜ Production build, time request modal open

## 5. Finish branch
- ✅ Review branch vs spec → **NOT READY to merge to main** (all 33 plan tasks present; deploy/data blockers)

### Review fixes
Blockers
- ✅ B1 (`69051f8`, `dfde1b5`; verify A/B/C passed, re-run by parent) Migrations squashed into one `clean_start_init` (main's 18 dropped) → `migrate deploy` fails on existing prod DB; no data path from departments → org units. **Owner: write upgrade migration** → design `docs/superpowers/specs/2026-10-19-upgrade-migration-design.md` (Q1 Level N higher=senior; Q2 block while requests open)
- ✅ B2 (kept from main's migrations; verified trigger blocks UPDATE) Restore audit-trail append-only trigger (`prevent_audit_modification`) lost in squash + test
- ✅ B3 (`4b0ea18`; dev fixture → `prisma/seed-dev.ts`, `npm run seed:dev`) Split seed: production bootstrap (admin w/ forcePasswordChange, `update: {}`, company root, settings, stages) vs dev fixture behind URL guard
High / Medium
- ✅ H4 (`ff31640`) `getRequestApprovals` (approvals.ts:373) — add login + `canUserViewRequest`
- ✅ H5 (`3dcf617`; spec updated; schema default false — migration pending in B1) Sharing semantics differ from spec (ON = parent subtree incl. siblings; default ON) — **Owner: keep code, default new units to sharing OFF**; update spec + T09
- ✅ H6 (`4ea3de6`) Final initiation widened to any ancestor unit (permission-checks.ts:24-38) — **Owner: revert to origin unit only**
- ✅ H7 (`f13e386`) `initiateFinalApproval` ignores `user.isActive`
- ✅ H8 (`013eb67`, cores moved to `src/lib/organization/workspace-admin.ts`, `src/lib/approval-routes/chains-admin.ts`) Admin check skipped when 2nd arg passed (organization.ts, approval-routes.ts) — make `requireAdmin` unconditional
- 🔄 H9 Engineering dashboard / mark-complete still role-based, not unit flag (+ `getRequestsNeedingEngineeringAction` takes client userId)
Low
- 🔄 L10 Reject paths bypass engine (status write w/o expected-status check)
- 🔄 L11 Deactivated units' requests vanish from sharing views
- ✅ L12 (`0a7eae6`; `handoff.md` on main still to remove at merge) Cleanup: dead `request-detail-modal.tsx`, signup email log in auth.ts, obsolete `handoff.md` on main
- 🔄 business-e2e T08E/T10C (+ DB evidence checker) still expect parent Dept manager to start Final — convert to denial after H6
- 🔄 Clean-start constraints integration suite fails 6/6 (also on plain db push → pre-existing test issue: constraint names not in Prisma raw errors; scoped cleanup)
- ✅ Decision: no eligible higher-level approver → step skipped / phase auto-completes (owner, 2026-10-19); runbook says set managers/teams promptly
- ⏸ Merge to `main` / open PR (needs owner OK)

## Log
- 2026-10-19: Rejection UI test 44/44 passed — `test-results/rejection-ui-report-20261019/report.md`
