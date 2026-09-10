/**
 * Owner-provisioned disposable-CI integration tests for clean-start SQL
 * constraints and first-decision-wins races (Plan B Task 13).
 *
 * These tests are NOT part of `npm run check` (which only runs
 * tests/regression) and are NEVER executed locally — the source task has no
 * database authority and no migration may be applied here. They require a
 * database with the additive clean-start schema (including the hand-appended
 * partial unique indexes) already applied, provided ONLY through
 * CLEAN_START_CI_DATABASE_URL; without that variable every test self-skips.
 * An explicit guard rejects a CI URL equal to the application's DATABASE_URL,
 * and PrismaClient is always constructed with the explicit CI datasource URL,
 * so the target can never silently default to a local env. Protected local
 * database names (app_db, app_org_manual_7abcdf3, app_cleanstart_dev) are
 * rejected by name even if the URLs otherwise differ.
 *
 * Connection affinity: concurrency schedules NEVER issue raw
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

const CI_DATABASE_URL = process.env.CLEAN_START_CI_DATABASE_URL
const hasCI = typeof CI_DATABASE_URL === 'string' && CI_DATABASE_URL.length > 0
const PINNED_TX_OPTIONS = { timeout: 60000, maxWait: 5000 } as const
const PROTECTED_DATABASE_NAMES = new Set(['app_db', 'app_org_manual_7abcdf3', 'app_cleanstart_dev'])

const ci = hasCI ? describe : describe.skip

let prisma: PrismaClient | null = null

function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url)
  return decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] ?? '')
}

before(async () => {
  if (!hasCI) return
  assert.notEqual(
    CI_DATABASE_URL,
    process.env.DATABASE_URL,
    'CLEAN_START_CI_DATABASE_URL must not point at the application DATABASE_URL',
  )
  const dbName = databaseNameFromUrl(CI_DATABASE_URL as string)
  assert.equal(
    PROTECTED_DATABASE_NAMES.has(dbName),
    false,
    `CLEAN_START_CI_DATABASE_URL must not point at a protected database (got ${dbName})`,
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
  return `00000000-0013-4000-8000-${String(n).padStart(12, '0')}`
}

function errorDump(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `${error.code} ${error.message} ${JSON.stringify(error.meta)} ${String(error.cause ?? '')}`
  }
  if (error instanceof Error) {
    return `${error.message} ${String(error.cause ?? '')}`
  }
  return String(error)
}

function assertIndexViolation(error: unknown, indexName: string): void {
  assert.match(errorDump(error), new RegExp(indexName, 'i'))
}

function assertRestrictViolation(error: unknown): void {
  assert.match(
    errorDump(error),
    /P2003|foreign key constraint|restrict/i,
  )
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

  trackCandidateGroup(id: string): void {
    this.track(`approval_candidate_groups ${id}`, () => this.db.approval_candidate_groups.deleteMany({ where: { id } }))
  }

  trackInstance(id: string): void {
    this.track(`approval_instances ${id}`, () => this.db.approval_instances.deleteMany({ where: { id } }))
  }

  trackRequest(id: string): void {
    this.track(`requests ${id}`, () => this.db.requests.deleteMany({ where: { id } }))
  }

  trackRouteStep(id: string): void {
    this.track(`approval_route_steps ${id}`, () => this.db.approval_route_steps.deleteMany({ where: { id } }))
  }

  trackRouteVersion(id: string): void {
    this.track(`approval_route_versions ${id}`, () => this.db.approval_route_versions.deleteMany({ where: { id } }))
  }

  trackAssignment(id: string): void {
    this.track(`organization_assignments ${id}`, () => this.db.organization_assignments.deleteMany({ where: { id } }))
  }

  trackPosition(id: string): void {
    this.track(`positions ${id}`, () => this.db.positions.deleteMany({ where: { id } }))
  }

  trackUnit(id: string): void {
    this.track(`organization_units ${id}`, () => this.db.organization_units.deleteMany({ where: { id } }))
  }

  trackUser(id: string): void {
    this.track(`users ${id}`, () => this.db.user.deleteMany({ where: { id } }))
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
        [...releaseFailures, error].map((failure) => (failure instanceof Error ? failure : new Error(String(failure)))),
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

async function setLocalLockTimeout(tx: Prisma.TransactionClient, timeout = '10s'): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${timeout}'`)
}

async function backendPid(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRawUnsafe<Array<{ pid: number }>>('SELECT pg_backend_pid() AS pid')
  return Number(rows[0]?.pid ?? 0)
}

const FIRST_DECISION_CONFLICT =
  'Cannot approve - the approval is no longer pending or was changed concurrently.'

ci('clean-start SQL constraints and races (CI database)', () => {
  it('one_active_assignment_per_user rejects a second active assignment', async (t) => {
    const db = client()
    const cleanup = new ScenarioCleanup(db)
    t.after(() => cleanup.run())

    const userId = scenarioId(1)
    const unitA = scenarioId(2)
    const unitB = scenarioId(3)
    const positionId = scenarioId(4)
    const firstAssignmentId = scenarioId(5)
    const secondAssignmentId = scenarioId(6)

    cleanup.trackUser(userId)
    cleanup.trackUnit(unitA)
    cleanup.trackUnit(unitB)
    cleanup.trackPosition(positionId)
    cleanup.trackAssignment(firstAssignmentId)
    cleanup.trackAssignment(secondAssignmentId)

    await db.user.create({
      data: { id: userId, name: 'B13 assignment user', email: `b13-assign-${userId}@example.test`, isActive: true },
    })
    await db.organization_units.create({
      data: { id: unitA, name: `B13 unit A ${unitA}`, unitType: 'SECTION', operationalType: 'GENERAL' },
    })
    await db.organization_units.create({
      data: {
        id: unitB,
        name: `B13 unit B ${unitB}`,
        unitType: 'SECTION',
        operationalType: 'GENERAL',
        parentId: unitA,
      },
    })
    await db.positions.create({ data: { id: positionId, name: `B13 pos ${positionId}`, rank: 10, isActive: true } })
    await db.organization_assignments.create({
      data: { id: firstAssignmentId, userId, unitId: unitA, positionId, isActive: true },
    })

    await assert.rejects(
      () =>
        db.$executeRawUnsafe(
          `INSERT INTO "organization_assignments" ("id", "userId", "unitId", "positionId", "isActive", "updatedAt") VALUES ('${secondAssignmentId}', '${userId}', '${unitB}', '${positionId}', true, NOW())`,
        ),
      (error: unknown) => {
        assertIndexViolation(error, 'one_active_assignment_per_user')
        return true
      },
    )
  })

  it('one_active_company_root rejects a second active root', async (t) => {
    const db = client()
    const cleanup = new ScenarioCleanup(db)
    t.after(() => cleanup.run())

    const firstRootId = scenarioId(11)
    const secondRootId = scenarioId(12)
    cleanup.trackUnit(firstRootId)
    cleanup.trackUnit(secondRootId)

    await db.organization_units.create({
      data: {
        id: firstRootId,
        name: `B13 root ${firstRootId}`,
        unitType: 'FACTORY',
        parentId: null,
        isActive: true,
        operationalType: 'GENERAL',
      },
    })

    await assert.rejects(
      () =>
        db.$executeRawUnsafe(
          `INSERT INTO "organization_units" ("id", "name", "unitType", "parentId", "isActive", "updatedAt") VALUES ('${secondRootId}', 'B13 root ${secondRootId}', 'FACTORY', NULL, true, NOW())`,
        ),
      (error: unknown) => {
        assertIndexViolation(error, 'one_active_company_root')
        return true
      },
    )
  })

  it('one_published_route_per_scope_phase rejects a concurrent second publisher', async (t) => {
    const db = client()
    const cleanup = new ScenarioCleanup(db)
    t.after(() => cleanup.run())

    const createdById = scenarioId(21)
    const unitId = scenarioId(22)
    const firstVersionId = scenarioId(23)
    const secondVersionId = scenarioId(24)
    cleanup.trackUser(createdById)
    cleanup.trackUnit(unitId)
    cleanup.trackRouteVersion(firstVersionId)
    cleanup.trackRouteVersion(secondVersionId)

    await db.user.create({
      data: { id: createdById, name: 'B13 publisher', email: `b13-pub-${createdById}@example.test`, isActive: true },
    })
    await db.organization_units.create({
      data: { id: unitId, name: `B13 route unit ${unitId}`, unitType: 'SECTION', operationalType: 'GENERAL' },
    })

    const c1 = newClient()
    const c2 = newClient()
    const lifecycle = new ParticipantLifecycle(cleanup, [c1, c2])
    await withParticipantLifecycle(lifecycle, async (participants) => {
      await c1.$connect()
      await c2.$connect()

      const observed = { pidA: 0, pidB: 0 }
      let releaseFirstPublisher = (): void => {}
      participants.ownBarrier(() => releaseFirstPublisher())

      const txAPromise = participants.start(
        c1.$transaction(
          async (txA) => {
            await setLocalLockTimeout(txA)
            await txA.$executeRawUnsafe(
              `INSERT INTO "approval_route_versions" ("id", "scopeUnitId", "phase", "version", "maximumPositionLevel", "status", "createdById") VALUES ('${firstVersionId}', '${unitId}', 'REQUEST', 1, 5, 'PUBLISHED', '${createdById}')`,
            )
            observed.pidA = await backendPid(txA)
            await new Promise<void>((resolve) => {
              releaseFirstPublisher = resolve
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, ...PINNED_TX_OPTIONS },
        ),
      )
      await participants.waitFor(() => observed.pidA !== 0, 'first publisher never signalled its backend pid')

      const txBPromise = participants.start(
        c2.$transaction(
          async (txB) => {
            await setLocalLockTimeout(txB, '30s')
            observed.pidB = await backendPid(txB)
            await txB.$executeRawUnsafe(
              `INSERT INTO "approval_route_versions" ("id", "scopeUnitId", "phase", "version", "maximumPositionLevel", "status", "createdById") VALUES ('${secondVersionId}', '${unitId}', 'REQUEST', 2, 5, 'PUBLISHED', '${createdById}')`,
            )
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, ...PINNED_TX_OPTIONS },
        ),
      )
      await participants.waitFor(() => observed.pidB !== 0, 'second publisher never signalled its backend pid')

      await participants.waitFor(
        async () => {
          const blockers = await db.$queryRawUnsafe<Array<{ blockers: number[] }>>(
            `SELECT ARRAY(SELECT unnest(pg_blocking_pids(${observed.pidB}))) AS blockers`,
          )
          return (blockers[0]?.blockers ?? []).includes(observed.pidA)
        },
        'the second publisher INSERT never reached the unique-index wait on the first publisher',
      )

      releaseFirstPublisher()
      await txAPromise
      await assert.rejects(
        () => txBPromise,
        (error: unknown) => {
          assertIndexViolation(error, 'one_published_route_per_scope_phase')
          return true
        },
      )
    })

    const published = await db.approval_route_versions.findMany({
      where: { scopeUnitId: unitId, phase: 'REQUEST', status: 'PUBLISHED' },
    })
    assert.equal(published.length, 1)
    assert.equal(published[0]?.id, firstVersionId)
  })

  it('first-decision-wins under true PostgreSQL concurrency: second pinned transaction gets the conflict', async (t) => {
    const db = client()
    const cleanup = new ScenarioCleanup(db)
    t.after(() => cleanup.run())

    const requesterId = scenarioId(31)
    const firstCandidateId = scenarioId(32)
    const secondCandidateId = scenarioId(33)
    const unitId = scenarioId(34)
    const requestId = scenarioId(35)
    const instanceId = scenarioId(36)
    const groupId = scenarioId(37)
    const approvalId = scenarioId(38)

    cleanup.trackUser(requesterId)
    cleanup.trackUser(firstCandidateId)
    cleanup.trackUser(secondCandidateId)
    cleanup.trackUnit(unitId)
    cleanup.trackRequest(requestId)
    cleanup.trackInstance(instanceId)
    cleanup.trackCandidateGroup(groupId)
    cleanup.trackApprovalRow(approvalId)

    await db.user.createMany({
      data: [
        { id: requesterId, name: 'B13 requester', email: `b13-req-${requesterId}@example.test`, isActive: true },
        { id: firstCandidateId, name: 'B13 cand A', email: `b13-a-${firstCandidateId}@example.test`, isActive: true },
        { id: secondCandidateId, name: 'B13 cand B', email: `b13-b-${secondCandidateId}@example.test`, isActive: true },
      ],
    })
    await db.organization_units.create({
      data: { id: unitId, name: `B13 decision unit ${unitId}`, unitType: 'SECTION', operationalType: 'GENERAL' },
    })
    await db.requests.create({
      data: {
        id: requestId,
        title: 'B13 first-decision-wins',
        description: 'CI',
        status: 'ImprovementRequest',
        requesterId,
        organizationUnitId: unitId,
      },
    })
    await db.approval_instances.create({
      data: {
        id: instanceId,
        requestId,
        phase: 'REQUEST',
        originUserId: requesterId,
        originUnitId: unitId,
        originContext: {},
        routingMode: 'SNAPSHOT_GROUP',
        state: 'PENDING',
      },
    })
    await db.approval_candidate_groups.create({
      data: {
        id: groupId,
        approvalInstanceId: instanceId,
        requiredPosition: 'SUPERVISOR',
        scopeUnitId: unitId,
      },
    })
    await db.approval_candidate_group_members.createMany({
      data: [
        { candidateGroupId: groupId, userId: firstCandidateId, capturedDisplayName: 'A' },
        { candidateGroupId: groupId, userId: secondCandidateId, capturedDisplayName: 'B' },
      ],
    })
    await db.request_approvals.create({
      data: {
        id: approvalId,
        requestId,
        order: 1,
        status: 'pending',
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
        instanceId,
        candidateGroupId: groupId,
        requiredPosition: 'SUPERVISOR',
      },
    })

    const c1 = newClient()
    const c2 = newClient()
    const lifecycle = new ParticipantLifecycle(cleanup, [c1, c2])
    await withParticipantLifecycle(lifecycle, async (participants) => {
      await c1.$connect()
      await c2.$connect()

      const observed = { pidA: 0, pidB: 0 }
      let releaseFirstDecision = (): void => {}
      participants.ownBarrier(() => releaseFirstDecision())

      const txAPromise = participants.start(
        c1.$transaction(
          async (txA) => {
            await setLocalLockTimeout(txA)
            await txA.$executeRawUnsafe(`SELECT id FROM "request_approvals" WHERE id = '${approvalId}' FOR UPDATE`)
            const updated = await txA.$executeRawUnsafe(
              `UPDATE "request_approvals" SET "status" = 'approved', "approverId" = '${firstCandidateId}', "approvedAt" = NOW() WHERE "id" = '${approvalId}' AND "status" = 'pending'`,
            )
            if (Number(updated) !== 1) throw new Error(FIRST_DECISION_CONFLICT)
            observed.pidA = await backendPid(txA)
            await new Promise<void>((resolve) => {
              releaseFirstDecision = resolve
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, ...PINNED_TX_OPTIONS },
        ),
      )
      await participants.waitFor(() => observed.pidA !== 0, 'first decision never signalled its backend pid')

      const txBPromise = participants.start(
        c2.$transaction(
          async (txB) => {
            await setLocalLockTimeout(txB, '30s')
            observed.pidB = await backendPid(txB)
            await txB.$executeRawUnsafe(`SELECT id FROM "request_approvals" WHERE id = '${approvalId}' FOR UPDATE`)
            const updated = await txB.$executeRawUnsafe(
              `UPDATE "request_approvals" SET "status" = 'approved', "approverId" = '${secondCandidateId}', "approvedAt" = NOW() WHERE "id" = '${approvalId}' AND "status" = 'pending'`,
            )
            if (Number(updated) !== 1) throw new Error(FIRST_DECISION_CONFLICT)
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, ...PINNED_TX_OPTIONS },
        ),
      )
      await participants.waitFor(() => observed.pidB !== 0, 'second decision never signalled its backend pid')

      await participants.waitFor(
        async () => {
          const blockers = await db.$queryRawUnsafe<Array<{ blockers: number[] }>>(
            `SELECT ARRAY(SELECT unnest(pg_blocking_pids(${observed.pidB}))) AS blockers`,
          )
          return (blockers[0]?.blockers ?? []).includes(observed.pidA)
        },
        'the second decision never reached the FOR UPDATE wait on the first decision',
      )

      releaseFirstDecision()
      await txAPromise
      await assert.rejects(() => txBPromise, (error: unknown) => {
        assert.match(errorDump(error), /no longer pending or was changed concurrently/)
        return true
      })
    })

    const row = await db.request_approvals.findUnique({ where: { id: approvalId } })
    assert.ok(row)
    assert.equal(row.status, 'approved')
    assert.equal(row.approverId, firstCandidateId)
  })

  it('FK Restrict on position references blocks hard deletes', async (t) => {
    const db = client()
    const cleanup = new ScenarioCleanup(db)
    t.after(() => cleanup.run())

    const userId = scenarioId(41)
    const unitId = scenarioId(42)
    const positionId = scenarioId(43)
    const assignmentId = scenarioId(44)
    const createdById = scenarioId(45)
    const routeVersionId = scenarioId(46)
    const routeStepId = scenarioId(47)
    const requestId = scenarioId(48)
    const instanceId = scenarioId(49)
    const groupId = scenarioId(50)
    const approvalId = scenarioId(51)

    cleanup.trackUser(userId)
    cleanup.trackUser(createdById)
    cleanup.trackUnit(unitId)
    cleanup.trackPosition(positionId)
    cleanup.trackAssignment(assignmentId)
    cleanup.trackRouteVersion(routeVersionId)
    cleanup.trackRouteStep(routeStepId)
    cleanup.trackRequest(requestId)
    cleanup.trackInstance(instanceId)
    cleanup.trackCandidateGroup(groupId)
    cleanup.trackApprovalRow(approvalId)

    await db.user.createMany({
      data: [
        { id: userId, name: 'B13 restrict user', email: `b13-restrict-${userId}@example.test`, isActive: true },
        { id: createdById, name: 'B13 restrict creator', email: `b13-restrict-c-${createdById}@example.test`, isActive: true },
      ],
    })
    await db.organization_units.create({
      data: { id: unitId, name: `B13 restrict unit ${unitId}`, unitType: 'SECTION', operationalType: 'GENERAL' },
    })
    await db.positions.create({ data: { id: positionId, name: `B13 restrict pos ${positionId}`, rank: 20, isActive: true } })
    await db.organization_assignments.create({
      data: { id: assignmentId, userId, unitId, positionId, isActive: true },
    })

    await assert.rejects(() => db.positions.delete({ where: { id: positionId } }), (error: unknown) => {
      assertRestrictViolation(error)
      return true
    })

    await db.approval_route_versions.create({
      data: {
        id: routeVersionId,
        scopeUnitId: unitId,
        phase: 'REQUEST',
        version: 1,
        maximumPositionLevel: 5,
        status: 'DRAFT',
        createdById,
        approvalLimitPositionId: positionId,
      },
    })
    await db.approval_route_steps.create({
      data: {
        id: routeStepId,
        routeVersionId,
        stepOrder: 1,
        positionCode: 'SUPERVISOR',
        positionId,
      },
    })
    await assert.rejects(() => db.positions.delete({ where: { id: positionId } }), (error: unknown) => {
      assertRestrictViolation(error)
      return true
    })

    await db.requests.create({
      data: {
        id: requestId,
        title: 'B13 restrict',
        description: 'CI',
        status: 'ImprovementRequest',
        requesterId: userId,
        organizationUnitId: unitId,
      },
    })
    await db.approval_instances.create({
      data: {
        id: instanceId,
        requestId,
        phase: 'REQUEST',
        originUserId: userId,
        originUnitId: unitId,
        originContext: {},
        routingMode: 'SNAPSHOT_GROUP',
        state: 'PENDING',
        originAssignmentId: assignmentId,
        originPositionId: positionId,
      },
    })
    await db.approval_candidate_groups.create({
      data: {
        id: groupId,
        approvalInstanceId: instanceId,
        requiredPosition: 'SUPERVISOR',
        scopeUnitId: unitId,
        requiredPositionId: positionId,
      },
    })
    await db.request_approvals.create({
      data: {
        id: approvalId,
        requestId,
        order: 1,
        status: 'pending',
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
        instanceId,
        candidateGroupId: groupId,
        requiredPosition: 'SUPERVISOR',
        requiredPositionId: positionId,
      },
    })
    await assert.rejects(() => db.positions.delete({ where: { id: positionId } }), (error: unknown) => {
      assertRestrictViolation(error)
      return true
    })

    const stillThere = await db.positions.findUnique({ where: { id: positionId } })
    assert.ok(stillThere)
    assert.equal(stillThere.isActive, true)
  })

  it('restart self-relation preserves the old instance row', async (t) => {
    const db = client()
    const cleanup = new ScenarioCleanup(db)
    t.after(() => cleanup.run())

    const userId = scenarioId(61)
    const restarterId = scenarioId(62)
    const unitId = scenarioId(63)
    const requestId = scenarioId(64)
    const oldInstanceId = scenarioId(65)
    const newInstanceId = scenarioId(66)

    cleanup.trackUser(userId)
    cleanup.trackUser(restarterId)
    cleanup.trackUnit(unitId)
    cleanup.trackRequest(requestId)
    cleanup.trackInstance(oldInstanceId)
    cleanup.trackInstance(newInstanceId)

    await db.user.createMany({
      data: [
        { id: userId, name: 'B13 restart origin', email: `b13-restart-${userId}@example.test`, isActive: true },
        { id: restarterId, name: 'B13 restarter', email: `b13-restart-admin-${restarterId}@example.test`, isActive: true },
      ],
    })
    await db.organization_units.create({
      data: { id: unitId, name: `B13 restart unit ${unitId}`, unitType: 'SECTION', operationalType: 'GENERAL' },
    })
    await db.requests.create({
      data: {
        id: requestId,
        title: 'B13 restart',
        description: 'CI',
        status: 'ImprovementRequest',
        requesterId: userId,
        organizationUnitId: unitId,
      },
    })
    await db.approval_instances.create({
      data: {
        id: oldInstanceId,
        requestId,
        phase: 'REQUEST',
        originUserId: userId,
        originUnitId: unitId,
        originContext: {},
        routingMode: 'SNAPSHOT_GROUP',
        state: 'PENDING',
        attempt: 1,
      },
    })
    await db.approval_instances.create({
      data: {
        id: newInstanceId,
        requestId,
        phase: 'REQUEST',
        originUserId: userId,
        originUnitId: unitId,
        originContext: {},
        routingMode: 'SNAPSHOT_GROUP',
        state: 'PENDING',
        attempt: 2,
        restartOfInstanceId: oldInstanceId,
        restartReason: 'stranded candidates inactive',
        restartedById: restarterId,
      },
    })

    await assert.rejects(() => db.approval_instances.delete({ where: { id: oldInstanceId } }), (error: unknown) => {
      assertRestrictViolation(error)
      return true
    })

    const oldRow = await db.approval_instances.findUnique({ where: { id: oldInstanceId } })
    const newRow = await db.approval_instances.findUnique({ where: { id: newInstanceId } })
    assert.ok(oldRow)
    assert.ok(newRow)
    assert.equal(oldRow.state, 'PENDING')
    assert.equal(oldRow.attempt, 1)
    assert.equal(oldRow.restartOfInstanceId, null)
    assert.equal(newRow.restartOfInstanceId, oldInstanceId)
    assert.equal(newRow.restartReason, 'stranded candidates inactive')
    assert.equal(newRow.restartedById, restarterId)
  })
})
