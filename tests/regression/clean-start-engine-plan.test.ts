// Clean-start approval instance builder + snapshot persistence (Plan B Task 4).
// In-memory fakes only: NO Prisma, NO database, NO env, NO schema/server ops.
// Builder never writes. Candidate SET comes from B3 selectStepCandidates
// (own-team load is caller-owned; siblings never passed). Account activity
// is filtered via findStepCandidates (R-A6-2: inactive accounts cannot act
// or be silently replaced).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  APPROVAL_ENGINE_TRANSACTION_ISOLATION,
  ApprovalEngineConflictError,
  ApprovalEnginePlanError,
  buildNormalApprovalInstance,
  persistApprovalInstance,
  type ApprovalEngineDb,
  type ApprovalInstancePlan,
  type ApprovalInstanceTx,
  type PhaseOrigin,
} from '@/lib/approval-engine/plan'
import type { AssignmentNode, PositionNode, ReportingPath } from '@/lib/organization/model'
import type { ResolvedApprovalRoute } from '@/lib/approval-routes/selection'

const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-lead', name: 'Lead', rank: 2, isActive: true },
  { id: 'p-mgr', name: 'Manager', rank: 3, isActive: true },
  { id: 'p-dir', name: 'Director', rank: 4, isActive: true },
]

const teamPath: ReportingPath = {
  originUserId: 'u-origin',
  assignmentId: 'a-origin',
  unitId: 'web',
  positionId: 'p-staff',
  teamId: 't-web',
  unitPath: ['web', 'eng', 'company'],
  steps: [
    { kind: 'TEAM_REPORTS_TO', unitId: 'web', assignmentId: 'a-lead', userId: 'u-lead', positionId: 'p-lead' },
    { kind: 'UNIT_MANAGER', unitId: 'web', assignmentId: 'a-webmgr', userId: 'u-webmgr', positionId: 'p-mgr' },
    { kind: 'UNIT_MANAGER', unitId: 'eng', assignmentId: 'a-engmgr', userId: 'u-engmgr', positionId: 'p-mgr' },
  ],
}

const m1: AssignmentNode = { id: 'a-m1', userId: 'u-m1', unitId: 'web', positionId: 'p-staff', teamId: 't-web', isActive: true }
const m2: AssignmentNode = { id: 'a-m2', userId: 'u-m2', unitId: 'web', positionId: 'p-lead', teamId: 't-web', isActive: true }
const ownTeamMemberAssignments: readonly AssignmentNode[] = [m1, m2]

// Sibling-team extra fixture: NEVER passed as ownTeamMemberAssignments.
const siblingLead: AssignmentNode = {
  id: 'a-sib',
  userId: 'u-sib',
  unitId: 'web',
  positionId: 'p-lead',
  teamId: 't-other',
  isActive: true,
}

const publishedRoute: ResolvedApprovalRoute = {
  id: 'rv-1',
  scopeUnitId: 'web',
  phase: 'REQUEST',
  version: 1,
  approvalLimitPositionId: 'p-dir',
  status: 'PUBLISHED',
  steps: [
    { order: 1, positionId: 'p-staff' },
    { order: 2, positionId: 'p-lead' },
    { order: 3, positionId: 'p-mgr' },
  ],
  ancestorScopeIds: ['web', 'eng', 'company'],
}

const allActiveAccounts: ReadonlyArray<{ id: string; isActive: boolean }> = [
  { id: 'u-origin', isActive: true },
  { id: 'u-m1', isActive: true },
  { id: 'u-m2', isActive: true },
  { id: 'u-lead', isActive: true },
  { id: 'u-webmgr', isActive: true },
  { id: 'u-engmgr', isActive: true },
  { id: 'u-sib', isActive: true },
]

function originFor(path: ReportingPath): PhaseOrigin {
  return {
    phase: 'REQUEST',
    originUserId: path.originUserId,
    originUnitId: path.unitId,
    path,
    requestId: 'req-1',
    source: 'REQUESTER',
  }
}

function createFakeDb(input: {
  path?: ReportingPath
  route?: ResolvedApprovalRoute
  positions?: PositionNode[]
  ownTeam?: readonly AssignmentNode[]
  accounts?: ReadonlyArray<{ id: string; isActive: boolean }>
}): ApprovalEngineDb & { ownTeamCalls: string[]; findStepCalls: number } {
  const path = input.path ?? teamPath
  const ownTeamCalls: string[] = []
  let findStepCalls = 0
  const db: ApprovalEngineDb & { ownTeamCalls: string[]; findStepCalls: number } = {
    ownTeamCalls,
    get findStepCalls() { return findStepCalls },
    async resolvePhaseOrigin() {
      return originFor(path)
    },
    async resolvePublishedRoute() {
      return input.route ?? publishedRoute
    },
    async loadPositions() {
      return input.positions ?? positions
    },
    async loadOwnTeamActiveAssignments(teamId: string) {
      ownTeamCalls.push(teamId)
      return [...(input.ownTeam ?? ownTeamMemberAssignments)]
    },
    async findStepCandidates() {
      findStepCalls += 1
      return input.accounts ?? allActiveAccounts
    },
  }
  return db
}

const buildInput = { requestId: 'req-1', phase: 'REQUEST' as const, originUserId: 'u-origin' }

type RecordedTx = ApprovalInstanceTx & {
  instances: Array<Record<string, unknown>>
  groups: Array<Record<string, unknown>>
  members: Array<Record<string, unknown>>
  skips: Array<Record<string, unknown>>
  requestApprovals: Array<Record<string, unknown>>
  solutionApprovals: Array<Record<string, unknown>>
  createCalls: number
}

function createFakeTx(input: {
  priorAttempts?: number[]
  users?: Array<{ id: string; name: string }>
  conflictCode?: string
}): RecordedTx {
  const instances: Array<Record<string, unknown>> = (input.priorAttempts ?? []).map((attempt, index) => ({
    id: `prior-${index}`,
    attempt,
  }))
  const groups: Array<Record<string, unknown>> = []
  const members: Array<Record<string, unknown>> = []
  const skips: Array<Record<string, unknown>> = []
  const requestApprovals: Array<Record<string, unknown>> = []
  const solutionApprovals: Array<Record<string, unknown>> = []
  let createCalls = 0
  const users = input.users ?? [
    { id: 'u-origin', name: 'Origin' },
    { id: 'u-m2', name: 'Member Two' },
    { id: 'u-lead', name: 'Lead Person' },
    { id: 'u-webmgr', name: 'Web Manager' },
    { id: 'u-engmgr', name: 'Eng Manager' },
  ]
  const tx: RecordedTx = {
    instances,
    groups,
    members,
    skips,
    requestApprovals,
    solutionApprovals,
    get createCalls() { return createCalls },
    user: {
      async findMany(args) {
        const wanted = new Set(args.where.id.in)
        return users.filter((user) => wanted.has(user.id)).map((user) => ({ id: user.id, name: user.name }))
      },
    },
    approval_instances: {
      async findFirst(args) {
        const matching = instances.filter((row) => {
          if (args.where.requestId !== undefined && row.requestId !== undefined && row.requestId !== args.where.requestId) return false
          if (args.where.solutionId !== undefined && row.solutionId !== undefined && row.solutionId !== args.where.solutionId) return false
          if (row.phase !== undefined && row.phase !== args.where.phase) return false
          return true
        })
        matching.sort((a, b) => Number(b.attempt) - Number(a.attempt))
        const top = matching[0]
        return top ? { attempt: Number(top.attempt) } : null
      },
      async create(args) {
        createCalls += 1
        if (input.conflictCode) {
          const error = new Error('could not serialize access due to concurrent update')
          ;(error as { code?: string }).code = input.conflictCode
          throw error
        }
        const id = `inst-${instances.length + 1}`
        const row = { ...args.data, id }
        instances.push(row)
        return { id }
      },
    },
    approval_instance_skips: {
      async create(args) {
        skips.push({ ...args.data })
        return {}
      },
    },
    approval_candidate_groups: {
      async create(args) {
        const id = `grp-${groups.length + 1}`
        groups.push({ ...args.data, id })
        return { id }
      },
    },
    approval_candidate_group_members: {
      async create(args) {
        members.push({ ...args.data })
        return {}
      },
    },
    request_approvals: {
      async create(args) {
        requestApprovals.push({ ...args.data })
        return {}
      },
    },
    solution_approvals: {
      async create(args) {
        solutionApprovals.push({ ...args.data })
        return {}
      },
    },
  }
  return tx
}

describe('clean-start engine plan — builder + persist', () => {
  it('1. origin at limit rank → AUTO_APPROVED, zero steps, zero skipped', async () => {
    const db = createFakeDb({
      path: { ...teamPath, positionId: 'p-dir' },
    })
    const plan = await buildNormalApprovalInstance(db, buildInput)
    assert.equal(plan.state, 'AUTO_APPROVED')
    assert.deepEqual(plan.steps, [])
    assert.deepEqual(plan.skipped, [])
    assert.equal(plan.completionReason, undefined)
    assert.equal(plan.routingMode, 'SNAPSHOT_GROUP')
    assert.equal(plan.originContext.positionId, 'p-dir')
    assert.equal(plan.originContext.assignmentId, 'a-origin')
    assert.deepEqual([...plan.originContext.unitPath], ['web', 'eng', 'company'])
    assert.equal(db.ownTeamCalls.length, 0)
    assert.equal(db.findStepCalls, 0)
  })

  it('2. step at/below origin rank is excluded from steps AND not recorded as vacant', async () => {
    const db = createFakeDb({
      path: { ...teamPath, positionId: 'p-lead' },
    })
    const plan = await buildNormalApprovalInstance(db, buildInput)
    assert.equal(plan.state, 'PENDING')
    assert.deepEqual(plan.steps.map((step) => step.requiredPositionId), ['p-mgr'])
    assert.equal(plan.skipped.some((skip) => skip.requiredPositionId === 'p-staff'), false)
    assert.equal(plan.skipped.some((skip) => skip.requiredPositionId === 'p-lead'), false)
    assert.deepEqual(plan.skipped, [])
    assert.deepEqual([...plan.steps[0].candidateUserIds], ['u-webmgr', 'u-engmgr'])
  })

  it('3. vacant required step is recorded VACANT_POSITION (not-required vs vacant distinction)', async () => {
    const db = createFakeDb({
      accounts: [
        { id: 'u-origin', isActive: true },
        { id: 'u-m2', isActive: true },
        { id: 'u-lead', isActive: true },
        { id: 'u-webmgr', isActive: false },
        { id: 'u-engmgr', isActive: false },
        { id: 'u-sib', isActive: true },
      ],
    })
    const plan = await buildNormalApprovalInstance(db, buildInput)
    assert.equal(plan.state, 'PENDING')
    assert.equal(plan.steps.some((step) => step.requiredPositionId === 'p-staff'), false)
    assert.equal(plan.skipped.some((skip) => skip.requiredPositionId === 'p-staff'), false)
    assert.deepEqual(plan.skipped, [{ requiredPositionId: 'p-mgr', reason: 'VACANT_POSITION' }])
    assert.deepEqual(plan.steps.map((step) => step.requiredPositionId), ['p-lead'])
    assert.deepEqual([...plan.steps[0].candidateUserIds], ['u-m2', 'u-lead'])
  })

  it('4. all remaining steps vacant → COMPLETED_NO_ELIGIBLE_STEPS + NO_ELIGIBLE_APPROVAL_STEPS', async () => {
    const db = createFakeDb({
      accounts: [
        { id: 'u-origin', isActive: true },
        { id: 'u-m1', isActive: true },
        { id: 'u-m2', isActive: false },
        { id: 'u-lead', isActive: false },
        { id: 'u-webmgr', isActive: false },
        { id: 'u-engmgr', isActive: false },
        { id: 'u-sib', isActive: true },
      ],
    })
    const plan = await buildNormalApprovalInstance(db, buildInput)
    assert.equal(plan.state, 'COMPLETED_NO_ELIGIBLE_STEPS')
    assert.equal(plan.completionReason, 'NO_ELIGIBLE_APPROVAL_STEPS')
    assert.deepEqual(plan.steps, [])
    assert.deepEqual(plan.skipped, [
      { requiredPositionId: 'p-lead', reason: 'VACANT_POSITION' },
      { requiredPositionId: 'p-mgr', reason: 'VACANT_POSITION' },
    ])
    assert.equal(plan.skipped.some((skip) => skip.requiredPositionId === 'p-staff'), false)
  })

  it('5. inactive candidates excluded; all-inactive group = VACANT; no silent replacement', async () => {
    const db = createFakeDb({
      accounts: [
        { id: 'u-origin', isActive: true },
        { id: 'u-m2', isActive: false },
        { id: 'u-lead', isActive: false },
        { id: 'u-webmgr', isActive: true },
        { id: 'u-engmgr', isActive: false },
        { id: 'u-sib', isActive: true },
      ],
    })
    const plan = await buildNormalApprovalInstance(db, buildInput)
    assert.deepEqual(plan.skipped, [{ requiredPositionId: 'p-lead', reason: 'VACANT_POSITION' }])
    assert.deepEqual(plan.steps.map((step) => step.requiredPositionId), ['p-mgr'])
    assert.deepEqual([...plan.steps[0].candidateUserIds], ['u-webmgr'])
    assert.equal(plan.steps[0].candidateUserIds.includes('u-engmgr'), false)
    assert.equal(plan.steps.some((step) => step.candidateUserIds.includes('u-sib')), false)
    assert.equal(plan.steps.some((step) => step.candidateUserIds.includes('u-origin')), false)
  })

  it('6. team-member origin option A end-to-end: own-team ∪ path, deduped, no sibling ids', async () => {
    const extraFixtures: readonly AssignmentNode[] = [siblingLead]
    const db = createFakeDb({
      path: teamPath,
      ownTeam: ownTeamMemberAssignments,
    })
    const plan = await buildNormalApprovalInstance(db, buildInput)
    assert.equal(extraFixtures.length, 1)
    assert.deepEqual(db.ownTeamCalls, ['t-web'])
    assert.equal(db.ownTeamCalls.includes('t-other'), false)
    assert.equal(plan.state, 'PENDING')
    const lead = plan.steps.find((step) => step.requiredPositionId === 'p-lead')
    const mgr = plan.steps.find((step) => step.requiredPositionId === 'p-mgr')
    assert.ok(lead)
    assert.ok(mgr)
    assert.deepEqual([...lead.candidateUserIds], ['u-m2', 'u-lead'])
    assert.deepEqual([...mgr.candidateUserIds], ['u-webmgr', 'u-engmgr'])
    assert.equal(plan.steps.some((step) => step.candidateUserIds.includes('u-sib')), false)
    assert.equal(plan.steps.some((step) => step.candidateUserIds.includes('u-origin')), false)
    assert.equal(plan.steps.some((step) => step.requiredPositionId === 'p-staff'), false)
    assert.equal(plan.skipped.some((skip) => skip.requiredPositionId === 'p-staff'), false)
    assert.equal(lead.scopeUnitId, 'web')
    assert.equal(mgr.scopeUnitId, 'web')
  })

  it('6b. ungrouped origin loads [] own-team (never sibling) and uses path persons only', async () => {
    const ungrouped: ReportingPath = {
      ...teamPath,
      teamId: null,
      steps: teamPath.steps.filter((step) => step.kind === 'UNIT_MANAGER'),
    }
    const db = createFakeDb({ path: ungrouped, ownTeam: ownTeamMemberAssignments })
    const plan = await buildNormalApprovalInstance(db, buildInput)
    assert.deepEqual(db.ownTeamCalls, [])
    const lead = plan.steps.find((step) => step.requiredPositionId === 'p-lead')
    const mgr = plan.steps.find((step) => step.requiredPositionId === 'p-mgr')
    assert.equal(lead, undefined)
    assert.deepEqual(plan.skipped, [{ requiredPositionId: 'p-lead', reason: 'VACANT_POSITION' }])
    assert.ok(mgr)
    assert.deepEqual([...mgr.candidateUserIds], ['u-webmgr', 'u-engmgr'])
    assert.equal(plan.steps.some((step) => step.candidateUserIds.includes('u-m2')), false)
  })

  it('7. persist fake: one group per step with copied labels, skip rows, attempt increment, restart provenance', async () => {
    const db = createFakeDb({
      accounts: [
        { id: 'u-origin', isActive: true },
        { id: 'u-m2', isActive: true },
        { id: 'u-lead', isActive: true },
        { id: 'u-webmgr', isActive: false },
        { id: 'u-engmgr', isActive: false },
      ],
    })
    const plan = await buildNormalApprovalInstance(db, buildInput)
    assert.equal(plan.state, 'PENDING')
    const tx = createFakeTx({ priorAttempts: [1, 2] })
    const first = await persistApprovalInstance(tx, plan)
    assert.equal(first.id, 'inst-3')
    assert.equal(first.attempt, 3)
    assert.equal(tx.instances.length, 3)
    const instance = tx.instances[2]
    assert.equal(instance.originAssignmentId, 'a-origin')
    assert.equal(instance.originPositionId, 'p-staff')
    assert.equal(instance.routingMode, 'SNAPSHOT_GROUP')
    assert.equal(instance.state, 'PENDING')
    assert.equal(instance.requestId, 'req-1')
    assert.equal(instance.routeVersionId, 'rv-1')
    assert.equal('originContext' in instance, false)
    assert.equal('restartOfInstanceId' in instance, false)
    assert.equal(tx.groups.length, 1)
    assert.equal(tx.groups[0].requiredPositionId, 'p-lead')
    assert.equal('requiredPosition' in tx.groups[0], false)
    assert.deepEqual(
      tx.members.map((member) => `${member.userId}:${member.capturedDisplayName}`),
      ['u-m2:Member Two', 'u-lead:Lead Person'],
    )
    assert.deepEqual(tx.skips, [{
      approvalInstanceId: first.id,
      requiredPositionId: 'p-mgr',
      reason: 'VACANT_POSITION',
    }])
    assert.equal(tx.requestApprovals.length, 1)
    assert.equal(tx.requestApprovals[0].routingMode, 'SNAPSHOT_GROUP')
    assert.equal(tx.requestApprovals[0].requiredPositionId, 'p-lead')
    assert.equal(tx.requestApprovals[0].candidateGroupId, tx.groups[0].id)
    assert.equal(tx.requestApprovals[0].instanceId, first.id)
    assert.equal(tx.requestApprovals[0].order, 2)
    assert.equal('integrityVersion' in tx.requestApprovals[0], false)
    assert.equal('requiredLevel' in tx.requestApprovals[0], false)
    assert.equal('isCustomChain' in tx.requestApprovals[0], false)
    assert.equal('isFinalApproval' in tx.requestApprovals[0], false)
    assert.equal('requiredPosition' in tx.requestApprovals[0], false)

    const second = await persistApprovalInstance(tx, plan)
    assert.equal(second.attempt, 4)

    const restartPlan: ApprovalInstancePlan = {
      ...plan,
      restartOfInstanceId: first.id,
      restartReason: 'stranded inactive candidates',
      restartedById: 'u-admin',
    }
    const restarted = await persistApprovalInstance(tx, restartPlan)
    const restartRow = tx.instances.find((row) => row.id === restarted.id)
    assert.ok(restartRow)
    assert.equal(restartRow.restartOfInstanceId, first.id)
    assert.equal(restartRow.restartReason, 'stranded inactive candidates')
    assert.equal(restartRow.restartedById, 'u-admin')
    assert.equal(restarted.attempt, 5)
  })

  it('7b. AUTO_APPROVED persist writes a group-less approved self row', async () => {
    const db = createFakeDb({ path: { ...teamPath, positionId: 'p-dir' } })
    const plan = await buildNormalApprovalInstance(db, buildInput)
    const tx = createFakeTx({})
    const persisted = await persistApprovalInstance(tx, plan)
    assert.equal(persisted.state, 'AUTO_APPROVED')
    assert.equal(tx.groups.length, 0)
    assert.equal(tx.members.length, 0)
    assert.equal(tx.skips.length, 0)
    assert.equal(tx.requestApprovals.length, 1)
    const selfRow = tx.requestApprovals[0]
    assert.equal(selfRow.routingMode, 'SNAPSHOT_GROUP')
    assert.equal(selfRow.status, 'approved')
    assert.equal(selfRow.approverId, 'u-origin')
    assert.equal(selfRow.instanceId, persisted.id)
    assert.equal('candidateGroupId' in selfRow, false)
    assert.equal('requiredPositionId' in selfRow, false)
    assert.equal('requiredPosition' in selfRow, false)
    assert.equal(tx.instances[0].originPositionId, 'p-dir')
    assert.equal('originContext' in tx.instances[0], false)
  })

  it('missing origin position rank fails closed with ApprovalEnginePlanError', async () => {
    const db = createFakeDb({
      path: { ...teamPath, positionId: 'p-missing' },
    })
    await assert.rejects(
      () => buildNormalApprovalInstance(db, buildInput),
      (error: unknown) =>
        error instanceof ApprovalEnginePlanError
        && error.code === 'APPROVAL_ENGINE_PLAN',
    )
  })

  it('serialization conflict surfaces as ApprovalEngineConflictError with no retry', async () => {
    const db = createFakeDb({})
    const plan = await buildNormalApprovalInstance(db, buildInput)
    const tx = createFakeTx({ conflictCode: 'P2034' })
    await assert.rejects(
      () => persistApprovalInstance(tx, plan),
      (error: unknown) =>
        error instanceof ApprovalEngineConflictError
        && error.code === 'APPROVAL_ENGINE_CONFLICT',
    )
    assert.equal(tx.createCalls, 1)
    assert.equal(tx.groups.length, 0)
  })

  it('plans are deep-frozen and candidate ids are copied', async () => {
    const db = createFakeDb({})
    const plan = await buildNormalApprovalInstance(db, buildInput)
    assert.equal(Object.isFrozen(plan), true)
    assert.equal(Object.isFrozen(plan.steps), true)
    assert.equal(Object.isFrozen(plan.steps[0]), true)
    assert.equal(Object.isFrozen(plan.steps[0].candidateUserIds), true)
    assert.equal(Object.isFrozen(plan.originContext), true)
    assert.equal(Object.isFrozen(plan.originContext.unitPath), true)
    const frozenIds = plan.steps[0].candidateUserIds as string[]
    assert.throws(() => { frozenIds.push('u-injected') })
    assert.equal(plan.steps[0].candidateUserIds.includes('u-injected'), false)
  })

  it('source contract: isolation Serializable; no Prisma; no legacy engine; uses B3 selectStepCandidates', () => {
    assert.equal(APPROVAL_ENGINE_TRANSACTION_ISOLATION, 'Serializable')
    const src = readFileSync('src/lib/approval-engine/plan.ts', 'utf8')
    assert.match(src, /selectStepCandidates/)
    assert.match(src, /from ['"]@\/lib\/approval-routes\/definition['"]/)
    assert.doesNotMatch(src, /@prisma\/client/)
    assert.doesNotMatch(src, /OrganizationPositionCode/)
    assert.doesNotMatch(src, /ApprovalRouteConfigurationError/)
    assert.doesNotMatch(src, /from ['"]@\/lib\/approval-engine\/(legacy|transactions|instances|candidate-groups|phase-adapters|phase-origin|types)['"]/)
    assert.doesNotMatch(src, /from ['"]\.\/(legacy|transactions|instances|candidate-groups|phase-adapters|phase-origin|types)['"]/)
    assert.doesNotMatch(src, /integrityVersion/)
    assert.doesNotMatch(src, /isCustomChain/)
    assert.doesNotMatch(src, /isFinalApproval/)
  })
})
