import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ROUTE = 'src/app/api/files/download/route.ts'

describe('private attachment download route wiring', () => {
  const source = readFileSync(ROUTE, 'utf8')

  it('requires an id query parameter validated as a UUID', () => {
    assert.match(source, /searchParams\.get\(['"]id['"]\)/)
    assert.match(source, /z\.string\(\)\.uuid\(\)|\.uuid\(\)/)
  })

  it('loads the attachment from file_attachments including its request linkage', () => {
    assert.match(source, /file_attachments/)
    assert.match(source, /requestId/)
    assert.match(source, /solution:\s*\{\s*select:\s*\{\s*requestId:\s*true/)
  })

  it('authorizes through canUserViewRequest before reading the file', () => {
    assert.match(source, /canUserViewRequest/)
  })

  it('reads physical bytes through readAttachmentFile', () => {
    assert.match(source, /readAttachmentFile/)
  })

  it('returns the original DB filename via buildContentDisposition', () => {
    assert.match(source, /\.fileName/)
    assert.match(source, /buildContentDisposition/)
  })

  it('no longer accepts a raw path query or touches public/', () => {
    assert.doesNotMatch(source, /searchParams\.get\(['"]path['"]\)/)
    assert.doesNotMatch(source, /join\(process\.cwd\(\),\s*['"]public/)
  })
})
