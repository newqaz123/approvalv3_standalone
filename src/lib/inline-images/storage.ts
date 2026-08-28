import { sanitizeAttachmentFileName } from '@/lib/attachments/policy'
import {
  deleteAttachmentFile,
  readAttachmentFile,
  writeAttachmentFile,
} from '@/lib/attachments/storage'

/** Returns a private-root-relative path for an immutable inline image asset. */
export function createStoredInlineImagePath(userId: string, fileName: string, id: string): string {
  return `inline-images/${userId}/${id}-${sanitizeAttachmentFileName(fileName)}`
}

export const writeInlineImageFile = writeAttachmentFile
export const readInlineImageFile = readAttachmentFile
export const deleteInlineImageFile = deleteAttachmentFile
