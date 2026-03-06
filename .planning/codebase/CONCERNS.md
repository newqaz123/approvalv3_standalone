# Codebase Concerns

**Analysis Date:** 2026-03-06

## Tech Debt

**Incomplete Features in Modal Router:**
- Issue: Several TODO comments in `request-modal-router.tsx` indicate incomplete implementation
- Files: `src/components/requests/request-modal-router.tsx` (lines 495, 612, 615, 634)
- Impact: SubmitFinalApprovalModal not fully implemented, `availableUsers` hardcoded to empty array, `rejectedAtLevel` not calculated
- Fix approach: Implement the missing TODO items - fetch available users from `/api/users` endpoint, calculate rejected level from approvals array, complete SubmitFinalApprovalModal integration

**Excessive TypeScript `any` Usage:**
- Issue: 157 occurrences of `any` type across server actions and components, reducing type safety
- Files: `src/server-actions/requests.ts` (47 occurrences), `src/server-actions/solutions.ts` (35 occurrences), `src/server-actions/analytics.ts` (11 occurrences)
- Impact: Loss of TypeScript benefits, potential runtime errors, harder refactoring
- Fix approach: Gradually replace `any` with proper interfaces - start with `modalData` and request/approval types, use Prisma generated types where possible

**Console Logging in Production:**
- Issue: 94 console.log/console.error statements throughout codebase
- Files: Scattered across components and server actions
- Impact: Performance degradation, potential information leakage in production, no structured logging
- Fix approach: Implement proper logging framework (e.g., Winston or Pino), remove debug logs, use structured logging with log levels

## Known Bugs

**N+1 Query Potential in Analytics:**
- Issue: Analytics data fetching uses parallel queries but may have N+1 patterns for metrics calculations
- Files: `src/server-actions/analytics.ts`
- Symptoms: Performance degradation as data volume grows
- Trigger: Viewing analytics dashboard with large datasets
- Workaround: None currently
- Fix approach: Add query batching, use Prisma's include/select more efficiently, consider materialized views for aggregated data

**File Upload Cleanup Issues:**
- Issue: File deletion errors are caught and logged but may leave orphaned files
- Files: `src/server-actions/requests.ts` (line 1004), `src/server-actions/files.ts`
- Symptoms: Storage not freed when requests are deleted
- Trigger: Soft delete operations where file deletion fails
- Workaround: Manual cleanup of uploads directory
- Fix approach: Implement retry logic for file deletion, create cleanup job for orphaned files, add monitoring for storage usage

## Security Considerations

**Environment Variable Exposure:**
- Risk: `NEXT_PUBLIC_APP_URL` falls back to localhost in email notifications
- Files: `src/server-actions/notifications.ts` (line 226)
- Current mitigation: Environment variable usage with fallback
- Recommendations: Remove localhost fallback, validate APP_URL format, ensure all production deployments set this variable

**Credentials Provider without Rate Limiting:**
- Risk: No rate limiting on authentication endpoint in auth configuration
- Files: `src/lib/auth-config.ts`
- Current mitigation: NextAuth built-in CSRF protection
- Recommendations: Implement rate limiting middleware, add account lockout after failed attempts, monitor for brute force attacks

**Cron Endpoint Protection:**
- Risk: Archive cron endpoint relies solely on `CRON_SECRET` for authentication
- Files: `src/app/api/cron/archive/route.ts`
- Current mitigation: Single secret check
- Recommendations: Add IP whitelist for cron service, use stronger authentication (e.g., JWT), implement request signing

**Audit Trail Integrity:**
- Risk: While audit trail has append-only protection, error handling in delete operations may bypass checks
- Files: `src/server-actions/requests.ts` (lines 1176-1187)
- Current mitigation: Database-level constraints mentioned in comments
- Recommendations: Verify database constraints are applied, add monitoring for audit trail modification attempts

**Password Hash Algorithm:**
- Risk: Using bcryptjs (JavaScript implementation) instead of native bcrypt
- Files: `src/server-actions/users.ts`, `src/lib/auth-config.ts`
- Current mitigation: bcryptjs is well-vetted
- Recommendations: Consider migrating to native bcrypt for better performance, ensure cost factor is appropriate (currently default)

## Performance Bottlenecks

**Large Server Action Files:**
- Problem: `requests.ts` (2,112 lines) and `solutions.ts` (1,948 lines) are monolithic
- Files: `src/server-actions/requests.ts`, `src/server-actions/solutions.ts`
- Cause: All request/solution operations in single files
- Impact: Longer cold starts, harder code navigation, potential memory issues
- Improvement path: Split into domain modules (e.g., `request-creation.ts`, `request-approval.ts`, `request-deletion.ts`)

**Unoptimized Prisma Queries:**
- Problem: Only 4 `.select()` or `.include()` patterns in requests.ts suggests over-fetching
- Files: `src/server-actions/requests.ts`, `src/server-actions/solutions.ts`
- Cause: Fetching full objects without field selection
- Impact: Increased memory usage, slower serialization, larger network payloads
- Improvement path: Add `.select()` to all queries, only fetch required fields, use query optimization tools

**Insufficient Transaction Usage:**
- Problem: Only 18 transactions across 234 Prisma queries
- Files: All server action files
- Cause: Individual operations not wrapped in transactions
- Impact: Risk of partial updates, data inconsistency on errors
- Improvement path: Wrap multi-step operations in transactions, especially for status changes and approval workflows

**Client-Side Polling:**
- Problem: Multiple 30-second intervals for notifications and pending counts
- Files: `src/components/mobile/mobile-nav.tsx`, `src/components/notifications/notification-bell.tsx`
- Cause: Polling-based updates instead of real-time
- Impact: Unnecessary server load, delayed updates, battery drain on mobile
- Improvement path: Implement Server-Sent Events or WebSocket connections, use push-based architecture

## Fragile Areas

**Request Modal Router Complexity:**
- Files: `src/components/requests/request-modal-router.tsx` (792 lines)
- Why fragile: Complex state machine with 10+ modal types, multiple useEffect hooks, nested conditionals
- Safe modification: Add comprehensive tests before changes, extract modal type logic to separate modules, use state machine library
- Test coverage: No unit tests detected (only Playwright E2E)

**Modal Data Adapters:**
- Files: `src/lib/modal-data-adapters.ts` (404 lines)
- Why fragile: Manual transformation between Prisma models and UI components, no validation
- Safe modification: Add TypeScript strict mode, use zod for runtime validation, test with edge cases
- Test coverage: No tests - transformations fail silently

**Approval Chain Logic:**
- Files: `src/server-actions/approvals.ts`, `src/server-actions/hierarchy.ts`
- Why fragile: Complex business rules, level calculations, sequential dependencies
- Safe modification: Document all edge cases, add integration tests for each rule, create approval chain validator
- Test coverage: Minimal - only E2E tests

**Dashboard State Management:**
- Files: `src/components/dashboard/dashboard-tabs.tsx`
- Why fragile: Multiple setTimeout references, manual interval management, complex state synchronization
- Safe modification: Refactor to custom hooks, use proper cleanup, implement state machine
- Test coverage: No unit tests for state transitions

## Scaling Limits

**Database Connection Pooling:**
- Current capacity: Single Prisma instance with default connection limits
- Limit: Will exhaust connections under high concurrent load (~100+ simultaneous users)
- Scaling path: Implement connection pooling (PgBouncer), add read replicas for analytics queries, use serverless connection patterns

**File Storage:**
- Current capacity: Local filesystem storage in `uploads/` directory
- Limit: Single-server constraint, no backup/replication, disk space bound to single server
- Scaling path: Migrate to object storage (S3, R2), implement CDN for file delivery, add automatic cleanup

**PDF Generation:**
- Current capacity: Puppeteer with chromium spawning per request
- Limit: Memory-intensive, single-server bound, ~10 concurrent PDFs before degradation
- Scaling path: Use dedicated PDF generation service, implement queue system, consider serverless PDF generation

**Notification System:**
- Current capacity: In-memory SMTP with nodemailer
- Limit: No retry logic, no queue, blocking operations on email send
- Scaling path: Implement message queue (Redis/Bull), add background job processor, use transactional email service

## Dependencies at Risk

**Next.js 15 with React 19:**
- Risk: Both are cutting-edge releases with potential breaking changes
- Impact: May encounter bugs in App Router, Server Components, or Server Actions
- Migration plan: Pin minor versions, monitor Next.js GitHub issues, maintain upgrade budget

**Zod v4:**
- Risk: Using v4 (alpha/beta) instead of stable v3
- Impact: Potential API changes, compatibility issues with ecosystem
- Migration plan: Evaluate if v4 features are essential, consider downgrading to v3 for stability

**Puppeteer:**
- Risk: Heavy dependency, frequent Chrome version updates
- Impact: PDF generation may break on Chrome updates
- Migration plan: Pin specific Chrome version, containerize Puppeteer operations, consider alternative PDF libraries

## Missing Critical Features

**Request/Response Validation:**
- Problem: No runtime validation on API routes and some server actions
- Blocks: Cannot guarantee data integrity, difficult to debug malformed requests
- Priority: High - add Zod validation to all API endpoints

**Error Boundary Implementation:**
- Problem: No React Error Boundaries to catch component errors
- Blocks: Poor user experience on component failures, difficult to track client-side errors
- Priority: Medium - implement error boundaries at route level

**Database Migration Rollback:**
- Problem: Prisma migrations lack rollback scripts
- Blocks: Risky deployments, difficult to revert bad migrations
- Priority: Medium - document rollback procedures, test migration rollback process

**API Rate Limiting:**
- Problem: No rate limiting on public or authenticated endpoints
- Blocks: Vulnerable to abuse, no protection against DoS
- Priority: High - implement rate limiting middleware

**Comprehensive Test Suite:**
- Problem: Only Playwright E2E tests, no unit or integration tests
- Blocks: Refactoring is risky, business logic not tested in isolation
- Priority: High - add Jest/Vitest for unit tests, increase test coverage to 80%+

## Test Coverage Gaps

**Server Actions:**
- What's not tested: All business logic, validation, error handling in 98 server action functions
- Files: `src/server-actions/*.ts`
- Risk: Bugs in approval logic, data corruption, edge cases not handled
- Priority: High - these are core business operations

**Data Adapters:**
- What's not tested: Modal data transformations, type conversions, null handling
- Files: `src/lib/modal-data-adapters.ts`
- Risk: Incorrect data display, null reference errors in UI
- Priority: Medium - UI relies on these transformations

**Permission Checks:**
- What's not tested: Authorization logic, role-based access, department-level permissions
- Files: `src/lib/permission-checks.ts`, `src/lib/auth-config.ts`
- Risk: Unauthorized access, privilege escalation
- Priority: Critical - security implications

**Component State:**
- What's not tested: React component state transitions, useEffect behavior, modal interactions
- Files: All component files
- Risk: UI bugs, poor user experience, difficult to debug
- Priority: Medium - E2E tests cover some but not all scenarios

**Error Handling:**
- What's not tested: Error boundaries, failure modes, network errors
- Files: Throughout application
- Risk: Poor error handling, confusing error messages
- Priority: Medium - improves user experience

---

*Concerns audit: 2026-03-06*
