/**
 * Owner-provisioned disposable-CI integration tests for the organization
 * approval redesign row-integrity constraints (Task 2 fix round 3).
 *
 * These tests are NOT part of `npm run check` (which only runs
 * tests/regression) and are NEVER executed locally — the source task has no
 * database authority and no migration may be applied here. They require a
 * database with this migration already applied, provided ONLY through
 * ORGANIZATION_APPROVAL_CI_DATABASE_URL; without that variable every test
 * self-skips. An explicit guard rejects a CI URL equal to the application's
 * DATABASE_URL, and PrismaClient is always constructed with the explicit CI
 * datasource URL, so the target can never silently default to a local env.
 *
 * Connection affinity (fix round 3): concurrency schedules NEVER issue raw
 * BEGIN/COMMIT/ROLLBACK through pooled clients. Each participant runs in its
 * own pinned interactive transaction (`$transaction(async tx => …,
 * { isolationLevel, timeout, maxWait })` on its own client) and every
 * statement inside uses that transaction client. A separate observer
 * connection reads `pg_blocking_pids` to prove the intended blocking point
 * before any barrier is released. Rejection handlers are attached to
 * transaction promises immediately so expected failures are never unhandled.
 *
 * Fixture discipline: cleanup is registered BEFORE the first seed write,
 * tracks exactly the IDs each scenario created in creation order, and runs
 * them in FK-safe reverse order as idempotent deleteMany calls. Failures are
 * collected and reported via AggregateError instead of being swallowed.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient, Prisma } from '@prisma/client'

const CI_DATABASE_URL = process.env.ORGANIZATION_APPROVAL_CI_DATABASE_URL
const hasCI = typeof CI_DATABASE_URL === 'string' && CI_DATABASE_URL.length > 0
const PINNED_TX_OPTIONS = { timeout: 60000, maxWait: 5000 } as const

// A skipped describe still documents the CI contract for the reviewer.
const ci = hasCI ? describe : describe.skip

let prisma: PrismaClient | null = null

before(async () => {
  if (!hasCI) return
  assert.notEqual(
    CI_DATABASE_URL,
    process.env.DATABASE_URL,
    'ORGANIZATION_APPROVAL_CI_DATABASE_URL must not point at the application DATABASE_URL',
  )
  prisma = new PrismaClient({
    datasources: { db: { url: CI_DATABASE_URL } },
  })
  await prisma.$connect()
})

after(async () => {
  if (prisma) await prisma.$disconnect()
})

function client(): PrismaClient {
  assert.ok(prisma, 'CI database client must be initialised')
  return prisma
}

function newClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: CI_DATABASE_URL as string } } })
}

function scenarioId(n: number): string {
  return `00000000-0004-4000-8000-${String(n).padStart(12, '0')}`
}

/** Bounded condition wait: fails the test instead of hanging CI. */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  message: string,
  deadlineMs = 15000,
): Promise<void> {
  const deadline = Date.now() + deadlineMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/**
 * Failure-safe scoped cleanup: tracks exactly the IDs this scenario created
 * (in creation order) and deletes them in reverse registration order, which
 * is FK-safe because children are always created after their parents.
 * Deletions are idempotent deleteMany calls; failures are collected and
 * reported as an AggregateError after best-effort completion instead of
 * being swallowed.
 */
class ScenarioCleanup {
  private readonly steps: Array<{ description: string; run: () => Promise<unknown> }> = []
  private readonly beforeCleanup: Array<{ description: string; run: () => Promise<unknown> }> = []

  constructor(private readonly db: PrismaClient) {}

  before(description: string, run: () => Promise<unknown>): void {
    this.beforeCleanup.push({ description, run })
  }

  private track(description: string, run: () => Promise<unknown>): void {
    this.steps.push({ description, run })
  }

  trackApprovalRow(id: string): void {
    this.track(`request_approvals ${id}`, () => this.db.request_approvals.deleteMany({ where: { id } }))
  }

  trackSolutionApprovalRow(id: string): void {
    this.track(`solution_approvals ${id}`, () => this.db.solution_approvals.deleteMany({ where: { id } }))
  }

  trackCandidateGroup(id: string): void {
    this.track(`approval_candidate_groups ${id}`, () => this.db.approval_candidate_groups.deleteMany({ where: { id } }))
  }

  trackInstance(id: string): void {
    this.track(`approval_instances ${id}`, () => this.db.approval_instances.deleteMany({ where: { id } }))
  }

  trackRequest(id: string): void {
    this.track(`requests ${id}`, () => this.db.requests.deleteMany({ where: { id } }))
  }

  trackUnit(id: string): void {
    this.track(`organization_units ${id}`, () => this.db.organization_units.deleteMany({ where: { id } }))
  }

  trackUser(id: string): void {
    this.track(`users ${id}`, () => this.db.user.deleteMany({ where: { id } }))
  }

  trackDepartment(id: string): void {
    this.track(`departments ${id}`, () => this.db.departments.deleteMany({ where: { id } }))
  }

  async run(): Promise<void> {
    const preconditionFailures: Array<{ description: string; error: unknown }> = []
    for (const step of this.beforeCleanup) {
      try {
        await step.run()
      } catch (error) {
        preconditionFailures.push({ description: step.description, error })
      }
    }
    // Fixture deletion is unsafe until every participant has drained. Do not
    // continue into FK cleanup when a precondition failed.
    if (preconditionFailures.length > 0) {
      throw new AggregateError(
        preconditionFailures.map((failure) =>
          failure.error instanceof Error ? failure.error : new Error(String(failure.error)),
        ),
        `cleanup preconditions failed: ${preconditionFailures.map((failure) => failure.description).join(', ')}`,
      )
    }

    const failures: Array<{ description: string; error: unknown }> = []
    for (const step of [...this.steps].reverse()) {
      try {
        await step.run()
      } catch (error) {
        failures.push({ description: step.description, error })
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) =>
          failure.error instanceof Error ? failure.error : new Error(String(failure.error)),
        ),
        `scoped cleanup failures: ${failures.map((failure) => failure.description).join(', ')}`,
      )
    }
  }
}

const PARTICIPANT_READINESS_TIMEOUT_MS = 15000
const PARTICIPANT_DRAIN_TIMEOUT_MS = PINNED_TX_OPTIONS.timeout + 5000

/**
 * Owns barriers and started transaction promises for one concurrency case.
 * Readiness waits fail as soon as a participant ends before signalling; close
 * always releases barriers, drains every started transaction, and disconnects
 * only after the drain succeeds.
 */
class ParticipantLifecycle {
  private readonly participants: Promise<unknown>[] = []
  private readonly releases: Array<() => void> = []
  private closePromise: Promise<void> | null = null

  constructor(
    private readonly cleanup: ScenarioCleanup,
    private readonly clients: PrismaClient[],
  ) {
    cleanup.before('participant drain and disconnect', () => this.close())
  }

  ownBarrier(release: () => void): void {
    this.releases.push(release)
  }

  start<T>(promise: Promise<T>): Promise<T> {
    const participant = Promise.resolve(promise)
    this.participants.push(participant)
    // Attach immediately; readiness and final drain add their own observers.
    void participant.catch(() => {})
    return promise
  }

  async waitFor(
    condition: () => boolean | Promise<boolean>,
    message: string,
    deadlineMs = PARTICIPANT_READINESS_TIMEOUT_MS,
  ): Promise<void> {
    const readiness = waitFor(condition, message, deadlineMs)
    const participantFailures = this.participants.map((participant) =>
      participant.then(
        () => {
          throw new Error(`${message}: participant completed before signalling`)
        },
        (error: unknown) => {
          const failure = new Error(`${message}: participant failed before signalling: ${String(error)}`)
          ;(failure as Error & { cause?: unknown }).cause = error
          throw failure
        },
      ),
    )
    await Promise.race([readiness, ...participantFailures])
  }

  async waitForSignal(signal: Promise<unknown>, message: string): Promise<void> {
    const readiness = signal.then(() => undefined)
    const participantFailures = this.participants.map((participant) =>
      participant.then(
        () => {
          throw new Error(`${message}: participant completed before signalling`)
        },
        (error: unknown) => {
          const failure = new Error(`${message}: participant failed before signalling: ${String(error)}`)
          ;(failure as Error & { cause?: unknown }).cause = error
          throw failure
        },
      ),
    )
    await Promise.race([readiness, ...participantFailures])
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closePromise = this.releaseDrainAndDisconnect()
    return this.closePromise
  }

  private async releaseDrainAndDisconnect(): Promise<void> {
    const releaseFailures: unknown[] = []
    for (const release of this.releases) {
      try {
        release()
      } catch (error) {
        releaseFailures.push(error)
      }
    }

    let drained = false
    let drainTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled(this.participants),
        new Promise<never>((_, reject) => {
          drainTimeout = setTimeout(
            () => reject(new Error(`participant drain timed out after ${PARTICIPANT_DRAIN_TIMEOUT_MS}ms`)),
            PARTICIPANT_DRAIN_TIMEOUT_MS,
          )
        }),
      ])
      drained = true
    } catch (error) {
      throw new AggregateError(
        [
          ...releaseFailures,
          error,
        ].map((failure) => (failure instanceof Error ? failure : new Error(String(failure)))),
        'participant lifecycle teardown failed; fixture cleanup is unsafe',
      )
    } finally {
      if (drainTimeout) clearTimeout(drainTimeout)
    }

    if (!drained || releaseFailures.length > 0) {
      throw new AggregateError(
        releaseFailures.map((error) => (error instanceof Error ? error : new Error(String(error)))),
        'participant lifecycle teardown failed; fixture cleanup is unsafe',
      )
    }

    const disconnectFailures: unknown[] = []
    for (const db of this.clients) {
      try {
        await db.$disconnect()
      } catch (error) {
        disconnectFailures.push(error)
      }
    }
    if (disconnectFailures.length > 0) {
      throw new AggregateError(
        disconnectFailures.map((error) => (error instanceof Error ? error : new Error(String(error)))),
        'participant client disconnect failed',
      )
    }
  }
}

async function withParticipantLifecycle<T>(
  lifecycle: ParticipantLifecycle,
  body: (participants: ParticipantLifecycle) => Promise<T>,
): Promise<T> {
  let result!: T
  let bodyFailed = false
  let bodyError: unknown
  let teardownError: unknown
  try {
    result = await body(lifecycle)
  } catch (error) {
    bodyFailed = true
    bodyError = error
  } finally {
    try {
      await lifecycle.close()
    } catch (error) {
      teardownError = error
    }
  }

  if (bodyFailed && teardownError) {
    throw new AggregateError(
      [bodyError, teardownError].map((error) => (error instanceof Error ? error : new Error(String(error)))),
      'test failure and participant teardown failure',
    )
  }
  if (bodyFailed) throw bodyError
  if (teardownError) throw teardownError
  return result
}

interface AutoAuditSeed {
  departmentId: string
  requesterId: string
  originUserId: string
  unitId: string
  requestId: string
  instanceId: string
  cleanup: ScenarioCleanup
}

/**
 * Seeds a complete, self-contained organization-owned request with a
 * SNAPSHOT_GROUP instance, in actual FK order. Cleanup is registered with the
 * test BEFORE the first seed write, so even partial setup failure is cleaned.
 */
async function seedAutoAuditScenario(
  db: PrismaClient,
  base: number,
  t: { after: (fn: () => unknown) => void },
  overrides: { instanceState?: 'PENDING' | 'AUTO_APPROVED'; phase?: 'REQUEST' | 'FINAL' } = {},
): Promise<AutoAuditSeed> {
  const cleanup = new ScenarioCleanup(db)
  // Registered before the first seed write: partial setup failure is cleaned.
  t.after(() => cleanup.run())

  const departmentId = scenarioId(base + 1)
  const requesterId = scenarioId(base + 2)
  const originUserId = scenarioId(base + 3)
  const unitId = scenarioId(base + 4)
  const requestId = scenarioId(base + 5)
  const instanceId = scenarioId(base + 6)

  cleanup.trackDepartment(departmentId)
  await db.departments.create({
    data: { id: departmentId, name: `CI dept ${departmentId}`, type: 'GENERAL' },
  })

  cleanup.trackUser(requesterId)
  cleanup.trackUser(originUserId)
  await db.user.createMany({
    data: [
      { id: requesterId, name: `CI requester ${base}`, email: `ci-requester-${base}@example.test`, isActive: true, departmentId },
      { id: originUserId, name: `CI origin ${base}`, email: `ci-origin-${base}@example.test`, isActive: true },
    ],
  })

  cleanup.trackUnit(unitId)
  await db.organization_units.create({
    data: { id: unitId, name: `CI unit ${unitId}`, unitType: 'FACTORY', operationalType: 'GENERAL' },
  })

  cleanup.trackRequest(requestId)
  await db.requests.create({
    data: {
      id: requestId,
      title: `CI request ${base}`,
      description: 'CI',
      status: 'SentToEngineer',
      requesterId,
      departmentId: null,
      organizationUnitId: unitId,
    },
  })

  cleanup.trackInstance(instanceId)
  await db.approval_instances.create({
    data: {
      id: instanceId,
      requestId,
      phase: overrides.phase ?? 'REQUEST',
      originUserId,
      originUnitId: unitId,
      originContext: {},
      routingMode: 'SNAPSHOT_GROUP',
      state: overrides.instanceState ?? 'AUTO_APPROVED',
    },
  })

  return { departmentId, requesterId, originUserId, unitId, requestId, instanceId, cleanup }
}

/** Lock-timeout safety inside pinned transactions: bounded waits, no hangs. */
async function setLocalLockTimeout(tx: Prisma.TransactionClient, timeout = '10s'): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${timeout}'`)
}

async function backendPid(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRawUnsafe<Array<{ pid: number }>>('SELECT pg_backend_pid() AS pid')
  return Number(rows[0]?.pid ?? 0)
}

ci('organization approval row-integrity constraints (CI database)', () => {
  it('accepts version-0 historical rows with null level and null designated approver', async (t) => {
    const db = client()
    const cleanup = new ScenarioCleanup(db)
    t.after(() => cleanup.run())

    const departmentId = scenarioId(1)
    const requesterId = scenarioId(2)
    const requestId = scenarioId(3)
    const rowId = scenarioId(4)
    cleanup.trackDepartment(departmentId)
    cleanup.trackUser(requesterId)
    cleanup.trackRequest(requestId)
    cleanup.trackApprovalRow(rowId)

    await db.departments.create({ data: { id: departmentId, name: `CI dept ${departmentId}`, type: 'GENERAL' } })
    await db.user.create({ data: { id: requesterId, name: 'CI requester', email: `ci-${requesterId}@example.test`, isActive: true, departmentId } })
    await db.requests.create({
      data: { id: requestId, title: 'CI v0 history', description: 'CI', status: 'ImprovementRequest', requesterId, departmentId },
    })

    const row = await db.request_approvals.create({
      data: {
        id: rowId,
        requestId,
        requiredLevel: null,
        requiredApproverId: null,
        order: 1,
        status: 'approved',
        isCustomChain: true,
        routingMode: 'CUSTOM_PERSON',
        integrityVersion: 0,
      },
    })
    assert.equal(row.integrityVersion, 0)
    assert.equal(row.routingMode, 'CUSTOM_PERSON')
  })

  it('rejects a version-0 row masquerading as SNAPSHOT_GROUP', async (t) => {
    const db = client()
    const cleanup = new ScenarioCleanup(db)
    t.after(() => cleanup.run())

    const departmentId = scenarioId(11)
    const requesterId = scenarioId(12)
    const requestId = scenarioId(13)
    const rowId = scenarioId(14)
    cleanup.trackDepartment(departmentId)
    cleanup.trackUser(requesterId)
    cleanup.trackRequest(requestId)
    cleanup.trackApprovalRow(rowId)

    await db.departments.create({ data: { id: departmentId, name: `CI dept ${departmentId}`, type: 'GENERAL' } })
    await db.user.create({ data: { id: requesterId, name: 'CI requester', email: `ci-${requesterId}@example.test`, isActive: true, departmentId } })
    await db.requests.create({
      data: { id: requestId, title: 'CI v0 masquerade', description: 'CI', status: 'ImprovementRequest', requesterId, departmentId },
    })

    await assert.rejects(
      () =>
        db.request_approvals.create({
          data: {
            id: rowId,
            requestId,
            order: 1,
            status: 'approved',
            routingMode: 'SNAPSHOT_GROUP',
            integrityVersion: 0,
          },
        }),
      /row_mode_integrity/,
    )
  })

  it('accepts a strict version-1 approved auto self-audit row without a candidate group', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 20, t)
    const rowId = scenarioId(27)
    seed.cleanup.trackApprovalRow(rowId)

    await db.$transaction((tx) =>
      tx.request_approvals.create({
        data: {
          id: rowId,
          requestId: seed.requestId,
          approverId: seed.originUserId,
          order: 1,
          status: 'approved',
          isFinalApproval: false,
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          instanceId: seed.instanceId,
          requiredPosition: 'SUPERVISOR',
        },
      }),
    )
    const row = await db.request_approvals.findUnique({ where: { id: rowId } })
    assert.ok(row)
    assert.equal(row.candidateGroupId, null)
  })

  it('accepts a pending group-less row that gains its candidate group later in the same transaction', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 30, t)
    const rowId = scenarioId(38)
    const candidateGroupId = scenarioId(37)
    seed.cleanup.trackCandidateGroup(candidateGroupId)
    seed.cleanup.trackApprovalRow(rowId)

    await db.approval_candidate_groups.create({
      data: {
        id: candidateGroupId,
        approvalInstanceId: seed.instanceId,
        requiredPosition: 'SUPERVISOR',
        scopeUnitId: seed.unitId,
      },
    })
    // The INSERT queues a group-less trigger event; the UPDATE attaches the
    // group before commit. Latest-row applicability must make the final
    // grouped state succeed.
    await db.$transaction(async (tx) => {
      await tx.request_approvals.create({
        data: {
          id: rowId,
          requestId: seed.requestId,
          order: 1,
          status: 'pending',
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          instanceId: seed.instanceId,
          requiredPosition: 'SUPERVISOR',
        },
      })
      await tx.request_approvals.update({
        where: { id: rowId },
        data: { candidateGroupId },
      })
    })
    const row = await db.request_approvals.findUnique({ where: { id: rowId } })
    assert.ok(row)
    assert.equal(row.candidateGroupId, candidateGroupId)
  })

  it('accepts inserting and deleting a group-less row within the same transaction', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 40, t)
    const rowId = scenarioId(47)
    seed.cleanup.trackApprovalRow(rowId)

    await db.$transaction(async (tx) => {
      await tx.request_approvals.create({
        data: {
          id: rowId,
          requestId: seed.requestId,
          order: 1,
          status: 'pending',
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          instanceId: seed.instanceId,
          requiredPosition: 'SUPERVISOR',
        },
      })
      await tx.request_approvals.delete({ where: { id: rowId } })
    })
    const row = await db.request_approvals.findUnique({ where: { id: rowId } })
    assert.equal(row, null)
  })

  it('accepts ordinary grouped version-1 snapshot rows', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 50, t)
    const rowId = scenarioId(58)
    const candidateGroupId = scenarioId(57)
    seed.cleanup.trackCandidateGroup(candidateGroupId)
    seed.cleanup.trackApprovalRow(rowId)

    await db.approval_candidate_groups.create({
      data: {
        id: candidateGroupId,
        approvalInstanceId: seed.instanceId,
        requiredPosition: 'SUPERVISOR',
        scopeUnitId: seed.unitId,
      },
    })
    await db.$transaction((tx) =>
      tx.request_approvals.create({
        data: {
          id: rowId,
          requestId: seed.requestId,
          order: 1,
          status: 'pending',
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          instanceId: seed.instanceId,
          requiredPosition: 'SUPERVISOR',
          candidateGroupId,
        },
      }),
    )
  })

  it('rejects a version-1 rejected group-less snapshot row on a pending instance', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 60, t, { instanceState: 'PENDING' })
    const rowId = scenarioId(67)
    seed.cleanup.trackApprovalRow(rowId)

    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          tx.request_approvals.create({
            data: {
              id: rowId,
              requestId: seed.requestId,
              approverId: seed.originUserId,
              order: 1,
              status: 'rejected',
              routingMode: 'SNAPSHOT_GROUP',
              integrityVersion: 1,
              instanceId: seed.instanceId,
              requiredPosition: 'SUPERVISOR',
            },
          }),
        ),
      /group-less snapshot/,
    )
  })

  it('rejects malformed final group-less rows (wrong approver on a FINAL instance)', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 70, t, { phase: 'FINAL' })
    const rowId = scenarioId(77)
    seed.cleanup.trackApprovalRow(rowId)

    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          tx.request_approvals.create({
            data: {
              id: rowId,
              requestId: seed.requestId,
              approverId: seed.requesterId, // NOT the instance origin user
              order: 1,
              status: 'approved',
              isFinalApproval: true,
              routingMode: 'SNAPSHOT_GROUP',
              integrityVersion: 1,
              instanceId: seed.instanceId,
              requiredPosition: 'DEPARTMENT_MANAGER',
            },
          }),
        ),
      /group-less snapshot/,
    )
  })

  it('rejects a later instance state mutation that would invalidate an existing audit row', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 80, t)
    const rowId = scenarioId(84)
    seed.cleanup.trackApprovalRow(rowId)

    await db.request_approvals.create({
      data: {
        id: rowId,
        requestId: seed.requestId,
        approverId: seed.originUserId,
        order: 1,
        status: 'approved',
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
        instanceId: seed.instanceId,
        requiredPosition: 'SUPERVISOR',
      },
    })
    await assert.rejects(
      () => db.approval_instances.update({ where: { id: seed.instanceId }, data: { state: 'PENDING' } }),
      /invalidate an existing group-less snapshot audit row/,
    )
    const instance = await db.approval_instances.findUnique({ where: { id: seed.instanceId } })
    assert.ok(instance)
    assert.equal(instance.state, 'AUTO_APPROVED', 'the rejected mutation must not partially apply')
  })

  it('preserves SetNull deletion semantics for version-0 custom designated approvers distinct from the requester', async (t) => {
    const db = client()
    const cleanup = new ScenarioCleanup(db)
    // Registered before the first write; unconditional idempotent deletes
    // (the already-deleted approver simply deletes zero rows).
    t.after(() => cleanup.run())

    const departmentId = scenarioId(91)
    const requesterId = scenarioId(92)
    const designatedApproverId = scenarioId(93)
    const requestId = scenarioId(94)
    const rowId = scenarioId(95)
    cleanup.trackDepartment(departmentId)
    cleanup.trackUser(requesterId)
    cleanup.trackUser(designatedApproverId)
    cleanup.trackRequest(requestId)
    cleanup.trackApprovalRow(rowId)

    await db.departments.create({ data: { id: departmentId, name: `CI dept ${departmentId}`, type: 'GENERAL' } })
    // Requester and designated approver are distinct users: deleting the
    // approver must not be confounded by the requester FK (Restrict).
    await db.user.create({ data: { id: requesterId, name: 'CI requester', email: `ci-${requesterId}@example.test`, isActive: true, departmentId } })
    await db.user.create({ data: { id: designatedApproverId, name: 'CI designated approver', email: `ci-${designatedApproverId}@example.test`, isActive: true } })
    await db.requests.create({
      data: { id: requestId, title: 'CI SetNull', description: 'CI', status: 'ImprovementRequest', requesterId, departmentId },
    })
    await db.request_approvals.create({
      data: {
        id: rowId,
        requestId,
        requiredApproverId: designatedApproverId,
        requiredLevel: null,
        order: 1,
        status: 'pending',
        isCustomChain: true,
        routingMode: 'CUSTOM_PERSON',
        integrityVersion: 0,
      },
    })

    await db.user.delete({ where: { id: designatedApproverId } })

    const row = await db.request_approvals.findUnique({ where: { id: rowId } })
    assert.ok(row, 'the approval row itself must survive the approver deletion')
    // Exact deleted-approver field nulling:
    assert.equal(row.requiredApproverId, null)
    // All other identity fields preserved:
    assert.equal(row.requestId, requestId)
    assert.equal(row.requiredLevel, null)
    assert.equal(row.order, 1)
    assert.equal(row.status, 'pending')
    assert.equal(row.isCustomChain, true)
    assert.equal(row.routingMode, 'CUSTOM_PERSON')
    assert.equal(row.integrityVersion, 0)
    // Other identities/rows preserved:
    const requester = await db.user.findUnique({ where: { id: requesterId } })
    assert.ok(requester, 'the distinct requester must be untouched')
    const request = await db.requests.findUnique({ where: { id: requestId } })
    assert.ok(request)
    assert.equal(request.requesterId, requesterId)
  })

  it('audit-first: the audit validation holds FOR SHARE and the concurrent demotion fails by integrity error', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 100, t)
    const rowId = scenarioId(107)
    seed.cleanup.trackApprovalRow(rowId)

    const c1 = newClient()
    const c2 = newClient()
    const lifecycle = new ParticipantLifecycle(seed.cleanup, [c1, c2])
    await withParticipantLifecycle(lifecycle, async (participants) => {
    await c1.$connect()
    await c2.$connect()

    const observed = { pidA: 0, pidB: 0 }
    let releaseAuditTransaction = (): void => {}
    participants.ownBarrier(() => releaseAuditTransaction())

    // Connection A: pinned interactive transaction. Insert the valid audit
    // row and force its deferred validation to run NOW (SET CONSTRAINTS ALL
    // IMMEDIATE) while the transaction stays open holding FOR SHARE.
    const txAPromise = participants.start(c1.$transaction(
      async (txA) => {
        await setLocalLockTimeout(txA)
        await txA.$executeRawUnsafe(
          `INSERT INTO "request_approvals" ("id", "requestId", "approverId", "order", "status", "routingMode", "integrityVersion", "instanceId", "requiredPosition") VALUES ('${rowId}', '${seed.requestId}', '${seed.originUserId}', 1, 'approved', 'SNAPSHOT_GROUP', 1, '${seed.instanceId}', 'SUPERVISOR')`,
        )
        await txA.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
        observed.pidA = await backendPid(txA)
        await new Promise<void>((resolve) => {
          releaseAuditTransaction = resolve
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, ...PINNED_TX_OPTIONS },
    ))
    await participants.waitFor(() => observed.pidA !== 0, 'audit transaction never signalled its backend pid')

    // Connection B: pinned READ COMMITTED transaction demoting the instance.
    // Its UPDATE must block on A's FOR SHARE.
    const txBPromise = participants.start(c2.$transaction(
      async (txB) => {
        await setLocalLockTimeout(txB, '30s')
        observed.pidB = await backendPid(txB)
        await txB.$executeRawUnsafe(
          `UPDATE "approval_instances" SET "state" = 'PENDING' WHERE "id" = '${seed.instanceId}'`,
        )
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, ...PINNED_TX_OPTIONS },
    ))
    await participants.waitFor(() => observed.pidB !== 0, 'demotion transaction never signalled its backend pid')

    // Bounded observer on a separate connection: prove B is actually blocked
    // by A before releasing anything.
    await participants.waitFor(
      async () => {
        const blockers = await db.$queryRawUnsafe<Array<{ blockers: number[] }>>(
          `SELECT ARRAY(SELECT unnest(pg_blocking_pids(${observed.pidB}))) AS blockers`,
        )
        return (blockers[0]?.blockers ?? []).includes(observed.pidA)
      },
      'the demotion UPDATE never reached the FOR SHARE wait on the audit transaction',
    )

    // Release A: the audit transaction commits (validation already passed).
    releaseAuditTransaction()
    await txAPromise

    // B's UPDATE proceeds against the committed audit row; its deferred
    // commit validation must fail by integrity error — never lock timeout.
    await assert.rejects(() => txBPromise, /group-less snapshot/)

    const instance = await db.approval_instances.findUnique({ where: { id: seed.instanceId } })
    assert.ok(instance)
    assert.equal(instance.state, 'AUTO_APPROVED', 'the audit-committed state must survive')
    const row = await db.request_approvals.findUnique({ where: { id: rowId } })
    assert.ok(row, 'the valid audit row must be persisted')
    })
  })

  it('demotion-first: a demotion holding its update lock forces the audit validation to fail (alternate lock order)', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 200, t)
    const rowId = scenarioId(207)
    seed.cleanup.trackApprovalRow(rowId)

    const c1 = newClient()
    const c2 = newClient()
    const lifecycle = new ParticipantLifecycle(seed.cleanup, [c1, c2])
    await withParticipantLifecycle(lifecycle, async (participants) => {
    await c1.$connect()
    await c2.$connect()

    const observed = { pidA: 0, pidB: 0 }
    let releaseDemotion = (): void => {}
    participants.ownBarrier(() => releaseDemotion())

    // Connection B: pinned transaction demotes the instance FIRST and holds
    // its update lock open until the audit side is confirmed blocked on it.
    const txBPromise = participants.start(c2.$transaction(
      async (txB) => {
        await setLocalLockTimeout(txB)
        observed.pidB = await backendPid(txB)
        await txB.$executeRawUnsafe(
          `UPDATE "approval_instances" SET "state" = 'PENDING' WHERE "id" = '${seed.instanceId}'`,
        )
        await new Promise<void>((resolve) => {
          releaseDemotion = resolve
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, ...PINNED_TX_OPTIONS },
    ))
    await participants.waitFor(() => observed.pidB !== 0, 'demotion transaction never signalled its backend pid')

    // Connection A: pinned transaction inserts the audit row and forces its
    // deferred validation; the FOR SHARE must block on B's held update lock.
    const txAPromise = participants.start(c1.$transaction(
      async (txA) => {
        await setLocalLockTimeout(txA, '30s')
        observed.pidA = await backendPid(txA)
        await txA.$executeRawUnsafe(
          `INSERT INTO "request_approvals" ("id", "requestId", "approverId", "order", "status", "routingMode", "integrityVersion", "instanceId", "requiredPosition") VALUES ('${rowId}', '${seed.requestId}', '${seed.originUserId}', 1, 'approved', 'SNAPSHOT_GROUP', 1, '${seed.instanceId}', 'SUPERVISOR')`,
        )
        await txA.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, ...PINNED_TX_OPTIONS },
    ))
    await participants.waitFor(() => observed.pidA !== 0, 'audit transaction never signalled its backend pid')

    // Bounded observer: prove the audit validation is actually blocked by the
    // held demotion before releasing it.
    await participants.waitFor(
      async () => {
        const blockers = await db.$queryRawUnsafe<Array<{ blockers: number[] }>>(
          `SELECT ARRAY(SELECT unnest(pg_blocking_pids(${observed.pidA}))) AS blockers`,
        )
        return (blockers[0]?.blockers ?? []).includes(observed.pidB)
      },
      'the audit validation never reached the FOR SHARE wait on the held demotion',
    )

    // Release B: its deferred scan cannot see the uncommitted audit row, so
    // the demotion commits and releases the lock.
    releaseDemotion()
    await txBPromise

    // A's validation then reads the demoted state and must reject the row.
    await assert.rejects(() => txAPromise, /group-less snapshot/)

    const instance = await db.approval_instances.findUnique({ where: { id: seed.instanceId } })
    assert.ok(instance)
    assert.equal(instance.state, 'PENDING', 'the demotion is the surviving committed state')
    const row = await db.request_approvals.findFirst({ where: { instanceId: seed.instanceId } })
    assert.equal(row, null, 'the invalid audit row must not be persisted')
    })
  })

  it('rejects REPEATABLE READ demotion whose snapshot predates the committed audit row', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 300, t)
    const rowId = scenarioId(307)
    seed.cleanup.trackApprovalRow(rowId)

    const c2 = newClient()
    const lifecycle = new ParticipantLifecycle(seed.cleanup, [c2])
    await withParticipantLifecycle(lifecycle, async (participants) => {
    await c2.$connect()

    let snapshotEstablished = (): void => {}
    const snapshotPromise = new Promise<void>((resolve) => {
      snapshotEstablished = resolve
    })
    let releaseDemotion = (): void => {}
    participants.ownBarrier(() => releaseDemotion())
    const releasePromise = new Promise<void>((resolve) => {
      releaseDemotion = resolve
    })

    // B starts REPEATABLE READ and establishes its snapshot BEFORE the audit
    // row exists.
    const txBPromise = participants.start(c2.$transaction(
      async (txB) => {
        await txB.$queryRawUnsafe('SELECT 1')
        snapshotEstablished()
        await releasePromise
        await txB.$executeRawUnsafe(
          `UPDATE "approval_instances" SET "state" = 'PENDING' WHERE "id" = '${seed.instanceId}'`,
        )
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, ...PINNED_TX_OPTIONS },
    ))
    await participants.waitForSignal(snapshotPromise, 'REPEATABLE READ transaction never established its snapshot')

    // A commits a valid audit row (plain autocommit write; READ COMMITTED
    // validation passes against the AUTO_APPROVED instance).
    await db.request_approvals.create({
      data: {
        id: rowId,
        requestId: seed.requestId,
        approverId: seed.originUserId,
        order: 1,
        status: 'approved',
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
        instanceId: seed.instanceId,
        requiredPosition: 'SUPERVISOR',
      },
    })

    // B demotes and commits: the instance trigger gates isolation FIRST
    // (before the snapshot scan could miss the audit row) and must reject
    // REPEATABLE READ with the explicit integrity-isolation error.
    releaseDemotion()
    await assert.rejects(
      () => txBPromise,
      /requires READ COMMITTED or SERIALIZABLE isolation/,
    )

    // State and audit row are preserved; nothing invalid committed.
    const instance = await db.approval_instances.findUnique({ where: { id: seed.instanceId } })
    assert.ok(instance)
    assert.equal(instance.state, 'AUTO_APPROVED')
    const row = await db.request_approvals.findUnique({ where: { id: rowId } })
    assert.ok(row)
    })
  })

  it('under SERIALIZABLE a concurrent audit insert and demotion ends in a serialization/integrity failure, never an invalid commit', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 400, t)
    const rowId = scenarioId(407)
    seed.cleanup.trackApprovalRow(rowId)

    const c1 = newClient()
    const c2 = newClient()
    const lifecycle = new ParticipantLifecycle(seed.cleanup, [c1, c2])
    await withParticipantLifecycle(lifecycle, async (participants) => {
    await c1.$connect()
    await c2.$connect()

    // Concurrent pinned SERIALIZABLE transactions: audit insert + demotion.
    const outcomes = await Promise.allSettled([
      participants.start(c1.$transaction(
        async (txA) => {
          await setLocalLockTimeout(txA, '10s')
          await txA.$executeRawUnsafe(
            `INSERT INTO "request_approvals" ("id", "requestId", "approverId", "order", "status", "routingMode", "integrityVersion", "instanceId", "requiredPosition") VALUES ('${rowId}', '${seed.requestId}', '${seed.originUserId}', 1, 'approved', 'SNAPSHOT_GROUP', 1, '${seed.instanceId}', 'SUPERVISOR')`,
          )
          await txA.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, ...PINNED_TX_OPTIONS },
      )),
      participants.start(c2.$transaction(
        async (txB) => {
          await setLocalLockTimeout(txB, '10s')
          await txB.$executeRawUnsafe(
            `UPDATE "approval_instances" SET "state" = 'PENDING' WHERE "id" = '${seed.instanceId}'`,
          )
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, ...PINNED_TX_OPTIONS },
      )),
    ])

    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
    assert.ok(
      rejected.length >= 1,
      'SERIALIZABLE must not let both the audit insert and the demotion commit',
    )
    for (const rejection of rejected) {
      const message = String((rejection as PromiseRejectedResult).reason)
      assert.match(
        message,
        /group-less snapshot|invalidat|serializ|could not serialize/i,
        'every rejection must be an integrity or serialization failure',
      )
    }

    // The surviving committed combination must be valid: either the audit row
    // won (instance still AUTO_APPROVED) or the demotion won (no audit row).
    const instance = await db.approval_instances.findUnique({ where: { id: seed.instanceId } })
    assert.ok(instance)
    const rows = await db.request_approvals.findMany({ where: { instanceId: seed.instanceId } })
    const invalidCombination = instance.state === 'PENDING' && rows.length > 0
    assert.equal(invalidCombination, false, 'a demoted instance must never retain a group-less audit row')
    })
  })
})
