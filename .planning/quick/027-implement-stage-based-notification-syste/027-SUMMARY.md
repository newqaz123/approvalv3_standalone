---
phase: quick-027
plan: 01
type: execute
subsystem: notifications
tags:
  - notifications
  - workflow
  - email-alerts

dependencies:
  requires:
    - quick-026
  provides:
    - notifyUsersInDepartment helper function
    - Stage-based notification system
  affects:
    - All workflow transitions

tech_stack:
  added:
    - notifyUsersInDepartment function
  patterns:
    - Department-wide notifications
    - Targeted audience notifications

key_files:
  created:
    - .planning/quick/027-implement-stage-based-notification-syste/027-SUMMARY.md
  modified:
    - src/server-actions/notifications.ts
    - src/server-actions/approvals.ts
    - src/server-actions/requests.ts
    - src/server-actions/solutions.ts

decisions:
  - "Requester" means the current stage requester, not past stages
  - No duplicate notifications - extend existing notifications to reach correct audiences

metrics:
  duration: 13 min
  completed: 2026-02-22
---

# Quick Task 027: Implement Stage-Based Notification System

**Summary:** Implemented targeted notifications for each approval workflow transition, replacing generic notifications with specific ones that reach the correct audience.

## Objective

Implement stage-based notification system with targeted notifications for each approval workflow transition. Purpose: Replace generic notifications with specific, targeted notifications that reach the correct audience at each stage, improving visibility and accountability.

## Key Notifications Implemented

| # | Notification | Recipients | Trigger |
|---|-------------|------------|---------|
| 1 | Improvement Request Rejected | Requester (with reason) | rejectRequest |
| 2 | Status → SentToEngineer | ALL engineers | changeRequestStatus |
| 3 | Engineer PIC Assignment | Assigned engineers | assignEngineers |
| 4 | Status → SendBackToRequester | Requester's department (ALL) | approveSolution |
| 5 | Status → Completed | Requester's department (ALL, excluding engineers) | approveFinalApproval |
| 6 | Final Approval Rejected | ALL engineers (with reason) | rejectFinalApproval |

## Changes Made

### Task 1: Add notifyUsersInDepartment helper function

**File:** `src/server-actions/notifications.ts`

Added a new exported function `notifyUsersInDepartment` that:
- Takes a departmentId and notification payload
- Optionally accepts excludeUserIds array
- Creates notifications for all active users in the department
- Returns count of users notified

### Task 2: Add notifications to approvals.ts and requests.ts

**Files:** `src/server-actions/approvals.ts`, `src/server-actions/requests.ts`

**rejectRequest (approvals.ts):**
- Now notifies requester with rejection reason when their request is rejected

**changeRequestStatus (approvals.ts):**
- When status changes to SentToEngineer, notifies ALL engineering users (not just requester)
- Other status changes continue to notify requester

**assignEngineers (requests.ts):**
- Notifies each assigned engineer of their PIC assignment with request title

### Task 3: Add department-wide notifications to solutions.ts

**File:** `src/server-actions/solutions.ts`

**approveSolution:**
- Changed from requester-only notification to department-wide notification
- All users in requester's department receive "Solution Ready for Review" notification

**approveFinalApproval:**
- Changed from requester-only notification to department-wide notification
- All users in requester's department receive "Request Completed" notification
- Engineering users are excluded from completion notifications

**rejectFinalApproval:**
- Changed from single user notification to ALL engineers notification
- Includes rejection reason in the notification message

## Verification

All changes compile successfully with `npm run build`.

## Commits

- b06ee3c: feat(quick-027): add notifyUsersInDepartment helper function
- eaa8bb1: feat(quick-027): add notifications to approvals.ts and requests.ts
- dd40bbd: feat(quick-027): add department-wide notifications to solutions.ts

---

*Last updated: 2026-02-22 after completing quick task 027 - Implement stage-based notification system*
