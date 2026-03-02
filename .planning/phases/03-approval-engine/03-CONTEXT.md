# Phase 3: Approval Engine - Context

**Gathered:** 2026-01-31
**Status:** Partially complete - Phase 3.2 ready for planning

<domain>
## Phase Boundary

**What's Complete (Phase 3.1):**
- ✅ Level-based approval system with sequential routing
- ✅ Any-one-per-level approval logic (multiple users at same level)
- ✅ Approve/Reject actions with comments
- ✅ Approval progress visualization
- ✅ Request filters (status, department, requester, date, search)
- ✅ My Actions page for pending approvals
- ✅ Reject badges throughout UI
- ✅ Top-level auto-approval (requester at max level routes directly to engineering)

**What Remains (Phase 3.2):**
- Hierarchy visualization UI for admins
- User level quick-edit from hierarchy view
- Request cancellation workflow for requesters
- Hierarchy change logging and history

This phase completes the approval engine by adding admin configuration tools and user cancellation capabilities.

</domain>

<decisions>
## Implementation Decisions

### Hierarchy Configuration UI
- **Access**: Per-department configuration (Admin panel → Departments → Click department → View hierarchy)
- **Layout**: Vertical columns (Trello-style) showing levels with users in each level
- **Interaction**: Quick-edit user levels without leaving hierarchy view
- **Levels**: Managed through user.level field (not separate hierarchy builder)
- **Multi-department users**: Some users belong to multiple departments (display in multiple hierarchy views)
- **Preview**: Show affected requests before saving hierarchy changes ("This will affect 5 pending requests")
- **Validation**:
  - Users can only be in one level at a time (per department)
  - **CRITICAL**: Cannot change hierarchy if there are pending approvals in that department
  - Must show error: "Cannot modify hierarchy - X requests have pending approvals"

### Hierarchy Changes & Versioning
- **When allowed**: Only when NO pending approvals exist in the department (hard constraint)
- **Impact on requests**: Would switch pending approvals to new hierarchy, but blocked by validation
- **Change logging**: Basic audit trail of hierarchy changes (who, when, what changed)
- **History UI**: Simple list showing changes with date and admin name
- **Rollback**: No automatic rollback - admins must manually reconfigure if needed
- **Version storage**: Requests reference current hierarchy (no snapshot at creation)

### Cancellation Workflow
- **Timing**: Requesters can only cancel before any approvals happen
- **UI**: Cancel button in request detail modal (appears when eligible)
- **Reason**: Required comment explaining cancellation
- **Post-cancel state**: Status changes to 'Cancelled' (new status, visible in lists)
- **Permissions**: Only requester can cancel their own requests

### Claude's Discretion
- Exact drag-and-drop implementation details (@dnd-kit library usage)
- Hierarchy change diff visualization
- Cancel button styling and placement
- Audit trail database schema

</decisions>

<specifics>
## Specific Ideas

- Hierarchy view should feel like Trello - visual columns with draggable user cards
- **Hard block on hierarchy changes**: If pending approvals exist, show error immediately (don't allow changes)
- Error message: "Cannot modify hierarchy while requests are pending approval. Complete or cancel pending requests first."
- Cancel button should be prominent but require confirmation
- Users who belong to multiple departments appear in each department's hierarchy view

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 03-approval-engine*
*Context gathered: 2026-01-31*
