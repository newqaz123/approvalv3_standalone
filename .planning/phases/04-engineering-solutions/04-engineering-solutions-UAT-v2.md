---
status: diagnosed
phase: 04-engineering-solutions-retest
source: 04-08-SUMMARY.md, 04-09-SUMMARY.md, 04-10-SUMMARY.md, 04-11-SUMMARY.md, 04-12-SUMMARY.md
started: 2026-02-03T21:50:00Z
updated: 2026-02-03T22:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Solution Submission Without Errors
expected: Engineering user can submit solution with file attachments, optional cost estimate, and see currency options (THB, USD, EUR). No "use server" errors or authorization failures.
result: issue
reported: "attach file: error:Request not found or unauthorized"
severity: blocker

### 2. Cost Estimate Field Behavior
expected: Cost Estimate field is optional - can be left blank without red validation error. When filled, accepts positive numbers. Currency dropdown shows THB, USD, EUR with THB as default.
result: pass

### 3. Custom Approval Chain Shows All Users
expected: When "Use Custom Approval Chain" is enabled, the approver picker shows all active users in the system (from all departments), not just engineering users. Can search and select any user.
result: issue
reported: "can seelct any user but can't press up/down botton for arranging."
severity: major

### 4. File Upload Progress Bar
expected: During file upload, a progress bar shows upload progress. After upload completes, file appears in list with size and remove button.
result: skipped
reason: Blocked by file upload authorization error (same as Test 1)

### 5. View Original Request Link
expected: In solution submission form, clicking "View original request" navigates to the request detail page/modal without 404 error.
result: pass

## Summary

total: 5
passed: 2
issues: 2
pending: 0
skipped: 1

## Gaps

- truth: "Engineering users can upload file attachments when submitting solutions"
  status: failed
  reason: "User reported: attach file: error:Request not found or unauthorized"
  severity: blocker
  test: 1
  root_cause: "File upload authorization checks only allow the original requester to upload files. The checks in prepareFileUpload (files.ts:78) and /api/upload route (route.ts:58) use request.requesterId !== userId, blocking assigned engineering users. The RequestEngineerAssignment table exists but isn't checked in authorization logic."
  artifacts:
    - path: "src/server-actions/files.ts"
      issue: "Authorization only checks requesterId, doesn't allow assigned engineers"
      lines: [73-83]
    - path: "src/app/api/upload/route.ts"
      issue: "Same requester-only authorization check blocks engineers"
      lines: [53-63]
    - path: "prisma/schema.prisma"
      issue: "RequestEngineerAssignment table exists but isn't queried in upload auth"
      lines: [347-361]
  missing:
    - "Update prepareFileUpload to include engineerAssignments in query and check if user is assigned engineer"
    - "Update /api/upload route to include engineerAssignments in query and check if user is assigned engineer"
    - "Add role check to ensure only engineering users can use engineer assignment bypass"
  debug_session: ""
- truth: "Custom approval chain approvers can be reordered with up/down buttons"
  status: failed
  reason: "User reported: can seelct any user but can't press up/down botton for arranging."
  severity: major
  test: 3
  root_cause: "Up/down buttons are functionally correct but have usability issues: (1) small 32x32px click targets with ghost variant styling, (2) missing explicit cursor-pointer class for visual affordance, (3) edge cases where buttons appear disabled for valid reasons (1 approver = both disabled), (4) react-hook-form onChange may have issues updating array state"
  artifacts:
    - path: "src/components/solutions/custom-approval-picker.tsx"
      issue: "Buttons use ghost variant with small 32x32px size and no explicit cursor styling"
      lines: [162-181]
    - path: "src/components/ui/button.tsx"
      issue: "Ghost variant has hover:bg-accent but no explicit cursor-pointer"
      lines: [8, 20]
  missing:
    - "Add explicit cursor-pointer to button styling in custom-approval-picker.tsx"
    - "Increase button click target size from h-8 w-8 to h-9 w-9 (36x36px)"
    - "Add visual feedback when buttons are clickable (consider more distinct variant or borders)"
    - "Hide disabled buttons entirely instead of showing them disabled"
    - "Add console.log to handleMoveUp/handleMoveDown to confirm they fire when clicked"
  debug_session: ""
