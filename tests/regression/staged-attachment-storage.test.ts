import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import {
  allocateRequestDraftGenerationPaths,
  attachmentFileExists,
  createRequestDraftReadyPath,
  createRequestDraftUploadingPath,
  isRequestDraftReadyPath,
  isRequestDraftUploadingPath,
  moveAttachmentFile,
  readAttachmentFile,
  resolveStoredAttachmentPath,
  toRequestDraftReadyPath,
  writeAttachmentFile,
} from '../../src/lib/attachments/storage'

const UUID = '48929d61-691d-4a70-b677-7d8c985fd308'
const GENERATION = '6f1d2c3b-4a59-4e70-8b1c-2d3e4f5a6b7c'

describe('createRequestDraftUploadingPath / createRequestDraftReadyPath', () => {
  it('returns server-controlled prefixes with attachment and generation UUIDs', () => {
    const uploading = createRequestDraftUploadingPath(UUID, GENERATION, 'a b.pdf')
    const ready = createRequestDraftReadyPath(UUID, GENERATION, 'a b.pdf')
    assert.equal(uploading, `request-drafts/uploading/${UUID}/${GENERATION}/a b.pdf`)
    assert.equal(ready, `request-drafts/ready/${UUID}/${GENERATION}/a b.pdf`)
    assert.ok(!uploading.startsWith('/'))
    assert.ok(!ready.startsWith('/'))
    assert.equal(uploading.split('/').length, 5)
    assert.equal(ready.split('/').length, 5)
  })

  it('sanitizes traversal names into a single file segment', () => {
    const uploading = createRequestDraftUploadingPath(UUID, GENERATION, '../../etc/passwd.pdf')
    assert.equal(uploading, `request-drafts/uploading/${UUID}/${GENERATION}/passwd.pdf`)
    assert.ok(!uploading.includes('..'))
  })

  it('rejects invalid attachment or generation ids', () => {
    assert.throws(() => createRequestDraftUploadingPath('not-a-uuid', GENERATION, 'a.pdf'), /Invalid request draft attachment id/)
    assert.throws(() => createRequestDraftReadyPath(UUID, '../evil', 'a.pdf'), /Invalid request draft generation id/)
    assert.throws(() => createRequestDraftUploadingPath('', GENERATION, 'a.pdf'), /Invalid request draft attachment id/)
  })

  it('round-trips a sanitizer-valid name that contains ..', () => {
    const uploading = createRequestDraftUploadingPath(UUID, GENERATION, 'drawing..pdf')
    const ready = createRequestDraftReadyPath(UUID, GENERATION, 'drawing..pdf')
    assert.equal(isRequestDraftUploadingPath(uploading), true)
    assert.equal(isRequestDraftReadyPath(ready), true)
    assert.equal(toRequestDraftReadyPath(uploading), ready)
  })
})

describe('isRequestDraftUploadingPath / isRequestDraftReadyPath', () => {
  it('is true only for the unprefixed five-segment request-drafts shape', () => {
    const uploading = `request-drafts/uploading/${UUID}/${GENERATION}/a.pdf`
    const ready = `request-drafts/ready/${UUID}/${GENERATION}/a.pdf`
    assert.equal(isRequestDraftUploadingPath(uploading), true)
    assert.equal(isRequestDraftReadyPath(ready), true)
    assert.equal(isRequestDraftReadyPath(uploading), false)
    assert.equal(isRequestDraftUploadingPath(ready), false)
    assert.equal(isRequestDraftUploadingPath(` ${uploading} `), false)
    assert.equal(isRequestDraftReadyPath(createRequestDraftReadyPath(UUID, GENERATION, 'photo.png')), true)
  })

  it('rejects prefixes, traversal, wrong segment counts, and the old stage/ shape', () => {
    const uploading = `request-drafts/uploading/${UUID}/${GENERATION}/a.pdf`
    assert.equal(isRequestDraftUploadingPath(`/${uploading}`), false)
    assert.equal(isRequestDraftUploadingPath(`uploads/${uploading}`), false)
    assert.equal(isRequestDraftReadyPath(`public/uploads/request-drafts/ready/${UUID}/${GENERATION}/a.pdf`), false)
    assert.equal(isRequestDraftUploadingPath(`request-drafts/uploading/${UUID}/a.pdf`), false, 'missing generation')
    assert.equal(isRequestDraftUploadingPath(`request-drafts/uploading/not-a-uuid/${GENERATION}/a.pdf`), false)
    assert.equal(isRequestDraftUploadingPath(`request-drafts/uploading/${UUID}/${GENERATION}/foo/bar.pdf`), false)
    assert.equal(isRequestDraftUploadingPath(`request-drafts/uploading/${UUID}/${GENERATION}/..`), false)
    assert.equal(isRequestDraftUploadingPath(`request-drafts\\uploading\\${UUID}\\${GENERATION}\\a.pdf`), false)
    assert.equal(isRequestDraftReadyPath(`stage/${UUID}/a.pdf`), false)
    assert.equal(isRequestDraftUploadingPath(''), false)
  })
})

describe('toRequestDraftReadyPath', () => {
  it('swaps only the uploading prefix for the matching ready path', () => {
    const uploading = createRequestDraftUploadingPath(UUID, GENERATION, 'a b.pdf')
    assert.equal(
      toRequestDraftReadyPath(uploading),
      createRequestDraftReadyPath(UUID, GENERATION, 'a b.pdf'),
    )
  })

  it('rejects ready paths and unrelated stored paths', () => {
    assert.throws(
      () => toRequestDraftReadyPath(createRequestDraftReadyPath(UUID, GENERATION, 'a.pdf')),
      /Not a request-draft uploading path/,
    )
    assert.throws(() => toRequestDraftReadyPath(`stage/${UUID}/a.pdf`), /Not a request-draft uploading path/)
  })
})

describe('attachmentFileExists', () => {
  let uploadDir: string
  const previousUploadDir = process.env.UPLOAD_DIR

  before(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'staged-exists-'))
    process.env.UPLOAD_DIR = uploadDir
  })

  after(async () => {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR
    else process.env.UPLOAD_DIR = previousUploadDir
    await rm(uploadDir, { recursive: true, force: true })
  })

  it('returns true for an existing regular file', async () => {
    const stored = `request-drafts/ready/${UUID}/${GENERATION}/a.pdf`
    await mkdir(join(uploadDir, 'request-drafts', 'ready', UUID, GENERATION), { recursive: true })
    await writeFile(join(uploadDir, stored), Buffer.from('pdf'))
    assert.equal(await attachmentFileExists(stored), true)
  })

  it('returns false for a missing path', async () => {
    assert.equal(await attachmentFileExists(`request-drafts/ready/${UUID}/${GENERATION}/missing.pdf`), false)
  })

  it('returns false for a directory under the upload root', async () => {
    const dirPath = `request-drafts/ready/${UUID}/${GENERATION}/subdir`
    await mkdir(join(uploadDir, dirPath), { recursive: true })
    assert.equal(await attachmentFileExists(dirPath), false)
  })
})

describe('allocateRequestDraftGenerationPaths', () => {
  it('skips a UUID that repeats the observed uploading path', () => {
    const observed = createRequestDraftUploadingPath(UUID, GENERATION, 'a.pdf')
    const nextGen = '11111111-2222-4333-8444-555555555555'
    const ids = [GENERATION, nextGen]
    let n = 0
    const allocated = allocateRequestDraftGenerationPaths(UUID, 'a.pdf', observed, () => ids[n++] ?? 'exhausted')
    assert.equal(n, 2)
    assert.equal(allocated.generationId, nextGen)
    assert.equal(allocated.uploadingPath, createRequestDraftUploadingPath(UUID, nextGen, 'a.pdf'))
    assert.equal(allocated.readyPath, createRequestDraftReadyPath(UUID, nextGen, 'a.pdf'))
  })

  it('skips a UUID that repeats the observed ready path', () => {
    const observed = createRequestDraftReadyPath(UUID, GENERATION, 'a.pdf')
    const nextGen = '11111111-2222-4333-8444-555555555555'
    const ids = [GENERATION, nextGen]
    let n = 0
    const allocated = allocateRequestDraftGenerationPaths(UUID, 'a.pdf', observed, () => ids[n++] ?? 'exhausted')
    assert.equal(allocated.generationId, nextGen)
    assert.equal(n, 2)
  })

  it('throws after a bounded number of collisions', () => {
    const observed = createRequestDraftUploadingPath(UUID, GENERATION, 'a.pdf')
    assert.throws(
      () => allocateRequestDraftGenerationPaths(UUID, 'a.pdf', observed, () => GENERATION),
      /Unable to allocate a distinct request-draft generation path/,
    )
  })
})

describe('moveAttachmentFile', () => {
  let uploadDir: string
  const previousUploadDir = process.env.UPLOAD_DIR

  before(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'staged-move-'))
    process.env.UPLOAD_DIR = uploadDir
  })

  after(async () => {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR
    else process.env.UPLOAD_DIR = previousUploadDir
    await rm(uploadDir, { recursive: true, force: true })
  })

  it('publishes with an exclusive same-filesystem link and removes the source', async () => {
    const from = createRequestDraftUploadingPath(UUID, GENERATION, 'a.pdf')
    const to = createRequestDraftReadyPath(UUID, GENERATION, 'a.pdf')
    await writeAttachmentFile(from, Buffer.from('bytes'))
    await moveAttachmentFile(from, to)
    assert.equal(await attachmentFileExists(from), false)
    assert.equal(await attachmentFileExists(to), true)
    assert.equal((await readAttachmentFile(to)).toString(), 'bytes')
  })

  it('fails with EEXIST and does not overwrite a pre-existing destination', async () => {
    const from = createRequestDraftUploadingPath(UUID, GENERATION, 'b.pdf')
    const to = createRequestDraftReadyPath(UUID, GENERATION, 'b.pdf')
    await writeAttachmentFile(from, Buffer.from('new-bytes'))
    await writeAttachmentFile(to, Buffer.from('winner-bytes'))
    await assert.rejects(() => moveAttachmentFile(from, to), { code: 'EEXIST' })
    assert.equal(await attachmentFileExists(from), true)
    assert.equal((await readAttachmentFile(to)).toString(), 'winner-bytes')
  })

  it('unlinks only the owned destination if source unlink fails after a successful link', async () => {
    const from = createRequestDraftUploadingPath(UUID, GENERATION, 'c.pdf')
    const to = createRequestDraftReadyPath(UUID, GENERATION, 'c.pdf')
    await writeAttachmentFile(from, Buffer.from('owned-bytes'))
    const sourceDir = dirname(resolveStoredAttachmentPath(from))
    await chmod(sourceDir, 0o555)
    try {
      await assert.rejects(() => moveAttachmentFile(from, to), (error: NodeJS.ErrnoException) => {
        assert.ok(error.code === 'EACCES' || error.code === 'EPERM')
        return true
      })
      assert.equal(await attachmentFileExists(from), true)
      assert.equal((await readAttachmentFile(from)).toString(), 'owned-bytes')
      assert.equal(await attachmentFileExists(to), false)
    } finally {
      await chmod(sourceDir, 0o755)
    }
  })
})
