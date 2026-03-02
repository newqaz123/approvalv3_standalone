---
status: diagnosed
trigger: "Diagnose why `updateUser` fails with \"Foreign key constraint violated on the constraint: `request_activities_requestId_fkey`\""
created: 2026-02-13T00:00:00Z
updated: 2026-02-13T00:00:00Z
---

## Current Focus
hypothesis: `updateUser` creates a `RequestActivity` entry with `requestId: 'SYSTEM'` which violates the foreign key constraint since no Request record with id='SYSTEM' exists
test: Verify RequestActivity schema enforces foreign key to Request table
expecting: Confirmed - RequestActivity.requestId has foreign key to Request table
next_action: Document root cause and propose fix

## Symptoms
expected: User should be editable in Admin > Users without errors
actual: updateUser fails with "Foreign key constraint violated on the constraint: `request_activities_requestId_fkey`"
errors: Foreign key constraint violated on the constraint: `request_activities_requestId_fkey`
reproduction: Edit a user in Admin > Users
started: Not provided (recent failure)

## Eliminated
(empty)

## Evidence
- timestamp: 2026-02-13T00:00:00Z
  checked: `src/server-actions/users.ts` lines 268-277
  found: `updateUser` function creates RequestActivity with `requestId: 'SYSTEM'` for audit logging
  implication: No Request record with id 'SYSTEM' exists, causing foreign key violation

- timestamp: 2026-02-13T00:00:00Z
  checked: `prisma/schema.prisma` lines 173-176
  found: RequestActivity model has `requestId String` with foreign key: `request Request @relation(fields: [requestId], references: [id], onDelete: Cascade)`
  implication: requestId MUST reference an existing Request record - cannot use 'SYSTEM' as placeholder

## Resolution
root_cause: `updateUser` function (lines 268-277) attempts to create a `RequestActivity` entry with `requestId: 'SYSTEM'` for audit logging. However, the `RequestActivity` schema enforces a foreign key constraint to the `Request` table via `@relation(fields: [requestId], references: [id])`. Since no Request record with id='SYSTEM' exists in the database, the insert fails with a foreign key constraint violation.

The fundamental issue is a design mismatch: `RequestActivity` is designed exclusively for request-related activities (audit trail for specific requests), but the code is trying to repurpose it for user admin audit logs which have no associated request.

fix: Options:
1. Create a new audit log table specifically for system/user admin actions (recommended)
2. Make RequestActivity.requestId nullable and handle nulls in queries
3. Create a special "SYSTEM" Request record that represents non-request activities

verification: Not applicable (diagnosis-only mode)
files_changed: []
