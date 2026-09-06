import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ancestorUnitIds,
  assertAcyclicOrganizationTree,
  descendantUnitIds,
  positionLevel,
} from '@/lib/organization/tree'
import type { OrganizationUnitNode } from '@/lib/organization/types'
import { resolveReportingBranch } from '@/lib/organization/repository'

const units: OrganizationUnitNode[] = [
  { id: 'factory-1', name: 'Factory', unitType: 'FACTORY', parentId: null, isActive: true },
  { id: 'division-1', name: 'Division', unitType: 'DIVISION', parentId: 'factory-1', isActive: true },
  { id: 'department-1', name: 'Department', unitType: 'DEPARTMENT', parentId: 'division-1', isActive: true },
  { id: 'section-1', name: 'PD1', unitType: 'SECTION', parentId: 'department-1', isActive: true },
  { id: 'section-2', name: 'PD2', unitType: 'SECTION', parentId: 'department-1', isActive: true },
]

describe('organization tree', () => {
  it('walks nearest ancestor first and descendants without crossing siblings', () => {
    assert.deepEqual(ancestorUnitIds(units, 'section-1'), ['section-1', 'department-1', 'division-1', 'factory-1'])
    assert.deepEqual(descendantUnitIds(units, 'department-1').sort(), ['department-1', 'section-1', 'section-2'])
    assert.equal(descendantUnitIds(units, 'section-1').includes('section-2'), false)
  })

  it('rejects cycles and keeps position levels distinct from system roles', () => {
    assert.throws(() => assertAcyclicOrganizationTree([
      ...units.slice(0, 3),
      { ...units[3], parentId: 'section-4' },
      { id: 'section-4', name: 'Cycle', unitType: 'SECTION', parentId: 'section-1', isActive: true },
    ]), /cycle/i)
    assert.equal(positionLevel('STAFF'), 1)
    assert.equal(positionLevel('FACTORY_MANAGER'), 6)
  })
})

describe('organization repository validation', () => {
  const makeDb = (overrides: Record<string, unknown> = {}) => ({
    user: { findUnique: async () => ({ id: 'u1', isActive: true }) },
    organization_position_assignments: { findMany: async () => [{ id: 'a1', userId: 'u1', unitId: 's1', positionCode: 'STAFF', reportingGroupId: 'g1', isPrimary: true, isActive: true }] },
    organization_units: { findMany: async () => [
      { id: 'f1', name: 'F', unitType: 'FACTORY', parentId: null, isActive: true }, { id: 'd1', name: 'D', unitType: 'DIVISION', parentId: 'f1', isActive: true },
      { id: 'de1', name: 'De', unitType: 'DEPARTMENT', parentId: 'd1', isActive: true }, { id: 's1', name: 'S', unitType: 'SECTION', parentId: 'de1', isActive: true },
    ] },
    reporting_groups: { findMany: async () => [{ id: 'g1', unitId: 's1', parentGroupId: null, name: 'G', isActive: true }] },
    reporting_group_members: { findMany: async () => [{ reportingGroupId: 'g1', userId: 'u1' }] },
    ...overrides,
  }) as any

  it('returns a branch from a structural fake', async () => {
    assert.deepEqual(await resolveReportingBranch('u1', makeDb()), { originUserId: 'u1', primaryUnitId: 's1', primaryAssignmentId: 'a1', primaryPosition: 'STAFF', unitPath: ['s1', 'de1', 'd1', 'f1'], groupPath: ['g1'] })
  })

  it('fails closed for malformed parents, group cycles, and memberships', async () => {
    await assert.rejects(resolveReportingBranch('u1', makeDb({ organization_units: { findMany: async () => [{ id: 's1', name: 'S', unitType: 'SECTION', parentId: null, isActive: true }] } })), /parent type/i)
    await assert.rejects(resolveReportingBranch('u1', makeDb({ reporting_groups: { findMany: async () => [{ id: 'g1', unitId: 's1', parentGroupId: 'g2', name: 'G', isActive: true }, { id: 'g2', unitId: 's1', parentGroupId: 'g1', name: 'H', isActive: true }] } })), /cycle/i)
    await assert.rejects(resolveReportingBranch('u1', makeDb({ reporting_group_members: { findMany: async () => [] } })), /membership/i)
  })
})
