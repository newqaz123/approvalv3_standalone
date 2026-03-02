---
phase: quick-008
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server-actions/files.ts
  - src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx
  - src/components/solutions/solution-form.tsx
  - src/components/solutions/solution-file-upload.tsx
  - src/components/requests/resubmit-request-dialog.tsx
  - src/components/requests/file-upload-zone.tsx
  - src/server-actions/requests.ts
autonomous: true

must_haves:
  truths:
    - "When resubmitting a solution, user sees existing file attachments from the previous solution"
    - "User can remove existing file attachments during solution resubmission"
    - "User can add new file attachments during solution resubmission"
    - "When resubmitting a request, user sees existing file attachments"
    - "User can remove existing file attachments during request resubmission"
    - "User can add new file attachments during request resubmission"
  artifacts:
    - path: "src/server-actions/files.ts"
      provides: "deleteFileAttachment server action"
      exports: ["deleteFileAttachment"]
    - path: "src/components/solutions/solution-form.tsx"
      provides: "Existing file display with remove capability on resubmission"
    - path: "src/components/requests/resubmit-request-dialog.tsx"
      provides: "Existing file display with remove and add capability"
  key_links:
    - from: "src/components/solutions/solution-form.tsx"
      to: "deleteFileAttachment"
      via: "server action call on remove button click"
      pattern: "deleteFileAttachment"
    - from: "src/components/requests/resubmit-request-dialog.tsx"
      to: "deleteFileAttachment"
      via: "server action call on remove button click"
      pattern: "deleteFileAttachment"
---

<objective>
Add file attachment management (view existing, remove, add new) to both solution resubmission and request resubmission flows.

Purpose: Currently when a solution or request is rejected and resubmitted, the user cannot see, remove, or add file attachments. They can only edit text fields. This makes resubmission incomplete since files may need updating.

Output: Both resubmit flows show existing attachments with remove buttons and allow adding new files.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/server-actions/files.ts
@src/components/solutions/solution-form.tsx
@src/components/solutions/solution-file-upload.tsx
@src/components/requests/resubmit-request-dialog.tsx
@src/components/requests/file-upload-zone.tsx
@src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx
@prisma/schema.prisma (FileAttachment model - has requestId and solutionId fields)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add deleteFileAttachment server action and load previous solution files</name>
  <files>
    src/server-actions/files.ts
    src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx
  </files>
  <action>
    1. In `src/server-actions/files.ts`, add a new `deleteFileAttachment` server action:
       - Accepts `{ fileId: string }` as input
       - Authenticates user via `await auth()`
       - Fetches the FileAttachment record including its requestId and solutionId
       - Authorization: user must be the file uploader (uploadedById === userId), OR the request owner (requesterId === userId), OR an engineering user for engineering-phase requests
       - Deletes the FileAttachment record from database
       - Deletes the physical file from disk using `fs/promises.unlink()` with path.join(process.cwd(), 'public', filePath) - wrap in try/catch, log warning on failure (file may already be gone)
       - Logs activity via RequestActivity with action='file_removed' and comments including the file name
       - Revalidates relevant paths
       - Returns `{ success: true }` or throws on error

    2. In `src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx`:
       - Include `fileAttachments` in the `previousSolution` Prisma query by adding to the select: `fileAttachments: { select: { id: true, fileName: true, fileType: true, fileSize: true, filePath: true } }`
       - Pass `previousFiles` to SolutionForm as a new prop, mapping from the query result. Type: `Array<{ id: string; fileName: string; fileType: string; fileSize: number; filePath: string }>`
       - Also query request-level fileAttachments (where solutionId is null) and pass those too as `existingRequestFiles` - these are the request's own attachments

    Note: Files in FileAttachment can be linked to either a request (requestId) or a solution (solutionId). For solution resubmission, we care about files linked to the previous solution (solutionId set). The request's own files (requestId set, solutionId null) are separate.
  </action>
  <verify>
    - `npx tsc --noEmit` passes
    - The deleteFileAttachment function is exported from files.ts
    - The solution page passes previousFiles to SolutionForm
  </verify>
  <done>
    - deleteFileAttachment server action exists with proper auth, file deletion, and audit logging
    - Solution submission page fetches and passes previous solution's file attachments to the form
  </done>
</task>

<task type="auto">
  <name>Task 2: Add existing file management to solution resubmission form</name>
  <files>
    src/components/solutions/solution-form.tsx
    src/components/solutions/solution-file-upload.tsx
  </files>
  <action>
    1. Update `SolutionForm` props interface to accept:
       ```
       previousFiles?: Array<{ id: string; fileName: string; fileType: string; fileSize: number; filePath: string }>
       ```

    2. In `SolutionForm`, add state for existing files that can be removed:
       - `existingFiles` state initialized from `previousFiles` prop
       - `removedFileIds` state (string[]) to track which existing files to delete on submit
       - Handler `handleRemoveExistingFile(fileId)` that calls `deleteFileAttachment({ fileId })` immediately (not deferred to submit), removes from existingFiles state, and shows toast feedback

    3. Update `SolutionFileUpload` component to also accept and display existing files:
       - Add new prop `existingFiles?: Array<{ id: string; fileName: string; fileType: string; fileSize: number; filePath: string }>`
       - Add new prop `onRemoveExistingFile?: (fileId: string) => void`
       - Render existing files in a separate section ABOVE the new file upload zone, labeled "Existing Attachments" with a subtle border/background
       - Each existing file shows: file icon (reuse getFileIcon logic based on extension), file name, file size, and a red X remove button
       - When remove is clicked, call `onRemoveExistingFile(fileId)`
       - Show existing file count in the total file count display (e.g., "3 existing + 1 new / 10 files")

    4. Wire it all together in SolutionForm:
       - Pass `existingFiles` and `handleRemoveExistingFile` to SolutionFileUpload
       - Import `deleteFileAttachment` from `@/server-actions/files`
       - Import `toast` from `sonner` (already imported)
       - On remove: call deleteFileAttachment, update state, show toast "File removed"
       - On error: show toast with error message, don't remove from state

    5. In the SolutionPreview component reference (previewData), include existingFiles count so preview shows total attachment count.
  </action>
  <verify>
    - `npx tsc --noEmit` passes
    - Navigate to `/engineering/solutions/{requestId}` for a request that has a previous rejected solution with files
    - Existing files from previous solution are displayed
    - Clicking remove on an existing file deletes it and updates the UI
    - New files can still be added via drag-and-drop or click
  </verify>
  <done>
    - Solution resubmission form shows existing files from previous solution
    - Users can remove existing files (immediately deleted via server action)
    - Users can add new files alongside or instead of existing ones
    - Toast feedback on file removal success/failure
  </done>
</task>

<task type="auto">
  <name>Task 3: Add file management to request resubmission dialog</name>
  <files>
    src/components/requests/resubmit-request-dialog.tsx
    src/components/requests/request-detail-modal.tsx
  </files>
  <action>
    1. Update `ResubmitRequestDialog` props to accept existing files:
       ```
       existingFiles?: Array<{ id: string; fileName: string; fileType: string; fileSize: number; filePath: string }>
       ```

    2. In `ResubmitRequestDialog`:
       - Add state: `existingFiles` initialized from prop, `isRemoving` (string | null) for loading state
       - Import `deleteFileAttachment` from `@/server-actions/files`
       - Import `toast` from `sonner`
       - Import `FileUploadZone` from `@/components/requests/file-upload-zone`
       - Import file icons: `File, FileText, X` from `lucide-react`

    3. Add existing files section in the form (between description and error/footer):
       - Section header "Current Attachments" (only show if existingFiles has items)
       - List each file with icon, name, size, and red X remove button
       - On remove click: set isRemoving to fileId, call deleteFileAttachment, on success remove from state and toast "File removed", on error toast error, clear isRemoving
       - Disable remove button while isRemoving === fileId (show spinner or opacity)

    4. Add new file upload section below existing files:
       - Section header "Add New Attachments"
       - Embed `FileUploadZone` component with `requestId` prop
       - This allows uploading new files directly (FileUploadZone already handles the full upload flow)

    5. Find where `ResubmitRequestDialog` is rendered in `request-detail-modal.tsx`:
       - Pass the request's fileAttachments to the dialog as `existingFiles` prop
       - The request detail modal already fetches fileAttachments in its data query - map them to the expected format: `{ id, fileName, fileType, fileSize, filePath }`

    Note: The dialog may need to grow taller. Update `DialogContent` className to include `max-h-[80vh] overflow-y-auto` to handle the additional content.
  </action>
  <verify>
    - `npx tsc --noEmit` passes
    - Open a rejected request in the detail modal
    - Click "Edit & Resubmit" button
    - Existing file attachments are displayed in the dialog
    - Can remove existing files with toast feedback
    - Can add new files via the upload zone
    - Dialog scrolls properly if content exceeds viewport
  </verify>
  <done>
    - Request resubmission dialog shows existing file attachments with remove capability
    - New files can be uploaded during request resubmission
    - File removal is immediate with server action and toast feedback
    - Dialog handles overflow gracefully with scroll
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no type errors
2. Solution resubmission: reject a solution, navigate to resubmit, see previous files, remove one, add a new one, submit
3. Request resubmission: reject a request, open detail modal, click Edit & Resubmit, see existing files, remove one, add a new one, resubmit
4. Verify deleted files are removed from database (check FileAttachment table)
5. Verify audit trail logs file_removed actions in RequestActivity
</verification>

<success_criteria>
- Both solution and request resubmission flows display existing file attachments
- Users can remove existing files (immediate deletion with server action)
- Users can add new files during resubmission
- All file operations have toast feedback
- Audit trail captures file removals
- No TypeScript errors
</success_criteria>

<output>
After completion, create `.planning/quick/008-re-submit-solution-can-also-remove-add-t/008-SUMMARY.md`
</output>
