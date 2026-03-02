---
status: diagnosed
trigger: "Investigate and diagnose root cause of solution submission error"
created: 2026-02-03T00:00:00.000Z
updated: 2026-02-03T00:00:01.000Z
symptoms_prefilled: true
goal: find_root_cause_only
---

## Current Focus
hypothesis: File upload validation is checking if userId matches requesterId, but engineering users uploading solution files are NOT the original requester
test: Trace file upload flow from solution form through prepareFileUpload to /api/upload
expecting: Confirm that validation at line 78 in files.ts and line 58 in /api/upload/route.ts rejects engineering users
next_action: Document root cause and resolution

## Symptoms
expected: submitSolution should find the request by ID, verify user is engineering user, verify request status is SentToEngineer, and create solution with file attachments
actual: "Request not found or unauthorized" error when engineering user clicks 'confirm&submit' on solution form
errors: "Request not found or unauthorized"
reproduction: Engineering user level 2 clicks 'confirm&submit' on solution form at http://localhost:3000/engineering/solutions/cml51ky4c0001qtygjvljow2h with file attachment
started: After fixing "use server" export error in plan 04-08

## Eliminated
- hypothesis: submitSolution action validation failing
  evidence: submitSolution function does not contain the error message "Request not found or unauthorized"
  timestamp: 2026-02-03T00:00:00.000Z
- hypothesis: Request lookup failing in submitSolution
  evidence: Error occurs during file upload phase, not during submitSolution call
  timestamp: 2026-02-03T00:00:00.000Z

## Evidence
- timestamp: 2026-02-03T00:00:00.000Z
  checked: src/server-actions/solutions.ts
  found: submitSolution function has no matching error message. Validations check user.role === UserRole.engineering and request.status === RequestStatus.SentToEngineer
  implication: Error is not from submitSolution action itself

- timestamp: 2026-02-03T00:00:00.500Z
  checked: Grep search for exact error message
  found: Error appears in .planning/phases/04-engineering-solutions/04-engineering-solutions-UAT.md, src/server-actions/files.ts:81, src/app/api/upload/route.ts:60
  implication: Error originates from file upload system, not solution submission

- timestamp: 2026-02-03T00:00:01.000Z
  checked: src/components/solutions/solution-form.tsx (lines 96-180)
  found: uploadFile function calls prepareFileUpload (line 104), then uploads to /api/upload (line 149), then calls confirmFileUpload (line 154)
  implication: File upload happens BEFORE submitSolution is called. Error occurs in upload phase

- timestamp: 2026-02-03T00:00:01.500Z
  checked: src/server-actions/files.ts (lines 73-83)
  found: prepareFileUpload validates `if (!request || request.requesterId !== userId)` and returns error 'Request not found or unauthorized'
  implication: Validation checks if current user is the ORIGINAL REQUESTER who created the request

- timestamp: 2026-02-03T00:00:02.000Z
  checked: src/app/api/upload/route.ts (lines 54-63)
  found: Upload endpoint validates `if (!dbRequest || dbRequest.requesterId !== userId)` and returns same error
  implication: Both file upload functions validate requester ownership, not engineering access

## Resolution
root_cause: File upload authorization checks (prepareFileUpload and /api/upload) validate that `request.requesterId === userId`, which only allows the original requester to upload files. Engineering users submitting solutions are NOT the requester, so they fail this validation.

The file upload system was designed for requesters uploading files to their own requests, but solution submission requires engineering users to upload files to requests they didn't create.

**Exact locations:**
1. src/server-actions/files.ts:78 - `if (!request || request.requesterId !== userId)`
2. src/app/api/upload/route.ts:58 - `if (!dbRequest || dbRequest.requesterId !== userId)`

**What validation is failing:**
Engineering user (userId=engineeringUser) uploads file for requestId=cml51ky4c0001qtygjvljow2h
Request.requesterId = originalRequesterUser
engineeringUser !== originalRequesterUser → Validation fails → Error returned

fix: Modify file upload authorization to allow engineering users to upload files when request is in SentToEngineer status. Change validation from "requester only" to "requester OR engineering users with proper request status".

verification: []
files_changed: []
- src/server-actions/files.ts (prepareFileUpload function)
- src/app/api/upload/route.ts (POST handler)
