---
status: resolved
trigger: "solution-resubmit-file-management-not-working"
created: 2026-02-06T00:00:00Z
updated: 2026-02-06T00:08:00Z
---

## Current Focus

hypothesis: Files uploaded during solution submission are being linked to requestId instead of solutionId, so previousSolution.fileAttachments query returns empty array
test: Verify that submitSolution links uploaded files to the created solution
expecting: Will find that submitSolution creates the solution but doesn't update files to link them to solutionId
next_action: Confirm root cause and implement fix to link files to solution after creation

## Symptoms

expected: When resubmitting a solution, users should be able to remove existing file attachments and add new files, similar to how request resubmission works
actual: File attachment editing doesn't work in solution resubmission page
errors: None reported (UI issue - buttons/functionality missing or not working)
reproduction:
1. Navigate to /engineering/solutions/cmlazmpmc0003qttixitcbns7 (solution resubmission page)
2. Try to remove existing files or manage attachments
3. Functionality doesn't work
started: Should be working after quick-008 (file attachment management for resubmission) was completed. Request resubmission works correctly, but solution resubmission doesn't.

## Eliminated

## Evidence

- timestamp: 2026-02-06T00:01:00Z
  checked: Solution resubmission page (page.tsx), SolutionForm component, SolutionFileUpload component
  found: The page DOES pass existingFiles (line 139: previousFiles={previousSolution?.fileAttachments || []}). SolutionForm DOES manage state for existingFiles (line 89). SolutionForm DOES pass props to SolutionFileUpload (lines 483-484: existingFiles={existingFiles} and onRemoveExistingFile={handleRemoveExistingFile}). SolutionFileUpload component HAS support for displaying and removing existing files (lines 254-288).
  implication: The implementation looks complete and correct. All the necessary props are being passed and handlers exist. Need to verify if there's a runtime issue.

- timestamp: 2026-02-06T00:02:00Z
  checked: Compared with working ResubmitRequestDialog implementation
  found: ResubmitRequestDialog (lines 63-64, 90-102, 183-210) has similar pattern - maintains files state, has handleRemoveFile function, displays files with remove buttons. The pattern in SolutionForm is identical.
  implication: The solution implementation follows the same pattern as the working request implementation. Code structure is correct.

- timestamp: 2026-02-06T00:03:00Z
  checked: File attachment linking logic in confirmFileUpload and submitSolution
  found: confirmFileUpload (files.ts:153-164) only sets requestId, NOT solutionId. submitSolution (solutions.ts) creates the solution but has NO code to link uploaded files to the solutionId. FileAttachment model has both requestId and solutionId as optional fields.
  implication: Files uploaded during solution submission remain linked to requestId only. When page queries previousSolution.fileAttachments (which filters by solutionId), it returns empty array because no files have solutionId set.

- timestamp: 2026-02-06T00:04:00Z
  checked: Request resubmission data flow
  found: ResubmitRequestDialog receives request.fileAttachments where files have requestId set (request-detail-modal.tsx:401). This works because request files ARE supposed to be linked to requestId.
  implication: The data model supports both request files (requestId) and solution files (solutionId). Solution files should be linked to solutionId, but currently they aren't.

- timestamp: 2026-02-06T00:07:00Z
  checked: Resubmission flow with file management
  found: When solution is rejected, old solution and files remain in DB. User can remove old files (deletes them) or keep them. New files are uploaded with requestId only. Need to link BOTH new files AND kept old files to new solution.
  implication: Updated fix to link ALL files with matching requestId (not just solutionId: null), which handles both new files and files from previous solution that user chose to keep.

## Resolution

root_cause: Files uploaded during solution submission are only linked to requestId, never to solutionId. When the solution resubmission page queries previousSolution.fileAttachments (filtering by solutionId), it returns an empty array. The UI code is correct - it's a data linking issue in submitSolution server action.
fix: Added code in submitSolution transaction (after solution creation) to update ALL file attachments with matching requestId to link them to the newly created solution. This handles both new files (solutionId: null) and files from previous solution that user kept (old solutionId).
verification: Verified TypeScript compilation passes. Logic handles initial submission, resubmission with kept files, and resubmission with removed/added files.
files_changed: ['src/server-actions/solutions.ts']
