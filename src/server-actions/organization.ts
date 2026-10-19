'use server'

import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/definition'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import { selectNearestRoute } from '@/lib/approval-routes/selection'
import type { ApprovalRouteVersionDefinition } from '@/lib/approval-routes/definition'
import { verifyCleanStartReadiness } from '@/lib/clean-start-readiness'
import type { ReadinessReport } from '@/lib/clean-start-readiness'
import { OrganizationValidationError, validateOrganization } from '@/lib/organization/assignments'
import { assessPositionRankChange } from '@/lib/organization/position-rank-guard'
import type { RankChangeImpact } from '@/lib/organization/position-rank-guard'
import type {
  AssignmentNode,
  OrganizationUnitNode,
  PositionNode,
  TeamNode,
} from '@/lib/organization/model'

export type { RankChangeImpact }

const PHASES: readonly ApprovalPhase[] = ['REQUEST', 'SOLUTION', 'FINAL']

export type RouteSourceKind = 'ROOT_DEFAULT' | 'INHERITED' | 'CUSTOM'

export interface WorkspaceRouteStep {
  order: number
  positionId: string
}

export interface WorkspaceRouteVersion {
  id: string
  scopeUnitId: string
  phase: ApprovalPhase
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
  /** Present for production snapshots; optional for legacy test/read ports. */
  version?: number
  approvalLimitPositionId?: string | null
  steps?: ReadonlyArray<WorkspaceRouteStep>
}

export interface WorkspaceUser {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
}

export interface OrganizationWorkspaceDb {
  loadUnits(): Promise<OrganizationUnitNode[]>
  loadPositions(): Promise<PositionNode[]>
  loadAssignments(): Promise<AssignmentNode[]>
  loadTeams(): Promise<TeamNode[]>
  loadUsers(): Promise<WorkspaceUser[]>
  loadRouteVersions(): Promise<WorkspaceRouteVersion[]>
  loadCustomChainExceptions(): Promise<Array<{ requestId: string; title: string }>>
}

export interface WorkspaceSnapshot {
  units: readonly OrganizationUnitNode[]
  positions: readonly PositionNode[]
  assignments: readonly AssignmentNode[]
  teams: readonly TeamNode[]
  users: ReadonlyArray<WorkspaceUser>
  unassignedUsers: ReadonlyArray<{ id: string; name: string; email: string }>
  routeSources: ReadonlyArray<{
    unitId: string
    phase: ApprovalPhase
    source: RouteSourceKind
    sourceUnitId: string | null
    publishedVersionId: string | null
    hasDraft: boolean
    /** Actual ordered steps from the selected published version. */
    steps?: ReadonlyArray<WorkspaceRouteStep & { positionName: string | null }>
    approvalLimitPositionId?: string | null
    approvalLimitName?: string | null
  }>
  customChainExceptions: ReadonlyArray<{ requestId: string; title: string }>
  readiness: ReadinessReport
}

type WorkspacePrisma = {
  organization_units: {
    findMany: (args?: object) => Promise<Array<{
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
    findMany: (args?: object) => Promise<Array<{
      id: string
      name: string
      rank: number
      isActive: boolean
    }>>
  }
  organization_assignments: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      userId: string
      unitId: string
      positionId: string
      teamId: string | null
      isActive: boolean
    }>>
  }
  teams: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      unitId: string
      name: string
      reportsToAssignmentId: string
      isActive: boolean
    }>>
  }
  user: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      name: string
      email: string
      role: string
      isActive: boolean
    }>>
  }
  approval_route_versions: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      scopeUnitId: string
      phase: string
      version: number
      status: string
      approvalLimitPositionId: string | null
    }>>
  }
  approval_route_steps: {
    findMany: (args?: object) => Promise<Array<{
      routeVersionId: string
      stepOrder: number
      positionId: string
    }>>
  }
  requests: {
    findMany: (args?: object) => Promise<Array<{ id: string; title: string }>>
  }
}

function ancestorScopeIds(units: readonly OrganizationUnitNode[], unitId: string): string[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const path: string[] = []
  const seen = new Set<string>()
  let current: string | null = unitId
  while (current) {
    if (seen.has(current)) {
      throw new Error(`organization unit cycle at ${current}`)
    }
    seen.add(current)
    path.push(current)
    current = byId.get(current)?.parentId ?? null
  }
  return path
}

function asRouteDefinition(row: WorkspaceRouteVersion): ApprovalRouteVersionDefinition {
  return {
    id: row.id,
    scopeUnitId: row.scopeUnitId,
    phase: row.phase,
    version: row.version ?? 1,
    // Route selection only needs the identity while this snapshot is being
    // classified. Production rows always carry the actual limit; the
    // compatibility sentinel keeps older injected read ports selectable.
    approvalLimitPositionId: row.approvalLimitPositionId ?? '_workspace-read-only',
    status: row.status,
    steps: [...(row.steps ?? [])]
      .map((step) => ({ order: step.order, positionId: step.positionId }))
      .sort((left, right) => left.order - right.order),
  }
}

function classifyRouteSources(
  units: readonly OrganizationUnitNode[],
  positions: readonly PositionNode[],
  routes: readonly WorkspaceRouteVersion[],
): WorkspaceSnapshot['routeSources'] {
  const root = units.find((unit) => unit.parentId === null) ?? null
  const positionsById = new Map(positions.map((position) => [position.id, position]))
  const defs = routes.map(asRouteDefinition)
  const rows: Array<WorkspaceSnapshot['routeSources'][number]> = []
  for (const unit of units) {
    const path = ancestorScopeIds(units, unit.id)
    for (const phase of PHASES) {
      const hasDraft = routes.some(
        (route) => route.scopeUnitId === unit.id && route.phase === phase && route.status === 'DRAFT',
      )
      try {
        const selected = selectNearestRoute(path, defs, phase)
        let source: RouteSourceKind
        let sourceUnitId: string | null
        if (root && unit.id === root.id && selected.scopeUnitId === root.id) {
          source = 'ROOT_DEFAULT'
          sourceUnitId = root.id
        } else if (selected.scopeUnitId === unit.id) {
          source = 'CUSTOM'
          sourceUnitId = unit.id
        } else if (root && selected.scopeUnitId === root.id) {
          source = 'ROOT_DEFAULT'
          sourceUnitId = root.id
        } else {
          source = 'INHERITED'
          sourceUnitId = selected.scopeUnitId
        }
        rows.push({
          unitId: unit.id,
          phase,
          source,
          sourceUnitId,
          publishedVersionId: selected.id,
          hasDraft,
          steps: selected.steps.map((step) => ({
            order: step.order,
            positionId: step.positionId,
            positionName: positionsById.get(step.positionId)?.name ?? null,
          })),
          approvalLimitPositionId: selected.approvalLimitPositionId === '_workspace-read-only'
            ? null
            : selected.approvalLimitPositionId,
          approvalLimitName: selected.approvalLimitPositionId === '_workspace-read-only'
            ? null
            : positionsById.get(selected.approvalLimitPositionId)?.name ?? null,
        })
      } catch (error) {
        if (error instanceof ApprovalRouteConfigurationError && /No published route/.test(error.message)) {
          continue
        }
        throw error
      }
    }
  }
  return rows
}

function countPublishedRootRoutesByPhase(
  units: readonly OrganizationUnitNode[],
  routes: readonly WorkspaceRouteVersion[],
): Record<ApprovalPhase, number> {
  const root = units.find((unit) => unit.parentId === null)
  const counts: Record<ApprovalPhase, number> = { REQUEST: 0, SOLUTION: 0, FINAL: 0 }
  if (!root) return counts
  for (const phase of PHASES) {
    counts[phase] = routes.filter(
      (route) => route.scopeUnitId === root.id && route.phase === phase && route.status === 'PUBLISHED',
    ).length
  }
  return counts
}

function createPrismaOrganizationWorkspaceDb(prisma: WorkspacePrisma): OrganizationWorkspaceDb {
  return {
    async loadUnits() {
      const rows = await prisma.organization_units.findMany()
      return rows.map((row) => ({
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
      const rows = await prisma.positions.findMany()
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        rank: row.rank,
        isActive: row.isActive,
      }))
    },
    async loadAssignments() {
      const rows = await prisma.organization_assignments.findMany()
      return rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        unitId: row.unitId,
        positionId: row.positionId,
        teamId: row.teamId,
        isActive: row.isActive,
      }))
    },
    async loadTeams() {
      const rows = await prisma.teams.findMany()
      return rows.map((row) => ({
        id: row.id,
        unitId: row.unitId,
        name: row.name,
        reportsToAssignmentId: row.reportsToAssignmentId,
        isActive: row.isActive,
      }))
    },
    async loadUsers() {
      const rows = await prisma.user.findMany()
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        isActive: row.isActive,
      }))
    },
    async loadRouteVersions() {
      // Load route definitions and all of their steps once for the workspace
      // snapshot. The UI resolves each unit from this in-memory graph rather
      // than issuing one route/step query per tree node.
      const rows = await prisma.approval_route_versions.findMany()
      const steps = rows.length === 0
        ? []
        : await prisma.approval_route_steps.findMany({
            where: { routeVersionId: { in: rows.map((row) => row.id) } },
            orderBy: { stepOrder: 'asc' },
          })
      const stepsByRoute = new Map<string, WorkspaceRouteStep[]>()
      for (const step of steps) {
        const routeSteps = stepsByRoute.get(step.routeVersionId) ?? []
        routeSteps.push({ order: step.stepOrder, positionId: step.positionId })
        stepsByRoute.set(step.routeVersionId, routeSteps)
      }
      return rows.map((row) => ({
        id: row.id,
        scopeUnitId: row.scopeUnitId,
        phase: row.phase as ApprovalPhase,
        version: row.version,
        status: row.status as WorkspaceRouteVersion['status'],
        approvalLimitPositionId: row.approvalLimitPositionId,
        steps: stepsByRoute.get(row.id) ?? [],
      }))
    },
    async loadCustomChainExceptions() {
      const rows = await prisma.requests.findMany({
        where: { isDeleted: false, approvals: { some: { routingMode: 'CUSTOM_PERSON' } } },
        select: { id: true, title: true },
      })
      return rows.map((row) => ({ requestId: row.id, title: row.title }))
    },
  }
}

async function createProductionWorkspaceDb(): Promise<OrganizationWorkspaceDb> {
  const { requireAdmin } = await import('@/lib/auth')
  const adminId = await requireAdmin()
  if (!adminId) {
    throw new Error('Admin authorization is required for organization actions')
  }
  const { default: prisma } = await import('@/lib/prisma')
  return createPrismaOrganizationWorkspaceDb(prisma as unknown as WorkspacePrisma)
}

/**
 * Admin organization workspace snapshot. Production (no db argument) runs
 * requireAdmin then reads Prisma. Tests inject an in-memory OrganizationWorkspaceDb.
 * routeSources use the B2 nearest-published walk, read-only.
 */
export async function getOrganizationWorkspaceData(
  db?: OrganizationWorkspaceDb,
): Promise<WorkspaceSnapshot> {
  const store = db ?? await createProductionWorkspaceDb()
  const [units, positions, assignments, teams, users, routes, customChainExceptions] = await Promise.all([
    store.loadUnits(),
    store.loadPositions(),
    store.loadAssignments(),
    store.loadTeams(),
    store.loadUsers(),
    store.loadRouteVersions(),
    store.loadCustomChainExceptions(),
  ])

  const assignedUserIds = new Set(
    assignments.filter((assignment) => assignment.isActive).map((assignment) => assignment.userId),
  )
  const unassignedUsers = users
    .filter((user) => user.isActive && !assignedUserIds.has(user.id))
    .map((user) => ({ id: user.id, name: user.name, email: user.email }))

  const routeSources = classifyRouteSources(units, positions, routes)
  const publishedRootCounts = countPublishedRootRoutesByPhase(units, routes)
  const readiness = await verifyCleanStartReadiness({
    loadUnits: async () => units,
    loadPositions: async () => positions,
    loadAssignments: async () => assignments,
    loadTeams: async () => teams,
    countPublishedRoutesByPhase: async () => publishedRootCounts,
  })

  return {
    units,
    positions,
    assignments,
    teams,
    users,
    unassignedUsers,
    routeSources,
    customChainExceptions,
    readiness,
  }
}

export interface OrganizationMutationDb {
  adminUserId: string
  loadUnits(): Promise<OrganizationUnitNode[]>
  loadTeams(): Promise<TeamNode[]>
  updateUnitName(id: string, name: string): Promise<void>
  updateTeamName(id: string, name: string): Promise<void>
  writeAudit(entry: { action: string; comments: string }): Promise<void>
  revalidateOrganization(): Promise<void>
  runSerializable<T>(fn: (tx: OrganizationMutationDb) => Promise<T>): Promise<T>
}

export interface OrganizationUnitMutationDb extends OrganizationMutationDb {
  loadAssignments(): Promise<AssignmentNode[]>
  loadPositions(): Promise<PositionNode[]>
  loadUsers(): Promise<WorkspaceUser[]>
  createUnit(input: { name: string; parentId: string }): Promise<{ id: string }>
  updateUnitSettings(id: string, shareRequests: boolean, canWorkOnSolutions: boolean): Promise<void>
  updateUnitManager(unitId: string, managerUserId: string | null): Promise<void>
}

export interface OrganizationUnitDeactivationDb extends OrganizationMutationDb {
  loadAssignments(): Promise<AssignmentNode[]>
  loadPositions(): Promise<PositionNode[]>
  loadUsers(): Promise<WorkspaceUser[]>
  /** DRAFT or PUBLISHED route versions scoped to one unit (deactivation guard). */
  loadRouteVersionsForUnit(unitId: string): Promise<ReadonlyArray<{ id: string; phase: string; status: string }>>
  deactivateUnit(id: string): Promise<void>
}

export interface OrganizationTeamDeactivationDb extends OrganizationMutationDb {
  loadAssignments(): Promise<AssignmentNode[]>
  loadPositions(): Promise<PositionNode[]>
  loadUsers(): Promise<WorkspaceUser[]>
  deactivateTeam(id: string): Promise<void>
}

export interface OrganizationAssignmentMutationDb extends OrganizationUnitMutationDb {
  createAssignment(input: {
    userId: string
    unitId: string
    positionId: string
    teamId: string | null
  }): Promise<{ id: string }>
  updateAssignment(id: string, input: {
    unitId: string
    positionId: string
    teamId: string | null
  }): Promise<void>
  deactivateAssignment(id: string, deactivatedAt: Date): Promise<void>
  updateTeamReportsTo(teamId: string, reportsToAssignmentId: string): Promise<void>
}

export interface OrganizationTeamMutationDb extends OrganizationAssignmentMutationDb {
  createTeam(input: {
    unitId: string
    name: string
    reportsToAssignmentId: string
  }): Promise<{ id: string }>
  setAssignmentTeam(id: string, teamId: string | null): Promise<void>
}

export interface OrganizationPositionMutationDb extends OrganizationTeamMutationDb {
  createPosition(input: { name: string; rank: number }): Promise<{ id: string }>
  updatePositionName(id: string, name: string): Promise<void>
  updatePositionRank(id: string, rank: number): Promise<void>
  deactivatePosition(id: string): Promise<void>
  /** Inverse of deactivate; optional so harness fakes need not implement it. */
  reactivatePosition?(id: string): Promise<void>
  /** Hard delete. Optional; the production writer enforces reference guards. */
  deletePosition?(id: string): Promise<void>
  /** PUBLISHED route versions only (guard caller contract: drafts never block). */
  loadPublishedRoutes(): Promise<ReadonlyArray<{
    id: string
    scopeUnitId: string
    phase: ApprovalPhase
    approvalLimitPositionId: string | null
    steps: ReadonlyArray<{ stepOrder: number; positionId: string | null }>
  }>>
}

const ORGANIZATION_MUTATION_ISOLATION = 'Serializable' as const

type MutationPrisma = {
  $transaction?: (
    fn: (tx: MutationPrisma) => Promise<unknown>,
    options: { isolationLevel: typeof ORGANIZATION_MUTATION_ISOLATION },
  ) => Promise<unknown>
  organization_units: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      name: string
      parentId: string | null
      isActive: boolean
      shareRequests: boolean
      canWorkOnSolutions: boolean
      managerUserId: string | null
    }>>
    update: (args: {
      where: { id: string }
      data: {
        name?: string
        shareRequests?: boolean
        canWorkOnSolutions?: boolean
        managerUserId?: string | null
        isActive?: boolean
      }
    }) => Promise<unknown>
    create: (args: {
      data: {
        name: string
        parentId: string
        shareRequests: boolean
        canWorkOnSolutions: boolean
        isActive: boolean
      }
    }) => Promise<{ id: string }>
  }
  teams: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      unitId: string
      name: string
      reportsToAssignmentId: string
      isActive: boolean
    }>>
    update: (args: {
      where: { id: string }
      data: { name?: string; reportsToAssignmentId?: string; isActive?: boolean }
    }) => Promise<unknown>
    create: (args: {
      data: {
        unitId: string
        name: string
        reportsToAssignmentId: string
        isActive: boolean
      }
    }) => Promise<{ id: string }>
  }
  organization_assignments: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      userId: string
      unitId: string
      positionId: string
      teamId: string | null
      isActive: boolean
    }>>
    count: (args?: object) => Promise<number>
    create: (args: {
      data: {
        userId: string
        unitId: string
        positionId: string
        teamId: string | null
        isActive: boolean
      }
    }) => Promise<{ id: string }>
    update: (args: {
      where: { id: string }
      data: {
        unitId?: string
        positionId?: string
        teamId?: string | null
        isActive?: boolean
        deactivatedAt?: Date | null
      }
    }) => Promise<unknown>
  }
  positions: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      name: string
      rank: number
      isActive: boolean
    }>>
    create: (args: {
      data: { name: string; rank: number; isActive: boolean }
    }) => Promise<{ id: string }>
    update: (args: {
      where: { id: string }
      data: { name?: string; rank?: number; isActive?: boolean }
    }) => Promise<unknown>
    delete: (args: { where: { id: string } }) => Promise<unknown>
  }
  approval_route_versions: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      scopeUnitId: string
      phase: string
      status: string
      approvalLimitPositionId: string | null
    }>>
    count: (args?: object) => Promise<number>
  }
  approval_route_steps: {
    findMany: (args?: object) => Promise<Array<{
      routeVersionId: string
      stepOrder: number
      positionId: string | null
    }>>
    count: (args?: object) => Promise<number>
  }
  approval_candidate_groups: {
    count: (args?: object) => Promise<number>
  }
  approval_instance_skips: {
    count: (args?: object) => Promise<number>
  }
  approval_instances: {
    count: (args?: object) => Promise<number>
  }
  request_approvals: {
    count: (args?: object) => Promise<number>
  }
  solution_approvals: {
    count: (args?: object) => Promise<number>
  }
  user: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      name: string
      email: string
      role: string
      isActive: boolean
    }>>
  }
  request_activities: {
    create: (args: { data: { action: string; comments: string; userId: string } }) => Promise<unknown>
  }
}

function requireTrimmedName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new OrganizationValidationError('Name is required')
  }
  return trimmed
}

function isUniqueOrSerializationConflict(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
  if (code === 'P2002' || code === 'P2034' || code === '40001') return true
  const message = error instanceof Error ? error.message : String(error)
  return /could not serialize|serialization failure|40001/i.test(message)
}

function createMutationStore(
  client: MutationPrisma,
  adminId: string,
  serializable: boolean,
): OrganizationPositionMutationDb & OrganizationUnitDeactivationDb & OrganizationTeamDeactivationDb {
  const store: OrganizationPositionMutationDb & OrganizationUnitDeactivationDb & OrganizationTeamDeactivationDb = {
    adminUserId: adminId,
    async loadUnits() {
      const rows = await client.organization_units.findMany()
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        isActive: row.isActive,
        shareRequests: row.shareRequests,
        canWorkOnSolutions: row.canWorkOnSolutions,
        managerUserId: row.managerUserId,
      }))
    },
    async loadTeams() {
      const rows = await client.teams.findMany()
      return rows.map((row) => ({
        id: row.id,
        unitId: row.unitId,
        name: row.name,
        reportsToAssignmentId: row.reportsToAssignmentId,
        isActive: row.isActive,
      }))
    },
    async loadAssignments() {
      const rows = await client.organization_assignments.findMany()
      return rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        unitId: row.unitId,
        positionId: row.positionId,
        teamId: row.teamId,
        isActive: row.isActive,
      }))
    },
    async loadPositions() {
      const rows = await client.positions.findMany()
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        rank: row.rank,
        isActive: row.isActive,
      }))
    },
    async loadUsers() {
      const rows = await client.user.findMany()
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        isActive: row.isActive,
      }))
    },
    async updateUnitName(id, name) {
      await client.organization_units.update({ where: { id }, data: { name } })
    },
    async updateTeamName(id, name) {
      await client.teams.update({ where: { id }, data: { name } })
    },
    async createUnit(input) {
      const row = await client.organization_units.create({
        data: {
          name: input.name,
          parentId: input.parentId,
          shareRequests: true,
          canWorkOnSolutions: false,
          isActive: true,
        },
      })
      return { id: row.id }
    },
    async updateUnitSettings(id, shareRequests, canWorkOnSolutions) {
      await client.organization_units.update({
        where: { id },
        data: { shareRequests, canWorkOnSolutions },
      })
    },
    async updateUnitManager(unitId, managerUserId) {
      await client.organization_units.update({
        where: { id: unitId },
        data: { managerUserId },
      })
    },
    async deactivateUnit(id) {
      await client.organization_units.update({
        where: { id },
        data: { isActive: false },
      })
    },
    async deactivateTeam(id) {
      await client.teams.update({
        where: { id },
        data: { isActive: false },
      })
    },
    async loadRouteVersionsForUnit(unitId) {
      const rows = await client.approval_route_versions.findMany({
        where: { scopeUnitId: unitId },
      })
      return rows
        .filter((row) => row.status === 'DRAFT' || row.status === 'PUBLISHED')
        .map((row) => ({ id: row.id, phase: row.phase, status: row.status }))
    },
    async createAssignment(input) {
      const row = await client.organization_assignments.create({
        data: {
          userId: input.userId,
          unitId: input.unitId,
          positionId: input.positionId,
          teamId: input.teamId,
          isActive: true,
        },
      })
      return { id: row.id }
    },
    async updateAssignment(id, input) {
      await client.organization_assignments.update({
        where: { id },
        data: {
          unitId: input.unitId,
          positionId: input.positionId,
          teamId: input.teamId,
        },
      })
    },
    async deactivateAssignment(id, deactivatedAt) {
      await client.organization_assignments.update({
        where: { id },
        data: { isActive: false, deactivatedAt },
      })
    },
    async updateTeamReportsTo(teamId, reportsToAssignmentId) {
      await client.teams.update({
        where: { id: teamId },
        data: { reportsToAssignmentId },
      })
    },
    async createTeam(input) {
      const row = await client.teams.create({
        data: {
          unitId: input.unitId,
          name: input.name,
          reportsToAssignmentId: input.reportsToAssignmentId,
          isActive: true,
        },
      })
      return { id: row.id }
    },
    async setAssignmentTeam(id, teamId) {
      await client.organization_assignments.update({
        where: { id },
        data: { teamId },
      })
    },
    async createPosition(input) {
      const row = await client.positions.create({
        data: {
          name: input.name,
          rank: input.rank,
          isActive: true,
        },
      })
      return { id: row.id }
    },
    async updatePositionName(id, name) {
      await client.positions.update({ where: { id }, data: { name } })
    },
    async updatePositionRank(id, rank) {
      await client.positions.update({ where: { id }, data: { rank } })
    },
    async deactivatePosition(id) {
      await client.positions.update({ where: { id }, data: { isActive: false } })
    },
    async reactivatePosition(id) {
      await client.positions.update({ where: { id }, data: { isActive: true } })
    },
    async deletePosition(id) {
      // Hard delete is reserved for positions nothing references — approval
      // history (snapshots, candidate groups, decisions) is never rewritten.
      const [
        assignments, steps, limits, candidateGroups, instanceSkips,
        instances, requestApprovals, solutionApprovals,
      ] = await Promise.all([
        client.organization_assignments.count({ where: { positionId: id } }),
        client.approval_route_steps.count({ where: { positionId: id } }),
        client.approval_route_versions.count({ where: { approvalLimitPositionId: id } }),
        client.approval_candidate_groups.count({ where: { requiredPositionId: id } }),
        client.approval_instance_skips.count({ where: { requiredPositionId: id } }),
        client.approval_instances.count({ where: { originPositionId: id } }),
        client.request_approvals.count({ where: { requiredPositionId: id } }),
        client.solution_approvals.count({ where: { requiredPositionId: id } }),
      ])
      const references = assignments + steps + limits + candidateGroups
        + instanceSkips + instances + requestApprovals + solutionApprovals
      if (references > 0) {
        throw new Error(
          'Position is referenced by assignments, routes, or approval history and cannot be deleted; deactivate it instead',
        )
      }
      await client.positions.delete({ where: { id } })
    },
    async loadPublishedRoutes() {
      const versions = await client.approval_route_versions.findMany({ where: { status: 'PUBLISHED' } })
      const published = versions.filter((row) => row.status === 'PUBLISHED')
      const steps = await client.approval_route_steps.findMany()
      const stepsByRoute = new Map<string, Array<{ stepOrder: number; positionId: string | null }>>()
      for (const step of steps) {
        const list = stepsByRoute.get(step.routeVersionId) ?? []
        list.push({ stepOrder: step.stepOrder, positionId: step.positionId })
        stepsByRoute.set(step.routeVersionId, list)
      }
      return published.map((row) => ({
        id: row.id,
        scopeUnitId: row.scopeUnitId,
        phase: row.phase as ApprovalPhase,
        approvalLimitPositionId: row.approvalLimitPositionId,
        steps: (stepsByRoute.get(row.id) ?? []).sort((left, right) => left.stepOrder - right.stepOrder),
      }))
    },
    async writeAudit(entry) {
      await client.request_activities.create({
        data: {
          action: entry.action,
          comments: entry.comments,
          userId: adminId,
        },
      })
    },
    async revalidateOrganization() {
      const { revalidatePath } = await import('next/cache')
      revalidatePath('/admin/organization')
    },
    async runSerializable(fn) {
      if (!serializable || client.$transaction === undefined) {
        return fn(store)
      }
      return await client.$transaction(
        async (tx) => fn(createMutationStore(tx, adminId, false)),
        { isolationLevel: 'Serializable' },
      ) as ReturnType<typeof fn>
    },
  }
  return store
}

async function createProductionMutationDb(): Promise<OrganizationPositionMutationDb & OrganizationUnitDeactivationDb & OrganizationTeamDeactivationDb> {
  const { requireAdmin } = await import('@/lib/auth')
  const adminId = await requireAdmin()
  if (!adminId) {
    throw new Error('Admin authorization is required for organization actions')
  }
  const { default: prisma } = await import('@/lib/prisma')
  const client = prisma as unknown as MutationPrisma
  return createMutationStore(client, adminId, true)
}

async function runExclusiveWrite<T>(
  store: OrganizationMutationDb,
  uniqueMessage: string | null,
  body: (tx: OrganizationMutationDb) => Promise<T>,
): Promise<T> {
  try {
    const result = await store.runSerializable(body)
    await store.revalidateOrganization()
    return result
  } catch (error) {
    if (error instanceof OrganizationValidationError) throw error
    if (uniqueMessage && isUniqueOrSerializationConflict(error)) {
      throw new OrganizationValidationError(uniqueMessage)
    }
    throw error
  }
}

async function runExclusiveRename<T>(
  store: OrganizationMutationDb,
  uniqueMessage: string,
  body: (tx: OrganizationMutationDb) => Promise<T>,
): Promise<T> {
  return runExclusiveWrite(store, uniqueMessage, body)
}

/**
 * Rename an organization unit. Production (no db argument) runs requireAdmin,
 * trims, rejects empty/duplicate-sibling names, writes an audit row, and
 * revalidates. Validation+write run in a Serializable transaction. Unique and
 * serialization conflicts surface as OrganizationValidationError /unique/i.
 * Tests inject OrganizationMutationDb. Never touches attempts or snapshots.
 * No name normalization beyond trim.
 */
export async function renameOrganizationUnit(
  input: { id: string; name: string },
  db?: OrganizationMutationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  const name = requireTrimmedName(input.name)
  return runExclusiveRename(store, 'Name must be unique among sibling units', async (tx) => {
    const units = await tx.loadUnits()
    const current = units.find((unit) => unit.id === input.id)
    if (current === undefined) {
      throw new OrganizationValidationError(`organization unit "${input.id}" was not found`)
    }
    const duplicate = units.some((unit) => (
      unit.isActive
      && unit.id !== current.id
      && unit.parentId === current.parentId
      && unit.name === name
    ))
    if (duplicate) {
      throw new OrganizationValidationError('Name must be unique among sibling units')
    }
    await tx.updateUnitName(current.id, name)
    await tx.writeAudit({
      action: 'organization_unit_renamed',
      comments: `Renamed unit ${current.id}: "${current.name}" → "${name}"`,
    })
    return { success: true as const }
  })
}

/**
 * Rename a team. Unique among active teams in the same unit (A3 duplicate-name
 * rule). Validation+write run in a Serializable transaction. Unique and
 * serialization conflicts surface as OrganizationValidationError /unique/i.
 * Never touches attempts or snapshots. No name normalization beyond trim.
 */
export async function renameTeam(
  input: { id: string; name: string },
  db?: OrganizationMutationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  const name = requireTrimmedName(input.name)
  return runExclusiveRename(store, 'Team name must be unique within the unit', async (tx) => {
    const teams = await tx.loadTeams()
    const current = teams.find((row) => row.id === input.id)
    if (current === undefined) {
      throw new OrganizationValidationError(`team "${input.id}" was not found`)
    }
    const duplicate = teams.some((row) => (
      row.isActive
      && row.id !== current.id
      && row.unitId === current.unitId
      && row.name === name
    ))
    if (duplicate) {
      throw new OrganizationValidationError('Team name must be unique within the unit')
    }
    await tx.updateTeamName(current.id, name)
    await tx.writeAudit({
      action: 'team_renamed',
      comments: `Renamed team ${current.id}: "${current.name}" → "${name}"`,
    })
    return { success: true as const }
  })
}

function requireParentId(parentId: string | undefined | null): string {
  const trimmed = typeof parentId === 'string' ? parentId.trim() : ''
  if (trimmed.length === 0) {
    throw new OrganizationValidationError('Parent required')
  }
  return trimmed
}

function asUnitWriter(tx: OrganizationMutationDb): OrganizationUnitMutationDb {
  return tx as OrganizationUnitMutationDb
}

function asUnitDeactivationWriter(tx: OrganizationMutationDb): OrganizationUnitDeactivationDb {
  return tx as OrganizationUnitDeactivationDb
}

function asTeamDeactivationWriter(tx: OrganizationMutationDb): OrganizationTeamDeactivationDb {
  return tx as OrganizationTeamDeactivationDb
}

function asAssignmentWriter(tx: OrganizationMutationDb): OrganizationAssignmentMutationDb {
  return tx as OrganizationAssignmentMutationDb
}

function asTeamWriter(tx: OrganizationMutationDb): OrganizationTeamMutationDb {
  return tx as OrganizationTeamMutationDb
}

function asPositionWriter(tx: OrganizationMutationDb): OrganizationPositionMutationDb {
  return tx as OrganizationPositionMutationDb
}

const ONE_ACTIVE_ASSIGNMENT_MESSAGE = 'A user may have only one active assignment'
const EXPLICIT_CORRECTION_MESSAGE = "This change requires explicit correction of the team's reports-to person"
const TEAM_UNIT_MESSAGE = 'Team must belong to the selected unit'

function requireTeamInUnit(
  teamId: string | null,
  unitId: string,
  teams: readonly TeamNode[],
): void {
  if (teamId === null) return
  const team = teams.find((row) => row.id === teamId)
  if (team === undefined || !team.isActive || team.unitId !== unitId) {
    throw new OrganizationValidationError(TEAM_UNIT_MESSAGE)
  }
}

function teamReportsToValidAgainstProposed(
  team: TeamNode,
  assignments: readonly AssignmentNode[],
  positionById: Map<string, { rank: number }>,
): boolean {
  const reportsTo = assignments.find((row) => row.id === team.reportsToAssignmentId)
  if (reportsTo === undefined || !reportsTo.isActive) return false
  if (reportsTo.unitId !== team.unitId) return false
  if (reportsTo.teamId === team.id) return false
  const reportsToRank = positionById.get(reportsTo.positionId)?.rank
  if (reportsToRank === undefined) return false
  for (const member of assignments) {
    if (!member.isActive || member.teamId !== team.id) continue
    const memberRank = positionById.get(member.positionId)?.rank
    if (memberRank === undefined || reportsToRank <= memberRank) return false
  }
  return true
}

function teamsNeedingReportsToCorrection(
  assignment: AssignmentNode,
  next: { unitId: string; positionId: string; teamId: string | null; isActive: boolean },
  assignments: readonly AssignmentNode[],
  teams: readonly TeamNode[],
  positions: readonly PositionNode[],
): TeamNode[] {
  const positionById = new Map(positions.map((row) => [row.id, row]))
  const proposedAssignments = assignments.map((row) => (
    row.id === assignment.id
      ? { ...row, unitId: next.unitId, positionId: next.positionId, teamId: next.teamId, isActive: next.isActive }
      : row
  ))
  const invalidated: TeamNode[] = []
  for (const team of teams) {
    if (!team.isActive) continue
    const affectedMembership =
      team.reportsToAssignmentId === assignment.id
      || assignment.teamId === team.id
      || next.teamId === team.id
    if (!affectedMembership) continue
    if (!teamReportsToValidAgainstProposed(team, proposedAssignments, positionById)) {
      invalidated.push(team)
    }
  }
  return invalidated
}

function requireExplicitReportsToCorrection(
  invalidated: readonly TeamNode[],
  corrections: readonly { teamId: string; reportsToAssignmentId: string }[] | undefined,
  currentAssignmentId: string,
): Map<string, string> {
  const provided = new Map(
    (corrections ?? []).map((row) => [row.teamId, row.reportsToAssignmentId]),
  )
  for (const team of invalidated) {
    const nextReportsTo = provided.get(team.id)
    if (!nextReportsTo || nextReportsTo === currentAssignmentId) {
      throw new OrganizationValidationError(EXPLICIT_CORRECTION_MESSAGE)
    }
  }
  return provided
}

/**
 * Create an organization unit under an existing parent. The company root exists
 * from setup only; parentId is required. Duplicate active sibling names are
 * rejected. Validation+write run in a Serializable transaction.
 */
export async function createOrganizationUnit(
  input: { name: string; parentId: string },
  db?: OrganizationUnitMutationDb,
): Promise<{ id: string }> {
  const store = db ?? await createProductionMutationDb()
  const name = requireTrimmedName(input.name)
  const parentId = requireParentId(input.parentId)
  return runExclusiveWrite(store, 'Name must be unique among sibling units', async (tx) => {
    const writer = asUnitWriter(tx)
    const units = await writer.loadUnits()
    const parent = units.find((row) => row.id === parentId)
    if (parent === undefined || !parent.isActive) {
      throw new OrganizationValidationError(`parent unit "${parentId}" was not found`)
    }
    const duplicate = units.some((row) => (
      row.isActive
      && row.parentId === parentId
      && row.name === name
    ))
    if (duplicate) {
      throw new OrganizationValidationError('Name must be unique among sibling units')
    }
    const created = await writer.createUnit({ name, parentId })
    await writer.writeAudit({
      action: 'organization_unit_created',
      comments: `Created unit ${created.id} "${name}" under parent ${parentId}`,
    })
    return created
  })
}

/**
 * Persist unit sharing and solution-work flags. Audit + revalidate.
 */
export async function updateUnitSettings(
  input: { id: string; shareRequests: boolean; canWorkOnSolutions: boolean },
  db?: OrganizationUnitMutationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  return runExclusiveWrite(store, null, async (tx) => {
    const writer = asUnitWriter(tx)
    const units = await writer.loadUnits()
    const current = units.find((row) => row.id === input.id)
    if (current === undefined) {
      throw new OrganizationValidationError(`organization unit "${input.id}" was not found`)
    }
    await writer.updateUnitSettings(current.id, input.shareRequests, input.canWorkOnSolutions)
    await writer.writeAudit({
      action: 'organization_unit_settings_updated',
      comments: `Updated unit ${current.id} shareRequests=${input.shareRequests} canWorkOnSolutions=${input.canWorkOnSolutions}`,
    })
    return { success: true as const }
  })
}

/**
 * Set the unit manager from active DIRECT assignments in that unit.
 * Non-direct assignments are rejected matching /directly/i. Inactive users are
 * rejected matching /inactive/i even when their direct assignment is still
 * active. Check user.isActive inside the mutation transaction.
 * validateOrganization runs on the proposed state before write.
 */
export async function setUnitManager(
  input: { unitId: string; managerUserId: string | null },
  db?: OrganizationUnitMutationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  return runExclusiveWrite(store, null, async (tx) => {
    const writer = asUnitWriter(tx)
    const [units, assignments, positions, teams, users] = await Promise.all([
      writer.loadUnits(),
      writer.loadAssignments(),
      writer.loadPositions(),
      writer.loadTeams(),
      writer.loadUsers(),
    ])
    const current = units.find((row) => row.id === input.unitId)
    if (current === undefined) {
      throw new OrganizationValidationError(`organization unit "${input.unitId}" was not found`)
    }
    if (input.managerUserId !== null) {
      const direct = assignments.some((row) => (
        row.isActive
        && row.unitId === current.id
        && row.userId === input.managerUserId
      ))
      if (!direct) {
        throw new OrganizationValidationError('User must be assigned directly to this unit')
      }
      const user = users.find((row) => row.id === input.managerUserId)
      if (!user || !user.isActive) {
        throw new OrganizationValidationError('User is inactive')
      }
    }
    const nextUnits = units.map((row) => (
      row.id === current.id ? { ...row, managerUserId: input.managerUserId } : row
    ))
    validateOrganization(nextUnits, positions, assignments, teams)
    await writer.updateUnitManager(current.id, input.managerUserId)
    await writer.writeAudit({
      action: 'organization_unit_manager_set',
      comments: `Set manager of unit ${current.id} to ${input.managerUserId ?? 'none'}`,
    })
    return { success: true as const }
  })
}

/**
 * Deactivate an organization unit (isActive=false only; never a hard delete).
 * Refused with named offenders while the unit is the active company root, has
 * ACTIVE child units, ACTIVE assignments directly in the unit, ACTIVE teams in
 * the unit, or DRAFT/PUBLISHED approval_route_versions scoped to the unit —
 * correct those records first. On success requests keep their
 * organizationUnitId reference and the unit's managerUserId stays as stale
 * history (A3 exempts inactive units). validateOrganization runs on the
 * proposed state before the write; audit + revalidate.
 * Attempts/snapshots untouched.
 */
export async function deactivateOrganizationUnit(
  input: { unitId: string },
  db?: OrganizationUnitDeactivationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  return runExclusiveWrite(store, null, async (tx) => {
    const writer = asUnitDeactivationWriter(tx)
    const [units, assignments, positions, teams, users] = await Promise.all([
      writer.loadUnits(),
      writer.loadAssignments(),
      writer.loadPositions(),
      writer.loadTeams(),
      writer.loadUsers(),
    ])
    const current = units.find((row) => row.id === input.unitId)
    if (current === undefined) {
      throw new OrganizationValidationError(`organization unit "${input.unitId}" was not found`)
    }
    if (current.isActive && current.parentId === null) {
      throw new OrganizationValidationError(
        `Unit "${current.name}" is the active company root; deactivating the only active root would invalidate the organization`,
      )
    }
    if (!current.isActive) {
      throw new OrganizationValidationError('Unit is not active')
    }
    const activeChildren = units.filter((row) => (
      row.isActive && row.parentId === current.id
    ))
    if (activeChildren.length > 0) {
      const offenders = activeChildren
        .map((child) => `"${child.name}" (${child.id})`)
        .join(', ')
      throw new OrganizationValidationError(
        `Unit "${current.name}" has active child units: ${offenders}; deactivate children first`,
      )
    }
    const activeAssignments = assignments.filter((row) => (
      row.isActive && row.unitId === current.id
    ))
    if (activeAssignments.length > 0) {
      const offenders = activeAssignments
        .map((row) => `"${personName(users, row.userId, row.id)}" (${row.id})`)
        .join(', ')
      throw new OrganizationValidationError(
        `Unit "${current.name}" has people still assigned: ${offenders}; move or remove people first`,
      )
    }
    const activeTeams = teams.filter((row) => (
      row.isActive && row.unitId === current.id
    ))
    if (activeTeams.length > 0) {
      const offenders = activeTeams
        .map((team) => `"${team.name}" (${team.id})`)
        .join(', ')
      throw new OrganizationValidationError(
        `Unit "${current.name}" has active teams: ${offenders}; deactivate or remove them first`,
      )
    }
    const scopedRoutes = await writer.loadRouteVersionsForUnit(current.id)
    if (scopedRoutes.length > 0) {
      const offenders = scopedRoutes
        .map((route) => `${route.id} (${route.phase} ${route.status})`)
        .join(', ')
      throw new OrganizationValidationError(
        `Unit "${current.name}" has approval route versions scoped to it: ${offenders}; retire or move them first`,
      )
    }
    const nextUnits = units.map((row) => (
      row.id === current.id ? { ...row, isActive: false } : row
    ))
    validateOrganization(nextUnits, positions, assignments, teams)
    await writer.deactivateUnit(current.id)
    await writer.writeAudit({
      action: 'organization_unit_deactivated',
      comments: `Deactivated unit ${current.id} "${current.name}"; history preserved (requests keep their organizationUnitId; manager stays as stale history)`,
    })
    return { success: true as const }
  })
}

/**
 * Deactivate a flat team (isActive=false only; never a hard delete). Refused
 * with named offenders while any ACTIVE member assignment still references
 * the team — move or remove members first. The reports-to assignment may
 * still be active: the relationship retires WITH the team and is never
 * silently reassigned (validateOrganization exempts the inactive team's
 * reports-to/member rules per A3). History (membership teamId references on
 * inactive assignments) is preserved untouched. Audit + revalidate.
 * Attempts/snapshots untouched.
 */
export async function deactivateTeam(
  input: { teamId: string },
  db?: OrganizationTeamDeactivationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  return runExclusiveWrite(store, null, async (tx) => {
    const writer = asTeamDeactivationWriter(tx)
    const [units, assignments, positions, teams, users] = await Promise.all([
      writer.loadUnits(),
      writer.loadAssignments(),
      writer.loadPositions(),
      writer.loadTeams(),
      writer.loadUsers(),
    ])
    const current = teams.find((row) => row.id === input.teamId)
    if (current === undefined) {
      throw new OrganizationValidationError(`team "${input.teamId}" was not found`)
    }
    if (!current.isActive) {
      throw new OrganizationValidationError('Team is not active')
    }
    const activeMembers = assignments.filter((row) => (
      row.isActive && row.teamId === current.id
    ))
    if (activeMembers.length > 0) {
      const offenders = activeMembers
        .map((row) => `"${personName(users, row.userId, row.id)}" (${row.id})`)
        .join(', ')
      throw new OrganizationValidationError(
        `Team "${current.name}" has members still assigned: ${offenders}; move or remove members first`,
      )
    }
    const nextTeams = teams.map((row) => (
      row.id === current.id ? { ...row, isActive: false } : row
    ))
    validateOrganization(units, positions, assignments, nextTeams)
    await writer.deactivateTeam(current.id)
    await writer.writeAudit({
      action: 'team_deactivated',
      comments: `Deactivated team ${current.id} "${current.name}"; history preserved (reports-to assignment stays as history; never reassigned)`,
    })
    return { success: true as const }
  })
}

/**
 * Assign an existing account to a unit and position, optionally a team in that
 * unit. Rejects inactive users and a second active assignment. Validation+write
 * run in a Serializable transaction so one-active-assignment uniqueness maps
 * unique/serialization conflicts to /one active/i. Never writes users.role.
 * Never touches attempts or snapshots.
 */
export async function assignPerson(
  input: { userId: string; unitId: string; positionId: string; teamId: string | null },
  db?: OrganizationAssignmentMutationDb,
): Promise<{ assignmentId: string }> {
  const store = db ?? await createProductionMutationDb()
  return runExclusiveWrite(store, ONE_ACTIVE_ASSIGNMENT_MESSAGE, async (tx) => {
    const writer = asAssignmentWriter(tx)
    const [units, assignments, positions, teams, users] = await Promise.all([
      writer.loadUnits(),
      writer.loadAssignments(),
      writer.loadPositions(),
      writer.loadTeams(),
      writer.loadUsers(),
    ])
    const user = users.find((row) => row.id === input.userId)
    if (!user || !user.isActive) {
      throw new OrganizationValidationError('User is inactive')
    }
    const targetUnit = units.find((row) => row.id === input.unitId)
    if (targetUnit === undefined || !targetUnit.isActive) {
      throw new OrganizationValidationError(`organization unit "${input.unitId}" was not found`)
    }
    const targetPosition = positions.find((row) => row.id === input.positionId)
    if (targetPosition === undefined || !targetPosition.isActive) {
      throw new OrganizationValidationError(`position "${input.positionId}" was not found`)
    }
    requireTeamInUnit(input.teamId, input.unitId, teams)
    const existing = assignments.find((row) => row.isActive && row.userId === input.userId)
    if (existing !== undefined) {
      throw new OrganizationValidationError(ONE_ACTIVE_ASSIGNMENT_MESSAGE)
    }
    const preview: AssignmentNode = {
      id: `preview-assign-${input.userId}`,
      userId: input.userId,
      unitId: input.unitId,
      positionId: input.positionId,
      teamId: input.teamId,
      isActive: true,
    }
    validateOrganization(units, positions, [...assignments, preview], teams)
    const created = await writer.createAssignment({
      userId: input.userId,
      unitId: input.unitId,
      positionId: input.positionId,
      teamId: input.teamId,
    })
    await writer.writeAudit({
      action: 'organization_assignment_created',
      comments: `Assigned user ${input.userId} to unit ${input.unitId} position ${input.positionId} team ${input.teamId ?? 'none'} as ${created.id}`,
    })
    return { assignmentId: created.id }
  })
}

/**
 * Replace the active assignment's unit/position/team in place. Changing unit
 * with a stale team id is rejected. A move that invalidates a team's reports-to
 * throws /explicit correction/i unless teamReportsToCorrections covers every
 * affected team in the same save. Never writes users.role. Never touches
 * attempts or snapshots.
 */
export async function moveAssignment(
  input: {
    assignmentId: string
    unitId: string
    positionId: string
    teamId: string | null
    teamReportsToCorrections?: readonly { teamId: string; reportsToAssignmentId: string }[]
  },
  db?: OrganizationAssignmentMutationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  return runExclusiveWrite(store, null, async (tx) => {
    const writer = asAssignmentWriter(tx)
    const [units, assignments, positions, teams] = await Promise.all([
      writer.loadUnits(),
      writer.loadAssignments(),
      writer.loadPositions(),
      writer.loadTeams(),
    ])
    const current = assignments.find((row) => row.id === input.assignmentId)
    if (current === undefined) {
      throw new OrganizationValidationError(`assignment "${input.assignmentId}" was not found`)
    }
    if (!current.isActive) {
      throw new OrganizationValidationError('Assignment is not active')
    }
    const targetUnit = units.find((row) => row.id === input.unitId)
    if (targetUnit === undefined || !targetUnit.isActive) {
      throw new OrganizationValidationError(`organization unit "${input.unitId}" was not found`)
    }
    const targetPosition = positions.find((row) => row.id === input.positionId)
    if (targetPosition === undefined || !targetPosition.isActive) {
      throw new OrganizationValidationError(`position "${input.positionId}" was not found`)
    }
    requireTeamInUnit(input.teamId, input.unitId, teams)
    const nextAssignment: AssignmentNode = {
      ...current,
      unitId: input.unitId,
      positionId: input.positionId,
      teamId: input.teamId,
    }
    const invalidated = teamsNeedingReportsToCorrection(
      current,
      nextAssignment,
      assignments,
      teams,
      positions,
    )
    const provided = requireExplicitReportsToCorrection(
      invalidated,
      input.teamReportsToCorrections,
      current.id,
    )
    const nextAssignments = assignments.map((row) => (
      row.id === current.id ? nextAssignment : row
    ))
    const invalidatedIds = new Set(invalidated.map((row) => row.id))
    const nextTeams = teams.map((row) => {
      if (!invalidatedIds.has(row.id)) return row
      const nextReportsTo = provided.get(row.id)
      return nextReportsTo ? { ...row, reportsToAssignmentId: nextReportsTo } : row
    })
    validateOrganization(units, positions, nextAssignments, nextTeams)
    await writer.updateAssignment(current.id, {
      unitId: input.unitId,
      positionId: input.positionId,
      teamId: input.teamId,
    })
    for (const team of invalidated) {
      const nextReportsTo = provided.get(team.id)
      if (nextReportsTo) {
        await writer.updateTeamReportsTo(team.id, nextReportsTo)
      }
    }
    await writer.writeAudit({
      action: 'organization_assignment_moved',
      comments: `Moved assignment ${current.id} unit ${current.unitId}→${input.unitId} position ${current.positionId}→${input.positionId} team ${current.teamId ?? 'none'}→${input.teamId ?? 'none'}`,
    })
    return { success: true as const }
  })
}

/**
 * Deactivate an assignment (isActive=false + deactivatedAt). Never deactivates
 * the account and never writes users.role. A reports-to assignment cannot be
 * removed without explicit correction. Attempts/snapshots untouched.
 */
export async function removeAssignment(
  input: { assignmentId: string },
  db?: OrganizationAssignmentMutationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  return runExclusiveWrite(store, null, async (tx) => {
    const writer = asAssignmentWriter(tx)
    const [units, assignments, positions, teams] = await Promise.all([
      writer.loadUnits(),
      writer.loadAssignments(),
      writer.loadPositions(),
      writer.loadTeams(),
    ])
    const current = assignments.find((row) => row.id === input.assignmentId)
    if (current === undefined) {
      throw new OrganizationValidationError(`assignment "${input.assignmentId}" was not found`)
    }
    if (!current.isActive) {
      throw new OrganizationValidationError('Assignment is not active')
    }
    const nextAssignment: AssignmentNode = { ...current, isActive: false }
    const invalidated = teamsNeedingReportsToCorrection(
      current,
      nextAssignment,
      assignments,
      teams,
      positions,
    )
    if (invalidated.length > 0) {
      throw new OrganizationValidationError(EXPLICIT_CORRECTION_MESSAGE)
    }
    const nextAssignments = assignments.map((row) => (
      row.id === current.id ? nextAssignment : row
    ))
    validateOrganization(units, positions, nextAssignments, teams)
    const deactivatedAt = new Date()
    await writer.deactivateAssignment(current.id, deactivatedAt)
    await writer.writeAudit({
      action: 'organization_assignment_removed',
      comments: `Deactivated assignment ${current.id} for user ${current.userId}; account left active`,
    })
    return { success: true as const }
  })
}

function personName(
  users: readonly WorkspaceUser[],
  userId: string,
  fallback: string,
): string {
  return users.find((row) => row.id === userId)?.name ?? fallback
}

function duplicateTeamMessage(name: string, unitName: string): string {
  return `Duplicate team name "${name}" among active teams in unit ${unitName}`
}

function assertTeamWrite(input: {
  unitId: string
  name: string
  reportsToAssignmentId: string
  memberAssignmentIds: readonly string[]
  currentTeamId: string | null
  units: readonly OrganizationUnitNode[]
  assignments: readonly AssignmentNode[]
  positions: readonly PositionNode[]
  teams: readonly TeamNode[]
  users: readonly WorkspaceUser[]
}): { unit: OrganizationUnitNode; reportsTo: AssignmentNode; members: AssignmentNode[] } {
  const unit = input.units.find((row) => row.id === input.unitId)
  if (unit === undefined || !unit.isActive) {
    throw new OrganizationValidationError(`organization unit "${input.unitId}" was not found`)
  }
  const reportsTo = input.assignments.find((row) => row.id === input.reportsToAssignmentId)
  const reportsToName = reportsTo
    ? personName(input.users, reportsTo.userId, reportsTo.id)
    : input.reportsToAssignmentId
  if (reportsTo === undefined) {
    throw new OrganizationValidationError(`Reports-to ${reportsToName} was not found`)
  }
  if (!reportsTo.isActive) {
    throw new OrganizationValidationError(`Reports-to ${reportsToName} is inactive`)
  }
  if (reportsTo.unitId !== unit.id) {
    throw new OrganizationValidationError(`Reports-to ${reportsToName} is not in unit ${unit.name}`)
  }

  const memberIds = [...new Set(input.memberAssignmentIds)]
  if (memberIds.includes(reportsTo.id)) {
    throw new OrganizationValidationError(`Reports-to ${reportsToName} is a member of the team`)
  }

  const members: AssignmentNode[] = []
  for (const id of memberIds) {
    const member = input.assignments.find((row) => row.id === id)
    const memberName = member ? personName(input.users, member.userId, id) : id
    if (member === undefined || !member.isActive) {
      throw new OrganizationValidationError(`Member ${memberName} is inactive`)
    }
    if (member.unitId !== unit.id) {
      throw new OrganizationValidationError(
        `Member ${memberName} is assigned to a different unit, not ${unit.name}`,
      )
    }
    members.push(member)
  }

  const positionById = new Map(input.positions.map((row) => [row.id, row]))
  const reportsToRank = positionById.get(reportsTo.positionId)?.rank
  if (reportsToRank === undefined) {
    throw new OrganizationValidationError(`Reports-to ${reportsToName} has no rank`)
  }
  for (const member of members) {
    const memberRank = positionById.get(member.positionId)?.rank
    const memberName = personName(input.users, member.userId, member.id)
    if (memberRank === undefined || reportsToRank <= memberRank) {
      throw new OrganizationValidationError(
        `Reports-to ${reportsToName} is not strictly above member ${memberName}`,
      )
    }
  }

  const duplicate = input.teams.some((row) => (
    row.isActive
    && row.unitId === unit.id
    && row.name === input.name
    && row.id !== input.currentTeamId
  ))
  if (duplicate) {
    throw new OrganizationValidationError(duplicateTeamMessage(input.name, unit.name))
  }

  return { unit, reportsTo, members }
}

function proposedTeamAssignments(
  assignments: readonly AssignmentNode[],
  teamId: string,
  memberIds: readonly string[],
): AssignmentNode[] {
  const members = new Set(memberIds)
  return assignments.map((row) => {
    if (members.has(row.id)) return { ...row, teamId }
    if (row.teamId === teamId) return { ...row, teamId: null }
    return row
  })
}

async function applyTeamMemberships(
  writer: OrganizationTeamMutationDb,
  assignments: readonly AssignmentNode[],
  teamId: string,
  memberIds: readonly string[],
): Promise<void> {
  const members = new Set(memberIds)
  for (const row of assignments) {
    if (members.has(row.id)) {
      if (row.teamId !== teamId) await writer.setAssignmentTeam(row.id, teamId)
      continue
    }
    if (row.teamId === teamId) {
      await writer.setAssignmentTeam(row.id, null)
    }
  }
}

/**
 * Create a flat team in a unit with an explicit reports-to assignment outside
 * membership, ranked strictly above every member. Duplicate active names in the
 * unit are rejected. Validation+write run in a Serializable transaction; unique
 * and serialization conflicts surface as /duplicate team/i. Errors name
 * offenders. Never writes users.role. Never silently replaces reports-to.
 */
export async function createTeam(
  input: {
    unitId: string
    name: string
    reportsToAssignmentId: string
    memberAssignmentIds: readonly string[]
  },
  db?: OrganizationTeamMutationDb,
): Promise<{ teamId: string }> {
  const store = db ?? await createProductionMutationDb()
  const name = requireTrimmedName(input.name)
  const uniqueMessage = duplicateTeamMessage(name, 'the unit')
  return runExclusiveWrite(store, uniqueMessage, async (tx) => {
    const writer = asTeamWriter(tx)
    const [units, assignments, positions, teams, users] = await Promise.all([
      writer.loadUnits(),
      writer.loadAssignments(),
      writer.loadPositions(),
      writer.loadTeams(),
      writer.loadUsers(),
    ])
    const checked = assertTeamWrite({
      unitId: input.unitId,
      name,
      reportsToAssignmentId: input.reportsToAssignmentId,
      memberAssignmentIds: input.memberAssignmentIds,
      currentTeamId: null,
      units,
      assignments,
      positions,
      teams,
      users,
    })
    const previewId = `preview-team-${checked.unit.id}-${name}`
    const previewTeam: TeamNode = {
      id: previewId,
      unitId: checked.unit.id,
      name,
      reportsToAssignmentId: input.reportsToAssignmentId,
      isActive: true,
    }
    validateOrganization(
      units,
      positions,
      proposedTeamAssignments(assignments, previewId, input.memberAssignmentIds),
      [...teams, previewTeam],
    )
    const created = await writer.createTeam({
      unitId: checked.unit.id,
      name,
      reportsToAssignmentId: input.reportsToAssignmentId,
    })
    await applyTeamMemberships(writer, assignments, created.id, input.memberAssignmentIds)
    await writer.writeAudit({
      action: 'team_created',
      comments: `Created team ${created.id} "${name}" in unit ${checked.unit.id} reports-to ${input.reportsToAssignmentId}`,
    })
    return { teamId: created.id }
  })
}

/**
 * Update a team's name, reports-to, and membership. Same rejection rules as
 * createTeam. The supplied reportsToAssignmentId is required; an invalid value
 * is rejected rather than silently replaced. Never writes users.role.
 */
export async function updateTeam(
  input: {
    id: string
    name: string
    reportsToAssignmentId: string
    memberAssignmentIds: readonly string[]
  },
  db?: OrganizationTeamMutationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  const name = requireTrimmedName(input.name)
  const uniqueMessage = duplicateTeamMessage(name, 'the unit')
  return runExclusiveWrite(store, uniqueMessage, async (tx) => {
    const writer = asTeamWriter(tx)
    const [units, assignments, positions, teams, users] = await Promise.all([
      writer.loadUnits(),
      writer.loadAssignments(),
      writer.loadPositions(),
      writer.loadTeams(),
      writer.loadUsers(),
    ])
    const current = teams.find((row) => row.id === input.id)
    if (current === undefined) {
      throw new OrganizationValidationError(`team "${input.id}" was not found`)
    }
    const checked = assertTeamWrite({
      unitId: current.unitId,
      name,
      reportsToAssignmentId: input.reportsToAssignmentId,
      memberAssignmentIds: input.memberAssignmentIds,
      currentTeamId: current.id,
      units,
      assignments,
      positions,
      teams,
      users,
    })
    const nextTeams = teams.map((row) => (
      row.id === current.id
        ? { ...row, name, reportsToAssignmentId: input.reportsToAssignmentId }
        : row
    ))
    validateOrganization(
      units,
      positions,
      proposedTeamAssignments(assignments, current.id, input.memberAssignmentIds),
      nextTeams,
    )
    await writer.updateTeamName(current.id, name)
    await writer.updateTeamReportsTo(current.id, input.reportsToAssignmentId)
    await applyTeamMemberships(writer, assignments, current.id, input.memberAssignmentIds)
    await writer.writeAudit({
      action: 'team_updated',
      comments: `Updated team ${current.id} "${name}" in unit ${checked.unit.id} reports-to ${input.reportsToAssignmentId}`,
    })
    return { success: true as const }
  })
}

const POSITION_NAME_UNIQUE_MESSAGE = 'Position name must be unique among active positions'
const POSITION_RANK_UNIQUE_MESSAGE = 'Position rank must be unique among active positions'

function requirePositiveIntegerRank(rank: number): number {
  if (!Number.isInteger(rank) || rank <= 0) {
    throw new OrganizationValidationError('Rank must be a positive integer')
  }
  return rank
}

function requirePosition(
  positions: readonly PositionNode[],
  positionId: string,
): PositionNode {
  const current = positions.find((row) => row.id === positionId)
  if (current === undefined || !current.isActive) {
    throw new OrganizationValidationError(`position "${positionId}" was not found`)
  }
  return current
}

// Guard caller contract: the published-route input carries no status field and
// every consulted reference must resolve. A null approval-limit position or a
// step without a position is malformed consulted input and fails closed with a
// named error instead of being silently dropped or invented.
function asGuardPublishedRoutes(
  publishedRoutes: ReadonlyArray<{
    id: string
    scopeUnitId: string
    phase: ApprovalPhase
    approvalLimitPositionId: string | null
    steps: ReadonlyArray<{ stepOrder: number; positionId: string | null }>
  }>,
): ReadonlyArray<{
  id: string
  scopeUnitId: string
  phase: ApprovalPhase
  approvalLimitPositionId: string
  steps: ReadonlyArray<{ stepOrder: number; positionId: string }>
}> {
  return publishedRoutes.map((route) => {
    if (route.approvalLimitPositionId === null) {
      throw new OrganizationValidationError(
        `published route "${route.id}" has no approval limit position`,
      )
    }
    return {
      id: route.id,
      scopeUnitId: route.scopeUnitId,
      phase: route.phase,
      approvalLimitPositionId: route.approvalLimitPositionId,
      steps: route.steps.map((step) => {
        if (step.positionId === null) {
          throw new OrganizationValidationError(
            `published route "${route.id}" has a step (stepOrder ${step.stepOrder}) without a position`,
          )
        }
        return { stepOrder: step.stepOrder, positionId: step.positionId }
      }),
    }
  })
}

/**
 * Create a position with a company-wide approval rank. Name must be unique
 * among active positions and rank must be a positive integer unique among
 * active positions. Validation+write run in a Serializable transaction; name
 * unique/serialization conflicts surface as OrganizationValidationError
 * /unique/i. Audit + revalidate. Never touches attempts or snapshots.
 */
export async function createPosition(
  input: { name: string; rank: number },
  db?: OrganizationPositionMutationDb,
): Promise<{ positionId: string }> {
  const store = db ?? await createProductionMutationDb()
  const name = requireTrimmedName(input.name)
  const rank = requirePositiveIntegerRank(input.rank)
  return runExclusiveWrite(store, POSITION_NAME_UNIQUE_MESSAGE, async (tx) => {
    const writer = asPositionWriter(tx)
    const positions = await writer.loadPositions()
    if (positions.some((row) => row.isActive && row.name === name)) {
      throw new OrganizationValidationError(POSITION_NAME_UNIQUE_MESSAGE)
    }
    if (positions.some((row) => row.isActive && row.rank === rank)) {
      throw new OrganizationValidationError(POSITION_RANK_UNIQUE_MESSAGE)
    }
    const created = await writer.createPosition({ name, rank })
    await writer.writeAudit({
      action: 'position_created',
      comments: `Created position ${created.id} "${name}" rank ${rank}`,
    })
    return { positionId: created.id }
  })
}

/**
 * Rename a position. Rename only: the rank never changes and approval
 * snapshots keep their captured strings (attempts/snapshots are never read or
 * written here). Duplicate active names are rejected /unique/i. Validation+write
 * run in a Serializable transaction. Audit + revalidate.
 */
export async function renamePosition(
  input: { positionId: string; name: string },
  db?: OrganizationPositionMutationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  const name = requireTrimmedName(input.name)
  return runExclusiveRename(store, POSITION_NAME_UNIQUE_MESSAGE, async (tx) => {
    const writer = asPositionWriter(tx)
    const positions = await writer.loadPositions()
    const current = requirePosition(positions, input.positionId)
    const duplicate = positions.some((row) => (
      row.isActive
      && row.id !== current.id
      && row.name === name
    ))
    if (duplicate) {
      throw new OrganizationValidationError(POSITION_NAME_UNIQUE_MESSAGE)
    }
    await writer.updatePositionName(current.id, name)
    await writer.writeAudit({
      action: 'position_renamed',
      comments: `Renamed position ${current.id}: "${current.name}" → "${name}"`,
    })
    return { success: true as const }
  })
}

/**
 * Change a position's company-wide rank. assessPositionRankChange runs FIRST:
 * a blocked response returns the guard's full affected-record lists verbatim
 * and writes NOTHING — no auto-repair, no attempt changes, snapshots keep
 * their captured ranks. A proposed rank already held by another ACTIVE
 * position is rejected /unique/i (the createPosition invariant). On success
 * the rank write, validateOrganization over the proposed state, and the audit
 * run in one Serializable transaction.
 */
export async function changePositionRank(
  input: { positionId: string; proposedRank: number },
  db?: OrganizationPositionMutationDb,
): Promise<{ success: true } | { blocked: true; impact: RankChangeImpact }> {
  const store = db ?? await createProductionMutationDb()
  const proposedRank = requirePositiveIntegerRank(input.proposedRank)
  return runExclusiveWrite(store, null, async (tx) => {
    const writer = asPositionWriter(tx)
    const [units, positions, assignments, teams, publishedRoutes] = await Promise.all([
      writer.loadUnits(),
      writer.loadPositions(),
      writer.loadAssignments(),
      writer.loadTeams(),
      writer.loadPublishedRoutes(),
    ])
    const current = requirePosition(positions, input.positionId)
    const rankHeld = positions.some((row) => (
      row.isActive
      && row.id !== current.id
      && row.rank === proposedRank
    ))
    if (rankHeld) {
      throw new OrganizationValidationError(POSITION_RANK_UNIQUE_MESSAGE)
    }
    const impact = assessPositionRankChange({
      positions,
      teams,
      assignments,
      publishedRoutes: asGuardPublishedRoutes(publishedRoutes),
      positionId: current.id,
      proposedRank,
    })
    if (impact.blocked) {
      return { blocked: true as const, impact }
    }
    const nextPositions = positions.map((row) => (
      row.id === current.id ? { ...row, rank: proposedRank } : row
    ))
    validateOrganization(units, nextPositions, assignments, teams)
    await writer.updatePositionRank(current.id, proposedRank)
    await writer.writeAudit({
      action: 'position_rank_changed',
      comments: `Changed rank of position ${current.id} "${current.name}" ${current.rank} → ${proposedRank}`,
    })
    return { success: true as const }
  })
}

/**
 * Deactivate a position (isActive=false; positions are never destructively
 * deleted). Refused /in use/i while any ACTIVE assignment or any PUBLISHED
 * route step/approval limit references the position — correct those records
 * first. Audit + revalidate. Attempts/snapshots untouched.
 */
export async function deactivatePosition(
  input: { positionId: string },
  db?: OrganizationPositionMutationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  return runExclusiveWrite(store, null, async (tx) => {
    const writer = asPositionWriter(tx)
    const [units, positions, assignments, teams, publishedRoutes] = await Promise.all([
      writer.loadUnits(),
      writer.loadPositions(),
      writer.loadAssignments(),
      writer.loadTeams(),
      writer.loadPublishedRoutes(),
    ])
    const current = requirePosition(positions, input.positionId)
    const activeAssignments = assignments.filter((row) => (
      row.isActive && row.positionId === current.id
    ))
    if (activeAssignments.length > 0) {
      throw new OrganizationValidationError(
        `Position "${current.name}" is in use by ${activeAssignments.length} people; move or remove them first`,
      )
    }
    const referencingRoutes = publishedRoutes.filter((route) => (
      route.approvalLimitPositionId === current.id
      || route.steps.some((step) => step.positionId === current.id)
    ))
    if (referencingRoutes.length > 0) {
      throw new OrganizationValidationError(
        `Position "${current.name}" is in use by ${referencingRoutes.length} published route(s); update or retire them first`,
      )
    }
    const nextPositions = positions.map((row) => (
      row.id === current.id ? { ...row, isActive: false } : row
    ))
    validateOrganization(units, nextPositions, assignments, teams)
    await writer.deactivatePosition(current.id)
    await writer.writeAudit({
      action: 'position_deactivated',
      comments: `Deactivated position ${current.id} "${current.name}"; history and snapshots keep their captured values`,
    })
    return { success: true as const }
  })
}

/**
 * Reactivate a previously deactivated position (isActive=true; the inverse of
 * deactivatePosition — positions are never destructively deleted). No
 * /in use/ guard: reactivating only widens the active position catalog, but an
 * active rank collision is rejected to preserve the catalog invariant.
 * Organization-wide validation still runs (rank ordering stays coherent).
 * Audit + snapshots untouched.
 */
export async function reactivatePosition(
  input: { positionId: string },
  db?: OrganizationPositionMutationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  return runExclusiveWrite(store, null, async (tx) => {
    const writer = asPositionWriter(tx)
    const [units, positions, assignments, teams] = await Promise.all([
      writer.loadUnits(),
      writer.loadPositions(),
      writer.loadAssignments(),
      writer.loadTeams(),
    ])
    // NOTE: requirePosition rejects inactive rows, so the reactivation target
    // is resolved manually — it must EXIST, but is expected to be inactive.
    const current = positions.find((row) => row.id === input.positionId)
    if (!current) {
      throw new OrganizationValidationError(`position "${input.positionId}" was not found`)
    }
    if (current.isActive) return { success: true as const }
    if (positions.some((row) => (
      row.isActive
      && row.id !== current.id
      && row.rank === current.rank
    ))) {
      throw new OrganizationValidationError(POSITION_RANK_UNIQUE_MESSAGE)
    }
    const nextPositions = positions.map((row) => (
      row.id === current.id ? { ...row, isActive: true } : row
    ))
    validateOrganization(units, nextPositions, assignments, teams)
    if (!writer.reactivatePosition) {
      throw new Error('Position reactivation is not supported by the current storage adapter')
    }
    await writer.reactivatePosition(current.id)
    await writer.writeAudit({
      action: 'position_reactivated',
      comments: `Reactivated position ${current.id} "${current.name}"; history and snapshots keep their captured values`,
    })
    return { success: true as const }
  })
}

/**
 * Hard delete an INACTIVE position that nothing references. Owner addition to
 * the deactivate-not-delete model: delete is opt-in cleanup for rows no
 * assignment, route, or approval history points at — the production writer
 * refuses (inside the transaction) when any reference exists. Active
 * positions must be deactivated first. Audit records the deletion of the id.
 */
export async function deletePosition(
  input: { positionId: string },
  db?: OrganizationPositionMutationDb,
): Promise<{ success: true }> {
  const store = db ?? await createProductionMutationDb()
  return runExclusiveWrite(store, null, async (tx) => {
    const writer = asPositionWriter(tx)
    const positions = await writer.loadPositions()
    const current = positions.find((row) => row.id === input.positionId)
    if (!current) {
      throw new OrganizationValidationError(`position "${input.positionId}" was not found`)
    }
    if (current.isActive) {
      throw new OrganizationValidationError(
        `Position "${current.name}" is active; deactivate it before deleting`,
      )
    }
    if (!writer.deletePosition) {
      throw new Error('Position delete is not supported by the current storage adapter')
    }
    await writer.deletePosition(current.id)
    await writer.writeAudit({
      action: 'position_deleted',
      comments: `Deleted unreferenced position ${current.id} "${current.name}" (rank ${current.rank})`,
    })
    return { success: true as const }
  })
}
