import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
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

export async function readAttachmentFile(storedPath: string): Promise<Buffer> {
  return readFile(resolveStoredAttachmentPath(storedPath))
}

export async function deleteAttachmentFile(storedPath: string): Promise<void> {
  await unlink(resolveStoredAttachmentPath(storedPath))
}
