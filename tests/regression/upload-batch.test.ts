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

const hookSource = readFileSync('src/hooks/use-solution-attachments.ts', 'utf8')
const componentSource = readFileSync('src/components/solutions/solution-file-upload.tsx', 'utf8')

describe('useSolutionAttachments hook contract', () => {
  it('exports the hook with the items-first return interface', () => {
    assert.match(hookSource, /export function useSolutionAttachments/)
    assert.match(hookSource, /items: AttachmentUploadItem\[\]/)
    assert.match(hookSource, /addFiles/)
    assert.match(hookSource, /removeItem/)
    assert.match(hookSource, /ensureUploaded/)
    assert.match(hookSource, /cleanupDrafts/)
    assert.match(hookSource, /reset/)
    assert.match(hookSource, /clear/)
  })

  it('uses a ref to avoid stale closures in async callbacks', () => {
    assert.match(hookSource, /itemsRef/)
    assert.match(hookSource, /itemsRef\.current/)
  })

  it('ensureUploaded returns the coordinator result directly', () => {
    assert.match(hookSource, /const result = await uploadAttachmentBatch/)
    assert.match(hookSource, /setItems\(result\.items\)/)
    assert.match(hookSource, /return result/)
  })

  it('uploadOne builds FormData with file and requestId for the draft action', () => {
    assert.match(hookSource, /formData\.append\('file'/)
    assert.match(hookSource, /formData\.append\('requestId'/)
    assert.match(hookSource, /uploadSolutionDraftAttachmentAction/)
  })

  it('removeItem cleans server-side before removing and never swallows failures', () => {
    assert.match(hookSource, /cleanupSolutionDraftAttachments/)
    // removeItem checks for staged attachmentId before cleanup
    assert.match(hookSource, /current\?\.status === 'success' && current\.attachmentId/)
    // Propagates the cleanup failure — never silently swallowed
    assert.match(hookSource, /if \(!result\.success\)\s*\{[\s\S]*?throw new Error\(result\.error\)/m)
  })

  it('cleanupDrafts batches all successful staged ids', () => {
    // The batching: filter all success+attachmentId items into one cleanup call
    assert.match(hookSource, /stagedIds/)
    assert.match(hookSource, /entry\.status === 'success' && entry\.attachmentId/)
    assert.match(hookSource, /attachmentIds: stagedIds/)
  })

  it('reset clears local state only after cleanup returns', () => {
    // reset calls cleanup before setItems([])
    const resetSlice = hookSource.slice(hookSource.indexOf('const reset ='))
    assert.match(resetSlice, /cleanupSolutionDraftAttachments/)
    assert.match(resetSlice, /setItems\(\[\]\)/)
    // The cleanup await must precede the clear
    assert.ok(resetSlice.indexOf('await') < resetSlice.indexOf("setItems([])"))
  })

  it('reset nulls the ref synchronously to avoid double-cleanup on unmount', () => {
    // reset must null itemsRef.current before setItems([]) so the unmount
    // safety net (which reads itemsRef.current) does not double-clean drafts
    // that reset already deleted via the deterministic Cancel button.
    const resetSlice = hookSource.slice(hookSource.indexOf('const reset ='))
    assert.match(resetSlice, /itemsRef\.current = \[\]/)
    assert.ok(
      resetSlice.indexOf('itemsRef.current = []') <
        resetSlice.indexOf('setItems([])')
    )
  })

  it('clear drops local state without server cleanup and nulls the ref first', () => {
    // clear is for the post-success path: linked drafts must not be sent to
    // cleanupSolutionDraftAttachments (which scopes to solutionId:null).
    const clearSlice = hookSource.slice(hookSource.indexOf('const clear ='))
    assert.match(clearSlice, /setItems\(\[\]\)/)
    // The ref is nulled synchronously before the state update so same-tick
    // callbacks cannot observe the now-linked IDs.
    assert.match(clearSlice, /itemsRef\.current = \[\]/)
    assert.ok(
      clearSlice.indexOf('itemsRef.current = []') <
        clearSlice.indexOf('setItems([])')
    )
    // clear must never invoke server cleanup
    assert.doesNotMatch(clearSlice, /cleanupSolutionDraftAttachments/)
  })

  it('fires best-effort cleanup on unmount for staged drafts (safety net)', () => {
    // A useEffect cleanup snapshots itemsRef.current on unmount and fires
    // owner-scoped cleanup for any remaining staged (unlinked) drafts. After a
    // successful submit, clear() has already nulled itemsRef.current, so this
    // is a no-op — cleanup never runs on linked attachments.
    assert.match(hookSource, /useEffect/)
    // Fire-and-forget (void) distinguishes the unmount safety net from the
    // awaited cleanup in reset/cleanupDrafts/removeItem.
    assert.match(hookSource, /void cleanupSolutionDraftAttachments/)
  })
})

describe('SolutionFileUpload items-first API', () => {
  it('accepts items: AttachmentUploadItem[] with add/remove/retry callbacks', () => {
    assert.match(componentSource, /items: AttachmentUploadItem\[\]/)
    assert.match(componentSource, /onAddFiles/)
    assert.match(componentSource, /onRemoveItem/)
    assert.match(componentSource, /onRetryItem/)
  })

  it('renders items-first as the sole API (no legacy dual-normalization)', () => {
    assert.match(componentSource, /items: AttachmentUploadItem\[\]/)
    // No deprecated parallel API remains after the Task 6 caller migration.
    assert.doesNotMatch(componentSource, /usingItemsApi/)
    assert.doesNotMatch(componentSource, /items !== undefined/)
  })

  it('shows per-item server error text beside failed files', () => {
    assert.match(componentSource, /item\.error/)
    assert.match(componentSource, /text-red-600/)
  })

  it('keeps failed items retryable with a retry action', () => {
    assert.match(componentSource, /onRetryItem\(item\.id\)/)
    assert.match(componentSource, /RotateCcw/)
  })

  it('removed the legacy deprecated props after the Task 6 caller migration', () => {
    assert.doesNotMatch(componentSource, /files\?: File\[\]/)
    assert.doesNotMatch(componentSource, /filesWithProgress/)
    assert.doesNotMatch(componentSource, /onFilesChange/)
    assert.doesNotMatch(componentSource, /onRemoveFile/)
    assert.doesNotMatch(componentSource, /@deprecated/)
  })
})
