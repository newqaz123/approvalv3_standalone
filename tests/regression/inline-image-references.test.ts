import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { markInlineImageDeletionPending } from '@/lib/inline-images/lifecycle'
import {
  MAX_INLINE_DESCRIPTION_BYTES,
  MAX_INLINE_IMAGES,
} from '@/lib/inline-images/policy'
import {
  prepareInlineDescription,
  reconcileInlineDescriptionImages,
  type InlineDescriptionImageRow,
  type PrepareInlineDescriptionDeps,
} from '@/lib/inline-images/references'

const USER = '123e4567-e89b-42d3-a456-426614174000'
const OTHER_USER = '123e4567-e89b-42d3-a456-426614174001'
const SESSION = '123e4567-e89b-42d3-a456-426614174002'
const OTHER_SESSION = '123e4567-e89b-42d3-a456-426614174003'

function imageId(index: number): string {
  return `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`
}

function image(
  id: string,
  overrides: Partial<InlineDescriptionImageRow> = {},
): InlineDescriptionImageRow {
  return {
    id,
    uploadedById: USER,
    uploadSessionId: SESSION,
    fileSize: 1024,
    deletionPendingAt: null,
    references: [],
    ...overrides,
  }
}

function prepareDeps(
  images: InlineDescriptionImageRow[],
  canReadInlineImage: PrepareInlineDescriptionDeps['canReadInlineImage'] = async () => false,
): PrepareInlineDescriptionDeps {
  return {
    findImages: async (ids) => images.filter((candidate) => ids.includes(candidate.id)),
    canReadInlineImage,
  }
}

function descriptionFor(ids: string[]): string {
  return `<p>${ids.map((id) => `<img src="/api/inline-images/${id}">`).join('')}</p>`
}

describe('prepareInlineDescription', () => {
  it('sanitizes before extracting canonical IDs', async () => {
    const id = imageId(10)
    const prepared = await prepareInlineDescription({
      description: `<p>x<img src="https://untrusted.example/image.png"><img src="/api/inline-images/${id}"></p>`,
      userId: USER,
      uploadSessionId: SESSION,
    }, prepareDeps([image(id)]))

    assert.deepEqual(prepared.imageIds, [id])
    assert.equal(prepared.html.includes('/api/inline-images/'), true)
    assert.equal(prepared.html.includes('untrusted.example'), false)
    assert.equal(prepared.uploadSessionId, SESSION)
  })

  it('rejects missing assets, another user draft, and a draft from another session', async () => {
    const missing = imageId(11)
    await assert.rejects(
      () => prepareInlineDescription({
        description: descriptionFor([missing]),
        userId: USER,
        uploadSessionId: SESSION,
      }, prepareDeps([])),
      /not available/i,
    )

    const anotherUsersDraft = imageId(12)
    await assert.rejects(
      () => prepareInlineDescription({
        description: descriptionFor([anotherUsersDraft]),
        userId: USER,
        uploadSessionId: SESSION,
      }, prepareDeps([image(anotherUsersDraft, { uploadedById: OTHER_USER })])),
      /not available/i,
    )

    const anotherSessionDraft = imageId(13)
    await assert.rejects(
      () => prepareInlineDescription({
        description: descriptionFor([anotherSessionDraft]),
        userId: USER,
        uploadSessionId: SESSION,
      }, prepareDeps([image(anotherSessionDraft, { uploadSessionId: OTHER_SESSION })])),
      /not available/i,
    )
  })

  it('rejects deletion-pending and unauthorized committed assets', async () => {
    const pending = imageId(14)
    await assert.rejects(
      () => prepareInlineDescription({
        description: descriptionFor([pending]),
        userId: USER,
        uploadSessionId: SESSION,
      }, prepareDeps([image(pending, { deletionPendingAt: new Date() })])),
      /not available/i,
    )

    const committed = imageId(15)
    await assert.rejects(
      () => prepareInlineDescription({
        description: descriptionFor([committed]),
        userId: USER,
        uploadSessionId: SESSION,
      }, prepareDeps([image(committed, { references: [{ id: 'template-reference' }] })])),
      /not available/i,
    )
  })

  it('enforces description image count and stored-byte limits', async () => {
    const tooMany = Array.from({ length: MAX_INLINE_IMAGES + 1 }, (_, index) => imageId(index + 20))
    await assert.rejects(
      () => prepareInlineDescription({
        description: descriptionFor(tooMany),
        userId: USER,
        uploadSessionId: SESSION,
      }, prepareDeps(tooMany.map((id) => image(id)))),
      /at most 10 images/i,
    )

    const largeImages = [imageId(40), imageId(41)]
    await assert.rejects(
      () => prepareInlineDescription({
        description: descriptionFor(largeImages),
        userId: USER,
        uploadSessionId: SESSION,
      }, prepareDeps(largeImages.map((id) => image(id, {
        fileSize: (MAX_INLINE_DESCRIPTION_BYTES / 2) + 1,
      })))),
      /100 MB/i,
    )
  })

  it('allows the current session draft and authorized committed template reuse', async () => {
    const draft = imageId(50)
    const templateImage = imageId(51)
    const authorizationCalls: Array<{ userId: string; imageId: string }> = []

    const prepared = await prepareInlineDescription({
      description: descriptionFor([draft, templateImage]),
      userId: USER,
      uploadSessionId: SESSION,
    }, prepareDeps([
      image(draft),
      image(templateImage, { references: [{ id: 'template-reference' }] }),
    ], async (userId, id) => {
      authorizationCalls.push({ userId, imageId: id })
      return id === templateImage
    }))

    assert.deepEqual(prepared.imageIds, [draft, templateImage])
    assert.deepEqual(authorizationCalls, [{ userId: USER, imageId: templateImage }])
  })
})

type FakeReference = {
  imageId: string
  requestId?: string
  solutionId?: string
  templateId?: string
}

class FakeReferenceTransaction {
  readonly references: FakeReference[]
  readonly availableImageIds: Set<string>
  readonly writes: string[] = []

  constructor(references: FakeReference[], availableImageIds: string[]) {
    this.references = references.map((reference) => ({ ...reference }))
    this.availableImageIds = new Set(availableImageIds)
  }

  asTransaction(): Prisma.TransactionClient {
    return {
      $queryRaw: async (query: TemplateStringsArray) => {
        assert.match(query.join('?'), /FROM "inline_description_images"[\s\S]*FOR UPDATE/)
        this.writes.push('lock-images')
        return [...this.availableImageIds].map((id) => ({ id }))
      },
      inline_description_images: {
        findMany: async ({ where }: { where: { id: { in: string[] }; deletionPendingAt: null } }) => {
          assert.equal(where.deletionPendingAt, null)
          this.writes.push('read-images')
          return where.id.in
            .filter((id) => this.availableImageIds.has(id))
            .map((id) => ({ id }))
        },
      },
      inline_description_image_references: {
        deleteMany: async ({ where }: { where: {
          requestId?: string
          solutionId?: string
          templateId?: string
          imageId?: { notIn: string[] }
        } }) => {
          this.writes.push('delete-references')
          const remaining = this.references.filter((reference) => {
            const ownerMatches = (
              (where.requestId === undefined || reference.requestId === where.requestId)
              && (where.solutionId === undefined || reference.solutionId === where.solutionId)
              && (where.templateId === undefined || reference.templateId === where.templateId)
            )
            const imageMatches = !where.imageId || !where.imageId.notIn.includes(reference.imageId)
            return !(ownerMatches && imageMatches)
          })
          const count = this.references.length - remaining.length
          this.references.splice(0, this.references.length, ...remaining)
          return { count }
        },
        createMany: async ({ data }: { data: FakeReference[] }) => {
          this.writes.push('create-references')
          for (const reference of data) {
            const duplicate = this.references.some((candidate) => (
              candidate.imageId === reference.imageId
              && candidate.requestId === reference.requestId
              && candidate.solutionId === reference.solutionId
              && candidate.templateId === reference.templateId
            ))
            if (!duplicate) this.references.push({ ...reference })
          }
          return { count: data.length }
        },
      },
    } as unknown as Prisma.TransactionClient
  }
}

describe('reconcileInlineDescriptionImages', () => {
  it('creates missing references, removes only the current owner stale rows, and leaves other owners intact', async () => {
    const keep = imageId(60)
    const add = imageId(61)
    const stale = imageId(62)
    const tx = new FakeReferenceTransaction([
      { imageId: keep, requestId: 'request-current' },
      { imageId: stale, requestId: 'request-current' },
      { imageId: stale, solutionId: 'solution-other' },
      { imageId: add, templateId: 'template-other' },
    ], [keep, add])

    await reconcileInlineDescriptionImages(tx.asTransaction(), {
      owner: { kind: 'request', id: 'request-current' },
      imageIds: [keep, add],
    })

    assert.deepEqual(
      tx.references.filter((reference) => reference.requestId === 'request-current'),
      [
        { imageId: keep, requestId: 'request-current' },
        { imageId: add, requestId: 'request-current' },
      ],
    )
    assert.equal(
      tx.references.some((reference) => reference.imageId === stale && reference.solutionId === 'solution-other'),
      true,
    )
    assert.equal(
      tx.references.some((reference) => reference.imageId === add && reference.templateId === 'template-other'),
      true,
    )
    assert.deepEqual(tx.writes, ['lock-images', 'delete-references', 'create-references'])
  })

  it('fails before reference writes when the transactional re-read misses a deletion-pending asset', async () => {
    const available = imageId(70)
    const pending = imageId(71)
    const tx = new FakeReferenceTransaction([], [available])

    await assert.rejects(
      () => reconcileInlineDescriptionImages(tx.asTransaction(), {
        owner: { kind: 'template', id: 'template-current' },
        imageIds: [available, pending],
      }),
      /not available/i,
    )

    assert.deepEqual(tx.writes, ['lock-images'])
    assert.deepEqual(tx.references, [])
  })

  it('serializes cleanup marking behind a description claim and rechecks references after locking', async () => {
    const claimed = imageId(72)
    const references = new Set<string>()
    let releaseOwnerLock: () => void = () => {}
    const ownerLockReleased = new Promise<void>((resolve) => { releaseOwnerLock = resolve })
    let releaseOwnerLockAcquired: () => void = () => {}
    const ownerLockAcquired = new Promise<void>((resolve) => { releaseOwnerLockAcquired = resolve })

    const ownerTx = {
      $queryRaw: async (query: TemplateStringsArray) => {
        assert.match(query.join('?'), /FROM "inline_description_images"[\s\S]*FOR UPDATE/)
        releaseOwnerLockAcquired()
        return [{ id: claimed }]
      },
      inline_description_images: {},
      inline_description_image_references: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => {
          references.add(claimed)
          return { count: 1 }
        },
      },
    } as unknown as Prisma.TransactionClient

    const cleanupWrites: string[] = []
    const cleanupTx = {
      $queryRaw: async (query: TemplateStringsArray) => {
        assert.match(query.join('?'), /FROM "inline_description_images"[\s\S]*FOR UPDATE/)
        await ownerLockReleased
        cleanupWrites.push('lock')
        return [{ filePath: 'inline-images/claimed.png' }]
      },
      inline_description_images: {
        update: async () => {
          cleanupWrites.push('mark')
          return {}
        },
      },
      inline_description_image_references: {
        findFirst: async () => {
          cleanupWrites.push('recheck')
          return references.size > 0 ? { id: 'existing-reference' } : null
        },
      },
    } as unknown as Prisma.TransactionClient

    const reconciliation = reconcileInlineDescriptionImages(ownerTx, {
      owner: { kind: 'request', id: 'request-current' },
      imageIds: [claimed],
    })
    await ownerLockAcquired

    let cleanupFinished = false
    const cleanup = markInlineImageDeletionPending(cleanupTx, {
      kind: 'expired',
      imageId: claimed,
    }).then((result) => {
      cleanupFinished = true
      return result
    })
    await Promise.resolve()
    assert.equal(cleanupFinished, false)

    await reconciliation
    releaseOwnerLock()

    assert.equal(await cleanup, null)
    assert.deepEqual(cleanupWrites, ['lock', 'recheck'])
  })
})
