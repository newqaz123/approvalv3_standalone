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
let deleteError: unknown = null
let collideOnWrite = false
let uuidSequence: string[] | null = null
let afterFindUnique: null | ((row: DraftRow | null) => Promise<void>) = null
let afterDeleteSnapshot: null | ((row: DraftRow) => Promise<void>) = null
let beforeWrite: null | (() => Promise<void>) = null
let afterMove: null | (() => Promise<void>) = null
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
        const snapshot = { ...row }
        if (afterDeleteSnapshot) await afterDeleteSnapshot(snapshot)
        return snapshot
      }
      return null
    },
    create: async ({ data }: { data: DraftRow }) => {
      if (rows.has(data.id)) throw uniqueConstraint()
      const row = { ...data }
      rows.set(row.id, row)
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
    return {
      __esModule: true,
      auth: async () => authSession,
    }
  }
  if (isPrisma(request)) {
    return {
      __esModule: true,
      default: prismaMock,
    }
  }
  if (isAttachmentStorage(request)) {
    return {
      __esModule: true,
      ...realStorage,
      allocateRequestDraftGenerationPaths: (
        attachmentId: string,
        originalName: string,
        observedPath?: string | null,
      ) => {
        const randomId = uuidSequence
          ? () => {
              const next = uuidSequence!.shift()
              if (!next) throw new Error('uuid sequence exhausted')
              return next
            }
          : undefined
        return (realStorage.allocateRequestDraftGenerationPaths as (
          id: string,
          name: string,
          observed?: string | null,
          randomId?: () => string,
        ) => { generationId: string; uploadingPath: string; readyPath: string })(
          attachmentId,
          originalName,
          observedPath,
          randomId,
        )
      },
      writeAttachmentFile: async (...args: unknown[]) => {
        if (beforeWrite) await beforeWrite()
        const storedPath = String(args[0])
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
        if (deleteError) throw deleteError
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

async function postFile(file: File | null, attachmentId?: string, extra?: RequestInit): Promise<Response> {
  if (file === null && extra) {
    return POST(new Request('http://localhost/api/attachments/stage', { method: 'POST', ...extra }))
  }
  const form = new FormData()
  if (file) form.append('file', file)
  if (attachmentId !== undefined) form.append('attachmentId', attachmentId)
  return POST(new Request('http://localhost/api/attachments/stage', { method: 'POST', body: form }))
}

async function deleteAttachment(body: unknown): Promise<Response> {
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
  collideOnWrite = false
  uuidSequence = null
  afterFindUnique = null
  afterDeleteSnapshot = null
  beforeWrite = null
  afterMove = null
  rows.clear()
})

describe('POST /api/attachments/stage', () => {
  it('returns 401 without a user id', async () => {
    authSession = null
    const { status, body } = await readJson(await postFile(pdfFile('a.pdf'), ATTACHMENT_ID))
    assert.equal(status, 401)
    assert.equal(body.error, 'Unauthorized')
    assert.equal(rows.size, 0)
  })

  it('returns 400 when attachmentId is missing or not a UUID', async () => {
    const missing = await readJson(await postFile(pdfFile('a.pdf')))
    assert.equal(missing.status, 400)
    assert.equal(missing.body.error, 'Invalid attachmentId')

    const invalid = await readJson(await postFile(pdfFile('a.pdf'), 'not-a-uuid'))
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.error, 'Invalid attachmentId')
    assert.equal(rows.size, 0)
  })

  it('returns the policy message on metadata validation failure', async () => {
    const empty = await readJson(await postFile(pdfFile('empty.pdf', ''), ATTACHMENT_ID))
    assert.equal(empty.status, 400)
    assert.match(String(empty.body.error), /empty/i)

    const unsupported = await readJson(await postFile(new File(['x'], 'script.html', { type: 'text/html' }), ATTACHMENT_ID))
    assert.equal(unsupported.status, 400)
    assert.match(String(unsupported.body.error), /not supported/i)
    assert.equal(rows.size, 0)
  })

  it('creates the uploading row before file I/O and finalizes an owner-scoped ready draft', async () => {
    const contents = 'hello-pdf'
    let sawRowBeforeWrite = false
    beforeWrite = async () => {
      const row = rows.get(ATTACHMENT_ID)
      sawRowBeforeWrite = Boolean(row && row.requestId === null && row.solutionId === null && row.filePath.includes('/uploading/'))
    }

    const { status, body } = await readJson(await postFile(pdfFile('a b.pdf', contents), ATTACHMENT_ID))
    assert.equal(status, 200)
    assert.equal(sawRowBeforeWrite, true)
    assert.equal(body.attachmentId, ATTACHMENT_ID)
    assert.equal(body.fileName, 'a b.pdf')
    assert.equal(body.fileType, 'application/pdf')
    assert.equal(body.fileSize, Buffer.byteLength(contents))
    assert.equal(body.stagedPath, undefined)
    assert.equal(body.filePath, undefined)

    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.equal(row.requestId, null)
    assert.equal(row.solutionId, null)
    assert.equal(row.uploadedById, USER_ID)
    assert.equal(row.fileName, 'a b.pdf')
    assert.match(row.filePath, new RegExp(`^request-drafts/ready/${ATTACHMENT_ID}/[0-9a-f-]{36}/a b\\.pdf$`))
    assert.equal(await fileExists(row.filePath), true)
    assert.equal(await fileExists(row.filePath.replace('/ready/', '/uploading/')), false)
  })

  it('returns 403 on owner mismatch and does not overwrite the row', async () => {
    const seeded = seedRow({
      id: ATTACHMENT_ID,
      uploadedById: OTHER_USER_ID,
      filePath: `request-drafts/ready/${ATTACHMENT_ID}/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/kept.pdf`,
      fileName: 'kept.pdf',
    })
    await writeStored(seeded.filePath, 'owned-by-other')

    const { status, body } = await readJson(await postFile(pdfFile('a.pdf', 'intruder'), ATTACHMENT_ID))
    assert.equal(status, 403)
    assert.equal(body.error, 'Forbidden')
    assert.equal(rows.get(ATTACHMENT_ID)?.uploadedById, OTHER_USER_ID)
    assert.equal(rows.get(ATTACHMENT_ID)?.filePath, seeded.filePath)
    assert.equal(await fileExists(seeded.filePath), true)
  })

  it('returns 409 for an already-adopted row and never replaces its file', async () => {
    const seeded = seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      requestId: REQUEST_ID,
      filePath: `request-drafts/ready/${ATTACHMENT_ID}/bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb/adopted.pdf`,
      fileName: 'adopted.pdf',
    })
    await writeStored(seeded.filePath, 'adopted-bytes')

    const { status, body } = await readJson(await postFile(pdfFile('a.pdf', 'replace-me'), ATTACHMENT_ID))
    assert.equal(status, 409)
    assert.equal(body.error, 'Attachment is no longer a draft')
    assert.equal(rows.get(ATTACHMENT_ID)?.requestId, REQUEST_ID)
    assert.equal(rows.get(ATTACHMENT_ID)?.filePath, seeded.filePath)
    assert.equal(await fileExists(seeded.filePath), true)
  })

  it('lets only one same-snapshot POST win the CAS; the loser touches no bytes', async () => {
    const generation = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
    const readyPath = `request-drafts/ready/${ATTACHMENT_ID}/${generation}/a.pdf`
    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      filePath: readyPath,
      fileName: 'a.pdf',
    })
    await writeStored(readyPath, 'original-bytes')

    let nested: { status: number; body: Record<string, unknown> } | null = null
    let startedNested = false
    afterFindUnique = async (row) => {
      if (startedNested || !row) return
      startedNested = true
      nested = await readJson(await postFile(pdfFile('a.pdf', 'winner-bytes'), ATTACHMENT_ID))
    }

    const stale = await readJson(await postFile(pdfFile('a.pdf', 'stale-bytes'), ATTACHMENT_ID))
    const concurrent = nested as { status: number; body: Record<string, unknown> } | null
    if (!concurrent) throw new Error('nested same-snapshot POST must run after the first snapshot')
    assert.equal(concurrent.status, 200)
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error, 'Upload was superseded')

    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.match(row.filePath, new RegExp(`^request-drafts/ready/${ATTACHMENT_ID}/[0-9a-f-]{36}/a\\.pdf$`))
    assert.equal(await readStored(row.filePath), 'winner-bytes')
    assert.equal(await fileExists(readyPath), false)
  })

  it('loses POST-vs-adopt CAS and does not touch adopted bytes', async () => {
    const generation = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
    const readyPath = `request-drafts/ready/${ATTACHMENT_ID}/${generation}/a.pdf`
    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      filePath: readyPath,
      fileName: 'a.pdf',
    })
    await writeStored(readyPath, 'adopted-bytes')

    afterFindUnique = async (row) => {
      if (!row) return
      const current = rows.get(row.id)
      if (current) rows.set(row.id, { ...current, requestId: REQUEST_ID })
    }

    const { status, body } = await readJson(await postFile(pdfFile('a.pdf', 'replace-me'), ATTACHMENT_ID))
    assert.equal(status, 409)
    assert.equal(body.error, 'Upload was superseded')
    assert.equal(rows.get(ATTACHMENT_ID)?.requestId, REQUEST_ID)
    assert.equal(rows.get(ATTACHMENT_ID)?.filePath, readyPath)
    assert.equal(await fileExists(readyPath), true)
    assert.equal(await readStored(readyPath), 'adopted-bytes')
  })

  it('keeps prior bytes until the new generation finalizes, then cleans displaced paths', async () => {
    const generation = 'cccccccc-1111-4111-8111-cccccccccccc'
    const uploadingPath = `request-drafts/uploading/${ATTACHMENT_ID}/${generation}/crash.pdf`
    const readyPath = `request-drafts/ready/${ATTACHMENT_ID}/${generation}/crash.pdf`
    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      filePath: uploadingPath,
      fileName: 'crash.pdf',
    })
    await writeStored(uploadingPath, 'old-uploading')
    await writeStored(readyPath, 'old-ready')

    let priorBytesDuringWrite = false
    beforeWrite = async () => {
      priorBytesDuringWrite = await fileExists(uploadingPath) && await fileExists(readyPath)
    }

    const { status, body } = await readJson(await postFile(pdfFile('crash.pdf', 'new-bytes'), ATTACHMENT_ID))
    assert.equal(status, 200)
    assert.equal(body.attachmentId, ATTACHMENT_ID)
    assert.equal(priorBytesDuringWrite, true)
    assert.equal(await fileExists(uploadingPath), false)
    assert.equal(await fileExists(readyPath), false)

    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.match(row.filePath, new RegExp(`^request-drafts/ready/${ATTACHMENT_ID}/[0-9a-f-]{36}/crash\\.pdf$`))
    assert.notEqual(row.filePath, readyPath)
    assert.equal(await readStored(row.filePath), 'new-bytes')
  })

  it('restores the observed path and keeps prior bytes when the new write fails', async () => {
    const generation = 'dddddddd-1111-4111-8111-dddddddddddd'
    const readyPath = `request-drafts/ready/${ATTACHMENT_ID}/${generation}/keep.pdf`
    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      filePath: readyPath,
      fileName: 'keep.pdf',
      fileSize: 9,
    })
    await writeStored(readyPath, 'keep-me')

    writeError = ioError('EACCES', 'permission denied')
    const { status, body } = await readJson(await postFile(pdfFile('keep.pdf', 'new-bytes'), ATTACHMENT_ID))
    assert.equal(status, 500)
    assert.equal(body.error, 'Failed to store file')
    assert.equal(rows.get(ATTACHMENT_ID)?.filePath, readyPath)
    assert.equal(await fileExists(readyPath), true)
    assert.equal(await readStored(readyPath), 'keep-me')
  })

  it('does not delete a colliding EEXIST file this attempt did not create', async () => {
    collideOnWrite = true
    const { status, body } = await readJson(await postFile(pdfFile('a.pdf', 'new-bytes'), ATTACHMENT_ID))
    assert.equal(status, 500)
    assert.equal(body.error, 'Failed to store file')
    assert.equal(rows.size, 0)

    const leftover = rows.size
    assert.equal(leftover, 0)
    const uploadingPrefix = `request-drafts/uploading/${ATTACHMENT_ID}/`
    const { readdir, stat } = await import('node:fs/promises')
    const root = uploadDir
    async function findCollision(dir: string): Promise<string | null> {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return null
      }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          const found = await findCollision(full)
          if (found) return found
        } else {
          const info = await stat(full)
          if (info.isFile()) return full
        }
      }
      return null
    }
    const found = await findCollision(join(root, 'request-drafts', 'uploading'))
    assert.ok(found, 'colliding generation file must remain')
    const { readFile } = await import('node:fs/promises')
    assert.equal((await readFile(found)).toString(), 'collision-bytes')
    assert.ok(found.includes(uploadingPrefix.split('/').join('/')) || found.includes(ATTACHMENT_ID))
  })

  it('returns 500 when writeAttachmentFile fails and deletes the newly created uploading row', async () => {
    writeError = ioError('EACCES', 'permission denied')
    const { status, body } = await readJson(await postFile(pdfFile('a.pdf'), ATTACHMENT_ID))
    assert.equal(status, 500)
    assert.equal(body.error, 'Failed to store file')
    assert.equal(rows.size, 0)
  })

  it('does not restore a transient uploading predecessor after the loser cleaned it', async () => {
    let signalClaimed!: () => void
    const claimed = new Promise<void>((resolve) => { signalClaimed = resolve })
    let releaseB!: () => void
    const bMayFail = new Promise<void>((resolve) => { releaseB = resolve })
    let bPromise: Promise<{ status: number; body: Record<string, unknown> }> | null = null
    let started = false
    let pauseBWrite = false

    afterMove = async () => {
      if (started) return
      started = true
      pauseBWrite = true
      bPromise = postFile(pdfFile('abort.pdf', 'b-bytes'), ATTACHMENT_ID).then(readJson)
      await claimed
    }
    beforeWrite = async () => {
      if (!pauseBWrite) return
      signalClaimed()
      await bMayFail
      throw ioError('EACCES', 'permission denied')
    }

    const a = await readJson(await postFile(pdfFile('abort.pdf', 'a-bytes'), ATTACHMENT_ID))
    assert.equal(a.status, 409)
    assert.equal(a.body.error, 'Upload was superseded')
    releaseB()
    if (!bPromise) throw new Error('B must start after A moves')
    const b = await bPromise as { status: number; body: Record<string, unknown> }
    assert.equal(b.status, 500)
    assert.equal(rows.has(ATTACHMENT_ID), false)
  })

  it('regenerates when the server UUID repeats the observed generation', async () => {
    const observedGen = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
    const nextGen = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
    const uploadingPath = (realStorage.createRequestDraftUploadingPath as (id: string, gen: string, name: string) => string)(
      ATTACHMENT_ID,
      observedGen,
      'a.pdf',
    )
    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      filePath: uploadingPath,
      fileName: 'a.pdf',
    })
    await writeStored(uploadingPath, 'old-bytes')
    uuidSequence = [observedGen, nextGen]

    const { status } = await readJson(await postFile(pdfFile('a.pdf', 'new-bytes'), ATTACHMENT_ID))
    assert.equal(status, 200)
    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.equal(
      row.filePath,
      (realStorage.createRequestDraftReadyPath as (id: string, gen: string, name: string) => string)(
        ATTACHMENT_ID,
        nextGen,
        'a.pdf',
      ),
    )
    assert.equal(await fileExists(uploadingPath), false)
    assert.equal(await readStored(row.filePath), 'new-bytes')
  })

  it('does not clobber a pre-existing ready file on destination EEXIST', async () => {
    const generation = '99999999-1111-4111-8111-999999999999'
    const readyPath = (realStorage.createRequestDraftReadyPath as (id: string, gen: string, name: string) => string)(
      ATTACHMENT_ID,
      generation,
      'a.pdf',
    )
    await writeStored(readyPath, 'winner-bytes')
    uuidSequence = [generation]

    const { status, body } = await readJson(await postFile(pdfFile('a.pdf', 'loser-bytes'), ATTACHMENT_ID))
    assert.equal(status, 500)
    assert.equal(body.error, 'Failed to store file')
    assert.equal(rows.size, 0)
    assert.equal(await readStored(readyPath), 'winner-bytes')
  })

  it('CAS-includes an observed empty filePath so a path-changing winner is not overwritten', async () => {
    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      filePath: '',
      fileName: 'a.pdf',
    })

    let nested: { status: number; body: Record<string, unknown> } | null = null
    let startedNested = false
    afterFindUnique = async (row) => {
      if (startedNested || !row) return
      startedNested = true
      nested = await readJson(await postFile(pdfFile('a.pdf', 'winner-bytes'), ATTACHMENT_ID))
    }

    const stale = await readJson(await postFile(pdfFile('a.pdf', 'stale-bytes'), ATTACHMENT_ID))
    const concurrent = nested as { status: number; body: Record<string, unknown> } | null
    if (!concurrent) throw new Error('nested POST must run from the empty-path snapshot')
    assert.equal(concurrent.status, 200)
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error, 'Upload was superseded')
    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.notEqual(row.filePath, '')
    assert.equal(await readStored(row.filePath), 'winner-bytes')
  })
})

describe('DELETE /api/attachments/stage', () => {
  it('returns 401 without a user id', async () => {
    authSession = null
    const { status, body } = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    assert.equal(status, 401)
    assert.equal(body.error, 'Unauthorized')
  })

  it('rejects a missing or invalid attachmentId with 400', async () => {
    const missing = await readJson(await deleteAttachment({ stagedPath: `stage/${ATTACHMENT_ID}/a.pdf` }))
    assert.equal(missing.status, 400)
    assert.equal(missing.body.error, 'Invalid attachmentId')

    const invalid = await readJson(await deleteAttachment({ attachmentId: 'nope' }))
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.error, 'Invalid attachmentId')
  })

  it('returns 404 when the draft is absent', async () => {
    const { status, body } = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    assert.equal(status, 404)
    assert.equal(body.error, 'Attachment not found')
  })

  it('returns 404 on owner mismatch without deleting the other user file', async () => {
    const seeded = seedRow({
      id: ATTACHMENT_ID,
      uploadedById: OTHER_USER_ID,
      filePath: `request-drafts/ready/${ATTACHMENT_ID}/dddddddd-1111-4111-8111-dddddddddddd/other.pdf`,
    })
    await writeStored(seeded.filePath, 'other-user')

    const { status, body } = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    assert.equal(status, 404)
    assert.equal(body.error, 'Attachment not found')
    assert.ok(rows.get(ATTACHMENT_ID))
    assert.equal(await fileExists(seeded.filePath), true)
  })

  it('does not delete an adopted file when DELETE races with adopt', async () => {
    const seeded = seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      requestId: REQUEST_ID,
      filePath: `request-drafts/ready/${ATTACHMENT_ID}/eeeeeeee-1111-4111-8111-eeeeeeeeeeee/adopted.pdf`,
    })
    await writeStored(seeded.filePath, 'adopted')

    const { status, body } = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    assert.equal(status, 404)
    assert.equal(body.error, 'Attachment not found')
    assert.equal(rows.get(ATTACHMENT_ID)?.requestId, REQUEST_ID)
    assert.equal(await fileExists(seeded.filePath), true)
  })

  it('physically deletes only after a conditional draft-row delete count of 1', async () => {
    const uploaded = await readJson(await postFile(pdfFile('keep.pdf', 'keep-me'), ATTACHMENT_ID))
    assert.equal(uploaded.status, 200)
    const filePath = rows.get(ATTACHMENT_ID)?.filePath
    assert.ok(filePath)

    const deleted = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    assert.equal(deleted.status, 200)
    assert.equal(deleted.body.success, true)
    assert.equal(rows.has(ATTACHMENT_ID), false)
    assert.equal(await fileExists(filePath), false)

    const missing = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    assert.equal(missing.status, 404)
  })

  it('can DELETE the uploading row between claim and write; the late POST cleans only its own files', async () => {
    let nested: { status: number; body: Record<string, unknown> } | null = null
    beforeWrite = async () => {
      if (nested) return
      nested = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    }

    const stale = await readJson(await postFile(pdfFile('abort.pdf', 'abort-bytes'), ATTACHMENT_ID))
    const aborted = nested as { status: number; body: Record<string, unknown> } | null
    if (!aborted) throw new Error('DELETE must run after the uploading row is claimed and before write')
    assert.equal(aborted.status, 200)
    assert.equal(aborted.body.success, true)
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error, 'Upload was superseded')
    assert.equal(rows.has(ATTACHMENT_ID), false)
  })

  it('aborts an in-flight finalize by deleting the exact observed uploading path', async () => {
    let nested: { status: number; body: Record<string, unknown> } | null = null
    afterMove = async () => {
      if (nested) return
      nested = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    }

    const stale = await readJson(await postFile(pdfFile('abort.pdf', 'abort-bytes'), ATTACHMENT_ID))
    const aborted = nested as { status: number; body: Record<string, unknown> } | null
    if (!aborted) throw new Error('DELETE must run before the in-flight POST finalizes')
    assert.equal(aborted.status, 200)
    assert.equal(aborted.body.success, true)
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error, 'Upload was superseded')
    assert.equal(rows.has(ATTACHMENT_ID), false)
  })

  it('loses path-changing POST-vs-DELETE and does not unlink the winner file', async () => {
    const generation = 'ffffffff-1111-4111-8111-ffffffffffff'
    const readyPath = `request-drafts/ready/${ATTACHMENT_ID}/${generation}/old.pdf`
    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      filePath: readyPath,
      fileName: 'old.pdf',
    })
    await writeStored(readyPath, 'old-bytes')

    let nested: { status: number; body: Record<string, unknown> } | null = null
    afterDeleteSnapshot = async () => {
      if (nested) return
      nested = await readJson(await postFile(pdfFile('old.pdf', 'new-bytes'), ATTACHMENT_ID))
    }

    const deleted = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    const uploaded = nested as { status: number; body: Record<string, unknown> } | null
    if (!uploaded) throw new Error('POST must run between DELETE snapshot and conditional delete')
    assert.equal(uploaded.status, 200)
    assert.equal(deleted.status, 404)
    assert.equal(deleted.body.error, 'Attachment not found')

    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.match(row.filePath, new RegExp(`^request-drafts/ready/${ATTACHMENT_ID}/[0-9a-f-]{36}/old\\.pdf$`))
    assert.equal(await readStored(row.filePath), 'new-bytes')
  })

  it('CAS-includes an observed empty filePath on DELETE so a path-changing POST is not unlinked', async () => {
    seedRow({
      id: ATTACHMENT_ID,
      uploadedById: USER_ID,
      filePath: '',
      fileName: 'old.pdf',
    })

    let nested: { status: number; body: Record<string, unknown> } | null = null
    afterDeleteSnapshot = async () => {
      if (nested) return
      nested = await readJson(await postFile(pdfFile('old.pdf', 'new-bytes'), ATTACHMENT_ID))
    }

    const deleted = await readJson(await deleteAttachment({ attachmentId: ATTACHMENT_ID }))
    const uploaded = nested as { status: number; body: Record<string, unknown> } | null
    if (!uploaded) throw new Error('POST must run between DELETE snapshot and conditional delete')
    assert.equal(uploaded.status, 200)
    assert.equal(deleted.status, 404)
    const row = rows.get(ATTACHMENT_ID)
    assert.ok(row)
    assert.notEqual(row.filePath, '')
    assert.equal(await readStored(row.filePath), 'new-bytes')
  })

  it('returns 500 for non-ENOENT IO errors after a successful row delete', async () => {
    const uploaded = await readJson(await postFile(pdfFile('a.pdf', 'bytes'), OTHER_ATTACHMENT_ID))
    assert.equal(uploaded.status, 200)
    assert.ok(rows.get(OTHER_ATTACHMENT_ID))

    deleteError = ioError('EACCES', 'permission denied')
    const { status, body } = await readJson(await deleteAttachment({ attachmentId: OTHER_ATTACHMENT_ID }))
    assert.equal(status, 500)
    assert.equal(body.error, 'Failed to delete staged file')
    assert.equal(rows.has(OTHER_ATTACHMENT_ID), false)
  })
})
