import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUSINESS_REQUEST_TITLE_LIKE,
  evaluateDefaultWorkflowEvidence,
  type DbEvidenceData,
  type DbEvidenceRow,
  type WorkflowCheck,
} from '../support/native/capture-workflow-db-evidence'

/**
 * Regression: the DB-evidence evaluator's T08/T09/T10 FINAL-TRIGGER and
 * FINAL-ORIGIN expectations must assert the CONFIRMED plan rule (plan §1/§6)
 * and FAIL on the known product deviations instead of accepting them:
 *
 *  - the FINAL attempt origin must be the ORIGINAL REQUESTER
 *    (user-requester-a), NEVER the trigger actor — a persisted trigger-actor
 *    origin (solutions.ts createFinalApprovalAttempt originUserId: userId)
 *    must fail `final-origin`;
 *  - a MISSING Final trigger (e.g. the exact-origin-unit eligibility gap that
 *    denies the parent Department manager, canInitiateFinalApproval) must
 *    fail `final-instance`/`terminal-status`;
 *  - a Final routed over the TRIGGER actor's parent/company branch instead of
 *    the original requester's branch must fail route id + persisted scope +
 *    ordered steps + captured candidates (distinguishable final-exception
 *    fixture versus company default);
 *  - denied/premature Final attempts must leave NO FINAL approval instance
 *    (T09A) and completed targets must keep EXACTLY ONE intact FINAL attempt
 *    (T04A single-final-attempt proof for the T09 post-Completed denials);
 *  - solutionId/instanceId linkage and the isFinalApproval flag audit are
 *    preserved (FINAL rows matched by instanceId; flag violations still fail
 *    their own explicit check);
 *  - scenarios of non-selected profiles are explicit SKIPPED entries and
 *    cross-profile execution FAILS.
 *
 * Row fixtures are hand-authored literals mirroring the persisted shapes
 * grounded by the recorded green runs (see
 * business-db-evidence-exception-profiles.test.ts); they deliberately do NOT
 * derive from the evaluator's expectation maps.
 */

const SUPERVISOR = 'position-supervisor'
const SECTION_MANAGER = 'position-section-manager'
const DEPARTMENT_MANAGER = 'position-department-manager'

const ALL_DEFAULTS_ROUTES: DbEvidenceRow[] = [
  routeVersion('all-defaults-request-default', 'unit-company', 'REQUEST', [SUPERVISOR, SECTION_MANAGER, DEPARTMENT_MANAGER]),
  routeVersion('all-defaults-solution-default', 'unit-company', 'SOLUTION', [SUPERVISOR, SECTION_MANAGER, DEPARTMENT_MANAGER]),
  routeVersion('all-defaults-final-default', 'unit-company', 'FINAL', [SECTION_MANAGER, DEPARTMENT_MANAGER]),
  // The final-exception routes exist in the same fixture DB picture so a
  // wrong-branch FINAL route selection RESOLVES (and then fails the scope
  // expectation) instead of degrading to "route version not found".
  routeVersion('final-exception-request-default', 'unit-company', 'REQUEST', [SUPERVISOR, SECTION_MANAGER, DEPARTMENT_MANAGER]),
  routeVersion('final-exception-solution-default', 'unit-company', 'SOLUTION', [SUPERVISOR, SECTION_MANAGER, DEPARTMENT_MANAGER]),
  routeVersion('final-exception-final-default', 'unit-company', 'FINAL', [SECTION_MANAGER, DEPARTMENT_MANAGER]),
  routeVersion('final-exception-final-exception', 'unit-production-1-section', 'FINAL', [DEPARTMENT_MANAGER]),
]

function checksByName(checks: WorkflowCheck[]): Map<string, WorkflowCheck> {
  return new Map(checks.map((check) => [check.name, check]))
}

function failures(checks: WorkflowCheck[]): string[] {
  return checks.filter((check) => check.status === 'fail').map((check) => check.name)
}

interface StepRowInput {
  id: string
  order: number
  positionId: string
  approverId: string
  candidateGroupId: string
  candidateMembers?: string[]
  /** Approval rows may be pending (T09A interrupted solution). */
  status?: string
}

function requestApprovalRows(instanceId: string, requestId: string, rows: StepRowInput[], isFinal: boolean): DbEvidenceRow[] {
  return rows.map((row) => ({
    id: row.id,
    requestId,
    instanceId,
    order: row.order,
    status: row.status ?? 'approved',
    requiredPositionId: row.positionId,
    approverId: row.status === 'pending' ? null : row.approverId,
    candidateGroupId: row.candidateGroupId,
    isFinalApproval: isFinal,
    approvedAt: row.status === 'pending' ? null : '2026-09-18T00:00:00Z',
    createdAt: '2026-09-18T00:00:00Z',
  }))
}

function solutionApprovalRows(instanceId: string, solutionId: string, rows: StepRowInput[]): DbEvidenceRow[] {
  return rows.map((row) => ({
    id: row.id,
    solutionId,
    instanceId,
    order: row.order,
    status: row.status ?? 'approved',
    requiredPositionId: row.positionId,
    approverId: row.status === 'pending' ? null : row.approverId,
    candidateGroupId: row.candidateGroupId,
    approvedAt: row.status === 'pending' ? null : '2026-09-18T00:00:00Z',
    createdAt: '2026-09-18T00:00:00Z',
  }))
}

function candidateGroup(
  id: string,
  instanceId: string,
  positionId: string,
  scopeUnitId: string,
  members: string[],
): DbEvidenceRow {
  return {
    id,
    approvalInstanceId: instanceId,
    requiredPositionId: positionId,
    scopeUnitId,
    capturedAt: '2026-09-18T00:00:00Z',
    members: members.map((userId) => ({ userId, name: userId })),
  }
}

function routeVersion(id: string, scopeUnitId: string, phase: string, steps: string[]): DbEvidenceRow {
  return {
    id,
    scopeUnitId,
    phase,
    version: 1,
    status: 'PUBLISHED',
    approvalLimitPositionId: DEPARTMENT_MANAGER,
    steps: steps.map((positionId, index) => ({ order: index + 1, positionId })),
  }
}

interface TriggerWorkflowInput {
  title: string
  requestId: string
  solutionId: string
  /** Persisted FINAL attempt origin (the CONFIRMED rule: the original requester). */
  finalOrigin: string
  /** FINAL route version id the attempt points at. */
  finalRouteVersionId: string
  requestStatus?: string
  /** When true, no FINAL instance/rows are emitted (denied trigger). */
  omitFinal?: boolean
}

/**
 * Completed all-defaults workflow up to the Final trigger: default Request +
 * Solution chains approved, then the Final trigger creates the FINAL attempt
 * on the company-default route (Section manager P → Department manager).
 */
function t08Workflow(input: TriggerWorkflowInput): DbEvidenceData {
  const requestSteps: StepRowInput[] = [
    { id: `${input.requestId}-ra1`, order: 1, positionId: SUPERVISOR, approverId: 'user-supervisor-p', candidateGroupId: `${input.requestId}-rg1`, candidateMembers: ['user-second-approver', 'user-supervisor-p'] },
    { id: `${input.requestId}-ra2`, order: 2, positionId: SECTION_MANAGER, approverId: 'user-section-manager-p', candidateGroupId: `${input.requestId}-rg2` },
    { id: `${input.requestId}-ra3`, order: 3, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: `${input.requestId}-rg3` },
  ]
  const solutionSteps: StepRowInput[] = [
    { id: `${input.requestId}-sa1`, order: 1, positionId: SUPERVISOR, approverId: 'user-supervisor-e', candidateGroupId: `${input.requestId}-sg1` },
    { id: `${input.requestId}-sa2`, order: 2, positionId: SECTION_MANAGER, approverId: 'user-section-manager-e', candidateGroupId: `${input.requestId}-sg2` },
    { id: `${input.requestId}-sa3`, order: 3, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: `${input.requestId}-sg3` },
  ]
  const finalSteps: StepRowInput[] = [
    { id: `${input.requestId}-fa1`, order: 1, positionId: SECTION_MANAGER, approverId: 'user-section-manager-p', candidateGroupId: `${input.requestId}-fg1` },
    { id: `${input.requestId}-fa2`, order: 2, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: `${input.requestId}-fg2` },
  ]
  return {
    requests: [{ id: input.requestId, title: input.title, status: input.requestStatus ?? 'Completed', requesterId: 'user-requester-a', createdAt: '2026-09-18T00:00:00Z', updatedAt: '2026-09-18T00:00:00Z' }],
    solutions: [{ id: input.solutionId, requestId: input.requestId, submittedById: 'user-engineer-a', title: `solution ${input.title}`, submittedAt: '2026-09-18T00:00:00Z' }],
    approvalInstances: [
      { id: `${input.requestId}-instance-request`, phase: 'REQUEST', requestId: input.requestId, solutionId: null, routeVersionId: 'all-defaults-request-default', originUserId: 'user-requester-a', state: 'APPROVED', attempt: 1, supersededAt: null, createdAt: '2026-09-18T00:00:00Z' },
      // Persisted linkage shape: SOLUTION instances carry requestId = null and
      // link via solutionId (locked by the earlier evaluator regressions).
      { id: `${input.requestId}-instance-solution`, phase: 'SOLUTION', requestId: null, solutionId: input.solutionId, routeVersionId: 'all-defaults-solution-default', originUserId: 'user-engineer-a', state: 'APPROVED', attempt: 1, supersededAt: null, createdAt: '2026-09-18T00:00:00Z' },
      ...(input.omitFinal ? [] : [
        { id: `${input.requestId}-instance-final`, phase: 'FINAL', requestId: input.requestId, solutionId: null, routeVersionId: input.finalRouteVersionId, originUserId: input.finalOrigin, state: 'APPROVED', attempt: 1, supersededAt: null, createdAt: '2026-09-18T00:00:00Z' },
      ]),
    ],
    candidateGroups: [
      ...requestSteps.map((step) => candidateGroup(step.candidateGroupId, `${input.requestId}-instance-request`, step.positionId, 'unit-company', step.candidateMembers ?? [step.approverId])),
      ...solutionSteps.map((step) => candidateGroup(step.candidateGroupId, `${input.requestId}-instance-solution`, step.positionId, 'unit-company', [step.approverId])),
      ...(input.omitFinal ? [] : finalSteps.map((step) => candidateGroup(step.candidateGroupId, `${input.requestId}-instance-final`, step.positionId, 'unit-company', [step.approverId]))),
    ],
    requestApprovals: [
      ...requestApprovalRows(`${input.requestId}-instance-request`, input.requestId, requestSteps, false),
      ...(input.omitFinal ? [] : requestApprovalRows(`${input.requestId}-instance-final`, input.requestId, finalSteps, true)),
    ],
    solutionApprovals: solutionApprovalRows(`${input.requestId}-instance-solution`, input.solutionId, solutionSteps),
    instanceSkips: [],
    requestActivities: [],
    routeVersions: ALL_DEFAULTS_ROUTES,
  }
}

/**
 * T09A premature-denial rows: default Request chain approved, solution
 * submitted but its FIRST step still pending, and NO FINAL instance anywhere
 * (denied/premature triggers must create no attempt). Steps mirror the
 * persisted shapes of the interrupted T03A run.
 */
function t09aPrematureRows(): DbEvidenceData {
  const requestId = 't09a-request'
  const solutionId = 't09a-solution'
  const requestSteps: StepRowInput[] = [
    { id: 't09a-ra1', order: 1, positionId: SUPERVISOR, approverId: 'user-supervisor-p', candidateGroupId: 't09a-rg1', candidateMembers: ['user-second-approver', 'user-supervisor-p'] },
    { id: 't09a-ra2', order: 2, positionId: SECTION_MANAGER, approverId: 'user-section-manager-p', candidateGroupId: 't09a-rg2' },
    { id: 't09a-ra3', order: 3, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't09a-rg3' },
  ]
  const solutionSteps: StepRowInput[] = [
    { id: 't09a-sa1', order: 1, positionId: SUPERVISOR, approverId: 'user-supervisor-e', candidateGroupId: 't09a-sg1', status: 'pending' },
    { id: 't09a-sa2', order: 2, positionId: SECTION_MANAGER, approverId: 'user-section-manager-e', candidateGroupId: 't09a-sg2', status: 'pending' },
    { id: 't09a-sa3', order: 3, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't09a-sg3', status: 'pending' },
  ]
  return {
    requests: [{ id: requestId, title: 'Business T09A 1789800000000-0001', status: 'DesignCostEstimationApproval', requesterId: 'user-requester-a', createdAt: '2026-09-18T00:00:00Z', updatedAt: '2026-09-18T00:00:00Z' }],
    solutions: [{ id: solutionId, requestId, submittedById: 'user-engineer-a', title: 'solution T09A', submittedAt: '2026-09-18T00:00:00Z' }],
    approvalInstances: [
      { id: 't09a-instance-request', phase: 'REQUEST', requestId, solutionId: null, routeVersionId: 'all-defaults-request-default', originUserId: 'user-requester-a', state: 'APPROVED', attempt: 1, supersededAt: null, createdAt: '2026-09-18T00:00:00Z' },
      { id: 't09a-instance-solution', phase: 'SOLUTION', requestId: null, solutionId, routeVersionId: 'all-defaults-solution-default', originUserId: 'user-engineer-a', state: 'PENDING', attempt: 1, supersededAt: null, createdAt: '2026-09-18T00:00:00Z' },
    ],
    candidateGroups: [
      ...requestSteps.map((step) => candidateGroup(step.candidateGroupId, 't09a-instance-request', step.positionId, 'unit-company', step.candidateMembers ?? [step.approverId])),
      ...solutionSteps.map((step) => candidateGroup(step.candidateGroupId, 't09a-instance-solution', step.positionId, 'unit-company', [step.approverId])),
    ],
    requestApprovals: requestApprovalRows('t09a-instance-request', requestId, requestSteps, false),
    solutionApprovals: solutionApprovalRows('t09a-instance-solution', solutionId, solutionSteps),
    instanceSkips: [],
    requestActivities: [],
    routeVersions: ALL_DEFAULTS_ROUTES,
  }
}

/**
 * Completed final-exception workflow (T10): default Request + Solution chains,
 * FINAL attempt on the Production 1 requester-origin replacement route
 * (Department manager only, scope unit-production-1-section).
 * `branch: 'company'` models the WRONG trigger-origin outcome: the attempt
 * routed over the trigger actor's parent/company branch — persisted as the
 * company-default route with the two default Final steps and company-scoped
 * candidate groups.
 */
function t10Workflow(input: { title: string; requestId: string; finalOrigin: string; branch: 'exception' | 'company' }): DbEvidenceData {
  const finalRouteVersionId = input.branch === 'exception' ? 'final-exception-final-exception' : 'final-exception-final-default'
  const finalSteps: StepRowInput[] = input.branch === 'exception'
    ? [
        { id: `${input.requestId}-fa1`, order: 1, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: `${input.requestId}-fg1` },
      ]
    : [
        { id: `${input.requestId}-fa1`, order: 1, positionId: SECTION_MANAGER, approverId: 'user-section-manager-p', candidateGroupId: `${input.requestId}-fg1` },
        { id: `${input.requestId}-fa2`, order: 2, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: `${input.requestId}-fg2` },
      ]
  const finalGroupScopeUnitId = input.branch === 'exception' ? 'unit-production-1-section' : 'unit-company'
  const data = t08Workflow({
    title: input.title,
    requestId: input.requestId,
    solutionId: `${input.requestId}-solution`,
    finalOrigin: input.finalOrigin,
    finalRouteVersionId,
  })
  // Request and Solution stay on the final-exception profile's company
  // defaults (only the FINAL phase is replaced in this profile).
  for (const instance of data.approvalInstances) {
    if (instance.phase === 'REQUEST') instance.routeVersionId = 'final-exception-request-default'
    if (instance.phase === 'SOLUTION') instance.routeVersionId = 'final-exception-solution-default'
  }
  // Replace the default-chain Final rows/groups with this branch's persisted
  // rows (the approval rows are always built from the SELECTED route).
  data.requestApprovals = [
    ...data.requestApprovals.filter((row) => row.instanceId !== `${input.requestId}-instance-final`),
    ...requestApprovalRows(`${input.requestId}-instance-final`, input.requestId, finalSteps, true),
  ]
  data.candidateGroups = [
    ...data.candidateGroups.filter((row) => row.approvalInstanceId !== `${input.requestId}-instance-final`),
    ...finalSteps.map((step) => candidateGroup(step.candidateGroupId, `${input.requestId}-instance-final`, step.positionId, finalGroupScopeUnitId, [step.approverId])),
  ]
  return data
}

/** T04A-shaped completed rows for the singleFinalAttempt denial proof. */
function t04aCompletedRows(): DbEvidenceData {
  return t08Workflow({ title: 'Business T04A 1789800000000-0002', requestId: 't04a-request', solutionId: 't04a-solution', finalOrigin: 'user-requester-a', finalRouteVersionId: 'all-defaults-final-default' })
}

// ---------------------------------------------------------------------------
// T08 — trigger succeeds for every authorized actor; origin stays the
// original requester; the Department-manager trigger must NOT be missing.
// ---------------------------------------------------------------------------

describe('db-evidence evaluator: T08 final-trigger authority (all-defaults)', () => {
  it('passes on the confirmed persisted shape: trigger succeeded, origin stays the original requester, default Final chain decided', () => {
    const checks = evaluateDefaultWorkflowEvidence(t08Workflow({ title: 'Business T08A 1789800000000-0010', requestId: 't08a-request', solutionId: 't08a-solution', finalOrigin: 'user-requester-a', finalRouteVersionId: 'all-defaults-final-default' }), 'all-defaults')
    const byName = checksByName(checks)

    assert.deepEqual(failures(checks), [])
    assert.equal(byName.get('db-evidence/Business T08A/final-origin')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T08A/final-origin')?.detail ?? '', /user-requester-a/)
    assert.equal(byName.get('db-evidence/Business T08A/final-route')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T08A/final-route')?.detail ?? '', /all-defaults-final-default/)
    assert.equal(byName.get('db-evidence/Business T08A/final-route-scope')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T08A/final-route-scope')?.detail ?? '', /unit-company/)
    assert.equal(byName.get('db-evidence/Business T08A/final-ordered-steps')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T08A/final-ordered-steps')?.detail ?? '', /position-section-manager → position-department-manager\]/)
    assert.equal(byName.get('db-evidence/Business T08A/final-captured-candidates')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T08A/final-flag-consistency')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T08A/terminal-status')?.status, 'pass')
  })

  it('FAILS when the persisted FINAL origin is the TRIGGER actor instead of the original requester (Staff B trigger)', () => {
    const data = t08Workflow({ title: 'Business T08B 1789800000000-0011', requestId: 't08b-request', solutionId: 't08b-solution', finalOrigin: 'user-staff-b', finalRouteVersionId: 'all-defaults-final-default' })
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults'))
    assert.equal(byName.get('db-evidence/Business T08B/final-origin')?.status, 'fail')
    assert.match(byName.get('db-evidence/Business T08B/final-origin')?.detail ?? '', /expected user-requester-a/)
    // The route/step shape itself is unchanged for a same-branch trigger:
    // only the origin exposes the deviation.
    assert.equal(byName.get('db-evidence/Business T08B/final-route')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T08B/final-ordered-steps')?.status, 'pass')
  })

  it('FAILS when the Final trigger is MISSING entirely (e.g. exact-origin-unit eligibility denied the Department manager)', () => {
    const data = t08Workflow({ title: 'Business T08E 1789800000000-0012', requestId: 't08e-request', solutionId: 't08e-solution', finalOrigin: 'user-requester-a', finalRouteVersionId: 'all-defaults-final-default', omitFinal: true, requestStatus: 'SendBackToRequester' })
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults'))
    assert.equal(byName.get('db-evidence/Business T08E/final-instance')?.status, 'fail')
    assert.match(byName.get('db-evidence/Business T08E/final-instance')?.detail ?? '', /no current FINAL approval instance/)
    assert.equal(byName.get('db-evidence/Business T08E/terminal-status')?.status, 'fail')
  })

  it('FAILS when the FINAL route leaks an exception chain into the all-defaults profile', () => {
    const data = t08Workflow({ title: 'Business T08C 1789800000000-0013', requestId: 't08c-request', solutionId: 't08c-solution', finalOrigin: 'user-requester-a', finalRouteVersionId: 'final-exception-final-exception' })
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults'))
    assert.equal(byName.get('db-evidence/Business T08C/final-route')?.status, 'fail')
    assert.equal(byName.get('db-evidence/Business T08C/final-route-scope')?.status, 'fail', 'the exception scope (unit-production-1-section) must not satisfy the company-default scope expectation')
  })

  it('still matches FINAL rows by instanceId and fails the separate flag audit on isFinalApproval=false (linkage semantics preserved)', () => {
    const data = t08Workflow({ title: 'Business T08D 1789800000000-0014', requestId: 't08d-request', solutionId: 't08d-solution', finalOrigin: 'user-requester-a', finalRouteVersionId: 'all-defaults-final-default' })
    for (const row of data.requestApprovals) {
      if (row.instanceId === 't08d-request-instance-final') row.isFinalApproval = false
    }
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults'))
    assert.equal(byName.get('db-evidence/Business T08D/final-flag-consistency')?.status, 'fail')
    assert.equal(byName.get('db-evidence/Business T08D/final-ordered-steps')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T08D/final-origin')?.status, 'pass')
  })
})

// ---------------------------------------------------------------------------
// T09 — premature denial leaves NO FINAL instance; post-Completed target keeps
// exactly one intact FINAL attempt.
// ---------------------------------------------------------------------------

describe('db-evidence evaluator: T09 denial proofs (all-defaults)', () => {
  it('passes the premature scenario with no FINAL instance and the unchanged Solution-stage status', () => {
    const checks = evaluateDefaultWorkflowEvidence(t09aPrematureRows(), 'all-defaults')
    const byName = checksByName(checks)

    assert.deepEqual(failures(checks), [])
    assert.equal(byName.get('db-evidence/Business T09A/no-final-instance')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T09A/no-final-instance')?.detail ?? '', /created no attempt/)
    assert.equal(byName.get('db-evidence/Business T09A/terminal-status')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T09A/terminal-status')?.detail ?? '', /DesignCostEstimationApproval/)
    assert.equal(byName.get('db-evidence/Business T09A/solution-pending-candidates')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T09A/solution-pending-candidates')?.detail ?? '', /user-supervisor-e/)
  })

  it('FAILS the no-final-instance proof when a denied/premature attempt nevertheless created a FINAL instance', () => {
    const data = t09aPrematureRows()
    data.approvalInstances.push({ id: 't09a-instance-final-rogue', phase: 'FINAL', requestId: 't09a-request', solutionId: null, routeVersionId: 'all-defaults-final-default', originUserId: 'user-staff-b', state: 'PENDING', attempt: 1, supersededAt: null, createdAt: '2026-09-18T00:00:00Z' })
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults'))
    assert.equal(byName.get('db-evidence/Business T09A/no-final-instance')?.status, 'fail')
    assert.match(byName.get('db-evidence/Business T09A/no-final-instance')?.detail ?? '', /unexpected FINAL approval instance/)
  })

  it('passes single-final-attempt on the intact completed target and FAILS on any extra/superseded attempt', () => {
    const intact = checksByName(evaluateDefaultWorkflowEvidence(t04aCompletedRows(), 'all-defaults'))
    assert.equal(intact.get('db-evidence/Business T04A/single-final-attempt')?.status, 'pass')
    assert.match(intact.get('db-evidence/Business T04A/single-final-attempt')?.detail ?? '', /exactly one FINAL approval instance/)

    const extraAttempt = t04aCompletedRows()
    extraAttempt.approvalInstances.push({ id: 't04a-instance-final-2', phase: 'FINAL', requestId: 't04a-request', solutionId: null, routeVersionId: 'all-defaults-final-default', originUserId: 'user-engineer-a', state: 'PENDING', attempt: 2, supersededAt: null, createdAt: '2026-09-18T00:01:00Z' })
    assert.equal(checksByName(evaluateDefaultWorkflowEvidence(extraAttempt, 'all-defaults')).get('db-evidence/Business T04A/single-final-attempt')?.status, 'fail')

    const supersededOnly = t04aCompletedRows()
    ;(supersededOnly.approvalInstances.find((row) => row.phase === 'FINAL') as { supersededAt: string | null }).supersededAt = '2026-09-18T00:02:00Z'
    assert.equal(checksByName(evaluateDefaultWorkflowEvidence(supersededOnly, 'all-defaults')).get('db-evidence/Business T04A/single-final-attempt')?.status, 'fail')
  })
})

// ---------------------------------------------------------------------------
// T10 — Final-origin routing stability across trigger actors on the
// distinguishable final-exception fixtures.
// ---------------------------------------------------------------------------

describe('db-evidence evaluator: T10 final-origin routing (final-exception)', () => {
  it('passes when every trigger actor keeps the original requester branch: exception route, exception scope, requester origin', () => {
    const data = t10Workflow({ title: 'Business T10A 1789800000000-0020', requestId: 't10a-request', finalOrigin: 'user-requester-a', branch: 'exception' })
    const checks = evaluateDefaultWorkflowEvidence(data, 'final-exception')
    const byName = checksByName(checks)

    assert.deepEqual(failures(checks), [])
    assert.equal(byName.get('db-evidence/Business T10A/final-route')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T10A/final-route')?.detail ?? '', /final-exception-final-exception/)
    assert.equal(byName.get('db-evidence/Business T10A/final-route-scope')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T10A/final-route-scope')?.detail ?? '', /unit-production-1-section/)
    assert.equal(byName.get('db-evidence/Business T10A/final-origin')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T10A/final-ordered-steps')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T10A/final-ordered-steps')?.detail ?? '', /\[position-department-manager\]/)
    assert.equal(byName.get('db-evidence/Business T10A/final-captured-candidates')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T10B')?.status, 'skipped')
    assert.equal(byName.get('db-evidence/Business T10C')?.status, 'skipped')
    assert.equal(byName.get('db-evidence/config/all-defaults')?.status, 'skipped')
  })

  it('FAILS on a trigger-actor origin for the Staff B trigger while the same-branch route stays intact', () => {
    const data = t10Workflow({ title: 'Business T10B 1789800000000-0021', requestId: 't10b-request', finalOrigin: 'user-staff-b', branch: 'exception' })
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'final-exception'))
    assert.equal(byName.get('db-evidence/Business T10B/final-origin')?.status, 'fail')
    assert.equal(byName.get('db-evidence/Business T10B/final-route')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T10B/final-ordered-steps')?.status, 'pass')
  })

  it('FAILS route id, persisted scope, ordered steps, approvers and candidates when the Department-manager trigger routes over the parent/company branch', () => {
    const data = t10Workflow({ title: 'Business T10C 1789800000000-0022', requestId: 't10c-request', finalOrigin: 'user-department-manager', branch: 'company' })
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'final-exception'))
    assert.equal(byName.get('db-evidence/Business T10C/final-origin')?.status, 'fail')
    assert.equal(byName.get('db-evidence/Business T10C/final-route')?.status, 'fail')
    assert.match(byName.get('db-evidence/Business T10C/final-route')?.detail ?? '', /expected final-exception-final-exception/)
    assert.equal(byName.get('db-evidence/Business T10C/final-route-scope')?.status, 'fail')
    assert.match(byName.get('db-evidence/Business T10C/final-route-scope')?.detail ?? '', /unit-company/)
    assert.equal(byName.get('db-evidence/Business T10C/final-ordered-steps')?.status, 'fail')
    assert.match(byName.get('db-evidence/Business T10C/final-ordered-steps')?.detail ?? '', /position-section-manager → position-department-manager/)
    assert.equal(byName.get('db-evidence/Business T10C/final-approvers')?.status, 'fail')
    assert.equal(byName.get('db-evidence/Business T10C/final-captured-candidates')?.status, 'fail')
  })

  it('records T10 scenarios of other profiles as cross-profile FAILURES and unexecuted ones as explicit skips', () => {
    const t10UnderDefaults = t10Workflow({ title: 'Business T10A 1789800000000-0023', requestId: 't10a-request', finalOrigin: 'user-requester-a', branch: 'exception' })
    const byName = checksByName(evaluateDefaultWorkflowEvidence(t10UnderDefaults, 'all-defaults'))
    assert.equal(byName.get('db-evidence/config/final-exception')?.status, 'fail')
    assert.match(byName.get('db-evidence/config/final-exception')?.detail ?? '', /cross-profile/)
    assert.equal(byName.get('db-evidence/Business T08A')?.status, 'skipped')

    const t08UnderExceptions = t08Workflow({ title: 'Business T08A 1789800000000-0024', requestId: 't08a-request', solutionId: 't08a-solution', finalOrigin: 'user-requester-a', finalRouteVersionId: 'all-defaults-final-default' })
    const byNameExceptions = checksByName(evaluateDefaultWorkflowEvidence(t08UnderExceptions, 'final-exception'))
    assert.equal(byNameExceptions.get('db-evidence/config/all-defaults')?.status, 'fail')
    assert.equal(byNameExceptions.get('db-evidence/Business T10A')?.status, 'skipped')
  })
})

describe('db-evidence capture title filter includes T10+', () => {
  it('uses Business T% so T10 titles are not dropped (T0% matched T01–T09 only)', () => {
    assert.equal(BUSINESS_REQUEST_TITLE_LIKE, 'Business T%')
    assert.notEqual(BUSINESS_REQUEST_TITLE_LIKE, 'Business T0%')
    assert.match('Business T10A 1', new RegExp('^' + BUSINESS_REQUEST_TITLE_LIKE.replace('%', '.*')))
    assert.match('Business T09A 1', new RegExp('^' + BUSINESS_REQUEST_TITLE_LIKE.replace('%', '.*')))
  })
})

describe('db-evidence evaluator: T03C unauthorized solution creates no row', () => {
  it('passes when Request is approved and no SOLUTION row exists', () => {
    const data: DbEvidenceData = {
      requests: [{ id: 't03c-request', title: 'Business T03C 1', status: 'SentToEngineer', requesterId: 'user-requester-a', createdAt: '2026-09-18T00:00:00Z', updatedAt: '2026-09-18T00:00:00Z' }],
      solutions: [],
      approvalInstances: [
        { id: 't03c-instance-request', phase: 'REQUEST', requestId: 't03c-request', solutionId: null, routeVersionId: 'all-defaults-request-default', originUserId: 'user-requester-a', state: 'APPROVED', attempt: 1, supersededAt: null, createdAt: '2026-09-18T00:00:00Z' },
      ],
      candidateGroups: [
        candidateGroup('t03c-rg1', 't03c-instance-request', SUPERVISOR, 'unit-company', ['user-second-approver', 'user-supervisor-p']),
        candidateGroup('t03c-rg2', 't03c-instance-request', SECTION_MANAGER, 'unit-company', ['user-section-manager-p']),
        candidateGroup('t03c-rg3', 't03c-instance-request', DEPARTMENT_MANAGER, 'unit-company', ['user-department-manager']),
      ],
      requestApprovals: requestApprovalRows('t03c-instance-request', 't03c-request', [
        { id: 't03c-ra1', order: 1, positionId: SUPERVISOR, approverId: 'user-supervisor-p', candidateGroupId: 't03c-rg1', candidateMembers: ['user-second-approver', 'user-supervisor-p'] },
        { id: 't03c-ra2', order: 2, positionId: SECTION_MANAGER, approverId: 'user-section-manager-p', candidateGroupId: 't03c-rg2' },
        { id: 't03c-ra3', order: 3, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't03c-rg3' },
      ], false),
      solutionApprovals: [],
      instanceSkips: [],
      requestActivities: [],
      routeVersions: ALL_DEFAULTS_ROUTES,
    }
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults'))
    assert.equal(byName.get('db-evidence/Business T03C/no-solution')?.status, 'pass')
  })

  it('FAILS when a SOLUTION row was persisted after the unauthorized attempts', () => {
    const data: DbEvidenceData = {
      requests: [{ id: 't03c-request', title: 'Business T03C 1', status: 'SentToEngineer', requesterId: 'user-requester-a', createdAt: '2026-09-18T00:00:00Z', updatedAt: '2026-09-18T00:00:00Z' }],
      solutions: [{ id: 'rogue', requestId: 't03c-request', submittedById: 'user-staff-b', title: 'rogue', submittedAt: '2026-09-18T00:00:00Z' }],
      approvalInstances: [
        { id: 't03c-instance-request', phase: 'REQUEST', requestId: 't03c-request', solutionId: null, routeVersionId: 'all-defaults-request-default', originUserId: 'user-requester-a', state: 'APPROVED', attempt: 1, supersededAt: null, createdAt: '2026-09-18T00:00:00Z' },
      ],
      candidateGroups: [
        candidateGroup('t03c-rg1', 't03c-instance-request', SUPERVISOR, 'unit-company', ['user-second-approver', 'user-supervisor-p']),
        candidateGroup('t03c-rg2', 't03c-instance-request', SECTION_MANAGER, 'unit-company', ['user-section-manager-p']),
        candidateGroup('t03c-rg3', 't03c-instance-request', DEPARTMENT_MANAGER, 'unit-company', ['user-department-manager']),
      ],
      requestApprovals: requestApprovalRows('t03c-instance-request', 't03c-request', [
        { id: 't03c-ra1', order: 1, positionId: SUPERVISOR, approverId: 'user-supervisor-p', candidateGroupId: 't03c-rg1', candidateMembers: ['user-second-approver', 'user-supervisor-p'] },
        { id: 't03c-ra2', order: 2, positionId: SECTION_MANAGER, approverId: 'user-section-manager-p', candidateGroupId: 't03c-rg2' },
        { id: 't03c-ra3', order: 3, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't03c-rg3' },
      ], false),
      solutionApprovals: [],
      instanceSkips: [],
      requestActivities: [],
      routeVersions: ALL_DEFAULTS_ROUTES,
    }
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults'))
    assert.equal(byName.get('db-evidence/Business T03C/no-solution')?.status, 'fail')
  })
})
