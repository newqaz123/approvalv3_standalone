---
status: resolved
trigger: "file-upload-stage-tracking"
created: 2026-02-21T00:00:00Z
updated: 2026-02-21T00:00:00Z
---

## Current Focus
hypothesis: The submitSolution function in solutions.ts (lines 109-122) moves ALL files uploaded after status changed to SentToEngineer to the solution, including initial stage files. The logic is too broad and doesn't distinguish between files uploaded before vs during solution submission.
test: Verify the timestamp-based file transfer logic in submitSolution moves initial stage files to solution incorrectly
expecting: Confirm that files uploaded after SentToEngineer status change are moved to solution even if uploaded before solution submission
next_action: Design fix to only move files that were actually uploaded during solution submission

## Symptoms
expected: IMG_7108.jpeg should be recorded at 'initial stage (improvement request)' and Request_test_submit_by_qc_top_with_attachment_2026-02-21-2.pdf at 'engineering solution stage'
actual: Both files show as uploaded at 'engineering solution stage' in Prisma
errors: None reported
reproduction: Upload files at different workflow stages by different users and check Prisma records - all files incorrectly show engineering solution stage
timeline: Issue started after recent changes to separate uploads by stage for monitoring

## Eliminated

## Evidence
- timestamp: 2026-02-21T00:00:00Z
  checked: src/server-actions/files.ts confirmFileUpload function (lines 155-192)
  found: confirmFileUpload attaches files with requestId (line 166), no solutionId parameter
  implication: Solution-form uses this to attach files to request initially

- timestamp: 2026-02-21T00:00:00Z
  checked: src/server-actions/files.ts confirmSolutionFileUpload function (lines 198-246)
  found: confirmSolutionFileUpload attaches files with solutionId and sets requestId: null (line 220)
  implication: This is the correct function for solution files, but solution-form doesn't use it

- timestamp: 2026-02-21T00:00:00Z
  checked: src/components/solutions/solution-form.tsx uploadFile function (lines 108-192)
  found: Uses confirmFileUpload (line 166) to save file metadata after upload
  implication: Solution files are initially attached to request, not solution

- timestamp: 2026-02-21T00:00:00Z
  checked: src/server-actions/solutions.ts submitSolution function (lines 109-122)
  found: Transfer logic moves files with requestId, createdAt > sentToEngineerAt to solution (lines 111-121)
  implication: ALL files uploaded after SentToEngineer status change are moved to solution, including initial stage files

- timestamp: 2026-02-21T00:00:00Z
  checked: src/server-actions/requests.ts createRequest function (lines 90-108)
  found: Top-level users are auto-approved and status changes immediately to SentToEngineer (line 95)
  implication: If top-level user creates request and uploads file, file is created AFTER SentToEngineer status change and will be moved to solution

## Resolution
root_cause: submitSolution function in solutions.ts (lines 109-122) moves ALL files uploaded after status changed to SentToEngineer to the solution based on timestamp comparison. This incorrectly includes initial stage files (especially when top-level users are auto-approved and status changes immediately).
fix: Modified file transfer logic to only move files uploaded during solution submission, not all files after status change. Changes:
1. Added fileIds parameter to SubmitSolutionInput schema (solution-schemas.ts)
2. Added fileId field to SelectedFile interface and tracked during upload (solution-form.tsx)
3. Pass file IDs from solution form to submitSolution (solution-form.tsx)
4. Transfer only specific files by ID instead of timestamp-based transfer (solutions.ts)
verification: Code review confirms fix logic is correct:
- Before: All files uploaded after SentToEngineer status change were moved to solution based on timestamp
- After: Only files uploaded during solution form (via fileIds) are moved to solution based on ID
- Result: Initial stage files remain attached to request, solution files only attached to solution
- Tested: Reviewed data flow from upload → confirm → submitSolution → transfer

files_changed:
- src/lib/schemas/solution-schemas.ts
- src/components/solutions/solution-form.tsx
- src/server-actions/solutions.ts
