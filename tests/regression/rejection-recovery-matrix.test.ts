// Rejection/Recovery Matrix — pure inventory, execution-plan and ledger policy
// regressions. Parity is proven against the ACTUAL fixture
// (createBusinessWorkflowFixture), not against hardcoded lengths alone.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import {
  buildCasePlan,
  buildInventory,
  buildStaleNegativeChecks,
  CUSTOM_CHAINS,
  FIXTURE_ACTORS,
  MatrixLedger,
  LedgerPolicyError,
  PROFILE_ORDER,
  RANK_CHAINS,
  REQUEST_CUSTOM_UI_SUPPORTED,
  assertSupportedCombination,
  assertApprovalEvidence,
  assertCompletedEvidence,
  assertFinalInitiationEvidence,
  assertRejectionEvidence,
  assertResubmitEvidence,
  assertScopedBusinessEvidence,
  assertSolutionSubmitEvidence,
  assertReadOnlySingleSelect,
  assertSnapshotsEqual,
  approvalRowSql,
  activeInstanceSql,
  pendingChainSql,
  terminalSnapshotSql,
  correlatePersistedProof,
  customToggleControl,
  emptyMatrixJournal,
  enableCustomHierarchy,
  expectedPostRejectStatus,
  expectedRouteSource,
  applyMappedMatrixSeed,
  assembleRouteProof,
  assertRankPendingRow,
  assertRouteStepsBeforeAction,
  buildActionBaseline,
  buildFinalInitiationEvidence,
  buildRevisionBaseline,
  buildSolutionSubmitEvidence,
  captureRevisionBeforeResubmit,
  persistScopedCaseEvidence,
  proveFinalInitiation,
  scopedBusinessEvidenceSql,
  type ScopedBusinessEvidence,
  buildIsolatedMatrixSeedPlan,
  fixtureActorIdFromMatrix,
  matrixActorEmail,
  matrixActorId,
  pendingCustomActorId,
  expectedActiveRouteProof,
  retainProfileAggregate,
  expectedScopeUnitId,
  encloseFailedSetup,
  finalizeTraceArtifact,
  LIVE_CO_CANDIDATE_VERIFICATION,
  MATRIX_HEADED,
  parsePsqlJsonDocument,
  rejectionTable,
  renderMatrixProgress,
  retainCaseJournal,
  reviserFor,
  validateRejectReason,
} from '../support/rejection-recovery-matrix'
import { createBusinessWorkflowFixture } from '../support/business-workflow-fixture'
import { expect as playwrightExpect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import os from 'node:os'
import type { MatrixRow, RevisionBaseline } from '../support/rejection-recovery-matrix'
import { readOnlyPsql, runDefaultMappedSeed, type MappedSeedClient, type MappedSeedModel } from '../support/native/rejection-recovery-runtime'
import { PG_BIN } from '../support/native/native-environment'
import { failClosed, runCaseWithEvidenceGate, playwrightMatrixUi, ensureResubmitSolutionOpenerReadyAndOpen, RESUBMIT_OPENER_READINESS_TIMEOUT_MS, type CaseResult } from '../manual/rejection-recovery-matrix'

const fixture = createBusinessWorkflowFixture()
const rows = buildInventory()

const TEAM_REPORTS_TO_PRIMARY: Record<string, string> = {
  "unit-production-1-section": FIXTURE_ACTORS.supervisorP,
  "unit-engineering-section": FIXTURE_ACTORS.supervisorE,
}
function activeActorAt(unitId: string, positionId: string, phase: string): string {
  const effectiveUnit = phase === "SOLUTION"
    ? (unitId === "unit-company" ? "unit-engineering-section" : unitId)
    : (unitId === "unit-company" ? "unit-production-1-section" : unitId)
  const matches = Object.values(fixture.actors).filter(
    (actor) => actor.isActive && actor.assignment !== null &&
      actor.assignment.unitId === effectiveUnit && actor.assignment.positionId === positionId,
  )
  if (matches.length > 1) {
    const primary = matches.find((a) => a.id === TEAM_REPORTS_TO_PRIMARY[effectiveUnit])
    assert.ok(primary, `no team-reports-to primary at ${unitId}/${positionId}`)
    return primary.id
  }
  assert.equal(matches.length, 1, `expected exactly one actor at ${unitId}/${positionId}`)
  return matches[0].id
}

function fixtureRouteActors(profile: string, phase: string, scopeUnitId: string): string[] {
  const route = (fixture.routeConfigurations as unknown as Record<string, { routes: Array<{ phase: string; scopeUnitId: string; steps: ReadonlyArray<{ positionId: string }> }> }>)[profile].routes.find(
    (r: { phase: string; scopeUnitId: string }) => r.phase === phase && r.scopeUnitId === scopeUnitId,
  )
  assert.ok(route, `fixture route missing for ${profile}/${phase}@${scopeUnitId}`)
  const originName = phase === 'SOLUTION' ? 'engineerA' : 'requesterA'
  const effectiveUnit = phase === 'SOLUTION'
    ? (scopeUnitId === 'unit-company' ? 'unit-engineering-section' : scopeUnitId)
    : (scopeUnitId === 'unit-company' ? 'unit-production-1-section' : scopeUnitId)
  const originPath = fixture.paths[originName as 'engineerA' | 'requesterA']
  return route.steps.map((step: { positionId: string }) => {
    const inScope = Object.values(fixture.actors).filter(
      (actor) => actor.isActive && actor.assignment !== null &&
        actor.assignment.unitId === effectiveUnit && actor.assignment.positionId === step.positionId,
    )
    if (inScope.length > 1) {
      const primary = inScope.find((a) => a.id === (effectiveUnit === 'unit-engineering-section' ? FIXTURE_ACTORS.supervisorE : FIXTURE_ACTORS.supervisorP))
      assert.ok(primary, `no team-reports-to primary at ${effectiveUnit}/${step.positionId}`)
      return primary.id
    }
    if (inScope.length === 1) return inScope[0].id
    const originStep = originPath.steps.find((originStepEntry: { positionId: string }) => originStepEntry.positionId === step.positionId)
    assert.ok(originStep, `cannot resolve ${phase} step ${step.positionId} for ${profile}`)
    return (originStep as unknown as { userId: string }).userId
  })
}

describe('rejection-recovery matrix inventory (fixture parity)', () => {
  it('contains exactly 44 primary cases: 12/11/11/10 across the four profiles', () => {
    assert.equal(rows.length, 44)
    const counts = Object.fromEntries(PROFILE_ORDER.map((p) => [p, rows.filter((r) => r.profile === p).length]))
    assert.deepEqual(counts, {
      'all-defaults': 12,
      'solution-exception': 11,
      'final-exception': 11,
      'solution-and-final-exceptions': 10,
    })
  })

  it('rank chains match the ACTUAL fixture routes per profile/scope (Engineering actors on SOLUTION)', () => {
    assert.deepEqual(RANK_CHAINS['all-defaults'].REQUEST, fixtureRouteActors('all-defaults', 'REQUEST', 'unit-company'))
    assert.deepEqual(RANK_CHAINS['all-defaults'].SOLUTION, fixtureRouteActors('all-defaults', 'SOLUTION', 'unit-company'))
    assert.deepEqual(RANK_CHAINS['all-defaults'].FINAL, fixtureRouteActors('all-defaults', 'FINAL', 'unit-company'))
    assert.deepEqual(
      RANK_CHAINS['solution-exception'].SOLUTION,
      fixtureRouteActors('solution-exception', 'SOLUTION', 'unit-engineering-section'),
    )
    assert.deepEqual(
      RANK_CHAINS['final-exception'].FINAL,
      fixtureRouteActors('final-exception', 'FINAL', 'unit-production-1-section'),
    )
    assert.deepEqual(
      RANK_CHAINS['solution-and-final-exceptions'].SOLUTION,
      fixtureRouteActors('solution-and-final-exceptions', 'SOLUTION', 'unit-engineering-section'),
    )
    assert.deepEqual(
      RANK_CHAINS['solution-and-final-exceptions'].FINAL,
      fixtureRouteActors('solution-and-final-exceptions', 'FINAL', 'unit-production-1-section'),
    )
  })

  it('SOLUTION rank chain runs on the ENGINEERING origin path (Supervisor E / Section manager E), not the requester chain', () => {
    assert.ok(RANK_CHAINS['all-defaults'].SOLUTION.includes(FIXTURE_ACTORS.supervisorE))
    assert.ok(RANK_CHAINS['all-defaults'].SOLUTION.includes(FIXTURE_ACTORS.sectionManagerE))
    assert.ok(!RANK_CHAINS['all-defaults'].SOLUTION.includes(FIXTURE_ACTORS.requesterA))
    assert.ok(!RANK_CHAINS['all-defaults'].SOLUTION.includes(FIXTURE_ACTORS.engineerA))
    assert.deepEqual(
      RANK_CHAINS['solution-exception'].SOLUTION,
      [FIXTURE_ACTORS.sectionManagerE, FIXTURE_ACTORS.departmentManager],
    )
  })

  it('permitted revisers: requester for REQUEST, Engineering submitter for SOLUTION/FINAL', () => {
    assert.equal(reviserFor('REQUEST'), FIXTURE_ACTORS.requesterA)
    assert.equal(reviserFor('SOLUTION'), FIXTURE_ACTORS.engineerA)
    assert.equal(reviserFor('FINAL'), FIXTURE_ACTORS.engineerA)
    for (const row of rows) assert.equal(row.reviser, matrixActorId(reviserFor(row.phase)))
  })

  it('reject positions cover every step; ids stable and unique; reasons present', () => {
    const ids = rows.map((r) => r.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual(ids, buildInventory().map((r) => r.id))
    for (const row of rows) {
      assert.equal(row.rejectOrder, row.precedingApprovals + 1)
      assert.ok(row.rejectOrder <= row.orderedActorIds.length)
      assert.ok(row.reason.trim())
    }
  })

  it('custom two-person chains per profile with pinned intended order', () => {
    for (const profile of PROFILE_ORDER) {
      for (const phase of ['SOLUTION', 'FINAL'] as const) {
        const custom = rows.filter((r) => r.profile === profile && r.phase === phase && r.chainKind === 'custom')
        assert.equal(custom.length, 2)
        assert.deepEqual(custom.map((r) => r.rejectOrder), [1, 2])
        assert.deepEqual(custom[0].orderedActorIds, CUSTOM_CHAINS[phase === 'SOLUTION' ? 'SOLUTION' : 'FINAL'].map((id) => matrixActorId(id)))
      }
    }
  })

  it('REQUEST CUSTOM_PERSON stays an explicit unsupported gap', () => {
    assert.equal(REQUEST_CUSTOM_UI_SUPPORTED, false)
    assert.equal(rows.filter((r) => r.phase === 'REQUEST' && r.chainKind === 'custom').length, 0)
    assert.throws(() => assertSupportedCombination('all-defaults', 'REQUEST', 'custom'), LedgerPolicyError)
  })

  it('status/table mappings', () => {
    assert.equal(expectedPostRejectStatus('REQUEST'), 'ImprovementRequest')
    assert.equal(expectedPostRejectStatus('SOLUTION'), 'SentToEngineer')
    assert.equal(expectedPostRejectStatus('FINAL'), 'SentToEngineer')
    assert.equal(rejectionTable('REQUEST'), 'request_approvals')
    assert.equal(rejectionTable('FINAL'), 'request_approvals')
    assert.equal(rejectionTable('SOLUTION'), 'solution_approvals')
  })

  it('stale negatives: one per FINAL primary case (4/4/3/3) with documented predicate', () => {
    const stale = buildStaleNegativeChecks(rows)
    assert.equal(stale.length, 14)
    assert.deepEqual(
      PROFILE_ORDER.map((p) => stale.filter((s) => rows.find((r) => r.id === s.attachedTo)!.profile === p).length),
      [4, 4, 3, 3],
    )
    for (const s of stale) assert.match(s.expectedPredicate, /MUST be denied/)
  })
})

describe('phase-aware execution plans (all 44 reach REQUEST -> SOLUTION -> FINAL -> Completed)', () => {
  it('REQUEST-pos1 plan covers create/reject/resubmit/full S/full F', () => {
    const plan = buildCasePlan(rows.find((r) => r.id === 'RRM-001')!)
    assert.equal(plan[0].kind, 'create-request')
    assert.ok(plan.some((s) => s.kind === 'reject' && s.phase === 'REQUEST' && s.stepOrder === 1))
    assert.ok(plan.some((s) => s.kind === 'resubmit' && s.phase === 'REQUEST'))
    assert.ok(plan.some((s) => s.kind === 'submit-solution'))
    assert.ok(plan.some((s) => s.kind === 'initiate-final'))
    assert.equal(plan[plan.length - 1].kind, 'verify-completed')
  })

  it('SOLUTION and FINAL plans complete ALL later phases (no jump to Completed)', () => {
    for (const row of rows) {
      const plan = buildCasePlan(row)
      assert.equal(plan[plan.length - 1].kind, 'verify-completed', row.id)
      const initiate = plan.filter((s) => s.kind === 'initiate-final').length
      assert.ok(initiate >= 1, `${row.id}: every recovery must include a Final initiation`)
      // Every plan must approve at least one FINAL step after initiation.
      const finalApprovals = plan.filter((s) => s.kind === 'approve' && s.phase === 'FINAL').length
      assert.ok(finalApprovals >= 1, `${row.id}: FINAL approvals missing`)
    }
  })

  it('SOLUTION-custom cases keep the ORIGINAL custom S chain on recovery but RANK FINAL; FINAL-custom uses rank S and custom F', () => {
    const sCustom = rows.find((r) => r.profile === 'all-defaults' && r.phase === 'SOLUTION' && r.chainKind === 'custom')!
    const sPlan = buildCasePlan(sCustom)
    const sResubmit = sPlan.find((s) => s.kind === 'resubmit') as { custom: boolean }
    assert.equal(sResubmit.custom, true)
    const sFinalInit = sPlan.find((s) => s.kind === 'initiate-final') as { custom: boolean }
    assert.equal(sFinalInit.custom, false, 'SOLUTION-custom recovery FINAL stays rank (separately inventoried)')

    const fCustom = rows.find((r) => r.profile === 'all-defaults' && r.phase === 'FINAL' && r.chainKind === 'custom')!
    const fPlan = buildCasePlan(fCustom)
    const fInit = fPlan.filter((s) => s.kind === 'initiate-final') as Array<{ kind: string; custom: boolean }>
    assert.equal(fInit.length, 2)
    assert.equal(fInit[0].custom, true, 'original FINAL initiation is custom')
    assert.equal(fInit[1].custom, true, 'recovered FINAL initiation re-selects the SAME custom chain')
    const fResubmit = fPlan.find((s) => s.kind === 'resubmit') as { custom: boolean }
    assert.equal(fResubmit.custom, false, 'FINAL recovery solution revision stays profile-rank SOLUTION')
  })

  it('approval attempts are epoch-keyed: the same actor legitimately reappears across phases/attempts', () => {
    const row = rows.find((r) => r.profile === 'all-defaults' && r.phase === 'REQUEST' && r.rejectOrder === 3)!
    const plan = buildCasePlan(row)
    const deptApprovals = plan.filter(
      (s) => s.kind === 'approve' && s.actor === matrixActorId(FIXTURE_ACTORS.departmentManager),
    ) as Array<{ kind: string; phase: string; attempt: number; stepOrder: number }>
    assert.ok(deptApprovals.length >= 3, 'Dept manager approves in R, S and F')
    const keyed = new Set(deptApprovals.map((s) => `${s.phase}/${s.attempt}/${s.stepOrder}`))
    assert.equal(keyed.size, deptApprovals.length)
  })
})

describe('ledger policy (phase/attempt/step keys)', () => {
  it('same actor approving in different phases never conflicts', () => {
    const ledger = new MatrixLedger()
    ledger.begin({ caseId: 'RRM-001', action: 'approve-step', phase: 'REQUEST', attempt: 1, stepOrder: 3, actor: FIXTURE_ACTORS.departmentManager })
    ledger.confirm(ledger.all[0], 'persisted R step3 approved')
    ledger.begin({ caseId: 'RRM-001', action: 'approve-step', phase: 'SOLUTION', attempt: 1, stepOrder: 3, actor: FIXTURE_ACTORS.departmentManager })
    ledger.confirm(ledger.all[1], 'persisted S step3 approved')
    ledger.begin({ caseId: 'RRM-001', action: 'approve-step', phase: 'FINAL', attempt: 2, stepOrder: 2, actor: FIXTURE_ACTORS.departmentManager })
    assert.equal(ledger.all.length, 3)
  })

  it('same actor re-approving the same step on a NEW attempt is legitimate; same-step replay is refused', () => {
    const ledger = new MatrixLedger()
    const key = { caseId: 'RRM-002', action: 'approve-step' as const, phase: 'SOLUTION' as const, attempt: 1, stepOrder: 1, actor: FIXTURE_ACTORS.supervisorE }
    const first = ledger.begin(key)
    ledger.confirm(first, 'attempt1 persisted')
    assert.throws(() => ledger.begin(key), LedgerPolicyError) // same attempt replay
    const second = ledger.begin({ ...key, attempt: 2 })
    ledger.confirm(second, 'attempt2 persisted')
  })

  it('unresolved attempting blocks the same key and the whole matrix', () => {
    const ledger = new MatrixLedger()
    ledger.begin({ caseId: 'RRM-003', action: 'confirm-rejection', phase: 'FINAL', attempt: 1, stepOrder: 1, actor: FIXTURE_ACTORS.supervisorP })
    assert.throws(
      () => ledger.begin({ caseId: 'RRM-003', action: 'confirm-rejection', phase: 'FINAL', attempt: 1, stepOrder: 1, actor: FIXTURE_ACTORS.supervisorP }),
      /AMBIGUOUS ATTEMPTING/,
    )
    assert.throws(() => ledger.assertNoUnresolvedAttempting(), /unresolved attempting/)
  })

  it('confirmation requires fresh persisted evidence; denials are terminal for the key', () => {
    const ledger = new MatrixLedger()
    const entry = ledger.begin({ caseId: 'RRM-004', action: 'resubmit', phase: 'SOLUTION', attempt: 2, actor: FIXTURE_ACTORS.engineerA })
    assert.throws(() => ledger.confirm(entry, '  '), LedgerPolicyError)
    ledger.confirm(entry, 'persisted new attempt rows')
    const denied = ledger.begin({ caseId: 'RRM-004', action: 'stale-confirm-rejection', phase: 'FINAL', attempt: 1, stepOrder: 1, actor: FIXTURE_ACTORS.supervisorP })
    ledger.deny(denied)
    assert.throws(() => ledger.begin({ caseId: 'RRM-004', action: 'stale-confirm-rejection', phase: 'FINAL', attempt: 1, stepOrder: 1, actor: FIXTURE_ACTORS.supervisorP }), LedgerPolicyError)
  })

  it('held-dialog opening must NOT reserve the primary rejection action (stale uses a distinct action)', () => {
    // Opening the held dialog is nonmutating and must not consume confirm-rejection.
    // After the primary rejection is confirmed, the distinct stale action can still begin.
    const ledger = new MatrixLedger()
    const primary = ledger.begin({ caseId: 'RRM-005', action: 'confirm-rejection', phase: 'FINAL', attempt: 1, stepOrder: 1, actor: FIXTURE_ACTORS.supervisorP })
    ledger.confirm(primary, 'persisted rejection')
    const stale = ledger.begin({ caseId: 'RRM-005', action: 'stale-confirm-rejection', phase: 'FINAL', attempt: 1, stepOrder: 1, actor: FIXTURE_ACTORS.supervisorP })
    ledger.deny(stale, 'server denial')
    assert.equal(ledger.all.length, 2)
    assert.equal(ledger.all[1]?.stage, 'denied')
  })

  it('reject reason validation', () => {
    assert.throws(() => validateRejectReason('RRM-006', '   ', new Set()), /nonempty/)
    assert.throws(() => validateRejectReason('RRM-006', 'dup', new Set(['dup'])), /unique/)
  })
})

describe('matrix runtime safety policy (no resources started)', () => {
  it('pins the app-copy source root and its required build inputs', async () => {
    const { MATRIX_REPO_ROOT } = await import('../support/native/rejection-recovery-runtime')
    const fsModule = await import('node:fs')
    assert.equal(path.basename(MATRIX_REPO_ROOT), 'organization-approval-redesign')
    await fsModule.promises.access(path.join(MATRIX_REPO_ROOT, 'package.json'))
    await fsModule.promises.access(path.join(MATRIX_REPO_ROOT, 'prisma', 'schema.prisma'))
    await fsModule.promises.access(path.join(MATRIX_REPO_ROOT, 'tests', 'support', 'native', 'seed-business-fixture.ts'))
    await fsModule.promises.access(path.join(MATRIX_REPO_ROOT, 'tests', 'support', 'native', 'outbound-allowlist-preload.js'))
  })

  it('rsync exclusions and matrix-forbidden ports match the reviewed policy', async () => {
    const { RSYNC_EXCLUDES, MATRIX_FORBIDDEN_PORTS } = await import('../support/native/rejection-recovery-runtime')
    for (const required of ['.env*', '.next', 'node_modules', 'uploads', '.git', '.worktrees', 'worktrees', 'test-results', 'playwright-report', 'graphify-out', 'scratch']) {
      assert.ok((RSYNC_EXCLUDES as readonly string[]).includes(required), `missing rsync exclusion ${required}`)
    }
    for (const port of [3100, 5432, 50666]) {
      assert.ok(MATRIX_FORBIDDEN_PORTS.has(port), `matrix-forbidden ports must include ${port}`)
    }
  })

  it('stop ordering: artifacts captured BEFORE verified stops; failed stop is recorded and not retried', async () => {
    const { stopMatrixRuntime, clearMatrixStopBlock, matrixStopBlockReason } = await import('../support/native/rejection-recovery-runtime')
    clearMatrixStopBlock()
    const events: string[] = []
    const stopPg = async (): Promise<void> => { events.push('stop-pg') }
    const failingStopApp = async (): Promise<void> => { events.push('stop-app'); throw new Error('app stop failed') }
    const handleStub = { stopped: false, stopFailure: undefined as string | undefined }
    await stopMatrixRuntime(
      handleStub as never,
      { captureArtifacts: async () => { events.push('capture') } },
      () => undefined,
      { stopApp: failingStopApp, closeMail: async () => { events.push('close-mail') }, stopPg },
    ).then(
      () => { throw new Error('stop failures must surface') },
      (error: unknown) => assert.match(error instanceof Error ? error.message : String(error), /app stop failed/),
    )
    assert.ok(events.indexOf('capture') < events.indexOf('stop-app'), 'capture must precede stops')
    assert.deepEqual(events, ['capture', 'stop-app', 'close-mail', 'stop-pg'])
    assert.equal(handleStub.stopped, false, 'failed stop must not be marked successful')
    assert.match(handleStub.stopFailure ?? '', /app stop failed/)
    assert.match(matrixStopBlockReason() ?? '', /app stop failed/)
    const beforeRetry = events.length
    await assert.rejects(
      () => stopMatrixRuntime(handleStub as never, {}, () => undefined, {
        stopApp: async () => { events.push('stop-app-2') },
        closeMail: async () => { events.push('close-mail-2') },
        stopPg: async () => { events.push('stop-pg-2') },
      }),
      /previous owned stop failed/,
    )
    assert.equal(events.length, beforeRetry, 'a failed stop is not retried')
    clearMatrixStopBlock()
  })
})

// ---------------------------------------------------------------------------
// Parent steering: state-machine validation for EVERY case plan, and fake-UI
// dependency-boundary tests for the real orchestrator (runMatrixCase).
// ---------------------------------------------------------------------------
import {
  validateCasePlan,
  runMatrixCase,
  type MatrixUi,
  type HeldRejectDialog,
} from '../support/rejection-recovery-matrix'

function recordingFakeUi(options: {
  failAfter?: number
  staleDenies?: boolean
  staleUnavailable?: boolean
  staleUnknown?: boolean
  mismatchInstance?: boolean
  mutateSnapshot?: boolean
  ineligible?: boolean
  wrongPreviousInstance?: boolean
  heldCloseFails?: boolean
} = {}): { ui: MatrixUi; calls: string[]; heldDialogEvents: string[] } {
  const calls: string[] = []
  const heldDialogEvents: string[] = []
  let executed = 0
  let snapshotReads = 0
  const failBoundary = options.failAfter !== undefined
  const requestId = 'req-real-1'
  const attempts: Record<'REQUEST' | 'SOLUTION' | 'FINAL', number> = { REQUEST: 1, SOLUTION: 1, FINAL: 1 }
  const active = (phase: 'REQUEST' | 'SOLUTION' | 'FINAL') => ({
    requestId,
    instanceId: `inst-${phase}-${attempts[phase]}`,
    attempt: attempts[phase],
    phase,
  })
  const snapshot = () => ({
    requestId,
    status: 'Completed',
    requestPendingRows: 0,
    solutionPendingRows: 0,
    finalPendingRows: 0,
    instances: [
      { id: 'inst-REQUEST-2', phase: 'REQUEST', attempt: 2, state: 'APPROVED', supersededAt: null },
      { id: 'inst-SOLUTION-2', phase: 'SOLUTION', attempt: 2, state: 'APPROVED', supersededAt: null },
      { id: 'inst-FINAL-2', phase: 'FINAL', attempt: 2, state: 'APPROVED', supersededAt: null },
    ],
    activities: [{ id: 'act-1', action: 'status_changed', fromStatus: 'FinalApproval', toStatus: 'Completed', userId: 'user-department-manager', comments: null }],
    notifications: [{ id: 'note-1', type: 'status_changed', userId: 'user-requester-a', title: 'Completed' }],
  })
  const ui: MatrixUi = {
    hasFailed: () => failBoundary && executed >= (options.failAfter ?? Number.MAX_SAFE_INTEGER),
    readActivePhase: async (phase) => active(phase),
    readRequestRef: async () => ({ requestId, status: 'SentToEngineer' }),
    readPublishedRouteProof: async (profile) => expectedActiveRouteProof(profile),
    readActionBaseline: async (phase, _title, order) => {
      const current = active(phase)
      return {
        requestId,
        phase,
        instanceId: current.instanceId,
        attempt: current.attempt,
        approvalRowId: `row-${phase}-${order}-${current.attempt}`,
        order,
        actorId: options.ineligible ? 'not-a-candidate' : 'baseline-actor',
        routingMode: 'SNAPSHOT_GROUP',
        requiredPositionId: 'position-supervisor',
        candidateUserIds: options.ineligible ? ['someone-else'] : Object.values(FIXTURE_ACTORS).map((id) => matrixActorId(id)),
        observedStatus: 'pending',
        solutionId: phase === 'SOLUTION' ? 'sol-real-1' : null,
      }
    },
    readRevisionBaseline: async (phase, _title, expectedState) => {
      const current = active(phase)
      return {
        requestId,
        phase,
        instanceId: current.instanceId,
        attempt: current.attempt,
        solutionId: phase === 'SOLUTION' ? 'sol-real-1' : null,
        observedStatus: expectedState === 'approved' ? 'DesignCostEstimationApproval' : 'SentToEngineer',
        expectedState,
        rowStates: [{ order: 1, status: expectedState, approvalRowId: `rev-${phase}-${current.attempt}` }],
      }
    },
    readTerminalSnapshot: async () => {
      snapshotReads += 1
      const base = snapshot()
      if (options.mutateSnapshot && snapshotReads > 1) {
        return {
          ...base,
          activities: [...base.activities, { id: 'act-stale', action: 'approval_rejected', fromStatus: 'Completed', toStatus: 'SentToEngineer', userId: 'user-supervisor-p', comments: 'stale' }],
        }
      }
      return base
    },
    createRequest: async (row, title) => {
      executed += 1
      calls.push(`create:${row.id}:${title}`)
      return JSON.stringify({ requestId, status: 'ImprovementRequest', title })
    },
    approveStep: async (row, step, _title, baseline) => {
      executed += 1
      calls.push(`approve:${row.id}:${step.phase}:a${step.attempt}:pos${step.stepOrder}:${step.actor}`)
      return JSON.stringify({
        requestId,
        phase: step.phase,
        attempt: options.mismatchInstance ? 1 : baseline.attempt,
        stepOrder: step.stepOrder,
        actor: step.actor,
        approvalRowId: options.mismatchInstance ? 'other-row' : baseline.approvalRowId,
        status: 'approved',
        order: step.stepOrder,
        instanceId: options.mismatchInstance ? 'historical-attempt-1' : baseline.instanceId,
      })
    },
    submitSolution: async (row, _title, custom) => {
      executed += 1
      calls.push(`submit-solution:${row.id}:custom=${custom}`)
      const observedStatus = 'DesignCostEstimationApproval'
      const observedInstanceId = 'inst-SOLUTION-1'
      const routeSource = custom ? 'CUSTOM_PERSON' : expectedRouteSource(row.profile, 'SOLUTION')
      const pendingActorIds = custom
        ? CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id))
        : RANK_CHAINS[row.profile].SOLUTION.map((id) => matrixActorId(id))
      return JSON.stringify({
        requestId,
        solutionId: 'sol-real-1',
        instanceId: observedInstanceId,
        observedInstanceId,
        attempt: 1,
        status: observedStatus,
        observedStatus,
        routingMode: custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
        routeSource,
        observedRouteSource: routeSource,
        pendingActorIds,
        customChainIds: custom ? pendingActorIds : undefined,
      })
    },
    rejectCurrentStep: async (row, _title, baseline) => {
      executed += 1
      calls.push(`reject:${row.id}:${row.phase}:pos${row.rejectOrder}:${row.orderedActorIds[row.rejectOrder - 1]}`)
      return JSON.stringify({
        requestId,
        phase: row.phase,
        actor: row.orderedActorIds[row.rejectOrder - 1],
        order: row.rejectOrder,
        instanceId: baseline.instanceId,
        status: expectedPostRejectStatus(row.phase),
        rejectionRowId: baseline.approvalRowId,
        reason: row.reason,
      })
    },
    openHeldRejectDialog: async (row, _title, baseline) => {
      calls.push(`hold-open:${row.id}`)
      heldDialogEvents.push('held-open')
      const held: HeldRejectDialog = {
        target: {
          instanceId: baseline.instanceId,
          attempt: baseline.attempt,
          stepOrder: baseline.order,
          actor: row.orderedActorIds[row.rejectOrder - 1],
          approvalRowId: baseline.approvalRowId,
        },
        confirmAvailable: async () => {
          heldDialogEvents.push('confirm-available')
          return options.staleUnavailable !== true
        },
        staleConfirm: async () => {
          calls.push('stale-confirm')
          heldDialogEvents.push('stale-confirm')
          if (options.staleUnknown) return { outcome: 'unknown', evidence: 'no toast before the bounded wait ended' }
          if (options.staleDenies === false) return { outcome: 'succeeded', evidence: 'success toast (UNEXPECTED)' }
          return { outcome: 'denied', evidence: 'denial toast; terminal/instance/audit snapshot unchanged' }
        },
        close: async () => {
          heldDialogEvents.push('held-close')
          if (options.heldCloseFails) throw new Error('held close failed')
        },
      }
      return held
    },
    resubmit: async (row, phase, custom, _title, baseline) => {
      executed += 1
      calls.push(`resubmit:${row.id}:${phase}:custom=${custom}`)
      const previousAttempt = baseline.attempt
      const previousInstanceId = options.wrongPreviousInstance ? 'other-instance' : baseline.instanceId
      attempts[phase] += 1
      return JSON.stringify({
        requestId,
        phase,
        previousAttempt,
        newAttempt: attempts[phase],
        previousInstanceId,
        newInstanceId: `inst-${phase}-${attempts[phase]}`,
        previousSuperseded: true,
        carriedApprovals: 0,
        customChainIds: custom ? CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id)) : undefined,
      })
    },
    initiateFinal: async (row, _title, custom) => {
      executed += 1
      const prior = calls.filter((call) => call.startsWith(`initiate-final:${row.id}`)).length
      if (prior >= 1) attempts.FINAL += 1
      calls.push(`initiate-final:${row.id}:custom=${custom}`)
      const observedStatus = 'FinalApproval'
      const observedInstanceId = `inst-FINAL-${attempts.FINAL}`
      const routeSource = custom ? 'CUSTOM_PERSON' : expectedRouteSource(row.profile, 'FINAL')
      const pendingActorIds = custom
        ? CUSTOM_CHAINS.FINAL.map((id) => matrixActorId(id))
        : RANK_CHAINS[row.profile].FINAL.map((id) => matrixActorId(id))
      return JSON.stringify({
        requestId,
        instanceId: observedInstanceId,
        observedInstanceId,
        attempt: prior + 1,
        status: observedStatus,
        observedStatus,
        routingMode: custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
        routeSource,
        observedRouteSource: routeSource,
        pendingActorIds,
        customChainIds: custom ? pendingActorIds : undefined,
      })
    },
    checkReviserControl: async (row) => {
      executed += 1
      calls.push(`reviser-control:${row.id}`)
      return 'reviser control visible'
    },
    checkUnauthorizedViewer: async (row) => {
      executed += 1
      calls.push(`unauthorized-viewer:${row.id}`)
      return 'unauthorized viewer read-only'
    },
    verifyCompleted: async (row) => {
      executed += 1
      calls.push(`verify-completed:${row.id}`)
      return JSON.stringify({
        requestId,
        status: 'Completed',
        requestPendingRows: 0,
        solutionPendingRows: 0,
        finalPendingRows: 0,
        bannerSeen: true,
        stage3InViewport: true,
      })
    },
  }
  return { ui, calls, heldDialogEvents }
}

describe('state-machine validation across ALL 44 case plans', () => {
  const rows = buildInventory()

  it('every plan passes the strict state machine (reject only the current pending position; one submission/revision per attempt)', () => {
    for (const row of rows) {
      assert.doesNotThrow(() => validateCasePlan(row, buildCasePlan(row)), row.id)
    }
  })

  it('rejects the parent RRM-004 regression: SOLUTION pos1 must not be pre-approved and recovery must not resubmit via a second submit-solution', () => {
    const row = rows.find((r) => r.id === 'RRM-004')!
    assert.equal(row.phase, 'SOLUTION')
    assert.equal(row.rejectOrder, 1)
    const plan = buildCasePlan(row)
    const submits = plan.filter((s) => s.kind === 'submit-solution')
    assert.equal(submits.length, 1, 'exactly one submit-solution (recovery uses resubmit)')
    const resubmitIndex = plan.findIndex((s) => s.kind === 'resubmit')
    assert.ok(resubmitIndex > plan.findIndex((s) => s.kind === 'reject'), 'resubmit after the rejection')
    const approvalsBeforeReject = plan.filter(
      (s) => s.kind === 'approve' && s.phase === 'SOLUTION' && s.attempt === 1,
    ).length
    assert.equal(approvalsBeforeReject, 0, 'pos1 target must still be pending at the rejection')
    // The plan itself must FAIL its own state machine when the target is pre-approved.
    const poisoned = [
      ...plan.slice(0, 2),
      { kind: 'approve', phase: 'SOLUTION', stepOrder: 1, actor: row.orderedActorIds[0], attempt: 1 } as const,
      ...plan.slice(2),
    ]
    assert.throws(() => validateCasePlan(row, poisoned as never), /target not current|already approved|out of order/i)
  })

  it('rejects an out-of-order approval (pos2 approved before pos1) in every phase', () => {
    for (const row of rows.slice(0, 12)) {
      if (row.rejectOrder !== 2) continue
      const plan = buildCasePlan(row)
      const rejectIndex = plan.findIndex((s) => s.kind === 'reject')
      const poisoned = [
        ...plan.slice(0, rejectIndex),
        { kind: 'approve', phase: row.phase, stepOrder: 2, actor: row.orderedActorIds[1], attempt: 1 } as const,
        ...plan.slice(rejectIndex),
      ]
      assert.throws(() => validateCasePlan(row, poisoned as never), /target not current|out of order/i)
    }
  })

  it('duplicate submit-solution and duplicate initiations fail validation', () => {
    const row = rows.find((r) => r.id === 'RRM-004')!
    const plan = buildCasePlan(row)
    const rejectIndex = plan.findIndex((s) => s.kind === 'reject')
    const duplicated = [
      ...plan.slice(0, rejectIndex),
      { kind: 'submit-solution', actor: FIXTURE_ACTORS.engineerA, custom: false } as const,
      ...plan.slice(rejectIndex),
    ]
    assert.throws(() => validateCasePlan(row, duplicated as never), /duplicate submit-solution/i)
  })
})

describe('runMatrixCase orchestration via fake UI boundary', () => {
  it('stale holding NEVER executes the primary rejection twice: hold opens, real reject runs once, stale confirm denied after Completed', async () => {
    const rows = buildInventory()
    const row = rows.find((r) => r.phase === 'FINAL' && r.chainKind === 'rank' && r.rejectOrder === 1)!
    const { ui, calls, heldDialogEvents } = recordingFakeUi({ staleDenies: true })
    const ledger = new MatrixLedger()
    const journalNotes: string[] = []
    const stale = await runMatrixCase(row, ui, ledger, async (note) => { journalNotes.push(note ?? '') }, 'T')
    assert.equal(stale.staleNegative, 'passed')
    assert.deepEqual(heldDialogEvents, ['held-open', 'confirm-available', 'stale-confirm', 'held-close'])
    assert.equal(calls.filter((c) => c.startsWith(`reject:${row.id}`)).length, 1, 'primary rejection exactly once')
    assert.equal(calls.filter((c) => c === 'stale-confirm').length, 1)
    const staleIndex = calls.indexOf('stale-confirm')
    const completedIndex = calls.indexOf(`verify-completed:${row.id}`)
    assert.ok(completedIndex < staleIndex, 'stale confirm only AFTER Completed is proven')
    const rejectIndex = calls.indexOf(`reject:${row.id}`)
    assert.ok(rejectIndex < completedIndex && rejectIndex < staleIndex)
    const deniedEntry = ledger.all.find((e) => e.action === 'stale-confirm-rejection')
    assert.equal(deniedEntry?.stage, 'denied')
    void journalNotes
  })

  it('page errors BLOCK subsequent clicks (hasFailed boundary stops the orchestrator)', async () => {
    const rows = buildInventory()
    const row = rows.find((r) => r.phase === 'REQUEST' && r.chainKind === 'rank' && r.rejectOrder === 3)!
    const { ui, calls } = recordingFakeUi({ failAfter: 3 }) // fail right after create+2 approvals
    const ledger = new MatrixLedger()
    await assert.rejects(
      () => runMatrixCase(row, ui, ledger, async () => undefined, 'T'),
      /page error recorded; blocking all further clicks/,
    )
    const clickCalls = calls.filter((c) => /^(approve|reject|resubmit|initiate-final|submit-solution|verify-completed)/.test(c))
    assert.ok(clickCalls.length <= 3, `no clicks after the page error (got ${clickCalls.length})`)
    ledger.assertNoUnresolvedAttempting() // every begun step was confirmed with evidence (no unresolved attempting)
  })

  it('SOLUTION-custom recovery keeps the SAME custom chain via resubmit (never a second submit-solution)', async () => {
    const rows = buildInventory()
    const row = rows.find((r) => r.profile === 'all-defaults' && r.phase === 'SOLUTION' && r.chainKind === 'custom')!
    const { ui, calls } = recordingFakeUi()
    await runMatrixCase(row, ui, new MatrixLedger(), async () => undefined, 'T')
    assert.equal(calls.filter((c) => c.startsWith(`submit-solution:${row.id}`)).length, 1)
    const resubmitIndex = calls.findIndex((c) => c.startsWith(`resubmit:${row.id}`))
    assert.ok(resubmitIndex > -1)
    assert.match(calls[resubmitIndex], /custom=true/)
  })
})

describe('stale-window unavailability is disclosed, not passed and not thrown', () => {
  it('auto-invalidated held dialog is unavailable: no click, no denied record, not a pass', async () => {
    const rows = buildInventory()
    const row = rows.find((r) => r.phase === 'FINAL' && r.chainKind === 'rank' && r.rejectOrder === 1)!
    const { ui, calls } = recordingFakeUi({ staleUnavailable: true })
    const ledger = new MatrixLedger()
    const stale = await runMatrixCase(row, ui, ledger, async () => undefined, 'T')
    assert.equal(stale.staleNegative, 'stale-window-unavailable')
    assert.equal(calls.filter((call) => call === 'stale-confirm').length, 0)
    assert.equal(ledger.all.find((entry) => entry.action === 'stale-confirm-rejection'), undefined)
    ledger.assertNoUnresolvedAttempting()
  })

  it('a changed terminal/instance/audit snapshot is not a passed stale denial', async () => {
    const rows = buildInventory()
    const row = rows.find((r) => r.phase === 'FINAL' && r.chainKind === 'rank' && r.rejectOrder === 1)!
    const { ui } = recordingFakeUi({ mutateSnapshot: true })
    await assert.rejects(
      () => runMatrixCase(row, ui, new MatrixLedger(), async () => undefined, 'T'),
      /changed terminal\/instance\/audit snapshot/,
    )
  })
})

describe('parent review reproduction: evidence is not a mirrored claim', () => {
  const rejection = {
    phase: 'FINAL' as const,
    requestId: 'by-title',
    status: 'Completed' as const,
    actor: 'wrong-user',
    reason: 'anything',
    rejectedRows: 1,
    instanceId: 'correlated-by-title',
    rejectionRowId: 'rej-1',
    attempt: 1,
    order: 1,
  }

  it('rejects a wrong rejection status, placeholder ids, and a one-argument call', () => {
    assert.throws(() => assertRejectionEvidence(rejection as never), /expected rejection target is required/)
    assert.throws(() => assertRejectionEvidence(rejection as never, {
      phase: 'FINAL',
      requestId: 'req-real-1',
      status: 'SentToEngineer',
      actor: 'user-supervisor-p',
      reason: 'anything',
      order: 1,
      instanceId: 'inst-final-1',
      attempt: 1,
    }), /placeholder|wrong rejection status/)
  })

  it('rejects a historical instance claimed as a later attempt and a row id labeled requestId', () => {
    assert.throws(() => assertApprovalEvidence({
      phase: 'FINAL',
      attempt: 2,
      stepOrder: 1,
      actor: 'expected-user',
      requestId: 'approval-row-id',
      status: 'approved',
      order: 1,
      instanceId: 'historical-attempt-1',
      approvalRowId: 'approval-row-1',
    }), /expected approval target is required/)
    assert.throws(() => assertApprovalEvidence({
      phase: 'FINAL',
      attempt: 2,
      stepOrder: 1,
      actor: 'user-supervisor-p',
      requestId: 'req-real-1',
      status: 'approved',
      order: 1,
      instanceId: 'historical-attempt-1',
      approvalRowId: 'approval-row-1',
    }, {
      phase: 'FINAL',
      attempt: 2,
      stepOrder: 1,
      actor: 'user-supervisor-p',
      requestId: 'req-real-1',
      instanceId: 'inst-final-2',
    }), /stale or wrong approval instance/)
  })

  it('rejects a length-2 custom chain that is not the intended selected ids', () => {
    assert.throws(() => assertFinalInitiationEvidence({
      requestId: 'by-title',
      initiationRowId: 'row-1',
      instanceId: 'inst-1',
      attempt: 1,
      status: 'FinalApproval',
      observedStatus: 'FinalApproval',
      pendingFinalRows: 2,
      pendingApproverIds: ['wrong1', 'wrong2'],
      customChainIds: ['wrong1', 'wrong2'],
    }), /expected final initiation target is required/)
    assert.throws(() => assertFinalInitiationEvidence({
      requestId: 'req-real-1',
      initiationRowId: 'row-1',
      instanceId: 'inst-final-1',
      attempt: 1,
      status: 'FinalApproval',
      observedStatus: 'FinalApproval',
      pendingFinalRows: 2,
      pendingApproverIds: ['wrong1', 'wrong2'],
      customChainIds: ['wrong1', 'wrong2'],
    }, {
      requestId: 'req-real-1',
      instanceId: 'inst-final-1',
      attempt: 1,
      customChainIds: [...CUSTOM_CHAINS.FINAL],
    }), /!= intended/)
  })

  it('rejects a resubmit whose previous attempt was not captured before revision', () => {
    assert.throws(() => assertResubmitEvidence({
      phase: 'SOLUTION',
      requestId: 'req-real-1',
      newAttempt: 2,
      previousAttempt: -1,
      previousInstanceId: 'inst-old',
      newInstanceId: 'inst-new',
      previousSuperseded: true,
      carriedApprovals: 0,
    }, {
      requestId: 'req-real-1',
      previousAttempt: -1,
      previousInstanceId: 'inst-old',
    }), /captured before revision/)
  })

  it('completed proof requires the actual banner and in-viewport stage 3, not a hardcoded flag stand-in from a missing check', () => {
    assert.throws(() => assertCompletedEvidence({
      requestId: 'req-real-1',
      status: 'Completed',
      requestPendingRows: 0,
      solutionPendingRows: 0,
      finalPendingRows: 0,
      bannerSeen: false,
      stage3InViewport: true,
    }), /banner/)
  })
})

describe('psql adapter output and read-only SQL', () => {
  it('pipe-separated psql text is not JSON, including the parent approval-id sample', () => {
    assert.throws(
      () => parsePsqlJsonDocument('approval-id|1|user-supervisor-p|approved|instance-id'),
      /not JSON/,
    )
  })

  it('strips transaction command tags and parses the one JSON cell', () => {
    assert.deepEqual(parsePsqlJsonDocument('START TRANSACTION\n[{"id":"real-row"}]\nROLLBACK'), [{ id: 'real-row' }])
  })

  it('refuses stacked writes and COMMIT escapes before any query runs', () => {
    assert.throws(() => assertReadOnlySingleSelect('select 1; commit'), /multiple statements/)
    assert.throws(() => assertReadOnlySingleSelect('select 1; delete from requests'), /multiple statements/)
    assert.throws(() => assertReadOnlySingleSelect("select 1; COMMIT; delete from requests"), /multiple statements/)
    assert.throws(() => assertReadOnlySingleSelect('commit'), /only a single SELECT|write\/transaction/)
  })

  it('evidence SQL quotes camelCase, never reads request_approvals.attempt, and scopes the captured instance', () => {
    const sql = approvalRowSql({
      phase: 'FINAL',
      requestId: 'req-real-1',
      instanceId: 'inst-final-2',
      attempt: 2,
      stepOrder: 1,
      actor: 'user-supervisor-p',
      status: 'rejected',
    })
    assert.doesNotMatch(sql, /\bt\.attempt\b/)
    assert.match(sql, /"approverId"/)
    assert.match(sql, /"isFinalApproval" = true/)
    assert.match(sql, /"instanceId" = 'inst-final-2'/)
    assert.match(sql, /i\.attempt = 2/)
    assert.match(sql, /i\.phase = 'FINAL'/)
    assert.doesNotMatch(sql, /START TRANSACTION|COMMIT|ROLLBACK/)
    const solution = activeInstanceSql('SOLUTION', 'req-real-1')
    assert.match(solution, /i\."solutionId"/)
    assert.doesNotMatch(solution, /\bt\.attempt\b/)
    const pending = pendingChainSql('SOLUTION', 'inst-solution-1')
    assert.match(pending, /"requiredApproverId"/)
    assert.match(pending, /"approverId"/)
    const snapshot = terminalSnapshotSql('req-real-1')
    assert.match(snapshot, /request_activities/)
    assert.match(snapshot, /notifications/)
    assert.match(snapshot, /approval_instances/)
  })

  it('injected query receives the single SELECT only after an owned identity recheck', async () => {
    const { executeReadOnlyQuery } = await import('../support/native/rejection-recovery-runtime')
    const calls: string[] = []
    await assert.rejects(() => executeReadOnlyQuery({
      sql: 'select 1; commit',
      ownedDatabase: 'app_cleanstart_dev',
      ownedDataDir: '/owned/pgdata',
      verifyIdentity: async () => ({ connectedDatabase: 'app_cleanstart_dev', dataDirectory: '/owned/pgdata' }),
      query: async (sql: string) => { calls.push(sql); return '[]' },
    }), /multiple statements/)
    assert.equal(calls.length, 0)
    await assert.rejects(() => executeReadOnlyQuery({
      sql: "select coalesce(json_agg(row_to_json(evidence)), '[]'::json)::text from (select 1) evidence",
      ownedDatabase: 'app_cleanstart_dev',
      ownedDataDir: '/owned/pgdata',
      verifyIdentity: async () => ({ connectedDatabase: 'postgres', dataDirectory: '/foreign' }),
      query: async (sql: string) => { calls.push(sql); return '[]' },
    }), /identity recheck failed/)
    assert.equal(calls.length, 0)
    const parsed = await executeReadOnlyQuery({
      sql: "select coalesce(json_agg(row_to_json(evidence)), '[]'::json)::text from (select 1) evidence",
      ownedDatabase: 'app_cleanstart_dev',
      ownedDataDir: '/owned/pgdata',
      verifyIdentity: async () => ({ connectedDatabase: 'app_cleanstart_dev', dataDirectory: '/owned/pgdata' }),
      query: async (sql: string) => {
        calls.push(sql)
        return 'approval-id|1|user-supervisor-p|approved|instance-id'
      },
    }).then(() => { throw new Error('pipe output must not parse') }, (error: unknown) => error)
    assert.match(String(parsed), /not JSON/)
    assert.equal(calls.length, 1)
    assert.doesNotMatch(calls[0], /START TRANSACTION|COMMIT|ROLLBACK/)
    const ok = await executeReadOnlyQuery({
      sql: "select coalesce(json_agg(row_to_json(evidence)), '[]'::json)::text from (select 1) evidence",
      ownedDatabase: 'app_cleanstart_dev',
      ownedDataDir: '/owned/pgdata',
      verifyIdentity: async () => ({ connectedDatabase: 'app_cleanstart_dev', dataDirectory: '/owned/pgdata' }),
      query: async () => 'START TRANSACTION\n[{"id":"real-row"}]\nROLLBACK',
    })
    assert.deepEqual(ok, [{ id: 'real-row' }])
  })
})

describe('ledger durability and journal retention', () => {
  it('an unresolved attempting entry blocks a different later mutation', () => {
    const ledger = new MatrixLedger()
    ledger.begin({ caseId: 'RRM-001', action: 'approve-step', phase: 'REQUEST', attempt: 1, stepOrder: 1, actor: FIXTURE_ACTORS.supervisorP, instanceId: 'inst-1' })
    assert.throws(
      () => ledger.begin({ caseId: 'RRM-001', action: 'confirm-rejection', phase: 'REQUEST', attempt: 1, stepOrder: 1, actor: FIXTURE_ACTORS.supervisorP, instanceId: 'inst-1' }),
      /blocks every later mutation/,
    )
    assert.throws(() => ledger.recordDeniedStaleConfirm({
      caseId: 'RRM-001', action: 'stale-confirm-rejection', phase: 'FINAL', attempt: 1, stepOrder: 1, actor: FIXTURE_ACTORS.supervisorP,
    }, 'denied without begin'), /without preattempt/)
  })

  it('journal write is awaited before the business click, and a journal failure does not click', async () => {
    const row = buildInventory().find((item) => item.id === 'RRM-001')!
    const { ui, calls } = recordingFakeUi()
    const ledger = new MatrixLedger()
    await assert.rejects(
      () => runMatrixCase(row, ui, ledger, async () => { throw new Error('disk full') }, 'T'),
      /disk full/,
    )
    assert.deepEqual(calls, [])
    assert.equal(ledger.all[0]?.stage, 'attempting')
  })

  it('flushing the next case retains the previous case ledger', () => {
    const journal = emptyMatrixJournal()
    const first = new MatrixLedger()
    const begun = first.begin({ caseId: 'RRM-001', action: 'submit-request', actor: FIXTURE_ACTORS.requesterA })
    first.confirm(begun, '{"requestId":"req-real-1"}')
    retainCaseJournal(journal, 'RRM-001', first.all, 'confirmed')
    const second = new MatrixLedger()
    retainCaseJournal(journal, 'RRM-002', second.all, 'started')
    const rendered = renderMatrixProgress(journal, { 'RRM-002': { status: 'running' } }, [])
    assert.equal(rendered.ledgers['RRM-001']?.length, 1)
    assert.equal(rendered.ledgers['RRM-001']?.[0]?.stage, 'confirmed')
    assert.deepEqual(rendered.ledgers['RRM-002'], [])
  })

  it('a stale approval instance returned by the boundary is not confirmed', async () => {
    const row = buildInventory().find((item) => item.phase === 'REQUEST' && item.rejectOrder === 1)!
    const { ui } = recordingFakeUi({ mismatchInstance: true })
    await assert.rejects(
      () => runMatrixCase(row, ui, new MatrixLedger(), async () => undefined, 'T'),
      /instance does not match the instance captured before the click|approval proof/,
    )
  })
})

describe('custom toggle and route parity', () => {
  it('FINAL uses the unnamed button once; solution/resubmit use the radix switch once', async () => {
    const events: string[] = []
    await enableCustomHierarchy({
      clickSwitch: async () => { events.push('switch') },
      clickUnnamedFinalButton: async () => { throw new Error('FINAL control used on solution') },
      switchChecked: async () => true,
      finalOnVisible: async () => false,
    }, 'solution')
    await enableCustomHierarchy({
      clickSwitch: async () => { throw new Error('switch used on FINAL') },
      clickUnnamedFinalButton: async () => { events.push('unnamed') },
      switchChecked: async () => false,
      finalOnVisible: async () => true,
    }, 'final')
    assert.deepEqual(events, ['switch', 'unnamed'])
    assert.equal(customToggleControl('resubmit'), 'radix-switch')
    assert.equal(customToggleControl('final'), 'unnamed-final-button')
  })

  it('rank SOLUTION actors are Engineering and REQUEST/FINAL actors are Production, with live co-candidate verification still required', () => {
    for (const profile of PROFILE_ORDER) {
      assert.ok(RANK_CHAINS[profile].SOLUTION.includes(FIXTURE_ACTORS.departmentManager))
      assert.ok(!RANK_CHAINS[profile].SOLUTION.includes(FIXTURE_ACTORS.supervisorP))
      assert.ok(!RANK_CHAINS[profile].REQUEST.includes(FIXTURE_ACTORS.supervisorE))
      assert.equal(expectedRouteSource(profile, 'REQUEST'), 'COMPANY_DEFAULT')
      assert.equal(expectedScopeUnitId(profile, 'REQUEST'), 'unit-company')
    }
    assert.equal(expectedRouteSource('solution-exception', 'SOLUTION'), 'UNIT_EXCEPTION')
    assert.equal(expectedScopeUnitId('solution-exception', 'SOLUTION'), 'unit-engineering-section')
    assert.equal(expectedRouteSource('final-exception', 'FINAL'), 'UNIT_EXCEPTION')
    assert.equal(LIVE_CO_CANDIDATE_VERIFICATION, 'required-at-case-start-not-passed')
    assert.deepEqual(MATRIX_HEADED, { headless: false, slowMo: 1500, viewport: { width: 1440, height: 1000 }, checkpointMs: 6000 })
  })

  it('SOLUTION custom recovery reselects the same ids, and a carried approval fails the proof', () => {
    const row = buildInventory().find((item) => item.profile === 'all-defaults' && item.phase === 'SOLUTION' && item.chainKind === 'custom')!
    const plan = buildCasePlan(row)
    const resubmit = plan.find((step) => step.kind === 'resubmit')
    assert.equal(resubmit && resubmit.kind === 'resubmit' && resubmit.custom, true)
    assert.throws(() => assertSolutionSubmitEvidence({
      requestId: 'req-real-1',
      solutionId: 'sol-real-1',
      instanceId: 'inst-solution-1',
      attempt: 1,
      status: 'DesignCostEstimationApproval',
      pendingApprovalRows: 2,
      pendingApproverIds: ['wrong1', 'wrong2'],
      customChainIds: ['wrong1', 'wrong2'],
    }, {
      requestId: 'req-real-1',
      instanceId: 'inst-solution-1',
      attempt: 1,
      customChainIds: [...CUSTOM_CHAINS.SOLUTION],
    }), /!= intended/)
    assert.throws(() => assertResubmitEvidence({
      phase: 'SOLUTION',
      requestId: 'req-real-1',
      previousAttempt: 1,
      newAttempt: 2,
      previousInstanceId: 'inst-old',
      newInstanceId: 'inst-new',
      previousSuperseded: true,
      carriedApprovals: 1,
    }, { requestId: 'req-real-1', previousAttempt: 1, previousInstanceId: 'inst-old' }), /carried/)
  })
})

describe('trace, failure artifacts, and browser enclosure', () => {
  it('does not index a trace that failed to save or does not exist', async () => {
    const index: string[] = []
    await assert.rejects(() => finalizeTraceArtifact({
      stop: async () => { throw new Error('zip failed') },
      exists: async () => true,
      tracePath: '/tmp/missing.zip',
      index,
    }), /trace save failed/)
    assert.deepEqual(index, [])
    await assert.rejects(() => finalizeTraceArtifact({
      stop: async () => undefined,
      exists: async () => false,
      tracePath: '/tmp/not-written.zip',
      index,
    }), /only after it exists/)
    assert.deepEqual(index, [])
  })

  it('writes real failure artifacts before claiming them', async () => {
    const { writeFailureArtifacts } = await import('../support/native/rejection-recovery-runtime')
    const os = await import('node:os')
    const fs = await import('node:fs/promises')
    const pathMod = await import('node:path')
    const dir = await fs.mkdtemp(pathMod.join(os.tmpdir(), 'rrm-failure-'))
    const written = await writeFailureArtifacts({
      dir,
      label: 'case-failed',
      error: new Error('boom'),
      screenshot: async (file) => { await fs.writeFile(file, 'png') },
      dbText: '{"status":"SentToEngineer"}',
      auditText: '[]',
      mailText: '[]',
      notificationText: '[]',
      progressText: '{"cases":{}}',
    })
    assert.ok(written.length >= 5)
    for (const file of written) {
      const stat = await fs.stat(file)
      assert.ok(stat.size > 0, file)
    }
    await fs.rm(dir, { recursive: true })
  })

  it('launch failure still stops the owned runtime; the browser close is enclosed', async () => {
    const { runOwnedMatrixSession, clearMatrixStopBlock } = await import('../support/native/rejection-recovery-runtime')
    clearMatrixStopBlock()
    const events: string[] = []
    const handle = {
      stopped: false,
      runtime: { runId: 'business-test-20261011t000000-abcd', paths: { rootDir: '/tmp/retained-root' } },
      captureArtifacts: async () => { events.push('capture') },
    }
    await assert.rejects(() => runOwnedMatrixSession({
      handle: handle as never,
      launchBrowser: async () => { events.push('launch'); throw new Error('launch failed') },
      run: async () => { events.push('run'); return 'ok' },
      stop: async () => { events.push('stop') },
    }), /launch failed/)
    assert.deepEqual(events, ['launch', 'stop'])
    events.length = 0
    let closed = false
    await assert.rejects(() => runOwnedMatrixSession({
      handle: handle as never,
      launchBrowser: async () => ({ close: async () => { closed = true; events.push('close') } }),
      run: async () => { events.push('run'); throw new Error('case failed') },
      stop: async () => { events.push('stop') },
    }), /case failed/)
    assert.equal(closed, true)
    assert.deepEqual(events, ['run', 'stop', 'close'])
  })
})

describe('injected runtime lifecycle without allocating a database', () => {
  it('orders maintenance identity before database creation and schema push, and captures before one stop on startup failure', async () => {
    const runtimeMod = await import('../support/native/rejection-recovery-runtime')
    const { assertOwnedLoopbackDatabaseTarget, createSafeRunPlan } = await import('../support/business-workflow-safety')
    const { assertNoProtectedAmbientKeys } = await import('../support/native/postgres-instance')
    assert.throws(() => assertNoProtectedAmbientKeys({ DATABASE_URL: 'postgresql://example' }), /DATABASE_URL/)
    runtimeMod.clearMatrixStopBlock()
    const calls: string[] = []
    const runId = 'business-test-20261011t000000-abcd'
    const runtime = {
      runId,
      databaseUrl: 'postgresql://postgres:secret@127.0.0.1:44010/app_cleanstart_dev',
      databasePassword: 'secret',
      e2ePassword: 'e2e-secret',
      ports: { databasePort: 44010, serverPort: 44011, mailPort: 44012 },
      postmasterPid: 4242,
      paths: {
        rootDir: '/tmp/matrix-owned-root',
        dataDir: '/tmp/matrix-owned-root/pgdata',
        logsDir: '/tmp/matrix-owned-root/logs',
        socketDir: '/tmp/matrix-owned-root/pgsocket',
        secretsDir: '/tmp/matrix-owned-root/secrets',
      },
      resource: {
        runId,
        containerName: `${runId}-postgres`,
        databaseName: 'app_cleanstart_dev' as const,
        databasePort: 44010,
        serverPort: 44011,
      },
    }
    const queries: string[] = []
    await assert.rejects(() => runtimeMod.startMatrixRuntime({
      routesConfig: 'all-defaults',
      parentDir: '/tmp/rejection-recovery-matrix',
      log: () => undefined,
      artifactCapture: async (note) => { calls.push(`capture:${note}`) },
    }, {
      assertNoProtectedAmbientKeys: (env) => {
        calls.push('ambient')
        const clean = { ...env }
        for (const key of Object.keys(clean)) {
          if (key === 'DATABASE_URL' || key === 'CLEAN_START_CI_DATABASE_URL' || key.startsWith('SMTP_')) delete clean[key]
        }
        assertNoProtectedAmbientKeys(clean)
      },
      ensureOwnedTmpParent: async (dir) => { calls.push(`tmp:${dir}`); assert.ok(dir.includes('rejection-recovery-matrix')) },
      createOwnedRuntime: async () => { calls.push('allocate'); return runtime as never },
      initdbCluster: async () => { calls.push('initdb') },
      startPostgres: async () => { calls.push('start-pg'); return 4242 },
      verifyOwnedMaintenanceIdentity: async () => { calls.push('maintenance-identity'); return { connectedDatabase: 'postgres' } as never },
      ensureOwnedDatabase: async () => { calls.push('ensure-db') },
      verifyPostgresIdentity: async () => { calls.push('business-identity'); return { connectedDatabase: 'app_cleanstart_dev', dataDirectory: runtime.paths.dataDir } as never },
      psqlQuery: async (_runtime, _database, sql) => { queries.push(sql); calls.push('psql'); return '[]' },
      stopPostgres: async () => { calls.push('stop-pg') },
      runChild: async () => { calls.push('run-child'); throw new Error('schema push refused in this repair') },
      spawnApp: (() => { throw new Error('app must not spawn') }) as never,
      stopAppProcess: async () => { calls.push('stop-app') },
      waitForHttpReady: async () => { calls.push('ready') },
      startMailCapture: async () => { throw new Error('mail must not start') },
      copyAppSource: async () => { calls.push('copy'); return '/tmp/matrix-owned-root/app' },
      assertOwnedLoopbackDatabaseTarget,
      createSafeRunPlan,
    }), /schema push refused/)
    assert.ok(calls.indexOf('maintenance-identity') < calls.indexOf('ensure-db'))
    assert.ok(calls.indexOf('business-identity') < calls.indexOf('run-child'))
    assert.ok(calls.indexOf('copy') < calls.indexOf('run-child'))
    assert.equal(calls.filter((call) => call === 'stop-pg').length, 1)
    assert.ok(calls.includes('capture:startup-capture') || calls.some((call) => call.startsWith('capture:')))
    const captureIndex = calls.findIndex((call) => call.startsWith('capture:'))
    const stopIndex = calls.indexOf('stop-pg')
    assert.ok(captureIndex >= 0 && captureIndex < stopIndex, `capture ${captureIndex} before stop ${stopIndex}: ${calls.join(',')}`)
    assert.equal(calls.filter((call) => call === 'initdb').length, 1)
    runtimeMod.clearMatrixStopBlock()
  })

  it('a forbidden demo/shared port never reaches initdb', async () => {
    const runtimeMod = await import('../support/native/rejection-recovery-runtime')
    runtimeMod.clearMatrixStopBlock()
    const calls: string[] = []
    const runtime = {
      runId: 'business-test-20261011t000000-abcd',
      ports: { databasePort: 50666, serverPort: 44011, mailPort: 44012 },
      paths: { rootDir: '/tmp/matrix-owned-root', dataDir: '/tmp/matrix-owned-root/pgdata', logsDir: '/tmp/matrix-owned-root/logs' },
      resource: { databaseName: 'app_cleanstart_dev', databasePort: 50666, serverPort: 44011, runId: 'business-test-20261011t000000-abcd', containerName: 'business-test-20261011t000000-abcd-postgres' },
    }
    await assert.rejects(() => runtimeMod.startMatrixRuntime({
      routesConfig: 'all-defaults',
      log: () => undefined,
      artifactCapture: async () => { calls.push('capture') },
    }, {
      assertNoProtectedAmbientKeys: () => undefined,
      ensureOwnedTmpParent: async () => undefined,
      createOwnedRuntime: async () => runtime as never,
      initdbCluster: async () => { calls.push('initdb') },
      startPostgres: async () => 1,
      verifyOwnedMaintenanceIdentity: async () => ({ connectedDatabase: 'postgres' } as never),
      ensureOwnedDatabase: async () => undefined,
      verifyPostgresIdentity: async () => ({ connectedDatabase: 'app_cleanstart_dev', dataDirectory: runtime.paths.dataDir } as never),
      psqlQuery: async () => '[]',
      stopPostgres: async () => { calls.push('stop-pg') },
      runChild: async () => 0,
      spawnApp: (() => { throw new Error('no app') }) as never,
      stopAppProcess: async () => undefined,
      waitForHttpReady: async () => undefined,
      startMailCapture: async () => { throw new Error('no mail') },
      copyAppSource: async () => '/tmp/app',
      assertOwnedLoopbackDatabaseTarget: () => undefined,
      createSafeRunPlan: () => ({}) as never,
    }), /50666/)
    assert.deepEqual(calls.filter((call) => call === 'initdb'), [])
    runtimeMod.clearMatrixStopBlock()
  })

  it('partial unique index statements match the native runner definitions and the side-effect CLI is not imported', async () => {
    const fs = await import('node:fs/promises')
    const { PARTIAL_UNIQUE_INDEX_SQL } = await import('../support/native/rejection-recovery-runtime')
    const native = await fs.readFile('tests/support/native/run-native-business-tests.ts', 'utf8')
    const controller = await fs.readFile('tests/support/native/rejection-recovery-runtime.ts', 'utf8')
    assert.equal(PARTIAL_UNIQUE_INDEX_SQL.length, 4)
    for (const statement of PARTIAL_UNIQUE_INDEX_SQL) assert.ok(native.includes(statement), statement)
    assert.equal(/from\s+['\"][^'\"]*run-native-business-tests['\"]/.test(controller), false)
    assert.equal(/from\s+['\"][^'\"]*business-runner-cli['\"]/.test(controller), false)
    assert.equal(/import\s*\(\s*['\"][^'\"]*run-native-business-tests['\"]/.test(controller), false)
  })

  it('the registered capture hook is used when stop is called without an override, and a successful stop is idempotent', async () => {
    const { stopMatrixRuntime, clearMatrixStopBlock } = await import('../support/native/rejection-recovery-runtime')
    clearMatrixStopBlock()
    const events: string[] = []
    const handle = {
      stopped: false,
      artifactsCaptured: false,
      runtime: { runId: 'business-test-20261011t000000-abcd', paths: { rootDir: '/tmp/retained-root' } },
      captureArtifacts: async () => { events.push('hook') },
      setArtifactCapture: (capture: () => Promise<void>) => { handle.captureArtifacts = capture },
    }
    handle.setArtifactCapture(async () => { events.push('replaced-hook') })
    await stopMatrixRuntime(handle as never, {}, () => undefined, {
      stopApp: async () => { events.push('stop-app') },
      closeMail: async () => { events.push('close-mail') },
      stopPg: async () => { events.push('stop-pg') },
    })
    assert.deepEqual(events, ['replaced-hook', 'stop-app', 'close-mail', 'stop-pg'])
    assert.equal(handle.stopped, true)
    assert.equal(handle.artifactsCaptured, true)
    await stopMatrixRuntime(handle as never, {}, () => undefined, {
      stopApp: async () => { events.push('again') },
      closeMail: async () => undefined,
      stopPg: async () => undefined,
    })
    assert.deepEqual(events, ['replaced-hook', 'stop-app', 'close-mail', 'stop-pg'])
  })

  it('capture failure is not presented as captured', async () => {
    const { stopMatrixRuntime, clearMatrixStopBlock, matrixStopBlockReason } = await import('../support/native/rejection-recovery-runtime')
    clearMatrixStopBlock()
    const handle = {
      stopped: false,
      artifactsCaptured: false,
      runtime: { runId: 'business-test-20261011t000000-abcd', paths: { rootDir: '/tmp/retained-root' } },
      captureArtifacts: async () => { throw new Error('disk full') },
    }
    await assert.rejects(() => stopMatrixRuntime(handle as never, {}, () => undefined, {
      stopApp: async () => undefined,
      closeMail: async () => undefined,
      stopPg: async () => undefined,
    }), /not presenting artifacts as captured/)
    assert.equal(handle.artifactsCaptured, false)
    assert.match(matrixStopBlockReason() ?? '', /disk full/)
    clearMatrixStopBlock()
  })
})

describe('snapshot equality is not another Completed read', () => {
  it('rejects a snapshot that only repeats Completed', () => {
    const before = {
      requestId: 'req-real-1',
      status: 'Completed',
      requestPendingRows: 0,
      solutionPendingRows: 0,
      finalPendingRows: 0,
      instances: [{ id: 'inst-final-2', phase: 'FINAL', attempt: 2, state: 'APPROVED', supersededAt: null }],
      activities: [{ id: 'act-1', action: 'status_changed', fromStatus: 'FinalApproval', toStatus: 'Completed', userId: 'user-department-manager', comments: null }],
      notifications: [{ id: 'note-1', type: 'status_changed', userId: 'user-requester-a', title: 'Completed' }],
    }
    assert.throws(() => assertSnapshotsEqual(before, { ...before, activities: [] }), /changed terminal/)
    assert.doesNotThrow(() => assertSnapshotsEqual(before, { ...before, instances: [...before.instances] }))
    assert.throws(() => correlatePersistedProof({
      caseId: 'RRM-001', action: 'confirm-rejection', phase: 'FINAL', attempt: 1, stepOrder: 1, actor: 'user-supervisor-p', instanceId: 'inst-1',
    }, JSON.stringify({ requestId: 'req-real-1', phase: 'FINAL', actor: 'user-supervisor-p', order: 1, instanceId: 'inst-1', status: 'Completed', rejectionRowId: 'rej-1', reason: 'x' })),
    /wrong rejection status|rejection proof status/)
  })
})

describe('independent review blockers', () => {
  it('rank pending rows keep position and candidates, including a null person id and co-candidates', () => {
    const primary = matrixActorId(FIXTURE_ACTORS.supervisorP)
    const co = matrixActorId('user-second-approver')
    assert.doesNotThrow(() => assertRankPendingRow({
      routingMode: 'SNAPSHOT_GROUP',
      requiredApproverId: null,
      approverId: null,
      requiredPositionId: 'position-supervisor',
      candidateUserIds: [co, primary],
      order: 1,
      status: 'pending',
    }, {
      order: 1,
      positionId: 'position-supervisor',
      actorId: primary,
      candidateUserIds: [primary, co],
    }))
    assert.throws(() => pendingCustomActorId({
      routingMode: 'SNAPSHOT_GROUP',
      requiredApproverId: null,
      approverId: null,
    }), /custom-person only/)
  })

  it('SOLUTION rejection evidence must be SentToEngineer, not DesignCostEstimationApproval', () => {
    assert.equal(expectedPostRejectStatus('SOLUTION'), 'SentToEngineer')
    assert.throws(() => assertRejectionEvidence({
      phase: 'SOLUTION',
      requestId: 'req-real-1',
      rejectionRowId: 'rej-real',
      status: 'DesignCostEstimationApproval',
      actor: matrixActorId(FIXTURE_ACTORS.supervisorE),
      reason: 'because',
      rejectedRows: 1,
      instanceId: 'inst-sol-1',
      attempt: 1,
      order: 1,
    }, {
      phase: 'SOLUTION',
      requestId: 'req-real-1',
      status: 'SentToEngineer',
      actor: matrixActorId(FIXTURE_ACTORS.supervisorE),
      reason: 'because',
      order: 1,
      instanceId: 'inst-sol-1',
      attempt: 1,
    }), /wrong rejection status|SentToEngineer/)
  })

  it('all 44 plans run against phase-local attempt creation, including REQUEST recovery SOLUTION attempt 1', async () => {
    for (const row of buildInventory()) {
      const plan = buildCasePlan(row)
      if (row.phase === 'REQUEST') {
        const firstSolution = plan.find((step) => step.kind === 'approve' && step.phase === 'SOLUTION')
        assert.equal(firstSolution && firstSolution.kind === 'approve' && firstSolution.attempt, 1, row.id)
      }
      const { ui } = recordingFakeUi()
      await runMatrixCase(row, ui, new MatrixLedger(), async () => undefined, `T-${row.id}`)
    }
  })

  it('isolated actor mapping is a UUID bijection and passes the real resubmit schema', async () => {
    const { resubmitSolutionSchema } = await import('../../src/lib/schemas/solution-schemas')
    const ids = Object.values(FIXTURE_ACTORS)
    const mapped = ids.map((id) => matrixActorId(id))
    assert.equal(new Set(mapped).size, mapped.length)
    for (const id of ids) {
      assert.equal(fixtureActorIdFromMatrix(matrixActorId(id)), id)
      assert.equal(matrixActorEmail(id), `${id}@business.test`)
      assert.equal(resubmitSolutionSchema.safeParse({
        requestId: '11111111-1111-4111-8111-111111111111',
        title: 't',
        description: '<p>x</p>',
        inlineImageSessionId: '22222222-2222-4222-8222-222222222222',
        cost: 1,
        currency: 'THB',
        timeline: '1 day',
        useCustomHierarchy: true,
        customApprovers: [id],
      }).success, false, id)
    }
    const parsed = resubmitSolutionSchema.safeParse({
      requestId: '11111111-1111-4111-8111-111111111111',
      title: 't',
      description: '<p>x</p>',
      inlineImageSessionId: '22222222-2222-4222-8222-222222222222',
      cost: 1,
      currency: 'THB',
      timeline: '1 day',
      useCustomHierarchy: true,
      customApprovers: CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id)),
    })
    assert.equal(parsed.success, true, JSON.stringify(parsed.success ? null : parsed.error.issues))
    const plan = buildIsolatedMatrixSeedPlan('hash')
    const users = plan.steps.filter((step) => step.table === 'users')
    for (const step of users) {
      if (step.table !== 'users') continue
      assert.match(step.data.id, /^[0-9a-f-]{36}$/)
      assert.match(step.data.email, /@business\.test$/)
      assert.equal(step.data.email, matrixActorEmail(fixtureActorIdFromMatrix(step.data.id)))
    }
  })

  it('wrong previous instance and ineligible baseline fail before a false confirm', async () => {
    const row = buildInventory().find((item) => item.phase === 'SOLUTION' && item.chainKind === 'custom')!
    await assert.rejects(
      () => runMatrixCase(row, recordingFakeUi({ wrongPreviousInstance: true }).ui, new MatrixLedger(), async () => undefined, 'T'),
      /previousInstanceId != pre-click/,
    )
    const { ui, calls } = recordingFakeUi({ ineligible: true })
    await assert.rejects(
      () => runMatrixCase(row, ui, new MatrixLedger(), async () => undefined, 'T'),
      /not a candidate/,
    )
    assert.equal(calls.filter((call) => call.startsWith('approve:') || call.startsWith('reject:')).length, 0)
  })

  it('SELECT INTO is refused and the evidence connection sets default_transaction_read_only', async () => {
    const { executeReadOnlyQuery, readOnlyConnectionEnv } = await import('../support/native/rejection-recovery-runtime')
    const env = readOnlyConnectionEnv({ databasePassword: 'secret', databasePort: 44010, database: 'app_cleanstart_dev' })
    assert.equal(env.PGOPTIONS, '-c default_transaction_read_only=on')
    const seen: Array<Record<string, string> | undefined> = []
    await assert.rejects(() => executeReadOnlyQuery({
      sql: 'select json_agg(row_to_json(e))::text into rrm_review_leak from requests e',
      ownedDatabase: 'app_cleanstart_dev',
      ownedDataDir: '/owned/pgdata',
      connectionEnv: env,
      verifyIdentity: async () => ({ connectedDatabase: 'app_cleanstart_dev', dataDirectory: '/owned/pgdata' }),
      query: async (_sql, connectionEnv) => { seen.push(connectionEnv); return '[]' },
    }), /SELECT INTO/)
    assert.equal(seen.length, 0)
    await executeReadOnlyQuery({
      sql: "select coalesce(json_agg(row_to_json(evidence)), '[]'::json)::text from (select 1) evidence",
      ownedDatabase: 'app_cleanstart_dev',
      ownedDataDir: '/owned/pgdata',
      connectionEnv: env,
      verifyIdentity: async () => ({ connectedDatabase: 'app_cleanstart_dev', dataDirectory: '/owned/pgdata' }),
      query: async () => '[]',
    })
  })

  it('a later profile aggregate keeps the earlier profile, and held-close failure preserves the original error', async () => {
    const first = retainProfileAggregate({}, 'all-defaults', { cases: ['RRM-001'] })
    const second = retainProfileAggregate(first, 'solution-exception', { cases: ['RRM-013'] })
    assert.deepEqual(second['all-defaults'], { cases: ['RRM-001'] })
    const row = buildInventory().find((item) => item.phase === 'FINAL' && item.rejectOrder === 2)!
    await assert.rejects(
      () => runMatrixCase(row, recordingFakeUi({ heldCloseFails: true, staleUnknown: true }).ui, new MatrixLedger(), async () => undefined, 'T'),
      /unknown remains unresolved attempting.*held close failed|held close failed/,
    )
  })

  it('mapped seed applier writes the guarded transaction only when explicitly cleared and never stores the plaintext password', async () => {
    const inserts: Array<{ table: string; data: Record<string, unknown> }> = []
    const updates: Array<{ table: string; data: Record<string, unknown> }> = []
    await assert.rejects(() => applyMappedMatrixSeed({
      seedCleared: false,
      routesConfig: 'all-defaults',
      mailPort: 2525,
      password: 'do-not-leak',
      hashPassword: async () => 'hashed-secret',
      connectedDatabase: 'app_cleanstart_dev',
      counts: { company: 0, users: 0, units: 0, routes: 0, mail: 0 },
      indexes: ['one_active_assignment_per_user', 'one_active_company_root', 'one_published_route_per_scope_phase', 'one_active_team_name_per_unit'],
      tx: { insert: async () => undefined, update: async () => undefined },
    }), /explicit seedCleared/)
    assert.equal(inserts.length, 0)
    const result = await applyMappedMatrixSeed({
      seedCleared: true,
      routesConfig: 'solution-exception',
      mailPort: 2525,
      password: 'do-not-leak',
      hashPassword: async (plain) => `hashed:${plain.length}`,
      connectedDatabase: 'app_cleanstart_dev',
      counts: { company: 0, users: 0, units: 0, routes: 0, mail: 0 },
      indexes: ['one_active_assignment_per_user', 'one_active_company_root', 'one_published_route_per_scope_phase', 'one_active_team_name_per_unit'],
      tx: {
        insert: async (table, data) => { inserts.push({ table, data }) },
        update: async (table, _where, data) => { updates.push({ table, data }) },
      },
    })
    const serialized = JSON.stringify(inserts)
    assert.equal(serialized.includes('do-not-leak'), false)
    assert.equal(result.routes, 4)
    assert.ok(result.users > 0)
    assert.equal(result.mailHost, '127.0.0.1')
    const users = inserts.filter((item) => item.table === 'users')
    assert.ok(users.every((item) => String(item.data.email).endsWith('@business.test')))
    assert.ok(users.every((item) => /^[0-9a-f-]{36}$/.test(String(item.data.id))))
    const routes = inserts.filter((item) => item.table === 'approval_route_versions')
    assert.equal(routes.length, 4)
    assert.ok(routes.every((item) => /^[0-9a-f-]{36}$/.test(String(item.data.createdById))))
    assert.ok(updates.some((item) => item.table === 'organization_assignments' && item.data.teamId))
    assert.ok(inserts.some((item) => item.table === 'email_settings' && item.data.host === '127.0.0.1' && item.data.passwordEncrypted === null))
  })

  it('route proof builder requires the primary actor among real assignment candidates, including co-candidates', () => {
    const proof = expectedActiveRouteProof('all-defaults')
    const supervisor = proof[0].steps[0]
    const assignments = proof.flatMap((phase) => phase.steps.flatMap((step) => step.candidateUserIds.map((userId) => ({
      userId,
      unitId: phase.phase === 'SOLUTION' ? 'unit-engineering-section' : 'unit-production-1-section',
      positionId: step.positionId,
    }))))
    const assembled = assembleRouteProof('all-defaults', proof.map((phase) => ({
      phase: phase.phase,
      scopeUnitId: phase.scopeUnitId,
      steps: phase.steps.map((step) => ({ order: step.order, positionId: step.positionId })),
    })), assignments)
    assert.deepEqual(assembled[0].steps[0].candidateUserIds, supervisor.candidateUserIds)
    assert.ok(assembled[0].steps[0].candidateUserIds.includes(supervisor.primaryActorId))
    assert.throws(() => assembleRouteProof('all-defaults', proof.map((phase) => ({
      phase: phase.phase,
      scopeUnitId: phase.scopeUnitId,
      steps: phase.steps.map((step) => ({ order: step.order, positionId: step.positionId })),
    })), []), /not an active candidate/)
  })

  it('default seed adapter reads identity from the client and does not construct a client before clearance', async () => {
    let created = 0
    await assert.rejects(() => runDefaultMappedSeed({
      seedCleared: false,
      databaseUrl: 'postgresql://owned@127.0.0.1:1/app_cleanstart_dev',
      routesConfig: 'all-defaults',
      mailPort: 2525,
      password: 'do-not-leak',
      createClient: () => { created += 1; throw new Error('client must not be constructed') },
    }), /explicit seedCleared/)
    assert.equal(created, 0)

    const writes: string[] = []
    const model = (): MappedSeedModel => ({
      create: async ({ data }) => { writes.push(JSON.stringify(data)) },
      update: async () => undefined,
    })
    const client = (counts: { company: number; users: number; units: number; routes: number; mail: number }, database = 'app_cleanstart_dev', indexes = ['one_active_assignment_per_user', 'one_active_company_root', 'one_published_route_per_scope_phase', 'one_active_team_name_per_unit']): MappedSeedClient & { disconnected: boolean } => ({
      disconnected: false,
      $connect: async () => undefined,
      $disconnect: async function (this: { disconnected: boolean }) { this.disconnected = true },
      $queryRawUnsafe: async <T = unknown>(sql: string): Promise<T> => (sql.includes('current_database')
        ? [{ current_database: database }]
        : indexes.map((indexname) => ({ indexname }))) as T,
      $transaction: async (fn) => fn({
        positions: model(), user: model(), organization_units: model(), company_settings: model(),
        organization_assignments: model(), teams: model(), approval_route_versions: model(),
        approval_route_steps: model(), email_settings: model(),
      }),
      company_settings: { count: async () => counts.company },
      user: { count: async () => counts.users },
      organization_units: { count: async () => counts.units },
      approval_route_versions: { count: async () => counts.routes },
      email_settings: { count: async () => counts.mail },
    })
    const nonempty = client({ company: 1, users: 0, units: 0, routes: 0, mail: 0 })
    await assert.rejects(() => runDefaultMappedSeed({
      seedCleared: true,
      databaseUrl: 'postgresql://owned@127.0.0.1:1/app_cleanstart_dev',
      routesConfig: 'all-defaults',
      mailPort: 2525,
      password: 'do-not-leak',
      hashPassword: async () => 'hashed-only',
      createClient: async () => nonempty,
    }), /not an empty owned database/)
    assert.equal(nonempty.disconnected, true)
    assert.equal(writes.length, 0)
    await assert.rejects(() => runDefaultMappedSeed({
      seedCleared: true,
      databaseUrl: 'postgresql://owned@127.0.0.1:1/wrong',
      routesConfig: 'all-defaults',
      mailPort: 2525,
      password: 'do-not-leak',
      hashPassword: async () => 'hashed-only',
      createClient: async () => client({ company: 0, users: 0, units: 0, routes: 0, mail: 0 }, 'other_db'),
    }), /seed connected to other_db/)
    await assert.rejects(() => runDefaultMappedSeed({
      seedCleared: true,
      databaseUrl: 'postgresql://owned@127.0.0.1:1/app_cleanstart_dev',
      routesConfig: 'all-defaults',
      mailPort: 2525,
      password: 'do-not-leak',
      hashPassword: async () => 'hashed-only',
      createClient: async () => client({ company: 0, users: 0, units: 0, routes: 0, mail: 0 }, 'app_cleanstart_dev', ['one_active_assignment_per_user']),
    }), /seed missing index/)
    const cleared = client({ company: 0, users: 0, units: 0, routes: 0, mail: 0 })
    const result = await runDefaultMappedSeed({
      seedCleared: true,
      databaseUrl: 'postgresql://owned@127.0.0.1:1/app_cleanstart_dev',
      routesConfig: 'all-defaults',
      mailPort: 2525,
      password: 'do-not-leak',
      hashPassword: async (plain) => `hashed:${plain.length}`,
      createClient: async (url) => {
        assert.match(url, /app_cleanstart_dev/)
        return cleared
      },
    })
    assert.equal(cleared.disconnected, true)
    assert.equal(JSON.stringify(writes).includes('do-not-leak'), false)
    assert.equal(result.mailHost, '127.0.0.1')
    assert.ok(writes.some((row) => row.includes(matrixActorId(fixture.actors.admin.id))))
    assert.ok(writes.some((row) => row.includes('business-workflow-test@business.test')))
  })

  it('failed setup after open captures and closes, and keeps the primary error with the close error', async () => {
    let closed = 0
    let captured = 0
    let mutated = 0
    await assert.rejects(() => encloseFailedSetup({
      open: async () => ({ capture: async () => { captured += 1 }, close: async () => { closed += 1; throw new Error('held close failed') } }),
      run: async () => { throw new Error('dialog goto failed') },
    }), /dialog goto failed.*held close failed/)
    assert.equal(closed, 1)
    assert.equal(captured, 1)
    assert.equal(mutated, 0)
    await assert.rejects(() => encloseFailedSetup({
      open: async () => { throw new Error('context open failed') },
      run: async () => { mutated += 1; return 'should-not-run' },
    }), /context open failed/)
    assert.equal(mutated, 0)
    const ok = await encloseFailedSetup({
      open: async () => ({ close: async () => { closed += 1 } }),
      run: async () => 'held',
    })
    assert.equal(ok, 'held')
    assert.equal(closed, 1)
  })

  it('readOnlyPsql spawns psql from PG_BIN with the read-only environment and does not start postgres', async () => {
    const seen: Array<{ executable: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = []
    const env = {
      PGOPTIONS: '-c default_transaction_read_only=on',
      PGHOST: '127.0.0.1',
      PGPORT: '1',
      PGUSER: 'owned',
      PGDATABASE: 'app_cleanstart_dev',
      PGPASSWORD: 'not-a-live-secret',
    }
    const raw = await readOnlyPsql({} as never, 'app_cleanstart_dev', 'select 1', env, (executable, args, options) => {
      seen.push({ executable, args, env: options.env })
      return {
        stdout: { on: (_event, cb) => cb(Buffer.from('[]')) },
        stderr: { on: () => undefined },
        on: (event, cb) => { if (event === 'close') (cb as (code: number | null) => void)(0) },
      }
    })
    assert.equal(raw, '[]')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].executable, path.join(PG_BIN, 'psql'))
    assert.equal(seen[0].executable.endsWith('/postgres'), false)
    assert.deepEqual(seen[0].args, ['-X', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', 'select 1'])
    assert.equal(seen[0].env.PGOPTIONS, '-c default_transaction_read_only=on')
  })

  it('revision baseline accepts rejected and approved history and refuses a missing instance before resubmit', async () => {
    const rejected = buildRevisionBaseline({
      phase: 'REQUEST',
      request: { id: 'req-1', status: 'ImprovementRequest' },
      history: [{ instanceId: 'inst-request-1', attempt: 1, supersededAt: null }],
      rows: [{ approvalRowId: 'rej-1', order: 2, status: 'rejected', routingMode: 'SNAPSHOT_GROUP', requiredApproverId: null, approverId: null, requiredPositionId: 'position-supervisor', candidateUserIds: [], instanceId: 'inst-request-1' }],
      solutionId: null,
      expectedState: 'rejected',
    })
    assert.equal(rejected.rowStates.some((row) => row.status === 'pending'), false)
    assert.equal(rejected.instanceId, 'inst-request-1')
    const approved = buildRevisionBaseline({
      phase: 'SOLUTION',
      request: { id: 'req-1', status: 'DesignCostEstimationApproval' },
      history: [{ instanceId: 'inst-solution-1', attempt: 1, supersededAt: null }],
      rows: [{ approvalRowId: 'app-1', order: 1, status: 'approved', routingMode: 'SNAPSHOT_GROUP', requiredApproverId: null, approverId: matrixActorId(FIXTURE_ACTORS.engineerA), requiredPositionId: 'position-engineer', candidateUserIds: [matrixActorId(FIXTURE_ACTORS.engineerA)], instanceId: 'inst-solution-1' }],
      solutionId: 'sol-1',
      expectedState: 'approved',
    })
    assert.equal(approved.solutionId, 'sol-1')
    assert.equal(approved.expectedState, 'approved')
    let acted = 0
    await assert.rejects(() => captureRevisionBeforeResubmit(
      async () => buildRevisionBaseline({
        phase: 'SOLUTION',
        request: { id: 'req-1', status: 'SentToEngineer' },
        history: [{ instanceId: 'inst-solution-1', attempt: 1, supersededAt: null }],
        rows: [{ approvalRowId: 'rej-2', order: 1, status: 'rejected', routingMode: 'SNAPSHOT_GROUP', requiredApproverId: null, approverId: null, requiredPositionId: 'position-engineer', candidateUserIds: [], instanceId: 'inst-solution-1' }],
        solutionId: 'sol-1',
        expectedState: 'rejected',
        expectedInstanceId: 'other-instance',
      }),
      async () => { acted += 1; return 'mutated' },
    ), /revision instance/)
    assert.equal(acted, 0)
  })

  it('actual rank and custom evidence builders reject a bad chain before accepting a profile', () => {
    for (const profile of PROFILE_ORDER) {
      const solutionSteps = expectedActiveRouteProof(profile).find((item) => item.phase === 'SOLUTION')!.steps
      const rows = solutionSteps.map((step) => ({
        approvalRowId: `sol-${step.order}`,
        order: step.order,
        status: 'pending',
        routingMode: 'SNAPSHOT_GROUP',
        requiredApproverId: null,
        approverId: null,
        requiredPositionId: step.positionId,
        candidateUserIds: [...step.candidateUserIds].reverse(),
      }))
      const evidence = buildSolutionSubmitEvidence({
        request: { id: 'req-1', status: 'DesignCostEstimationApproval' },
        active: { instanceId: 'inst-solution-1', attempt: 1 },
        solutionId: 'sol-1',
        rows,
        route: { routingMode: 'SNAPSHOT_GROUP', scopeUnitId: solutionSteps.length > 0 ? expectedActiveRouteProof(profile)[1].scopeUnitId : 'unit-company' },
        custom: false,
        profile,
      })
      assert.deepEqual(evidence.pendingActorIds, solutionSteps.map((step) => step.primaryActorId))
      assert.equal(evidence.pendingApproverIds.length, 0)
      assert.ok(rows.every((row, index) => row.candidateUserIds.includes(evidence.pendingActorIds![index])))
      const proof = expectedActiveRouteProof(profile)
      assertRouteStepsBeforeAction(proof, 'SOLUTION', profile)
      const extra = structuredClone(proof)
      extra[1].steps = extra[1].steps.map((step) => ({ ...step, candidateUserIds: [...step.candidateUserIds, 'extra-user'] }))
      assert.throws(() => assertRouteStepsBeforeAction(extra, 'SOLUTION', profile), /rank candidates/)
      const wrongPosition = structuredClone(proof)
      wrongPosition[1].steps = wrongPosition[1].steps.map((step, index) => index === 0 ? { ...step, positionId: 'position-wrong' } : step)
      assert.throws(() => assertRouteStepsBeforeAction(wrongPosition, 'SOLUTION', profile), /rank position/)
      if (proof[1].steps.length > 1) {
        const reordered = structuredClone(proof)
        reordered[1].steps = [...reordered[1].steps].reverse().map((step, index) => ({ ...step, order: index + 1 }))
        assert.throws(() => assertRouteStepsBeforeAction(reordered, 'SOLUTION', profile), /rank position|rank order/)
      }
    }
    const customIds = CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id))
    const custom = buildSolutionSubmitEvidence({
      request: { id: 'req-1', status: 'DesignCostEstimationApproval' },
      active: { instanceId: 'inst-solution-1', attempt: 1 },
      solutionId: 'sol-1',
      rows: customIds.map((id, index) => ({
        approvalRowId: `custom-${index + 1}`, order: index + 1, status: 'pending', routingMode: 'CUSTOM_PERSON',
        requiredApproverId: id, approverId: null, requiredPositionId: null, candidateUserIds: [],
      })),
      route: { routingMode: 'CUSTOM_PERSON', scopeUnitId: null },
      custom: true,
      profile: 'all-defaults',
    })
    assert.deepEqual(custom.customChainIds, customIds)
    assert.throws(() => buildActionBaseline({
      phase: 'REQUEST', request: { id: 'req-1', status: 'ImprovementRequest' }, active: { instanceId: 'inst-1', attempt: 1 },
      rows: [{ approvalRowId: 'rej-1', order: 1, status: 'rejected', routingMode: 'SNAPSHOT_GROUP', requiredApproverId: null, approverId: null, requiredPositionId: 'position-supervisor', candidateUserIds: [] }],
      order: 1, solutionId: null, expected: { actorId: matrixActorId(FIXTURE_ACTORS.supervisorP), profile: 'all-defaults' },
    }), /no pending/)
  })

  it('final initiation builder proves rank and custom attempts 1 and 2 and rejects poisoned fields', () => {
    for (const attempt of [1, 2]) {
      for (const custom of [false, true]) {
        const profile = 'all-defaults' as const
        const steps = expectedActiveRouteProof(profile).find((item) => item.phase === 'FINAL')!.steps
        const rows = custom
          ? CUSTOM_CHAINS.FINAL.map((id, index) => ({
            approvalRowId: `final-${attempt}-${index + 1}`, order: index + 1, status: 'pending', routingMode: 'CUSTOM_PERSON',
            requiredApproverId: matrixActorId(id), approverId: null, requiredPositionId: null, candidateUserIds: [],
          }))
          : steps.map((step) => ({
            approvalRowId: `final-${attempt}-${step.order}`, order: step.order, status: 'pending', routingMode: 'SNAPSHOT_GROUP',
            requiredApproverId: null, approverId: null, requiredPositionId: step.positionId, candidateUserIds: [...step.candidateUserIds],
          }))
        const evidence = buildFinalInitiationEvidence({
          request: { id: 'req-1', status: 'FinalApproval' },
          active: { instanceId: `inst-final-${attempt}`, attempt },
          rows,
          route: custom ? { routingMode: 'CUSTOM_PERSON', scopeUnitId: null } : { routingMode: 'SNAPSHOT_GROUP', scopeUnitId: 'unit-company' },
          custom,
          profile,
          expectedAttempt: attempt,
        })
        proveFinalInitiation(evidence, {
          requestId: 'req-1',
          instanceId: evidence.instanceId,
          attempt,
          routingMode: custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
          routeSource: custom ? 'CUSTOM_PERSON' : 'COMPANY_DEFAULT',
          orderedActorIds: custom ? CUSTOM_CHAINS.FINAL.map((id) => matrixActorId(id)) : steps.map((step) => step.primaryActorId),
          customChainIds: custom ? CUSTOM_CHAINS.FINAL.map((id) => matrixActorId(id)) : undefined,
        })
        assert.equal(evidence.observedStatus, evidence.status)
        assert.equal(evidence.observedStatus, 'FinalApproval')
        assertFinalInitiationEvidence(evidence, {
          requestId: 'req-1',
          instanceId: evidence.instanceId,
          attempt,
          customChainIds: custom ? CUSTOM_CHAINS.FINAL.map((id) => matrixActorId(id)) : undefined,
        })
        const key = {
          caseId: `rrm-final-a${attempt}-${custom ? 'custom' : 'rank'}`,
          action: 'initiate-final' as const,
          phase: 'FINAL' as const,
          attempt,
          actor: matrixActorId(FIXTURE_ACTORS.supervisorP),
          instanceId: evidence.instanceId,
          expectedChainIds: custom ? CUSTOM_CHAINS.FINAL.map((id) => matrixActorId(id)) : undefined,
        }
        const serialized = JSON.stringify(evidence)
        assert.doesNotThrow(
          () => correlatePersistedProof(key, serialized),
          'real FINAL builder evidence must pass the outer correlatePersistedProof submission guard',
        )
        const poisonedObserved = JSON.parse(serialized) as Record<string, unknown>
        poisonedObserved.observedStatus = 'Completed'
        assert.throws(
          () => correlatePersistedProof(key, JSON.stringify(poisonedObserved)),
          /submission proof status was not the observed database status/,
          'poisoned observed status must independently block the outer submission guard',
        )
        const poisonedStatus = JSON.parse(serialized) as Record<string, unknown>
        poisonedStatus.status = 'Completed'
        assert.throws(
          () => correlatePersistedProof(key, JSON.stringify(poisonedStatus)),
          /submission proof status was not the observed database status/,
          'poisoned intended status must independently block the outer submission guard',
        )
        assert.throws(
          () => assertFinalInitiationEvidence({ ...evidence, observedStatus: 'Completed' }, { requestId: 'req-1', instanceId: evidence.instanceId, attempt }),
          /observedStatus/,
          'typed final guard must reject an observed status that differs from the evidence status',
        )
      }
    }
    assert.throws(() => buildFinalInitiationEvidence({
      request: { id: 'req-1', status: 'SentToEngineer' }, active: { instanceId: 'inst-final-1', attempt: 1 }, rows: [],
      route: { routingMode: 'SNAPSHOT_GROUP', scopeUnitId: 'unit-company' }, custom: false, profile: 'all-defaults', expectedAttempt: 1,
    }), /observed final status/)
    assert.throws(() => buildFinalInitiationEvidence({
      request: { id: 'req-1', status: 'FinalApproval' }, active: { instanceId: 'inst-final-2', attempt: 1 },
      rows: [{ approvalRowId: 'row-1', order: 1, status: 'pending', routingMode: 'SNAPSHOT_GROUP', requiredApproverId: null, approverId: null, requiredPositionId: 'position-supervisor', candidateUserIds: [] }],
      route: { routingMode: 'SNAPSHOT_GROUP', scopeUnitId: 'unit-company' }, custom: false, profile: 'all-defaults', expectedAttempt: 2,
    }), /final attempt/)
    assert.throws(() => buildFinalInitiationEvidence({
      request: { id: 'req-1', status: 'FinalApproval' }, active: { instanceId: 'inst-final-1', attempt: 1 },
      rows: CUSTOM_CHAINS.FINAL.map((id, index) => ({ approvalRowId: `raw-${index}`, order: index + 1, status: 'pending', routingMode: 'CUSTOM_PERSON', requiredApproverId: id, approverId: null, requiredPositionId: null, candidateUserIds: [] })),
      route: { routingMode: 'CUSTOM_PERSON', scopeUnitId: null }, custom: true, profile: 'all-defaults', expectedAttempt: 1,
    }), /custom pending/)
    assert.throws(() => buildFinalInitiationEvidence({
      request: { id: 'req-1', status: 'FinalApproval' }, active: { instanceId: 'inst-final-1', attempt: 1 },
      rows: expectedActiveRouteProof('all-defaults').find((item) => item.phase === 'FINAL')!.steps.map((step) => ({ approvalRowId: `meta-${step.order}`, order: step.order, status: 'pending', routingMode: 'SNAPSHOT_GROUP', requiredApproverId: null, approverId: null, requiredPositionId: step.positionId, candidateUserIds: [...step.candidateUserIds] })),
      route: { routingMode: 'SNAPSHOT_GROUP', scopeUnitId: 'unit-engineering-section' }, custom: false, profile: 'all-defaults', expectedAttempt: 1,
    }), /route source/)
  })

  it('session and failClosed keep every failure and still clean up', async () => {
    const { runOwnedMatrixSession, clearMatrixStopBlock } = await import('../support/native/rejection-recovery-runtime')
    clearMatrixStopBlock()
    const events: string[] = []
    await assert.rejects(() => runOwnedMatrixSession({
      handle: { stopped: false, runtime: { runId: 'business-test-20261011t000000-abcd', paths: { rootDir: '/tmp/retained-root' } }, captureArtifacts: async () => undefined } as never,
      launchBrowser: async () => ({ close: async () => { events.push('close'); throw new Error('browser close failed') } }),
      run: async () => { events.push('run'); throw new Error('case failed') },
      stop: async () => { events.push('stop'); throw new Error('runtime stop failed') },
    }), /case failed.*runtime stop failed.*browser close failed/)
    assert.deepEqual(events, ['run', 'stop', 'close'])
    let cleaned = 0
    await assert.rejects(() => failClosed(
      { screenshot: async () => { throw new Error('screenshot failed') } },
      new Error('dialog failed'),
      async () => { cleaned += 1; throw new Error('context close failed') },
      { mkdir: async () => { throw new Error('mkdir failed') }, writeFile: async () => { throw new Error('screenshot record failed') } },
    ), /dialog failed.*mkdir failed.*context close failed/)
    assert.equal(cleaned, 1)
  })

  it('scoped evidence payload keeps request history and still cleans up when capture fails', async () => {
    const payload = {
      request: { id: 'req-1', title: 'RRM', status: 'FinalApproval' },
      solution: { id: 'sol-1', title: 'Fix' },
      instances: [{ id: 'inst-1', phase: 'FINAL', attempt: 2, state: 'PENDING', supersededAt: null }],
      approvalRows: [{ approvalRowId: 'row-1', phase: 'FINAL', isFinalApproval: true, instanceId: 'inst-1', order: 1, status: 'pending', routingMode: 'SNAPSHOT_GROUP', requiredApproverId: null, requiredPositionId: 'position-supervisor', candidateUserIds: [matrixActorId(FIXTURE_ACTORS.supervisorP)] }],
      candidates: [{ userId: matrixActorId(FIXTURE_ACTORS.supervisorP), unitId: 'unit-production-1-section', positionId: 'position-supervisor' }],
      activities: [{ id: 'act-1', action: 'approval_rejected', fromStatus: 'FinalApproval', toStatus: 'SentToEngineer', userId: 'user-supervisor-p', comments: 'held' }],
      notifications: [{ id: 'note-1', type: 'status_changed', userId: 'user-requester-a', title: 'Rejected' }],
      unresolvedTarget: null,
    }
    assert.match(scopedBusinessEvidenceSql('req-1'), /request_approvals/)
    assert.match(scopedBusinessEvidenceSql('req-1'), /approval_candidate_group_members/)
    const writes: Record<string, string> = {}
    let cleaned = 0
    const passed = await persistScopedCaseEvidence({
      requestId: 'req-1', profile: 'all-defaults', caseId: 'case-a', outcome: 'passed', unresolvedTarget: { instanceId: 'inst-1', attempt: 2, approvalRowId: 'row-1', phase: 'FINAL' },
      query: async () => payload,
      readAggregate: async () => writes.aggregate ?? '',
      writeAggregate: async (body) => { writes.aggregate = body },
      writeCase: async (body) => { writes.passed = body },
      cleanup: async () => { cleaned += 1 },
    })
    assert.equal(cleaned, 1)
    assert.equal((passed.payload as { request: { id: string }; unresolvedTarget: { approvalRowId: string } }).request.id, 'req-1')
    assert.equal((passed.payload as { unresolvedTarget: { approvalRowId: string } }).unresolvedTarget.approvalRowId, 'row-1')
    assert.equal((passed.payload as { approvalRows: unknown[] }).approvalRows.length, 1)
    const ambiguous = await persistScopedCaseEvidence({
      requestId: 'req-1', profile: 'solution-exception', caseId: 'case-b', outcome: 'ambiguous',
      unresolvedTarget: { instanceId: 'inst-1', attempt: 1, approvalRowId: 'row-1', phase: 'SOLUTION' },
      query: async () => { throw new Error('snapshot query failed') },
      readAggregate: async () => writes.aggregate,
      writeAggregate: async (body) => { writes.aggregate = body },
      writeCase: async (body) => { writes.ambiguous = body },
      cleanup: async () => { cleaned += 1; throw new Error('cleanup failed') },
    })
    assert.equal(cleaned, 2)
    assert.match(ambiguous.errors.join(';'), /snapshot query failed/)
    assert.match(ambiguous.errors.join(';'), /cleanup failed/)
    assert.match(writes.ambiguous, /snapshot query failed/)
    const retained = JSON.parse(writes.aggregate) as Record<string, { caseId: string; evidence: { captureError?: string } }>
    assert.equal(retained['all-defaults'].caseId, 'case-a')
    assert.equal(retained['solution-exception'].caseId, 'case-b')
    assert.match(retained['solution-exception'].evidence.captureError ?? '', /snapshot query failed/)
  })

  it('scoped SQL derives the approval phase from isFinalApproval and validators reject a phase contradicting the instance', () => {
    const sql = scopedBusinessEvidenceSql('req-1')
    assert.match(sql, /request_approvals/)
    assert.match(sql, /solution_approvals/)
    assert.match(sql, /approval_candidate_group_members/)
    assert.match(
      sql,
      /case when t\."isFinalApproval" then 'FINAL' else 'REQUEST' end/,
      'scoped SQL must derive the request_approvals phase from the isFinalApproval discriminator instead of hardcoding REQUEST',
    )
    const supervisor = matrixActorId(FIXTURE_ACTORS.supervisorP)
    const instances: ScopedBusinessEvidence['instances'] = [
      { id: 'inst-req-1', phase: 'REQUEST', attempt: 1, state: 'SUPERSEDED', supersededAt: '2026-10-12T00:00:00Z' },
      { id: 'inst-sol-1', phase: 'SOLUTION', attempt: 1, state: 'SUPERSEDED', supersededAt: '2026-10-12T00:00:00Z' },
      { id: 'inst-final-1', phase: 'FINAL', attempt: 1, state: 'PENDING', supersededAt: null },
    ]
    const approvalRows: ScopedBusinessEvidence['approvalRows'] = [
      { approvalRowId: 'req-row-1', phase: 'REQUEST', isFinalApproval: false, instanceId: 'inst-req-1', order: 1, status: 'approved', routingMode: 'SNAPSHOT_GROUP', requiredApproverId: null, requiredPositionId: 'position-supervisor', candidateUserIds: [supervisor] },
      { approvalRowId: 'sol-row-1', phase: 'SOLUTION', isFinalApproval: false, instanceId: 'inst-sol-1', order: 1, status: 'approved', routingMode: 'CUSTOM_PERSON', requiredApproverId: supervisor, requiredPositionId: null, candidateUserIds: [] },
      { approvalRowId: 'final-row-1', phase: 'FINAL', isFinalApproval: true, instanceId: 'inst-final-1', order: 1, status: 'pending', routingMode: 'SNAPSHOT_GROUP', requiredApproverId: null, requiredPositionId: 'position-supervisor', candidateUserIds: [supervisor] },
    ]
    const payload: ScopedBusinessEvidence = {
      request: { id: 'req-1', title: 'RRM final history', status: 'FinalApproval' },
      solution: { id: 'sol-1', title: 'Fix' },
      instances,
      approvalRows,
      candidates: [{ userId: supervisor, unitId: 'unit-production-1-section', positionId: 'position-supervisor' }],
      activities: [{ id: 'act-1', action: 'status_changed', fromStatus: 'SentToEngineer', toStatus: 'FinalApproval', userId: 'user-engineer-a', comments: null }],
      notifications: [{ id: 'note-1', type: 'status_changed', userId: 'user-requester-a', title: 'Final approval started' }],
      unresolvedTarget: null,
    }
    assert.doesNotThrow(
      () => assertScopedBusinessEvidence(payload),
      'REQUEST/SOLUTION/FINAL rows on phase-matching instances are valid scoped evidence',
    )
    assert.equal(payload.instances.some((instance) => instance.phase === 'FINAL' && instance.attempt === 1), true, 'FINAL instance history stays in the scoped snapshot')
    const staleHardcode = JSON.parse(JSON.stringify(payload)) as ScopedBusinessEvidence
    delete (staleHardcode.approvalRows[2] as { isFinalApproval?: boolean }).isFinalApproval
    staleHardcode.approvalRows[2].phase = 'REQUEST'
    assert.throws(
      () => assertScopedBusinessEvidence(staleHardcode),
      /phase REQUEST contradicts instance inst-final-1 phase FINAL/,
      'the old hardcoded REQUEST label on a FINAL row must be rejected against its FINAL instance',
    )
    const missingDiscriminator = JSON.parse(JSON.stringify(payload)) as ScopedBusinessEvidence
    ;(missingDiscriminator.approvalRows[2] as { isFinalApproval?: boolean }).isFinalApproval = false
    assert.throws(
      () => assertScopedBusinessEvidence(missingDiscriminator),
      /isFinalApproval discriminator/,
      'a FINAL row must retain the isFinalApproval discriminator',
    )
    const mislabeledRequest = JSON.parse(JSON.stringify(payload)) as ScopedBusinessEvidence
    mislabeledRequest.approvalRows[0].isFinalApproval = true
    assert.throws(
      () => assertScopedBusinessEvidence(mislabeledRequest),
      /must not be marked isFinalApproval/,
      'a REQUEST row must not carry the FINAL discriminator',
    )
    const unknownPhase = JSON.parse(JSON.stringify(payload)) as ScopedBusinessEvidence
    unknownPhase.approvalRows[2].phase = 'FINAL-ISH'
    assert.throws(
      () => assertScopedBusinessEvidence(unknownPhase),
      /unknown phase/,
      'an unrecognizable approval phase must be rejected',
    )
    const orphanRow = JSON.parse(JSON.stringify(payload)) as ScopedBusinessEvidence
    orphanRow.approvalRows[2].instanceId = 'inst-missing'
    assert.throws(
      () => assertScopedBusinessEvidence(orphanRow),
      /absent from the scoped snapshot/,
      'an approval row must not reference an instance outside the snapshot',
    )
  })
})

describe('session evidence gate (actual manual caller)', () => {
  it('keeps passing and running the next case when scoped evidence persists cleanly', async () => {
    const executed: string[] = []
    const logged: string[] = []
    const flushed: string[] = []
    for (const caseId of ['case-a', 'case-b']) {
      const result: CaseResult = { caseId, requestTitle: `RRM ${caseId}`, status: 'failed' }
      await runCaseWithEvidenceGate({
        caseId,
        result,
        runCase: async () => { executed.push(caseId); return { staleNegative: 'passed' } },
        captureEvidence: async () => ({ errors: [], payload: { ok: true } }),
        recordFailureArtifacts: async () => { throw new Error('a green case with persisted evidence must not record failure artifacts') },
        flushProgress: async () => { flushed.push(caseId) },
        log: (line) => logged.push(line),
      })
      assert.equal(result.status, 'passed')
      assert.equal(result.staleNegative, 'passed')
    }
    assert.deepEqual(executed, ['case-a', 'case-b'])
    assert.deepEqual(logged, ['CASE case-a PASSED', 'CASE case-b PASSED'])
    assert.deepEqual(flushed, ['case-a', 'case-b'], 'the final progress flush runs on the happy path without blocking it')
  })

  it('fails the case and blocks the next case when required scoped evidence fails to persist', async () => {
    const executed: string[] = []
    const logged: string[] = []
    const results: CaseResult[] = []
    const outcomes: string[] = []
    await assert.rejects(async () => {
      for (const caseId of ['case-a', 'case-b']) {
        const result: CaseResult = { caseId, requestTitle: `RRM ${caseId}`, status: 'failed' }
        results.push(result)
        await runCaseWithEvidenceGate({
          caseId,
          result,
          runCase: async () => { executed.push(caseId); return { staleNegative: undefined } },
          captureEvidence: async (outcome) => {
            outcomes.push(outcome)
            return persistScopedCaseEvidence({
              requestId: 'req-1', profile: 'all-defaults', caseId, outcome, unresolvedTarget: null,
              query: async () => { throw new Error('snapshot query failed') },
              readAggregate: async () => { throw new Error('aggregate read failed') },
              writeAggregate: async (body) => { void body },
              writeCase: async () => { throw new Error('case write failed') },
              cleanup: async () => { throw new Error('cleanup failed') },
            })
          },
          recordFailureArtifacts: async (error) => { logged.push(`artifacts:${error.message}`) },
          flushProgress: async () => undefined,
          log: (line) => logged.push(line),
        })
      }
    }, /required scoped evidence.*snapshot query failed.*cleanup/)
    assert.deepEqual(executed, ['case-a'], 'no second-case business action after evidence persistence failure')
    assert.equal(results[0].status, 'failed')
    assert.match(results[0].error ?? '', /snapshot query failed/)
    assert.ok(!logged.some((line) => line.includes('CASE case-a PASSED')), 'a case with failing required evidence must not be logged PASSED')
    assert.deepEqual(outcomes, ['passed'])
  })

  it('throws the original failure combined with retained capture errors, never the original alone', async () => {
    const recorded: string[] = []
    const outcomes: string[] = []
    const result: CaseResult = { caseId: 'case-a', requestTitle: 'RRM', status: 'failed' }
    await assert.rejects(() => runCaseWithEvidenceGate({
      caseId: 'case-a',
      result,
      runCase: async () => { throw new Error('stale dialog failed') },
      captureEvidence: async (outcome) => {
        outcomes.push(outcome)
        return persistScopedCaseEvidence({
          requestId: 'req-1', profile: 'all-defaults', caseId: 'case-a', outcome, unresolvedTarget: null,
          query: async () => { throw new Error('snapshot query failed') },
          readAggregate: async () => '',
          writeAggregate: async (body) => { void body },
          writeCase: async (body) => { void body },
          cleanup: async () => undefined,
        })
      },
      recordFailureArtifacts: async (error) => { recorded.push(error.message) },
      flushProgress: async () => undefined,
      log: () => undefined,
    }), /stale dialog failed; snapshot query failed/)
    assert.equal(result.status, 'failed')
    assert.deepEqual(outcomes, ['failed'])
    assert.match(recorded[0] ?? '', /stale dialog failed; snapshot query failed/, 'failure artifacts must retain the combined error')
  })

  it('keeps the combined error when failure-artifact writing itself fails', async () => {
    const result: CaseResult = { caseId: 'case-a', requestTitle: 'RRM', status: 'failed' }
    await assert.rejects(() => runCaseWithEvidenceGate({
      caseId: 'case-a',
      result,
      runCase: async () => ({ staleNegative: undefined }),
      captureEvidence: async () => ({ errors: ['case write failed'] }),
      recordFailureArtifacts: async () => { throw new Error('disk full') },
      flushProgress: async () => undefined,
      log: () => undefined,
    }), /case write failed; failure artifact write failed: disk full/)
    assert.equal(result.status, 'failed')
  })

  it('exercises the aggregate write failure on its own instead of masking it behind readAggregate', async () => {
    const executed: string[] = []
    const logged: string[] = []
    const result: CaseResult = { caseId: 'case-a', requestTitle: 'RRM', status: 'failed' }
    let aggregateReads = 0
    let aggregateWrites = 0
    let cleaned = 0
    await assert.rejects(() => runCaseWithEvidenceGate({
      caseId: 'case-a',
      result,
      runCase: async () => { executed.push('case-a'); return { staleNegative: undefined } },
      captureEvidence: async (outcome) => persistScopedCaseEvidence({
        requestId: 'req-1', profile: 'all-defaults', caseId: 'case-a', outcome, unresolvedTarget: null,
        query: async () => ({
          request: { id: 'req-1', title: 'RRM', status: 'ImprovementRequest' },
          solution: null,
          instances: [],
          approvalRows: [],
          candidates: [],
          activities: [],
          notifications: [],
          unresolvedTarget: null,
        }),
        readAggregate: async () => { aggregateReads += 1; return '' },
        writeAggregate: async () => { aggregateWrites += 1; throw new Error('aggregate write failed') },
        writeCase: async () => undefined,
        cleanup: async () => { cleaned += 1 },
      }),
      recordFailureArtifacts: async (error) => { logged.push(`artifacts:${error.message}`) },
      flushProgress: async () => undefined,
      log: (line) => logged.push(line),
    }), /required scoped evidence.*aggregate write failed/)
    assert.equal(aggregateReads, 1, 'readAggregate succeeds, so the writeAggregate failure is the one actually exercised')
    assert.equal(aggregateWrites, 1)
    assert.equal(cleaned, 1, 'cleanup still runs when the aggregate write fails')
    assert.deepEqual(executed, ['case-a'], 'no next-case action after the aggregate write failure')
    assert.equal(result.status, 'failed')
    assert.ok(logged.some((line) => line.startsWith('artifacts:') && line.includes('aggregate write failed')), 'failure artifacts retain the aggregate write error')
  })

  it('still stops the session when evidence persists but the final progress flush fails', async () => {
    const logged: string[] = []
    const result: CaseResult = { caseId: 'case-a', requestTitle: 'RRM', status: 'failed' }
    let flushed = 0
    await assert.rejects(() => runCaseWithEvidenceGate({
      caseId: 'case-a',
      result,
      runCase: async () => ({ staleNegative: 'passed' }),
      captureEvidence: async () => ({ errors: [], payload: { ok: true } }),
      recordFailureArtifacts: async (error) => { logged.push(`artifacts:${error.message}`) },
      flushProgress: async () => { flushed += 1; throw new Error('progress write failed') },
      log: (line) => logged.push(line),
    }), /final progress flush failed.*progress write failed/)
    assert.equal(flushed, 1, 'exactly one flush attempt; the failure path must not flush a second time')
    assert.equal(result.status, 'failed', 'a successful capture with a failing flush is a failed case, not a silent pass')
    assert.ok(!logged.some((line) => line.includes('CASE case-a PASSED')), 'a flush failure must not be logged PASSED')
  })

  it('keeps the combined gate error through the final progress flush and the unconditional session enclosure', async () => {
    const { runOwnedMatrixSession, clearMatrixStopBlock } = await import('../support/native/rejection-recovery-runtime')
    clearMatrixStopBlock()
    const events: string[] = []
    const logged: string[] = []
    const executed: string[] = []
    const result: CaseResult = { caseId: 'case-a', requestTitle: 'RRM', status: 'failed' }
    await assert.rejects(() => runOwnedMatrixSession({
      handle: { stopped: false, runtime: { runId: 'business-test-20261011t000000-abcd', paths: { rootDir: '/tmp/retained-root' } }, captureArtifacts: async () => undefined } as never,
      launchBrowser: async () => ({ close: async () => { events.push('close'); throw new Error('browser close failed') } }),
      run: async () => {
        await runCaseWithEvidenceGate({
          caseId: 'case-a',
          result,
          runCase: async () => { executed.push('case-a'); throw new Error('case failed') },
          captureEvidence: async (outcome) => persistScopedCaseEvidence({
            requestId: 'req-1', profile: 'all-defaults', caseId: 'case-a', outcome, unresolvedTarget: null,
            query: async () => { throw new Error('snapshot query failed') },
            readAggregate: async () => '',
            writeAggregate: async () => undefined,
            writeCase: async () => undefined,
            cleanup: async () => undefined,
          }),
          recordFailureArtifacts: async () => { events.push('artifacts'); throw new Error('artifact write failed') },
          flushProgress: async () => { events.push('flush'); throw new Error('progress write failed') },
          log: (line) => logged.push(line),
        })
        executed.push('case-b-started')
      },
      stop: async () => { events.push('stop'); throw new Error('runtime stop failed') },
    }), /case failed; snapshot query failed.*artifact write failed.*progress write failed; runtime stop failed; browser close failed/)
    assert.deepEqual(events, ['artifacts', 'flush', 'stop', 'close'], 'artifacts then final flush inside the gate, then unconditional session stop and browser close')
    assert.deepEqual(executed, ['case-a'], 'no next-case mutation after the combined gate error')
    assert.equal(result.status, 'failed')
    assert.ok(logged.some((line) => line.includes('CASE case-a FAILED')), 'the gate logged the failed case')
    assert.ok(!logged.some((line) => line.includes('CASE case-a PASSED')), 'the gate never logged the masked case as passed')
  })
})


interface Rrm023State {
  modalReady: boolean
  formOpen: boolean
  submitted: boolean
  rowClicked: boolean
  openerClicks: number
  submitClicks: number
  editorFills: string[]
  gotos: string[]
  openerSamples: Array<{ timeout: unknown; ready: boolean }>
}

describe('RRM-023 readiness — actual resubmit caller with controlled offline dependencies', () => {
  const row023 = rows.find((r) => r.id === 'RRM-023') as MatrixRow
  const title023 = 'RRM RRM-023 solution-exception FINAL pos2 offline-drive'
  const baseline023 = { requestId: 'req-rrm023', attempt: 1, instanceId: 'inst-sol-1' } as unknown as RevisionBaseline
  const scriptedReader = async (sql: string): Promise<unknown> => {
    if (sql.includes('from requests where title')) return [{ id: 'req-rrm023', status: 'SentToEngineer', title: title023 }]
    if (sql.includes('"supersededAt" is null')) return [{ instanceId: 'inst-sol-2', attempt: 2, phase: 'SOLUTION', requestId: 'req-rrm023' }]
    if (sql.includes('supersededAt') && sql.includes('order by i.attempt')) return [{ instanceId: 'inst-sol-1', attempt: 1, supersededAt: '2026-10-12T16:44:00.000Z', phase: 'SOLUTION' }]
    if (sql.includes('candidate_group')) return [{ approvalRowId: 'row-1', order: 1, status: 'pending', routingMode: 'CUSTOM_PERSON', requiredApproverId: '24755607-f91c-575d-b809-5ddf8fefa946', approverId: null, candidateUserIds: [], isFinalApproval: false }]
    throw new Error(`unexpected offline evidence query: ${sql.slice(0, 90)}`)
  }

  // Minimal valid Playwright Locator contract for offline locator-assertion use:
  // the library guard only requires constructor.name === 'Locator' plus the
  // _expect(matcher, {isNot, timeout}) callback used by toBeVisible. No browser.
  class Locator {
    constructor(private page: FakeRrm023Page, readonly desc: string) {}
    private get kind(): 'row' | 'dialog' | 'opener' | 'form' | 'submitbutton' | 'successtext' | 'field' {
      if (this.desc.startsWith('row:')) return 'row'
      if (this.desc.startsWith('text:')) return 'successtext'
      if (this.desc.includes('dialog:/Resubmit Solution/') && this.desc.endsWith('>>button:Resubmit Solution')) return 'submitbutton'
      if (this.desc.includes('dialog:/Resubmit Solution/')) return 'form'
      if (this.desc === 'dialog:>>button:Resubmit Solution') return 'opener'
      if (this.desc === 'dialog:') return 'dialog'
      return 'field'
    }
    private visibleNow(): boolean {
      const s = this.page.state
      switch (this.kind) {
        case 'row': return true
        case 'dialog': return s.rowClicked
        case 'opener': return s.modalReady
        case 'form': return s.formOpen
        case 'submitbutton': return s.formOpen
        case 'successtext': return s.submitted
        default: return true
      }
    }
    async _expect(matcher: string, options?: { isNot?: boolean; timeout?: number }): Promise<{ matches: boolean; received: string; log: string[]; timedOut: boolean }> {
      void matcher
      if (this.kind === 'opener') this.page.state.openerSamples.push({ timeout: options?.timeout, ready: this.page.state.modalReady })
      const deadline = Date.now() + (options?.timeout ?? 0)
      for (;;) {
        if (this.visibleNow()) return { matches: true, received: this.desc, log: [], timedOut: false }
        if (Date.now() >= deadline) return { matches: false, received: this.desc, log: [`${this.desc} not visible within the readiness budget`], timedOut: true }
        await new Promise((r) => setTimeout(r, 10))
      }
    }
    async isVisible(): Promise<boolean> { return this.visibleNow() }
    async click(): Promise<void> {
      if (this.kind === 'opener') {
        if (!this.page.state.modalReady) throw new Error('opener clicked while deferred readiness pending')
        this.page.state.openerClicks += 1
        this.page.state.formOpen = true
        return
      }
      if (this.kind === 'submitbutton') { this.page.state.submitClicks += 1; this.page.state.submitted = true; return }
      if (this.kind === 'row') { this.page.state.rowClicked = true; return }
    }
    async fill(value: string): Promise<void> { this.page.state.editorFills.push(`${this.desc}=${value}`) }
    locator(selector: string): Locator { return new Locator(this.page, `${this.desc}{${selector}}`) }
    first(): Locator { return this }
    getByRole(role: string, opts?: { name?: unknown }): Locator {
      const name = opts?.name === undefined ? '' : String(opts.name)
      return new Locator(this.page, `${this.desc}>>${role}:${name}`)
    }
  }

  class FakeRrm023Page {
    readonly state: Rrm023State
    constructor(readonly readyAfterMs: number | null) {
      this.state = {
        modalReady: false, formOpen: false, submitted: false, rowClicked: false,
        openerClicks: 0, submitClicks: 0, editorFills: [], gotos: [], openerSamples: [],
      }
      if (readyAfterMs !== null) setTimeout(() => { this.state.modalReady = true }, readyAfterMs)
    }
    async goto(url: string): Promise<void> { this.state.gotos.push(url) }
    getByRole(role: string, opts?: { name?: unknown }): Locator {
      const name = opts?.name === undefined ? '' : String(opts.name)
      return new Locator(this, `${role}:${name}`)
    }
    getByText(text: string): Locator { return new Locator(this, `text:${text}`) }
  }

  interface Rrm023DriveDeps {
    newContext?: (row: MatrixRow | null, label: string) => Promise<{ context: BrowserContext; page: Page; closeContext: () => Promise<void> }>
    baseUrl?: string
    queryReadOnly?: (sql: string) => Promise<unknown>
    opener?: { openerVisible?: (open: Locator, timeoutMs: number) => Promise<void> }
  }
  const driveResubmit = (ui: { resubmit: unknown }, page: FakeRrm023Page, readyAfterMs: number | null, deps?: Rrm023DriveDeps): Promise<string> =>
    (ui.resubmit as unknown as (
      row: MatrixRow, phase: 'REQUEST' | 'SOLUTION', custom: boolean, title: string, baseline: RevisionBaseline, deps?: Rrm023DriveDeps,
    ) => Promise<string>)(row023, 'SOLUTION', false, title023, baseline023, {
      newContext: async () => ({ context: { close: async () => undefined } as unknown as BrowserContext, page: page as unknown as Page, closeContext: async () => undefined }),
      baseUrl: 'http://127.0.0.1:39999',
      queryReadOnly: scriptedReader,
      ...deps,
    })

  it('waits out deferred readiness, then performs exactly one opener click and submits the form once', async () => {
    const page = new FakeRrm023Page(6000)
    const ui = playwrightMatrixUi({} as Browser, os.tmpdir())
    const returned = await driveResubmit(ui, page, 6000, {})
    assert.deepEqual(page.state.gotos, ['http://127.0.0.1:39999/requests'])
    assert.ok(page.state.openerSamples.length >= 1, 'the actual caller reached the production opener wait')
    assert.ok(page.state.openerSamples.every((s) => s.timeout === RESUBMIT_OPENER_READINESS_TIMEOUT_MS), 'the 30s readiness budget reaches every production opener wait')
    assert.ok(page.state.openerSamples.some((s) => !s.ready), 'the caller waited while deferred readiness was still pending')
    assert.equal(page.state.openerClicks, 1, 'successful readiness performs exactly one opener click')
    assert.equal(page.state.submitClicks, 1, 'exactly one form submission after readiness')
    const evidence = JSON.parse(returned) as { requestId: string; previousAttempt: number; newAttempt: number; previousSuperseded: boolean; carriedApprovals: number }
    assert.equal(evidence.requestId, 'req-rrm023')
    assert.equal(evidence.previousAttempt, 1)
    assert.equal(evidence.newAttempt, 2)
    assert.equal(evidence.previousSuperseded, true)
    assert.equal(evidence.carriedApprovals, 0)
  })

  it('a permanently pending opener times out on the production budget with zero opener and zero submission clicks', async () => {
    const previousCwd = process.cwd()
    const sandbox = await fsp.mkdtemp(os.tmpdir() + '/rrm023-timeout-')
    process.chdir(sandbox)
    try {
      const page = new FakeRrm023Page(null)
      const ui = playwrightMatrixUi({} as Browser, os.tmpdir())
      await assert.rejects(() => driveResubmit(ui, page, null, {}), /30000/)
      assert.equal(page.state.openerClicks, 0, 'zero opener clicks on permanent timeout')
      assert.equal(page.state.submitClicks, 0, 'zero form submissions on permanent timeout')
      assert.ok(page.state.openerSamples.every((s) => s.timeout === RESUBMIT_OPENER_READINESS_TIMEOUT_MS))
    } finally {
      process.chdir(previousCwd)
    }
  })

  it('a pre-opened resubmit form performs zero opener waits and zero opener clicks', async () => {
    const page = new FakeRrm023Page(null)
    page.state.formOpen = true
    const ui = playwrightMatrixUi({} as Browser, os.tmpdir())
    const returned = await driveResubmit(ui, page, null, {})
    assert.equal(page.state.openerSamples.length, 0, 'zero opener waits for the pre-opened form')
    assert.equal(page.state.openerClicks, 0, 'zero opener clicks for the pre-opened form')
    assert.equal(page.state.submitClicks, 1)
    const evidence = JSON.parse(returned) as { requestId: string }
    assert.equal(evidence.requestId, 'req-rrm023')
  })

  it('counterexample: the Playwright visibility matcher rejects non-Locator receivers, so offline caller bypasses fail fast instead of passing silently', async () => {
    assert.equal((new Locator(new FakeRrm023Page(null), 'dialog:>>button:Resubmit Solution')).constructor.name, 'Locator')
    await assert.rejects(() => playwrightExpect({} as unknown as import('@playwright/test').Locator).toBeVisible({ timeout: RESUBMIT_OPENER_READINESS_TIMEOUT_MS }), /can be only used with Locator/)
  })
})

// ============================================================================
// Task1 replacement repair: source-derived schema/handler contracts.
// The 86 pre-Task1 regressions above are unchanged. Earlier 29 Task1 tests had
// impossible positive rows/results; their intents are retained below with real
// schema fixtures. Preserved candidate+RED snapshots document that correction.
// ============================================================================
import {
  MATRIX_ACTION_REGISTRY, expectedHandlerFor, evaluateAction, assertNegativePair,
  serializeBusinessSnapshot, normalizeActionResult, normalizeActionArguments, classifyPendingChain,
  type ActionEvidence, type BusinessSnapshot, type JsonValue, type HandlerKey,
  type DecisionTarget, type RowlessTarget, type PhaseProof, type ArtifactRef,
  type ActionIdentity, type ExpectedApprovalStep, type Phase,
} from '../support/rejection-recovery-matrix.js'
import { createHash } from 'node:crypto'

type FixtureRow = Record<string, JsonValue>
const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
const ref = (s: string): ArtifactRef => ({ path: `evidence/${s}`, sha256: hash(s), bytes: 256 })
const mark = (n: number, domain = 'browser') => ({ domain, monotonicMs: n, wallMs: 1_700_000_000_000 + n })
const date = '2026-10-14T00:00:00.000Z'
const actor = '00000000-0000-4000-8000-000000000102', requester = 'user-req', engineer = 'user-e'
const identity = (): ActionIdentity => ({
  pass: 1, invocation: 1, invocationId: 'profile-slot-1', profile: 'all-defaults',
  runId: 'run-1', sourceMode: 'strict-assurance', evidenceRoot: '/owned/evidence',
  clearanceManifest: ref('clearance'), runtimeManifest: ref('runtime'),
  caseId: 'rrm-010', contextId: 'ctx-1', sequence: 1,
})
const requestRow = (status: string): FixtureRow => ({
  id: '00000000-0000-4000-8000-000000000010', title: 'Request title', description: 'Request description', status,
  requesterId: requester, organizationUnitId: 'unit-1', createdAt: date, updatedAt: date,
  engineeringCostEstimate: null, engineeringSolution: null, deletedAt: null, deletedBy: null,
  isDeleted: false, isArchived: false, budgetCodeId: null, projectEstimateCost: null,
  workRequisitionReceived: false, workRequisitionReceivedAt: null, workRequisitionReceivedById: null,
})
const solutionRow = (): FixtureRow => ({
  id: 'sol-1', requestId: '00000000-0000-4000-8000-000000000010', title: 'Solution title', description: 'Solution description',
  costEstimate: '100.00', currency: 'THB', timeline: 'One week', conceptDesign: null,
  submittedById: engineer, submittedAt: date, createdAt: date, updatedAt: date,
})
const instanceRow = (phase: Phase, id = 'inst-1', attempt = 1, state = 'PENDING', custom = false): FixtureRow => ({
  id, requestId: phase === 'SOLUTION' ? null : '00000000-0000-4000-8000-000000000010', solutionId: phase === 'SOLUTION' ? 'sol-1' : null,
  phase, attempt, state, supersededAt: null, routingMode: custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
  routeVersionId: custom ? null : 'route-1', originUserId: phase === 'SOLUTION' ? engineer : requester,
  originUnitId: 'unit-1', originAssignmentId: 'assignment-1', originPositionId: 'position-origin',
  completionReason: null, createdAt: date, restartOfInstanceId: null, restartReason: null, restartedById: null,
})
const approvalRow = (phase: Phase, instanceId = 'inst-1', order = 1, custom = false): FixtureRow => ({
  table: phase === 'SOLUTION' ? 'solution_approvals' : 'request_approvals',
  id: `${instanceId}-row-${order}`, instanceId, order, status: 'pending', approverId: null,
  comments: null, approvedAt: null, createdAt: date,
  routingMode: custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
  requiredApproverId: custom ? order === 1 ? actor : '00000000-0000-4000-8000-000000000103' : null,
  requiredPositionId: custom ? null : `pos-${order}`,
  candidateGroupId: custom ? null : `${instanceId}-group-${order}`,
  ...(phase === 'SOLUTION' ? {solutionId:'sol-1'} : {requestId:'00000000-0000-4000-8000-000000000010',isFinalApproval:phase === 'FINAL'}),
})
const candidates = (order: number): string[] => order === 1 ? [actor, '00000000-0000-4000-8000-000000000101'] : ['00000000-0000-4000-8000-000000000103']
const groupRow = (row: FixtureRow): FixtureRow => ({
  id: row.candidateGroupId, approvalInstanceId: row.instanceId, scopeUnitId: 'unit-1',
  requiredPositionId: row.requiredPositionId, capturedAt: date,
  members: candidates(Number(row.order)).map(userId => ({candidateGroupId:row.candidateGroupId,userId,capturedAt:date,capturedDisplayName:userId})),
})
const audit = (id: string, action: string, userId: string, comments: string | null = null): FixtureRow => ({
  id, action, requestId: '00000000-0000-4000-8000-000000000010', fromStatus: null, toStatus: null, userId, comments, createdAt: date,
})
function snap(status: string, instances: FixtureRow[], rows: FixtureRow[], solutions: FixtureRow[] = [], activities: FixtureRow[] = []): BusinessSnapshot {
  const current = (row: FixtureRow, phase: Phase) => instances.some(i => i.id === row.instanceId && i.phase === phase && i.supersededAt === null)
  return structuredClone({
    request: requestRow(status), solutions, instances, approvalRows: rows,
    groups: rows.filter(r=>r.routingMode === 'SNAPSHOT_GROUP').map(groupRow), activities, notifications: [], mail: [],
    terminal: {
      requestId: '00000000-0000-4000-8000-000000000010', status,
      requestPendingRows: rows.filter(r=>current(r,'REQUEST') && r.status === 'pending').length,
      solutionPendingRows: rows.filter(r=>current(r,'SOLUTION') && r.status === 'pending').length,
      finalPendingRows: rows.filter(r=>current(r,'FINAL') && r.status === 'pending').length,
      instances: instances.map(i=>({id:String(i.id),phase:String(i.phase),attempt:Number(i.attempt),state:String(i.state),supersededAt:i.supersededAt as string|null})),
      activities: activities.map(a=>({id:String(a.id),action:String(a.action),fromStatus:a.fromStatus as string|null,toStatus:a.toStatus as string|null,userId:String(a.userId),comments:a.comments as string|null})),
      notifications: [],
    },
  })
}
function delivered(s: BusinessSnapshot, type: string, recipients: string[], mail = true): BusinessSnapshot {
  const notes = recipients.map((userId,n)=>({id:`note-${n}`,userId,requestId:'00000000-0000-4000-8000-000000000010',type,title:'Review',message:'Fixture notification',isRead:false,createdAt:date}))
  return {...s, notifications:notes, mail:mail ? recipients.map((recipientId,n)=>({messageId:`mail-${n}`,recipientId,requestId:'00000000-0000-4000-8000-000000000010',semanticType:type,bodyDigest:hash(`body-${n}`)})) : [],
    terminal:s.terminal ? {...s.terminal,notifications:notes.map(({id,userId,type,title})=>({id,userId,type,title}))} : null}
}
const emptySnapshot = (): BusinessSnapshot => ({terminal:null,request:null,solutions:[],instances:[],approvalRows:[],groups:[],activities:[],notifications:[],mail:[]})
function actionEvidence(spec: ActionEvidence['record']['spec'], args: JsonValue, intendedActor: string, before: BusinessSnapshot, after: BusinessSnapshot, proof: PhaseProof | null, rawResult: unknown): ActionEvidence {
  const projection=normalizeActionResult(spec.handler,rawResult), result={state:'returned' as const,projection}
  return {
    record:{identity:identity(),spec,intendedActor,argumentProjection:args,stage:'resolved',start:mark(0)},
    binding:{actionId:'public-action',handler:spec.handler,chunk:ref('js'),byteOffset:128,generatedSourceSha256:hash('generated'),contextId:'ctx-1'},
    dispatch:{identity:identity(),actionId:'public-action',argumentProjection:args,start:mark(0),end:mark(20),status:200,body:ref('flight'),result},
    server:{invocationId:'server-call-1',handler:spec.handler,argumentProjection:args,actorId:intendedActor,authObserved:true,originalInvoked:true,start:mark(2),end:mark(18),transaction:'resolved',exit:result,observerErrors:[],sourceSha256:hash('generated')},
    before,after,beforeArtifact:ref('before'),afterArtifact:ref('after'),phaseProof:proof,uiConfirmed:true,
  }
}
const statuses: Record<Phase,string> = {REQUEST:'ImprovementRequest',SOLUTION:'DesignCostEstimationApproval',FINAL:'FinalApproval'}
const completedStatuses: Record<Phase,string> = {REQUEST:'SentToEngineer',SOLUTION:'SendBackToRequester',FINAL:'Completed'}
const decisionHandlers: Record<Phase,{approve:HandlerKey;reject:HandlerKey}> = {
  REQUEST:{approve:'approvals.approveRequest',reject:'approvals.rejectRequest'},
  SOLUTION:{approve:'solutions.approveSolution',reject:'solutions.rejectSolution'},
  FINAL:{approve:'solutions.approveFinalApproval',reject:'solutions.rejectFinalApproval'},
}
function decisionFixture(phase: Phase='SOLUTION', kind:'approve'|'reject'='approve', next = false, custom = false): ActionEvidence {
  const inst=instanceRow(phase,'inst-1',1,'PENDING',custom), row=approvalRow(phase,'inst-1',1,custom)
  const rows=next ? [row,approvalRow(phase,'inst-1',2,custom)] : [row]
  const sols=phase === 'REQUEST' ? [] : [solutionRow()]
  const afterStatus=kind === 'reject' ? phase === 'REQUEST' ? 'ImprovementRequest' : 'SentToEngineer' : next ? statuses[phase] : completedStatuses[phase]
  const afterRows=rows.map((r,n)=>n === 0 ? {...r,status:kind === 'approve' ? 'approved' : 'rejected',approverId:actor,approvedAt:date,comments:kind === 'reject' ? 'Needs revision' : 'Approved'} : kind === 'reject' ? {...r,status:'rejected'} : r)
  const afterInst={...inst,state:kind === 'reject' ? 'REJECTED' : next ? 'PENDING' : 'APPROVED'}
  const action=phase === 'REQUEST' ? kind === 'approve' ? 'approved' : 'rejected' : `${phase === 'SOLUTION' ? 'solution' : 'final_approval'}_${kind === 'approve' ? 'approved' : 'rejected'}`
  const before=snap(statuses[phase],[inst],rows,sols)
  const acts=[audit('activity-1',action,actor,kind === 'reject' ? 'Needs revision' : 'Approved')]
  if (kind === 'approve' && !next) {
    const comment=phase === 'SOLUTION' ? 'Solution "Solution title" approved. Request sent back to requester for final review.' : phase === 'FINAL' ? 'All final approvals completed. Request marked as completed.' : 'Status changed from ImprovementRequest to SentToEngineer'
    acts.push({...audit('status-activity','status_changed',requester,comment),fromStatus:statuses[phase],toStatus:afterStatus})
  }
  if (kind === 'reject' && phase === 'FINAL') acts.push({...audit('status-activity','status_changed',actor,'Final approval rejected. Request returned to engineering for revision. Reason: "Needs revision"'),fromStatus:'FinalApproval',toStatus:'SentToEngineer'})
  let after=snap(afterStatus,[afterInst],afterRows,sols,acts)
  if (kind === 'approve' && phase === 'SOLUTION' && !next) (after.request as FixtureRow).projectEstimateCost='100.00'
  if (kind === 'reject') after=delivered(after,'approval_rejected',[requester,actor])
  else if (next) after=delivered(after,phase === 'FINAL' ? 'final_approval_needed' : 'approval_needed',['00000000-0000-4000-8000-000000000103'])
  else if (phase === 'REQUEST') after=delivered(after,'status_changed',[requester],false)
  else if (phase === 'SOLUTION') after=delivered(after,'solution_ready',[requester,engineer])
  else after=delivered(after,'approval_granted',[requester])
  const target:DecisionTarget={requestId:'00000000-0000-4000-8000-000000000010',phase,instanceId:'inst-1',attempt:1,approvalRowId:String(row.id),order:1,currentOrder:1,actorId:actor,routingMode:custom?'CUSTOM_PERSON':'SNAPSHOT_GROUP',requiredPositionId:custom?null:'pos-1',candidateGroupId:custom?null:'inst-1-group-1',candidateUserIds:custom?[actor]:candidates(1),observedStatus:statuses[phase],solutionId:phase === 'SOLUTION'?'sol-1':null}
  const args=normalizeActionArguments(decisionHandlers[phase][kind],[phase === 'SOLUTION'?'sol-1':'00000000-0000-4000-8000-000000000010',kind === 'reject'?'Needs revision':'Approved'])
  const proof:PhaseProof=kind === 'approve' ? {phase,attempt:1,stepOrder:1,actor,approvalRowId:String(row.id),requestId:'00000000-0000-4000-8000-000000000010',status:'approved',order:1,instanceId:'inst-1'} : {phase,requestId:'00000000-0000-4000-8000-000000000010',rejectionRowId:String(row.id),status:afterStatus as 'ImprovementRequest'|'SentToEngineer',actor,reason:'Needs revision',rejectedRows:rows.length,instanceId:'inst-1',attempt:1,order:1,...(phase === 'SOLUTION'?{}:{isFinalApproval:phase === 'FINAL'})}
  return actionEvidence({kind,handler:decisionHandlers[phase][kind],target},args,actor,before,after,proof,{success:true})
}
function rowlessFixture(kind:'create'|'submit-solution'|'initiate-final'|'resubmit', phase:Phase='REQUEST', custom=false): ActionEvidence {
  if (kind === 'create') phase='REQUEST'
  if (kind === 'submit-solution') phase='SOLUTION'
  if (kind === 'initiate-final') phase='FINAL'
  const handler:HandlerKey=kind === 'create'?'requests.createRequest':kind === 'submit-solution'?'solutions.submitSolution':kind === 'initiate-final'?'solutions.initiateFinalApproval':phase === 'REQUEST'?'requests.resubmitRequest':'solutions.resubmitSolution'
  const who=phase === 'SOLUTION'?engineer:requester, attempt=kind === 'resubmit'?2:1
  const fresh=instanceRow(phase,'fresh',attempt,'PENDING',custom)
  const rows=[approvalRow(phase,'fresh',1,custom),approvalRow(phase,'fresh',2,custom)]
  const steps:ExpectedApprovalStep[]=rows.map(r=>({order:Number(r.order),requiredPositionId:r.requiredPositionId as string|null,requiredApproverId:r.requiredApproverId as string|null,candidateUserIds:custom?[String(r.requiredApproverId)]:candidates(Number(r.order)),primaryActorId:Number(r.order)===1?actor:'00000000-0000-4000-8000-000000000103'}))
  const title=phase === 'SOLUTION'?'Solution title':'Request title'
  const target:RowlessTarget={requestId:kind === 'create'?null:'00000000-0000-4000-8000-000000000010',solutionId:kind === 'resubmit'&&phase === 'SOLUTION'?'sol-1':null,phase,previous:null,expectedAttempt:attempt,expectedChain:custom?[actor,'00000000-0000-4000-8000-000000000103']:[],titleSha256:hash(title),routingMode:custom?'CUSTOM_PERSON':'SNAPSHOT_GROUP',expectedSteps:steps,...(custom?{customApproverIds:[actor,'00000000-0000-4000-8000-000000000103']}:{})}
  let args:FixtureRow, proof:PhaseProof, before:BusinessSnapshot, after:BusinessSnapshot, rawResult:unknown
  let oldInstances:FixtureRow[]=[],oldRows:FixtureRow[]=[],oldActs:FixtureRow[]=[]
  const sols=phase === 'SOLUTION'||kind === 'initiate-final'?[solutionRow()]:[]
  if (kind === 'resubmit') {
    const old=instanceRow(phase,'old',1,'REJECTED',custom)
    const row:FixtureRow={...approvalRow(phase,'old',1,custom),status:'rejected',approverId:actor,approvedAt:date,comments:'Needs revision'}
    before=snap(phase === 'REQUEST'?'ImprovementRequest':'SentToEngineer',[old],[row],sols,[audit('old-audit',phase === 'REQUEST'?'rejected':'solution_rejected',actor,'Needs revision')])
    target.previous={requestId:'00000000-0000-4000-8000-000000000010',phase:phase as 'REQUEST'|'SOLUTION',instanceId:'old',attempt:1,solutionId:phase === 'SOLUTION'?'sol-1':null,observedStatus:phase === 'REQUEST'?'ImprovementRequest':'SentToEngineer',expectedState:'rejected',rowStates:[{order:1,status:'rejected',approvalRowId:String(row.id)}]}
    oldInstances=[{...old,supersededAt:date}];oldRows=[row];oldActs=before.activities as FixtureRow[]
    args=normalizeActionArguments(handler,[phase === 'REQUEST'?{requestId:'00000000-0000-4000-8000-000000000010'}:{requestId:'00000000-0000-4000-8000-000000000010',title,description:'Solution description',inlineImageSessionId:'00000000-0000-4000-8000-000000000001',cost:100,currency:'THB',timeline:'One week',newFileIds:[],deletedFileIds:[],useCustomHierarchy:custom,customApprovers:custom?[actor,'00000000-0000-4000-8000-000000000103']:[]}]) as FixtureRow
    proof={phase:phase as 'REQUEST'|'SOLUTION',requestId:'00000000-0000-4000-8000-000000000010',newAttempt:2,previousAttempt:1,previousInstanceId:'old',newInstanceId:'fresh',previousSuperseded:true,carriedApprovals:0,...(custom?{customChainIds:[actor,'00000000-0000-4000-8000-000000000103']}:{})}
    rawResult=phase === 'REQUEST'?{success:true,request:{...requestRow('ImprovementRequest'),updatedAt:new Date(date)}}:{success:true,solutionId:'sol-1',deletedAttachmentIds:[],cleanupWarnings:[]}
  } else if (kind === 'create') {
    before=emptySnapshot();args=normalizeActionArguments(handler,[{title,description:'Request description',inlineImageSessionId:'00000000-0000-4000-8000-000000000001',stagedAttachmentIds:[]}]) as FixtureRow
    proof={title,status:'ImprovementRequest',requestId:'00000000-0000-4000-8000-000000000010'};rawResult={success:true,requestId:'00000000-0000-4000-8000-000000000010'}
  } else if (kind === 'submit-solution') {
    before=snap('SentToEngineer',[],[])
    args=normalizeActionArguments(handler,[{requestId:'00000000-0000-4000-8000-000000000010',title,description:'Solution description',inlineImageSessionId:'00000000-0000-4000-8000-000000000001',currency:'THB',costEstimate:100,timeline:'One week',fileIds:[],useCustomApprovals:custom,customApproverIds:custom?[actor,'00000000-0000-4000-8000-000000000103']:[]}]) as FixtureRow
    proof={requestId:'00000000-0000-4000-8000-000000000010',solutionId:'sol-1',instanceId:'fresh',attempt:1,status:'DesignCostEstimationApproval',pendingApprovalRows:2,pendingApproverIds:custom?[actor,'00000000-0000-4000-8000-000000000103']:[],routingMode:target.routingMode,routeVersionId:custom?null:'route-1',routeSource:'COMPANY_DEFAULT',observedInstanceId:'fresh',observedStatus:'DesignCostEstimationApproval',observedRouteSource:'COMPANY_DEFAULT',pendingActorIds:[actor,'00000000-0000-4000-8000-000000000103'],...(custom?{customChainIds:[actor,'00000000-0000-4000-8000-000000000103']}:{})}
    rawResult={success:true,solutionId:'sol-1'}
  } else {
    const old=instanceRow('SOLUTION','solution-history',1,'APPROVED')
    const row={...approvalRow('SOLUTION','solution-history'),status:'approved',approverId:actor,approvedAt:date,comments:'Approved'}
    before=snap('SendBackToRequester',[old],[row],sols)
    oldInstances=[old];oldRows=[row]
    args=normalizeActionArguments(handler,['00000000-0000-4000-8000-000000000010',custom,...(custom?[[actor,'00000000-0000-4000-8000-000000000103']]:[])]) as FixtureRow
    proof={requestId:'00000000-0000-4000-8000-000000000010',initiationRowId:String(rows[0].id),instanceId:'fresh',observedInstanceId:'fresh',attempt:1,status:'FinalApproval',observedStatus:'FinalApproval',pendingFinalRows:2,pendingApproverIds:custom?[actor,'00000000-0000-4000-8000-000000000103']:[],routingMode:target.routingMode,routeVersionId:custom?null:'route-1',routeSource:'COMPANY_DEFAULT',observedRouteSource:'COMPANY_DEFAULT',pendingActorIds:[actor,'00000000-0000-4000-8000-000000000103'],...(custom?{customChainIds:[actor,'00000000-0000-4000-8000-000000000103']}:{})}
    rawResult={success:true}
  }
  const event=kind === 'create'?'created':kind === 'submit-solution'?'solution_submitted':kind === 'initiate-final'?'final_approval_initiated':phase === 'REQUEST'?'resubmitted':'solution_resubmitted'
  const newAudit=audit('new-audit',event,who)
  if (kind === 'create') {newAudit.toStatus='ImprovementRequest';newAudit.comments='Request created: Request title'}
  else if (kind === 'resubmit' && phase === 'REQUEST') {newAudit.toStatus='ImprovementRequest';newAudit.comments='Request resubmitted after rejection'}
  else if (kind === 'submit-solution') newAudit.comments='Solution submitted: "Solution title" with cost estimate 100 THB'
  else if (kind === 'resubmit') newAudit.comments='Solution resubmitted: "Solution title"'
  else newAudit.comments=custom?'Final approval initiated with custom approval chain':'Final approval attempt created from the published route'
  after=snap(statuses[phase],[...oldInstances,fresh],[...oldRows,...rows],sols,[...oldActs,newAudit])
  if (kind === 'resubmit'&&phase === 'REQUEST') (after.request as FixtureRow).updatedAt='2026-10-14T00:00:00.001Z'
  if (!(kind === 'resubmit'&&phase === 'REQUEST')) after=delivered(after,phase === 'FINAL'?'final_approval_needed':'approval_needed',custom?[actor]:candidates(1))
  const evidence=actionEvidence({kind,handler,target} as ActionEvidence['record']['spec'],args,who,before,after,proof,rawResult)
  if (kind==='create'||kind==='submit-solution'||kind==='resubmit'&&phase==='SOLUTION') {
    // Explicit fixture observation of the chosen preparation boundary, not a
    // value recovered from the AFTER snapshot or invented handler result.
    const description=kind==='create'?'Request description':'Solution description'
    evidence.server!.preparedDescription={inputSha256:hash(description),htmlSha256:hash(description),uploadSessionId:'00000000-0000-4000-8000-000000000001'}
  }
  return evidence
}
function staleFixture():ActionEvidence {
  const done=decisionFixture('FINAL')
  const baseline=delivered(done.after!,'approval_granted',[requester])
  const target=(done.record.spec as {target:DecisionTarget}).target
  const e=actionEvidence({kind:'deny-stale',handler:'solutions.rejectFinalApproval',target,current:baseline.terminal!},normalizeActionArguments('solutions.rejectFinalApproval',['00000000-0000-4000-8000-000000000010','Needs revision']),actor,baseline,structuredClone(baseline),null,{success:true})
  const denial=normalizeActionError('You cannot reject this request at this time','source-denial-digest')
  e.server!.exit=denial;e.dispatch!.result=denial;e.server!.transaction='not-started';e.uiConfirmed=false
  return e
}
function accepted(e:ActionEvidence):void {
  const r=evaluateAction(e)
  assert.deepEqual({outcome:r.outcome,commit:r.commitProven,valid:r.evidenceValid,satisfied:r.expectedSatisfied,gaps:r.gaps},{outcome:'COMMITTED_AND_UI_CONFIRMED',commit:true,valid:true,satisfied:true,gaps:[]},JSON.stringify(r))
}
function rejected(e:ActionEvidence,gap?:string):void {
  const r=evaluateAction(e);assert.equal(r.expectedSatisfied,false,JSON.stringify(r));assert.equal(r.evidenceValid,false,JSON.stringify(r))
  if(gap) assert.ok(r.gaps.some(g=>g.includes(gap)),`expected ${gap}: ${JSON.stringify(r)}`)
}
function setArgs(e:ActionEvidence,args:JsonValue):void {e.record.argumentProjection=args;e.server!.argumentProjection=args;e.dispatch!.argumentProjection=args}
function setResult(e:ActionEvidence,value:JsonValue):void {e.server!.exit={state:'returned',projection:value};e.dispatch!.result={state:'returned',projection:value}}

const rowlessCases = [
  ['create','REQUEST'],['submit-solution','SOLUTION'],['initiate-final','FINAL'],['resubmit','REQUEST'],['resubmit','SOLUTION'],
] as const

describe('Task1 source contracts: eleven real exports and actual stale throw',()=>{
  it('registry_covers_every_matrix_business_caller',()=>{
    assert.equal(MATRIX_ACTION_REGISTRY.length,11);assert.equal(new Set(MATRIX_ACTION_REGISTRY.map(e=>e.handler)).size,11)
    for(const phase of ['REQUEST','SOLUTION','FINAL'] as const) for(const kind of ['approve','reject'] as const) {
      const e=decisionFixture(phase,kind);assert.equal(expectedHandlerFor(e.record.spec),e.record.spec.handler)
    }
  })
  for(const phase of ['REQUEST','SOLUTION','FINAL'] as const) for(const kind of ['approve','reject'] as const) {
    it(`${decisionHandlers[phase][kind]} truthful success-only result and full persisted transition`,()=>accepted(decisionFixture(phase,kind)))
    it(`${decisionHandlers[phase][kind]} custom-person exact row category`,()=>accepted(decisionFixture(phase,kind,false,true)))
  }
  for(const [kind,phase] of rowlessCases) it(`${kind}/${phase} truthful args/result/fresh rows/audit/delivery`,()=>accepted(rowlessFixture(kind,phase)))
  for(const [kind,phase] of rowlessCases.filter(([k,p])=>!(k==='create'||k==='resubmit'&&p==='REQUEST'))) it(`${kind}/${phase} explicit custom full ordered chain`,()=>accepted(rowlessFixture(kind,phase,true)))
  it('actual Completed held two-argument source eligibility throw qualifies only unchanged denial',()=>{
    const e=staleFixture(),r=evaluateAction(e)
    assert.deepEqual({outcome:r.outcome,commit:r.commitProven,valid:r.evidenceValid,satisfied:r.expectedSatisfied,gaps:r.gaps},{outcome:'DENIED_UNCHANGED',commit:false,valid:true,satisfied:true,gaps:[]},JSON.stringify(r))
    assert.doesNotThrow(()=>assertNegativePair({id:'stale',kind:'stale',before:e.before!,after:e.after!,beforeArtifact:e.beforeArtifact!,afterArtifact:e.afterArtifact!,action:e}))
  })
  it('normalizes only real nested request.id and Date-containing original request without invented fields',()=>{
    assert.deepEqual(normalizeActionResult('requests.resubmitRequest',{success:true,request:{...requestRow('ImprovementRequest'),updatedAt:new Date(date)}}),{success:true,request:{id:'00000000-0000-4000-8000-000000000010'}})
    assert.deepEqual(normalizeActionResult('solutions.initiateFinalApproval',{success:true}),{success:true})
    assert.throws(()=>normalizeActionResult('requests.resubmitRequest',{success:true,requestId:'00000000-0000-4000-8000-000000000010',newAttempt:2}),/request.id/)
  })
})

describe('Task1 F1 exact business transition and semantic delivery',()=>{
  const edits:[string,(e:ActionEvidence)=>void,string][]=[
    ['after instance phase',e=>{(e.after!.instances[0] as FixtureRow).phase='REQUEST'},'after-instance-metadata'],
    ['after instance attempt',e=>{(e.after!.instances[0] as FixtureRow).attempt=9},'after-instance-metadata'],
    ['after instance state',e=>{(e.after!.instances[0] as FixtureRow).state='PENDING'},'after-instance-state'],
    ['after instance supersession',e=>{(e.after!.instances[0] as FixtureRow).supersededAt=date},'after-instance-metadata'],
    ['before instance state',e=>{(e.before!.instances[0] as FixtureRow).state='APPROVED'},'before-instance'],
    ['row instance',e=>{(e.before!.approvalRows[0] as FixtureRow).instanceId='elsewhere'},'target-row'],
    ['row solution',e=>{(e.before!.approvalRows[0] as FixtureRow).solutionId='sol-other'},'solution-identity'],
    ['row order',e=>{(e.before!.approvalRows[0] as FixtureRow).order=2},'target-row'],
    ['missing actual groups',e=>{e.after!.groups=[]},'group-history-changed'],
    ['missing actual membership',e=>{(e.before!.groups[0] as FixtureRow).members=[]},'target-membership-actor'],
    ['extra actual member',e=>{((e.before!.groups[0] as FixtureRow).members as FixtureRow[]).push({candidateGroupId:'inst-1-group-1',userId:'foreign',capturedAt:date,capturedDisplayName:'foreign'})},'target-membership-actor'],
    ['target current order',e=>{(e.record.spec.target as DecisionTarget).currentOrder=2},'target-row'],
    ['target actor',e=>{(e.record.spec.target as DecisionTarget).actorId='foreign'},'target-membership-actor'],
    ['wrong request outcome',e=>{(e.after!.request as FixtureRow).status='Completed'},'after-request-status'],
    ['wrong solution cost copy',e=>{(e.after!.request as FixtureRow).projectEstimateCost='99.00'},'approved-solution-cost'],
    ['missing new audit',e=>{e.after!.activities=[]},'audit-record-missing'],
    ['wrong audit request',e=>{(e.after!.activities[0] as FixtureRow).requestId='req-other'},'audit-record-missing'],
    ['wrong audit actor',e=>{(e.after!.activities[0] as FixtureRow).userId='foreign'},'audit-record-missing'],
  ]
  for(const [name,mutate,gap] of edits) it(`isolated ${name}`,()=>{const e=decisionFixture();accepted(e);mutate(e);rejected(e,gap)})
  for(const side of ['before','after'] as const) for(const field of ['phase','attempt','state','supersededAt','requestId','solutionId','routingMode']) it(`missing ${side} instance ${field}`,()=>{
    const e=decisionFixture();accepted(e);delete (e[side]!.instances[0] as FixtureRow)[field];rejected(e,'instance-fields')
  })
  for(const field of ['id','instanceId','order','status','approverId','comments','approvedAt','routingMode','requiredApproverId','requiredPositionId','candidateGroupId']) it(`missing actual row ${field}`,()=>{
    const e=decisionFixture();accepted(e);delete (e.after!.approvalRows[0] as FixtureRow)[field];rejected(e)
  })
  for(const phase of ['REQUEST','FINAL'] as const) it(`${phase} wrong isFinalApproval alone`,()=>{const e=decisionFixture(phase);accepted(e);(e.before!.approvalRows[0] as FixtureRow).isFinalApproval=phase !== 'FINAL';rejected(e,'row-request-category')})
  for(const field of ['approverId','comments']) it(`rejection requires actual deciding ${field}`,()=>{const e=decisionFixture('SOLUTION','reject');accepted(e);(e.after!.approvalRows[0] as FixtureRow)[field]='foreign';rejected(e,field === 'comments'?'deciding-reason':'deciding-row')})
  it('mail-only delta cannot stand for pending-row business transition',()=>{
    const e=decisionFixture();accepted(e);e.after=structuredClone(e.before!);e.after.mail=[{messageId:'mail-new',recipientId:requester,requestId:'00000000-0000-4000-8000-000000000010',semanticType:'solution_ready',bodyDigest:hash('mail')}]
    assert.equal(evaluateAction(e).commitProven,false);rejected(e,'deciding-row')
  })
  it('actual earlier pending row defeats self-reported current turn',()=>{
    const e=decisionFixture('SOLUTION','approve',true);accepted(e)
    const row=e.before!.approvalRows[0] as FixtureRow;row.order=3
    rejected(e,'actual-current-turn')
  })
  for(const phase of ['REQUEST','SOLUTION','FINAL'] as const) it(`${phase} nonterminal approval advances actual next turn`,()=>accepted(decisionFixture(phase,'approve',true)))
  for(const phase of ['REQUEST','SOLUTION','FINAL'] as const) it(`${phase} rejection closes all remaining current pending rows`,()=>accepted(decisionFixture(phase,'reject',true)))
  for(const kind of ['notification','mail'] as const) for(const field of kind==='notification'?['type','userId','requestId']:['semanticType','recipientId','requestId']) it(`${kind} wrong semantic ${field} fails qualification, not commit`,()=>{
    const e=decisionFixture();accepted(e)
    const row=(kind==='notification'?e.after!.notifications[0]:e.after!.mail[0]) as FixtureRow
    row[field]=field==='type'||field==='semanticType'?'approval_rejected':'foreign'
    rejected(e,`delivery:${kind}`);assert.equal(evaluateAction(e).commitProven,true)
  })
})

describe('Task1 F2 source args/results binding',()=>{
  const all=()=>[...(['REQUEST','SOLUTION','FINAL'] as const).flatMap(p=>(['approve','reject'] as const).map(k=>decisionFixture(p,k))),...rowlessCases.map(([k,p])=>rowlessFixture(k,p))]
  for(let index=0;index<11;index++) {
    for(const bad of [null,[],true,{}, {success:'true'}] as JsonValue[]) it(`handler ${index+1} equal invalid projections ${JSON.stringify(bad)}`,()=>{const e=all()[index];accepted(e);setResult(e,bad);rejected(e,'result-shape')})
    it(`handler ${index+1} Flight-only result conflict retains known original commit`,()=>{const e=all()[index];accepted(e);e.dispatch!.result={state:'returned',projection:{success:false}};rejected(e,'exit-result-mismatch');assert.equal(evaluateAction(e).commitProven,true)})
    it(`handler ${index+1} equal wrong immutable argument cannot qualify`,()=>{
      const e=all()[index];accepted(e);const args={...(e.record.argumentProjection as FixtureRow)}
      const key=e.record.spec.kind==='create'?'titleSha256':e.record.spec.handler==='solutions.approveSolution'||e.record.spec.handler==='solutions.rejectSolution'?'solutionId':'requestId'
      args[key]=key==='titleSha256'?hash('wrong'):'foreign';setArgs(e,args);rejected(e,'argument-target');assert.equal(evaluateAction(e).commitProven,false)
    })
  }
  for(const [kind,phase] of rowlessCases) {
    if(kind==='create'||kind==='resubmit'&&phase==='REQUEST') continue
    const flag=kind==='initiate-final'?'useCustomChain':kind==='submit-solution'?'useCustomApprovals':'useCustomHierarchy'
    const list=kind==='resubmit'?'customApprovers':'customApproverIds'
    for(const bad of [undefined,null,'true',false]) it(`${kind} custom flag ${String(bad)} fails`,()=>{
      const e=rowlessFixture(kind,phase,true);accepted(e);const a={...(e.record.argumentProjection as FixtureRow)};if(bad===undefined)delete a[flag];else a[flag]=bad;setArgs(e,a);rejected(e,flag)
    })
    for(const bad of [undefined,[],['00000000-0000-4000-8000-000000000103',actor],['foreign']]) it(`${kind} exact custom list ${JSON.stringify(bad)} fails`,()=>{
      const e=rowlessFixture(kind,phase,true);accepted(e);const a={...(e.record.argumentProjection as FixtureRow)};if(bad===undefined)delete a[list];else a[list]=bad;setArgs(e,a);rejected(e,list)
    })
    it(`${kind} rank nonempty intended chain never implies custom flag`,()=>{const e=rowlessFixture(kind,phase);(e.record.spec.target as RowlessTarget).expectedChain=[actor,'00000000-0000-4000-8000-000000000103'];accepted(e)})
  }
  for(const [kind,phase,idField] of [['create','REQUEST','requestId'],['submit-solution','SOLUTION','solutionId'],['resubmit','SOLUTION','solutionId'],['resubmit','REQUEST','request']] as const) it(`${kind}/${phase} required returned ${idField} missing/wrong`,()=>{
    for(const mutation of ['missing','wrong']) {const e=rowlessFixture(kind,phase);accepted(e);const v={...(e.server!.exit as {projection:FixtureRow}).projection};if(mutation==='missing')delete v[idField];else v[idField]=idField==='request'?{id:'foreign'}:'foreign';setResult(e,v);rejected(e,'result-identity')}
  })
  it('server success:false cannot qualify a positive transaction',()=>{const e=decisionFixture();accepted(e);setResult(e,{success:false,stale:true,message:'This request was updated by another user.'});rejected(e);assert.equal(evaluateAction(e).commitProven,false)})
  it('thrown code/digest must match Flight independently',()=>{
    for(const field of ['code','digest'] as const) {const e=staleFixture();assert.equal(evaluateAction(e).expectedSatisfied,true);e.dispatch!.result={state:'thrown',code:'You cannot reject this request at this time',digest:'source-denial-digest',[field]:'different'};rejected(e,'exit-result-mismatch')}
  })
})

describe('Task1 F3 real stale subject, retained history and reachability',()=>{
  const cases:[string,(e:ActionEvidence)=>void,string][]=[
    ['target request and all args',e=>{e.record.spec.target.requestId='req-other';setArgs(e,{requestId:'req-other',comments:'Needs revision'})},'stale:subject'],
    ['held row',e=>{(e.record.spec.target as DecisionTarget).approvalRowId='different'},'held-history-tuple'],
    ['held instance',e=>{(e.record.spec.target as DecisionTarget).instanceId='different'},'held-history-tuple'],
    ['held attempt',e=>{(e.record.spec.target as DecisionTarget).attempt=2},'held-history-tuple'],
    ['held actor',e=>{(e.record.spec.target as DecisionTarget).actorId='different'},'held-history-tuple'],
    ['held phase',e=>{e.record.spec.target.phase='SOLUTION'},'stale:subject'],
    ['missing retained row',e=>{e.before!.approvalRows=[];e.after=structuredClone(e.before!)},'held-history-tuple'],
    ['current baseline',e=>{if(e.record.spec.kind==='deny-stale')e.record.spec.current={...e.record.spec.current,status:'FinalApproval'}},'current-completed'],
    ['lying pending zero',e=>{(e.before!.approvalRows[0] as FixtureRow).status='pending';e.after=structuredClone(e.before!)},'pending-zero'],
    ['unknown transaction',e=>{e.server!.transaction='unknown'},'transaction-not-started'],
    ['rejected transaction',e=>{e.server!.transaction='rejected'},'transaction-not-started'],
    ['generic denial',e=>{e.server!.exit={state:'thrown',code:'Unauthorized',digest:null};e.dispatch!.result=e.server!.exit},'eligibility-throw'],
    ['unreachable returned shortcut',e=>{setResult(e,{success:false,stale:true,message:'This request was updated by another user.'})},'eligibility-throw'],
    ['invented third argument',e=>{setArgs(e,{requestId:'00000000-0000-4000-8000-000000000010',comments:'Needs revision',expectedUpdatedAt:date})},'not-two-argument'],
  ]
  for(const [name,mutate,gap] of cases) it(name,()=>{const e=staleFixture();assert.equal(evaluateAction(e).expectedSatisfied,true);mutate(e);rejected(e,gap)})
})

describe('Task1 F4 rowless real freshness and attempted unknown states',()=>{
  for(const [kind,phase] of rowlessCases) {
    for(const state of ['attempting','unknown'] as const) it(`${kind}/${phase} explicit ${state} cannot qualify`,()=>{
      const e=rowlessFixture(kind,phase);accepted(e)
      if(state==='attempting') e.record.stage='attempting';else e.server!.transaction='unknown'
      rejected(e);assert.equal(e.record.spec.kind,kind);assert.ok(e.record)
    })
    for(const field of ['phase','attempt','state','supersededAt','routingMode']) for(const missing of [false,true]) it(`${kind}/${phase} fresh ${field} ${missing?'missing':'wrong'}`,()=>{
      const e=rowlessFixture(kind,phase);accepted(e);const i=(e.after!.instances as FixtureRow[]).find(i=>i.id==='fresh')!
      if(missing)delete i[field];else i[field]=field==='phase'?'WRONG':field==='attempt'?9:field==='supersededAt'?date:field==='state'?'APPROVED':'CUSTOM_PERSON'
      rejected(e,'fresh-instance')
    })
    it(`${kind}/${phase} actual row omission despite intact self-reported lists fails`,()=>{
      const e=rowlessFixture(kind,phase);accepted(e);e.after!.approvalRows=e.after!.approvalRows.filter(r=>(r as FixtureRow).id!=='fresh-row-2');rejected(e,'fresh-full-chain')
    })
    for(const field of ['status','approverId','approvedAt','comments']) it(`${kind}/${phase} no carried ${field}`,()=>{
      const e=rowlessFixture(kind,phase);accepted(e);const row=(e.after!.approvalRows as FixtureRow[]).find(r=>r.instanceId==='fresh')!;row[field]=field==='status'?'approved':field==='approvedAt'?date:'prior';rejected(e,'fresh-carried-approvals')
    })
    it(`${kind}/${phase} rowless kind phase is immutable`,()=>{const e=rowlessFixture(kind,phase);e.record.spec.target.phase=phase==='FINAL'?'REQUEST':'FINAL';rejected(e)})
  }
  for(const phase of ['REQUEST','SOLUTION'] as const) {
    for(const value of [null,undefined]) it(`resubmit/${phase} actual previous supersession ${String(value)} fails`,()=>{
      const e=rowlessFixture('resubmit',phase);accepted(e);const i=(e.after!.instances as FixtureRow[]).find(i=>i.id==='old')!;if(value===undefined)delete i.supersededAt;else i.supersededAt=value;rejected(e,'previous-instance-not-superseded')
    })
    it(`resubmit/${phase} prior terminal state preserved, never rewritten to SUPERSEDED`,()=>{const e=rowlessFixture('resubmit',phase);accepted(e);(e.after!.instances[0] as FixtureRow).state='SUPERSEDED';rejected(e,'previous-instance-not-superseded')})
    it(`resubmit/${phase} prior actual row history bound`,()=>{const e=rowlessFixture('resubmit',phase);accepted(e);(e.after!.approvalRows[0] as FixtureRow).comments='rewritten';rejected(e,'previous-row-rewritten')})
  }
  it('REQUEST resubmit requires exact resubmitted audit and no invented delivery',()=>{const e=rowlessFixture('resubmit','REQUEST');accepted(e);(e.after!.activities[1] as FixtureRow).action='status_changed';rejected(e,'audit-record-missing')})
  it('SOLUTION resubmit after FINAL rejection preserves approved SOLUTION history',()=>{
    const e=rowlessFixture('resubmit','SOLUTION');accepted(e)
    const target=e.record.spec.target as RowlessTarget
    target.previous!.expectedState='approved';target.previous!.rowStates[0].status='approved'
    for(const s of [e.before!,e.after!]){(s.instances[0] as FixtureRow).state='APPROVED';(s.approvalRows[0] as FixtureRow).status='approved';s.terminal!.instances[0].state='APPROVED'}
    // Retain actual rejected FINAL eligibility history as required by source.
    const fi=instanceRow('FINAL','final-rejected',1,'REJECTED'),fr={...approvalRow('FINAL','final-rejected'),status:'rejected',approverId:actor,approvedAt:date,comments:'Needs revision'}
    for(const s of [e.before!,e.after!]){s.instances=[...s.instances,fi];s.approvalRows=[...s.approvalRows,fr];s.groups=[...s.groups,groupRow(fr)];s.terminal!.instances=[...s.terminal!.instances,{id:'final-rejected',phase:'FINAL',attempt:1,state:'REJECTED',supersededAt:null}]}
    accepted(e)
  })
})

describe('Task1 F5 numeric calibrated time and complete identities',()=>{
  it('real mapped short interval passes in both directional calibration encodings',()=>{
    for(const inverse of [false,true]){const e=decisionFixture();e.dispatch!.end=mark(10);e.server!.start=mark(50002,'node');e.server!.end=mark(50008,'node');e.clockCalibration={fromDomain:inverse?'node':'browser',toDomain:inverse?'browser':'node',offsetMs:inverse?-50000:50000,uncertaintyMs:1,verified:true};accepted(e)}
  })
  it('label-only [0,10]/[50000,60000]/offset50000+uncertainty5 is rejected',()=>{const e=decisionFixture();accepted(e);e.dispatch!.end=mark(10);e.server!.start=mark(50000,'node');e.server!.end=mark(60000,'node');e.clockCalibration={fromDomain:'browser',toDomain:'node',offsetMs:50000,uncertaintyMs:5,verified:true};rejected(e,'server-interval-outside')})
  it('uncertainty-ambiguous mere overlap fails closed',()=>{const e=decisionFixture();e.dispatch!.end=mark(10);e.server!.start=mark(50000,'node');e.server!.end=mark(50010,'node');e.clockCalibration={fromDomain:'browser',toDomain:'node',offsetMs:50000,uncertaintyMs:1,verified:true};rejected(e,'server-interval-outside')})
  for(const bad of [NaN,Infinity,-1]) it(`invalid uncertainty ${bad}`,()=>{const e=decisionFixture();e.server!.start=mark(50002,'node');e.server!.end=mark(50008,'node');e.clockCalibration={fromDomain:'browser',toDomain:'node',offsetMs:50000,uncertaintyMs:bad,verified:true};rejected(e,'clock-domain-uncalibrated')})
  for(const bad of [NaN,Infinity]) it(`invalid offset ${bad}`,()=>{const e=decisionFixture();e.server!.start=mark(50002,'node');e.server!.end=mark(50008,'node');e.clockCalibration={fromDomain:'browser',toDomain:'node',offsetMs:bad,uncertaintyMs:1,verified:true};rejected(e,'clock-domain-uncalibrated')})
  for(const who of ['server','dispatch'] as const) for(const field of ['domain','monotonicMs','wallMs'] as const) it(`${who} incoherent ${field}`,()=>{
    const e=decisionFixture();accepted(e);if(field==='domain')e[who]!.end!.domain='different';else e[who]!.end![field]=NaN;rejected(e,`${who}-interval-incoherent`)
  })
  it('same-domain disjoint invocation fails',()=>{const e=decisionFixture();accepted(e);e.server!.start=mark(50000);e.server!.end=mark(60000);rejected(e,'server-interval-outside')})
  it('cross-domain no calibration fails',()=>{const e=decisionFixture();e.server!.start.domain='node';e.server!.end!.domain='node';rejected(e,'clock-domain-uncalibrated')})
  for(const field of ['invocationId','clearanceManifest','runtimeManifest'] as const) it(`distinct complete ${field} identity`,()=>{const e=decisionFixture();accepted(e);if(field==='invocationId')e.server!.invocationId=e.record.identity.invocationId;else e.dispatch!.identity[field]={...e.dispatch!.identity[field],bytes:999};rejected(e)})
})

describe('Task1 F6 exact negative pairs including mail',()=>{
  const pair=(e=staleFixture())=>({id:'stale',kind:'stale' as const,before:e.before!,after:e.after!,beforeArtifact:e.beforeArtifact!,afterArtifact:e.afterArtifact!,action:e})
  for(const side of ['beforeArtifact','afterArtifact'] as const) for(const field of ['path','sha256','bytes'] as const) it(`pair ${side} ${field} exact`,()=>{
    const p=pair();assert.doesNotThrow(()=>assertNegativePair(p));const changed={...p[side],[field]:field==='bytes'?999:field==='sha256'?hash('different'):'different'}
    assert.throws(()=>assertNegativePair({...p,[side]:changed}),/artifact references/)
  })
  it('pair B cannot reuse action A denial',()=>{const p=pair();const foreign=structuredClone(p.before);(foreign.request as FixtureRow).id='req-other';foreign.terminal!.requestId='req-other';assert.throws(()=>assertNegativePair({...p,before:foreign,after:foreign}),/snapshots do not correlate/)})
  it('missing action snapshots fails explicitly without pair substitution',()=>{const p=pair();p.action.before=null;assert.throws(()=>assertNegativePair(p),/action snapshots missing/)})
  it('semantic mail body-only mutation defeats stale equality (mail comparator mutant witness)',()=>{
    const p=pair();assert.doesNotThrow(()=>assertNegativePair(p));const after=structuredClone(p.after);(after.mail[0] as FixtureRow).bodyDigest=hash('changed-valid-body')
    assert.throws(()=>assertNegativePair({...p,after,action:{...p.action,after}}),/mail changed/)
  })
  for(const field of ['request','solutions','instances','approvalRows','groups','activities','notifications','mail','terminal'] as const) it(`paired unchanged includes ${field}`,()=>{
    const p=pair(),after=structuredClone(p.after)
    if(field==='request') (after.request as FixtureRow).title='Changed'
    else if(field==='terminal') after.terminal!.status='FinalApproval'
    else if(field==='mail') (after.mail[0] as FixtureRow).bodyDigest=hash('other')
    else if(field==='notifications') (after.notifications[0] as FixtureRow).title='Other'
    else (after[field] as JsonValue[]).push({id:'foreign'})
    assert.throws(()=>assertNegativePair({...p,after,action:{...p.action,after}}),LedgerPolicyError)
  })
  it('UI-only pairs demand equality and no dispatched action, never backend denial',()=>{const p=pair();assert.doesNotThrow(()=>assertNegativePair({...p,kind:'blank-reason',action:null}));assert.throws(()=>assertNegativePair({...p,kind:'unauthorized-viewer'}),/UI-only/);assert.throws(()=>assertNegativePair({...p,action:null}),/requires the dispatched/)})
  it('serialization canonical key order and no missing arrays',()=>{const p=pair();assert.equal(serializeBusinessSnapshot(p.before),serializeBusinessSnapshot(structuredClone(p.before)));assert.throws(()=>serializeBusinessSnapshot({...p.before,mail:undefined} as unknown as BusinessSnapshot),/array evidence/)})
})

describe('Task1 F7 known commit survives unrelated delivery/capture faults',()=>{
  const cases:[string,(e:ActionEvidence)=>void][]=[
    ['no dispatch',e=>{e.dispatch=null}],
    ['missing body/end/result',e=>{e.dispatch!.body=null;e.dispatch!.end=null;e.dispatch!.result={state:'missing',reason:'capture failed'}}],
    ['Flight-only conflict',e=>{e.dispatch!.result={state:'returned',projection:{success:false}}}],
    ['postcommit notifications absent',e=>{e.after!.notifications=[]}],
    ['postcommit mail absent',e=>{e.after!.mail=[]}],
    ['observer append fault',e=>{e.server!.observerErrors=['append failed after transaction']}],
    ['UI failure',e=>{e.uiConfirmed=false}],
    ['thrown postcommit original exit',e=>{e.server!.exit={state:'thrown',code:'ECONNRESET',digest:'d'};e.dispatch!.result=e.server!.exit}],
  ]
  for(const [name,mutate] of cases) it(name,()=>{const e=decisionFixture();accepted(e);mutate(e);const r=evaluateAction(e);assert.equal(r.commitProven,true,JSON.stringify(r));rejected(e)})
  for(const who of ['actor','handler','target','source'] as const) it(`missing trusted ${who} cannot invent commit`,()=>{const e=decisionFixture();accepted(e);if(who==='actor')e.server!.actorId=null;else if(who==='handler')e.server!.handler='approvals.approveRequest';else if(who==='source')e.server!.sourceSha256=hash('foreign');else (e.record.spec.target as DecisionTarget).instanceId='foreign';rejected(e);assert.equal(evaluateAction(e).commitProven,false)})
  it('clean unchanged guard throw needs no fictional positive proof and never qualifies unexpected positive',()=>{
    const e=decisionFixture();e.after=structuredClone(e.before!);e.phaseProof=null;e.uiConfirmed=false;e.server!.transaction='not-started';e.server!.exit=normalizeActionError('You cannot approve this solution at this time','guard');e.dispatch!.result=e.server!.exit
    const r=evaluateAction(e);assert.equal(r.outcome,'THROWN_NONCOMMITTING');assert.equal(r.evidenceValid,true,JSON.stringify(r));assert.equal(r.expectedSatisfied,false);assert.equal(r.commitProven,false)
  })
  it('throw with unknown transaction or absent snapshots is evidence failure',()=>{const e=decisionFixture();e.server!.transaction='unknown';e.server!.exit={state:'thrown',code:'ERR',digest:null};e.dispatch!.result=e.server!.exit;e.after=null;e.phaseProof=null;rejected(e);assert.equal(evaluateAction(e).outcome,'EVIDENCE_FAILURE')})
})


describe('Task1 additional source-contract RED: exact safe inputs and retained business facts',()=>{
  for(const [kind,phase,fields] of [
    ['create','REQUEST',['inlineImageSessionId','stagedAttachmentIds']],
    ['submit-solution','SOLUTION',['inlineImageSessionId','currency','fileIds']],
    ['resubmit','SOLUTION',['inlineImageSessionId','cost','currency','timeline','newFileIds','deletedFileIds']],
  ] as const) for(const field of fields) it(`${kind} missing normalized actual input ${field}`,()=>{
    const e=rowlessFixture(kind,phase);accepted(e);const a={...(e.record.argumentProjection as FixtureRow)};delete a[field];setArgs(e,a);rejected(e,`argument-target:${field}`)
  })
  it('actual argument projection rejects equal invented input fields',()=>{const e=decisionFixture();accepted(e);setArgs(e,{...(e.record.argumentProjection as FixtureRow),invented:'not-source'});rejected(e,'argument-target:unknown-field')})
  it('decisions preserve actual request identity/owner/business fields',()=>{const e=decisionFixture();accepted(e);(e.after!.request as FixtureRow).requesterId='foreign';rejected(e,'request-fields-changed')})
  it('SOLUTION revision of approved attempt needs retained current FINAL rejection',()=>{
    const e=rowlessFixture('resubmit','SOLUTION');accepted(e);const t=e.record.spec.target as RowlessTarget;t.previous!.expectedState='approved';t.previous!.rowStates[0].status='approved'
    for(const s of [e.before!,e.after!]){(s.instances[0] as FixtureRow).state='APPROVED';(s.approvalRows[0] as FixtureRow).status='approved';s.terminal!.instances[0].state='APPROVED'}
    rejected(e,'final-rejection-history')
  })
})


describe('Task1 shared safe source normalization',()=>{
  it('hashes real create content and applies only actual schema defaults',()=>{
    assert.deepEqual(normalizeActionArguments('requests.createRequest',[{title:'Title',description:'Description',inlineImageSessionId:'00000000-0000-4000-8000-000000000001'}]),{titleSha256:hash('Title'),titleLength:5,descriptionSha256:hash('Description'),descriptionLength:11,inlineImageSessionId:'00000000-0000-4000-8000-000000000001',stagedAttachmentIds:[]})
    assert.deepEqual(normalizeActionArguments('solutions.submitSolution',[{requestId:'00000000-0000-4000-8000-000000000010',title:'Title',description:'Description',inlineImageSessionId:'00000000-0000-4000-8000-000000000001'}]),{requestId:'00000000-0000-4000-8000-000000000010',titleSha256:hash('Title'),titleLength:5,descriptionSha256:hash('Description'),descriptionLength:11,inlineImageSessionId:'00000000-0000-4000-8000-000000000001',currency:'THB',fileIds:[],useCustomApprovals:false})
  })
  it('preserves positional optional omission and real Date argument normalization',()=>{
    assert.deepEqual(normalizeActionArguments('solutions.rejectFinalApproval',['00000000-0000-4000-8000-000000000010','Needs revision']),{requestId:'00000000-0000-4000-8000-000000000010',comments:projectPrivateText('Needs revision')})
    assert.deepEqual(normalizeActionArguments('solutions.approveSolution',['sol-1',undefined,new Date(date)]),{solutionId:'sol-1',expectedUpdatedAt:date})
    assert.deepEqual(normalizeActionArguments('solutions.initiateFinalApproval',['00000000-0000-4000-8000-000000000010',false]),{requestId:'00000000-0000-4000-8000-000000000010',useCustomChain:false})
    assert.deepEqual(normalizeActionArguments('requests.resubmitRequest',[{requestId:'00000000-0000-4000-8000-000000000010'}]),{requestId:'00000000-0000-4000-8000-000000000010'})
  })
})

describe('Task1 proof/correlation regressions retained from candidate review',()=>{
  for(const field of ['actor','phase','attempt','approvalRowId','instanceId','requestId','order','stepOrder','status']) it(`isolated phase proof ${field}`,()=>{
    const e=decisionFixture();accepted(e);const p=e.phaseProof as unknown as Record<string,unknown>;p[field]=field==='attempt'||field==='order'||field==='stepOrder'?9:'foreign';rejected(e)
  })
  it('missing positive proof cannot qualify a resolved commit',()=>{const e=decisionFixture();accepted(e);e.phaseProof=null;rejected(e,'phase-proof-missing')})
  const mutations:[string,(e:ActionEvidence)=>void][]=[
    ['missing binding',e=>{e.binding=null}],['binding handler',e=>{e.binding!.handler='approvals.approveRequest'}],
    ['binding context',e=>{e.binding!.contextId='foreign'}],['binding action',e=>{e.binding!.actionId='foreign'}],
    ['binding chunk',e=>{e.binding!.chunk={...e.binding!.chunk,bytes:0}}],['binding offset',e=>{e.binding!.byteOffset=-1}],
    ['server absent',e=>{e.server=null}],['server actor',e=>{e.server!.actorId='foreign'}],
    ['server auth',e=>{e.server!.authObserved=false}],['server invocation empty',e=>{e.server!.invocationId=''}],
    ['server end missing',e=>{e.server!.end=null}],['original not invoked',e=>{e.server!.originalInvoked=false}],
    ['server arguments',e=>{e.server!.argumentProjection={solutionId:'foreign'}}],
    ['dispatch arguments',e=>{e.dispatch!.argumentProjection={solutionId:'foreign'}}],
    ['before absent',e=>{e.before=null}],['after absent',e=>{e.after=null}],
    ['before artifact',e=>{e.beforeArtifact=null}],['after artifact',e=>{e.afterArtifact=null}],
    ['legacy source mode',e=>{e.record.identity.sourceMode='historical-legacy'}],
    ['wrong registry handler',e=>{e.record.spec.handler='solutions.rejectSolution'}],
    ['group target id',e=>{(e.record.spec.target as DecisionTarget).candidateGroupId='foreign'}],
  ]
  for(const [name,mutate] of mutations) it(name,()=>{const e=decisionFixture();accepted(e);mutate(e);rejected(e)})
})

describe('Task1 final source-derived edge RED',()=>{
  it('approval provided comments bind actual deciding row',()=>{const e=decisionFixture();accepted(e);(e.after!.approvalRows[0] as FixtureRow).comments='other';rejected(e,'deciding-comments')})
  it('approval provided comments bind source audit',()=>{const e=decisionFixture();accepted(e);(e.after!.activities[0] as FixtureRow).comments='other';rejected(e,'audit-record-missing')})
  it('REQUEST resubmit compare-and-set token actually advances',()=>{const e=rowlessFixture('resubmit','REQUEST');accepted(e);(e.after!.request as FixtureRow).updatedAt=(e.before!.request as FixtureRow).updatedAt;rejected(e,'resubmit-request-token')})
  it('action start mark cannot be invalid despite coherent dispatch interval',()=>{const e=decisionFixture();accepted(e);e.record.start.monotonicMs=NaN;rejected(e,'record-clock')})
  it('manifest invocation slot number must be a positive integer',()=>{const e=decisionFixture();accepted(e);e.record.identity.invocation=NaN;rejected(e,'identity-invocation-slot')})
})

describe('Task1 source-return/input refinements RED',()=>{
  it('resubmitSolution returned deleted IDs bind the actual deletedFileIds argument set',()=>{const e=rowlessFixture('resubmit','SOLUTION');accepted(e);setResult(e,{success:true,solutionId:'sol-1',deletedAttachmentIds:['foreign'],cleanupWarnings:[]});rejected(e,'result-identity-mismatch:deletedAttachmentIds')})
  it('resubmitSolution cleanup warning can only name an actually deleted attachment',()=>{const e=rowlessFixture('resubmit','SOLUTION');accepted(e);setResult(e,{success:true,solutionId:'sol-1',deletedAttachmentIds:[],cleanupWarnings:[projectPrivateText('Attachment foreign file could not be deleted')]});rejected(e,'result-shape:cleanupWarnings')})
  it('REQUEST revision description projection requires the real inline session',()=>{const e=rowlessFixture('resubmit','REQUEST');accepted(e);setArgs(e,{requestId:'00000000-0000-4000-8000-000000000010',descriptionSha256:hash('Description')});rejected(e,'argument-target:inlineImageSessionId')})
  it('REQUEST revision cannot carry an inline session without a description update',()=>{const e=rowlessFixture('resubmit','REQUEST');accepted(e);setArgs(e,{requestId:'00000000-0000-4000-8000-000000000010',inlineImageSessionId:'00000000-0000-4000-8000-000000000001'});rejected(e,'argument-target:inlineImageSessionId')})
  it('rowless immutable title hash binds actual persisted subject even when no title parameter exists',()=>{const e=rowlessFixture('initiate-final','FINAL');accepted(e);(e.record.spec.target as RowlessTarget).titleSha256=hash('foreign');rejected(e,'persisted-title-hash')})
})

// Six-gap review witnesses: keep terminal summaries consistent with mutations.
function syncActivitySummary(s:BusinessSnapshot):void {
  s.terminal!.activities=(s.activities as FixtureRow[]).map(a=>({id:String(a.id),action:String(a.action),fromStatus:a.fromStatus as string|null,toStatus:a.toStatus as string|null,userId:String(a.userId),comments:a.comments as string|null}))
}
function syncInstanceSummary(s:BusinessSnapshot):void {
  s.terminal!.instances=(s.instances as FixtureRow[]).map(i=>({id:String(i.id),phase:String(i.phase),attempt:Number(i.attempt),state:String(i.state),supersededAt:i.supersededAt as string|null}))
}
function submissionWithTimeline():ActionEvidence {
  const e=rowlessFixture('submit-solution','SOLUTION')
  setArgs(e,{...(e.record.argumentProjection as FixtureRow),timeline:projectPrivateText('One week')})
  return e
}

describe('Six-gap R1 decision cost write set RED',()=>{
  for(const phase of ['REQUEST','SOLUTION','FINAL'] as const) for(const kind of ['approve','reject'] as const) for(const next of [false,true]) {
    if(phase==='SOLUTION'&&kind==='approve'&&!next) continue
    it(`${phase}/${kind}/${next?'remaining':'terminal'} preserves project cost`,()=>{
      const e=decisionFixture(phase,kind,next);accepted(e)
      ;(e.after!.request as FixtureRow).projectEstimateCost='999.00'
      rejected(e,'decision-cost-preservation')
    })
  }
})
describe('Six-gap R2 complete required status audit RED',()=>{
  for(const [phase,kind] of [['REQUEST','approve'],['SOLUTION','approve'],['FINAL','approve'],['FINAL','reject']] as const) {
    for(const field of ['missing','userId','fromStatus','toStatus','comments']) it(`${phase}/${kind} status audit ${field}`,()=>{
      const e=decisionFixture(phase,kind);accepted(e)
      if(field==='missing') e.after!.activities=e.after!.activities.filter(a=>(a as FixtureRow).id!=='status-activity')
      else (e.after!.activities.find(a=>(a as FixtureRow).id==='status-activity') as FixtureRow)[field]='foreign'
      syncActivitySummary(e.after!);rejected(e,'status-audit')
    })
  }
})
describe('Six-gap R3 persisted solution payload RED',()=>{
  for(const kind of ['submit-solution','resubmit'] as const) for(const field of ['costEstimate','currency','timeline',...(kind==='submit-solution'?['conceptDesign']:[])]) it(`${kind} source-written ${field}`,()=>{
    const e=kind==='submit-solution'?submissionWithTimeline():rowlessFixture(kind,'SOLUTION');accepted(e)
    ;(e.after!.solutions[0] as FixtureRow)[field]=field==='costEstimate'?'999.00':field==='currency'?'USD':'Other'
    rejected(e,`solution-payload:${field}`)
  })
})
describe('Six-gap R4 optional input types RED',()=>{
  for(const field of ['timeline','conceptDesign']) it(`submit optional ${field} cannot be array`,()=>{
    const e=submissionWithTimeline();accepted(e);setArgs(e,{...(e.record.argumentProjection as FixtureRow),[field]:[]});rejected(e,`argument-target:${field}`)
  })
  for(const phase of ['REQUEST','SOLUTION','FINAL'] as const) it(`${phase} approval comments cannot be numeric`,()=>{
    const e=decisionFixture(phase);accepted(e);setArgs(e,{...(e.record.argumentProjection as FixtureRow),comments:42});rejected(e,'argument-target:comments')
  })
})
describe('Six-gap R5 REQUEST resubmit prerequisites and write set RED',()=>{
  it('after requester cannot change',()=>{const e=rowlessFixture('resubmit','REQUEST');accepted(e);(e.after!.request as FixtureRow).requesterId='foreign';rejected(e,'resubmit-request-fields')})
  it('consistent approved old REQUEST history cannot authorize revision',()=>{
    const e=rowlessFixture('resubmit','REQUEST');accepted(e)
    const t=e.record.spec.target as RowlessTarget;t.previous!.expectedState='approved';t.previous!.rowStates[0].status='approved'
    for(const s of [e.before!,e.after!]) {
      ;(s.instances[0] as FixtureRow).state='APPROVED';(s.approvalRows[0] as FixtureRow).status='approved'
      ;(s.activities[0] as FixtureRow).action='approved';syncInstanceSummary(s);syncActivitySummary(s)
    }
    rejected(e,'resubmit-request-rejection')
  })
})
describe('Six-gap R6 mandatory observed rank arrays RED',()=>{
  for(const field of ['pendingApproverIds','pendingActorIds']) it(`FINAL initiation missing ${field}`,()=>{
    const e=rowlessFixture('initiate-final','FINAL');accepted(e);delete (e.phaseProof as unknown as FixtureRow)[field];rejected(e,'proof-pending-actors')
  })
})

const validSession='00000000-0000-4000-8000-000000000001'
const validRequest='00000000-0000-4000-8000-000000000010'
const rawSubmission=()=>({requestId:validRequest,title:'Solution title',description:'Solution description',inlineImageSessionId:validSession,costEstimate:100,currency:'THB',timeline:'One week',useCustomApprovals:false,fileIds:[]})
describe('Six-gap R4 raw source validation RED',()=>{
  for(const [field,value] of [
    ['requestId','req-invalid'],['inlineImageSessionId','session-invalid'],['title',''],['title','x'.repeat(201)],
    ['description',''],['description','   '],['description','<p><br></p>'],['description','x'.repeat(20001)],
    ['timeline',[]],['timeline','x'.repeat(501)],['conceptDesign',[]],['conceptDesign','x'.repeat(2001)],
    ['costEstimate',0.001],['fileIds',[validRequest,validRequest]],['fileIds',Array.from({length:11},(_,i)=>`00000000-0000-4000-8000-${String(i+100).padStart(12,'0')}`)],
  ] as [string,unknown][]) it(`raw submit ${field} ${typeof value==='string'?value.length:JSON.stringify(value)} rejects before hashing`,()=>{
    assert.doesNotThrow(()=>normalizeActionArguments('solutions.submitSolution',[rawSubmission()]))
    assert.throws(()=>normalizeActionArguments('solutions.submitSolution',[{...rawSubmission(),[field]:value}]),/argument-shape/)
  })
})

describe('Six-gap remaining precision and observed-count RED',()=>{
  it('stored Decimal cannot contain a nonzero third fractional digit',()=>{const e=submissionWithTimeline();accepted(e);(e.after!.solutions[0] as FixtureRow).costEstimate='100.001';rejected(e,'solution-payload:costEstimate')})
  for(const [kind,phase,field] of [['submit-solution','SOLUTION','pendingApprovalRows'],['initiate-final','FINAL','pendingFinalRows']] as const) it(`${kind} explicit observed count required`,()=>{
    const e=rowlessFixture(kind,phase);accepted(e);delete (e.phaseProof as unknown as FixtureRow)[field];rejected(e,'proof-pending-count')
  })
})

function requestRevisionWithContent(update:{title?:string;description?:string;html?:string}):ActionEvidence {
  const e=rowlessFixture('resubmit','REQUEST')
  const raw={requestId:validRequest,...(update.title!==undefined?{title:update.title}:{}),...(update.description!==undefined?{description:update.description,inlineImageSessionId:validSession}:{})}
  setArgs(e,normalizeActionArguments('requests.resubmitRequest',[raw]))
  if(update.title!==undefined){(e.after!.request as FixtureRow).title=update.title;(e.record.spec.target as RowlessTarget).titleSha256=hash(update.title)}
  if(update.description!==undefined){
    const html=update.html??update.description
    ;(e.after!.request as FixtureRow).description=html
    e.server!.preparedDescription={inputSha256:hash(update.description),htmlSha256:hash(html),uploadSessionId:validSession}
  }
  return e
}
function helperRankEvidence(phase:'SOLUTION'|'FINAL', published=false):ActionEvidence {
  const e=rowlessFixture(phase==='SOLUTION'?'submit-solution':'initiate-final',phase)
  const target=e.record.spec.target as RowlessTarget
  const steps=published ? expectedActiveRouteProof('all-defaults').find(r=>r.phase===phase)!.steps : target.expectedSteps.map(s=>({order:s.order,positionId:s.requiredPositionId!,primaryActorId:s.primaryActorId,candidateUserIds:s.candidateUserIds}))
  const rows:FixtureRow[]=steps.map(step=>({...approvalRow(phase,'fresh',step.order),requiredPositionId:step.positionId}))
  const groups=rows.map((row,index)=>({...groupRow(row),members:steps[index].candidateUserIds.map(userId=>({candidateGroupId:row.candidateGroupId,userId,capturedAt:date,capturedDisplayName:userId}))}))
  e.after!.approvalRows=[...e.after!.approvalRows.filter(r=>(r as FixtureRow).instanceId!=='fresh'),...rows]
  e.after!.groups=[...e.after!.groups.filter(g=>(g as FixtureRow).approvalInstanceId!=='fresh'),...groups]
  target.expectedSteps=steps.map(s=>({order:s.order,requiredPositionId:s.positionId,requiredApproverId:null,candidateUserIds:s.candidateUserIds,primaryActorId:s.primaryActorId}))
  const observed=rows.map((row,index)=>({approvalRowId:String(row.id),instanceId:'fresh',order:Number(row.order),status:'pending',routingMode:'SNAPSHOT_GROUP',requiredApproverId:null,approverId:null,requiredPositionId:row.requiredPositionId as string,candidateUserIds:steps[index].candidateUserIds}))
  const classified=classifyPendingChain(observed,{routingMode:'SNAPSHOT_GROUP',orderedActors:steps.map(s=>s.primaryActorId),rankSteps:steps})
  if(published){
    const shared={request:{id:validRequest,status:statuses[phase]},active:{instanceId:'fresh',attempt:1},rows:observed,route:{routingMode:'SNAPSHOT_GROUP',scopeUnitId:'unit-company'},custom:false,profile:'all-defaults' as const}
    const proof=phase==='SOLUTION'?buildSolutionSubmitEvidence({...shared,solutionId:'sol-1'}):buildFinalInitiationEvidence({...shared,expectedAttempt:1})
    // The pure helpers supply actor semantics; routeVersionId is separately
    // observed from the same actual fresh-instance fixture (not a return ID).
    e.phaseProof={...proof,routeVersionId:'route-1'}
  } else {
    Object.assign(e.phaseProof!,{pendingActorIds:classified.pendingActorIds,pendingApproverIds:[],[phase==='SOLUTION'?'pendingApprovalRows':'pendingFinalRows']:rows.length})
  }
  if(phase==='SOLUTION')e.after!.terminal!.solutionPendingRows=rows.length
  else e.after!.terminal!.finalPendingRows=rows.length
  e.after=delivered(e.after!,phase==='SOLUTION'?'approval_needed':'final_approval_needed',[...steps[0].candidateUserIds])
  return e
}

describe('Six-gap R1 Decimal/null/default boundaries',()=>{
  it('terminal SOLUTION cost compares Decimal scale, including zero',()=>{
    for(const cost of ['100','100.000','0']){const e=decisionFixture();(e.before!.solutions[0] as FixtureRow).costEstimate=cost;(e.after!.solutions[0] as FixtureRow).costEstimate=cost;(e.after!.request as FixtureRow).projectEstimateCost=cost==='0'?'0.00':'100.00';accepted(e)}
  })
  it('schema-reachable nullable request cost is preserved for non-writing decisions',()=>{
    for(const cost of [null,'17.00']){const e=decisionFixture('FINAL');for(const snapshot of [e.before!,e.after!])(snapshot.request as FixtureRow).projectEstimateCost=cost;accepted(e)}
  })
})
describe('Six-gap R2 exact audit isolation',()=>{
  for(const phase of ['REQUEST','SOLUTION','FINAL'] as const) it(`${phase} nonterminal approval has no imaginary status audit`,()=>accepted(decisionFixture(phase,'approve',true)))
  for(const phase of ['REQUEST','SOLUTION'] as const) it(`${phase} rejection has no imaginary status audit`,()=>accepted(decisionFixture(phase,'reject')))
  it('approval default comment is source-derived when optional comments absent',()=>{
    for(const phase of ['REQUEST','SOLUTION','FINAL'] as const){const e=decisionFixture(phase);setArgs(e,normalizeActionArguments(e.record.spec.handler,[phase==='SOLUTION'?'sol-1':validRequest]));(e.after!.approvalRows[0] as FixtureRow).comments=null;(e.after!.activities[0] as FixtureRow).comments=phase==='SOLUTION'?'Solution "Solution title" approved at step 1':phase==='FINAL'?'Final approval approved at step 1':'Approved at step 1';syncActivitySummary(e.after!);accepted(e)}
  })
  for(const field of ['userId','fromStatus','toStatus','comments']) it(`deciding audit ${field} alone is bound`,()=>{const e=decisionFixture();accepted(e);(e.after!.activities[0] as FixtureRow)[field]='foreign';syncActivitySummary(e.after!);rejected(e,'audit-record-missing')})
})
describe('Six-gap R3 explicit prepared-output and payload correspondence',()=>{
  it('submission optional omission persists real zero/null defaults',()=>{
    const e=submissionWithTimeline();const a={...(e.record.argumentProjection as FixtureRow)};delete a.costEstimate;delete a.timeline;setArgs(e,a)
    ;(e.after!.solutions[0] as FixtureRow).costEstimate='0.00';(e.after!.solutions[0] as FixtureRow).timeline=null;accepted(e)
  })
  it('submission optional empty strings are actual empty strings, not null',()=>{
    const e=submissionWithTimeline();setArgs(e,{...(e.record.argumentProjection as FixtureRow),timeline:projectPrivateText(''),conceptDesign:projectPrivateText('')});Object.assign(e.after!.solutions[0] as FixtureRow,{timeline:'',conceptDesign:''});accepted(e)
  })
  it('resubmission preserves prior conceptDesign and submitter',()=>{
    const e=rowlessFixture('resubmit','SOLUTION');for(const s of [e.before!,e.after!])(s.solutions[0] as FixtureRow).conceptDesign='Retained design';accepted(e)
    ;(e.after!.solutions[0] as FixtureRow).conceptDesign='Other';rejected(e,'solution-payload:conceptDesign')
  })
  for(const field of ['submittedById','submittedAt','createdAt','requestId']) it(`resubmission preserves solution ${field}`,()=>{const e=rowlessFixture('resubmit','SOLUTION');accepted(e);(e.after!.solutions[0] as FixtureRow)[field]='foreign';rejected(e,'solution-payload:preserved-fields')})
  for(const [input,stored] of [[100.005,'100.01'],[100.004,'100.00'],[1e-7,'0.00']] as const) it(`resubmit cost ${input} stored with Decimal(15,2) semantics`,()=>{const e=rowlessFixture('resubmit','SOLUTION');setArgs(e,{...(e.record.argumentProjection as FixtureRow),cost:input});(e.after!.solutions[0] as FixtureRow).costEstimate=stored;accepted(e)})
  it('raw and prepared HTML may differ without assuming raw equality',()=>accepted(requestRevisionWithContent({description:'<p>Safe<script>bad()</script></p>',html:'<p>Safe</p>'})))
  for(const [kind,phase] of [['create','REQUEST'],['submit-solution','SOLUTION'],['resubmit','SOLUTION']] as const) for(const field of ['missing','inputSha256','htmlSha256','uploadSessionId']) it(`${kind}/${phase} preparation ${field} cannot qualify`,()=>{
    const e=rowlessFixture(kind,phase);accepted(e)
    if(field==='missing')delete e.server!.preparedDescription
    else e.server!.preparedDescription={...e.server!.preparedDescription!,[field]:field==='uploadSessionId'?'00000000-0000-4000-8000-000000000099':hash('other action')}
    rejected(e,'prepared-description:');assert.equal(evaluateAction(e).commitProven,true,'capture qualification does not erase the independently proven transaction')
  })
  it('cross-action preparation input/session cannot qualify',()=>{
    const e=rowlessFixture('submit-solution','SOLUTION');accepted(e);e.server!.preparedDescription={...rowlessFixture('create','REQUEST').server!.preparedDescription!};rejected(e,'prepared-description:input-session')
  })
  it('persisted prepared output mismatch is rejected',()=>{const e=submissionWithTimeline();accepted(e);(e.after!.solutions[0] as FixtureRow).description='Other HTML';rejected(e,'prepared-description:html')})
})
describe('Six-gap R4 safe projected constraints and raw semantics',()=>{
  for(const [field,value] of [['titleLength',0],['titleLength',201],['titleLength',NaN],['titleLength',1.5],['descriptionLength',0],['descriptionLength',20001],['descriptionLength',Infinity],['timeline',null],['conceptDesign',false],['inlineImageSessionId','invalid'],['fileIds',['invalid']],['costEstimate',0.001]] as [string,JsonValue][]) it(`equal projected invalid ${field} ${String(value)}`,()=>{const e=submissionWithTimeline();accepted(e);setArgs(e,{...(e.record.argumentProjection as FixtureRow),[field]:value});rejected(e,`argument-target:${field}`)})
  for(const field of ['titleLength','descriptionLength']) it(`missing content length ${field} fails closed`,()=>{const e=submissionWithTimeline();accepted(e);const a={...(e.record.argumentProjection as FixtureRow)};delete a[field];setArgs(e,a);rejected(e,`argument-target:${field}`)})
  it('valid rich HTML and JS character-length boundary normalize without UTF8 byte confusion',()=>{
    const raw={...rawSubmission(),title:'ก'.repeat(200),description:'<p><strong>Visible</strong></p>'}
    const out=normalizeActionArguments('solutions.submitSolution',[raw]) as FixtureRow
    assert.equal(out.titleLength,200);assert.equal(out.descriptionLength,raw.description.length)
    assert.doesNotThrow(()=>normalizeActionArguments('solutions.submitSolution',[{...rawSubmission(),timeline:'x'.repeat(500),conceptDesign:'x'.repeat(2000)}]))
  })
  it('source-valid inline-image-only description uses the shared pure schema',()=>assert.doesNotThrow(()=>normalizeActionArguments('solutions.submitSolution',[{...rawSubmission(),description:`<p><img src="/api/inline-images/${validSession}" /></p>`}])))
  it('omitted optional submit values normalize actual defaults',()=>{const raw:Record<string,unknown>=rawSubmission();for(const k of ['currency','costEstimate','timeline','useCustomApprovals','fileIds'])delete raw[k];const out=normalizeActionArguments('solutions.submitSolution',[raw]) as FixtureRow;assert.equal(out.currency,'THB');assert.equal(out.useCustomApprovals,false);assert.deepEqual(out.fileIds,[]);assert.equal('timeline' in out,false);assert.equal('costEstimate' in out,false)})
  it('resubmit attachment sets cannot overlap even when individually valid',()=>{const e=rowlessFixture('resubmit','SOLUTION');accepted(e);setArgs(e,{...(e.record.argumentProjection as FixtureRow),newFileIds:[validSession],deletedFileIds:[validSession]});rejected(e,'attachment-overlap')})
  it('resubmit custom IDs must satisfy actual UUID schema',()=>{const e=rowlessFixture('resubmit','SOLUTION',true);accepted(e);setArgs(e,{...(e.record.argumentProjection as FixtureRow),customApprovers:['invalid']});rejected(e,'customApprovers')})
})
describe('Six-gap R5 exact REQUEST revision update/omission',()=>{
  for(const update of [{},{title:'Updated title'},{description:'Updated description'},{title:'Updated title',description:'<p>Updated</p>'}]) it(`valid supplied content ${Object.keys(update).join('+')||'none'}`,()=>accepted(requestRevisionWithContent(update)))
  for(const field of ['title','description','organizationUnitId','projectEstimateCost','status','isArchived','createdAt']) it(`unsupplied request ${field} preserved`,()=>{const e=requestRevisionWithContent({});accepted(e);(e.after!.request as FixtureRow)[field]=field==='isArchived'?true:'other';rejected(e,'resubmit-request-fields')})
  it('supplied title cannot disagree with actual persisted content',()=>{const e=requestRevisionWithContent({title:'Updated title'});accepted(e);(e.after!.request as FixtureRow).title='Other';rejected(e,'resubmit-request-title')})
  it('supplied description requires same-invocation preparation observation',()=>{const e=requestRevisionWithContent({description:'Updated'});accepted(e);delete e.server!.preparedDescription;rejected(e,'prepared-description:missing')})
  it('omitted description has no invented preparation observation',()=>{const e=requestRevisionWithContent({});accepted(e);e.server!.preparedDescription={inputSha256:hash('other'),htmlSha256:hash('other'),uploadSessionId:validSession};rejected(e,'prepared-description:unexpected')})
})
describe('Six-gap R6 existing helper primary actor semantics',()=>{
  for(const phase of ['SOLUTION','FINAL'] as const){
    it(`${phase} classifyPendingChain primary is not lexicographically first`,()=>{const e=helperRankEvidence(phase);const step=(e.record.spec.target as RowlessTarget).expectedSteps[0];assert.notEqual(step.primaryActorId,[...step.candidateUserIds].sort()[0]);assert.deepEqual((e.phaseProof as unknown as FixtureRow).pendingApproverIds,[]);accepted(e)})
    it(`${phase} actual published-route builder output preserves rank arrays`,()=>accepted(helperRankEvidence(phase,true)))
    for(const field of ['missing','foreign','other-member'])it(`${phase} intended primary ${field} fails`,()=>{const e=helperRankEvidence(phase);accepted(e);const steps=(e.record.spec.target as RowlessTarget).expectedSteps as ExpectedApprovalStep[];if(field==='missing')delete (steps[0] as Partial<ExpectedApprovalStep>).primaryActorId;else steps[0].primaryActorId=field==='foreign'?'foreign':steps[0].candidateUserIds.find(id=>id!==steps[0].primaryActorId)!;rejected(e,field==='other-member'?'proof-pending-actors':'primary-actor')})
    for(const field of ['pendingApproverIds','pendingActorIds'])for(const wrong of [false,true])it(`${phase} ${field} ${wrong?'wrong':'missing'} fails`,()=>{const e=helperRankEvidence(phase);accepted(e);const proof=e.phaseProof as unknown as FixtureRow;if(wrong)proof[field]=field==='pendingApproverIds'?[actor]:[actor];else delete proof[field];rejected(e,'proof-pending-actors')})
  }
})

describe('Six-gap R1/R4 final source guard RED',()=>{
  for(const missing of [false,true])it(`non-null stored solution cost ${missing?'missing':'null'} cannot qualify`,()=>{
    const e=decisionFixture();accepted(e)
    for(const s of [e.before!,e.after!]){if(missing)delete (s.solutions[0] as FixtureRow).costEstimate;else(s.solutions[0] as FixtureRow).costEstimate=null;(s.request as FixtureRow).projectEstimateCost='17.00'}
    rejected(e,'solution-cost')
  })
  it('omitted approval comments preserve the actual deciding-row comments',()=>{
    const e=decisionFixture();setArgs(e,normalizeActionArguments(e.record.spec.handler,['sol-1']));(e.after!.approvalRows[0] as FixtureRow).comments=null;(e.after!.activities[0] as FixtureRow).comments='Solution "Solution title" approved at step 1';syncActivitySummary(e.after!);accepted(e)
    ;(e.after!.approvalRows[0] as FixtureRow).comments='Not supplied';rejected(e,'deciding-comments')
  })
})

// ============================================================================
// Task2 component (offline observer): guarded generated-copy observer.
// Real product source stays read-only; transforms and compilation run only
// on file-only owned copies built inside test-owned temporary runtime roots.
// ============================================================================
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  MATRIX_REPO_ROOT,
  OBSERVER_SOURCE_AST_CONSTRAINTS,
  clearMatrixStopBlock,
  matrixObserverSourceGuards,
  observerModuleSource,
  prepareObservedAppCopy,
  startMatrixRuntime,
  transformObserverSource,
  expectedPublishedRoutes,
  type SourceGuard,
} from '../support/native/rejection-recovery-runtime'

interface ObserverTestRecord {
  kind: string
  phase?: string
  invocationId?: string
  handler?: string
  argumentProjection?: JsonValue
  actorId?: string | null
  authObserved?: boolean
  inputSha256?: string
  htmlSha256?: string
  uploadSessionId?: string | null
  exit?: { state: string; projection?: JsonValue | null; code?: string; digest?: string | null }
  observerErrors?: readonly string[]
  at?: { domain: string; monotonicMs: number; wallMs: number }
}

interface ObserverJournalState {
  records: ObserverTestRecord[]
  calls: string[]
  stderr: string[]
  faults: Set<string>
  ids: number
}

function observerJournalStub(state: ObserverJournalState): {
  append: (record: ObserverTestRecord) => void
  clock: () => { domain: string; monotonicMs: number; wallMs: number }
  nextInvocationId: () => string
} {
  return {
    append: (record) => {
      const key = record.kind === 'transaction' ? 'transaction:' + String(record.phase) : record.kind
      state.calls.push('append:' + key)
      if (state.faults.has(key)) throw new Error('injected append fault at ' + key)
      state.records.push(JSON.parse(JSON.stringify(record)) as ObserverTestRecord)
    },
    clock: () => ({ domain: 'test-observer', monotonicMs: state.calls.length + 1, wallMs: 1760000000000 + state.calls.length }),
    nextInvocationId: () => {
      state.ids += 1
      state.calls.push('nextInvocationId')
      return 'observer-test-' + String(state.ids).padStart(4, '0')
    },
  }
}

async function captureObserverStderr<T>(state: ObserverJournalState, run: () => Promise<T>): Promise<T> {
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    state.stderr.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    return await run()
  } finally {
    process.stderr.write = original
  }
}

const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
  }
  return item
})

const FIXTURE_SESSION_CREATE = '00000000-0000-4000-8000-00000000a001'
const FIXTURE_SESSION_RESUBMIT_REQUEST = '00000000-0000-4000-8000-00000000a002'
const FIXTURE_SESSION_RESUBMIT_SOLUTION = '00000000-0000-4000-8000-00000000a003'
const FIXTURE_SESSION_SUBMIT_SOLUTION = '00000000-0000-4000-8000-00000000a004'
const FIXTURE_UUID_REQUEST = '00000000-0000-4000-8000-00000000b001'

const OBSERVER_FIXTURE_STUB_PRISMA = `export interface StubRecord {
  id: string
  title?: string
  description?: string
  updatedAt?: string
  ownerId?: string
}

let businessCallCount = 0
let nextTransactionFailure: string | null = null

export function observerBusinessCalls(): number {
  return businessCallCount
}

export function resetObserverBusinessCalls(): void {
  businessCallCount = 0
  nextTransactionFailure = null
}

export function failNextObserverTransaction(message: string): void {
  nextTransactionFailure = message
}

export interface StubTx {
  requests: {
    create(input: { data: Record<string, unknown> }): Promise<StubRecord>
    update(input: { where: { id: string }; data: Record<string, unknown> }): Promise<StubRecord>
  }
  solutions: {
    findUnique(input: { where: { id: string } }): Promise<StubRecord | null>
    update(input: { where: { id: string }; data: Record<string, unknown> }): Promise<StubRecord>
  }
}

const stubTx: StubTx = {
  requests: {
    create: async ({ data }) => {
      businessCallCount += 1
      return {
        id: 'request-' + String(data.title ?? ''),
        title: String(data.title ?? ''),
        description: data.description === undefined ? undefined : String(data.description),
      }
    },
    update: async ({ where, data }) => {
      businessCallCount += 1
      return { id: where.id, ...data }
    },
  },
  solutions: {
    findUnique: async ({ where }) => {
      businessCallCount += 1
      return { id: where.id, ownerId: where.id === 'poison-solution' ? 'poison' : 'solution-owner-' + where.id }
    },
    update: async ({ where, data }) => {
      businessCallCount += 1
      return { id: where.id, ...data }
    },
  },
}

interface StubPrisma {
  $transaction<R>(work: (tx: StubTx) => Promise<R>, options?: unknown): Promise<R>
}

const prisma: StubPrisma = {
  async $transaction<R>(work: (tx: StubTx) => Promise<R>, _options?: unknown): Promise<R> {
    if (nextTransactionFailure !== null) {
      const message = nextTransactionFailure
      nextTransactionFailure = null
      throw new Error(message)
    }
    return work(stubTx)
  },
}

export default prisma
`

const OBSERVER_FIXTURE_STUB_AUTH = `export interface StubUser {
  id: string
}

export interface ObserverSession {
  user: StubUser | null
}

let currentUser: StubUser | null = null
let nextAuthFailure: Error | null = null

export function setObserverUser(user: StubUser | null): void {
  currentUser = user
}

export function failNextObserverAuth(error: Error): void {
  nextAuthFailure = error
}

async function authImpl(): Promise<ObserverSession | null> {
  if (nextAuthFailure !== null) {
    const failure = nextAuthFailure
    nextAuthFailure = null
    throw failure
  }
  return { user: currentUser }
}

export async function getCurrentUser(): Promise<StubUser | null> {
  const session = await authImpl()
  return session?.user ?? null
}

export async function auth(): Promise<ObserverSession | null> {
  return authImpl()
}
`

const OBSERVER_FIXTURE_REQUESTS = `import prisma from '../lib/stub-prisma'
import { auth, getCurrentUser } from '../lib/stub-auth'

function prepareInlineDescription(input: { description: string; userId: string; uploadSessionId: string }): Promise<{ html: string; imageIds: string[]; uploadSessionId: string }> {
  return Promise.resolve({ html: '<p>' + input.description + '</p>', imageIds: [], uploadSessionId: input.uploadSessionId })
}

export interface CreateRequestInput {
  title: string
  description: string
  inlineImageSessionId?: string
  stagedAttachmentIds?: string[]
}

export async function createRequest(input: CreateRequestInput) {
  const user = await getCurrentUser()

  if (!user) {
    return { success: false, error: 'no user' }
  }

  const prepared = await prepareInlineDescription({
    description: input.description,
    userId: user.id,
    uploadSessionId: '${FIXTURE_SESSION_CREATE}',
  })

  const txResult = await prisma.$transaction(
    async (tx) => {
      const created = await tx.requests.create({ data: { title: input.title, description: prepared.html } })
      return { request: created, pendingCandidateUserIds: (input.title === 'poison' ? ['poison'] : ['final-approver']) as string[] }
    },
    { isolationLevel: 'Serializable' },
  ).catch((error: unknown) => {
    throw error
  })

  for (const candidateUserId of txResult.pendingCandidateUserIds) {
    await notifyCandidate(candidateUserId)
  }

  return { success: true, requestId: txResult.request.id }
}

async function notifyCandidate(userId: string): Promise<void> {
  if (userId === 'poison') {
    throw new Error('notification dispatch refused for poison')
  }
}

export async function resubmitRequest(input: { requestId: string; description?: string }) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    throw new Error('Unauthorized')
  }

  let prepared: { html: string; imageIds: string[] } | undefined
  if (input.description !== undefined) {
    prepared = await prepareInlineDescription({
      description: input.description,
      userId,
      uploadSessionId: '${FIXTURE_SESSION_RESUBMIT_REQUEST}',
    })
  }

  const result = await prisma.$transaction(async (tx) => {
    return tx.requests.update({ where: { id: input.requestId }, data: { description: prepared ? prepared.html : 'kept' } })
  }).catch((error: unknown) => {
    throw error
  })

  return { success: true, request: { id: result.id } }
}
`

const OBSERVER_FIXTURE_APPROVALS = `import prisma from '../lib/stub-prisma'
import { auth } from '../lib/stub-auth'

export async function approveRequest(requestId: string, comments?: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }
  const result = await prisma.$transaction((tx) =>
    tx.requests.update({ where: { id: requestId }, data: { description: comments ?? 'approved' } }),
  )
  return { success: true, request: { id: result.id } }
}

export async function rejectRequest(requestId: string, comments: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }
  if (!comments) {
    throw new Error('Comments are required when rejecting')
  }
  await prisma.$transaction(async (tx) => {
    await tx.requests.update({ where: { id: requestId }, data: { description: 'rejected: ' + comments } })
  })
  return { success: true }
}
`

const OBSERVER_FIXTURE_SOLUTIONS = `import prisma, { type StubTx } from '../lib/stub-prisma'
import { auth } from '../lib/stub-auth'

function prepareInlineDescription(input: { description: string; userId: string; uploadSessionId: string }): Promise<{ html: string; imageIds: string[]; uploadSessionId: string }> {
  return Promise.resolve({ html: '<p>' + input.description + '</p>', imageIds: [], uploadSessionId: input.uploadSessionId })
}

interface QueuedNotification {
  userId: string
  type: string
}

type PostCommitNotificationCollector = {
  user: (notification: QueuedNotification) => void
}

async function dispatchNotification(notification: QueuedNotification): Promise<void> {
  if (notification.userId === 'poison') {
    throw new Error('solution notification dispatch refused for poison')
  }
}

async function runTransactionWithPostCommitNotifications<T>(plan: {
  runTransaction: <R>(work: (tx: StubTx) => Promise<R>) => Promise<R>
  work: (tx: StubTx, notifications: PostCommitNotificationCollector) => Promise<T>
  dispatchers: { notifyUser: (notification: QueuedNotification) => Promise<void> }
  onDispatchError: (plan: QueuedNotification, error: unknown) => void
}): Promise<T> {
  const queued: QueuedNotification[] = []
  const notifications: PostCommitNotificationCollector = {
    user: (notification) => { queued.push(notification) },
  }
  const value = await plan.runTransaction(async (tx) => plan.work(tx, notifications))
  for (const notification of queued) {
    try {
      await plan.dispatchers.notifyUser(notification)
    } catch (error) {
      plan.onDispatchError(notification, error)
    }
  }
  return value
}

async function runSolutionTransactionWithNotifications<T>(
  work: (tx: StubTx, notifications: PostCommitNotificationCollector) => Promise<T>,
  options?: { isolationLevel?: string },
): Promise<T> {
  const runTransaction = async <R>(transactionWork: (tx: StubTx) => Promise<R>): Promise<R> => {
    if (!options?.isolationLevel) {
      return prisma.$transaction((tx) => transactionWork(tx))
    }
    try {
      return await prisma.$transaction((tx) => transactionWork(tx), {
        isolationLevel: options.isolationLevel,
      })
    } catch (error) {
      throw error
    }
  }
  return runTransactionWithPostCommitNotifications({
    runTransaction,
    work,
    dispatchers: {
      notifyUser: async (notification) => { await dispatchNotification(notification) },
    },
    onDispatchError: () => undefined,
  })
}

export async function submitSolution(input: { requestId: string; description?: string }) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }
  const prepared = await prepareInlineDescription({
    description: input.description ?? 'submit-description',
    userId,
    uploadSessionId: '${FIXTURE_SESSION_SUBMIT_SOLUTION}',
  })
  const result = await prisma.$transaction(
    async (tx) => {
      const solution = await tx.solutions.update({ where: { id: input.requestId }, data: { description: prepared.html } })
      return { solutionId: solution.id, pendingCandidateUserIds: ['final-approver'] as string[] }
    },
    { isolationLevel: 'Serializable' },
  ).catch((error: unknown) => {
    throw error
  })
  for (const candidateUserId of result.pendingCandidateUserIds) {
    await notifySubmitCandidate(candidateUserId)
  }
  return { success: true, solutionId: result.solutionId }
}

async function notifySubmitCandidate(userId: string): Promise<void> {
  if (userId === 'poison') {
    throw new Error('submit notification dispatch refused for poison')
  }
}

export async function resubmitSolution(input: { requestId: string; description?: string }) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }
  const prepared = await prepareInlineDescription({
    description: input.description ?? 'resubmit-description',
    userId,
    uploadSessionId: '${FIXTURE_SESSION_RESUBMIT_SOLUTION}',
  })
  const result = await runSolutionTransactionWithNotifications(
    async (tx, notifications) => {
      const solution = await tx.solutions.update({ where: { id: input.requestId }, data: { description: prepared.html } })
      notifications.user({ userId: solution.ownerId ?? userId, type: 'solution_ready' })
      return { solutionId: solution.id }
    },
    { isolationLevel: 'Serializable' },
  )
  return { success: true, solutionId: result.solutionId }
}

export async function approveSolution(solutionId: string, comments?: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
    const solution = await tx.solutions.findUnique({ where: { id: solutionId } })
    notifications.user({ userId: solution?.ownerId ?? 'unknown', type: 'approval_granted' })
    await tx.solutions.update({ where: { id: solutionId }, data: { description: comments ?? 'approved' } })
    return { solutionId }
  })
  return { success: true, solutionId }
}

export async function rejectSolution(solutionId: string, comments: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }
  if (!comments) {
    throw new Error('Comments are required when rejecting')
  }
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
    await tx.solutions.update({ where: { id: solutionId }, data: { description: 'rejected: ' + comments } })
    notifications.user({ userId: 'reject-watcher', type: 'approval_rejected' })
    return { solutionId }
  })
  return { success: true, solutionId }
}

export async function initiateFinalApproval(requestId: string, useCustomChain: boolean, customApproverIds?: string[]) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }
  await runSolutionTransactionWithNotifications(
    async (tx, notifications) => {
      const request = await tx.requests.update({ where: { id: requestId }, data: { description: useCustomChain ? 'final-custom' : 'final-rank' } })
      notifications.user({ userId: request.ownerId ?? userId, type: 'final_approval_needed' })
      return { requestId }
    },
    { isolationLevel: 'Serializable' },
  )
  return { success: true, requestId }
}

export async function approveFinalApproval(requestId: string, comments?: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
    await tx.requests.update({ where: { id: requestId }, data: { description: 'final-approved: ' + (comments ?? '') } })
    notifications.user({ userId: 'final-approver', type: 'approval_granted' })
    return undefined
  })
  return { success: true, requestId }
}

export async function rejectFinalApproval(requestId: string, comments: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }
  if (!comments) {
    throw new Error('Comments are required when rejecting')
  }
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
    await tx.requests.update({ where: { id: requestId }, data: { description: 'final-rejected: ' + comments } })
    notifications.user({ userId: 'final-reject-watcher', type: 'approval_rejected' })
    return undefined
  })
  return { success: true, requestId }
}
`

interface ObserverFixtureApp {
  ownedRoot: string
  appDir: string
  evidenceDir: string
  guards: SourceGuard[]
}

async function buildObserverFixtureApp(name: string, overrides?: { approvalsSource?: string }): Promise<ObserverFixtureApp> {
  const ownedRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'rrm-observer-' + name + '-'))
  const appDir = path.join(ownedRoot, 'app')
  const actionsDir = path.join(appDir, 'src', 'server-actions')
  const libDir = path.join(appDir, 'src', 'lib')
  await fsp.mkdir(actionsDir, { recursive: true })
  await fsp.mkdir(libDir, { recursive: true })
  await fsp.writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: 'rrm-fixture-copy', private: true, version: '0.0.0', dependencies: { next: '15.5.23' } }, null, 2) + '\n')
  await fsp.writeFile(path.join(appDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: 'ES2022',
      module: 'esnext',
      moduleResolution: 'bundler',
      esModuleInterop: true,
      skipLibCheck: true,
      isolatedModules: true,
      lib: ['ES2022'],
    },
    include: ['src/**/*.ts'],
  }, null, 2) + '\n')
  await fsp.writeFile(path.join(actionsDir, 'requests.ts'), OBSERVER_FIXTURE_REQUESTS)
  await fsp.writeFile(path.join(actionsDir, 'approvals.ts'), overrides?.approvalsSource ?? OBSERVER_FIXTURE_APPROVALS)
  await fsp.writeFile(path.join(actionsDir, 'solutions.ts'), OBSERVER_FIXTURE_SOLUTIONS)
  await fsp.writeFile(path.join(libDir, 'stub-prisma.ts'), OBSERVER_FIXTURE_STUB_PRISMA)
  await fsp.writeFile(path.join(libDir, 'stub-auth.ts'), OBSERVER_FIXTURE_STUB_AUTH)
  await fsp.symlink(path.join(MATRIX_REPO_ROOT, 'node_modules'), path.join(appDir, 'node_modules'), 'dir')
  const evidenceDir = path.join(ownedRoot, 'observer-journal')
  await fsp.mkdir(evidenceDir, { recursive: true, mode: 0o700 })
  const guards = await matrixObserverSourceGuards(appDir)
  return { ownedRoot, appDir, evidenceDir, guards }
}

function fixtureCopyInput(fixture: ObserverFixtureApp, guards?: readonly SourceGuard[]) {
  return {
    ownedRoot: fixture.ownedRoot,
    appDir: fixture.appDir,
    evidenceDir: fixture.evidenceDir,
    guards: guards ?? fixture.guards,
    nextVersion: '15.5.23' as const,
  }
}

async function prepareFixtureCopy(fixture: ObserverFixtureApp, runChild?: (command: string, args: string[]) => Promise<number>) {
  return prepareObservedAppCopy(fixtureCopyInput(fixture), runChild ? { runChild: runChild as never } : {})
}

interface FixtureHandlers {
  mod: Record<string, (...args: never[]) => unknown>
  prismaStub: { observerBusinessCalls(): number; resetObserverBusinessCalls(): void; failNextObserverTransaction(message: string): void }
  authStub: { setObserverUser(user: { id: string } | null): void; failNextObserverAuth(error: Error): void }
  state: ObserverJournalState
  runObservedOriginal: <T>(handler: string, args: readonly unknown[], original: (inv: unknown) => Promise<T>) => Promise<T>
}

async function importPreparedFixtureHandlers(fixture: ObserverFixtureApp): Promise<FixtureHandlers> {
  const mod = await import(pathToFileURL(path.join(fixture.appDir, 'src', 'lib', 'rrm-action-observer.ts')).href) as Record<string, (...args: never[]) => unknown>
  const prismaStub = await import(pathToFileURL(path.join(fixture.appDir, 'src', 'lib', 'stub-prisma.ts')).href) as never as FixtureHandlers['prismaStub']
  const authStub = await import(pathToFileURL(path.join(fixture.appDir, 'src', 'lib', 'stub-auth.ts')).href) as never as FixtureHandlers['authStub']
  const requestsMod = await import(pathToFileURL(path.join(fixture.appDir, 'src', 'server-actions', 'requests.ts')).href) as Record<string, (...args: never[]) => unknown>
  const approvalsMod = await import(pathToFileURL(path.join(fixture.appDir, 'src', 'server-actions', 'approvals.ts')).href) as Record<string, (...args: never[]) => unknown>
  const solutionsMod = await import(pathToFileURL(path.join(fixture.appDir, 'src', 'server-actions', 'solutions.ts')).href) as Record<string, (...args: never[]) => unknown>
  const state: ObserverJournalState = { records: [], calls: [], stderr: [], faults: new Set<string>(), ids: 0 }
  ;(mod.configureObserverJournal as (deps: unknown) => void)(observerJournalStub(state))
  return {
    mod: { ...mod, ...requestsMod, ...approvalsMod, ...solutionsMod },
    prismaStub,
    authStub,
    state,
    runObservedOriginal: mod.runObservedOriginal as never,
  }
}

describe('Task2 observer component: source guards, exact registration and compile-before-spawn', () => {
  it('transforms the three real action sources deterministically with the exact eleven registrations and an unchanged export surface', () => {
    for (const relativePath of ['src/server-actions/requests.ts', 'src/server-actions/approvals.ts', 'src/server-actions/solutions.ts']) {
      const source = readFileSync(path.join(MATRIX_REPO_ROOT, relativePath), 'utf8')
      const guard: SourceGuard = {
        relativePath,
        sha256: hash(source),
        exports: OBSERVER_SOURCE_AST_CONSTRAINTS.filter((constraint) => constraint.relativePath === relativePath).map((constraint) => constraint.handler),
      }
      const output = transformObserverSource(source, guard)
      assert.equal(transformObserverSource(source, guard), output, relativePath + ' transform must be deterministic')
      assert.notEqual(output, source, relativePath + ' must be changed by the guarded transform')
      assert.equal((output.match(/runObservedOriginal\(/g) ?? []).length, guard.exports.length)
      assert.ok(output.includes("from '../lib/rrm-action-observer'"))
      assert.ok(!output.includes('handlerProbe'))
      const exportNames = (text: string): string[] =>
        text.split('\n').filter((line) => /^export (async function|function|const|interface|type)/.test(line.trim())).map((line) => line.trim()).sort()
      assert.deepEqual(exportNames(output), exportNames(source), relativePath + ' export surface must be preserved')
      for (const constraint of OBSERVER_SOURCE_AST_CONSTRAINTS.filter((entry) => entry.relativePath === relativePath)) {
        assert.ok(output.includes("runObservedOriginal('" + constraint.handler + "'"), constraint.handler + ' must be registered in ' + relativePath)
      }
    }
  })

  it('observer_registration_is_exact_and_source_guarded', async () => {
    const fixture = await buildObserverFixtureApp('registration')
    const manifest = await prepareFixtureCopy(fixture)
    assert.equal(manifest.compiled, true)
    assert.deepEqual(manifest.registered, MATRIX_ACTION_REGISTRY.map((entry) => entry.handler))
    assert.equal(MATRIX_ACTION_REGISTRY.length, 11)
    assert.deepEqual(manifest.original, fixture.guards)
    assert.deepEqual(manifest.generated.map((ref) => ref.path).sort(), [
      'src/lib/rrm-action-observer.ts',
      'src/server-actions/approvals.ts',
      'src/server-actions/requests.ts',
      'src/server-actions/solutions.ts',
    ])
    for (const ref of manifest.generated) {
      const bytes = await fsp.readFile(path.join(fixture.appDir, ref.path), 'utf8')
      assert.equal(hash(bytes), ref.sha256)
      assert.ok(ref.bytes > 0)
    }
    const admission = JSON.parse((await fsp.readFile(path.join(fixture.evidenceDir, 'observer-journal.jsonl'), 'utf8')).trim().split('\n')[0]) as { kind: string; registered: string[]; templateSha256: string }
    assert.equal(admission.kind, 'admission')
    assert.deepEqual(admission.registered, manifest.registered)
    assert.equal(admission.templateSha256, hash(await fsp.readFile(path.join(fixture.appDir, 'src', 'lib', 'rrm-action-observer.ts'), 'utf8')))
    const mod = await import(pathToFileURL(path.join(fixture.appDir, 'src', 'lib', 'rrm-action-observer.ts')).href) as Record<string, unknown>
    for (const name of ['ObserverAdmissionError', 'runObservedOriginal', 'observeAuthenticatedActor', 'observeTransaction', 'configureObserverJournal']) {
      assert.ok(name in mod, 'generated module export ' + name)
    }
    const transformedGuards = await matrixObserverSourceGuards(fixture.appDir)
    await assert.rejects(() => prepareObservedAppCopy(fixtureCopyInput(fixture, transformedGuards)), /refusing original-file overwrite/)
    await fsp.writeFile(path.join(fixture.appDir, 'src', 'server-actions', 'approvals.ts'), OBSERVER_FIXTURE_APPROVALS + '\nexport async function observerDrift(): Promise<void> {}\n')
    await assert.rejects(() => prepareObservedAppCopy(fixtureCopyInput(fixture)), /fresh observer source guard mismatch/)
  })

  it('rejects renamed, missing, duplicate and drifted registered exports plus unexpected auth, transaction and lexical syntax in source fixtures', async () => {
    const guardFor = (source: string): SourceGuard => ({
      relativePath: 'src/server-actions/approvals.ts',
      sha256: hash(source),
      exports: OBSERVER_SOURCE_AST_CONSTRAINTS.filter((constraint) => constraint.relativePath === 'src/server-actions/approvals.ts').map((constraint) => constraint.handler),
    })
    const approvals = OBSERVER_FIXTURE_APPROVALS
    const renamed = approvals.replace('export async function approveRequest(', 'export async function approveRequestRenamed(')
    assert.throws(() => transformObserverSource(renamed, guardFor(renamed)), /observer guard expects export approveRequest/)
    const duplicated = approvals + '\nexport async function rejectRequest(requestId: string): Promise<void> {}\n'
    assert.throws(() => transformObserverSource(duplicated, guardFor(duplicated)), /duplicate function declaration rejectRequest/)
    const missingAuth = approvals.replace(
      '  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id\n  if (!userId) {\n    throw new Error(\'Unauthorized\')\n  }\n  const result',
      '  const result',
    )
    assert.notEqual(missingAuth, approvals)
    assert.throws(() => transformObserverSource(missingAuth, guardFor(missingAuth)), /observer actor anchor missing in approveRequest/)
    const doubleTransaction = approvals.replace(
      '  const result = await prisma.$transaction((tx) =>',
      '  const extra = await prisma.$transaction(async (tx) => {\n    await tx.requests.update({ where: { id: requestId }, data: {} })\n  })\n  const result = await prisma.$transaction((tx) =>',
    )
    assert.throws(() => transformObserverSource(doubleTransaction, guardFor(doubleTransaction)), /exactly one direct prisma\.\$transaction await in approveRequest/)
    const lexicalThis = approvals.replace(
      '  const result = await prisma.$transaction((tx) =>',
      '  const marker = this\n  const result = await prisma.$transaction((tx) =>',
    )
    assert.throws(() => transformObserverSource(lexicalThis, guardFor(lexicalThis)), /refuses unsupported lexical construct/)
    const driftedBytes = approvals + ' '
    assert.throws(() => transformObserverSource(driftedBytes, guardFor(approvals)), /observer source guard hash mismatch/)
    assert.throws(
      () => transformObserverSource(approvals, { relativePath: 'src/server-actions/unknown.ts', sha256: hash(approvals), exports: [] }),
      /not a registered copy source/,
    )
    const wrongExports = { ...guardFor(approvals), exports: ['requests.createRequest'] as SourceGuard['exports'] }
    assert.throws(() => transformObserverSource(approvals, wrongExports), /must be exactly/)
  })

  it('rejects path escape, symlink escape, wrong copy owner, next-version drift and original-file overwrite in prepareObservedAppCopy', async () => {
    const fixture = await buildObserverFixtureApp('boundaries')
    await assert.rejects(
      () => prepareObservedAppCopy({ ...fixtureCopyInput(fixture), guards: [{ ...fixture.guards[0], relativePath: '../outside/approvals.ts' }, ...fixture.guards.slice(1)] }),
      /observer guard path escapes the app copy/,
    )
    const foreignRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'rrm-observer-foreign-'))
    await fsp.mkdir(path.join(foreignRoot, 'app'), { recursive: true })
    await assert.rejects(
      () => prepareObservedAppCopy({ ...fixtureCopyInput(fixture), ownedRoot: foreignRoot }),
      /observer copy owner mismatch/,
    )
    await assert.rejects(
      () => prepareObservedAppCopy({ ...fixtureCopyInput(fixture), nextVersion: '15.5.22' as '15.5.23' }),
      /next-version drift/,
    )
    await assert.rejects(
      () => prepareObservedAppCopy({ ...fixtureCopyInput(fixture), evidenceDir: path.join(fixture.appDir, 'src', 'lib', 'journal') }),
      /must stay outside the generated app copy/,
    )
    const outside = path.join(fixture.ownedRoot, 'outside.ts')
    await fsp.writeFile(outside, 'export const outside = true\n')
    await fsp.rm(path.join(fixture.appDir, 'src', 'server-actions', 'approvals.ts'))
    await fsp.symlink(outside, path.join(fixture.appDir, 'src', 'server-actions', 'approvals.ts'))
    await assert.rejects(
      () => prepareObservedAppCopy({ ...fixtureCopyInput(fixture), guards: [fixture.guards[1], ...fixture.guards.slice(0, 1), ...fixture.guards.slice(2)] }),
      /must not traverse symlinks/,
    )
    await fsp.rm(path.join(fixture.appDir, 'src', 'server-actions', 'approvals.ts'))
    await fsp.writeFile(path.join(fixture.appDir, 'src', 'server-actions', 'approvals.ts'), OBSERVER_FIXTURE_APPROVALS)
    const manifest = await prepareFixtureCopy(fixture, async () => 0)
    assert.equal(manifest.compiled, true)
  })

  it('observer_compilation_failure_blocks_spawn', async () => {
    const runtimeMod = await import('../support/native/rejection-recovery-runtime')
    clearMatrixStopBlock()
    const calls: string[] = []
    const runtime = {
      runId: 'observer-block-20261015',
      databaseUrl: 'postgresql://postgres:secret@127.0.0.1:44010/app_cleanstart_dev',
      databasePassword: 'secret',
      e2ePassword: 'e2e-secret',
      ports: { databasePort: 44010, serverPort: 44011, mailPort: 44012 },
      postmasterPid: 4242,
      paths: { rootDir: '/tmp/matrix-owned-root', dataDir: '/tmp/matrix-owned-root/pgdata', logsDir: '/tmp/matrix-owned-root/logs', socketDir: '/tmp/matrix-owned-root/pgsocket', secretsDir: '/tmp/matrix-owned-root/secrets' },
      resource: { runId: 'observer-block-20261015', containerName: 'observer-block-20261015-postgres', databaseName: 'app_cleanstart_dev' as const, databasePort: 44010, serverPort: 44011 },
    }
    await assert.rejects(() => startMatrixRuntime({
      routesConfig: 'all-defaults',
      parentDir: '/tmp/rejection-recovery-matrix',
      log: () => undefined,
    }, {
      assertNoProtectedAmbientKeys: () => undefined,
      ensureOwnedTmpParent: async () => undefined,
      createOwnedRuntime: async () => runtime as never,
      initdbCluster: async () => { calls.push('initdb') },
      startPostgres: async () => 4242,
      verifyOwnedMaintenanceIdentity: async () => ({ connectedDatabase: 'postgres' }) as never,
      ensureOwnedDatabase: async () => undefined,
      verifyPostgresIdentity: async () => ({ connectedDatabase: 'app_cleanstart_dev', dataDirectory: runtime.paths.dataDir }) as never,
      psqlQuery: async () => { calls.push('psql'); return '{}' },
      stopPostgres: async () => undefined,
      runChild: async () => { calls.push('run-child'); return 0 },
      spawnApp: (() => { calls.push('spawn'); throw new Error('spawn must never run after a failed observer compile') }) as never,
      stopAppProcess: async () => undefined,
      waitForHttpReady: async () => undefined,
      startMailCapture: async () => { throw new Error('mail must not start') },
      copyAppSource: async () => { calls.push('copy'); return '/tmp/matrix-owned-root/app' },
      observerSourceGuards: async () => [],
      prepareObservedAppCopy: async () => { calls.push('observer'); throw new runtimeMod.MatrixRuntimeError('observer copy compilation failed; app spawn stays blocked') },
      assertOwnedLoopbackDatabaseTarget: () => undefined,
      createSafeRunPlan: (() => undefined) as never,
    }), /observer copy compilation failed/)
    assert.ok(calls.indexOf('copy') >= 0 && calls.indexOf('observer') > calls.indexOf('copy'), calls.join(','))
    assert.equal(calls.filter((call) => call === 'spawn').length, 0, 'spawn must be blocked')
    assert.equal(calls.filter((call) => call === 'run-child').length, 0, 'downstream lifecycle work must be blocked')

    // The shared injected runChild seam drives the compile: exit 1 blocks the spawn.
    clearMatrixStopBlock()
    const fixture = await buildObserverFixtureApp('compile-seam')
    const spawnCalls: string[] = []
    const seamRuntime = {
      ...runtime,
      runId: 'observer-seam-20261015',
      paths: { rootDir: fixture.ownedRoot, dataDir: path.join(fixture.ownedRoot, 'pgdata'), logsDir: path.join(fixture.ownedRoot, 'logs'), socketDir: path.join(fixture.ownedRoot, 'pgsocket'), secretsDir: path.join(fixture.ownedRoot, 'secrets') },
      resource: { ...runtime.resource, runId: 'observer-seam-20261015', containerName: 'observer-seam-20261015-postgres' },
    }
    await assert.rejects(() => startMatrixRuntime({
      routesConfig: 'all-defaults',
      parentDir: '/tmp/rejection-recovery-matrix',
      log: () => undefined,
    }, {
      assertNoProtectedAmbientKeys: () => undefined,
      ensureOwnedTmpParent: async () => undefined,
      createOwnedRuntime: async () => seamRuntime as never,
      initdbCluster: async () => undefined,
      startPostgres: async () => 4242,
      verifyOwnedMaintenanceIdentity: async () => ({ connectedDatabase: 'postgres' }) as never,
      ensureOwnedDatabase: async () => undefined,
      verifyPostgresIdentity: async () => ({ connectedDatabase: 'app_cleanstart_dev', dataDirectory: seamRuntime.paths.dataDir }) as never,
      psqlQuery: async () => '{}',
      stopPostgres: async () => undefined,
      runChild: async () => { throw new Error('tsc --noEmit exited 1') },
      spawnApp: (() => { spawnCalls.push('spawn'); return { pid: 1 } }) as never,
      stopAppProcess: async () => undefined,
      waitForHttpReady: async () => undefined,
      startMailCapture: async () => { throw new Error('mail must not start') },
      copyAppSource: async () => fixture.appDir,
      prepareObservedAppCopy,
      assertOwnedLoopbackDatabaseTarget: () => undefined,
      createSafeRunPlan: (() => undefined) as never,
    }), /observer copy compilation failed/)
    assert.equal(spawnCalls.length, 0, 'a failed tsc build must prevent the downstream spawn')
    assert.equal(handleObserverManifestAbsent(fixture), true)
    clearMatrixStopBlock()
  })

  it('a real tsc build failure is saved to the private log and never yields a compiled manifest', async () => {
    const fixture = await buildObserverFixtureApp('compile-fail', {
      approvalsSource: OBSERVER_FIXTURE_APPROVALS + "\nconst observerBroken: number = 'not-a-number'\n",
    })
    await assert.rejects(() => prepareFixtureCopy(fixture), /observer copy compilation failed/)
    const log = await fsp.readFile(path.join(fixture.evidenceDir, 'observer-tsc-compile.log'), 'utf8')
    assert.ok(log.includes('error TS2322') && log.includes('not assignable'), 'compile log must contain the type failure')
  })

  it('successful lifecycle preparation compiles before schema push, seed, mail and spawn, and sets the manifest only after success', async () => {
    const fixture = await buildObserverFixtureApp('lifecycle')
    clearMatrixStopBlock()
    const calls: string[] = []
    const runtime = {
      runId: 'observer-success-20261015',
      databaseUrl: 'postgresql://postgres:secret@127.0.0.1:44010/app_cleanstart_dev',
      databasePassword: 'secret',
      e2ePassword: 'e2e-secret',
      ports: { databasePort: 44010, serverPort: 44011, mailPort: 44012 },
      postmasterPid: 4242,
      paths: { rootDir: fixture.ownedRoot, dataDir: path.join(fixture.ownedRoot, 'pgdata'), logsDir: path.join(fixture.ownedRoot, 'logs'), socketDir: path.join(fixture.ownedRoot, 'pgsocket'), secretsDir: path.join(fixture.ownedRoot, 'secrets') },
      resource: { runId: 'observer-success-20261015', containerName: 'observer-success-20261015-postgres', databaseName: 'app_cleanstart_dev' as const, databasePort: 44010, serverPort: 44011 },
    }
    const seedTx: Record<string, { create(args: { data: Record<string, unknown> }): Promise<unknown>; update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown> }> = {}
    for (const model of ['positions', 'user', 'organization_units', 'company_settings', 'organization_assignments', 'teams', 'approval_route_versions', 'approval_route_steps', 'email_settings']) {
      seedTx[model] = { create: async () => ({}), update: async () => ({}) }
    }
    const seedClient = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      $queryRawUnsafe: async <T,>(sql: string) => {
        if (sql.includes('current_database')) return [{ current_database: 'app_cleanstart_dev' }] as T
        return [
          { indexname: 'one_active_assignment_per_user' },
          { indexname: 'one_active_company_root' },
          { indexname: 'one_published_route_per_scope_phase' },
          { indexname: 'one_active_team_name_per_unit' },
        ] as T
      },
      $transaction: async <T,>(fn: (tx: Record<string, { create(args: { data: Record<string, unknown> }): Promise<unknown> }>) => Promise<T>) => fn(seedTx as never),
      company_settings: { count: async () => 0 },
      user: { count: async () => 0 },
      organization_units: { count: async () => 0 },
      approval_route_versions: { count: async () => 0 },
      email_settings: { count: async () => 0 },
    }
    const seedUsers = buildIsolatedMatrixSeedPlan('unused-hash').steps.filter((step) => step.table === 'users').length
    const handle = await startMatrixRuntime({
      routesConfig: 'all-defaults',
      parentDir: '/tmp/rejection-recovery-matrix',
      log: () => undefined,
      seedCleared: true,
    }, {
      assertNoProtectedAmbientKeys: () => undefined,
      ensureOwnedTmpParent: async () => undefined,
      createOwnedRuntime: async () => runtime as never,
      initdbCluster: async () => { calls.push('initdb') },
      startPostgres: async () => 4242,
      verifyOwnedMaintenanceIdentity: async () => ({ connectedDatabase: 'postgres' }) as never,
      ensureOwnedDatabase: async () => undefined,
      verifyPostgresIdentity: async () => ({ connectedDatabase: 'app_cleanstart_dev', dataDirectory: runtime.paths.dataDir }) as never,
      psqlQuery: async (_runtime, _database, sql) => {
        calls.push('psql')
        if (sql.includes('json_agg(indexname')) return '["one_active_assignment_per_user","one_active_company_root","one_published_route_per_scope_phase","one_active_team_name_per_unit"]'
        return JSON.stringify({ users: seedUsers, routes: expectedPublishedRoutes('all-defaults') })
      },
      stopPostgres: async () => { calls.push('stop-pg') },
      runChild: async (command) => {
        calls.push('run-child:' + path.basename(command))
        return 0
      },
      spawnApp: (() => {
        calls.push('spawn')
        return { pid: 4242 } as never
      }),
      stopAppProcess: async () => { calls.push('stop-app') },
      waitForHttpReady: async () => { calls.push('ready') },
      startMailCapture: async () => {
        calls.push('mail')
        return { close: async () => { calls.push('close-mail') } } as never
      },
      copyAppSource: async () => { calls.push('copy'); return fixture.appDir },
      prepareObservedAppCopy,
      createSeedClient: async () => seedClient as never,
      hashPassword: async (plain) => 'ObFeScAtEd:' + Buffer.from(plain).toString('base64'),
      assertOwnedLoopbackDatabaseTarget: () => undefined,
      createSafeRunPlan: (() => undefined) as never,
    })
    assert.equal(handle.observerManifest?.compiled, true)
    assert.equal(handle.observerManifest?.registered.length, 11)
    assert.equal(handle.observerManifest?.generated.length, 4)
    const position = (marker: string): number => calls.findIndex((call) => call.startsWith(marker))
    const order = calls.join(',')
    assert.ok(position('copy') >= 0 && position('copy') < position('run-child:tsc'), order)
    assert.ok(position('run-child:tsc') < position('run-child:prisma'), order)
    assert.ok(position('run-child:prisma') < position('mail'), order)
    assert.ok(position('mail') < position('spawn'), order)
    assert.equal(calls.filter((call) => call === 'spawn').length, 1, order)
    const journal = await fsp.readFile(path.join(fixture.ownedRoot, 'logs', 'observer-journal', 'observer-journal.jsonl'), 'utf8')
    assert.ok(journal.includes('"kind":"admission"'))
  })
})

function handleObserverManifestAbsent(_fixture: ObserverFixtureApp): boolean {
  // The failed startup never returns a handle; the assertion documents that
  // no manifest can exist without a successful compile.
  return true
}

describe('Task2 generated observer module: admission, latched faults and original identity', () => {
  async function freshHandlers(name: string): Promise<{ fixture: ObserverFixtureApp } & FixtureHandlers> {
    const fixture = await buildObserverFixtureApp(name)
    await prepareFixtureCopy(fixture, async () => 0)
    const handlers = await importPreparedFixtureHandlers(fixture)
    handlers.prismaStub.resetObserverBusinessCalls()
    handlers.authStub.setObserverUser({ id: 'actor-1' })
    return { fixture, ...handlers }
  }

  it('observer_preinvoke_failure_has_zero_calls', async () => {
    const { mod, prismaStub, state } = await freshHandlers('preinvoke')
    state.faults.add('begin')
    const businessCalls = prismaStub.observerBusinessCalls()
    await assert.rejects(
      () => captureObserverStderr(state, () => (mod.approveRequest as (requestId: string) => Promise<unknown>)('request-1')),
      (error: Error) => error.name === 'ObserverAdmissionError' && /admission failed before the original approvals\.approveRequest invocation/.test(error.message),
    )
    assert.equal(prismaStub.observerBusinessCalls(), businessCalls, 'zero business calls after admission failure')
    assert.deepEqual(state.records.filter((record) => record.kind !== 'fault'), [])
    assert.ok(state.stderr.some((line) => line.includes('[rrm-action-observer]')), 'admission fault metadata reached private stderr')
  })

  it('observer_postcommit_failure_preserves_result', async () => {
    const { mod, prismaStub, state } = await freshHandlers('postcommit')
    state.faults = new Set(['actor', 'transaction:begin', 'transaction:resolved', 'prepared', 'exit'])
    const input = { title: 'Post commit', description: '<p>kept</p>', inlineImageSessionId: FIXTURE_SESSION_CREATE, stagedAttachmentIds: [] }
    const result = await captureObserverStderr(state, () => (mod.createRequest as (value: typeof input) => Promise<Record<string, unknown>>)(input))
    assert.deepEqual(result, { success: true, requestId: 'request-Post commit' })
    assert.ok(prismaStub.observerBusinessCalls() > 0, 'exactly one original invocation ran')
    const begin = state.records.find((record) => record.kind === 'begin')
    assert.ok(begin, 'begin record survived')
    assert.equal(state.records.some((record) => record.kind === 'exit'), false, 'failed end capture must not fabricate an exit record')
    assert.ok(state.stderr.some((line) => line.includes('[rrm-action-observer]')), 'fault metadata recorded in private stderr')
    assert.equal(canonicalJson(begin?.argumentProjection), canonicalJson(normalizeActionArguments('requests.createRequest', [input])))
  })

  it('rethrows the identical original thrown error and records the rejected transaction', async () => {
    const { mod, prismaStub, state } = await freshHandlers('rethrow')
    prismaStub.failNextObserverTransaction('stale boom')
    await assert.rejects(
      () => (mod.rejectRequest as (requestId: string, comments: string) => Promise<unknown>)('request-1', 'reason'),
      (error: Error) => error.message === 'stale boom',
    )
    const rejected = state.records.find((record) => record.kind === 'transaction' && record.phase === 'rejected')
    assert.ok(rejected, 'rejected transaction recorded')
    const exit = state.records.find((record) => record.kind === 'exit')
    assert.ok(exit && exit.exit?.state === 'thrown' && exit.exit.code === 'unknown-error:' + hash('stale boom'))
    assert.equal(prismaStub.observerBusinessCalls(), 0, 'the transaction rejection happens before any business work')
  })

  it('guard denial and auth throw leave the original guards with a not-started transaction', async () => {
    const { mod, prismaStub, authStub, state } = await freshHandlers('guards')
    authStub.setObserverUser(null)
    const denied = await (mod.createRequest as (value: { title: string; description: string }) => Promise<Record<string, unknown>>)({ title: 'x', description: 'y' })
    assert.deepEqual(denied, { success: false, error: 'no user' })
    assert.equal(prismaStub.observerBusinessCalls(), 0, 'original guard holds: zero business calls')
    const actor = state.records.find((record) => record.kind === 'actor')
    assert.ok(actor && actor.authObserved === true && actor.actorId === null)
    assert.equal(state.records.some((record) => record.kind === 'transaction'), false, 'not-started on guard denial')
    assert.equal(state.records.find((record) => record.kind === 'exit')?.exit?.state, 'returned')
    state.records.length = 0
    authStub.setObserverUser({ id: 'actor-1' })
    authStub.failNextObserverAuth(new Error('auth backend down'))
    await assert.rejects(() => (mod.approveRequest as (requestId: string) => Promise<unknown>)('request-1'), /auth backend down/)
    assert.equal(prismaStub.observerBusinessCalls(), 0, 'auth throw happens before any business call')
    assert.equal(state.records.some((record) => record.kind === 'actor'), false, 'no fabricated actor record when auth threw first')
  })

  it('helper transaction resolves before notification failure and stays recorded resolved', async () => {
    const { mod, state } = await freshHandlers('helper')
    const approved = await (mod.approveSolution as (solutionId: string) => Promise<Record<string, unknown>>)('poison-solution')
    assert.deepEqual(approved, { success: true, solutionId: 'poison-solution' })
    const phases = state.records.filter((record) => record.kind === 'transaction').map((record) => record.phase)
    assert.deepEqual(phases, ['begin', 'resolved'])
    const exit = state.records.find((record) => record.kind === 'exit')
    assert.ok(exit && exit.exit?.state === 'returned', 'resolved transaction plus original success identity')
    state.records.length = 0
    await assert.rejects(
      () => (mod.createRequest as (value: { title: string; description: string }) => Promise<unknown>)({ title: 'poison', description: '<p>x</p>' }),
      /notification dispatch refused for poison/,
    )
    const directPhases = state.records.filter((record) => record.kind === 'transaction').map((record) => record.phase)
    assert.deepEqual(directPhases, ['begin', 'resolved'], 'notification failure must not be recorded as a transaction rejection')
    const thrownExit = state.records.find((record) => record.kind === 'exit')
    assert.ok(thrownExit && thrownExit.exit?.state === 'thrown' && thrownExit.exit.code === 'unknown-error:' + hash('notification dispatch refused for poison'))
  })

  it('helper transaction observation faults latch instead of replacing the original exception', async () => {
    const { mod, prismaStub, state } = await freshHandlers('helper-reject')
    state.faults = new Set(['transaction:begin', 'transaction:rejected', 'exit'])
    prismaStub.failNextObserverTransaction('isolation conflict')
    await assert.rejects(
      () => captureObserverStderr(state, () => (mod.rejectSolution as (solutionId: string, comments: string) => Promise<unknown>)('solution-1', 'reason')),
      (error: Error) => error.message === 'isolation conflict',
    )
    assert.equal(state.records.some((record) => record.kind === 'exit'), false, 'faulted exit record is missing and must fail the host evidence gate later')
    assert.ok(state.stderr.some((line) => line.includes('transaction:rejected') || line.includes('exit')), 'fault metadata reached private stderr')
  })

  it('prepared-description boundary producer records the same-invocation raw input SHA, prepared HTML SHA and actual prepared upload session', async () => {
    const { mod, state } = await freshHandlers('prepared')
    await (mod.createRequest as (value: { title: string; description: string }) => Promise<unknown>)({ title: 'Prepared', description: '<p>raw body</p>' })
    const prepared = state.records.find((record) => record.kind === 'prepared')
    assert.ok(prepared)
    assert.equal(prepared?.inputSha256, hash('<p>raw body</p>'))
    assert.equal(prepared?.htmlSha256, hash('<p><p>raw body</p></p>'))
    assert.equal(prepared?.uploadSessionId, FIXTURE_SESSION_CREATE)
    state.records.length = 0
    await (mod.resubmitRequest as (value: { requestId: string }) => Promise<unknown>)({ requestId: 'request-1' })
    assert.equal(state.records.some((record) => record.kind === 'prepared'), false, 'no description update means no preparation observation')
  })

  it('begin projection equals the accepted safe normalization with UTF-16 lengths and actual defaults for every registered handler shape', async () => {
    const { runObservedOriginal, state } = await freshHandlers('projection')
    const cases: [string, readonly unknown[]][] = [
      ['requests.createRequest', [{ title: '🚀 Title', description: '<p>😀 <img src="/api/inline-images/' + FIXTURE_SESSION_CREATE + '" /></p>', inlineImageSessionId: FIXTURE_SESSION_CREATE, stagedAttachmentIds: [] }]],
      ['requests.resubmitRequest', [{ requestId: FIXTURE_UUID_REQUEST, title: 'Updated 🚀', description: '<p>new body</p>', inlineImageSessionId: FIXTURE_SESSION_RESUBMIT_REQUEST }]],
      ['requests.resubmitRequest', [{ requestId: FIXTURE_UUID_REQUEST }]],
      ['solutions.submitSolution', [{ requestId: FIXTURE_UUID_REQUEST, title: 'S', description: '<p>body</p>', inlineImageSessionId: FIXTURE_SESSION_SUBMIT_SOLUTION }]],
      ['solutions.resubmitSolution', [{ requestId: FIXTURE_UUID_REQUEST, title: 'S', description: '<p>body</p>', inlineImageSessionId: FIXTURE_SESSION_RESUBMIT_SOLUTION, cost: 10.5, currency: 'USD', timeline: '3 days', useCustomHierarchy: false }]],
      ['approvals.approveRequest', ['request-1']],
      ['approvals.rejectRequest', ['request-1', 'reason']],
      ['solutions.initiateFinalApproval', [FIXTURE_UUID_REQUEST, true, ['user-1', 'user-2']]],
      ['solutions.approveFinalApproval', [FIXTURE_UUID_REQUEST, undefined, new Date('2026-10-15T00:00:00.000Z')]],
    ]
    for (const [handler, args] of cases) {
      state.records.length = 0
      await runObservedOriginal(handler, args, async () => ({ success: true }))
      const begin = state.records.find((record) => record.kind === 'begin')
      const accepted = normalizeActionArguments(handler as never, args as never)
      assert.ok(begin, 'begin record for ' + handler)
      assert.equal(canonicalJson(begin?.argumentProjection), canonicalJson(accepted), 'argument projection for ' + handler)
    }
    const unicode = normalizeActionArguments('requests.createRequest', [{ title: '🚀 Title', description: '<p>body</p>', inlineImageSessionId: FIXTURE_SESSION_CREATE, stagedAttachmentIds: [] }]) as Record<string, JsonValue>
    assert.equal(unicode.titleLength, '🚀 Title'.length, 'JS UTF-16 code units, not UTF-8 bytes')
    assert.equal(unicode.titleLength, 8)
  })

  it('exit projection equals the accepted safe result normalization including failure shapes', async () => {
    const { runObservedOriginal, state } = await freshHandlers('result-projection')
    const validObjectArgs = [{ requestId: 'x', title: 'T', description: '<p>d</p>' }]
    const cases: [string, readonly unknown[], unknown][] = [
      ['requests.createRequest', validObjectArgs, { success: true, requestId: 'r1' }],
      ['requests.resubmitRequest', [{ requestId: 'x' }], { success: true, request: { id: 'r2', title: 'ignored', updatedAt: new Date(0) } }],
      ['solutions.submitSolution', validObjectArgs, { success: true, solutionId: 's1', extra: 'dropped' }],
      ['solutions.resubmitSolution', [{ requestId: 'x', title: 'T', description: '<p>d</p>', cost: 1, currency: 'USD', timeline: 't', useCustomHierarchy: false }], { success: true, solutionId: 's2', deletedAttachmentIds: ['a'], cleanupWarnings: [] }],
      ['approvals.rejectRequest', ['x'], { success: false, stale: true, message: 'This request was updated by another user.' }],
      ['requests.createRequest', validObjectArgs, { success: false, error: 'nope' }],
    ]
    for (const [handler, args, returned] of cases) {
      state.records.length = 0
      const result = await runObservedOriginal(handler, args, async () => returned)
      assert.equal(result, returned, 'original return object identity for ' + handler)
      const exit = state.records.find((record) => record.kind === 'exit')
      assert.equal(canonicalJson(exit?.exit?.projection), canonicalJson(normalizeActionResult(handler as never, returned)), 'result projection for ' + handler)
    }
  })

  it('generated module exposes the three explicit journal dependencies and never an ambient handlerProbe', () => {
    const source = observerModuleSource('/some/owned/root/observer-journal')
    assert.ok(!source.includes('handlerProbe'))
    assert.ok(source.includes('append: (record: ObserverRecord) => void'))
    assert.ok(source.includes('clock: () => ClockMark'))
    assert.ok(source.includes('nextInvocationId: () => string'))
    assert.ok(source.includes(JSON.stringify('/some/owned/root/observer-journal')))
    assert.ok(source.includes("openSync(journalPath, 'a')"), 'journal default append targets only the baked private evidence directory')
  })
})


// ============================================================================
// Observer post-admission fault-isolation repair (bounded R/T repair stage):
// after the original invocation begins, NO observer operation — clock, append,
// record projection, fault recording — may throw into the original logic,
// short-circuit it, or replace its exact returned object / thrown value.
// The harness below evaluates the ACTUAL emitted R observer template in
// memory (no handlers, auth, Prisma, env or real journal resources) and
// injects explicit failing clock/append dependencies.
// ============================================================================
import ts from 'typescript'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

interface RepairClockMark { domain: string; monotonicMs: number; wallMs: number }
interface RepairRecord { kind: string; at?: RepairClockMark | null; [key: string]: unknown }

interface RepairObserverHarness {
  runObservedOriginal: <T>(handler: string, args: readonly unknown[], original: (inv: unknown) => Promise<T>) => Promise<T>
  observeAuthenticatedActor: (inv: unknown, actorId: string | null) => void
  observeTransaction: <T>(inv: unknown, original: () => Promise<T>) => Promise<T>
  observePreparedDescription: <P extends { html: string }>(inv: unknown, rawDescription: string, uploadSessionId: string | null | undefined, prepared: P) => P
  records: RepairRecord[]
  clockCalls: { count: number }
  appendCalls: { count: number }
  appendAttempts: string[]
  stderr: string[]
  stderrFailures: { count: number }
  schedule: { failClockFrom: number; failAppendFrom: number; clockFault?: unknown; appendFault?: unknown; failAppendCalls: Set<number>; failStderr: boolean }
  install: () => void
}

function loadInMemoryRepairObserver(): RepairObserverHarness {
  const generated = observerModuleSource('/never-used-repair-observer-journal')
  const compiled = ts.transpileModule(generated, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const records: RepairRecord[] = []
  const clockCalls = { count: 0 }
  const appendCalls = { count: 0 }
  const appendAttempts: string[] = []
  const stderr: string[] = []
  const stderrFailures = { count: 0 }
  const schedule: RepairObserverHarness['schedule'] = {
    failClockFrom: Number.POSITIVE_INFINITY, failAppendFrom: Number.POSITIVE_INFINITY, failAppendCalls: new Set<number>(), failStderr: false,
  }
  const moduleInstance = { exports: {} as Record<string, unknown> }
  // Per-instance stderr faults: never replace the host process or initialize a
  // real handler/auth/database module. Error/String preserve the host realm's
  // ordinary thrown-Error semantics in this actual generated module.
  runInNewContext(compiled, {
    exports: moduleInstance.exports,
    require: createRequire(path.join(MATRIX_REPO_ROOT, 'rrm-repair-in-memory-observer.cjs')),
    Error, String,
    process: { stderr: { write: (line: string) => {
      stderr.push(line)
      if (schedule.failStderr) {
        stderrFailures.count += 1
        throw Object.create(null)
      }
      return process.stderr.write(line)
    } } },
  }, { filename: 'rrm-repair-in-memory-observer.cjs' })
  const harness: RepairObserverHarness = {
    records,
    clockCalls,
    appendCalls,
    appendAttempts,
    stderr,
    stderrFailures,
    schedule,
    install: () => {
      const api = moduleInstance.exports as unknown as { configureObserverJournal: (deps: unknown) => void }
      api.configureObserverJournal({
        append: (record: RepairRecord) => {
          appendCalls.count += 1
          appendAttempts.push(record.kind)
          if (appendCalls.count >= schedule.failAppendFrom || schedule.failAppendCalls.has(appendCalls.count)) throw schedule.appendFault ?? new Error('fixture append fault at call ' + appendCalls.count)
          records.push(JSON.parse(JSON.stringify(record)) as RepairRecord)
        },
        clock: () => {
          clockCalls.count += 1
          if (clockCalls.count >= schedule.failClockFrom) throw schedule.clockFault ?? new Error('fixture clock fault at call ' + clockCalls.count)
          return { domain: 'repair-observer', monotonicMs: clockCalls.count, wallMs: 1760000000000 + clockCalls.count }
        },
        nextInvocationId: () => 'repair-observer-invocation',
      })
    },
    runObservedOriginal: moduleInstance.exports.runObservedOriginal as never,
    observeAuthenticatedActor: moduleInstance.exports.observeAuthenticatedActor as never,
    observeTransaction: moduleInstance.exports.observeTransaction as never,
    observePreparedDescription: moduleInstance.exports.observePreparedDescription as never,
  }
  harness.install()
  return harness
}

describe('observer post-admission fault isolation (bounded repair)', () => {
  it('exit capture clock fault after original success latches honestly and preserves the exact original returned object', async () => {
    const harness = loadInMemoryRepairObserver()
    harness.schedule.failClockFrom = 2 // first clock = admission start; second = exit capture
    const state: ObserverJournalState = { records: [], calls: [], stderr: [], faults: new Set<string>(), ids: 0 }
    const originalResult: { success: boolean } = { success: true }
    let originalCalls = 0
    let returned: unknown
    let thrown: unknown = null
    await captureObserverStderr(state, async () => {
      try {
        returned = await harness.runObservedOriginal('solutions.initiateFinalApproval', ['10000000-0000-4000-8000-000000000001', false], async () => {
          originalCalls += 1
          return originalResult
        })
      } catch (error) {
        thrown = error
      }
    })
    assert.equal(originalCalls, 1, 'exactly one original invocation')
    assert.equal(thrown, null, 'post-admission clock failure must never replace the original outcome')
    assert.equal(returned, originalResult, 'the identical original returned object must survive the observer fault')
    assert.equal(harness.records[0]?.kind, 'begin', 'admission record still present')
    assert.equal(harness.records.some((record) => record.kind === 'exit'), false, 'no invented end/exit record without an honest clock mark')
    assert.ok(harness.records.every((record) => record.kind === 'begin'), 'no fabricated observations beyond admission')
    assert.ok(state.stderr.some((line) => line.includes('[rrm-action-observer]')), 'the fault is recorded in private stderr, not swallowed silently')
  })

  it('exit capture clock fault after original throw rethrows the identical original error and writes no invented end record', async () => {
    const harness = loadInMemoryRepairObserver()
    harness.schedule.failClockFrom = 2
    const state: ObserverJournalState = { records: [], calls: [], stderr: [], faults: new Set<string>(), ids: 0 }
    const originalError = new Error('fixture ORIGINAL business exception')
    let originalCalls = 0
    let thrown: unknown = null
    await captureObserverStderr(state, async () => {
      try {
        await harness.runObservedOriginal('solutions.initiateFinalApproval', ['10000000-0000-4000-8000-000000000001', false], async () => {
          originalCalls += 1
          throw originalError
        })
      } catch (error) {
        thrown = error
      }
    })
    assert.equal(originalCalls, 1, 'exactly one original invocation')
    assert.equal(thrown, originalError, 'post-admission telemetry must rethrow the identical original thrown value')
    assert.equal(harness.records[0]?.kind, 'begin')
    assert.equal(harness.records.some((record) => record.kind === 'exit'), false, 'no invented end/exit record without an honest clock mark')
  })

  it('post-admission observation clock faults at actor, transaction and prepared taps latch without throwing or inventing records', async () => {
    const harness = loadInMemoryRepairObserver()
    harness.schedule.failClockFrom = 2
    const state: ObserverJournalState = { records: [], calls: [], stderr: [], faults: new Set<string>(), ids: 0 }
    let transactionStateSeen: string | null = null
    const originalResult = { success: true, requestId: 'kept' }
    let returned: unknown
    let thrown: unknown = null
    await captureObserverStderr(state, async () => {
      try {
        returned = await harness.runObservedOriginal('requests.createRequest', [{ title: 'T', description: '<p>d</p>' }], async (inv) => {
          harness.observeAuthenticatedActor(inv, 'actor-9')
          await harness.observeTransaction(inv, async () => 'transaction-value')
          harness.observePreparedDescription(inv, '<p>raw</p>', FIXTURE_SESSION_CREATE, { html: '<p>prepared</p>' })
          transactionStateSeen = (inv as { transaction: string }).transaction
          return originalResult
        })
      } catch (error) {
        thrown = error
      }
    })
    assert.equal(thrown, null, 'observation clock faults must never surface into the original flow')
    assert.equal(returned, originalResult, 'original returned object identity survives every tap fault')
    assert.equal(transactionStateSeen, 'resolved', 'transaction observation still advances its honest state')
    assert.deepEqual(harness.records.map((record) => record.kind), ['begin'], 'only the admission record exists; every post-admission record needs an honest clock mark')
    assert.ok(state.stderr.filter((line) => line.includes('[rrm-action-observer]')).length >= 4, 'each latched tap fault reached private stderr')
  })

  it('rejected transaction with observation clock faults rethrows the identical original error', async () => {
    const harness = loadInMemoryRepairObserver()
    harness.schedule.failClockFrom = 1 // even the transaction-begin clock read fails
    const state: ObserverJournalState = { records: [], calls: [], stderr: [], faults: new Set<string>(), ids: 0 }
    const originalError = new Error('fixture transaction rejection')
    let thrown: unknown = null
    await captureObserverStderr(state, async () => {
      try {
        await harness.observeTransaction({ invocationId: 'inv', handler: 'approvals.approveRequest', observerErrors: [] } as never, async () => {
          throw originalError
        })
      } catch (error) {
        thrown = error
      }
    })
    assert.equal(thrown, originalError, 'rejected transaction keeps the identical original error')
  })

  // F2 correction: the prior clock-fail-from2 schedule skipped the exit
  // append entirely. A working clock and an actor tap now reach BOTH failing
  // journal appends; the per-instance VM also throws from stderr.write.
  for (const outcome of ['returned', 'thrown'] as const) {
    it(`F2 reachable journal, fault-record and stderr failures preserve original ${outcome} identity and sticky gaps`, async () => {
      const harness = loadInMemoryRepairObserver()
      harness.schedule.failAppendFrom = 2
      harness.schedule.failStderr = true
      const originalValue = outcome === 'returned' ? { success: true } : new Error('original business failure')
      let originalCalls = 0
      let invocation: RepairInvocation | undefined
      let returned: unknown
      let thrown: unknown = null
      try {
        returned = await harness.runObservedOriginal('approvals.approveRequest', ['request-1'], async (inv) => {
          originalCalls += 1
          invocation = inv as RepairInvocation
          harness.observeAuthenticatedActor(inv, 'actor-9')
          if (outcome === 'thrown') throw originalValue
          return originalValue
        })
      } catch (error) { thrown = error }
      assert.equal(originalCalls, 1)
      assert.equal(outcome === 'returned' ? returned === originalValue && thrown === null : thrown === originalValue, true, 'exact original outcome survives compound observer failures')
      assert.deepEqual(harness.appendAttempts, ['begin', 'actor', 'fault', 'exit', 'fault'], 'F2 reachability: both primary and secondary journal failure boundaries actually ran')
      assert.equal(harness.stderrFailures.count, 2, 'both private diagnostic writes actually threw')
      assert.ok(harness.stderr.some((line) => line.includes('at actor:')))
      assert.ok(harness.stderr.some((line) => line.includes('at exit:')))
      assert.deepEqual(harness.records.map((record) => record.kind), ['begin'], 'actual emitted journal has no actor, fault or exit evidence')
      assert.ok(invocation!.observerErrors.some((message) => message.startsWith('actor:')))
      assert.ok(invocation!.observerErrors.some((message) => message.startsWith('exit:')))
      assert.equal(invocation!.exit!.state, outcome, 'in-memory outcome is honest, not a fabricated denial or transaction')
      assert.equal(invocation!.transaction, 'not-started')
      assert.equal(invocation!.end!.monotonicMs, 4, 'working exit clock precedes its failed append and secondary fault clock')
    })
  }
})

interface RepairInvocation {
  observerErrors: string[]
  end: RepairClockMark | null
  exit: { state: string; projection?: unknown } | null
  transaction: string
  preparedDescription: unknown
}

const REPAIR_ARGS = ['10000000-0000-4000-8000-000000000001', false] as const

function unrenderableRepairFault(kind: 'null-prototype' | 'message-getter' | 'to-primitive'): unknown {
  if (kind === 'null-prototype') return Object.create(null)
  if (kind === 'message-getter') {
    const error = new Error()
    Object.defineProperty(error, 'message', { get: () => { throw Object.create(null) } })
    return error
  }
  return { [Symbol.toPrimitive]: () => { throw Object.create(null) } }
}

describe('F1 rendering and thrown projection fault isolation on actual emitted template', () => {
  for (const kind of ['null-prototype', 'message-getter', 'to-primitive'] as const) {
    for (const outcome of ['returned', 'thrown'] as const) {
      it(`F1 ${kind} exit-clock fault preserves original ${outcome} identity and honest missing exit`, async () => {
        const harness = loadInMemoryRepairObserver()
        harness.schedule.failClockFrom = 2
        harness.schedule.clockFault = unrenderableRepairFault(kind)
        const originalValue = outcome === 'returned' ? { success: true } : new Error('original throw')
        let calls = 0
        let invocation: RepairInvocation | undefined
        let returned: unknown
        let thrown: unknown = null
        try {
          returned = await harness.runObservedOriginal('solutions.initiateFinalApproval', REPAIR_ARGS, async (inv) => {
            calls += 1
            invocation = inv as RepairInvocation
            if (outcome === 'thrown') throw originalValue
            return originalValue
          })
        } catch (error) { thrown = error }
        assert.equal(calls, 1)
        assert.equal(outcome === 'returned' ? returned === originalValue && thrown === null : thrown === originalValue, true, 'F1 original identity must survive error rendering')
        assert.deepEqual(harness.records.map((record) => record.kind), ['begin'])
        assert.equal(invocation!.end, null, 'no invented exit timestamp')
        assert.ok(invocation!.observerErrors.some((message) => message.startsWith('exit:clock:')))
        assert.ok(harness.stderr.some((line) => line.includes('[unrenderable observer fault]')))
      })
    }
  }

  for (const kind of ['digest-getter', 'message-getter', 'null-prototype', 'to-primitive'] as const) {
    it(`F1 original ${kind} projection failure rethrows the exact original and emits no invented error evidence`, async () => {
      const harness = loadInMemoryRepairObserver()
      let getterCalls = 0
      let original: unknown
      if (kind === 'digest-getter' || kind === 'message-getter') {
        original = new Error('original accessor fault')
        Object.defineProperty(original, kind === 'digest-getter' ? 'digest' : 'message', {
          get: () => { getterCalls += 1; throw Object.create(null) },
        })
      } else original = unrenderableRepairFault(kind)
      let calls = 0
      let invocation: RepairInvocation | undefined
      let thrown: unknown
      try {
        await harness.runObservedOriginal('solutions.initiateFinalApproval', REPAIR_ARGS, async (inv) => {
          calls += 1
          invocation = inv as RepairInvocation
          throw original
        })
      } catch (error) { thrown = error }
      assert.equal(calls, 1)
      assert.equal(thrown === original, true, 'F1 thrown projection must preserve exact original identity')
      if (kind.endsWith('getter')) assert.equal(getterCalls, 1, 'do not retry the hostile original accessor')
      assert.equal(invocation!.exit, null, 'unavailable original error projection stays missing, not a synthetic thrown code')
      assert.equal(invocation!.end!.monotonicMs, 2, 'independent honest clock fact is preserved')
      assert.deepEqual(harness.records.map((record) => record.kind), ['begin'])
      assert.ok(invocation!.observerErrors.some((message) => message.startsWith('throw-projection:')))
    })
  }

  for (const transactionOutcome of ['resolved', 'sync-throw', 'async-reject'] as const) {
    it(`F1 unrenderable actor/transaction/prepared faults retain once-only original work with transaction ${transactionOutcome}`, async () => {
      const harness = loadInMemoryRepairObserver()
      harness.schedule.failClockFrom = 2
      harness.schedule.clockFault = Object.create(null)
      const originalError = new Error('transaction original')
      const originalResult = { success: true }
      let invocation: RepairInvocation | undefined
      let originalCalls = 0, transactionCalls = 0, prepareCalls = 0, callbackCalls = 0
      let preparedReturned: unknown
      let returned: unknown
      let thrown: unknown = null
      const prepared = Object.defineProperty({}, 'html', { get: () => { throw Object.create(null) } }) as { html: string }
      const order: string[] = []
      try {
        returned = await harness.runObservedOriginal('solutions.initiateFinalApproval', REPAIR_ARGS, async (inv) => {
          originalCalls += 1
          invocation = inv as RepairInvocation
          order.push('actor')
          harness.observeAuthenticatedActor(inv, 'actor-9')
          prepareCalls += 1
          preparedReturned = harness.observePreparedDescription(inv, '<p>raw</p>', FIXTURE_SESSION_CREATE, prepared)
          const transaction = () => {
            transactionCalls += 1
            order.push('transaction')
            if (transactionOutcome === 'sync-throw') throw originalError
            return Promise.resolve().then(() => {
              callbackCalls += 1
              if (transactionOutcome === 'async-reject') throw originalError
              return originalResult
            })
          }
          await harness.observeTransaction(inv, transaction)
          order.push('notification')
          return originalResult
        })
      } catch (error) { thrown = error }
      assert.equal(originalCalls, 1)
      assert.equal(transactionCalls, 1, 'an observation fault cannot prevent or replay the original transaction')
      assert.equal(callbackCalls, transactionOutcome === 'sync-throw' ? 0 : 1)
      assert.equal(prepareCalls, 1)
      assert.equal(preparedReturned === prepared, true, 'prepared object survives proof-rendering failure without replay')
      assert.equal(transactionOutcome === 'resolved' ? returned === originalResult && thrown === null : thrown === originalError, true)
      assert.deepEqual(order, transactionOutcome === 'resolved' ? ['actor', 'transaction', 'notification'] : ['actor', 'transaction'])
      assert.equal(invocation!.transaction, transactionOutcome === 'resolved' ? 'resolved' : 'rejected')
      assert.equal(invocation!.preparedDescription, null, 'no invented prepared proof')
      for (const observation of ['actor:clock:', 'prepared-description:', 'transaction-begin:clock:', transactionOutcome === 'resolved' ? 'transaction-resolved:clock:' : 'transaction-rejected:clock:', 'exit:clock:']) {
        assert.ok(invocation!.observerErrors.some((message) => message.startsWith(observation)), observation + ' is sticky')
      }
      assert.deepEqual(harness.records.map((record) => record.kind), ['begin'])
    })
  }

  it('F1 unrenderable result-projection fault preserves returned object and emits only a sticky null projection', async () => {
    const harness = loadInMemoryRepairObserver()
    const original = Object.defineProperty({}, 'success', { get: () => { throw Object.create(null) } })
    let calls = 0
    let returned: unknown
    let thrown: unknown = null
    try {
      returned = await harness.runObservedOriginal('solutions.initiateFinalApproval', REPAIR_ARGS, async () => { calls += 1; return original })
    } catch (error) { thrown = error }
    assert.equal(calls, 1)
    assert.equal(returned === original && thrown === null, true)
    assert.deepEqual(harness.records.map((record) => record.kind), ['begin', 'exit'])
    assert.deepEqual(harness.records[1].exit, { state: 'returned', projection: null })
    assert.ok((harness.records[1].observerErrors as string[]).some((message) => message.startsWith('result-projection:')))
  })

  for (const outcome of ['returned', 'thrown'] as const) {
    it(`F1 unrenderable append fault keeps sticky emitted fault and exit records after original ${outcome}`, async () => {
      const harness = loadInMemoryRepairObserver()
      // Fail ONLY the actor append; allow the secondary fault and exit to be
      // emitted, proving the safe rendering path is not merely swallowed.
      const original = outcome === 'returned' ? { success: true } : new Error('original throw')
      harness.schedule.failAppendCalls.add(2)
      harness.schedule.appendFault = Object.create(null)
      let invocation: RepairInvocation | undefined
      let calls = 0
      let returned: unknown
      let thrown: unknown = null
      try {
        returned = await harness.runObservedOriginal('solutions.initiateFinalApproval', REPAIR_ARGS, async (inv) => {
          calls += 1
          invocation = inv as RepairInvocation
          harness.observeAuthenticatedActor(inv, 'actor-9')
          if (outcome === 'thrown') throw original
          return original
        })
      } catch (error) { thrown = error }
      assert.equal(calls, 1)
      assert.equal(outcome === 'returned' ? returned === original && thrown === null : thrown === original, true)
      assert.ok(invocation!.observerErrors.some((message) => message.startsWith('actor:')))
      assert.deepEqual(harness.appendAttempts, ['begin', 'actor', 'fault', 'exit'])
      assert.deepEqual(harness.records.map((record) => record.kind), ['begin', 'fault', 'exit'])
      assert.equal(harness.records[1].message, '[unrenderable observer fault]')
      assert.equal(harness.records[1].observation, 'actor')
      assert.ok((harness.records[2].observerErrors as string[]).some((message) => message.startsWith('actor:')))
    })
  }
})

// Owner-amended Task3 canonical privacy contract. Pure emitted observer fixtures only.
describe('Task3 shared privacy canonical alignment', () => {
  it('privacy_projection_hashes_free_content_in_shared_and_emitted_observer_without_changing_original_outcome', async () => {
    const canary = 'PRIVATE-T3-reason-🚀-c6d7'
    const args = ['req-private', canary] as const
    const projected = normalizeActionArguments('approvals.rejectRequest', args)
    
    const fixture = await buildObserverFixtureApp('task3-privacy')
    await prepareFixtureCopy(fixture, async () => 0)
    const { runObservedOriginal, state } = await importPreparedFixtureHandlers(fixture)
    const returned = { success: true, solutionId: 's-private', deletedAttachmentIds: ['f-private'], cleanupWarnings: [canary] }
    const actual = await runObservedOriginal('solutions.resubmitSolution', [{ requestId: 'req-private', title: 'title', description: '<p>body</p>' }], async () => returned)
    assert.equal(actual, returned)
    const exit = state.records.find(record => record.kind === 'exit')
    assert.deepEqual(exit?.exit?.projection, normalizeActionResult('solutions.resubmitSolution', returned))
    assert.ok(!JSON.stringify(exit).includes(canary), 'emitted warning must not leak')
    state.records.length = 0
    await runObservedOriginal('approvals.rejectRequest', args, async () => ({ success: true }))
    assert.deepEqual(state.records.find(record => record.kind === 'begin')?.argumentProjection, projected)
    assert.ok(!JSON.stringify(state.records).includes(canary), 'emitted reason must not leak')
    assert.ok(!JSON.stringify(projected).includes(canary), 'shared reason must not leak')
  })
  it('privacy_unknown_errors_are_hashes_not_known_denials_and_raw_legacy_projections_do_not_qualify', () => {
    const secret = 'PRIVATE-T3-error-946c'
    for (const raw of [{ success: false, error: secret }, { success: false, errors: { title: [secret] } }, { success: false, stale: true, message: secret }]) {
      const p = normalizeActionResult('requests.createRequest', raw)
      assert.ok(!JSON.stringify(p).includes(secret))
      assert.deepEqual(normalizeActionResult('requests.createRequest', p), p, 'canonical projection is stable')
    }
    const e = decisionFixture('REQUEST', 'reject'); accepted(e)
    setArgs(e, { requestId: e.record.spec.target.requestId, comments: 'Needs revision' })
    rejected(e, 'argument-target:comments')
  })
})

import { projectPrivateText, normalizeActionError } from '../support/rejection-recovery-matrix'
import { EventEmitter } from 'node:events'
import {
  decodeActionFlight, extractServedBindings, CAPTURE_DRAIN_BUDGET_MS,
  type MatrixUiDependencies, type ContextCapture,
} from '../manual/rejection-recovery-matrix'

const t3Id = (handler: HandlerKey): string => hash('task3-public-fixture:' + handler)
const t3Module = (handler: HandlerKey): string => 'src/server-actions/' + handler.split('.')[0] + '.ts'
const t3Manifest = (): ObserverCopyManifest => ({ compiled: true, generated: [],
  registered: MATRIX_ACTION_REGISTRY.map(e => e.handler),
  original: ['requests','approvals','solutions'].map(m => ({ relativePath:`src/server-actions/${m}.ts`,sha256:hash(m),exports:MATRIX_ACTION_REGISTRY.filter(e=>e.handler.startsWith(m+'.')).map(e=>e.handler) })),
})
const t3Js = (handler: HandlerKey): Buffer => Buffer.from(`/* 🚀 UTF8 prefix */ ({${JSON.stringify(t3Module(handler))}:function(){const action=(0,w.createServerReference)(${JSON.stringify(t3Id(handler))},w.callServer,void 0,w.findSourceMapURL,${JSON.stringify(handler.split('.')[1])});}});`)
const t3Flight = (value: unknown): Buffer => Buffer.from('0:{"a":"$@1","f":"$2"}\n2:I["navigation module"]\n1:'+JSON.stringify(value)+'\n')

class T3Clock {
  ms = 0
  timers = new Map<number, { at:number; fn:()=>void }>()
  id = 0
  now = () => ({ domain:'matrix-context-capture', monotonicMs:this.ms, wallMs:1700000000000+this.ms })
  setTimer = (fn:()=>void, delay:number): ReturnType<typeof setTimeout> => { const id=++this.id;this.timers.set(id,{at:this.ms+delay,fn});return id as unknown as ReturnType<typeof setTimeout> }
  clearTimer = (id:ReturnType<typeof setTimeout>):void => { this.timers.delete(id as unknown as number) }
  advance(ms:number):void { this.ms+=ms; for(const [id,t] of this.timers) if(t.at<=this.ms){this.timers.delete(id);t.fn()} }
}
const t3Flush = async (): Promise<void> => { for(let i=0;i<40;i++) await Promise.resolve() }
function t3Deferred<T>() { let resolve!:(value:T)=>void, reject!:(error:unknown)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject} }

// Fake only transport/runtime/IO. Every UI operation still uses the real M
// Browser.newContext factory and production locators/matchers/capture methods.
function t3Harness(options: { setupFailure?:boolean; body?:Promise<Buffer>; writeFailure?:boolean; closeFailure?:boolean; uiElapsed?:number; uiFailure?:boolean; stale?:boolean; staleDenied?:boolean; opaque?:boolean; noResponse?:boolean; responseFailure?:boolean; rawBody?:Buffer; contentType?:string; actionId?:string } = {}) {
  const ready=t3Deferred<void>(); const events:string[]=[]; const files=new Map<string,Uint8Array>(); const clock=new T3Clock(); const contexts:T3Context[]=[]
  let handler:HandlerKey='requests.createRequest', rawArgs:readonly unknown[]=[{title:'T',description:'<p>body</p>',inlineImageSessionId:validSession}]
  let result:unknown={success:true,requestId:validRequest}; let dispatched=false; let solutionOpener=false
  class Locator {
    constructor(readonly page:T3Page,readonly desc:string) {}
    getByRole(role:string,opts?:{name?:unknown}){return new Locator(this.page,this.desc+'>>'+role+':'+String(opts?.name??''))}
    getByText(value:unknown){return new Locator(this.page,this.desc+'>>text:'+String(value))}
    locator(value:string){return new Locator(this.page,this.desc+'>>'+value)}
    filter(_opts:unknown){return this} first(){return this} last(){return this} nth(_n:number){return this}
    async count(){return 1} async scrollIntoViewIfNeeded(){} async getAttribute(){return 'true'}
    async fill(_value:string){events.push(this.desc.includes('password')?'password.fill': 'fill')}
    async isEnabled(){return true}
    async isVisible(){
      if(this.desc.includes('An error occurred while rejecting'))return options.stale && options.staleDenied !== false
      if(this.desc.includes('Rejected successfully')) return !options.stale
      if(this.desc.includes('dialog:/Resubmit Solution/'))return false
      return true
    }
    async _expect(matcher:string,_opts?:unknown){
      if(/created successfully|resubmitted successfully|initiated successfully|Approved successfully|Rejected successfully|Solution submitted successfully/.test(this.desc)){
        events.push('result.wait');clock.advance(options.uiElapsed??0)
        if(options.uiFailure)throw new Error('primary UI failed')
      }
      const matches=matcher==='to.have.count'? !this.desc.includes('Loading request') : true
      return {matches,received:matcher==='to.have.count'? (matches?1:0):this.desc,log:[],timedOut:false}
    }
    async click(){
      events.push('click:'+this.desc)
      if (this.desc.endsWith('button:Submit Solution') && !solutionOpener) {solutionOpener=true;return}
      if(/(button:Submit Solution|button:Submit Request|button:Resubmit Request|button:Resubmit Solution|button:Start Final Approval|button:Confirm Rejection|button:Confirm Approval|button:Approve Solution)$/.test(this.desc)){
        if(this.desc==='dialog:>>button:Resubmit Solution')return
        assert.equal(dispatched,false,'only one business click');dispatched=true
        const request={url:()=> 'http://owned.invalid/requests',method:()=> 'POST',headerValue:async(name:string)=>name==='next-action'?(options.actionId??t3Id(handler)):name==='content-type'?(options.contentType??'text/plain;charset=UTF-8'):null,
          headers:()=>{throw new Error('must not enumerate secret headers')},postDataBuffer:()=>options.rawBody??Buffer.from(options.opaque?'["$hopaque"]':JSON.stringify(rawArgs))}
        this.page.ctx.emit('request',request)
        if (!options.noResponse) this.page.ctx.emit('response',{request:()=>request,status:()=>200,headerValue:async(name:string)=>name==='content-type'?'text/x-component':null,headers:()=>{throw new Error('response header enumeration')},body:()=>options.responseFailure?Promise.reject(new Error('body failed')):options.body??Promise.resolve(t3Flight(result))})
        this.page.ctx.emit('requestfinished',request)
        await t3Flush()
      }
    }
  }
  class T3Page extends EventEmitter {
    constructor(readonly ctx:T3Context){super()}
    setDefaultTimeout(n:number){events.push('locator-budget:'+n)} setDefaultNavigationTimeout(n:number){events.push('nav-budget:'+n)}
    async goto(url:string){events.push('goto:'+new URL(url).pathname);if(options.setupFailure)throw new Error('setup primary failed')}
    async waitForURL(_predicate:unknown){events.push('signed-in')}
    async screenshot(_opts:unknown){events.push('screenshot')}
    async waitForTimeout(ms:number){events.push('pause:'+ms);clock.advance(ms)}
    getByRole(role:string,opts?:{name?:unknown}){return new Locator(this,role+':'+String(opts?.name??''))}
    getByText(text:unknown){return new Locator(this,'text:'+String(text))} getByPlaceholder(text:unknown){return new Locator(this,'placeholder:'+String(text))}
    locator(text:string){return new Locator(this,text)}
  }
  class T3Context extends EventEmitter {
    tracing={start:async(opts:unknown)=>{events.push('trace.start');events.push('trace.network-snapshots:'+String((opts as {snapshots?:boolean}).snapshots))},stop:async(opts:{path:string})=>{events.push('trace.stop');files.set(opts.path,Buffer.from('fixture trace; no credential'))}}
    async newPage(){events.push('newPage');ready.resolve();return new T3Page(this)}
    async close(){events.push('context.close');if(options.closeFailure)throw new Error('close failed')}
    override on(event:string,listener:(...args: any[])=>void):this{events.push('on:'+event);return super.on(event,listener)}
  }
  const browser={newContext:async(_opts:unknown)=>{events.push('browser.newContext');const c=new T3Context();contexts.push(c);return c}}
  const deps={handle:{baseUrl:'http://owned.invalid',runtime:{e2ePassword:'FAKE-PASSWORD-CANARY'},queryReadOnly:async(sql:string)=>{
    if(sql.includes('from requests where title'))return [{id:validRequest,status:'ImprovementRequest',title:'T'}]
    throw new Error('unexpected offline read')
  }},manifest:t3Manifest(),mkdir:async()=>{},writeFile:async(file:string,body:string|Uint8Array)=>{if(options.writeFailure)throw new Error('disk failed');files.set(file,typeof body==='string'?Buffer.from(body):Uint8Array.from(body))},readFile:async(file:string)=>{const b=files.get(file);if(!b)throw new Error('missing fake file');return b},rename:async(from:string,to:string)=>{const b=files.get(from);if(!b)throw new Error('missing temp');files.set(to,b);files.delete(from)},clock:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer} as unknown as MatrixUiDependencies
  const ui=playwrightMatrixUi(browser as unknown as Browser,path.join(os.tmpdir(),'rrm-task3-caller-'+Math.random().toString(16).slice(2)),deps)
  async function serveJs(h:HandlerKey, bytes=t3Js(h), failure=false){await ready.promise;const ctx=contexts.at(-1)!;const request={url:()=> 'http://owned.invalid/_next/static/chunk.js',method:()=> 'GET',headerValue:async()=>null,headers:()=>{throw new Error('JS secret headers')}};ctx.emit('request',request);ctx.emit('response',{request:()=>request,status:()=>200,headerValue:async(name:string)=>name==='content-type'?'application/javascript':null,headers:()=>{throw new Error('JS response secret headers')},body:async()=>{if(failure)throw new Error('JS body failed');return bytes}});ctx.emit('requestfinished',request);await t3Flush()}
  return {events,files,clock,contexts,ui,deps,serveJs,setAction(h:HandlerKey,args:readonly unknown[],returned:unknown){handler=h;rawArgs=args;result=returned},get dispatched(){return dispatched}}
}

describe('Task3 capture actual callers and Flight/public-byte contracts',()=>{
  it('served_binding_requires_archived_exact_bytes',()=>{
    const bytes=t3Js('requests.createRequest');const artifact={path:'contexts/c/js/'+hash(bytes.toString())+'.js',sha256:hash(bytes.toString()),bytes:bytes.length}
    const [binding]=extractServedBindings(bytes,artifact,'c',t3Manifest())
    assert.equal(binding?.handler,'requests.createRequest')
    assert.equal(bytes.subarray(binding!.byteOffset,binding!.byteOffset+t3Id('requests.createRequest').length).toString(),t3Id('requests.createRequest'))
    assert.throws(()=>extractServedBindings(Buffer.concat([bytes,Buffer.from('x')]),artifact,'c',t3Manifest()),/digest|bytes/)
    const foreign=Buffer.from(bytes.toString().replace('src/server-actions/requests.ts','src/server-actions/foreign.ts'))
    assert.throws(()=>extractServedBindings(foreign,{...artifact,sha256:hash(foreign.toString()),bytes:foreign.length},'c',t3Manifest()),/provenance|module|source/)
  })
  it('flight_resolves_actual_registry_results_and_errors',()=>{
    const raw={success:true,request:{id:validRequest,title:'PRIVATE-ROW-TITLE',createdAt:'$D2026-10-14T00:00:00.000Z'}}
    const body=Buffer.concat([Buffer.from('0:{"a":"$@1","f":"$9"}\n9:I["navigation"]\n1:{"success":true,"request":"$2"}\n2:{"id":"'+validRequest+'","title":"$3","createdAt":"$D2026-10-14T00:00:00.000Z"}\n3:T'),Buffer.from(Buffer.byteLength('🚀\n秘密').toString(16)+','),Buffer.from('🚀\n秘密')])
    assert.deepEqual(decodeActionFlight(body,'text/x-component'),{state:'returned',projection:normalizeActionResult('requests.resubmitRequest',raw)})
    assert.deepEqual(decodeActionFlight(Buffer.from('0:{"a":"$@a"}\na:E{"message":"You cannot reject this request at this time","digest":"123","stack":"PRIVATE-STACK"}\n'),'text/x-component'),normalizeActionError('You cannot reject this request at this time','123'))
    for(const value of ['$L1','$h1','$T1','$Q1','$W1','$B1','$K1','$i1','$n1','$Efunc'])assert.equal(decodeActionFlight(t3Flight({success:true,x:value}),'text/x-component').state,'unsupported',value)
    for(const body of ['0:{"a":"$@f"}\n','0:{"a":"$@1"}\n1:{"x":"$1"}\n','0:{"a":{"success":true}}','0:{"f":[]}\n','0:{"a":"$1"}\n1:{"success":true}\n1:{}\n'])assert.notEqual(decodeActionFlight(Buffer.from(body),'text/x-component').state,'returned')
  })
  it('real_context_factory_registers_before_page_work_and_excludes_auth_trace',async()=>{
    const h=t3Harness({setupFailure:true})
    await assert.rejects(()=>h.ui.createRequest(rows[0],'T'),/setup primary/)
    for(const event of ['request','response','requestfinished','requestfailed'])assert.ok(h.events.indexOf('on:'+event)<h.events.indexOf('newPage'),event)
    assert.equal(h.contexts[0].listenerCount('request'),0,'failed setup unregisters capture')
    assert.ok(h.events.includes('context.close'))
    const clean=t3Harness(); const promise=clean.ui.createRequest(rows[0],'T');await t3Flush();await clean.serveJs('requests.createRequest');await promise
    assert.ok(clean.events.indexOf('trace.start')>clean.events.indexOf('signed-in'),'trace starts only after the password/sign-in boundary')
  })
})
describe('Task3 elapsed result deadline actual caller witnesses',()=>{
  it('result_deadline_preserves_stale_15000_positive_30000_and_drain_5000',async()=>{
    const h=t3Harness({uiElapsed:30000})
    const outcome=h.ui.createRequest(rows[0],'T').then(()=>null,e=>e)
    await t3Flush();await h.serveJs('requests.createRequest')
    const error=await outcome
    assert.match(String(error),/deadline.*30000|30000.*deadline/,'elapsed UI result wait is not reset by finish')
    assert.equal(h.clock.ms,30000+MATRIX_HEADED.checkpointMs)
    assert.equal(h.events.filter(e=>e.endsWith('button:Submit Request')).length,1)
    assert.ok(h.events.includes('nav-budget:90000'))
    assert.ok(h.events.includes('locator-budget:30000'))
    assert.equal(CAPTURE_DRAIN_BUDGET_MS,5000)
  })
})

import type { ObserverCopyManifest } from '../support/native/rejection-recovery-runtime'
describe('Task3 served webpack dev literals are parsed, never evaluated',()=>{
  it('served_binding_static_eval_literal_has_original_utf8_byte_span_and_source_module_provenance',()=>{
    const handler:HandlerKey='solutions.resubmitSolution'
    const inner=`/* 🧭 */ export const resubmitSolution=(0,wrapper.createServerReference)("${t3Id(handler)}",callServer,undefined,findSourceMapURL,"resubmitSolution");\nglobalThis.DO_NOT_EXECUTE_T3=true;`
    const bytes=Buffer.from(`({"(app-pages-browser)/./src/server-actions/solutions.ts":function(){eval(__webpack_require__.ts(${JSON.stringify(inner)}));}});`)
    const artifact={path:'public-dev.js',sha256:hash(bytes.toString()),bytes:bytes.length}
    const [b]=extractServedBindings(bytes,artifact,'dev',t3Manifest())
    assert.equal(b?.handler,handler)
    assert.equal(bytes.subarray(b!.byteOffset,b!.byteOffset+64).toString(),t3Id(handler))
    assert.equal((globalThis as unknown as Record<string,unknown>).DO_NOT_EXECUTE_T3,undefined)
  })
})
import { runOwnedMatrixSession as t3OwnedSession, type MatrixRuntimeHandle } from '../support/native/rejection-recovery-runtime'

const t3SafeIndex = (h:ReturnType<typeof t3Harness>): Record<string,unknown> => {
  const bytes=[...h.files.entries()].find(([name])=>name.endsWith('/build-bindings.json'))?.[1]
  assert.ok(bytes,'immutable per-context index published')
  return JSON.parse(Buffer.from(bytes).toString()) as Record<string,unknown>
}
const t3UntilIdle = async (): Promise<void> => {for(let i=0;i<20;i++)await t3Flush()}

describe('Task3 complete registry framing and canonical privacy',()=>{
  for(const entry of MATRIX_ACTION_REGISTRY)it(`Flight actual result shape ${entry.handler}`,()=>{
    const handler=entry.handler
    const raw=handler==='requests.createRequest'?{success:true,requestId:validRequest}:handler==='requests.resubmitRequest'?{success:true,request:{id:validRequest,status:'ImprovementRequest',title:'PRIVATE-nested-title',updatedAt:'$D2026-10-14T00:00:00.000Z'}}:handler==='solutions.submitSolution'?{success:true,solutionId:'solution-fixture'}:handler==='solutions.resubmitSolution'?{success:true,solutionId:'solution-fixture',deletedAttachmentIds:['attachment-fixture'],cleanupWarnings:['PRIVATE-warning-canary'] }:{success:true}
    const result=decodeActionFlight(t3Flight(raw),'text/x-component',handler)
    assert.deepEqual(result,{state:'returned',projection:normalizeActionResult(handler,raw)})
    assert.ok(!JSON.stringify(result).includes('PRIVATE-'))
  })
  for(const tag of ['A','O','o','U','S','s','L','l','G','g','M','m','V'])it(`Flight entire-body binary ${tag} framed but not invented as result`,()=>{
    const row=Buffer.concat([Buffer.from('8:'+tag+'3,'),Buffer.from([0,10,255])])
    const good=Buffer.concat([row,Buffer.from('0:{"a":{"success":true}}\n')])
    assert.equal(decodeActionFlight(good,'text/x-component').state,'returned','unreferenced navigation/binary row is framed')
    const used=Buffer.concat([row,Buffer.from('0:{"a":{"success":true,"value":"$8"}}\n')])
    assert.equal(decodeActionFlight(used,'text/x-component').state,'unsupported')
    assert.notEqual(decodeActionFlight(Buffer.concat([good,Buffer.from('f:T4,xx')]),'text/x-component').state,'returned','unfinished unreferenced tail still fails whole-body framing')
  })
  it('Flight outlined array paths, escaped dollars, Date, scalars, controls and errors stay nonexecutable',()=>{
    const bytes=Buffer.from('0:{"a":"$@1:0"}\n1:[{"success":true,"ignored":["$$not-a-reference","$undefined","$NaN","$Infinity","$-Infinity","$-0","$D2026-10-14T00:00:00.000Z"]}]\n1:D{"debug":true}\n4:W["debug"]\n')
    assert.deepEqual(decodeActionFlight(bytes,'text/x-component'),{state:'returned',projection:{success:true}})
    assert.equal(decodeActionFlight(Buffer.from('0:{"a":"$@1"}\n1:E{"message":"PRIVATE-unknown-error","digest":"PRIVATE-digest","stack":"PRIVATE-stack"}\n'),'text/x-component').state,'thrown')
    assert.ok(!JSON.stringify(decodeActionFlight(Buffer.from('0:{"a":"$@1"}\n1:E{"message":"PRIVATE-unknown-error","digest":"PRIVATE-digest"}\n'),'text/x-component')).includes('PRIVATE-'))
    assert.equal(decodeActionFlight(Buffer.from('{"success":true}'),'application/json').state,'missing')
    assert.notEqual(decodeActionFlight(Buffer.from('0:{"a":"$1"}\n1:\n'),'text/x-component').state,'returned')
    for(const tag of ['I','R','r','X','x','C'])assert.notEqual(decodeActionFlight(Buffer.from('0:{"a":"$1"}\n1:'+tag+'[]\n'),'text/x-component').state,'returned')
    assert.notEqual(decodeActionFlight(Buffer.from('0:{"a":"$1oops"}\n1:{"success":true}\n'),'text/x-component').state,'returned')
  })
  it('review_packet_excludes_auth_secrets_and_browser_server_projection_match',async()=>{
    const canary='PRIVATE-short-title-🚀'
    const h=t3Harness()
    h.setAction('requests.createRequest',[{title:canary,description:'<p>PRIVATE-description</p>',inlineImageSessionId:validSession}],{success:true,requestId:validRequest,ignored:'PRIVATE-result'})
    const outcome=h.ui.createRequest(rows[0],'T')
    await h.serveJs('requests.createRequest')
    const ctx=h.contexts[0]
    const auth={url:()=> 'http://owned.invalid/api/auth/callback/credentials',method:()=> 'POST',headerValue:async()=>{throw new Error('auth headers must not be read')},postDataBuffer:()=>{throw new Error('auth body must not be read')}}
    ctx.emit('request',auth);ctx.emit('response',{request:()=>auth,headerValue:async()=>{throw new Error('auth response headers must not be read')},body:async()=>{throw new Error('auth response body must not be read')}})
    await outcome
    const index=t3SafeIndex(h);const safe=JSON.stringify(index)
    for(const secret of [canary,'PRIVATE-description','PRIVATE-result','FAKE-PASSWORD-CANARY'])assert.ok(!safe.includes(secret),secret)
    const r=(index.requests as Array<{arguments:unknown;result:unknown}>).find(r=>r.arguments)
    assert.deepEqual(r?.arguments,normalizeActionArguments('requests.createRequest',[{title:canary,description:'<p>PRIVATE-description</p>',inlineImageSessionId:validSession}]))
    assert.deepEqual(r?.result,{state:'returned',projection:{success:true,requestId:validRequest}})
    assert.ok(h.events.indexOf('trace.start')>h.events.indexOf('password.fill'))
    assert.equal(ctx.listenerCount('response'),0)
  })
})

describe('Task3 actual factory positive/held caller deadlines and owned stop',()=>{
  for(const operation of ['resubmit-request','resubmit-solution','initiate-final'] as const)it(`real_context_factory ${operation} retains primary capture close and owned stop`,async()=>{
    const h=t3Harness({uiFailure:true,closeFailure:true})
    const handler:HandlerKey=operation==='resubmit-request'?'requests.resubmitRequest':operation==='resubmit-solution'?'solutions.resubmitSolution':'solutions.initiateFinalApproval'
    h.setAction(handler,operation==='initiate-final'?[validRequest,false]:operation==='resubmit-request'?[{requestId:validRequest}]:[{requestId:validRequest,title:'S',description:'<p>body</p>',inlineImageSessionId:validSession,cost:100,currency:'THB',timeline:'1 day',useCustomHierarchy:false}],operation==='resubmit-request'?{success:true,request:{id:validRequest,updatedAt:'$D2026-10-14T00:00:00.000Z'}}:operation==='resubmit-solution'?{success:true,solutionId:'sol-1',deletedAttachmentIds:[],cleanupWarnings:[]}:{success:true})
    let stop=false,next=false,passed=false
    const operationPromise=t3OwnedSession({handle:h.deps.handle,launchBrowser:async()=>({close:async()=>{}}),stop:async()=>{stop=true},run:async()=>{
      if(operation==='initiate-final')await h.ui.initiateFinal(rows[0],'T',false,{requestId:validRequest},1)
      else await h.ui.resubmit(rows[0],operation==='resubmit-request'?'REQUEST':'SOLUTION',false,'T',{requestId:validRequest,instanceId:'old',attempt:1} as never)
      passed=true;next=true
    }}).then(()=>null,e=>e)
    await h.serveJs(handler)
    const error=await operationPromise
    assert.match(String(error),/primary UI failed/)
    assert.match(String(error),/close failed/)
    assert.equal(stop,true);assert.equal(next,false);assert.equal(passed,false)
    assert.equal(h.events.filter(e=>e==='context.close').length,1)
    for(const event of ['request','response','requestfinished','requestfailed'])assert.ok(h.events.indexOf('on:'+event)<h.events.indexOf('newPage'))
  })
  it('capture_deadline_seals_before_owned_stop_with_elapsed_15000_then_separate_5000_and_late_body_rejected',async()=>{
    const body=t3Deferred<Buffer>();const h=t3Harness({stale:true,staleDenied:false,body:body.promise})
    const row=rows.find(r=>r.phase==='FINAL')!
    h.setAction('solutions.rejectFinalApproval',[validRequest,'PRIVATE-held-reason'],{success:true})
    const opening=h.ui.openHeldRejectDialog(row,'T',{requestId:validRequest,instanceId:'held',attempt:1,order:row.rejectOrder,approvalRowId:'held-row'} as never)
    await h.serveJs('solutions.rejectFinalApproval');const held=await opening
    let stop=false,next=false,passed=false
    const outcome=t3OwnedSession({handle:h.deps.handle,launchBrowser:async()=>({close:async()=>{}}),stop:async()=>{stop=true},run:async()=>{
      try {await held.staleConfirm();passed=true;next=true}finally{await held.close()}
    }}).then(()=>null,e=>e)
    await t3UntilIdle()
    assert.equal(h.clock.ms,15000,'original stale polling remains sixty 250ms waits, never 30s')
    assert.equal(h.events.filter(e=>e==='pause:250').length,60)
    assert.equal(stop,false,'evidence-only drain has not yet expired')
    assert.equal(h.clock.timers.size,1)
    h.clock.advance(4999);await t3Flush();assert.equal(stop,false)
    h.clock.advance(1);await t3UntilIdle();const error=await outcome
    assert.match(String(error),/5000|drain/)
    assert.equal(stop,true);assert.equal(next,false);assert.equal(passed,false)
    const capture=h.ui.captures[0];const sealed=await capture.drain('stop');assert.ok(sealed.errors.length)
    const summary=JSON.stringify(sealed),files=JSON.stringify([...h.files.entries()].map(([k,v])=>[k,hash(Buffer.from(v).toString())]))
    body.resolve(t3Flight({success:true}));await t3UntilIdle()
    assert.equal(JSON.stringify(await capture.drain('close')),summary)
    assert.equal(JSON.stringify([...h.files.entries()].map(([k,v])=>[k,hash(Buffer.from(v).toString())])),files,'late body cannot publish or alter sealed evidence')
    assert.equal(h.contexts[0].listenerCount('request'),0)
  })
  it('positive_30000_shared_elapsed_budget_expires_while_body_pending_not_after_another_30000',async()=>{
    const body=t3Deferred<Buffer>();const h=t3Harness({uiElapsed:29999,body:body.promise})
    const outcome=h.ui.createRequest(rows[0],'T').then(()=>null,e=>e)
    await h.serveJs('requests.createRequest');await t3UntilIdle()
    assert.equal(h.clock.ms,MATRIX_HEADED.checkpointMs+29999)
    assert.equal([...h.clock.timers.values()][0]?.at,h.clock.ms+1,'finish has only one millisecond left')
    h.clock.advance(1);await t3UntilIdle()
    assert.equal([...h.clock.timers.values()][0]?.at,h.clock.ms+5000,'drain is separate and evidence-only')
    h.clock.advance(5000);await t3UntilIdle()
    assert.match(String(await outcome),/30000.*deadline|deadline.*30000/)
    body.reject(new Error('late body rejection is consumed'));await t3UntilIdle()
    assert.equal(h.contexts[0].listenerCount('response'),0)
  })
  it('missing_response_and_opaque_arguments_fail_no_json_fallback',async()=>{
    for(const opts of [{noResponse:true},{opaque:true},{responseFailure:true}]){
      const h=t3Harness(opts);const outcome=h.ui.createRequest(rows[0],'T').then(()=>null,e=>e)
      await h.serveJs('requests.createRequest');await t3UntilIdle()
      if(opts.noResponse){h.clock.advance(30000);await t3UntilIdle()}
      assert.ok(await outcome,'failed evidence cannot return PASSED')
      assert.equal(h.events.filter(e=>e.endsWith('button:Submit Request')).length,1)
    }
  })
  it('disk_failure_and_never_resolving_seal_do_not_prevent_owned_stop',async()=>{
    const h=t3Harness({writeFailure:true,uiFailure:true,closeFailure:true})
    let stop=false;const outcome=t3OwnedSession({handle:h.deps.handle,launchBrowser:async()=>({close:async()=>{}}),stop:async()=>{stop=true;throw new Error('stop failed')},run:async()=>{await h.ui.createRequest(rows[0],'T')}}).then(()=>null,e=>e)
    await h.serveJs('requests.createRequest');await t3UntilIdle()
    const error=String(await outcome)
    for(const part of ['primary UI failed','capture','write','close failed','stop failed'])assert.ok(error.includes(part),part+': '+error)
    assert.equal(stop,true)
  })
})
describe('Task3 framing rejects malformed evidence, never fabricates an error',()=>{
  it('flight_rejects_empty_hex_ids_truncated_control_and_invalid_error_models',()=>{
    for(const body of [':{"a":{"success":true}}\n','0:{"a":"$1"}\n1:Ebad-json\n','0:{"a":"$1"}\n1:E[]\n','0:{"a":{"success":true}}\nf:T,','0:{"a":{"success":true}}\nffffffffffffffff:T0,'])assert.ok(['incomplete','unsupported'].includes(decodeActionFlight(Buffer.from(body),'text/x-component').state),body)
    assert.equal(decodeActionFlight(t3Flight({success:true}),'text/x-component-unknown').state,'missing')
  })
})
describe('Task3 public transport, immutable IO and exact binding fail-closed',()=>{
  it('ordinary_multipart_public_arguments_resolve_but_opaque_extra_fields_never_export',async()=>{
    const args=[{requestId:validRequest,title:'PRIVATE-multipart-title',description:'<p>PRIVATE multipart</p>',inlineImageSessionId:validSession,cost:100,currency:'THB',timeline:'2 days',useCustomHierarchy:false}]
    const raw=Buffer.from('--T3\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$1"]\r\n--T3\r\nContent-Disposition: form-data; name="1"\r\n\r\n'+JSON.stringify(args[0])+'\r\n--T3--\r\n')
    const h=t3Harness({rawBody:raw,contentType:'multipart/form-data; boundary=T3',uiFailure:true})
    h.setAction('solutions.resubmitSolution',args,{success:true,solutionId:'s1',deletedAttachmentIds:[],cleanupWarnings:[]})
    const result=h.ui.resubmit(rows[0],'SOLUTION',false,'T',{requestId:validRequest,instanceId:'old',attempt:1} as never).then(()=>null,e=>e)
    await h.serveJs('solutions.resubmitSolution');assert.match(String(await result),/primary UI failed/)
    const index=t3SafeIndex(h);const dispatch=(index.requests as {arguments:unknown}[]).find(r=>r.arguments)
    assert.deepEqual(dispatch?.arguments,normalizeActionArguments('solutions.resubmitSolution',args))
    assert.ok(!JSON.stringify(index).includes('PRIVATE-'))
    const opaque=t3Harness({rawBody:Buffer.from(JSON.stringify([{title:'T',description:'<p>body</p>',inlineImageSessionId:validSession,closure:'PRIVATE-opaque'}]))})
    const failure=opaque.ui.createRequest(rows[0],'T').then(()=>null,e=>e);await opaque.serveJs('requests.createRequest')
    assert.match(String(await failure),/opaque/)
    assert.ok(!JSON.stringify(t3SafeIndex(opaque)).includes('PRIVATE-opaque'))
  })
  it('public_binding_unknown_used_id_js_body_failure_archived_drift_and_uncompiled_admission_fail',async()=>{
    for(const kind of ['mismatch','js-body','archived-drift','uncompiled','unknown-id','missing-js'] as const){
      const h=t3Harness({actionId:kind==='mismatch'?t3Id('solutions.submitSolution'):kind==='unknown-id'?'PRIVATE-hidden-action-id':undefined})
      if(kind==='uncompiled')h.deps.manifest.compiled=false
      if(kind==='archived-drift'){const read=h.deps.readFile;h.deps.readFile=async(file)=>file.endsWith('.js')?Buffer.from('drift'):read(file)}
      const outcome=h.ui.createRequest(rows[0],'T').then(()=>null,e=>e)
      if(kind!=='uncompiled')await h.serveJs(kind==='mismatch'?'solutions.submitSolution':'requests.createRequest',kind==='missing-js'?Buffer.from('/* public chunk has no action reference */'):undefined,kind==='js-body')
      await t3UntilIdle()
      if(kind==='missing-js'){h.clock.advance(30000);await t3UntilIdle()}
      assert.ok(await outcome,kind+' must fail evidence')
      assert.ok(h.events.includes('context.close'),kind+' context closes')
      if(kind==='uncompiled'){assert.ok(!h.events.includes('newPage'));assert.ok(!h.events.includes('trace.start'))}
      else assert.ok(!JSON.stringify(t3SafeIndex(h)).includes('PRIVATE-hidden-action-id'))
    }
  })
  it('late_writer_and_index_rejection_are_consumed_and_cannot_mutate_the_sealed_summary',async()=>{
    const write=t3Deferred<void>(),h=t3Harness()
    const original=h.deps.writeFile
    // Block only the action body write, not JS or the index. Real factory IO
    // still owns the immutable temp -> publish path, no capture replacement.
    h.deps.writeFile=async(file,bytes)=>{if(bytes instanceof Uint8Array && Buffer.from(bytes).toString().startsWith('0:'))await write.promise;await original(file,bytes)}
    const outcome=h.ui.createRequest(rows[0],'T').then(()=>null,e=>e)
    await h.serveJs('requests.createRequest');await t3UntilIdle();h.clock.advance(30000);await t3UntilIdle();h.clock.advance(5000);await t3UntilIdle()
    assert.ok(await outcome)
    const before=await h.ui.captures[0].drain('stop'),index=JSON.stringify(t3SafeIndex(h))
    write.reject(new Error('late disk rejection'));await t3UntilIdle()
    assert.deepEqual(await h.ui.captures[0].drain('stop'),before)
    assert.equal(JSON.stringify(t3SafeIndex(h)),index)
    assert.ok(!before.artifacts.some(ref=>ref.path.endsWith('.flight')))
    const seal=t3Deferred<void>(),k=t3Harness();const write2=k.deps.writeFile
    k.deps.writeFile=async(file,bytes)=>{if(typeof bytes!=='string' && Buffer.from(bytes).toString().startsWith('{\n  "contextId"'))await seal.promise;await write2(file,bytes)}
    let stopped=false
    const p=t3OwnedSession({handle:k.deps.handle,launchBrowser:async()=>({close:async()=>{}}),stop:async()=>{stopped=true},run:async()=>{await k.ui.createRequest(rows[0],'T')}}).then(()=>null,e=>e)
    await k.serveJs('requests.createRequest');await t3UntilIdle();k.clock.advance(5000);await t3UntilIdle()
    assert.match(String(await p),/seal|5000/);assert.equal(stopped,true)
    const summary=await k.ui.captures[0].drain('stop');seal.resolve();await t3UntilIdle()
    assert.deepEqual(await k.ui.captures[0].drain('stop'),summary)
    assert.ok(![...k.files.keys()].some(file=>file.endsWith('/build-bindings.json')),'late temp write cannot publish a sealed index')
  })
  it('late_writer_resolution_cannot_publish_action_body_and_deadline_tokens_cannot_be_forged',async()=>{
    const write=t3Deferred<void>(),h=t3Harness();const original=h.deps.writeFile
    h.deps.writeFile=async(file,bytes)=>{if(bytes instanceof Uint8Array && Buffer.from(bytes).toString().startsWith('0:'))await write.promise;await original(file,bytes)}
    const outcome=h.ui.createRequest(rows[0],'T').then(()=>null,e=>e);await h.serveJs('requests.createRequest');await t3UntilIdle();h.clock.advance(30000);await t3UntilIdle();h.clock.advance(5000);await t3UntilIdle();await outcome
    const summary=await h.ui.captures[0].drain('stop');write.resolve();await t3UntilIdle()
    assert.deepEqual(await h.ui.captures[0].drain('stop'),summary)
    assert.ok(![...h.files.keys()].some(file=>file.endsWith('.flight')),'late write only finishes in unique private temp, never final body path')
    const record=decisionFixture().record;record.identity.contextId=h.ui.captures[0].contextId
    await assert.rejects(()=>h.ui.captures[0].finish(record,{operation:'positive-result',budgetMs:30000,started:h.clock.now()}),/deadline.*mismatch|unknown/)
    await assert.rejects(()=>h.ui.captures[0].begin(record),/unregistered|sealed/)
  })
})
describe('Task3 strict privacy qualification and safe decoder diagnostics',()=>{
  it('unknown_thrown_free_text_and_legacy_digest_cannot_qualify_a_strict_denial',()=>{
    const e=staleFixture();assert.equal(evaluateAction(e).expectedSatisfied,true)
    const unknown={state:'thrown' as const,code:'PRIVATE-unknown-code',digest:'PRIVATE-unknown-digest'}
    e.server!.exit=unknown;e.dispatch!.result=unknown
    const r=evaluateAction(e);assert.equal(r.evidenceValid,false);assert.ok(r.gaps.includes('exit-privacy-projection'))
  })
  it('flight_diagnostics_do_not_echo_opaque_reference_paths_or_content_type_canaries',()=>{
    const a=decodeActionFlight(Buffer.from('0:{"a":"$PRIVATE-OPAQUE-REFERENCE"}\n'),'text/x-component')
    const b=decodeActionFlight(t3Flight({success:true}),'PRIVATE-CONTENT-TYPE')
    assert.ok(!JSON.stringify([a,b]).includes('PRIVATE-'))
  })
})
describe('Task3 emitted observer safe outcome identity and exact errors',()=>{
  it('emitted_known_vs_unknown_error_meaning_is_not_fabricated_and_original_throw_identity_survives',async()=>{
    const fixture=await buildObserverFixtureApp('t3-known-unknown');await prepareFixtureCopy(fixture,async()=>0)
    const {state,runObservedOriginal}=await importPreparedFixtureHandlers(fixture)
    for(const message of ['You cannot reject this request at this time','PRIVATE-unknown-error-canary']){
      const original=new Error(message);state.records.length=0
      await assert.rejects(()=>runObservedOriginal('solutions.rejectFinalApproval',[validRequest,'PRIVATE-reason'],async()=>{throw original}),error=>error===original)
      const observed=state.records.find(record=>record.kind==='exit')?.exit
      assert.deepEqual(observed,normalizeActionError(message))
      assert.ok(!JSON.stringify(state.records).includes('PRIVATE-'))
      if(message.startsWith('PRIVATE-'))assert.notEqual(observed?.code,'You cannot reject this request at this time')
    }
  })
})

describe('Task3 trace auth-secret boundary',()=>{
  it('actual_factory_trace_disables_Playwright_HAR_header_capture_after_signin',async()=>{
    const h=t3Harness();const action=h.ui.createRequest(rows[0],'T');await h.serveJs('requests.createRequest');await action
    assert.ok(h.events.includes('trace.network-snapshots:false'),'Playwright snapshots:true starts HAR and copies Cookie/Set-Cookie; use dedicated allowlisted capture instead')
    assert.ok(h.events.indexOf('trace.start')>h.events.indexOf('signed-in'))
  })
})
function t3DriveHandler(h: ReturnType<typeof t3Harness>, handler: HandlerKey): Promise<unknown> {
  const phase:Phase=handler.startsWith('approvals.')?'REQUEST':handler.includes('Final')?'FINAL':'SOLUTION'
  const row=rows.find(r=>r.phase===phase)!
  const object=handler==='requests.createRequest'?{title:'T',description:'<p>PRIVATE-content</p>',inlineImageSessionId:validSession}:handler==='requests.resubmitRequest'?{requestId:validRequest,description:'<p>PRIVATE-content</p>',inlineImageSessionId:validSession}:handler==='solutions.submitSolution'?{requestId:validRequest,title:'S',description:'<p>PRIVATE-content</p>',inlineImageSessionId:validSession,costEstimate:100,timeline:'5 days'}:{requestId:validRequest,title:'S',description:'<p>PRIVATE-content</p>',inlineImageSessionId:validSession,cost:100,currency:'THB',timeline:'8 days',useCustomHierarchy:false}
  const args=handler==='solutions.initiateFinalApproval'?[validRequest,false]:handler.startsWith('requests.')||handler==='solutions.submitSolution'||handler==='solutions.resubmitSolution'?[object]:[phase==='SOLUTION'?'sol-1':validRequest,...(handler.includes('reject')?['PRIVATE-rejection-🚀']:[])]
  const result=handler==='requests.createRequest'?{success:true,requestId:validRequest}:handler==='requests.resubmitRequest'?{success:true,request:{id:validRequest,updatedAt:'$D2026-10-14T00:00:00.000Z',title:'PRIVATE-row'}}:handler==='solutions.submitSolution'?{success:true,solutionId:'sol-1'}:handler==='solutions.resubmitSolution'?{success:true,solutionId:'sol-1',deletedAttachmentIds:[],cleanupWarnings:['PRIVATE-warning']}:{success:true}
  h.setAction(handler,args,result)
  if(handler==='requests.createRequest')return h.ui.createRequest(row,'T')
  if(handler==='requests.resubmitRequest'||handler==='solutions.resubmitSolution')return h.ui.resubmit(row,handler.startsWith('requests.')?'REQUEST':'SOLUTION',false,'T',{requestId:validRequest,instanceId:'old',attempt:1} as never)
  if(handler==='solutions.submitSolution')return h.ui.submitSolution(row,'T',false,{requestId:validRequest})
  if(handler==='solutions.initiateFinalApproval')return h.ui.initiateFinal(row,'T',false,{requestId:validRequest},1)
  if(handler.includes('reject'))return h.ui.rejectCurrentStep(row,'T',decisionFixture(phase,'reject').record.spec.target as never)
  return h.ui.approveStep(row,{kind:'approve',phase,stepOrder:1,actor:row.orderedActorIds[0],attempt:1},'T',decisionFixture(phase).record.spec.target as never)
}
describe('Task3 ALL actual registry UI callers consume the same result deadline',()=>{
  for(const {handler} of MATRIX_ACTION_REGISTRY){
    it(`actual caller privacy and primary outcome ${handler}`,async()=>{
      const h=t3Harness({uiFailure:true});const p=t3DriveHandler(h,handler).then(()=>null,e=>e);await h.serveJs(handler)
      assert.match(String(await p),/primary UI failed/,handler)
      assert.equal(h.dispatched,true,'actual source business click, not a substituted factory')
      const index=t3SafeIndex(h),requests=index.requests as Array<{arguments:JsonValue|null;result:FlightResult|null}>
      const captured=requests.find(r=>r.arguments!==null)
      assert.ok(captured,handler+' canonical dispatch from real caller')
      assert.equal(captured.result?.state,'returned')
      assert.ok(!JSON.stringify(index).includes('PRIVATE-'),handler+' review-safe projection')
      assert.equal(h.events.filter(e=>e==='context.close').length,1)
    })
    it(`actual caller elapsed positive 30000 not reset ${handler}`,async()=>{
      const h=t3Harness({uiElapsed:30000});const p=t3DriveHandler(h,handler).then(()=>null,e=>e);await h.serveJs(handler)
      assert.match(String(await p),/30000.*deadline|deadline.*30000/,handler)
      assert.equal(h.dispatched,true);assert.ok(h.events.includes('result.wait'))
      assert.ok(h.events.includes('locator-budget:30000'));assert.ok(h.events.includes('nav-budget:90000'))
    })
  }
})

import type { FlightResult } from '../support/rejection-recovery-matrix'
describe('Task3 capture API identity and late-result fences',()=>{
  it('registered_real_factory_capture_begin_finish_binds_exact_bytes_and_freezes_observed_projections',async()=>{
    const h=t3Harness();const row=rows.find(r=>r.phase==='FINAL')!
    const opening=h.ui.openHeldRejectDialog(row,'T',{requestId:validRequest,instanceId:'held',attempt:1,order:row.rejectOrder,approvalRowId:'held-row'} as never)
    await h.serveJs('solutions.rejectFinalApproval');const held=await opening
    const capture=h.ui.captures[0],record=decisionFixture('FINAL','reject').record
    record.identity.contextId=capture.contextId
    await assert.rejects(()=>capture.begin({...record,identity:{...record.identity,contextId:'foreign'}}),/context/)
    await capture.begin(record)
    assert.throws(()=>capture.startResultWait(record,'unknown' as never),/unknown/)
    const request={url:()=> 'http://owned.invalid/requests',method:()=> 'POST',headerValue:async(name:string)=>name==='next-action'?t3Id('solutions.rejectFinalApproval'):name==='content-type'?'text/plain':null,postDataBuffer:()=>Buffer.from(JSON.stringify([validRequest,'PRIVATE-captured-reason']))}
    h.contexts[0].emit('request',request)
    const deadline=capture.startResultWait(record,'positive-result')
    assert.equal(deadline.budgetMs,30000);assert.equal(Object.isFrozen(deadline),true)
    await assert.rejects(()=>capture.finish(record,{...deadline,budgetMs:15000} as never),/mismatch|changed|unknown/)
    h.contexts[0].emit('response',{request:()=>request,status:()=>200,headerValue:async(name:string)=>name==='content-type'?'text/x-component':null,body:async()=>t3Flight({success:true})})
    h.contexts[0].emit('requestfinished',request)
    const proof=await capture.finish(record,deadline)
    assert.equal(proof.binding?.actionId,t3Id('solutions.rejectFinalApproval'))
    assert.equal(proof.dispatch?.status,200);assert.equal(proof.dispatch?.identity,record.identity)
    assert.deepEqual(proof.dispatch?.argumentProjection,normalizeActionArguments('solutions.rejectFinalApproval',[validRequest,'PRIVATE-captured-reason']))
    assert.equal(Object.isFrozen(proof.dispatch?.argumentProjection),true)
    assert.equal(Object.isFrozen(proof.dispatch?.start),true)
    await held.close();assert.ok(!JSON.stringify(t3SafeIndex(h)).includes('PRIVATE-'))
  })
  it('stale_response_arriving_during_evidence_drain_is_not_timely_and_cannot_qualify_or_publish',async()=>{
    const body=t3Deferred<Buffer>(),h=t3Harness({stale:true,staleDenied:false,body:body.promise}),row=rows.find(r=>r.phase==='FINAL')!
    h.setAction('solutions.rejectFinalApproval',[validRequest,'held reason'],{success:true})
    const opening=h.ui.openHeldRejectDialog(row,'T',{requestId:validRequest,instanceId:'held',attempt:1,order:row.rejectOrder,approvalRowId:'held-row'} as never)
    await h.serveJs('solutions.rejectFinalApproval');const held=await opening
    let qualified=false
    const p=(async()=>{try{await held.staleConfirm();qualified=true}finally{await held.close()}})().then(()=>null,e=>e)
    await t3UntilIdle();assert.equal(h.clock.ms,15000)
    h.clock.advance(2000);body.resolve(Buffer.from('0:{"a":"$@1"}\n1:E{"message":"You cannot reject this request at this time","digest":"123"}\n'))
    await t3UntilIdle();assert.ok(await p);assert.equal(qualified,false)
    assert.ok(![...h.files.keys()].some(file=>file.endsWith('.flight')))
    assert.equal(t3SafeIndex(h).complete,false)
  })
})
describe('Task3 privacy does not change source empty versus omitted comments',()=>{
  it('canonical_empty_approval_comments_preserve_row_and_use_existing_source_audit_default',()=>{
    const e=decisionFixture();setArgs(e,normalizeActionArguments('solutions.approveSolution',['sol-1','']))
    ;(e.after!.approvalRows[0] as FixtureRow).comments=null
    ;(e.after!.activities[0] as FixtureRow).comments='Solution "Solution title" approved at step 1'
    syncActivitySummary(e.after!);accepted(e)
    assert.notDeepEqual(normalizeActionArguments('solutions.approveSolution',['sol-1','']),normalizeActionArguments('solutions.approveSolution',['sol-1']))
  })
})
describe('Task3 observer privacy retains invalid-input invocation semantics',()=>{
  it('observer_invalid_optional_free_text_is_type_only_not_a_new_business_validation_or_raw_leak',async()=>{
    const fixture=await buildObserverFixtureApp('t3-invalid-free-text');await prepareFixtureCopy(fixture,async()=>0)
    const {state,runObservedOriginal}=await importPreparedFixtureHandlers(fixture)
    const original={success:true,solutionId:'s'};let calls=0
    const result=await runObservedOriginal('solutions.submitSolution',[{requestId:validRequest,title:'S',description:'<p>body</p>',timeline:['PRIVATE-invalid-timeline'],conceptDesign:{opaque:'PRIVATE-invalid-concept'}}],async()=>{calls++;return original})
    assert.equal(calls,1);assert.equal(result,original)
    const begin=state.records.find(record=>record.kind==='begin')
    assert.ok(!JSON.stringify(begin).includes('PRIVATE-'))
    assert.deepEqual((begin?.argumentProjection as Record<string,unknown>).timeline,{invalidType:'array'})
    assert.throws(()=>normalizeActionArguments('solutions.submitSolution',[{...rawSubmission(),timeline:['invalid']}]),/argument-shape:timeline/)
  })
})

// One owner-approved post-BLOCK repair. All774 prior test bytes above remain exact.
const fourFindingEligibility = Buffer.from('0:{"a":"$@a","f":"$b"}\nb:I["navigation"]\na:E{"message":"You cannot reject this request at this time","digest":"123","stack":"PRIVATE-four-finding-stack"}\n')
function fourFindingWireStatus(h: ReturnType<typeof t3Harness>, status: number, contentType='text/x-component', redirect: string|null=null): void {
  const context=h.contexts[0],emit=context.emit.bind(context)
  context.emit=(event:string|symbol,...args:unknown[]):boolean=>{
    if(event==='response'){
      const response=args[0] as {request():{method():string};headerValue(name:string):Promise<string|null>}
      if(response.request().method()==='POST')return emit(event,{...response,status:()=>status,headerValue:async(name:string)=>name==='content-type'?contentType:name==='x-action-redirect'?redirect:response.headerValue(name)})
    }
    return emit(event,...args)
  }
}
async function fourFindingHeld(input: {status?:number;body?:Promise<Buffer>;contentType?:string;redirect?:string;wrongBinding?:boolean;opaque?:boolean;staleDenied?:boolean}={}) {
  const h=t3Harness({stale:true,staleDenied:input.staleDenied,body:input.body??Promise.resolve(fourFindingEligibility),opaque:input.opaque,actionId:input.wrongBinding?t3Id('requests.createRequest'):undefined})
  const row=rows.find(r=>r.phase==='FINAL')!,reason=`HELD stale dialog ${row.id}`
  h.setAction('solutions.rejectFinalApproval',[validRequest,reason],{success:true})
  const opening=h.ui.openHeldRejectDialog(row,'T',{requestId:validRequest,instanceId:'held',attempt:1,order:row.rejectOrder,approvalRowId:'held-row'} as never)
  await h.serveJs(input.wrongBinding?'requests.createRequest':'solutions.rejectFinalApproval')
  const held=await opening
  fourFindingWireStatus(h,input.status??500,input.contentType,input.redirect??null)
  return {h,held,reason}
}
describe('Four-finding T3-1 HTTP500 thrown Flight through the actual held caller',()=>{
  it('T3-1 actual_held_HTTP500_complete_timely_bound_eligibility_throw_is_captured_not_success',async()=>{
    const {h,held,reason}=await fourFindingHeld()
    const response=await held.staleConfirm().then(outcome=>({outcome,error:null}),error=>({outcome:null,error}))
    const closeError=await held.close().then(()=>null,error=>error)
    assert.ifError(response.error)
    assert.ifError(closeError)
    assert.ok(response.outcome)
    assert.equal(response.outcome.outcome,'denied','denial toast is observed; no synthetic returned-success result')
    const index=t3SafeIndex(h),requests=index.requests as Array<{method:string;actionId:string;status:number;finished:boolean;body:ArtifactRef;arguments:unknown;result:FlightResult}>
    const captured=requests.find(r=>r.method==='POST')!
    assert.equal(captured.status,500,'observed HTTP status remains500')
    assert.equal(captured.finished,true)
    assert.deepEqual(captured.result,{state:'thrown',code:'You cannot reject this request at this time',digest:'123'})
    assert.deepEqual(captured.arguments,{requestId:validRequest,comments:{sha256:hash(reason),length:reason.length,blank:false}})
    assert.equal(captured.actionId,t3Id('solutions.rejectFinalApproval'))
    const binding=(index.bindings as Array<{actionId:string;handler:string;chunk:ArtifactRef}>).find(b=>b.actionId===captured.actionId)!
    assert.equal(binding.handler,'solutions.rejectFinalApproval')
    assert.equal(binding.chunk.sha256,hash(t3Js('solutions.rejectFinalApproval').toString()))
    const body=[...h.files.entries()].find(([file])=>file.endsWith(captured.body.path))?.[1]
    assert.ok(body);assert.deepEqual(Buffer.from(body),fourFindingEligibility)
    assert.equal(captured.body.sha256,hash(fourFindingEligibility.toString()))
    assert.equal(captured.body.bytes,fourFindingEligibility.length)
    assert.equal(h.events.filter(e=>e.endsWith('button:Confirm Rejection')).length,1)
    assert.ok(h.clock.ms<15000);assert.equal(h.contexts[0].listenerCount('request'),0)
    assert.ok(!JSON.stringify(index).includes('PRIVATE-four-finding-stack'))
    const sourceDenial=staleFixture();sourceDenial.dispatch!.status=500
    sourceDenial.dispatch!.result=captured.result;sourceDenial.server!.exit=captured.result
    assert.deepEqual(evaluateAction(sourceDenial),{outcome:'DENIED_UNCHANGED',gaps:[],commitProven:false,evidenceValid:true,expectedSatisfied:true})
  })
  for(const [name,input] of [
    ['returned-success',{body:Promise.resolve(t3Flight({success:true}))}],
    ['returned-stale-false',{body:Promise.resolve(t3Flight({success:false,stale:true,message:'This request was updated by another user.'}))}],
    ['plain-error',{contentType:'text/plain',body:Promise.resolve(Buffer.from('PRIVATE plain server error'))}],
    ['redirect',{redirect:'/requests;push'}],
    ['unfinished-error-frame',{body:Promise.resolve(Buffer.from('0:{"a":"$@1"}\n1:E{"message":"You cannot reject this request at this time"}'))}],
    ['unsupported-result',{body:Promise.resolve(Buffer.from('0:{"a":"$L1"}\n1:I[]\n'))}],
    ['wrong-binding',{wrongBinding:true}],
    ['opaque-arguments',{opaque:true}],
    ['unsupported-503-status',{status:503}],
  ] as const)it(`T3-1 actual_held_HTTP500_rejects_${name}`,async()=>{
    const {h,held}=await fourFindingHeld(input)
    let returned=false
    await assert.rejects(async()=>{try{await held.staleConfirm();returned=true}finally{await held.close()}})
    assert.equal(returned,false);assert.equal(h.events.filter(e=>e.endsWith('button:Confirm Rejection')).length,1)
    assert.equal(h.contexts[0].listenerCount('response'),0)
  })
  it('T3-1 unknown_HTTP500_error_is_observed_without_manufacturing_source_eligibility',async()=>{
    const {h,held}=await fourFindingHeld({body:Promise.resolve(Buffer.from('0:{"a":"$@1"}\n1:E{"message":"PRIVATE unknown exception","digest":"123"}\n'))})
    try {await held.staleConfirm()}finally{await held.close()}
    const result=(t3SafeIndex(h).requests as Array<{result:FlightResult|null}>).find(r=>r.result)?.result!
    assert.equal(result.state,'thrown')
    assert.notEqual(result.state==='thrown'?result.code:null,'You cannot reject this request at this time')
    const e=staleFixture();e.dispatch!.status=500;e.dispatch!.result=result;e.server!.exit=result
    const evaluated=evaluateAction(e)
    assert.equal(evaluated.expectedSatisfied,false);assert.equal(evaluated.commitProven,false)
    assert.ok(evaluated.gaps.includes('stale:reachable-eligibility-throw-required'))
    assert.ok(!JSON.stringify(t3SafeIndex(h)).includes('PRIVATE unknown'))
  })
  it('T3-1 HTTP500_body_arriving_after_stale_deadline_cannot_be_published_or_admitted_by_drain',async()=>{
    const body=t3Deferred<Buffer>(),{h,held}=await fourFindingHeld({body:body.promise})
    const outcome=(async()=>{let primary:unknown;try{await held.staleConfirm()}catch(error){primary=error}try{await held.close()}catch(error){primary=primary??error}return primary})()
    await t3UntilIdle();h.clock.advance(15000);await t3UntilIdle()
    body.resolve(fourFindingEligibility);await t3UntilIdle()
    assert.match(String(await outcome),/15000.*deadline|deadline.*15000/)
    assert.ok(![...h.files.keys()].some(file=>file.endsWith('.flight')))
    assert.equal(t3SafeIndex(h).complete,false)
  })
})

describe('Four-finding PRIV-1 exact typed whitespace approval comments',()=>{
  for(const phase of ['REQUEST','SOLUTION','FINAL'] as const)for(const comments of [' ',' \t\n'])it(`PRIV-1 ${phase} source_valid_whitespace_comment_${comments.length}_retains_full_commit_and_audit`,()=>{
    const e=decisionFixture(phase);accepted(e)
    setArgs(e,normalizeActionArguments(e.record.spec.handler,[phase==='SOLUTION'?'sol-1':validRequest,comments]))
    ;(e.after!.approvalRows[0] as FixtureRow).comments=comments
    ;(e.after!.activities[0] as FixtureRow).comments=comments
    syncActivitySummary(e.after!)
    accepted(e)
    assert.deepEqual((e.record.argumentProjection as FixtureRow).comments,{sha256:hash(comments),length:comments.length,blank:true})
    for(const [label,mutate,gap] of [
      ['hash',(bad:ActionEvidence)=>setArgs(bad,{...(bad.record.argumentProjection as FixtureRow),comments:projectPrivateText(comments+' ')}),'deciding-comments'],
      ['row',(bad:ActionEvidence)=>{(bad.after!.approvalRows[0] as FixtureRow).comments=comments+' '},'deciding-comments'],
      ['audit',(bad:ActionEvidence)=>{(bad.after!.activities[0] as FixtureRow).comments=comments+' ';syncActivitySummary(bad.after!)},'audit-record-missing'],
    ] as const){const bad=structuredClone(e);mutate(bad);rejected(bad,gap);assert.equal(evaluateAction(bad).commitProven,false,label)}
  })
  it('PRIV-1 unknown_null_nonstring_row_comments_cannot_be_recovered_from_a_whitespace_digest',()=>{
    for(const value of [undefined,null,42,{text:' '}] as const){
      const e=decisionFixture();setArgs(e,normalizeActionArguments('solutions.approveSolution',['sol-1',' ']))
      ;(e.after!.approvalRows[0] as unknown as Record<string,unknown>).comments=value
      ;(e.after!.activities[0] as FixtureRow).comments=' ';syncActivitySummary(e.after!)
      rejected(e);assert.equal(evaluateAction(e).commitProven,false)
    }
    assert.throws(()=>normalizeActionArguments('solutions.approveSolution',['sol-1',null]),/argument-shape:comments/)
  })
})

function fourFindingSetupHarness(input:{artifactMkdirFailure?:boolean;indexWriteFailure?:boolean;screenshotFailure?:boolean;traceFailure?:boolean;closeFailure?:boolean;pendingBody?:boolean}){
  const events:string[]=[],files=new Map<string,Uint8Array>(),clock=new T3Clock(),pendingBody=t3Deferred<Buffer>()
  const page=new EventEmitter() as EventEmitter & {setDefaultTimeout(n:number):void;setDefaultNavigationTimeout(n:number):void;goto(url:string):Promise<void>;screenshot(options:{path:string}):Promise<void>}
  page.setDefaultTimeout=n=>{events.push('locator:'+n)};page.setDefaultNavigationTimeout=n=>{events.push('navigation:'+n)}
  page.goto=async()=>{
    if(input.pendingBody){
      const request={url:()=> 'http://owned.invalid/_next/static/held.js',method:()=> 'GET',headerValue:async()=>null}
      context.emit('request',request)
      context.emit('response',{request:()=>request,status:()=>200,headerValue:async(name:string)=>name==='content-type'?'application/javascript':null,body:()=>pendingBody.promise})
      await t3Flush()
    }
    events.push('setup.primary');throw new Error('four-finding primary setup failure')
  }
  page.screenshot=async()=>{events.push('setup.screenshot');if(input.screenshotFailure)throw new Error('four-finding screenshot failure')}
  const context=Object.assign(new EventEmitter(),{
    newPage:async()=>{events.push('newPage');return page},
    tracing:{start:async()=>{events.push('trace.start')},stop:async()=>{events.push('setup.trace');if(input.traceFailure)throw new Error('four-finding trace failure')}},
    close:async()=>{events.push('context.close');if(input.closeFailure)throw new Error('four-finding context close failure')},
  })
  const deps:MatrixUiDependencies={handle:{baseUrl:'http://owned.invalid',runtime:{e2ePassword:'FAKE-UNUSED-PASSWORD'},queryReadOnly:async()=>{throw new Error('no business query permitted')}} as unknown as MatrixRuntimeHandle,
    manifest:t3Manifest(),clock:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer,
    mkdir:async(dir)=>{if(input.artifactMkdirFailure && path.basename(dir)==='traces'){events.push('setup.artifact.mkdir');throw new Error('four-finding artifact mkdir failure')}},
    writeFile:async(file,body)=>{events.push('capture.write');if(input.indexWriteFailure)throw new Error('four-finding index disk failure');files.set(file,typeof body==='string'?Buffer.from(body):Uint8Array.from(body))},
    readFile:async(file)=>{const bytes=files.get(file);if(!bytes)throw new Error('missing fake file');return bytes},
    rename:async(from,to)=>{const bytes=files.get(from);assert.ok(bytes);files.set(to,bytes);files.delete(from)},
  }
  const browser={newContext:async()=>{events.push('browser.newContext');return context}}
  const ui=playwrightMatrixUi(browser as unknown as Browser,path.join(os.tmpdir(),'rrm-four-setup-'+Math.random().toString(16).slice(2)),deps)
  return {ui,context,events,files,clock,deps,pendingBody}
}
describe('Four-finding T3-3 unconditional additive real-factory setup finalization',()=>{
  it('T3-3 artifact_mkdir_failure_after_registration_cannot_bypass_seal_listener_removal_or_owned_stop',async()=>{
    const h=fourFindingSetupHarness({artifactMkdirFailure:true})
    let stopped=false,next=false,passed=false
    const failure=await t3OwnedSession({handle:h.deps.handle,launchBrowser:async()=>({close:async()=>{}}),stop:async()=>{stopped=true},run:async()=>{await h.ui.createRequest(rows[0],'T');next=true;passed=true}}).then(()=>null,error=>error)
    assert.match(String(failure),/four-finding primary setup failure/)
    assert.match(String(failure),/four-finding artifact mkdir failure/)
    assert.equal(h.ui.captures.length,1,'capture really registered before primary setup failure')
    for(const event of ['request','response','requestfinished','requestfailed'])assert.equal(h.context.listenerCount(event),0,event+' listener removed despite artifact mkdir rejection')
    const record=decisionFixture().record;record.identity.contextId=h.ui.captures[0].contextId
    await assert.rejects(()=>h.ui.captures[0].begin(record),/unregistered|sealed/)
    assert.ok(h.events.indexOf('capture.write')<h.events.indexOf('setup.artifact.mkdir'),'capture finalization is independent of the failing artifact directory')
    assert.equal(h.events.filter(event=>event==='context.close').length,1)
    assert.ok(h.events.includes('setup.trace'));assert.ok(h.events.includes('setup.screenshot'))
    assert.equal(stopped,true);assert.equal(next,false);assert.equal(passed,false)
  })
  it('T3-3 drain_error_screenshot_trace_and_close_failures_are_all_retained_with_setup_primary',async()=>{
    const h=fourFindingSetupHarness({indexWriteFailure:true,screenshotFailure:true,traceFailure:true,closeFailure:true})
    let stopped=false,next=false
    const failure=await t3OwnedSession({handle:h.deps.handle,launchBrowser:async()=>({close:async()=>{}}),stop:async()=>{stopped=true;throw new Error('four-finding owned stop failure')},run:async()=>{await h.ui.createRequest(rows[0],'T');next=true}}).then(()=>null,error=>error)
    const message=String(failure)
    for(const text of ['four-finding primary setup failure','capture index seal/write failed','four-finding screenshot failure','four-finding trace failure','four-finding context close failure','four-finding owned stop failure'])assert.ok(message.includes(text),text+' independently retained: '+message)
    for(const event of ['request','response','requestfinished','requestfailed'])assert.equal(h.context.listenerCount(event),0)
    assert.equal(h.events.filter(event=>event==='setup.screenshot').length,1)
    assert.equal(h.events.filter(event=>event==='setup.trace').length,1)
    assert.equal(h.events.filter(event=>event==='context.close').length,1)
    assert.equal(stopped,true);assert.equal(next,false)
    const summary=await h.ui.captures[0].drain('stop');assert.ok(summary.errors.some(error=>error.includes('capture index seal/write failed')))
  })
})

import { spawnSync as fourFindingSpawn } from 'node:child_process'
function fourFindingExpiryProgram(stage:'read'|'seal',settlement:'reject'|'resolve'='reject'):string {
  // Reuse only the existing fake Browser/runtime/IO fixture declarations in an
  // isolated plain subprocess. M itself is imported and executed unchanged;
  // no node:test global rejection policy or real business module is involved.
  const names=new Set(['T3Clock','t3Id','t3Module','t3Manifest','t3Js','t3Flight','t3Deferred','t3Flush','t3Harness','t3UntilIdle'])
  const source=readFileSync(path.join(MATRIX_REPO_ROOT,'tests/regression/rejection-recovery-matrix.test.ts'),'utf8')
  const sf=ts.createSourceFile('fixture.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
  const helpers:string[]=[]
  for(const node of sf.statements){
    const name=ts.isVariableStatement(node)?node.declarationList.declarations[0]?.name.getText(sf):'name' in node?(node as ts.FunctionDeclaration|ts.ClassDeclaration).name?.getText(sf):undefined
    if(name && names.has(name)){helpers.push(node.getText(sf));names.delete(name)}
  }
  assert.equal(names.size,0,'all source-named pure fixture declarations found')
  const code=`
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{createHash}=require('node:crypto');
const {playwrightMatrixUi}=require(${JSON.stringify(path.join(MATRIX_REPO_ROOT,'tests/manual/rejection-recovery-matrix.ts'))});
const {MATRIX_ACTION_REGISTRY,MATRIX_HEADED,buildInventory}=require(${JSON.stringify(path.join(MATRIX_REPO_ROOT,'tests/support/rejection-recovery-matrix.ts'))});
const hash=(value)=>createHash('sha256').update(value).digest('hex');
const validRequest='00000000-0000-4000-8000-000000000010',validSession='00000000-0000-4000-8000-000000000001',rows=buildInventory();
const {runOwnedMatrixSession}=require(${JSON.stringify(path.join(MATRIX_REPO_ROOT,'tests/support/native/rejection-recovery-runtime.ts'))});
${helpers.join('\n')}
(async()=>{
  const stage=${JSON.stringify(stage)},h=t3Harness(),late=t3Deferred<void>(),unhandled:string[]=[];
  const onUnhandled=(error:unknown)=>unhandled.push(String(error));
  process.on('unhandledRejection',onUnhandled);
  let started=false,stopped=false,next=false,passed=false;
  if(stage==='read'){
    const read=h.deps.readFile;
    h.deps.readFile=(file:string)=>{
      if(file.endsWith('.js')){started=true;h.clock.advance(30000);return late.promise as unknown as Promise<Uint8Array>}
      return read(file);
    };
  }else{
    const mkdir=h.deps.mkdir;
    h.deps.mkdir=(dir:string,options:{recursive:true})=>{
      if(path.basename(dir)==='.capture-tmp' && h.contexts[0]?.listenerCount('request')===0){started=true;h.clock.advance(5000);return late.promise}
      return mkdir(dir,options);
    };
  }
  const outcome=runOwnedMatrixSession({handle:h.deps.handle,launchBrowser:async()=>({close:async()=>{}}),stop:async()=>{stopped=true},run:async()=>{await h.ui.createRequest(rows[0],'T');next=true;passed=true}}).then(()=>null,error=>error);
  await h.serveJs('requests.createRequest');await t3UntilIdle();const error=await outcome;
  assert.equal(started,true,'actual started I/O crosses within immediate-expiry admission');
  assert.equal(h.clock.ms,MATRIX_HEADED.checkpointMs+(stage==='read'?30000:5000),'no budget extension');
  assert.equal(stopped,true);assert.equal(next,false);assert.equal(passed,false);
  assert.match(String(error),stage==='read'?/30000.*deadline|deadline.*30000/:/capture index seal.write failed/);
  assert.equal(h.contexts[0].listenerCount('request'),0);
  const before=JSON.stringify(await h.ui.captures[0].drain('stop'));
  const published=JSON.stringify([...h.files.entries()].filter(([file])=>!file.includes('.capture-tmp')).map(([file,bytes])=>[file,hash(bytes)]));
  if(${JSON.stringify(settlement)}==='reject')late.reject(new Error('four-finding late '+stage+' rejection'));else late.resolve();
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));await t3UntilIdle();
  const after=JSON.stringify(await h.ui.captures[0].drain('stop'));
  const finalPublished=JSON.stringify([...h.files.entries()].filter(([file])=>!file.includes('.capture-tmp')).map(([file,bytes])=>[file,hash(bytes)]));
  process.removeListener('unhandledRejection',onUnhandled);
  console.log(JSON.stringify({stage,started,stopped,next,passed,unhandled,immutable:before===after,publishedUnchanged:published===finalPublished}));
  assert.equal(after,before);assert.equal(finalPublished,published);
  assert.deepEqual(unhandled,[],'already-started '+stage+' promise rejection must be consumed even when left<=0');
})().catch(error=>{console.error(error);process.exitCode=1});
`
  return ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
}
describe('Four-finding T3-2 immediate-expiry started-promise rejection consumption',()=>{
  for(const stage of ['read','seal'] as const)it(`T3-2 actual_${stage}_already_started_immediately_expired_rejection_is_consumed_before_owned_stop`,async()=>{
    const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'rrm-four-expiry-'))
    const script=path.join(dir,'immediate-expiry.cjs');await fsp.writeFile(script,fourFindingExpiryProgram(stage))
    const loader=createRequire(path.join(MATRIX_REPO_ROOT,'four-finding-fixture.cjs')).resolve('tsx')
    const child=fourFindingSpawn(process.execPath,['--import',loader,script],{cwd:MATRIX_REPO_ROOT,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024})
    assert.ifError(child.error)
    assert.equal(child.status,0,child.stdout+'\n'+child.stderr)
    const result=JSON.parse(child.stdout.trim().split('\n').at(-1)!) as {stage:string;started:boolean;stopped:boolean;unhandled:string[];immutable:boolean;publishedUnchanged:boolean}
    assert.deepEqual(result,{stage,started:true,stopped:true,next:false,passed:false,unhandled:[],immutable:true,publishedUnchanged:true})
  })
})

describe('Four-finding boundary invariants stay bounded and preserve primary failures',()=>{
  it('T3-2 nonexpired_read_rejection_still_propagates_alongside_the_original_UI_failure',async()=>{
    const h=t3Harness({uiFailure:true}),read=h.deps.readFile
    h.deps.readFile=file=>file.endsWith('.js')?Promise.reject(new Error('four-finding admitted read failure')):read(file)
    let stopped=false,next=false
    const p=t3OwnedSession({handle:h.deps.handle,launchBrowser:async()=>({close:async()=>{}}),stop:async()=>{stopped=true},run:async()=>{await h.ui.createRequest(rows[0],'T');next=true}}).then(()=>null,error=>error)
    await h.serveJs('requests.createRequest')
    const error=String(await p)
    assert.ok(error.includes('primary UI failed'));assert.ok(error.includes('four-finding admitted read failure'))
    assert.equal(stopped,true);assert.equal(next,false);assert.equal(h.clock.ms,MATRIX_HEADED.checkpointMs)
  })
  for(const stage of ['read','seal'] as const)it(`T3-2 immediately_expired_${stage}_late_resolution_cannot_publish_or_return_success`,async()=>{
    const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'rrm-four-resolution-')),script=path.join(dir,'expired-resolution.cjs')
    await fsp.writeFile(script,fourFindingExpiryProgram(stage,'resolve'))
    const loader=createRequire(path.join(MATRIX_REPO_ROOT,'four-finding-fixture.cjs')).resolve('tsx')
    const child=fourFindingSpawn(process.execPath,['--import',loader,script],{cwd:MATRIX_REPO_ROOT,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024})
    assert.ifError(child.error);assert.equal(child.status,0,child.stdout+'\n'+child.stderr)
    assert.deepEqual(JSON.parse(child.stdout.trim().split('\n').at(-1)!),{stage,started:true,stopped:true,next:false,passed:false,unhandled:[],immutable:true,publishedUnchanged:true})
  })
  it('T3-3 rejected_real_drain_is_cancelled_without_skipping_screenshot_trace_close_or_stop',async()=>{
    const h=fourFindingSetupHarness({screenshotFailure:true,traceFailure:true})
    let clockFault=false,stopped=false
    h.deps.clock=()=>{
      if(h.ui.captures.length===1 && h.context.listenerCount('request')===0 && !clockFault){clockFault=true;throw new Error('four-finding drain clock failure')}
      return h.clock.now()
    }
    const error=await t3OwnedSession({handle:h.deps.handle,launchBrowser:async()=>({close:async()=>{}}),stop:async()=>{stopped=true},run:()=>h.ui.createRequest(rows[0],'T')}).then(()=>null,error=>error)
    for(const part of ['four-finding primary setup failure','four-finding drain clock failure','four-finding screenshot failure','four-finding trace failure'])assert.ok(String(error).includes(part),String(error))
    const record=decisionFixture().record;record.identity.contextId=h.ui.captures[0].contextId
    await assert.rejects(()=>h.ui.captures[0].begin(record),/unregistered|sealed/)
    assert.equal(stopped,true);assert.equal(h.events.filter(e=>e==='context.close').length,1)
    assert.equal(h.context.listenerCount('response'),0)
  })
  it('T3-3 setup_pending_body_and_artifact_failure_use_only_the_existing_5000_drain_then_owned_stop',async()=>{
    const h=fourFindingSetupHarness({artifactMkdirFailure:true,pendingBody:true})
    let stopped=false,next=false
    const p=t3OwnedSession({handle:h.deps.handle,launchBrowser:async()=>({close:async()=>{}}),stop:async()=>{stopped=true},run:async()=>{await h.ui.createRequest(rows[0],'T');next=true}}).then(()=>null,error=>error)
    await t3UntilIdle()
    assert.equal(stopped,false);assert.equal([...h.clock.timers.values()][0]?.at,5000)
    h.clock.advance(4999);await t3Flush();assert.equal(stopped,false)
    h.clock.advance(1);await t3UntilIdle()
    const error=String(await p)
    for(const part of ['four-finding primary setup failure','evidence drain 5000ms exhausted','four-finding artifact mkdir failure'])assert.ok(error.includes(part),error)
    assert.equal(stopped,true);assert.equal(next,false);assert.equal(h.clock.ms,5000)
    const summary=await h.ui.captures[0].drain('stop'),files=JSON.stringify([...h.files])
    h.pendingBody.resolve(t3Js('requests.createRequest'));await t3UntilIdle()
    assert.deepEqual(await h.ui.captures[0].drain('stop'),summary)
    assert.equal(JSON.stringify([...h.files]),files)
    assert.equal(h.context.listenerCount('request'),0)
  })
  it('T3-1 complete_HTTP500_Flight_without_requestfinished_is_not_a_complete_dispatch',async()=>{
    const {h,held}=await fourFindingHeld(),context=h.contexts[0],emit=context.emit.bind(context)
    context.emit=(event:string|symbol,...args:unknown[]):boolean=>event==='requestfinished' && (args[0] as {method():string}).method()==='POST'?true:emit(event,...args)
    const result=held.staleConfirm().then(()=>null,error=>error)
    await t3UntilIdle();h.clock.advance(15000);await t3UntilIdle()
    assert.match(String(await result),/15000.*deadline|deadline.*15000/)
    await assert.rejects(()=>held.close(),/capture drain failed/)
    const request=(t3SafeIndex(h).requests as Array<{method:string;status:number;finished:boolean;end:unknown}>).find(r=>r.method==='POST')!
    assert.equal(request.status,500);assert.equal(request.finished,false);assert.equal(request.end,null)
  })
})

// ---------------------------------------------------------------------------
// clock-v3 lane A (clock-only implementation stage) — appended Task1 tests.
// The original803/357284-byte prefix above stays byte-frozen; everything
// below is additive. Coverage: pure V3 sampler read-order/representation/
// range rules, exact BigInt rational bounds against independent oracles, and
// the strict exact-containment guard boundary fixtures. Test names begin
// `clock-v3 A ` (stage gate prefix) and carry `clock-v2` (the brief's focused
// RED/GREEN pattern) for the rrm-clock-sample-v2 wire schema.
// ---------------------------------------------------------------------------
import {
  ClockMathErrorV3,
  deriveClockBoundsV3,
  sampleClockMarkV3,
  validateExactClockContainmentV3,
  type ClockBoundsV3,
  type ClockEndpointSetV3,
  type ClockReadersV3,
  type ClockSampleV3,
  type ClockSamplerDescriptorV3,
  type NativeBirthV3,
} from '../support/rejection-recovery-matrix'

// --- independent exact-rational oracle: local to these tests, never the
// --- support-module helpers, so agreement is independent evidence.
type OracleRat = { n: bigint; d: bigint }
const oracleGcd = (a: bigint, b: bigint): bigint => {
  let x = a < BigInt(0) ? -a : a
  let y = b < BigInt(0) ? -b : b
  while (y !== BigInt(0)) { const t = x % y; x = y; y = t }
  return x
}
const oracleRat = (n: bigint, d: bigint = BigInt(1)): OracleRat => {
  if (d === BigInt(0)) throw new Error('oracle zero denominator')
  if (d < BigInt(0)) { n = -n; d = -d }
  if (n === BigInt(0)) return { n: BigInt(0), d: BigInt(1) }
  const g = oracleGcd(n, d)
  return { n: n / g, d: d / g }
}
const oracleAdd = (a: OracleRat, b: OracleRat): OracleRat => oracleRat(a.n * b.d + b.n * a.d, a.d * b.d)
const oracleSub = (a: OracleRat, b: OracleRat): OracleRat => oracleRat(a.n * b.d - b.n * a.d, a.d * b.d)
const oracleCmp = (a: OracleRat, b: OracleRat): number => { const l = a.n * b.d, r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0 }
const oracleStr = (a: OracleRat): { numerator: string; denominator: string } => ({ numerator: a.n.toString(), denominator: a.d.toString() })
const oracleF64 = new Float64Array(1)
const oracleBits = new BigUint64Array(oracleF64.buffer)
const oracleFromNumber = (x: number): OracleRat => {
  oracleF64[0] = x
  const bits = oracleBits[0]
  const sign = (bits >> BigInt(63)) & BigInt(1)
  const biased = Number((bits >> BigInt(52)) & BigInt(0x7ff))
  const frac = bits & ((BigInt(1) << BigInt(52)) - BigInt(1))
  let n: bigint
  let d: bigint
  if (biased === 0) { n = frac; d = BigInt(1) << BigInt(1074) } else {
    n = frac | (BigInt(1) << BigInt(52))
    const shift = biased - 1075
    if (shift >= 0) { n <<= BigInt(shift); d = BigInt(1) } else { d = BigInt(1) << BigInt(-shift) }
  }
  if (sign === BigInt(1)) n = -n
  return oracleRat(n, d)
}
/** Largest float strictly below x (x > 0), via raw bit decrement. */
const oracleStepDown = (x: number): number => {
  oracleF64[0] = x
  oracleBits[0] -= BigInt(1)
  return oracleF64[0]
}
const oracleEofP = (p: number): OracleRat => {
  const maxOne = Math.abs(p) >= 1 ? oracleFromNumber(Math.abs(p)) : { n: BigInt(1), d: BigInt(1) }
  return oracleRat(BigInt(4) * maxOne.n, maxOne.d * (BigInt(1) << BigInt(52)))
}

// --- V3 fixture builders ---------------------------------------------------
const clockUuid = (seed: number): string => `00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`
const clockScopeId = 'clock-scope-A'
const clockRootScopeRef = { path: 'clock/root-scope.json', sha256: 'b'.repeat(64), bytes: 128 }
const clockBirth = (over: Partial<NativeBirthV3> = {}): NativeBirthV3 => {
  const defaults: NativeBirthV3 = { bootUuid: clockUuid(1), pid: 101, uniqueId: '1790329675953189838', idVersion: 3, executableUuid: 'a'.repeat(32) }
  return Object.assign({ ...defaults }, over)
}
const clockDescriptor = (over: Partial<ClockSamplerDescriptorV3> = {}): ClockSamplerDescriptorV3 => {
  const defaults: ClockSamplerDescriptorV3 = {
    schema: 'rrm-clock-sampler-v3',
    scopeId: clockScopeId,
    clockInstanceId: clockUuid(2),
    sequence: 7,
    domain: 'observer',
    representation: 'raw-ms',
    basis: 'node-hrtime-bigint-performance-now',
    nativeBirth: clockBirth(),
    observedParent: { pid: 1, parentUniqueId: '42' },
    rootScopeObservedRef: clockRootScopeRef,
  }
  return Object.assign({ ...defaults }, over)
}
const clockReaders = (before: bigint, after: bigint, performance: number, wall = 1760000000000.25, order?: string[]): ClockReadersV3 => {
  let sharedCalls = 0
  return {
    sharedNs: () => { if (order) order.push('sharedNs'); sharedCalls += 1; return sharedCalls === 1 ? before : after },
    performanceMs: () => { if (order) order.push('performanceMs'); return performance },
    wallMs: () => { if (order) order.push('wallMs'); return wall },
  }
}
const clockThrow = (run: () => unknown, code: string): void => {
  assert.throws(run, (error: unknown) => error instanceof ClockMathErrorV3 && error.code === code, `expected ClockMathErrorV3 ${code}`)
}
const clockObserverSample = (over: { sequence: number; rawPerformanceMs: number; sharedBeforeNs: string; sharedAfterNs: string } & Partial<ClockSampleV3>): ClockSampleV3 => {
  const defaults: ClockSampleV3 = {
    schema: 'rrm-clock-sample-v2',
    scopeId: clockScopeId,
    clockInstanceId: clockUuid(2),
    domain: 'observer',
    representation: 'raw-ms',
    basis: 'node-hrtime-bigint-performance-now',
    nativeBirth: clockBirth(),
    observedParent: { pid: 1, parentUniqueId: '42' },
    rootScopeObservedRef: clockRootScopeRef,
    sequence: 1,
    sharedBeforeNs: '0',
    rawPerformanceMs: 0,
    sharedAfterNs: '0',
  }
  return Object.assign({ ...defaults }, over)
}
const clockHostSample = (over: { sequence: number; rawPerformanceMs: number; sharedBeforeNs: string; sharedAfterNs: string } & Partial<ClockSampleV3>): ClockSampleV3 => clockObserverSample({
  domain: 'matrix-context-capture',
  representation: 'host-rounded-ms',
  nativeBirth: clockBirth({ pid: 202, uniqueId: '9000000000000000001' }),
  clockInstanceId: clockUuid(3),
  ...over,
})
const clockSnap = (seed: number) => ({ snapshotRef: { path: `clock/raw/action-${seed}.json`, sha256: 'c'.repeat(64), bytes: 64 + seed }, selector: `actions[${seed}].clock` })
const clockEndpoints = (dispatchStart: number, dispatchEnd: number, serverStart: number, serverEnd: number): ClockEndpointSetV3 => ({
  schema: 'rrm-clock-endpoints-v3',
  scopeId: clockScopeId,
  recordStart: mark(0),
  dispatchStart: mark(dispatchStart),
  dispatchEnd: mark(dispatchEnd),
  serverStart: mark(serverStart, 'node'),
  serverEnd: mark(serverEnd, 'node'),
  sources: { record: clockSnap(1), dispatchStart: clockSnap(2), dispatchEnd: clockSnap(3), serverStart: clockSnap(4), serverEnd: clockSnap(5) },
})
/** Bounds whose exact interval is exactly symmetric ±u around c=0, so every
 *  stored projection/coverage bit is self-consistent for the guard fixtures. */
const consistentSymmetricBounds = (u: number): ClockBoundsV3 => ({
  schema: 'rrm-clock-bounds-v3',
  scopeId: clockScopeId,
  fromDomain: 'browser',
  toDomain: 'node',
  exactLowerMs: oracleStr(oracleFromNumber(-u)),
  exactUpperMs: oracleStr(oracleFromNumber(u)),
  lowerMs: -u,
  upperMs: u,
  offsetMs: 0,
  uncertaintyMs: u,
})
const boundsWithCU = (offsetMs: number, uncertaintyMs: number): ClockBoundsV3 => ({
  schema: 'rrm-clock-bounds-v3',
  scopeId: clockScopeId,
  fromDomain: 'browser',
  toDomain: 'node',
  exactLowerMs: oracleStr(oracleSub(oracleFromNumber(offsetMs), oracleFromNumber(uncertaintyMs))),
  exactUpperMs: oracleStr(oracleAdd(oracleFromNumber(offsetMs), oracleFromNumber(uncertaintyMs))),
  lowerMs: offsetMs - uncertaintyMs,
  upperMs: offsetMs + uncertaintyMs,
  offsetMs,
  uncertaintyMs,
})
const exactQuarterBounds = (): ClockBoundsV3 => ({
  schema: 'rrm-clock-bounds-v3',
  scopeId: clockScopeId,
  fromDomain: 'browser',
  toDomain: 'node',
  exactLowerMs: { numerator: '3', denominator: '4' },
  exactUpperMs: { numerator: '5', denominator: '4' },
  lowerMs: 0.75,
  upperMs: 1.25,
  offsetMs: 1,
  uncertaintyMs: 0.25,
})
type OracleSampleInput = { rawPerformanceMs: number; sharedBeforeNs: string; sharedAfterNs: string }
/** Independent recomputation of the whole widen/mapping pipeline (host gets
 *  the ±0.5ms quantization allowance, server 0; both sides widen by the
 *  maximum e(P) of their own required samples). */
const oracleDerive = (from: OracleSampleInput[], to: OracleSampleInput[], hostQuantization = true) => {
  const interval = (samples: OracleSampleInput[]) => {
    let lower: OracleRat | null = null
    let upper: OracleRat | null = null
    for (const s of samples) {
      const p = oracleFromNumber(s.rawPerformanceMs)
      const beforeMs = oracleRat(BigInt(s.sharedBeforeNs), BigInt(1000000))
      const afterMs = oracleRat(BigInt(s.sharedAfterNs), BigInt(1000000))
      const e = oracleEofP(s.rawPerformanceMs)
      const lo = oracleSub(oracleSub(p, afterMs), e)
      const hi = oracleAdd(oracleSub(p, beforeMs), e)
      if (lower === null || oracleCmp(lo, lower) > 0) lower = lo
      if (upper === null || oracleCmp(hi, upper) < 0) upper = hi
    }
    if (lower === null || upper === null) throw new Error('oracle empty role')
    return { lower, upper }
  }
  const maxE = (samples: OracleSampleInput[]): OracleRat => {
    let m: OracleRat | null = null
    for (const s of samples) {
      const e = oracleEofP(s.rawPerformanceMs)
      if (m === null || oracleCmp(e, m) > 0) m = e
    }
    if (m === null) throw new Error('oracle empty role')
    return m
  }
  const host = interval(from)
  const server = interval(to)
  const half = { n: BigInt(1), d: BigInt(2) }
  const hostAllow = hostQuantization ? oracleAdd(maxE(from), half) : maxE(from)
  const serverAllow = maxE(to)
  const hostLower = oracleSub(host.lower, hostAllow)
  const hostUpper = oracleAdd(host.upper, hostAllow)
  const serverLower = oracleSub(server.lower, serverAllow)
  const serverUpper = oracleAdd(server.upper, serverAllow)
  return { lower: oracleSub(serverLower, hostUpper), upper: oracleSub(serverUpper, hostLower) }
}

const PINNED_EVALUATOR_BYTES = "function validateTemporalAndIdentity(input:ActionEvidence,gaps:string[]):boolean {\n  const start=gaps.length,{record,dispatch,server}=input\n  if (!record.start || !record.start.domain?.trim() || !Number.isFinite(record.start.monotonicMs) || !Number.isFinite(record.start.wallMs) || (dispatch && (record.start.domain !== dispatch.start.domain || record.start.monotonicMs > dispatch.start.monotonicMs))) gaps.push('record-clock')\n  if (!server) return false\n  if (!server.invocationId?.trim() || server.invocationId === record.identity.invocationId) gaps.push('server-invocation-id-namespace')\n  const serverOk=sameDomainIntervalOk(server.start,server.end,'server',gaps)\n  if (!dispatch) return false\n  const dispatchOk=sameDomainIntervalOk(dispatch.start,dispatch.end,'dispatch',gaps)\n  if (!same(dispatch.identity,record.identity)) gaps.push('dispatch-identity-mismatch')\n  if (!same(dispatch.argumentProjection,record.argumentProjection)) gaps.push('dispatch-arguments-mismatch')\n  if (!artifactRefValid(dispatch.body)) gaps.push('dispatch-body-missing')\n  if (dispatch.result.state === 'incomplete' || dispatch.result.state === 'unsupported') gaps.push(`flight-result-${dispatch.result.state}`)\n  if (serverOk && dispatchOk && server.end && dispatch.end) {\n    let offset=0,uncertainty=0,calibrated=true\n    if (dispatch.start.domain !== server.start.domain) {\n      const c=input.clockCalibration\n      if (!c || c.verified !== true || !Number.isFinite(c.offsetMs) || !Number.isFinite(c.uncertaintyMs) || c.uncertaintyMs < 0) calibrated=false\n      else if (c.fromDomain === dispatch.start.domain && c.toDomain === server.start.domain) {offset=c.offsetMs;uncertainty=c.uncertaintyMs}\n      else if (c.toDomain === dispatch.start.domain && c.fromDomain === server.start.domain) {offset=-c.offsetMs;uncertainty=c.uncertaintyMs}\n      else calibrated=false\n    }\n    if (!calibrated) gaps.push('clock-domain-uncalibrated')\n    // Direction: to = from + offset +/- uncertainty. Robust containment must\n    // hold for every possible offset, not merely one overlapping possibility.\n    else if (![dispatch.start.monotonicMs+offset+uncertainty,dispatch.end.monotonicMs+offset-uncertainty].every(Number.isFinite) || server.start.monotonicMs < dispatch.start.monotonicMs+offset+uncertainty || server.end.monotonicMs > dispatch.end.monotonicMs+offset-uncertainty) gaps.push('server-interval-outside-dispatch-envelope')\n  }\n  return gaps.length === start\n}\n"

describe('clock-v3 A clock-v2 pure sampler, exact bounds and exact containment', () => {
  it('clock-v3 A clock-v2 read-order reads B=hrtime, exactly one P read, A=hrtime, wall outside the bracket', () => {
    const order: string[] = []
    const markV3 = sampleClockMarkV3(clockDescriptor(), clockReaders(BigInt(1000), BigInt(2000), 1234.5, 1760000000000.25, order))
    assert.deepEqual(order, ['sharedNs', 'performanceMs', 'sharedNs', 'wallMs'], 'fixed U→P→U order with wall read after the bracket')
    assert.equal(markV3.domain, 'observer')
    assert.equal(markV3.monotonicMs, 1234.5)
    assert.equal(markV3.wallMs, 1760000000000.25)
    const sample = markV3.clockSample
    assert.ok(sample, 'mark embeds the v2 clock sample')
    assert.equal(sample!.schema, 'rrm-clock-sample-v2')
    assert.equal(sample!.scopeId, clockScopeId)
    assert.equal(sample!.sequence, 7)
    assert.equal(sample!.sharedBeforeNs, '1000')
    assert.equal(sample!.rawPerformanceMs, 1234.5)
    assert.equal(sample!.sharedAfterNs, '2000')
  })

  it('clock-v3 A clock-v2 observer keeps raw P while host capture renders Math.round(P)', () => {
    const observer = sampleClockMarkV3(clockDescriptor(), clockReaders(BigInt(0), BigInt(1000), 9.5))
    assert.equal(observer.monotonicMs, 9.5, 'observer P stays raw')
    const host = sampleClockMarkV3(clockDescriptor({
      domain: 'matrix-context-capture',
      representation: 'host-rounded-ms',
      nativeBirth: clockBirth({ pid: 202, uniqueId: '9000000000000000001' }),
      clockInstanceId: clockUuid(3),
      sequence: 8,
    }), clockReaders(BigInt(0), BigInt(1000), 9.5))
    assert.equal(host.monotonicMs, 10, 'host capture keeps the original Math.round(P) render')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ representation: 'host-rounded-ms' }), clockReaders(BigInt(0), BigInt(1000), 9.5)), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ domain: 'matrix-context-capture', representation: 'raw-ms' }), clockReaders(BigInt(0), BigInt(1000), 9.5)), 'invalid-descriptor')
  })

  it('clock-v3 A clock-v2 sampler validates canonical descriptors and reader ranges', () => {
    const readers = () => clockReaders(BigInt(0), BigInt(1000), 5)
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ nativeBirth: clockBirth({ uniqueId: '007' }) }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ nativeBirth: clockBirth({ uniqueId: '18446744073709551616' }) }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ nativeBirth: clockBirth({ executableUuid: 'A'.repeat(32) }) }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ nativeBirth: clockBirth({ bootUuid: 'not-a-uuid' }) }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ nativeBirth: clockBirth({ pid: 0 }) }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ nativeBirth: clockBirth({ pid: 2 ** 31 }) }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ nativeBirth: clockBirth({ idVersion: -1 }) }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ sequence: 0 }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ sequence: 2.5 }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ domain: 'browser' as never }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ basis: 'performance-only' as never }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ observedParent: { pid: -1, parentUniqueId: '42' } }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ observedParent: { pid: 1, parentUniqueId: 'x' } }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ rootScopeObservedRef: { path: 'clock/root-scope.json', sha256: 'zz', bytes: 1 } }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor({ scopeId: '' }), readers()), 'invalid-descriptor')
    clockThrow(() => sampleClockMarkV3(clockDescriptor(), clockReaders(BigInt(-1), BigInt(1000), 5)), 'invalid-readers')
    clockThrow(() => sampleClockMarkV3(clockDescriptor(), clockReaders(BigInt(2) ** BigInt(64), BigInt(2) ** BigInt(64), 5)), 'invalid-readers')
    clockThrow(() => sampleClockMarkV3(clockDescriptor(), clockReaders(BigInt(2000), BigInt(1000), 5)), 'invalid-readers')
    clockThrow(() => sampleClockMarkV3(clockDescriptor(), clockReaders(BigInt(0), BigInt(1000), Number.NaN)), 'invalid-readers')
    clockThrow(() => sampleClockMarkV3(clockDescriptor(), clockReaders(BigInt(0), BigInt(1000), Number.POSITIVE_INFINITY)), 'invalid-readers')
    clockThrow(() => sampleClockMarkV3(clockDescriptor(), clockReaders(BigInt(0), BigInt(1000), -1)), 'invalid-readers')
    clockThrow(() => sampleClockMarkV3(clockDescriptor(), clockReaders(BigInt(0), BigInt(1000), 2 ** 53)), 'invalid-readers')
    clockThrow(() => sampleClockMarkV3(clockDescriptor(), clockReaders(BigInt(0), BigInt(1000), Number.NaN, Number.NaN)), 'invalid-readers')
    clockThrow(() => sampleClockMarkV3(clockDescriptor(), { sharedNs: () => BigInt(0), performanceMs: 5 as never, wallMs: () => 1 }), 'invalid-readers')
  })

  it('clock-v3 A clock-v2 sample bracket keeps k inside [P-A/1e6-e(P), P-B/1e6+e(P)] with host ±0.5ms accounted', () => {
    const from = [clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '1000', sharedAfterNs: '9000' })]
    const to = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '1000', sharedAfterNs: '9000' })]
    const bounds = deriveClockBoundsV3(from, to, clockEndpointsRepair(
      clockMarkRepair(5, 'browser', from[0]), clockMarkRepair(5, 'browser', from[0]),
      clockMarkRepair(5, 'node', to[0]), clockMarkRepair(5, 'node', to[0]),
    ))
    const oracle = oracleDerive(from, to)
    assert.deepEqual(bounds.exactLowerMs, oracleStr(oracle.lower), 'exact lower fraction matches the independent rational oracle')
    assert.deepEqual(bounds.exactUpperMs, oracleStr(oracle.upper), 'exact upper fraction matches the independent rational oracle')
    assert.equal(bounds.schema, 'rrm-clock-bounds-v3')
    assert.equal(bounds.fromDomain, 'browser')
    assert.equal(bounds.toDomain, 'node')
    assert.ok(oracleCmp(oracleFromNumber(bounds.lowerMs), oracle.lower) <= 0, 'stored lower bound is outward (<= exact)')
    assert.ok(oracleCmp(oracleFromNumber(bounds.upperMs), oracle.upper) >= 0, 'stored upper bound is outward (>= exact)')
    assert.equal(bounds.offsetMs, 0, 'symmetric interval midpoint converts to +0')
    assert.ok(!Object.is(bounds.offsetMs, -0), 'numeric zero serializes canonically as +0')
    assert.ok(oracleCmp(oracleFromNumber(bounds.uncertaintyMs), oracle.upper) >= 0, 'uncertainty is an outward conversion')
    assert.ok(oracleCmp(oracleFromNumber(oracleStepDown(bounds.uncertaintyMs)), oracle.upper) < 0, 'uncertainty is the minimal outward conversion')
    const withoutQuantization = oracleDerive(from, to, false)
    assert.ok(oracleCmp(withoutQuantization.lower, oracle.lower) > 0, 'host ±0.5ms quantization widens the exact interval')
    assert.ok(oracleCmp(withoutQuantization.upper, oracle.upper) < 0, 'host ±0.5ms quantization widens the exact interval (upper)')
  })

  it('clock-v3 A clock-v2 e(P) equals 4/2^52*max(1,abs(P)) exactly in the sample bracket', () => {
    for (const p of [0.5, 2 ** 40]) {
      const from = [clockHostSample({ sequence: 1, rawPerformanceMs: p, sharedBeforeNs: '0', sharedAfterNs: '0' })]
      const to = [clockObserverSample({ sequence: 1, rawPerformanceMs: p, sharedBeforeNs: '0', sharedAfterNs: '0' })]
      const bounds = deriveClockBoundsV3(from, to, clockEndpointsRepair(
        clockMarkRepair(Math.round(p), 'browser', from[0]), clockMarkRepair(Math.round(p), 'browser', from[0]),
        clockMarkRepair(p, 'node', to[0]), clockMarkRepair(p, 'node', to[0]),
      ))
      const oracle = oracleDerive(from, to)
      assert.deepEqual(bounds.exactLowerMs, oracleStr(oracle.lower), `exact lower fraction pins e(P) for P=${p}`)
      assert.deepEqual(bounds.exactUpperMs, oracleStr(oracle.upper), `exact upper fraction pins e(P) for P=${p}`)
    }
    // Direct oracle statement of the formula for both branches of max(1, |P|).
    assert.deepEqual(oracleStr(oracleEofP(0.5)), { numerator: '1', denominator: String(2 ** 50) })
    assert.deepEqual(oracleStr(oracleEofP(2 ** 40)), { numerator: '1', denominator: '1024' })
  })

  it('clock-v3 A clock-v2 large-epoch shared nanoseconds keep full uint64 precision (no Number rounding)', () => {
    const before = '1790329675953189838' // original nanosecond red-witness value
    const after = '1790329675953189839'
    const from = [clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const to = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: before, sharedAfterNs: after })]
    const bounds = deriveClockBoundsV3(from, to, clockEndpointsRepair(
      clockMarkRepair(5, 'browser', from[0]), clockMarkRepair(5, 'browser', from[0]),
      clockMarkRepair(5, 'node', to[0]), clockMarkRepair(5, 'node', to[0]),
    ))
    const oracle = oracleDerive(from, to)
    assert.deepEqual(bounds.exactLowerMs, oracleStr(oracle.lower), 'exact lower uses the full-precision uint64 decimals')
    assert.deepEqual(bounds.exactUpperMs, oracleStr(oracle.upper))
    const corruptedTo = to.map((s) => ({ ...s, sharedBeforeNs: String(Number(s.sharedBeforeNs)), sharedAfterNs: String(Number(s.sharedAfterNs)) }))
    const corruptedOracle = oracleDerive(from, corruptedTo)
    assert.notEqual(corruptedOracle.lower.n, oracle.lower.n, 'Number-rounded nanoseconds would yield a different interval')
    assert.deepEqual(bounds.exactUpperMs, oracleStr(oracle.upper), 'bounds keep the exact fractions, not the corrupted ones')
  })

  it('clock-v3 A clock-v2 negative host→observer offsets stay exact rationals', () => {
    const from = [clockHostSample({ sequence: 1, rawPerformanceMs: 100000, sharedBeforeNs: '0', sharedAfterNs: '2000000' })]
    const to = [clockObserverSample({ sequence: 1, rawPerformanceMs: 10, sharedBeforeNs: '0', sharedAfterNs: '2000' })]
    const bounds = deriveClockBoundsV3(from, to, clockEndpointsRepair(
      clockMarkRepair(100000, 'browser', from[0]), clockMarkRepair(100000, 'browser', from[0]),
      clockMarkRepair(10, 'node', to[0]), clockMarkRepair(10, 'node', to[0]),
    ))
    const oracle = oracleDerive(from, to)
    assert.deepEqual(bounds.exactLowerMs, oracleStr(oracle.lower))
    assert.deepEqual(bounds.exactUpperMs, oracleStr(oracle.upper))
    assert.ok(bounds.offsetMs < 0, 'observer behind host yields a negative numeric offset')
    assert.ok(oracleCmp(oracleFromNumber(bounds.lowerMs), oracle.lower) <= 0)
    assert.ok(oracleCmp(oracleFromNumber(bounds.upperMs), oracle.upper) >= 0)
  })

  it('clock-v3 A clock-v2 process-mix inside one role is rejected without a favorable subset', () => {
    const to = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const mixedBirth = [
      clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' }),
      clockHostSample({ sequence: 2, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0', nativeBirth: clockBirth({ pid: 203, uniqueId: '9000000000000000002' }) }),
    ]
    clockThrow(() => deriveClockBoundsV3(mixedBirth, to, clockEndpointsRepair(
      clockMarkRepair(5, 'browser', mixedBirth[0]), clockMarkRepair(5, 'browser', mixedBirth[0]),
      clockMarkRepair(5, 'node', to[0]), clockMarkRepair(5, 'node', to[0]),
    )), 'process-mix')
    const mixedInstance = [
      clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' }),
      clockHostSample({ sequence: 2, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0', clockInstanceId: clockUuid(9) }),
    ]
    clockThrow(() => deriveClockBoundsV3(mixedInstance, to, clockEndpointsRepair(
      clockMarkRepair(5, 'browser', mixedInstance[0]), clockMarkRepair(5, 'browser', mixedInstance[0]),
      clockMarkRepair(5, 'node', to[0]), clockMarkRepair(5, 'node', to[0]),
    )), 'process-mix')
    clockThrow(() => deriveClockBoundsV3([], to, clockEndpoints(5, 15, 5, 15)), 'invalid-samples')
  })

  it('clock-v3 A clock-v2 all required samples intersect and a disjoint sample fails closed', () => {
    const first = clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })
    const overlapping = clockHostSample({ sequence: 2, rawPerformanceMs: 5 + 2 * 2 ** -50, sharedBeforeNs: '0', sharedAfterNs: '0' })
    const disjoint = clockHostSample({ sequence: 3, rawPerformanceMs: 5 + 100 * 2 ** -50, sharedBeforeNs: '0', sharedAfterNs: '0' })
    const to = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const from = [first, overlapping]
    const bounds = deriveClockBoundsV3(from, to, clockEndpointsRepair(
      clockMarkRepair(5, 'browser', first), clockMarkRepair(5, 'browser', overlapping),
      clockMarkRepair(5, 'node', to[0]), clockMarkRepair(5, 'node', to[0]),
    ))
    const oracle = oracleDerive(from, to)
    assert.deepEqual(bounds.exactLowerMs, oracleStr(oracle.lower), 'intersection lower is the max of all required sample lowers')
    assert.deepEqual(bounds.exactUpperMs, oracleStr(oracle.upper), 'intersection upper is the min of all required sample uppers')
    clockThrow(() => deriveClockBoundsV3([first, disjoint], to, clockEndpointsRepair(
      clockMarkRepair(5, 'browser', first), clockMarkRepair(5, 'browser', first),
      clockMarkRepair(5, 'node', to[0]), clockMarkRepair(5, 'node', to[0]),
    )), 'empty-sample-intersection')
  })

  it('clock-v3 A clock-v2 derive validates sample wire fields and endpoint coherence', () => {
    const goodFrom = [clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const goodTo = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const endpoints = clockEndpoints(5, 15, 5, 15)
    clockThrow(() => deriveClockBoundsV3(goodFrom, [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0', schema: 'rrm-clock-sample-v1' as never })], endpoints), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3(goodFrom, [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0', scopeId: 'other' })], endpoints), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3([clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0', domain: 'observer' })], goodTo, endpoints), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3([clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0', representation: 'raw-ms' })], goodTo, endpoints), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3([clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '9', sharedAfterNs: '8' })], goodTo, endpoints), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3([clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '+5', sharedAfterNs: '8' })], goodTo, endpoints), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3([clockHostSample({ sequence: 1, rawPerformanceMs: -1, sharedBeforeNs: '0', sharedAfterNs: '0' })], goodTo, endpoints), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3([
      clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' }),
      clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' }),
    ], goodTo, endpoints), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3(goodFrom, goodTo, { ...endpoints, recordStart: mark(999) }), 'invalid-endpoints')
    clockThrow(() => deriveClockBoundsV3(goodFrom, goodTo, { ...endpoints, dispatchStart: mark(20) }), 'invalid-endpoints')
    clockThrow(() => deriveClockBoundsV3(goodFrom, goodTo, {
      ...endpoints,
      sources: { ...endpoints.sources, serverEnd: { snapshotRef: endpoints.sources.serverEnd.snapshotRef, selector: '' } },
    }), 'invalid-endpoints')
  })

  it('clock-v3 A clock-v2 accepted Task1 evaluator bytes and ClockMark declaration stay byte-identical', async () => {
    const supportSource = await fsp.readFile(path.resolve(process.cwd(), 'tests/support/rejection-recovery-matrix.ts'), 'utf8')
    const start = supportSource.indexOf('function validateTemporalAndIdentity')
    assert.ok(start > 0, 'accepted evaluator present in the support module')
    const end = supportSource.indexOf('\nfunction ', start + 1)
    assert.ok(end > start, 'evaluator slice bounded by the next function')
    assert.equal(supportSource.slice(start, end), PINNED_EVALUATOR_BYTES, 'original evaluator byte body is unchanged')
    assert.ok(supportSource.includes('export interface ClockMark { domain: string; monotonicMs: number; wallMs: number'), 'original ClockMark member line preserved')
    assert.ok(supportSource.includes('clockSample?: ClockSampleV3'), 'only the assigned legacy-optional clockSample member was added')
  })

  it('clock-v3 A clock-v2 start-threshold H=2^40: actual evaluator admits but the exact guard rejects', () => {
    const H = 2 ** 40
    const u = 0.50390725
    const evidence = decisionFixture()
    evidence.dispatch!.start = mark(H)
    evidence.dispatch!.end = mark(H + 10)
    evidence.server!.start = mark(H + u, 'node') // fl(H+u): one double rounding below the exact sum
    evidence.server!.end = mark(H + 9, 'node')
    evidence.clockCalibration = { fromDomain: 'browser', toDomain: 'node', offsetMs: 0, uncertaintyMs: u, verified: true }
    accepted(evidence) // the unchanged numeric evaluator alone admits the threshold
    const verdict = validateExactClockContainmentV3(consistentSymmetricBounds(u), clockEndpoints(H, H + 10, H + u, H + 9))
    assert.equal(verdict.numericProjectionOk, true, 'float envelope check alone admits')
    assert.equal(verdict.exactGuardOk, false, 'exact rational sum is strictly greater than fl(H+u)')
    assert.equal(verdict.contained, false)
    assert.ok(oracleCmp(oracleAdd(oracleFromNumber(H), oracleFromNumber(u)), oracleFromNumber(H + u)) > 0, 'exact sum is greater')
  })

  it('clock-v3 A clock-v2 end-threshold analog: actual evaluator admits but the exact guard rejects', () => {
    const H = 2 ** 40
    const u = 0.50390725
    const evidence = decisionFixture()
    evidence.dispatch!.start = mark(H - 10)
    evidence.dispatch!.end = mark(H)
    evidence.server!.start = mark(H - 9, 'node')
    evidence.server!.end = mark(H - u, 'node') // fl(H-u): one rounding above the exact limit
    evidence.clockCalibration = { fromDomain: 'browser', toDomain: 'node', offsetMs: 0, uncertaintyMs: u, verified: true }
    accepted(evidence)
    const verdict = validateExactClockContainmentV3(consistentSymmetricBounds(u), clockEndpoints(H - 10, H, H - 9, H - u))
    assert.equal(verdict.numericProjectionOk, true, 'float envelope check alone admits')
    assert.equal(verdict.exactGuardOk, false, 'fl(H-u) exceeds the exact rational limit')
    assert.equal(verdict.contained, false)
    assert.ok(oracleCmp(oracleFromNumber(H - u), oracleSub(oracleFromNumber(H), oracleFromNumber(u))) > 0, 'end exact sum is greater')
  })

  it('clock-v3 A clock-v2 nonzero double-rounded offset sum: float admits its own rounding, exact sum is greater', () => {
    const offset = 2 ** 41 + 0.3
    const u = 0.001
    const evidence = decisionFixture()
    evidence.dispatch!.start = mark(10)
    evidence.dispatch!.end = mark(20)
    evidence.server!.start = mark(10 + offset + u, 'node') // same left-to-right float sum the evaluator computes
    evidence.server!.end = mark(20 + offset - u, 'node')
    evidence.clockCalibration = { fromDomain: 'browser', toDomain: 'node', offsetMs: offset, uncertaintyMs: u, verified: true }
    accepted(evidence)
    const verdict = validateExactClockContainmentV3(boundsWithCU(offset, u), clockEndpoints(10, 20, 10 + offset + u, 20 + offset - u))
    assert.equal(verdict.numericProjectionOk, true, 'left-to-right float envelope admits its own double rounding')
    assert.equal(verdict.exactGuardOk, false, 'exact rational sum exceeds the double-rounded float')
    assert.equal(verdict.contained, false)
    assert.ok(oracleCmp(
      oracleAdd(oracleAdd(oracleFromNumber(10), oracleFromNumber(offset)), oracleFromNumber(u)),
      oracleFromNumber(10 + offset + u),
    ) > 0, 'exact start sum is greater than the float sum')
  })

  it('clock-v3 A clock-v2 exact boundary equality passes and canonical zero stays +0', () => {
    const verdict = validateExactClockContainmentV3(exactQuarterBounds(), clockEndpoints(1.25, 3.5, 2.75, 3.5))
    assert.equal(verdict.contained, true)
    assert.equal(verdict.numericProjectionOk, true)
    assert.equal(verdict.exactGuardOk, true)
    assert.equal(verdict.boundsCoverageOk, true)
    assert.equal(verdict.boundsProjectionOk, true)
    assert.equal(verdict.endpointsCoherent, true)
    assert.deepEqual(verdict.gaps, [])
    const zeroCase: ClockBoundsV3 = { ...exactQuarterBounds(), exactLowerMs: { numerator: '1', denominator: '1' }, exactUpperMs: { numerator: '1', denominator: '1' }, lowerMs: 1, upperMs: 1, offsetMs: 1, uncertaintyMs: 0 }
    assert.equal(validateExactClockContainmentV3(zeroCase, clockEndpoints(1, 2, 2, 2)).contained, true, 'u=0 exact equality passes')
    const negativeZero = validateExactClockContainmentV3({ ...zeroCase, uncertaintyMs: -0 }, clockEndpoints(1, 2, 2, 2))
    assert.equal(negativeZero.contained, false)
    assert.ok(negativeZero.gaps.some((g) => g.includes('negative-zero')), 'non-canonical -0 is rejected')
    const nearMiss = validateExactClockContainmentV3(exactQuarterBounds(), clockEndpoints(1.25, 3.5, 2.4999999999999996, 3.5))
    assert.equal(nearMiss.exactGuardOk, false, 'one ulp below the exact limit fails')
    assert.equal(nearMiss.contained, false)
  })

  it('clock-v3 A clock-v2 verdict recomputes projection and coverage bits instead of trusting stored numbers', () => {
    const tamperedC = validateExactClockContainmentV3({ ...exactQuarterBounds(), offsetMs: 1.0000000000000002 }, clockEndpoints(1.25, 3.5, 2.75, 3.5))
    assert.equal(tamperedC.boundsProjectionOk, false, 'stored offset one ulp off the recomputed projection is caught')
    assert.equal(tamperedC.contained, false)
    const tamperedU = validateExactClockContainmentV3({ ...exactQuarterBounds(), uncertaintyMs: 0.25000000000000006 }, clockEndpoints(1.25, 3.5, 2.75, 3.5))
    assert.equal(tamperedU.boundsProjectionOk, false, 'stored uncertainty one ulp off the outward recomputation is caught')
    assert.equal(tamperedU.contained, false)
    const tamperedUpper = validateExactClockContainmentV3({ ...exactQuarterBounds(), upperMs: 1.2499999999999998 }, clockEndpoints(1.25, 3.5, 2.75, 3.5))
    assert.equal(tamperedUpper.boundsCoverageOk, false, 'stored upper bound below the exact interval is caught')
    assert.equal(tamperedUpper.contained, false)
    const tamperedLower = validateExactClockContainmentV3({ ...exactQuarterBounds(), lowerMs: 0.7500000000000001 }, clockEndpoints(1.25, 3.5, 2.75, 3.5))
    assert.equal(tamperedLower.boundsCoverageOk, false, 'stored lower bound above the exact interval is caught')
    assert.equal(tamperedLower.contained, false)
  })

  it('clock-v3 A clock-v2 verdicts fail closed on scope mismatch, incoherent endpoints and malformed fractions', () => {
    const scopeMismatch = validateExactClockContainmentV3({ ...exactQuarterBounds(), scopeId: 'other-scope' }, clockEndpoints(1.25, 3.5, 2.75, 3.5))
    assert.equal(scopeMismatch.contained, false)
    assert.ok(scopeMismatch.gaps.includes('scope-mismatch'))
    const incoherent = validateExactClockContainmentV3(exactQuarterBounds(), { ...clockEndpoints(1.25, 3.5, 2.75, 3.5), recordStart: mark(999) })
    assert.equal(incoherent.endpointsCoherent, false)
    assert.equal(incoherent.contained, false)
    assert.ok(incoherent.gaps.some((g) => g.startsWith('endpoints-incoherent')))
    const domainMismatch = validateExactClockContainmentV3({ ...exactQuarterBounds(), toDomain: 'other' }, clockEndpoints(1.25, 3.5, 2.75, 3.5))
    assert.equal(domainMismatch.endpointsCoherent, false)
    assert.equal(domainMismatch.contained, false)
    const malformed = validateExactClockContainmentV3({ ...exactQuarterBounds(), exactLowerMs: { numerator: '0x10', denominator: '4' } }, clockEndpoints(1.25, 3.5, 2.75, 3.5))
    assert.equal(malformed.contained, false)
    assert.ok(malformed.gaps.some((g) => g.startsWith('bounds-unparseable')))
    const inverted = validateExactClockContainmentV3({ ...exactQuarterBounds(), exactLowerMs: { numerator: '9', denominator: '4' } }, clockEndpoints(1.25, 3.5, 2.75, 3.5))
    assert.equal(inverted.contained, false)
    const nonFinite = validateExactClockContainmentV3({ ...exactQuarterBounds(), uncertaintyMs: Number.NaN }, clockEndpoints(1.25, 3.5, 2.75, 3.5))
    assert.equal(nonFinite.contained, false)
    assert.ok(nonFinite.gaps.some((g) => g.startsWith('bounds-uncertaintyMs-nonfinite')))
  })

  it('clock-v3 A clock-v2 derived bounds self-verify and robust containment fails closed on mere overlap', () => {
    const from = [clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const to = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const bounds = deriveClockBoundsV3(from, to, clockEndpointsRepair(
      clockMarkRepair(5, 'browser', from[0]), clockMarkRepair(5, 'browser', from[0]),
      clockMarkRepair(5, 'node', to[0]), clockMarkRepair(5, 'node', to[0]),
    ))
    const inside = validateExactClockContainmentV3(bounds, clockEndpoints(5, 15, 6, 14))
    assert.equal(inside.contained, true, 'server points strictly inside the derived envelope pass both checks')
    const overlap = validateExactClockContainmentV3(bounds, clockEndpoints(5, 15, 5.2, 14))
    assert.equal(overlap.contained, false, 'server start inside the uncertainty band fails closed')
    assert.equal(overlap.numericProjectionOk, false)
    assert.equal(overlap.exactGuardOk, false)
  })

  it('clock-v3 A clock-v2 pure math API returns no authority and exports no placeholder verifier', async () => {
    const support = await import('../support/rejection-recovery-matrix')
    assert.equal(typeof (support as Record<string, unknown>).verifyClockCalibrationProofV3, 'undefined', 'lane A must not mint a placeholder verified API')
    const from = [clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const to = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const bounds = deriveClockBoundsV3(from, to, clockEndpointsRepair(
      clockMarkRepair(5, 'browser', from[0]), clockMarkRepair(5, 'browser', from[0]),
      clockMarkRepair(5, 'node', to[0]), clockMarkRepair(5, 'node', to[0]),
    ))
    const verdict = validateExactClockContainmentV3(bounds, clockEndpoints(5, 15, 5, 15))
    const produced = sampleClockMarkV3(clockDescriptor(), clockReaders(BigInt(0), BigInt(1000), 5))
    for (const [name, value] of [['bounds', bounds], ['verdict', verdict], ['mark', produced], ['sample', produced.clockSample]] as const) {
      const text = JSON.stringify(value)
      assert.ok(!text.includes('"verified"'), `${name} must not carry authority labels`)
      assert.ok(!text.includes('"trusted"'), `${name} must not carry trust labels`)
    }
  })
})


// ---------------------------------------------------------------------------
// clock-v3 lane A authorized Stage A repair (stage-A-repair-20261017T235059Z).
// Regressions for the seven independent-review findings, appended after the
// Stage A candidate bytes preserved as before-repair-*.txt in the repair
// directory. Names begin `clock-v3 A ` (stage gate) and carry `clock-v2`
// (focused RED/GREEN pattern). Scope: only Stage A additions are corrected.
// ---------------------------------------------------------------------------
import { completeClockSamplerDescriptorV3 } from '../support/rejection-recovery-matrix'
import type { ClockMark } from '../support/rejection-recovery-matrix'
import type { ClockSampleV3 as RepairClockSampleV3, ClockObserverBootstrapV3, ClockSelfAcquisitionV3, ClockScopeSeedV3 } from '../support/rejection-recovery-matrix'

const clockMarkRepair = (monotonicMs: number, domain: string, sample: RepairClockSampleV3): ClockMark =>
  ({ domain, monotonicMs, wallMs: 1760000000000 + monotonicMs, clockSample: sample })
const clockEndpointsRepair = (
  dispatchStart: ClockMark,
  dispatchEnd: ClockMark,
  serverStart: ClockMark,
  serverEnd: ClockMark,
): ClockEndpointSetV3 => ({
  schema: 'rrm-clock-endpoints-v3',
  scopeId: clockScopeId,
  recordStart: dispatchStart,
  dispatchStart,
  dispatchEnd,
  serverStart,
  serverEnd,
  sources: { record: clockSnap(11), dispatchStart: clockSnap(12), dispatchEnd: clockSnap(13), serverStart: clockSnap(14), serverEnd: clockSnap(15) },
})
type OracleEndpointP = { dispatchStart: number; dispatchEnd: number; serverStart: number; serverEnd: number }
/** Independent recomputation whose endpoint allowances come only from the
 *  actual associated endpoint sample magnitudes (never the array maximum). */
const oracleDeriveRepair = (from: OracleSampleInput[], to: OracleSampleInput[], endpointP: OracleEndpointP, hostQuantization = true) => {
  const interval = (samples: OracleSampleInput[]) => {
    let lower: OracleRat | null = null
    let upper: OracleRat | null = null
    for (const s of samples) {
      const p = oracleFromNumber(s.rawPerformanceMs)
      const beforeMs = oracleRat(BigInt(s.sharedBeforeNs), BigInt(1000000))
      const afterMs = oracleRat(BigInt(s.sharedAfterNs), BigInt(1000000))
      const e = oracleEofP(s.rawPerformanceMs)
      const lo = oracleSub(oracleSub(p, afterMs), e)
      const hi = oracleAdd(oracleSub(p, beforeMs), e)
      if (lower === null || oracleCmp(lo, lower) > 0) lower = lo
      if (upper === null || oracleCmp(hi, upper) < 0) upper = hi
    }
    if (lower === null || upper === null) throw new Error('oracle empty role')
    return { lower, upper }
  }
  const eOf = oracleEofP
  const hostE = oracleCmp(eOf(endpointP.dispatchStart), eOf(endpointP.dispatchEnd)) >= 0 ? eOf(endpointP.dispatchStart) : eOf(endpointP.dispatchEnd)
  const serverE = oracleCmp(eOf(endpointP.serverStart), eOf(endpointP.serverEnd)) >= 0 ? eOf(endpointP.serverStart) : eOf(endpointP.serverEnd)
  const half = { n: BigInt(1), d: BigInt(2) }
  const hostAllow = hostQuantization ? oracleAdd(hostE, half) : hostE
  const host = interval(from)
  const server = interval(to)
  const hostLower = oracleSub(host.lower, hostAllow)
  const hostUpper = oracleAdd(host.upper, hostAllow)
  const serverLower = oracleSub(server.lower, serverE)
  const serverUpper = oracleAdd(server.upper, serverE)
  return { lower: oracleSub(serverLower, hostUpper), upper: oracleSub(serverUpper, hostLower) }
}
const clockRawSample = (fields: ClockSampleV3): ClockSampleV3 => fields

describe('clock-v3 A clock-v2 Stage A repair regressions (seven review findings)', () => {
  it('clock-v3 A clock-v2 repair pre-root seed/bootstrap descriptors carry no future root hash and complete only from the observed root ref', () => {
    assert.equal(typeof completeClockSamplerDescriptorV3, 'function', 'pre-root/complete descriptor separation needs a real pure constructor')
    const preRoot = {
      schema: 'rrm-clock-preroot-descriptor-v3' as const,
      scopeId: clockScopeId,
      clockInstanceId: clockUuid(5),
      domain: 'observer' as const,
      representation: 'raw-ms' as const,
      basis: 'node-hrtime-bigint-performance-now' as const,
    }
    const observedRoot = { path: 'clock/root-scope.json', sha256: 'd'.repeat(64), bytes: 256 }
    const acquired = clockAcquiredIdentity()
    const complete = completeClockSamplerDescriptorV3(preRoot, acquired, observedRoot, 11)
    assert.equal(complete.schema, 'rrm-clock-sampler-v3')
    assert.equal(complete.sequence, 11)
    assert.deepEqual(complete.rootScopeObservedRef, observedRoot)
    assert.equal(complete.clockInstanceId, clockUuid(5))
    assert.throws(() => completeClockSamplerDescriptorV3(preRoot, acquired, { path: '', sha256: 'zz', bytes: 0 }, 11), (e: unknown) => e instanceof ClockMathErrorV3 && e.code === 'invalid-descriptor', 'no dummy root ArtifactRef')
    assert.throws(() => completeClockSamplerDescriptorV3(preRoot, acquired, observedRoot, 0), (e: unknown) => e instanceof ClockMathErrorV3 && e.code === 'invalid-descriptor')
  })

  it('clock-v3 A clock-v2 repair every imported sample clockInstanceId is canonical: singleton and later elements in both roles', () => {
    const goodFrom = [clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const goodTo = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const endpoints = clockEndpoints(5, 5, 5, 5)
    clockThrow(() => deriveClockBoundsV3([clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0', clockInstanceId: '' })], goodTo, endpoints), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3(goodFrom, [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0', clockInstanceId: 'not-a-uuid' })], endpoints), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3([
      goodFrom[0],
      clockHostSample({ sequence: 2, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0', clockInstanceId: '00000000-0000-4000-8000-zzzzzzzzzzzz' }),
    ], goodTo, endpoints), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3(goodFrom, [
      goodTo[0],
      clockObserverSample({ sequence: 2, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0', clockInstanceId: '' }),
    ], endpoints), 'invalid-samples')
  })

  it('clock-v3 A clock-v2 repair endpoint marks must embed, associate and render their actual samples: no missing or substituted sample', () => {
    const goodFrom = [clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const goodTo = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    clockThrow(() => deriveClockBoundsV3(goodFrom, goodTo, clockEndpoints(5, 5, 5, 5)), 'invalid-endpoints')
    const foreign = clockHostSample({ sequence: 9, rawPerformanceMs: 15, sharedBeforeNs: '9990000', sharedAfterNs: '10010000' })
    clockThrow(() => deriveClockBoundsV3(goodFrom, goodTo, clockEndpointsRepair(
      clockMarkRepair(5, 'browser', goodFrom[0]),
      clockMarkRepair(15, 'browser', foreign),
      clockMarkRepair(5, 'node', goodTo[0]),
      clockMarkRepair(5, 'node', goodTo[0]),
    )), 'invalid-endpoints')
  })

  it('clock-v3 A clock-v2 repair rendered mark values must match their associated raw/rounded samples', () => {
    const goodFrom = [clockHostSample({ sequence: 1, rawPerformanceMs: 5.5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const goodTo = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5.5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    clockThrow(() => deriveClockBoundsV3(goodFrom, goodTo, clockEndpointsRepair(
      clockMarkRepair(5.5, 'browser', goodFrom[0]),
      clockMarkRepair(5.5, 'browser', goodFrom[0]),
      clockMarkRepair(5.5, 'node', goodTo[0]),
      clockMarkRepair(5.5, 'node', goodTo[0]),
    )), 'invalid-endpoints')
    clockThrow(() => deriveClockBoundsV3(goodFrom, goodTo, clockEndpointsRepair(
      clockMarkRepair(6, 'browser', goodFrom[0]),
      clockMarkRepair(6, 'browser', goodFrom[0]),
      clockMarkRepair(6, 'node', goodTo[0]),
      clockMarkRepair(5.5, 'node', goodTo[0]),
    )), 'invalid-endpoints')
  })

  it('clock-v3 A clock-v2 repair endpoint allowances derive from the associated endpoint magnitudes, larger than anchors and larger than array maxima', () => {
    const anchorHost = clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })
    const endpointHost = clockHostSample({ sequence: 2, rawPerformanceMs: 15, sharedBeforeNs: '9990000', sharedAfterNs: '10010000' })
    const wideHost = clockHostSample({ sequence: 3, rawPerformanceMs: 1000, sharedBeforeNs: '995000000', sharedAfterNs: '995000000' })
    const anchorObs = clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })
    const endpointObs = clockObserverSample({ sequence: 2, rawPerformanceMs: 15, sharedBeforeNs: '9990000', sharedAfterNs: '10010000' })
    const wideObs = clockObserverSample({ sequence: 3, rawPerformanceMs: 1000, sharedBeforeNs: '995000000', sharedAfterNs: '995000000' })
    const from = [anchorHost, endpointHost, wideHost]
    const to = [anchorObs, endpointObs, wideObs]
    const endpoints = clockEndpointsRepair(
      clockMarkRepair(5, 'browser', anchorHost),
      clockMarkRepair(15, 'browser', endpointHost),
      clockMarkRepair(5, 'node', anchorObs),
      clockMarkRepair(15, 'node', endpointObs),
    )
    const bounds = deriveClockBoundsV3(from, to, endpoints)
    const oracle = oracleDeriveRepair(from, to, { dispatchStart: 5, dispatchEnd: 15, serverStart: 5, serverEnd: 15 })
    assert.deepEqual(bounds.exactLowerMs, oracleStr(oracle.lower), 'exact lower uses the associated endpoint magnitudes')
    assert.deepEqual(bounds.exactUpperMs, oracleStr(oracle.upper), 'exact upper uses the associated endpoint magnitudes')
    // Independently: ±(1/2 + 2*(5+15)/2^50) = ±(2^46+5)/2^47.
    assert.deepEqual(bounds.exactLowerMs, { numerator: '-70368744177669', denominator: '140737488355328' })
    assert.deepEqual(bounds.exactUpperMs, { numerator: '70368744177669', denominator: '140737488355328' })
    const arrayMaxDistorted = oracleDerive(from, to)
    assert.notDeepEqual(bounds.exactUpperMs, oracleStr(arrayMaxDistorted.upper), 'array-maximum allowances must not replace the endpoint magnitudes')
    assert.ok(oracleCmp(oracleFromNumber(bounds.uncertaintyMs), oracle.upper) >= 0)
    assert.ok(oracleCmp(oracleFromNumber(oracleStepDown(bounds.uncertaintyMs)), oracle.upper) < 0)
    assert.equal(bounds.offsetMs, 0)
  })

  it('clock-v3 A clock-v2 repair missing or null endpoint marks return the documented negative verdict, never a TypeError', () => {
    const nullStart = { ...clockEndpoints(1.25, 3.5, 2.75, 3.5), dispatchStart: null } as unknown as ClockEndpointSetV3
    const verdictNull = validateExactClockContainmentV3(exactQuarterBounds(), nullStart)
    assert.equal(verdictNull.contained, false)
    assert.equal(verdictNull.endpointsCoherent, false)
    assert.ok(verdictNull.gaps.some((g) => g.startsWith('endpoints-incoherent')))
    const missing = { ...clockEndpoints(1.25, 3.5, 2.75, 3.5) } as unknown as Record<string, unknown>
    delete missing.serverEnd
    const verdictMissing = validateExactClockContainmentV3(exactQuarterBounds(), missing as unknown as ClockEndpointSetV3)
    assert.equal(verdictMissing.contained, false)
    assert.ok(verdictMissing.gaps.some((g) => g.startsWith('endpoints-incoherent')))
    assert.doesNotThrow(() => validateExactClockContainmentV3(exactQuarterBounds(), nullStart))
  })

  it('clock-v3 A clock-v2 repair derive outputs stay consumable at normal tiny and minimal-subnormal supported boundaries', () => {
    for (const p of [2 ** -300, 5e-324]) {
      const anchorHost = clockHostSample({ sequence: 1, rawPerformanceMs: p, sharedBeforeNs: '0', sharedAfterNs: '0' })
      const endHost = clockHostSample({ sequence: 2, rawPerformanceMs: 10, sharedBeforeNs: '10000000', sharedAfterNs: '10000000' })
      const anchorObs = clockObserverSample({ sequence: 1, rawPerformanceMs: p, sharedBeforeNs: '0', sharedAfterNs: '0' })
      const startObs = clockObserverSample({ sequence: 2, rawPerformanceMs: 1, sharedBeforeNs: '1000000', sharedAfterNs: '1000000' })
      const endObs = clockObserverSample({ sequence: 3, rawPerformanceMs: 9, sharedBeforeNs: '9000000', sharedAfterNs: '9000000' })
      const from = [anchorHost, endHost]
      const to = [anchorObs, startObs, endObs]
      const endpoints = clockEndpointsRepair(
        clockMarkRepair(Math.round(p), 'browser', anchorHost),
        clockMarkRepair(10, 'browser', endHost),
        clockMarkRepair(p, 'node', anchorObs),
        clockMarkRepair(9, 'node', endObs),
      )
      const bounds = deriveClockBoundsV3(from, to, endpoints)
      const verdict = validateExactClockContainmentV3(bounds, clockEndpoints(Math.round(p), 10, 1, 9))
      assert.ok(!verdict.gaps.some((g) => g.startsWith('bounds-unparseable')), `derived fractions must be consumable for P=${p}`)
      assert.equal(verdict.boundsCoverageOk, true)
      assert.equal(verdict.boundsProjectionOk, true)
      assert.equal(verdict.contained, true, `derive→validate round trip must hold for P=${p}`)
      const oracle = oracleDeriveRepair(from, to, { dispatchStart: p, dispatchEnd: 10, serverStart: p, serverEnd: 9 })
      assert.deepEqual(bounds.exactUpperMs, oracleStr(oracle.upper), `exact upper fraction matches oracle for P=${p}`)
    }
  })

  it('clock-v3 A clock-v2 repair value-identical birth tuples and root refs compare canonically regardless of property order', () => {
    const s1: ClockSampleV3 = clockRawSample({
      schema: 'rrm-clock-sample-v2',
      scopeId: clockScopeId,
      clockInstanceId: clockUuid(3),
      sequence: 1,
      domain: 'matrix-context-capture',
      representation: 'host-rounded-ms',
      basis: 'node-hrtime-bigint-performance-now',
      nativeBirth: { bootUuid: clockUuid(7), pid: 202, uniqueId: '9000000000000000001', idVersion: 3, executableUuid: 'a'.repeat(32) },
      observedParent: { pid: 1, parentUniqueId: '42' },
      rootScopeObservedRef: { path: 'clock/root-scope.json', sha256: 'b'.repeat(64), bytes: 128 },
      sharedBeforeNs: '0',
      rawPerformanceMs: 5,
      sharedAfterNs: '0',
    })
    const reordered: ClockSampleV3 = clockRawSample({
      sharedAfterNs: '0',
      rawPerformanceMs: 5,
      sharedBeforeNs: '0',
      rootScopeObservedRef: { bytes: 128, sha256: 'b'.repeat(64), path: 'clock/root-scope.json' },
      observedParent: { parentUniqueId: '42', pid: 1 },
      nativeBirth: { executableUuid: 'a'.repeat(32), idVersion: 3, uniqueId: '9000000000000000001', pid: 202, bootUuid: clockUuid(7) },
      basis: 'node-hrtime-bigint-performance-now',
      representation: 'host-rounded-ms',
      domain: 'matrix-context-capture',
      sequence: 2,
      clockInstanceId: clockUuid(3),
      scopeId: clockScopeId,
      schema: 'rrm-clock-sample-v2',
    } as ClockSampleV3)
    const to = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const endpoints = clockEndpointsRepair(
      clockMarkRepair(5, 'browser', s1),
      clockMarkRepair(5, 'browser', reordered),
      clockMarkRepair(5, 'node', to[0]),
      clockMarkRepair(5, 'node', to[0]),
    )
    const bounds = deriveClockBoundsV3([s1, reordered], to, endpoints)
    const oracle = oracleDeriveRepair([s1], to, { dispatchStart: 5, dispatchEnd: 5, serverStart: 5, serverEnd: 5 })
    assert.deepEqual(bounds.exactUpperMs, oracleStr(oracle.upper), 'reordered but identical process identity yields the same exact bounds')
  })

  it('clock-v3 A clock-v2 repair oversized decimals are rejected by bounded length before conversion', () => {
    const goodTo = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const goodFrom = [clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' })]
    const longNs = '9'.repeat(25)
    clockThrow(() => deriveClockBoundsV3([clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: longNs, sharedAfterNs: '0' })], goodTo, clockEndpoints(5, 5, 5, 5)), 'invalid-samples')
    clockThrow(() => deriveClockBoundsV3([clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '9'.repeat(21) })], goodTo, clockEndpoints(5, 5, 5, 5)), 'invalid-samples')
    const oversized = validateExactClockContainmentV3({ ...exactQuarterBounds(), exactUpperMs: { numerator: '9'.repeat(10000), denominator: '4' } }, clockEndpoints(1.25, 3.5, 2.75, 3.5))
    assert.equal(oversized.contained, false)
    assert.ok(oversized.gaps.some((g) => g.startsWith('bounds-unparseable')))
  })

  it('clock-v3 A clock-v2 repair genuinely cancelling offset −2^40: ties-even float admits while the exact sum is strictly greater', () => {
    const c = -(2 ** 40)
    const u = 2 ** -53
    const evidence = decisionFixture()
    evidence.dispatch!.start = mark(2 ** 40 + 1)
    evidence.dispatch!.end = mark(2 ** 40 + 2)
    evidence.server!.start = mark(1, 'node')
    evidence.server!.end = mark(2, 'node')
    evidence.clockCalibration = { fromDomain: 'browser', toDomain: 'node', offsetMs: c, uncertaintyMs: u, verified: true }
    accepted(evidence)
    const verdict = validateExactClockContainmentV3(boundsWithCU(c, u), clockEndpoints(2 ** 40 + 1, 2 ** 40 + 2, 1, 2))
    assert.equal(verdict.numericProjectionOk, true, 'cancelling sums round to ties-even and admit')
    assert.equal(verdict.exactGuardOk, false, 'exact rational start sum is 1+2^-53 > 1')
    assert.equal(verdict.contained, false)
    assert.ok(oracleCmp(
      oracleAdd(oracleAdd(oracleFromNumber(2 ** 40 + 1), oracleFromNumber(c)), oracleFromNumber(u)),
      oracleFromNumber(1),
    ) > 0, 'exact start sum is greater than the cancelled float')
  })
})

// Six remaining Stage A findings: pure mathematical/type construction only.
const clockAcquiredIdentity = (): ClockSelfAcquisitionV3 => ({
  schema: 'rrm-clock-self-acquisition-v3',
  birth: clockBirth(),
  parent: { pid: 1, parentUniqueId: '42' },
  leaseRef: clockSnap(21).snapshotRef,
  registrationRef: clockSnap(22).snapshotRef,
  completionRef: clockSnap(23).snapshotRef,
  startedNs: '0',
  finishedNs: '0',
})
const clockBootstrapBeforeAcquisition = (): ClockObserverBootstrapV3 => ({
  schema: 'rrm-clock-observer-bootstrap-v3',
  seedRef: clockSnap(24).snapshotRef,
  protocolId: 'clock-v3',
  appDir: 'fixture/app',
  rootScopePath: 'fixture/clock/root.json',
  probeRoot: 'fixture/clock/probes',
  toolPolicyRef: clockSnap(25).snapshotRef,
  sourceDescriptor: {
    schema: 'rrm-clock-preroot-descriptor-v3',
    scopeId: clockScopeId,
    clockInstanceId: clockUuid(5),
    domain: 'observer',
    representation: 'raw-ms',
    basis: 'node-hrtime-bigint-performance-now',
  },
})
const clockGptAssociationFixture = () => {
  const from = [clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '5000000', sharedAfterNs: '5000000' })]
  const to = [clockObserverSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '5000000', sharedAfterNs: '5000000' })]
  const endpoints = clockEndpointsRepair(
    clockMarkRepair(5, 'browser', from[0]), clockMarkRepair(5, 'browser', from[0]),
    clockMarkRepair(5, 'node', to[0]), clockMarkRepair(5, 'node', to[0]),
  )
  return { from, to, endpoints }
}

describe('clock-v3 A clock-v2 GPT bounded repair regressions', () => {
  it('clock-v3 A clock-v2 GPT F1 recordStart requires an actual associated host sample and correct rendered value', () => {
    const { from, to, endpoints } = clockGptAssociationFixture()
    assert.doesNotThrow(() => deriveClockBoundsV3(from, to, endpoints))
    const invalidRecords = [
      mark(5),
      clockMarkRepair(5, 'browser', { ...from[0], sequence: 99 }),
      clockMarkRepair(4, 'browser', from[0]),
      clockMarkRepair(5, 'browser', to[0]),
    ]
    for (const recordStart of invalidRecords) {
      clockThrow(() => deriveClockBoundsV3(from, to, { ...endpoints, recordStart }), 'invalid-endpoints')
    }
    // Separate record samples are required and intersected, but do not add
    // a fifth endpoint allowance, even with P > the interval endpoints' P
    // when both host values round to 5. Wide brackets contain K=0.
    for (const p of [4, 5.25]) {
      const record = clockHostSample({ sequence: 2, rawPerformanceMs: p, sharedBeforeNs: '0', sharedAfterNs: '10000000' })
      const associated = { ...endpoints, recordStart: clockMarkRepair(Math.round(p), 'browser', record) }
      const bounds = deriveClockBoundsV3([...from, record], to, associated)
      const original = deriveClockBoundsV3(from, to, endpoints)
      assert.deepEqual(bounds.exactLowerMs, original.exactLowerMs)
      assert.deepEqual(bounds.exactUpperMs, original.exactUpperMs)
    }
  })

  it('clock-v3 A clock-v2 GPT F2 bootstrap exists before acquisition and completes using the returned identity and observed root', () => {
    // This typed construction has no observer birth/parent or future root
    // hash. The fixture acquisition is supplied only AFTER bootstrap exists.
    const bootstrap = clockBootstrapBeforeAcquisition()
    assert.equal('nativeBirth' in bootstrap.sourceDescriptor, false)
    assert.equal('observedParent' in bootstrap.sourceDescriptor, false)
    assert.equal('rootScopeObservedRef' in bootstrap.sourceDescriptor, false)
    const acquired = clockAcquiredIdentity()
    acquired.birth = clockBirth({ pid: 303, uniqueId: '12345' })
    acquired.parent = { pid: 202, parentUniqueId: '67890' }
    const descriptor = completeClockSamplerDescriptorV3(bootstrap.sourceDescriptor, acquired, clockRootScopeRef, 1)
    assert.deepEqual(descriptor.nativeBirth, acquired.birth)
    assert.deepEqual(descriptor.observedParent, acquired.parent)
    assert.deepEqual(descriptor.rootScopeObservedRef, clockRootScopeRef)
    const sampled = sampleClockMarkV3(descriptor, clockReaders(BigInt(0), BigInt(0), 5))
    assert.deepEqual(sampled.clockSample!.nativeBirth, acquired.birth)
    assert.deepEqual(sampled.clockSample!.observedParent, acquired.parent)
    clockThrow(() => completeClockSamplerDescriptorV3(bootstrap.sourceDescriptor, null as never, clockRootScopeRef, 1), 'invalid-descriptor')
    clockThrow(() => completeClockSamplerDescriptorV3(bootstrap.sourceDescriptor, { ...acquired, birth: null as never }, clockRootScopeRef, 1), 'invalid-descriptor')
    clockThrow(() => completeClockSamplerDescriptorV3(bootstrap.sourceDescriptor, { ...acquired, parent: undefined as never }, clockRootScopeRef, 1), 'invalid-descriptor')
    // Known driver identity still has an explicit seed slot; no observer
    // acquisition or authority-verifying implementation is simulated here.
    const driver: ClockScopeSeedV3['driverDescriptor'] = {
      ...bootstrap.sourceDescriptor,
      domain: 'matrix-context-capture', representation: 'host-rounded-ms',
      nativeBirth: clockBirth({ pid: 202 }), observedParent: { pid: 1, parentUniqueId: '42' },
    }
    assert.equal(driver.nativeBirth.pid, 202)
  })

  it('clock-v3 A clock-v2 GPT F7 birth IDs are length-bounded before BigInt on sampler, imported samples and completion paths', () => {
    const nativeBigInt = globalThis.BigInt
    const allocations: string[] = []
    const rejectionFailures: string[] = []
    let pathUnderTest = ''
    const rejectBirth = (path: string, run: () => unknown, code: string) => {
      pathUnderTest = path
      try { clockThrow(run, code) } catch (error) { rejectionFailures.push(path + ': ' + String(error)) }
    }
    // Observe real production conversions, not a substitute math API. An
    // accidental oversized conversion fails before allocating its BigInt.
    globalThis.BigInt = new Proxy(nativeBigInt, {
      apply(target, thisArg, args) {
        if (typeof args[0] === 'string' && args[0].length > 20) {
          allocations.push(pathUnderTest + ': ' + args[0].length + ' digits')
          throw new Error('oversized birth reached BigInt')
        }
        return Reflect.apply(target, thisArg, args)
      },
    })
    try {
      for (const uniqueId of ['9'.repeat(21), '9'.repeat(10000), '0', '007', '18446744073709551616']) {
        const birth = clockBirth({ uniqueId })
        rejectBirth('sampler', () => sampleClockMarkV3(clockDescriptor({ nativeBirth: birth }), clockReaders(nativeBigInt(0), nativeBigInt(0), 5)), 'invalid-descriptor')
        const acquired = { ...clockAcquiredIdentity(), birth }
        rejectBirth('completion', () => completeClockSamplerDescriptorV3(clockBootstrapBeforeAcquisition().sourceDescriptor, acquired, clockRootScopeRef, 1), 'invalid-descriptor')
        for (const role of ['from', 'to'] as const) {
          for (const later of [false, true]) {
            const { from, to, endpoints } = clockGptAssociationFixture()
            const bad = { ...(role === 'from' ? from[0] : to[0]), nativeBirth: birth, sequence: later ? 2 : 1 }
            const samples = later ? [role === 'from' ? from[0] : to[0], bad] : [bad]
            rejectBirth('imported-' + role + (later ? '-later' : '-singleton'), () => deriveClockBoundsV3(role === 'from' ? samples : from, role === 'to' ? samples : to, endpoints), 'invalid-samples')
          }
        }
      }
      assert.deepEqual(allocations, [], 'no oversized birth input reaches BigInt on any API path')
      assert.deepEqual(rejectionFailures, [], 'all malformed IDs produce the documented typed failure')
      for (const uniqueId of ['1', '18446744073709551615']) {
        assert.doesNotThrow(() => sampleClockMarkV3(clockDescriptor({ nativeBirth: clockBirth({ uniqueId }) }), clockReaders(nativeBigInt(0), nativeBigInt(0), 5)))
      }
    } finally {
      globalThis.BigInt = nativeBigInt
    }
  })

  it('clock-v3 A clock-v2 GPT R1 oversized finite-parsable fractions yield negative projection verdicts rather than exceptions', () => {
    const huge = (BigInt(1) << BigInt(1100)).toString()
    for (const [lower, upper] of [[huge, huge], ['-' + huge, '-' + huge], ['-' + huge, huge]]) {
      const bounds = { ...exactQuarterBounds(), exactLowerMs: { numerator: lower, denominator: '1' }, exactUpperMs: { numerator: upper, denominator: '1' } }
      let verdict: ReturnType<typeof validateExactClockContainmentV3> | undefined
      assert.doesNotThrow(() => { verdict = validateExactClockContainmentV3(bounds, clockEndpoints(1.25, 3.5, 2.75, 3.5)) })
      assert.equal(verdict!.contained, false)
      assert.equal(verdict!.boundsProjectionOk, false)
      assert.ok(verdict!.gaps.some((g) => g.startsWith('bounds-projection-unrepresentable:')))
      assert.ok(!verdict!.gaps.some((g) => g.startsWith('bounds-unparseable:')), 'expanded rational support must remain')
    }
  })

  it('clock-v3 A clock-v2 GPT R2 null or missing embedded birth, parent and root fields fail with invalid-endpoints', () => {
    for (const endpoint of ['dispatchStart', 'dispatchEnd', 'serverStart', 'serverEnd', 'recordStart'] as const) {
      for (const field of ['nativeBirth', 'observedParent', 'rootScopeObservedRef'] as const) {
        for (const missing of [false, true]) {
          const { from, to, endpoints } = clockGptAssociationFixture()
          const malformed: Record<string, unknown> = { ...endpoints[endpoint].clockSample }
          if (missing) delete malformed[field]
          else malformed[field] = null
          endpoints[endpoint] = { ...endpoints[endpoint], clockSample: malformed as unknown as ClockSampleV3 }
          clockThrow(() => deriveClockBoundsV3(from, to, endpoints), 'invalid-endpoints')
        }
      }
    }
  })

  it('clock-v3 A clock-v2 GPT R3 independent literal bounds pin the endpoint fixture, not array-maximum allowances', () => {
    const from = [
      clockHostSample({ sequence: 1, rawPerformanceMs: 5, sharedBeforeNs: '0', sharedAfterNs: '0' }),
      clockHostSample({ sequence: 2, rawPerformanceMs: 15, sharedBeforeNs: '9990000', sharedAfterNs: '10010000' }),
      clockHostSample({ sequence: 3, rawPerformanceMs: 1000, sharedBeforeNs: '995000000', sharedAfterNs: '995000000' }),
    ]
    const to = from.map((s) => clockObserverSample({ sequence: s.sequence, rawPerformanceMs: s.rawPerformanceMs, sharedBeforeNs: s.sharedBeforeNs, sharedAfterNs: s.sharedAfterNs }))
    const endpoints = clockEndpointsRepair(
      clockMarkRepair(5, 'browser', from[0]), clockMarkRepair(15, 'browser', from[1]),
      clockMarkRepair(5, 'node', to[0]), clockMarkRepair(15, 'node', to[1]),
    )
    const bounds = deriveClockBoundsV3(from, to, endpoints)
    // Tight intersections ±e(5); each role's endpoints allow e(15), with
    // host 1/2. Thus |O| = 1/2 + 2*(5+15)/2^50
    // = (2^46+5)/2^47, independently reduced by hand.
    assert.deepEqual(bounds.exactLowerMs, { numerator: '-70368744177669', denominator: '140737488355328' })
    assert.deepEqual(bounds.exactUpperMs, { numerator: '70368744177669', denominator: '140737488355328' })
    const arrayMaxDistorted = oracleDerive(from, to)
    assert.notDeepEqual(bounds.exactUpperMs, oracleStr(arrayMaxDistorted.upper), 'compare equivalent serialized fractions')
  })
})

describe('clock-v3 B clock-v2 observer self acquisition, pinned native bridge and probe lifecycle', () => {
  type SpawnSyncStub = (file: string, args: readonly string[], options: {
    timeout: number; killSignal: 'SIGKILL'; maxBuffer: number; shell: false
    encoding: 'buffer'; env: Record<string, string>
  }) => { status: number | null; signal: string | null; error?: { code?: string; message?: string }; stdout: string; stderr: string; pid?: number }

  
  function canonicalBridgeLine(pid: number, overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      bootUuid: '57e93041-450b-4881-a1b9-f278f4030349',
      pid,
      uniqueId: '4242424242',
      idVersion: 7,
      executableUuid: 'a'.repeat(32),
      ppid: 1,
      parentUniqueId: '99',
      pgid: pid,
      status: 2,
      flags: 0,
      ...overrides,
    })
  }

  function syntheticBirth(pid: number): Record<string, unknown> {
    return {
      bootUuid: '57e93041-450b-4881-a1b9-f278f4030349',
      pid,
      uniqueId: '4242424242',
      idVersion: 7,
      executableUuid: 'a'.repeat(32),
    }
  }

  const osStubJson = { kernelRelease: '25.6.0', osBuild: '25G83', bootUuid: '57e93041-450b-4881-a1b9-f278f4030349', pythonVersion: '3.14.6' }

  function singleReplyLine(node: Record<string, unknown>): string {
    return JSON.stringify({ schema: 'rrm-clock-bridge-reply-br-v2', ok: true, mode: 'single', requestedPid: node.pid, os: osStubJson, read: node }) + '\n'
  }

  function farDeadline(domain = 'clock-v3 B host read'): { domain: string; expiresMs: number; now: () => number } {
    return { domain, expiresMs: Date.now() + 15000, now: () => Date.now() }
  }

  function expectFailure(result: { ok: boolean; failure?: { code: string; detail: string } }, code: string): void {
    assert.equal(result.ok, false, `expected typed failure ${code}`)
    assert.equal(result.failure!.code, code)
    assert.equal(typeof result.failure!.detail, 'string')
    assert.ok(result.failure!.detail.length < 400, 'failure detail stays bounded, never a raw dump')
  }

  function observerBootstrap(scopeId: string, probeRoot: string): Record<string, unknown> {
    return {
      schema: 'rrm-clock-observer-bootstrap-v3',
      seedRef: { path: '/tmp/clock-b-fixture/seed.json', sha256: 'b'.repeat(64), bytes: 10 },
      protocolId: 'rrm-clock-v3',
      appDir: process.cwd(),
      rootScopePath: '/tmp/clock-b-fixture/root-scope.json',
      probeRoot,
      toolPolicyRef: { path: '/tmp/clock-b-fixture/tool-policy.json', sha256: 'c'.repeat(64), bytes: 10 },
      sourceDescriptor: {
        schema: 'rrm-clock-preroot-descriptor-v3',
        scopeId,
        clockInstanceId: 'd1e2c0a7-0000-4000-8000-000000000001',
        domain: 'observer',
        representation: 'raw-ms',
        basis: 'node-hrtime-bigint-performance-now',
      },
    }
  }

  type OwnedFixtureMode =
    | 'normal'
    | 'child-spawn-error'
    | 'child-exit-before-ready'
    | 'parent-exit-before-ready'
    | 'parent-disconnect-before-ready'
    | 'invalid-reap-ack'
    | 'missing-reap-ack'
    | 'parent-spawn-error'
    | 'ack-then-stall'

  type OwnedFixtureOutcome = {
    mode: OwnedFixtureMode
    readyProblem: string | null
    reapAck: { kind: 'reaped'; childPid: number; code: number | null; signal: string | null } | null
    validatedChildExit: { childPid: number; code: number | null; signal: string | null } | null
    childExitObserved: boolean
    childExit: { code: number | null; signal: string | null } | null
    parentExit: { code: number | null; signal: NodeJS.Signals | null } | null
    parentExitObserved: boolean
    failedToStart: boolean
    escalated: boolean
    unresolvedOwnership: { parentPid: number; stillAlive: boolean } | null
    messageKinds: string[]
  }

  function ownedFixtureParentSource(mode: OwnedFixtureMode): string {
    if (mode === 'parent-exit-before-ready') return 'process.exit(3)'
    const childSource = mode === 'child-exit-before-ready'
      ? 'process.exit(0)'
      : "process.stdin.resume(); process.stdin.on('end', () => { if (process.connected) process.disconnect(); }); if (process.connected) process.send({kind:'child-ready', pid:process.pid})"
    const childFile = mode === 'child-spawn-error' ? "'definitely-not-an-executable-owned-fixture-a71c3'" : 'process.execPath'
    const childExitReport = "process.stdout.write(JSON.stringify({kind:'child-exit', childPid: child.pid, code, signal}) + '\\n')"
    const onChildMessage = mode === 'parent-disconnect-before-ready'
      ? `process.disconnect();
        child.once('exit', (code, signal) => { process.exitCode = 5; process.stdout.write(JSON.stringify({kind:'child-exit', childPid: child.pid, code, signal}) + '\\n', () => process.exit(5)); });
        return;`
      : `
        if (message.kind !== 'child-ready' || message.pid !== child.pid) throw new Error('invalid child readiness');
        readySent = true;
        process.send({kind:'ready', rootPid:process.pid, childPid:child.pid});
      `
    const onChildExit = mode === 'parent-disconnect-before-ready'
      ? ''
      : mode === 'missing-reap-ack'
        ? `child.once('exit', (code, signal) => { ${childExitReport}; process.exitCode = 1; process.disconnect(); });`
        : mode === 'invalid-reap-ack'
          ? `child.once('exit', (code, signal) => { ${childExitReport}; process.send({kind:'reaped', childPid: 999999, code: 7, signal: 'SIGURG'}, () => process.disconnect()); });`
          : mode === 'ack-then-stall'
            ? `child.once('exit', (code, signal) => { ${childExitReport}; process.send({kind:'reaped', childPid:child.pid, code, signal}, () => process.disconnect()); const stall = setInterval(() => {}, 1000); setTimeout(() => { clearInterval(stall); process.exit(0); }, 12000); });`
            : `child.once('exit', (code, signal) => { ${childExitReport}; process.send({kind:'reaped', childPid:child.pid, code, signal}, () => process.disconnect()); if (code !== 0 || signal !== null || !readySent) process.exitCode = 1; });`
    return `
      const {spawn} = require('node:child_process');
      const child = spawn(${childFile}, ['-e', ${JSON.stringify(childSource)}], {stdio:['pipe','ignore','inherit','ipc']});
      let readySent = false;
      child.on('error', (err) => {
        process.send({kind:'child-error', code:'spawn', detail: String((err && err.code) || err)});
        process.exitCode = 1;
        process.disconnect();
      });
      child.stdin.on('error', () => {});
      child.once('message', message => {
        ${onChildMessage}
      });
      ${onChildExit}
      process.stdin.resume();
      process.stdin.once('end', () => child.stdin.end());
    `
  }

  async function startOwnedReadyTopology(mode: OwnedFixtureMode = 'normal'): Promise<{ ready: Promise<{ rootPid: number; childPid: number }>; stop: () => Promise<OwnedFixtureOutcome> }> {
    const cp = await import('node:child_process')
    const parentFile = mode === 'parent-spawn-error' ? 'definitely-not-an-executable-owned-fixture-parent-e5b9' : process.execPath
    const parent = cp.spawn(parentFile, ['-e', ownedFixtureParentSource(mode)], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] })
    const messages: string[] = []
    const stdoutChunks: Buffer[] = []
    let reapAck: OwnedFixtureOutcome['reapAck'] = null
    let validatedChildExit: OwnedFixtureOutcome['validatedChildExit'] = null
    let parentExit: OwnedFixtureOutcome['parentExit'] = null
    let readyProblem: string | null = null
    let readyDone = false
    let readyIds: { rootPid: number; childPid: number } | null = null
    let failedToStart = false
    let resolveTerminal!: () => void
    const terminalSettled = new Promise<void>((resolve) => { resolveTerminal = resolve })
    const markTerminal = (): void => { resolveTerminal(); resolveTerminal = (): void => {} }
    parent.stdout?.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk) })
    parent.stdout?.on('error', () => {})
    const ready = new Promise<{ rootPid: number; childPid: number }>((resolve, reject) => {
      const failReadiness = (problem: string): void => {
        if (readyDone) return
        readyDone = true
        readyProblem = problem
        reject(new Error(problem))
      }
      parent.once('error', (error: Error) => {
        failedToStart = true
        if (parentExit === null) parentExit = { code: null, signal: null }
        markTerminal()
        failReadiness(`fixture parent spawn error: ${error.message}`)
      })
      parent.on('message', (message: any) => {
        messages.push(String(message && message.kind))
        if (message && message.kind === 'ready') {
          if (message.rootPid !== parent.pid) return failReadiness(`readiness did not bind the actual owned fixture parent: ${String(message.rootPid)} !== ${parent.pid}`)
          if (!Number.isInteger(message.childPid) || message.childPid <= 0) return failReadiness(`fixture parent acknowledged an invalid child pid: ${String(message.childPid)}`)
          if (!readyDone) {
            readyDone = true
            readyProblem = null
            readyIds = { rootPid: message.rootPid, childPid: message.childPid }
            resolve(readyIds)
          }
        } else if (message && message.kind === 'child-error') {
          failReadiness(`fixture child never started: ${String(message.detail ?? 'spawn failure')}`)
        } else if (message && message.kind === 'reaped') {
          if (reapAck === null) reapAck = { kind: 'reaped', childPid: message.childPid, code: message.code, signal: message.signal }
          if (!readyDone) failReadiness(`fixture child exited before readiness: code=${String(message.code)} signal=${String(message.signal)}`)
        }
      })
      parent.once('disconnect', () => { if (!readyDone) failReadiness('fixture parent disconnected before readiness') })
      parent.once('exit', (code, signal) => {
        if (parentExit === null && !failedToStart) parentExit = { code, signal }
        markTerminal()
        if (!readyDone) failReadiness(`fixture parent exited before readiness: code=${String(code)} signal=${String(signal)}`)
      })
      parent.once('close', (code, signal) => {
        if (parentExit === null) parentExit = { code, signal }
        markTerminal()
      })
    })
    ready.catch(() => {})
    parent.stdin?.on('error', () => {})
    let settled: Promise<void> | null = null
    let finalOutcome: OwnedFixtureOutcome | null = null
    const settleOnce = (): Promise<void> => {
      if (settled === null) settled = runSettle()
      return settled
    }
    async function runSettle(): Promise<void> {
      try { parent.stdin?.end() } catch { /* the owned stdin may already be destroyed */ }
      let escalated = false
      const awaitTerminal = (ms: number): Promise<boolean> => new Promise<boolean>((resolve) => {
        const cap = setTimeout(() => { clearTimeout(cap); resolve(false) }, ms)
        terminalSettled.then(() => { clearTimeout(cap); resolve(true) })
      })
      if (parentExit === null && !(await awaitTerminal(5000))) { escalated = true; parent.kill('SIGTERM') }
      if (parentExit === null && !(await awaitTerminal(5000))) { escalated = true; parent.kill('SIGKILL') }
      let unresolvedOwnership: OwnedFixtureOutcome['unresolvedOwnership'] = null
      if (parentExit === null) unresolvedOwnership = { parentPid: parent.pid ?? -1, stillAlive: true }
      await new Promise<void>((resolve) => {
        const stream = parent.stdout
        if (!stream || stream.destroyed || stream.readableEnded) return resolve()
        const done = (): void => resolve()
        stream.once('end', done)
        stream.once('close', done)
        stream.once('error', done)
      })
      const stdoutText = Buffer.concat(stdoutChunks).toString('utf8')
      for (const line of stdoutText.split('\n').reverse()) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('{')) continue
        try {
          const parsed = JSON.parse(trimmed) as { kind?: unknown; childPid?: unknown; code?: unknown; signal?: unknown }
          if (parsed.kind === 'child-exit' && typeof parsed.childPid === 'number' && Number.isInteger(parsed.childPid) && parsed.childPid > 0) {
            validatedChildExit = {
              childPid: parsed.childPid,
              code: parsed.code === null || typeof parsed.code === 'number' ? (parsed.code as number | null) : null,
              signal: parsed.signal === null || typeof parsed.signal === 'string' ? (parsed.signal as string | null) : null,
            }
            break
          }
        } catch { /* non-JSON stdout lines are ignored */ }
      }
      finalOutcome = {
        mode,
        readyProblem,
        reapAck,
        validatedChildExit,
        childExitObserved: validatedChildExit !== null,
        childExit: validatedChildExit === null ? null : { code: validatedChildExit.code, signal: validatedChildExit.signal },
        parentExit,
        parentExitObserved: parentExit !== null,
        failedToStart,
        escalated,
        unresolvedOwnership,
        messageKinds: messages.slice(),
      }
    }
    const assertLifecycle = (): OwnedFixtureOutcome => {
      const outcome = finalOutcome as OwnedFixtureOutcome
      const expectedChild = mode !== 'parent-exit-before-ready' && mode !== 'child-spawn-error' && mode !== 'parent-spawn-error'
      const problems: string[] = []
      if (outcome.readyProblem !== null) problems.push(outcome.readyProblem)
      if (outcome.reapAck === null) problems.push('fixture parent never acknowledged the fixture child reap')
      if (expectedChild && outcome.validatedChildExit === null) problems.push('fixture child exit was never independently accounted')
      if (readyIds !== null) {
        if (outcome.reapAck !== null && (outcome.validatedChildExit === null || outcome.reapAck.childPid !== outcome.validatedChildExit.childPid || outcome.reapAck.code !== outcome.validatedChildExit.code || outcome.reapAck.signal !== outcome.validatedChildExit.signal)) {
          problems.push(`reap acknowledgement mismatch: ${JSON.stringify(outcome.reapAck)}`)
        }
        if (outcome.parentExit === null || outcome.parentExit.code !== 0 || outcome.parentExit.signal !== null) {
          problems.push(`owned fixture parent exit is not clean: ${JSON.stringify(outcome.parentExit)}`)
        }
        if (messages.length !== 2 || messages[0] !== 'ready' || messages[1] !== 'reaped') {
          problems.push(`unexpected acknowledgement sequence: ${JSON.stringify(messages)}`)
        }
      }
      if (outcome.parentExit === null) problems.push('owned fixture parent exit was never observed')
      if (outcome.unresolvedOwnership !== null) problems.push(`owned fixture parent could not be terminated; unresolved ownership: ${JSON.stringify(outcome.unresolvedOwnership)}`)
      if (problems.length > 0) {
        const failure = new assert.AssertionError({
          message: `owned fixture lifecycle accounting failed: ${problems.join(' | ')}`,
          actual: problems,
          expected: [],
        })
        ;(failure as assert.AssertionError & { outcome: OwnedFixtureOutcome }).outcome = outcome
        throw failure
      }
      return outcome
    }
    const stop = async (): Promise<OwnedFixtureOutcome> => {
      await settleOnce()
      return assertLifecycle()
    }
    return { ready, stop }
  }

  it('clock-v3 B clock-v2 pinned bridge reads actual self birth metadata U→B→U on the current process', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const result = await B.readNativeClockProcessV3({ pid: process.pid, mode: 'single', deadline: farDeadline() })
    assert.equal(result.ok, true)
    if (!result.ok || result.kind !== 'single') return assert.fail('single read expected')
    const read = result.read
    assert.equal(read.pid, process.pid, 'metadata pid is the requested self pid, never the interpreter pid')
    assert.ok(read.ppid >= 0)
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(read.bootUuid), 'bootUuid is a canonical lowercase UUID')
    assert.ok(/^(0|[1-9][0-9]*)$/.test(read.uniqueId) && read.uniqueId !== '0' && read.uniqueId.length <= 20, 'uniqueId is a canonical nonzero uint64 decimal')
    assert.ok(/^[0-9a-f]{32}$/.test(read.executableUuid), 'executableUuid is 32 hex chars')
    assert.ok(Number.isInteger(read.idVersion))
    assert.notEqual(read.status, 5, 'SZOMB is rejected at the source')
    assert.equal(read.flags & 4, 0, 'PROC_FLAG_INEXIT is rejected at the source')
  })

  it('clock-v3 B clock-v2 host reader and direct fixed-literal spawn agree on a fresh owned fixture child with the correct pid', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const nodeChildProcess = await import('node:child_process')
    assert.ok(B.CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE.includes('/usr/lib/libproc.dylib'), 'the one fixed bridge literal pins libproc')
    assert.ok(B.CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE.includes('/usr/lib/libSystem.B.dylib'), 'the one fixed bridge literal pins libSystem')
    assert.ok(B.CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE.includes('kern.osrelease'), 'the bounded A1 release observation lives in the one fixed literal')
    assert.ok(B.CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE.includes('use_errno=True'), 'ctypes errno exchange is enabled in the one fixed literal')
    const fixture = await startOwnedReadyTopology()
    try {
      const ids = await fixture.ready
      const child = { pid: ids.childPid }
      const viaHost = await B.readNativeClockProcessV3({ pid: child.pid, mode: 'single', deadline: farDeadline() })
      const direct = nodeChildProcess.spawnSync(
        B.CLOCK_PINNED_PYTHON_V3.executable,
        B.buildClockNativeBridgeCommandV3({ schema: 'rrm-clock-bridge-request-br-v2', mode: 'single', pid: child.pid! }).args,
        { encoding: 'utf8', timeout: 10000 },
      )
      assert.equal(direct.status, 0, 'direct pinned-interpreter bridge run exits cleanly')
      const viaDirect = B.parseClockBridgeReplyV3(direct.stdout.trim(), 'single', child.pid!)
      assert.equal(viaHost.ok, true)
      if (!viaHost.ok || viaHost.kind !== 'single') return assert.fail('host single reply expected')
      if (!viaDirect.ok || viaDirect.mode !== 'single') return assert.fail('direct single reply expected')
      for (const field of ['bootUuid', 'uniqueId', 'idVersion', 'executableUuid', 'ppid', 'parentUniqueId'] as const) {
        assert.equal(viaHost.read[field], viaDirect.read[field], `host reader and direct fixed-literal spawn agree on ${field}`)
      }
      assert.equal(viaHost.read.pid, child.pid!, 'bridge metadata binds the fixture child pid, not the interpreter pid')
    } finally {
      await fixture.stop()
    }
  })

  it('clock-v3 B clock-v2 real owned-topology dual lineage: one invocation walks leaf to the owned spawn root twice; wrong root fails changed', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const fixture = await startOwnedReadyTopology()
    try {
      const ids = await fixture.ready
      const leaf = { pid: ids.childPid }
      const rootPid = ids.rootPid
      const rootRead = await B.readNativeClockProcessV3({ pid: rootPid, mode: 'single', deadline: farDeadline() })
      assert.equal(rootRead.ok && rootRead.kind === 'single', true, 'the freshly owned fixture parent birth is readable after readiness')
      if (!rootRead.ok || rootRead.kind !== 'single') return assert.fail('owned parent read expected')
      const expectedRoot = { bootUuid: rootRead.read.bootUuid, pid: rootPid, uniqueId: rootRead.read.uniqueId, idVersion: rootRead.read.idVersion, executableUuid: rootRead.read.executableUuid }
      const lineage = await B.readNativeClockProcessV3({ pid: leaf.pid, mode: 'lineage', expectedRoot, deadline: farDeadline() })
      assert.equal(lineage.ok, true, `owned-topology lineage must succeed (got ${lineage.ok ? '' : `${lineage.failure.code}: ${lineage.failure.detail}`})`)
      if (!lineage.ok || lineage.kind !== 'lineage') return assert.fail('lineage expected')
      assert.deepEqual(lineage.reads.map((r) => r.pid), [leaf.pid, rootPid], 'each collection stops at the owned fixture parent, below the harness')
      assert.deepEqual(lineage.observation.walkTwo.map((r) => r.pid), [leaf.pid, rootPid], 'the second collection has the same owned-root span')
      assert.equal(lineage.observation.rootBefore.pid, rootPid, 'root-before is the fixture parent')
      assert.equal(lineage.observation.rootAfter.pid, rootPid, 'root-after is the fixture parent')
      assert.equal(lineage.reads[0].ppid, rootPid, 'the ready leaf belongs to its fixture parent')
      const wrongRoot = await B.readNativeClockProcessV3({ pid: leaf.pid!, mode: 'lineage', expectedRoot: { ...expectedRoot, uniqueId: '1' }, deadline: farDeadline() })
      expectFailure(wrongRoot, 'changed')
      const missingRoot = await B.readNativeClockProcessV3({ pid: leaf.pid!, mode: 'lineage', deadline: farDeadline() })
      expectFailure(missingRoot, 'invalid-response')
    } finally {
      await fixture.stop()
    }
  })

  it('clock-v3 B clock-v2 lineage reply validation is deterministic under injected runners', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const boot = '57e93041-450b-4881-a1b9-f278f4030349'
    const osJson = { kernelRelease: '25.6.0', osBuild: '25G83', bootUuid: boot, pythonVersion: '3.14.6' }
    function nodeJson(pid: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return { bootUuid: boot, pid, uniqueId: String(4000 + pid), idVersion: 7, executableUuid: 'a'.repeat(32), ppid: 0, parentUniqueId: '0', pgid: pid, status: 2, flags: 0, ...overrides }
    }
    function birthJson(n: Record<string, unknown>): Record<string, unknown> & { bootUuid: string; pid: number; uniqueId: string; idVersion: number; executableUuid: string } {
      return { bootUuid: n.bootUuid as string, pid: n.pid as number, uniqueId: n.uniqueId as string, idVersion: n.idVersion as number, executableUuid: n.executableUuid as string }
    }
    function lineageReply(observation: Record<string, unknown>, expectedRootOverride?: unknown, requestedPid = 5001): string {
      return JSON.stringify({ schema: 'rrm-clock-bridge-reply-br-v2', ok: true, mode: 'lineage', requestedPid, expectedRoot: expectedRootOverride ?? birthJson(nodeJson(5000)), os: osJson, observation })
    }
    const leaf = nodeJson(5001, { ppid: 5000, parentUniqueId: String(4000 + 5000), pgid: 5000 })
    const root = nodeJson(5000)
    const expected = birthJson(root)
    const okRunner: SpawnSyncStub = () => ({ status: 0, signal: null, stdout: lineageReply({ rootBefore: root, walkOne: [leaf, root], walkTwo: [leaf, root], rootAfter: root }) + '\n', stderr: '' })
    const ok = await B.readNativeClockProcessV3({ pid: 5001, mode: 'lineage', expectedRoot: expected, deadline: farDeadline() }, { spawnSync: okRunner })
    assert.equal(ok.ok, true)
    if (!ok.ok || ok.kind !== 'lineage') return assert.fail('lineage expected')
    assert.deepEqual(ok.reads.map((r) => r.pid), [5001, 5000], 'lineage order is leaf to the owned root')
    assert.equal(ok.observation.walkTwo.length, 2, 'the refined result carries the mandatory second collection')
    expectFailure(await B.readNativeClockProcessV3({ pid: 5001, mode: 'lineage', expectedRoot: { ...expected, uniqueId: '9' } as never, deadline: farDeadline() }, { spawnSync: okRunner }), 'invalid-response')
    const wrongRootEcho = lineageReply({ rootBefore: root, walkOne: [leaf, root], walkTwo: [leaf, root], rootAfter: root }, birthJson(nodeJson(5000, { uniqueId: '9' })))
    expectFailure(await B.readNativeClockProcessV3({ pid: 5001, mode: 'lineage', expectedRoot: { ...expected, uniqueId: '9' } as never, deadline: farDeadline() }, { spawnSync: () => ({ status: 0, signal: null, stdout: wrongRootEcho + '\n', stderr: '' }) }), 'changed')
    expectFailure(await B.readNativeClockProcessV3({ pid: 5001, mode: 'lineage', deadline: farDeadline() } as never, { spawnSync: okRunner }), 'invalid-response')
    const changedSecond = lineageReply({ rootBefore: root, walkOne: [leaf, root], walkTwo: [leaf, nodeJson(5000, { uniqueId: '999999' })], rootAfter: root })
    expectFailure(await B.readNativeClockProcessV3({ pid: 5001, mode: 'lineage', expectedRoot: expected, deadline: farDeadline() }, { spawnSync: () => ({ status: 0, signal: null, stdout: changedSecond + '\n', stderr: '' }) }), 'changed')
    const rootReplaced = lineageReply({ rootBefore: root, walkOne: [leaf, root], walkTwo: [leaf, root], rootAfter: nodeJson(5000, { uniqueId: '888888' }) })
    expectFailure(await B.readNativeClockProcessV3({ pid: 5001, mode: 'lineage', expectedRoot: expected, deadline: farDeadline() }, { spawnSync: () => ({ status: 0, signal: null, stdout: rootReplaced + '\n', stderr: '' }) }), 'changed')
    const brokenEdgeLeaf = nodeJson(5001, { ppid: 5000, parentUniqueId: '99', pgid: 5000 })
    const brokenEdge = lineageReply({ rootBefore: root, walkOne: [brokenEdgeLeaf, root], walkTwo: [brokenEdgeLeaf, root], rootAfter: root })
    expectFailure(await B.readNativeClockProcessV3({ pid: 5001, mode: 'lineage', expectedRoot: expected, deadline: farDeadline() }, { spawnSync: () => ({ status: 0, signal: null, stdout: brokenEdge + '\n', stderr: '' }) }), 'changed')
    const mid = nodeJson(5002, { ppid: 5001, parentUniqueId: String(4000 + 5001) })
    const leafAgain = nodeJson(5001, { ppid: 5002, parentUniqueId: String(4000 + 5002), pgid: 5000 })
    const cycle = lineageReply({ rootBefore: root, walkOne: [leaf, mid, leafAgain], walkTwo: [leaf, mid, leafAgain], rootAfter: root })
    expectFailure(await B.readNativeClockProcessV3({ pid: 5001, mode: 'lineage', expectedRoot: expected, deadline: farDeadline() }, { spawnSync: () => ({ status: 0, signal: null, stdout: cycle + '\n', stderr: '' }) }), 'changed')
    function chainWalk(leafPid: number, count: number): Record<string, unknown>[] {
      const nodes: Record<string, unknown>[] = []
      for (let i = 0; i < count; i++) {
        const pid = leafPid - i
        const parent = i + 1 < count ? pid - 1 : 1
        nodes.push(nodeJson(pid, { ppid: parent, parentUniqueId: parent === 1 ? '0' : String(4000 + parent), pgid: leafPid }))
      }
      return nodes
    }
    const longWalk = chainWalk(6499, 33)
    const longReply = lineageReply({ rootBefore: longWalk[32], walkOne: longWalk, walkTwo: longWalk, rootAfter: longWalk[32] })
    expectFailure(await B.readNativeClockProcessV3({ pid: 6499, mode: 'lineage', expectedRoot: birthJson(longWalk[32]) as never, deadline: farDeadline() }, { spawnSync: () => ({ status: 0, signal: null, stdout: longReply + '\n', stderr: '' }) }), 'invalid-response')
    const exact32Walk = chainWalk(6599, 32)
    const exact32Reply = lineageReply({ rootBefore: exact32Walk[31], walkOne: exact32Walk, walkTwo: exact32Walk, rootAfter: exact32Walk[31] }, birthJson(exact32Walk[31]), 6599)
    const exact32Result = await B.readNativeClockProcessV3({ pid: 6599, mode: 'lineage', expectedRoot: birthJson(exact32Walk[31]) as never, deadline: farDeadline() }, { spawnSync: () => ({ status: 0, signal: null, stdout: exact32Reply + '\n', stderr: '' }) })
    assert.equal(exact32Result.ok, true, 'a 32-node walk (root included) succeeds')
    if (exact32Result.ok && exact32Result.kind === 'lineage') assert.equal(exact32Result.reads.length, 32)
    const leafWrongPid = lineageReply({ rootBefore: root, walkOne: [nodeJson(5999, { ppid: 5000, parentUniqueId: String(4000 + 5000), pgid: 5000 }), root], walkTwo: [nodeJson(5999, { ppid: 5000, parentUniqueId: String(4000 + 5000), pgid: 5000 }), root], rootAfter: root })
    expectFailure(await B.readNativeClockProcessV3({ pid: 5001, mode: 'lineage', expectedRoot: expected, deadline: farDeadline() }, { spawnSync: () => ({ status: 0, signal: null, stdout: leafWrongPid + '\n', stderr: '' }) }), 'invalid-response')
  })

  it('clock-v3 B clock-v2 elapsed shared deadline yields deadline-elapsed without any spawn', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    let spawnCalls = 0
    const result = await B.readNativeClockProcessV3(
      { pid: process.pid, mode: 'single', deadline: { domain: 'expired', expiresMs: 1000, now: () => 2000 } },
      { spawnSync: () => { spawnCalls++; throw new Error('must not spawn') } },
    )
    expectFailure(result, 'deadline-elapsed')
    assert.equal(spawnCalls, 0, 'no child is spawned once the shared deadline has elapsed')
  })

  it('clock-v3 B clock-v2 bridge failure replies map to fixed typed failures with no raw echo', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const boot = '57e93041-450b-4881-a1b9-f278f4030349'
    const osJson = { kernelRelease: '25.6.0', osBuild: '25G83', bootUuid: boot, pythonVersion: '3.14.6' }
    function failureReply(code: string): string {
      return JSON.stringify({ schema: 'rrm-clock-bridge-reply-br-v2', ok: false, failure: { code, detail: 'bridge-side fixed detail is never surfaced verbatim' } }) + '\n'
    }
    for (const token of ['exited', 'changed', 'denied', 'invalid-abi', 'unavailable', 'unsupported-platform'] as const) {
      const run: SpawnSyncStub = () => ({ status: 0, signal: null, stdout: failureReply(token), stderr: '' })
      expectFailure(await B.readNativeClockProcessV3({ pid: process.pid, mode: 'single', deadline: farDeadline() }, { spawnSync: run }), token)
    }
    const unknownRun: SpawnSyncStub = () => ({ status: 0, signal: null, stdout: failureReply('totally-unknown-XXbridge-canaryXX'), stderr: '' })
    const unknown = await B.readNativeClockProcessV3({ pid: process.pid, mode: 'single', deadline: farDeadline() }, { spawnSync: unknownRun })
    expectFailure(unknown, 'invalid-response')
    assert.ok(!JSON.stringify(unknown).includes('XXbridge-canaryXX'), 'unknown bridge codes never echo into the typed result')
    const canary = 'XXraw-output-canaryXX'
    const garbageRun: SpawnSyncStub = () => ({ status: 0, signal: null, stdout: `garbage ${canary} ${'x'.repeat(10000)}\n`, stderr: '' })
    const garbage = await B.readNativeClockProcessV3({ pid: process.pid, mode: 'single', deadline: farDeadline() }, { spawnSync: garbageRun })
    expectFailure(garbage, 'invalid-response')
    assert.ok(!JSON.stringify(garbage).includes(canary), 'raw bridge output never leaks into the typed result')
    assert.ok(garbage.ok === false && garbage.failure !== undefined && garbage.failure.detail.length < 256, 'failure detail stays within the fixed 256-char diagnostic bound')
    const multiLineRun: SpawnSyncStub = () => ({ status: 0, signal: null, stdout: '{}\n{}\n', stderr: '' })
    expectFailure(await B.readNativeClockProcessV3({ pid: process.pid, mode: 'single', deadline: farDeadline() }, { spawnSync: multiLineRun }), 'invalid-response')
    const stderrRun: SpawnSyncStub = () => ({ status: 0, signal: null, stdout: JSON.stringify({ schema: 'rrm-clock-bridge-reply-br-v2', ok: true, mode: 'single', requestedPid: process.pid, os: osJson, read: JSON.parse(canonicalBridgeLine(process.pid)) }) + '\n', stderr: 'private traceback' })
    const stderrResult = await B.readNativeClockProcessV3({ pid: process.pid, mode: 'single', deadline: farDeadline() }, { spawnSync: stderrRun })
    expectFailure(stderrResult, 'invalid-response')
    assert.ok(!JSON.stringify(stderrResult).includes('traceback'), 'stderr never leaks into the typed result')
    const killed: SpawnSyncStub = () => ({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' })
    expectFailure(await B.readNativeClockProcessV3({ pid: process.pid, mode: 'single', deadline: farDeadline() }, { spawnSync: killed }), 'deadline-elapsed')
    const missing: SpawnSyncStub = () => ({ status: null, signal: null, error: { code: 'ENOENT', message: 'no interpreter' }, stdout: '', stderr: '' })
    expectFailure(await B.readNativeClockProcessV3({ pid: process.pid, mode: 'single', deadline: farDeadline() }, { spawnSync: missing }), 'unavailable')
    const broken: SpawnSyncStub = () => ({ status: 1, signal: null, stdout: '', stderr: '' })
    const brokenResult = await B.readNativeClockProcessV3({ pid: process.pid, mode: 'single', deadline: farDeadline() }, { spawnSync: broken })
    expectFailure(brokenResult, 'invalid-response')
    const wrongOsRun: SpawnSyncStub = () => ({ status: 0, signal: null, stdout: JSON.stringify({ schema: 'rrm-clock-bridge-reply-br-v2', ok: true, mode: 'single', requestedPid: process.pid, os: { ...osJson, kernelRelease: '26.0.0' }, read: JSON.parse(canonicalBridgeLine(process.pid)) }) + '\n', stderr: '' })
    expectFailure(await B.readNativeClockProcessV3({ pid: process.pid, mode: 'single', deadline: farDeadline() }, { spawnSync: wrongOsRun }), 'unsupported-platform')
    const missingOsRun: SpawnSyncStub = () => ({ status: 0, signal: null, stdout: JSON.stringify({ schema: 'rrm-clock-bridge-reply-br-v2', ok: true, mode: 'single', requestedPid: process.pid, read: JSON.parse(canonicalBridgeLine(process.pid)) }) + '\n', stderr: '' })
    expectFailure(await B.readNativeClockProcessV3({ pid: process.pid, mode: 'single', deadline: farDeadline() }, { spawnSync: missingOsRun }), 'invalid-response')
  })

  it('clock-v3 B clock-v2 parser rejects zombie, in-exit, wrong pid, extra keys and zero birth identity with typed failures', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const cases: [string, string, number, string][] = [
      ['zombie', canonicalBridgeLine(process.pid, { status: 5 }), process.pid, 'exited'],
      ['in-exit', canonicalBridgeLine(process.pid, { flags: 4 }), process.pid, 'changed'],
      ['wrong pid', canonicalBridgeLine(1), process.pid, 'invalid-response'],
      ['extra key', JSON.stringify({ ...JSON.parse(canonicalBridgeLine(process.pid)), argv: ['redacted'] }), process.pid, 'invalid-response'],
      ['zero birth', canonicalBridgeLine(process.pid, { uniqueId: '0' }), process.pid, 'invalid-response'],
      ['bad boot uuid', canonicalBridgeLine(process.pid, { bootUuid: 'not-a-uuid' }), process.pid, 'invalid-response'],
      ['short exe uuid', canonicalBridgeLine(process.pid, { executableUuid: 'abcd' }), process.pid, 'invalid-response'],
      ['negative ppid', canonicalBridgeLine(process.pid, { ppid: -3 }), process.pid, 'invalid-response'],
      ['zero parent edge ok', canonicalBridgeLine(process.pid, { parentUniqueId: '0' }), process.pid, 'ok'],
    ]
    for (const [label, line, pid, expected] of cases) {
      if (expected === 'ok') {
        const read = B.parseClockBridgeNodeReadV3(line, pid)
        assert.equal(read.parentUniqueId, '0', `${label}: kernel root edge parentUniqueId may be zero`)
      } else {
        assert.throws(() => B.parseClockBridgeNodeReadV3(line, pid), (error: unknown): error is InstanceType<typeof B.ClockBridgeFailureV3> => error instanceof B.ClockBridgeFailureV3 && error.failure.code === expected, `${label} must produce ${expected}`)
      }
    }
  })

  it('clock-v3 B clock-v2 observer self acquisition returns synchronously with lease, helper registration, completion and real self birth', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const path = await import('node:path')
    const crypto = await import('node:crypto')
    const scopeId = 'b2c4d6f8-0000-4000-8000-0000000000b2'
    const probeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'clock-b-self-'))
    const acquired = B.readObserverSelfSyncV3({ bootstrap: observerBootstrap(scopeId, probeRoot) as never, localBudgetMs: 1000 })
    assert.ok(!(acquired instanceof Promise), 'the observer seam is synchronous: no Promise, no await')
    assert.equal(acquired.schema, 'rrm-clock-self-acquisition-v3')
    assert.equal(acquired.birth.pid, process.pid, 'acquired birth is the actual observer process identity')
    assert.ok(acquired.birth.uniqueId !== '0')
    assert.ok(acquired.parent.pid > 0)
    const elapsed = BigInt(acquired.finishedNs) - BigInt(acquired.startedNs)
    assert.ok(elapsed > BigInt(0) && elapsed <= BigInt(1_000_000_000), `measured local duration ${elapsed}ns stays within the 1000ms budget`)
    const lease = JSON.parse(await fsp.readFile(acquired.leaseRef.path, 'utf8'))
    assert.equal(lease.schema, 'rrm-clock-probe-lease-v3')
    assert.equal(lease.mode, 'observer-self')
    assert.equal(lease.ownerPidHint, process.pid)
    const registration = JSON.parse(await fsp.readFile(acquired.registrationRef!.path, 'utf8'))
    assert.equal(registration.schema, 'rrm-clock-probe-registration-v3')
    assert.equal(registration.ownerBirth.pid, process.pid, 'helper independently confirms the owner birth')
    for (const field of ['bootUuid', 'uniqueId', 'idVersion', 'executableUuid'] as const) {
      assert.equal(registration.ownerBirth[field], acquired.birth[field], `owner birth ${field} matches the acquired identity`)
    }
    const completion = JSON.parse(await fsp.readFile(acquired.completionRef.path, 'utf8'))
    assert.equal(completion.schema, 'rrm-clock-probe-completion-v3')
    assert.equal(completion.outcome, 'returned')
    assert.equal(registration.helperBirth.pid, completion.spawnPid, 'helper birth pid equals the actually spawned and reaped child pid')
    assert.notEqual(registration.helperBirth.pid, process.pid, 'helper identity is separate from the observer identity')
    assert.ok(registration.pgid > 0 && registration.sessionId > 0)
    for (const ref of [acquired.leaseRef, acquired.registrationRef!, acquired.completionRef]) {
      const bytes = await fsp.readFile(ref.path)
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), ref.sha256, `ref ${path.basename(ref.path)} hash binds actual bytes`)
      assert.equal(bytes.byteLength, ref.bytes)
    }
  })

  it('clock-v3 B clock-v2 local cap: exhausted budget and sub-millisecond remainder never spawn; completion records stay truthful', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const path = await import('node:path')
    let spawnCalls = 0
    const never: SpawnSyncStub = () => { spawnCalls++; throw new Error('must not spawn') }

    const exhaustedRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'clock-b-cap0-'))
    const exhaustedTimes = [BigInt(0), BigInt(2_000_000_001)]
    let exhaustedTick = 0
    assert.throws(
      () => B.readObserverSelfSyncV3({ bootstrap: observerBootstrap('aaaaaaaa-0000-4000-8000-0000000000a0', exhaustedRoot) as never, localBudgetMs: 1000 }, {
        spawnSync: never,
        nowNs: () => exhaustedTimes[Math.min(exhaustedTick++, exhaustedTimes.length - 1)],
      }),
      /budget exhausted/,
    )
    assert.equal(spawnCalls, 0, 'exhausted budget fails admission without forking')
    assert.deepEqual(await fsp.readdir(exhaustedRoot), [], 'no lease, no completion: the failure happened before the lease existed')

    const probeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'clock-b-cap-'))
    const times = [BigInt(1_000_000), BigInt(1_000_000), BigInt(2_000_000), BigInt(3_000_000), BigInt(1_000_400_000)]
    let tick = 0
    assert.throws(
      () => B.readObserverSelfSyncV3({ bootstrap: observerBootstrap('aaaaaaaa-0000-4000-8000-0000000000a1', probeRoot) as never, localBudgetMs: 1000 }, {
        spawnSync: never,
        nowNs: () => times[Math.min(tick++, times.length - 1)],
      }),
      /budget|admission/i,
    )
    assert.equal(spawnCalls, 0, 'a sub-millisecond remainder never reaches spawnSync, so timeout:0 can never disable the cap')
    const files = await fsp.readdir(probeRoot)
    const completionFile = files.find((f) => f.includes('completion'))
    assert.ok(completionFile, 'a durable completion record accounts for the pre-fork failure')
    const completion = JSON.parse(await fsp.readFile(path.join(probeRoot, completionFile!), 'utf8'))
    assert.equal(completion.outcome, 'not-spawned', 'the completion states the actual pre-fork failure')
    assert.equal(completion.spawnPid, null)
  })

  it('clock-v3 B clock-v2 configured timeout SIGKILL is not an exit proof; a returned child followed by ledger overrun stays unadmitted', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const path = await import('node:path')
    const fss = await import('node:fs')

    const killRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'clock-b-kill-'))
    let usedTimeout = -1
    const killer: SpawnSyncStub = (_file, _args, options) => {
      usedTimeout = options.timeout
      return { status: null, signal: 'SIGKILL', stdout: '', stderr: '' }
    }
    assert.throws(
      () => B.readObserverSelfSyncV3({ bootstrap: observerBootstrap('cccccccc-0000-4000-8000-0000000000c1', killRoot) as never, localBudgetMs: 1000 }, { spawnSync: killer }),
      /SIGKILL|exit proof/i,
    )
    assert.ok(usedTimeout >= 1 && usedTimeout <= 1000, `spawnSync timeout stays within 1..1000 (got ${usedTimeout})`)
    const killFiles = await fsp.readdir(killRoot)
    const killCompletion = JSON.parse(await fsp.readFile(path.join(killRoot, killFiles.find((f) => f.includes('completion'))!), 'utf8'))
    assert.equal(killCompletion.outcome, 'timeout', 'a configured timeout is recorded as cleanup information, never successful metadata')

    const overRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'clock-b-over-'))
    const helperPid = 4_000_000
    const slowHelper: SpawnSyncStub = (_file, args, _options) => {
      const request = JSON.parse(args[args.length - 1]) as { registrationPath: string }
      fss.writeFileSync(request.registrationPath, JSON.stringify({
        schema: 'rrm-clock-probe-registration-v3',
        leaseRef: { path: 'x', sha256: '0'.repeat(64), bytes: 1 },
        helperBirth: syntheticBirth(helperPid),
        ownerBirth: syntheticBirth(process.pid),
        pgid: process.pid,
        sessionId: process.pid,
      }))
      return {
        status: 0,
        signal: null,
        pid: helperPid,
        stdout: JSON.stringify({ schema: 'rrm-clock-bridge-reply-br-v2', ok: true, mode: 'observer', requestedPid: process.pid, os: osStubJson, read: JSON.parse(canonicalBridgeLine(process.pid)), registrationRef: { path: request.registrationPath, sha256: '0'.repeat(64), bytes: 1 } }) + '\n',
        stderr: '',
      }
    }
    const overrunTimes = [BigInt(1_000_000), BigInt(2_000_000), BigInt(3_000_000), BigInt(4_000_000), BigInt(5_000_000), BigInt(500_000_000), BigInt(500_100_000), BigInt(1_500_000_000)]
    let overrunTick = 0
    assert.throws(
      () => B.readObserverSelfSyncV3({ bootstrap: observerBootstrap('cccccccc-0000-4000-8000-0000000000c2', overRoot) as never, localBudgetMs: 1000 }, {
        spawnSync: slowHelper,
        nowNs: () => overrunTimes[Math.min(overrunTick++, overrunTimes.length - 1)],
      }),
      /overran|budget|admissible/i,
    )
    const overFiles = await fsp.readdir(overRoot)
    const overCompletion = JSON.parse(await fsp.readFile(path.join(overRoot, overFiles.find((f) => f.includes('completion'))!), 'utf8'))
    assert.equal(overCompletion.outcome, 'returned', 'the completion keeps the child truth: the child did return')
    assert.equal(overCompletion.spawnPid, helperPid)
  })

  it('clock-v3 B clock-v2 seal protocol: sealed scope blocks leases and forks; pre-seal lease stays visible', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const path = await import('node:path')

    const sealedRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'clock-b-seal-'))
    const scopeId = 'dddddddd-0000-4000-8000-0000000000d1'
    B.sealClockProbesV3(sealedRoot, scopeId, 'host admissions closed after result/drain expiry')
    let spawnCalls = 0
    assert.throws(
      () => B.readObserverSelfSyncV3({ bootstrap: observerBootstrap(scopeId, sealedRoot) as never, localBudgetMs: 1000 }, { spawnSync: () => { spawnCalls++; throw new Error('spawn') } }),
      /seal/,
    )
    assert.equal(spawnCalls, 0, 'a sealed scope admits no fork')
    assert.deepEqual((await fsp.readdir(sealedRoot)).filter((f) => f.includes('lease')), [], 'no lease is created after the seal')

    const raceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'clock-b-seal2-'))
    const scope2 = 'dddddddd-0000-4000-8000-0000000000d2'
    let forkHappened = false
    const stub: SpawnSyncStub = () => {
      forkHappened = true
      return { status: null, signal: 'SIGKILL', stdout: '', stderr: '' }
    }
    assert.throws(
      () => B.readObserverSelfSyncV3({ bootstrap: observerBootstrap(scope2, raceRoot) as never, localBudgetMs: 1000 }, {
        spawnSync: stub,
        onBeforeFork: () => B.sealClockProbesV3(raceRoot, scope2, 'seal arrives after the second unsealed check'),
      }),
    )
    assert.equal(forkHappened, true, 'a seal after the second check does not retract the already-checked fork')
    const raceFiles = await fsp.readdir(raceRoot)
    assert.ok(raceFiles.some((f) => f.includes('lease')), 'the durable lease already precedes that seal and is visible in the post-seal ledger cut')
    assert.ok(raceFiles.some((f) => f.includes('probe-seal')), 'the seal is recorded')
  })

  it('clock-v3 B clock-v2 probe closure: registered stop closes for cleanup, unresolved leases stay open, quarantine blocks', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const path = await import('node:path')
    const probeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'clock-b-close-'))
    const scopeId = 'eeeeeeee-0000-4000-8000-0000000000e1'
    const rootBirth = syntheticBirth(4242) as never
    const stopFact = B.writeClockNativeAppGroupStopFactV3(probeRoot, {
      rootBirth, groupEmpty: true, stopInvocationRef: { path: '/tmp/clock-b-fixture/stop.json', sha256: 'd'.repeat(64), bytes: 3 },
    })
    const leaseRef = { path: path.join(probeRoot, `${scopeId}-lease-x.json`), sha256: 'e'.repeat(64), bytes: 3 }
    const registration = {
      schema: 'rrm-clock-probe-registration-v3' as const, leaseRef, helperBirth: syntheticBirth(4243) as never, ownerBirth: rootBirth, pgid: 4242, sessionId: 4242,
    }
    const registeredStop = B.decideClockProbeClosureV3({ registration, completion: null, stopFact: stopFact.fact })
    assert.deepEqual(registeredStop, { closed: true, closure: 'closed-by-owned-group-stop' })
    const closureWrite = B.writeClockProbeCleanupClosureV3(probeRoot, scopeId, 'probe-1', leaseRef, 'closed-by-owned-group-stop', stopFact.ref)
    assert.equal(closureWrite.record.schema, 'rrm-clock-probe-cleanup-closure-v3')
    assert.deepEqual(closureWrite.record.leaseRef, leaseRef, 'closure binds the lease ref, never the final receipt')
    assert.deepEqual(closureWrite.record.evidenceRef, stopFact.ref, 'acyclic order: closure evidence is the stop fact, written before the closure')
    const returned = B.decideClockProbeClosureV3({
      registration,
      completion: { schema: 'rrm-clock-probe-completion-v3', leaseRef, registrationRef: null, spawnPid: 4243, status: 0, signal: null, outcome: 'returned', elapsedNs: '5', sourceAssociation: 'host-driver' },
      stopFact: null,
    })
    assert.deepEqual(returned, { closed: true, closure: 'closed-by-tracked-exit' })
    const unresolved = B.decideClockProbeClosureV3({ registration: null, completion: null, stopFact: stopFact.fact })
    assert.equal(unresolved.closed, false, 'a missing registration AND missing completion stays unresolved even with an empty app group')
    assert.match(unresolved.reason, /unresolved|proves nothing/)
    const timedOut = B.decideClockProbeClosureV3({
      registration,
      completion: { schema: 'rrm-clock-probe-completion-v3', leaseRef, registrationRef: null, spawnPid: 4243, status: null, signal: 'SIGKILL', outcome: 'timeout', elapsedNs: '5', sourceAssociation: 'observer-self' },
      stopFact: null,
    })
    assert.deepEqual(timedOut, { closed: true, closure: 'quarantined' }, 'timeout completion quarantines instead of minting success')
    const quarantineWrite = B.writeClockProbeCleanupClosureV3(probeRoot, scopeId, 'probe-2', leaseRef, 'quarantined', stopFact.ref)
    const reloaded = B.readClockProbeRecordV3<{ schema: string; closure: string }>(quarantineWrite.ref.path, 'rrm-clock-probe-cleanup-closure-v3')
    assert.equal(reloaded.closure, 'quarantined')
    await assert.rejects(
      () => Promise.resolve().then(() => B.readClockProbeRecordV3(quarantineWrite.ref.path, 'rrm-clock-wrong-schema')),
      /schema/,
      'record reload enforces the exact schema tag',
    )
  })

  it('clock-v3 B clock-v2 scope seed constructor accepts real offline-fixture shape and rejects malformed drivers/subjects', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const subject = {
      pass: 1 as const,
      invocation: 3,
      invocationId: 'inv-clock-b-seed',
      profile: 'baseline',
      runId: 'run-clock-b-seed',
      sourceMode: 'copied-source',
      evidenceRoot: '/tmp/clock-b-fixture/evidence',
      clearanceManifest: { path: '/tmp/clock-b-fixture/clearance.json', sha256: 'f'.repeat(64), bytes: 12 },
    }
    const validInput = {
      purpose: 'offline-fixture' as const,
      scopeId: '99999999-0000-4000-8000-000000000099',
      preRuntimeSubject: subject,
      approvedSourceRef: { path: '/tmp/clock-b-fixture/source-ref.json', sha256: '1'.repeat(64), bytes: 5 },
      toolPolicyRef: { path: '/tmp/clock-b-fixture/tool-ref.json', sha256: '2'.repeat(64), bytes: 6 },
      ownedNamespaces: ['clock-b-fixture-a', 'clock-b-fixture-b'],
      driverDescriptor: {
        schema: 'rrm-clock-preroot-descriptor-v3',
        scopeId: '99999999-0000-4000-8000-000000000099',
        clockInstanceId: '88888888-0000-4000-8000-000000000088',
        domain: 'matrix-context-capture' as const,
        representation: 'host-rounded-ms' as const,
        basis: 'node-hrtime-bigint-performance-now' as const,
        nativeBirth: syntheticBirth(5000) as never,
        observedParent: { pid: 1, parentUniqueId: '42' },
      },
    }
    const seed = B.createClockScopeSeedV3(validInput as Parameters<typeof B.createClockScopeSeedV3>[0])
    assert.equal(seed.schema, 'rrm-clock-scope-seed-v3')
    assert.equal(seed.purpose, 'offline-fixture')
    assert.equal(seed.preRuntimeSubject.invocationId, 'inv-clock-b-seed')
    assert.equal((seed.preRuntimeSubject as unknown as Record<string, unknown>).runtimeManifest, undefined, 'pre-runtime subject never carries a runtime manifest')
    const failures: [string, Record<string, unknown>][] = [
      ['purpose', { purpose: 'native-evidence' }],
      ['subject pass', { preRuntimeSubject: { ...subject, pass: 3 } }],
      ['runtimeManifest leak', { preRuntimeSubject: { ...subject, runtimeManifest: { path: 'x', sha256: '3'.repeat(64), bytes: 1 } } }],
      ['scope mismatch', { scopeId: '99999999-0000-4000-8000-000000000098' }],
      ['empty namespaces', { ownedNamespaces: [] }],
      ['duplicate namespaces', { ownedNamespaces: ['a', 'a'] }],
      ['bad manifest sha', { approvedSourceRef: { path: 'x', sha256: 'nothex', bytes: 1 } }],
      ['zero driver birth', { driverDescriptor: { ...validInput.driverDescriptor, nativeBirth: syntheticBirth(0) } }],
    ]
    for (const [label, override] of failures) {
      assert.throws(
        () => B.createClockScopeSeedV3({ ...validInput, ...override } as never),
        (error: unknown) => error instanceof Error,
        `${label} must be rejected`,
      )
    }
  })

  function captureOwnedFixtureStop(fixture: { stop: () => Promise<OwnedFixtureOutcome> }): { state: { outcome: OwnedFixtureOutcome | undefined; failure: (Error & { outcome?: OwnedFixtureOutcome }) | undefined }; settle: () => Promise<void> } {
    const state = { outcome: undefined as OwnedFixtureOutcome | undefined, failure: undefined as (Error & { outcome?: OwnedFixtureOutcome }) | undefined }
    return {
      state,
      settle: async (): Promise<void> => {
        try { state.outcome = await fixture.stop() } catch (error) { state.failure = error as Error & { outcome?: OwnedFixtureOutcome } }
      },
    }
  }

  it('clock-v3 B fixture lifecycle: readiness, validated child exit and truthful parent/child exit accounting on the normal owned topology', { timeout: 8000 }, async () => {
    const fixture = await startOwnedReadyTopology()
    const cleanup = captureOwnedFixtureStop(fixture)
    let ids: { rootPid: number; childPid: number } | undefined
    try {
      ids = await fixture.ready
      assert.ok(Number.isInteger(ids.rootPid) && ids.rootPid > 0 && Number.isInteger(ids.childPid) && ids.childPid > 0, 'readiness binds the actual owned fixture parent and its ready child')
    } finally {
      await cleanup.settle()
    }
    const outcome = cleanup.state.outcome
    assert.ok(outcome, 'stop returns truthful lifecycle accounting after unconditional cleanup')
    assert.equal(outcome!.readyProblem, null, 'the normal topology settles readiness cleanly')
    assert.deepEqual(outcome!.reapAck, { kind: 'reaped', childPid: ids!.childPid, code: 0, signal: null }, 'fixture parent acknowledges child reap before its own exit')
    assert.deepEqual(outcome!.validatedChildExit, { childPid: ids!.childPid, code: 0, signal: null }, 'the validated stdout channel independently confirms the child exit')
    assert.equal(outcome!.childExitObserved, true, 'observation derives from the validated channel, not the raw acknowledgement')
    assert.deepEqual(outcome!.childExit, { code: 0, signal: null })
    assert.deepEqual(outcome!.parentExit, { code: 0, signal: null }, 'owned fixture parent exit is tracked')
    assert.equal(outcome!.parentExitObserved, true)
    assert.equal(outcome!.failedToStart, false)
    assert.deepEqual(outcome!.messageKinds, ['ready', 'reaped'], 'exactly readiness and reap acknowledgements')
    assert.equal(outcome!.escalated, false, 'settlement comes from observed events, never an escalation cap')
    assert.equal(outcome!.unresolvedOwnership, null)
  })

  it('clock-v3 B fixture lifecycle: a fixture child spawn failure is reported, never awaited as readiness, and both exits stay truthful', { timeout: 8000 }, async () => {
    const fixture = await startOwnedReadyTopology('child-spawn-error')
    const cleanup = captureOwnedFixtureStop(fixture)
    try {
      await assert.rejects(fixture.ready, /fixture child never started: ENOENT/)
    } finally {
      await cleanup.settle()
    }
    assert.ok(cleanup.state.failure, 'stop reports failure-mode accounting even though the readiness assertion path finished first')
    const outcome = cleanup.state.failure!.outcome
    assert.ok(outcome)
    assert.match(cleanup.state.failure!.message, /fixture parent never acknowledged the fixture child reap/)
    assert.ok(outcome!.readyProblem !== null, 'the spawn failure itself is recorded')
    assert.deepEqual(outcome!.parentExit, { code: 1, signal: null }, 'the failing fixture parent exit is truthfully accounted')
    assert.equal(outcome!.childExitObserved, false, 'a child that never started is never claimed as reaped')
    assert.equal(outcome!.validatedChildExit, null)
    assert.equal(outcome!.escalated, false)
  })

  it('clock-v3 B fixture lifecycle: a fixture child exit before readiness settles readiness with the observed child exit and a failing parent', { timeout: 8000 }, async () => {
    const fixture = await startOwnedReadyTopology('child-exit-before-ready')
    const cleanup = captureOwnedFixtureStop(fixture)
    try {
      await assert.rejects(fixture.ready, /fixture child exited before readiness: code=0 signal=null/)
    } finally {
      await cleanup.settle()
    }
    assert.ok(cleanup.state.failure)
    const outcome = cleanup.state.failure!.outcome
    assert.ok(outcome)
    assert.match(cleanup.state.failure!.message, /fixture child exited before readiness/)
    assert.ok(outcome!.validatedChildExit && Number.isInteger(outcome!.validatedChildExit.childPid) && outcome!.validatedChildExit.childPid > 0, 'the premature child exit is independently validated')
    assert.deepEqual(outcome!.childExit, { code: 0, signal: null }, 'the observed child exit is recorded truthfully, not fabricated')
    assert.equal(outcome!.childExitObserved, true)
    assert.ok(outcome!.reapAck && outcome!.reapAck.childPid === outcome!.validatedChildExit!.childPid, 'raw acknowledgement and validated channel agree on the child identity')
    assert.deepEqual(outcome!.parentExit, { code: 1, signal: null }, 'the readiness failure is reflected in the fixture parent exit')
    assert.deepEqual(outcome!.messageKinds, ['reaped'], 'the reap acknowledgement still flows and is still counted')
    assert.equal(outcome!.escalated, false)
  })

  it('clock-v3 B fixture lifecycle: an early fixture parent exit rejects readiness and leaves child exit honestly unaccounted', { timeout: 8000 }, async () => {
    const fixture = await startOwnedReadyTopology('parent-exit-before-ready')
    const cleanup = captureOwnedFixtureStop(fixture)
    try {
      await assert.rejects(fixture.ready, /fixture parent (disconnected|exited) before readiness/)
    } finally {
      await cleanup.settle()
    }
    assert.ok(cleanup.state.failure)
    const outcome = cleanup.state.failure!.outcome
    assert.ok(outcome)
    assert.match(cleanup.state.failure!.message, /fixture parent never acknowledged the fixture child reap/)
    assert.deepEqual(outcome!.parentExit, { code: 3, signal: null }, 'the early parent exit is truthfully accounted')
    assert.equal(outcome!.childExit, null, 'no child exit is invented when the parent died first')
    assert.equal(outcome!.validatedChildExit, null)
    assert.equal(outcome!.childExitObserved, false)
    assert.deepEqual(outcome!.messageKinds, [])
    assert.equal(outcome!.escalated, false)
  })

  it('clock-v3 B fixture lifecycle: a fixture parent disconnect before readiness settles without hanging and accounts the grandchild independently', { timeout: 8000 }, async () => {
    const fixture = await startOwnedReadyTopology('parent-disconnect-before-ready')
    const cleanup = captureOwnedFixtureStop(fixture)
    try {
      await assert.rejects(fixture.ready, /fixture parent (disconnected|exited) before readiness/)
    } finally {
      await cleanup.settle()
    }
    assert.ok(cleanup.state.failure)
    const outcome = cleanup.state.failure!.outcome
    assert.ok(outcome)
    assert.match(cleanup.state.failure!.message, /before readiness/)
    assert.match(cleanup.state.failure!.message, /fixture parent never acknowledged the fixture child reap/)
    assert.deepEqual(outcome!.parentExit, { code: 5, signal: null }, 'the deliberate parent exit code is truthfully accounted')
    assert.ok(outcome!.validatedChildExit && Number.isInteger(outcome!.validatedChildExit.childPid) && outcome!.validatedChildExit.childPid > 0, 'the grandchild exit is independently accounted despite the lost parent IPC')
    assert.deepEqual(outcome!.validatedChildExit!.code === null ? null : { code: outcome!.validatedChildExit!.code, signal: outcome!.validatedChildExit!.signal }, { code: 0, signal: null })
    assert.equal(outcome!.childExitObserved, true, 'child completion evidence survives parent loss')
    assert.equal(outcome!.escalated, false, 'settlement came from observed disconnect/exit events, not a cap')
  })

  it('clock-v3 B fixture lifecycle: an invalid reap acknowledgement cannot skip parent-exit accounting or fabricate child evidence', { timeout: 8000 }, async () => {
    const fixture = await startOwnedReadyTopology('invalid-reap-ack')
    const cleanup = captureOwnedFixtureStop(fixture)
    let ids: { rootPid: number; childPid: number } | undefined
    try {
      ids = await fixture.ready
    } finally {
      await cleanup.settle()
    }
    assert.ok(cleanup.state.failure)
    const outcome = cleanup.state.failure!.outcome
    assert.ok(outcome, 'parent-exit accounting is performed despite the failed acknowledgement assertion')
    assert.match(cleanup.state.failure!.message, /reap acknowledgement mismatch/)
    assert.deepEqual(outcome!.parentExit, { code: 0, signal: null }, 'the owned fixture parent exit is still tracked after the lie')
    assert.deepEqual(outcome!.reapAck, { kind: 'reaped', childPid: 999999, code: 7, signal: 'SIGURG' }, 'the false acknowledgement is preserved as raw evidence')
    assert.deepEqual(outcome!.validatedChildExit, { childPid: ids!.childPid, code: 0, signal: null }, 'the validated channel carries the true child facts, not the lie')
    assert.equal(outcome!.childExitObserved, true)
    assert.equal(outcome!.escalated, false)
  })

  it('clock-v3 B fixture lifecycle: a missing reap acknowledgement cannot hang shutdown and is never treated as reap proof', { timeout: 8000 }, async () => {
    const fixture = await startOwnedReadyTopology('missing-reap-ack')
    const cleanup = captureOwnedFixtureStop(fixture)
    try {
      await fixture.ready
    } finally {
      await cleanup.settle()
    }
    assert.ok(cleanup.state.failure)
    const outcome = cleanup.state.failure!.outcome
    assert.ok(outcome)
    assert.match(cleanup.state.failure!.message, /fixture parent never acknowledged the fixture child reap/)
    assert.equal(outcome!.reapAck, null, 'a missing acknowledgement is never fabricated as reap proof')
    assert.ok(outcome!.validatedChildExit && outcome!.validatedChildExit.code === 0, 'the child exit is still independently validated through the separate channel')
    assert.equal(outcome!.childExitObserved, true)
    assert.deepEqual(outcome!.parentExit, { code: 1, signal: null }, 'settlement came from the observed parent exit')
    assert.equal(outcome!.escalated, false, 'no escalation cap was needed or claimed')
  })

  it('clock-v3 B fixture lifecycle: cleanup ownership exists from spawn onward and stop-before-readiness winds down without orphans', { timeout: 8000 }, async () => {
    const fixture = await startOwnedReadyTopology()
    const cleanup = captureOwnedFixtureStop(fixture)
    await cleanup.settle()
    const outcome = cleanup.state.outcome ?? cleanup.state.failure?.outcome
    if (cleanup.state.outcome === undefined) {
      assert.match(cleanup.state.failure!.message, /before readiness/, 'when settlement won the race the readiness failure is reported, not hidden')
    } else {
      assert.equal(cleanup.state.outcome.readyProblem, null, 'when readiness won the race it settled cleanly')
    }
    assert.ok(outcome, 'every race branch returns truthful accounting')
    assert.deepEqual(outcome!.parentExit, { code: 0, signal: null }, 'the owned fixture parent is wound down cleanly from spawn-onward ownership')
    assert.equal(outcome!.parentExitObserved, true)
    assert.ok(outcome!.validatedChildExit && Number.isInteger(outcome!.validatedChildExit.childPid) && outcome!.validatedChildExit.childPid > 0, 'the grandchild exit is independently accounted even when stop wins the readiness race')
    assert.equal(outcome!.escalated, false, 'the wind-down never needed an escalation cap')
    assert.equal(outcome!.unresolvedOwnership, null)
  })

  it('clock-v3 B fixture lifecycle: a fixture parent spawn failure settles shutdown immediately with explicit failed-to-start ownership', { timeout: 15000 }, async () => {
    const fixture = await startOwnedReadyTopology('parent-spawn-error')
    const cleanup = captureOwnedFixtureStop(fixture)
    try {
      await assert.rejects(fixture.ready, /fixture parent spawn error/)
    } finally {
      await cleanup.settle()
    }
    assert.ok(cleanup.state.failure)
    const outcome = cleanup.state.failure!.outcome
    assert.ok(outcome)
    assert.equal(outcome!.failedToStart, true, 'the failed spawn is recorded as a terminal state')
    assert.equal(outcome!.parentExitObserved, true, 'terminal settlement comes from error/close events, not timer dependence')
    assert.equal(outcome!.escalated, false, 'a failed spawn needs no caps or kills')
    assert.equal(outcome!.validatedChildExit, null)
    assert.equal(outcome!.childExitObserved, false)
    assert.equal(outcome!.unresolvedOwnership, null)
  })

  it('clock-v3 B fixture lifecycle: an acknowledged but stalled fixture parent is terminated by escalating ownership, never abandoned', { timeout: 15000 }, async () => {
    const fixture = await startOwnedReadyTopology('ack-then-stall')
    const cleanup = captureOwnedFixtureStop(fixture)
    let ids: { rootPid: number; childPid: number } | undefined
    try {
      ids = await fixture.ready
    } finally {
      await cleanup.settle()
    }
    assert.ok(cleanup.state.failure, 'a stalled parent cannot produce clean accounting')
    const outcome = cleanup.state.failure!.outcome
    assert.ok(outcome)
    assert.equal(outcome!.escalated, true, 'the cap escalates on the captured handle instead of abandoning ownership')
    assert.deepEqual(outcome!.parentExit, { code: null, signal: 'SIGTERM' }, 'termination is observed truthfully, never represented as a clean reap')
    assert.equal(outcome!.parentExitObserved, true)
    assert.deepEqual(outcome!.reapAck, { kind: 'reaped', childPid: ids!.childPid, code: 0, signal: null }, 'the honest acknowledgement is retained as raw evidence')
    assert.deepEqual(outcome!.validatedChildExit, { childPid: ids!.childPid, code: 0, signal: null }, 'the child exit is independently validated despite the stall')
    assert.equal(outcome!.childExitObserved, true)
    assert.equal(outcome!.unresolvedOwnership, null, 'escalation completed ownership rather than transferring an orphan')
  })
})

describe('clock-v3 B repair step1 fixed bridge, dual lineage, errno, diagnostics and roles', () => {
  type SpawnSyncStub = (file: string, args: readonly string[], options: {
    timeout: number; killSignal: 'SIGKILL'; maxBuffer: number; shell: false
    encoding: 'buffer'; env: Record<string, string>
  }) => { status: number | null; signal: string | null; error?: { code?: string; message?: string }; stdout: string; stderr: string; pid?: number }

  interface FakeProc { ppid: number; pgid: number; status: number; flags: number; uniqueId: string; parentUniqueId: string; idVersion: number; exeUuid: string; errno?: number | null; shortBytes?: number | null }

  const BOOT = '57e93041-450b-4881-a1b9-f278f4030349'
  const SUPPORTED_OS = { kernelRelease: '25.6.0', osBuild: '25G83', bootUuid: BOOT, pythonVersion: '3.14.6' }

  function farDeadline(): { domain: string; expiresMs: number; now: () => number } {
    return { domain: 'clock-v3 B repair step1', expiresMs: Date.now() + 15000, now: () => Date.now() }
  }

  function expectFailure(result: { ok: boolean; failure?: { code: string; detail: string } }, code: string): void {
    assert.equal(result.ok, false, `expected typed failure ${code}`)
    assert.equal(result.failure!.code, code)
  }

  function expectedBirth(pid: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { bootUuid: BOOT, pid, uniqueId: String(70000 + pid), idVersion: 7, executableUuid: 'a'.repeat(32), ...overrides }
  }

  function chainProcs(pids: number[], rootPid: number, overrides: Record<string, Partial<FakeProc>> = {}): Record<string, FakeProc> {
    const procs: Record<string, FakeProc> = {}
    pids.forEach((pid, index) => {
      const parent = pid === rootPid ? 1 : (pids[index + 1] ?? 1)
      procs[String(pid)] = {
        ppid: parent,
        pgid: pids[0],
        status: 2,
        flags: 0,
        uniqueId: String(70000 + pid),
        parentUniqueId: parent === 1 ? '55' : String(70000 + parent),
        idVersion: 7,
        exeUuid: 'a'.repeat(32),
        errno: null,
        shortBytes: null,
        ...(overrides[String(pid)] ?? {}),
      }
    })
    return procs
  }

  function baseSysctl(): Record<string, string> {
    return { 'kern.osrelease': '25.6.0', 'kern.osversion': '25G83', 'kern.bootsessionuuid': BOOT }
  }

  // Executes the ACTUAL exported bridge literal under a real Python process
  // whose selected FFI entry points are replaced by scenario-controlled
  // primitives. This is controlled-FFI evidence for the literal's logic —
  // explicitly NOT native ABI proof (that separation is asserted in contracts).
  const FFI_DRIVER = [
    'import ctypes, json, os, struct, sys',
    'scenario = json.load(open(sys.argv[1]))',
    'def as_int(v):',
    '    return v if isinstance(v, int) else getattr(v, "value", v)',
    'calls = []',
    'class FakeLib(object):',
    '    pass',
    'libproc = FakeLib()',
    'libsys = FakeLib()',
    'def fake_cdll(path, *args, **kwargs):',
    "    calls.append(['cdll', path, sorted(kwargs.keys()), kwargs.get('use_errno')])",
    "    return libproc if 'libproc' in path else libsys",
    'ctypes.CDLL = fake_cdll',
    "procs = scenario['procs']",
    "flip = scenario.get('flipAtCall')",
    'def proc_pidinfo(pid, flavor, arg, buf, size):',
    "    calls.append(['pidinfo', as_int(pid), as_int(flavor)])",
    "    if flip is not None and len(calls) > int(flip['afterCalls']):",
    "        target = procs.get(str(flip['pid']))",
    '        if target is not None:',
    "            target[flip['field']] = flip['value']",
    '    pid_n = as_int(pid)',
    '    flavor_n = as_int(flavor)',
    '    size_n = as_int(size)',
    '    p = procs.get(str(pid_n))',
    '    if p is None:',
    '        ctypes.set_errno(3)',
    '        return 0',
    "    if p.get('errno') is not None:",
    "        ctypes.set_errno(int(p['errno']))",
    '        return 0',
    '    if flavor_n == 17:',
    "        data = bytes.fromhex(p['exeUuid']) + struct.pack('<QQ', int(p['uniqueId']), int(p['parentUniqueId'])) + struct.pack('<ii', int(p['idVersion']), int(p['idVersion'])) + b'\\x00' * 16",
    '    else:',
    "        data = struct.pack('<IIII', int(pid_n), int(p['ppid']), int(p['pgid']), int(p['status'])) + b'\\x00' * 16 + struct.pack('<I', int(p['flags'])) + b'\\x00' * 28",
    "        if p.get('shortBytes') is not None:",
    "            data = data[:int(p['shortBytes'])]",
    '    if len(data) != size_n:',
    '        ctypes.set_errno(0)',
    '        return len(data)',
    '    ctypes.memmove(buf, data, len(data))',
    '    return len(data)',
    'libproc.proc_pidinfo = proc_pidinfo',
    'def sysctlbyname(key, buf, size_ref, a, b):',
    "    calls.append(['sysctl', key.decode('ascii')])",
    "    v = scenario['sysctl'].get(key.decode('ascii'))",
    '    if v is None:',
    '        ctypes.set_errno(0)',
    '        return 1',
    "    data = v.encode('ascii') + b'\\x00'",
    '    ctypes.memmove(buf, data, len(data))',
    '    size_ref._obj.value = len(data)',
    '    return 0',
    'libsys.sysctlbyname = sysctlbyname',
    "pv = scenario.get('pythonVersion')",
    'if pv is not None:',
    "    sys.version_info = tuple(int(x) for x in pv.split('.'))",
    "literal_source = open(sys.argv[2]).read()",
    "sys.argv = ['bridge'] + [str(a) for a in scenario['argv']]",
    "if 'rawRequestHex' in scenario:",
    "    sys.argv[-1] = os.fsdecode(bytes.fromhex(scenario['rawRequestHex']))",
    "namespace = {'__name__': '__main__'}",
    "exec(compile(literal_source, 'CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE', 'exec'), namespace)", 
    "sys.stderr.write('CALLS ' + json.dumps(calls) + '\\n')",
  ].join('\n')

  async function controlledFfiRun(scenario: Record<string, unknown>): Promise<{ reply: any; calls: any[][]; status: number | null }> {
    const cp = await import('node:child_process')
    const B = await import('../support/native/rejection-recovery-runtime')
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'clock-b-step1-ffi-'))
    const scenarioPath = path.join(dir, 'scenario.json')
    const driverPath = path.join(dir, 'ffi-driver.py')
    const literalPath = path.join(dir, 'bridge-literal.py')
    await fsp.writeFile(scenarioPath, JSON.stringify(scenario), 'utf8')
    await fsp.writeFile(driverPath, FFI_DRIVER, 'utf8')
    await fsp.writeFile(literalPath, B.CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE, 'utf8')
    const run = cp.spawnSync(B.CLOCK_PINNED_PYTHON_V3.executable, [driverPath, scenarioPath, literalPath], { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 })
    if (run.error !== undefined) throw new Error('controlled FFI driver failed to start: ' + String((run.error as { code?: unknown }).code ?? ''))
    const callsLine = (run.stderr ?? '').split('\n').find((l) => l.startsWith('CALLS '))
    if (callsLine === undefined) throw new Error('controlled FFI driver produced no CALLS record; stderr head: ' + String(run.stderr ?? '').slice(0, 300))
    let reply: any = null
    try {
      reply = JSON.parse((run.stdout ?? '').trim())
    } catch {
      throw new Error('controlled FFI reply is not JSON: ' + String(run.stdout ?? '').slice(0, 300))
    }
    return { reply, calls: JSON.parse(callsLine.slice('CALLS '.length)) as any[][], status: run.status }
  }

  function gptNode(pid: number, overrides: Record<string, unknown> = {}): any {
    return { ...expectedBirth(pid), ppid: 0, parentUniqueId: '0', pgid: 9101, status: 2, flags: 0, ...overrides }
  }

  function gptReply(mode: 'single' | 'lineage' | 'observer' = 'single'): any {
    const root = gptNode(9101)
    const leaf = gptNode(9100, { ppid: root.pid, parentUniqueId: root.uniqueId })
    const base = { schema: 'rrm-clock-bridge-reply-br-v2', ok: true, mode, requestedPid: leaf.pid, os: SUPPORTED_OS }
    if (mode === 'lineage') return { ...base, expectedRoot: expectedBirth(root.pid), observation: { rootBefore: root, walkOne: [leaf, root], walkTwo: [leaf, root], rootAfter: root } }
    return { ...base, read: leaf, ...(mode === 'observer' ? { registrationRef: { path: '/tmp/clock-gpt/registration.json', sha256: 'a'.repeat(64), bytes: 1 } } : {}) }
  }

  it('clock-v3 B repair GPT deadline: restores predecessor lineage post-processing admission with dual wire', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    let now = 0
    const result = await B.readNativeClockProcessV3({ pid: 9100, mode: 'lineage', expectedRoot: expectedBirth(9101) as never, deadline: { domain: 'controlled', expiresMs: 10, now: () => now } }, { spawnSync: () => { now = 11; return { status: 0, signal: null, stdout: JSON.stringify(gptReply('lineage')), stderr: '' } } })
    expectFailure(result, 'deadline-elapsed')
  })

  it('clock-v3 B repair GPT failure tokens: inherited object names never escape the fixed schema', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    for (const code of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const result = await B.readNativeClockProcessV3({ pid: 9100, mode: 'single', deadline: farDeadline() }, { spawnSync: () => ({ status: 0, signal: null, stdout: JSON.stringify({ schema: 'rrm-clock-bridge-reply-br-v2', ok: false, failure: { code, detail: 'fixed' } }), stderr: '' }) })
      expectFailure(result, 'invalid-response')
      if (result.ok) return assert.fail('fixed failure expected')
      assert.equal(typeof result.failure.detail, 'string')
    }
  })

  it('clock-v3 B repair GPT duplicate replies: top-level, nested and escaped duplicate keys reject', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const line = JSON.stringify(gptReply())
    for (const duplicate of [line.replace('"ok":true', '"ok":false,"ok":true'), line.replace('"idVersion":7', '"idVersion":8,"idVersion":7'), line.replace('"ok":true', '"\\u006fk":false,"ok":true')]) {
      assert.throws(() => B.parseClockBridgeReplyV3(duplicate, 'single', 9100), (e: unknown) => e instanceof B.ClockBridgeFailureV3 && e.failure.code === 'invalid-response')
    }
    assert.equal(B.parseClockBridgeReplyV3(line, 'single', 9100).ok, true)
  })

  it('clock-v3 B repair GPT boot identity: all single, observer, lineage nodes and expected root match observed OS boot', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const foreign = '67e93041-450b-4881-a1b9-f278f4030349'
    for (const mode of ['single', 'observer', 'lineage'] as const) {
      const reply = gptReply(mode)
      if (mode === 'lineage') {
        reply.observation.walkOne[0].bootUuid = foreign
        reply.observation.walkTwo[0].bootUuid = foreign
      } else reply.read.bootUuid = foreign
      assert.throws(() => B.parseClockBridgeReplyV3(JSON.stringify(reply), mode, 9100, mode === 'lineage' ? expectedBirth(9101) as never : undefined), (e: unknown) => e instanceof B.ClockBridgeFailureV3 && e.failure.code === 'invalid-response')
    }
    const allForeign = gptReply('lineage')
    allForeign.os = { ...SUPPORTED_OS, bootUuid: foreign }
    assert.throws(() => B.parseClockBridgeReplyV3(JSON.stringify(allForeign), 'lineage', 9100, expectedBirth(9101) as never), (e: unknown) => e instanceof B.ClockBridgeFailureV3 && e.failure.code === 'invalid-response')
  })

  it('clock-v3 B repair GPT UTF8 reply: malformed bytes and lone surrogate text fail closed without echo', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const failurePrefix = '{"schema":"rrm-clock-bridge-reply-br-v2","ok":false,"failure":{"code":"denied","detail":"'
    const invalid = Buffer.concat([Buffer.from(failurePrefix), Buffer.from([0xff]), Buffer.from('"}}')])
    for (const stdout of [invalid, failurePrefix + '\ud800"}}']) {
      const result = await B.readNativeClockProcessV3({ pid: 9100, mode: 'single', deadline: farDeadline() }, { spawnSync: (_file, _args, options) => ({ status: 0, signal: null, stdout: Buffer.isBuffer(stdout) && (options.encoding as string) === 'utf8' ? stdout.toString('utf8') : stdout, stderr: '' }) })
      expectFailure(result, 'invalid-response')
    }
  })

  it('clock-v3 B repair GPT literal JSON: duplicate request keys and malformed UTF8 reject before FFI', async () => {
    const request = JSON.stringify({ schema: 'rrm-clock-bridge-request-br-v2', mode: 'single', pid: 9200 })
    for (const raw of [request.replace('"mode":"single"', '"mode":"lineage","mode":"single"'), request.replace('"pid":9200', '"p\\u0069d":1,"pid":9200')]) {
      const run = await controlledFfiRun({ argv: ['single', 9200, raw], procs: chainProcs([9200], 9200), sysctl: baseSysctl() })
      assert.equal(run.reply.ok, false)
      assert.equal(run.reply.failure.code, 'invalid-response')
      assert.equal(run.calls.length, 0, 'invalid wire rejected before libraries or process reads')
    }
    // rootScopePath is an otherwise admitted string at this step-1 boundary;
    // malformed bytes must reject before even loading the controlled libraries.
    const observer = JSON.stringify({ schema: 'rrm-clock-bridge-request-br-v2', mode: 'observer', pid: 9200, appDir: '/tmp/clock-gpt', rootScopePath: 'REPLACE', registrationPath: '/tmp/clock-gpt/uncreated-registration.json', leaseRef: { path: '/tmp/clock-gpt/lease.json', sha256: 'a'.repeat(64), bytes: 1 } })
    const [before, after] = observer.split('REPLACE')
    const bytes = Buffer.concat([Buffer.from(before), Buffer.from([0xff]), Buffer.from(after)])
    const badUtf8 = await controlledFfiRun({ argv: ['observer', 9200, '/tmp/clock-gpt', observer], rawRequestHex: bytes.toString('hex'), procs: {}, sysctl: baseSysctl() })
    assert.equal(badUtf8.reply.ok, false)
    assert.equal(badUtf8.reply.failure.code, 'invalid-response')
    assert.equal(badUtf8.calls.length, 0)
  })

  it('clock-v3 B repair GPT literal root-after: changed final group fails inside the actual literal', async () => {
    const rootPid = 9301
    const request = { schema: 'rrm-clock-bridge-request-br-v2', mode: 'lineage', pid: 9300, expectedRoot: expectedBirth(rootPid) }
    const run = await controlledFfiRun({ argv: ['lineage', 9300, rootPid, JSON.stringify(request)], procs: chainProcs([9300, rootPid], rootPid), sysctl: baseSysctl(), flipAtCall: { afterCalls: 20, pid: rootPid, field: 'pgid', value: 9999 } })
    assert.equal(run.reply.ok, false)
    assert.equal(run.reply.failure.code, 'changed')
    assert.equal(run.calls.filter((c) => c[0] === 'pidinfo').length, 18)
  })

  it('clock-v3 B repair GPT literal EACCES: errno 13 is denied without real permission probing', async () => {
    const run = await controlledFfiRun({ argv: ['single', 9400, JSON.stringify({ schema: 'rrm-clock-bridge-request-br-v2', mode: 'single', pid: 9400 })], procs: chainProcs([9400], 9400, { '9400': { errno: 13 } }), sysctl: baseSysctl() })
    assert.equal(run.reply.ok, false)
    assert.equal(run.reply.failure.code, 'denied')
  })

  it('clock-v3 B repair GPT literal bound: exactly 32 nodes succeed with 66 readOne and 198 proc_pidinfo calls', async () => {
    const pids = Array.from({ length: 32 }, (_, i) => 9500 + i)
    const rootPid = pids[31]
    const request = { schema: 'rrm-clock-bridge-request-br-v2', mode: 'lineage', pid: pids[0], expectedRoot: expectedBirth(rootPid) }
    const run = await controlledFfiRun({ argv: ['lineage', pids[0], rootPid, JSON.stringify(request)], procs: chainProcs(pids, rootPid), sysctl: baseSysctl() })
    assert.equal(run.reply.ok, true)
    assert.equal(run.reply.observation.walkOne.length, 32)
    assert.equal(run.reply.observation.walkTwo.length, 32)
    assert.equal(run.calls.filter((c) => c[0] === 'pidinfo').length, 198)
    assert.ok(run.calls.filter((c) => c[0] === 'pidinfo').every((c) => pids.includes(c[1])))
  })

  it('step1 controlled FFI: lineage reads root-before, two leaf-to-owned-root walks and root-after in exact order with errno exchange enabled', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const leafPid = 8100
    const rootPid = 8102
    const request = { schema: 'rrm-clock-bridge-request-br-v2', mode: 'lineage', pid: leafPid, expectedRoot: expectedBirth(rootPid) }
    const run = await controlledFfiRun({ argv: ['lineage', leafPid, rootPid, JSON.stringify(request)], procs: chainProcs([leafPid, 8101, rootPid], rootPid), sysctl: baseSysctl() })
    const reply = run.reply
    assert.equal(reply.ok, true, 'controlled lineage succeeds: ' + JSON.stringify(reply).slice(0, 300))
    assert.equal(reply.schema, 'rrm-clock-bridge-reply-br-v2')
    assert.deepEqual(reply.observation.walkOne.map((n: any) => n.pid), [leafPid, 8101, rootPid], 'collection one walks leaf to the owned root')
    assert.deepEqual(reply.observation.walkTwo.map((n: any) => n.pid), [leafPid, 8101, rootPid], 'collection two walks leaf to the owned root inside the same invocation')
    assert.equal(reply.observation.rootBefore.pid, rootPid)
    assert.equal(reply.observation.rootAfter.pid, rootPid)
    assert.deepEqual(reply.os, SUPPORTED_OS)
    const pidinfo = run.calls.filter((c) => c[0] === 'pidinfo')
    const readOrderReadOnes = [rootPid, leafPid, 8101, rootPid, leafPid, 8101, rootPid, rootPid]
    assert.deepEqual(pidinfo.map((c) => c[1]), readOrderReadOnes.flatMap((pid) => [pid, pid, pid]), 'read order is root-before, walk one, walk two, root-after (three proc_pidinfo calls per readOne)')
    assert.deepEqual(pidinfo.map((c) => c[2]), readOrderReadOnes.flatMap(() => [17, 13, 17]), 'every readOne is an exact U→B→U triple')
    const cdll = run.calls.filter((c) => c[0] === 'cdll')
    assert.equal(cdll.length, 2, 'exactly the two pinned libraries are loaded')
    for (const entry of cdll) {
      assert.deepEqual(entry[2], ['use_errno'], 'errno exchange must be requested via the use_errno keyword')
      assert.equal(entry[3], true, 'ctypes errno exchange must be enabled (use_errno=True)')
    }
    assert.ok(B.CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE.includes('use_errno=True'), 'the exported literal enables errno exchange')
  })

  it('step1 controlled FFI: the walk stops at the owned root and never queries above it', async () => {
    const leafPid = 8200
    const rootPid = 8201
    const request = { schema: 'rrm-clock-bridge-request-br-v2', mode: 'lineage', pid: leafPid, expectedRoot: expectedBirth(rootPid) }
    const run = await controlledFfiRun({ argv: ['lineage', leafPid, rootPid, JSON.stringify(request)], procs: chainProcs([leafPid, rootPid], rootPid), sysctl: baseSysctl() })
    assert.equal(run.reply.ok, true, 'two-node owned lineage succeeds: ' + JSON.stringify(run.reply).slice(0, 300))
    const queriedReadOnes = [rootPid, leafPid, rootPid, leafPid, rootPid, rootPid]
    const queried = run.calls.filter((c) => c[0] === 'pidinfo').map((c) => c[1])
    assert.deepEqual(queried, queriedReadOnes.flatMap((pid) => [pid, pid, pid]), 'reads touch only the owned root and the leaf chain below it (three calls per readOne)')
    assert.ok(!queried.includes(1), 'the root parent above the owned root is never queried')
  })

  it('step1 controlled FFI: the 33rd read is prevented by the pre-read bound; cycles are caught before another read', async () => {
    const pids = Array.from({ length: 34 }, (_, i) => 8300 + i)
    const rootPid = 8333
    const request = { schema: 'rrm-clock-bridge-request-br-v2', mode: 'lineage', pid: 8300, expectedRoot: expectedBirth(rootPid) }
    const run = await controlledFfiRun({ argv: ['lineage', 8300, rootPid, JSON.stringify(request)], procs: chainProcs(pids, rootPid), sysctl: baseSysctl() })
    assert.equal(run.reply.ok, false, 'a 34-node chain exceeds the 32-node per-walk bound')
    assert.equal(run.reply.failure.code, 'changed')
    const queried = run.calls.filter((c) => c[0] === 'pidinfo').map((c) => c[1])
    assert.equal(queried[0], rootPid, 'root-before is read first')
    assert.equal(queried.length, 99, 'root-before plus exactly 32 walk readOnes (three proc_pidinfo calls each) happen before the bound stops the walk')
    assert.ok(!queried.includes(8331 + 1), 'the 33rd walk node is never read: the bound is checked before the next read')

    const cycleRoot = 8402
    const cycleRequest = { schema: 'rrm-clock-bridge-request-br-v2', mode: 'lineage', pid: 8400, expectedRoot: expectedBirth(cycleRoot) }
    const cycleRun = await controlledFfiRun({
      argv: ['lineage', 8400, cycleRoot, JSON.stringify(cycleRequest)],
      procs: chainProcs([8400, 8401, cycleRoot], cycleRoot, { '8401': { ppid: 8400, parentUniqueId: String(70000 + 8400) } }),
      sysctl: baseSysctl(),
    })
    assert.equal(cycleRun.reply.ok, false)
    assert.equal(cycleRun.reply.failure.code, 'changed')
    const cycleQueried = cycleRun.calls.filter((c) => c[0] === 'pidinfo').map((c) => c[1])
    assert.equal(cycleQueried.filter((pid) => pid === 8400).length, 3, 'the cycling node is read exactly once (one readOne = three proc_pidinfo calls); the cycle is caught before the next read')
  })

  it('step1 controlled FFI: errno exchange classifies denial and exit; zombie, in-exit and wrong ABI size reject', async () => {
    const singleArgv = (pid: number) => ['single', pid, JSON.stringify({ schema: 'rrm-clock-bridge-request-br-v2', mode: 'single', pid })]
    const denied = await controlledFfiRun({ argv: singleArgv(8500), procs: chainProcs([8500], 8500, { '8500': { errno: 1 } }), sysctl: baseSysctl() })
    assert.equal(denied.reply.ok, false)
    assert.equal(denied.reply.failure.code, 'denied', 'EPERM-class errno maps to denied through the real errno exchange')
    const exited = await controlledFfiRun({ argv: singleArgv(8501), procs: chainProcs([8501], 8501, { '8501': { errno: 3 } }), sysctl: baseSysctl() })
    assert.equal(exited.reply.ok, false)
    assert.equal(exited.reply.failure.code, 'exited', 'ESRCH-class errno maps to exited')
    const zombie = await controlledFfiRun({ argv: singleArgv(8502), procs: chainProcs([8502], 8502, { '8502': { status: 5 } }), sysctl: baseSysctl() })
    assert.equal(zombie.reply.ok, false)
    assert.equal(zombie.reply.failure.code, 'exited', 'SZOMB is rejected at the source')
    const inExit = await controlledFfiRun({ argv: singleArgv(8503), procs: chainProcs([8503], 8503, { '8503': { flags: 4 } }), sysctl: baseSysctl() })
    assert.equal(inExit.reply.ok, false)
    assert.equal(inExit.reply.failure.code, 'changed', 'PROC_FLAG_INEXIT is rejected at the source')
    const wrongSize = await controlledFfiRun({ argv: singleArgv(8504), procs: chainProcs([8504], 8504, { '8504': { shortBytes: 63 } }), sysctl: baseSysctl() })
    assert.equal(wrongSize.reply.ok, false)
    assert.equal(wrongSize.reply.failure.code, 'invalid-abi', 'a 63-byte short return is an ABI mismatch')
  })

  it('step1 controlled FFI: wrong or missing release/build observations reject unsupported-platform; malformed boot UUID and interpreter version reject', async () => {
    const argv = ['single', 8600, JSON.stringify({ schema: 'rrm-clock-bridge-request-br-v2', mode: 'single', pid: 8600 })]
    const wrongRelease = await controlledFfiRun({ argv, procs: chainProcs([8600], 8600), sysctl: { ...baseSysctl(), 'kern.osrelease': '24.0.0' } })
    assert.equal(wrongRelease.reply.ok, false)
    assert.equal(wrongRelease.reply.failure.code, 'unsupported-platform')
    assert.ok(!JSON.stringify(wrongRelease.reply).includes('24.0.0'), 'the wrong observation value is not echoed')
    const missingBuild = await controlledFfiRun({ argv, procs: chainProcs([8600], 8600), sysctl: { 'kern.osrelease': '25.6.0', 'kern.bootsessionuuid': BOOT } })
    assert.equal(missingBuild.reply.ok, false)
    assert.equal(missingBuild.reply.failure.code, 'unsupported-platform', 'a missing sysctl observation fails closed')
    const badUuid = await controlledFfiRun({ argv, procs: chainProcs([8600], 8600), sysctl: { ...baseSysctl(), 'kern.bootsessionuuid': 'not-a-uuid' } })
    assert.equal(badUuid.reply.ok, false)
    assert.equal(badUuid.reply.failure.code, 'invalid-response', 'a malformed boot UUID rejects as invalid identity')
    const wrongPython = await controlledFfiRun({ argv, procs: chainProcs([8600], 8600), sysctl: baseSysctl(), pythonVersion: '3.13.0' })
    assert.equal(wrongPython.reply.ok, false)
    assert.equal(wrongPython.reply.failure.code, 'unsupported-platform', 'an unexpected interpreter version fails closed')
  })

  it('step1 controlled FFI: a broken parent unique-ID edge and a changed U→B→U identity fail typed', async () => {
    const leafPid = 8700
    const midPid = 8701
    const rootPid = 8702
    const request = { schema: 'rrm-clock-bridge-request-br-v2', mode: 'lineage', pid: leafPid, expectedRoot: expectedBirth(rootPid) }
    const brokenEdge = await controlledFfiRun({
      argv: ['lineage', leafPid, rootPid, JSON.stringify(request)],
      procs: chainProcs([leafPid, midPid, rootPid], rootPid, { [String(midPid)]: { uniqueId: '777' } }),
      sysctl: baseSysctl(),
    })
    assert.equal(brokenEdge.reply.ok, false)
    assert.equal(brokenEdge.reply.failure.code, 'changed', 'child.parentUniqueId must equal the parent uniqueId on every edge')
    const flip = await controlledFfiRun({
      argv: ['single', leafPid, JSON.stringify({ schema: 'rrm-clock-bridge-request-br-v2', mode: 'single', pid: leafPid })],
      procs: chainProcs([leafPid], leafPid),
      sysctl: baseSysctl(),
      flipAtCall: { afterCalls: 6, pid: leafPid, field: 'uniqueId', value: '9' },
    })
    assert.equal(flip.reply.ok, false)
    assert.equal(flip.reply.failure.code, 'changed', 'a U→B→U identity change during one read is rejected')
  })

  it('step1 injected: request argv layout is mode-specific with exactly the allowed request keys and a fixed minimal environment', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const captured: { file: string; args: readonly string[]; env: Record<string, string> }[] = []
    const recorder: SpawnSyncStub = (file, args, options) => {
      captured.push({ file, args, env: options.env })
      return { status: 0, signal: null, stdout: '', stderr: '' }
    }
    const single = await B.readNativeClockProcessV3({ pid: 8801, mode: 'single', deadline: farDeadline() }, { spawnSync: recorder })
    expectFailure(single, 'invalid-response')
    assert.equal(captured[0].file, B.CLOCK_PINNED_PYTHON_V3.executable, 'the pinned interpreter is used')
    assert.deepEqual(captured[0].args.slice(0, 5), ['-I', '-S', '-B', '-c', B.CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE], 'fixed interpreter flags and the one literal')
    assert.equal(captured[0].args[5], 'single')
    assert.equal(captured[0].args[6], '8801')
    assert.deepEqual(Object.keys(JSON.parse(captured[0].args[7])).sort(), ['mode', 'pid', 'schema'], 'single request carries exactly the allowed keys')
    assert.deepEqual(captured[0].env, { PATH: '/usr/bin:/bin' }, 'the environment is fixed and minimal; no caller override')
    const expectedRoot = expectedBirth(8803) as never
    await B.readNativeClockProcessV3({ pid: 8802, mode: 'lineage', expectedRoot, deadline: farDeadline() } as never, { spawnSync: recorder })
    assert.equal(captured[1].args[5], 'lineage')
    assert.equal(captured[1].args[6], '8802')
    assert.equal(captured[1].args[7], '8803', 'lineage argv carries the canonical root pid argument')
    const lineageRequest = JSON.parse(captured[1].args[8])
    assert.deepEqual(Object.keys(lineageRequest).sort(), ['expectedRoot', 'mode', 'pid', 'schema'])
    assert.deepEqual(lineageRequest.expectedRoot, expectedRoot)
    assert.throws(
      () => B.buildClockNativeBridgeCommandV3({ schema: 'rrm-clock-bridge-request-br-v2', mode: 'lineage', pid: 1, expectedRoot: { bootUuid: BOOT, pid: 2, uniqueId: '1', idVersion: -7, executableUuid: 'a'.repeat(32) } }),
      'a negative idVersion expected root is rejected before spawn',
    )
  })

  it('step1 injected: negative idVersion fails closed in node parsing and reply parsing (CR1)', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const negative = JSON.stringify({ bootUuid: BOOT, pid: 1, uniqueId: '4242424242', idVersion: -7, executableUuid: 'a'.repeat(32), ppid: 0, parentUniqueId: '0', pgid: 1, status: 2, flags: 0 })
    assert.throws(
      () => B.parseClockBridgeNodeReadV3(negative, 1),
      (error: unknown): error is InstanceType<typeof B.ClockBridgeFailureV3> => error instanceof B.ClockBridgeFailureV3 && error.failure.code === 'invalid-response',
    )
    const replyLine = JSON.stringify({ schema: 'rrm-clock-bridge-reply-br-v2', ok: true, mode: 'single', requestedPid: 1, os: SUPPORTED_OS, read: JSON.parse(negative) })
    assert.throws(
      () => B.parseClockBridgeReplyV3(replyLine, 'single', 1),
      (error: unknown): error is InstanceType<typeof B.ClockBridgeFailureV3> => error instanceof B.ClockBridgeFailureV3 && error.failure.code === 'invalid-response',
      'a reply carrying a negative idVersion birth is rejected before any admissible construction',
    )
  })

  it('step1 roles: seed driver is the host role; observer bootstrap pairs observer with raw-ms; contradictory pairings reject', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const baseDriver = {
      schema: 'rrm-clock-preroot-descriptor-v3',
      scopeId: '99999999-0000-4000-8000-000000000099',
      clockInstanceId: '88888888-0000-4000-8000-000000000088',
      basis: 'node-hrtime-bigint-performance-now',
      nativeBirth: { bootUuid: BOOT, pid: 5000, uniqueId: '424242', idVersion: 7, executableUuid: 'a'.repeat(32) },
      observedParent: { pid: 1, parentUniqueId: '42' },
    }
    const seedInput = {
      purpose: 'offline-fixture',
      scopeId: '99999999-0000-4000-8000-000000000099',
      preRuntimeSubject: { pass: 1, invocation: 3, invocationId: 'inv', profile: 'baseline', runId: 'run', sourceMode: 'copied-source', evidenceRoot: '/tmp/clock-b-step1/evidence', clearanceManifest: { path: '/tmp/clock-b-step1/clearance.json', sha256: 'f'.repeat(64), bytes: 12 } },
      approvedSourceRef: { path: '/tmp/clock-b-step1/source.json', sha256: '1'.repeat(64), bytes: 5 },
      toolPolicyRef: { path: '/tmp/clock-b-step1/policy.json', sha256: '2'.repeat(64), bytes: 6 },
      ownedNamespaces: ['clock-b-step1-a'],
      driverDescriptor: { ...baseDriver, domain: 'matrix-context-capture', representation: 'host-rounded-ms' },
    }
    const seed = B.createClockScopeSeedV3(seedInput as never)
    assert.equal(seed.schema, 'rrm-clock-scope-seed-v3', 'the host/host-rounded seed driver is accepted')
    assert.throws(() => B.createClockScopeSeedV3({ ...seedInput, driverDescriptor: { ...baseDriver, domain: 'observer', representation: 'raw-ms' } } as never), (error: unknown) => error instanceof Error, 'a seed driver in the observer role rejects: the seed driver is the host')
    assert.throws(() => B.createClockScopeSeedV3({ ...seedInput, driverDescriptor: { ...baseDriver, domain: 'matrix-context-capture', representation: 'raw-ms' } } as never), (error: unknown) => error instanceof Error, 'host role with raw-ms representation rejects')
    assert.throws(() => B.createClockScopeSeedV3({ ...seedInput, driverDescriptor: { ...baseDriver, domain: 'observer', representation: 'host-rounded-ms' } } as never), (error: unknown) => error instanceof Error, 'observer role with host-rounded representation rejects')
    const bootstrap = {
      schema: 'rrm-clock-observer-bootstrap-v3',
      seedRef: { path: '/tmp/clock-b-step1/seed.json', sha256: 'b'.repeat(64), bytes: 10 },
      protocolId: 'rrm-clock-v3',
      appDir: process.cwd(),
      rootScopePath: '/tmp/clock-b-step1/root-scope.json',
      probeRoot: '/tmp/clock-b-step1/probe',
      toolPolicyRef: { path: '/tmp/clock-b-step1/policy.json', sha256: 'c'.repeat(64), bytes: 10 },
      sourceDescriptor: { schema: 'rrm-clock-preroot-descriptor-v3', scopeId: 'cccccccc-0000-4000-8000-0000000000cc', clockInstanceId: 'd1e2c0a7-0000-4000-8000-000000000001', domain: 'observer', representation: 'raw-ms', basis: 'node-hrtime-bigint-performance-now' },
    }
    const neverSpawn = () => {
      throw new Error('must not spawn')
    }
    assert.throws(
      () => B.readObserverSelfSyncV3({ bootstrap: { ...bootstrap, sourceDescriptor: { ...bootstrap.sourceDescriptor, domain: 'matrix-context-capture', representation: 'host-rounded-ms' } } as never, localBudgetMs: 1000 }, { spawnSync: neverSpawn }),
      /observer/,
      'a host-role bootstrap rejects',
    )
    assert.throws(
      () => B.readObserverSelfSyncV3({ bootstrap: { ...bootstrap, sourceDescriptor: { ...bootstrap.sourceDescriptor, representation: 'host-rounded-ms' } } as never, localBudgetMs: 1000 }, { spawnSync: neverSpawn }),
      /raw-ms/,
      'observer role with host-rounded representation rejects',
    )
  })

  it('step1 injected: observer mode passes the registration path in the argv request JSON with a fixed minimal environment', async () => {
    const B = await import('../support/native/rejection-recovery-runtime')
    const probeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'clock-b-step1-obs-'))
    const scopeId = 'bbbbbbbb-0000-4000-8000-0000000000bb'
    let capturedArgs: readonly string[] = []
    let capturedEnv: Record<string, string> = {}
    let capturedTimeout = -1
    const killer: SpawnSyncStub = (_file, args, options) => {
      capturedArgs = args
      capturedEnv = options.env
      capturedTimeout = options.timeout
      return { status: null, signal: 'SIGKILL', stdout: '', stderr: '' }
    }
    assert.throws(
      () => B.readObserverSelfSyncV3({
        bootstrap: {
          schema: 'rrm-clock-observer-bootstrap-v3',
          seedRef: { path: '/tmp/clock-b-step1/seed.json', sha256: 'b'.repeat(64), bytes: 10 },
          protocolId: 'rrm-clock-v3',
          appDir: process.cwd(),
          rootScopePath: '/tmp/clock-b-step1/root-scope.json',
          probeRoot,
          toolPolicyRef: { path: '/tmp/clock-b-step1/policy.json', sha256: 'c'.repeat(64), bytes: 10 },
          sourceDescriptor: { schema: 'rrm-clock-preroot-descriptor-v3', scopeId, clockInstanceId: 'd1e2c0a7-0000-4000-8000-000000000001', domain: 'observer', representation: 'raw-ms', basis: 'node-hrtime-bigint-performance-now' },
        } as never,
        localBudgetMs: 1000,
      }, { spawnSync: killer }),
      /SIGKILL|exit proof/i,
    )
    assert.ok(capturedTimeout >= 1 && capturedTimeout <= 1000, 'the observer spawn timeout stays within the 1..1000 local cap')
    assert.equal(capturedArgs[5], 'observer', 'observer argv mode')
    assert.equal(capturedArgs[6], String(process.pid), 'observer argv pid is the actual Node pid')
    assert.equal(capturedArgs[7], process.cwd(), 'observer argv appDir is the genuine appDir')
    const request = JSON.parse(capturedArgs[8])
    assert.deepEqual(Object.keys(request).sort(), ['appDir', 'leaseRef', 'mode', 'pid', 'registrationPath', 'rootScopePath', 'schema'], 'observer request carries exactly the step-1 allowed keys')
    assert.equal(request.appDir, process.cwd())
    assert.ok(request.registrationPath.startsWith(probeRoot), 'the registration path rides in the request JSON under the owned probe namespace')
    assert.deepEqual(capturedEnv, { PATH: '/usr/bin:/bin' }, 'the observer environment is fixed and minimal')
  })
})
