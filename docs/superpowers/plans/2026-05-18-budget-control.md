# Budget Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated Budget Monitor page where users assign visible requests to budget codes by dragging remaining requests into stacked budget-code boxes, monitor used and remaining budget, and export filtered XLSX results.

**Architecture:** Add a small budget domain beside the existing request workflow. Prisma stores learned budget codes and optional request budget metadata; server actions enforce existing request visibility; a new dashboard page owns all assignment and monitoring UI without touching existing request forms or modals.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma/PostgreSQL, shadcn/ui, Tailwind CSS, `@dnd-kit`, `xlsx`, Node `node:test` regression tests.

---

## File Structure

- Modify `prisma/schema.prisma`: add `budget_codes` model and optional request relation fields.
- Create `prisma/migrations/20260518000000_add_budget_control/migration.sql`: database migration for budget-code table and request columns.
- Create `src/types/budget.ts`: shared Budget Monitor types.
- Create `src/lib/budget-control.ts`: pure helpers for normalization, fuzzy matching, usage calculation, grouping, and XLSX row building.
- Create `src/server-actions/budget-control.ts`: authenticated server actions for page data, budget-code creation, assignment, estimate edits, amount edits, unassignment, and XLSX export.
- Create `src/components/budget/budget-monitor-page.tsx`: client page container with filters, drag-and-drop context, collapse state, and export action.
- Create `src/components/budget/budget-code-box.tsx`: stacked collapsible budget-code section and drop target.
- Create `src/components/budget/remaining-request-panel.tsx`: sticky collapsible remaining-request side panel and draggable cards.
- Create `src/components/budget/budget-edit-dialog.tsx`: compact dialog for editing budget code amount and request project estimate.
- Create `src/components/budget/budget-code-create-dialog.tsx`: compact dialog for creating an empty budget-code box.
- Create `src/app/(dashboard)/budget-monitor/page.tsx`: authenticated page entry.
- Modify `src/components/navigation/navbar.tsx`: add Budget Monitor desktop nav link.
- Modify `src/components/mobile/mobile-nav.tsx`: add Budget Monitor mobile nav link.
- Create `tests/regression/budget-control.test.ts`: pure helper tests.
- Create `tests/regression/budget-control-wiring.test.ts`: page and navigation wiring tests.

## Task 1: Data Model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260518000000_add_budget_control/migration.sql`

- [ ] **Step 1: Add Prisma schema fields**

In `prisma/schema.prisma`, add this model near the other request-related models:

```prisma
model budget_codes {
  id           String     @id @default(uuid())
  code         String     @unique
  displayCode  String
  budgetAmount Decimal?   @db.Decimal(15, 2)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  requests     requests[]

  @@index([displayCode])
}
```

In the existing `requests` model, add:

```prisma
  budgetCodeId        String?
  projectEstimateCost Decimal?      @db.Decimal(15, 2)
  budgetCode          budget_codes? @relation(fields: [budgetCodeId], references: [id], onDelete: SetNull)
```

Add indexes inside the existing `requests` model:

```prisma
  @@index([budgetCodeId])
```

- [ ] **Step 2: Create the SQL migration**

Create `prisma/migrations/20260518000000_add_budget_control/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "budget_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "budgetAmount" DECIMAL(15,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_codes_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "requests" ADD COLUMN "budgetCodeId" TEXT;
ALTER TABLE "requests" ADD COLUMN "projectEstimateCost" DECIMAL(15,2);

-- CreateIndex
CREATE UNIQUE INDEX "budget_codes_code_key" ON "budget_codes"("code");
CREATE INDEX "budget_codes_displayCode_idx" ON "budget_codes"("displayCode");
CREATE INDEX "requests_budgetCodeId_idx" ON "requests"("budgetCodeId");

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_budgetCodeId_fkey" FOREIGN KEY ("budgetCodeId") REFERENCES "budget_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma client**

Run: `npx prisma generate`

Expected: command exits 0 and regenerates `@prisma/client` types.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260518000000_add_budget_control/migration.sql
git commit -m "feat: add budget control data model"
```

## Task 2: Pure Budget Helpers

**Files:**
- Create: `src/types/budget.ts`
- Create: `src/lib/budget-control.ts`
- Create: `tests/regression/budget-control.test.ts`

- [ ] **Step 1: Write helper tests**

Create `tests/regression/budget-control.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBudgetCodeGroups,
  buildBudgetExportRows,
  fuzzyMatchBudgetCode,
  getBudgetUsageAmount,
  normalizeBudgetCode,
} from '../../src/lib/budget-control'

describe('budget control helpers', () => {
  it('normalizes budget codes for case-insensitive lookup', () => {
    assert.equal(normalizeBudgetCode(' capex-2026-it '), 'CAPEX-2026-IT')
    assert.equal(normalizeBudgetCode('CAPEX  2026 IT'), 'CAPEX 2026 IT')
  })

  it('matches budget codes by fuzzy ordered characters', () => {
    assert.equal(fuzzyMatchBudgetCode('CAPEX-2026-IT', 'c26it'), true)
    assert.equal(fuzzyMatchBudgetCode('OPEX-FAC-042', 'it'), false)
  })

  it('prefers engineering estimate over project estimate for usage', () => {
    assert.equal(getBudgetUsageAmount({ projectEstimateCost: 100, engineeringEstimateCost: 250 }), 250)
    assert.equal(getBudgetUsageAmount({ projectEstimateCost: 100, engineeringEstimateCost: null }), 100)
    assert.equal(getBudgetUsageAmount({ projectEstimateCost: null, engineeringEstimateCost: null }), 0)
  })

  it('groups assigned requests and calculates remaining budget', () => {
    const groups = buildBudgetCodeGroups([
      {
        id: 'r1',
        title: 'Server storage',
        status: 'Completed',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        department: { id: 'd1', name: 'IT' },
        budgetCode: { id: 'b1', code: 'CAPEX-2026-IT', displayCode: 'CAPEX-2026-IT', budgetAmount: 1000 },
        projectEstimateCost: 200,
        engineeringEstimateCost: 250,
      },
      {
        id: 'r2',
        title: 'Network expansion',
        status: 'ImprovementRequest',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        department: { id: 'd1', name: 'IT' },
        budgetCode: { id: 'b1', code: 'CAPEX-2026-IT', displayCode: 'CAPEX-2026-IT', budgetAmount: 1000 },
        projectEstimateCost: 300,
        engineeringEstimateCost: null,
      },
    ])

    assert.equal(groups.length, 1)
    assert.equal(groups[0].usedAmount, 550)
    assert.equal(groups[0].remainingBudget, 450)
    assert.equal(groups[0].requests.length, 2)
  })

  it('builds export rows with calculated usage fields', () => {
    const rows = buildBudgetExportRows([
      {
        id: 'r1',
        title: 'Server storage',
        status: 'Completed',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        department: { id: 'd1', name: 'IT' },
        budgetCode: { id: 'b1', code: 'CAPEX-2026-IT', displayCode: 'CAPEX-2026-IT', budgetAmount: 1000 },
        projectEstimateCost: 200,
        engineeringEstimateCost: 250,
      },
    ])

    assert.deepEqual(rows, [
      {
        'Budget Code': 'CAPEX-2026-IT',
        'Budget Amount': 1000,
        'Used Amount': 250,
        'Remaining Budget': 750,
        'Request Title': 'Server storage',
        Department: 'IT',
        Status: 'Completed',
        'Project Estimate Cost': 200,
        'Engineering Estimate Cost': 250,
        'Usage Amount': 250,
        'Request Created Date': '2026-01-01',
      },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: FAIL with module not found for `src/lib/budget-control`.

- [ ] **Step 3: Create shared types**

Create `src/types/budget.ts`:

```ts
export interface BudgetCodeSummary {
  id: string
  code: string
  displayCode: string
  budgetAmount: number | null
}

export interface BudgetRequestRecord {
  id: string
  title: string
  status: string
  createdAt: Date
  department: {
    id: string
    name: string
  } | null
  budgetCode: BudgetCodeSummary | null
  projectEstimateCost: number | null
  engineeringEstimateCost: number | null
}

export interface BudgetCodeGroup {
  budgetCode: BudgetCodeSummary
  usedAmount: number
  remainingBudget: number | null
  assignedRequestCount: number
  requests: Array<BudgetRequestRecord & { usageAmount: number }>
}

export interface BudgetMonitorFilters {
  budgetCodeSearch?: string
  requestSearch?: string
  departmentId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
}

export interface BudgetMonitorData {
  budgetCodes: BudgetCodeSummary[]
  groups: BudgetCodeGroup[]
  remainingRequests: BudgetRequestRecord[]
  filters: {
    departments: Array<{ id: string; name: string }>
    statuses: string[]
  }
}
```

- [ ] **Step 4: Implement pure helpers**

Create `src/lib/budget-control.ts`:

```ts
import type { BudgetCodeGroup, BudgetRequestRecord } from '@/types/budget'

export function normalizeBudgetCode(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function fuzzyMatchBudgetCode(code: string, query: string): boolean {
  const normalizedCode = normalizeBudgetCode(code)
  const normalizedQuery = normalizeBudgetCode(query)

  if (!normalizedQuery) return true
  if (normalizedCode.includes(normalizedQuery)) return true

  let queryIndex = 0
  for (const char of normalizedCode) {
    if (char === normalizedQuery[queryIndex]) {
      queryIndex += 1
      if (queryIndex === normalizedQuery.length) return true
    }
  }

  return false
}

export function getBudgetUsageAmount(input: {
  projectEstimateCost: number | null
  engineeringEstimateCost: number | null
}): number {
  return input.engineeringEstimateCost ?? input.projectEstimateCost ?? 0
}

export function buildBudgetCodeGroups(requests: BudgetRequestRecord[]): BudgetCodeGroup[] {
  const groupsByCode = new Map<string, BudgetCodeGroup>()

  for (const request of requests) {
    if (!request.budgetCode) continue

    const usageAmount = getBudgetUsageAmount(request)
    const existing = groupsByCode.get(request.budgetCode.id)

    if (!existing) {
      groupsByCode.set(request.budgetCode.id, {
        budgetCode: request.budgetCode,
        usedAmount: usageAmount,
        remainingBudget:
          request.budgetCode.budgetAmount === null
            ? null
            : request.budgetCode.budgetAmount - usageAmount,
        assignedRequestCount: 1,
        requests: [{ ...request, usageAmount }],
      })
      continue
    }

    existing.usedAmount += usageAmount
    existing.remainingBudget =
      existing.budgetCode.budgetAmount === null
        ? null
        : existing.budgetCode.budgetAmount - existing.usedAmount
    existing.assignedRequestCount += 1
    existing.requests.push({ ...request, usageAmount })
  }

  return [...groupsByCode.values()].sort((a, b) =>
    a.budgetCode.displayCode.localeCompare(b.budgetCode.displayCode)
  )
}

export function buildBudgetExportRows(requests: BudgetRequestRecord[]) {
  const groups = buildBudgetCodeGroups(requests)
  const remainingByCode = new Map(groups.map((group) => [group.budgetCode.id, group.remainingBudget]))
  const usedByCode = new Map(groups.map((group) => [group.budgetCode.id, group.usedAmount]))

  return requests
    .filter((request) => request.budgetCode)
    .map((request) => {
      const usageAmount = getBudgetUsageAmount(request)
      const budgetCode = request.budgetCode!

      return {
        'Budget Code': budgetCode.displayCode,
        'Budget Amount': budgetCode.budgetAmount,
        'Used Amount': usedByCode.get(budgetCode.id) ?? usageAmount,
        'Remaining Budget': remainingByCode.get(budgetCode.id) ?? null,
        'Request Title': request.title,
        Department: request.department?.name ?? '',
        Status: request.status,
        'Project Estimate Cost': request.projectEstimateCost,
        'Engineering Estimate Cost': request.engineeringEstimateCost,
        'Usage Amount': usageAmount,
        'Request Created Date': request.createdAt.toISOString().slice(0, 10),
      }
    })
}
```

- [ ] **Step 5: Run helper tests**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/budget.ts src/lib/budget-control.ts tests/regression/budget-control.test.ts
git commit -m "feat: add budget control helpers"
```

## Task 3: Server Actions and XLSX Export

**Files:**
- Create: `src/server-actions/budget-control.ts`
- Test: `tests/regression/budget-control.test.ts`

- [ ] **Step 1: Add server action implementation**

Create `src/server-actions/budget-control.ts` with these exports:

```ts
'use server'

import prisma from '@/lib/prisma'
import { getCurrentUser } from '@/lib/cache/user-cache'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import * as XLSX from 'xlsx'
import {
  buildBudgetCodeGroups,
  buildBudgetExportRows,
  fuzzyMatchBudgetCode,
  normalizeBudgetCode,
} from '@/lib/budget-control'
import type { BudgetMonitorData, BudgetMonitorFilters, BudgetRequestRecord } from '@/types/budget'

const moneySchema = z.coerce.number().min(0).nullable().optional()

const filtersSchema = z.object({
  budgetCodeSearch: z.string().optional(),
  requestSearch: z.string().optional(),
  departmentId: z.string().optional(),
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

const assignSchema = z.object({
  requestId: z.string().min(1),
  budgetCodeId: z.string().min(1).optional(),
  budgetCode: z.string().min(1).optional(),
  budgetAmount: moneySchema,
})

const requestEstimateSchema = z.object({
  requestId: z.string().min(1),
  projectEstimateCost: moneySchema,
})

const budgetAmountSchema = z.object({
  budgetCodeId: z.string().min(1),
  budgetAmount: moneySchema,
})

const createBudgetCodeSchema = z.object({
  budgetCode: z.string().min(1),
  budgetAmount: moneySchema,
})

function buildVisibleRequestWhere(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  if (user.role === 'admin' || user.department?.type === 'ENGINEERING') {
    return { isDeleted: false, isArchived: false }
  }

  return {
    isDeleted: false,
    isArchived: false,
    OR: [
      { departmentId: user.departmentId ?? undefined },
      { approvals: { some: { requiredApproverId: user.id } } },
      { solutions: { some: { approvals: { some: { requiredApproverId: user.id } } } } },
    ],
  }
}

function applyBudgetFilters(where: any, filters: BudgetMonitorFilters) {
  if (filters.departmentId) where.departmentId = filters.departmentId
  if (filters.status) where.status = filters.status as any
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {}
    if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom)
    if (filters.dateTo) {
      const endDate = new Date(filters.dateTo)
      endDate.setHours(23, 59, 59, 999)
      where.createdAt.lte = endDate
    }
  }
  if (filters.requestSearch) {
    where.AND = [
      ...(where.AND ?? []),
      {
        OR: [
          { title: { contains: filters.requestSearch, mode: 'insensitive' } },
          { description: { contains: filters.requestSearch, mode: 'insensitive' } },
          { requester: { name: { contains: filters.requestSearch, mode: 'insensitive' } } },
        ],
      },
    ]
  }
  return where
}

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  return Number(value)
}

function mapBudgetRequest(request: any): BudgetRequestRecord {
  const latestSolution = request.solutions?.[0]

  return {
    id: request.id,
    title: request.title,
    status: request.status,
    createdAt: request.createdAt,
    department: request.department ? { id: request.department.id, name: request.department.name } : null,
    budgetCode: request.budgetCode
      ? {
          id: request.budgetCode.id,
          code: request.budgetCode.code,
          displayCode: request.budgetCode.displayCode,
          budgetAmount: decimalToNumber(request.budgetCode.budgetAmount),
        }
      : null,
    projectEstimateCost: decimalToNumber(request.projectEstimateCost),
    engineeringEstimateCost: decimalToNumber(latestSolution?.costEstimate),
  }
}

async function requireVisibleRequest(requestId: string) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  const request = await prisma.requests.findFirst({
    where: {
      id: requestId,
      ...buildVisibleRequestWhere(user),
    },
    select: { id: true },
  })

  if (!request) throw new Error('Request not found or not visible')
  return user
}

export async function getBudgetMonitorData(input: BudgetMonitorFilters = {}): Promise<BudgetMonitorData> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  const filters = filtersSchema.parse(input)
  const where = applyBudgetFilters(buildVisibleRequestWhere(user), filters)

  const [requests, departments, budgetCodes] = await Promise.all([
    prisma.requests.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        projectEstimateCost: true,
        department: { select: { id: true, name: true } },
        budgetCode: { select: { id: true, code: true, displayCode: true, budgetAmount: true } },
        solutions: {
          select: { costEstimate: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.departments.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.budget_codes.findMany({ select: { id: true, code: true, displayCode: true, budgetAmount: true }, orderBy: { displayCode: 'asc' } }),
  ])

  let mapped = requests.map(mapBudgetRequest)
  if (filters.budgetCodeSearch) {
    mapped = mapped.filter((request) =>
      request.budgetCode
        ? fuzzyMatchBudgetCode(request.budgetCode.displayCode, filters.budgetCodeSearch!)
        : false
    )
  }

  const groups = buildBudgetCodeGroups(mapped)
  const remainingRequests = mapped.filter((request) => !request.budgetCode)

  return {
    budgetCodes: budgetCodes.map((code) => ({
      id: code.id,
      code: code.code,
      displayCode: code.displayCode,
      budgetAmount: decimalToNumber(code.budgetAmount),
    })),
    groups,
    remainingRequests,
    filters: {
      departments,
      statuses: ['ImprovementRequest', 'SentToEngineer', 'DesignCostEstimationApproval', 'SendBackToRequester', 'FinalApproval', 'Completed', 'Cancelled'],
    },
  }
}

export async function assignRequestToBudgetCode(input: z.infer<typeof assignSchema>) {
  const data = assignSchema.parse(input)
  await requireVisibleRequest(data.requestId)

  const budgetCode = data.budgetCodeId
    ? await prisma.budget_codes.findUniqueOrThrow({ where: { id: data.budgetCodeId } })
    : await prisma.budget_codes.upsert({
        where: { code: normalizeBudgetCode(data.budgetCode!) },
        create: {
          code: normalizeBudgetCode(data.budgetCode!),
          displayCode: data.budgetCode!.trim(),
          budgetAmount: data.budgetAmount ?? null,
        },
        update: data.budgetAmount === undefined ? {} : { budgetAmount: data.budgetAmount ?? null },
      })

  await prisma.requests.update({
    where: { id: data.requestId },
    data: { budgetCodeId: budgetCode.id },
  })

  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function unassignRequestBudgetCode(requestId: string) {
  await requireVisibleRequest(requestId)
  await prisma.requests.update({ where: { id: requestId }, data: { budgetCodeId: null } })
  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function updateRequestProjectEstimate(input: z.infer<typeof requestEstimateSchema>) {
  const data = requestEstimateSchema.parse(input)
  await requireVisibleRequest(data.requestId)
  await prisma.requests.update({
    where: { id: data.requestId },
    data: { projectEstimateCost: data.projectEstimateCost ?? null },
  })
  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function updateBudgetCodeAmount(input: z.infer<typeof budgetAmountSchema>) {
  const data = budgetAmountSchema.parse(input)
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  const visibleUsage = await prisma.requests.findFirst({
    where: {
      ...buildVisibleRequestWhere(user),
      budgetCodeId: data.budgetCodeId,
    },
    select: { id: true },
  })

  if (!visibleUsage) throw new Error('Budget code not visible')

  await prisma.budget_codes.update({
    where: { id: data.budgetCodeId },
    data: { budgetAmount: data.budgetAmount ?? null },
  })
  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function createBudgetCode(input: z.infer<typeof createBudgetCodeSchema>) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  const data = createBudgetCodeSchema.parse(input)
  await prisma.budget_codes.upsert({
    where: { code: normalizeBudgetCode(data.budgetCode) },
    create: {
      code: normalizeBudgetCode(data.budgetCode),
      displayCode: data.budgetCode.trim(),
      budgetAmount: data.budgetAmount ?? null,
    },
    update: {
      budgetAmount: data.budgetAmount ?? null,
    },
  })

  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function exportBudgetMonitorXlsx(input: BudgetMonitorFilters = {}) {
  const data = await getBudgetMonitorData(input)
  const rows = buildBudgetExportRows(data.groups.flatMap((group) => group.requests))
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Budget Monitor')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return {
    fileName: `budget-monitor-${new Date().toISOString().slice(0, 10)}.xlsx`,
    base64: buffer.toString('base64'),
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`

Expected: PASS. If Prisma types are stale, rerun `npx prisma generate` and repeat.

- [ ] **Step 3: Commit**

```bash
git add src/server-actions/budget-control.ts
git commit -m "feat: add budget monitor server actions"
```

## Task 4: Budget Monitor UI Components

**Files:**
- Create: `src/components/budget/budget-monitor-page.tsx`
- Create: `src/components/budget/budget-code-box.tsx`
- Create: `src/components/budget/remaining-request-panel.tsx`
- Create: `src/components/budget/budget-edit-dialog.tsx`
- Create: `src/components/budget/budget-code-create-dialog.tsx`

- [ ] **Step 1: Create edit dialog**

Create `src/components/budget/budget-edit-dialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface BudgetEditDialogProps {
  open: boolean
  title: string
  label: string
  initialValue: number | null
  onOpenChange: (open: boolean) => void
  onSave: (value: number | null) => Promise<void>
}

export function BudgetEditDialog({
  open,
  title,
  label,
  initialValue,
  onOpenChange,
  onSave,
}: BudgetEditDialogProps) {
  const [value, setValue] = useState(initialValue?.toString() ?? '')
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave() {
    setIsSaving(true)
    try {
      await onSave(value.trim() === '' ? null : Number(value))
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="budget-edit-value">{label}</Label>
          <Input
            id="budget-edit-value"
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSaving}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create budget code create dialog**

Create `src/components/budget/budget-code-create-dialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface BudgetCodeCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: { budgetCode: string; budgetAmount: number | null }) => Promise<void>
}

export function BudgetCodeCreateDialog({ open, onOpenChange, onCreate }: BudgetCodeCreateDialogProps) {
  const [budgetCode, setBudgetCode] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  async function handleCreate() {
    setIsSaving(true)
    try {
      await onCreate({
        budgetCode,
        budgetAmount: budgetAmount.trim() === '' ? null : Number(budgetAmount),
      })
      setBudgetCode('')
      setBudgetAmount('')
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New budget code</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="new-budget-code">Budget code</Label>
            <Input id="new-budget-code" value={budgetCode} onChange={(event) => setBudgetCode(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-budget-amount">Budget amount</Label>
            <Input id="new-budget-amount" type="number" min="0" step="0.01" value={budgetAmount} onChange={(event) => setBudgetAmount(event.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreate} disabled={isSaving || budgetCode.trim() === ''}>
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Create remaining request panel**

Create `src/components/budget/remaining-request-panel.tsx`:

```tsx
'use client'

import { useDraggable } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BudgetRequestRecord } from '@/types/budget'

function RemainingRequestCard({ request }: { request: BudgetRequestRecord }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: request.id,
    data: { type: 'request', requestId: request.id },
  })

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`rounded-md border border-amber-200 bg-amber-50 p-3 shadow-sm ${isDragging ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-950">{request.title}</div>
          <div className="mt-1 text-xs text-gray-600">
            {request.department?.name ?? 'No department'} · {request.status}
          </div>
          <div className="mt-1 text-xs text-amber-800">
            Estimate: {request.projectEstimateCost?.toLocaleString() ?? '-'}
          </div>
        </div>
      </div>
    </div>
  )
}

export function RemainingRequestPanel({
  requests,
  collapsed,
  onCollapsedChange,
}: {
  requests: BudgetRequestRecord[]
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}) {
  if (collapsed) {
    return (
      <aside className="sticky top-4">
        <Button variant="outline" className="h-auto flex-col gap-2 px-3 py-4" onClick={() => onCollapsedChange(false)}>
          <ChevronLeft className="h-4 w-4" />
          <span className="text-xs font-semibold">{requests.length} remaining</span>
        </Button>
      </aside>
    )
  }

  return (
    <aside className="sticky top-4 max-h-[calc(100vh-7rem)] overflow-hidden rounded-lg border bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b bg-gray-50 p-3">
        <div>
          <h2 className="text-sm font-semibold">Remaining request list</h2>
          <p className="text-xs text-gray-500">Only unassigned visible requests appear here.</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onCollapsedChange(true)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid max-h-[calc(100vh-12rem)] gap-2 overflow-y-auto p-3">
        {requests.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-gray-500">
            No remaining requests
          </div>
        ) : (
          requests.map((request) => <RemainingRequestCard key={request.id} request={request} />)
        )}
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Create budget code box**

Create `src/components/budget/budget-code-box.tsx`:

```tsx
'use client'

import { useDroppable } from '@dnd-kit/core'
import { ChevronDown, ChevronRight, Edit2, MinusCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BudgetCodeGroup } from '@/types/budget'

export function BudgetCodeBox({
  group,
  collapsed,
  onCollapsedChange,
  onEditBudgetAmount,
  onEditProjectEstimate,
  onUnassign,
}: {
  group: BudgetCodeGroup
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onEditBudgetAmount: () => void
  onEditProjectEstimate: (requestId: string, value: number | null) => void
  onUnassign: (requestId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: group.budgetCode.id,
    data: { type: 'budget-code', budgetCodeId: group.budgetCode.id },
  })

  return (
    <section className={`overflow-hidden rounded-lg border bg-white shadow-sm ${isOver ? 'ring-2 ring-blue-500' : ''}`}>
      <div className="border-b bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-bold tracking-normal text-gray-950">{group.budgetCode.displayCode}</h2>
            <p className="mt-1 text-xs text-gray-500">{group.assignedRequestCount} assigned request(s)</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onEditBudgetAmount} title="Edit budget amount">
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onCollapsedChange(!collapsed)} title="Minimize budget box">
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border bg-white p-2">
            <div className="text-xs text-gray-500">Budget amount</div>
            <div className="text-sm font-semibold">{group.budgetCode.budgetAmount?.toLocaleString() ?? '-'}</div>
          </div>
          <div className="rounded-md border bg-white p-2">
            <div className="text-xs text-gray-500">Used amount</div>
            <div className="text-sm font-semibold">{group.usedAmount.toLocaleString()}</div>
          </div>
          <div className="rounded-md border bg-white p-2">
            <div className="text-xs text-gray-500">Remaining budget</div>
            <div className="text-sm font-semibold">{group.remainingBudget?.toLocaleString() ?? '-'}</div>
          </div>
        </div>
      </div>

      {!collapsed && (
        <div ref={setNodeRef} className="p-3">
          <div className="grid grid-cols-[1.6fr_.7fr_.8fr_.9fr_.9fr_auto] border-b px-2 py-2 text-xs font-semibold text-gray-600">
            <div>Request</div>
            <div>Dept.</div>
            <div>Status</div>
            <div className="text-right">Budget amount</div>
            <div className="text-right">Remaining budget</div>
            <div />
          </div>
          {group.requests.map((request) => (
            <div key={request.id} className="grid grid-cols-[1.6fr_.7fr_.8fr_.9fr_.9fr_auto] items-center border-b px-2 py-2 text-sm">
              <div className="min-w-0 truncate font-medium">{request.title}</div>
              <div className="truncate text-gray-600">{request.department?.name ?? '-'}</div>
              <div className="truncate text-gray-600">{request.status}</div>
              <button className="text-right text-blue-700 hover:underline" onClick={() => onEditProjectEstimate(request.id, request.projectEstimateCost)}>
                {request.projectEstimateCost?.toLocaleString() ?? '-'}
              </button>
              <div className="text-right text-gray-600">{group.remainingBudget?.toLocaleString() ?? '-'}</div>
              <Button variant="ghost" size="icon" onClick={() => onUnassign(request.id)} title="Unassign request">
                <MinusCircle className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="mt-3 rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">
            Drop remaining request here
          </div>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Create page container**

Create `src/components/budget/budget-monitor-page.tsx`. Include imports for `DndContext`, `DragEndEvent`, `toast` from `sonner`, server actions from `@/server-actions/budget-control`, and the components above. The component must:

```tsx
'use client'

import { useMemo, useState, useTransition } from 'react'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { Download, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BudgetCodeBox } from '@/components/budget/budget-code-box'
import { BudgetCodeCreateDialog } from '@/components/budget/budget-code-create-dialog'
import { BudgetEditDialog } from '@/components/budget/budget-edit-dialog'
import { RemainingRequestPanel } from '@/components/budget/remaining-request-panel'
import {
  assignRequestToBudgetCode,
  createBudgetCode,
  exportBudgetMonitorXlsx,
  getBudgetMonitorData,
  unassignRequestBudgetCode,
  updateBudgetCodeAmount,
  updateRequestProjectEstimate,
} from '@/server-actions/budget-control'
import type { BudgetCodeGroup, BudgetMonitorData, BudgetMonitorFilters } from '@/types/budget'

export function BudgetMonitorPage({ initialData }: { initialData: BudgetMonitorData }) {
  const [data, setData] = useState(initialData)
  const [filters, setFilters] = useState<BudgetMonitorFilters>({})
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [remainingCollapsed, setRemainingCollapsed] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [editDialog, setEditDialog] = useState<
    | { type: 'budget'; group: BudgetCodeGroup }
    | { type: 'estimate'; requestId: string; value: number | null }
    | null
  >(null)

  const groupIds = useMemo(() => new Set(data.groups.map((group) => group.budgetCode.id)), [data.groups])

  function refresh(nextFilters = filters) {
    startTransition(async () => {
      setData(await getBudgetMonitorData(nextFilters))
    })
  }

  async function handleDragEnd(event: DragEndEvent) {
    const requestId = String(event.active.id)
    const budgetCodeId = event.over?.id ? String(event.over.id) : null
    if (!budgetCodeId || !groupIds.has(budgetCodeId)) return

    try {
      await assignRequestToBudgetCode({ requestId, budgetCodeId })
      toast.success('Request assigned')
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to assign request')
    }
  }

  async function handleExport() {
    const result = await exportBudgetMonitorXlsx(filters)
    const link = document.createElement('a')
    link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.base64}`
    link.download = result.fileName
    link.click()
  }

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="space-y-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-bold tracking-normal">Budget Monitor</h1>
            <p className="text-sm text-gray-500">Assign remaining requests into budget-code boxes and monitor visible usage.</p>
          </div>
          <Button onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export XLSX
          </Button>
        </div>

        <div className="grid gap-2 rounded-lg border bg-white p-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
          <Input placeholder="Filter budget code" value={filters.budgetCodeSearch ?? ''} onChange={(event) => setFilters({ ...filters, budgetCodeSearch: event.target.value })} />
          <Input placeholder="Filter remaining request" value={filters.requestSearch ?? ''} onChange={(event) => setFilters({ ...filters, requestSearch: event.target.value })} />
          <Select value={filters.departmentId ?? 'all'} onValueChange={(value) => setFilters({ ...filters, departmentId: value === 'all' ? undefined : value })}>
            <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {data.filters.departments.map((department) => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.status ?? 'all'} onValueChange={(value) => setFilters({ ...filters, status: value === 'all' ? undefined : value })}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {data.filters.statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button disabled={isPending} onClick={() => refresh()}>
            Apply
          </Button>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Button variant="outline" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New budget code
            </Button>
            {data.groups.map((group) => (
              <BudgetCodeBox
                key={group.budgetCode.id}
                group={group}
                collapsed={collapsedGroups.has(group.budgetCode.id)}
                onCollapsedChange={(collapsed) => {
                  const next = new Set(collapsedGroups)
                  if (collapsed) next.add(group.budgetCode.id)
                  else next.delete(group.budgetCode.id)
                  setCollapsedGroups(next)
                }}
                onEditBudgetAmount={() => setEditDialog({ type: 'budget', group })}
                onEditProjectEstimate={(requestId, value) => setEditDialog({ type: 'estimate', requestId, value })}
                onUnassign={async (requestId) => {
                  await unassignRequestBudgetCode(requestId)
                  refresh()
                }}
              />
            ))}
          </div>
          <RemainingRequestPanel requests={data.remainingRequests} collapsed={remainingCollapsed} onCollapsedChange={setRemainingCollapsed} />
        </div>

        <BudgetEditDialog
          open={editDialog !== null}
          title={editDialog?.type === 'budget' ? 'Edit budget amount' : 'Edit project estimate cost'}
          label={editDialog?.type === 'budget' ? 'Budget amount' : 'Project estimate cost'}
          initialValue={editDialog?.type === 'budget' ? editDialog.group.budgetCode.budgetAmount : editDialog?.value ?? null}
          onOpenChange={(open) => !open && setEditDialog(null)}
          onSave={async (value) => {
            if (editDialog?.type === 'budget') {
              await updateBudgetCodeAmount({ budgetCodeId: editDialog.group.budgetCode.id, budgetAmount: value })
            } else if (editDialog?.type === 'estimate') {
              await updateRequestProjectEstimate({ requestId: editDialog.requestId, projectEstimateCost: value })
            }
            refresh()
          }}
        />
        <BudgetCodeCreateDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onCreate={async (input) => {
            await createBudgetCode(input)
            refresh()
          }}
        />
      </div>
    </DndContext>
  )
}
```

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/budget
git commit -m "feat: add budget monitor components"
```

## Task 5: Page Route and Navigation

**Files:**
- Create: `src/app/(dashboard)/budget-monitor/page.tsx`
- Modify: `src/components/navigation/navbar.tsx`
- Modify: `src/components/mobile/mobile-nav.tsx`
- Create: `tests/regression/budget-control-wiring.test.ts`

- [ ] **Step 1: Write wiring test**

Create `tests/regression/budget-control-wiring.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

describe('budget control wiring', () => {
  it('adds the budget monitor route and server data load', () => {
    const page = readFileSync('src/app/(dashboard)/budget-monitor/page.tsx', 'utf8')
    assert.match(page, /getBudgetMonitorData/)
    assert.match(page, /BudgetMonitorPage/)
  })

  it('adds budget monitor navigation links', () => {
    const navbar = readFileSync('src/components/navigation/navbar.tsx', 'utf8')
    const mobileNav = readFileSync('src/components/mobile/mobile-nav.tsx', 'utf8')
    assert.match(navbar, /href="\/budget-monitor"/)
    assert.match(navbar, /Budget Monitor/)
    assert.match(mobileNav, /href: '\/budget-monitor'/)
    assert.match(mobileNav, /Budget/)
  })
})
```

- [ ] **Step 2: Run wiring test to verify it fails**

Run: `npx tsx --test tests/regression/budget-control-wiring.test.ts`

Expected: FAIL because route and nav are not wired yet.

- [ ] **Step 3: Create page route**

Create `src/app/(dashboard)/budget-monitor/page.tsx`:

```tsx
import { BudgetMonitorPage } from '@/components/budget/budget-monitor-page'
import { getBudgetMonitorData } from '@/server-actions/budget-control'

export default async function BudgetMonitorRoute() {
  const initialData = await getBudgetMonitorData()
  return <BudgetMonitorPage initialData={initialData} />
}
```

- [ ] **Step 4: Add desktop nav link**

In `src/components/navigation/navbar.tsx`, add `WalletCards` to the `lucide-react` import:

```ts
import { FileText, Settings, Bell, Wrench, BarChart3, LogOut, Lock, LayoutDashboard, WalletCards } from 'lucide-react'
```

Add this link after Analytics:

```tsx
<Link
  href="/budget-monitor"
  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
    pathname === '/budget-monitor'
      ? 'bg-gray-100 text-gray-900'
      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
  }`}
>
  <WalletCards className="h-4 w-4" />
  Budget Monitor
</Link>
```

- [ ] **Step 5: Add mobile nav link**

In `src/components/mobile/mobile-nav.tsx`, add `WalletCards` to the import:

```ts
import { LayoutDashboard, FileText, Bell, BarChart3, WalletCards } from 'lucide-react'
```

Add this tab to `tabs`:

```ts
{ name: 'Budget', href: '/budget-monitor', icon: WalletCards },
```

- [ ] **Step 6: Run wiring test**

Run: `npx tsx --test tests/regression/budget-control-wiring.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/(dashboard)/budget-monitor/page.tsx src/components/navigation/navbar.tsx src/components/mobile/mobile-nav.tsx tests/regression/budget-control-wiring.test.ts
git commit -m "feat: wire budget monitor page"
```

## Task 6: Polish, Verification, and Graph Update

**Files:**
- Verify: `src/components/budget/budget-monitor-page.tsx`
- Verify: `src/components/budget/budget-code-box.tsx`
- Verify: `src/components/budget/remaining-request-panel.tsx`
- Verify: `src/server-actions/budget-control.ts`
- Update generated graph: `graphify-out/*`

- [ ] **Step 1: Run focused regression tests**

Run:

```bash
npx tsx --test tests/regression/budget-control.test.ts
npx tsx --test tests/regression/budget-control-wiring.test.ts
```

Expected: both PASS.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Start dev server**

Run: `npm run dev`

Expected: dev server starts and prints a localhost URL.

- [ ] **Step 5: Browser verification**

Open `/budget-monitor` in the browser and verify:

- Budget Monitor page renders.
- Budget boxes are stacked vertically.
- Budget boxes can minimize and expand.
- Remaining request list is sticky while scrolling.
- Remaining request list can minimize and expand.
- Dragging a remaining request into a budget box assigns it.
- Assigned request disappears from remaining list.
- XLSX export downloads a workbook.
- Existing request modals and request create form are unchanged.

- [ ] **Step 6: Update graph**

Run: `graphify update .`

Expected: graph update completes without errors.

- [ ] **Step 7: Commit final polish and graph update**

```bash
git add src prisma tests graphify-out
git commit -m "test: verify budget monitor feature"
```
