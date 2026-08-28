import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInlineImageCoordinator,
  inlineImageReducer,
  type InlineImageRecord,
  type InlineImageUploadTransport,
  type InlineImageDeleteTransport,
} from '../../src/hooks/use-inline-description-images'
import { deleteInlineImage, uploadInlineImage } from '../../src/lib/inline-images/client'
import type { InlineImageUpload } from '../../src/lib/inline-images/policy'

const SESSION = '123e4567-e89b-42d3-a456-426614174000'
const IMAGE_A = '123e4567-e89b-42d3-a456-426614174001'
const IMAGE_B = '123e4567-e89b-42d3-a456-426614174002'

const upload = (id: string): InlineImageUpload => ({
  id,
  src: `/api/inline-images/${id}`,
  alt: 'photo',
  fileType: 'image/png',
  fileSize: 10,
  width: 100,
  height: 80,
})

const file = (name: string) => new File(['image'], name, { type: 'image/png' })
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function makeCoordinator(
  transport: InlineImageUploadTransport,
  removeTransport: InlineImageDeleteTransport = async () => undefined,
) {
  return createInlineImageCoordinator({
    uploadSessionId: SESSION,
    upload: transport,
    remove: removeTransport,
  })
}

describe('inline image reducer', () => {
  it('tracks queued, uploading, progress, failure, success, and removal immutably', () => {
    const initial: InlineImageRecord[] = []
    const queued = inlineImageReducer(initial, { type: 'queued', uploadId: 'upload-a', file: file('a.png') })
    assert.deepEqual(initial, [])
    assert.equal(queued[0].status, 'queued')

    const uploading = inlineImageReducer(queued, { type: 'uploading', uploadId: 'upload-a' })
    const progressed = inlineImageReducer(uploading, { type: 'progress', uploadId: 'upload-a', percent: 42 })
    assert.equal(progressed[0].status, 'uploading')
    assert.equal(progressed[0].progress, 42)

    const failed = inlineImageReducer(progressed, { type: 'failed', uploadId: 'upload-a', error: 'network' })
    assert.equal(failed[0].status, 'failed')
    assert.equal(failed[0].error, 'network')

    const succeeded = inlineImageReducer(failed, { type: 'succeeded', uploadId: 'upload-a', upload: upload(IMAGE_A) })
    assert.deepEqual(succeeded[0], {
      uploadId: 'upload-a',
      file: queued[0].file,
      status: 'success',
      progress: 100,
      imageId: IMAGE_A,
      upload: upload(IMAGE_A),
    })
    assert.deepEqual(inlineImageReducer(succeeded, { type: 'removed', uploadId: 'upload-a' }), [])
  })
})

describe('inline image upload coordinator', () => {
  it('uses one stable session UUID for every queued upload and limits active work to three FIFO workers', async () => {
    const calls: string[] = []
    const deferredById = new Map<string, Deferred<InlineImageUpload>>()
    let active = 0
    let maximumActive = 0
    const transport: InlineImageUploadTransport = async (candidate, session) => {
      calls.push(`${candidate.name}:${session}`)
      active += 1
      maximumActive = Math.max(maximumActive, active)
      const result = deferred<InlineImageUpload>()
      deferredById.set(candidate.name, result)
      const value = await result.promise
      active -= 1
      return value
    }
    const coordinator = makeCoordinator(transport)

    const promises = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'].map((name, index) => (
      coordinator.upload(`upload-${index}`, file(name), () => undefined)
    ))
    await tick()

    assert.equal(coordinator.uploadSessionId, SESSION)
    assert.equal(maximumActive, 3)
    assert.deepEqual(calls.map((entry) => entry.split(':')[0]), ['a.png', 'b.png', 'c.png'])
    assert.deepEqual(coordinator.getState().map((entry) => entry.status), [
      'uploading', 'uploading', 'uploading', 'queued', 'queued',
    ])

    deferredById.get('a.png')!.resolve(upload(IMAGE_A))
    deferredById.get('b.png')!.resolve(upload(IMAGE_B))
    deferredById.get('c.png')!.resolve(upload('123e4567-e89b-42d3-a456-426614174003'))
    await tick()
    assert.deepEqual(calls.map((entry) => entry.split(':')[0]), ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'])
    assert.equal(maximumActive, 3)

    deferredById.get('d.png')!.resolve(upload('123e4567-e89b-42d3-a456-426614174004'))
    deferredById.get('e.png')!.resolve(upload('123e4567-e89b-42d3-a456-426614174005'))
    await Promise.all(promises)
    assert.equal(coordinator.hasBlockingUploads, false)
    assert.deepEqual(coordinator.getState().map((entry) => entry.status), [
      'success', 'success', 'success', 'success', 'success',
    ])
  })

  it('reports progress and keeps failed records blocking until a retry succeeds or the record is removed', async () => {
    let attempts = 0
    const progress: number[] = []
    const coordinator = makeCoordinator(async (_file, _session, onProgress) => {
      attempts += 1
      onProgress(12)
      onProgress(100)
      if (attempts === 1) throw new Error('temporary failure')
      return upload(IMAGE_A)
    })

    await assert.rejects(
      coordinator.upload('upload-a', file('a.png'), (percent) => progress.push(percent)),
      /temporary failure/,
    )
    assert.deepEqual(progress, [12, 100])
    assert.equal(coordinator.hasBlockingUploads, true)
    assert.equal(coordinator.getState()[0].status, 'failed')

    await coordinator.upload('upload-a', file('a.png'), () => undefined)
    assert.equal(coordinator.getState()[0].status, 'success')
    assert.equal(coordinator.hasBlockingUploads, false)
    assert.equal(attempts, 2)

    await coordinator.remove('upload-a', IMAGE_A)
    assert.deepEqual(coordinator.getState(), [])
  })

  it('removes a failed local record without network I/O', async () => {
    let deletes = 0
    const coordinator = makeCoordinator(
      async () => { throw new Error('failed') },
      async () => { deletes += 1 },
    )
    await assert.rejects(coordinator.upload('upload-a', file('a.png'), () => undefined))
    await coordinator.remove('upload-a')
    assert.equal(deletes, 0)
    assert.equal(coordinator.hasBlockingUploads, false)
  })

  it('deletes a successful local draft before removing it', async () => {
    const deleteDeferred = deferred<void>()
    const deleteCalls: string[] = []
    const coordinator = makeCoordinator(
      async () => upload(IMAGE_A),
      async (imageId, session) => {
        deleteCalls.push(`${imageId}:${session}`)
        await deleteDeferred.promise
      },
    )
    await coordinator.upload('upload-a', file('a.png'), () => undefined)

    const removePromise = coordinator.remove('upload-a', IMAGE_A)
    await tick()
    assert.deepEqual(coordinator.getState().map((entry) => entry.status), ['success'])
    assert.deepEqual(deleteCalls, [`${IMAGE_A}:${SESSION}`])

    deleteDeferred.resolve()
    await removePromise
    assert.deepEqual(coordinator.getState(), [])
  })

  it('fences reset against in-flight uploads and deletes drafts that finish after reset begins', async () => {
    const uploadB = deferred<InlineImageUpload>()
    const deleteA = deferred<void>()
    const deleteCalls: string[] = []
    const coordinator = makeCoordinator(
      async (candidate) => {
        if (candidate.name === 'a.png') return upload(IMAGE_A)
        if (candidate.name === 'b.png') return uploadB.promise
        throw new Error('unexpected upload')
      },
      async (imageId) => {
        deleteCalls.push(imageId)
        if (imageId === IMAGE_A) await deleteA.promise
      },
    )
    await coordinator.upload('upload-a', file('a.png'), () => undefined)
    const uploadBPromise = coordinator.upload('upload-b', file('b.png'), () => undefined)

    const resetPromise = coordinator.reset()
    await tick()
    assert.equal(deleteCalls.length, 0)
    assert.deepEqual(coordinator.getState().map((entry) => entry.status), ['success', 'uploading'])
    await assert.rejects(
      coordinator.upload('upload-c', file('c.png'), () => undefined),
      /resetting/,
    )

    uploadB.resolve(upload(IMAGE_B))
    await uploadBPromise
    await tick()
    assert.deepEqual(coordinator.getState().map((entry) => entry.status), ['success', 'success'])

    deleteA.resolve()
    await resetPromise
    assert.deepEqual(deleteCalls.sort(), [IMAGE_A, IMAGE_B].sort())
    assert.deepEqual(coordinator.getState(), [])
  })

  it('waits for every staged draft deletion during reset and retains state when one deletion fails', async () => {
    const deleteCalls: string[] = []
    const pending = new Map<string, Deferred<void>>()
    let failImageB = true
    const coordinator = makeCoordinator(
      async (candidate) => candidate.name === 'a.png' ? upload(IMAGE_A) : upload(IMAGE_B),
      async (imageId) => {
        deleteCalls.push(imageId)
        if (imageId === IMAGE_B && failImageB) {
          failImageB = false
          throw new Error('delete failed')
        }
        const result = deferred<void>()
        pending.set(imageId, result)
        await result.promise
      },
    )
    await coordinator.upload('upload-a', file('a.png'), () => undefined)
    await coordinator.upload('upload-b', file('b.png'), () => undefined)

    const resetPromise = coordinator.reset()
    await tick()
    assert.deepEqual(deleteCalls.sort(), [IMAGE_A, IMAGE_B].sort())
    assert.equal(coordinator.getState().length, 2)

    pending.get(IMAGE_A)!.resolve()
    await assert.rejects(resetPromise, /delete failed/)
    assert.equal(coordinator.getState().length, 2)

    // A failed cleanup remains retryable through the same coordinator state;
    // the successful first attempt is safe to retry as a 404 in production.
    const retryPromise = coordinator.reset()
    await tick()
    assert.deepEqual(deleteCalls.sort(), [IMAGE_A, IMAGE_A, IMAGE_B, IMAGE_B].sort())
    pending.get(IMAGE_A)!.resolve()
    pending.get(IMAGE_B)!.resolve()
    await retryPromise
    assert.equal(coordinator.getState().length, 0)
  })

  it('clears synchronously without issuing DELETE requests', async () => {
    let deletes = 0
    const coordinator = makeCoordinator(
      async () => upload(IMAGE_A),
      async () => { deletes += 1 },
    )
    await coordinator.upload('upload-a', file('a.png'), () => undefined)
    const previousSession = coordinator.uploadSessionId
    coordinator.clear()
    assert.deepEqual(coordinator.getState(), [])
    assert.equal(deletes, 0)
    assert.notEqual(coordinator.uploadSessionId, previousSession)
  })

  it('runs best-effort staged cleanup on dispose without rejecting the caller', async () => {
    let deletes = 0
    const coordinator = makeCoordinator(
      async () => upload(IMAGE_A),
      async () => {
        deletes += 1
        throw new Error('cleanup unavailable')
      },
    )
    await coordinator.upload('upload-a', file('a.png'), () => undefined)
    coordinator.dispose()
    await tick()
    assert.equal(deletes, 1)
  })
})

describe('inline image XHR transport', () => {
  it('sends multipart data, forwards computable progress, and resolves public metadata', async () => {
    const originalXHR = globalThis.XMLHttpRequest
    const events: string[] = []
    class FakeXHR {
      status = 201
      responseText = JSON.stringify(upload(IMAGE_A))
      upload = {
        onprogress: (_event: ProgressEvent) => undefined,
      }
      onerror: (() => void) | null = null
      onload: (() => void) | null = null
      open(method: string, url: string) { events.push(`${method}:${url}`) }
      send(data: FormData) {
        events.push(`${data.get('file') instanceof File}:${data.get('uploadSessionId')}`)
        this.upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 } as ProgressEvent)
        this.onload?.()
      }
    }
    // @ts-expect-error test double for the browser-only API
    globalThis.XMLHttpRequest = FakeXHR
    try {
      const progress: number[] = []
      const result = await uploadInlineImage(file('a.png'), SESSION, (percent) => progress.push(percent))
      assert.deepEqual(events, ['POST:/api/inline-images', `true:${SESSION}`])
      assert.deepEqual(progress, [25])
      assert.deepEqual(result, upload(IMAGE_A))
    } finally {
      globalThis.XMLHttpRequest = originalXHR
    }
  })
})

describe('inline image DELETE transport', () => {
  it('sends the upload session and treats a missing draft as already cleaned', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init })
      return { ok: false, status: 404 } as Response
    }
    try {
      await deleteInlineImage(IMAGE_A, SESSION)
      assert.equal(requests.length, 1)
      assert.equal(requests[0].url, `/api/inline-images/${IMAGE_A}`)
      assert.equal(requests[0].init?.method, 'DELETE')
      assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { uploadSessionId: SESSION })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('surfaces authorization and server deletion failures', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    } as Response)
    try {
      await assert.rejects(() => deleteInlineImage(IMAGE_A, SESSION), /Forbidden/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
