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
  INLINE_IMAGE_CROP_SCALE,
  materializeInlineImageDisplayWidth,
  parseInlineImagePresentation,
  type InlineImageFrameGeometry,
  type InlineImagePresentation,
} from '@/lib/inline-images/presentation'
import { readInlineImageFile } from '@/lib/inline-images/storage'
import { materializeRichTextPalette } from '@/lib/rich-text-palette'
import { materializeTableCellWidths } from '@/lib/rich-text-presentation'
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

function serializeGeometryNumber(value: number): string | null {
  return Number.isFinite(value) ? String(value) : null
}

function geometryDeclaration(name: string, value: number, unit: string): string | null {
  const serialized = serializeGeometryNumber(value)
  return serialized === null ? null : `${name}:${serialized}${unit}`
}

function joinStyle(parts: Array<string | null>): string {
  return parts.filter((part): part is string => part !== null).join(';')
}

const FULL_SOURCE_CROP = {
  x: 0,
  y: 0,
  width: INLINE_IMAGE_CROP_SCALE,
  height: INLINE_IMAGE_CROP_SCALE,
}

function unrotatedPdfFallback(
  tag: string,
  dataUri: string,
  presentation: InlineImagePresentation,
  attributes: Record<string, string>,
): string {
  const imageTag = tag.replace(SRC_ATTRIBUTE_RE, ` src="${dataUri}"`)
  const aligned = materializeInlineImageDisplayWidth(imageTag, presentation.displayWidth)
  if (presentation.layout !== 'inline') return aligned

  const alt = attributes.alt ?? ''
  const align = normalizeInlineImageAlignment(attributes['data-align'])
  const width = presentation.displayWidth
  const frameStyle = width === null ? '' : ` style="width:${String(width)}px"`
  const widthAttr = width === null ? '' : ` width="${String(width)}"`
  return `<span class="rich-text__image-frame" data-layout="inline" data-align="${align}"${frameStyle}><img src="${dataUri}" alt="${alt}"${widthAttr} /></span>`
}

function materializeTrustedPdfImage(
  dataUri: string,
  attributes: Record<string, string>,
  presentation: InlineImagePresentation,
  geometry: InlineImageFrameGeometry,
): string {
  const alt = attributes.alt ?? ''
  const align = normalizeInlineImageAlignment(attributes['data-align'])
  const layoutAttr = presentation.layout === 'inline' ? ' data-layout="inline"' : ''
  const frameStyle = joinStyle([
    geometryDeclaration('width', geometry.frameWidth, 'px'),
    geometryDeclaration('aspect-ratio', geometry.aspectRatio, ''),
  ])
  const imageStyle = joinStyle([
    geometryDeclaration('width', geometry.imageWidthPercent, '%'),
    geometryDeclaration('height', geometry.imageHeightPercent, '%'),
    geometryDeclaration('left', geometry.imageOffsetXPercent, '%'),
    geometryDeclaration('top', geometry.imageOffsetYPercent, '%'),
  ])
  const image = `<img src="${dataUri}" alt="${alt}" style="${imageStyle}" />`
  if (geometry.rotation === 0) {
    return `<span class="rich-text__image-frame"${layoutAttr} data-align="${align}" style="${frameStyle}">${image}</span>`
  }

  const sceneStyle = joinStyle([
    geometryDeclaration('width', geometry.sceneWidth / geometry.frameWidth * 100, '%'),
    geometryDeclaration('height', geometry.sceneHeight / geometry.frameHeight * 100, '%'),
    geometryDeclaration('left', geometry.sceneOffsetX / geometry.frameWidth * 100, '%'),
    geometryDeclaration('top', geometry.sceneOffsetY / geometry.frameHeight * 100, '%'),
    `transform:rotate(${geometry.rotation}deg)`,
  ])
  return `<span class="rich-text__image-frame"${layoutAttr} data-align="${align}" style="${frameStyle}"><span class="rich-text__image-scene" style="${sceneStyle}">${image}</span></span>`
}

function materializePdfImage(
  tag: string,
  dataUri: string,
  asset: PdfInlineImageAsset,
): string {
  const attributes = sanitizedImageAttributes(tag)
  const presentation = parseInlineImagePresentation(attributes)
  const crop = presentation.crop ?? (
    presentation.rotation !== 0 ? FULL_SOURCE_CROP : null
  )
  if (crop === null) {
    return unrotatedPdfFallback(tag, dataUri, presentation, attributes)
  }

  // The persisted natural dimensions are presentation metadata only. Geometry
  // always uses the authorized asset row dimensions as its trust source.
  const geometry = computeInlineImageFrameGeometry({
    crop,
    naturalWidth: asset.width,
    naturalHeight: asset.height,
    displayWidth: presentation.displayWidth,
    rotation: presentation.rotation,
  })
  if (geometry === null) {
    return unrotatedPdfFallback(tag, dataUri, presentation, attributes)
  }
  return materializeTrustedPdfImage(dataUri, attributes, presentation, geometry)
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
    return materializeTableCellWidths(materializeRichTextPalette(sanitized, 'pdf'))
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
  const paletteHtml = materializeTableCellWidths(
    materializeRichTextPalette(sanitized, 'pdf'),
  )
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
