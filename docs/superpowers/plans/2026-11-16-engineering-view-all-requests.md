# Engineering View-All Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators grant selected Engineering organization branches read-only visibility of requests across departments and stages.

**Architecture:** Persist an inherited, default-off unit permission beside existing solution-work settings. Resolve it in the shared server-side visibility adapter, while keeping mutation visibility on the pre-existing rules. Reuse the organization settings UI and existing request/tracking views.

**Tech Stack:** Next.js 15, React 19, TypeScript, Prisma/PostgreSQL, shadcn switches, Node test runner through tsx.

**Spec:** `docs/superpowers/specs/2026-11-16-engineering-view-all-requests-design.md` (approved).

## Global Constraints

- Exact setting label: **Engineering can view all requests**.
- `engineeringCanViewAllRequests` defaults to `false`; no unit is automatically opted in.
- Active unit/ancestor grants are inherited; existing effective solution-work eligibility is also required.
- Preserve existing sharing, approval, workflow, archive, and deletion rules.
- New visibility never grants mutation rights. Existing independent action checks remain authoritative.
- Do not run production migrations locally or deploy changes.
- Preserve pre-existing changes to package files and the unrelated attachment plan.
- Run `npm run check` and `graphify update .` after code changes.

## Review Focus

1. Older narrow unit projections omit the new field: interpret omission as false, never broad access (Task 1/2).
2. A malformed ancestor chain or inactive granting unit must not confer access (Task 2).
3. Removing a local flag must not erase an ancestor grant; sibling branches must remain isolated (Task 2).
4. Newly visible returned/final-stage requests must not unlock attachment deletion or sub-task mutation (Task 2).
5. Saving an unrelated setting through an older caller must preserve a stored view-all grant, and switching selected units must reset local switch state (Task 1/3).

---

### Task 1: Persist and administer the per-unit permission

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/organization/model.ts`, `src/lib/organization/workspace-admin.ts`.
- Create: `prisma/migrations/20261116000000_engineering_view_all_requests/migration.sql`.
- Test: `tests/regression/clean-start-ui-unit-panel.test.ts`, existing workspace and admin-boundary regression tests.

**Interfaces:**
- `OrganizationUnitNode.engineeringCanViewAllRequests?: boolean`: optional for existing narrow projections; missing means false.
- `OrganizationUnitMutationDb.updateUnitSettings(id: string, shareRequests: boolean, canWorkOnSolutions: boolean, engineeringCanViewAllRequests: boolean): Promise<void>`.
- Core `updateUnitSettings` accepts optional `engineeringCanViewAllRequests?: boolean`; omission preserves the current stored value (or false), rather than revoking an existing grant. Explicit non-Boolean values are rejected.
- Workspace and mutation-store unit projections return the persisted flag. New-unit persistence writes false.

- [ ] Add failing fake-store tests asserting explicit enable/disable persists, omission preserves true, audit comments contain `engineeringCanViewAllRequests=true`, invalid runtime input is rejected before writing, and new-unit defaults remain false. Keep the existing client-callable admin-only wrapper boundary tests.
- [ ] Run `npx tsx --test tests/regression/clean-start-ui-unit-panel.test.ts` and confirm the new persistence tests fail for the missing behavior.
- [ ] Add the Boolean column with `NOT NULL DEFAULT false` in a new migration; do not apply it. Extend model/store shapes, row mapping, settings writes, validation, and audit comments. Reuse existing serializable writes, admin checks, and organization revalidation.
- [ ] Run `DATABASE_URL=postgresql://unused:unused@localhost:5432/unused npx prisma generate` (generation only; no database access), then the focused tests and `npx tsc --noEmit`. Resolve type errors without broad unrelated refactors.
- [ ] Commit only the task's implementation and tests after verification.

### Task 2: Grant read visibility without expanding mutation access

**Files:**
- Modify: `src/lib/request-visibility/scope.ts`.
- Modify: `src/server-actions/files.ts`, `src/server-actions/engineering-sub-tasks.ts`, `src/server-actions/requests.ts`, `src/server-actions/request-action-capabilities.ts`.
- Test: `tests/regression/clean-start-visibility-scope.test.ts`, `tests/regression/clean-start-visibility-callers.test.ts`.
- Create: `tests/regression/engineering-view-all-requests.test.ts` for the focused permission matrix if separating fixtures is clearer.

**Interfaces:**
- Extend `RequestVisibilityActor` with optional `engineeringCanViewAllRequests?: boolean`.
- Extend `buildRequestVisibilityWhere` options and `canViewRequestByPredicate` / `canUserViewRequest` optional options with `includeEngineeringViewAll?: boolean` (default true). False suppresses only the new grant, preserving every pre-existing visibility relationship.
- `createRequestVisibilityDb` selects the new column and computes the effective inherited grant using validated ancestry, active granting units, active assignments, and existing `canWorkOnSolutions` eligibility.
- Broad read predicate is exactly the existing base `{ isDeleted: false, ...(includeArchived ? {} : { isArchived: false }) }`, only for eligible active actors.

- [ ] Add failing predicate/adapter tests for direct and descendant grants, initial/returned/final/completed and engineering statuses, false/missing flag, sibling isolation, inactive users/assignments/granting ancestors, null assignment, corrupt ancestry, and missing solution-work eligibility. Assert deleted requests are denied, archived requests follow `includeArchived`, and ordinary access/administrator behavior is unchanged.
- [ ] Add read-versus-mutation tests for a foreign returned/final-stage request: `canViewRequestByPredicate(...)=true` but the same call with `{ includeEngineeringViewAll: false }` is false; existing owned/shared/approval-participant access remains true in both modes. Verify flag removal and ancestor grants with adapter reloads.
- [ ] Run the focused regression files and confirm new tests fail before implementation.
- [ ] Implement the adapter and predicate additions. Keep role names irrelevant and fail closed for invalid ancestry; preserve original engineering-stage access semantics separately from the new grant.
- [ ] Pass `{ includeEngineeringViewAll: false }` at existing write visibility checks (attachment upload/delete, engineer assignment, and shared engineering sub-task mutation guard). Read endpoints retain the default. Do not alter the existing independent action decisions.
- [ ] In `getRequestActionCapabilities`, derive both read and mutation visibility. Evaluate `EXPORT_PDF` against read visibility; evaluate every mutation against baseline visibility so newly visible requests do not show unauthorized controls. Verify solution mutation paths retain their existing independent guards.
- [ ] Extend caller wiring tests to pin these read/write boundaries. Run the focused visibility tests plus `tests/regression/action-permissions.test.ts` and engineering sub-task regressions; confirm all pass.
- [ ] Commit the verified policy, guards, and tests.

### Task 3: Expose the switch and verify the complete change

**Files:**
- Modify: `src/components/organization/UnitSidePanel.tsx`, `src/components/organization/OrganizationWorkspace.tsx`.
- Test: `tests/regression/clean-start-ui-unit-panel.test.ts`; extend the local UI harness only if needed for interaction testing.
- Update: this plan and approved design status/verification notes; graph artifacts through the existing update command.

**Interfaces:**
- Settings-save callbacks and `UnitPatch` carry `engineeringCanViewAllRequests: boolean`.
- Switch ID/test ID: `unit-engineering-view-all-requests`. Label: `Engineering can view all requests`.
- Help explains all departments/stages, inheritance by sub-units, solution-work eligibility, and no editing/approval rights. Follow existing accessible label and tooltip style.

- [ ] Add failing rendering tests for label association, default-off/missing state, persisted-on state, and explanatory help. Add source/interaction coverage for settings-save payload and selection-state reset using the existing test patterns.
- [ ] Run `npx tsx --test tests/regression/clean-start-ui-unit-panel.test.ts` and confirm only the new UI assertions fail.
- [ ] Add controlled state initialized with `unit.engineeringCanViewAllRequests ?? false`; reset it when selected unit/flag changes. Include it in save payloads and callbacks and extend workspace optimistic overrides. Add the switch next to the existing solution-work toggle, using existing style/components without redesign.
- [ ] Run focused UI, hierarchy, visibility, admin-boundary, and action regressions. Use available LSP diagnostics before `npm run check`; if unavailable, record that and rely on the full TypeScript check.
- [ ] Run `npm run check` and inspect the complete result. A failure blocks completion and must be investigated rather than waived.
- [ ] Run `graphify update .`, inspect `git diff --check`, and self-review the full feature diff for correctness and permission escalation. Do not apply the migration to a production database.
- [ ] If an authorized reviewer is available, obtain a bounded whole-change review and resolve material findings; otherwise record the self-review limitation.
- [ ] Commit verified changes; finish with the setting location, verification result, and unapplied migration notice.
