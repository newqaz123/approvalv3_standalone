/**
 * Owner-provisioned disposable-CI integration tests for the organization
 * approval redesign row-integrity constraints (Task 2 fix round 2).
 *
 * These tests are NOT part of `npm run check` (which only runs
 * tests/regression) and are NEVER executed locally — the source task has no
 * database authority and no migration may be applied here. They require a
 * database with this migration already applied, provided ONLY through
 * ORGANIZATION_APPROVAL_CI_DATABASE_URL; without that variable every test
 * self-skips so the file is inert outside CI. An explicit guard rejects a CI
 * URL that equals the application's DATABASE_URL so the target can never
 * silently default to a local development database.
 *
 * What they prove beyond locally-assertable contracts: real PostgreSQL
 * execution of the row-mode CHECKs, latest-row applicability of the deferred
 * cross-table audit triggers, FOR SHARE per-instance serialization under two
 * connections with alternate completion orders, and SetNull compatibility.
 *
 * Fixture discipline (fix round 2): every scenario seeds its own
 * prerequisites in actual FK order (department -> users -> organization unit
 * -> request -> solution/instance -> approval rows / candidate groups), and
 * registers failure-safe cleanup immediately after the prerequisites exist,
 * deleting only this test's IDs in FK-safe reverse order — no truncation, no
 * global reset, no shared state between scenarios.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'

const CI_DATABASE_URL = process.env.ORGANIZATION_APPROVAL_CI_DATABASE_URL
const hasCI = typeof CI_DATABASE_URL === 'string' && CI_DATABASE_URL.length > 0

// A skipped describe still documents the CI contract for the reviewer.
const ci = hasCI ? describe : describe.skip

let prisma: PrismaClient | null = null

before(async () => {
  if (!hasCI) return
  // Guard: the test target must be the explicitly provisioned disposable CI
  // database and can never silently fall back to the application's
  // DATABASE_URL (PrismaClient is constructed with an explicit datasource).
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

function scenarioId(n: number): string {
  return `00000000-0004-4000-8000-${String(n).padStart(12, '0')}`
}

/** FK-safe cleanup for exactly the IDs a scenario created. Never throws. */
async function cleanupIds(
  db: PrismaClient,
  ids: {
    approvalRowIds?: string[]
    solutionApprovalRowIds?: string[]
    candidateGroupIds?: string[]
    instanceIds?: string[]
    solutionIds?: string[]
    requestIds?: string[]
    unitIds?: string[]
    userIds?: string[]
    departmentIds?: string[]
  },
): Promise<void> {
  for (const id of ids.approvalRowIds ?? []) {
    await db.request_approvals.deleteMany({ where: { id } }).catch(() => {})
  }
  for (const id of ids.solutionApprovalRowIds ?? []) {
    await db.solution_approvals.deleteMany({ where: { id } }).catch(() => {})
  }
  for (const id of ids.candidateGroupIds ?? []) {
    await db.approval_candidate_groups.deleteMany({ where: { id } }).catch(() => {})
  }
  for (const id of ids.instanceIds ?? []) {
    await db.approval_instances.deleteMany({ where: { id } }).catch(() => {})
  }
  for (const id of ids.solutionIds ?? []) {
    await db.solutions.deleteMany({ where: { id } }).catch(() => {})
  }
  for (const id of ids.requestIds ?? []) {
    await db.requests.deleteMany({ where: { id } }).catch(() => {})
  }
  for (const id of ids.unitIds ?? []) {
    await db.organization_units.deleteMany({ where: { id } }).catch(() => {})
  }
  for (const id of ids.userIds ?? []) {
    await db.user.deleteMany({ where: { id } }).catch(() => {})
  }
  for (const id of ids.departmentIds ?? []) {
    await db.departments.deleteMany({ where: { id } }).catch(() => {})
  }
}

interface OrgPrerequisites {
  departmentId: string
  requesterId: string
  originUserId: string
  designatedApproverId: string
  unitId: string
  requestId: string
  instanceId: string
}

/**
 * Seeds a complete, self-contained organization-owned request with an
 * AUTO_APPROVED REQUEST-phase instance, in actual FK order, and returns the
 * IDs plus an FK-safe cleanup that only touches these IDs.
 */
async function seedAutoAuditScenario(
  db: PrismaClient,
  base: number,
  overrides: { instanceState?: 'PENDING' | 'AUTO_APPROVED'; phase?: 'REQUEST' | 'FINAL' } = {},
): Promise<OrgPrerequisites & { cleanup: () => Promise<void> }> {
  const departmentId = scenarioId(base + 1)
  const requesterId = scenarioId(base + 2)
  const originUserId = scenarioId(base + 3)
  const unitId = scenarioId(base + 4)
  const requestId = scenarioId(base + 5)
  const instanceId = scenarioId(base + 6)

  await db.departments.create({
    data: { id: departmentId, name: `CI dept ${departmentId}`, type: 'GENERAL' },
  })
  await db.user.createMany({
    data: [
      { id: requesterId, name: `CI requester ${base}`, email: `ci-requester-${base}@example.test`, isActive: true, departmentId },
      { id: originUserId, name: `CI origin ${base}`, email: `ci-origin-${base}@example.test`, isActive: true },
    ],
  })
  await db.organization_units.create({
    data: { id: unitId, name: `CI unit ${unitId}`, unitType: 'FACTORY', operationalType: 'GENERAL' },
  })
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

  const cleanup = async () =>
    cleanupIds(db, { instanceIds: [instanceId], requestIds: [requestId], unitIds: [unitId], userIds: [originUserId, requesterId], departmentIds: [departmentId] })

  return { departmentId, requesterId, originUserId, designatedApproverId: originUserId, unitId, requestId, instanceId, cleanup }
}

/** Raw two-connection transaction helper: explicit BEGIN/COMMIT control. */
function rawBegin(client: PrismaClient): Promise<unknown> {
  return client.$executeRawUnsafe('BEGIN')
}
function rawSetLockTimeout(client: PrismaClient): Promise<unknown> {
  // Fail fast instead of hanging CI if serialization assumptions break.
  return client.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'")
}

ci('organization approval row-integrity constraints (CI database)', () => {
  it('accepts version-0 historical rows with null level and null designated approver', async (t) => {
    const db = client()
    const departmentId = scenarioId(1)
    const requesterId = scenarioId(2)
    const requestId = scenarioId(3)
    const rowId = scenarioId(4)
    const cleanup = async () =>
      cleanupIds(db, { approvalRowIds: [rowId], requestIds: [requestId], userIds: [requesterId], departmentIds: [departmentId] })
    t.after(cleanup)

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
    const departmentId = scenarioId(11)
    const requesterId = scenarioId(12)
    const requestId = scenarioId(13)
    const cleanup = async () =>
      cleanupIds(db, { approvalRowIds: [scenarioId(14)], requestIds: [requestId], userIds: [requesterId], departmentIds: [departmentId] })
    t.after(cleanup)

    await db.departments.create({ data: { id: departmentId, name: `CI dept ${departmentId}`, type: 'GENERAL' } })
    await db.user.create({ data: { id: requesterId, name: 'CI requester', email: `ci-${requesterId}@example.test`, isActive: true, departmentId } })
    await db.requests.create({
      data: { id: requestId, title: 'CI v0 masquerade', description: 'CI', status: 'ImprovementRequest', requesterId, departmentId },
    })

    await assert.rejects(
      () =>
        db.request_approvals.create({
          data: {
            id: scenarioId(14),
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
    const seed = await seedAutoAuditScenario(db, 20)
    t.after(seed.cleanup)

    await db.$transaction((tx) =>
      tx.request_approvals.create({
        data: {
          id: scenarioId(27),
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
    const row = await db.request_approvals.findUnique({ where: { id: scenarioId(27) } })
    assert.ok(row)
    assert.equal(row.candidateGroupId, null)
  })

  it('accepts a pending group-less row that gains its candidate group later in the same transaction', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 30)
    t.after(seed.cleanup)

    const candidateGroupId = scenarioId(37)
    await db.approval_candidate_groups.create({
      data: {
        id: candidateGroupId,
        approvalInstanceId: seed.instanceId,
        requiredPosition: 'SUPERVISOR',
        scopeUnitId: seed.unitId,
      },
    })
    const extendedCleanup = async () => {
      await cleanupIds(db, { approvalRowIds: [scenarioId(38)], candidateGroupIds: [candidateGroupId] })
      await seed.cleanup()
    }
    t.after(extendedCleanup)

    // The INSERT queues a group-less trigger event; the UPDATE attaches the
    // group before commit. Latest-row applicability must make the final
    // grouped state succeed.
    await db.$transaction(async (tx) => {
      await tx.request_approvals.create({
        data: {
          id: scenarioId(38),
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
        where: { id: scenarioId(38) },
        data: { candidateGroupId },
      })
    })
    const row = await db.request_approvals.findUnique({ where: { id: scenarioId(38) } })
    assert.ok(row)
    assert.equal(row.candidateGroupId, candidateGroupId)
  })

  it('accepts inserting and deleting a group-less row within the same transaction', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 40)
    t.after(seed.cleanup)

    await db.$transaction(async (tx) => {
      await tx.request_approvals.create({
        data: {
          id: scenarioId(47),
          requestId: seed.requestId,
          order: 1,
          status: 'pending',
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          instanceId: seed.instanceId,
          requiredPosition: 'SUPERVISOR',
        },
      })
      await tx.request_approvals.delete({ where: { id: scenarioId(47) } })
    })
    const row = await db.request_approvals.findUnique({ where: { id: scenarioId(47) } })
    assert.equal(row, null)
  })

  it('accepts ordinary grouped version-1 snapshot rows', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 50)
    t.after(seed.cleanup)

    const candidateGroupId = scenarioId(57)
    await db.approval_candidate_groups.create({
      data: {
        id: candidateGroupId,
        approvalInstanceId: seed.instanceId,
        requiredPosition: 'SUPERVISOR',
        scopeUnitId: seed.unitId,
      },
    })
    const extendedCleanup = async () => {
      await cleanupIds(db, { approvalRowIds: [scenarioId(58)], candidateGroupIds: [candidateGroupId] })
      await seed.cleanup()
    }
    t.after(extendedCleanup)

    await db.$transaction((tx) =>
      tx.request_approvals.create({
        data: {
          id: scenarioId(58),
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
    const seed = await seedAutoAuditScenario(db, 60, { instanceState: 'PENDING' })
    t.after(seed.cleanup)

    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          tx.request_approvals.create({
            data: {
              id: scenarioId(67),
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
    const seed = await seedAutoAuditScenario(db, 70, { phase: 'FINAL' })
    t.after(seed.cleanup)

    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          tx.request_approvals.create({
            data: {
              id: scenarioId(77),
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
    const seed = await seedAutoAuditScenario(db, 80)
    t.after(seed.cleanup)

    await db.request_approvals.create({
      data: {
        id: scenarioId(84),
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
    const departmentId = scenarioId(91)
    const requesterId = scenarioId(92)
    const designatedApproverId = scenarioId(93)
    const requestId = scenarioId(94)
    const rowId = scenarioId(95)
    // Cleanup registered now and made failure-safe; it only touches this
    // scenario's IDs in FK-safe order.
    let deletedApprover = false
    const cleanup = async () => {
      await cleanupIds(db, { approvalRowIds: [rowId], requestIds: [requestId], userIds: deletedApprover ? [requesterId] : [requesterId, designatedApproverId], departmentIds: [departmentId] })
    }
    t.after(cleanup)

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

    deletedApprover = true
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

  it('serializes: a committed group-less audit row makes a concurrent-connection demotion fail', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 100)
    t.after(seed.cleanup)

    const c1 = new PrismaClient({ datasources: { db: { url: CI_DATABASE_URL as string } } })
    const c2 = new PrismaClient({ datasources: { db: { url: CI_DATABASE_URL } } })
    await c1.$connect()
    await c2.$connect()
    const disconnect = async () => {
      await c1.$executeRawUnsafe('ROLLBACK').catch(() => {})
      await c2.$executeRawUnsafe('ROLLBACK').catch(() => {})
      await c1.$disconnect()
      await c2.$disconnect()
    }
    t.after(disconnect)

    // Barrier 1: c1 opens a transaction and inserts a valid group-less audit
    // row (valid against the still-AUTO_APPROVED instance).
    await rawBegin(c1)
    await rawSetLockTimeout(c1)
    await c1.$executeRawUnsafe(
      `INSERT INTO "request_approvals" ("id", "requestId", "approverId", "order", "status", "routingMode", "integrityVersion", "instanceId", "requiredPosition") VALUES ('${scenarioId(107)}', '${seed.requestId}', '${seed.originUserId}', 1, 'approved', 'SNAPSHOT_GROUP', 1, '${seed.instanceId}', 'SUPERVISOR')`,
    )
    // Barrier 2: c2 opens a transaction and demotes the instance state.
    await rawBegin(c2)
    await rawSetLockTimeout(c2)
    await c2.$executeRawUnsafe(
      `UPDATE "approval_instances" SET "state" = 'PENDING' WHERE "id" = '${seed.instanceId}'`,
    )
    // Barrier 3: c1's commit is STARTED first (its deferred trigger blocks on
    // the instance row lock c2's update holds) with the rejection handled so
    // the test can proceed to release it.
    const c1Commit = c1.$executeRawUnsafe('COMMIT')
    c1Commit.catch(() => {})
    // Barrier 4: c2 commits — its deferred validation cannot see c1's
    // uncommitted row, so it passes and releases the instance row lock.
    await c2.$executeRawUnsafe('COMMIT')
    // c1's commit then acquires the lock, re-reads the demoted state, and
    // must fail instead of committing the invalid relationship.
    await assert.rejects(() => c1Commit, /group-less snapshot/)
    // Barrier 4: c2 commits; the audit row it never saw is gone, but the
    // demotion itself is the surviving outcome.
    await c2.$executeRawUnsafe('COMMIT')
    const instance = await db.approval_instances.findUnique({ where: { id: seed.instanceId } })
    assert.ok(instance)
    assert.equal(instance.state, 'PENDING', 'the demotion is the surviving committed state')
    const row = await db.request_approvals.findFirst({ where: { instanceId: seed.instanceId } })
    assert.equal(row, null, 'the invalid audit row must not be persisted')
  })

  it('serializes: a concurrent demotion cannot rescue itself after an uncommitted audit insert commits (alternate completion order)', async (t) => {
    const db = client()
    const seed = await seedAutoAuditScenario(db, 110)
    t.after(seed.cleanup)

    const c1 = new PrismaClient({ datasources: { db: { url: CI_DATABASE_URL as string } } })
    const c2 = new PrismaClient({ datasources: { db: { url: CI_DATABASE_URL } } })
    await c1.$connect()
    await c2.$connect()
    const disconnect = async () => {
      await c1.$executeRawUnsafe('ROLLBACK').catch(() => {})
      await c2.$executeRawUnsafe('ROLLBACK').catch(() => {})
      await c1.$disconnect()
      await c2.$disconnect()
    }
    t.after(disconnect)

    // Barrier 1: c1 inserts the valid group-less audit row in a transaction.
    await rawBegin(c1)
    await rawSetLockTimeout(c1)
    await c1.$executeRawUnsafe(
      `INSERT INTO "request_approvals" ("id", "requestId", "approverId", "order", "status", "routingMode", "integrityVersion", "instanceId", "requiredPosition") VALUES ('${scenarioId(117)}', '${seed.requestId}', '${seed.originUserId}', 1, 'approved', 'SNAPSHOT_GROUP', 1, '${seed.instanceId}', 'SUPERVISOR')`,
    )
    // Barrier 2: c2 demotes the instance state in a parallel transaction.
    await rawBegin(c2)
    await rawSetLockTimeout(c2)
    await c2.$executeRawUnsafe(
      `UPDATE "approval_instances" SET "state" = 'PENDING' WHERE "id" = '${seed.instanceId}'`,
    )
    // Alternate completion order: the demotion connection commits FIRST —
    // its deferred validation cannot see the uncommitted audit row, so it
    // passes and releases the instance row lock.
    await c2.$executeRawUnsafe('COMMIT')
    // Only then does the audit insert attempt its commit: the deferred
    // trigger re-reads the latest persisted instance (PENDING) and must
    // reject the row instead of committing the invalid relationship.
    await assert.rejects(() => c1.$executeRawUnsafe('COMMIT'), /group-less snapshot/)
    const instance = await db.approval_instances.findUnique({ where: { id: seed.instanceId } })
    assert.ok(instance)
    assert.equal(instance.state, 'PENDING')
    const row = await db.request_approvals.findFirst({ where: { instanceId: seed.instanceId } })
    assert.equal(row, null)
  })
})
