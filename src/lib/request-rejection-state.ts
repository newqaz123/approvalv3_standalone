import { isCurrentInstanceApproval } from '@/lib/approval-engine/current-instance'

/**
 * Whether a request is currently waiting for rework after a rejection — the
 * condition lists use to draw a request in red.
 *
 * A rejection only counts while it is the reason the request sits where it
 * is: a rejected current request attempt in ImprovementRequest, a rejected
 * current solution or final attempt in SentToEngineer, a rejected current
 * final attempt in FinalApproval. Superseded attempts (already resubmitted)
 * and rejections from an earlier stage never count.
 */
export interface RejectionStateRow {
  status: string
  isFinalApproval?: boolean | null
  instanceId?: string | null
  instance?: { supersededAt: Date | string | null } | null
}

export function isAwaitingReworkAfterRejection(input: {
  status: string
  /** request_approvals rows of the request (request and final stages). */
  requestApprovals: readonly RejectionStateRow[]
  /** solution_approvals rows of the request's latest solution. */
  solutionApprovals: readonly RejectionStateRow[]
}): boolean {
  const rejectedNow = (rows: readonly RejectionStateRow[]) =>
    rows.some((row) => row.status === 'rejected' && isCurrentInstanceApproval(row))
  const requestStage = input.requestApprovals.filter((row) => !row.isFinalApproval)
  const finalStage = input.requestApprovals.filter((row) => row.isFinalApproval)

  switch (input.status) {
    case 'ImprovementRequest':
      return rejectedNow(requestStage)
    case 'SentToEngineer':
      return rejectedNow(input.solutionApprovals) || rejectedNow(finalStage)
    case 'FinalApproval':
      return rejectedNow(finalStage)
    default:
      return false
  }
}
