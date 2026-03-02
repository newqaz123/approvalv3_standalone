# Roadmap: Approval Flow System

## Overview

This roadmap delivers an internal approval workflow system for ~30 users that replaces email-based tracking with centralized visibility.

## Milestones

- ✅ **v1.0 Core Approval Workflow System** — Phases 1-8 (shipped 2026-02-13)
- ✅ **v1.1 Production Deployment + Analytics & UX** — Phases 9-13 (shipped 2026-02-20)
- 🔄 **v1.2 Performance Optimization** — Phases 14 (active)

## Phases

<details>
<summary>✅ v1.0 Core Approval Workflow System (Phases 1-8) — SHIPPED 2026-02-13</summary>

**Delivered:** Internal approval workflow system for ~30 users with authentication, request submission, configurable approval hierarchies, engineering solutions, and complete admin management.

- ✅ Phase 1: Foundation & Authentication (5/5 plans) — completed 2025-01-31
- ✅ Phase 1.1: Fix Critical Authentication & Security (2/2 plans) — completed 2025-01-31
- ✅ Phase 1.2: Fix Data Consistency (2/2 plans) — completed 2025-01-31
- ✅ Phase 2: Core Request Workflow (3/3 plans) — completed 2026-02-02
- ✅ Phase 3: Approval Engine (3/3 plans) — completed 2026-02-01
- ✅ Phase 4: Engineering Solutions (21/21 plans) — completed 2026-02-05
- ✅ Phase 4.1: Auto Refresh Overlay (5/5 plans) — completed 2026-02-06
- ✅ Phase 5: Dashboard & Visibility (5/5 plans) — completed 2026-02-06
- ✅ Phase 6: Audit & Compliance (4/4 plans) — completed 2026-02-08
- ✅ Phase 7: Configuration & Administration (10/10 plans) — completed 2026-02-11
- ✅ Phase 8: Complete Admin Management (3/3 plans) — completed 2026-02-13

**Total:** 63 plans executed

**See:** `.planning/milestones/v1.0-ROADMAP.md` for complete phase details

</details>

### ✅ v1.1 Production Deployment + Analytics & UX (Complete)

**Milestone Goal:** Make deployment easy on any Linux server (VPS or VM) AND add analytics, reporting, templates, and mobile support

**Requirements:** 40 v1.1 requirements across Deployment (15), Analytics (6), Reporting (4), Templates (6), Mobile (9)

#### Phase 9: Docker Deployment Infrastructure
**Goal**: System deploys on any Linux server with one command
**Depends on**: Nothing (v1.0 complete)
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05, DEPLOY-06, DEPLOY-07, DEPLOY-08, DEPLOY-09, DEPLOY-10, DEPLOY-11, DEPLOY-12, DEPLOY-13, DEPLOY-14, DEPLOY-15
**Success Criteria** (what must be TRUE):
  1. User can deploy the system on a fresh Linux server (Hostinger VPS or VMware VM) using docker compose up
  2. All services (app + database) start automatically and pass health checks
  3. File uploads persist across container restarts without data loss
  4. Database migrations run automatically on deployment
  5. User can update the system by pulling new image and restarting without losing data
**Plans**: 5 plans

Plans:
- ✅ 09-01-PLAN.md — Configure Next.js containerization (Dockerfile + Standalone) — completed 2026-02-14
- ✅ 09-02-PLAN.md — Set up Docker Compose orchestration — completed 2026-02-14
- ✅ 09-03-PLAN.md — Create lifecycle automation scripts (setup, deploy, backup) — completed 2026-02-14
- ✅ 09-04-PLAN.md — Document deployment and verify locally — completed 2026-02-15
- ✅ 09-05-PLAN.md — Gap Closure - Health Monitoring — completed 2026-02-15

#### Phase 10: Request Templates
**Goal**: Users can create requests from standardized templates
**Depends on**: Phase 9 (Docker environment needed for database migration testing)
**Requirements**: TMPL-01, TMPL-02, TMPL-03, TMPL-04, TMPL-05, TMPL-06
**Success Criteria** (what must be TRUE):
  1. Admin can create templates with predefined title patterns and description content
  2. Templates are available to all users (global access)
  3. User sees templates in dropdown when creating a request
  4. User can select a template and the request form pre-fills with template content
  5. Admin can edit existing templates and changes apply to new requests only
  6. Admin can mark a template as Default to pre-select it
**Plans**: 2 plans

Plans:
- ✅ 10-01-PLAN.md — Implement backend data model and admin interface for Request Templates — completed 2026-02-16
- ✅ 10-02-PLAN.md — Integrate templates into User Request creation workflow — completed 2026-02-16

#### Phase 11: Mobile-Responsive Design
**Goal**: System works seamlessly on mobile devices (320px to 1920px+)
**Depends on**: Phase 9 (deployment environment stable)
**Requirements**: MOBL-01, MOBL-02, MOBL-03, MOBL-04, MOBL-05, MOBL-06, MOBL-07, MOBL-08, MOBL-09
**Success Criteria** (what must be TRUE):
  1. User can navigate the system on a mobile phone with touch-friendly tap targets (44x44px minimum)
  2. User can read all text on mobile without zooming (16px minimum body text)
  3. Tables display correctly on mobile using card view or horizontal scroll
  4. User can submit requests from mobile with working file uploads (camera + file picker)
  5. User can approve/reject requests on mobile with sticky action bar for quick workflow
**Plans**: 9 plans (6 initial + 3 gap closure)

Plans:
- ✅ 11-01-PLAN.md — Install mobile dependencies and create smart scroll navigation — completed 2026-02-16
- ✅ 11-02-PLAN.md — Transform tables into mobile card views — completed 2026-02-16
- ✅ 11-03-PLAN.md — Convert modals to bottom sheet drawers with sticky approval bar — completed 2026-02-16
- ✅ 11-04-PLAN.md — Make request form mobile-friendly with camera upload — completed 2026-02-16
- ✅ 11-05-PLAN.md — Apply global mobile styles and adapt remaining views — completed 2026-02-16
- ✅ 11-06-PLAN.md — Gap Closure - Fix Mobile Navigation Routes (UAT Test 4) — completed 2026-02-16
- ✅ 11-07-PLAN.md — Gap Closure - Admin Mobile Layout Fixes (UAT Tests 1, 2, 3, 16) — completed 2026-02-16
- ✅ 11-08-PLAN.md — Gap Closure - Sticky Approval Bar (UAT Test 10) — completed 2026-02-16
- ✅ 11-09-PLAN.md — Gap Closure - Interactive Reject Dialog (UAT Test 11) — completed 2026-02-16

#### Phase 12: Analytics Dashboard
**Goal**: Users can visualize approval metrics and trends
**Depends on**: Phase 11 (charts must work on mobile)
**Requirements**: ANLY-01, ANLY-02, ANLY-03, ANLY-04, ANLY-05, ANLY-06
**Success Criteria** (what must be TRUE):
  1. User can view a pipeline chart showing request count at each workflow step with status breakdown
  2. User can see approval time metrics (average per request, average per approval level)
  3. User can filter analytics by time range (7/30/90 days or custom range)
  4. User can see department breakdown of request counts
**Plans**: 5 plans

Plans:
- ✅ 12-01-PLAN.md — Analytics foundation (Recharts, types, server actions) — completed 2026-02-18
- ✅ 12-02-PLAN.md — Analytics page structure (route, loading, client wrapper, summary cards) — completed 2026-02-18
- ✅ 12-03-PLAN.md — Workflow pipeline and department breakdown charts — completed 2026-02-18
- ✅ 12-04-PLAN.md — Time metrics chart with statistics — completed 2026-02-18
- ✅ 12-05-PLAN.md — Filter controls with URL-based state management — completed 2026-02-18

#### Phase 13: PDF/Excel Reporting
**Goal**: Users can export approval documentation as PDF
**Depends on**: Phase 9 (Puppeteer needs Chromium in Docker), Phase 11 (export UI works on mobile)
**Requirements**: REPT-01, REPT-02, REPT-03, REPT-04
**Success Criteria** (what must be TRUE):
  1. User can export a 1-page A4 PDF for requests with FinalApproval status where all approvers have approved
  2. PDF contains topic, description, request details, engineering solution details, and attached file names
  3. PDF includes full approval history log with approver name, timestamp, level, approval/rejection status, and comments
**Plans**: 3 plans

Plans:
- ✅ 13-01-PLAN.md — Install Puppeteer and configure Docker support — completed 2026-02-20
- ✅ 13-02-PLAN.md — Create Server Action with validation and rate limiting — completed 2026-02-20
- ✅ 13-03-PLAN.md — Create ExportPDFButton component and integrate views — completed 2026-02-20

### ✅ v1.2 Performance Optimization (Complete)

**Milestone Goal:** Optimize application performance using Vercel's React/Next.js best practices

#### Phase 14: Apply Vercel React Best Practices
**Goal**: Optimize React/Next.js code using Vercel's 57 performance rules across 8 categories
**Depends on**: Phase 13 (v1.1 complete)
**Success Criteria** (what must be TRUE):
  1. Eliminate data-fetching waterfalls using parallel requests and deferred awaits
  2. Reduce bundle size through dynamic imports, barrel file elimination, and conditional loading
  3. Optimize server-side performance with React.cache(), LRU caching, and parallel fetching
  4. Minimize client re-renders using memo, derived state, and proper dependency management
  5. Improve rendering performance with content-visibility, JSX hoisting, and Activity components
**Plans**: 7 plans

Plans:
- ✅ 14-01-PLAN.md — Eliminate data-fetching waterfalls with parallel analytics queries — completed 2026-03-01
- ✅ 14-02-PLAN.md — Parallelize request detail page data fetching — completed 2026-03-01
- ✅ 14-03-PLAN.md — Implement React.cache() for user data deduplication — completed 2026-03-01
- ✅ 14-04-PLAN.md — Optimize lucide-react imports with optimizePackageImports — completed 2026-03-01
- ✅ 14-05-PLAN.md — Dynamic import heavy chart and PDF components — completed 2026-03-01
- ✅ 14-06-PLAN.md — Memoize derived state in table components — completed 2026-03-01
- ✅ 14-07-PLAN.md — Add content-visibility and hoist static JSX — completed 2026-03-01

**Details:**
Apply 57 performance rules from Vercel Engineering covering:
- Critical: Eliminating waterfalls, bundle size optimization
- High: Server-side performance, caching strategies
- Medium: Client-side data fetching, re-render optimization
- Low: JavaScript performance, advanced patterns

Skill reference: `.agents/skills/vercel-react-best-practices/`

## Progress

**Execution Order:** Phases execute in numeric order: 9 → 10 → 11 → 12 → 13

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Authentication | v1.0 | 5/5 | ✅ Complete | 2025-01-31 |
| 1.1. Fix Critical Auth & Security | v1.0 | 2/2 | ✅ Complete | 2025-01-31 |
| 1.2. Fix Data Consistency | v1.0 | 2/2 | ✅ Complete | 2025-01-31 |
| 2. Core Request Workflow | v1.0 | 3/3 | ✅ Complete | 2026-02-02 |
| 3. Approval Engine | v1.0 | 3/3 | ✅ Complete | 2026-02-01 |
| 4. Engineering Solutions | v1.0 | 21/21 | ✅ Complete | 2026-02-05 |
| 4.1. Auto Refresh Overlay | v1.0 | 5/5 | ✅ Complete | 2026-02-06 |
| 5. Dashboard & Visibility | v1.0 | 5/5 | ✅ Complete | 2026-02-06 |
| 6. Audit & Compliance | v1.0 | 4/4 | ✅ Complete | 2026-02-08 |
| 7. Configuration & Administration | v1.0 | 10/10 | ✅ Complete | 2026-02-11 |
| 8. Complete Admin Management | v1.0 | 3/3 | ✅ Complete | 2026-02-13 |
| 9. Docker Deployment Infrastructure | v1.1 | 5/5 | ✅ Complete | 2026-02-15 |
| 10. Request Templates | v1.1 | 2/2 | ✅ Complete | 2026-02-16 |
| 11. Mobile-Responsive Design | v1.1 | 9/9 | ✅ Complete | 2026-02-16 |
| 12. Analytics Dashboard | v1.1 | 5/5 | ✅ Complete | 2026-02-18 |
| 13. PDF/Excel Reporting | v1.1 | 3/3 | ✅ Complete | 2026-02-20 |
| 14. Apply Vercel React Best Practices | v1.2 | 7/7 | ✅ Complete | 2026-03-01 |

**v1.0 Complete:** 63/63 plans (100%)
**v1.1 Complete:** 26/26 plans (100%)
**v1.2 Complete:** 7/7 plans (100%)

---
*Requirements defined: 2026-02-14*
*Last updated: 2026-03-01 - Phase 14 added for Vercel React best practices optimization*
