import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/server-actions/files.ts', 'utf8')
const requestUpload = source.slice(
  source.indexOf('export async function uploadFileAction'),
)

describe('image upload action optimization wiring', () => {
  it('uses the shared optimizer in request uploads', () => {
    assert.match(requestUpload, /optimizeImageAttachment/)
    assert.match(requestUpload, /writeAttachmentFile\(storedPath, prepared\.bytes\)/)
    assert.match(requestUpload, /fileSize:\s*prepared\.storedSize/)
  })

  it('returns a controlled image-processing error from the request action', () => {
    assert.equal((requestUpload.match(/Unable to process image/g) ?? []).length, 1)
  })

  it('keeps the existing private storage and compensation calls', () => {
    assert.match(requestUpload, /createStoredAttachmentPath/)
    assert.match(requestUpload, /deleteAttachmentFile/)
  })

  it('removed the solution draft upload with the staged XHR swap (Task 4)', () => {
    // Solution drafts now stage through /api/attachments/stage (scope:
    // 'solution'), so the draft-upload action and its optimization wiring are
    // gone from files.ts and must not resurface.
    assert.doesNotMatch(source, /uploadSolutionDraftAttachmentAction/)
  })
})
