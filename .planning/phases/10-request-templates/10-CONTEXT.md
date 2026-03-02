# Phase 10: Request Templates - Context

**Gathered:** 2026-02-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can create requests from standardized templates. Admin creates templates with predefined title patterns and description content. Users select a template when creating a request and the form pre-fills with template content.

</domain>

<decisions>
## Implementation Decisions

### Template fields
- Templates include title and description (not just one or the other)
- Description is editable starting point — user can modify template content when creating request
- Same character limits as regular requests
- No file attachments in templates
- Title is editable by user when creating request (not fixed or placeholder-based)
- User selects priority — templates don't specify priority
- No version history for templates
- No approval response suggestions in templates

### Assignment model
- No department binding — all users see all templates
- Users without a department see all templates
- Templates can be used by multiple departments (cross-department)
- Admin can mark one template as default

### Selection interface
- Dropdown list for template selection
- Dropdown shows template name + short description preview
- "Blank request" option available (at bottom of dropdown)
- Default template is pre-selected, user can change/clear

### Template editing
- Template changes apply to NEW requests only — existing requests keep original content
- Templates are soft-deleted (can be deactivated, not permanently removed)
- No change tracking or audit trail for template edits
- No live preview when editing templates
- Admin only can create and edit templates (not regular users)

</decisions>

<specifics>
## Specific Ideas

- "Editable starting point" — description pre-fills from template but user can modify
- Default template first in dropdown, blank option at bottom
- Pre-selected default but user can deselect to create blank request

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-request-templates*
*Context gathered: 2026-02-15*
