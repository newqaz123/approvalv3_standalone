import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { uploadAttachmentBatch, type AttachmentUploadItem } from '../../src/lib/attachments/upload-batch'

const file = (name: string) => new File(['pdf'], name, { type: 'application/pdf' })
const item = (id: string, name: string): AttachmentUploadItem => ({ id, file: file(name), status: 'pending' })

describe('uploadAttachmentBatch', () => {
  it('returns explicit failure and never relies on stale UI state', async () => {
    const result = await uploadAttachmentBatch(
      [item('a', 'ok.pdf'), item('b', 'bad.pdf')],
      async (candidate) => candidate.id === 'a'
        ? { success: true, attachmentId: '11111111-1111-1111-1111-111111111111' }
        : { success: false, error: 'Upload failed' }
    )
    assert.equal(result.success, false)
    assert.deepEqual(result.attachmentIds, ['11111111-1111-1111-1111-111111111111'])
    assert.equal(result.items.find((entry) => entry.id === 'b')?.status, 'error')
  })

  it('reuses previous successes and retries only failures', async () => {
    const calls: string[] = []
    const existing: AttachmentUploadItem = {
      ...item('a', 'ok.pdf'),
      status: 'success',
      attachmentId: '11111111-1111-1111-1111-111111111111',
    }
    const result = await uploadAttachmentBatch([existing, { ...item('b', 'retry.pdf'), status: 'error' }], async (candidate) => {
      calls.push(candidate.id)
      return { success: true, attachmentId: '22222222-2222-2222-2222-222222222222' }
    })
    assert.deepEqual(calls, ['b'])
    assert.equal(result.success, true)
    assert.equal(result.attachmentIds.length, 2)
  })

  it('keeps the server-reported stored size on successful items', async () => {
    const result = await uploadAttachmentBatch(
      [item('image', 'photo.pdf')],
      async () => ({
        success: true,
        attachmentId: '11111111-1111-1111-1111-111111111111',
        storedSize: 327600,
      }),
    )
    assert.equal(result.items[0].storedSize, 327600)
  })

  it('preserves a prior successful stored size when retrying other items', async () => {
    const prior = {
      ...item('prior', 'prior.pdf'),
      status: 'success' as const,
      attachmentId: '11111111-1111-1111-1111-111111111111',
      storedSize: 100,
    }
    const result = await uploadAttachmentBatch(
      [prior, { ...item('retry', 'retry.pdf'), status: 'error' }],
      async () => ({
        success: true,
        attachmentId: '22222222-2222-2222-2222-222222222222',
        storedSize: 200,
      }),
    )
    assert.equal(result.items[0].storedSize, 100)
    assert.equal(result.items[1].storedSize, 200)
  })

  it('rejects unsupported metadata without invoking the uploader', async () => {
    const calls: string[] = []
    const snapshots: { id: string; status: string }[] = []
    const invalid: AttachmentUploadItem = {
      id: 'x',
      file: new File(['<html>'], 'script.html', { type: 'text/html' }),
      status: 'pending',
    }
    const result = await uploadAttachmentBatch([invalid], async (candidate) => {
      calls.push(candidate.id)
      return { success: true, attachmentId: '11111111-1111-1111-1111-111111111111' }
    }, (changed) => {
      snapshots.push({ id: changed.id, status: changed.status })
    })
    assert.deepEqual(calls, [])
    assert.equal(result.success, false)
    assert.equal(result.items[0].status, 'error')
    assert.match(result.items[0].error!, /not supported/)
    assert.deepEqual(result.attachmentIds, [])
    assert.deepEqual(snapshots, [{ id: 'x', status: 'error' }])
  })

  it('emits uploading and final snapshots via onItemChange', async () => {
    const snapshots: { id: string; status: string }[] = []
    await uploadAttachmentBatch(
      [item('a', 'ok.pdf')],
      async () => ({ success: true, attachmentId: '11111111-1111-1111-1111-111111111111' }),
      (changed) => { snapshots.push({ id: changed.id, status: changed.status }) }
    )
    assert.deepEqual(snapshots, [
      { id: 'a', status: 'uploading' },
      { id: 'a', status: 'success' },
    ])
  })

  it('clears the previous error when retrying an errored item', async () => {
    const snapshots: { id: string; status: string; error?: string }[] = []
    const previouslyFailed: AttachmentUploadItem = {
      ...item('a', 'ok.pdf'),
      status: 'error',
      error: 'Upload failed',
    }
    await uploadAttachmentBatch(
      [previouslyFailed],
      async () => ({ success: true, attachmentId: '11111111-1111-1111-1111-111111111111' }),
      (changed) => { snapshots.push({ id: changed.id, status: changed.status, error: changed.error }) }
    )
    assert.equal(snapshots[0].status, 'uploading')
    assert.equal(snapshots[0].error, undefined)
  })

  it('returns an empty success result for no items', async () => {
    const result = await uploadAttachmentBatch(
      [],
      async () => ({ success: true, attachmentId: '11111111-1111-1111-1111-111111111111' })
    )
    assert.equal(result.success, true)
    assert.deepEqual(result.items, [])
    assert.deepEqual(result.attachmentIds, [])
  })

  it('includes both prior successes and new successes in attachmentIds in item order', async () => {
    const prior: AttachmentUploadItem = {
      ...item('a', 'ok.pdf'),
      status: 'success',
      attachmentId: '11111111-1111-1111-1111-111111111111',
    }
    const result = await uploadAttachmentBatch(
      [prior, item('b', 'new.pdf')],
      async () => ({ success: true, attachmentId: '22222222-2222-2222-2222-222222222222' })
    )
    assert.equal(result.success, true)
    assert.deepEqual(result.attachmentIds, [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ])
  })

  it('emits uploading then error terminal snapshots via onItemChange on upload failure', async () => {
    const snapshots: { id: string; status: string; error?: string }[] = []
    const result = await uploadAttachmentBatch(
      [item('a', 'bad.pdf')],
      async () => ({ success: false, error: 'Server error' }),
      (changed) => { snapshots.push({ id: changed.id, status: changed.status, error: changed.error }) }
    )
    assert.deepEqual(snapshots, [
      { id: 'a', status: 'uploading', error: undefined },
      { id: 'a', status: 'error', error: 'Server error' },
    ])
    assert.equal(result.success, false)
    assert.equal(result.items[0].error, 'Server error')
  })

  it('catches a thrown uploadOne error, marks the item error, and continues later items', async () => {
    // A transport-level failure (HTTP 500) makes uploadOne reject instead of
    // returning an explicit { success:false }. The batch must catch the throw,
    // record a terminal error state + snapshot, and keep processing the rest of
    // the batch — never aborting it and never leaving the item stuck at
    // 'uploading'.
    const calls: string[] = []
    const snapshots: { id: string; status: string; error?: string }[] = []
    const result = await uploadAttachmentBatch(
      [item('a', 'ok.pdf'), item('b', 'throws.pdf'), item('c', 'later.pdf')],
      async (candidate) => {
        calls.push(candidate.id)
        if (candidate.id === 'b') throw new Error('Network 500')
        return {
          success: true,
          attachmentId:
            candidate.id === 'a'
              ? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
              : 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        }
      },
      (changed) => { snapshots.push({ id: changed.id, status: changed.status, error: changed.error }) }
    )
    // The throw did NOT abort the batch — every item was attempted in order.
    assert.deepEqual(calls, ['a', 'b', 'c'])
    // The thrown item is marked terminal error with the Error message.
    const thrown = result.items.find((entry) => entry.id === 'b')
    assert.equal(thrown?.status, 'error')
    assert.equal(thrown?.error, 'Network 500')
    // A terminal error snapshot was emitted for the thrown item.
    assert.ok(
      snapshots.some((s) => s.id === 'b' && s.status === 'error' && s.error === 'Network 500'),
      'emitted a terminal error snapshot for the thrown item'
    )
    // The later item continued and succeeded despite the earlier throw.
    assert.equal(result.items.find((entry) => entry.id === 'c')?.status, 'success')
    assert.equal(result.success, false)
    // Successful IDs are returned in item order, skipping the failed one.
    assert.deepEqual(result.attachmentIds, [
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
    ])
  })

  it('normalizes a thrown non-Error uploadOne failure to the fallback message', async () => {
    // When uploadOne rejects with a non-Error value (or a value without a
    // usable message), the batch must still record a terminal error with a
    // stable fallback rather than propagating the raw rejection.
    const snapshots: { id: string; status: string; error?: string }[] = []
    const result = await uploadAttachmentBatch(
      [item('a', 'throws.pdf')],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => { throw 'boom' },
      (changed) => { snapshots.push({ id: changed.id, status: changed.status, error: changed.error }) }
    )
    assert.equal(result.success, false)
    assert.equal(result.items[0].status, 'error')
    assert.equal(result.items[0].error, 'Upload failed')
    assert.equal(snapshots.at(-1)?.error, 'Upload failed')
  })

  it('retries only the item left in error after a transport throw (successes are not re-uploaded)', async () => {
    // End-to-end retry contract: after a batch where one item threw and left
    // the rest successful, feeding result.items back must re-upload ONLY the
    // errored item. Prior successes are reused verbatim.
    const first = await uploadAttachmentBatch(
      [item('a', 'ok.pdf'), item('b', 'throws.pdf')],
      async (candidate) => {
        if (candidate.id === 'b') throw new Error('Server down')
        return { success: true, attachmentId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }
      }
    )
    assert.equal(first.success, false)

    const retryCalls: string[] = []
    const retry = await uploadAttachmentBatch(first.items, async (candidate) => {
      retryCalls.push(candidate.id)
      return { success: true, attachmentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }
    })
    // Only the errored item is re-uploaded; the prior success is skipped.
    assert.deepEqual(retryCalls, ['b'])
    assert.equal(retry.success, true)
  })
})

// ── Hook + component contract tests (Task 5). These follow the established
//    source-regex pattern used throughout the regression suite: read the module
//    source and assert the structural/behavioral invariants that the brief pins.
//    React hooks cannot be rendered in the node:test runner (no DOM / RTL), so
//    source-regex is the verification channel — same approach as the Task 2/3/4
//    server-action contract tests. ──

// The legacy useSolutionAttachments hook (submit-time draft upload via
// uploadSolutionDraftAttachmentAction) was removed with the Task 4 staged-XHR
// swap; its contract tests were retired with it. The staged lifecycle is
// behavior-tested in use-staged-request-attachments.test.ts and
// use-staged-solution-attachments.test.ts; the uploader card contract below is
// updated to the staged item shape.
const componentSource = readFileSync('src/components/solutions/solution-file-upload.tsx', 'utf8')

describe('SolutionFileUpload items-first API', () => {
  it('accepts staged items with add/remove/retry callbacks', () => {
    assert.match(componentSource, /items: StagedItem\[\]/)
    assert.match(componentSource, /onAddFiles/)
    assert.match(componentSource, /onRemoveItem/)
    assert.match(componentSource, /onRetryItem/)
  })

  it('renders items-first as the sole API (no legacy dual-normalization)', () => {
    assert.match(componentSource, /items: StagedItem\[\]/)
    // No deprecated parallel API remains after the caller migration.
    assert.doesNotMatch(componentSource, /usingItemsApi/)
    assert.doesNotMatch(componentSource, /items !== undefined/)
  })

  it('renders real per-file byte progress and the staged state labels', () => {
    // Eager staging: the real xhr.upload.onprogress percent per item plus the
    // request-mode labels; never a fabricated 100%.
    assert.match(componentSource, /value=\{item\.progress\}/)
    assert.match(componentSource, /\{item\.progress\}%/)
    assert.match(componentSource, />Pending</)
    assert.match(componentSource, />Uploaded</)
    assert.match(componentSource, />Removing\.\.\.</)
    assert.match(componentSource, /files ready/)
    assert.doesNotMatch(componentSource, /value=\{100\}/)
    assert.doesNotMatch(componentSource, /describeUploadProgress/)
  })

  it('shows per-item server error text beside failed files (including cleanup failures)', () => {
    assert.match(componentSource, /item\.error/)
    assert.match(componentSource, /text-red-600/)
    assert.match(componentSource, /canRetryStagedUpload\(item\)/)
    assert.match(componentSource, /showCleanupError/)
  })

  it('keeps failed items retryable with a retry action', () => {
    assert.match(componentSource, /onRetryItem\(item\.id\)/)
    assert.match(componentSource, /RotateCcw/)
  })

  it('removed the optimization display and deprecated props with the staged swap', () => {
    // The staged protocol stores the file bytes as-is; there is no server
    // optimizer result (storedSize) to render on this surface anymore.
    assert.doesNotMatch(componentSource, /storedSize/)
    assert.doesNotMatch(componentSource, /optimized/)
    assert.doesNotMatch(componentSource, /files\?: File\[\]/)
    assert.doesNotMatch(componentSource, /filesWithProgress/)
    assert.doesNotMatch(componentSource, /onFilesChange/)
    assert.doesNotMatch(componentSource, /onRemoveFile/)
    assert.doesNotMatch(componentSource, /@deprecated/)
  })
})
