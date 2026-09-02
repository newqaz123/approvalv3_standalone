import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sanitizeAttachmentFileName } from './policy'

const STAGED_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
 * Staged (not yet submitted) attachment path. Staged files live under
 * `stage/<uuid>/<normalized-name>` so the cleanup endpoint can only ever
 * touch files that were never adopted by a request.
 */
export function createStagedAttachmentPath(stagedId: string, originalName: string): string {
  if (!STAGED_ID_RE.test(stagedId)) {
    throw new Error('Invalid staged attachment id')
  }
  return `stage/${stagedId}/${sanitizeAttachmentFileName(originalName)}`
}

/**
 * True only for the unprefixed generated shape `stage/<uuid>/<filename>`.
 * Does not strip `uploads/` or `public/` prefixes — those raw forms are
 * rejected, as are leading `/`, backslashes, extra segments, invalid UUIDs,
 * and names the shared sanitizer would rewrite. Path traversal is rejected
 * by exact segment count plus sanitizer equality (`.` / `..` become
 * `attachment`); a `..` substring inside a real filename such as
 * `drawing..pdf` is allowed because `createStagedAttachmentPath` can emit it.
 */
export function isStagedAttachmentPath(storedPath: string): boolean {
  const raw = storedPath.trim()
  if (!raw || raw.startsWith('/') || raw.includes('\\')) return false
  if (raw.startsWith('uploads/') || raw.startsWith('public/')) return false
  const parts = raw.split('/')
  if (parts.length !== 3) return false
  const [prefix, stagedId, fileName] = parts
  if (prefix !== 'stage' || !STAGED_ID_RE.test(stagedId) || fileName.length === 0) return false
  return fileName === sanitizeAttachmentFileName(fileName)
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
