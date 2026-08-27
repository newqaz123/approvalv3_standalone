import sharp from 'sharp'

export const MAX_OPTIMIZED_IMAGE_EDGE = 2048
export const OPTIMIZED_IMAGE_QUALITY = 82

export interface ImageOptimizationResult {
  bytes: Buffer
  originalSize: number
  storedSize: number
  optimized: boolean
}

type OptimizableFormat = 'jpeg' | 'png' | 'webp'

function extensionOf(fileName: string): string {
  const baseName = fileName.toLowerCase().split(/[\\/]/).pop() ?? ''
  const dot = baseName.lastIndexOf('.')
  return dot === -1 ? '' : baseName.slice(dot + 1)
}

function getOptimizableFormat(fileName: string, mimeType: string): OptimizableFormat | null {
  const extension = extensionOf(fileName)
  const mime = mimeType.toLowerCase()
  if (mime === 'image/jpeg' && (extension === 'jpg' || extension === 'jpeg')) return 'jpeg'
  if (mime === 'image/png' && extension === 'png') return 'png'
  if (mime === 'image/webp' && extension === 'webp') return 'webp'
  return null
}

export async function optimizeImageAttachment(input: {
  bytes: Buffer
  fileName: string
  mimeType: string
}): Promise<ImageOptimizationResult> {
  const originalSize = input.bytes.length
  const format = getOptimizableFormat(input.fileName, input.mimeType)
  if (!format) {
    return { bytes: input.bytes, originalSize, storedSize: originalSize, optimized: false }
  }

  const resized = sharp(input.bytes)
    .rotate()
    .resize({
      width: MAX_OPTIMIZED_IMAGE_EDGE,
      height: MAX_OPTIMIZED_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })

  const transformed = format === 'jpeg'
    ? await resized.jpeg({ quality: OPTIMIZED_IMAGE_QUALITY, mozjpeg: true }).toBuffer()
    : format === 'webp'
      ? await resized.webp({ quality: OPTIMIZED_IMAGE_QUALITY }).toBuffer()
      : await resized.png({
          palette: true,
          quality: OPTIMIZED_IMAGE_QUALITY,
          compressionLevel: 9,
          adaptiveFiltering: true,
        }).toBuffer()

  if (transformed.length >= originalSize) {
    return { bytes: input.bytes, originalSize, storedSize: originalSize, optimized: false }
  }

  return {
    bytes: transformed,
    originalSize,
    storedSize: transformed.length,
    optimized: true,
  }
}
