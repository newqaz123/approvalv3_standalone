export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_FORM = 10

export interface AttachmentMetadata {
  name: string
  type: string
  size: number
}

// Browser-safe basename. sanitizeAttachmentFileName normalizes backslashes to
// forward slashes before calling this, so only "/" needs to be handled here.
// (Replaces `import { basename } from 'node:path'` so this module is safe to
// import into client components; no node polyfill is configured in this app.)
function basename(input: string): string {
  const idx = input.lastIndexOf('/')
  return idx === -1 ? input : input.slice(idx + 1)
}

const MIME_BY_EXTENSION: Record<string, Set<string>> = {
  pdf: new Set(['application/pdf']),
  doc: new Set(['application/msword']),
  docx: new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  xls: new Set(['application/vnd.ms-excel']),
  xlsx: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ppt: new Set(['application/vnd.ms-powerpoint']),
  pptx: new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  jpg: new Set(['image/jpeg']),
  jpeg: new Set(['image/jpeg']),
  png: new Set(['image/png']),
  gif: new Set(['image/gif']),
  webp: new Set(['image/webp']),
  dwg: new Set(['', 'application/octet-stream', 'application/acad', 'image/vnd.dwg']),
  dxf: new Set(['', 'application/octet-stream', 'image/vnd.dxf']),
  step: new Set(['', 'application/octet-stream', 'model/step']),
  stp: new Set(['', 'application/octet-stream', 'model/step']),
  iges: new Set(['', 'application/octet-stream', 'model/iges']),
  igs: new Set(['', 'application/octet-stream', 'model/iges']),
}

// Shared extension list, derived from the single extension->MIME policy above so
// that client `accept` strings and server validation stay aligned.
export const ATTACHMENT_EXTENSIONS = Object.keys(MIME_BY_EXTENSION)

export function sanitizeAttachmentFileName(input: string): string {
  const safe = basename(input.replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\/]/g, '-')
    .trim()
  return !safe || safe === '.' || safe === '..' ? 'attachment' : safe.slice(0, 180)
}

export function validateAttachmentMetadata(file: AttachmentMetadata): string | null {
  if (file.size <= 0) return `${file.name}: File is empty`
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name}: File size exceeds 10MB limit`
  const extension = sanitizeAttachmentFileName(file.name).split('.').pop()?.toLowerCase() ?? ''
  const allowedMimes = MIME_BY_EXTENSION[extension]
  if (!allowedMimes || !allowedMimes.has(file.type.toLowerCase())) return `${file.name}: File type not supported`
  return null
}
