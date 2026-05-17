'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { generateRequestPDF, RequestPDFData } from '@/lib/pdf'
import {
  convertAttachmentToPdf,
  mergePdfBuffers,
  validateExportPackageRequestItems,
  type ExportableAttachment,
  type ExportPackageRequestItem,
} from '@/lib/pdf-package'

/**
 * In-memory rate limiting for PDF exports
 * Limits to 3 PDFs per minute per user
 */
const pdfRateLimit = new Map<string, { count: number; resetAt: number }>()

/**
 * Check rate limit for PDF exports
 * @param userId - User ID to check rate limit for
 * @returns true if rate limit exceeded, false otherwise
 */
function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const windowMs = 60 * 1000 // 1 minute window
  const maxRequests = 3

  const userLimit = pdfRateLimit.get(userId)

  if (!userLimit) {
    // First request from this user
    pdfRateLimit.set(userId, { count: 1, resetAt: now + windowMs })
    return false
  }

  if (now > userLimit.resetAt) {
    // Window expired, reset counter
    pdfRateLimit.set(userId, { count: 1, resetAt: now + windowMs })
    return false
  }

  if (userLimit.count >= maxRequests) {
    // Rate limit exceeded
    return true
  }

  // Increment counter
  userLimit.count += 1
  pdfRateLimit.set(userId, userLimit)
  return false
}

/**
 * Sanitize a string for use in filename
 * Removes special characters and limits length
 */
function sanitizeForFilename(input: string, maxLength: number = 50): string {
  // Remove special characters, keep alphanumeric and spaces
  let sanitized = input.replace(/[^a-zA-Z0-9\s]/g, '').trim()
  // Replace spaces with underscores
  sanitized = sanitized.replace(/\s+/g, '_')
  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength)
  }
  return sanitized || 'Request'
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDateAsYYYYMMDD(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function getExportableRequest(requestId: string) {
  return prisma.requests.findFirst({
    where: { id: requestId },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      department: { select: { id: true, name: true } },
      fileAttachments: {
        include: { uploadedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      activities: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
      approvals: {
        include: {
          approver: { select: { id: true, name: true, email: true, role: true, department: { select: { name: true } } } },
          requiredApprover: { select: { id: true, name: true, email: true, role: true, department: { select: { name: true } } } },
        },
        orderBy: [{ requiredLevel: 'asc' }, { order: 'asc' }],
      },
      solutions: {
        include: {
          submittedBy: { select: { id: true, name: true } },
          fileAttachments: {
            include: { uploadedBy: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          },
          approvals: {
            include: {
              approver: { select: { id: true, name: true, email: true, role: true, department: { select: { name: true } } } },
              requiredApprover: { select: { id: true, name: true, email: true, role: true, department: { select: { name: true } } } },
            },
            orderBy: [{ order: 'asc' }],
          },
        },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  })
}

type ExportableRequest = NonNullable<Awaited<ReturnType<typeof getExportableRequest>>>

async function getCurrentExportUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      departmentId: true,
      isActive: true,
      department: { select: { type: true } },
    },
  })
}

function canUserExportRequest(user: NonNullable<Awaited<ReturnType<typeof getCurrentExportUser>>>, request: ExportableRequest): boolean {
  return (
    user.role === 'admin' ||
    user.department?.type === 'ENGINEERING' ||
    request.requesterId === user.id ||
    request.departmentId === user.departmentId ||
    request.approvals.some((a) => a.requiredApproverId === user.id || a.approverId === user.id) ||
    request.solutions.some((solution) =>
      solution.approvals.some((a) => a.requiredApproverId === user.id || a.approverId === user.id)
    )
  )
}

function buildApprovalPhases(request: ExportableRequest): RequestPDFData['approvalPhases'] {
  const phases: RequestPDFData['approvalPhases'] = []

  const initialApprovals = request.approvals
    .filter((approval) => !approval.isFinalApproval && !approval.isCustomChain)
    .map((approval, index) => ({
      approverName: approval.approver?.name || approval.requiredApprover?.name || request.requester.name || 'Unknown',
      approverRole: approval.approver?.role || approval.requiredApprover?.role,
      approverDepartment: approval.approver?.department?.name || approval.requiredApprover?.department?.name,
      requiredLevel: approval.requiredLevel,
      status: approval.status as 'approved' | 'rejected' | 'pending',
      comments: approval.comments || undefined,
      approvedAt: approval.approvedAt || undefined,
      order: approval.order,
      stage: index === 0 ? 'Initial Request' : `Department Review ${index}`,
      isSolutionApproval: false,
    }))

  if (initialApprovals.length > 0) {
    phases.push({ phaseName: 'Phase 1: Initial Review', phaseOrder: 1, approvals: initialApprovals })
  }

  const solution = request.solutions[0]
  if (solution?.approvals.length) {
    phases.push({
      phaseName: 'Phase 2: Engineering Solution',
      phaseOrder: 2,
      approvals: solution.approvals.map((approval, index) => ({
        approverName: approval.approver?.name || approval.requiredApprover?.name || 'Engineering',
        approverRole: approval.approver?.role || approval.requiredApprover?.role || 'Engineering',
        approverDepartment: approval.approver?.department?.name || approval.requiredApprover?.department?.name || 'Engineering',
        requiredLevel: approval.requiredLevel || 1,
        status: approval.status as 'approved' | 'rejected' | 'pending',
        comments: approval.comments || undefined,
        approvedAt: approval.approvedAt || undefined,
        order: approval.order,
        stage: index === 0 ? 'Solution Review' : `Solution Approval ${index}`,
        isSolutionApproval: true,
      })),
    })
  }

  const finalApprovals = request.approvals
    .filter((approval) => approval.isFinalApproval)
    .map((approval, index) => ({
      approverName: approval.approver?.name || approval.requiredApprover?.name || 'Pending',
      approverRole: approval.approver?.role || approval.requiredApprover?.role,
      approverDepartment: approval.approver?.department?.name || approval.requiredApprover?.department?.name,
      requiredLevel: approval.requiredLevel,
      status: approval.status as 'approved' | 'rejected' | 'pending',
      comments: approval.comments || undefined,
      approvedAt: approval.approvedAt || undefined,
      order: approval.order,
      stage: `Final Approval ${index + 1}`,
      isSolutionApproval: false,
    }))

  if (finalApprovals.length > 0) {
    phases.push({ phaseName: 'Phase 3: Final Approval', phaseOrder: 3, approvals: finalApprovals })
  }

  return phases
}

async function buildRequestPDFData(requestId: string, userId: string): Promise<{
  pdfData: RequestPDFData
  request: ExportableRequest
  generatedBy: string
}> {
  const request = await getExportableRequest(requestId)
  if (!request) {
    throw new Error('Request not found. Please verify the request ID.')
  }

  const currentUser = await getCurrentExportUser(userId)
  if (!currentUser?.isActive) {
    throw new Error('Authentication required. Please log in to export PDFs.')
  }

  if (!canUserExportRequest(currentUser, request)) {
    throw new Error('You are not authorized to export this request.')
  }

  const validStatuses = ['FinalApproval', 'Completed']
  if (!validStatuses.includes(request.status)) {
    throw new Error(`PDF export is only available for requests in FinalApproval or Completed status. Current status: ${request.status}`)
  }

  if (request.approvals.some((approval) => approval.status !== 'approved')) {
    throw new Error('PDF export is only available after all approvals are completed. Please wait for all approvals to be processed.')
  }

  if (request.solutions[0]?.approvals.some((approval) => approval.status !== 'approved')) {
    throw new Error('PDF export is only available after all solution approvals are completed. Please wait for all approvals to be processed.')
  }

  const completedActivity = request.activities.find(
    (activity) => activity.action === 'manually_completed' || activity.toStatus === 'Completed'
  )
  const completedAt = completedActivity?.createdAt || undefined
  const generatedBy = currentUser.name || 'Unknown'

  const pdfData: RequestPDFData = {
    id: request.id,
    referenceId: request.id,
    title: request.title,
    description: request.description,
    requester: {
      name: request.requester.name,
      email: request.requester.email,
      department: request.department.name,
    },
    department: request.department.name,
    status: request.status,
    createdAt: request.createdAt,
    completedAt,
    fileAttachments: request.fileAttachments.map((file) => ({
      fileName: file.fileName,
      fileSize: file.fileSize,
      fileType: file.fileType,
      createdAt: file.createdAt,
      uploadedBy: file.uploadedBy.name,
    })),
    approvalPhases: buildApprovalPhases(request),
    activities: request.activities.map((activity) => ({
      action: activity.action,
      userName: activity.user.name,
      createdAt: activity.createdAt,
      comments: activity.comments || undefined,
    })),
    generatedBy,
  }

  const solution = request.solutions[0]
  if (solution) {
    pdfData.solution = {
      title: solution.title,
      description: solution.description,
      costEstimate: solution.costEstimate ? Number(solution.costEstimate) : 0,
      currency: solution.currency,
      timeline: solution.timeline || undefined,
      conceptDesign: solution.conceptDesign || undefined,
      submittedBy: solution.submittedBy.name,
      submittedAt: solution.createdAt,
      fileAttachments: solution.fileAttachments.map((file) => ({
        fileName: file.fileName,
        fileSize: file.fileSize,
        fileType: file.fileType,
        createdAt: file.createdAt,
      })),
    }
  }

  return { pdfData, request, generatedBy }
}

function buildExportableAttachment(file: ExportableRequest['fileAttachments'][number]): ExportableAttachment {
  return {
    id: file.id,
    fileName: file.fileName,
    fileType: file.fileType,
    filePath: file.filePath,
  }
}

async function getAuthenticatedExportUserId() {
  const { user: authUser } = (await auth()) ?? {}
  return authUser?.id
}

export async function exportRequestAsPDF(requestId: string) {
  try {
    const userId = await getAuthenticatedExportUserId()
    if (!userId) {
      return { success: false, error: 'Authentication required. Please log in to export PDFs.' }
    }

    if (checkRateLimit(userId)) {
      return {
        success: false,
        error: 'Rate limit exceeded. You can export up to 3 PDFs per minute. Please try again later.',
      }
    }

    const { pdfData, request } = await buildRequestPDFData(requestId, userId)
    const pdfBuffer = await generateRequestPDF(pdfData)
    const sanitizedTopic = sanitizeForFilename(request.title)
    const dateStr = formatDateAsYYYYMMDD(request.createdAt)

    return {
      success: true,
      data: pdfBuffer.toString('base64'),
      filename: `Request_${sanitizedTopic}_${dateStr}.pdf`,
      contentType: 'application/pdf',
    }
  } catch (error) {
    console.error('Error exporting request as PDF:', error)
    return {
      success: false,
      error: error instanceof Error
        ? error.message
        : 'An unexpected error occurred while generating the PDF. Please try again.',
    }
  }
}

export async function exportRequestPackageAsPDF(requestId: string, items: ExportPackageRequestItem[]) {
  try {
    const userId = await getAuthenticatedExportUserId()
    if (!userId) {
      return { success: false, error: 'Authentication required. Please log in to export PDFs.' }
    }

    if (checkRateLimit(userId)) {
      return {
        success: false,
        error: 'Rate limit exceeded. You can export up to 3 PDFs per minute. Please try again later.',
      }
    }

    const { pdfData, request } = await buildRequestPDFData(requestId, userId)
    const requestAttachments = new Map<string, ExportableAttachment>(
      request.fileAttachments.map((file) => [file.id, buildExportableAttachment(file)])
    )
    const solutionAttachments = new Map<string, ExportableAttachment>(
      (request.solutions[0]?.fileAttachments ?? []).map((file) => [file.id, buildExportableAttachment(file)])
    )

    validateExportPackageRequestItems(items, {
      requestAttachmentIds: new Set(requestAttachments.keys()),
      solutionAttachmentIds: new Set(solutionAttachments.keys()),
    })

    const pdfBuffers: Buffer[] = []
    let approvalReportBuffer: Buffer | undefined
    for (const item of items) {
      if (item.type === 'approval-report') {
        approvalReportBuffer ??= await generateRequestPDF(pdfData)
        pdfBuffers.push(approvalReportBuffer)
        continue
      }

      const attachment = item.type === 'request-attachment'
        ? requestAttachments.get(item.attachmentId)
        : solutionAttachments.get(item.attachmentId)

      if (!attachment) {
        return { success: false, error: `Attachment ${item.attachmentId} was not found for this request.` }
      }

      try {
        pdfBuffers.push(await convertAttachmentToPdf({ attachment }))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Attachment conversion failed.'
        return { success: false, error: `Could not convert ${attachment.fileName}: ${message}` }
      }
    }

    const mergedPdf = await mergePdfBuffers(pdfBuffers)
    const sanitizedTopic = sanitizeForFilename(request.title)
    const dateStr = formatDateAsYYYYMMDD(request.createdAt)

    return {
      success: true,
      data: mergedPdf.toString('base64'),
      filename: `Approval_Package_${sanitizedTopic}_${dateStr}.pdf`,
      contentType: 'application/pdf',
    }
  } catch (error) {
    console.error('Error exporting request package as PDF:', error)
    return {
      success: false,
      error: error instanceof Error
        ? error.message
        : 'An unexpected error occurred while generating the PDF package. Please try again.',
    }
  }
}
