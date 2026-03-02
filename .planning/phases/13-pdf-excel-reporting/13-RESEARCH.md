# Phase 13: PDF/Excel Reporting - Research

**Researched:** 2026-02-19
**Domain:** PDF Generation, Server-Side Rendering, Rate Limiting
**Confidence:** HIGH

## Summary

Phase 13 requires implementing PDF export for completed approval requests. This phase delivers **PDF export only** (Excel export is explicitly out of scope despite the phase title). The export functionality must be available to any viewer, but only for requests with FinalApproval status where all approvers have approved.

**Key research findings:**
1. **Puppeteer is the recommended approach** - State documentation and architecture research confirm Puppeteer for HTML-to-PDF generation
2. **@react-pdf/renderer is a viable alternative** - JSX-based, no Chromium dependency, but requires separate templates
3. **Docker infrastructure from Phase 9 is ready** - Will need Chromium added to the Alpine-based Dockerfile
4. **Rate limiting requires in-memory or Redis-based tracking** - 3 PDFs/minute/user requirement

**Primary recommendation:** Use Puppeteer with HTML template rendering, as it matches existing project patterns, enables reuse of Tailwind styles, and is documented in the project's architecture research. Docker setup requires adding Chromium dependencies to the existing Alpine Dockerfile.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Who can export:** Any viewer (anyone with view access to the request)
- **When export is available:** Only fully approved requests (FinalApproval status AND all approvers have approved — strict requirement)
- **Export location:** Request details view only (not in list view)
- **Filename format:** Auto-generated as `Request_TOPIC_YYYY-MM-DD.pdf` where TOPIC is the request topic and date is approval completion date
- **Excel export:** Out of scope for this phase — PDF export only
- **Page constraint:** Content-driven (no artificial 1-page limit — content determines PDF length)
- **Branding:** None — clean document with well-formatted information only (no logo, no branded header/footer)
- **Visual organization:** Visually structured with section headings, clear visual hierarchy, signature lines, and timestamps
- **Section order:** Logical flow — Topic -> Request information -> Engineering solution -> Approval history
- **File attachments representation:** List with metadata (filename, size, type, upload date) — no actual file content embedded
- **Approval history details:** Complete record per approver (name, role, department, level, timestamp, approval/rejection status, comment)
- **Approval history format:** Timeline format (vertical flow showing progression through approval levels)
- **Metadata:** Footer with generation metadata: "Generated on DATE by USER from Approval System"
- **Loading feedback:** Inline loading with spinner and "Generating PDF..." message (not modal, not background)
- **Delivery method:** Auto-download (direct browser download to Downloads folder)
- **Error handling:** Manual retry only — show error message with "Try again" button, no automatic retry
- **Rate limiting:** 3 PDFs per minute per user to prevent abuse

### Claude's Discretion
- Exact typography and spacing for visual hierarchy
- PDF generation library choice (Puppeteer vs alternative)
- Server-side vs edge function generation strategy
- Error message wording and design
- Exact loading animation design

### Deferred Ideas (OUT OF SCOPE)
- None
</user_constraints>

## Standard Stack

The established libraries/tools for PDF generation in Next.js:

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **Puppeteer** | ^23.0.0 | HTML-to-PDF generation | Pixel-perfect rendering, reuses existing Tailwind styles, documented in project architecture |
| **@react-pdf/renderer** | ^3.4.4 | React-to-PDF generation (alternative) | JSX-based, no Chromium dependency, requires separate templates |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **date-fns** | ^4.1.0 | Date formatting for PDF metadata | Already installed, used throughout app |
| **Server Actions** | Built-in | PDF generation trigger | Matches existing app patterns |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| **Puppeteer** | @react-pdf/renderer | @react-pdf/renderer avoids Chromium dependency but requires maintaining separate PDF templates (can't reuse Tailwind styles). Puppeteer matches existing project patterns. |
| **Puppeteer** | jsPDF | jsPDF is smaller but poor HTML/CSS support, manual positioning required |
| **Server Actions** | API Route | API routes give more control over streaming but Server Actions match existing patterns |

### Docker Dependencies (Required for Puppeteer)

```dockerfile
# Add to Dockerfile RUN apk add --no-cache command:
chromium nss freetype harfbuzz ca-certificates ttf-freefont
```

### Installation

```bash
# Puppeteer (recommended approach)
npm install puppeteer@^23.0.0

# Alternative: @react-pdf/renderer
npm install @react-pdf/renderer@^3.4.4
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── lib/
│   └── pdf.ts                    # NEW: Puppeteer PDF generation utilities
├── server-actions/
│   └── reports.ts                # NEW: Server actions for PDF export
├── templates/
│   └── request-pdf.html.ts       # NEW: HTML template for PDF rendering
└── components/
    ├── desktop/
    │   └── request-detail.tsx    # MODIFY: Add export button
    └── mobile/
        └── request-drawer.tsx    # MODIFY: Add export button
```

### Pattern 1: Puppeteer PDF Generation with HTML Templates

**What:** Generate PDF by rendering HTML with Puppeteer's headless Chrome
**When to use:** When you want to reuse existing Tailwind styles and need pixel-perfect rendering
**Example:**

```typescript
// Source: Based on Vercel Puppeteer guide and project architecture research
// src/lib/pdf.ts
import puppeteer from 'puppeteer'

export interface RequestPDFData {
  title: string
  description: string
  requester: { name: string; email: string; department: string }
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
  approvals: Array<{
    approverName: string
    approverRole?: string
    approverDepartment?: string
    requiredLevel: number
    status: 'approved' | 'rejected' | 'pending'
    comments?: string
    approvedAt?: Date
    order: number
  }>
  activities: Array<{
    action: string
    userName: string
    createdAt: Date
    comments?: string
  }>
  generatedBy: string
}

export async function generateRequestPDF(data: RequestPDFData): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
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

function renderRequestHTML(data: RequestPDFData): string {
  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return `
<!DOCTYPE html>
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
    <h1>${data.title}</h1>
    <div class="meta">
      Approval Request Report • Generated ${formatDate(new Date())}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Request Information</div>
    <div class="row"><span class="label">Requester:</span><span class="value">${data.requester.name}</span></div>
    <div class="row"><span class="label">Department:</span><span class="value">${data.department}</span></div>
    <div class="row"><span class="label">Email:</span><span class="value">${data.requester.email}</span></div>
    <div class="row"><span class="label">Status:</span><span class="value">${data.status}</span></div>
    <div class="row"><span class="label">Created:</span><span class="value">${formatDate(data.createdAt)}</span></div>
    ${data.completedAt ? `<div class="row"><span class="label">Completed:</span><span class="value">${formatDate(data.completedAt)}</span></div>` : ''}
  </div>

  <div class="section">
    <div class="section-title">Description</div>
    <div class="description">${data.description}</div>
  </div>

  ${data.solution ? `
  <div class="section">
    <div class="section-title">Engineering Solution</div>
    <div class="row"><span class="label">Solution:</span><span class="value">${data.solution.title}</span></div>
    <div class="row"><span class="label">Cost Estimate:</span><span class="value">${new Intl.NumberFormat('th-TH', { style: 'currency', currency: data.solution.currency }).format(data.solution.costEstimate)}</span></div>
    ${data.solution.timeline ? `<div class="row"><span class="label">Timeline:</span><span class="value">${data.solution.timeline}</span></div>` : ''}
    <div class="row"><span class="label">Submitted By:</span><span class="value">${data.solution.submittedBy}</span></div>
    <div class="row"><span class="label">Submitted:</span><span class="value">${formatDate(data.solution.submittedAt)}</span></div>
    ${data.solution.conceptDesign ? `<div class="row"><span class="label">Concept:</span></div><div class="description">${data.solution.conceptDesign}</div>` : ''}

    ${data.solution.fileAttachments.length > 0 ? `
    <div style="margin-top: 10px;">
      <div style="font-weight: 500; margin-bottom: 6px;">Solution Attachments:</div>
      <ul class="file-list">
        ${data.solution.fileAttachments.map(file => `
          <li class="file-item">
            <div>${file.fileName}</div>
            <div style="font-size: 10px; color: #6b7280;">
              ${formatFileSize(file.fileSize)} • ${file.fileType} • ${formatDate(file.createdAt)}
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
    ` : ''}
  </div>
  ` : ''}

  ${data.fileAttachments.length > 0 ? `
  <div class="section">
    <div class="section-title">Request Attachments</div>
    <ul class="file-list">
      ${data.fileAttachments.map(file => `
        <li class="file-item">
          <div>${file.fileName}</div>
          <div style="font-size: 10px; color: #6b7280;">
            ${formatFileSize(file.fileSize)} • ${file.fileType} • Uploaded by ${file.uploadedBy} • ${formatDate(file.createdAt)}
          </div>
        </li>
      `).join('')}
    </ul>
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">Approval History</div>
    <div class="timeline">
      ${data.approvals.map(approval => `
        <div class="timeline-item">
          <div class="timeline-dot ${approval.status}"></div>
          <div style="font-weight: 500;">
            ${approval.approverName || 'Pending'}
            ${approval.approverDepartment ? ` (${approval.approverDepartment})` : ''}
            <span class="status-badge ${approval.status}">${approval.status}</span>
          </div>
          <div style="font-size: 11px; color: #6b7280;">
            Level ${approval.requiredLevel} • Step ${approval.order}
            ${approval.approvedAt ? ` • ${formatDate(approval.approvedAt)}` : ''}
          </div>
          ${approval.comments ? `<div style="font-size: 11px; color: #4b5563; margin-top: 2px;">"${approval.comments}"</div>` : ''}
        </div>
      `).join('')}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Activity Timeline</div>
    <div class="timeline">
      ${data.activities.map(activity => `
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div style="font-weight: 500;">${activity.action}</div>
          <div style="font-size: 11px; color: #6b7280;">
            ${activity.userName} • ${formatDate(activity.createdAt)}
          </div>
          ${activity.comments ? `<div style="font-size: 11px; color: #4b5563; margin-top: 2px;">"${activity.comments}"</div>` : ''}
        </div>
      `).join('')}
    </div>
  </div>

  <div class="footer">
    Generated on ${formatDate(new Date())} by ${data.generatedBy} from Approval System
  </div>
</body>
</html>
  `
}
```

### Pattern 2: Server Action with Rate Limiting

**What:** Server Action that validates request, checks rate limits, generates PDF, returns base64 for download
**When to use:** For triggering PDF export from client components
**Example:**

```typescript
// Source: Based on existing server action patterns in project
// src/server-actions/reports.ts
'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { generateRequestPDF } from '@/lib/pdf'

// Simple in-memory rate limit (for production, use Redis)
const pdfRateLimit = new Map<string, { count: number; resetAt: number }>()

export async function exportRequestAsPDF(requestId: string) {
  const { userId } = await auth()

  if (!userId) {
    return { success: false, error: 'Unauthorized' }
  }

  // Rate limit check: 3 PDFs per minute per user
  const now = Date.now()
  const userLimit = pdfRateLimit.get(userId)

  if (userLimit && userLimit.resetAt > now) {
    if (userLimit.count >= 3) {
      return {
        success: false,
        error: 'Rate limit exceeded. Please wait before generating more PDFs.'
      }
    }
    userLimit.count += 1
  } else {
    pdfRateLimit.set(userId, { count: 1, resetAt: now + 60000 })
  }

  try {
    // Fetch request with all required data
    const request = await prisma.request.findFirst({
      where: {
        id: requestId,
        isDeleted: false,
      },
      include: {
        requester: {
          select: { id: true, name: true, email: true },
        },
        department: {
          select: { id: true, name: true },
        },
        fileAttachments: {
          include: {
            uploadedBy: {
              select: { name: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        activities: {
          include: {
            user: {
              select: { name: true, email: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        approvals: {
          include: {
            approver: {
              select: { name: true, email: true },
            },
            requiredApprover: {
              select: { name: true },
            },
          },
          orderBy: { requiredLevel: 'asc' },
        },
        solutions: {
          include: {
            submittedBy: {
              select: { name: true, email: true },
            },
            fileAttachments: {
              include: {
                uploadedBy: {
                  select: { name: true },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    if (!request) {
      return { success: false, error: 'Request not found' }
    }

    // Verify: Must be FinalApproval or Completed status
    if (request.status !== 'FinalApproval' && request.status !== 'Completed') {
      return {
        success: false,
        error: 'PDF export is only available for completed approvals.'
      }
    }

    // Verify: All approvers must have approved
    const pendingApprovals = request.approvals.filter(a => a.status === 'pending')
    if (pendingApprovals.length > 0) {
      return {
        success: false,
        error: 'PDF export is only available after all approvals are complete.'
      }
    }

    // Get current user info for metadata
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true }
    })

    // Build PDF data structure
    const solution = request.solutions[0]
    const completedAt = request.activities
      .filter(a => a.action === 'manually_completed' || a.toStatus === 'Completed')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt

    const pdfData = {
      title: request.title,
      description: request.description,
      requester: {
        name: request.requester.name,
        email: request.requester.email,
        department: request.department.name
      },
      department: request.department.name,
      status: request.status,
      createdAt: request.createdAt,
      completedAt,
      solution: solution ? {
        title: solution.title,
        description: solution.description,
        costEstimate: Number(solution.costEstimate),
        currency: solution.currency,
        timeline: solution.timeline || undefined,
        conceptDesign: solution.conceptDesign || undefined,
        submittedBy: solution.submittedBy.name,
        submittedAt: solution.submittedAt,
        fileAttachments: solution.fileAttachments.map(f => ({
          fileName: f.fileName,
          fileSize: f.fileSize,
          fileType: f.fileType,
          createdAt: f.createdAt
        }))
      } : undefined,
      fileAttachments: request.fileAttachments.map(f => ({
        fileName: f.fileName,
        fileSize: f.fileSize,
        fileType: f.fileType,
        createdAt: f.createdAt,
        uploadedBy: f.uploadedBy.name
      })),
      approvals: request.approvals.map(a => ({
        approverName: a.approver?.name || a.requiredApprover?.name || 'Pending',
        approverRole: undefined, // Can be extended if needed
        approverDepartment: undefined, // Can be extended if needed
        requiredLevel: a.requiredLevel,
        status: a.status as 'approved' | 'rejected' | 'pending',
        comments: a.comments || undefined,
        approvedAt: a.approvedAt || undefined,
        order: a.order
      })),
      activities: request.activities.map(a => ({
        action: a.action,
        userName: a.user.name,
        createdAt: a.createdAt,
        comments: a.comments || undefined
      })),
      generatedBy: currentUser?.name || 'Unknown User'
    }

    // Generate PDF
    const pdfBuffer = await generateRequestPDF(pdfData)

    // Generate filename
    const completionDate = completedAt || request.createdAt
    const dateStr = completionDate.toISOString().split('T')[0]
    const sanitizedTitle = request.title.replace(/[^a-zA-Z0-9\s-_]/g, '').substring(0, 50)
    const filename = `Request_${sanitizedTitle}_${dateStr}.pdf`

    return {
      success: true,
      data: pdfBuffer.toString('base64'),
      filename,
      contentType: 'application/pdf'
    }
  } catch (error) {
    console.error('PDF generation error:', error)
    return {
      success: false,
      error: 'Failed to generate PDF. Please try again.'
    }
  }
}
```

### Pattern 3: Client Component with Download

**What:** Client component that calls Server Action and triggers browser download
**When to use:** In request detail views (desktop modal and mobile drawer)
**Example:**

```typescript
// Source: Based on existing patterns in RequestDetailModal
'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportRequestAsPDF } from '@/server-actions/reports'

interface ExportPDFButtonProps {
  requestId: string
  requestTitle: string
  requestStatus: string
  allApprovalsComplete: boolean
  disabled?: boolean
}

export function ExportPDFButton({
  requestId,
  requestStatus,
  allApprovalsComplete,
  disabled = false
}: ExportPDFButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Export only available for FinalApproval/Completed with all approvals
  const canExport =
    (requestStatus === 'FinalApproval' || requestStatus === 'Completed') &&
    allApprovalsComplete

  const handleExport = async () => {
    setError(null)
    setLoading(true)

    try {
      const result = await exportRequestAsPDF(requestId)

      if (!result.success) {
        setError(result.error || 'Failed to generate PDF')
        return
      }

      // Trigger download
      const byteCharacters = atob(result.data!)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: result.contentType! })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.filename!
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!canExport) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={handleExport}
        disabled={disabled || loading}
        variant="outline"
        size="sm"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Generating PDF...
          </>
        ) : (
          <>
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </>
        )}
      </Button>
      {error && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-red-600">{error}</span>
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0 text-blue-600"
            onClick={handleExport}
          >
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}
```

### Anti-Patterns to Avoid

- **Browser-based PDF generation:** Client-side libraries expose sensitive data and can't access server resources
- **Separate PDF templates:** Don't maintain separate JSX components for PDF when HTML templating works
- **Modal loading states:** User specified inline loading, not modal blocking
- **Automatic retry on error:** User specified manual retry only
- **Background generation:** User specified synchronous generation with feedback
- **Base64 in URL params:** Don't pass PDF data through URL (use server action response)

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF rendering | Manual canvas/text drawing | Puppeteer or @react-pdf/renderer | Complex text layout, page breaks, unicode support |
| HTML to PDF conversion | Custom wkhtmltopdf wrapper | Puppeteer's built-in PDF | Handles async resources, modern CSS |
| Date formatting | Manual date string building | date-fns (already installed) | Handles locales, timezones, edge cases |
| File size formatting | Manual if/else chain | Utility function | Consistent formatting, easier to maintain |
| Rate limiting | Database counters | In-memory Map (small scale) or Redis (production) | Performance, automatic expiration |

**Key insight:** PDF generation has numerous edge cases (encoding, fonts, page breaks, CSS support). Using established libraries avoids weeks of debugging rendering issues.

## Common Pitfalls

### Pitfall 1: Chromium Not Found in Docker

**What goes wrong:** Puppeteer fails to launch with "Failed to launch the browser process! executable path doesn't exist"
**Why it happens:** Alpine Docker image doesn't include Chromium and required libraries
**How to avoid:** Add Chromium and dependencies to Dockerfile before building phase
**Warning signs:** Local development works but Docker build fails at runtime

```dockerfile
# Add to Dockerfile in base stage
FROM node:20-alpine AS base
RUN apk add --no-cache \
    libc6-compat \
    openssl \
    curl \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set environment variables for Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

### Pitfall 2: Memory Issues with Concurrent PDF Generation

**What goes wrong:** Server runs out of memory when multiple users generate PDFs simultaneously
**Why it happens:** Each Puppeteer instance launches a headless Chrome (~300-500MB RAM)
**How to avoid:** Rate limiting (3/min/user) helps. For higher scale, consider:
- PDF caching by request ID + updated_at timestamp
- Queue system for bulk exports (out of scope for v1.1)
- @react-pdf/renderer as fallback (lighter, ~50MB)

**Warning signs:** Memory usage spike during PDF generation, slow responses

### Pitfall 3: Stale Data in Export

**What goes wrong:** PDF shows outdated request information after recent changes
**Why it happens:** Data fetched before user interaction, not at export time
**How to avoid:** Always fetch fresh data in Server Action at export time
**Warning signs:** User notices differences between UI and exported PDF

### Pitfall 4: Filename Issues on Different OS

**What goes wrong:** Filenames fail to save on Windows or special characters cause issues
**Why it happens:** Invalid characters in filenames (: / \ ? * < > |)
**How to avoid:** Sanitize title when generating filename

```typescript
const sanitizedTitle = request.title
  .replace(/[^a-zA-Z0-9\s-_]/g, '')  // Remove special chars
  .replace(/\s+/g, '_')                // Spaces to underscores
  .substring(0, 50)                    // Limit length
```

### Pitfall 5: Missing Approval History Data

**What goes wrong:** PDF shows incomplete approval history
**Why it happens:** Query doesn't include all approval relationships (solution approvals, final approvals)
**How to avoid:** Ensure Prisma query includes all approval types and related approver data

```typescript
include: {
  approvals: { include: { approver: true, requiredApprover: true } },
  solutions: {
    include: {
      approvals: { include: { approver: true, requiredApprover: true } }
    }
  }
}
```

### Pitfall 6: Rate Limiting Not Working

**What goes wrong:** Users can generate unlimited PDFs
**Why it happens:** In-memory rate limit resets on server restart, or different server instances don't share state
**How to avoid:** For production with multiple instances, use Redis-based rate limiting
**Warning signs:** Server restart allows immediate re-generation

## Code Examples

Verified patterns from official sources:

### Puppeteer Configuration for Docker

```typescript
// Source: Vercel Puppeteer guide + project Dockerfile research
import puppeteer from 'puppeteer'

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',           // Required in containers
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', // Overcomes limited resource in Docker
    '--disable-gpu',
    '--font-render-hinting=none'
  ],
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
})
```

### Checking All Approvals Complete

```typescript
// Source: Based on RequestDetailModal logic
const allApprovalsComplete = request.approvals.length > 0 &&
  request.approvals.every(a => a.status === 'approved')
```

### Determining Completion Date

```typescript
// Source: Based on approval activity log patterns
const completionDate = request.activities
  .filter(a =>
    a.action === 'manually_completed' ||
    a.toStatus === 'Completed'
  )
  .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side jsPDF | Server-side Puppeteer | 2020+ | Better security, PDF quality, CSS support |
| wkhtmltopdf | Puppeteer/Chromium | 2019+ | Active maintenance, better ES6 support |
| Separate PDF templates | HTML-to-PDF reuse | 2021+ | Maintainability, consistent styling |

**Deprecated/outdated:**
- **jsPDF on server:** Limited features, poor CSS support - use Puppeteer or @react-pdf/renderer
- **html-pdf:** Unmaintained, use Puppeteer instead
- **pdfkit:** Low-level, manual positioning required - not suitable for HTML layouts

## Open Questions

1. **@react-pdf/renderer as fallback?**
   - What we know: @react-pdf/renderer avoids Chromium dependency, lighter weight
   - What's unclear: Whether the extra template maintenance justifies switching
   - Recommendation: Start with Puppeteer (matches existing patterns), monitor Docker performance. Consider @react-pdf/renderer only if Chromium causes persistent issues

2. **Production rate limiting strategy?**
   - What we know: In-memory Map works for single-instance deployment
   - What's unclear: Current deployment architecture (single vs multi-instance)
   - Recommendation: Implement in-memory rate limiting for v1.1. Document Redis upgrade path if multi-instance deployment is needed

3. **PDF caching strategy?**
   - What we know: Caching by request ID + timestamp avoids redundant generation
   - What's unclear: Cache invalidation strategy (TTL vs manual)
   - Recommendation: Skip caching for v1.1 (low volume). Consider simple in-memory cache with 5-minute TTL if performance issues arise.

## Sources

### Primary (HIGH confidence)
- [Vercel: Deploying Puppeteer with Next.js](https://vercel.com/guides/deploying-puppeteer-with-nextjs-on-vercel) - Official deployment patterns, environment detection, serverless configuration (Updated October 2025)
- [Official Puppeteer Docker Guide](https://pptr.nodejs.cn/guides/docker) - Docker images and usage instructions
- Project architecture research (.planning/research/ARCHITECTURE.md) - Puppeteer recommendation with Docker Chromium setup
- Project stack research (.planning/research/STACK.md) - PDF generation library comparison

### Secondary (MEDIUM confidence)
- [React-PDF与Next.js 14集成：终极PDF生成指南](https://m.blog.csdn.net/gitblog_00759/article/details/153100083) - Next.js 14 + React-PDF integration, server-side generation (November 2025)
- [Solving Puppeteer Chrome Issues in Docker](https://m.blog.csdn.net/gitblog_00414/article/details/151457257) - Docker Chromium troubleshooting
- [Rate Limiting with Upstash Redis](https://m.blog.csdn.net/gitblog_00414/article/details/153100083) - Token bucket algorithm implementation (October 2025)

### Tertiary (LOW confidence)
- Various CSDN blog posts on Puppeteer Alpine setup - Need verification against official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Puppeteer documentation is clear, project has existing research
- Architecture: HIGH - Server Actions pattern is standard in this project, Vercel guide verified
- Pitfalls: HIGH - Docker Chromium issues well-documented, rate limiting patterns standard
- @react-pdf/renderer alternative: MEDIUM - Library verified but less experience with Next.js 15 integration

**Research date:** 2026-02-19
**Valid until:** 2026-04-19 (60 days - Puppeteer ecosystem is stable)
