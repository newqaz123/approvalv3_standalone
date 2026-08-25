import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

it('bulk delete by date archives rows instead of soft-deleting them', () => {
  const actions = readFileSync('src/server-actions/requests.ts', 'utf8')
  const dialog = readFileSync('src/components/requests/bulk-delete-by-date-range.tsx', 'utf8')

  const start = actions.indexOf('bulkDeleteRequestsByDateRange')
  const body = actions.slice(start, actions.indexOf('PHASE 4', start))

  // Archive, not soft delete
  assert.match(body, /isArchived: true/)
  assert.doesNotMatch(body, /isDeleted: true,/)
  assert.doesNotMatch(body, /deletedAt: new Date/)
  assert.match(body, /action: 'archived'/)

  // Preview excludes already-archived rows; archive + audit are atomic
  assert.match(body, /isArchived: false,\n\s+createdAt: \{/) 
  assert.match(body, /\$transaction/)
  assert.match(body, /isDeleted: false,\n\s+isArchived: false,\n\s+\},\n\s+data: \{\n\s+isArchived: true/)

  // Dialog points at retention and speaks archive
  assert.match(dialog, /\/admin\/retention/)
  assert.doesNotMatch(dialog, /\/admin\/deleted-requests/)
  assert.doesNotMatch(dialog, /soft delete/i)
  assert.doesNotMatch(dialog, /Soft delete/i)
  assert.match(dialog, /Archive/i)
})
