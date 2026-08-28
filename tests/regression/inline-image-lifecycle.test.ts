import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  canReadInlineImage,
  cleanupUnreferencedInlineImages,
  createInlineImageDraft,
  deleteInlineImageDraft,
  type CleanupInlineImageDeps,
  type CreateInlineImageDeps,
  type DeleteInlineImageDeps,
  type InlineImageFile,
  type ReadInlineImageDeps,
} from '../../src/lib/inline-images/lifecycle'
import { prepareInlineImage } from '../../src/lib/inline-images/processing'
import { createStoredInlineImagePath } from '../../src/lib/inline-images/storage'

const USER = '123e4567-e89b-42d3-a456-426614174000'
const OTHER_USER = '123e4567-e89b-42d3-a456-426614174001'
const SESSION = '123e4567-e89b-42d3-a456-426614174002'
const OTHER_SESSION = '123e4567-e89b-42d3-a456-426614174003'
const IMAGE = '123e4567-e89b-42d3-a456-426614174004'

async function createImage(format: 'jpeg' | 'png' | 'webp' | 'gif', width = 3000, height = 2000): Promise<Buffer> {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 90, b: 150 },
    },
  })

  if (format === 'jpeg') return image.jpeg({ quality: 100 }).toBuffer()
  if (format === 'png') return image.png().toBuffer()
  if (format === 'webp') return image.webp({ quality: 100 }).toBuffer()
  return image.gif().toBuffer()
}

function fileFrom(bytes: Buffer, name: string, type: string): InlineImageFile {
  return {
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  }
}

describe('prepareInlineImage', () => {
  it('verifies each supported decoded format and returns prepared dimensions', async () => {
    for (const [format, fileName, mimeType] of [
      ['jpeg', 'floor-plan.jpg', 'image/jpeg'],
      ['png', 'floor-plan.png', 'image/png'],
      ['webp', 'floor-plan.webp', 'image/webp'],
    ] as const) {
      const bytes = await createImage(format)
      const prepared = await prepareInlineImage({ bytes, fileName, mimeType })
      const metadata = await sharp(prepared.bytes).metadata()

      assert.equal(prepared.fileType, mimeType)
      assert.equal(prepared.originalSize, bytes.length)
      assert.equal(prepared.storedSize, prepared.bytes.length)
      assert.equal(prepared.width, metadata.width)
      assert.equal(prepared.height, metadata.height)
      assert.ok(Math.max(prepared.width, prepared.height) <= 2048)
    }
  })

  it('verifies GIF bytes but leaves them unchanged', async () => {
    const bytes = await createImage('gif', 100, 80)
    const prepared = await prepareInlineImage({
      bytes,
      fileName: 'animation.gif',
      mimeType: 'image/gif',
    })

    assert.deepEqual(prepared.bytes, bytes)
    assert.equal(prepared.fileType, 'image/gif')
    assert.equal(prepared.width, 100)
    assert.equal(prepared.height, 80)
  })

  it('rejects declared MIME mismatches, SVG, and corrupt bytes', async () => {
    const jpeg = await createImage('jpeg', 100, 80)
    await assert.rejects(
      () => prepareInlineImage({ bytes: jpeg, fileName: 'plan.png', mimeType: 'image/png' }),
      /unable to process image/i,
    )
    await assert.rejects(
      () => prepareInlineImage({
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>'),
        fileName: 'plan.svg',
        mimeType: 'image/png',
      }),
      /unable to process image/i,
    )
    await assert.rejects(
      () => prepareInlineImage({ bytes: Buffer.from('not an image'), fileName: 'bad.jpg', mimeType: 'image/jpeg' }),
      /unable to process image/i,
    )
  })
})

describe('inline image storage', () => {
  it('uses an inline-image-specific path beneath the private upload root', () => {
    assert.equal(
      createStoredInlineImagePath(USER, '../../floor plan.png', IMAGE),
      `inline-images/${USER}/${IMAGE}-floor plan.png`,
    )
  })
})

describe('createInlineImageDraft', () => {
  it('cleans a bounded expired batch, writes before the row, and compensates a failed row write', async () => {
    const bytes = await createImage('png', 100, 80)
    const calls: string[] = []
    const deps: CreateInlineImageDeps = {
      findActiveUser: async () => true,
      cleanupExpired: async ({ limit }) => {
        calls.push(`cleanup:${limit}`)
        return { deleted: [], warnings: [] }
      },
      findLiveDraftUsage: async () => ({ count: 0, originalSize: 0 }),
      prepareImage: async (input) => prepareInlineImage(input),
      generateId: () => IMAGE,
      createStoredPath: (userId, fileName, id) => createStoredInlineImagePath(userId, fileName, id),
      writeFile: async () => { calls.push('write') },
      createRow: async () => {
        calls.push('row')
        throw new Error('database unavailable')
      },
      deleteFile: async () => { calls.push('compensate') },
    }

    await assert.rejects(
      () => createInlineImageDraft({
        userId: USER,
        uploadSessionId: SESSION,
        file: fileFrom(bytes, 'floor-plan.png', 'image/png'),
      }, deps),
      /database unavailable/i,
    )
    assert.deepEqual(calls, ['cleanup:5', 'write', 'row', 'compensate'])
  })

  it('returns public metadata only after creating an owner/session-scoped draft', async () => {
    const bytes = await createImage('jpeg', 100, 80)
    let row: Parameters<CreateInlineImageDeps['createRow']>[0] | undefined
    const deps: CreateInlineImageDeps = {
      findActiveUser: async () => true,
      cleanupExpired: async () => ({ deleted: [], warnings: [] }),
      findLiveDraftUsage: async () => ({ count: 0, originalSize: 0 }),
      prepareImage: async (input) => prepareInlineImage(input),
      generateId: () => IMAGE,
      createStoredPath: (userId, fileName, id) => createStoredInlineImagePath(userId, fileName, id),
      writeFile: async () => undefined,
      createRow: async (input) => { row = input },
      deleteFile: async () => undefined,
    }

    const upload = await createInlineImageDraft({
      userId: USER,
      uploadSessionId: SESSION,
      file: fileFrom(bytes, 'floor-plan.jpg', 'image/jpeg'),
    }, deps)

    assert.equal(upload.id, IMAGE)
    assert.equal(upload.src, `/api/inline-images/${IMAGE}`)
    assert.equal(upload.alt, 'floor-plan')
    assert.equal(upload.fileType, 'image/jpeg')
    assert.ok(upload.fileSize > 0)
    assert.equal(row?.uploadedById, USER)
    assert.equal(row?.uploadSessionId, SESSION)
    assert.equal(row?.filePath.includes('inline-images/'), true)
  })
})

describe('deleteInlineImageDraft', () => {
  const input = { userId: USER, uploadSessionId: SESSION, imageId: IMAGE }

  it('requires a matching uploader/session and no references through the scoped marker', async () => {
    const deps: DeleteInlineImageDeps = {
      markDeletionPending: async ({ userId, uploadSessionId }) => (
        userId === USER && uploadSessionId === SESSION ? { filePath: 'inline-images/file.png' } : null
      ),
      deleteFile: async () => undefined,
      deleteRow: async () => true,
    }

    await deleteInlineImageDraft(input, deps)
    await assert.rejects(
      () => deleteInlineImageDraft({ ...input, userId: OTHER_USER }, deps),
      /committed, missing, or belongs to another session/i,
    )
    await assert.rejects(
      () => deleteInlineImageDraft({ ...input, uploadSessionId: OTHER_SESSION }, deps),
      /committed, missing, or belongs to another session/i,
    )
  })

  it('keeps the deletion-pending marker when physical deletion fails so cleanup can retry', async () => {
    const draft: { filePath: string; deletionPendingAt: Date | null } = {
      filePath: 'inline-images/file.png',
      deletionPendingAt: null,
    }
    const deps: DeleteInlineImageDeps = {
      markDeletionPending: async () => {
        draft.deletionPendingAt = new Date()
        return { filePath: draft.filePath }
      },
      deleteRow: async () => true,
      deleteFile: async () => { throw new Error('disk') },
    }

    await assert.rejects(() => deleteInlineImageDraft(input, deps), /could not be deleted/i)
    assert.equal(draft.deletionPendingAt instanceof Date, true)
  })

  it('treats an already-missing physical file as deleted', async () => {
    let deletedRow = false
    const deps: DeleteInlineImageDeps = {
      markDeletionPending: async () => ({ filePath: 'inline-images/missing.png' }),
      deleteFile: async () => {
        const error = Object.assign(new Error('missing'), { code: 'ENOENT' })
        throw error
      },
      deleteRow: async () => {
        deletedRow = true
        return true
      },
    }

    await deleteInlineImageDraft(input, deps)
    assert.equal(deletedRow, true)
  })
})

describe('cleanupUnreferencedInlineImages', () => {
  it('marks candidates before deleting and preserves failed rows for retry warnings', async () => {
    const marked: string[] = []
    const deps: CleanupInlineImageDeps = {
      findCandidates: async ({ limit }) => {
        assert.equal(limit, 2)
        return [
          { id: IMAGE, filePath: 'inline-images/first.png' },
          { id: '123e4567-e89b-42d3-a456-426614174005', filePath: 'inline-images/second.png' },
        ]
      },
      markDeletionPending: async (imageId) => {
        marked.push(imageId)
        return { filePath: `inline-images/${imageId}.png` }
      },
      deleteFile: async (filePath) => {
        if (filePath.includes('4005')) throw new Error('disk')
      },
      deleteRow: async () => true,
    }

    const result = await cleanupUnreferencedInlineImages({ olderThan: new Date(), limit: 2 }, deps)
    assert.deepEqual(marked, [IMAGE, '123e4567-e89b-42d3-a456-426614174005'])
    assert.deepEqual(result.deleted, [IMAGE])
    assert.equal(result.warnings.length, 1)
  })
})

describe('canReadInlineImage', () => {
  it('restricts unreferenced drafts to their active uploader and uses visible references when committed', async () => {
    const draftDeps: ReadInlineImageDeps = {
      findActiveUser: async () => ({ isActive: true, role: 'general_dept' }),
      findImage: async () => ({ uploadedById: USER, references: [] }),
      canUserViewRequest: async () => false,
    }
    assert.equal(await canReadInlineImage(USER, IMAGE, draftDeps), true)
    assert.equal(await canReadInlineImage(OTHER_USER, IMAGE, draftDeps), false)

    const requestDeps: ReadInlineImageDeps = {
      findActiveUser: async () => ({ isActive: true, role: 'general_dept' }),
      findImage: async () => ({
        uploadedById: USER,
        references: [{ requestId: 'request-1', solution: null, template: null }],
      }),
      canUserViewRequest: async (userId, requestId) => userId === OTHER_USER && requestId === 'request-1',
    }
    assert.equal(await canReadInlineImage(OTHER_USER, IMAGE, requestDeps), true)
  })

  it('permits active templates to active users and inactive templates only to admins', async () => {
    const templateDeps = (
      userIsActive: boolean,
      role: string,
      templateIsActive: boolean,
    ): ReadInlineImageDeps => ({
      findActiveUser: async () => ({ isActive: userIsActive, role }),
      findImage: async () => ({
        uploadedById: USER,
        references: [{ requestId: null, solution: null, template: { isActive: templateIsActive } }],
      }),
      canUserViewRequest: async () => false,
    })

    assert.equal(await canReadInlineImage(OTHER_USER, IMAGE, templateDeps(true, 'general_dept', true)), true)
    assert.equal(await canReadInlineImage(OTHER_USER, IMAGE, templateDeps(true, 'general_dept', false)), false)
    assert.equal(await canReadInlineImage(OTHER_USER, IMAGE, templateDeps(true, 'admin', false)), true)
    assert.equal(await canReadInlineImage(OTHER_USER, IMAGE, templateDeps(false, 'admin', false)), false)
  })
})
