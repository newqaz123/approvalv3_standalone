import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'

type AuthSession = { user?: { id: string } } | null

type DraftRow = {
  id: string
  requestId: string | null
  solutionId: string | null
  fileName: string
  fileType: string
  fileSize: number
  filePath: string
  uploadedById: string
}

const ATTACHMENT_ID = '48929d61-691d-4a70-b677-7d8c985fd308'
const OTHER_ATTACHMENT_ID = '7c3e1a90-2b44-4d81-9f06-55aa11bb22cc'
const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'
const AUTHED: AuthSession = { user: { id: USER_ID } }

let authSession: AuthSession = AUTHED
let writeError: unknown = null
let unlinkFailuresRemaining = 0
let collideOnWrite = false
let truncatedWriteThenThrow = false
let afterFindUnique: null | ((row: DraftRow | null) => Promise<void>) = null
let afterCreate: null | ((row: DraftRow) => Promise<void>) = null
let beforeWrite: null | (() => Promise<void>) = null
let afterMove: null | (() => Promise<void>) = null
let PUT: (request: Request) => Promise<Response>
let POST: (request: Request) => Promise<Response>
let DELETE: (request: Request) => Promise<Response>
let uploadDir: string
const previousUploadDir = process.env.UPLOAD_DIR
const rows = new Map<string, DraftRow>()

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

function isPrisma(request: string): boolean {
  return normalizedSpecifier(request).endsWith('lib/prisma')
}

function loadReal<T = unknown>(request: string): T {
  return originalLoad.apply(Module, [request, undefined, false]) as T
}

const realStorage = loadReal<Record<string, unknown>>('@/lib/attachments/storage')

async function fileExists(storedPath: string): Promise<boolean> {
  return (realStorage.attachmentFileExists as (path: string) => Promise<boolean>)(storedPath)
}

async function readStored(storedPath: string): Promise<string> {
  const bytes = await (realStorage.readAttachmentFile as (path: string) => Promise<Buffer>)(storedPath)
  return bytes.toString()
}

async function writeStored(storedPath: string, contents: string): Promise<void> {
  await (realStorage.writeAttachmentFile as (path: string, bytes: Buffer) => Promise<void>)(
    storedPath,
    Buffer.from(contents),
  )
}

function matchesWhere(row: DraftRow, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if ((row as Record<string, unknown>)[key] !== value) return false
  }
  return true
}

function uniqueConstraint(): Error {
  const error = new Error('Unique constraint failed') as Error & { code: string }
  error.code = 'P2002'
  return error
}

const prismaMock = {
  file_attachments: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = rows.get(where.id) ?? null
      const snapshot = row ? { ...row } : null
      if (afterFindUnique) await afterFindUnique(snapshot)
      return snapshot
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      for (const row of rows.values()) {
        if (!matchesWhere(row, where)) continue
        return { ...row }
      }
      return null
    },
    create: async ({ data }: { data: DraftRow }) => {
      if (rows.has(data.id)) throw uniqueConstraint()
      const row = { ...data }
      rows.set(row.id, row)
      if (afterCreate) await afterCreate({ ...row })
      return { ...row }
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<DraftRow> }) => {
      let count = 0
      for (const [id, row] of rows) {
        if (!matchesWhere(row, where)) continue
        rows.set(id, { ...row, ...data })
        count += 1
      }
      return { count }
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      let count = 0
      for (const [id, row] of rows) {
        if (!matchesWhere(row, where)) continue
        rows.delete(id)
        count += 1
      }
      return { count }
    },
  },
}

const patchedLoad: LoadFn = function (request, parent, isMain) {
  if (isAuthConfig(request)) {
    return { __esModule: true, auth: async () => authSession }
  }
  if (isPrisma(request)) {
    return { __esModule: true, default: prismaMock }
  }
  if (isAttachmentStorage(request)) {
    return {
      __esModule: true,
      ...realStorage,
      writeAttachmentFile: async (...args: unknown[]) => {
        if (beforeWrite) await beforeWrite()
        const storedPath = String(args[0])
        if (truncatedWriteThenThrow) {
          truncatedWriteThenThrow = false
          await (realStorage.writeAttachmentFile as (path: string, bytes: Buffer) => Promise<void>)(
            storedPath,
            Buffer.from('xx'),
          )
          throw ioError('EIO', 'write failed')
        }
        if (collideOnWrite) {
          collideOnWrite = false
          await (realStorage.writeAttachmentFile as (path: string, bytes: Buffer) => Promise<void>)(
            storedPath,
            Buffer.from('collision-bytes'),
          )
        }
        if (writeError) throw writeError
        return (realStorage.writeAttachmentFile as (...inner: unknown[]) => Promise<void>)(...args)
      },
      deleteAttachmentFile: async (...args: unknown[]) => {
        if (unlinkFailuresRemaining > 0) {
          unlinkFailuresRemaining -= 1
          throw ioError('EACCES', 'permission denied')
        }
        return (realStorage.deleteAttachmentFile as (...inner: unknown[]) => Promise<void>)(...args)
      },
      moveAttachmentFile: async (...args: unknown[]) => {
        await (realStorage.moveAttachmentFile as (...inner: unknown[]) => Promise<void>)(...args)
        if (afterMove) await afterMove()
      },
    }
  }
  return originalLoad.apply(this, [request, parent, isMain])
}
;(Module as unknown as { _load: LoadFn })._load = patchedLoad

function pdfFile(name: string, contents = 'pdf-bytes'): File {
  return new File([contents], name, { type: 'application/pdf' })
}

type JsonResult = { status: number; body: Record<string, unknown> }

async function readJson(response: Response): Promise<JsonResult> {
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

function requireJsonResult(value: JsonResult | null, message: string): JsonResult {
  if (!value) throw new Error(message)
  return value
}

async function putAttachment(body: unknown): Promise<Response> {
  return PUT(new Request('http://localhost/api/attachments/stage', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

async function reserveFile(file: File, attachmentId = ATTACHMENT_ID) {
  return readJson(await putAttachment({
    attachmentId,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  }))
}

async function postFile(file: File, attachmentId: string, uploadToken?: string): Promise<Response> {
  const form = new FormData()
  form.append('file', file)
  form.append('attachmentId', attachmentId)
  if (uploadToken !== undefined) form.append('uploadToken', uploadToken)
  return POST(new Request('http://localhost/api/attachments/stage', { method: 'POST', body: form }))
}

async function deleteAttachment(body: unknown): Promise<Response> {
  return DELETE(new Request('http://localhost/api/attachments/stage', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

function ioError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = code
  return error
}

function seedRow(overrides: Partial<DraftRow> & Pick<DraftRow, 'id' | 'filePath' | 'uploadedById'>): DraftRow {
  const row: DraftRow = {
    requestId: null,
    solutionId: null,
    fileName: 'seed.pdf',
    fileType: 'application/pdf',
    fileSize: 9,
    ...overrides,
  }
  rows.set(row.id, row)
  return row
}

function tokenOf(id = ATTACHMENT_ID): string {
  const token = (realStorage.uploadTokenFromDraftPath as (path: string) => string | null)(rows.get(id)!.filePath)
  if (!token) throw new Error('missing uploadToken')
  return token
}

before(async () => {
  uploadDir = await mkdtemp(join(tmpdir(), 'staged-route-'))
  process.env.UPLOAD_DIR = uploadDir
  const route = await import('../../src/app/api/attachments/stage/route')
  PUT = route.PUT
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
  unlinkFailuresRemaining = 0
  collideOnWrite = false
  truncatedWriteThenThrow = false
  afterFindUnique = null
  afterCreate = null
  beforeWrite = null
  afterMove = null
  rows.clear()
})

describe('PUT /api/attachments/stage', () => {
  it('returns 401 without a user id', async () => {
    authSession = null
    const { status, body } = await reserveFile(pdfFile('a.pdf'))
    assert.equal(status, 401)
    assert.equal(body.error, 'Unauthorized')
    assert.equal(rows.size, 0)
  })

  it('returns 400 when attachmentId is missing or not a UUID', async () => {
    const missing = await readJson(await putAttachment({ fileName: 'a.pdf', fileType: 'application/pdf', fileSize: 3 }))
    assert.equal(missing.status, 400)
    assert.equal(missing.body.error, 'Invalid attachmentId')
  })

  it('create-first reserves an owner-scoped row and returns a stable uploadToken', async () => {
    const file = pdfFile('a b.pdf', 'hello-pdf')
    const { status, body } = await reserveFile(file)
    assert.equal(status, 200)
    assert.equal(body.attachmentId, ATTACHMENT_ID)
    assert.equal(body.alreadyReady, false)
    assert.match(String(body.uploadToken), /^[0-9a-f-]{36}$/i)
    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.equal(row.requestId, null)
    assert.equal(row.solutionId, null)
    assert.equal(row.uploadedById, USER_ID)
    assert.equal(row.filePath, `request-drafts/reserved/${ATTACHMENT_ID}/${body.uploadToken}/a b.pdf`)
    assert.equal(await fileExists(row.filePath), false)
  })

  it('returns the same uploadToken on reserved/uploading retry and alreadyReady when matching ready', async () => {
    const file = pdfFile('a.pdf', 'bytes')
    const first = await reserveFile(file)
    const second = await reserveFile(file)
    assert.equal(second.status, 200)
    assert.equal(second.body.uploadToken, first.body.uploadToken)
    assert.equal(second.body.alreadyReady, false)

    const readyPath = (realStorage.toRequestDraftReadyPath as (path: string) => string)(rows.get(ATTACHMENT_ID)!.filePath)
    rows.set(ATTACHMENT_ID, { ...rows.get(ATTACHMENT_ID)!, filePath: readyPath })
    const ready = await reserveFile(file)
    assert.equal(ready.status, 200)
    assert.equal(ready.body.alreadyReady, true)
    assert.equal(ready.body.uploadToken, first.body.uploadToken)
    assert.equal(ready.body.fileName, 'a.pdf')
  })

  it('rejects cancelled and adopted rows instead of resurrecting them', async () => {
    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      filePath: `request-drafts/cancelled/absent/${ATTACHMENT_ID}`,
      fileName: 'cancelled',
      fileType: '',
      fileSize: 0,
    })
    const cancelled = await reserveFile(pdfFile('a.pdf'))
    assert.equal(cancelled.status, 409)
    assert.equal(cancelled.body.error, 'Attachment was cancelled')

    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      requestId: REQUEST_ID,
      filePath: `request-drafts/ready/${ATTACHMENT_ID}/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/adopted.pdf`,
      fileName: 'adopted.pdf',
    })
    const adopted = await reserveFile(pdfFile('a.pdf'))
    assert.equal(adopted.status, 409)
    assert.equal(adopted.body.error, 'Attachment is no longer a draft')
  })
})

describe('POST /api/attachments/stage', () => {
  it('returns 404 when no reserved row exists and never creates one', async () => {
    const { status, body } = await readJson(await postFile(pdfFile('a.pdf'), ATTACHMENT_ID, ATTACHMENT_ID))
    assert.equal(status, 404)
    assert.equal(body.error, 'Attachment not found')
    assert.equal(rows.size, 0)
  })

  it('CAS-claims the reserved row with the same token and finalizes ready', async () => {
    const file = pdfFile('a b.pdf', 'hello-pdf')
    const reserved = await reserveFile(file)
    const { status, body } = await readJson(await postFile(file, ATTACHMENT_ID, String(reserved.body.uploadToken)))
    assert.equal(status, 200)
    assert.equal(body.attachmentId, ATTACHMENT_ID)
    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.equal(row.filePath, `request-drafts/ready/${ATTACHMENT_ID}/${reserved.body.uploadToken}/a b.pdf`)
    assert.equal(await fileExists(row.filePath), true)
    assert.equal(await fileExists(row.filePath.replace('/ready/', '/uploading/')), false)
  })

  it('ready same-token retry returns success without rewriting bytes', async () => {
    const file = pdfFile('a.pdf', 'original')
    const reserved = await reserveFile(file)
    assert.equal((await readJson(await postFile(file, ATTACHMENT_ID, String(reserved.body.uploadToken)))).status, 200)
    const readyPath = rows.get(ATTACHMENT_ID)!.filePath
    const retry = await readJson(await postFile(file, ATTACHMENT_ID, String(reserved.body.uploadToken)))
    assert.equal(retry.status, 200)
    assert.equal(rows.get(ATTACHMENT_ID)?.filePath, readyPath)
    assert.equal(await readStored(readyPath), 'original')
  })

  it('same-token concurrent POST does not delete winner bytes', async () => {
    const file = pdfFile('a.pdf', 'winner-bytes')
    const reserved = await reserveFile(file)
    let nested: { status: number; body: Record<string, unknown> } | null = null
    let started = false
    afterFindUnique = async (row) => {
      if (started || !row) return
      started = true
      nested = await readJson(await postFile(file, ATTACHMENT_ID, String(reserved.body.uploadToken)))
    }
    const stale = await readJson(await postFile(file, ATTACHMENT_ID, String(reserved.body.uploadToken)))
    const concurrent = requireJsonResult(nested, 'nested same-token POST must run')
    assert.equal(concurrent.status, 200)
    assert.ok(stale.status === 200 || stale.status === 409)
    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.match(row.filePath, /\/ready\//)
    assert.equal(await readStored(row.filePath), 'winner-bytes')
  })

  it('returns 403 on owner mismatch and 409 for adopted rows', async () => {
    const file = pdfFile('a.pdf', 'intruder')
    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: OTHER_USER_ID,
      filePath: `request-drafts/reserved/${ATTACHMENT_ID}/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/a.pdf`,
      fileName: 'a.pdf',
      fileSize: file.size,
      fileType: file.type,
    })
    const forbidden = await readJson(await postFile(file, ATTACHMENT_ID, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'))
    assert.equal(forbidden.status, 403)

    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      requestId: REQUEST_ID,
      filePath: `request-drafts/ready/${ATTACHMENT_ID}/bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb/a.pdf`,
      fileName: 'a.pdf',
    })
    const adopted = await readJson(await postFile(file, ATTACHMENT_ID, 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'))
    assert.equal(adopted.status, 409)
    assert.equal(adopted.body.error, 'Attachment is no longer a draft')
  })

  it('partial write then throw is unlinked and retry cannot publish truncated bytes', async () => {
    const file = pdfFile('a.pdf', 'full-bytes')
    const reserved = await reserveFile(file)
    const token = String(reserved.body.uploadToken)
    const uploading = `request-drafts/uploading/${ATTACHMENT_ID}/${token}/a.pdf`
    const ready = `request-drafts/ready/${ATTACHMENT_ID}/${token}/a.pdf`

    const originalError = console.error
    console.error = (...args: unknown[]) => {
      const text = args.map(String).join(' ')
      if (text.includes('Failed to stage attachment')) return
      originalError.apply(console, args)
    }
    try {
      truncatedWriteThenThrow = true
      const failed = await readJson(await postFile(file, ATTACHMENT_ID, token))
      assert.equal(failed.status, 500)
      assert.equal(await fileExists(uploading), false)
      assert.equal(await fileExists(ready), false)
      assert.match(String(rows.get(ATTACHMENT_ID)?.filePath), /\/uploading\//)
    } finally {
      console.error = originalError
    }

    const retried = await readJson(await postFile(file, ATTACHMENT_ID, token))
    assert.equal(retried.status, 200)
    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.match(row.filePath, /\/ready\//)
    assert.equal(await readStored(row.filePath), 'full-bytes')
    assert.equal(await fileExists(uploading), false)
  })

  it('losing wx to another writer reloads without deleting winner bytes', async () => {
    const file = pdfFile('a.pdf', 'new-bytes')
    const reserved = await reserveFile(file)
    collideOnWrite = true
    const { status } = await readJson(await postFile(file, ATTACHMENT_ID, String(reserved.body.uploadToken)))
    assert.ok(status === 409 || status === 200)
    const uploading = `request-drafts/uploading/${ATTACHMENT_ID}/${reserved.body.uploadToken}/a.pdf`
    assert.equal(await readStored(uploading), 'collision-bytes')
  })
})

describe('DELETE /api/attachments/stage', () => {
  it('creates a cancelled sentinel when no row exists so later PUT cannot resurrect', async () => {
    const deleted = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    assert.equal(deleted.status, 200)
    assert.equal(rows.get(ATTACHMENT_ID)?.filePath, `request-drafts/cancelled/absent/${ATTACHMENT_ID}`)
    const resurrect = await reserveFile(pdfFile('a.pdf'))
    assert.equal(resurrect.status, 409)
    assert.equal(resurrect.body.error, 'Attachment was cancelled')
  })

  it('CAS-loops a reserved row to cancelled and keeps the row', async () => {
    const file = pdfFile('a.pdf', 'bytes')
    assert.equal((await reserveFile(file)).status, 200)
    const deleted = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    assert.equal(deleted.status, 200)
    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.match(row.filePath, /^request-drafts\/cancelled\/reserved\//)
    assert.equal((await readJson(await postFile(file, ATTACHMENT_ID, tokenOf()))).status, 409)
  })

  it('does not delete an adopted file', async () => {
    const readyPath = `request-drafts/ready/${ATTACHMENT_ID}/eeeeeeee-1111-4111-8111-eeeeeeeeeeee/adopted.pdf`
    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      requestId: REQUEST_ID,
      filePath: readyPath,
    })
    await writeStored(readyPath, 'adopted')
    const { status, body } = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    assert.equal(status, 409)
    assert.equal(body.error, 'Attachment is no longer a draft')
    assert.equal(rows.get(ATTACHMENT_ID)?.requestId, REQUEST_ID)
    assert.equal(await fileExists(readyPath), true)
  })

  it('returns 500 on unlink failure and retries cleanup on the cancelled row', async () => {
    const token = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
    const readyPath = `request-drafts/ready/${OTHER_ATTACHMENT_ID}/${token}/a.pdf`
    const cancelledPath = `request-drafts/cancelled/ready/${OTHER_ATTACHMENT_ID}/${token}/a.pdf`
    seedRow({
      id: OTHER_ATTACHMENT_ID,
      uploadedById: USER_ID,
      filePath: cancelledPath,
      fileName: 'a.pdf',
      fileType: 'application/pdf',
      fileSize: 5,
    })
    await writeStored(readyPath, 'bytes')

    const originalError = console.error
    console.error = (...args: unknown[]) => {
      const text = args.map(String).join(' ')
      if (text.includes('Failed to delete staged attachment')) return
      originalError.apply(console, args)
    }
    try {
      unlinkFailuresRemaining = 1
      const failed = await readJson(await deleteAttachment({ attachmentId: OTHER_ATTACHMENT_ID }))
      assert.equal(failed.status, 500)
      assert.equal(rows.get(OTHER_ATTACHMENT_ID)?.filePath, cancelledPath)
      assert.equal(await fileExists(readyPath), true)

      const retried = await readJson(await deleteAttachment({ attachmentId: OTHER_ATTACHMENT_ID }))
      assert.equal(retried.status, 200)
      assert.ok(rows.has(OTHER_ATTACHMENT_ID))
      assert.equal(rows.get(OTHER_ATTACHMENT_ID)?.filePath, cancelledPath)
      assert.equal(await fileExists(readyPath), false)
    } finally {
      unlinkFailuresRemaining = 0
      console.error = originalError
    }
  })

  it('lost-finalize compensation does not unlink ready bytes after same-token finalize and adopt', async () => {
    const file = pdfFile('a.pdf', 'winner-bytes')
    const reserved = await reserveFile(file)
    const token = String(reserved.body.uploadToken)
    const ready = `request-drafts/ready/${ATTACHMENT_ID}/${token}/a.pdf`
    let nested: JsonResult | null = null
    let started = false
    afterMove = async () => {
      if (started) return
      started = true
      nested = await readJson(await postFile(file, ATTACHMENT_ID, token))
      const current = rows.get(ATTACHMENT_ID)
      if (current) rows.set(ATTACHMENT_ID, { ...current, requestId: REQUEST_ID })
    }
    const loser = await readJson(await postFile(file, ATTACHMENT_ID, token))
    const winner = requireJsonResult(nested, 'nested same-token POST must finalize after outer move')
    assert.equal(winner.status, 200)
    assert.equal(loser.status, 409)
    assert.equal(loser.body.error, 'Attachment is no longer a draft')
    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.equal(row.requestId, REQUEST_ID)
    assert.equal(row.filePath, ready)
    assert.equal(await fileExists(ready), true)
    assert.equal(await readStored(ready), 'winner-bytes')
  })

  it('POST that writes after DELETE cancelled uploading compensates by unlinking its own bytes', async () => {
    const file = pdfFile('a.pdf', 'late-bytes')
    const reserved = await reserveFile(file)
    const token = String(reserved.body.uploadToken)
    const uploading = `request-drafts/uploading/${ATTACHMENT_ID}/${token}/a.pdf`
    const ready = `request-drafts/ready/${ATTACHMENT_ID}/${token}/a.pdf`
    let nested: JsonResult | null = null
    beforeWrite = async () => {
      if (nested) return
      nested = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    }
    const late = await readJson(await postFile(file, ATTACHMENT_ID, token))
    const deleted = requireJsonResult(nested, 'DELETE must run after POST CAS to uploading and before write')
    assert.equal(deleted.status, 200)
    assert.equal(late.status, 409)
    assert.match(String(rows.get(ATTACHMENT_ID)?.filePath), /cancelled/)
    assert.equal(await fileExists(uploading), false)
    assert.equal(await fileExists(ready), false)
  })

  it('POST-vs-DELETE CAS loop cancels without mapping loss to clean', async () => {
    const file = pdfFile('race.pdf', 'race-bytes')
    const reserved = await reserveFile(file)
    let nested: { status: number; body: Record<string, unknown> } | null = null
    let started = false
    afterFindUnique = async (row) => {
      if (started || !row) return
      started = true
      nested = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    }
    const late = await readJson(await postFile(file, ATTACHMENT_ID, String(reserved.body.uploadToken)))
    const deleted = requireJsonResult(nested, 'DELETE must run after POST snapshots the reserved row')
    assert.equal(deleted.status, 200)
    assert.equal(late.status, 409)
    assert.ok(rows.has(ATTACHMENT_ID))
    assert.match(String(rows.get(ATTACHMENT_ID)?.filePath), /cancelled/)
  })

  it('concurrent PUT/DELETE: cancelled wins and PUT cannot resurrect', async () => {
    const file = pdfFile('a.pdf', 'bytes')
    let nested: { status: number; body: Record<string, unknown> } | null = null
    let started = false
    afterCreate = async () => {
      if (started) return
      started = true
      nested = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    }
    const reserved = await reserveFile(file)
    const deleted = requireJsonResult(nested, 'DELETE must run after PUT create')
    assert.equal(deleted.status, 200)
    assert.ok(reserved.status === 200 || reserved.status === 409)
    const again = await reserveFile(file)
    assert.equal(again.status, 409)
    assert.equal(again.body.error, 'Attachment was cancelled')
    assert.match(String(rows.get(ATTACHMENT_ID)?.filePath), /cancelled/)
  })
})
