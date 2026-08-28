import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { descriptionSchema } from '@/lib/schemas/solution-schemas'

describe('descriptionSchema', () => {
  it('accepts rich HTML up to 20000 stored characters', () => {
    const html = '<p>' + 'a'.repeat(19990) + '</p>'
    assert.doesNotThrow(() => descriptionSchema.parse(html))
  })

  it('rejects visually-empty rich text', () => {
    assert.throws(() => descriptionSchema.parse('<p><br></p>'))
    assert.throws(() => descriptionSchema.parse('<p>   </p>'))
  })

  it('treats a valid inline image as content and invalid image-only HTML as empty', () => {
    assert.doesNotThrow(() => descriptionSchema.parse('<img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="Plan" data-align="center">'))
    assert.throws(() => descriptionSchema.parse('<img src="data:image/png,x">'))
  })

  it('still rejects plain empties and over-length', () => {
    assert.throws(() => descriptionSchema.parse(''))
    assert.throws(() => descriptionSchema.parse('x'.repeat(20001)))
  })

  it('keeps the aligned messages for both failure modes', () => {
    const empty = descriptionSchema.safeParse('<p><br></p>')
    assert.equal(empty.success, false)
    assert.equal(empty.error?.issues[0]?.message, 'Description is required')

    const overLength = descriptionSchema.safeParse('x'.repeat(20001))
    assert.equal(overLength.success, false)
    assert.equal(overLength.error?.issues[0]?.message, 'Description too long')
  })

  it('keeps whitespace-only plain text rejected', () => {
    assert.throws(() => descriptionSchema.parse('   \n\t  '))
  })
})
