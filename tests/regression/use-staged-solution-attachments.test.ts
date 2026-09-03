import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_ATTACHMENTS_PER_FORM } from '../../src/lib/attachments/policy'
import {
  createStagedRequestAttachmentsController,
  type StagedReservationResult,
  type StagedUploadResult,
} from '../../src/hooks/use-staged-request-attachments'
import {
  createSolutionStagedAttachmentTransports,
  deleteSolutionStagedAttachment,
  reserveSolutionStagedAttachment,
  uploadSolutionStagedAttachment,
} from '../../src/hooks/use-staged-solution-attachments'

const hookSource = readFileSync('src/hooks/use-staged-solution-attachments.ts', 'utf8')

const REQUEST_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
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

function sourceSlice(from: string, to: string): string {
  const start = hookSource.indexOf(from)
  assert.ok(start >= 0, `source marker not found: ${from}`)
  const end = to ? hookSource.indexOf(to, start) : hookSource.length
  return hookSource.slice(start, end)
}

describe('useStagedSolutionAttachments source contract', () => {
  it('exports the requestId-bound hook reusing the reviewed request controller', () => {
    assert.match(hookSource, /export function useStagedSolutionAttachments/)
    assert.match(hookSource, /\{ requestId \}: UseStagedSolutionAttachmentsArgs/)
    assert.match(
      hookSource,
      /createStagedRequestAttachmentsController\(\s*createSolutionStagedAttachmentTransports\(requestId\)/,
    )
    assert.match(hookSource, /readyAttachmentIds: snapshot\.readyAttachmentIds/)
  })

  it('sends scope solution plus the target requestId on PUT, POST FormData, and DELETE', () => {
    const reserveSlice = sourceSlice(
      'export async function reserveSolutionStagedAttachment',
      'export function uploadSolutionStagedAttachment',
    )
    assert.match(reserveSlice, /scope: 'solution',/)
    assert.match(reserveSlice, /requestId,/)

    const uploadSlice = sourceSlice(
      'export function uploadSolutionStagedAttachment',
      'export async function deleteSolutionStagedAttachment',
    )
    assert.match(uploadSlice, /data\.append\('scope', 'solution'\)/)
    assert.match(uploadSlice, /data\.append\('requestId', requestId\)/)

    const deleteSlice = sourceSlice(
      'export async function deleteSolutionStagedAttachment',
      '',
    )
    assert.match(deleteSlice, /scope: 'solution',/)
    assert.match(deleteSlice, /requestId,/)
  })

  it('does not re-implement the reviewed lifecycle pieces', () => {
    assert.match(hookSource, /from '@\/hooks\/use-staged-request-attachments'/)
    assert.doesNotMatch(hookSource, /function enqueueStagedFiles/)
    assert.doesNotMatch(hookSource, /function startUpload/)
    assert.doesNotMatch(hookSource, /function deleteOrKeepStagedItem/)
    assert.doesNotMatch(hookSource, /function createStagedRequestAttachmentsController/)
  })

  it('rebinds the controller when the target requestId changes and resets stale snapshot state', () => {
    assert.match(hookSource, /scopeRef\.current\.requestId !== requestId/)
    // Rebind disposal must rely on the committed controller-change effect
    // cleanup, never a render-phase unmount: an unmount fires DELETE fetches,
    // which cannot be rolled back if React discards the render.
    assert.match(hookSource, /useEffect\(\(\) => \(\) => controller\.unmount\(\), \[controller\]\)/)
    assert.doesNotMatch(hookSource, /scopeRef\.current\?\.controller\.unmount\(\)/)
    assert.match(hookSource, /setSnapshot\(controller\.snapshot\(\)\)/)
  })
})

describe('reserveSolutionStagedAttachment transport', () => {
  it('PUTs JSON attachmentId and file metadata bound to scope solution and the target request', async () => {
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
      const reserved = await reserveSolutionStagedAttachment(pdf, ATTACHMENT_ID, REQUEST_ID)
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
        scope: 'solution',
        requestId: REQUEST_ID,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects server errors and malformed reservation bodies', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { attachmentId?: string }
      const status = body.attachmentId === ATTACHMENT_ID ? 400 : 200
      return {
        ok: status < 400,
        status,
        json: async () => (status >= 400 ? { error: 'Invalid requestId' } : {}),
      } as Response
    }
    try {
      await assert.rejects(
        () => reserveSolutionStagedAttachment(file(), ATTACHMENT_ID, REQUEST_ID),
        /Invalid requestId/,
      )
      await assert.rejects(
        () => reserveSolutionStagedAttachment(file(), 'not-a-uuid', REQUEST_ID),
        /Attachment reservation failed/,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('uploadSolutionStagedAttachment XHR transport', () => {
  it('POSTs FormData with scope fields and forwards only computable loaded/total progress', async () => {
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
        events.push(`scope:${String(data.get('scope'))}`)
        events.push(`requestId:${String(data.get('requestId'))}`)
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
      const result = await uploadSolutionStagedAttachment(file(), ATTACHMENT_ID, UPLOAD_TOKEN, REQUEST_ID, {
        onProgress: (percent) => progress.push(percent),
      })
      assert.deepEqual(events, [
        'POST:/api/attachments/stage',
        'file',
        `attachmentId:${ATTACHMENT_ID}`,
        `uploadToken:${UPLOAD_TOKEN}`,
        'scope:solution',
        `requestId:${REQUEST_ID}`,
      ])
      assert.deepEqual(progress, [33])
      assert.deepEqual(result, stagedResult)
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
      await uploadSolutionStagedAttachment(file(), ATTACHMENT_ID, UPLOAD_TOKEN, REQUEST_ID, {
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
      status = 409
      responseText = JSON.stringify({ error: 'Upload was superseded' })
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
        () => uploadSolutionStagedAttachment(file(), ATTACHMENT_ID, UPLOAD_TOKEN, REQUEST_ID),
        /Upload was superseded/,
      )

      // @ts-expect-error test double for the browser-only API
      globalThis.XMLHttpRequest = AbortXHR
      let abortUpload: (() => void) | undefined
      const pending = uploadSolutionStagedAttachment(file(), ATTACHMENT_ID, UPLOAD_TOKEN, REQUEST_ID, {
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

describe('deleteSolutionStagedAttachment transport', () => {
  it('DELETEs JSON {attachmentId, scope, requestId} and does not treat failures as cleaned', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init })
      return { ok: false, status: 404, json: async () => ({ error: 'Attachment not found' }) } as Response
    }
    try {
      await assert.rejects(() => deleteSolutionStagedAttachment(ATTACHMENT_ID, REQUEST_ID), /Attachment not found/)
      assert.equal(requests.length, 1)
      assert.equal(requests[0]?.url, '/api/attachments/stage')
      assert.equal(requests[0]?.init?.method, 'DELETE')
      assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
        attachmentId: ATTACHMENT_ID,
        scope: 'solution',
        requestId: REQUEST_ID,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('staged solution attachment controller lifecycle', () => {
  type WireBody = Record<string, unknown>

  async function waitFor(predicate: () => boolean) {
    for (let i = 0; i < 50; i++) {
      if (predicate()) return
      await Promise.resolve()
    }
    throw new Error('timed out waiting for transport gate')
  }

  /**
   * Drives the reviewed controller through the real solution transports:
   * global fetch/XHR are replaced with gated fakes so each lifecycle test can
   * release or fail the actual PUT/POST/DELETE wire calls, asserting the
   * solution-scope payloads end to end.
   */
  function createHarness() {
    const puts: WireBody[] = []
    const posts: WireBody[] = []
    const deletes: WireBody[] = []
    const putGates = new Map<string, Array<ReturnType<typeof deferred<Response>>>>()
    const postXhrs = new Map<string, Array<FakeStagedXHR>>()
    let deleteImpl: (attachmentId: string) => Promise<void> = async () => {}

    const originalFetch = globalThis.fetch
    const originalXHR = globalThis.XMLHttpRequest

    const response = (status: number, body: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

    class FakeStagedXHR {
      status = 200
      responseText = ''
      upload = { onprogress: (_event: ProgressEvent) => undefined }
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      onload: (() => void) | null = null
      aborted = false
      fields: WireBody = {}
      open(method: string, url: string) {
        if (method !== 'POST' || url !== '/api/attachments/stage') {
          throw new Error(`unexpected XHR ${method} ${url}`)
        }
      }
      send(data: FormData) {
        this.fields = {
          file: data.get('file'),
          attachmentId: data.get('attachmentId'),
          uploadToken: data.get('uploadToken'),
          scope: data.get('scope'),
          requestId: data.get('requestId'),
        }
        posts.push(this.fields)
        const id = String(this.fields.attachmentId)
        const queue = postXhrs.get(id) ?? []
        queue.push(this)
        postXhrs.set(id, queue)
      }
      abort() {
        this.aborted = true
        this.onabort?.()
      }
    }

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (String(input) !== '/api/attachments/stage') {
        throw new Error(`unexpected fetch url ${String(input)}`)
      }
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as WireBody
        puts.push(body)
        const gate = deferred<Response>()
        const id = String(body.attachmentId)
        const queue = putGates.get(id) ?? []
        queue.push(gate)
        putGates.set(id, queue)
        return gate.promise
      }
      if (method === 'DELETE') {
        const body = JSON.parse(String(init?.body ?? '{}')) as WireBody
        deletes.push(body)
        try {
          await deleteImpl(String(body.attachmentId))
          return response(200, { success: true })
        } catch (error) {
          return response(500, {
            error: error instanceof Error && error.message ? error.message : 'Failed to delete staged file',
          })
        }
      }
      throw new Error(`unexpected fetch method ${method}`)
    }) as typeof fetch
    // @ts-expect-error test double for the browser-only API
    globalThis.XMLHttpRequest = FakeStagedXHR

    const controller = createStagedRequestAttachmentsController(
      createSolutionStagedAttachmentTransports(REQUEST_ID),
    )

    async function releasePut(id: string, result: Partial<StagedReservationResult> = {}) {
      await waitFor(() => (putGates.get(id)?.length ?? 0) > 0)
      const gate = putGates.get(id)!.shift()!
      gate.resolve(response(200, {
        attachmentId: id,
        uploadToken: UPLOAD_TOKEN,
        alreadyReady: false,
        ...result,
      }))
      await flush()
    }

    async function failPut(id: string, status: number, errorBody: { error: string }) {
      await waitFor(() => (putGates.get(id)?.length ?? 0) > 0)
      const gate = putGates.get(id)!.shift()!
      gate.resolve(response(status, errorBody))
      await flush()
    }

    async function peekPost(id: string) {
      await waitFor(() => (postXhrs.get(id)?.length ?? 0) > 0)
      return postXhrs.get(id)![0]!
    }

    function shiftPost(id: string) {
      postXhrs.get(id)?.shift()
    }

    async function succeedPost(id: string, result: Partial<StagedUploadResult> = {}) {
      const xhr = await peekPost(id)
      shiftPost(id)
      xhr.status = 200
      xhr.responseText = JSON.stringify({
        attachmentId: id,
        fileName: 'a.pdf',
        fileType: 'application/pdf',
        fileSize: 3,
        ...result,
      })
      xhr.onload?.()
      await flush()
    }

    async function failPost(id: string, status: number, errorBody: { error: string }) {
      const xhr = await peekPost(id)
      shiftPost(id)
      xhr.status = status
      xhr.responseText = JSON.stringify(errorBody)
      xhr.onload?.()
      await flush()
    }

    return {
      controller,
      puts,
      posts,
      deletes,
      releasePut,
      failPut,
      peekPost,
      succeedPost,
      failPost,
      setDeleteImpl(next: (attachmentId: string) => Promise<void>) {
        deleteImpl = next
      },
      restore() {
        globalThis.fetch = originalFetch
        globalThis.XMLHttpRequest = originalXHR
      },
    }
  }

  it('reserves with scope solution before XHR and stores server metadata on success', async () => {
    const h = createHarness()
    try {
      h.controller.addFiles([file()])
      const id = h.controller.snapshot().items[0]?.id
      assert.ok(id)
      assert.equal(h.controller.snapshot().items[0]?.status, 'uploading')
      assert.equal(h.posts.length, 0)

      await h.releasePut(id)
      assert.deepEqual(h.puts, [{
        attachmentId: id,
        fileName: 'a.pdf',
        fileType: 'application/pdf',
        fileSize: 3,
        scope: 'solution',
        requestId: REQUEST_ID,
      }])
      assert.equal(h.posts.length, 1)
      const [firstPost] = h.posts
      const postFile = firstPost?.file
      assert.ok(postFile instanceof File)
      assert.equal((postFile as File).name, 'a.pdf')
      const { file: _postFile, ...postFields } = firstPost ?? {}
      assert.deepEqual(postFields, {
        attachmentId: id,
        uploadToken: UPLOAD_TOKEN,
        scope: 'solution',
        requestId: REQUEST_ID,
      })

      await h.succeedPost(id)
      const snap = h.controller.snapshot()
      assert.equal(snap.items[0]?.status, 'success')
      assert.equal(snap.items[0]?.attachmentId, id)
      assert.deepEqual(snap.readyAttachmentIds, [id])
      assert.equal(snap.hasBlockingOperations, false)
    } finally {
      h.restore()
    }
  })

  it('immediate remove after add DELETEs the scoped reservation and never sends XHR', async () => {
    const h = createHarness()
    try {
      h.controller.addFiles([file()])
      const id = h.controller.snapshot().items[0]?.id
      assert.ok(id)
      h.controller.removeItem(id)
      assert.equal(h.controller.snapshot().items[0]?.cleanupRequested, true)
      assert.equal(h.deletes.length, 0)

      await h.releasePut(id)
      assert.equal(h.posts.length, 0)
      assert.deepEqual(h.deletes, [{
        attachmentId: id,
        scope: 'solution',
        requestId: REQUEST_ID,
      }])
      assert.equal(h.controller.snapshot().items.length, 0)
    } finally {
      h.restore()
    }
  })

  it('removing mid-XHR aborts the upload and a stale success never surfaces', async () => {
    const h = createHarness()
    try {
      h.controller.addFiles([file()])
      const id = h.controller.snapshot().items[0]?.id
      assert.ok(id)
      await h.releasePut(id)
      const xhr = await h.peekPost(id)

      h.controller.removeItem(id)
      assert.equal(xhr.aborted, true)
      assert.deepEqual(h.deletes, [{ attachmentId: id, scope: 'solution', requestId: REQUEST_ID }])
      await flush()
      assert.equal(h.controller.snapshot().items.length, 0)

      await h.succeedPost(id)
      assert.equal(h.controller.snapshot().items.some((item) => item.status === 'success'), false)
    } finally {
      h.restore()
    }
  })

  it('reset reuses an in-flight remove cleanup and sends one DELETE', async () => {
    const h = createHarness()
    try {
      h.controller.addFiles([file()])
      const id = h.controller.snapshot().items[0]?.id
      assert.ok(id)
      await h.releasePut(id)
      await h.succeedPost(id)

      const deleteGate = deferred<void>()
      h.setDeleteImpl(async (attachmentId) => {
        await deleteGate.promise
      })

      h.controller.removeItem(id)
      await flush()
      assert.equal(h.deletes.length, 1)

      const resetPromise = h.controller.reset()
      await flush()
      assert.equal(h.deletes.length, 1)

      deleteGate.resolve()
      await resetPromise
      assert.equal(h.controller.snapshot().items.length, 0)
    } finally {
      h.restore()
    }
  })

  it('reset keeps a failed cleanup item and retry DELETE drops it without re-upload', async () => {
    const h = createHarness()
    try {
      h.controller.addFiles([file('a.pdf'), file('b.pdf')])
      const [first, second] = h.controller.snapshot().items
      assert.ok(first && second)
      await h.releasePut(first.id)
      await h.succeedPost(first.id)
      await h.releasePut(second.id)
      await h.succeedPost(second.id)
      assert.equal(h.controller.snapshot().readyAttachmentIds.length, 2)

      let deleteCalls = 0
      h.setDeleteImpl(async (attachmentId) => {
        deleteCalls += 1
        if (attachmentId === second.id && deleteCalls <= 2) {
          throw new Error('Failed to delete staged file')
        }
      })

      await assert.rejects(() => h.controller.reset(), /Failed to delete staged file/)
      const afterReset = h.controller.snapshot()
      assert.equal(afterReset.items.length, 1)
      assert.equal(afterReset.items[0]?.id, second.id)
      assert.equal(afterReset.items[0]?.cleanupRequested, true)
      assert.equal(afterReset.hasBlockingOperations, true)
      assert.deepEqual(afterReset.readyAttachmentIds, [])
      assert.equal(h.posts.length, 2)

      h.controller.retryItem(second.id)
      await flush()
      assert.equal(h.controller.snapshot().items.length, 0)
      assert.equal(h.posts.length, 2)
    } finally {
      h.restore()
    }
  })

  it('clear then unmount does not DELETE; unmount without clear does', async () => {
    const cleared = createHarness()
    try {
      cleared.controller.addFiles([file()])
      const clearedId = cleared.controller.snapshot().items[0]?.id
      assert.ok(clearedId)
      await cleared.releasePut(clearedId)
      await cleared.succeedPost(clearedId)
      cleared.controller.clear()
      assert.equal(cleared.controller.snapshot().items.length, 0)
      const deletesAfterClear = cleared.deletes.length
      cleared.controller.unmount()
      assert.equal(cleared.deletes.length, deletesAfterClear)
    } finally {
      cleared.restore()
    }

    const hanging = createHarness()
    try {
      hanging.controller.addFiles([file()])
      const hangingId = hanging.controller.snapshot().items[0]?.id
      assert.ok(hangingId)
      await hanging.releasePut(hangingId)
      await hanging.succeedPost(hangingId)
      hanging.controller.unmount()
      assert.deepEqual(hanging.deletes, [{ attachmentId: hangingId, scope: 'solution', requestId: REQUEST_ID }])
    } finally {
      hanging.restore()
    }
  })

  it('repeated retry reuses the same attachmentId and does not re-upload cleanup-requested items', async () => {
    const h = createHarness()
    try {
      h.controller.addFiles([file()])
      const id = h.controller.snapshot().items[0]?.id
      assert.ok(id)
      await h.releasePut(id)
      await h.failPost(id, 500, { error: 'Attachment upload failed' })
      assert.equal(h.controller.snapshot().items[0]?.status, 'error')

      h.controller.retryItem(id)
      await h.releasePut(id)
      await h.succeedPost(id)
      assert.deepEqual(h.puts.map((put) => put.attachmentId), [id, id])
      assert.deepEqual(h.posts.map((post) => post.uploadToken), [UPLOAD_TOKEN, UPLOAD_TOKEN])
      assert.deepEqual(h.posts.map((post) => post.scope), ['solution', 'solution'])
      assert.deepEqual(h.controller.snapshot().readyAttachmentIds, [id])

      h.setDeleteImpl(async () => {
        throw new Error('Failed to delete staged file')
      })
      h.controller.removeItem(id)
      await flush()
      assert.equal(h.controller.snapshot().items[0]?.cleanupRequested, true)
      h.controller.retryItem(id)
      await flush()
      assert.equal(h.posts.length, 2)
      assert.equal(h.controller.snapshot().items[0]?.id, id)
    } finally {
      h.restore()
    }
  })

  it('skips XHR when the reservation is alreadyReady', async () => {
    const h = createHarness()
    try {
      h.controller.addFiles([file()])
      const id = h.controller.snapshot().items[0]?.id
      assert.ok(id)
      await h.releasePut(id, {
        alreadyReady: true,
        fileName: 'a.pdf',
        fileType: 'application/pdf',
        fileSize: 3,
      })
      assert.equal(h.posts.length, 0)
      const snap = h.controller.snapshot()
      assert.equal(snap.items[0]?.status, 'success')
      assert.deepEqual(snap.readyAttachmentIds, [id])
    } finally {
      h.restore()
    }
  })

  it('generic reserve rejection settles the attempt so later remove DELETEs', async () => {
    const h = createHarness()
    try {
      h.controller.addFiles([file()])
      const id = h.controller.snapshot().items[0]?.id
      assert.ok(id)
      await h.failPut(id, 400, { error: 'Invalid requestId' })
      const afterFail = h.controller.snapshot()
      assert.equal(afterFail.items[0]?.status, 'error')
      assert.equal(afterFail.items[0]?.error, 'Invalid requestId')
      assert.equal(afterFail.hasBlockingOperations, true)
      assert.equal(h.deletes.length, 0)

      h.controller.removeItem(id)
      await flush()
      assert.deepEqual(h.deletes, [{ attachmentId: id, scope: 'solution', requestId: REQUEST_ID }])
      assert.equal(h.controller.snapshot().items.length, 0)
      assert.equal(h.controller.snapshot().hasBlockingOperations, false)
    } finally {
      h.restore()
    }
  })

  it('cancelled reserve always settles through DELETE', async () => {
    const h = createHarness()
    try {
      h.controller.addFiles([file()])
      const id = h.controller.snapshot().items[0]?.id
      assert.ok(id)
      await h.failPut(id, 409, { error: 'Attachment was cancelled' })
      assert.equal(h.posts.length, 0)
      assert.deepEqual(h.deletes, [{ attachmentId: id, scope: 'solution', requestId: REQUEST_ID }])
      assert.equal(h.controller.snapshot().items.length, 0)
    } finally {
      h.restore()
    }
  })

  it('enforces MAX_ATTACHMENTS_PER_FORM on addFiles', async () => {
    const h = createHarness()
    try {
      const files = Array.from({ length: MAX_ATTACHMENTS_PER_FORM + 2 }, (_, index) => file(`n${index}.pdf`))
      h.controller.addFiles(files)
      assert.equal(h.controller.snapshot().items.length, MAX_ATTACHMENTS_PER_FORM)
      h.controller.addFiles([file('overflow.pdf')])
      assert.equal(h.controller.snapshot().items.length, MAX_ATTACHMENTS_PER_FORM)
    } finally {
      h.restore()
    }
  })
})
