import { createHash } from 'node:crypto'
import type { ReviewedOrganizationMapping } from '../../../tools/organization-mapping-schema'
import { assertAcyclicOrganizationTree } from './tree'
import { ORGANIZATION_POSITION_LEVEL, type OrganizationPositionCode, type OrganizationUnitType } from './types'

const positionUnit: Record<OrganizationPositionCode, OrganizationUnitType> = {
  STAFF: 'SECTION',
  SUPERVISOR: 'SECTION',
  SECTION_MANAGER: 'SECTION',
  DEPARTMENT_MANAGER: 'DEPARTMENT',
  DIVISION_MANAGER: 'DIVISION',
  FACTORY_MANAGER: 'FACTORY',
}

const expectedParent: Record<OrganizationUnitType, OrganizationUnitType | null> = {
  FACTORY: null,
  DIVISION: 'FACTORY',
  DEPARTMENT: 'DIVISION',
  SECTION: 'DEPARTMENT',
}

function fail(message: string): never {
  throw new Error(`Invalid reviewed organization mapping: ${message}`)
}

/** Validate relationships which cannot be expressed by the JSON scalar schema. */
export function validateReviewedOrganizationMapping(mapping: ReviewedOrganizationMapping): void {
  const unitsById = new Map(mapping.units.map((unit) => [unit.id, unit]))
  if (unitsById.size !== mapping.units.length) fail('unit IDs must be unique')
  assertAcyclicOrganizationTree(mapping.units.map((unit) => ({ ...unit, isActive: true })))

  for (const unit of mapping.units) {
    const expected = expectedParent[unit.unitType]
    if (expected === null && unit.parentId !== null) fail(`factory ${unit.id} cannot have a parent`)
    if (expected !== null) {
      const parent = unit.parentId ? unitsById.get(unit.parentId) : undefined
      if (!parent) fail(`parent ${unit.parentId ?? '(null)'} is missing for ${unit.id}`)
      if (parent.unitType !== expected) fail(`invalid parent type for ${unit.id}`)
    }
  }

  const departmentsByLegacyId = new Map(mapping.departments.map((row) => [row.legacyDepartmentId, row]))
  for (const row of mapping.departments) {
    const target = unitsById.get(row.targetUnitId)
    if (!target) fail(`department ${row.legacyDepartmentId} targets unknown unit ${row.targetUnitId}`)
    if (row.disposition === 'REAL_SECTION' && target.unitType !== 'SECTION') fail(`REAL_SECTION ${row.legacyDepartmentId} must target a section`)
    if (row.disposition === 'LEGACY_MANAGER_CONTAINER' && target.unitType === 'SECTION') fail(`LEGACY_MANAGER_CONTAINER ${row.legacyDepartmentId} cannot target a section`)
  }

  const groupsById = new Map(mapping.reportingGroups.map((group) => [group.id, group]))
  if (groupsById.size !== mapping.reportingGroups.length) fail('reporting-group IDs must be unique')
  const visiting = new Set<string>(), visited = new Set<string>()
  const visitGroup = (id: string): void => {
    if (visiting.has(id)) fail(`reporting-group cycle detected at ${id}`)
    if (visited.has(id)) return
    const group = groupsById.get(id)
    if (!group) fail(`reporting group ${id} is missing`)
    const unit = unitsById.get(group.unitId)
    if (!unit || unit.unitType !== 'SECTION') fail(`reporting group ${id} must attach to a section`)
    visiting.add(id)
    if (group.parentGroupId) {
      const parent = groupsById.get(group.parentGroupId)
      if (!parent) fail(`reporting-group parent ${group.parentGroupId} is missing`)
      if (parent.unitId !== group.unitId) fail(`reporting group ${id} crosses sections`)
      visitGroup(group.parentGroupId)
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const group of mapping.reportingGroups) visitGroup(group.id)

  const assignmentsByUser = new Map<string, typeof mapping.positionAssignments>()
  for (const assignment of mapping.positionAssignments) {
    const unit = unitsById.get(assignment.unitId)
    if (!unit) fail(`assignment ${assignment.userId} targets unknown unit ${assignment.unitId}`)
    if (positionUnit[assignment.positionCode] !== unit.unitType) fail(`position ${assignment.positionCode} does not match unit ${assignment.unitId}`)
    const assignments = assignmentsByUser.get(assignment.userId) ?? []
    assignments.push(assignment)
    assignmentsByUser.set(assignment.userId, assignments)
    if (assignment.reportingGroupId) {
      const group = groupsById.get(assignment.reportingGroupId)
      if (!group) fail(`assignment ${assignment.userId} references unknown reporting group ${assignment.reportingGroupId}`)
      if (unit.unitType !== 'SECTION' || group.unitId !== assignment.unitId) fail(`assignment ${assignment.userId} has a reporting group outside its section`)
      if (!group.memberUserIds.includes(assignment.userId)) fail(`assignment ${assignment.userId} is not a member of ${group.id}`)
    }
  }
  for (const [userId, assignments] of assignmentsByUser) {
    const primaries = assignments.filter((assignment) => assignment.isPrimary)
    if (primaries.length !== 1) fail(`user ${userId} must have exactly one primary assignment`)
  }

  for (const group of mapping.reportingGroups) {
    for (const userId of group.memberUserIds) {
      const hasSectionAssignment = mapping.positionAssignments.some((assignment) =>
        assignment.userId === userId && assignment.unitId === group.unitId && positionUnit[assignment.positionCode] === 'SECTION',
      )
      if (!hasSectionAssignment) fail(`group ${group.id} member ${userId} lacks a direct section assignment`)
    }
  }

  for (const external of mapping.externalApprovers) {
    const target = unitsById.get(external.targetUnitId)
    if (!target) fail(`external approver ${external.legacyDepartmentApproverId} targets unknown unit ${external.targetUnitId}`)
    if (positionUnit[external.positionCode] !== target.unitType) fail(`external approver ${external.legacyDepartmentApproverId} position does not match target unit`)
    if (external.disposition === 'PARENT_SCOPE' && !mapping.positionAssignments.some((assignment) =>
      assignment.userId === external.userId && assignment.unitId === external.targetUnitId && assignment.positionCode === external.positionCode,
    )) fail(`PARENT_SCOPE external approver ${external.legacyDepartmentApproverId} requires a matching explicit assignment`)
  }

  for (const level of mapping.legacyLevelMappings) {
    if (level.positionCode !== null && !(level.positionCode in ORGANIZATION_POSITION_LEVEL)) fail(`unsupported level mapping ${level.legacyLevel}`)
  }

  // Keep this lookup here so the schema remains explicit about legacy mappings;
  // scope validation against loaded external rows belongs to the dry-run report.
  void departmentsByLegacyId
}

export interface OrganizationImportReport {
  mappedDepartmentCount: number
  mappedUserCount: number
  mappedExternalApproverCount: number
  unmappedDepartmentIds: string[]
  unmappedUserIds: string[]
  blockingReasons: string[]
  wouldCreateUnits: number
  wouldCreateAssignments: number
  wouldCreateReportingGroups: number
}

export interface ApplyReviewedOrganizationMappingOptions {
  appliedBy: string
  targetIdentity: string
  expectedDigest: string
}

type MappingUnitRow = {
  id: string
  name: string
  unitType: string
  parentId: string | null
  legacyDepartmentId: string | null
  isActive: boolean
  operationalType: string
}

type MappingAssignmentRow = {
  id: string
  userId: string
  unitId: string
  positionCode: string
  reportingGroupId: string | null
  isPrimary: boolean
  isActive: boolean
}

type MappingGroupRow = {
  id: string
  unitId: string
  parentGroupId: string | null
  name: string
  isActive: boolean
}

type MappingMemberRow = { reportingGroupId: string; userId: string }

type MappingRequestRow = {
  id: string
  departmentId: string | null
  organizationUnitId: string | null
}

export interface OrganizationMappingApplyTx {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>
  user: {
    findMany(args?: unknown): Promise<Array<{ id: string; departmentId: string | null; level: number | null; isActive: boolean }>>
  }
  departments: {
    findMany(args?: unknown): Promise<Array<{ id: string; name: string; type: 'GENERAL' | 'ENGINEERING' }>>
  }
  department_approvers: {
    findMany(args?: unknown): Promise<Array<{ id: string; approverId: string; departmentId: string; approverLevel: number }>>
  }
  organization_units: {
    findMany(args?: unknown): Promise<MappingUnitRow[]>
    findUnique(args: { where: { id?: string; legacyDepartmentId?: string } }): Promise<MappingUnitRow | null>
    create(args: { data: MappingUnitRow }): Promise<MappingUnitRow>
    update(args: { where: { id: string }; data: Partial<MappingUnitRow> }): Promise<MappingUnitRow>
  }
  organization_position_assignments: {
    findMany(args?: { where?: Record<string, unknown> }): Promise<MappingAssignmentRow[]>
    findUnique(args: {
      where: { userId_unitId_positionCode?: { userId: string; unitId: string; positionCode: string }; id?: string }
    }): Promise<MappingAssignmentRow | null>
    create(args: { data: Omit<MappingAssignmentRow, 'id'> & { id?: string } }): Promise<MappingAssignmentRow>
    update(args: { where: { id: string }; data: Partial<MappingAssignmentRow> }): Promise<MappingAssignmentRow>
  }
  reporting_groups: {
    findMany(args?: unknown): Promise<MappingGroupRow[]>
    findUnique(args: { where: { id: string } }): Promise<MappingGroupRow | null>
    create(args: { data: MappingGroupRow }): Promise<MappingGroupRow>
    update(args: { where: { id: string }; data: Partial<MappingGroupRow> }): Promise<MappingGroupRow>
  }
  reporting_group_members: {
    findMany(args?: unknown): Promise<MappingMemberRow[]>
    findUnique(args: { where: { reportingGroupId_userId: { reportingGroupId: string; userId: string } } }): Promise<MappingMemberRow | null>
    create(args: { data: MappingMemberRow }): Promise<MappingMemberRow>
  }
  requests: {
    findMany(args?: { where?: { departmentId?: { in: string[] } } }): Promise<MappingRequestRow[]>
    update(args: { where: { id: string }; data: Partial<MappingRequestRow> }): Promise<MappingRequestRow>
  }
  organization_import_runs: {
    findUnique(args: { where: { mappingDigest: string } }): Promise<{ id: string; mappingDigest: string; targetIdentity: string; counts: unknown } | null>
    create(args: {
      data: { mappingDigest: string; appliedBy: string; targetIdentity: string; counts: unknown }
    }): Promise<unknown>
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

export function computeReviewedOrganizationMappingDigest(mapping: ReviewedOrganizationMapping): string {
  return createHash('sha256').update(stableStringify(mapping)).digest('hex')
}

function conflict(message: string): never {
  throw new Error(`Conflicting existing organization mapping identity: ${message}`)
}

function parentFirst<T extends { id: string; parentId?: string | null; parentGroupId?: string | null }>(
  rows: readonly T[],
  parentOf: (row: T) => string | null,
): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const ordered: T[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) fail(`cycle at ${id}`)
    const row = byId.get(id)
    if (!row) return
    visiting.add(id)
    const parentId = parentOf(row)
    if (parentId) visit(parentId)
    visiting.delete(id)
    visited.add(id)
    ordered.push(row)
  }
  for (const row of rows) visit(row.id)
  return ordered
}

function assignmentKey(row: { userId: string; unitId: string; positionCode: string }): string {
  return `${row.userId}:${row.unitId}:${row.positionCode}`
}

function sameUnit(existing: MappingUnitRow, unit: ReviewedOrganizationMapping['units'][number]): boolean {
  return existing.name === unit.name && existing.unitType === unit.unitType && existing.parentId === unit.parentId
}

async function lockImportIdentity(tx: OrganizationMappingApplyTx, targetIdentity: string): Promise<void> {
  const digest = createHash('sha256').update(`organization-import:${targetIdentity}`).digest()
  const lockKey = digest.readBigInt64BE(0)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
}

async function revalidateAgainstLoadedRows(
  tx: OrganizationMappingApplyTx,
  mapping: ReviewedOrganizationMapping,
): Promise<void> {
  const [users, departments] = await Promise.all([
    tx.user.findMany(),
    tx.departments.findMany(),
  ])
  const usersById = new Set(users.map((user) => user.id))
  const departmentsById = new Map(departments.map((department) => [department.id, department]))
  for (const department of mapping.departments) {
    const loaded = departmentsById.get(department.legacyDepartmentId)
    if (!loaded) fail(`legacy department ${department.legacyDepartmentId} is missing`)
    if (loaded.type !== department.engineeringClassification) fail(`department classification mismatch for ${department.legacyDepartmentId}`)
  }
  for (const assignment of mapping.positionAssignments) {
    if (!usersById.has(assignment.userId)) fail(`user ${assignment.userId} is missing`)
  }
  for (const group of mapping.reportingGroups) {
    for (const userId of group.memberUserIds) {
      if (!usersById.has(userId)) fail(`group member ${userId} is missing`)
    }
  }
}

function reportFromMapping(mapping: ReviewedOrganizationMapping): OrganizationImportReport {
  return {
    mappedDepartmentCount: mapping.departments.length,
    mappedUserCount: new Set(mapping.positionAssignments.map((assignment) => assignment.userId)).size,
    mappedExternalApproverCount: mapping.externalApprovers.length,
    unmappedDepartmentIds: [],
    unmappedUserIds: [],
    blockingReasons: [],
    wouldCreateUnits: mapping.units.length,
    wouldCreateAssignments: mapping.positionAssignments.length,
    wouldCreateReportingGroups: mapping.reportingGroups.length,
  }
}

async function comparePersisted(
  tx: OrganizationMappingApplyTx,
  mapping: ReviewedOrganizationMapping,
): Promise<void> {
  const [units, assignments, groups, members] = await Promise.all([
    tx.organization_units.findMany(),
    tx.organization_position_assignments.findMany(),
    tx.reporting_groups.findMany(),
    tx.reporting_group_members.findMany(),
  ])
  const unitsById = new Map(units.map((unit) => [unit.id, unit]))
  for (const unit of mapping.units) {
    const persisted = unitsById.get(unit.id)
    if (!persisted || !sameUnit(persisted, unit)) fail(`persisted unit ${unit.id} does not match the reviewed mapping`)
  }
  const assignmentsByKey = new Map(assignments.map((row) => [assignmentKey(row), row]))
  for (const assignment of mapping.positionAssignments) {
    const persisted = assignmentsByKey.get(assignmentKey(assignment))
    if (!persisted || persisted.isPrimary !== assignment.isPrimary || persisted.reportingGroupId !== assignment.reportingGroupId) {
      fail(`persisted assignment ${assignmentKey(assignment)} does not match the reviewed mapping`)
    }
  }
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  for (const group of mapping.reportingGroups) {
    const persisted = groupsById.get(group.id)
    if (!persisted || persisted.unitId !== group.unitId || persisted.parentGroupId !== group.parentGroupId || persisted.name !== group.name) {
      fail(`persisted reporting group ${group.id} does not match the reviewed mapping`)
    }
  }
  const memberKeys = new Set(members.map((member) => `${member.reportingGroupId}:${member.userId}`))
  for (const group of mapping.reportingGroups) {
    for (const userId of group.memberUserIds) {
      if (!memberKeys.has(`${group.id}:${userId}`)) fail(`persisted group ${group.id} is missing member ${userId}`)
    }
  }
}

/**
 * Apply a reviewed mapping inside an already-open transaction. The CLI is the
 * only authorized caller; this is never a general web action. Same-digest
 * replays are idempotent. Conflicting existing IDs are rejected. Legacy user
 * and approval fields are never cleared.
 */
export async function applyReviewedOrganizationMapping(
  tx: OrganizationMappingApplyTx,
  mapping: ReviewedOrganizationMapping,
  options: ApplyReviewedOrganizationMappingOptions,
): Promise<OrganizationImportReport> {
  if (!options.appliedBy.trim()) fail('appliedBy is required')
  if (!options.targetIdentity.trim()) fail('approved target identity is required')
  validateReviewedOrganizationMapping(mapping)
  const digest = computeReviewedOrganizationMappingDigest(mapping)
  if (options.expectedDigest !== digest) {
    throw new Error(`Stale organization mapping digest: expected ${digest} but received ${options.expectedDigest}`)
  }
  await lockImportIdentity(tx, options.targetIdentity)
  const existingRun = await tx.organization_import_runs.findUnique({ where: { mappingDigest: digest } })
  const replay = existingRun !== null
  await revalidateAgainstLoadedRows(tx, mapping)

  const mappingAssignmentKeys = new Set(mapping.positionAssignments.map(assignmentKey))
  for (const assignment of mapping.positionAssignments) {
    const existingPrimaries = await tx.organization_position_assignments.findMany({
      where: { userId: assignment.userId, isPrimary: true, isActive: true },
    })
    for (const primary of existingPrimaries) {
      if (!mappingAssignmentKeys.has(assignmentKey(primary))) {
        conflict(`user ${assignment.userId} already has an unrelated primary assignment ${primary.id}`)
      }
    }
  }

  for (const unit of parentFirst(mapping.units, (row) => row.parentId)) {
    const existing = await tx.organization_units.findUnique({ where: { id: unit.id } })
    if (existing) {
      if (!sameUnit(existing, unit)) {
        if (!replay) conflict(`unit ${unit.id} already exists with a different identity`)
        await tx.organization_units.update({
          where: { id: unit.id },
          data: { name: unit.name, parentId: unit.parentId, unitType: unit.unitType },
        })
      }
    } else {
      await tx.organization_units.create({
        data: {
          id: unit.id,
          name: unit.name,
          unitType: unit.unitType,
          parentId: unit.parentId,
          legacyDepartmentId: null,
          isActive: true,
          operationalType: 'GENERAL',
        },
      })
    }
  }

  for (const group of parentFirst(mapping.reportingGroups, (row) => row.parentGroupId)) {
    const existing = await tx.reporting_groups.findUnique({ where: { id: group.id } })
    if (existing) {
      const same = existing.unitId === group.unitId && existing.parentGroupId === group.parentGroupId && existing.name === group.name
      if (!same) {
        if (!replay) conflict(`reporting group ${group.id} already exists with a different identity`)
        await tx.reporting_groups.update({
          where: { id: group.id },
          data: { unitId: group.unitId, parentGroupId: group.parentGroupId, name: group.name },
        })
      }
    } else {
      await tx.reporting_groups.create({
        data: {
          id: group.id,
          unitId: group.unitId,
          parentGroupId: group.parentGroupId,
          name: group.name,
          isActive: true,
        },
      })
    }
    for (const userId of group.memberUserIds) {
      const existingMember = await tx.reporting_group_members.findUnique({
        where: { reportingGroupId_userId: { reportingGroupId: group.id, userId } },
      })
      if (!existingMember) {
        await tx.reporting_group_members.create({ data: { reportingGroupId: group.id, userId } })
      }
    }
  }

  for (const assignment of mapping.positionAssignments) {
    const existing = await tx.organization_position_assignments.findUnique({
      where: { userId_unitId_positionCode: { userId: assignment.userId, unitId: assignment.unitId, positionCode: assignment.positionCode } },
    })
    if (existing) {
      const same = existing.isPrimary === assignment.isPrimary && existing.reportingGroupId === assignment.reportingGroupId
      if (!same) {
        if (!replay) conflict(`assignment ${assignmentKey(assignment)} already exists with different flags`)
        await tx.organization_position_assignments.update({
          where: { id: existing.id },
          data: { isPrimary: assignment.isPrimary, reportingGroupId: assignment.reportingGroupId, isActive: true },
        })
      }
    } else {
      await tx.organization_position_assignments.create({
        data: {
          userId: assignment.userId,
          unitId: assignment.unitId,
          positionCode: assignment.positionCode,
          reportingGroupId: assignment.reportingGroupId,
          isPrimary: assignment.isPrimary,
          isActive: true,
        },
      })
    }
  }

  for (const department of mapping.departments) {
    const holder = await tx.organization_units.findUnique({ where: { legacyDepartmentId: department.legacyDepartmentId } })
    if (holder && holder.id !== department.targetUnitId) {
      conflict(`legacy department ${department.legacyDepartmentId} is already linked to ${holder.id}`)
    }
    await tx.organization_units.update({
      where: { id: department.targetUnitId },
      data: {
        legacyDepartmentId: department.legacyDepartmentId,
        operationalType: department.engineeringClassification,
      },
    })
  }

  const departmentTarget = new Map(mapping.departments.map((row) => [row.legacyDepartmentId, row.targetUnitId]))
  const requests = await tx.requests.findMany({
    where: { departmentId: { in: [...departmentTarget.keys()] } },
  })
  let requestsBackfilled = 0
  for (const request of requests) {
    if (!request.departmentId) continue
    const originUnitId = departmentTarget.get(request.departmentId)
    if (!originUnitId) continue
    if (request.organizationUnitId === originUnitId) continue
    if (request.organizationUnitId !== null && request.organizationUnitId !== originUnitId) {
      conflict(`request ${request.id} already has origin ${request.organizationUnitId}`)
    }
    await tx.requests.update({
      where: { id: request.id },
      data: { organizationUnitId: originUnitId },
    })
    requestsBackfilled += 1
  }

  await comparePersisted(tx, mapping)

  if (!replay) {
    await tx.organization_import_runs.create({
      data: {
        mappingDigest: digest,
        appliedBy: options.appliedBy,
        targetIdentity: options.targetIdentity,
        counts: {
          units: mapping.units.length,
          assignments: mapping.positionAssignments.length,
          reportingGroups: mapping.reportingGroups.length,
          members: mapping.reportingGroups.reduce((sum, group) => sum + group.memberUserIds.length, 0),
          requestsBackfilled,
        },
      },
    })
  }

  return reportFromMapping(mapping)
}
