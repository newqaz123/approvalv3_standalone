import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { mergePdfBuffers, validateExportPackageRequestItems } from '../../src/lib/pdf-package'

async function makePdf(text: string, size: [number, number] = [240, 120]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage(size)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(text, { x: 20, y: 60, size: 18, font, color: rgb(0, 0, 0) })
  return Buffer.from(await doc.save())
}

describe('pdf package helpers', () => {
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
})
