import type { Prisma } from '@prisma/client'

export interface NotificationRecipientDb {
  findApprovalRow(input: {
    approvalId: string
    phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  }): Promise<{
    routingMode: 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
    candidateGroupId: string | null
    requiredLevel: number | null
    requiredApproverId: string | null
    requestId: string
    isCurrentInstance: boolean
    status: string
  } | null>
  findCandidateGroupMemberIds(candidateGroupId: string): Promise<readonly string[]>
  findActiveUserIds(userIds: readonly string[]): Promise<readonly string[]>
  findLegacyApproverIds(input: {
    requestId: string
    requiredLevel: number
    phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  }): Promise<readonly string[]>
  findCustomRecipientIds(approvalId: string): Promise<readonly string[]>
  findReviewedSectionRecipientIds(input: {
    legacyDepartmentId: string | null
    requestId: string
  }): Promise<readonly string[]>
}

export interface ApprovalNeededRecipientInput {
  approvalId: string
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
}

export interface NotificationCompatibilityPolicy {
  preserveEventTypes: readonly [
    'approval_needed',
    'approval_granted',
    'approval_rejected',
    'status_changed',
    'request_assigned',
    'solution_ready',
    'final_approval_needed',
  ]
  preserveCustomNotifyAllAtSubmit: true
  preserveSectionWideStatusBroadcasts: true
  allowVisibilityAsSubscription: false
}

export const NOTIFICATION_COMPATIBILITY_POLICY: NotificationCompatibilityPolicy = {
  preserveEventTypes: [
    'approval_needed',
    'approval_granted',
    'approval_rejected',
    'status_changed',
    'request_assigned',
    'solution_ready',
    'final_approval_needed',
  ],
  preserveCustomNotifyAllAtSubmit: true,
  preserveSectionWideStatusBroadcasts: true,
  allowVisibilityAsSubscription: false,
}

function uniqueIds(userIds: readonly string[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const userId of userIds) {
    if (seen.has(userId)) continue
    seen.add(userId)
    ordered.push(userId)
  }
  return ordered
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

  if (row.routingMode === 'SNAPSHOT_GROUP') {
    if (!row.candidateGroupId) return []
    const members = await db.findCandidateGroupMemberIds(row.candidateGroupId)
    return db.findActiveUserIds(uniqueIds(members))
  }

  if (row.routingMode === 'LEGACY_LEVEL') {
    if (row.requiredLevel == null) return []
    return db.findLegacyApproverIds({
      requestId: row.requestId,
      requiredLevel: row.requiredLevel,
      phase: input.phase,
    })
  }

  const customIds = await db.findCustomRecipientIds(input.approvalId)
  return uniqueIds(customIds)
}

export async function resolveStatusBroadcastRecipients(
  db: NotificationRecipientDb,
  input: {
    legacyDepartmentId: string | null
    requestId: string
    excludeUserIds?: readonly string[]
  },
): Promise<readonly string[]> {
  const members = await db.findReviewedSectionRecipientIds({
    legacyDepartmentId: input.legacyDepartmentId,
    requestId: input.requestId,
  })
  const active = await db.findActiveUserIds(uniqueIds(members))
  if (!input.excludeUserIds || input.excludeUserIds.length === 0) return active
  const excluded = new Set(input.excludeUserIds)
  return active.filter((userId) => !excluded.has(userId))
}

export type NotificationRecipientClient = Pick<
  Prisma.TransactionClient,
  | 'request_approvals'
  | 'solution_approvals'
  | 'approval_candidate_group_members'
  | 'user'
  | 'requests'
  | 'departments'
  | 'department_approvers'
  | 'organization_units'
  | 'organization_position_assignments'
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
            requiredLevel: true,
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
          requiredLevel: row.requiredLevel,
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
          requiredLevel: true,
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
        requiredLevel: row.requiredLevel,
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

    async findLegacyApproverIds(input) {
      if (input.phase === 'SOLUTION') {
        const engineeringDept = await client.departments.findFirst({
          where: { type: 'ENGINEERING' },
          select: { id: true },
        })
        if (!engineeringDept) return []
        const users = await client.user.findMany({
          where: {
            departmentId: engineeringDept.id,
            level: input.requiredLevel,
            isActive: true,
          },
          select: { id: true },
        })
        return users.map((user) => user.id)
      }

      const request = await client.requests.findUnique({
        where: { id: input.requestId },
        select: { departmentId: true },
      })
      if (!request?.departmentId) return []

      if (input.phase === 'FINAL') {
        const users = await client.user.findMany({
          where: {
            departmentId: request.departmentId,
            level: input.requiredLevel,
            isActive: true,
          },
          select: { id: true },
        })
        return users.map((user) => user.id)
      }

      const [internalUsers, externalApprovers] = await Promise.all([
        client.user.findMany({
          where: {
            departmentId: request.departmentId,
            level: input.requiredLevel,
            isActive: true,
          },
          select: { id: true },
        }),
        client.department_approvers.findMany({
          where: {
            departmentId: request.departmentId,
            approverLevel: input.requiredLevel,
          },
          select: { approverId: true },
        }),
      ])
      return uniqueIds([
        ...internalUsers.map((user) => user.id),
        ...externalApprovers.map((row) => row.approverId),
      ])
    },

    async findCustomRecipientIds(approvalId) {
      const requestRow = await client.request_approvals.findUnique({
        where: { id: approvalId },
        select: { requiredApproverId: true },
      })
      if (requestRow?.requiredApproverId) return [requestRow.requiredApproverId]

      const solutionRow = await client.solution_approvals.findUnique({
        where: { id: approvalId },
        select: { requiredApproverId: true },
      })
      if (solutionRow?.requiredApproverId) return [solutionRow.requiredApproverId]
      return []
    },

    async findReviewedSectionRecipientIds(input) {
      if (input.legacyDepartmentId === null) {
        const request = await client.requests.findUnique({
          where: { id: input.requestId },
          select: { organizationUnitId: true },
        })
        if (!request?.organizationUnitId) return []
        const assignments = await client.organization_position_assignments.findMany({
          where: { unitId: request.organizationUnitId, isActive: true },
          select: { userId: true },
        })
        return uniqueIds(assignments.map((assignment) => assignment.userId))
      }

      const mappedUnit = await client.organization_units.findFirst({
        where: { legacyDepartmentId: input.legacyDepartmentId },
        select: { id: true },
      })
      if (mappedUnit) {
        const assignments = await client.organization_position_assignments.findMany({
          where: { unitId: mappedUnit.id, isActive: true },
          select: { userId: true },
        })
        return uniqueIds(assignments.map((assignment) => assignment.userId))
      }

      const users = await client.user.findMany({
        where: { departmentId: input.legacyDepartmentId, isActive: true },
        select: { id: true },
      })
      return users.map((user) => user.id)
    },
  }
}
