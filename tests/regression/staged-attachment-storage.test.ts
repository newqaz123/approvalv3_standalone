import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import {
  attachmentFileExists,
  attachmentFileHasSize,
  createRequestDraftCancelledSentinelPath,
  createRequestDraftReadyPath,
  createRequestDraftReservedPath,
  createRequestDraftUploadingPath,
  isRequestDraftCancelledPath,
  isRequestDraftCancelledSentinelPath,
  isRequestDraftClaimablePath,
  isRequestDraftReadyPath,
  isRequestDraftReservedPath,
  isRequestDraftUploadingPath,
  moveAttachmentFile,
  physicalPathsFromCancelledPath,
  readAttachmentFile,
  resolveStoredAttachmentPath,
  toRequestDraftCancelledPath,
  toRequestDraftReadyPath,
  toRequestDraftUploadingPath,
  uploadTokenFromDraftPath,
  writeAttachmentFile,
} from '../../src/lib/attachments/storage'

const UUID = '48929d61-691d-4a70-b677-7d8c985fd308'
const TOKEN = '6f1d2c3b-4a59-4e70-8b1c-2d3e4f5a6b7c'

describe('createRequestDraftUploadingPath / createRequestDraftReadyPath', () => {
  it('returns server-controlled prefixes with attachment and upload-token UUIDs', () => {
    const uploading = createRequestDraftUploadingPath(UUID, TOKEN, 'a b.pdf')
    const ready = createRequestDraftReadyPath(UUID, TOKEN, 'a b.pdf')
    assert.equal(uploading, `request-drafts/uploading/${UUID}/${TOKEN}/a b.pdf`)
    assert.equal(ready, `request-drafts/ready/${UUID}/${TOKEN}/a b.pdf`)
    assert.ok(!uploading.startsWith('/'))
    assert.ok(!ready.startsWith('/'))
    assert.equal(uploading.split('/').length, 5)
    assert.equal(ready.split('/').length, 5)
  })

  it('sanitizes traversal names into a single file segment', () => {
    const uploading = createRequestDraftUploadingPath(UUID, TOKEN, '../../etc/passwd.pdf')
    assert.equal(uploading, `request-drafts/uploading/${UUID}/${TOKEN}/passwd.pdf`)
    assert.ok(!uploading.includes('..'))
  })

  it('rejects invalid attachment or upload token ids', () => {
    assert.throws(() => createRequestDraftUploadingPath('not-a-uuid', TOKEN, 'a.pdf'), /Invalid request draft attachment id/)
    assert.throws(() => createRequestDraftReadyPath(UUID, '../evil', 'a.pdf'), /Invalid request draft upload token/)
    assert.throws(() => createRequestDraftUploadingPath('', TOKEN, 'a.pdf'), /Invalid request draft attachment id/)
  })

  it('round-trips a sanitizer-valid name that contains ..', () => {
    const uploading = createRequestDraftUploadingPath(UUID, TOKEN, 'drawing..pdf')
    const ready = createRequestDraftReadyPath(UUID, TOKEN, 'drawing..pdf')
    assert.equal(isRequestDraftUploadingPath(uploading), true)
    assert.equal(isRequestDraftReadyPath(ready), true)
    assert.equal(toRequestDraftReadyPath(uploading), ready)
  })
})

describe('isRequestDraftUploadingPath / isRequestDraftReadyPath', () => {
  it('is true only for the unprefixed five-segment request-drafts shape', () => {
    const uploading = `request-drafts/uploading/${UUID}/${TOKEN}/a.pdf`
    const ready = `request-drafts/ready/${UUID}/${TOKEN}/a.pdf`
    assert.equal(isRequestDraftUploadingPath(uploading), true)
    assert.equal(isRequestDraftReadyPath(ready), true)
    assert.equal(isRequestDraftReadyPath(uploading), false)
    assert.equal(isRequestDraftUploadingPath(ready), false)
    assert.equal(isRequestDraftUploadingPath(` ${uploading} `), false)
    assert.equal(isRequestDraftReadyPath(createRequestDraftReadyPath(UUID, TOKEN, 'photo.png')), true)
  })

  it('rejects prefixes, traversal, wrong segment counts, and the old stage/ shape', () => {
    const uploading = `request-drafts/uploading/${UUID}/${TOKEN}/a.pdf`
    assert.equal(isRequestDraftUploadingPath(`/${uploading}`), false)
    assert.equal(isRequestDraftUploadingPath(`uploads/${uploading}`), false)
    assert.equal(isRequestDraftReadyPath(`public/uploads/request-drafts/ready/${UUID}/${TOKEN}/a.pdf`), false)
    assert.equal(isRequestDraftUploadingPath(`request-drafts/uploading/${UUID}/a.pdf`), false, 'missing token')
    assert.equal(isRequestDraftUploadingPath(`request-drafts/uploading/not-a-uuid/${TOKEN}/a.pdf`), false)
    assert.equal(isRequestDraftUploadingPath(`request-drafts/uploading/${UUID}/${TOKEN}/foo/bar.pdf`), false)
    assert.equal(isRequestDraftUploadingPath(`request-drafts/uploading/${UUID}/${TOKEN}/..`), false)
    assert.equal(isRequestDraftUploadingPath(`request-drafts\\uploading\\${UUID}\\${TOKEN}\\a.pdf`), false)
    assert.equal(isRequestDraftReadyPath(`stage/${UUID}/a.pdf`), false)
    assert.equal(isRequestDraftUploadingPath(''), false)
  })
})

describe('request-draft reserved and cancelled paths', () => {
  it('reserves a five-segment path that encodes the stable uploadToken', () => {
    const reserved = createRequestDraftReservedPath(UUID, TOKEN, 'a b.pdf')
    assert.equal(reserved, `request-drafts/reserved/${UUID}/${TOKEN}/a b.pdf`)
    assert.equal(isRequestDraftReservedPath(reserved), true)
    assert.equal(isRequestDraftClaimablePath(reserved), true)
    assert.equal(isRequestDraftReadyPath(reserved), false)
    assert.equal(isRequestDraftUploadingPath(reserved), false)
    assert.equal(uploadTokenFromDraftPath(reserved), TOKEN)
    assert.equal(isRequestDraftReservedPath(` ${reserved} `), false)
    assert.equal(isRequestDraftReservedPath(`request-drafts/reserved/${UUID}`), false)
  })

  it('encodes uploading/ready/reserved into cancelled markers that derive physical paths', () => {
    const uploading = createRequestDraftUploadingPath(UUID, TOKEN, 'a b.pdf')
    const ready = createRequestDraftReadyPath(UUID, TOKEN, 'a b.pdf')
    const reserved = createRequestDraftReservedPath(UUID, TOKEN, 'a b.pdf')
    const cancelledUploading = toRequestDraftCancelledPath(uploading)
    const cancelledReady = toRequestDraftCancelledPath(ready)
    const cancelledReserved = toRequestDraftCancelledPath(reserved)
    const sentinel = createRequestDraftCancelledSentinelPath(UUID)

    assert.equal(cancelledUploading, `request-drafts/cancelled/uploading/${UUID}/${TOKEN}/a b.pdf`)
    assert.equal(cancelledReady, `request-drafts/cancelled/ready/${UUID}/${TOKEN}/a b.pdf`)
    assert.equal(cancelledReserved, `request-drafts/cancelled/reserved/${UUID}/${TOKEN}/a b.pdf`)
    assert.equal(sentinel, `request-drafts/cancelled/absent/${UUID}`)
    assert.equal(isRequestDraftCancelledPath(cancelledUploading), true)
    assert.equal(isRequestDraftCancelledPath(cancelledReady), true)
    assert.equal(isRequestDraftCancelledPath(cancelledReserved), true)
    assert.equal(isRequestDraftCancelledSentinelPath(sentinel), true)
    assert.equal(isRequestDraftReadyPath(cancelledReady), false)
    assert.equal(isRequestDraftClaimablePath(cancelledReady), false)
    assert.deepEqual(physicalPathsFromCancelledPath(cancelledUploading), [uploading, ready])
    assert.deepEqual(physicalPathsFromCancelledPath(cancelledReady), [ready])
    assert.deepEqual(physicalPathsFromCancelledPath(cancelledReserved), [])
    assert.deepEqual(physicalPathsFromCancelledPath(sentinel), [])
    assert.equal(toRequestDraftUploadingPath(reserved), uploading)
  })

  it('rejects unrelated paths as cancelled markers', () => {
    assert.equal(isRequestDraftCancelledPath(`request-drafts/ready/${UUID}/${TOKEN}/a.pdf`), false)
    assert.throws(() => toRequestDraftCancelledPath(`stage/${UUID}/a.pdf`), /Not a request-draft path/)
    assert.throws(
      () => physicalPathsFromCancelledPath(createRequestDraftReadyPath(UUID, TOKEN, 'a.pdf')),
      /Not a request-draft cancelled path/,
    )
  })
})

describe('toRequestDraftReadyPath', () => {
  it('swaps only the uploading prefix for the matching ready path', () => {
    const uploading = createRequestDraftUploadingPath(UUID, TOKEN, 'a b.pdf')
    assert.equal(
      toRequestDraftReadyPath(uploading),
      createRequestDraftReadyPath(UUID, TOKEN, 'a b.pdf'),
    )
  })

  it('rejects unrelated stored paths', () => {
    assert.throws(() => toRequestDraftReadyPath(`stage/${UUID}/a.pdf`), /Not a request-draft/)
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
    const stored = `request-drafts/ready/${UUID}/${TOKEN}/a.pdf`
    await mkdir(join(uploadDir, 'request-drafts', 'ready', UUID, TOKEN), { recursive: true })
    await writeFile(join(uploadDir, stored), Buffer.from('pdf'))
    assert.equal(await attachmentFileExists(stored), true)
  })

  it('returns false for a missing path', async () => {
    assert.equal(await attachmentFileExists(`request-drafts/ready/${UUID}/${TOKEN}/missing.pdf`), false)
  })

  it('returns false for a directory under the upload root', async () => {
    const dirPath = `request-drafts/ready/${UUID}/${TOKEN}/subdir`
    await mkdir(join(uploadDir, dirPath), { recursive: true })
    assert.equal(await attachmentFileExists(dirPath), false)
  })

  it('attachmentFileHasSize requires an exact regular-file byte length', async () => {
    const stored = `request-drafts/ready/${UUID}/${TOKEN}/sized.pdf`
    await mkdir(join(uploadDir, 'request-drafts', 'ready', UUID, TOKEN), { recursive: true })
    await writeFile(join(uploadDir, stored), Buffer.from('abcd'))
    assert.equal(await attachmentFileHasSize(stored, 4), true)
    assert.equal(await attachmentFileHasSize(stored, 2), false)
    assert.equal(await attachmentFileHasSize(`request-drafts/ready/${UUID}/${TOKEN}/missing.pdf`, 4), false)
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
    const from = createRequestDraftUploadingPath(UUID, TOKEN, 'a.pdf')
    const to = createRequestDraftReadyPath(UUID, TOKEN, 'a.pdf')
    await writeAttachmentFile(from, Buffer.from('bytes'))
    await moveAttachmentFile(from, to)
    assert.equal(await attachmentFileExists(from), false)
    assert.equal(await attachmentFileExists(to), true)
    assert.equal((await readAttachmentFile(to)).toString(), 'bytes')
  })

  it('fails with EEXIST and does not overwrite a pre-existing destination', async () => {
    const from = createRequestDraftUploadingPath(UUID, TOKEN, 'b.pdf')
    const to = createRequestDraftReadyPath(UUID, TOKEN, 'b.pdf')
    await writeAttachmentFile(from, Buffer.from('new-bytes'))
    await writeAttachmentFile(to, Buffer.from('winner-bytes'))
    await assert.rejects(() => moveAttachmentFile(from, to), { code: 'EEXIST' })
    assert.equal(await attachmentFileExists(from), true)
    assert.equal((await readAttachmentFile(to)).toString(), 'winner-bytes')
  })

  it('unlinks only the owned destination if source unlink fails after a successful link', async () => {
    const from = createRequestDraftUploadingPath(UUID, TOKEN, 'c.pdf')
    const to = createRequestDraftReadyPath(UUID, TOKEN, 'c.pdf')
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
