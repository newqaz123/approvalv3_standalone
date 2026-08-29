import prisma from '@/lib/prisma'
import { renderFormattedTextHtml } from '@/lib/formatted-text'
import {
  INLINE_IMAGE_MIMES,
  extractInlineImageIds,
  inlineImageAltPlaceholder,
  normalizeInlineImageAlignment,
  parseInlineImageSrc,
} from '@/lib/inline-images/policy'
import {
  computeInlineImageFrameGeometry,
  parseInlineImagePresentation,
} from '@/lib/inline-images/presentation'
import { readInlineImageFile } from '@/lib/inline-images/storage'
import { materializeRichTextPalette } from '@/lib/rich-text-palette'
import { containsRichTextHtml, sanitizeRichText } from '@/lib/rich-text-sanitizer'

export type PdfInlineImageOwner =
  | { kind: 'request'; id: string }
  | { kind: 'solution'; id: string }

export type PdfInlineImageAsset = {
  id: string
  fileType: string
  filePath: string
  /** Authoritative dimensions from the stored, verified image row. */
  width: number
  height: number
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
      select: { id: true, fileType: true, filePath: true, width: true, height: true },
    }),
  readFile: readInlineImageFile,
}

// Sanitized <img> output is deterministic: quoted attributes with entity-encoded
// values, so these tag-level substitutions cannot cross attribute boundaries.
const IMG_TAG_RE = /<img\b[^>]*>/gi
const SRC_ATTRIBUTE_RE = /\ssrc\s*=\s*"[^"]*"/i
const SANITIZED_ATTRIBUTE_RE = /(?:^|\s)([a-z][a-z0-9-]*)="([^"]*)"/gi

function sanitizedImageAttributes(imageHtml: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of imageHtml.matchAll(SANITIZED_ATTRIBUTE_RE)) {
    attributes[match[1]!] = match[2]!
  }
  return attributes
}

function imgSrcId(tag: string): string | null {
  const match = SRC_ATTRIBUTE_RE.exec(tag)
  // match[0] is ` src="<value>"`; the value sits between the quotes.
  const value = match?.[0]?.slice(6, -1)
  return value ? parseInlineImageSrc(value) : null
}

function serializeGeometryNumber(value: number): string {
  return String(value)
}

function materializePdfImage(
  tag: string,
  dataUri: string,
  asset: PdfInlineImageAsset,
): string {
  const attributes = sanitizedImageAttributes(tag)
  const presentation = parseInlineImagePresentation(attributes)
  const imageTag = tag.replace(SRC_ATTRIBUTE_RE, ` src="${dataUri}"`)

  if (
    presentation.crop === null
    || presentation.naturalWidth === null
    || presentation.naturalHeight === null
  ) {
    return imageTag
  }

  // The persisted natural dimensions are presentation metadata only. Geometry
  // always uses the authorized asset row dimensions as its trust source.
  const geometry = computeInlineImageFrameGeometry({
    crop: presentation.crop,
    naturalWidth: asset.width,
    naturalHeight: asset.height,
    displayWidth: presentation.displayWidth,
  })
  if (geometry === null) return imageTag

  const frameStyle = [
    `width:${serializeGeometryNumber(geometry.frameWidth)}px`,
    `aspect-ratio:${serializeGeometryNumber(geometry.aspectRatio)}`,
  ].join(';')
  const imageStyle = [
    `width:${serializeGeometryNumber(geometry.imageWidthPercent)}%`,
    `height:${serializeGeometryNumber(geometry.imageHeightPercent)}%`,
    `left:${serializeGeometryNumber(geometry.imageOffsetXPercent)}%`,
    `top:${serializeGeometryNumber(geometry.imageOffsetYPercent)}%`,
  ].join(';')

  const align = normalizeInlineImageAlignment(attributes['data-align'])
  const alt = attributes.alt ?? ''
  return `<span class="rich-text__image-frame" data-align="${align}" style="${frameStyle}"><img src="${dataUri}" alt="${alt}" style="${imageStyle}" /></span>`
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
  // Legacy **bold** descriptions can never reference images, but still pass
  // through the same trusted PDF palette materializer.
  const sanitized = containsRichTextHtml(input.html)
    ? sanitizeRichText(input.html)
    : renderFormattedTextHtml(input.html)
  const imageIds = extractInlineImageIds(sanitized)
  if (imageIds.length === 0) {
    return materializeRichTextPalette(sanitized, 'pdf')
  }

  const dataUris = new Map<string, { dataUri: string; asset: PdfInlineImageAsset }>()
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
        dataUris.set(imageId, {
          dataUri: `data:${asset.fileType};base64,${bytes.toString('base64')}`,
          asset,
        })
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

  // Materialize palette marks after authorization and byte resolution, before
  // adding generated crop-frame attributes; the image frame is trusted output,
  // not authored presentation input.
  const paletteHtml = materializeRichTextPalette(sanitized, 'pdf')
  return paletteHtml.replace(IMG_TAG_RE, (tag) => {
    const imageId = imgSrcId(tag)
    const resolved = imageId ? dataUris.get(imageId) : undefined
    if (resolved) {
      return materializePdfImage(tag, resolved.dataUri, resolved.asset)
    }
    // The attribute value is already entity-encoded by sanitize-html, so the
    // placeholder text is escaped for the HTML context it lands in.
    return inlineImageAltPlaceholder(tag)
  })
}
