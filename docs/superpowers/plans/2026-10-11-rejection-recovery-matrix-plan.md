# Rejection and Recovery Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. One retained worker; no child delegation. Steps use checkbox syntax for tracking.

**Goal:** Execute owner-approved rejection at every supported approver step across four route profiles/default and custom chains, then verify permitted recovery to Completed.

**Architecture:** Build on the native owned-runtime/fixture safety harness and proven UI flows; implement a separate test-only matrix inventory/driver instead of weakening T14 skip gates or the native CLI's exactly-one focused-scenario contract. Sequential cases, one fresh request per rejection point, immutable failures and attempt-correlated persisted evidence.

**Tech Stack:** TypeScript, node:test/tsx, Playwright headed Chromium, native isolated PostgreSQL and loopback mail capture.

**Spec:** `docs/superpowers/specs/2026-10-11-rejection-recovery-matrix-design.md` (owner-approved full matrix scope plus explicitly labeled provisional inventory).

## Global Constraints
All spec constraints apply. Existing worktree/branch/HEAD and dirty baseline preserved; no commits/index changes. No application source fixes in this test task. All business actions through the UI, no duplicate confirmations or internally retrying approval helpers. Fresh owned profile fixtures only; do not mutate the existing corrected demo. Cases must finish Completed, not merely become live after resubmission. Headed 1500ms/1440x1000/6000ms checkpoints, retries0, stop globally on unexpected failures. Required final structured acceptance-report fence.

## Review Focus
- Requested UI combinations that have no exposed UI must be classified explicitly, not counted as passed or silently tested through API calls.
- FINAL rejection must go through Engineering redesign and solution reapproval before Final reinitiation; no direct restart shortcut.
- Old approved/rejected rows are historical; compare instance-correlated active counts rather than assuming global modal counts always7/0.
- Exception profiles can shorten routes; per-profile case inventory must derive actual fixture route order, not copied demo assumptions.
- A confirmation may persist before a subsequent selector fails; separate read-only action resolution must prevent duplicate retries.

### Task 1: Concrete inventory and runtime blueprint
**Read:** `tests/business-e2e/business-reject-resubmit.spec.ts`, `business-flow-helpers.ts`, `tests/support/business-workflow-fixture.ts`, native runtime lifecycle/environment/seed safety modules, existing manual scripts and rejection/resubmission server actions as needed.
**Write:** New evidence `test-results/rejection-recovery-20261011/` only initially: `inventory.json`, `coverage-and-runtime-plan.md`, `baseline-status.txt`, `baseline-diff.patch`.
**Interface:** Inventory rows `{id,profile,phase,chainKind,rejectOrder,orderedActorIds,expectedRejectState,reviser,recoveryRoute,disposition,reason}`; stable IDs must identify every concrete case uniquely. Runtime blueprint records fresh ownership gates, noncolliding app/database/mail ports, cache isolation, fixture actors and cleanup/evidence retention.

- [ ] Capture branch/HEAD/status/full dirty diff; inspect source/fixture with Graphify as primary navigation.
- [ ] List existing rejection coverage without resources; do not falsely imply T14 supports other profiles or terminal recovery.
- [ ] Derive exact primary cases/negative checks from four fixture route profiles; confirm custom picker candidates and REQUEST custom UI availability through source first. Enumerate provisional44 or justify changed count; classify unsupported scenarios separately.
- [ ] Verify native runtime bootstrap/seed and independent app cache/port ownership design; do not launch/migrate/seed anything yet.
- [ ] Send concrete inventory/runtime blueprint to parent through contact_supervisor. Wait for clearance before harness changes or runtime/business actions; escalate any material scope/UI applicability decision.

### Task 2: Test-only inventory/driver
**Proposed files:** `tests/support/rejection-recovery-matrix.ts` (pure typed inventory and ledger policy); `tests/regression/rejection-recovery-matrix.test.ts`; `tests/manual/rejection-recovery-matrix.ts` (owned-runtime UI driver). Existing native modules reused; no broad native CLI edits. Final exact paths/interfaces must be included in Task1's reviewed blueprint if these prove unsuitable.
**Interface:** Pure matrix enumeration returns inventory rows; driver consumes reviewed inventory + private owned runtime configuration and writes per-case attempting/confirmed/denied actions, results, screenshots/traces and safe DB-read correlations. No product functions imported for direct mutations.

- [ ] Add failing regressions for inventory count/order/profile phase routes, invalid/unsupported combinations, no duplicate IDs/actions, required reject reason, and failure/ambiguous ledger preventing retries. Observe expected RED; do not count missing-import failures as meaningful coverage.
- [ ] Implement minimal test-only pure helpers/driver. Use proven UI selectors, case-scoped dialogs/stages, empty-reason disabled confirmation checks, explicit displayed custom reordering, new-attempt recovery and no unauthorized-action controls.
- [ ] Save focused GREEN and required full `npm run check` logs/exit/counts. Run `graphify update .`; incremental diff against captured baseline.
- [ ] Contact parent for patch/runtime-action clearance. No UI business actions until reviewed.

### Task 3: Four-profile serial rejection/recovery execution
**Write:** Per-profile and per-case evidence subdirectories under new matrix evidence root; `matrix-progress.json` durable inventory dispositions; `rejection-recovery-report.md` short final summary.

- [ ] Allocate/start one new owned profile runtime at a time using reviewed native safety blueprint; verify identity before bootstrap and browser/DB operations; retain all evidence and stop only verified owned processes.
- [ ] Create one unique request for each reviewed primary rejection point. Drive preceding phases/steps once; verify current/future controls, empty-reason disabled confirmation, reject once with unique reason, then fresh persisted rejection/history and permitted/nonpermitted revision controls.
- [ ] Correct and resubmit through the permitted actor UI. Verify new phase attempt/order/current actor/reset state and preserved superseded history; reapprove actual required steps and remaining phases to Completed. FINAL recovery includes Engineering redesign, solution reapproval and new Final initiation.
- [ ] Check terminal controls/visibility and supported planned negative cases. Expected-denial cases must be explicitly inventoried beforehand; unexpected errors stop the entire matrix immediately.
- [ ] Correlate read-only DB rows/instances/audit/notification/mail evidence per case with actual recorded actors/actions; no production/shared SQL or mutation workarounds.
- [ ] After each case flush matrix progress; no routine owner pauses unless failure/ambiguity/scope issue. On any failure preserve original artifacts, stop subsequent mutations and ask parent; separate continuation only after clearance.
- [ ] End with concrete44-or-reviewed-count dispositions, true recovered Completed evidence, unsupported/skipped/gap disclosure, checked commands and short linked report. Return required machine-readable acceptance-report block in final assistant output.

### Task 4: Parent evidence review
- [ ] Parent inspects actual rejection/recovery/current-control/terminal screenshots, validates report links and exact action ledgers/counts, then opens absolute final report path.
- [ ] Record any native independent-review gate still pending separately; do not claim full release acceptance. Existing corrected demo remains untouched throughout.
