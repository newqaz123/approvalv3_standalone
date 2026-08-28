import sharp from 'sharp'
import { optimizeImageAttachment } from '@/lib/attachments/image-optimization'

const EXPECTED_FORMATS = new Map<string, string>([
  ['image/jpeg', 'jpeg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

export type PreparedInlineImage = {
  bytes: Buffer
  originalSize: number
  storedSize: number
  fileType: string
  width: number
  height: number
}

/**
 * Verifies declared image MIME against decoded bytes, then applies the existing
 * attachment optimizer before returning only verified, stored-image metadata.
 */
export async function prepareInlineImage(input: {
  bytes: Buffer
  fileName: string
  mimeType: string
}): Promise<PreparedInlineImage> {
  try {
    const fileType = input.mimeType.toLowerCase()
    const decoded = await sharp(input.bytes, { animated: true }).metadata()
    if (EXPECTED_FORMATS.get(fileType) !== decoded.format) {
      throw new Error('Unsupported decoded format')
    }

    // GIFs are verified above; optimizeImageAttachment intentionally keeps
    // their original bytes while normalizing eligible raster formats.
    const optimized = await optimizeImageAttachment({
      bytes: input.bytes,
      fileName: input.fileName,
      mimeType: fileType,
    })
    const finalMeta = await sharp(optimized.bytes, { animated: true }).metadata()
    if (!finalMeta.width || !finalMeta.height || EXPECTED_FORMATS.get(fileType) !== finalMeta.format) {
      throw new Error('Prepared image metadata is invalid')
    }

    return {
      bytes: optimized.bytes,
      originalSize: optimized.originalSize,
      storedSize: optimized.storedSize,
      fileType,
      width: finalMeta.width,
      height: finalMeta.height,
    }
  } catch {
    throw new Error('Unable to process image')
  }
}
