# Create-unit Parent Picker Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Match Parent unit to the Assign person hierarchy picker.

**Architecture:** Reuse UnitTreeSelect in CreateUnitDialogView. Add optional trigger/search test IDs with unchanged defaults for existing callers.

**Tech Stack:** React, Radix Popover, cmdk, TypeScript, Playwright.

**Spec:** docs/superpowers/specs/2026-11-16-create-unit-parent-picker-design.md

## Global Constraints
No new dependencies, server changes or migrations. Preserve current validation and existing test IDs.

## Review Focus
- Duplicate names must resolve by unit ID and display distinct full paths.
- Inactive units must not be offered.
- Ancestor search must include descendants.
- Keyboard selection must work inside the create dialog.
- Assign person defaults must remain unchanged.

## Task 1: Reuse the hierarchy picker
Files: modify src/components/organization/CreateUnitDialog.tsx and UnitTreeSelect.tsx; add tests/regression/create-unit-parent-picker.test.ts.

Interfaces: UnitTreeSelect keeps current props and adds optional triggerTestId/searchTestId strings defaulting to existing assignment identifiers.

- [x] Add a real browser test mounting CreateUnitDialog with no-write server-action and router adapters. Assert tree order, indentation, breadcrumb text, ancestor search, inactive exclusion, distinct IDs for duplicate names, keyboard selection and selected full path.
- [x] Run `npx tsx --test tests/regression/create-unit-parent-picker.test.ts`; expect failure because the flat picker has no search.
- [x] Replace the flat Select with UnitTreeSelect; preserve placeholder, label, and trigger identifier. Keep the exported parent-options helper for compatibility.
- [x] Run new and existing create/assignment regression tests; expect pass.
- [x] Run `npm run check`, regression suite and `graphify update .`; report any existing blockers without altering unrelated dependencies.
- [x] Review diff and leave changes ready for the user's commit request.

## Execution record
- Browser test failed because the old flat picker had no search; passed after reuse.
- Targeted tests: 32 passed. Full regression suite: 3501 passed, 2 skipped.
- Full check remains blocked by existing unrelated Remotion/Tiptap type errors. No type errors in changed files.
- Graph updated; diff whitespace check passed. Author self-review only; no independent agent review authorized.
- Updated the existing deactivation E2E fixture to read the option's accessible unit name rather than concatenated name and breadcrumb. The database-backed E2E was not run.

