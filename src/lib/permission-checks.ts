/**
 * Permission check utilities for conditional modal/button visibility
 * Based on user roles, departments, and request status
 */

/**
 * Check if user can submit a solution (Engineering department only)
 */
export function canUserSubmitSolution(
  userDepartmentType: string | null | undefined,
  userRole: string | null | undefined
): boolean {
  return userDepartmentType === 'ENGINEERING' || userRole === 'engineering'
}

/**
 * Check if user can submit final approval (requester's department only)
 */
export function canUserSubmitFinalApproval(
  userId: string,
  requesterId: string,
  userDepartmentId: string | null | undefined,
  requesterDepartmentId: string | null | undefined
): boolean {
  // User must be from the same department as the original requester
  return userDepartmentId === requesterDepartmentId && userDepartmentId != null
}

/**
 * Check if user can approve at a specific level
 */
export function canUserApproveAtLevel(
  userLevel: number | null | undefined,
  requiredLevel: number
): boolean {
  if (!userLevel) return false
  return userLevel >= requiredLevel
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
  modalType: 'submitter' | 'approver' | 'completed-request' | 'completed-solution' | 'completed-final' | 'resubmit-request' | 'resubmit-solution' | 'resubmit-final' | 'submit-final'
  mode?: 'request' | 'solution' | 'final' | 'resubmit'
  showSubmitSolutionButton?: boolean
  showSubmitFinalApprovalButton?: boolean
} {
  // Handle rejection states first
  if (hasRejection) {
    if (status === 'ImprovementRequest' || status === 'RequestRejected') {
      return { modalType: 'resubmit-request' }
    }
    if (status === 'DesignCostEstimationApproval' || status === 'SolutionRejected') {
      return { modalType: 'resubmit-solution', mode: 'resubmit' }
    }
    if (status === 'FinalApprovalInProgress' || status === 'FinalRejected') {
      return { modalType: 'resubmit-final' }
    }
  }

  // Handle completed/final state
  if (status === 'Completed') {
    return { modalType: 'completed-final' }
  }

  // Handle final approval in progress
  if (status === 'FinalApprovalInProgress') {
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
    if (canApprove) {
      return { modalType: 'approver', mode: 'solution' }
    }
    return { modalType: 'approver', mode: 'solution' } // Read-only for non-approvers
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
 * Get available actions for a user on a specific request
 */
export function getAvailableActions(
  status: string,
  userRole: string | null | undefined,
  userDepartmentType: string | null | undefined,
  userDepartmentId: string | null | undefined,
  requesterDepartmentId: string | null | undefined,
  userLevel: number | null | undefined,
  canApprove: boolean
): {
  canSubmitRequest: boolean
  canSubmitSolution: boolean
  canReviewRequest: boolean
  canReviewSolution: boolean
  canSubmitFinalApproval: boolean
  canReviewFinalApproval: boolean
  canExportPDF: boolean
} {
  const isAdmin = isUserAdmin(userRole)
  const isEngineering = canUserSubmitSolution(userDepartmentType, userRole)
  const isRequesterDept = userDepartmentId === requesterDepartmentId

  return {
    canSubmitRequest: isAdmin || (userDepartmentType !== 'ENGINEERING'),
    canSubmitSolution: isAdmin || (isEngineering && status === 'SentToEngineer'),
    canReviewRequest: isAdmin || (canApprove && status === 'ImprovementRequest'),
    canReviewSolution: isAdmin || (canApprove && status === 'DesignCostEstimationApproval'),
    canSubmitFinalApproval: isAdmin || (isRequesterDept && status === 'SendBackToRequester'),
    canReviewFinalApproval: isAdmin || (canApprove && status === 'FinalApprovalInProgress'),
    canExportPDF: status === 'Completed',
  }
}

/**
 * Determine if a button should be visible based on user permissions
 */
export function shouldShowActionButton(
  action: 'submit-solution' | 'submit-final-approval' | 'approve' | 'reject' | 'export-pdf',
  userRole: string | null | undefined,
  userDepartmentType: string | null | undefined,
  userDepartmentId: string | null | undefined,
  requesterDepartmentId: string | null | undefined,
  status: string,
  canApprove: boolean
): boolean {
  const isAdmin = isUserAdmin(userRole)
  const isEngineering = canUserSubmitSolution(userDepartmentType, userRole)
  const isRequesterDept = userDepartmentId === requesterDepartmentId

  switch (action) {
    case 'submit-solution':
      return isAdmin || (isEngineering && status === 'SentToEngineer')
    
    case 'submit-final-approval':
      return isAdmin || (isRequesterDept && status === 'SendBackToRequester')
    
    case 'approve':
    case 'reject':
      return isAdmin || canApprove
    
    case 'export-pdf':
      return status === 'Completed'
    
    default:
      return false
  }
}
