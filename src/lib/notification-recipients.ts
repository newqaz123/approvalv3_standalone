// Participants-only notification recipients (Plan B Task 11 / O2).
// Event mapping is authority. Viewing access never subscribes.
// Ledger R6: solution-submitter and assigned-engineer inclusion where
// specified; sharing viewers never subscribers.

import type { Prisma } from '@prisma/client'
import type { WorkflowNotificationType } from '@/lib/post-commit-notifications'

function uniqueIds(userIds: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const userId of userIds) {
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    ordered.push(userId)
  }
  return ordered
}

export interface NotificationRecipientDb {
  findApprovalRow(input: {
    approvalId: string
    phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  }): Promise<{
    routingMode: 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
    candidateGroupId: string | null
    requiredApproverId: string | null
    requestId: string
    isCurrentInstance: boolean
    status: string
  } | null>
  findCandidateGroupMemberIds(candidateGroupId: string): Promise<readonly string[]>
  findActiveUserIds(userIds: readonly string[]): Promise<readonly string[]>
}

export interface ApprovalNeededRecipientInput {
  approvalId: string
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
}

export interface ParticipantsOnlyNotificationPolicy {
  preserveEventTypes: readonly [
    'approval_needed',
    'approval_granted',
    'approval_rejected',
    'status_changed',
    'request_assigned',
    'solution_ready',
    'final_approval_needed',
  ]
  preserveCustomNotifyAllAtSubmit: false
  preserveSectionWideStatusBroadcasts: false
  allowVisibilityAsSubscription: false
}

export const PARTICIPANTS_ONLY_NOTIFICATION_POLICY: ParticipantsOnlyNotificationPolicy = {
  preserveEventTypes: [
    'approval_needed',
    'approval_granted',
    'approval_rejected',
    'status_changed',
    'request_assigned',
    'solution_ready',
    'final_approval_needed',
  ],
  preserveCustomNotifyAllAtSubmit: false,
  preserveSectionWideStatusBroadcasts: false,
  allowVisibilityAsSubscription: false,
}

export interface EventRecipientInput {
  type: WorkflowNotificationType
  requesterId: string
  solutionSubmitterIds?: readonly string[]
  assignedEngineerIds?: readonly string[]
  currentStepActiveCandidateIds?: readonly string[]
  nextStepActiveCandidateIds?: readonly string[]
  decidedActorId?: string
}

export function mapEventRecipients(input: EventRecipientInput): readonly string[] {
  switch (input.type) {
    case 'approval_needed':
    case 'final_approval_needed':
      return uniqueIds(input.currentStepActiveCandidateIds ?? [])
    case 'approval_granted':
      return uniqueIds([
        input.requesterId,
        ...(input.nextStepActiveCandidateIds ?? []),
      ])
    case 'approval_rejected':
      return uniqueIds([input.requesterId, input.decidedActorId])
    case 'status_changed':
      return uniqueIds([input.requesterId])
    case 'request_assigned':
      return uniqueIds([
        input.requesterId,
        ...(input.assignedEngineerIds ?? []),
      ])
    case 'solution_ready':
      return uniqueIds([
        input.requesterId,
        ...(input.solutionSubmitterIds ?? []),
      ])
  }
}

function isCurrentInstance(
  instanceId: string | null | undefined,
  instance: { supersededAt: Date | null } | null | undefined,
): boolean {
  if (instanceId == null) return true
  return instance != null && instance.supersededAt == null
}

export async function resolveApprovalNeededRecipients(
  db: NotificationRecipientDb,
  input: ApprovalNeededRecipientInput,
): Promise<readonly string[]> {
  const row = await db.findApprovalRow(input)
  if (!row || !row.isCurrentInstance) return []

  const ids: string[] = []
  if (row.candidateGroupId) {
    const members = await db.findCandidateGroupMemberIds(row.candidateGroupId)
    ids.push(...members)
  }
  if (row.requiredApproverId) {
    ids.push(row.requiredApproverId)
  }
  return db.findActiveUserIds(uniqueIds(ids))
}

export type NotificationRecipientClient = Pick<
  Prisma.TransactionClient,
  | 'request_approvals'
  | 'solution_approvals'
  | 'approval_candidate_group_members'
  | 'user'
>

function asRoutingMode(
  value: string | null | undefined,
): 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON' {
  if (value === 'SNAPSHOT_GROUP' || value === 'CUSTOM_PERSON') return value
  return 'LEGACY_LEVEL'
}

export function createPrismaNotificationRecipientDb(
  client: NotificationRecipientClient,
): NotificationRecipientDb {
  return {
    async findApprovalRow(input) {
      if (input.phase === 'SOLUTION') {
        const row = await client.solution_approvals.findUnique({
          where: { id: input.approvalId },
          select: {
            routingMode: true,
            candidateGroupId: true,
            requiredApproverId: true,
            status: true,
            instanceId: true,
            instance: { select: { supersededAt: true } },
            solution: { select: { requestId: true } },
          },
        })
        if (!row?.solution) return null
        return {
          routingMode: asRoutingMode(row.routingMode),
          candidateGroupId: row.candidateGroupId,
          requiredApproverId: row.requiredApproverId,
          requestId: row.solution.requestId,
          isCurrentInstance: isCurrentInstance(row.instanceId, row.instance),
          status: row.status,
        }
      }

      const row = await client.request_approvals.findUnique({
        where: { id: input.approvalId },
        select: {
          routingMode: true,
          candidateGroupId: true,
          requiredApproverId: true,
          requestId: true,
          isFinalApproval: true,
          status: true,
          instanceId: true,
          instance: { select: { supersededAt: true } },
        },
      })
      if (!row) return null
      if (input.phase === 'FINAL' && !row.isFinalApproval) return null
      if (input.phase === 'REQUEST' && row.isFinalApproval) return null
      return {
        routingMode: asRoutingMode(row.routingMode),
        candidateGroupId: row.candidateGroupId,
        requiredApproverId: row.requiredApproverId,
        requestId: row.requestId,
        isCurrentInstance: isCurrentInstance(row.instanceId, row.instance),
        status: row.status,
      }
    },

    async findCandidateGroupMemberIds(candidateGroupId) {
      const members = await client.approval_candidate_group_members.findMany({
        where: { candidateGroupId },
        select: { userId: true },
      })
      return members.map((member) => member.userId)
    },

    async findActiveUserIds(userIds) {
      const ordered = uniqueIds(userIds)
      if (ordered.length === 0) return []
      const users = await client.user.findMany({
        where: { id: { in: ordered }, isActive: true },
        select: { id: true },
      })
      const active = new Set(users.map((user) => user.id))
      return ordered.filter((userId) => active.has(userId))
    },
  }
}
