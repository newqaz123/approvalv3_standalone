import type { OrganizationPositionCode, ReportingBranch } from '@/lib/organization/types'
import type { ApprovalPhase, ResolvedApprovalRoute, RouteResolutionContext } from '@/lib/approval-routes/types'

/**
 * Routing discriminator persisted on every approval row (Task 2 schema:
 * `routingMode` + `integrityVersion`). Version 0 rows are legacy-compatible
 * and never SNAPSHOT_GROUP; NEW instance persistence writes version 1.
 */
export type ApprovalRoutingMode = 'LEGACY_LEVEL' | 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'

export type ApprovalInstanceState =
  | 'PENDING'
  | 'AUTO_APPROVED'
  | 'COMPLETED_NO_ELIGIBLE_STEPS'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'SUPERSEDED'

export type ApprovalSkipReason = 'VACANT_POSITION'

export type PhaseOriginSource = 'REQUESTER' | 'SOLUTION_SUBMITTER' | 'FINAL_INITIATOR'

/**
 * Resolved routing origin for one phase attempt. `branch` is the reporting
 * branch of the stored document origin (requester, solution submitter) or the
 * authenticated final initiator. `requestDepartmentId` is nullable legacy
 * context only and is never a NEW routing source.
 */
export interface PhaseOrigin {
  phase: ApprovalPhase
  originUserId: string
  originUnitId: string
  branch: ReportingBranch
  originalRequestId: string
  requestDepartmentId: string | null
  source: PhaseOriginSource
}

export interface PhaseOriginQuery {
  phase: ApprovalPhase
  /** Owning request id (REQUEST/FINAL) or owning request for SOLUTION. */
  requestId: string
  /** Required for the SOLUTION phase: the solution document id. */
  solutionId?: string
  /**
   * Authenticated trusted action input only (final initiator). For
   * REQUEST/SOLUTION the stored document identity wins and a mismatched value
   * is rejected; production adapters never trust a client-controlled origin.
   */
  originUserId?: string
}

export interface ApprovalStepPlan {
  order: number
  requiredPosition?: OrganizationPositionCode
  requiredApproverId?: string
  scopeUnitId?: string
  candidateUserIds: readonly string[]
}

export interface ApprovalSkipPlan {
  requiredPosition: OrganizationPositionCode
  reason: ApprovalSkipReason
}

/** Copied origin context persisted with every NEW instance (version-1 JSON). */
export interface ApprovalInstanceOriginContext {
  position: OrganizationPositionCode
  assignmentId: string
  unitPath: readonly string[]
  groupPath: readonly string[]
  labels: Readonly<Record<string, string>>
}

/**
 * Detached, immutable plan for one NEW approval instance attempt. The pure
 * builder never writes; `persistApprovalInstance` persists it separately.
 */
export interface ApprovalInstancePlan {
  phase: ApprovalPhase
  requestId?: string
  solutionId?: string
  routeVersionId?: string
  originUserId: string
  originUnitId: string
  originContext: ApprovalInstanceOriginContext
  routingMode: ApprovalRoutingMode
  attempt: number
  state: ApprovalInstanceState
  completionReason?: 'NO_ELIGIBLE_APPROVAL_STEPS'
  steps: readonly ApprovalStepPlan[]
  skipped: readonly ApprovalSkipPlan[]
}

/** Immutable candidate-group snapshot copied out of the live organization. */
export interface CandidateGroupSnapshot {
  requiredPosition: OrganizationPositionCode
  scopeUnitId: string
  candidateUserIds: readonly string[]
  capturedAt: Date
}

/**
 * Engine read boundary. Production adapter: `createApprovalEngineDb(tx)`;
 * tests use structural fakes (never Prisma). All reads must observe the same
 * transaction snapshot as the writes of the enclosing caller transaction.
 */
export interface ApprovalEngineDb {
  resolvePhaseOrigin(input: PhaseOriginQuery): Promise<PhaseOrigin>
  resolvePublishedRoute(context: RouteResolutionContext): Promise<ResolvedApprovalRoute>
  findCandidates(input: {
    branch: ReportingBranch
    requiredPosition: OrganizationPositionCode
    scopeUnitId: string
  }): Promise<Array<{ id: string; isActive: boolean }>>
}

export interface BuildApprovalInstanceInput {
  /** Owning request id (REQUEST/FINAL); owning request id for SOLUTION. */
  requestId: string
  /** Required for the SOLUTION phase: the solution document id. */
  solutionId?: string
  phase: ApprovalPhase
  /** Authenticated trusted actor (final initiator for FINAL). */
  originUserId: string
  originalRequestId: string
  /** Nullable legacy context only; never a NEW routing source. */
  requestDepartmentId: string | null
}
