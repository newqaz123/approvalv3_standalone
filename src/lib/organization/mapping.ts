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
