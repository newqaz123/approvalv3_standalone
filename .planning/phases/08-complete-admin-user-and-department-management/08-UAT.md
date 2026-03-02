---
status: diagnosed
phase: 08-complete-admin-user-and-department-management
source: 08-01-SUMMARY.md, 08-02-SUMMARY.md
started: 2026-02-13T21:00:00Z
updated: 2026-02-13T21:15:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Edit User Role & Details
expected: Admin can edit Name, Email, and Role. Changes persist.
result: issue
reported: "Failed to update user record: Invalid `prisma.requestActivity.create()` invocation: Foreign key constraint violated on the constraint: `request_activities_requestId_fkey`"
severity: blocker

### 2. Department Name Uniqueness
expected: Try to create/edit a department with a duplicate name (case-insensitive). Should show error and block save.
result: pass

### 3. Edit Department Type
expected: Admin can edit Department Type (General/Engineering). Changes persist.
result: pass

## Summary

total: 3
passed: 2
issues: 1
pending: 0
skipped: 0

## Gaps

- truth: "Admin can edit Name, Email, and Role. Changes persist."
  status: failed
  reason: "User reported: Failed to update user record: Invalid `prisma.requestActivity.create()` invocation: Foreign key constraint violated on the constraint: `request_activities_requestId_fkey`"
  severity: blocker
  test: 1
  root_cause: "updateUser creates RequestActivity with requestId: 'SYSTEM' but no such request exists, violating foreign key constraint."
  artifacts:
    - path: "src/server-actions/users.ts"
      issue: "Uses invalid requestId 'SYSTEM'"
    - path: "prisma/schema.prisma"
      issue: "Enforces foreign key constraint on RequestActivity.requestId"
  missing:
    - "Ensure RequestActivity can handle system-level events (nullable requestId or separate table)"
  debug_session: ".planning/debug/updateuser-foreign-key-violation.md"
