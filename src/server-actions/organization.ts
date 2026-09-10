'use server'

import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/definition'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import { selectNearestRoute } from '@/lib/approval-routes/selection'
import type { ApprovalRouteVersionDefinition } from '@/lib/approval-routes/definition'
import { verifyCleanStartReadiness } from '@/lib/clean-start-readiness'
import type { ReadinessReport } from '@/lib/clean-start-readiness'
import type {
  AssignmentNode,
  OrganizationUnitNode,
  PositionNode,
  TeamNode,
} from '@/lib/organization/model'

const PHASES: readonly ApprovalPhase[] = ['REQUEST', 'SOLUTION', 'FINAL']

export type RouteSourceKind = 'ROOT_DEFAULT' | 'INHERITED' | 'CUSTOM'

export interface WorkspaceRouteVersion {
  id: string
  scopeUnitId: string
  phase: ApprovalPhase
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
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
      status: string
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
    version: 1,
    approvalLimitPositionId: '_workspace-read-only',
    status: row.status,
    steps: [],
  }
}

function classifyRouteSources(
  units: readonly OrganizationUnitNode[],
  routes: readonly WorkspaceRouteVersion[],
): WorkspaceSnapshot['routeSources'] {
  const root = units.find((unit) => unit.parentId === null) ?? null
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
        if (selected.scopeUnitId === unit.id) {
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
      const rows = await prisma.approval_route_versions.findMany()
      return rows.map((row) => ({
        id: row.id,
        scopeUnitId: row.scopeUnitId,
        phase: row.phase as ApprovalPhase,
        status: row.status as WorkspaceRouteVersion['status'],
      }))
    },
    async loadCustomChainExceptions() {
      const rows = await prisma.requests.findMany({
        where: { isDeleted: false, approvals: { some: { isCustomChain: true } } },
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

  const routeSources = classifyRouteSources(units, routes)
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
