// Production Prisma adapter for clean-start first-decision-wins decisions
// (Plan B Task 15). No leftover routing mode, no numeric-level eligibility.
// Structural contract lives in decisions.ts.

import { Prisma, RequestStatus } from '@prisma/client'
import { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'
import {
  advanceApprovalTransaction,
  evaluateApprovalEligibility,
  type AdvanceApprovalInput,
  type ApprovalAdvanceResult,
  type ApprovalEligibility,
  type ApprovalRowForTransaction,
  type ApprovalRoutingMode,
  type ApprovalTransactionDb,
} from '@/lib/approval-engine/decisions'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import { updateRequestStatusExpecting } from '@/lib/request-status-transition'

export type { AdvanceApprovalInput, ApprovalAdvanceResult, ApprovalEligibility, ApprovalTransactionDb }

function asRoutingMode(value: string): ApprovalRoutingMode {
  if (value === 'SNAPSHOT_GROUP' || value === 'CUSTOM_PERSON') return value
  throw new Error(`Unsupported approval routing mode: ${value}`)
}

function asApprovalStatus(status: string): 'pending' | 'approved' | 'rejected' {
  if (status === 'approved' || status === 'rejected') return status
  return 'pending'
}

function instanceIdentityWhere(instanceId: string | null): { instanceId: string } | { OR: Array<{ instanceId: null } | { instance: { supersededAt: null } }> } {
  if (instanceId) return { instanceId }
  return { OR: [...CURRENT_INSTANCE_ROW_FILTER] }
}

type LoadedContext = {
  phase: ApprovalPhase
  requestId: string
  solutionId: string | null
  requesterId: string
  title: string
  order: number
  costEstimate?: Prisma.Decimal | number | null
  solutionTitle?: string
}

async function lockOwningRequestRow(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
  if (typeof tx.$queryRaw !== 'function') return
  await tx.$queryRaw`SELECT id FROM requests WHERE id = ${requestId} FOR UPDATE`
}

async function loadCandidateUserIds(tx: Prisma.TransactionClient, candidateGroupId: string | null): Promise<string[]> {
  if (!candidateGroupId) return []
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
      requiredApproverId: true,
      instanceId: true,
      candidateGroupId: true,
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

  remember({
    phase,
    requestId: fresh.requestId,
    solutionId: null,
    requesterId: request.requesterId,
    title: request.title,
    order: fresh.order,
  })

  return {
    id: fresh.id,
    requestId: fresh.requestId,
    solutionId: null,
    instanceId: fresh.instanceId,
    requestStatus: request.status,
    instanceIsCurrent: fresh.instanceId === null || fresh.instance?.supersededAt == null,
    routingMode: asRoutingMode(fresh.routingMode),
    candidateUserIds: await loadCandidateUserIds(tx, fresh.candidateGroupId),
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
      requiredApproverId: true,
      instanceId: true,
      candidateGroupId: true,
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

  remember({
    phase: 'SOLUTION',
    requestId: solution.requestId,
    solutionId: fresh.solutionId,
    requesterId: request.requesterId,
    title: request.title,
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
    routingMode: asRoutingMode(fresh.routingMode),
    candidateUserIds: await loadCandidateUserIds(tx, fresh.candidateGroupId),
    requiredApproverId: fresh.requiredApproverId,
    status: asApprovalStatus(fresh.status),
    order: fresh.order,
  }
}

function approvalActivityAction(phase: ApprovalPhase): string {
  if (phase === 'SOLUTION') return 'solution_approved'
  if (phase === 'FINAL') return 'final_approval_approved'
  return 'approved'
}

function defaultApprovalComment(loaded: LoadedContext): string {
  if (loaded.phase === 'SOLUTION') {
    return `Solution "${loaded.solutionTitle ?? ''}" approved at step ${loaded.order}`
  }
  if (loaded.phase === 'FINAL') {
    return `Final approval approved at step ${loaded.order}`
  }
  return `Approved at step ${loaded.order}`
}

function statusChangeComment(
  loaded: LoadedContext,
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

export function createPrismaApprovalTransactionDb(tx: Prisma.TransactionClient): ApprovalTransactionDb {
  let loaded: LoadedContext | null = null

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
    async updatePendingApproval(input) {
      const data = {
        approverId: input.actorId,
        status: (input.decision === 'rejected' ? 'rejected' : 'approved') as 'approved' | 'rejected',
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
    async closeRemainingPendingApprovals(input) {
      if (input.phase === 'SOLUTION') {
        if (!input.solutionId) return
        await tx.solution_approvals.updateMany({
          where: {
            solutionId: input.solutionId,
            status: 'pending',
            ...instanceIdentityWhere(input.instanceId),
          },
          data: { status: 'rejected' },
        })
        return
      }
      await tx.request_approvals.updateMany({
        where: {
          requestId: input.requestId,
          isFinalApproval: input.phase === 'FINAL',
          status: 'pending',
          ...instanceIdentityWhere(input.instanceId),
        },
        data: { status: 'rejected' },
      })
    },
  }
}

export async function canUserApproveRequest(
  db: ApprovalTransactionDb,
  input: { approvalId: string; actorId: string },
): Promise<ApprovalEligibility> {
  return evaluateApprovalEligibility(db, { ...input, phase: 'REQUEST' })
}

export async function canUserApproveSolution(
  db: ApprovalTransactionDb,
  input: { approvalId: string; actorId: string },
): Promise<ApprovalEligibility> {
  return evaluateApprovalEligibility(db, { ...input, phase: 'SOLUTION' })
}

export async function canUserApproveFinal(
  db: ApprovalTransactionDb,
  input: { approvalId: string; actorId: string },
): Promise<ApprovalEligibility> {
  return evaluateApprovalEligibility(db, { ...input, phase: 'FINAL' })
}

export async function advanceApprovalAtomically(
  db: ApprovalTransactionDb,
  input: AdvanceApprovalInput,
): Promise<ApprovalAdvanceResult> {
  return advanceApprovalTransaction(db, input)
}
