# Budget Monitor Table Redesign

## Goal

Replace the Budget Monitor drag-and-drop assignment UI with a tabbed, table-first layout from `~/Downloads/budget-assignment_v2.html`, without changing request forms, approval workflows, visibility rules, or usage calculations.

Users assign requests with a Group select. They monitor budget codes on a separate tab. They can paste budget code / name / amount rows to upsert codes. Reports remains the existing filtered XLSX export.

## Source mockup

Canonical layout: `~/Downloads/budget-assignment_v2.html`.

The earlier `budget-assignment.html` is superseded. Ignore its Import Excel control and its single-page (no tabs) desktop layout.

This is a UI and data-field redesign of `/budget-monitor`. It is not a new product.

## Locked decisions

- Approach A: new page IA, same server contract.
- Keep create/edit budget code, project-estimate edit, unassign, visibility, and usage rules.
- Assignment is a Group select. No drag-and-drop on this page.
- Remove the remaining-request side panel.
- No Excel file import.
- Paste upserts budget codes only. Columns: budget code, budget code name, budget amount.
- Name and amount are required on paste rows and on create/edit.
- Reports is the existing filtered XLSX download, restyled as a Reports button.
- Tabs on every breakpoint: Budget by department | All requests.
- Default tab: Budget by department. Persist the last tab in `localStorage`.
- Health pills are display-only. They do not block assignment.
- Stay on the existing dashboard / shadcn look. Do not import the mockup serif/oklch brand.

## Out of scope

- Creating or importing requests from a spreadsheet.
- Assigning requests via paste.
- Budget approval workflow, budget-owner permissions, or activity-timeline entries.
- Blocking or warning dialogs when a code is over budget.
- Date-range filters (already unused in the current UI).
- Removing `@dnd-kit` from the repo (admin hierarchy still uses it).
- Changes to request create/detail/approval/engineering modals.

## Current system (what we keep)

Route: `src/app/(dashboard)/budget-monitor/page.tsx` → `BudgetMonitorPage`.

Server actions in `src/server-actions/budget-control.ts`:

- `getBudgetMonitorData(filters)`
- `assignRequestToBudgetCode`
- `unassignRequestBudgetCode`
- `updateBudgetCodeAmount`
- `updateRequestProjectEstimate`
- `createBudgetCode`
- `exportBudgetMonitorXlsx`

Usage: engineering estimate if present, otherwise `projectEstimateCost`, otherwise 0. See `getBudgetUsageAmount` in `src/lib/budget-control.ts`.

Visibility: unchanged. Users only see requests they can already see. Totals are visibility-scoped.

`@dnd-kit` usage on this page is removed. The package stays for admin hierarchy.

## Page architecture

All breakpoints share one shell:

1. Hero: title “Budget Monitor”, short lead, total remaining.
2. Filter card: search, department, status, Clear, Reports.
3. Tab list: **Budget by department** | **All requests**.
4. One tab panel at a time.

Tab state key: `budget-monitor-view`. Values: `depts` | `requests`. Invalid or missing values open `depts`.

Filters apply to both panels. Changing a filter does not change the active tab.

```
+--------------------------------------------------+
| Budget Monitor                    total remaining|
| Assign requests to a budget code.                |
+--------------------------------------------------+
| [search] [department] [status] [Clear] [Reports] |
+--------------------------------------------------+
| ( Budget by department )  All requests           |
+--------------------------------------------------+
| active panel only                                |
+--------------------------------------------------+
```

On viewports below 768px, the filter card stacks vertically and the Requests panel uses stacked cards instead of an HTML table. Tabs stay the same.

## Budget tab

Group visible budget codes by `budgetCode.department.name`. Codes with no department go under **No department**.

Each department heading shows the department name and group count.

Each budget code is an expandable card (`budget-code-card.tsx`):

- Primary label: `name` (required for new/pasted/edited codes).
- Secondary text: `displayCode` and assigned-request count.
- Display-only health pill:
  - `Over` when `remainingBudget < 0`
  - `Watch` when `budgetAmount > 0` and `remainingBudget / budgetAmount < 0.15`
  - `Healthy` otherwise, including when `budgetAmount` is missing
- Metrics: Budget, Used, Remaining.
- Usage bar: `used / budgetAmount`, clamped 0–100%. Hidden when `budgetAmount` is missing.
- Edit action opens the existing budget-code edit dialog (now with required name + amount).
- Expanded body lists assigned requests that match current filters: title, status, usage amount.

Cards are not drop targets.

Budget-tab actions (beside the department summary):

- Paste budget codes
- New budget code

## Requests tab

One list of visible requests, split into two sections:

- **Unassigned** — expanded by default.
- **Assigned** — collapsed by default. Clicking the section header toggles it.

Desktop (>= 768px) columns:

| Request | Department | Group | Status | Cost |
|---|---|---|---|---|

- **Request**: title. Truncate with title tooltip.
- **Department**: request department name, or `—`.
- **Group**: select. First option is Unassigned. Remaining options are every visible budget code, same-department codes first. Option label is `name`, with `displayCode` as secondary/meta text.
- **Status**: existing request status string. Do not invent mock statuses (Open / Assigned / On hold).
- **Cost**: usage amount from `getBudgetProjectEstimateAmount`. If the request has no engineering estimate, the cost cell is the existing edit affordance. If it has an engineering estimate, the value is read-only.

Below 768px, each request is a stacked card with the same fields and a full-width Group select. No horizontal scroll.

Empty filtered state: “No requests match these filters.”

Selecting a budget code calls `assignRequestToBudgetCode`. Selecting Unassigned calls `unassignRequestBudgetCode`. On success, refresh data and toast. On failure, toast the server error and leave the previous value selected.

## Filters

Keep `BudgetMonitorFilters` fields that the UI already uses:

- `budgetCodeSearch` — single search box. Placeholder: “Search budget code or request”. Matches request title, department, status, budget `displayCode`, and budget `name`.
- `departmentId`
- `status`

Clear resets those three to empty. Do not add `dateFrom` / `dateTo` to the UI.

Search also matches `budget_codes.name` through `matchesBudgetMonitorSearch` (extend that helper).

Department filter:

- Budget tab shows only codes in that department (plus no-department codes only when the filter is empty).
- Requests tab shows only requests in that department.

Status filter applies to request rows and to the mini-list inside budget cards. It does not hide a budget card by itself.

## Reports

The Reports button in the filter card calls the existing `exportBudgetMonitorXlsx(filters)` and downloads the file. No preview sheet.

Button label: **Reports**. Same columns and visibility rules as today.

## Paste budget codes

New dialog: `budget-code-paste-dialog.tsx`, opened from the Budget tab.

Input: one textarea. User pastes TSV or CSV (tab, comma, or semicolon). No file picker.

Header row is optional. Detect columns by normalized header aliases:

| Field | Required | Aliases |
|---|---|---|
| code | yes | `code`, `budget code` |
| name | yes | `name`, `budget code name` |
| amount | yes | `amount`, `budget amount` |

If there is no header, treat columns as `code, name, amount` in that order.

Row validation (skip the row, do not abort the batch):

- Missing/blank code, name, or amount.
- Amount not a finite number, negative, or above `MAX_BUDGET_MONEY_AMOUNT`.
- Duplicate code inside the same paste (first valid row wins; later duplicates skipped).

Preview table before write: valid create, valid update, skipped (with reason). Confirm writes only valid rows. Cancel writes nothing.

Server action: `pasteBudgetCodes(rows)`.

Upsert key: `normalizeBudgetCode(code)` against `budget_codes.code`.

- Unknown code: create with `code`, `displayCode` (trimmed original), required `name`, required `budgetAmount`. `departmentId` stays null.
- Existing code: update `name` and `budgetAmount`. Do not change department. Do not assign requests.

Return `{ created, updated, skipped }` for the toast and preview.

Paste never creates requests and never changes `requests.budgetCodeId`.

## Data model

Add to `budget_codes`:

```prisma
name String?
```

Existing rows may have `name = null`. The Budget tab and Group select fall back to `displayCode` as the primary label only for those legacy rows.

After this change, create, edit, and paste cannot write a null/blank name or a null amount.

Extend:

```ts
export interface BudgetCodeSummary {
  id: string
  code: string
  displayCode: string
  name: string | null
  budgetAmount: number | null
  department: { id: string; name: string } | null
}
```

`createBudgetCode` and `updateBudgetCodeAmount` take required `name: string` and required `budgetAmount: number`.

Extend `BudgetMonitorData` with `requests: BudgetRequestRecord[]` — all visible requests after the current filters. Keep `groups` and `remainingRequests` so existing helpers stay valid. The new UI reads `requests` + `groups` only. `remainingRequests` is not rendered. One `getBudgetMonitorData` call still loads the page.

## Components

| File | Responsibility |
|---|---|
| `src/components/budget/budget-monitor-page.tsx` | Shell: hero, filters, tabs, Reports, dialogs, refresh |
| `src/components/budget/budget-department-panel.tsx` | Budget tab |
| `src/components/budget/budget-code-card.tsx` | Expandable code card (replaces droppable box) |
| `src/components/budget/budget-request-table.tsx` | Requests tab: table >=768px, cards below |
| `src/components/budget/budget-code-paste-dialog.tsx` | Paste, preview, confirm |
| `src/components/budget/budget-code-create-dialog.tsx` | Add required name + amount |
| `src/components/budget/budget-code-edit-dialog.tsx` | Add required name; amount required |
| `src/components/budget/budget-search-input.tsx` | Keep |
| `src/components/budget/budget-edit-dialog.tsx` | Keep for project estimate |
| `src/types/budget.ts` | Add `name`; add `requests` on monitor data |
| `src/lib/budget-control.ts` | Search matches `name`; paste parse helper |
| `src/server-actions/budget-control.ts` | `name` on writes; `pasteBudgetCodes` |

Delete after the page no longer imports them:

- `src/components/budget/budget-code-box.tsx`
- `src/components/budget/remaining-request-panel.tsx`

Route file stays a thin server wrapper.

## Visual language

Use existing app tokens (Tailwind + shadcn). Do not copy the mockup’s Iowan/Charter display face or oklch palette.

Follow the mockup’s information architecture: filter card, segmented tabs, department cards, sectioned request table, 44px minimum control height, tabular numbers for money.

Total remaining in the hero is the sum of numeric `remainingBudget` values on visible groups. Groups with `remainingBudget === null` are omitted from the sum. Caption: `total remaining across {n} groups` where `n` is the number of groups included in the sum.

## Error handling

- Paste: invalid rows listed in preview; Confirm writes only valid rows. Empty paste disables Confirm.
- Create/edit: disable save while code, name, or amount is missing or amount is invalid.
- Assign/unassign/edit/paste server errors: toast, do not reset unrelated UI.
- Request disappeared or is no longer visible: existing server error.
- Concurrent budget-amount edits: last write wins, then refresh (same as today).
- Duplicate create of an existing code: existing “select the existing code” behavior; paste treats it as an update.

## Testing

Keep `tests/regression/budget-control.test.ts` coverage for assign, unassign, amount, estimate, usage, visibility, and export.

Replace drag-and-drop assertions in `tests/regression/budget-control-wiring.test.ts` with:

- Tabs `depts` / `requests` exist and only one panel is visible.
- No `DndContext`, `DragOverlay`, or `#budget-monitor-dnd`.
- No remaining-request overlay.
- Group select is the assignment control.
- Reports button calls export.
- Paste dialog is wired.
- Search still uses `budgetCodeSearch` and `matchesBudgetMonitorSearch`.

Add focused tests for:

- Parsing paste text (header aliases, headerless `code,name,amount`, skip invalid / duplicate rows).
- `pasteBudgetCodes` create vs update.
- Rejecting create/edit/paste when name or amount is missing.
- `matchesBudgetMonitorSearch` matches `name`.
- Health pill thresholds: Over, Watch, Healthy.
- Grouping codes with and without a department.

No production Prisma migrations run locally. The `name` column migration is written in the repo and applied only in the environment used for verification.

## Success criteria

- A phone and a desktop can assign and unassign without drag-and-drop.
- Budget monitoring and request assignment are separate tabs on every breakpoint.
- Existing visibility and usage math are unchanged.
- Operators can paste a list of code / name / amount rows and get creates + updates.
- Reports still downloads the current filtered XLSX.
- Wiring tests no longer require the remaining panel or `@dnd-kit` on this page.
