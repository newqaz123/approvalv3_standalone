/**
 * Data adapters to transform Prisma database models to new modal component props
 * These adapters bridge the gap between existing DB schema and the new UI mockup components
 */

import { format } from 'date-fns'

// Types for the new modal components
export interface ModalSubmitter {
  name: string
  role: string
  email: string
  initials: string
}

export interface ModalApprovalStep {
  id: string
  name: string
  role: string
  status: 'submitted' | 'approved' | 'pending' | 'rejected'
  comment: string
  timestamp: string
  avatar?: string
}

export interface ModalApprovalStage {
  stageNumber: string | number
  stageName: string
  submittedBy?: string
  submittedAt?: string
  steps: ModalApprovalStep[]
}

export interface ModalFileAttachment {
  id: string
  fileName: string
  fileType: string
  description?: string
}

export interface ModalActivityItem {
  id: string
  action: string
  user: string
  timestamp: string
  details?: string
}

export interface ModalSolution {
  title: string
  description: string
  cost: number
  currency: string
  timeline?: string
  submittedBy: string
  submittedAt: string
  files: ModalFileAttachment[]
}

/**
 * Transform Prisma user to modal submitter format
 */
export function transformUserToSubmitter(user: {
  id: string
  name: string | null
  email: string
  role?: string | null
}): ModalSubmitter {
  const name = user.name || user.email
  const initials = name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return {
    name,
    role: user.role || 'User',
    email: user.email,
    initials,
  }
}

/**
 * Transform Prisma file attachments to modal format
 */
export function transformFileAttachments(files: Array<{
  id: string
  fileName: string
  fileType: string
  description?: string | null
}>): ModalFileAttachment[] {
  return files.map(file => ({
    id: file.id,
    fileName: file.fileName,
    fileType: file.fileType,
    description: file.description || undefined,
  }))
}

/**
 * Transform Prisma approvals to modal stages format
 * Groups approvals by level/order into stages
 */
export function transformApprovalsToStages(
  approvals: Array<{
    id: string
    requiredLevel: number
    order: number
    status: string
    comments?: string | null
    approvedAt?: Date | null
    createdAt: Date
    isCustomChain: boolean
    approver?: {
      name: string | null
      email: string
    } | null
    requiredApprover?: {
      name: string | null
    } | null
  }>,
  isFinalApproval: boolean = false
): ModalApprovalStage[] {
  if (approvals.length === 0) return []

  // Group approvals by level
  const groupedByLevel = approvals.reduce((acc, approval) => {
    const level = approval.requiredLevel
    if (!acc[level]) {
      acc[level] = []
    }
    acc[level].push(approval)
    return acc
  }, {} as Record<number, typeof approvals>)

  // Convert to stages
  const stages: ModalApprovalStage[] = Object.entries(groupedByLevel)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([level, levelApprovals], index) => {
      const steps: ModalApprovalStep[] = levelApprovals
        .sort((a, b) => a.order - b.order)
        .map(approval => {
          const approverName = approval.approver?.name || 
                              approval.requiredApprover?.name || 
                              'Pending Assignment'
          
          return {
            id: approval.id,
            name: approverName,
            role: approval.isCustomChain 
              ? `Custom Level ${approval.order}` 
              : `Level ${approval.requiredLevel}`,
            status: approval.status as 'submitted' | 'approved' | 'pending' | 'rejected',
            comment: approval.comments || 
                    (approval.status === 'pending' ? 'Awaiting review' : 'No comment'),
            timestamp: approval.approvedAt 
              ? approval.approvedAt.toISOString() 
              : approval.createdAt.toISOString(),
          }
        })

      return {
        stageNumber: index + 1,
        stageName: isFinalApproval 
          ? `Final Approval Level ${level}` 
          : `Approval Level ${level}`,
        steps,
      }
    })

  return stages
}

/**
 * Transform Prisma activities to modal timeline format
 */
export function transformActivitiesToTimeline(activities: Array<{
  id: string
  action: string
  comments?: string | null
  createdAt: Date
  user: {
    name: string | null
    email: string
  }
}>): ModalActivityItem[] {
  return activities.map(activity => ({
    id: activity.id,
    action: formatActionLabel(activity.action),
    user: activity.user.name || activity.user.email,
    timestamp: activity.createdAt.toISOString(),
    details: activity.comments || undefined,
  }))
}

/**
 * Transform Prisma solution to modal format
 */
export function transformSolutionToModal(solution: {
  id: string
  title: string
  description: string
  costEstimate: any // Decimal
  currency: string
  timeline?: string | null
  submittedAt: Date
  submittedBy?: {
    name: string | null
    email: string
  } | null
  fileAttachments?: Array<{
    id: string
    fileName: string
    fileType: string
    description?: string | null
  }>
}): ModalSolution {
  return {
    title: solution.title,
    description: solution.description,
    cost: Number(solution.costEstimate),
    currency: solution.currency,
    timeline: solution.timeline || undefined,
    submittedBy: solution.submittedBy?.name || solution.submittedBy?.email || 'Engineering Team',
    submittedAt: solution.submittedAt.toISOString(),
    files: transformFileAttachments(solution.fileAttachments || []),
  }
}

/**
 * Format action labels for display
 */
function formatActionLabel(action: string): string {
  const labels: Record<string, string> = {
    created: 'Request created',
    status_changed: 'Status changed',
    file_attached: 'File attached',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    solution_submitted: 'Solution submitted',
    solution_approved: 'Solution approved',
    solution_rejected: 'Solution rejected',
    manually_completed: 'Marked as complete',
    final_approval_initiated: 'Final approval initiated',
    final_approval_approved: 'Final approval granted',
    final_approval_rejected: 'Final approval rejected',
  }
  return labels[action] || action
}

/**
 * Transform full request data to modal props
 */
export function transformRequestToModalData(request: {
  id: string
  title: string
  description: string
  status: string
  createdAt: Date
  updatedAt: Date
  requester: {
    id: string
    name: string | null
    email: string
    role?: string | null
  }
  fileAttachments: Array<{
    id: string
    fileName: string
    fileType: string
    description?: string | null
  }>
  approvals: Array<{
    id: string
    requiredLevel: number
    order: number
    status: string
    comments?: string | null
    approvedAt?: Date | null
    createdAt: Date
    isCustomChain: boolean
    isFinalApproval: boolean
    approver?: {
      name: string | null
      email: string
    } | null
    requiredApprover?: {
      name: string | null
    } | null
  }>
  activities: Array<{
    id: string
    action: string
    comments?: string | null
    createdAt: Date
    user: {
      name: string | null
      email: string
    }
  }>
  solutions?: Array<{
    id: string
    title: string
    description: string
    costEstimate: any
    currency: string
    timeline?: string | null
    submittedAt: Date
    submittedBy?: {
      name: string | null
      email: string
    } | null
    fileAttachments?: Array<{
      id: string
      fileName: string
      fileType: string
      description?: string | null
    }>
    approvals: Array<{
      id: string
      requiredLevel: number
      order: number
      status: string
      comments?: string | null
      approvedAt?: Date | null
      createdAt: Date
      isCustomChain: boolean
      approver?: {
        name: string | null
        email: string
      } | null
      requiredApprover?: {
        name: string | null
      } | null
    }>
  }>
}) {
  const solution = request.solutions?.[0]
  const requestApprovals = (request.approvals || []).filter(a => !a.isFinalApproval)
  const finalApprovals = (request.approvals || []).filter(a => a.isFinalApproval)
  const solutionApprovals = solution?.approvals || []

  // Determine rejection info based on current status
  // Only show rejection if it's relevant to the current workflow stage
  let rejectionInfo = undefined
  
  if (request.status === 'ImprovementRequest' || request.status === 'RequestRejected') {
    // Show request rejection
    const rejectedRequestApproval = requestApprovals.find(a => a.status === 'rejected')
    if (rejectedRequestApproval) {
      rejectionInfo = {
        reason: rejectedRequestApproval.comments || 'No reason provided',
        rejectedBy: rejectedRequestApproval.approver?.name || 'Unknown',
        rejectedAt: rejectedRequestApproval.approvedAt?.toISOString() || rejectedRequestApproval.createdAt.toISOString(),
      }
    }
  } else if (request.status === 'SentToEngineer' || request.status === 'DesignCostEstimationApproval') {
    // Show solution rejection only if solution approvals are rejected
    const rejectedSolutionApproval = solutionApprovals.find(a => a.status === 'rejected')
    // Also check for final approval rejection that sent it back to engineering
    const rejectedFinalApproval = finalApprovals.find(a => a.status === 'rejected')
    const rejection = rejectedSolutionApproval || rejectedFinalApproval
    if (rejection) {
      rejectionInfo = {
        reason: rejection.comments || 'No reason provided',
        rejectedBy: rejection.approver?.name || 'Unknown',
        rejectedAt: rejection.approvedAt?.toISOString() || rejection.createdAt.toISOString(),
      }
    }
  } else if (request.status === 'FinalApproval' || request.status === 'FinalRejected') {
    // Show final approval rejection
    const rejectedFinalApproval = finalApprovals.find(a => a.status === 'rejected')
    if (rejectedFinalApproval) {
      rejectionInfo = {
        reason: rejectedFinalApproval.comments || 'No reason provided',
        rejectedBy: rejectedFinalApproval.approver?.name || 'Unknown',
        rejectedAt: rejectedFinalApproval.approvedAt?.toISOString() || rejectedFinalApproval.createdAt.toISOString(),
      }
    }
  }
  // For SendBackToRequester and Completed, don't show any rejection info

  // Build base data
  const baseData = {
    id: request.id,
    referenceId: `#${request.id.slice(0, 8).toUpperCase()}`,
    title: request.title,
    submitter: transformUserToSubmitter(request.requester),
    requestDescription: request.description,
    requestFiles: transformFileAttachments(request.fileAttachments),
    activities: transformActivitiesToTimeline(request.activities),
    lastModified: request.updatedAt.toISOString(),
    rejection: rejectionInfo,
  }

  // Add solution data if exists
  const solutionData = solution ? {
    solution: transformSolutionToModal(solution),
  } : {}

  // Add stages based on what's available - group by workflow stage, not by level
  let stages: ModalApprovalStage[] = []
  let stageCounter = 1
  
  // Stage 1: Request Approval (if exists)
  if (requestApprovals.length > 0) {
    const steps: ModalApprovalStep[] = requestApprovals
      .sort((a, b) => a.requiredLevel - b.requiredLevel || a.order - b.order)
      .map(approval => {
        const approverName = approval.approver?.name || 
                            approval.requiredApprover?.name || 
                            'Pending Assignment'
        
        return {
          id: approval.id,
          name: approverName,
          role: approval.isCustomChain 
            ? `Custom Level ${approval.order}` 
            : `Level ${approval.requiredLevel}`,
          status: approval.status as 'submitted' | 'approved' | 'pending' | 'rejected',
          comment: approval.comments || 
                  (approval.status === 'pending' ? 'Awaiting review' : 'No comment'),
          timestamp: approval.approvedAt 
            ? approval.approvedAt.toISOString() 
            : approval.createdAt.toISOString(),
        }
      })
    
    stages.push({
      stageNumber: stageCounter++,
      stageName: 'Improvement Request',
      submittedBy: request.requester.name || request.requester.email,
      submittedAt: request.createdAt.toISOString(),
      steps,
    })
  }
  
  // Stage 2: Solution Approval (if exists)
  if (solutionApprovals.length > 0) {
    const steps: ModalApprovalStep[] = solutionApprovals
      .sort((a, b) => a.requiredLevel - b.requiredLevel || a.order - b.order)
      .map(approval => {
        const approverName = approval.approver?.name || 
                            approval.requiredApprover?.name || 
                            'Pending Assignment'
        
        return {
          id: approval.id,
          name: approverName,
          role: approval.isCustomChain 
            ? `Custom Level ${approval.order}` 
            : `Level ${approval.requiredLevel}`,
          status: approval.status as 'submitted' | 'approved' | 'pending' | 'rejected',
          comment: approval.comments || 
                  (approval.status === 'pending' ? 'Awaiting review' : 'No comment'),
          timestamp: approval.approvedAt 
            ? approval.approvedAt.toISOString() 
            : approval.createdAt.toISOString(),
        }
      })
    
    stages.push({
      stageNumber: stageCounter++,
      stageName: 'Design & Cost Approval',
      submittedBy: solution?.submittedBy?.name || solution?.submittedBy?.email || 'Engineering Team',
      submittedAt: solution?.submittedAt.toISOString(),
      steps,
    })
  }
  
  // Stage 3: Final Approval (if exists)
  if (finalApprovals.length > 0) {
    const steps: ModalApprovalStep[] = finalApprovals
      .sort((a, b) => a.requiredLevel - b.requiredLevel || a.order - b.order)
      .map(approval => {
        const approverName = approval.approver?.name || 
                            approval.requiredApprover?.name || 
                            'Pending Assignment'
        
        return {
          id: approval.id,
          name: approverName,
          role: approval.isCustomChain 
            ? `Custom Level ${approval.order}` 
            : `Level ${approval.requiredLevel}`,
          status: approval.status as 'submitted' | 'approved' | 'pending' | 'rejected',
          comment: approval.comments || 
                  (approval.status === 'pending' ? 'Awaiting review' : 'No comment'),
          timestamp: approval.approvedAt 
            ? approval.approvedAt.toISOString() 
            : approval.createdAt.toISOString(),
        }
      })
    
    // Find who initiated final approval from activities
    const finalApprovalActivity = request.activities.find(a => a.action === 'final_approval_initiated')
    
    stages.push({
      stageNumber: stageCounter++,
      stageName: 'Final Approval',
      submittedBy: finalApprovalActivity?.user.name || finalApprovalActivity?.user.email || 'Department Head',
      submittedAt: finalApprovalActivity?.createdAt.toISOString() || finalApprovals[0].createdAt.toISOString(),
      steps,
    })
  }

  // Add final approval metadata for status display
  const finalApprovalData = finalApprovals.length > 0 ? {
    finalApproval: {
      initiatedBy: request.activities.find(a => a.action === 'final_approval_initiated')?.user.name || 
                   request.activities.find(a => a.action === 'final_approval_initiated')?.user.email || 
                   'Department Head',
      initiatedAt: request.activities.find(a => a.action === 'final_approval_initiated')?.createdAt.toISOString() || 
                   finalApprovals[0].createdAt.toISOString(),
      currentLevel: finalApprovals.filter(a => a.status === 'approved').length + 1,
      totalLevels: finalApprovals.length,
      nextApprover: finalApprovals.find(a => a.status === 'pending')?.requiredApprover?.name || 
                    finalApprovals.find(a => a.status === 'pending')?.approver?.name ||
                    undefined,
    }
  } : {}

  return {
    ...baseData,
    ...solutionData,
    ...finalApprovalData,
    stages,
  }
}
