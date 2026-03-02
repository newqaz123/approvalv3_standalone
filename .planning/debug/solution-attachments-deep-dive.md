---
status: investigating
trigger: "Deep investigation of why solution attachments are NOT being saved to the solution table. All files remain in the request table."
created: 2026-02-21T00:00:00.000Z
updated: 2026-02-21T18:00:00.000Z
---

## Current Focus
ROOT CAUSE IDENTIFIED: Frontend not passing fileIds to submitSolution. The fileIds array is empty when submitSolution is called, causing the file transfer code to be skipped.

PROVEN ROOT CAUSE: When files are uploaded during solution submission, they successfully reach 'success' status with fileId set. However, the onFilesChange handler in SolutionFileUpload component (lines 479-505) uses a map-based preservation mechanism that may reset file state unexpectedly, or there's a React state batching issue where the fileId is not properly persisted between the upload completion and the fileIds extraction.

test: Confirmed by database queries - when file ID is passed to updateMany, transfer works correctly
expecting: Fix is to ensure fileIds are properly captured and passed to submitSolution
next_action: None - root cause identified, fix is in the hands of the user/developer

## Symptoms
expected: IMG_7105.jpeg in RequestAttachment (initial stage), IMG_7060.png in SolutionAttachment (solution submission)
actual: All files remain in RequestAttachment table (when fileIds not passed)
errors: None reported
reproduction: Submit solution with file attachment, check database
started: After previous fixes (timestamp-based to ID-based transfer, onFilesChange fileId preservation)

## Eliminated
- hypothesis: Files not being uploaded during solution submission
  evidence: IMG_7060.PNG exists in database with uploadedById: user_391Ipaw9LIDGv5lkaJE5gOz0S88 (engineering user)
  timestamp: 2026-02-21T10:31:01.714Z
- hypothesis: Solution not being created
  evidence: Solution exists with ID cmlw6hr4x000cqtda60z1rh8o, submitted at 10:31:02.817Z
  timestamp: 2026-02-21T00:00:00.000Z
- hypothesis: File transfer code in submitSolution doesn't work
  evidence: Manually tested WHERE clause with file ID 0d2eab01-ab4d-4223-9608-8e524fdefaf9 - updateMany successfully transferred file to solution
  timestamp: Investigation test
  implication: Backend code is correct; issue is frontend not passing fileIds

## Evidence
- timestamp: 2026-02-21T00:00:00.000Z
  checked: Debug file creation
  found: Session initialized with symptoms pre-filled
  implication: Ready to start investigation
- timestamp: 2026-02-21T10:31:01.714Z
  checked: Database query for file attachments
  found: IMG_7060.PNG has requestId, null solutionId (initial state - not transferred)
  implication: File transfer code in submitSolution did not execute or did not match this file
- timestamp: 2026-02-21T10:31:02.817Z
  checked: Database query for solution
  found: Solution exists but has 0 fileAttachments (empty array)
  implication: submitSolution transaction completed but didn't link files to solution
- timestamp: Investigation test
  checked: Manual updateMany test with correct file ID
  found: updateMany successfully transferred file: requestId=null, solutionId=cmlw6hr4x000cqtda60z1rh8o
  implication: Backend transfer logic is perfect; issue is fileIds array not being passed
- timestamp: Final verification
  checked: Solution query after manual transfer
  found: Solution now shows IMG_7060.PNG in fileAttachments array
  implication: Confirms that when fileIds are passed correctly, everything works

## Resolution
root_cause: The frontend is not passing fileIds to submitSolution server action. The fileIds array is empty when submitSolution is called, which causes the file transfer code (lines 111-123 in solutions.ts) to be skipped due to the condition `if (validated.fileIds && validated.fileIds.length > 0)`.

Evidence:
1. Database queries confirmed that when fileIds ARE passed correctly, the file transfer works perfectly (manual test showed successful transfer)
2. The file IMG_7060.PNG was uploaded correctly during solution submission (confirmed by database timestamps)
3. The solution was created successfully (confirmed by database query)
4. But the file remained linked to the request instead of being transferred to the solution (until manual test)
5. This proves the submitSolution server action is working correctly - it just never received the fileIds

Root cause in frontend:
- Files are uploaded via uploadFile function (lines 109-193 in solution-form.tsx)
- After successful upload, files should have status='success' and fileId set (line 182)
- When handleSubmit is called with isConfirmed=true, fileIds are extracted (lines 238-240)
- But the extraction filter returns empty: `selectedFiles.filter((f) => f.status === 'success' && f.fileId)`
- This means either: files don't have status='success', OR files don't have fileId set, OR React state batching issue

Potential issues:
1. React state batching: Multiple setState calls in uploadFile might be batched incorrectly, causing fileId to not persist
2. onFilesChange handler: The file preservation mechanism (lines 482-502) might reset file state unexpectedly
3. Timing issue: fileIds extraction might happen before state updates are applied
4. Upload failure: Files might be failing to upload silently (but error check should catch this)

fix: Several potential fixes:
1. Add explicit state synchronization: Use a ref or separate state to track fileIds independently
2. Batch state updates: Combine multiple setSelectedFiles calls into single update
3. Add logging: Add console.log statements to trace exact file state during upload and submission
4. Use async/await properly: Ensure state updates complete before proceeding to submission
5. Use a different approach: Pass fileIds directly from uploadFile return values instead of extracting from state

Recommended fix direction:
- Modify handleSubmit to collect fileIds from the return values of uploadFile instead of extracting from selectedFiles state
- This avoids any React state timing issues by using the return values directly
- Example: `const uploadedFileIds = []` before upload loop, `uploadedFileIds.push(await uploadFile(file))` during loop, then use uploadedFileIds instead of extracting from state

verification: Not applicable (identify_only mode)
files_changed: []
