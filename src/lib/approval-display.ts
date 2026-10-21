import type { Prisma } from '@prisma/client'

/** Both request/final and solution detail queries need the same immutable display evidence. */
export const APPROVAL_DISPLAY_SELECT = {
  candidateGroupId: true,
  routingMode: true,
  requiredPositionRef: { select: { name: true, rank: true } },
  candidateGroup: {
    select: {
      members: {
        select: { userId: true, capturedDisplayName: true },
        orderBy: { userId: 'asc' },
      },
    },
  },
} as const satisfies Prisma.request_approvalsSelect & Prisma.solution_approvalsSelect

type ApprovalDisplayRow = {
  routingMode?: string
  requiredLevel?: number | null
  isCustomChain?: boolean
  requiredPositionRef?: { name: string; rank: number } | null
  candidateGroup?: { members: Array<{ capturedDisplayName: string }> } | null
  potentialApprovers?: Array<{ name: string | null }>
}

/** Display only: never resolve live memberships or confer action authority. */
export function withApprovalDisplay<T extends ApprovalDisplayRow>(approval: T) {
  return {
    ...approval,
    requiredLevel: approval.requiredPositionRef?.rank ?? approval.requiredLevel ?? 0,
    requiredPositionName: approval.requiredPositionRef?.name ?? null,
    isCustomChain: approval.routingMode === undefined
      ? Boolean(approval.isCustomChain)
      : approval.routingMode === 'CUSTOM_PERSON',
    potentialApprovers: approval.candidateGroup
      ? approval.candidateGroup.members.map(member => ({ name: member.capturedDisplayName }))
      : approval.potentialApprovers ?? [],
  }
}
