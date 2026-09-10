# Organization Clean Start — Approval & Access Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Planning status:** Planning only (reconciled 2026-09-10; G1 resolved option A, O2 resolved participants-only). Requires Plan A complete (A1–A8). Execution is strictly sequential B1→B15 in ONE worktree; no task in this plan may start before its predecessor's review gate passes, because later tasks compile against earlier ones' interfaces (see index "Dependency honesty").

**Goal:** Land the clean-start approval engine and access model on the fresh database — additive schema evolution first, then routes, candidates, immutable attempts, first-decision-wins decisions, phase adapters with the assignment-based submission gate, admin-only stranded restart, sharing-scope visibility with caller rewiring, action policy, participants-only notifications with an explicit participant-membership definition, the full legacy consumer sweep, disposable-CI constraint/race verification, browser verification, and a final schema-finalization task that drops legacy models only after every consumer is rewritten.

**Architecture:** Every commit compiles and keeps `npm run check` green: the schema evolves ADDITIVELY in Task 1 (new tables/columns nullable, legacy untouched), consumers are rewritten file-by-file in Tasks 6–12, and Task 15 drops legacy models/columns/enums, tightens staged columns to NOT NULL, and squashes migrations into one canonical initial migration. Engine modules are new files (`definition.ts`, `selection.ts`, `candidates.ts`, `plan.ts`, `decisions.ts`, `attempts.ts`) so the legacy engine keeps compiling until its importers are rewired; legacy engine/lib files are deleted in the first task whose rewrite removes their last importer (grep-verified), with the final sweep in Task 15.

**Tech Stack:** Next.js 15.5.23 server actions, React 19, TypeScript 5 strict, Prisma 6.1 PostgreSQL (`Serializable` isolation for instance creation), `node:test` via `tsx`, Playwright on 3100, Portly, graphify.

**Spec:** `docs/superpowers/specs/organization-clean-start-design.md` (updated: G1 item 2 and participants-only line 62 resolved)

## Global Constraints

- All Plan A global constraints apply unchanged (isolated worktree `feat/organization-clean-start`; fresh `app_cleanstart_dev` only; never `app_db`/`app_org_manual_7abcdf3`; ports 3000/3001/3002 untouched, worktree server on 3100; production migrations never local; Portly temp/wait; per-task commit + independent review gate; `npm run check` green after every task).
- **Build-gate realism (audited 2026-09-10):** no task may delete or weaken a test to make a broken build pass. Legacy tests are deleted or re-based ONLY inside the task that replaces the behavior they assert, and every deletion is listed in that task with its replacement named. Interim states must compile; known transitional functional gaps are documented, not hidden.
- Normal routes auto-approve iff the origin position rank ≥ the route limit rank; steps at or below the origin rank never require approval; required positions ascend and cannot exceed the limit; custom ordered-person chains never auto-approve.
- Managers cover descendant units only when the configured chain calls for their exact position — never substitutes.
- Multiple eligible holders are all notified; the FIRST committed decision wins; rejection closes the attempt and returns for revision. Vacant steps are skipped and audited; all-vacant completes with an explicit reason. Inactive candidates cannot act; all-inactive saved approvers require explicit admin restart (reason + replacement-chain preview; old attempt and decisions preserved; restart grants nothing).
- Attempts preserve origin, route version, positions, and candidate identities as immutable snapshots; moving a person never rewrites attempts. Request/Final origin follow the requester; Solution origin follows the stored solution submitter, never an authorized reviser.
- **G1 option A (owner-confirmed):** team-member candidate lookup follows eligible exact-position members of the submitter's own team, then the explicit reports-to person, then the selected own-unit manager (included even when different from reports-to), then selected ancestor-unit managers; only configured positions; nobody twice.
- **O2 participants-only (owner-confirmed):** status-change notifications to request participants only; NO unit- or sharing-scope broadcasts; approval-needed only to current eligible step candidates; viewing access never subscribes. Participant membership is the explicit definition in Task 11 — viewers are never equated with subscribers.
- Unit exceptions are versioned; nearest configured ancestor route applies per phase; an INVALID nearer configuration fails rather than falling back. Publish affects future attempts only; drafts/published stay visibly distinct.
- Integration/CI checks run ONLY through `CLEAN_START_CI_DATABASE_URL` with the self-skip + equality-guard pattern from `tests/integration/organization-approval-constraints.integration.test.ts`.
- Verification includes REAL `next build` and Playwright browser runs on 3100.

## Transitional states (documented, not hidden)

- Between B1 and B6 the legacy `createRequest` still runs on the fresh DB; with only the seeded admin (no `departmentId`) it cannot submit — submission becomes available when B6 lands the assignment-based gate. No test asserts interim submission.
- Between B1 and B9 legacy visibility still answers list queries; both protected databases are irrelevant to these states (fresh DB only).
- B15 is the only task that removes legacy schema objects; until then legacy columns coexist (nullable/ignored by new writers).

---

## File map (Plan B owns these)

| Area | Paths |
|---|---|
| Schema | `prisma/schema.prisma` (additive evolution in B1; finalization in B15), `prisma/migrations/00000000000001_clean_start_additive/migration.sql` (B1), squashed `prisma/migrations/00000000000001_clean_start_init/migration.sql` (B15 replaces the pair) |
| Route domain (new) | `src/lib/approval-routes/definition.ts` (types + validation + limit conflicts), `src/lib/approval-routes/selection.ts` (nearest-published resolution) |
| Engine (new) | `src/lib/approval-engine/candidates.ts`, `plan.ts` (builder + persistence), `decisions.ts` (eligibility + advance + stranded check), `attempts.ts` (phase origins + attempt creators + submission gate) |
| Visibility (new) | `src/lib/request-visibility/scope.ts`; caller rewiring across the 14 files listed in B9 |
| Policy | `src/lib/permission-checks.ts`, `src/lib/action-permissions.ts`, `src/server-actions/request-action-capabilities.ts` (rewritten in place with all compile-time importers updated in-task) |
| Notifications | `src/lib/notification-recipients.ts` (rewritten), `src/lib/post-commit-notifications.ts` (department target removed), `src/server-actions/notifications.ts` (`notifyUsersInDepartment` deleted), participant module `src/lib/request-participants.ts` (new) |
| Consumers | `src/server-actions/{requests,solutions,approvals,dashboard,analytics,budget-control,files,audit,auth,users,engineering-sub-tasks,reports}.ts`, `src/lib/{export,request-export,pdf,budget-control,follow-up-dashboard,workflow-pipeline,modal-data-adapters,approver-search}.ts`, `src/lib/auth-config.ts`, `src/app/(dashboard)/approval-chain/page.tsx`, `src/components/requests/*`, new `src/app/api/organization/unit-users/route.ts`, `src/lib/unit-labels.ts` |
| Tests | `tests/regression/clean-start-{schema,routes-*,engine-*,visibility-*,policy,notifications,participants,consumers}*.test.ts`, `tests/integration/clean-start-constraints.integration.test.ts`, `tests/e2e/clean-start-{approval-flow,sharing-visibility}.spec.ts` |

Legacy deletions owned here (each in the first task whose rewrite removes the last importer, grep-verified): `src/lib/approval-rollout.ts` + rollout env usage (B6); `src/lib/request-visibility/{predicate,types}.ts`, `src/lib/request-access.ts` (B9); `src/lib/approval-engine/legacy.ts` + old `transactions.ts` + `src/lib/request-approval-transaction.ts` (B5 re-bases their mechanics; the modules are deleted when `approvals.ts` rewiring in B6/B7 removes the last runtime importer, grep-verified, else B15); old `instances.ts`/`phase-adapters.ts`/`phase-origin.ts`/`candidate-groups.ts`/`organization/{types,tree,repository}.ts`/`approval-routes/{types,validation,resolver}.ts` (B15 — they remain compiled-against by `src/server-actions/approval-routes.ts` until Plan C Task 9 rewrites it); `src/lib/approval-levels.ts` (B15).

---

### Task 1: Additive schema evolution on the fresh database

**Files:**
- Modify: `prisma/schema.prisma` (additions only)
- Create: `prisma/migrations/00000000000001_clean_start_additive/migration.sql`
- Test: `tests/regression/clean-start-schema.test.ts`

**Interfaces:**
- Consumes: Plan A model types (naming contract only).
- Produces (Prisma additions; legacy models/columns UNTOUCHED until B15):
  - NEW `company_settings` (`id` default `"default"`, `name`, `rootUnitId` unique FK→organization_units Restrict, timestamps).
  - NEW `positions` (`id`, `name` unique, `rank Int`, `isActive` default true, timestamps).
  - NEW `organization_assignments` (`id`, `userId` FK→users Restrict, `unitId` FK→organization_units Restrict, `positionId` FK→positions Restrict, `teamId` nullable FK→teams SetNull, `isActive` default true, `deactivatedAt` nullable, timestamps).
  - NEW `teams` (`id`, `unitId` FK→organization_units Restrict, `name`, `reportsToAssignmentId` FK→organization_assignments Restrict, `isActive`, timestamps, unique `(unitId, name)`).
  - `organization_units` += `shareRequests Boolean @default(true)`, `canWorkOnSolutions Boolean @default(false)`, `managerUserId String?` (+ relation to users, Restrict). Legacy `unitType`/`legacyDepartmentId`/`operationalType` stay until B15.
  - `approval_route_versions` += `approvalLimitPositionId String?` (+ FK→positions Restrict); `approval_route_steps` += `positionId String?` (+ FK→positions Restrict). Legacy `maximumPositionLevel`/enum `positionCode` stay.
  - `approval_instances` += `originAssignmentId String?`, `originPositionId String?` (FK→positions Restrict), `restartOfInstanceId String?` (+ SELF-relation `restartOf`/`restartedFrom`, Restrict), `restartReason String?`, `restartedById String?` (+ FK→users Restrict).
  - `approval_instance_skips` += `requiredPositionId String?` (FK Restrict); `approval_candidate_groups` += `requiredPositionId String?` (FK Restrict).
  - `request_approvals`/`solution_approvals` += `requiredPositionId String?` (FK Restrict). Legacy `requiredLevel`/enum `requiredPosition`/`isCustomChain`/`integrityVersion` stay.
  - `budget_codes` += `unitId String?` (FK→organization_units SetNull).
- Migration SQL additionally carries the partial unique indexes Prisma cannot express:

```sql
CREATE UNIQUE INDEX one_active_assignment_per_user
  ON organization_assignments (userId) WHERE isActive;
-- Constant-expression index: at most ONE active root row may exist.
CREATE UNIQUE INDEX one_active_company_root
  ON organization_units ((1)) WHERE parentId IS NULL AND isActive;
-- one_published_route_per_scope_phase already exists from the prior redesign;
-- assert presence (see test) rather than re-create.
```

- Snapshot-constraint notes (audited): all new position references use `Restrict` so referenced positions can never be hard-deleted (deactivation is the removal path); `approval_candidate_group_members.capturedDisplayName` stays required (labels frozen at capture); `approval_instances` keeps unique `(requestId, phase, attempt)` / `(solutionId, phase, attempt)`; the restart self-relation preserves the old attempt row.

- [ ] **Step 1: Write the failing schema test** (DMMF PRESENCE assertions only — removal assertions live in B15):

```ts
// tests/regression/clean-start-schema.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'

const fields = (model: string) => {
  const found = Prisma.dmmf.modelMap[model]
  assert.ok(found, `model ${model} must exist`)
  return found.fields.map((f) => f.name)
}

describe('clean-start additive schema', () => {
  it('adds the clean organization models', () => {
    for (const m of ['company_settings', 'positions', 'organization_assignments', 'teams']) assert.ok(Prisma.dmmf.modelMap[m])
    for (const f of ['shareRequests', 'canWorkOnSolutions', 'managerUserId']) assert.ok(fields('organization_units').includes(f))
    for (const f of ['userId', 'unitId', 'positionId', 'teamId', 'isActive', 'deactivatedAt']) assert.ok(fields('organization_assignments').includes(f))
    for (const f of ['unitId', 'name', 'reportsToAssignmentId', 'isActive']) assert.ok(fields('teams').includes(f))
  })
  it('adds position-based routing, limit, and restart provenance', () => {
    assert.ok(fields('approval_route_versions').includes('approvalLimitPositionId'))
    assert.ok(fields('approval_route_steps').includes('positionId'))
    for (const f of ['originAssignmentId', 'originPositionId', 'restartOfInstanceId', 'restartReason', 'restartedById']) {
      assert.ok(fields('approval_instances').includes(f))
    }
    assert.ok(fields('approval_candidate_groups').includes('requiredPositionId'))
    assert.ok(fields('request_approvals').includes('requiredPositionId'))
    assert.ok(fields('budget_codes').includes('unitId'))
  })
  it('carries the partial unique contracts in migration SQL', () => {
    const sql = readFileSync('prisma/migrations/00000000000001_clean_start_additive/migration.sql', 'utf8').replace(/\s+/g, ' ')
    assert.match(sql, /CREATE UNIQUE INDEX one_active_assignment_per_user/i)
    assert.match(sql, /CREATE UNIQUE INDEX one_active_company_root ON organization_units \(\(1\)\) WHERE parentId IS NULL AND isActive/i)
    assert.match(sql, /one_published_route_per_scope_phase/i)
  })
})
```

- [ ] **Step 2: RED** — run via Portly; expected FAIL (`model positions must exist` / missing file).
- [ ] **Step 3: Implement** the additive schema; generate migration SQL with `portly temp 'npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script'` is NOT the right base — use `--from-schema-datasource "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` (diffs the LIVE fresh dev DB against the new datamodel, producing exactly the additive SQL), then append the two partial indexes by hand.
- [ ] **Step 4: Apply to the fresh dev DB only** (`grep` the `.env` guard first): `portly temp 'npx prisma db push --skip-generate && npx prisma generate' --timeout 20m`.
- [ ] **Step 5: GREEN** — schema test PASS; `npm run check` PASS (legacy code still compiles: all additions are nullable/new).
- [ ] **Step 6: Commit** `git commit -am "feat(clean-start): additive schema evolution with partial-index contracts"`.

**Review gate B1:** reviewer confirms: diff contains ONLY additions; migration SQL has both partial indexes with the constant-expression root index; `.env` guard evidence; `npm run check` green with the FULL existing suite (nothing deleted).

---

### Task 2: Route definition, validation, and nearest-route selection

**Files:**
- Create: `src/lib/approval-routes/definition.ts`, `src/lib/approval-routes/selection.ts`
- Test: `tests/regression/clean-start-routes.test.ts`

**Interfaces:**
- Consumes: `PositionNode` (Plan A A2).
- Produces:

```ts
// src/lib/approval-routes/definition.ts
export type ApprovalPhase = 'REQUEST' | 'SOLUTION' | 'FINAL'   // re-exported shape; do NOT duplicate the existing
// export in legacy types.ts — this module exports its own clean step/version types:
export interface ApprovalRouteStepDefinition { order: number; positionId: string }
export interface ApprovalRouteVersionDefinition {
  id: string; scopeUnitId: string; phase: ApprovalPhase; version: number
  approvalLimitPositionId: string; status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
  steps: readonly ApprovalRouteStepDefinition[]
}
export class ApprovalRouteConfigurationError extends Error { readonly code = 'APPROVAL_ROUTE_CONFIGURATION' }
export function validateRouteDefinition(def: ApprovalRouteVersionDefinition, positions: ReadonlyMap<string, PositionNode>): void
export function findLimitConflicts(def: ApprovalRouteVersionDefinition, positions: ReadonlyMap<string, PositionNode>): ReadonlyArray<{ order: number; positionId: string; problem: 'EXCEEDS_LIMIT' }>
```

```ts
// src/lib/approval-routes/selection.ts
export interface ApprovalRouteDb {
  loadOriginPath(originUserId: string): Promise<ReportingPath | null>   // Plan A A6
  loadRoutes(input: { scopeUnitIds: readonly string[]; phase: ApprovalPhase }): Promise<ApprovalRouteVersionDefinition[]>
  loadPositions(): Promise<PositionNode[]>
}
export interface ResolvedApprovalRoute extends ApprovalRouteVersionDefinition { ancestorScopeIds: readonly string[] }
export function selectNearestRoute(ancestorScopeIds: readonly string[], routes: readonly ApprovalRouteVersionDefinition[], phase: ApprovalPhase): ApprovalRouteVersionDefinition
export async function resolvePublishedApprovalRoute(ctx: { phase: ApprovalPhase; originUserId: string; originUnitId: string; requestId: string }, db: ApprovalRouteDb): Promise<ResolvedApprovalRoute>
```

`validateRouteDefinition` throws on: non-contiguous orders (1..n), unknown/inactive position, duplicate position, non-STRICTLY-ascending rank, step rank above the limit rank, unknown/inactive limit. `selectNearestRoute` walks own unit → … → root; at the FIRST scope with any PUBLISHED route: exactly one → select, more than one → throw `Ambiguous published route` (invalid nearer configuration FAILS, no fallback); DRAFT/RETIRED-only scopes are not configured — continue; nothing published → throw `No published route for <phase> in the origin branch`. `resolvePublishedApprovalRoute` verifies the origin path matches the context, loads routes for `unitPath`, selects, validates with a positions map, returns `ancestorScopeIds`.

- [ ] **Step 1: Failing tests** — positions p1(1)..p4(4): valid `[p1, p3]` limit `p4` passes; `[p3, p1]` throws `/ascending/i`; `[p1, p4]` limit `p3` throws `/exceeds/i` AND `findLimitConflicts` returns `[{ order: 2, positionId: 'p4', problem: 'EXCEEDS_LIMIT' }]`; duplicate `/duplicate/i`; order starting at 2 `/contiguous/i`; unknown `/unknown/i`. Selection (fake db, units path `[section-a, department-x, company]`): exception at `section-a` beats root default; no exception → root default; TWO published at `department-x` → `/Ambiguous/i` even with a valid root default (invalid-nearer-fails); draft-only nearer scope falls through to published ancestor; nothing → `/No published route/i`.
- [ ] **Step 2: RED** (modules missing). **Step 3: Implement.** **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): position-id route definitions and nearest-route selection"`.

**Review gate B2:** reviewer confirms the invalid-nearer-fails test exists and drafts never affect selection; zero imports from legacy `approval-routes/{types,validation,resolver}.ts`.

---

### Task 3: Candidate selection — option A traversal (own team, reports-to, managers)

**Files:**
- Create: `src/lib/approval-engine/candidates.ts`
- Test: `tests/regression/clean-start-engine-candidates.test.ts`

**Interfaces:**
- Consumes: `ReportingPath` (A6), `AssignmentNode`, `PositionNode`.
- Produces:

```ts
// src/lib/approval-engine/candidates.ts
export interface CandidateSelectionInput {
  path: ReportingPath
  requiredPositionId: string
  /** ACTIVE assignments of the origin's own team (empty when ungrouped). */
  ownTeamMemberAssignments: readonly AssignmentNode[]
}
export function selectStepCandidates(input: CandidateSelectionInput): ReadonlyArray<{ userId: string; assignmentId: string }>
```

Semantics (owner-confirmed option A, candidate-set form): candidates for `requiredPositionId` are persons holding EXACTLY that position who are (a) active members of the origin's OWN team, or (b) persons on the resolved reporting path (reports-to → own-unit manager → ancestor managers). Search order mirrors the confirmed traversal (own team first, then path order) though the resulting set is the deduplicated union. Sibling-team members are never candidates; substitution by rank is impossible by construction; the origin can never be a candidate (steps above the origin rank are the only actionable ones — a step at/below the origin rank is excluded by the builder). Ungrouped origins pass `ownTeamMemberAssignments: []`, so ungrouped coworkers are never candidates.

- [ ] **Step 1: Failing tests** — path steps `[reports-to (p-lead), own-unit manager (p-mgr), ancestor manager (p-mgr)]`, team members `[m1 (p-staff), m2 (p-lead)]`: `requiredPositionId 'p-mgr'` → the two managers; `'p-lead'` → reports-to AND m2 (own-team member at the exact position), deduped to distinct users; sibling-team members holding `p-lead` NOT returned; ungrouped origin returns only path persons; a person both on the path and in the team appears exactly once.
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): option-A candidate selection from own team and reporting path"`.

**Review gate B3:** reviewer confirms the own-team + reports-to + manager union with dedup matches spec item 2 verbatim, sibling exclusion is tested, and no code queries "rank ≥ X".

---

### Task 4: Pure instance builder and snapshot persistence

**Files:**
- Create: `src/lib/approval-engine/plan.ts`
- Test: `tests/regression/clean-start-engine-plan.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3; A6.
- Produces (all types in this module):

```ts
// src/lib/approval-engine/plan.ts
export const APPROVAL_ENGINE_TRANSACTION_ISOLATION = 'Serializable' as const
export class ApprovalEngineConflictError extends Error { readonly code = 'APPROVAL_ENGINE_CONFLICT' }
export interface PhaseOriginQuery { phase: ApprovalPhase; requestId: string; solutionId?: string; originUserId?: string }
export interface PhaseOrigin {
  phase: ApprovalPhase; originUserId: string; originUnitId: string
  path: ReportingPath; requestId: string
  source: 'REQUESTER' | 'SOLUTION_SUBMITTER' | 'FINAL_INITIATOR'
}
export interface BuildApprovalInstanceInput { requestId: string; solutionId?: string; phase: ApprovalPhase; originUserId: string }
export interface ApprovalStepPlan { order: number; requiredPositionId: string; scopeUnitId: string; candidateUserIds: readonly string[] }
export interface ApprovalSkipPlan { requiredPositionId: string; reason: 'VACANT_POSITION' }
export interface ApprovalInstancePlan {
  phase: ApprovalPhase; requestId?: string; solutionId?: string; routeVersionId?: string
  originUserId: string; originUnitId: string
  originContext: { positionId: string; assignmentId: string; unitPath: readonly string[]; labels: Readonly<Record<string, string>> }
  routingMode: 'SNAPSHOT_GROUP'; attempt: number
  state: 'PENDING' | 'AUTO_APPROVED' | 'COMPLETED_NO_ELIGIBLE_STEPS' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'SUPERSEDED'
  completionReason?: 'NO_ELIGIBLE_APPROVAL_STEPS'
  steps: readonly ApprovalStepPlan[]; skipped: readonly ApprovalSkipPlan[]
}
export interface ApprovalEngineDb {
  resolvePhaseOrigin(query: PhaseOriginQuery): Promise<PhaseOrigin>
  resolvePublishedRoute(ctx: { phase: ApprovalPhase; originUserId: string; originUnitId: string; requestId: string }): Promise<ResolvedApprovalRoute>
  loadPositions(): Promise<PositionNode[]>
  loadOwnTeamActiveAssignments(teamId: string): Promise<AssignmentNode[]>
  findStepCandidates(input: { path: ReportingPath; requiredPositionId: string }): Promise<ReadonlyArray<{ id: string; isActive: boolean }>>
}
export async function buildNormalApprovalInstance(db: ApprovalEngineDb, input: BuildApprovalInstanceInput): Promise<ApprovalInstancePlan>
export interface ApprovalInstanceTx /* structural subset of Prisma.TransactionClient: approval_instances, approval_instance_skips, approval_candidate_groups, approval_candidate_group_members, request_approvals, solution_approvals, user.findMany for labels */
export async function persistApprovalInstance(tx: ApprovalInstanceTx, plan: ApprovalInstancePlan): Promise<ApprovalInstancePlan & { id: string }>
```

Builder (re-based from the reviewed prior engine): resolve origin → resolve route → `originRank >= limitRank` → frozen `{ state: 'AUTO_APPROVED', steps: [], skipped: [] }` (normal routes only) → per step in order: exclude `stepRank <= originRank` (not required — NOT recorded as vacant) and `stepRank > limitRank` (defensive re-check); select candidates, filter `isActive`; empty → `skipped.push({ requiredPositionId, reason: 'VACANT_POSITION' })`; else push step with copied ids → no steps left → `{ state: 'COMPLETED_NO_ELIGIBLE_STEPS', completionReason: 'NO_ELIGIBLE_APPROVAL_STEPS' }` → else `PENDING`. Plans are deep-frozen; candidate ids copied. Persistence writes the instance row (with restart provenance fields when superseding), one candidate group + captured display names per step, one `SNAPSHOT_GROUP` approval row per step (`requiredPositionId` + `candidateGroupId` set), skip audit rows, and the group-less approved self row for AUTO_APPROVED; `attempt = max(prior)+1`; serialization conflicts surface as `ApprovalEngineConflictError` with no retry. Custom chains are NOT built here (Task 6).

- [ ] **Step 1: Failing tests** (structural fakes only; no Prisma): (1) origin at limit rank → AUTO_APPROVED, zero steps; (2) step at/below origin rank excluded from steps AND not in `skipped`; (3) vacant step recorded `VACANT_POSITION`; (4) all vacant → `COMPLETED_NO_ELIGIBLE_STEPS` + reason; (5) inactive candidates excluded, all-inactive group = VACANT; (6) **team-member origin (option A)**: fake origin path with `teamId` set and `steps = [reports-to, own-unit manager, ancestor manager]`, fake `loadOwnTeamActiveAssignments` returning two members → plan steps carry own-team exact-position candidates plus path persons, deduped, no sibling-team ids; (7) persistence fake: one group per step with copied labels, skip rows, attempt increments across prior attempts, restart provenance copied when the plan supersedes.
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): immutable instance builder and snapshot persistence (option A)"`.

**Review gate B4:** reviewer confirms the builder never writes, auto-approve only at/above limit for normal routes, test 2 distinguishes "not required" from "vacant", and test 6 exercises the confirmed team traversal end-to-end.

---

### Task 5: First-decision-wins decisions and stranded detection

**Files:**
- Create: `src/lib/approval-engine/decisions.ts`
- Test: `tests/regression/clean-start-engine-decisions.test.ts`
- Re-base + delete here: quarantined-equivalent `tests/regression/{request-approval-transaction,approval-concurrency}.test.ts` mechanics move into the new test file; ALSO delete `tests/regression/organization-approval-baseline.test.ts` here — it imports the old `transactions.ts`, `createApprovalChain`, legacy `permission-checks` helpers, and `request-approval-transaction` (inspected: 99 department/legacy references), so it breaks at this task's rewrite at the latest. Split its cases: transaction/post-commit/conflict cases re-based into `clean-start-engine-decisions.test.ts` (this task); permission-branch cases are covered by B10's `clean-start-policy.test.ts` (named there); cancellation guards remain covered by the untouched `request-cancellation-transition-guard.test.ts`. Delete the originals in this task with the re-based replacements named; nothing else asserted them.

**Interfaces:**
- Consumes: Task 4 plan types; `RequestStatusConflictError` from the existing `@/lib/request-status-transition`; `CURRENT_INSTANCE_ROW_FILTER` from the existing `@/lib/approval-engine/current-instance` (retained — it is dependency-free and still correct).
- Produces:

```ts
// src/lib/approval-engine/decisions.ts
export interface ApprovalEligibility {
  canApprove: boolean
  approvalId?: string
  routingMode?: 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  reason?: 'UNAUTHENTICATED' | 'INACTIVE_USER' | 'WRONG_STATUS' | 'NOT_CURRENT_STEP' | 'NOT_CANDIDATE' | 'CUSTOM_MISMATCH'
}
export interface ApprovalTransactionDb {
  loadApprovalForUpdate(input: { approvalId: string; phase: ApprovalPhase }): Promise<ApprovalRowForTransaction | null>
  isActiveUser(userId: string): Promise<boolean>
  hasEarlierPendingRow(input: { requestId: string; solutionId: string | null; instanceId: string | null; phase: ApprovalPhase; order: number }): Promise<boolean>
  updatePendingApproval(input: { approvalId: string; actorId: string; phase: ApprovalPhase; instanceId: string | null; expectedRequestStatus: RequestStatus }): Promise<{ count: number }>
  recordApprovalActivity(input: { approvalId: string; actorId: string; comments?: string }): Promise<void>
  countPendingApprovals(input: { requestId: string; solutionId: string | null; instanceId: string | null; phase: ApprovalPhase }): Promise<number>
  advanceRequestStatus(input: { requestId: string; from: RequestStatus; to: RequestStatus }): Promise<void>
  setInstanceOutcome(input: { instanceId: string; outcome: 'APPROVED' | 'REJECTED' | 'CANCELLED' }): Promise<void>
}
export async function evaluateApprovalEligibility(db: ApprovalTransactionDb, input: { approvalId: string; actorId: string; phase: ApprovalPhase }): Promise<ApprovalEligibility>
export async function advanceApprovalTransaction(db: ApprovalTransactionDb, input: { approvalId: string; actorId: string; phase: ApprovalPhase; comments?: string }): Promise<{ actualActorId: string; routingMode: 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'; pendingApprovals: number; statusChange?: { from: RequestStatus; to: RequestStatus } }>
export function isAttemptStranded(instance: { candidateGroups: ReadonlyArray<{ members: ReadonlyArray<{ userId: string; user: { isActive: boolean } }> }> }): boolean
```

`ApprovalRowForTransaction` keeps the prior shape minus `requiredLevel` and the `LEGACY_LEVEL` mode member. Port the guarded-update mechanics from `src/lib/approval-engine/transactions.ts` at 7abcdf3 (lines 1–848): count-based optimistic `updatePendingApproval` (0 rows → conflict "no longer pending or changed concurrently"), `NOT_CURRENT_STEP` earlier-pending check, `INACTIVE_USER` fail-closed, `NOT_CANDIDATE` group-membership check, phase status transitions, instance outcome with `SUPERSEDED` never erasing terminal states, rejection closing the attempt for revision. REMOVED: every LEGACY_LEVEL branch and `evaluateLegacyEligibility`. `isAttemptStranded` is read-only: every member of every current-step candidate group inactive.

- [ ] **Step 1: Failing tests** — two concurrent `advanceApprovalTransaction` on one pending row: first succeeds, second throws `RequestStatusConflictError`; out-of-order step decision → `NOT_CURRENT_STEP`; inactive actor → `INACTIVE_USER`; non-member → `NOT_CANDIDATE`; rejection sets instance `REJECTED` and returns the request for revision; `isAttemptStranded` true only when ALL members of ALL current groups are inactive.
- [ ] **Step 2: RED.** **Step 3: Implement** (port + prune). **Step 4: GREEN** + `npm run check` (with the two quarantined originals now deleted — list them in the commit message). **Step 5: Commit** `git commit -am "feat(clean-start): first-decision-wins decisions; re-base transaction/concurrency suites"`.

**Review gate B5:** reviewer diffs the port against the deleted quarantined originals and confirms ONLY legacy branches were removed; confirms the two deletions are named with their re-based replacements.

---

### Task 6: Phase origins, attempt creators, submission gate, workflow rewiring

**Files:**
- Create: `src/lib/approval-engine/attempts.ts`
- Modify: `src/server-actions/requests.ts` (`createRequest`), `src/server-actions/solutions.ts` (`submitSolution`, `resubmitSolution`, `initiateFinalApproval`), `src/server-actions/approvals.ts` (attempt-creation and decision call sites → Task 4/5 modules)
- Delete here: `src/lib/approval-rollout.ts` and every `getApprovalRolloutMode`/env usage in `requests.ts`/`solutions.ts` (grep-verified; `phase-adapters.ts` still imports it — that legacy file is deleted in B15, so if the grep still shows it, leave `approval-rollout.ts` in place and delete it in B15 instead — record which branch happened)
- Delete here: `tests/regression/organization-rollout.test.ts` (asserts rollout modes/env behavior replaced by readiness validation from A7)
- Test: `tests/regression/clean-start-attempts.test.ts`, `tests/regression/clean-start-submission-gate.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5; A5/A6.
- Produces:

```ts
// src/lib/approval-engine/attempts.ts
export async function resolvePhaseOrigin(db: PhaseOriginRepository, query: PhaseOriginQuery): Promise<PhaseOrigin>
// PhaseOriginRepository = structural port over requests/solutions + ReportingPathRepository (A6).
// REQUEST origin = stored requests.requesterId; SOLUTION origin = stored solutions.submittedById
// (never an authorized reviser; mismatched trusted input rejected); FINAL origin = authenticated
// trusted initiator input.
export async function createRequestApprovalAttempt(tx, input: BuildApprovalInstanceInput): Promise<PhaseAttemptResult>
export async function createSolutionApprovalAttempt(tx, input: BuildApprovalInstanceInput): Promise<PhaseAttemptResult>
export async function createFinalApprovalAttempt(tx, input: BuildApprovalInstanceInput): Promise<PhaseAttemptResult>
export async function createCustomPersonAttempt(tx, input: { requestId?: string; solutionId?: string; phase: ApprovalPhase; orderedApproverIds: readonly string[]; actorId: string }): Promise<PhaseAttemptResult>
export function canSubmitRequests(input: { isActiveUser: boolean; hasActiveAssignment: boolean }): boolean
```

`createRequest` gate: active user + active assignment (`canSubmitRequests`), sets `requests.organizationUnitId` from the assignment unit, creates the REQUEST attempt in the same `Serializable` transaction. `submitSolution` requires `canWorkOnSolutions(units, actorAssignment.unitId)` AND status/visibility guards. `initiateFinalApproval` keeps the typed-unit rule re-based (initiator holds an active assignment in the request's originating unit — retained from the approved 2026-09-05 redesign; see index note O3). Custom chains: `CUSTOM_PERSON`, ordered `requiredApproverId` rows, never auto-approve, skip route resolution.

- [ ] **Step 1: Failing tests** — submission gate positive/negative (active+assigned / inactive / unassigned); solution attempt origin = stored submitter even when `originUserId` names a reviser (mismatch rejected); final origin = trusted initiator; custom attempt rows carry `requiredApproverId`, never AUTO_APPROVED; `createRequest` sets `organizationUnitId` (fake tx records).
- [ ] **Step 2: RED.** **Step 3: Implement + rewire.** **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): phase origins, custom chains, assignment submission gate; drop rollout modes"`.

**Review gate B6:** reviewer confirms no per-user submission checkbox exists (`grep -rn "canSubmit\b|submitPermission" src/` returns only the new gate), Solution origin follows the stored submitter, and the rollout deletion (or its deferred-to-B15 record) is grep-verified.

---

### Task 7: Admin-only stranded-attempt restart

**Files:**
- Modify: `src/server-actions/approvals.ts`
- Test: `tests/regression/clean-start-restart-stranded.test.ts`

**Interfaces:**
- Consumes: Tasks 4–6; `requireAdmin`.
- Produces:

```ts
export interface ReplacementChainPreview {
  routeVersionId: string | 'DRAFT'; scopeUnitId: string; phase: ApprovalPhase; autoApproved: boolean
  steps: ReadonlyArray<{ order: number; requiredPositionId: string; candidates: ReadonlyArray<{ id: string; name: string }>; skipped: boolean }>
}
export async function previewReplacementChain(input: { instanceId: string }): Promise<ReplacementChainPreview>
export async function restartStrandedAttempt(input: { instanceId: string; reason: string }): Promise<{ oldInstanceId: string; newInstanceId: string }>
```

`restartStrandedAttempt`: `requireAdmin`; non-empty trimmed `reason`; verifies `isAttemptStranded`; sets old instance `supersededAt` PRESERVING its state and decision rows; creates a new attempt via Task 4/5 from CURRENT organization settings (`attempt = old.attempt + 1`, `restartOfInstanceId`, `restartReason`, `restartedById`); grants no approval; audit row in `request_activities`. `previewReplacementChain` is the required read-only preview.

- [ ] **Step 1: Failing tests** — non-admin rejected; empty reason rejected; non-stranded rejected; stranded → old superseded with decisions unchanged, new instance with provenance and attempt+1; chained restart works (attempt+2).
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN.** **Step 5: Commit** `git commit -am "feat(clean-start): admin-only stranded-attempt restart with reason and preview"`.

**Review gate B7:** reviewer confirms restart grants nothing and preserves history.

---

### Task 8: Sharing-scope visibility predicate (module)

**Files:**
- Create: `src/lib/request-visibility/scope.ts`
- Test: `tests/regression/clean-start-visibility-scope.test.ts`

**Interfaces:**
- Consumes: A5 `sharingScopeUnitIds`; B1 models.
- Produces:

```ts
// src/lib/request-visibility/scope.ts
export interface RequestVisibilityActor {
  id: string; role: 'admin' | 'general_dept' | 'engineering'; isActive: boolean
  assignmentUnitId: string | null
  sharingScopeUnitIds: readonly string[]   // downward-inclusive, child scopes included
  managedUnitIds: readonly string[]        // descendants of the unit this actor manages (≤ 1 unit)
}
export interface RequestVisibilityDb {
  findActor(userId: string): Promise<RequestVisibilityActor | null>
  findRequest(where: import('prisma/prisma-client').Prisma.requestsWhereInput): Promise<{ id: string } | null>
}
export async function buildRequestVisibilityWhere(db: RequestVisibilityDb, options: { userId: string; includeArchived: boolean }): Promise<Prisma.requestsWhereInput>
export async function canViewRequestByPredicate(db: RequestVisibilityDb, userId: string, requestId: string): Promise<boolean>
```

(Import `Prisma` types from `@prisma/client` as the existing predicate does.) Predicate: missing/inactive actor → empty; admin → base; else OR of `requesterId`, `organizationUnitId IN (sharingScopeUnitIds ∪ managedUnitIds)`, approval participants (`approverId`/`requiredApproverId`/candidate-group membership, request and solution sides, current-instance filter). The `engineering` ROLE grants NO blanket visibility.

- [ ] **Step 1: Failing tests** — the spec matrix with fake actors: Pat (Operations scope) sees Section A and B requests; Alice (Section A) not B; Bob (B) only B; a unit manager sees descendant-unit requests outside their sharing scope; engineering-role user without overlap sees nothing beyond relationships; `includeArchived: true` still finds archived (archive is a list filter); soft-deleted never visible.
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): downward-inclusive sharing visibility predicate"`.

**Review gate B8:** reviewer re-derives Pat/Alice/Bob from the spec and confirms visibility grants no mutation authority.

---

### Task 9: Visibility caller rewiring and legacy predicate removal

**Files:**
- Modify (exact caller set, grep-verified at 7abcdf3): `src/app/(dashboard)/engineering/page.tsx`, `src/app/api/files/download/route.ts`, `src/lib/inline-images/lifecycle.ts`, `src/server-actions/{analytics,budget-control,dashboard,engineering-sub-tasks,files,reports,request-action-capabilities,requests,solutions}.ts`
- Delete here (only after the grep below returns zero importers): `src/lib/request-visibility/predicate.ts`, `src/lib/request-visibility/types.ts`, `src/lib/request-access.ts`
- Delete/re-base here: `tests/regression/request-visibility.test.ts` and `tests/regression/private-file-access.test.ts` legacy branches → re-based into `tests/regression/clean-start-visibility-callers.test.ts`; delete the originals in this task with the re-based replacements named
- Test: `tests/regression/clean-start-visibility-callers.test.ts`

**Interfaces:**
- Consumes: Task 8.
- Produces: every visibility decision in the app flows through `scope.ts`; old predicate files gone (or their retention recorded with the remaining importer named, deletion deferred to B15).

- [ ] **Step 1: RED baseline** — `grep -rln "createRequestVisibilityDb|canUserViewRequest|buildRequestVisibilityWhere" src/` (14 files at 7abcdf3) recorded as the rewiring checklist.
- [ ] **Step 2: Rewire** each caller to the new actor/predicate (the new module's `findActor` reads users + assignments + units + managed units from the additive schema).
- [ ] **Step 3: GREEN** — `npm run check` passes; rerun the grep: only `scope.ts` (and any file explicitly recorded) remains.
- [ ] **Step 4: Commit** `git commit -am "refactor(clean-start): rewire visibility callers to sharing-scope predicate; remove legacy predicate"`.

**Review gate B9:** reviewer independently reruns the grep, confirms each deleted test's replacement exists, and that no caller kept department/role-based visibility.

---

### Task 10: Action policy, capabilities, and file access

**Files:**
- Rewrite in place (with ALL compile-time importers updated in this task): `src/lib/permission-checks.ts`, `src/lib/action-permissions.ts`, `src/server-actions/request-action-capabilities.ts`, `src/server-actions/files.ts`, `src/lib/modal-data-adapters.ts`
- Delete/re-base here: `tests/regression/organization-approval-{authorization,request-actions,solution-actions,final-actions}.test.ts` and `tests/regression/approval-action-pending-state.test.ts` legacy branches → re-based into `tests/regression/clean-start-policy.test.ts`; originals deleted here with replacements named
- Test: `tests/regression/clean-start-policy.test.ts`, `tests/regression/clean-start-files-access.test.ts`

**Interfaces:**
- Consumes: Task 8; A5 `canWorkOnSolutions`.
- Produces (removed: `canUserApproveAtLevel`, department-typed `canUserSubmitSolution`/`canUserSubmitFinalApproval`):

```ts
export function canSubmitSolutionWork(input: { isActive: boolean; assignmentUnitId: string | null; units: readonly OrganizationUnitNode[] }): boolean
export function canInitiateFinalApproval(input: { isActive: boolean; assignmentUnitId: string | null; requestOriginUnitId: string }): boolean
// action-permissions inputs switch from departmentType/userDepartmentId to assignmentUnitId + units + requestOriginUnitId;
// evaluateRequestAction and CURRENT_STEP_ACTIONS gating unchanged.
```

`files.ts` inline actor placeholders (7abcdf3 lines 99/214) replaced by the Task 8 actor builder; attachment authorization = visibility + uploader/engineering-phase rules re-based on assignment. Modal label polish happens in B12; this task only keeps every importer compiling with the new inputs.

- [ ] **Step 1: Failing tests** — solution submit allowed for active assignment under a flagged unit (descendant counts); denied unassigned/inactive/unflagged; final initiation only for active assignment in the request's origin unit; level-based helper gone (compile-red); attachment download allowed exactly when the visibility predicate allows the parent request (reuse the B8 actor matrix).
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): assignment-based action policy and file access"`.

**Review gate B10:** reviewer confirms the `engineering` ROLE remains only for engineer-assignment/sub-task administration (application permission), never for solution-work eligibility or visibility.

---

### Task 11: Participants-only notifications with explicit participant membership

**Files:**
- Create: `src/lib/request-participants.ts`
- Rewrite: `src/lib/notification-recipients.ts`, `src/lib/post-commit-notifications.ts`, relevant blocks of `src/server-actions/notifications.ts` and `src/server-actions/approvals.ts` (`notifyRequestStatusChange`, `notifyNextApprover`)
- Delete here: `notifyUsersInDepartment` (notifications.ts 462–530), the `'department'` target of `PostCommitNotificationPlan`/collector/dispatchers, `resolveStatusBroadcastRecipients`, `findReviewedSectionRecipientIds`, `findLegacyApproverIds`; `tests/regression/notification-compatibility.test.ts` re-based into `tests/regression/clean-start-participants.test.ts` (original deleted, replacement named)
- Test: `tests/regression/clean-start-participants.test.ts`, `tests/regression/clean-start-notifications.test.ts`

**Interfaces:**
- Consumes: B5 current-instance filter; B1 models.
- Produces:

```ts
// src/lib/request-participants.ts
export interface RequestParticipantMembership {
  requesterId: string                        // requests.requesterId
  solutionSubmitterIds: readonly string[]    // solutions.submittedById for the request
  approvalActorIds: readonly string[]        // request_approvals.approverId ∪ requiredApproverId (non-null), current + historical
  solutionApprovalActorIds: readonly string[]// solution_approvals same
  candidateMemberIds: readonly string[]      // approval_candidate_group_members.userId via CURRENT-instance rows (all steps)
  assignedEngineerIds: readonly string[]     // request_engineer_assignments.engineerId
}
export async function resolveRequestParticipants(db: RequestParticipantsDb, requestId: string): Promise<RequestParticipantMembership>
```

**Participant membership is defined from existing production participant evidence only** (inspected at 7abcdf3): today's user-targeted notifications go to exactly — the requester (`requests.requesterId`, approvals.ts 447/568, requests.ts 325/351), per-approval-row actors (`approverId`, custom `requiredApproverId`, and snapshot candidate-group members via `resolveApprovalNeededRecipients`, approvals.ts 536–560), the stored solution submitter, and assigned engineers (`request_assigned`). **Non-members, explicitly:** sharing-scope viewers, unit members, and managers without a candidate/actor row — viewing access never subscribes (O2).

Event mapping (O2): `approval_needed` → CURRENT-step candidate-group members, active only (plus custom `requiredApproverId`); `approval_granted` → requester + next-step candidates; `approval_rejected` → requester (+ decided actor); `status_changed` → requester; `request_assigned` → assigned engineers + requester; `solution_ready` → requester + solution submitter; `final_approval_needed` → FINAL current-step candidates. The former engineering-department "New Task Available" broadcast is REMOVED (it is exactly the unit-wide broadcast O2 forbids); solution staff discover available work through request lists (visibility), not push notifications — recorded as consequence note N1 in the index.

- [ ] **Step 1: Failing tests** — participants: fake db returns the exact membership union; approval_needed notifies every current-step active candidate (multiple holders all notified, deduped); inactive member excluded; superseded-instance rows produce no recipients; status change notifies requester + prior actors, NEVER sharing-scope viewers (a viewer-with-no-relationship actor receives nothing — explicit negative test); `notifyUsersInDepartment` no longer exists (compile-red).
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "feat(clean-start): participants-only notifications with explicit membership; remove broadcasts"`.

**Review gate B11:** reviewer confirms the participant definition cites only production-evidenced relationships, the viewer-receives-nothing negative test exists, and the post-commit plan type has no department target.

---

### Task 12: Remaining legacy consumer sweep

**Files (exact paths inspected at 7abcdf3):**
- `src/server-actions/requests.ts` (filters 392–393, includes 459–481/649/781, approver lookups 572–576/868–875), `src/server-actions/solutions.ts` (58 refs), `src/server-actions/dashboard.ts` (26/65–83/111/133/246–251/279/308/407–412), `src/server-actions/analytics.ts` (49/67/82), `src/server-actions/budget-control.ts`, `src/lib/budget-control.ts` (19 refs), `src/lib/export.ts` (17/47–48/88/160–161), `src/lib/request-export.ts`, `src/lib/pdf.ts` (3 refs), `src/lib/follow-up-dashboard.ts` (4 refs), `src/lib/workflow-pipeline.ts`, `src/server-actions/{audit,auth,users,engineering-sub-tasks,reports}.ts` (users 16 refs), `src/lib/auth-config.ts` (session `departmentId` 21–41/73–94/112–132 → role-only session), `src/app/(dashboard)/approval-chain/page.tsx` (13/25/30), `src/components/requests/` (`request-detail-modal.tsx` incl. its `/api/departments/${departmentId}/users` fetch at 275–277, `request-filters.tsx` 22/137, `final-approval-resubmit-modal.tsx` 87/341/422, `submitter-modal.tsx`, `solution-modal.tsx`, `final-approval-modal.tsx`, `submit-final-approval-modal.tsx`, `requests-list-client.tsx`, `requests-list-with-filters.tsx`, `approval-status-badge.tsx`, `request-modal-router.tsx`), `src/lib/approver-search.ts` (drop `level`)
- Create: `src/app/api/organization/unit-users/route.ts` (GET `?unitId=` → active assignees of the unit subtree `{ id, name, email, positionName, unitPathNames }[]`, authorized by the Task 8 predicate — replaces the deleted `/api/departments/[departmentId]/users` fetch), `src/lib/unit-labels.ts` (`export function unitPathNames(units: readonly OrganizationUnitNode[], unitId: string): string[]`, root-last display)
- Delete/re-base here: `tests/regression/approver-department-labels.test.ts` (modal/approver labels it asserts are replaced in this task). `tests/regression/organization-approval-baseline.test.ts` is NOT deleted here — it was deleted in B5 (see above). `tests/regression/department-levels.test.ts` is NOT deleted here — it still passes against the existing departments actions and is deleted in Plan C Task 1 when those actions are removed.
- Test: `tests/regression/clean-start-consumers.test.ts`

- [ ] **Step 1: Failing tests** — unit-subtree filter builder; `unitPathNames` output; the unit-users route handler with a fake db. Supplementary tripwire: `execSync` grep asserting `departmentId|department_approvers|user\.level\b` has ZERO matches in `src/` after the sweep.
- [ ] **Step 2: RED.** **Step 3: Implement** file by file; the grep is authoritative — any file it reveals beyond the inventory is added to this task's list BEFORE being changed. **Step 4: GREEN** + `npm run check`. **Step 5: Commit** `git commit -am "refactor(clean-start): unit-based consumers replace department/level paths everywhere"`.

**Review gate B12:** reviewer independently reruns the grep on a clean checkout, spot-checks analytics/export/dashboard parity, and confirms every deleted test has a named replacement.

---

### Task 13: Disposable-CI constraint and race verification

**Files:**
- Create: `tests/integration/clean-start-constraints.integration.test.ts`, CI workflow file (inspect the repo for the existing CI location before creating)

**Interfaces:**
- Consumes: B1 migration SQL; B4/B5 semantics.
- Produces: CI-only suite verifying (1) `one_active_assignment_per_user` rejects a second active assignment; (2) `one_active_company_root` rejects a second active root (constant-expression index); (3) `one_published_route_per_scope_phase` rejects a concurrent second publisher; (4) first-decision-wins under true PostgreSQL concurrency (two pinned interactive transactions; second gets the conflict); (5) FK `Restrict` on position references blocks hard deletes; (6) restart self-relation preserves the old row. Copy the discipline from `tests/integration/organization-approval-constraints.integration.test.ts` lines 1–64: self-skip without `CLEAN_START_CI_DATABASE_URL`, hard error if it equals `DATABASE_URL`, pinned per-participant transactions, cleanup registered before first write, FK-safe reverse deletion.

- [ ] **Step 1: Write the suite** (cannot run locally by design). **Step 2: Verify local self-skip** — `portly temp 'npx tsx --test tests/integration/clean-start-constraints.integration.test.ts'` → all blocks skipped, exit 0, zero connections. **Step 3: Commit** `git commit -am "test(clean-start): disposable-CI SQL constraint and race verification"`.

**Review gate B13:** reviewer confirms the suite cannot touch any local database and CI wiring points only at the disposable CI database.

---

### Task 14: Browser verification of the integrated flow

**Files:**
- Create: `tests/e2e/clean-start-approval-flow.spec.ts`, `tests/e2e/clean-start-sharing-visibility.spec.ts`
- Modify: `prisma/seed.ts` — extend (idempotent upserts) with the clean-start fixture: company root, Operations + sharing-enabled Sections A/B (+ `section-a-child`), positions Staff/Lead/Manager/Director, assignments for Pat (Operations), Alice (A), Bob (B), a manager chain, one team in Section A with a reports-to person distinct from the unit manager (exercises option A), and one published root default route per phase. Legacy seed rows stay until B15.

- [ ] **Step 1:** `npm run build` via Portly (40m) — REQUIRED pass.
- [ ] **Step 2:** seed `app_cleanstart_dev` ONLY (`.env` guard), run dev on 3100, run both specs. Spec 1 (approval flow): Alice submits → the option-A path resolves (own-team exact-position candidate when configured, reports-to, own-unit manager, ancestors — assertions on which approver sees the action); two candidates both see the action, second click after the first decision yields the conflict message with no double transition; rejection returns for revision; admin restarts a stranded attempt (candidates deactivated first) with reason → new attempt appears, old decisions preserved. Spec 2 (sharing visibility): Pat sees A and B requests; Alice only A; Bob only B; participants-only notifications (Pat receives nothing for a request he merely views — negative assertion via the notifications API/list).
- [ ] **Step 3:** `npm run check` full pass. **Step 4: Commit** `git commit -am "test(clean-start): browser verification of option-A flow, sharing visibility, participants-only notifications"`.

**Review gate B14:** independent reviewer replays both specs headed or reads the HTML report; confirms build log; confirms the manual-test worktree and both protected databases untouched (`git worktree list`, `portly status`, read-only `psql -l`).

---

### Task 15: Schema finalization — drop legacy, tighten, squash

**Files:**
- Modify: `prisma/schema.prisma` (removals + NOT-NULL tightening), `prisma/seed.ts` (strip legacy department/level seeding)
- Create: squashed `prisma/migrations/00000000000001_clean_start_init/migration.sql` (replaces the interim additive migration); delete the interim migration dir
- Delete (each only after its grep shows zero importers; the expected last importers are `src/server-actions/approval-routes.ts` — rewritten in Plan C Task 9 — so if Plan C has not run, record the deferral and delete there instead): `src/lib/approval-engine/{instances,phase-adapters,phase-origin,candidate-groups,legacy,transactions}.ts` (any not already deleted), `src/lib/organization/{types,tree,repository,mapping}.ts`, `src/lib/approval-routes/{types,validation,resolver}.ts`, `src/lib/approval-levels.ts`, `src/lib/approval-rollout.ts` (if still present), `scripts/organization-import-dry-run.ts`, `scripts/apply-reviewed-organization-mapping.ts`, `tools/organization-mapping-schema.ts`, `prisma/migrations/20260905000000_organization_approval_redesign/`
- Test: extend `tests/regression/clean-start-schema.test.ts` with the REMOVAL assertions (legacy models/columns/enums absent from DMMF)

**Interfaces:**
- Consumes: B1–B14.
- Produces: the final clean schema — legacy models (`departments`, `department_approvers`, `hierarchy_change_logs`, `organization_import_runs`, `reporting_groups`, `reporting_group_members`, `organization_position_assignments`), columns (`users.departmentId`, `users.level`, `requests.departmentId`, `budget_codes.departmentId`, `organization_units.{unitType,legacyDepartmentId,operationalType}`, `approval_route_versions.maximumPositionLevel`, `approval_route_steps.positionCode`, `approval_instances` legacy context, `request_approvals`/`solution_approvals.{requiredLevel,requiredPosition,isCustomChain,integrityVersion}`), and enums (`DepartmentType`, `OrganizationUnitType`, `OrganizationPositionCode`, `ApprovalRoutingMode.LEGACY_LEVEL`) removed; staged columns tightened to required (`approvalLimitPositionId`, `approval_route_steps.positionId`, `approval_instances.{originAssignmentId,originPositionId}`, `approval_instance_skips.requiredPositionId`, `approval_candidate_groups.requiredPositionId`, approval-row `requiredPositionId` for SNAPSHOT_GROUP rows via CHECK).

- [ ] **Step 1: RED** — add the removal assertions (from the original Plan A Task 1 design: `departments` absent, `users.departmentId` absent, `ApprovalRoutingMode` values exactly `['CUSTOM_PERSON','SNAPSHOT_GROUP']`, …). Expected FAIL while legacy persists.
- [ ] **Step 2: Implement** removals + tightening; regenerate the squashed init migration: `portly temp 'npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/init.sql'` then hand-append the partial indexes + row-mode CHECKs; replace the migrations directory with the single init migration; `npx prisma db push` to the FRESH dev DB only (recreate `app_cleanstart_dev` contents via seed — never touch protected DBs).
- [ ] **Step 3: GREEN** — schema test (presence + removal) PASS; `npm run check` PASS; `npm run build` PASS; re-run the B13 CI suite against the squashed migration in disposable CI.
- [ ] **Step 4: Commit** `git commit -am "feat(clean-start): finalize schema — drop legacy models, tighten staged columns, squash init migration"`; `graphify update . --force`.

**Review gate B15 (Plan B exit):** reviewer confirms: no interim migration artifacts remain; the squashed migration carries both partial indexes and the CHECK constraints; every deleted lib file's grep is zero-match (with any recorded deferral to Plan C justified by a named importer); full check/build green; protected databases and ports 3000/3001/3002 untouched.

---

## Plan B → Plan C handoff interfaces (exact)

- `resolvePublishedApprovalRoute`/`selectNearestRoute` (B2) for the workspace's route-source walk and "Test with a submitter" (Plan C Task 9 wraps them in a server action).
- `assessPositionRankChange` (A4) and `findLimitConflicts` (B2) for rank/limit blocking UX (Plan C Tasks 8–9).
- `restartStrandedAttempt` + `previewReplacementChain` (B7) for the restart dialog (Plan C Task 9).
- `verifyCleanStartReadiness` (A7) for workspace readiness banners (Plan C Task 1).
- `resolveRequestParticipants` (B11) if the UI surfaces notification audiences.
