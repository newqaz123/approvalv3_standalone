---
phase: quick-016
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/requests/request-detail-modal.tsx
  - src/lib/pdf.ts
autonomous: true
user_setup: []

must_haves:
  truths:
    - "All attachments grouped together by stage in one section"
    - "Attachments categorized: Initial Request, Engineering Solution, All Other"
    - "All approval sections grouped together (Improvement, Solution, Final)"
    - "PDF report mirrors the modal reorganization"
    - "SendbackToRequester/Complete status easier to read with grouped sections"
  artifacts:
    - path: "src/components/requests/request-detail-modal.tsx"
      provides: "Reorganized modal layout with grouped attachments and approvals"
      contains: "All attachments in single grouped section"
    - path: "src/lib/pdf.ts"
      provides: "PDF generation with matching layout"
      contains: "Grouped attachment sections"
  key_links:
    - from: "request-detail-modal.tsx"
      to: "pdf.ts"
      via: "Attachment grouping structure"
      pattern: "fileAttachments.*solution\\.fileAttachments"
---

<objective>
Rearrange data fields in request detail modal for better readability, especially for SendbackToRequester/Completed statuses.

Purpose: The current modal scatters attachments across multiple sections (Request Attachments, Solution Attachments), making it difficult to find all documents. Approval sections are also interspersed throughout the content. Grouping related information improves user experience.

Output: Reorganized modal with all attachments grouped by stage and all approval sections consolidated, matching changes in PDF export.
</objective>

<execution_context>
@./.cloning/get-shit-done/workflows/execute-plan.md
@./.cloning/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/components/requests/request-detail-modal.tsx
@src/lib/pdf.ts
</context>

<tasks>

<task type="auto">
  <name>Reorganize modal layout: group attachments and approvals</name>
  <files>src/components/requests/request-detail-modal.tsx</files>
  <action>
Reorganize the modal layout to improve readability:

**1. Create grouped "All Attachments" section** (replace scattered attachment displays):
- Position after Engineering Solution section, before approval sections
- Group 1: "Initial Request Attachments" (request.fileAttachments)
- Group 2: "Engineering Solution Attachments" (solution.fileAttachments)
- Each group shows count: e.g., "Initial Request Attachments (3)"
- Keep same file display format (name, size, uploader, date, download button)
- If a group is empty, don't display it

**2. Group all approval sections together** (in this order):
- Move "Engineering Solution Approval" section (if exists)
- Move "Regular Department Approval" section (if exists and no solution)
- Move "Final Department Approval" section (if exists)
- Keep all approval actions/buttons within their respective sections
- Place this grouped block AFTER the All Attachments section, before Activity Timeline

**3. Maintain existing conditional logic**:
- Keep all status-based display logic (SendBackToRequester, Completed, etc.)
- Keep approval action buttons in their correct sections
- Keep solution submission buttons for engineering users
- Keep final approval initiation for non-engineering users

**Key principle**: Only reorganize layout - don't change functionality or remove any information. The sections should appear in this order for Completed/SendBackToRequester status:
1. Description
2. Requester Info
3. Engineering Solution (if exists)
4. All Attachments (grouped by stage)
5. All Approvals (grouped by type)
6. Activity Timeline

Remove the individual attachment display sections that are currently scattered throughout the modal.
  </action>
  <verify>
  - Open a request with SendBackToRequester or Completed status
  - Verify "All Attachments" section appears with grouped sub-sections
  - Verify each attachment group shows count: "Initial Request Attachments (N)"
  - Verify all approval sections are grouped together
  - Verify no duplicate attachment displays exist
  - Test with requests in various statuses (ImprovementRequest, Completed, etc.)
  </verify>
  <done>
  All attachments displayed in single grouped section by stage, all approval sections consolidated together, no duplicate displays, layout order follows the specified structure.
  </done>
</task>

<task type="auto">
  <name>Update PDF layout to match modal reorganization</name>
  <files>src/lib/pdf.ts</files>
  <action>
Update the PDF generation to mirror the modal layout changes:

**1. Group attachments section** (in renderRequestHTML function):
- Replace separate "Request Attachments" and "Solution Attachments" sections
- Create single "All Attachments" section with subgroups:
  - Subsection: "Initial Request Attachments" (data.fileAttachments)
  - Subsection: "Engineering Solution Attachments" (data.solution.fileAttachments)
- Use similar styling as modal: bold headers, file lists with metadata
- Only show subsections that have attachments

**2. Group approval sections**:
- Keep all approval history in the "Approval History" timeline section (already grouped)
- Ensure the timeline shows: Improvement Request approvals → Solution approvals → Final approvals
- Maintain chronological order within the timeline

**3. Add visual separators**:
- Use section-title class for each attachment group
- Add extra spacing between attachment groups
- Ensure PDF layout matches modal structure

The PDF sections should appear in this order:
1. Request Information
2. Description
3. Engineering Solution (if exists)
4. All Attachments (grouped by stage)
5. Approval History (timeline with all approvals)
6. Activity Timeline
7. Footer
  </action>
  <verify>
  - Generate a PDF for a request with SendBackToRequester or Completed status
  - Verify PDF has "All Attachments" section with grouped sub-sections
  - Verify attachment groups match the modal display
  - Verify approval history shows all approval types in timeline
  - Compare PDF structure with modal structure - should match
  </verify>
  <done>
  PDF layout matches modal reorganization with grouped attachments and consolidated approval sections, all stages clearly labeled and ordered consistently.
  </done>
</task>

</tasks>

<verification>
Overall verification:
- [ ] Modal attachments grouped by stage with counts
- [ ] Modal approvals grouped together in correct order
- [ ] PDF layout mirrors modal changes
- [ ] No duplicate information displays
- [ ] All statuses (SendBackToRequester, Completed, etc.) display correctly
- [ ] Download buttons work for all attachment types
- [ ] Mobile layout (RequestDrawer) not affected by changes
</verification>

<success_criteria>
1. All attachments accessible from single grouped section in modal
2. Attachments categorized by stage (Initial Request, Engineering Solution)
3. All approval sections consolidated together
4. PDF export matches modal structure
5. Improved readability for SendBackToRequester/Completed statuses
6. No functionality lost, only layout improved
</success_criteria>

<output>
After completion, create `.planning/quick/016-rearrange-data-field-in-detail-modal/016-SUMMARY.md`
</output>
