# Add Sub-Unit From the Organization Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering a unit card in the organization tree reveals a "+ Add unit" button below the card that opens a small popover to name and create a child unit.

**Architecture:** A new `AddChildUnitPopover.tsx` holds a presentational form view plus a stateful Radix popover that calls the existing `createOrganizationUnit` server action. `TreeNodeRow.tsx` renders it inside each unit `article` and owns the open state, so the "⋯" menu can open the same popover. Reveal-on-hover is plain CSS in `globals.css`, next to the existing `organization-*` flowchart rules.

**Tech Stack:** Next.js (app router), React, Radix Popover (`src/components/ui/popover.tsx`), Tailwind 3.4, `node:test` + `renderToStaticMarkup`, esbuild + Playwright chromium for browser regressions.

**Spec:** `docs/superpowers/specs/2026-11-16-tree-add-sub-unit-design.md`

## Global Constraints

- No server, schema or migration changes, and no new dependencies.
- No change to the page-header "Create unit" dialog (`CreateUnitDialog.tsx`).
- Keep every existing tree test identifier and the connector layout intact.
- Do not call `useRouter` in tree components: `TreeNodeRow` is rendered by `renderToStaticMarkup` tests, and the server action already revalidates `/admin/organization`.
- Do not add a bare `group` class to the unit `article`: the header's `group-hover:` strip would then reveal on any card hover.
- Exact copy: button `+ Add unit`; popover title `New unit under {parent name}`; field label `Unit name`; buttons `Create` and `Cancel`; menu item `Add unit`.
- Run `npm run check` after code changes, then `graphify update .`.

## Review Focus

- **Double submit:** pressing Enter twice while a save is running creates exactly one unit.
- **Whitespace-only name:** Create stays disabled and Enter does nothing.
- **Manage drawer:** clicking "+ Add unit" or anything inside the popover never calls `onSelectUnit`.
- **Bottom-most card:** revealing the button on the lowest card adds no scrollbar to `.organization-flowchart`.
- **Pointer leaves while open:** the button stays visible while its popover is open, and the popover is placed below the button when the canvas is scaled.

---

### Task 1: Add-child-unit form and popover component

**Files:**
- Create: `src/components/organization/AddChildUnitPopover.tsx`
- Test: `tests/regression/tree-add-child-unit-form.test.ts`

**Interfaces:**
- Consumes: `createOrganizationUnit(input: { name: string; parentId: string }): Promise<{ id: string }>` from `@/server-actions/organization`; `Popover`, `PopoverAnchor`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover`.
- Produces:
  - `AddChildUnitFormView(props: { parentName: string; name: string; error: string | null; saving: boolean; onNameChange?: (name: string) => void; onSave?: () => void; onCancel?: () => void }): React.JSX.Element`
  - `AddChildUnitPopover(props: { unit: { id: string; name: string }; open: boolean; onOpenChange: (open: boolean) => void; onCreated?: () => void }): React.JSX.Element`
  - Test identifiers: `add-child-unit-form`, `add-child-unit-name-input`, `add-child-unit-error`, `add-child-unit-save`, `add-child-unit-cancel`, `unit-add-child-{unitId}` (button), `unit-add-child-slot-{unitId}` (button wrapper), `unit-add-child-anchor-{unitId}` (popover anchor).

- [ ] **Step 1: Write the failing test** in `tests/regression/tree-add-child-unit-form.test.ts`, using the `renderToStaticMarkup` harness from `tests/regression/clean-start-ui-create-unit.test.ts`.

```ts
describe('AddChildUnitFormView', () => {
  it('titles the form with the parent name and labels the single name field', () => {
    // parentName 'QC Section', name '' -> html contains 'New unit under QC Section',
    // a <label> 'Unit name' bound to add-child-unit-name-input, and no parent picker
    // (no data-testid="create-unit-parent-select").
  })
  it('disables Create for a blank or whitespace-only name', () => {
    // name '' and name '   ' -> add-child-unit-save has the disabled attribute
  })
  it('enables Create once a name is typed', () => {
    // name 'Line 1' -> add-child-unit-save has no disabled attribute; input value="Line 1"
  })
  it('disables Create and Cancel while saving', () => {
    // name 'Line 1', saving true -> both buttons disabled
  })
  it('shows the server error as an alert and keeps the typed name', () => {
    // error 'Name must be unique among sibling units' -> role="alert"
    // data-testid="add-child-unit-error" with that text; input value="Line 1"
  })
  it('renders no error element when there is no error', () => {})
  it('is a form, so Enter submits', () => {
    // root element of add-child-unit-form is <form
  })
})

describe('AddChildUnitPopover', () => {
  it('renders the trigger button and anchor while closed, without the form', () => {
    // unit { id: 'qc', name: 'QC Section' }, open false -> html has
    // unit-add-child-qc with text '+ Add unit' and type="button",
    // unit-add-child-slot-qc with class organization-unit-add-child and data-open="false",
    // unit-add-child-anchor-qc with aria-hidden="true",
    // and no add-child-unit-form.
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test tests/regression/tree-add-child-unit-form.test.ts`
Expected: FAIL, cannot find module `@/components/organization/AddChildUnitPopover`.

- [ ] **Step 3: Implement `AddChildUnitFormView`** in `src/components/organization/AddChildUnitPopover.tsx` (`'use client'`).

A `<form data-testid="add-child-unit-form">` whose `onSubmit` prevents default and calls `onSave` only when `name.trim()` is non-empty and `saving` is false. Create is `type="submit"`, Cancel is `type="button"`. The title must wrap long parent names (`break-words`). Reuse `Input`, `Label`, `Button` as `CreateUnitDialogView` does.

- [ ] **Step 4: Implement `AddChildUnitPopover`** in the same file.

- Controlled `<Popover open={open} onOpenChange={...}>`.
- Wrapper `<div data-testid="unit-add-child-slot-{id}" data-open={String(open)} className="organization-unit-add-child">` containing `<PopoverTrigger asChild>` around a small outline `Button` (`type="button"`, height `1.5rem`, `text-xs`, solid `bg-background`).
- A separate `<PopoverAnchor asChild>` around `<span aria-hidden="true" data-testid="unit-add-child-anchor-{id}" className="organization-unit-add-child-anchor" />`. The popover positions against this span, not the button, because the button is `display: none` on touch devices.
- `<PopoverContent side="bottom" align="center" className="w-72">` renders `AddChildUnitFormView`; the name input receives focus on open.
- Local state `name`, `error`, `saving`. Save calls `createOrganizationUnit({ name: name.trim(), parentId: unit.id })`. On success: clear state, `onOpenChange(false)`, `onCreated?.()`. On failure: set `error` to the message and keep `name`. Ignore a save request while `saving` is true.
- Closing by any route (Cancel, Esc, outside click) clears `name` and `error`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx --test tests/regression/tree-add-child-unit-form.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/organization/AddChildUnitPopover.tsx tests/regression/tree-add-child-unit-form.test.ts
git commit -m "feat: add child-unit name popover for the organization tree"
```

---

### Task 2: Wire the button into the tree and reveal it on hover

**Files:**
- Modify: `src/components/organization/TreeNodeRow.tsx` (the `TreeNodeRow` component: state near line 333, `DropdownMenuContent` near line 478, end of the `article` near line 540)
- Modify: `src/app/globals.css` (the `.organization-unit-card` rule near line 798 and the flowchart block that follows)
- Test: `tests/regression/tree-add-child-unit-wiring.test.ts` (markup and CSS contracts)
- Test: `tests/regression/tree-add-child-unit-clicks.test.ts` (real browser)

**Interfaces:**
- Consumes: `AddChildUnitPopover` and its test identifiers from Task 1.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing markup and CSS test** in `tests/regression/tree-add-child-unit-wiring.test.ts`. Render `OrganizationTree` with `renderToStaticMarkup`, using a fixture like the one in `tests/regression/clean-start-ui-tree.test.ts` plus one inactive unit.

```ts
it('renders one + Add unit button per active unit, inside that unit\'s own card', () => {
  // for each of company, ops, section-a, section-b:
  //   exactly one data-testid="unit-add-child-{id}" in the whole html,
  //   and it sits inside the <article data-testid="unit-card-{id}"> ... </article> slice
  // for the inactive unit: no unit-add-child-{id}
})
it('keeps the button out of the header so header clicks and hover strip are unchanged', () => {
  // the unit-header-{id} slice does not contain unit-add-child-
})
it('offers Add unit in the overflow menu', () => {
  // source contract on TreeNodeRow.tsx: /<DropdownMenuItem[^>]*>Add unit<\/DropdownMenuItem>/
})
it('does not put a bare group class on the unit card', () => {
  // class of unit-card-ops does not match /(^|\s)group(\s|$)/
})
it('hides the button at rest and reveals it without shifting layout', () => {
  // globals.css contracts:
  //   .organization-unit-card            -> position: relative
  //   .organization-unit-add-child       -> position: absolute; display: none;
  //                                         top: calc(100% - 0.25rem); left: 50%
  //   .organization-unit-card:hover > .organization-unit-add-child         -> display: flex
  //   .organization-unit-card:focus-within > .organization-unit-add-child  -> display: flex
  //   .organization-unit-add-child[data-open="true"]                       -> display: flex
  //   @media (pointer: coarse) ... .organization-unit-add-child -> display: none !important
  //   .organization-unit-add-child-anchor -> position: absolute; top: calc(100% + 1.25rem);
  //                                          left: 50%; width: 0; height: 0
})
```

- [ ] **Step 2: Write the failing browser test** in `tests/regression/tree-add-child-unit-clicks.test.ts`, copying the esbuild + chromium harness from `tests/regression/org-chart-rename-clicks.test.ts`.

Harness: load the real `src/app/globals.css` text into the page with `addStyleTag`. Mount a parent `qsec` with child `qc` inside `<div class="organization-flowchart">`, with an `opens` counter on `onSelectUnit`. Stub `server-actions/organization` so `createOrganizationUnit(input)` pushes `input` to `window.__created`, waits 150 ms, and throws `new Error('Name must be unique among sibling units')` when `input.name === 'Dup'`. Emulate a fine pointer (desktop chromium default).

```ts
it('+ Add unit is hidden at rest and appears only for the hovered card', async () => {
  // at rest: unit-add-child-qc and unit-add-child-qsec are not visible
  // hover unit-card-qc -> unit-add-child-qc visible, unit-add-child-qsec not visible
  // card boxes of qsec and qc are identical before and during hover (no layout shift)
  // .organization-flowchart scrollHeight === clientHeight while qc (bottom-most) is hovered
})
it('creates a child of the hovered unit from the popover', async () => {
  // hover qc, click unit-add-child-qc -> add-child-unit-name-input visible and focused,
  //   popover text contains 'New unit under QC Section'
  // move the mouse to (0, 0) -> unit-add-child-qc still visible (popover open)
  // popover top >= button bottom, also when the tree is wrapped in transform: scale(0.5)
  // press Enter with an empty and then a '   ' value -> window.__created stays []
  // fill 'Line 1', press Enter twice quickly ->
  //   window.__created deep-equals [{ name: 'Line 1', parentId: 'qc' }]
  //   and the popover closes
  // opens counter stays '0' throughout
})
it('keeps the typed name and shows the error when the server rejects it', async () => {
  // fill 'Dup', Enter -> add-child-unit-error has 'Name must be unique among sibling units',
  //   input still has 'Dup', popover still open, Create enabled again
  // Escape -> popover closed; reopen -> input empty, no error
})
it('opens the same popover from the overflow menu and keeps it open', async () => {
  // click unit-overflow-qc, click menu item 'Add unit' ->
  //   add-child-unit-name-input visible and focused 300 ms later; opens stays '0'
})
it('expands a collapsed parent after a child is created', async () => {
  // click unit-toggle-qsec (collapse) -> unit-children-qsec hidden
  // add 'Line 2' under qsec -> unit-children-qsec no longer has the hidden attribute
})
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npx tsx --test tests/regression/tree-add-child-unit-wiring.test.ts tests/regression/tree-add-child-unit-clicks.test.ts`
Expected: FAIL, no `unit-add-child-*` elements exist.

- [ ] **Step 4: Wire `AddChildUnitPopover` into `TreeNodeRow`**

- Add `const [addOpen, setAddOpen] = useState(false)` beside `expanded`.
- Render `<AddChildUnitPopover unit={unit} open={addOpen} onOpenChange={setAddOpen} onCreated={() => setExpanded(true)} />` as the last child of the `article`, after the people block, so it is last in the card's tab order.
- Add `<DropdownMenuItem onSelect={() => setAddOpen(true)}>Add unit</DropdownMenuItem>` after "Manage". If the browser test shows the menu's focus return closing the popover or stealing input focus, cancel that focus return for this selection with `onCloseAutoFocus` on `DropdownMenuContent`.

- [ ] **Step 5: Add the CSS** to `src/app/globals.css`, directly after the `.organization-unit-card` rule, with the exact values asserted in Step 1.

Also give the slot `transform: translateX(-50%)` and `z-index: 1` so the button is centered and paints over the connector stem. The `calc(100% - 0.25rem)` offset overlaps the card edge by 4px, which bridges the hover and keeps the 1.5rem button inside the flowchart's 1.5rem bottom padding.

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `npx tsx --test tests/regression/tree-add-child-unit-wiring.test.ts tests/regression/tree-add-child-unit-clicks.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 7: Run the full check**

Run: `npm run check`
Expected: `tsc` clean and every regression test passing, including `flowchart-organization-ui`, `flowchart-readability`, `clean-start-tree-hierarchy` and `org-chart-rename-clicks`.

- [ ] **Step 8: Update the graph and commit**

```bash
graphify update .
git add src/components/organization/TreeNodeRow.tsx src/app/globals.css tests/regression/tree-add-child-unit-wiring.test.ts tests/regression/tree-add-child-unit-clicks.test.ts
git commit -m "feat: add sub-units from the organization tree on hover"
```
