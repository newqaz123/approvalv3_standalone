# Organization Clean Start — Tree-First Administration UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]` syntax for tracking.

**Planning status:** Planning only (reconciled 2026-09-10). Requires Plan A complete AND Plan B Task 2 complete minimum (Task 1's route-source walk consumes B2's resolver); Tasks 8–9 additionally require B7 (restart/preview) and B15 (legacy lib deletion). Recommended: start Plan C after B15 to keep one writer and one green line. Implementation is not authorized yet.

**Goal:** One "Organization & Approvals" tree workspace (approved clean-start-v4 mockup) replacing the separate organization and route-configuration experience: units with directly assigned people/positions, flat teams beneath their reporting person, sharing badges, hover/focus Rename+Manage with touch overflow, contextual panels for units/people/teams, position administration with rank-change blocking, inline rename, assignment move/remove with before/after confirmation, and a company-wide Approval-chains panel with defaults, exceptions, limit-conflict blocking, and a side-effect-free submitter test that exercises the confirmed option-A path.

**Architecture:** A server page (`/admin/organization`) loads the workspace snapshot via one server-action loader; a client workspace renders the tree and contextual side panels; all mutations are server actions validating through the Plan A domain; the three legacy admin surfaces (departments, hierarchy, routes) and their actions/components/API route are deleted in Task 1 together with the legacy organization admin UI that the rewritten `src/server-actions/organization.ts` orphans.

**Tech Stack:** Next.js 15.5.23 App Router server actions, React 19, Radix UI (`src/components/ui/*`), Tailwind, `node:test` via `tsx`, Playwright on 3100, Portly, graphify.

**Spec:** `docs/superpowers/specs/organization-clean-start-design.md` (Tree-first administration + Approval defaults and exceptions sections; G1 option A and O2 resolutions apply)

## Global Constraints

- All Plan A global constraints apply (isolated worktree; fresh `app_cleanstart_dev` only; never `app_db`/`app_org_manual_7abcdf3`; ports 3000/3001/3002 untouched, worktree server on 3100; Portly temp/wait; per-task commit + independent review gate; `npm run check` after every task; no test deleted without a named replacement in the same task).
- Dependency honesty: C1 needs B2; C8 needs A4; C9 needs B2+B7 (and B15 for the final legacy-lib deletion); C10 needs everything. Do not start C1 before B2's review gate passes.
- Tree displays units, directly assigned people, position names, flat teams beneath their reporting person, and sharing-boundary labels. A person appears ONCE; overseeing multiple teams never duplicates the assignment.
- Selecting a unit opens a contextual side panel; a person opens assignment management; a team opens membership/reporting management.
- Unit-row Rename/Manage appear on hover or keyboard focus; touch devices keep a visible overflow control. The persistent "Manage unit"/inherited-chain link is REMOVED from tree rows; the effective route source shows inside Manage. Compact custom-chain exception badges stay.
- Manage unit contains the explicit "Share requests within this unit and all its descendants" toggle; the tree shows a "Request sharing" badge; wording never implies child exclusions.
- Unit/team names support pencil-to-edit, Enter/save, Escape/cancel, adjacent validation errors, retained input on failure.
- Create unit asks for name and parent (no inferred type; the company root exists from setup only). Assign person selects an existing account, position, unit, optional valid team; account creation is separate. Move/edit shows before/after confirmation; changing unit clears incompatible team selection explicitly; it never changes application permissions (role). Remove assignment deactivates it, preserves audit/history, and lists the account under "Unassigned people".
- A change invalidating a team's reporting person never silently selects a replacement — explicit correction is required before saving.
- Approval chains opens a company-wide panel: root defaults separate per phase; unit exceptions versioned; effective source shown ("Uses company default / Inherited from <unit> / Custom at this unit") with View/Customize; Add approval step with configurable position names and a named Approval limit; lowering the limit flags conflicting steps and blocks publication; Test with a submitter resolves real candidates WITHOUT creating requests, snapshots, or publication — including team submitters via the confirmed option-A path; publish affects future attempts only; drafts/published visibly distinct.
- Browser verification is REAL Playwright interaction on 3100 plus `npm run build`; regex/source tests supplementary only.

---

## File map (Plan C owns these)

| Area | Paths |
|---|---|
| Page/loader | `src/app/admin/organization/page.tsx` (rewritten), `src/server-actions/organization.ts` (rewritten: `getOrganizationWorkspaceData` + mutations) |
| Workspace | `src/components/organization/{OrganizationWorkspace,OrganizationTree,TreeNodeRow,InlineNameEdit,UnassignedPeopleList}.tsx` |
| Panels | `src/components/organization/{UnitSidePanel,PersonAssignmentPanel,TeamPanel,PositionAdminPanel,ApprovalChainsPanel,RouteEditorPanel,SubmitterTestDialog,RestartAttemptDialog}.tsx` |
| Server actions | `src/server-actions/approval-routes.ts` (rewritten for defaults/exceptions/preview in Task 9), restart wrapper in `src/server-actions/approvals.ts` (B7) |
| Task 1 deletions | `src/app/admin/departments/`, `src/app/admin/hierarchy/`, `src/app/admin/routes/`, `src/app/api/departments/`, `src/server-actions/{departments,department-assignments,hierarchy}.ts`, `src/components/admin/department-*.tsx`, `src/components/admin/hierarchy*` + `src/components/admin/hierarchy/`, old `src/components/admin/organization/{OrganizationEditor,OrganizationUnitTree,PositionAssignmentTable,ReportingGroupEditor}.tsx`, `src/lib/organization/mapping.ts`, `scripts/organization-import-dry-run.ts`, `scripts/apply-reviewed-organization-mapping.ts`, `tools/organization-mapping-schema.ts`, `tests/regression/{department-levels,hierarchy-level-range,organization-import-dry-run,organization-mapping-apply,organization-admin-ui}.test.ts`, `tests/integration/organization-mapping-apply.integration.test.ts` |
| Tests | `tests/regression/clean-start-ui-*.test.ts`, `tests/e2e/clean-start-organization-tree.spec.ts` |

Shared client types (loader output, consumed by every component):

```ts
// src/server-actions/organization.ts
export interface WorkspaceSnapshot {
  units: readonly OrganizationUnitNode[]
  positions: readonly PositionNode[]
  assignments: readonly AssignmentNode[]
  teams: readonly TeamNode[]
  users: ReadonlyArray<{ id: string; name: string; email: string; role: string; isActive: boolean }>
  unassignedUsers: ReadonlyArray<{ id: string; name: string; email: string }>
  routeSources: ReadonlyArray<{ unitId: string; phase: ApprovalPhase; source: 'ROOT_DEFAULT' | 'INHERITED' | 'CUSTOM'; sourceUnitId: string | null; publishedVersionId: string | null; hasDraft: boolean }>
  customChainExceptions: ReadonlyArray<{ requestId: string; title: string }>
  readiness: ReadinessReport
}
export async function getOrganizationWorkspaceData(): Promise<WorkspaceSnapshot>
```

---

### Task 1: Workspace page, data loader, and legacy admin-surface removal

**Files:**
- Rewrite: `src/app/admin/organization/page.tsx`, `src/server-actions/organization.ts`
- Delete: the Task-1-deletions list above
- Modify: `src/components/admin/{user-form,create-user-dialog,edit-user-dialog,user-table}.tsx` — remove department pickers (org assignment editing lives in this workspace per spec; Task 6 provides it)
- Test: `tests/regression/clean-start-workspace-loader.test.ts`

**Interfaces:**
- Consumes: A3 `validateOrganization`, A7 `verifyCleanStartReadiness`, B2 `selectNearestRoute` semantics (routeSources computed with the same nearest-published walk, read-only).
- Produces: `getOrganizationWorkspaceData(): Promise<WorkspaceSnapshot>` — page calls it after `requireAdmin` and renders `<OrganizationWorkspace snapshot={...} />` with header actions "Approval chains" (Task 9), "Positions" (Task 8), "Create unit" (Task 5). `routeSources` per unit+phase: PUBLISHED version at that unit → `CUSTOM`; else nearest published ancestor → `INHERITED` + `sourceUnitId`; none → `ROOT_DEFAULT` only when the root published; `hasDraft` flags DRAFT versions at that scope.

- [ ] **Step 1: RED baseline** — `grep -rln "getDepartments\|department-selector\|DepartmentSelector\|from '@/server-actions/departments'\|from '@/server-actions/hierarchy'" src/` recorded as the caller checklist (user-form pickers expected).
- [ ] **Step 2: Write the failing loader test** — fake db: units company/ops/section-a; published root defaults for all phases; a published REQUEST exception at ops. Assert `routeSources` for section-a/REQUEST is `{ source: 'INHERITED', sourceUnitId: 'ops' }`, ops/REQUEST `CUSTOM`, section-a/SOLUTION `{ source: 'ROOT_DEFAULT', sourceUnitId: 'company' }`; `unassignedUsers` lists active users without active assignments; `readiness` is the A7 validator output.
- [ ] **Step 3: RED** (loader missing; old exports gone after deletion). **Step 4: Implement** the rewrite + deletions + picker fixes. **Step 5: GREEN** — `npm run check` passes; rerun the Step 1 grep → zero matches; `grep -rln "mapping\|organization-import-dry-run" src/ scripts/ tools/` → zero matches. **Step 6: Commit** `git commit -am "feat(clean-start): organization workspace loader; remove legacy department/hierarchy/routes admin surfaces"`.

**Review gate C1:** reviewer confirms `/admin/departments`, `/admin/hierarchy`, `/admin/routes` no longer resolve; every deleted test is listed with its scope (legacy admin behavior intentionally removed per owner direction); user forms compile without org pickers; no orphan imports.

---

### Task 2: Tree rendering — units, people, positions, teams, badges, unassigned list

**Files:**
- Create: `src/components/organization/{OrganizationWorkspace,OrganizationTree,TreeNodeRow,UnassignedPeopleList}.tsx`
- Test: `tests/regression/clean-start-ui-tree.test.ts` (reuse the render harness style of the deleted `organization-admin-ui.test.ts` — inspect any sibling UI regression test for the pattern before writing)

**Interfaces:**
- Consumes: `WorkspaceSnapshot`; `InlineNameEdit` (Task 3 — rows render read-only names until then).
- Produces: nested `TreeNodeRow`s (children sorted by name); each row shows the unit name, a "Request sharing" badge when `unit.shareRequests`, directly assigned people as `Name — Position` chips (active assignments + positions map), and each active team as an indented group under its reporting person's chip containing member chips; a person overseeing two teams appears ONCE as a person chip with both team groups nested beneath it; `UnassignedPeopleList` renders unassigned accounts; compact custom-chain exception badges render from `customChainExceptions`.

- [ ] **Step 1: Failing test** — fixture with Pat managing two teams in Operations: person chip count for Pat is exactly 1; both team groups render beneath Pat's chip; Alice appears under Section A only; sharing badge present on sharing units, absent otherwise; unassigned list shows the fixture's unassigned user.
- [ ] **Step 2: RED.** **Step 3: Implement** (pure props-driven components). **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): tree renders units, people once, teams under reporting person, badges"`.

**Review gate C2:** reviewer confirms the person-once invariant is structural (derived from an assignments map keyed by user, not per team).

---

### Task 3: Inline rename for units and teams

**Files:**
- Create: `src/components/organization/InlineNameEdit.tsx`
- Modify: `src/server-actions/organization.ts` (add `renameOrganizationUnit`, `renameTeam`)
- Test: `tests/regression/clean-start-ui-inline-rename.test.ts`

**Interfaces:**
- Consumes: A3 duplicate-name errors.
- Produces:

```tsx
export function InlineNameEdit(props: { value: string; onSave: (next: string) => Promise<void>; disabled?: boolean }): JSX.Element
// pencil → input; Enter commits; Escape cancels; failure keeps the edited input and renders the
// error adjacently (aria-describedby); success re-renders the saved name.
```

```ts
export async function renameOrganizationUnit(input: { id: string; name: string }): Promise<{ success: true }>
export async function renameTeam(input: { id: string; name: string }): Promise<{ success: true }>
// requireAdmin; trim; non-empty; unique among siblings (units) / within the unit (teams);
// audit row; revalidatePath('/admin/organization'). Renames never touch attempts/snapshots.
```

- [ ] **Step 1: Failing tests** — component harness with a rejecting `onSave`: input retains the typed value and shows the adjacent error; Escape restores the original without persisting; Enter calls `onSave` with the trimmed value. Action tests (fake db): duplicate sibling name `/unique/i`; empty `/required/i`.
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN.** **Step 5: Commit** `git commit -am "feat(clean-start): inline unit/team rename with retained input and adjacent errors"`.

**Review gate C3:** reviewer confirms Escape never persists and no silent name normalization occurs.

---

### Task 4: Hover/focus Rename + Manage controls and touch overflow

**Files:**
- Modify: `src/components/organization/TreeNodeRow.tsx`
- Test: `tests/e2e/clean-start-organization-tree.spec.ts` (first browser spec; extended in Tasks 5–10)

**Interfaces:**
- Consumes: Task 2 rows.
- Produces: `Rename`/`Manage` visible on `:hover` and `:focus-within` (Tailwind `group-hover`/`group-focus-within`); on coarse pointers an always-visible overflow menu (Radix DropdownMenu) with the same actions; NO persistent manage/link affordance in the row.

- [ ] **Step 1: RED browser test** — desktop viewport: `Manage` hidden until `row.hover()`; keyboard focus makes controls visible; mobile viewport (`page.setViewportSize({ width: 390, height: 844 })`): overflow button visible without hover. Requires the seeded `app_cleanstart_dev` (B14 fixture) and the 3100 server — Portly-managed.
- [ ] **Step 2: Implement**; wire `Manage` → unit selection (Task 5 panel), `Rename` → Task 3 editor.
- [ ] **Step 3: GREEN** (`portly temp 'TEST_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/clean-start-organization-tree.spec.ts' --timeout 30m`).
- [ ] **Step 4: Commit** `git commit -am "feat(clean-start): hover/focus manage controls with touch overflow menu"`.

**Review gate C4:** reviewer runs the spec headed; `grep -rn "Manage unit" src/components/organization/TreeNodeRow.tsx` returns nothing (the title lives only inside `UnitSidePanel`).

---

### Task 5: Unit side panel — sharing toggle, solutions flag, manager selection, route source

**Files:**
- Create: `src/components/organization/UnitSidePanel.tsx`
- Modify: `src/server-actions/organization.ts` (add `createOrganizationUnit`, `updateUnitSettings`, `setUnitManager`)
- Test: `tests/regression/clean-start-ui-unit-panel.test.ts` + browser extension

**Interfaces:**
- Consumes: `WorkspaceSnapshot.routeSources`; A3.
- Produces:

```ts
export async function createOrganizationUnit(input: { name: string; parentId: string }): Promise<{ id: string }>
// parent required (the root exists from setup only); duplicate sibling name rejected; audit; revalidate.
export async function updateUnitSettings(input: { id: string; shareRequests: boolean; canWorkOnSolutions: boolean }): Promise<{ success: true }>
export async function setUnitManager(input: { unitId: string; managerUserId: string | null }): Promise<{ success: true }>
// candidates = active DIRECT assignments in the unit; reject non-direct/inactive; validateOrganization before write.
```

Panel: title "Manage <unit>"; sharing toggle labeled exactly "Share requests within this unit and all its descendants"; "Can work on solutions" flag; unit-manager Select (active direct assignees); effective route source per phase with View/Customize routing to Task 9's panel.

- [ ] **Step 1: Failing tests** — `createOrganizationUnit` without parent `/parent required/i`; `setUnitManager` with a user assigned to a different unit `/directly/i`; toggles persist (fake db). Browser: selecting a unit opens the panel; sharing badge updates after save; effective source for the seeded Section A REQUEST shows "Inherited from Operations".
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN.** **Step 5: Commit** `git commit -am "feat(clean-start): unit side panel with sharing, solutions flag, direct manager, route source"`.

**Review gate C5:** reviewer checks the exact toggle copy (no child-exclusion wording) and manager options excluding non-direct assignees.

---

### Task 6: Person assignment panel — assign/move/remove with confirmations

**Files:**
- Create: `src/components/organization/PersonAssignmentPanel.tsx`
- Modify: `src/server-actions/organization.ts` (add `assignPerson`, `moveAssignment`, `removeAssignment`)
- Test: `tests/regression/clean-start-ui-assignment.test.ts` + browser extension

**Interfaces:**
- Consumes: A3.
- Produces:

```ts
export async function assignPerson(input: { userId: string; unitId: string; positionId: string; teamId: string | null }): Promise<{ assignmentId: string }>
// rejects inactive user, second active assignment (one per person), team outside unit.
export async function moveAssignment(input: { assignmentId: string; unitId: string; positionId: string; teamId: string | null }): Promise<{ success: true }>
// UI shows a before/after confirmation (unit, position, team); changing unit with an incompatible
// team requires explicit reselection (client-enforced) and the server rejects stale team ids.
export async function removeAssignment(input: { assignmentId: string }): Promise<{ success: true }>
// isActive=false + deactivatedAt; NEVER deactivates the account; audit; user moves to Unassigned.
```

None of the three writes `users.role`. Attempts/snapshots untouched. A move invalidating a team's reports-to throws `/explicit correction/i` and the UI requires choosing the team's new reports-to in the same save — no silent replacement.

- [ ] **Step 1: Failing tests** — assign: second active assignment `/one active/i`, cross-unit team throw; move: component test asserts the confirmation dialog lists old and new unit/position/team; remove: assignment inactive, user still active, appears in `unassignedUsers`; invalidating move `/explicit correction/i`.
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN.** **Step 5: Commit** `git commit -am "feat(clean-start): assignment panel with before/after confirm, explicit team clearing, safe removal"`.

**Review gate C6:** reviewer confirms removal preserves audit/history and `users.role` is written nowhere in the three actions.

---

### Task 7: Team panel — membership and reports-to management

**Files:**
- Create: `src/components/organization/TeamPanel.tsx`
- Modify: `src/server-actions/organization.ts` (add `createTeam`, `updateTeam`)
- Test: `tests/regression/clean-start-ui-team.test.ts` + browser extension

**Interfaces:**
- Consumes: A3 rules.
- Produces:

```ts
export async function createTeam(input: { unitId: string; name: string; reportsToAssignmentId: string; memberAssignmentIds: readonly string[] }): Promise<{ teamId: string }>
export async function updateTeam(input: { id: string; name: string; reportsToAssignmentId: string; memberAssignmentIds: readonly string[] }): Promise<{ success: true }>
// both reject: reports-to not in unit / inactive / rank not strictly above every member / reports-to
// inside membership / duplicate active team name in unit / members from other units; errors name offenders.
```

- [ ] **Step 1: Failing tests** — duplicate name in unit `/duplicate team/i`; equal-rank reports-to `/strictly above/i`; reports-to as member; cross-unit member listed by name. Browser: create a team in Section A with two members; it renders beneath the reports-to person; a fixture with one reports-to person overseeing two teams renders both groups without duplicating the person.
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN.** **Step 5: Commit** `git commit -am "feat(clean-start): team panel with strict reports-to validation"`.

**Review gate C7:** reviewer confirms the shared-manager fixture exists (one reports-to person, two teams).

---

### Task 8: Position administration — configurable names and ranks with blocking

**Files:**
- Create: `src/components/organization/PositionAdminPanel.tsx`
- Modify: `src/server-actions/organization.ts` (add `createPosition`, `renamePosition`, `changePositionRank`, `deactivatePosition`)
- Test: `tests/regression/clean-start-ui-positions.test.ts` + browser extension

**Interfaces:**
- Consumes: A4 `assessPositionRankChange`.
- Produces:

```ts
export async function createPosition(input: { name: string; rank: number }): Promise<{ positionId: string }>
// unique name; unique rank among ACTIVE positions; positive integer rank.
export async function renamePosition(input: { positionId: string; name: string }): Promise<{ success: true }>
// rename only; snapshot labels keep their captured strings.
export async function changePositionRank(input: { positionId: string; proposedRank: number }): Promise<{ success: true } | { blocked: true; impact: RankChangeImpact }>
// assessPositionRankChange first; blocked responses carry the full affected-record lists.
export async function deactivatePosition(input: { positionId: string }): Promise<{ success: true }>
// refused while any ACTIVE assignment or published route step/limit references the position.
```

The panel (header action "Positions") lists active positions with name, rank, assignment count; inline rename (Task 3 component); rank edit renders the blocked case with the AFFECTED RECORDS listed (team names; route scope/phase/problem) — no auto-repair, no attempt changes.

- [ ] **Step 1: Failing tests** — duplicate active name `/unique/i`; rank collision; blocked case returns the guard's lists verbatim (assert both arrays' contents); success writes + audits; `deactivatePosition` with an active assignment `/in use/i`. Component: blocked response renders team names and route problems adjacent to the rank input; save enabled only when unblocked.
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN.** **Step 5: Commit** `git commit -am "feat(clean-start): position administration with rank-change blocking and affected-record listing"`.

**Review gate C8:** reviewer confirms no auto-repair, exact-record listing, and zero instance writes (fake db assertion).

---

### Task 9: Approval chains panel — defaults, exceptions, limit conflicts, submitter test

**Files:**
- Create: `src/components/organization/{ApprovalChainsPanel,RouteEditorPanel,SubmitterTestDialog,RestartAttemptDialog}.tsx`
- Rewrite: `src/server-actions/approval-routes.ts` (clean-start versions; this rewrite removes the last importer of the legacy `approval-routes` lib files and `approval-engine/candidate-groups.ts` — delete them here if B15 deferred them, grep-verified)
- Test: `tests/regression/clean-start-ui-chains.test.ts` + browser extension

**Interfaces:**
- Consumes: B2 validation/selection, B7 preview/restart, A4 guard, B2 `findLimitConflicts`.
- Produces:

```ts
export async function saveRouteDraft(input: { scopeUnitId: string; phase: ApprovalPhase; approvalLimitPositionId: string; steps: ReadonlyArray<{ order: number; positionId: string }> }): Promise<{ versionId: string }>
export async function publishRoute(input: { scopeUnitId: string; phase: ApprovalPhase; approvalLimitPositionId: string; steps: ReadonlyArray<{ order: number; positionId: string }> }): Promise<{ versionId: string }>
// publish refuses when findLimitConflicts is non-empty, returning the flagged steps; retires the prior
// published version + inserts the new one in ONE transaction (partial index rejects a concurrent publisher).
export async function testWithSubmitter(input: { submitterUserId: string; phase: ApprovalPhase; draft?: { approvalLimitPositionId: string; steps: ReadonlyArray<{ order: number; positionId: string }> } }): Promise<{
  source: string; scopeUnitId: string; routeVersionId: string | 'DRAFT'; autoApproved: boolean
  steps: ReadonlyArray<{ order: number; requiredPositionId: string; positionName: string; candidates: ReadonlyArray<{ id: string; name: string }>; skipped: boolean; skipReason?: 'VACANT_POSITION' }>
  noEligibleSteps: boolean
}>
// READ-ONLY: no request rows, no snapshots, no publication. Team submitters resolve through the
// confirmed option-A path (own-team exact-position members, reports-to, own-unit manager, ancestors).
```

Panel UX per spec: header "Approval chains" opens the company-wide panel; root defaults separate per phase; unit exceptions show effective source + View/Customize; the editor supports "Add approval step" with position-name Selects and a named "Approval limit" Select; drafts and published render as visibly distinct lists; lowering the limit disables Publish and lists conflicting steps until corrected; "Test with a submitter" explains it resolves actual people without creating requests; `RestartAttemptDialog` wraps B7 preview + restart with a required reason textarea.

- [ ] **Step 1: Failing tests** — publish with a step above a lowered limit returns the conflict list and writes nothing (fake db); drafts distinct from published; `testWithSubmitter` returns candidates for an UNGROUPED submitter, `autoApproved: true` for an at-limit origin, `noEligibleSteps: true` for all-vacant, and for a TEAM submitter returns own-team exact-position members plus reports-to/manager/ancestor holders deduplicated (option-A positive test); zero-write assertion (fake db records no create calls).
- [ ] **Step 2: RED.** **Step 3: Implement** (+ deferred legacy deletions if grep-verified). **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): approval chains panel with limit-conflict blocking and side-effect-free option-A submitter test"`.

**Review gate C9:** reviewer confirms the zero-write assertion and the team-submitter positive test, and that root-default publication is not framed as a global activation switch (copy check).

---

### Task 10: Full browser verification and final sweep

**Files:**
- Extend: `tests/e2e/clean-start-organization-tree.spec.ts`
- Delete: any legacy lib files B15 deferred with a named importer here (expected: none if C9 ran after B15)

- [ ] **Step 1:** `npm run build` (Portly, 40m) — must pass.
- [ ] **Step 2:** browser spec on 3100 — full journey: create unit under Operations; rename inline (Enter saves, Escape cancels, duplicate name shows the adjacent error and retains input); toggle sharing and observe the badge; assign a person with a team; move with before/after confirmation; remove → appears under Unassigned; open Positions; attempt a blocked rank change and see the affected-record list; open Approval chains; edit the root default; lower the limit below a step → Publish disabled with the conflict list; Test with a submitter (ungrouped AND team submitter) shows option-A candidates; publish; verify drafts/published distinction; restart a stranded attempt with a reason. All interactions are real Playwright clicks — no API shims.
- [ ] **Step 3:** `npm run check` full pass; final zero-match audits: `grep -rln "departmentId|department_approvers|user\.level\b|LEGACY_LEVEL|TeamReportingPathUnresolvedError" src/ prisma/` → empty; `git worktree list` + `portly status` + read-only `psql -l` isolation evidence.
- [ ] **Step 4: Commit** `git commit -am "feat(clean-start): complete tree workspace; browser verification"`; `graphify update . --force`.

**Review gate C10 (Plan C exit):** independent reviewer replays the spec headed or reads the report; confirms the three old admin surfaces are gone, the final greps are empty, and worktree/DB/port isolation evidence is attached.
