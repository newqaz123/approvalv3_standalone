
import { createTranslator, type MessageKey, type Translator } from '@/lib/i18n/messages'
import { isCurrentInstanceApproval } from '@/lib/approval-engine/current-instance'

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
  status: 'submitted' | 'approved' | 'pending' | 'rejected' | 'not_reached'
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
  fileSize?: number | null
  fileType: string
  description?: string
}

export interface ModalActivityItem {
  id: string
  action: string
  actionKey?: MessageKey
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

type ApprovalDisplaySource = {
  requiredLevel?: number | null
  requiredPositionName?: string | null
  approver?: {
    name: string | null
  } | null
  requiredApprover?: {
    name: string | null
  } | null
  potentialApprovers?: Array<{
    name: string | null
  }>
}

type ApprovalStepSource = ApprovalDisplaySource & {
  id: string
  order: number
  status: string
  isCustomChain: boolean
  comments?: string | null
  approvedAt?: Date | null
  createdAt: Date
}

/**
 * When one approver rejects, the engine closes the remaining pending steps as
 * "rejected" without an approver. Nobody acted on those, so they are shown as
 * not reached instead of putting "Rejected" under that person's name.
 */
function isStepClosedByEarlierRejection(approval: ApprovalStepSource): boolean {
  return approval.status === 'rejected' && !approval.approver && !approval.approvedAt
}

/**
 * The current attempt's rejection: the step someone actually rejected, not a
 * later step the engine closed. Falls back to any rejected row so rows with
 * no recorded approver still produce a banner.
 */
function findCurrentRejection<T extends {
  status: string
  approver?: { name: string | null } | null
  approvedAt?: Date | null
  instanceId?: string | null
  instance?: { supersededAt: Date | string | null } | null
}>(approvals: readonly T[]): T | undefined {
  const rejected = approvals.filter(a => a.status === 'rejected' && isCurrentInstanceApproval(a))
  return rejected.find(a => a.approver || a.approvedAt) ?? rejected[0]
}

function toModalApprovalStep(approval: ApprovalStepSource, t: Translator): ModalApprovalStep {
  const base = {
    id: approval.id,
    name: getApprovalDisplayName(approval, t),
    role: getApprovalDisplayRole(approval, t),
  }
  if (isStepClosedByEarlierRejection(approval)) {
    return { ...base, status: 'not_reached', comment: t('requests.earlierRejection'), timestamp: '-' }
  }
  return {
    ...base,
    status: approval.status as ModalApprovalStep['status'],
    comment: approval.comments ||
            (approval.status === 'pending' ? t('requests.awaitingReview') : t('requests.noComment')),
    timestamp: approval.approvedAt
      ? approval.approvedAt.toISOString()
      : approval.createdAt.toISOString(),
  }
}

function getApprovalDisplayName(approval: ApprovalDisplaySource, t: Translator): string {
  if (approval.approver?.name) return approval.approver.name
  if (approval.requiredApprover?.name) return approval.requiredApprover.name

  const potentialApproverNames = approval.potentialApprovers
    ?.map((approver) => approver.name)
    .filter((name): name is string => Boolean(name))

  if (potentialApproverNames && potentialApproverNames.length > 0) {
    return potentialApproverNames.join(t('requests.approverOr'))
  }

  return approval.requiredLevel ? t('requests.approverAtLevel', { level: approval.requiredLevel }) : t('requests.unassignedApprover')
}

function getApprovalDisplayRole(approval: {
  order: number
  isCustomChain: boolean
  requiredLevel?: number | null
  requiredPositionName?: string | null
}, t: Translator): string {
  if (approval.isCustomChain) return t('requests.customLevel', { level: approval.order })
  if (approval.requiredPositionName) return approval.requiredPositionName
  return approval.requiredLevel ? t('requests.levelNumber', { level: approval.requiredLevel }) : t('requests.approvalStep')
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
  fileSize?: number | null
  fileType: string
  description?: string | null
}>): ModalFileAttachment[] {
  return files.map(file => ({
    id: file.id,
    fileName: file.fileName,
    fileSize: file.fileSize,
    fileType: file.fileType,
    description: file.description || undefined,
  }))
}

const activityMessageKeys = new Map<string, MessageKey>([
  ['created', 'requests.activity.created'],
  ['status_changed', 'requests.activity.statusChanged'],
  ['file_attached', 'requests.activity.fileAttached'],
  ['approved', 'requests.activity.approved'],
  ['rejected', 'requests.activity.rejected'],
  ['cancelled', 'requests.activity.cancelled'],
  ['solution_submitted', 'requests.activity.solutionSubmitted'],
  ['solution_approved', 'requests.activity.solutionApproved'],
  ['solution_rejected', 'requests.activity.solutionRejected'],
  ['manually_completed', 'requests.activity.manuallyCompleted'],
  ['final_approval_initiated', 'requests.activity.finalInitiated'],
  ['final_approval_approved', 'requests.activity.finalApproved'],
  ['final_approval_rejected', 'requests.activity.finalRejected'],
  ['resubmitted', 'requests.activity.resubmitted'],
  ['solution_resubmitted', 'requests.activity.solutionResubmitted'],
  ['engineers_assigned', 'requests.activity.engineersAssigned'],
])

export function getActivityMessageKey(action: string): MessageKey | undefined {
  return activityMessageKeys.get(action)
}

export function translateActivityAction(t: Translator, activity: ModalActivityItem): string {
  return activity.actionKey ? t(activity.actionKey) : activity.action
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
    actionKey: getActivityMessageKey(activity.action),
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
    fileSize?: number | null
    fileType: string
    description?: string | null
  }>
}, t: Translator = createTranslator('en')): ModalSolution {
  return {
    title: solution.title,
    description: solution.description,
    cost: Number(solution.costEstimate),
    currency: solution.currency,
    timeline: solution.timeline || undefined,
    submittedBy: solution.submittedBy?.name || solution.submittedBy?.email || t('requests.engineeringTeam'),
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
    fileSize?: number | null
    fileType: string
    description?: string | null
  }>
  approvals: Array<{
    id: string
    requiredLevel: number
    requiredPositionName?: string | null
    order: number
    status: string
    comments?: string | null
    approvedAt?: Date | null
    createdAt: Date
    isCustomChain: boolean
    isFinalApproval: boolean
    instanceId?: string | null
    instance?: { supersededAt: Date | string | null } | null
    approver?: {
      name: string | null
      email: string
    } | null
    requiredApprover?: {
      name: string | null
    } | null
    potentialApprovers?: Array<{
      name: string | null
    }>
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
      fileSize?: number | null
      fileType: string
      description?: string | null
    }>
    approvals: Array<{
      id: string
      requiredLevel: number
    requiredPositionName?: string | null
      order: number
      status: string
      comments?: string | null
      approvedAt?: Date | null
      createdAt: Date
      isCustomChain: boolean
      instanceId?: string | null
      instance?: { supersededAt: Date | string | null } | null
      approver?: {
        name: string | null
        email: string
      } | null
      requiredApprover?: {
        name: string | null
      } | null
      potentialApprovers?: Array<{
        name: string | null
      }>
    }>
  }>
}, t: Translator = createTranslator('en')) {
  const solution = request.solutions?.[0]
  // Only the current attempt is drawn. Rows of a superseded attempt (rejected,
  // then resubmitted) stay in the database and the activity timeline; drawing
  // them next to the new attempt showed every step twice.
  const currentApprovals = (request.approvals || []).filter(isCurrentInstanceApproval)
  const requestApprovals = currentApprovals.filter(a => !a.isFinalApproval)
  const finalApprovals = currentApprovals.filter(a => a.isFinalApproval)
  const solutionApprovals = (solution?.approvals || []).filter(isCurrentInstanceApproval)

  // Determine rejection info based on current status
  // Only show rejection if it's relevant to the current workflow stage
  let rejectionInfo = undefined
  
  if (request.status === 'ImprovementRequest' || request.status === 'RequestRejected') {
    // Show request rejection from the CURRENT attempt only. A superseded
    // rejection is history; hiding Approve/Reject behind it blocks resubmit.
    const rejectedRequestApproval = findCurrentRejection(requestApprovals)
    if (rejectedRequestApproval) {
      rejectionInfo = {
        reason: rejectedRequestApproval.comments || t('requests.noRejectionReason'),
        rejectedBy: rejectedRequestApproval.approver?.name || t('requests.unknown'),
        rejectedAt: rejectedRequestApproval.approvedAt?.toISOString() || rejectedRequestApproval.createdAt.toISOString(),
      }
    }
  } else if (request.status === 'SentToEngineer' || request.status === 'DesignCostEstimationApproval') {
    // Show solution rejection only if solution approvals are rejected
    const rejectedSolutionApproval = findCurrentRejection(solutionApprovals)
    // Also check for final approval rejection that sent it back to engineering
    const rejectedFinalApproval = findCurrentRejection(finalApprovals)
    const rejection = rejectedSolutionApproval || rejectedFinalApproval
    if (rejection) {
      rejectionInfo = {
        reason: rejection.comments || t('requests.noRejectionReason'),
        rejectedBy: rejection.approver?.name || t('requests.unknown'),
        rejectedAt: rejection.approvedAt?.toISOString() || rejection.createdAt.toISOString(),
      }
    }
  } else if (request.status === 'FinalApproval' || request.status === 'FinalRejected') {
    // Show final approval rejection
    const rejectedFinalApproval = findCurrentRejection(finalApprovals)
    if (rejectedFinalApproval) {
      rejectionInfo = {
        reason: rejectedFinalApproval.comments || t('requests.noRejectionReason'),
        rejectedBy: rejectedFinalApproval.approver?.name || t('requests.unknown'),
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
    solution: transformSolutionToModal(solution, t),
  } : {}

  // Add stages based on what's available - group by workflow stage, not by level
  let stages: ModalApprovalStage[] = []
  let stageCounter = 1
  
  // Stage 1: Request Approval (if exists)
  if (requestApprovals.length > 0) {
    const steps: ModalApprovalStep[] = requestApprovals
      .sort((a, b) => a.requiredLevel - b.requiredLevel || a.order - b.order)
      .map((approval) => toModalApprovalStep(approval, t))
    
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
      .map((approval) => toModalApprovalStep(approval, t))
    
    stages.push({
      stageNumber: stageCounter++,
      stageName: 'Design & Cost Approval',
      submittedBy: solution?.submittedBy?.name || solution?.submittedBy?.email || t('requests.engineeringTeam'),
      submittedAt: solution?.submittedAt.toISOString(),
      steps,
    })
  }
  
  // Stage 3: Final Approval (if exists)
  if (finalApprovals.length > 0) {
    const steps: ModalApprovalStep[] = finalApprovals
      .sort((a, b) => a.requiredLevel - b.requiredLevel || a.order - b.order)
      .map((approval) => toModalApprovalStep(approval, t))
    
    // Find who initiated final approval from activities
    const finalApprovalActivity = request.activities.find(a => a.action === 'final_approval_initiated')
    
    stages.push({
      stageNumber: stageCounter++,
      stageName: 'Final Approval',
      submittedBy: finalApprovalActivity?.user.name || finalApprovalActivity?.user.email || t('requests.departmentHead'),
      submittedAt: finalApprovalActivity?.createdAt.toISOString() || finalApprovals[0].createdAt.toISOString(),
      steps,
    })
  }

  // Add final approval metadata for status display
  const finalApprovalData = finalApprovals.length > 0 ? {
    finalApproval: {
      initiatedBy: request.activities.find(a => a.action === 'final_approval_initiated')?.user.name || 
                   request.activities.find(a => a.action === 'final_approval_initiated')?.user.email || 
                   t('requests.departmentHead'),
      initiatedAt: request.activities.find(a => a.action === 'final_approval_initiated')?.createdAt.toISOString() || 
                   finalApprovals[0].createdAt.toISOString(),
      currentLevel: finalApprovals.filter(a => a.status === 'approved').length + 1,
      totalLevels: finalApprovals.length,
      nextApprover: finalApprovals.find(a => a.status === 'pending')
        ? getApprovalDisplayName(finalApprovals.find(a => a.status === 'pending')!, t)
        : undefined,
    }
  } : {}

  return {
    ...baseData,
    ...solutionData,
    ...finalApprovalData,
    stages,
  }
}
