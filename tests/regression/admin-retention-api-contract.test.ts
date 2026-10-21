import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ADMIN_RETENTION_API_EXPECTATIONS } from '../support/admin-security/admin-retention-api-contract'

/**
 * Regression (Astra admin-harness review, finding 2): the spec's authorized
 * backup control posts `requestIds: []` and asserts the route's validation
 * error — but asserted the WRONG branch's message ("Select between 1 and…"),
 * deterministically failing the serial suite. The empty-array branch of
 * src/app/api/admin/retention/backup/route.ts returns "Select at least one
 * request"; the "Select between 1 and N requests" message belongs to the
 * SUBSEQUENT non-string/over-limit branch.
 *
 * These tests statically lock the harness's expected responses against the
 * actual production route/lib sources (read-only source checks; the routes
 * themselves are never executed here).
 */

const BACKUP_ROUTE = path.resolve(process.cwd(), 'src/app/api/admin/retention/backup/route.ts')
const HARD_DELETE_ROUTE = path.resolve(process.cwd(), 'src/app/api/admin/retention/hard-delete/route.ts')
const HARD_DELETE_LIB = path.resolve(process.cwd(), 'src/lib/retention-hard-delete.ts')

describe('admin retention API contract: empty-list backup message (finding 2)', () => {
  it('harness expects the ACTUAL empty-array branch message, not the later count-branch message', () => {
    const source = readFileSync(BACKUP_ROUTE, 'utf8')
    const expected = ADMIN_RETENTION_API_EXPECTATIONS.backup.emptyRequestIdsMessage
    assert.equal(expected, 'Select at least one request')
    // The empty-array condition and its message both exist in the route.
    assert.ok(source.includes('requestIds.length === 0'), 'empty-array branch condition must exist')
    assert.ok(source.includes(`{ error: 'Select at least one request' }`), 'empty-array branch message must exist verbatim')
    // And the message the ORIGINAL harness wrongly expected belongs to a
    // LATER branch (the over-limit one), never to empty arrays.
    const emptyBranch = source.indexOf('requestIds.length === 0')
    const emptyMessage = source.indexOf('Select at least one request')
    const countBranch = source.indexOf('Select between 1 and')
    assert.ok(emptyBranch !== -1 && countBranch !== -1 && emptyMessage !== -1)
    assert.ok(emptyMessage > emptyBranch, 'the empty-array message belongs to the empty-array branch')
    assert.ok(countBranch > emptyMessage, 'the count-branch message must come after the empty-array branch')
  })

  it('hard-delete empty-array message comes from the lib guard the route delegates to', () => {
    const lib = readFileSync(HARD_DELETE_LIB, 'utf8')
    const expected = ADMIN_RETENTION_API_EXPECTATIONS.hardDelete.emptyRequestIdsMessage
    assert.equal(expected, 'Select at least one archived request')
    assert.ok(lib.includes('ids.length === 0'), 'lib empty-ids guard must exist')
    assert.ok(lib.includes(`error: '${expected}'`), 'lib empty-ids message must exist verbatim')
    // The route itself only checks Array.isArray; empty arrays reach the lib.
    const route = readFileSync(HARD_DELETE_ROUTE, 'utf8')
    assert.ok(route.includes('!Array.isArray(requestIds)'), 'route delegates empty arrays to the lib guard')
  })
})

describe('admin retention API contract: unauthorized shape', () => {
  it('both routes answer 401 with { error: "Unauthorized" } before validation', () => {
    for (const file of [BACKUP_ROUTE, HARD_DELETE_ROUTE]) {
      const source = readFileSync(file, 'utf8')
      assert.ok(
        source.includes(`NextResponse.json({ error: 'Unauthorized' }, { status: 401 })`),
        `${path.basename(file)} must keep the 401 JSON unauthorized shape the harness asserts`
      )
    }
    assert.deepEqual(ADMIN_RETENTION_API_EXPECTATIONS.unauthorizedBody, { error: 'Unauthorized' })
  })
})
