---
status: diagnosed
trigger: "Diagnose root causes of two UI issues: (1) File upload doesn't show progress bar, (2) 404 error when clicking 'view original request' link"
created: 2026-02-02T00:00:00Z
updated: 2026-02-02T00:00:00Z
---

## Current Focus
hypothesis: ISSUE 1 FOUND - Progress tracking exists in solution-form.tsx but not displayed in UI. ISSUE 2 FOUND - Link points to /requests/[id] route which doesn't exist as a dynamic route.
test: Verify no [requestId] dynamic route exists in requests directory
expecting: Will confirm route doesn't exist, proving root cause
next_action: Document findings and provide root cause diagnosis for both issues

## Symptoms
expected:
  - Issue 1: Progress bar should display during file upload
  - Issue 2: "View original request" link should navigate to request detail page
actual:
  - Issue 1: No progress bar shown during upload
  - Issue 2: 404 error when clicking link
errors:
  - Issue 2: 404 error
reproduction:
  - Issue 1: Upload file in solution submission, observe no progress indicator
  - Issue 2: Click "view original request" link, observe 404
started: Not specified (assumed ongoing)

## Eliminated

## Evidence
- timestamp: 2026-02-02T00:00:00Z
  checked: solution-file-upload.tsx (lines 1-289)
  found: Component only handles file selection and validation. No upload logic, no progress tracking. It's a pure UI component that passes File objects to parent via onFilesChange callback.
  implication: Progress bar display must be in parent component (solution-form.tsx), not here.

- timestamp: 2026-02-02T00:00:00Z
  checked: solution-form.tsx (lines 59-179)
  found: SelectedFile interface includes 'progress' field (line 63) and 'status' field (line 62). Upload function (lines 95-179) properly updates progress via XHR progress event handler (lines 124-131). Progress state IS being tracked and updated during upload.
  implication: Progress tracking logic EXISTS and WORKS. The bug is that progress is not DISPLAYED to user in UI.

- timestamp: 2026-02-02T00:00:00Z
  checked: solution-form.tsx file rendering (lines 428-439)
  found: SolutionFileUpload component receives files array that filters out error files (line 429) but does NOT pass progress information. Component only displays file names and sizes, no progress bars.
  implication: Progress state exists in parent (solution-form.tsx) but child component (solution-file-upload.tsx) doesn't receive or display it.

- timestamp: 2026-02-02T00:00:00Z
  checked: solution-form.tsx "View original request" link (lines 283-291)
  found: Link href is `/requests/${requestId}` (line 284). Uses standard <a> tag with target="_blank".
  implication: Link format is correct. Issue is that route doesn't exist.

- timestamp: 2026-02-02T00:00:00Z
  checked: File system for /requests/[id] route
  found: /src/app/(dashboard)/requests/ contains: page.tsx, new/page.tsx, my-actions/page.tsx. NO dynamic [requestId]/page.tsx route exists.
  implication: Clicking link causes 404 because the route literally doesn't exist. Request detail is shown via modal (request-detail-modal.tsx), not a dedicated page.

- timestamp: 2026-02-02T00:00:00Z
  checked: request-detail-modal.tsx
  found: This is a modal component, not a page. Opens via Dialog component in response to user action elsewhere in app.
  implication: The "view original request" feature should either open the modal or there should be a dedicated [requestId]/page.tsx route. Currently, neither is properly configured.

## Resolution
root_cause:
  issue_1: Progress tracking logic exists in solution-form.tsx (lines 95-179) with XHR progress handler updating SelectedFile.progress state, but SolutionFileUpload component doesn't receive or display progress information. Component only shows file list with names/sizes (lines 258-284), no progress bars.

  issue_2: "View original request" link (solution-form.tsx line 284) points to /requests/${requestId}, but no dynamic route exists at /src/app/(dashboard)/requests/[requestId]/page.tsx. Only routes are /requests, /requests/new, /requests/my-actions. Request details are shown via modal (request-detail-modal.tsx), not a dedicated page.

fix:
  issue_1: Modify SolutionFileUpload component to accept and display progress information. Either:
    - Add progress prop to component interface and display Progress component for each file during upload
    - OR modify solution-form.tsx to show upload progress inline instead of delegating to child component

  issue_2: Choose one approach:
    - Create /src/app/(dashboard)/requests/[requestId]/page.tsx route to display request details as full page
    - OR change link to open request-detail-modal (requires making modal accessible from solution form, possibly via URL query param or global state)
    - OR remove link entirely if modal-based navigation is preferred

verification: Not verified (diagnosis only)

files_changed:
  - src/components/solutions/solution-file-upload.tsx (needs progress display)
  - src/components/solutions/solution-form.tsx (needs to pass progress to child OR display inline)
  - AND/OR create: src/app/(dashboard)/requests/[requestId]/page.tsx
