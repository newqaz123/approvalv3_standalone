import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sanitizeAttachmentFileName } from './policy'

const ATTACHMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUEST_DRAFT_ROOT = 'request-drafts'
const REQUEST_DRAFT_UPLOADING = 'uploading'
const REQUEST_DRAFT_READY = 'ready'
const MAX_GENERATION_ATTEMPTS = 8

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

export async function moveAttachmentFile(fromStoredPath: string, toStoredPath: string): Promise<void> {
  const source = resolveStoredAttachmentPath(fromStoredPath)
  const destination = resolveStoredAttachmentPath(toStoredPath)
  await mkdir(dirname(destination), { recursive: true })
  // Same-filesystem exclusive publish: link fails with EEXIST and never
  // overwrites a pre-existing destination the way POSIX rename would.
  let createdDestinationLink = false
  try {
    await link(source, destination)
    createdDestinationLink = true
    await unlink(source)
  } catch (error) {
    if (createdDestinationLink) {
      try {
        await unlink(destination)
      } catch {
        // Best-effort compensation only; the original error is authoritative.
      }
    }
    throw error
  }
}

/**
 * Staged (not yet submitted) attachment path. Staged files live under
 * `stage/<uuid>/<normalized-name>` so the cleanup endpoint can only ever
 * touch files that were never adopted by a request.
 */
export function createStagedAttachmentPath(stagedId: string, originalName: string): string {
  if (!ATTACHMENT_ID_RE.test(stagedId)) {
    throw new Error('Invalid staged attachment id')
  }
  return `stage/${stagedId}/${sanitizeAttachmentFileName(originalName)}`
}

/**
 * True only for the unprefixed generated shape `stage/<uuid>/<filename>`.
 * Does not strip `uploads/` or `public/` prefixes — those raw forms are
 * rejected, as are surrounding whitespace, leading `/`, backslashes, extra
 * segments, invalid UUIDs, and names the shared sanitizer would rewrite.
 * Path traversal is rejected by exact segment count plus sanitizer equality
 * (`.` / `..` become `attachment`); a `..` substring inside a real filename
 * such as `drawing..pdf` is allowed because `createStagedAttachmentPath` can
 * emit it.
 */
export function isStagedAttachmentPath(storedPath: string): boolean {
  if (storedPath !== storedPath.trim()) return false
  if (!storedPath || storedPath.startsWith('/') || storedPath.includes('\\')) return false
  if (storedPath.startsWith('uploads/') || storedPath.startsWith('public/')) return false
  const parts = storedPath.split('/')
  if (parts.length !== 3) return false
  const [prefix, stagedId, fileName] = parts
  if (prefix !== 'stage' || !ATTACHMENT_ID_RE.test(stagedId) || fileName.length === 0) return false
  return fileName === sanitizeAttachmentFileName(fileName)
}

function assertAttachmentId(id: string, label: string): void {
  if (!ATTACHMENT_ID_RE.test(id)) {
    throw new Error(`Invalid ${label}`)
  }
}

function isExactRequestDraftPath(storedPath: string, kind: typeof REQUEST_DRAFT_UPLOADING | typeof REQUEST_DRAFT_READY): boolean {
  if (storedPath !== storedPath.trim()) return false
  if (!storedPath || storedPath.startsWith('/') || storedPath.includes('\\')) return false
  if (storedPath.startsWith('uploads/') || storedPath.startsWith('public/')) return false
  const parts = storedPath.split('/')
  if (parts.length !== 5) return false
  const [root, prefix, attachmentId, generationId, fileName] = parts
  if (root !== REQUEST_DRAFT_ROOT || prefix !== kind) return false
  if (!ATTACHMENT_ID_RE.test(attachmentId) || !ATTACHMENT_ID_RE.test(generationId) || fileName.length === 0) return false
  return fileName === sanitizeAttachmentFileName(fileName)
}

/**
 * Server-controlled uploading path for an unowned request draft.
 * Shape: `request-drafts/uploading/<attachmentId>/<generationId>/<sanitized-name>`.
 */
export function createRequestDraftUploadingPath(attachmentId: string, generationId: string, originalName: string): string {
  assertAttachmentId(attachmentId, 'request draft attachment id')
  assertAttachmentId(generationId, 'request draft generation id')
  return `${REQUEST_DRAFT_ROOT}/${REQUEST_DRAFT_UPLOADING}/${attachmentId}/${generationId}/${sanitizeAttachmentFileName(originalName)}`
}

/**
 * Server-controlled ready path for an unowned request draft.
 * Shape: `request-drafts/ready/<attachmentId>/<generationId>/<sanitized-name>`.
 */
export function createRequestDraftReadyPath(attachmentId: string, generationId: string, originalName: string): string {
  assertAttachmentId(attachmentId, 'request draft attachment id')
  assertAttachmentId(generationId, 'request draft generation id')
  return `${REQUEST_DRAFT_ROOT}/${REQUEST_DRAFT_READY}/${attachmentId}/${generationId}/${sanitizeAttachmentFileName(originalName)}`
}

export function isRequestDraftUploadingPath(storedPath: string): boolean {
  return isExactRequestDraftPath(storedPath, REQUEST_DRAFT_UPLOADING)
}

export function isRequestDraftReadyPath(storedPath: string): boolean {
  return isExactRequestDraftPath(storedPath, REQUEST_DRAFT_READY)
}

/**
 * Derive the matching ready path from an uploading path by swapping only the
 * server-controlled prefix. Used to clean a crash window where the file was
 * moved but the row still points at the generation's uploading path.
 */
export function toRequestDraftReadyPath(uploadingPath: string): string {
  if (!isRequestDraftUploadingPath(uploadingPath)) {
    throw new Error('Not a request-draft uploading path')
  }
  const parts = uploadingPath.split('/')
  parts[1] = REQUEST_DRAFT_READY
  return parts.join('/')
}

/**
 * Allocate a generation whose uploading and ready paths do not collide with an
 * observed predecessor path. Retries a bounded number of times when the server
 * UUID repeats the observed generation.
 */
export function allocateRequestDraftGenerationPaths(
  attachmentId: string,
  originalName: string,
  observedPath?: string | null,
  randomId: () => string = randomUUID,
): { generationId: string; uploadingPath: string; readyPath: string } {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const generationId = randomId()
    const uploadingPath = createRequestDraftUploadingPath(attachmentId, generationId, originalName)
    const readyPath = createRequestDraftReadyPath(attachmentId, generationId, originalName)
    if (observedPath != null && (uploadingPath === observedPath || readyPath === observedPath)) {
      continue
    }
    return { generationId, uploadingPath, readyPath }
  }
  throw new Error('Unable to allocate a distinct request-draft generation path')
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
