# Organization Clean Start — Organization Domain Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Planning status:** Planning only (reconciled 2026-09-10 after the owner resolved G1 option A and O2; see the index). Implementation has NOT been authorized. No existing database may be touched.

**Goal:** Deliver the complete pure organization domain for the clean-start model — single company root with arbitrary-depth units, configurable positions/ranks, one-active-assignment, explicit unit managers, flat teams with strictly-higher reports-to, downward-inclusive sharing scopes, solution-work eligibility, the owner-confirmed team reporting path (option A), and readiness validation — as NEW additive modules that leave the existing application compiling and green at every commit.

**Architecture:** Plan A writes only new files under final canonical paths that do not collide with legacy modules (`src/lib/organization/model.ts`, `hierarchy.ts`, `assignments.ts`, `position-rank-guard.ts`, `sharing.ts`, `reporting-path.ts`, `src/lib/solution-eligibility.ts`, `src/lib/clean-start-readiness.ts`). Legacy `src/lib/organization/{types,tree,repository,mapping}.ts` and the legacy approval engine stay untouched here; they are deleted in Plan B/C tasks when their last importer disappears (grep-verified per task; final sweep in Plan C Task 10). The fresh database in Task 1 uses the CURRENT schema so the interim application keeps working; the clean-start schema lands additively in Plan B Task 1 and legacy models are dropped in Plan B Task 15.

**Tech Stack:** Next.js 15.5.23, React 19, TypeScript 5 strict, Prisma 6.1 (PostgreSQL), Zod 4, `node:test` via `tsx`, Playwright, Portly for bounded commands, graphify for graph refresh.

**Spec:** `docs/superpowers/specs/organization-clean-start-design.md` (updated: G1 and participants-only notifications resolved)

## Global Constraints

- Planning only until the owner authorizes execution; execution MUST happen in a NEW git worktree on a NEW branch (`feat/organization-clean-start`, based on `7abcdf3`) with a NEW database. NEVER reset, migrate, push, seed, or otherwise touch `app_db` or `app_org_manual_7abcdf3`. The existing worktree/branch `feat/organization-approval-redesign` at `7abcdf3` stays untouched for manual testing.
- Port discipline (corrected 2026-09-10): port **3000 runs an unrelated application**, port **3001 is the original dev server**, and port **3002 is the manual-test branch's server** — none of them may be stopped, restarted, or reused. The clean-start worktree dev server uses **3100** exclusively (`npm run dev -- -p 3100`, `NEXTAUTH_URL="http://localhost:3100"`).
- Fresh dev database name: `app_cleanstart_dev`. Fresh CI database: `app_cleanstart_ci` (only via `CLEAN_START_CI_DATABASE_URL`, mirroring the guard pattern of `tests/integration/organization-approval-constraints.integration.test.ts`: self-skip without the variable, hard error if it equals `DATABASE_URL`). Production migrations are NEVER run locally; SQL constraints and race behavior verified only in disposable CI.
- Exactly one company root; arbitrary acyclic nesting; no fixed unit types. Positions have configurable names and a company-wide rank; rank changes are blocked when they invalidate a live reporting relationship or published chain, listing affected records; attempt snapshots never change.
- One active assignment per person (one unit, one position, optional one flat team in that unit). Unit managers are selected from ACTIVE DIRECT assignments to the managed unit. Teams are flat; reports-to is actively assigned to the same unit, outside the membership, strictly above every member; one person may oversee multiple teams; no cycles.
- **G1 resolved — option A (owner-confirmed, spec item 2):** for a team member the reporting path follows eligible exact-position members of their own team, then the explicit reports-to person, then the selected own-unit manager (included even when different from the reports-to person), then selected ancestor-unit managers. Only configured positions are actionable; people are deduplicated so nobody appears twice; traversal inserts no extra approval steps. For ungrouped people: own-unit manager, then ancestor-unit managers.
- Sharing is downward-inclusive: nearest sharing-enabled self-or-ancestor unit gives the COMPLETE subtree including child sharing scopes (Pat in Operations sees Sections A and B; Alice in A sees A only).
- **O2 resolved — participants-only notifications (spec line 62):** status-change notifications go to request participants only; no unit- or sharing-scope broadcasts; approval-needed goes only to current eligible step candidates; viewing access never subscribes anyone. Participant membership is defined explicitly in Plan B Task 11.
- Every task ends with its tests passing, `npm run check` passing, a commit, and an independent review gate. No deliberate failure carries into a later task; broken builds are never hidden by deleting meaningful tests — legacy tests are deleted/re-based only in the same task that replaces the behavior they assert.
- No concurrent writers in the same cwd: execution of this plan is single-writer in the execution worktree. Any parallel track (see index) requires its own worktree and branch.
- Verification includes REAL `next build` and Playwright browser interaction on port 3100; regex/source assertions are supplementary only.
- Portly discipline for every command: `portly status`, then `job_id="$(portly temp '<command>' --path "$EXECUTION_WORKTREE" --timeout <bound>)"`, then `portly wait "$job_id"`. Run `graphify update . --force` from the execution worktree after structural changes.

## Resolved-decision record (replaces the former G1 gate)

- **G1 — RESOLVED, option A.** The former `TeamReportingPathUnresolvedError` scaffolding and the artificial "team member throws" tests are REMOVED from these plans. Plan A Task 6 implements the full path; Plan B Tasks 3–4 and Plan C Task 9 carry real positive and negative tests for the confirmed traversal and dedup. No blocking design decision remains (see index "Remaining decisions").
- **O2 — RESOLVED, participants-only.** Plan B Task 11 implements it; the former "removed pending O2" language is gone.

## Execution isolation (Task 1 sets this up; every later task assumes it)

```bash
# from the main checkout at 7abcdf3, branch feat/organization-approval-redesign (untouched afterwards)
git worktree add ../approval-app-clean-start -b feat/organization-clean-start 7abcdf3
cd ../approval-app-clean-start
export EXECUTION_WORKTREE="$PWD"
# fresh database ONLY
psql "postgresql://postgres:changeme@localhost:5432/postgres" -c "CREATE DATABASE app_cleanstart_dev;"
# worktree-local env; never reuse .env from the manual-test worktree
cat > .env <<'EOF'
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_cleanstart_dev"
NEXTAUTH_URL="http://localhost:3100"
NEXTAUTH_SECRET="cleanstart-dev-secret-change-me"
UPLOAD_DIR="./uploads"
EOF
```

Assert before any schema/seed command: `grep -n "DATABASE_URL" .env` names ONLY `app_cleanstart_dev`. Ports 3000/3001/3002 belong to other servers — never `portly kill-port` or restart them.

---

## File map (Plan A owns these — all NEW files; nothing existing is modified or deleted)

| Area | Paths and responsibility |
|---|---|
| Domain model | `src/lib/organization/model.ts` — `OrganizationUnitNode`, `PositionNode`, `AssignmentNode`, `TeamNode`, `ReportingPath`, `ReportingPathStep` |
| Tree | `src/lib/organization/hierarchy.ts` — `assertSingleAcyclicRoot`, `ancestorUnitIds`, `descendantUnitIds`, `nearestSharingScopeUnitId` |
| Assignments/teams | `src/lib/organization/assignments.ts` — `validateOrganization`, `OrganizationValidationError` |
| Rank guard | `src/lib/organization/position-rank-guard.ts` — `assessPositionRankChange` (reuses `ApprovalPhase` from the existing `@/lib/approval-routes/types`) |
| Sharing | `src/lib/organization/sharing.ts` — `sharingScopeUnitIds` |
| Eligibility | `src/lib/solution-eligibility.ts` — `canWorkOnSolutions` |
| Reporting path | `src/lib/organization/reporting-path.ts` — `resolveReportingPath`, `loadUserOrganizationContext` (option A) |
| Readiness | `src/lib/clean-start-readiness.ts` + `scripts/verify-clean-start-readiness.ts` (read-only) |
| Tests | `tests/regression/clean-start-{model-tree,assignments,position-rank-guard,sharing,solution-eligibility,reporting-path,readiness}.test.ts` |

Legacy deletions are NOT part of Plan A. They are distributed: `src/lib/approval-rollout.ts` in Plan B Task 6; legacy visibility files in Plan B Task 9; legacy engine files in Plan B Task 15; `src/server-actions/{departments,department-assignments,hierarchy}.ts`, their pages/components/API route, `src/lib/organization/mapping.ts`, `scripts/organization-import-dry-run.ts`, `tools/organization-mapping-schema.ts`, and the old organization admin UI in Plan C Tasks 1/10. Each deletion happens in the first task whose rewrite removes the last importer (grep-verified in-task).

---

### Task 1: Isolated worktree, fresh database, green baseline

**Files:**
- Create: worktree + branch + `app_cleanstart_dev` + worktree `.env` (per "Execution isolation")
- Commit inside the worktree: carry the spec onto the branch
- Test: none new (this task's evidence is the green baseline)

**Interfaces:**
- Consumes: nothing.
- Produces: `EXECUTION_WORKTREE` with the current schema applied to the fresh DB, the current seed, a passing `npm run check`, a successful `npm run build`, and a sign-in browser smoke — the baseline every later task must preserve.

- [ ] **Step 1:** create the worktree/branch/database/.env exactly per "Execution isolation"; verify `git -C "$EXECUTION_WORKTREE" status --short` shows only the untracked spec; commit it: `git add docs/superpowers/specs/organization-clean-start-design.md && git commit -m "docs: add organization clean-start design spec (G1/O2 resolved)"`.
- [ ] **Step 2:** apply the CURRENT schema to the fresh DB and seed it: `portly temp 'npx prisma db push --skip-generate && npx prisma generate && npx prisma db seed' --path "$EXECUTION_WORKTREE" --timeout 30m`. Pre-assert the `.env` guard above. (This is the legacy-compatible baseline; the clean schema is additive from Plan B Task 1.)
- [ ] **Step 3:** `portly temp 'npm run check' --path "$EXECUTION_WORKTREE" --timeout 30m` — expected PASS (unchanged code on a fresh DB).
- [ ] **Step 4:** `portly temp 'npm run build' --path "$EXECUTION_WORKTREE" --timeout 40m` — expected PASS.
- [ ] **Step 5:** browser smoke on 3100: start `portly temp 'npm run dev -- -p 3100'` (long-running), then `portly temp 'TEST_BASE_URL=http://localhost:3100 npx playwright test tests/e2e --grep "sign"' --timeout 30m` — expected PASS. Confirm ports 3000/3001/3002 are untouched (`portly status`).
- [ ] **Step 6:** Commit (if any fix-ups were needed) `git commit -am "chore(clean-start): isolated worktree baseline"`; otherwise record baseline log paths in the task notes.

**Review gate A1:** independent reviewer confirms: two worktrees listed (`git worktree list`); manual-test branch unchanged; `.env` names only `app_cleanstart_dev`; `psql -l` (read-only) shows the new DB and untouched `app_db`/`app_org_manual_7abcdf3`; ports 3000/3001/3002 untouched; check/build/smoke evidence attached.

---

### Task 2: Domain model and rooted tree

**Files:**
- Create: `src/lib/organization/model.ts`, `src/lib/organization/hierarchy.ts`
- Test: `tests/regression/clean-start-model-tree.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:

```ts
// src/lib/organization/model.ts
export interface OrganizationUnitNode {
  id: string; name: string
  parentId: string | null        // null only for the single company root
  isActive: boolean
  shareRequests: boolean
  canWorkOnSolutions: boolean
  managerUserId: string | null
}
export interface PositionNode { id: string; name: string; rank: number; isActive: boolean }
export interface AssignmentNode { id: string; userId: string; unitId: string; positionId: string; teamId: string | null; isActive: boolean }
export interface TeamNode { id: string; unitId: string; name: string; reportsToAssignmentId: string; isActive: boolean }
export interface ReportingPathStep {
  kind: 'TEAM_REPORTS_TO' | 'UNIT_MANAGER'
  unitId: string; assignmentId: string; userId: string; positionId: string
}
export interface ReportingPath {
  originUserId: string; assignmentId: string; unitId: string; positionId: string
  teamId: string | null
  unitPath: readonly string[]            // [own unit, parent, ..., root]
  steps: readonly ReportingPathStep[]    // ordered persons, deduplicated
}
```

```ts
// src/lib/organization/hierarchy.ts
export class NoSharingScopeError extends Error { readonly code = 'NO_SHARING_SCOPE' }
export function assertSingleAcyclicRoot(units: readonly OrganizationUnitNode[]): Map<string, OrganizationUnitNode>
export function ancestorUnitIds(units: readonly OrganizationUnitNode[], unitId: string): string[]
export function descendantUnitIds(units: readonly OrganizationUnitNode[], rootUnitId: string): string[]
export function nearestSharingScopeUnitId(units: readonly OrganizationUnitNode[], unitId: string): string
```

`assertSingleAcyclicRoot` throws on duplicate ids, missing parents, cycles, and on zero or more-than-one ACTIVE root (`parentId === null && isActive`). `nearestSharingScopeUnitId` walks self → ancestors (skipping inactive units by continuing through their `parentId`) and returns the first `shareRequests` unit; throws `NoSharingScopeError` when none exists (fail closed; setup makes the root sharing-enabled).

- [ ] **Step 1: Write the failing test**

```ts
// tests/regression/clean-start-model-tree.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ancestorUnitIds, assertSingleAcyclicRoot, descendantUnitIds, nearestSharingScopeUnitId,
} from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'

const u = (id: string, parentId: string | null, over: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode =>
  ({ id, name: id, parentId, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null, ...over })

const units = [
  u('company', null, { shareRequests: true }),
  u('operations', 'company', { shareRequests: true }),
  u('section-a', 'operations', { shareRequests: true }),
  u('section-b', 'operations', { shareRequests: true }),
  u('deep', 'section-a'),
]

describe('clean-start rooted tree', () => {
  it('allows arbitrary depth and enforces exactly one active root', () => {
    assert.deepEqual(ancestorUnitIds(units, 'deep'), ['deep', 'section-a', 'operations', 'company'])
    assert.deepEqual(descendantUnitIds(units, 'operations').sort(), ['operations', 'section-a', 'section-b', 'deep'])
    assert.throws(() => assertSingleAcyclicRoot([u('r1', null), u('r2', null)]), /more than one active root/i)
    assert.throws(() => assertSingleAcyclicRoot([u('a', 'b'), u('b', 'a')]), /cycle/i)
    assert.throws(() => assertSingleAcyclicRoot([u('only', 'missing')]), /missing/i)
    assert.throws(() => assertSingleAcyclicRoot([u('gone', null, { isActive: false })]), /no active root/i)
  })

  it('resolves the nearest sharing-enabled ancestor, failing closed without one', () => {
    assert.equal(nearestSharingScopeUnitId(units, 'deep'), 'section-a')
    assert.equal(nearestSharingScopeUnitId(units, 'section-b'), 'section-b')
    const noSharing = [u('company', null), u('leaf', 'company')]
    assert.throws(() => nearestSharingScopeUnitId(noSharing, 'leaf'), /NoSharingScope/i)
  })
})
```

- [ ] **Step 2: RED** — `job_id="$(portly temp 'npx tsx --test tests/regression/clean-start-model-tree.test.ts' --path "$EXECUTION_WORKTREE" --timeout 10m)" && portly wait "$job_id"`. Expected: FAIL — `Cannot find module '@/lib/organization/hierarchy'`.
- [ ] **Step 3: Implement** `model.ts` + `hierarchy.ts` per Interfaces (DFS cycle detection; root count over ACTIVE roots; sharing walk validated by `assertSingleAcyclicRoot` first).
- [ ] **Step 4: GREEN** — rerun; PASS. `npm run check` PASS (old suite untouched; new files additive).
- [ ] **Step 5: Commit** `git add src/lib/organization/model.ts src/lib/organization/hierarchy.ts tests/regression/clean-start-model-tree.test.ts && git commit -m "feat(clean-start): rooted-tree domain with single active root and sharing scope lookup"`

**Review gate A2:** reviewer confirms both files import nothing from the legacy organization modules and that the root/cycle/sharing assertions cover the spec bullet "Arbitrary-depth trees, parent/cycle validation, one root".

---

### Task 3: Assignments, unit managers, and flat teams validation

**Files:**
- Create: `src/lib/organization/assignments.ts`
- Test: `tests/regression/clean-start-assignments.test.ts`

**Interfaces:**
- Consumes: Task 2 (`assertSingleAcyclicRoot`, model types).
- Produces:

```ts
// src/lib/organization/assignments.ts
export class OrganizationValidationError extends Error { readonly code = 'ORGANIZATION_INVALID' }
export function validateOrganization(
  units: readonly OrganizationUnitNode[],
  positions: readonly PositionNode[],
  assignments: readonly AssignmentNode[],
  teams: readonly TeamNode[],
): void
```

Throws `OrganizationValidationError` when: (1) more than one ACTIVE assignment exists for one user; (2) an active assignment references an inactive/missing unit or position; (3) a unit's `managerUserId` has no ACTIVE assignment DIRECTLY in that unit; (4) a team's `reportsToAssignmentId` is not an active assignment in the same unit; (5) the reports-to position rank is not strictly greater than every active member's rank in that team, or the reports-to assignment is itself a member (`teamId === team.id`); (6) a member's `teamId` points to a team in a different unit than the member's assignment unit; (7) duplicate ACTIVE team names within one unit; (8) units fail `assertSingleAcyclicRoot`. (Flat teams cannot create cycles structurally — no parent-team field exists; the check list documents why.)

- [ ] **Step 1: Write the failing test**

```ts
// tests/regression/clean-start-assignments.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateOrganization } from '@/lib/organization/assignments'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'

const units: OrganizationUnitNode[] = [
  { id: 'company', name: 'Company', parentId: null, isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: 'u-boss' },
  { id: 'eng', name: 'Engineering', parentId: 'company', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: 'u-lead' },
]
const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-lead', name: 'Team Lead', rank: 2, isActive: true },
  { id: 'p-mgr', name: 'Unit Manager', rank: 3, isActive: true },
]
const asg = (id: string, userId: string, unitId: string, positionId: string, teamId: string | null = null): AssignmentNode =>
  ({ id, userId, unitId, positionId, teamId, isActive: true })
const assignments: AssignmentNode[] = [
  asg('a-boss', 'u-boss', 'company', 'p-mgr'),
  asg('a-lead', 'u-lead', 'eng', 'p-mgr'),
  asg('a-m1', 'u-m1', 'eng', 'p-staff', 't-1'),
  asg('a-m2', 'u-m2', 'eng', 'p-staff', 't-1'),
]
const teams: TeamNode[] = [
  { id: 't-1', unitId: 'eng', name: 'Maintenance Crew', reportsToAssignmentId: 'a-lead', isActive: true },
]

describe('clean-start assignment/team validation', () => {
  it('accepts a valid organization with one active assignment per person', () => {
    validateOrganization(units, positions, assignments, teams)
  })
  it('rejects a second active assignment for one user', () => {
    assert.throws(() => validateOrganization(
      units, positions, [...assignments, asg('a-m1b', 'u-m1', 'company', 'p-staff')], teams,
    ), /one active/i)
  })
  it('rejects a unit manager not directly assigned to the managed unit', () => {
    const badUnits = units.map((x) => x.id === 'eng' ? { ...x, managerUserId: 'u-boss' } : x)
    assert.throws(() => validateOrganization(badUnits, positions, assignments, teams), /manager/i)
  })
  it('rejects a reports-to person not strictly above every member', () => {
    const lowRankTeams = [{ ...teams[0], reportsToAssignmentId: 'a-m1' }]
    assert.throws(() => validateOrganization(units, positions, assignments, lowRankTeams), /rank/i)
  })
  it('rejects duplicate active team names inside one unit and cross-unit team membership', () => {
    const dup = [...teams, { id: 't-2', unitId: 'eng', name: 'Maintenance Crew', reportsToAssignmentId: 'a-lead', isActive: true }]
    assert.throws(() => validateOrganization(units, positions, assignments, dup), /duplicate team/i)
    const crossUnitMember = assignments.map((a) => a.id === 'a-m2' ? { ...a, unitId: 'company' } : a)
    assert.throws(() => validateOrganization(units, positions, crossUnitMember, teams), /team/i)
  })
})
```

- [ ] **Step 2: RED** (module missing). **Step 3: Implement** per Interfaces (single pass with Maps; rank lookups via `positions`; every message names offending ids — Plan C renders them adjacently). **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): one-active-assignment, direct unit managers, flat team validation"` — stage the new files explicitly.

**Review gate A3:** reviewer maps each of the 8 rules to its spec bullet and confirms error messages carry ids.

---

### Task 4: Position rank-change impact guard

**Files:**
- Create: `src/lib/organization/position-rank-guard.ts`
- Test: `tests/regression/clean-start-position-rank-guard.test.ts`

**Interfaces:**
- Consumes: Task 2/3 types; `ApprovalPhase` from the EXISTING `@/lib/approval-routes/types` (present at 7abcdf3 — no new type creation).
- Produces:

```ts
// src/lib/organization/position-rank-guard.ts
export interface RankChangeImpact {
  blocked: boolean
  affectedReportingRelationships: ReadonlyArray<{ teamId: string; teamName: string; unitId: string }>
  affectedPublishedRoutes: ReadonlyArray<{
    routeVersionId: string; scopeUnitId: string; phase: ApprovalPhase
    problem: 'STEP_NOT_ASCENDING' | 'STEP_EXCEEDS_LIMIT'
  }>
}
export function assessPositionRankChange(input: {
  positions: readonly PositionNode[]
  teams: readonly TeamNode[]
  assignments: readonly AssignmentNode[]
  publishedRoutes: ReadonlyArray<{
    id: string; scopeUnitId: string; phase: ApprovalPhase
    approvalLimitPositionId: string
    steps: ReadonlyArray<{ stepOrder: number; positionId: string }>   // persisted row shape
  }>
  positionId: string
  proposedRank: number
}): RankChangeImpact
```

Blocked when the proposed rank breaks a team's reports-to-strictly-above invariant, a PUBLISHED route's strictly-ascending step order, or pushes a step above the route's limit rank (a limit change is assessed the same way). Drafts never block. Attempt snapshots are never consulted.

- [ ] **Step 1: Write the failing test** (positions p1..p4 ranks 1..4; team reports-to holds p3, member holds p2; published route steps `[p1, p3]` limit `p4`):

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assessPositionRankChange } from '@/lib/organization/position-rank-guard'
import type { AssignmentNode, PositionNode, TeamNode } from '@/lib/organization/model'

const positions: PositionNode[] = [
  { id: 'p1', name: 'Staff', rank: 1, isActive: true },
  { id: 'p2', name: 'Supervisor', rank: 2, isActive: true },
  { id: 'p3', name: 'Manager', rank: 3, isActive: true },
  { id: 'p4', name: 'Director', rank: 4, isActive: true },
]
const assignments: AssignmentNode[] = [
  { id: 'a1', userId: 'u1', unitId: 'eng', positionId: 'p3', teamId: null, isActive: true },
  { id: 'a2', userId: 'u2', unitId: 'eng', positionId: 'p2', teamId: 't1', isActive: true },
]
const teams: TeamNode[] = [{ id: 't1', unitId: 'eng', name: 'Crew', reportsToAssignmentId: 'a1', isActive: true }]
const publishedRoutes = [{
  id: 'rv1', scopeUnitId: 'company', phase: 'REQUEST' as const,
  approvalLimitPositionId: 'p4',
  steps: [{ stepOrder: 1, positionId: 'p1' }, { stepOrder: 2, positionId: 'p3' }],
}]

describe('position rank change guard', () => {
  it('blocks a change breaking a live team reporting relationship and lists it', () => {
    const impact = assessPositionRankChange({ positions, teams, assignments, publishedRoutes, positionId: 'p2', proposedRank: 4 })
    assert.equal(impact.blocked, true)
    assert.deepEqual(impact.affectedReportingRelationships, [{ teamId: 't1', teamName: 'Crew', unitId: 'eng' }])
  })
  it('blocks a change breaking published step ordering or the limit', () => {
    const impact = assessPositionRankChange({ positions, teams, assignments, publishedRoutes, positionId: 'p3', proposedRank: 1 })
    assert.equal(impact.blocked, true)
    assert.deepEqual(impact.affectedPublishedRoutes.map((r) => r.problem), ['STEP_NOT_ASCENDING'])
    const lowered = assessPositionRankChange({ positions, teams, assignments, publishedRoutes, positionId: 'p4', proposedRank: 2 })
    assert.equal(lowered.blocked, true)
    assert.deepEqual(lowered.affectedPublishedRoutes.map((r) => r.problem), ['STEP_EXCEEDS_LIMIT'])
  })
  it('allows changes that invalidate nothing', () => {
    const impact = assessPositionRankChange({ positions, teams, assignments, publishedRoutes, positionId: 'p4', proposedRank: 5 })
    assert.equal(impact.blocked, false)
    assert.deepEqual(impact.affectedReportingRelationships, [])
    assert.deepEqual(impact.affectedPublishedRoutes, [])
  })
})
```

- [ ] **Step 2: RED.** **Step 3: Implement** (apply the proposed rank to a copied position list; re-check the Task 3 team rule for affected teams; re-validate each published route's ascending/limit invariants). **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): rank-change impact guard listing affected relationships and published routes"` (stage new files).

**Review gate A4:** reviewer confirms block-and-list only (no auto-repair), snapshots untouched, PUBLISHED routes only.

---

### Task 5: Sharing scope and solution-work eligibility

**Files:**
- Create: `src/lib/organization/sharing.ts`, `src/lib/solution-eligibility.ts`
- Test: `tests/regression/clean-start-sharing.test.ts`, `tests/regression/clean-start-solution-eligibility.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:

```ts
// src/lib/organization/sharing.ts
export function sharingScopeUnitIds(units: readonly OrganizationUnitNode[], assignmentUnitId: string): string[]
// = descendantUnitIds(units, nearestSharingScopeUnitId(units, assignmentUnitId))
// Child sharing settings never remove descendants from an ancestor member's scope.

// src/lib/solution-eligibility.ts
export function canWorkOnSolutions(units: readonly OrganizationUnitNode[], assignmentUnitId: string | null): boolean
// true iff assignmentUnitId is non-null and the unit or ANY ancestor has canWorkOnSolutions
```

- [ ] **Step 1: Failing tests** — sharing: the canonical spec matrix (Operations sharing-enabled with sharing-enabled Sections A and B beneath it, plus `section-a-child`): `sharingScopeUnitIds(units, 'operations')` includes `section-a`, `section-a-child`, `section-b`; `sharingScopeUnitIds(units, 'section-a')` excludes `section-b`. Eligibility: Engineering flagged with a descendant → descendant member eligible; unflagged sibling not; `null` unit (unassigned) not; inactive ancestor chain → nearest ACTIVE flagged ancestor applies.

```ts
// tests/regression/clean-start-sharing.test.ts (core assertions)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sharingScopeUnitIds } from '@/lib/organization/sharing'
import { nearestSharingScopeUnitId, descendantUnitIds } from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'

const u = (id: string, parentId: string | null, over: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode =>
  ({ id, name: id, parentId, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null, ...over })
const units = [
  u('company', null, { shareRequests: true }),
  u('operations', 'company', { shareRequests: true }),
  u('section-a', 'operations', { shareRequests: true }),
  u('section-a-child', 'section-a'),
  u('section-b', 'operations', { shareRequests: true }),
]

describe('downward-inclusive sharing scope', () => {
  it('gives an ancestor member the complete subtree including child sharing scopes', () => {
    const ids = sharingScopeUnitIds(units, 'operations')
    for (const expected of ['operations', 'section-a', 'section-a-child', 'section-b']) assert.ok(ids.includes(expected))
    assert.equal(sharingScopeUnitIds(units, 'section-a').includes('section-b'), false)
  })
  it('is exactly the descendants of the nearest sharing ancestor', () => {
    assert.deepEqual(
      sharingScopeUnitIds(units, 'section-a-child').sort(),
      descendantUnitIds(units, nearestSharingScopeUnitId(units, 'section-a-child')).sort(),
    )
  })
})
```

- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): downward-inclusive sharing scope and unit-flag solution eligibility"` (stage new files).

**Review gate A5:** reviewer re-derives the Pat/Alice/Bob example from the spec verbatim and confirms eligibility confers no approval/visibility rights.

---

### Task 6: Reporting path resolution — option A (owner-confirmed)

**Files:**
- Create: `src/lib/organization/reporting-path.ts`
- Test: `tests/regression/clean-start-reporting-path.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3; a structural repository port (NO Prisma import — plain interfaces so the module compiles against any db satisfying the shape; the production adapter is built in Plan B Task 6).

```ts
// src/lib/organization/reporting-path.ts
export interface ReportingPathRepository {
  findUser(userId: string): Promise<{ id: string; isActive: boolean } | null>
  loadUnits(): Promise<OrganizationUnitNode[]>
  loadPositions(): Promise<PositionNode[]>
  loadAssignments(): Promise<AssignmentNode[]>
  loadTeams(): Promise<TeamNode[]>
}
export async function resolveReportingPath(userId: string, db: ReportingPathRepository): Promise<ReportingPath | null>
export async function loadUserOrganizationContext(userId: string, db: ReportingPathRepository): Promise<{ userId: string; path: ReportingPath } | null>
```

Semantics — **option A, exactly as the owner confirmed (spec item 2)**:
- null when the user is missing/inactive or has NO active assignment.
- Load everything, run `assertSingleAcyclicRoot` + `validateOrganization` (fail closed on inconsistent organization).
- `unitPath = ancestorUnitIds(units, assignment.unitId)`.
- UNGROUPED (`teamId === null`): `steps` = for each unit in `unitPath` (own unit first), that unit's `managerUserId` mapped to the manager's ACTIVE assignment, as `{ kind: 'UNIT_MANAGER', unitId, assignmentId, userId, positionId }`, EXCLUDING the origin's own assignment.
- TEAM MEMBER (`teamId !== null`): `steps` = the team's reports-to person (`{ kind: 'TEAM_REPORTS_TO', ... }`, from `teams.reportsToAssignmentId`) followed by the own-unit manager and each ancestor-unit manager (`UNIT_MANAGER`), **including the own-unit manager even when different from the reports-to person**, deduplicated by `userId` so nobody appears twice. The origin's own assignment never appears. (Own-team exact-position members are NOT path steps — they enter candidate selection in Plan B Task 3, mirroring the owner's "eligible exact-position members of their own team" clause.)
- One active assignment per person plus direct-manager rule means a person manages at most one unit, so a manager cannot repeat structurally; dedupe defensively anyway.

- [ ] **Step 1: Write the failing test** with an in-memory fake repository (NO Prisma, NO database):

```ts
// tests/regression/clean-start-reporting-path.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveReportingPath } from '@/lib/organization/reporting-path'
import type { ReportingPathRepository } from '@/lib/organization/reporting-path'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'

const units: OrganizationUnitNode[] = [
  { id: 'company', name: 'Company', parentId: null, isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: 'u-root' },
  { id: 'eng', name: 'Engineering', parentId: 'company', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: 'u-engmgr' },
  { id: 'web', name: 'Web', parentId: 'eng', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: 'u-webmgr' },
]
const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-lead', name: 'Lead', rank: 2, isActive: true },
  { id: 'p-mgr', name: 'Manager', rank: 3, isActive: true },
]
const assignments: AssignmentNode[] = [
  { id: 'a-root', userId: 'u-root', unitId: 'company', positionId: 'p-mgr', teamId: null, isActive: true },
  { id: 'a-engmgr', userId: 'u-engmgr', unitId: 'eng', positionId: 'p-mgr', teamId: null, isActive: true },
  { id: 'a-webmgr', userId: 'u-webmgr', unitId: 'web', positionId: 'p-mgr', teamId: null, isActive: true },
  { id: 'a-lead', userId: 'u-lead', unitId: 'web', positionId: 'p-lead', teamId: null, isActive: true },
  { id: 'a-staff-ungrouped', userId: 'u-ung', unitId: 'web', positionId: 'p-staff', teamId: null, isActive: true },
  { id: 'a-staff-team', userId: 'u-team', unitId: 'web', positionId: 'p-staff', teamId: 't-web', isActive: true },
]
const teams: TeamNode[] = [{ id: 't-web', unitId: 'web', name: 'Web Crew', reportsToAssignmentId: 'a-lead', isActive: true }]

const db: ReportingPathRepository = {
  findUser: async (userId) => ({ id: userId, isActive: true }),
  loadUnits: async () => units,
  loadPositions: async () => positions,
  loadAssignments: async () => assignments,
  loadTeams: async () => teams,
}

describe('reporting path — option A', () => {
  it('ungrouped: own-unit manager then ancestor managers, exact persons', async () => {
    const path = await resolveReportingPath('u-ung', db)
    assert.ok(path)
    assert.deepEqual(path.steps.map((s) => s.userId), ['u-webmgr', 'u-engmgr', 'u-root'])
    assert.ok(path.steps.every((s) => s.kind === 'UNIT_MANAGER'))
  })
  it('team member: reports-to, then own-unit manager (even when different), then ancestors; nobody twice', async () => {
    const path = await resolveReportingPath('u-team', db)
    assert.ok(path)
    assert.deepEqual(path.steps.map((s) => s.userId), ['u-lead', 'u-webmgr', 'u-engmgr', 'u-root'])
    assert.equal(path.steps[0].kind, 'TEAM_REPORTS_TO')
    assert.equal(new Set(path.steps.map((s) => s.userId)).size, path.steps.length)
  })
  it('deduplicates when the reports-to person IS the unit manager', async () => {
    const teamsSameManager = teams.map((t) => t.id === 't-web' ? { ...t, reportsToAssignmentId: 'a-webmgr' } : t)
    const path = await resolveReportingPath('u-team', { ...db, loadTeams: async () => teamsSameManager })
    assert.ok(path)
    assert.deepEqual(path.steps.map((s) => s.userId), ['u-webmgr', 'u-engmgr', 'u-root'])
  })
  it('never includes the origin and returns null for missing/inactive/unassigned users', async () => {
    const path = await resolveReportingPath('u-webmgr', db)
    assert.ok(path)
    assert.equal(path.steps.some((s) => s.userId === 'u-webmgr'), false)
    assert.equal(await resolveReportingPath('u-nobody', { ...db, findUser: async () => null }), null)
    assert.equal(await resolveReportingPath('u-gone', { ...db, findUser: async (id) => ({ id, isActive: false }) }), null)
  })
})
```

- [ ] **Step 2: RED** (module missing). **Step 3: Implement** per Interfaces (this REPLACES the former G1 scaffolding — no `TeamReportingPathUnresolvedError` exists anywhere). **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): reporting path option A with team-to-manager transition and dedup"` (stage new files).

**Review gate A6:** reviewer verifies the four test cases against the owner-confirmed wording (own team exact-position candidates handled in Plan B Task 3; reports-to → own-unit manager INCLUDED even when different → ancestors; dedup; no self; no ungrouped coworkers) and confirms zero `TeamReportingPathUnresolvedError` references remain in the repository.

---

### Task 7: Readiness validation (replaces cutover/mapping machinery)

**Files:**
- Create: `src/lib/clean-start-readiness.ts`, `scripts/verify-clean-start-readiness.ts`
- Test: `tests/regression/clean-start-readiness.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:

```ts
// src/lib/clean-start-readiness.ts
export interface CleanStartReadinessDb {
  loadUnits(): Promise<OrganizationUnitNode[]>
  loadPositions(): Promise<PositionNode[]>
  loadAssignments(): Promise<AssignmentNode[]>
  loadTeams(): Promise<TeamNode[]>
  countPublishedRoutesByPhase(): Promise<Record<'REQUEST' | 'SOLUTION' | 'FINAL', number>>
}
export interface ReadinessReport { ready: boolean; blockers: ReadonlyArray<{ code: string; detail: string }> }
export const ROOT_DEFAULT_ROUTES_REQUIRED = 'ROOT_DEFAULT_ROUTES_PUBLISHED' as const
export async function verifyCleanStartReadiness(db: CleanStartReadinessDb): Promise<ReadinessReport>
```

Blockers: any `validateOrganization` failure (`ORGANIZATION_INVALID:<detail>`), no published route version for the company ROOT scope in some phase (`ROOT_DEFAULT_ROUTES_PUBLISHED`), fewer than two active positions (`POSITIONS_MISSING`). The CLI script prints the report and exits 1 on blockers; read-only, never writes, no env-var rollout modes, no mapping digest.

- [ ] **Step 1: Failing test** — fake db with a valid org but zero published REQUEST routes → `ready: false` with `ROOT_DEFAULT_ROUTES_PUBLISHED`; complete fixture (one published route per phase at the root scope) → `ready: true`. **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): explicit organization/route readiness validation"` (stage new files).

**Review gate A7:** reviewer confirms read-only behavior and fail-closed blockers.

---

### Task 8: Real Next build verification for the foundation

**Files:** none new (verification task).

- [ ] **Step 1:** `portly temp 'npm run build' --path "$EXECUTION_WORKTREE" --timeout 40m` — REQUIRED pass (server-action/framework boundary errors surface only here).
- [ ] **Step 2:** browser smoke on 3100 (`npm run dev -- -p 3100` + `TEST_BASE_URL=http://localhost:3100 npx playwright test tests/e2e --grep "sign"`); confirm 3000/3001/3002 untouched via `portly status`.
- [ ] **Step 3:** `npm run check` full pass; `graphify update . --force`.
- [ ] **Step 4:** Commit fix-ups only if needed (`fix(clean-start): build boundary corrections`); otherwise record log paths.

**Review gate A8 (Plan A exit):** independent reviewer confirms: all seven domain modules exist at final paths with green tests; NO existing application file was modified or deleted in Plan A (`git diff --stat 7abcdf3..HEAD -- src prisma | wc -l` shows only additions); fresh-DB-only evidence; both protected databases untouched; build + browser evidence attached.

---

## Plan A → Plan B handoff interfaces (exact)

Plan B consumes, without redefinition: `OrganizationUnitNode`/`PositionNode`/`AssignmentNode`/`TeamNode`/`ReportingPath`/`ReportingPathStep` (A2), `validateOrganization` (A3), `assessPositionRankChange` (A4), `sharingScopeUnitIds` (A5), `canWorkOnSolutions` (A5), `resolveReportingPath` + `ReportingPathRepository` (A6), `verifyCleanStartReadiness` (A7).
