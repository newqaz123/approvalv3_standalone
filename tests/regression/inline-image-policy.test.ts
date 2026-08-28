import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalInlineImageSrc,
  extractInlineImageIds,
  normalizeInlineImageAlignment,
  parseInlineImageSrc,
} from '@/lib/inline-images/policy'

const ID = '123e4567-e89b-42d3-a456-426614174000'

describe('inline image canonical URLs', () => {
  it('round-trips canonical internal URLs and rejects every other source', () => {
    assert.equal(canonicalInlineImageSrc(ID), `/api/inline-images/${ID}`)
    assert.equal(parseInlineImageSrc(`/api/inline-images/${ID}`), ID)
    for (const src of [`https://x/${ID}`, `//x/${ID}`, `data:image/png,x`, `blob:x`, `/api/inline-images/${ID}/x`, `/api/inline-images/../x`]) {
      assert.equal(parseInlineImageSrc(src), null)
    }
  })

  it('extracts unique IDs in document order', () => {
    const html = `<p><img src="/api/inline-images/${ID}"><img src="/api/inline-images/${ID}"></p>`
    assert.deepEqual(extractInlineImageIds(html), [ID])
  })

  it('normalizes alignment to the exact supported values', () => {
    for (const alignment of ['left', 'center', 'right'] as const) {
      assert.equal(normalizeInlineImageAlignment(alignment), alignment)
    }
    for (const alignment of ['top', 'LEFT', '', undefined]) {
      assert.equal(normalizeInlineImageAlignment(alignment), 'center')
    }
  })
})
