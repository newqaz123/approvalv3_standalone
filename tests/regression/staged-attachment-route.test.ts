import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'

type AuthSession = { user?: { id: string } } | null

const UUID = '48929d61-691d-4a70-b677-7d8c985fd308'
const AUTHED: AuthSession = { user: { id: 'user-1' } }

let authSession: AuthSession = AUTHED
let writeError: unknown = null
let deleteError: unknown = null
let POST: (request: Request) => Promise<Response>
let DELETE: (request: Request) => Promise<Response>
let uploadDir: string
const previousUploadDir = process.env.UPLOAD_DIR

const originalLoad = (Module as unknown as { _load: LoadFn })._load
type LoadFn = (this: unknown, request: string, parent: unknown, isMain: boolean) => unknown

function normalizedSpecifier(request: string): string {
  return request.replaceAll('\\', '/').replace(/\.[cm]?[jt]sx?$/, '')
}

function isAuthConfig(request: string): boolean {
  return normalizedSpecifier(request).endsWith('lib/auth-config')
}

function isAttachmentStorage(request: string): boolean {
  return normalizedSpecifier(request).endsWith('lib/attachments/storage')
}

function loadReal<T = unknown>(request: string): T {
  return originalLoad.apply(Module, [request, undefined, false]) as T
}

const realStorage = loadReal<Record<string, unknown>>('@/lib/attachments/storage')

const patchedLoad: LoadFn = function (request, parent, isMain) {
  if (isAuthConfig(request)) {
    return {
      __esModule: true,
      auth: async () => authSession,
    }
  }
  if (isAttachmentStorage(request)) {
    return {
      __esModule: true,
      ...realStorage,
      writeAttachmentFile: async (...args: unknown[]) => {
        if (writeError) throw writeError
        return (realStorage.writeAttachmentFile as (...inner: unknown[]) => Promise<void>)(...args)
      },
      deleteAttachmentFile: async (...args: unknown[]) => {
        if (deleteError) throw deleteError
        return (realStorage.deleteAttachmentFile as (...inner: unknown[]) => Promise<void>)(...args)
      },
    }
  }
  return originalLoad.apply(this, [request, parent, isMain])
}
;(Module as unknown as { _load: LoadFn })._load = patchedLoad

function pdfFile(name: string, contents = 'pdf-bytes'): File {
  return new File([contents], name, { type: 'application/pdf' })
}

async function postFile(file: File | null, extra?: RequestInit): Promise<Response> {
  if (file === null && extra) {
    return POST(new Request('http://localhost/api/attachments/stage', { method: 'POST', ...extra }))
  }
  const form = new FormData()
  if (file) form.append('file', file)
  return POST(new Request('http://localhost/api/attachments/stage', { method: 'POST', body: form }))
}

async function deletePath(body: unknown): Promise<Response> {
  const init: RequestInit = { method: 'DELETE' }
  if (typeof body === 'string') {
    init.headers = { 'content-type': 'application/json' }
    init.body = body
  } else {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return DELETE(new Request('http://localhost/api/attachments/stage', init))
}

async function readJson(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

function ioError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = code
  return error
}

before(async () => {
  uploadDir = await mkdtemp(join(tmpdir(), 'staged-route-'))
  process.env.UPLOAD_DIR = uploadDir
  const route = await import('../../src/app/api/attachments/stage/route')
  POST = route.POST
  DELETE = route.DELETE
})

after(async () => {
  ;(Module as unknown as { _load: LoadFn })._load = originalLoad
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR
  else process.env.UPLOAD_DIR = previousUploadDir
  if (uploadDir) await rm(uploadDir, { recursive: true, force: true })
})

beforeEach(() => {
  authSession = AUTHED
  writeError = null
  deleteError = null
})

describe('POST /api/attachments/stage', () => {
  it('returns 401 without a user id', async () => {
    authSession = null
    const { status, body } = await readJson(await postFile(pdfFile('a.pdf')))
    assert.equal(status, 401)
    assert.equal(body.error, 'Unauthorized')
  })

  it('returns the policy message on metadata validation failure', async () => {
    const empty = await readJson(await postFile(pdfFile('empty.pdf', '')))
    assert.equal(empty.status, 400)
    assert.match(String(empty.body.error), /empty/i)

    const unsupported = await readJson(await postFile(new File(['x'], 'script.html', { type: 'text/html' })))
    assert.equal(unsupported.status, 400)
    assert.match(String(unsupported.body.error), /not supported/i)
  })

  it('writes the file and returns filesystem-stat size', async () => {
    const contents = 'hello-pdf'
    const { status, body } = await readJson(await postFile(pdfFile('a b.pdf', contents)))
    assert.equal(status, 200)
    assert.equal(body.fileName, 'a b.pdf')
    assert.equal(body.fileType, 'application/pdf')
    assert.equal(body.fileSize, Buffer.byteLength(contents))
    assert.match(String(body.stagedPath), /^stage\/[0-9a-f-]{36}\/a b\.pdf$/)
  })

  it('returns 500 when writeAttachmentFile fails', async () => {
    writeError = ioError('EACCES', 'permission denied')
    const { status, body } = await readJson(await postFile(pdfFile('a.pdf')))
    assert.equal(status, 500)
    assert.equal(body.error, 'Failed to store file')
  })
})

describe('DELETE /api/attachments/stage', () => {
  it('returns 401 without a user id', async () => {
    authSession = null
    const { status, body } = await readJson(await deletePath({ stagedPath: `stage/${UUID}/a.pdf` }))
    assert.equal(status, 401)
    assert.equal(body.error, 'Unauthorized')
  })

  it('rejects traversal and non-stage paths with 400', async () => {
    const traversal = await readJson(await deletePath({ stagedPath: `stage/${UUID}/../etc/passwd` }))
    assert.equal(traversal.status, 400)
    assert.equal(traversal.body.error, 'Not a staged attachment path')

    const nonStage = await readJson(await deletePath({ stagedPath: `${UUID}/abc-photo.pdf` }))
    assert.equal(nonStage.status, 400)
    assert.equal(nonStage.body.error, 'Not a staged attachment path')
  })

  it('returns 404 for ENOENT', async () => {
    const { status, body } = await readJson(await deletePath({ stagedPath: `stage/${UUID}/missing.pdf` }))
    assert.equal(status, 404)
    assert.equal(body.error, 'Staged attachment not found')
  })

  it('returns 500 for non-ENOENT IO errors', async () => {
    deleteError = ioError('EACCES', 'permission denied')
    const { status, body } = await readJson(await deletePath({ stagedPath: `stage/${UUID}/a.pdf` }))
    assert.equal(status, 500)
    assert.equal(body.error, 'Failed to delete staged file')
  })

  it('returns 200 only after a successful delete', async () => {
    const uploaded = await readJson(await postFile(pdfFile('keep.pdf', 'keep-me')))
    assert.equal(uploaded.status, 200)
    const stagedPath = String(uploaded.body.stagedPath)

    const deleted = await readJson(await deletePath({ stagedPath }))
    assert.equal(deleted.status, 200)
    assert.equal(deleted.body.success, true)

    const missing = await readJson(await deletePath({ stagedPath }))
    assert.equal(missing.status, 404)
  })

  it('accepts a POST-emitted path whose sanitized name contains ..', async () => {
    const uploaded = await readJson(await postFile(pdfFile('drawing..pdf', 'dots')))
    assert.equal(uploaded.status, 200)
    assert.equal(uploaded.body.fileName, 'drawing..pdf')
    assert.match(String(uploaded.body.stagedPath), /^stage\/[0-9a-f-]{36}\/drawing\.\.pdf$/)

    const deleted = await readJson(await deletePath({ stagedPath: uploaded.body.stagedPath }))
    assert.equal(deleted.status, 200)
    assert.equal(deleted.body.success, true)
  })
})
