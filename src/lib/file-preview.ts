export type FilePreviewKind = 'pdf' | 'image' | 'text' | 'docx' | 'xlsx' | 'unsupported'

export interface PreviewableFileMetadata {
  fileName: string
  fileType?: string | null
}

type FileDisposition = 'attachment' | 'inline'

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'])
const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'log', 'md', 'json', 'xml'])

export function getFileExtension(fileName: string): string {
  const normalizedName = fileName.trim().toLowerCase()
  const lastDotIndex = normalizedName.lastIndexOf('.')

  if (lastDotIndex < 0 || lastDotIndex === normalizedName.length - 1) {
    return ''
  }

  return normalizedName.slice(lastDotIndex + 1)
}

export function getFilePreviewKind(file: PreviewableFileMetadata): FilePreviewKind {
  const fileType = file.fileType?.toLowerCase() ?? ''
  const extension = getFileExtension(file.fileName)

  if (fileType === 'application/pdf' || extension === 'pdf') {
    return 'pdf'
  }

  if (fileType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }

  if (fileType.startsWith('text/') || TEXT_EXTENSIONS.has(extension)) {
    return 'text'
  }

  if (
    fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    extension === 'docx'
  ) {
    return 'docx'
  }

  if (
    fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    extension === 'xlsx'
  ) {
    return 'xlsx'
  }

  return 'unsupported'
}

export function isPreviewableFile(file: PreviewableFileMetadata): boolean {
  return getFilePreviewKind(file) !== 'unsupported'
}

export function normalizeStoredFilePath(filePath: string | null | undefined): string | null {
  if (!filePath) return null

  const normalized = filePath
    .trim()
    .replace(/^\/+/, '')
    .replace(/^public\/+/, '')

  return normalized || null
}

export function getFileAccessUrl(
  filePath: string | null | undefined,
  disposition: FileDisposition = 'attachment'
): string | null {
  const normalizedPath = normalizeStoredFilePath(filePath)
  if (!normalizedPath) return null

  return `/api/files/download?path=${encodeURIComponent(normalizedPath)}&disposition=${disposition}`
}

export function getFilePreviewUrl(filePath: string | null | undefined): string | null {
  return getFileAccessUrl(filePath, 'inline')
}

export function getFileDownloadUrl(filePath: string | null | undefined): string | null {
  return getFileAccessUrl(filePath, 'attachment')
}
