---
phase: quick
plan: 009
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/solutions/solution-file-upload.tsx
  - src/components/solutions/solution-form.tsx
autonomous: true

must_haves:
  truths:
    - "User can remove a newly selected file from the solution form before submitting"
    - "Removing a file does not reset other files' state or cause index mismatch"
  artifacts:
    - path: "src/components/solutions/solution-file-upload.tsx"
      provides: "Working remove button for pending files during initial submission"
    - path: "src/components/solutions/solution-form.tsx"
      provides: "Correct file removal handler that preserves other files' state"
  key_links:
    - from: "src/components/solutions/solution-file-upload.tsx"
      to: "src/components/solutions/solution-form.tsx"
      via: "onRemoveFile callback by file ID"
      pattern: "onRemoveFile.*id"
---

<objective>
Fix the remove file button for newly selected files during initial solution submission.

Purpose: Currently, the SolutionFileUpload component's `removeFile` function uses an array index from `displayFiles` (which may use `filesWithProgress`) but operates on the `files` prop (basic File[] array). When `filesWithProgress` is provided, the indices diverge, causing the wrong file to be removed or no removal at all. Additionally, the `onFilesChange` callback in SolutionForm rebuilds ALL selectedFiles with new IDs, losing state of other files.

Output: A working remove (X) button on each pending file in the solution submission form that correctly removes only the targeted file.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/components/solutions/solution-file-upload.tsx
@src/components/solutions/solution-form.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix file removal in SolutionFileUpload and SolutionForm</name>
  <files>
    src/components/solutions/solution-file-upload.tsx
    src/components/solutions/solution-form.tsx
  </files>
  <action>
    The root cause is a mismatch between how files are displayed and how they are removed:

    1. In `solution-file-upload.tsx`:
       - The `removeFile(index)` function filters the `files` prop by array index
       - But `displayFiles` iterates over `filesWithProgress` (when provided), whose indices may not match `files`
       - Fix: Add a new `onRemoveFile` prop that accepts a file ID (string) instead of relying on index-based removal from the `files` array
       - Update the remove button onClick to call `onRemoveFile(item.id)` instead of `removeFile(index)`
       - Keep the existing `removeFile` by index as fallback for backward compatibility when `onRemoveFile` is not provided

    2. In `solution-form.tsx`:
       - Add a `handleRemoveNewFile` function that removes from `selectedFiles` state by ID:
         ```
         const handleRemoveNewFile = (fileId: string) => {
           setSelectedFiles((prev) => prev.filter((f) => f.id !== fileId))
         }
         ```
       - Pass this as `onRemoveFile={handleRemoveNewFile}` to the SolutionFileUpload component
       - This avoids the `onFilesChange` callback entirely for removal, preserving other files' IDs and state

    3. In `solution-file-upload.tsx` interface:
       - Add `onRemoveFile?: (fileId: string) => void` to `SolutionFileUploadProps`
       - In the remove button click handler, prefer `onRemoveFile(item.id)` if available, fall back to `removeFile(index)`
  </action>
  <verify>
    - `npx tsc --noEmit` passes with no type errors
    - Manually test: Navigate to /engineering/solutions/[requestId], select 2-3 files, click X on the middle file, confirm only that file is removed and others remain
  </verify>
  <done>
    Remove (X) button on each pending file correctly removes only that specific file by ID, other files retain their position and state, no index mismatch errors
  </done>
</task>

</tasks>

<verification>
- TypeScript compilation passes: `npx tsc --noEmit`
- Solution form renders file list with remove buttons visible on each pending file
- Removing a file by clicking X removes only that file, others remain unchanged
- File upload still works after removing a file (no broken state)
</verification>

<success_criteria>
- Each pending file in the initial solution submission form has a visible remove (X) button
- Clicking the remove button removes only the targeted file
- Remaining files keep their correct state (no ID regeneration or state reset)
- No TypeScript errors
</success_criteria>

<output>
After completion, create `.planning/quick/009-add-remove-file-button-during-initial-so/009-SUMMARY.md`
</output>
