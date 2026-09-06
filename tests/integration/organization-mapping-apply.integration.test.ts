/**
 * Owner-provisioned disposable-CI importer evidence (Task 15).
 *
 * These tests are NOT part of `npm run check` and are NEVER executed locally —
 * the source task has no database authority and must not apply mapping or
 * migrations to a local/production database. They require a database with the
 * additive organization-approval migration already applied, provided ONLY
 * through ORGANIZATION_APPROVAL_CI_DATABASE_URL. Without that variable every
 * test self-skips. An explicit guard rejects a CI URL equal to the
 * application's DATABASE_URL.
 *
 * Definition contract: seed legacy departments/users/requests/approvals in
 * FK order, apply the reviewed mapping twice, assert counts and preserved
 * history, and cover parent-unit request rows (departmentId null).
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { parseReviewedOrganizationMapping } from '../../tools/organization-mapping-schema'
import {
  applyReviewedOrganizationMapping,
  computeReviewedOrganizationMappingDigest,
} from '@/lib/organization/mapping'

const CI_DATABASE_URL = process.env.ORGANIZATION_APPROVAL_CI_DATABASE_URL
const hasCI = typeof CI_DATABASE_URL === 'string' && CI_DATABASE_URL.length > 0
const ci = hasCI ? describe : describe.skip

let prisma: PrismaClient | null = null

before(async () => {
  if (!hasCI) return
  assert.notEqual(
    CI_DATABASE_URL,
    process.env.DATABASE_URL,
    'ORGANIZATION_APPROVAL_CI_DATABASE_URL must not point at the application DATABASE_URL',
  )
  prisma = new PrismaClient({ datasources: { db: { url: CI_DATABASE_URL } } })
  await prisma.$connect()
})

after(async () => {
  if (prisma) await prisma.$disconnect()
})

function client(): PrismaClient {
  assert.ok(prisma, 'CI database client must be initialised')
  return prisma
}

const ids = {
  factory: 'aaaaaaaa-0000-4000-8000-000000000001',
  division: 'aaaaaaaa-0000-4000-8000-000000000002',
  department: 'aaaaaaaa-0000-4000-8000-000000000003',
  section: 'aaaaaaaa-0000-4000-8000-000000000004',
  legacyDepartment: 'aaaaaaaa-0000-4000-8000-000000000005',
  staffUser: 'aaaaaaaa-0000-4000-8000-000000000006',
  factoryManager: 'aaaaaaaa-0000-4000-8000-000000000007',
  legacyRequest: 'aaaaaaaa-0000-4000-8000-000000000008',
  legacyApproval: 'aaaaaaaa-0000-4000-8000-000000000009',
  parentRequest: 'aaaaaaaa-0000-4000-8000-000000000010',
}

ci('reviewed organization mapping apply (CI)', () => {
  it('seeds legacy rows, applies the same digest twice, preserves history, and covers parent-unit create', async (t) => {
    const db = client()
    t.after(async () => {
      await db.request_approvals.deleteMany({ where: { id: ids.legacyApproval } })
      await db.requests.deleteMany({ where: { id: { in: [ids.legacyRequest, ids.parentRequest] } } })
      await db.organization_position_assignments.deleteMany({ where: { userId: { in: [ids.staffUser, ids.factoryManager] } } })
      await db.organization_units.deleteMany({ where: { id: { in: [ids.section, ids.department, ids.division, ids.factory] } } })
      await db.organization_import_runs.deleteMany({ where: { targetIdentity: 'organization-approval-ci' } })
      await db.user.deleteMany({ where: { id: { in: [ids.staffUser, ids.factoryManager] } } })
      await db.departments.deleteMany({ where: { id: ids.legacyDepartment } })
    })
    const mapping = parseReviewedOrganizationMapping({
      units: [
        { id: ids.factory, name: 'Factory', unitType: 'FACTORY', parentId: null },
        { id: ids.division, name: 'Division', unitType: 'DIVISION', parentId: ids.factory },
        { id: ids.department, name: 'Department', unitType: 'DEPARTMENT', parentId: ids.division },
        { id: ids.section, name: 'PD1', unitType: 'SECTION', parentId: ids.department },
      ],
      departments: [{
        legacyDepartmentId: ids.legacyDepartment,
        targetUnitId: ids.section,
        engineeringClassification: 'GENERAL',
        disposition: 'REAL_SECTION',
      }],
      positionAssignments: [
        {
          userId: ids.staffUser,
          unitId: ids.section,
          positionCode: 'STAFF',
          reportingGroupId: null,
          isPrimary: true,
        },
        {
          userId: ids.factoryManager,
          unitId: ids.factory,
          positionCode: 'FACTORY_MANAGER',
          reportingGroupId: null,
          isPrimary: true,
        },
      ],
      reportingGroups: [],
      externalApprovers: [],
      legacyLevelMappings: [{ legacyLevel: 1, positionCode: 'STAFF' }],
    })
    const digest = computeReviewedOrganizationMappingDigest(mapping)

    await db.departments.create({
      data: { id: ids.legacyDepartment, name: `CI PD1 ${ids.legacyDepartment}`, type: 'GENERAL' },
    })
    await db.user.create({
      data: {
        id: ids.staffUser,
        name: 'CI staff',
        email: `ci-staff-${ids.staffUser}@example.test`,
        isActive: true,
        departmentId: ids.legacyDepartment,
        level: 1,
      },
    })
    await db.user.create({
      data: {
        id: ids.factoryManager,
        name: 'CI factory manager',
        email: `ci-fm-${ids.factoryManager}@example.test`,
        isActive: true,
        departmentId: null,
        level: null,
      },
    })
    await db.requests.create({
      data: {
        id: ids.legacyRequest,
        title: 'CI legacy request',
        description: 'legacy history',
        status: 'ImprovementRequest',
        requesterId: ids.staffUser,
        departmentId: ids.legacyDepartment,
        organizationUnitId: null,
      },
    })
    await db.request_approvals.create({
      data: {
        id: ids.legacyApproval,
        requestId: ids.legacyRequest,
        requiredLevel: 2,
        order: 1,
        status: 'pending',
        routingMode: 'LEGACY_LEVEL',
        integrityVersion: 0,
      },
    })

    const applyOnce = () => db.$transaction((tx) =>
      applyReviewedOrganizationMapping(tx as never, mapping, {
        appliedBy: 'ci',
        targetIdentity: 'organization-approval-ci',
        expectedDigest: digest,
      }),
    )
    const first = await applyOnce()
    const second = await applyOnce()
    assert.deepEqual(second, first)
    assert.equal(first.wouldCreateUnits, 4)
    assert.equal(first.wouldCreateAssignments, 2)

    const runs = await db.organization_import_runs.findMany({ where: { mappingDigest: digest } })
    assert.equal(runs.length, 1)
    const units = await db.organization_units.findMany({
      where: { id: { in: [ids.factory, ids.division, ids.department, ids.section] } },
    })
    assert.equal(units.length, 4)
    const assignments = await db.organization_position_assignments.findMany({
      where: { userId: { in: [ids.staffUser, ids.factoryManager] } },
    })
    assert.equal(assignments.length, 2)
    const factoryManagerAssignment = assignments.find((row) => row.userId === ids.factoryManager)
    assert.equal(factoryManagerAssignment?.unitId, ids.factory)
    assert.equal(factoryManagerAssignment?.positionCode, 'FACTORY_MANAGER')
    assert.equal(units.some((unit) => unit.unitType === 'SECTION' && unit.id !== ids.section), false)

    const history = await db.request_approvals.findUnique({ where: { id: ids.legacyApproval } })
    assert.equal(history?.requiredLevel, 2)
    assert.equal(history?.status, 'pending')
    assert.equal(history?.routingMode, 'LEGACY_LEVEL')
    const backfilled = await db.requests.findUnique({ where: { id: ids.legacyRequest } })
    assert.equal(backfilled?.organizationUnitId, ids.section)
    assert.equal(backfilled?.departmentId, ids.legacyDepartment)
    const manager = await db.user.findUnique({ where: { id: ids.factoryManager } })
    assert.equal(manager?.departmentId, null)
    assert.equal(manager?.level, null)

    await db.requests.create({
      data: {
        id: ids.parentRequest,
        title: 'CI parent-unit request',
        description: 'factory manager origin',
        status: 'ImprovementRequest',
        requesterId: ids.factoryManager,
        departmentId: null,
        organizationUnitId: ids.factory,
      },
    })
    const parentOwned = await db.requests.findUnique({ where: { id: ids.parentRequest } })
    assert.equal(parentOwned?.departmentId, null)
    assert.equal(parentOwned?.organizationUnitId, ids.factory)
  })
})
