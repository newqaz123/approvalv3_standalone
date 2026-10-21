'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { canUserViewRequest } from '@/lib/request-visibility/scope'
import { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'
import {
  canUserApproveFinal,
  canUserApproveRequest,
  canUserApproveSolution,
  createPrismaApprovalTransactionDb,
} from '@/lib/approval-engine/transaction-adapter'
import type { OrganizationUnitNode } from '@/lib/organization/model'
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

  const assignment = await prisma.organization_assignments.findFirst({
    where: { userId, isActive: true },
    select: { unitId: true },
  })
  const assignmentUnitId = assignment?.unitId ?? null
  const units = await loadOrganizationUnitNodes()
  const requestOriginUnitId = request.organizationUnitId ?? ''

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
  const originInput = {
    isActive: user.isActive,
    assignmentUnitId,
    requestOriginUnitId,
    units,
    status: request.status,
  }

  const existingActionDecisions: Partial<Record<RequestAction, ActionDecision>> = {
    RESUBMIT_REQUEST: existingResubmitRequestDecision({
      actorId: user.id,
      requesterId: request.requesterId,
      status: request.status,
      hasRejection: hasRequestRejection,
    }),
    SUBMIT_SOLUTION: existingSubmitSolutionDecision({
      isActive: user.isActive,
      assignmentUnitId,
      units,
      status: request.status,
    }),
    RESUBMIT_SOLUTION: existingResubmitSolutionDecision({
      isActive: user.isActive,
      assignmentUnitId,
      units,
      hasSolutionRejection,
      hasFinalApprovalRejection,
    }),
    RESUBMIT_FINAL_APPROVAL: existingResubmitFinalApprovalDecision({
      ...originInput,
      hasFinalApprovalRejection,
    }),
    UPLOAD_ATTACHMENT: existingUploadAttachmentDecision({
      isRequester,
      isActive: user.isActive,
      assignmentUnitId,
      units,
      status: request.status,
    }),
    DELETE_ATTACHMENT: existingDeleteAttachmentDecision({
      isUploader: false,
      isRequester,
      isActive: user.isActive,
      assignmentUnitId,
      units,
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
      assignmentUnitId,
    },
    request: {
      requesterId: request.requesterId,
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
