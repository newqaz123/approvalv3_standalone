import type { Prisma } from '@prisma/client'
import { ancestorUnitIds, assertAcyclicOrganizationTree } from './tree'
import type { OrganizationPositionAssignment, OrganizationPositionCode, OrganizationUnitNode, ReportingBranch, ReportingGroupNode } from './types'

export type OrganizationRepository = Pick<Prisma.TransactionClient, 'user' | 'organization_units' | 'organization_position_assignments' | 'reporting_groups' | 'reporting_group_members'>

type Member = { reportingGroupId: string; userId: string }
const positionUnit: Record<OrganizationPositionCode, OrganizationUnitNode['unitType']> = {
  STAFF: 'SECTION', SUPERVISOR: 'SECTION', SECTION_MANAGER: 'SECTION',
  DEPARTMENT_MANAGER: 'DEPARTMENT', DIVISION_MANAGER: 'DIVISION', FACTORY_MANAGER: 'FACTORY',
}

function validateUnits(units: OrganizationUnitNode[]): Map<string, OrganizationUnitNode> {
  assertAcyclicOrganizationTree(units)
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  for (const unit of units) {
    const expectedParent = { FACTORY: null, DIVISION: 'FACTORY', DEPARTMENT: 'DIVISION', SECTION: 'DEPARTMENT' }[unit.unitType]
    const parent = unit.parentId ? byId.get(unit.parentId) : undefined
    if (expectedParent === null && unit.parentId) throw new Error(`Factory ${unit.id} cannot have a parent`)
    if (expectedParent !== null && (!parent || parent.unitType !== expectedParent)) throw new Error(`Invalid parent type for ${unit.id}`)
  }
  return byId
}

function validateGroups(groups: ReportingGroupNode[], units: Map<string, OrganizationUnitNode>): Map<string, ReportingGroupNode> {
  const byId = new Map(groups.map((group) => [group.id, group]))
  if (byId.size !== groups.length) throw new Error('Duplicate reporting group ID')
  const visiting = new Set<string>(), visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Reporting group cycle detected at ${id}`)
    if (visited.has(id)) return
    const group = byId.get(id); if (!group) throw new Error(`Reporting group ${id} is missing`)
    const unit = units.get(group.unitId)
    if (!unit || unit.unitType !== 'SECTION') throw new Error(`Reporting group ${id} is not attached to a section`)
    visiting.add(id)
    if (group.parentGroupId) {
      const parent = byId.get(group.parentGroupId)
      if (!parent) throw new Error(`Reporting group parent ${group.parentGroupId} is missing`)
      if (parent.unitId !== group.unitId) throw new Error(`Reporting group ${id} crosses sections`)
      visit(group.parentGroupId)
    }
    visiting.delete(id); visited.add(id)
  }
  for (const group of groups) visit(group.id)
  return byId
}

export async function resolveReportingBranch(userId: string, db: OrganizationRepository): Promise<ReportingBranch | null> {
  const user = await db.user.findUnique({ where: { id: userId } }) as { id: string; isActive: boolean } | null
  if (!user || !user.isActive) return null
  const rawAssignments = await db.organization_position_assignments.findMany({ where: { userId } })
  const assignments = rawAssignments.map((a) => ({ id: a.id, userId: a.userId, unitId: a.unitId, positionCode: a.positionCode, reportingGroupId: a.reportingGroupId, isPrimary: a.isPrimary, isActive: a.isActive })) as OrganizationPositionAssignment[]
  const active = assignments.filter((assignment) => assignment.isActive)
  if (!active.length) return null
  const primary = active.filter((assignment) => assignment.isPrimary)
  if (primary.length !== 1) throw new Error(`User ${userId} must have exactly one active primary assignment`)
  const units = (await db.organization_units.findMany()).map((u) => ({ id: u.id, name: u.name, unitType: u.unitType, parentId: u.parentId, isActive: u.isActive })) as OrganizationUnitNode[]
  const byUnit = validateUnits(units)
  const assignment = primary[0]
  const originUnit = byUnit.get(assignment.unitId)
  if (!originUnit || !originUnit.isActive) throw new Error(`Primary assignment ${assignment.id} has an inactive or missing unit`)
  if (positionUnit[assignment.positionCode] !== originUnit.unitType) throw new Error(`Position ${assignment.positionCode} does not match unit ${originUnit.id}`)
  const unitPath = ancestorUnitIds(units, assignment.unitId)
  for (const unitId of unitPath) if (!byUnit.get(unitId)!.isActive) throw new Error(`Organization ancestor ${unitId} is inactive`)

  const groups = (await db.reporting_groups.findMany()).map((g) => ({ id: g.id, unitId: g.unitId, parentGroupId: g.parentGroupId, name: g.name, isActive: g.isActive })) as ReportingGroupNode[]
  const byGroup = validateGroups(groups, byUnit)
  const members = await db.reporting_group_members.findMany() as Member[]
  const memberKeys = new Set(members.map((member) => `${member.reportingGroupId}:${member.userId}`))
  if (assignment.reportingGroupId) {
    const group = byGroup.get(assignment.reportingGroupId)
    if (!group || !memberKeys.has(`${group.id}:${userId}`)) throw new Error(`Assignment ${assignment.id} has inconsistent reporting-group membership`)
  }
  const groupPath: string[] = []
  if (assignment.reportingGroupId) {
    let current: string | null = assignment.reportingGroupId
    while (current) { const group: ReportingGroupNode = byGroup.get(current)!; if (!group.isActive) throw new Error(`Reporting group ${current} is inactive`); if (!unitPath.includes(group.unitId)) throw new Error(`Reporting group ${current} is outside the unit path`); groupPath.push(current); current = group.parentGroupId }
  }
  return { originUserId: userId, primaryUnitId: assignment.unitId, primaryAssignmentId: assignment.id, primaryPosition: assignment.positionCode, unitPath, groupPath }
}

export async function loadUserOrganizationContext(userId: string, db: OrganizationRepository): Promise<{ userId: string; branch: ReportingBranch } | null> {
  const branch = await resolveReportingBranch(userId, db)
  return branch ? { userId, branch } : null
}
