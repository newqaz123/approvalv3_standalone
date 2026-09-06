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
  section2: '10000000-0000-4000-8000-000000000011',
  otherFactory: '10000000-0000-4000-8000-000000000012',
  otherDivision: '10000000-0000-4000-8000-000000000019',
  otherDepartment: '10000000-0000-4000-8000-000000000013',
  legacyDepartment: '10000000-0000-4000-8000-000000000002',
  mappedUser: '10000000-0000-4000-8000-000000000004',
  secondUser: '10000000-0000-4000-8000-000000000005',
  inactiveUser: '10000000-0000-4000-8000-000000000006',
  unmappedUser: '10000000-0000-4000-8000-000000000007',
  unknownUser: '10000000-0000-4000-8000-000000000014',
  external: '10000000-0000-4000-8000-000000000010',
  external2: '10000000-0000-4000-8000-000000000015',
  external3: '10000000-0000-4000-8000-000000000016',
  external4: '10000000-0000-4000-8000-000000000017',
  group: '10000000-0000-4000-8000-000000000018',
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

function withScopeUnits() {
  return [
    ...base.units,
    { id: ids.section2, name: 'PD2', unitType: 'SECTION' as const, parentId: ids.department },
    { id: ids.otherFactory, name: 'Other Factory', unitType: 'FACTORY' as const, parentId: null },
    { id: ids.otherDivision, name: 'Other Division', unitType: 'DIVISION' as const, parentId: ids.otherFactory },
    { id: ids.otherDepartment, name: 'Other Department', unitType: 'DEPARTMENT' as const, parentId: ids.otherDivision },
  ]
}

function parentScopeMapping(targets: Array<{ id: string; positionCode: 'DEPARTMENT_MANAGER' | 'DIVISION_MANAGER' | 'FACTORY_MANAGER'; externalId: string }> = [{ id: ids.department, positionCode: 'DEPARTMENT_MANAGER', externalId: ids.external }]) {
  return parseReviewedOrganizationMapping({
    ...base,
    units: withScopeUnits(),
    positionAssignments: [
      ...base.positionAssignments,
      ...targets.map((target) => ({ userId: ids.mappedUser, unitId: target.id, positionCode: target.positionCode, reportingGroupId: null, isPrimary: false })),
    ],
    externalApprovers: targets.map((target) => ({ legacyDepartmentApproverId: target.externalId, userId: ids.mappedUser, targetUnitId: target.id, disposition: 'PARENT_SCOPE' as const, positionCode: target.positionCode })),
  })
}

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
    assert.throws(() => parseReviewedOrganizationMapping({ ...base, positionAssignments: [manager], reportingGroups: [{ id: ids.group, unitId: ids.section, parentGroupId: null, name: 'G', memberUserIds: [ids.mappedUser] }] }), /section|membership/i)
    const directSecondary = { userId: ids.mappedUser, unitId: ids.section, positionCode: 'SUPERVISOR' as const, reportingGroupId: ids.group, isPrimary: false }
    assert.doesNotThrow(() => parseReviewedOrganizationMapping({
      ...base,
      positionAssignments: [manager, directSecondary],
      reportingGroups: [{ id: ids.group, unitId: ids.section, parentGroupId: null, name: 'G', memberUserIds: [ids.mappedUser] }],
    }))
  })

  it('requires a matching explicit assignment for PARENT_SCOPE and permits manager-container self scope', () => {
    assert.doesNotThrow(() => parentScopeMapping([{ id: ids.department, positionCode: 'DEPARTMENT_MANAGER', externalId: ids.external }]))
    assert.throws(() => parseReviewedOrganizationMapping({
      ...base,
      externalApprovers: [{ legacyDepartmentApproverId: ids.external, userId: ids.mappedUser, targetUnitId: ids.department, disposition: 'PARENT_SCOPE', positionCode: 'DEPARTMENT_MANAGER' }],
    }), /assignment|PARENT_SCOPE/i)
    assert.doesNotThrow(() => parseReviewedOrganizationMapping({
      ...base,
      departments: [{ ...base.departments[0], targetUnitId: ids.department, disposition: 'LEGACY_MANAGER_CONTAINER' }],
      positionAssignments: [{ userId: ids.mappedUser, unitId: ids.department, positionCode: 'DEPARTMENT_MANAGER', reportingGroupId: null, isPrimary: true }],
      externalApprovers: [{ legacyDepartmentApproverId: ids.external, userId: ids.mappedUser, targetUnitId: ids.department, disposition: 'PARENT_SCOPE', positionCode: 'DEPARTMENT_MANAGER' }],
    }))
  })
})

describe('reviewed organization import report', () => {
  it('accepts department, division, and factory ancestor consolidation but rejects unrelated branches', () => {
    const mapping = parentScopeMapping([
      { id: ids.department, positionCode: 'DEPARTMENT_MANAGER', externalId: ids.external },
      { id: ids.division, positionCode: 'DIVISION_MANAGER', externalId: ids.external2 },
      { id: ids.factory, positionCode: 'FACTORY_MANAGER', externalId: ids.external3 },
    ])
    const report = buildOrganizationImportReport({
      mapping,
      ...inventory({ legacyUsers: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true }], legacyExternalApprovers: [
        { id: ids.external, approverId: ids.mappedUser, departmentId: ids.legacyDepartment, approverLevel: 1 },
        { id: ids.external2, approverId: ids.mappedUser, departmentId: ids.legacyDepartment, approverLevel: 1 },
        { id: ids.external3, approverId: ids.mappedUser, departmentId: ids.legacyDepartment, approverLevel: 1 },
      ] }),
    })
    assert.deepEqual(report.blockingReasons, [])

    const unrelated = parseReviewedOrganizationMapping({
      ...base,
      units: withScopeUnits(),
      positionAssignments: [...base.positionAssignments, { userId: ids.mappedUser, unitId: ids.otherDepartment, positionCode: 'DEPARTMENT_MANAGER', reportingGroupId: null, isPrimary: false }],
      externalApprovers: [{ legacyDepartmentApproverId: ids.external, userId: ids.mappedUser, targetUnitId: ids.otherDepartment, disposition: 'PARENT_SCOPE', positionCode: 'DEPARTMENT_MANAGER' }],
    })
    const unrelatedReport = buildOrganizationImportReport({ mapping: unrelated, ...inventory({ legacyUsers: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true }], legacyExternalApprovers: [{ id: ids.external, approverId: ids.mappedUser, departmentId: ids.legacyDepartment, approverLevel: 1 }] }) })
    assert.ok(unrelatedReport.blockingReasons.includes(`EXTERNAL_APPROVER_PARENT_SCOPE_MISMATCH:${ids.external}`))
  })

  it('reports missing levels 7–10 without compressing them and counts distinct mapped users', () => {
    const report = buildOrganizationImportReport({ mapping: parseReviewedOrganizationMapping({
      ...base,
      units: withScopeUnits(),
      positionAssignments: [base.positionAssignments[0], { userId: ids.mappedUser, unitId: ids.section2, positionCode: 'SUPERVISOR', reportingGroupId: null, isPrimary: false }],
    }), ...inventory() })
    assert.deepEqual(report.blockingReasons, [
      `USER_NOT_MAPPED:${ids.unmappedUser}`,
      `USER_LEVEL_NOT_EXPLICITLY_MAPPED:${ids.unmappedUser}:7`,
    ])
    assert.equal(report.mappedUserCount, 1)
    assert.equal(report.wouldCreateAssignments, 2)
  })

  it('requires acknowledgements for inactive levels 7–10, while null is acknowledged and inactive needs no assignment', () => {
    const inactiveUsers = [7, 8, 9, 10].map((level, index) => ({ id: [ids.inactiveUser, ids.secondUser, ids.unknownUser, ids.external4][index], departmentId: ids.legacyDepartment, level, isActive: false }))
    const missing = buildOrganizationImportReport({ mapping: parseReviewedOrganizationMapping(base), ...inventory({ legacyUsers: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true }, ...inactiveUsers] }) })
    assert.deepEqual(missing.blockingReasons, inactiveUsers.map((user) => `USER_LEVEL_NOT_EXPLICITLY_MAPPED:${user.id}:${user.level}`))
    const acknowledged = buildOrganizationImportReport({ mapping: parseReviewedOrganizationMapping({ ...base, legacyLevelMappings: [1, 7, 8, 9, 10].map((legacyLevel) => ({ legacyLevel, positionCode: null })) }), ...inventory({ legacyUsers: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: null, isActive: true }, ...inactiveUsers.map((user) => ({ ...user, level: null }))] }) })
    assert.deepEqual(acknowledged.blockingReasons, [])
  })

  it('does not treat null level acknowledgement as disabling an explicitly assigned active user', () => {
    const mapping = parseReviewedOrganizationMapping({ ...base, legacyLevelMappings: [{ legacyLevel: 1, positionCode: null }] })
    const report = buildOrganizationImportReport({ mapping, ...inventory({ legacyUsers: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true }] }) })
    assert.deepEqual(report.blockingReasons, [])
  })

  it('blocks unknown mapping identity, classification, external identity, and incorrect parent scope', () => {
    const mapping = parseReviewedOrganizationMapping({
      ...base,
      positionAssignments: [
        base.positionAssignments[0],
        { userId: ids.unknownUser, unitId: ids.section, positionCode: 'STAFF', reportingGroupId: null, isPrimary: true },
        { userId: ids.unmappedUser, unitId: ids.section, positionCode: 'SECTION_MANAGER', reportingGroupId: null, isPrimary: true },
      ],
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
    assert.ok(report.blockingReasons.includes(`USER_MAPPING_NOT_FOUND:${ids.unknownUser}`))
  })

  it('permits different explicit person positions at the same numeric level', () => {
    const mapping = parseReviewedOrganizationMapping({
      ...base,
      positionAssignments: [base.positionAssignments[0], { userId: ids.secondUser, unitId: ids.section, positionCode: 'SUPERVISOR', reportingGroupId: null, isPrimary: true }],
    })
    const report = buildOrganizationImportReport({ mapping, ...inventory({ legacyUsers: [
      { id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true },
      { id: ids.secondUser, departmentId: ids.legacyDepartment, level: 1, isActive: true },
    ] }) })
    assert.deepEqual(report.blockingReasons, [])
    assert.equal(report.mappedUserCount, 2)
  })

  it('preserves CUSTOM_ONLY without imposing parent-manager assignment consolidation', () => {
    const mapping = parseReviewedOrganizationMapping({
      ...base,
      externalApprovers: [{ legacyDepartmentApproverId: ids.external, userId: ids.inactiveUser, targetUnitId: ids.section, disposition: 'CUSTOM_ONLY', positionCode: 'STAFF' }],
    })
    const report = buildOrganizationImportReport({ mapping, ...inventory({ legacyUsers: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true }, { id: ids.inactiveUser, departmentId: ids.legacyDepartment, level: 1, isActive: false }], legacyExternalApprovers: [{ id: ids.external, approverId: ids.inactiveUser, departmentId: ids.legacyDepartment, approverLevel: 1 }] }) })
    assert.deepEqual(report.blockingReasons, [])
  })

  it('produces a zero-blocker report with exact creation counts for a fully reviewed inventory', () => {
    const report = buildOrganizationImportReport({ mapping: parseReviewedOrganizationMapping(base), ...inventory({ legacyUsers: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true }] }) })
    assert.deepEqual(report.blockingReasons, [])
    assert.deepEqual({ mappedDepartmentCount: report.mappedDepartmentCount, mappedUserCount: report.mappedUserCount, wouldCreateUnits: report.wouldCreateUnits, wouldCreateAssignments: report.wouldCreateAssignments }, { mappedDepartmentCount: 1, mappedUserCount: 1, wouldCreateUnits: 4, wouldCreateAssignments: 1 })
  })
})

describe('organization import dry-run CLI', () => {
  it('injects exact mapping/read/write/print seams and exits 2 for blockers', async () => {
    const writes: Array<{ path: string; report: unknown }> = []
    const reads: string[] = []
    const prints: string[] = []
    const repository = { readLegacyRows: async () => inventory() }
    const code = await runOrganizationImportDryRun({
      argv: ['--mapping', 'reviewed.json', '--out', 'report.json'],
      repository,
      readMapping: async (path) => { reads.push(path); return JSON.stringify(base) },
      writeReport: async (path, report) => { writes.push({ path, report }) },
      print: (line) => prints.push(line),
    })
    assert.equal(code, 2)
    assert.deepEqual(reads, ['reviewed.json'])
    assert.equal(writes.length, 1)
    assert.equal(writes[0]?.path, 'report.json')
    assert.deepEqual((writes[0]?.report as { blockingReasons: string[] }).blockingReasons, [`USER_NOT_MAPPED:${ids.unmappedUser}`, `USER_LEVEL_NOT_EXPLICITLY_MAPPED:${ids.unmappedUser}:7`])
    assert.ok(prints.some((line) => line.includes(`USER_NOT_MAPPED:${ids.unmappedUser}`)))
  })

  it('returns zero and writes a clean report for a successful injected run', async () => {
    const writes: Array<{ path: string; report: unknown }> = []
    const prints: string[] = []
    const code = await runOrganizationImportDryRun({
      argv: ['--mapping', 'reviewed.json', '--out', 'clean-report.json'],
      repository: { readLegacyRows: async () => inventory({ legacyUsers: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true }] }) },
      readMapping: async () => JSON.stringify(base),
      writeReport: async (path, report) => { writes.push({ path, report }) },
      print: (line) => prints.push(line),
    })
    assert.equal(code, 0)
    assert.equal(writes.length, 1)
    assert.deepEqual((writes[0]?.report as { blockingReasons: string[] }).blockingReasons, [])
    assert.ok(prints.some((line) => /no blockers/i.test(line)))
  })

  it('rejects missing required arguments before repository or file effects', async () => {
    let effects = 0
    await assert.rejects(runOrganizationImportDryRun({
      argv: [],
      repository: { readLegacyRows: async () => { effects += 1; return inventory() } },
      readMapping: async () => { effects += 1; return JSON.stringify(base) },
      writeReport: async () => { effects += 1 },
    }), /Usage|mapping|out/i)
    assert.equal(effects, 0)
  })
})
