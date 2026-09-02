import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import {
  attachmentFileExists,
  createStagedAttachmentPath,
  isStagedAttachmentPath,
} from '../../src/lib/attachments/storage'

const UUID = '48929d61-691d-4a70-b677-7d8c985fd308'

describe('createStagedAttachmentPath', () => {
  it('returns nested stage/<uuid>/<sanitized-name> with no leading slash', () => {
    assert.equal(createStagedAttachmentPath(UUID, 'a b.pdf'), `stage/${UUID}/a b.pdf`)
    const p = createStagedAttachmentPath(UUID, 'my drawing (v2).pdf')
    assert.equal(p, `stage/${UUID}/my drawing (v2).pdf`)
    assert.ok(!p.startsWith('/'))
    assert.ok(!p.includes('..'))
    assert.equal(p.split('/').length, 3)
  })

  it('rejects traversal names and keeps a single nested file segment', () => {
    const p = createStagedAttachmentPath(UUID, '../../etc/passwd.pdf')
    assert.equal(p, `stage/${UUID}/passwd.pdf`)
    assert.ok(!p.includes('..'))
    assert.ok(!p.includes('/etc/'))
  })

  it('rejects an invalid stagedId so it cannot inject traversal', () => {
    assert.throws(() => createStagedAttachmentPath('not-a-uuid', 'a.pdf'), /Invalid staged attachment id/)
    assert.throws(() => createStagedAttachmentPath('../evil', 'a.pdf'), /Invalid staged attachment id/)
    assert.throws(() => createStagedAttachmentPath('uuid', 'a b.pdf'), /Invalid staged attachment id/)
    assert.throws(() => createStagedAttachmentPath('', 'a.pdf'), /Invalid staged attachment id/)
  })

  it('round-trips a sanitizer-valid name that contains ..', () => {
    const p = createStagedAttachmentPath(UUID, 'drawing..pdf')
    assert.equal(p, `stage/${UUID}/drawing..pdf`)
    assert.equal(isStagedAttachmentPath(p), true)
  })
})

describe('isStagedAttachmentPath', () => {
  it('is true only for unprefixed stage/<uuid>/<filename>', () => {
    assert.equal(isStagedAttachmentPath(`stage/${UUID}/a.pdf`), true)
    assert.equal(isStagedAttachmentPath(` stage/${UUID}/a.pdf `), true, 'trims')
    assert.equal(isStagedAttachmentPath(createStagedAttachmentPath(UUID, 'photo.png')), true)
    assert.equal(isStagedAttachmentPath(`stage/${UUID}/drawing..pdf`), true, 'sanitizer-valid .. substring')
  })

  it('rejects invalid UUIDs, flat stage paths, prefixes, traversal, and non-stage paths', () => {
    assert.equal(isStagedAttachmentPath(`stage/${UUID}-a.pdf`), false, 'flat stage path')
    assert.equal(isStagedAttachmentPath('stage/not-a-uuid/file.pdf'), false, 'invalid UUID')
    assert.equal(isStagedAttachmentPath('stage/'), false, 'missing uuid and name')
    assert.equal(isStagedAttachmentPath(`stage/${UUID}`), false, 'missing filename')
    assert.equal(isStagedAttachmentPath(`stage/${UUID}/`), false, 'empty filename')
    assert.equal(isStagedAttachmentPath(`/stage/${UUID}/file.pdf`), false, 'leading slash')
    assert.equal(isStagedAttachmentPath(`uploads/stage/${UUID}/file.pdf`), false, 'uploads prefix')
    assert.equal(isStagedAttachmentPath(`public/uploads/stage/${UUID}/file.pdf`), false, 'public/uploads prefix')
    assert.equal(isStagedAttachmentPath(`${UUID}/abc-photo.pdf`), false, 'regular attachment dir')
    assert.equal(isStagedAttachmentPath('stage/../../etc/passwd'), false, 'traversal after stage/')
    assert.equal(isStagedAttachmentPath('../stage/x.pdf'), false, 'leading traversal')
    assert.equal(isStagedAttachmentPath('/absolute/stage/x.pdf'), false, 'absolute path')
    assert.equal(isStagedAttachmentPath('stagey/x.pdf'), false, 'prefix lookalike')
    assert.equal(isStagedAttachmentPath(''), false, 'empty')
    assert.equal(isStagedAttachmentPath(`stage\\${UUID}\\file.pdf`), false, 'backslashes')
    assert.equal(isStagedAttachmentPath(`stage/${UUID}/foo/bar.pdf`), false, 'extra nested segments')
    assert.equal(isStagedAttachmentPath(`stage/${UUID}/..`), false, 'exact .. filename segment')
    assert.equal(isStagedAttachmentPath(`stage/${UUID}/.`), false, 'exact . filename segment')
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
    const stored = `stage/${UUID}/a.pdf`
    await mkdir(join(uploadDir, 'stage', UUID), { recursive: true })
    await writeFile(join(uploadDir, stored), Buffer.from('pdf'))
    assert.equal(await attachmentFileExists(stored), true)
  })

  it('returns false for a missing path', async () => {
    assert.equal(await attachmentFileExists(`stage/${UUID}/missing.pdf`), false)
  })

  it('returns false for a directory under the upload root', async () => {
    const dirPath = `stage/${UUID}/subdir`
    await mkdir(join(uploadDir, dirPath), { recursive: true })
    assert.equal(await attachmentFileExists(dirPath), false)
  })
})
