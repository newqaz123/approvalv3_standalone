import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { canReadInlineImage } from '@/lib/inline-images/lifecycle'
import {
  extractInlineImageIds,
  MAX_INLINE_DESCRIPTION_BYTES,
  MAX_INLINE_IMAGES,
} from '@/lib/inline-images/policy'
import { sanitizeRichText } from '@/lib/rich-text-sanitizer'

export type PreparedInlineDescription = {
  html: string
  imageIds: string[]
  uploadSessionId: string
}

export type InlineImageOwner =
  | { kind: 'request'; id: string }
  | { kind: 'solution'; id: string }
  | { kind: 'template'; id: string }

export type InlineDescriptionImageRow = {
  id: string
  uploadedById: string
  uploadSessionId: string
  fileSize: number
  deletionPendingAt: Date | null
  references: Array<{ id: string }>
}

/** Narrow loader/authorization boundary for preparation tests and production. */
export type PrepareInlineDescriptionDeps = {
  findImages(imageIds: string[]): Promise<InlineDescriptionImageRow[]>
  canReadInlineImage(userId: string, imageId: string): Promise<boolean>
}

const productionPrepareInlineDescriptionDeps: PrepareInlineDescriptionDeps = {
  findImages: (imageIds) => prisma.inline_description_images.findMany({
    where: { id: { in: imageIds } },
    select: {
      id: true,
      uploadedById: true,
      uploadSessionId: true,
      fileSize: true,
      deletionPendingAt: true,
      references: { select: { id: true } },
    },
  }),
  canReadInlineImage,
}

function unavailableInlineImageError(): Error {
  return new Error('One or more inline images are not available')
}

/**
 * Canonicalizes a submitted description and validates every referenced asset
 * before its owning save transaction starts.
 */
export async function prepareInlineDescription(
  input: { description: string; userId: string; uploadSessionId: string },
  deps: PrepareInlineDescriptionDeps = productionPrepareInlineDescriptionDeps,
): Promise<PreparedInlineDescription> {
  const html = sanitizeRichText(input.description)
  const imageIds = extractInlineImageIds(html)

  if (imageIds.length > MAX_INLINE_IMAGES) {
    throw new Error(`A description can contain at most ${MAX_INLINE_IMAGES} images`)
  }

  const images = await deps.findImages(imageIds)
  if (images.length !== imageIds.length) {
    throw unavailableInlineImageError()
  }

  let storedBytes = 0
  for (const image of images) {
    if (image.deletionPendingAt) {
      throw unavailableInlineImageError()
    }

    if (image.references.length === 0) {
      if (
        image.uploadedById !== input.userId
        || image.uploadSessionId !== input.uploadSessionId
      ) {
        throw unavailableInlineImageError()
      }
    } else if (!(await deps.canReadInlineImage(input.userId, image.id))) {
      throw unavailableInlineImageError()
    }

    storedBytes += image.fileSize
  }

  if (storedBytes > MAX_INLINE_DESCRIPTION_BYTES) {
    throw new Error('Description inline image bytes exceed the 100 MB limit')
  }

  return { html, imageIds, uploadSessionId: input.uploadSessionId }
}

/**
 * Rechecks claimed assets and reconciles one owner’s reference rows within the
 * caller-provided owner save transaction.
 */
export async function reconcileInlineDescriptionImages(
  tx: Prisma.TransactionClient,
  input: { owner: InlineImageOwner; imageIds: string[] },
): Promise<void> {
  if (input.imageIds.length > 0) {
    const currentImages = await tx.inline_description_images.findMany({
      where: {
        id: { in: input.imageIds },
        deletionPendingAt: null,
      },
      select: { id: true },
    })
    if (currentImages.length !== input.imageIds.length) {
      throw unavailableInlineImageError()
    }
  }

  const ownerWhere = input.owner.kind === 'request'
    ? { requestId: input.owner.id }
    : input.owner.kind === 'solution'
      ? { solutionId: input.owner.id }
      : { templateId: input.owner.id }

  await tx.inline_description_image_references.deleteMany({
    where: input.imageIds.length > 0
      ? { ...ownerWhere, imageId: { notIn: input.imageIds } }
      : ownerWhere,
  })

  if (input.imageIds.length > 0) {
    await tx.inline_description_image_references.createMany({
      data: input.imageIds.map((imageId) => ({ imageId, ...ownerWhere })),
      skipDuplicates: true,
    })
  }
}
