'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { getFileUrl, saveFile, generateFilePath } from '@/lib/files'
import { revalidatePath } from 'next/cache'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
]

interface PrepareFileUploadInput {
  fileName: string
  fileType: string
  fileSize: number
  requestId: string
}

interface ConfirmFileUploadInput {
  requestId: string
  fileId: string
  fileName: string
  fileType: string
  fileSize: number
  filePath: string
  description?: string
}

interface ConfirmSolutionFileUploadInput {
  solutionId: string
  fileId: string
  fileName: string
  fileType: string
  fileSize: number
  filePath: string
  description?: string
}

const prepareFileUploadSchema = z.object({
  fileName: z.string().min(1, 'File name is required'),
  fileType: z.string().min(1, 'File type is required'),
  fileSize: z.number().max(MAX_FILE_SIZE, `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`),
  requestId: z.string().min(1, 'Request ID is required'),
})

/**
 * Prepare file upload by returning upload endpoint URL
 * Validates file type and size before allowing upload
 */
export async function prepareFileUpload(input: PrepareFileUploadInput) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Validate input
  const validatedFields = prepareFileUploadSchema.safeParse(input)

  if (!validatedFields.success) {
    return {
      success: false,
      errors: validatedFields.error.flatten().fieldErrors,
    }
  }

  // Validate file type
  if (!ALLOWED_FILE_TYPES.includes(input.fileType)) {
    return {
      success: false,
      error: `File type not allowed. Allowed types: PDF, Word, Excel, Images`,
    }
  }

  // Verify request exists and user owns it or is an engineering user
  // For engineering solutions: any engineering user can upload files to SentToEngineer requests
  const request = await prisma.requests.findUnique({
    where: { id: input.requestId },
    select: {
      id: true,
      requesterId: true,
      status: true,
    },
  })

  console.log('[prepareFileUpload] Request query result:', {
    requestId: input.requestId,
    userId,
    requestFound: !!request,
    requesterId: request?.requesterId,
    status: request?.status,
  })

  if (!request) {
    return {
      success: false,
      error: 'Request not found or unauthorized',
    }
  }

  // Check if user is the requester
  const isRequester = request.requesterId === userId

  // For engineering users: check if this is a request in engineering workflow
  // Any engineering user can upload files to SentToEngineer status requests
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })

  const isEngineeringUser = user?.role === 'engineering'
  const isEngineeringRequest = request.status === 'SentToEngineer'
  const canEngineerUpload = isEngineeringUser && isEngineeringRequest

  console.log('[prepareFileUpload] Authorization check:', {
    isRequester,
    isEngineeringUser,
    isEngineeringRequest,
    canEngineerUpload,
    authorized: isRequester || canEngineerUpload,
  })

  if (!isRequester && !canEngineerUpload) {
    return {
      success: false,
      error: 'Request not found or unauthorized',
    }
  }

  // Generate unique file ID
  const fileId = crypto.randomUUID()

  // Return upload endpoint URL (not presigned S3 URL)
  const uploadUrl = '/api/upload'

  return {
    success: true,
    uploadUrl,
    fileId,
  }
}

/**
 * Confirm file upload and save metadata to database
 * Call this AFTER successful file upload to /api/upload
 */
export async function confirmFileUpload(input: ConfirmFileUploadInput) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Save file metadata to database
  const fileAttachment = await prisma.file_attachments.create({
    data: {
      id: input.fileId,
      requestId: input.requestId,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      filePath: input.filePath,
      description: input.description,
      uploadedById: userId,
    },
  })

  // Log file attachment in audit trail
  await prisma.request_activities.create({
    data: {
      requestId: input.requestId,
      action: 'file_attached',
      comments: `File attached: ${input.fileName}`,
      userId,
    },
  })

  // Revalidate to refresh UI
  revalidatePath('/requests')
  revalidatePath(`/requests/${input.requestId}`)

  return { success: true, fileAttachment }
}

/**
 * Confirm file upload for engineering solution
 * Sets solutionId instead of requestId (prevents duplication)
 */
export async function confirmSolutionFileUpload(input: ConfirmSolutionFileUploadInput) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Verify solution exists
  const solution = await prisma.solutions.findUnique({
    where: { id: input.solutionId },
    select: { requestId: true },
  })

  if (!solution) {
    throw new Error('Solution not found')
  }

  // Save file metadata to database with solutionId (NOT requestId)
  const fileAttachment = await prisma.file_attachments.create({
    data: {
      id: input.fileId,
      solutionId: input.solutionId,  // Set solutionId, not requestId
      requestId: null,  // Explicitly null to prevent duplication
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      filePath: input.filePath,
      description: input.description,
      uploadedById: userId,
    },
  })

  // Log file attachment in audit trail
  await prisma.request_activities.create({
    data: {
      requestId: solution.requestId,
      action: 'file_attached',
      comments: `Solution file attached: ${input.fileName}`,
      userId,
    },
  })

  // Revalidate to refresh UI
  revalidatePath('/requests')
  revalidatePath('/engineering')

  return { success: true, fileAttachment }
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

  // Delete the physical file from disk
  try {
    const filePath = join(process.cwd(), 'public', fileAttachment.filePath.replace(/^\//, ''))
    await unlink(filePath)
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
 * Get download URL for a file
 * Files are served directly by Next.js static file serving
 */
export async function getDownloadUrl(filePath: string): Promise<string> {
  return getFileUrl(filePath)
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

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }
  }

  // Validate file type
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return { success: false, error: 'File type not allowed. Allowed types: PDF, Word, Excel, Images' }
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

  // Save file to disk
  const filePath = generateFilePath(requestId, file.name)
  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  await saveFile(filePath, buffer)

  // Create database record
  const fileId = crypto.randomUUID()
  const fileAttachment = await prisma.file_attachments.create({
    data: {
      id: fileId,
      requestId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      filePath,
      description: description || null,
      uploadedById: userId,
    },
  })

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
 * Unified solution file upload action — handles validation, saving, and DB record in one call.
 * Links the file to a solutionId instead of requestId.
 */
export async function uploadSolutionFileAction(
  _prevState: { success: boolean; error?: string; fileAttachment?: any } | null,
  formData: FormData
) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const file = formData.get('file') as File | null
  const solutionId = formData.get('solutionId') as string | null
  const description = formData.get('description') as string | null

  if (!file || !solutionId) {
    return { success: false, error: 'File and solutionId are required' }
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }
  }

  // Validate file type
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return { success: false, error: 'File type not allowed. Allowed types: PDF, Word, Excel, Images' }
  }

  // Verify solution exists and get its requestId for file path + activity log
  const solution = await prisma.solutions.findUnique({
    where: { id: solutionId },
    select: { requestId: true },
  })

  if (!solution) {
    return { success: false, error: 'Solution not found' }
  }

  // Save file to disk (organized by requestId for consistency)
  const filePath = generateFilePath(solution.requestId, file.name)
  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  await saveFile(filePath, buffer)

  // Create database record with solutionId (NOT requestId)
  const fileId = crypto.randomUUID()
  const fileAttachment = await prisma.file_attachments.create({
    data: {
      id: fileId,
      solutionId,
      requestId: null,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      filePath,
      description: description || null,
      uploadedById: userId,
    },
  })

  // Log activity
  await prisma.request_activities.create({
    data: {
      requestId: solution.requestId,
      action: 'file_attached',
      comments: `Solution file attached: ${file.name}`,
      userId,
    },
  })

  revalidatePath('/requests')
  revalidatePath('/engineering')

  return { success: true, fileAttachment }
}
