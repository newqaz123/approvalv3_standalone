'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { canUserViewRequest } from '@/lib/request-access'
import { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'
import {
  canUserApproveFinal,
  canUserApproveRequest,
  canUserApproveSolution,
  createPrismaApprovalTransactionDb,
} from '@/lib/approval-engine/transactions'
import {
  REQUEST_ACTIONS,
  evaluateRequestAction,
  existingApprovalDecision,
  existingAssignEngineersDecision,
  existingCancelRequestDecision,
  existingDeleteAttachmentDecision,
  existingExportPdfDecision,
  existingInitiateFinalApprovalDecision,
  existingManageSubTasksDecision,
  existingResubmitFinalApprovalDecision,
  existingResubmitRequestDecision,
  existingResubmitSolutionDecision,
  existingSubmitSolutionDecision,
  existingUploadAttachmentDecision,
  type ActionDecision,
  type ActionPermissionContext,
  type RequestAction,
} from '@/lib/action-permissions'

function allDecisions(decision: ActionDecision): Record<RequestAction, ActionDecision> {
  const result = {} as Record<RequestAction, ActionDecision>
  for (const action of REQUEST_ACTIONS) {
    result[action] = decision
  }
  return result
}

/**
 * Session-derived capability map. Identity comes from `auth()`, never from a
 * client-supplied userId. The server builds existingActionDecisions from
 * persisted role, ownership, assignment, phase, and status.
 */
export async function getRequestActionCapabilities(requestId: string): Promise<Record<RequestAction, ActionDecision>> {
  const { user: authUser } = (await auth()) ?? {}
  const userId = authUser?.id
  if (!userId) {
    return allDecisions({ allowed: false, reason: 'INACTIVE' })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isActive: true,
      departmentId: true,
      department: { select: { type: true } },
    },
  })
  if (!user || !user.isActive) {
    return allDecisions({ allowed: false, reason: 'INACTIVE' })
  }

  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      requesterId: true,
      departmentId: true,
      organizationUnitId: true,
      status: true,
      isDeleted: true,
      approvals: {
        // Capability aggregates read current-attempt rows only: superseded
        // rejection/pending history is preserved for display, never for
        // authorization.
        where: { OR: [...CURRENT_INSTANCE_ROW_FILTER] },
        select: { status: true, isFinalApproval: true },
      },
      solutions: {
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: {
          id: true,
          approvals: {
            where: { OR: [...CURRENT_INSTANCE_ROW_FILTER] },
            select: { status: true },
          },
        },
      },
      engineerAssignments: {
        where: { engineerId: userId },
        select: { engineerId: true },
        take: 1,
      },
    },
  })

  const canView = await canUserViewRequest(userId, requestId)
  if (!request || request.isDeleted) {
    return allDecisions({ allowed: false, reason: 'NOT_VISIBLE' })
  }

  const hasRequestRejection = request.approvals.some(
    (approval) => approval.status === 'rejected' && !approval.isFinalApproval,
  )
  const hasFinalApprovalRejection = request.approvals.some(
    (approval) => approval.status === 'rejected' && approval.isFinalApproval,
  )
  const hasSolutionRejection = request.solutions[0]?.approvals.some((approval) => approval.status === 'rejected') === true
  const hasPendingRequestApprovals = request.approvals.some((approval) => approval.status === 'pending')
  const pendingSolutionApprovals = await prisma.solution_approvals.count({
    where: { solution: { requestId }, status: 'pending', OR: [...CURRENT_INSTANCE_ROW_FILTER] },
  })

  let hasDirectOriginUnitMembership = false
  if (request.organizationUnitId) {
    const membership = await prisma.organization_position_assignments.findFirst({
      where: { userId, unitId: request.organizationUnitId, isActive: true },
      select: { id: true },
    })
    hasDirectOriginUnitMembership = Boolean(membership)
  }

  const approvalTx = createPrismaApprovalTransactionDb(prisma as Parameters<typeof createPrismaApprovalTransactionDb>[0])
  let canApprove = false
  if (request.status === 'DesignCostEstimationApproval' && request.solutions[0]) {
    const approval = await prisma.solution_approvals.findFirst({
      where: {
        solutionId: request.solutions[0].id,
        status: 'pending',
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
      orderBy: { order: 'asc' },
      select: { id: true },
    })
    if (approval) {
      canApprove = (await canUserApproveSolution(approvalTx, { approvalId: approval.id, actorId: userId })).canApprove
    }
  } else if (request.status === 'FinalApproval') {
    const approval = await prisma.request_approvals.findFirst({
      where: {
        requestId,
        status: 'pending',
        isFinalApproval: true,
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
      orderBy: { order: 'asc' },
      select: { id: true },
    })
    if (approval) {
      canApprove = (await canUserApproveFinal(approvalTx, { approvalId: approval.id, actorId: userId })).canApprove
    }
  } else {
    const approval = await prisma.request_approvals.findFirst({
      where: {
        requestId,
        status: 'pending',
        isFinalApproval: false,
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
      orderBy: { order: 'asc' },
      select: { id: true },
    })
    if (approval) {
      canApprove = (await canUserApproveRequest(approvalTx, { approvalId: approval.id, actorId: userId })).canApprove
    }
  }

  const isRequester = user.id === request.requesterId
  const isEngineeringUser = user.role === 'engineering'
  const originInput = {
    status: request.status,
    isTypedUnitRequest: request.organizationUnitId !== null,
    hasDirectOriginUnitMembership,
    userDepartmentId: user.departmentId,
    requestDepartmentId: request.departmentId,
  }

  const existingActionDecisions: Partial<Record<RequestAction, ActionDecision>> = {
    RESUBMIT_REQUEST: existingResubmitRequestDecision({
      actorId: user.id,
      requesterId: request.requesterId,
      status: request.status,
      hasRejection: hasRequestRejection,
    }),
    SUBMIT_SOLUTION: existingSubmitSolutionDecision({
      userRole: user.role,
      status: request.status,
    }),
    RESUBMIT_SOLUTION: existingResubmitSolutionDecision({
      userRole: user.role,
      hasSolutionRejection,
      hasFinalApprovalRejection,
    }),
    RESUBMIT_FINAL_APPROVAL: existingResubmitFinalApprovalDecision({
      ...originInput,
      hasFinalApprovalRejection,
    }),
    UPLOAD_ATTACHMENT: existingUploadAttachmentDecision({
      isRequester,
      isEngineeringUser,
      status: request.status,
    }),
    DELETE_ATTACHMENT: existingDeleteAttachmentDecision({
      isUploader: false,
      isRequester,
      isEngineeringUser,
      status: request.status,
    }),
    INITIATE_FINAL_APPROVAL: existingInitiateFinalApprovalDecision(originInput),
    APPROVE_REQUEST: existingApprovalDecision(request.status === 'ImprovementRequest' && canApprove),
    REJECT_REQUEST: existingApprovalDecision(request.status === 'ImprovementRequest' && canApprove),
    APPROVE_SOLUTION: existingApprovalDecision(request.status === 'DesignCostEstimationApproval' && canApprove),
    REJECT_SOLUTION: existingApprovalDecision(request.status === 'DesignCostEstimationApproval' && canApprove),
    APPROVE_FINAL: existingApprovalDecision(request.status === 'FinalApproval' && canApprove),
    REJECT_FINAL: existingApprovalDecision(request.status === 'FinalApproval' && canApprove),
    EDIT_REQUEST: { allowed: false, reason: 'WRONG_STATUS' },
    CANCEL_REQUEST: existingCancelRequestDecision({
      userId: user.id,
      requesterId: request.requesterId,
      status: request.status,
      hasRejectedRequestApproval: hasRequestRejection,
      hasPendingRequestApprovals,
      hasPendingSolutionApprovals: pendingSolutionApprovals > 0,
    }),
    ASSIGN_ENGINEERS: existingAssignEngineersDecision({
      userRole: user.role,
      status: request.status,
    }),
    MANAGE_SUB_TASKS: existingManageSubTasksDecision({
      userRole: user.role,
      isActive: user.isActive,
      status: request.status,
    }),
    EXPORT_PDF: existingExportPdfDecision({ status: request.status }),
  }

  const context: ActionPermissionContext = {
    actor: {
      id: user.id,
      role: user.role,
      isActive: user.isActive,
      departmentId: user.departmentId,
      departmentType: user.department?.type ?? null,
    },
    request: {
      requesterId: request.requesterId,
      departmentId: request.departmentId,
      organizationUnitId: request.organizationUnitId,
      status: request.status,
    },
    canView,
    approval: { canApprove },
    assignedEngineer: request.engineerAssignments.length > 0,
    existingActionDecisions,
  }

  const result = {} as Record<RequestAction, ActionDecision>
  for (const action of REQUEST_ACTIONS) {
    result[action] = evaluateRequestAction(action, context)
  }
  return result
}
