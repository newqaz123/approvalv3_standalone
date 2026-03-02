# Feature Landscape: v1.1 Production Deployment + Analytics & UX

**Project:** Approval Flow System v1.1
**Domain:** Internal approval workflow system for ~30 users
**Researched:** 2026-02-13
**Context:** Adding deployment infrastructure, analytics, reporting, templates, and mobile support to shipped v1.0 system

## Executive Summary

v1.1 adds production readiness and UX improvements to a fully operational v1.0 approval workflow system. The feature set targets small-scale internal deployment (30 users, single server) with practical analytics, basic reporting, template reuse, and mobile accessibility. Scope is deliberately constrained to avoid over-engineering for this user scale.

## Feature Categories by Area

### A. Docker Deployment Infrastructure

Features for deploying Next.js + PostgreSQL + Prisma stack to single-server environments (VPS or internal VM).

#### Table Stakes Features

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| **Multi-stage Docker build with standalone output** | Industry standard for Next.js production. Reduces image from ~1GB to ~110MB (85% smaller). | Low | Next.js output: "standalone" in next.config.js |
| **Docker Compose orchestration** | Standard for multi-container apps. Defines services, networks, volumes in single file. | Low | Docker Compose v2+ |
| **Service communication by name** | Within Compose network, services reach each other by service name (postgres://db:5432). | Low | Compose networking |
| **Environment variable configuration** | Standard for 12-factor apps. All secrets/config via .env files, never hardcoded. | Low | dotenv in Node, .env.example template |
| **Named volumes for persistence** | Database data must survive container restarts. Named volumes prevent data loss. | Low | Docker volume configuration |
| **Health checks for all services** | Docker needs to know if services are functioning, not just running. Enables proper restart behavior. | Medium | Health check endpoints in app, pg_isready for Postgres |
| **Restart policies** | Services should auto-restart on failure or server reboot. restart: unless-stopped or always. | Low | Compose deploy configuration |
| **Prisma migrations in Docker** | Database schema must be applied on deployment. Run migrations before starting app. | Medium | Prisma CLI, migration files, DATABASE_URL at build time |
| **.dockerignore file** | Prevents copying node_modules, .next, .git into build context. Faster builds, smaller images. | Low | .dockerignore configuration |
| **Production-ready base image** | Use node:slim or node:alpine. Slim is Debian-based, mostly supported. Alpine is smaller but has compatibility issues. | Low | Base image selection (recommend node:slim for Prisma compatibility) |

#### Differentiators (Nice to Have)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Resource limits via deploy key** | Prevents any single service from consuming all server resources. | Low | Add deploy.resources.limits to Compose file |
| **Structured logging configuration** | Centralized logs make debugging production issues easier. | Medium | Configure log drivers (json-file with rotation) |
| **Build-time DATABASE_URL support** | Pass DATABASE_URL during build for migrations: docker build --build-arg DATABASE_URL=... | Medium | Useful for CI/CD, optional for manual deployment |
| **Health check script** | Automated verification that deployment succeeded. Checks all endpoints, database connectivity. | Medium | Simple Node/curl script that validates each service |
| **Deployment documentation** | Step-by-step guide for Hostinger VPS + internal VM deployment scenarios. | Low | Markdown documentation with actual commands |
| **Update process documentation** | How to pull new images and restart services without data loss. | Low | Documenting docker compose pull && docker compose up -d |
| **Backup strategy for local file storage** | Document how to backup public/uploads/ directory and database. | Low | Volume backup instructions, pg_dump scripts |

#### Anti-Features (Explicitly Avoid)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Kubernetes orchestration** | Massive overkill for 30 users on single server. Adds complexity without benefit. | Use Docker Compose. Sufficient for single-server, <100 user deployments. |
| **Multiple replicas / horizontal scaling** | App serves 30 users. Single container handles this easily. No need for load balancing. | Single container per service. Add restart policy for availability. |
| **CI/CD pipeline with automated tests** | Not requested for internal tool. Manual deployment is acceptable for this scale. | Document manual deployment. Add CI/CD in future milestone if needed. |
| **Blue-green or canary deployments** | Zero-downtime deployment not required for internal tool with 30 users. Brief downtime acceptable. | Standard docker compose up with brief restart. Schedule during low-usage window. |
| **External secrets management (Vault, etc)** | Over-engineered for internal deployment. .env files with proper permissions are sufficient. | Use .env files, secure server access, document secret rotation process. |
| **Container registry (private Docker Hub, etc)** | Not needed if deploying from source. Adds complexity and potential cost. | Build images on target server from git repository. |
| **Monitoring agents (Prometheus, Grafana)** | Overkill for 30 users. System-level monitoring (htop, docker stats) is sufficient. | Use docker logs, system monitoring tools already on server. |

### B. Real-Time Analytics Dashboard

Features for visualizing approval workflow metrics and identifying bottlenecks.

#### Table Stakes Features

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| **Approval time metrics** | Core KPI: How long requests take from submission to completion. Average, median, min, max. | Medium | Date arithmetic on RequestActivity, aggregation queries |
| **Request volume trends** | Understand workload patterns: requests per day/week/month, trend over time. | Low | COUNT grouped by date ranges |
| **Department breakdown** | Which departments submit most requests. Helps resource planning. | Low | GROUP BY department_id with counts |
| **Status distribution** | How many requests in each status. Shows current system load. | Low | COUNT GROUP BY status |
| **Approval bottleneck identification** | Which approval levels cause longest delays. Average time per level. | High | Join RequestActivity with ApprovalChain, calculate time deltas between approval events |
| **Time range filtering** | View analytics for last 7/30/90 days or custom range. | Low | Date range filters on queries |
| **Basic chart visualization** | Line charts for trends, bar charts for comparisons, pie charts for distributions. | Medium | Recharts or Chart.js library, React components |

#### Differentiators (Nice to Have)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Approval rate vs rejection rate** | Shows process quality. High rejection rate indicates unclear requirements. | Medium | Calculate approval/rejection percentages from RequestActivity |
| **Average approvals per request** | Understand typical approval chain length. | Low | AVG of approval count per request |
| **Engineering turnaround time** | Separate metric: Time from AwaitingSolution to SolutionSubmitted. | Medium | Calculate delta between specific status transitions |
| **User-level approval performance** | Which approvers respond fastest/slowest. Can inform resource allocation. | Medium | GROUP BY approver with time calculations. Privacy consideration for 30-user org. |
| **Comparison to previous period** | "Approval time this month vs last month" with percentage change. | Medium | Duplicate queries with offset date ranges, calculate delta |
| **Export analytics data** | Download current analytics view as CSV for external analysis. | Low | Reuse existing CSV export from v1.0 audit trail feature |
| **Real-time dashboard updates** | Auto-refresh every 30-60 seconds without page reload. | Medium | React Query with refetch interval or Server-Sent Events |

#### Anti-Features (Explicitly Avoid)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Predictive analytics / ML models** | No historical data yet (v1.0 just shipped). 30 users insufficient dataset for ML. | Show historical trends. Add predictions in future if needed and data exists. |
| **Individual user productivity rankings** | Toxic in 30-person org. Creates unhealthy competition, privacy concerns. | Show aggregate metrics only. Department-level is sufficient. |
| **Real-time alerting / SLA violations** | Explicitly marked out-of-scope for v1.1. Adds notification complexity. | Defer to future milestone. Focus on visibility first. |
| **Custom dashboard builder** | Over-engineered for internal tool. Users don't need to customize layouts. | Provide single, well-designed dashboard. Fixed layout is sufficient. |
| **Integration with external BI tools** | Unnecessary for 30 users. Adds integration complexity. | Build analytics in-app. Export CSV if external analysis needed. |
| **Advanced statistical analysis** | Correlation analysis, regression models, statistical significance tests are overkill. | Show simple aggregates: averages, counts, totals. Easy to understand. |

### C. Basic Reporting with Export (PDF/Excel)

Features for generating and exporting approval workflow reports.

#### Table Stakes Features

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| **Request summary report** | List of requests with key fields: ID, title, requester, department, status, dates. | Low | Database query, format as table |
| **Excel export (.xlsx)** | Standard format for business reporting. Users can open in Excel for further analysis. | Medium | exceljs or xlsx library (SheetJS) |
| **PDF export with basic formatting** | Professional format for archival and sharing. Tables, headers, basic styling. | Medium | @react-pdf/renderer or pdfmake library |
| **Date range filtering** | Generate reports for specific time periods (last month, Q1, custom range). | Low | Date filter on report queries |
| **Department filtering** | Generate reports for specific departments. | Low | WHERE department_id = ? in queries |
| **Status filtering** | Report on requests in specific statuses (e.g., all completed requests). | Low | WHERE status IN (...) in queries |
| **Approval timeline in report** | Show approval history: who approved, when, at which level. | Medium | Join RequestActivity, format chronologically |
| **File reference in report** | List attached files with descriptions (link in Excel, reference in PDF). | Low | Query request_files, format as list |

#### Differentiators (Nice to Have)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Auto-generated filename with timestamp** | Better organization: approval_report_2026-02-13_143021.xlsx | Low | Format: {report_type}_{date}_{time}.{ext} |
| **Multiple sheets in Excel export** | Sheet 1: Request summary, Sheet 2: Approval timeline, Sheet 3: File list | Medium | exceljs supports multiple worksheets |
| **PDF with charts** | Include analytics charts in PDF report. Visual summary. | High | Render Recharts to image, embed in PDF. Complex but high impact. |
| **Report templates** | Predefined report types: Monthly summary, Department report, Audit trail report | Medium | Define query + format templates, user selects type |
| **Batch export** | Export multiple requests as separate PDFs in a ZIP file. | Medium | JSZip library, loop PDF generation |
| **Branding in PDF** | Company logo, header/footer with report metadata. | Low | Add Image component in @react-pdf/renderer |
| **CSV export option** | Simple alternative to Excel, better for programmatic processing. | Low | Reuse json2csv from v1.0 audit trail |

#### Anti-Features (Explicitly Avoid)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Scheduled/automated reports** | Not requested. Adds cron/scheduling complexity. Users can generate on-demand. | Manual report generation. Add scheduling in future if requested. |
| **Email report delivery** | Not requested. Email is already configured for notifications, but auto-reports add complexity. | Generate and download. User can email manually if needed. |
| **Advanced PDF layouts** | Multi-column layouts, complex designs take significant development time. | Simple, readable single-column layout. Tables and basic formatting. |
| **Word document export (.docx)** | Not standard for workflow reports. PDF + Excel cover use cases. | Focus on PDF (archival) and Excel (analysis). |
| **Report scheduling UI** | Building a report scheduler is a separate feature. Out of scope for v1.1. | Defer to future milestone. On-demand generation sufficient. |
| **Real-time collaborative editing** | Reports are read-only snapshots. No need for editing in-app. | Export and edit externally if needed. |

### D. Request Templates

Features for creating reusable request forms with predefined fields.

#### Table Stakes Features

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| **Template creation UI** | Admin creates templates with name, description, department association. | Medium | New admin page, form for template metadata |
| **Predefined title patterns** | Template specifies default title or title pattern. User can customize. | Low | Template field, pre-fill title input on request creation |
| **Predefined description** | Template includes default description. Guides users on what information to include. | Low | Template field, pre-fill description textarea |
| **Template selection on request creation** | Dropdown/radio to select template before filling form. "Start from template" option. | Medium | UI update to request creation flow |
| **Template listing for users** | Users see available templates for their department. | Low | Query templates WHERE department_id = user.department |
| **Department-specific templates** | Templates are associated with departments. Engineering sees engineering templates. | Low | Template.departmentId foreign key |
| **Template modification** | Admin can edit existing templates. Changes apply to new requests only (no retroactive changes). | Low | Edit form, UPDATE query |

#### Differentiators (Nice to Have)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Conditional field logic** | Show/hide fields based on previous responses. "If type=urgent, show priority field." | High | Conditional rendering, state management. High value but complex. |
| **Custom field definitions** | Template defines additional fields beyond default (title, description, files). | High | Flexible schema, dynamic form rendering. Major feature. |
| **Field validation rules** | Template specifies required fields, character limits, number ranges. | Medium | Validation schema per template, merge with base validation |
| **Template categories** | Group templates: "Equipment Request", "Maintenance Request", "Design Request" | Low | Template.category field, filter by category |
| **Template usage analytics** | Show which templates are most used. Helps identify common request types. | Medium | Track template_id on requests, aggregate usage |
| **Template preview** | Admin sees what request form looks like before saving template. | Medium | Render form from template definition in preview mode |
| **Template versioning** | Keep template history. "What did template look like when request X was created?" | High | Template versions table. Complex but useful for audit compliance. |
| **Pre-filled file requirements** | Template specifies "Please attach: technical drawing, cost estimate" as guidance. | Low | Template field, show as placeholder in file upload section |
| **Default approver suggestions** | Template suggests which approval chain to use. Still configurable per department. | Low | Template references ApprovalChain, pre-select in UI |

#### Anti-Features (Explicitly Avoid)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Form builder with drag-and-drop** | Over-engineered for ~5-10 templates. Manual template entry sufficient. | Simple form with text inputs for title pattern, description. Add form builder if template count grows significantly. |
| **Workflow automation based on template** | "If template=X, skip approval level 2" adds routing complexity to already-working approval engine. | Keep approval routing separate. Template only affects request content, not workflow. |
| **Public template gallery** | Internal tool, not multi-tenant SaaS. No need to share templates across organizations. | Templates scoped to single deployment. |
| **Template marketplace/imports** | No external template sources. Templates are organization-specific. | Create templates manually for this organization's workflows. |
| **Dynamic approval chains per template** | Approval chains are per-department, configured by admin. Template shouldn't override this. | Keep approval configuration in hierarchy builder. Template is for request content only. |

### E. Mobile-Responsive Design

Features for usable approval workflow on smartphones and tablets.

#### Table Stakes Features

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| **Responsive layout (320px to 1920px+)** | App must work on phone, tablet, desktop. Breakpoints at 640px, 768px, 1024px, 1280px. | Medium | Tailwind responsive classes, test at each breakpoint |
| **Touch-friendly tap targets** | Buttons minimum 44x44px (iOS guideline). Adequate spacing between interactive elements. | Low | Adjust button padding, spacing in mobile breakpoints |
| **Readable text without zoom** | Font sizes scale appropriately. Body text minimum 16px on mobile to avoid browser zoom. | Low | Responsive typography, text-base or larger |
| **Single-column layouts on mobile** | Multi-column layouts stack vertically on narrow screens. | Medium | Flexbox/Grid with responsive classes |
| **Mobile-optimized tables** | TanStack Table adapts to narrow screens. Consider card view or horizontal scroll. | Medium | Responsive table component or stacked card layout for mobile |
| **Hamburger menu for navigation** | Top-level navigation collapses to hamburger on mobile. | Medium | Mobile menu component, toggle state |
| **Mobile-optimized forms** | Form inputs stack vertically, full-width on mobile. Appropriate keyboard types (email, number). | Low | Responsive form layout, input type attributes |
| **File upload on mobile** | Works with mobile camera and file picker. | Low | input type="file" with accept attribute, test camera access |

#### Differentiators (Nice to Have)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Mobile-first approval actions** | Quick approve/reject from mobile without scrolling. Sticky action bar at bottom. | Medium | Fixed position action bar, z-index management |
| **Swipe gestures** | Swipe left/right to navigate between requests on mobile. | High | Touch event handlers, gesture library. Nice UX but not critical. |
| **Progressive Web App (PWA)** | Add to home screen, offline support, app-like experience. | Medium | Service worker, manifest.json, caching strategy |
| **Push notifications for approvals** | Mobile browser push when approval is needed. Actionable notifications with approve/reject buttons. | High | Web Push API, notification service, user permission flow. High value but complex. |
| **Dark mode** | Reduces eye strain, saves battery on OLED screens. | Medium | Dark theme variants in Tailwind, theme toggle |
| **Optimized images for mobile** | Responsive images, lazy loading, WebP format for faster load on cellular. | Medium | Next.js Image component, responsive sizes |
| **Offline indicator** | Show when user is offline, queue actions for when connection returns. | Medium | Network status detection, queue with retry logic |
| **Mobile-specific dashboard** | Condensed dashboard view optimized for mobile screen. Key metrics only. | Medium | Alternative layout for <768px, show subset of widgets |

#### Anti-Features (Explicitly Avoid)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Native mobile app (iOS/Android)** | Explicitly out of scope for v1.1. Web-first approach. | Responsive web app. Add native app in future milestone if needed. |
| **Mobile-specific features** | Feature parity across devices. Don't create features that only work on mobile. | Responsive design for all features. Mobile optimizes layout, not functionality. |
| **Biometric authentication** | Clerk handles auth. Adding device biometrics is complex and not requested. | Use Clerk's existing mobile auth. Biometrics are on Clerk's roadmap. |
| **Shake to undo** | Gimmicky gesture. Users expect standard undo UI, not motion gestures. | Confirmation dialogs for destructive actions. Standard undo pattern if needed. |
| **Mobile-only navigation patterns** | Bottom tab bar is mobile-native pattern. Web users expect sidebar/top nav. | Single navigation system that adapts responsively. Don't diverge patterns. |
| **Excessive animations** | Animations on mobile can feel slow, drain battery. Preference for reduced motion. | Subtle transitions only. Respect prefers-reduced-motion. |

## Feature Dependencies

### Critical Dependencies (Must Build in Order)

```
Docker Deployment
  └─> Health Check Script (depends on deployed services)

Analytics Dashboard
  ├─> Chart Library (Recharts)
  └─> Aggregation Queries (no dependencies)

Reporting
  ├─> Excel Library (exceljs)
  ├─> PDF Library (@react-pdf/renderer)
  └─> Can reuse analytics queries

Templates
  └─> No dependencies (independent feature)

Mobile Responsive
  └─> No dependencies (applies to all pages)
```

### Integration Points

- **Reporting + Analytics**: Reports can include analytics charts if PDF chart rendering implemented
- **Templates + Mobile**: Template selection UI must work on mobile
- **Deployment + Everything**: All features must work in Docker environment

## MVP Recommendations for v1.1

### Must Have (Blocks milestone completion)

1. **Docker Deployment** - All table stakes features
   - Multi-stage build, Compose orchestration, health checks, restart policies
   - Deployment documentation for Hostinger VPS + internal VM

2. **Analytics Dashboard** - Core metrics only
   - Approval time, request volume, department breakdown, status distribution
   - Basic charts (line, bar, pie)
   - Time range filtering

3. **Basic Reporting** - Excel and PDF
   - Request summary report with date/department/status filters
   - Excel export with single sheet
   - PDF export with basic formatting

4. **Request Templates** - Simple implementation
   - Template CRUD for admins
   - Title pattern and description pre-fill
   - Template selection on request creation

5. **Mobile Responsive** - All table stakes
   - Responsive layouts, touch-friendly targets, mobile forms
   - Focus on approval workflow pages (most critical for mobile)

### Defer to Post-v1.1

1. **Advanced Analytics**
   - User-level performance metrics
   - Comparison to previous period
   - Real-time updates

2. **Advanced Reporting**
   - PDF with charts
   - Multiple Excel sheets
   - Batch export

3. **Advanced Templates**
   - Conditional field logic
   - Custom field definitions
   - Template versioning

4. **Advanced Mobile**
   - PWA capabilities
   - Push notifications
   - Offline support

## Complexity Summary

| Feature Area | Low Complexity | Medium Complexity | High Complexity |
|--------------|----------------|-------------------|-----------------|
| Docker Deployment | 8 features | 3 features | 0 features |
| Analytics Dashboard | 3 features | 4 features | 1 feature |
| Reporting | 5 features | 5 features | 1 feature |
| Templates | 6 features | 4 features | 3 features |
| Mobile Responsive | 4 features | 6 features | 2 features |

**Total:** 26 low, 22 medium, 7 high complexity features catalogued

## Implementation Priority

For v1.1 execution, build in this order:

1. **Docker Deployment Infrastructure** (Week 1)
   - Required for all other features to deploy
   - Independent of application features

2. **Mobile Responsive Design** (Week 2)
   - Applies to all pages, including new features
   - Better to build responsive from start

3. **Request Templates** (Week 3)
   - Simplest of the UX features
   - No external dependencies

4. **Analytics Dashboard** (Week 4)
   - Requires data aggregation queries
   - Provides data for reporting

5. **Basic Reporting** (Week 5)
   - Can reuse analytics queries
   - PDF/Excel libraries independent

## Technology Recommendations

| Feature Area | Recommended Library | Version | Rationale |
|--------------|---------------------|---------|-----------|
| Charts | Recharts | ^2.x | React-native, declarative, built on D3. Best for React integration. |
| PDF Generation | @react-pdf/renderer | ^4.x | React components for PDFs. Aligns with existing React codebase. |
| Excel Export | exceljs | ^4.x | Full-featured, supports styling and multiple sheets. Better than xlsx for complex exports. |
| Mobile Touch | Native React | - | No library needed. Use onTouchStart/onTouchEnd if custom gestures required. |

## Scope Guard

For v1.1, remember:

- **Scale: 30 users, single server** - Don't over-engineer for enterprise scale
- **Internal tool** - Polish is important, but perfection isn't required
- **v1.0 is shipped and working** - These are enhancements, not core workflow
- **Budget complexity** - High complexity features should be 20% of work, not 80%

## Sources

### Docker Deployment
- [How to Build and Run Next.js Applications with Docker, Compose, & NGINX](https://www.docker.com/blog/how-to-build-and-run-next-js-applications-with-docker-compose-nginx/)
- [Docker Compose: The Complete Guide for 2026](https://devtoolbox.dedyn.io/blog/docker-compose-complete-guide)
- [Dockerizing a Next.js and Node.js App with PostgreSQL and Prisma: A Complete Guide](https://medium.com/@abhijariwala/dockerizing-a-next-js-and-node-js-app-with-postgresql-and-prisma-a-complete-guide-000527023e99)
- [How to use Prisma in Docker - Prisma Documentation](https://www.prisma.io/docs/guides/docker)
- [Setup Next.js with Postgres, Prisma and Docker Compose locally](https://jean-marc.io/blog/setup-next.js-with-postgres-prisma-docker)

### Analytics & Reporting
- [Approval workflow: definition, functionality and KPIs in Procurement](https://en.tacto.ai/buyer-lexicon/release-workflow)
- [What is a KPI Dashboard? Complete Guide to Key Performance Indicators Dashboards 2026](https://improvado.io/blog/kpi-dashboard)
- [Workflow Metrics: Reports - Liferay Official Documentation](https://learn.liferay.com/w/dxp/process-automation/workflow/using-workflows/workflow-metrics-reports)

### PDF/Excel Libraries
- [Top 6 Open-Source PDF Libraries for React Developers](https://blog.react-pdf.dev/6-open-source-pdf-generation-and-modification-libraries-every-react-dev-should-know-in-2025)
- [React PDF Generator (Developer Tutorial)](https://ironpdf.com/nodejs/blog/node-pdf-tools/react-pdf-generator-tutorial/)
- [ExcelJS GitHub](https://github.com/exceljs/exceljs)
- [Export Excel files in Node.js](https://usecsv.com/community/export-excel-files-in-node-js)

### Request Templates
- [Approval Workflow Process Feature - Formstack](https://www.formstack.com/features/approval-workflow)
- [32 Best Approval Workflow Software Solutions In 2026](https://thedigitalprojectmanager.com/tools/best-approval-workflow-software/)
- [Conditional Logic in Forms](https://fluentforms.com/conditional-logic/)
- [5 Best Form Builders with Conditional Logic (2026 Update)](https://www.involve.me/blog/best-form-builders-with-conditional-logic)

### Mobile Design
- [Approval Workflow Design Patterns: Real Examples & Best Practices](https://www.cflowapps.com/approval-workflow-design-patterns/)
- [App Push Notification Best Practices for 2026](https://appbot.co/blog/app-push-notifications-2026-best-practices/)
- [Design Guidelines For Better Notifications UX](https://www.smashingmagazine.com/2025/07/design-guidelines-better-notifications-ux/)
- [What are Actionable Notifications?](https://www.mobiloud.com/blog/what-are-actionable-notifications)

### Chart Libraries
- [The Top 5 React Chart Libraries to Know in 2026 for Modern Dashboards](https://www.syncfusion.com/blogs/post/top-5-react-chart-libraries)
- [Best Chart Libraries for React Projects in 2026](https://weavelinx.com/best-chart-libraries-for-react-projects-in-2026/)
- [8 Best React Chart Libraries for Visualizing Data in 2025](https://embeddable.com/blog/react-chart-libraries)

---
*v1.1 Feature Research: Production Deployment + Analytics & UX*
*Researched: 2026-02-13*
*Confidence: MEDIUM-HIGH (verified with 2026 sources, scoped for 30-user internal deployment)*
