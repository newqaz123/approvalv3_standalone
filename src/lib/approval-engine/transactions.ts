import { Prisma, RequestStatus, UserRole } from '@prisma/client'
import { CURRENT_INSTANCE_ROW_FILTER } from './current-instance'
import { classifyApprovalRow } from './legacy'
import {
  RequestStatusConflictError,
  updateRequestStatusExpecting,
} from '@/lib/request-status-transition'

export interface ApprovalRowForTransaction {
  id: string
  requestId: string
  solutionId: string | null
  instanceId: string | null
  requestStatus: RequestStatus
  instanceIsCurrent: boolean
  routingMode: 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  candidateUserIds: readonly string[]
  requiredLevel: number | null
  requiredApproverId: string | null
  status: 'pending' | 'approved' | 'rejected'
  order: number
}

export interface ApprovalTransactionDb {
  loadApprovalForUpdate(input: { approvalId: string; phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): Promise<ApprovalRowForTransaction | null>
  isActiveUser(userId: string): Promise<boolean>
  hasEarlierPendingRow(input: { requestId: string; solutionId: string | null; instanceId: string | null; phase: 'REQUEST' | 'SOLUTION' | 'FINAL'; order: number }): Promise<boolean>
  evaluateLegacyEligibility(input: { approvalId: string; actorId: string; phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): Promise<boolean>
  updatePendingApproval(input: { approvalId: string; actorId: string; phase: 'REQUEST' | 'SOLUTION' | 'FINAL'; instanceId: string | null; expectedRequestStatus: RequestStatus }): Promise<{ count: number }>
  recordApprovalActivity(input: { approvalId: string; actorId: string; comments?: string }): Promise<void>
  countPendingApprovals(input: { requestId: string; solutionId: string | null; instanceId: string | null; phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): Promise<number>
  advanceRequestStatus(input: { requestId: string; from: RequestStatus; to: RequestStatus }): Promise<void>
  setInstanceOutcome(input: { instanceId: string; outcome: 'APPROVED' | 'REJECTED' | 'CANCELLED' }): Promise<void>
}

export interface ApprovalEligibility {
  canApprove: boolean
  approvalId?: string
  routingMode?: 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  reason?: 'UNAUTHENTICATED' | 'INACTIVE_USER' | 'WRONG_STATUS' | 'NOT_CURRENT_STEP' | 'NOT_CANDIDATE' | 'LEGACY_MISMATCH' | 'CUSTOM_MISMATCH'
}

export interface AdvanceApprovalInput {
  approvalId: string
  actorId: string
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  comments?: string
}

export interface ApprovalAdvanceResult {
  actualActorId: string
  routingMode: 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  pendingApprovals: number
  statusChange?: { from: RequestStatus; to: RequestStatus }
}

export type ApprovalPhase = 'REQUEST' | 'SOLUTION' | 'FINAL'

const CONFLICT_MESSAGE =
  'Cannot approve - the approval is no longer pending or was changed concurrently.'

function conflict(message = CONFLICT_MESSAGE): never {
  throw new RequestStatusConflictError(message)
}

/**
 * Prisma predicate for a NEW snapshot-group actionable row: membership is the
 * persisted candidate group, never a live department or requiredLevel match.
 */
export function snapshotGroupActionWhere(userId: string) {
  return {
    routingMode: 'SNAPSHOT_GROUP' as const,
    candidateGroup: { members: { some: { userId } } },
  }
}

function documentStatusAllowsAction(
  phase: ApprovalPhase,
  status: RequestStatus,
  mode: 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON',
): boolean {
  if (status === 'Cancelled') return false
  if (phase === 'SOLUTION') return status === 'DesignCostEstimationApproval'
  if (phase === 'FINAL') return status === 'FinalApproval'
  if (mode === 'LEGACY_LEVEL') {
    return status === 'ImprovementRequest' || status === 'SentToEngineer' || status === 'SendBackToRequester'
  }
  return status === 'ImprovementRequest'
}

function nextStatusForPhase(phase: ApprovalPhase, from: RequestStatus): RequestStatus | null {
  if (phase === 'SOLUTION') {
    return from === 'DesignCostEstimationApproval' ? 'SendBackToRequester' : null
  }
  if (phase === 'FINAL') {
    return from === 'FinalApproval' ? 'Completed' : null
  }
  switch (from) {
    case 'ImprovementRequest':
      return 'SentToEngineer'
    case 'SentToEngineer':
      return 'SendBackToRequester'
    case 'SendBackToRequester':
      return 'Completed'
    default:
      return null
  }
}

async function evaluateEligibility(
  db: ApprovalTransactionDb,
  input: { approvalId: string; actorId: string; phase: ApprovalPhase },
): Promise<{ eligibility: ApprovalEligibility; row: ApprovalRowForTransaction | null }> {
  if (!input.actorId) {
    return { eligibility: { canApprove: false, reason: 'UNAUTHENTICATED' }, row: null }
  }

  const row = await db.loadApprovalForUpdate({ approvalId: input.approvalId, phase: input.phase })
  if (!row || !row.instanceIsCurrent || row.status !== 'pending' || !documentStatusAllowsAction(input.phase, row.requestStatus, row.routingMode)) {
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

  if (row.routingMode === 'SNAPSHOT_GROUP') {
    const active = await db.isActiveUser(input.actorId)
    if (!active) {
      return {
        eligibility: { canApprove: false, approvalId: row.id, routingMode: row.routingMode, reason: 'INACTIVE_USER' },
        row,
      }
    }
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

  if (row.routingMode === 'CUSTOM_PERSON') {
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

  const legacyOk = await db.evaluateLegacyEligibility({
    approvalId: row.id,
    actorId: input.actorId,
    phase: input.phase,
  })
  if (!legacyOk) {
    return {
      eligibility: { canApprove: false, approvalId: row.id, routingMode: row.routingMode, reason: 'LEGACY_MISMATCH' },
      row,
    }
  }
  return {
    eligibility: { canApprove: true, approvalId: row.id, routingMode: row.routingMode },
    row,
  }
}

export async function canUserApproveRequest(
  db: ApprovalTransactionDb,
  input: { approvalId: string; actorId: string },
): Promise<ApprovalEligibility> {
  const { eligibility } = await evaluateEligibility(db, { ...input, phase: 'REQUEST' })
  return eligibility
}

export async function canUserApproveSolution(
  db: ApprovalTransactionDb,
  input: { approvalId: string; actorId: string },
): Promise<ApprovalEligibility> {
  const { eligibility } = await evaluateEligibility(db, { ...input, phase: 'SOLUTION' })
  return eligibility
}

export async function canUserApproveFinal(
  db: ApprovalTransactionDb,
  input: { approvalId: string; actorId: string },
): Promise<ApprovalEligibility> {
  const { eligibility } = await evaluateEligibility(db, { ...input, phase: 'FINAL' })
  return eligibility
}

export async function advanceApprovalAtomically(
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

  const updated = await db.updatePendingApproval({
    approvalId: row.id,
    actorId: input.actorId,
    phase: input.phase,
    instanceId: row.instanceId,
    expectedRequestStatus: row.requestStatus,
  })
  if (updated.count !== 1) {
    conflict()
  }

  await db.recordApprovalActivity({
    approvalId: row.id,
    actorId: input.actorId,
    comments: input.comments,
  })

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

/**
 * Production `ApprovalTransactionDb` bound to one Prisma transaction (or the
 * global client for read-only eligibility). Locking approach: Prisma has no
 * first-class `FOR UPDATE` on `findUnique`, so the adapter issues a
 * parameterized `SELECT id FROM requests WHERE id = $1 FOR UPDATE` through
 * `tx.$queryRaw` *before* reading the current instance and pending step.
 * Concurrent candidates serialize on that row lock; the in-memory workflow
 * harness has no `$queryRaw` and skips the lock (single-threaded, no I/O).
 */
export function createPrismaApprovalTransactionDb(tx: Prisma.TransactionClient): ApprovalTransactionDb {
  let loaded: {
    phase: ApprovalPhase
    requestId: string
    solutionId: string | null
    requesterId: string
    title: string
    requiredLevel: number | null
    order: number
    costEstimate?: Prisma.Decimal | number | null
    solutionTitle?: string
  } | null = null

  return {
    async loadApprovalForUpdate(input) {
      loaded = null
      if (input.phase === 'SOLUTION') {
        return loadSolutionApproval(tx, input.approvalId, (ctx) => {
          loaded = ctx
        })
      }
      return loadRequestApproval(tx, input.approvalId, input.phase, (ctx) => {
        loaded = ctx
      })
    },
    async isActiveUser(userId) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true } })
      return Boolean(user?.isActive)
    },
    async hasEarlierPendingRow(input) {
      if (input.phase === 'SOLUTION') {
        if (!input.solutionId) return false
        const count = await tx.solution_approvals.count({
          where: {
            solutionId: input.solutionId,
            order: { lt: input.order },
            status: 'pending',
            ...instanceIdentityWhere(input.instanceId),
          },
        })
        return count > 0
      }
      const count = await tx.request_approvals.count({
        where: {
          requestId: input.requestId,
          isFinalApproval: input.phase === 'FINAL',
          order: { lt: input.order },
          status: 'pending',
          ...instanceIdentityWhere(input.instanceId),
        },
      })
      return count > 0
    },
    async evaluateLegacyEligibility(input) {
      return evaluateLiveLegacyEligibility(tx, input)
    },
    async updatePendingApproval(input) {
      const data = {
        approverId: input.actorId,
        status: 'approved' as const,
        approvedAt: new Date(),
      }
      const updated =
        input.phase === 'SOLUTION'
          ? await tx.solution_approvals.updateMany({
              where: {
                id: input.approvalId,
                status: 'pending',
                instanceId: input.instanceId,
                solution: { request: { status: input.expectedRequestStatus } },
              },
              data,
            })
          : await tx.request_approvals.updateMany({
              where: {
                id: input.approvalId,
                status: 'pending',
                instanceId: input.instanceId,
                isFinalApproval: input.phase === 'FINAL',
                request: { status: input.expectedRequestStatus },
              },
              data,
            })
      if (updated.count !== 1) return { count: 0 }
      return { count: 1 }
    },
    async recordApprovalActivity(input) {
      if (!loaded) return
      const comments = input.comments || defaultApprovalComment(loaded)
      if (input.comments) {
        if (loaded.phase === 'SOLUTION') {
          await tx.solution_approvals.update({ where: { id: input.approvalId }, data: { comments: input.comments } })
        } else {
          await tx.request_approvals.update({ where: { id: input.approvalId }, data: { comments: input.comments } })
        }
      }
      await tx.request_activities.create({
        data: {
          requestId: loaded.requestId,
          userId: input.actorId,
          action: approvalActivityAction(loaded.phase),
          comments,
        },
      })
    },
    async countPendingApprovals(input) {
      if (input.phase === 'SOLUTION') {
        if (!input.solutionId) return 0
        return tx.solution_approvals.count({
          where: {
            solutionId: input.solutionId,
            status: 'pending',
            ...instanceIdentityWhere(input.instanceId),
          },
        })
      }
      return tx.request_approvals.count({
        where: {
          requestId: input.requestId,
          isFinalApproval: input.phase === 'FINAL',
          status: 'pending',
          ...instanceIdentityWhere(input.instanceId),
        },
      })
    },
    async advanceRequestStatus(input) {
      if (loaded?.phase === 'SOLUTION') {
        // Existing solution completion writes status + projectEstimateCost
        // together. The owning request row is already locked FOR UPDATE in
        // this transaction, so the unguarded update cannot interleave with
        // another writer on the same request. REQUEST/FINAL use the shared
        // compare-and-set helper.
        const data: Prisma.requestsUpdateInput = { status: input.to }
        if (loaded.costEstimate !== undefined && loaded.costEstimate !== null) {
          data.projectEstimateCost = loaded.costEstimate
        }
        await tx.requests.update({ where: { id: input.requestId }, data })
      } else {
        await updateRequestStatusExpecting(tx, {
          requestId: input.requestId,
          expectedStatuses: [input.from],
          data: { status: input.to },
          actionLabel: 'approve',
        })
      }
      if (!loaded) return
      await tx.request_activities.create({
        data: {
          requestId: input.requestId,
          userId: loaded.requesterId,
          action: 'status_changed',
          fromStatus: input.from,
          toStatus: input.to,
          comments: statusChangeComment(loaded, input.from, input.to),
        },
      })
    },
    async setInstanceOutcome(input) {
      await tx.approval_instances.updateMany({
        where: { id: input.instanceId, state: 'PENDING', supersededAt: null },
        data: { state: input.outcome },
      })
    },
  }
}

function instanceIdentityWhere(instanceId: string | null): { instanceId: string } | { OR: Array<{ instanceId: null } | { instance: { supersededAt: null } }> } {
  if (instanceId) return { instanceId }
  return { OR: [...CURRENT_INSTANCE_ROW_FILTER] }
}

function approvalActivityAction(phase: ApprovalPhase): string {
  if (phase === 'SOLUTION') return 'solution_approved'
  if (phase === 'FINAL') return 'final_approval_approved'
  return 'approved'
}

function defaultApprovalComment(loaded: { phase: ApprovalPhase; requiredLevel: number | null; order: number; solutionTitle?: string }): string {
  if (loaded.phase === 'SOLUTION') {
    return `Solution "${loaded.solutionTitle ?? ''}" approved at step ${loaded.order}`
  }
  if (loaded.phase === 'FINAL') {
    return `Final approval approved at step ${loaded.order}`
  }
  return `Approved at level ${loaded.requiredLevel ?? ''}`
}

function statusChangeComment(
  loaded: { phase: ApprovalPhase; solutionTitle?: string },
  from: RequestStatus,
  to: RequestStatus,
): string {
  if (loaded.phase === 'SOLUTION') {
    return `Solution "${loaded.solutionTitle ?? ''}" approved. Request sent back to requester for final review.`
  }
  if (loaded.phase === 'FINAL') {
    return `All final approvals completed. Request marked as completed.`
  }
  return `Status changed from ${from} to ${to}`
}

type LoadedContext = {
  phase: ApprovalPhase
  requestId: string
  solutionId: string | null
  requesterId: string
  title: string
  requiredLevel: number | null
  order: number
  costEstimate?: Prisma.Decimal | number | null
  solutionTitle?: string
}

/**
 * Lock the owning request row. Prisma exposes no `FOR UPDATE` on
 * `findUnique`; a tagged `$queryRaw` template is the supported way to take
 * an exclusive row lock that lasts until the transaction commits or rolls
 * back. Absent `$queryRaw` (the in-memory harness) the lock is skipped.
 */
async function lockOwningRequestRow(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
  if (typeof tx.$queryRaw !== 'function') return
  // Call through `tx` so Prisma keeps its client `this` (destructuring `$queryRaw`
  // throws `_createPrismaPromise` of undefined on the global client).
  await tx.$queryRaw`SELECT id FROM requests WHERE id = ${requestId} FOR UPDATE`
}

function asApprovalStatus(status: string): 'pending' | 'approved' | 'rejected' {
  if (status === 'approved' || status === 'rejected') return status
  return 'pending'
}

async function loadCandidateUserIds(tx: Prisma.TransactionClient, candidateGroupId: string | null): Promise<string[]> {
  if (!candidateGroupId) return []
  if (!tx.approval_candidate_group_members) return []
  const members = await tx.approval_candidate_group_members.findMany({
    where: { candidateGroupId },
    select: { userId: true },
  })
  return members.map((member) => member.userId)
}

async function currentInstanceId(
  tx: Prisma.TransactionClient,
  input: { requestId: string; solutionId: string | null; phase: ApprovalPhase },
): Promise<string | null> {
  const current = await tx.approval_instances.findFirst({
    where: {
      phase: input.phase,
      supersededAt: null,
      ...(input.phase === 'SOLUTION' ? { solutionId: input.solutionId } : { requestId: input.requestId }),
    },
    orderBy: { attempt: 'desc' },
    select: { id: true },
  })
  return current?.id ?? null
}

async function loadRequestApproval(
  tx: Prisma.TransactionClient,
  approvalId: string,
  phase: 'REQUEST' | 'FINAL',
  remember: (ctx: LoadedContext) => void,
): Promise<ApprovalRowForTransaction | null> {
  const existing = await tx.request_approvals.findUnique({
    where: { id: approvalId },
    select: {
      id: true,
      requestId: true,
      status: true,
      order: true,
      routingMode: true,
      integrityVersion: true,
      requiredLevel: true,
      requiredApproverId: true,
      instanceId: true,
      candidateGroupId: true,
      requiredPosition: true,
      isCustomChain: true,
      isFinalApproval: true,
    },
  })
  if (!existing) return null
  if (phase === 'REQUEST' && existing.isFinalApproval) return null
  if (phase === 'FINAL' && !existing.isFinalApproval) return null

  await lockOwningRequestRow(tx, existing.requestId)

  const request = await tx.requests.findUnique({
    where: { id: existing.requestId },
    select: { status: true, requesterId: true, title: true },
  })
  if (!request || request.status === 'Cancelled') return null

  const fresh = await tx.request_approvals.findUnique({
    where: { id: approvalId },
    select: {
      id: true,
      requestId: true,
      status: true,
      order: true,
      routingMode: true,
      integrityVersion: true,
      requiredLevel: true,
      requiredApproverId: true,
      instanceId: true,
      candidateGroupId: true,
      requiredPosition: true,
      isCustomChain: true,
      isFinalApproval: true,
      instance: { select: { id: true, supersededAt: true } },
    },
  })
  if (!fresh) return null
  if (phase === 'REQUEST' && fresh.isFinalApproval) return null
  if (phase === 'FINAL' && !fresh.isFinalApproval) return null
  if (fresh.instanceId && fresh.instance?.supersededAt) return null

  const currentId = await currentInstanceId(tx, { requestId: fresh.requestId, solutionId: null, phase })
  if (fresh.instanceId && currentId && fresh.instanceId !== currentId) return null

  const classified = classifyApprovalRow({
    routingMode: fresh.routingMode,
    integrityVersion: fresh.integrityVersion,
    requiredLevel: fresh.requiredLevel,
    requiredApproverId: fresh.requiredApproverId,
    requiredPosition: fresh.requiredPosition,
    isCustomChain: fresh.isCustomChain,
    instanceId: fresh.instanceId,
    candidateGroupId: fresh.candidateGroupId,
  })

  remember({
    phase,
    requestId: fresh.requestId,
    solutionId: null,
    requesterId: request.requesterId,
    title: request.title,
    requiredLevel: fresh.requiredLevel,
    order: fresh.order,
  })

  return {
    id: fresh.id,
    requestId: fresh.requestId,
    solutionId: null,
    instanceId: fresh.instanceId,
    requestStatus: request.status,
    instanceIsCurrent: fresh.instanceId === null || fresh.instance?.supersededAt == null,
    routingMode: classified.mode,
    candidateUserIds: await loadCandidateUserIds(tx, fresh.candidateGroupId),
    requiredLevel: fresh.requiredLevel,
    requiredApproverId: fresh.requiredApproverId,
    status: asApprovalStatus(fresh.status),
    order: fresh.order,
  }
}

async function loadSolutionApproval(
  tx: Prisma.TransactionClient,
  approvalId: string,
  remember: (ctx: LoadedContext) => void,
): Promise<ApprovalRowForTransaction | null> {
  const existing = await tx.solution_approvals.findUnique({
    where: { id: approvalId },
    select: { id: true, solutionId: true },
  })
  if (!existing) return null

  const solution = await tx.solutions.findUnique({
    where: { id: existing.solutionId },
    select: { requestId: true, title: true, costEstimate: true },
  })
  if (!solution) return null

  await lockOwningRequestRow(tx, solution.requestId)

  const request = await tx.requests.findUnique({
    where: { id: solution.requestId },
    select: { status: true, requesterId: true, title: true },
  })
  if (!request || request.status === 'Cancelled') return null

  const fresh = await tx.solution_approvals.findUnique({
    where: { id: approvalId },
    select: {
      id: true,
      solutionId: true,
      status: true,
      order: true,
      routingMode: true,
      integrityVersion: true,
      requiredLevel: true,
      requiredApproverId: true,
      instanceId: true,
      candidateGroupId: true,
      requiredPosition: true,
      isCustomChain: true,
      instance: { select: { id: true, supersededAt: true } },
    },
  })
  if (!fresh) return null
  if (fresh.instanceId && fresh.instance?.supersededAt) return null

  const currentId = await currentInstanceId(tx, {
    requestId: solution.requestId,
    solutionId: fresh.solutionId,
    phase: 'SOLUTION',
  })
  if (fresh.instanceId && currentId && fresh.instanceId !== currentId) return null

  const classified = classifyApprovalRow({
    routingMode: fresh.routingMode,
    integrityVersion: fresh.integrityVersion,
    requiredLevel: fresh.requiredLevel,
    requiredApproverId: fresh.requiredApproverId,
    requiredPosition: fresh.requiredPosition,
    isCustomChain: fresh.isCustomChain,
    instanceId: fresh.instanceId,
    candidateGroupId: fresh.candidateGroupId,
  })

  remember({
    phase: 'SOLUTION',
    requestId: solution.requestId,
    solutionId: fresh.solutionId,
    requesterId: request.requesterId,
    title: request.title,
    requiredLevel: fresh.requiredLevel,
    order: fresh.order,
    costEstimate: solution.costEstimate,
    solutionTitle: solution.title,
  })

  return {
    id: fresh.id,
    requestId: solution.requestId,
    solutionId: fresh.solutionId,
    instanceId: fresh.instanceId,
    requestStatus: request.status,
    instanceIsCurrent: fresh.instanceId === null || fresh.instance?.supersededAt == null,
    routingMode: classified.mode,
    candidateUserIds: await loadCandidateUserIds(tx, fresh.candidateGroupId),
    requiredLevel: fresh.requiredLevel,
    requiredApproverId: fresh.requiredApproverId,
    status: asApprovalStatus(fresh.status),
    order: fresh.order,
  }
}

/**
 * Live legacy eligibility: invokes the same department / role / external
 * department_approvers / custom-identity / order / document-status checks as
 * the existing request, solution, and final checkers. Numeric equality of
 * `requiredLevel` alone is never sufficient.
 */
async function evaluateLiveLegacyEligibility(
  tx: Prisma.TransactionClient,
  input: { approvalId: string; actorId: string; phase: ApprovalPhase },
): Promise<boolean> {
  if (input.phase === 'SOLUTION') {
    return evaluateLiveLegacySolution(tx, input)
  }
  return evaluateLiveLegacyRequest(tx, input, input.phase === 'FINAL')
}

async function evaluateLiveLegacyRequest(
  tx: Prisma.TransactionClient,
  input: { approvalId: string; actorId: string },
  isFinal: boolean,
): Promise<boolean> {
  const approval = await tx.request_approvals.findUnique({
    where: { id: input.approvalId },
    select: {
      requestId: true,
      requiredLevel: true,
      requiredApproverId: true,
      order: true,
      status: true,
      isFinalApproval: true,
      isCustomChain: true,
    },
  })
  if (!approval || approval.status !== 'pending' || approval.isFinalApproval !== isFinal) return false

  const user = await tx.user.findUnique({
    where: { id: input.actorId },
    select: { level: true, departmentId: true },
  })
  const request = await tx.requests.findUnique({
    where: { id: approval.requestId },
    select: { departmentId: true, status: true },
  })
  if (!user || !request) return false
  if (request.departmentId === null) return false
  if (isFinal && request.status !== RequestStatus.FinalApproval) return false

  if (approval.isCustomChain) {
    if (approval.requiredApproverId !== input.actorId) return false
  } else {
    let effectiveLevel: number | null =
      user.departmentId !== null && user.departmentId === request.departmentId ? user.level : null
    if (!effectiveLevel) {
      const deptApprover = await tx.department_approvers.findFirst({
        where: { departmentId: request.departmentId, approverId: input.actorId },
        select: { approverLevel: true },
      })
      if (deptApprover) effectiveLevel = deptApprover.approverLevel
    }
    if (!effectiveLevel || approval.requiredLevel !== effectiveLevel) return false
  }

  const previous = await tx.request_approvals.count({
    where: {
      requestId: approval.requestId,
      isFinalApproval: isFinal,
      order: { lt: approval.order },
      status: 'pending',
      OR: [...CURRENT_INSTANCE_ROW_FILTER],
    },
  })
  return previous === 0
}

async function evaluateLiveLegacySolution(
  tx: Prisma.TransactionClient,
  input: { approvalId: string; actorId: string },
): Promise<boolean> {
  const approval = await tx.solution_approvals.findUnique({
    where: { id: input.approvalId },
    select: {
      solutionId: true,
      requiredLevel: true,
      requiredApproverId: true,
      order: true,
      status: true,
      isCustomChain: true,
    },
  })
  if (!approval || approval.status !== 'pending') return false

  const user = await tx.user.findUnique({
    where: { id: input.actorId },
    select: { level: true, role: true },
  })
  const solution = await tx.solutions.findUnique({
    where: { id: approval.solutionId },
    select: { request: { select: { status: true, departmentId: true } } },
  })
  if (!user || !solution) return false
  if (solution.request.departmentId === null) return false
  if (solution.request.status !== RequestStatus.DesignCostEstimationApproval) return false

  if (approval.isCustomChain) {
    if (approval.requiredApproverId !== input.actorId) return false
  } else {
    if (!user.level || user.role !== UserRole.engineering) return false
    if (approval.requiredLevel !== user.level) return false
  }

  const previous = await tx.solution_approvals.count({
    where: {
      solutionId: approval.solutionId,
      order: { lt: approval.order },
      status: 'pending',
      OR: [...CURRENT_INSTANCE_ROW_FILTER],
    },
  })
  return previous === 0
}
