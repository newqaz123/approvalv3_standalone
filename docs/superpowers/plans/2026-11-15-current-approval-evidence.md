# Current Approval Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ordinary approval exports show current steps only and each approver's actual assigned unit.

**Architecture:** Filter approval rows in the report-data builder using existing current-instance semantics, while preserving full rows for administrative backups. Add an optional PDF history-display flag so ordinary exports omit attempt headings while backup reports retain them. Remove routing-scope department resolution entirely.

**Tech Stack:** TypeScript, Prisma, existing HTML/Puppeteer renderer, node:test/tsx.

**Spec:** docs/superpowers/specs/2026-11-15-current-approval-evidence-design.md

## Global Constraints
- Work natively in the authorized current checkout; preserve all unrelated edits.
- No migrations, organization-data edits, or unrelated dependency changes.
- Keep completed-only eligibility, permissions, and activity logs unchanged.
- Department is the actual approver's active assigned unit; use required person only when no actual approver exists. Missing assignment displays `—`.
- Administrative backups preserve history and attempt grouping.

## Review Focus
- Superseded approved rows must not leak into ordinary evidence (Task 1).
- A later attempt with fewer steps must not borrow old steps (Task 1).
- A present approver with no assignment must not inherit another person's unit (Task 1).
- Legacy instance-less rows follow existing current-instance semantics (Task 1).
- Backup history and ordinary export headings must remain distinct (Task 2).

### Task 1: Current-only report data and assigned departments

**Files:** `src/server-actions/reports.ts`, `tests/regression/export-builder-wiring.test.ts`.

**Interfaces:** Change private `buildApprovalPhases` to `(request: ExportableRequest, includeHistory = false): RequestPDFData['approvalPhases']`. The default filters each phase with `isCurrentInstanceApproval`; `options?.allowIncomplete === true` selects backup history.

- [ ] Extend the server-action harness tests to cover initial, solution, and final phases with old and current instances, repeated orders, and an old-only higher step. Assert ordinary single and packet exports include only current rows; backup includes all rows. Preserve legacy row inclusion.
- [ ] Replace scope-first department expectations with assigned-unit expectations: broad FACTORY scope plus Production 1 assignment must produce Production 1. Retain missing-actual-assignment and required-person fallback tests. Run targeted tests and confirm intended failures.
- [ ] Remove candidateGroup selection and batched scope-unit lookup from reports. Map department solely from `(approval.approver ?? approval.requiredApprover)?.organizationAssignments[0]?.unit.name`. Filter phase input rows without mutating the request. Keep approval eligibility checks intact.
- [ ] Update the earlier superseded-export regression to assert successful export without historical phase rows, rather than expecting history in ordinary PDF data.
- [ ] Run `npx tsx --test tests/regression/export-builder-wiring.test.ts`; require zero failures.

### Task 2: Separate evidence and backup presentation

**Files:** `src/lib/pdf.ts`, `src/server-actions/reports.ts`, `tests/regression/pdf-rendering.test.ts`.

**Interfaces:** Add optional `RequestPDFData.includeApprovalHistory?: boolean`. Only `true` enables attempt headings and grouping. The report builder sets it from the privileged backup option; ordinary reports use false.

- [ ] Add rendered-HTML tests: ordinary evidence preserves all seven column headings and current rows but contains no Attempt or Legacy history headings. Existing history-grouping fixtures explicitly set includeApprovalHistory true and retain their ordering/escaping assertions. Verify no change to Activity Log rendering.
- [ ] Run `npx tsx --test tests/regression/pdf-rendering.test.ts`; confirm new behavior fails before implementation.
- [ ] Render one order-sorted table per phase when history is false/absent; use the existing attempt-grouping path when true. Keep all cell escaping, missing-data placeholders, and decision dates.
- [ ] Run `npx tsx --test tests/regression/*pdf*.test.ts tests/regression/export-builder-wiring.test.ts`; require zero failures.

### Task 3: Verify and review

- [ ] Run `npm run check`; if the existing Tiptap blocker remains, report it and separately run `npm run test:manage` plus `npx tsx --test tests/regression/*.test.ts`.
- [ ] Request one read-only independent review under the previously chosen native workflow. Resolve significant findings with regression tests.
- [ ] Run `graphify update .` and `git diff --check`; preserve unrelated edits and leave changes uncommitted unless requested.
- [ ] Report implementation, test counts, and outstanding verification blockers without claiming unperformed visual verification.
