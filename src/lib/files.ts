import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

/**
 * Get the upload directory path
 * Files are stored in public/uploads/[request-id]/
 */
export function getUploadDir(requestId: string): string {
  return join(process.cwd(), 'public', 'uploads', requestId)
}

/**
 * Generate a unique file path for an uploaded file
 * Format: public/uploads/[request-id]/[uuid]-[filename]
 */
export function generateFilePath(requestId: string, fileName: string): string {
  const uuid = crypto.randomUUID()
  return join('uploads', requestId, `${uuid}-${fileName}`)
}

/**
 * Save a file to the local filesystem
 * Creates the upload directory if it doesn't exist
 */
export async function saveFile(
  filePath: string,
  file: Buffer
): Promise<void> {
  const fullPath = join(process.cwd(), 'public', filePath)

  // Ensure directory exists
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }

  // Write file
  await writeFile(fullPath, file)
}

/**
 * Get the public URL for a file
 * Files are served directly by Next.js static file serving
 */
export function getFileUrl(filePath: string): string {
  // Remove 'public/' prefix, strip any leading slash, then add exactly one
  const normalized = filePath.replace(/^public\//, '').replace(/^\//, '')
  return `/${normalized}`
}
