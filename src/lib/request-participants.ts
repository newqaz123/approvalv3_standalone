// Explicit request participant membership (Plan B Task 11 / O2).
// Membership is the production-evidenced union only: requester, stored
// solution submitters, approval-row actors (approverId ∪ requiredApproverId,
// current + historical), solution-approval actors, CURRENT-instance candidate
// group members (all steps), and assigned engineers.
// Non-members: sharing-scope viewers, unit members, and managers without a
// candidate/actor row. Viewing access never subscribes.

import type { Prisma } from '@prisma/client'
import { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'

export interface RequestParticipantMembership {
  requesterId: string
  solutionSubmitterIds: readonly string[]
  approvalActorIds: readonly string[]
  solutionApprovalActorIds: readonly string[]
  candidateMemberIds: readonly string[]
  assignedEngineerIds: readonly string[]
}

export interface RequestParticipantsDb {
  findRequesterId(requestId: string): Promise<string | null>
  findSolutionSubmitterIds(requestId: string): Promise<readonly string[]>
  findApprovalActorIds(requestId: string): Promise<readonly string[]>
  findSolutionApprovalActorIds(requestId: string): Promise<readonly string[]>
  findCurrentInstanceCandidateMemberIds(requestId: string): Promise<readonly string[]>
  findAssignedEngineerIds(requestId: string): Promise<readonly string[]>
}

export function uniqueParticipantIds(userIds: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const userId of userIds) {
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    ordered.push(userId)
  }
  return ordered
}

export async function resolveRequestParticipants(
  db: RequestParticipantsDb,
  requestId: string,
): Promise<RequestParticipantMembership> {
  const requesterId = await db.findRequesterId(requestId)
  if (!requesterId) {
    throw new Error(`Request not found: ${requestId}`)
  }

  const [
    solutionSubmitterIds,
    approvalActorIds,
    solutionApprovalActorIds,
    candidateMemberIds,
    assignedEngineerIds,
  ] = await Promise.all([
    db.findSolutionSubmitterIds(requestId),
    db.findApprovalActorIds(requestId),
    db.findSolutionApprovalActorIds(requestId),
    db.findCurrentInstanceCandidateMemberIds(requestId),
    db.findAssignedEngineerIds(requestId),
  ])

  return {
    requesterId,
    solutionSubmitterIds: uniqueParticipantIds(solutionSubmitterIds),
    approvalActorIds: uniqueParticipantIds(approvalActorIds),
    solutionApprovalActorIds: uniqueParticipantIds(solutionApprovalActorIds),
    candidateMemberIds: uniqueParticipantIds(candidateMemberIds),
    assignedEngineerIds: uniqueParticipantIds(assignedEngineerIds),
  }
}

export type RequestParticipantsClient = Pick<
  Prisma.TransactionClient,
  | 'requests'
  | 'solutions'
  | 'request_approvals'
  | 'solution_approvals'
  | 'approval_candidate_group_members'
  | 'request_engineer_assignments'
>

export function createPrismaRequestParticipantsDb(
  client: RequestParticipantsClient,
): RequestParticipantsDb {
  return {
    async findRequesterId(requestId) {
      const request = await client.requests.findUnique({
        where: { id: requestId },
        select: { requesterId: true },
      })
      return request?.requesterId ?? null
    },

    async findSolutionSubmitterIds(requestId) {
      const rows = await client.solutions.findMany({
        where: { requestId },
        select: { submittedById: true },
      })
      return uniqueParticipantIds(rows.map((row) => row.submittedById))
    },

    async findApprovalActorIds(requestId) {
      const rows = await client.request_approvals.findMany({
        where: { requestId },
        select: { approverId: true, requiredApproverId: true },
      })
      return uniqueParticipantIds(rows.flatMap((row) => [row.approverId, row.requiredApproverId]))
    },

    async findSolutionApprovalActorIds(requestId) {
      const rows = await client.solution_approvals.findMany({
        where: { solution: { requestId } },
        select: { approverId: true, requiredApproverId: true },
      })
      return uniqueParticipantIds(rows.flatMap((row) => [row.approverId, row.requiredApproverId]))
    },

    async findCurrentInstanceCandidateMemberIds(requestId) {
      const [requestRows, solutionRows] = await Promise.all([
        client.request_approvals.findMany({
          where: { requestId, OR: [...CURRENT_INSTANCE_ROW_FILTER] },
          select: { candidateGroupId: true },
        }),
        client.solution_approvals.findMany({
          where: { solution: { requestId }, OR: [...CURRENT_INSTANCE_ROW_FILTER] },
          select: { candidateGroupId: true },
        }),
      ])
      const groupIds = uniqueParticipantIds([
        ...requestRows.map((row) => row.candidateGroupId),
        ...solutionRows.map((row) => row.candidateGroupId),
      ])
      if (groupIds.length === 0) return []
      const members = await client.approval_candidate_group_members.findMany({
        where: { candidateGroupId: { in: groupIds } },
        select: { userId: true },
      })
      return uniqueParticipantIds(members.map((member) => member.userId))
    },

    async findAssignedEngineerIds(requestId) {
      const rows = await client.request_engineer_assignments.findMany({
        where: { requestId },
        select: { engineerId: true },
      })
      return uniqueParticipantIds(rows.map((row) => row.engineerId))
    },
  }
}
