# Requirements: Approval Flow System v1.1

**Defined:** 2026-02-14
**Core Value:** Everyone can track requests with full visibility and accountability — no more lost work in email chains.

## v1.1 Requirements

Requirements for Production Deployment + Analytics & UX milestone. Each maps to roadmap phases.

### Deployment

- [x] **DEPLOY-01**: Multi-stage Docker build with Next.js standalone output (~110MB image)
- [x] **DEPLOY-02**: Docker Compose orchestration with service communication by name
- [x] **DEPLOY-03**: Environment variable configuration with .env.example template
- [x] **DEPLOY-04**: Named volumes for PostgreSQL data and file upload persistence
- [x] **DEPLOY-05**: Health checks for all services (app endpoint + pg_isready for database)
- [x] **DEPLOY-06**: Restart policies for automatic recovery on failure or server reboot
- [x] **DEPLOY-07**: Prisma migrations run automatically on deployment
- [x] **DEPLOY-08**: .dockerignore for optimized build context
- [x] **DEPLOY-09**: Production-ready base image (node:slim or alpine with Prisma compatibility)
- [x] **DEPLOY-10**: Resource limits via Docker Compose deploy configuration
- [x] **DEPLOY-11**: Structured logging with log rotation (json-file driver)
- [x] **DEPLOY-12**: Health check script to verify deployment success (validates all endpoints and database)
- [x] **DEPLOY-13**: Step-by-step deployment documentation for Hostinger VPS and VMware/internal VM
- [x] **DEPLOY-14**: Update process documentation (pull image + restart without data loss)
- [x] **DEPLOY-15**: Backup strategy documentation for file uploads and database (pg_dump scripts, volume backup)

### Analytics

- [x] **ANLY-01**: Pipeline chart showing request count at each workflow step (Improvement Request, Awaiting Approval, Engineering Solution, Final Approval, Completed, etc.)
- [x] **ANLY-02**: Each workflow step shows breakdown by status: approving (in-progress), approved, rejected
- [x] **ANLY-03**: Approval time metrics (average per request, average per approval level)
- [x] **ANLY-04**: Department breakdown of request counts
- [x] **ANLY-05**: Time range filtering (7/30/90 days, custom range)
- [x] **ANLY-06**: Chart visualizations using Recharts (bar chart for pipeline, supplementary charts for metrics)

### Reporting

- [x] **REPT-01**: Export button visible on requests with FinalApproval status where all approvers have approved
- [x] **REPT-02**: 1-page A4 PDF generation containing: topic, description, all request input details, engineering solution details
- [x] **REPT-03**: Attached file names listed in PDF report
- [x] **REPT-04**: Full approval history log in PDF (approver name, timestamp, level, approval/rejection, comments)

### Templates

- [x] **TMPL-01**: Admin template creation UI with name, description, and department association
- [x] **TMPL-02**: Predefined title patterns that user can customize when creating request
- [x] **TMPL-03**: Predefined description content that pre-fills request form
- [x] **TMPL-04**: Template selection dropdown on request creation page
- [x] **TMPL-05**: Department-specific template listing (users see templates for their department)
- [x] **TMPL-06**: Admin can edit existing templates (changes apply to new requests only)

### Mobile

- [x] **MOBL-01**: Responsive layout across all breakpoints (320px to 1920px+)
- [x] **MOBL-02**: Touch-friendly tap targets (44x44px minimum)
- [x] **MOBL-03**: Readable text without zoom (16px minimum body text on mobile)
- [x] **MOBL-04**: Single-column stacking on narrow screens
- [x] **MOBL-05**: Mobile-optimized tables (card view or horizontal scroll on small screens)
- [x] **MOBL-06**: Hamburger menu for navigation on mobile
- [x] **MOBL-07**: Mobile-optimized forms (full-width inputs, vertical stacking)
- [x] **MOBL-08**: File upload working on mobile (camera access + file picker)
- [x] **MOBL-09**: Sticky approve/reject action bar on mobile for quick approval workflow

## Future Requirements

Deferred to post-v1.1. Tracked but not in current roadmap.

### Advanced Analytics

- **ANLY-F01**: Approval rate vs rejection rate percentages
- **ANLY-F02**: Engineering turnaround time (AwaitingSolution → SolutionSubmitted)
- **ANLY-F03**: Comparison to previous period with percentage change
- **ANLY-F04**: User-level approval performance metrics
- **ANLY-F05**: Real-time dashboard auto-refresh (30-60 second intervals)
- **ANLY-F06**: Export analytics data as CSV

### Advanced Reporting

- **REPT-F01**: PDF with embedded analytics charts
- **REPT-F02**: Multiple sheets in Excel export
- **REPT-F03**: Batch export (multiple requests as PDFs in ZIP)
- **REPT-F04**: Company branding in PDF (logo, header/footer)
- **REPT-F05**: Scheduled/automated report generation

### Advanced Templates

- **TMPL-F01**: Conditional field logic (show/hide based on previous responses)
- **TMPL-F02**: Custom field definitions beyond title/description
- **TMPL-F03**: Template versioning for audit compliance
- **TMPL-F04**: Template usage analytics
- **TMPL-F05**: Template categories for grouping

### Advanced Mobile

- **MOBL-F01**: Progressive Web App (PWA) with add-to-home-screen
- **MOBL-F02**: Push notifications for pending approvals
- **MOBL-F03**: Dark mode support
- **MOBL-F04**: Offline indicator with queued actions
- **MOBL-F05**: Swipe gestures for request navigation

## Out of Scope

Explicitly excluded from v1.1. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Kubernetes orchestration | Overkill for 30 users on single server |
| CI/CD pipeline | Manual deployment acceptable for internal tool |
| Blue-green deployments | Brief downtime acceptable for 30 users |
| External secrets management (Vault) | .env files with proper permissions sufficient |
| Predictive analytics / ML | No historical data yet, 30 users insufficient |
| Individual user productivity rankings | Privacy concerns in 30-person org |
| SLA alerting / auto-escalation | Deferred to future milestone |
| Custom dashboard builder | Fixed layout sufficient for internal tool |
| Drag-and-drop form builder for templates | Over-engineered for ~5-10 templates |
| Template-based workflow routing | Approval chains are per-department, not per-template |
| Native mobile app (iOS/Android) | Web-first approach, responsive design sufficient |
| Biometric authentication | Clerk handles auth, not requested |
| General reporting page with filters | Per-request approval PDF serves actual need (E-ordering attachment) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEPLOY-01 | Phase 9 | Complete |
| DEPLOY-02 | Phase 9 | Complete |
| DEPLOY-03 | Phase 9 | Complete |
| DEPLOY-04 | Phase 9 | Complete |
| DEPLOY-05 | Phase 9 | Complete |
| DEPLOY-06 | Phase 9 | Complete |
| DEPLOY-07 | Phase 9 | Complete |
| DEPLOY-08 | Phase 9 | Complete |
| DEPLOY-09 | Phase 9 | Complete |
| DEPLOY-10 | Phase 9 | Complete |
| DEPLOY-11 | Phase 9 | Complete |
| DEPLOY-12 | Phase 9 | Complete |
| DEPLOY-13 | Phase 9 | Complete |
| DEPLOY-14 | Phase 9 | Complete |
| DEPLOY-15 | Phase 9 | Complete |
| TMPL-01 | Phase 10 | Complete |
| TMPL-02 | Phase 10 | Complete |
| TMPL-03 | Phase 10 | Complete |
| TMPL-04 | Phase 10 | Complete |
| TMPL-05 | Phase 10 | Complete |
| TMPL-06 | Phase 10 | Complete |
| MOBL-01 | Phase 11 | Complete |
| MOBL-02 | Phase 11 | Complete |
| MOBL-03 | Phase 11 | Complete |
| MOBL-04 | Phase 11 | Complete |
| MOBL-05 | Phase 11 | Complete |
| MOBL-06 | Phase 11 | Complete |
| MOBL-07 | Phase 11 | Complete |
| MOBL-08 | Phase 11 | Complete |
| MOBL-09 | Phase 11 | Complete |
| ANLY-01 | Phase 12 | Pending |
| ANLY-02 | Phase 12 | Pending |
| ANLY-03 | Phase 12 | Pending |
| ANLY-04 | Phase 12 | Pending |
| ANLY-05 | Phase 12 | Pending |
| ANLY-06 | Phase 12 | Pending |
| REPT-01 | Phase 13 | Pending |
| REPT-02 | Phase 13 | Pending |
| REPT-03 | Phase 13 | Pending |
| REPT-04 | Phase 13 | Pending |

**Coverage:**
- v1.1 requirements: 40 total
- Mapped to phases: 40/40 (100%)
- Unmapped: 0

**Phase breakdown:**
- Phase 9 (Docker Deployment): 15 requirements
- Phase 10 (Request Templates): 6 requirements
- Phase 11 (Mobile-Responsive): 9 requirements
- Phase 12 (Analytics Dashboard): 6 requirements
- Phase 13 (PDF/Excel Reporting): 4 requirements

---
*Requirements defined: 2026-02-14*
*Last updated: 2026-02-16 after Phase 11 completion*
