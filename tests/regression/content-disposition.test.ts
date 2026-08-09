import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildContentDisposition } from '../../src/lib/attachments/content-disposition'

describe('Content-Disposition', () => {
  it('uses ASCII fallback plus RFC 5987 for Thai filenames', () => {
    const value = buildContentDisposition('inline', 'ต่อ Line 4%NaOH TO GH Tank.pdf')
    assert.match(value, /^inline; filename="attachment\.pdf";/)
    assert.match(value, /filename\*=UTF-8''%E0%B8%95/)
    assert.doesNotThrow(() => new Headers({ 'Content-Disposition': value }))
  })

  it('removes header injection characters', () => {
    const value = buildContentDisposition('attachment', 'bad"\r\nX-Test: yes.pdf')
    assert.doesNotMatch(value, /[\r\n]/)
    assert.doesNotThrow(() => new Headers({ 'Content-Disposition': value }))
  })
})
