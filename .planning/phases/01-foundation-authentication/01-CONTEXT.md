# Phase 1: Foundation & Authentication - Context

**Gathered:** 2026-01-30
**Status:** Ready for planning

## Phase Boundary

User authentication, role-based access control, and user/department management infrastructure. This phase delivers the security foundation and administrative capabilities needed before any workflow features can be built.

## Implementation Decisions

### Authentication approach
- Email/password authentication only (no social login)
- Password recovery supports both self-serve email reset flow AND admin-initiated reset
- Sessions are indefinite (persistent "remember me" behavior)
- Multiple concurrent sessions allowed across devices
- Session management UI lets users view and manage their active sessions
- Logout from one device doesn't affect other sessions unless user explicitly revokes them

### User management UX
- Both single-user creation and bulk import (CSV/Excel) methods supported
- New users receive email invitation with setup link to create their own password
- System emails users for ALL account changes: creation, password reset, role changes, deactivation
- User list view has customizable columns that admin can choose to display
- Default columns include: name, email, department, role, status, creation date, last login, level assignment

### Admin UI patterns
- Separate /admin section with dedicated navigation (not inline with main app)
- Confirmation dialogs required for ALL destructive actions: user deletion, deactivation, role changes
- Deactivated users hidden by default from main user list (filter toggle to show inactive)
- Inline editing for user/department information (edit in place with save/cancel)
- Real-time validation showing errors inline as user types (e.g., duplicate email detection)

### Claude's Discretion
- Exact session management UI design and placement
- Bulk import CSV/Excel format and validation rules
- Column customization interface and persistence
- Confirmation dialog wording and styling
- Real-time validation debounce timing and error presentation

## Specific Ideas

No specific requirements — open to standard approaches for internal admin tools.

## Deferred Ideas

None — discussion stayed within phase scope.

---

*Phase: 01-foundation-authentication*
*Context gathered: 2026-01-30*
