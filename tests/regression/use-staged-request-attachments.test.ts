import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_ATTACHMENTS_PER_FORM } from '../../src/lib/attachments/policy'
import {
  canRetryStagedUpload,
  createStagedRequestAttachmentsController,
  deleteOrKeepStagedItem,
  deleteStagedAttachment,
  enqueueStagedFiles,
  isBlockingStagedItem,
  isReadyAttachment,
  isStagedUploadResult,
  reserveStagedAttachment,
  uploadStagedAttachment,
  type StagedReservationResult,
  type StagedAttachmentTransports,
  type StagedItem,
  type StagedUploadResult,
} from '../../src/hooks/use-staged-request-attachments'

const hookSource = readFileSync('src/hooks/use-staged-request-attachments.ts', 'utf8')

const ATTACHMENT_ID = '123e4567-e89b-42d3-a456-426614174000'
const UPLOAD_TOKEN = '6f1d2c3b-4a59-4e70-8b1c-2d3e4f5a6b7c'
const file = (name = 'a.pdf', type = 'application/pdf', contents = 'pdf') =>
  new File([contents], name, { type })

const stagedResult = {
  attachmentId: ATTACHMENT_ID,
  fileName: 'a.pdf',
  fileType: 'application/pdf',
  fileSize: 3,
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('useStagedRequestAttachments source contract', () => {
  it('exports the hook/controller with items, XHR controls, readyAttachmentIds, and distinct reset/clear', () => {
    assert.match(hookSource, /export function useStagedRequestAttachments/)
    assert.match(hookSource, /export function createStagedRequestAttachmentsController/)
    assert.match(hookSource, /readyAttachmentIds: string\[\]/)
    assert.match(hookSource, /StagedItemStatus = 'pending' \| 'uploading' \| 'success' \| 'error'/)
    assert.match(hookSource, /MAX_ATTACHMENTS_PER_FORM/)
  })

  it('does not import createRequest staged metadata types', () => {
    assert.doesNotMatch(hookSource, /StagedAttachmentInput/)
    assert.doesNotMatch(hookSource, /from '@\/server-actions\/requests'/)
  })

  it('reserves with PUT JSON then uploads via XMLHttpRequest POST FormData {file, attachmentId}', () => {
    assert.match(hookSource, /method: 'PUT'/)
    assert.match(hookSource, /fileName: file\.name/)
    assert.match(hookSource, /fileType: file\.type/)
    assert.match(hookSource, /fileSize: file\.size/)
    assert.match(hookSource, /new XMLHttpRequest\(\)/)
    assert.match(hookSource, /xhr\.open\('POST', STAGE_URL\)/)
    assert.match(hookSource, /STAGE_URL = '\/api\/attachments\/stage'/)
    assert.match(hookSource, /data\.append\('file', file\)/)
    assert.match(hookSource, /data\.append\('attachmentId', attachmentId\)/)
    assert.match(hookSource, /data\.append\('uploadToken', uploadToken\)/)
    assert.match(hookSource, /transports\.reserve\(file, id\)/)
    assert.match(hookSource, /transports\.upload\(file, id/)
  })

  it('wires real progress exclusively from xhr.upload.onprogress loaded/total', () => {
    assert.match(hookSource, /xhr\.upload\.onprogress = \(event\) => \{/)
    assert.match(hookSource, /event\.lengthComputable/)
    assert.match(hookSource, /event\.total <= 0/)
    assert.match(hookSource, /Math\.round\(\(event\.loaded \/ event\.total\) \* 100\)/)
    const onloadSlice = hookSource.slice(hookSource.indexOf('xhr.onload'))
    const onloadBody = onloadSlice.slice(0, onloadSlice.indexOf('const data = new FormData'))
    assert.doesNotMatch(onloadBody, /onProgress\?/)
    assert.doesNotMatch(onloadBody, /progress:\s*100/)
  })

  it('allows empty MIME strings so CAD uploads remain ready', () => {
    const resultGuard = hookSource.slice(hookSource.indexOf('export function isStagedUploadResult'))
    const resultBody = resultGuard.slice(0, resultGuard.indexOf('function createAttempt'))
    assert.match(resultBody, /typeof value\.fileType === 'string'/)
    assert.doesNotMatch(resultBody, /value\.fileType\.length > 0/)
    assert.match(hookSource, /item\.cleanupRequested !== true/)
  })
})

describe('empty-MIME CAD staging result', () => {
  it('accepts a successful DWG response when fileType is an empty string', () => {
    const cad = {
      attachmentId: ATTACHMENT_ID,
      fileName: 'part.dwg',
      fileType: '',
      fileSize: 5,
    }
    assert.equal(isStagedUploadResult(cad), true)
    assert.equal(isStagedUploadResult({ ...cad, fileType: undefined }), false)
    assert.equal(isStagedUploadResult({ ...cad, attachmentId: '' }), false)
  })
})

describe('batched staged additions', () => {
  it('makes new Files visible on the ref before any React state flush', () => {
    const itemsRef = { current: [] as StagedItem[] }
    const files = [file('a.pdf'), file('part.dwg', '')]
    const added = enqueueStagedFiles(itemsRef, files)

    assert.equal(added.length, 2)
    assert.equal(itemsRef.current.length, 2)
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    for (const [index, item] of added.entries()) {
      const found = itemsRef.current.find((entry) => entry.id === item.id)
      assert.equal(found?.file, files[index])
      assert.equal(found?.status, 'pending')
      assert.match(item.id, uuidRe)
    }
    assert.notEqual(added[0]?.id, added[1]?.id)
  })

  it('enforces MAX_ATTACHMENTS_PER_FORM and drops extras', () => {
    const itemsRef = { current: [] as StagedItem[] }
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_FORM + 3 }, (_, index) => file(`f${index}.pdf`))
    const added = enqueueStagedFiles(itemsRef, files)
    assert.equal(added.length, MAX_ATTACHMENTS_PER_FORM)
    assert.equal(itemsRef.current.length, MAX_ATTACHMENTS_PER_FORM)
    const more = enqueueStagedFiles(itemsRef, [file('overflow.pdf')])
    assert.equal(more.length, 0)
    assert.equal(itemsRef.current.length, MAX_ATTACHMENTS_PER_FORM)
  })
})

describe('uploadStagedAttachment XHR transport', () => {
  it('sends multipart data and forwards only computable loaded/total progress', async () => {
    const originalXHR = globalThis.XMLHttpRequest
    const events: string[] = []
    class FakeXHR {
      status = 200
      responseText = JSON.stringify(stagedResult)
      upload = {
        onprogress: (_event: ProgressEvent) => undefined,
      }
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      onload: (() => void) | null = null
      open(method: string, url: string) {
        events.push(`${method}:${url}`)
      }
      send(data: FormData) {
        events.push(data.get('file') instanceof File ? 'file' : 'missing')
        events.push(`attachmentId:${String(data.get('attachmentId'))}`)
        events.push(`uploadToken:${String(data.get('uploadToken'))}`)
        this.upload.onprogress({ lengthComputable: false, loaded: 50, total: 100 } as ProgressEvent)
        this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 0 } as ProgressEvent)
        this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 3 } as ProgressEvent)
        this.onload?.()
      }
      abort() {
        this.onabort?.()
      }
    }
    // @ts-expect-error test double for the browser-only API
    globalThis.XMLHttpRequest = FakeXHR
    try {
      const progress: number[] = []
      const result = await uploadStagedAttachment(file(), ATTACHMENT_ID, UPLOAD_TOKEN, {
        onProgress: (percent) => progress.push(percent),
      })
      assert.deepEqual(events, ['POST:/api/attachments/stage', 'file', `attachmentId:${ATTACHMENT_ID}`, `uploadToken:${UPLOAD_TOKEN}`])
      assert.deepEqual(progress, [33])
      assert.deepEqual(result, stagedResult)
    } finally {
      globalThis.XMLHttpRequest = originalXHR
    }
  })

  it('accepts a successful CAD upload with empty MIME type', async () => {
    const originalXHR = globalThis.XMLHttpRequest
    const cadResult = {
      attachmentId: ATTACHMENT_ID,
      fileName: 'part.dwg',
      fileType: '',
      fileSize: 5,
    }
    class FakeXHR {
      status = 200
      responseText = JSON.stringify(cadResult)
      upload = { onprogress: (_event: ProgressEvent) => undefined }
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      onload: (() => void) | null = null
      open() {}
      send(data: FormData) {
        assert.equal(data.get('attachmentId'), ATTACHMENT_ID)
        assert.equal(data.get('uploadToken'), UPLOAD_TOKEN)
        this.onload?.()
      }
      abort() {}
    }
    // @ts-expect-error test double for the browser-only API
    globalThis.XMLHttpRequest = FakeXHR
    try {
      const result = await uploadStagedAttachment(file('part.dwg', ''), ATTACHMENT_ID, UPLOAD_TOKEN)
      assert.deepEqual(result, cadResult)
    } finally {
      globalThis.XMLHttpRequest = originalXHR
    }
  })

  it('does not fabricate progress on success when onprogress never fired', async () => {
    const originalXHR = globalThis.XMLHttpRequest
    class FakeXHR {
      status = 200
      responseText = JSON.stringify(stagedResult)
      upload = { onprogress: (_event: ProgressEvent) => undefined }
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      onload: (() => void) | null = null
      open() {}
      send() {
        this.onload?.()
      }
      abort() {}
    }
    // @ts-expect-error test double for the browser-only API
    globalThis.XMLHttpRequest = FakeXHR
    try {
      const progress: number[] = []
      await uploadStagedAttachment(file(), ATTACHMENT_ID, UPLOAD_TOKEN, {
        onProgress: (percent) => progress.push(percent),
      })
      assert.deepEqual(progress, [])
    } finally {
      globalThis.XMLHttpRequest = originalXHR
    }
  })

  it('rejects non-2xx responses with the server error and aborted uploads', async () => {
    const originalXHR = globalThis.XMLHttpRequest
    class ErrorXHR {
      status = 400
      responseText = JSON.stringify({ error: 'File type not supported' })
      upload = { onprogress: (_event: ProgressEvent) => undefined }
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      onload: (() => void) | null = null
      open() {}
      send() {
        this.onload?.()
      }
      abort() {}
    }
    class AbortXHR {
      status = 0
      responseText = ''
      upload = { onprogress: (_event: ProgressEvent) => undefined }
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      onload: (() => void) | null = null
      open() {}
      send() {}
      abort() {
        this.onabort?.()
      }
    }
    try {
      // @ts-expect-error test double for the browser-only API
      globalThis.XMLHttpRequest = ErrorXHR
      await assert.rejects(
        () => uploadStagedAttachment(file(), ATTACHMENT_ID, UPLOAD_TOKEN),
        /File type not supported/,
      )

      // @ts-expect-error test double for the browser-only API
      globalThis.XMLHttpRequest = AbortXHR
      let abortUpload: (() => void) | undefined
      const pending = uploadStagedAttachment(file(), ATTACHMENT_ID, UPLOAD_TOKEN, {
        xhrRef(xhr) {
          abortUpload = () => xhr.abort()
        },
      })
      abortUpload?.()
      await assert.rejects(() => pending, /Attachment upload aborted/)
    } finally {
      globalThis.XMLHttpRequest = originalXHR
    }
  })
})

describe('reserveStagedAttachment transport', () => {
  it('PUTs JSON attachmentId and file metadata', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init })
      return {
        ok: true,
        status: 200,
        json: async () => ({ attachmentId: ATTACHMENT_ID, uploadToken: UPLOAD_TOKEN, alreadyReady: false }),
      } as Response
    }
    try {
      const pdf = file()
      const reserved = await reserveStagedAttachment(pdf, ATTACHMENT_ID)
      assert.equal(reserved.uploadToken, UPLOAD_TOKEN)
      assert.equal(reserved.alreadyReady, false)
      assert.equal(requests.length, 1)
      assert.equal(requests[0]?.url, '/api/attachments/stage')
      assert.equal(requests[0]?.init?.method, 'PUT')
      assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
        attachmentId: ATTACHMENT_ID,
        fileName: pdf.name,
        fileType: pdf.type,
        fileSize: pdf.size,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('deleteStagedAttachment transport', () => {
  it('DELETEs JSON {attachmentId} and does not treat 404 as already cleaned', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init })
      return { ok: false, status: 404, json: async () => ({ error: 'Attachment not found' }) } as Response
    }
    try {
      await assert.rejects(() => deleteStagedAttachment(ATTACHMENT_ID), /Attachment not found/)
      assert.equal(requests.length, 1)
      assert.equal(requests[0]?.url, '/api/attachments/stage')
      assert.equal(requests[0]?.init?.method, 'DELETE')
      assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
        attachmentId: ATTACHMENT_ID,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('keeps the item and attachmentId when DELETE returns 500', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Failed to delete staged file' }),
    } as Response)
    try {
      const [item] = enqueueStagedFiles({ current: [] }, [file()])
      const successItem: StagedItem = {
        ...item!,
        status: 'success',
        attachmentId: item!.id,
        fileName: 'a.pdf',
        fileType: 'application/pdf',
        fileSize: 3,
      }
      const result = await deleteOrKeepStagedItem(successItem)
      assert.equal(result.drop, false)
      if (result.drop) throw new Error('expected keep')
      assert.equal(result.item.id, successItem.id)
      assert.equal(result.item.attachmentId, successItem.attachmentId)
      assert.equal(result.item.cleanupRequested, true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('cleanup-requested state', () => {
  function readyItem(overrides: Partial<StagedItem> = {}): StagedItem {
    const [item] = enqueueStagedFiles({ current: [] }, [file()])
    return {
      ...item!,
      status: 'success',
      attachmentId: item!.id,
      fileName: 'a.pdf',
      fileType: 'application/pdf',
      fileSize: 3,
      ...overrides,
    }
  }

  it('excludes pending cleanup from readyAttachmentIds and blocks submission', () => {
    const pendingCleanup = readyItem({ cleanupRequested: true })
    assert.equal(isReadyAttachment(pendingCleanup), false)
    assert.equal(isBlockingStagedItem(pendingCleanup), true)
    assert.equal(canRetryStagedUpload(pendingCleanup), false)
    assert.equal(isReadyAttachment(readyItem()), true)
    assert.equal(isBlockingStagedItem(readyItem()), false)
    assert.equal(isBlockingStagedItem(readyItem({ status: 'error', attachmentId: undefined })), true)
    assert.equal(canRetryStagedUpload(readyItem({ status: 'error', attachmentId: undefined })), true)
  })
})

describe('staged request attachment controller lifecycle', () => {
  async function waitFor(predicate: () => boolean) {
    for (let i = 0; i < 50; i++) {
      if (predicate()) return
      await Promise.resolve()
    }
    throw new Error('timed out waiting for transport gate')
  }

  function createHarness() {
    const reserves: string[] = []
    const uploads: string[] = []
    const deletes: string[] = []
    const reserveGates = new Map<string, Array<ReturnType<typeof deferred<StagedReservationResult>>>>()
    const uploadGates = new Map<string, Array<ReturnType<typeof deferred<StagedUploadResult>>>>()
    let deleteImpl: (id: string) => Promise<void> = async (id) => {
      deletes.push(id)
    }

    function enqueue<T>(map: Map<string, Array<ReturnType<typeof deferred<T>>>>, id: string) {
      const gate = deferred<T>()
      const queue = map.get(id) ?? []
      queue.push(gate)
      map.set(id, queue)
      return gate
    }

    const transports: StagedAttachmentTransports = {
      async reserve(nextFile, attachmentId) {
        reserves.push(attachmentId)
        const gate = enqueue(reserveGates, attachmentId)
        void nextFile
        return gate.promise
      },
      async upload(nextFile, attachmentId, uploadToken, handlers) {
        uploads.push(`${attachmentId}:${uploadToken}`)
        const xhr = { abort() {} } as XMLHttpRequest
        handlers?.xhrRef?.(xhr)
        const gate = enqueue(uploadGates, attachmentId)
        void nextFile
        return gate.promise
      },
      async remove(attachmentId) {
        await deleteImpl(attachmentId)
      },
    }

    const controller = createStagedRequestAttachmentsController(transports)
    return {
      controller,
      reserves,
      uploads,
      deletes,
      async releaseReserve(id: string, result?: Partial<StagedReservationResult>) {
        await waitFor(() => (reserveGates.get(id)?.length ?? 0) > 0)
        reserveGates.get(id)!.shift()!.resolve({
          attachmentId: id,
          uploadToken: UPLOAD_TOKEN,
          alreadyReady: false,
          ...result,
        })
        await flush()
      },
      async failReserve(id: string, error: Error) {
        await waitFor(() => (reserveGates.get(id)?.length ?? 0) > 0)
        reserveGates.get(id)!.shift()!.reject(error)
        await flush()
      },
      async releaseUpload(id: string, result?: Partial<StagedUploadResult>) {
        await waitFor(() => (uploadGates.get(id)?.length ?? 0) > 0)
        uploadGates.get(id)!.shift()!.resolve({
          attachmentId: id,
          fileName: 'a.pdf',
          fileType: 'application/pdf',
          fileSize: 3,
          ...result,
        })
        await flush()
      },
      async failUpload(id: string, error: Error) {
        await waitFor(() => (uploadGates.get(id)?.length ?? 0) > 0)
        uploadGates.get(id)!.shift()!.reject(error)
        await flush()
      },
      setDeleteImpl(next: (id: string) => Promise<void>) {
        deleteImpl = next
      },
    }
  }

  it('reserves before XHR and stores server metadata on success', async () => {
    const harness = createHarness()
    harness.controller.addFiles([file()])
    const id = harness.controller.snapshot().items[0]?.id
    assert.ok(id)
    assert.equal(harness.controller.snapshot().items[0]?.status, 'uploading')
    assert.deepEqual(harness.uploads, [])
    await harness.releaseReserve(id)
    assert.deepEqual(harness.reserves, [id])
    assert.deepEqual(harness.uploads, [`${id}:${UPLOAD_TOKEN}`])
    await harness.releaseUpload(id)
    const snap = harness.controller.snapshot()
    assert.equal(snap.items[0]?.status, 'success')
    assert.equal(snap.items[0]?.attachmentId, id)
    assert.deepEqual(snap.readyAttachmentIds, [id])
    assert.equal(snap.hasBlockingOperations, false)
  })

  it('immediate remove after add DELETEs the reservation and never sends XHR', async () => {
    const harness = createHarness()
    harness.controller.addFiles([file()])
    const id = harness.controller.snapshot().items[0]?.id
    assert.ok(id)
    harness.controller.removeItem(id)
    assert.equal(harness.controller.snapshot().items[0]?.cleanupRequested, true)
    assert.deepEqual(harness.deletes, [])
    await harness.releaseReserve(id)
    assert.deepEqual(harness.uploads, [])
    assert.deepEqual(harness.deletes, [id])
    assert.equal(harness.controller.snapshot().items.length, 0)
  })

  it('reset keeps a failed cleanup item and retry DELETE drops it without re-upload', async () => {
    const harness = createHarness()
    harness.controller.addFiles([file('a.pdf'), file('b.pdf')])
    const [first, second] = harness.controller.snapshot().items
    assert.ok(first && second)
    await harness.releaseReserve(first.id)
    await harness.releaseUpload(first.id)
    await harness.releaseReserve(second.id)
    await harness.releaseUpload(second.id)
    assert.equal(harness.controller.snapshot().readyAttachmentIds.length, 2)

    let deletes = 0
    harness.setDeleteImpl(async (id) => {
      deletes += 1
      harness.deletes.push(id)
      if (id === second.id && deletes <= 2) {
        throw new Error('Failed to delete staged file')
      }
    })

    await assert.rejects(() => harness.controller.reset(), /Failed to delete staged file/)
    const afterReset = harness.controller.snapshot()
    assert.equal(afterReset.items.length, 1)
    assert.equal(afterReset.items[0]?.id, second.id)
    assert.equal(afterReset.items[0]?.cleanupRequested, true)
    assert.equal(afterReset.hasBlockingOperations, true)
    assert.deepEqual(afterReset.readyAttachmentIds, [])
    assert.equal(harness.uploads.length, 2)

    harness.controller.retryItem(second.id)
    await flush()
    assert.equal(harness.controller.snapshot().items.length, 0)
    assert.equal(harness.uploads.length, 2)
  })

  it('ignores stale success and DELETEs the abandoned attachmentId', async () => {
    const harness = createHarness()
    harness.controller.addFiles([file()])
    const id = harness.controller.snapshot().items[0]?.id
    assert.ok(id)
    await harness.releaseReserve(id)
    harness.controller.removeItem(id)
    await harness.releaseUpload(id)
    await Promise.resolve()
    assert.ok(harness.deletes.includes(id))
    assert.equal(harness.controller.snapshot().items.some((item) => item.status === 'success'), false)
  })

  it('clear then unmount does not DELETE; unmount without clear does', async () => {
    const cleared = createHarness()
    cleared.controller.addFiles([file()])
    const clearedId = cleared.controller.snapshot().items[0]?.id
    assert.ok(clearedId)
    await cleared.releaseReserve(clearedId)
    await cleared.releaseUpload(clearedId)
    cleared.controller.clear()
    assert.equal(cleared.controller.snapshot().items.length, 0)
    const deletesAfterClear = cleared.deletes.length
    cleared.controller.unmount()
    assert.equal(cleared.deletes.length, deletesAfterClear)

    const hanging = createHarness()
    hanging.controller.addFiles([file()])
    const hangingId = hanging.controller.snapshot().items[0]?.id
    assert.ok(hangingId)
    await hanging.releaseReserve(hangingId)
    await hanging.releaseUpload(hangingId)
    hanging.controller.unmount()
    assert.deepEqual(hanging.deletes, [hangingId])
  })

  it('repeated retry reuses the same attachmentId and does not re-upload cleanup-requested items', async () => {
    const harness = createHarness()
    harness.controller.addFiles([file()])
    const id = harness.controller.snapshot().items[0]?.id
    assert.ok(id)
    await harness.releaseReserve(id)
    await harness.failUpload(id, new Error('Attachment upload failed'))
    assert.equal(harness.controller.snapshot().items[0]?.status, 'error')

    harness.controller.retryItem(id)
    await harness.releaseReserve(id)
    await harness.releaseUpload(id)
    assert.deepEqual(harness.reserves, [id, id])
    assert.deepEqual(harness.uploads, [`${id}:${UPLOAD_TOKEN}`, `${id}:${UPLOAD_TOKEN}`])
    assert.deepEqual(harness.controller.snapshot().readyAttachmentIds, [id])

    harness.setDeleteImpl(async (attachmentId) => {
      harness.deletes.push(attachmentId)
      throw new Error('Failed to delete staged file')
    })
    harness.controller.removeItem(id)
    await flush()
    assert.equal(harness.controller.snapshot().items[0]?.cleanupRequested, true)
    harness.controller.retryItem(id)
    await flush()
    assert.equal(harness.uploads.length, 2)
    assert.equal(harness.controller.snapshot().items[0]?.id, id)
  })

  it('skips XHR when reservation is alreadyReady', async () => {
    const harness = createHarness()
    harness.controller.addFiles([file()])
    const id = harness.controller.snapshot().items[0]?.id
    assert.ok(id)
    await harness.releaseReserve(id, {
      alreadyReady: true,
      fileName: 'a.pdf',
      fileType: 'application/pdf',
      fileSize: 3,
    })
    assert.deepEqual(harness.uploads, [])
    const snap = harness.controller.snapshot()
    assert.equal(snap.items[0]?.status, 'success')
    assert.deepEqual(snap.readyAttachmentIds, [id])
  })

  it('generic reserve rejection settles the attempt so later remove DELETEs', async () => {
    const harness = createHarness()
    harness.controller.addFiles([file()])
    const id = harness.controller.snapshot().items[0]?.id
    assert.ok(id)
    await harness.failReserve(id, new Error('Attachment reservation failed'))
    const afterFail = harness.controller.snapshot()
    assert.equal(afterFail.items[0]?.status, 'error')
    assert.equal(afterFail.hasBlockingOperations, true)
    assert.deepEqual(harness.deletes, [])

    harness.controller.removeItem(id)
    await flush()
    assert.deepEqual(harness.deletes, [id])
    assert.equal(harness.controller.snapshot().items.length, 0)
    assert.equal(harness.controller.snapshot().hasBlockingOperations, false)
  })

  it('cancelled reserve always settles through DELETE', async () => {
    const harness = createHarness()
    harness.controller.addFiles([file()])
    const id = harness.controller.snapshot().items[0]?.id
    assert.ok(id)
    await harness.failReserve(id, new Error('Attachment was cancelled'))
    assert.deepEqual(harness.uploads, [])
    assert.deepEqual(harness.deletes, [id])
    assert.equal(harness.controller.snapshot().items.length, 0)
  })

  it('enforces MAX_ATTACHMENTS_PER_FORM on addFiles', () => {
    const controller = createStagedRequestAttachmentsController({
      reserve: async (nextFile, attachmentId) => ({
        attachmentId,
        uploadToken: UPLOAD_TOKEN,
        alreadyReady: true,
        fileName: nextFile.name,
        fileType: nextFile.type,
        fileSize: nextFile.size,
      }),
      upload: async () => stagedResult,
      remove: async () => {},
    })
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_FORM + 2 }, (_, index) => file(`n${index}.pdf`))
    controller.addFiles(files)
    assert.equal(controller.snapshot().items.length, MAX_ATTACHMENTS_PER_FORM)
    controller.addFiles([file('overflow.pdf')])
    assert.equal(controller.snapshot().items.length, MAX_ATTACHMENTS_PER_FORM)
  })
})
