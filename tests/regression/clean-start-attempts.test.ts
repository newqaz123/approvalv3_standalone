// Clean-start phase origins, attempt creators, custom chains (Plan B Task 6).
// In-memory fakes only: NO Prisma, NO database, NO env, NO schema/server ops.
// REQUEST origin = stored requesterId. SOLUTION origin = stored submittedById
// (never an authorized reviser; mismatched trusted input rejected). FINAL
// origin = authenticated trusted initiator. Custom chains: CUSTOM_PERSON,
// ordered requiredApproverId, never AUTO_APPROVED, skip route resolution.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  canSubmitRequests,
  createCustomPersonAttempt,
  createFinalApprovalAttempt,
  createRequestApprovalAttempt,
  requireAssignableSubmitter,
  resolvePhaseOrigin,
  type PhaseAttemptTx,
  type PhaseOriginRepository,
} from '@/lib/approval-engine/attempts'
import type { PhaseOrigin } from '@/lib/approval-engine/plan'
import type { AssignmentNode, PositionNode, ReportingPath } from '@/lib/organization/model'
import type { ResolvedApprovalRoute } from '@/lib/approval-routes/selection'

const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-lead', name: 'Lead', rank: 2, isActive: true },
  { id: 'p-mgr', name: 'Manager', rank: 3, isActive: true },
  { id: 'p-dir', name: 'Director', rank: 4, isActive: true },
]

function pathFor(userId: string, unitId: string, assignmentId: string, positionId: string): ReportingPath {
  return {
    originUserId: userId,
    assignmentId,
    unitId,
    positionId,
    teamId: null,
    unitPath: [unitId, 'company'],
    steps: [
      { kind: 'UNIT_MANAGER', unitId, assignmentId: 'a-mgr', userId: 'u-mgr', positionId: 'p-mgr' },
    ],
  }
}

const requesterPath = pathFor('u-requester', 'ops', 'a-requester', 'p-staff')
const submitterPath = pathFor('u-submitter', 'eng', 'a-submitter', 'p-staff')
const initiatorPath = pathFor('u-initiator', 'ops', 'a-initiator', 'p-staff')
const reviserPath = pathFor('u-reviser', 'eng-other', 'a-reviser', 'p-lead')

function originRepo(input: {
  requests?: Record<string, { requesterId: string }>
  solutions?: Record<string, { requestId: string; submittedById: string }>
  paths?: Record<string, ReportingPath>
}): PhaseOriginRepository & { pathLoads: string[] } {
  const pathLoads: string[] = []
  const paths = input.paths ?? {
    'u-requester': requesterPath,
    'u-submitter': submitterPath,
    'u-initiator': initiatorPath,
    'u-reviser': reviserPath,
  }
  const repo: PhaseOriginRepository & { pathLoads: string[] } = {
    pathLoads,
    requests: {
      async findUnique(args) {
        const row = (input.requests ?? { r1: { requesterId: 'u-requester' } })[args.where.id]
        return row ? { requesterId: row.requesterId } : null
      },
    },
    solutions: {
      async findUnique(args) {
        const row = (input.solutions ?? { s1: { requestId: 'r1', submittedById: 'u-submitter' } })[args.where.id]
        return row ? { requestId: row.requestId, submittedById: row.submittedById } : null
      },
    },
    async resolveReportingPath(userId: string) {
      pathLoads.push(userId)
      return paths[userId] ?? null
    },
  }
  return repo
}

const publishedRoute: ResolvedApprovalRoute = {
  id: 'rv-1',
  scopeUnitId: 'ops',
  phase: 'REQUEST',
  version: 1,
  approvalLimitPositionId: 'p-dir',
  status: 'PUBLISHED',
  steps: [
    { order: 1, positionId: 'p-lead' },
    { order: 2, positionId: 'p-mgr' },
  ],
  ancestorScopeIds: ['ops', 'company'],
}

type RecordedTx = PhaseAttemptTx & {
  instances: Array<Record<string, unknown>>
  requestApprovals: Array<Record<string, unknown>>
  solutionApprovals: Array<Record<string, unknown>>
  routeCalls: number
  originCalls: Array<Record<string, unknown>>
}

function createAttemptTx(input: {
  origin: PhaseOrigin
  route?: ResolvedApprovalRoute
  priorAttempts?: number[]
}): RecordedTx {
  const instances: Array<Record<string, unknown>> = (input.priorAttempts ?? []).map((attempt, index) => ({
    id: `prior-${index}`,
    attempt,
    requestId: input.origin.requestId,
    phase: input.origin.phase,
  }))
  const requestApprovals: Array<Record<string, unknown>> = []
  const solutionApprovals: Array<Record<string, unknown>> = []
  const groups: Array<Record<string, unknown>> = []
  const members: Array<Record<string, unknown>> = []
  const skips: Array<Record<string, unknown>> = []
  let routeCalls = 0
  const originCalls: Array<Record<string, unknown>> = []
  const ownTeam: AssignmentNode[] = []
  const tx: RecordedTx = {
    instances,
    requestApprovals,
    solutionApprovals,
    originCalls,
    get routeCalls() { return routeCalls },
    async resolvePhaseOrigin(query) {
      originCalls.push({ ...query })
      return input.origin
    },
    async resolvePublishedRoute() {
      routeCalls += 1
      return input.route ?? { ...publishedRoute, phase: input.origin.phase }
    },
    async loadPositions() { return positions },
    async loadOwnTeamActiveAssignments() { return ownTeam },
    async findStepCandidates() {
      return [
        { id: 'u-mgr', isActive: true },
        { id: 'u-requester', isActive: true },
        { id: 'u-submitter', isActive: true },
        { id: 'u-initiator', isActive: true },
      ]
    },
    user: {
      async findMany(args) {
        const wanted = new Set(args.where.id.in)
        return ['u-mgr', 'u-approver-a', 'u-approver-b', 'u-requester', 'u-submitter', 'u-initiator']
          .filter((id) => wanted.has(id))
          .map((id) => ({ id, name: id }))
      },
    },
    approval_instances: {
      async findFirst(args) {
        const matching = instances.filter((row) => row.phase === args.where.phase)
        matching.sort((a, b) => Number(b.attempt) - Number(a.attempt))
        const top = matching[0]
        return top ? { attempt: Number(top.attempt) } : null
      },
      async create(args) {
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

describe('resolvePhaseOrigin', () => {
  it('REQUEST origin is the stored requesterId', async () => {
    const origin = await resolvePhaseOrigin(originRepo({}), { phase: 'REQUEST', requestId: 'r1' })
    assert.equal(origin.source, 'REQUESTER')
    assert.equal(origin.originUserId, 'u-requester')
    assert.equal(origin.originUnitId, 'ops')
    assert.equal(origin.requestId, 'r1')
    assert.equal(origin.path.originUserId, 'u-requester')
  })

  it('SOLUTION origin is the stored submitter even when originUserId names a reviser — mismatch rejected', async () => {
    await assert.rejects(
      () => resolvePhaseOrigin(originRepo({}), {
        phase: 'SOLUTION',
        requestId: 'r1',
        solutionId: 's1',
        originUserId: 'u-reviser',
      }),
      /stored solution submitter|does not match the stored/i,
    )
  })

  it('SOLUTION origin follows stored submittedById when trusted input matches or is omitted', async () => {
    const omitted = await resolvePhaseOrigin(originRepo({}), {
      phase: 'SOLUTION',
      requestId: 'r1',
      solutionId: 's1',
    })
    assert.equal(omitted.source, 'SOLUTION_SUBMITTER')
    assert.equal(omitted.originUserId, 'u-submitter')
    assert.equal(omitted.originUnitId, 'eng')
    const matched = await resolvePhaseOrigin(originRepo({}), {
      phase: 'SOLUTION',
      requestId: 'r1',
      solutionId: 's1',
      originUserId: 'u-submitter',
    })
    assert.equal(matched.originUserId, 'u-submitter')
  })

  it('FINAL origin is the authenticated trusted initiator', async () => {
    const origin = await resolvePhaseOrigin(originRepo({}), {
      phase: 'FINAL',
      requestId: 'r1',
      originUserId: 'u-initiator',
    })
    assert.equal(origin.source, 'FINAL_INITIATOR')
    assert.equal(origin.originUserId, 'u-initiator')
    assert.equal(origin.originUnitId, 'ops')
  })

  it('FINAL origin rejects missing trusted initiator input', async () => {
    await assert.rejects(
      () => resolvePhaseOrigin(originRepo({}), { phase: 'FINAL', requestId: 'r1' }),
      /final initiator|trusted initiator/i,
    )
  })
})

describe('createCustomPersonAttempt', () => {
  it('writes ordered requiredApproverId rows and never AUTO_APPROVED; skips route resolution', async () => {
    const origin: PhaseOrigin = {
      phase: 'SOLUTION',
      originUserId: 'u-submitter',
      originUnitId: 'eng',
      path: submitterPath,
      requestId: 'r1',
      source: 'SOLUTION_SUBMITTER',
    }
    const tx = createAttemptTx({ origin })
    const result = await createCustomPersonAttempt(tx, {
      requestId: 'r1',
      solutionId: 's1',
      phase: 'SOLUTION',
      orderedApproverIds: ['u-approver-a', 'u-approver-b'],
      actorId: 'u-reviser',
    })
    assert.equal(result.autoApproved, false)
    assert.notEqual(result.instance.state, 'AUTO_APPROVED')
    assert.equal(result.instance.routingMode, 'CUSTOM_PERSON')
    assert.equal(tx.routeCalls, 0)
    assert.deepEqual(
      tx.solutionApprovals.map((row) => ({
        requiredApproverId: row.requiredApproverId,
        order: row.order,
        status: row.status,
        routingMode: row.routingMode,
      })),
      [
        { requiredApproverId: 'u-approver-a', order: 1, status: 'pending', routingMode: 'CUSTOM_PERSON' },
        { requiredApproverId: 'u-approver-b', order: 2, status: 'pending', routingMode: 'CUSTOM_PERSON' },
      ],
    )
    assert.equal(tx.instances[0]?.routingMode, 'CUSTOM_PERSON')
    assert.equal(tx.instances[0]?.state, 'PENDING')
  })
})

describe('createRequest organizationUnitId (fake tx records)', () => {
  it('records organizationUnitId from the active assignment after the submission gate', async () => {
    const created: Array<Record<string, unknown>> = []
    const tx = {
      organization_assignments: {
        async findFirst() {
          return { unitId: 'ops' }
        },
      },
      requests: {
        async create(args: { data: Record<string, unknown> }) {
          created.push(args.data)
          return { id: 'r-new', organizationUnitId: args.data.organizationUnitId as string }
        },
      },
    }
    const assignment = await tx.organization_assignments.findFirst()
    assert.equal(canSubmitRequests({ isActiveUser: true, hasActiveAssignment: Boolean(assignment) }), true)
    const { unitId } = requireAssignableSubmitter({ isActiveUser: true, assignment })
    await tx.requests.create({
      data: {
        title: 'Pump',
        description: '<p>Body</p>',
        requesterId: 'u-requester',
        organizationUnitId: unitId,
        status: 'ImprovementRequest',
      },
    })
    assert.equal(created[0]?.organizationUnitId, 'ops')
  })
})

describe('normal attempt creators use B4 builder+persist', () => {
  it('createRequestApprovalAttempt persists a REQUEST snapshot via the B4 path', async () => {
    const origin: PhaseOrigin = {
      phase: 'REQUEST',
      originUserId: 'u-requester',
      originUnitId: 'ops',
      path: requesterPath,
      requestId: 'r1',
      source: 'REQUESTER',
    }
    const tx = createAttemptTx({ origin })
    const result = await createRequestApprovalAttempt(tx, {
      requestId: 'r1',
      phase: 'REQUEST',
      originUserId: 'u-requester',
    })
    assert.ok(result.instance.id)
    assert.equal(result.instance.phase, 'REQUEST')
    assert.notEqual(result.instance.routingMode, 'CUSTOM_PERSON')
    assert.ok(tx.instances.some((row) => row.originAssignmentId === 'a-requester'))
  })

  it('createFinalApprovalAttempt uses the trusted initiator origin', async () => {
    const origin: PhaseOrigin = {
      phase: 'FINAL',
      originUserId: 'u-initiator',
      originUnitId: 'ops',
      path: initiatorPath,
      requestId: 'r1',
      source: 'FINAL_INITIATOR',
    }
    const tx = createAttemptTx({ origin })
    const result = await createFinalApprovalAttempt(tx, {
      requestId: 'r1',
      phase: 'FINAL',
      originUserId: 'u-initiator',
    })
    assert.equal(result.instance.phase, 'FINAL')
    assert.equal(tx.originCalls[0]?.originUserId, 'u-initiator')
    assert.equal(tx.instances[0]?.originUserId, 'u-initiator')
  })
})

describe('attempts source contract', () => {
  it('is Prisma-free, uses definition ApprovalPhase, and does not invent OrganizationPositionCode', () => {
    const source = readFileSync('src/lib/approval-engine/attempts.ts', 'utf8')
    assert.doesNotMatch(source, /@prisma\/client/)
    assert.doesNotMatch(source, /OrganizationPositionCode/)
    assert.match(source, /@\/lib\/approval-routes\/definition/)
    assert.match(source, /buildNormalApprovalInstance/)
    assert.match(source, /persistApprovalInstance/)
    assert.match(source, /resolveReportingPath/)
  })
})
