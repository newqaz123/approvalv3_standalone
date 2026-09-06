import type { OrganizationPositionCode, OrganizationPositionLevel, ReportingBranch } from '@/lib/organization/types'

export type ApprovalPhase = 'REQUEST' | 'SOLUTION' | 'FINAL'
export type ApprovalRouteStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED'

export interface ApprovalRouteStepDefinition {
  order: number
  position: OrganizationPositionCode
}

export interface ApprovalRouteVersionDefinition {
  id: string
  scopeUnitId: string
  phase: ApprovalPhase
  version: number
  maximumPositionLevel: OrganizationPositionLevel
  status: ApprovalRouteStatus
  steps: readonly ApprovalRouteStepDefinition[]
}

export interface RouteResolutionContext {
  phase: ApprovalPhase
  originUserId: string
  originUnitId: string
  requestId: string
  originalRequestId: string
  requestDepartmentId: string | null
}

export interface ApprovalRouteDb {
  loadOriginBranch(originUserId: string): Promise<ReportingBranch | null>
  loadPublishedRoutes(input: { scopeUnitIds: readonly string[]; phase: ApprovalPhase }): Promise<ApprovalRouteVersionDefinition[]>
}

export interface ResolvedApprovalRoute extends ApprovalRouteVersionDefinition {
  ancestorScopeIds: readonly string[]
}
