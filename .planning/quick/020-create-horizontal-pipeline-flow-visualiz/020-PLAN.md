---
phase: 020-create-horizontal-pipeline-flow-visualiz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [src/lib/pdf.ts]
autonomous: false
user_setup: []

must_haves:
  truths:
    - "Approval History displays as horizontal pipeline flow"
    - "Stages connected with left-to-right arrows"
    - "Status colors visible (green=approved, red=rejected, gray=pending)"
    - "Approver name and role shown in each box"
    - "Comments displayed as callout boxes below each stage"
  artifacts:
    - path: "src/lib/pdf.ts"
      provides: "Horizontal pipeline rendering for Approval History"
      contains: ".pipeline, .stage, .arrow, .comment-box CSS classes"
  key_links:
    - from: "Approval History section HTML"
      to: ".pipeline CSS classes"
      via: "class attributes"
      pattern: "class=\"pipeline\""
---

<objective>
Replace vertical timeline with horizontal pipeline flow visualization for Approval History in PDF export.

Purpose: Improve PDF readability with a visual flow that shows approval stages progressing left-to-right, making it easier to understand request status at a glance.
Output: Horizontal pipeline with connected stages, status colors, approver details, and comment callouts.
</objective>

<execution_context>
@~/.config/opencode/get-shit-done/workflows/execute-plan.md
@~/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/lib/pdf.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Design horizontal pipeline flow CSS classes</name>
  <files>src/lib/pdf.ts</files>
  <action>
Add horizontal pipeline CSS classes to the <style> section in renderRequestHTML function:

```css
.pipeline {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 0;
  overflow-x: auto;
  padding-bottom: 8px;
}
.stage {
  flex-shrink: 0;
  width: 160px;
  padding: 10px;
  border-radius: 6px;
  border: 2px solid;
  background: white;
  position: relative;
}
.stage.approved {
  border-color: #10b981;
  background: #ecfdf5;
}
.stage.rejected {
  border-color: #ef4444;
  background: #fef2f2;
}
.stage.pending {
  border-color: #9ca3af;
  background: #f9fafb;
}
.stage-header {
  font-weight: 600;
  font-size: 11px;
  margin-bottom: 4px;
  color: #374151;
}
.stage-info {
  font-size: 10px;
  color: #6b7280;
  line-height: 1.4;
}
.stage-status {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  margin-top: 4px;
}
.stage-status.approved {
  background: #10b981;
  color: white;
}
.stage-status.rejected {
  background: #ef4444;
  color: white;
}
.stage-status.pending {
  background: #9ca3af;
  color: white;
}
.arrow {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 40px;
  color: #9ca3af;
}
.arrow svg {
  width: 24px;
  height: 24px;
}
.comment-box {
  margin-top: 8px;
  padding: 6px;
  background: #fef3c7;
  border-left: 3px solid #f59e0b;
  border-radius: 3px;
  font-size: 9px;
  color: #92400e;
  font-style: italic;
}
```

Add this CSS block after the .timeline CSS rules (around line 263).
</action>
  <verify>CSS classes added to <style> section in src/lib/pdf.ts</verify>
  <done>Horizontal pipeline CSS classes defined and ready for use</done>
</task>

<task type="auto">
  <name>Task 2: Implement horizontal pipeline rendering for Approval History</name>
  <files>src/lib/pdf.ts</files>
  <action>
Replace the current Approval History section (lines 347-366) with horizontal pipeline rendering:

```html
<div class="section">
  <div class="section-title">Approval History</div>
  <div class="pipeline">
    ${data.approvals.map((approval, index) => `
      <div class="stage ${approval.status}">
        <div class="stage-header">
          ${escapeHtml(approval.approverName || 'Pending')}
          ${approval.approverRole ? `<span style="font-weight: 400; color: #6b7280;"> - ${escapeHtml(approval.approverRole)}</span>` : ''}
        </div>
        <div class="stage-info">
          ${approval.approverDepartment ? `${escapeHtml(approval.approverDepartment)}<br>` : ''}
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

This replaces the vertical timeline .timeline and .timeline-item structure with a horizontal .pipeline layout showing stages left-to-right with connecting arrows.
</action>
  <verify>
Generate test PDF and verify:
- Approval History shows horizontal boxes
- Arrows connect stages left-to-right
- Green boxes for approved, red for rejected, gray for pending
- Comments appear in yellow callout boxes below stages
</verify>
  <done>Approval History renders as horizontal pipeline flow with status colors, approver details, and comment callouts</done>
</task>

<task type="checkpoint:human-verify">
  <what-built>Horizontal pipeline flow visualization replacing vertical timeline in PDF Approval History</what-built>
  <how-to-verify>
1. Navigate to a request detail page (e.g., /requests/{id})
2. Click "Export PDF" button
3. Open generated PDF file
4. Scroll to Approval History section
5. Verify:
   - Stages display horizontally left-to-right
   - Green boxes for approved stages (#10b981)
   - Red boxes for rejected stages (#ef4444)
   - Gray boxes for pending stages (#9ca3af)
   - Arrows connect each stage to the next
   - Approver names visible in each box
   - Approver roles/departments shown if available
   - Approval timestamps displayed for completed stages
   - Comments appear in yellow callout boxes below relevant stages
   - Layout works with different numbers of approval stages (2, 3, 4, 5+)
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
Approval History section in PDF shows horizontal pipeline flow with:
- Left-to-right stage progression with arrows
- Color-coded status (green/red/gray)
- Approver name and role in each box
- Comments displayed in callout boxes
- Proper layout across varying numbers of stages
</verification>

<success_criteria>
PDF Approval History displays as horizontal pipeline visualization meeting all design requirements.
</success_criteria>

<output>
After completion, create `.planning/quick/020-create-horizontal-pipeline-flow-visualiz/020-01-SUMMARY.md`
</output>
