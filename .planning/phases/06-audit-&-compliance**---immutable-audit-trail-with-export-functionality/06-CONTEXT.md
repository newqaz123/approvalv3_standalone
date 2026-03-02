# Phase 6: Audit & Compliance - Context

**Gathered:** 2025-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Immutable audit logging system that captures all user actions for accountability, with admin export functionality (CSV/JSON) for compliance and external system integration (E-ordering). Audit trail is append-only and queryable for dashboard analytics and activity timeline display.
</domain>

<decisions>
## Implementation Decisions

### Audit event granularity
- High-level actions only (e.g., "request approved", "solution submitted") - no field-level change tracking
- Link everything: Include userId, requestId, action, timestamp, outcome, related entity IDs (solutionId, approvalId, fileAttachmentId) for complete join capability
- User actions only: Log user-initiated actions (submit, approve, reject, cancel, upload). No reads/views or system events.
- Structured fields: Use typed fields (actionType, entityId, entityType, reason, outcome) instead of flexible text for queryability

### Export format and structure
- Both options: Admin chooses between CSV and JSON export format per export action
- Full snapshot: Include all request metadata + approval chain snapshot + file attachment names. Rich export even if CSV is wide.
- Format-dependent structure:
  - CSV: One row per action (approval, rejection, file upload as separate rows) for flat structure
  - JSON: Group by request with nested arrays (actions: [], approvers: [], files: []) for readable hierarchy
- Both date formats: Include both ISO 8601 (2025-01-31T14:30:00Z) and user's locale (31/01/2025 2:30 PM) in separate columns

### Retention and archival
- Fixed period: 1 year retention for all audit logs
- Archive then delete: Move to separate archive table/storage before deletion to enable restoration if needed
- Basic optimization: Add indexes on timestamp, userId, requestId for query performance as data grows

### Access control and privacy
- Admins only: Only admin role can view audit logs and export data
- Include all data: Full transparency - filenames, rejection reasons, cost estimates, approval comments all included
- No masking: Admins see all PII (personal identifiable information) without partial/full masking in exports
- No tracking: No additional logging of who exported audit logs - admins can export freely

### Claude's Discretion
- Exact archive table schema and migration strategy
- Export UI design and placement in admin interface
- Whether to implement background job for archival vs manual cleanup
- Index optimization strategy based on actual query patterns
</decisions>

<specifics>
## Specific Ideas

- E-ordering system integration mentioned in roadmap - ensure exported logs contain all fields required for external system compatibility
- Full snapshot exports support comprehensive compliance auditing even if it creates wide CSV files
- Structured fields enable dashboard analytics and activity timeline queries (per roadmap Success Criteria #5)
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope
</deferred>

---

*Phase: 06-audit-&-compliance*
*Context gathered: 2025-02-07*
