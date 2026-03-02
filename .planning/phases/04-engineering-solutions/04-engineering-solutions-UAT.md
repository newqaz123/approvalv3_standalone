---
status: diagnosed
phase: 04-engineering-solutions
source: 04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md, 04-07-SUMMARY.md, 04-08-SUMMARY.md, 04-09-SUMMARY.md, 04-10-SUMMARY.md, 04-11-SUMMARY.md, 04-12-SUMMARY.md, 04-13-SUMMARY.md, 04-14-SUMMARY.md
started: 2026-02-04T10:00:00Z
updated: 2026-02-04T10:45:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete - awaiting issue diagnosis]

## Tests

### 1. Solution Submission Form
expected: Engineering users can access solution submission form at /engineering/solutions/[requestId] when request status is "SentToEngineer". Form includes: Title (required), Description (required), Cost Estimate (number, optional - can be empty), Currency (dropdown: THB, USD, EUR, default THB), Timeline (text, optional), Concept Design (text, optional), File attachments (drag-drop, supports PDF, images, CAD files, Office docs), Custom approval chain toggle (switch). Form shows validation errors for required fields.
result: pass

### 2. Solution Data Model Storage
expected: When an engineering user submits a solution (via solution submission form), the system stores solution title, description, cost estimate with currency (THB default), timeline (text field), concept design (text field), associated request ID, and custom approval chain (if specified) or hierarchy-based approvals. Verify: After submitting a solution, refresh the page and confirm solution details persist.
result: pass

### 3. Preview Before Submit
expected: After filling solution form, clicking "Preview Solution" shows read-only summary of all entered data including title, description, cost estimate with currency symbol, timeline, concept design, file list with names and sizes, and custom approval chain (if enabled) with numbered sequential approvers. User can "Edit" to go back or "Submit Solution" to finalize.
result: pass

### 4. Custom Approval Chain Picker
expected: When "Use Custom Approval Chain" toggle is enabled, Custom Approval Picker component appears with: Searchable dropdown of all users (excludes current user), "Add Approver" button, Sequential list of selected approvers with numbered badges (1, 2, 3...), Up/Down arrows to reorder approvers, "Remove" button for each approver. Approval order matches display order (top to bottom).
result: pass

### 5. Solution File Upload
expected: Solution file upload supports drag-and-drop and click-to-select. Validates file types: PDF (.pdf), Images (.png, .jpg, .jpeg, .gif), CAD files (.dwg, .dxf, .stp, .step), Office docs (.doc, .docx, .xls, .xlsx, .ppt, .pptx). Shows file size in human-readable format (e.g., "2.3 MB"). Shows upload progress bar during upload. Allows removing files before submission.
result: pass

### 6. Solution Approval Workflow
expected: When solution is submitted, request status changes to "DesignCostEstimationApproval". Engineering approvers see "Approve" and "Reject" buttons in request detail modal. Clicking "Approve" (with optional comments) advances approval chain. Clicking "Reject" requires minimum 10-character comments and returns request to "SentToEngineer" status. Next approver in chain receives notification when previous approval completes.
result: issue
reported: "Status changed. Eng. Approver not see approve and reject botton."
severity: major

### 7. Top-Level Auto-Approval
expected: When engineering user who is at top level of hierarchy submits solution, it bypasses engineering approval chain and goes directly to "SendBackToRequester" status. Solution shows as "Auto-approved" in approval timeline. No engineering approval buttons shown to submitter or other engineering users.
result: issue
reported: "engineering user who is at top level of hierarchy can't see solution submit botton in request"
severity: major

### 8. Visual Approval Timeline
expected: Request detail modal shows "Solution Approval Progress" section with: Numbered steps for each approval in chain, Status badges (Approved/Pending), Current pending approval highlighted with blue background, Approver names and timestamps for completed approvals. Timeline updates in real-time as approvals progress.
result: issue
reported: "Not show step of Solution Approval Progress. only show current 1 pending and no blue background."
severity: minor

### 9. Engineering Dashboard
expected: Engineering users can access /engineering dashboard showing: Quick stats (Total in Pipeline, Awaiting Solution, In Approval Process), "Needs My Action" tab with two sections: "Requests Awaiting Solution" (SentToEngineer status) and "Solutions Awaiting Approval" (DesignCostEstimationApproval status), "All Engineering Requests" tab with full list. Non-engineering users redirected to /dashboard.
result: issue
reported: "see dashboard.'All Engineering Requests' clicked and 404 error. See list in Solutions Awaiting Your Approval but when clicked 'review&Approve' it redirect to main request page with link'http://localhost:3000/requests?open=cml7y7kn8000fqtzp246809l2'"
severity: major

### 10. Person in Charge Display
expected: Engineering dashboard shows assigned engineers for each request in "Requests Awaiting Solution" table. Assignment is informational only - any engineering user can submit solution regardless of assignment. Assignments made via "Assign Engineers" functionality.
result: pass

### 11. Solution Detail View in Modal
expected: Opening request detail modal for requests with solutions shows: Solution title and description, Cost estimate formatted with currency symbol (e.g., "฿15,000"), Timeline text, Concept design text, Solution file attachments with download links, Solution approval progress section, "Submit Solution" button (if SentToEngineer status and user is engineering), Approval action buttons (if DesignCostEstimationApproval status and user can approve).
result: issue
reported: "show all data. but 'Solution Approval Progress' and 'Approval Progress' and Activity History have to redesign for minimal. and 'Solution Approval Progress' still not show approve hierarchy step."
severity: minor

### 12. Final Approval Initiation
expected: When request status is "SendBackToRequester" and user is in requester's department, "Initiate Final Approval" button appears in request detail modal. Clicking shows dialog with two buttons: "Use Department Hierarchy" and "Use Custom Approval Chain". Custom chain picker appears (same as solution approval picker) if custom option selected. After selection, request status changes to "FinalApproval" and approval chain is created.
result: skipped
reason: User requested skip

### 13. Final Approval Workflow
expected: When request is in "FinalApproval" status, approvers see "Approve" and "Reject" buttons in request detail modal. Approval chain works like solution approval (sequential, any-one-per-level). Clicking "Approve" (with optional comments) advances chain. Clicking "Reject" requires comments and returns request to "SentToEngineer" for engineering revision. When final approval completes, request status changes to "Completed".
result: skipped
reason: User requested skip

### 14. Manual Completion by Engineering
expected: When request status is "SendBackToRequester", engineering users see green "Mark Complete" button in request detail modal. Clicking shows confirmation dialog with optional "Completion Note" textarea. Clicking "Mark as Complete" changes request status to "Completed", logs activity with note (if provided), and notifies requester. Action is irreversible.
result: skipped
reason: User requested skip all remaining tests

### 15. Completed Status Display
expected: Requests in "Completed" status show green "Request Completed" banner in request detail modal. All action buttons (approve, reject, submit solution, etc.) are hidden. Request and solution details shown in read-only format. Activity log shows completion event with timestamp and user.
result: skipped
reason: User requested skip all remaining tests

### 16. Notification Bell Icon
expected: All authenticated users see bell icon in navbar with red badge showing count of unread notifications. Badge shows number (e.g., "3") or is hidden when count is 0. Bell icon is visible on all pages after login.
result: skipped
reason: User requested skip all remaining tests

### 17. Notification Dropdown List
expected: Clicking bell icon opens dropdown showing list of notifications. Each notification shows: Icon based on type (solution_ready, final_approval_needed, etc.), Title text, Time ago (e.g., "5 minutes ago"), Read/unread visual indicator (bold for unread). Dropdown has max-height with scroll. Clicking notification marks as read. Dropdown closes when clicking outside.
result: skipped
reason: User requested skip all remaining tests

### 18. In-App Notification Creation
expected: When solution is submitted, requester receives notification with type "solution_ready". When final approval is initiated, first approver in chain receives notification with type "final_approval_needed". Unread count increments immediately. Notifications appear in dropdown list sorted by newest first.
result: skipped
reason: User requested skip all remaining tests

### 19. Email Notifications (Optional)
expected: If RESEND_API_KEY and RESEND_FROM_EMAIL environment variables are set, email notifications are sent for: solution_ready (to requester when solution submitted), final_approval_needed (to first approver when final approval initiated). If variables not set, system logs warning but continues (graceful degradation). Emails contain link to request detail page.
result: skipped
reason: User requested skip all remaining tests

### 20. Rejection Loop Back
expected: When engineering solution is rejected during DesignCostEstimationApproval phase, request returns to "SentToEngineer" status. Engineering user can see rejection comments in activity log and submit revised solution. Previous solution is preserved in audit trail. When final approval is rejected, request returns to "SentToEngineer" status (not SendBackToRequester).
result: skipped
reason: User requested skip all remaining tests

### 21. Solution File Downloads
expected: Solution file attachments in request detail modal show filename with download icon/link. Clicking download opens or saves file using browser's default behavior. Files served from /uploads/[requestId]/[filename] path.
result: skipped
reason: User requested skip all remaining tests

### 22. Status Badge Display
expected: Request status badges show for all statuses including: "DesignCostEstimationApproval" (purple badge), "SendBackToRequester" (blue badge), "FinalApproval" (indigo badge), "Completed" (green badge). Badges visible in request lists, detail modal, dashboard tables.
result: skipped
reason: User requested skip all remaining tests

## Summary

total: 22
passed: 6
issues: 5
pending: 0
skipped: 11

## Gaps

<!-- YAML format for plan-phase --gaps consumption -->
- truth: "Engineering approvers see Approve and Reject buttons in request detail modal when status is DesignCostEstimationApproval"
  status: failed
  reason: "User reported: Status changed. Eng. Approver not see approve and reject botton."
  severity: major
  test: 6
  root_cause: "Custom approval chains allow selecting any user from any department, but canUserApproveSolution() function only checks custom chain approvals if user.role === 'engineering' (solutions.ts:503). Button rendering also requires userRole === 'engineering' (request-detail-modal.tsx:418). Non-engineering custom approvers can never see or use approval buttons."
  artifacts:
    - path: "src/server-actions/solutions.ts"
      issue: "canUserApproveSolution has role-gated check at line 503 preventing non-engineering users from being checked for custom approval eligibility"
      lines: [503-513]
    - path: "src/components/requests/request-detail-modal.tsx"
      issue: "Button rendering at line 418 requires engineering role even for custom approvers who may have different roles"
      lines: [418]
  missing:
    - "Remove role restriction for custom chain approvals while keeping it for hierarchy-based approvals"
    - "Update button rendering to check canApproveSolution without role filter for custom chains"
  debug_session: ".planning/debug/engineering-approver-buttons.md"
- truth: "Engineering users at top level can see solution submit button in request detail modal when status is SentToEngineer"
  status: failed
  reason: "User reported: engineering user who is at top level of hierarchy can't see solution submit botton in request"
  severity: major
  test: 7
  root_cause: "userRole was extracted directly from Clerk user object without state management. When modal opens before authentication completes, userRole remains stale/undefined. Button visibility condition {userRole === 'engineering'} fails because userRole doesn't update when user data loads after modal opens."
  artifacts:
    - path: "src/components/requests/request-detail-modal.tsx"
      issue: "userRole extracted directly from Clerk user object at line 66 without state management, useEffect dependencies don't track user changes"
      lines: [66]
  missing:
    - "Change userRole to useState with proper useEffect dependency tracking"
    - "Update userRole when user?.id or user?.publicMetadata?.role changes"
  debug_session: ".planning/debug/resolved/submit-button-visibility.md"
- truth: "Solution Approval Progress shows all steps with numbered badges and current approval highlighted with blue background"
  status: failed
  reason: "User reported: Not show step of Solution Approval Progress. only show current 1 pending and no blue background."
  severity: minor
  test: 8
  root_cause: "Solution Approval Progress section in request-detail-modal.tsx (lines 438-469) uses basic card styling without numbered badges or blue background highlighting. Missing proper visual hierarchy to display approval chain progression. Solution-detail.tsx has working implementation with numbered badges and blue highlighting that can be used as reference."
  artifacts:
    - path: "src/components/requests/request-detail-modal.tsx"
      issue: "Solution Approval Progress implementation uses basic cards without numbered badges or blue background"
      lines: [438-469]
    - path: "src/components/solutions/solution-detail.tsx"
      issue: "Has proper implementation with numbered badges and blue highlighting"
      lines: [158-257]
  missing:
    - "Replace Solution Approval Progress implementation with proper version from solution-detail.tsx"
    - "Add numbered badges with different colors for approval states"
    - "Add blue background (border-blue-300 bg-blue-50) for current pending approval"
  debug_session: ".planning/debug/solution-approval-progress.md"
- truth: "Engineering dashboard tabs work correctly and 'Review & Approve' opens request detail modal"
  status: failed
  reason: "User reported: see dashboard.'All Engineering Requests' clicked and 404 error. See list in Solutions Awaiting Your Approval but when clicked 'review&Approve' it redirect to main request page with link'http://localhost:3000/requests?open=cml7y7kn8000fqtzp246809l2'"
  severity: major
  test: 9
  root_cause: "Two distinct bugs: (1) 'All Engineering Requests' tab links to /engineering/requests but route file doesn't exist, (2) 'Review & Approve' button uses window.location.href causing full page navigation instead of opening modal. Correct pattern exists in request-table.tsx using useState and RequestDetailModal."
  artifacts:
    - path: "src/app/(dashboard)/engineering/page.tsx"
      issue: "Tab navigation at line 148 links to non-existent /engineering/requests route"
      lines: [148]
    - path: "src/components/engineering/needs-action-list.tsx"
      issue: "Review & Approve button uses window.location.href for navigation instead of opening modal"
      lines: [208-212]
    - path: "src/components/requests/request-table.tsx"
      issue: "Has correct modal pattern to follow"
      lines: [40-48, 162-168]
  missing:
    - "Create /engineering/requests route OR change tab to client-side filtering with ?tab=all URL param"
    - "Replace window.location.href with useState modal pattern following request-table.tsx implementation"
  debug_session: ".planning/debug/engineering-dashboard-404-redirect.md"
- truth: "Solution detail modal shows approval progress sections with minimal design and proper hierarchy steps"
  status: failed
  reason: "User reported: show all data. but 'Solution Approval Progress' and 'Approval Progress' and Activity History have to redesign for minimal. and 'Solution Approval Progress' still not show approve hierarchy step."
  severity: minor
  test: 11
  root_cause: "Modal contains three separate approval progress sections with different styling: Solution Approval Progress (lines 438-470), Final Approval Progress (lines 619-650), Regular Approval Progress (lines 696-707). Only regular approvals use ApprovalProgress component with proper hierarchy visualization. This inconsistency creates visual clutter and hierarchy steps aren't properly displayed."
  artifacts:
    - path: "src/components/requests/request-detail-modal.tsx"
      issue: "Contains redundant approval sections with inconsistent formatting (lines 438-470, 619-650, 696-707)"
      lines: [438-470, 619-650, 696-707]
    - path: "src/components/approvals/approval-progress.tsx"
      issue: "Has proper hierarchy visualization but used inconsistently"
  missing:
    - "Consolidate approval sections into single unified 'Approval Progress' section"
    - "Use ApprovalProgress component consistently for all approval types"
    - "Organize by workflow phase: Engineering Solution → Final Approval → Completion"
    - "Remove Activity History duplication (approval steps already shown in progress)"
  debug_session: ".planning/debug/solution-modal-minimalism.md"
