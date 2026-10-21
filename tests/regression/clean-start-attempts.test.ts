// Clean-start phase origins, attempt creators, custom chains (Plan B Task 6).
// In-memory fakes only: NO Prisma, NO database, NO env, NO schema/server ops.
// REQUEST origin = stored requesterId. SOLUTION origin = stored submittedById
// (never an authorized reviser; mismatched trusted input rejected). FINAL
// origin document = stored requester; skip rank = initiator. Custom chains: CUSTOM_PERSON,
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
import { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'
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
  instanceUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }>
  requestApprovals: Array<Record<string, unknown>>
  solutionApprovals: Array<Record<string, unknown>>
  routeCalls: number
  originCalls: Array<Record<string, unknown>>
}

function currentRejectionAuthorizesResubmit(
  instances: Array<Record<string, unknown>>,
  approvals: Array<Record<string, unknown>>,
): boolean {
  return approvals.some((approval) => {
    if (approval.status !== 'rejected' || approval.isFinalApproval) return false
    if (approval.instanceId == null) return true
    const instance = instances.find((row) => row.id === approval.instanceId)
    return instance != null && instance.supersededAt == null
  })
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
    supersededAt: null,
  }))
  const instanceUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = []
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
    instanceUpdates,
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
        const matching = instances.filter((row) => {
          if (args.where.phase !== undefined && row.phase !== args.where.phase) return false
          if (args.where.requestId !== undefined && row.requestId !== args.where.requestId) return false
          if (args.where.solutionId !== undefined && row.solutionId !== args.where.solutionId) return false
          if (Object.prototype.hasOwnProperty.call(args.where, 'supersededAt') && row.supersededAt != null) return false
          return true
        })
        matching.sort((a, b) => Number(b.attempt) - Number(a.attempt))
        const top = matching[0]
        if (!top) return null
        const result: { attempt?: number; id?: string } = {}
        if (args.select.attempt) result.attempt = Number(top.attempt)
        if (args.select.id) result.id = String(top.id)
        return result
      },
      async create(args) {
        const id = `inst-${instances.length + 1}`
        const row = { ...args.data, id }
        instances.push(row)
        return { id }
      },
      async update(args) {
        instanceUpdates.push({ where: { ...args.where }, data: { ...args.data } })
        const row = instances.find((instance) => instance.id === args.where.id)
        if (row) row.supersededAt = args.data.supersededAt
        return {}
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

  it('FINAL origin uses the requester chain and the initiator skip rank', async () => {
    const origin = await resolvePhaseOrigin(originRepo({}), {
      phase: 'FINAL',
      requestId: 'r1',
      originUserId: 'u-initiator',
    })
    assert.equal(origin.source, 'FINAL_INITIATOR')
    assert.equal(origin.originUserId, 'u-requester')
    assert.equal(origin.originUnitId, 'ops')
    assert.equal(origin.path.originUserId, 'u-requester')
  })

  it('FINAL origin rejects missing initiator input', async () => {
    await assert.rejects(
      () => resolvePhaseOrigin(originRepo({}), { phase: 'FINAL', requestId: 'r1' }),
      /initiator/i,
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

  it('custom FINAL: request rows explicitly carry isFinalApproval true, ordered ids, pending, CUSTOM_PERSON, instance phase FINAL', async () => {
    const origin: PhaseOrigin = {
      phase: 'FINAL',
      originUserId: 'u-requester',
      originUnitId: 'ops',
      path: requesterPath,
      requestId: 'r1',
      source: 'FINAL_INITIATOR',
    }
    const tx = createAttemptTx({ origin })
    await createCustomPersonAttempt(tx, {
      requestId: 'r1',
      phase: 'FINAL',
      orderedApproverIds: ['u-approver-b', 'u-approver-a'],
      actorId: 'u-initiator',
    })
    assert.equal(tx.requestApprovals.length, 2)
    assert.deepEqual(
      tx.requestApprovals.map((row) => ({
        requiredApproverId: row.requiredApproverId,
        order: row.order,
        status: row.status,
        routingMode: row.routingMode,
        isFinalApproval: row.isFinalApproval,
      })),
      [
        { requiredApproverId: 'u-approver-b', order: 1, status: 'pending', routingMode: 'CUSTOM_PERSON', isFinalApproval: true },
        { requiredApproverId: 'u-approver-a', order: 2, status: 'pending', routingMode: 'CUSTOM_PERSON', isFinalApproval: true },
      ],
    )
    assert.equal(tx.instances[0]?.phase, 'FINAL')
    assert.equal(tx.instances[0]?.routingMode, 'CUSTOM_PERSON')
    assert.equal(tx.instances[0]?.state, 'PENDING')
  })

  it('custom REQUEST: request rows carry isFinalApproval false (explicit request-phase classification)', async () => {
    const origin: PhaseOrigin = {
      phase: 'REQUEST',
      originUserId: 'u-requester',
      originUnitId: 'ops',
      path: requesterPath,
      requestId: 'r1',
      source: 'REQUESTER',
    }
    const tx = createAttemptTx({ origin })
    await createCustomPersonAttempt(tx, {
      requestId: 'r1',
      phase: 'REQUEST',
      orderedApproverIds: ['u-approver-a'],
      actorId: 'u-requester',
    })
    assert.equal(tx.requestApprovals.length, 1)
    assert.equal(tx.requestApprovals[0].isFinalApproval, false)
    assert.equal(tx.instances[0]?.phase, 'REQUEST')
  })

  it('custom SOLUTION: solution rows never receive the request-only isFinalApproval flag', async () => {
    const origin: PhaseOrigin = {
      phase: 'SOLUTION',
      originUserId: 'u-submitter',
      originUnitId: 'eng',
      path: submitterPath,
      requestId: 'r1',
      source: 'SOLUTION_SUBMITTER',
    }
    const tx = createAttemptTx({ origin })
    await createCustomPersonAttempt(tx, {
      requestId: 'r1',
      solutionId: 's1',
      phase: 'SOLUTION',
      orderedApproverIds: ['u-approver-a'],
      actorId: 'u-submitter',
    })
    assert.equal(tx.solutionApprovals.length, 1)
    assert.equal(Object.prototype.hasOwnProperty.call(tx.solutionApprovals[0], 'isFinalApproval'), false)
    assert.equal(tx.requestApprovals.length, 0)
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

  it('createFinalApprovalAttempt persists the requester origin and queries the initiator', async () => {
    const origin: PhaseOrigin = {
      phase: 'FINAL',
      originUserId: 'u-requester',
      originUnitId: 'ops',
      path: requesterPath,
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
    assert.equal(tx.instances[0]?.originUserId, 'u-requester')
  })
})

describe('attempt creators supersede the prior current instance', () => {
  const requesterOrigin: PhaseOrigin = {
    phase: 'REQUEST',
    originUserId: 'u-requester',
    originUnitId: 'ops',
    path: requesterPath,
    requestId: 'r1',
    source: 'REQUESTER',
  }
  const submitterOrigin: PhaseOrigin = {
    phase: 'SOLUTION',
    originUserId: 'u-submitter',
    originUnitId: 'eng',
    path: submitterPath,
    requestId: 'r1',
    source: 'SOLUTION_SUBMITTER',
  }

  it('second createRequestApprovalAttempt writes only supersededAt on the prior current row; pending current attempt does not authorize resubmit', async () => {
    assert.deepEqual(CURRENT_INSTANCE_ROW_FILTER, [
      { instanceId: null },
      { instance: { supersededAt: null } },
    ])
    const tx = createAttemptTx({ origin: requesterOrigin })
    const first = await createRequestApprovalAttempt(tx, {
      requestId: 'r1',
      phase: 'REQUEST',
      originUserId: 'u-requester',
    })
    for (const row of tx.requestApprovals) {
      if (row.instanceId === first.instance.id) row.status = 'rejected'
    }
    assert.equal(currentRejectionAuthorizesResubmit(tx.instances, tx.requestApprovals), true)

    const second = await createRequestApprovalAttempt(tx, {
      requestId: 'r1',
      phase: 'REQUEST',
      originUserId: 'u-requester',
    })
    const prior = tx.instances.find((row) => row.id === first.instance.id)
    assert.ok(prior?.supersededAt instanceof Date)
    assert.deepEqual(tx.instanceUpdates.map((update) => Object.keys(update.data)), [['supersededAt']])
    assert.equal(tx.instanceUpdates[0]?.where.id, first.instance.id)
    const current = tx.instances.find((row) => row.id === second.instance.id)
    assert.equal(current?.supersededAt, undefined)
    assert.equal(tx.instances.filter((row) => row.supersededAt == null).length, 1)
    assert.equal(currentRejectionAuthorizesResubmit(tx.instances, tx.requestApprovals), false)
  })

  it('second createCustomPersonAttempt supersedes the prior current instance the same way', async () => {
    const tx = createAttemptTx({ origin: submitterOrigin })
    const first = await createCustomPersonAttempt(tx, {
      requestId: 'r1',
      solutionId: 's1',
      phase: 'SOLUTION',
      orderedApproverIds: ['u-approver-a'],
      actorId: 'u-submitter',
    })
    for (const row of tx.solutionApprovals) {
      if (row.instanceId === first.instance.id) row.status = 'rejected'
    }
    assert.equal(currentRejectionAuthorizesResubmit(tx.instances, tx.solutionApprovals), true)

    const second = await createCustomPersonAttempt(tx, {
      requestId: 'r1',
      solutionId: 's1',
      phase: 'SOLUTION',
      orderedApproverIds: ['u-approver-b'],
      actorId: 'u-submitter',
    })
    const prior = tx.instances.find((row) => row.id === first.instance.id)
    assert.ok(prior?.supersededAt instanceof Date)
    assert.deepEqual(Object.keys(tx.instanceUpdates[0]?.data ?? {}), ['supersededAt'])
    assert.equal(tx.instances.find((row) => row.id === second.instance.id)?.supersededAt, undefined)
    assert.equal(currentRejectionAuthorizesResubmit(tx.instances, tx.solutionApprovals), false)
  })
})

describe('resubmit statusChange source contract', () => {
  it('resubmitRequest applies attempt.statusChange like createRequest in the same transaction', () => {
    const source = readFileSync('src/server-actions/requests.ts', 'utf8')
    const start = source.indexOf('export async function resubmitRequest')
    assert.ok(start >= 0)
    const rest = source.slice(start)
    const next = rest.search(/\nexport async function /)
    const body = next === -1 ? rest : rest.slice(0, next)
    assert.match(body, /createRequestApprovalAttempt/)
    assert.match(body, /attempt\.statusChange/)
    assert.match(body, /updateRequestStatusExpecting[\s\S]*status:\s*attempt\.statusChange\.to/)
    assert.match(body, /action:\s*'status_changed'/)
  })

  it('resubmitSolution auto-approve branch persists status: attempt.statusChange.to', () => {
    const source = readFileSync('src/server-actions/solutions.ts', 'utf8')
    const start = source.indexOf('export async function resubmitSolution')
    assert.ok(start >= 0)
    const rest = source.slice(start)
    const next = rest.search(/\nexport async function /)
    const body = next === -1 ? rest : rest.slice(0, next)
    assert.match(
      body,
      /isAutoApproved && attempt\.statusChange[\s\S]*?data:\s*\{\s*projectEstimateCost:\s*validated\.cost,\s*status:\s*attempt\.statusChange\.to/,
    )
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
    assert.match(source, /supersededAt/)
  })
})
