---
status: resolved
trigger: "When dragging an external user between hierarchy columns, the user gets duplicated - appears in BOTH source and target columns instead of moving."
created: 2026-02-12T00:00:00Z
updated: 2026-02-12T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED
test: TypeScript compilation passes, logic verified through code analysis
expecting: N/A - fix applied
next_action: Archive session

## Symptoms

expected: Dragging enguser01 (External) from Level 3 to Level 2 should move them - appear only in Level 2
actual: After drag, enguser01 (External) appears in BOTH Level 2 AND Level 3 (duplicated). The card "copies and sticks."
errors: None visible - no error toast, the duplicate just stays
reproduction: 1. Go to Admin > Hierarchy > Production Department 1 2. enguser01 shows as External at Level 3 3. Drag enguser01 from Level 3 to Level 2 4. enguser01 appears in both Level 2 and Level 3
started: Likely since external user drag was implemented

## Eliminated

- hypothesis: handleDragEnd client-side fails to remove external users from source column
  evidence: handleDragEnd uses u.id === userId for filtering, and both internal and external users use the same User.id as their identifier. The filter logic is identical for both types. The client-side optimistic update correctly removes from source and adds to target.
  timestamp: 2026-02-12T00:00:30Z

- hypothesis: Duplicate user IDs across levels cause lookup confusion
  evidence: External users get id from da.approver.id (User table ID), which is unique. Internal and external users for the same department are different people (external = from another department). No ID collisions.
  timestamp: 2026-02-12T00:00:35Z

## Evidence

- timestamp: 2026-02-12T00:00:10Z
  checked: handleDragEnd in hierarchy-view.tsx (lines 104-137)
  found: Client-side drag logic is correct - removes from source level via filter(u => u.id !== userId) and adds to target. This works identically for internal and external users.
  implication: The duplication is NOT a client-side issue. The optimistic update works. The bug manifests after save + revalidation.

- timestamp: 2026-02-12T00:00:20Z
  checked: updateHierarchy in hierarchy.ts (lines 191-210) - external user upsert logic
  found: The upsert WHERE clause uses the compound unique key [departmentId, approverId, approverLevel] but passes the NEW level (update.level) instead of the OLD level. This means: (1) it looks for a record at the NEW level, (2) doesn't find one, (3) creates a NEW record at the new level, (4) NEVER touches the old record at the old level.
  implication: This is the root cause. After save, both old and new DepartmentApprover records exist, causing the user to appear at both levels when data is re-fetched.

- timestamp: 2026-02-12T00:00:25Z
  checked: DepartmentApprover schema (prisma/schema.prisma line 367)
  found: Unique constraint is @@unique([departmentId, approverId, approverLevel]). This allows the same user to have multiple records at DIFFERENT levels for the same department.
  implication: The upsert cannot update the old record by looking up with the new level. Must delete old + create new, or find the old record by its actual level first.

- timestamp: 2026-02-12T00:00:40Z
  checked: handleSave diff calculation in hierarchy-view.tsx (lines 145-217)
  found: The diff calculation correctly identifies that the external user changed levels and sends { userId, level: newLevel, isExternal: true }. But it does NOT send the old level in the update payload.
  implication: updateHierarchy doesn't know the old level to find the existing record. It needs to look up the current state server-side (which it already does via getDepartmentHierarchy) and use that to delete the old record.

- timestamp: 2026-02-12T00:01:30Z
  checked: TypeScript compilation after fix
  found: npx tsc --noEmit passes with no errors
  implication: Fix is syntactically and type-safe

- timestamp: 2026-02-12T00:01:45Z
  checked: Edge case analysis of delete+create pattern
  found: All scenarios handled correctly: (1) New external approver - deleteMany is no-op, create adds. (2) Level change - deleteMany removes old, create adds new. (3) Removal (level=null) - deleteMany removes, no create. (4) Transaction ordering correct - Prisma $transaction([]) runs operations sequentially.
  implication: Fix is safe for all external approver operations.

## Resolution

root_cause: In updateHierarchy (src/server-actions/hierarchy.ts), when moving an external user to a new level, the code used prisma.departmentApprover.upsert() with the NEW approverLevel in the WHERE clause. The DepartmentApprover unique constraint is [departmentId, approverId, approverLevel]. Since the WHERE used the NEW level, it could never find the existing record (at the OLD level), so it always CREATED a new record instead of updating. The old record at the original level was never deleted, resulting in the external user appearing at both the old and new levels after save + page refresh.

fix: Replaced the upsert with a two-step delete+create pattern: (1) deleteMany removes ALL existing DepartmentApprover records for this user in this department (handles any old level), (2) if new level is not null, create a new record at the target level. Both operations run inside the existing $transaction for atomicity.

verification: TypeScript compilation passes. Code logic verified through manual trace of all edge cases (new, move, remove). The fix is minimal (same file, same function, replaced 15 lines with 14 lines).

files_changed:
- src/server-actions/hierarchy.ts: Replaced upsert with delete+create for external approver level changes (lines 182-204)
