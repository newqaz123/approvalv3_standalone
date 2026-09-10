import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseReviewedOrganizationMapping } from '../../tools/organization-mapping-schema'
import {
  applyReviewedOrganizationMapping,
  computeReviewedOrganizationMappingDigest,
} from '@/lib/organization/mapping'
import { ApprovalCreationDisabledError, assertNewCreationEnabled } from '@/lib/approval-engine/phase-adapters'
import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/validation'
import {
  runApplyReviewedOrganizationMapping,
} from '../../scripts/apply-reviewed-organization-mapping'
import {
  createHarness,
  departmentRows,
  workflowUsers,
} from '../fixtures/organization-approval-harness'

const ids = {
  factory: '10000000-0000-4000-8000-000000000001',
  division: '10000000-0000-4000-8000-000000000008',
  department: '10000000-0000-4000-8000-000000000009',
  section: '10000000-0000-4000-8000-000000000003',
  legacyDepartment: '10000000-0000-4000-8000-000000000002',
  mappedUser: '10000000-0000-4000-8000-000000000004',
  managerUser: '10000000-0000-4000-8000-000000000005',
  group: '10000000-0000-4000-8000-000000000018',
  request: '20000000-0000-4000-8000-000000000001',
  approval: '20000000-0000-4000-8000-000000000002',
  otherUnit: '30000000-0000-4000-8000-000000000001',
}

const staffMappingInput = {
  units: [
    { id: ids.factory, name: 'Factory', unitType: 'FACTORY', parentId: null },
    { id: ids.division, name: 'Division', unitType: 'DIVISION', parentId: ids.factory },
    { id: ids.department, name: 'Department', unitType: 'DEPARTMENT', parentId: ids.division },
    { id: ids.section, name: 'PD1', unitType: 'SECTION', parentId: ids.department },
  ],
  departments: [{
    legacyDepartmentId: ids.legacyDepartment,
    targetUnitId: ids.section,
    engineeringClassification: 'GENERAL',
    disposition: 'REAL_SECTION',
  }],
  positionAssignments: [{
    userId: ids.mappedUser,
    unitId: ids.section,
    positionCode: 'STAFF',
    reportingGroupId: null,
    isPrimary: true,
  }],
  reportingGroups: [],
  externalApprovers: [],
  legacyLevelMappings: [{ legacyLevel: 1, positionCode: 'STAFF' }],
} as const

function staffMapping() {
  return parseReviewedOrganizationMapping(staffMappingInput)
}

function parentManagerMapping() {
  return parseReviewedOrganizationMapping({
    ...staffMappingInput,
    units: [
      { id: ids.factory, name: 'Factory', unitType: 'FACTORY', parentId: null },
      { id: ids.division, name: 'Division', unitType: 'DIVISION', parentId: ids.factory },
      { id: ids.department, name: 'Department', unitType: 'DEPARTMENT', parentId: ids.division },
    ],
    departments: [{
      legacyDepartmentId: ids.legacyDepartment,
      targetUnitId: ids.department,
      engineeringClassification: 'GENERAL',
      disposition: 'LEGACY_MANAGER_CONTAINER',
    }],
    positionAssignments: [{
      userId: ids.managerUser,
      unitId: ids.department,
      positionCode: 'DEPARTMENT_MANAGER',
      reportingGroupId: null,
      isPrimary: true,
    }],
  })
}

interface FakeMappingState {
  users: Array<{ id: string; departmentId: string | null; level: number | null; isActive: boolean }>
  departments: Array<{ id: string; name: string; type: 'GENERAL' | 'ENGINEERING' }>
  departmentApprovers: Array<{ id: string; approverId: string; departmentId: string; approverLevel: number }>
  units: Array<{ id: string; name: string; unitType: string; parentId: string | null; legacyDepartmentId: string | null; isActive: boolean; operationalType: string }>
  assignments: Array<{ id: string; userId: string; unitId: string; positionCode: string; reportingGroupId: string | null; isPrimary: boolean; isActive: boolean }>
  groups: Array<{ id: string; unitId: string; parentGroupId: string | null; name: string; isActive: boolean }>
  members: Array<{ reportingGroupId: string; userId: string }>
  requests: Array<{ id: string; departmentId: string | null; organizationUnitId: string | null; requesterId: string }>
  approvals: Array<{ id: string; requestId: string; requiredLevel: number | null; status: string; routingMode: string; approverId: string | null }>
  importRuns: Array<{ id: string; mappingDigest: string; appliedAt: Date; appliedBy: string; targetIdentity: string; counts: unknown }>
  routeVersions: Array<{ id: string; scopeUnitId: string; phase: string; version: number; maximumPositionLevel: number; status: string }>
  routeSteps: Array<{ routeVersionId: string; stepOrder: number; positionCode: string }>
}

function cloneState(state: FakeMappingState): FakeMappingState {
  return structuredClone(state)
}

function createFakeMappingTx(seed: Partial<FakeMappingState> = {}) {
  const state: FakeMappingState = {
    users: seed.users ?? [
      { id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true },
      { id: ids.managerUser, departmentId: ids.legacyDepartment, level: 4, isActive: true },
    ],
    departments: seed.departments ?? [{ id: ids.legacyDepartment, name: 'PD1', type: 'GENERAL' }],
    departmentApprovers: seed.departmentApprovers ?? [],
    units: seed.units ?? [],
    assignments: seed.assignments ?? [],
    groups: seed.groups ?? [],
    members: seed.members ?? [],
    requests: seed.requests ?? [{
      id: ids.request,
      departmentId: ids.legacyDepartment,
      organizationUnitId: null,
      requesterId: ids.mappedUser,
    }],
    approvals: seed.approvals ?? [{
      id: ids.approval,
      requestId: ids.request,
      requiredLevel: 2,
      status: 'pending',
      routingMode: 'LEGACY_LEVEL',
      approverId: null,
    }],
    importRuns: seed.importRuns ?? [],
    routeVersions: seed.routeVersions ?? [],
    routeSteps: seed.routeSteps ?? [],
  }
  let assignmentSeq = 0
  const writeCounts = { units: 0, assignments: 0, groups: 0, members: 0, requests: 0, users: 0, approvals: 0, importRuns: 0, locks: 0 }

  const matchIn = (value: unknown, clause: unknown): boolean => {
    if (clause && typeof clause === 'object' && 'in' in (clause as object)) {
      return ((clause as { in: unknown[] }).in ?? []).includes(value)
    }
    return value === clause
  }

  const tx = {
    state,
    writeCounts,
    snapshot: () => cloneState(state),
    restore(snapshot: FakeMappingState) {
      const next = cloneState(snapshot)
      state.users = next.users
      state.departments = next.departments
      state.departmentApprovers = next.departmentApprovers
      state.units = next.units
      state.assignments = next.assignments
      state.groups = next.groups
      state.members = next.members
      state.requests = next.requests
      state.approvals = next.approvals
      state.importRuns = next.importRuns
      state.routeVersions = next.routeVersions
      state.routeSteps = next.routeSteps
    },
    $executeRaw: async () => {
      writeCounts.locks += 1
      return 1
    },
    $executeRawUnsafe: async () => {
      writeCounts.locks += 1
      return 1
    },
    user: {
      findMany: async (args?: { where?: { id?: { in: string[] } }; select?: unknown }) => {
        const idsFilter = args?.where?.id?.in
        return state.users.filter((row) => !idsFilter || idsFilter.includes(row.id)).map((row) => ({ ...row }))
      },
      findUnique: async (args: { where: { id: string } }) => {
        const row = state.users.find((user) => user.id === args.where.id)
        return row ? { ...row } : null
      },
      update: async () => {
        writeCounts.users += 1
        throw new Error('importer must not mutate legacy user fields')
      },
    },
    departments: {
      findMany: async () => state.departments.map((row) => ({ ...row })),
    },
    department_approvers: {
      findMany: async () => state.departmentApprovers.map((row) => ({ ...row })),
    },
    organization_units: {
      findMany: async () => state.units.map((row) => ({ ...row })),
      findUnique: async (args: { where: { id?: string; legacyDepartmentId?: string } }) => {
        const row = state.units.find((unit) =>
          (args.where.id !== undefined && unit.id === args.where.id)
          || (args.where.legacyDepartmentId !== undefined && unit.legacyDepartmentId === args.where.legacyDepartmentId),
        )
        return row ? { ...row } : null
      },
      create: async (args: { data: FakeMappingState['units'][number] }) => {
        writeCounts.units += 1
        const row = { ...args.data }
        state.units.push(row)
        return { ...row }
      },
      update: async (args: { where: { id: string }; data: Partial<FakeMappingState['units'][number]> }) => {
        writeCounts.units += 1
        const row = state.units.find((unit) => unit.id === args.where.id)
        if (!row) throw new Error(`missing unit ${args.where.id}`)
        Object.assign(row, args.data)
        return { ...row }
      },
    },
    organization_position_assignments: {
      findMany: async (args?: { where?: Record<string, unknown> }) => {
        return state.assignments.filter((row) => {
          const where = args?.where ?? {}
          return Object.entries(where).every(([key, value]) => matchIn((row as Record<string, unknown>)[key], value))
        }).map((row) => ({ ...row }))
      },
      findUnique: async (args: { where: { userId_unitId_positionCode?: { userId: string; unitId: string; positionCode: string }; id?: string } }) => {
        const key = args.where.userId_unitId_positionCode
        const row = key
          ? state.assignments.find((assignment) =>
            assignment.userId === key.userId && assignment.unitId === key.unitId && assignment.positionCode === key.positionCode,
          )
          : state.assignments.find((assignment) => assignment.id === args.where.id)
        return row ? { ...row } : null
      },
      create: async (args: { data: Omit<FakeMappingState['assignments'][number], 'id'> & { id?: string } }) => {
        writeCounts.assignments += 1
        const row = { ...args.data, isActive: args.data.isActive ?? true, id: args.data.id ?? `assignment-${++assignmentSeq}` }
        state.assignments.push(row)
        return { ...row }
      },
      update: async (args: { where: { id: string }; data: Partial<FakeMappingState['assignments'][number]> }) => {
        writeCounts.assignments += 1
        const row = state.assignments.find((assignment) => assignment.id === args.where.id)
        if (!row) throw new Error(`missing assignment ${args.where.id}`)
        Object.assign(row, args.data)
        return { ...row }
      },
    },
    reporting_groups: {
      findMany: async () => state.groups.map((row) => ({ ...row })),
      findUnique: async (args: { where: { id: string } }) => {
        const row = state.groups.find((group) => group.id === args.where.id)
        return row ? { ...row } : null
      },
      create: async (args: { data: FakeMappingState['groups'][number] }) => {
        writeCounts.groups += 1
        const row = { ...args.data }
        state.groups.push(row)
        return { ...row }
      },
      update: async (args: { where: { id: string }; data: Partial<FakeMappingState['groups'][number]> }) => {
        writeCounts.groups += 1
        const row = state.groups.find((group) => group.id === args.where.id)
        if (!row) throw new Error(`missing group ${args.where.id}`)
        Object.assign(row, args.data)
        return { ...row }
      },
    },
    reporting_group_members: {
      findMany: async () => state.members.map((row) => ({ ...row })),
      findUnique: async (args: { where: { reportingGroupId_userId: { reportingGroupId: string; userId: string } } }) => {
        const key = args.where.reportingGroupId_userId
        const row = state.members.find((member) => member.reportingGroupId === key.reportingGroupId && member.userId === key.userId)
        return row ? { ...row } : null
      },
      create: async (args: { data: FakeMappingState['members'][number] }) => {
        writeCounts.members += 1
        state.members.push({ ...args.data })
        return { ...args.data }
      },
    },
    requests: {
      findMany: async (args?: { where?: { departmentId?: { in: string[] }; id?: string } }) => {
        return state.requests.filter((row) => {
          if (args?.where?.id) return row.id === args.where.id
          if (args?.where?.departmentId?.in) return row.departmentId !== null && args.where.departmentId.in.includes(row.departmentId)
          return true
        }).map((row) => ({ ...row }))
      },
      findUnique: async (args: { where: { id: string }; select?: unknown }) => {
        const row = state.requests.find((request) => request.id === args.where.id)
        return row ? { ...row } : null
      },
      update: async (args: { where: { id: string }; data: Partial<FakeMappingState['requests'][number]> }) => {
        writeCounts.requests += 1
        const row = state.requests.find((request) => request.id === args.where.id)
        if (!row) throw new Error(`missing request ${args.where.id}`)
        Object.assign(row, args.data)
        return { ...row }
      },
      updateMany: async (args: { where: { id?: string; departmentId?: string | { in: string[] }; organizationUnitId?: null }; data: Partial<FakeMappingState['requests'][number]> }) => {
        let count = 0
        for (const row of state.requests) {
          if (args.where.id && row.id !== args.where.id) continue
          if (typeof args.where.departmentId === 'string' && row.departmentId !== args.where.departmentId) continue
          if (args.where.departmentId && typeof args.where.departmentId === 'object' && row.departmentId && !args.where.departmentId.in.includes(row.departmentId)) continue
          if (args.where.organizationUnitId === null && row.organizationUnitId !== null) continue
          Object.assign(row, args.data)
          count += 1
          writeCounts.requests += 1
        }
        return { count }
      },
    },
    request_approvals: {
      findMany: async () => state.approvals.map((row) => ({ ...row })),
      update: async () => {
        writeCounts.approvals += 1
        throw new Error('importer must not mutate legacy approval rows')
      },
      updateMany: async () => {
        writeCounts.approvals += 1
        throw new Error('importer must not mutate legacy approval rows')
      },
    },
    organization_import_runs: {
      findUnique: async (args: { where: { mappingDigest: string } }) => {
        const row = state.importRuns.find((run) => run.mappingDigest === args.where.mappingDigest)
        return row ? { ...row } : null
      },
      findFirst: async (args?: { where?: { targetIdentity?: string } }) => {
        const row = state.importRuns.find((run) => !args?.where?.targetIdentity || run.targetIdentity === args.where.targetIdentity)
        return row ? { ...row } : null
      },
      create: async (args: { data: Omit<FakeMappingState['importRuns'][number], 'id' | 'appliedAt'> & { id?: string; appliedAt?: Date } }) => {
        writeCounts.importRuns += 1
        const row = {
          id: args.data.id ?? `import-${state.importRuns.length + 1}`,
          appliedAt: args.data.appliedAt ?? new Date(),
          ...args.data,
        }
        state.importRuns.push(row)
        return { ...row }
      },
    },
    approval_route_versions: {
      findMany: async (args?: { where?: { scopeUnitId?: { in: string[] }; phase?: string } }) => {
        return state.routeVersions.filter((row) => {
          if (args?.where?.phase && row.phase !== args.where.phase) return false
          if (args?.where?.scopeUnitId?.in && !args.where.scopeUnitId.in.includes(row.scopeUnitId)) return false
          return true
        }).map((row) => ({ ...row }))
      },
    },
    approval_route_steps: {
      findMany: async (args?: { where?: { routeVersionId?: { in: string[] } }; orderBy?: unknown }) => {
        return state.routeSteps.filter((row) => {
          if (args?.where?.routeVersionId?.in && !args.where.routeVersionId.in.includes(row.routeVersionId)) return false
          return true
        }).map((row) => ({ ...row }))
      },
    },
  }
  return tx
}

async function applyInTransaction(
  tx: ReturnType<typeof createFakeMappingTx>,
  mapping: ReturnType<typeof staffMapping>,
  options: { appliedBy: string; targetIdentity: string; expectedDigest: string },
) {
  const snapshot = tx.snapshot()
  try {
    return await applyReviewedOrganizationMapping(tx as never, mapping, options)
  } catch (error) {
    tx.restore(snapshot)
    throw error
  }
}

describe('reviewed organization mapping apply', () => {
  it('dry-run CLI writes nothing', async () => {
    const mapping = staffMapping()
    const digest = computeReviewedOrganizationMappingDigest(mapping)
    let writeTxs = 0
    const prints: string[] = []
    const code = await runApplyReviewedOrganizationMapping({
      argv: ['--mapping', 'reviewed.json', '--digest', digest, '--target-identity', 'ci-copy', '--applied-by', 'operator'],
      readMapping: async () => mapping,
      readInventory: async () => ({
        legacyDepartments: [{ id: ids.legacyDepartment, name: 'PD1', type: 'GENERAL' }],
        legacyUsers: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true }],
        legacyExternalApprovers: [],
      }),
      createWriteTx: async () => {
        writeTxs += 1
        throw new Error('dry-run must not open a write transaction')
      },
      print: (line) => prints.push(line),
    })
    assert.equal(code, 0)
    assert.equal(writeTxs, 0)
    assert.ok(prints.some((line) => /dry-run/i.test(line)))
  })

  it('replays the same digest idempotently', async () => {
    const mapping = staffMapping()
    const digest = computeReviewedOrganizationMappingDigest(mapping)
    const tx = createFakeMappingTx()
    const first = await applyInTransaction(tx, mapping, { appliedBy: 'op', targetIdentity: 'ci-copy', expectedDigest: digest })
    const unitsAfterFirst = tx.state.units.length
    const assignmentsAfterFirst = tx.state.assignments.length
    const runsAfterFirst = tx.state.importRuns.length
    const second = await applyInTransaction(tx, mapping, { appliedBy: 'op', targetIdentity: 'ci-copy', expectedDigest: digest })
    assert.equal(second.mappedUserCount, first.mappedUserCount)
    assert.equal(tx.state.units.length, unitsAfterFirst)
    assert.equal(tx.state.assignments.length, assignmentsAfterFirst)
    assert.equal(tx.state.importRuns.length, runsAfterFirst)
    assert.equal(tx.state.importRuns[0]?.mappingDigest, digest)
  })

  it('rejects a stale digest instead of applying a changed mapping under the old digest', async () => {
    const mapping = staffMapping()
    const tx = createFakeMappingTx()
    await assert.rejects(
      () => applyInTransaction(tx, mapping, {
        appliedBy: 'op',
        targetIdentity: 'ci-copy',
        expectedDigest: 'stale-digest',
      }),
      /stale|digest/i,
    )
    assert.equal(tx.state.units.length, 0)
    assert.equal(tx.state.importRuns.length, 0)
  })

  it('rejects conflicting existing IDs rather than overwriting unrelated assignments', async () => {
    const mapping = staffMapping()
    const digest = computeReviewedOrganizationMappingDigest(mapping)
    const tx = createFakeMappingTx({
      units: [{
        id: ids.section,
        name: 'Unrelated section',
        unitType: 'SECTION',
        parentId: ids.otherUnit,
        legacyDepartmentId: null,
        isActive: true,
        operationalType: 'GENERAL',
      }],
      assignments: [{
        id: 'existing-primary',
        userId: ids.mappedUser,
        unitId: ids.otherUnit,
        positionCode: 'STAFF',
        reportingGroupId: null,
        isPrimary: true,
        isActive: true,
      }],
    })
    const approvalsBefore = structuredClone(tx.state.approvals)
    await assert.rejects(
      () => applyInTransaction(tx, mapping, { appliedBy: 'op', targetIdentity: 'ci-copy', expectedDigest: digest }),
      /conflict/i,
    )
    assert.deepEqual(tx.state.approvals, approvalsBefore)
    assert.equal(tx.state.assignments[0]?.unitId, ids.otherUnit)
    assert.equal(tx.state.units[0]?.name, 'Unrelated section')
  })

  it('backfills historical request origins from the legacy department mapping', async () => {
    const mapping = staffMapping()
    const digest = computeReviewedOrganizationMappingDigest(mapping)
    const tx = createFakeMappingTx()
    await applyInTransaction(tx, mapping, { appliedBy: 'op', targetIdentity: 'ci-copy', expectedDigest: digest })
    assert.equal(tx.state.requests[0]?.organizationUnitId, ids.section)
    assert.equal(tx.state.requests[0]?.departmentId, ids.legacyDepartment)
    assert.equal(tx.state.approvals[0]?.requiredLevel, 2)
    assert.equal(tx.state.approvals[0]?.routingMode, 'LEGACY_LEVEL')
    assert.equal(tx.state.users[0]?.departmentId, ids.legacyDepartment)
    assert.equal(tx.state.users[0]?.level, 1)
  })

  it('assigns a parent-only manager without inventing a section or clearing legacy fields', async () => {
    const mapping = parentManagerMapping()
    const digest = computeReviewedOrganizationMappingDigest(mapping)
    const tx = createFakeMappingTx()
    await applyInTransaction(tx, mapping, { appliedBy: 'op', targetIdentity: 'ci-copy', expectedDigest: digest })
    assert.equal(tx.state.assignments.length, 1)
    assert.equal(tx.state.assignments[0]?.unitId, ids.department)
    assert.equal(tx.state.assignments[0]?.positionCode, 'DEPARTMENT_MANAGER')
    assert.equal(tx.state.units.some((unit) => unit.unitType === 'SECTION' && unit.legacyDepartmentId === ids.legacyDepartment), false)
    const manager = tx.state.users.find((user) => user.id === ids.managerUser)
    assert.equal(manager?.departmentId, ids.legacyDepartment)
    assert.equal(manager?.level, 4)
    assert.equal(tx.state.requests[0]?.organizationUnitId, ids.department)
  })

  it('rolls back a failed apply and preserves old approvals', async () => {
    const mapping = staffMapping()
    const digest = computeReviewedOrganizationMappingDigest(mapping)
    const tx = createFakeMappingTx({
      units: [{
        id: ids.factory,
        name: 'Different factory',
        unitType: 'FACTORY',
        parentId: null,
        legacyDepartmentId: null,
        isActive: true,
        operationalType: 'GENERAL',
      }],
      approvals: [{
        id: ids.approval,
        requestId: ids.request,
        requiredLevel: 5,
        status: 'pending',
        routingMode: 'LEGACY_LEVEL',
        approverId: 'historical-actor-1',
      }],
    })
    const approvalsBefore = structuredClone(tx.state.approvals)
    await assert.rejects(
      () => applyInTransaction(tx, mapping, { appliedBy: 'op', targetIdentity: 'ci-copy', expectedDigest: digest }),
      /conflict/i,
    )
    assert.deepEqual(tx.state.approvals, approvalsBefore)
    assert.equal(tx.state.approvals[0]?.requiredLevel, 5)
    assert.equal(tx.state.importRuns.length, 0)
    assert.equal(tx.state.units.length, 1)
  })
})

describe('apply CLI help', () => {
  it('exits --help before constructing a database client', async () => {
    let constructed = 0
    const prints: string[] = []
    const code = await runApplyReviewedOrganizationMapping({
      argv: ['--help'],
      createWriteTx: async () => {
        constructed += 1
        throw new Error('database client must not be constructed for --help')
      },
      print: (line) => prints.push(line),
    })
    assert.equal(code, 0)
    assert.equal(constructed, 0)
    assert.ok(prints.some((line) => /usage|--apply/i.test(line)))
  })
})

describe('assertNewCreationEnabled', () => {
  const originalEnv = { ...process.env }

  function restoreEnv() {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
  }

  const gateInput = {
    phase: 'REQUEST' as const,
    originUserId: ids.mappedUser,
    requestId: ids.request,
  }

  it('denies NEW creation when the mapping digest is missing', async () => {
    process.env.APPROVAL_ROUTING_MODE = 'new'
    delete process.env.APPROVAL_ORG_MAPPING_DIGEST
    try {
      await assert.rejects(
        () => assertNewCreationEnabled(createFakeMappingTx() as never, gateInput),
        (error: unknown) => {
          assert.ok(error instanceof ApprovalCreationDisabledError)
          assert.match(error.message, /not enabled|APPROVAL_ROUTING_MODE/i)
          return true
        },
      )
    } finally {
      restoreEnv()
    }
  })

  it('denies when rollout mode is not new even if a matching digest exists', async () => {
    const mapping = staffMapping()
    const digest = computeReviewedOrganizationMappingDigest(mapping)
    process.env.APPROVAL_ROUTING_MODE = 'legacy'
    process.env.APPROVAL_ORG_MAPPING_DIGEST = digest
    const tx = createFakeMappingTx({
      importRuns: [{
        id: 'run-1',
        mappingDigest: digest,
        appliedAt: new Date(),
        appliedBy: 'op',
        targetIdentity: 'ci-copy',
        counts: {},
      }],
    })
    try {
      await assert.rejects(
        () => assertNewCreationEnabled(tx as never, gateInput),
        (error: unknown) => {
          assert.ok(error instanceof ApprovalCreationDisabledError)
          assert.match(error.message, /not enabled|APPROVAL_ROUTING_MODE/i)
          return true
        },
      )
    } finally {
      restoreEnv()
    }
  })

  it('treats a stale digest as a configuration error, not an empty route', async () => {
    process.env.APPROVAL_ROUTING_MODE = 'new'
    process.env.APPROVAL_ORG_MAPPING_DIGEST = 'stale-digest'
    try {
      await assert.rejects(
        () => assertNewCreationEnabled(createFakeMappingTx() as never, {
          phase: 'REQUEST',
          originUserId: ids.mappedUser,
          requestId: ids.request,
        }),
        (error: unknown) => {
          assert.ok(error instanceof ApprovalRouteConfigurationError)
          assert.match(error.message, /stale|corrupt|digest/i)
          return true
        },
      )
    } finally {
      restoreEnv()
    }
  })

  it('treats a missing primary assignment as a configuration error', async () => {
    const mapping = staffMapping()
    const digest = computeReviewedOrganizationMappingDigest(mapping)
    process.env.APPROVAL_ROUTING_MODE = 'new'
    process.env.APPROVAL_ORG_MAPPING_DIGEST = digest
    const tx = createFakeMappingTx({
      importRuns: [{
        id: 'run-1',
        mappingDigest: digest,
        appliedAt: new Date(),
        appliedBy: 'op',
        targetIdentity: 'ci-copy',
        counts: {},
      }],
      users: [{ id: ids.mappedUser, departmentId: ids.legacyDepartment, level: 1, isActive: true }],
    })
    try {
      await assert.rejects(
        () => assertNewCreationEnabled(tx as never, {
          phase: 'REQUEST',
          originUserId: ids.mappedUser,
          requestId: ids.request,
        }),
        (error: unknown) => {
          assert.ok(error instanceof ApprovalRouteConfigurationError)
          assert.match(error.message, /primary|configuration|branch/i)
          return true
        },
      )
    } finally {
      restoreEnv()
    }
  })

  it('treats a missing published route as a configuration error, not a vacant route', async () => {
    const mapping = staffMapping()
    const digest = computeReviewedOrganizationMappingDigest(mapping)
    process.env.APPROVAL_ROUTING_MODE = 'new'
    process.env.APPROVAL_ORG_MAPPING_DIGEST = digest
    const tx = createFakeMappingTx({
      importRuns: [{
        id: 'run-1',
        mappingDigest: digest,
        appliedAt: new Date(),
        appliedBy: 'op',
        targetIdentity: 'ci-copy',
        counts: {},
      }],
      units: [
        { id: ids.factory, name: 'Factory', unitType: 'FACTORY', parentId: null, legacyDepartmentId: null, isActive: true, operationalType: 'GENERAL' },
        { id: ids.division, name: 'Division', unitType: 'DIVISION', parentId: ids.factory, legacyDepartmentId: null, isActive: true, operationalType: 'GENERAL' },
        { id: ids.department, name: 'Department', unitType: 'DEPARTMENT', parentId: ids.division, legacyDepartmentId: null, isActive: true, operationalType: 'GENERAL' },
        { id: ids.section, name: 'PD1', unitType: 'SECTION', parentId: ids.department, legacyDepartmentId: ids.legacyDepartment, isActive: true, operationalType: 'GENERAL' },
      ],
      assignments: [{
        id: 'a-primary',
        userId: ids.mappedUser,
        unitId: ids.section,
        positionCode: 'STAFF',
        reportingGroupId: null,
        isPrimary: true,
        isActive: true,
      }],
    })
    try {
      await assert.rejects(
        () => assertNewCreationEnabled(tx as never, {
          phase: 'REQUEST',
          originUserId: ids.mappedUser,
          requestId: ids.request,
        }),
        (error: unknown) => {
          assert.ok(error instanceof ApprovalRouteConfigurationError)
          assert.match(error.message, /published route|configuration/i)
          assert.doesNotMatch(error.message, /vacant|empty/i)
          return true
        },
      )
    } finally {
      restoreEnv()
    }
  })

  it('allows NEW creation when mode, digest, primary assignment, and published route match', async () => {
    const mapping = staffMapping()
    const digest = computeReviewedOrganizationMappingDigest(mapping)
    process.env.APPROVAL_ROUTING_MODE = 'new'
    process.env.APPROVAL_ORG_MAPPING_DIGEST = digest
    const tx = createFakeMappingTx({
      importRuns: [{
        id: 'run-1',
        mappingDigest: digest,
        appliedAt: new Date(),
        appliedBy: 'op',
        targetIdentity: 'ci-copy',
        counts: {},
      }],
      units: [
        { id: ids.factory, name: 'Factory', unitType: 'FACTORY', parentId: null, legacyDepartmentId: null, isActive: true, operationalType: 'GENERAL' },
        { id: ids.division, name: 'Division', unitType: 'DIVISION', parentId: ids.factory, legacyDepartmentId: null, isActive: true, operationalType: 'GENERAL' },
        { id: ids.department, name: 'Department', unitType: 'DEPARTMENT', parentId: ids.division, legacyDepartmentId: null, isActive: true, operationalType: 'GENERAL' },
        { id: ids.section, name: 'PD1', unitType: 'SECTION', parentId: ids.department, legacyDepartmentId: ids.legacyDepartment, isActive: true, operationalType: 'GENERAL' },
      ],
      assignments: [{
        id: 'a-primary',
        userId: ids.mappedUser,
        unitId: ids.section,
        positionCode: 'STAFF',
        reportingGroupId: null,
        isPrimary: true,
        isActive: true,
      }],
      routeVersions: [{
        id: 'route-1',
        scopeUnitId: ids.section,
        phase: 'REQUEST',
        version: 1,
        maximumPositionLevel: 4,
        status: 'PUBLISHED',
      }],
      routeSteps: [{
        routeVersionId: 'route-1',
        stepOrder: 1,
        positionCode: 'SUPERVISOR',
      }],
    })
    try {
      await assertNewCreationEnabled(tx as never, gateInput)
    } finally {
      restoreEnv()
    }
  })
})

const parentCreateInput = {
  title: 'Parent-owned request',
  description: '<p>Parent unit</p>',
  inlineImageSessionId: '00000000-0000-4000-8000-000000000097',
  stagedAttachmentIds: [] as string[],
}

function parentManagerUser(id: string, name: string) {
  return {
    id,
    departmentId: null,
    level: null,
    isActive: true,
    role: 'general',
    name,
    email: `${id}@example.test`,
  }
}

describe('NEW-mode parent-unit request creation', () => {
  it('blocks Factory Manager and department-manager without a department in legacy mode', { skip: 'B6-A2: needs SNAPSHOT_GROUP/position-id harness seeds. Named replacement: tests/regression/clean-start-attempts.test.ts (origins/custom/gate) and B10 clean-start-policy/action-harness.' }, async () => {
    for (const id of ['factory-manager-1', 'department-manager-parent']) {
      const harness = createHarness({
        departments: departmentRows(),
        users: [...workflowUsers(), parentManagerUser(id, id)],
      })
      harness.state.currentUser = { ...parentManagerUser(id, id), department: null }
      harness.state.env.APPROVAL_ROUTING_MODE = 'legacy'
      const result = (await harness.requests.createRequest(parentCreateInput)) as { success: boolean; error?: string }
      assert.equal(result.success, false)
      assert.match(result.error ?? '', /department/i)
      assert.equal(harness.db.requests.rows.size, 0)
    }
  })

  it('does not require departmentId in NEW mode and surfaces configuration errors', { skip: 'B6-A2: needs SNAPSHOT_GROUP/position-id harness seeds. Named replacement: tests/regression/clean-start-attempts.test.ts (origins/custom/gate) and B10 clean-start-policy/action-harness.' }, async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: [...workflowUsers(), parentManagerUser('factory-manager-1', 'Factory Manager')],
    })
    harness.state.currentUser = { ...parentManagerUser('factory-manager-1', 'Factory Manager'), department: null }
    harness.state.env.APPROVAL_ROUTING_MODE = 'new'
    harness.state.env.APPROVAL_ORG_MAPPING_DIGEST = 'stale-digest'
    const result = (await harness.requests.createRequest(parentCreateInput)) as { success: boolean; error?: string }
    assert.equal(result.success, false)
    assert.match(result.error ?? '', /stale|corrupt|digest|not enabled|APPROVAL_ROUTING_MODE|primary|configuration/i)
    assert.doesNotMatch(result.error ?? '', /Failed to create request/i)
    assert.doesNotMatch(result.error ?? '', /must belong to a department/i)
    assert.equal(harness.db.requests.rows.size, 0)
  })

  it('persists organizationUnitId from a Factory Manager primary assignment without inventing a section', { skip: 'B6-A2: needs SNAPSHOT_GROUP/position-id harness seeds. Named replacement: tests/regression/clean-start-attempts.test.ts (origins/custom/gate) and B10 clean-start-policy/action-harness.' }, async () => {
    const digest = 'completed-mapping-digest'
    const harness = createHarness({
      departments: departmentRows(),
      users: [...workflowUsers(), parentManagerUser('factory-manager-1', 'Factory Manager')],
      organization_units: [
        { id: 'factory-1', name: 'Factory', unitType: 'FACTORY', parentId: null, isActive: true, operationalType: 'GENERAL' },
        { id: 'division-1', name: 'Division', unitType: 'DIVISION', parentId: 'factory-1', isActive: true, operationalType: 'GENERAL' },
        { id: 'department-1', name: 'Department', unitType: 'DEPARTMENT', parentId: 'division-1', isActive: true, operationalType: 'GENERAL' },
      ],
      organization_position_assignments: [{
        id: 'fm-primary',
        userId: 'factory-manager-1',
        unitId: 'factory-1',
        positionCode: 'FACTORY_MANAGER',
        reportingGroupId: null,
        isPrimary: true,
        isActive: true,
      }],
      approval_route_versions: [{
        id: 'route-factory-request',
        scopeUnitId: 'factory-1',
        phase: 'REQUEST',
        version: 1,
        maximumPositionLevel: 6,
        status: 'PUBLISHED',
        createdById: 'factory-manager-1',
      }],
      approval_route_steps: [{
        id: 'step-1',
        routeVersionId: 'route-factory-request',
        stepOrder: 1,
        positionCode: 'FACTORY_MANAGER',
      }],
      organization_import_runs: [{
        id: 'import-1',
        mappingDigest: digest,
        appliedAt: new Date(),
        appliedBy: 'op',
        targetIdentity: 'ci-copy',
        counts: { units: 3 },
      }],
    })
    harness.state.currentUser = { ...parentManagerUser('factory-manager-1', 'Factory Manager'), department: null }
    harness.state.env.APPROVAL_ROUTING_MODE = 'new'
    harness.state.env.APPROVAL_ORG_MAPPING_DIGEST = digest
    const result = (await harness.requests.createRequest(parentCreateInput)) as { success: boolean; requestId?: string; error?: string }
    assert.equal(result.success, true, result.error)
    const created = [...harness.db.requests.rows.values()][0]
    assert.equal(created?.departmentId, null)
    assert.equal(created?.organizationUnitId, 'factory-1')
    assert.equal([...harness.db.organization_units.rows.values()].some((unit) => unit.unitType === 'SECTION'), false)
  })
})
