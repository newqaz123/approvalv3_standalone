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

describe('matrix browser profile', () => {
  it('stays headed by default and goes headless only with RRM_HEADLESS=1', async () => {
    const { matrixBrowserProfile, MATRIX_HEADED, MATRIX_HEADLESS } = await import('../support/rejection-recovery-matrix')
    assert.equal(matrixBrowserProfile({}), MATRIX_HEADED)
    assert.equal(matrixBrowserProfile({ RRM_HEADLESS: '0' }), MATRIX_HEADED)
    assert.equal(matrixBrowserProfile({ RRM_HEADLESS: '1' }), MATRIX_HEADLESS)
    assert.deepEqual(MATRIX_HEADLESS, { headless: true, slowMo: 0, viewport: { width: 1440, height: 1000 }, checkpointMs: 500 })
  })
})

describe('matrix assertion timeout and app-log retention', () => {
  it('waits for assertions as long as page actions (30s), not Playwright\'s 5s default', async () => {
    const { MATRIX_ASSERT_TIMEOUT_MS } = await import('../support/rejection-recovery-matrix')
    assert.equal(MATRIX_ASSERT_TIMEOUT_MS, 30_000)
    const driver = await fsp.readFile(path.join(process.cwd(), 'tests/manual/rejection-recovery-matrix.ts'), 'utf8')
    assert.match(driver, /expect as baseExpect/)
    assert.match(driver, /const expect = baseExpect\.configure\(\{ timeout: MATRIX_ASSERT_TIMEOUT_MS \}\)/)
    assert.match(driver, /page\.setDefaultTimeout\(30_000\)/)
  })

  it('keeps the tail of the app log before the runtime root is deleted', async () => {
    const os = await import('node:os')
    const { copyLogTail } = await import('../support/native/rejection-recovery-runtime')
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rrm-logtail-test-'))
    try {
      assert.equal(await copyLogTail(path.join(dir, 'missing.log'), path.join(dir, 'out', 'missing.log')), 'missing')
      await fsp.writeFile(path.join(dir, 'small.log'), 'hello\n')
      assert.equal(await copyLogTail(path.join(dir, 'small.log'), path.join(dir, 'out', 'small.log'), 100), 'copied')
      assert.equal(await fsp.readFile(path.join(dir, 'out', 'small.log'), 'utf8'), 'hello\n')
      await fsp.writeFile(path.join(dir, 'big.log'), `${'a'.repeat(50)}TAIL-END`)
      assert.equal(await copyLogTail(path.join(dir, 'big.log'), path.join(dir, 'out', 'big.log'), 8), 'copied')
      assert.equal(await fsp.readFile(path.join(dir, 'out', 'big.log'), 'utf8'), 'TAIL-END')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})
