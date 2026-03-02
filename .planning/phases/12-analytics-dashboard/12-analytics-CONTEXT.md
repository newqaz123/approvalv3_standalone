# Phase 12: Analytics Dashboard - Context

**Gathered:** 2026-02-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can visualize approval metrics and trends through an analytics dashboard showing workflow pipeline, approval time metrics, and department breakdowns. Users can filter data by time range and other dimensions. This phase does not include exporting analytics or scheduled reports - those are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Chart Types & Layout
- **Workflow pipeline**: Horizontal stacked bar chart - each workflow step is a bar segment with stacked status (Pending/Approved/Rejected)
- **Time metrics**: Grouped bar chart - side-by-side bars for multiple metrics (average time per request, average time per approval level)
- **Department breakdown**: Pie chart showing each department's proportion of total requests
- **Dashboard arrangement**: Single column vertical stack - pipeline chart at top, time metrics below, department breakdown at bottom
- **Color scheme**: Match status colors consistently across all charts (green=Approved, yellow=Pending, red=Rejected)
- **Data values**: Totals visible on chart elements, detailed breakdown in hover tooltips

### Metrics Depth & Presentation
- **Time statistics**: Full statistics - average, median, min, max for approval times
- **Trend indicators**: Show up/down arrows with percentage change from previous period (e.g., "↑ 12% vs last period")
- **Additional metrics**:
  - Bottleneck analysis: How long requests spend at each workflow step on average
  - Department rankings: Comparison of department performance (approval rates, times)
- **Summary cards**: Display key metrics prominently at top (e.g., "45 pending", "Avg 2.3 days", "78% approval rate")

### Filter Behavior
- **Date range control**: Presets (7 days, 30 days, 90 days, All time) plus custom date picker for specific ranges
- **Filter scope**: Global filters at top (date range, department, status, requester) that apply to all charts, with option for local override per chart
- **Persistence**: Reset to defaults on each visit (always start with last 30 days, all departments)
- **Available filters**: Date range (presets + custom), Department, Status (Pending/Approved/Rejected), Requester

### Mobile Presentation
- **Chart layout**: Vertical scroll all charts - same as desktop but smaller (no carousel or tab switching)
- **Summary cards**: Show summary cards at top even on mobile screens
- **Chart interaction**: Tap chart elements to see detailed values and breakdown in modal/tooltip
- **Chart sizing**: Max width centered - maintain chart proportions with side margins on small screens

### Claude's Discretion
- Exact spacing and typography for summary cards
- Loading skeleton design for charts
- Error state handling when analytics data fails to load
- Empty state presentation (no data in selected date range)
- Exact tooltip/modal styling and animations

</decisions>

<specifics>
## Specific Ideas

- Approval status colors should be consistent with the rest of the app (green/yellow/red)
- Summary cards should give users immediate insight without needing to dive into charts
- Trend indicators help users spot problems quickly (e.g., "↑ 15% slower approval time")
- Bottleneck analysis helps identify which workflow steps cause delays
- Department rankings allow performance comparison across departments
- Charts should work on mobile screens from Phase 11 (responsive charts requirement)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-analytics-dashboard*
*Context gathered: 2026-02-17*
