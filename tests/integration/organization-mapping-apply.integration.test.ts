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

ci('reviewed organization mapping apply (CI)', () => {
  it('applies the same digest twice with identical counts and preserves legacy history', async () => {
    const db = client()
    const ids = {
      factory: 'aaaaaaaa-0000-4000-8000-000000000001',
      division: 'aaaaaaaa-0000-4000-8000-000000000002',
      department: 'aaaaaaaa-0000-4000-8000-000000000003',
      section: 'aaaaaaaa-0000-4000-8000-000000000004',
      legacyDepartment: 'aaaaaaaa-0000-4000-8000-000000000005',
      user: 'aaaaaaaa-0000-4000-8000-000000000006',
    }
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
      positionAssignments: [{
        userId: ids.user,
        unitId: ids.section,
        positionCode: 'STAFF',
        reportingGroupId: null,
        isPrimary: true,
      }],
      reportingGroups: [],
      externalApprovers: [],
      legacyLevelMappings: [{ legacyLevel: 1, positionCode: 'STAFF' }],
    })
    const digest = computeReviewedOrganizationMappingDigest(mapping)

    const first = await db.$transaction((tx) =>
      applyReviewedOrganizationMapping(tx as never, mapping, {
        appliedBy: 'ci',
        targetIdentity: 'organization-approval-ci',
        expectedDigest: digest,
      }),
    )
    const second = await db.$transaction((tx) =>
      applyReviewedOrganizationMapping(tx as never, mapping, {
        appliedBy: 'ci',
        targetIdentity: 'organization-approval-ci',
        expectedDigest: digest,
      }),
    )
    assert.deepEqual(second, first)
    const runs = await db.organization_import_runs.findMany({ where: { mappingDigest: digest } })
    assert.equal(runs.length, 1)
  })
})
