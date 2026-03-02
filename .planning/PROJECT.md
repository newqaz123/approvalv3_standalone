# Approval Flow System

## What This Is

An internal document approval workflow system for ~30 users. Requesters from general departments submit requests that route through configurable approval chains to engineering for survey, design, and cost estimation. Engineering provides solutions that route back through approvals to requesters. The system replaces email-based tracking with centralized visibility, status tracking, and audit trails.

**Current State (v1.0 SHIPPED):** System fully operational with complete user management, request workflow, approval engine, engineering solutions, dashboard visibility, immutable audit trail, and admin configuration tools.

## Current Milestone: v1.1 Production Deployment + Analytics & UX

**Goal:** Make deployment easy on any Linux server (VPS or VM) AND add analytics, reporting, templates, and mobile support

**Target features:**
- Docker Compose deployment infrastructure with step-by-step documentation
- Real-Time Analytics Dashboard (approval trends, bottlenecks, metrics)
- Basic Reporting with export capabilities (PDF/Excel)
- Request Templates for common submissions
- Mobile-Friendly responsive design

## Core Value

Everyone can track requests with full visibility and accountability — no more lost work in email chains.

## Requirements

### Validated

- ✅ User authentication with role-based access control (Admin, Engineering, General Department) — v1.0
- ✅ User and department management with complete CRUD operations — v1.0
- ✅ Level-based user assignment for approval hierarchies — v1.0
- ✅ Request creation with form validation and file attachments — v1.0
- ✅ Configurable level-based approval hierarchies per department — v1.0
- ✅ Any-one-per-level approval logic — v1.0
- ✅ Sequential approval routing through configured levels — v1.0
- ✅ Approve/reject with required comments — v1.0
- ✅ Engineering solution routing with custom approval chains — v1.0
- ✅ Manual completion marking for engineering users — v1.0
- ✅ Requester and engineer cancellation workflow — v1.0
- ✅ Request status tracking through workflow stages — v1.0
- ✅ Dashboard views (My Requests, Pending Approval, All Requests) — v1.0
- ✅ Search and filter by department, status, date — v1.0
- ✅ Activity timeline with day-grouped chronological events — v1.0
- ✅ Immutable audit trail with PostgreSQL triggers — v1.0
- ✅ Admin UI for user and department management — v1.0
- ✅ Read-only workflow configuration view — v1.0
- ✅ Drag-and-drop hierarchy builder — v1.0
- ✅ Request archival and deletion controls — v1.0
- ✅ Audit trail export (CSV/JSON) — v1.0
- ✅ Admin edit functionality for users and departments — v1.0
- ✅ External approver support for cross-department approvals — v1.0

### Active

- [ ] Production-ready Docker Compose deployment infrastructure
- [ ] Step-by-step deployment documentation (Hostinger VPS + VMware/internal)
- [ ] Environment template (.env.example) with all required variables
- [ ] Health check script to verify deployment success
- [ ] Update process documentation (pull image + restart)
- [ ] Real-Time Analytics Dashboard with charts and metrics
- [ ] Basic Reporting with PDF/Excel export
- [ ] Request Templates for common submissions
- [ ] Mobile-Friendly responsive design optimization

### Out of Scope

- Real-time enhanced notifications (beyond v1 basic email) — defer to future milestone
- Mobile native application — web-first approach, native mobile later if needed
- Integration with E-ordering system — manual export sufficient for current workflow
- External user access — internal users only
- SLA management with auto-escalation — defer to future milestone

## Context

**Current Environment:**
- 30 users across 11 general departments (QC, OSEC, PD1, PD2, PD3, WWT, Utility, BM, TTEC, ADMIN, Maintenance) and 1 engineering department
- Current process uses email for request submission and solution delivery
- Pain points: requests get lost, can't track progress, no approval accountability
- Approval hierarchies change annually as personnel move

**Workflow Endpoint:**
- System workflow ends at SendBackToRequester status
- Requester takes solution files and approved evidence to external E-ordering system
- Engineering marks request as Completed in this system for tracking purposes

**User Roles:**
- Admin: System configuration only, no request handling
- General department users: Create requests, approve within hierarchy
- Engineering users: Submit solutions, approve within hierarchy
- All users: View dashboards and all requests (with appropriate action permissions)

**Tech Stack (v1.0):**
- Next.js 15 with App Router
- TypeScript (22,172 LOC)
- Clerk for authentication
- Prisma ORM with PostgreSQL
- shadcn/ui components
- TanStack Table for data display
- Local file storage (public/uploads/)
- Resend for email notifications

## Constraints

- **Approval Logic**: Must support level-based hierarchies with any-one approval per level
- **Audit Requirements**: All actions must be logged with timestamp, user, and comments
- **File Handling**: Must support document uploads with descriptions for requests and solutions
- **Configurability**: Approval hierarchies must be admin-configurable via drag-and-drop UI

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Level-based approval with any-one-per-level | Departments have multiple users at same rank, any can approve | ✅ Validated (v1.0) |
| Manual completion after SendBackToRequester | Integration point with E-ordering system, need tracking closure | ✅ Validated (v1.0) |
| Admin-only workflow configuration | Prevents accidental changes to approval chains | ✅ Validated (v1.0) |
| Local file storage instead of S3 | User-approved for easier VPS deployment, no AWS dependencies | ✅ Validated (v1.0) |
| JWT metadata in middleware + database checks in Server Actions | Edge runtime compatibility + defense-in-depth security | ✅ Validated (v1.0) |
| RequestActivity.requestId optional | Single source of truth for audit trail without separate system_activities table | ✅ Validated (v1.0) |
| Dual-write rollback pattern (delete Clerk user if Prisma create fails) | Prevents orphaned users when database operations fail | ✅ Validated (v1.0) |
| Drag-and-drop hierarchy builder with batch save | Allows multiple changes before committing, better UX than immediate-save-on-drop | ✅ Validated (v1.0) |

## Next Milestone Goals

**Status:** v1.1 in progress — Production Deployment + Analytics & UX

**Active focus areas:**
- Deployment infrastructure (Docker, documentation, health checks)
- Analytics and reporting capabilities
- User experience improvements (templates, mobile)

**Technical debt being addressed in v1.1:**
- Console.log statements in drag-and-drop handlers — removing for production
- Local file storage backup strategy — implementing as part of deployment infrastructure
- Production optimization — cleaning up development artifacts

---
*Last updated: 2026-02-13 after v1.1 milestone initialization*
