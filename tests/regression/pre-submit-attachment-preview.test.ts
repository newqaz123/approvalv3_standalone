import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const SUBMIT_SURFACES = [
  'src/components/requests/submitter-modal.tsx',
  'src/components/requests/request-resubmit-modal.tsx',
] as const

describe('pre-submit attachment preview', () => {
  it('exposes a shared hook that previews local files via object URLs and saved files via inline download URLs', () => {
    const source = read('src/hooks/use-attachment-preview.ts')
    assert.match(source, /export function useAttachmentPreview/)
    assert.match(source, /URL\.createObjectURL/)
    assert.match(source, /URL\.revokeObjectURL/)
    assert.match(source, /getFilePreviewUrl/)
    assert.match(source, /previewLocalFile/)
    assert.match(source, /previewSavedFile/)
  })

  for (const path of SUBMIT_SURFACES) {
    it(`${path} opens the same FilePreviewDialog used after submit`, () => {
      const source = read(path)
      assert.match(source, /from ['"]@\/hooks\/use-attachment-preview['"]/)
      assert.match(source, /from ['"]@\/components\/requests\/file-preview-dialog['"]/)
      assert.match(source, /<FilePreviewDialog/)
      assert.match(source, /previewLocalFile/)
      assert.match(source, /title="Preview"/)
    })
  }

  it('lets users click existing resubmit attachments and newly picked files', () => {
    const submitter = read('src/components/requests/submitter-modal.tsx')
    assert.match(submitter, /previewSavedFile\(file\)/)
    assert.match(submitter, /previewLocalFile\(item\.file\)/)

    const resubmit = read('src/components/requests/request-resubmit-modal.tsx')
    assert.match(resubmit, /previewSavedFile\(file\)/)
    assert.match(resubmit, /previewLocalFile\(file\)/)
  })
})
