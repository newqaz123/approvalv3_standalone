# Budget Control Design

## Goal

Add budget-code assignment and monitoring without changing the existing request forms, request modals, or approval workflow screens.

The feature gives users a dedicated Budget Monitor page where they can assign visible requests to budget codes, maintain budget-code amounts, monitor usage and remaining budget, and export filtered results to XLSX.

## Scope

In scope:

- New Budget Monitor page.
- New budget-code data model.
- One optional budget code per request.
- One shared budget amount per budget code.
- Optional project estimate cost per request.
- Budget code fuzzy search/filtering.
- Drag-and-drop request assignment into budget-code boxes.
- XLSX export using current filters.
- Visibility based only on requests the user can already see.

Out of scope:

- Blocking or warning when over budget.
- Budget approval workflow.
- Budget owner permissions.
- Activity timeline or audit trail entries for budget edits.
- Changes to existing request create form, request detail modal, approval modals, or engineering submission modal.

## Data Model

Create a new `budget_codes` table:

- `id`
- `code`, unique, case-insensitive normalized for lookup
- `displayCode`
- `budgetAmount`, optional decimal
- `createdAt`
- `updatedAt`

Extend `requests` with:

- `budgetCodeId`, optional relation to `budget_codes`
- `projectEstimateCost`, optional decimal

The existing `solutions.costEstimate` remains the engineering estimate. Monitoring should use the engineering estimate when available. If a request does not yet have an engineering estimate, monitoring should use `projectEstimateCost`.

Because the budget code contains its year, there is no separate budget year field.

## Permissions

Budget Monitor uses existing request visibility rules. A user can only see and assign requests they already have access to through the current system.

Any user who can see a request can:

- Assign or change that request's budget code.
- Clear that request's budget code.
- Edit that request's project estimate cost.
- Type a new budget code, which creates a learned budget-code record.

Any user who can see at least one request using a budget code can edit that budget code's shared `budgetAmount`. Changing it updates the budget amount everywhere that code appears.

No budget-code or project-estimate changes are written to the request activity timeline or audit export.

## Budget Monitor Page

Add a dedicated page, likely `/budget-monitor`, reachable from navigation.

The page has two main areas:

1. Stacked budget-code boxes.
2. Sticky remaining-request side panel.

### Filters

Filters apply to the page and to XLSX export:

- Budget code search/filter.
- Remaining request search.
- Department.
- Status.
- Date range, if consistent with existing request filters.

The budget code filter should support fuzzy search and should make it easy to find learned codes.

### Budget-Code Boxes

Budget-code boxes are stacked vertically, like spreadsheet group sections. Each box has a polished visual design but keeps a dense, operational layout.

Each budget-code box shows:

- Budget code as the heading.
- Shared budget amount.
- Used amount.
- Remaining budget.
- Assigned request count.
- A collapsible/minimize control.
- A drop target for assigning remaining requests.

Expanded boxes show assigned requests in table-style rows with these columns:

- Request.
- Department.
- Status.
- Budget amount.
- Remaining budget.

The column labels should match the user's requested wording where possible. If implementation needs clearer semantics, use tooltips or secondary labels rather than changing the main labels.

Minimized boxes keep the heading and summary totals visible, but hide the request rows and drop area.

### Remaining Request Side Panel

The side panel is sticky and follows user scroll up/down.

It shows only remaining visible requests that do not currently have a budget code assigned. Requests already assigned to a budget code do not appear in this panel.

Each remaining request card shows enough information to assign confidently:

- Request title.
- Department.
- Status.
- Project estimate cost, when present.

The side panel can be minimized/collapsed. In collapsed state it should remain accessible as a compact rail or button showing the remaining request count.

### Assignment Interaction

Users assign budget codes by dragging a remaining request card into a budget-code box.

On drop:

- The request gets that budget code.
- The request disappears from the remaining-request side panel.
- The request appears inside the budget-code box.
- Used and remaining budget update.

Users should also have a non-drag fallback for accessibility and precision, such as a small action on each remaining request card to select a budget code from the fuzzy dropdown.

Users can create a new budget code box from the page. When creating a new code, they can enter:

- Budget code.
- Budget amount.

Users can edit shared budget amount from the budget-code box.

Users can edit project estimate cost from the assigned request row or from a compact edit action.

Users can unassign a request from a budget code. Unassigned requests return to the remaining-request side panel if still visible under current filters.

## Monitoring Calculations

For each visible request assigned to a budget code:

- If an engineering solution cost estimate exists, use that value as usage.
- Otherwise use `projectEstimateCost`.
- If neither value exists, usage is zero.

For each budget code:

- `usedAmount` is the sum of usage across visible assigned requests.
- `remainingBudget` is `budgetAmount - usedAmount`.

The page should make it clear when totals are based only on requests visible to the current user, not necessarily all company requests, because the feature follows existing visibility rules.

## XLSX Export

Add export from the Budget Monitor page.

The export uses active filters and current visibility rules. It should include:

- Budget code.
- Budget amount.
- Used amount.
- Remaining budget.
- Request title.
- Department.
- Status.
- Project estimate cost.
- Engineering estimate cost, when available.
- Usage amount used in the calculation.
- Request created date.

The export should support monitoring and offline review without exposing requests the user cannot already see.

## UI Quality Requirements

The visual direction is a polished operational dashboard, not a rough spreadsheet clone.

Keep:

- Dense but readable rows.
- Strong budget-code section headings.
- Clear summary totals for budget amount, used, and remaining.
- Sticky side panel for assignment.
- Collapsible budget boxes and collapsible side panel.
- Responsive behavior for narrower screens.

Avoid:

- Large decorative cards.
- Overly playful drag-and-drop visuals.
- Layouts that require excessive horizontal scrolling for normal desktop use.
- Text overlap in request titles, buttons, or columns.

## Error Handling

Handle:

- Invalid or empty budget code creation.
- Duplicate budget code creation by selecting the existing code.
- Negative budget amount or project estimate cost.
- Request no longer visible or deleted before assignment.
- Concurrent edits to the same budget code amount.
- Drag/drop failure with a clear non-destructive error message.

## Testing

Add focused coverage for:

- Creating a learned budget code.
- Assigning a request to a budget code.
- Moving a request between budget codes.
- Unassigning a request.
- Updating shared budget amount across all requests using the code.
- Editing project estimate cost.
- Usage calculation preferring engineering estimate over project estimate.
- Remaining budget calculation.
- Visibility filtering.
- XLSX export respecting filters and visibility.
- Collapsed budget boxes and collapsed remaining-request panel state.

## Open Implementation Notes

The feature should be implemented behind new components and server actions as much as possible, leaving existing request modal and workflow code untouched except for safe data-model additions and shared visibility helpers.

If drag-and-drop library support is needed, prefer the existing `@dnd-kit` dependency already used in the project.
