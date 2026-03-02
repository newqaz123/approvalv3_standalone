---
phase: 021-fix-horizontal-pipeline-department-stage
type: execute
wave: 1
depends_on: []
files_modified: [src/lib/pdf.ts, src/server-actions/reports.ts]
autonomous: false
user_setup: []

must_haves:
  truths:
    - "Submitter department visible in pipeline stage"
    - "Stage names shown in each box (e.g., Engineering Review, Department Approval, Final Approval)"
    - "Stage derived from approval type, level, and isFinalApproval flag"
  artifacts:
    - path: "src/lib/pdf.ts"
      provides: "Updated approvals interface with stage field"
      contains: "stage field in RequestPDFData.approvals"
    - path: "src/server-actions/reports.ts"
      provides: "Stage name logic for approvals"
      contains: "stage: getStageName(approval) function"
  key_links:
    - from: "RequestApproval model"
      to: "stage field in PDF"
      via: "isFinalApproval, requiredLevel, isCustomChain fields"
---

<objective>
Fix horizontal pipeline flow to show:
1. Submitter department in appropriate stage
2. Stage names in each box (e.g., "Initial Request", "Engineering Review", "Department Approval", "Final Approval")

Purpose: Make approval pipeline more informative by showing what type of approval each stage represents.
Output: Updated PDF rendering with stage names and submitter department visibility.
</objective>

<execution_context>
@~/.config/opencode/get-shit-done/workflows/execute-plan.md
@~/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/lib/pdf.ts
@src/server-actions/reports.ts
@prisma/schema.prisma (RequestApproval model)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add stage field to PDF data interface</name>
  <files>src/lib/pdf.ts</files>
  <action>
Update the RequestPDFData interface to include a 'stage' field in the approvals array:

```typescript
approvals: Array<{
  approverName: string
  approverRole?: string
  approverDepartment?: string
  requiredLevel: number
  status: 'approved' | 'rejected' | 'pending'
  comments?: string
  approvedAt?: Date
  order: number
  stage: string // NEW: Stage name (e.g., "Initial Request", "Engineering Review", "Final Approval")
}>
```

Add the stage field after line 56 in the interface definition.
  </action>
  <verify>Interface updated with stage field</verify>
  <done>RequestPDFData interface includes stage field in approvals</done>
</task>

<task type="auto">
  <name>Task 2: Implement stage name logic in reports</name>
  <files>src/server-actions/reports.ts</files>
  <action>
Add a function to determine stage name based on approval properties, then include it when building pdfData.

Add this helper function before the pdfData building (around line 270):

```typescript
    // Helper to determine stage name
    function getStageName(a: any, index: number, total: number): string {
      // First approval is always the submitter/initial stage
      if (index === 0) {
        return 'Initial Request'
      }
      
      // Check if it's an engineering solution approval
      if (request.solutions.length > 0 && a.isCustomChain) {
        return 'Engineering Review'
      }
      
      // Check if it's the final approval
      if (a.isFinalApproval) {
        return 'Final Approval'
      }
      
      // Regular department approvals
      const deptName = a.requiredApprover?.department?.name || request.department.name
      if (a.requiredLevel === 1) {
        return `${deptName} Review`
      }
      
      return `${deptName} Approval (Level ${a.requiredLevel})`
    }
```

Then update the approvals mapping (around line 275) to include the stage:

```typescript
      approvals: request.approvals.map((a, index, array) => {
        return {
          approverName: a.approver?.name || a.requiredApprover?.name || request.requester.name || 'Unknown',
          approverRole: a.requiredApprover?.department?.name,
          approverDepartment: a.approver?.department?.name || a.requiredApprover?.department?.name,
          requiredLevel: a.requiredLevel,
          status: a.status as 'approved' | 'rejected' | 'pending',
          comments: a.comments || undefined,
          approvedAt: a.approvedAt || undefined,
          order: a.order,
          stage: getStageName(a, index, array.length), // NEW
        }
      }),
```
  </action>
  <verify>Stage name logic implemented and included in pdfData</verify>
  <done>Stage names generated based on approval properties</done>
</task>

<task type="auto">
  <name>Task 3: Update PDF rendering to show stage and submitter dept</name>
  <files>src/lib/pdf.ts</files>
  <action>
Update the horizontal pipeline rendering to:
1. Show stage name prominently at the top of each box
2. Show submitter department for the first stage (Initial Request)

Replace the current stage rendering HTML (in the pipeline section) with:

```html
<div class="section">
  <div class="section-title">Approval History</div>
  <div class="pipeline">
    ${data.approvals.map((approval, index) => `
      <div class="stage ${approval.status}">
        <div class="stage-type">${escapeHtml(approval.stage)}</div>
        <div class="stage-header">
          ${escapeHtml(approval.approverName || 'Pending')}
        </div>
        <div class="stage-info">
          ${index === 0 
            ? `Submitter: ${escapeHtml(data.requester.department)}<br>` 
            : (approval.approverDepartment ? `${escapeHtml(approval.approverDepartment)}<br>` : '')
          }
          ${approval.approverRole && approval.approverRole !== approval.approverDepartment ? `Role: ${escapeHtml(approval.approverRole)}<br>` : ''}
          Level ${approval.requiredLevel}
          ${approval.approvedAt ? `<br>${formatDate(approval.approvedAt)}` : ''}
        </div>
        <div class="stage-status ${approval.status}">${approval.status}</div>
        ${approval.comments ? `<div class="comment-box">"${escapeHtml(approval.comments)}"</div>` : ''}
      </div>
      ${index < data.approvals.length - 1 ? `
        <div class="arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </div>
      ` : ''}
    `).join('')}
  </div>
</div>
```

Also add CSS for the new stage-type class (add after .stage-status CSS):

```css
.stage-type {
  font-size: 10px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid #e5e7eb;
}
```
  </action>
  <verify>Stage names visible, submitter department shown for first stage</verify>
  <done>Pipeline boxes show stage type, submitter dept, and approver details</done>
</task>

<task type="checkpoint:human-verify">
  <what-built>Updated horizontal pipeline with stage names and submitter department visibility</what-built>
  <how-to-verify>
1. Navigate to a request detail page with multiple approval stages
2. Click "Export PDF" button
3. Open generated PDF file
4. Scroll to Approval History section
5. Verify:
   - First stage shows "INITIAL REQUEST" as stage type
   - First stage shows submitter's department (e.g., "Submitter: Engineering")
   - Other stages show appropriate stage names:
     * "Engineering Review" for solution approvals
     * "Final Approval" for isFinalApproval stages
     * "{Department} Review/Approval" for regular approvals
   - Approver name shown below stage type
   - Department/role shown for approvers
   - Comments still appear in yellow callout boxes
   - All data visible and properly formatted
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
PDF Approval History pipeline shows:
- Stage type at top of each box (INITIAL REQUEST, Engineering Review, Final Approval, etc.)
- Submitter department visible in first stage
- Approver departments shown in subsequent stages
- All existing data (name, status, comments) preserved
</verification>

<success_criteria>
Horizontal pipeline flow displays stage names and submitter department as specified.
</success_criteria>

<output>
After completion, create `.planning/quick/021-fix-horizontal-pipeline-department-stage/021-01-SUMMARY.md`
</output>
