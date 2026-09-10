// Clean-start nearest published-route selection (Plan B Task 2).
// Walk own unit → ancestors → root. The first scope with any PUBLISHED
// route for the phase is the only candidate set: exactly one selects;
// more than one throws (invalid nearer fails, no fallback). DRAFT/RETIRED
// -only scopes are not configured. Structural ApprovalRouteDb port — no
// Prisma. Do not import ./validation or ./resolver.

import {
  ApprovalRouteConfigurationError,
  validateRouteDefinition,
} from './definition'
import type { ApprovalPhase, ApprovalRouteVersionDefinition } from './definition'
import type { PositionNode, ReportingPath } from '@/lib/organization/model'

export interface ApprovalRouteDb {
  loadOriginPath(originUserId: string): Promise<ReportingPath | null>
  loadRoutes(input: { scopeUnitIds: readonly string[]; phase: ApprovalPhase }): Promise<ApprovalRouteVersionDefinition[]>
  loadPositions(): Promise<PositionNode[]>
}

export interface ResolvedApprovalRoute extends ApprovalRouteVersionDefinition {
  ancestorScopeIds: readonly string[]
}

export function selectNearestRoute(
  ancestorScopeIds: readonly string[],
  routes: readonly ApprovalRouteVersionDefinition[],
  phase: ApprovalPhase,
): ApprovalRouteVersionDefinition {
  for (const scopeUnitId of ancestorScopeIds) {
    const published = routes.filter(
      (candidate) =>
        candidate.scopeUnitId === scopeUnitId
        && candidate.phase === phase
        && candidate.status === 'PUBLISHED',
    )
    if (published.length > 1) {
      throw new ApprovalRouteConfigurationError(`Ambiguous published route for ${scopeUnitId}:${phase}`)
    }
    if (published.length === 1) return published[0]
  }
  throw new ApprovalRouteConfigurationError(`No published route for ${phase} in the origin branch`)
}

function assertOriginPathMatchesContext(
  ctx: { originUserId: string; originUnitId: string },
  path: ReportingPath,
): readonly string[] {
  if (path.originUserId !== ctx.originUserId || path.unitId !== ctx.originUnitId) {
    throw new ApprovalRouteConfigurationError('Origin user and unit do not match the reporting path')
  }
  if (!Array.isArray(path.unitPath) || path.unitPath.length === 0 || path.unitPath[0] !== ctx.originUnitId) {
    throw new ApprovalRouteConfigurationError('Origin reporting path does not match the origin unit')
  }
  return [...path.unitPath]
}

export async function resolvePublishedApprovalRoute(
  ctx: { phase: ApprovalPhase; originUserId: string; originUnitId: string; requestId: string },
  db: ApprovalRouteDb,
): Promise<ResolvedApprovalRoute> {
  const path = await db.loadOriginPath(ctx.originUserId)
  if (path === null) {
    throw new ApprovalRouteConfigurationError('No origin reporting path')
  }
  const ancestorScopeIds = assertOriginPathMatchesContext(ctx, path)
  const routes = await db.loadRoutes({ scopeUnitIds: ancestorScopeIds, phase: ctx.phase })
  const selected = selectNearestRoute(ancestorScopeIds, routes, ctx.phase)
  const positions = await db.loadPositions()
  const positionMap: ReadonlyMap<string, PositionNode> = new Map(positions.map((position) => [position.id, position]))
  validateRouteDefinition(selected, positionMap)
  return {
    ...selected,
    steps: selected.steps.map((step) => ({ order: step.order, positionId: step.positionId })),
    ancestorScopeIds,
  }
}
