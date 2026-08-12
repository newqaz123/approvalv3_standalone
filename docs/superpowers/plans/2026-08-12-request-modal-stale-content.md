# Request Modal Stale-Content Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the previous request's details from flashing when a user opens a different request, and show an accessible skeleton dialog until the selected request is loaded.

**Architecture:** Preserve the public `RequestModalRouter` API but turn it into a thin wrapper around a private stateful router keyed only by `requestId`. Each selected request receives a fresh React state instance, while the private router renders the existing request-detail skeleton inside an accessible controlled dialog until that request's data is available.

**Tech Stack:** React 19, Next.js 15 App Router, TypeScript, Radix/shadcn Dialog, Node test runner via `tsx`.

## Global Constraints

- Never render request A's details while request B is selected.
- Key the stateful router only by `requestId`; do not key it by `open`, status, timestamps, random values, or list data.
- Keep `RequestModalRouterProps` and all existing callers unchanged.
- Show the existing `RequestDetailSkeleton` immediately while the selected request loads.
- Give the loading dialog both a `DialogTitle` and `DialogDescription`.
- Preserve existing close behavior, permission checks, workflow actions, refresh callbacks, and modal selection.
- Do not change list polling, filters, pagination, or server actions.
- Do not run production migrations.

---

## File Structure

**Create**

- `tests/regression/request-modal-stale-content.test.ts` — source-contract regression coverage for the keyed state boundary and accessible skeleton loading branch.

**Modify**

- `src/components/requests/request-modal-router.tsx` — add the keyed wrapper, move existing stateful behavior into a private component, and render the loading skeleton dialog.
- `tests/regression/engineering-sub-tasks.test.ts` — remove loading-guard assertions that do not belong to the sub-task regression contract.

**Update after implementation**

- `graphify-out/` — refresh the repository graph after source changes.

---

### Task 1: Add the Keyed Request State Boundary and Loading Skeleton

**Files:**

- Create: `tests/regression/request-modal-stale-content.test.ts`
- Modify: `tests/regression/engineering-sub-tasks.test.ts:350-359`
- Modify: `src/components/requests/request-modal-router.tsx:1-55,149-154`

**Interfaces:**

- Consumes: existing `RequestModalRouterProps`, `RequestDetailSkeleton`, and shadcn Dialog components.
- Produces: unchanged exported `RequestModalRouter(props: RequestModalRouterProps)` and private `RequestModalRouterContent(props: RequestModalRouterProps)`.

- [ ] **Step 1: Write the failing stale-content regression test**

Create `tests/regression/request-modal-stale-content.test.ts`:

```ts
import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  'src/components/requests/request-modal-router.tsx',
  'utf8'
)

it('creates a fresh stateful router for every selected request', () => {
  assert.match(
    source,
    /export function RequestModalRouter\(props: RequestModalRouterProps\) \{[\s\S]*?<RequestModalRouterContent[\s\S]*?key=\{props\.requestId\}[\s\S]*?\{\.\.\.props\}[\s\S]*?\/>[\s\S]*?\}/
  )
  assert.match(source, /function RequestModalRouterContent\(/)
  assert.doesNotMatch(source, /key=\{(?:open|Date\.now\(\)|Math\.random\(\))/)
})

it('shows an accessible skeleton while the selected request loads', () => {
  assert.match(
    source,
    /import \{ RequestDetailSkeleton \} from '@\/components\/loading\/request-detail-skeleton'/
  )
  assert.match(source, /DialogDescription/)

  const loadingBlock = source.match(
    /if \(loading && !requestData\) \{[\s\S]*?\n  \}\n  if \(!requestData\)/
  )?.[0] ?? ''

  assert.match(loadingBlock, /<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>/)
  assert.match(loadingBlock, /<DialogContent/)
  assert.match(loadingBlock, /<DialogTitle>Loading request<\/DialogTitle>/)
  assert.match(loadingBlock, /<DialogDescription className="sr-only">/)
  assert.match(loadingBlock, /Request details are loading\./)
  assert.match(loadingBlock, /<RequestDetailSkeleton \/>/)
  assert.doesNotMatch(loadingBlock, /return null/)
})
```

- [ ] **Step 2: Remove unrelated loading assertions from the sub-task regression test**

In `tests/regression/engineering-sub-tasks.test.ts`, remove only these two assertions from the test named `routes visible requests to SubTasksSection with options and permissions`:

```ts
assert.match(source, /if \(loading && !requestData\) \{/)
assert.doesNotMatch(source, /if \(loading \|\| !requestData\) \{/)
```

Keep every sub-task assertion in that test unchanged.

- [ ] **Step 3: Run the focused tests and confirm the new contract fails**

Run:

```bash
npx tsx --test \
  tests/regression/request-modal-stale-content.test.ts \
  tests/regression/engineering-sub-tasks.test.ts
```

Expected: `request-modal-stale-content.test.ts` fails because `RequestModalRouterContent`, the `requestId` key, and the router-level skeleton dialog are absent. The engineering sub-task tests remain green.

- [ ] **Step 4: Import the loading and dialog components**

Add these imports to `src/components/requests/request-modal-router.tsx`:

```tsx
import { RequestDetailSkeleton } from '@/components/loading/request-detail-skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
```

- [ ] **Step 5: Add the keyed public wrapper and private stateful router**

Keep `RequestModalRouterProps` unchanged. Replace the current exported stateful function declaration with this wrapper followed by the private component declaration:

```tsx
export function RequestModalRouter(props: RequestModalRouterProps) {
  return <RequestModalRouterContent key={props.requestId} {...props} />
}

function RequestModalRouterContent({
  requestId,
  open,
  onOpenChange,
  onActionComplete,
  onLoadStateChange,
  onLoadError,
}: RequestModalRouterProps) {
```

Leave the entire existing function body inside `RequestModalRouterContent`. Do not change its state variables, effects, handlers, switch cases, or returned workflow modals.

- [ ] **Step 6: Replace the invisible initial-loading return with the skeleton dialog**

Replace:

```tsx
if (loading && !requestData) {
  return null // Or a loading skeleton
}
```

with:

```tsx
if (loading && !requestData) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Loading request</DialogTitle>
          <DialogDescription className="sr-only">
            Request details are loading.
          </DialogDescription>
        </DialogHeader>
        <RequestDetailSkeleton />
      </DialogContent>
    </Dialog>
  )
}
```

Keep the following `if (!requestData) { return null }` branch for missing or failed request loads. Do not use previous request data as fallback content.

- [ ] **Step 7: Run focused diagnostics before tests**

Run LSP diagnostics on the touched source file:

```text
lsp_diagnostics({
  paths: ["src/components/requests/request-modal-router.tsx"],
  severity: "all",
  serverScope: "primary"
})
```

Expected: no TypeScript errors.

- [ ] **Step 8: Run the focused regression tests**

Run:

```bash
npx tsx --test \
  tests/regression/request-modal-stale-content.test.ts \
  tests/regression/engineering-sub-tasks.test.ts
```

Expected: all tests pass.

- [ ] **Step 9: Manually verify the recorded interaction**

On the Requests page:

1. Open request A and wait for its details.
2. Close request A.
3. Open request B immediately.
4. Confirm the skeleton appears first.
5. Confirm request A's title, description, attachments, approval state, and actions never appear in request B's dialog.
6. Repeat rapidly across at least three requests.
7. Confirm closing and reopening the same request still works.

Expected: every distinct request opens with a skeleton followed only by its own details.

- [ ] **Step 10: Commit the focused fix**

```bash
git add \
  src/components/requests/request-modal-router.tsx \
  tests/regression/request-modal-stale-content.test.ts \
  tests/regression/engineering-sub-tasks.test.ts
git commit -m "fix: prevent stale request modal content"
```

---

### Task 2: Repository Verification and Graph Refresh

**Files:**

- Verify: `src/components/requests/request-modal-router.tsx`
- Verify: `tests/regression/request-modal-stale-content.test.ts`
- Verify: `tests/regression/engineering-sub-tasks.test.ts`
- Update: `graphify-out/`

**Interfaces:**

- Consumes: the keyed `RequestModalRouter` implementation from Task 1.
- Produces: a green repository check and an updated code knowledge graph.

- [ ] **Step 1: Run the required repository check**

Run:

```bash
npm run check
```

Expected: TypeScript, manager tests, and all regression tests pass.

- [ ] **Step 2: Check all edited files for diagnostics**

Run:

```text
lens_diagnostics({
  mode: "all",
  paths: [
    "src/components/requests/request-modal-router.tsx",
    "tests/regression/request-modal-stale-content.test.ts",
    "tests/regression/engineering-sub-tasks.test.ts"
  ],
  severity: "all"
})
```

Expected: no blocking errors.

- [ ] **Step 3: Verify patch formatting**

Run:

```bash
git diff --check HEAD~1..HEAD
```

Expected: no whitespace errors.

- [ ] **Step 4: Refresh Graphify**

Run:

```bash
graphify update .
```

Expected: the graph updates successfully without corruption warnings.

- [ ] **Step 5: Commit graph changes when tracked output changed**

First inspect:

```bash
git status --short graphify-out
```

If tracked graph files changed, run:

```bash
git add graphify-out
git commit -m "chore: refresh request modal graph"
```

If no tracked graph files changed, do not create an empty commit.

- [ ] **Step 6: Record final verification evidence**

Report:

- focused test command and passing result;
- `npm run check` passing result;
- diagnostics result;
- manual request A → request B verification result;
- Graphify update result;
- any residual risk, especially if browser verification could not be performed.
