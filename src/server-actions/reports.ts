'use server'

import { auth } from '@clerk/nextjs/server'
import prisma from '@/lib/prisma'
import { generateRequestPDF, RequestPDFData } from '@/lib/pdf'

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

/**
 * Export a request as PDF
 * Requires authentication and enforces rate limiting
 *
 * Validation rules:
 * - User must be authenticated
 * - Max 3 PDF exports per minute per user
 * - Request status must be FinalApproval or Completed
 * - All approvals must be approved
 *
 * @param requestId - The ID of the request to export
 * @returns PDF data as base64 encoded string with filename
 */
export async function exportRequestAsPDF(requestId: string) {
  try {
    // a. Get userId from auth - return error if not authenticated
    const { userId } = await auth()
    if (!userId) {
      return {
        success: false,
        error: 'Authentication required. Please log in to export PDFs.',
      }
    }

    // b. Rate limit check (3 PDFs per minute)
    if (checkRateLimit(userId)) {
      return {
        success: false,
        error: 'Rate limit exceeded. You can export up to 3 PDFs per minute. Please try again later.',
      }
    }

    // c. Fetch request with comprehensive Prisma query
    const request = await prisma.request.findFirst({
      where: { id: requestId },
      include: {
        requester: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        department: {
          select: {
            id: true,
            name: true,
          },
        },
        fileAttachments: {
          include: {
            uploadedBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        activities: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        approvals: {
          include: {
            approver: {
              select: {
                id: true,
                name: true,
                email: true,
                department: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            requiredApprover: {
              select: {
                id: true,
                name: true,
                email: true,
                department: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: [
            {
              requiredLevel: 'asc',
            },
            {
              order: 'asc',
            },
          ],
        },
        solutions: {
          include: {
            submittedBy: {
              select: {
                id: true,
                name: true,
              },
            },
            fileAttachments: {
              include: {
                uploadedBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
              orderBy: {
                createdAt: 'asc',
              },
            },
            approvals: {
              include: {
                approver: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    department: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
                requiredApprover: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    department: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
              orderBy: [
                {
                  order: 'asc',
                },
              ],
            },
          },
          take: 1,
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    })

    // d. Validate request exists - return error if not found
    if (!request) {
      return {
        success: false,
        error: 'Request not found. Please verify the request ID.',
      }
    }

    // e. Validate status is FinalApproval or Completed - return error if not
    const validStatuses = ['FinalApproval', 'Completed']
    if (!validStatuses.includes(request.status)) {
      return {
        success: false,
        error: `PDF export is only available for requests in FinalApproval or Completed status. Current status: ${request.status}`,
      }
    }

    // f. Validate all approvals have status 'approved' - return error if any pending
    const pendingApproval = request.approvals.find((a) => a.status !== 'approved')
    if (pendingApproval) {
      return {
        success: false,
        error: 'PDF export is only available after all approvals are completed. Please wait for all approvals to be processed.',
      }
    }

    // g. Fetch current user name for metadata
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    })
    const generatedBy = currentUser?.name || 'Unknown'

    // h. Determine completedAt from activities
    // Look for activity with action 'manually_completed' or toStatus='Completed'
    const completedActivity = request.activities.find(
      (a) => a.action === 'manually_completed' || a.toStatus === 'Completed'
    )
    const completedAt = completedActivity?.createdAt || undefined

    // Helper to determine stage name
    function getStageName(a: any, index: number, request: any): string {
      // First approval is always the submitter/initial stage
      if (index === 0) {
        return 'Initial Request'
      }

      // Check if it's an engineering solution approval
      if (request.solutions.length > 0 && a.isCustomChain) {
        return 'Engineering Review'
      }

      // Check if it's the final approval
      if (a.isFinalApproval) {
        return 'Final Approval'
      }

      // Regular department approvals
      const deptName = a.requiredApprover?.department?.name || request.department.name
      if (a.requiredLevel === 1) {
        return `${deptName} Review`
      }

      return `${deptName} Approval (Level ${a.requiredLevel})`
    }

    // i. Build pdfData object matching RequestPDFData interface
    const pdfData: RequestPDFData = {
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
      fileAttachments: request.fileAttachments.map((fa) => ({
        fileName: fa.fileName,
        fileSize: fa.fileSize,
        fileType: fa.fileType,
        createdAt: fa.createdAt,
        uploadedBy: fa.uploadedBy.name,
      })),
      approvalPhases: (() => {
        const phases: Array<{
          phaseName: string
          phaseOrder: number
          approvals: Array<{
            approverName: string
            approverRole?: string
            approverDepartment?: string
            requiredLevel: number
            status: 'approved' | 'rejected' | 'pending'
            comments?: string
            approvedAt?: Date
            order: number
            stage: string
            isSolutionApproval: boolean
          }>
        }> = []

        // Phase 1: Initial Request Approvals (non-solution, non-final)
        const initialApprovals = request.approvals
          .filter(a => !a.isFinalApproval && !a.isCustomChain)
          .map((a, index) => ({
            approverName: a.approver?.name || a.requiredApprover?.name || request.requester.name || 'Unknown',
            approverRole: a.requiredApprover?.department?.name,
            approverDepartment: a.approver?.department?.name || a.requiredApprover?.department?.name,
            requiredLevel: a.requiredLevel,
            status: a.status as 'approved' | 'rejected' | 'pending',
            comments: a.comments || undefined,
            approvedAt: a.approvedAt || undefined,
            order: a.order,
            stage: index === 0 ? 'Initial Request' : `Department Review ${index}`,
            isSolutionApproval: false,
          }))

        if (initialApprovals.length > 0) {
          phases.push({
            phaseName: 'Phase 1: Initial Review',
            phaseOrder: 1,
            approvals: initialApprovals,
          })
        }

        // Phase 2: Engineering Solution Approvals
        if (request.solutions.length > 0 && request.solutions[0].approvals.length > 0) {
          const solution = request.solutions[0]
          const solutionApprovals = solution.approvals.map((a, index) => ({
            approverName: a.approver?.name || a.requiredApprover?.name || 'Engineering',
            approverRole: a.requiredApprover?.department?.name || 'Engineering',
            approverDepartment: a.approver?.department?.name || a.requiredApprover?.department?.name || 'Engineering',
            requiredLevel: a.requiredLevel || 1,
            status: a.status as 'approved' | 'rejected' | 'pending',
            comments: a.comments || undefined,
            approvedAt: a.approvedAt || undefined,
            order: a.order,
            stage: index === 0 ? 'Solution Review' : `Solution Approval ${index}`,
            isSolutionApproval: true,
          }))

          phases.push({
            phaseName: 'Phase 2: Engineering Solution',
            phaseOrder: 2,
            approvals: solutionApprovals,
          })
        }

        // Phase 3: Final Approvals
        const finalApprovals = request.approvals
          .filter(a => a.isFinalApproval)
          .map((a, index) => ({
            approverName: a.approver?.name || a.requiredApprover?.name || 'Pending',
            approverRole: a.requiredApprover?.department?.name,
            approverDepartment: a.approver?.department?.name || a.requiredApprover?.department?.name,
            requiredLevel: a.requiredLevel,
            status: a.status as 'approved' | 'rejected' | 'pending',
            comments: a.comments || undefined,
            approvedAt: a.approvedAt || undefined,
            order: a.order,
            stage: `Final Approval ${index + 1}`,
            isSolutionApproval: false,
          }))

        if (finalApprovals.length > 0) {
          phases.push({
            phaseName: 'Phase 3: Final Approval',
            phaseOrder: 3,
            approvals: finalApprovals,
          })
        }

        return phases
      })(),
      activities: request.activities.map((a) => ({
        action: a.action,
        userName: a.user.name,
        createdAt: a.createdAt,
        comments: a.comments || undefined,
      })),
      generatedBy,
    }

    // Add solution if exists
    if (request.solutions.length > 0) {
      const solution = request.solutions[0]
      pdfData.solution = {
        title: solution.title,
        description: solution.description,
        costEstimate: solution.costEstimate
          ? Number(solution.costEstimate)
          : 0,
        currency: solution.currency,
        timeline: solution.timeline || undefined,
        conceptDesign: solution.conceptDesign || undefined,
        submittedBy: solution.submittedBy.name,
        submittedAt: solution.createdAt,
        fileAttachments: solution.fileAttachments.map((fa) => ({
          fileName: fa.fileName,
          fileSize: fa.fileSize,
          fileType: fa.fileType,
          createdAt: fa.createdAt,
        })),
      }
    }

    // j. Call generateRequestPDF(pdfData) to get buffer
    const pdfBuffer = await generateRequestPDF(pdfData)

    // k. Generate filename: Request_TOPIC_YYYY-MM-DD.pdf
    const sanitizedTopic = sanitizeForFilename(request.title)
    const dateStr = formatDateAsYYYYMMDD(request.createdAt)
    const filename = `Request_${sanitizedTopic}_${dateStr}.pdf`

    // l. Return PDF data as base64
    const base64Data = pdfBuffer.toString('base64')

    return {
      success: true,
      data: base64Data,
      filename,
      contentType: 'application/pdf',
    }
  } catch (error) {
    console.error('Error exporting request as PDF:', error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred while generating the PDF. Please try again.',
    }
  }
}
