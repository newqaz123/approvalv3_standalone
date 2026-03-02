---
phase: 024-fix-pdf-pipeline-overflow-duplicates
type: execute
wave: 1
depends_on: []
files_modified: [src/lib/pdf.ts]
autonomous: false
user_setup: []

must_haves:
  truths:
    - "Duplicate status badges and comments removed"
    - "Box width increased to prevent overflow"
    - "Layout works for both single and multi-approver workflows"
    - "Content properly contained within boxes"
  artifacts:
    - path: "src/lib/pdf.ts"
      provides: "Fixed pipeline HTML template without duplicates"
      contains: "single closing div for stage-small"
---

<objective>
Fix critical bugs in PDF pipeline visualization:
1. **Duplicate elements**: Status badges and comments rendering twice (inside AND outside boxes)
2. **Overflow**: Box width too narrow (140px) causing content to spill out
3. **Spacing**: Poor layout for single approver workflows

Purpose: Make PDF approval workflow clean and readable for any number of approvers.
Output: Clean, properly formatted pipeline without duplicates or overflow.
</objective>

<execution_context>
@~/.config/opencode/get-shit-done/workflows/execute-plan.md
@~/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/lib/pdf.ts (lines 548-595 contain the buggy template)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix duplicate rendering and overflow</name>
  <files>src/lib/pdf.ts</files>
  <action>
Fix the Approval Workflow section HTML template in renderRequestHTML function. Replace lines 541-596 with corrected version:

**Issues to fix:**
1. Lines 571-573 have duplicate `<div class="stage-status">` and `<div class="comment-box">` OUTSIDE the stage-small div
2. Box width (140px) too narrow - increase to 180px
3. Add word-wrap to prevent text overflow
4. Hide phase connector when only one phase

**Replace the entire Approval Workflow section (lines 541-596) with:**

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

Also update the CSS for .stage-small (lines 403-457) to increase width and add word-wrap:

```css
    .stage-small {
      flex-shrink: 0;
      width: 180px;
      padding: 10px;
      border-radius: 6px;
      border: 2px solid;
      background: white;
      font-size: 10px;
      box-sizing: border-box;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
```

Key changes:
1. Removed duplicate lines that were rendering status/comments outside the box
2. Increased width from 140px to 180px
3. Added box-sizing and word-wrap to prevent overflow
4. Simplified template logic
  </action>
  <verify>Template has single stage-small div with content inside, no duplicates</verify>
  <done>Duplicate rendering removed, box width increased</done>
</task>

<task type="auto">
  <name>Task 2: Optimize layout for single approver</name>
  <files>src/lib/pdf.ts</files>
  <action>
When there's only one approval total (single approver workflow), hide the phase header and connector to reduce clutter. Add conditional rendering:

Update the phase section rendering to check for single-phase single-approval:

```html
  <div class="section">
    <div class="section-title">Approval Workflow</div>
    <div class="approval-phases">
      ${data.approvalPhases.length === 1 && data.approvalPhases[0].approvals.length === 1 
        ? `
          <!-- Single approver - simplified layout -->
          <div class="phase-row" style="justify-content: flex-start;">
            <div class="stage-small ${data.approvalPhases[0].approvals[0].status}">
              <div class="stage-type">${escapeHtml(data.approvalPhases[0].approvals[0].stage)}</div>
              <div class="stage-header">${escapeHtml(data.approvalPhases[0].approvals[0].approverName)}</div>
              <div class="stage-info">
                Submitter: ${escapeHtml(data.requester.department)}
                <br>Level ${data.approvalPhases[0].approvals[0].requiredLevel}
                ${data.approvalPhases[0].approvals[0].approvedAt ? `<br>${formatDate(data.approvalPhases[0].approvals[0].approvedAt)}` : ''}
              </div>
              <div class="stage-status ${data.approvalPhases[0].approvals[0].status}">${data.approvalPhases[0].approvals[0].status}</div>
              ${data.approvalPhases[0].approvals[0].comments ? `<div class="comment-box">"${escapeHtml(data.approvalPhases[0].approvals[0].comments)}"</div>` : ''}
            </div>
          </div>
        `
        : `
          <!-- Multi-phase workflow -->
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
        `
      }
    </div>
  </div>
```

This provides a cleaner layout for simple single-approver workflows while maintaining the phase layout for complex ones.
  </action>
  <verify>Single approver shows simplified layout without phase headers</verify>
  <done>Optimized layout for both single and multi-approver workflows</done>
</task>

<task type="checkpoint:human-verify">
  <what-built>Fixed PDF pipeline with removed duplicates, increased box width, and optimized layouts</what-built>
  <how-to-verify>
1. Test with single approver workflow:
   - Click "Export PDF"
   - Verify:
     - [ ] Only ONE status badge (not two)
     - [ ] Only ONE comment box (if has comments)
     - [ ] No duplicate elements
     - [ ] Content fits inside box without overflow
     - [ ] No "Phase 1" header for single approver
     - [ ] Clean, simple layout

2. Test with multi-phase workflow (3+ approvers):
   - Click "Export PDF"
   - Verify:
     - [ ] Each box shows only ONE status badge
     - [ ] Comments appear only once inside each box
     - [ ] No floating duplicate elements
     - [ ] Content properly contained
     - [ ] Phase headers present
     - [ ] Phase connectors present

3. Test edge cases:
   - [ ] Long approver names don't overflow
   - [ ] Long comments wrap properly
   - [ ] Long department names don't break layout
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
PDF pipeline shows:
- No duplicate status badges or comments
- Content fits inside boxes (180px width + word-wrap)
- Clean layout for single approver (no phase headers)
- Full phase layout for multi-approver workflows
- Proper text wrapping for long content
</verification>

<success_criteria>
PDF approval workflow displays cleanly without duplicates, overflow, or layout issues.
</success_criteria>

<output>
After completion, create `.planning/quick/024-fix-pdf-pipeline-overflow-duplicates/024-01-SUMMARY.md`
</output>
