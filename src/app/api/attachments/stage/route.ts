import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import {
  allocateRequestDraftGenerationPaths,
  deleteAttachmentFile,
  isRequestDraftReadyPath,
  isRequestDraftUploadingPath,
  moveAttachmentFile,
  toRequestDraftReadyPath,
  writeAttachmentFile,
} from '@/lib/attachments/storage'
import { validateAttachmentMetadata } from '@/lib/attachments/policy'

const ATTACHMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type DraftRow = {
  id: string
  requestId: string | null
  solutionId: string | null
  fileName: string
  fileType: string
  fileSize: number
  filePath: string
  uploadedById: string
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002'
}

async function ignoreMissingDelete(storedPath: string): Promise<void> {
  try {
    await deleteAttachmentFile(storedPath)
  } catch (error) {
    if (!isEnoent(error)) {
      console.warn(`Failed to clean up attachment ${storedPath}`, error)
    }
  }
}

function knownDraftCleanupPaths(filePath: string): string[] {
  const paths: string[] = []
  if (isRequestDraftUploadingPath(filePath) || isRequestDraftReadyPath(filePath)) {
    paths.push(filePath)
  }
  if (isRequestDraftUploadingPath(filePath)) {
    paths.push(toRequestDraftReadyPath(filePath))
  }
  return paths
}

async function cleanupKnownDraftFiles(filePath: string, keep: Set<string>): Promise<void> {
  for (const storedPath of knownDraftCleanupPaths(filePath)) {
    if (keep.has(storedPath)) continue
    await ignoreMissingDelete(storedPath)
  }
}

function ownerScopedUnownedWhere(attachmentId: string, userId: string, filePath?: string) {
  return {
    id: attachmentId,
    uploadedById: userId,
    requestId: null,
    solutionId: null,
    ...(filePath !== undefined ? { filePath } : {}),
  }
}

async function compareAndSwapUploading(params: {
  attachmentId: string
  userId: string
  observedPath: string
  uploadingPath: string
  fileName: string
  fileType: string
  fileSize: number
}): Promise<number> {
  const claimed = await prisma.file_attachments.updateMany({
    where: ownerScopedUnownedWhere(params.attachmentId, params.userId, params.observedPath),
    data: {
      filePath: params.uploadingPath,
      fileName: params.fileName,
      fileType: params.fileType,
      fileSize: params.fileSize,
    },
  })
  return claimed.count
}

async function restoreObservedPath(params: {
  attachmentId: string
  userId: string
  uploadingPath: string
  observed: DraftRow
}): Promise<void> {
  await prisma.file_attachments.updateMany({
    where: ownerScopedUnownedWhere(params.attachmentId, params.userId, params.uploadingPath),
    data: {
      filePath: params.observed.filePath,
      fileName: params.observed.fileName,
      fileType: params.observed.fileType,
      fileSize: params.observed.fileSize,
    },
  })
}

async function deleteCreatedUploadingRow(params: {
  attachmentId: string
  userId: string
  uploadingPath: string
}): Promise<void> {
  await prisma.file_attachments.deleteMany({
    where: ownerScopedUnownedWhere(params.attachmentId, params.userId, params.uploadingPath),
  })
}

async function rollbackAfterIoFailure(params: {
  createdThisRow: boolean
  observed: DraftRow | null
  attachmentId: string
  userId: string
  uploadingPath: string
}): Promise<void> {
  if (params.createdThisRow) {
    await deleteCreatedUploadingRow(params)
    return
  }
  if (params.observed && isRequestDraftReadyPath(params.observed.filePath)) {
    await restoreObservedPath({
      attachmentId: params.attachmentId,
      userId: params.userId,
      uploadingPath: params.uploadingPath,
      observed: params.observed,
    })
    return
  }
  await deleteCreatedUploadingRow(params)
}

async function cleanupOwnedGenerationFiles(params: {
  wroteUploading: boolean
  movedReady: boolean
  uploadingPath: string
  readyPath: string
}): Promise<void> {
  if (params.movedReady) {
    await ignoreMissingDelete(params.readyPath)
    return
  }
  if (params.wroteUploading) {
    await ignoreMissingDelete(params.uploadingPath)
  }
}

/**
 * POST /api/attachments/stage — upload ONE not-yet-submitted request draft
 * attachment. The client supplies a stable attachmentId; the server owns the
 * generation UUID and the uploading/ready path prefixes. The owner-scoped
 * uploading row is created or CAS-claimed before any disk I/O. The row is
 * ready only after a conditional updateMany on this generation's exact
 * uploading path.
 *
 * FormData fields:
 *   file — the attachment (required)
 *   attachmentId — client UUID (required)
 */
export async function POST(request: Request) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }

  const attachmentIdRaw = formData.get('attachmentId')
  const attachmentId = typeof attachmentIdRaw === 'string' ? attachmentIdRaw : ''
  if (!ATTACHMENT_ID_RE.test(attachmentId)) {
    return NextResponse.json({ error: 'Invalid attachmentId' }, { status: 400 })
  }

  const validationError = validateAttachmentMetadata({
    name: file.name,
    type: file.type,
    size: file.size,
  })
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const fileSize = file.size

  const existing = await prisma.file_attachments.findUnique({
    where: { id: attachmentId },
  }) as DraftRow | null

  if (existing) {
    if (existing.uploadedById !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (existing.requestId !== null || existing.solutionId !== null) {
      return NextResponse.json({ error: 'Attachment is no longer a draft' }, { status: 409 })
    }
  }

  let uploadingPath: string
  let readyPath: string
  try {
    const allocated = allocateRequestDraftGenerationPaths(
      attachmentId,
      file.name,
      existing ? existing.filePath : undefined,
    )
    uploadingPath = allocated.uploadingPath
    readyPath = allocated.readyPath
  } catch (error) {
    console.error('Failed to stage attachment:', error)
    return NextResponse.json({ error: 'Failed to store file' }, { status: 500 })
  }

  let observed: DraftRow | null = null
  let createdThisRow = false

  if (existing) {
    observed = existing
    const claimed = await compareAndSwapUploading({
      attachmentId,
      userId: user.id,
      observedPath: existing.filePath,
      uploadingPath,
      fileName: file.name,
      fileType: file.type,
      fileSize,
    })
    if (claimed !== 1) {
      return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
    }
  } else {
    try {
      await prisma.file_attachments.create({
        data: {
          id: attachmentId,
          requestId: null,
          solutionId: null,
          fileName: file.name,
          fileType: file.type,
          fileSize,
          filePath: uploadingPath,
          uploadedById: user.id,
        },
      })
      createdThisRow = true
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error
      const raced = await prisma.file_attachments.findUnique({
        where: { id: attachmentId },
      }) as DraftRow | null
      if (!raced || raced.uploadedById !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (raced.requestId !== null || raced.solutionId !== null) {
        return NextResponse.json({ error: 'Attachment is no longer a draft' }, { status: 409 })
      }
      if (uploadingPath === raced.filePath || readyPath === raced.filePath) {
        try {
          const next = allocateRequestDraftGenerationPaths(attachmentId, file.name, raced.filePath)
          uploadingPath = next.uploadingPath
          readyPath = next.readyPath
        } catch (allocateError) {
          console.error('Failed to stage attachment:', allocateError)
          return NextResponse.json({ error: 'Failed to store file' }, { status: 500 })
        }
      }
      observed = raced
      const claimed = await compareAndSwapUploading({
        attachmentId,
        userId: user.id,
        observedPath: raced.filePath,
        uploadingPath,
        fileName: file.name,
        fileType: file.type,
        fileSize,
      })
      if (claimed !== 1) {
        return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
      }
    }
  }

  let wroteUploading = false
  let movedReady = false
  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    await writeAttachmentFile(uploadingPath, bytes)
    wroteUploading = true

    await moveAttachmentFile(uploadingPath, readyPath)
    movedReady = true

    const finalized = await prisma.file_attachments.updateMany({
      where: ownerScopedUnownedWhere(attachmentId, user.id, uploadingPath),
      data: {
        filePath: readyPath,
        fileName: file.name,
        fileType: file.type,
        fileSize,
      },
    })

    if (finalized.count !== 1) {
      await cleanupOwnedGenerationFiles({
        wroteUploading,
        movedReady,
        uploadingPath,
        readyPath,
      })
      return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
    }

    if (observed) {
      await cleanupKnownDraftFiles(observed.filePath, new Set([uploadingPath, readyPath]))
    }

    return NextResponse.json({
      attachmentId,
      fileName: file.name,
      fileType: file.type,
      fileSize,
    })
  } catch (error) {
    console.error('Failed to stage attachment:', error)
    await rollbackAfterIoFailure({
      createdThisRow,
      observed,
      attachmentId,
      userId: user.id,
      uploadingPath,
    })
    await cleanupOwnedGenerationFiles({
      wroteUploading,
      movedReady,
      uploadingPath,
      readyPath,
    })
    return NextResponse.json({ error: 'Failed to store file' }, { status: 500 })
  }
}

/**
 * DELETE /api/attachments/stage — remove an owner-scoped unowned request draft
 * by attachmentId. Snapshot the observed filePath, then conditionally delete
 * only that exact owner-scoped unowned row. The physical file is unlinked only
 * when that delete count is 1, so an adopted or superseded attachment is never
 * unlinked from disk.
 *
 * JSON body: { attachmentId: string }
 */
export async function DELETE(request: Request) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { attachmentId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : ''
  if (!ATTACHMENT_ID_RE.test(attachmentId)) {
    return NextResponse.json({ error: 'Invalid attachmentId' }, { status: 400 })
  }

  const existing = await prisma.file_attachments.findFirst({
    where: ownerScopedUnownedWhere(attachmentId, user.id),
    select: { id: true, filePath: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  const deleted = await prisma.file_attachments.deleteMany({
    where: ownerScopedUnownedWhere(attachmentId, user.id, existing.filePath),
  })
  if (deleted.count !== 1) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  const capturedPath = existing.filePath
  if (isRequestDraftUploadingPath(capturedPath) || isRequestDraftReadyPath(capturedPath)) {
    try {
      await deleteAttachmentFile(capturedPath)
    } catch (error) {
      if (!isEnoent(error)) {
        console.error('Failed to delete staged attachment:', error)
        return NextResponse.json({ error: 'Failed to delete staged file' }, { status: 500 })
      }
    }
    if (isRequestDraftUploadingPath(capturedPath)) {
      await ignoreMissingDelete(toRequestDraftReadyPath(capturedPath))
    }
  }

  return NextResponse.json({ success: true })
}
