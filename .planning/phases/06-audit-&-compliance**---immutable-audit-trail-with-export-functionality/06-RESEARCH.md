# Phase 6: Audit & Compliance - Research

**Researched:** 2026-02-07
**Domain:** PostgreSQL immutable audit trails, Next.js file exports, CSV/JSON generation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Audit event granularity:**
- High-level actions only (e.g., "request approved", "solution submitted") - no field-level change tracking
- Link everything: Include userId, requestId, action, timestamp, outcome, related entity IDs (solutionId, approvalId, fileAttachmentId) for complete join capability
- User actions only: Log user-initiated actions (submit, approve, reject, cancel, upload). No reads/views or system events.
- Structured fields: Use typed fields (actionType, entityId, entityType, reason, outcome) instead of flexible text for queryability

**Export format and structure:**
- Both options: Admin chooses between CSV and JSON export format per export action
- Full snapshot: Include all request metadata + approval chain snapshot + file attachment names. Rich export even if CSV is wide.
- Format-dependent structure:
  - CSV: One row per action (approval, rejection, file upload as separate rows) for flat structure
  - JSON: Group by request with nested arrays (actions: [], approvers: [], files: []) for readable hierarchy
- Both date formats: Include both ISO 8601 (2025-01-31T14:30:00Z) and user's locale (31/01/2025 2:30 PM) in separate columns

**Retention and archival:**
- Fixed period: 1 year retention for all audit logs
- Archive then delete: Move to separate archive table/storage before deletion to enable restoration if needed
- Basic optimization: Add indexes on timestamp, userId, requestId for query performance as data grows

**Access control and privacy:**
- Admins only: Only admin role can view audit logs and export data
- Include all data: Full transparency - filenames, rejection reasons, cost estimates, approval comments all included
- No masking: Admins see all PII (personal identifiable information) without partial/full masking in exports
- No tracking: No additional logging of who exported audit logs - admins can export freely

### Claude's Discretion

- Exact archive table schema and migration strategy
- Export UI design and placement in admin interface
- Whether to implement background job for archival vs manual cleanup
- Index optimization strategy based on actual query patterns

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

## Summary

Phase 6 requires implementing an immutable audit trail system that logs every user action with complete context, enforced at the database level to prevent tampering. The system must support admin-only CSV and JSON exports for both individual requests and date ranges, with full snapshot data including request metadata, approval chains, and file attachments. Audit logs need a 1-year retention policy with archival strategy and optimized queries for dashboard analytics and activity timeline display.

**Primary recommendation:** Use PostgreSQL triggers with `RAISE EXCEPTION` to enforce append-only constraints on the `RequestActivity` table (already exists in schema), implement Next.js App Router route handlers with `Response` API for file downloads, and use `json2csv` library for CSV generation. For archival, use separate archive tables with DETACH/ATTACH partitioning strategy or simple INSERT-then-DELETE approach.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| PostgreSQL Triggers | 15+ | Enforce append-only constraint at database level | Database-level enforcement prevents application-level bypass, immutable by design |
| Prisma `$executeRaw` | 6.1.0+ | Execute custom SQL for trigger creation in migrations | Official Prisma approach for database-specific features not supported in schema |
| Next.js Route Handlers | 15+ | File download endpoints with proper Response headers | Modern App Router pattern, built-in Web Response API for file downloads |
| json2csv | 6.0+ | Convert JSON audit data to CSV format | Purpose-built for JSON-to-CSV conversion, actively maintained, widely used |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| PapaParse | 5.4+ | Alternative CSV generation with large file support | If exporting massive datasets (>100MB) that need streaming |
| date-fns | 4.1.0+ | Format dates for export (already in project) | User-friendly date formatting in exports |
| pg_partman | Extension | Automated partition management for archival | If implementing partition-based archival strategy |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| PostgreSQL triggers | Application-level checks | Simpler but less secure - can be bypassed by direct database access |
| Route handlers | Server Actions returning file data | Server Actions don't support file download headers properly, need Route Handlers |
| json2csv | Manual CSV string building | More control but error-prone (escaping, quotes, newlines) |
| Archive tables | Partitioned tables | More complex for 1-year retention, partitions better for 5+ year retention |

**Installation:**
```bash
# Only json2csv needs installation (others already in project)
npm install json2csv

# For TypeScript types
npm install -D @types/json2csv
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   └── api/
│       └── audit/
│           ├── export/
│           │   ├── request/
│           │   │   └── [requestId]/
│           │   │       └── route.ts          # Export single request audit trail
│           │   └── date-range/
│           │       └── route.ts              # Export date range audit trail
│           └── view/
│               └── [requestId]/
│                   └── route.ts              # View audit trail (admin only)
├── server-actions/
│   └── audit.ts                               # Audit query functions
├── lib/
│   ├── audit.ts                               # Audit logging utilities
│   └── export.ts                              # CSV/JSON export utilities
└── components/
    └── admin/
        └── audit-export-button.tsx            # Export UI component
```

### Pattern 1: PostgreSQL Trigger for Append-Only Enforcement

**What:** Create a BEFORE UPDATE and BEFORE DELETE trigger that raises an exception, preventing any modifications to audit records after insertion.

**When to use:** Enforcing immutability at database level for compliance-critical data.

**Example:**
```sql
-- Source: https://stackoverflow.com/questions/17886529/is-there-a-way-to-disable-updates-deletes-but-still-allow-triggers-to-perform-th
-- Source: https://www.postgresql.org/docs/current/sql-createtrigger.html

-- Create trigger function to prevent modifications
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Cannot modify audit trail records (table % is append-only)', TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for UPDATE and DELETE
CREATE TRIGGER prevent_request_activities_update
BEFORE UPDATE ON request_activities
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_request_activities_delete
BEFORE DELETE ON request_activities
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();
```

**Apply via Prisma Migration:**
```typescript
// Source: https://www.prisma.io/docs/reference/api-reference/prisma-reference#executeRaw
// File: prisma/migrations/TIMESTAMP_make_audit_trail_append_only/migration.sql

-- Prisma Migrate supports raw SQL in migration files
-- This creates the immutable constraint at database level

CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Cannot modify audit trail records';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_request_activities_update
BEFORE UPDATE ON request_activities
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_request_activities_delete
BEFORE DELETE ON request_activities
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();
```

### Pattern 2: Next.js Route Handler for File Downloads

**What:** Use App Router route handlers with Response API to trigger file downloads in browser.

**When to use:** Exporting CSV or JSON files to client with proper headers.

**Example:**
```typescript
// Source: https://nextjs.org/docs/app/getting-started/route-handlers
// Source: https://strapi.io/blog/nextjs-16-route-handlers-explained-3-advanced-usecases
// File: src/app/api/audit/export/request/[requestId]/route.ts

import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { exportAuditTrailAsCSV } from '@/lib/export'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params

  // Admin-only access
  await requireAdmin()

  // Fetch audit data
  const auditData = await getAuditTrailForRequest(requestId)
  const csv = exportAuditTrailAsCSV(auditData)

  // Return file download response
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="audit-trail-${requestId}.csv"`,
    },
  })
}
```

### Pattern 3: CSV Generation with json2csv

**What:** Convert audit log JSON objects to CSV format with proper escaping.

**When to use:** Admin requests CSV export format.

**Example:**
```typescript
// Source: https://www.npmjs.com/package/json2csv
// File: src/lib/export.ts

import { Parser } from 'json2csv'

export interface AuditLogExport {
  timestamp: string
  userId: string
  userName: string
  action: string
  requestId: string
  requestTitle: string
  fromStatus: string | null
  toStatus: string | null
  comments: string | null
  relatedEntityType: string | null  // 'solution' | 'approval' | 'file'
  relatedEntityId: string | null
}

export function exportAuditTrailAsCSV(auditLogs: AuditLogExport[]): string {
  const fields = [
    'timestamp',
    'userId',
    'userName',
    'action',
    'requestId',
    'requestTitle',
    'fromStatus',
    'toStatus',
    'comments',
    'relatedEntityType',
    'relatedEntityId',
  ]

  const parser = new Parser({ fields })
  return parser.parse(auditLogs)
}
```

### Pattern 4: Date Range Query with Indexes

**What:** Query audit logs within date range using indexed timestamp field for performance.

**When to use:** Admin exports audit trail for specific date range.

**Example:**
```typescript
// File: src/server-actions/audit.ts

export async function getAuditTrailForDateRange(
  startDate: Date,
  endDate: Date
): Promise<AuditLogExport[]> {
  const { userId } = await auth()
  requireAdmin(userId)  // Only admins

  const activities = await prisma.requestActivity.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
      request: {
        select: {
          title: true,
          departmentId: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  // Transform to export format
  return activities.map(activity => ({
    timestamp: activity.createdAt.toISOString(),
    userId: activity.userId,
    userName: activity.user.name,
    action: activity.action,
    requestId: activity.requestId,
    requestTitle: activity.request.title,
    fromStatus: activity.fromStatus,
    toStatus: activity.toStatus,
    comments: activity.comments,
    relatedEntityType: null,
    relatedEntityId: null,
  }))
}
```

### Anti-Patterns to Avoid

- **Application-level immutability checks:** Using middleware or code checks instead of database triggers - can be bypassed via direct database access or SQL injection
- **Manual CSV string concatenation:** Building CSV with `+` operators instead of library - prone to escaping errors with commas, quotes, newlines
- **Server Actions for file downloads:** Trying to return file data from Server Actions - doesn't support proper Response headers for browser downloads
- **DELETE without archival:** Deleting old audit logs permanently instead of moving to archive table - loses historical data
- **Missing indexes on timestamp:** Querying audit logs by date without index - slow queries as data grows

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV escaping and formatting | Manual string building with template literals | json2csv library | Handles edge cases: commas in quotes, newlines, special characters, Unicode |
| File download headers | Trying to figure out Content-Disposition | Next.js Response API | Browser needs specific headers to trigger download, not display inline |
| Immutable table enforcement | Application-level checks in every update/delete | PostgreSQL triggers | Database-level enforcement, can't be bypassed by app code or direct SQL |
| Date formatting in exports | Manual `toISOString()` parsing | date-fns format | Handles user locale, timezone awareness, i18n support |

**Key insight:** CSV generation seems simple but has many edge cases (quotes, commas, newlines, escaping). File downloads require specific HTTP headers that aren't obvious. Immutable tables need database-level enforcement, not application checks. Use existing libraries to avoid bugs.

## Common Pitfalls

### Pitfall 1: Trigger Blocks Valid INSERT Operations
**What goes wrong:** BEFORE trigger prevents all INSERT/UPDATE/DELETE operations, including legitimate new audit log entries.

**Why it happens:** Trigger created with `FOR EACH STATEMENT` or attached to INSERT operation instead of UPDATE/DELETE only.

**How to avoid:**
- Create triggers ONLY for UPDATE and DELETE operations
- Never create trigger on INSERT for append-only tables
- Use `BEFORE UPDATE` and `BEFORE DELETE` specifically

```sql
-- WRONG: Blocks INSERT too
CREATE TRIGGER prevent_modifications
BEFORE INSERT OR UPDATE OR DELETE ON request_activities
EXECUTE FUNCTION prevent_audit_modification();

-- CORRECT: Only blocks UPDATE and DELETE
CREATE TRIGGER prevent_request_activities_update
BEFORE UPDATE ON request_activities
EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_request_activities_delete
BEFORE DELETE ON request_activities
EXECUTE FUNCTION prevent_audit_modification();
```

**Warning signs:** Application can't create new audit log entries, "cannot modify" errors on insert operations.

### Pitfall 2: Large Export Files Timeout or Memory Exhaust
**What goes wrong:** Exporting large date ranges (1+ years) causes Node.js to run out of memory or request timeout.

**Why it happens:** Loading entire dataset into memory before converting to CSV, no streaming for large files.

**How to avoid:**
- Implement pagination for exports over 100k rows
- Use streaming CSV generation (PapaParse supports streaming)
- Add max date range limit (e.g., 90 days per export)
- Return job ID and email link when ready for very large exports

```typescript
// Add validation for reasonable date ranges
if (endDate.getTime() - startDate.getTime() > 90 * 24 * 60 * 60 * 1000) {
  throw new Error('Date range cannot exceed 90 days. Please use smaller ranges.')
}
```

**Warning signs:** Exports take >30 seconds, browser shows "out of memory" error, server crashes during export.

### Pitfall 3: CSV Format Issues with Special Characters
**What goes wrong:** Exported CSV breaks when comments contain quotes, commas, or newlines.

**Why it happens:** Manual CSV generation without proper escaping.

**How to avoid:**
- Always use json2csv library (handles escaping automatically)
- If manual, use RFC 4180 standard: wrap fields in quotes, escape quotes with double quotes

```typescript
// WRONG: Manual concatenation
const csv = rows.map(r =>
  `${r.timestamp},${r.userName},${r.comments}`
).join('\n')

// CORRECT: Use json2csv
const parser = new Parser({ fields })
const csv = parser.parse(rows)
```

**Warning signs:** CSV opens incorrectly in Excel, rows split across multiple lines, quotes don't match up.

### Pitfall 4: Audit Query Performance Degradation
**What goes wrong:** Audit trail queries become slow as data accumulates (100k+ rows).

**Why it happens:** Missing indexes on frequently queried fields (timestamp, userId, requestId).

**How to avoid:**
- Create indexes before production launch
- Use EXPLAIN ANALYZE to verify index usage
- Monitor query performance as data grows

```prisma
// In schema.prisma (already exists)
model RequestActivity {
  id          String        @id @default(cuid())
  requestId   String
  userId      String
  createdAt   DateTime      @default(now())

  @@index([requestId])  // For request-specific queries
  @@index([userId])     // For user-specific queries
  @@index([createdAt])  // For date range queries - CRITICAL
}
```

**Warning signs:** Queries take >5 seconds, dashboard loads slowly, PostgreSQL CPU spikes during exports.

### Pitfall 5: Archive Migration Loss
**What goes wrong:** Auditing data lost during archival process or archive table doesn't preserve constraints.

**Why it happens:** Using DELETE without INSERT to archive first, or archive table missing triggers.

**How to avoid:**
- Always INSERT to archive table before DELETE from main table
- Apply same triggers to archive table (or make it completely read-only)
- Test archival process in development with real data

```typescript
// WRONG: Delete without archival
await prisma.requestActivity.deleteMany({
  where: { createdAt: { lt: cutoffDate } }
})

// CORRECT: Archive then delete
await prisma.$transaction([
  // Copy to archive
  prisma.$executeRaw`
    INSERT INTO request_activities_archive
    SELECT * FROM request_activities
    WHERE "createdAt" < ${cutoffDate}
  `,
  // Delete from main
  prisma.requestActivity.deleteMany({
    where: { createdAt: { lt: cutoffDate } }
  })
])
```

**Warning signs:** Can't query old audit logs, gap in audit timeline, compliance failures.

## Code Examples

Verified patterns from official sources:

### Immutable Table with Triggers
```sql
-- Source: https://www.postgresql.org/docs/current/sql-createtrigger.html
-- Source: https://stackoverflow.com/questions/17886529/is-there-a-way-to-disable-updates-deletes-but-still-allow-triggers-to-perform-th

-- Create trigger function
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit trail is append-only - cannot modify records';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply to UPDATE operations only
CREATE TRIGGER prevent_audit_update
BEFORE UPDATE ON request_activities
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();

-- Apply to DELETE operations only
CREATE TRIGGER prevent_audit_delete
BEFORE DELETE ON request_activities
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();

-- Note: No trigger on INSERT - new records allowed
```

### File Download Route Handler
```typescript
// Source: https://nextjs.org/docs/app/getting-started/route-handlers
// Source: https://strapi.io/blog/nextjs-16-route-handlers-explained-3-advanced-usecases

import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params

  // Require admin access
  await requireAdmin()

  // Fetch audit data
  const auditData = await getAuditTrailForRequest(requestId)

  // Generate CSV
  const csv = exportAuditTrailAsCSV(auditData)

  // Return file download response
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-trail-${requestId}.csv"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
```

### CSV Export with json2csv
```typescript
// Source: https://www.npmjs.com/package/json2csv

import { Parser } from 'json2csv'

interface AuditExportRow {
  timestamp: string
  userId: string
  action: string
  requestId: string
  requestTitle: string
  comments: string | null
}

export function generateCSVExport(rows: AuditExportRow[]): string {
  const fields = [
    'timestamp',
    'userId',
    'action',
    'requestId',
    'requestTitle',
    'comments',
  ]

  const opts = { fields }
  const parser = new Parser(opts)

  try {
    const csv = parser.parse(rows)
    return csv
  } catch (err) {
    console.error('CSV generation error:', err)
    throw new Error('Failed to generate CSV export')
  }
}
```

### JSON Export Structure
```typescript
// Source: Based on CONTEXT.md requirements for nested structure

interface AuditExportJSON {
  requestId: string
  requestTitle: string
  departmentId: string
  createdAt: string
  status: string
  requester: {
    userId: string
    userName: string
    email: string
  }
  approvals: Array<{
    approvalId: string
    approverName: string
    requiredLevel: number
    status: string
    approvedAt: string | null
    comments: string | null
  }>
  files: Array<{
    fileId: string
    fileName: string
    uploadedBy: string
    uploadedAt: string
  }>
  activities: Array<{
    activityId: string
    timestamp: string
    userId: string
    userName: string
    action: string
    fromStatus: string | null
    toStatus: string | null
    comments: string | null
  }>
}

export function generateJSONExport(
  request: Request,
  activities: RequestActivity[]
): AuditExportJSON {
  return {
    requestId: request.id,
    requestTitle: request.title,
    departmentId: request.departmentId,
    createdAt: request.createdAt.toISOString(),
    status: request.status,
    requester: {
      userId: request.requesterId,
      userName: request.requester.name,
      email: request.requester.email,
    },
    approvals: request.approvals.map(a => ({
      approvalId: a.id,
      approverName: a.approver?.name || 'Pending',
      requiredLevel: a.requiredLevel,
      status: a.status,
      approvedAt: a.approvedAt?.toISOString() || null,
      comments: a.comments,
    })),
    files: request.fileAttachments.map(f => ({
      fileId: f.id,
      fileName: f.fileName,
      uploadedBy: f.uploadedBy.name,
      uploadedAt: f.createdAt.toISOString(),
    })),
    activities: activities.map(a => ({
      activityId: a.id,
      timestamp: a.createdAt.toISOString(),
      userId: a.userId,
      userName: a.user.name,
      action: a.action,
      fromStatus: a.fromStatus,
      toStatus: a.toStatus,
      comments: a.comments,
    })),
  }
}
```

### Archival with Transaction
```typescript
// Source: Based on CONTEXT.md "archive then delete" requirement

export async function archiveOldAuditLogs(cutoffDate: Date) {
  return await prisma.$transaction(async (tx) => {
    // First: Insert into archive table
    const archivedCount = await tx.$executeRaw`
      INSERT INTO request_activities_archive
      SELECT * FROM request_activities
      WHERE "createdAt" < ${cutoffDate}
    `

    console.log(`Archived ${archivedCount} audit log entries`)

    // Second: Delete from main table
    const deletedCount = await tx.requestActivity.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    })

    console.log(`Deleted ${deletedCount} audit log entries from main table`)

    return { archivedCount, deletedCount }
  })
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Application-level immutability checks | Database triggers with RAISE EXCEPTION | PostgreSQL 9.x+ | Much stronger security, can't be bypassed |
| Manual CSV string concatenation | json2csv library with proper escaping | 2019+ | Handles edge cases, RFC 4180 compliant |
| Server Actions returning base64 files | Route Handlers with Response API | Next.js 13+ (App Router) | Proper HTTP headers, browser file download trigger |
| DELETE old audit logs | Archive tables before deletion | Ongoing best practice | Preserves historical data for compliance |
| Single large export file | Paginated exports or streaming | 2020+ | Avoids memory issues, better UX for large datasets |

**Deprecated/outdated:**
- **API Routes (pages/ directory):** Use App Router route handlers (app/ directory) for new projects
- **Manual CSV escaping:** Error-prone, use json2csv or PapaParse
- **Application-only security:** Database-level enforcement is standard for audit trails
- **Unbounded date range exports:** Add limits (90 days) or implement async job + email link

## Open Questions

Things that couldn't be fully resolved:

1. **Archive table schema exact structure**
   - What we know: Need separate table with same schema, append-only triggers
   - What's unclear: Whether to include foreign key relationships in archive (may cause issues if related records deleted)
   - Recommendation: Use simplified archive table without foreign keys (store IDs as strings, not relations)

2. **Background job vs manual archival**
   - What we know: Need 1-year retention, archive before delete
   - What's unclear: Whether to use cron job, pg_partman extension, or manual admin action
   - Recommendation: Start with manual admin action, add cron job later based on data volume

3. **Index optimization strategy**
   - What we know: Need indexes on timestamp, userId, requestId
   - What's unclear: Whether composite indexes improve performance for common query patterns
   - Recommendation: Start with single-column indexes, use EXPLAIN ANALYZE after 10k+ rows to identify bottlenecks

## Sources

### Primary (HIGH confidence)
- [Prisma $executeRaw Documentation](https://github.com/prisma/docs/blob/main/content/200-orm/200-prisma-client/150-using-raw-sql/200-raw-queries.mdx) - Raw SQL execution for trigger creation
- [PostgreSQL CREATE TRIGGER Documentation](https://www.postgresql.org/docs/current/sql-createtrigger.html) - Official trigger syntax and behavior
- [Next.js Route Handlers Documentation](https://nextjs.org/docs/app/getting-started/route-handlers) - Official route handler patterns
- [json2csv NPM Package](https://www.npmjs.com/package/json2csv) - CSV generation library documentation

### Secondary (MEDIUM confidence)
- [How to Implement Audit Trails with Triggers in PostgreSQL](https://oneuptime.com/blog/post/2026-01-25-postgresql-audit-trails-triggers/view) - Trigger-based audit logging (Jan 2026)
- [Immutable Audit Logs in PostgreSQL with Pgcli](https://hoop.dev/blog/immutable-audit-logs-in-postgresql-with-pgcli/) - Append-only table implementation (Oct 2025)
- [Next.js 16 Route Handlers Explained: 3 Advanced Use Cases](https://strapi.io/blog/nextjs-16-route-handlers-explained-3-advanced-usecases) - File download with Response headers (Dec 2025)
- [Postgres Audit Logging Guide](https://www.bytebase.com/blog/postgres-audit-logging/) - Comprehensive audit logging approaches (Nov 2025)
- [Data Archival with Partitioning in PostgreSQL](https://medium.com/techtrends-digest/data-archival-with-partitioning-in-postgresql-2ca986c100d4) - Archival strategies for audit logs
- [Creating a Universal Exporter in TypeScript](https://dev.to/m4r14/creating-a-universal-exporter-in-typescript-for-csv-json-and-excel-formats-3mil) - Multi-format export patterns

### Tertiary (LOW confidence)
- [StackOverflow: Preventing updates/deletes with triggers](https://stackoverflow.com/questions/17886529/is-there-a-way-to-disable-updates-deletes-but-still-allow-triggers-to-perform-th) - Community discussion on triggers
- [PapaParse GitHub Repository](https://github.com/mholt/PapaParse) - Alternative CSV library with streaming support
- [Prisma Migrate removes custom SQL discussion](https://github.com/prisma/prisma/issues/24180) - Known issues with raw SQL in migrations (verify migration doesn't remove triggers)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - PostgreSQL triggers and Next.js Route Handlers are well-documented, json2csv is standard library
- Architecture: HIGH - Immutable table patterns and file download routes are established best practices
- Pitfalls: HIGH - Based on common issues documented in PostgreSQL and Next.js communities

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (30 days - stable domain, unlikely to change)
