// Clean-start approval chains panel (Plan C Task 9).
// Action tests: in-memory fake db ports only (zero Prisma, zero database,
// zero env). Component harness: renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-positions.test.ts).
// Pins:
// - publishRoute refuses on findLimitConflicts (returns flagged steps,
//   writes nothing) and otherwise retires prior published + inserts the new
//   version in ONE transaction;
// - testWithSubmitter is READ-ONLY (fake db records only load calls),
//   resolves option-A candidates (own-team exact positions ∪ path holders,
//   deduplicated), auto-approves an at-limit origin, reports noEligibleSteps
//   for all-vacant routes;
// - root-default publication copy is NOT a global activation switch.
// C9-fix1 pins (review 9814796e):
// - View seeds the effective PUBLISHED route (inherited ancestor, never a draft);
// - Restart requires a successfully loaded preview for the current instance;
// - Continue editing retains the selected draft version id.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  AssignmentNode,
  OrganizationUnitNode,
  PositionNode,
  TeamNode,
} from '@/lib/organization/model'
import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/definition'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import {
  getApprovalChainsData,
  publishRoute,
  saveRouteDraft,
  testWithSubmitter,
  type ApprovalChainsReadDb,
  type ApprovalChainsWriteDb,
  type ApprovalChainsWriteTx,
  type ApprovalChainsData,
  type SubmitterTestResult,
} from '@/server-actions/approval-routes'
import {
  ApprovalChainsPanel,
} from '@/components/organization/ApprovalChainsPanel'
import * as ChainsPanel from '@/components/organization/ApprovalChainsPanel'
import {
  RouteEditorPanel,
  draftLimitConflicts,
} from '@/components/organization/RouteEditorPanel'
import {
  SubmitterTestDialog,
  SubmitterTestResultView,
} from '@/components/organization/SubmitterTestDialog'
import {
  RestartAttemptDialog,
  restartReasonValid,
} from '@/components/organization/RestartAttemptDialog'
import * as RestartMod from '@/components/organization/RestartAttemptDialog'
import type { ReplacementChainPreview } from '@/server-actions/approvals'

const read = (path: string) => readFileSync(path, 'utf8')

// ---------------------------------------------------------------------------
// Fixtures (mirror of the clean-start dev seed shape)
// ---------------------------------------------------------------------------

function unit(
  id: string,
  name: string,
  parentId: string | null,
  extra: Partial<OrganizationUnitNode> = {},
): OrganizationUnitNode {
  return {
    id,
    name,
    parentId,
    isActive: true,
    shareRequests: false,
    canWorkOnSolutions: false,
    managerUserId: null,
    ...extra,
  }
}

const fixtureUnits = (): OrganizationUnitNode[] => [
  unit('company', 'Company', null, { managerUserId: 'dana' }),
  unit('ops', 'Operations', 'company', { managerUserId: 'pat' }),
  unit('section-a', 'Section A', 'ops', { managerUserId: 'morgan' }),
  unit('section-b', 'Section B', 'ops'),
]

const fixturePositions = (): PositionNode[] => [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-lead', name: 'Lead', rank: 2, isActive: true },
  { id: 'p-manager', name: 'Manager', rank: 3, isActive: true },
  { id: 'p-director', name: 'Director', rank: 4, isActive: true },
]

function assignment(
  id: string,
  userId: string,
  unitId: string,
  positionId: string,
  extra: Partial<AssignmentNode> = {},
): AssignmentNode {
  return { id, userId, unitId, positionId, teamId: null, isActive: true, ...extra }
}

const fixtureAssignments = (): AssignmentNode[] => [
  assignment('asg-dana', 'dana', 'company', 'p-director'),
  assignment('asg-pat', 'pat', 'ops', 'p-manager'),
  assignment('asg-morgan', 'morgan', 'section-a', 'p-manager'),
  assignment('asg-riley', 'riley', 'section-a', 'p-manager'),
  assignment('asg-alice', 'alice', 'section-a', 'p-staff', { teamId: 'team-line-a' }),
  assignment('asg-casey', 'casey', 'section-a', 'p-lead', { teamId: 'team-line-a' }),
  assignment('asg-quinn', 'quinn', 'section-a', 'p-lead', { teamId: 'team-line-a' }),
  // Own-team exact-position holder with an INACTIVE account: never a
  // candidate (B4 builder semantics — inactive accounts cannot act).
  assignment('asg-kai', 'kai', 'section-a', 'p-lead', { teamId: 'team-line-a' }),
  assignment('asg-bob', 'bob', 'section-b', 'p-staff'),
]

const fixtureTeams = (): TeamNode[] => [
  {
    id: 'team-line-a',
    unitId: 'section-a',
    name: 'Line A',
    reportsToAssignmentId: 'asg-riley',
    isActive: true,
  },
]

interface FixtureUser { id: string; name: string; isActive: boolean }

const fixtureUsers = (): FixtureUser[] => [
  { id: 'admin-1', name: 'System Admin', isActive: true },
  { id: 'dana', name: 'Dana', isActive: true },
  { id: 'pat', name: 'Pat', isActive: true },
  { id: 'morgan', name: 'Morgan', isActive: true },
  { id: 'riley', name: 'Riley', isActive: true },
  { id: 'alice', name: 'Alice', isActive: true },
  { id: 'casey', name: 'Casey', isActive: true },
  { id: 'quinn', name: 'Quinn', isActive: true },
  { id: 'kai', name: 'Kai', isActive: false },
  { id: 'bob', name: 'Bob', isActive: true },
]

interface FixtureRouteVersion {
  id: string
  scopeUnitId: string
  phase: ApprovalPhase
  version: number
  approvalLimitPositionId: string
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
  steps: ReadonlyArray<{ order: number; positionId: string }>
}

const rootSteps = () => [
  { order: 1, positionId: 'p-lead' },
  { order: 2, positionId: 'p-manager' },
  { order: 3, positionId: 'p-director' },
]

const fixtureRouteVersions = (): FixtureRouteVersion[] => [
  {
    id: 'route-root-request',
    scopeUnitId: 'company',
    phase: 'REQUEST',
    version: 1,
    approvalLimitPositionId: 'p-director',
    status: 'PUBLISHED',
    steps: rootSteps(),
  },
  {
    id: 'route-ops-request',
    scopeUnitId: 'ops',
    phase: 'REQUEST',
    version: 1,
    approvalLimitPositionId: 'p-director',
    status: 'PUBLISHED',
    steps: rootSteps(),
  },
]

// ---------------------------------------------------------------------------
// Fake read db — records every call; exposes NO write method at all.
// ---------------------------------------------------------------------------

interface StrandedFixture {
  instanceId: string
  phase: ApprovalPhase
  attempt: number
  requestId: string | null
  solutionId: string | null
  originUserId: string
  candidateGroups: ReadonlyArray<{ members: ReadonlyArray<{ userId: string; user: { isActive: boolean } }> }>
}

function makeReadDb(over: {
  units?: OrganizationUnitNode[]
  positions?: PositionNode[]
  assignments?: AssignmentNode[]
  teams?: TeamNode[]
  users?: FixtureUser[]
  routeVersions?: FixtureRouteVersion[]
  stranded?: StrandedFixture[]
} = {}) {
  const units = (over.units ?? fixtureUnits()).map((row) => ({ ...row }))
  const positions = (over.positions ?? fixturePositions()).map((row) => ({ ...row }))
  const assignments = (over.assignments ?? fixtureAssignments()).map((row) => ({ ...row }))
  const teams = (over.teams ?? fixtureTeams()).map((row) => ({ ...row }))
  const users = (over.users ?? fixtureUsers()).map((row) => ({ ...row }))
  const routeVersions = (over.routeVersions ?? fixtureRouteVersions())
    .map((row) => ({ ...row, steps: row.steps.map((step) => ({ ...step })) }))
  const stranded = (over.stranded ?? []).map((row) => structuredClone(row))
  const calls: string[] = []
  const db: ApprovalChainsReadDb & { calls: string[]; routeVersions: FixtureRouteVersion[] } = {
    calls,
    routeVersions,
    async loadUnits() {
      calls.push('loadUnits')
      return units.map((row) => ({ ...row }))
    },
    async loadPositions() {
      calls.push('loadPositions')
      return positions.map((row) => ({ ...row }))
    },
    async loadAssignments() {
      calls.push('loadAssignments')
      return assignments.map((row) => ({ ...row }))
    },
    async loadTeams() {
      calls.push('loadTeams')
      return teams.map((row) => ({ ...row }))
    },
    async loadUsers() {
      calls.push('loadUsers')
      return users.map((row) => ({ ...row }))
    },
    async loadRouteVersions(input) {
      calls.push(`loadRouteVersions:${input.phase}`)
      return routeVersions
        .filter((row) => input.scopeUnitIds.includes(row.scopeUnitId) && row.phase === input.phase)
        .map((row) => ({ ...row, steps: row.steps.map((step) => ({ ...step })) }))
    },
    async loadStrandedAttempts() {
      calls.push('loadStrandedAttempts')
      return stranded.map((row) => ({
        instanceId: row.instanceId,
        phase: row.phase,
        attempt: row.attempt,
        requestId: row.requestId,
        solutionId: row.solutionId,
        originUserId: row.originUserId,
        candidateGroups: row.candidateGroups,
      }))
    },
  }
  return db
}

// ---------------------------------------------------------------------------
// Fake write db — records the transaction sequence.
// ---------------------------------------------------------------------------

interface RecordedInsert {
  scopeUnitId: string
  phase: ApprovalPhase
  version: number
  approvalLimitPositionId: string
  status: 'DRAFT' | 'PUBLISHED'
  adminUserId: string
  publishedAt: Date | null
  steps: ReadonlyArray<{ order: number; positionId: string }>
  id: string
}

function makeWriteDb(over: {
  units?: OrganizationUnitNode[]
  positions?: PositionNode[]
  routeVersions?: FixtureRouteVersion[]
} = {}) {
  const units = (over.units ?? fixtureUnits()).map((row) => ({ ...row }))
  const positions = (over.positions ?? fixturePositions()).map((row) => ({ ...row }))
  const routeVersions = (over.routeVersions ?? fixtureRouteVersions())
    .map((row) => ({ ...row, steps: row.steps.map((step) => ({ ...step })) }))
  const txLog: string[] = []
  const inserts: RecordedInsert[] = []
  const retires: Array<{ scopeUnitId: string; phase: ApprovalPhase; count: number }> = []
  let transactions = 0
  let idSeq = 0
  const tx: ApprovalChainsWriteTx = {
    async nextVersionNumber(scopeUnitId, phase) {
      txLog.push(`nextVersionNumber:${scopeUnitId}:${phase}`)
      const latest = routeVersions
        .filter((row) => row.scopeUnitId === scopeUnitId && row.phase === phase)
        .reduce((max, row) => Math.max(max, row.version), 0)
      return latest + 1
    },
    async retirePublishedVersions(scopeUnitId, phase) {
      txLog.push(`retirePublishedVersions:${scopeUnitId}:${phase}`)
      let count = 0
      for (const row of routeVersions) {
        if (row.scopeUnitId === scopeUnitId && row.phase === phase && row.status === 'PUBLISHED') {
          row.status = 'RETIRED'
          count += 1
        }
      }
      retires.push({ scopeUnitId, phase, count })
      return count
    },
    async insertRouteVersion(input) {
      txLog.push(`insertRouteVersion:${input.scopeUnitId}:${input.phase}:${input.status}`)
      const row: RecordedInsert = {
        ...input,
        steps: input.steps.map((step) => ({ ...step })),
        id: `inserted-${++idSeq}`,
      }
      inserts.push(row)
      routeVersions.push({
        id: row.id,
        scopeUnitId: row.scopeUnitId,
        phase: row.phase,
        version: row.version,
        approvalLimitPositionId: row.approvalLimitPositionId,
        status: row.status,
        steps: row.steps.map((step) => ({ order: step.order, positionId: step.positionId })),
      })
      return { id: row.id }
    },
  }
  const db: ApprovalChainsWriteDb & {
    txLog: string[]
    inserts: RecordedInsert[]
    retires: Array<{ scopeUnitId: string; phase: ApprovalPhase; count: number }>
    routeVersions: FixtureRouteVersion[]
    transactions(): number
    revalidations: string[]
  } = {
    adminUserId: 'admin-1',
    txLog,
    inserts,
    retires,
    routeVersions,
    revalidations: [],
    transactions: () => transactions,
    async loadUnits() {
      return units.map((row) => ({ ...row }))
    },
    async loadPositions() {
      return positions.map((row) => ({ ...row }))
    },
    async runRouteTransaction(body) {
      transactions += 1
      return body(tx)
    },
    async revalidateWorkspace() {
      this.revalidations.push('/admin/organization')
    },
  }
  return db
}

// ---------------------------------------------------------------------------
// saveRouteDraft / publishRoute
// ---------------------------------------------------------------------------

describe('saveRouteDraft (fake db)', () => {
  it('inserts an immutable DRAFT version with steps and never retires the published route', async () => {
    const db = makeWriteDb()
    const result = await saveRouteDraft({
      scopeUnitId: 'company',
      phase: 'SOLUTION',
      approvalLimitPositionId: 'p-director',
      steps: rootSteps(),
    }, db)
    assert.equal(typeof result.versionId, 'string')
    assert.ok(result.versionId.length > 0)
    assert.equal(db.transactions(), 1)
    assert.equal(db.txLog.includes('retirePublishedVersions:company:SOLUTION'), false)
    assert.equal(db.inserts.length, 1)
    assert.equal(db.inserts[0].status, 'DRAFT')
    assert.equal(db.inserts[0].publishedAt, null)
    assert.equal(db.inserts[0].adminUserId, 'admin-1')
    assert.equal(db.inserts[0].approvalLimitPositionId, 'p-director')
    assert.deepEqual(
      db.inserts[0].steps.map((step) => step.order),
      [1, 2, 3],
    )
    // Prior published REQUEST route survives untouched.
    const root = db.routeVersions.find(
      (row) => row.id === 'route-root-request' && row.status === 'PUBLISHED',
    )
    assert.ok(root)
    assert.equal(db.revalidations.length, 1)
  })

  it('rejects an invalid definition before any write', async () => {
    const db = makeWriteDb()
    await assert.rejects(
      saveRouteDraft({
        scopeUnitId: 'company',
        phase: 'REQUEST',
        approvalLimitPositionId: 'p-missing',
        steps: rootSteps(),
      }, db),
      (error: unknown) => error instanceof ApprovalRouteConfigurationError,
    )
    assert.equal(db.transactions(), 0)
    assert.equal(db.inserts.length, 0)
  })

  it('rejects an unknown or inactive scope unit before any write', async () => {
    const db = makeWriteDb()
    await assert.rejects(
      saveRouteDraft({
        scopeUnitId: 'nope',
        phase: 'REQUEST',
        approvalLimitPositionId: 'p-director',
        steps: rootSteps(),
      }, db),
      (error: unknown) => error instanceof ApprovalRouteConfigurationError,
    )
    const inactiveUnits = fixtureUnits()
    inactiveUnits[1] = unit('ops', 'Operations', 'company', { isActive: false })
    const db2 = makeWriteDb({ units: inactiveUnits })
    await assert.rejects(
      saveRouteDraft({
        scopeUnitId: 'ops',
        phase: 'REQUEST',
        approvalLimitPositionId: 'p-director',
        steps: rootSteps(),
      }, db2),
      (error: unknown) => error instanceof ApprovalRouteConfigurationError,
    )
    assert.equal(db.inserts.length + db2.inserts.length, 0)
  })

  it('rejects an invalid phase before any write', async () => {
    const db = makeWriteDb()
    await assert.rejects(
      saveRouteDraft({
        scopeUnitId: 'company',
        phase: 'NOPE' as ApprovalPhase,
        approvalLimitPositionId: 'p-director',
        steps: rootSteps(),
      }, db),
      (error: unknown) => error instanceof ApprovalRouteConfigurationError,
    )
    assert.equal(db.transactions(), 0)
  })
})

describe('publishRoute (fake db)', () => {
  it('refuses a step above a lowered limit: returns the flagged steps and writes nothing', async () => {
    const db = makeWriteDb()
    const result = await publishRoute({
      scopeUnitId: 'company',
      phase: 'REQUEST',
      approvalLimitPositionId: 'p-manager',
      steps: rootSteps(),
    }, db)
    assert.equal(result.published, false)
    assert.equal(result.versionId, null)
    assert.deepEqual(result.conflicts, [
      { order: 3, positionId: 'p-director', problem: 'EXCEEDS_LIMIT' },
    ])
    // Writes nothing: no transaction, no inserts, prior published untouched.
    assert.equal(db.transactions(), 0)
    assert.equal(db.inserts.length, 0)
    assert.equal(db.txLog.length, 0)
    const root = db.routeVersions.find((row) => row.id === 'route-root-request')
    assert.equal(root?.status, 'PUBLISHED')
  })

  it('retires the prior published version and inserts the new published version in ONE transaction', async () => {
    const db = makeWriteDb()
    const result = await publishRoute({
      scopeUnitId: 'company',
      phase: 'REQUEST',
      approvalLimitPositionId: 'p-director',
      steps: rootSteps(),
    }, db)
    assert.equal(result.published, true)
    assert.ok(result.versionId)
    assert.deepEqual(result.conflicts, [])
    assert.equal(db.transactions(), 1)
    assert.deepEqual(db.txLog, [
      'retirePublishedVersions:company:REQUEST',
      'nextVersionNumber:company:REQUEST',
      'insertRouteVersion:company:REQUEST:PUBLISHED',
    ])
    assert.equal(db.retires.length, 1)
    assert.equal(db.retires[0].count, 1)
    assert.equal(db.inserts.length, 1)
    assert.equal(db.inserts[0].status, 'PUBLISHED')
    assert.ok(db.inserts[0].publishedAt instanceof Date)
    assert.equal(db.inserts[0].version, 2)
    const root = db.routeVersions.find((row) => row.id === 'route-root-request')
    assert.equal(root?.status, 'RETIRED')
  })

  it('publishes version 1 when no prior version exists', async () => {
    const db = makeWriteDb({ routeVersions: [] })
    const result = await publishRoute({
      scopeUnitId: 'section-b',
      phase: 'SOLUTION',
      approvalLimitPositionId: 'p-director',
      steps: [{ order: 1, positionId: 'p-manager' }],
    }, db)
    assert.equal(result.published, true)
    assert.equal(db.inserts[0].version, 1)
    assert.equal(db.retires[0].count, 0)
  })

  it('fails closed on definition problems other than limit conflicts', async () => {
    const db = makeWriteDb()
    await assert.rejects(
      publishRoute({
        scopeUnitId: 'company',
        phase: 'REQUEST',
        approvalLimitPositionId: 'p-director',
        steps: [
          { order: 1, positionId: 'p-manager' },
          { order: 2, positionId: 'p-lead' },
        ],
      }, db),
      (error: unknown) =>
        error instanceof ApprovalRouteConfigurationError && /ascending/.test(error.message),
    )
    assert.equal(db.transactions(), 0)
  })
})

// ---------------------------------------------------------------------------
// testWithSubmitter — READ-ONLY option-A resolution
// ---------------------------------------------------------------------------

describe('testWithSubmitter (fake db)', () => {
  it('resolves an UNGROUPED submitter through the path only, nearest published scope, skipping vacant Lead', async () => {
    const db = makeReadDb()
    const result = await testWithSubmitter({ submitterUserId: 'bob', phase: 'REQUEST' }, db)
    assert.equal(result.source, 'INHERITED')
    assert.equal(result.scopeUnitId, 'ops')
    assert.equal(result.routeVersionId, 'route-ops-request')
    assert.equal(result.autoApproved, false)
    assert.equal(result.noEligibleSteps, false)
    assert.deepEqual(result.steps, [
      {
        order: 1,
        requiredPositionId: 'p-lead',
        positionName: 'Lead',
        candidates: [],
        skipped: true,
        skipReason: 'VACANT_POSITION',
      },
      {
        order: 2,
        requiredPositionId: 'p-manager',
        positionName: 'Manager',
        candidates: [{ id: 'pat', name: 'Pat' }],
        skipped: false,
      },
      {
        order: 3,
        requiredPositionId: 'p-director',
        positionName: 'Director',
        candidates: [{ id: 'dana', name: 'Dana' }],
        skipped: false,
      },
    ])
  })

  it('TEAM submitter: own-team exact-position members plus reports-to/manager/ancestor holders, deduplicated (option-A positive)', async () => {
    const db = makeReadDb()
    // Alice is a Staff member of Line A: the Lead step IS required for her,
    // so the own-team exact-position pool (Casey, Quinn; Kai inactive and
    // filtered) is exercised alongside the path holders.
    const result = await testWithSubmitter({ submitterUserId: 'alice', phase: 'REQUEST' }, db)
    const lead = result.steps.find((step) => step.requiredPositionId === 'p-lead')
    const manager = result.steps.find((step) => step.requiredPositionId === 'p-manager')
    const director = result.steps.find((step) => step.requiredPositionId === 'p-director')
    assert.ok(lead)
    assert.ok(manager)
    assert.ok(director)
    // Own-team exact Lead holders Casey and Quinn (never the submitter; Kai's
    // inactive account is filtered out).
    assert.deepEqual(lead.candidates, [
      { id: 'casey', name: 'Casey' },
      { id: 'quinn', name: 'Quinn' },
    ])
    // Reports-to Riley + own-unit manager Morgan + ancestor manager Pat,
    // deduplicated by user, inactive accounts excluded.
    assert.deepEqual(manager.candidates, [
      { id: 'riley', name: 'Riley' },
      { id: 'morgan', name: 'Morgan' },
      { id: 'pat', name: 'Pat' },
    ])
    assert.deepEqual(director.candidates, [{ id: 'dana', name: 'Dana' }])
    assert.equal(lead.skipped, false)
    assert.equal(result.autoApproved, false)
    assert.equal(result.noEligibleSteps, false)
  })

  it('autoApproved: true with zero steps for an at-limit origin under a root default from a child unit', async () => {
    const db = makeReadDb({
      routeVersions: [
        {
          id: 'route-root-request',
          scopeUnitId: 'company',
          phase: 'REQUEST',
          version: 1,
          approvalLimitPositionId: 'p-manager',
          status: 'PUBLISHED',
          steps: [
            { order: 1, positionId: 'p-lead' },
            { order: 2, positionId: 'p-manager' },
          ],
        },
      ],
    })
    // Pat (Manager at Operations) sits exactly at the root default's limit.
    const result = await testWithSubmitter({ submitterUserId: 'pat', phase: 'REQUEST' }, db)
    assert.equal(result.source, 'ROOT_DEFAULT')
    assert.equal(result.scopeUnitId, 'company')
    assert.equal(result.routeVersionId, 'route-root-request')
    assert.equal(result.autoApproved, true)
    assert.deepEqual(result.steps, [])
    assert.equal(result.noEligibleSteps, false)
  })

  it('at-limit origin whose own unit holds the winning route is still auto-approved (company-root origin)', async () => {
    const db = makeReadDb()
    const result = await testWithSubmitter({ submitterUserId: 'dana', phase: 'REQUEST' }, db)
    assert.equal(result.autoApproved, true)
    assert.deepEqual(result.steps, [])
    assert.equal(result.routeVersionId, 'route-root-request')
  })

  it('noEligibleSteps: true when every step is vacant', async () => {
    const db = makeReadDb({
      routeVersions: [
        {
          id: 'route-section-b-request',
          scopeUnitId: 'section-b',
          phase: 'REQUEST',
          version: 1,
          approvalLimitPositionId: 'p-director',
          status: 'PUBLISHED',
          steps: [{ order: 1, positionId: 'p-lead' }],
        },
        {
          id: 'route-root-request',
          scopeUnitId: 'company',
          phase: 'REQUEST',
          version: 1,
          approvalLimitPositionId: 'p-director',
          status: 'PUBLISHED',
          steps: rootSteps(),
        },
      ],
    })
    const result = await testWithSubmitter({ submitterUserId: 'bob', phase: 'REQUEST' }, db)
    assert.equal(result.source, 'CUSTOM')
    assert.equal(result.scopeUnitId, 'section-b')
    assert.equal(result.autoApproved, false)
    assert.equal(result.noEligibleSteps, true)
    assert.equal(result.steps.length, 1)
    assert.equal(result.steps[0].skipped, true)
    assert.equal(result.steps[0].skipReason, 'VACANT_POSITION')
  })

  it('drops steps at or below the submitter rank exactly like the engine builder (not required, not vacant)', async () => {
    const db = makeReadDb()
    // Casey is a Lead: the Lead step is at her own rank and never required;
    // the origin never appears among the surviving Manager/Director steps.
    const result = await testWithSubmitter({ submitterUserId: 'casey', phase: 'REQUEST' }, db)
    assert.equal(result.steps.some((step) => step.requiredPositionId === 'p-lead'), false)
    const manager = result.steps.find((step) => step.requiredPositionId === 'p-manager')
    assert.ok(manager)
    assert.deepEqual(manager.candidates, [
      { id: 'riley', name: 'Riley' },
      { id: 'morgan', name: 'Morgan' },
      { id: 'pat', name: 'Pat' },
    ])
    const director = result.steps.find((step) => step.requiredPositionId === 'p-director')
    assert.ok(director)
    assert.deepEqual(director.candidates, [{ id: 'dana', name: 'Dana' }])
  })

  it('ZERO-WRITE: the read port exposes no write method and only load calls are recorded', async () => {
    const db = makeReadDb()
    await testWithSubmitter({ submitterUserId: 'casey', phase: 'REQUEST' }, db)
    const writeKeys = Object.keys(db).filter(
      (key) => /^(create|update|delete|insert|retire|upsert)/i.test(key),
    )
    assert.deepEqual(writeKeys, [])
    for (const call of db.calls) {
      assert.match(call, /^load/)
    }
    assert.ok(db.calls.length > 0)
  })

  it('validates and substitutes a supplied draft in memory with the DRAFT sentinel', async () => {
    const db = makeReadDb()
    const result = await testWithSubmitter({
      submitterUserId: 'casey',
      phase: 'REQUEST',
      draft: {
        approvalLimitPositionId: 'p-director',
        steps: [
          { order: 1, positionId: 'p-manager' },
          { order: 2, positionId: 'p-director' },
        ],
      },
    }, db)
    assert.equal(result.routeVersionId, 'DRAFT')
    assert.equal(result.source, 'DRAFT')
    // The draft substitutes at the nearest published scope on the branch.
    assert.equal(result.scopeUnitId, 'ops')
    assert.equal(result.steps.length, 2)
    const manager = result.steps[0]
    assert.deepEqual(manager.candidates, [
      { id: 'riley', name: 'Riley' },
      { id: 'morgan', name: 'Morgan' },
      { id: 'pat', name: 'Pat' },
    ])
  })

  it('rejects an invalid draft before any load beyond the path and never writes', async () => {
    const db = makeReadDb()
    await assert.rejects(
      testWithSubmitter({
        submitterUserId: 'casey',
        phase: 'REQUEST',
        draft: {
          approvalLimitPositionId: 'p-missing',
          steps: rootSteps(),
        },
      }, db),
      (error: unknown) => error instanceof ApprovalRouteConfigurationError,
    )
    for (const call of db.calls) {
      assert.match(call, /^load/)
    }
  })

  it('fails closed for a submitter with no reporting path', async () => {
    const db = makeReadDb({ users: fixtureUsers().filter((user) => user.id !== 'bob') })
    await assert.rejects(
      testWithSubmitter({ submitterUserId: 'ghost', phase: 'REQUEST' }, db),
      (error: unknown) =>
        error instanceof ApprovalRouteConfigurationError && /reporting path/i.test(error.message),
    )
    const unassigned = makeReadDb({
      assignments: fixtureAssignments().filter((row) => row.userId !== 'bob'),
    })
    await assert.rejects(
      testWithSubmitter({ submitterUserId: 'bob', phase: 'REQUEST' }, unassigned),
      (error: unknown) =>
        error instanceof ApprovalRouteConfigurationError && /reporting path/i.test(error.message),
    )
  })

  it('fails closed when no published route exists on the submitter branch', async () => {
    const db = makeReadDb({ routeVersions: [] })
    await assert.rejects(
      testWithSubmitter({ submitterUserId: 'bob', phase: 'REQUEST' }, db),
      (error: unknown) => error instanceof ApprovalRouteConfigurationError,
    )
  })
})

describe('getApprovalChainsData (fake db)', () => {
  it('returns units, positions, users, versions with steps, and stranded attempts', async () => {
    const db = makeReadDb({
      routeVersions: [
        ...fixtureRouteVersions(),
        {
          id: 'draft-1',
          scopeUnitId: 'company',
          phase: 'REQUEST',
          version: 2,
          approvalLimitPositionId: 'p-manager',
          status: 'DRAFT',
          steps: rootSteps(),
        },
      ],
      stranded: [
        {
          instanceId: 'inst-1',
          phase: 'REQUEST',
          attempt: 1,
          requestId: 'req-1',
          solutionId: null,
          originUserId: 'bob',
          candidateGroups: [{ members: [{ userId: 'kai', user: { isActive: false } }] }],
        },
        {
          instanceId: 'inst-2',
          phase: 'REQUEST',
          attempt: 1,
          requestId: 'req-2',
          solutionId: null,
          originUserId: 'bob',
          candidateGroups: [
            { members: [{ userId: 'kai', user: { isActive: false } }] },
            { members: [{ userId: 'quinn', user: { isActive: true } }] },
          ],
        },
      ],
    })
    const data = await getApprovalChainsData(db)
    assert.equal(data.rootUnitId, 'company')
    assert.equal(data.units.length, 4)
    assert.equal(data.versions.length, 3)
    const draft = data.versions.find((row) => row.versionId === 'draft-1')
    assert.equal(draft?.status, 'DRAFT')
    assert.deepEqual(draft?.steps, rootSteps())
    // All-inactive candidate sets are stranded; a set with any active member is not.
    assert.deepEqual(
      data.strandedAttempts.map((row) => row.instanceId),
      ['inst-1'],
    )
    assert.equal(data.strandedAttempts[0].phase, 'REQUEST')
  })
})

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const chainsData = (): ApprovalChainsData => ({
  rootUnitId: 'company',
  units: fixtureUnits(),
  positions: fixturePositions(),
  users: fixtureUsers().map(({ id, name, isActive }) => ({ id, name, isActive })),
  versions: [
    // Panel testids pin versionId without the action-fixture `route-` prefix
    // (`chains-published-route-root-request`). Action tests keep `route-*-*` ids.
    ...fixtureRouteVersions().map((row) => ({
      versionId: row.id.replace(/^route-/, ''),
      scopeUnitId: row.scopeUnitId,
      phase: row.phase,
      version: row.version,
      approvalLimitPositionId: row.approvalLimitPositionId,
      status: row.status,
      steps: row.steps,
    })),
    {
      versionId: 'draft-1',
      scopeUnitId: 'company',
      phase: 'REQUEST',
      version: 2,
      approvalLimitPositionId: 'p-manager',
      status: 'DRAFT',
      steps: rootSteps(),
    },
  ],
  strandedAttempts: [
    {
      instanceId: 'inst-1',
      phase: 'REQUEST',
      attempt: 1,
      requestId: 'req-1',
      solutionId: null,
      originUserId: 'bob',
    },
  ],
})

describe('ApprovalChainsPanel markup', () => {
  it('renders root defaults per phase and visibly distinct draft/published lists', () => {
    const html = renderToStaticMarkup(createElement(ApprovalChainsPanel, { data: chainsData() }))
    assert.match(html, /Approval chains/)
    assert.match(html, /data-testid="chains-root-REQUEST"/)
    assert.match(html, /data-testid="chains-root-SOLUTION"/)
    assert.match(html, /data-testid="chains-root-FINAL"/)
    // Published root default for REQUEST.
    assert.match(html, /data-testid="chains-published-route-root-request"/)
    // Draft renders in its own distinct list with a Draft label.
    assert.match(html, /data-testid="chains-draft-list-REQUEST"/)
    assert.match(html, /data-testid="chains-draft-draft-1"/)
    assert.match(html, /Draft/)
    // Draft rows never render inside the published list.
    const publishedList = html.match(/data-testid="chains-published-list-REQUEST"[^]*?data-testid="chains-section-/)?.[0] ?? ''
    assert.equal(publishedList.includes('draft-1'), false)
    // Unit exceptions show the effective source with View/Customize.
    assert.match(html, /data-testid="chains-exception-ops-REQUEST"/)
    assert.match(html, /Custom at this unit/)
    assert.match(html, /data-testid="chains-exception-view-ops-REQUEST"/)
    assert.match(html, /data-testid="chains-exception-customize-ops-REQUEST"/)
  })

  it('root-default publication copy is NOT a global activation switch', () => {
    const html = renderToStaticMarkup(createElement(ApprovalChainsPanel, { data: chainsData() }))
    assert.match(html, /affects future attempts only/i)
    assert.match(html, /not a global on\/off switch/i)
    assert.doesNotMatch(html, /turn (approval|routes) on/i)
    assert.doesNotMatch(html, /switch on/i)
    assert.doesNotMatch(html, /activate globally/i)
    assert.doesNotMatch(html, /enable globally/i)
  })

  it('renders stranded attempts with a restart trigger', () => {
    const html = renderToStaticMarkup(createElement(ApprovalChainsPanel, { data: chainsData() }))
    assert.match(html, /data-testid="chains-stranded-list"/)
    assert.match(html, /data-testid="chains-stranded-restart-inst-1"/)
  })
})

describe('RouteEditorPanel markup and conflict gating', () => {
  const editorProps = (over: Partial<Parameters<typeof RouteEditorPanel>[0]> = {}) => ({
    scopeUnitId: 'company',
    scopeName: 'Company',
    phase: 'REQUEST' as ApprovalPhase,
    positions: fixturePositions(),
    users: fixtureUsers().filter((user) => user.isActive).map(({ id, name }) => ({ id, name })),
    initial: {
      approvalLimitPositionId: 'p-director',
      steps: rootSteps().map((step) => ({ ...step })),
    },
    ...over,
  })

  it('draftLimitConflicts flags steps above a lowered limit', () => {
    const conflicts = draftLimitConflicts(
      rootSteps(),
      'p-manager',
      fixturePositions(),
    )
    assert.deepEqual(conflicts, [
      { order: 3, positionId: 'p-director', problem: 'EXCEEDS_LIMIT' },
    ])
    assert.deepEqual(draftLimitConflicts(rootSteps(), 'p-director', fixturePositions()), [])
  })

  it('lowering the limit disables Publish and lists the conflicting steps', () => {
    const html = renderToStaticMarkup(createElement(RouteEditorPanel, editorProps({
      initial: {
        approvalLimitPositionId: 'p-manager',
        steps: rootSteps().map((step) => ({ ...step })),
      },
    })))
    assert.match(html, /data-testid="route-editor-limit-select"/)
    assert.match(html, /Approval limit/)
    assert.match(html, /data-testid="route-editor-add-step"/)
    assert.match(html, /Add approval step/)
    const publish = html.match(/data-testid="route-editor-publish"[^>]*disabled=""/)
    assert.ok(publish, 'Publish button must render disabled')
    assert.match(html, /data-testid="route-editor-conflicts"/)
    assert.match(html, /Director/)
    assert.match(html, /EXCEEDS_LIMIT/)
  })

  it('a valid draft keeps Publish enabled and offers Test with a submitter', () => {
    const html = renderToStaticMarkup(createElement(RouteEditorPanel, editorProps()))
    assert.equal(html.includes('data-testid="route-editor-publish" disabled'), false)
    assert.match(html, /data-testid="route-editor-save-draft"/)
    assert.match(html, /Test with a submitter/)
    assert.match(html, /Publish affects future attempts only/i)
  })
})

describe('SubmitterTestDialog markup', () => {
  const dialogProps = (over: Partial<Parameters<typeof SubmitterTestDialog>[0]> = {}) => ({
    phase: 'REQUEST' as ApprovalPhase,
    users: fixtureUsers().filter((user) => user.isActive).map(({ id, name }) => ({ id, name })),
    ...over,
  })

  it('explains that it resolves actual people without creating requests', () => {
    const html = renderToStaticMarkup(createElement(SubmitterTestDialog, dialogProps()))
    assert.match(html, /without creating requests/i)
    assert.match(html, /saving snapshots/i)
    assert.match(html, /publishing/i)
    assert.match(html, /data-testid="submitter-test-user-select"/)
    assert.match(html, /data-testid="submitter-test-run"/)
  })

  it('renders the result: source, candidates, skipped reasons, auto-approval, no-eligible', () => {
    const result: SubmitterTestResult = {
      source: 'INHERITED',
      scopeUnitId: 'ops',
      routeVersionId: 'route-ops-request',
      autoApproved: false,
      noEligibleSteps: false,
      steps: [
        {
          order: 1,
          requiredPositionId: 'p-lead',
          positionName: 'Lead',
          candidates: [],
          skipped: true,
          skipReason: 'VACANT_POSITION',
        },
        {
          order: 2,
          requiredPositionId: 'p-manager',
          positionName: 'Manager',
          candidates: [{ id: 'pat', name: 'Pat' }],
          skipped: false,
        },
      ],
    }
    const html = renderToStaticMarkup(createElement(
      SubmitterTestResultView,
      { result, unitNames: new Map(fixtureUnits().map((row) => [row.id, row.name])) },
    ))
    assert.match(html, /data-testid="submitter-test-result"/)
    assert.match(html, /Inherited from Operations/)
    assert.match(html, /VACANT_POSITION/)
    assert.match(html, /Pat/)
    const auto = renderToStaticMarkup(createElement(SubmitterTestResultView, {
      result: { ...result, autoApproved: true, steps: [] },
      unitNames: new Map(fixtureUnits().map((row) => [row.id, row.name])),
    }))
    assert.match(auto, /auto-approved/i)
    const none = renderToStaticMarkup(createElement(SubmitterTestResultView, {
      result: { ...result, noEligibleSteps: true, steps: [] },
      unitNames: new Map(fixtureUnits().map((row) => [row.id, row.name])),
    }))
    assert.match(none, /no eligible steps/i)
  })
})

describe('RestartAttemptDialog markup and reason gating', () => {
  it('requires a non-empty reason before restart', () => {
    assert.equal(restartReasonValid('   '), false)
    assert.equal(restartReasonValid(''), false)
    assert.equal(restartReasonValid('  approvers all left  '), true)
  })

  it('renders the replacement-chain preview with a required reason textarea; restart disabled while empty', () => {
    const html = renderToStaticMarkup(createElement(RestartAttemptDialog, {
      instanceId: 'inst-1',
      loadPreview: async () => ({
        routeVersionId: 'route-ops-request',
        scopeUnitId: 'ops',
        phase: 'REQUEST' as ApprovalPhase,
        autoApproved: false,
        steps: [
          {
            order: 1,
            requiredPositionId: 'p-manager',
            candidates: [{ id: 'pat', name: 'Pat' }],
            skipped: false,
          },
        ],
      }),
    }))
    assert.match(html, /data-testid="restart-attempt-dialog"/)
    assert.match(html, /replacement chain/i)
    assert.match(html, /data-testid="restart-reason-input"/)
    assert.match(html, /reason is required/i)
    assert.ok(
      html.includes('data-testid="restart-confirm" disabled'),
      'Restart button must render disabled with an empty reason',
    )
  })
})

// ---------------------------------------------------------------------------
// C9-fix1: View published source, restart preview gate, selected draft
// ---------------------------------------------------------------------------

const replacementPreview = (): ReplacementChainPreview => ({
  routeVersionId: 'route-ops-request',
  scopeUnitId: 'ops',
  phase: 'REQUEST',
  autoApproved: false,
  steps: [
    {
      order: 1,
      requiredPositionId: 'p-manager',
      candidates: [{ id: 'pat', name: 'Pat' }],
      skipped: false,
    },
  ],
})

describe('C9-fix1 View seeds the effective published route', () => {
  it('inherited-route View opens the ancestor published route, not an empty editor', () => {
    assert.equal(typeof ChainsPanel.resolveEditorVersion, 'function')
    const data = chainsData()
    const seed = ChainsPanel.resolveEditorVersion(data.versions, data.units, {
      scopeUnitId: 'section-b',
      phase: 'REQUEST',
      readOnly: true,
    })
    assert.equal(seed?.versionId, 'ops-request')
    assert.equal(seed?.status, 'PUBLISHED')
    assert.equal(seed?.scopeUnitId, 'ops')

    const html = renderToStaticMarkup(createElement(ApprovalChainsPanel, {
      data,
      initialEditor: { scopeUnitId: 'section-b', phase: 'REQUEST', readOnly: true },
    }))
    assert.match(html, /data-testid="route-editor-section-b-REQUEST"/)
    assert.match(html, /data-editor-version="ops-request"/)
    assert.match(html, /data-testid="route-editor-step-1"/)
    assert.match(html, /data-testid="route-editor-step-2"/)
    assert.match(html, /data-testid="route-editor-step-3"/)
    assert.doesNotMatch(html, /EXCEEDS_LIMIT/)
  })

  it('published-plus-draft View opens the published route, not the draft', () => {
    assert.equal(typeof ChainsPanel.resolveEditorVersion, 'function')
    const data = chainsData()
    const seed = ChainsPanel.resolveEditorVersion(data.versions, data.units, {
      scopeUnitId: 'company',
      phase: 'REQUEST',
      readOnly: true,
    })
    assert.equal(seed?.versionId, 'root-request')
    assert.equal(seed?.status, 'PUBLISHED')
    assert.equal(seed?.approvalLimitPositionId, 'p-director')

    const html = renderToStaticMarkup(createElement(ApprovalChainsPanel, {
      data,
      initialEditor: { scopeUnitId: 'company', phase: 'REQUEST', readOnly: true },
    }))
    assert.match(html, /data-testid="route-editor-company-REQUEST"/)
    assert.match(html, /data-editor-version="root-request"/)
    assert.doesNotMatch(html, /data-editor-version="draft-1"/)
    // The company draft lowers the limit to Manager, which would flag Director.
    assert.doesNotMatch(html, /EXCEEDS_LIMIT/)
    assert.doesNotMatch(html, /data-testid="route-editor-conflicts"/)
    assert.match(html, /data-testid="route-editor-step-3"/)
  })

  it('remount key changes when the viewed version identity changes', () => {
    assert.equal(typeof ChainsPanel.editorRemountKey, 'function')
    const data = chainsData()
    const published = data.versions.find((row) => row.versionId === 'root-request') ?? null
    const draft = data.versions.find((row) => row.versionId === 'draft-1') ?? null
    const viewKey = ChainsPanel.editorRemountKey(
      { scopeUnitId: 'company', phase: 'REQUEST', readOnly: true },
      published,
    )
    const draftKey = ChainsPanel.editorRemountKey(
      { scopeUnitId: 'company', phase: 'REQUEST', versionId: 'draft-1' },
      draft,
    )
    const inheritedKey = ChainsPanel.editorRemountKey(
      { scopeUnitId: 'section-b', phase: 'REQUEST', readOnly: true },
      data.versions.find((row) => row.versionId === 'ops-request') ?? null,
    )
    assert.notEqual(viewKey, draftKey)
    assert.notEqual(viewKey, inheritedKey)
    assert.match(viewKey, /root-request/)
    assert.match(draftKey, /draft-1/)
  })
})

describe('C9-fix1 Continue editing retains the selected draft', () => {
  it('opens the selected older draft, not the newest/first draft', () => {
    const data: ApprovalChainsData = {
      ...chainsData(),
      versions: [
        ...chainsData().versions,
        {
          versionId: 'draft-older',
          scopeUnitId: 'company',
          phase: 'REQUEST',
          version: 3,
          approvalLimitPositionId: 'p-staff',
          status: 'DRAFT',
          steps: [{ order: 1, positionId: 'p-staff' }],
        },
      ],
    }
    assert.equal(typeof ChainsPanel.resolveEditorVersion, 'function')
    const seed = ChainsPanel.resolveEditorVersion(data.versions, data.units, {
      scopeUnitId: 'company',
      phase: 'REQUEST',
      versionId: 'draft-older',
    })
    assert.equal(seed?.versionId, 'draft-older')
    assert.equal(seed?.approvalLimitPositionId, 'p-staff')
    assert.deepEqual(seed?.steps, [{ order: 1, positionId: 'p-staff' }])

    const html = renderToStaticMarkup(createElement(ApprovalChainsPanel, {
      data,
      initialEditor: { scopeUnitId: 'company', phase: 'REQUEST', versionId: 'draft-older' },
    }))
    assert.match(html, /data-editor-version="draft-older"/)
    assert.match(html, /data-testid="route-editor-step-1"/)
    assert.doesNotMatch(html, /data-testid="route-editor-step-2"/)
    assert.doesNotMatch(html, /data-editor-version="draft-1"/)
  })

  it('Continue editing buttons pass the selected draft version id and remount key uses it', () => {
    const source = read('src/components/organization/ApprovalChainsPanel.tsx')
    assert.match(source, /versionId: version\.versionId/)
    assert.match(source, /editorRemountKey\(/)
    assert.match(source, /resolveEditorVersion\(/)
  })
})

describe('C9-fix1 Restart requires a current-instance preview', () => {
  it('pending preview: restart stays disabled even with a valid reason', () => {
    assert.equal(typeof RestartMod.restartConfirmEnabled, 'function')
    assert.equal(RestartMod.restartConfirmEnabled({
      reason: 'approvers all left',
      instanceId: 'inst-1',
      preview: null,
      previewInstanceId: null,
      loading: true,
      restarting: false,
      restarted: false,
    }), false)
    assert.equal(typeof RestartMod.RestartAttemptDialogView, 'function')
    const html = renderToStaticMarkup(createElement(RestartMod.RestartAttemptDialogView, {
      instanceId: 'inst-1',
      reason: 'approvers all left',
      preview: null,
      previewInstanceId: null,
      loading: true,
      error: null,
      restarting: false,
      restarted: false,
    }))
    assert.match(html, /Loading replacement chain preview/)
    assert.ok(
      html.includes('data-testid="restart-confirm" disabled'),
      'Restart must stay disabled while the preview is pending',
    )
  })

  it('rejected preview: restart stays disabled and the handler must not mutate', () => {
    assert.equal(typeof RestartMod.restartConfirmEnabled, 'function')
    assert.equal(typeof RestartMod.canSubmitRestart, 'function')
    const rejected = {
      reason: 'approvers all left',
      instanceId: 'inst-1',
      preview: null as ReplacementChainPreview | null,
      previewInstanceId: null as string | null,
      loading: false,
      restarting: false,
      restarted: false,
    }
    assert.equal(RestartMod.restartConfirmEnabled(rejected), false)
    assert.equal(RestartMod.canSubmitRestart(rejected), false)
    const html = renderToStaticMarkup(createElement(RestartMod.RestartAttemptDialogView, {
      instanceId: 'inst-1',
      reason: 'approvers all left',
      preview: null,
      previewInstanceId: null,
      loading: false,
      error: 'preview failed',
      restarting: false,
      restarted: false,
    }))
    assert.match(html, /preview failed/)
    assert.ok(
      html.includes('data-testid="restart-confirm" disabled'),
      'Restart must stay disabled after a rejected preview',
    )
  })

  it('ready preview for the current instance enables restart; a stale other-instance preview does not', () => {
    assert.equal(typeof RestartMod.restartConfirmEnabled, 'function')
    assert.equal(typeof RestartMod.canSubmitRestart, 'function')
    const preview = replacementPreview()
    assert.equal(RestartMod.restartConfirmEnabled({
      reason: 'approvers all left',
      instanceId: 'inst-1',
      preview,
      previewInstanceId: 'inst-1',
      loading: false,
      restarting: false,
      restarted: false,
    }), true)
    assert.equal(RestartMod.canSubmitRestart({
      reason: 'approvers all left',
      instanceId: 'inst-1',
      preview,
      previewInstanceId: 'inst-1',
      loading: false,
      restarting: false,
      restarted: false,
    }), true)
    assert.equal(RestartMod.restartConfirmEnabled({
      reason: 'approvers all left',
      instanceId: 'inst-2',
      preview,
      previewInstanceId: 'inst-1',
      loading: false,
      restarting: false,
      restarted: false,
    }), false)
    assert.equal(RestartMod.canSubmitRestart({
      reason: 'approvers all left',
      instanceId: 'inst-2',
      preview,
      previewInstanceId: 'inst-1',
      loading: false,
      restarting: false,
      restarted: false,
    }), false)
  })

  it('changing instance clears the stale preview', () => {
    assert.equal(typeof RestartMod.restartPreviewAfterInstanceChange, 'function')
    const reset = RestartMod.restartPreviewAfterInstanceChange()
    assert.equal(reset.preview, null)
    assert.equal(reset.previewInstanceId, null)
    assert.equal(reset.loading, true)
    assert.equal(reset.error, null)
    assert.equal(reset.restarted, false)
  })

  it('dialog source gates the confirm button and handler on current-instance preview', () => {
    const source = read('src/components/organization/RestartAttemptDialog.tsx')
    assert.match(source, /function restartConfirmEnabled/)
    assert.match(source, /function canSubmitRestart/)
    assert.match(source, /function restartPreviewAfterInstanceChange/)
    assert.match(source, /restartConfirmEnabled\(/)
    assert.match(source, /canSubmitRestart\(/)
    assert.match(source, /restartPreviewAfterInstanceChange\(/)
    assert.match(source, /previewInstanceId/)
  })
})

// ---------------------------------------------------------------------------
// Source contracts
// ---------------------------------------------------------------------------

describe('approval-routes server action source contracts', () => {
  const source = read('src/server-actions/approval-routes.ts')

  it('imports the clean-start route libs, never the legacy validation/resolver/candidate-groups', () => {
    assert.match(source, /@\/lib\/approval-routes\/definition/)
    assert.match(source, /@\/lib\/approval-routes\/selection/)
    assert.doesNotMatch(source, /@\/lib\/approval-routes\/validation/)
    assert.doesNotMatch(source, /@\/lib\/approval-routes\/resolver/)
    assert.doesNotMatch(source, /@\/lib\/approval-engine\/candidate-groups/)
    assert.doesNotMatch(source, /@\/lib\/organization\/repository/)
  })

  it('never maps OrganizationPositionCode',
    () => {
    assert.doesNotMatch(source, /OrganizationPositionCode/)
    assert.doesNotMatch(source, /positionCode/)
    assert.doesNotMatch(source, /maximumPositionLevel/)
  })

  it('wires the workspace page header to the chains panel', () => {
    const page = read('src/app/admin/organization/page.tsx')
    assert.match(page, /panel=chains/)
    assert.match(page, /ApprovalChainsPanel/)
    assert.match(page, /getApprovalChainsData/)
  })

  it('unit panel View/Customize route to the chains panel', () => {
    const sidePanel = read('src/components/organization/UnitSidePanel.tsx')
    assert.match(sidePanel, /panel=chains/)
  })
})
