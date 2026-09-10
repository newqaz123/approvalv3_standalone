'use server'

import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/definition'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import { selectNearestRoute } from '@/lib/approval-routes/selection'
import type { ApprovalRouteVersionDefinition } from '@/lib/approval-routes/definition'
import { verifyCleanStartReadiness } from '@/lib/clean-start-readiness'
import type { ReadinessReport } from '@/lib/clean-start-readiness'
import { OrganizationValidationError } from '@/lib/organization/assignments'
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
    update: (args: { where: { id: string }; data: { name: string } }) => Promise<unknown>
  }
  teams: {
    findMany: (args?: object) => Promise<Array<{
      id: string
      unitId: string
      name: string
      reportsToAssignmentId: string
      isActive: boolean
    }>>
    update: (args: { where: { id: string }; data: { name: string } }) => Promise<unknown>
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
): OrganizationMutationDb {
  const store: OrganizationMutationDb = {
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
    async updateUnitName(id, name) {
      await client.organization_units.update({ where: { id }, data: { name } })
    },
    async updateTeamName(id, name) {
      await client.teams.update({ where: { id }, data: { name } })
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

async function createProductionMutationDb(): Promise<OrganizationMutationDb> {
  const { requireAdmin } = await import('@/lib/auth')
  const adminId = await requireAdmin()
  if (!adminId) {
    throw new Error('Admin authorization is required for organization actions')
  }
  const { default: prisma } = await import('@/lib/prisma')
  const client = prisma as unknown as MutationPrisma
  return createMutationStore(client, adminId, true)
}

async function runExclusiveRename<T>(
  store: OrganizationMutationDb,
  uniqueMessage: string,
  body: (tx: OrganizationMutationDb) => Promise<T>,
): Promise<T> {
  try {
    const result = await store.runSerializable(body)
    await store.revalidateOrganization()
    return result
  } catch (error) {
    if (error instanceof OrganizationValidationError) throw error
    if (isUniqueOrSerializationConflict(error)) {
      throw new OrganizationValidationError(uniqueMessage)
    }
    throw error
  }
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
