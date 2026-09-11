// Clean-start approval-route definition + validation (Plan B Task 2).
// Own step/version types (positionId + named limit). ApprovalPhase is the
// canonical union owned here; the old approval-routes/{types,validation,resolver}
// modules were deleted in Task 15.

import type { PositionNode } from '@/lib/organization/model'

export type ApprovalPhase = 'REQUEST' | 'SOLUTION' | 'FINAL'

export interface ApprovalRouteStepDefinition {
  order: number
  positionId: string
}

export interface ApprovalRouteVersionDefinition {
  id: string
  scopeUnitId: string
  phase: ApprovalPhase
  version: number
  approvalLimitPositionId: string
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
  steps: readonly ApprovalRouteStepDefinition[]
}

export class ApprovalRouteConfigurationError extends Error {
  readonly code = 'APPROVAL_ROUTE_CONFIGURATION'

  constructor(message: string) {
    super(message)
    this.name = 'ApprovalRouteConfigurationError'
  }
}

export function findLimitConflicts(
  def: ApprovalRouteVersionDefinition,
  positions: ReadonlyMap<string, PositionNode>,
): ReadonlyArray<{ order: number; positionId: string; problem: 'EXCEEDS_LIMIT' }> {
  const limit = positions.get(def.approvalLimitPositionId)
  if (limit === undefined) return []
  const conflicts: Array<{ order: number; positionId: string; problem: 'EXCEEDS_LIMIT' }> = []
  for (const step of def.steps) {
    const position = positions.get(step.positionId)
    if (position !== undefined && position.rank > limit.rank) {
      conflicts.push({ order: step.order, positionId: step.positionId, problem: 'EXCEEDS_LIMIT' })
    }
  }
  return conflicts
}

export function validateRouteDefinition(
  def: ApprovalRouteVersionDefinition,
  positions: ReadonlyMap<string, PositionNode>,
): void {
  const limit = positions.get(def.approvalLimitPositionId)
  if (limit === undefined) {
    throw new ApprovalRouteConfigurationError(`Unknown approval limit position: ${def.approvalLimitPositionId}`)
  }
  if (!limit.isActive) {
    throw new ApprovalRouteConfigurationError(`Inactive approval limit position: ${def.approvalLimitPositionId}`)
  }

  const seen = new Set<string>()
  let previousRank: number | undefined
  def.steps.forEach((step, index) => {
    if (!Number.isInteger(step.order) || step.order !== index + 1) {
      throw new ApprovalRouteConfigurationError('Route step orders must be contiguous integers 1..n')
    }
    const position = positions.get(step.positionId)
    if (position === undefined) {
      throw new ApprovalRouteConfigurationError(`Unknown route position: ${step.positionId}`)
    }
    if (!position.isActive) {
      throw new ApprovalRouteConfigurationError(`Inactive route position: ${step.positionId}`)
    }
    if (seen.has(step.positionId)) {
      throw new ApprovalRouteConfigurationError(`Duplicate route position: ${step.positionId}`)
    }
    seen.add(step.positionId)
    if (previousRank !== undefined && position.rank <= previousRank) {
      throw new ApprovalRouteConfigurationError('Route positions must be strictly ascending')
    }
    previousRank = position.rank
    if (position.rank > limit.rank) {
      throw new ApprovalRouteConfigurationError(`Route position ${step.positionId} exceeds the configured limit`)
    }
  })
}
