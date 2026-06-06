# Engineering Sub-tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add request-attached engineering sub-tasks, WR tracking, and follow-up filters without changing the approval workflow.

**Architecture:** Add Prisma models for sub-tasks, stages, and subcontractors, plus WR fields on requests. Implement focused server actions in a new engineering follow-up module, render a collapsed `Sub-tasks` panel inside request modals, and extend existing dashboard/request/engineering filters using the same request visibility boundaries already used by the app.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Prisma/PostgreSQL, shadcn/Radix UI, Tailwind, Node test runner with `tsx`, Playwright for rendered smoke checks.

---

## File Structure

- Modify `prisma/schema.prisma`: add `request_sub_tasks`, `sub_task_stages`, `sub_contractors`, request WR fields, and user/request relations.
- Create `prisma/migrations/20260606000000_add_engineering_sub_tasks/migration.sql`: SQL migration for the new tables, indexes, foreign keys, and default stages.
- Modify `prisma/seed.ts`: ensure the default global stages are present.
- Create `src/lib/engineering-sub-tasks.ts`: pure helpers for visible request statuses, WR filtering, stale filtering, and display labels.
- Create `src/server-actions/engineering-sub-tasks.ts`: authenticated server actions for sub-task CRUD, stages, subcontractors, WR toggle, and stale filter data.
- Modify `src/server-actions/requests.ts`: include sub-tasks and WR fields in `getRequest`, list rows, and `/requests` filtering.
- Modify `src/server-actions/dashboard.ts`: include WR fields in row data for dashboard filtering.
- Create `src/components/requests/sub-tasks-section.tsx`: collapsed-by-default request modal section with read-only and engineer/admin modes.
- Create `src/components/requests/sub-task-form-dialog.tsx`: add/edit dialog for sub-task cards.
- Modify request modal components that render request detail flows:
  - `src/components/requests/approver-modal.tsx`
  - `src/components/requests/solution-modal.tsx`
  - `src/components/requests/completed-request-modal.tsx`
  - `src/components/requests/completed-solution-modal.tsx`
  - `src/components/requests/final-approval-modal.tsx`
  - `src/components/requests/completed-final-modal.tsx`
  - `src/components/requests/submit-final-approval-modal.tsx`
  - `src/components/requests/final-approval-resubmit-modal.tsx`
- Modify `src/components/requests/request-modal-router.tsx`: pass current user role and request follow-up data to each modal.
- Modify `/dashboard` filter UI:
  - `src/components/dashboard/table-filters.tsx`
  - `src/components/dashboard/dashboard-table.tsx`
- Modify `/requests` filter UI and API:
  - `src/components/requests/request-filters.tsx`
  - `src/components/requests/requests-list-with-filters.tsx`
  - `src/app/api/requests/route.ts`
- Modify `/engineering` page and tabs:
  - `src/app/(dashboard)/engineering/page.tsx`
  - `src/components/engineering/engineering-dashboard-tabs.tsx`
- Create `tests/regression/engineering-sub-tasks.test.ts`: helper and wiring regression tests.
- Create `tests/e2e/engineering-sub-tasks.spec.ts`: rendered smoke coverage for collapsed panel and filter controls.

---

### Task 1: Data Model And Seed Data

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260606000000_add_engineering_sub_tasks/migration.sql`
- Modify: `prisma/seed.ts`
- Test: `tests/regression/engineering-sub-tasks.test.ts`

- [ ] **Step 1: Write the failing schema regression tests**

Create `tests/regression/engineering-sub-tasks.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

describe('engineering sub-task schema', () => {
  const schema = () => readFileSync('prisma/schema.prisma', 'utf8')
  const migration = () => readFileSync('prisma/migrations/20260606000000_add_engineering_sub_tasks/migration.sql', 'utf8')

  it('adds request sub-task, stage, and subcontractor models', () => {
    const source = schema()

    assert.match(source, /model request_sub_tasks \{/)
    assert.match(source, /model sub_task_stages \{/)
    assert.match(source, /model sub_contractors \{/)
    assert.match(source, /workRequisitionReceived\s+Boolean\s+@default\(false\)/)
    assert.match(source, /workRequisitionReceivedAt\s+DateTime\?/)
    assert.match(source, /workRequisitionReceivedById\s+String\?/)
  })

  it('creates tables, indexes, and default sub-task stages in SQL migration', () => {
    const sql = migration()

    assert.match(sql, /CREATE TABLE "sub_task_stages"/)
    assert.match(sql, /CREATE TABLE "sub_contractors"/)
    assert.match(sql, /CREATE TABLE "request_sub_tasks"/)
    assert.match(sql, /CREATE INDEX "request_sub_tasks_requestId_idx"/)
    assert.match(sql, /CREATE INDEX "request_sub_tasks_updatedAt_idx"/)
    assert.match(sql, /INSERT INTO "sub_task_stages"/)
    for (const stage of ['Design', 'Site survey', 'Waiting user data', 'Waiting quotation', 'Waiting WR', 'Completed', 'Others']) {
      assert.match(sql, new RegExp(stage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  })
})
```

- [ ] **Step 2: Run the regression test and verify it fails**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
```

Expected: FAIL because the schema, migration, and seed changes do not exist yet.

- [ ] **Step 3: Update `prisma/schema.prisma`**

Add these relations to `User`:

```prisma
  createdSubTasks                                                request_sub_tasks[]          @relation("request_sub_tasks_createdByIdTousers")
  updatedSubTasks                                                request_sub_tasks[]          @relation("request_sub_tasks_updatedByIdTousers")
  completedSubTasks                                              request_sub_tasks[]          @relation("request_sub_tasks_completedByIdTousers")
  createdSubContractors                                          sub_contractors[]            @relation("sub_contractors_createdByIdTousers")
  updatedSubContractors                                          sub_contractors[]            @relation("sub_contractors_updatedByIdTousers")
  workRequisitionRequests                                        requests[]                   @relation("requests_workRequisitionReceivedByIdTousers")
```

Add these fields to `requests`:

```prisma
  workRequisitionReceived       Boolean                         @default(false)
  workRequisitionReceivedAt     DateTime?
  workRequisitionReceivedById   String?
  subTasks                      request_sub_tasks[]
  workRequisitionReceivedBy     User?                           @relation("requests_workRequisitionReceivedByIdTousers", fields: [workRequisitionReceivedById], references: [id])
```

Add this index to `requests`:

```prisma
  @@index([workRequisitionReceived])
  @@index([workRequisitionReceivedById])
```

Add these models after `request_engineer_assignments`:

```prisma
model sub_task_stages {
  id          String              @id @default(uuid())
  name        String              @unique
  sortOrder   Int
  isDefault   Boolean             @default(true)
  isOthers    Boolean             @default(false)
  isActive    Boolean             @default(true)
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  subTasks    request_sub_tasks[]

  @@index([isActive])
  @@index([isOthers])
  @@index([sortOrder])
}

model sub_contractors {
  id          String              @id @default(uuid())
  name        String              @unique
  isActive    Boolean             @default(true)
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  createdById String
  updatedById String?
  createdBy   User                @relation("sub_contractors_createdByIdTousers", fields: [createdById], references: [id])
  updatedBy   User?               @relation("sub_contractors_updatedByIdTousers", fields: [updatedById], references: [id])
  subTasks    request_sub_tasks[]

  @@index([createdById])
  @@index([isActive])
  @@index([updatedById])
}

model request_sub_tasks {
  id               String            @id @default(uuid())
  requestId        String
  description      String
  subContractorId  String?
  stageId          String
  customStageText  String?
  isCompleted      Boolean           @default(false)
  completedAt      DateTime?
  completedById    String?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  createdById      String
  updatedById      String?
  request          requests          @relation(fields: [requestId], references: [id], onDelete: Cascade)
  subContractor    sub_contractors?  @relation(fields: [subContractorId], references: [id], onDelete: SetNull)
  stage            sub_task_stages   @relation(fields: [stageId], references: [id])
  createdBy        User              @relation("request_sub_tasks_createdByIdTousers", fields: [createdById], references: [id])
  updatedBy        User?             @relation("request_sub_tasks_updatedByIdTousers", fields: [updatedById], references: [id])
  completedBy      User?             @relation("request_sub_tasks_completedByIdTousers", fields: [completedById], references: [id])

  @@index([completedById])
  @@index([createdById])
  @@index([isCompleted])
  @@index([requestId])
  @@index([stageId])
  @@index([subContractorId])
  @@index([updatedAt])
  @@index([updatedById])
}
```

- [ ] **Step 4: Create the SQL migration**

Create `prisma/migrations/20260606000000_add_engineering_sub_tasks/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "requests"
ADD COLUMN "workRequisitionReceived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "workRequisitionReceivedAt" TIMESTAMP(3),
ADD COLUMN "workRequisitionReceivedById" TEXT;

-- CreateTable
CREATE TABLE "sub_task_stages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "isOthers" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_task_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_contractors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "sub_contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_sub_tasks" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "subContractorId" TEXT,
    "stageId" TEXT NOT NULL,
    "customStageText" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "request_sub_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sub_task_stages_name_key" ON "sub_task_stages"("name");
CREATE INDEX "sub_task_stages_isActive_idx" ON "sub_task_stages"("isActive");
CREATE INDEX "sub_task_stages_isOthers_idx" ON "sub_task_stages"("isOthers");
CREATE INDEX "sub_task_stages_sortOrder_idx" ON "sub_task_stages"("sortOrder");
CREATE UNIQUE INDEX "sub_contractors_name_key" ON "sub_contractors"("name");
CREATE INDEX "sub_contractors_createdById_idx" ON "sub_contractors"("createdById");
CREATE INDEX "sub_contractors_isActive_idx" ON "sub_contractors"("isActive");
CREATE INDEX "sub_contractors_updatedById_idx" ON "sub_contractors"("updatedById");
CREATE INDEX "request_sub_tasks_completedById_idx" ON "request_sub_tasks"("completedById");
CREATE INDEX "request_sub_tasks_createdById_idx" ON "request_sub_tasks"("createdById");
CREATE INDEX "request_sub_tasks_isCompleted_idx" ON "request_sub_tasks"("isCompleted");
CREATE INDEX "request_sub_tasks_requestId_idx" ON "request_sub_tasks"("requestId");
CREATE INDEX "request_sub_tasks_stageId_idx" ON "request_sub_tasks"("stageId");
CREATE INDEX "request_sub_tasks_subContractorId_idx" ON "request_sub_tasks"("subContractorId");
CREATE INDEX "request_sub_tasks_updatedAt_idx" ON "request_sub_tasks"("updatedAt");
CREATE INDEX "request_sub_tasks_updatedById_idx" ON "request_sub_tasks"("updatedById");
CREATE INDEX "requests_workRequisitionReceived_idx" ON "requests"("workRequisitionReceived");
CREATE INDEX "requests_workRequisitionReceivedById_idx" ON "requests"("workRequisitionReceivedById");

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_workRequisitionReceivedById_fkey" FOREIGN KEY ("workRequisitionReceivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sub_contractors" ADD CONSTRAINT "sub_contractors_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sub_contractors" ADD CONSTRAINT "sub_contractors_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_subContractorId_fkey" FOREIGN KEY ("subContractorId") REFERENCES "sub_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "sub_task_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default global stages
INSERT INTO "sub_task_stages" ("id", "name", "sortOrder", "isDefault", "isOthers", "isActive", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'Design', 10, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Site survey', 20, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Waiting user data', 30, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Waiting quotation', 40, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Waiting WR', 50, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Completed', 60, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Others', 70, true, true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
```

- [ ] **Step 5: Update `prisma/seed.ts`**

Add this helper near the top after `const prisma = new PrismaClient();`:

```ts
const defaultSubTaskStages = [
  { name: 'Design', sortOrder: 10, isOthers: false },
  { name: 'Site survey', sortOrder: 20, isOthers: false },
  { name: 'Waiting user data', sortOrder: 30, isOthers: false },
  { name: 'Waiting quotation', sortOrder: 40, isOthers: false },
  { name: 'Waiting WR', sortOrder: 50, isOthers: false },
  { name: 'Completed', sortOrder: 60, isOthers: false },
  { name: 'Others', sortOrder: 70, isOthers: true },
]
```

Add this block inside the main seed function before users are created:

```ts
  for (const stage of defaultSubTaskStages) {
    await prisma.sub_task_stages.upsert({
      where: { name: stage.name },
      update: {
        sortOrder: stage.sortOrder,
        isDefault: true,
        isOthers: stage.isOthers,
        isActive: true,
      },
      create: {
        name: stage.name,
        sortOrder: stage.sortOrder,
        isDefault: true,
        isOthers: stage.isOthers,
        isActive: true,
      },
    })
  }
```

- [ ] **Step 6: Generate Prisma client and run migration status**

Run:

```bash
npx prisma generate
DATABASE_URL='postgresql://postgres:changeme@127.0.0.1:5432/app_db?schema=public' npx prisma migrate status
```

Expected: Prisma client generation succeeds. Migration status may report the new migration is not applied until the implementation runner explicitly applies it.

- [ ] **Step 7: Run the regression test and verify it passes**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add prisma/schema.prisma prisma/migrations/20260606000000_add_engineering_sub_tasks/migration.sql prisma/seed.ts tests/regression/engineering-sub-tasks.test.ts
git commit -m "feat: add engineering sub-task data model"
```

---

### Task 2: Pure Helpers And Server Actions

**Files:**
- Create: `src/lib/engineering-sub-tasks.ts`
- Create: `src/server-actions/engineering-sub-tasks.ts`
- Modify: `tests/regression/engineering-sub-tasks.test.ts`

- [ ] **Step 1: Add failing helper tests**

Append to `tests/regression/engineering-sub-tasks.test.ts`:

```ts
import {
  ENGINEERING_SUB_TASK_VISIBLE_STATUSES,
  filterRowsByWorkRequisition,
  isSubTaskVisibleForRequestStatus,
  isSubTaskStale,
  validateSubTaskInput,
} from '../../src/lib/engineering-sub-tasks'

describe('engineering sub-task helpers', () => {
  it('limits sub-task visibility to the approved request stages', () => {
    assert.deepEqual(ENGINEERING_SUB_TASK_VISIBLE_STATUSES, [
      'SentToEngineer',
      'SendBackToRequester',
      'FinalApproval',
      'Completed',
    ])
    assert.equal(isSubTaskVisibleForRequestStatus('SentToEngineer'), true)
    assert.equal(isSubTaskVisibleForRequestStatus('DesignCostEstimationApproval'), false)
    assert.equal(isSubTaskVisibleForRequestStatus('Cancelled'), false)
  })

  it('filters rows by WR state', () => {
    const rows = [
      { id: 'a', workRequisitionReceived: true },
      { id: 'b', workRequisitionReceived: false },
    ]

    assert.deepEqual(filterRowsByWorkRequisition(rows, 'all').map((row) => row.id), ['a', 'b'])
    assert.deepEqual(filterRowsByWorkRequisition(rows, 'received').map((row) => row.id), ['a'])
    assert.deepEqual(filterRowsByWorkRequisition(rows, 'not-received').map((row) => row.id), ['b'])
  })

  it('detects stale incomplete sub-tasks by updatedAt and stage', () => {
    const now = new Date('2026-06-06T12:00:00Z')
    const oldWaitingQuotation = {
      isCompleted: false,
      updatedAt: new Date('2026-05-30T11:59:59Z'),
      stage: { id: 'stage-wq', name: 'Waiting quotation' },
    }
    const recentWaitingQuotation = {
      isCompleted: false,
      updatedAt: new Date('2026-06-05T12:00:00Z'),
      stage: { id: 'stage-wq', name: 'Waiting quotation' },
    }
    const completedOldTask = {
      isCompleted: true,
      updatedAt: new Date('2026-05-01T12:00:00Z'),
      stage: { id: 'stage-wq', name: 'Waiting quotation' },
    }

    assert.equal(isSubTaskStale(oldWaitingQuotation, { olderThanDays: 7, now }), true)
    assert.equal(isSubTaskStale(recentWaitingQuotation, { olderThanDays: 7, now }), false)
    assert.equal(isSubTaskStale(completedOldTask, { olderThanDays: 7, now }), false)
    assert.equal(isSubTaskStale(oldWaitingQuotation, { olderThanDays: 7, stageId: 'other-stage', now }), false)
    assert.equal(isSubTaskStale(oldWaitingQuotation, { olderThanDays: 7, stageId: 'stage-wq', now }), true)
  })

  it('requires custom stage text only for Others', () => {
    assert.deepEqual(validateSubTaskInput({ description: '', stageIsOthers: false }), {
      success: false,
      error: 'Description is required',
    })
    assert.deepEqual(validateSubTaskInput({ description: 'Piping work', stageIsOthers: true, customStageText: '' }), {
      success: false,
      error: 'Custom stage text is required when stage is Others',
    })
    assert.deepEqual(validateSubTaskInput({ description: 'Piping work', stageIsOthers: false, customStageText: 'ignored' }), {
      success: true,
      customStageText: null,
    })
  })
})
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
```

Expected: FAIL because `src/lib/engineering-sub-tasks.ts` does not exist.

- [ ] **Step 3: Create `src/lib/engineering-sub-tasks.ts`**

Create:

```ts
import type { RequestStatus } from '@prisma/client'

export const ENGINEERING_SUB_TASK_VISIBLE_STATUSES = [
  'SentToEngineer',
  'SendBackToRequester',
  'FinalApproval',
  'Completed',
] as const

export type WorkRequisitionFilter = 'all' | 'not-received' | 'received'

export function isSubTaskVisibleForRequestStatus(status: string): boolean {
  return ENGINEERING_SUB_TASK_VISIBLE_STATUSES.includes(status as any)
}

export function canManageEngineeringSubTasks(user?: { role?: string | null } | null): boolean {
  return user?.role === 'engineering' || user?.role === 'admin'
}

export function filterRowsByWorkRequisition<T extends { workRequisitionReceived?: boolean }>(
  rows: T[],
  filter: WorkRequisitionFilter | undefined
): T[] {
  if (!filter || filter === 'all') return rows
  if (filter === 'received') return rows.filter((row) => row.workRequisitionReceived === true)
  return rows.filter((row) => row.workRequisitionReceived !== true)
}

export function getWorkRequisitionLabel(received?: boolean): 'WR received' | 'No WR' {
  return received ? 'WR received' : 'No WR'
}

export function getSubTaskSummary(subTasks: Array<{ isCompleted: boolean }>) {
  const total = subTasks.length
  const completed = subTasks.filter((task) => task.isCompleted).length
  return {
    total,
    completed,
    label: `${completed}/${total} complete`,
  }
}

export function isSubTaskStale(
  subTask: {
    isCompleted: boolean
    updatedAt: Date | string
    stage?: { id: string; name: string } | null
  },
  options: {
    olderThanDays?: number
    stageId?: string
    now?: Date
  }
): boolean {
  if (subTask.isCompleted) return false
  if (!options.olderThanDays || options.olderThanDays <= 0) return false
  if (options.stageId && subTask.stage?.id !== options.stageId) return false

  const now = options.now ?? new Date()
  const updatedAt = typeof subTask.updatedAt === 'string' ? new Date(subTask.updatedAt) : subTask.updatedAt
  const threshold = new Date(now)
  threshold.setDate(threshold.getDate() - options.olderThanDays)

  return updatedAt <= threshold
}

export function validateSubTaskInput(input: {
  description?: string
  stageIsOthers: boolean
  customStageText?: string | null
}): { success: true; customStageText: string | null } | { success: false; error: string } {
  if (!input.description?.trim()) {
    return { success: false, error: 'Description is required' }
  }

  if (input.stageIsOthers) {
    const customStageText = input.customStageText?.trim()
    if (!customStageText) {
      return { success: false, error: 'Custom stage text is required when stage is Others' }
    }
    return { success: true, customStageText }
  }

  return { success: true, customStageText: null }
}
```

- [ ] **Step 4: Create server-action wiring tests**

Append to `tests/regression/engineering-sub-tasks.test.ts`:

```ts
describe('engineering sub-task server action wiring', () => {
  it('exposes CRUD, WR, stages, subcontractor, and stale filter actions', () => {
    const source = readFileSync('src/server-actions/engineering-sub-tasks.ts', 'utf8')

    for (const exportName of [
      'getEngineeringSubTaskOptions',
      'createSubTask',
      'updateSubTask',
      'setSubTaskCompleted',
      'deleteSubTask',
      'toggleWorkRequisitionReceived',
      'createSubContractor',
      'deactivateSubContractor',
      'getStaleSubTaskRequests',
    ]) {
      assert.match(source, new RegExp(`export async function ${exportName}\\b`))
    }

    assert.match(source, /'use server'/)
    assert.match(source, /canManageEngineeringSubTasks/)
    assert.match(source, /revalidateRequestViews/)
    assert.match(source, /isSubTaskVisibleForRequestStatus/)
  })
})
```

- [ ] **Step 5: Run wiring tests and verify they fail**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
```

Expected: FAIL because `src/server-actions/engineering-sub-tasks.ts` does not exist.

- [ ] **Step 6: Create `src/server-actions/engineering-sub-tasks.ts`**

Create the file with these exports and validation behavior:

```ts
'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/cache/user-cache'
import { revalidateRequestViews } from './request-view-invalidation'
import {
  canManageEngineeringSubTasks,
  isSubTaskVisibleForRequestStatus,
  validateSubTaskInput,
} from '@/lib/engineering-sub-tasks'

type ActionResult<T = undefined> = T extends undefined
  ? { success: true } | { success: false; error: string }
  : { success: true; data: T } | { success: false; error: string }

async function requireSubTaskManager() {
  const user = await getCurrentUser()
  if (!user || !canManageEngineeringSubTasks(user)) {
    throw new Error('Only engineering and admin users can manage sub-tasks')
  }
  return user
}

async function requireVisibleStageRequest(requestId: string) {
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { id: true, status: true },
  })

  if (!request) throw new Error('Request not found')
  if (!isSubTaskVisibleForRequestStatus(request.status)) {
    throw new Error('Sub-tasks are not available for this request stage')
  }

  return request
}

async function getStage(stageId: string) {
  const stage = await prisma.sub_task_stages.findUnique({
    where: { id: stageId },
    select: { id: true, isOthers: true, isActive: true },
  })

  if (!stage || !stage.isActive) throw new Error('Selected stage is not available')
  return stage
}

export async function getEngineeringSubTaskOptions() {
  const [stages, subcontractors] = await Promise.all([
    prisma.sub_task_stages.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, isOthers: true },
    }),
    prisma.sub_contractors.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ])

  return { stages, subcontractors }
}

export async function createSubTask(input: {
  requestId: string
  description: string
  stageId: string
  customStageText?: string | null
  subContractorId?: string | null
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSubTaskManager()
    await requireVisibleStageRequest(input.requestId)
    const stage = await getStage(input.stageId)
    const validation = validateSubTaskInput({
      description: input.description,
      stageIsOthers: stage.isOthers,
      customStageText: input.customStageText,
    })
    if (!validation.success) return validation

    const subTask = await prisma.request_sub_tasks.create({
      data: {
        requestId: input.requestId,
        description: input.description.trim(),
        stageId: input.stageId,
        customStageText: validation.customStageText,
        subContractorId: input.subContractorId || null,
        createdById: user.id,
        updatedById: user.id,
      },
      select: { id: true },
    })

    revalidateRequestViews(input.requestId)
    return { success: true, data: subTask }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create sub-task' }
  }
}

export async function updateSubTask(input: {
  id: string
  description: string
  stageId: string
  customStageText?: string | null
  subContractorId?: string | null
}): Promise<ActionResult> {
  try {
    const user = await requireSubTaskManager()
    const existing = await prisma.request_sub_tasks.findUnique({
      where: { id: input.id },
      select: { requestId: true },
    })
    if (!existing) throw new Error('Sub-task not found')
    await requireVisibleStageRequest(existing.requestId)
    const stage = await getStage(input.stageId)
    const validation = validateSubTaskInput({
      description: input.description,
      stageIsOthers: stage.isOthers,
      customStageText: input.customStageText,
    })
    if (!validation.success) return validation

    await prisma.request_sub_tasks.update({
      where: { id: input.id },
      data: {
        description: input.description.trim(),
        stageId: input.stageId,
        customStageText: validation.customStageText,
        subContractorId: input.subContractorId || null,
        updatedById: user.id,
      },
    })

    revalidateRequestViews(existing.requestId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update sub-task' }
  }
}

export async function setSubTaskCompleted(id: string, completed: boolean): Promise<ActionResult> {
  try {
    const user = await requireSubTaskManager()
    const existing = await prisma.request_sub_tasks.findUnique({
      where: { id },
      select: { requestId: true },
    })
    if (!existing) throw new Error('Sub-task not found')
    await requireVisibleStageRequest(existing.requestId)

    await prisma.request_sub_tasks.update({
      where: { id },
      data: {
        isCompleted: completed,
        completedAt: completed ? new Date() : null,
        completedById: completed ? user.id : null,
        updatedById: user.id,
      },
    })

    revalidateRequestViews(existing.requestId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update completion' }
  }
}

export async function deleteSubTask(id: string): Promise<ActionResult> {
  try {
    await requireSubTaskManager()
    const existing = await prisma.request_sub_tasks.findUnique({
      where: { id },
      select: { requestId: true },
    })
    if (!existing) throw new Error('Sub-task not found')
    await requireVisibleStageRequest(existing.requestId)

    await prisma.request_sub_tasks.delete({ where: { id } })

    revalidateRequestViews(existing.requestId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete sub-task' }
  }
}

export async function toggleWorkRequisitionReceived(requestId: string, received: boolean): Promise<ActionResult> {
  try {
    const user = await requireSubTaskManager()
    await requireVisibleStageRequest(requestId)

    await prisma.requests.update({
      where: { id: requestId },
      data: {
        workRequisitionReceived: received,
        workRequisitionReceivedAt: received ? new Date() : null,
        workRequisitionReceivedById: received ? user.id : null,
      },
    })

    revalidateRequestViews(requestId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update WR status' }
  }
}

export async function createSubContractor(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const user = await requireSubTaskManager()
    const trimmed = name.trim()
    if (!trimmed) return { success: false, error: 'Subcontractor name is required' }

    const contractor = await prisma.sub_contractors.upsert({
      where: { name: trimmed },
      update: { isActive: true, updatedById: user.id },
      create: { name: trimmed, createdById: user.id, updatedById: user.id },
      select: { id: true, name: true },
    })

    revalidatePath('/engineering')
    return { success: true, data: contractor }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create subcontractor' }
  }
}

export async function deactivateSubContractor(id: string): Promise<ActionResult> {
  try {
    const user = await requireSubTaskManager()
    await prisma.sub_contractors.update({
      where: { id },
      data: { isActive: false, updatedById: user.id },
    })
    revalidatePath('/engineering')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to deactivate subcontractor' }
  }
}

export async function getStaleSubTaskRequests(input: { olderThanDays?: number; stageId?: string }) {
  const user = await getCurrentUser()
  if (!user || !canManageEngineeringSubTasks(user)) return []
  if (!input.olderThanDays || input.olderThanDays <= 0) return []

  const threshold = new Date()
  threshold.setDate(threshold.getDate() - input.olderThanDays)

  return prisma.requests.findMany({
    where: {
      isDeleted: false,
      status: { in: ['SentToEngineer', 'SendBackToRequester', 'FinalApproval', 'Completed'] as any },
      subTasks: {
        some: {
          isCompleted: false,
          updatedAt: { lte: threshold },
          ...(input.stageId ? { stageId: input.stageId } : {}),
        },
      },
    },
    select: {
      id: true,
      title: true,
      status: true,
      department: { select: { name: true } },
      requester: { select: { name: true } },
      subTasks: {
        where: {
          isCompleted: false,
          updatedAt: { lte: threshold },
          ...(input.stageId ? { stageId: input.stageId } : {}),
        },
        select: {
          id: true,
          description: true,
          updatedAt: true,
          stage: { select: { id: true, name: true } },
          subContractor: { select: { name: true } },
        },
        orderBy: { updatedAt: 'asc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })
}
```

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
npx tsc --noEmit
```

Expected: tests pass. Typecheck may reveal relation name typos; fix only typos from this task.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/lib/engineering-sub-tasks.ts src/server-actions/engineering-sub-tasks.ts tests/regression/engineering-sub-tasks.test.ts
git commit -m "feat: add engineering sub-task actions"
```

---

### Task 3: Request Data And WR Filters

**Files:**
- Modify: `src/server-actions/requests.ts`
- Modify: `src/server-actions/dashboard.ts`
- Modify: `src/app/api/requests/route.ts`
- Modify: `src/components/requests/request-filters.tsx`
- Modify: `src/components/requests/requests-list-with-filters.tsx`
- Modify: `src/components/dashboard/table-filters.tsx`
- Modify: `src/components/dashboard/dashboard-table.tsx`
- Modify: `tests/regression/engineering-sub-tasks.test.ts`

- [ ] **Step 1: Add failing wiring tests for request data and filters**

Append:

```ts
describe('engineering sub-task request and filter wiring', () => {
  it('adds WR fields to request server rows and request detail data', () => {
    const requests = readFileSync('src/server-actions/requests.ts', 'utf8')
    const dashboard = readFileSync('src/server-actions/dashboard.ts', 'utf8')

    for (const source of [requests, dashboard]) {
      assert.match(source, /workRequisitionReceived: true/)
    }

    assert.match(requests, /subTasks:\s*\{/)
    assert.match(requests, /workRequisitionReceivedAt: true/)
    assert.match(requests, /workRequisitionReceivedBy/)
  })

  it('wires WR filters into requests API, request filters, and dashboard filters', () => {
    const api = readFileSync('src/app/api/requests/route.ts', 'utf8')
    const requestFilters = readFileSync('src/components/requests/request-filters.tsx', 'utf8')
    const requestList = readFileSync('src/components/requests/requests-list-with-filters.tsx', 'utf8')
    const dashboardFilters = readFileSync('src/components/dashboard/table-filters.tsx', 'utf8')
    const dashboardTable = readFileSync('src/components/dashboard/dashboard-table.tsx', 'utf8')

    assert.match(api, /wrStatus/)
    assert.match(requestFilters, /WR received/)
    assert.match(requestFilters, /No WR/)
    assert.match(requestList, /wrStatus/)
    assert.match(dashboardFilters, /wrStatus/)
    assert.match(dashboardTable, /filterRowsByWorkRequisition/)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
```

Expected: FAIL because WR fields and filters are not wired yet.

- [ ] **Step 3: Extend request filter types and server filtering**

In `src/server-actions/requests.ts`, extend `GetRequestsFilters`:

```ts
  wrStatus?: 'all' | 'not-received' | 'received'
```

In `getMyRequests`, after status filtering:

```ts
    if (filters.wrStatus === 'received') {
      whereClause.workRequisitionReceived = true
    } else if (filters.wrStatus === 'not-received') {
      whereClause.workRequisitionReceived = false
    }
```

In `getMyRequests` row select, add:

```ts
      workRequisitionReceived: true,
      workRequisitionReceivedAt: true,
      workRequisitionReceivedBy: {
        select: {
          id: true,
          name: true,
        },
      },
```

In the return mapping, add:

```ts
      workRequisitionReceived: req.workRequisitionReceived,
      workRequisitionReceivedAt: req.workRequisitionReceivedAt,
      workRequisitionReceivedBy: req.workRequisitionReceivedBy,
```

- [ ] **Step 4: Include sub-task detail data in `getRequest`**

In `getRequest` include:

```ts
      workRequisitionReceivedBy: {
        select: {
          id: true,
          name: true,
        },
      },
      subTasks: {
        select: {
          id: true,
          description: true,
          customStageText: true,
          isCompleted: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          stage: {
            select: {
              id: true,
              name: true,
              isOthers: true,
              isActive: true,
            },
          },
          subContractor: {
            select: {
              id: true,
              name: true,
              isActive: true,
            },
          },
          createdBy: {
            select: { id: true, name: true },
          },
          updatedBy: {
            select: { id: true, name: true },
          },
          completedBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: [
          { isCompleted: 'asc' },
          { updatedAt: 'desc' },
        ],
      },
```

- [ ] **Step 5: Extend dashboard row type and selectors**

In `src/server-actions/dashboard.ts`, add to `RequestListRow`:

```ts
  workRequisitionReceived?: boolean
```

Add `workRequisitionReceived: true` to every dashboard request select and add `workRequisitionReceived: request.workRequisitionReceived` to each mapped return object.

- [ ] **Step 6: Wire `/api/requests` query param**

In `src/app/api/requests/route.ts`, add:

```ts
      wrStatus: (searchParams.get('wrStatus') as GetRequestsFilters['wrStatus']) || undefined,
```

- [ ] **Step 7: Add WR filter to `/requests` UI**

In `src/components/requests/request-filters.tsx`, extend `RequestFilters`:

```ts
  wrStatus?: 'all' | 'not-received' | 'received'
```

Update `updateFilter` value type:

```ts
  const updateFilter = (key: keyof RequestFilters, value: string | string[] | undefined) => {
```

can remain valid because the values are strings.

Add a WR select in the compact grid after requester:

```tsx
        <div>
          <Select
            value={filters.wrStatus || 'all'}
            onValueChange={(value) => updateFilter('wrStatus', value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="h-9 min-h-9">
              <SelectValue placeholder="WR status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All WR</SelectItem>
              <SelectItem value="not-received">No WR</SelectItem>
              <SelectItem value="received">WR received</SelectItem>
            </SelectContent>
          </Select>
        </div>
```

- [ ] **Step 8: Add WR filter to dashboard table**

In `src/components/dashboard/table-filters.tsx`, extend `DashboardFilters`:

```ts
  wrStatus?: 'all' | 'not-received' | 'received'
```

Add the same WR select to both mobile and desktop filter sections.

In `src/components/dashboard/dashboard-table.tsx`, import:

```ts
import { filterRowsByWorkRequisition } from '@/lib/engineering-sub-tasks'
```

Create filtered data before `useReactTable`:

```ts
  const tableData = useMemo(
    () => filterRowsByWorkRequisition(data, externalFilters?.wrStatus),
    [data, externalFilters?.wrStatus]
  )
```

Use `tableData` in the table:

```ts
    data: tableData,
```

- [ ] **Step 9: Run tests and typecheck**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add src/server-actions/requests.ts src/server-actions/dashboard.ts src/app/api/requests/route.ts src/components/requests/request-filters.tsx src/components/requests/requests-list-with-filters.tsx src/components/dashboard/table-filters.tsx src/components/dashboard/dashboard-table.tsx tests/regression/engineering-sub-tasks.test.ts
git commit -m "feat: add WR filters to request lists"
```

---

### Task 4: Collapsed Sub-tasks Request Panel

**Files:**
- Create: `src/components/requests/sub-task-form-dialog.tsx`
- Create: `src/components/requests/sub-tasks-section.tsx`
- Modify: `src/components/requests/request-modal-router.tsx`
- Modify request modal components listed in File Structure
- Modify: `tests/regression/engineering-sub-tasks.test.ts`

- [ ] **Step 1: Add failing wiring tests for modal UI**

Append:

```ts
describe('engineering sub-task modal UI wiring', () => {
  it('creates collapsed sub-task section components and wires them through modal router', () => {
    const section = readFileSync('src/components/requests/sub-tasks-section.tsx', 'utf8')
    const form = readFileSync('src/components/requests/sub-task-form-dialog.tsx', 'utf8')
    const router = readFileSync('src/components/requests/request-modal-router.tsx', 'utf8')

    assert.match(section, /Collapsible/)
    assert.match(section, /defaultOpen=\{false\}/)
    assert.match(section, /Sub-tasks/)
    assert.match(section, /Work requisition received/)
    assert.match(section, /WR received/)
    assert.match(section, /No WR/)
    assert.match(form, /createSubTask/)
    assert.match(form, /updateSubTask/)
    assert.match(router, /subTasksElement/)
  })

  it('places sub-task panel in the main request modal variants', () => {
    for (const file of [
      'src/components/requests/approver-modal.tsx',
      'src/components/requests/solution-modal.tsx',
      'src/components/requests/completed-request-modal.tsx',
      'src/components/requests/completed-solution-modal.tsx',
      'src/components/requests/final-approval-modal.tsx',
      'src/components/requests/completed-final-modal.tsx',
      'src/components/requests/submit-final-approval-modal.tsx',
      'src/components/requests/final-approval-resubmit-modal.tsx',
    ]) {
      const source = readFileSync(file, 'utf8')
      assert.match(source, /subTasksElement/)
    }
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
```

Expected: FAIL because components and wiring do not exist.

- [ ] **Step 3: Create `src/components/requests/sub-task-form-dialog.tsx`**

Create a client component that accepts:

```ts
export interface SubTaskFormValues {
  id?: string
  requestId: string
  description: string
  stageId: string
  customStageText?: string | null
  subContractorId?: string | null
}

interface SubTaskFormDialogProps {
  requestId: string
  stages: Array<{ id: string; name: string; isOthers: boolean }>
  subcontractors: Array<{ id: string; name: string }>
  initialValue?: SubTaskFormValues
  trigger: React.ReactNode
  onSaved: () => void
}
```

The submit handler must use:

```ts
const result = initialValue?.id
  ? await updateSubTask({ ...payload, id: initialValue.id })
  : await createSubTask(payload)
```

The stage select must show `customStageText` input only when the selected stage has `isOthers === true`.

- [ ] **Step 4: Create `src/components/requests/sub-tasks-section.tsx`**

Create a client component with this public prop shape:

```ts
interface SubTasksSectionProps {
  requestId: string
  requestStatus: string
  canManage: boolean
  workRequisitionReceived: boolean
  subTasks: Array<{
    id: string
    description: string
    customStageText?: string | null
    isCompleted: boolean
    completedAt?: Date | string | null
    createdAt: Date | string
    updatedAt: Date | string
    stage: { id: string; name: string; isOthers: boolean; isActive: boolean }
    subContractor?: { id: string; name: string; isActive: boolean } | null
    updatedBy?: { id: string; name: string | null } | null
  }>
  stages: Array<{ id: string; name: string; isOthers: boolean }>
  subcontractors: Array<{ id: string; name: string }>
  onChanged: () => void
}
```

Use `Collapsible` with `defaultOpen={false}`. The collapsed trigger must show:

```tsx
<span className="font-semibold">Sub-tasks</span>
<Badge variant="secondary">{completed}/{total} complete</Badge>
<Badge variant={workRequisitionReceived ? 'success' : 'outline'}>
  {workRequisitionReceived ? 'WR received' : 'No WR'}
</Badge>
```

Expanded view must show a `Checkbox` with label `Work requisition received` only in full text. On change:

```ts
const result = await toggleWorkRequisitionReceived(requestId, checked)
if (!result.success) toast.error(result.error)
else onChanged()
```

For each sub-task card show description, subcontractor name or `No subcontractor`, stage name or custom stage text, and `Last edited ${formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}`.

- [ ] **Step 5: Wire router data and permissions**

In `src/components/requests/request-modal-router.tsx`, import:

```ts
import { SubTasksSection } from '@/components/requests/sub-tasks-section'
import { getEngineeringSubTaskOptions } from '@/server-actions/engineering-sub-tasks'
import { canManageEngineeringSubTasks, isSubTaskVisibleForRequestStatus } from '@/lib/engineering-sub-tasks'
```

Add state:

```ts
const [subTaskOptions, setSubTaskOptions] = useState<{ stages: any[]; subcontractors: any[] }>({ stages: [], subcontractors: [] })
```

In `loadRequestData`, fetch options when request status is visible:

```ts
if (isSubTaskVisibleForRequestStatus(request.status)) {
  setSubTaskOptions(await getEngineeringSubTaskOptions())
} else {
  setSubTaskOptions({ stages: [], subcontractors: [] })
}
```

Create `subTasksElement` after `isEngineering`:

```tsx
const subTasksElement = isSubTaskVisibleForRequestStatus(requestData.status) ? (
  <SubTasksSection
    requestId={requestData.id}
    requestStatus={requestData.status}
    canManage={canManageEngineeringSubTasks(user)}
    workRequisitionReceived={requestData.workRequisitionReceived}
    subTasks={requestData.subTasks || []}
    stages={subTaskOptions.stages}
    subcontractors={subTaskOptions.subcontractors}
    onChanged={async () => {
      await loadRequestData()
      window.dispatchEvent(new Event('approvalapp:request-data-changed'))
      onActionComplete?.()
      router.refresh()
    }}
  />
) : null
```

- [ ] **Step 6: Pass `subTasksElement` to modal variants**

For each modal component listed in this task, add an optional prop:

```ts
  subTasksElement?: React.ReactNode
```

Render it just before the activity timeline separator:

```tsx
          {subTasksElement && (
            <>
              <Separator className="bg-slate-200 dark:bg-slate-700" />
              {subTasksElement}
            </>
          )}
```

In `RequestModalRouter`, pass `subTasksElement={subTasksElement}` into each modal invocation.

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/components/requests/sub-task-form-dialog.tsx src/components/requests/sub-tasks-section.tsx src/components/requests/request-modal-router.tsx src/components/requests/approver-modal.tsx src/components/requests/solution-modal.tsx src/components/requests/completed-request-modal.tsx src/components/requests/completed-solution-modal.tsx src/components/requests/final-approval-modal.tsx src/components/requests/completed-final-modal.tsx src/components/requests/submit-final-approval-modal.tsx src/components/requests/final-approval-resubmit-modal.tsx tests/regression/engineering-sub-tasks.test.ts
git commit -m "feat: add request sub-task panel"
```

---

### Task 5: Engineering Stale Sub-task Filter

**Files:**
- Modify: `src/app/(dashboard)/engineering/page.tsx`
- Modify: `src/components/engineering/engineering-dashboard-tabs.tsx`
- Modify: `tests/regression/engineering-sub-tasks.test.ts`

- [ ] **Step 1: Add failing wiring tests for engineering filters**

Append:

```ts
describe('engineering stale sub-task filters', () => {
  it('loads stage options and stale request action on engineering page', () => {
    const page = readFileSync('src/app/(dashboard)/engineering/page.tsx', 'utf8')
    const tabs = readFileSync('src/components/engineering/engineering-dashboard-tabs.tsx', 'utf8')

    assert.match(page, /getEngineeringSubTaskOptions/)
    assert.match(tabs, /getStaleSubTaskRequests/)
    assert.match(tabs, /olderThanDays/)
    assert.match(tabs, /stageId/)
    assert.match(tabs, /Last update older than/)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
```

Expected: FAIL because engineering stale filters are not wired.

- [ ] **Step 3: Load stages on engineering page**

In `src/app/(dashboard)/engineering/page.tsx`, import:

```ts
import { getEngineeringSubTaskOptions } from '@/server-actions/engineering-sub-tasks'
```

Load options:

```ts
const subTaskOptions = await getEngineeringSubTaskOptions()
```

Pass to tabs:

```tsx
        subTaskStages={subTaskOptions.stages}
```

- [ ] **Step 4: Add stale filter UI to `EngineeringDashboardTabs`**

Extend props:

```ts
  subTaskStages: Array<{ id: string; name: string; isOthers: boolean }>
```

Add state:

```ts
const [stageId, setStageId] = useState<string>('all')
const [olderThanDays, setOlderThanDays] = useState<string>('')
const [staleRequests, setStaleRequests] = useState<any[]>([])
const [loadingStale, setLoadingStale] = useState(false)
```

Add loader:

```ts
const loadStaleRequests = async () => {
  const days = Number(olderThanDays)
  if (!days || days <= 0) {
    setStaleRequests([])
    return
  }

  setLoadingStale(true)
  try {
    const rows = await getStaleSubTaskRequests({
      olderThanDays: days,
      stageId: stageId === 'all' ? undefined : stageId,
    })
    setStaleRequests(rows)
  } finally {
    setLoadingStale(false)
  }
}
```

Add UI above all engineering request list:

```tsx
<div className="rounded-lg border bg-gray-50 p-4 space-y-3">
  <h3 className="text-sm font-semibold text-gray-700">Sub-task follow-up filter</h3>
  <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
    <Select value={stageId} onValueChange={setStageId}>
      <SelectTrigger>
        <SelectValue placeholder="All stages" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All stages</SelectItem>
        {subTaskStages.map((stage) => (
          <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    <Input
      type="number"
      min={1}
      value={olderThanDays}
      onChange={(event) => setOlderThanDays(event.target.value)}
      placeholder="Last update older than X days"
      aria-label="Last update older than days"
    />
    <Button onClick={loadStaleRequests} disabled={loadingStale}>
      Find stuck sub-tasks
    </Button>
  </div>
</div>
```

Render `staleRequests` above the normal list when present. Each stale row should open the request modal when clicked and show matching sub-task descriptions and last update dates.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add 'src/app/(dashboard)/engineering/page.tsx' src/components/engineering/engineering-dashboard-tabs.tsx tests/regression/engineering-sub-tasks.test.ts
git commit -m "feat: add stale sub-task engineering filter"
```

---

### Task 6: Admin Stage Management

**Files:**
- Create: `src/server-actions/sub-task-stages.ts`
- Create: `src/components/admin/sub-task-stage-settings.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `tests/regression/engineering-sub-tasks.test.ts`

- [ ] **Step 1: Add failing admin-stage wiring test**

Append:

```ts
describe('admin sub-task stage management wiring', () => {
  it('adds admin-managed global stage settings', () => {
    const actions = readFileSync('src/server-actions/sub-task-stages.ts', 'utf8')
    const component = readFileSync('src/components/admin/sub-task-stage-settings.tsx', 'utf8')
    const page = readFileSync('src/app/admin/page.tsx', 'utf8')

    assert.match(actions, /requireAdmin/)
    assert.match(actions, /updateSubTaskStage/)
    assert.match(actions, /deactivateSubTaskStage/)
    assert.match(component, /Sub-task stages/)
    assert.match(component, /isActive/)
    assert.match(page, /SubTaskStageSettings/)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
```

Expected: FAIL because admin stage settings do not exist.

- [ ] **Step 3: Create `src/server-actions/sub-task-stages.ts`**

Create server actions:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

export async function getSubTaskStagesForAdmin() {
  await requireAdmin()
  return prisma.sub_task_stages.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, sortOrder: true, isOthers: true, isActive: true },
  })
}

export async function updateSubTaskStage(input: { id: string; name: string; sortOrder: number; isActive: boolean }) {
  try {
    await requireAdmin()
    const trimmed = input.name.trim()
    if (!trimmed) return { success: false, error: 'Stage name is required' }

    await prisma.sub_task_stages.update({
      where: { id: input.id },
      data: {
        name: trimmed,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      },
    })
    revalidatePath('/admin')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update stage' }
  }
}

export async function createSubTaskStage(input: { name: string; sortOrder: number }) {
  try {
    await requireAdmin()
    const trimmed = input.name.trim()
    if (!trimmed) return { success: false, error: 'Stage name is required' }

    await prisma.sub_task_stages.create({
      data: {
        name: trimmed,
        sortOrder: input.sortOrder,
        isDefault: false,
        isOthers: false,
        isActive: true,
      },
    })
    revalidatePath('/admin')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create stage' }
  }
}

export async function deactivateSubTaskStage(id: string) {
  try {
    await requireAdmin()
    const stage = await prisma.sub_task_stages.findUnique({
      where: { id },
      select: { isOthers: true },
    })
    if (stage?.isOthers) return { success: false, error: 'Others stage cannot be deactivated' }

    await prisma.sub_task_stages.update({
      where: { id },
      data: { isActive: false },
    })
    revalidatePath('/admin')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to deactivate stage' }
  }
}
```

- [ ] **Step 4: Create `src/components/admin/sub-task-stage-settings.tsx`**

Create a client component that receives initial stages, renders name/sort order/active controls, calls `updateSubTaskStage`, `createSubTaskStage`, and `deactivateSubTaskStage`, and disables deactivation for `isOthers`.

- [ ] **Step 5: Render settings on admin page**

In `src/app/admin/page.tsx`, import `getSubTaskStagesForAdmin` and `SubTaskStageSettings`, load the stages with existing admin page data, and render:

```tsx
<SubTaskStageSettings initialStages={subTaskStages} />
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/server-actions/sub-task-stages.ts src/components/admin/sub-task-stage-settings.tsx src/app/admin/page.tsx tests/regression/engineering-sub-tasks.test.ts
git commit -m "feat: add admin sub-task stage management"
```

---

### Task 7: End-to-End Smoke Tests

**Files:**
- Create: `tests/e2e/engineering-sub-tasks.spec.ts`

- [ ] **Step 1: Create E2E smoke test**

Create `tests/e2e/engineering-sub-tasks.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const TEST_USERS = {
  engineering: { email: 'eng1@example.com', password: 'changeme' },
}

async function login(page: any, email: string, password: string) {
  await page.goto('/login')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|engineering)/, { timeout: 10000 })
}

test.describe('engineering sub-tasks', () => {
  test('engineer manages request sub-tasks and WR from a collapsed panel', async ({ page }) => {
    await login(page, TEST_USERS.engineering.email, TEST_USERS.engineering.password)
    await page.goto('/engineering')
    await page.waitForLoadState('networkidle')

    const allTab = page.getByRole('button', { name: 'All Engineering Requests' })
    if (await allTab.isVisible().catch(() => false)) {
      await allTab.click()
    }

    const firstRequest = page.locator('[data-testid="engineering-request-row"]').first()
    const fallbackRequest = page.locator('text=/Sent to Engineer|Final Approval|Completed/').first()

    if (await firstRequest.isVisible().catch(() => false)) {
      await firstRequest.click()
    } else if (await fallbackRequest.isVisible().catch(() => false)) {
      await fallbackRequest.click()
    } else {
      test.skip(true, 'No engineering-visible request found in seeded data')
      return
    }

    await expect(page.getByRole('dialog')).toBeVisible()
    const subTasksTrigger = page.getByRole('button', { name: /Sub-tasks/ })
    await expect(subTasksTrigger).toBeVisible()
    await expect(page.getByText('Work requisition received')).toBeHidden()

    await subTasksTrigger.click()
    await expect(page.getByText('Work requisition received')).toBeVisible()

    await page.getByRole('button', { name: 'Add sub-task' }).click()
    await page.getByLabel('Description').fill('Piping work')
    await page.getByLabel('Stage').click()
    await page.getByRole('option', { name: 'Site survey' }).click()
    await page.getByLabel('Subcontractor').click()

    if (await page.getByRole('option', { name: 'A company' }).isVisible().catch(() => false)) {
      await page.getByRole('option', { name: 'A company' }).click()
    } else {
      await page.getByRole('button', { name: 'Add subcontractor' }).click()
      await page.getByLabel('Subcontractor name').fill('A company')
      await page.getByRole('button', { name: 'Save subcontractor' }).click()
      await page.getByLabel('Subcontractor').click()
      await page.getByRole('option', { name: 'A company' }).click()
    }

    await page.getByRole('button', { name: 'Save sub-task' }).click()
    await expect(page.getByText('Piping work')).toBeVisible()
    await expect(page.getByText(/Last edited/)).toBeVisible()

    await page.getByLabel('Work requisition received').check()
    await expect(page.getByText('WR received')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()

    if (await firstRequest.isVisible().catch(() => false)) {
      await firstRequest.click()
    } else {
      await fallbackRequest.click()
    }

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('button', { name: /Sub-tasks/ })).toBeVisible()
    await expect(page.getByText('Work requisition received')).toBeHidden()
  })
})
```

- [ ] **Step 2: Add stable row test IDs if needed**

If the first test run cannot find an engineering request row reliably, add this attribute to the clickable request row in `src/components/engineering/engineering-dashboard-tabs.tsx`:

```tsx
data-testid="engineering-request-row"
```

Then rerun the test. If the text fallback works, leave the component unchanged.

- [ ] **Step 3: Run E2E test**

Run:

```bash
TEST_BASE_URL=http://127.0.0.1:3001 npx playwright test tests/e2e/engineering-sub-tasks.spec.ts
```

Expected: PASS against the local dev server.

- [ ] **Step 4: Commit**

Run:

```bash
git add tests/e2e/engineering-sub-tasks.spec.ts
git commit -m "test: add engineering sub-task smoke coverage"
```

---

### Task 8: Final Verification

**Files:**
- No source files unless verification finds a defect.

- [ ] **Step 1: Apply migration to local Docker database**

Run:

```bash
DATABASE_URL='postgresql://postgres:changeme@127.0.0.1:5432/app_db?schema=public' npx prisma migrate deploy
DATABASE_URL='postgresql://postgres:changeme@127.0.0.1:5432/app_db?schema=public' npx prisma db seed
```

Expected: migration applies and seed confirms default sub-task stages.

- [ ] **Step 2: Run full regression checks**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
npx tsx --test tests/regression/budget-control.test.ts
npx tsx --test tests/regression/budget-control-wiring.test.ts
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 3: Run rendered QA**

Start dev server if not already running:

```bash
NEXTAUTH_URL='http://127.0.0.1:3001' AUTH_URL='http://127.0.0.1:3001' npm run dev -- --hostname 127.0.0.1 -p 3001
```

Run:

```bash
TEST_BASE_URL=http://127.0.0.1:3001 npx playwright test tests/e2e/engineering-sub-tasks.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Manual browser smoke**

Verify these user-visible cases:

- `Sub-tasks` hidden for `DesignCostEstimationApproval`.
- `Sub-tasks` visible and collapsed for `SentToEngineer`, `SendBackToRequester`, `FinalApproval`, and `Completed`.
- Engineer/admin can create, edit, complete, delete sub-tasks.
- General user can view but cannot mutate.
- Expanded view uses `Work requisition received`.
- Collapsed header uses `WR received` or `No WR`.
- Reopening a modal always starts collapsed.
- `/dashboard` and `/requests` WR filters work.
- `/engineering` stale incomplete sub-task filter works by stage and X days.

- [ ] **Step 5: Commit fixes if verification required changes**

If verification required source changes, inspect and commit only the files changed for engineering sub-tasks:

```bash
git status --short
git add docs/superpowers/plans/2026-06-06-engineering-sub-tasks.md tests/e2e/engineering-sub-tasks.spec.ts src/components/engineering/engineering-dashboard-tabs.tsx
git commit -m "fix: complete engineering sub-task verification"
```

If `git status --short` shows no source changes from verification, do not create an empty commit.
