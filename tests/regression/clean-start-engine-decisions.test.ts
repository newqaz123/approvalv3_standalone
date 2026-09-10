// Clean-start first-decision-wins decisions + stranded detection (Plan B Task 5).
// In-memory fakes only: NO Prisma, NO database, NO env, NO schema/server ops.
// Re-bases transaction/post-commit/conflict mechanics from
// request-approval-transaction.test.ts, approval-concurrency.test.ts, and
// organization-approval-baseline.test.ts. Permission-branch cases are named
// B10 clean-start-policy.test.ts coverage (transitional gap until B10).
// Cancellation remains request-cancellation-transition-guard.test.ts.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RequestStatusConflictError } from '@/lib/request-status-transition'
import {
  CURRENT_INSTANCE_ROW_FILTER,
  advanceApprovalTransaction,
  evaluateApprovalEligibility,
  isAttemptStranded,
  type ApprovalRowForTransaction,
  type ApprovalTransactionDb,
} from '@/lib/approval-engine/decisions'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'

type RequestStatus = ApprovalRowForTransaction['requestStatus']

type MutableRow = ApprovalRowForTransaction & { approverId?: string | null }

type InstanceRecord = {
  id: string
  state: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  supersededAt: Date | null
}

class FakeApprovalDb implements ApprovalTransactionDb {
  readonly approvals = new Map<string, MutableRow>()
  readonly users = new Map<string, boolean>()
  readonly activities: Array<{ approvalId: string; actorId: string; comments?: string }> = []
  readonly statusTransitions: Array<{ requestId: string; from: RequestStatus; to: RequestStatus }> = []
  instance: InstanceRecord
  requestStatus: RequestStatus
  afterLoad?: () => void
  forceUpdateCount?: number

  constructor(options: {
    rows: MutableRow[]
    requestStatus: RequestStatus
    instance?: Partial<InstanceRecord>
    activeUserIds?: readonly string[]
    inactiveUserIds?: readonly string[]
  }) {
    for (const row of options.rows) this.approvals.set(row.id, { ...row, candidateUserIds: [...row.candidateUserIds] })
    this.requestStatus = options.requestStatus
    this.instance = {
      id: options.instance?.id ?? options.rows[0]?.instanceId ?? 'inst-1',
      state: options.instance?.state ?? 'PENDING',
      supersededAt: options.instance?.supersededAt ?? null,
    }
    for (const id of options.activeUserIds ?? []) this.users.set(id, true)
    for (const id of options.inactiveUserIds ?? []) this.users.set(id, false)
  }

  statusTransitionCount(requestId: string): number {
    return this.statusTransitions.filter((t) => t.requestId === requestId).length
  }

  cancelRequest(): void {
    this.requestStatus = 'Cancelled'
    for (const row of this.approvals.values()) row.requestStatus = 'Cancelled'
  }

  async loadApprovalForUpdate(input: { approvalId: string; phase: ApprovalPhase }): Promise<ApprovalRowForTransaction | null> {
    void input.phase
    const row = this.approvals.get(input.approvalId)
    this.afterLoad?.()
    if (!row) return null
    return { ...row, requestStatus: this.requestStatus, instanceIsCurrent: this.instance.supersededAt == null }
  }

  async isActiveUser(userId: string): Promise<boolean> {
    return this.users.get(userId) === true
  }

  async hasEarlierPendingRow(input: {
    requestId: string
    solutionId: string | null
    instanceId: string | null
    phase: ApprovalPhase
    order: number
  }): Promise<boolean> {
    void input.phase
    for (const row of this.approvals.values()) {
      if (row.requestId !== input.requestId) continue
      if (row.solutionId !== input.solutionId) continue
      if (row.instanceId !== input.instanceId) continue
      if (row.status !== 'pending') continue
      if (row.order < input.order) return true
    }
    return false
  }

  async updatePendingApproval(input: {
    approvalId: string
    actorId: string
    phase: ApprovalPhase
    instanceId: string | null
    expectedRequestStatus: RequestStatus
    decision?: 'approved' | 'rejected'
  }): Promise<{ count: number }> {
    void input.phase
    if (this.forceUpdateCount !== undefined) return { count: this.forceUpdateCount }
    const row = this.approvals.get(input.approvalId)
    if (!row || row.status !== 'pending') return { count: 0 }
    if (row.instanceId !== input.instanceId) return { count: 0 }
    if (this.requestStatus !== input.expectedRequestStatus) return { count: 0 }
    row.status = input.decision === 'rejected' ? 'rejected' : 'approved'
    row.approverId = input.actorId
    return { count: 1 }
  }

  async recordApprovalActivity(input: { approvalId: string; actorId: string; comments?: string }): Promise<void> {
    this.activities.push({ ...input })
  }

  async countPendingApprovals(input: {
    requestId: string
    solutionId: string | null
    instanceId: string | null
    phase: ApprovalPhase
  }): Promise<number> {
    void input.phase
    let count = 0
    for (const row of this.approvals.values()) {
      if (row.requestId !== input.requestId) continue
      if (row.solutionId !== input.solutionId) continue
      if (row.instanceId !== input.instanceId) continue
      if (row.status === 'pending') count += 1
    }
    return count
  }

  async advanceRequestStatus(input: { requestId: string; from: RequestStatus; to: RequestStatus }): Promise<void> {
    if (this.requestStatus !== input.from) {
      throw new RequestStatusConflictError(
        `Cannot approve - it is no longer awaiting approvals (status: ${this.requestStatus}). Please refresh and try again.`,
      )
    }
    this.requestStatus = input.to
    for (const row of this.approvals.values()) {
      if (row.requestId === input.requestId) row.requestStatus = input.to
    }
    this.statusTransitions.push({ ...input })
  }

  async setInstanceOutcome(input: { instanceId: string; outcome: 'APPROVED' | 'REJECTED' | 'CANCELLED' }): Promise<void> {
    if (this.instance.id !== input.instanceId) return
    // SUPERSEDED / terminal states are never erased.
    if (this.instance.state !== 'PENDING' || this.instance.supersededAt != null) return
    this.instance.state = input.outcome
  }

  async closeRemainingPendingApprovals(input: {
    requestId: string
    solutionId: string | null
    instanceId: string | null
    phase: ApprovalPhase
  }): Promise<void> {
    void input.phase
    for (const row of this.approvals.values()) {
      if (row.requestId !== input.requestId) continue
      if (row.solutionId !== input.solutionId) continue
      if (row.instanceId !== input.instanceId) continue
      if (row.status === 'pending') row.status = 'rejected'
    }
  }
}

function snapshotRow(overrides: Partial<MutableRow> = {}): MutableRow {
  return {
    id: 'a1',
    requestId: 'r1',
    solutionId: null,
    instanceId: 'inst-1',
    requestStatus: 'ImprovementRequest',
    instanceIsCurrent: true,
    routingMode: 'SNAPSHOT_GROUP',
    candidateUserIds: ['u1', 'u2'],
    requiredApproverId: null,
    status: 'pending',
    order: 1,
    ...overrides,
  }
}

function snapshotDb(options: {
  rows?: MutableRow[]
  requestStatus?: RequestStatus
  instance?: Partial<InstanceRecord>
  activeUserIds?: readonly string[]
  inactiveUserIds?: readonly string[]
} = {}): FakeApprovalDb {
  const rows = options.rows ?? [snapshotRow()]
  return new FakeApprovalDb({
    rows,
    requestStatus: options.requestStatus ?? 'ImprovementRequest',
    instance: options.instance,
    activeUserIds: options.activeUserIds ?? ['u1', 'u2'],
    inactiveUserIds: options.inactiveUserIds ?? [],
  })
}

describe('clean-start first-decision-wins decisions', () => {
  it('concurrent first-wins: second advance throws RequestStatusConflictError', async () => {
    const db = snapshotDb()
    const first = await advanceApprovalTransaction(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST', comments: 'ok' })
    assert.equal(first.actualActorId, 'u1')
    assert.equal(first.routingMode, 'SNAPSHOT_GROUP')
    await assert.rejects(
      () => advanceApprovalTransaction(db, { approvalId: 'a1', actorId: 'u2', phase: 'REQUEST' }),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
    assert.equal(db.approvals.get('a1')?.status, 'approved')
    assert.equal(db.approvals.get('a1')?.approverId, 'u1')
    assert.equal(db.statusTransitionCount('r1'), 1)
  })

  it('0-row guarded update throws RequestStatusConflictError', async () => {
    const db = snapshotDb()
    db.forceUpdateCount = 0
    await assert.rejects(
      () => advanceApprovalTransaction(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST' }),
      (error: unknown) =>
        error instanceof RequestStatusConflictError
        && /no longer pending or was changed concurrently/i.test(error.message),
    )
    assert.equal(db.approvals.get('a1')?.status, 'pending')
    assert.equal(db.activities.length, 0)
    assert.equal(db.statusTransitionCount('r1'), 0)
  })

  it('out-of-order step decision is NOT_CURRENT_STEP', async () => {
    const db = snapshotDb({
      rows: [
        snapshotRow({ id: 'a1', order: 1 }),
        snapshotRow({ id: 'a2', order: 2, candidateUserIds: ['u3'] }),
      ],
      activeUserIds: ['u1', 'u2', 'u3'],
    })
    const eligibility = await evaluateApprovalEligibility(db, { approvalId: 'a2', actorId: 'u3', phase: 'REQUEST' })
    assert.equal(eligibility.canApprove, false)
    assert.equal(eligibility.reason, 'NOT_CURRENT_STEP')
    await assert.rejects(
      () => advanceApprovalTransaction(db, { approvalId: 'a2', actorId: 'u3', phase: 'REQUEST' }),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
    assert.equal(db.approvals.get('a1')?.status, 'pending')
    assert.equal(db.approvals.get('a2')?.status, 'pending')
  })

  it('inactive actor is INACTIVE_USER fail-closed', async () => {
    const db = snapshotDb({
      rows: [snapshotRow({ candidateUserIds: ['u-inactive', 'u2'] })],
      activeUserIds: ['u2'],
      inactiveUserIds: ['u-inactive'],
    })
    const eligibility = await evaluateApprovalEligibility(db, {
      approvalId: 'a1',
      actorId: 'u-inactive',
      phase: 'REQUEST',
    })
    assert.equal(eligibility.canApprove, false)
    assert.equal(eligibility.reason, 'INACTIVE_USER')
    await assert.rejects(
      () => advanceApprovalTransaction(db, { approvalId: 'a1', actorId: 'u-inactive', phase: 'REQUEST' }),
      (error: unknown) =>
        error instanceof RequestStatusConflictError && /inactive/i.test(error.message),
    )
    assert.equal(db.approvals.get('a1')?.status, 'pending')
    assert.equal(db.activities.length, 0)
    assert.equal(db.statusTransitionCount('r1'), 0)
  })

  it('non-member is NOT_CANDIDATE', async () => {
    const db = snapshotDb({ activeUserIds: ['u1', 'u2', 'outsider'] })
    const eligibility = await evaluateApprovalEligibility(db, {
      approvalId: 'a1',
      actorId: 'outsider',
      phase: 'REQUEST',
    })
    assert.equal(eligibility.canApprove, false)
    assert.equal(eligibility.reason, 'NOT_CANDIDATE')
    await assert.rejects(
      () => advanceApprovalTransaction(db, { approvalId: 'a1', actorId: 'outsider', phase: 'REQUEST' }),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
  })

  it('rejection sets instance REJECTED, closes remaining pending, and returns the request for revision', async () => {
    const db = snapshotDb({
      rows: [
        snapshotRow({ id: 'a1', order: 1 }),
        snapshotRow({ id: 'a2', order: 2, candidateUserIds: ['u3'] }),
      ],
      activeUserIds: ['u1', 'u2', 'u3'],
    })
    const result = await advanceApprovalTransaction(db, {
      approvalId: 'a1',
      actorId: 'u1',
      phase: 'REQUEST',
      comments: 'needs work',
      decision: 'REJECT',
    })
    assert.equal(result.actualActorId, 'u1')
    assert.equal(result.pendingApprovals, 0)
    assert.equal(db.approvals.get('a1')?.status, 'rejected')
    assert.equal(db.approvals.get('a2')?.status, 'rejected')
    assert.equal(db.instance.state, 'REJECTED')
    assert.equal(db.requestStatus, 'ImprovementRequest')
    assert.equal(db.statusTransitionCount('r1'), 0)
    assert.equal(db.activities.length, 1)
  })

  it('last pending approval advances REQUEST ImprovementRequest → SentToEngineer and instance APPROVED', async () => {
    const db = snapshotDb()
    const result = await advanceApprovalTransaction(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST' })
    assert.deepEqual(result.statusChange, { from: 'ImprovementRequest', to: 'SentToEngineer' })
    assert.equal(result.pendingApprovals, 0)
    assert.equal(db.requestStatus, 'SentToEngineer')
    assert.equal(db.instance.state, 'APPROVED')
  })

  it('intermediate approval does not touch request status', async () => {
    const db = snapshotDb({
      rows: [
        snapshotRow({ id: 'a1', order: 1 }),
        snapshotRow({ id: 'a2', order: 2, candidateUserIds: ['u3'] }),
      ],
      activeUserIds: ['u1', 'u2', 'u3'],
    })
    const result = await advanceApprovalTransaction(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST' })
    assert.equal(result.pendingApprovals, 1)
    assert.equal(result.statusChange, undefined)
    assert.equal(db.requestStatus, 'ImprovementRequest')
    assert.equal(db.instance.state, 'PENDING')
    assert.equal(db.approvals.get('a2')?.status, 'pending')
  })

  it('custom person rows are exact-person (CUSTOM_MISMATCH otherwise)', async () => {
    const db = snapshotDb({
      rows: [snapshotRow({
        id: 'custom-a1',
        routingMode: 'CUSTOM_PERSON',
        candidateUserIds: [],
        requiredApproverId: 'person-1',
      })],
      activeUserIds: ['person-1', 'person-2'],
    })
    const allowed = await evaluateApprovalEligibility(db, {
      approvalId: 'custom-a1',
      actorId: 'person-1',
      phase: 'REQUEST',
    })
    assert.equal(allowed.canApprove, true)
    assert.equal(allowed.routingMode, 'CUSTOM_PERSON')
    const denied = await evaluateApprovalEligibility(db, {
      approvalId: 'custom-a1',
      actorId: 'person-2',
      phase: 'REQUEST',
    })
    assert.equal(denied.canApprove, false)
    assert.equal(denied.reason, 'CUSTOM_MISMATCH')
    const result = await advanceApprovalTransaction(db, {
      approvalId: 'custom-a1',
      actorId: 'person-1',
      phase: 'REQUEST',
    })
    assert.equal(result.routingMode, 'CUSTOM_PERSON')
    assert.equal(result.actualActorId, 'person-1')
  })

  it('SOLUTION last pending advances DesignCostEstimationApproval → SendBackToRequester', async () => {
    const db = snapshotDb({
      rows: [snapshotRow({
        solutionId: 's1',
        requestStatus: 'DesignCostEstimationApproval',
      })],
      requestStatus: 'DesignCostEstimationApproval',
    })
    const result = await advanceApprovalTransaction(db, { approvalId: 'a1', actorId: 'u1', phase: 'SOLUTION' })
    assert.deepEqual(result.statusChange, { from: 'DesignCostEstimationApproval', to: 'SendBackToRequester' })
    assert.equal(db.requestStatus, 'SendBackToRequester')
    assert.equal(db.instance.state, 'APPROVED')
  })

  it('FINAL last pending advances FinalApproval → Completed', async () => {
    const db = snapshotDb({
      rows: [snapshotRow({ requestStatus: 'FinalApproval' })],
      requestStatus: 'FinalApproval',
    })
    const result = await advanceApprovalTransaction(db, { approvalId: 'a1', actorId: 'u1', phase: 'FINAL' })
    assert.deepEqual(result.statusChange, { from: 'FinalApproval', to: 'Completed' })
    assert.equal(db.requestStatus, 'Completed')
    assert.equal(db.instance.state, 'APPROVED')
  })

  it('cancelled or wrong-status rows fail closed with no writes', async () => {
    const db = snapshotDb({ requestStatus: 'Cancelled' })
    const eligibility = await evaluateApprovalEligibility(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST' })
    assert.equal(eligibility.canApprove, false)
    assert.equal(eligibility.reason, 'WRONG_STATUS')
    await assert.rejects(
      () => advanceApprovalTransaction(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST' }),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
    assert.equal(db.approvals.get('a1')?.status, 'pending')
    assert.equal(db.activities.length, 0)
    assert.equal(db.statusTransitionCount('r1'), 0)
  })

  it('cancellation winning after load refuses the SNAPSHOT row (0-row / conflict)', async () => {
    const db = snapshotDb()
    db.afterLoad = () => {
      db.cancelRequest()
    }
    await assert.rejects(
      () => advanceApprovalTransaction(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST' }),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
    assert.equal(db.statusTransitionCount('r1'), 0)
    assert.equal(db.activities.length, 0)
  })

  it('unauthenticated actor cannot approve', async () => {
    const db = snapshotDb()
    const eligibility = await evaluateApprovalEligibility(db, { approvalId: 'a1', actorId: '', phase: 'REQUEST' })
    assert.equal(eligibility.canApprove, false)
    assert.equal(eligibility.reason, 'UNAUTHENTICATED')
  })

  it('setInstanceOutcome never erases SUPERSEDED or terminal states', async () => {
    const db = snapshotDb({ instance: { id: 'inst-1', state: 'APPROVED', supersededAt: new Date('2026-01-01') } })
    await db.setInstanceOutcome({ instanceId: 'inst-1', outcome: 'REJECTED' })
    assert.equal(db.instance.state, 'APPROVED')
  })
})

describe('clean-start stranded detection', () => {
  it('isAttemptStranded is true only when ALL members of ALL current groups are inactive', () => {
    assert.equal(
      isAttemptStranded({
        candidateGroups: [
          { members: [{ userId: 'u1', user: { isActive: false } }, { userId: 'u2', user: { isActive: false } }] },
          { members: [{ userId: 'u3', user: { isActive: false } }] },
        ],
      }),
      true,
    )
    assert.equal(
      isAttemptStranded({
        candidateGroups: [
          { members: [{ userId: 'u1', user: { isActive: false } }] },
          { members: [{ userId: 'u2', user: { isActive: true } }] },
        ],
      }),
      false,
    )
    assert.equal(
      isAttemptStranded({
        candidateGroups: [{ members: [{ userId: 'u1', user: { isActive: true } }] }],
      }),
      false,
    )
    assert.equal(isAttemptStranded({ candidateGroups: [] }), false)
    assert.equal(isAttemptStranded({ candidateGroups: [{ members: [] }] }), false)
  })
})

describe('clean-start decisions source contract', () => {
  it('no Prisma, no LEGACY_LEVEL, consumes definition phase + conflict + current-instance filter', () => {
    const src = readFileSync('src/lib/approval-engine/decisions.ts', 'utf8')
    assert.match(src, /from ['"]@\/lib\/approval-routes\/definition['"]/)
    assert.match(src, /from ['"]@\/lib\/request-status-transition['"]/)
    assert.match(src, /CURRENT_INSTANCE_ROW_FILTER/)
    assert.match(src, /from ['"]@\/lib\/approval-engine\/current-instance['"]/)
    assert.doesNotMatch(src, /@prisma\/client/)
    assert.doesNotMatch(src, /LEGACY_LEVEL/)
    assert.doesNotMatch(src, /evaluateLegacyEligibility/)
    assert.doesNotMatch(src, /requiredLevel/)
    assert.doesNotMatch(src, /LEGACY_MISMATCH/)
    assert.doesNotMatch(src, /from ['"]@\/lib\/approval-engine\/(legacy|transactions|instances|candidate-groups|phase-adapters|phase-origin|types)['"]/)
    assert.doesNotMatch(src, /from ['"]\.\/(legacy|transactions|instances|candidate-groups|phase-adapters|phase-origin|types)['"]/)
    assert.ok(Array.isArray(CURRENT_INSTANCE_ROW_FILTER))
  })
})
