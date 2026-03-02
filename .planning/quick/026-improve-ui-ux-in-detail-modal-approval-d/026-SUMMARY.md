---
phase: quick-026
plan: 01
subsystem: UI/UX - Approval Display
tags:
  - approvals
  - detail-modal
  - ui-improvement
  - quick-task
tech_stack:
  added: []
  patterns:
    - Unified approver name display with fallback logic
key_files:
  created: []
  modified:
    - src/components/approvals/approval-progress.tsx
---

# Quick Task 026: Improve UI/UX in Detail Modal - Approval Display

**Date:** 2026-02-22  
**Duration:** ~2 min  
**Commit:** 7708402

## Objective

Fix approval progress display in detail modal to show approver names instead of generic "Level X Approval" text.

## Summary

Updated the ApprovalProgress component to display approver names with proper fallback logic, consistent with quick-025 dashboard hover tooltip pattern.

## Changes Made

**File Modified:** `src/components/approvals/approval-progress.tsx`

- Removed `isCustomChain` conditional check
- Applied unified display logic: `approval.requiredApprover?.name || approval.approver?.name || \`Level ${approval.requiredLevel} Approval\``
- Now displays:
  1. `requiredApprover.name` for pending approvals with assigned approver
  2. `approver.name` for already approved/rejected approvals
  3. Fallback to "Level X Approval" only when no name is available

## Success Criteria

- [x] Engineering Solution Approval section displays approver names
- [x] Final Approval progress displays approver names
- [x] Department Approval progress displays approver names
- [x] Consistent with quick-025 approver name display pattern

## Decisions Made

None - This follows the established pattern from quick-025.

## Deviations from Plan

None - Plan executed exactly as written.

## Verification

The approval progress now shows:
- Actual approver names (e.g., "QC Level 2 -B") instead of "Level X Approval"
- Name of user who approved when status is approved/rejected
- Fallback to "Level X Approval" only when no name data available

This provides consistent, human-readable approval information throughout the UI.
