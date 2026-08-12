# Approval App Desktop UX Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved clean-theme desktop UX: a shared 1720px authenticated canvas, a compact aligned navbar, clearer Requests filters and rows, and searchable custom approval hierarchy pickers without changing application workflows.

**Architecture:** Introduce one shared Tailwind class utility for the authenticated outer canvas and reuse it in the three authenticated layouts and navbar. Keep Requests filtering, table data, mobile cards, and every workflow-specific picker structurally independent; change only presentation/keyboard behavior, and share only pure approver-search logic plus a small search-field presentation component. All server contracts, polling, pagination, permissions, modal routing, and actions stay untouched.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5, Tailwind CSS 3, Radix/shadcn UI, TanStack Table 8, cmdk, Node test runner through `tsx`, Docker, and agent-browser.

## Global Constraints

- Follow Open Design direction **A — Adaptive wide canvas** from `approval-app-desktop-ux-refresh-v2/approval-system-ux-study.html`.
- Keep the approved clean theme: white application surfaces, cool light-gray page background, slate text and borders, restrained blue interactive states, semantic status colors, and a near-black primary New Request action.
- The authenticated shell is `w-full`, centered, maximum **1720px**, with **16px / 24px / 32px / 40px** horizontal gutters at phone / small-tablet / desktop / very-wide breakpoints.
- Move the desktop/mobile navigation handoff together from `md` to `lg`; the existing mobile navigation remains the navigation experience below `lg` and its routes, polling, tabs, scroll behavior, and card behavior remain unchanged.
- Keep focused surfaces narrow: profile, password change, create/edit forms, solution forms, and request-detail pages retain their existing inner maximum widths.
- Do not change routes, information architecture, roles, permissions, role-aware links, notification polling, request polling/refresh, pagination, modal routing, modal close behavior, or server actions.
- Keep `GetRequestsFilters`, `/api/requests` query serialization, immediate filter application, and the no-WR/status contracts unchanged; do not add Apply, Export, or facet-count behavior.
- Department and requester filters must keep the existing Radix-based `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, and `SelectItem` from `src/components/ui/select.tsx` **as-is**. Do not edit `select.tsx`, do not use native `<select>`, and do not alter dropdown behavior.
- Keep the `md` desktop-table/mobile-card handoff and `src/components/mobile/request-card.tsx` unchanged.
- Do not consolidate workflow-specific hierarchy pickers into one picker; share only search logic and the search-field/status presentation.
- Hierarchy search is client-side over already-supplied users, case-insensitive across name, email, role, and available level metadata.
- Preserve current-user exclusion, selected-user exclusion, selection order, reorder/remove behavior, disabled states, and submissions in every picker flow.
- No migrations, seeds, or database mutation scripts.
- Protect all unrelated uncommitted work; stage and commit only files listed in the current task.
- Apply strict TDD: every production change follows a focused failing test observed for the expected reason, minimal implementation, and green rerun.

---

## File Structure

### Create

- `src/lib/authenticated-shell.ts` — single exported class string for the 1720px canvas and responsive gutters.
- `src/lib/approver-search.ts` — generic, pure, case-insensitive approver filtering across optional metadata.
- `src/components/approvals/approver-search-field.tsx` — reusable accessible result-count shell with native-Input and cmdk-CommandInput variants.
- `tests/regression/authenticated-shell-navbar.test.ts` — shell consumers, responsive handoff, navbar accessibility, and behavior-preservation contracts.
- `tests/regression/requests-desktop-ux.test.ts` — Requests filter/table presentation plus no-native-select and unchanged-data-flow contracts.
- `tests/regression/approver-search.test.ts` — executable pure-helper tests.
- `tests/regression/custom-approval-picker-search.test.ts` — source wiring, reset, empty/exhausted, bounded-list, and per-flow picker contracts.
- `src/app/test-harness/hierarchy-pickers/page.tsx` — production-built but environment-gated server route for the picker harness.
- `src/app/test-harness/hierarchy-pickers/hierarchy-picker-harness-client.tsx` — client fixture mounting all five real picker implementations with deterministic users and no server actions.
- `tests/e2e/desktop-ux-refresh.spec.ts` — Docker-backed responsive, keyboard, filter, and hierarchy-search acceptance coverage using existing data plus the test-only picker harness.

### Modify

- `src/app/(dashboard)/layout.tsx` — shared shell and coordinated `lg` navbar handoff.
- `src/app/(admin)/layout.tsx` — shared shell and coordinated `lg` navbar handoff.
- `src/app/admin/layout.tsx` — shared shell and coordinated `lg` navbar handoff.
- `src/components/navigation/navbar.tsx` — shared canvas, compact links/user cluster, inline badge, `aria-current`, and focus states.
- `src/components/mobile/mobile-nav.tsx` — breakpoint-only `lg:hidden` handoff; no other behavior or presentation edits.
- `src/app/(dashboard)/dashboard/page.tsx` — remove redundant Tailwind `container` cap from this wide operational page.
- `src/app/(dashboard)/requests/my-actions/page.tsx` — remove redundant `container` cap from this wide operational page.
- `src/app/(dashboard)/analytics/loading.tsx` — align loading shell with the wide Analytics page.
- `src/components/analytics/analytics-page.tsx` — remove redundant `container max-w-7xl` cap.
- `src/app/(dashboard)/approval-chain/page.tsx` — remove only the authenticated wide-state `max-w-7xl`/extra horizontal padding; retain the unassigned-state `max-w-4xl` focused treatment.
- `src/app/admin/deleted-requests/page.tsx` — remove redundant `container` cap.
- `src/app/admin/retention/page.tsx` — remove redundant `container` cap.
- `src/app/admin/departments/[id]/hierarchy/page.tsx` — remove redundant `container` cap.
- `src/components/requests/request-filters.tsx` — approved two-tier responsive filter layout while retaining the existing custom Select component and immediate callbacks.
- `src/components/requests/request-table.tsx` — title-first desktop columns, row density, one-line dates, and keyboard activation; mobile branch unchanged.
- `src/components/requests/requests-list-client.tsx` — approved Requests heading/action presentation and near-black New Request action.
- `src/components/solutions/custom-approval-picker.tsx` — helper-driven search, count, metadata, bounded list, reset, empty state, and a test-harness export alias for the real picker.
- `src/components/requests/submitter-modal.tsx` — searchable local solution/resubmission hierarchy picker plus a test-harness export alias.
- `src/components/requests/submit-final-approval-modal.tsx` — searchable local final-submission hierarchy picker plus a test-harness export alias.
- `src/components/requests/final-approval-resubmit-modal.tsx` — searchable local final-resubmission hierarchy picker plus a test-harness export alias.
- `src/components/requests/solution-modal.tsx` — search parity for the legacy local picker plus a test-harness export alias, without altering its workflow surface.
- `tests/regression/gap-improvements.test.ts` — update only obsolete compact-filter and `md` navigation-handoff assertions after the new focused contracts are green.

### Deliberately Unchanged

- `src/components/ui/select.tsx`
- `src/components/mobile/request-card.tsx`
- `src/components/requests/requests-list-with-filters.tsx`
- `src/components/requests/request-modal-router.tsx`
- `src/app/api/requests/route.ts`
- `src/server-actions/requests.ts`
- all workflow server actions, permission checks, polling intervals, and database schema/seed files

---

### Task 1: Author Browser Acceptance and Observe Baseline RED

**Files:**

- Create: `tests/e2e/desktop-ux-refresh.spec.ts`
- Do not modify: production source files

**Interfaces:**

- Consumes: `TEST_BASE_URL`, existing non-mutating test accounts, and the current authenticated UI.
- Produces: browser assertions for shell alignment, breakpoint handoff, custom Radix filters, desktop-table/mobile-card boundaries, row keyboard activation, and a later deterministic hierarchy-picker harness.

- [ ] **Step 1: Write the non-mutating acceptance spec before production changes**

Create a sign-in helper using `/sign-in`, `#email`, `#password`, and the `Sign in` button. Add scenarios for:

1. 1600px: navbar/main edges align within 1px, Requests table is visible, Created values do not wrap, and body has no horizontal overflow.
2. 1280px: desktop navbar is visible, links do not wrap, secondary role/email metadata is hidden, and filters are unclipped.
3. 900px: **mobile navigation is visible while the Requests desktop table remains visible**, because nav hands off at `lg` but table/cards still hand off at `md`.
4. 767px and 390px: mobile navigation and mobile request cards are visible; desktop navbar/table are absent; filter controls form one column at 390px.
5. Department/Requester controls expose Radix combobox/listbox behavior and no Apply button.
6. Enter and Space on a focused desktop request row open the same request dialog.
7. `/test-harness/hierarchy-pickers` eventually exposes five labeled real picker fixtures; for each fixture, search by name/email/role/level as applicable, verify live count, `No approvers found`, `No more users available`, select-reset, and close-reset. Before Task 11 creates the harness, this scenario is expected to fail because the route is absent.

Do not create, approve, reject, resubmit, delete, archive, seed, or migrate records.

- [ ] **Step 2: Start a baseline container and verify RED**

Use the Docker procedure later documented in Task 11, pointing to the existing `approval-db` without migration or seed commands. Run:

```bash
TEST_BASE_URL=http://127.0.0.1:3101 \
E2E_ADMIN_EMAIL=admin@example.com \
E2E_ADMIN_PASSWORD=changeme \
npx playwright test tests/e2e/desktop-ux-refresh.spec.ts --project=chromium
```

Expected: FAIL for the 1720px shell, `lg` navigation handoff, row keyboard activation, and missing hierarchy harness. Confirm failures are assertion failures caused by absent features, not login/environment errors. If Docker cannot start, record that limitation and still run the spec against any known-good local target; do not proceed until at least the focused regression tests in subsequent tasks demonstrate observed RED.

- [ ] **Step 3: Stop the baseline container without committing the E2E file yet**

Stop/remove only the temporary app container and image; leave `approval-db` running and unchanged. Keep `tests/e2e/desktop-ux-refresh.spec.ts` uncommitted so later production tasks can make its scenarios green without violating test-first order.

---

### Task 2: Shared Authenticated Canvas and Responsive Navigation Handoff

**Files:**

- Create: `src/lib/authenticated-shell.ts`
- Create: `tests/regression/authenticated-shell-navbar.test.ts`
- Modify: `src/app/(dashboard)/layout.tsx`
- Modify: `src/app/(admin)/layout.tsx`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/components/mobile/mobile-nav.tsx`

**Interfaces:**

- Produces: `export const AUTHENTICATED_SHELL_CLASS = 'mx-auto w-full max-w-[1720px] px-4 sm:px-6 lg:px-8 2xl:px-10'`.
- Consumes: no application state; layouts apply the string through `cn(AUTHENTICATED_SHELL_CLASS, verticalSpacingClasses)`.
- Preserves: auth/admin redirects, `MobileNav`, `Navbar`, admin `space-y-8`, and all vertical spacing.

- [ ] **Step 1: Write the failing shell and handoff tests**

Create `tests/regression/authenticated-shell-navbar.test.ts` with these initial tests:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const dashboardLayout = 'src/app/(dashboard)/layout.tsx'
const adminLayouts = ['src/app/(admin)/layout.tsx', 'src/app/admin/layout.tsx']

describe('authenticated shell and navigation', () => {
  it('defines one 1720px shell with the approved gutters', () => {
    const source = read('src/lib/authenticated-shell.ts')

    assert.match(source, /AUTHENTICATED_SHELL_CLASS/)
    for (const token of ['w-full', 'max-w-[1720px]', 'mx-auto', 'px-4', 'sm:px-6', 'lg:px-8', '2xl:px-10']) {
      assert.ok(source.includes(token), `missing ${token}`)
    }
  })

  it('uses the shared shell in every authenticated layout', () => {
    for (const path of [dashboardLayout, ...adminLayouts]) {
      const source = read(path)
      assert.match(source, /AUTHENTICATED_SHELL_CLASS/)
      assert.doesNotMatch(source, /md:max-w-7xl/)
      assert.match(source, /<MobileNav \/>/)
      assert.match(source, /<Navbar \/>/)
    }
  })

  it('hands navigation from mobile to desktop at lg without a gap', () => {
    for (const path of [dashboardLayout, ...adminLayouts]) {
      assert.match(read(path), /hidden lg:block/)
    }

    const mobileNav = read('src/components/mobile/mobile-nav.tsx')
    assert.match(mobileNav, /lg:hidden/)
    assert.doesNotMatch(mobileNav, /md:hidden/)
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx tsx --test tests/regression/authenticated-shell-navbar.test.ts
```

Expected: FAIL because `src/lib/authenticated-shell.ts` does not exist and layouts still use `md:max-w-7xl`/`md` handoff.

- [ ] **Step 3: Add the shared shell constant**

Create `src/lib/authenticated-shell.ts`:

```ts
export const AUTHENTICATED_SHELL_CLASS =
  'mx-auto w-full max-w-[1720px] px-4 sm:px-6 lg:px-8 2xl:px-10'
```

- [ ] **Step 4: Apply the shell to all three authenticated layouts**

In each layout, import:

```ts
import { AUTHENTICATED_SHELL_CLASS } from '@/lib/authenticated-shell'
import { cn } from '@/lib/utils'
```

Use these exact main shapes:

```tsx
// src/app/(dashboard)/layout.tsx
<main className={cn(AUTHENTICATED_SHELL_CLASS, 'pb-8 pt-20 lg:py-8')}>
  {children}
</main>
```

```tsx
// both admin layouts
<main className={cn(AUTHENTICATED_SHELL_CLASS, 'pb-12 pt-20 lg:py-12')}>
  <div className="space-y-8">{children}</div>
</main>
```

Change only the desktop wrapper in all three layouts:

```tsx
<div className="hidden lg:block">
  <Navbar />
</div>
```

Keep every auth, Prisma role check, and redirect unchanged.

- [ ] **Step 5: Coordinate the mobile side of the breakpoint**

In `src/components/mobile/mobile-nav.tsx`, change only:

```tsx
md:hidden
```

to:

```tsx
lg:hidden
```

Update its documentation comment from `< md` to `< lg`. Do not alter tabs, role branching, pending-count fetch/event/30-second interval, scroll visibility, or link markup.

- [ ] **Step 6: Run focused diagnostics and GREEN tests**

Run primary LSP diagnostics on the five touched TS/TSX files, then:

```bash
npx tsx --test tests/regression/authenticated-shell-navbar.test.ts
```

Expected: no TypeScript errors; all shell/handoff tests pass.

- [ ] **Step 7: Commit the shell boundary**

```bash
git add \
  src/lib/authenticated-shell.ts \
  src/app/'(dashboard)'/layout.tsx \
  src/app/'(admin)'/layout.tsx \
  src/app/admin/layout.tsx \
  src/components/mobile/mobile-nav.tsx \
  tests/regression/authenticated-shell-navbar.test.ts
git commit -m "feat: widen authenticated application shell"
```

---

### Task 3: Compact Desktop Navbar on the Shared Canvas

**Files:**

- Modify: `src/components/navigation/navbar.tsx`
- Modify: `tests/regression/authenticated-shell-navbar.test.ts`
- Verify: `tests/regression/profile-menu.test.ts`
- Verify: `tests/regression/gap-improvements.test.ts`

**Interfaces:**

- Consumes: `AUTHENTICATED_SHELL_CLASS` from Task 2.
- Preserves: role-aware destinations, `fetch('/api/actions/pending-count')`, `approvalapp:request-data-changed`, 30-second refresh, click-outside menu close, and `signOut({ callbackUrl: '/sign-in' })`.
- Produces: compact 44px navigation links, inline pending badge, `aria-current="page"`, and responsive secondary user metadata while the user name/avatar remain visible.

- [ ] **Step 1: Extend the navbar regression test and verify RED**

Append tests that assert:

```ts
it('aligns the navbar to the same shell and keeps links keyboard-visible', () => {
  const source = read('src/components/navigation/navbar.tsx')

  assert.match(source, /AUTHENTICATED_SHELL_CLASS/)
  assert.doesNotMatch(source, /max-w-7xl/)
  assert.match(source, /min-h-\[44px\]/)
  assert.match(source, /focus-visible:/)
  assert.match(source, /aria-current=\{[^}]+\? 'page' : undefined\}/)
})

it('keeps the pending badge inline and collapses secondary user metadata', () => {
  const source = read('src/components/navigation/navbar.tsx')

  assert.match(source, /aria-label=\{`\$\{pendingCount\} pending actions`\}/)
  assert.doesNotMatch(source, /absolute -right-1 -top-1/)
  assert.match(source, /data-user-secondary/)
  assert.match(source, /hidden 2xl:inline/)
  assert.match(source, /callbackUrl: '\/sign-in'/)
  assert.match(source, /setInterval\(fetchPendingCount, 30000\)/)
})
```

Run:

```bash
npx tsx --test tests/regression/authenticated-shell-navbar.test.ts
```

Expected: FAIL because Navbar still owns `max-w-7xl`, lacks `aria-current`, uses an absolute badge, and always displays metadata.

- [ ] **Step 2: Apply the shared shell and compact flex behavior**

Import the shell and `cn`:

```ts
import { AUTHENTICATED_SHELL_CLASS } from '@/lib/authenticated-shell'
import { cn } from '@/lib/utils'
```

Use the shared class on the nav inner div and keep `h-16`. Replace wide fixed gaps with compact responsive gaps such as `gap-3 xl:gap-5`, give the link group `min-w-0`, and keep the brand `shrink-0 whitespace-nowrap`.

- [ ] **Step 3: Add active-state accessibility and stable link targets**

For every role-aware link, keep the existing active condition but add:

```tsx
aria-current={isActive ? 'page' : undefined}
```

and a shared presentation string containing:

```text
min-h-[44px] rounded-md px-2.5 text-sm font-medium transition-colors
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
```

Use restrained blue active state (`bg-blue-50 text-blue-700`) and quiet neutral hover (`hover:bg-slate-100 hover:text-slate-950`). Do not change any link label, destination, icon, or role gate.

- [ ] **Step 4: Keep the badge inline and make user metadata responsive**

Remove `relative`/absolute positioning from the My Actions badge. Render it after the label with an inline `ml-0.5` chip while retaining the existing accessible label and `9+` cap.

Keep the bell/name/avatar cluster and the user's name visible at all desktop widths. Split only the role/email text into `<span data-user-secondary className="hidden 2xl:inline">…</span>` so secondary metadata collapses while the name/avatar remain. Retain the current menu items and click-outside handling. Add an explicit `aria-label="Open user menu"` and `aria-expanded={menuOpen}` to the avatar button while preserving its title.

- [ ] **Step 5: Run focused diagnostics and regression tests**

Run primary LSP diagnostics on `navbar.tsx`, then:

```bash
npx tsx --test \
  tests/regression/authenticated-shell-navbar.test.ts \
  tests/regression/profile-menu.test.ts \
  tests/regression/gap-improvements.test.ts
```

Expected: all pass; polling and profile/approval-chain/sign-out contracts remain present.

- [ ] **Step 6: Commit the navbar**

```bash
git add src/components/navigation/navbar.tsx tests/regression/authenticated-shell-navbar.test.ts
git commit -m "feat: refine desktop navigation density"
```

---

### Task 4: Remove Redundant Caps from Wide Operational Pages

**Files:**

- Modify: `src/app/(dashboard)/dashboard/page.tsx`
- Modify: `src/app/(dashboard)/requests/my-actions/page.tsx`
- Modify: `src/app/(dashboard)/analytics/loading.tsx`
- Modify: `src/components/analytics/analytics-page.tsx`
- Modify: `src/app/(dashboard)/approval-chain/page.tsx`
- Modify: `src/app/admin/deleted-requests/page.tsx`
- Modify: `src/app/admin/retention/page.tsx`
- Modify: `src/app/admin/departments/[id]/hierarchy/page.tsx`
- Modify: `tests/regression/authenticated-shell-navbar.test.ts`

**Interfaces:**

- Consumes: the outer shell supplied by authenticated layouts.
- Produces: operational pages that use all available shell width without a second Tailwind `container`/`max-w-7xl` cap.
- Preserves: focused `max-w-2xl`, `max-w-3xl`, `max-w-4xl`, and `max-w-5xl` pages and the Approval Chain unassigned-state `max-w-4xl` block.

- [ ] **Step 1: Add failing wide/focused page assertions**

Add a table-driven test to `authenticated-shell-navbar.test.ts`:

```ts
it('does not re-cap wide operational pages inside the shared shell', () => {
  const widePages = [
    'src/app/(dashboard)/dashboard/page.tsx',
    'src/app/(dashboard)/requests/my-actions/page.tsx',
    'src/app/(dashboard)/analytics/loading.tsx',
    'src/components/analytics/analytics-page.tsx',
    'src/app/admin/deleted-requests/page.tsx',
    'src/app/admin/retention/page.tsx',
    'src/app/admin/departments/[id]/hierarchy/page.tsx',
  ]

  for (const path of widePages) {
    const source = read(path)
    assert.doesNotMatch(source, /className=["'][^"']*\bcontainer\b/)
    assert.doesNotMatch(source, /max-w-7xl/)
  }
})

it('keeps focused forms and detail pages narrow', () => {
  const focusedContracts = new Map([
    ['src/app/(dashboard)/profile/page.tsx', 'max-w-2xl'],
    ['src/app/(dashboard)/change-password/page.tsx', 'max-w-2xl'],
    ['src/app/(dashboard)/requests/new/page.tsx', 'max-w-3xl'],
    ['src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx', 'max-w-4xl'],
    ['src/app/(dashboard)/requests/[requestId]/page.tsx', 'max-w-5xl'],
    ['src/app/admin/templates/new/page.tsx', 'max-w-2xl'],
    ['src/app/admin/templates/[id]/page.tsx', 'max-w-2xl'],
  ])

  for (const [path, token] of focusedContracts) assert.ok(read(path).includes(token))
})
```

Also assert the assigned Approval Chain return branch no longer contains `max-w-7xl`, while its unassigned branch still contains `max-w-4xl`.

Run and verify FAIL on the wide pages.

- [ ] **Step 2: Remove only redundant outer caps**

Replace wide-page wrappers as follows:

- `container py-*` → `w-full py-*`
- `container mx-auto py-*` → `w-full py-*`
- `container max-w-7xl py-*` → `w-full py-*`
- assigned Approval Chain wrapper `mx-auto max-w-7xl px-4 py-8` → `w-full py-8`

Do not change page content, data calls, tables, cards, or focused-page classes.

- [ ] **Step 3: Run diagnostics and focused tests**

Run primary LSP diagnostics on all eight touched TSX files, then:

```bash
npx tsx --test tests/regression/authenticated-shell-navbar.test.ts
```

Expected: wide-page assertions pass and every focused width assertion remains green.

- [ ] **Step 4: Commit the operational-page width changes**

```bash
git add \
  src/app/'(dashboard)'/dashboard/page.tsx \
  src/app/'(dashboard)'/requests/my-actions/page.tsx \
  src/app/'(dashboard)'/analytics/loading.tsx \
  src/components/analytics/analytics-page.tsx \
  src/app/'(dashboard)'/approval-chain/page.tsx \
  src/app/admin/deleted-requests/page.tsx \
  src/app/admin/retention/page.tsx \
  src/app/admin/departments/'[id]'/hierarchy/page.tsx \
  tests/regression/authenticated-shell-navbar.test.ts
git commit -m "feat: expand authenticated operational pages"
```

---

### Task 5: Requests Header and Two-Tier Filters with Existing Selects

**Files:**

- Create: `tests/regression/requests-desktop-ux.test.ts`
- Modify: `src/components/requests/request-filters.tsx`
- Modify: `src/components/requests/requests-list-client.tsx`
- Modify: `tests/regression/gap-improvements.test.ts`
- Verify unchanged: `src/components/ui/select.tsx`
- Verify unchanged: `src/components/requests/requests-list-with-filters.tsx`

**Interfaces:**

- Consumes: current `RequestFiltersProps`, `RequestFilters`, `DEFAULT_WR_FILTER`, and Radix Select primitives.
- Produces: the same immediate `onFilterChange(RequestFilters)` calls and payload keys in a two-tier responsive layout.
- Hard negative contract: `request-filters.tsx` contains no native `<select>` and `select.tsx` receives no diff.

- [ ] **Step 1: Write the failing Requests filter/header contract tests**

Create `tests/regression/requests-desktop-ux.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const filters = read('src/components/requests/request-filters.tsx')

describe('Requests desktop filters', () => {
  it('retains the existing Radix Select component and never uses native select', () => {
    assert.match(filters, /from ['"]@\/components\/ui\/select['"]/)
    for (const symbol of ['Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem']) {
      assert.match(filters, new RegExp(`\\b${symbol}\\b`))
    }
    assert.doesNotMatch(filters, /<select(?:\s|>)/i)
  })

  it('keeps filtering immediate with no Apply step', () => {
    assert.match(filters, /setFilters\(newFilters\)[\s\S]*onFilterChange\(newFilters\)/)
    assert.match(filters, /onFilterChange\(defaultFilters\)/)
    assert.doesNotMatch(filters, />\s*Apply\s*</)
    assert.match(filters, /aria-pressed=\{showOnlyNoWr\}/)
  })

  it('renders distinct primary and status tiers with responsive controls', () => {
    assert.match(filters, /data-filter-tier="primary"/)
    assert.match(filters, /data-filter-tier="status"/)
    assert.match(filters, /lg:grid-cols-3/)
    assert.ok(filters.includes('2xl:grid-cols-[minmax(20rem,1.8fr)_repeat(4,minmax(10rem,1fr))_minmax(11rem,auto)]'))
    assert.match(filters, /Clear All/)
  })
})
```

Add tests that `requests-list-with-filters.tsx` still contains `URLSearchParams`, repeated array `append`, `/api/requests?`, `cache: 'no-store'`, and `approvalapp:request-data-changed`, and that `requests-list-client.tsx` retains the heading, supporting copy, `BulkDeleteByDateRange`, New Request, and mobile stack.

Run:

```bash
npx tsx --test tests/regression/requests-desktop-ux.test.ts
```

Expected: FAIL only on the missing tier markers/new responsive grid; the Select/no-Apply/data-flow safeguards already pass.

- [ ] **Step 2: Implement the primary filter tier without touching Select behavior**

Keep the existing `Select` trees byte-for-byte except for surrounding layout classes and optional trigger width classes. Add:

```tsx
<div
  data-filter-tier="primary"
  className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(20rem,1.8fr)_repeat(4,minmax(10rem,1fr))_minmax(11rem,auto)]"
>
```

Place search first and give its wrapper `md:col-span-2 lg:col-span-2 2xl:col-span-1`. Then render existing Department Select, Requester Select, From, To, and no-WR button. Keep all controls at least `min-h-10`; do not add debounce or Apply.

- [ ] **Step 3: Implement the status tier and approved clean presentation**

Add a separate wrapper:

```tsx
<div data-filter-tier="status" className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
```

Retain the real `Checkbox` and associated `Label htmlFor`. Keep Clear All contextual. Use white controls on a quiet slate/cool-gray filter surface; preserve green only for the selected no-WR semantic state.

- [ ] **Step 4: Refine the Requests header without adding prototype-only actions**

In `requests-list-client.tsx`, retain the current copy, `BulkDeleteByDateRange`, and mobile stacking. Increase heading hierarchy only through existing typography utilities, and give the New Request button a near-black class such as:

```tsx
className="w-full bg-slate-950 text-white hover:bg-slate-800 sm:w-auto"
```

Do not add Export View or Apply.

- [ ] **Step 5: Update only obsolete compact-layout assertions**

In `tests/regression/gap-improvements.test.ts`, replace the old single-grid assertion:

```ts
assert.ok(requestFilters.includes('lg:grid-cols-[minmax(16rem,1.4fr)_repeat(5,minmax(0,1fr))]'))
```

with assertions for `data-filter-tier="primary"`, `data-filter-tier="status"`, `lg:grid-cols-3`, and the explicit `2xl:grid-cols-[minmax(20rem,1.8fr)_repeat(4,minmax(10rem,1fr))_minmax(11rem,auto)]` grid. Keep all seven status, date, no-WR, navigation, polling, and refresh tests unchanged.

- [ ] **Step 6: Run diagnostics, focused tests, and a no-diff Select guard**

Run primary LSP diagnostics on `request-filters.tsx` and `requests-list-client.tsx`, then:

```bash
npx tsx --test \
  tests/regression/requests-desktop-ux.test.ts \
  tests/regression/gap-improvements.test.ts

git diff --exit-code -- src/components/ui/select.tsx
```

Expected: tests pass; `git diff --exit-code` returns 0 for `select.tsx`.

- [ ] **Step 7: Commit the Requests filter/header presentation**

```bash
git add \
  src/components/requests/request-filters.tsx \
  src/components/requests/requests-list-client.tsx \
  tests/regression/requests-desktop-ux.test.ts \
  tests/regression/gap-improvements.test.ts
git commit -m "feat: clarify request filters and header"
```

---

### Task 6: Desktop Request Table Proportions and Keyboard Rows

**Files:**

- Modify: `src/components/requests/request-table.tsx`
- Modify: `tests/regression/requests-desktop-ux.test.ts`
- Verify unchanged: `src/components/mobile/request-card.tsx`

**Interfaces:**

- Consumes: `RequestListRow`, TanStack columns, `handleRowClick`, `RequestModalRouter`, and existing badge components.
- Produces: desktop-only min-width/table-layout proportions and row activation through click, Enter, or Space.
- Preserves: `md:hidden` mobile cards, `hidden md:block` desktop table, WR sky tint, modal props, empty state, and refresh callback.

- [ ] **Step 1: Add failing table/row tests**

Append tests that assert:

```ts
const table = read('src/components/requests/request-table.tsx')

assert.match(table, /<Table className="min-w-\[[^\]]+\] table-fixed"/)
assert.match(table, /line-clamp-2/)
assert.match(table, /whitespace-nowrap/)
assert.match(table, /min-h-\[60px\]/)
assert.match(table, /tabIndex=\{0\}/)
assert.match(table, /aria-label=\{`Open request /)
assert.doesNotMatch(table, /<TableRow[\s\S]{0,300}role="button"/)
assert.match(table, /event\.key === 'Enter' \|\| event\.key === ' '/)
assert.match(table, /focus-visible:/)
assert.match(table, /bg-sky-50 hover:bg-sky-100\/60/)
assert.match(table, /className="md:hidden space-y-3"/)
assert.match(table, /className="hidden md:block/)
assert.match(table, /<RequestCard/)
assert.match(table, /<RequestModalRouter/)
```

Capture `src/components/mobile/request-card.tsx` in the test and assert critical `RequestCard`, `onTap`, and `RequestCardsEmptyState` source contracts remain. Run and verify RED on table sizing/keyboard assertions.

- [ ] **Step 2: Define stable desktop column proportions**

Give column definitions explicit TanStack `size` values totaling roughly 1200px, for example:

```ts
// title 380, requester 150, status 130, approval 150,
// PIC 140, department 130, files 70, created 130
```

Render `<Table className="min-w-[1220px] table-fixed">`. Apply header/cell widths from `header.getSize()` / `cell.column.getSize()` through inline width styles or matching class contracts. Keep title close to one third of the minimum table width; Files remains compact and Created receives 130px.

- [ ] **Step 3: Refine desktop cell and row anatomy**

- Title wrapper: `min-w-0`; title text `line-clamp-2 break-words font-medium leading-5`.
- Created wrapper: `whitespace-nowrap` and non-shrinking icon.
- PIC/attachment/status content: vertically centered and constrained.
- Desktop rows: approximately 60px minimum visual height through `min-h-[60px]`/cell `py-3` presentation.
- Keep quiet borders, neutral hover, and existing WR sky-tinted classes.

- [ ] **Step 4: Route keyboard activation through the same callback**

Add a memoized handler:

```tsx
const handleRowKeyDown = useCallback(
  (event: React.KeyboardEvent<HTMLTableRowElement>, requestId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleRowClick(requestId)
    }
  },
  [handleRowClick]
)
```

Keep the native `<tr>` row semantics; do **not** set `role="button"` on a table row. Add `tabIndex={0}`, an informative `aria-label={`Open request ${row.original.title}`}`, `onKeyDown`, and visible `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500`. Keep click activation unchanged.

- [ ] **Step 5: Run diagnostics and focused tests**

Run primary LSP diagnostics on `request-table.tsx`, then:

```bash
npx tsx --test tests/regression/requests-desktop-ux.test.ts
git diff --exit-code -- src/components/mobile/request-card.tsx
```

Expected: all table/filter contracts pass and the mobile card file has no diff.

- [ ] **Step 6: Commit the desktop table**

```bash
git add src/components/requests/request-table.tsx tests/regression/requests-desktop-ux.test.ts
git commit -m "feat: improve desktop request row scanning"
```

---

### Task 7: Pure Approver Search and Accessible Search Field

**Files:**

- Create: `src/lib/approver-search.ts`
- Create: `src/components/approvals/approver-search-field.tsx`
- Create: `tests/regression/approver-search.test.ts`
- Create: `tests/regression/custom-approval-picker-search.test.ts`

**Interfaces:**

- Produces:

```ts
export interface ApproverSearchFields {
  id: string
  name: string
  email: string
  role?: string | null
  level?: number | null
}

export function filterApproversByQuery<T extends ApproverSearchFields>(
  users: readonly T[],
  query: string
): T[]
```

- Produces:

```ts
interface ApproverSearchFieldProps {
  value: string
  onChange: (value: string) => void
  resultCount: number
  inputRef?: React.Ref<HTMLInputElement>
  autoFocus?: boolean
  className?: string
  inputKind?: 'input' | 'command'
}
```

- Search-field copy: placeholder `Search by name, email, role, or level`; visible status `${count} approver(s)` with `role="status" aria-live="polite"`.

- [ ] **Step 1: Write executable pure-helper tests**

Create `tests/regression/approver-search.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filterApproversByQuery } from '@/lib/approver-search'

const users = [
  { id: 'a', name: 'Kanokwan Srisawat', email: 'kanokwan@example.com', role: 'Procurement Lead', level: 2 },
  { id: 'b', name: 'Narin Chantarat', email: 'narin@example.com', role: 'System Admin', level: 1 },
  { id: 'c', name: 'Patthira Nopphakun', email: 'patthira@example.com', role: null, level: 3 },
]

describe('filterApproversByQuery', () => {
  it('matches name and email case-insensitively', () => {
    assert.deepEqual(filterApproversByQuery(users, 'KANOKWAN').map((u) => u.id), ['a'])
    assert.deepEqual(filterApproversByQuery(users, 'NARIN@EXAMPLE').map((u) => u.id), ['b'])
  })

  it('matches optional role and level metadata', () => {
    assert.deepEqual(filterApproversByQuery(users, 'procurement').map((u) => u.id), ['a'])
    assert.deepEqual(filterApproversByQuery(users, 'level 3').map((u) => u.id), ['c'])
  })

  it('returns all users for whitespace and none for a miss without mutating order', () => {
    assert.deepEqual(filterApproversByQuery(users, '   '), users)
    assert.deepEqual(filterApproversByQuery(users, 'no-match'), [])
  })

  it('accepts user shapes without role or level', () => {
    const minimal = [{ id: 'x', name: 'Somchai', email: 'somchai@example.com' }]
    assert.deepEqual(filterApproversByQuery(minimal, 'somchai'), minimal)
  })
})
```

Run and verify RED because the helper does not exist.

- [ ] **Step 2: Implement the minimal pure helper**

Create `src/lib/approver-search.ts` using trimmed lowercase normalization. Build each searchable string from name, email, optional role, raw numeric level, and `Level ${level}`. Use one `.filter()` pass; do not mutate or sort input.

- [ ] **Step 3: Run helper tests GREEN**

```bash
npx tsx --test tests/regression/approver-search.test.ts
```

Expected: all pure behavior tests pass.

- [ ] **Step 4: Write the failing search-field source contract**

Create `tests/regression/custom-approval-picker-search.test.ts` and assert the new component contains:

- an accessible label or `aria-label` containing `Search approvers`;
- placeholder `Search by name, email, role, or level`;
- `role="status"` and `aria-live="polite"`;
- visible singular/plural result text;
- a minimum 44px input target and visible `focus-visible` state.

Run and verify RED because the component does not exist.

- [ ] **Step 5: Implement the thin presentation component**

Create `approver-search-field.tsx` as a controlled component with `inputKind="input"` by default. The default variant uses the existing `Input` and Lucide `Search`; `inputKind="command"` renders the existing `CommandInput` so the shared solution picker retains cmdk keyboard behavior. Both variants use the same label/placeholder/count shell. The component owns no picker-open state, filtering, selected IDs, or workflow callback. Render the visible count next to/below the input and pass `inputRef`/`autoFocus` through.

- [ ] **Step 6: Run diagnostics and both focused tests**

Run primary LSP diagnostics on the helper and component, then:

```bash
npx tsx --test \
  tests/regression/approver-search.test.ts \
  tests/regression/custom-approval-picker-search.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit the shared search seam**

```bash
git add \
  src/lib/approver-search.ts \
  src/components/approvals/approver-search-field.tsx \
  tests/regression/approver-search.test.ts \
  tests/regression/custom-approval-picker-search.test.ts
git commit -m "feat: add approver search primitives"
```

---

### Task 8: Search the Shared Solution Approval Picker

**Files:**

- Modify: `src/components/solutions/custom-approval-picker.tsx`
- Modify: `tests/regression/custom-approval-picker-search.test.ts`

**Interfaces:**

- Consumes: `filterApproversByQuery`, `ApproverSearchField`, existing `users`, `selectedIds`, `currentUserId`, and `onChange`.
- Preserves: self/selected exclusion, ordered selected list, move/remove behavior, disabled trigger, and Popover.
- Produces: external filtering with `Command shouldFilter={false}`, bounded `CommandList`, level metadata, live count, reset on select/close, exact empty copy `No approvers found`, and `export { CustomApprovalPicker as SharedApprovalPickerHarness }` for the environment-gated test page.

- [ ] **Step 1: Add failing shared-picker contracts**

Assert the source:

- imports both shared search primitives;
- still exports `CustomApprovalPicker` and adds only the explicit alias `SharedApprovalPickerHarness` for the test harness;
- still excludes `currentUserId` and `selectedIds`;
- uses `Command shouldFilter={false}` and `CommandList`;
- renders `<ApproverSearchField inputKind="command"` so `CommandInput` remains in use;
- includes `No approvers found`;
- bounds the list with `max-h-[260px] overflow-y-auto`;
- displays level metadata when non-null;
- uses an `onOpenChange` handler that clears search when closing;
- clears search after selection;
- does not contain `No users found.`.

Run and verify RED.

- [ ] **Step 2: Replace local filtering with the pure helper**

Compute:

```ts
const filteredUsers = filterApproversByQuery(availableUsers, searchValue)
```

Keep exclusion before search. Replace the direct `CommandInput` instance with `<ApproverSearchField inputKind="command" ... />`; that variant still renders the existing `CommandInput`. Use `Command shouldFilter={false}` so cmdk does not apply a second name/value filter. Render results inside `CommandList className="max-h-[260px] overflow-y-auto"`.

- [ ] **Step 3: Distinguish search miss from exhausted selection**

Keep the Add Approver trigger disabled when `availableUsers.length === 0`, but expose the exhausted state next to the disabled trigger so it is visible without opening an impossible popover:

```tsx
{availableUsers.length === 0 && (
  <p className="text-xs text-muted-foreground">No more users available</p>
)}
```

When available users exist but `filteredUsers.length === 0`, render exactly:

```tsx
<CommandEmpty>No approvers found</CommandEmpty>
```

Do not show `No approvers found` merely because all users are selected. Add source and harness assertions for both exact states.

- [ ] **Step 4: Reset search and preserve selection behavior**

Use:

```ts
const handleOpenChange = (nextOpen: boolean) => {
  setOpen(nextOpen)
  if (!nextOpen) setSearchValue('')
}
```

Pass it to Popover. Keep the existing selection reset and add level metadata next to email without changing `onChange` order. Remove only the unrelated console logging from move handlers if it remains; do not alter their swaps.

- [ ] **Step 5: Add the explicit harness alias without changing production callers**

After the component declaration, add:

```ts
export { CustomApprovalPicker as SharedApprovalPickerHarness }
```

This is the same real picker, not a duplicate. Existing `CustomApprovalPicker` imports remain unchanged.

- [ ] **Step 6: Run diagnostics and focused tests**

Run primary LSP diagnostics on the picker, then both search test files. Expected: all pass.

- [ ] **Step 7: Commit the shared picker**

```bash
git add src/components/solutions/custom-approval-picker.tsx tests/regression/custom-approval-picker-search.test.ts
git commit -m "feat: search solution approval hierarchy"
```

---

### Task 9: Search the Three Live Modal Hierarchy Pickers

**Files:**

- Modify: `src/components/requests/submitter-modal.tsx`
- Modify: `src/components/requests/submit-final-approval-modal.tsx`
- Modify: `src/components/requests/final-approval-resubmit-modal.tsx`
- Modify: `tests/regression/custom-approval-picker-search.test.ts`

**Interfaces:**

- Consumes: each file-private `CustomApprovalPicker`, `filterApproversByQuery`, and `ApproverSearchField`.
- Preserves: all three file-private pickers, parent-supplied current-user filtering, selected exclusion, add/remove/reorder, custom hierarchy toggles, and submit/restart callbacks.
- Produces: matching live pickers with visible search/count, bounded result list, exact search miss/exhausted states, close/select reset, focus on open, and one explicit harness alias per real local picker.

- [ ] **Step 1: Add failing per-file source contracts**

For each live modal path, assert:

- it still declares a file-private `function CustomApprovalPicker`;
- imports the shared helper and field;
- has local `searchQuery` state and an input ref;
- computes unselected users first, then filters by query;
- renders `ApproverSearchField`;
- includes both exact strings `No approvers found` and `No more users available`;
- uses a bounded result wrapper such as `max-h-[260px] overflow-y-auto`;
- clears query after selection and on backdrop/toggle close;
- exports the same local component under a unique harness name: `SubmitterApprovalPickerHarness`, `SubmitFinalApprovalPickerHarness`, or `FinalApprovalResubmitPickerHarness`.

Run and verify RED.

- [ ] **Step 2: Implement one picker fully in `submitter-modal.tsx`**

Add:

```ts
const [searchQuery, setSearchQuery] = useState('')
const searchInputRef = useRef<HTMLInputElement>(null)
const unselectedUsers = availableUsers.filter((user) => !selectedApprovers.includes(user.id))
const filteredUsers = filterApproversByQuery(unselectedUsers, searchQuery)
```

Use one `setPickerOpen(nextOpen)` helper that updates `isOpen`, clears search on close, and focuses the input with `requestAnimationFrame` when opening. Because `submitter-modal.tsx` already imports `useRef`, reuse it; add `useRef` to the React imports in the other two modal files. Render `ApproverSearchField`, then a separate bounded results region.

State rules:

```tsx
unselectedUsers.length === 0
  ? <p>No more users available</p>
  : filteredUsers.length === 0
    ? <p>No approvers found</p>
    : filteredUsers.map(...)
```

On selection: preserve `addApprover(user.id)`, then close/reset. Backdrop closes through the same helper. Add this module-scope alias in the same red/green cycle:

```ts
export { CustomApprovalPicker as SubmitterApprovalPickerHarness }
```

- [ ] **Step 3: Run focused tests for the first live picker**

Run the picker source-contract test and verify only the other two modal files still fail.

- [ ] **Step 4: Apply the same search seam to final approval submission**

Implement the same state ordering and exact state copy in `submit-final-approval-modal.tsx`. Add `export { CustomApprovalPicker as SubmitFinalApprovalPickerHarness }` at module scope. Do not copy workflow submit code or extract the whole picker to a shared component.

- [ ] **Step 5: Apply the same search seam to final approval resubmission**

Implement the same state ordering and exact state copy in `final-approval-resubmit-modal.tsx`, preserving `onRestart` and all rejection/resubmission presentation. Add `export { CustomApprovalPicker as FinalApprovalResubmitPickerHarness }` at module scope.

- [ ] **Step 6: Run diagnostics and all search tests**

Run primary LSP diagnostics on the three large modal files, then:

```bash
npx tsx --test \
  tests/regression/approver-search.test.ts \
  tests/regression/custom-approval-picker-search.test.ts
```

Expected: all pass; each workflow still has its own picker implementation.

- [ ] **Step 7: Commit the live modal pickers**

```bash
git add \
  src/components/requests/submitter-modal.tsx \
  src/components/requests/submit-final-approval-modal.tsx \
  src/components/requests/final-approval-resubmit-modal.tsx \
  tests/regression/custom-approval-picker-search.test.ts
git commit -m "feat: search modal approval hierarchies"
```

---

### Task 10: Search Parity for the Legacy Solution Picker

**Files:**

- Modify: `src/components/requests/solution-modal.tsx`
- Modify: `tests/regression/custom-approval-picker-search.test.ts`

**Interfaces:**

- Consumes: the existing file-private expanded `CustomApprovalPicker`, pure search helper, and search field.
- Preserves: expanded Switch, selected order, move/remove, grid add buttons, and file-private implementation.
- Produces: search/count/result states when expanded; query resets on selection and collapse; `SolutionModalApprovalPickerHarness` aliases the same real local picker for interaction tests.

- [ ] **Step 1: Add the failing legacy-picker contract**

Assert `solution-modal.tsx` still contains its local `CustomApprovalPicker`, imports search primitives, renders the shared field inside the expanded block, includes both search miss and exhausted copy, bounds the list, and clears query when the hierarchy collapses or a user is selected. Run and verify RED.

- [ ] **Step 2: Add search without changing the legacy workflow surface**

Add `searchQuery`, compute `availableUsers` as today, then `filteredUsers`. Replace the raw `availableUsers.map` with:

- `No more users available` when `availableUsers.length === 0`;
- `No approvers found` when query-filtered results are empty;
- filtered add buttons otherwise.

Include email and role in visible result metadata. Keep the Switch/header and move/remove implementation intact. Clear query when `setIsExpanded(false)` and after selecting an approver. Add the same real picker alias at module scope:

```ts
export { CustomApprovalPicker as SolutionModalApprovalPickerHarness }
```

Do not replace the local implementation or production modal wiring.

- [ ] **Step 3: Run diagnostics and all search tests**

Run primary LSP diagnostics on `solution-modal.tsx`, then both search tests. Expected: all five covered picker flows are represented and green.

- [ ] **Step 4: Commit legacy parity**

```bash
git add src/components/requests/solution-modal.tsx tests/regression/custom-approval-picker-search.test.ts
git commit -m "feat: align legacy hierarchy search"
```

---

### Task 11: Docker-Backed Responsive Browser Acceptance

**Files:**

- Modify: `tests/e2e/desktop-ux-refresh.spec.ts` (authored before production in Task 1)
- Create: `src/app/test-harness/hierarchy-pickers/page.tsx`
- Create: `src/app/test-harness/hierarchy-pickers/hierarchy-picker-harness-client.tsx`
- Verify: all implementation files from Tasks 2–10
- Do not modify: database schema, migrations, seed, or persistent request data

**Interfaces:**

- Consumes: the committed source tree, existing `approval-db`, existing test accounts (for example `admin@example.com` / `changeme` when available), and `TEST_BASE_URL`.
- Produces: read-only responsive and interaction evidence at 1600px, 1280px, 900px, and 390px widths.

- [ ] **Step 1: Verify the acceptance test remains the observed-RED contract**

Confirm `tests/e2e/desktop-ux-refresh.spec.ts` is the same file authored and observed RED in Task 1. Do not rewrite assertions to match production output.

- [ ] **Step 2: Create the environment-gated server route**

Create `src/app/test-harness/hierarchy-pickers/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { HierarchyPickerHarnessClient } from './hierarchy-picker-harness-client'

export const dynamic = 'force-dynamic'

export default function HierarchyPickerHarnessPage() {
  if (process.env.E2E_UI_HARNESS !== '1') notFound()
  return <HierarchyPickerHarnessClient />
}
```

`dynamic = 'force-dynamic'` makes the runtime environment check authoritative instead of allowing build-time static rendering to bake in a 404. The route remains unavailable in normal deployments.

- [ ] **Step 3: Create deterministic client fixtures using all five real picker exports**

Create `hierarchy-picker-harness-client.tsx` with `'use client'`. Import the five harness aliases from Tasks 8–10. Define deterministic users containing name, email, role, and level, then render one labeled `<section data-picker-fixture="…">` per real picker. Each fixture owns only selected-ID state and passes `onChange`; include a fixture control that preselects every user so the exact exhausted state can be asserted. The harness must not import or call server actions, fetch APIs, or write storage/database state.

- [ ] **Step 4: Run primary diagnostics on both harness files**

Expected: no TypeScript errors and every harness alias resolves to its real implementation.

- [ ] **Step 5: Build a clean temporary image without migrations or seeds**

Use Docker explicitly:

```bash
DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
IMAGE="approval-app-desktop-ux:$(git rev-parse --short HEAD)"
CONTAINER="approval-app-desktop-ux-$(git rev-parse --short HEAD)"

"$DOCKER" build -t "$IMAGE" .
"$DOCKER" run -d --rm \
  --name "$CONTAINER" \
  --network approvalappv3_standalone_default \
  -p 3101:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL='postgresql://postgres:changeme@approval-db:5432/app_db?schema=public' \
  -e NEXTAUTH_URL='http://127.0.0.1:3101' \
  -e NEXTAUTH_SECRET='desktop-ux-verification-only' \
  -e UPLOAD_DIR='/tmp/uploads' \
  -e E2E_UI_HARNESS='1' \
  "$IMAGE"
```

The inspected `Dockerfile` runner command is `npx next start`; it does not run migrations or seeds. Do not run `prisma migrate`, `prisma db push`, or any seed command.

- [ ] **Step 6: Wait for health and load agent-browser guidance**

Run:

```bash
curl --fail --retry 30 --retry-delay 2 http://127.0.0.1:3101/api/health
agent-browser skills get core
```

Use a named isolated agent-browser session. Capture desktop, tablet, and phone screenshots in `/tmp/approval-desktop-ux-verification/`.

- [ ] **Step 7: Run automated browser acceptance**

```bash
TEST_BASE_URL=http://127.0.0.1:3101 \
E2E_ADMIN_EMAIL=admin@example.com \
E2E_ADMIN_PASSWORD=changeme \
npx playwright test tests/e2e/desktop-ux-refresh.spec.ts --project=chromium
```

Expected: all non-mutating responsive, Select, keyboard, and five-picker harness scenarios pass. The harness supplies deterministic picker data, so picker interaction coverage must not depend on a particular request state in the existing database.

- [ ] **Step 8: Perform visual acceptance with agent-browser**

At minimum inspect:

- `/requests` at 1720×1000 and 1280×900;
- `/requests/my-actions`, `/engineering` or `/dashboard`, `/analytics`, `/budget-monitor`, and `/admin/users` at desktop width;
- `/requests` at 900×900 and 390×844;
- Department/Requester Radix dropdown open state;
- all five labeled fixtures on `/test-harness/hierarchy-pickers`, including search, live result count, no-result, exhausted, select-reset, and close-reset states.

Acceptance: clean white theme, aligned edges, materially wider operational canvas, no link wrapping/clipping, no horizontal page overflow, no native dropdown, dates remain one line, mobile cards/navigation retain behavior.

- [ ] **Step 9: Stop temporary resources**

```bash
"$DOCKER" stop "$CONTAINER"
"$DOCKER" image rm "$IMAGE"
```

Confirm `approval-db` remains healthy and no migration/seed container ran.

- [ ] **Step 10: Verify the acceptance spec and harness pass against the final container, then commit them**

```bash
git add \
  tests/e2e/desktop-ux-refresh.spec.ts \
  src/app/test-harness/hierarchy-pickers/page.tsx \
  src/app/test-harness/hierarchy-pickers/hierarchy-picker-harness-client.tsx
git commit -m "test: cover desktop UX refresh acceptance"
```

---

### Task 12: Full Verification, Graph Refresh, and Independent Review

**Files:**

- Verify: every source/test file listed above
- Update: `graphify-out/` through `graphify update .`
- Do not stage: unrelated pre-existing working-tree changes or `.pi*` artifacts

**Interfaces:**

- Consumes: all commits from Tasks 1–11.
- Produces: fresh diagnostics, green repository checks, formatting evidence, current graph, Docker/browser evidence, and an independent review with no Critical or Important findings.

- [ ] **Step 1: Run primary LSP diagnostics on every touched source file**

Use one bounded `lsp_diagnostics` call over all touched TS/TSX files with `serverScope: "primary"` and `severity: "all"`. Expected: no TypeScript errors.

- [ ] **Step 2: Run focused regression suites together**

```bash
npx tsx --test \
  tests/regression/authenticated-shell-navbar.test.ts \
  tests/regression/requests-desktop-ux.test.ts \
  tests/regression/approver-search.test.ts \
  tests/regression/custom-approval-picker-search.test.ts \
  tests/regression/profile-menu.test.ts \
  tests/regression/gap-improvements.test.ts
```

Expected: all pass with zero failures.

- [ ] **Step 3: Run the required repository gate**

```bash
npm run check
```

Expected: TypeScript, manager tests, and all regression tests pass.

- [ ] **Step 4: Run session diagnostics and patch hygiene**

```text
lens_diagnostics({ mode: "all", severity: "all" })
```

Then:

```bash
git diff --check
git status --short
git diff --exit-code -- src/components/ui/select.tsx src/components/mobile/request-card.tsx
```

Expected: no blocking diagnostics, no whitespace errors, no changes to Select/mobile card, and unrelated pre-existing changes still present but unstaged/unmodified by this feature.

- [ ] **Step 5: Refresh Graphify**

```bash
graphify update .
```

Expected: successful incremental update without graph-health corruption warnings. Because `graphify-out/` is currently untracked by Git, do not add it wholesale. Inspect:

```bash
git status --short graphify-out
git ls-files graphify-out
```

If `git ls-files graphify-out` remains empty, leave generated output untracked. If tracked graph files exist in the execution worktree, review `git diff --name-only -- graphify-out`, stage only those exact reviewed tracked paths with `git add -- <path...>`, and commit them. Never run `git add graphify-out`, and do not make an empty commit.

- [ ] **Step 6: Request independent code review**

Dispatch a fresh-context reviewer over the feature base SHA through HEAD. Provide:

- approved spec: `docs/superpowers/specs/2026-08-12-desktop-ux-refresh-design.md`;
- this plan;
- the exact base/head SHAs;
- constraints on Select/mobile/server behavior;
- focused/full test and Docker evidence.

Ask for evidence-backed Critical/Important/Minor findings across correctness, regressions, accessibility, responsive behavior, performance, and test adequacy. Do not let the reviewer edit.

- [ ] **Step 7: Resolve all Critical and Important findings through TDD**

For every accepted finding: add/adjust a failing focused test, observe RED, apply the smallest production fix, rerun GREEN, then rerun `npm run check`. Stage only the exact reviewed source/test paths changed for that finding and commit them with a focused message; never use `git add .` or `git add -A`. If a finding is invalid, record the technical reason and evidence rather than changing code.

- [ ] **Step 8: Run final verification and refresh Graphify after review fixes**

Freshly rerun:

```bash
npm run check
git diff --check
```

Run `lens_diagnostics({ mode: "all", severity: "all" })` and rerun the Docker/browser acceptance from Task 11 if any review fix touched UI behavior or responsive classes.

Then rerun:

```bash
graphify update .
git status --short graphify-out
git ls-files graphify-out
```

Apply the same safe Graphify rule from Step 5: leave output untracked when no Graphify files are tracked; otherwise stage only exact reviewed tracked graph paths and commit them. This final refresh, not the pre-review refresh, is the delivery graph state.

- [ ] **Step 9: Record delivery evidence**

Report:

- exact focused and full test totals;
- diagnostics result;
- `git diff --check` result;
- confirmation `select.tsx` and `request-card.tsx` stayed unchanged;
- Graphify update result;
- Docker image/container/base URL used and confirmation that no migration/seed ran;
- responsive widths and routes checked;
- hierarchy flows reached and any database-state limitation;
- reviewer result and residual Minor/deferred risks;
- commit list and final branch/worktree status.
