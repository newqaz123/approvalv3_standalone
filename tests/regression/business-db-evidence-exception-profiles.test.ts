import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateDefaultWorkflowEvidence,
  type DbEvidenceData,
  type DbEvidenceRow,
  type WorkflowCheck,
} from '../support/native/capture-workflow-db-evidence'

/**
 * Regression: the DB-evidence evaluator's UNIT-EXCEPTION route profiles
 * (T05 solution-exception, T06 final-exception, T07A/T07B
 * solution-and-final-exceptions) must evaluate the ACTUAL persisted linkage
 * shapes and FAIL on deliberately wrong scope/order/route — while skipped
 * profile coverage is recorded as an explicit SKIPPED status that is never
 * counted as Pass.
 *
 * Row fixtures are hand-authored literals mirroring the persisted shapes
 * grounded by the recorded runs (docs/superpowers/e2e-runs/
 * 2026-09-16-business-workflow/2026-09-18T00-50-03-182Z-full/db-evidence.json):
 *  - SOLUTION approval_instances persist requestId = null and link via
 *    solutionId -> solutions.requestId;
 *  - request_approvals rows belong to their owning instanceId, FINAL rows
    *  carry isFinalApproval = true (post plan.ts writer fix);
 *  - approval_candidate_groups persist scopeUnitId (unit-company for
 *    company-default steps) and their captured members;
 *  - approval_route_versions persist scopeUnitId + ordered steps.
 *
 * The fixtures deliberately do NOT derive from the evaluator's expectation
 * maps: the pass case proves no false negative against correct persisted
 * data, and each mutated case proves the corresponding check bites.
 */

const SUPERVISOR = 'position-supervisor'
const SECTION_MANAGER = 'position-section-manager'
const DEPARTMENT_MANAGER = 'position-department-manager'

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
  /** Captured candidate-group members (defaults to the deciding approver; the
   *  Production supervisor step captures two eligible holders). */
  candidateMembers?: string[]
}

function requestApprovalRows(instanceId: string, rows: StepRowInput[], isFinal: boolean): DbEvidenceRow[] {
  return rows.map((row) => ({
    id: row.id,
    requestId: 'request-shared',
    instanceId,
    order: row.order,
    status: 'approved',
    requiredPositionId: row.positionId,
    approverId: row.approverId,
    candidateGroupId: row.candidateGroupId,
    isFinalApproval: isFinal,
    approvedAt: '2026-09-18T00:00:00Z',
    createdAt: '2026-09-18T00:00:00Z',
  }))
}

function solutionApprovalRows(instanceId: string, rows: StepRowInput[]): DbEvidenceRow[] {
  return rows.map((row) => ({
    id: row.id,
    solutionId: 'solution-shared',
    instanceId,
    order: row.order,
    status: 'approved',
    requiredPositionId: row.positionId,
    approverId: row.approverId,
    candidateGroupId: row.candidateGroupId,
    approvedAt: '2026-09-18T00:00:00Z',
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

interface CompletedWorkflowInput {
  title: string
  requestId: string
  solutionId: string
  requestInstance: { id: string; origin: string; routeVersionId: string }
  requestSteps: StepRowInput[]
  requestGroupScopeUnitId: string
  solutionInstance: { id: string; origin: string; routeVersionId: string; submittedBy: string }
  solutionSteps: StepRowInput[]
  solutionGroupScopeUnitId: string
  finalInstance: { id: string; origin: string; routeVersionId: string }
  finalSteps: StepRowInput[]
  finalGroupScopeUnitId: string
}

/** Builds the persisted rows of one fully completed three-phase workflow. */
function completedWorkflow(input: CompletedWorkflowInput): Pick<
  DbEvidenceData,
  'requests' | 'solutions' | 'approvalInstances' | 'candidateGroups' | 'requestApprovals' | 'solutionApprovals' | 'instanceSkips' | 'requestActivities'
> {
  return {
    requests: [{ id: input.requestId, title: input.title, status: 'Completed', requesterId: input.requestInstance.origin, createdAt: '2026-09-18T00:00:00Z', updatedAt: '2026-09-18T00:00:00Z' }],
    solutions: [{ id: input.solutionId, requestId: input.requestId, submittedById: input.solutionInstance.submittedBy, title: `solution ${input.title}`, submittedAt: '2026-09-18T00:00:00Z' }],
    approvalInstances: [
      { id: input.requestInstance.id, phase: 'REQUEST', requestId: input.requestId, solutionId: null, routeVersionId: input.requestInstance.routeVersionId, originUserId: input.requestInstance.origin, state: 'APPROVED', attempt: 1, supersededAt: null, createdAt: '2026-09-18T00:00:00Z' },
      // Persisted linkage shape: SOLUTION instances carry requestId = null and
      // link via solutionId.
      { id: input.solutionInstance.id, phase: 'SOLUTION', requestId: null, solutionId: input.solutionId, routeVersionId: input.solutionInstance.routeVersionId, originUserId: input.solutionInstance.origin, state: 'APPROVED', attempt: 1, supersededAt: null, createdAt: '2026-09-18T00:00:00Z' },
      { id: input.finalInstance.id, phase: 'FINAL', requestId: input.requestId, solutionId: null, routeVersionId: input.finalInstance.routeVersionId, originUserId: input.finalInstance.origin, state: 'APPROVED', attempt: 1, supersededAt: null, createdAt: '2026-09-18T00:00:00Z' },
    ],
    candidateGroups: [
      ...input.requestSteps.map((step) => candidateGroup(step.candidateGroupId, input.requestInstance.id, step.positionId, input.requestGroupScopeUnitId, step.candidateMembers ?? [step.approverId])),
      ...input.solutionSteps.map((step) => candidateGroup(step.candidateGroupId, input.solutionInstance.id, step.positionId, input.solutionGroupScopeUnitId, step.candidateMembers ?? [step.approverId])),
      ...input.finalSteps.map((step) => candidateGroup(step.candidateGroupId, input.finalInstance.id, step.positionId, input.finalGroupScopeUnitId, step.candidateMembers ?? [step.approverId])),
    ],
    requestApprovals: [
      ...requestApprovalRows(input.requestInstance.id, input.requestSteps, false),
      ...requestApprovalRows(input.finalInstance.id, input.finalSteps, true),
    ],
    solutionApprovals: solutionApprovalRows(input.solutionInstance.id, input.solutionSteps),
    instanceSkips: [],
    requestActivities: [],
  }
}

function t05Workflow(): CompletedWorkflowInput {
  return {
    title: 'Business T05 1789700000000-0001',
    requestId: 't05-request',
    solutionId: 't05-solution',
    requestInstance: { id: 't05-instance-request', origin: 'user-requester-a', routeVersionId: 'solution-exception-request-default' },
    requestGroupScopeUnitId: 'unit-company',
    requestSteps: [
      { id: 't05-ra1', order: 1, positionId: SUPERVISOR, approverId: 'user-supervisor-p', candidateGroupId: 't05-rg1', candidateMembers: ['user-second-approver', 'user-supervisor-p'] },
      { id: 't05-ra2', order: 2, positionId: SECTION_MANAGER, approverId: 'user-section-manager-p', candidateGroupId: 't05-rg2' },
      { id: 't05-ra3', order: 3, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't05-rg3' },
    ],
    solutionInstance: { id: 't05-instance-solution', origin: 'user-engineer-a', routeVersionId: 'solution-exception-solution-exception', submittedBy: 'user-engineer-a' },
    solutionGroupScopeUnitId: 'unit-engineering-section',
    solutionSteps: [
      { id: 't05-sa1', order: 1, positionId: SECTION_MANAGER, approverId: 'user-section-manager-e', candidateGroupId: 't05-sg1' },
      { id: 't05-sa2', order: 2, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't05-sg2' },
    ],
    finalInstance: { id: 't05-instance-final', origin: 'user-requester-a', routeVersionId: 'solution-exception-final-default' },
    finalGroupScopeUnitId: 'unit-company',
    finalSteps: [
      { id: 't05-fa1', order: 1, positionId: SECTION_MANAGER, approverId: 'user-section-manager-p', candidateGroupId: 't05-fg1' },
      { id: 't05-fa2', order: 2, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't05-fg2' },
    ],
  }
}

function t06Workflow(): CompletedWorkflowInput {
  return {
    title: 'Business T06 1789700000000-0002',
    requestId: 't06-request',
    solutionId: 't06-solution',
    requestInstance: { id: 't06-instance-request', origin: 'user-requester-a', routeVersionId: 'final-exception-request-default' },
    requestGroupScopeUnitId: 'unit-company',
    requestSteps: [
      { id: 't06-ra1', order: 1, positionId: SUPERVISOR, approverId: 'user-supervisor-p', candidateGroupId: 't06-rg1', candidateMembers: ['user-second-approver', 'user-supervisor-p'] },
      { id: 't06-ra2', order: 2, positionId: SECTION_MANAGER, approverId: 'user-section-manager-p', candidateGroupId: 't06-rg2' },
      { id: 't06-ra3', order: 3, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't06-rg3' },
    ],
    solutionInstance: { id: 't06-instance-solution', origin: 'user-engineer-a', routeVersionId: 'final-exception-solution-default', submittedBy: 'user-engineer-a' },
    solutionGroupScopeUnitId: 'unit-company',
    solutionSteps: [
      { id: 't06-sa1', order: 1, positionId: SUPERVISOR, approverId: 'user-supervisor-e', candidateGroupId: 't06-sg1' },
      { id: 't06-sa2', order: 2, positionId: SECTION_MANAGER, approverId: 'user-section-manager-e', candidateGroupId: 't06-sg2' },
      { id: 't06-sa3', order: 3, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't06-sg3' },
    ],
    finalInstance: { id: 't06-instance-final', origin: 'user-requester-a', routeVersionId: 'final-exception-final-exception' },
    finalGroupScopeUnitId: 'unit-production-1-section',
    finalSteps: [
      { id: 't06-fa1', order: 1, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't06-fg1' },
    ],
  }
}

function t07aWorkflow(): CompletedWorkflowInput {
  return {
    title: 'Business T07A 1789700000000-0003',
    requestId: 't07a-request',
    solutionId: 't07a-solution',
    requestInstance: { id: 't07a-instance-request', origin: 'user-requester-a', routeVersionId: 'solution-and-final-exceptions-request-default' },
    requestGroupScopeUnitId: 'unit-company',
    requestSteps: [
      { id: 't07a-ra1', order: 1, positionId: SUPERVISOR, approverId: 'user-supervisor-p', candidateGroupId: 't07a-rg1', candidateMembers: ['user-second-approver', 'user-supervisor-p'] },
      { id: 't07a-ra2', order: 2, positionId: SECTION_MANAGER, approverId: 'user-section-manager-p', candidateGroupId: 't07a-rg2' },
      { id: 't07a-ra3', order: 3, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't07a-rg3' },
    ],
    solutionInstance: { id: 't07a-instance-solution', origin: 'user-engineer-a', routeVersionId: 'solution-and-final-exceptions-solution-exception', submittedBy: 'user-engineer-a' },
    solutionGroupScopeUnitId: 'unit-engineering-section',
    solutionSteps: [
      { id: 't07a-sa1', order: 1, positionId: SECTION_MANAGER, approverId: 'user-section-manager-e', candidateGroupId: 't07a-sg1' },
      { id: 't07a-sa2', order: 2, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't07a-sg2' },
    ],
    finalInstance: { id: 't07a-instance-final', origin: 'user-requester-a', routeVersionId: 'solution-and-final-exceptions-final-exception' },
    finalGroupScopeUnitId: 'unit-production-1-section',
    finalSteps: [
      { id: 't07a-fa1', order: 1, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't07a-fg1' },
    ],
  }
}

function t07bWorkflow(): CompletedWorkflowInput {
  return {
    title: 'Business T07B 1789700000000-0004',
    requestId: 't07b-request',
    solutionId: 't07b-solution',
    // Supervisor origin: the engine omits the Supervisor-rank step from the
    // snapshot entirely (orders keep the published 2,3 numbering).
    requestInstance: { id: 't07b-instance-request', origin: 'user-supervisor-p', routeVersionId: 'solution-and-final-exceptions-request-default' },
    requestGroupScopeUnitId: 'unit-company',
    requestSteps: [
      { id: 't07b-ra1', order: 2, positionId: SECTION_MANAGER, approverId: 'user-section-manager-p', candidateGroupId: 't07b-rg1' },
      { id: 't07b-ra2', order: 3, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't07b-rg2' },
    ],
    solutionInstance: { id: 't07b-instance-solution', origin: 'user-supervisor-e', routeVersionId: 'solution-and-final-exceptions-solution-exception', submittedBy: 'user-supervisor-e' },
    solutionGroupScopeUnitId: 'unit-engineering-section',
    solutionSteps: [
      { id: 't07b-sa1', order: 1, positionId: SECTION_MANAGER, approverId: 'user-section-manager-e', candidateGroupId: 't07b-sg1' },
      { id: 't07b-sa2', order: 2, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't07b-sg2' },
    ],
    finalInstance: { id: 't07b-instance-final', origin: 'user-supervisor-p', routeVersionId: 'solution-and-final-exceptions-final-exception' },
    finalGroupScopeUnitId: 'unit-production-1-section',
    finalSteps: [
      { id: 't07b-fa1', order: 1, positionId: DEPARTMENT_MANAGER, approverId: 'user-department-manager', candidateGroupId: 't07b-fg1' },
    ],
  }
}

function t05Data(): DbEvidenceData {
  return {
    ...completedWorkflow(t05Workflow()),
    routeVersions: [
      routeVersion('solution-exception-request-default', 'unit-company', 'REQUEST', [SUPERVISOR, SECTION_MANAGER, DEPARTMENT_MANAGER]),
      routeVersion('solution-exception-solution-default', 'unit-company', 'SOLUTION', [SUPERVISOR, SECTION_MANAGER, DEPARTMENT_MANAGER]),
      routeVersion('solution-exception-final-default', 'unit-company', 'FINAL', [SECTION_MANAGER, DEPARTMENT_MANAGER]),
      routeVersion('solution-exception-solution-exception', 'unit-engineering-section', 'SOLUTION', [SECTION_MANAGER, DEPARTMENT_MANAGER]),
    ],
  }
}

function t06Data(): DbEvidenceData {
  return {
    ...completedWorkflow(t06Workflow()),
    routeVersions: [
      routeVersion('final-exception-request-default', 'unit-company', 'REQUEST', [SUPERVISOR, SECTION_MANAGER, DEPARTMENT_MANAGER]),
      routeVersion('final-exception-solution-default', 'unit-company', 'SOLUTION', [SUPERVISOR, SECTION_MANAGER, DEPARTMENT_MANAGER]),
      routeVersion('final-exception-final-default', 'unit-company', 'FINAL', [SECTION_MANAGER, DEPARTMENT_MANAGER]),
      routeVersion('final-exception-final-exception', 'unit-production-1-section', 'FINAL', [DEPARTMENT_MANAGER]),
    ],
  }
}

function t07Data(): DbEvidenceData {
  const a = completedWorkflow(t07aWorkflow())
  const b = completedWorkflow(t07bWorkflow())
  return {
    requests: [...a.requests, ...b.requests],
    solutions: [...a.solutions, ...b.solutions],
    approvalInstances: [...a.approvalInstances, ...b.approvalInstances],
    candidateGroups: [...a.candidateGroups, ...b.candidateGroups],
    requestApprovals: [...a.requestApprovals, ...b.requestApprovals],
    solutionApprovals: [...a.solutionApprovals, ...b.solutionApprovals],
    instanceSkips: [],
    requestActivities: [],
    routeVersions: [
      routeVersion('solution-and-final-exceptions-request-default', 'unit-company', 'REQUEST', [SUPERVISOR, SECTION_MANAGER, DEPARTMENT_MANAGER]),
      routeVersion('solution-and-final-exceptions-solution-default', 'unit-company', 'SOLUTION', [SUPERVISOR, SECTION_MANAGER, DEPARTMENT_MANAGER]),
      routeVersion('solution-and-final-exceptions-final-default', 'unit-company', 'FINAL', [SECTION_MANAGER, DEPARTMENT_MANAGER]),
      routeVersion('solution-and-final-exceptions-solution-exception', 'unit-engineering-section', 'SOLUTION', [SECTION_MANAGER, DEPARTMENT_MANAGER]),
      routeVersion('solution-and-final-exceptions-final-exception', 'unit-production-1-section', 'FINAL', [DEPARTMENT_MANAGER]),
    ],
  }
}

// ---------------------------------------------------------------------------
// T05 — solution-exception profile
// ---------------------------------------------------------------------------

describe('db-evidence evaluator: solution-exception profile (T05)', () => {
  it('passes on the correct persisted rows and never counts skipped profiles as pass', () => {
    const checks = evaluateDefaultWorkflowEvidence(t05Data(), 'solution-exception')
    const byName = checksByName(checks)

    assert.deepEqual(failures(checks), [])
    assert.equal(byName.get('db-evidence/Business T05/solution-route')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T05/solution-route')?.detail ?? '', /solution-exception-solution-exception/)
    assert.equal(byName.get('db-evidence/Business T05/solution-route-scope')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T05/solution-route-scope')?.detail ?? '', /unit-engineering-section/)
    assert.equal(byName.get('db-evidence/Business T05/solution-ordered-steps')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T05/solution-ordered-steps')?.detail ?? '', /position-section-manager → position-department-manager\]/)
    assert.equal(byName.get('db-evidence/Business T05/solution-captured-candidates')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T05/final-route')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T05/final-route')?.detail ?? '', /solution-exception-final-default/)
    assert.equal(byName.get('db-evidence/Business T05/final-route-scope')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T05/request-route-scope')?.status, 'pass')

    // Skipped profile entries are explicit and are NOT passes.
    for (const other of ['all-defaults', 'final-exception', 'solution-and-final-exceptions']) {
      assert.equal(byName.get(`db-evidence/config/${other}`)?.status, 'skipped')
      assert.match(byName.get(`db-evidence/config/${other}`)?.detail ?? '', /NOT counted as coverage/)
    }
  })

  it('fails when the SOLUTION instance points at the company default route instead of the unit exception', () => {
    const data = t05Data()
    const instance = data.approvalInstances.find((row) => row.phase === 'SOLUTION')
    instance!.routeVersionId = 'solution-exception-solution-default'
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'solution-exception'))
    assert.equal(byName.get('db-evidence/Business T05/solution-route')?.status, 'fail')
    assert.equal(byName.get('db-evidence/Business T05/solution-route-scope')?.status, 'fail', 'default route scope (unit-company) must not satisfy the exception scope expectation')
  })

  it('fails when the unit exception route version is persisted with the wrong scope', () => {
    const data = t05Data()
    const route = data.routeVersions.find((row) => row.id === 'solution-exception-solution-exception')
    route!.scopeUnitId = 'unit-company'
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'solution-exception'))
    assert.equal(byName.get('db-evidence/Business T05/solution-route-scope')?.status, 'fail')
  })

  it('fails when the replaced SOLUTION steps are in the wrong order', () => {
    const data = t05Data()
    // Swap the persisted order values: Department manager before Section manager.
    const rows = data.solutionApprovals
    ;(rows[0] as { order: number }).order = 2
    ;(rows[1] as { order: number }).order = 1
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'solution-exception'))
    assert.equal(byName.get('db-evidence/Business T05/solution-ordered-steps')?.status, 'fail')
  })

  it('fails when the default Supervisor step is appended to (instead of replaced by) the replacement chain', () => {
    const data = t05Data()
    data.solutionApprovals.push({
      id: 't05-sa0',
      solutionId: 't05-solution',
      instanceId: 't05-instance-solution',
      order: 0,
      status: 'approved',
      requiredPositionId: SUPERVISOR,
      approverId: 'user-supervisor-e',
      candidateGroupId: 't05-sg0',
    })
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'solution-exception'))
    assert.equal(byName.get('db-evidence/Business T05/solution-ordered-steps')?.status, 'fail')
    assert.match(byName.get('db-evidence/Business T05/solution-ordered-steps')?.detail ?? '', /position-supervisor → position-section-manager → position-department-manager/)
  })

  it('fails when the solution exception leaks into the FINAL phase', () => {
    const data = t05Data()
    const instance = data.approvalInstances.find((row) => row.phase === 'FINAL')
    instance!.routeVersionId = 'solution-exception-solution-exception'
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'solution-exception'))
    assert.equal(byName.get('db-evidence/Business T05/final-route')?.status, 'fail')
  })

  it('still audits the FINAL isFinalApproval flag in exception profiles (corrected linkage semantics preserved)', () => {
    const data = t05Data()
    for (const row of data.requestApprovals) {
      if (row.instanceId === 't05-instance-final') row.isFinalApproval = false
    }
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'solution-exception'))
    assert.equal(byName.get('db-evidence/Business T05/final-flag-consistency')?.status, 'fail')
    // Rows are still evaluated via instanceId despite the flag inconsistency.
    assert.equal(byName.get('db-evidence/Business T05/final-ordered-steps')?.status, 'pass')
  })

  it('fails when a captured candidate group holds the wrong member or wrong scope', () => {
    const wrongMember = t05Data()
    ;(wrongMember.candidateGroups.find((row) => row.id === 't05-sg1')!.members as Array<{ userId: string }>)[0] = { userId: 'user-supervisor-e' }
    assert.equal(
      checksByName(evaluateDefaultWorkflowEvidence(wrongMember, 'solution-exception')).get('db-evidence/Business T05/solution-captured-candidates')?.status,
      'fail',
    )

    const wrongScope = t05Data()
    wrongScope.candidateGroups.find((row) => row.id === 't05-sg1')!.scopeUnitId = 'unit-company'
    assert.equal(
      checksByName(evaluateDefaultWorkflowEvidence(wrongScope, 'solution-exception')).get('db-evidence/Business T05/solution-captured-candidates')?.status,
      'fail',
    )
  })
})

// ---------------------------------------------------------------------------
// T06 — final-exception profile
// ---------------------------------------------------------------------------

describe('db-evidence evaluator: final-exception profile (T06)', () => {
  it('passes on the correct persisted rows: Department manager alone decides Final, other phases default', () => {
    const checks = evaluateDefaultWorkflowEvidence(t06Data(), 'final-exception')
    const byName = checksByName(checks)

    assert.deepEqual(failures(checks), [])
    assert.equal(byName.get('db-evidence/Business T06/final-route')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T06/final-route')?.detail ?? '', /final-exception-final-exception/)
    assert.equal(byName.get('db-evidence/Business T06/final-route-scope')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T06/final-route-scope')?.detail ?? '', /unit-production-1-section/)
    assert.equal(byName.get('db-evidence/Business T06/final-ordered-steps')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T06/final-ordered-steps')?.detail ?? '', /\[position-department-manager\]/)
    assert.equal(byName.get('db-evidence/Business T06/final-approvers')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T06/solution-route')?.status, 'pass')
    assert.match(byName.get('db-evidence/Business T06/solution-route')?.detail ?? '', /final-exception-solution-default/)
  })

  it('fails when the default Section manager step is appended to the replaced Final chain', () => {
    const data = t06Data()
    data.requestApprovals.push({
      id: 't06-fa0',
      requestId: 't06-request',
      instanceId: 't06-instance-final',
      order: 0,
      status: 'approved',
      requiredPositionId: SECTION_MANAGER,
      approverId: 'user-section-manager-p',
      candidateGroupId: 't06-fg0',
      isFinalApproval: true,
    })
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'final-exception'))
    assert.equal(byName.get('db-evidence/Business T06/final-ordered-steps')?.status, 'fail')
    assert.equal(byName.get('db-evidence/Business T06/final-approvers')?.status, 'fail')
  })

  it('fails on a wrong FINAL origin (trigger actor must not replace the original requester branch)', () => {
    const data = t06Data()
    data.approvalInstances.find((row) => row.phase === 'FINAL')!.originUserId = 'user-staff-b'
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'final-exception'))
    assert.equal(byName.get('db-evidence/Business T06/final-origin')?.status, 'fail')
  })
})

// ---------------------------------------------------------------------------
// T07A/T07B — solution-and-final-exceptions profile
// ---------------------------------------------------------------------------

describe('db-evidence evaluator: solution-and-final-exceptions profile (T07A/T07B)', () => {
  it('passes on both fresh workflows, including the supervisor-origin rank omission', () => {
    const checks = evaluateDefaultWorkflowEvidence(t07Data(), 'solution-and-final-exceptions')
    const byName = checksByName(checks)

    assert.deepEqual(failures(checks), [])
    for (const prefix of ['Business T07A', 'Business T07B']) {
      assert.equal(byName.get(`db-evidence/${prefix}/solution-route`)?.status, 'pass')
      assert.equal(byName.get(`db-evidence/${prefix}/solution-route-scope`)?.status, 'pass')
      assert.equal(byName.get(`db-evidence/${prefix}/final-route`)?.status, 'pass')
      assert.equal(byName.get(`db-evidence/${prefix}/final-route-scope`)?.status, 'pass')
      assert.equal(byName.get(`db-evidence/${prefix}/terminal-status`)?.status, 'pass')
    }
    // T07B supervisor origin: REQUEST chain omits the Supervisor rank entirely.
    assert.match(byName.get('db-evidence/Business T07B/request-ordered-steps')?.detail ?? '', /position-section-manager → position-department-manager\]/)
    assert.equal(byName.get('db-evidence/Business T07B/solution-origin')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T07B/final-origin')?.status, 'pass')
  })

  it('fails when the supervisor-origin REQUEST snapshot keeps the originator rank (self-approval)', () => {
    const data = t07Data()
    data.requestApprovals.push({
      id: 't07b-ra0',
      requestId: 't07b-request',
      instanceId: 't07b-instance-request',
      order: 1,
      status: 'approved',
      requiredPositionId: SUPERVISOR,
      approverId: 'user-supervisor-p',
      candidateGroupId: 't07b-rg0',
      isFinalApproval: false,
    })
    const byName = checksByName(evaluateDefaultWorkflowEvidence(data, 'solution-and-final-exceptions'))
    assert.equal(byName.get('db-evidence/Business T07B/request-ordered-steps')?.status, 'fail')
    assert.equal(byName.get('db-evidence/Business T07B/request-approvers')?.status, 'fail')
  })
})

// ---------------------------------------------------------------------------
// Profile selection / skipped-coverage semantics
// ---------------------------------------------------------------------------

describe('db-evidence evaluator: profile selection and skipped coverage', () => {
  it('records a scenario of another profile as cross-profile FAILURE, not as pass or skip', () => {
    // T05 rows captured while the evaluator runs the final-exception profile:
    // the T05 scenario belongs to solution-exception and must not execute here.
    const checks = evaluateDefaultWorkflowEvidence(t05Data(), 'final-exception')
    const byName = checksByName(checks)

    assert.equal(byName.get('db-evidence/config/solution-exception')?.status, 'fail')
    assert.match(byName.get('db-evidence/config/solution-exception')?.detail ?? '', /cross-profile/)
    assert.equal(byName.get('db-evidence/config/all-defaults')?.status, 'skipped')
    assert.equal(byName.get('db-evidence/config/solution-and-final-exceptions')?.status, 'skipped')
    // The T06 scenario itself was not executed in this run → explicit skip.
    assert.equal(byName.get('db-evidence/Business T06')?.status, 'skipped')
    assert.match(byName.get('db-evidence/Business T06')?.detail ?? '', /no coverage claimed/)
  })

  it('records every scenario as skipped (never pass) when nothing executed', () => {
    const empty: DbEvidenceData = {
      requests: [], solutions: [], approvalInstances: [], candidateGroups: [],
      requestApprovals: [], solutionApprovals: [], instanceSkips: [], routeVersions: [], requestActivities: [],
    }
    const checks = evaluateDefaultWorkflowEvidence(empty, 'solution-and-final-exceptions')
    const byName = checksByName(checks)
    assert.equal(byName.get('db-evidence/Business T07A')?.status, 'skipped')
    assert.equal(byName.get('db-evidence/Business T07B')?.status, 'skipped')
    assert.equal(failures(checks).length, 0)
  })

  it('throws on an unknown route configuration name', () => {
    assert.throws(() => evaluateDefaultWorkflowEvidence(t05Data(), 'named-person-chains'), /unknown route configuration/)
  })
})
