/**
 * PDF Generation Library
 * 
 * Provides utilities for generating PDF documents from approval requests.
 * Uses Puppeteer with headless Chromium for HTML-to-PDF conversion.
 */

import puppeteer from 'puppeteer'

/**
 * Data structure for PDF generation
 */
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

/**
 * Generates a PDF document from request data
 * @param data - The request data to include in the PDF
 * @returns A Buffer containing the PDF document
 */
export async function generateRequestPDF(data: RequestPDFData): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  })

  try {
    const page = await browser.newPage()
    const html = renderRequestHTML(data)

    await page.setContent(html, { waitUntil: 'networkidle0' })

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '15mm', left: '15mm' }
    })

    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

/**
 * Formats a date for display in the PDF
 */
function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date))
}

/**
 * Formats file size in bytes to human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/**
 * Escapes HTML special characters to prevent injection attacks
 */
function escapeHtml(text: string): string {
  const div = typeof document !== 'undefined' 
    ? document.createElement('div')
    : null
  
  if (div) {
    div.textContent = text
    return div.innerHTML
  }
  
  // Server-side fallback
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Renders the HTML template for the PDF
 */
function renderRequestHTML(data: RequestPDFData): string {
  const generatedAt = formatDate(new Date())
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      color: #1f2937;
      margin: 0;
      padding: 20px;
    }
    .header {
      border-bottom: 2px solid #374151;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 8px 0;
      color: #111827;
    }
    .header .meta {
      font-size: 11px;
      color: #6b7280;
    }
    .section {
      margin-bottom: 20px;
    }
    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #e5e7eb;
    }
    .row {
      display: flex;
      margin-bottom: 6px;
    }
    .label {
      font-weight: 500;
      color: #4b5563;
      min-width: 120px;
    }
    .value {
      color: #1f2937;
    }
    .description {
      white-space: pre-wrap;
      background: #f9fafb;
      padding: 10px;
      border-radius: 4px;
      margin: 8px 0;
    }
    .file-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .file-item {
      padding: 6px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .file-item:last-child {
      border-bottom: none;
    }
    .timeline {
      position: relative;
      padding-left: 24px;
    }
    .timeline::before {
      content: '';
      position: absolute;
      left: 6px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #e5e7eb;
    }
    .timeline-item {
      position: relative;
      margin-bottom: 14px;
    }
    .timeline-dot {
      position: absolute;
      left: -20px;
      top: 2px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #3b82f6;
      border: 2px solid white;
    }
    .timeline-dot.approved { background: #10b981; }
    .timeline-dot.rejected { background: #ef4444; }
    .timeline-dot.pending { background: #9ca3af; }
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 500;
    }
    .status-badge.approved { background: #d1fae5; color: #065f46; }
    .status-badge.rejected { background: #fee2e2; color: #991b1b; }
    .status-badge.pending { background: #f3f4f6; color: #374151; }
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
    .footer {
      margin-top: 30px;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      font-size: 10px;
      color: #9ca3af;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(data.title)}</h1>
    <div class="meta">
      Approval Request Report • Generated ${generatedAt}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Request Information</div>
    <div class="row"><span class="label">Requester:</span><span class="value">${escapeHtml(data.requester.name)}</span></div>
    <div class="row"><span class="label">Department:</span><span class="value">${escapeHtml(data.department)}</span></div>
    <div class="row"><span class="label">Email:</span><span class="value">${escapeHtml(data.requester.email)}</span></div>
    <div class="row"><span class="label">Status:</span><span class="value">${escapeHtml(data.status)}</span></div>
    <div class="row"><span class="label">Created:</span><span class="value">${formatDate(data.createdAt)}</span></div>
    ${data.completedAt ? `<div class="row"><span class="label">Completed:</span><span class="value">${formatDate(data.completedAt)}</span></div>` : ''}
  </div>

  <div class="section">
    <div class="section-title">Description</div>
    <div class="description">${escapeHtml(data.description)}</div>
  </div>

  ${data.solution ? `
  <div class="section">
    <div class="section-title">Engineering Solution</div>
    <div class="row"><span class="label">Solution:</span><span class="value">${escapeHtml(data.solution.title)}</span></div>
    <div class="row"><span class="label">Cost Estimate:</span><span class="value">${new Intl.NumberFormat('th-TH', { style: 'currency', currency: data.solution.currency }).format(data.solution.costEstimate)}</span></div>
    ${data.solution.timeline ? `<div class="row"><span class="label">Timeline:</span><span class="value">${escapeHtml(data.solution.timeline)}</span></div>` : ''}
    <div class="row"><span class="label">Submitted By:</span><span class="value">${escapeHtml(data.solution.submittedBy)}</span></div>
    <div class="row"><span class="label">Submitted:</span><span class="value">${formatDate(data.solution.submittedAt)}</span></div>
    ${data.solution.conceptDesign ? `<div class="row"><span class="label">Concept:</span></div><div class="description">${escapeHtml(data.solution.conceptDesign)}</div>` : ''}
  </div>
  ` : ''}

  ${(data.fileAttachments.length > 0 || (data.solution && data.solution.fileAttachments.length > 0)) ? `
  <div class="section">
    <div class="section-title">All Attachments</div>

    ${data.fileAttachments.length > 0 ? `
    <div style="margin-bottom: 12px;">
      <div style="font-weight: 600; font-size: 13px; color: #374151; margin-bottom: 6px;">Initial Request Attachments (${data.fileAttachments.length})</div>
      <ul class="file-list">
        ${data.fileAttachments.map(file => `
          <li class="file-item">
            <div>${escapeHtml(file.fileName)}</div>
            <div style="font-size: 10px; color: #6b7280;">
              ${formatFileSize(file.fileSize)} • ${escapeHtml(file.fileType)} • Uploaded by ${escapeHtml(file.uploadedBy)} • ${formatDate(file.createdAt)}
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
    ` : ''}

    ${data.solution && data.solution.fileAttachments.length > 0 ? `
    <div>
      <div style="font-weight: 600; font-size: 13px; color: #374151; margin-bottom: 6px;">Engineering Solution Attachments (${data.solution.fileAttachments.length})</div>
      <ul class="file-list">
        ${data.solution.fileAttachments.map(file => `
          <li class="file-item">
            <div>${escapeHtml(file.fileName)}</div>
            <div style="font-size: 10px; color: #6b7280;">
              ${formatFileSize(file.fileSize)} • ${escapeHtml(file.fileType)} • ${formatDate(file.createdAt)}
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
    ` : ''}
  </div>
  ` : ''}

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

  <div class="section">
    <div class="section-title">Activity Timeline</div>
    <div class="timeline">
      ${data.activities.map(activity => `
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div style="font-weight: 500;">${escapeHtml(activity.action)}</div>
          <div style="font-size: 11px; color: #6b7280;">
            ${escapeHtml(activity.userName)} • ${formatDate(activity.createdAt)}
          </div>
          ${activity.comments ? `<div style="font-size: 11px; color: #4b5563; margin-top: 2px;">"${escapeHtml(activity.comments)}"</div>` : ''}
        </div>
      `).join('')}
    </div>
  </div>

  <div class="footer">
    Generated on ${generatedAt} by ${escapeHtml(data.generatedBy)} from Approval System
  </div>
</body>
</html>`
}
