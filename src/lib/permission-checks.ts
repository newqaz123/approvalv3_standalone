/**
 * Assignment-based action policy helpers (Plan B Task 10).
 * Solution work is A5 canWorkOnSolutions (unit flag inherited by descendants).
 * Final initiation is an active assignment in the request origin unit
 * only (ancestor units are not eligible).
 * Request submission is every active assignment. Admin is separate.
 * Approval is chain-only — there is no level helper.
 * The engineering ROLE remains only for engineer-assignment / sub-task
 * administration, never for solution-work eligibility or visibility.
 */
import type { OrganizationUnitNode } from '@/lib/organization/model'
import { canWorkOnSolutions } from '@/lib/solution-eligibility'

export function canSubmitSolutionWork(input: {
  isActive: boolean
  assignmentUnitId: string | null
  units: readonly OrganizationUnitNode[]
}): boolean {
  if (!input.isActive) return false
  return canWorkOnSolutions(input.units, input.assignmentUnitId)
}

export function canInitiateFinalApproval(input: {
  isActive: boolean
  assignmentUnitId: string | null
  requestOriginUnitId: string
  units: readonly OrganizationUnitNode[]
}): boolean {
  if (!input.isActive) return false
  if (input.assignmentUnitId === null) return false
  if (input.requestOriginUnitId === '') return false
  // Owner decision (H6): only an active assignment in the request ORIGIN
  // unit may initiate Final approval; ancestor units are not eligible.
  return input.assignmentUnitId === input.requestOriginUnitId
}

/**
 * Existing assignEngineers role guard. Assignment stays role-based
 * (`user.role === 'engineering'`), not PIC-only.
 */
export function canUserAssignEngineers(
  userRole: string | null | undefined
): boolean {
  return userRole === 'engineering'
}

/**
 * Determine which modal type to show based on request status and user context
 */
export function getModalTypeForStatus(
  status: string,
  hasRejection: boolean,
  hasSolution: boolean,
  hasFinalApproval: boolean,
  canApprove: boolean,
  isRequesterDepartment: boolean,
  isEngineering: boolean
): {
  modalType: 'approver' | 'solution' | 'completed-request' | 'completed-solution' | 'completed-final' | 'resubmit-request' | 'resubmit-solution' | 'resubmit-final' | 'submit-final'
  mode?: 'request' | 'solution' | 'final' | 'resubmit'
  showSubmitSolutionButton?: boolean
  showSubmitFinalApprovalButton?: boolean
} {
  // Handle solution rejection - show read-only view first with resubmit option
  // This gives engineers a chance to review before resubmitting
  if (hasSolution && hasRejection) {
    return { modalType: 'solution', mode: 'resubmit' }
  }

  // Handle other rejection states
  if (hasRejection) {
    if (status === 'ImprovementRequest' || status === 'RequestRejected') {
      return { modalType: 'resubmit-request' }
    }
    if (status === 'DesignCostEstimationApproval' || status === 'SolutionRejected') {
      return { modalType: 'resubmit-solution', mode: 'resubmit' }
    }
    if (status === 'FinalApproval' || status === 'FinalRejected') {
      return { modalType: 'resubmit-final' }
    }
    // Handle final approval rejection that returns to SentToEngineer
    // Show solution modal with resubmit option for engineering users
    if (status === 'SentToEngineer' && hasSolution && isEngineering) {
      return { modalType: 'solution', mode: 'resubmit' }
    }
  }

  // Handle completed/final state
  if (status === 'Completed') {
    return { modalType: 'completed-final' }
  }

  // Handle final approval in progress
  if (status === 'FinalApproval') {
    if (canApprove) {
      return { modalType: 'approver', mode: 'final' }
    }
    return { modalType: 'approver', mode: 'final' } // Read-only for non-approvers
  }

  // Handle sent back to requester (solution completed, awaiting final approval)
  if (status === 'SendBackToRequester') {
    if (isRequesterDepartment) {
      return { 
        modalType: 'completed-solution',
        showSubmitFinalApprovalButton: true
      }
    }
    return { modalType: 'completed-solution' }
  }

  // Handle solution approval stage
  if (status === 'DesignCostEstimationApproval') {
    if (hasRejection) {
      return { modalType: 'resubmit-solution', mode: 'resubmit' }
    }
    return { modalType: 'solution' }
  }

  // Handle sent to engineer (request completed, awaiting solution)
  if (status === 'SentToEngineer') {
    if (isEngineering) {
      return { 
        modalType: 'completed-request',
        showSubmitSolutionButton: true
      }
    }
    return { modalType: 'completed-request' }
  }

  // Handle initial request approval
  if (status === 'ImprovementRequest') {
    if (canApprove) {
      return { modalType: 'approver', mode: 'request' }
    }
    return { modalType: 'approver', mode: 'request' } // Read-only for non-approvers
  }

  // Default fallback
  return { modalType: 'approver', mode: 'request' }
}

/**
 * Check if user has admin privileges
 */
export function isUserAdmin(userRole: string | null | undefined): boolean {
  return userRole === 'admin'
}

/**
 * Get available actions for a user on a specific request.
 * Admin is application administration, not a workflow blanket.
 * Approval is chain-only. Solution work is the unit flag. Submit is any
 * active assignment.
 */
export function getAvailableActions(input: {
  status: string
  isActive: boolean
  assignmentUnitId: string | null
  units: readonly OrganizationUnitNode[]
  requestOriginUnitId: string
  canApprove: boolean
}): {
  canSubmitRequest: boolean
  canSubmitSolution: boolean
  canReviewRequest: boolean
  canReviewSolution: boolean
  canSubmitFinalApproval: boolean
  canReviewFinalApproval: boolean
  canExportPDF: boolean
} {
  const canSolution = canSubmitSolutionWork(input)
  const canFinal = canInitiateFinalApproval(input)

  return {
    canSubmitRequest: input.isActive && input.assignmentUnitId !== null,
    canSubmitSolution: canSolution && input.status === 'SentToEngineer',
    canReviewRequest: input.canApprove && input.status === 'ImprovementRequest',
    canReviewSolution: input.canApprove && input.status === 'DesignCostEstimationApproval',
    canSubmitFinalApproval: canFinal && input.status === 'SendBackToRequester',
    canReviewFinalApproval: input.canApprove && input.status === 'FinalApproval',
    canExportPDF: input.status === 'Completed',
  }
}
