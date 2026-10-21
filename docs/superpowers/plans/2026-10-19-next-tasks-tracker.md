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
- ✅ H9 (`e292ccd`) Engineering dashboard / mark-complete still role-based, not unit flag (+ `getRequestsNeedingEngineeringAction` takes client userId)
Low
- ✅ L10 (`f3be8a1`) Reject paths bypass engine (status write w/o expected-status check)
- ✅ L11 (`e000b81`) Deactivated units' requests vanish from sharing views
- ✅ L12 (`0a7eae6`; `handoff.md` on main still to remove at merge) Cleanup: dead `request-detail-modal.tsx`, signup email log in auth.ts, obsolete `handoff.md` on main
- ✅ (`5b7ffa4`; browser e2e run 2026-10-21 after `0349d5c`, both passed) business-e2e T08E/T10C (+ DB evidence checker) still expect parent Dept manager to start Final — convert to denial after H6
- ✅ (`de9adff`, 6/6 pass, now counted by verify-upgrade) Clean-start constraints integration suite was failing 6/6 (also on plain db push → pre-existing test issue: constraint names not in Prisma raw errors; scoped cleanup)
- ✅ Decision: no eligible higher-level approver → step skipped / phase auto-completes (owner, 2026-10-19); runbook says set managers/teams promptly
- ⏸ Merge to `main` / open PR (needs owner OK)

- ✅ Final check after all fixes: 3335 tests, 0 fail, 1 skipped; verify-upgrade ALL CHECKS PASSED
- ✅ Real UI smoke after fixes: RRM-001/004/007/011 all passed (RRM-004 first failed on a test timing race, fixed in `b412c0a`)
- ✅ (`e65ec17`) `npm run check` leaked 2 `approval-envcheck-*` dirs in $TMPDIR per run

## 6. Re-prove the rejection matrix headless on the final branch (2026-10-20/21)
- ✅ (`0df2ed0`) `RRM_HEADLESS=1` profile for unattended runs; (`b7ee811`) 30 s assertion timeout + app log tail kept in evidence
- ✅ Run 1 (`test-results/full-matrix-20261020/`): 41/44. RRM-012 and RRM-033 failed because the dev server went away mid-page; RRM-034 did not run (a profile stops at its first failure)
- ✅ (`c5e1202`) process sampler (`app-health.log`), exit time stamps, hydration-safe sign-in (see "Known issue" below)
- ✅ Run 2 (`test-results/full-matrix-20261020b/`): 43/44. RRM-012 failed again: `next dev` restarts its own server when the heap passes 80% of its limit. The 8 GB heap ceiling I tried did nothing (Next already uses half the RAM) and server source maps off did not change the growth (reverted in `4d9d9a7`)
- ✅ Root cause (live heap profile, `test-results/heap-experiment-20261021/`): the server's heap grows ~160 MB/min, all inside `next dev` itself (React dev runtime async stack tracking + Next `loadManifest`; no application frames). Production does not run that code, so it is not an app leak
- ✅ (`1574a99`) Fix: the matrix replaces the dev server between cases (after 4 cases or at 50% of the heap limit)
- ✅ Run 3 (`test-results/full-matrix-20261021/`): **44/44 passed**, 0 failed, no server restarts by Next; peak server RSS 3.3-3.9 GB (was 5.0-5.6 GB)
- ✅ Browser e2e T08E / T10C (selectable since `0349d5c`; `test-results/business-native-t08e-t10c-20261021/`): both 1/1 passed in Playwright, DB evidence 0 failing.
  - T08E: the parent Department manager is denied the Final trigger; no FINAL instance exists; status stays Sent Back to Requester
  - T10C: the parent Department manager is denied, then the requester starts Final; exactly one FINAL attempt on the original-requester branch; Completed
- ⏸ Known issue on `main`, not fixed here: the sign-in form (`src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`) has no `method`, so a click before React hydrates sends the email and password in the URL as a GET. One-line fix, own commit; needs owner OK

## Log
- 2026-10-19: Rejection UI test 44/44 passed — `test-results/rejection-ui-report-20261019/report.md`
- 2026-10-21: Rejection UI test 44/44 passed headless on the final branch (`1574a99`) — `test-results/full-matrix-20261021/`
