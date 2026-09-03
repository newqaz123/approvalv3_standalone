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
  createSolutionDraftCancelledSentinelPath,
  createSolutionDraftReservedPath,
  deleteAttachmentFile,
  isRequestDraftCancelledPath,
  isRequestDraftClaimablePath,
  isRequestDraftReadyPath,
  isRequestDraftReservedPath,
  isRequestDraftUploadingPath,
  isSolutionDraftCancelledPath,
  isSolutionDraftClaimablePath,
  isSolutionDraftReadyPath,
  isSolutionDraftReservedPath,
  isSolutionDraftUploadingPath,
  moveAttachmentFile,
  parseRequestDraftPath,
  parseSolutionDraftPath,
  physicalPathsFromCancelledPath,
  physicalPathsFromSolutionCancelledPath,
  toRequestDraftCancelledPath,
  toRequestDraftReadyPath,
  toRequestDraftUploadingPath,
  toSolutionDraftCancelledPath,
  toSolutionDraftReadyPath,
  toSolutionDraftUploadingPath,
  uploadTokenFromDraftPath,
  writeAttachmentFile,
  type ParsedRequestDraftPath,
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

type StageScope =
  | { kind: 'request' }
  | { kind: 'solution'; requestId: string }

type ParsedStageScope = { scope: StageScope } | { error: string }

type ParsedDraftPath = ParsedRequestDraftPath

/**
 * Per-scope staging protocol surface. The request and solution scopes run the
 * identical CAS/finalize/compensation flow; only path roots, row-shape
 * predicates, and conflict verdicts differ.
 */
type DraftContext = {
  createReservedPath(attachmentId: string, uploadToken: string, fileName: string): string
  createCancelledSentinelPath(attachmentId: string): string
  isCancelledPath(storedPath: string): boolean
  isReadyPath(storedPath: string): boolean
  isReservedPath(storedPath: string): boolean
  isUploadingPath(storedPath: string): boolean
  isClaimablePath(storedPath: string): boolean
  toUploadingPath(storedPath: string): string
  toReadyPath(storedPath: string): string
  toCancelledPath(storedPath: string): string
  physicalPathsFromCancelledPath(storedPath: string): string[]
  parsePath(storedPath: string): ParsedDraftPath | null
  /** CAS predicate for an owner-scoped, unadopted draft row in this scope. */
  ownerScopedDraftWhere(attachmentId: string, userId: string, filePath?: string): Record<string, unknown>
  /** 403/404/409 when the row is unusable in this scope; null otherwise. */
  conflictForExisting(existing: DraftRow, userId: string): NextResponse | null
  /** Same gate for DELETE, where an already-cancelled row is a success case. */
  conflictForDelete(existing: DraftRow, userId: string): NextResponse | null
  /** Row is an unadopted draft inside this scope (token-lineage eligibility). */
  isUnadoptedScopeDraftRow(row: DraftRow): boolean
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

function conflictForRequestRow(existing: DraftRow, userId: string): NextResponse | null {
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

/**
 * Solution-scope visibility: the row must be an unadopted solution draft bound
 * to the exact target request. Wrong request and non-solution paths are
 * invisible (404); adopted rows are untouchable (409).
 */
function conflictForSolutionRow(
  existing: DraftRow,
  userId: string,
  requestId: string,
  forDelete: boolean,
): NextResponse | null {
  if (existing.uploadedById !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (existing.requestId !== requestId) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }
  if (existing.solutionId !== null) {
    return NextResponse.json({ error: 'Attachment is no longer a draft' }, { status: 409 })
  }
  const claimable = isSolutionDraftClaimablePath(existing.filePath)
  if (!claimable && !isSolutionDraftCancelledPath(existing.filePath)) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }
  if (!claimable) {
    return forDelete
      ? null
      : NextResponse.json({ error: 'Attachment was cancelled' }, { status: 409 })
  }
  return null
}

function solutionDraftContext(requestId: string): DraftContext {
  return {
    createReservedPath: createSolutionDraftReservedPath,
    createCancelledSentinelPath: createSolutionDraftCancelledSentinelPath,
    isCancelledPath: isSolutionDraftCancelledPath,
    isReadyPath: isSolutionDraftReadyPath,
    isReservedPath: isSolutionDraftReservedPath,
    isUploadingPath: isSolutionDraftUploadingPath,
    isClaimablePath: isSolutionDraftClaimablePath,
    toUploadingPath: toSolutionDraftUploadingPath,
    toReadyPath: toSolutionDraftReadyPath,
    toCancelledPath: toSolutionDraftCancelledPath,
    physicalPathsFromCancelledPath: physicalPathsFromSolutionCancelledPath,
    parsePath: parseSolutionDraftPath,
    ownerScopedDraftWhere(attachmentId, userId, filePath?) {
      return {
        id: attachmentId,
        uploadedById: userId,
        requestId,
        solutionId: null,
        ...(filePath !== undefined ? { filePath } : {}),
      }
    },
    conflictForExisting: (existing, userId) => conflictForSolutionRow(existing, userId, requestId, false),
    conflictForDelete: (existing, userId) => conflictForSolutionRow(existing, userId, requestId, true),
    isUnadoptedScopeDraftRow: (row) => row.requestId === requestId && row.solutionId === null,
  }
}

const REQUEST_DRAFT_CONTEXT: DraftContext = {
  createReservedPath: createRequestDraftReservedPath,
  createCancelledSentinelPath: createRequestDraftCancelledSentinelPath,
  isCancelledPath: isRequestDraftCancelledPath,
  isReadyPath: isRequestDraftReadyPath,
  isReservedPath: isRequestDraftReservedPath,
  isUploadingPath: isRequestDraftUploadingPath,
  isClaimablePath: isRequestDraftClaimablePath,
  toUploadingPath: toRequestDraftUploadingPath,
  toReadyPath: toRequestDraftReadyPath,
  toCancelledPath: toRequestDraftCancelledPath,
  physicalPathsFromCancelledPath,
  parsePath: parseRequestDraftPath,
  ownerScopedDraftWhere: ownerScopedUnownedWhere,
  conflictForExisting: conflictForRequestRow,
  conflictForDelete: (existing, userId) => {
    if (existing.uploadedById !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (existing.requestId !== null || existing.solutionId !== null) {
      return NextResponse.json({ error: 'Attachment is no longer a draft' }, { status: 409 })
    }
    return null
  },
  isUnadoptedScopeDraftRow: (row) => row.requestId === null && row.solutionId === null,
}

function draftContextFor(scope: StageScope): DraftContext {
  return scope.kind === 'solution' ? solutionDraftContext(scope.requestId) : REQUEST_DRAFT_CONTEXT
}

function scopeRowTarget(scope: StageScope): string | null {
  return scope.kind === 'solution' ? scope.requestId : null
}

/**
 * `scope` is optional and defaults to 'request' so existing request-scope
 * clients stay byte-for-byte compatible. `requestId` is required (and must be
 * a UUID) when scope is 'solution': solution drafts are owner-scoped rows with
 * requestId set to the target request.
 */
function parseScopeFields(scope: string, requestId: unknown): ParsedStageScope {
  if (scope === 'request') return { scope: { kind: 'request' } }
  if (scope !== 'solution') return { error: 'Invalid scope' }
  const target = typeof requestId === 'string' ? requestId : ''
  if (!ATTACHMENT_ID_RE.test(target)) return { error: 'Invalid requestId' }
  return { scope: { kind: 'solution', requestId: target } }
}

function parseScopeFromBody(body: { scope?: unknown; requestId?: unknown }): ParsedStageScope {
  if (body.scope === undefined) return parseScopeFields('request', body.requestId)
  if (typeof body.scope !== 'string') return { error: 'Invalid scope' }
  return parseScopeFields(body.scope, body.requestId)
}

function parseScopeFromFormData(formData: FormData): ParsedStageScope {
  const scope = formData.get('scope')
  if (scope === null) return parseScopeFields('request', formData.get('requestId'))
  if (typeof scope !== 'string') return { error: 'Invalid scope' }
  return parseScopeFields(scope, formData.get('requestId'))
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

function fileBoundToRow(row: DraftRow, file: File, uploadToken: string, draft: DraftContext): boolean {
  const parsed = draft.parsePath(row.filePath)
  if (!parsed || parsed.kind === 'cancelled' || parsed.uploadToken !== uploadToken) return false
  return parsed.fileName === sanitizeAttachmentFileName(file.name)
    && row.fileName === file.name
    && row.fileType === file.type
    && row.fileSize === file.size
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
  draft: DraftContext,
): NextResponse {
  const conflict = draft.conflictForExisting(existing, userId)
  if (conflict) return conflict
  if (draft.isReadyPath(existing.filePath) && metadataMatches(existing, metadata)) {
    return reservationSuccess(existing, true)
  }
  if (draft.isReservedPath(existing.filePath) || draft.isUploadingPath(existing.filePath)) {
    return reservationSuccess(existing, false)
  }
  return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
}

/**
 * PUT /api/attachments/stage — create-first reservation. JSON
 * `{ attachmentId, fileName, fileType, fileSize, scope?, requestId? }`. The
 * uploadToken is generated once and encoded in the reserved path. Reloads
 * after P2002; cancelled is terminal; ready+matching metadata returns
 * alreadyReady. Solution scope reserves owner-scoped rows with
 * `requestId:<target>`, `solutionId:null`.
 */
export async function PUT(request: Request) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    attachmentId?: unknown
    fileName?: unknown
    fileType?: unknown
    fileSize?: unknown
    scope?: unknown
    requestId?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const scopeResult = parseScopeFromBody(body)
  if ('error' in scopeResult) {
    return NextResponse.json({ error: scopeResult.error }, { status: 400 })
  }
  const draft = draftContextFor(scopeResult.scope)

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
  const reservedPath = draft.createReservedPath(attachmentId, uploadToken, metadata.fileName)
  const created: DraftRow = {
    id: attachmentId,
    requestId: scopeRowTarget(scopeResult.scope),
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

  const existing = await loadDraft(attachmentId)
  if (!existing) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 500 })
  }
  return interpretExistingReservation(existing, user.id, metadata, draft)
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
  draft: DraftContext,
): boolean {
  if (!row) return false
  if (row.id !== params.attachmentId) return false
  if (row.uploadedById !== params.userId) return false
  if (!draft.isUnadoptedScopeDraftRow(row)) return false
  if (!draft.isCancelledPath(row.filePath)) return false
  const cancelled = draft.parsePath(row.filePath)
  const attempt = draft.parsePath(params.uploadingPath) ?? draft.parsePath(params.readyPath)
  if (!cancelled || cancelled.kind !== 'cancelled') return false
  if (!attempt?.uploadToken || !attempt.fileName) return false
  if (!cancelled.uploadToken || !cancelled.fileName) return false
  return cancelled.attachmentId === params.attachmentId
    && cancelled.uploadToken === attempt.uploadToken
    && cancelled.fileName === attempt.fileName
}

async function reloadPostOutcome(attachmentId: string, userId: string, draft: DraftContext): Promise<NextResponse> {
  const row = await loadDraft(attachmentId)
  if (!row) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  const conflict = draft.conflictForExisting(row, userId)
  if (conflict) return conflict
  if (draft.isReadyPath(row.filePath)) return readySuccess(row)
  if (draft.isUploadingPath(row.filePath)) {
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
}, draft: DraftContext): Promise<NextResponse> {
  const row = await loadDraft(params.attachmentId)
  if (cancelledLineageMatchesAttempt(row, params, draft)) {
    if (params.movedReady) await ignoreMissingDelete(params.readyPath)
    if (params.wroteUploading) await ignoreMissingDelete(params.uploadingPath)
  }
  if (!row) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  const conflict = draft.conflictForExisting(row, params.userId)
  if (conflict) return conflict
  if (draft.isReadyPath(row.filePath)) return readySuccess(row)
  if (draft.isUploadingPath(row.filePath)) {
    return NextResponse.json({ error: 'Upload in progress' }, { status: 409 })
  }
  return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
}

async function resumeSameTokenUpload(params: {
  row: DraftRow
  userId: string
  file: File
  bytes: Buffer
}, draft: DraftContext): Promise<NextResponse> {
  const uploadingPath = draft.isUploadingPath(params.row.filePath)
    ? params.row.filePath
    : draft.toUploadingPath(params.row.filePath)
  const readyPath = draft.toReadyPath(uploadingPath)
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
          return reloadPostOutcome(params.row.id, params.userId, draft)
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
          }, draft)
        }
        throw error
      }
    }

    const finalized = await prisma.file_attachments.updateMany({
      where: draft.ownerScopedDraftWhere(params.row.id, params.userId, uploadingPath),
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
      }, draft)
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
 * replaces another, so there is no predecessor lineage to clean. FormData
 * carries `scope` (+ `requestId` for solution scope) so the CAS predicates are
 * bound to the caller's scope; cross-scope rows stay invisible.
 *
 * FormData: file, attachmentId, uploadToken, scope?, requestId?
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

  const scopeResult = parseScopeFromFormData(formData)
  if ('error' in scopeResult) {
    return NextResponse.json({ error: scopeResult.error }, { status: 400 })
  }
  const draft = draftContextFor(scopeResult.scope)

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
    const conflict = draft.conflictForExisting(existing, user.id)
    if (conflict) return conflict
    if (!draft.isClaimablePath(existing.filePath) || !fileBoundToRow(existing, file, uploadToken, draft)) {
      return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
    }
    if (draft.isReadyPath(existing.filePath)) {
      return readySuccess(existing)
    }
    if (draft.isReservedPath(existing.filePath)) {
      const uploadingPath = draft.toUploadingPath(existing.filePath)
      const claimed = await prisma.file_attachments.updateMany({
        where: draft.ownerScopedDraftWhere(attachmentId, user.id, existing.filePath),
        data: { filePath: uploadingPath },
      })
      if (claimed.count !== 1) continue
      return resumeSameTokenUpload({
        row: { ...existing, filePath: uploadingPath },
        userId: user.id,
        file,
        bytes,
      }, draft)
    }
    return resumeSameTokenUpload({
      row: existing,
      userId: user.id,
      file,
      bytes,
    }, draft)
  }

  return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
}

async function unlinkCancelledFiles(cancelledPath: string, draft: DraftContext): Promise<NextResponse | null> {
  for (const storedPath of draft.physicalPathsFromCancelledPath(cancelledPath)) {
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
 * latest owner-scoped unadopted state to a terminal cancelled marker. If no
 * row exists, create a cancelled sentinel (request scope: unowned; solution
 * scope: bound to the target requestId) so later PUT cannot resurrect within
 * that scope. Physical cleanup failure leaves the cancelled row (500) so retry
 * can finish. Adopted rows return 409 and are untouched.
 *
 * JSON: { attachmentId, scope?, requestId? }
 */
export async function DELETE(request: Request) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { attachmentId?: unknown; scope?: unknown; requestId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const scopeResult = parseScopeFromBody(body)
  if ('error' in scopeResult) {
    return NextResponse.json({ error: scopeResult.error }, { status: 400 })
  }
  const draft = draftContextFor(scopeResult.scope)

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
            requestId: scopeRowTarget(scopeResult.scope),
            solutionId: null,
            fileName: 'cancelled',
            fileType: '',
            fileSize: 0,
            filePath: draft.createCancelledSentinelPath(attachmentId),
            uploadedById: user.id,
          },
        })
        return NextResponse.json({ success: true })
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error
        continue
      }
    }

    const conflict = draft.conflictForDelete(existing, user.id)
    if (conflict) return conflict

    if (draft.isCancelledPath(existing.filePath)) {
      const unlinkError = await unlinkCancelledFiles(existing.filePath, draft)
      if (unlinkError) return unlinkError
      return NextResponse.json({ success: true })
    }

    if (!draft.isClaimablePath(existing.filePath)) {
      return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
    }

    const cancelledPath = draft.toCancelledPath(existing.filePath)
    const claimed = await prisma.file_attachments.updateMany({
      where: draft.ownerScopedDraftWhere(attachmentId, user.id, existing.filePath),
      data: { filePath: cancelledPath },
    })
    if (claimed.count !== 1) continue

    const unlinkError = await unlinkCancelledFiles(cancelledPath, draft)
    if (unlinkError) return unlinkError
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Upload was superseded' }, { status: 409 })
}
