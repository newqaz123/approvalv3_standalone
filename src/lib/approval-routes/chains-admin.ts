// Clean-start approval chains administration (Plan C Task 9). Replaces the
// legacy position-code route actions wholesale: scopes are organization
// UNITS (root defaults + unit exceptions), definitions are position-id step
// lists with a named approval-limit position, and candidate resolution is
// the option-A clean-start engine path (B2 selection + B3 candidates).
//
// Contract highlights pinned by tests/regression/clean-start-ui-chains.test.ts:
// - publishRoute REFUSES when B2 findLimitConflicts is non-empty: it returns
//   the flagged steps and writes NOTHING (no transaction is opened).
// - A successful publish retires the prior published version and inserts the
//   new one inside ONE Serializable transaction; the B1 partial unique index
//   one_published_route_per_scope_phase rejects a concurrent publisher.
// - testWithSubmitter is READ-ONLY: its db port exposes no write method, no
//   request rows, no snapshots, no publication. It resolves the exact
//   option-A candidate set a future attempt would snapshot (own-team
//   exact-position members ∪ reports-to/own-unit manager/ancestor holders,
//   deduplicated, inactive accounts excluded).
// - Root-default publication is a versioned route change that affects future
//   attempts only; it is NOT a global activation switch (copy lives in the
//   ApprovalChainsPanel component).
//

import {
  ApprovalRouteConfigurationError,
  findLimitConflicts,
  validateRouteDefinition,
} from '@/lib/approval-routes/definition'
import type {
  ApprovalPhase,
  ApprovalRouteVersionDefinition,
} from '@/lib/approval-routes/definition'
import { selectNearestRoute } from '@/lib/approval-routes/selection'
import { selectStepCandidates } from '@/lib/approval-engine/candidates'
import { isAttemptStranded } from '@/lib/approval-engine/decisions'
import { resolveReportingPath } from '@/lib/organization/reporting-path'
import type {
  AssignmentNode,
  OrganizationUnitNode,
  PositionNode,
  TeamNode,
} from '@/lib/organization/model'

const APPROVAL_PHASES: readonly ApprovalPhase[] = ['REQUEST', 'SOLUTION', 'FINAL']

export interface RouteStepInput {
  order: number
  positionId: string
}

export interface SaveRouteInput {
  scopeUnitId: string
  phase: ApprovalPhase
  approvalLimitPositionId: string
  steps: ReadonlyArray<RouteStepInput>
}

export interface RouteLimitConflict {
  order: number
  positionId: string
  problem: 'EXCEEDS_LIMIT'
}

export type PublishRouteOutcome =
  | { published: true; versionId: string; conflicts: [] }
  | { published: false; versionId: null; conflicts: ReadonlyArray<RouteLimitConflict> }

export interface SubmitterTestStep {
  order: number
  requiredPositionId: string
  positionName: string
  candidates: ReadonlyArray<{ id: string; name: string }>
  skipped: boolean
  skipReason?: 'VACANT_POSITION'
}

export interface SubmitterTestResult {
  source: 'ROOT_DEFAULT' | 'INHERITED' | 'CUSTOM' | 'DRAFT'
  scopeUnitId: string
  routeVersionId: string | 'DRAFT'
  autoApproved: boolean
  steps: ReadonlyArray<SubmitterTestStep>
  noEligibleSteps: boolean
}

export interface ApprovalChainsRouteVersion {
  versionId: string
  scopeUnitId: string
  phase: ApprovalPhase
  version: number
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
  approvalLimitPositionId: string | null
  steps: ReadonlyArray<RouteStepInput>
}

export interface StrandedAttemptSummary {
  instanceId: string
  phase: ApprovalPhase
  attempt: number
  requestId: string | null
  solutionId: string | null
  originUserId: string
}

export interface ApprovalChainsData {
  rootUnitId: string | null
  units: readonly OrganizationUnitNode[]
  positions: readonly PositionNode[]
  users: ReadonlyArray<{ id: string; name: string; isActive: boolean }>
  versions: readonly ApprovalChainsRouteVersion[]
  strandedAttempts: readonly StrandedAttemptSummary[]
}

// ---------------------------------------------------------------------------
// Write port (structural; tests inject an in-memory fake)
// ---------------------------------------------------------------------------

export interface ApprovalChainsWriteTx {
  nextVersionNumber(scopeUnitId: string, phase: ApprovalPhase): Promise<number>
  /** updateMany-style retire of PUBLISHED versions at the scope/phase. */
  retirePublishedVersions(scopeUnitId: string, phase: ApprovalPhase): Promise<number>
  insertRouteVersion(input: {
    scopeUnitId: string
    phase: ApprovalPhase
    version: number
    approvalLimitPositionId: string
    status: 'DRAFT' | 'PUBLISHED'
    adminUserId: string
    publishedAt: Date | null
    steps: ReadonlyArray<RouteStepInput>
  }): Promise<{ id: string }>
}

export interface ApprovalChainsWriteDb {
  adminUserId: string
  loadUnits(): Promise<OrganizationUnitNode[]>
  loadPositions(): Promise<PositionNode[]>
  /** Retire + insert run inside ONE transaction body. */
  runRouteTransaction<T>(body: (tx: ApprovalChainsWriteTx) => Promise<T>): Promise<T>
  revalidateWorkspace(): Promise<void>
}

// ---------------------------------------------------------------------------
// Read port (structural; NO write method exists on this surface)
// ---------------------------------------------------------------------------

export interface ApprovalChainsReadDb {
  loadUnits(): Promise<OrganizationUnitNode[]>
  loadPositions(): Promise<PositionNode[]>
  loadAssignments(): Promise<AssignmentNode[]>
  loadTeams(): Promise<TeamNode[]>
  loadUsers(): Promise<ReadonlyArray<{ id: string; name: string; isActive: boolean }>>
  loadRouteVersions(input: {
    scopeUnitIds: readonly string[]
    phase: ApprovalPhase
  }): Promise<ApprovalRouteVersionDefinition[]>
  loadStrandedAttempts(): Promise<
    ReadonlyArray<StrandedAttemptSummary & {
      candidateGroups: ReadonlyArray<{
        members: ReadonlyArray<{ userId: string; user: { isActive: boolean } }>
      }>
    }>
  >
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validatedPhase(phase: ApprovalPhase): ApprovalPhase {
  if (!APPROVAL_PHASES.includes(phase)) {
    throw new ApprovalRouteConfigurationError(
      `Route phase '${String(phase)}' is not a valid approval phase (REQUEST, SOLUTION, FINAL)`,
    )
  }
  return phase
}

function validatedScopeUnit(
  units: readonly OrganizationUnitNode[],
  scopeUnitId: string,
): OrganizationUnitNode {
  if (!scopeUnitId || typeof scopeUnitId !== 'string') {
    throw new ApprovalRouteConfigurationError('Route scope unit is required')
  }
  const unit = units.find((row) => row.id === scopeUnitId)
  if (!unit || !unit.isActive) {
    throw new ApprovalRouteConfigurationError(
      `Route scope unit '${scopeUnitId}' does not exist or is inactive`,
    )
  }
  return unit
}

function definitionFromInput(
  input: SaveRouteInput,
  status: 'DRAFT' | 'PUBLISHED',
): ApprovalRouteVersionDefinition {
  return {
    id: 'route-definition-input',
    scopeUnitId: input.scopeUnitId,
    phase: validatedPhase(input.phase),
    version: 0,
    approvalLimitPositionId: input.approvalLimitPositionId,
    status,
    steps: input.steps.map((step) => ({ order: step.order, positionId: step.positionId })),
  }
}

// ---------------------------------------------------------------------------
// publishRoute
// ---------------------------------------------------------------------------

/**
 * Publishes a new immutable version for the scope/phase. REFUSES first when
 * B2 findLimitConflicts is non-empty (a step sits above the approval limit):
 * returns the flagged steps and writes nothing. Otherwise validation runs
 * and the retire-published + insert-new pair executes inside ONE
 * transaction (the partial unique index one_published_route_per_scope_phase
 * rejects a concurrent publisher; the aborted transaction rolls back and the
 * previous published version survives). Publish affects future attempts
 * only.
 */
export async function publishRoute(
  input: SaveRouteInput,
  db?: ApprovalChainsWriteDb,
): Promise<PublishRouteOutcome> {
  const store = db ?? (await createProductionWriteDb())
  validatedPhase(input.phase)
  const [units, positions] = await Promise.all([store.loadUnits(), store.loadPositions()])
  validatedScopeUnit(units, input.scopeUnitId)
  const definition = definitionFromInput(input, 'PUBLISHED')
  const positionMap = new Map(positions.map((row) => [row.id, row]))

  const conflicts = findLimitConflicts(definition, positionMap)
  if (conflicts.length > 0) {
    // Refusal path: no transaction, no writes, prior published untouched.
    return { published: false, versionId: null, conflicts }
  }

  validateRouteDefinition(definition, positionMap)

  const created = await store.runRouteTransaction(async (tx) => {
    await tx.retirePublishedVersions(input.scopeUnitId, definition.phase)
    const version = await tx.nextVersionNumber(input.scopeUnitId, definition.phase)
    return tx.insertRouteVersion({
      scopeUnitId: input.scopeUnitId,
      phase: definition.phase,
      version,
      approvalLimitPositionId: input.approvalLimitPositionId,
      status: 'PUBLISHED',
      adminUserId: store.adminUserId,
      publishedAt: new Date(),
      steps: definition.steps,
    })
  })
  await store.revalidateWorkspace()
  return { published: true, versionId: created.id, conflicts: [] }
}

/**
 * Removes a unit-specific exception from future routing without deleting its
 * immutable route version. The company root is the default and cannot be
 * removed; a missing exception is rejected rather than silently succeeding.
 * Retiring the published version makes selectNearestRoute continue walking to
 * the nearest published ancestor while captured approval instances retain the
 * route/version they already reference.
 */
export async function deleteRouteException(
  input: { scopeUnitId: string; phase: ApprovalPhase },
  db?: ApprovalChainsWriteDb,
): Promise<{ success: true }> {
  const store = db ?? (await createProductionWriteDb())
  const phase = validatedPhase(input.phase)
  const units = await store.loadUnits()
  const scope = validatedScopeUnit(units, input.scopeUnitId)
  if (scope.parentId === null) {
    throw new ApprovalRouteConfigurationError(
      'The company root route is the default and cannot be deleted as a unit exception',
    )
  }

  const retired = await store.runRouteTransaction((tx) => (
    tx.retirePublishedVersions(scope.id, phase)
  ))
  if (retired === 0) {
    throw new ApprovalRouteConfigurationError(
      `No published unit exception exists for ${scope.id} ${phase}`,
    )
  }
  await store.revalidateWorkspace()
  return { success: true as const }
}

// ---------------------------------------------------------------------------
// getApprovalChainsData — read-only panel snapshot
// ---------------------------------------------------------------------------

/**
 * Company-wide chains panel snapshot: every unit/position/user plus every
 * route version (DRAFT + PUBLISHED, with steps) and the stranded attempts
 * (B5 predicate: members exist and every member of every group is
 * inactive). Read-only; production runs requireAdmin + Prisma, tests inject
 * ApprovalChainsReadDb.
 */
export async function getApprovalChainsData(
  db?: ApprovalChainsReadDb,
): Promise<ApprovalChainsData> {
  const store = db ?? (await createProductionReadDb())
  const [units, positions, users, strandedRecords] = await Promise.all([
    store.loadUnits(),
    store.loadPositions(),
    store.loadUsers(),
    store.loadStrandedAttempts(),
  ])
  const scopeUnitIds = units.map((row) => row.id)
  const versionLists = await Promise.all(
    APPROVAL_PHASES.map((phase) => store.loadRouteVersions({ scopeUnitIds, phase })),
  )
  const versions: ApprovalChainsRouteVersion[] = []
  for (const list of versionLists) {
    for (const row of list) {
      versions.push({
        versionId: row.id,
        scopeUnitId: row.scopeUnitId,
        phase: row.phase,
        version: row.version,
        status: row.status,
        approvalLimitPositionId: row.approvalLimitPositionId,
        steps: row.steps.map((step) => ({ order: step.order, positionId: step.positionId })),
      })
    }
  }
  versions.sort((left, right) => (
    left.phase.localeCompare(right.phase)
    || left.scopeUnitId.localeCompare(right.scopeUnitId)
    || right.version - left.version
  ))
  const root = units.find((row) => row.parentId === null && row.isActive) ?? null
  return {
    rootUnitId: root?.id ?? null,
    units,
    positions,
    users: users.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive })),
    versions,
    strandedAttempts: strandedRecords
      .filter((record) => isAttemptStranded(record))
      .map((record) => ({
        instanceId: record.instanceId,
        phase: record.phase,
        attempt: record.attempt,
        requestId: record.requestId,
        solutionId: record.solutionId,
        originUserId: record.originUserId,
      })),
  }
}

// ---------------------------------------------------------------------------
// testWithSubmitter — READ-ONLY option-A resolution
// ---------------------------------------------------------------------------

function classifySource(
  scopeUnitId: string,
  ownUnitId: string,
  rootUnitId: string | null,
): 'ROOT_DEFAULT' | 'INHERITED' | 'CUSTOM' {
  if (scopeUnitId === ownUnitId) return 'CUSTOM'
  if (rootUnitId !== null && scopeUnitId === rootUnitId) return 'ROOT_DEFAULT'
  return 'INHERITED'
}

/**
 * Resolves what a future attempt for this submitter would look like WITHOUT
 * creating requests, saving snapshots, or publishing anything: the winning
 * route (nearest published scope on the submitter's reporting branch, or a
 * validated in-memory draft substituted at that scope), then the exact B3
 * option-A candidate set per step (own-team exact-position members ∪ path
 * holders, deduplicated by user, inactive accounts excluded, origin never a
 * candidate). Steps at or below the submitter's rank are not required and
 * do not appear — identical to the engine builder. Empty active candidate
 * sets are reported as skipped VACANT_POSITION; autoApproved mirrors the
 * builder's origin-rank >= limit-rank rule; noEligibleSteps mirrors
 * COMPLETED_NO_ELIGIBLE_STEPS.
 */
export async function testWithSubmitter(
  input: {
    submitterUserId: string
    phase: ApprovalPhase
    draft?: {
      approvalLimitPositionId: string
      steps: ReadonlyArray<RouteStepInput>
    }
  },
  db?: ApprovalChainsReadDb,
): Promise<SubmitterTestResult> {
  const store = db ?? (await createProductionReadDb())
  const phase = validatedPhase(input.phase)

  const [units, positions, assignments, teams, users] = await Promise.all([
    store.loadUnits(),
    store.loadPositions(),
    store.loadAssignments(),
    store.loadTeams(),
    store.loadUsers(),
  ])
  const usersById = new Map(users.map((row) => [row.id, row]))
  const repo = {
    findUser: (userId: string) =>
      Promise.resolve(
        usersById.has(userId)
          ? { id: userId, isActive: usersById.get(userId)!.isActive }
          : null,
      ),
    loadUnits: () => Promise.resolve(units),
    loadPositions: () => Promise.resolve(positions),
    loadAssignments: () => Promise.resolve(assignments),
    loadTeams: () => Promise.resolve(teams),
  }
  const path = await resolveReportingPath(input.submitterUserId, repo)
  if (path === null) {
    throw new ApprovalRouteConfigurationError(
      `No reporting path for submitter ${input.submitterUserId} (inactive, missing, or unassigned)`,
    )
  }

  const positionMap = new Map(positions.map((row) => [row.id, row]))
  const routes = await store.loadRouteVersions({
    scopeUnitIds: path.unitPath,
    phase,
  })
  // Nearest published baseline on the branch: the scope the editor is
  // customizing. Also fails closed when the branch has no published route.
  const baseline = selectNearestRoute(path.unitPath, routes, phase)
  validateRouteDefinition(baseline, positionMap)

  let selected: ApprovalRouteVersionDefinition
  let routeVersionId: string
  let source: SubmitterTestResult['source']
  if (input.draft) {
    const draftDefinition = definitionFromInput(
      {
        scopeUnitId: baseline.scopeUnitId,
        phase,
        approvalLimitPositionId: input.draft.approvalLimitPositionId,
        steps: input.draft.steps,
      },
      'DRAFT',
    )
    validateRouteDefinition(draftDefinition, positionMap)
    selected = draftDefinition
    routeVersionId = 'DRAFT'
    source = 'DRAFT'
  } else {
    selected = baseline
    routeVersionId = baseline.id
    const root = units.find((row) => row.parentId === null && row.isActive) ?? null
    source = classifySource(selected.scopeUnitId, path.unitId, root?.id ?? null)
  }

  const originPosition = positionMap.get(path.positionId)
  if (!originPosition || !Number.isFinite(originPosition.rank)) {
    throw new ApprovalRouteConfigurationError(`Unknown submitter position: ${path.positionId}`)
  }
  const limitPosition = positionMap.get(selected.approvalLimitPositionId)
  if (!limitPosition || !Number.isFinite(limitPosition.rank)) {
    throw new ApprovalRouteConfigurationError(
      `Unknown approval limit position: ${selected.approvalLimitPositionId}`,
    )
  }
  const originRank = originPosition.rank
  const limitRank = limitPosition.rank

  if (originRank >= limitRank) {
    return {
      source,
      scopeUnitId: selected.scopeUnitId,
      routeVersionId,
      autoApproved: true,
      steps: [],
      noEligibleSteps: false,
    }
  }

  const ownTeamMemberAssignments = path.teamId
    ? assignments.filter((row) => row.isActive && row.teamId === path.teamId)
    : []

  const steps: SubmitterTestStep[] = []
  for (const step of selected.steps) {
    const stepPosition = positionMap.get(step.positionId)
    if (!stepPosition || !Number.isFinite(stepPosition.rank)) {
      throw new ApprovalRouteConfigurationError(`Unknown route position: ${step.positionId}`)
    }
    const stepRank = stepPosition.rank
    if (stepRank <= originRank) continue // not required for this submitter
    if (stepRank > limitRank) continue // defensive parity with the builder
    const selectedCandidates = selectStepCandidates({
      path,
      requiredPositionId: step.positionId,
      ownTeamMemberAssignments,
    })
    const candidates = selectedCandidates
      .map((candidate) => usersById.get(candidate.userId))
      .filter((user): user is { id: string; name: string; isActive: boolean } =>
        user !== undefined && user.isActive)
      .map((user) => ({ id: user.id, name: user.name }))
    if (candidates.length === 0) {
      steps.push({
        order: step.order,
        requiredPositionId: step.positionId,
        positionName: stepPosition.name,
        candidates: [],
        skipped: true,
        skipReason: 'VACANT_POSITION',
      })
      continue
    }
    steps.push({
      order: step.order,
      requiredPositionId: step.positionId,
      positionName: stepPosition.name,
      candidates,
      skipped: false,
    })
  }

  return {
    source,
    scopeUnitId: selected.scopeUnitId,
    routeVersionId,
    autoApproved: false,
    steps,
    // Builder parity: COMPLETED_NO_ELIGIBLE_STEPS fires when no LIVE step
    // remains — every step was either vacant or not required for this
    // submitter.
    noEligibleSteps: steps.length === 0 || steps.every((step) => step.skipped),
  }
}

// ---------------------------------------------------------------------------
// Production adapters (structural Prisma casts; dynamic imports keep the
// module import-safe in tests)
// ---------------------------------------------------------------------------

type UnitRow = {
  id: string
  name: string
  parentId: string | null
  isActive: boolean
  shareRequests: boolean
  canWorkOnSolutions: boolean
  managerUserId: string | null
}
type PositionRow = { id: string; name: string; rank: number; isActive: boolean }
type AssignmentRow = {
  id: string
  userId: string
  unitId: string
  positionId: string
  teamId: string | null
  isActive: boolean
}
type TeamRow = {
  id: string
  unitId: string
  name: string
  reportsToAssignmentId: string
  isActive: boolean
}

type ChainsPrisma = {
  organization_units: { findMany: (args?: object) => Promise<UnitRow[]> }
  positions: { findMany: (args?: object) => Promise<PositionRow[]> }
  organization_assignments: { findMany: (args?: object) => Promise<AssignmentRow[]> }
  teams: { findMany: (args?: object) => Promise<TeamRow[]> }
  user: {
    findMany: (args?: object) => Promise<Array<{ id: string; name: string; isActive: boolean }>>
  }
  approval_route_versions: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      scopeUnitId: string
      phase: ApprovalPhase
      version: number
      status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
      approvalLimitPositionId: string | null
    }>>
    findFirst: (args: object) => Promise<{ version: number } | null>
    updateMany: (args: object) => Promise<{ count: number }>
    create: (args: object) => Promise<{ id: string }>
  }
  approval_route_steps: {
    findMany: (args?: object) => Promise<Array<{
      routeVersionId: string
      stepOrder: number
      positionId: string | null
    }>>
    createMany: (args: object) => Promise<unknown>
  }
  approval_instances: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      phase: ApprovalPhase
      requestId: string | null
      solutionId: string | null
      originUserId: string
      attempt: number
      candidateGroups: Array<{ members: Array<{ userId: string }> }>
    }>>
  }
  $transaction?: <T>(
    fn: (tx: ChainsPrisma) => Promise<T>,
    options: { isolationLevel: 'Serializable' },
  ) => Promise<T>
}

function toUnitNode(row: UnitRow): OrganizationUnitNode {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    isActive: row.isActive,
    shareRequests: row.shareRequests,
    canWorkOnSolutions: row.canWorkOnSolutions,
    managerUserId: row.managerUserId,
  }
}

function toPositionNode(row: PositionRow): PositionNode {
  return { id: row.id, name: row.name, rank: row.rank, isActive: row.isActive }
}

function toAssignmentNode(row: AssignmentRow): AssignmentNode {
  return {
    id: row.id,
    userId: row.userId,
    unitId: row.unitId,
    positionId: row.positionId,
    teamId: row.teamId,
    isActive: row.isActive,
  }
}

function toTeamNode(row: TeamRow): TeamNode {
  return {
    id: row.id,
    unitId: row.unitId,
    name: row.name,
    reportsToAssignmentId: row.reportsToAssignmentId,
    isActive: row.isActive,
  }
}

async function loadPrismaClient(): Promise<ChainsPrisma> {
  const { default: prisma } = await import('@/lib/prisma')
  return prisma as unknown as ChainsPrisma
}

async function requireChainsAdmin(): Promise<string> {
  const { requireAdmin } = await import('@/lib/auth')
  const adminId = await requireAdmin()
  if (!adminId) {
    throw new Error('Admin authorization is required for approval chains actions')
  }
  return adminId
}

function createProductionWriteTx(client: ChainsPrisma): ApprovalChainsWriteTx {
  return {
    async nextVersionNumber(scopeUnitId, phase) {
      const latest = await client.approval_route_versions.findFirst({
        where: { scopeUnitId, phase },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      return (latest?.version ?? 0) + 1
    },
    async retirePublishedVersions(scopeUnitId, phase) {
      const result = await client.approval_route_versions.updateMany({
        where: { scopeUnitId, phase, status: 'PUBLISHED' },
        data: { status: 'RETIRED' },
      })
      return result.count
    },
    async insertRouteVersion(input) {
      const route = await client.approval_route_versions.create({
        data: {
          scopeUnitId: input.scopeUnitId,
          phase: input.phase,
          version: input.version,
          status: input.status,
          createdById: input.adminUserId,
          publishedAt: input.publishedAt,
          approvalLimitPositionId: input.approvalLimitPositionId,
        },
      })
      if (input.steps.length > 0) {
        await client.approval_route_steps.createMany({
          data: input.steps.map((step) => ({
            routeVersionId: route.id,
            stepOrder: step.order,
            positionId: step.positionId,
          })),
        })
      }
      return { id: route.id }
    },
  }
}

async function createProductionWriteDb(): Promise<ApprovalChainsWriteDb> {
  const adminUserId = await requireChainsAdmin()
  const client = await loadPrismaClient()
  return {
    adminUserId,
    async loadUnits() {
      return (await client.organization_units.findMany()).map(toUnitNode)
    },
    async loadPositions() {
      return (await client.positions.findMany()).map(toPositionNode)
    },
    async runRouteTransaction(body) {
      if (client.$transaction === undefined) {
        return body(createProductionWriteTx(client))
      }
      return client.$transaction(
        (tx) => body(createProductionWriteTx(tx)),
        { isolationLevel: 'Serializable' },
      )
    },
    async revalidateWorkspace() {
      const { revalidatePath } = await import('next/cache')
      revalidatePath('/admin/organization')
    },
  }
}

function createProductionReadDbFromClient(client: ChainsPrisma): ApprovalChainsReadDb {
  return {
    async loadUnits() {
      return (await client.organization_units.findMany()).map(toUnitNode)
    },
    async loadPositions() {
      return (await client.positions.findMany()).map(toPositionNode)
    },
    async loadAssignments() {
      return (await client.organization_assignments.findMany()).map(toAssignmentNode)
    },
    async loadTeams() {
      return (await client.teams.findMany()).map(toTeamNode)
    },
    async loadUsers() {
      return client.user.findMany({ select: { id: true, name: true, isActive: true } })
    },
    async loadRouteVersions(input) {
      const ids = [...input.scopeUnitIds]
      if (ids.length === 0) return []
      const versions = await client.approval_route_versions.findMany({
        where: { scopeUnitId: { in: ids }, phase: input.phase },
      })
      if (versions.length === 0) return []
      const steps = await client.approval_route_steps.findMany({
        where: { routeVersionId: { in: versions.map((version) => version.id) } },
        orderBy: { stepOrder: 'asc' },
      })
      return versions.flatMap((version) => {
        if (!version.approvalLimitPositionId) return []
        return [{
          id: version.id,
          scopeUnitId: version.scopeUnitId,
          phase: version.phase,
          version: version.version,
          approvalLimitPositionId: version.approvalLimitPositionId,
          status: version.status,
          steps: steps
            .filter((step) => step.routeVersionId === version.id && step.positionId)
            .map((step) => ({ order: step.stepOrder, positionId: step.positionId as string })),
        }]
      })
    },
    async loadStrandedAttempts() {
      const instances = await client.approval_instances.findMany({
        where: { supersededAt: null, state: 'PENDING' },
        include: {
          candidateGroups: { include: { members: { select: { userId: true } } } },
        },
      })
      if (instances.length === 0) return []
      const memberIds = [
        ...new Set(
          instances.flatMap((instance) =>
            instance.candidateGroups.flatMap((group) => group.members.map((member) => member.userId)),
          ),
        ),
      ]
      const users = memberIds.length === 0
        ? []
        : await client.user.findMany({
            where: { id: { in: memberIds } },
            select: { id: true, isActive: true },
          })
      const activeById = new Map(users.map((user) => [user.id, user.isActive]))
      return instances.map((instance) => ({
        instanceId: instance.id,
        phase: instance.phase,
        attempt: instance.attempt,
        requestId: instance.requestId,
        solutionId: instance.solutionId,
        originUserId: instance.originUserId,
        candidateGroups: instance.candidateGroups.map((group) => ({
          members: group.members.map((member) => ({
            userId: member.userId,
            user: { isActive: activeById.get(member.userId) === true },
          })),
        })),
      }))
    },
  }
}

async function createProductionReadDb(): Promise<ApprovalChainsReadDb> {
  await requireChainsAdmin()
  const client = await loadPrismaClient()
  return createProductionReadDbFromClient(client)
}
