# Budget Monitor Table Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Budget Monitor drag-and-drop with a tabbed table UI, add required budget-code name/amount plus paste upsert, and keep existing visibility and usage math.

**Architecture:** Keep `getBudgetMonitorData` and the assign/unassign/create/edit/export actions. Add `budget_codes.name`, extend monitor data with a flat `requests` list, and rebuild the page as Budget / Requests tabs. Assignment is a Group select. Paste upserts codes only.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, shadcn/ui (`Tabs`, `Dialog`, `Select`), Tailwind CSS, `xlsx`, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-17-budget-monitor-table-design.md`

## Global Constraints

- Do not run production migrations locally. Write the SQL file; do not run `prisma migrate deploy` or `prisma migrate dev` against production.
- Do not copy the mockup serif/oklch brand. Use existing dashboard / shadcn tokens.
- Do not remove the `@dnd-kit` package. Admin hierarchy still uses it.
- Do not change request create/detail/approval/engineering modals.
- Usage remains `engineeringEstimateCost ?? projectEstimateCost ?? 0`.
- Name and amount are required on create, edit, and paste. Legacy rows may still have `name = null`.
- Tabs exist on every breakpoint. Key: `budget-monitor-view`. Values: `depts` | `requests`. Default: `depts`.
- Reports is `exportBudgetMonitorXlsx(filters)`. No preview sheet. No Excel file import.
- After code changes run `npm run check`.

---

## File Structure

- Modify `prisma/schema.prisma`: add `budget_codes.name String?`.
- Create `prisma/migrations/20260817000000_add_budget_code_name/migration.sql`.
- Modify `src/types/budget.ts`: add `name` and `requests`.
- Modify `src/lib/budget-control.ts`: search `name`; add health, label, department grouping, remaining sum, paste parse/classify.
- Modify `src/server-actions/budget-control.ts`: select/map `name`; return `requests`; require name+amount on create/update; add `pasteBudgetCodes`.
- Modify `src/components/budget/budget-code-create-dialog.tsx`: required name + amount.
- Modify `src/components/budget/budget-code-edit-dialog.tsx`: required name + amount.
- Create `src/components/budget/budget-code-card.tsx`.
- Create `src/components/budget/budget-department-panel.tsx`.
- Create `src/components/budget/budget-request-table.tsx`.
- Create `src/components/budget/budget-code-paste-dialog.tsx`.
- Modify `src/components/budget/budget-monitor-page.tsx`: hero, filter card, tabs, no DnD.
- Delete `src/components/budget/budget-code-box.tsx`.
- Delete `src/components/budget/remaining-request-panel.tsx`.
- Modify `tests/regression/budget-control.test.ts`.
- Modify `tests/regression/budget-control-wiring.test.ts`.

Keep: `budget-search-input.tsx`, `budget-edit-dialog.tsx`, `src/app/(dashboard)/budget-monitor/page.tsx`.

---

### Task 1: Schema, types, and fixture `name`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260817000000_add_budget_code_name/migration.sql`
- Modify: `src/types/budget.ts`
- Modify: `tests/regression/budget-control.test.ts`

**Interfaces:**
- Consumes: existing `budget_codes` model and `BudgetCodeSummary`
- Produces: `budget_codes.name: String?`; `BudgetCodeSummary.name: string | null`; `BudgetMonitorData.requests: BudgetRequestRecord[]`

- [ ] **Step 1: Write the failing type/schema assertions**

In `tests/regression/budget-control.test.ts`, add this describe block after the helper tests (before `budget monitor server actions`):

```ts
describe('budget code name field', () => {
  it('adds a nullable name column and monitor requests list', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    const types = readFileSync('src/types/budget.ts', 'utf8')
    const migration = readFileSync(
      'prisma/migrations/20260817000000_add_budget_code_name/migration.sql',
      'utf8'
    )

    assert.match(schema, /model budget_codes[\s\S]*name\s+String\?/)
    assert.match(migration, /ALTER TABLE "budget_codes" ADD COLUMN "name" TEXT/)
    assert.match(types, /name: string \| null/)
    assert.match(types, /requests: BudgetRequestRecord\[\]/)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: FAIL — migration file missing and/or types missing `name` / `requests`.

- [ ] **Step 3: Add the Prisma field and migration**

In `prisma/schema.prisma`, inside `model budget_codes`, add `name` immediately after `displayCode`:

```prisma
  displayCode  String
  name         String?
  budgetAmount Decimal?   @db.Decimal(15, 2)
```

Create `prisma/migrations/20260817000000_add_budget_code_name/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "budget_codes" ADD COLUMN "name" TEXT;
```

Do not run the migration.

- [ ] **Step 4: Extend shared types**

In `src/types/budget.ts`, add `name` to `BudgetCodeSummary` and `requests` to `BudgetMonitorData`:

```ts
export interface BudgetCodeSummary {
  id: string
  code: string
  displayCode: string
  name: string | null
  budgetAmount: number | null
  department: {
    id: string
    name: string
  } | null
}

export interface BudgetMonitorData {
  budgetCodes: BudgetCodeSummary[]
  groups: BudgetCodeGroup[]
  remainingRequests: BudgetRequestRecord[]
  requests: BudgetRequestRecord[]
  filters: {
    departments: Array<{ id: string; name: string }>
    statuses: string[]
  }
}
```

- [ ] **Step 5: Add `name: null` to every budget-code fixture in `tests/regression/budget-control.test.ts`**

Each `budgetCode: { ... }` object in that file must include `name: null` next to `displayCode`. Example:

```ts
budgetCode: {
  id: 'b1',
  code: 'AYT-PD1-CX-400',
  displayCode: 'AYT-PD1-CX-400',
  name: null,
  budgetAmount: 10000000,
  department: { id: 'd1', name: 'Production 1' },
},
```

- [ ] **Step 6: Run tests**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: PASS for the new schema test. Existing helper tests still pass.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260817000000_add_budget_code_name/migration.sql src/types/budget.ts tests/regression/budget-control.test.ts
git commit -m "feat: add budget code name field and monitor requests list"
```

---

### Task 2: Pure helpers

**Files:**
- Modify: `src/lib/budget-control.ts`
- Modify: `tests/regression/budget-control.test.ts`

**Interfaces:**
- Consumes: `BudgetCodeSummary`, `BudgetCodeGroup`, `BudgetRequestRecord`
- Produces:
  - `matchesBudgetMonitorSearch` also matches `budgetCode.name`
  - `getBudgetCodeLabel(budgetCode: Pick<BudgetCodeSummary, 'name' | 'displayCode'>): string`
  - `getBudgetCodeHealth(remainingBudget: number | null, budgetAmount: number | null): 'Over' | 'Watch' | 'Healthy'`
  - `groupBudgetCodesByDepartment(groups: BudgetCodeGroup[]): Array<{ departmentName: string; departmentId: string | null; groups: BudgetCodeGroup[] }>`
  - `sumVisibleRemainingBudget(groups: BudgetCodeGroup[]): { total: number; groupCount: number }`
  - `parseBudgetCodePaste(text: string): { valid: BudgetCodePasteRow[]; skipped: Array<{ line: number; reason: string; raw: string }> }`
  - `classifyBudgetCodePasteRows(valid: BudgetCodePasteRow[], existingCodes: Array<{ code: string }>): { creates: BudgetCodePasteRow[]; updates: BudgetCodePasteRow[] }`
  - `export type BudgetCodePasteRow = { code: string; displayCode: string; name: string; budgetAmount: number }`
  - `export const MAX_BUDGET_MONEY_AMOUNT = 9999999999999.99`

- [ ] **Step 1: Write failing helper tests**

Append to the helper describe in `tests/regression/budget-control.test.ts` (import the new functions):

```ts
import {
  buildBudgetCodeGroups,
  buildBudgetExportRows,
  classifyBudgetCodePasteRows,
  fuzzyMatchBudgetCode,
  getBudgetCodeHealth,
  getBudgetCodeLabel,
  getBudgetProjectEstimateAmount,
  getBudgetUsageAmount,
  groupBudgetCodesByDepartment,
  matchesBudgetMonitorSearch,
  normalizeBudgetCode,
  parseBudgetCodePaste,
  sumVisibleRemainingBudget,
} from '../../src/lib/budget-control'

it('matches budget monitor search against budget code name', () => {
  const request = {
    title: 'Replace chilled water pump',
    status: 'Completed',
    department: { id: 'd1', name: 'Production 1' },
    budgetCode: {
      id: 'b1',
      code: 'AYT-PD1-CX-400',
      displayCode: 'AYT-PD1-CX-400',
      name: 'Line 2 filler capex',
      budgetAmount: 10000000,
      department: { id: 'd1', name: 'Production 1' },
    },
  }

  assert.equal(matchesBudgetMonitorSearch(request, 'filler capex'), true)
  assert.equal(matchesBudgetMonitorSearch(request, 'warehouse'), false)
})

it('labels a budget code with name and falls back to displayCode', () => {
  assert.equal(getBudgetCodeLabel({ name: 'Filler upgrade', displayCode: 'AYT-PD1-GF-411' }), 'Filler upgrade')
  assert.equal(getBudgetCodeLabel({ name: '  ', displayCode: 'AYT-PD1-GF-411' }), 'AYT-PD1-GF-411')
  assert.equal(getBudgetCodeLabel({ name: null, displayCode: 'AYT-PD1-GF-411' }), 'AYT-PD1-GF-411')
})

it('classifies budget health without blocking', () => {
  assert.equal(getBudgetCodeHealth(-1, 100), 'Over')
  assert.equal(getBudgetCodeHealth(10, 100), 'Watch')
  assert.equal(getBudgetCodeHealth(20, 100), 'Healthy')
  assert.equal(getBudgetCodeHealth(null, null), 'Healthy')
  assert.equal(getBudgetCodeHealth(5, 0), 'Healthy')
})

it('groups budget codes by department and sums remaining', () => {
  const groups = [
    {
      budgetCode: {
        id: 'b1',
        code: 'A',
        displayCode: 'A',
        name: 'Alpha',
        budgetAmount: 100,
        department: { id: 'd1', name: 'Production 1' },
      },
      usedAmount: 40,
      remainingBudget: 60,
      assignedRequestCount: 1,
      requests: [],
    },
    {
      budgetCode: {
        id: 'b2',
        code: 'B',
        displayCode: 'B',
        name: 'Beta',
        budgetAmount: 50,
        department: null,
      },
      usedAmount: 10,
      remainingBudget: 40,
      assignedRequestCount: 0,
      requests: [],
    },
    {
      budgetCode: {
        id: 'b3',
        code: 'C',
        displayCode: 'C',
        name: null,
        budgetAmount: null,
        department: { id: 'd2', name: 'Maintenance' },
      },
      usedAmount: 0,
      remainingBudget: null,
      assignedRequestCount: 0,
      requests: [],
    },
  ]

  const grouped = groupBudgetCodesByDepartment(groups)
  assert.deepEqual(
    grouped.map((entry) => [entry.departmentName, entry.departmentId, entry.groups.length]),
    [
      ['Maintenance', 'd2', 1],
      ['Production 1', 'd1', 1],
      ['No department', null, 1],
    ]
  )

  assert.deepEqual(sumVisibleRemainingBudget(groups), { total: 100, groupCount: 2 })
})

it('parses paste text with headers, aliases, and headerless columns', () => {
  const headed = parseBudgetCodePaste(
    'Budget Code,Budget Code Name,Budget Amount\nAYT-PD1-GF-411,Filler,50000\n,Missing name,10\nAYT-PD1-GF-412,No amount,\nAYT-PD1-GF-411,Duplicate,1\nbad,Bad amount,abc'
  )
  assert.equal(headed.valid.length, 1)
  assert.equal(headed.valid[0].code, 'AYT-PD1-GF-411')
  assert.equal(headed.valid[0].displayCode, 'AYT-PD1-GF-411')
  assert.equal(headed.valid[0].name, 'Filler')
  assert.equal(headed.valid[0].budgetAmount, 50000)
  assert.equal(headed.skipped.length, 4)

  const headerless = parseBudgetCodePaste('AYT-MT-GF-210\tSeal kit\t28000')
  assert.deepEqual(headerless.valid, [
    {
      code: 'AYT-MT-GF-210',
      displayCode: 'AYT-MT-GF-210',
      name: 'Seal kit',
      budgetAmount: 28000,
    },
  ])
  assert.equal(headerless.skipped.length, 0)
})

it('classifies paste rows as creates or updates using normalized codes', () => {
  const classified = classifyBudgetCodePasteRows(
    [
      { code: 'AYT-PD1-GF-411', displayCode: 'AYT-PD1-GF-411', name: 'Filler', budgetAmount: 1 },
      { code: 'AYT-NEW-001', displayCode: 'AYT-NEW-001', name: 'New', budgetAmount: 2 },
    ],
    [{ code: 'AYT-PD1-GF-411' }]
  )
  assert.equal(classified.updates[0].code, 'AYT-PD1-GF-411')
  assert.equal(classified.creates[0].code, 'AYT-NEW-001')
})
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: FAIL — new helpers are not exported.

- [ ] **Step 3: Implement the helpers in `src/lib/budget-control.ts`**

Add the constant and types at the top of the file (after imports):

```ts
export const MAX_BUDGET_MONEY_AMOUNT = 9999999999999.99

export type BudgetCodeHealth = 'Over' | 'Watch' | 'Healthy'

export type BudgetCodePasteRow = {
  code: string
  displayCode: string
  name: string
  budgetAmount: number
}

export type BudgetCodePasteSkip = {
  line: number
  reason: string
  raw: string
}
```

Change `matchesBudgetMonitorSearch` so a named budget code also matches:

```ts
export function matchesBudgetMonitorSearch(
  request: Pick<BudgetRequestRecord, 'title' | 'status' | 'department' | 'budgetCode'>,
  query: string
): boolean {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return true

  if (request.budgetCode && fuzzyMatchBudgetCode(request.budgetCode.displayCode, normalizedQuery)) {
    return true
  }

  if (request.budgetCode?.name && fuzzyMatchBudgetCode(request.budgetCode.name, normalizedQuery)) {
    return true
  }

  const searchableRequestText = [
    request.title,
    request.department?.name ?? '',
    request.status,
    request.budgetCode?.name ?? '',
  ].join(' ').toLowerCase()
  const queryTerms = normalizedQuery.toLowerCase().split(/\s+/).filter(Boolean)

  return queryTerms.every((term) => searchableRequestText.includes(term))
}
```

Add:

```ts
export function getBudgetCodeLabel(budgetCode: Pick<{ name: string | null; displayCode: string }, 'name' | 'displayCode'>): string {
  const name = budgetCode.name?.trim()
  return name ? name : budgetCode.displayCode
}

export function getBudgetCodeHealth(
  remainingBudget: number | null,
  budgetAmount: number | null
): BudgetCodeHealth {
  if (remainingBudget !== null && remainingBudget < 0) return 'Over'
  if (
    remainingBudget !== null &&
    budgetAmount !== null &&
    budgetAmount > 0 &&
    remainingBudget / budgetAmount < 0.15
  ) {
    return 'Watch'
  }
  return 'Healthy'
}

export function groupBudgetCodesByDepartment(groups: BudgetCodeGroup[]) {
  const named = new Map<string, { departmentName: string; departmentId: string; groups: BudgetCodeGroup[] }>()
  const unassigned: BudgetCodeGroup[] = []

  for (const group of groups) {
    const department = group.budgetCode.department
    if (!department) {
      unassigned.push(group)
      continue
    }
    const existing = named.get(department.id)
    if (existing) {
      existing.groups.push(group)
      continue
    }
    named.set(department.id, {
      departmentName: department.name,
      departmentId: department.id,
      groups: [group],
    })
  }

  const departments = [...named.values()].sort((a, b) =>
    a.departmentName.localeCompare(b.departmentName)
  )

  if (unassigned.length > 0) {
    departments.push({
      departmentName: 'No department',
      departmentId: null as unknown as string,
      groups: unassigned,
    })
  }

  return departments.map((entry) => ({
    departmentName: entry.departmentName,
    departmentId: entry.departmentName === 'No department' ? null : entry.departmentId,
    groups: entry.groups,
  }))
}

export function sumVisibleRemainingBudget(groups: BudgetCodeGroup[]) {
  const numbered = groups.filter((group) => group.remainingBudget !== null)
  return {
    total: numbered.reduce((sum, group) => sum + (group.remainingBudget as number), 0),
    groupCount: numbered.length,
  }
}

function splitPasteLine(line: string): string[] {
  return line.split(/[,\t;]/).map((cell) => cell.replace(/^"|"$/g, '').trim())
}

function normalizePasteHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function parsePasteAmount(value: string): number | null {
  const amount = Number(String(value).replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(amount)) return null
  if (amount < 0 || amount > MAX_BUDGET_MONEY_AMOUNT) return null
  return amount
}

export function parseBudgetCodePaste(text: string): {
  valid: BudgetCodePasteRow[]
  skipped: BudgetCodePasteSkip[]
} {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const valid: BudgetCodePasteRow[] = []
  const skipped: BudgetCodePasteSkip[] = []
  if (lines.length === 0) return { valid, skipped }

  const firstCells = splitPasteLine(lines[0]).map(normalizePasteHeader)
  const findIndex = (aliases: string[]) =>
    firstCells.findIndex((header) => aliases.some((alias) => header === alias || header.includes(alias)))

  const headerCode = findIndex(['budget code', 'code'])
  const headerName = findIndex(['budget code name', 'name'])
  const headerAmount = findIndex(['budget amount', 'amount'])
  const hasHeader = headerCode >= 0 || headerName >= 0 || headerAmount >= 0
  const codeIndex = hasHeader && headerCode >= 0 ? headerCode : 0
  const nameIndex = hasHeader && headerName >= 0 ? headerName : 1
  const amountIndex = hasHeader && headerAmount >= 0 ? headerAmount : 2
  const start = hasHeader ? 1 : 0
  const seen = new Set<string>()

  for (let index = start; index < lines.length; index++) {
    const raw = lines[index]
    const cells = splitPasteLine(raw)
    const displayCode = cells[codeIndex] ?? ''
    const name = cells[nameIndex] ?? ''
    const amount = parsePasteAmount(cells[amountIndex] ?? '')
    const line = index + 1

    if (!displayCode.trim()) {
      skipped.push({ line, reason: 'Missing budget code', raw })
      continue
    }
    if (!name.trim()) {
      skipped.push({ line, reason: 'Missing budget code name', raw })
      continue
    }
    if (amount === null) {
      skipped.push({ line, reason: 'Invalid budget amount', raw })
      continue
    }

    const code = normalizeBudgetCode(displayCode)
    if (seen.has(code)) {
      skipped.push({ line, reason: 'Duplicate budget code', raw })
      continue
    }
    seen.add(code)
    valid.push({
      code,
      displayCode: displayCode.trim(),
      name: name.trim(),
      budgetAmount: amount,
    })
  }

  return { valid, skipped }
}

export function classifyBudgetCodePasteRows(
  valid: BudgetCodePasteRow[],
  existingCodes: Array<{ code: string }>
) {
  const existing = new Set(existingCodes.map((item) => normalizeBudgetCode(item.code)))
  return {
    creates: valid.filter((row) => !existing.has(row.code)),
    updates: valid.filter((row) => existing.has(row.code)),
  }
}
```

- [ ] **Step 4: Run helper tests**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/budget-control.ts tests/regression/budget-control.test.ts
git commit -m "feat: add budget monitor table helpers and paste parser"
```

---

### Task 3: Server actions

**Files:**
- Modify: `src/server-actions/budget-control.ts`
- Modify: `tests/regression/budget-control.test.ts`

**Interfaces:**
- Consumes: `BudgetCodePasteRow` fields `{ code, name, budgetAmount }`; `MAX_BUDGET_MONEY_AMOUNT` may stay local or import from lib. Keep the local `MAX_BUDGET_MONEY_AMOUNT` constant so existing source tests still pass.
- Produces:
  - `getBudgetMonitorData` returns `requests: BudgetRequestRecord[]` and includes `name` on every budget-code select/map
  - `createBudgetCode({ budgetCode, name, budgetAmount, departmentId })`
  - `updateBudgetCodeAmount({ budgetCodeId, name, budgetAmount, departmentId })`
  - `pasteBudgetCodes({ rows: Array<{ code: string; name: string; budgetAmount: number }> }): Promise<{ created: number; updated: number; skipped: number }>`

- [ ] **Step 1: Extend server-action source tests**

In the `budget monitor server actions` describe, add:

```ts
it('returns a flat requests list and maps budget code name', () => {
  const source = readServerAction()
  const getDataBody = source.slice(
    source.indexOf('export async function getBudgetMonitorData'),
    source.indexOf('export async function assignRequestToBudgetCode')
  )
  assert.match(getDataBody, /name: true/)
  assert.match(getDataBody, /requests,/)
  assert.match(source, /name: budgetCode\.name \?\? null|name: decimalToNumber|name:/)
})

it('requires name and amount on create, update, and paste', () => {
  const source = readServerAction()
  assert.match(source, /export async function pasteBudgetCodes/)
  assert.match(source, /name: z\.string\(\)[\s\S]*min\(1\)/)
  const createBody = source.slice(
    source.indexOf('const createBudgetCodeSchema'),
    source.indexOf('function buildVisibleRequestWhere')
  )
  assert.match(createBody, /name:/)
  assert.doesNotMatch(
    source.slice(
      source.indexOf('const createBudgetCodeSchema'),
      source.indexOf('function buildVisibleRequestWhere')
    ),
    /budgetAmount: moneySchema/
  )
})
```

Also add `'pasteBudgetCodes'` to the export-name loop in `exposes data, mutation, and XLSX export actions`.

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: FAIL — `pasteBudgetCodes` missing; `name` not selected.

- [ ] **Step 3: Map `name` and required money**

In `src/server-actions/budget-control.ts`:

Add a required money schema next to `moneySchema` (keep `moneySchema` for project estimate):

```ts
const requiredMoneySchema = z.preprocess((value) => {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    if (value.trim() === '') return value
    return Number(value)
  }
  return value
}, z.number()
  .refine((value) => Number.isFinite(value), 'Amount must be finite')
  .min(0)
  .max(MAX_BUDGET_MONEY_AMOUNT))

const requiredNameSchema = z.string().trim().min(1)
```

Update schemas:

```ts
const budgetAmountSchema = z.object({
  budgetCodeId: z.string().min(1),
  name: requiredNameSchema,
  budgetAmount: requiredMoneySchema,
  departmentId: z.string().min(1).nullable().optional(),
})

const createBudgetCodeSchema = z.object({
  budgetCode: z.string().min(1),
  name: requiredNameSchema,
  budgetAmount: requiredMoneySchema,
  departmentId: z.string().min(1).nullable().optional(),
})

const pasteBudgetCodesSchema = z.object({
  rows: z.array(z.object({
    code: z.string().min(1),
    name: requiredNameSchema,
    budgetAmount: requiredMoneySchema,
  })).min(1),
})
```

Update `mapBudgetCodeSummary`:

```ts
function mapBudgetCodeSummary(budgetCode: any): NonNullable<BudgetRequestRecord['budgetCode']> {
  return {
    id: budgetCode.id,
    code: budgetCode.code,
    displayCode: budgetCode.displayCode,
    name: typeof budgetCode.name === 'string' ? budgetCode.name : null,
    budgetAmount: decimalToNumber(budgetCode.budgetAmount),
    department: budgetCode.department ? { id: budgetCode.department.id, name: budgetCode.department.name } : null,
  }
}
```

Add `name: true` to every `budgetCode` / `budget_codes` select in `getBudgetMonitorData`.

Add `name?: string | null` to the `creatorCodes` type in `mergeBudgetCodes`.

- [ ] **Step 4: Return `requests` from `getBudgetMonitorData`**

After `mapped` is built, derive the page request list (status is already in `where`):

```ts
let pageRequests = mapped
if (filters.departmentId) {
  pageRequests = pageRequests.filter((request) => request.department?.id === filters.departmentId)
}
if (filters.budgetCodeSearch) {
  pageRequests = pageRequests.filter((request) =>
    matchesBudgetMonitorSearch(request, filters.budgetCodeSearch!)
  )
}
```

Also match creator-owned empty codes by name:

```ts
if (filters.budgetCodeSearch) {
  budgetCodes = budgetCodes.filter((budgetCode) =>
    fuzzyMatchBudgetCode(budgetCode.displayCode, filters.budgetCodeSearch!) ||
    (budgetCode.name ? fuzzyMatchBudgetCode(budgetCode.name, filters.budgetCodeSearch!) : false)
  )
}
```

Return:

```ts
return {
  budgetCodes,
  groups,
  remainingRequests,
  requests: pageRequests,
  filters: {
    departments,
    statuses: ['ImprovementRequest', 'SentToEngineer', 'DesignCostEstimationApproval', 'SendBackToRequester', 'FinalApproval', 'Completed', 'Cancelled'],
  },
}
```

- [ ] **Step 5: Write name and amount on create/update**

In `createBudgetCode` create data:

```ts
data: {
  code: normalizedCode,
  displayCode: data.budgetCode.trim(),
  name: data.name,
  budgetAmount: data.budgetAmount,
  departmentId: data.departmentId ?? null,
  createdById: user.id,
},
```

In `updateBudgetCodeAmount` update data:

```ts
data: {
  name: data.name,
  budgetAmount: data.budgetAmount,
  ...(data.departmentId !== undefined ? { departmentId: data.departmentId } : {}),
},
```

- [ ] **Step 6: Add `pasteBudgetCodes`**

Place it immediately before `exportBudgetMonitorXlsx`.

```ts
export async function pasteBudgetCodes(input: z.infer<typeof pasteBudgetCodesSchema>) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  const data = pasteBudgetCodesSchema.parse(input)
  let created = 0
  let updated = 0
  let skipped = 0

  for (const row of data.rows) {
    const normalizedCode = normalizeBudgetCode(row.code)
    const existing = await prisma.budget_codes.findUnique({ where: { code: normalizedCode } })

    if (!existing) {
      await prisma.budget_codes.create({
        data: {
          code: normalizedCode,
          displayCode: row.code.trim(),
          name: row.name,
          budgetAmount: row.budgetAmount,
          createdById: user.id,
        },
      })
      created += 1
      continue
    }

    const visibleUsage = await prisma.requests.findFirst({
      where: {
        ...buildVisibleRequestWhere(user),
        budgetCodeId: existing.id,
      },
      select: { id: true },
    })
    const creatorOwnedCode = existing.createdById === user.id
    if (!visibleUsage && !creatorOwnedCode) {
      skipped += 1
      continue
    }

    await prisma.budget_codes.update({
      where: { id: existing.id },
      data: {
        name: row.name,
        budgetAmount: row.budgetAmount,
      },
    })
    updated += 1
  }

  revalidatePath('/budget-monitor')
  return { created, updated, skipped }
}
```

Do not assign requests. Do not change `departmentId` on update.

- [ ] **Step 7: Run tests**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server-actions/budget-control.ts tests/regression/budget-control.test.ts
git commit -m "feat: require budget code name and add paste upsert"
```

---

### Task 4: Create and edit dialogs

**Files:**
- Modify: `src/components/budget/budget-code-create-dialog.tsx`
- Modify: `src/components/budget/budget-code-edit-dialog.tsx`
- Modify: `tests/regression/budget-control.test.ts`

**Interfaces:**
- Consumes: `createBudgetCode({ budgetCode, name, budgetAmount, departmentId })`; `updateBudgetCodeAmount({ budgetCodeId, name, budgetAmount, departmentId })`
- Produces:
  - Create `onCreate(input: { budgetCode: string; name: string; budgetAmount: number; departmentId: string | null })`
  - Edit `onSave(input: { name: string; budgetAmount: number; departmentId: string | null })`

- [ ] **Step 1: Write failing dialog tests**

```ts
it('requires name and amount in create and edit budget code dialogs', () => {
  const createDialog = readFileSync('src/components/budget/budget-code-create-dialog.tsx', 'utf8')
  const editDialog = readFileSync('src/components/budget/budget-code-edit-dialog.tsx', 'utf8')

  assert.match(createDialog, /name: string/)
  assert.match(createDialog, /budgetAmount: number/)
  assert.match(createDialog, /id="new-budget-code-name"/)
  assert.match(createDialog, /disabled=\{isSaving \|\| !canSubmit\}/)

  assert.match(editDialog, /name: string/)
  assert.match(editDialog, /budgetAmount: number/)
  assert.match(editDialog, /id="budget-code-edit-name"/)
  assert.match(editDialog, /disabled=\{isSaving \|\| !canSubmit\}/)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: FAIL — name fields missing.

- [ ] **Step 3: Update create dialog**

Change the `onCreate` type and add a name field. Disable Create unless code, name, and a finite amount `>= 0` are present.

```ts
onCreate: (input: {
  budgetCode: string
  name: string
  budgetAmount: number
  departmentId: string | null
}) => Promise<void>
```

Add state `const [name, setName] = useState('')`.

Add this field after the budget-code input:

```tsx
<div className="space-y-2">
  <Label htmlFor="new-budget-code-name">Budget code name</Label>
  <Input
    id="new-budget-code-name"
    value={name}
    onChange={(event) => setName(event.target.value)}
  />
</div>
```

Submit helper:

```ts
const parsedAmount = Number(budgetAmount)
const canSubmit =
  budgetCode.trim() !== '' &&
  name.trim() !== '' &&
  budgetAmount.trim() !== '' &&
  Number.isFinite(parsedAmount) &&
  parsedAmount >= 0

await onCreate({
  budgetCode,
  name: name.trim(),
  budgetAmount: parsedAmount,
  departmentId: departmentId === 'none' ? null : departmentId,
})
```

Reset `name` after success. Button: `disabled={isSaving || !canSubmit}`.

- [ ] **Step 4: Update edit dialog**

```ts
onSave: (input: {
  name: string
  budgetAmount: number
  departmentId: string | null
}) => Promise<void>
```

Add `const [name, setName] = useState('')`. In the `useEffect` when `open`:

```ts
setName(budgetCode?.name ?? '')
setBudgetAmount(budgetCode?.budgetAmount?.toString() ?? '')
setDepartmentId(budgetCode?.department?.id ?? 'none')
```

Add field `id="budget-code-edit-name"` labeled “Budget code name” above amount.

```ts
const parsedAmount = Number(budgetAmount)
const canSubmit =
  name.trim() !== '' &&
  budgetAmount.trim() !== '' &&
  Number.isFinite(parsedAmount) &&
  parsedAmount >= 0

await onSave({
  name: name.trim(),
  budgetAmount: parsedAmount,
  departmentId: departmentId === 'none' ? null : departmentId,
})
```

Button: `disabled={isSaving || !canSubmit}`.

- [ ] **Step 5: Run tests**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/budget/budget-code-create-dialog.tsx src/components/budget/budget-code-edit-dialog.tsx tests/regression/budget-control.test.ts
git commit -m "feat: require name and amount on budget code dialogs"
```

---

### Task 5: Budget cards and department panel

**Files:**
- Create: `src/components/budget/budget-code-card.tsx`
- Create: `src/components/budget/budget-department-panel.tsx`
- Modify: `tests/regression/budget-control.test.ts`

**Interfaces:**
- Consumes: `BudgetCodeGroup`; `getBudgetCodeHealth`; `getBudgetCodeLabel`; `groupBudgetCodesByDepartment`
- Produces:
  - `BudgetCodeCard({ group, collapsed, onCollapsedChange, onEditBudgetCode })`
  - `BudgetDepartmentPanel({ groups, onEditBudgetCode, onPaste, onCreate })`

- [ ] **Step 1: Write failing component wiring tests**

```ts
it('renders department-grouped budget cards without drop targets', () => {
  const card = readFileSync('src/components/budget/budget-code-card.tsx', 'utf8')
  const panel = readFileSync('src/components/budget/budget-department-panel.tsx', 'utf8')

  assert.match(card, /export function BudgetCodeCard/)
  assert.match(card, /getBudgetCodeHealth/)
  assert.match(card, /getBudgetCodeLabel/)
  assert.doesNotMatch(card, /useDroppable|DndContext|Drop remaining request/)
  assert.match(panel, /groupBudgetCodesByDepartment/)
  assert.match(panel, /Paste budget codes/)
  assert.match(panel, /New budget code/)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: FAIL — files missing.

- [ ] **Step 3: Create `budget-code-card.tsx`**

```tsx
'use client'

import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBudgetCodeHealth, getBudgetCodeLabel } from '@/lib/budget-control'
import type { BudgetCodeGroup } from '@/types/budget'

export function BudgetCodeCard({
  group,
  collapsed,
  onCollapsedChange,
  onEditBudgetCode,
}: {
  group: BudgetCodeGroup
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onEditBudgetCode: () => void
}) {
  const health = getBudgetCodeHealth(group.remainingBudget, group.budgetCode.budgetAmount)
  const usedPercent =
    group.budgetCode.budgetAmount && group.budgetCode.budgetAmount > 0
      ? Math.min(100, Math.max(0, (group.usedAmount / group.budgetCode.budgetAmount) * 100))
      : null

  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="min-h-11 min-w-0 flex-1 text-left"
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <div className="text-base font-semibold">{getBudgetCodeLabel(group.budgetCode)}</div>
          <p className="mt-1 text-xs text-gray-500">
            {group.budgetCode.displayCode} · {group.assignedRequestCount} assigned request
            {group.assignedRequestCount === 1 ? '' : 's'}
          </p>
        </button>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-gray-100 px-2 py-1 font-mono text-[11px]">{health}</span>
          <Button variant="ghost" size="icon" onClick={onEditBudgetCode} title="Edit budget code">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onCollapsedChange(!collapsed)}
            title={collapsed ? 'Expand budget card' : 'Collapse budget card'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 overflow-hidden rounded-md border sm:grid-cols-3">
        <div className="border-b p-3 sm:border-b-0 sm:border-r">
          <div className="text-xs text-gray-500">Budget</div>
          <div className="font-mono text-lg tabular-nums">
            {group.budgetCode.budgetAmount?.toLocaleString() ?? '—'}
          </div>
        </div>
        <div className="border-b p-3 sm:border-b-0 sm:border-r">
          <div className="text-xs text-gray-500">Used</div>
          <div className="font-mono text-lg tabular-nums">{group.usedAmount.toLocaleString()}</div>
        </div>
        <div className="p-3">
          <div className="text-xs text-gray-500">Remaining</div>
          <div className="font-mono text-lg tabular-nums">
            {group.remainingBudget?.toLocaleString() ?? '—'}
          </div>
        </div>
      </div>

      {usedPercent !== null ? (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full bg-gray-900" style={{ width: `${usedPercent}%` }} />
        </div>
      ) : null}

      {!collapsed ? (
        <div className="mt-3 border-t pt-2">
          {group.requests.length === 0 ? (
            <p className="text-xs text-gray-500">No requests assigned to this group yet.</p>
          ) : (
            group.requests.map((request) => (
              <div key={request.id} className="grid grid-cols-[1fr_auto_auto] gap-3 border-b py-2 text-sm last:border-b-0">
                <div className="min-w-0 truncate font-medium" title={request.title}>
                  {request.title}
                </div>
                <span className="text-xs text-gray-500">{request.status}</span>
                <span className="font-mono text-xs tabular-nums">
                  {request.usageAmount.toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 4: Create `budget-department-panel.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BudgetCodeCard } from '@/components/budget/budget-code-card'
import { groupBudgetCodesByDepartment } from '@/lib/budget-control'
import type { BudgetCodeGroup } from '@/types/budget'

export function BudgetDepartmentPanel({
  groups,
  onEditBudgetCode,
  onPaste,
  onCreate,
}: {
  groups: BudgetCodeGroup[]
  onEditBudgetCode: (group: BudgetCodeGroup) => void
  onPaste: () => void
  onCreate: () => void
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const departments = groupBudgetCodesByDepartment(groups)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Budget by department</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onPaste}>
            Paste budget codes
          </Button>
          <Button type="button" variant="outline" onClick={onCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New budget code
          </Button>
        </div>
      </div>
      <p className="font-mono text-xs text-gray-500">
        {departments.length} department{departments.length === 1 ? '' : 's'} · {groups.length} group
        {groups.length === 1 ? '' : 's'}
      </p>
      {departments.map((department) => (
        <section key={department.departmentId ?? 'none'}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">{department.departmentName}</h3>
            <span className="rounded-full border px-2 py-0.5 text-xs text-gray-500">
              {department.groups.length} group{department.groups.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="space-y-3">
            {department.groups.map((group) => (
              <BudgetCodeCard
                key={group.budgetCode.id}
                group={group}
                collapsed={collapsedGroups.has(group.budgetCode.id)}
                onCollapsedChange={(collapsed) => {
                  const next = new Set(collapsedGroups)
                  if (collapsed) next.add(group.budgetCode.id)
                  else next.delete(group.budgetCode.id)
                  setCollapsedGroups(next)
                }}
                onEditBudgetCode={() => onEditBudgetCode(group)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Run tests**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/budget/budget-code-card.tsx src/components/budget/budget-department-panel.tsx tests/regression/budget-control.test.ts
git commit -m "feat: add department budget cards for monitor redesign"
```

---

### Task 6: Request assignment table

**Files:**
- Create: `src/components/budget/budget-request-table.tsx`
- Modify: `tests/regression/budget-control.test.ts`

**Interfaces:**
- Consumes: `BudgetRequestRecord[]`; `BudgetCodeSummary[]`; `getBudgetCodeLabel`; `getBudgetProjectEstimateAmount`
- Produces: `BudgetRequestTable({ requests, budgetCodes, onAssign, onUnassign, onEditProjectEstimate })` where:
  - `onAssign(requestId: string, budgetCodeId: string): Promise<void>`
  - `onUnassign(requestId: string): Promise<void>`
  - `onEditProjectEstimate(requestId: string, value: number | null): void`

- [ ] **Step 1: Write the failing test**

```ts
it('assigns requests with a group select instead of drag and drop', () => {
  const table = readFileSync('src/components/budget/budget-request-table.tsx', 'utf8')
  assert.match(table, /export function BudgetRequestTable/)
  assert.match(table, /Unassigned/)
  assert.match(table, /Assigned/)
  assert.match(table, /aria-label="Assign group"/)
  assert.match(table, /md:hidden/)
  assert.match(table, /hidden md:table/)
  assert.match(table, /getBudgetProjectEstimateAmount/)
  assert.doesNotMatch(table, /DndContext|useDraggable|useDroppable/)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: FAIL — file missing.

- [ ] **Step 3: Create `budget-request-table.tsx`**

Implement one component that:

1. Splits `requests` into `unassigned` (`!request.budgetCode`) and `assigned`.
2. Keeps Unassigned expanded. Assigned starts collapsed (`useState(false)`).
3. Sorts Group options: Unassigned first, then codes whose `department?.id === request.department?.id`, then the rest. Label = `getBudgetCodeLabel(code)`; show `displayCode` after the label.
4. Desktop: `<table className="hidden min-w-full md:table">` with columns Request, Department, Group, Status, Cost.
5. Mobile: `<div className="space-y-3 md:hidden">` cards, same fields, full-width select, `min-h-11`.
6. Cost uses `getBudgetProjectEstimateAmount`. If `engineeringEstimateCost !== null`, read-only. Else a button that calls `onEditProjectEstimate(request.id, request.projectEstimateCost)`.
7. Native `<select aria-label="Assign group">`. `value={request.budgetCode?.id ?? ''}`. `onChange`: empty → `onUnassign(request.id)`; otherwise `onAssign(request.id, event.target.value)`.
8. Empty filtered list: `No requests match these filters.`
9. No `@dnd-kit`.

Core select handler and option builder:

```ts
function sortBudgetCodesForRequest(
  budgetCodes: BudgetCodeSummary[],
  request: BudgetRequestRecord
) {
  return [...budgetCodes].sort((a, b) => {
    const aMatch = a.department?.id === request.department?.id ? 0 : 1
    const bMatch = b.department?.id === request.department?.id ? 0 : 1
    if (aMatch !== bMatch) return aMatch - bMatch
    return getBudgetCodeLabel(a).localeCompare(getBudgetCodeLabel(b))
  })
}

async function handleGroupChange(request: BudgetRequestRecord, budgetCodeId: string) {
  try {
    if (!budgetCodeId) await onUnassign(request.id)
    else await onAssign(request.id, budgetCodeId)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to update assignment')
  }
}
```

Import `toast` from `sonner`. Title cell: `truncate` + `title={request.title}`. Department cell: `request.department?.name ?? '—'`. Cost empty: `—`.

- [ ] **Step 4: Run tests**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/budget/budget-request-table.tsx tests/regression/budget-control.test.ts
git commit -m "feat: add budget request assignment table"
```

---

### Task 7: Paste dialog

**Files:**
- Create: `src/components/budget/budget-code-paste-dialog.tsx`
- Modify: `tests/regression/budget-control.test.ts`

**Interfaces:**
- Consumes: `parseBudgetCodePaste`, `classifyBudgetCodePasteRows`, `pasteBudgetCodes`
- Produces: `BudgetCodePasteDialog({ open, existingCodes, onOpenChange, onPaste })` where `onPaste(rows: Array<{ code: string; name: string; budgetAmount: number }>): Promise<{ created: number; updated: number; skipped: number }>`

- [ ] **Step 1: Write the failing test**

```ts
it('previews paste rows before writing budget codes', () => {
  const dialog = readFileSync('src/components/budget/budget-code-paste-dialog.tsx', 'utf8')
  assert.match(dialog, /export function BudgetCodePasteDialog/)
  assert.match(dialog, /parseBudgetCodePaste/)
  assert.match(dialog, /classifyBudgetCodePasteRows/)
  assert.match(dialog, /Confirm/)
  assert.doesNotMatch(dialog, /type="file"/)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: FAIL — file missing.

- [ ] **Step 3: Create the dialog**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { classifyBudgetCodePasteRows, parseBudgetCodePaste } from '@/lib/budget-control'

export function BudgetCodePasteDialog({
  open,
  existingCodes,
  onOpenChange,
  onPaste,
}: {
  open: boolean
  existingCodes: Array<{ code: string }>
  onOpenChange: (open: boolean) => void
  onPaste: (
    rows: Array<{ code: string; name: string; budgetAmount: number }>
  ) => Promise<{ created: number; updated: number; skipped: number }>
}) {
  const [text, setText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const parsed = useMemo(() => parseBudgetCodePaste(text), [text])
  const classified = useMemo(
    () => classifyBudgetCodePasteRows(parsed.valid, existingCodes),
    [existingCodes, parsed.valid]
  )
  const canSubmit = parsed.valid.length > 0 && !isSaving

  async function handleConfirm() {
    setIsSaving(true)
    try {
      await onPaste(parsed.valid.map((row) => ({
        code: row.displayCode,
        name: row.name,
        budgetAmount: row.budgetAmount,
      })))
      setText('')
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste budget codes</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="budget-code-paste">Budget code, name, amount</Label>
            <textarea
              id="budget-code-paste"
              className="min-h-40 w-full rounded-md border p-3 font-mono text-sm"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="AYT-PD1-GF-411, Filler upgrade, 50000"
            />
          </div>
          <p className="text-xs text-gray-500">
            {classified.creates.length} create · {classified.updates.length} update · {parsed.skipped.length} skipped
          </p>
          {parsed.skipped.length > 0 ? (
            <ul className="max-h-32 overflow-auto text-xs text-red-700">
              {parsed.skipped.map((row) => (
                <li key={`${row.line}-${row.reason}`}>
                  Line {row.line}: {row.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={!canSubmit}>
              Confirm
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

Cancel writes nothing. Confirm sends only `parsed.valid`.

- [ ] **Step 4: Run tests**

Run: `npx tsx --test tests/regression/budget-control.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/budget/budget-code-paste-dialog.tsx tests/regression/budget-control.test.ts
git commit -m "feat: add budget code paste preview dialog"
```

---

### Task 8: Page shell, delete DnD UI, rewrite wiring tests

**Files:**
- Modify: `src/components/budget/budget-monitor-page.tsx`
- Delete: `src/components/budget/budget-code-box.tsx`
- Delete: `src/components/budget/remaining-request-panel.tsx`
- Modify: `tests/regression/budget-control-wiring.test.ts`
- Modify: `tests/regression/budget-control.test.ts`

**Interfaces:**
- Consumes: `BudgetMonitorData.requests`; `BudgetDepartmentPanel`; `BudgetRequestTable`; `BudgetCodePasteDialog`; existing dialogs and server actions
- Produces: tabbed page with no `@dnd-kit` on this route

- [ ] **Step 1: Replace wiring tests so they fail against the current page**

Overwrite `tests/regression/budget-control-wiring.test.ts` with:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

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

  it('uses tabs and a group select instead of drag and drop', () => {
    const page = readFileSync('src/components/budget/budget-monitor-page.tsx', 'utf8')
    assert.match(page, /budget-monitor-view/)
    assert.match(page, /value="depts"/)
    assert.match(page, /value="requests"/)
    assert.match(page, /BudgetDepartmentPanel/)
    assert.match(page, /BudgetRequestTable/)
    assert.match(page, /Reports/)
    assert.match(page, /BudgetCodePasteDialog/)
    assert.match(page, /exportBudgetMonitorXlsx/)
    assert.doesNotMatch(page, /DndContext|DragOverlay|budget-monitor-dnd/)
    assert.doesNotMatch(page, /RemainingRequestPanel/)
    assert.equal(existsSync('src/components/budget/budget-code-box.tsx'), false)
    assert.equal(existsSync('src/components/budget/remaining-request-panel.tsx'), false)
  })

  it('uses one top search for budget codes and request names', () => {
    const page = readFileSync('src/components/budget/budget-monitor-page.tsx', 'utf8')
    const serverAction = readFileSync('src/server-actions/budget-control.ts', 'utf8')

    assert.match(page, /placeholder="Search budget code or request"/)
    assert.match(page, /budgetCodeSearch/)
    assert.doesNotMatch(page, /placeholder="Filter budget code"/)
    assert.match(serverAction, /matchesBudgetMonitorSearch/)
  })

  it('keeps budget search suggestions closed until text is entered', () => {
    const searchInput = readFileSync('src/components/budget/budget-search-input.tsx', 'utf8')

    assert.match(searchInput, /trimmedValue\.length > 0/)
    assert.match(searchInput, /setOpen\(nextValue\.trim\(\)\.length > 0\)/)
    assert.doesNotMatch(searchInput, /if \(!trimmedValue\) return options/)
    assert.doesNotMatch(searchInput, /Popover/)
    assert.doesNotMatch(searchInput, /CommandItem/)
  })
})
```

Move the project-estimate display assertion off the deleted files. In `tests/regression/budget-control.test.ts`, replace the `renders budget monitor project estimate cells` test body so it reads `budget-request-table.tsx` instead of `budget-code-box.tsx` / `remaining-request-panel.tsx`:

```ts
it('renders budget monitor project estimate cells from the approved display amount', () => {
  const table = readFileSync('src/components/budget/budget-request-table.tsx', 'utf8')

  assert.match(table, /getBudgetProjectEstimateAmount/)
  assert.match(table, /projectEstimateAmount\?\.toLocaleString\(\) \?\? '—'/)
  assert.match(table, /const hasApprovedEstimate = request\.engineeringEstimateCost !== null/)
  assert.match(table, /onEditProjectEstimate\(request\.id, request\.projectEstimateCost\)/)
})
```

- [ ] **Step 2: Run wiring tests and confirm they fail**

Run: `npx tsx --test tests/regression/budget-control-wiring.test.ts tests/regression/budget-control.test.ts`

Expected: FAIL — page still has DnD; old files still exist.

- [ ] **Step 3: Rewrite `budget-monitor-page.tsx`**

Replace the file. Required behavior:

- No `DndContext`, `DragOverlay`, or remaining panel.
- State: `data`, `filters`, `view` (`'depts' | 'requests'`), dialogs, `useTransition` refresh (keep the 250ms debounce).
- On mount, read `localStorage.getItem('budget-monitor-view')`. If `depts` or `requests`, use it; else `depts`. On tab change, `localStorage.setItem('budget-monitor-view', next)`.
- Hero: title `Budget Monitor`, lead `Assign requests to a budget code.`, and `sumVisibleRemainingBudget(renderableGroups)` as the total. Caption: `total remaining across {groupCount} groups`.
- Filter card: `BudgetSearchInput` placeholder `Search budget code or request`, department select, status select, Clear (sets `{}`), Reports button calling existing `exportBudgetMonitorXlsx`.
- `Tabs` from `@/components/ui/tabs` with `value={view}` `onValueChange`. Triggers: `Budget by department` (`value="depts"`), `All requests` (`value="requests"`).
- `TabsContent value="depts"` renders `BudgetDepartmentPanel`.
- `TabsContent value="requests"` renders `BudgetRequestTable` with `data.requests`.
- `buildRenderableGroups` stays as today (merge empty creator codes into groups).
- Assign: `assignRequestToBudgetCode({ requestId, budgetCodeId })` then toast + refresh.
- Unassign: `unassignRequestBudgetCode(requestId)` then toast + refresh.
- Create/edit/paste/estimate dialogs stay; create/edit now pass `name` and required `budgetAmount`.
- Paste: `pasteBudgetCodes({ rows })`, toast `Created {n}, updated {n}`, refresh.

Skeleton:

```tsx
'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { BudgetCodeCreateDialog } from '@/components/budget/budget-code-create-dialog'
import { BudgetCodeEditDialog } from '@/components/budget/budget-code-edit-dialog'
import { BudgetCodePasteDialog } from '@/components/budget/budget-code-paste-dialog'
import { BudgetDepartmentPanel } from '@/components/budget/budget-department-panel'
import { BudgetEditDialog } from '@/components/budget/budget-edit-dialog'
import { BudgetRequestTable } from '@/components/budget/budget-request-table'
import { BudgetSearchInput } from '@/components/budget/budget-search-input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  assignRequestToBudgetCode,
  createBudgetCode,
  exportBudgetMonitorXlsx,
  getBudgetMonitorData,
  pasteBudgetCodes,
  unassignRequestBudgetCode,
  updateBudgetCodeAmount,
  updateRequestProjectEstimate,
} from '@/server-actions/budget-control'
import { sumVisibleRemainingBudget } from '@/lib/budget-control'
import type { BudgetCodeGroup, BudgetMonitorData, BudgetMonitorFilters } from '@/types/budget'

const VIEW_STORAGE_KEY = 'budget-monitor-view'

function buildRenderableGroups(data: BudgetMonitorData): BudgetCodeGroup[] {
  const groupsByCodeId = new Map(data.groups.map((group) => [group.budgetCode.id, group]))

  for (const budgetCode of data.budgetCodes) {
    if (!groupsByCodeId.has(budgetCode.id)) {
      groupsByCodeId.set(budgetCode.id, {
        budgetCode,
        usedAmount: 0,
        remainingBudget: budgetCode.budgetAmount,
        assignedRequestCount: 0,
        requests: [],
      })
    }
  }

  return [...groupsByCodeId.values()].sort((a, b) =>
    a.budgetCode.displayCode.localeCompare(b.budgetCode.displayCode)
  )
}

export function BudgetMonitorPage({ initialData }: { initialData: BudgetMonitorData }) {
  const [data, setData] = useState(initialData)
  const [filters, setFilters] = useState<BudgetMonitorFilters>({})
  const [view, setView] = useState<'depts' | 'requests'>('depts')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [editDialog, setEditDialog] = useState<
    | { type: 'budget'; group: BudgetCodeGroup }
    | { type: 'estimate'; requestId: string; value: number | null }
    | null
  >(null)

  const renderableGroups = useMemo(() => buildRenderableGroups(data), [data])
  const remaining = useMemo(() => sumVisibleRemainingBudget(renderableGroups), [renderableGroups])
  const budgetCodeOptions = useMemo(
    () => data.budgetCodes.map((budgetCode) => ({
      value: budgetCode.displayCode,
      label: budgetCode.name?.trim() || budgetCode.displayCode,
      meta: budgetCode.department?.name ?? 'No department',
    })),
    [data.budgetCodes]
  )

  const refresh = useCallback((nextFilters = filters) => {
    startTransition(async () => {
      setData(await getBudgetMonitorData(nextFilters))
    })
  }, [filters])

  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY)
    if (saved === 'depts' || saved === 'requests') setView(saved)
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => refresh(filters), 250)
    return () => window.clearTimeout(timeout)
  }, [filters, refresh])

  function updateView(nextView: string) {
    const resolved = nextView === 'requests' ? 'requests' : 'depts'
    setView(resolved)
    window.localStorage.setItem(VIEW_STORAGE_KEY, resolved)
  }

  async function handleExport() {
    const result = await exportBudgetMonitorXlsx(filters)
    const link = document.createElement('a')
    link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.base64}`
    link.download = result.fileName
    link.click()
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-bold tracking-normal">Budget Monitor</h1>
          <p className="text-sm text-gray-500">Assign requests to a budget code.</p>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-3xl font-semibold tabular-nums">{remaining.total.toLocaleString()}</div>
          <div className="text-xs text-gray-500">
            total remaining across {remaining.groupCount} group{remaining.groupCount === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div className="grid gap-2 rounded-lg border bg-white p-3 lg:grid-cols-[1.4fr_1fr_1fr_auto_auto]">
        <BudgetSearchInput
          placeholder="Search budget code or request"
          value={filters.budgetCodeSearch ?? ''}
          options={budgetCodeOptions}
          onChange={(value) => setFilters({ ...filters, budgetCodeSearch: value || undefined })}
        />
        <Select
          value={filters.departmentId ?? 'all'}
          onValueChange={(value) => setFilters({ ...filters, departmentId: value === 'all' ? undefined : value })}
        >
          <SelectTrigger className="min-h-11">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {data.filters.departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.status ?? 'all'}
          onValueChange={(value) => setFilters({ ...filters, status: value === 'all' ? undefined : value })}
        >
          <SelectTrigger className="min-h-11">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {data.filters.statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => setFilters({})}>
          Clear
        </Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={handleExport} disabled={isPending}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Reports
        </Button>
      </div>

      <Tabs value={view} onValueChange={updateView}>
        <TabsList>
          <TabsTrigger value="depts">Budget by department</TabsTrigger>
          <TabsTrigger value="requests">All requests</TabsTrigger>
        </TabsList>
        <TabsContent value="depts">
          <BudgetDepartmentPanel
            groups={renderableGroups}
            onEditBudgetCode={(group) => setEditDialog({ type: 'budget', group })}
            onPaste={() => setPasteDialogOpen(true)}
            onCreate={() => setCreateDialogOpen(true)}
          />
        </TabsContent>
        <TabsContent value="requests">
          <BudgetRequestTable
            requests={data.requests}
            budgetCodes={data.budgetCodes}
            onAssign={async (requestId, budgetCodeId) => {
              await assignRequestToBudgetCode({ requestId, budgetCodeId })
              toast.success('Request assigned')
              refresh()
            }}
            onUnassign={async (requestId) => {
              await unassignRequestBudgetCode(requestId)
              toast.success('Request unassigned')
              refresh()
            }}
            onEditProjectEstimate={(requestId, value) => setEditDialog({ type: 'estimate', requestId, value })}
          />
        </TabsContent>
      </Tabs>

      {/* existing edit/create dialogs + BudgetCodePasteDialog, passing name on create/save */}
    </div>
  )
}
```

Wire create:

```ts
onCreate={async (input) => {
  await createBudgetCode(input)
  refresh()
}}
```

Wire edit:

```ts
onSave={async ({ name, budgetAmount, departmentId }) => {
  if (editDialog?.type !== 'budget') return
  await updateBudgetCodeAmount({
    budgetCodeId: editDialog.group.budgetCode.id,
    name,
    budgetAmount,
    departmentId,
  })
  refresh()
}}
```

Wire paste:

```ts
<BudgetCodePasteDialog
  open={pasteDialogOpen}
  existingCodes={data.budgetCodes}
  onOpenChange={setPasteDialogOpen}
  onPaste={async (rows) => {
    const result = await pasteBudgetCodes({ rows })
    toast.success(`Created ${result.created}, updated ${result.updated}`)
    refresh()
    return result
  }}
/>
```

Keep `BudgetEditDialog` for project estimate as today.

- [ ] **Step 4: Delete the old DnD files**

```bash
rm src/components/budget/budget-code-box.tsx src/components/budget/remaining-request-panel.tsx
```

Confirm nothing else imports them:

```bash
rg "budget-code-box|remaining-request-panel|RemainingRequestPanel|BudgetCodeBox" src tests
```

Expected: no matches.

- [ ] **Step 5: Run the focused tests**

Run: `npx tsx --test tests/regression/budget-control.test.ts tests/regression/budget-control-wiring.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/budget/budget-monitor-page.tsx src/components/budget/budget-code-box.tsx src/components/budget/remaining-request-panel.tsx tests/regression/budget-control-wiring.test.ts tests/regression/budget-control.test.ts
git commit -m "feat: replace budget monitor drag-and-drop with tabs and table"
```

---

### Task 9: Typecheck and residual wiring

**Files:**
- Modify: any remaining compile errors in callers of `createBudgetCode` / `updateBudgetCodeAmount` / `BudgetMonitorData`

**Interfaces:**
- Consumes: Task 3–8 signatures
- Produces: `npm run check` passes

- [ ] **Step 1: Find leftover callers**

```bash
rg "createBudgetCode|updateBudgetCodeAmount|BudgetMonitorData|remainingRequests|BudgetCodeBox|RemainingRequestPanel" src tests
```

Fix any caller that still omits `name`, `requests`, or required `budgetAmount`.

- [ ] **Step 2: Run the project check**

Run: `npm run check`

Expected: PASS (`tsc --noEmit` and regression tests).

If `tsc` reports `BudgetMonitorData.requests` missing at the route, the route does not construct data itself — only `getBudgetMonitorData` must return it.

- [ ] **Step 3: Commit only if Step 1 produced fixes**

```bash
git add -u
git commit -m "fix: finish budget monitor table type callers"
```

Skip the commit if check passed with no extra edits.

---

## Self-review

1. **Spec coverage**
   - Tabs every breakpoint → Task 8
   - Group select assign/unassign → Task 6
   - Department cards, health pills, totals → Tasks 2 and 5
   - Paste upsert code/name/amount → Tasks 2, 3, 7
   - Required name/amount → Tasks 3 and 4
   - Reports = XLSX → Task 8
   - Search matches name → Tasks 2 and 3
   - Delete DnD / remaining panel → Task 8
   - Migration written, not run locally → Task 1
   - Keep visibility and usage math → no change to `getBudgetUsageAmount` / `buildVisibleRequestWhere`

2. **Placeholder scan:** none.

3. **Type consistency:** `name: string | null` on summaries; writes use required `name: string` and `budgetAmount: number`; `pasteBudgetCodes({ rows })` returns `{ created, updated, skipped }`; page reads `data.requests`.
