import {
  canInitiateFinalApprovalByOrigin,
  canUserAssignEngineers,
} from '@/lib/permission-checks'
import {
  evaluateRequesterCancellation,
  type RequesterCancellationCheck,
} from '@/lib/cancellation-policy'
import {
  canManageEngineeringSubTasks,
  isSubTaskVisibleForRequestStatus,
} from '@/lib/engineering-sub-tasks'

export type RequestAction =
  | 'RESUBMIT_REQUEST'
  | 'SUBMIT_SOLUTION'
  | 'RESUBMIT_SOLUTION'
  | 'RESUBMIT_FINAL_APPROVAL'
  | 'UPLOAD_ATTACHMENT'
  | 'DELETE_ATTACHMENT'
  | 'INITIATE_FINAL_APPROVAL'
  | 'APPROVE_REQUEST'
  | 'REJECT_REQUEST'
  | 'APPROVE_SOLUTION'
  | 'REJECT_SOLUTION'
  | 'APPROVE_FINAL'
  | 'REJECT_FINAL'
  | 'EDIT_REQUEST'
  | 'CANCEL_REQUEST'
  | 'ASSIGN_ENGINEERS'
  | 'MANAGE_SUB_TASKS'
  | 'EXPORT_PDF'

export const REQUEST_ACTIONS: readonly RequestAction[] = [
  'RESUBMIT_REQUEST',
  'SUBMIT_SOLUTION',
  'RESUBMIT_SOLUTION',
  'RESUBMIT_FINAL_APPROVAL',
  'UPLOAD_ATTACHMENT',
  'DELETE_ATTACHMENT',
  'INITIATE_FINAL_APPROVAL',
  'APPROVE_REQUEST',
  'REJECT_REQUEST',
  'APPROVE_SOLUTION',
  'REJECT_SOLUTION',
  'APPROVE_FINAL',
  'REJECT_FINAL',
  'EDIT_REQUEST',
  'CANCEL_REQUEST',
  'ASSIGN_ENGINEERS',
  'MANAGE_SUB_TASKS',
  'EXPORT_PDF',
] as const

export interface ActionDecision {
  allowed: boolean
  reason: 'ALLOWED' | 'NOT_VISIBLE' | 'INACTIVE' | 'NOT_OWNER' | 'WRONG_ROLE' | 'WRONG_STATUS' | 'NOT_ASSIGNED' | 'NOT_PENDING_APPROVAL'
}

export interface ActionPermissionContext {
  actor: { id: string; role: string; isActive: boolean; departmentId: string | null; departmentType: string | null }
  request: { requesterId: string; departmentId: string | null; organizationUnitId: string | null; status: string }
  canView: boolean
  approval: { canApprove: boolean } | null
  assignedEngineer: boolean
  existingActionDecisions: Readonly<Partial<Record<RequestAction, ActionDecision>>>
}

const CURRENT_STEP_ACTIONS: ReadonlySet<RequestAction> = new Set([
  'APPROVE_REQUEST',
  'REJECT_REQUEST',
  'APPROVE_SOLUTION',
  'REJECT_SOLUTION',
  'APPROVE_FINAL',
  'REJECT_FINAL',
])

const MISSING_EVIDENCE_DECISION: ActionDecision = { allowed: false, reason: 'WRONG_ROLE' }

export function evaluateRequestAction(action: RequestAction, context: ActionPermissionContext): ActionDecision {
  if (!context.actor.isActive) {
    return { allowed: false, reason: 'INACTIVE' }
  }
  if (!context.canView) {
    return { allowed: false, reason: 'NOT_VISIBLE' }
  }

  const existing = context.existingActionDecisions[action]
  if (!existing) {
    return MISSING_EVIDENCE_DECISION
  }

  if (CURRENT_STEP_ACTIONS.has(action) && existing.allowed && !context.approval?.canApprove) {
    return { allowed: false, reason: 'NOT_PENDING_APPROVAL' }
  }

  return existing
}

export function shouldShowActionButton(_action: RequestAction, decision: ActionDecision): boolean {
  return decision.allowed
}

export function existingAssignEngineersDecision(input: {
  userRole: string | null | undefined
  status: string
}): ActionDecision {
  if (!canUserAssignEngineers(input.userRole)) {
    return { allowed: false, reason: 'WRONG_ROLE' }
  }
  if (input.status !== 'SentToEngineer') {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingResubmitRequestDecision(input: {
  actorId: string
  requesterId: string
  status: string
  hasRejection: boolean
}): ActionDecision {
  if (input.actorId !== input.requesterId) {
    return { allowed: false, reason: 'NOT_OWNER' }
  }
  if (input.status !== 'ImprovementRequest') {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  if (!input.hasRejection) {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingSubmitSolutionDecision(input: {
  userRole: string | null | undefined
  status: string
}): ActionDecision {
  if (input.userRole !== 'engineering') {
    return { allowed: false, reason: 'WRONG_ROLE' }
  }
  if (input.status !== 'SentToEngineer') {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingResubmitSolutionDecision(input: {
  userRole: string | null | undefined
  hasSolutionRejection: boolean
  hasFinalApprovalRejection: boolean
}): ActionDecision {
  if (input.userRole !== 'engineering') {
    return { allowed: false, reason: 'WRONG_ROLE' }
  }
  if (!input.hasSolutionRejection && !input.hasFinalApprovalRejection) {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingInitiateFinalApprovalDecision(input: {
  status: string
  isTypedUnitRequest: boolean
  hasDirectOriginUnitMembership: boolean
  userDepartmentId: string | null | undefined
  requestDepartmentId: string | null | undefined
}): ActionDecision {
  if (input.status !== 'SendBackToRequester') {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  if (!canInitiateFinalApprovalByOrigin(input)) {
    return { allowed: false, reason: 'WRONG_ROLE' }
  }
  if (!input.isTypedUnitRequest && input.requestDepartmentId == null) {
    // Legacy fail-closed boundary only: an untyped legacy row without a
    // department has no final-approval audience. Typed NEW requests are
    // gated by direct originating-unit membership instead and must not be
    // denied for a null legacy department.
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingResubmitFinalApprovalDecision(input: {
  status: string
  isTypedUnitRequest: boolean
  hasDirectOriginUnitMembership: boolean
  userDepartmentId: string | null | undefined
  requestDepartmentId: string | null | undefined
  hasFinalApprovalRejection: boolean
}): ActionDecision {
  if (!input.hasFinalApprovalRejection) {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  return existingInitiateFinalApprovalDecision(input)
}

export function existingCancelRequestDecision(input: RequesterCancellationCheck): ActionDecision {
  const decision = evaluateRequesterCancellation(input)
  if (decision.canCancel) {
    return { allowed: true, reason: 'ALLOWED' }
  }
  if (decision.reason === 'not-requester') {
    return { allowed: false, reason: 'NOT_OWNER' }
  }
  return { allowed: false, reason: 'WRONG_STATUS' }
}

export function existingUploadAttachmentDecision(input: {
  isRequester: boolean
  isEngineeringUser: boolean
  status: string
}): ActionDecision {
  const canEngineerUpload = input.isEngineeringUser && input.status === 'SentToEngineer'
  if (!input.isRequester && !canEngineerUpload) {
    return { allowed: false, reason: input.isEngineeringUser ? 'WRONG_STATUS' : 'WRONG_ROLE' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingDeleteAttachmentDecision(input: {
  isUploader: boolean
  isRequester: boolean
  isEngineeringUser: boolean
  status: string
}): ActionDecision {
  const isEngineeringPhase = ['SentToEngineer', 'DesignCostEstimationApproval', 'SendBackToRequester', 'FinalApproval'].includes(input.status)
  if (!input.isUploader && !input.isRequester && !(input.isEngineeringUser && isEngineeringPhase)) {
    return { allowed: false, reason: 'WRONG_ROLE' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingManageSubTasksDecision(input: {
  userRole: string | null | undefined
  isActive?: boolean | null
  status: string
}): ActionDecision {
  if (!canManageEngineeringSubTasks({ role: input.userRole, isActive: input.isActive })) {
    return { allowed: false, reason: 'WRONG_ROLE' }
  }
  if (!isSubTaskVisibleForRequestStatus(input.status)) {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingExportPdfDecision(input: { status: string }): ActionDecision {
  if (input.status !== 'Completed') {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingApprovalDecision(canApprove: boolean): ActionDecision {
  if (!canApprove) {
    return { allowed: false, reason: 'NOT_PENDING_APPROVAL' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

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
  'use server'

  const { auth } = await import('@/lib/auth-config')
  const prisma = (await import('@/lib/prisma')).default
  const { canUserViewRequest } = await import('@/lib/request-access')
  const { CURRENT_INSTANCE_ROW_FILTER } = await import('@/lib/approval-engine/current-instance')
  const {
    canUserApproveRequest,
    canUserApproveSolution,
    canUserApproveFinal,
    createPrismaApprovalTransactionDb,
  } = await import('@/lib/approval-engine/transactions')

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
