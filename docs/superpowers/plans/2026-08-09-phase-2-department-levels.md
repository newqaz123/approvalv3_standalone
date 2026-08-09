# Department Approval Levels 1–10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand department approval hierarchy configuration and every approval-level write/read path from the current five-level behavior to a validated, safe range of levels 1–10.

**Architecture:** Add one dependency-light policy module for the authoritative numeric range, strict level-name validation, safe persisted-data normalization, and display-range/label helpers. Reuse it from department CRUD, user and external-approver assignment actions, hierarchy actions/readers, and approval-chain creation; keep Prisma JSON and integer fields unchanged. Client controls derive their options and limits from the same policy, while server actions remain authoritative.

**Tech Stack:** TypeScript, Zod, Next.js server actions, Prisma, React, Node test runner with `tsx`.

## Global Constraints

- `MAX_APPROVAL_LEVEL = 10`.
- Valid approval levels are integer values from 1 through 10 inclusive; `null` is allowed only for an internal user with no hierarchy assignment.
- Department `levelNames` remains a JSON-compatible sparse map; no Prisma schema migration is expected.
- Server validation is authoritative for department names, internal user levels, hierarchy updates, external department-approver levels, and generated approval records.
- Existing sparse/empty level-name maps remain valid; removing a displayed level keeps the existing renumber-on-remove behavior and must not silently discard another saved value.
- Hierarchy reads include empty display levels through at least level 3 and through the highest valid configured or assigned level, capped at level 10.
- Invalid persisted levels are never used to create new approval records; read paths drop invalid members or fall back to existing safe behavior rather than amplifying authority.
- Existing level 1–5 behavior remains unchanged.
- No production migration, VPS operation, production data mutation, or unrelated workflow redesign.

---

### Task 1: Shared approval-level policy and pure tests

**Files:**
- Create: `src/lib/approval-levels.ts`
- Create: `tests/regression/approval-level-policy.test.ts`

**Interfaces:**
- Produces `MAX_APPROVAL_LEVEL`, `MIN_APPROVAL_LEVEL`, `APPROVAL_LEVELS`, `approvalLevelSchema`, `nullableApprovalLevelSchema`, `levelNamesSchema`, `validateApprovalLevel`, `validateLevelNames`, `normalizePersistedApprovalLevel`, `normalizePersistedLevelNames`, `getApprovalLevelLabel`, `getDisplayApprovalLevels`, and `getApprovalLevelsAboveSubmitter` for later tasks.

- [ ] **Step 1: Write failing pure-policy tests**

Add tests that import the not-yet-created module and assert:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROVAL_LEVELS,
  MAX_APPROVAL_LEVEL,
  getApprovalLevelLabel,
  getApprovalLevelsAboveSubmitter,
  getDisplayApprovalLevels,
  normalizePersistedApprovalLevel,
  validateApprovalLevel,
  validateLevelNames,
} from '@/lib/approval-levels'

describe('approval level policy', () => {
  it('exposes exactly levels 1 through 10', () => {
    assert.equal(MAX_APPROVAL_LEVEL, 10)
    assert.deepEqual(APPROVAL_LEVELS, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('accepts integer boundaries and rejects null, zero, eleven, decimals, and strings for required levels', () => {
    assert.equal(validateApprovalLevel(1), 1)
    assert.equal(validateApprovalLevel(10), 10)
    assert.throws(() => validateApprovalLevel(0), /1.*10/)
    assert.throws(() => validateApprovalLevel(11), /1.*10/)
    assert.throws(() => validateApprovalLevel(1.5), /integer/)
    assert.throws(() => validateApprovalLevel('10'), /integer/)
  })

  it('allows null only when validating an optional internal-user level', () => {
    assert.equal(validateApprovalLevel(null, { allowNull: true }), null)
    assert.throws(() => validateApprovalLevel(null), /1.*10/)
  })

  it('strictly validates sparse level-name maps and rejects malformed entries', () => {
    assert.deepEqual(validateLevelNames({ '1': 'Supervisor', '10': 'Director' }), {
      '1': 'Supervisor',
      '10': 'Director',
    })
    assert.equal(validateLevelNames(undefined), null)
    assert.equal(validateLevelNames({}), null)
    assert.throws(() => validateLevelNames({ '0': 'Invalid' }), /level/i)
    assert.throws(() => validateLevelNames({ '11': 'Invalid' }), /level/i)
    assert.throws(() => validateLevelNames({ one: 'Invalid' }), /level/i)
    assert.throws(() => validateLevelNames({ '1': '' }), /name/i)
    assert.throws(() => validateLevelNames({ '1': 10 } as unknown as Record<string, string>), /name/i)
  })

  it('normalizes invalid persisted levels by returning null', () => {
    assert.equal(normalizePersistedApprovalLevel(1), 1)
    assert.equal(normalizePersistedApprovalLevel(10), 10)
    assert.equal(normalizePersistedApprovalLevel(0), null)
    assert.equal(normalizePersistedApprovalLevel(11), null)
    assert.equal(normalizePersistedApprovalLevel(2.5), null)
  })

  it('builds the required levels above a submitter without changing level 1–5 behavior', () => {
    assert.deepEqual(getApprovalLevelsAboveSubmitter(1, 5), [2, 3, 4, 5])
    assert.deepEqual(getApprovalLevelsAboveSubmitter(2, 5), [3, 4, 5])
    assert.deepEqual(getApprovalLevelsAboveSubmitter(10, 10), [])
    assert.deepEqual(getApprovalLevelsAboveSubmitter(1, 10), [2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('includes empty display levels through configured or assigned depth and caps at 10', () => {
    assert.deepEqual(getDisplayApprovalLevels({}, []), [1, 2, 3])
    assert.deepEqual(getDisplayApprovalLevels({ '10': 'Director' }, []), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.deepEqual(getDisplayApprovalLevels({}, [6, null, 10, 11]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('uses configured labels and falls back to Level N', () => {
    assert.equal(getApprovalLevelLabel({ '10': 'Director' }, 10), 'Director')
    assert.equal(getApprovalLevelLabel({ '10': 'Director' }, 9), 'Level 9')
  })
})
```

- [ ] **Step 2: Run the focused test to verify the expected missing-module failure**

Run from the worktree:

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/approval-level-policy.test.ts
```

Expected: FAIL because `src/lib/approval-levels.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal shared policy**

Implement the exported API with these rules:

```ts
export const MIN_APPROVAL_LEVEL = 1 as const
export const MAX_APPROVAL_LEVEL = 10 as const
export const APPROVAL_LEVELS = Array.from(
  { length: MAX_APPROVAL_LEVEL },
  (_, index) => index + MIN_APPROVAL_LEVEL,
) as readonly number[]

export const approvalLevelSchema = z.number().int().min(MIN_APPROVAL_LEVEL).max(MAX_APPROVAL_LEVEL)
export const nullableApprovalLevelSchema = approvalLevelSchema.nullable()
```

`validateApprovalLevel(value, { allowNull = false })` must return `number | null` and throw `Error('Approval level must be an integer from 1 to 10')` for invalid required values. `validateLevelNames(value)` must accept `undefined`, `null`, or `{}` as `null`; otherwise parse a record whose keys match `1`–`10`, whose values are non-empty trimmed strings, and throw `Error('Approval level names must use levels 1 through 10 with non-empty names')` on failure. Do not coerce string level numbers in server validation.

`normalizePersistedApprovalLevel` returns a valid integer or `null`. `normalizePersistedLevelNames` keeps only valid key/value pairs from unknown JSON and returns `null` when none remain. `getDisplayApprovalLevels` computes `max(3, highest valid configured key, highest valid assigned level)`, caps it at 10, and returns `[1..max]`. `getApprovalLevelsAboveSubmitter` validates both bounds, returns `[]` when the submitter is at/above the maximum, and otherwise returns every integer above the submitter through the maximum. `getApprovalLevelLabel` uses a normalized configured name or `Level ${level}`.

- [ ] **Step 4: Run the focused test to verify green**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/approval-level-policy.test.ts
```

Expected: all policy tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/approval-levels.ts tests/regression/approval-level-policy.test.ts
git commit -m "feat: add shared approval level policy"
```

---

### Task 2: Department level-name persistence and ten-level admin UI

**Files:**
- Modify: `src/server-actions/departments.ts`
- Modify: `src/components/admin/department-form.tsx`
- Modify: `src/components/admin/edit-department-dialog.tsx` only if types require it
- Create: `tests/regression/department-levels.test.ts`

**Interfaces:**
- Consumes the policy exports from Task 1.
- Produces strict `createDepartment`/`updateDepartment` validation and a DepartmentForm that supports keys 1–10 without dropping sparse values.

- [ ] **Step 1: Write failing server/UI contract tests**

Create source-contract tests that assert the server action imports and calls `validateLevelNames`, uses `levelNames: ... ?? null` when explicitly clearing a configuration, and the form imports `MAX_APPROVAL_LEVEL`, checks the shared maximum, shows a maximum message, and preserves the existing renumber-on-remove callback. Also add a runtime check through `validateLevelNames` for level 10 and rejection of level 11.

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateLevelNames } from '@/lib/approval-levels'

const read = (path: string) => readFileSync(path, 'utf8')

describe('department level configuration', () => {
  it('accepts level 10 and rejects level 11 at the shared validation boundary', () => {
    assert.deepEqual(validateLevelNames({ '10': 'Director' }), { '10': 'Director' })
    assert.throws(() => validateLevelNames({ '11': 'Invalid' }), /level/i)
  })

  it('validates department level names server-side and clears an explicitly empty map', () => {
    const source = read('src/server-actions/departments.ts')
    assert.match(source, /validateLevelNames/)
    assert.match(source, /levelNames:\s*validatedLevelNames/)
  })

  it('lets the admin form add ten levels and communicates the limit', () => {
    const source = read('src/components/admin/department-form.tsx')
    assert.match(source, /MAX_APPROVAL_LEVEL/)
    assert.match(source, /levelEntries\.length\s*<\s*MAX_APPROVAL_LEVEL/)
    assert.match(source, /Maximum.*10|10.*maximum/i)
    assert.match(source, /return updated\.map\(\(entry, i\) => \(\{ \.\.\.entry, key: String\(i \+ 1\) \}\)\)/)
  })
})
```

- [ ] **Step 2: Run the focused tests and confirm they fail for missing wiring**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/department-levels.test.ts
```

Expected: the runtime policy assertion passes, while source-contract assertions fail because the server action and form do not yet use the shared policy or level 10.

- [ ] **Step 3: Add server validation and explicit empty-map persistence**

In `src/server-actions/departments.ts`, import `validateLevelNames`. Change the input `levelNames` type to `unknown` so runtime validation is not defeated by a caller cast. At the start of both `createDepartment` and `updateDepartment`, compute:

```ts
const validatedLevelNames = validateLevelNames(input.levelNames)
```

Use `levelNames: validatedLevelNames` in both Prisma writes. This stores `null` when the caller explicitly provides no names and never sends malformed JSON to Prisma. Leave uniqueness checks, auth, and revalidation behavior unchanged.

- [ ] **Step 4: Update the form to use the shared maximum without losing sparse data**

In `department-form.tsx`, import `MAX_APPROVAL_LEVEL`, `APPROVAL_LEVELS`, and `validateLevelNames`. Use a form schema whose `levelNames` field is the shared `levelNamesSchema`. Change `addLevel` to refuse additions at ten and choose the first unused numeric key after the current highest valid key, capped at ten; do not use `levelEntries.length + 1`, because a sparse saved map can otherwise overwrite a key. Keep `removeLevel`’s sequential renumbering behavior. Render a disabled/hidden Add Level control at ten and visible helper text such as `Maximum 10 approval levels.`. Build the sparse map exactly as today, omit blank rows, and run `validateLevelNames` before calling the server action so the UI can show a local form error.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/approval-level-policy.test.ts tests/regression/department-levels.test.ts
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsc --noEmit
```

Expected: focused tests pass and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/server-actions/departments.ts src/components/admin/department-form.tsx src/components/admin/edit-department-dialog.tsx tests/regression/department-levels.test.ts
git commit -m "feat: support ten department approval levels"
```

---

### Task 3: Validate internal and external level assignment writes

**Files:**
- Modify: `src/server-actions/users.ts`
- Modify: `src/server-actions/department-assignments.ts`
- Modify: `src/components/admin/user-form.tsx`
- Modify: `src/components/admin/additional-departments-section.tsx`
- Create: `tests/regression/approval-level-assignment.test.ts`

**Interfaces:**
- Consumes `validateApprovalLevel`, `APPROVAL_LEVELS`, `MAX_APPROVAL_LEVEL`, and `getApprovalLevelLabel` from Task 1.
- Produces authoritative validation for `createUser`, `updateUser`, `addUserToDepartment`, and all client level selectors/inputs.

- [ ] **Step 1: Write failing assignment-boundary tests**

Add source-contract tests that assert all four mutation paths import/use `validateApprovalLevel`, and that UI controls use `APPROVAL_LEVELS` or `MAX_APPROVAL_LEVEL` rather than a separate hardcoded range. Runtime assertions must cover `1` and `10` as valid and `0`, `11`, and `1.5` as rejected.

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateApprovalLevel } from '@/lib/approval-levels'

const read = (path: string) => readFileSync(path, 'utf8')

describe('approval level assignment boundaries', () => {
  it('accepts only the inclusive 1–10 integer range', () => {
    assert.equal(validateApprovalLevel(1), 1)
    assert.equal(validateApprovalLevel(10), 10)
    for (const invalid of [0, 11, 1.5]) {
      assert.throws(() => validateApprovalLevel(invalid), /1.*10|integer/)
    }
  })

  it('validates internal user create/update writes', () => {
    const source = read('src/server-actions/users.ts')
    assert.match(source, /validateApprovalLevel\(input\.level,\s*\{\s*allowNull:\s*true\s*\}\)/s)
    assert.ok((source.match(/validateApprovalLevel/g) ?? []).length >= 2)
  })

  it('validates external department-approver writes', () => {
    const source = read('src/server-actions/department-assignments.ts')
    assert.match(source, /validateApprovalLevel\(level\)/)
  })

  it('uses the shared ten-level policy in both assignment editors', () => {
    for (const path of [
      'src/components/admin/user-form.tsx',
      'src/components/admin/additional-departments-section.tsx',
    ]) {
      const source = read(path)
      assert.match(source, /APPROVAL_LEVELS|MAX_APPROVAL_LEVEL/)
    }
  })
})
```

- [ ] **Step 2: Run the focused test and confirm missing validation failures**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/approval-level-assignment.test.ts
```

Expected: runtime boundary assertions pass, source-contract assertions fail until the actions and forms are wired.

- [ ] **Step 3: Add server validation before database reads/writes**

In `users.ts`, validate `input.level` with `{ allowNull: true }` at the beginning of `createUser` and `updateUser`, then write the returned value rather than the raw input. In `department-assignments.ts`, validate `level` before loading or mutating the assignment and write the validated number. Invalid inputs must throw the existing action error shape before any mutation; existing auth, department separation, duplicate checks, and revalidation remain unchanged.

In `hierarchy.ts`, which is completed in Task 4, the same policy must be used for batch and single-user updates; do not create a separate validation implementation here.

- [ ] **Step 4: Derive client options from shared policy**

In `user-form.tsx` and `additional-departments-section.tsx`, import `APPROVAL_LEVELS` and use it to render `SelectItem`s for 1–10 when a department has no configured labels. When labels exist, filter/map only valid configured keys and sort numerically. Use `MAX_APPROVAL_LEVEL` for numeric input `max`. Keep the `None`/blank option for internal users and the existing role/department filtering rules.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/approval-level-policy.test.ts tests/regression/approval-level-assignment.test.ts
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsc --noEmit
```

Expected: all focused tests pass and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/server-actions/users.ts src/server-actions/department-assignments.ts src/components/admin/user-form.tsx src/components/admin/additional-departments-section.tsx tests/regression/approval-level-assignment.test.ts
 git commit -m "feat: validate internal and external approval levels"
```

---

### Task 4: Safe hierarchy reads, updates, and approval-chain generation

**Files:**
- Modify: `src/server-actions/hierarchy.ts`
- Modify: `src/components/admin/hierarchy-view.tsx`
- Modify: `src/components/admin/hierarchy-column.tsx` only if label props need adjustment
- Modify: `src/server-actions/approvals.ts`
- Modify: `src/server-actions/solutions.ts`
- Create: `tests/regression/approval-chain-levels.test.ts`
- Create: `tests/regression/hierarchy-level-range.test.ts`

**Interfaces:**
- Consumes all Task 1 policy helpers and assignment validation from Task 3.
- Produces hierarchy data whose `usersByLevel` contains every display level through the calculated maximum, and approval creation that never emits a required level outside 1–10.

- [ ] **Step 1: Write failing hierarchy/chain tests**

Add pure/source-contract tests for the required boundaries:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getApprovalLevelsAboveSubmitter, getDisplayApprovalLevels } from '@/lib/approval-levels'

const read = (path: string) => readFileSync(path, 'utf8')

describe('hierarchy and approval-chain level range', () => {
  it('supports a level-1 submitter through a level-10 approver', () => {
    assert.deepEqual(getApprovalLevelsAboveSubmitter(1, 10), [2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('treats a level-10 submitter as top-level without creating higher levels', () => {
    assert.deepEqual(getApprovalLevelsAboveSubmitter(10, 10), [])
  })

  it('includes configured empty levels through level 10', () => {
    assert.deepEqual(getDisplayApprovalLevels({ '10': 'Director' }, [1]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('filters invalid persisted levels instead of exposing them as hierarchy buckets', () => {
    const source = read('src/server-actions/hierarchy.ts')
    assert.match(source, /normalizePersistedApprovalLevel/)
    assert.match(source, /getDisplayApprovalLevels/)
  })

  it('validates hierarchy updates and approval-chain level arguments', () => {
    const hierarchy = read('src/server-actions/hierarchy.ts')
    const approvals = read('src/server-actions/approvals.ts')
    const solutions = read('src/server-actions/solutions.ts')
    assert.match(hierarchy, /validateApprovalLevel/)
    assert.match(approvals, /validateApprovalLevel|getApprovalLevelsAboveSubmitter/)
    assert.match(solutions, /validateApprovalLevel|getApprovalLevelsAboveSubmitter/)
  })
})
```

- [ ] **Step 2: Run the focused tests and confirm missing wiring failures**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/hierarchy-level-range.test.ts tests/regression/approval-chain-levels.test.ts
```

Expected: pure policy assertions pass and source-contract assertions fail until reads and chains use the shared helpers.

- [ ] **Step 3: Make hierarchy reads safe and include empty configured levels**

In `getDepartmentHierarchy`, `getHierarchyData`, the read-only hierarchy function, and `getCurrentUserApprovalChain`:

1. Normalize `department.levelNames` through `normalizePersistedLevelNames`.
2. Normalize each internal `user.level` and external `approverLevel`; skip members whose persisted level is invalid instead of placing them in level 0/11.
3. Compute the display range with `getDisplayApprovalLevels(levelNames, assignedLevels)` and initialize every returned bucket from that range, including empty levels.
4. Return `maxLevel` as the last display level and return the normalized names.

Use Prisma filters `gte: 1, lte: 10` wherever a read queries active users/department approvers for hierarchy or approval generation, so invalid persisted values cannot become candidates.

- [ ] **Step 4: Validate hierarchy writes and label columns through the policy**

At the start of `updateHierarchy`, validate every `update.level` with `{ allowNull: true }` before `validateHierarchyUpdates` or any Prisma operation. Validate `newLevel` in `updateUserLevel` before pending-approval checks. Replace `Array.from({ length: maxLevel })` callers’ label casts with `getApprovalLevelLabel(department.levelNames, level)`, and keep all existing drag/drop, pending-approval, optimistic-locking, logging, and revalidation behavior.

- [ ] **Step 5: Use the shared range in request/solution/final approval chains**

In `approvals.ts`, constrain `getMaxLevelInDepartment` to valid levels, validate the submitter level with invalid persisted values falling back to level 1, use `getApprovalLevelsAboveSubmitter`, and validate every `requiredLevel` before `createMany`. Preserve top-level auto-approval and skipping levels without active approvers.

In `solutions.ts`, apply the same policy to the hierarchy solution chain, final approval chain, and any direct hierarchy approval-record creation. The level-10 path must either create pending records only for valid levels above the submitter or create the existing auto-approved record when the submitter is top-level. Do not change custom approval-chain ordering or attachment behavior.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/approval-level-policy.test.ts tests/regression/department-levels.test.ts tests/regression/approval-level-assignment.test.ts tests/regression/hierarchy-level-range.test.ts tests/regression/approval-chain-levels.test.ts
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsc --noEmit
```

Expected: all focused tests pass and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/server-actions/hierarchy.ts src/components/admin/hierarchy-view.tsx src/components/admin/hierarchy-column.tsx src/server-actions/approvals.ts src/server-actions/solutions.ts tests/regression/hierarchy-level-range.test.ts tests/regression/approval-chain-levels.test.ts
 git commit -m "feat: extend hierarchy approvals through level ten"
```

---

### Task 5: Phase 2 integration verification and review gate

**Files:**
- Modify: `tests/regression/department-levels.test.ts` if additional discovered contract coverage is needed
- Modify: `tests/regression/approval-chain-levels.test.ts` if additional discovered contract coverage is needed
- No production schema files should change

- [ ] **Step 1: Run the complete static check**

```bash
cd .worktrees/approval-levels-and-formatted-descriptions
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npm run check
git diff --check
```

Expected: `205` baseline tests plus the new Phase 2 tests pass with zero failures.

- [ ] **Step 2: Run a production build**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npm run build
```

Expected: exit 0. Existing Next/SWC or lint warnings may remain, but no new errors may be introduced.

- [ ] **Step 3: Verify no migration was added**

```bash
git diff --name-only HEAD~5..HEAD -- prisma/schema.prisma prisma/migrations
```

Expected: no Phase 2 schema or migration changes.

- [ ] **Step 4: Commit any test-only review corrections**

```bash
git status --short
```

If a focused test needs a correction, run that test red/green again, then commit only the test correction with:

```bash
git add tests/regression/department-levels.test.ts tests/regression/approval-chain-levels.test.ts
git commit -m "test: tighten phase two level coverage"
```

Do not commit generated `.next`, formatter, Prisma, or `.pi-subagents` artifacts.
