# Next Tasks Tracker (started 2026-10-19)

Worktree: `.worktrees/organization-approval-redesign` · Branch: `pi-subagents/setup-preflight-7aabdf7-b8d5-s0-t0`

Legend: ⬜ todo · 🔄 in progress · ✅ done · ⏸ needs owner decision

## 1. Save work (commit)
- 🔄 Baseline: `tsc` + `npm run check` result recorded
- ⬜ Keep junk out of git (`scratch/`, `failures/`, `docs/superpowers/e2e-runs/` 16 GB, `sql-probe.cjs`)
- ⬜ Commit: organization UI
- ⬜ Commit: approval engine / permissions / server actions
- ⬜ Commit: tests + test harness
- ⬜ Commit: docs (plans/specs)

## 2. Fix FINAL rejection label
- ✅ Find where "SOLUTION REJECTED" is chosen for a FINAL rejection
- ✅ Regression test + fix (`tests/regression/final-rejection-label.test.ts`; `solution-modal.tsx`, `request-modal-router.tsx`)
- ⬜ Re-run RRM-043 + RRM-044 in real UI

## 3. Clean up test tooling
- ⬜ Replace current rejection driver with working `-legacy` version
- ⬜ Remove clock-calibration / assurance code from `tests/regression/rejection-recovery-matrix.test.ts`
- ⬜ Fix 3 known failing tests (2× RRM023 `getAttribute` fake locator, 1× stale `/tmp/.../owned-stop.json`)
- ⬜ `npm run check` fully green
- ⬜ Archive `test-results/.../assurance-20261013/`

## 4. Slow request modal
- ⬜ Production build, time request modal open

## 5. Finish branch
- ⬜ Review branch vs organization-approval-redesign spec
- ⏸ Merge to `main` / open PR (needs owner OK)

## Log
- 2026-10-19: Rejection UI test 44/44 passed — `test-results/rejection-ui-report-20261019/report.md`
