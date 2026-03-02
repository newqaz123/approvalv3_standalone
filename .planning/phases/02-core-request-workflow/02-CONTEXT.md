# Phase 2: Core Request Workflow - Context

**Gathered:** 2026-01-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Requesters can submit improvement requests with file attachments and track their status through a workflow. Users can create requests with title, description, and optional metadata, upload one or more files, and view their requests in a filterable list with status visibility.

</domain>

<decisions>
## Implementation Decisions

### Request form design
- **Layout**: Single column form with title and description fields vertically stacked
- **Fields**: Title (required), Description (required), plus optional fields (priority, category, tags) - "Required + optional" approach
- **Validation timing**: Validate only on submit - all errors shown at once
- **Post-submit behavior**: Redirect to requests list after successful submission
- **Focus behavior**: Manual focus - user must click into fields, no auto-focus
- **Labels**: Labels only - no placeholders, clean appearance with labels above each field
- **Exit mechanism**: Cancel button with unsaved changes warning
- **Draft mode**: No auto-save - user must complete in one session
- **File attachment timing**: Users can attach files directly in the form during request creation
- **Form structure**: Single page form - all fields visible at once (not multi-step)

### File upload experience
- **File selection**: Both drag-drop zone and file picker button - users can use either method
- **Upload timing**: Immediate upload when files are selected (not on form submit)
- **File display**: Table rows showing uploaded files with details
- **File type restrictions**: Documents only - restrict to common document types (PDF, images, Office docs)
- **Size limits**: Per-file size limit (not total size)
- **File descriptions**: Optional text field for users to describe each file
- **Progress indication**: Individual progress bars for each file upload with percentage
- **No files scenario**: Allow submission without attached files (attachments are optional)

### Status display & navigation
- **List layout**: Table view with columns (title, status, date, actions), clickable rows
- **Status representation**: Color-coded badges (green=approved, red=rejected, blue=pending)
- **Navigation pattern**: Modal/overlay for detail view - clicking row opens modal, URL doesn't change
- **Status information detail**: You decide - Claude has discretion on what to show in list vs detail
- **Filtering**: Filter controls on list page (status, department, date filters)
- **Sorting**: Column sorting - click column headers to sort by field
- **Status counts**: Show count of requests in each status

### Empty states & errors
- **No requests empty state**: Friendly message + CTA - illustration with "No requests yet. Create your first request!" and action button
- **Validation errors**: Toast notification that auto-dismisses after a few seconds
- **File upload errors**: Technical error messages with error codes/details for debugging
- **File constraint errors**: Full details - show complete information (file type, size limits, allowed types) in error messages
- **Form submission loading**: Button loading state - submit button shows loading state + text change during submission

### Claude's Discretion
- What status information to show in list vs detail view (timestamp, history summary, etc.)
- Exact per-file size limit value
- Specific document types to allow in allowlist
- Exact color scheme for status badges
- Specific filter UI implementation
- Table column definitions and order
- Modal/overlay design and behavior

</decisions>

<specifics>
## Specific Ideas

No specific requirements or product references mentioned - open to standard approaches for request submission and tracking workflows.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within Phase 2 scope (request creation, file uploads, status tracking).

</deferred>

---

*Phase: 02-core-request-workflow*
*Context gathered: 2026-01-31*
