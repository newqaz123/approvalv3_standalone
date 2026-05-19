import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getFilePreviewKind,
  getFilePreviewUrl,
  isPreviewableFile,
  normalizeStoredFilePath,
} from '../../src/lib/file-preview'

describe('file preview type detection', () => {
  it('detects supported preview types from MIME type and extension', () => {
    assert.equal(getFilePreviewKind({ fileName: 'drawing.pdf', fileType: 'application/pdf' }), 'pdf')
    assert.equal(getFilePreviewKind({ fileName: 'photo.PNG', fileType: '' }), 'image')
    assert.equal(getFilePreviewKind({ fileName: 'notes.txt', fileType: 'text/plain' }), 'text')
    assert.equal(getFilePreviewKind({ fileName: 'spec.docx', fileType: '' }), 'docx')
    assert.equal(getFilePreviewKind({ fileName: 'budget.xlsx', fileType: '' }), 'xlsx')
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

  it('builds API preview URLs from normalized stored file paths', () => {
    assert.equal(
      normalizeStoredFilePath('/public/uploads/request-1/spec sheet.pdf'),
      'uploads/request-1/spec sheet.pdf'
    )
    assert.equal(
      getFilePreviewUrl('/public/uploads/request-1/spec sheet.pdf'),
      '/api/files/download?path=uploads%2Frequest-1%2Fspec%20sheet.pdf&disposition=inline'
    )
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
