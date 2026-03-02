---
status: resolved
trigger: "When dragging a user card between hierarchy columns, the user's level is set to 0 instead of the target column's level number."
created: 2026-02-12T00:00:00Z
updated: 2026-02-12T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED - handleSave double-counts moved users: once as "added to new level" and once as "removed from old level"
test: Fix applied and verified via TypeScript compilation, ESLint, and manual logic trace
expecting: N/A
next_action: Archive and commit

## Symptoms

expected: Dragging a user from Level 3 column to Level 1 column should set their level to 1
actual: Dragging sets the level to 0. Audit trail shows "to Level 0". Database shows level as null after save.
errors: Toast shows "Cannot remove all approvers from the hierarchy. At least one approver must remain." when trying to save after the erroneous drag (because the user ended up at level 0, which is essentially removed from the hierarchy)
reproduction: 1. Go to Admin > Hierarchy page 2. Select Engineering department 3. Drag "Engineering Level 3" user card from Level 3 column to Level 1 column 4. The card appears in Level 1 but the pending change shows "to Level 0" 5. Click Save Changes - gets validation error
started: Longstanding issue with drag-and-drop implementation. Batch save workflow (07-09) may have changed how levels are tracked.

## Eliminated

- hypothesis: handleDragEnd uses 0-based column index instead of 1-based level number
  evidence: Column droppable IDs are "level-{N}" where N is 1-based. handleDragEnd parses correctly via parseInt(str.replace('level-', ''), 10). Confirmed Level 1 column has id "level-1" which parses to 1.
  timestamp: 2026-02-12T00:00:30Z

- hypothesis: DnD over.id resolves to user card instead of column container
  evidence: If over.id is a user card UUID, handleDragEnd returns early (line 111 check for 'level-' prefix). State wouldn't change, so hasChanges would be false and Save button wouldn't appear. Doesn't match symptom where Save IS available.
  timestamp: 2026-02-12T00:00:40Z

- hypothesis: handleDragEnd doesn't set level property on moved user
  evidence: Line 134 explicitly spreads user and sets level: targetLevel. The user object in usersByLevel[targetLevel] DOES have correct level after drag.
  timestamp: 2026-02-12T00:00:45Z

- hypothesis: HierarchyBoard.tsx (alternate component) is the active one
  evidence: Grep shows HierarchyBoard is not imported anywhere. All pages import HierarchyView from hierarchy-view.tsx.
  timestamp: 2026-02-12T00:00:50Z

## Evidence

- timestamp: 2026-02-12T00:00:30Z
  checked: hierarchy-column.tsx - droppable ID assignment
  found: useDroppable({ id: `level-${level}` }) - level is 1-based prop from parent
  implication: Column IDs correctly encode 1-based level numbers

- timestamp: 2026-02-12T00:00:35Z
  checked: hierarchy-view.tsx handleDragEnd - target level parsing
  found: parseInt(over.id.toString().replace('level-', ''), 10) correctly parses to 1-based level
  implication: handleDragEnd correctly determines target level

- timestamp: 2026-02-12T00:00:40Z
  checked: hierarchy-view.tsx handleDragEnd - state update
  found: Line 134 creates { ...user!, level: targetLevel } - correctly sets level on moved user
  implication: Local state after drag has correct level

- timestamp: 2026-02-12T00:01:00Z
  checked: hierarchy-view.tsx handleSave - diff computation (lines 151-190)
  found: TWO loops compute updates. Loop 1 (lines 154-169) iterates current state and finds moved user at new level with correct level. Loop 2 (lines 172-190) iterates initial state, finds user missing from their OLD level bucket, and adds SECOND update with level: null.
  implication: ROOT CAUSE. A user moved from Level 3 to Level 1 gets TWO updates: { userId, level: 1 } AND { userId, level: null }. The null update is sent to the server and overwrites the correct one. Server action line 231 logs newLevel: update.level ?? 0, producing "to Level 0" in audit. DB receives level: null.

- timestamp: 2026-02-12T00:01:30Z
  checked: Fix applied - added processedUserIds Set to track users found in current state
  found: TypeScript compiles cleanly, ESLint passes, logic trace confirms single update per user
  implication: Fix is correct and complete

## Resolution

root_cause: handleSave diff logic in hierarchy-view.tsx double-counts moved users. The first loop (lines 154-169) correctly detects the user at their new level and creates an update with the correct level. The second loop (lines 172-190) then detects the same user as "missing" from their old level bucket and creates a SECOND update with level: null. Both updates are sent to the server action. The server processes them in order, so the null update overwrites the correct level update. The audit log records newLevel: update.level ?? 0, producing "to Level 0". The database ends up with level: null.

fix: Added a `processedUserIds` Set that collects all user IDs found in the current state during the first loop. In the second loop (removal detection), users present in processedUserIds are skipped with `continue` since they were moved to a different level, not truly removed. Only users not found in any current level bucket are treated as removed (level: null).

verification: TypeScript compilation passes (npx tsc --noEmit), ESLint passes (no warnings or errors). Manual logic trace confirms: for a user moved from Level 3 to Level 1, the first loop adds { userId, level: 1 }, processedUserIds contains the userId, and the second loop skips the user. Result: exactly one update with correct level.

files_changed:
- src/components/admin/hierarchy-view.tsx
