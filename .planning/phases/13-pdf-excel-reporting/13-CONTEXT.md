# Phase 13: PDF/Excel Reporting - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Generate PDF documentation for approved approval requests. Users can export completed request records as PDFs containing full request details, engineering solutions, file metadata, and complete approval history timeline.

**Note:** Phase title "PDF/Excel Reporting" is misleading — this phase delivers PDF export only. Excel export is out of scope.

</domain>

<decisions>
## Implementation Decisions

### Export workflow
- **Who can export:** Any viewer (anyone with view access to the request)
- **When export is available:** Only fully approved requests (FinalApproval status AND all approvers have approved — strict requirement)
- **Export location:** Request details view only (not in list view)
- **Filename format:** Auto-generated as `Request_TOPIC_YYYY-MM-DD.pdf` where TOPIC is the request topic and date is approval completion date

### PDF layout & design
- **Page constraint:** Content-driven (no artificial 1-page limit — content determines PDF length)
- **Branding:** None — clean document with well-formatted information only (no logo, no branded header/footer)
- **Visual organization:** Visually structured with section headings, clear visual hierarchy, signature lines, and timestamps
- **Section order:** Logical flow — Topic → Request information → Engineering solution → Approval history
- **File attachments representation:** List with metadata (filename, size, type, upload date) — no actual file content embedded
- **Approval history details:** Complete record per approver (name, role, department, level, timestamp, approval/rejection status, comment)
- **Approval history format:** Timeline format (vertical flow showing progression through approval levels)
- **Metadata:** Footer with generation metadata: "Generated on DATE by USER from Approval System"

### Generation experience
- **Loading feedback:** Inline loading with spinner and "Generating PDF..." message (not modal, not background)
- **Delivery method:** Auto-download (direct browser download to Downloads folder)
- **Error handling:** Manual retry only — show error message with "Try again" button, no automatic retry
- **Rate limiting:** 3 PDFs per minute per user to prevent abuse

### Excel vs PDF scope
- **Excel export:** Out of scope for this phase — PDF export only
- **Phase title note:** Title mentions "PDF/Excel" but requirements and success criteria specify PDF only

### Claude's Discretion
- Exact typography and spacing for visual hierarchy
- PDF generation library choice (Puppeteer vs alternative)
- Server-side vs edge function generation strategy
- Error message wording and design
- Exact loading animation design

</decisions>

<specifics>
## Specific Ideas

No specific product references or examples provided — open to standard PDF generation approaches for document export.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 13-pdf-excel-reporting*
*Context gathered: 2026-02-19*
