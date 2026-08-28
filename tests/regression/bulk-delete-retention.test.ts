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

it('hard delete triggers inline image cleanup only after the deletion transaction commits', () => {
  const hardDelete = readFileSync('src/lib/retention-hard-delete.ts', 'utf8')

  assert.match(hardDelete, /cleanupUnreferencedInlineImages/)
  assert.match(hardDelete, /olderThan: new Date\(\)/)
  assert.match(hardDelete, /INLINE_IMAGE_CLEANUP_LIMIT = 100/)
  assert.match(hardDelete, /isArchived: true/)

  // The request deletion transaction is database-only: reference cascades
  // commit there, and cleanup/file I/O must never run inside it.
  const txStart = hardDelete.indexOf('$transaction')
  const txEnd = hardDelete.indexOf('})', hardDelete.indexOf('deleteMany', txStart))
  assert.notEqual(txEnd, -1, 'deletion transaction should contain deleteMany')
  const transactionBlock = hardDelete.slice(txStart, txEnd)
  assert.match(transactionBlock, /deleteMany/)
  assert.doesNotMatch(transactionBlock, /cleanupUnreferencedInlineImages/)
  assert.doesNotMatch(transactionBlock, /deleteAttachmentFile/)
  assert.doesNotMatch(transactionBlock, /deleteInlineImageFile/)

  // Cleanup runs after the committed deletion in the flow order.
  const flow = hardDelete.slice(hardDelete.indexOf('export async function hardDeleteArchivedRequests'))
  const deletionCall = flow.indexOf('deleteArchivedRequests(')
  const cleanupCall = flow.indexOf('cleanupUnreferencedInlineImages(')
  assert.notEqual(deletionCall, -1, 'flow should call the deletion dependency')
  assert.ok(deletionCall < cleanupCall, 'cleanup must be invoked after the deletion call')
})

it('keeps archive-only hard delete semantics while appending cleanup warnings', () => {
  const hardDelete = readFileSync('src/lib/retention-hard-delete.ts', 'utf8')
  assert.match(hardDelete, /fileWarnings\.push\(\.\.\.cleanup\.warnings\)/)
  assert.doesNotMatch(hardDelete, /isDeleted: true/)
})
