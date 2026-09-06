import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROVAL_ENGINE_TRANSACTION_ISOLATION,
  ApprovalEngineConflictError,
  buildNormalApprovalInstance,
  createApprovalEngineDb,
  persistApprovalInstance,
} from '@/lib/approval-engine/instances'
import type { ApprovalInstanceTx } from '@/lib/approval-engine/instances'
import type {
  ApprovalEngineDb,
  ApprovalInstancePlan,
  BuildApprovalInstanceInput,
} from '@/lib/approval-engine/types'
import { snapshotCandidateGroup, stepScopeUnitId } from '@/lib/approval-engine/candidate-groups'
import { ApprovalRowCorruptedError, classifyApprovalRow } from '@/lib/approval-engine/legacy'
import type { Prisma } from '@prisma/client'
import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/validation'
import type { ResolvedApprovalRoute } from '@/lib/approval-routes/types'
import { ORGANIZATION_POSITION_LEVEL } from '@/lib/organization/types'
import type { OrganizationPositionCode, ReportingBranch } from '@/lib/organization/types'
import { createFakeApprovalEngineDb } from '../fixtures/organization-approval-fixtures'

const SECTION_PATH = ['section-1', 'department-1', 'division-1', 'factory-1'] as const

const route = (overrides: Partial<ResolvedApprovalRoute> = {}): ResolvedApprovalRoute => ({
  id: 'route-1',
  phase: 'REQUEST',
  scopeUnitId: 'section-1',
  version: 1,
  maximumPositionLevel: 4,
  status: 'PUBLISHED',
  ancestorScopeIds: [...SECTION_PATH],
  steps: [
    { order: 1, position: 'SUPERVISOR' },
    { order: 2, position: 'SECTION_MANAGER' },
    { order: 3, position: 'DEPARTMENT_MANAGER' },
  ],
  ...overrides,
})

const staffInput = (overrides: Partial<BuildApprovalInstanceInput> = {}): BuildApprovalInstanceInput => ({
  requestId: 'request-1',
  phase: 'REQUEST',
  originUserId: 'staff-1',
  originalRequestId: 'request-1',
  requestDepartmentId: 'department-1',
  ...overrides,
})

const staffDb = (
  candidates: Partial<Record<OrganizationPositionCode, string[]>> = {},
  routeOverrides: Partial<ResolvedApprovalRoute> = {},
): ApprovalEngineDb & { replaceCandidates(position: OrganizationPositionCode, ids: string[]): void } =>
  createFakeApprovalEngineDb({
    origin: { userId: 'staff-1', unitId: 'section-1', position: 'STAFF' },
    route: route(routeOverrides),
    candidates,
  })

/** Records the candidate lookups the builder issues without changing behavior. */
const spyCandidates = (
  base: ApprovalEngineDb,
  requested: Array<{ requiredPosition: OrganizationPositionCode; scopeUnitId: string; groupPath: readonly string[] }>,
): ApprovalEngineDb => ({
  ...base,
  findCandidates: async (query) => {
    requested.push({
      requiredPosition: query.requiredPosition,
      scopeUnitId: query.scopeUnitId,
      groupPath: query.branch.groupPath,
    })
    return base.findCandidates(query)
  },
})

/** Recording structural transaction fake for persistence assertions. */
interface RecordingTxOptions {
  users?: Array<{ id: string; name: string }>
  latestAttempt?: number
  failInstancesCreateWith?: unknown
}

const createRecordingTx = (options: RecordingTxOptions = {}): {
  tx: ApprovalInstanceTx
  calls: Record<string, unknown[]>
  instanceCreateCount: () => number
} => {
  const calls: Record<string, unknown[]> = {
    approval_instances: [],
    approval_instance_skips: [],
    approval_candidate_groups: [],
    approval_candidate_group_members: [],
    request_approvals: [],
    solution_approvals: [],
  }
  let instancesCreates = 0
  const users = options.users ?? []
  const tx: ApprovalInstanceTx = {
    user: {
      findMany: async (args) => users.filter((user) => args.where.id.in.includes(user.id)),
    },
    approval_instances: {
      findFirst: async () => (options.latestAttempt === undefined ? null : { attempt: options.latestAttempt }),
      create: async (args) => {
        instancesCreates += 1
        if (options.failInstancesCreateWith !== undefined) throw options.failInstancesCreateWith
        calls.approval_instances.push(args.data)
        return { id: `instance-${instancesCreates}` }
      },
    },
    approval_instance_skips: {
      create: async (args) => {
        calls.approval_instance_skips.push(args.data)
        return {}
      },
    },
    approval_candidate_groups: {
      create: async (args) => {
        calls.approval_candidate_groups.push(args.data)
        return { id: `group-${calls.approval_candidate_groups.length}` }
      },
    },
    approval_candidate_group_members: {
      create: async (args) => {
        calls.approval_candidate_group_members.push(args.data)
        return {}
      },
    },
    request_approvals: {
      create: async (args) => {
        calls.request_approvals.push(args.data)
        return {}
      },
    },
    solution_approvals: {
      create: async (args) => {
        calls.solution_approvals.push(args.data)
        return {}
      },
    },
  }
  return { tx, calls, instanceCreateCount: () => instancesCreates }
}

describe('NEW approval instance resolution', () => {
  it('freezes candidates and skips vacancies without activating a replacement', async () => {
    const db = createFakeApprovalEngineDb({
      origin: { userId: 'staff-1', unitId: 'section-1', position: 'STAFF' },
      route: {
        id: 'route-1', phase: 'REQUEST', scopeUnitId: 'section-1', version: 1,
        maximumPositionLevel: 4,
        status: 'PUBLISHED',
        ancestorScopeIds: ['section-1', 'department-1', 'division-1', 'factory-1'],
        steps: [
          { order: 1, position: 'SUPERVISOR' },
          { order: 2, position: 'SECTION_MANAGER' },
          { order: 3, position: 'DEPARTMENT_MANAGER' },
        ],
      },
      candidates: {
        SUPERVISOR: ['supervisor-1'],
        SECTION_MANAGER: [],
        DEPARTMENT_MANAGER: ['department-manager-1'],
      },
    })
    const plan = await buildNormalApprovalInstance(db, {
      requestId: 'request-1',
      phase: 'REQUEST',
      originUserId: 'staff-1',
      originalRequestId: 'request-1',
      requestDepartmentId: 'department-1',
    })
    assert.deepEqual(plan.steps.map((step) => step.candidateUserIds), [['supervisor-1'], ['department-manager-1']])
    assert.deepEqual(plan.skipped, [{ requiredPosition: 'SECTION_MANAGER', reason: 'VACANT_POSITION' }])
    db.replaceCandidates('SUPERVISOR', ['new-supervisor-1'])
    assert.deepEqual(plan.steps[0].candidateUserIds, ['supervisor-1'])
  })

  it('excludes positions at or below the origin level without vacancies or candidate lookups', async () => {
    const requested: Array<{ requiredPosition: OrganizationPositionCode; scopeUnitId: string; groupPath: readonly string[] }> = []
    const base = createFakeApprovalEngineDb({
      origin: { userId: 'supervisor-1', unitId: 'section-1', position: 'SUPERVISOR' },
      route: route({
        maximumPositionLevel: 3,
        steps: [
          { order: 1, position: 'SUPERVISOR' },
          { order: 2, position: 'SECTION_MANAGER' },
        ],
      }),
      candidates: { SECTION_MANAGER: ['section-manager-1'] },
    })
    const plan = await buildNormalApprovalInstance(
      spyCandidates(base, requested),
      staffInput({ originUserId: 'supervisor-1' }),
    )
    assert.deepEqual(plan.steps.map((step) => step.requiredPosition), ['SECTION_MANAGER'])
    assert.deepEqual(plan.skipped, [])
    assert.deepEqual(requested.map((call) => call.requiredPosition), ['SECTION_MANAGER'])
  })

  it('deduplicates candidate ids and detaches the plan from the organization', async () => {
    const sourceCandidates = ['supervisor-1', 'supervisor-1', 'supervisor-2']
    const db = staffDb({ SUPERVISOR: sourceCandidates })
    const plan = await buildNormalApprovalInstance(db, staffInput())
    assert.deepEqual(plan.steps[0].candidateUserIds, ['supervisor-1', 'supervisor-2'])
    sourceCandidates.push('late-addition')
    assert.deepEqual(plan.steps[0].candidateUserIds, ['supervisor-1', 'supervisor-2'])
    db.replaceCandidates('SUPERVISOR', ['replacement-1'])
    assert.deepEqual(plan.steps[0].candidateUserIds, ['supervisor-1', 'supervisor-2'])
    assert.ok(Object.isFrozen(plan.steps))
    assert.ok(Object.isFrozen(plan.steps[0].candidateUserIds))
    assert.ok(Object.isFrozen(plan.originContext.unitPath))

    const snapshotInput = ['a', 'a', 'b']
    const snapshot = snapshotCandidateGroup({
      requiredPosition: 'SUPERVISOR',
      scopeUnitId: 'section-1',
      candidateUserIds: snapshotInput,
    })
    snapshotInput.push('c')
    assert.deepEqual(snapshot.candidateUserIds, ['a', 'b'])
    assert.notEqual(snapshot.candidateUserIds, snapshotInput)
    assert.ok(snapshot.capturedAt instanceof Date)
  })

  it('derives each step scope from the origin branch path', () => {
    const staffBranch: ReportingBranch = {
      originUserId: 'staff-1', primaryUnitId: 'section-1', primaryAssignmentId: 'asg-1',
      primaryPosition: 'STAFF', unitPath: [...SECTION_PATH], groupPath: ['group-a'],
    }
    assert.equal(stepScopeUnitId(staffBranch, 'SUPERVISOR'), 'section-1')
    assert.equal(stepScopeUnitId(staffBranch, 'SECTION_MANAGER'), 'section-1')
    assert.equal(stepScopeUnitId(staffBranch, 'DEPARTMENT_MANAGER'), 'department-1')
    assert.equal(stepScopeUnitId(staffBranch, 'DIVISION_MANAGER'), 'division-1')
    assert.equal(stepScopeUnitId(staffBranch, 'FACTORY_MANAGER'), 'factory-1')
    const managerBranch: ReportingBranch = {
      originUserId: 'dm-1', primaryUnitId: 'department-1', primaryAssignmentId: 'asg-2',
      primaryPosition: 'DEPARTMENT_MANAGER', unitPath: ['department-1', 'division-1', 'factory-1'], groupPath: [],
    }
    assert.equal(stepScopeUnitId(managerBranch, 'DIVISION_MANAGER'), 'division-1')
    assert.equal(stepScopeUnitId(managerBranch, 'FACTORY_MANAGER'), 'factory-1')
    const factoryOnlyBranch: ReportingBranch = {
      originUserId: 'fm-1', primaryUnitId: 'factory-1', primaryAssignmentId: 'asg-3',
      primaryPosition: 'FACTORY_MANAGER', unitPath: ['factory-1'], groupPath: [],
    }
    assert.throws(() => stepScopeUnitId(factoryOnlyBranch, 'DEPARTMENT_MANAGER'), ApprovalRouteConfigurationError)
  })

  it('auto-approves every parent-position origin at or above the route ceiling', async () => {
    const fmDb = createFakeApprovalEngineDb({
      origin: { userId: 'fm', unitId: 'factory-1', position: 'FACTORY_MANAGER' },
      route: {
        id: 'factory-request-v1', scopeUnitId: 'factory-1', phase: 'REQUEST',
        version: 1, status: 'PUBLISHED', maximumPositionLevel: 6,
        ancestorScopeIds: ['factory-1'],
        steps: [{ order: 1, position: 'FACTORY_MANAGER' }],
      },
      candidates: {},
    })
    const fmResult = await buildNormalApprovalInstance(fmDb, {
      requestId: 'r-fm', originalRequestId: 'r-fm', phase: 'REQUEST',
      originUserId: 'fm', requestDepartmentId: null,
    })
    assert.equal(fmResult.state, 'AUTO_APPROVED')
    assert.equal(fmResult.originUnitId, 'factory-1')
    assert.deepEqual(fmResult.steps, [])
    assert.equal(fmResult.routingMode, 'SNAPSHOT_GROUP')
    assert.equal(fmResult.completionReason, undefined)

    const dvmDb = createFakeApprovalEngineDb({
      origin: { userId: 'dvm', unitId: 'division-1', position: 'DIVISION_MANAGER' },
      route: route({
        id: 'division-request-v1', scopeUnitId: 'division-1', maximumPositionLevel: 5,
        ancestorScopeIds: ['division-1', 'factory-1'],
        steps: [{ order: 1, position: 'DIVISION_MANAGER' }],
      }),
      candidates: {},
    })
    const dvmResult = await buildNormalApprovalInstance(dvmDb, {
      requestId: 'r-dvm', originalRequestId: 'r-dvm', phase: 'REQUEST',
      originUserId: 'dvm', requestDepartmentId: null,
    })
    assert.equal(dvmResult.state, 'AUTO_APPROVED')

    const dmDb = createFakeApprovalEngineDb({
      origin: { userId: 'dm', unitId: 'department-1', position: 'DEPARTMENT_MANAGER' },
      route: route({
        id: 'department-request-v1', scopeUnitId: 'department-1', maximumPositionLevel: 4,
        ancestorScopeIds: ['department-1', 'division-1', 'factory-1'],
        steps: [{ order: 1, position: 'DEPARTMENT_MANAGER' }],
      }),
      candidates: {},
    })
    const dmResult = await buildNormalApprovalInstance(dmDb, {
      requestId: 'r-dm', originalRequestId: 'r-dm', phase: 'REQUEST',
      originUserId: 'dm', requestDepartmentId: null,
    })
    assert.equal(dmResult.state, 'AUTO_APPROVED')

    const smDb = createFakeApprovalEngineDb({
      origin: { userId: 'sm', unitId: 'section-1', position: 'SECTION_MANAGER' },
      route: route({
        id: 'section-request-v1', maximumPositionLevel: 3,
        steps: [{ order: 1, position: 'SECTION_MANAGER' }],
      }),
      candidates: {},
    })
    const smResult = await buildNormalApprovalInstance(smDb, {
      requestId: 'r-sm', originalRequestId: 'r-sm', phase: 'REQUEST',
      originUserId: 'sm', requestDepartmentId: null,
    })
    assert.equal(smResult.state, 'AUTO_APPROVED')

    const staffCeilingDb = staffDb({}, { steps: [], maximumPositionLevel: 1 })
    const staffCeilingResult = await buildNormalApprovalInstance(staffCeilingDb, staffInput())
    assert.equal(staffCeilingResult.state, 'AUTO_APPROVED')
    assert.deepEqual(staffCeilingResult.skipped, [])
  })

  it('keeps a below-ceiling manager origin pending from its unit ancestor scope', async () => {
    const db = createFakeApprovalEngineDb({
      origin: { userId: 'dm', unitId: 'department-1', position: 'DEPARTMENT_MANAGER' },
      route: route({
        id: 'department-request-v1', scopeUnitId: 'department-1', maximumPositionLevel: 5,
        ancestorScopeIds: ['department-1', 'division-1', 'factory-1'],
        steps: [{ order: 1, position: 'DIVISION_MANAGER' }],
      }),
      candidates: { DIVISION_MANAGER: ['division-manager-1'] },
    })
    const plan = await buildNormalApprovalInstance(db, {
      requestId: 'r-dm', originalRequestId: 'r-dm', phase: 'REQUEST',
      originUserId: 'dm', requestDepartmentId: null,
    })
    assert.equal(plan.state, 'PENDING')
    assert.deepEqual(plan.steps, [
      { order: 1, requiredPosition: 'DIVISION_MANAGER', scopeUnitId: 'division-1', candidateUserIds: ['division-manager-1'] },
    ])
    assert.deepEqual(plan.skipped, [])
    assert.equal(plan.originContext.position, 'DEPARTMENT_MANAGER')
    assert.deepEqual(plan.originContext.unitPath, ['department-1', 'division-1', 'factory-1'])
  })

  it('completes with NO_ELIGIBLE_APPROVAL_STEPS for vacant routes and empty routes', async () => {
    const allVacant = await buildNormalApprovalInstance(
      staffDb({}, { steps: [{ order: 1, position: 'SECTION_MANAGER' }], maximumPositionLevel: 3 }),
      staffInput(),
    )
    assert.equal(allVacant.state, 'COMPLETED_NO_ELIGIBLE_STEPS')
    assert.equal(allVacant.completionReason, 'NO_ELIGIBLE_APPROVAL_STEPS')
    assert.deepEqual(allVacant.steps, [])
    assert.deepEqual(allVacant.skipped, [{ requiredPosition: 'SECTION_MANAGER', reason: 'VACANT_POSITION' }])

    const emptyRoute = await buildNormalApprovalInstance(
      staffDb({}, { steps: [], maximumPositionLevel: 3 }),
      staffInput(),
    )
    assert.equal(emptyRoute.state, 'COMPLETED_NO_ELIGIBLE_STEPS')
    assert.equal(emptyRoute.completionReason, 'NO_ELIGIBLE_APPROVAL_STEPS')
    assert.deepEqual(emptyRoute.skipped, [])

    const failingDb: ApprovalEngineDb = {
      ...staffDb({ SUPERVISOR: ['supervisor-1'] }),
      resolvePublishedRoute: async () => {
        throw new ApprovalRouteConfigurationError('No published route for REQUEST in the origin branch')
      },
    }
    await assert.rejects(() => buildNormalApprovalInstance(failingDb, staffInput()), ApprovalRouteConfigurationError)
  })

  it('skips a step whose candidate group is only inactive users, distinct from an empty group', async () => {
    const base = staffDb({ SUPERVISOR: ['supervisor-1'], DEPARTMENT_MANAGER: ['department-manager-1'] })
    const inactiveOnlyDb: ApprovalEngineDb = {
      ...base,
      findCandidates: async (query) =>
        query.requiredPosition === 'SECTION_MANAGER'
          ? [{ id: 'ghost-manager-1', isActive: false }]
          : base.findCandidates(query),
    }
    const plan = await buildNormalApprovalInstance(inactiveOnlyDb, staffInput())
    assert.equal(plan.state, 'PENDING')
    assert.deepEqual(plan.steps.map((step) => step.requiredPosition), ['SUPERVISOR', 'DEPARTMENT_MANAGER'])
    assert.deepEqual(plan.skipped, [{ requiredPosition: 'SECTION_MANAGER', reason: 'VACANT_POSITION' }])
  })

  it('completes NO_ELIGIBLE_APPROVAL_STEPS when the sole step holds only inactive users', async () => {
    const base = staffDb({}, { steps: [{ order: 1, position: 'SECTION_MANAGER' }], maximumPositionLevel: 3 })
    const inactiveOnlyDb: ApprovalEngineDb = {
      ...base,
      findCandidates: async () => [{ id: 'ghost-manager-1', isActive: false }],
    }
    const plan = await buildNormalApprovalInstance(inactiveOnlyDb, staffInput())
    assert.equal(plan.state, 'COMPLETED_NO_ELIGIBLE_STEPS')
    assert.equal(plan.completionReason, 'NO_ELIGIBLE_APPROVAL_STEPS')
    assert.deepEqual(plan.steps, [])
    assert.deepEqual(plan.skipped, [{ requiredPosition: 'SECTION_MANAGER', reason: 'VACANT_POSITION' }])
  })

  it('resolves supervisor candidates only from the origin reporting-group path and managers from their unit scope', async () => {
    const requested: Array<{ requiredPosition: OrganizationPositionCode; scopeUnitId: string; groupPath: readonly string[] }> = []
    const universe = {
      reportingGroups: {
        'group-a': ['supervisor-a1'],
        'group-b': ['supervisor-b1'],
      } as Record<string, string[]>,
      managers: {
        'SECTION_MANAGER@section-pd1': ['section-manager-1'],
        'DEPARTMENT_MANAGER@department-1': ['department-manager-1'],
        'DEPARTMENT_MANAGER@department-2': ['department-manager-sibling'],
      } as Record<string, string[]>,
    }
    const origin = { userId: 'staff-pd1', unitId: 'section-pd1', position: 'STAFF' as const }
    const pd1Route = route({
      id: 'route-pd1',
      scopeUnitId: 'section-pd1',
      ancestorScopeIds: ['section-pd1', 'department-1', 'division-1', 'factory-1'],
    })
    const scopeAwareDb: ApprovalEngineDb = {
      resolvePhaseOrigin: async (query) => ({
        phase: query.phase,
        originUserId: origin.userId,
        originUnitId: origin.unitId,
        branch: {
          originUserId: origin.userId,
          primaryUnitId: origin.unitId,
          primaryAssignmentId: 'asg-pd1',
          primaryPosition: origin.position,
          unitPath: [...pd1Route.ancestorScopeIds],
          groupPath: ['group-a'],
        },
        originalRequestId: query.requestId,
        requestDepartmentId: null,
        source: 'REQUESTER',
      }),
      resolvePublishedRoute: async () => ({ ...pd1Route, steps: pd1Route.steps.map((step) => ({ ...step })), ancestorScopeIds: [...pd1Route.ancestorScopeIds] }),
      findCandidates: async (query) => {
        requested.push({
          requiredPosition: query.requiredPosition,
          scopeUnitId: query.scopeUnitId,
          groupPath: query.branch.groupPath,
        })
        if (ORGANIZATION_POSITION_LEVEL[query.requiredPosition] <= 2) {
          return query.branch.groupPath.flatMap((groupId) => universe.reportingGroups[groupId] ?? []).map((id) => ({ id, isActive: true }))
        }
        return (universe.managers[`${query.requiredPosition}@${query.scopeUnitId}`] ?? []).map((id) => ({ id, isActive: true }))
      },
    }
    const plan = await buildNormalApprovalInstance(scopeAwareDb, staffInput({ originUserId: 'staff-pd1' }))

    assert.deepEqual(plan.steps.map((step) => [step.requiredPosition, step.scopeUnitId, [...step.candidateUserIds]]), [
      ['SUPERVISOR', 'section-pd1', ['supervisor-a1']],
      ['SECTION_MANAGER', 'section-pd1', ['section-manager-1']],
      ['DEPARTMENT_MANAGER', 'department-1', ['department-manager-1']],
    ])
    assert.ok(!plan.steps.some((step) => step.candidateUserIds.includes('supervisor-b1')))
    assert.ok(!plan.steps.some((step) => step.candidateUserIds.includes('department-manager-sibling')))
    assert.deepEqual(requested.map((call) => call.groupPath), [['group-a'], ['group-a'], ['group-a']])
    assert.equal(requested.some((call) => call.scopeUnitId === 'department-2'), false)
    assert.equal(requested.some((call) => call.scopeUnitId === 'section-pd2'), false)
  })
})

describe('persisted approval row classification', () => {
  const snapshotRow = {
    routingMode: 'SNAPSHOT_GROUP',
    integrityVersion: 1,
    instanceId: 'instance-1',
    candidateGroupId: 'group-1',
    requiredPosition: 'SUPERVISOR',
  }

  it('classifies legacy level rows for the unchanged legacy engine', () => {
    assert.deepEqual(
      classifyApprovalRow({ routingMode: 'LEGACY_LEVEL', integrityVersion: 0, requiredLevel: 3 }),
      { mode: 'LEGACY_LEVEL', requiredLevel: 3 },
    )
    assert.deepEqual(
      classifyApprovalRow({ integrityVersion: 0, requiredLevel: null }),
      { mode: 'LEGACY_LEVEL', requiredLevel: null },
    )
  })

  it('classifies custom rows by exact person and distinguishes legacy rows from new attempts', () => {
    assert.deepEqual(
      classifyApprovalRow({ routingMode: 'CUSTOM_PERSON', integrityVersion: 0, requiredApproverId: 'approver-1', instanceId: null }),
      { mode: 'CUSTOM_PERSON', requiredApproverId: 'approver-1', instanceId: null },
    )
    assert.deepEqual(
      classifyApprovalRow({ routingMode: 'CUSTOM_PERSON', integrityVersion: 1, requiredApproverId: 'approver-2', instanceId: 'instance-9' }),
      { mode: 'CUSTOM_PERSON', requiredApproverId: 'approver-2', instanceId: 'instance-9' },
    )
  })

  it('classifies snapshot rows and fails corrupted snapshot metadata instead of downgrading it', () => {
    assert.deepEqual(classifyApprovalRow(snapshotRow), {
      mode: 'SNAPSHOT_GROUP',
      instanceId: 'instance-1',
      candidateGroupId: 'group-1',
      requiredPosition: 'SUPERVISOR',
    })
    assert.throws(() => classifyApprovalRow({ ...snapshotRow, candidateGroupId: null }), ApprovalRowCorruptedError)
    assert.throws(() => classifyApprovalRow({ ...snapshotRow, instanceId: null }), ApprovalRowCorruptedError)
    assert.throws(() => classifyApprovalRow({ ...snapshotRow, requiredPosition: 'NOT_A_POSITION' }), ApprovalRowCorruptedError)
    assert.throws(() => classifyApprovalRow({ ...snapshotRow, integrityVersion: 0 }), ApprovalRowCorruptedError)
    assert.throws(() => classifyApprovalRow({ routingMode: 'MYSTERY_MODE', integrityVersion: 0 }), ApprovalRowCorruptedError)
  })
})

describe('approval instance persistence', () => {
  const labelUsers = [
    { id: 'staff-1', name: 'Staff One' },
    { id: 'supervisor-1', name: 'Supervisor One' },
  ]

  const buildPendingPlan = async (): Promise<ApprovalInstancePlan> =>
    buildNormalApprovalInstance(
      staffDb({ SUPERVISOR: ['supervisor-1'] }, {
        steps: [
          { order: 1, position: 'SUPERVISOR' },
          { order: 2, position: 'SECTION_MANAGER' },
        ],
        maximumPositionLevel: 3,
      }),
      staffInput(),
    )

  it('persists the instance, snapshot group, approval row and skip through the caller transaction', async () => {
    const plan = await buildPendingPlan()
    const planSnapshot = structuredClone(plan)
    const { tx, calls } = createRecordingTx({ users: labelUsers })

    const persisted = await persistApprovalInstance(tx, plan)

    assert.equal(persisted.id, 'instance-1')
    assert.equal(persisted.attempt, 1)
    assert.deepEqual(calls.approval_instances, [{
      requestId: 'request-1',
      solutionId: null,
      phase: 'REQUEST',
      routeVersionId: 'route-1',
      originUserId: 'staff-1',
      originUnitId: 'section-1',
      originContext: {
        position: 'STAFF',
        assignmentId: 'assignment-staff-1',
        unitPath: [...SECTION_PATH],
        groupPath: ['section-1-group-a'],
        labels: { 'staff-1': 'Staff One', 'supervisor-1': 'Supervisor One' },
      },
      routingMode: 'SNAPSHOT_GROUP',
      state: 'PENDING',
      attempt: 1,
      completionReason: null,
    }])
    assert.equal(calls.approval_candidate_groups.length, 1)
    const groupRow = calls.approval_candidate_groups[0] as Record<string, unknown>
    assert.equal(groupRow.approvalInstanceId, 'instance-1')
    assert.equal(groupRow.requiredPosition, 'SUPERVISOR')
    assert.equal(groupRow.scopeUnitId, 'section-1')
    assert.ok(groupRow.capturedAt instanceof Date)
    assert.deepEqual(calls.approval_candidate_group_members, [{
      candidateGroupId: 'group-1',
      userId: 'supervisor-1',
      capturedAt: groupRow.capturedAt,
      capturedDisplayName: 'Supervisor One',
    }])
    assert.deepEqual(calls.request_approvals, [{
      requestId: 'request-1',
      approverId: null,
      requiredLevel: null,
      order: 1,
      status: 'pending',
      comments: null,
      approvedAt: null,
      isCustomChain: false,
      isFinalApproval: false,
      requiredApproverId: null,
      instanceId: 'instance-1',
      requiredPosition: 'SUPERVISOR',
      candidateGroupId: 'group-1',
      routingMode: 'SNAPSHOT_GROUP',
      integrityVersion: 1,
    }])
    assert.deepEqual(calls.solution_approvals, [])
    assert.deepEqual(calls.approval_instance_skips, [{
      approvalInstanceId: 'instance-1',
      requiredPosition: 'SECTION_MANAGER',
      reason: 'VACANT_POSITION',
    }])
    assert.deepEqual(plan, planSnapshot)
    assert.deepEqual(plan.originContext.labels, {})
  })

  it('records the approved group-less self-audit row for AUTO_APPROVED instances', async () => {
    const fmDb = createFakeApprovalEngineDb({
      origin: { userId: 'fm', unitId: 'factory-1', position: 'FACTORY_MANAGER' },
      route: {
        id: 'factory-request-v1', scopeUnitId: 'factory-1', phase: 'REQUEST',
        version: 1, status: 'PUBLISHED', maximumPositionLevel: 6,
        ancestorScopeIds: ['factory-1'],
        steps: [{ order: 1, position: 'FACTORY_MANAGER' }],
      },
      candidates: {},
    })
    const plan = await buildNormalApprovalInstance(fmDb, {
      requestId: 'r-fm', originalRequestId: 'r-fm', phase: 'REQUEST',
      originUserId: 'fm', requestDepartmentId: null,
    })
    const { tx, calls } = createRecordingTx({ users: [{ id: 'fm', name: 'Factory Manager' }] })

    const persisted = await persistApprovalInstance(tx, plan)

    assert.equal(persisted.id, 'instance-1')
    assert.equal(calls.request_approvals.length, 1)
    const selfRow = calls.request_approvals[0] as Record<string, unknown>
    assert.deepEqual(selfRow, {
      requestId: 'r-fm',
      approverId: 'fm',
      requiredLevel: null,
      order: 1,
      status: 'approved',
      comments: null,
      approvedAt: selfRow.approvedAt,
      isCustomChain: false,
      isFinalApproval: false,
      requiredApproverId: null,
      instanceId: 'instance-1',
      requiredPosition: 'FACTORY_MANAGER',
      candidateGroupId: null,
      routingMode: 'SNAPSHOT_GROUP',
      integrityVersion: 1,
    })
    assert.ok(selfRow.approvedAt instanceof Date)
    assert.deepEqual(calls.approval_candidate_groups, [])
    assert.deepEqual(calls.approval_candidate_group_members, [])
    assert.deepEqual(calls.approval_instance_skips, [])
    assert.equal((calls.approval_instances[0] as Record<string, unknown>).state, 'AUTO_APPROVED')
  })

  it('writes final-phase self-audit rows with isFinalApproval and grouped final rows only on the last step', async () => {
    const finalDb = createFakeApprovalEngineDb({
      origin: { userId: 'fm', unitId: 'factory-1', position: 'FACTORY_MANAGER' },
      route: {
        id: 'factory-final-v1', scopeUnitId: 'factory-1', phase: 'FINAL',
        version: 1, status: 'PUBLISHED', maximumPositionLevel: 6,
        ancestorScopeIds: ['factory-1'],
        steps: [{ order: 1, position: 'FACTORY_MANAGER' }],
      },
      candidates: {},
    })
    const autoPlan = await buildNormalApprovalInstance(finalDb, {
      requestId: 'r-final', originalRequestId: 'r-final', phase: 'FINAL',
      originUserId: 'fm', requestDepartmentId: null,
    })
    const { tx, calls } = createRecordingTx()
    await persistApprovalInstance(tx, autoPlan)
    assert.equal((calls.request_approvals[0] as Record<string, unknown>).isFinalApproval, true)

    const groupedPlan = await buildNormalApprovalInstance(
      staffDb({ SUPERVISOR: ['supervisor-1'], DEPARTMENT_MANAGER: ['department-manager-1'] }, { phase: 'FINAL', id: 'route-final' }),
      staffInput({ phase: 'FINAL' }),
    )
    const groupedTx = createRecordingTx()
    await persistApprovalInstance(groupedTx.tx, groupedPlan)
    assert.equal(groupedTx.calls.request_approvals.length, 2)
    assert.equal((groupedTx.calls.request_approvals[0] as Record<string, unknown>).isFinalApproval, false)
    assert.equal((groupedTx.calls.request_approvals[1] as Record<string, unknown>).isFinalApproval, true)
    assert.equal((groupedTx.calls.request_approvals[1] as Record<string, unknown>).order, 3)
  })

  it('persists solution-phase instances into solution_approvals with version-1 metadata', async () => {
    const solutionDb = createFakeApprovalEngineDb({
      origin: { userId: 'engineer-1', unitId: 'section-1', position: 'STAFF' },
      route: route({ id: 'route-solution', phase: 'SOLUTION' }),
      candidates: { SUPERVISOR: ['supervisor-1'] },
    })
    const plan = await buildNormalApprovalInstance(solutionDb, {
      requestId: 'request-1',
      solutionId: 'solution-1',
      phase: 'SOLUTION',
      originUserId: 'engineer-1',
      originalRequestId: 'request-1',
      requestDepartmentId: 'department-1',
    })
    const { tx, calls } = createRecordingTx({ users: labelUsers })

    await persistApprovalInstance(tx, plan)

    const instanceRow = calls.approval_instances[0] as Record<string, unknown>
    assert.equal(instanceRow.requestId, null)
    assert.equal(instanceRow.solutionId, 'solution-1')
    assert.equal(instanceRow.phase, 'SOLUTION')
    assert.deepEqual(calls.request_approvals, [])
    assert.equal(calls.solution_approvals.length, 1)
    const solutionRow = calls.solution_approvals[0] as Record<string, unknown>
    assert.equal(solutionRow.solutionId, 'solution-1')
    assert.equal(solutionRow.routingMode, 'SNAPSHOT_GROUP')
    assert.equal(solutionRow.integrityVersion, 1)
    assert.equal(solutionRow.instanceId, 'instance-1')
    assert.equal(solutionRow.candidateGroupId, 'group-1')
    assert.equal(solutionRow.requiredPosition, 'SUPERVISOR')
    assert.equal(solutionRow.status, 'pending')
    assert.equal('isFinalApproval' in solutionRow, false)
  })

  it('advances attempt history across persisted instances of the same document and phase', async () => {
    const plan = await buildPendingPlan()
    const { tx, calls } = createRecordingTx({ latestAttempt: 3, users: labelUsers })

    const persisted = await persistApprovalInstance(tx, plan)

    assert.equal(persisted.attempt, 4)
    assert.equal((calls.approval_instances[0] as Record<string, unknown>).attempt, 4)
  })

  it('persists an all-vacant completed instance with skips and no approval rows', async () => {
    const plan = await buildNormalApprovalInstance(
      staffDb({}, { steps: [{ order: 1, position: 'SECTION_MANAGER' }], maximumPositionLevel: 3 }),
      staffInput(),
    )
    assert.equal(plan.state, 'COMPLETED_NO_ELIGIBLE_STEPS')
    const { tx, calls } = createRecordingTx({ users: labelUsers })

    const persisted = await persistApprovalInstance(tx, plan)

    assert.equal(persisted.id, 'instance-1')
    const instanceRow = calls.approval_instances[0] as Record<string, unknown>
    assert.equal(instanceRow.state, 'COMPLETED_NO_ELIGIBLE_STEPS')
    assert.equal(instanceRow.completionReason, 'NO_ELIGIBLE_APPROVAL_STEPS')
    assert.deepEqual(calls.approval_instance_skips, [{
      approvalInstanceId: 'instance-1',
      requiredPosition: 'SECTION_MANAGER',
      reason: 'VACANT_POSITION',
    }])
    assert.deepEqual(calls.request_approvals, [])
    assert.deepEqual(calls.solution_approvals, [])
    assert.deepEqual(calls.approval_candidate_groups, [])
    assert.deepEqual(calls.approval_candidate_group_members, [])
  })

  it('persists a SOLUTION AUTO_APPROVED instance with the approved solution self-row and null requestId', async () => {
    const solutionAutoDb = createFakeApprovalEngineDb({
      origin: { userId: 'fm', unitId: 'factory-1', position: 'FACTORY_MANAGER' },
      route: {
        id: 'factory-solution-v1', scopeUnitId: 'factory-1', phase: 'SOLUTION',
        version: 1, status: 'PUBLISHED', maximumPositionLevel: 6,
        ancestorScopeIds: ['factory-1'],
        steps: [{ order: 1, position: 'FACTORY_MANAGER' }],
      },
      candidates: {},
    })
    const plan = await buildNormalApprovalInstance(solutionAutoDb, {
      requestId: 'request-1',
      solutionId: 'solution-9',
      phase: 'SOLUTION',
      originUserId: 'fm',
      originalRequestId: 'request-1',
      requestDepartmentId: null,
    })
    assert.equal(plan.state, 'AUTO_APPROVED')
    const { tx, calls } = createRecordingTx({ users: [{ id: 'fm', name: 'Factory Manager' }] })

    const persisted = await persistApprovalInstance(tx, plan)

    assert.equal(persisted.id, 'instance-1')
    const instanceRow = calls.approval_instances[0] as Record<string, unknown>
    assert.equal(instanceRow.requestId, null)
    assert.equal(instanceRow.solutionId, 'solution-9')
    assert.equal(instanceRow.phase, 'SOLUTION')
    assert.equal(instanceRow.state, 'AUTO_APPROVED')
    assert.deepEqual(calls.request_approvals, [])
    assert.equal(calls.solution_approvals.length, 1)
    const selfRow = calls.solution_approvals[0] as Record<string, unknown>
    assert.deepEqual(selfRow, {
      solutionId: 'solution-9',
      approverId: 'fm',
      requiredLevel: null,
      order: 1,
      status: 'approved',
      comments: null,
      approvedAt: selfRow.approvedAt,
      isCustomChain: false,
      requiredApproverId: null,
      instanceId: 'instance-1',
      requiredPosition: 'FACTORY_MANAGER',
      candidateGroupId: null,
      routingMode: 'SNAPSHOT_GROUP',
      integrityVersion: 1,
    })
    assert.ok(selfRow.approvedAt instanceof Date)
    assert.deepEqual(calls.approval_candidate_groups, [])
    assert.deepEqual(calls.approval_candidate_group_members, [])
    assert.deepEqual(calls.approval_instance_skips, [])
  })

  it('surfaces serialization conflicts as a retryable error without retrying', async () => {
    const plan = await buildPendingPlan()
    const prismaConflict = Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), { code: 'P2034' })
    const conflict = createRecordingTx({ users: labelUsers, failInstancesCreateWith: prismaConflict })
    await assert.rejects(() => persistApprovalInstance(conflict.tx, plan), ApprovalEngineConflictError)
    assert.equal(conflict.instanceCreateCount(), 1)

    const postgresConflict = createRecordingTx({
      users: labelUsers,
      failInstancesCreateWith: new Error('could not serialize access due to concurrent update (SQLSTATE 40001)'),
    })
    await assert.rejects(() => persistApprovalInstance(postgresConflict.tx, plan), ApprovalEngineConflictError)
    assert.equal(postgresConflict.instanceCreateCount(), 1)

    const boom = new Error('boom')
    const unrelated = createRecordingTx({ users: labelUsers, failInstancesCreateWith: boom })
    await assert.rejects(() => persistApprovalInstance(unrelated.tx, plan), (error: unknown) => error === boom)
  })

  it('runs NEW instance transactions under serializable isolation', () => {
    assert.equal(APPROVAL_ENGINE_TRANSACTION_ISOLATION, 'Serializable')
  })
})

describe('production approval engine adapter', () => {
  const unitRows = [
    { id: 'factory-1', name: 'Factory', unitType: 'FACTORY', parentId: null, isActive: true },
    { id: 'division-1', name: 'Division', unitType: 'DIVISION', parentId: 'factory-1', isActive: true },
    { id: 'department-1', name: 'Department', unitType: 'DEPARTMENT', parentId: 'division-1', isActive: true },
    { id: 'section-1', name: 'PD1', unitType: 'SECTION', parentId: 'department-1', isActive: true },
  ]
  const userRows = [
    { id: 'requester-1', name: 'Requester One', isActive: true },
    { id: 'engineer-1', name: 'Engineer One', isActive: true },
    { id: 'final-initiator-1', name: 'Final Initiator', isActive: true },
    { id: 'supervisor-1', name: 'Supervisor One', isActive: true },
    { id: 'inactive-1', name: 'Inactive One', isActive: false },
    { id: 'supervisor-sibling', name: 'Sibling Supervisor', isActive: true },
    { id: 'dm-1', name: 'Manager One', isActive: true },
    { id: 'dm-2', name: 'Manager Two', isActive: true },
    { id: 'dm-3', name: 'Manager Three', isActive: true },
    { id: 'staff-peer-1', name: 'Peer Staff One', isActive: true },
    { id: 'ghost', name: 'Ghost', isActive: true },
  ]
  const assignmentRows = [
    { id: 'asg-1', userId: 'requester-1', unitId: 'section-1', positionCode: 'STAFF', reportingGroupId: 'group-a', isPrimary: true, isActive: true },
    { id: 'asg-eng', userId: 'engineer-1', unitId: 'section-1', positionCode: 'STAFF', reportingGroupId: null, isPrimary: true, isActive: true },
    { id: 'asg-fin', userId: 'final-initiator-1', unitId: 'section-1', positionCode: 'STAFF', reportingGroupId: null, isPrimary: true, isActive: true },
    { id: 'asg-sup-1', userId: 'supervisor-1', unitId: 'section-1', positionCode: 'SUPERVISOR', reportingGroupId: 'group-a', isPrimary: true, isActive: true },
    { id: 'asg-sup-inactive', userId: 'inactive-1', unitId: 'section-1', positionCode: 'SUPERVISOR', reportingGroupId: 'group-a', isPrimary: true, isActive: true },
    { id: 'asg-sup-b', userId: 'supervisor-sibling', unitId: 'section-1', positionCode: 'SUPERVISOR', reportingGroupId: 'group-b', isPrimary: true, isActive: true },
    { id: 'asg-dm', userId: 'dm-1', unitId: 'department-1', positionCode: 'DEPARTMENT_MANAGER', reportingGroupId: null, isPrimary: true, isActive: true },
    { id: 'asg-dm-secondary', userId: 'dm-2', unitId: 'department-1', positionCode: 'DEPARTMENT_MANAGER', reportingGroupId: null, isPrimary: false, isActive: true },
    { id: 'asg-dm-sibling', userId: 'dm-3', unitId: 'department-2', positionCode: 'DEPARTMENT_MANAGER', reportingGroupId: null, isPrimary: true, isActive: true },
  ]
  const groupRows = [
    { id: 'group-a', unitId: 'section-1', parentGroupId: null, name: 'Group A', isActive: true },
    { id: 'group-b', unitId: 'section-1', parentGroupId: null, name: 'Group B', isActive: true },
  ]
  const memberRows = [
    { reportingGroupId: 'group-a', userId: 'requester-1' },
    { reportingGroupId: 'group-a', userId: 'supervisor-1' },
    { reportingGroupId: 'group-a', userId: 'inactive-1' },
    { reportingGroupId: 'group-a', userId: 'staff-peer-1' },
    { reportingGroupId: 'group-b', userId: 'supervisor-sibling' },
  ]
  const requestRows: Record<string, { requesterId: string; departmentId: string | null }> = {
    'request-9': { requesterId: 'requester-1', departmentId: 'department-1' },
  }
  const solutionRows: Record<string, { requestId: string; submittedById: string }> = {
    'solution-5': { requestId: 'request-9', submittedById: 'engineer-1' },
  }
  const versionRows = [
    { id: 'route-1', scopeUnitId: 'section-1', phase: 'REQUEST', version: 1, maximumPositionLevel: 4, status: 'PUBLISHED' },
    { id: 'route-draft', scopeUnitId: 'section-1', phase: 'REQUEST', version: 2, maximumPositionLevel: 4, status: 'DRAFT' },
  ]
  const stepRows = [
    { id: 'step-1', routeVersionId: 'route-1', stepOrder: 1, positionCode: 'SUPERVISOR' },
    { id: 'step-draft', routeVersionId: 'route-draft', stepOrder: 1, positionCode: 'FACTORY_MANAGER' },
  ]

  const capturedWheres: Record<string, unknown[]> = {
    reporting_group_members: [],
    organization_position_assignments: [],
  }

  /** Structural Prisma-shaped fake: emulates only the query shapes the adapter issues. */
  const fakeTx = () => ({
    user: {
      findUnique: async (args: { where: { id: string } }) =>
        userRows.find((user) => user.id === args.where.id) ?? null,
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        userRows.filter((user) => args.where.id.in.includes(user.id)),
    },
    organization_units: { findMany: async () => unitRows },
    organization_position_assignments: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        capturedWheres.organization_position_assignments.push(args.where)
        return assignmentRows.filter((row) =>
          (args.where.userId === undefined || row.userId === args.where.userId) &&
          (args.where.positionCode === undefined || row.positionCode === args.where.positionCode) &&
          (args.where.unitId === undefined || row.unitId === args.where.unitId) &&
          (args.where.reportingGroupId === undefined || (row.reportingGroupId !== null && (args.where.reportingGroupId as { in: string[] }).in.includes(row.reportingGroupId))) &&
          (args.where.isPrimary === undefined || row.isPrimary === args.where.isPrimary) &&
          (args.where.isActive === undefined || row.isActive === args.where.isActive))
      },
    },
    reporting_groups: { findMany: async () => groupRows },
    reporting_group_members: {
      findMany: async (args?: { where: { reportingGroupId: { in: string[] } } }) => {
        // resolveReportingBranch validates ALL memberships (no args); the
        // candidate query filters to the branch group path.
        if (!args) return memberRows
        capturedWheres.reporting_group_members.push(args.where)
        const inGroupIds = args.where.reportingGroupId.in
        return memberRows.filter((row) => inGroupIds.includes(row.reportingGroupId))
      },
    },
    requests: { findUnique: async (args: { where: { id: string } }) => requestRows[args.where.id] ?? null },
    solutions: { findUnique: async (args: { where: { id: string } }) => solutionRows[args.where.id] ?? null },
    approval_route_versions: {
      findMany: async (args: { where: { scopeUnitId: { in: string[] }; phase: string } }) =>
        versionRows.filter((row) => args.where.scopeUnitId.in.includes(row.scopeUnitId) && row.phase === args.where.phase),
    },
    approval_route_steps: {
      findMany: async (args: { where: { routeVersionId: { in: string[] } } }) =>
        stepRows.filter((row) => args.where.routeVersionId.in.includes(row.routeVersionId)),
    },
  })

  const engine = (db = fakeTx()): ApprovalEngineDb => createApprovalEngineDb(db as unknown as Prisma.TransactionClient)

  const staffBranch: ReportingBranch = {
    originUserId: 'requester-1', primaryUnitId: 'section-1', primaryAssignmentId: 'asg-1',
    primaryPosition: 'STAFF', unitPath: [...SECTION_PATH], groupPath: ['group-a'],
  }

  it('derives the request-phase origin from the stored requester and rejects untrusted actor input', async () => {
    const origin = await engine().resolvePhaseOrigin({ phase: 'REQUEST', requestId: 'request-9' })
    assert.equal(origin.originUserId, 'requester-1')
    assert.equal(origin.originUnitId, 'section-1')
    assert.equal(origin.source, 'REQUESTER')
    assert.equal(origin.requestDepartmentId, 'department-1')
    assert.equal(origin.originalRequestId, 'request-9')
    assert.deepEqual(origin.branch.unitPath, [...SECTION_PATH])

    await assert.rejects(
      () => engine().resolvePhaseOrigin({ phase: 'REQUEST', requestId: 'request-9', originUserId: 'impostor' }),
      ApprovalRouteConfigurationError,
    )
    await assert.rejects(() => engine().resolvePhaseOrigin({ phase: 'REQUEST', requestId: 'missing' }), ApprovalRouteConfigurationError)
    await assert.rejects(
      () => engine().resolvePhaseOrigin({ phase: 'REQUEST', requestId: 'request-9', originUserId: 'ghost' }),
      ApprovalRouteConfigurationError,
    )
  })

  it('derives the solution origin from the stored submitter and the final origin from the authenticated initiator', async () => {
    const solutionOrigin = await engine().resolvePhaseOrigin({ phase: 'SOLUTION', requestId: 'request-9', solutionId: 'solution-5' })
    assert.equal(solutionOrigin.originUserId, 'engineer-1')
    assert.equal(solutionOrigin.source, 'SOLUTION_SUBMITTER')
    assert.equal(solutionOrigin.originalRequestId, 'request-9')
    assert.equal(solutionOrigin.requestDepartmentId, 'department-1')
    await assert.rejects(
      () => engine().resolvePhaseOrigin({ phase: 'SOLUTION', requestId: 'request-9', solutionId: 'solution-5', originUserId: 'impostor' }),
      ApprovalRouteConfigurationError,
    )
    await assert.rejects(
      () => engine().resolvePhaseOrigin({ phase: 'SOLUTION', requestId: 'request-9' }),
      ApprovalRouteConfigurationError,
    )

    const finalOrigin = await engine().resolvePhaseOrigin({ phase: 'FINAL', requestId: 'request-9', originUserId: 'final-initiator-1' })
    assert.equal(finalOrigin.originUserId, 'final-initiator-1')
    assert.equal(finalOrigin.source, 'FINAL_INITIATOR')
    assert.equal(finalOrigin.requestDepartmentId, 'department-1')
    await assert.rejects(() => engine().resolvePhaseOrigin({ phase: 'FINAL', requestId: 'request-9' }), ApprovalRouteConfigurationError)
  })

  it('queries supervisor candidates as requiredPosition holders in the branch group path and managers from active primary assignments', async () => {
    const supervisors = await engine().findCandidates({ branch: staffBranch, requiredPosition: 'SUPERVISOR', scopeUnitId: 'section-1' })
    // Pool = active primary SUPERVISOR assignments scoped to the group path,
    // intersected with path membership; user activity stays in the result so
    // the builder can treat an all-inactive group as vacant.
    assert.deepEqual(supervisors, [
      { id: 'supervisor-1', isActive: true },
      { id: 'inactive-1', isActive: false },
    ])
    const supervisorAssignmentWhere = capturedWheres.organization_position_assignments.at(-1) as Record<string, unknown>
    assert.equal(supervisorAssignmentWhere.positionCode, 'SUPERVISOR')
    assert.deepEqual((supervisorAssignmentWhere.reportingGroupId as { in: string[] }).in, ['group-a'])
    assert.equal(supervisorAssignmentWhere.isPrimary, true)
    assert.equal(supervisorAssignmentWhere.isActive, true)
    const memberWhere = capturedWheres.reporting_group_members.at(-1) as { reportingGroupId: { in: string[] } }
    assert.deepEqual(memberWhere.reportingGroupId.in, ['group-a'])

    const managers = await engine().findCandidates({ branch: staffBranch, requiredPosition: 'DEPARTMENT_MANAGER', scopeUnitId: 'department-1' })
    assert.deepEqual(managers, [{ id: 'dm-1', isActive: true }])
    const managerWhere = capturedWheres.organization_position_assignments.at(-1) as Record<string, unknown>
    assert.equal(managerWhere.positionCode, 'DEPARTMENT_MANAGER')
    assert.equal(managerWhere.unitId, 'department-1')
    assert.equal(managerWhere.isPrimary, true)
    assert.equal(managerWhere.isActive, true)
  })

  it('never snapshots a staff origin or peer staff as SUPERVISOR candidates through the real adapter', async () => {
    const realEngine = engine()
    const staffMemberBranch: ReportingBranch = {
      originUserId: 'requester-1', primaryUnitId: 'section-1', primaryAssignmentId: 'asg-1',
      primaryPosition: 'STAFF', unitPath: [...SECTION_PATH], groupPath: ['group-a'],
    }
    const db: ApprovalEngineDb = {
      resolvePhaseOrigin: async (query) => ({
        phase: query.phase,
        originUserId: 'requester-1',
        originUnitId: 'section-1',
        branch: staffMemberBranch,
        originalRequestId: query.requestId,
        requestDepartmentId: null,
        source: 'REQUESTER',
      }),
      resolvePublishedRoute: (context) => realEngine.resolvePublishedRoute(context),
      findCandidates: (input) => realEngine.findCandidates(input),
    }
    const plan = await buildNormalApprovalInstance(db, staffInput({ requestId: 'request-9', originUserId: 'requester-1' }))
    const supervisorStep = plan.steps.find((step) => step.requiredPosition === 'SUPERVISOR')
    assert.ok(supervisorStep)
    // requester-1 and staff-peer-1 are group-a members without a SUPERVISOR
    // assignment; inactive-1 holds the position but is inactive. Only the
    // active position holder survives into the immutable snapshot.
    assert.deepEqual([...supervisorStep.candidateUserIds], ['supervisor-1'])
    assert.equal(supervisorStep.scopeUnitId, 'section-1')
  })

  it('loads published routes for the origin branch path through the route resolver', async () => {
    const resolved = await engine().resolvePublishedRoute({
      phase: 'REQUEST',
      originUserId: 'requester-1',
      originUnitId: 'section-1',
      requestId: 'request-9',
      originalRequestId: 'request-9',
      requestDepartmentId: 'department-1',
    })
    assert.equal(resolved.id, 'route-1')
    assert.equal(resolved.maximumPositionLevel, 4)
    assert.deepEqual(resolved.steps, [{ order: 1, position: 'SUPERVISOR' }])
    assert.deepEqual(resolved.ancestorScopeIds, [...SECTION_PATH])
    await assert.rejects(() => engine().resolvePublishedRoute({
      phase: 'FINAL',
      originUserId: 'requester-1',
      originUnitId: 'section-1',
      requestId: 'request-9',
      originalRequestId: 'request-9',
      requestDepartmentId: 'department-1',
    }), ApprovalRouteConfigurationError)
  })
})
