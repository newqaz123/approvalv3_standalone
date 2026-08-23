import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getFileDownloadUrl,
  getFilePreviewKind,
  getFilePreviewTypeLabel,
  getFilePreviewUrl,
  isPreviewableFile,
} from '../../src/lib/file-preview'

describe('file preview type detection', () => {
  it('detects supported preview types from MIME type and extension', () => {
    assert.equal(getFilePreviewKind({ fileName: 'drawing.pdf', fileType: 'application/pdf' }), 'pdf')
    assert.equal(getFilePreviewKind({ fileName: 'photo.PNG', fileType: '' }), 'image')
    assert.equal(getFilePreviewKind({ fileName: 'notes.txt', fileType: 'text/plain' }), 'text')
    assert.equal(getFilePreviewKind({ fileName: 'spec.docx', fileType: '' }), 'docx')
    assert.equal(getFilePreviewKind({ fileName: 'budget.xlsx', fileType: '' }), 'xlsx')
  })

  it('shows a short human file type instead of a raw MIME string', () => {
    assert.equal(getFilePreviewTypeLabel({ fileName: 'drawing.pdf', fileType: 'application/pdf' }), 'PDF')
    assert.equal(getFilePreviewTypeLabel({ fileName: 'photo.PNG', fileType: '' }), 'Image')
    assert.equal(getFilePreviewTypeLabel({ fileName: 'notes.txt', fileType: 'text/plain' }), 'Text')
    assert.equal(getFilePreviewTypeLabel({ fileName: 'spec.docx', fileType: '' }), 'Word')
    assert.equal(getFilePreviewTypeLabel({ fileName: 'budget.xlsx', fileType: '' }), 'Excel')
    assert.equal(getFilePreviewTypeLabel({ fileName: 'slides.pptx', fileType: '' }), 'PPTX')
    assert.equal(getFilePreviewTypeLabel({ fileName: 'archive.zip', fileType: 'application/zip' }), 'ZIP')
    assert.equal(getFilePreviewTypeLabel({ fileName: 'untitled', fileType: '' }), 'File')
    assert.notEqual(
      getFilePreviewTypeLabel({ fileName: 'sheet.pdf', fileType: 'application/pdf' }),
      'application/pdf'
    )
  })

  it('routes pptx and unknown files to unsupported preview state', () => {
    assert.equal(
      getFilePreviewKind({
        fileName: 'slides.pptx',
        fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
      'unsupported'
    )
    assert.equal(getFilePreviewKind({ fileName: 'archive.zip', fileType: 'application/zip' }), 'unsupported')
    assert.equal(isPreviewableFile({ fileName: 'slides.pptx', fileType: '' }), false)
    assert.equal(isPreviewableFile({ fileName: 'manual.docx', fileType: '' }), true)
  })

  it('builds API preview URLs from attachment IDs', () => {
    const id = '11111111-1111-1111-1111-111111111111'
    assert.equal(getFilePreviewUrl(id), `/api/files/download?id=${id}&disposition=inline`)
    assert.equal(getFileDownloadUrl(id), `/api/files/download?id=${id}&disposition=attachment`)
    assert.equal(getFilePreviewUrl(null), null)
  })

  it('wires preview callbacks into the solution approval modal', () => {
    const router = readFileSync('src/components/requests/request-modal-router.tsx', 'utf8')
    const modalPaths = [
      'src/components/requests/solution-modal.tsx',
      'src/components/requests/completed-solution-modal.tsx',
      'src/components/requests/submit-final-approval-modal.tsx',
      'src/components/requests/completed-final-modal.tsx',
      'src/components/requests/final-approval-modal.tsx',
      'src/components/requests/approver-modal.tsx',
    ]

    for (const modalPath of modalPaths) {
      const source = readFileSync(modalPath, 'utf8')
      assert.match(source, /onPreview(?:Request)?File\?: \(fileId: string\) => void/, modalPath)
      assert.match(source, /onPreviewSolutionFile\?: \(fileId: string\) => void/, modalPath)
    }

    assert.equal((router.match(/onPreviewFile=\{handlePreviewFile\}/g) ?? []).length, 7)
    assert.equal((router.match(/onPreviewSolutionFile=\{handlePreviewSolutionFile\}/g) ?? []).length, 6)
  })

  it('serializes budget project estimate before request data reaches preview modals', () => {
    const source = readFileSync('src/server-actions/requests.ts', 'utf8')
    const getRequestBody = source.slice(
      source.indexOf('export async function getRequest'),
      source.indexOf('/**\n * Get filter options')
    )

    assert.match(getRequestBody, /projectEstimateCost/)
    assert.match(getRequestBody, /request\.projectEstimateCost = Number\(request\.projectEstimateCost\) as any/)
  })
})
