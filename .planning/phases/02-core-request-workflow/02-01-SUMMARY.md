---
phase: 02-core-request-workflow
plan: 01
subsystem: database
tags: [prisma, postgresql, request-workflow, audit-trail, status-tracking]

# Dependency graph
requires:
  - phase: 01-foundation-authentication
    provides: User model with Clerk user IDs, Department model, authentication foundation
  - phase: 01.2-fix-data-consistency
    provides: User creation transaction patterns, dual-write consistency
provides:
  - Request data model with five-state status workflow (ImprovementRequest, SentToEngineer, DesignCostEstimationApproval, SendBackToRequester, Completed)
  - FileAttachment model for file metadata (actual files stored in S3 via s3Key reference)
  - RequestActivity model for complete audit trail of all status changes, approvals, and actions
  - Foreign key relationships linking requests to users and departments
  - Database indexes on frequently queried fields for performance
affects: [02-02-request-api-routes, 02-03-request-ui, 03-file-storage-integration, 04-notification-system]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Status enum pattern for request workflow states
    - Cascade delete pattern (file_attachments and request_activities deleted when request deleted)
    - Audit trail pattern (RequestActivity tracks all actions with from/to status, comments, user, timestamp)
    - Foreign key relations with @@map snake_case convention (PostgreSQL)
    - Composite indexes on frequently queried fields (requesterId, departmentId, status, createdAt)

key-files:
  created: [prisma/migrations/]
  modified: [prisma/schema.prisma]

key-decisions:
  - "RequestStatus enum uses descriptive names matching business workflow (ImprovementRequest → SentToEngineer → DesignCostEstimationApproval → Completed)"
  - "FileAttachment stores only metadata (fileName, fileType, fileSize, s3Key) - actual files stored in S3 for scalability"
  - "RequestActivity tracks fromStatus and toStatus separately for status changes - enables reconstruction of complete state history"
  - "Cascade delete on request deletion removes associated file_attachments and request_activities - prevents orphaned records"
  - "Indexes on requesterId, departmentId, status, and createdAt for common query patterns (user's requests, department requests, status filtering, date sorting)"

patterns-established:
  - "Request workflow: Requests flow through five states with audit trail logging"
  - "File reference pattern: Store S3 key in database, actual files in object storage"
  - "Activity log pattern: All actions logged with actor, timestamp, action type, and contextual data"

# Metrics
duration: 0min
completed: 2026-01-31
---

# Phase 02 Plan 01: Request data model with status tracking and audit trail

**Prisma schema with Request, FileAttachment, and RequestActivity models; RequestStatus enum with five workflow states; database migration applied with indexes and cascade delete**

## Performance

- **Duration:** 0 min (checkpoint verification completed by user)
- **Started:** 2026-01-31
- **Completed:** 2026-01-31
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Request model with title, description, status, requester relation, department relation, and timestamps
- FileAttachment model for file metadata (fileName, fileType, fileSize, s3Key, description) with uploader relation
- RequestActivity model for complete audit trail (action, fromStatus, toStatus, comments, user, timestamp)
- RequestStatus enum defining five workflow states (ImprovementRequest, SentToEngineer, DesignCostEstimationApproval, SendBackToRequester, Completed)
- User and Department models extended with new relations (createdRequests, uploadedFiles, activities, requests)
- Database migration applied successfully with foreign key constraints, indexes, and cascade delete
- User verified schema via Prisma Studio - confirmed tables, columns, and relationships

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend Prisma schema with Request, FileAttachment, and RequestActivity models** - `8f9b79b` (feat)
2. **Task 2: Generate and run Prisma migration** - `5810258` (feat)
3. **Task 3: Database schema verification** - User approved via checkpoint

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `prisma/schema.prisma` - Extended with Request, FileAttachment, RequestActivity models; RequestStatus enum; User and Department relations
- `prisma/migrations/` - New migration folder with migration.sql creating requests, file_attachments, request_activities tables

## Decisions Made

**From schema design:**
- RequestStatus enum uses descriptive business-language names instead of generic states (e.g., "ImprovementRequest" not "draft") - improves code readability and database debugging
- FileAttachment.s3Key stores S3 object path instead of full URL - enables changing CDN/domain without data migration
- RequestActivity stores both fromStatus and toStatus as nullable fields - single model handles both status changes and non-status actions (file_attached, approved, etc.)
- Cascade delete from Request to FileAttachment and RequestActivity - prevents orphaned records when request deleted
- Indexes on requesterId, departmentId, status, and createdAt - optimizes common query patterns (user's requests, department requests, status filtering, date sorting)

**From migration strategy:**
- Used `npx prisma migrate dev --name add_request_workflow_models` - descriptive migration name for easy identification
- Applied migration immediately after schema changes - maintains sync between schema.prisma and database

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - schema changes and migration applied successfully without errors.

## User Setup Required

None - no external service configuration required for this plan.

## Next Phase Readiness

- Request data model complete and verified via Prisma Studio
- Foreign key relationships correctly defined and tested
- Indexes in place for common query patterns
- Cascade delete behavior verified
- Ready for Phase 02-02 (Request API Routes) to build CRUD endpoints and status transition logic

**Next steps:**
- Implement API routes for creating, updating, and deleting requests
- Implement status transition logic with validation
- Implement activity logging for all state changes
- Build request list and detail UI components

---
*Phase: 02-core-request-workflow*
*Plan: 01*
*Completed: 2026-01-31*
