// Clean-start phase origins, attempt creators, custom chains, the
// assignment submission gate (Plan B Task 6), and admin stranded restart
// (Plan B Task 7). Structural ports only: NO Prisma import, no legacy
// position-code enum mapping, no live inserts here (B4 persist ruling:
// live CHECK remains B6/B15; fakes cover the contract).
// Production callers pass a Prisma transaction via a structural cast.
//
// Origins (spec): REQUEST = stored requests.requesterId; SOLUTION = stored
// solutions.submittedById never an authorized reviser (mismatched trusted
// input rejected); FINAL = original requester (never the trigger actor).
// Custom chains skip route resolution, write CUSTOM_PERSON ordered
// requiredApproverId rows, and never auto-approve.
// Ledger R5: ApprovalPhase from definition.ts. R-A6-2: reporting path is
// structural; inactive accounts are not actionable candidates.

import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/definition'
import { resolvePublishedApprovalRoute } from '@/lib/approval-routes/selection'
import type { ApprovalRouteDb } from '@/lib/approval-routes/selection'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, ReportingPath, TeamNode } from '@/lib/organization/model'
import { resolveReportingPath } from '@/lib/organization/reporting-path'
import type { ReportingPathRepository } from '@/lib/organization/reporting-path'
import {
  buildNormalApprovalInstance,
  persistApprovalInstance,
  type ApprovalEngineDb,
  type ApprovalInstancePlan,
  type ApprovalInstanceTx,
  type BuildApprovalInstanceInput,
  type PhaseOrigin,
  type PhaseOriginQuery,
} from './plan'

export type { PhaseOrigin, PhaseOriginQuery, BuildApprovalInstanceInput }

export class SubmissionDeniedError extends Error {
  readonly code = 'SUBMISSION_DENIED'

  constructor(message = 'Active organization assignment is required to create requests') {
    super(message)
    this.name = 'SubmissionDeniedError'
  }
}

export function canSubmitRequests(input: { isActiveUser: boolean; hasActiveAssignment: boolean }): boolean {
  return input.isActiveUser && input.hasActiveAssignment
}

export function requireAssignableSubmitter(input: {
  isActiveUser: boolean
  assignment: { unitId: string } | null
}): { unitId: string } {
  if (!canSubmitRequests({ isActiveUser: input.isActiveUser, hasActiveAssignment: input.assignment !== null })) {
    throw new SubmissionDeniedError()
  }
  if (input.assignment === null) throw new SubmissionDeniedError()
  return { unitId: input.assignment.unitId }
}

export interface PhaseOriginDocuments {
  requests: {
    findUnique(args: {
      where: { id: string }
      select: { requesterId: true }
    }): Promise<{ requesterId: string } | null>
  }
  solutions: {
    findUnique(args: {
      where: { id: string }
      select: { requestId: true; submittedById: true }
    }): Promise<{ requestId: string; submittedById: string } | null>
  }
}

export interface PhaseOriginRepository extends PhaseOriginDocuments {
  resolveReportingPath(userId: string): Promise<ReportingPath | null>
}

export interface PhaseAttemptResult {
  instance: Omit<ApprovalInstancePlan, 'routingMode'> & {
    id: string
    routingMode: 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  }
  statusChange?: { from: RequestStatus; to: RequestStatus }
  completedWithoutSteps: boolean
  autoApproved: boolean
}

type RequestStatus =
  | 'ImprovementRequest'
  | 'SentToEngineer'
  | 'SendBackToRequester'
  | 'Completed'
  | 'Cancelled'
  | 'DesignCostEstimationApproval'
  | 'FinalApproval'

export interface PhaseAttemptTx extends ApprovalInstanceTx, ApprovalEngineDb {}

function originError(message: string): never {
  throw new ApprovalRouteConfigurationError(message)
}

function assertTrustedActor(query: PhaseOriginQuery, storedOriginUserId: string, label: string): void {
  if (query.originUserId !== undefined && query.originUserId !== storedOriginUserId) {
    throw new ApprovalRouteConfigurationError(
      `Authenticated actor does not match the stored ${label} origin of the document`,
    )
  }
}

async function requirePath(db: PhaseOriginRepository, userId: string): Promise<ReportingPath> {
  const path = await db.resolveReportingPath(userId)
  if (path === null) originError(`No origin reporting path for user ${userId}`)
  return path
}

export async function resolvePhaseOrigin(db: PhaseOriginRepository, query: PhaseOriginQuery): Promise<PhaseOrigin> {
  if (query.phase === 'SOLUTION') {
    if (!query.solutionId) originError('Solution phase origin requires the solution document id')
    const solution = await db.solutions.findUnique({
      where: { id: query.solutionId },
      select: { requestId: true, submittedById: true },
    })
    if (!solution) originError(`Solution ${query.solutionId} no longer exists`)
    assertTrustedActor(query, solution.submittedById, 'solution submitter')
    const path = await requirePath(db, solution.submittedById)
    return {
      phase: 'SOLUTION',
      originUserId: solution.submittedById,
      originUnitId: path.unitId,
      path,
      requestId: solution.requestId,
      source: 'SOLUTION_SUBMITTER',
    }
  }

  const request = await db.requests.findUnique({
    where: { id: query.requestId },
    select: { requesterId: true },
  })
  if (!request) originError(`Request ${query.requestId} no longer exists`)

  if (query.phase === 'FINAL') {
    if (!query.originUserId) originError('Final phase origin requires the authenticated initiator')
    await requirePath(db, query.originUserId)
    const requesterPath = await requirePath(db, request.requesterId)
    return {
      phase: 'FINAL',
      originUserId: request.requesterId,
      originUnitId: requesterPath.unitId,
      path: requesterPath,
      requestId: query.requestId,
      source: 'FINAL_INITIATOR',
    }
  }

  assertTrustedActor(query, request.requesterId, 'requester')
  const path = await requirePath(db, request.requesterId)
  return {
    phase: 'REQUEST',
    originUserId: request.requesterId,
    originUnitId: path.unitId,
    path,
    requestId: query.requestId,
    source: 'REQUESTER',
  }
}

function statusChangeFor(plan: { phase: ApprovalPhase; state: ApprovalInstancePlan['state'] }): PhaseAttemptResult['statusChange'] {
  const complete = plan.state === 'AUTO_APPROVED' || plan.state === 'COMPLETED_NO_ELIGIBLE_STEPS'
  if (plan.phase === 'REQUEST') {
    return complete ? { from: 'ImprovementRequest', to: 'SentToEngineer' } : undefined
  }
  if (plan.phase === 'SOLUTION') {
    return complete
      ? { from: 'SentToEngineer', to: 'SendBackToRequester' }
      : { from: 'SentToEngineer', to: 'DesignCostEstimationApproval' }
  }
  return complete
    ? { from: 'SendBackToRequester', to: 'Completed' }
    : { from: 'SendBackToRequester', to: 'FinalApproval' }
}

function toResult(plan: ApprovalInstancePlan & { id: string }): PhaseAttemptResult {
  return {
    instance: plan,
    autoApproved: plan.state === 'AUTO_APPROVED',
    completedWithoutSteps: plan.state === 'COMPLETED_NO_ELIGIBLE_STEPS',
    statusChange: statusChangeFor(plan),
  }
}

async function supersedeCurrentInstance(
  tx: ApprovalInstanceTx,
  input: { phase: ApprovalPhase; requestId?: string; solutionId?: string },
): Promise<void> {
  const where = input.phase === 'SOLUTION'
    ? { solutionId: input.solutionId, phase: input.phase, supersededAt: null }
    : { requestId: input.requestId, phase: input.phase, supersededAt: null }
  const current = await tx.approval_instances.findFirst({
    where,
    orderBy: { attempt: 'desc' },
    select: { id: true },
  })
  if (!current?.id) return
  // Only `supersededAt` is written: the prior terminal state stays the durable
  // audit proof, matching phase-adapters beginAttemptHistory.
  await tx.approval_instances.update({
    where: { id: current.id },
    data: { supersededAt: new Date() },
  })
}

async function persistNormalAttempt(tx: PhaseAttemptTx, input: BuildApprovalInstanceInput): Promise<PhaseAttemptResult> {
  const plan = await buildNormalApprovalInstance(tx, input)
  await supersedeCurrentInstance(tx, {
    phase: plan.phase,
    requestId: plan.requestId,
    solutionId: plan.solutionId,
  })
  const persisted = await persistApprovalInstance(tx, plan)
  return toResult(persisted)
}

export async function createRequestApprovalAttempt(
  tx: PhaseAttemptTx,
  input: BuildApprovalInstanceInput,
): Promise<PhaseAttemptResult> {
  return persistNormalAttempt(tx, { ...input, phase: 'REQUEST' })
}

export async function createSolutionApprovalAttempt(
  tx: PhaseAttemptTx,
  input: BuildApprovalInstanceInput,
): Promise<PhaseAttemptResult> {
  return persistNormalAttempt(tx, { ...input, phase: 'SOLUTION' })
}

export async function createFinalApprovalAttempt(
  tx: PhaseAttemptTx,
  input: BuildApprovalInstanceInput,
): Promise<PhaseAttemptResult> {
  return persistNormalAttempt(tx, { ...input, phase: 'FINAL' })
}

function uniqueOrdered(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    ordered.push(id)
  }
  return ordered
}

export async function createCustomPersonAttempt(
  tx: PhaseAttemptTx,
  input: {
    requestId?: string
    solutionId?: string
    phase: ApprovalPhase
    orderedApproverIds: readonly string[]
    actorId: string
  },
): Promise<PhaseAttemptResult> {
  const orderedApproverIds = uniqueOrdered(input.orderedApproverIds)
  if (orderedApproverIds.length === 0) {
    originError('Custom approval chain must have at least one required approver')
  }
  const origin = await tx.resolvePhaseOrigin({
    phase: input.phase,
    requestId: input.requestId ?? '',
    solutionId: input.solutionId,
    originUserId: input.phase === 'FINAL' ? input.actorId : undefined,
  })
  const path = origin.path
  if (!path) originError('Custom attempt origin path is missing')

  await supersedeCurrentInstance(tx, {
    phase: input.phase,
    requestId: input.requestId,
    solutionId: input.solutionId,
  })

  const where = input.phase === 'SOLUTION'
    ? { solutionId: input.solutionId, phase: input.phase }
    : { requestId: input.requestId, phase: input.phase }
  const latest = await tx.approval_instances.findFirst({
    where,
    orderBy: { attempt: 'desc' },
    select: { attempt: true },
  })
  const attempt = (latest?.attempt ?? 0) + 1
  const instanceData: Record<string, unknown> = {
    phase: input.phase,
    originUserId: origin.originUserId,
    originUnitId: origin.originUnitId,
    originAssignmentId: path.assignmentId,
    originPositionId: path.positionId,
    routingMode: 'CUSTOM_PERSON',
    state: 'PENDING',
    attempt,
  }
  if (input.phase === 'SOLUTION') instanceData.solutionId = input.solutionId
  else instanceData.requestId = input.requestId

  const instance = await tx.approval_instances.create({
    data: instanceData as never,
  })

  const steps = orderedApproverIds.map((requiredApproverId, index) => ({
    order: index + 1,
    requiredPositionId: '',
    scopeUnitId: origin.originUnitId,
    candidateUserIds: Object.freeze([requiredApproverId]) as readonly string[],
    requiredApproverId,
  }))

  for (const step of steps) {
    const row = {
      instanceId: instance.id,
      order: step.order,
      status: 'pending' as const,
      routingMode: 'CUSTOM_PERSON' as const,
      requiredApproverId: step.requiredApproverId,
    }
    if (input.phase === 'SOLUTION') {
      await tx.solution_approvals.create({
        data: { ...row, solutionId: input.solutionId } as never,
      })
    } else {
      await tx.request_approvals.create({
        // Legacy consumers (capability lookup, transaction eligibility and modal
        // classification) key on isFinalApproval; FINAL rows must carry it
        // explicitly (creation-only fix, plan 2026-10-11-custom-final-phase-flag-fix).
        data: { ...row, requestId: input.requestId, isFinalApproval: input.phase === 'FINAL' } as never,
      })
    }
  }

  const plan: PhaseAttemptResult['instance'] = {
    phase: input.phase,
    requestId: input.requestId,
    solutionId: input.solutionId,
    originUserId: origin.originUserId,
    originUnitId: origin.originUnitId,
    originContext: {
      positionId: path.positionId,
      assignmentId: path.assignmentId,
      unitPath: path.unitPath,
      labels: {},
    },
    routingMode: 'CUSTOM_PERSON',
    attempt,
    state: 'PENDING',
    steps: Object.freeze(steps.map((step) => Object.freeze({
      order: step.order,
      requiredPositionId: step.requiredPositionId,
      scopeUnitId: step.scopeUnitId,
      candidateUserIds: step.candidateUserIds,
    }))),
    skipped: Object.freeze([]),
    id: instance.id,
  }
  return {
    instance: plan,
    autoApproved: false,
    completedWithoutSteps: false,
    statusChange: statusChangeFor(plan),
  }
}

// ---------------------------------------------------------------------------
// Production structural adapter (Prisma transaction clients satisfy this
// shape at runtime; callers cast. Live requiredPosition CHECK is not mapped.)
// ---------------------------------------------------------------------------

export interface CleanStartAttemptStore extends ApprovalInstanceTx, PhaseOriginDocuments {
  user: ApprovalInstanceTx['user'] & {
    findUnique?(args: { where: { id: string }; select: { id: true; isActive: true } }): Promise<{ id: string; isActive: boolean } | null>
    findMany(args: {
      where?: { id?: { in: string[] } }
      select: { id: true; name?: true; isActive?: true }
    }): Promise<Array<{ id: string; name?: string; isActive?: boolean }>>
  }
  organization_assignments: {
    findFirst(args: {
      where: { userId: string; isActive?: boolean; unitId?: string }
      select?: { id?: true; unitId?: true; userId?: true; positionId?: true; teamId?: true; isActive?: true }
    }): Promise<{ id: string; userId: string; unitId: string; positionId: string; teamId: string | null; isActive: boolean } | null>
    findMany(args?: {
      where?: { teamId?: string; isActive?: boolean }
    }): Promise<Array<{ id: string; userId: string; unitId: string; positionId: string; teamId: string | null; isActive: boolean }>>
  }
  organization_units: {
    findMany(args?: unknown): Promise<Array<{
      id: string
      name: string
      parentId: string | null
      isActive: boolean
      shareRequests: boolean
      canWorkOnSolutions: boolean
      managerUserId: string | null
    }>>
  }
  positions: {
    findMany(args?: unknown): Promise<Array<{ id: string; name: string; rank: number; isActive: boolean }>>
  }
  teams: {
    findMany(args?: unknown): Promise<Array<{
      id: string
      unitId: string
      name: string
      reportsToAssignmentId: string
      isActive: boolean
    }>>
  }
  approval_route_versions: {
    findMany(args: {
      where: { scopeUnitId: { in: string[] }; phase: ApprovalPhase }
    }): Promise<Array<{
      id: string
      scopeUnitId: string
      phase: ApprovalPhase
      version: number
      approvalLimitPositionId: string | null
      status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
    }>>
  }
  approval_route_steps: {
    findMany(args: {
      where: { routeVersionId: { in: string[] } }
      orderBy: { stepOrder: 'asc' }
    }): Promise<Array<{ routeVersionId: string; stepOrder: number; positionId: string | null }>>
  }
}

function reportingRepo(store: CleanStartAttemptStore): ReportingPathRepository {
  return {
    async findUser(userId) {
      if (!store.user.findUnique) return null
      return store.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } })
    },
    async loadUnits() {
      const rows = await store.organization_units.findMany()
      return rows.map((row): OrganizationUnitNode => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        isActive: row.isActive,
        shareRequests: row.shareRequests,
        canWorkOnSolutions: row.canWorkOnSolutions,
        managerUserId: row.managerUserId,
      }))
    },
    async loadPositions() {
      const rows = await store.positions.findMany()
      return rows.map((row): PositionNode => ({
        id: row.id,
        name: row.name,
        rank: row.rank,
        isActive: row.isActive,
      }))
    },
    async loadAssignments() {
      const rows = await store.organization_assignments.findMany()
      return rows.map((row): AssignmentNode => ({
        id: row.id,
        userId: row.userId,
        unitId: row.unitId,
        positionId: row.positionId,
        teamId: row.teamId,
        isActive: row.isActive,
      }))
    },
    async loadTeams() {
      const rows = await store.teams.findMany()
      return rows.map((row): TeamNode => ({
        id: row.id,
        unitId: row.unitId,
        name: row.name,
        reportsToAssignmentId: row.reportsToAssignmentId,
        isActive: row.isActive,
      }))
    },
  }
}

function originRepoFromStore(store: CleanStartAttemptStore): PhaseOriginRepository {
  const repo = reportingRepo(store)
  return {
    requests: store.requests,
    solutions: store.solutions,
    resolveReportingPath: (userId) => resolveReportingPath(userId, repo),
  }
}

function routeDbFromStore(store: CleanStartAttemptStore): ApprovalRouteDb {
  const repo = reportingRepo(store)
  return {
    loadOriginPath: (userId) => resolveReportingPath(userId, repo),
    async loadRoutes(input) {
      const versions = await store.approval_route_versions.findMany({
        where: { scopeUnitId: { in: [...input.scopeUnitIds] }, phase: input.phase },
      })
      if (versions.length === 0) return []
      const steps = await store.approval_route_steps.findMany({
        where: { routeVersionId: { in: versions.map((version) => version.id) } },
        orderBy: { stepOrder: 'asc' },
      })
      return versions.flatMap((version) => {
        if (!version.approvalLimitPositionId) return []
        const versionSteps = steps
          .filter((step) => step.routeVersionId === version.id && step.positionId)
          .map((step) => ({ order: step.stepOrder, positionId: step.positionId as string }))
        return [{
          id: version.id,
          scopeUnitId: version.scopeUnitId,
          phase: version.phase,
          version: version.version,
          approvalLimitPositionId: version.approvalLimitPositionId,
          status: version.status,
          steps: versionSteps,
        }]
      })
    },
    loadPositions: () => reportingRepo(store).loadPositions(),
  }
}

export function createCleanStartPhaseAttemptTx(store: CleanStartAttemptStore): PhaseAttemptTx {
  const origins = originRepoFromStore(store)
  const engine: ApprovalEngineDb = {
    resolvePhaseOrigin: (query) => resolvePhaseOrigin(origins, query),
    resolvePublishedRoute: (ctx) => resolvePublishedApprovalRoute(ctx, routeDbFromStore(store)),
    loadPositions: () => reportingRepo(store).loadPositions(),
    async loadOwnTeamActiveAssignments(teamId) {
      const rows = await store.organization_assignments.findMany({ where: { teamId, isActive: true } })
      return rows.map((row): AssignmentNode => ({
        id: row.id,
        userId: row.userId,
        unitId: row.unitId,
        positionId: row.positionId,
        teamId: row.teamId,
        isActive: row.isActive,
      }))
    },
    async findStepCandidates() {
      const assignments = await store.organization_assignments.findMany()
      const ids = [...new Set(assignments.map((row) => row.userId))]
      if (ids.length === 0) return []
      const users = await store.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, isActive: true },
      })
      return users.map((user) => ({ id: user.id, isActive: Boolean(user.isActive) }))
    },
  }
  return {
    ...engine,
    user: store.user,
    approval_instances: store.approval_instances,
    approval_instance_skips: store.approval_instance_skips,
    approval_candidate_groups: store.approval_candidate_groups,
    approval_candidate_group_members: store.approval_candidate_group_members,
    request_approvals: store.request_approvals,
    solution_approvals: store.solution_approvals,
  }
}

// ---------------------------------------------------------------------------
// Plan B Task 7: admin-only stranded-attempt restart + read-only preview
// ---------------------------------------------------------------------------

export interface ReplacementChainPreview {
  routeVersionId: string | 'DRAFT'
  scopeUnitId: string
  phase: ApprovalPhase
  autoApproved: boolean
  steps: ReadonlyArray<{
    order: number
    requiredPositionId: string
    candidates: ReadonlyArray<{ id: string; name: string }>
    skipped: boolean
  }>
}

export interface RestartAttemptRecord {
  id: string
  phase: ApprovalPhase
  requestId: string | null
  solutionId: string | null
  originUserId: string
  attempt: number
  state: string
  supersededAt: Date | null
  candidateGroups: ReadonlyArray<{
    members: ReadonlyArray<{ userId: string; user: { isActive: boolean } }>
  }>
}

export interface RestartStrandedPorts {
  requireAdmin(): Promise<string | null>
  loadAttemptForRestart(instanceId: string): Promise<RestartAttemptRecord | null>
  attemptTx: PhaseAttemptTx
  request_activities: {
    create(args: {
      data: {
        requestId?: string | null
        userId: string
        action: string
        comments?: string | null
      }
    }): Promise<unknown>
  }
}

function restartError(message: string): never {
  throw new Error(message)
}

// Same predicate as decisions.isAttemptStranded (B5). Copied here so this
// module keeps its SNAPSHOT-harness import allowlist (no ./decisions).
function isAttemptStranded(instance: RestartAttemptRecord): boolean {
  const members = instance.candidateGroups.flatMap((group) => group.members)
  return members.length > 0 && members.every((member) => !member.user.isActive)
}

async function requireRestartAdmin(ports: RestartStrandedPorts): Promise<string> {
  const adminId = await ports.requireAdmin()
  if (!adminId) restartError('Admin access required')
  return adminId
}

async function loadRestartTarget(
  ports: RestartStrandedPorts,
  instanceId: string,
): Promise<RestartAttemptRecord> {
  const record = await ports.loadAttemptForRestart(instanceId)
  if (!record) restartError('Approval instance not found')
  return record
}

function buildInputFromRecord(record: RestartAttemptRecord): BuildApprovalInstanceInput {
  const input: BuildApprovalInstanceInput = {
    requestId: record.requestId ?? '',
    phase: record.phase,
    originUserId: record.originUserId,
  }
  if (record.solutionId) input.solutionId = record.solutionId
  return input
}

async function previewFromPlan(
  ports: RestartStrandedPorts,
  plan: ApprovalInstancePlan,
): Promise<ReplacementChainPreview> {
  const candidateIds = plan.steps.flatMap((step) => [...step.candidateUserIds])
  const labels = candidateIds.length === 0
    ? {}
    : Object.fromEntries(
        (await ports.attemptTx.user.findMany({
          where: { id: { in: [...new Set(candidateIds)] } },
          select: { id: true, name: true },
        })).map((user) => [user.id, user.name]),
      )
  const liveSteps = plan.steps.map((step) => ({
    order: step.order,
    requiredPositionId: step.requiredPositionId,
    candidates: step.candidateUserIds.map((id) => ({ id, name: labels[id] ?? id })),
    skipped: false,
  }))
  const skippedSteps = plan.skipped.map((skip, index) => ({
    order: liveSteps.length + index + 1,
    requiredPositionId: skip.requiredPositionId,
    candidates: [] as Array<{ id: string; name: string }>,
    skipped: true,
  }))
  return {
    routeVersionId: plan.routeVersionId ?? 'DRAFT',
    scopeUnitId: plan.steps[0]?.scopeUnitId ?? plan.originUnitId,
    phase: plan.phase,
    autoApproved: plan.state === 'AUTO_APPROVED',
    steps: Object.freeze([...liveSteps, ...skippedSteps]),
  }
}

export async function previewReplacementChain(
  ports: RestartStrandedPorts,
  input: { instanceId: string },
): Promise<ReplacementChainPreview> {
  await requireRestartAdmin(ports)
  const record = await loadRestartTarget(ports, input.instanceId)
  const plan = await buildNormalApprovalInstance(ports.attemptTx, buildInputFromRecord(record))
  return previewFromPlan(ports, plan)
}

export async function restartStrandedAttempt(
  ports: RestartStrandedPorts,
  input: { instanceId: string; reason: string },
): Promise<{ oldInstanceId: string; newInstanceId: string }> {
  const adminId = await requireRestartAdmin(ports)
  const reason = input.reason.trim()
  if (!reason) restartError('Restart reason is required')
  const record = await loadRestartTarget(ports, input.instanceId)
  if (record.supersededAt != null || !isAttemptStranded(record)) {
    restartError('Attempt is not stranded')
  }
  const plan = await buildNormalApprovalInstance(ports.attemptTx, buildInputFromRecord(record))
  const restartPlan: ApprovalInstancePlan = {
    ...plan,
    restartOfInstanceId: record.id,
    restartReason: reason,
    restartedById: adminId,
  }
  await ports.attemptTx.approval_instances.update({
    where: { id: record.id },
    data: { supersededAt: new Date() },
  })
  const persisted = await persistApprovalInstance(ports.attemptTx, restartPlan)
  const activity: {
    requestId?: string | null
    userId: string
    action: string
    comments: string
  } = {
    userId: adminId,
    action: 'restarted_stranded_attempt',
    comments: reason,
  }
  if (record.requestId) activity.requestId = record.requestId
  await ports.request_activities.create({ data: activity })
  return { oldInstanceId: record.id, newInstanceId: persisted.id }
}

export async function markCurrentInstanceOutcome(
  tx: {
    approval_instances: {
      updateMany(args: {
        where: Record<string, unknown>
        data: { state: 'REJECTED' | 'CANCELLED' }
      }): Promise<unknown>
    }
  },
  input: {
    requestId?: string
    solutionId?: string
    phase: ApprovalPhase
    outcome: 'REJECTED' | 'CANCELLED'
  },
): Promise<void> {
  const where: Record<string, unknown> = {
    phase: input.phase,
    state: 'PENDING',
    supersededAt: null,
  }
  if (input.solutionId) where.solutionId = input.solutionId
  if (input.requestId && input.phase !== 'SOLUTION') where.requestId = input.requestId
  if (input.requestId && input.phase === 'SOLUTION' && !input.solutionId) {
    where.solution = { requestId: input.requestId }
  }
  await tx.approval_instances.updateMany({ where, data: { state: input.outcome } })
}
