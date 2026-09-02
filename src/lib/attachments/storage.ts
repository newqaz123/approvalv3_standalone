import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sanitizeAttachmentFileName } from './policy'

export function getUploadRoot(): string {
  return resolve(process.env.UPLOAD_DIR || resolve(process.cwd(), 'uploads'))
}

export function normalizeStoredAttachmentPath(storedPath: string): string {
  return storedPath
    .trim()
    .replace(/^\/+/, '')
    .replace(/^public\/+/, '')
    .replace(/^uploads\/+/, '')
}

export function resolveStoredAttachmentPath(storedPath: string, root = getUploadRoot()): string {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, normalizeStoredAttachmentPath(storedPath))
  if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Attachment path resolves outside upload root')
  }
  return resolvedPath
}

export function createStoredAttachmentPath(requestId: string, originalName: string, id: string = randomUUID()): string {
  return `${requestId}/${id}-${sanitizeAttachmentFileName(originalName)}`
}

export async function writeAttachmentFile(storedPath: string, bytes: Buffer): Promise<void> {
  const destination = resolveStoredAttachmentPath(storedPath)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, bytes, { flag: 'wx' })
}

/**
 * Staged (not yet submitted) attachment path. Staged files live under a
 * dedicated `stage/` subtree so the cleanup endpoint can only ever touch
 * files that were never adopted by a request.
 */
export function createStagedAttachmentPath(stagedId: string, originalName: string): string {
  return `stage/${stagedId}-${sanitizeAttachmentFileName(originalName)}`
}

/**
 * True only for paths inside the staged subtree. Applies the same
 * normalization as resolveStoredAttachmentPath, then requires the FIRST
 * segment to be exactly `stage` — traversal attempts, absolute paths, and
 * regular attachment paths are all rejected.
 */
export function isStagedAttachmentPath(storedPath: string): boolean {
  const normalized = normalizeStoredAttachmentPath(storedPath)
  if (!normalized || normalized.includes('..')) return false
  const [first] = normalized.split('/')
  return first === 'stage'
}

export async function attachmentFileExists(storedPath: string): Promise<boolean> {
  try {
    const info = await stat(resolveStoredAttachmentPath(storedPath))
    return info.isFile()
  } catch {
    return false
  }
}

export async function readAttachmentFile(storedPath: string): Promise<Buffer> {
  return readFile(resolveStoredAttachmentPath(storedPath))
}

export async function deleteAttachmentFile(storedPath: string): Promise<void> {
  await unlink(resolveStoredAttachmentPath(storedPath))
}
