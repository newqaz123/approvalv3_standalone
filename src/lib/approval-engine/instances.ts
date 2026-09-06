import type { Prisma } from '@prisma/client'
import { ORGANIZATION_POSITION_LEVEL } from '@/lib/organization/types'
import type { OrganizationPositionCode, OrganizationPositionLevel, ReportingBranch } from '@/lib/organization/types'
import { resolveReportingBranch } from '@/lib/organization/repository'
import type { ApprovalPhase, ApprovalRouteDb, ApprovalRouteStatus, ApprovalRouteVersionDefinition, RouteResolutionContext } from '@/lib/approval-routes/types'
import { resolvePublishedApprovalRoute } from '@/lib/approval-routes/resolver'
import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/validation'
import { dedupeCandidateIds, snapshotCandidateGroup, stepScopeUnitId } from './candidate-groups'
import { resolvePhaseOrigin } from './phase-origin'
import type { PhaseOriginRepository } from './phase-origin'
import type {
  ApprovalEngineDb,
  ApprovalInstanceOriginContext,
  ApprovalInstancePlan,
  ApprovalSkipPlan,
  ApprovalStepPlan,
  ApprovalInstanceState,
  BuildApprovalInstanceInput,
} from './types'

/**
 * Isolation level every NEW approval-instance transaction must run under
 * (Task 2 isolation ruling: the resolver and persistence read and write the
 * same SERIALIZABLE snapshot through the caller transaction; READ COMMITTED
 * with FOR SHARE coordination is the legacy-compatible alternative for
 * strictly scoped writers). Callers pass this to their interactive
 * transaction; this module never opens transactions and never retries.
 */
export const APPROVAL_ENGINE_TRANSACTION_ISOLATION = 'Serializable' as const

/**
 * Distinct retryable conflict for NEW instance resolution/persistence.
 * Raised when the database rejects the transaction with a serialization
 * failure (Prisma P2034 / PostgreSQL 40001). Callers may surface it for a
 * whole-action retry; `persistApprovalInstance` itself never retries and
 * never persists mixed metadata versions.
 */
export class ApprovalEngineConflictError extends Error {
  readonly code = 'APPROVAL_ENGINE_CONFLICT'

  constructor(message = 'Approval instance transaction conflicted with a concurrent write; retry the action') {
    super(message)
    this.name = 'ApprovalEngineConflictError'
  }
}

function isSerializationConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code === 'P2034' || code === '40001') return true
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && /could not serialize|serialization failure|40001/i.test(message)
}

function translateConflict(error: unknown): never {
  if (isSerializationConflict(error)) throw new ApprovalEngineConflictError()
  throw error
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function planDocumentIds(input: BuildApprovalInstanceInput): { requestId?: string; solutionId?: string } {
  if (input.phase === 'SOLUTION') {
    if (!input.solutionId) {
      throw new ApprovalRouteConfigurationError('Solution phase requires the solution document id')
    }
    return { solutionId: input.solutionId }
  }
  return { requestId: input.requestId }
}

/**
 * Pure NEW-instance builder. Resolves the phase origin and nearest published
 * route, excludes positions at or below the origin, applies the ceiling,
 * auto-approves origins at or above the ceiling, snapshots the candidate
 * group of every remaining step from the origin branch only, skips vacant
 * groups with an audit reason and completes with
 * NO_ELIGIBLE_APPROVAL_STEPS when no pending step remains. It never writes:
 * the returned plan is detached and frozen, and candidate IDs are copied so
 * later organization edits cannot change it.
 */
export async function buildNormalApprovalInstance(
  db: ApprovalEngineDb,
  input: BuildApprovalInstanceInput,
): Promise<ApprovalInstancePlan> {
  const origin = await db.resolvePhaseOrigin({
    phase: input.phase,
    requestId: input.requestId,
    solutionId: input.solutionId,
    originUserId: input.originUserId,
  })
  const resolved = await db.resolvePublishedRoute({
    phase: input.phase,
    originUserId: origin.originUserId,
    originUnitId: origin.originUnitId,
    requestId: input.requestId,
    originalRequestId: input.originalRequestId,
    // Legacy context only: never consulted for NEW scope or candidates.
    requestDepartmentId: input.requestDepartmentId,
  })

  const originContext: ApprovalInstanceOriginContext = deepFreeze({
    position: origin.branch.primaryPosition,
    assignmentId: origin.branch.primaryAssignmentId,
    unitPath: Object.freeze([...origin.branch.unitPath]),
    groupPath: Object.freeze([...origin.branch.groupPath]),
    labels: Object.freeze({}),
  })
  const base = {
    phase: input.phase,
    ...planDocumentIds(input),
    routeVersionId: resolved.id,
    originUserId: origin.originUserId,
    originUnitId: origin.originUnitId,
    originContext,
    routingMode: 'SNAPSHOT_GROUP' as const,
    attempt: 1,
  }

  // Auto-approval is decided by the builder from the origin position and the
  // route ceiling: at or above the ceiling there are no pending steps and the
  // adapter records the approved self-row and phase transition.
  const originLevel = ORGANIZATION_POSITION_LEVEL[origin.branch.primaryPosition]
  if (originLevel >= resolved.maximumPositionLevel) {
    return deepFreeze<ApprovalInstancePlan>({ ...base, state: 'AUTO_APPROVED', steps: [], skipped: [] })
  }

  const steps: ApprovalStepPlan[] = []
  const skipped: ApprovalSkipPlan[] = []
  for (const step of resolved.steps) {
    const level = ORGANIZATION_POSITION_LEVEL[step.position]
    // Positions at or below the initiator never route; publication validation
    // already enforces the ceiling, re-checked defensively here.
    if (level <= originLevel || level > resolved.maximumPositionLevel) continue
    const scopeUnitId = stepScopeUnitId(origin.branch, step.position)
    const found = await db.findCandidates({ branch: origin.branch, requiredPosition: step.position, scopeUnitId })
    const candidateUserIds = dedupeCandidateIds(
      found.filter((candidate) => candidate.isActive).map((candidate) => candidate.id),
    )
    if (candidateUserIds.length === 0) {
      skipped.push({ requiredPosition: step.position, reason: 'VACANT_POSITION' })
      continue
    }
    steps.push({
      order: step.order,
      requiredPosition: step.position,
      scopeUnitId,
      candidateUserIds: Object.freeze(candidateUserIds),
    })
  }

  if (steps.length === 0) {
    return deepFreeze<ApprovalInstancePlan>({
      ...base,
      state: 'COMPLETED_NO_ELIGIBLE_STEPS',
      completionReason: 'NO_ELIGIBLE_APPROVAL_STEPS',
      steps: [],
      skipped: Object.freeze(skipped),
    })
  }

  return deepFreeze<ApprovalInstancePlan>({
    ...base,
    state: 'PENDING',
    steps: Object.freeze(steps.map((step) => deepFreeze(step))),
    skipped: Object.freeze(skipped),
  })
}

// ---------------------------------------------------------------------------
// Persistence (version-1 metadata only)
// ---------------------------------------------------------------------------

export interface ApprovalInstanceRowCreate {
  requestId: string | null
  solutionId: string | null
  phase: ApprovalPhase
  routeVersionId: string | null
  originUserId: string
  originUnitId: string
  originContext: ApprovalInstanceOriginContext
  routingMode: 'SNAPSHOT_GROUP'
  state: ApprovalInstanceState
  attempt: number
  completionReason: string | null
}

export interface ApprovalInstanceSkipRowCreate {
  approvalInstanceId: string
  requiredPosition: OrganizationPositionCode
  reason: 'VACANT_POSITION'
}

export interface ApprovalCandidateGroupRowCreate {
  approvalInstanceId: string
  requiredPosition: OrganizationPositionCode
  scopeUnitId: string
  capturedAt: Date
}

export interface ApprovalCandidateGroupMemberRowCreate {
  candidateGroupId: string
  userId: string
  capturedAt: Date
  capturedDisplayName: string
}

interface ApprovalRowCreateBase {
  approverId: string | null
  requiredLevel: null
  order: number
  status: 'pending' | 'approved'
  comments: null
  approvedAt: Date | null
  isCustomChain: false
  requiredApproverId: null
  instanceId: string
  requiredPosition: OrganizationPositionCode
  candidateGroupId: string | null
  routingMode: 'SNAPSHOT_GROUP'
  integrityVersion: 1
}

export interface RequestApprovalRowCreate extends ApprovalRowCreateBase {
  requestId: string
  isFinalApproval: boolean
}

export interface SolutionApprovalRowCreate extends ApprovalRowCreateBase {
  solutionId: string
}

/**
 * Structural persistence port satisfied by `Prisma.TransactionClient` and by
 * recording test fakes. NEW rows are always written with
 * `routingMode: 'SNAPSHOT_GROUP'` and `integrityVersion: 1`, exactly the
 * strict metadata the Task 2 row-mode CHECK enforces; legacy writers stay on
 * version 0 and are never touched here.
 */
export interface ApprovalInstanceTx {
  user: {
    findMany(args: {
      where: { id: { in: string[] } }
      select: { id: true; name: true }
    }): Promise<Array<{ id: string; name: string }>>
  }
  approval_instances: {
    findFirst(args: {
      where: { requestId?: string; solutionId?: string; phase: ApprovalPhase }
      orderBy: { attempt: 'desc' }
      select: { attempt: true }
    }): Promise<{ attempt: number } | null>
    create(args: { data: ApprovalInstanceRowCreate }): Promise<{ id: string }>
  }
  approval_instance_skips: {
    create(args: { data: ApprovalInstanceSkipRowCreate }): Promise<unknown>
  }
  approval_candidate_groups: {
    create(args: { data: ApprovalCandidateGroupRowCreate }): Promise<{ id: string }>
  }
  approval_candidate_group_members: {
    create(args: { data: ApprovalCandidateGroupMemberRowCreate }): Promise<unknown>
  }
  request_approvals: {
    create(args: { data: RequestApprovalRowCreate }): Promise<unknown>
  }
  solution_approvals: {
    create(args: { data: SolutionApprovalRowCreate }): Promise<unknown>
  }
}

/**
 * Persists a detached plan through the CALLER's transaction: the instance
 * row with copied origin context, one candidate group per step with captured
 * display labels, one version-1 SNAPSHOT_GROUP approval row per step (or the
 * group-less approved self-audit row for AUTO_APPROVED instances) and one
 * audit row per skipped position. The input plan is never mutated. The
 * attempt number advances the document+phase attempt history. Serialization
 * conflicts surface as `ApprovalEngineConflictError`; there is no retry.
 */
export async function persistApprovalInstance(
  tx: ApprovalInstanceTx,
  plan: ApprovalInstancePlan,
): Promise<ApprovalInstancePlan & { id: string }> {
  try {
    const attempt = await nextAttemptNumber(tx, plan)
    const labels = await loadDisplayLabels(tx, [
      plan.originUserId,
      ...plan.steps.flatMap((step) => [...step.candidateUserIds]),
    ])
    const storedContext: ApprovalInstanceOriginContext = {
      position: plan.originContext.position,
      assignmentId: plan.originContext.assignmentId,
      unitPath: [...plan.originContext.unitPath],
      groupPath: [...plan.originContext.groupPath],
      labels,
    }
    const instance = await tx.approval_instances.create({
      data: {
        requestId: plan.phase === 'SOLUTION' ? null : requireDocumentId(plan),
        solutionId: plan.phase === 'SOLUTION' ? requireSolutionId(plan) : null,
        phase: plan.phase,
        routeVersionId: plan.routeVersionId ?? null,
        originUserId: plan.originUserId,
        originUnitId: plan.originUnitId,
        originContext: storedContext,
        routingMode: 'SNAPSHOT_GROUP',
        state: plan.state,
        attempt,
        completionReason: plan.completionReason ?? null,
      },
    })

    if (plan.state === 'AUTO_APPROVED') {
      // Group-less version-1 snapshot row: valid only as the approved
      // self-audit row of this AUTO_APPROVED instance (enforced by the
      // deferred group-less snapshot audit triggers at commit).
      const selfRow: ApprovalRowCreateBase = {
        approverId: plan.originUserId,
        requiredLevel: null,
        order: 1,
        status: 'approved',
        comments: null,
        approvedAt: new Date(),
        isCustomChain: false,
        requiredApproverId: null,
        instanceId: instance.id,
        requiredPosition: plan.originContext.position,
        candidateGroupId: null,
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
      }
      if (plan.phase === 'SOLUTION') {
        await tx.solution_approvals.create({
          data: { ...selfRow, solutionId: requireSolutionId(plan) },
        })
      } else {
        await tx.request_approvals.create({
          data: {
            ...selfRow,
            requestId: requireDocumentId(plan),
            isFinalApproval: plan.phase === 'FINAL',
          },
        })
      }
      return { ...plan, attempt, id: instance.id }
    }

    const isFinalPhase = plan.phase === 'FINAL'
    for (const [index, step] of plan.steps.entries()) {
      if (!step.requiredPosition || !step.scopeUnitId) {
        throw new ApprovalRouteConfigurationError(`Approval step ${step.order} is missing its position or scope`)
      }
      const snapshot = snapshotCandidateGroup({
        requiredPosition: step.requiredPosition,
        scopeUnitId: step.scopeUnitId,
        candidateUserIds: step.candidateUserIds,
      })
      const group = await tx.approval_candidate_groups.create({
        data: {
          approvalInstanceId: instance.id,
          requiredPosition: snapshot.requiredPosition,
          scopeUnitId: snapshot.scopeUnitId,
          capturedAt: snapshot.capturedAt,
        },
      })
      const row: ApprovalRowCreateBase = {
        approverId: null,
        requiredLevel: null,
        order: step.order,
        status: 'pending',
        comments: null,
        approvedAt: null,
        isCustomChain: false,
        requiredApproverId: null,
        instanceId: instance.id,
        requiredPosition: snapshot.requiredPosition,
        candidateGroupId: group.id,
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
      }
      for (const userId of snapshot.candidateUserIds) {
        await tx.approval_candidate_group_members.create({
          data: {
            candidateGroupId: group.id,
            userId,
            capturedAt: snapshot.capturedAt,
            capturedDisplayName: labels[userId] ?? userId,
          },
        })
      }
      if (plan.phase === 'SOLUTION') {
        await tx.solution_approvals.create({
          data: { ...row, solutionId: requireSolutionId(plan) },
        })
      } else {
        await tx.request_approvals.create({
          data: {
            ...row,
            requestId: requireDocumentId(plan),
            isFinalApproval: isFinalPhase && index === plan.steps.length - 1,
          },
        })
      }
    }

    for (const skip of plan.skipped) {
      await tx.approval_instance_skips.create({
        data: {
          approvalInstanceId: instance.id,
          requiredPosition: skip.requiredPosition,
          reason: skip.reason,
        },
      })
    }

    return { ...plan, attempt, id: instance.id }
  } catch (error) {
    translateConflict(error)
  }
}

function requireDocumentId(plan: ApprovalInstancePlan): string {
  if (!plan.requestId) {
    throw new ApprovalRouteConfigurationError(`Approval instance plan for phase ${plan.phase} is missing its request id`)
  }
  return plan.requestId
}

function requireSolutionId(plan: ApprovalInstancePlan): string {
  if (!plan.solutionId) {
    throw new ApprovalRouteConfigurationError('Approval instance plan for the SOLUTION phase is missing its solution id')
  }
  return plan.solutionId
}

async function nextAttemptNumber(tx: ApprovalInstanceTx, plan: ApprovalInstancePlan): Promise<number> {
  const where = plan.phase === 'SOLUTION'
    ? { solutionId: requireSolutionId(plan), phase: plan.phase }
    : { requestId: requireDocumentId(plan), phase: plan.phase }
  const latest = await tx.approval_instances.findFirst({
    where,
    orderBy: { attempt: 'desc' },
    select: { attempt: true },
  })
  return (latest?.attempt ?? 0) + 1
}

async function loadDisplayLabels(
  tx: ApprovalInstanceTx,
  userIds: readonly string[],
): Promise<Record<string, string>> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return {}
  const users = await tx.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })
  return Object.fromEntries(users.map((user) => [user.id, user.name]))
}

// ---------------------------------------------------------------------------
// Production adapter
// ---------------------------------------------------------------------------

interface ApprovalCandidateTx {
  user: {
    findMany(args: {
      where: { id: { in: string[] } }
      select: { id: true; isActive: true }
    }): Promise<Array<{ id: string; isActive: boolean }>>
  }
  reporting_group_members: {
    findMany(args: {
      where: { reportingGroupId: { in: string[] } }
      select: { userId: true }
    }): Promise<Array<{ userId: string }>>
  }
  organization_position_assignments: {
    findMany(args: {
      where: {
        positionCode: OrganizationPositionCode
        unitId?: string
        reportingGroupId?: { in: string[] }
        isActive: true
        isPrimary: true
      }
      select: { userId: true }
    }): Promise<Array<{ userId: string }>>
  }
}

interface ApprovalRouteSourceTx {
  approval_route_versions: {
    findMany(args: {
      where: { scopeUnitId: { in: string[] }; phase: ApprovalPhase }
    }): Promise<Array<{ id: string; scopeUnitId: string; phase: ApprovalPhase; version: number; maximumPositionLevel: number; status: ApprovalRouteStatus }>>
  }
  approval_route_steps: {
    findMany(args: {
      where: { routeVersionId: { in: string[] } }
      orderBy: { stepOrder: 'asc' }
    }): Promise<Array<{ routeVersionId: string; stepOrder: number; positionCode: OrganizationPositionCode }>>
  }
}

/**
 * Narrows the persisted ceiling to the domain ladder with a fail-closed
 * runtime guard: a stored route outside 1..6 is a configuration error, never
 * silently coerced.
 */
function toPositionLevel(value: number, routeId: string): OrganizationPositionLevel {
  if (Number.isInteger(value) && value >= 1 && value <= 6) return value as OrganizationPositionLevel
  throw new ApprovalRouteConfigurationError(`Route version ${routeId} has an invalid maximum position level: ${String(value)}`)
}

/**
 * Candidate pools are holders of the required position only:
 * - Reporting positions (levels 1-2: STAFF/SUPERVISOR) resolve to ACTIVE
 *   primary assignments of `requiredPosition` whose `reportingGroupId` is on
 *   the origin branch's reporting-group path, intersected with membership of
 *   those groups. Group members without the position (including peer staff
 *   and the origin) are never candidates, and sibling groups are never
 *   queried.
 * - Manager positions (3-6) draw holders with an active primary assignment of
 *   the position at the resolved scope unit.
 * User accounts are looked up afterwards and returned with their
 * `isActive` flag so the builder can exclude inactive users and treat an
 * all-inactive group as vacant.
 */
async function findCandidates(
  tx: ApprovalCandidateTx,
  input: { branch: ReportingBranch; requiredPosition: OrganizationPositionCode; scopeUnitId: string },
): Promise<Array<{ id: string; isActive: boolean }>> {
  const level = ORGANIZATION_POSITION_LEVEL[input.requiredPosition]
  const userIds = level <= 2
    ? await reportingGroupPositionHolderIds(tx, input)
    : await unitScopedPositionHolderIds(tx, input)
  if (userIds.length === 0) return []
  const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, isActive: true } })
  return users.map((user) => ({ id: user.id, isActive: user.isActive }))
}

async function reportingGroupPositionHolderIds(
  tx: ApprovalCandidateTx,
  input: { branch: ReportingBranch; requiredPosition: OrganizationPositionCode },
): Promise<string[]> {
  const groupIds = [...input.branch.groupPath]
  const assignments = await tx.organization_position_assignments.findMany({
    where: {
      positionCode: input.requiredPosition,
      reportingGroupId: { in: groupIds },
      isActive: true,
      isPrimary: true,
    },
    select: { userId: true },
  })
  if (assignments.length === 0) return []
  const members = await tx.reporting_group_members.findMany({
    where: { reportingGroupId: { in: groupIds } },
    select: { userId: true },
  })
  const memberIds = new Set(members.map((member) => member.userId))
  return assignments.map((assignment) => assignment.userId).filter((userId) => memberIds.has(userId))
}

async function unitScopedPositionHolderIds(
  tx: ApprovalCandidateTx,
  input: { requiredPosition: OrganizationPositionCode; scopeUnitId: string },
): Promise<string[]> {
  const assignments = await tx.organization_position_assignments.findMany({
    where: {
      positionCode: input.requiredPosition,
      unitId: input.scopeUnitId,
      isActive: true,
      isPrimary: true,
    },
    select: { userId: true },
  })
  return assignments.map((assignment) => assignment.userId)
}

function loadPublishedRoutes(
  tx: ApprovalRouteSourceTx,
  input: { scopeUnitIds: readonly string[]; phase: ApprovalPhase },
): Promise<ApprovalRouteVersionDefinition[]> {
  const scopeUnitIds = [...input.scopeUnitIds]
  const load = async () => {
    const versions = await tx.approval_route_versions.findMany({
      where: { scopeUnitId: { in: scopeUnitIds }, phase: input.phase },
    })
    if (versions.length === 0) return []
    const steps = await tx.approval_route_steps.findMany({
      where: { routeVersionId: { in: versions.map((version) => version.id) } },
      orderBy: { stepOrder: 'asc' },
    })
    return versions.map((version) => ({
      id: version.id,
      scopeUnitId: version.scopeUnitId,
      phase: version.phase,
      version: version.version,
      maximumPositionLevel: toPositionLevel(version.maximumPositionLevel, version.id),
      status: version.status,
      steps: steps
        .filter((step) => step.routeVersionId === version.id)
        .map((step) => ({ order: step.stepOrder, position: step.positionCode })),
    }))
  }
  return load()
}

/**
 * Production engine adapter over a Prisma transaction client. It wraps the
 * client into the `ApprovalEngineDb` boundary (never casts Prisma itself to
 * the port), derives every origin from stored document identities plus
 * authenticated trusted action input, and reads candidates and routes from
 * the same transaction snapshot as the caller's writes. Run callers under
 * `APPROVAL_ENGINE_TRANSACTION_ISOLATION`.
 */
export function createApprovalEngineDb(tx: Prisma.TransactionClient): ApprovalEngineDb {
  const routeDb: ApprovalRouteDb = {
    loadOriginBranch: (userId) => resolveReportingBranch(userId, tx),
    loadPublishedRoutes: (input) => loadPublishedRoutes(tx, input),
  }
  return {
    resolvePhaseOrigin: (query) => resolvePhaseOrigin(tx, query),
    resolvePublishedRoute: (context: RouteResolutionContext) => resolvePublishedApprovalRoute(context, routeDb),
    findCandidates: (input) => findCandidates(tx, input),
  }
}
