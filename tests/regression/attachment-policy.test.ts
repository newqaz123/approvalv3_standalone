import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_FORM,
  sanitizeAttachmentFileName,
  validateAttachmentMetadata,
} from '../../src/lib/attachments/policy'

describe('attachment policy', () => {
  it('enforces the 10 MB and 10-file contract', () => {
    assert.equal(MAX_ATTACHMENT_BYTES, 10 * 1024 * 1024)
    assert.equal(MAX_ATTACHMENTS_PER_FORM, 10)
    assert.equal(validateAttachmentMetadata({ name: 'ok.pdf', type: 'application/pdf', size: MAX_ATTACHMENT_BYTES }), null)
    assert.match(validateAttachmentMetadata({ name: 'large.pdf', type: 'application/pdf', size: MAX_ATTACHMENT_BYTES + 1 })!, /10MB/)
  })

  it('keeps supported Office, image, WebP, and CAD names aligned', () => {
    assert.equal(validateAttachmentMetadata({ name: 'drawing.dwg', type: 'application/octet-stream', size: 100 }), null)
    assert.equal(validateAttachmentMetadata({ name: 'model.step', type: '', size: 100 }), null)
    assert.equal(validateAttachmentMetadata({ name: 'photo.webp', type: 'image/webp', size: 100 }), null)
    assert.match(validateAttachmentMetadata({ name: 'script.html', type: 'text/html', size: 100 })!, /not supported/)
  })

  it('sanitizes separators and control characters while preserving Thai text', () => {
    assert.equal(sanitizeAttachmentFileName('../../ต่อ Line 4%NaOH.pdf'), 'ต่อ Line 4%NaOH.pdf')
    assert.equal(sanitizeAttachmentFileName('bad\r\nname.pdf'), 'badname.pdf')
    assert.equal(sanitizeAttachmentFileName('..'), 'attachment')
  })
})
