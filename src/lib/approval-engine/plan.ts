// Clean-start approval instance builder + snapshot persistence (Plan B Task 4).
// Pure builder never writes. Persistence is a separate structural-tx call
// (fakes in tests; live Prisma wiring is B6/B15). NO Prisma import,
// no legacy engine imports, custom chains are not built here.
//
// Flow: resolvePhaseOrigin → resolvePublishedRoute → originRank >= limitRank
// → frozen AUTO_APPROVED empty steps/skipped (normal routes only) → else
// per published step in order: exclude stepRank <= originRank (not required,
// NOT vacant) and defensively omit stepRank > limitRank; compose B3
// selectStepCandidates with loadOwnTeamActiveAssignments(path.teamId) or []
// if ungrouped — never pass sibling teams; then filter isActive via
// findStepCandidates (do not reimplement option A). Empty active set →
// skipped VACANT_POSITION; else step with copied candidate user ids.
// No remaining steps → COMPLETED_NO_ELIGIBLE_STEPS + NO_ELIGIBLE_APPROVAL_STEPS;
// else PENDING. Deep-freeze plans; copy ids.
//
// Ledger R-A6-2: inactive accounts cannot act or be silently replaced.
// Sibling exclusion is caller-owned own-team load (B3). Origin is never a
// candidate (B3). Missing origin/path/rank/limit/position fails closed with
// ApprovalEnginePlanError. Serialization conflicts → ApprovalEngineConflictError,
// no retry.
//
// Parent B4 persist ruling: write requiredPositionId (+ candidateGroupId on
// approval rows); do not invent a legacy position-code enum mapping.
// Instance row writes originAssignmentId/originPositionId from originContext;
// do not write originContext JSON. Labels persist only as capturedDisplayName.
// Optional restart fields copied when present. Approval rows are B4-named
// fields only. AUTO_APPROVED is one group-less approved self row.

import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import type { ResolvedApprovalRoute } from '@/lib/approval-routes/selection'
import type { AssignmentNode, PositionNode, ReportingPath } from '@/lib/organization/model'
import { selectStepCandidates } from './candidates'

export const APPROVAL_ENGINE_TRANSACTION_ISOLATION = 'Serializable' as const

export class ApprovalEngineConflictError extends Error {
  readonly code = 'APPROVAL_ENGINE_CONFLICT'

  constructor(message = 'Approval instance transaction conflicted with a concurrent write; retry the action') {
    super(message)
    this.name = 'ApprovalEngineConflictError'
  }
}

export class ApprovalEnginePlanError extends Error {
  readonly code = 'APPROVAL_ENGINE_PLAN'

  constructor(message: string) {
    super(message)
    this.name = 'ApprovalEnginePlanError'
  }
}

export interface PhaseOriginQuery {
  phase: ApprovalPhase
  requestId: string
  solutionId?: string
  originUserId?: string
}

export interface PhaseOrigin {
  phase: ApprovalPhase
  originUserId: string
  originUnitId: string
  path: ReportingPath
  requestId: string
  source: 'REQUESTER' | 'SOLUTION_SUBMITTER' | 'FINAL_INITIATOR'
}

export interface BuildApprovalInstanceInput {
  requestId: string
  solutionId?: string
  phase: ApprovalPhase
  originUserId: string
}

export interface ApprovalStepPlan {
  order: number
  requiredPositionId: string
  scopeUnitId: string
  candidateUserIds: readonly string[]
}

export interface ApprovalSkipPlan {
  requiredPositionId: string
  reason: 'VACANT_POSITION'
}

export interface ApprovalInstancePlan {
  phase: ApprovalPhase
  requestId?: string
  solutionId?: string
  routeVersionId?: string
  originUserId: string
  originUnitId: string
  originContext: {
    positionId: string
    assignmentId: string
    unitPath: readonly string[]
    labels: Readonly<Record<string, string>>
  }
  routingMode: 'SNAPSHOT_GROUP'
  attempt: number
  state: 'PENDING' | 'AUTO_APPROVED' | 'COMPLETED_NO_ELIGIBLE_STEPS' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'SUPERSEDED'
  completionReason?: 'NO_ELIGIBLE_APPROVAL_STEPS'
  steps: readonly ApprovalStepPlan[]
  skipped: readonly ApprovalSkipPlan[]
  restartOfInstanceId?: string
  restartReason?: string
  restartedById?: string
}

export interface ApprovalEngineDb {
  resolvePhaseOrigin(query: PhaseOriginQuery): Promise<PhaseOrigin>
  resolvePublishedRoute(ctx: {
    phase: ApprovalPhase
    originUserId: string
    originUnitId: string
    requestId: string
  }): Promise<ResolvedApprovalRoute>
  loadPositions(): Promise<PositionNode[]>
  loadOwnTeamActiveAssignments(teamId: string): Promise<AssignmentNode[]>
  findStepCandidates(input: {
    path: ReportingPath
    requiredPositionId: string
  }): Promise<ReadonlyArray<{ id: string; isActive: boolean }>>
}

interface ApprovalInstanceRowCreate {
  requestId?: string
  solutionId?: string
  phase: ApprovalPhase
  routeVersionId?: string
  originUserId: string
  originUnitId: string
  originAssignmentId: string
  originPositionId: string
  routingMode: 'SNAPSHOT_GROUP'
  state: ApprovalInstancePlan['state']
  attempt: number
  completionReason?: string
  restartOfInstanceId?: string
  restartReason?: string
  restartedById?: string
}

interface ApprovalSkipRowCreate {
  approvalInstanceId: string
  requiredPositionId: string
  reason: 'VACANT_POSITION'
}

interface ApprovalCandidateGroupRowCreate {
  approvalInstanceId: string
  requiredPositionId: string
  scopeUnitId: string
}

interface ApprovalCandidateGroupMemberRowCreate {
  candidateGroupId: string
  userId: string
  capturedDisplayName: string
}

interface ApprovalRowCreate {
  requestId?: string
  solutionId?: string
  instanceId: string
  order: number
  status: 'pending' | 'approved'
  routingMode: 'SNAPSHOT_GROUP'
  requiredPositionId?: string
  candidateGroupId?: string
  approverId?: string
}

export interface ApprovalInstanceTx {
  user: {
    findMany(args: {
      where: { id: { in: string[] } }
      select: { id: true; name: true }
    }): Promise<Array<{ id: string; name: string }>>
  }
  approval_instances: {
    findFirst(args: {
      where: { requestId?: string; solutionId?: string; phase: ApprovalPhase; supersededAt?: null }
      orderBy: { attempt: 'desc' }
      select: { attempt?: true; id?: true }
    }): Promise<{ attempt?: number; id?: string } | null>
    create(args: { data: ApprovalInstanceRowCreate }): Promise<{ id: string }>
    update(args: {
      where: { id: string }
      data: { supersededAt: Date }
    }): Promise<unknown>
  }
  approval_instance_skips: {
    create(args: { data: ApprovalSkipRowCreate }): Promise<unknown>
  }
  approval_candidate_groups: {
    create(args: { data: ApprovalCandidateGroupRowCreate }): Promise<{ id: string }>
  }
  approval_candidate_group_members: {
    create(args: { data: ApprovalCandidateGroupMemberRowCreate }): Promise<unknown>
  }
  request_approvals: {
    create(args: { data: ApprovalRowCreate }): Promise<unknown>
  }
  solution_approvals: {
    create(args: { data: ApprovalRowCreate }): Promise<unknown>
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
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

function planError(message: string): never {
  throw new ApprovalEnginePlanError(message)
}

function assertOrigin(origin: PhaseOrigin): ReportingPath {
  if (!origin || !origin.path) planError('Approval origin path is missing')
  const path = origin.path
  if (!path.originUserId || !path.assignmentId || !path.unitId || !path.positionId) {
    planError('Approval origin path is missing identity')
  }
  if (!Array.isArray(path.unitPath) || path.unitPath.length === 0) {
    planError('Approval origin path is missing unitPath')
  }
  if (path.originUserId !== origin.originUserId || path.unitId !== origin.originUnitId) {
    planError('Approval origin does not match the reporting path')
  }
  return path
}

function rankOf(positions: ReadonlyMap<string, PositionNode>, positionId: string, label: string): number {
  if (!positionId) planError(`Approval ${label} position is missing`)
  const position = positions.get(positionId)
  if (!position || !Number.isFinite(position.rank)) {
    planError(`Approval ${label} position rank is missing: ${positionId}`)
  }
  return position.rank
}

function documentIds(input: BuildApprovalInstanceInput): { requestId?: string; solutionId?: string } {
  if (input.phase === 'SOLUTION') {
    if (!input.solutionId) planError('Solution phase requires the solution document id')
    return { solutionId: input.solutionId }
  }
  if (!input.requestId) planError(`Approval instance for phase ${input.phase} is missing its request id`)
  return { requestId: input.requestId }
}

function requireDocumentId(plan: ApprovalInstancePlan): string {
  if (!plan.requestId) planError(`Approval instance plan for phase ${plan.phase} is missing its request id`)
  return plan.requestId
}

function requireSolutionId(plan: ApprovalInstancePlan): string {
  if (!plan.solutionId) planError('Approval instance plan for the SOLUTION phase is missing its solution id')
  return plan.solutionId
}

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
  const path = assertOrigin(origin)
  const resolved = await db.resolvePublishedRoute({
    phase: input.phase,
    originUserId: origin.originUserId,
    originUnitId: origin.originUnitId,
    requestId: input.requestId,
  })
  if (!resolved || !resolved.approvalLimitPositionId) {
    planError('Published route limit position is missing')
  }
  const positionMap: ReadonlyMap<string, PositionNode> = new Map(
    (await db.loadPositions()).map((position) => [position.id, position]),
  )
  const originRank = rankOf(positionMap, path.positionId, 'origin')
  const limitRank = rankOf(positionMap, resolved.approvalLimitPositionId, 'limit')
  const originContext = deepFreeze({
    positionId: path.positionId,
    assignmentId: path.assignmentId,
    unitPath: Object.freeze([...path.unitPath]),
    labels: Object.freeze({}),
  })
  const base = {
    phase: input.phase,
    ...documentIds(input),
    routeVersionId: resolved.id,
    originUserId: origin.originUserId,
    originUnitId: origin.originUnitId,
    originContext,
    routingMode: 'SNAPSHOT_GROUP' as const,
    attempt: 1,
  }

  if (originRank >= limitRank) {
    return deepFreeze<ApprovalInstancePlan>({ ...base, state: 'AUTO_APPROVED', steps: [], skipped: [] })
  }

  const ownTeamMemberAssignments = path.teamId
    ? await db.loadOwnTeamActiveAssignments(path.teamId)
    : []

  const steps: ApprovalStepPlan[] = []
  const skipped: ApprovalSkipPlan[] = []
  for (const step of resolved.steps) {
    const stepRank = rankOf(positionMap, step.positionId, 'step')
    if (stepRank <= originRank) continue
    if (stepRank > limitRank) continue
    const selected = selectStepCandidates({
      path,
      requiredPositionId: step.positionId,
      ownTeamMemberAssignments,
    })
    const found = await db.findStepCandidates({ path, requiredPositionId: step.positionId })
    const activeIds = new Set(found.filter((candidate) => candidate.isActive).map((candidate) => candidate.id))
    const candidateUserIds = selected.map((candidate) => candidate.userId).filter((userId) => activeIds.has(userId))
    if (candidateUserIds.length === 0) {
      skipped.push({ requiredPositionId: step.positionId, reason: 'VACANT_POSITION' })
      continue
    }
    steps.push({
      order: step.order,
      requiredPositionId: step.positionId,
      scopeUnitId: resolved.scopeUnitId,
      candidateUserIds: Object.freeze([...candidateUserIds]),
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
  const users = await tx.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
  })
  return Object.fromEntries(users.map((user) => [user.id, user.name]))
}

function instanceRow(plan: ApprovalInstancePlan, attempt: number): ApprovalInstanceRowCreate {
  const data: ApprovalInstanceRowCreate = {
    phase: plan.phase,
    originUserId: plan.originUserId,
    originUnitId: plan.originUnitId,
    originAssignmentId: plan.originContext.assignmentId,
    originPositionId: plan.originContext.positionId,
    routingMode: 'SNAPSHOT_GROUP',
    state: plan.state,
    attempt,
  }
  if (plan.phase === 'SOLUTION') data.solutionId = requireSolutionId(plan)
  else data.requestId = requireDocumentId(plan)
  if (plan.routeVersionId) data.routeVersionId = plan.routeVersionId
  if (plan.completionReason) data.completionReason = plan.completionReason
  if (plan.restartOfInstanceId) data.restartOfInstanceId = plan.restartOfInstanceId
  if (plan.restartReason) data.restartReason = plan.restartReason
  if (plan.restartedById) data.restartedById = plan.restartedById
  return data
}

async function writeApprovalRow(
  tx: ApprovalInstanceTx,
  plan: ApprovalInstancePlan,
  row: ApprovalRowCreate,
): Promise<void> {
  if (plan.phase === 'SOLUTION') {
    await tx.solution_approvals.create({ data: { ...row, solutionId: requireSolutionId(plan) } })
    return
  }
  await tx.request_approvals.create({ data: { ...row, requestId: requireDocumentId(plan) } })
}

export async function persistApprovalInstance(
  tx: ApprovalInstanceTx,
  plan: ApprovalInstancePlan,
): Promise<ApprovalInstancePlan & { id: string }> {
  try {
    const attempt = await nextAttemptNumber(tx, plan)
    const labels = await loadDisplayLabels(tx, plan.steps.flatMap((step) => [...step.candidateUserIds]))
    const instance = await tx.approval_instances.create({
      data: instanceRow(plan, attempt),
    })

    if (plan.state === 'AUTO_APPROVED') {
      await writeApprovalRow(tx, plan, {
        instanceId: instance.id,
        order: 1,
        status: 'approved',
        approverId: plan.originUserId,
        routingMode: 'SNAPSHOT_GROUP',
      })
      return { ...plan, attempt, id: instance.id }
    }

    for (const step of plan.steps) {
      const group = await tx.approval_candidate_groups.create({
        data: {
          approvalInstanceId: instance.id,
          requiredPositionId: step.requiredPositionId,
          scopeUnitId: step.scopeUnitId,
        },
      })
      for (const userId of step.candidateUserIds) {
        await tx.approval_candidate_group_members.create({
          data: {
            candidateGroupId: group.id,
            userId,
            capturedDisplayName: labels[userId] ?? userId,
          },
        })
      }
      await writeApprovalRow(tx, plan, {
        instanceId: instance.id,
        order: step.order,
        status: 'pending',
        routingMode: 'SNAPSHOT_GROUP',
        requiredPositionId: step.requiredPositionId,
        candidateGroupId: group.id,
      })
    }

    for (const skip of plan.skipped) {
      await tx.approval_instance_skips.create({
        data: {
          approvalInstanceId: instance.id,
          requiredPositionId: skip.requiredPositionId,
          reason: skip.reason,
        },
      })
    }

    return { ...plan, attempt, id: instance.id }
  } catch (error) {
    translateConflict(error)
  }
}
