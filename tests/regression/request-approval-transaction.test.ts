import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma, RequestStatus } from '@prisma/client'
import { RequestStatusConflictError } from '@/lib/request-status-transition'
import {
  approveRequestApproval,
  type RequestApprovalTransactionDb,
} from '@/lib/request-approval-transaction'

/**
 * Atomic request-approval core used by approveRequest().
 *
 * The approval mutation, its audit activity, the remaining-pending count,
 * the guarded status transition, and the status-change activity must commit
 * as ONE transaction. When the requester's cancellation wins the race, the
 * guarded transition throws inside the transaction and EVERY write the
 * approval made must roll back - a cancelled request must not keep an
 * approved approval row or approval activities.
 *
 * The core also fails closed BEFORE any write: it reads and validates the
 * request first, so a missing request, or a status outside the legacy
 * request-approval ladder (Cancelled, Completed,
 * DesignCostEstimationApproval, FinalApproval), throws inside the
 * transaction and NO approval or activity commits - even when other
 * approvals would remain pending.
 *
 * Tests drive the exact production core with a stateful in-memory stand-in
 * at the Prisma boundary: the fake honors `UPDATE ... WHERE status IN (...)`
 * zero-row semantics and emulates `prisma.$transaction` commit/rollback.
 * Assertions target committed state, not mock call counts. Notifications
 * are deliberately absent from the core: they belong to the caller, after
 * commit (the fake's notifications trap proves the core never touches them).
 */

// ---------------------------------------------------------------------------
// Stateful Prisma-boundary fake
// ---------------------------------------------------------------------------

type FakeRequestRow = {
  id: string
  status: RequestStatus
  requesterId: string
  title: string
}

type FakeApprovalRow = {
  id: string
  requestId: string
  requiredLevel: number
  status: 'pending' | 'approved' | 'rejected'
  approverId?: string | null
  comments?: string | null
  approvedAt?: Date | null
}

type FakeActivityRow = {
  requestId: string
  userId?: string | null
  action: string
  comments?: string | null
  fromStatus?: RequestStatus | null
  toStatus?: RequestStatus | null
}

/** Models `UPDATE requests ... WHERE id = $1 AND status IN (...)`: a row in
 * any other status matches zero rows. */
class FakeRequestsTable {
  readonly rows = new Map<string, FakeRequestRow>()

  /**
   * Concurrency injection point: runs right after a findUnique read. A test
   * can commit a competing transaction here (e.g. requester cancellation)
   * inside the window between this workflow's status read and its guarded
   * status write - exactly the READ COMMITTED race the guard exists for.
   */
  afterRead?: () => void

  async findUnique(args: {
    where: { id: string }
    select: { status: true; requesterId: true; title: true }
  }): Promise<{ status: RequestStatus; requesterId: string; title: string } | null> {
    const row = this.rows.get(args.where.id)
    const result = row
      ? { status: row.status, requesterId: row.requesterId, title: row.title }
      : null
    this.afterRead?.()
    return result
  }

  async updateMany(args: Prisma.requestsUpdateManyArgs): Promise<{ count: number }> {
    // The guarded transition always calls with { id, status: { in: [...] } };
    // narrow to that shape so a mismatching committed status is a no-op,
    // mirroring the real conditional UPDATE.
    const where = args.where as
      | { id?: string; status?: string | { in?: string[] } }
      | undefined
    if (!where?.id) {
      return { count: 0 }
    }
    const row = this.rows.get(where.id)
    const expected =
      typeof where.status === 'string' ? [where.status] : where.status?.in ?? []
    if (!row || !expected.includes(row.status)) {
      return { count: 0 }
    }
    Object.assign(row, args.data)
    return { count: 1 }
  }
}

class FakeRequestApprovalsTable {
  readonly rows = new Map<string, FakeApprovalRow>()

  async update(args: {
    where: { id: string }
    data: Partial<FakeApprovalRow>
  }): Promise<FakeApprovalRow> {
    const row = this.rows.get(args.where.id)
    if (!row) {
      throw new Error(`approval ${args.where.id} not found`)
    }
    Object.assign(row, args.data)
    return { ...row }
  }

  async count(args: { where: { requestId: string; status: string } }): Promise<number> {
    let total = 0
    for (const row of this.rows.values()) {
      if (row.requestId === args.where.requestId && row.status === args.where.status) {
        total += 1
      }
    }
    return total
  }
}

class FakeRequestActivitiesTable {
  readonly rows: FakeActivityRow[] = []

  async create(args: { data: FakeActivityRow }): Promise<FakeActivityRow> {
    this.rows.push({ ...args.data })
    return { ...args.data }
  }
}

/** Records any notification write so tests can prove the transactional core
 * never notifies (notifications fire only from the caller, after commit). */
class FakeNotificationsTrap {
  readonly created: Array<Record<string, unknown>> = []

  async create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> {
    this.created.push(args.data)
    return args.data
  }
}

/**
 * Stateful fake satisfying the production `RequestApprovalTransactionDb`
 * contract plus a `$transaction` with real commit/rollback semantics: writes
 * made inside the callback are kept only when it resolves; a throw restores
 * the pre-transaction state, mirroring `prisma.$transaction` rollback.
 */
class FakeApprovalDb implements RequestApprovalTransactionDb {
  readonly requests = new FakeRequestsTable()
  readonly request_approvals = new FakeRequestApprovalsTable()
  readonly request_activities = new FakeRequestActivitiesTable()
  readonly notifications = new FakeNotificationsTrap()
  private readonly concurrentCommits: Array<(db: FakeApprovalDb) => void> = []

  /**
   * Simulate a competing transaction committing while this workflow's
   * transaction is in flight (e.g. requester cancellation): the write
   * applies immediately AND survives this workflow's rollback, exactly like
   * an independently committed concurrent transaction.
   */
  commitConcurrently(write: (db: FakeApprovalDb) => void): void {
    write(this)
    this.concurrentCommits.push(write)
  }

  async $transaction<T>(
    fn: (tx: RequestApprovalTransactionDb) => Promise<T>,
  ): Promise<T> {
    const requests = structuredClone([...this.requests.rows.values()])
    const approvals = structuredClone([...this.request_approvals.rows.values()])
    const activities = structuredClone(this.request_activities.rows)

    try {
      return await fn(this)
    } catch (error) {
      this.requests.rows.clear()
      for (const row of requests) this.requests.rows.set(row.id, row)
      this.request_approvals.rows.clear()
      for (const row of approvals) this.request_approvals.rows.set(row.id, row)
      this.request_activities.rows.length = 0
      this.request_activities.rows.push(...activities)
      // Writes committed by concurrent transactions outlive this rollback.
      for (const write of this.concurrentCommits) write(this)
      throw error
    }
  }
}

function fakeDb(options: {
  requests?: FakeRequestRow[]
  approvals?: FakeApprovalRow[]
}): FakeApprovalDb {
  const db = new FakeApprovalDb()
  for (const row of options.requests ?? []) {
    db.requests.rows.set(row.id, { ...row })
  }
  for (const row of options.approvals ?? []) {
    db.request_approvals.rows.set(row.id, { ...row })
  }
  return db
}

const REQUEST = { id: 'r1', requesterId: 'requester-1', title: 'Pump upgrade' } as const

// ---------------------------------------------------------------------------
// Atomicity: cancellation wins
// ---------------------------------------------------------------------------

describe('request approval transaction core', () => {
  it('rolls back the approval, its activity, and the status change when cancellation wins the race', async () => {
    const db = fakeDb({
      requests: [{ ...REQUEST, status: 'SendBackToRequester' }],
      approvals: [{ id: 'a1', requestId: REQUEST.id, requiredLevel: 2, status: 'pending' }],
    })

    // The core reads SendBackToRequester; the requester's cancellation
    // commits in the window between that read and the guarded status write.
    db.requests.afterRead = () => {
      db.commitConcurrently((tables) => {
        const row = tables.requests.rows.get(REQUEST.id)
        if (row) row.status = 'Cancelled'
      })
    }

    await assert.rejects(
      db.$transaction((tx) =>
        approveRequestApproval(tx, {
          requestId: REQUEST.id,
          approvalId: 'a1',
          approverId: 'approver-1',
          requiredLevel: 2,
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )

    // Every write the approval made rolled back: the approval is still
    // pending with no approver, no activities exist, and the cancelled
    // request stays cancelled.
    const approval = db.request_approvals.rows.get('a1')
    assert.equal(approval?.status, 'pending')
    assert.equal(approval?.approverId, undefined)
    assert.equal(approval?.approvedAt, undefined)
    assert.deepEqual(db.request_activities.rows, [])
    assert.equal(db.requests.rows.get(REQUEST.id)?.status, 'Cancelled')
  })

  it('commits the approval, activity, guarded transition, and status-change activity together', async () => {
    const db = fakeDb({
      requests: [{ ...REQUEST, status: 'ImprovementRequest' }],
      approvals: [{ id: 'a1', requestId: REQUEST.id, requiredLevel: 2, status: 'pending' }],
    })

    const result = await db.$transaction((tx) =>
      approveRequestApproval(tx, {
        requestId: REQUEST.id,
        approvalId: 'a1',
        approverId: 'approver-1',
        requiredLevel: 2,
        comments: 'LGTM',
      }),
    )

    assert.deepEqual(result, {
      pendingApprovals: 0,
      statusChange: {
        fromStatus: 'ImprovementRequest',
        toStatus: 'SentToEngineer',
        requesterId: REQUEST.requesterId,
        title: REQUEST.title,
      },
    })

    const approval = db.request_approvals.rows.get('a1')
    assert.equal(approval?.status, 'approved')
    assert.equal(approval?.approverId, 'approver-1')
    assert.equal(approval?.comments, 'LGTM')
    assert.ok(approval?.approvedAt instanceof Date)

    assert.deepEqual(
      db.request_activities.rows.map((a) => ({
        action: a.action,
        from: a.fromStatus ?? null,
        to: a.toStatus ?? null,
      })),
      [
        { action: 'approved', from: null, to: null },
        { action: 'status_changed', from: 'ImprovementRequest', to: 'SentToEngineer' },
      ],
    )
    assert.equal(db.requests.rows.get(REQUEST.id)?.status, 'SentToEngineer')
    // Notifications are the caller's post-commit concern, never the core's.
    assert.deepEqual(db.notifications.created, [])
  })

  it('commits an intermediate approval without touching the request status', async () => {
    const db = fakeDb({
      requests: [{ ...REQUEST, status: 'ImprovementRequest' }],
      approvals: [
        { id: 'a1', requestId: REQUEST.id, requiredLevel: 2, status: 'pending' },
        { id: 'a2', requestId: REQUEST.id, requiredLevel: 3, status: 'pending' },
      ],
    })

    const result = await db.$transaction((tx) =>
      approveRequestApproval(tx, {
        requestId: REQUEST.id,
        approvalId: 'a1',
        approverId: 'approver-1',
        requiredLevel: 2,
      }),
    )

    assert.deepEqual(result, { pendingApprovals: 1 })
    assert.equal(db.request_approvals.rows.get('a1')?.status, 'approved')
    assert.equal(db.request_approvals.rows.get('a2')?.status, 'pending')
    assert.equal(db.requests.rows.get(REQUEST.id)?.status, 'ImprovementRequest')
    assert.equal(
      db.request_activities.rows.some((a) => a.action === 'status_changed'),
      false,
    )
  })

  it('logs the level default comment when the approver left none', async () => {
    const db = fakeDb({
      requests: [{ ...REQUEST, status: 'ImprovementRequest' }],
      approvals: [{ id: 'a1', requestId: REQUEST.id, requiredLevel: 4, status: 'pending' }],
    })

    await db.$transaction((tx) =>
      approveRequestApproval(tx, {
        requestId: REQUEST.id,
        approvalId: 'a1',
        approverId: 'approver-1',
        requiredLevel: 4,
      }),
    )

    assert.equal(db.request_approvals.rows.get('a1')?.comments, undefined)
    const approvedActivity = db.request_activities.rows.find((a) => a.action === 'approved')
    assert.equal(approvedActivity?.comments, 'Approved at level 4')
  })

  it('walks the legacy approval ladder', async () => {
    const ladder: ReadonlyArray<readonly [RequestStatus, RequestStatus]> = [
      ['ImprovementRequest', 'SentToEngineer'],
      ['SentToEngineer', 'SendBackToRequester'],
      ['SendBackToRequester', 'Completed'],
    ]
    for (const [fromStatus, toStatus] of ladder) {
      const db = fakeDb({
        requests: [{ ...REQUEST, status: fromStatus }],
        approvals: [{ id: 'a1', requestId: REQUEST.id, requiredLevel: 1, status: 'pending' }],
      })

      const result = await db.$transaction((tx) =>
        approveRequestApproval(tx, {
          requestId: REQUEST.id,
          approvalId: 'a1',
          approverId: 'approver-1',
          requiredLevel: 1,
        }),
      )

      assert.equal(result.statusChange?.fromStatus, fromStatus)
      assert.equal(result.statusChange?.toStatus, toStatus)
      assert.equal(db.requests.rows.get(REQUEST.id)?.status, toStatus)
    }
  })

  it('fails closed when the requester cancelled before the core read the request', async () => {
    // Cancellation committed BEFORE this transaction started: the very
    // first read observes Cancelled, so the core must throw before writing
    // anything - not approve the row and silently skip the transition.
    const db = fakeDb({
      requests: [{ ...REQUEST, status: 'Cancelled' }],
      approvals: [{ id: 'a1', requestId: REQUEST.id, requiredLevel: 1, status: 'pending' }],
    })

    await assert.rejects(
      db.$transaction((tx) =>
        approveRequestApproval(tx, {
          requestId: REQUEST.id,
          approvalId: 'a1',
          approverId: 'approver-1',
          requiredLevel: 1,
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )

    assert.equal(db.request_approvals.rows.get('a1')?.status, 'pending')
    assert.equal(db.request_approvals.rows.get('a1')?.approverId, undefined)
    assert.equal(db.request_approvals.rows.get('a1')?.approvedAt, undefined)
    assert.deepEqual(db.request_activities.rows, [])
    assert.equal(db.requests.rows.get(REQUEST.id)?.status, 'Cancelled')
  })

  it('fails closed for statuses outside the legacy request-approval ladder', async () => {
    for (const status of ['Completed', 'DesignCostEstimationApproval', 'FinalApproval'] as const) {
      const db = fakeDb({
        requests: [{ ...REQUEST, status }],
        approvals: [{ id: 'a1', requestId: REQUEST.id, requiredLevel: 1, status: 'pending' }],
      })

      await assert.rejects(
        db.$transaction((tx) =>
          approveRequestApproval(tx, {
            requestId: REQUEST.id,
            approvalId: 'a1',
            approverId: 'approver-1',
            requiredLevel: 1,
          }),
        ),
        (error: unknown) => error instanceof RequestStatusConflictError,
      )

      assert.equal(db.request_approvals.rows.get('a1')?.status, 'pending')
      assert.equal(db.request_approvals.rows.get('a1')?.approverId, undefined)
      assert.equal(db.request_approvals.rows.get('a1')?.approvedAt, undefined)
      assert.deepEqual(db.request_activities.rows, [])
      assert.equal(db.requests.rows.get(REQUEST.id)?.status, status)
    }
  })

  it('fails closed when the request row is missing', async () => {
    const db = fakeDb({
      approvals: [{ id: 'a1', requestId: 'missing', requiredLevel: 1, status: 'pending' }],
    })

    await assert.rejects(
      db.$transaction((tx) =>
        approveRequestApproval(tx, {
          requestId: 'missing',
          approvalId: 'a1',
          approverId: 'approver-1',
          requiredLevel: 1,
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )

    assert.equal(db.request_approvals.rows.get('a1')?.status, 'pending')
    assert.equal(db.request_approvals.rows.get('a1')?.approverId, undefined)
    assert.equal(db.request_approvals.rows.get('a1')?.approvedAt, undefined)
    assert.deepEqual(db.request_activities.rows, [])
  })

  it('fails closed even when other approvals would remain pending', async () => {
    // The upfront validation applies to every approval in the chain, not
    // only the final one: an intermediate approval on a cancelled request
    // must not commit either.
    const db = fakeDb({
      requests: [{ ...REQUEST, status: 'Cancelled' }],
      approvals: [
        { id: 'a1', requestId: REQUEST.id, requiredLevel: 2, status: 'pending' },
        { id: 'a2', requestId: REQUEST.id, requiredLevel: 3, status: 'pending' },
      ],
    })

    await assert.rejects(
      db.$transaction((tx) =>
        approveRequestApproval(tx, {
          requestId: REQUEST.id,
          approvalId: 'a1',
          approverId: 'approver-1',
          requiredLevel: 2,
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )

    assert.equal(db.request_approvals.rows.get('a1')?.status, 'pending')
    assert.equal(db.request_approvals.rows.get('a2')?.status, 'pending')
    assert.deepEqual(db.request_activities.rows, [])
    assert.equal(db.requests.rows.get(REQUEST.id)?.status, 'Cancelled')
  })
})
