import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync('prisma/schema.prisma', 'utf8')
const migration = () =>
  readFileSync(
    'prisma/migrations/20260828000000_add_inline_description_images/migration.sql',
    'utf8',
  )

describe('inline description image schema', () => {
  it('stores owner/session metadata and retry-safe deletion state', () => {
    assert.match(schema, /model inline_description_images/)
    for (const field of [
      'uploadedById',
      'uploadSessionId',
      'originalSize',
      'fileSize',
      'filePath',
      'width',
      'height',
      'deletionPendingAt',
    ]) {
      assert.match(schema, new RegExp(`\\b${field}\\b`))
    }
  })

  it('supports exactly one request, solution, or template owner', () => {
    assert.match(schema, /model inline_description_image_references/)
    assert.match(migration(), /num_nonnulls\("requestId", "solutionId", "templateId"\) = 1/)
    assert.match(migration(), /ON DELETE CASCADE/g)
  })
})
