import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  hardDeleteArchivedRequests,
  type HardDeleteArchivedRequestsDeps,
  type HardDeleteArchivedRow,
} from '../../src/lib/retention-hard-delete'

function archivedRow(id: string): HardDeleteArchivedRow {
  return {
    id,
    fileAttachments: [{ filePath: `uploads/${id}-att.bin` }],
    solutions: [{ fileAttachments: [{ filePath: `uploads/${id}-sol.bin` }] }],
  }
}

type RecordedCall = { step: string }

function recordingDeps(
  events: string[],
  overrides: Partial<HardDeleteArchivedRequestsDeps> = {},
): HardDeleteArchivedRequestsDeps {
  return {
    findArchivedRequests: async (requestIds) => {
      events.push(`find:${requestIds.join(',')}`)
      return requestIds.map(archivedRow)
    },
    deleteArchivedRequests: async (requestIds) => {
      events.push(`delete-committed:${requestIds.length}`)
    },
    deleteAttachmentFile: async (filePath) => {
      events.push(`attachment-file:${filePath}`)
    },
    cleanupUnreferencedInlineImages: async (input) => {
      events.push(`inline-cleanup:${input.limit}`)
      assert.ok(
        input.olderThan.getTime() <= Date.now(),
        'cleanup cutoff must be now so newly unreferenced committed assets qualify'
      )
      return { deleted: [], warnings: [] }
    },
    revalidateViews: () => {
      events.push('revalidate')
    },
    ...overrides,
  }
}

describe('hardDeleteArchivedRequests inline image cleanup', () => {
  it('runs unreferenced inline cleanup only after the deletion transaction commits', async () => {
    const events: string[] = []
    const result = await hardDeleteArchivedRequests(['request-1'], recordingDeps(events))

    assert.deepEqual(result, { success: true, deleted: 1, fileWarnings: [] })
    assert.deepEqual(events, [
      'find:request-1',
      'delete-committed:1',
      'attachment-file:uploads/request-1-att.bin',
      'attachment-file:uploads/request-1-sol.bin',
      'inline-cleanup:100',
      'revalidate',
    ])
  })

  it('passes a now cutoff and the retention limit to the cleanup helper', async () => {
    const seen: Array<RecordedCall & { olderThan: Date; limit: number }> = []
    const result = await hardDeleteArchivedRequests(
      ['request-1'],
      recordingDeps([], {
        cleanupUnreferencedInlineImages: async (input) => {
          seen.push({ step: 'cleanup', olderThan: input.olderThan, limit: input.limit })
          return { deleted: ['orphaned-image'], warnings: [] }
        },
      })
    )

    assert.equal(result.success, true)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].limit, 100)
    assert.ok(
      Math.abs(seen[0].olderThan.getTime() - Date.now()) < 60_000,
      'cleanup cutoff must be the current time'
    )
  })

  it('appends cleanup warnings without failing a successful deletion', async () => {
    const result = await hardDeleteArchivedRequests(
      ['request-1'],
      recordingDeps([], {
        cleanupUnreferencedInlineImages: async () => ({
          deleted: [],
          warnings: [
            'Inline image 123e4567-e89b-42d3-a456-426614174004 could not be deleted; cleanup will retry',
          ],
        }),
      })
    )

    assert.deepEqual(result, {
      success: true,
      deleted: 1,
      fileWarnings: [
        'Inline image 123e4567-e89b-42d3-a456-426614174004 could not be deleted; cleanup will retry',
      ],
    })
  })

  it('keeps the deletion successful when inline cleanup itself throws', async () => {
    const result = await hardDeleteArchivedRequests(
      ['request-1'],
      recordingDeps([], {
        cleanupUnreferencedInlineImages: async () => {
          throw new Error('database unavailable')
        },
      })
    )

    assert.equal(result.success, true)
    if (!result.success) return
    assert.equal(result.deleted, 1)
    assert.equal(result.fileWarnings.length, 1)
    assert.match(result.fileWarnings[0], /inline image cleanup failed/i)
    assert.match(result.fileWarnings[0], /database unavailable/)
  })

  it('never invokes cleanup when no archived request is deleted', async () => {
    const events: string[] = []
    const noRows = await hardDeleteArchivedRequests(
      ['request-1'],
      recordingDeps(events, {
        findArchivedRequests: async (requestIds) => {
          events.push(`find:${requestIds.join(',')}`)
          return []
        },
      })
    )
    assert.deepEqual(noRows, {
      success: false,
      error: 'Only archived requests can be hard-deleted',
    })

    const noIds = await hardDeleteArchivedRequests([], recordingDeps(events))
    assert.deepEqual(noIds, {
      success: false,
      error: 'Select at least one archived request',
    })

    assert.deepEqual(events, ['find:request-1'], 'cleanup must not run without a committed deletion')
  })

  it('fails the whole operation without cleanup when the deletion transaction fails', async () => {
    const events: string[] = []
    const result = await hardDeleteArchivedRequests(
      ['request-1'],
      recordingDeps(events, {
        deleteArchivedRequests: async () => {
          events.push('delete-failed')
          throw new Error('serialization failure')
        },
      })
    )

    assert.deepEqual(result, { success: false, error: 'Failed to hard-delete archived requests' })
    assert.ok(
      !events.includes('inline-cleanup:100'),
      'cleanup must not run when the deletion transaction failed'
    )
  })
})

describe('hard delete cleanup safety', () => {
  it('keeps file I/O out of the database-only deletion transaction', () => {
    const source = readFileSync('src/lib/retention-hard-delete.ts', 'utf8')
    const txStart = source.indexOf('$transaction')
    const txEnd = source.indexOf('})', source.indexOf('deleteMany', txStart))
    assert.notEqual(txEnd, -1, 'transaction block should contain deleteMany')

    const transactionBlock = source.slice(txStart, txEnd)
    assert.match(transactionBlock, /deleteMany/)
    assert.doesNotMatch(transactionBlock, /cleanup/i)
    assert.doesNotMatch(transactionBlock, /deleteAttachmentFile/)
    assert.doesNotMatch(transactionBlock, /deleteFile/)
  })

  it('keeps shared referenced inline assets out of cleanup candidates', () => {
    const lifecycle = readFileSync('src/lib/inline-images/lifecycle.ts', 'utf8')
    const productionStart = lifecycle.indexOf('const productionCleanupInlineImageDeps')
    const productionEnd = lifecycle.indexOf('const productionReadInlineImageDeps')
    assert.ok(productionStart !== -1 && productionEnd > productionStart)

    const productionBlock = lifecycle.slice(productionStart, productionEnd)
    assert.match(productionBlock, /findCandidates/)
    // An asset holding any reference — shared or single — is never a candidate.
    assert.match(productionBlock, /references: \{ none: \{\} \}/)
    assert.match(productionBlock, /createdAt: \{ lt: olderThan \}/)
  })

  it('keeps the upload route sweep independent from hard-delete cleanup', () => {
    const route = readFileSync('src/app/api/inline-images/route.ts', 'utf8')
    assert.doesNotMatch(route, /hardDeleteArchivedRequests/)
    const hardDelete = readFileSync('src/lib/retention-hard-delete.ts', 'utf8')
    assert.doesNotMatch(hardDelete, /DAY_MS|Date\.now\(\) - 24/)
  })
})
