'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { RequestStatus, UserRole } from '@prisma/client'
import { sanitizeAttachmentFileName, validateAttachmentMetadata, MAX_ATTACHMENTS_PER_FORM } from '@/lib/attachments/policy'
import {
  createStoredAttachmentPath,
  writeAttachmentFile,
  deleteAttachmentFile,
} from '@/lib/attachments/storage'
import { revalidateRequestViews } from './request-view-invalidation'

/**
 * Delete a file attachment
 * Deletes both the database record and the physical file from disk
 */
export async function deleteFileAttachment({ fileId }: { fileId: string }) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Fetch the file attachment with request info
  const fileAttachment = await prisma.file_attachments.findUnique({
    where: { id: fileId },
    include: {
      request: {
        select: {
          id: true,
          requesterId: true,
          status: true,
        },
      },
      solution: {
        select: {
          id: true,
          requestId: true,
        },
      },
    },
  })

  if (!fileAttachment) {
    throw new Error('File not found')
  }

  // Get the request ID (either from direct relation or through solution)
  const requestId = fileAttachment.requestId || fileAttachment.solution?.requestId

  if (!requestId) {
    throw new Error('Unable to determine request for this file')
  }

  const request = fileAttachment.request || await prisma.requests.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      requesterId: true,
      status: true,
    },
  })

  if (!request) {
    throw new Error('Associated request not found')
  }

  // Authorization check
  const isUploader = fileAttachment.uploadedById === userId
  const isRequester = request.requesterId === userId

  // Check if user is engineering user (for engineering-phase files)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  const isEngineeringUser = user?.role === 'engineering'
  const isEngineeringPhase = ['SentToEngineer', 'DesignCostEstimationApproval', 'SendBackToRequester', 'FinalApproval'].includes(request.status)

  if (!isUploader && !isRequester && !(isEngineeringUser && isEngineeringPhase)) {
    throw new Error('Unauthorized to delete this file')
  }

  // Delete the database record
  await prisma.file_attachments.delete({
    where: { id: fileId },
  })

  // Delete the physical file from disk via the private storage layer
  try {
    await deleteAttachmentFile(fileAttachment.filePath)
  } catch (err) {
    // Log warning but don't fail - file may already be gone
    console.warn(`[deleteFileAttachment] Failed to delete physical file: ${fileAttachment.filePath}`, err)
  }

  // Log activity
  await prisma.request_activities.create({
    data: {
      requestId: request.id,
      action: 'file_removed',
      comments: `File removed: ${fileAttachment.fileName}`,
      userId,
    },
  })

  // Revalidate to refresh UI
  revalidatePath('/requests')
  revalidatePath(`/requests/${request.id}`)
  revalidatePath('/engineering')

  return { success: true }
}

/**
 * Unified file upload action — handles validation, saving, and DB record in one call.
 * Receives a File via FormData from the client, eliminating the need for a separate API route.
 */
export async function uploadFileAction(
  _prevState: { success: boolean; error?: string; fileAttachment?: any } | null,
  formData: FormData
) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const file = formData.get('file') as File | null
  const requestId = formData.get('requestId') as string | null
  const description = formData.get('description') as string | null

  if (!file || !requestId) {
    return { success: false, error: 'File and requestId are required' }
  }

  // Validate file size and type using the shared attachment policy
  const policyError = validateAttachmentMetadata({
    name: file.name,
    type: file.type,
    size: file.size,
  })
  if (policyError) {
    return { success: false, error: policyError }
  }

  // Verify request exists and user is authorized
  const [dbRequest, user] = await Promise.all([
    prisma.requests.findUnique({
      where: { id: requestId },
      select: { id: true, requesterId: true, status: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    }),
  ])

  if (!dbRequest) {
    return { success: false, error: 'Request not found' }
  }

  const isRequester = dbRequest.requesterId === userId
  const isEngineeringUser = user?.role === 'engineering'
  const isEngineeringRequest = dbRequest.status === 'SentToEngineer'
  const canEngineerUpload = isEngineeringUser && isEngineeringRequest

  if (!isRequester && !canEngineerUpload) {
    return { success: false, error: 'Not authorized to upload to this request' }
  }

  // Persist the attachment through the private storage layer. The stored path
  // is derived from the requestId + a sanitized filename so it is stable across
  // the write, the DB record, and any later compensation delete.
  const storedPath = createStoredAttachmentPath(requestId, file.name)
  const bytes = await file.arrayBuffer()
  await writeAttachmentFile(storedPath, Buffer.from(bytes))

  // Create database record. If this fails, remove the file we just wrote so it
  // is not orphaned outside the request lifecycle (best-effort compensation).
  const fileId = crypto.randomUUID()
  const fileName = sanitizeAttachmentFileName(file.name)
  let fileAttachment
  try {
    fileAttachment = await prisma.file_attachments.create({
      data: {
        id: fileId,
        requestId,
        fileName,
        fileType: file.type,
        fileSize: file.size,
        filePath: storedPath,
        description: description || null,
        uploadedById: userId,
      },
    })
  } catch (dbError) {
    try {
      await deleteAttachmentFile(storedPath)
    } catch (cleanupError) {
      console.warn(`[uploadFileAction] Failed to clean up attachment ${storedPath}`, cleanupError)
    }
    throw dbError
  }

  // Log activity
  await prisma.request_activities.create({
    data: {
      requestId,
      action: 'file_attached',
      comments: `File attached: ${file.name}`,
      userId,
    },
  })

  revalidatePath('/requests')
  revalidatePath(`/requests/${requestId}`)

  return { success: true, fileAttachment }
}

/**
 * A file_attachment row serialized for the Server Action boundary. Prisma
 * returns `createdAt` as a `Date` (and Decimal fields where present), which are
 * not safe to return from a Server Action without explicit coercion. Every
 * field here is a JSON primitive so the result can cross the server/client
 * boundary intact.
 */
export interface SerializedAttachment {
  id: string
  requestId: string | null
  solutionId: string | null
  fileName: string
  fileType: string
  fileSize: number
  filePath: string
  description: string | null
  uploadedById: string
  createdAt: string
}

function serializeAttachment(row: {
  id: string
  requestId: string | null
  solutionId: string | null
  fileName: string
  fileType: string
  fileSize: number
  filePath: string
  description: string | null
  uploadedById: string
  createdAt: Date | string
}): SerializedAttachment {
  return {
    id: row.id,
    requestId: row.requestId,
    solutionId: row.solutionId,
    fileName: row.fileName,
    fileType: row.fileType,
    fileSize: row.fileSize,
    filePath: row.filePath,
    description: row.description,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
  }
}

export type DraftUploadResult =
  | { success: true; attachmentId: string; fileAttachment: SerializedAttachment }
  | { success: false; error: string }

/**
 * Upload a solution DRAFT attachment during the engineering phase.
 *
 * Authorization is strict by design:
 * - The caller must be authenticated.
 * - The caller must hold the ACTIVE engineering role (not merely be assigned it).
 * - The target request must exist, be non-deleted, and be in `SentToEngineer`
 *   (the only window in which engineering drafts are gathered before a solution
 *   is submitted and the request advances to `DesignCostEstimationApproval`).
 *
 * The attachment is stored against the target `requestId` with `solutionId: null`
 * — it is a draft until `submitSolution` links it to a created solution. The
 * uploader is always recorded as the current user. The file is written through
 * the private storage layer first; if the DB record then fails, the file is
 * removed so it can never be orphaned outside the request lifecycle.
 */
export async function uploadSolutionDraftAttachmentAction(
  _previous: unknown,
  formData: FormData
): Promise<DraftUploadResult> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    return { success: false, error: 'Unauthorized' }
  }

  // Active engineering role required: a deactivated account or a non-engineering
  // user must never be able to stage solution drafts.
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  })
  if (!currentUser || currentUser.role !== UserRole.engineering || currentUser.isActive === false) {
    return { success: false, error: 'Only active engineering users can upload solution drafts' }
  }

  const file = formData.get('file') as File | null
  const requestId = formData.get('requestId') as string | null
  const description = formData.get('description') as string | null

  if (!file || !requestId) {
    return { success: false, error: 'File and requestId are required' }
  }

  // Shared metadata policy (per-file size maximum + type), same gate as the
  // request upload path so server validation stays consistent.
  const policyError = validateAttachmentMetadata({
    name: file.name,
    type: file.type,
    size: file.size,
  })
  if (policyError) {
    return { success: false, error: policyError }
  }

  // The request must exist, not be soft-deleted, and still be in the
  // engineering intake status.
  const dbRequest = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, isDeleted: true, deletedAt: true },
  })
  if (
    !dbRequest ||
    dbRequest.isDeleted ||
    dbRequest.deletedAt ||
    dbRequest.status !== RequestStatus.SentToEngineer
  ) {
    return { success: false, error: 'Request is not available for solution draft upload' }
  }

  // Persist through the private storage layer, keyed by the target request.
  const storedPath = createStoredAttachmentPath(requestId, file.name)
  const bytes = await file.arrayBuffer()
  await writeAttachmentFile(storedPath, Buffer.from(bytes))

  // Create the draft record: requestId = target, solutionId = null, uploader =
  // current user. If the insert fails, remove the file we just wrote so it is
  // not orphaned (best-effort compensation).
  const attachmentId = crypto.randomUUID()
  const fileName = sanitizeAttachmentFileName(file.name)
  let fileAttachment
  try {
    fileAttachment = await prisma.file_attachments.create({
      data: {
        id: attachmentId,
        requestId,
        solutionId: null,
        fileName,
        fileType: file.type,
        fileSize: file.size,
        filePath: storedPath,
        description: description || null,
        uploadedById: userId,
      },
    })
  } catch (dbError) {
    try {
      await deleteAttachmentFile(storedPath)
    } catch (cleanupError) {
      console.warn(`[uploadSolutionDraftAttachmentAction] Failed to clean up attachment ${storedPath}`, cleanupError)
    }
    throw dbError
  }

  revalidateRequestViews(requestId)

  return {
    success: true,
    attachmentId: fileAttachment.id,
    fileAttachment: serializeAttachment(fileAttachment),
  }
}

export type CleanupSolutionDraftAttachmentsResult =
  | { success: true; deletedIds: string[]; warnings: string[] }
  | { success: false; error: string }

// Canonical UUID v1-v5 textual form (8-4-4-4-12 hex). Used to reject anything
// that is not a row id before it ever reaches Prisma.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Remove solution DRAFT attachments the current user owns.
 *
 * Owner-only by construction: the candidate set is intersected with
 * `requestId`, `solutionId: null` (still a draft — not yet linked to a
 * solution), and `uploadedById` = the current user. Any id that fails that
 * intersection is rejected up front (exact-count match), so this can never
 * delete another user's files, a linked solution's files, or files on a
 * different request. Database rows are removed inside a transaction first; only
 * then are physical files deleted with `Promise.allSettled`, so a failed unlink
 * is reported as a per-attachment warning without aborting the others.
 */
export async function cleanupSolutionDraftAttachments({
  requestId,
  attachmentIds,
}: {
  requestId: string
  attachmentIds: string[]
}): Promise<CleanupSolutionDraftAttachmentsResult> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    return { success: false, error: 'Unauthorized' }
  }

  if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) {
    return { success: false, error: 'attachmentIds must be a non-empty array' }
  }
  if (attachmentIds.length > MAX_ATTACHMENTS_PER_FORM) {
    return { success: false, error: `Cannot delete more than ${MAX_ATTACHMENTS_PER_FORM} attachments at once` }
  }
  const invalidId = attachmentIds.find((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))
  if (invalidId !== undefined) {
    return { success: false, error: 'attachmentIds contains an invalid UUID' }
  }

  // Owner/request/unlinked exact-count query. Only records matching ALL of
  // {these ids, this request, still unlinked, owned by the caller} may be
  // touched. A count mismatch means some id was not owned / already linked /
  // on another request, and the whole request is rejected without deleting.
  const owned = await prisma.file_attachments.findMany({
    where: {
      id: { in: attachmentIds },
      requestId,
      solutionId: null,
      uploadedById: userId,
    },
    select: { id: true, filePath: true },
  })

  if (owned.length !== attachmentIds.length) {
    return {
      success: false,
      error: 'Some attachments were not found, belong to another user, or are already linked to a solution',
    }
  }

  // Delete the DB records inside a transaction before touching any file on disk.
  await prisma.$transaction(async (tx) => {
    await tx.file_attachments.deleteMany({
      where: {
        id: { in: attachmentIds },
        requestId,
        solutionId: null,
        uploadedById: userId,
      },
    })
  })

  // Physically remove the now-orphaned files. One failure must not stop the
  // others; each rejection is surfaced as a named warning instead.
  const warnings: string[] = []
  const cleanups = await Promise.allSettled(owned.map((entry) => deleteAttachmentFile(entry.filePath)))
  cleanups.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      const entry = owned[index]
      warnings.push(
        `Attachment ${entry.id}: database record removed but physical file ${entry.filePath} could not be deleted`
      )
    }
  })

  revalidateRequestViews(requestId)

  return { success: true, deletedIds: attachmentIds, warnings }
}
