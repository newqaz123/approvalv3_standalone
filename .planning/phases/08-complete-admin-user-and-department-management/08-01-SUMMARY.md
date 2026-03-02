---
phase: 08
plan: 01
status: completed
date: 2026-02-13
---

## Objective

Complete User Edit functionality with robust dual-write synchronization between Clerk and Prisma. Enable admins to manually override user roles and update email addresses safely.

## What was built

- **User Edit Form**: Enhanced `UserForm` to allow manual role selection (Admin, General, Engineering), overriding department defaults.
- **Dual-Write Synchronization**: Updated `updateUser` server action to sync changes to both Prisma (database) and Clerk (auth provider).
  - Syncs Name, Email, Role, Department, and Level.
  - Handles email changes by creating new verified primary email in Clerk.
- **Safety Mechanisms**:
  - **Pending Approval Check**: Prevents changing department if user has pending approvals to avoid workflow orphaning.
  - **Rollback System**: Reverts Clerk changes (name, metadata, email) if Prisma database update fails.
- **Audit Logging**: Logs all admin changes to `RequestActivity` with detailed "before -> after" values.

## Key Decisions

- **Email Sync Strategy**: When email changes, we create a new verified primary email in Clerk rather than updating the existing one, ensuring immediate access recovery.
- **Role Override**: Admins can now explicitly set a role that contradicts the department default (e.g., an Engineer in the General department), providing flexibility for edge cases.

## Verification

- Verified `UserForm` renders editable Role select.
- Verified `updateUser` logic includes Clerk API calls and rollback blocks.
- Verified pending approval check prevents orphaned workflows.
