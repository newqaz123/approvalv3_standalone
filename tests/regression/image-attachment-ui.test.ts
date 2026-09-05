import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const requestSource = readFileSync('src/components/requests/file-upload-zone.tsx', 'utf8')

describe('image optimization size display', () => {
  it('request uploader stores and renders the server file size', () => {
    assert.match(requestSource, /storedSize\?: number/)
    assert.match(requestSource, /storedSize:\s*result\.fileAttachment\.fileSize/)
    assert.match(requestSource, /optimized/)
    assert.match(requestSource, /file\.file\.size/)
  })

  it('request picker exposes the already-supported WebP extension', () => {
    assert.match(requestSource, /\.webp/)
  })
})
