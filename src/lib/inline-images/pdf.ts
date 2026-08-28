import prisma from '@/lib/prisma'
import { renderFormattedTextHtml } from '@/lib/formatted-text'
import {
  INLINE_IMAGE_MIMES,
  extractInlineImageIds,
  inlineImageAltPlaceholder,
  parseInlineImageSrc,
} from '@/lib/inline-images/policy'
import { readInlineImageFile } from '@/lib/inline-images/storage'
import { containsRichTextHtml, sanitizeRichText } from '@/lib/rich-text-sanitizer'

export type PdfInlineImageOwner =
  | { kind: 'request'; id: string }
  | { kind: 'solution'; id: string }

export type PdfInlineImageAsset = {
  id: string
  fileType: string
  filePath: string
}

/** Narrow database/storage adapter for PDF resolution tests and production. */
export type ResolveInlineImagesForPdfDeps = {
  findImages(input: {
    imageIds: string[]
    owner: PdfInlineImageOwner
  }): Promise<PdfInlineImageAsset[]>
  readFile(filePath: string): Promise<Buffer>
}

/** Owner-constrained reference filter for the production reference query. */
export function pdfInlineImageOwnerWhere(owner: PdfInlineImageOwner) {
  return owner.kind === 'request'
    ? { requestId: owner.id }
    : { solutionId: owner.id }
}

const productionResolveInlineImagesForPdfDeps: ResolveInlineImagesForPdfDeps = {
  findImages: ({ imageIds, owner }) =>
    prisma.inline_description_images.findMany({
      where: {
        id: { in: imageIds },
        references: { some: pdfInlineImageOwnerWhere(owner) },
      },
      select: { id: true, fileType: true, filePath: true },
    }),
  readFile: readInlineImageFile,
}

// Sanitized <img> output is deterministic: quoted attributes with entity-encoded
// values, so these tag-level substitutions cannot cross attribute boundaries.
const IMG_TAG_RE = /<img\b[^>]*>/gi
const SRC_ATTRIBUTE_RE = /\ssrc\s*=\s*"[^"]*"/i

function imgSrcId(tag: string): string | null {
  const match = SRC_ATTRIBUTE_RE.exec(tag)
  // match[0] is ` src="<value>"`; the value sits between the quotes.
  const value = match?.[0]?.slice(6, -1)
  return value ? parseInlineImageSrc(value) : null
}

/**
 * Server-only trusted-HTML renderer for exported descriptions.
 *
 * Sanitizes first, then embeds an image only when its canonical ID is
 * referenced by the exported owner. The data-URI output is substituted into
 * the server-generated PDF HTML only; it is never persisted to the database.
 * Invalid, missing, or non-owner-referenced images degrade to escaped alt text
 * instead of failing the export.
 */
export async function resolveInlineImagesForPdf(
  input: { html: string; owner: PdfInlineImageOwner },
  deps: ResolveInlineImagesForPdfDeps = productionResolveInlineImagesForPdfDeps,
): Promise<string> {
  // Legacy **bold** descriptions can never reference images.
  if (!containsRichTextHtml(input.html)) {
    return renderFormattedTextHtml(input.html)
  }

  const sanitized = sanitizeRichText(input.html)
  const imageIds = extractInlineImageIds(sanitized)
  if (imageIds.length === 0) {
    return sanitized
  }

  const dataUris = new Map<string, string>()
  try {
    const assets = await deps.findImages({ imageIds, owner: input.owner })
    const byId = new Map(assets.map((asset) => [asset.id, asset]))

    for (const imageId of imageIds) {
      const asset = byId.get(imageId)
      // Only the stored verified MIME is ever embedded; a tampered row value
      // (for example image/svg+xml) must degrade to alt text.
      if (!asset || !INLINE_IMAGE_MIMES.has(asset.fileType)) continue

      try {
        const bytes = await deps.readFile(asset.filePath)
        if (bytes.length === 0) continue
        dataUris.set(imageId, `data:${asset.fileType};base64,${bytes.toString('base64')}`)
      } catch (error) {
        console.warn(
          `[resolveInlineImagesForPdf] Failed to read inline image ${imageId}`,
          error,
        )
      }
    }
  } catch (error) {
    console.warn('[resolveInlineImagesForPdf] Failed to resolve inline images', error)
  }

  return sanitized.replace(IMG_TAG_RE, (tag) => {
    const imageId = imgSrcId(tag)
    const dataUri = imageId ? dataUris.get(imageId) : undefined
    if (dataUri) {
      return tag.replace(SRC_ATTRIBUTE_RE, ` src="${dataUri}"`)
    }
    // The attribute value is already entity-encoded by sanitize-html, so the
    // placeholder text is escaped for the HTML context it lands in.
    return inlineImageAltPlaceholder(tag)
  })
}
