# Export Builder And Budget Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the completed approval export builder until the user clicks export, and sync the Budget Monitor project estimate to the approved engineering solution budget.

**Architecture:** Keep the export builder component unchanged as the detailed builder, but gate its rendering behind local modal state in completed export surfaces. Update solution approval transitions so final solution approval and auto-approval copy `solutions.costEstimate` into `requests.projectEstimateCost`.

**Tech Stack:** Next.js App Router, React client components, Prisma server actions, Node regression tests.

---

### Task 1: Export Builder Reveal

**Files:**
- Modify: `tests/regression/export-builder-wiring.test.ts`
- Modify: `src/components/requests/completed-final-modal.tsx`
- Modify: `src/components/requests/request-detail-modal.tsx`

- [ ] Add a failing regression assertion that completed export surfaces have an export button state gate and do not render the builder unconditionally.
- [ ] Run `npx tsx --test tests/regression/export-builder-wiring.test.ts` and confirm the new assertion fails.
- [ ] Add local `showExportBuilder` state in completed export surfaces.
- [ ] Render an `Export Report` button when hidden, and render `CompletedApprovalExportBuilder` after click.
- [ ] Reset `showExportBuilder` to `false` when the modal closes.
- [ ] Re-run `npx tsx --test tests/regression/export-builder-wiring.test.ts`.

### Task 2: Approved Budget Sync

**Files:**
- Modify: `tests/regression/budget-control.test.ts`
- Modify: `src/server-actions/solutions.ts`

- [ ] Add a failing regression assertion that solution approval transitions update `projectEstimateCost` from `costEstimate`.
- [ ] Run `npx tsx --test tests/regression/budget-control.test.ts` and confirm the new assertion fails.
- [ ] In `approveSolution`, when the last pending approval is cleared, update the request with both `status: SendBackToRequester` and `projectEstimateCost: solution.costEstimate`.
- [ ] In auto-approved submit/resubmit solution paths, update the request with both `status: SendBackToRequester` and `projectEstimateCost` from the submitted solution estimate.
- [ ] Re-run `npx tsx --test tests/regression/budget-control.test.ts`.

### Task 3: Verification

**Files:**
- Verify: `tests/regression/export-builder-wiring.test.ts`
- Verify: `tests/regression/budget-control.test.ts`

- [ ] Run both focused regression tests.
- [ ] Run a broader available check if practical, preferring `npx tsx --test tests/regression/*.test.ts`.
- [ ] Inspect `git diff --check`.
