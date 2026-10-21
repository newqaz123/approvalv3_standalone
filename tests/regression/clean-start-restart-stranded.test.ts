// Clean-start admin-only stranded-attempt restart (Plan B Task 7).
// In-memory fakes only: NO Prisma, NO database, NO env, NO schema/server ops.
// Restart is admin-only with a required trimmed reason. Old attempt/decisions
// stay intact except supersededAt. New attempt comes from CURRENT org
// settings via B4/B6 (attempt+1, restart provenance). Restart grants no
// approval. previewReplacementChain is read-only.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  previewReplacementChain,
  restartStrandedAttempt,
  type PhaseAttemptTx,
  type RestartAttemptRecord,
  type RestartStrandedPorts,
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

const originPath: ReportingPath = {
  originUserId: 'u-origin',
  assignmentId: 'a-origin',
  unitId: 'web',
  positionId: 'p-staff',
  teamId: 't-web',
  unitPath: ['web', 'eng', 'company'],
  steps: [
    { kind: 'TEAM_REPORTS_TO', unitId: 'web', assignmentId: 'a-lead', userId: 'u-lead', positionId: 'p-lead' },
    { kind: 'UNIT_MANAGER', unitId: 'web', assignmentId: 'a-webmgr', userId: 'u-webmgr', positionId: 'p-mgr' },
  ],
}

const ownTeam: readonly AssignmentNode[] = [
  { id: 'a-m2', userId: 'u-m2', unitId: 'web', positionId: 'p-lead', teamId: 't-web', isActive: true },
]

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

const origin: PhaseOrigin = {
  phase: 'REQUEST',
  originUserId: 'u-origin',
  originUnitId: 'web',
  path: originPath,
  requestId: 'req-1',
  source: 'REQUESTER',
}

type RecordedTx = PhaseAttemptTx & {
  instances: Array<Record<string, unknown>>
  instanceUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }>
  groups: Array<Record<string, unknown>>
  members: Array<Record<string, unknown>>
  requestApprovals: Array<Record<string, unknown>>
  activities: Array<Record<string, unknown>>
  users: Map<string, { name: string; isActive: boolean }>
  writes: number
}

function createRestartHarness(input: {
  adminId?: string | null
  stranded?: boolean
}): RestartStrandedPorts & { tx: RecordedTx } {
  const instances: Array<Record<string, unknown>> = []
  const instanceUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = []
  const groups: Array<Record<string, unknown>> = []
  const members: Array<Record<string, unknown>> = []
  const requestApprovals: Array<Record<string, unknown>> = []
  const activities: Array<Record<string, unknown>> = []
  const users = new Map<string, { name: string; isActive: boolean }>([
    ['u-origin', { name: 'Origin', isActive: true }],
    ['u-lead', { name: 'Current Lead', isActive: true }],
    ['u-m2', { name: 'Member Two', isActive: true }],
    ['u-webmgr', { name: 'Web Manager', isActive: false }],
    ['u-old-lead', { name: 'Old Lead', isActive: input.stranded === false }],
    ['u-admin', { name: 'Admin', isActive: true }],
  ])
  if (input.stranded !== false) users.set('u-old-lead', { name: 'Old Lead', isActive: false })

  const tx: RecordedTx = {
    instances,
    instanceUpdates,
    groups,
    members,
    requestApprovals,
    activities,
    users,
    writes: 0,
    async resolvePhaseOrigin() {
      return origin
    },
    async resolvePublishedRoute() {
      return publishedRoute
    },
    async loadPositions() {
      return positions
    },
    async loadOwnTeamActiveAssignments() {
      return [...ownTeam]
    },
    async findStepCandidates() {
      return [...users.entries()].map(([id, user]) => ({ id, isActive: user.isActive }))
    },
    user: {
      async findMany(args) {
        const wanted = new Set(args.where.id.in)
        return [...users.entries()]
          .filter(([id]) => wanted.has(id))
          .map(([id, user]) => ({ id, name: user.name }))
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
        tx.writes += 1
        const id = `inst-${instances.length + 1}`
        const row = { ...args.data, id }
        instances.push(row)
        return { id }
      },
      async update(args) {
        tx.writes += 1
        instanceUpdates.push({ where: { ...args.where }, data: { ...args.data } })
        const row = instances.find((instance) => instance.id === args.where.id)
        if (row) Object.assign(row, args.data)
        return {}
      },
    },
    approval_instance_skips: {
      async create(args) {
        tx.writes += 1
        return args.data
      },
    },
    approval_candidate_groups: {
      async create(args) {
        tx.writes += 1
        const id = `grp-${groups.length + 1}`
        groups.push({ ...args.data, id })
        return { id }
      },
    },
    approval_candidate_group_members: {
      async create(args) {
        tx.writes += 1
        members.push({ ...args.data })
        return {}
      },
    },
    request_approvals: {
      async create(args) {
        tx.writes += 1
        requestApprovals.push({ ...args.data })
        return {}
      },
    },
    solution_approvals: {
      async create(args) {
        tx.writes += 1
        return args.data
      },
    },
  }

  instances.push({
    id: 'inst-old',
    phase: 'REQUEST',
    requestId: 'req-1',
    solutionId: null,
    originUserId: 'u-origin',
    attempt: 1,
    state: 'PENDING',
    supersededAt: null,
    routingMode: 'SNAPSHOT_GROUP',
  })
  groups.push({
    id: 'grp-old',
    approvalInstanceId: 'inst-old',
    requiredPositionId: 'p-lead',
    scopeUnitId: 'web',
  })
  members.push({
    candidateGroupId: 'grp-old',
    userId: 'u-old-lead',
    capturedDisplayName: 'Old Lead',
  })
  requestApprovals.push({
    id: 'dec-old',
    instanceId: 'inst-old',
    requestId: 'req-1',
    order: 2,
    status: 'pending',
    comments: 'leave me',
    approverId: null,
    routingMode: 'SNAPSHOT_GROUP',
    requiredPositionId: 'p-lead',
    candidateGroupId: 'grp-old',
  })

  function snapshotFor(instanceId: string): RestartAttemptRecord | null {
    const row = instances.find((instance) => instance.id === instanceId)
    if (!row) return null
    const instanceGroups = groups.filter((group) => group.approvalInstanceId === instanceId)
    return {
      id: String(row.id),
      phase: row.phase as RestartAttemptRecord['phase'],
      requestId: (row.requestId as string | null) ?? null,
      solutionId: (row.solutionId as string | null) ?? null,
      originUserId: String(row.originUserId),
      attempt: Number(row.attempt),
      state: String(row.state),
      supersededAt: (row.supersededAt as Date | null) ?? null,
      candidateGroups: instanceGroups.map((group) => ({
        members: members
          .filter((member) => member.candidateGroupId === group.id)
          .map((member) => {
            const userId = String(member.userId)
            const user = users.get(userId)
            return { userId, user: { isActive: user?.isActive === true } }
          }),
      })),
    }
  }

  const ports: RestartStrandedPorts & { tx: RecordedTx } = {
    tx,
    async requireAdmin() {
      return input.adminId === undefined ? 'u-admin' : input.adminId
    },
    async loadAttemptForRestart(instanceId) {
      return snapshotFor(instanceId)
    },
    attemptTx: tx,
    request_activities: {
      async create(args) {
        tx.writes += 1
        activities.push({ ...args.data })
        return {}
      },
    },
  }
  return ports
}

describe('restartStrandedAttempt authorization and guards', () => {
  it('rejects a non-admin without writing', async () => {
    const ports = createRestartHarness({ adminId: null, stranded: true })
    await assert.rejects(
      () => restartStrandedAttempt(ports, { instanceId: 'inst-old', reason: 'all inactive' }),
      /admin|unauthorized/i,
    )
    assert.equal(ports.tx.instanceUpdates.length, 0)
    assert.equal(ports.tx.activities.length, 0)
    assert.equal(ports.tx.instances.length, 1)
  })

  it('rejects an empty or whitespace reason without writing', async () => {
    const ports = createRestartHarness({ stranded: true })
    await assert.rejects(
      () => restartStrandedAttempt(ports, { instanceId: 'inst-old', reason: '' }),
      /reason/i,
    )
    await assert.rejects(
      () => restartStrandedAttempt(ports, { instanceId: 'inst-old', reason: '   ' }),
      /reason/i,
    )
    assert.equal(ports.tx.instanceUpdates.length, 0)
    assert.equal(ports.tx.activities.length, 0)
    assert.equal(ports.tx.instances.length, 1)
  })

  it('rejects a non-stranded attempt without writing', async () => {
    const ports = createRestartHarness({ stranded: false })
    await assert.rejects(
      () => restartStrandedAttempt(ports, { instanceId: 'inst-old', reason: 'not actually stranded' }),
      /stranded/i,
    )
    assert.equal(ports.tx.instanceUpdates.length, 0)
    assert.equal(ports.tx.instances.length, 1)
    assert.equal(ports.tx.requestApprovals[0]?.status, 'pending')
    assert.equal(ports.tx.requestApprovals[0]?.comments, 'leave me')
  })
})

describe('restartStrandedAttempt preserves history and provenance', () => {
  it('supersedes the old stranded attempt, keeps decisions, and starts attempt+1 with restart provenance; grants no approval', async () => {
    const ports = createRestartHarness({ stranded: true })
    const beforeDecisions = ports.tx.requestApprovals.map((row) => ({ ...row }))
    const result = await restartStrandedAttempt(ports, { instanceId: 'inst-old', reason: '  all saved approvers inactive  ' })
    assert.equal(result.oldInstanceId, 'inst-old')
    assert.ok(result.newInstanceId)
    assert.notEqual(result.newInstanceId, 'inst-old')

    const old = ports.tx.instances.find((row) => row.id === 'inst-old')
    assert.ok(old)
    assert.ok(old.supersededAt instanceof Date)
    assert.equal(old.state, 'PENDING')
    assert.deepEqual(ports.tx.instanceUpdates.map((update) => Object.keys(update.data)), [['supersededAt']])
    assert.equal(ports.tx.instanceUpdates[0]?.where.id, 'inst-old')

    const oldDecisions = ports.tx.requestApprovals.filter((row) => row.instanceId === 'inst-old')
    assert.deepEqual(oldDecisions, beforeDecisions)
    assert.equal(oldDecisions[0]?.status, 'pending')
    assert.equal(oldDecisions[0]?.comments, 'leave me')
    assert.equal(oldDecisions[0]?.approverId, null)

    const created = ports.tx.instances.find((row) => row.id === result.newInstanceId)
    assert.ok(created)
    assert.equal(created.attempt, 2)
    assert.equal(created.restartOfInstanceId, 'inst-old')
    assert.equal(created.restartReason, 'all saved approvers inactive')
    assert.equal(created.restartedById, 'u-admin')
    assert.equal(created.supersededAt, undefined)

    const newDecisions = ports.tx.requestApprovals.filter((row) => row.instanceId === result.newInstanceId)
    assert.ok(newDecisions.length > 0)
    assert.ok(newDecisions.every((row) => row.status === 'pending'))
    assert.ok(newDecisions.every((row) => row.approverId == null))

    assert.equal(ports.tx.activities.length, 1)
    assert.equal(ports.tx.activities[0]?.requestId, 'req-1')
    assert.equal(ports.tx.activities[0]?.userId, 'u-admin')
    assert.match(String(ports.tx.activities[0]?.action), /restart/)
    assert.equal(ports.tx.activities[0]?.comments, 'all saved approvers inactive')
  })

  it('chains a second restart at attempt+2 off the new current instance', async () => {
    const ports = createRestartHarness({ stranded: true })
    const first = await restartStrandedAttempt(ports, { instanceId: 'inst-old', reason: 'first restart' })
    const firstNew = ports.tx.instances.find((row) => row.id === first.newInstanceId)
    assert.equal(firstNew?.attempt, 2)

    for (const [id, user] of ports.tx.users) {
      if (id === 'u-admin' || id === 'u-origin') continue
      ports.tx.users.set(id, { ...user, isActive: false })
    }

    const second = await restartStrandedAttempt(ports, { instanceId: first.newInstanceId, reason: 'second restart' })
    assert.equal(second.oldInstanceId, first.newInstanceId)
    assert.notEqual(second.newInstanceId, first.newInstanceId)
    const secondOld = ports.tx.instances.find((row) => row.id === first.newInstanceId)
    const secondNew = ports.tx.instances.find((row) => row.id === second.newInstanceId)
    assert.ok(secondOld?.supersededAt instanceof Date)
    assert.equal(secondNew?.attempt, 3)
    assert.equal(secondNew?.restartOfInstanceId, first.newInstanceId)
    assert.equal(secondNew?.restartReason, 'second restart')
    assert.equal(secondNew?.restartedById, 'u-admin')
    const original = ports.tx.instances.find((row) => row.id === 'inst-old')
    assert.equal(original?.attempt, 1)
    assert.ok(original?.supersededAt instanceof Date)
  })
})

describe('previewReplacementChain', () => {
  it('is read-only and describes the current-settings replacement chain', async () => {
    const ports = createRestartHarness({ stranded: true })
    const writesBefore = ports.tx.writes
    const preview = await previewReplacementChain(ports, { instanceId: 'inst-old' })
    assert.equal(ports.tx.writes, writesBefore)
    assert.equal(ports.tx.instanceUpdates.length, 0)
    assert.equal(ports.tx.instances.length, 1)
    assert.equal(preview.phase, 'REQUEST')
    assert.equal(preview.scopeUnitId, 'web')
    assert.equal(preview.routeVersionId, 'rv-1')
    assert.equal(preview.autoApproved, false)
    assert.ok(preview.steps.some((step) => step.requiredPositionId === 'p-lead' && step.skipped === false))
    const lead = preview.steps.find((step) => step.requiredPositionId === 'p-lead' && !step.skipped)
    assert.ok(lead)
    assert.ok(lead.candidates.some((candidate) => candidate.id === 'u-m2' || candidate.id === 'u-lead'))
  })
})

describe('B7 source contract', () => {
  it('attempts.ts remains Prisma-free and does not invent OrganizationPositionCode', () => {
    const source = readFileSync('src/lib/approval-engine/attempts.ts', 'utf8')
    assert.doesNotMatch(source, /@prisma\/client/)
    assert.doesNotMatch(source, /OrganizationPositionCode/)
    assert.match(source, /export async function previewReplacementChain/)
    assert.match(source, /export async function restartStrandedAttempt/)
    assert.match(source, /isAttemptStranded/)
    assert.match(source, /buildNormalApprovalInstance/)
    assert.match(source, /persistApprovalInstance/)
  })

  it('approvals.ts adds the exact APIs behind requireAdmin and does not rewire approve/reject', () => {
    const source = readFileSync('src/server-actions/approvals.ts', 'utf8')
    assert.match(source, /export async function previewReplacementChain\(input: \{ instanceId: string \}\)/)
    assert.match(
      source,
      /export async function restartStrandedAttempt\(input: \{ instanceId: string; reason: string \}\)/,
    )
    assert.match(source, /requireAdmin/)
    assert.doesNotMatch(source, /OrganizationPositionCode/)
    const approveStart = source.indexOf('export async function approveRequest')
    const rejectStart = source.indexOf('export async function rejectRequest')
    const canStart = source.indexOf('export async function canUserApprove')
    assert.ok(approveStart >= 0 && rejectStart >= 0 && canStart >= 0)
    const approveBody = source.slice(approveStart, rejectStart)
    const rejectBody = source.slice(rejectStart, source.indexOf('async function notifyRequestStatusChange'))
    const canBody = source.slice(canStart, approveStart)
    assert.match(source, /from '@\/lib\/approval-engine\/transaction-adapter'/)
    assert.match(canBody, /canUserApproveRequest/)
    assert.match(approveBody, /advanceApprovalAtomically/)
    assert.match(rejectBody, /markCurrentInstanceOutcome/)
  })
})
