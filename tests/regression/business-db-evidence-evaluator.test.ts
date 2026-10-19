import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  evaluateDefaultWorkflowEvidence,
  type DbEvidenceData,
  type DbEvidenceRow,
  type WorkflowCheck,
} from '../support/native/capture-workflow-db-evidence'

/**
 * Regression: the DB-evidence evaluator must not produce FALSE NEGATIVES from
 * the persisted linkage shape, and must surface the product's
 * isFinalApproval flag inconsistency instead of hiding it.
 *
 * Grounded in the PRESERVED raw rows of run
 * docs/superpowers/e2e-runs/2026-09-16-business-workflow/2026-09-17T23-26-39-677Z-full
 * (db-evidence.json, business-test-20260917t232639-bda5b5b1). Two evaluator
 * bugs in that run misreported persisted truth:
 *
 *  (1) SOLUTION instances persist requestId = null and link via
 *      solutionId -> solutions.requestId; the evaluator matched by requestId,
 *      never found the instance, and short-circuited EVERY solution-chain
 *      assertion ("no current SOLUTION approval instance persisted").
 *  (2) FINAL-phase request_approvals rows are persisted with
 *      isFinalApproval = false; the evaluator selected FINAL rows with a
 *      `.filter(isFinalApproval === true)` and saw `[]` even though both
 *      ordered rows exist.
 *
 * Bug (2) also exposed a PRODUCT inconsistency (the flag is false on FINAL
 * rows while every FINAL-phase consumer — capability lookup, decision
 * transaction adapter, final-approver notifications — requires true). The
 * corrected evaluator therefore evaluates rows by owning instanceId and
 * audits the flag via a SEPARATE explicit check so the inconsistency FAILS
 * visibly. These tests lock all three behaviours using the exact saved rows.
 */

const RUN_DIR = path.resolve(
  process.cwd(),
  'docs/superpowers/e2e-runs/2026-09-16-business-workflow/2026-09-17T23-26-39-677Z-full',
)
const SAVED_CAPTURE = path.join(RUN_DIR, 'db-evidence.json')

function checksByName(checks: WorkflowCheck[]): Map<string, WorkflowCheck> {
  return new Map(checks.map((check) => [check.name, check]))
}

// ---------------------------------------------------------------------------
// Exact raw-row extracts from the saved capture (ids and values verbatim).
// ---------------------------------------------------------------------------

/** T03A rows (request c6b1eebf…, solution 2e8ff564…, SOLUTION instance 59ca8137…). */
function t03aSavedRows(): DbEvidenceData {
  const requestTitle = 'Business T03A 1789687654429-8876'
  return {
    requests: [
      { id: 'c6b1eebf-de75-420e-8c2d-f5ce7b7290ab', title: requestTitle, status: 'DesignCostEstimationApproval' },
    ],
    solutions: [
      { id: '2e8ff564-2e18-407f-8945-47c9a3c4a853', requestId: 'c6b1eebf-de75-420e-8c2d-f5ce7b7290ab', submittedById: 'user-engineer-a' },
    ],
    approvalInstances: [
      // REQUEST instance: linked by requestId (verbatim saved row).
      { id: '07e2fb8a-1a21-4d70-bec8-286d4e2340d5', phase: 'REQUEST', requestId: 'c6b1eebf-de75-420e-8c2d-f5ce7b7290ab', solutionId: null, routeVersionId: 'all-defaults-request-default', originUserId: 'user-requester-a', state: 'APPROVED', attempt: 1, supersededAt: null },
      // SOLUTION instance: requestId NULL, linked via solutionId (the linkage
      // shape the original evaluator failed to match).
      { id: '59ca8137-8fde-4a78-927a-419a87b8982f', phase: 'SOLUTION', requestId: null, solutionId: '2e8ff564-2e18-407f-8945-47c9a3c4a853', routeVersionId: 'all-defaults-solution-default', originUserId: 'user-engineer-a', state: 'PENDING', attempt: 1, supersededAt: null },
    ],
    candidateGroups: [
      { id: 'df6f0dda', approvalInstanceId: '59ca8137-8fde-4a78-927a-419a87b8982f', requiredPositionId: 'position-supervisor', members: [{ userId: 'user-supervisor-e', name: 'Supervisor E' }] },
      { id: '8ca4a826', approvalInstanceId: '59ca8137-8fde-4a78-927a-419a87b8982f', requiredPositionId: 'position-section-manager', members: [{ userId: 'user-section-manager-e', name: 'Section Manager E' }] },
      { id: 'abe2d4ec', approvalInstanceId: '59ca8137-8fde-4a78-927a-419a87b8982f', requiredPositionId: 'position-department-manager', members: [{ userId: 'user-department-manager', name: 'Department Manager' }] },
      { id: 'f453b49f', approvalInstanceId: '07e2fb8a-1a21-4d70-bec8-286d4e2340d5', requiredPositionId: 'position-supervisor', members: [{ userId: 'user-supervisor-p', name: 'Supervisor P' }] },
      { id: 'a1c35e9d', approvalInstanceId: '07e2fb8a-1a21-4d70-bec8-286d4e2340d5', requiredPositionId: 'position-section-manager', members: [{ userId: 'user-section-manager-p', name: 'Section Manager P' }] },
      { id: '2030b795', approvalInstanceId: '07e2fb8a-1a21-4d70-bec8-286d4e2340d5', requiredPositionId: 'position-department-manager', members: [{ userId: 'user-department-manager', name: 'Department Manager' }] },
    ],
    requestApprovals: [
      { id: '0a2c1e23-d806-4290-b2ff-9b1739231ca3', requestId: 'c6b1eebf-de75-420e-8c2d-f5ce7b7290ab', instanceId: '07e2fb8a-1a21-4d70-bec8-286d4e2340d5', order: 1, status: 'approved', requiredPositionId: 'position-supervisor', approverId: 'user-supervisor-p', isFinalApproval: false },
      { id: '7c67c50c-bd71-4f5b-abaf-998ae12e4712', requestId: 'c6b1eebf-de75-420e-8c2d-f5ce7b7290ab', instanceId: '07e2fb8a-1a21-4d70-bec8-286d4e2340d5', order: 2, status: 'approved', requiredPositionId: 'position-section-manager', approverId: 'user-section-manager-p', isFinalApproval: false },
      { id: 'd98b7778-4041-4064-9492-ce32c64e0230', requestId: 'c6b1eebf-de75-420e-8c2d-f5ce7b7290ab', instanceId: '07e2fb8a-1a21-4d70-bec8-286d4e2340d5', order: 3, status: 'approved', requiredPositionId: 'position-department-manager', approverId: 'user-department-manager', isFinalApproval: false },
    ],
    solutionApprovals: [
      { id: '643449b9-ab19-4bf3-9f86-50231ced7edc', solutionId: '2e8ff564-2e18-407f-8945-47c9a3c4a853', instanceId: '59ca8137-8fde-4a78-927a-419a87b8982f', order: 1, status: 'pending', requiredPositionId: 'position-supervisor', candidateGroupId: 'df6f0dda' },
      { id: '16905940-7a87-45ae-a786-f8f3aa92cb2c', solutionId: '2e8ff564-2e18-407f-8945-47c9a3c4a853', instanceId: '59ca8137-8fde-4a78-927a-419a87b8982f', order: 2, status: 'pending', requiredPositionId: 'position-section-manager', candidateGroupId: '8ca4a826' },
      { id: '1c9cc004-37d1-4dc9-9fb3-596db7a2d2a1', solutionId: '2e8ff564-2e18-407f-8945-47c9a3c4a853', instanceId: '59ca8137-8fde-4a78-927a-419a87b8982f', order: 3, status: 'pending', requiredPositionId: 'position-department-manager', candidateGroupId: 'abe2d4ec' },
    ],
    instanceSkips: [],
    routeVersions: [],
    requestActivities: [],
  }
}

/** T04A rows (request 4194b663…, FINAL instance 872aaef5… with isFinalApproval=false rows). */
function t04aSavedRows(): DbEvidenceData {
  const requestTitle = 'Business T04A 1789687692981-1917'
  return {
    requests: [
      { id: '4194b663-818c-4be7-a740-a45cbb1fb404', title: requestTitle, status: 'FinalApproval' },
    ],
    solutions: [
      { id: '344e6c77-c009-4d59-aa81-203c472ea49d', requestId: '4194b663-818c-4be7-a740-a45cbb1fb404', submittedById: 'user-engineer-a' },
    ],
    approvalInstances: [
      { id: '763a9450-9523-4510-b083-3fbea00bdcce', phase: 'REQUEST', requestId: '4194b663-818c-4be7-a740-a45cbb1fb404', solutionId: null, routeVersionId: 'all-defaults-request-default', originUserId: 'user-requester-a', state: 'APPROVED', attempt: 1, supersededAt: null },
      { id: 'c38ac88f-36d6-450a-99c6-d6bc2602d1b8', phase: 'SOLUTION', requestId: null, solutionId: '344e6c77-c009-4d59-aa81-203c472ea49d', routeVersionId: 'all-defaults-solution-default', originUserId: 'user-engineer-a', state: 'APPROVED', attempt: 1, supersededAt: null },
      { id: '872aaef5-2d05-42de-b0f6-e59b671ad0ab', phase: 'FINAL', requestId: '4194b663-818c-4be7-a740-a45cbb1fb404', solutionId: null, routeVersionId: 'all-defaults-final-default', originUserId: 'user-requester-a', state: 'PENDING', attempt: 1, supersededAt: null },
    ],
    candidateGroups: [
      { id: 'c779b024', approvalInstanceId: '872aaef5-2d05-42de-b0f6-e59b671ad0ab', requiredPositionId: 'position-section-manager', members: [{ userId: 'user-section-manager-p', name: 'Section Manager P' }] },
      { id: '2659d6a5', approvalInstanceId: '872aaef5-2d05-42de-b0f6-e59b671ad0ab', requiredPositionId: 'position-department-manager', members: [{ userId: 'user-department-manager', name: 'Department Manager' }] },
    ],
    requestApprovals: [
      { id: '8d84488b-5d7f-4e81-ac2b-96032a672f5d', requestId: '4194b663-818c-4be7-a740-a45cbb1fb404', instanceId: '763a9450-9523-4510-b083-3fbea00bdcce', order: 1, status: 'approved', requiredPositionId: 'position-supervisor', approverId: 'user-supervisor-p', isFinalApproval: false },
      { id: '0a9ea1ad-6408-46e1-98d5-be72617de012', requestId: '4194b663-818c-4be7-a740-a45cbb1fb404', instanceId: '763a9450-9523-4510-b083-3fbea00bdcce', order: 2, status: 'approved', requiredPositionId: 'position-section-manager', approverId: 'user-section-manager-p', isFinalApproval: false },
      { id: '97d5815a-c126-4c9d-bf6a-487d41b64b44', requestId: '4194b663-818c-4be7-a740-a45cbb1fb404', instanceId: '763a9450-9523-4510-b083-3fbea00bdcce', order: 3, status: 'approved', requiredPositionId: 'position-department-manager', approverId: 'user-department-manager', isFinalApproval: false },
      // FINAL-phase rows: persisted with isFinalApproval = FALSE (verbatim
      // saved values — the product flag inconsistency under test).
      { id: '214c9b8d-4a5d-4aa0-8b8e-ca615a0d2d22', requestId: '4194b663-818c-4be7-a740-a45cbb1fb404', instanceId: '872aaef5-2d05-42de-b0f6-e59b671ad0ab', order: 1, status: 'pending', requiredPositionId: 'position-section-manager', candidateGroupId: 'c779b024', isFinalApproval: false },
      { id: 'bc91f115-efd9-4b39-a81f-f11e6bc41ffd', requestId: '4194b663-818c-4be7-a740-a45cbb1fb404', instanceId: '872aaef5-2d05-42de-b0f6-e59b671ad0ab', order: 2, status: 'pending', requiredPositionId: 'position-department-manager', candidateGroupId: '2659d6a5', isFinalApproval: false },
    ],
    solutionApprovals: [
      { id: 'dd59bbc2-5a40-4f83-af7c-9c41b1767931', solutionId: '344e6c77-c009-4d59-aa81-203c472ea49d', instanceId: 'c38ac88f-36d6-450a-99c6-d6bc2602d1b8', order: 1, status: 'approved', requiredPositionId: 'position-supervisor', approverId: 'user-supervisor-e' },
      { id: 'e7b0aa89-2d04-457a-83f3-a8c15ea32068', solutionId: '344e6c77-c009-4d59-aa81-203c472ea49d', instanceId: 'c38ac88f-36d6-450a-99c6-d6bc2602d1b8', order: 2, status: 'approved', requiredPositionId: 'position-section-manager', approverId: 'user-section-manager-e' },
      { id: 'c20dc6ba-806d-4b34-bc18-7617fa02309e', solutionId: '344e6c77-c009-4d59-aa81-203c472ea49d', instanceId: 'c38ac88f-36d6-450a-99c6-d6bc2602d1b8', order: 3, status: 'approved', requiredPositionId: 'position-department-manager', approverId: 'user-department-manager' },
    ],
    instanceSkips: [],
    routeVersions: [],
    requestActivities: [],
  }
}

// ---------------------------------------------------------------------------
// Bug 1 — SOLUTION instance linkage via solutionId (requestId persisted null)
// ---------------------------------------------------------------------------

describe('db-evidence evaluator: SOLUTION instances link via solutionId, not requestId', () => {
  it('finds the persisted SOLUTION instance (requestId null) and runs the full solution chain against its rows', () => {
    const checks = evaluateDefaultWorkflowEvidence(t03aSavedRows(), 'all-defaults')
    const byName = checksByName(checks)

    // The original false negative: this check must no longer exist as a failure.
    const solutionInstance = byName.get('db-evidence/Business T03A/solution-instance')
    assert.equal(solutionInstance, undefined, 'solution instance must be FOUND via solutionId, not reported missing')

    assert.equal(byName.get('db-evidence/Business T03A/solution-route')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T03A/solution-origin')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T03A/solution-ordered-steps')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T03A/solution-pending-candidates')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T03A/terminal-status')?.status, 'pass')
  })

  it('does not execute solution assertions at all when no solution exists for the request', () => {
    const data = t03aSavedRows()
    data.solutions = []
    const checks = evaluateDefaultWorkflowEvidence(data, 'all-defaults')
    const solutionInstance = checksByName(checks).get('db-evidence/Business T03A/solution-instance')
    assert.equal(solutionInstance?.status, 'fail', 'missing solution must remain an explicit failure, never a silent skip')
  })
})

describe('db-evidence evaluator: vacant skips stay on the request that owns them', () => {
  it('does not blame a solution-less request for another request\'s empty-solutionId skips', () => {
    const data = t03aSavedRows()
    data.solutions = []
    data.instanceSkips = [
      {
        approvalInstanceId: 'foreign-vacant-instance',
        requiredPositionId: 'position-supervisor',
        reason: 'VACANT_POSITION',
      },
    ]
    data.approvalInstances.push({
      id: 'foreign-vacant-instance',
      phase: 'REQUEST',
      requestId: 'another-request',
      solutionId: null,
      routeVersionId: 'all-defaults-request-default',
      originUserId: 'user-requester-a',
      state: 'PENDING',
      attempt: 1,
      supersededAt: null,
    })
    const checks = evaluateDefaultWorkflowEvidence(data, 'all-defaults')
    assert.equal(
      checksByName(checks).get('db-evidence/Business T03A/no-vacant-skips')?.status,
      'pass',
    )
  })

  it('still fails when the skip belongs to the request under test', () => {
    const data = t03aSavedRows()
    data.solutions = []
    data.instanceSkips = [
      {
        approvalInstanceId: '07e2fb8a-1a21-4d70-bec8-286d4e2340d5',
        requiredPositionId: 'position-supervisor',
        reason: 'VACANT_POSITION',
      },
    ]
    const checks = evaluateDefaultWorkflowEvidence(data, 'all-defaults')
    assert.equal(
      checksByName(checks).get('db-evidence/Business T03A/no-vacant-skips')?.status,
      'fail',
    )
  })
})

// ---------------------------------------------------------------------------
// Bug 2 — FINAL rows are evaluated by instanceId; the flag is audited separately
// ---------------------------------------------------------------------------

describe('db-evidence evaluator: FINAL rows matched by instanceId, flag audited separately', () => {
  it('evaluates the persisted FINAL steps/approvers even though every row has isFinalApproval=false', () => {
    const checks = evaluateDefaultWorkflowEvidence(t04aSavedRows(), 'all-defaults')
    const byName = checksByName(checks)

    assert.equal(byName.get('db-evidence/Business T04A/final-instance')?.status !== 'fail', true)
    // The ordered steps must come from the linked rows (not `[]` as in the
    // original flag-filtered run report).
    const steps = byName.get('db-evidence/Business T04A/final-ordered-steps')
    assert.equal(steps?.status, 'pass')
    assert.match(steps?.detail ?? '', /position-section-manager → position-department-manager/)
    // Genuine workflow failure still fails: nobody approved the FINAL chain.
    assert.equal(byName.get('db-evidence/Business T04A/final-approvers')?.status, 'fail')
    assert.equal(byName.get('db-evidence/Business T04A/terminal-status')?.status, 'fail')
  })

  it('surfaces the product flag inconsistency as an explicit final-flag-consistency FAILURE naming the offending rows', () => {
    const checks = evaluateDefaultWorkflowEvidence(t04aSavedRows(), 'all-defaults')
    const flagCheck = checksByName(checks).get('db-evidence/Business T04A/final-flag-consistency')
    assert.equal(flagCheck?.status, 'fail', 'FINAL rows persisted with isFinalApproval=false must FAIL the flag audit')
    assert.match(flagCheck?.detail ?? '', /214c9b8d-4a5d-4aa0-8b8e-ca615a0d2d22/)
    assert.match(flagCheck?.detail ?? '', /bc91f115-efd9-4b39-a81f-f11e6bc41ffd/)
  })

  it('passes final-flag-consistency when FINAL rows carry isFinalApproval=true (contract on the product side)', () => {
    const data = t04aSavedRows()
    for (const row of data.requestApprovals) {
      if (row.instanceId === '872aaef5-2d05-42de-b0f6-e59b671ad0ab') row.isFinalApproval = true
    }
    const flagCheck = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults')).get('db-evidence/Business T04A/final-flag-consistency')
    assert.equal(flagCheck?.status, 'pass')
  })

  it('flags a REQUEST row wrongly persisted with isFinalApproval=true (request-flag-consistency)', () => {
    const data = t03aSavedRows()
    const poisoned: DbEvidenceRow = data.requestApprovals[0]
    poisoned.isFinalApproval = true
    const flagCheck = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults')).get('db-evidence/Business T03A/request-flag-consistency')
    assert.equal(flagCheck?.status, 'fail')
    assert.match(flagCheck?.detail ?? '', /0a2c1e23-d806-4290-b2ff-9b1739231ca3/)
    // The poisoned flag must NOT corrupt the REQUEST row evaluation itself:
    // rows are selected by instanceId, so ordered-steps still evaluate.
    assert.equal(checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults')).get('db-evidence/Business T03A/request-ordered-steps')?.status, 'pass')
  })

  it('attributes REQUEST vs FINAL rows of the same request to their own instances (instanceId disambiguation)', () => {
    const data = t04aSavedRows()
    const checks = evaluateDefaultWorkflowEvidence(data, 'all-defaults')
    const byName = checksByName(checks)
    // REQUEST chain of T04A: 3 approved steps — not mixed with FINAL rows.
    assert.match(byName.get('db-evidence/Business T04A/request-ordered-steps')?.detail ?? '', /position-supervisor → position-section-manager → position-department-manager/)
    assert.equal(byName.get('db-evidence/Business T04A/request-approvers')?.status, 'pass')
    // FINAL chain: exactly the 2 FINAL-instance rows.
    assert.match(byName.get('db-evidence/Business T04A/final-ordered-steps')?.detail ?? '', /position-section-manager → position-department-manager\]/)
  })
})

// ---------------------------------------------------------------------------
// Task28: T04B FINAL captured-candidates + singleFinalAttempt snapshot checks
// (synthetic rows verbatim from the preserved 09-19 failing run
// 2026-09-19T13-31-00-268Z-full db-evidence.json, request 285d3105…)
// ---------------------------------------------------------------------------

/**
 * T04B rows exactly as persisted in the failing 2026-09-19T13-31-00-268Z-full
 * run: REQUEST + SOLUTION approved, FINAL attempt 1 PENDING with step 1
 * (Section manager P) approved and step 2 (Department manager) pending, its
 * candidate group correctly captured (scope unit-company, member
 * user-department-manager). This is the diagnostic shape: the PERSISTED
 * candidates are correct while the browser could not finish the step.
 */
function t04bFailingRunRows(): DbEvidenceData {
  const requestTitle = 'Business T04B 1789825646894-833'
  return {
    requests: [
      { id: '285d3105-9745-4b5f-824c-5b65a03dddea', title: requestTitle, status: 'FinalApproval' },
    ],
    solutions: [
      { id: 't04b-solution', requestId: '285d3105-9745-4b5f-824c-5b65a03dddea', submittedById: 'user-supervisor-e' },
    ],
    approvalInstances: [
      { id: '0c3d7133-ea0d-4815-9887-2737316ae09f', phase: 'REQUEST', requestId: '285d3105-9745-4b5f-824c-5b65a03dddea', solutionId: null, routeVersionId: 'all-defaults-request-default', originUserId: 'user-supervisor-p', state: 'APPROVED', attempt: 1, supersededAt: null },
      { id: 't04b-solution-instance', phase: 'SOLUTION', requestId: null, solutionId: 't04b-solution', routeVersionId: 'all-defaults-solution-default', originUserId: 'user-supervisor-e', state: 'APPROVED', attempt: 1, supersededAt: null },
      { id: '4523751a-85e8-46ec-bb44-472ca6e2f966', phase: 'FINAL', requestId: '285d3105-9745-4b5f-824c-5b65a03dddea', solutionId: null, routeVersionId: 'all-defaults-final-default', originUserId: 'user-supervisor-p', state: 'PENDING', attempt: 1, supersededAt: null },
    ],
    candidateGroups: [
      { id: 'e67df579-3a70-4c7c-80a3-808c65971ba8', approvalInstanceId: '4523751a-85e8-46ec-bb44-472ca6e2f966', requiredPositionId: 'position-section-manager', scopeUnitId: 'unit-company', members: [{ userId: 'user-section-manager-p', name: 'Section manager P' }] },
      { id: '8e9e3727-0fcc-4958-97dc-6b62f519990e', approvalInstanceId: '4523751a-85e8-46ec-bb44-472ca6e2f966', requiredPositionId: 'position-department-manager', scopeUnitId: 'unit-company', members: [{ userId: 'user-department-manager', name: 'Department manager' }] },
    ],
    requestApprovals: [
      { id: 't04b-ra1', requestId: '285d3105-9745-4b5f-824c-5b65a03dddea', instanceId: '0c3d7133-ea0d-4815-9887-2737316ae09f', order: 1, status: 'approved', requiredPositionId: 'position-section-manager', approverId: 'user-section-manager-p', isFinalApproval: false },
      { id: 't04b-ra2', requestId: '285d3105-9745-4b5f-824c-5b65a03dddea', instanceId: '0c3d7133-ea0d-4815-9887-2737316ae09f', order: 2, status: 'approved', requiredPositionId: 'position-department-manager', approverId: 'user-department-manager', isFinalApproval: false },
      { id: '08ca5c10-1f16-4ab5-8f03-d923685aeea3', requestId: '285d3105-9745-4b5f-824c-5b65a03dddea', instanceId: '4523751a-85e8-46ec-bb44-472ca6e2f966', order: 1, status: 'approved', requiredPositionId: 'position-section-manager', candidateGroupId: 'e67df579-3a70-4c7c-80a3-808c65971ba8', approverId: 'user-section-manager-p', isFinalApproval: true, approvedAt: '2026-09-19T13:48:27.466Z' },
      { id: '9345a0fe-f3d5-4ac5-b170-851f8069e90f', requestId: '285d3105-9745-4b5f-824c-5b65a03dddea', instanceId: '4523751a-85e8-46ec-bb44-472ca6e2f966', order: 2, status: 'pending', requiredPositionId: 'position-department-manager', candidateGroupId: '8e9e3727-0fcc-4958-97dc-6b62f519990e', approverId: null, isFinalApproval: true, approvedAt: null },
    ],
    solutionApprovals: [
      { id: 't04b-sa1', solutionId: 't04b-solution', instanceId: 't04b-solution-instance', order: 1, status: 'approved', requiredPositionId: 'position-section-manager', approverId: 'user-section-manager-e' },
      { id: 't04b-sa2', solutionId: 't04b-solution', instanceId: 't04b-solution-instance', order: 2, status: 'approved', requiredPositionId: 'position-department-manager', approverId: 'user-department-manager' },
    ],
    instanceSkips: [],
    routeVersions: [],
    requestActivities: [],
  }
}

describe('db-evidence evaluator: T04B FINAL captured candidates + single final attempt (Task28 diagnostic coverage)', () => {
  it('retains the persisted FINAL candidates and the single intact attempt even while the completion checks honestly FAIL', () => {
    const byName = checksByName(evaluateDefaultWorkflowEvidence(t04bFailingRunRows(), 'all-defaults'))
    // The NEW snapshot checks: persisted candidate truth is retained...
    const candidates = byName.get('db-evidence/Business T04B/final-captured-candidates')
    assert.equal(candidates?.status, 'pass')
    assert.match(candidates?.detail ?? '', /position-section-manager:\[user-section-manager-p\] \| position-department-manager:\[user-department-manager\]/)
    assert.match(candidates?.detail ?? '', /group scope unit-company/)
    assert.equal(byName.get('db-evidence/Business T04B/single-final-attempt')?.status, 'pass')
    // ...while the existing completion checks KEEP FAILING (never relaxed):
    assert.equal(byName.get('db-evidence/Business T04B/final-approvers')?.status, 'fail')
    assert.equal(byName.get('db-evidence/Business T04B/terminal-status')?.status, 'fail')
  })

  it('FAILS final-captured-candidates when the pending step\'s candidate group is MISSING (dangling candidateGroupId)', () => {
    const data = t04bFailingRunRows()
    data.candidateGroups = data.candidateGroups.filter(
      (group) => group.id !== '8e9e3727-0fcc-4958-97dc-6b62f519990e',
    )
    const candidates = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults')).get('db-evidence/Business T04B/final-captured-candidates')
    assert.equal(candidates?.status, 'fail')
    assert.match(candidates?.detail ?? '', /group scope problems: position-department-manager→\(group not found\)/)
  })

  it('FAILS final-captured-candidates when a persisted group member is WRONG (diagnostic value: names the actual member set)', () => {
    const data = t04bFailingRunRows()
    const group = data.candidateGroups.find((row) => row.id === '8e9e3727-0fcc-4958-97dc-6b62f519990e')
    assert.ok(group, 'the department-manager candidate group must exist in the synthetic rows')
    group.members = [{ userId: 'user-requester-a', name: 'Requester A' }]
    const candidates = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults')).get('db-evidence/Business T04B/final-captured-candidates')
    assert.equal(candidates?.status, 'fail')
    assert.match(candidates?.detail ?? '', /position-department-manager:\[user-requester-a\]/)
  })

  it('FAILS final-captured-candidates when the captured group scope is NOT the company default scope', () => {
    const data = t04bFailingRunRows()
    const group = data.candidateGroups.find((row) => row.id === '8e9e3727-0fcc-4958-97dc-6b62f519990e')
    assert.ok(group, 'the department-manager candidate group must exist in the synthetic rows')
    group.scopeUnitId = 'unit-engineering-section'
    const candidates = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults')).get('db-evidence/Business T04B/final-captured-candidates')
    assert.equal(candidates?.status, 'fail')
    assert.match(candidates?.detail ?? '', /group scope problems: position-department-manager→unit-engineering-section/)
  })

  it('FAILS single-final-attempt when history shows a second (superseded or current) FINAL attempt — current pending state is distinguishable from history', () => {
    const data = t04bFailingRunRows()
    // A restarted FINAL attempt: the old one superseded, a new current one.
    data.approvalInstances.push(
      { id: 't04b-final-restart', phase: 'FINAL', requestId: '285d3105-9745-4b5f-824c-5b65a03dddea', solutionId: null, routeVersionId: 'all-defaults-final-default', originUserId: 'user-supervisor-p', state: 'PENDING', attempt: 2, supersededAt: null },
    )
    const attempt = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults')).get('db-evidence/Business T04B/single-final-attempt')
    assert.equal(attempt?.status, 'fail')
    assert.match(attempt?.detail ?? '', /found 2/)
    // Candidates are still evaluated on the CURRENT instance only (highest
    // non-superseded attempt): the restart's groups are absent → fail, never
    // silently read from the superseded history.
    const candidates = checksByName(evaluateDefaultWorkflowEvidence(data, 'all-defaults')).get('db-evidence/Business T04B/final-captured-candidates')
    assert.equal(candidates?.status, 'fail')
  })
})

// ---------------------------------------------------------------------------
// Full-snapshot replay of the preserved run capture (offline, read-only)
// ---------------------------------------------------------------------------

const snapshotAvailable = existsSync(SAVED_CAPTURE)

describe('db-evidence evaluator: corrected replay of the preserved 2026-09-17T23-26-39-677Z-full capture', () => {
  it('replays the saved raw rows with the corrected linkage (grounded in db-evidence.json)', { skip: !snapshotAvailable }, async (t) => {
    const payload = JSON.parse(await fs.readFile(SAVED_CAPTURE, 'utf8')) as {
      data: DbEvidenceData
      checks: WorkflowCheck[]
    }
    const data = payload.data

    // Ground the two linkage facts the evaluator now depends on.
    const solutionInstances = data.approvalInstances.filter((row) => row.phase === 'SOLUTION')
    assert.ok(solutionInstances.length >= 4, 'saved capture holds the four SOLUTION instances')
    for (const instance of solutionInstances) {
      assert.equal(instance.requestId, null, `SOLUTION instance ${instance.id} must persist requestId null`)
      assert.ok(typeof instance.solutionId === 'string' && instance.solutionId !== '')
    }
    const finalInstances = data.approvalInstances.filter((row) => row.phase === 'FINAL')
    assert.equal(finalInstances.length, 2)
    for (const instance of finalInstances) {
      const rows = data.requestApprovals.filter((row) => row.instanceId === instance.id)
      assert.equal(rows.length, 2, `FINAL instance ${instance.id} must own two persisted rows`)
      for (const row of rows) assert.equal(row.isFinalApproval, false, 'product persisted FINAL rows with the flag false (the inconsistency under audit)')
    }

    const checks = evaluateDefaultWorkflowEvidence(data, 'all-defaults')
    const byName = checksByName(checks)

    // False-negative bug 1 fixed: every solution-chain assertion now RAN and
    // PASSED against the persisted rows for all four scenarios.
    for (const prefix of ['Business T03A', 'Business T03B', 'Business T04A', 'Business T04B']) {
      assert.equal(byName.get(`db-evidence/${prefix}/solution-instance`), undefined)
      assert.equal(byName.get(`db-evidence/${prefix}/solution-route`)?.status, 'pass')
      assert.equal(byName.get(`db-evidence/${prefix}/solution-origin`)?.status, 'pass')
      assert.equal(byName.get(`db-evidence/${prefix}/solution-ordered-steps`)?.status, 'pass')
    }
    assert.equal(byName.get('db-evidence/Business T03A/solution-pending-candidates')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T03B/solution-pending-candidates')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T04A/solution-approvers')?.status, 'pass')
    assert.equal(byName.get('db-evidence/Business T04B/solution-approvers')?.status, 'pass')

    // False-negative bug 2 fixed: FINAL steps are evaluated from linked rows.
    for (const prefix of ['Business T04A', 'Business T04B']) {
      assert.equal(byName.get(`db-evidence/${prefix}/final-ordered-steps`)?.status, 'pass')
      // Product flag inconsistency surfaced, not hidden.
      assert.equal(byName.get(`db-evidence/${prefix}/final-flag-consistency`)?.status, 'fail')
      // Genuine product failures remain failures.
      assert.equal(byName.get(`db-evidence/${prefix}/final-approvers`)?.status, 'fail')
      assert.equal(byName.get(`db-evidence/${prefix}/terminal-status`)?.status, 'fail')
    }
    // REQUEST flag contract holds on the saved rows.
    for (const prefix of ['Business T02A', 'Business T02B', 'Business T03A', 'Business T03B', 'Business T04A', 'Business T04B']) {
      assert.equal(byName.get(`db-evidence/${prefix}/request-flag-consistency`)?.status, 'pass')
    }

    const failures = checks.filter((check) => check.status === 'fail')
    assert.deepEqual(
      failures.map((check) => check.name).sort(),
      [
        'db-evidence/Business T04A/final-approvers',
        'db-evidence/Business T04A/final-flag-consistency',
        'db-evidence/Business T04A/terminal-status',
        'db-evidence/Business T04B/final-approvers',
        'db-evidence/Business T04B/final-flag-consistency',
        'db-evidence/Business T04B/terminal-status',
      ],
      'exactly the six genuine/product failures remain after the evaluator fix',
    )
    void t
  })
})
