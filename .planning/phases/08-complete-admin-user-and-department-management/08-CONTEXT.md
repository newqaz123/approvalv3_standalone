# Phase 8: Complete Admin User & Department Management - Context

**Gathered:** 2026-02-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Admins can edit existing users and departments to maintain accurate system data. Currently, admins can only create and deactivate users — to make changes they must deactivate and recreate. Same limitation exists for departments. This phase adds edit functionality with proper Clerk synchronization for user data.

</domain>

<decisions>
## Implementation Decisions

### Field Scope
- **User fields:** Name, department, and role are editable
- **User fields excluded:** Email editing requires re-verification flow (complexity trade-off)
- **Department fields:** Both name and type are editable
- Claude's discretion: Whether level field should be editable in user edit (affects workflow, evaluate during planning)

### Clerk Synchronization
- **Name changes:** Must sync to Clerk (user's displayName metadata)
- **Email changes:** Require re-verification before applying — updates both Clerk and Prisma
- **Atomic transactions:** Clerk and Prisma updates must be atomic — if Clerk succeeds but Prisma fails, rollback Clerk change
- **Error handling:** Show error message to user with retry option (no auto-retry)
- Claude's discretion: Exact rollback mechanism if Clerk API doesn't support transactional updates (pattern: update Prisma first, then Clerk, with compensating rollback)

### Edit Workflow
- **UI pattern:** Modal dialog using existing UserForm/DepartmentForm components
- **Pre-population:** Form must populate with existing values when opened
- **Invocation:** Edit button in table row (same position as deactivate button currently)
- Claude's discretion: Whether to reuse existing create forms or create separate edit variants (UserEditForm, DepartmentEditForm)

### Validation Rules
- **Schema reuse:** Same Zod validation as create flows (name required, email format, role enum, etc.)
- **Error display:** Field-by-field inline errors with first invalid field highlighted
- **Real-time validation:** Validate on blur and submit (matches current create pattern)

</decisions>

<specifics>
## Specific Ideas

- Reuse existing UserForm and DepartmentForm components from create flows
- Follow same patterns as deactivation confirmation (AlertDialog before action)
- Keep edit button next to deactivate button in UserTable for discoverability

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-complete-admin-management*
*Context gathered: 2026-02-12*
