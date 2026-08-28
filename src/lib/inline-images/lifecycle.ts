import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { MAX_ATTACHMENT_BYTES, sanitizeAttachmentFileName, validateAttachmentMetadata } from '@/lib/attachments/policy'
import {
  INLINE_IMAGE_MIMES,
  MAX_INLINE_ALT_LENGTH,
  MAX_INLINE_DESCRIPTION_BYTES,
  MAX_INLINE_IMAGES,
  canonicalInlineImageSrc,
  type InlineImageUpload,
} from '@/lib/inline-images/policy'
import { prepareInlineImage, type PreparedInlineImage } from '@/lib/inline-images/processing'
import {
  createStoredInlineImagePath,
  deleteInlineImageFile,
  writeInlineImageFile,
} from '@/lib/inline-images/storage'
import { canUserViewRequest } from '@/lib/request-access'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_CLEANUP_LIMIT = 100
const UPLOAD_CLEANUP_LIMIT = 5
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class InlineImageValidationError extends Error {
  readonly status = 400 as const
}

export class InlineImageForbiddenError extends Error {
  readonly status = 403 as const
}

export class InlineImagePayloadTooLargeError extends Error {
  readonly status = 413 as const
}

export type InlineImageFile = {
  name: string
  type: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export type CreateInlineImageRowInput = {
  id: string
  uploadedById: string
  uploadSessionId: string
  fileName: string
  fileType: string
  originalSize: number
  fileSize: number
  filePath: string
  width: number
  height: number
}

export type InlineImageCleanupResult = {
  deleted: string[]
  warnings: string[]
}

/** Narrow database/storage adapter for draft creation tests and production. */
export type CreateInlineImageDeps = {
  findActiveUser(userId: string): Promise<boolean>
  cleanupExpired(input: { olderThan: Date; limit: number }): Promise<InlineImageCleanupResult>
  findLiveDraftUsage(input: { userId: string; uploadSessionId: string }): Promise<{
    count: number
    originalSize: number
  }>
  prepareImage(input: { bytes: Buffer; fileName: string; mimeType: string }): Promise<PreparedInlineImage>
  generateId(): string
  createStoredPath(userId: string, fileName: string, id: string): string
  writeFile(filePath: string, bytes: Buffer): Promise<void>
  createRow(input: CreateInlineImageRowInput): Promise<void>
  deleteFile(filePath: string): Promise<void>
}

/** Narrow database/storage adapter for owner/session-scoped draft deletion. */
export type DeleteInlineImageDeps = {
  markDeletionPending(input: {
    imageId: string
    userId: string
    uploadSessionId: string
  }): Promise<{ filePath: string } | null>
  deleteFile(filePath: string): Promise<void>
  deleteRow(imageId: string): Promise<boolean>
}

/** Narrow database/storage adapter for expiry cleanup. */
export type CleanupInlineImageDeps = {
  findCandidates(input: { olderThan: Date; limit: number }): Promise<Array<{ id: string }>>
  markDeletionPending(imageId: string): Promise<{ filePath: string } | null>
  deleteFile(filePath: string): Promise<void>
  deleteRow(imageId: string): Promise<boolean>
}

export type InlineImageReadRow = {
  uploadedById: string
  references: Array<{
    requestId: string | null
    solution: { requestId: string } | null
    template: { isActive: boolean } | null
  }>
}

/** Narrow database/authorization adapter for private image reads. */
export type ReadInlineImageDeps = {
  findActiveUser(userId: string): Promise<{ isActive: boolean; role: string } | null>
  findImage(imageId: string): Promise<InlineImageReadRow | null>
  canUserViewRequest(userId: string, requestId: string): Promise<boolean>
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function defaultAlt(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName
  return baseName.slice(0, MAX_INLINE_ALT_LENGTH)
}

function validateInlineImageFile(file: InlineImageFile): void {
  if (!file || typeof file.name !== 'string' || file.name.trim().length === 0) {
    throw new InlineImageValidationError('Image file name is required')
  }
  if (typeof file.type !== 'string' || !Number.isFinite(file.size) || file.size <= 0) {
    throw new InlineImageValidationError('Image file metadata is invalid')
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new InlineImagePayloadTooLargeError('Image exceeds the 10 MB limit')
  }

  const mimeType = file.type.toLowerCase()
  if (!INLINE_IMAGE_MIMES.has(mimeType)) {
    throw new InlineImageValidationError('Image type is not supported')
  }

  const policyError = validateAttachmentMetadata({
    name: file.name,
    type: mimeType,
    size: file.size,
  })
  if (policyError) throw new InlineImageValidationError(policyError)
}

async function readFileBytes(file: InlineImageFile): Promise<Buffer> {
  let bytes: Buffer
  try {
    bytes = Buffer.from(await file.arrayBuffer())
  } catch {
    throw new InlineImageValidationError('Unable to read image')
  }

  if (bytes.length === 0) throw new InlineImageValidationError('Image file is empty')
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new InlineImagePayloadTooLargeError('Image exceeds the 10 MB limit')
  }
  return bytes
}

function normalizeCleanupLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_CLEANUP_LIMIT
  if (!Number.isInteger(limit) || limit < 0) {
    throw new InlineImageValidationError('Cleanup limit is invalid')
  }
  return limit
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}

async function deleteMarkedInlineImage(
  imageId: string,
  marked: { filePath: string },
  deps: Pick<DeleteInlineImageDeps, 'deleteFile' | 'deleteRow'>,
): Promise<void> {
  try {
    await deps.deleteFile(marked.filePath)
  } catch (error) {
    // A missing file means an earlier attempt completed physical deletion; the
    // pending row still needs removing to make retry cleanup idempotent.
    if (!isMissingFile(error)) throw error
  }

  const deleted = await deps.deleteRow(imageId)
  if (!deleted) throw new Error('Inline image row was no longer deletable')
}

async function markOwnedInlineImageDeletion(input: {
  imageId: string
  userId: string
  uploadSessionId: string
}): Promise<{ filePath: string } | null> {
  return prisma.$transaction(async (tx) => {
    // Locking the asset row before setting the marker prevents a reference
    // claim from racing a physical delete. Reference creation rejects pending
    // assets, while deleteRow rechecks both pending state and zero references.
    const rows = await tx.$queryRaw<Array<{ filePath: string }>>`
      SELECT "filePath"
      FROM "inline_description_images"
      WHERE "id" = ${input.imageId}
        AND "uploadedById" = ${input.userId}
        AND "uploadSessionId" = ${input.uploadSessionId}
        AND NOT EXISTS (
          SELECT 1
          FROM "inline_description_image_references"
          WHERE "imageId" = "inline_description_images"."id"
        )
      FOR UPDATE
    `
    const row = rows[0]
    if (!row) return null

    await tx.inline_description_images.update({
      where: { id: input.imageId },
      data: { deletionPendingAt: new Date() },
    })
    return row
  })
}

async function markExpiredInlineImageDeletion(imageId: string): Promise<{ filePath: string } | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ filePath: string }>>`
      SELECT "filePath"
      FROM "inline_description_images"
      WHERE "id" = ${imageId}
        AND NOT EXISTS (
          SELECT 1
          FROM "inline_description_image_references"
          WHERE "imageId" = "inline_description_images"."id"
        )
      FOR UPDATE
    `
    const row = rows[0]
    if (!row) return null

    await tx.inline_description_images.update({
      where: { id: imageId },
      data: { deletionPendingAt: new Date() },
    })
    return row
  })
}

const productionCreateInlineImageDeps: CreateInlineImageDeps = {
  findActiveUser: async (userId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    })
    return Boolean(user?.isActive)
  },
  cleanupExpired: async (input) => cleanupUnreferencedInlineImages(input),
  findLiveDraftUsage: async ({ userId, uploadSessionId }) => {
    const where = {
      uploadedById: userId,
      uploadSessionId,
      deletionPendingAt: null,
      references: { none: {} },
    }
    const [count, sizes] = await Promise.all([
      prisma.inline_description_images.count({ where }),
      prisma.inline_description_images.aggregate({ where, _sum: { originalSize: true } }),
    ])
    return { count, originalSize: sizes._sum.originalSize ?? 0 }
  },
  prepareImage: prepareInlineImage,
  generateId: randomUUID,
  createStoredPath: createStoredInlineImagePath,
  writeFile: writeInlineImageFile,
  createRow: async (input) => {
    await prisma.inline_description_images.create({ data: input })
  },
  deleteFile: deleteInlineImageFile,
}

const productionDeleteInlineImageDeps: DeleteInlineImageDeps = {
  markDeletionPending: markOwnedInlineImageDeletion,
  deleteFile: deleteInlineImageFile,
  deleteRow: async (imageId) => {
    const result = await prisma.inline_description_images.deleteMany({
      where: {
        id: imageId,
        deletionPendingAt: { not: null },
        references: { none: {} },
      },
    })
    return result.count === 1
  },
}

const productionCleanupInlineImageDeps: CleanupInlineImageDeps = {
  findCandidates: async ({ olderThan, limit }) => prisma.inline_description_images.findMany({
    where: {
      createdAt: { lt: olderThan },
      references: { none: {} },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  }),
  markDeletionPending: markExpiredInlineImageDeletion,
  deleteFile: deleteInlineImageFile,
  deleteRow: productionDeleteInlineImageDeps.deleteRow,
}

const productionReadInlineImageDeps: ReadInlineImageDeps = {
  findActiveUser: async (userId) => prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true },
  }),
  findImage: async (imageId) => prisma.inline_description_images.findUnique({
    where: { id: imageId },
    select: {
      uploadedById: true,
      references: {
        select: {
          requestId: true,
          solution: { select: { requestId: true } },
          template: { select: { isActive: true } },
        },
      },
    },
  }),
  canUserViewRequest,
}

/**
 * Creates an unreferenced, owner/session-scoped draft. Physical bytes are
 * persisted first; a failed database insert receives best-effort compensation.
 */
export async function createInlineImageDraft(
  input: { userId: string; uploadSessionId: string; file: InlineImageFile },
  deps: CreateInlineImageDeps = productionCreateInlineImageDeps,
): Promise<InlineImageUpload> {
  if (!isUuid(input.uploadSessionId)) {
    throw new InlineImageValidationError('Upload session id is invalid')
  }
  if (!(await deps.findActiveUser(input.userId))) {
    throw new InlineImageForbiddenError('User is not active')
  }

  validateInlineImageFile(input.file)
  const bytes = await readFileBytes(input.file)
  const mimeType = input.file.type.toLowerCase()
  const fileName = sanitizeAttachmentFileName(input.file.name)

  try {
    // Expiry cleanup is opportunistic. A transient cleanup error must not make
    // a new valid upload fail before it has written any bytes.
    await deps.cleanupExpired({
      olderThan: new Date(Date.now() - DAY_MS),
      limit: UPLOAD_CLEANUP_LIMIT,
    })
  } catch (error) {
    console.warn('[createInlineImageDraft] Failed to clean expired inline images', error)
  }

  const usage = await deps.findLiveDraftUsage({
    userId: input.userId,
    uploadSessionId: input.uploadSessionId,
  })
  if (usage.count >= MAX_INLINE_IMAGES) {
    throw new InlineImageValidationError(`An upload session can contain at most ${MAX_INLINE_IMAGES} images`)
  }
  if (usage.originalSize + bytes.length > MAX_INLINE_DESCRIPTION_BYTES) {
    throw new InlineImagePayloadTooLargeError('Upload session image bytes exceed the 100 MB limit')
  }

  let prepared: PreparedInlineImage
  try {
    prepared = await deps.prepareImage({ bytes, fileName, mimeType })
  } catch {
    throw new InlineImageValidationError('Unable to process image')
  }

  const id = deps.generateId()
  const filePath = deps.createStoredPath(input.userId, fileName, id)
  await deps.writeFile(filePath, prepared.bytes)

  try {
    await deps.createRow({
      id,
      uploadedById: input.userId,
      uploadSessionId: input.uploadSessionId,
      fileName,
      fileType: prepared.fileType,
      originalSize: prepared.originalSize,
      fileSize: prepared.storedSize,
      filePath,
      width: prepared.width,
      height: prepared.height,
    })
  } catch (error) {
    try {
      await deps.deleteFile(filePath)
    } catch (cleanupError) {
      console.warn('[createInlineImageDraft] Failed to compensate inline image storage write', cleanupError)
    }
    throw error
  }

  return {
    id,
    src: canonicalInlineImageSrc(id),
    alt: defaultAlt(fileName),
    fileType: prepared.fileType,
    fileSize: prepared.storedSize,
    width: prepared.width,
    height: prepared.height,
  }
}

/**
 * Marks an owner/session-scoped unreferenced draft before physical deletion.
 * Any failed physical deletion intentionally leaves deletionPendingAt set for a
 * later cleanup attempt.
 */
export async function deleteInlineImageDraft(
  input: { userId: string; uploadSessionId: string; imageId: string },
  deps: DeleteInlineImageDeps = productionDeleteInlineImageDeps,
): Promise<void> {
  const marked = await deps.markDeletionPending({
    imageId: input.imageId,
    userId: input.userId,
    uploadSessionId: input.uploadSessionId,
  })
  if (!marked) {
    throw new Error('Image is committed, missing, or belongs to another session')
  }

  try {
    await deleteMarkedInlineImage(input.imageId, marked, deps)
  } catch {
    throw new Error('Image could not be deleted; cleanup will retry')
  }
}

/** Removes expired unreferenced assets without clearing retry markers on failure. */
export async function cleanupUnreferencedInlineImages(
  input: { olderThan: Date; limit?: number },
  deps: CleanupInlineImageDeps = productionCleanupInlineImageDeps,
): Promise<InlineImageCleanupResult> {
  if (!(input.olderThan instanceof Date) || Number.isNaN(input.olderThan.valueOf())) {
    throw new InlineImageValidationError('Cleanup cutoff is invalid')
  }
  const limit = normalizeCleanupLimit(input.limit)
  const candidates = await deps.findCandidates({ olderThan: input.olderThan, limit })
  const deleted: string[] = []
  const warnings: string[] = []

  for (const candidate of candidates) {
    const marked = await deps.markDeletionPending(candidate.id)
    if (!marked) continue

    try {
      await deleteMarkedInlineImage(candidate.id, marked, deps)
      deleted.push(candidate.id)
    } catch {
      warnings.push(`Inline image ${candidate.id} could not be deleted; cleanup will retry`)
    }
  }

  return { deleted, warnings }
}

/** Applies draft ownership and existing request/template visibility to image reads. */
export async function canReadInlineImage(
  userId: string,
  imageId: string,
  deps: ReadInlineImageDeps = productionReadInlineImageDeps,
): Promise<boolean> {
  const user = await deps.findActiveUser(userId)
  if (!user?.isActive) return false

  const image = await deps.findImage(imageId)
  if (!image) return false
  if (image.references.length === 0) return image.uploadedById === userId

  for (const reference of image.references) {
    const requestId = reference.requestId ?? reference.solution?.requestId
    if (requestId && await deps.canUserViewRequest(userId, requestId)) return true

    if (reference.template?.isActive || (reference.template && user.role === 'admin')) {
      return true
    }
  }
  return false
}
