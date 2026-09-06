import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ancestorUnitIds,
  assertAcyclicOrganizationTree,
  descendantUnitIds,
  positionLevel,
} from '@/lib/organization/tree'
import type { OrganizationUnitNode } from '@/lib/organization/types'
import { loadUserOrganizationContext, resolveReportingBranch } from '@/lib/organization/repository'

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
  const baseUnits = [
    { id: 'f1', name: 'F', unitType: 'FACTORY', parentId: null, isActive: true }, { id: 'd1', name: 'D', unitType: 'DIVISION', parentId: 'f1', isActive: true },
    { id: 'de1', name: 'De', unitType: 'DEPARTMENT', parentId: 'd1', isActive: true }, { id: 's1', name: 'S1', unitType: 'SECTION', parentId: 'de1', isActive: true },
    { id: 's2', name: 'S2', unitType: 'SECTION', parentId: 'de1', isActive: true },
  ]
  const baseAssignments = [{ id: 'a1', userId: 'u1', unitId: 's1', positionCode: 'STAFF', reportingGroupId: 'g1', isPrimary: true, isActive: true }]
  const baseGroups = [{ id: 'g1', unitId: 's1', parentGroupId: null, name: 'G1', isActive: true }]
  const makeDb = (options: { user?: unknown; assignments?: unknown[]; units?: unknown[]; groups?: unknown[]; members?: unknown[] } = {}) => ({
    user: { findUnique: async () => options.user === undefined ? { id: 'u1', isActive: true } : options.user },
    organization_position_assignments: { findMany: async () => options.assignments ?? baseAssignments },
    organization_units: { findMany: async () => options.units ?? baseUnits },
    reporting_groups: { findMany: async () => options.groups ?? baseGroups },
    reporting_group_members: { findMany: async () => options.members ?? [{ reportingGroupId: 'g1', userId: 'u1' }] },
  }) as any
  const resolve = (options: Parameters<typeof makeDb>[0] = {}) => resolveReportingBranch('u1', makeDb(options))

  it('returns the selected branch path and excludes sibling groups', async () => {
    assert.deepEqual(await resolve({ groups: [
      { id: 'g1', unitId: 's1', parentGroupId: 'g0', name: 'Child', isActive: true }, { id: 'g0', unitId: 's1', parentGroupId: null, name: 'Parent', isActive: true },
      { id: 'sibling', unitId: 's1', parentGroupId: null, name: 'Sibling', isActive: true },
    ], members: [{ reportingGroupId: 'g1', userId: 'u1' }, { reportingGroupId: 'g0', userId: 'u1' }] }),
    { originUserId: 'u1', primaryUnitId: 's1', primaryAssignmentId: 'a1', primaryPosition: 'STAFF', unitPath: ['s1', 'de1', 'd1', 'f1'], groupPath: ['g1', 'g0'] })
  })

  it('returns null only for missing, inactive, or completely unmapped users', async () => {
    assert.equal(await resolve({ user: null }), null)
    assert.equal(await resolve({ user: { id: 'u1', isActive: false } }), null)
    assert.equal(await resolve({ assignments: [] }), null)
  })

  it('rejects missing, multiple, and inactive-only active primaries', async () => {
    await assert.rejects(resolve({ assignments: [{ ...baseAssignments[0], isPrimary: false }] }), /exactly one active primary/i)
    await assert.rejects(resolve({ assignments: [baseAssignments[0], { ...baseAssignments[0], id: 'a2', isPrimary: true }] }), /exactly one active primary/i)
    await assert.rejects(resolve({ assignments: [{ ...baseAssignments[0], isActive: false }] }), /exactly one active primary/i)
  })

  it('rejects missing or inactive origin and ancestor units and wrong position-unit pairs', async () => {
    await assert.rejects(resolve({ units: baseUnits.filter((unit) => unit.id !== 's1') }), /inactive or missing unit/i)
    await assert.rejects(resolve({ units: baseUnits.map((unit) => unit.id === 'de1' ? { ...unit, isActive: false } : unit) }), /ancestor.*inactive/i)
    await assert.rejects(resolve({ assignments: [{ ...baseAssignments[0], positionCode: 'DEPARTMENT_MANAGER' }] }), /does not match unit/i)
  })

  it('rejects malformed group parents and validates selected membership', async () => {
    await assert.rejects(resolve({ groups: [{ ...baseGroups[0], parentGroupId: 'missing' }] }), /group parent/i)
    await assert.rejects(resolve({ groups: [{ id: 'g2', unitId: 's2', parentGroupId: null, name: 'G2', isActive: true }, { ...baseGroups[0], parentGroupId: 'g2' }] }), /crosses sections/i)
    await assert.rejects(resolve({ groups: [{ ...baseGroups[0], unitId: 's2' }] }), /membership|outside/i)
    await assert.rejects(resolve({ members: [] }), /membership/i)
  })

  it('rejects every foreign membership but permits a valid secondary section assignment', async () => {
    const foreignGroup = { id: 'g2', unitId: 's2', parentGroupId: null, name: 'G2', isActive: true }
    await assert.rejects(resolve({ groups: [...baseGroups, foreignGroup], members: [{ reportingGroupId: 'g1', userId: 'u1' }, { reportingGroupId: 'g2', userId: 'u1' }] }), /membership/i)
    assert.deepEqual(await resolve({ assignments: [{ ...baseAssignments[0], reportingGroupId: null }, { id: 'a2', userId: 'u1', unitId: 's2', positionCode: 'SUPERVISOR', reportingGroupId: null, isPrimary: false, isActive: true }], groups: [...baseGroups, foreignGroup], members: [{ reportingGroupId: 'g2', userId: 'u1' }] }), { originUserId: 'u1', primaryUnitId: 's1', primaryAssignmentId: 'a1', primaryPosition: 'STAFF', unitPath: ['s1', 'de1', 'd1', 'f1'], groupPath: [] })
    await assert.rejects(resolve({ assignments: [{ ...baseAssignments[0], reportingGroupId: null }, { id: 'a2', userId: 'u1', unitId: 's2', positionCode: 'DEPARTMENT_MANAGER', reportingGroupId: null, isPrimary: false, isActive: true }], groups: [...baseGroups, foreignGroup], members: [{ reportingGroupId: 'g2', userId: 'u1' }] }), /membership/i)
    await assert.rejects(resolve({ assignments: [{ ...baseAssignments[0], reportingGroupId: null }, { id: 'a2', userId: 'u1', unitId: 's2', positionCode: 'SUPERVISOR', reportingGroupId: null, isPrimary: false, isActive: true }], units: baseUnits.map((unit) => unit.id === 'de1' ? { ...unit, isActive: false } : unit), groups: [...baseGroups, foreignGroup], members: [{ reportingGroupId: 'g2', userId: 'u1' }] }), /ancestor|membership/i)
    await assert.rejects(resolve({ assignments: [{ ...baseAssignments[0], reportingGroupId: null }], groups: [...baseGroups, foreignGroup], members: [{ reportingGroupId: 'g2', userId: 'u1' }] }), /membership/i)
  })

  it('keeps parent-manager scope on its own unit without section duplication', async () => {
    const assignments = [{ id: 'manager', userId: 'u1', unitId: 'de1', positionCode: 'DEPARTMENT_MANAGER', reportingGroupId: null, isPrimary: true, isActive: true }]
    assert.deepEqual(await resolve({ assignments, members: [] }), { originUserId: 'u1', primaryUnitId: 'de1', primaryAssignmentId: 'manager', primaryPosition: 'DEPARTMENT_MANAGER', unitPath: ['de1', 'd1', 'f1'], groupPath: [] })
  })

  it('loadUserOrganizationContext returns context, null, and preserves configuration errors', async () => {
    const context = await loadUserOrganizationContext('u1', makeDb())
    assert.equal(context?.branch.primaryAssignmentId, 'a1')
    assert.equal(await loadUserOrganizationContext('u1', makeDb({ assignments: [] })), null)
    await assert.rejects(loadUserOrganizationContext('u1', makeDb({ assignments: [{ ...baseAssignments[0], isActive: false }] })), /exactly one active primary/i)
  })
})
