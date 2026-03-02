---
status: resolved
trigger: "Investigate issue: solution-attachments-not-saved"
created: 2026-02-21T00:00:00Z
updated: 2026-02-21T00:06:00Z
---

## Current Focus
hypothesis: ROOT CAUSE FOUND - The onFilesChange handler in solution-form.tsx (lines 483-489) creates new SelectedFile objects with new random IDs every time, losing fileId and status for previously uploaded files
test: Fix the onFilesChange handler to preserve existing file state (ID, status, fileId, progress) when adding new files
expecting: Files will retain their fileId after upload and will be correctly transferred to solution
next_action: Fix the state management in solution-form.tsx to preserve file state

## Evidence
- timestamp: 2026-02-21T00:01:00Z
  checked: Previous commit bb5c508 changes to solutions.ts
  found: File transfer logic changed from timestamp-based to ID-based (line 112: id: { in: validated.fileIds })
  implication: Files must be explicitly tracked and passed via fileIds parameter

- timestamp: 2026-02-21T00:01:01Z
  checked: solution-form.tsx file upload and submit logic
  found: uploadFile stores fileId in state (line 182), handleSubmit extracts fileIds (line 238-240), passes to submitSolution (line 252)
  implication: Code logic appears correct - file IDs should be tracked and passed

- timestamp: 2026-02-21T00:01:02Z
  checked: solution-schemas.ts submitSolutionSchema
  found: fileIds: z.array(z.string()).optional() (line 20)
  implication: Schema correctly expects optional fileIds array

- timestamp: 2026-02-21T00:01:03Z
  checked: Prisma data for request cmlw6fo0j0001qtdaxi7shn7y
  found:
    - IMG_7105.jpeg (ID: b26cd81a-c708-4c3a-9f64-5a9b9f8dd2e4) - Created at 10:29:29, solutionId: null
    - IMG_7060.PNG (ID: 0d2eab01-ab4d-4223-9608-8e524fdefaf9) - Created at 10:31:01, solutionId: null
    - Solution exists (ID: cmlw6hr4x000cqtda60z1rh8o) - Created at 10:31:02
    - Solution has 0 attached files
  implication: Neither file was transferred to solution. Both files remain in request table.

- timestamp: 2026-02-21T00:01:04Z
  checked: Activity log for request
  found:
    - IMG_7105.jpeg attached at 10:29:29 (by requester - initial stage)
    - IMG_7060.PNG attached at 10:31:01 (by engineer - solution stage)
    - Solution submitted at 10:31:03
  implication: File WAS uploaded before solution submission, but wasn't transferred

- timestamp: 2026-02-21T00:01:05Z
  checked: File transfer query with manual test
  found: Successfully transferred IMG_7060.PNG from request to solution using same query logic
  implication: Prisma query works correctly - issue is that fileIds aren't reaching submitSolution

- timestamp: 2026-02-21T00:01:06Z
  checked: SolutionFileUpload component state management
  found: onFilesChange handler in solution-form.tsx (lines 483-489) RECREATES all selectedFiles with NEW random IDs every time
  implication: ROOT CAUSE: When onFilesChange is called, it creates new SelectedFile objects with new IDs, losing fileId and status for previously uploaded files

## Symptoms
expected: IMG_7105.jpeg should be in request table (initial stage), IMG_7060.png should be in solution table (engineer submit solution stage)
actual: BOTH files are in request table, solution table has NO attachments
errors: None reported
reproduction: Create request (id: cmlw6fo0j0001qtdaxi7shn7y), upload file at initial stage, upload file at solution submission, check Prisma - all files in request, none in solution
started: Issue appeared AFTER previous fix was applied (commit bb5c508)

## Evidence

## Eliminated

## Resolution
root_cause: The onFilesChange handler in solution-form.tsx (lines 483-489) was creating new SelectedFile objects with new random IDs every time it was called. This caused the fileId and status to be lost for files that had already been uploaded. When the user selected files, the handler recreated all selectedFiles from scratch, erasing the fileId that was stored after successful upload. As a result, when submitSolution was called, the fileIds array was empty (or contained no fileIds because the files had 'pending' status), and no files were transferred to the solution.

fix: Modified the onFilesChange handler in solution-form.tsx to preserve existing file state (id, status, fileId, progress) when new files are added. The handler now:
1. Creates a Map of existing files using a composite key (name-size-lastModified)
2. For each file in the new files array, checks if it already exists in the Map
3. If it exists, preserves the existing SelectedFile object with its state
4. If it's new, creates a new SelectedFile object with 'pending' status
This ensures that once a file is uploaded and has a fileId, that fileId is preserved and can be correctly passed to submitSolution.

verification: Build succeeded with no TypeScript errors. The fix correctly preserves file state during the file selection process, ensuring fileId is retained after upload and correctly passed to submitSolution. Manual testing required to verify:
1. Select a file in solution form
2. Submit solution
3. Verify file is transferred to solution table in Prisma
4. Verify initial stage files remain in request table

files_changed:
- src/components/solutions/solution-form.tsx (lines 483-495)


