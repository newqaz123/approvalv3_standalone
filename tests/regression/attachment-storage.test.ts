import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import {
  createStoredAttachmentPath,
  normalizeStoredAttachmentPath,
  resolveStoredAttachmentPath,
  writeAttachmentFile,
  readAttachmentFile,
  deleteAttachmentFile,
} from '../../src/lib/attachments/storage'
import { migrateUploads } from '../../scripts/migrate-uploads'

describe('private attachment storage', () => {
  const root = join(process.cwd(), '.tmp-upload-root')

  it('normalizes legacy public upload paths', () => {
    assert.equal(normalizeStoredAttachmentPath('/public/uploads/request-1/a.pdf'), 'request-1/a.pdf')
    assert.equal(normalizeStoredAttachmentPath('uploads/request-1/a.pdf'), 'request-1/a.pdf')
  })

  it('rejects paths escaping the private root', () => {
    assert.throws(() => resolveStoredAttachmentPath('../../outside.pdf', root), /outside upload root/)
  })

  it('generates a safe relative path independent of display name', () => {
    assert.equal(
      createStoredAttachmentPath('11111111-1111-1111-1111-111111111111', '../../รายงาน.pdf', 'file-id'),
      '11111111-1111-1111-1111-111111111111/file-id-รายงาน.pdf'
    )
  })

  describe('filesystem operations under a private root', () => {
    let uploadDir: string
    const previousUploadDir = process.env.UPLOAD_DIR

    before(async () => {
      uploadDir = await mkdtemp(join(tmpdir(), 'storage-root-'))
      process.env.UPLOAD_DIR = uploadDir
    })

    after(async () => {
      if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR
      else process.env.UPLOAD_DIR = previousUploadDir
      await rm(uploadDir, { recursive: true, force: true })
    })

    it('writes, reads, and deletes attachments inside the root', async () => {
      const stored = 'request-1/abc.txt'
      const payload = Buffer.from('hello private storage')
      await writeAttachmentFile(stored, payload)
      assert.deepEqual(await readAttachmentFile(stored), payload)
      await deleteAttachmentFile(stored)
      await assert.rejects(() => stat(join(uploadDir, stored)), { code: 'ENOENT' })
    })

    it('refuses to write a path that escapes the root', async () => {
      await assert.rejects(() => writeAttachmentFile('../../escape.txt', Buffer.from('x')), /outside upload root/)
    })
  })
})

describe('upload migration', () => {
  it('moves nested files into the destination root and is idempotent on rerun', async () => {
    const source = await mkdtemp(join(tmpdir(), 'mig-src-'))
    const destination = await mkdtemp(join(tmpdir(), 'mig-dst-'))
    try {
      await mkdir(join(source, 'request-1', 'nested'), { recursive: true })
      const srcFile = join(source, 'request-1', 'nested', 'a.pdf')
      const rel = relative(source, srcFile)
      await writeFile(srcFile, Buffer.from('nested-bytes'))

      const first = await migrateUploads({ sourceRoot: source, destinationRoot: destination })
      assert.deepEqual(first.moved, [rel])
      assert.deepEqual(first.skipped, [])
      assert.deepEqual(first.conflicts, [])
      assert.equal((await readFile(join(destination, rel))).toString(), 'nested-bytes')
      await assert.rejects(() => stat(srcFile), { code: 'ENOENT' })

      // Rerun: source is empty, so nothing happens and nothing throws.
      const second = await migrateUploads({ sourceRoot: source, destinationRoot: destination })
      assert.deepEqual(second.moved, [])
      assert.deepEqual(second.skipped, [])
      assert.deepEqual(second.conflicts, [])
    } finally {
      await Promise.all([
        rm(source, { recursive: true, force: true }),
        rm(destination, { recursive: true, force: true }),
      ])
    }
  })

  it('skips equal-size destinations and preserves the source', async () => {
    const source = await mkdtemp(join(tmpdir(), 'mig-src-'))
    const destination = await mkdtemp(join(tmpdir(), 'mig-dst-'))
    try {
      await mkdir(join(destination, 'request-1'), { recursive: true })
      const payload = Buffer.from('same-content')
      await writeFile(join(destination, 'request-1', 'a.pdf'), payload)
      await mkdir(join(source, 'request-1'), { recursive: true })
      const srcFile = join(source, 'request-1', 'a.pdf')
      const rel = relative(source, srcFile)
      await writeFile(srcFile, payload)

      const report = await migrateUploads({ sourceRoot: source, destinationRoot: destination })
      assert.deepEqual(report.skipped, [rel])
      assert.deepEqual(report.moved, [])
      assert.deepEqual(report.conflicts, [])
      // Source is preserved (skip does not delete).
      assert.equal((await stat(srcFile)).size, payload.length)
    } finally {
      await Promise.all([
        rm(source, { recursive: true, force: true }),
        rm(destination, { recursive: true, force: true }),
      ])
    }
  })

  it('reports size conflicts without deleting the source', async () => {
    const source = await mkdtemp(join(tmpdir(), 'mig-src-'))
    const destination = await mkdtemp(join(tmpdir(), 'mig-dst-'))
    try {
      await mkdir(join(destination, 'request-1'), { recursive: true })
      await writeFile(join(destination, 'request-1', 'a.pdf'), Buffer.from('existing-larger-bytes'))
      await mkdir(join(source, 'request-1'), { recursive: true })
      const srcFile = join(source, 'request-1', 'a.pdf')
      const rel = relative(source, srcFile)
      await writeFile(srcFile, Buffer.from('different'))

      const report = await migrateUploads({ sourceRoot: source, destinationRoot: destination })
      assert.deepEqual(report.conflicts, [rel])
      assert.deepEqual(report.moved, [])
      assert.deepEqual(report.skipped, [])
      // Source is preserved on conflict.
      assert.equal((await stat(srcFile)).size, 'different'.length)
      // Destination is left untouched.
      assert.equal(
        (await readFile(join(destination, 'request-1', 'a.pdf'))).toString(),
        'existing-larger-bytes'
      )
    } finally {
      await Promise.all([
        rm(source, { recursive: true, force: true }),
        rm(destination, { recursive: true, force: true }),
      ])
    }
  })

})
