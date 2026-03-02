## RESEARCH COMPLETE

**Phase:** 07 - Configuration & Administration
**Confidence:** HIGH

### Key Findings

*   **Drag-and-Drop Library:** Use `@dnd-kit` (specifically `@dnd-kit/sortable`) for the hierarchy builder. It is headless, accessible, and supports the "sortable lists" pattern perfectly.
*   **Data Model Strategy:** Implement a "Global Level" pattern as per decisions. `User.level` (Int) is the single source of truth. Departments define `levelNames` (JSON) to map these integers to roles (e.g., "Manager").
*   **Cross-Department Support:** Introduce a new `DepartmentApprover` join table. This is critical because the existing `User.departmentId` only tracks *membership*, but the requirements state any user can be an *approver* for any department.
*   **Archival Pipeline:** Use a scheduled task (Vercel Cron) hitting a secure API route to transition requests: Active -> Archived (`isDeleted=true`, after 365 days) -> Hard Deleted (removed, after 90 days in archive).

### File Created

`.planning/phases/07-configuration-and-administration/07-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | `dnd-kit` and `shadcn/ui` are well-established and compatible. |
| Architecture | HIGH | The "Global Level" decision simplifies the model significantly, though side effects must be managed. |
| Pitfalls | HIGH | Identified critical UX risks (global side effects) and data integrity risks (orphaned approvers). |

### Open Questions

1.  **Migration:** The Planner must include a migration step to add `Department.levelNames` (JSON) and `DepartmentApprover` (Table).
2.  **UI Feedback:** The UI must explicitly warn admins that changing a user's level affects them across *all* departments they approve for.

### Ready for Planning

Research complete. Planner can now create PLAN.md files.