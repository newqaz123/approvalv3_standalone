import type { ReportingBranch } from '@/lib/organization/types'
import type {
  ApprovalRouteDb,
  ApprovalRouteVersionDefinition,
  ApprovalPhase,
  ResolvedApprovalRoute,
  RouteResolutionContext,
} from './types'
import { ApprovalRouteConfigurationError, validateRouteDefinition } from './validation'

export function selectNearestPublishedRoute(
  ancestorScopeIds: readonly string[],
  routes: readonly ApprovalRouteVersionDefinition[],
  phase: ApprovalPhase,
): ApprovalRouteVersionDefinition {
  for (const scopeUnitId of ancestorScopeIds) {
    const matches = routes.filter((route) =>
      route.scopeUnitId === scopeUnitId && route.phase === phase && route.status === 'PUBLISHED',
    )
    if (matches.length > 1) {
      throw new ApprovalRouteConfigurationError(`Ambiguous published route for ${scopeUnitId}:${phase}`)
    }
    if (matches.length === 1) return matches[0]
  }
  throw new ApprovalRouteConfigurationError(`No published route for ${phase} in the origin branch`)
}

function validateOriginBranch(context: RouteResolutionContext, branch: ReportingBranch): readonly string[] {
  if (branch.originUserId !== context.originUserId || branch.primaryUnitId !== context.originUnitId) {
    throw new ApprovalRouteConfigurationError('Origin user and unit do not match the reporting branch')
  }
  if (!Array.isArray(branch.unitPath) || branch.unitPath.length === 0 || branch.unitPath[0] !== branch.primaryUnitId) {
    throw new ApprovalRouteConfigurationError('Origin reporting branch has a malformed unit path')
  }
  if (new Set(branch.unitPath).size !== branch.unitPath.length) {
    throw new ApprovalRouteConfigurationError('Origin reporting branch has duplicate scopes')
  }
  return [...branch.unitPath]
}

export async function resolvePublishedApprovalRoute(
  context: RouteResolutionContext,
  db: ApprovalRouteDb,
): Promise<ResolvedApprovalRoute> {
  const branch = await db.loadOriginBranch(context.originUserId)
  if (!branch) throw new ApprovalRouteConfigurationError('No unambiguous origin reporting branch')
  const ancestorScopeIds = validateOriginBranch(context, branch)
  const routes = await db.loadPublishedRoutes({ scopeUnitIds: ancestorScopeIds, phase: context.phase })
  const selected = selectNearestPublishedRoute(ancestorScopeIds, routes, context.phase)
  validateRouteDefinition(selected)
  return { ...selected, steps: [...selected.steps], ancestorScopeIds }
}
