import {
  canInitiateFinalApproval,
  canSubmitSolutionWork,
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
import type { OrganizationUnitNode } from '@/lib/organization/model'

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
  actor: { id: string; role: string; isActive: boolean; assignmentUnitId: string | null }
  request: { requesterId: string; organizationUnitId: string | null; status: string }
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

const ENGINEERING_PHASE_STATUSES = [
  'SentToEngineer',
  'DesignCostEstimationApproval',
  'SendBackToRequester',
  'FinalApproval',
] as const

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
  isActive: boolean
  assignmentUnitId: string | null
  units: readonly OrganizationUnitNode[]
  status: string
}): ActionDecision {
  if (!canSubmitSolutionWork(input)) {
    return { allowed: false, reason: 'WRONG_ROLE' }
  }
  if (input.status !== 'SentToEngineer') {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingResubmitSolutionDecision(input: {
  isActive: boolean
  assignmentUnitId: string | null
  units: readonly OrganizationUnitNode[]
  hasSolutionRejection: boolean
  hasFinalApprovalRejection: boolean
}): ActionDecision {
  if (!canSubmitSolutionWork(input)) {
    return { allowed: false, reason: 'WRONG_ROLE' }
  }
  if (!input.hasSolutionRejection && !input.hasFinalApprovalRejection) {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingInitiateFinalApprovalDecision(input: {
  isActive: boolean
  assignmentUnitId: string | null
  requestOriginUnitId: string
  units: readonly OrganizationUnitNode[]
  status: string
}): ActionDecision {
  if (input.status !== 'SendBackToRequester') {
    return { allowed: false, reason: 'WRONG_STATUS' }
  }
  if (!canInitiateFinalApproval(input)) {
    return { allowed: false, reason: 'WRONG_ROLE' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingResubmitFinalApprovalDecision(input: {
  isActive: boolean
  assignmentUnitId: string | null
  requestOriginUnitId: string
  units: readonly OrganizationUnitNode[]
  status: string
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
  isActive: boolean
  assignmentUnitId: string | null
  units: readonly OrganizationUnitNode[]
  status: string
}): ActionDecision {
  const canSolutionWork = canSubmitSolutionWork(input)
  const canEngineerUpload = canSolutionWork && input.status === 'SentToEngineer'
  if (!input.isRequester && !canEngineerUpload) {
    return { allowed: false, reason: canSolutionWork ? 'WRONG_STATUS' : 'WRONG_ROLE' }
  }
  return { allowed: true, reason: 'ALLOWED' }
}

export function existingDeleteAttachmentDecision(input: {
  isUploader: boolean
  isRequester: boolean
  isActive: boolean
  assignmentUnitId: string | null
  units: readonly OrganizationUnitNode[]
  status: string
}): ActionDecision {
  const isEngineeringPhase = (ENGINEERING_PHASE_STATUSES as readonly string[]).includes(input.status)
  if (!input.isUploader && !input.isRequester && !(canSubmitSolutionWork(input) && isEngineeringPhase)) {
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
