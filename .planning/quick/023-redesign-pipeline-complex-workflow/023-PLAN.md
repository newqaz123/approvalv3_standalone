---
phase: 023-redesign-pipeline-complex-workflow
type: execute
wave: 1
depends_on: []
files_modified: [src/lib/pdf.ts, src/server-actions/reports.ts]
autonomous: false
user_setup: []

must_haves:
  truths:
    - "Complex workflows with 9+ stages must be readable in PDF"
    - "Stages grouped by phase: Initial → Engineering → Final"
    - "Each phase shown in separate row/section"
    - "Visual hierarchy shows workflow progression"
  artifacts:
    - path: "src/lib/pdf.ts"
      provides: "Multi-phase pipeline layout for complex workflows"
      contains: ".phase-section, .phase-row, .phase-connector CSS"
    - path: "src/server-actions/reports.ts"
      provides: "Phase-aware approval grouping"
      contains: "groupByPhase function"
---

<objective>
Redesign PDF pipeline visualization to handle complex workflows with many approvers (e.g., 4 initial + 3 engineering + 2 final = 9 stages). 

Current single-row horizontal layout breaks with 9 stages. Need grouped phase layout showing:
- Phase 1: Initial Request Approvals (up to 4 approvers)
- Phase 2: Engineering Solution Approvals (3 approvers)  
- Phase 3: Final Department Approvals (2 approvers)

Purpose: Make complex approval workflows readable and understandable in PDF export.
Output: Multi-phase pipeline with grouped sections and phase connectors.
</objective>

<execution_context>
@~/.config/opencode/get-shit-done/workflows/execute-plan.md
@~/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/lib/pdf.ts
@src/server-actions/reports.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Group approvals by phase in reports</name>
  <files>src/server-actions/reports.ts</files>
  <action>
Update the approval merging logic to group approvals into phases. Replace the current merged approvals approach with phase-aware grouping:

```typescript
      // Group approvals by phase for better visualization
      approvals: (() => {
        const phases: Array<{
          phaseName: string
          phaseOrder: number
          approvals: Array<{
            approverName: string
            approverRole?: string
            approverDepartment?: string
            requiredLevel: number
            status: 'approved' | 'rejected' | 'pending'
            comments?: string
            approvedAt?: Date
            order: number
            stage: string
            isSolutionApproval: boolean
          }>
        }> = []

        // Phase 1: Initial Request Approvals (non-solution, non-final)
        const initialApprovals = request.approvals
          .filter(a => !a.isFinalApproval && !a.isCustomChain)
          .map((a, index) => ({
            approverName: a.approver?.name || a.requiredApprover?.name || request.requester.name || 'Unknown',
            approverRole: a.requiredApprover?.department?.name,
            approverDepartment: a.approver?.department?.name || a.requiredApprover?.department?.name,
            requiredLevel: a.requiredLevel,
            status: a.status as 'approved' | 'rejected' | 'pending',
            comments: a.comments || undefined,
            approvedAt: a.approvedAt || undefined,
            order: a.order,
            stage: index === 0 ? 'Initial Request' : `Department Review ${index}`,
            isSolutionApproval: false,
          }))

        if (initialApprovals.length > 0) {
          phases.push({
            phaseName: 'Phase 1: Initial Review',
            phaseOrder: 1,
            approvals: initialApprovals,
          })
        }

        // Phase 2: Engineering Solution Approvals
        if (request.solutions.length > 0 && request.solutions[0].approvals.length > 0) {
          const solution = request.solutions[0]
          const solutionApprovals = solution.approvals.map((a, index) => ({
            approverName: a.approver?.name || a.requiredApprover?.name || 'Engineering',
            approverRole: a.requiredApprover?.department?.name || 'Engineering',
            approverDepartment: a.approver?.department?.name || a.requiredApprover?.department?.name || 'Engineering',
            requiredLevel: a.requiredLevel || 1,
            status: a.status as 'approved' | 'rejected' | 'pending',
            comments: a.comments || undefined,
            approvedAt: a.approvedAt || undefined,
            order: a.order,
            stage: index === 0 ? 'Solution Review' : `Solution Approval ${index}`,
            isSolutionApproval: true,
          }))

          phases.push({
            phaseName: 'Phase 2: Engineering Solution',
            phaseOrder: 2,
            approvals: solutionApprovals,
          })
        }

        // Phase 3: Final Approvals
        const finalApprovals = request.approvals
          .filter(a => a.isFinalApproval)
          .map((a, index) => ({
            approverName: a.approver?.name || a.requiredApprover?.name || 'Pending',
            approverRole: a.requiredApprover?.department?.name,
            approverDepartment: a.approver?.department?.name || a.requiredApprover?.department?.name,
            requiredLevel: a.requiredLevel,
            status: a.status as 'approved' | 'rejected' | 'pending',
            comments: a.comments || undefined,
            approvedAt: a.approvedAt || undefined,
            order: a.order,
            stage: `Final Approval ${index + 1}`,
            isSolutionApproval: false,
          }))

        if (finalApprovals.length > 0) {
          phases.push({
            phaseName: 'Phase 3: Final Approval',
            phaseOrder: 3,
            approvals: finalApprovals,
          })
        }

        return phases
      })(),
```

This changes the approvals structure from a flat array to a grouped phases array, which will be rendered as separate rows in the PDF.
  </action>
  <verify>Approvals grouped into phases array with phaseName and approvals</verify>
  <done>Phase-aware approval grouping implemented</done>
</task>

<task type="auto">
  <name>Task 2: Update PDF interface for phases</name>
  <files>src/lib/pdf.ts</files>
  <action>
Update the RequestPDFData interface to support the new phased structure:

```typescript
export interface RequestPDFData {
  title: string
  description: string
  requester: {
    name: string
    email: string
    department: string
  }
  department: string
  status: string
  createdAt: Date
  completedAt?: Date
  solution?: {
    title: string
    description: string
    costEstimate: number
    currency: string
    timeline?: string
    conceptDesign?: string
    submittedBy: string
    submittedAt: Date
    fileAttachments: Array<{
      fileName: string
      fileSize: number
      fileType: string
      createdAt: Date
    }>
  }
  fileAttachments: Array<{
    fileName: string
    fileSize: number
    fileType: string
    createdAt: Date
    uploadedBy: string
  }>
  // Changed from flat array to phased structure
  approvalPhases: Array<{
    phaseName: string
    phaseOrder: number
    approvals: Array<{
      approverName: string
      approverRole?: string
      approverDepartment?: string
      requiredLevel: number
      status: 'approved' | 'rejected' | 'pending'
      comments?: string
      approvedAt?: Date
      order: number
      stage: string
      isSolutionApproval: boolean
    }>
  }>
  activities: Array<{
    action: string
    userName: string
    createdAt: Date
    comments?: string
  }>
  generatedBy: string
}
```

Rename `approvals` to `approvalPhases` to reflect the new structure.
  </action>
  <verify>Interface updated with approvalPhases array</verify>
  <done>PDF data interface supports phased approvals</done>
</task>

<task type="auto">
  <name>Task 3: Redesign PDF rendering for multi-phase layout</name>
  <files>src/lib/pdf.ts</files>
  <action>
Replace the single horizontal pipeline with a multi-phase layout. Add new CSS classes and update the HTML rendering:

**Add CSS classes (after existing .stage CSS):**

```css
    .approval-phases {
      margin: 12px 0;
    }
    .phase-section {
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    .phase-header {
      font-size: 12px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 10px;
      padding: 6px 10px;
      background: #f3f4f6;
      border-radius: 4px;
      border-left: 4px solid #3b82f6;
    }
    .phase-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      flex-wrap: wrap;
    }
    .phase-connector {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 10px 0;
      padding: 8px;
      background: #ecfdf5;
      border-radius: 4px;
      font-size: 11px;
      color: #065f46;
      font-weight: 500;
    }
    .phase-connector svg {
      width: 20px;
      height: 20px;
      margin-right: 8px;
    }
    .stage-small {
      flex-shrink: 0;
      width: 140px;
      padding: 8px;
      border-radius: 6px;
      border: 2px solid;
      background: white;
      font-size: 10px;
    }
    .stage-small.approved { border-color: #10b981; background: #ecfdf5; }
    .stage-small.rejected { border-color: #ef4444; background: #fef2f2; }
    .stage-small.pending { border-color: #9ca3af; background: #f9fafb; }
    .stage-small .stage-type {
      font-size: 9px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-bottom: 3px;
      padding-bottom: 3px;
      border-bottom: 1px solid #e5e7eb;
    }
    .stage-small .stage-header {
      font-weight: 600;
      font-size: 10px;
      margin-bottom: 2px;
      color: #374151;
    }
    .stage-small .stage-info {
      font-size: 9px;
      color: #6b7280;
      line-height: 1.3;
    }
    .stage-small .stage-status {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 8px;
      font-weight: 600;
      text-transform: uppercase;
      margin-top: 3px;
    }
    .stage-small .stage-status.approved { background: #10b981; color: white; }
    .stage-small .stage-status.rejected { background: #ef4444; color: white; }
    .stage-small .stage-status.pending { background: #9ca3af; color: white; }
    .stage-small .comment-box {
      margin-top: 4px;
      padding: 4px;
      background: #fef3c7;
      border-left: 2px solid #f59e0b;
      border-radius: 2px;
      font-size: 8px;
      color: #92400e;
      font-style: italic;
    }
```

**Replace the Approval History section HTML with:**

```html
  <div class="section">
    <div class="section-title">Approval Workflow</div>
    <div class="approval-phases">
      ${data.approvalPhases.map((phase, phaseIndex) => `
        <div class="phase-section">
          <div class="phase-header">${escapeHtml(phase.phaseName)}</div>
          <div class="phase-row">
            ${phase.approvals.map((approval, index) => `
              <div class="stage-small ${approval.status}">
                <div class="stage-type">${escapeHtml(approval.stage)}</div>
                <div class="stage-header">${escapeHtml(approval.approverName)}</div>
                <div class="stage-info">
                  ${phaseIndex === 0 && index === 0 
                    ? `Submitter: ${escapeHtml(data.requester.department)}` 
                    : (approval.approverDepartment || '')
                  }
                  ${approval.approverRole && approval.approverRole !== approval.approverDepartment ? `<br>Role: ${escapeHtml(approval.approverRole)}` : ''}
                  <br>Level ${approval.requiredLevel}
                  ${approval.approvedAt ? `<br>${formatDate(approval.approvedAt)}` : ''}
                </div>
                <div class="stage-status ${approval.status}">${approval.status}</div>
                ${approval.comments ? `<div class="comment-box">"${escapeHtml(approval.comments)}"</div>` : ''}
              </div>
              ${index < phase.approvals.length - 1 ? `
                <div class="arrow" style="height: 30px;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px;">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                  </svg>
                </div>
              ` : ''}
            `).join('')}
          </div>
        </div>
        ${phaseIndex < data.approvalPhases.length - 1 ? `
          <div class="phase-connector">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <polyline points="19 12 12 19 5 12"></polyline>
            </svg>
            Proceeds to next phase
          </div>
        ` : ''}
      `).join('')}
    </div>
  </div>
```

This creates a multi-phase layout where each phase is a separate section with its own row of approval boxes, connected by "Proceeds to next phase" indicators.
  </action>
  <verify>Multi-phase layout renders phases as separate sections with connectors</verify>
  <done>PDF shows complex workflows in readable multi-phase layout</done>
</task>

<task type="checkpoint:human-verify">
  <what-built>Multi-phase approval workflow visualization for complex multi-approver requests</what-built>
  <how-to-verify>
1. Find a request with complex workflow:
   - 3-4 initial department approvers
   - Engineering solution with 2-3 approvers
   - 1-2 final approvers
2. Click "Export PDF"
3. Verify the Approval Workflow section shows:
   - **Phase 1: Initial Review** section header
   - Row of 3-4 approval boxes for initial approvers
   - "Proceeds to next phase" connector with down arrow
   - **Phase 2: Engineering Solution** section header
   - Row of 2-3 approval boxes for engineering approvers
   - "Proceeds to next phase" connector
   - **Phase 3: Final Approval** section header
   - Row of final approval boxes
   - Submitter department shown in first box of Phase 1
   - All approver names, departments, and statuses visible
   - Comments in yellow boxes
   - Layout doesn't overflow or wrap awkwardly
   - Page breaks work correctly (no split phases)
4. Test with simpler workflow (no engineering) to ensure it still works
5. Test with single approver to ensure backward compatibility
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
PDF shows complex multi-phase workflows as:
- Phase sections with headers (Phase 1, 2, 3)
- Horizontal rows within each phase
- Vertical connectors between phases
- Compact boxes that fit on A4 page
- All 9+ stages readable and well-organized
</verification>

<success_criteria>
Complex workflows (4+3+2=9 stages) display clearly in PDF with phase grouping and proper visual hierarchy.
</success_criteria>

<output>
After completion, create `.planning/quick/023-redesign-pipeline-complex-workflow/023-01-SUMMARY.md`
</output>
