# Phase 5: Dashboard & Visibility - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

## Phase Boundary

Build request discovery and tracking views where users find, filter, and monitor requests relevant to them through three dashboard views ("My Requests", "Pending My Approval", "All Requests"), search and filter UI (department, status, date range, text search), and activity timeline showing chronological event history.

This phase does NOT add new request actions or modify approval workflows — it's about visibility and discovery of existing data.

## Implementation Decisions

### View Organization & Navigation
- Single `/dashboard` page with tab navigation at the top (not separate routes or sidebar)
- Default tab is "Pending My Approval" — action-oriented entry point
- Always default to Pending tab (no session memory for tab selection)
- Tab labels without count badges — simpler, no counting query overhead

### Table/List Layout & Density
- Data table format (not cards or list rows) — traditional table with sortable columns
- Moderate density: 4-5 columns per table — Title, Status, Requester, Date (essentials, not cluttered)
- Consistent column layout across all three views
- Native horizontal scrolling for overflow on smaller screens (no sticky columns)
- Clicking a row opens existing request detail modal (not navigation to detail page)
- Standard pagination with page size controls (10, 25, 50, 100) — not infinite scroll or load-more button

### Search & Filter Behavior
- Separate controls: filters in sidebar or above table, text search as separate input (not unified search bar)
- Real-time filtering — results update immediately as filters change (no apply button)
- Per-tab filter memory — each tab remembers its own filter state independently
- Filters reset to defaults on page refresh (no localStorage persistence across sessions)

### Activity Timeline Design
- Simple chronological list (not vertical timeline with visual line)
- Group by day — "Today", "Yesterday", "February 5, 2026" headers
- Summary only per event — timestamp, action type, brief one-line summary (not full details inline)
- Collapsible day groups — users can expand/collapse each day's events

### Claude's Discretion
- Exact visual styling of day group headers
- Pagination component implementation details
- Filter control UI (dropdowns, checkboxes, etc.)
- Timeline animation/transition effects
- Mobile responsiveness details

## Specific Ideas

- Table uses existing TanStack Table pattern from admin user management
- Modal pattern for request detail matches existing request-table.tsx behavior
- Timeline events use RequestActivity data already being logged
- Status badges use existing StatusBadge component

## Deferred Ideas

None — discussion stayed within phase scope.

---

*Phase: 05-dashboard-visibility*
*Context gathered: 2026-02-06*
