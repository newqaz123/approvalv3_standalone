import { readFile } from 'fs/promises'
import { extname, resolve, sep } from 'path'
import mammoth from 'mammoth'
import { PDFDocument } from 'pdf-lib'
import * as XLSX from 'xlsx'
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

  const publicRoot = resolve(process.cwd(), 'public')
  const resolvedPath = resolve(publicRoot, normalizedPath)
  if (resolvedPath !== publicRoot && !resolvedPath.startsWith(`${publicRoot}${sep}`)) {
    throw new Error(`Invalid file path: ${filePath}`)
  }

  return resolvedPath
}

async function generateAttachmentPdfFromHTML(html: string): Promise<Buffer> {
  const { generatePdfFromHTML } = await import('@/lib/pdf')
  return generatePdfFromHTML(html)
}

export function validateExportPackageRequestItems(
  items: ExportPackageRequestItem[],
  attachmentSets: ExportPackageAttachmentSets
): void {
  if (items.length === 0) {
    throw new Error('Select at least one package item before exporting.')
  }

  for (const item of items) {
    if (item.type === 'approval-report') {
      continue
    }

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
    for (const page of copiedPages) {
      mergedPdf.addPage(page)
    }
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
    h2 { font-size: 14px; margin: 18px 0 8px; }
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
  const buffer = await readFile(filePath)
  const result = await mammoth.extractRawText({ buffer })
  const text = result.value.trim() || 'No text content found.'

  return generateAttachmentPdfFromHTML(renderAttachmentTextHTML(fileName, `<pre>${escapeHtml(text)}</pre>`))
}

async function convertXlsxToPdf(filePath: string, fileName: string): Promise<Buffer> {
  const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' })
  const sections = workbook.SheetNames.map((sheetName) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
    })
    const tableRows = rows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell ?? ''))}</td>`).join('')}</tr>`)
      .join('')

    return `<h2>${escapeHtml(sheetName)}</h2><table><tbody>${tableRows || '<tr><td>This sheet is empty.</td></tr>'}</tbody></table>`
  }).join('')

  return generateAttachmentPdfFromHTML(renderAttachmentTextHTML(fileName, sections || '<p>No spreadsheet data found.</p>'))
}

function getImageMimeType(filePath: string): string {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.bmp') return 'image/bmp'
  return 'application/octet-stream'
}

async function convertImageToPdf(filePath: string): Promise<Buffer> {
  const imageBytes = await readFile(filePath)
  const extension = extname(filePath).toLowerCase()

  if (extension !== '.png' && extension !== '.jpg' && extension !== '.jpeg') {
    const mimeType = getImageMimeType(filePath)
    const imageDataUrl = `data:${mimeType};base64,${imageBytes.toString('base64')}`
    return generateAttachmentPdfFromHTML(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 56px; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    img { max-width: 100%; max-height: 100%; object-fit: contain; }
  </style>
</head>
<body>
  <img src="${imageDataUrl}" alt="Attachment image">
</body>
</html>`)
  }

  const doc = await PDFDocument.create()
  const image = extension === '.png'
    ? await doc.embedPng(imageBytes)
    : await doc.embedJpg(imageBytes)
  const page = doc.addPage([595.28, 841.89])
  const pageWidth = page.getWidth()
  const pageHeight = page.getHeight()
  const maxWidth = pageWidth - 112
  const maxHeight = pageHeight - 112
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

  if (kind === 'pdf') {
    return readFile(fullPath)
  }

  if (kind === 'image') {
    return convertImageToPdf(fullPath)
  }

  if (kind === 'docx') {
    return convertDocxToPdf(fullPath, attachment.fileName)
  }

  if (kind === 'xlsx') {
    return convertXlsxToPdf(fullPath, attachment.fileName)
  }

  throw new Error(`${attachment.fileName} is not mergeable.`)
}
