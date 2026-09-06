/**
 * Owner-provisioned disposable-CI integration tests for the organization
 * approval redesign row-integrity constraints (Task 2 fix round 1).
 *
 * These tests are NOT part of `npm run check` (which only runs
 * tests/regression) and are NEVER executed locally — the source task has no
 * database authority and no migration may be applied here. They require a
 * database with this migration already applied, provided through
 * ORGANIZATION_APPROVAL_CI_DATABASE_URL; without that variable every test
 * self-skips so the file is inert outside CI.
 *
 * What they prove locally-assertable contracts cannot: real PostgreSQL
 * execution of the row-mode CHECKs, the deferred cross-table group-less
 * snapshot audit triggers, and SetNull compatibility for historical rows.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'

const CI_DATABASE_URL = process.env.ORGANIZATION_APPROVAL_CI_DATABASE_URL
const hasCI = typeof CI_DATABASE_URL === 'string' && CI_DATABASE_URL.length > 0

// A skipped describe still documents the CI contract for the reviewer.
const ci = hasCI ? describe : describe.skip

let prisma: PrismaClient | null = null

function client(): PrismaClient {
  assert.ok(prisma, 'CI database client must be initialised')
  return prisma
}

before(async () => {
  if (!hasCI) return
  prisma = new PrismaClient({
    datasources: { db: { url: CI_DATABASE_URL } },
  })
  await prisma.$connect()
})

after(async () => {
  if (prisma) await prisma.$disconnect()
})

function scenarioId(n: number): string {
  return `00000000-0004-4000-8000-${String(n).padStart(12, '0')}`
}

ci('organization approval row-integrity constraints (CI database)', () => {
  it('accepts version-0 historical rows with null level and null designated approver', async () => {
    const db = client()
    const row = await db.request_approvals.create({
      data: {
        id: scenarioId(101),
        requestId: scenarioId(100),
        requiredLevel: null,
        requiredApproverId: null,
        order: 1,
        status: 'approved',
        isCustomChain: true,
        routingMode: 'CUSTOM_PERSON',
        integrityVersion: 0,
      },
    })
    await db.request_approvals.delete({ where: { id: row.id } })
  })

  it('rejects a version-0 row masquerading as SNAPSHOT_GROUP', async () => {
    const db = client()
    await assert.rejects(
      () =>
        db.request_approvals.create({
          data: {
            id: scenarioId(102),
            requestId: scenarioId(100),
            order: 1,
            status: 'approved',
            routingMode: 'SNAPSHOT_GROUP',
            integrityVersion: 0,
          },
        }),
      /row_mode_integrity/,
    )
  })

  it('accepts a strict version-1 approved auto self-audit row without a candidate group', async () => {
    const db = client()
    const requestId = scenarioId(110)
    const instanceId = scenarioId(111)
    const originUserId = scenarioId(112)
    const request = await db.requests.create({
      data: {
        id: requestId,
        title: 'CI auto-audit',
        description: 'CI',
        status: 'SentToEngineer',
        requesterId: originUserId,
        departmentId: null,
        organizationUnitId: scenarioId(113),
      },
    })
    const unit = await db.organization_units.create({
      data: { id: scenarioId(113), name: `CI unit ${scenarioId(113)}`, unitType: 'FACTORY', operationalType: 'GENERAL' },
    })
    const originUser = await db.user.create({
      data: { id: originUserId, name: 'CI Origin', email: `ci-origin-${scenarioId(112)}@example.test`, isActive: true },
    })
    const instance = await db.approval_instances.create({
      data: {
        id: instanceId,
        requestId,
        phase: 'REQUEST',
        originUserId,
        originUnitId: unit.id,
        originContext: {},
        routingMode: 'SNAPSHOT_GROUP',
        state: 'AUTO_APPROVED',
      },
    })
    // Deferred triggers validate at commit; $transaction makes the guard real.
    await db.$transaction((tx) =>
      tx.request_approvals.create({
        data: {
          id: scenarioId(114),
          requestId,
          approverId: originUserId,
          order: 1,
          status: 'approved',
          isFinalApproval: false,
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          instanceId: instance.id,
          requiredPosition: 'SUPERVISOR',
        },
      }),
    )
    await db.request_approvals.deleteMany({ where: { requestId } })
    await db.approval_instances.delete({ where: { id: instance.id } })
    await db.requests.delete({ where: { id: request.id } })
    await db.organization_units.delete({ where: { id: unit.id } })
    await db.user.delete({ where: { id: originUser.id } })
  })

  it('rejects a version-1 rejected group-less snapshot row even on a pending instance', async () => {
    const db = client()
    const requestId = scenarioId(120)
    const instanceId = scenarioId(121)
    const originUserId = scenarioId(122)
    const request = await db.requests.create({
      data: {
        id: requestId,
        title: 'CI negative',
        description: 'CI',
        status: 'SentToEngineer',
        requesterId: originUserId,
        departmentId: null,
        organizationUnitId: scenarioId(123),
      },
    })
    const unit = await db.organization_units.create({
      data: { id: scenarioId(123), name: `CI unit ${scenarioId(123)}`, unitType: 'FACTORY', operationalType: 'GENERAL' },
    })
    await db.user.create({
      data: { id: originUserId, name: 'CI Origin 2', email: `ci-origin-${scenarioId(122)}@example.test`, isActive: true },
    })
    const instance = await db.approval_instances.create({
      data: {
        id: instanceId,
        requestId,
        phase: 'REQUEST',
        originUserId,
        originUnitId: unit.id,
        originContext: {},
        routingMode: 'SNAPSHOT_GROUP',
        state: 'PENDING',
      },
    })
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          tx.request_approvals.create({
            data: {
              id: scenarioId(124),
              requestId,
              approverId: originUserId,
              order: 1,
              status: 'rejected',
              routingMode: 'SNAPSHOT_GROUP',
              integrityVersion: 1,
              instanceId: instance.id,
              requiredPosition: 'SUPERVISOR',
            },
          }),
        ),
      /group-less snapshot/,
    )
    await db.request_approvals.deleteMany({ where: { requestId } })
    await db.approval_instances.delete({ where: { id: instance.id } })
    await db.requests.delete({ where: { id: request.id } })
    await db.organization_units.delete({ where: { id: unit.id } })
    await db.user.delete({ where: { id: originUserId } })
  })

  it('rejects a later instance state mutation that would invalidate an existing audit row', async () => {
    const db = client()
    const requestId = scenarioId(130)
    const instanceId = scenarioId(131)
    const originUserId = scenarioId(132)
    const request = await db.requests.create({
      data: {
        id: requestId,
        title: 'CI invalidation',
        description: 'CI',
        status: 'SentToEngineer',
        requesterId: originUserId,
        departmentId: null,
        organizationUnitId: scenarioId(133),
      },
    })
    const unit = await db.organization_units.create({
      data: { id: scenarioId(133), name: `CI unit ${scenarioId(133)}`, unitType: 'FACTORY', operationalType: 'GENERAL' },
    })
    await db.user.create({
      data: { id: originUserId, name: 'CI Origin 3', email: `ci-origin-${scenarioId(132)}@example.test`, isActive: true },
    })
    const instance = await db.approval_instances.create({
      data: {
        id: instanceId,
        requestId,
        phase: 'REQUEST',
        originUserId,
        originUnitId: unit.id,
        originContext: {},
        routingMode: 'SNAPSHOT_GROUP',
        state: 'AUTO_APPROVED',
      },
    })
    await db.request_approvals.create({
      data: {
        id: scenarioId(134),
        requestId,
        approverId: originUserId,
        order: 1,
        status: 'approved',
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
        instanceId: instance.id,
        requiredPosition: 'SUPERVISOR',
      },
    })
    // Erasing AUTO_APPROVED (instead of the ruled supersede-with-preserved-outcome)
    // must be rejected because it would invalidate the persisted audit row.
    await assert.rejects(
      () => db.approval_instances.update({ where: { id: instance.id }, data: { state: 'PENDING' } }),
      /invalidate an existing group-less snapshot audit row/,
    )
    await db.request_approvals.deleteMany({ where: { requestId } })
    await db.approval_instances.delete({ where: { id: instance.id } })
    await db.requests.delete({ where: { id: request.id } })
    await db.organization_units.delete({ where: { id: unit.id } })
    await db.user.delete({ where: { id: originUserId } })
  })

  it('preserves SetNull deletion semantics for version-0 custom designated approvers', async () => {
    const db = client()
    const requestId = scenarioId(140)
    const customUserId = scenarioId(142)
    const request = await db.requests.create({
      data: {
        id: requestId,
        title: 'CI SetNull compatibility',
        description: 'CI',
        status: 'ImprovementRequest',
        requesterId: customUserId,
        departmentId: scenarioId(141),
      },
    })
    const department = await db.departments.create({
      data: { id: scenarioId(141), name: `CI dept ${scenarioId(141)}`, type: 'GENERAL' },
    })
    const customUser = await db.user.create({
      data: { id: customUserId, name: 'CI Custom', email: `ci-custom-${scenarioId(142)}@example.test`, isActive: true },
    })
    await db.requests.update({ where: { id: requestId }, data: { requesterId: customUserId, departmentId: department.id } })
    await db.request_approvals.create({
      data: {
        id: scenarioId(143),
        requestId,
        requiredApproverId: customUserId,
        order: 1,
        status: 'pending',
        isCustomChain: true,
        routingMode: 'CUSTOM_PERSON',
        integrityVersion: 0,
      },
    })
    // Deleting the designated account must keep working (SetNull) and the row
    // must remain valid under the version-0 compatibility branch.
    await db.user.delete({ where: { id: customUserId } })
    const row = await db.request_approvals.findUnique({ where: { id: scenarioId(143) } })
    assert.ok(row)
    assert.equal(row.requiredApproverId, null)
    await db.request_approvals.delete({ where: { id: scenarioId(143) } })
    await db.requests.delete({ where: { id: requestId } })
    await db.departments.delete({ where: { id: department.id } })
  })
})
