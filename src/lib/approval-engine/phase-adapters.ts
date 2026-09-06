/**
 * Task 8 phase adapters: create request, solution, and final approval
 * attempts against the NEW engine, with resubmission history, exact business
 * status transitions, and custom ordered-person attempts.
 *
 * Layering:
 * - The four exported `create*Attempt` functions implement the NEW-mode
 *   creation path (including supersession/wrapping of the previous attempt
 *   and the guarded status transition) over the `PhaseAdapterDb` port. They
 *   are the functions production flows call after the rollout gate selects
 *   the new mode, and the functions the regression fakes exercise.
 * - `createExistingLegacyAttempt` behavior stays with the existing
 *   phase-specific builders in the server actions (they own the legacy
 *   guards, attachments, and notifications); the rollout gate in each action
 *   dispatches to them for `legacy` and `shadow`, and to the adapters here
 *   for `new`. Importing the server-action builders from this module would
 *   create a `'use server'` import cycle.
 * - `compareNewResolutionWithoutWrites` (shadow) resolves the NEW plan
 *   through the pure engine only and reports problems instead of throwing.
 * - `assertNewCreationEnabled` (new) requires mode=new, a completed import
 *   digest, and current primary-assignment/route coverage for the actor.
 */
import type { Prisma, RequestStatus } from '@prisma/client'
import type { ApprovalPhase, ApprovalRouteDb, ApprovalRouteStatus } from '@/lib/approval-routes/types'
import { resolvePublishedApprovalRoute } from '@/lib/approval-routes/resolver'
import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/validation'
import { RequestStatusConflictError } from '@/lib/request-status-transition'
import { resolveReportingBranch } from '@/lib/organization/repository'
import { getApprovalRolloutMode } from '@/lib/approval-rollout'
import { buildNormalApprovalInstance, createApprovalEngineDb, persistApprovalInstance, type ApprovalInstanceTx } from './instances'
import { resolvePhaseOrigin } from './phase-origin'
import type {
  ApprovalEngineDb,
  ApprovalInstanceOriginContext,
  ApprovalInstancePlan,
  ApprovalInstanceState,
  ApprovalStepPlan,
  BuildApprovalInstanceInput,
} from './types'

/** Document identity a phase attempt is created for. */
export interface PhaseDocumentRef {
  requestId: string
  solutionId?: string
  phase: ApprovalPhase
}

/**
 * Engine read/write boundary for one phase attempt. Production adapter:
 * `createPrismaPhaseAdapterDb(tx)`; tests use structural fakes (never Prisma).
 */
export interface PhaseAdapterDb extends ApprovalEngineDb {
  loadRequestContext(requestId: string): Promise<{ status: RequestStatus; requesterId: string; departmentId: string | null; organizationUnitId: string | null }>
  loadCurrentAttempt(input: { requestId: string; solutionId?: string; phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): Promise<{ id: string; attempt: number; state: string } | null>
  persistApprovalInstance(plan: ApprovalInstancePlan): Promise<ApprovalInstancePlan & { id: string; attempt: number }>
  supersedeApprovalInstance(instanceId: string): Promise<void>
  updateRequestStatus(input: { requestId: string; from: RequestStatus; to: RequestStatus }): Promise<void>
}

export interface PhaseAttemptResult {
  instance: ApprovalInstancePlan & { id: string; attempt: number }
  statusChange?: { from: RequestStatus; to: RequestStatus }
  completedWithoutSteps: boolean
  autoApproved: boolean
}

/**
 * Current-instance identity filter for approval-row queries. Shared with the
 * lib workflow modules via `./current-instance` (dependency-free) and
 * re-exported here for the existing server-action consumers.
 */
export { CURRENT_INSTANCE_ROW_FILTER } from './current-instance'

// ---------------------------------------------------------------------------
// Exact phase status transitions
// ---------------------------------------------------------------------------

/**
 * The status a document must already be in when a phase attempt is created.
 * Solution resubmission legitimately starts from either engineering statuses,
 * so both are accepted; everything else fails closed.
 */
const PHASE_ENTRY_STATUSES: Record<ApprovalPhase, readonly RequestStatus[]> = {
  REQUEST: ['ImprovementRequest'],
  SOLUTION: ['SentToEngineer', 'DesignCostEstimationApproval'],
  FINAL: ['SendBackToRequester'],
}

/** Status written when the attempt completes without any pending step. */
const PHASE_COMPLETION_STATUS: Record<ApprovalPhase, RequestStatus> = {
  REQUEST: 'SentToEngineer',
  SOLUTION: 'SendBackToRequester',
  FINAL: 'Completed',
}

/** Status written for a pending attempt; REQUEST keeps its current status. */
const PHASE_PENDING_STATUS: Record<ApprovalPhase, RequestStatus | null> = {
  REQUEST: null,
  SOLUTION: 'DesignCostEstimationApproval',
  FINAL: 'FinalApproval',
}

// ---------------------------------------------------------------------------
// Resubmission history
// ---------------------------------------------------------------------------

/** Legacy (instance-less) approval-row subset the wrap derivation reads. */
export interface LegacyWrapRowInput {
  status: string
  isCustomChain: boolean
  order?: number
  approverId?: string | null
}

export interface LegacyWrapDerivation {
  routingMode: 'LEGACY_LEVEL' | 'CUSTOM_PERSON'
  state: ApprovalInstanceState
  originUserId: string
}

/**
 * Derive the historical instance metadata for legacy rows being wrapped on
 * the first NEW resubmission: mixed custom rows mark the whole attempt
 * CUSTOM_PERSON, the preserved row statuses decide the terminal state
 * (REJECTED dominates, then PENDING), and the FINAL origin falls back to the
 * approved auto self-row's actor because legacy final rows never recorded
 * their initiator. Rows themselves are never rewritten.
 */
export function deriveLegacyWrap(
  rows: readonly LegacyWrapRowInput[],
  input: { phase: ApprovalPhase; fallbackOriginUserId: string },
): LegacyWrapDerivation {
  if (rows.length === 0) {
    throw new ApprovalRouteConfigurationError('Cannot wrap an empty legacy attempt')
  }
  const routingMode = rows.some((row) => row.isCustomChain) ? 'CUSTOM_PERSON' : 'LEGACY_LEVEL'
  const state: ApprovalInstanceState = rows.some((row) => row.status === 'rejected')
    ? 'REJECTED'
    : rows.some((row) => row.status === 'pending')
      ? 'PENDING'
      : 'APPROVED'
  let originUserId = input.fallbackOriginUserId
  if (input.phase === 'FINAL') {
    const autoSelfRow = rows.find((row) =>
      row.order === 1 &&
      row.status === 'approved' &&
      !row.isCustomChain &&
      typeof row.approverId === 'string' &&
      row.approverId !== '',
    )
    if (autoSelfRow) originUserId = autoSelfRow.approverId as string
  }
  return { routingMode, state, originUserId }
}

/**
 * Optional capability carried by adapter implementations that can import
 * legacy (instance-less) rows into a historical superseded instance. The
 * declared `PhaseAdapterDb` surface stays exactly the five methods above;
 * `createPrismaPhaseAdapterDb` and the resubmission-history fixture provide
 * this extra method and the adapters use it when present.
 */
export interface LegacyAttemptHistoryCapableDb extends PhaseAdapterDb {
  ensureLegacyAttemptWrapped(input: PhaseDocumentRef & { fallbackOriginUserId: string }): Promise<{
    instanceId: string
    attempt: number
    routingMode: 'LEGACY_LEVEL' | 'CUSTOM_PERSON'
    state: ApprovalInstanceState
    wrappedRowCount: number
  } | null>
}

function legacyHistory(db: PhaseAdapterDb): LegacyAttemptHistoryCapableDb | null {
  return typeof (db as Partial<LegacyAttemptHistoryCapableDb>).ensureLegacyAttemptWrapped === 'function'
    ? (db as LegacyAttemptHistoryCapableDb)
    : null
}

/**
 * Resubmission history step shared by every creation attempt: supersede the
 * previous current instance (rows and terminal outcome untouched), or — for
 * data created before the engine existed — wrap the legacy rows into a
 * historical superseded instance before the new attempt persists. An
 * organization edit never reaches this path.
 */
async function beginAttemptHistory(
  db: PhaseAdapterDb,
  input: PhaseDocumentRef & { fallbackOriginUserId: string },
): Promise<void> {
  const current = await db.loadCurrentAttempt(input)
  if (current) {
    await db.supersedeApprovalInstance(current.id)
    return
  }
  await legacyHistory(db)?.ensureLegacyAttemptWrapped(input)
}

// ---------------------------------------------------------------------------
// Status transition application
// ---------------------------------------------------------------------------

async function applyPhaseStatusTransition(
  db: PhaseAdapterDb,
  input: { requestId: string; phase: ApprovalPhase; planState: ApprovalInstanceState; currentStatus: RequestStatus },
): Promise<{ statusChange?: { from: RequestStatus; to: RequestStatus } }> {
  const status = input.planState === 'PENDING' ? PHASE_PENDING_STATUS[input.phase] : PHASE_COMPLETION_STATUS[input.phase]
  if (!status || status === input.currentStatus) {
    return {}
  }
  await db.updateRequestStatus({ requestId: input.requestId, from: input.currentStatus, to: status })
  return { statusChange: { from: input.currentStatus, to: status } }
}

function requireEntryStatus(phase: ApprovalPhase, status: RequestStatus): RequestStatus {
  if (!(PHASE_ENTRY_STATUSES[phase] as readonly string[]).includes(status)) {
    throw new ApprovalRouteConfigurationError(
      `Cannot create the ${phase} approval attempt from status ${status}: expected ${PHASE_ENTRY_STATUSES[phase].join(' or ')}`,
    )
  }
  return status
}

// ---------------------------------------------------------------------------
// Normal and custom plan creation
// ---------------------------------------------------------------------------

function normalBuildInput(
  input: PhaseDocumentRef & { originUserId: string; requestDepartmentId: string | null },
): BuildApprovalInstanceInput {
  return {
    requestId: input.requestId,
    solutionId: input.solutionId,
    phase: input.phase,
    originUserId: input.originUserId,
    originalRequestId: input.requestId,
    requestDepartmentId: input.requestDepartmentId,
  }
}

function customOriginContext(origin: Awaited<ReturnType<ApprovalEngineDb['resolvePhaseOrigin']>>): ApprovalInstanceOriginContext {
  return {
    position: origin.branch.primaryPosition,
    assignmentId: origin.branch.primaryAssignmentId,
    unitPath: [...origin.branch.unitPath],
    groupPath: [...origin.branch.groupPath],
    labels: {},
  }
}

function customSteps(orderedApproverIds: readonly string[]): ApprovalStepPlan[] {
  return orderedApproverIds.map((requiredApproverId, index) => ({
    order: index + 1,
    requiredApproverId,
    candidateUserIds: [],
  }))
}

/**
 * Shared NEW-attempt core: history (supersede/wrap), plan build, persistence,
 * and the guarded status transition. `plan` is either built by the pure normal
 * builder or constructed for a custom ordered-person chain.
 */
async function createNewAttemptWithHistory(
  db: PhaseAdapterDb,
  input: PhaseDocumentRef & {
    originUserId: string
    requestDepartmentId?: string | null
    custom?: { orderedApproverIds: string[] }
  },
): Promise<PhaseAttemptResult> {
  if (input.custom && input.custom.orderedApproverIds.length === 0) {
    throw new ApprovalRouteConfigurationError('A custom approval attempt needs at least one approver')
  }
  if (input.custom && input.phase === 'REQUEST') {
    throw new ApprovalRouteConfigurationError('Request creation has no custom approval picker')
  }

  const context = await db.loadRequestContext(input.requestId)
  const currentStatus = requireEntryStatus(input.phase, context.status)

  await beginAttemptHistory(db, { ...input, fallbackOriginUserId: input.originUserId })

  let plan: ApprovalInstancePlan
  if (input.custom) {
    // Custom chains stay unrestricted ordered persons and never auto-approve;
    // the origin identity is the authenticated initiator, verified against the
    // stored document identity by the resolver.
    const origin = await db.resolvePhaseOrigin({
      phase: input.phase,
      requestId: input.requestId,
      solutionId: input.solutionId,
      originUserId: input.originUserId,
    })
    plan = {
      phase: input.phase,
      ...(input.phase === 'SOLUTION' ? { solutionId: input.solutionId } : { requestId: input.requestId }),
      originUserId: origin.originUserId,
      originUnitId: origin.originUnitId,
      originContext: customOriginContext(origin),
      routingMode: 'CUSTOM_PERSON',
      attempt: 1,
      state: 'PENDING',
      steps: customSteps(input.custom.orderedApproverIds),
      skipped: [],
    }
  } else {
    plan = await buildNormalApprovalInstance(db, normalBuildInput({
      ...input,
      requestDepartmentId: input.requestDepartmentId ?? context.departmentId,
    }))
  }

  const instance = await db.persistApprovalInstance(plan)
  const { statusChange } = await applyPhaseStatusTransition(db, {
    requestId: input.requestId,
    phase: input.phase,
    planState: plan.state,
    currentStatus,
  })

  return {
    instance,
    statusChange,
    completedWithoutSteps: plan.state === 'COMPLETED_NO_ELIGIBLE_STEPS',
    autoApproved: plan.state === 'AUTO_APPROVED',
  }
}

// ---------------------------------------------------------------------------
// Exported phase attempts
// ---------------------------------------------------------------------------

/**
 * REQUEST phase attempt (creation or resubmission). The stored requester is
 * the origin; the exact transitions are ImprovementRequest -> SentToEngineer
 * for ceiling auto-approval or NO_ELIGIBLE_APPROVAL_STEPS completion, and no
 * status change for a pending attempt.
 */
export async function createRequestApprovalAttempt(
  db: PhaseAdapterDb,
  input: { requestId: string; requesterId: string },
): Promise<PhaseAttemptResult> {
  return createNewAttemptWithHistory(db, { phase: 'REQUEST', requestId: input.requestId, originUserId: input.requesterId })
}

/**
 * SOLUTION phase attempt (submission or resubmission). The stored solution
 * submitter is the origin — never the original requester; the exact
 * transitions are SentToEngineer -> SendBackToRequester for auto/no-eligible
 * completion and -> DesignCostEstimationApproval while pending.
 */
export async function createSolutionApprovalAttempt(
  db: PhaseAdapterDb,
  input: { requestId: string; solutionId: string; submittedById: string },
): Promise<PhaseAttemptResult> {
  return createNewAttemptWithHistory(db, {
    phase: 'SOLUTION',
    requestId: input.requestId,
    solutionId: input.solutionId,
    originUserId: input.submittedById,
  })
}

/**
 * FINAL phase attempt (initiation or resubmission). The authenticated final
 * initiator is the origin; the exact transitions are
 * SendBackToRequester -> Completed for auto/no-eligible completion and
 * -> FinalApproval while pending. Final rows keep `isFinalApproval` identity.
 */
export async function createFinalApprovalAttempt(
  db: PhaseAdapterDb,
  input: { requestId: string; initiatorId: string },
): Promise<PhaseAttemptResult> {
  return createNewAttemptWithHistory(db, { phase: 'FINAL', requestId: input.requestId, originUserId: input.initiatorId })
}

/**
 * Custom ordered-person attempt for the SOLUTION or FINAL phase. Receives the
 * already-sanitized ordered approver IDs (submitter excluded, unique, existing
 * — validated by the calling action's preserved validators), never
 * auto-approves, and keeps CUSTOM_PERSON rows with the attempt's instanceId.
 */
export async function createCustomPersonAttempt(
  db: PhaseAdapterDb,
  input: {
    requestId: string
    solutionId?: string
    phase: 'SOLUTION' | 'FINAL'
    initiatorId: string
    orderedApproverIds: string[]
  },
): Promise<PhaseAttemptResult> {
  return createNewAttemptWithHistory(db, {
    phase: input.phase,
    requestId: input.requestId,
    solutionId: input.solutionId,
    originUserId: input.initiatorId,
    custom: { orderedApproverIds: input.orderedApproverIds },
  })
}

// ---------------------------------------------------------------------------
// Rollout gate helpers
// ---------------------------------------------------------------------------

/**
 * Raised when creation is requested in `new` mode without a completed import
 * digest. Server actions surface its message instead of the generic failure
 * so the denial stays diagnosable. Stale/corrupt mapping and missing
 * primary/route coverage are configuration errors, not this denial.
 */
export class ApprovalCreationDisabledError extends Error {
  readonly code = 'APPROVAL_CREATION_DISABLED'

  constructor() {
    super(
      'NEW approval routing is not enabled yet: APPROVAL_ORG_MAPPING_DIGEST must match a completed organization import. Keep APPROVAL_ROUTING_MODE on legacy or shadow.',
    )
    this.name = 'ApprovalCreationDisabledError'
  }
}

export interface NewCreationGateInput {
  phase: ApprovalPhase
  originUserId: string
  requestId: string
  solutionId?: string
}

interface NewCreationGateTx {
  organization_import_runs: {
    findUnique(args: { where: { mappingDigest: string } }): Promise<{ id: string; mappingDigest: string } | null>
  }
  user: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; isActive: boolean } | null>
  }
  organization_position_assignments: {
    findMany(args?: unknown): Promise<Array<{ id: string; userId: string; unitId: string; positionCode: string; reportingGroupId: string | null; isPrimary: boolean; isActive: boolean }>>
  }
  organization_units: {
    findMany(args?: unknown): Promise<Array<{ id: string; name: string; unitType: string; parentId: string | null; isActive: boolean }>>
  }
  reporting_groups: {
    findMany(args?: unknown): Promise<Array<{ id: string; unitId: string; parentGroupId: string | null; name: string; isActive: boolean }>>
  }
  reporting_group_members: {
    findMany(args?: unknown): Promise<Array<{ reportingGroupId: string; userId: string }>>
  }
  approval_route_versions: {
    findMany(args: { where: { scopeUnitId: { in: string[] }; phase: ApprovalPhase } }): Promise<Array<{
      id: string
      scopeUnitId: string
      phase: ApprovalPhase
      version: number
      maximumPositionLevel: number
      status: ApprovalRouteStatus
    }>>
  }
  approval_route_steps: {
    findMany(args: { where: { routeVersionId: { in: string[] } }; orderBy: { stepOrder: 'asc' } }): Promise<Array<{
      routeVersionId: string
      stepOrder: number
      positionCode: string
    }>>
  }
}

async function assertOriginRouteCoverage(tx: NewCreationGateTx, input: NewCreationGateInput): Promise<void> {
  const branch = await resolveReportingBranch(input.originUserId, tx as never)
  if (!branch) {
    throw new ApprovalRouteConfigurationError(
      `Absent primary assignment for origin user ${input.originUserId} is a configuration error`,
    )
  }
  const routeDb: ApprovalRouteDb = {
    loadOriginBranch: (userId) => resolveReportingBranch(userId, tx as never),
    loadPublishedRoutes: async ({ scopeUnitIds, phase }) => {
      const versions = await tx.approval_route_versions.findMany({
        where: { scopeUnitId: { in: [...scopeUnitIds] }, phase },
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
        maximumPositionLevel: version.maximumPositionLevel as 1 | 2 | 3 | 4 | 5 | 6,
        status: version.status,
        steps: steps
          .filter((step) => step.routeVersionId === version.id)
          .map((step) => ({ order: step.stepOrder, position: step.positionCode as never })),
      }))
    },
  }
  await resolvePublishedApprovalRoute({
    phase: input.phase,
    originUserId: input.originUserId,
    originUnitId: branch.primaryUnitId,
    requestId: input.requestId,
    originalRequestId: input.requestId,
    requestDepartmentId: null,
  }, routeDb)
}

/**
 * New-mode gate. Mode must be `new`, `APPROVAL_ORG_MAPPING_DIGEST` must match
 * a completed `organization_import_runs` row, and the actor must have current
 * primary-assignment plus published-route coverage. Missing digest keeps NEW
 * creation disabled; stale mapping / missing primary / missing published route
 * are configuration errors, never empty or vacant routes.
 */
export async function assertNewCreationEnabled(
  tx: Prisma.TransactionClient,
  input: NewCreationGateInput,
): Promise<void> {
  if (getApprovalRolloutMode(process.env) !== 'new') {
    throw new ApprovalCreationDisabledError()
  }
  const digest = process.env.APPROVAL_ORG_MAPPING_DIGEST
  if (!digest) {
    throw new ApprovalCreationDisabledError()
  }
  const run = await (tx as unknown as NewCreationGateTx).organization_import_runs.findUnique({
    where: { mappingDigest: digest },
  })
  if (!run) {
    throw new ApprovalRouteConfigurationError(
      `Stale or corrupt organization mapping digest: no completed import run for ${digest}`,
    )
  }
  await assertOriginRouteCoverage(tx as unknown as NewCreationGateTx, input)
}

/**
 * Shadow-mode comparison: resolve the NEW plan through the pure engine read
 * path and report the outcome. NEVER writes steps, statuses, instances, or
 * notifications, and NEVER throws into the legacy submission — a missing or
 * unmapped NEW route is a reported finding, not a legacy failure.
 */
export async function compareNewResolutionWithoutWrites(
  db: ApprovalEngineDb,
  input: PhaseDocumentRef & { originUserId: string },
): Promise<void> {
  try {
    // requestDepartmentId is nullable legacy context and never consulted for
    // NEW scope or candidates, so the read-only comparison passes null.
    await buildNormalApprovalInstance(db, normalBuildInput({ ...input, requestDepartmentId: null }))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(
      `[approval-rollout] shadow comparison could not resolve the NEW ${input.phase} route for request ${input.requestId}: ${detail}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Production Prisma adapter
// ---------------------------------------------------------------------------

/**
 * Structural bridge to the engine persistence port: the transaction client
 * satisfies the port at runtime; the port's JSON write type is deliberately
 * narrower than Prisma's `InputJsonValue`, which a generic transaction client
 * cannot prove structurally.
 */
function asApprovalInstanceTx(tx: Prisma.TransactionClient): ApprovalInstanceTx {
  return tx as unknown as ApprovalInstanceTx
}

function documentOwnerWhere(input: { requestId?: string; solutionId?: string; phase: ApprovalPhase }): Prisma.approval_instancesWhereInput {
  if (input.phase === 'SOLUTION') {
    if (!input.solutionId) {
      throw new ApprovalRouteConfigurationError('Solution phase attempt requires the solution document id')
    }
    return { solutionId: input.solutionId, phase: input.phase }
  }
  return { requestId: input.requestId, phase: input.phase }
}

async function nextAttemptNumber(
  tx: Prisma.TransactionClient,
  input: { requestId?: string; solutionId?: string; phase: ApprovalPhase },
): Promise<number> {
  const latest = await tx.approval_instances.findFirst({
    where: documentOwnerWhere(input),
    orderBy: { attempt: 'desc' },
    select: { attempt: true },
  })
  return (latest?.attempt ?? 0) + 1
}

/** Version-1 CUSTOM_PERSON row metadata enforced by the row-mode CHECK. */
function customRowBase(instanceId: string, step: ApprovalStepPlan) {
  return {
    approverId: null,
    requiredLevel: null,
    order: step.order,
    status: 'pending' as const,
    comments: null,
    approvedAt: null,
    isCustomChain: true,
    requiredApproverId: step.requiredApproverId ?? null,
    instanceId,
    requiredPosition: null,
    candidateGroupId: null,
    routingMode: 'CUSTOM_PERSON' as const,
    integrityVersion: 1 as const,
  }
}

async function persistCustomPersonInstance(
  tx: Prisma.TransactionClient,
  plan: ApprovalInstancePlan,
): Promise<ApprovalInstancePlan & { id: string; attempt: number }> {
  const attempt = await nextAttemptNumber(tx, plan)
  const instance = await tx.approval_instances.create({
    data: {
      requestId: plan.phase === 'SOLUTION' ? null : plan.requestId ?? null,
      solutionId: plan.phase === 'SOLUTION' ? plan.solutionId ?? null : null,
      phase: plan.phase,
      routeVersionId: null,
      originUserId: plan.originUserId,
      originUnitId: plan.originUnitId,
      originContext: {
        position: plan.originContext.position,
        assignmentId: plan.originContext.assignmentId,
        unitPath: [...plan.originContext.unitPath],
        groupPath: [...plan.originContext.groupPath],
        labels: {},
      },
      routingMode: 'CUSTOM_PERSON',
      state: plan.state,
      attempt,
      completionReason: null,
    },
  })
  for (const step of plan.steps) {
    if (!step.requiredApproverId) {
      throw new ApprovalRouteConfigurationError(`Custom approval step ${step.order} is missing its required approver`)
    }
    const row = customRowBase(instance.id, step)
    if (plan.phase === 'SOLUTION') {
      await tx.solution_approvals.create({ data: { ...row, solutionId: plan.solutionId ?? '' } })
    } else {
      await tx.request_approvals.create({
        data: { ...row, requestId: plan.requestId ?? '', isFinalApproval: plan.phase === 'FINAL' },
      })
    }
  }
  return { ...plan, attempt, id: instance.id }
}

interface LegacyPhaseRow {
  id: string
  status: string
  isCustomChain: boolean
  order: number
  approverId: string | null
  instanceId: string | null
}

async function loadLegacyPhaseRows(tx: Prisma.TransactionClient, input: PhaseDocumentRef): Promise<LegacyPhaseRow[]> {
  if (input.phase === 'SOLUTION') {
    if (!input.solutionId) {
      throw new ApprovalRouteConfigurationError('Solution phase attempt requires the solution document id')
    }
    return tx.solution_approvals.findMany({
      where: { solutionId: input.solutionId },
      orderBy: { order: 'asc' },
      select: { id: true, status: true, isCustomChain: true, order: true, approverId: true, instanceId: true },
    })
  }
  return tx.request_approvals.findMany({
    where: { requestId: input.requestId, isFinalApproval: input.phase === 'FINAL' },
    orderBy: { order: 'asc' },
    select: { id: true, status: true, isCustomChain: true, order: true, approverId: true, instanceId: true },
  })
}

async function attachLegacyRowsToWrappedInstance(
  tx: Prisma.TransactionClient,
  input: PhaseDocumentRef,
  rowIds: string[],
  instanceId: string,
): Promise<void> {
  if (input.phase === 'SOLUTION') {
    await tx.solution_approvals.updateMany({ where: { id: { in: rowIds } }, data: { instanceId } })
    return
  }
  await tx.request_approvals.updateMany({ where: { id: { in: rowIds } }, data: { instanceId } })
}

/**
 * Stored identity the wrapped historical instance points at: the solution's
 * submitter for SOLUTION, otherwise the stored requester (the FINAL
 * derivation already prefers the recorded auto self-row actor when one
 * exists).
 */
async function legacyWrapOriginUserId(tx: Prisma.TransactionClient, input: PhaseDocumentRef): Promise<string> {
  if (input.phase === 'SOLUTION' && input.solutionId) {
    const solution = await tx.solutions.findUnique({
      where: { id: input.solutionId },
      select: { submittedById: true },
    })
    if (solution) return solution.submittedById
  }
  const request = await tx.requests.findUnique({
    where: { id: input.requestId },
    select: { requesterId: true },
  })
  if (!request) {
    throw new ApprovalRouteConfigurationError(`Request ${input.requestId} no longer exists`)
  }
  return request.requesterId
}

/**
 * Production `PhaseAdapterDb` over the caller's Prisma transaction. All reads
 * and writes observe the same transaction snapshot as the enclosing workflow.
 * The wrap keeps legacy rows' statuses, actors, times, custom IDs, levels and
 * version-0 metadata verbatim (only `instanceId` is attached), supersession
 * writes only `supersededAt` so a prior terminal outcome is never erased, and
 * the status transition is a guarded compare-and-set.
 */
export function createPrismaPhaseAdapterDb(tx: Prisma.TransactionClient): PhaseAdapterDb & LegacyAttemptHistoryCapableDb {
  const adapter: PhaseAdapterDb & LegacyAttemptHistoryCapableDb = {
    ...createApprovalEngineDb(tx),
    loadRequestContext: async (requestId) => {
      const request = await tx.requests.findUnique({
        where: { id: requestId },
        select: { status: true, requesterId: true, departmentId: true, organizationUnitId: true },
      })
      if (!request) {
        throw new ApprovalRouteConfigurationError(`Request ${requestId} no longer exists`)
      }
      return request
    },
    loadCurrentAttempt: async (input) => {
      const current = await tx.approval_instances.findFirst({
        where: { ...documentOwnerWhere(input), supersededAt: null },
        orderBy: { attempt: 'desc' },
        select: { id: true, attempt: true, state: true },
      })
      return current ?? null
    },
    persistApprovalInstance: (plan) =>
      plan.routingMode === 'CUSTOM_PERSON'
        ? persistCustomPersonInstance(tx, plan)
        : persistApprovalInstance(asApprovalInstanceTx(tx), plan),
    supersedeApprovalInstance: async (instanceId) => {
      // Only `supersededAt` is written: the prior terminal state stays the
      // durable audit proof (Task 8 ruling), and the group-less snapshot
      // audit trigger does not fire on supersededAt writes.
      await tx.approval_instances.update({
        where: { id: instanceId },
        data: { supersededAt: new Date() },
      })
    },
    updateRequestStatus: async (input) => {
      if (input.from === input.to) return
      const updated = await tx.requests.updateMany({
        where: { id: input.requestId, status: input.from },
        data: { status: input.to },
      })
      if (updated.count !== 1) {
        throw new RequestStatusConflictError(
          `Cannot move the request from ${input.from} to ${input.to} - it was changed by someone else. Please refresh and try again.`,
        )
      }
    },
    ensureLegacyAttemptWrapped: async (input) => {
      const current = await tx.approval_instances.findFirst({
        where: { ...documentOwnerWhere(input), supersededAt: null },
        select: { id: true },
      })
      if (current) return null
      const rows = await loadLegacyPhaseRows(tx, input)
      if (rows.length === 0) return null
      if (rows.every((row) => row.instanceId)) return null
      const derivation = deriveLegacyWrap(rows, {
        phase: input.phase,
        fallbackOriginUserId: await legacyWrapOriginUserId(tx, input),
      })
      const branch = await resolveReportingBranch(derivation.originUserId, tx)
      if (!branch) {
        throw new ApprovalRouteConfigurationError(
          `No unambiguous origin reporting branch for user ${derivation.originUserId}; cannot wrap the legacy ${input.phase} attempt`,
        )
      }
      const attempt = await nextAttemptNumber(tx, input)
      const instance = await tx.approval_instances.create({
        data: {
          requestId: input.phase === 'SOLUTION' ? null : input.requestId,
          solutionId: input.phase === 'SOLUTION' ? input.solutionId ?? null : null,
          phase: input.phase,
          routeVersionId: null,
          originUserId: derivation.originUserId,
          originUnitId: branch.primaryUnitId,
          originContext: {
            position: branch.primaryPosition,
            assignmentId: branch.primaryAssignmentId,
            unitPath: [...branch.unitPath],
            groupPath: [...branch.groupPath],
            labels: {},
          },
          routingMode: derivation.routingMode,
          state: derivation.state,
          attempt,
          completionReason: null,
          // Historical at birth: a wrapped legacy attempt is never current.
          supersededAt: new Date(),
        },
      })
      await attachLegacyRowsToWrappedInstance(tx, input, rows.map((row) => row.id), instance.id)
      return {
        instanceId: instance.id,
        attempt,
        routingMode: derivation.routingMode,
        state: derivation.state,
        wrappedRowCount: rows.length,
      }
    },
  }
  return adapter
}

/**
 * Record the terminal outcome of the CURRENT instance for a rejection or a
 * cancellation, atomically inside the caller's transaction. Only PENDING
 * instances transition (a terminal outcome is never overwritten), and no
 * notification events are added. Reject and cancel callers share this helper
 * so further actions on the same rows observe the updated outcome.
 */
export async function markCurrentInstanceOutcome(
  tx: Prisma.TransactionClient,
  input: { requestId?: string; solutionId?: string; phase: ApprovalPhase; outcome: 'REJECTED' | 'CANCELLED' },
): Promise<void> {
  const where: Prisma.approval_instancesWhereInput = {
    phase: input.phase,
    state: 'PENDING',
    supersededAt: null,
    ...(input.solutionId ? { solutionId: input.solutionId } : {}),
    ...(input.requestId && input.phase !== 'SOLUTION' ? { requestId: input.requestId } : {}),
    ...(input.requestId && input.phase === 'SOLUTION' && !input.solutionId
      ? { solution: { requestId: input.requestId } }
      : {}),
  }
  await tx.approval_instances.updateMany({ where, data: { state: input.outcome } })
}
