import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseReviewedOrganizationMapping } from '../../tools/organization-mapping-schema'
import {
  buildOrganizationImportReport,
  runOrganizationImportDryRun,
  type LegacyOrganizationInventory,
} from '../../scripts/organization-import-dry-run'

const ids = {
  factory: '10000000-0000-4000-8000-000000000001',
  division: '10000000-0000-4000-8000-000000000008',
  department: '10000000-0000-4000-8000-000000000009',
  section: '10000000-0000-4000-8000-000000000003',
  legacyDepartment: '10000000-0000-4000-8000-000000000002',
  mappedUser: '10000000-0000-4000-8000-000000000004',
  unmappedUser: '10000000-0000-4000-8000-000000000007',
  external: '10000000-0000-4000-8000-000000000010',
}

const base = {
  units: [
    { id: ids.factory, name: 'Factory', unitType: 'FACTORY', parentId: null },
    { id: ids.division, name: 'Division', unitType: 'DIVISION', parentId: ids.factory },
    { id: ids.department, name: 'Department', unitType: 'DEPARTMENT', parentId: ids.division },
    { id: ids.section, name: 'PD1', unitType: 'SECTION', parentId: ids.department },
  ],
  departments: [{ legacyDepartmentId: ids.legacyDepartment, targetUnitId: ids.section, engineeringClassification: 'GENERAL', disposition: 'REAL_SECTION' }],
  positionAssignments: [{ userId: ids.mappedUser, unitId: ids.section, positionCode: 'STAFF', reportingGroupId: null, isPrimary: true }],
  reportingGroups: [],
  externalApprovers: [],
  legacyLevelMappings: [{ legacyLevel: 1, positionCode: 'STAFF' }],
} as const

const inventory = (overrides: Partial<LegacyOrganizationInventory> = {}): LegacyOrganizationInventory => ({
  legacyDepartments: [{ id: ids.legacyDepartment, name: 'PD1', type: 'GENERAL' }],
  legacyUsers: [
    { id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true },
    { id: ids.unmappedUser, departmentId: ids.legacyDepartment, level: 7, isActive: true },
  ],
  legacyExternalApprovers: [],
  ...overrides,
})

describe('reviewed organization mapping schema', () => {
  it('rejects missing department mappings instead of deriving them from names', () => {
    assert.throws(() => parseReviewedOrganizationMapping({ ...base, departments: [] }), /department/i)
  })

  it('rejects structural references, cycles, incompatible positions, duplicate assignments, and missing primaries', () => {
    assert.throws(() => parseReviewedOrganizationMapping({ ...base, units: base.units.map((unit) => unit.id === ids.factory ? { ...unit, parentId: ids.section } : unit) }), /cycle|parent/i)
    assert.throws(() => parseReviewedOrganizationMapping({ ...base, positionAssignments: [{ ...base.positionAssignments[0], unitId: ids.department }] }), /match|position/i)
    assert.throws(() => parseReviewedOrganizationMapping({ ...base, positionAssignments: [{ ...base.positionAssignments[0], isPrimary: false }] }), /primary/i)
    assert.throws(() => parseReviewedOrganizationMapping({ ...base, positionAssignments: [base.positionAssignments[0], base.positionAssignments[0]] }), /unique/i)
  })

  it('requires direct section membership for groups and keeps manager assignments at their parent unit', () => {
    const manager = { userId: ids.mappedUser, unitId: ids.department, positionCode: 'DEPARTMENT_MANAGER' as const, reportingGroupId: null, isPrimary: true }
    assert.doesNotThrow(() => parseReviewedOrganizationMapping({ ...base, positionAssignments: [manager] }))
    assert.throws(() => parseReviewedOrganizationMapping({ ...base, reportingGroups: [{ id: ids.external, unitId: ids.section, parentGroupId: null, name: 'G', memberUserIds: [ids.unmappedUser] }] }), /section|membership/i)
  })
})

describe('reviewed organization import report', () => {
  it('reports missing levels 7–10 without compressing them and counts distinct mapped users', () => {
    const report = buildOrganizationImportReport({
      mapping: parseReviewedOrganizationMapping(base),
      ...inventory(),
    })
    assert.deepEqual(report.blockingReasons, [
      `USER_NOT_MAPPED:${ids.unmappedUser}`,
      `USER_LEVEL_NOT_EXPLICITLY_MAPPED:${ids.unmappedUser}:7`,
    ])
    assert.equal(report.mappedUserCount, 1)
    assert.equal(report.wouldCreateAssignments, 1)
  })

  it('does not treat null level acknowledgement as disabling an explicitly assigned active user', () => {
    const mapping = parseReviewedOrganizationMapping({ ...base, legacyLevelMappings: [{ legacyLevel: 1, positionCode: null }] })
    const report = buildOrganizationImportReport({ mapping, ...inventory({ legacyUsers: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true }] }) })
    assert.deepEqual(report.blockingReasons, [])
  })

  it('blocks unknown mapping identity, classification, external identity, and incorrect parent scope', () => {
    const mapping = parseReviewedOrganizationMapping({
      ...base,
      departments: [{ ...base.departments[0], engineeringClassification: 'ENGINEERING' }],
      externalApprovers: [{ legacyDepartmentApproverId: ids.external, userId: ids.unmappedUser, targetUnitId: ids.section, disposition: 'PARENT_SCOPE', positionCode: 'SECTION_MANAGER' }],
    })
    const report = buildOrganizationImportReport({
      mapping,
      ...inventory({ legacyExternalApprovers: [{ id: ids.external, approverId: ids.mappedUser, departmentId: ids.legacyDepartment, approverLevel: 1 }] }),
    })
    assert.ok(report.blockingReasons.some((reason) => /CLASSIFICATION/.test(reason)))
    assert.ok(report.blockingReasons.some((reason) => /PARENT_SCOPE/.test(reason)))
    assert.ok(report.blockingReasons.some((reason) => /EXTERNAL_APPROVER_USER_MISMATCH/.test(reason)))
  })

  it('produces a zero-blocker report with exact creation counts for a fully reviewed inventory', () => {
    const report = buildOrganizationImportReport({ mapping: parseReviewedOrganizationMapping(base), ...inventory({ legacyUsers: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true }] }) })
    assert.deepEqual(report.blockingReasons, [])
    assert.deepEqual({ mappedDepartmentCount: report.mappedDepartmentCount, mappedUserCount: report.mappedUserCount, wouldCreateUnits: report.wouldCreateUnits, wouldCreateAssignments: report.wouldCreateAssignments }, { mappedDepartmentCount: 1, mappedUserCount: 1, wouldCreateUnits: 4, wouldCreateAssignments: 1 })
  })
})

describe('organization import dry-run CLI', () => {
  it('is injectable, writes only the supplied report path, and exits 2 for blockers', async () => {
    const writes: Array<{ path: string; report: unknown }> = []
    const repository = { readLegacyRows: async () => inventory() }
    const code = await runOrganizationImportDryRun({
      argv: ['--mapping', 'reviewed.json', '--out', 'report.json'],
      repository,
      readMapping: async () => JSON.stringify(base),
      writeReport: async (path, report) => { writes.push({ path, report }) },
      print: () => undefined,
    })
    assert.equal(code, 2)
    assert.equal(writes[0]?.path, 'report.json')
  })
})
