import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getApprovalRolloutMode, verifyOrganizationRollout } from '@/lib/approval-rollout'
import { fakeRolloutDb } from '../fixtures/organization-approval-fixtures'
import {
  runVerifyOrganizationRollout,
} from '../../scripts/verify-organization-rollout'

describe('organization approval rollout', () => {
  it('defaults to legacy and does not enable NEW writes without an explicit mode', () => {
    assert.equal(getApprovalRolloutMode({}), 'legacy')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ORG_ROUTING_MODE: 'shadow' }), 'shadow')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ORG_ROUTING_MODE: 'new' }), 'new')
  })

  it('keeps APPROVAL_ROUTING_MODE as an alias so Task 8 callers stay green', () => {
    assert.equal(getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: undefined }), 'legacy')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: 'legacy' }), 'legacy')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: 'shadow' }), 'shadow')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: 'new' }), 'new')
    assert.equal(getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: 'nwe' }), 'legacy')
    assert.equal(
      getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: 'shadow', APPROVAL_ORG_ROUTING_MODE: 'shadow' }),
      'shadow',
    )
    assert.equal(
      getApprovalRolloutMode({ APPROVAL_ROUTING_MODE: 'new', APPROVAL_ORG_ROUTING_MODE: 'shadow' }),
      'legacy',
    )
  })

  it('blocks cutover when reviewed mapping or legacy discriminator verification has blockers', async () => {
    const report = await verifyOrganizationRollout(fakeRolloutDb({
      mappingBlockers: ['USER_NOT_MAPPED:u7'],
      legacyRowsWithoutDiscriminator: 2,
      publishedRouteConflicts: 0,
    }))
    assert.equal(report.readyForNewAttempts, false)
    assert.deepEqual(report.blockers, [
      'MAPPING_BLOCKERS_PRESENT',
      'LEGACY_ROWS_WITHOUT_DISCRIMINATOR',
    ])
  })

  it('blocks on published route conflicts and missing pending snapshot groups', async () => {
    const report = await verifyOrganizationRollout(fakeRolloutDb({
      mappingBlockers: [],
      legacyRowsWithoutDiscriminator: 0,
      publishedRouteConflicts: 1,
      pendingSnapshotGroupsMissing: 3,
    }))
    assert.equal(report.readyForShadow, false)
    assert.equal(report.readyForNewAttempts, false)
    assert.deepEqual(report.blockers, [
      'PUBLISHED_ROUTE_CONFLICTS',
      'PENDING_SNAPSHOT_GROUP_MISSING',
    ])
  })

  it('reports inactive snapshot candidates without treating them as cutover blockers', async () => {
    const report = await verifyOrganizationRollout(fakeRolloutDb({
      mappingBlockers: [],
      legacyRowsWithoutDiscriminator: 0,
      publishedRouteConflicts: 0,
      inactiveSnapshotCandidates: 4,
    }))
    assert.equal(report.inactiveSnapshotCandidates, 4)
    assert.equal(report.readyForShadow, true)
    assert.equal(report.readyForNewAttempts, true)
    assert.deepEqual(report.blockers, [])
  })
})

describe('organization rollout verification CLI', () => {
  it('exits --help before constructing a database client', async () => {
    let constructed = 0
    const prints: string[] = []
    const code = await runVerifyOrganizationRollout({
      argv: ['--help'],
      createDb: async () => {
        constructed += 1
        throw new Error('database client must not be constructed for --help')
      },
      print: (line) => prints.push(line),
    })
    assert.equal(code, 0)
    assert.equal(constructed, 0)
    assert.ok(prints.some((line) => /usage|--mapping-report/i.test(line)))
  })

  it('joins the Prisma-mapped users table in verification SQL, never User',
    () => {
      const source = readFileSync('scripts/verify-organization-rollout.ts', 'utf8')
      const schema = readFileSync('prisma/schema.prisma', 'utf8')
      assert.match(schema, /model User \{[\s\S]*?@@map\("users"\)/)
      assert.match(source, /JOIN "users" u ON u\.id = m\."userId"/)
      assert.equal((source.match(/JOIN "User"/g) ?? []).length, 0)
    },
  )
})

describe('organization rollout verification CLI: mapping report shape (M1)', () => {
  function stubDb() {
    return fakeRolloutDb({
      mappingBlockers: [],
      legacyRowsWithoutDiscriminator: 0,
      publishedRouteConflicts: 0,
      pendingSnapshotGroupsMissing: 0,
    })
  }

  it('treats malformed mapping reports as verification errors, never as zero blockers', async () => {
    const malformedReports: unknown[] = [
      null,
      {},
      { blockingReasons: 'USER_NOT_MAPPED:u7' },
      { blockingReasons: ['USER_NOT_MAPPED:u7', 42] },
      [ 'USER_NOT_MAPPED:u7' ],
    ]
    for (const report of malformedReports) {
      const prints: string[] = []
      let verified = false
      const code = await runVerifyOrganizationRollout({
        argv: ['--mapping-report', 'mapping-report.json'],
        readMappingReport: async () => report,
        createDb: async () => {
          verified = true
          return stubDb()
        },
        print: (line) => prints.push(line),
      }).catch((error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /[Mm]alformed mapping report/)
        return -1
      })
      assert.equal(code, -1, `expected malformed-report rejection for ${JSON.stringify(report)}`)
      // The database was never consulted and no readiness report was printed:
      // malformed evidence never becomes a "zero blockers" verdict.
      assert.equal(verified, false)
      assert.deepEqual(prints, [])
    }
  })

  it('still accepts a well-formed report and joins its blockers with the database checks', async () => {
    const prints: string[] = []
    const code = await runVerifyOrganizationRollout({
      argv: ['--mapping-report', 'mapping-report.json', '--out', 'verify-out.json'],
      readMappingReport: async () => ({
        mappedDepartmentCount: 1,
        mappedUserCount: 2,
        mappedExternalApproverCount: 0,
        unmappedDepartmentIds: [],
        unmappedUserIds: ['u7'],
        blockingReasons: ['USER_NOT_MAPPED:u7'],
        wouldCreateUnits: 0,
        wouldCreateAssignments: 0,
        wouldCreateReportingGroups: 0,
      }),
      createDb: async () => stubDb(),
      writeReport: async () => {},
      print: (line) => prints.push(line),
    })
    assert.equal(code, 2, 'report blockers must surface as a nonzero exit even when database counters are zero')
  })
})
