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

export function getFileAccessUrl(
  fileId: string | null | undefined,
  disposition: FileDisposition = 'attachment'
): string | null {
  if (!fileId) return null

  return `/api/files/download?id=${encodeURIComponent(fileId)}&disposition=${disposition}`
}

export function getFilePreviewUrl(fileId: string | null | undefined): string | null {
  return getFileAccessUrl(fileId, 'inline')
}

export function getFileDownloadUrl(fileId: string | null | undefined): string | null {
  return getFileAccessUrl(fileId, 'attachment')
}
