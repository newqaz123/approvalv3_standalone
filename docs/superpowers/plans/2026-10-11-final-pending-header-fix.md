# Final-Pending Header Badge Fix

**Approved scope:** Owner selected “Fix Final header (Recommended)”: correct the misleading REQUEST badge during Final approval and retest. Preserve authorization, business state and earlier evidence. No accessibility-toggle or historical-data repair in this task.

## Root cause evidence
- Graphify query identified shared request-modal header and modal callers.
- The live Factory Manager pre-approval screenshot in `test-results/manual-pd1-headed/20261011-004207-custom-final-flag-fix/retest-final-step-attempt2/screenshots/003-fm-approve-control-inviewport-before-click.png` shows REQUEST alongside the correct Final Approval Required panel and Stage 3.
- `RequestModalRouter` passes `data.status: requestData.status` to `ApproverModal` (raw persisted `FinalApproval`).
- `ApproverModal` declares snake-case UI statuses, then evaluates `statusConfig[data.status] || statusConfig.request`. Its map contains `final_approval`, not `FinalApproval`. Raw persisted status therefore falls back to Request.
- The standalone FinalApprovalModal has a correct Final Approval status map, but the observed live route renders ApproverModal. Do not fix the unused component.

## Intended behavior
For persisted FinalApproval, the live approver header must display existing amber “Final Approval” label, for both current actors and read-only viewers. Existing normalized final aliases, Request/Solution/rejected labels and Completed display must not regress. No database status changes, routing/eligibility changes, new fetches/effects or new visual design.

## Implementation sequence
1. Capture exact before-copies, dirty baseline, branch/HEAD and root-cause evidence into new `test-results/manual-pd1-headed/20261011-042857-final-header-fix/`.
2. Read relevant debugging/TDD/UI guidance. Add a failing regression at the real status-to-header seam; verify the failure is specifically raw FinalApproval falling back to Request. Prefer a tiny pure normalization/status lookup with behavior tests plus caller wiring coverage if direct rendering needs unavailable harness dependencies. Do not add dependencies.
3. Implement the smallest display-boundary normalization needed for FinalApproval. Keep backend/API status untouched; no changes to action decisions, current-instance/phase guards, approval ordering, stored flag fix or modal selection.
4. Repeat focused tests to GREEN; run `npm run check`, save exit/counts/logs; run `graphify update .`. Capture incremental source diff against before-copies.
5. Parent patch review before browser test. Source ownership limited to ApproverModal or its router caller, one small display-only helper if necessary, and regression files. Ask before changes elsewhere or broad normalization of unrelated phases.
6. Run READ-ONLY headed browser checks only after verifying owned runtime identity (PGDATA/postmaster/app3100 listener/worktree cwd/demo launcher ancestry), with 1500ms slowMo, 1440x1000 viewport, 6000ms checkpoint pauses.
7. Use existing old request `Custom Hierarchy PD1 H1 2026-10-10T00:04:59.959Z`: verify Final Approval row, corrected Final Approval header, unchanged 5 Approved / 2 Pending and no restored approval control from this label-only fix. Check requester and H2 Supervisor read-only views where accessible. Do not heal its false flags or mis-grouped historical cards.
8. Use existing completed request `Custom Flag Fix PD1 H1 2026-10-11T00:50:10.810Z`: verify Completed header remains Completed, 7 Approved / 0 Pending, correct Stage 3. No new request creation, submissions, approvals, rejection, cancellation or final initiation. Business mutation ledger must remain empty.
9. Preserve every failure and stop on errors; no automatic retry/restart. Short report with source delta, RED/GREEN/full-check logs, real in-viewport header screenshots and unchanged states. Parent visually reviews and opens final report. Return required machine-readable acceptance report in final assistant output as well as the durable Markdown artifact.

## Safety and acceptance boundaries
Existing dirty tree is expected. No resets, stashes, commits, migrations, seeds, SQL repairs, dependencies, env/config/routes/sharing edits, production/shared DB/SMTP or browser process sweeps. Reuse only verified owned runtime and close only this run's owned browsers. Do not turn historical failures into passes. Prior native worker gate rejected its missing structured acceptance report despite independently reviewed source/tests/browser evidence; this run must supply its required acceptance fence, not silently waive evidence gates. Header success is not historical request remediation or full release acceptance.
