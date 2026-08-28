import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const UPLOAD_ROUTE = 'src/app/api/inline-images/route.ts'
const IMAGE_ROUTE = 'src/app/api/inline-images/[id]/route.ts'

describe('inline image route contracts', () => {
  it('authenticates multipart uploads and validates the session before creating a draft', () => {
    const source = readFileSync(UPLOAD_ROUTE, 'utf8')

    assert.match(source, /auth\(\)/)
    assert.match(source, /request\.formData\(\)/)
    assert.match(source, /uploadSessionId/)
    assert.match(source, /\.uuid\(\)/)
    assert.match(source, /createInlineImageDraft/)
    assert.match(source, /status:\s*201/)
    assert.match(source, /status:\s*400/)
    assert.match(source, /status:\s*401/)
    assert.match(source, /status:\s*403/)
    assert.match(source, /status:\s*413/)
    assert.doesNotMatch(source, /formData\.get\(['"](?:filePath|path)['"]\)/)
  })

  it('validates canonical IDs, awaits Next 15 params, and returns private safe image headers', () => {
    const source = readFileSync(IMAGE_ROUTE, 'utf8')

    assert.match(source, /auth\(\)/)
    assert.match(source, /await\s+params/)
    assert.match(source, /\.uuid\(\)/)
    assert.match(source, /canReadInlineImage/)
    assert.match(source, /readInlineImageFile/)
    assert.match(source, /X-Content-Type-Options['"]?\s*:\s*['"]nosniff/)
    assert.match(source, /private, max-age=86400, immutable/)
    assert.match(source, /private, no-store/)
    assert.match(source, /Content-Length/)
    assert.doesNotMatch(source, /searchParams\.get\(['"](?:filePath|path)['"]\)/)
  })

  it('requires owner/session-scoped JSON deletion without accepting a client path', () => {
    const source = readFileSync(IMAGE_ROUTE, 'utf8')

    assert.match(source, /request\.json\(\)/)
    assert.match(source, /uploadSessionId/)
    assert.match(source, /deleteInlineImageDraft/)
    assert.doesNotMatch(source, /(?:body|payload)\.(?:filePath|path)/)
  })
})
