/**
 * Owner-provisioned disposable-CI integration tests for race-safe approval
 * advancement (Task 9).
 *
 * These tests are NOT part of `npm run check` and are NEVER executed locally —
 * they require ORGANIZATION_APPROVAL_CI_DATABASE_URL pointing at a disposable
 * database that already has the organization-approval migration. An explicit
 * guard rejects a CI URL equal to the application DATABASE_URL. PrismaClient
 * is always constructed with the explicit CI datasource URL.
 *
 * Two distinct candidates race through the real transaction adapter
 * (`createPrismaApprovalTransactionDb` + `advanceApprovalAtomically`) bound
 * to the seeded row. Exactly one conditional update may commit.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient, Prisma } from '@prisma/client'
import {
  advanceApprovalAtomically,
  createPrismaApprovalTransactionDb,
} from '@/lib/approval-engine/transactions'

const CI_DATABASE_URL = process.env.ORGANIZATION_APPROVAL_CI_DATABASE_URL
const hasCI = typeof CI_DATABASE_URL === 'string' && CI_DATABASE_URL.length > 0
const PINNED_TX_OPTIONS = { timeout: 60000, maxWait: 5000 } as const
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
  return `00000000-0009-4000-8000-${String(n).padStart(12, '0')}`
}

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

  trackActivity(requestId: string): void {
    this.track(`request_activities ${requestId}`, () => this.db.request_activities.deleteMany({ where: { requestId } }))
  }

  trackCandidateGroup(id: string): void {
    this.track(`approval_candidate_groups ${id}`, () => this.db.approval_candidate_groups.deleteMany({ where: { id } }))
  }

  trackInstance(id: string): void {
    this.track(`approval_instances ${id}`, () => this.db.approval_instances.deleteMany({ where: { id } }))
  }

  trackSolution(id: string): void {
    this.track(`solutions ${id}`, () => this.db.solutions.deleteMany({ where: { id } }))
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

const PARTICIPANT_DRAIN_TIMEOUT_MS = PINNED_TX_OPTIONS.timeout + 5000

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

  start<T>(promise: Promise<T>): Promise<T> {
    const participant = Promise.resolve(promise)
    this.participants.push(participant)
    void participant.catch(() => {})
    return promise
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closePromise = this.releaseDrainAndDisconnect()
    return this.closePromise
  }

  private async releaseDrainAndDisconnect(): Promise<void> {
    for (const release of this.releases) {
      try {
        release()
      } catch {
        /* best-effort */
      }
    }
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
    } finally {
      if (drainTimeout) clearTimeout(drainTimeout)
    }
    for (const db of this.clients) {
      await db.$disconnect()
    }
  }
}

async function withParticipantLifecycle<T>(
  lifecycle: ParticipantLifecycle,
  body: (participants: ParticipantLifecycle) => Promise<T>,
): Promise<T> {
  try {
    return await body(lifecycle)
  } finally {
    await lifecycle.close()
  }
}

interface RaceSeed {
  requestId: string
  approvalId: string
  firstCandidateId: string
  secondCandidateId: string
  cleanup: ScenarioCleanup
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
}

async function seedSnapshotRace(
  db: PrismaClient,
  base: number,
  t: { after: (fn: () => unknown) => void },
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL',
): Promise<RaceSeed> {
  const cleanup = new ScenarioCleanup(db)
  t.after(() => cleanup.run())

  const departmentId = scenarioId(base + 1)
  const requesterId = scenarioId(base + 2)
  const firstCandidateId = scenarioId(base + 3)
  const secondCandidateId = scenarioId(base + 4)
  const unitId = scenarioId(base + 5)
  const requestId = scenarioId(base + 6)
  const instanceId = scenarioId(base + 7)
  const groupId = scenarioId(base + 8)
  const approvalId = scenarioId(base + 9)
  const solutionId = scenarioId(base + 10)

  cleanup.trackDepartment(departmentId)
  await db.departments.create({
    data: { id: departmentId, name: `CI txn dept ${departmentId}`, type: 'GENERAL' },
  })

  cleanup.trackUser(requesterId)
  cleanup.trackUser(firstCandidateId)
  cleanup.trackUser(secondCandidateId)
  await db.user.createMany({
    data: [
      { id: requesterId, name: `CI requester ${base}`, email: `ci-txn-requester-${base}@example.test`, isActive: true, departmentId },
      { id: firstCandidateId, name: `CI cand A ${base}`, email: `ci-txn-a-${base}@example.test`, isActive: true },
      { id: secondCandidateId, name: `CI cand B ${base}`, email: `ci-txn-b-${base}@example.test`, isActive: true },
    ],
  })

  cleanup.trackUnit(unitId)
  await db.organization_units.create({
    data: { id: unitId, name: `CI txn unit ${unitId}`, unitType: 'FACTORY', operationalType: 'GENERAL' },
  })

  const requestStatus =
    phase === 'REQUEST' ? 'ImprovementRequest' : phase === 'SOLUTION' ? 'DesignCostEstimationApproval' : 'FinalApproval'

  cleanup.trackRequest(requestId)
  cleanup.trackActivity(requestId)
  await db.requests.create({
    data: {
      id: requestId,
      title: `CI txn ${phase} ${base}`,
      description: 'CI',
      status: requestStatus,
      requesterId,
      departmentId: null,
      organizationUnitId: unitId,
    },
  })

  if (phase === 'SOLUTION') {
    cleanup.trackSolution(solutionId)
    await db.solutions.create({
      data: {
        id: solutionId,
        requestId,
        title: `CI solution ${base}`,
        description: 'CI',
        costEstimate: 100,
        submittedById: requesterId,
      },
    })
  }

  cleanup.trackInstance(instanceId)
  await db.approval_instances.create({
    data: {
      id: instanceId,
      requestId: phase === 'SOLUTION' ? null : requestId,
      solutionId: phase === 'SOLUTION' ? solutionId : null,
      phase,
      originUserId: requesterId,
      originUnitId: unitId,
      originContext: {},
      routingMode: 'SNAPSHOT_GROUP',
      state: 'PENDING',
    },
  })

  cleanup.trackCandidateGroup(groupId)
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

  if (phase === 'SOLUTION') {
    cleanup.trackSolutionApprovalRow(approvalId)
    await db.solution_approvals.create({
      data: {
        id: approvalId,
        solutionId,
        order: 1,
        status: 'pending',
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
        instanceId,
        candidateGroupId: groupId,
        requiredPosition: 'SUPERVISOR',
      },
    })
  } else {
    cleanup.trackApprovalRow(approvalId)
    await db.request_approvals.create({
      data: {
        id: approvalId,
        requestId,
        order: 1,
        status: 'pending',
        isFinalApproval: phase === 'FINAL',
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
        instanceId,
        candidateGroupId: groupId,
        requiredPosition: 'SUPERVISOR',
      },
    })
  }

  return { requestId, approvalId, firstCandidateId, secondCandidateId, cleanup, phase }
}

async function approveAs(
  db: PrismaClient,
  seed: RaceSeed,
  actorId: string,
): Promise<{ actualActorId: string; plans: number }> {
  let plans = 0
  const result = await db.$transaction(
    async (tx) => {
      const advanced = await advanceApprovalAtomically(createPrismaApprovalTransactionDb(tx), {
        approvalId: seed.approvalId,
        actorId,
        phase: seed.phase,
      })
      plans += 1
      return advanced
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, ...PINNED_TX_OPTIONS },
  )
  return { actualActorId: result.actualActorId, plans }
}

async function countActualApprovalActivities(requestId: string): Promise<number> {
  return client().request_activities.count({
    where: {
      requestId,
      action: { in: ['approved', 'solution_approved', 'final_approval_approved'] },
    },
  })
}

async function countPhaseTransitions(requestId: string): Promise<number> {
  return client().request_activities.count({
    where: { requestId, action: 'status_changed' },
  })
}

async function runTwoCandidateRace(seed: RaceSeed): Promise<void> {
  const c1 = newClient()
  const c2 = newClient()
  const lifecycle = new ParticipantLifecycle(seed.cleanup, [c1, c2])
  await withParticipantLifecycle(lifecycle, async (participants) => {
    await c1.$connect()
    await c2.$connect()
    const results = await Promise.allSettled([
      participants.start(approveAs(c1, seed, seed.firstCandidateId)),
      participants.start(approveAs(c2, seed, seed.secondCandidateId)),
    ])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(await countActualApprovalActivities(seed.requestId), 1)
    assert.equal(await countPhaseTransitions(seed.requestId), 1)
    const winner = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ plans: number }>
    assert.equal(winner.value.plans, 1)
  })
}

ci('organization approval transactions (CI database)', () => {
  it('REQUEST: exactly one of two concurrent snapshot candidates advances', async (t) => {
    const seed = await seedSnapshotRace(client(), 900, t, 'REQUEST')
    await runTwoCandidateRace(seed)
  })

  it('SOLUTION: exactly one of two concurrent snapshot candidates advances', async (t) => {
    const seed = await seedSnapshotRace(client(), 920, t, 'SOLUTION')
    await runTwoCandidateRace(seed)
  })

  it('FINAL: exactly one of two concurrent snapshot candidates advances', async (t) => {
    const seed = await seedSnapshotRace(client(), 940, t, 'FINAL')
    await runTwoCandidateRace(seed)
  })

  it('cancellation versus approval: exactly one writer commits', async (t) => {
    const seed = await seedSnapshotRace(client(), 960, t, 'REQUEST')
    const c1 = newClient()
    const c2 = newClient()
    const lifecycle = new ParticipantLifecycle(seed.cleanup, [c1, c2])
    await withParticipantLifecycle(lifecycle, async (participants) => {
      await c1.$connect()
      await c2.$connect()
      const results = await Promise.allSettled([
        participants.start(approveAs(c1, seed, seed.firstCandidateId)),
        participants.start(
          c2.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT id FROM requests WHERE id = ${seed.requestId} FOR UPDATE`
              const updated = await tx.requests.updateMany({
                where: { id: seed.requestId, status: 'ImprovementRequest' },
                data: { status: 'Cancelled' },
              })
              if (updated.count !== 1) {
                throw new Error('conflict: request was no longer ImprovementRequest')
              }
              return updated
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, ...PINNED_TX_OPTIONS },
          ),
        ),
      ])
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
      const request = await client().requests.findUnique({ where: { id: seed.requestId } })
      assert.ok(request)
      if (request.status === 'Cancelled') {
        assert.equal(await countActualApprovalActivities(seed.requestId), 0)
      } else {
        assert.equal(await countActualApprovalActivities(seed.requestId), 1)
        assert.notEqual(request.status, 'Cancelled')
      }
    })
  })
})
