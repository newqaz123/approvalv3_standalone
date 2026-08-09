import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
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
})
