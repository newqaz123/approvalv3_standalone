# Phase 7: Configuration & Administration - Context

**Gathered:** 2026-02-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Admins can configure approval hierarchies (drag-and-drop builder), all users can view workflow setup in read-only org chart, user management table shows level assignments, and completed/cancelled requests are archived and eventually hard-deleted automatically.

</domain>

<decisions>
## Implementation Decisions

### Hierarchy builder UX
- One department at a time — dropdown/selector to pick which department hierarchy to edit
- Named levels (admin sets custom name per level, e.g. "Manager", "Director")
- Explicit Save button — admin makes all edits then clicks Save; supports preview before committing
- Validation: only requires minimum one level; empty levels (no users) are allowed and normal
- User can only be in one level per department — moving to new level removes from old
- Min 1 level, no max — admin can add/remove levels freely
- All active users from entire system can be added to any department's hierarchy (not restricted to department members)

### Workflow view (all users)
- Dedicated page in navigation accessible to all users
- Tree/org chart style visualization showing hierarchy relationships
- Department selector (dropdown or tabs) — user picks which department to view
- Admins see Edit button on workflow view to jump directly to hierarchy builder for that department
- All departments shown including unconfigured ones (shows "No hierarchy configured" message)
- No "You are here" personalization — same view for everyone

### User management with levels
- Level column added to user management table as read-only (informational)
- Level editing only happens in the hierarchy builder
- Dash (—) shown for users with no level assigned
- Shows all level assignments across departments if user is in multiple hierarchies (e.g. "Sales:L2, Eng:L1")
- Level is global — User.level integer applies across all departments; changing level in one department affects all
- Level changes only affect new requests — in-progress approvals continue with old hierarchy assignment

### Request archival pipeline
- Auto-archive: Completed/Cancelled requests automatically archived after 365 days
- Admin can also manually archive completed/cancelled requests earlier via UI
- Archived requests hidden from all default views (My Requests, All Requests, dashboards)
- Admins have dedicated archive section to view archived requests
- Archive is one-way — no restore once archived
- Hard delete: archived requests automatically hard-deleted after 90 days in archive (no notification, fully automatic)
- True hard delete — data gone from database

</decisions>

<specifics>
## Specific Ideas

- Auto-archive is a background/scheduled process — no manual action needed for normal flow
- The pipeline is: terminal status (Complete/Cancel) → wait 365 days → auto-archive → wait 90 days → hard delete
- Admin can short-circuit the 365-day wait by manually archiving

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-configuration-administration*
*Context gathered: 2026-02-08*
