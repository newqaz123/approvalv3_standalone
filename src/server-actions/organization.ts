'use server'

import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { assertAcyclicOrganizationTree } from '@/lib/organization/tree'
import type {
  OrganizationPositionAssignment,
  OrganizationPositionCode,
  OrganizationUnitNode,
  OrganizationUnitType,
  ReportingGroupNode,
} from '@/lib/organization/types'
import type { OrganizationImportReport } from '../../scripts/organization-import-dry-run'

/**
 * Admin server actions for typed organization units, position assignments,
 * and reporting groups (Task 14). Every action derives its actor from
 * `requireAdmin`, validates parent type and acyclicity, rejects ambiguous
 * primary assignments, and writes an audit record. Organization edits never
 * touch pending approval rows or candidate groups. Deactivation is explicit
 * and does not activate a replacement. Parent managers stay on their parent
 * unit and are never duplicated into descendant sections.
 */

const POSITION_UNIT: Record<OrganizationPositionCode, OrganizationUnitType> = {
  STAFF: 'SECTION',
  SUPERVISOR: 'SECTION',
  SECTION_MANAGER: 'SECTION',
  DEPARTMENT_MANAGER: 'DEPARTMENT',
  DIVISION_MANAGER: 'DIVISION',
  FACTORY_MANAGER: 'FACTORY',
}

const EXPECTED_PARENT: Record<OrganizationUnitType, OrganizationUnitType | null> = {
  FACTORY: null,
  DIVISION: 'FACTORY',
  DEPARTMENT: 'DIVISION',
  SECTION: 'DEPARTMENT',
}

const UNIT_TYPES: readonly OrganizationUnitType[] = ['FACTORY', 'DIVISION', 'DEPARTMENT', 'SECTION']
const POSITION_CODES = Object.keys(POSITION_UNIT) as OrganizationPositionCode[]
const PARENT_MANAGER_POSITIONS = new Set<OrganizationPositionCode>([
  'DEPARTMENT_MANAGER',
  'DIVISION_MANAGER',
  'FACTORY_MANAGER',
])

async function requireOrganizationAdmin(): Promise<string> {
  const adminId = await requireAdmin()
  if (!adminId) {
    throw new Error('Admin authorization is required for organization actions')
  }
  return adminId
}

async function writeOrganizationAudit(adminId: string, comments: string): Promise<void> {
  await prisma.request_activities.create({
    data: {
      action: 'organization_admin_changed',
      comments,
      userId: adminId,
      createdAt: new Date(),
    },
  })
}

function isUnitType(value: unknown): value is OrganizationUnitType {
  return typeof value === 'string' && UNIT_TYPES.includes(value as OrganizationUnitType)
}

function isPositionCode(value: unknown): value is OrganizationPositionCode {
  return typeof value === 'string' && POSITION_CODES.includes(value as OrganizationPositionCode)
}

function asUnitNode(row: {
  id: string
  name: string
  unitType: OrganizationUnitType
  parentId: string | null
  isActive: boolean
}): OrganizationUnitNode {
  return {
    id: row.id,
    name: row.name,
    unitType: row.unitType,
    parentId: row.parentId,
    isActive: row.isActive,
  }
}

function assertValidParentType(unit: OrganizationUnitNode, byId: Map<string, OrganizationUnitNode>): void {
  const expected = EXPECTED_PARENT[unit.unitType]
  const parent = unit.parentId ? byId.get(unit.parentId) : undefined
  if (expected === null && unit.parentId) {
    throw new Error(`Invalid parent type for ${unit.id}: a factory cannot have a parent`)
  }
  if (expected !== null && (!parent || parent.unitType !== expected)) {
    throw new Error(`Invalid parent type for ${unit.id}`)
  }
}

async function loadUnitNodes(): Promise<OrganizationUnitNode[]> {
  const rows = await prisma.organization_units.findMany()
  return rows.map((row) => asUnitNode({
    id: row.id,
    name: row.name,
    unitType: row.unitType as OrganizationUnitType,
    parentId: row.parentId,
    isActive: row.isActive,
  }))
}

function validateProposedUnits(units: OrganizationUnitNode[]): Map<string, OrganizationUnitNode> {
  assertAcyclicOrganizationTree(units)
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  for (const unit of units) assertValidParentType(unit, byId)
  return byId
}

function emptyMappingCoverage(): OrganizationImportReport {
  return {
    mappedDepartmentCount: 0,
    mappedUserCount: 0,
    mappedExternalApproverCount: 0,
    unmappedDepartmentIds: [],
    unmappedUserIds: [],
    blockingReasons: [],
    wouldCreateUnits: 0,
    wouldCreateAssignments: 0,
    wouldCreateReportingGroups: 0,
  }
}

function assertExactlyOneActivePrimary(
  assignments: Array<{ isActive: boolean; isPrimary: boolean }>,
  userId: string,
): void {
  const activePrimaries = assignments.filter((assignment) => assignment.isActive && assignment.isPrimary)
  if (activePrimaries.length !== 1) {
    throw new Error(`User ${userId} must have exactly one active primary assignment`)
  }
}

export async function getOrganizationAdminData(): Promise<{
  units: OrganizationUnitNode[]
  assignments: OrganizationPositionAssignment[]
  reportingGroups: ReportingGroupNode[]
  mappingCoverage: OrganizationImportReport
  pendingInstanceCounts: Record<string, number>
}> {
  await requireOrganizationAdmin()

  const [unitRows, assignmentRows, groupRows, pendingRows] = await Promise.all([
    prisma.organization_units.findMany({ orderBy: { name: 'asc' } }),
    prisma.organization_position_assignments.findMany(),
    prisma.reporting_groups.findMany({ orderBy: { name: 'asc' } }),
    prisma.approval_instances.findMany({
      where: { state: 'PENDING' },
      select: { originUnitId: true },
    }),
  ])

  const pendingInstanceCounts: Record<string, number> = {}
  for (const row of pendingRows) {
    pendingInstanceCounts[row.originUnitId] = (pendingInstanceCounts[row.originUnitId] ?? 0) + 1
  }

  return {
    units: unitRows.map((row) => asUnitNode({
      id: row.id,
      name: row.name,
      unitType: row.unitType as OrganizationUnitType,
      parentId: row.parentId,
      isActive: row.isActive,
    })),
    assignments: assignmentRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      unitId: row.unitId,
      positionCode: row.positionCode as OrganizationPositionCode,
      reportingGroupId: row.reportingGroupId,
      isPrimary: row.isPrimary,
      isActive: row.isActive,
    })),
    reportingGroups: groupRows.map((row) => ({
      id: row.id,
      unitId: row.unitId,
      parentGroupId: row.parentGroupId,
      name: row.name,
      isActive: row.isActive,
    })),
    mappingCoverage: emptyMappingCoverage(),
    pendingInstanceCounts,
  }
}

export async function createOrganizationUnit(input: {
  id?: string
  name: string
  unitType: OrganizationUnitType
  parentId: string | null
}): Promise<{ id: string }> {
  const adminId = await requireOrganizationAdmin()
  const name = input.name.trim()
  if (!name) throw new Error('Organization unit name is required')
  if (!isUnitType(input.unitType)) throw new Error('Organization unit type is invalid')

  const units = await loadUnitNodes()
  const id = input.id?.trim() || `unit-${Date.now()}`
  if (units.some((unit) => unit.id === id)) throw new Error(`Organization unit ${id} already exists`)
  const proposed: OrganizationUnitNode = {
    id,
    name,
    unitType: input.unitType,
    parentId: input.parentId,
    isActive: true,
  }
  validateProposedUnits([...units, proposed])

  const created = await prisma.organization_units.create({
    data: {
      id,
      name,
      unitType: input.unitType,
      parentId: input.parentId,
      isActive: true,
      updatedAt: new Date(),
    },
  })
  await writeOrganizationAudit(adminId, `Created organization unit ${created.id} (${name}, ${input.unitType})`)
  revalidatePath('/admin/organization')
  return { id: created.id }
}

export async function updateOrganizationUnit(input: {
  id: string
  name: string
  parentId: string | null
  isActive: boolean
}): Promise<{ success: true }> {
  const adminId = await requireOrganizationAdmin()
  const name = input.name.trim()
  if (!name) throw new Error('Organization unit name is required')

  const units = await loadUnitNodes()
  const current = units.find((unit) => unit.id === input.id)
  if (!current) throw new Error(`Organization unit ${input.id} is missing`)

  const proposed = units.map((unit) => (
    unit.id === input.id
      ? { ...unit, name, parentId: input.parentId, isActive: input.isActive }
      : unit
  ))
  validateProposedUnits(proposed)

  await prisma.organization_units.update({
    where: { id: input.id },
    data: {
      name,
      parentId: input.parentId,
      isActive: input.isActive,
      updatedAt: new Date(),
    },
  })
  await writeOrganizationAudit(
    adminId,
    `Updated organization unit ${input.id}: name=${name}, parentId=${input.parentId ?? 'null'}, isActive=${input.isActive}`,
  )
  revalidatePath('/admin/organization')
  return { success: true }
}

export async function savePositionAssignment(input: {
  userId: string
  unitId: string
  positionCode: OrganizationPositionCode
  reportingGroupId: string | null
  isPrimary: boolean
  isActive: boolean
}): Promise<{ success: true }> {
  const adminId = await requireOrganizationAdmin()
  if (!input.userId) throw new Error('User is required')
  if (!isPositionCode(input.positionCode)) throw new Error('Position code is invalid')

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } })
  if (!user) throw new Error('User not found')

  const units = await loadUnitNodes()
  validateProposedUnits(units)
  const unit = units.find((candidate) => candidate.id === input.unitId)
  if (!unit) throw new Error(`Organization unit ${input.unitId} is missing`)
  if (POSITION_UNIT[input.positionCode] !== unit.unitType) {
    throw new Error(`Position ${input.positionCode} does not match unit ${unit.id}`)
  }
  if (PARENT_MANAGER_POSITIONS.has(input.positionCode) && input.reportingGroupId) {
    throw new Error(`Parent manager ${input.userId} cannot be duplicated into descendant sections`)
  }

  if (input.reportingGroupId) {
    if (unit.unitType !== 'SECTION') {
      throw new Error(`Reporting-group section membership is only valid on a section`)
    }
    const group = await prisma.reporting_groups.findUnique({ where: { id: input.reportingGroupId } })
    if (!group || group.unitId !== unit.id) {
      throw new Error(`Reporting group ${input.reportingGroupId} is outside the assigned section`)
    }
  }

  const existing = await prisma.organization_position_assignments.findMany({ where: { userId: input.userId } })
  const match = existing.find(
    (assignment) => assignment.unitId === input.unitId && assignment.positionCode === input.positionCode,
  )
  const next = existing
    .filter((assignment) => assignment !== match)
    .map((assignment) => ({
      isActive: assignment.isActive,
      isPrimary: assignment.isPrimary,
    }))
  next.push({ isActive: input.isActive, isPrimary: input.isPrimary })
  assertExactlyOneActivePrimary(next, input.userId)

  if (match) {
    await prisma.organization_position_assignments.update({
      where: { id: match.id },
      data: {
        reportingGroupId: input.reportingGroupId,
        isPrimary: input.isPrimary,
        isActive: input.isActive,
        updatedAt: new Date(),
      },
    })
  } else {
    await prisma.organization_position_assignments.create({
      data: {
        userId: input.userId,
        unitId: input.unitId,
        positionCode: input.positionCode,
        reportingGroupId: input.reportingGroupId,
        isPrimary: input.isPrimary,
        isActive: input.isActive,
        updatedAt: new Date(),
      },
    })
  }

  await writeOrganizationAudit(
    adminId,
    `Saved position assignment user=${input.userId} unit=${input.unitId} position=${input.positionCode} primary=${input.isPrimary} active=${input.isActive}`,
  )
  revalidatePath('/admin/organization')
  revalidatePath('/admin/users')
  return { success: true }
}

export async function saveReportingGroup(input: {
  id?: string
  unitId: string
  parentGroupId: string | null
  name: string
  memberUserIds: string[]
}): Promise<{ id: string }> {
  const adminId = await requireOrganizationAdmin()
  const name = input.name.trim()
  if (!name) throw new Error('Reporting group name is required')

  const units = await loadUnitNodes()
  validateProposedUnits(units)
  const unit = units.find((candidate) => candidate.id === input.unitId)
  if (!unit || unit.unitType !== 'SECTION') {
    throw new Error(`Reporting group must be attached to a section`)
  }

  const groups = (await prisma.reporting_groups.findMany()).map((group) => ({
    id: group.id,
    unitId: group.unitId,
    parentGroupId: group.parentGroupId,
    name: group.name,
    isActive: group.isActive,
  })) as ReportingGroupNode[]
  const existingId = input.id?.trim() || ''
  const id = existingId || `group-${Date.now()}`
  const nextGroups = [
    ...groups.filter((group) => group.id !== id),
    { id, unitId: input.unitId, parentGroupId: input.parentGroupId, name, isActive: true },
  ]
  const byId = new Map(nextGroups.map((group) => [group.id, group]))
  if (input.parentGroupId) {
    const parent = byId.get(input.parentGroupId)
    if (!parent) throw new Error(`Reporting group parent ${input.parentGroupId} is missing`)
    if (parent.unitId !== input.unitId) throw new Error(`Reporting group ${id} crosses sections`)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (groupId: string): void => {
    if (visiting.has(groupId)) throw new Error(`Reporting group cycle detected at ${groupId}`)
    if (visited.has(groupId)) return
    const group = byId.get(groupId)
    if (!group) throw new Error(`Reporting group ${groupId} is missing`)
    visiting.add(groupId)
    if (group.parentGroupId) visit(group.parentGroupId)
    visiting.delete(groupId)
    visited.add(groupId)
  }
  for (const group of nextGroups) visit(group.id)

  const memberUserIds = [...new Set(input.memberUserIds)]
  if (memberUserIds.length > 0) {
    const memberAssignments = await prisma.organization_position_assignments.findMany({
      where: { userId: { in: memberUserIds } },
    })
    for (const memberUserId of memberUserIds) {
      const assignments = memberAssignments.filter((assignment) => assignment.userId === memberUserId && assignment.isActive)
      if (assignments.some((assignment) => PARENT_MANAGER_POSITIONS.has(assignment.positionCode as OrganizationPositionCode))) {
        throw new Error(`Parent manager ${memberUserId} cannot be duplicated into descendant sections`)
      }
      const sectionAssignment = assignments.find(
        (assignment) =>
          assignment.unitId === input.unitId &&
          POSITION_UNIT[assignment.positionCode as OrganizationPositionCode] === 'SECTION',
      )
      if (!sectionAssignment) {
        throw new Error(`User ${memberUserId} has inconsistent reporting-group section membership`)
      }
    }
  }

  const saved = existingId
    ? await prisma.reporting_groups.update({
        where: { id },
        data: {
          unitId: input.unitId,
          parentGroupId: input.parentGroupId,
          name,
          isActive: true,
          updatedAt: new Date(),
        },
      })
    : await prisma.reporting_groups.create({
        data: {
          id,
          unitId: input.unitId,
          parentGroupId: input.parentGroupId,
          name,
          isActive: true,
          updatedAt: new Date(),
        },
      })

  await prisma.reporting_group_members.deleteMany({ where: { reportingGroupId: saved.id } })
  for (const userId of memberUserIds) {
    await prisma.reporting_group_members.create({
      data: { reportingGroupId: saved.id, userId },
    })
  }

  await writeOrganizationAudit(
    adminId,
    `Saved reporting group ${saved.id} on unit ${input.unitId} with ${memberUserIds.length} members`,
  )
  revalidatePath('/admin/organization')
  return { id: saved.id }
}
