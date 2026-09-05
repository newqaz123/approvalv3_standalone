import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Prisma, RequestStatus } from '@prisma/client'
import { getApprovalLevelsAboveSubmitter } from '@/lib/approval-levels'
import { createApprovalChain } from '@/server-actions/approvals'
import {
  approveRequestApproval,
  type RequestApprovalTransactionDb,
} from '@/lib/request-approval-transaction'
import {
  buildRejectedRequestCancellationWhere,
  buildRejectedRequestResubmissionWhere,
  RequestStatusConflictError,
  updateRequestStatusExpecting,
} from '@/lib/request-status-transition'
import {
  evaluateRequesterCancellation,
  getCancellationBlockedMessage,
} from '@/lib/cancellation-policy'
import {
  runTransactionWithPostCommitNotifications,
  type PostCommitNotificationPlan,
} from '@/lib/post-commit-notifications'
import {
  canUserApproveAtLevel,
  canUserSubmitFinalApproval,
  canUserSubmitSolution,
  getAvailableActions,
  isUserAdmin,
  shouldShowActionButton,
} from '@/lib/permission-checks'
import {
  LEGACY_CHAIN_EXPECTATIONS,
  LEGACY_NOTIFICATION_EXPECTATIONS,
  ORGANIZATION_APPROVAL_FIXTURE,
  legacyRequestRows,
  phaseStatusExpectation,
} from '../fixtures/organization-approval-fixtures'

const read = (path: string) => readFileSync(path, 'utf8')

// ---------------------------------------------------------------------------
// Stateful Prisma-boundary fake (pattern from request-approval-transaction.test.ts)
//
// Task 1 is a characterization baseline: every behavioral assertion below drives
// REAL existing modules through their existing dependency-injection boundaries
// (createApprovalChain's db parameter, approveRequestApproval's transaction db,
// updateRequestStatusExpecting's guarded db, runTransactionWithPostCommitNotifications'
// injected transaction/dispatchers, and the pure policy/permission helpers).
// No production source was modified for these tests. Notification recipient
// loops that live inline inside action bodies have no injectable boundary; the
// fixtures store their expected event/recipient/channel/transition contracts
// (LEGACY_NOTIFICATION_EXPECTATIONS) and mark them as residuals instead of
// faking assertions against them.
// ---------------------------------------------------------------------------

type FakeUserRow = {
  id: string
  departmentId: string | null
  level: number | null
  isActive: boolean
  role: string
  name: string
  email: string | null
}

type FakeExternalApproverRow = {
  id: string
  departmentId: string
  approverId: string
  approverLevel: number
}

type FakeRequestRow = {
  id: string
  status: RequestStatus
  requesterId: string
  title: string
  departmentId: string
  updatedAt: Date
}

type FakeRequestApprovalRow = {
  id: string
  requestId: string
  requiredLevel: number | null
  requiredApproverId?: string | null
  order: number
  status: 'pending' | 'approved' | 'rejected'
  approverId?: string | null
  comments?: string | null
  approvedAt?: Date | null
  isCustomChain?: boolean
  isFinalApproval?: boolean
}

type FakeSolutionApprovalRow = {
  id: string
  solutionId: string
  requestId: string
  status: 'pending' | 'approved' | 'rejected'
}

type FakeActivityRow = {
  requestId: string
  userId?: string | null
  action: string
  comments?: string | null
  fromStatus?: RequestStatus | null
  toStatus?: RequestStatus | null
}

type RequestApprovalStatePredicate = {
  status?: string
  isFinalApproval?: boolean
}

type RequestRelationPredicate = {
  approvals?: {
    some?: RequestApprovalStatePredicate
    none?: RequestApprovalStatePredicate
  }
  solutions?: {
    none?: {
      approvals?: { some?: RequestApprovalStatePredicate }
    }
  }
}

type RequestUpdateManyWhere = {
  AND?: Array<Record<string, unknown>>
  id?: string
  status?: string | { in?: string[] }
  updatedAt?: Date
} & RequestRelationPredicate

/**
 * Evaluates exactly the where-shapes the real workflow writes through:
 * the guarded status transition's `{ AND: [expectedStatusWhere, additionalWhere] }`
 * where the additional builders use `approvals.some/none` and
 * `solutions.none.approvals.some` state predicates (see
 * buildRejectedRequestCancellationWhere / buildRejectedRequestResubmissionWhere).
 */
function matchesRequestApprovalState(
  row: { status: string; isFinalApproval?: boolean | null },
  predicate: RequestApprovalStatePredicate | undefined,
): boolean {
  if (!predicate) return true
  if (predicate.status !== undefined && row.status !== predicate.status) return false
  if (
    predicate.isFinalApproval !== undefined &&
    Boolean(row.isFinalApproval) !== predicate.isFinalApproval
  ) {
    return false
  }
  return true
}

class FakeRequestsTable {
  readonly rows = new Map<string, FakeRequestRow>()
  afterRead?: () => void

  constructor(private readonly db: BaselineWorkflowDb) {}

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
    // Narrow the Prisma where to the shapes the guarded transition and the
    // cancellation/resubmission builders actually produce (see
    // matchesRequestWhere below) so an unexpected predicate shape is a no-op,
    // mirroring the real conditional UPDATE.
    const where = args.where as unknown as RequestUpdateManyWhere
    let count = 0
    for (const row of this.rows.values()) {
      if (!this.matches(row, where)) continue
      Object.assign(row, args.data)
      count += 1
    }
    return { count }
  }

  private matches(row: FakeRequestRow, where: RequestUpdateManyWhere): boolean {
    if (where.AND && !where.AND.every((clause) => this.matches(row, clause as unknown as RequestUpdateManyWhere))) {
      return false
    }
    if (where.id !== undefined && row.id !== where.id) return false
    if (where.updatedAt !== undefined && row.updatedAt.getTime() !== where.updatedAt.getTime()) {
      return false
    }
    if (where.status !== undefined) {
      const expected =
        typeof where.status === 'string' ? [where.status] : where.status?.in ?? []
      if (!expected.includes(row.status)) return false
    }
    if (where.approvals) {
      const approvalRows = this.db.requestApprovalsForRequest(row.id)
      if (where.approvals.some && !approvalRows.some((a) => matchesRequestApprovalState(a, where.approvals?.some))) {
        return false
      }
      if (where.approvals.none && approvalRows.some((a) => matchesRequestApprovalState(a, where.approvals?.none))) {
        return false
      }
    }
    if (where.solutions?.none?.approvals?.some) {
      const predicate = where.solutions.none.approvals.some
      const hasPendingSolutionApproval = this.db
        .solutionApprovalsForRequest(row.id)
        .some((s) => matchesRequestApprovalState(s, predicate))
      if (hasPendingSolutionApproval) return false
    }
    return true
  }
}

class FakeRequestApprovalsTable {
  readonly rows = new Map<string, FakeRequestApprovalRow>()

  async createMany(args: {
    data: Array<Record<string, unknown>>
  }): Promise<{ count: number }> {
    for (const data of args.data) {
      const id = `created-${this.rows.size + 1}-${String(data.requiredLevel ?? data.requiredApproverId ?? '')}`
      this.rows.set(id, data as unknown as FakeRequestApprovalRow)
    }
    return { count: args.data.length }
  }

  async update(args: {
    where: { id: string }
    data: Partial<FakeRequestApprovalRow>
  }): Promise<FakeRequestApprovalRow> {
    const row = this.rows.get(args.where.id)
    if (!row) throw new Error(`approval ${args.where.id} not found`)
    Object.assign(row, args.data)
    return { ...row }
  }

  async updateMany(args: {
    where: { requestId?: string; status?: string; isFinalApproval?: boolean }
    data: Partial<FakeRequestApprovalRow>
  }): Promise<{ count: number }> {
    let count = 0
    for (const row of this.rows.values()) {
      if (args.where.requestId !== undefined && row.requestId !== args.where.requestId) continue
      if (args.where.status !== undefined && row.status !== args.where.status) continue
      if (
        args.where.isFinalApproval !== undefined &&
        Boolean(row.isFinalApproval) !== args.where.isFinalApproval
      ) {
        continue
      }
      Object.assign(row, args.data)
      count += 1
    }
    return { count }
  }

  async count(args: {
    where: { requestId: string; status: string }
  }): Promise<number> {
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

/** Records any notification write; the transactional core must never touch it. */
class FakeNotificationsTrap {
  readonly created: Array<Record<string, unknown>> = []

  async create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> {
    this.created.push(args.data)
    return args.data
  }

  async createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }> {
    this.created.push(...args.data)
    return { count: args.data.length }
  }
}

class FakeUsersTable {
  readonly rows = new Map<string, FakeUserRow>()

  async findFirst(args: {
    where: {
      departmentId?: string
      level?: number | { gte?: number; lte?: number }
      isActive?: boolean
      id?: string
    }
    orderBy?: { level?: string }
    select: Record<string, boolean>
  }): Promise<Partial<FakeUserRow> | null> {
    const candidates = [...this.rows.values()]
      .filter((row) => {
        if (args.where.departmentId !== undefined && row.departmentId !== args.where.departmentId) {
          return false
        }
        if (args.where.id !== undefined && row.id !== args.where.id) return false
        if (args.where.isActive !== undefined && row.isActive !== args.where.isActive) return false
        if (args.where.level !== undefined) {
          if (typeof args.where.level === 'number') {
            if (row.level !== args.where.level) return false
          } else {
            const { gte, lte } = args.where.level
            if (row.level === null) return false
            if (gte !== undefined && row.level < gte) return false
            if (lte !== undefined && row.level > lte) return false
          }
        }
        return true
      })
      .sort((a, b) => (b.level ?? 0) - (a.level ?? 0))
    return candidates[0] ? { ...candidates[0] } : null
  }

  async findMany(args: {
    where: { id?: { in: string[] }; departmentId?: string; level?: number; isActive?: boolean }
    select: Record<string, boolean>
  }): Promise<Array<Partial<FakeUserRow>>> {
    return [...this.rows.values()]
      .filter((row) => {
        if (args.where.id?.in && !args.where.id.in.includes(row.id)) return false
        if (args.where.departmentId !== undefined && row.departmentId !== args.where.departmentId) {
          return false
        }
        if (args.where.level !== undefined && row.level !== args.where.level) return false
        if (args.where.isActive !== undefined && row.isActive !== args.where.isActive) return false
        return true
      })
      .map((row) => ({ ...row }))
  }

  async findUnique(args: {
    where: { id: string }
    select: Record<string, boolean>
  }): Promise<Partial<FakeUserRow> | null> {
    const row = this.rows.get(args.where.id)
    return row ? { ...row } : null
  }
}

class FakeDepartmentApproversTable {
  readonly rows: FakeExternalApproverRow[] = []

  async findFirst(args: {
    where: { departmentId: string; approverLevel?: { gte?: number; lte?: number } | number }
    orderBy?: { approverLevel?: string }
    select: Record<string, boolean>
  }): Promise<{ approverLevel: number } | null> {
    const { gte, lte } =
      typeof args.where.approverLevel === 'number'
        ? { gte: args.where.approverLevel, lte: args.where.approverLevel }
        : args.where.approverLevel ?? {}
    const matches = this.rows
      .filter((row) => {
        if (row.departmentId !== args.where.departmentId) return false
        if (gte !== undefined && row.approverLevel < gte) return false
        if (lte !== undefined && row.approverLevel > lte) return false
        return true
      })
      .sort((a, b) => b.approverLevel - a.approverLevel)
    return matches[0] ? { approverLevel: matches[0].approverLevel } : null
  }

  async findMany(args: {
    where: { departmentId: string; approverLevel: number }
    select: Record<string, boolean>
  }): Promise<Array<{ id: string; approverId: string }>> {
    return this.rows
      .filter(
        (row) =>
          row.departmentId === args.where.departmentId &&
          row.approverLevel === args.where.approverLevel,
      )
      .map((row) => ({ id: row.id, approverId: row.approverId }))
  }
}

class FakeSolutionApprovalsTable {
  readonly rows = new Map<string, FakeSolutionApprovalRow>()

  async count(args: { where: { solution: { requestId: string }; status: string } }): Promise<number> {
    let total = 0
    for (const row of this.rows.values()) {
      if (row.requestId === args.where.solution.requestId && row.status === args.where.status) {
        total += 1
      }
    }
    return total
  }
}

/**
 * Stateful fake satisfying the production transaction contracts plus a
 * `$transaction` with real commit/rollback semantics, mirroring
 * request-approval-transaction.test.ts: writes made inside the callback are
 * kept only when it resolves; a throw restores the pre-transaction state.
 * Writes committed through `commitConcurrently` survive this workflow's
 * rollback, exactly like an independently committed concurrent transaction.
 */
class BaselineWorkflowDb implements RequestApprovalTransactionDb {
  readonly requests: FakeRequestsTable
  readonly request_approvals = new FakeRequestApprovalsTable()
  readonly request_activities = new FakeRequestActivitiesTable()
  readonly notifications = new FakeNotificationsTrap()
  readonly user = new FakeUsersTable()
  readonly department_approvers = new FakeDepartmentApproversTable()
  readonly solution_approvals = new FakeSolutionApprovalsTable()
  private readonly concurrentCommits: Array<(db: BaselineWorkflowDb) => void> = []

  constructor() {
    this.requests = new FakeRequestsTable(this)
  }

  requestApprovalsForRequest(requestId: string): FakeRequestApprovalRow[] {
    return [...this.request_approvals.rows.values()].filter((row) => row.requestId === requestId)
  }

  solutionApprovalsForRequest(requestId: string): FakeSolutionApprovalRow[] {
    return [...this.solution_approvals.rows.values()].filter(
      (row) => row.requestId === requestId,
    )
  }

  commitConcurrently(write: (db: BaselineWorkflowDb) => void): void {
    write(this)
    this.concurrentCommits.push(write)
  }

  async $transaction<T>(fn: (tx: BaselineWorkflowDb) => Promise<T>): Promise<T> {
    const requests = structuredClone([...this.requests.rows.entries()])
    const approvals = structuredClone([...this.request_approvals.rows.entries()])
    const activities = structuredClone(this.request_activities.rows)

    try {
      return await fn(this)
    } catch (error) {
      this.requests.rows.clear()
      for (const [id, row] of requests) this.requests.rows.set(id, row)
      this.request_approvals.rows.clear()
      for (const [id, row] of approvals) this.request_approvals.rows.set(id, row)
      this.request_activities.rows.length = 0
      this.request_activities.rows.push(...activities)
      for (const write of this.concurrentCommits) write(this)
      throw error
    }
  }
}

interface BaselineSeed {
  requests?: FakeRequestRow[]
  users?: FakeUserRow[]
  externalApprovers?: FakeExternalApproverRow[]
  requestApprovals?: FakeRequestApprovalRow[]
  solutionApprovals?: FakeSolutionApprovalRow[]
}

function seedDb(seed: BaselineSeed): BaselineWorkflowDb {
  const db = new BaselineWorkflowDb()
  for (const row of seed.requests ?? []) db.requests.rows.set(row.id, { ...row })
  for (const row of seed.users ?? []) db.user.rows.set(row.id, { ...row })
  db.department_approvers.rows.push(...(seed.externalApprovers ?? []))
  for (const row of seed.requestApprovals ?? []) {
    db.request_approvals.rows.set(row.id, { ...row })
  }
  for (const row of seed.solutionApprovals ?? []) {
    db.solution_approvals.rows.set(row.id, { ...row })
  }
  return db
}

const F = ORGANIZATION_APPROVAL_FIXTURE

/**
 * Runtime-only cast: `createApprovalChain` declares its db parameter as the
 * wide Prisma transaction client, but its body touches only the members this
 * fake implements (user.findFirst, department_approvers.findFirst/findMany,
 * request_approvals.createMany). The behavioral assertions below depend on
 * exactly those members through the real function body.
 */
function asPrismaTx(db: BaselineWorkflowDb): Parameters<typeof createApprovalChain>[4] {
  return db as unknown as Parameters<typeof createApprovalChain>[4]
}

const baselineStaffing: FakeUserRow[] = [
  // Baseline PD department staffing: active internal staff at levels 1, 2, 4.
  // Level 3 has only an inactive internal (sparse, skipped); level 5 has no
  // internal staff and is covered by external department approvers. This is
  // scenario data for the fake db only - the fixture stays mapping-free.
  {
    id: F.requesterId,
    departmentId: F.departmentId,
    level: 1,
    isActive: true,
    role: 'general',
    name: 'Baseline Staff',
    email: 'staff-1@example.test',
  },
  {
    id: F.supervisorId,
    departmentId: F.departmentId,
    level: 2,
    isActive: true,
    role: 'general',
    name: 'Baseline Supervisor',
    email: 'supervisor-1@example.test',
  },
  {
    id: F.departmentManagerId,
    departmentId: F.departmentId,
    level: 4,
    isActive: true,
    role: 'general',
    name: 'Baseline Department Manager',
    email: 'department-manager-1@example.test',
  },
  {
    id: F.inactiveCandidateId,
    departmentId: F.departmentId,
    level: 3,
    isActive: false,
    role: 'general',
    name: 'Inactive Candidate',
    email: null,
  },
  {
    id: F.nullOrgUserId,
    departmentId: null,
    level: 1,
    isActive: true,
    role: 'general',
    name: 'Null Org User',
    email: 'null-org-1@example.test',
  },
]

const externalLevel5Approver: FakeExternalApproverRow = {
  id: 'ext-1',
  departmentId: F.departmentId,
  approverId: F.customCrossCheckApproverId,
  approverLevel: 5,
}

function baselineRequest(overrides: Partial<FakeRequestRow> = {}): FakeRequestRow {
  return {
    id: 'req-1',
    status: 'ImprovementRequest',
    requesterId: F.requesterId,
    title: 'Baseline pump upgrade',
    departmentId: F.departmentId,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Brief skeleton: occupied legacy ladder, source seams
// ---------------------------------------------------------------------------

describe('organization approval redesign baseline', () => {
  it('records the occupied legacy ladder and preserves sparse-level arithmetic', () => {
    assert.deepEqual(getApprovalLevelsAboveSubmitter(1, 5), [2, 3, 4, 5])
    assert.deepEqual(
      [2, 3, 4, 5].filter((level) => LEGACY_CHAIN_EXPECTATIONS.sparseLevels.includes(level as 3 | 5)),
      LEGACY_CHAIN_EXPECTATIONS.sparseLevels,
    )
  })

  it('records phase origins, custom exceptions, and existing notification seams', () => {
    const requests = read('src/server-actions/requests.ts')
    const solutions = read('src/server-actions/solutions.ts')
    const notifications = read('src/server-actions/notifications.ts')
    assert.match(requests, /createApprovalChain/)
    assert.doesNotMatch(requests, /CustomApprovalPicker|customApproverIds/)
    assert.match(solutions, /createCustomApprovalChain/)
    assert.match(solutions, /createCustomFinalApprovalChain/)
    assert.match(notifications, /notifyUsersInDepartment/)
  })
})

// ---------------------------------------------------------------------------
// Request submit: real createApprovalChain through its existing db seam
// ---------------------------------------------------------------------------

describe('request submit chain creation (createApprovalChain)', () => {
  it('creates pending rows for occupied levels above a level-1 submitter, skipping sparse level 3 and routing level 5 to the external approver', async () => {
    const db = seedDb({
      users: baselineStaffing,
      externalApprovers: [externalLevel5Approver],
    })

    // Real production function; the db is its existing injected parameter.
    const approvals = await db.$transaction((tx) =>
      createApprovalChain('req-1', F.departmentId, 1, F.requesterId, asPrismaTx(tx)),
    )

    // Slim shape shared with later tasks via legacyRequestRows.
    assert.deepEqual(
      approvals.map((row) => ({
        requestId: row.requestId,
        requiredLevel: (row as { requiredLevel: number }).requiredLevel,
        order: (row as { order: number }).order,
        status: (row as { status: string }).status,
      })),
      legacyRequestRows({ requestId: 'req-1', levels: [2, 4, 5] }),
    )

    // Full routing shape: internal levels point at the active internal user,
    // the external level points at the DepartmentApprover's approver.
    assert.deepEqual(
      approvals.map((row) => ({
        requiredLevel: (row as { requiredLevel: number }).requiredLevel,
        requiredApproverId: (row as { requiredApproverId?: string }).requiredApproverId,
      })),
      [
        { requiredLevel: 2, requiredApproverId: F.supervisorId },
        { requiredLevel: 4, requiredApproverId: F.departmentManagerId },
        { requiredLevel: 5, requiredApproverId: F.customCrossCheckApproverId },
      ],
    )
    assert.ok(
      approvals.every((row) => (row as { status: string }).status === 'pending'),
    )
  })

  it('auto-approves the chain when the submitter is top-level in the department', async () => {
    // Without the level-5 external approver the department max is 4, so the
    // level-4 department manager is top-level.
    const db = seedDb({ users: baselineStaffing })

    const approvals = await db.$transaction((tx) =>
      createApprovalChain('req-1', F.departmentId, 4, F.departmentManagerId, asPrismaTx(tx)),
    )

    assert.equal(approvals.length, 1)
    const autoRow = approvals[0] as {
      requiredLevel: number
      order: number
      status: string
      approverId?: string
      comments?: string
      approvedAt?: Date
    }
    assert.deepEqual(
      {
        requiredLevel: autoRow.requiredLevel,
        order: autoRow.order,
        status: autoRow.status,
        approverId: autoRow.approverId,
        comments: autoRow.comments,
      },
      {
        requiredLevel: 4,
        order: 1,
        status: 'approved',
        approverId: F.departmentManagerId,
        comments: 'Auto-approved (top-level submitter)',
      },
    )
    assert.ok(autoRow.approvedAt instanceof Date)
  })
})

// ---------------------------------------------------------------------------
// Request approval progress/completion: real transaction core
// ---------------------------------------------------------------------------

describe('request approval progress and completion (approveRequestApproval)', () => {
  it('commits an intermediate approval without touching the request status and never notifies from the core', async () => {
    const db = seedDb({
      requests: [baselineRequest()],
      users: baselineStaffing,
      requestApprovals: [
        { id: 'a1', requestId: 'req-1', requiredLevel: 2, order: 1, status: 'pending' },
        { id: 'a2', requestId: 'req-1', requiredLevel: 4, order: 2, status: 'pending' },
      ],
    })

    const result = await db.$transaction((tx) =>
      approveRequestApproval(tx, {
        requestId: 'req-1',
        approvalId: 'a1',
        approverId: F.supervisorId,
        requiredLevel: 2,
      }),
    )

    assert.deepEqual(result, { pendingApprovals: 1 })
    assert.equal(db.requests.rows.get('req-1')?.status, 'ImprovementRequest')
    assert.equal(
      db.request_activities.rows.some((a) => a.action === 'status_changed'),
      false,
    )
    // Notifications are the caller's post-commit concern, never the core's.
    assert.deepEqual(db.notifications.created, [])
  })

  it('completes the request-approval phase with the recorded REQUEST transition and status-change activity', async () => {
    const db = seedDb({
      requests: [baselineRequest()],
      users: baselineStaffing,
      requestApprovals: [
        { id: 'a1', requestId: 'req-1', requiredLevel: 2, order: 1, status: 'pending' },
      ],
    })

    const result = await db.$transaction((tx) =>
      approveRequestApproval(tx, {
        requestId: 'req-1',
        approvalId: 'a1',
        approverId: F.supervisorId,
        requiredLevel: 2,
      }),
    )

    assert.deepEqual(result.statusChange, {
      fromStatus: 'ImprovementRequest',
      toStatus: 'SentToEngineer',
      requesterId: F.requesterId,
      title: baselineRequest().title,
    })
    assert.deepEqual(
      {
        from: phaseStatusExpectation('REQUEST').from,
        to: phaseStatusExpectation('REQUEST').to,
      },
      { from: 'ImprovementRequest', to: 'SentToEngineer' },
    )
    assert.equal(db.requests.rows.get('req-1')?.status, 'SentToEngineer')
    assert.deepEqual(
      db.request_activities.rows
        .filter((a) => a.action === 'status_changed')
        .map((a) => ({ from: a.fromStatus, to: a.toStatus })),
      [{ from: 'ImprovementRequest', to: 'SentToEngineer' }],
    )
  })

  it('walks the full request-approval ladder to Completed', async () => {
    const ladder: ReadonlyArray<readonly [RequestStatus, RequestStatus]> = [
      ['ImprovementRequest', 'SentToEngineer'],
      ['SentToEngineer', 'SendBackToRequester'],
      ['SendBackToRequester', 'Completed'],
    ]
    for (const [fromStatus, toStatus] of ladder) {
      const db = seedDb({
        requests: [baselineRequest({ status: fromStatus })],
        users: baselineStaffing,
        requestApprovals: [
          { id: 'a1', requestId: 'req-1', requiredLevel: 2, order: 1, status: 'pending' },
        ],
      })

      const result = await db.$transaction((tx) =>
        approveRequestApproval(tx, {
          requestId: 'req-1',
          approvalId: 'a1',
          approverId: F.supervisorId,
          requiredLevel: 2,
        }),
      )

      assert.equal(result.statusChange?.fromStatus, fromStatus)
      assert.equal(result.statusChange?.toStatus, toStatus)
      assert.equal(db.requests.rows.get('req-1')?.status, toStatus)
    }
  })

  it('fails closed for a request outside the request-approval ladder and writes nothing', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'FinalApproval' })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: null,
          order: 1,
          status: 'pending',
          isFinalApproval: true,
        },
      ],
    })

    await assert.rejects(
      db.$transaction((tx) =>
        approveRequestApproval(tx, {
          requestId: 'req-1',
          approvalId: 'a1',
          approverId: F.supervisorId,
          requiredLevel: 2,
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )

    assert.equal(db.request_approvals.rows.get('a1')?.status, 'pending')
    assert.deepEqual(db.request_activities.rows, [])
    assert.equal(db.requests.rows.get('req-1')?.status, 'FinalApproval')
  })
})

// ---------------------------------------------------------------------------
// Request cancel / resubmit coordination: real policy and guarded CAS
// ---------------------------------------------------------------------------

describe('request cancel and resubmit coordination', () => {
  it('allows cancellation only for the owner in a cancellable or rejected-ImprovementRequest state', () => {
    assert.deepEqual(
      evaluateRequesterCancellation({
        userId: F.requesterId,
        requesterId: F.requesterId,
        status: 'SentToEngineer',
      }),
      { canCancel: true, reason: null },
    )
    assert.deepEqual(
      evaluateRequesterCancellation({
        userId: F.requesterId,
        requesterId: F.requesterId,
        status: 'ImprovementRequest',
        hasRejectedRequestApproval: true,
      }),
      { canCancel: true, reason: null },
    )
  })

  it('blocks nonowners, wrong statuses, and pending approvals with the production messages', () => {
    const nonowner = evaluateRequesterCancellation({
      userId: F.nullOrgUserId,
      requesterId: F.requesterId,
      status: 'SentToEngineer',
    })
    assert.deepEqual(nonowner, { canCancel: false, reason: 'not-requester' })
    assert.equal(
      getCancellationBlockedMessage(nonowner.reason, 'SentToEngineer'),
      'Only the requester can cancel their own request',
    )

    const wrongStatus = evaluateRequesterCancellation({
      userId: F.requesterId,
      requesterId: F.requesterId,
      status: 'DesignCostEstimationApproval',
    })
    assert.deepEqual(wrongStatus, { canCancel: false, reason: 'status-not-cancellable' })
    assert.equal(
      getCancellationBlockedMessage(wrongStatus.reason, 'DesignCostEstimationApproval'),
      'Cannot cancel - request is DesignCostEstimationApproval',
    )

    assert.deepEqual(
      evaluateRequesterCancellation({
        userId: F.requesterId,
        requesterId: F.requesterId,
        status: 'SentToEngineer',
        hasPendingRequestApprovals: true,
      }),
      { canCancel: false, reason: 'pending-request-approval' },
    )
    assert.deepEqual(
      evaluateRequesterCancellation({
        userId: F.requesterId,
        requesterId: F.requesterId,
        status: 'SendBackToRequester',
        hasPendingSolutionApprovals: true,
      }),
      { canCancel: false, reason: 'pending-solution-approval' },
    )
    assert.equal(
      getCancellationBlockedMessage('pending-solution-approval'),
      'Cannot cancel - a solution approval is still pending',
    )
  })

  it('cancels through the guarded CAS when the rejected-request state matches', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z')
    const db = seedDb({
      requests: [baselineRequest({ updatedAt })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          approverId: F.historicalActorId,
          isFinalApproval: false,
        },
      ],
    })

    await db.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['ImprovementRequest'],
        additionalWhere: buildRejectedRequestCancellationWhere(updatedAt),
        data: { status: 'Cancelled' },
        actionLabel: 'cancel',
      }),
    )

    assert.equal(db.requests.rows.get('req-1')?.status, 'Cancelled')
  })

  it('blocks cancellation while a request or solution approval is pending, via the same CAS', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z')

    const pendingRequestApprovalDb = seedDb({
      requests: [baselineRequest({ updatedAt })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          approverId: F.historicalActorId,
          isFinalApproval: false,
        },
        { id: 'a2', requestId: 'req-1', requiredLevel: 4, order: 2, status: 'pending' },
      ],
    })

    await assert.rejects(
      pendingRequestApprovalDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['ImprovementRequest'],
          additionalWhere: buildRejectedRequestCancellationWhere(updatedAt),
          data: { status: 'Cancelled' },
          actionLabel: 'cancel',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
    assert.equal(pendingRequestApprovalDb.requests.rows.get('req-1')?.status, 'ImprovementRequest')

    const pendingSolutionApprovalDb = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester', updatedAt })],
      users: baselineStaffing,
      solutionApprovals: [
        { id: 's1', solutionId: 'sol-1', requestId: 'req-1', status: 'pending' },
      ],
    })

    await assert.rejects(
      pendingSolutionApprovalDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SendBackToRequester'],
          additionalWhere: buildRejectedRequestCancellationWhere(updatedAt),
          data: { status: 'Cancelled' },
          actionLabel: 'cancel',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
    assert.equal(pendingSolutionApprovalDb.requests.rows.get('req-1')?.status, 'SendBackToRequester')
  })

  it('loses the cancellation race when a competing transition commits before the guarded write', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z')
    const db = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester', updatedAt })],
      users: baselineStaffing,
    })

    // The guarded CAS is the window between the action's earlier status read
    // and its write. A competing workflow's status change lands inside this
    // transaction before the guarded write, commits independently, and
    // survives this transaction's rollback.
    await assert.rejects(
      db.$transaction(async (tx) => {
        db.commitConcurrently((tables) => {
          const row = tables.requests.rows.get('req-1')
          if (row) row.status = 'DesignCostEstimationApproval'
        })
        await updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SendBackToRequester'],
          data: { status: 'Cancelled' },
          actionLabel: 'cancel',
        })
      }),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )

    assert.equal(db.requests.rows.get('req-1')?.status, 'DesignCostEstimationApproval')
  })

  it('resubmits through the same-status CAS requiring an unchanged token and a rejected approval', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z')
    const db = seedDb({
      requests: [baselineRequest({ updatedAt })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          approverId: F.historicalActorId,
          isFinalApproval: false,
        },
      ],
    })

    const nextUpdatedAt = new Date(Math.max(Date.now(), updatedAt.getTime() + 1))
    await db.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['ImprovementRequest'],
        additionalWhere: buildRejectedRequestResubmissionWhere(updatedAt),
        data: { status: 'ImprovementRequest', updatedAt: nextUpdatedAt },
        actionLabel: 'resubmit request',
      }),
    )

    const row = db.requests.rows.get('req-1')
    assert.equal(row?.status, 'ImprovementRequest')
    assert.equal(row?.updatedAt.getTime(), nextUpdatedAt.getTime())
  })

  it('rejects resubmission for the wrong status and for a consumed compare-and-set token', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z')

    // Wrong status: resubmission only applies during the department approval phase.
    const wrongStatusDb = seedDb({
      requests: [baselineRequest({ status: 'SentToEngineer', updatedAt })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          isFinalApproval: false,
        },
      ],
    })
    await assert.rejects(
      wrongStatusDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['ImprovementRequest'],
          additionalWhere: buildRejectedRequestResubmissionWhere(updatedAt),
          data: { status: 'ImprovementRequest' },
          actionLabel: 'resubmit request',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )

    // Stale token: a concurrent same-status write consumed the compare-and-set.
    const staleTokenDb = seedDb({
      requests: [baselineRequest({ updatedAt: new Date(updatedAt.getTime() + 5_000) })],
      users: baselineStaffing,
      requestApprovals: [
        {
          id: 'a1',
          requestId: 'req-1',
          requiredLevel: 2,
          order: 1,
          status: 'rejected',
          isFinalApproval: false,
        },
      ],
    })
    await assert.rejects(
      staleTokenDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['ImprovementRequest'],
          additionalWhere: buildRejectedRequestResubmissionWhere(updatedAt),
          data: { status: 'ImprovementRequest' },
          actionLabel: 'resubmit request',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
  })
})

// ---------------------------------------------------------------------------
// Solution / final phase state machines: the real shared guarded transition
// driven with each action's exact production expected-status sets.
//
// The chain builders and recipient loops for these phases are module-private
// in solutions.ts (no injectable boundary); their stored notification
// contracts live in LEGACY_NOTIFICATION_EXPECTATIONS and are reported as
// residuals. What Task 1 can pin with real logic is the guarded status
// machine every one of those actions writes through.
// ---------------------------------------------------------------------------

describe('solution and final phase guarded transitions', () => {
  it('solution submit accepts only SentToEngineer into DesignCostEstimationApproval', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'SentToEngineer' })],
      users: baselineStaffing,
    })

    await db.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['SentToEngineer'],
        data: { status: 'DesignCostEstimationApproval' },
        actionLabel: 'submit solution',
      }),
    )
    assert.equal(db.requests.rows.get('req-1')?.status, 'DesignCostEstimationApproval')

    const cancelledDb = seedDb({
      requests: [baselineRequest({ status: 'Cancelled' })],
      users: baselineStaffing,
    })
    await assert.rejects(
      cancelledDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SentToEngineer'],
          data: { status: 'DesignCostEstimationApproval' },
          actionLabel: 'submit solution',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
    assert.equal(cancelledDb.requests.rows.get('req-1')?.status, 'Cancelled')
  })

  it('solution resubmit accepts SentToEngineer and DesignCostEstimationApproval origins', async () => {
    for (const origin of ['SentToEngineer', 'DesignCostEstimationApproval'] as const) {
      const db = seedDb({
        requests: [baselineRequest({ status: origin })],
        users: baselineStaffing,
      })

      await db.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SentToEngineer', 'DesignCostEstimationApproval'],
          data: { status: 'SendBackToRequester', updatedAt: new Date() },
          actionLabel: 'resubmit solution',
        }),
      )
      assert.equal(db.requests.rows.get('req-1')?.status, 'SendBackToRequester')
    }

    const cancelledDb = seedDb({
      requests: [baselineRequest({ status: 'Cancelled' })],
      users: baselineStaffing,
    })
    await assert.rejects(
      cancelledDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SentToEngineer', 'DesignCostEstimationApproval'],
          data: { status: 'SendBackToRequester' },
          actionLabel: 'resubmit solution',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
  })

  it('final initiation accepts only SendBackToRequester into FinalApproval or Completed', async () => {
    const hierarchyDb = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester' })],
      users: baselineStaffing,
    })
    await hierarchyDb.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['SendBackToRequester'],
        data: { status: 'FinalApproval' },
        actionLabel: 'initiate final approval',
      }),
    )
    assert.equal(hierarchyDb.requests.rows.get('req-1')?.status, 'FinalApproval')

    const autoDb = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester' })],
      users: baselineStaffing,
    })
    await autoDb.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['SendBackToRequester'],
        data: { status: 'Completed' },
        actionLabel: 'initiate final approval',
      }),
    )
    assert.equal(autoDb.requests.rows.get('req-1')?.status, 'Completed')

    const cancelledDb = seedDb({
      requests: [baselineRequest({ status: 'Cancelled' })],
      users: baselineStaffing,
    })
    await assert.rejects(
      cancelledDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SendBackToRequester'],
          data: { status: 'FinalApproval' },
          actionLabel: 'initiate final approval',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
  })

  it('manual completion accepts only SendBackToRequester into Completed', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester' })],
      users: baselineStaffing,
    })
    await db.$transaction((tx) =>
      updateRequestStatusExpecting(tx, {
        requestId: 'req-1',
        expectedStatuses: ['SendBackToRequester'],
        data: { status: 'Completed' },
        actionLabel: 'mark the request complete',
      }),
    )
    assert.equal(db.requests.rows.get('req-1')?.status, 'Completed')

    const wrongStatusDb = seedDb({
      requests: [baselineRequest({ status: 'DesignCostEstimationApproval' })],
      users: baselineStaffing,
    })
    await assert.rejects(
      wrongStatusDb.$transaction((tx) =>
        updateRequestStatusExpecting(tx, {
          requestId: 'req-1',
          expectedStatuses: ['SendBackToRequester'],
          data: { status: 'Completed' },
          actionLabel: 'mark the request complete',
        }),
      ),
      (error: unknown) => error instanceof RequestStatusConflictError,
    )
  })

  it('pins the stored phase transition expectations to the legacy chain constants', () => {
    assert.deepEqual(phaseStatusExpectation('REQUEST'), LEGACY_CHAIN_EXPECTATIONS.requestCompletion)
    assert.deepEqual(
      phaseStatusExpectation('SOLUTION'),
      LEGACY_CHAIN_EXPECTATIONS.solutionCompletion,
    )
    assert.deepEqual(phaseStatusExpectation('FINAL'), LEGACY_CHAIN_EXPECTATIONS.finalCompletion)
  })
})

// ---------------------------------------------------------------------------
// Post-commit notification channel semantics: real orchestration module
// ---------------------------------------------------------------------------

describe('post-commit notification channel semantics (runTransactionWithPostCommitNotifications)', () => {
  const intermediateApproverNotice = LEGACY_NOTIFICATION_EXPECTATIONS.find(
    (entry) => entry.case === 'solution approval intermediate next approver',
  )
  const completedBroadcast = LEGACY_NOTIFICATION_EXPECTATIONS.find(
    (entry) => entry.case === 'final approval completed department broadcast',
  )

  it('dispatches queued plans only after commit, in order, with payload and exclusion passthrough', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'FinalApproval' })],
      users: baselineStaffing,
    })
    const dispatched: Array<Record<string, unknown>> = []

    const result = await runTransactionWithPostCommitNotifications({
      runTransaction: (work) => db.$transaction((tx) => work(tx)),
      work: async (_tx, notifications) => {
        notifications.user({
          userId: F.supervisorId,
          type: 'approval_needed',
          title: 'Solution Approval Needed',
          message: 'Solution "Baseline solution" needs your approval.',
          requestId: 'req-1',
        })
        notifications.department(
          F.departmentId,
          {
            type: 'approval_granted',
            title: 'Request Completed',
            message: '✅ Request Completed: "Baseline pump upgrade" has been fully approved and completed.',
            requestId: 'req-1',
          },
          [F.engineeringId],
        )
        // The committed workflow write the real actions perform.
        await db.request_activities.create({
          data: { requestId: 'req-1', userId: F.requesterId, action: 'status_changed' },
        })
        return 'committed' as const
      },
      dispatchers: {
        notifyUser: async (notification) => {
          dispatched.push({ target: 'user', notification })
          return notification
        },
        notifyDepartment: async (departmentId, notification, excludeUserIds) => {
          dispatched.push({ target: 'department', departmentId, notification, excludeUserIds })
          return departmentId
        },
      },
    })

    assert.equal(result, 'committed')
    assert.equal(db.request_activities.rows.length, 1)
    assert.deepEqual(dispatched, [
      {
        target: 'user',
        notification: {
          userId: F.supervisorId,
          type: 'approval_needed',
          title: 'Solution Approval Needed',
          message: 'Solution "Baseline solution" needs your approval.',
          requestId: 'req-1',
        },
      },
      {
        target: 'department',
        departmentId: F.departmentId,
        notification: {
          type: 'approval_granted',
          title: 'Request Completed',
          message:
            '✅ Request Completed: "Baseline pump upgrade" has been fully approved and completed.',
          requestId: 'req-1',
        },
        excludeUserIds: [F.engineeringId],
      },
    ])

    // The recorded plans carry the stored expectations for these named cases:
    // event type, recipients, and the completion transition they follow.
    assert.ok(intermediateApproverNotice)
    assert.equal(intermediateApproverNotice.eventType, 'approval_needed')
    assert.equal(intermediateApproverNotice.channel, 'in_app+email')
    assert.deepEqual(intermediateApproverNotice.recipientIds, [F.supervisorId])
    assert.ok(completedBroadcast)
    assert.equal(completedBroadcast.eventType, 'approval_granted')
    assert.equal(completedBroadcast.channel, 'in_app_department_broadcast+email')
    assert.deepEqual(completedBroadcast.transition, {
      from: 'FinalApproval',
      to: 'Completed',
    })
  })

  it('discards every queued plan when the transaction rolls back', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester' })],
      users: baselineStaffing,
    })
    const dispatched: Array<Record<string, unknown>> = []

    await assert.rejects(
      runTransactionWithPostCommitNotifications({
        runTransaction: (work) => db.$transaction((tx) => work(tx)),
        work: async (_tx, notifications) => {
          notifications.user({
            userId: F.requesterId,
            type: 'solution_ready',
            title: 'Solution Ready for Review',
            message: 'Engineering solution for "Baseline pump upgrade" is ready for your review.',
            requestId: 'req-1',
          })
          await db.request_activities.create({
            data: { requestId: 'req-1', userId: F.requesterId, action: 'status_changed' },
          })
          throw new Error('workflow failed after queueing')
        },
        dispatchers: {
          notifyUser: async (notification) => {
            dispatched.push({ target: 'user', notification })
            return notification
          },
          notifyDepartment: async (departmentId, notification) => {
            dispatched.push({ target: 'department', departmentId, notification })
            return departmentId
          },
        },
      }),
      /workflow failed after queueing/,
    )

    assert.deepEqual(dispatched, [])
    assert.deepEqual(db.request_activities.rows, [])
  })

  it('keeps a committed workflow successful when a post-commit dispatch fails', async () => {
    const db = seedDb({
      requests: [baselineRequest({ status: 'SendBackToRequester' })],
      users: baselineStaffing,
    })
    const dispatchErrors: PostCommitNotificationPlan[] = []

    const result = await runTransactionWithPostCommitNotifications({
      runTransaction: (work) => db.$transaction((tx) => work(tx)),
      work: async (_tx, notifications) => {
        notifications.user({
          userId: F.requesterId,
          type: 'solution_ready',
          title: 'Solution Ready for Review',
          message: 'Engineering solution for "Baseline pump upgrade" is ready for your review.',
          requestId: 'req-1',
        })
        return 'committed' as const
      },
      dispatchers: {
        notifyUser: async () => {
          throw new Error('smtp down')
        },
        notifyDepartment: async (departmentId, notification) => notification && departmentId,
      },
      onDispatchError: (plan) => {
        dispatchErrors.push(plan)
      },
    })

    assert.equal(result, 'committed')
    assert.equal(dispatchErrors.length, 1)
    assert.equal(dispatchErrors[0].target, 'user')
  })
})

// ---------------------------------------------------------------------------
// Viewer vs action authorization (real pure permission helpers)
// ---------------------------------------------------------------------------

describe('viewer and action authorization baseline', () => {
  it('allows approval only for assigned or higher-level users and never for unassigned users', () => {
    assert.equal(canUserApproveAtLevel(4, 2), true)
    assert.equal(canUserApproveAtLevel(2, 2), true)
    assert.equal(canUserApproveAtLevel(2, 4), false)
    assert.equal(canUserApproveAtLevel(null, 2), false)
    assert.equal(canUserApproveAtLevel(undefined, 2), false)
  })

  it('lets engineering users submit solutions and unrelated general users do nothing on SentToEngineer', () => {
    assert.equal(canUserSubmitSolution('ENGINEERING', 'general'), true)
    assert.equal(canUserSubmitSolution(null, 'engineering'), true)
    assert.equal(canUserSubmitSolution(null, 'general'), false)

    const unrelatedGeneralViewer = getAvailableActions(
      'SentToEngineer',
      'general',
      null,
      null,
      F.departmentId,
      1,
      false,
    )
    assert.deepEqual(unrelatedGeneralViewer, {
      canSubmitRequest: true,
      canSubmitSolution: false,
      canReviewRequest: false,
      canReviewSolution: false,
      canSubmitFinalApproval: false,
      canReviewFinalApproval: false,
      canExportPDF: false,
    })

    const engineeringViewer = getAvailableActions(
      'SentToEngineer',
      'engineering',
      'ENGINEERING',
      F.engineeringDepartmentId,
      F.departmentId,
      1,
      false,
    )
    // Engineering can act by submitting a solution, but cannot review the request.
    assert.equal(engineeringViewer.canSubmitSolution, true)
    assert.equal(engineeringViewer.canReviewRequest, false)
    assert.equal(engineeringViewer.canReviewSolution, false)
  })

  it('limits final-approval initiation to the requester department and read-only viewers get no action buttons', () => {
    assert.equal(
      canUserSubmitFinalApproval('u1', 'r1', F.departmentId, F.departmentId),
      true,
    )
    assert.equal(
      canUserSubmitFinalApproval('u1', 'r1', F.engineeringDepartmentId, F.departmentId),
      false,
    )
    assert.equal(canUserSubmitFinalApproval('u1', 'r1', null, F.departmentId), false)

    const unrelatedEngineering = shouldShowActionButton(
      'submit-final-approval',
      'engineering',
      'ENGINEERING',
      F.engineeringDepartmentId,
      F.departmentId,
      'SendBackToRequester',
      false,
    )
    assert.equal(unrelatedEngineering, false)

    const sameDepartmentMember = shouldShowActionButton(
      'submit-final-approval',
      'general',
      null,
      F.departmentId,
      F.departmentId,
      'SendBackToRequester',
      false,
    )
    assert.equal(sameDepartmentMember, true)

    assert.equal(
      shouldShowActionButton('approve', 'general', null, F.departmentId, F.departmentId, 'ImprovementRequest', false),
      false,
    )
    assert.equal(shouldShowActionButton('export-pdf', 'general', null, null, null, 'Completed', false), true)
    assert.equal(shouldShowActionButton('export-pdf', 'general', null, null, null, 'SentToEngineer', false), false)
  })

  it('keeps admin as a system role separate from positions', () => {
    assert.equal(isUserAdmin('admin'), true)
    assert.equal(isUserAdmin('general'), false)
    assert.equal(isUserAdmin('engineering'), false)

    const adminActions = getAvailableActions(
      'ImprovementRequest',
      'admin',
      null,
      F.departmentId,
      F.departmentId,
      1,
      false,
    )
    assert.equal(adminActions.canReviewRequest, true)
    assert.equal(adminActions.canSubmitSolution, true)
    assert.equal(adminActions.canSubmitFinalApproval, true)
  })
})

// ---------------------------------------------------------------------------
// Stored per-case notification contract sanity
// ---------------------------------------------------------------------------

describe('legacy notification expectation matrix', () => {
  it('stores event type, recipients, channel, and transition for every named legacy case with unique ids', () => {
    const cases = LEGACY_NOTIFICATION_EXPECTATIONS.map((entry) => entry.case)
    assert.equal(new Set(cases).size, cases.length)

    for (const entry of LEGACY_NOTIFICATION_EXPECTATIONS) {
      assert.ok(entry.eventType === null || typeof entry.eventType === 'string', entry.case)
      assert.ok(Array.isArray(entry.recipientIds), entry.case)
      assert.ok(entry.recipientsRule.length > 0, entry.case)
      assert.ok(
        ['in_app', 'in_app+email', 'in_app_department_broadcast+email'].includes(entry.channel),
        entry.case,
      )
      assert.ok(
        entry.transition === null ||
          (typeof entry.transition.from === 'string' && typeof entry.transition.to === 'string'),
        entry.case,
      )
      assert.match(
        entry.assertedVia,
        /^(recorded collector calls|recorded db writes|recorded orchestration dispatch|inline in action body)/,
        entry.case,
      )
    }

    // Phase-specific contracts the redesign must preserve exactly.
    const byCase = (name: string) =>
      LEGACY_NOTIFICATION_EXPECTATIONS.find((entry) => entry.case === name)
    assert.ok(byCase('request submit approval needed'))
    assert.ok(byCase('solution submit custom chain all at submit'))
    assert.ok(byCase('final initiate custom chain first step only'))
    assert.ok(byCase('final approval completed department broadcast'))
    assert.ok(byCase('request cancelled'))
    assert.equal(byCase('request cancelled')?.eventType, null)
    assert.deepEqual(byCase('request cancelled')?.recipientIds, [])
  })
})
