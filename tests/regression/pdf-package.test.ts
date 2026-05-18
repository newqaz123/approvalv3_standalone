import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { convertAttachmentToPdf, mergePdfBuffers, validateExportPackageRequestItems } from '../../src/lib/pdf-package'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

async function makePdf(text: string, size: [number, number] = [240, 120]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage(size)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(text, { x: 20, y: 60, size: 18, font, color: rgb(0, 0, 0) })
  return Buffer.from(await doc.save())
}

describe('pdf package helpers', () => {
  it('falls back to browser rendering when direct PNG embedding fails', async () => {
    const uploadDir = join(process.cwd(), 'public', 'uploads', 'test-pdf-package')
    const filePath = join(uploadDir, 'browser-renderable.png')
    mkdirSync(uploadDir, { recursive: true })
    writeFileSync(filePath, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>'))

    try {
      const converted = await convertAttachmentToPdf({
        attachment: {
          id: 'png-fallback',
          fileName: 'browser-renderable.png',
          fileType: 'image/png',
          filePath: 'uploads/test-pdf-package/browser-renderable.png',
        },
      })
      const pdf = await PDFDocument.load(converted)

      assert.ok(pdf.getPageCount() >= 1)
    } finally {
      rmSync(uploadDir, { recursive: true, force: true })
    }
  })

  it('merges pdf buffers in caller order', async () => {
    const first = await makePdf('first', [240, 120])
    const second = await makePdf('second', [360, 180])

    const merged = await mergePdfBuffers([second, first])
    const mergedDoc = await PDFDocument.load(merged)
    const firstMergedPage = mergedDoc.getPage(0)
    const secondMergedPage = mergedDoc.getPage(1)

    assert.equal(mergedDoc.getPageCount(), 2)
    assert.equal(firstMergedPage.getWidth(), 360)
    assert.equal(firstMergedPage.getHeight(), 180)
    assert.equal(secondMergedPage.getWidth(), 240)
    assert.equal(secondMergedPage.getHeight(), 120)
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
})
