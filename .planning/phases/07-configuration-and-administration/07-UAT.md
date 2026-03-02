---
status: diagnosed
phase: 07-configuration-and-administration
source: 07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md, 07-04-SUMMARY.md, 07-05-SUMMARY.md, 07-06-SUMMARY.md, 07-07-SUMMARY.md, 07-08-SUMMARY.md, 07-09-SUMMARY.md
started: 2026-02-08T18:00:00Z
updated: 2026-02-11T12:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Hierarchy Batch Save UI
expected: Dragging users shows "Unsaved Changes" bar without immediate save.
result: pass

### 2. Hierarchy Reset
expected: Clicking "Reset" reverts users to original positions and hides the bar.
result: pass

### 3. Hierarchy Save
expected: Clicking "Save Changes" shows loading spinner, then success toast, and changes persist on refresh.
result: issue
reported: "fail. it return 'Hierarchy must start at Level 1. Current first level is 2.' It shouldn't force to start with level 1. Moreover i try drag to level 1 but it still error the same. (tested with engineering dept.)"
severity: blocker

### 4. Hierarchy Validation (Empty Level)
expected: Move all users out of a level (if possible) or create a gap. Click Save. Should show error toast "Level X has no approvers" and NOT save.
result: skipped
reason: can't test properly due to test 3 blocker

### 5. External Approver Badge
expected: Users from other departments assigned to this hierarchy show an "External" badge.
result: issue
reported: "Engineering Level 3 user (enguser01) from Engineering department shown in Production Department 1 hierarchy at Level 3 without any External badge visible"
severity: minor

### 6. Read-Only Workflow View
expected: Navigate to /dashboard/workflow as a normal user. Should see read-only hierarchy diagram. Cannot drag users.
result: pass

### 7. User Edit Dialog
expected: Go to /admin/users. Click pencil icon on a user. Dialog opens. Can edit name/role.
result: pass

### 8. User Level Assignment
expected: In User Edit Dialog, if department is selected, "Approval Level" input appears. Changing it and saving updates the "Level" column in the table.
result: pass

### 9. User Deactivation Confirmation
expected: Click "Deactivate" in user row menu. Confirmation dialog appears showing user name. "Cancel" does nothing. "Confirm" deactivates user (status changes to Inactive).
result: pass

### 10. Department Edit Dialog
expected: Go to /admin/departments. Click pencil icon. Dialog opens. Can edit name.
result: pass

### 11. Department Level Names
expected: In Department Edit Dialog, can add/remove level names (e.g., "1: Supervisor"). Saving updates the configuration.
result: pass

### 12. Manual Retention Controls
expected: Go to /admin/retention. See list of requests. Click "Archive" -> moves to archive (soft delete). Click "Delete" -> permanent delete (soft delete).
result: pass

## Summary

total: 12
passed: 9
issues: 2
pending: 0
skipped: 1

## Gaps

<!-- YAML format for plan-phase --gaps consumption -->
- truth: "Clicking Save Changes persists hierarchy changes and shows success toast"
  status: failed
  reason: "User reported: fail. it return 'Hierarchy must start at Level 1. Current first level is 2.' It shouldn't force to start with level 1. Moreover i try drag to level 1 but it still error the same. (tested with engineering dept.)"
  severity: blocker
  test: 3
  root_cause: "validateHierarchyUpdates in hierarchy.ts lines 148-165 enforces two overly strict rules: (1) hierarchy must start at Level 1, (2) no gaps allowed between levels. The approval engine (createApprovalChain) already handles gaps gracefully by skipping empty levels, so these validations are unnecessary and block legitimate configurations."
  artifacts:
    - path: "src/server-actions/hierarchy.ts"
      issue: "Lines 148-165: overly strict validation rejects valid hierarchies"
  missing:
    - "Remove 'must start at Level 1' check (lines 148-154)"
    - "Remove 'no gaps allowed' sequential check (lines 157-165)"
    - "Keep minimum one approver validation"
  debug_session: ""

- truth: "Users from other departments assigned to this hierarchy show an External badge"
  status: failed
  reason: "User reported: Engineering Level 3 user (enguser01) from Engineering department shown in Production Department 1 hierarchy at Level 3 without any External badge visible"
  severity: minor
  test: 5
  root_cause: "HierarchyUserCard component (hierarchy-user-card.tsx) does not include isExternal in its type interface and has no badge rendering. The data is correctly set by getHierarchyData() (isExternal: true for DepartmentApprovers) but the rendering component drops it. A parallel unused component HierarchyBoard.tsx has the badge code but is not used by any page."
  artifacts:
    - path: "src/components/admin/hierarchy-user-card.tsx"
      issue: "Missing isExternal in type interface, no badge rendering"
    - path: "src/components/admin/hierarchy-column.tsx"
      issue: "User interface missing isExternal, data typed away before reaching card"
  missing:
    - "Add isExternal?: boolean to User interface in hierarchy-column.tsx"
    - "Add isExternal?: boolean to user type in hierarchy-user-card.tsx"
    - "Add Badge import and conditional badge rendering in hierarchy-user-card.tsx"
  debug_session: ""
