import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/server-actions/files.ts', 'utf8')
const requestUpload = source.slice(
  source.indexOf('export async function uploadFileAction'),
  source.indexOf('/**\n * A file_attachment row serialized'),
)
const draftUpload = source.slice(
  source.indexOf('export async function uploadSolutionDraftAttachmentAction'),
  source.indexOf('export type CleanupSolutionDraftAttachmentsResult'),
)

describe('image upload action optimization wiring', () => {
  it('uses the shared optimizer in request uploads', () => {
    assert.match(requestUpload, /optimizeImageAttachment/)
    assert.match(requestUpload, /writeAttachmentFile\(storedPath, prepared\.bytes\)/)
    assert.match(requestUpload, /fileSize:\s*prepared\.storedSize/)
  })

  it('uses the shared optimizer in solution draft uploads', () => {
    assert.match(draftUpload, /optimizeImageAttachment/)
    assert.match(draftUpload, /writeAttachmentFile\(storedPath, prepared\.bytes\)/)
    assert.match(draftUpload, /fileSize:\s*prepared\.storedSize/)
  })

  it('returns a controlled image-processing error from both actions', () => {
    assert.equal((requestUpload.match(/Unable to process image/g) ?? []).length, 1)
    assert.equal((draftUpload.match(/Unable to process image/g) ?? []).length, 1)
  })

  it('keeps the existing private storage and compensation calls', () => {
    assert.match(requestUpload, /createStoredAttachmentPath/)
    assert.match(requestUpload, /deleteAttachmentFile/)
    assert.match(draftUpload, /createStoredAttachmentPath/)
    assert.match(draftUpload, /deleteAttachmentFile/)
  })
})
