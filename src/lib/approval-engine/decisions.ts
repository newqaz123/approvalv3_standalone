// Clean-start first-decision-wins decisions + stranded detection (Plan B Task 5).
// Structural ApprovalTransactionDb: no database-client import. Numeric-level
// routing and live-level eligibility helpers are gone. The row shape has no
// numeric level field. Guarded update: 0-row updatePendingApproval throws
// RequestStatusConflictError. SUPERSEDED / terminal instance outcomes are
// never erased (adapter filters PENDING && supersededAt == null). Rejection
// closes remaining pending rows and the attempt (instance REJECTED) so the
// request can be revised.
//
// ApprovalPhase comes from the clean definition (ledger R5). Current-instance
// identity filter is re-exported from the dependency-free current-instance
// module. Conflict type comes from request-status-transition.

import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import { RequestStatusConflictError } from '@/lib/request-status-transition'

export { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'

type RequestStatus =
  | 'ImprovementRequest'
  | 'SentToEngineer'
  | 'SendBackToRequester'
  | 'Completed'
  | 'Cancelled'
  | 'DesignCostEstimationApproval'
  | 'FinalApproval'

export type ApprovalRoutingMode = 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'

export interface ApprovalEligibility {
  canApprove: boolean
  approvalId?: string
  routingMode?: ApprovalRoutingMode
  reason?: 'UNAUTHENTICATED' | 'INACTIVE_USER' | 'WRONG_STATUS' | 'NOT_CURRENT_STEP' | 'NOT_CANDIDATE' | 'CUSTOM_MISMATCH'
}

export interface ApprovalRowForTransaction {
  id: string
  requestId: string
  solutionId: string | null
  instanceId: string | null
  requestStatus: RequestStatus
  instanceIsCurrent: boolean
  routingMode: ApprovalRoutingMode
  candidateUserIds: readonly string[]
  requiredApproverId: string | null
  status: 'pending' | 'approved' | 'rejected'
  order: number
}

export interface ApprovalTransactionDb {
  loadApprovalForUpdate(input: { approvalId: string; phase: ApprovalPhase }): Promise<ApprovalRowForTransaction | null>
  isActiveUser(userId: string): Promise<boolean>
  hasEarlierPendingRow(input: {
    requestId: string
    solutionId: string | null
    instanceId: string | null
    phase: ApprovalPhase
    order: number
  }): Promise<boolean>
  updatePendingApproval(input: {
    approvalId: string
    actorId: string
    phase: ApprovalPhase
    instanceId: string | null
    expectedRequestStatus: RequestStatus
    decision?: 'approved' | 'rejected'
  }): Promise<{ count: number }>
  recordApprovalActivity(input: { approvalId: string; actorId: string; comments?: string }): Promise<void>
  countPendingApprovals(input: {
    requestId: string
    solutionId: string | null
    instanceId: string | null
    phase: ApprovalPhase
  }): Promise<number>
  advanceRequestStatus(input: { requestId: string; from: RequestStatus; to: RequestStatus }): Promise<void>
  setInstanceOutcome(input: { instanceId: string; outcome: 'APPROVED' | 'REJECTED' | 'CANCELLED' }): Promise<void>
  closeRemainingPendingApprovals(input: {
    requestId: string
    solutionId: string | null
    instanceId: string | null
    phase: ApprovalPhase
  }): Promise<void>
}

export interface AdvanceApprovalInput {
  approvalId: string
  actorId: string
  phase: ApprovalPhase
  comments?: string
  decision?: 'APPROVE' | 'REJECT'
}

export interface ApprovalAdvanceResult {
  actualActorId: string
  routingMode: ApprovalRoutingMode
  pendingApprovals: number
  statusChange?: { from: RequestStatus; to: RequestStatus }
}

const CONFLICT_MESSAGE =
  'Cannot approve - the approval is no longer pending or was changed concurrently.'

function conflict(message = CONFLICT_MESSAGE): never {
  throw new RequestStatusConflictError(message)
}

function documentStatusAllowsAction(phase: ApprovalPhase, status: RequestStatus): boolean {
  if (status === 'Cancelled') return false
  if (phase === 'SOLUTION') return status === 'DesignCostEstimationApproval'
  if (phase === 'FINAL') return status === 'FinalApproval'
  return status === 'ImprovementRequest'
}

function nextStatusForPhase(phase: ApprovalPhase, from: RequestStatus): RequestStatus | null {
  if (phase === 'SOLUTION') {
    return from === 'DesignCostEstimationApproval' ? 'SendBackToRequester' : null
  }
  if (phase === 'FINAL') {
    return from === 'FinalApproval' ? 'Completed' : null
  }
  return from === 'ImprovementRequest' ? 'SentToEngineer' : null
}

function revisionStatusForPhase(phase: ApprovalPhase, from: RequestStatus): RequestStatus | null {
  if (phase === 'SOLUTION' && from === 'DesignCostEstimationApproval') return 'SentToEngineer'
  if (phase === 'FINAL' && from === 'FinalApproval') return 'SentToEngineer'
  return null
}

async function evaluateEligibility(
  db: ApprovalTransactionDb,
  input: { approvalId: string; actorId: string; phase: ApprovalPhase },
): Promise<{ eligibility: ApprovalEligibility; row: ApprovalRowForTransaction | null }> {
  if (!input.actorId) {
    return { eligibility: { canApprove: false, reason: 'UNAUTHENTICATED' }, row: null }
  }

  const row = await db.loadApprovalForUpdate({ approvalId: input.approvalId, phase: input.phase })
  if (
    !row
    || !row.instanceIsCurrent
    || row.status !== 'pending'
    || !documentStatusAllowsAction(input.phase, row.requestStatus)
  ) {
    return { eligibility: { canApprove: false, reason: 'WRONG_STATUS' }, row }
  }

  const earlier = await db.hasEarlierPendingRow({
    requestId: row.requestId,
    solutionId: row.solutionId,
    instanceId: row.instanceId,
    phase: input.phase,
    order: row.order,
  })
  if (earlier) {
    return {
      eligibility: { canApprove: false, approvalId: row.id, routingMode: row.routingMode, reason: 'NOT_CURRENT_STEP' },
      row,
    }
  }

  const active = await db.isActiveUser(input.actorId)
  if (!active) {
    return {
      eligibility: { canApprove: false, approvalId: row.id, routingMode: row.routingMode, reason: 'INACTIVE_USER' },
      row,
    }
  }

  if (row.routingMode === 'SNAPSHOT_GROUP') {
    if (!row.candidateUserIds.includes(input.actorId)) {
      return {
        eligibility: { canApprove: false, approvalId: row.id, routingMode: row.routingMode, reason: 'NOT_CANDIDATE' },
        row,
      }
    }
    return {
      eligibility: { canApprove: true, approvalId: row.id, routingMode: row.routingMode },
      row,
    }
  }

  if (row.requiredApproverId !== input.actorId) {
    return {
      eligibility: { canApprove: false, approvalId: row.id, routingMode: row.routingMode, reason: 'CUSTOM_MISMATCH' },
      row,
    }
  }
  return {
    eligibility: { canApprove: true, approvalId: row.id, routingMode: row.routingMode },
    row,
  }
}

export async function evaluateApprovalEligibility(
  db: ApprovalTransactionDb,
  input: { approvalId: string; actorId: string; phase: ApprovalPhase },
): Promise<ApprovalEligibility> {
  const { eligibility } = await evaluateEligibility(db, input)
  return eligibility
}

export async function advanceApprovalTransaction(
  db: ApprovalTransactionDb,
  input: AdvanceApprovalInput,
): Promise<ApprovalAdvanceResult> {
  const { eligibility, row } = await evaluateEligibility(db, input)
  if (!eligibility.canApprove || !row) {
    conflict(
      eligibility.reason === 'INACTIVE_USER'
        ? 'Cannot approve - the current snapshot member is inactive.'
        : CONFLICT_MESSAGE,
    )
  }

  const decision = input.decision === 'REJECT' ? 'rejected' : 'approved'
  const updated = await db.updatePendingApproval({
    approvalId: row.id,
    actorId: input.actorId,
    phase: input.phase,
    instanceId: row.instanceId,
    expectedRequestStatus: row.requestStatus,
    decision,
  })
  if (updated.count !== 1) {
    conflict()
  }

  await db.recordApprovalActivity({
    approvalId: row.id,
    actorId: input.actorId,
    comments: input.comments,
  })

  if (decision === 'rejected') {
    await db.closeRemainingPendingApprovals({
      requestId: row.requestId,
      solutionId: row.solutionId,
      instanceId: row.instanceId,
      phase: input.phase,
    })
    if (row.instanceId) {
      await db.setInstanceOutcome({ instanceId: row.instanceId, outcome: 'REJECTED' })
    }
    const revisionTo = revisionStatusForPhase(input.phase, row.requestStatus)
    let statusChange: ApprovalAdvanceResult['statusChange']
    if (revisionTo) {
      await db.advanceRequestStatus({ requestId: row.requestId, from: row.requestStatus, to: revisionTo })
      statusChange = { from: row.requestStatus, to: revisionTo }
    }
    const pendingApprovals = await db.countPendingApprovals({
      requestId: row.requestId,
      solutionId: row.solutionId,
      instanceId: row.instanceId,
      phase: input.phase,
    })
    return {
      actualActorId: input.actorId,
      routingMode: row.routingMode,
      pendingApprovals,
      ...(statusChange ? { statusChange } : {}),
    }
  }

  const pendingApprovals = await db.countPendingApprovals({
    requestId: row.requestId,
    solutionId: row.solutionId,
    instanceId: row.instanceId,
    phase: input.phase,
  })

  let statusChange: ApprovalAdvanceResult['statusChange']
  if (pendingApprovals === 0) {
    const to = nextStatusForPhase(input.phase, row.requestStatus)
    if (!to) {
      conflict(
        `Cannot approve - it is no longer awaiting ${input.phase.toLowerCase()} approvals (status: ${row.requestStatus}). Please refresh and try again.`,
      )
    }
    await db.advanceRequestStatus({ requestId: row.requestId, from: row.requestStatus, to })
    if (row.instanceId) {
      await db.setInstanceOutcome({ instanceId: row.instanceId, outcome: 'APPROVED' })
    }
    statusChange = { from: row.requestStatus, to }
  }

  return {
    actualActorId: input.actorId,
    routingMode: row.routingMode,
    pendingApprovals,
    ...(statusChange ? { statusChange } : {}),
  }
}

export function isAttemptStranded(instance: {
  candidateGroups: ReadonlyArray<{ members: ReadonlyArray<{ userId: string; user: { isActive: boolean } }> }>
}): boolean {
  const members = instance.candidateGroups.flatMap((group) => group.members)
  return members.length > 0 && members.every((member) => !member.user.isActive)
}
