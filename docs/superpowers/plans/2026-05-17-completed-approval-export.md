# Completed Approval Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a compact completed-approval evidence PDF and an export builder that lets users select, reorder, convert, and merge approval evidence plus attachments into one PDF package.

**Architecture:** Keep upload/storage/download behavior unchanged. Add pure package-item utilities for UI state, add server-side package validation/conversion/merge helpers, refactor the existing report export to generate a compact evidence PDF, and replace the completed-final modal's immediate export action with a focused builder modal.

**Tech Stack:** Next.js 15, React 19, TypeScript, Puppeteer HTML-to-PDF, `pdf-lib` for merging and image pages, existing `mammoth` for DOCX text extraction, existing `xlsx` for workbook parsing, existing `@dnd-kit` for drag reorder, Node `node:test` for focused regression tests.

---

### Task 1: Export Package Item Model

**Files:**
- Create: `src/lib/export-package.ts`
- Test: `tests/regression/export-package.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/regression/export-package.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDefaultExportPackageItems,
  getExportPackageFileKind,
  isMergeableExportFile,
  moveExportPackageItem,
} from '../../src/lib/export-package'

describe('completed approval export package utilities', () => {
  it('detects mergeable attachment kinds from MIME type and extension', () => {
    assert.equal(getExportPackageFileKind({ fileName: 'approval.pdf', fileType: 'application/pdf' }), 'pdf')
    assert.equal(getExportPackageFileKind({ fileName: 'photo.JPG', fileType: '' }), 'image')
    assert.equal(getExportPackageFileKind({ fileName: 'scope.docx', fileType: '' }), 'docx')
    assert.equal(getExportPackageFileKind({ fileName: 'budget.xlsx', fileType: '' }), 'xlsx')
    assert.equal(getExportPackageFileKind({ fileName: 'slides.pptx', fileType: '' }), 'unsupported')
    assert.equal(isMergeableExportFile({ fileName: 'budget.xlsx', fileType: '' }), true)
    assert.equal(isMergeableExportFile({ fileName: 'slides.pptx', fileType: '' }), false)
  })

  it('builds default package items with the approval report first and mergeable attachments selected', () => {
    const items = buildDefaultExportPackageItems({
      requestAttachments: [
        { id: 'r1', fileName: 'scope.pdf', fileType: 'application/pdf', fileSize: 100, filePath: 'uploads/r1/scope.pdf' },
        { id: 'r2', fileName: 'slides.pptx', fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', fileSize: 200, filePath: 'uploads/r1/slides.pptx' },
      ],
      solutionAttachments: [
        { id: 's1', fileName: 'photo.png', fileType: 'image/png', fileSize: 300, filePath: 'uploads/r1/photo.png' },
      ],
    })

    assert.deepEqual(
      items.map((item) => ({
        id: item.id,
        type: item.type,
        attachmentId: item.attachmentId,
        selected: item.selected,
        mergeable: item.mergeable,
        order: item.order,
      })),
      [
        { id: 'approval-report', type: 'approval-report', attachmentId: undefined, selected: true, mergeable: true, order: 0 },
        { id: 'request-r1', type: 'request-attachment', attachmentId: 'r1', selected: true, mergeable: true, order: 1 },
        { id: 'request-r2', type: 'request-attachment', attachmentId: 'r2', selected: false, mergeable: false, order: 2 },
        { id: 'solution-s1', type: 'solution-attachment', attachmentId: 's1', selected: true, mergeable: true, order: 3 },
      ]
    )
  })

  it('moves package items and rewrites contiguous order values', () => {
    const items = buildDefaultExportPackageItems({
      requestAttachments: [
        { id: 'r1', fileName: 'scope.pdf', fileType: 'application/pdf', fileSize: 100, filePath: 'uploads/r1/scope.pdf' },
      ],
      solutionAttachments: [
        { id: 's1', fileName: 'photo.png', fileType: 'image/png', fileSize: 300, filePath: 'uploads/r1/photo.png' },
      ],
    })

    const moved = moveExportPackageItem(items, 'solution-s1', 'approval-report')

    assert.deepEqual(
      moved.map((item) => ({ id: item.id, order: item.order })),
      [
        { id: 'solution-s1', order: 0 },
        { id: 'approval-report', order: 1 },
        { id: 'request-r1', order: 2 },
      ]
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/regression/export-package.test.ts`

Expected: FAIL with an import error because `src/lib/export-package.ts` does not exist.

- [ ] **Step 3: Implement the export package utility**

Create `src/lib/export-package.ts`:

```ts
export type ExportPackageItemType = 'approval-report' | 'request-attachment' | 'solution-attachment'
export type ExportPackageFileKind = 'approval-report' | 'pdf' | 'image' | 'docx' | 'xlsx' | 'unsupported'

export interface ExportPackageAttachment {
  id: string
  fileName: string
  fileType?: string | null
  fileSize?: number | null
  filePath?: string | null
  description?: string | null
}

export interface ExportPackageItem {
  id: string
  type: ExportPackageItemType
  attachmentId?: string
  sourceLabel: string
  fileName: string
  fileType?: string | null
  fileSize?: number | null
  filePath?: string | null
  description?: string | null
  kind: ExportPackageFileKind
  selected: boolean
  mergeable: boolean
  order: number
}

export interface BuildDefaultExportPackageItemsInput {
  requestAttachments: ExportPackageAttachment[]
  solutionAttachments: ExportPackageAttachment[]
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])

function getFileExtension(fileName: string): string {
  const normalizedName = fileName.trim().toLowerCase()
  const lastDotIndex = normalizedName.lastIndexOf('.')
  if (lastDotIndex < 0 || lastDotIndex === normalizedName.length - 1) return ''
  return normalizedName.slice(lastDotIndex + 1)
}

export function getExportPackageFileKind(file: Pick<ExportPackageAttachment, 'fileName' | 'fileType'>): ExportPackageFileKind {
  const fileType = file.fileType?.toLowerCase() ?? ''
  const extension = getFileExtension(file.fileName)

  if (fileType === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (fileType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || extension === 'docx') return 'docx'
  if (fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || extension === 'xlsx') return 'xlsx'
  return 'unsupported'
}

export function isMergeableExportFile(file: Pick<ExportPackageAttachment, 'fileName' | 'fileType'>): boolean {
  return getExportPackageFileKind(file) !== 'unsupported'
}

function buildAttachmentItem(
  type: Extract<ExportPackageItemType, 'request-attachment' | 'solution-attachment'>,
  sourceLabel: string,
  attachment: ExportPackageAttachment,
  order: number
): ExportPackageItem {
  const kind = getExportPackageFileKind(attachment)
  const mergeable = kind !== 'unsupported'

  return {
    id: `${type === 'request-attachment' ? 'request' : 'solution'}-${attachment.id}`,
    type,
    attachmentId: attachment.id,
    sourceLabel,
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    fileSize: attachment.fileSize,
    filePath: attachment.filePath,
    description: attachment.description,
    kind,
    selected: mergeable,
    mergeable,
    order,
  }
}

export function buildDefaultExportPackageItems(input: BuildDefaultExportPackageItemsInput): ExportPackageItem[] {
  const items: ExportPackageItem[] = [
    {
      id: 'approval-report',
      type: 'approval-report',
      sourceLabel: 'Approval Evidence',
      fileName: 'Approval Evidence Report',
      kind: 'approval-report',
      selected: true,
      mergeable: true,
      order: 0,
    },
  ]

  for (const attachment of input.requestAttachments) {
    items.push(buildAttachmentItem('request-attachment', 'Request Attachment', attachment, items.length))
  }

  for (const attachment of input.solutionAttachments) {
    items.push(buildAttachmentItem('solution-attachment', 'Solution Attachment', attachment, items.length))
  }

  return items
}

export function reorderExportPackageItems(items: ExportPackageItem[]): ExportPackageItem[] {
  return items.map((item, order) => ({ ...item, order }))
}

export function moveExportPackageItem(items: ExportPackageItem[], activeId: string, overId: string): ExportPackageItem[] {
  const fromIndex = items.findIndex((item) => item.id === activeId)
  const toIndex = items.findIndex((item) => item.id === overId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(fromIndex, 1)
  nextItems.splice(toIndex, 0, movedItem)
  return reorderExportPackageItems(nextItems)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/regression/export-package.test.ts`

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export-package.ts tests/regression/export-package.test.ts
git commit -m "feat: add export package item utilities"
```

### Task 2: PDF Package Merge And Conversion Helpers

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/pdf-package.ts`
- Test: `tests/regression/pdf-package.test.ts`

- [ ] **Step 1: Add PDF merge dependency**

Run: `npm install pdf-lib`

Expected: `package.json` and `package-lock.json` include `pdf-lib`.

- [ ] **Step 2: Write the failing tests**

Create `tests/regression/pdf-package.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { mergePdfBuffers, validateExportPackageRequestItems } from '../../src/lib/pdf-package'

async function makePdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([240, 120])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(text, { x: 20, y: 60, size: 18, font, color: rgb(0, 0, 0) })
  return Buffer.from(await doc.save())
}

describe('pdf package helpers', () => {
  it('merges pdf buffers in caller order', async () => {
    const first = await makePdf('first')
    const second = await makePdf('second')

    const merged = await mergePdfBuffers([second, first])
    const mergedDoc = await PDFDocument.load(merged)

    assert.equal(mergedDoc.getPageCount(), 2)
  })

  it('rejects request attachment IDs outside the exportable attachment set', () => {
    assert.throws(
      () =>
        validateExportPackageRequestItems(
          [
            { type: 'approval-report' },
            { type: 'request-attachment', attachmentId: 'allowed-request' },
            { type: 'solution-attachment', attachmentId: 'wrong-solution' },
          ],
          {
            requestAttachmentIds: new Set(['allowed-request']),
            solutionAttachmentIds: new Set(['allowed-solution']),
          }
        ),
      /wrong-solution/
    )
  })

  it('requires at least one selected package item', () => {
    assert.throws(
      () =>
        validateExportPackageRequestItems([], {
          requestAttachmentIds: new Set(['r1']),
          solutionAttachmentIds: new Set(['s1']),
        }),
      /at least one/
    )
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx --test tests/regression/pdf-package.test.ts`

Expected: FAIL with an import error because `src/lib/pdf-package.ts` does not exist.

- [ ] **Step 4: Implement merge, validation, and conversion dispatcher**

Create `src/lib/pdf-package.ts`:

```ts
import { readFile } from 'fs/promises'
import { extname, join } from 'path'
import mammoth from 'mammoth'
import { PDFDocument } from 'pdf-lib'
import * as XLSX from 'xlsx'
import { generatePdfFromHTML } from '@/lib/pdf'
import { getExportPackageFileKind, type ExportPackageFileKind } from '@/lib/export-package'

export type ExportPackageRequestItem =
  | { type: 'approval-report'; attachmentId?: undefined }
  | { type: 'request-attachment'; attachmentId: string }
  | { type: 'solution-attachment'; attachmentId: string }

export interface ExportableAttachment {
  id: string
  fileName: string
  fileType: string
  filePath: string
}

export interface ExportPackageAttachmentSets {
  requestAttachmentIds: Set<string>
  solutionAttachmentIds: Set<string>
}

export interface ConvertAttachmentToPdfInput {
  attachment: ExportableAttachment
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function normalizeStoredPath(filePath: string): string {
  return filePath.trim().replace(/^\/+/, '').replace(/^public\/+/, '')
}

function resolvePublicFilePath(filePath: string): string {
  const normalizedPath = normalizeStoredPath(filePath)
  if (!normalizedPath || normalizedPath.includes('..')) {
    throw new Error(`Invalid file path: ${filePath}`)
  }
  return join(process.cwd(), 'public', normalizedPath)
}

export function validateExportPackageRequestItems(
  items: ExportPackageRequestItem[],
  attachmentSets: ExportPackageAttachmentSets
): void {
  if (items.length === 0) {
    throw new Error('Select at least one package item before exporting.')
  }

  for (const item of items) {
    if (item.type === 'approval-report') continue

    if (item.type === 'request-attachment' && !attachmentSets.requestAttachmentIds.has(item.attachmentId)) {
      throw new Error(`Request attachment ${item.attachmentId} does not belong to this request.`)
    }

    if (item.type === 'solution-attachment' && !attachmentSets.solutionAttachmentIds.has(item.attachmentId)) {
      throw new Error(`Solution attachment ${item.attachmentId} does not belong to this request.`)
    }
  }
}

export async function mergePdfBuffers(pdfBuffers: Buffer[]): Promise<Buffer> {
  if (pdfBuffers.length === 0) {
    throw new Error('Cannot merge an empty PDF package.')
  }

  const mergedPdf = await PDFDocument.create()

  for (const pdfBuffer of pdfBuffers) {
    const sourcePdf = await PDFDocument.load(pdfBuffer)
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices())
    for (const page of copiedPages) mergedPdf.addPage(page)
  }

  return Buffer.from(await mergedPdf.save())
}

function renderAttachmentTextHTML(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; color: #1f2937; font-size: 12px; line-height: 1.5; padding: 24px; }
    h1 { font-size: 18px; margin: 0 0 16px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid #e5e7eb; padding: 12px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 18px; font-size: 10px; }
    th, td { border: 1px solid #d1d5db; padding: 4px 6px; vertical-align: top; }
    th { background: #f3f4f6; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`
}

async function convertDocxToPdf(filePath: string, fileName: string): Promise<Buffer> {
  const arrayBuffer = await readFile(filePath)
  const result = await mammoth.extractRawText({ buffer: arrayBuffer })
  const text = result.value.trim() || 'No text content found.'
  return generatePdfFromHTML(renderAttachmentTextHTML(fileName, `<pre>${escapeHtml(text)}</pre>`))
}

async function convertXlsxToPdf(filePath: string, fileName: string): Promise<Buffer> {
  const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' })
  const sections = workbook.SheetNames.map((sheetName) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, blankrows: false })
    const tableRows = rows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell ?? ''))}</td>`).join('')}</tr>`)
      .join('')
    return `<h2>${escapeHtml(sheetName)}</h2><table><tbody>${tableRows || '<tr><td>This sheet is empty.</td></tr>'}</tbody></table>`
  }).join('')

  return generatePdfFromHTML(renderAttachmentTextHTML(fileName, sections || '<p>No spreadsheet data found.</p>'))
}

async function convertImageToPdf(filePath: string): Promise<Buffer> {
  const imageBytes = await readFile(filePath)
  const extension = extname(filePath).toLowerCase()
  const doc = await PDFDocument.create()
  const image = extension === '.png' ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes)
  const page = doc.addPage([595.28, 841.89])
  const pageWidth = page.getWidth()
  const pageHeight = page.getHeight()
  const maxWidth = pageWidth - 56
  const maxHeight = pageHeight - 56
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1)
  const width = image.width * scale
  const height = image.height * scale
  page.drawImage(image, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  })
  return Buffer.from(await doc.save())
}

export async function convertAttachmentToPdf({ attachment }: ConvertAttachmentToPdfInput): Promise<Buffer> {
  const kind: ExportPackageFileKind = getExportPackageFileKind(attachment)
  if (kind === 'unsupported' || kind === 'approval-report') {
    throw new Error(`${attachment.fileName} is not mergeable.`)
  }

  const fullPath = resolvePublicFilePath(attachment.filePath)
  if (kind === 'pdf') return readFile(fullPath)
  if (kind === 'image') return convertImageToPdf(fullPath)
  if (kind === 'docx') return convertDocxToPdf(fullPath, attachment.fileName)
  if (kind === 'xlsx') return convertXlsxToPdf(fullPath, attachment.fileName)
  throw new Error(`${attachment.fileName} is not mergeable.`)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx --test tests/regression/pdf-package.test.ts`

Expected: PASS with 3 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/pdf-package.ts tests/regression/pdf-package.test.ts
git commit -m "feat: add pdf package merge helpers"
```

### Task 3: Compact Evidence PDF Generator

**Files:**
- Modify: `src/lib/pdf.ts`
- Modify: `src/server-actions/reports.ts`
- Test: `tests/regression/pdf-rendering.test.ts`

- [ ] **Step 1: Write the failing rendering test**

Create `tests/regression/pdf-rendering.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderRequestEvidenceHTML, type RequestPDFData } from '../../src/lib/pdf'

const sampleData: RequestPDFData = {
  id: 'REQ-1',
  referenceId: 'REF-001',
  title: 'Cooling Tower Motor Replacement',
  description: 'Replace damaged motor and verify alignment.',
  requester: {
    name: 'Narin P.',
    email: 'narin@example.com',
    department: 'Operations',
  },
  department: 'Operations',
  status: 'Completed',
  createdAt: new Date('2026-05-01T08:00:00Z'),
  completedAt: new Date('2026-05-10T08:00:00Z'),
  solution: {
    title: 'Motor replacement',
    description: 'Use approved spare motor and test vibration.',
    costEstimate: 185000,
    currency: 'THB',
    timeline: '3 days',
    submittedBy: 'Engineer A',
    submittedAt: new Date('2026-05-03T08:00:00Z'),
    fileAttachments: [
      { fileName: 'calculation.pdf', fileSize: 1234, fileType: 'application/pdf', createdAt: new Date('2026-05-03T08:00:00Z') },
    ],
  },
  fileAttachments: [
    { fileName: 'scope.pdf', fileSize: 1234, fileType: 'application/pdf', createdAt: new Date('2026-05-01T08:00:00Z'), uploadedBy: 'Narin P.' },
  ],
  approvalPhases: [
    {
      phaseName: 'Phase 1: Initial Review',
      phaseOrder: 1,
      approvals: [
        {
          approverName: 'Manager A',
          approverDepartment: 'Operations',
          requiredLevel: 1,
          status: 'approved',
          comments: 'Approved.',
          approvedAt: new Date('2026-05-02T08:00:00Z'),
          order: 1,
          stage: 'Manager Review',
          isSolutionApproval: false,
        },
      ],
    },
  ],
  activities: [
    { action: 'approved', userName: 'Manager A', createdAt: new Date('2026-05-02T08:00:00Z'), comments: 'Approved.' },
  ],
  generatedBy: 'Admin User',
}

describe('compact approval evidence HTML', () => {
  it('renders compact packet sections and escapes unsafe content', () => {
    const html = renderRequestEvidenceHTML({
      ...sampleData,
      description: 'Safe <script>alert("x")</script>',
    })

    assert.match(html, /Approval Evidence Packet/)
    assert.match(html, /Decision Summary/)
    assert.match(html, /Attachment Index/)
    assert.match(html, /Approval Chain/)
    assert.match(html, /Activity Log/)
    assert.match(html, /REF-001/)
    assert.doesNotMatch(html, /<script>alert/)
    assert.match(html, /&lt;script&gt;alert/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/regression/pdf-rendering.test.ts`

Expected: FAIL because `renderRequestEvidenceHTML` is not exported.

- [ ] **Step 3: Export reusable HTML-to-PDF and compact evidence renderer**

Modify `src/lib/pdf.ts`:

```ts
export interface RequestPDFData {
  id?: string
  referenceId?: string
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

export async function generatePdfFromHTML(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '12mm', bottom: '12mm', left: '12mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

export async function generateRequestPDF(data: RequestPDFData): Promise<Buffer> {
  return generatePdfFromHTML(renderRequestEvidenceHTML(data))
}

export function renderRequestEvidenceHTML(data: RequestPDFData): string {
  const generatedAt = formatDate(new Date())
  const completedLabel = data.completedAt ? formatDate(data.completedAt) : 'Not completed'
  const attachmentCount = data.fileAttachments.length + (data.solution?.fileAttachments.length ?? 0)
  const approvalCount = data.approvalPhases.reduce((sum, phase) => sum + phase.approvals.length, 0)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 18px; font-family: Arial, sans-serif; color: #17231f; font-size: 11px; line-height: 1.38; background: #ffffff; }
    .hero { padding: 18px 20px; border-radius: 14px; background: #103f34; color: white; margin-bottom: 12px; }
    .kicker { font-size: 9px; letter-spacing: .16em; text-transform: uppercase; opacity: .78; }
    h1 { margin: 6px 0 4px; font-size: 22px; line-height: 1.1; }
    .hero-meta { font-size: 10px; opacity: .84; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
    .metric { border: 1px solid #dbe5e0; border-radius: 10px; padding: 9px; background: #f8fbf8; }
    .metric span { display: block; color: #63736d; font-size: 8px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 3px; }
    .metric strong { font-size: 11px; }
    .section { border: 1px solid #dbe5e0; border-radius: 12px; padding: 11px 12px; margin-bottom: 10px; page-break-inside: avoid; }
    .section h2 { margin: 0 0 8px; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #153f35; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .muted { color: #66736e; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { border-bottom: 1px solid #e7edea; padding: 5px 4px; text-align: left; vertical-align: top; }
    th { color: #52625c; font-size: 8px; letter-spacing: .08em; text-transform: uppercase; }
    .status { display: inline-block; border-radius: 999px; padding: 2px 7px; background: #dff5e8; color: #14643d; font-weight: 700; }
    .description { white-space: pre-wrap; background: #f8faf9; border-radius: 8px; padding: 8px; }
    .footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #8a9691; font-size: 9px; text-align: center; }
  </style>
</head>
<body>
  <div class="hero">
    <div class="kicker">Approval Evidence Packet</div>
    <h1>${escapeHtml(data.title)}</h1>
    <div class="hero-meta">Reference: ${escapeHtml(data.referenceId || data.id || '-')} • Generated ${generatedAt}</div>
  </div>
  <div class="metrics">
    <div class="metric"><span>Status</span><strong>${escapeHtml(data.status)}</strong></div>
    <div class="metric"><span>Requester</span><strong>${escapeHtml(data.requester.name)}</strong></div>
    <div class="metric"><span>Completed</span><strong>${completedLabel}</strong></div>
    <div class="metric"><span>Evidence</span><strong>${attachmentCount} files</strong></div>
  </div>
  <div class="section"><h2>Decision Summary</h2><div class="grid-2"><div><strong>Department</strong><br>${escapeHtml(data.department)}<br><br><strong>Requester Email</strong><br>${escapeHtml(data.requester.email)}</div><div><strong>Created</strong><br>${formatDate(data.createdAt)}<br><br><strong>Approval Steps</strong><br>${approvalCount}</div></div></div>
  ${data.solution ? `<div class="section"><h2>Engineering Solution</h2><div class="grid-2"><div><strong>${escapeHtml(data.solution.title)}</strong><div class="description">${escapeHtml(data.solution.description)}</div></div><div><strong>Approved Cost</strong><br>${new Intl.NumberFormat('th-TH', { style: 'currency', currency: data.solution.currency }).format(data.solution.costEstimate)}<br><br><strong>Submitted</strong><br>${escapeHtml(data.solution.submittedBy)} • ${formatDate(data.solution.submittedAt)}${data.solution.timeline ? `<br><br><strong>Timeline</strong><br>${escapeHtml(data.solution.timeline)}` : ''}</div></div>${data.solution.conceptDesign ? `<br><strong>Concept Design</strong><div class="description">${escapeHtml(data.solution.conceptDesign)}</div>` : ''}</div>` : ''}
  <div class="section"><h2>Original Request</h2><div class="description">${escapeHtml(data.description)}</div></div>
  <div class="section"><h2>Attachment Index</h2><table><thead><tr><th>Source</th><th>File</th><th>Type</th><th>Size</th><th>Date</th></tr></thead><tbody>${data.fileAttachments.map((file) => `<tr><td>Request</td><td>${escapeHtml(file.fileName)}</td><td>${escapeHtml(file.fileType)}</td><td>${formatFileSize(file.fileSize)}</td><td>${formatDate(file.createdAt)}</td></tr>`).join('')}${(data.solution?.fileAttachments ?? []).map((file) => `<tr><td>Solution</td><td>${escapeHtml(file.fileName)}</td><td>${escapeHtml(file.fileType)}</td><td>${formatFileSize(file.fileSize)}</td><td>${formatDate(file.createdAt)}</td></tr>`).join('')}</tbody></table></div>
  <div class="section"><h2>Approval Chain</h2>${data.approvalPhases.map((phase) => `<h3>${escapeHtml(phase.phaseName)}</h3><table><thead><tr><th>Stage</th><th>Approver</th><th>Department</th><th>Status</th><th>Approved</th><th>Comments</th></tr></thead><tbody>${phase.approvals.map((approval) => `<tr><td>${escapeHtml(approval.stage)}</td><td>${escapeHtml(approval.approverName)}</td><td>${escapeHtml(approval.approverDepartment || approval.approverRole || '-')}</td><td><span class="status">${escapeHtml(approval.status)}</span></td><td>${approval.approvedAt ? formatDate(approval.approvedAt) : '-'}</td><td>${escapeHtml(approval.comments || '-')}</td></tr>`).join('')}</tbody></table>`).join('')}</div>
  <div class="section"><h2>Activity Log</h2><table><thead><tr><th>Action</th><th>User</th><th>Date</th><th>Comments</th></tr></thead><tbody>${data.activities.map((activity) => `<tr><td>${escapeHtml(activity.action)}</td><td>${escapeHtml(activity.userName)}</td><td>${formatDate(activity.createdAt)}</td><td>${escapeHtml(activity.comments || '-')}</td></tr>`).join('')}</tbody></table></div>
  <div class="footer">Generated on ${generatedAt} by ${escapeHtml(data.generatedBy)} from Approval System</div>
</body>
</html>`
}
```

Move the current private helpers `formatDate`, `formatFileSize`, and `escapeHtml` above the exported renderer and reuse them. Delete the old private `renderRequestHTML` after `renderRequestEvidenceHTML` fully replaces it.

- [ ] **Step 4: Add request IDs to PDF data mapping**

Modify `src/server-actions/reports.ts` inside the `pdfData` object:

```ts
const pdfData: RequestPDFData = {
  id: request.id,
  referenceId: request.id,
  title: request.title,
  description: request.description,
  // keep the existing mapping below this point
}
```

Use `request.id` for `referenceId`; this codebase does not expose a separate human-readable reference field in the current export query.

- [ ] **Step 5: Run the rendering test**

Run: `npx tsx --test tests/regression/pdf-rendering.test.ts`

Expected: PASS.

- [ ] **Step 6: Run existing PDF export smoke check through TypeScript build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pdf.ts src/server-actions/reports.ts tests/regression/pdf-rendering.test.ts
git commit -m "feat: redesign approval evidence pdf"
```

### Task 4: Server Action For Ordered Package Export

**Files:**
- Modify: `src/server-actions/reports.ts`
- Modify: `tests/regression/pdf-package.test.ts`

- [ ] **Step 1: Extend package tests for request item shape compatibility**

Append this test to `tests/regression/pdf-package.test.ts`:

```ts
it('accepts approval report and valid attachment IDs in mixed package order', () => {
  assert.doesNotThrow(() =>
    validateExportPackageRequestItems(
      [
        { type: 'request-attachment', attachmentId: 'r1' },
        { type: 'approval-report' },
        { type: 'solution-attachment', attachmentId: 's1' },
      ],
      {
        requestAttachmentIds: new Set(['r1']),
        solutionAttachmentIds: new Set(['s1']),
      }
    )
  )
})
```

- [ ] **Step 2: Run the package tests**

Run: `npx tsx --test tests/regression/pdf-package.test.ts`

Expected: PASS before server-action wiring because this validates the helper contract.

- [ ] **Step 3: Extract shared request PDF data builder**

Modify `src/server-actions/reports.ts`:

```ts
import {
  convertAttachmentToPdf,
  mergePdfBuffers,
  validateExportPackageRequestItems,
  type ExportPackageRequestItem,
  type ExportableAttachment,
} from '@/lib/pdf-package'
```

Extract the existing request query and `RequestPDFData` mapping from `exportRequestAsPDF` into:

```ts
async function buildRequestPDFData(requestId: string, userId: string): Promise<{
  pdfData: RequestPDFData
  request: ExportableRequest
  generatedBy: string
}> {
  const request = await getExportableRequest(requestId)
  // Move the current status validation, approval validation, current-user lookup,
  // completedAt lookup, phase construction, and solution mapping here.
}
```

Add this helper and type immediately before `buildRequestPDFData`:

```ts
async function getExportableRequest(requestId: string) {
  return prisma.requests.findFirst({
    where: { id: requestId },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      department: { select: { id: true, name: true } },
      fileAttachments: {
        include: { uploadedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      activities: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
      approvals: {
        include: {
          approver: { select: { id: true, name: true, email: true, department: { select: { name: true } } } },
          requiredApprover: { select: { id: true, name: true, email: true, department: { select: { name: true } } } },
        },
        orderBy: [{ requiredLevel: 'asc' }, { order: 'asc' }],
      },
      solutions: {
        include: {
          submittedBy: { select: { id: true, name: true } },
          fileAttachments: {
            include: { uploadedBy: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          },
          approvals: {
            include: {
              approver: { select: { id: true, name: true, email: true, department: { select: { name: true } } } },
              requiredApprover: { select: { id: true, name: true, email: true, department: { select: { name: true } } } },
            },
            orderBy: [{ order: 'asc' }],
          },
        },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  })
}

type ExportableRequest = NonNullable<Awaited<ReturnType<typeof getExportableRequest>>>
```

Keep the same validation messages currently returned by `exportRequestAsPDF` by throwing `Error` instances with those messages inside `buildRequestPDFData` and catching them in the public server actions.

- [ ] **Step 4: Add ordered package export action**

Add to `src/server-actions/reports.ts`:

```ts
export async function exportRequestPackageAsPDF(requestId: string, items: ExportPackageRequestItem[]) {
  try {
    const { user: _authUser } = (await auth()) ?? {}
    const userId = _authUser?.id
    if (!userId) {
      return { success: false, error: 'Authentication required. Please log in to export PDFs.' }
    }

    if (checkRateLimit(userId)) {
      return {
        success: false,
        error: 'Rate limit exceeded. You can export up to 3 PDFs per minute. Please try again later.',
      }
    }

    const { pdfData, request } = await buildRequestPDFData(requestId, userId)

    const requestAttachments = new Map<string, ExportableAttachment>(
      request.fileAttachments.map((file) => [
        file.id,
        { id: file.id, fileName: file.fileName, fileType: file.fileType, filePath: file.filePath },
      ])
    )
    const solutionAttachments = new Map<string, ExportableAttachment>(
      (request.solutions[0]?.fileAttachments ?? []).map((file) => [
        file.id,
        { id: file.id, fileName: file.fileName, fileType: file.fileType, filePath: file.filePath },
      ])
    )

    validateExportPackageRequestItems(items, {
      requestAttachmentIds: new Set(requestAttachments.keys()),
      solutionAttachmentIds: new Set(solutionAttachments.keys()),
    })

    const pdfBuffers: Buffer[] = []
    for (const item of items) {
      if (item.type === 'approval-report') {
        pdfBuffers.push(await generateRequestPDF(pdfData))
        continue
      }

      const attachment = item.type === 'request-attachment'
        ? requestAttachments.get(item.attachmentId)
        : solutionAttachments.get(item.attachmentId)

      if (!attachment) {
        return { success: false, error: `Attachment ${item.attachmentId} was not found for this request.` }
      }

      try {
        pdfBuffers.push(await convertAttachmentToPdf({ attachment }))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Attachment conversion failed.'
        return { success: false, error: `Could not convert ${attachment.fileName}: ${message}` }
      }
    }

    const mergedPdf = await mergePdfBuffers(pdfBuffers)
    const sanitizedTopic = sanitizeForFilename(request.title)
    const dateStr = formatDateAsYYYYMMDD(request.createdAt)

    return {
      success: true,
      data: mergedPdf.toString('base64'),
      filename: `Approval_Package_${sanitizedTopic}_${dateStr}.pdf`,
      contentType: 'application/pdf',
    }
  } catch (error) {
    console.error('Error exporting request package as PDF:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred while generating the PDF package. Please try again.',
    }
  }
}
```

- [ ] **Step 5: Keep compatibility export**

Modify `exportRequestAsPDF(requestId)` to call the shared builder and generate only the compact approval evidence report. Preserve its existing return shape:

```ts
export async function exportRequestAsPDF(requestId: string) {
  // auth and rate limit remain
  const { pdfData, request } = await buildRequestPDFData(requestId, userId)
  const pdfBuffer = await generateRequestPDF(pdfData)
  // existing filename and base64 response remain
}
```

- [ ] **Step 6: Run package and rendering tests**

Run: `npx tsx --test tests/regression/pdf-package.test.ts tests/regression/pdf-rendering.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server-actions/reports.ts tests/regression/pdf-package.test.ts
git commit -m "feat: export ordered approval pdf packages"
```

### Task 5: Export Builder UI

**Files:**
- Create: `src/components/reports/completed-approval-export-builder.tsx`
- Modify: `src/components/requests/completed-final-modal.tsx`
- Modify: `src/components/requests/request-modal-router.tsx`
- Test: `tests/regression/export-builder-wiring.test.ts`

- [ ] **Step 1: Write wiring regression test**

Create `tests/regression/export-builder-wiring.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

describe('completed approval export builder wiring', () => {
  it('routes completed final export through the builder and package server action', () => {
    const completedFinalModal = readFileSync('src/components/requests/completed-final-modal.tsx', 'utf8')
    const router = readFileSync('src/components/requests/request-modal-router.tsx', 'utf8')
    const builder = readFileSync('src/components/reports/completed-approval-export-builder.tsx', 'utf8')

    assert.match(completedFinalModal, /onOpenExportBuilder/)
    assert.doesNotMatch(completedFinalModal, /onExport\?: \(\) => void/)
    assert.match(router, /CompletedApprovalExportBuilder/)
    assert.match(builder, /exportRequestPackageAsPDF/)
    assert.match(builder, /DndContext/)
    assert.match(builder, /buildDefaultExportPackageItems/)
  })
})
```

- [ ] **Step 2: Run the wiring test to verify it fails**

Run: `npx tsx --test tests/regression/export-builder-wiring.test.ts`

Expected: FAIL because the builder component does not exist.

- [ ] **Step 3: Create the builder component**

Create `src/components/reports/completed-approval-export-builder.tsx` as a client component with this public interface:

```ts
'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Download, Eye, GripVertical, Loader2, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  buildDefaultExportPackageItems,
  reorderExportPackageItems,
  type ExportPackageAttachment,
  type ExportPackageItem,
} from '@/lib/export-package'
import { exportRequestPackageAsPDF } from '@/server-actions/reports'

export interface CompletedApprovalExportBuilderProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  requestId: string
  requestTitle: string
  requestAttachments: ExportPackageAttachment[]
  solutionAttachments: ExportPackageAttachment[]
  onPreviewRequestFile?: (fileId: string) => void
  onPreviewSolutionFile?: (fileId: string) => void
  onDownloadRequestFile?: (fileId: string) => void
  onDownloadSolutionFile?: (fileId: string) => void
}
```

Implement these behaviors:

- Initialize `items` from `buildDefaultExportPackageItems` each time `open` becomes true.
- Show all items in one sortable package list.
- Let users toggle selected state only when `item.mergeable` is true.
- Keep non-mergeable items visible but unchecked/disabled with `Not mergeable`.
- Use `DndContext`, `SortableContext`, and `arrayMove` to reorder all items.
- On export, send selected items sorted by `order` to `exportRequestPackageAsPDF`.
- Decode base64 response into a PDF Blob and download it using the returned filename.
- Use `toast.success('PDF package exported successfully')` on success.
- Show server errors with `toast.error(result.error || 'Failed to export PDF package')`.

Use this conversion label helper inside the component:

```ts
function getConversionLabel(item: ExportPackageItem): string {
  if (item.kind === 'approval-report') return 'Generated PDF'
  if (item.kind === 'pdf') return 'Ready'
  if (item.kind === 'image') return 'Convert image'
  if (item.kind === 'docx') return 'Convert DOCX'
  if (item.kind === 'xlsx') return 'Convert XLSX'
  return 'Not mergeable'
}
```

- [ ] **Step 4: Change completed final modal prop**

Modify `src/components/requests/completed-final-modal.tsx`:

```ts
interface CompletedFinalModalProps {
  // existing props
  onOpenExportBuilder?: () => void
}
```

Replace footer button usage:

```tsx
<Button
  onClick={onOpenExportBuilder}
  className="bg-emerald-600 hover:bg-emerald-700 text-white"
>
  <Printer className="w-4 h-4 mr-1.5" />
  Export Report
</Button>
```

Remove `onExport` from props and destructuring.

- [ ] **Step 5: Wire builder in router**

Modify `src/components/requests/request-modal-router.tsx`:

```ts
import { CompletedApprovalExportBuilder } from '@/components/reports/completed-approval-export-builder'
```

Add state near the preview modal state:

```ts
const [exportBuilderOpen, setExportBuilderOpen] = useState(false)
```

In the completed-final modal case, replace the inline `onExport` implementation with:

```tsx
onOpenExportBuilder={() => setExportBuilderOpen(true)}
```

Render the builder once near the existing `FilePreviewDialog` render:

```tsx
<CompletedApprovalExportBuilder
  open={exportBuilderOpen}
  onOpenChange={setExportBuilderOpen}
  requestId={requestData.id}
  requestTitle={requestData.title}
  requestAttachments={requestData.fileAttachments ?? []}
  solutionAttachments={requestData.solutions?.[0]?.fileAttachments ?? []}
  onPreviewRequestFile={handlePreviewFile}
  onPreviewSolutionFile={handlePreviewSolutionFile}
  onDownloadRequestFile={handleDownloadFile}
  onDownloadSolutionFile={handleDownloadSolutionFile}
/>
```

- [ ] **Step 6: Run the wiring test**

Run: `npx tsx --test tests/regression/export-builder-wiring.test.ts`

Expected: PASS.

- [ ] **Step 7: Run TypeScript build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/reports/completed-approval-export-builder.tsx src/components/requests/completed-final-modal.tsx src/components/requests/request-modal-router.tsx tests/regression/export-builder-wiring.test.ts
git commit -m "feat: add completed approval export builder"
```

### Task 6: Final Verification And Graph Update

**Files:**
- Modify only if verification reveals issues.
- Update: `graphify-out/*`

- [ ] **Step 1: Run focused regression suite**

Run:

```bash
npx tsx --test tests/regression/file-preview.test.ts tests/regression/export-package.test.ts tests/regression/pdf-package.test.ts tests/regression/pdf-rendering.test.ts tests/regression/export-builder-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Manually verify completed approval export flow**

Run: `npm run dev`

Open a completed approval in the app and verify:

- `Export Report` opens the builder.
- Approval Evidence Report is selected by default.
- PDF, image, DOCX, and XLSX attachments show mergeable status.
- PPT/PPTX attachments show `Not mergeable`.
- Reordering changes visual package order.
- Export downloads one `.pdf` package.
- The compact evidence PDF appears in the selected position.

- [ ] **Step 4: Update graph**

Run: `graphify update .`

Expected: graph update completes and `graphify-out/GRAPH_REPORT.md` reflects the current commit.

- [ ] **Step 5: Commit graph update if files changed**

```bash
git add graphify-out
git commit -m "chore: update graph after completed approval export"
```

If `graphify update .` reports no changes, skip this commit.

- [ ] **Step 6: Check final status**

Run: `git status --short --branch`

Expected: only unrelated pre-existing workspace changes remain outside the committed feature files.
