import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import {
  REQUEST_DRAFT_CAS_ATTEMPTS,
  attachmentFileExists,
  attachmentFileHasSize,
  createRequestDraftCancelledSentinelPath,
  createRequestDraftReservedPath,
  deleteAttachmentFile,
  isRequestDraftCancelledPath,
  isRequestDraftClaimablePath,
  isRequestDraftReadyPath,
  isRequestDraftReservedPath,
  isRequestDraftUploadingPath,
  moveAttachmentFile,
  parseRequestDraftPath,
  physicalPathsFromCancelledPath,
  toRequestDraftCancelledPath,
  toRequestDraftReadyPath,
  toRequestDraftUploadingPath,
  uploadTokenFromDraftPath,
  writeAttachmentFile,
} from '@/lib/attachments/storage'
import { sanitizeAttachmentFileName, validateAttachmentMetadata } from '@/lib/attachments/policy'

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

function isEexist(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'EEXIST'
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002'
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

function reservationMetadata(body: {
  fileName?: unknown
  fileType?: unknown
  fileSize?: unknown
}): { fileName: string; fileType: string; fileSize: number } | null {
  const fileName = typeof body.fileName === 'string' ? body.fileName : ''
  const fileType = typeof body.fileType === 'string' ? body.fileType : null
  const fileSize = typeof body.fileSize === 'number' && Number.isFinite(body.fileSize) ? body.fileSize : null
  if (!fileName || fileType === null || fileSize === null) return null
  return { fileName, fileType, fileSize }
}

function metadataMatches(
  row: Pick<DraftRow, 'fileName' | 'fileType' | 'fileSize'>,
  metadata: { fileName: string; fileType: string; fileSize: number },
): boolean {
  return row.fileName === metadata.fileName
    && row.fileType === metadata.fileType
    && row.fileSize === metadata.fileSize
}

function fileBoundToRow(row: DraftRow, file: File, uploadToken: string): boolean {
  const parsed = parseRequestDraftPath(row.filePath)
  if (!parsed || parsed.kind === 'cancelled' || parsed.uploadToken !== uploadToken) return false
  return parsed.fileName === sanitizeAttachmentFileName(file.name)
    && row.fileName === file.name
    && row.fileType === file.type
    && row.fileSize === file.size
}

function conflictForExisting(existing: DraftRow, userId: string): NextResponse | null {
  if (existing.uploadedById !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (existing.requestId !== null || existing.solutionId !== null) {
    return NextResponse.json({ error: 'Attachment is no longer a draft' }, { status: 409 })
  }
  if (isRequestDraftCancelledPath(existing.filePath)) {
    return NextResponse.json({ error: 'Attachment was cancelled' }, { status: 409 })
  }
  return null
}

function reservationSuccess(row: DraftRow, alreadyReady: boolean) {
  const uploadToken = uploadTokenFromDraftPath(row.filePath)
  if (!uploadToken) {
    return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
  }
  return NextResponse.json({
    attachmentId: row.id,
    uploadToken,
    alreadyReady,
    ...(alreadyReady
      ? { fileName: row.fileName, fileType: row.fileType, fileSize: row.fileSize }
      : {}),
  })
}

function interpretExistingReservation(
  existing: DraftRow,
  userId: string,
  metadata: { fileName: string; fileType: string; fileSize: number },
): NextResponse {
  const conflict = conflictForExisting(existing, userId)
  if (conflict) return conflict
  if (isRequestDraftReadyPath(existing.filePath) && metadataMatches(existing, metadata)) {
    return reservationSuccess(existing, true)
  }
  if (isRequestDraftReservedPath(existing.filePath) || isRequestDraftUploadingPath(existing.filePath)) {
    return reservationSuccess(existing, false)
  }
  return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
}

/**
 * PUT /api/attachments/stage — create-first reservation. JSON
 * `{ attachmentId, fileName, fileType, fileSize }`. The uploadToken is generated
 * once and encoded in the reserved path. Reloads after P2002; cancelled is
 * terminal; ready+matching metadata returns alreadyReady.
 */
export async function PUT(request: Request) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { attachmentId?: unknown; fileName?: unknown; fileType?: unknown; fileSize?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : ''
  if (!ATTACHMENT_ID_RE.test(attachmentId)) {
    return NextResponse.json({ error: 'Invalid attachmentId' }, { status: 400 })
  }

  const metadata = reservationMetadata(body)
  if (!metadata) {
    return NextResponse.json({ error: 'Invalid attachment metadata' }, { status: 400 })
  }
  const validationError = validateAttachmentMetadata({
    name: metadata.fileName,
    type: metadata.fileType,
    size: metadata.fileSize,
  })
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const uploadToken = randomUUID()
  const reservedPath = createRequestDraftReservedPath(attachmentId, uploadToken, metadata.fileName)
  const created: DraftRow = {
    id: attachmentId,
    requestId: null,
    solutionId: null,
    fileName: metadata.fileName,
    fileType: metadata.fileType,
    fileSize: metadata.fileSize,
    filePath: reservedPath,
    uploadedById: user.id,
  }

  try {
    await prisma.file_attachments.create({ data: created })
    return reservationSuccess(created, false)
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error
  }

  const existing = await prisma.file_attachments.findUnique({
    where: { id: attachmentId },
  }) as DraftRow | null
  if (!existing) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 500 })
  }
  return interpretExistingReservation(existing, user.id, metadata)
}

async function loadDraft(attachmentId: string): Promise<DraftRow | null> {
  return prisma.file_attachments.findUnique({
    where: { id: attachmentId },
  }) as Promise<DraftRow | null>
}

function readySuccess(row: DraftRow) {
  return NextResponse.json({
    attachmentId: row.id,
    fileName: row.fileName,
    fileType: row.fileType,
    fileSize: row.fileSize,
  })
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

function cancelledLineageMatchesAttempt(
  row: DraftRow | null,
  params: { userId: string; attachmentId: string; uploadingPath: string; readyPath: string },
): boolean {
  if (!row) return false
  if (row.id !== params.attachmentId) return false
  if (row.uploadedById !== params.userId) return false
  if (row.requestId !== null || row.solutionId !== null) return false
  if (!isRequestDraftCancelledPath(row.filePath)) return false
  const cancelled = parseRequestDraftPath(row.filePath)
  const attempt = parseRequestDraftPath(params.uploadingPath) ?? parseRequestDraftPath(params.readyPath)
  if (!cancelled || cancelled.kind !== 'cancelled') return false
  if (!attempt?.uploadToken || !attempt.fileName) return false
  if (!cancelled.uploadToken || !cancelled.fileName) return false
  return cancelled.attachmentId === params.attachmentId
    && cancelled.uploadToken === attempt.uploadToken
    && cancelled.fileName === attempt.fileName
}

async function reloadPostOutcome(attachmentId: string, userId: string): Promise<NextResponse> {
  const row = await loadDraft(attachmentId)
  if (!row) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  const conflict = conflictForExisting(row, userId)
  if (conflict) return conflict
  if (isRequestDraftReadyPath(row.filePath)) return readySuccess(row)
  if (isRequestDraftUploadingPath(row.filePath)) {
    return NextResponse.json({ error: 'Upload in progress' }, { status: 409 })
  }
  return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
}

async function reloadAfterLostFinalize(params: {
  attachmentId: string
  userId: string
  uploadingPath: string
  readyPath: string
  wroteUploading: boolean
  movedReady: boolean
}): Promise<NextResponse> {
  const row = await loadDraft(params.attachmentId)
  if (cancelledLineageMatchesAttempt(row, params)) {
    if (params.movedReady) await ignoreMissingDelete(params.readyPath)
    if (params.wroteUploading) await ignoreMissingDelete(params.uploadingPath)
  }
  if (!row) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  const conflict = conflictForExisting(row, params.userId)
  if (conflict) return conflict
  if (isRequestDraftReadyPath(row.filePath)) return readySuccess(row)
  if (isRequestDraftUploadingPath(row.filePath)) {
    return NextResponse.json({ error: 'Upload in progress' }, { status: 409 })
  }
  return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
}

async function resumeSameTokenUpload(params: {
  row: DraftRow
  userId: string
  file: File
  bytes: Buffer
}): Promise<NextResponse> {
  const uploadingPath = isRequestDraftUploadingPath(params.row.filePath)
    ? params.row.filePath
    : toRequestDraftUploadingPath(params.row.filePath)
  const readyPath = toRequestDraftReadyPath(uploadingPath)
  const expectedSize = params.bytes.length
  let wroteUploading = false
  let movedReady = false

  try {
    const readyComplete = await attachmentFileHasSize(readyPath, expectedSize)
    const uploadingComplete = await attachmentFileHasSize(uploadingPath, expectedSize)

    if (!readyComplete && !uploadingComplete) {
      if (await attachmentFileExists(uploadingPath)) {
        await ignoreMissingDelete(uploadingPath)
      }
      try {
        await writeAttachmentFile(uploadingPath, params.bytes)
        wroteUploading = true
      } catch (error) {
        if (isEexist(error)) {
          return reloadPostOutcome(params.row.id, params.userId)
        }
        await ignoreMissingDelete(uploadingPath)
        throw error
      }
    }

    if (!await attachmentFileHasSize(readyPath, expectedSize)) {
      if (!await attachmentFileHasSize(uploadingPath, expectedSize)) {
        if (wroteUploading) await ignoreMissingDelete(uploadingPath)
        return NextResponse.json({ error: 'Failed to store file' }, { status: 500 })
      }
      try {
        await moveAttachmentFile(uploadingPath, readyPath)
        movedReady = true
      } catch (error) {
        if (isEexist(error)) {
          return reloadAfterLostFinalize({
            attachmentId: params.row.id,
            userId: params.userId,
            uploadingPath,
            readyPath,
            wroteUploading,
            movedReady: false,
          })
        }
        throw error
      }
    }

    const finalized = await prisma.file_attachments.updateMany({
      where: ownerScopedUnownedWhere(params.row.id, params.userId, uploadingPath),
      data: {
        filePath: readyPath,
        fileName: params.file.name,
        fileType: params.file.type,
        fileSize: params.file.size,
      },
    })
    if (finalized.count !== 1) {
      return reloadAfterLostFinalize({
        attachmentId: params.row.id,
        userId: params.userId,
        uploadingPath,
        readyPath,
        wroteUploading,
        movedReady,
      })
    }
    return NextResponse.json({
      attachmentId: params.row.id,
      fileName: params.file.name,
      fileType: params.file.type,
      fileSize: params.file.size,
    })
  } catch (error) {
    console.error('Failed to stage attachment:', error)
    return NextResponse.json({ error: 'Failed to store file' }, { status: 500 })
  }
}

/**
 * POST /api/attachments/stage — upload ONE reserved/uploading draft bound to
 * the reservation uploadToken. Same-token retry is idempotent. No new token
 * replaces another, so there is no predecessor lineage to clean.
 *
 * FormData: file, attachmentId, uploadToken
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

  const uploadTokenRaw = formData.get('uploadToken')
  const uploadToken = typeof uploadTokenRaw === 'string' ? uploadTokenRaw : ''
  if (!ATTACHMENT_ID_RE.test(uploadToken)) {
    return NextResponse.json({ error: 'Invalid uploadToken' }, { status: 400 })
  }

  const validationError = validateAttachmentMetadata({
    name: file.name,
    type: file.type,
    size: file.size,
  })
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())

  for (let attempt = 0; attempt < REQUEST_DRAFT_CAS_ATTEMPTS; attempt++) {
    const existing = await loadDraft(attachmentId)
    if (!existing) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }
    const conflict = conflictForExisting(existing, user.id)
    if (conflict) return conflict
    if (!isRequestDraftClaimablePath(existing.filePath) || !fileBoundToRow(existing, file, uploadToken)) {
      return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
    }
    if (isRequestDraftReadyPath(existing.filePath)) {
      return readySuccess(existing)
    }
    if (isRequestDraftReservedPath(existing.filePath)) {
      const uploadingPath = toRequestDraftUploadingPath(existing.filePath)
      const claimed = await prisma.file_attachments.updateMany({
        where: ownerScopedUnownedWhere(attachmentId, user.id, existing.filePath),
        data: { filePath: uploadingPath },
      })
      if (claimed.count !== 1) continue
      return resumeSameTokenUpload({
        row: { ...existing, filePath: uploadingPath },
        userId: user.id,
        file,
        bytes,
      })
    }
    return resumeSameTokenUpload({
      row: existing,
      userId: user.id,
      file,
      bytes,
    })
  }

  return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
}

async function unlinkCancelledFiles(cancelledPath: string): Promise<NextResponse | null> {
  for (const storedPath of physicalPathsFromCancelledPath(cancelledPath)) {
    try {
      await deleteAttachmentFile(storedPath)
    } catch (error) {
      if (isEnoent(error)) continue
      console.error('Failed to delete staged attachment:', error)
      return NextResponse.json({ error: 'Failed to delete staged file' }, { status: 500 })
    }
  }
  return null
}

/**
 * DELETE /api/attachments/stage — never deletes the draft row. CAS-loop the
 * latest owner-scoped unowned state to a terminal cancelled marker. If no row
 * exists, create a cancelled sentinel so later PUT cannot resurrect. Physical
 * cleanup failure leaves the cancelled row (500) so retry can finish. Adopted
 * rows return 409 and are untouched.
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

  for (let attempt = 0; attempt < REQUEST_DRAFT_CAS_ATTEMPTS; attempt++) {
    const existing = await prisma.file_attachments.findUnique({
      where: { id: attachmentId },
    }) as DraftRow | null

    if (!existing) {
      try {
        await prisma.file_attachments.create({
          data: {
            id: attachmentId,
            requestId: null,
            solutionId: null,
            fileName: 'cancelled',
            fileType: '',
            fileSize: 0,
            filePath: createRequestDraftCancelledSentinelPath(attachmentId),
            uploadedById: user.id,
          },
        })
        return NextResponse.json({ success: true })
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error
        continue
      }
    }

    if (existing.uploadedById !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (existing.requestId !== null || existing.solutionId !== null) {
      return NextResponse.json({ error: 'Attachment is no longer a draft' }, { status: 409 })
    }

    if (isRequestDraftCancelledPath(existing.filePath)) {
      const unlinkError = await unlinkCancelledFiles(existing.filePath)
      if (unlinkError) return unlinkError
      return NextResponse.json({ success: true })
    }

    if (!isRequestDraftClaimablePath(existing.filePath)) {
      return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
    }

    const cancelledPath = toRequestDraftCancelledPath(existing.filePath)
    const claimed = await prisma.file_attachments.updateMany({
      where: ownerScopedUnownedWhere(attachmentId, user.id, existing.filePath),
      data: { filePath: cancelledPath },
    })
    if (claimed.count !== 1) continue

    const unlinkError = await unlinkCancelledFiles(cancelledPath)
    if (unlinkError) return unlinkError
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
}
