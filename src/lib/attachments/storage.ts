import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sanitizeAttachmentFileName } from './policy'

const ATTACHMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUEST_DRAFT_ROOT = 'request-drafts'
const REQUEST_DRAFT_RESERVED = 'reserved'
const REQUEST_DRAFT_UPLOADING = 'uploading'
const REQUEST_DRAFT_READY = 'ready'
const REQUEST_DRAFT_CANCELLED = 'cancelled'
const REQUEST_DRAFT_ABSENT = 'absent'
export const REQUEST_DRAFT_CAS_ATTEMPTS = 8

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

function isFsCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code
}

export async function writeAttachmentFile(storedPath: string, bytes: Buffer): Promise<void> {
  const destination = resolveStoredAttachmentPath(storedPath)
  await mkdir(dirname(destination), { recursive: true })
  try {
    await writeFile(destination, bytes, { flag: 'wx' })
  } catch (error) {
    if (!isFsCode(error, 'EEXIST')) {
      try {
        await unlink(destination)
      } catch {
        // Best-effort compensation; the original write error is authoritative.
      }
    }
    throw error
  }
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

function assertAttachmentId(id: string, label: string): void {
  if (!ATTACHMENT_ID_RE.test(id)) {
    throw new Error(`Invalid ${label}`)
  }
}

function isUnprefixedStoredPath(storedPath: string): boolean {
  if (storedPath !== storedPath.trim()) return false
  if (!storedPath || storedPath.startsWith('/') || storedPath.includes('\\')) return false
  if (storedPath.startsWith('uploads/') || storedPath.startsWith('public/')) return false
  return true
}

export type RequestDraftKind = 'reserved' | 'uploading' | 'ready'
export type RequestDraftCancelledKind = RequestDraftKind | 'absent'

export type ParsedRequestDraftPath = {
  kind: RequestDraftKind | 'cancelled'
  priorKind?: RequestDraftCancelledKind
  attachmentId: string
  uploadToken?: string
  fileName?: string
}

function isExactRequestDraftPath(storedPath: string, kind: RequestDraftKind): boolean {
  if (!isUnprefixedStoredPath(storedPath)) return false
  const parts = storedPath.split('/')
  if (parts.length !== 5) return false
  const [root, prefix, attachmentId, uploadToken, fileName] = parts
  if (root !== REQUEST_DRAFT_ROOT || prefix !== kind) return false
  if (!ATTACHMENT_ID_RE.test(attachmentId) || !ATTACHMENT_ID_RE.test(uploadToken) || fileName.length === 0) return false
  return fileName === sanitizeAttachmentFileName(fileName)
}

function createFiveSegmentPath(
  kind: RequestDraftKind,
  attachmentId: string,
  uploadToken: string,
  originalName: string,
): string {
  assertAttachmentId(attachmentId, 'request draft attachment id')
  assertAttachmentId(uploadToken, 'request draft upload token')
  return `${REQUEST_DRAFT_ROOT}/${kind}/${attachmentId}/${uploadToken}/${sanitizeAttachmentFileName(originalName)}`
}

/** Shape: `request-drafts/reserved/<attachmentId>/<uploadToken>/<sanitized-name>`. */
export function createRequestDraftReservedPath(attachmentId: string, uploadToken: string, originalName: string): string {
  return createFiveSegmentPath(REQUEST_DRAFT_RESERVED, attachmentId, uploadToken, originalName)
}

/** Shape: `request-drafts/uploading/<attachmentId>/<uploadToken>/<sanitized-name>`. */
export function createRequestDraftUploadingPath(attachmentId: string, uploadToken: string, originalName: string): string {
  return createFiveSegmentPath(REQUEST_DRAFT_UPLOADING, attachmentId, uploadToken, originalName)
}

/** Shape: `request-drafts/ready/<attachmentId>/<uploadToken>/<sanitized-name>`. */
export function createRequestDraftReadyPath(attachmentId: string, uploadToken: string, originalName: string): string {
  return createFiveSegmentPath(REQUEST_DRAFT_READY, attachmentId, uploadToken, originalName)
}

export function isRequestDraftReservedPath(storedPath: string): boolean {
  return isExactRequestDraftPath(storedPath, REQUEST_DRAFT_RESERVED)
}

export function isRequestDraftUploadingPath(storedPath: string): boolean {
  return isExactRequestDraftPath(storedPath, REQUEST_DRAFT_UPLOADING)
}

export function isRequestDraftReadyPath(storedPath: string): boolean {
  return isExactRequestDraftPath(storedPath, REQUEST_DRAFT_READY)
}

export function isRequestDraftClaimablePath(storedPath: string): boolean {
  return isRequestDraftReservedPath(storedPath)
    || isRequestDraftUploadingPath(storedPath)
    || isRequestDraftReadyPath(storedPath)
}

export function createRequestDraftCancelledSentinelPath(attachmentId: string): string {
  assertAttachmentId(attachmentId, 'request draft attachment id')
  return `${REQUEST_DRAFT_ROOT}/${REQUEST_DRAFT_CANCELLED}/${REQUEST_DRAFT_ABSENT}/${attachmentId}`
}

export function isRequestDraftCancelledSentinelPath(storedPath: string): boolean {
  if (!isUnprefixedStoredPath(storedPath)) return false
  const parts = storedPath.split('/')
  if (parts.length !== 4) return false
  const [root, cancelled, absent, attachmentId] = parts
  return root === REQUEST_DRAFT_ROOT
    && cancelled === REQUEST_DRAFT_CANCELLED
    && absent === REQUEST_DRAFT_ABSENT
    && ATTACHMENT_ID_RE.test(attachmentId)
}

export function isRequestDraftCancelledPath(storedPath: string): boolean {
  if (isRequestDraftCancelledSentinelPath(storedPath)) return true
  if (!isUnprefixedStoredPath(storedPath)) return false
  const parts = storedPath.split('/')
  if (parts.length !== 6) return false
  const [root, cancelled, priorKind, attachmentId, uploadToken, fileName] = parts
  if (root !== REQUEST_DRAFT_ROOT || cancelled !== REQUEST_DRAFT_CANCELLED) return false
  if (priorKind !== REQUEST_DRAFT_RESERVED && priorKind !== REQUEST_DRAFT_UPLOADING && priorKind !== REQUEST_DRAFT_READY) {
    return false
  }
  if (!ATTACHMENT_ID_RE.test(attachmentId) || !ATTACHMENT_ID_RE.test(uploadToken) || fileName.length === 0) return false
  return fileName === sanitizeAttachmentFileName(fileName)
}

export function parseRequestDraftPath(storedPath: string): ParsedRequestDraftPath | null {
  if (isRequestDraftCancelledSentinelPath(storedPath)) {
    return {
      kind: 'cancelled',
      priorKind: 'absent',
      attachmentId: storedPath.split('/')[3] as string,
    }
  }
  if (isRequestDraftCancelledPath(storedPath)) {
    const parts = storedPath.split('/')
    return {
      kind: 'cancelled',
      priorKind: parts[2] as RequestDraftKind,
      attachmentId: parts[3] as string,
      uploadToken: parts[4],
      fileName: parts[5],
    }
  }
  if (isRequestDraftReservedPath(storedPath) || isRequestDraftUploadingPath(storedPath) || isRequestDraftReadyPath(storedPath)) {
    const parts = storedPath.split('/')
    return {
      kind: parts[1] as RequestDraftKind,
      attachmentId: parts[2] as string,
      uploadToken: parts[3],
      fileName: parts[4],
    }
  }
  return null
}

export function uploadTokenFromDraftPath(storedPath: string): string | null {
  return parseRequestDraftPath(storedPath)?.uploadToken ?? null
}

/** Swap only the server-controlled prefix of a five-segment draft path. */
export function toRequestDraftKindPath(storedPath: string, kind: RequestDraftKind): string {
  const parsed = parseRequestDraftPath(storedPath)
  if (!parsed || !parsed.uploadToken || !parsed.fileName || parsed.kind === 'cancelled') {
    throw new Error('Not a request-draft claimable path')
  }
  return createFiveSegmentPath(kind, parsed.attachmentId, parsed.uploadToken, parsed.fileName)
}

export function toRequestDraftUploadingPath(storedPath: string): string {
  return toRequestDraftKindPath(storedPath, REQUEST_DRAFT_UPLOADING)
}

export function toRequestDraftReadyPath(storedPath: string): string {
  if (isRequestDraftUploadingPath(storedPath)) {
    const parts = storedPath.split('/')
    parts[1] = REQUEST_DRAFT_READY
    return parts.join('/')
  }
  return toRequestDraftKindPath(storedPath, REQUEST_DRAFT_READY)
}

/** Terminal cancelled marker that still derives the token/path lineage. */
export function toRequestDraftCancelledPath(storedPath: string): string {
  if (isRequestDraftCancelledPath(storedPath)) return storedPath
  const parsed = parseRequestDraftPath(storedPath)
  if (!parsed || parsed.kind === 'cancelled' || !parsed.uploadToken || !parsed.fileName) {
    throw new Error('Not a request-draft path')
  }
  return `${REQUEST_DRAFT_ROOT}/${REQUEST_DRAFT_CANCELLED}/${parsed.kind}/${parsed.attachmentId}/${parsed.uploadToken}/${parsed.fileName}`
}

/** Physical files to unlink for a cancelled marker. Reserved/absent yield []. */
export function physicalPathsFromCancelledPath(cancelledPath: string): string[] {
  const parsed = parseRequestDraftPath(cancelledPath)
  if (!parsed || parsed.kind !== 'cancelled') {
    throw new Error('Not a request-draft cancelled path')
  }
  if (!parsed.priorKind || parsed.priorKind === 'absent' || parsed.priorKind === 'reserved') return []
  if (!parsed.uploadToken || !parsed.fileName) return []
  const uploading = createRequestDraftUploadingPath(parsed.attachmentId, parsed.uploadToken, parsed.fileName)
  const ready = createRequestDraftReadyPath(parsed.attachmentId, parsed.uploadToken, parsed.fileName)
  if (parsed.priorKind === 'uploading') return [uploading, ready]
  return [ready]
}

export async function attachmentFileExists(storedPath: string): Promise<boolean> {
  try {
    const info = await stat(resolveStoredAttachmentPath(storedPath))
    return info.isFile()
  } catch {
    return false
  }
}

export async function attachmentFileSize(storedPath: string): Promise<number | null> {
  try {
    const info = await stat(resolveStoredAttachmentPath(storedPath))
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

export async function attachmentFileHasSize(storedPath: string, expectedSize: number): Promise<boolean> {
  const size = await attachmentFileSize(storedPath)
  return size === expectedSize
}

export async function readAttachmentFile(storedPath: string): Promise<Buffer> {
  return readFile(resolveStoredAttachmentPath(storedPath))
}

export async function deleteAttachmentFile(storedPath: string): Promise<void> {
  await unlink(resolveStoredAttachmentPath(storedPath))
}
