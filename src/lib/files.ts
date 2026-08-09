import { writeFile, mkdir } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { resolveStoredAttachmentPath } from './attachments/storage'

/**
 * Legacy public uploads root. The active upload flow is migrating to private
 * storage (see src/lib/attachments/storage); this module keeps the historical
 * `public/uploads` destination so existing server actions continue to work
 * unchanged until they are rewired onto the private resolver.
 */
function legacyUploadRoot(): string {
  return resolve(process.cwd(), 'public', 'uploads')
}

/**
 * Get the upload directory path
 * Files are stored in public/uploads/[request-id]/
 */
export function getUploadDir(requestId: string): string {
  return resolve(legacyUploadRoot(), requestId)
}

/**
 * Generate a unique file path for an uploaded file
 * Format: uploads/[request-id]/[uuid]-[filename]
 */
export function generateFilePath(requestId: string, fileName: string): string {
  const uuid = crypto.randomUUID()
  return join('uploads', requestId, `${uuid}-${fileName}`)
}

/**
 * Save a file to the local filesystem
 * Creates the upload directory if it doesn't exist
 *
 * Path resolution is delegated to the containment-checked resolver in
 * src/lib/attachments/storage so traversal attempts are rejected, while the
 * legacy `public/uploads` root is preserved for compatibility.
 */
export async function saveFile(filePath: string, file: Buffer): Promise<void> {
  const fullPath = resolveStoredAttachmentPath(filePath, legacyUploadRoot())
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, file)
}
