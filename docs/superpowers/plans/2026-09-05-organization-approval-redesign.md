# Organization Approval Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review status:** Parent-reviewed on 2026-09-05; findings and corrections recorded in `docs/superpowers/plans/2026-09-05-organization-approval-redesign-review.md`. Planning is complete; implementation has not been authorized or performed. Parent-unit action/audience generalization is explicitly disclosed for the execution handoff.

**Goal:** Separate reporting organization, versioned approval routes, and immutable approval attempts while preserving the existing request, solution, final-approval, permission, visibility, notification, and legacy in-flight behavior.

**Architecture:** Add a typed Factory → Division → Department → Section organization tree, explicit position assignments and reporting groups, then resolve one published route version from the phase initiator's nearest applicable ancestor scope. New attempts persist their route context, skipped positions, and deduplicated candidate groups; legacy rows are selected by an explicit legacy discriminator and continue through the old numeric-level semantics. Shared visibility and action-policy adapters sit independently of routing, and notification adapters preserve existing events, channels, custom notify-all behavior, and section-wide broadcasts.

**Tech Stack:** Next.js 15.5.23, React 19, TypeScript 5 strict mode, Prisma 6.1 PostgreSQL, Zod 4, Node's `node:test` through `tsx`, existing post-commit notification dispatcher, and the repository's Portly execution workflow.

**Spec:** `docs/superpowers/specs/2026-09-05-organization-approval-redesign-design.md`

## Global Constraints

- Implement only the approved requirements in `docs/superpowers/specs/2026-09-05-organization-approval-redesign-design.md`; the spec is approved for planning, not implementation authorization.
- Keep positions exactly `Staff (1)`, `Supervisor (2)`, `Section Manager (3)`, `Department Manager (4)`, `Division Manager (5)`, and `Factory Manager (6)`; system roles remain separate from positions.
- Treat existing departments as future sections only through an external, reviewed mapping. Never infer organizational type from a name and never compress legacy levels 1–10 without an explicit reviewed mapping.
- A normal route may contain explicit upward positions with gaps, and configured positions must not exceed the ceiling. At resolution, exclude positions at or below the particular initiator; reusable definitions remain valid for higher-position submitters. Do not add financial thresholds, value rules, subscriptions, retries, or new email behavior.
- Use nearest-ancestor scope precedence: walk the phase origin's section, department, division, and factory ancestors in that order; use the first scope with exactly one published route for the phase. Ambiguous origin assignments and missing routes are configuration errors.
- Enforce one published route version per `(scopeUnitId, phase)` with a database partial unique index. Publishing creates a new immutable version; it never edits a version used by an attempt.
- NEW normal instances fully snapshot each current-step candidate group. Candidate membership is never live-replaced; a current inactive candidate cannot act, notify, or cause automatic approval of the remaining step. No candidate-reassignment UI is in scope.
- Preserve the existing request, solution, and final status transitions, ownership checks, custom ordered person chains, custom exceptions to upward routing and auto-approval, and request-create behavior with no custom picker.
- Preserve all existing notification events, channels, custom solution notify-all-at-submit and custom final first-step-only behavior, and section-wide status broadcasts. Existing department audiences map to future sections without adding descendants or ancestor managers to the audience. Legacy in-flight rows retain legacy recipient and action semantics.
- Keep view authorization, action authorization, and UI button visibility separate. A globally visible request is not automatically actionable.
- No production migration, migration deploy, server, build, staging, commit, or nested worker is run from this documentation task. Future source work uses one writer in an isolated worktree.
- Future checks run through Portly. Define `EXECUTION_WORKTREE` as the real isolated worktree path before each command, run `portly status`, create `job_id="$(portly temp '<command>' --path "$EXECUTION_WORKTREE" --timeout 30m)"`, then run `portly wait "$job_id"`. `npm run check` is required after source changes. Run `graphify update .` after implementation changes from the execution worktree.

---

## Execution order and file map

Execute in dependency order: **1 → 2 → 3 → 4 → 5 → 7 → 6 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16**. Task 6 preview consumes Task 7 resolution. Each completed task must leave its tests and `npm run check` passing; no deliberate failures may be carried into a later task. The first task locks the behavioral baseline before any replacement of the numeric engine. Schema and pure domain tasks precede server-action integration; visibility and notification adapters are then wired into every caller; UI and rollout come last.

| Area | Files and responsibility |
|---|---|
| Baseline | `tests/fixtures/organization-approval-fixtures.ts`, `tests/regression/organization-approval-baseline.test.ts` characterize current chains, custom exceptions, statuses, notifications, and transaction boundaries. |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20260905000000_organization_approval_redesign/migration.sql` add typed units, reporting groups, routes, instances, snapshots, and the legacy discriminator without mapping production data. |
| Organization domain | `src/lib/organization/types.ts`, `src/lib/organization/tree.ts`, `src/lib/organization/repository.ts`, `src/lib/organization/mapping.ts` own position levels, cycle checks, branch scope, and reviewed mapping validation. |
| Dry-run import | `tools/organization-mapping-schema.ts`, `scripts/organization-import-dry-run.ts` read legacy data plus an explicit mapping and emit a report without writing. |
| Route domain | `src/lib/approval-routes/types.ts`, `src/lib/approval-routes/validation.ts`, `src/lib/approval-routes/resolver.ts`, `src/lib/approval-routes/preview.ts`, `src/server-actions/approval-routes.ts` own versions, precedence, publication, and previews. |
| Approval engine | `src/lib/approval-engine/types.ts`, `src/lib/approval-engine/phase-origin.ts`, `src/lib/approval-engine/candidate-groups.ts`, `src/lib/approval-engine/instances.ts`, `src/lib/approval-engine/legacy.ts`, `src/lib/approval-engine/transactions.ts` own phase origins, snapshots, attempt history, compatibility selection, and atomic advancement. |
| Workflow adapters | Modify `src/server-actions/approvals.ts`, `src/server-actions/requests.ts`, and `src/server-actions/solutions.ts` only after the engine interfaces exist; preserve phase-specific status and action semantics. |
| Visibility | `src/lib/request-visibility/types.ts`, `src/lib/request-visibility/predicate.ts`, and the public wrapper `src/lib/request-access.ts` define one predicate. Modify all listed request, dashboard, analytics, budget, file, inline-image, report, and export callers. |
| Permissions | `src/lib/action-permissions.ts`, `src/lib/permission-checks.ts`, server action guards, and `src/components/requests/request-modal-router.tsx` keep action decisions separate from view and button gating. |
| Notifications | `src/lib/notification-recipients.ts` and `src/server-actions/notifications.ts` provide snapshot, legacy, custom, and section-audience adapters while retaining `src/lib/post-commit-notifications.ts`. |
| Admin UI | `src/server-actions/organization.ts`, `src/app/admin/organization/page.tsx`, `src/components/admin/organization/OrganizationEditor.tsx`, `OrganizationUnitTree.tsx`, `PositionAssignmentTable.tsx`, `ReportingGroupEditor.tsx`, `src/app/admin/routes/page.tsx`, `src/components/admin/routes/RouteEditor.tsx`, `RouteStepList.tsx`, and `RoutePreview.tsx` provide admin organization and route editing. Existing `src/app/admin/hierarchy/page.tsx` and `src/server-actions/hierarchy.ts` become an explicitly legacy compatibility view. |
| Rollout | `src/lib/approval-rollout.ts`, `scripts/verify-organization-rollout.ts`, and `tests/regression/organization-rollout.test.ts` implement shadow/new gating and read-only verification. |

Every future source task below names its exact paths, interfaces, failing test, minimum algorithm, focused check, and expected result. The command examples use repository-relative test paths; Portly's `--path` receives the real value of `EXECUTION_WORKTREE`.

## Task 1: Lock the behavioral baseline before changing routing

**Files:**
- Create: `tests/fixtures/organization-approval-fixtures.ts`
- Create: `tests/regression/organization-approval-baseline.test.ts`
- Read without modifying: `src/server-actions/approvals.ts`, `src/server-actions/requests.ts`, `src/server-actions/solutions.ts`, `src/lib/request-approval-transaction.ts`, `src/server-actions/notifications.ts`, `src/lib/post-commit-notifications.ts`

**Interfaces:**
- Consumes: current `getApprovalLevelsAboveSubmitter`, current source contracts, and the existing request/solution/final status names.
- Produces: `ORGANIZATION_APPROVAL_FIXTURE`, `LEGACY_CHAIN_EXPECTATIONS`, and characterization tests that later tasks must keep green.

- [ ] **Step 1: Write the characterization and target-seam tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getApprovalLevelsAboveSubmitter } from '@/lib/approval-levels'
import { LEGACY_CHAIN_EXPECTATIONS } from '../fixtures/organization-approval-fixtures'

const read = (path: string) => readFileSync(path, 'utf8')

describe('organization approval redesign baseline', () => {
  it('records the occupied legacy ladder and preserves sparse-level arithmetic', () => {
    assert.deepEqual(getApprovalLevelsAboveSubmitter(1, 5), [2, 3, 4, 5])
    assert.deepEqual(
      [2, 3, 4, 5].filter((level) => LEGACY_CHAIN_EXPECTATIONS.sparseLevels.includes(level as 3 | 5)),
      LEGACY_CHAIN_EXPECTATIONS.sparseLevels,
    )
  })

  it('records phase origins, custom exceptions, and existing notification seams', () => {
    const requests = read('src/server-actions/requests.ts')
    const solutions = read('src/server-actions/solutions.ts')
    const notifications = read('src/server-actions/notifications.ts')
    assert.match(requests, /createApprovalChain/)
    assert.doesNotMatch(requests, /CustomApprovalPicker|customApproverIds/)
    assert.match(solutions, /createCustomApprovalChain/)
    assert.match(solutions, /createCustomFinalApprovalChain/)
    assert.match(notifications, /notifyUsersInDepartment/)
  })

})
```

These assertions characterize existing behavior. Add the phase-origin test in Task 7, immediately before implementing that seam. Task 1 does not import future modules.

- [ ] **Step 2: Run the focused baseline test and verify the expected failure boundary**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/organization-approval-baseline.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: before fixtures exist, the fixture import fails; after Step 3 adds them, all characterization assertions pass. No future engine import is present.

- [ ] **Step 3: Add fixtures for all approved matrix actors and preserved transitions**

In `tests/fixtures/organization-approval-fixtures.ts`, export stable IDs for PD1/PD2, each manager scope, Engineering, Admin, a custom cross-check approver, an inactive user, a historical actor, and a null-org user. Include these shared constants and fixture builders:

```ts
export const ORGANIZATION_APPROVAL_FIXTURE = {
  factoryId: 'factory-1',
  divisionId: 'division-1',
  departmentId: 'department-pd',
  sectionId: 'section-pd1',
  siblingSectionId: 'section-pd2',
  requesterId: 'staff-1',
  supervisorId: 'supervisor-1',
  sectionManagerId: 'section-manager-1',
  departmentManagerId: 'department-manager-1',
  factoryManagerId: 'factory-manager-1',
  engineeringId: 'engineer-1',
  inactiveCandidateId: 'inactive-1',
} as const

export const LEGACY_CHAIN_EXPECTATIONS = {
  sparseLevels: [3, 5],
  requestCompletion: { from: 'ImprovementRequest', to: 'SentToEngineer' },
  solutionCompletion: { from: 'DesignCostEstimationApproval', to: 'SendBackToRequester' },
  finalCompletion: { from: 'FinalApproval', to: 'Completed' },
} as const

export function legacyRequestRows(input: {
  requestId: string
  levels: number[]
}): Array<{ requestId: string; requiredLevel: number; order: number; status: 'pending' }> {
  return input.levels.map((requiredLevel, index) => ({
    requestId: input.requestId,
    requiredLevel,
    order: index + 1,
    status: 'pending',
  }))
}

export function phaseStatusExpectation(phase: 'REQUEST' | 'SOLUTION' | 'FINAL'):
  { from: string; to: string } {
  if (phase === 'REQUEST') return { from: 'ImprovementRequest', to: 'SentToEngineer' }
  if (phase === 'SOLUTION') return { from: 'DesignCostEstimationApproval', to: 'SendBackToRequester' }
  return { from: 'FinalApproval', to: 'Completed' }
}
```

The fixture is data only; it must not encode an unreviewed department-to-position mapping or a replacement candidate.

- [ ] **Step 4: Run the characterization subset again**

Run the same Portly command from Step 2 after each fixture/test edit. Expected: all Task 1 assertions pass. Also run `npm run check` via Portly before the task checkpoint.

### Task 1 behavioral baseline acceptance additions

The source assertions above are discovery checks, not sufficient baselines. Use the existing transaction fake pattern from `request-approval-transaction.test.ts` to record writes and notification payloads at existing server-action boundaries. Add named cases for request submit, request resubmit, solution submit/resubmit (custom/normal/auto), final initiate/progress/reject (custom/normal/auto), cancel and completion. Store expected event type, recipient IDs, channel and state transition per case; assert actual recorded calls, not fixture constants.

Expose existing guards through dependency-injected internal helpers only where needed for tests; public action signatures and behavior must not change. Baseline negative cases must cover owner/nonowner, current/wrong status, same-section/unrelated Engineering read-only viewers and assigned/unassigned approvers. Initial red failure is absent test fixture/helper wiring, not a future module dependency.


## Task 2: Add the additive Prisma model and the explicit legacy discriminator

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260905000000_organization_approval_redesign/migration.sql`
- Create: `tests/regression/organization-schema.test.ts`

**Interfaces:**
- Consumes: current `departments`, `User`, `requests`, `request_approvals`, and `solution_approvals` models.
- Produces: Prisma enums `OrganizationUnitType`, `OrganizationPositionCode`, `ApprovalPhase`, `ApprovalRouteStatus`, `ApprovalRoutingMode`, `ApprovalInstanceState`, and `ApprovalSkipReason`; models `organization_units`, `organization_position_assignments`, `reporting_groups`, `reporting_group_members`, `approval_route_versions`, `approval_route_steps`, `approval_instances`, `approval_instance_skips`, `approval_candidate_groups`, and `approval_candidate_group_members`; nullable NEW metadata fields on both approval-row models.

- [ ] **Step 1: Write the schema contract test**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync('prisma/schema.prisma', 'utf8')

describe('organization approval schema contract', () => {
  it('contains separate units, positions, reporting groups, routes, instances, and snapshots', () => {
    for (const name of [
      'organization_units',
      'organization_position_assignments',
      'reporting_groups',
      'reporting_group_members',
      'approval_route_versions',
      'approval_route_steps',
      'approval_instances',
      'approval_instance_skips',
      'approval_candidate_groups',
      'approval_candidate_group_members',
    ]) {
      assert.match(schema, new RegExp(`model ${name} \\{`))
    }
    assert.match(schema, /enum ApprovalRoutingMode \{[\s\S]*LEGACY_LEVEL[\s\S]*SNAPSHOT_GROUP[\s\S]*CUSTOM_PERSON/)
    assert.match(schema, /requiredPosition\s+OrganizationPositionCode\?/)
    assert.match(schema, /candidateGroupId\s+String\?/)
    assert.match(schema, /instanceId\s+String\?/)
  })

  it('keeps the existing numeric level and custom flags for legacy compatibility', () => {
    assert.match(schema, /requiredLevel\s+Int\?/)
    assert.match(schema, /isCustomChain\s+Boolean\s+@default\(false\)/)
    assert.match(schema, /routingMode\s+ApprovalRoutingMode\s+@default\(LEGACY_LEVEL\)/)
  })
})
```

- [ ] **Step 2: Run the schema contract to verify it fails before the additive models exist**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/organization-schema.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the new models and fields are not yet in `prisma/schema.prisma`.

- [ ] **Step 3: Add the exact additive schema**

Use these model boundaries and field meanings in `prisma/schema.prisma`:

```prisma
enum OrganizationUnitType {
  FACTORY
  DIVISION
  DEPARTMENT
  SECTION
}

enum OrganizationPositionCode {
  STAFF
  SUPERVISOR
  SECTION_MANAGER
  DEPARTMENT_MANAGER
  DIVISION_MANAGER
  FACTORY_MANAGER
}

enum ApprovalPhase {
  REQUEST
  SOLUTION
  FINAL
}

enum ApprovalRouteStatus {
  DRAFT
  PUBLISHED
  RETIRED
}

enum ApprovalRoutingMode {
  LEGACY_LEVEL
  SNAPSHOT_GROUP
  CUSTOM_PERSON
}

enum ApprovalInstanceState {
  PENDING
  AUTO_APPROVED
  COMPLETED_NO_ELIGIBLE_STEPS
  APPROVED
  REJECTED
  CANCELLED
  SUPERSEDED
}

enum ApprovalSkipReason {
  VACANT_POSITION
}

model organization_units {
  id                    String                         @id @default(uuid())
  name                  String
  unitType              OrganizationUnitType
  parentId              String?
  legacyDepartmentId    String?                        @unique
  isActive              Boolean                        @default(true)
  operationalType       DepartmentType                  @default(GENERAL)
  createdAt             DateTime                       @default(now())
  updatedAt             DateTime                       @updatedAt
  parent                organization_units?            @relation("organization_units_parent", fields: [parentId], references: [id])
  children              organization_units[]            @relation("organization_units_parent")
  legacyDepartment      departments?                   @relation("organization_units_legacyDepartment", fields: [legacyDepartmentId], references: [id], onDelete: SetNull)
  positionAssignments   organization_position_assignments[]
  reportingGroups       reporting_groups[]
  routeVersions         approval_route_versions[]
  approvalInstances     approval_instances[]
  requests              requests[]

  @@index([parentId])
  @@index([unitType, isActive])
}

model organization_position_assignments {
  id               String                   @id @default(uuid())
  userId           String
  unitId           String
  positionCode     OrganizationPositionCode
  reportingGroupId String?
  isPrimary        Boolean                  @default(false)
  isActive         Boolean                  @default(true)
  createdAt        DateTime                 @default(now())
  updatedAt        DateTime                 @updatedAt
  user             User                     @relation(fields: [userId], references: [id], onDelete: Restrict)
  unit             organization_units       @relation(fields: [unitId], references: [id], onDelete: Restrict)
  reportingGroup   reporting_groups?        @relation(fields: [reportingGroupId], references: [id], onDelete: SetNull)

  @@unique([userId, unitId, positionCode])
  @@index([unitId, positionCode, isActive])
  @@index([userId, isPrimary, isActive])
}

model reporting_groups {
  id                String                         @id @default(uuid())
  unitId            String
  parentGroupId     String?
  name              String
  isActive          Boolean                        @default(true)
  createdAt         DateTime                       @default(now())
  updatedAt         DateTime                       @updatedAt
  unit              organization_units             @relation(fields: [unitId], references: [id], onDelete: Restrict)
  parent            reporting_groups?              @relation("reporting_groups_parent", fields: [parentGroupId], references: [id])
  children          reporting_groups[]             @relation("reporting_groups_parent")
  members           reporting_group_members[]
  positionAssignments organization_position_assignments[]

  @@unique([unitId, name])
  @@index([parentGroupId])
}

model reporting_group_members {
  reportingGroupId String
  userId           String
  createdAt        DateTime        @default(now())
  reportingGroup   reporting_groups @relation(fields: [reportingGroupId], references: [id], onDelete: Cascade)
  user             User             @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@id([reportingGroupId, userId])
  @@index([userId])
}

model approval_route_versions {
  id                   String                   @id @default(uuid())
  scopeUnitId          String
  phase                ApprovalPhase
  version              Int
  maximumPositionLevel Int
  status               ApprovalRouteStatus     @default(DRAFT)
  createdById          String
  createdAt            DateTime                 @default(now())
  publishedAt          DateTime?
  scopeUnit            organization_units      @relation(fields: [scopeUnitId], references: [id], onDelete: Restrict)
  createdBy            User                     @relation(fields: [createdById], references: [id], onDelete: Restrict)
  steps                approval_route_steps[]
  instances            approval_instances[]

  @@unique([scopeUnitId, phase, version])
  @@index([scopeUnitId, phase, status])
}

model approval_route_steps {
  id                String                   @id @default(uuid())
  routeVersionId    String
  stepOrder         Int
  positionCode      OrganizationPositionCode
  createdAt         DateTime                 @default(now())
  routeVersion      approval_route_versions  @relation(fields: [routeVersionId], references: [id], onDelete: Cascade)
  skippedInstances  approval_instance_skips[]

  @@unique([routeVersionId, stepOrder])
  @@unique([routeVersionId, positionCode])
}

model approval_instances {
  id                    String                   @id @default(uuid())
  requestId             String?
  solutionId            String?
  phase                 ApprovalPhase
  routeVersionId        String?
  originUserId          String
  originUnitId          String
  originContext         Json
  routingMode           ApprovalRoutingMode
  state                 ApprovalInstanceState   @default(PENDING)
  attempt               Int                     @default(1)
  completionReason      String?
  createdAt             DateTime                 @default(now())
  supersededAt          DateTime?
  request               requests?               @relation(fields: [requestId], references: [id], onDelete: Cascade)
  solution              solutions?              @relation(fields: [solutionId], references: [id], onDelete: Cascade)
  routeVersion          approval_route_versions? @relation(fields: [routeVersionId], references: [id], onDelete: Restrict)
  originUser            User                     @relation("approval_instances_originUser", fields: [originUserId], references: [id], onDelete: Restrict)
  originUnit            organization_units       @relation(fields: [originUnitId], references: [id], onDelete: Restrict)
  requestApprovals      request_approvals[]             @relation("request_approval_instance")
  solutionApprovals     solution_approvals[]            @relation("solution_approval_instance")
  skips                 approval_instance_skips[]
  candidateGroups       approval_candidate_groups[]

  @@index([requestId, phase, supersededAt])
  @@index([solutionId, phase, supersededAt])
  @@index([routeVersionId])
}

model approval_instance_skips {
  id              String                    @id @default(uuid())
  approvalInstanceId String
  routeStepId     String?
  requiredPosition OrganizationPositionCode
  reason          ApprovalSkipReason
  createdAt       DateTime                  @default(now())
  approvalInstance approval_instances        @relation(fields: [approvalInstanceId], references: [id], onDelete: Cascade)
  routeStep       approval_route_steps?     @relation(fields: [routeStepId], references: [id], onDelete: SetNull)

  @@unique([approvalInstanceId, requiredPosition])
}

model approval_candidate_groups {
  id                String                         @id @default(uuid())
  approvalInstanceId String
  requiredPosition  OrganizationPositionCode
  scopeUnitId       String
  capturedAt        DateTime                       @default(now())
  approvalInstance  approval_instances             @relation(fields: [approvalInstanceId], references: [id], onDelete: Cascade)
  members           approval_candidate_group_members[]
  requestApprovals  request_approvals[]             @relation("request_approval_candidate_group")
  solutionApprovals solution_approvals[]            @relation("solution_approval_candidate_group")

  @@unique([approvalInstanceId, requiredPosition])
  @@index([scopeUnitId])
}

model approval_candidate_group_members {
  candidateGroupId String
  userId           String
  capturedAt       DateTime                    @default(now())
  capturedDisplayName String
  candidateGroup   approval_candidate_groups  @relation(fields: [candidateGroupId], references: [id], onDelete: Cascade)

  @@id([candidateGroupId, userId])
  @@index([userId])
}
```

Add `organizationUnitId String?`, `organizationUnit organization_units?`, and `approvalInstances approval_instances[]` to `requests`; add `organizationUnit organization_units? @relation("organization_units_legacyDepartment")` to `departments`, plus `approvalInstances approval_instances[]` to `solutions` and reverse assignment/route/instance relations to `User` (`organizationPositionAssignments`, `reportingGroupMembers`, `createdApprovalRouteVersions`, and `approvalInstancesOrigin`). Add `instanceId String?`, `requiredPosition OrganizationPositionCode?`, `candidateGroupId String?`, `routingMode ApprovalRoutingMode @default(LEGACY_LEVEL)`, `instance approval_instances? @relation("request_approval_instance", fields: [instanceId], references: [id], onDelete: Restrict)`, and `candidateGroup approval_candidate_groups? @relation("request_approval_candidate_group", fields: [candidateGroupId], references: [id], onDelete: Restrict)` to `request_approvals`; use the corresponding `solution_approval_instance` and `solution_approval_candidate_group` relation names on `solution_approvals`. Candidate-group reverse relations already appear in the model block; do not add them twice. Change `request_approvals.requiredLevel` to `Int?`; keep the field for legacy rows only. Keep `isCustomChain` for compatibility and assert that NEW custom rows set both `isCustomChain = true` and `routingMode = CUSTOM_PERSON`.

Persist immutable `originContext` (position, assignment ID, ordered unit/group paths and display labels) and candidate display names; mutable foreign keys alone do not snapshot history. Record APPROVED/REJECTED/CANCELLED instance state with the document transition and preserve prior outcome in activities on supersession. Use scalar candidate `userId` plus `capturedAt` in `approval_candidate_group_members` rather than a required User foreign key, so the immutable candidate ID remains auditable if the account is removed. Action and notification lookup joins the captured ID to the current active User row and applies the approved active-user rule.

- [ ] **Step 4: Write the additive migration without production mapping**

After the enum/table/foreign-key DDL generated from the models above (including nullable `requiredLevel`, `organizationUnitId`, routing metadata, and all foreign keys), the migration must initialize only the discriminator and add the partial indexes/check constraint that Prisma cannot express. The compatibility portion is:

```sql
-- The generated DDL has already added both routingMode columns with
-- NOT NULL DEFAULT 'LEGACY_LEVEL'. Existing rows remain legacy by default.
UPDATE "request_approvals"
SET "routingMode" = 'CUSTOM_PERSON'
WHERE "isCustomChain" = true;

UPDATE "solution_approvals"
SET "routingMode" = 'CUSTOM_PERSON'
WHERE "isCustomChain" = true;

CREATE UNIQUE INDEX "approval_routes_one_published_scope_phase"
  ON "approval_route_versions" ("scopeUnitId", "phase")
  WHERE "status" = 'PUBLISHED';

CREATE UNIQUE INDEX "organization_assignments_one_active_primary"
  ON "organization_position_assignments" ("userId")
  WHERE "isPrimary" = true AND "isActive" = true;

CREATE UNIQUE INDEX "approval_instances_current_request_phase"
  ON "approval_instances" ("requestId", "phase")
  WHERE "requestId" IS NOT NULL AND "supersededAt" IS NULL;

CREATE UNIQUE INDEX "approval_instances_current_solution_phase"
  ON "approval_instances" ("solutionId", "phase")
  WHERE "solutionId" IS NOT NULL AND "supersededAt" IS NULL;

ALTER TABLE "approval_instances"
  ADD CONSTRAINT "approval_instances_one_document_owner"
  CHECK (
    ("phase" = 'SOLUTION' AND "solutionId" IS NOT NULL AND "requestId" IS NULL)
    OR ("phase" IN ('REQUEST', 'FINAL') AND "requestId" IS NOT NULL AND "solutionId" IS NULL)
  );
```

The migration must not create organization units, assign positions, map departments, reinterpret levels 1–10, rewrite pending rows, or run any production data conversion. The reviewed mapping import is a later controlled operation.

- [ ] **Step 5: Validate schema shape without applying a migration**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx prisma validate --schema prisma/schema.prisma && npx tsx --test tests/regression/organization-schema.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: Prisma validates, the schema contract passes, and no migration is applied. A source worker must not run `prisma migrate dev`, `prisma migrate deploy`, or any equivalent command locally.

### Task 2 ownership and persistence acceptance additions

- Make `requests.departmentId` and its `department` relation nullable for NEW parent-unit-owned requests. Existing rows keep their original non-null legacy department. NEW rows require `organizationUnitId` set from the requester’s primary unit at creation; a factory/department/division manager must create a request with no legacy department. Apply `CHECK ("departmentId" IS NOT NULL OR "organizationUnitId" IS NOT NULL)` after backfill eligibility is established; never assign a synthetic department to satisfy the old schema.
- New API/render projections accept `departmentId: string | null`. Keep legacy field labels for compatibility but present the typed origin unit on NEW cards, lists, filters, PDFs and modals. Audit all `.department.name`, mandatory department schemas and `departmentId` mutation guards before cutover; nullable filters must never become `undefined` inside an authorization OR.
- Add `organization_units.operationalType: DepartmentType` using reviewed GENERAL/ENGINEERING classification. It is independent of unit names and position levels. Mapped engineering sections retain their classification; a parent manager does not acquire engineering authority merely by managing such a section.
- NEW request and final instances own `requestId` only; solution instances own `solutionId` only. Retain original request context in immutable originContext. Add unique attempt-number indexes on `(requestId, phase, attempt)` and `(solutionId, phase, attempt)` for their non-null owner, in addition to the existing current-attempt indexes.
- Add checks tying routingMode to row metadata: a snapshot row has instanceId, candidateGroupId and requiredPosition; a custom row has requiredApproverId and isCustomChain; a legacy row retains a valid requiredLevel. Creation of auto-approved self-rows is explicit: they have no pending candidate group and must not be accepted as actionable snapshot rows. Persist them as approved audit rows linked to their instance and identify them through instance state, not a fabricated candidate pool.
- Add release provenance storage (no web mutation endpoint):

```prisma
model organization_import_runs {
  id             String   @id @default(uuid())
  mappingDigest  String   @unique
  appliedAt      DateTime @default(now())
  appliedBy      String
  targetIdentity String
  counts         Json
}
```

- Validate schema/generate client through Portly; never run production migrations locally. Nullable type fallout must be adapted in this task before `npm run check` passes; do not defer compile errors for later tasks. Behavior remains legacy-default until cutover.


## Task 3: Implement organization tree, positions, reporting groups, and branch scope

**Files:**
- Create: `src/lib/organization/types.ts`
- Create: `src/lib/organization/tree.ts`
- Create: `src/lib/organization/repository.ts`
- Create: `src/lib/organization/mapping.ts`
- Create: `tests/regression/organization-tree.test.ts`

**Interfaces:**
- Consumes: Prisma organization records from Task 2.
- Produces: `OrganizationPositionCode`, `OrganizationPositionLevel`, `OrganizationUnitNode`, `OrganizationPositionAssignment`, `ReportingGroupNode`, `ReportingBranch`, `assertAcyclicOrganizationTree`, `ancestorUnitIds`, `descendantUnitIds`, `positionLevel`, `loadUserOrganizationContext`, and `resolveReportingBranch`.

- [ ] **Step 1: Write failing pure tree and branch tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ancestorUnitIds,
  assertAcyclicOrganizationTree,
  descendantUnitIds,
  positionLevel,
} from '@/lib/organization/tree'
import type { OrganizationUnitNode } from '@/lib/organization/types'

const units: OrganizationUnitNode[] = [
  { id: 'factory-1', name: 'Factory', unitType: 'FACTORY', parentId: null, isActive: true },
  { id: 'division-1', name: 'Division', unitType: 'DIVISION', parentId: 'factory-1', isActive: true },
  { id: 'department-1', name: 'Department', unitType: 'DEPARTMENT', parentId: 'division-1', isActive: true },
  { id: 'section-1', name: 'PD1', unitType: 'SECTION', parentId: 'department-1', isActive: true },
  { id: 'section-2', name: 'PD2', unitType: 'SECTION', parentId: 'department-1', isActive: true },
]

describe('organization tree', () => {
  it('walks nearest ancestor first and descendants without crossing siblings', () => {
    assert.deepEqual(ancestorUnitIds(units, 'section-1'), [
      'section-1',
      'department-1',
      'division-1',
      'factory-1',
    ])
    assert.deepEqual(descendantUnitIds(units, 'department-1').sort(), [
      'department-1',
      'section-1',
      'section-2',
    ])
    assert.equal(descendantUnitIds(units, 'section-1').includes('section-2'), false)
  })

  it('rejects cycles and keeps position levels distinct from system roles', () => {
    assert.throws(() => assertAcyclicOrganizationTree([
      ...units.slice(0, 3),
      { ...units[3], parentId: 'section-4' },
      { id: 'section-4', name: 'Cycle', unitType: 'SECTION', parentId: 'section-1', isActive: true },
    ]), /cycle/i)
    assert.equal(positionLevel('STAFF'), 1)
    assert.equal(positionLevel('FACTORY_MANAGER'), 6)
  })
})
```

- [ ] **Step 2: Run the focused test to verify the new module is absent**

Run the Portly protocol with:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/organization-tree.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL with the missing organization module exports.

- [ ] **Step 3: Add typed tree and reporting-group algorithms**

Use these exact values in `src/lib/organization/types.ts`:

```ts
export const ORGANIZATION_POSITION_LEVEL = {
  STAFF: 1,
  SUPERVISOR: 2,
  SECTION_MANAGER: 3,
  DEPARTMENT_MANAGER: 4,
  DIVISION_MANAGER: 5,
  FACTORY_MANAGER: 6,
} as const

export type OrganizationPositionCode = keyof typeof ORGANIZATION_POSITION_LEVEL
export type OrganizationUnitType = 'FACTORY' | 'DIVISION' | 'DEPARTMENT' | 'SECTION'
export type OrganizationPositionLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface OrganizationUnitNode {
  id: string
  name: string
  unitType: OrganizationUnitType
  parentId: string | null
  isActive: boolean
}

export interface OrganizationPositionAssignment {
  id: string
  userId: string
  unitId: string
  positionCode: OrganizationPositionCode
  reportingGroupId: string | null
  isPrimary: boolean
  isActive: boolean
}

export interface ReportingGroupNode {
  id: string
  unitId: string
  parentGroupId: string | null
  name: string
  isActive: boolean
}

export interface ReportingBranch {
  originUserId: string
  primaryUnitId: string
  primaryAssignmentId: string
  primaryPosition: OrganizationPositionCode
  unitPath: readonly string[]
  groupPath: readonly string[]
}
```

`src/lib/organization/tree.ts` imports those types and implements these pure algorithms; `src/lib/organization/types.ts` is the sole source of position constants and type aliases:

```ts
import {
  ORGANIZATION_POSITION_LEVEL,
  type OrganizationPositionCode,
  type OrganizationUnitNode,
} from './types'
import type { OrganizationPositionLevel } from './types'

export function positionLevel(position: OrganizationPositionCode): OrganizationPositionLevel {
  return ORGANIZATION_POSITION_LEVEL[position] as OrganizationPositionLevel
}

export function assertAcyclicOrganizationTree(units: readonly OrganizationUnitNode[]): void {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  if (byId.size !== units.length) throw new Error('Duplicate organization unit ID')
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Organization cycle detected at ${id}`)
    if (visited.has(id)) return
    const unit = byId.get(id)
    if (!unit) throw new Error(`Organization parent ${id} is missing`)
    visiting.add(id)
    if (unit.parentId) visit(unit.parentId)
    visiting.delete(id)
    visited.add(id)
  }
  for (const unit of units) visit(unit.id)
}

export function ancestorUnitIds(units: readonly OrganizationUnitNode[], originUnitId: string): string[] {
  assertAcyclicOrganizationTree(units)
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  if (!byId.has(originUnitId)) throw new Error(`Organization unit ${originUnitId} is missing`)
  const result: string[] = []
  let current: string | null = originUnitId
  while (current) {
    result.push(current)
    current = byId.get(current)?.parentId ?? null
  }
  return result
}

export function descendantUnitIds(units: readonly OrganizationUnitNode[], rootUnitId: string): string[] {
  assertAcyclicOrganizationTree(units)
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  if (!byId.has(rootUnitId)) throw new Error(`Organization unit ${rootUnitId} is missing`)
  const children = new Map<string, string[]>()
  for (const unit of units) {
    if (!unit.parentId) continue
    const siblings = children.get(unit.parentId) ?? []
    siblings.push(unit.id)
    children.set(unit.parentId, siblings)
  }
  const result = [rootUnitId]
  const queue = [rootUnitId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const child of children.get(current) ?? []) {
      result.push(child)
      queue.push(child)
    }
  }
  return result
}
```

`resolveReportingBranch(userId, db)` must require exactly one active primary position assignment for an active origin user, walk that assignment's unit path, and include only active reporting-group ancestors attached to that path. It must reject an ambiguous primary assignment, a missing unit, a deleted/inactive unit, and a sibling-group crossing. Parent managers are found by their assigned parent unit; they are not duplicated into every descendant section.

- [ ] **Step 4: Add repository adapters with fail-closed organization reads**

Define the structural database boundary and implementation in `src/lib/organization/repository.ts`:

```ts
import type { ReportingBranch } from './types'

import type { Prisma } from '@prisma/client'
export type OrganizationRepository = Pick<Prisma.TransactionClient,
  'user' | 'organization_units' | 'organization_position_assignments' |
  'reporting_groups' | 'reporting_group_members'>

// Contract to implement in this module.
export async function resolveReportingBranch(
  userId: string,
  db: OrganizationRepository,
): Promise<ReportingBranch | null>

export async function loadUserOrganizationContext(
  userId: string,
  db: OrganizationRepository,
): Promise<{ userId: string; branch: ReportingBranch } | null> {
  const user = await db.user.findUnique({ where: { id: userId } }) as { id: string; isActive: boolean } | null
  if (!user || !user.isActive) return null
  const branch = await resolveReportingBranch(userId, db)
  return branch ? { userId, branch } : null
}
```

The production adapter may use Prisma's generated types, while tests provide a structural fake. `mapping.ts` is implemented in Task 4, importing that task’s mapping type. Task 3 must enforce unit parent types, reporting-group cycles, membership within its section, and position-versus-unit type. Supervisor candidates come only from the origin reporting-group ancestor path; manager candidates come from the corresponding unit ancestor. A missing supervisor is a vacancy, not permission to choose another group.

- [ ] **Step 5: Run organization tests and type-check the new pure modules**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/organization-tree.test.ts tests/regression/organization-schema.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: tree, cycle, position, and schema tests pass; no database is contacted and no organization data is created.

## Task 4: Add reviewed mapping validation and a read-only dry-run import

**Files:**
- Create: `tools/organization-mapping-schema.ts`
- Create: `scripts/organization-import-dry-run.ts`
- Create: `tests/regression/organization-import-dry-run.test.ts`

**Interfaces:**
- Consumes: explicit JSON mapping input and read-only legacy rows from `departments`, `User`, and `department_approvers`.
- Produces: `ReviewedOrganizationMapping`, `OrganizationImportReport`, `parseReviewedOrganizationMapping`, and `buildOrganizationImportReport`; the script exits nonzero for blocking unmapped or ambiguous rows and never calls Prisma writes.

- [ ] **Step 1: Write failing tests for explicit mapping and no blind compression**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseReviewedOrganizationMapping } from '../../tools/organization-mapping-schema'
import { buildOrganizationImportReport } from '../../scripts/organization-import-dry-run'

const base = {
  units: [
    { id: '00000000-0000-0000-0000-000000000001', name: 'Factory', unitType: 'FACTORY', parentId: null },
    { id: '00000000-0000-0000-0000-000000000008', name: 'Division', unitType: 'DIVISION', parentId: '00000000-0000-0000-0000-000000000001' },
    { id: '00000000-0000-0000-0000-000000000009', name: 'Department', unitType: 'DEPARTMENT', parentId: '00000000-0000-0000-0000-000000000008' },
    { id: '00000000-0000-0000-0000-000000000003', name: 'PD1', unitType: 'SECTION', parentId: '00000000-0000-0000-0000-000000000009' },
  ],
  departments: [{ legacyDepartmentId: '00000000-0000-0000-0000-000000000002', targetUnitId: '00000000-0000-0000-0000-000000000003', engineeringClassification: 'GENERAL', disposition: 'REAL_SECTION' }],
  positionAssignments: [{ userId: '00000000-0000-0000-0000-000000000004', unitId: '00000000-0000-0000-0000-000000000003', positionCode: 'STAFF', reportingGroupId: null, isPrimary: true }],
  reportingGroups: [],
  externalApprovers: [],
  legacyLevelMappings: [{ legacyLevel: 1, positionCode: 'STAFF' }],
}

describe('reviewed organization import', () => {
  it('rejects a missing department mapping instead of deriving one from its name', () => {
    assert.throws(() => parseReviewedOrganizationMapping({ ...base, departments: [] }), /department/i)
  })

  it('reports legacy levels 7–10 as unmapped rather than compressing them', () => {
    const report = buildOrganizationImportReport({
      mapping: parseReviewedOrganizationMapping(base),
      legacyDepartments: [{ id: '00000000-0000-0000-0000-000000000002', name: 'PD1', type: 'GENERAL' }],
      legacyUsers: [{ id: '00000000-0000-0000-0000-000000000007', departmentId: '00000000-0000-0000-0000-000000000002', level: 7, isActive: true }],
      legacyExternalApprovers: [],
    })
    assert.deepEqual(report.blockingReasons, [
      'USER_NOT_MAPPED:00000000-0000-0000-0000-000000000007',
      'USER_LEVEL_NOT_EXPLICITLY_MAPPED:00000000-0000-0000-0000-000000000007:7',
    ])
  })
})
```

- [ ] **Step 2: Run the dry-run test to verify the mapping module is absent**

Run through Portly:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/organization-import-dry-run.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the schema and report functions do not yet exist.

- [ ] **Step 3: Define the reviewed mapping schema**

`tools/organization-mapping-schema.ts` must validate this shape with Zod and preserve IDs exactly:

```ts
import { z } from 'zod'
import { validateReviewedOrganizationMapping } from '../src/lib/organization/mapping'

const unique = <T>(rows: readonly T[], key: (row: T) => string): boolean => {
  const keys = rows.map(key)
  return new Set(keys).size === keys.length
}

export const reviewedOrganizationMappingSchema = z.object({
  units: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1),
    unitType: z.enum(['FACTORY', 'DIVISION', 'DEPARTMENT', 'SECTION']),
    parentId: z.string().uuid().nullable(),
  })).min(1).refine((rows) => unique(rows, (row) => row.id), 'unit IDs must be unique'),
  departments: z.array(z.object({
    legacyDepartmentId: z.string().uuid(),
    targetUnitId: z.string().uuid(),
    engineeringClassification: z.enum(['GENERAL', 'ENGINEERING']),
    disposition: z.enum(['REAL_SECTION', 'LEGACY_MANAGER_CONTAINER']),
  })).min(1).refine((rows) => unique(rows, (row) => row.legacyDepartmentId), 'legacy department IDs must be unique'),
  positionAssignments: z.array(z.object({
    userId: z.string().uuid(),
    unitId: z.string().uuid(),
    positionCode: z.enum(['STAFF', 'SUPERVISOR', 'SECTION_MANAGER', 'DEPARTMENT_MANAGER', 'DIVISION_MANAGER', 'FACTORY_MANAGER']),
    reportingGroupId: z.string().uuid().nullable(),
    isPrimary: z.boolean(),
  })).refine((rows) => unique(rows, (row) => `${row.userId}:${row.unitId}:${row.positionCode}`), 'position assignments must be unique'),
  reportingGroups: z.array(z.object({
    id: z.string().uuid(),
    unitId: z.string().uuid(),
    parentGroupId: z.string().uuid().nullable(),
    name: z.string().trim().min(1),
    memberUserIds: z.array(z.string().uuid()).refine((ids) => new Set(ids).size === ids.length),
  })).refine((rows) => unique(rows, (row) => row.id), 'reporting-group IDs must be unique'),
  externalApprovers: z.array(z.object({
    legacyDepartmentApproverId: z.string().uuid(),
    userId: z.string().uuid(),
    targetUnitId: z.string().uuid(),
    disposition: z.enum(['PARENT_SCOPE', 'CUSTOM_ONLY', 'LEGACY_ONLY']),
    positionCode: z.enum(['STAFF', 'SUPERVISOR', 'SECTION_MANAGER', 'DEPARTMENT_MANAGER', 'DIVISION_MANAGER', 'FACTORY_MANAGER']),
  })).refine((rows) => unique(rows, (row) => row.legacyDepartmentApproverId), 'external approver IDs must be unique'),
  legacyLevelMappings: z.array(z.object({
    legacyLevel: z.number().int().min(1).max(10),
    positionCode: z.enum(['STAFF', 'SUPERVISOR', 'SECTION_MANAGER', 'DEPARTMENT_MANAGER', 'DIVISION_MANAGER', 'FACTORY_MANAGER']).nullable(),
  })).refine((rows) => new Set(rows.map((row) => row.legacyLevel)).size === rows.length),
})

export type ReviewedOrganizationMapping = z.infer<typeof reviewedOrganizationMappingSchema>

export function parseReviewedOrganizationMapping(input: unknown): ReviewedOrganizationMapping {
  const mapping = reviewedOrganizationMappingSchema.parse(input)
  validateReviewedOrganizationMapping(mapping)
  return mapping
}
```

Assignments are explicit per person; the level inventory acknowledges legacy data but does not assign positions. Different sections can use the same numeric level differently. Require an explicit mapping row for each encountered level. A `null` level mapping means no global conversion applies; active users still need explicit assignments. It does not retire or disable users. Reject department names, numeric order, or `levelNames` as automatic mapping sources. External rows must explicitly consolidate parent managers into their true parent unit (PARENT_SCOPE), or record CUSTOM_ONLY/LEGACY_ONLY disposition; do not recreate repeated section assignments. Preserve legacy rows. Add `validateReviewedOrganizationMapping(mapping)` in `mapping.ts` for parent/group/reference checks, and call it after Zod parsing. REAL_SECTION mappings must target SECTION units. An explicitly reviewed LEGACY_MANAGER_CONTAINER mapping may target its real FACTORY/DIVISION/DEPARTMENT unit so old fake manager sections are not recreated; historical requests inherit that reviewed target. The dry-run report additionally validates all referenced users against loaded legacy records. No unknown reference or missing active primary may pass.

- [ ] **Step 4: Implement the dry-run report and CLI with no writes**

Export these types and functions from `scripts/organization-import-dry-run.ts`:

```ts
import type { ReviewedOrganizationMapping } from '../tools/organization-mapping-schema'

export interface OrganizationImportReport {
  mappedDepartmentCount: number
  mappedUserCount: number
  mappedExternalApproverCount: number
  unmappedDepartmentIds: string[]
  unmappedUserIds: string[]
  blockingReasons: string[]
  wouldCreateUnits: number
  wouldCreateAssignments: number
  wouldCreateReportingGroups: number
}

export function buildOrganizationImportReport(input: {
  mapping: ReviewedOrganizationMapping
  legacyDepartments: Array<{ id: string; name: string; type: 'GENERAL' | 'ENGINEERING' }>
  legacyUsers: Array<{ id: string; departmentId: string | null; level: number | null; isActive: boolean }>
  legacyExternalApprovers: Array<{ id: string; approverId: string; departmentId: string; approverLevel: number }>
}): OrganizationImportReport {
  const mappedDepartments = new Set(input.mapping.departments.map((row) => row.legacyDepartmentId))
  const mappedUsers = new Set(input.mapping.positionAssignments.map((row) => row.userId))
  const mappedExternalApprovers = new Set(input.mapping.externalApprovers.map((row) => row.legacyDepartmentApproverId))
  const explicitLevels = new Set(input.mapping.legacyLevelMappings.map((row) => row.legacyLevel))
  const blockingReasons: string[] = []
  for (const department of input.legacyDepartments) {
    if (!mappedDepartments.has(department.id)) blockingReasons.push(`DEPARTMENT_NOT_MAPPED:${department.id}`)
  }
  for (const user of input.legacyUsers) {
    if (!user.isActive) continue
    if (!mappedUsers.has(user.id)) blockingReasons.push(`USER_NOT_MAPPED:${user.id}`)
    if (user.level !== null && !explicitLevels.has(user.level)) blockingReasons.push(`USER_LEVEL_NOT_EXPLICITLY_MAPPED:${user.id}:${user.level}`)
  }
  for (const approver of input.legacyExternalApprovers) {
    if (!mappedExternalApprovers.has(approver.id)) blockingReasons.push(`EXTERNAL_APPROVER_NOT_MAPPED:${approver.id}`)
    if (approver.approverLevel < 1 || approver.approverLevel > 10) blockingReasons.push(`EXTERNAL_APPROVER_LEVEL_OUT_OF_RANGE:${approver.id}:${approver.approverLevel}`)
    if (!explicitLevels.has(approver.approverLevel)) blockingReasons.push(`EXTERNAL_APPROVER_LEVEL_NOT_EXPLICITLY_MAPPED:${approver.id}:${approver.approverLevel}`)
  }
  return {
    mappedDepartmentCount: input.mapping.departments.length,
    mappedUserCount: input.mapping.positionAssignments.length,
    mappedExternalApproverCount: input.mapping.externalApprovers.length,
    unmappedDepartmentIds: input.legacyDepartments.filter((row) => !mappedDepartments.has(row.id)).map((row) => row.id),
    unmappedUserIds: input.legacyUsers.filter((row) => row.isActive && !mappedUsers.has(row.id)).map((row) => row.id),
    blockingReasons,
    wouldCreateUnits: input.mapping.units.length,
    wouldCreateAssignments: input.mapping.positionAssignments.length,
    wouldCreateReportingGroups: input.mapping.reportingGroups.length,
  }
}
```

The CLI accepts `--mapping <reviewed-file>` and `--out <report-file>`, loads legacy rows through a read-only repository, writes only the JSON report path, prints blocking reasons, and returns exit code 2 when `blockingReasons.length > 0`. Guard the executable entry point (`import.meta.url` versus `pathToFileURL(process.argv[1])`) so importing `buildOrganizationImportReport` in a test performs no I/O. It must not call `create`, `createMany`, `update`, `updateMany`, `delete`, or `$executeRaw`.

- [ ] **Step 5: Run the dry-run tests and inspect the report contract**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/organization-import-dry-run.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: missing mappings and level 7–10 produce blocking reasons, no database write method is called, and a fully reviewed fixture produces a zero-blocker report. The report is evidence for an external human mapping gate; it is not a production migration.

## Task 5: Implement versioned route validation and deterministic nearest-ancestor resolution

**Files:**
- Create: `src/lib/approval-routes/types.ts`
- Create: `src/lib/approval-routes/validation.ts`
- Create: `src/lib/approval-routes/resolver.ts`
- Create: `src/lib/approval-routes/preview.ts`
- Create: `tests/regression/approval-route-resolution.test.ts`

**Interfaces:**
- Consumes: `OrganizationPositionCode`, `OrganizationPositionLevel`, `ReportingBranch`, ancestor paths, and published route rows.
- Produces: `ApprovalPhase`, `ApprovalRouteStepDefinition`, `ApprovalRouteVersionDefinition`, `RouteResolutionContext`, `ResolvedApprovalRoute`, `validateRouteDefinition`, `selectNearestPublishedRoute`, and `resolvePublishedApprovalRoute`.

- [ ] **Step 1: Write failing route tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { selectNearestPublishedRoute } from '@/lib/approval-routes/resolver'
import type { ApprovalRouteVersionDefinition } from '@/lib/approval-routes/types'
import { validateRouteDefinition } from '@/lib/approval-routes/validation'

describe('approval route resolution', () => {
  it('chooses the first published ancestor scope, not a broader manager scope', () => {
    const routes: ApprovalRouteVersionDefinition[] = [
      {
        id: 'factory-route', scopeUnitId: 'factory-1', phase: 'REQUEST', version: 1,
        maximumPositionLevel: 6, status: 'PUBLISHED',
        steps: [{ order: 1, position: 'FACTORY_MANAGER' }],
      },
      {
        id: 'department-route', scopeUnitId: 'department-1', phase: 'REQUEST', version: 3,
        maximumPositionLevel: 4, status: 'PUBLISHED',
        steps: [
          { order: 1, position: 'SECTION_MANAGER' },
          { order: 2, position: 'DEPARTMENT_MANAGER' },
        ],
      },
    ]
    const route = selectNearestPublishedRoute(['section-1', 'department-1', 'division-1', 'factory-1'], routes, 'REQUEST')
    assert.equal(route.id, 'department-route')
  })

  it('rejects downward, duplicate, or above-ceiling steps', () => {
    assert.throws(() => validateRouteDefinition({
      scopeUnitId: 'section-1', phase: 'REQUEST', maximumPositionLevel: 4,
      steps: [{ order: 1, position: 'DEPARTMENT_MANAGER' }, { order: 2, position: 'SUPERVISOR' }],
    }), /ascending/i)
    assert.throws(() => validateRouteDefinition({
      scopeUnitId: 'section-1', phase: 'REQUEST', maximumPositionLevel: 3,
      steps: [{ order: 1, position: 'FACTORY_MANAGER' }],
    }), /ceiling/i)
  })
})
```

- [ ] **Step 2: Run the route tests to verify the resolver is absent**

Run through Portly with:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-route-resolution.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the route modules do not yet exist.

- [ ] **Step 3: Define route types and validation**

```ts
import type { OrganizationPositionCode, OrganizationPositionLevel, ReportingBranch } from '@/lib/organization/types'

export type ApprovalPhase = 'REQUEST' | 'SOLUTION' | 'FINAL'
export type ApprovalRouteStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED'

export interface ApprovalRouteStepDefinition {
  order: number
  position: OrganizationPositionCode
}

export interface ApprovalRouteVersionDefinition {
  id: string
  scopeUnitId: string
  phase: ApprovalPhase
  version: number
  maximumPositionLevel: OrganizationPositionLevel
  status: ApprovalRouteStatus
  steps: readonly ApprovalRouteStepDefinition[]
}

export interface RouteResolutionContext {
  phase: ApprovalPhase
  originUserId: string
  originUnitId: string
  requestId: string
  originalRequestId: string
  requestDepartmentId: string | null
}

export class ApprovalRouteConfigurationError extends Error {
  readonly code = 'APPROVAL_ROUTE_CONFIGURATION'
}

export interface ResolvedApprovalRoute extends ApprovalRouteVersionDefinition {
  ancestorScopeIds: readonly string[]
}
```

`validateRouteDefinition` must enforce a ceiling in 1–6, positive contiguous `order` values, strictly increasing `positionLevel` values, no duplicate positions, and every position at or below `maximumPositionLevel`. Position-level gaps are valid; step-order gaps are not. It must not inspect document values or invent thresholds. A missing published route or an ambiguous origin scope throws `ApprovalRouteConfigurationError`; it is never treated as an empty route.

- [ ] **Step 4: Implement nearest-ancestor selection and database resolution**

```ts
export function selectNearestPublishedRoute(
  ancestorScopeIds: readonly string[],
  routes: readonly ApprovalRouteVersionDefinition[],
  phase: ApprovalPhase,
): ApprovalRouteVersionDefinition {
  for (const scopeUnitId of ancestorScopeIds) {
    const matches = routes.filter((route) =>
      route.scopeUnitId === scopeUnitId && route.phase === phase && route.status === 'PUBLISHED'
    )
    if (matches.length > 1) throw new ApprovalRouteConfigurationError(`Ambiguous published route for ${scopeUnitId}:${phase}`)
    if (matches.length === 1) return matches[0]
  }
  throw new ApprovalRouteConfigurationError(`No published route for ${phase} in the origin branch`)
}
```

Define `ApprovalRouteDb` with `loadOriginBranch(originUserId): Promise<ReportingBranch | null>` and `loadPublishedRoutes(input: { scopeUnitIds: readonly string[]; phase: ApprovalPhase }): Promise<ApprovalRouteVersionDefinition[]>`. `resolvePublishedApprovalRoute(context, db: ApprovalRouteDb)` loads the origin branch, verifies that `originUnitId` is the branch's primary section/scope, obtains `ancestorScopeIds` in nearest-first order, loads only published routes for those IDs and the requested phase, calls `selectNearestPublishedRoute`, validates the selected steps, and returns the route plus the full ancestor path. It must not choose a route in a sibling unit or use the original request department when the phase origin is different.

- [ ] **Step 5: Run route tests and verify route ceiling behavior**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-route-resolution.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: nearest department scope wins over factory scope, invalid downward/duplicate/above-ceiling definitions fail, sparse upward routes pass, and missing/ambiguous routes remain configuration errors.

## Task 6: Add admin route publication and route preview

**Files:**
- Create: `src/server-actions/approval-routes.ts`
- Create: `src/app/admin/routes/page.tsx`
- Create: `src/components/admin/routes/RouteEditor.tsx`
- Create: `src/components/admin/routes/RouteStepList.tsx`
- Create: `src/components/admin/routes/RoutePreview.tsx`
- Create: `tests/regression/approval-route-admin.test.ts`

**Interfaces:**
- Consumes: route validation/resolution from Task 5, `requireAdmin`, organization units and user contexts.
- Produces: `SaveApprovalRouteDraftInput`, `PreviewApprovalRouteInput`, `saveApprovalRouteDraft`, `publishApprovalRoute`, and `previewApprovalRoute`.

- [ ] **Step 1: Write failing admin action contracts**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('approval route admin contracts', () => {
  it('requires admin-only publication, explicit positions, a ceiling, and a preview', () => {
    const source = read('src/server-actions/approval-routes.ts')
    assert.match(source, /publishApprovalRoute/)
    assert.match(source, /requireAdmin/)
    assert.match(source, /maximumPositionLevel/)
    assert.match(source, /previewApprovalRoute/)
  })

  it('does not authorize financial route conditions', () => {
    const source = read('src/server-actions/approval-routes.ts')
    assert.doesNotMatch(source, /amount|budget|cost|threshold/i)
  })
})
```

- [ ] **Step 2: Run the admin contract test before adding the actions**

Run through Portly:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-route-admin.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the route server-action file does not exist.

- [ ] **Step 3: Implement versioned admin actions**

Use these signatures:

```ts
export interface SaveApprovalRouteDraftInput {
  scopeUnitId: string
  phase: ApprovalPhase
  maximumPositionLevel: OrganizationPositionLevel
  steps: ApprovalRouteStepDefinition[]
}

export interface PreviewApprovalRouteInput {
  scopeUnitId: string
  phase: ApprovalPhase
  originUserId: string
  draft?: SaveApprovalRouteDraftInput
}

export interface RoutePreview {
  routeVersionId: string
  scopeUnitId: string
  phase: ApprovalPhase
  maximumPositionLevel: OrganizationPositionLevel
  steps: Array<{ order: number; position: OrganizationPositionCode; candidateCount: number; candidates: Array<{ id: string; name: string }>; skipped: boolean; skipReason?: 'VACANT_POSITION' }>
}

export async function saveApprovalRouteDraft(input: SaveApprovalRouteDraftInput): Promise<ApprovalRouteVersionDefinition>
export async function publishApprovalRoute(input: SaveApprovalRouteDraftInput): Promise<ApprovalRouteVersionDefinition>
export async function previewApprovalRoute(input: PreviewApprovalRouteInput): Promise<RoutePreview>
```

Each action derives the actor from `requireAdmin` (retain the existing admin guard; do not invent a permissive role check), validates unit type and position order, obtains the next version number, and writes a new draft or published version. Publication locks the scope/phase, retires the current published version, inserts the new published version, and commits both changes in one transaction; the partial unique index rejects a concurrent publisher and rollback preserves the previous version. A draft warning lists vacant positions without blocking publication, because vacancy is a runtime skip and not a submission blocker.

- [ ] **Step 4: Build the admin route UI with a preview, not a free-form rule editor**

`RouteEditor.tsx` submits only the scope, phase, maximum position level, and ordered position list. `RouteStepList.tsx` allows drag reordering but displays a validation error when a drag creates downward order. `RoutePreview.tsx` calls `previewApprovalRoute` for a selected origin user and displays candidate counts, vacant-step warnings, the selected nearest scope, and the resulting ceiling. Preview unsaved draft input through the same read-only resolver with an explicit draft override; it must neither publish nor persist candidate snapshots. Show approver names as well as counts. It must not expose amount, budget, candidate reassignment, or email configuration controls.

- [ ] **Step 5: Run route admin contracts and focused TypeScript validation**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-route-admin.test.ts tests/regression/approval-route-resolution.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: admin-only action contracts, no-financial-rule contract, route validation, and nearest-scope tests pass.

## Task 7: Build immutable NEW candidate groups and attempt-history plans

**Files:**
- Create: `src/lib/approval-engine/types.ts`
- Create: `src/lib/approval-engine/phase-origin.ts`
- Create: `src/lib/approval-engine/candidate-groups.ts`
- Create: `src/lib/approval-engine/instances.ts`
- Create: `src/lib/approval-engine/legacy.ts`
- Create: `tests/regression/approval-engine-resolution.test.ts`

**Interfaces:**
- Consumes: route versions, organization branch/position assignments, active users, and Task 2 snapshot models.
- Produces: `PhaseOrigin`, `ApprovalStepPlan`, `ApprovalSkipPlan`, `ApprovalInstancePlan`, `CandidateGroupSnapshot`, `resolvePhaseOrigin`, `snapshotCandidateGroup`, `buildNormalApprovalInstance`, `persistApprovalInstance`, and `classifyApprovalRow`.

- [ ] **Step 1: Write failing snapshot and origin tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildNormalApprovalInstance } from '@/lib/approval-engine/instances'
import { createFakeApprovalEngineDb } from '../fixtures/organization-approval-fixtures'

describe('NEW approval instance resolution', () => {
  it('freezes candidates and skips vacancies without activating a replacement', async () => {
    const db = createFakeApprovalEngineDb({
      origin: { userId: 'staff-1', unitId: 'section-1', position: 'STAFF' },
      route: {
        id: 'route-1', phase: 'REQUEST', scopeUnitId: 'section-1', version: 1,
        maximumPositionLevel: 4,
        status: 'PUBLISHED',
        ancestorScopeIds: ['section-1', 'department-1', 'division-1', 'factory-1'],
        steps: [
          { order: 1, position: 'SUPERVISOR' },
          { order: 2, position: 'SECTION_MANAGER' },
          { order: 3, position: 'DEPARTMENT_MANAGER' },
        ],
      },
      candidates: {
        SUPERVISOR: ['supervisor-1'],
        SECTION_MANAGER: [],
        DEPARTMENT_MANAGER: ['department-manager-1'],
      },
    })
    const plan = await buildNormalApprovalInstance(db, {
      requestId: 'request-1',
      phase: 'REQUEST',
      originUserId: 'staff-1',
      originalRequestId: 'request-1',
      requestDepartmentId: 'department-1',
    })
    assert.deepEqual(plan.steps.map((step) => step.candidateUserIds), [['supervisor-1'], ['department-manager-1']])
    assert.deepEqual(plan.skipped, [{ requiredPosition: 'SECTION_MANAGER', reason: 'VACANT_POSITION' }])
    db.replaceCandidates('SUPERVISOR', ['new-supervisor-1'])
    assert.deepEqual(plan.steps[0].candidateUserIds, ['supervisor-1'])
  })
})

```

`tests/fixtures/organization-approval-fixtures.ts` must export `createFakeApprovalEngineDb(input: { origin: { userId: string; unitId: string; position: OrganizationPositionCode }; route: ResolvedApprovalRoute; candidates: Partial<Record<OrganizationPositionCode, string[]>> }): ApprovalEngineDb & { replaceCandidates(position: OrganizationPositionCode, ids: string[]): void }`. Its three repository methods resolve the supplied origin/route and return `{ id, isActive: true }` records from an internal Map; `replaceCandidates` changes only that Map after the plan has been built, proving the returned snapshot is immutable. `buildNormalApprovalInstance` copies only the candidate IDs into the plan. It must not call Prisma. Before this task the engine module import fails.

- [ ] **Step 2: Run the snapshot test and verify the engine is absent**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-engine-resolution.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the engine modules and `ApprovalEngineDb` boundary do not yet exist.

- [ ] **Step 3: Define consistent engine interfaces and phase origins**

```ts
import type { OrganizationPositionCode, ReportingBranch } from '@/lib/organization/types'
import type { ResolvedApprovalRoute, RouteResolutionContext } from '@/lib/approval-routes/types'

export type ApprovalRoutingMode = 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
export type ApprovalInstanceState = 'PENDING' | 'AUTO_APPROVED' | 'COMPLETED_NO_ELIGIBLE_STEPS' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'SUPERSEDED'
export type ApprovalSkipReason = 'VACANT_POSITION'

export interface PhaseOrigin {
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  originUserId: string
  originUnitId: string
  branch: ReportingBranch
  originalRequestId: string
  requestDepartmentId: string | null
  source: 'REQUESTER' | 'SOLUTION_SUBMITTER' | 'FINAL_INITIATOR'
}

export interface ApprovalStepPlan {
  order: number
  requiredPosition?: OrganizationPositionCode
  requiredApproverId?: string
  scopeUnitId?: string
  candidateUserIds: readonly string[]
}

export interface ApprovalSkipPlan {
  requiredPosition: OrganizationPositionCode
  reason: ApprovalSkipReason
}

export interface ApprovalInstancePlan {
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  requestId?: string
  solutionId?: string
  routeVersionId?: string
  originUserId: string
  originUnitId: string
  originContext: { position: OrganizationPositionCode; assignmentId: string; unitPath: readonly string[]; groupPath: readonly string[]; labels: Readonly<Record<string, string>> }
  routingMode: ApprovalRoutingMode
  attempt: number
  state: ApprovalInstanceState
  completionReason?: 'NO_ELIGIBLE_APPROVAL_STEPS'
  steps: readonly ApprovalStepPlan[]
  skipped: readonly ApprovalSkipPlan[]
}

export interface CandidateGroupSnapshot {
  requiredPosition: OrganizationPositionCode
  scopeUnitId: string
  candidateUserIds: readonly string[]
  capturedAt: Date
}

export interface ApprovalEngineDb {
  resolvePhaseOrigin(input: { phase: PhaseOrigin['phase']; requestId: string; solutionId?: string; originUserId?: string }): Promise<PhaseOrigin>
  resolvePublishedRoute(context: RouteResolutionContext): Promise<ResolvedApprovalRoute>
  findCandidates(input: { branch: ReportingBranch; requiredPosition: OrganizationPositionCode; scopeUnitId: string }): Promise<Array<{ id: string; isActive: boolean }>>
}

export async function buildNormalApprovalInstance(
  db: ApprovalEngineDb,
  input: { requestId: string; solutionId?: string; phase: PhaseOrigin['phase']; originUserId: string; originalRequestId: string; requestDepartmentId: string | null },
): Promise<ApprovalInstancePlan>
```

`resolvePhaseOrigin` must implement these exact origins: request phase uses `requests.requesterId`; solution phase uses `solutions.submittedById` and the engineering submitter's organization branch; final phase uses the authenticated final initiator's branch while retaining `requestDepartmentId` as original-request context. Legacy final initiation retains its same-department check; NEW final initiation uses direct originating-unit membership, not ancestor read scope. Neither is a substitute for the initiator’s route origin.

- [ ] **Step 4: Implement candidate snapshot and instance algorithms**

`buildNormalApprovalInstance(db, input)` must:

1. Resolve the phase origin and nearest published route.
2. Load the origin position level from its active primary assignment.
3. If origin level is at or above `maximumPositionLevel`, return an `AUTO_APPROVED` plan with no pending steps; the adapter records the existing approved self-row and phase transition.
4. For each configured route step above the origin and at or below the ceiling, resolve candidates only from the origin reporting branch and the step's assigned scope.
5. Deduplicate candidate IDs before writing. If the group has no active candidates, record `{ requiredPosition, reason: 'VACANT_POSITION' }` and create no pending row.
6. If no pending step remains, return `COMPLETED_NO_ELIGIBLE_STEPS` and `completionReason: 'NO_ELIGIBLE_APPROVAL_STEPS'`; do not return a pending instance and do not choose a live replacement.
7. Return a detached plan with copied IDs and originContext; do not write in the resolver. `persistApprovalInstance(tx, plan)` separately persists instance, skips, candidates and row references through the caller transaction. The production adapter uses origin.branch.primaryPosition and resolves each required scope from that branch. Test supervisor-group isolation as well as manager-unit scope.

`classifyApprovalRow(row)` reads the persisted routingMode. LEGACY_LEVEL delegates to the old engine; CUSTOM_PERSON uses exact-person semantics (legacy or new); SNAPSHOT_GROUP requires a current instance and candidate group or fails as corrupted data. instanceId distinguishes legacy custom rows from new custom attempts. Never silently downgrade malformed snapshot rows to live-level routing.

- [ ] **Step 5: Run engine tests for snapshots, vacancy, ceiling, and no-eligible completion**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-engine-resolution.test.ts tests/regression/approval-route-resolution.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: candidate IDs remain unchanged after simulated organization edits, inactive/vacant groups are skipped with an audit reason, no replacement is activated, ceiling auto-approval is explicit, empty resolved routes complete with the approved reason, and route errors remain distinguishable from vacancies.

### Task 7 production adapter and immutable context contract

Implement `createApprovalEngineDb(tx: Prisma.TransactionClient): ApprovalEngineDb` in `src/lib/approval-engine/instances.ts`. It derives phase origin from authenticated/trusted action input and stored document identities, loads `ReportingBranch` including primaryPosition/primaryAssignmentId, and selects the nearest route from that branch. It never trusts an arbitrary client originUserId or position. `requestDepartmentId` is nullable legacy context and is never the source of NEW routing.

Implement `persistApprovalInstance(tx: Prisma.TransactionClient, plan: ApprovalInstancePlan): Promise<ApprovalInstancePlan & { id: string }>` separately from the read-only builder. It stores copied origin context and candidate display labels. Production adapters wrap Prisma rather than claiming raw Prisma implements the domain port. The fixture returns a complete `PhaseOrigin` (including branch); import domain types from `types.ts`, not an implementation file.

Add a production-builder test for every parent-position origin; a representative Factory Manager case is:

```ts
const db = createFakeApprovalEngineDb({
  origin: { userId: 'fm', unitId: 'factory-1', position: 'FACTORY_MANAGER' },
  route: {
    id: 'factory-request-v1', scopeUnitId: 'factory-1', phase: 'REQUEST',
    version: 1, status: 'PUBLISHED', maximumPositionLevel: 6,
    ancestorScopeIds: ['factory-1'],
    steps: [{ order: 1, position: 'FACTORY_MANAGER' }],
  },
  candidates: {},
})
const result = await buildNormalApprovalInstance(db, {
  requestId: 'r-fm', originalRequestId: 'r-fm', phase: 'REQUEST',
  originUserId: 'fm', requestDepartmentId: null,
})
assert.equal(result.state, 'AUTO_APPROVED')
assert.equal(result.originUnitId, 'factory-1')
assert.deepEqual(result.steps, [])
```

The fake derives the full branch/context from the supplied origin and route path; the builder, not the fake, decides auto-approval. Repeat with Department/Division ceilings. For staff, verify PD1 supervisor group A cannot select group B supervisors at the same level. Vacancy selection must use the same transaction snapshot as origin/publication reads; use serializable isolation and surface a retryable conflict instead of persisting mixed versions. Do not add automatic delivery retry behavior.


## Task 8: Adapt request, solution, final, and resubmission flows to the engine

**Files:**
- Modify: `src/server-actions/requests.ts`
- Modify: `src/server-actions/approvals.ts`
- Modify: `src/server-actions/solutions.ts`
- Create: `src/lib/approval-engine/phase-adapters.ts`
- Create legacy-default mode helper: `src/lib/approval-rollout.ts` (extended in Task 15)
- Create: `tests/regression/approval-phase-adapters.test.ts`
- Create: `tests/regression/approval-resubmission-history.test.ts`

**Interfaces:**
- Consumes: `PhaseOrigin`, `ApprovalInstancePlan`, `persistApprovalInstance`, current auth/status guards, current custom-chain validators, and existing attachment transaction work.
- Produces: `createRequestApprovalAttempt`, `createSolutionApprovalAttempt`, `createFinalApprovalAttempt`, and `createCustomPersonAttempt` with exact status-transition results.

- [ ] **Step 1: Write failing phase-origin and history tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRequestApprovalAttempt,
  createSolutionApprovalAttempt,
  createFinalApprovalAttempt,
} from '@/lib/approval-engine/phase-adapters'
import {
  createPhaseAdapterDb,
  createPhaseAdapterDbWithRejectedAttempt,
} from '../fixtures/organization-approval-fixtures'

describe('phase approval adapters', () => {
  it('uses the phase initiator without changing business transitions', async () => {
    const request = await createRequestApprovalAttempt(createPhaseAdapterDb({ phase: 'REQUEST' }), { requestId: 'r1', requesterId: 'staff-1' })
    const solution = await createSolutionApprovalAttempt(createPhaseAdapterDb({ phase: 'SOLUTION' }), { requestId: 'r1', solutionId: 's1', submittedById: 'engineer-1' })
    const final = await createFinalApprovalAttempt(createPhaseAdapterDb({ phase: 'FINAL' }), { requestId: 'r1', initiatorId: 'department-member-1' })
    assert.deepEqual(request.statusChange, { from: 'ImprovementRequest', to: 'SentToEngineer' })
    assert.deepEqual(solution.statusChange, { from: 'SentToEngineer', to: 'SendBackToRequester' })
    assert.deepEqual(final.statusChange, { from: 'SendBackToRequester', to: 'Completed' })
    assert.equal(solution.instance.originUserId, 'engineer-1')
    assert.equal(final.instance.originUserId, 'department-member-1')
  })

  it('retains prior attempts instead of deleting their rows', async () => {
    const db = createPhaseAdapterDbWithRejectedAttempt('r1')
    const result = await createRequestApprovalAttempt(db, { requestId: 'r1', requesterId: 'staff-1' })
    assert.equal(result.instance.attempt, 2)
    assert.equal(db.priorAttemptState('r1', 'REQUEST'), 'SUPERSEDED')
    assert.equal(db.priorAttemptRowsRemain('r1'), true)
  })
})
```

`tests/fixtures/organization-approval-fixtures.ts` must export `createPhaseAdapterDb(input: { phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): PhaseAdapterDb` and `createPhaseAdapterDbWithRejectedAttempt(requestId: string): PhaseAdapterDb & { priorAttemptState(requestId: string, phase: 'REQUEST' | 'SOLUTION' | 'FINAL'): 'SUPERSEDED' | 'PENDING'; priorAttemptRowsRemain(requestId: string): boolean }`. The fake supplies an AUTO_APPROVED normal plan and initial document status (ImprovementRequest / SentToEngineer / SendBackToRequester respectively), stores current/prior rows in Maps and records supersession; the actual adapter computes the transitions, not the fake; it must not call Prisma.

- [ ] **Step 2: Run phase tests before adding adapters**

Run through Portly:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-phase-adapters.test.ts tests/regression/approval-resubmission-history.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the phase adapter module and attempt-history behavior do not yet exist.

- [ ] **Step 3: Define phase adapter signatures and completion results**

```ts
import type { RequestStatus } from '@prisma/client'
import type { ApprovalEngineDb, ApprovalInstancePlan } from '@/lib/approval-engine/types'

export interface PhaseAdapterDb extends ApprovalEngineDb {
  loadRequestContext(requestId: string): Promise<{ status: RequestStatus; requesterId: string; departmentId: string | null; organizationUnitId: string | null }>
  loadCurrentAttempt(input: { requestId: string; solutionId?: string; phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): Promise<{ id: string; attempt: number; state: string } | null>
  persistApprovalInstance(plan: ApprovalInstancePlan): Promise<ApprovalInstancePlan & { id: string; attempt: number }>
  supersedeApprovalInstance(instanceId: string): Promise<void>
  updateRequestStatus(input: { requestId: string; from: RequestStatus; to: RequestStatus }): Promise<void>
}

export interface PhaseAttemptResult {
  instance: ApprovalInstancePlan & { id: string; attempt: number }
  statusChange?: { from: RequestStatus; to: RequestStatus }
  completedWithoutSteps: boolean
  autoApproved: boolean
}

export async function createRequestApprovalAttempt(
  db: PhaseAdapterDb,
  input: { requestId: string; requesterId: string },
): Promise<PhaseAttemptResult>

export async function createSolutionApprovalAttempt(
  db: PhaseAdapterDb,
  input: { requestId: string; solutionId: string; submittedById: string },
): Promise<PhaseAttemptResult>

export async function createFinalApprovalAttempt(
  db: PhaseAdapterDb,
  input: { requestId: string; initiatorId: string },
): Promise<PhaseAttemptResult>

export async function createCustomPersonAttempt(
  db: PhaseAdapterDb,
  input: {
    requestId: string
    solutionId?: string
    phase: 'SOLUTION' | 'FINAL'
    initiatorId: string
    orderedApproverIds: string[]
  },
): Promise<PhaseAttemptResult>
```

For normal instances, every step plan has `requiredPosition`, `scopeUnitId`, and its snapshotted candidate IDs. For custom instances, every step has `requiredApproverId`, no candidate group or normal position scope, and the exact ordered person ID. For request creation, keep the current no-custom-picker input and request attachment adoption transaction. For solution submission/resubmission, preserve `useCustomApprovals`/`useCustomHierarchy`, exact ordered IDs, self exclusion, uniqueness, existence validation, and no custom auto-approval. For final initiation/resubmission, preserve `useCustomChain`, exact ordered IDs, self exclusion, and final-row identity.

- [ ] **Step 4: Integrate the three normal phase adapters**

In `requests.ts`, call `createRequestApprovalAttempt(createPrismaPhaseAdapterDb(tx), { requestId, requesterId: user.id })` inside the request transaction and transition to `SentToEngineer` for ceiling auto-approval or `COMPLETED_NO_ELIGIBLE_STEPS`; the existing request activity must include `NO_ELIGIBLE_APPROVAL_STEPS` when no pending group exists. Do not add a custom picker.

In `solutions.ts`, call the solution adapter with `submittedById: user.id`, preserve `SentToEngineer → DesignCostEstimationApproval` while pending, and `SentToEngineer → SendBackToRequester` for auto-approval or no eligible steps. Keep current solution role, assignment, cost, attachment, and rejection rules. Do not route by the original requester's branch.

For final approval, call the final adapter with `initiatorId: user.id`, retain same-department permission for legacy and direct-origin-unit membership for NEW requests, preserve `SendBackToRequester → FinalApproval` while pending, and `SendBackToRequester → Completed` for auto-approval or no eligible steps. Keep the final phase on `request_approvals` with `isFinalApproval = true`; route origin and read context are separate.

On resubmission, mark the previous current instance `SUPERSEDED`, retain its approval rows and activities, increment `attempt`, and create a new current instance from the currently published route. Do not confuse an organization edit with resubmission. Legacy in-flight rows are never rebuilt by an organization edit.

- [ ] **Step 5: Run all phase adapter regressions**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-phase-adapters.test.ts tests/regression/approval-resubmission-history.test.ts tests/regression/organization-approval-baseline.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: request, solution, and final origins are distinct; normal and custom routes preserve existing status transitions; ceiling and empty-resolved completion are auditable; prior attempt rows remain readable; all baseline assertions remain green.

### Task 8 gating, history and phase-state acceptance additions

Create `createPrismaPhaseAdapterDb(tx: Prisma.TransactionClient): PhaseAdapterDb` in `phase-adapters.ts`. Route flags affect **creation only**:

```ts
const mode = getApprovalRolloutMode(process.env)
if (mode === 'legacy') return createExistingLegacyAttempt(tx, input)
if (mode === 'shadow') {
  const legacyResult = await createExistingLegacyAttempt(tx, input)
  // Resolve NEW against a read-only adapter; emit a redacted comparison only.
  // A missing/unmapped NEW route is reported and never breaks legacy submission.
  await compareNewResolutionWithoutWrites(tx, input)
  return legacyResult
}
await assertNewCreationEnabled(tx)
return createNewAttemptWithHistory(tx, input)
```

The four internal helpers above are implemented in `phase-adapters.ts`: `createExistingLegacyAttempt` delegates to the existing phase-specific builder; `compareNewResolutionWithoutWrites` calls only the pure NEW resolver and writes no steps/status/notifications; `assertNewCreationEnabled` validates the completed import digest and current origin/route coverage from Task 15; `createNewAttemptWithHistory` builds and persists the approved NEW instance. Do not temporarily enable unconditional NEW calls before Task 15 exists; define the legacy-default gate in this task, with new-mode requests denied until activation support is implemented.

On first NEW resubmission of legacy data, retain and wrap old phase rows in a historical LEGACY_LEVEL/CUSTOM_PERSON instance before creating attempt 2. Preserve their numeric fields, actual actors, times, custom IDs and previous status; mark only their instance superseded. Every pending/action/notification query filters current instance identity for NEW data; legacy history wrapping must not expose old pending rows as current. Existing legacy resubmission in legacy mode retains existing behavior until cutover.

Keep solution/final initial auto-completion transitions distinct from last-step completion. Tests must cover both. Normal pending submission does not immediately complete. Reject and cancel update the appropriate current instance outcome and invalidate further actions atomically, without adding notification events. Attachments and existing phase-state writes stay in their existing guarded transaction.

Persist a request’s origin unit once. A later solution uses its submitter’s branch for routing but does not move the request into Engineering. Final initiation retains the existing direct-origin membership/status requirement, generalized to the typed originating unit for NEW requests; ancestor visibility alone is insufficient. Legacy rows retain the existing same-department rule. A manager’s own parent-unit request uses that unit directly, not its descendant sections.


## Task 9: Implement action eligibility and race-safe approval advancement

**Files:**
- Modify: `src/lib/request-approval-transaction.ts`
- Create: `src/lib/approval-engine/transactions.ts`
- Modify: `src/server-actions/approvals.ts`
- Modify: `src/server-actions/solutions.ts`
- Modify: `src/server-actions/requests.ts`
- Create: `tests/regression/approval-concurrency.test.ts`
- Extend: `tests/regression/request-approval-transaction.test.ts`

**Interfaces:**
- Consumes: `classifyApprovalRow`, candidate-group membership, current user active state, phase status, and existing `RequestStatusConflictError`/`updateRequestStatusExpecting` guards.
- Produces: `ApprovalEligibility`, `canUserApproveRequest`, `canUserApproveSolution`, `canUserApproveFinal`, and `advanceApprovalAtomically`.

- [ ] **Step 1: Write the failing NEW/legacy/concurrency tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { advanceApprovalAtomically } from '@/lib/approval-engine/transactions'
import {
  fakeTransactionalApprovalDb,
  fakeLegacyApprovalDb,
} from '../fixtures/organization-approval-fixtures'

describe('approval advancement', () => {
  it('allows one active member of a NEW candidate group to advance exactly once', async () => {
    const db = fakeTransactionalApprovalDb({
      approval: { id: 'a1', requestId: 'r1', routingMode: 'SNAPSHOT_GROUP', candidateUserIds: ['u1', 'u2'], status: 'pending', order: 1 },
      requestStatus: 'ImprovementRequest',
    })
    const first = await advanceApprovalAtomically(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST', comments: 'ok' })
    assert.equal(first.actualActorId, 'u1')
    await assert.rejects(
      advanceApprovalAtomically(db, { approvalId: 'a1', actorId: 'u2', phase: 'REQUEST' }),
      /pending|already|conflict/i,
    )
    assert.equal(db.statusTransitionCount('r1'), 1)
  })

  it('keeps legacy numeric-level eligibility live for a legacy row', async () => {
    const db = fakeLegacyApprovalDb({ requiredLevel: 3, userLevel: 3, status: 'pending' })
    const result = await advanceApprovalAtomically(db, { approvalId: 'legacy-a1', actorId: 'legacy-user', phase: 'REQUEST' })
    assert.equal(result.routingMode, 'LEGACY_LEVEL')
  })
})
```

`tests/fixtures/organization-approval-fixtures.ts` must export `fakeTransactionalApprovalDb(input: { approval: { id: string; requestId: string; routingMode: 'SNAPSHOT_GROUP'; candidateUserIds: string[]; status: 'pending'; order: number }; requestStatus: string }): ApprovalTransactionDb & { statusTransitionCount(requestId: string): number }` and `fakeLegacyApprovalDb(input: { requiredLevel: number; userLevel: number; status: 'pending' }): ApprovalTransactionDb`. The transactional fake applies the conditional pending-row update exactly once, records the actor and status-transition count, and its legacy variant exposes live level lookup; neither fake performs I/O.

- [ ] **Step 2: Run the concurrency test before implementing the transaction core**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-concurrency.test.ts tests/regression/request-approval-transaction.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because NEW candidate membership and conditional status advancement are not implemented.

- [ ] **Step 3: Define eligibility and transaction signatures**

```ts
import type { RequestStatus } from '@prisma/client'

export interface ApprovalRowForTransaction {
  id: string
  requestId: string
  solutionId: string | null
  instanceId: string | null
  requestStatus: RequestStatus
  instanceIsCurrent: boolean
  routingMode: 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  candidateUserIds: readonly string[]
  requiredLevel: number | null
  requiredApproverId: string | null
  status: 'pending' | 'approved' | 'rejected'
  order: number
}

export interface ApprovalTransactionDb {
  loadApprovalForUpdate(input: { approvalId: string; phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): Promise<ApprovalRowForTransaction | null>
  isActiveUser(userId: string): Promise<boolean>
  hasEarlierPendingRow(input: { requestId: string; solutionId: string | null; instanceId: string | null; phase: 'REQUEST' | 'SOLUTION' | 'FINAL'; order: number }): Promise<boolean>
  evaluateLegacyEligibility(input: { approvalId: string; actorId: string; phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): Promise<boolean>
  updatePendingApproval(input: { approvalId: string; actorId: string; phase: 'REQUEST' | 'SOLUTION' | 'FINAL'; instanceId: string | null; expectedRequestStatus: RequestStatus }): Promise<{ count: number }>
  recordApprovalActivity(input: { approvalId: string; actorId: string; comments?: string }): Promise<void>
  countPendingApprovals(input: { requestId: string; solutionId: string | null; instanceId: string | null; phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): Promise<number>
  advanceRequestStatus(input: { requestId: string; from: RequestStatus; to: RequestStatus }): Promise<void>
  setInstanceOutcome(input: { instanceId: string; outcome: 'APPROVED' | 'REJECTED' | 'CANCELLED' }): Promise<void>
}

export interface ApprovalEligibility {
  canApprove: boolean
  approvalId?: string
  routingMode?: 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  reason?: 'UNAUTHENTICATED' | 'INACTIVE_USER' | 'WRONG_STATUS' | 'NOT_CURRENT_STEP' | 'NOT_CANDIDATE' | 'LEGACY_MISMATCH' | 'CUSTOM_MISMATCH'
}

export interface AdvanceApprovalInput {
  approvalId: string
  actorId: string
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  comments?: string
}

export interface ApprovalAdvanceResult {
  actualActorId: string
  routingMode: 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  pendingApprovals: number
  statusChange?: { from: RequestStatus; to: RequestStatus }
}

export async function canUserApproveRequest(db: ApprovalTransactionDb, input: { approvalId: string; actorId: string }): Promise<ApprovalEligibility>
export async function canUserApproveSolution(db: ApprovalTransactionDb, input: { approvalId: string; actorId: string }): Promise<ApprovalEligibility>
export async function canUserApproveFinal(db: ApprovalTransactionDb, input: { approvalId: string; actorId: string }): Promise<ApprovalEligibility>

export async function advanceApprovalAtomically(
  db: ApprovalTransactionDb,
  input: AdvanceApprovalInput,
): Promise<ApprovalAdvanceResult>
```

Eligibility behavior is discriminator-specific:

- `SNAPSHOT_GROUP`: current user must exist, be active, be a member of the persisted group for the pending row, and have no earlier pending row in the same current instance. Do not read a replacement user by current position.
- `CUSTOM_PERSON`: current user must equal the ordered row's `requiredApproverId`; retain existing authentication, status, duplicate, and self-exclusion checks. Custom chains bypass normal upward and auto-approval rules only.
- `LEGACY_LEVEL`: preserve current live `User.level`, `department_approvers`, request-versus-solution distinctions, external serial rows, and status checks. Never reinterpret a legacy numeric level as a new position.

- [ ] **Step 4: Make advancement compare-and-set and phase-aware**

Inside one database transaction, first read the request/solution phase and the selected approval row, then execute a conditional update that includes `status = pending`, current instance identity, and the expected document status. If the update count is not exactly one, throw a conflict before creating activity. Record the actual actor, comments, and timestamp; count pending rows for the same instance and phase; and use `updateRequestStatusExpecting` or the equivalent solution transition guard for the last row. The request transaction core must retain its existing fail-closed behavior for missing/cancelled/non-ladder requests.

Two concurrent candidates at an any-one NEW group race on one pending row: exactly one conditional update succeeds, exactly one status transition is recorded, and the other receives a conflict with no activity or notification. A current inactive snapshot member fails closed. There is no automatic reassignment or approval of the remaining step.

Update dashboard/action-item queries to use `canUserApprove*` or the same discriminator predicate rather than merely matching `requiredLevel` or a live department. Keep action result errors stable enough for current UI handling.

- [ ] **Step 5: Run concurrency and legacy transaction regressions**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-concurrency.test.ts tests/regression/request-approval-transaction.test.ts tests/regression/approval-phase-adapters.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: one-of-many advancement is atomic, duplicate transitions are impossible, inactive candidates cannot act, legacy rows retain live numeric semantics, custom rows remain exact-person, and the existing cancellation race rollback tests remain green.

### Task 9 transaction adapter acceptance additions

The legacy eligibility adapter invokes the actual existing request/solution/final checker with department, role, external rows, custom identity, order and document status intact. Numeric equality alone is forbidden. All three phases ultimately update the request status using the existing phase-specific transitions; do not invent a `RequestStatus` column on solutions.

Implement production transactions through `prisma.$transaction` and expose a transaction-bound `ApprovalTransactionDb`; lock the owning request row before reading current instance and pending step. Reject stale instance IDs, cancelled requests, wrong phase and superseded rows. Include approval-table identity (phase), solutionId when applicable, expected status and current instance in conditional updates. Last-row completion updates the instance outcome and document status in the same transaction. Notifications are planned only by the winner and dispatched after commit; legacy in-transaction status notification persistence keeps its existing behavior.

Add real database integration test `tests/integration/organization-approval-transactions.test.ts` against a provisioned disposable CI database. Two distinct candidates execute concurrently:

```ts
const results = await Promise.allSettled([
  approveAs(firstCandidateId),
  approveAs(secondCandidateId),
])
assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
assert.equal(await countActualApprovalActivities(), 1)
assert.equal(await countPhaseTransitions(), 1)
```

In that test file, `approveAs` binds the real phase transaction adapter to the seeded row; the count helpers query real activities/request transitions scoped to the fixture request. Repeat for REQUEST/SOLUTION/FINAL and cancellation-versus-approval. Also assert one post-commit dispatch plan, not just one approved row. SQL tests are a release gate; fakes and serial double-click tests remain useful but are not substitutes.


## Task 10: Add compatibility-first notification recipient adapters

**Files:**
- Create: `src/lib/notification-recipients.ts`
- Modify: `src/server-actions/notifications.ts`
- Modify: `src/server-actions/approvals.ts`
- Modify: `src/server-actions/requests.ts`
- Modify: `src/server-actions/solutions.ts`
- Read/retain: `src/lib/post-commit-notifications.ts`
- Create: `tests/regression/notification-compatibility.test.ts`
- Extend: `tests/regression/post-commit-notifications.test.ts`, `tests/regression/solution-transaction-notifications.test.ts`

**Interfaces:**
- Consumes: approval-row routing discriminator, current snapshot group, legacy approver lookup, custom IDs, section mapping, and current notification payload types.
- Produces: `resolveApprovalNeededRecipients`, `resolveStatusBroadcastRecipients`, and `NotificationCompatibilityPolicy`.

- [ ] **Step 1: Write the failing event and recipient tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveApprovalNeededRecipients } from '@/lib/notification-recipients'
import { fakeNotificationDb } from '../fixtures/organization-approval-fixtures'

describe('compatibility-first notifications', () => {
  it('uses only the immutable current NEW candidate group', async () => {
    const recipients = await resolveApprovalNeededRecipients(fakeNotificationDb({
      row: { routingMode: 'SNAPSHOT_GROUP', candidateGroupId: 'group-1', requiredLevel: null },
      groups: { 'group-1': ['u1', 'u1', 'inactive-u2'] },
      activeUsers: ['u1'],
      livePositionHolders: ['replacement-u3'],
    }), { approvalId: 'a1', phase: 'REQUEST' })
    assert.deepEqual(recipients, ['u1'])
  })

  it('uses legacy level lookup for pre-cutover rows', async () => {
    const recipients = await resolveApprovalNeededRecipients(fakeNotificationDb({
      row: { routingMode: 'LEGACY_LEVEL', candidateGroupId: null, requiredLevel: 3 },
      legacyLevelHolders: ['legacy-u3'],
    }), { approvalId: 'legacy-a1', phase: 'REQUEST' })
    assert.deepEqual(recipients, ['legacy-u3'])
  })
})
```

`tests/fixtures/organization-approval-fixtures.ts` must export `fakeNotificationDb(input: { row: { routingMode: 'SNAPSHOT_GROUP' | 'LEGACY_LEVEL' | 'CUSTOM_PERSON'; candidateGroupId: string | null; requiredLevel: number | null }; groups?: Record<string, string[]>; activeUsers?: string[]; livePositionHolders?: string[]; legacyLevelHolders?: string[] }): NotificationRecipientDb`. Its methods return the supplied in-memory rows only; `livePositionHolders` exists to prove that NEW resolution does not consult live assignments.

- [ ] **Step 2: Run notification tests before adding the adapter**

Run through Portly:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/notification-compatibility.test.ts tests/regression/post-commit-notifications.test.ts tests/regression/solution-transaction-notifications.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: the new recipient module import fails; existing post-commit tests provide the delivery-boundary baseline.

- [ ] **Step 3: Define the recipient adapter**

```ts
export interface NotificationRecipientDb {
  findApprovalRow(input: { approvalId: string; phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): Promise<{ routingMode: 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'; candidateGroupId: string | null; requiredLevel: number | null; requiredApproverId: string | null; requestId: string; isCurrentInstance: boolean; status: string } | null>
  findCandidateGroupMemberIds(candidateGroupId: string): Promise<readonly string[]>
  findActiveUserIds(userIds: readonly string[]): Promise<readonly string[]>
  findLegacyApproverIds(input: { requestId: string; requiredLevel: number; phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): Promise<readonly string[]>
  findCustomRecipientIds(approvalId: string): Promise<readonly string[]>
  findReviewedSectionRecipientIds(input: { legacyDepartmentId: string | null; requestId: string }): Promise<readonly string[]>
}

export interface ApprovalNeededRecipientInput {
  approvalId: string
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
}

export interface NotificationCompatibilityPolicy {
  preserveEventTypes: readonly ['approval_needed', 'approval_granted', 'approval_rejected', 'status_changed', 'request_assigned', 'solution_ready', 'final_approval_needed']
  preserveCustomNotifyAllAtSubmit: true
  preserveSectionWideStatusBroadcasts: true
  allowVisibilityAsSubscription: false
}

export async function resolveApprovalNeededRecipients(
  db: NotificationRecipientDb,
  input: ApprovalNeededRecipientInput,
): Promise<readonly string[]>

export async function resolveStatusBroadcastRecipients(
  db: NotificationRecipientDb,
  input: { legacyDepartmentId: string | null; requestId: string; excludeUserIds?: readonly string[] },
): Promise<readonly string[]>
```

For `SNAPSHOT_GROUP`, load the persisted current-step group, deduplicate IDs by user ID, and filter current `User.isActive = true`. Do not read current position holders, visibility descendants, ancestor managers, or the whole organization. For `LEGACY_LEVEL`, retain `getApproversAtLevel` semantics, including request external approvers and their existing serial rows. For `CUSTOM_PERSON`, preserve ordered IDs and phase-specific timing: solution submit/resubmit notifies all; final initiation notifies only the first person; later progression targets the next person.

`resolveStatusBroadcastRecipients` maps a legacy department audience to its reviewed future section audience and excludes users exactly as the old callsite did. It must not add descendants or ancestor managers. Engineering's existing broad operational broadcast remains the existing Engineering audience/classification, not a new organization-tree subscription.

- [ ] **Step 4: Wire every existing event without adding events or channels**

Keep these event behaviors: request first pending approval, next request approval, engineering `request_assigned`, requester `status_changed`, rejection, assignment, solution ready, final approval needed, final completion, final rejection, custom solution notify-all-at-submit, custom final first-step-only notification, and existing in-app/email choices. Keep `createNotification`, `notifyUsersInDepartment`/section adapter, and post-commit dispatch in their existing after-commit locations. Direct transactional notification writes already present for current status paths remain direct writes where the current behavior requires them; do not move unrelated delivery policy in this redesign.

Do not add cancellation or request-resubmission notifications. Do not add email to existing in-app-only events. Do not add subscriptions, retry queues, dedupe keys across events, or a new delivery transport. Identity dedup is only within a resolved recipient group; race-safe approval advancement remains in Task 9. A committed workflow may still log best-effort dispatch failure as it does today.

- [ ] **Step 5: Run notification compatibility and transaction-boundary tests**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/notification-compatibility.test.ts tests/regression/post-commit-notifications.test.ts tests/regression/solution-transaction-notifications.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: NEW notifications use only active snapshot members, legacy rows use old lookup, custom submissions notify all existing IDs, section-wide broadcasts retain their current audiences/channels, and no global notification or SMTP helper runs inside an interactive transaction callback.

### Task 10 exact event compatibility matrix

| Case | Preserved audience and delivery |
|---|---|
| Request pending creation / next step | Current-step eligible group; existing in-app plus email |
| Request auto-approval at creation | No newly invented engineering event |
| Request resubmit / cancellation | No added notification |
| Custom solution submit/resubmit | All selected custom IDs immediately; next-step notification on progression retained |
| Custom final initiate/progress | First/current selected person only; never notify the whole final chain at initiation |
| Solution/final informational status broadcast | Mapped origin section’s direct members and existing exclusions; no ancestor/subtree fan-out |
| Final initial auto-completion | Existing requester in-app status_changed notification remains |
| Mark complete / existing in-app-only status paths | Retain in-app-only behavior |

For NEW parent-unit-owned requests (a new case with no legacy section audience), the origin-unit broadcast adapter uses that unit’s directly assigned active members, not descendants or ancestor managers. Existing section-origin audiences remain section-wide. Record this generalized origin-unit audience explicitly in the spec; do not use read visibility as the subscriber list. If requestDepartmentId is null, look up the persisted origin unit, never the first legacy department. Engineering handoff audiences retain reviewed engineering-section membership/classification and existing first-department behavior until separately changed.

Tests record the full event/channel/recipient sequence for each baseline fixture from Task 1, compare legacy before/after exactly, and assert only NEW pending-group lookup differs. Distinguish emit-all custom solution events from current-person custom final events. Do not infer allowed events from the notification enum alone.


## Task 11: Build one fail-closed organization visibility predicate

**Files:**
- Create: `src/lib/request-visibility/types.ts`
- Create: `src/lib/request-visibility/predicate.ts`
- Modify: `src/lib/request-access.ts`
- Create: `tests/regression/request-visibility.test.ts`

**Interfaces:**
- Consumes: active user role/department, organization branch and descendant IDs, request originating unit (section or managed parent unit), approval instance candidate groups, actual approver history, and legacy mapped relationships.
- Produces: `RequestVisibilityActor`, `RequestVisibilityOptions`, `buildRequestVisibilityWhere`, `canViewRequestByPredicate`, and the public `canUserViewRequest` wrapper.

- [ ] **Step 1: Write the role/scope/status matrix test**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildRequestVisibilityWhere, canViewRequestByPredicate } from '@/lib/request-visibility/predicate'
import { fakeVisibilityDb, canViewWithFake } from '../fixtures/organization-approval-fixtures'

describe('request visibility predicate', () => {
  it('keeps PD1 and PD2 isolated while allowing ancestor managers to see descendants', async () => {
    const pd1Staff = await buildRequestVisibilityWhere(fakeVisibilityDb(), {
      userId: 'staff-pd1', includeArchived: false,
    })
    const departmentManager = await buildRequestVisibilityWhere(fakeVisibilityDb(), {
      userId: 'department-manager', includeArchived: false,
    })
    assert.match(JSON.stringify(pd1Staff), /section-pd1/)
    assert.doesNotMatch(JSON.stringify(pd1Staff), /section-pd2/)
    assert.match(JSON.stringify(departmentManager), /department-pd/)
    assert.match(JSON.stringify(departmentManager), /section-pd1/)
    assert.match(JSON.stringify(departmentManager), /section-pd2/)
  })

  it('fails closed for inactive, null-org, deleted, and unmapped ordinary reads', async () => {
    assert.equal(await canViewWithFake({ userId: 'inactive-general', requestId: 'r1' }), false)
    assert.equal(await canViewWithFake({ userId: 'null-org-general', requestId: 'r-null-org' }), false)
    assert.equal(await canViewWithFake({ userId: 'pd1-general', requestId: 'deleted-r1' }), false)
    assert.equal(await canViewWithFake({ userId: 'pd1-general', requestId: 'unmapped-r1' }), false)
  })

  it('allows explicit candidate, historical actor, requester, admin, and engineering exceptions only', async () => {
    assert.equal(await canViewWithFake({ userId: 'candidate-u1', requestId: 'pd2-r1' }), true)
    assert.equal(await canViewWithFake({ userId: 'historical-u2', requestId: 'pd2-r1' }), true)
    assert.equal(await canViewWithFake({ userId: 'admin-u1', requestId: 'unmapped-r1' }), true)
    assert.equal(await canViewWithFake({ userId: 'engineering-u1', requestId: 'pd2-r1' }), true)
  })
})
```

`tests/fixtures/organization-approval-fixtures.ts` must export `fakeVisibilityDb(): RequestVisibilityDb` with the matrix rows named in these tests and `canViewWithFake(input: { userId: string; requestId: string }): Promise<boolean>`, implemented by calling `canViewRequestByPredicate` against an in-memory request map. Include explicit candidate-group, historical-actor, requester, admin, Engineering, inactive, null-organization, deleted, and unmapped rows; do not let the fake grant access by department name.

- [ ] **Step 2: Run visibility tests before adding the predicate**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/request-visibility.test.ts tests/regression/private-file-access.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the new predicate module is absent; the current private-file test remains the existing route contract.

- [ ] **Step 3: Define and implement the shared predicate**

```ts
import type { Prisma } from '@prisma/client'

export interface RequestVisibilityDb {
  findActor(userId: string): Promise<RequestVisibilityActor | null>
  findRequest(where: Prisma.requestsWhereInput): Promise<{ id: string } | null>
}

export interface RequestVisibilityActor {
  id: string
  role: 'admin' | 'general_dept' | 'engineering'
  isActive: boolean
  departmentId: string | null
  departmentType: 'GENERAL' | 'ENGINEERING' | null
  managedUnitIds: readonly string[]
}

export interface RequestVisibilityOptions {
  userId: string
  includeArchived: boolean
}

export async function buildRequestVisibilityWhere(
  db: RequestVisibilityDb,
  options: RequestVisibilityOptions,
): Promise<Prisma.requestsWhereInput> {
  const actor = await db.findActor(options.userId)
  if (!actor || !actor.isActive) return { id: { in: [] } }
  const base = { isDeleted: false, ...(options.includeArchived ? {} : { isArchived: false }) }
  if (actor.role === 'admin' || actor.role === 'engineering' || actor.departmentType === 'ENGINEERING') return base
  const relationships: Prisma.requestsWhereInput[] = [
    { requesterId: actor.id },
    { organizationUnitId: { in: actor.managedUnitIds } },
    { approvals: { some: { approverId: actor.id } } },
    { approvals: { some: { requiredApproverId: actor.id } } },
    { approvals: { some: { candidateGroup: { members: { some: { userId: actor.id } } } } } },
    { solutions: { some: { approvals: { some: { approverId: actor.id } } } } },
    { solutions: { some: { approvals: { some: { requiredApproverId: actor.id } } } } },
    { solutions: { some: { approvals: { some: { candidateGroup: { members: { some: { userId: actor.id } } } } } } } },
  ]
  return { AND: [base, { OR: relationships }] }
}
```

For NEW requests the owner is the requester’s primary organizational unit at submission, including parent units for managers; never require a fake section. Preserve this request attribution through subsequent phases and org edits. For ordinary users, section sharing means `organizationUnitId` equals their section. The production actor adapter reads operationalType from the current primary unit (or legacy department before cutover), not from descendant sections. Managers receive the union of their active assigned management units and descendants from `descendantUnitIds`; staff visibility must never include sibling sections merely because they share a factory manager; a parent manager intentionally sees all sibling sections beneath their managed unit. A normal candidate group and historical actual approver are explicit request relationships and may view across sections. An active requester can view their own request even when its organization mapping is absent; an ordinary non-requester with null organization is denied unless an explicit approval relationship exists. Admin and Engineering preserve the approved global operational read interpretation, but neither role gains unrelated actions.

`canViewRequestByPredicate(db, userId, requestId)` must call `buildRequestVisibilityWhere(db, { userId, includeArchived: true })`, query the request with that predicate before loading details, and return a boolean. Archive hiding is a list filter only; authorized archived details/downloads/exports remain readable. `canUserViewRequest(userId, requestId)` remains a thin production wrapper that supplies the Prisma adapter so existing download and inline-image dependencies keep their signatures.

- [ ] **Step 4: Run pure visibility and existing attachment access tests**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/request-visibility.test.ts tests/regression/private-file-access.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: PD1/PD2 isolation, manager descendants, candidate/historical exceptions, inactive/null-org/delete fail-closed behavior, archived toggle behavior, and the existing ID-based private-file contract pass.

## Task 12: Apply the same visibility predicate to every read, count, detail, file, and export surface

**Files:**
- Modify: `src/server-actions/requests.ts`
- Modify: `src/server-actions/dashboard.ts`
- Modify: `src/app/api/actions/pending-count/route.ts`
- Modify: `src/app/(dashboard)/engineering/page.tsx`
- Modify: `src/server-actions/analytics.ts`
- Modify: `src/server-actions/budget-control.ts`
- Modify: `src/server-actions/files.ts`
- Modify: `src/server-actions/reports.ts`
- Modify: `src/server-actions/audit.ts`
- Modify: `src/app/api/files/download/route.ts`
- Modify: `src/app/api/inline-images/[id]/route.ts`
- Modify: `src/app/api/audit/export/request/[requestId]/route.ts`
- Modify: `src/app/api/audit/export/date-range/route.ts`
- Modify: `src/app/api/admin/retention/backup/route.ts`
- Modify: `src/server-actions/engineering-sub-tasks.ts`
- Extend: `tests/regression/request-visibility.test.ts`, `tests/regression/export-builder-wiring.test.ts`

**Interfaces:**
- Consumes: `buildRequestVisibilityWhere`/`canUserViewRequest` from Task 11 and existing filter/status clauses.
- Produces: every ordinary request query composed as `AND: [visibilityWhere, filters]`, direct detail authorization before relation loading, and consistent visibility-based counts.

- [ ] **Step 1: Write failing callsite contracts**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('visibility caller contracts', () => {
  it('guards direct detail, list, counts, exports, and files with the shared policy', () => {
    for (const path of [
      'src/server-actions/requests.ts',
      'src/server-actions/dashboard.ts',
      'src/app/(dashboard)/engineering/page.tsx',
      'src/server-actions/analytics.ts',
      'src/server-actions/budget-control.ts',
      'src/server-actions/files.ts',
      'src/app/api/inline-images/[id]/route.ts',
      'src/server-actions/reports.ts',
      'src/app/api/files/download/route.ts',
    ]) {
      const source = read(path)
      assert.match(source, /buildRequestVisibilityWhere|canUserViewRequest/)
    }
  })

  it('keeps admin audit and retention paths protected and deleted-record aware', () => {
    for (const path of [
      'src/server-actions/audit.ts',
      'src/app/api/audit/export/request/[requestId]/route.ts',
      'src/app/api/audit/export/date-range/route.ts',
      'src/app/api/admin/retention/backup/route.ts',
    ]) {
      const source = read(path)
      assert.match(source, /requireAdmin|admin/i)
      // Privileged retention may intentionally include deleted history.
    }
  })

  it('checks getRequest authorization before returning attachments or activities', () => {
    const source = read('src/server-actions/requests.ts')
    assert.match(source, /getRequest[\s\S]*canUserViewRequest[\s\S]*findUnique/)
  })
})
```

- [ ] **Step 2: Run the callsite contracts to identify uncovered surfaces**

Run through Portly:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/request-visibility.test.ts tests/regression/export-builder-wiring.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL for the callers that still construct role/department-specific where clauses or load `getRequest` by ID without authorization.

- [ ] **Step 3: Wire request list, detail, filter, and action reads**

In `getMyRequests`, build the visibility predicate first, then combine it with status, archive, search, department, requester, date, and work-requisition filters under `AND`; never assign a filter's `OR` over the visibility `OR`. In `getRequest`, call `canUserViewRequest(userId, id)` before the large include and throw the existing not-found/forbidden response without exposing relation data. `getRequestFilterOptions` derives departments/requesters from visible requests with relational queries, not a full in-memory ID list. Define `createRequestVisibilityDb(db: Prisma.TransactionClient): RequestVisibilityDb`; raw Prisma does not implement findActor/findRequest. Define `buildRequestFilters` explicitly in requests.ts or compose existing filters inline.

In `getMyActionItems`, `getPendingMyApprovals`, and `/api/actions/pending-count`, use action eligibility and current-step discriminator queries for action counts. Apply ordinary request visibility to the returned request payload, but do not turn view permission into approval permission. A candidate member may both view and act only when the action predicate also passes.

- [ ] **Step 4: Wire engineering, analytics, budget, files, inline images, reports, and exports**

Apply the predicate to every `findMany` and `count` in the engineering worklist and quick stats, all analytics datasets and previous-period/trend counts, budget monitor requests and visible usage, and engineering sub-task request lookup. Keep Engineering's broad read scope but preserve action checks for assignment/sub-task operations.

`deleteFileAttachment` and `uploadFileAction` must retain write-specific guards in addition to read authorization. Section sharing never grants attachment mutation authority. Downloads need read authorization only. Keep `canReadInlineImage` delegating to `canUserViewRequest` for request/solution references and retain template-specific rules. PDF report builders and request-package exports must call the shared predicate rather than their own role/department comparison. Preserve explicitly privileged admin audit/retention/backup semantics, including intentional deleted-record history. Do not apply ordinary list exclusions to recovery backups. Keep these surfaces separate from ordinary exports; retain admin guards and test non-admin rejection. Ordinary document exports use the shared read policy.

- [ ] **Step 5: Use safe filter composition and run direct-surface tests**

A representative list query must have this shape:

```ts
const visibilityWhere = await buildRequestVisibilityWhere(createRequestVisibilityDb(prisma), {
  userId: currentUser.id,
  includeArchived: filters?.includeArchived === true,
})
const requestWhere: Prisma.requestsWhereInput = {
  AND: [visibilityWhere, buildRequestFilters(filters)],
}
const requests = await prisma.requests.findMany({ where: requestWhere })
```

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/request-visibility.test.ts tests/regression/private-file-access.test.ts tests/regression/export-builder-wiring.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: list/search/count/detail/file/inline/export callers share one predicate; a direct ID request from PD2 cannot be opened by PD1; managers see all descendants in their scope; staff cannot cross sections; inactive/null-org/unmapped ordinary actors fail closed; and Engineering/Admin broad reads remain reads only.

## Task 13: Separate server action permissions from view and UI button gating

**Files:**
- Create: `src/lib/action-permissions.ts`
- Modify: `src/lib/permission-checks.ts`
- Modify: `src/server-actions/requests.ts`
- Modify: `src/server-actions/approvals.ts`
- Modify: `src/server-actions/solutions.ts`
- Modify: `src/server-actions/files.ts`
- Modify: `src/server-actions/engineering-sub-tasks.ts`
- Modify: `src/components/requests/request-modal-router.tsx`
- Create: `tests/regression/action-permissions.test.ts`

**Interfaces:**
- Consumes: active actor, request status/ownership/assignment, current approval eligibility, and independent visibility decisions.
- Produces: `RequestAction`, `ActionPermissionContext`, `evaluateRequestAction`, `getRequestActionCapabilities`, and UI `shouldShowActionButton` decisions.

- [ ] **Step 1: Write the failing permission matrix**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateRequestAction } from '@/lib/action-permissions'

describe('action permissions are independent from visibility', () => {
  it('does not grant operations merely because Engineering/Admin can read', () => {
    const context = {
      actor: { id: 'engineering-1', role: 'engineering', isActive: true, departmentId: 'eng', departmentType: 'ENGINEERING' },
      request: { requesterId: 'requester-1', departmentId: 'pd1', organizationUnitId: 'section-pd1', status: 'SentToEngineer' },
      canView: true,
      approval: { canApprove: false },
      assignedEngineer: false,
      existingActionDecisions: {
        ASSIGN_ENGINEERS: { allowed: true, reason: 'ALLOWED' },
        RESUBMIT_REQUEST: { allowed: false, reason: 'NOT_OWNER' },
        APPROVE_REQUEST: { allowed: false, reason: 'NOT_PENDING_APPROVAL' },
      },
    } as const
    assert.equal(evaluateRequestAction('ASSIGN_ENGINEERS', context).allowed, true)
    assert.equal(evaluateRequestAction('RESUBMIT_REQUEST', context).allowed, false)
    assert.equal(evaluateRequestAction('APPROVE_REQUEST', context).allowed, false)
  })

  it('retains ownership, role, assignment, phase, and status guards', () => {
    const context = {
      actor: { id: 'other-user', role: 'general_dept', isActive: true, departmentId: 'pd1', departmentType: 'GENERAL' },
      request: { requesterId: 'requester-1', departmentId: 'pd1', organizationUnitId: 'section-pd1', status: 'ImprovementRequest' },
      canView: true,
      approval: { canApprove: false },
      assignedEngineer: false,
      existingActionDecisions: {
        RESUBMIT_REQUEST: { allowed: false, reason: 'NOT_OWNER' },
        INITIATE_FINAL_APPROVAL: { allowed: false, reason: 'WRONG_STATUS' },
      },
    } as const
    assert.equal(evaluateRequestAction('RESUBMIT_REQUEST', context).allowed, false)
    assert.equal(evaluateRequestAction('INITIATE_FINAL_APPROVAL', context).allowed, false)
  })
})
```

- [ ] **Step 2: Run the permission test before adding the policy module**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/action-permissions.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because `src/lib/action-permissions.ts` does not yet exist.

- [ ] **Step 3: Define the action policy and server guards**

```ts
export type RequestAction =
  | 'RESUBMIT_REQUEST'
  | 'SUBMIT_SOLUTION'
  | 'RESUBMIT_SOLUTION'
  | 'RESUBMIT_FINAL_APPROVAL'
  | 'UPLOAD_ATTACHMENT'
  | 'DELETE_ATTACHMENT'
  | 'INITIATE_FINAL_APPROVAL'
  | 'APPROVE_REQUEST'
  | 'REJECT_REQUEST'
  | 'APPROVE_SOLUTION'
  | 'REJECT_SOLUTION'
  | 'APPROVE_FINAL'
  | 'REJECT_FINAL'
  | 'EDIT_REQUEST'
  | 'CANCEL_REQUEST'
  | 'ASSIGN_ENGINEERS'
  | 'MANAGE_SUB_TASKS'
  | 'EXPORT_PDF'

export interface ActionPermissionContext {
  actor: { id: string; role: string; isActive: boolean; departmentId: string | null; departmentType: string | null }
  request: { requesterId: string; departmentId: string | null; organizationUnitId: string | null; status: string }
  canView: boolean
  approval: { canApprove: boolean } | null
  assignedEngineer: boolean
  existingActionDecisions: Readonly<Partial<Record<RequestAction, ActionDecision>>>
}

export interface ActionDecision {
  allowed: boolean
  reason: 'ALLOWED' | 'NOT_VISIBLE' | 'INACTIVE' | 'NOT_OWNER' | 'WRONG_ROLE' | 'WRONG_STATUS' | 'NOT_ASSIGNED' | 'NOT_PENDING_APPROVAL'
}

export function evaluateRequestAction(action: RequestAction, context: ActionPermissionContext): ActionDecision
export async function getRequestActionCapabilities(requestId: string): Promise<Record<RequestAction, ActionDecision>>
export function shouldShowActionButton(action: RequestAction, decision: ActionDecision): boolean
```

Server actions must call the policy after authentication and before mutation. Preserve the existing rules: resubmit request is owner/status constrained; solution submission and resubmission retain engineering role/phase/assignment rules; final initiation retains legacy requester-department or NEW direct-origin-unit membership/status rules; approval/rejection require current pending-step eligibility and document-state checks; edit/cancel/assign/sub-task operations retain their current action-specific guards. `canView` is never used as a substitute for those checks.

- [ ] **Step 4: Gate buttons from capabilities without treating hidden UI as security**

Add `getRequestActionCapabilities(requestId)` as a server-derived capability payload, deriving identity from the authenticated session rather than a client-supplied userId. `RequestModalRouter` and existing modal buttons use it to hide or disable controls, while every server action independently evaluates the same policy. Keep read-only modal rendering for users who can view but cannot act. Do not add an initial request custom picker or candidate reassignment controls.

- [ ] **Step 5: Run action and existing UI permission regressions**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/action-permissions.test.ts tests/regression/custom-approval-picker-search.test.ts tests/regression/request-modal-header.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: viewable-but-not-actionable actors remain blocked server-side, buttons reflect capabilities, current custom picker behavior remains limited to solution/final surfaces, and no permission is widened by organization visibility.

### Task 13 compatibility adapter boundary

Do not replace mature action checks with a new role/status table inferred from the small example context. Extract or call each existing action guard and return its decision through `existingActionDecisions`. The server builds this map from persisted role, ownership, assignment, current phase and status; no client-provided map is accepted. `evaluateRequestAction` composes active/read checks with those action-specific results and the current-step checker; missing action evidence denies access. UI capabilities use those same guards, rather than a second handwritten interpretation.

Add explicit cases for solution resubmit, final resubmit, attachments, final initiation and request cancellation. For ordinary section-origin requests, retain same-section final-initiation semantics. For NEW parent-unit requests, direct origin-unit membership replaces legacy same-department membership; managing descendants/being able to read is not membership. Existing engineering assignment permission remains role-based where source says so, not PIC-only by invention.

Task 13 fake contexts must provide explicit existingActionDecisions for the tested actions. The positive ASSIGN_ENGINEERS case exercises the extracted existing engineering guard, while RESUBMIT_REQUEST and APPROVE_REQUEST remain false. Include a manager who sees all descendant requests but cannot initiate final approval for a section of which they are not a direct member.


## Task 14: Add organization administration and preserve a legacy hierarchy view

**Files:**
- Modify: `src/server-actions/users.ts`
- Modify: `src/components/admin/user-form.tsx`
- Modify: `src/components/admin/create-user-dialog.tsx`
- Modify: `src/components/admin/edit-user-dialog.tsx`
- Modify: `src/components/admin/user-table.tsx`
- Create: `src/server-actions/organization.ts`
- Create: `src/app/admin/organization/page.tsx`
- Create: `src/components/admin/organization/OrganizationEditor.tsx`
- Create: `src/components/admin/organization/OrganizationUnitTree.tsx`
- Create: `src/components/admin/organization/PositionAssignmentTable.tsx`
- Create: `src/components/admin/organization/ReportingGroupEditor.tsx`
- Modify: `src/app/admin/hierarchy/page.tsx`
- Modify: `src/server-actions/hierarchy.ts`
- Create: `tests/regression/organization-admin-ui.test.ts`

**Interfaces:**
- Consumes: organization repository/validation, `requireAdmin`, pending-instance counts, and reviewed mapping status.
- Produces: admin-only `createOrganizationUnit`, `updateOrganizationUnit`, `savePositionAssignment`, `saveReportingGroup`, and `getOrganizationAdminData` actions plus a clearly labeled legacy hierarchy compatibility surface.

- [ ] **Step 1: Write failing admin organization contracts**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('organization admin UI contracts', () => {
  it('exposes typed organization, position, reporting-group, and mapping status controls', () => {
    const page = read('src/app/admin/organization/page.tsx')
    const editor = read('src/components/admin/organization/OrganizationEditor.tsx')
    assert.match(page, /getOrganizationAdminData/)
    assert.match(editor, /PositionAssignmentTable/)
    assert.match(editor, /ReportingGroupEditor/)
    assert.match(editor, /mapping/i)
  })

  it('does not expose candidate reassignment or old numeric drag mutation as the NEW editor', () => {
    const editor = read('src/components/admin/organization/OrganizationEditor.tsx')
    assert.doesNotMatch(editor, /reassignCandidate|candidate.*replacement/i)
    const legacy = read('src/app/admin/hierarchy/page.tsx')
    assert.match(legacy, /legacy|compatibility|readOnly/i)
  })
})
```

- [ ] **Step 2: Run the admin UI contracts before adding the page**

Run through Portly:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/organization-admin-ui.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the new admin organization page and components are absent.

- [ ] **Step 3: Implement admin-only organization actions**

Use these signatures:

```ts
export async function getOrganizationAdminData(): Promise<{
  units: OrganizationUnitNode[]
  assignments: OrganizationPositionAssignment[]
  reportingGroups: ReportingGroupNode[]
  mappingCoverage: OrganizationImportReport
  pendingInstanceCounts: Record<string, number>
}>

export async function createOrganizationUnit(input: {
  id?: string
  name: string
  unitType: OrganizationUnitType
  parentId: string | null
}): Promise<{ id: string }>

export async function updateOrganizationUnit(input: {
  id: string
  name: string
  parentId: string | null
  isActive: boolean
}): Promise<{ success: true }>

export async function savePositionAssignment(input: {
  userId: string
  unitId: string
  positionCode: OrganizationPositionCode
  reportingGroupId: string | null
  isPrimary: boolean
  isActive: boolean
}): Promise<{ success: true }>

export async function saveReportingGroup(input: {
  id?: string
  unitId: string
  parentGroupId: string | null
  name: string
  memberUserIds: string[]
}): Promise<{ id: string }>
```

Each action calls `requireAdmin`, validates parent type and acyclicity, rejects ambiguous primary assignments, and writes an audit record. Organization edits do not update any pending approval row or candidate group. Deactivation is explicit and visible in the UI; it does not activate a replacement. The editor shows reviewed mapping coverage; the rollout gate blocks NEW mode when the dry-run report has blockers.

- [ ] **Step 4: Build the organization and legacy views**

`OrganizationUnitTree` edits only typed unit parents and active state. `PositionAssignmentTable` separates system role display from position and unit scope. `ReportingGroupEditor` manages branch membership and does not duplicate parent managers into sections. The organization page offers links to route editing and preview. Update user create/edit forms and server validation so a NEW manager can be created with a system role plus valid parent-unit position assignment, with no legacy department or numeric level. Do not clear existing legacy fields still serving legacy attempts. User-table display uses the typed unit/position for mapped users and a labeled legacy fallback otherwise. Add an admin UI test creating a Factory Manager with departmentId=null and verifying no main/additional section selection is required.

Change the existing hierarchy page/action to label numeric levels and `department_approvers` as legacy compatibility data. Preserve any existing legacy-only management behavior needed for in-flight rows, but reject writes that target NEW organization assignments, routes, instances, or candidate groups and never imply that numeric levels are the six positions. Keep the old page available until all legacy in-flight rows are retired.

- [ ] **Step 5: Run admin contracts and organization unit tests**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/organization-admin-ui.test.ts tests/regression/organization-tree.test.ts tests/regression/approval-route-admin.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: admin-only organization and route controls exist, parent/cycle validation remains enforced, mapping blockers are visible, the old hierarchy is clearly compatibility-only, and no candidate reassignment UI appears.

## Task 15: Add controlled mapping application, rollout gates and verification

**Files:**
- Extend: `src/lib/approval-rollout.ts`
- Create: `scripts/verify-organization-rollout.ts`
- Create: `scripts/apply-reviewed-organization-mapping.ts`
- Create: `tests/regression/organization-mapping-apply.test.ts`
- Create: `tests/regression/organization-rollout.test.ts`

**Interfaces:**
- Consumes: reviewed mapping report, schema discriminator counts, current/pending attempt rows, route publication state, candidate groups, and notification policy.
- Produces: `ApprovalRolloutMode`, `getApprovalRolloutMode`, `OrganizationRolloutVerification`, `verifyOrganizationRollout`, and a read-only verification CLI.

- [ ] **Step 1: Write failing rollout gate tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getApprovalRolloutMode, verifyOrganizationRollout } from '@/lib/approval-rollout'
import { fakeRolloutDb } from '../fixtures/organization-approval-fixtures'

describe('organization approval rollout', () => {
  it('defaults to legacy and does not enable NEW writes without an explicit mode', () => {
    assert.equal(getApprovalRolloutMode({}), 'legacy')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ORG_ROUTING_MODE: 'shadow' }), 'shadow')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ORG_ROUTING_MODE: 'new' }), 'new')
  })

  it('blocks cutover when reviewed mapping or legacy discriminator verification has blockers', async () => {
    const report = await verifyOrganizationRollout(fakeRolloutDb({
      mappingBlockers: ['USER_NOT_MAPPED:u7'],
      legacyRowsWithoutDiscriminator: 2,
      publishedRouteConflicts: 0,
    }))
    assert.equal(report.readyForNewAttempts, false)
    assert.deepEqual(report.blockers, [
      'MAPPING_BLOCKERS_PRESENT',
      'LEGACY_ROWS_WITHOUT_DISCRIMINATOR',
    ])
  })
})
```

`tests/fixtures/organization-approval-fixtures.ts` must export `fakeRolloutDb(input: { mappingBlockers: string[]; legacyRowsWithoutDiscriminator: number; publishedRouteConflicts: number }): RolloutVerificationDb` with read-only methods returning those counts and zero inactive/missing-group rows unless explicitly supplied. It must not call Prisma or mutate process state.

- [ ] **Step 2: Run rollout tests before adding the gate**

Run through Portly:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/organization-rollout.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because rollout mode and verification functions are absent.

- [ ] **Step 3: Implement explicit legacy, shadow, and new modes**

```ts
export type ApprovalRolloutMode = 'legacy' | 'shadow' | 'new'

export function getApprovalRolloutMode(env: NodeJS.ProcessEnv): ApprovalRolloutMode {
  const mode = env.APPROVAL_ORG_ROUTING_MODE
  if (mode === 'shadow' || mode === 'new') return mode
  return 'legacy'
}

export interface RolloutVerificationDb {
  loadMappingBlockers(): Promise<string[]>
  countLegacyRowsWithoutDiscriminator(): Promise<number>
  countPublishedRouteConflicts(): Promise<number>
  countInactiveSnapshotCandidates(): Promise<number>
  countPendingSnapshotGroupsMissing(): Promise<number>
}

export interface OrganizationRolloutVerification {
  mappingBlockers: string[]
  legacyRowsWithoutDiscriminator: number
  publishedRouteConflicts: number
  inactiveSnapshotCandidates: number
  pendingSnapshotGroupsMissing: number
  readyForShadow: boolean
  readyForNewAttempts: boolean
  blockers: string[]
}

export async function verifyOrganizationRollout(
  db: RolloutVerificationDb,
): Promise<OrganizationRolloutVerification> {
  const [mappingBlockers, legacyRowsWithoutDiscriminator, publishedRouteConflicts, inactiveSnapshotCandidates, pendingSnapshotGroupsMissing] = await Promise.all([
    db.loadMappingBlockers(),
    db.countLegacyRowsWithoutDiscriminator(),
    db.countPublishedRouteConflicts(),
    db.countInactiveSnapshotCandidates(),
    db.countPendingSnapshotGroupsMissing(),
  ])
  const blockers: string[] = []
  if (mappingBlockers.length > 0) blockers.push('MAPPING_BLOCKERS_PRESENT')
  if (legacyRowsWithoutDiscriminator > 0) blockers.push('LEGACY_ROWS_WITHOUT_DISCRIMINATOR')
  if (publishedRouteConflicts > 0) blockers.push('PUBLISHED_ROUTE_CONFLICTS')
  if (pendingSnapshotGroupsMissing > 0) blockers.push('PENDING_SNAPSHOT_GROUP_MISSING')
  return {
    mappingBlockers,
    legacyRowsWithoutDiscriminator,
    publishedRouteConflicts,
    inactiveSnapshotCandidates,
    pendingSnapshotGroupsMissing,
    readyForShadow: blockers.length === 0,
    readyForNewAttempts: blockers.length === 0,
    blockers,
  }
}
```

Legacy mode is the safe default. Shadow mode resolves the NEW route for comparison and records differences without writing approval rows, changing status, or sending NEW notifications. New mode applies only to attempts created after the gate; it never rewrites pre-cutover in-flight rows. Verification is read-only and checks zero mapping blockers, zero ambiguous published routes, zero discriminator gaps, valid current instances, and zero pending snapshot rows whose stored group is missing. It reports inactive candidate members but does not replace or approve them.

- [ ] **Step 4: Implement the verification CLI and staged gates**

`scripts/verify-organization-rollout.ts` accepts `--mapping-report <path>`, queries current data read-only, and writes a JSON verification report. Guard its executable entry point so importing `verifyOrganizationRollout` performs no I/O and `--help` exits before constructing a database client. The staged release sequence is:

1. Run the dry-run import against the externally supplied reviewed mapping; an authorized human reviews every department, unit, engineering classification, position assignment, reporting group, external approver, and legacy level 1–10 mapping.
2. Apply the additive schema only through the production release process; never apply it from this repository task or a local developer database.
3. With legacy-default code deployed, an authorized release operator runs the reviewed mapping apply step below. Backfill stored request origins and seed explicitly approved routes, then verify persisted data matches the signed input; a dry-run report alone is not imported data.
4. Run `shadow` mode on representative new attempts; compare route scope, ceiling, skipped vacancies, origin, candidate IDs, status transitions, visibility, action permissions, and notification recipients.
5. Enable `new` mode only after mapping and shadow gates pass. New attempts use current published routes; legacy in-flight attempts remain on `LEGACY_LEVEL`.
6. Rollback pauses NEW attempt creation for users/units without a valid legacy context. Only legacy-compatible origins may resume legacy creation; never invent a section for a parent-only manager. Existing NEW attempts always continue through their persisted discriminator, never the environment flag. Preserve all audit rows.

No gate authorizes an automatic production mapping, numeric compression, candidate reassignment, or production migration from a local worktree.

- [ ] **Step 5: Run rollout tests and verify the CLI is read-only**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/organization-rollout.test.ts && npx tsx scripts/verify-organization-rollout.ts --help' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: legacy is the default, blockers prevent NEW cutover, help does not access or mutate data, and the verification path contains no write operation.

### Task 15 controlled mapping application and runtime gate

Implement `applyReviewedOrganizationMapping(tx: Prisma.TransactionClient, mapping: ReviewedOrganizationMapping): Promise<OrganizationImportReport>` in `src/lib/organization/mapping.ts`; expose it only through `scripts/apply-reviewed-organization-mapping.ts` for an authorized release process. Default CLI behavior is dry-run. Write mode requires explicit `--apply`, reviewed input digest, approved target identity and a fresh zero-blocker validation. Never expose it as a general web action or run it against production locally.

Within a single transaction: lock the import identity; revalidate users/departments and mapping references; upsert stable-ID units in parent-first order; create reviewed groups/members/assignments including primary flags; attach legacy department→section links; backfill each historical request’s origin from its legacy department; preserve legacy approval/user fields; compare persisted results to the input; commit an import audit record with input digest and row counts. Reject conflicting existing IDs rather than overwrite unrelated assignments. Rerunning the same digest is idempotent; changed mappings require a fresh reviewed digest. Scope-only managers receive parent assignments without clearing legacy fields still required by pending legacy attempts.

Add `organization_import_runs` schema fields in Task 2 (`id`, unique `mappingDigest`, `appliedAt`, `appliedBy`, `targetIdentity`, `counts` JSON). Route setup uses Task 6 publication API under admin authority; importer does not invent ceilings or routes. Runtime activation needs verified persisted mapping and route coverage, not merely a user-supplied report file.

`assertNewCreationEnabled` checks activation mode, `APPROVAL_ORG_MAPPING_DIGEST` against a completed database import record, and current primary-assignment/route coverage for the actor’s origin/phase. The release process sets the digest only after read-only verification passes; a caller cannot enable routing with an uploaded report. A corrupt or stale mapping, missing published route or absent primary assignment is a configuration error, not an empty/vacant route. Keep document routing checks in the same transaction snapshot as creation. Imported origin-unit visibility is enabled only after full backfill coverage; before that retain the guarded legacy visibility adapter, including the corrected direct-detail check. Never disable read/action checks during migration.

Add tests for zero-write dry-run, idempotent replay, stale digest rejection, conflicting IDs, request-origin backfill, parent-manager assignment without a section, and rollback preserving old approvals. CI must apply the additive migration to an ephemeral copy containing legacy rows and run the importer twice, verify row counts/history, and test new parent-unit request creation. This is release evidence, not permission to run production migrations locally.


## Task 16: Final integrated regression, `npm run check`, and graph refresh

**Files:**
- Modify only source/test files already named in Tasks 1–15 during implementation.
- In this final task only, refresh the graph metadata as a generated project artifact; do not add product schema, migration, or documentation files.

**Interfaces:**
- Consumes: all task outputs and the approved spec.
- Produces: a checked implementation in the isolated worktree with preserved legacy behavior and graph metadata refreshed after implementation.

- [ ] **Step 1: Add the final cross-layer matrix test**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { phaseStatusExpectation } from '../fixtures/organization-approval-fixtures'

describe('organization approval redesign cross-layer matrix', () => {
  it('covers all phase completion transitions without adding financial routing', () => {
    assert.deepEqual(phaseStatusExpectation('REQUEST'), { from: 'ImprovementRequest', to: 'SentToEngineer' })
    assert.deepEqual(phaseStatusExpectation('SOLUTION'), { from: 'DesignCostEstimationApproval', to: 'SendBackToRequester' })
    assert.deepEqual(phaseStatusExpectation('FINAL'), { from: 'FinalApproval', to: 'Completed' })
  })
})
```

This fixture sanity check is supplemental only. Add actual cross-layer calls through the request/solution/final adapters, comparing persisted steps, visibility decisions, action capabilities and emitted payloads for the approved actors; do not claim integration coverage from constants. Add them to `tests/regression/organization-approval-baseline.test.ts` or the phase tests. `tests/fixtures/organization-approval-fixtures.ts` must export `phaseStatusExpectation(phase: 'REQUEST' | 'SOLUTION' | 'FINAL'): { from: string; to: string }` using the three existing transitions. Fake tests cannot prove SQL locking or migration integrity. Add owner-provisioned disposable CI PostgreSQL tests against actual adapters. Start competing approvals concurrently with Promise.allSettled and prove one transition. Never run these against a developer/production database; missing CI evidence blocks cutover, not permission to use production.

- [ ] **Step 2: Run targeted regression groups through Portly**

Run each group separately so a reviewer can identify the failing seam:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/organization-schema.test.ts tests/regression/organization-tree.test.ts tests/regression/organization-import-dry-run.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"

portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-route-resolution.test.ts tests/regression/approval-route-admin.test.ts tests/regression/approval-engine-resolution.test.ts tests/regression/approval-phase-adapters.test.ts tests/regression/approval-resubmission-history.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"

portly status
job_id="$(portly temp 'npx tsx --test tests/regression/approval-concurrency.test.ts tests/regression/request-approval-transaction.test.ts tests/regression/notification-compatibility.test.ts tests/regression/post-commit-notifications.test.ts tests/regression/solution-transaction-notifications.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"

portly status
job_id="$(portly temp 'npx tsx --test tests/regression/request-visibility.test.ts tests/regression/private-file-access.test.ts tests/regression/action-permissions.test.ts tests/regression/organization-admin-ui.test.ts tests/regression/organization-rollout.test.ts' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: every targeted group passes, with failures attributable to a precise task rather than a broad end-to-end timeout. Verify explicitly that initial request creation still has no custom picker, custom solution/final chains remain unrestricted ordered person lists, NEW inactive candidates fail closed, legacy in-flight rows still use numeric semantics, and section-wide notifications do not expand to ancestor/descendant managers.

- [ ] **Step 3: Run the repository-required check after all code changes**

Run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'npm run check' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: `npx tsc --noEmit`, `npm run test:manage`, and `npx tsx --test tests/regression/*.test.ts` all pass. This is a future execution command; this documentation task does not claim it has run.

- [ ] **Step 4: Refresh graphify only after implementation changes**

After source/schema/test implementation is complete and `npm run check` passes, run:

```bash
EXECUTION_WORKTREE=/absolute/path/to/the/isolated/worktree
portly status
job_id="$(portly temp 'graphify update .' --path "$EXECUTION_WORKTREE" --timeout 30m)"
portly wait "$job_id"
```

Expected: graphify updates only from the isolated execution worktree, preserving its audit trail. Do not run this during the documentation-only task.

## Requirement → task coverage matrix

| Approved requirement | Task coverage |
|---|---|
| Behavioral baseline and preserved action/status regression | 1, 8, 9, 16 |
| Separate typed organization units, roles, positions, and reporting groups | 2, 3, 14 |
| Factory → Division → Department → Section tree and parent-manager scope | 3, 11, 14 |
| Reviewed legacy mapping and dry-run import with no name inference or blind 1–10 compression | 4, 15 |
| Explicit versioned admin routes, upward ordering, ceiling, nearest-ancestor precedence, one publication per scope/phase, no financial rules | 5, 6, 15 |
| NEW immutable candidate groups, route context, skip reasons, attempt history, and legacy discriminator | 2, 7, 8, 9 |
| Request, solution, and final adapters with correct phase origins and existing business transitions | 8, 9 |
| Custom ordered person chains, self exclusion, no custom auto-approval, no initial request picker | 1, 8, 10, 13 |
| Ceiling auto-approval, vacancy skip, empty-resolved completion with `NO_ELIGIBLE_APPROVAL_STEPS` | 5, 7, 8, 9, 10 |
| Any-one semantics and race-safe single advancement | 9, 10 |
| Snapshot inactivity fail closed, no replacement or implicit reassignment | 7, 9, 10, 14 |
| Shared visibility across list/search/count/detail/activity/solutions/files/inline previews/downloads/exports | 11, 12 |
| Section sharing, descendant manager visibility, PD1/PD2 isolation, Engineering/Admin read scope, historical/candidate exceptions | 3, 11, 12 |
| Inactive/null-org/deleted fail-closed behavior | 3, 11, 12 |
| Action-specific server permissions separate from view and button gating | 9, 12, 13 |
| Compatibility-first notification events/channels/custom notify-all/section-wide broadcasts | 10, 12, 16 |
| Admin organization/position/reporting-group UI and route UI with preview | 6, 14 |
| Controlled staged rollout, human mapping gate, no production migration locally, verification | 4, 15, 16 |
| Portly execution, `npm run check`, graphify update after implementation | Global constraints, 2–16 |

## Unresolved issues and rollout dependencies

The user confirmed manager-created requests belong to the managed unit, without a section assignment. Parent technical findings are addressed by the acceptance additions in the relevant tasks. Remaining external gates are:

1. The external reviewed mapping file must supply every production department, active user, external approver, organizational parent, reporting group, engineering classification, and encountered legacy level mapping before NEW mode can be enabled. The plan intentionally does not supply production values.
2. If every member of a NEW pending candidate group becomes inactive, the approved behavior is fail-closed pending state with no automatic replacement or approval. A separately approved, audited operational recovery mechanism would be needed to move that document; no recovery UI is included here.
3. Document/value route conditions remain an extension point. This delivery publishes only explicit position steps and a maximum position level; it introduces no financial or threshold product rule.

## Parent review disposition

Parent personally read the complete draft and checked final-initiation and notification behavior against source on 2026-09-05. Corrections and additional acceptance requirements below are part of this plan. No application code/database changes have been made. Examples are implementation contracts, not verified application code; signatures without bodies are interfaces to implement, not declarations to paste as runtime code.

- Each task closes its own red/green cycle and runs `npm run check` via Portly. After passing checks, commit only that task's named files in the isolated worktree.
- Extend fixtures in each consuming task. Pure domain test IDs may be short strings; Prisma/API integration fixtures use UUIDs.
- Source-string checks supplement behavioral tests, never replace authorization/concurrency/migration evidence.
- Graph refresh is `graphify update .` after implementation changes, not documentation edits.
