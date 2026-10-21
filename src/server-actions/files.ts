'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { sanitizeAttachmentFileName, validateAttachmentMetadata } from '@/lib/attachments/policy'
import {
  createStoredAttachmentPath,
  writeAttachmentFile,
  deleteAttachmentFile,
} from '@/lib/attachments/storage'
import {
  optimizeImageAttachment,
  type ImageOptimizationResult,
} from '@/lib/attachments/image-optimization'
import { canUserViewRequest, createRequestVisibilityDb } from '@/lib/request-visibility/scope'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import {
  evaluateRequestAction,
  existingDeleteAttachmentDecision,
  existingUploadAttachmentDecision,
} from '@/lib/action-permissions'

async function loadOrganizationUnitNodes(): Promise<OrganizationUnitNode[]> {
  return prisma.organization_units.findMany({
    select: {
      id: true,
      name: true,
      parentId: true,
      isActive: true,
      shareRequests: true,
      canWorkOnSolutions: true,
      managerUserId: true,
    },
  })
}

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

  if (!(await canUserViewRequest(userId, requestId))) {
    throw new Error('Unauthorized to delete this file')
  }

  // Write-specific guards. Sharing-scope visibility never grants attachment mutation.
  const isUploader = fileAttachment.uploadedById === userId
  const isRequester = request.requesterId === userId
  const visibilityDb = createRequestVisibilityDb(prisma)
  const actor = await visibilityDb.findActor(userId)
  if (!actor || !actor.isActive) {
    throw new Error('Unauthorized to delete this file')
  }
  const units = await loadOrganizationUnitNodes()

  const deleteAction = evaluateRequestAction('DELETE_ATTACHMENT', {
    actor: {
      id: actor.id,
      role: actor.role,
      isActive: actor.isActive,
      assignmentUnitId: actor.assignmentUnitId,
    },
    request: {
      requesterId: request.requesterId,
      organizationUnitId: null,
      status: request.status,
    },
    canView: true,
    approval: null,
    assignedEngineer: false,
    existingActionDecisions: {
      DELETE_ATTACHMENT: existingDeleteAttachmentDecision({
        isUploader,
        isRequester,
        isActive: actor.isActive,
        assignmentUnitId: actor.assignmentUnitId,
        units,
        status: request.status,
      }),
    },
  })
  if (!deleteAction.allowed) {
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

  const dbRequest = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { id: true, requesterId: true, status: true },
  })

  if (!dbRequest) {
    return { success: false, error: 'Request not found' }
  }

  if (!(await canUserViewRequest(userId, requestId))) {
    return { success: false, error: 'Not authorized to upload to this request' }
  }

  const visibilityDb = createRequestVisibilityDb(prisma)
  const actor = await visibilityDb.findActor(userId)
  if (!actor || !actor.isActive) {
    return { success: false, error: 'Not authorized to upload to this request' }
  }
  const units = await loadOrganizationUnitNodes()
  const isRequester = dbRequest.requesterId === userId

  const uploadAction = evaluateRequestAction('UPLOAD_ATTACHMENT', {
    actor: {
      id: actor.id,
      role: actor.role,
      isActive: actor.isActive,
      assignmentUnitId: actor.assignmentUnitId,
    },
    request: {
      requesterId: dbRequest.requesterId,
      organizationUnitId: null,
      status: dbRequest.status,
    },
    canView: true,
    approval: null,
    assignedEngineer: false,
    existingActionDecisions: {
      UPLOAD_ATTACHMENT: existingUploadAttachmentDecision({
        isRequester,
        isActive: actor.isActive,
        assignmentUnitId: actor.assignmentUnitId,
        units,
        status: dbRequest.status,
      }),
    },
  })
  if (!uploadAction.allowed) {
    return { success: false, error: 'Not authorized to upload to this request' }
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  let prepared: ImageOptimizationResult
  try {
    prepared = await optimizeImageAttachment({
      bytes,
      fileName: file.name,
      mimeType: file.type,
    })
  } catch (error) {
    console.warn('[uploadFileAction] Failed to optimize image attachment', error)
    return { success: false, error: 'Unable to process image' }
  }

  // Persist the attachment through the private storage layer. The stored path
  // is derived from the requestId + a sanitized filename so it is stable across
  // the write, the DB record, and any later compensation delete.
  const storedPath = createStoredAttachmentPath(requestId, file.name)
  await writeAttachmentFile(storedPath, prepared.bytes)

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
        fileSize: prepared.storedSize,
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

  return { success: true, fileAttachment }
}
