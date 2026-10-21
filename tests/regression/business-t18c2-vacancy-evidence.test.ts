import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  assembleBusinessDbChecks,
  evaluateT18c2VacancyEvidence,
  type DbEvidenceData,
  type DbEvidenceRow,
  type WorkflowCheck,
} from '../support/native/capture-workflow-db-evidence'
import {
  parseT18c2BrowserCorrelation,
  T18C2_BROWSER_CORRELATION_FILE,
} from '../support/business-t18c2-correlation'
import { t18c2EvidenceApplies } from '../support/native/business-evidence-gate'

/**
 * Task24 — REQUIRED T18C2 persisted DB evidence (all-steps-vacant
 * auto-completion). The evaluator is pure (no SQL, no database): the runner
 * captures the rows read-only and these tests pin the exact expectations and
 * every tamper that must FAIL. Expected values are verified against the
 * actual production behavior (plan.ts COMPLETED_NO_ELIGIBLE_STEPS /
 * NO_ELIGIBLE_APPROVAL_STEPS, three VACANT_POSITION skips, attempts.ts
 * ImprovementRequest→SentToEngineer, requests.ts 'created' +
 * 'status_changed' auto-completion audit) — nothing is invented here.
 */

const EXACT_TITLE = 'Business T18C2 1789800000000-42'
const STAFF_VACANT_ALL = 'user-staff-vacant-all'
const AUTO_COMPLETION_COMMENT = 'Auto-completed: NO_ELIGIBLE_APPROVAL_STEPS (no eligible approval steps)'
const POSITION_SUPERVISOR = 'position-supervisor'
const POSITION_SECTION_MANAGER = 'position-section-manager'
const POSITION_DEPARTMENT_MANAGER = 'position-department-manager'
const EXPECTED_ROUTE = 'all-defaults-request-default'
const EXPECTED_SKIPS = [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER]

function input(): Parameters<typeof evaluateT18c2VacancyEvidence>[1] {
  return { exactTitle: EXACT_TITLE, expectedRouteVersionId: EXPECTED_ROUTE }
}

function positiveData(): DbEvidenceData {
  return {
    requests: [{ id: 'req-c2', title: EXACT_TITLE, status: 'SentToEngineer', requesterId: STAFF_VACANT_ALL }],
    solutions: [],
    approvalInstances: [
      {
        id: 'inst-c2',
        phase: 'REQUEST',
        requestId: 'req-c2',
        solutionId: null,
        routeVersionId: EXPECTED_ROUTE,
        state: 'COMPLETED_NO_ELIGIBLE_STEPS',
        attempt: 1,
        completionReason: 'NO_ELIGIBLE_APPROVAL_STEPS',
        supersededAt: null,
        restartOfInstanceId: null,
        restartReason: null,
        restartedById: null,
      },
    ],
    candidateGroups: [],
    requestApprovals: [],
    solutionApprovals: [],
    instanceSkips: EXPECTED_SKIPS.map((positionId) => ({
      approvalInstanceId: 'inst-c2',
      requiredPositionId: positionId,
      reason: 'VACANT_POSITION',
    })),
    routeVersions: [],
    requestActivities: [
      { requestId: 'req-c2', userId: STAFF_VACANT_ALL, action: 'created', toStatus: 'ImprovementRequest', comments: `Request created: ${EXACT_TITLE}` },
      { requestId: 'req-c2', userId: STAFF_VACANT_ALL, action: 'status_changed', fromStatus: 'ImprovementRequest', toStatus: 'SentToEngineer', comments: AUTO_COMPLETION_COMMENT },
    ],
  }
}

const allPass = (checks: WorkflowCheck[]): boolean => checks.length > 0 && checks.every((check) => check.status === 'pass')
const failing = (checks: WorkflowCheck[]): string[] => checks.filter((check) => check.status === 'fail').map((check) => check.name)

describe('T18C2 vacancy auto-completion evidence evaluator (real evaluation, tamper negatives included)', () => {
  it('positive control: every required vacancy check passes', () => {
    assert.ok(allPass(evaluateT18c2VacancyEvidence(positiveData(), input())))
  })

  it('missing or ambiguous exact title FAILS the REQUIRED request (never skipped)', () => {
    const missing = positiveData()
    missing.requests = []
    const checks = evaluateT18c2VacancyEvidence(missing, input())
    assert.ok(failing(checks).includes('db-evidence/Business T18C2/vacancy-auto-complete/request-present'))

    const ambiguous = positiveData()
    ambiguous.requests.push({ ...(ambiguous.requests[0] as DbEvidenceRow), id: 'req-c2-dup' })
    assert.ok(failing(evaluateT18c2VacancyEvidence(ambiguous, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/request-present'))
  })

  it('wrong requester fails the staff-vacant-all binding', () => {
    const data = positiveData()
    ;(data.requests[0] as DbEvidenceRow).requesterId = 'user-requester-a'
    assert.ok(failing(evaluateT18c2VacancyEvidence(data, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/requester-bound'))
  })

  it('not exactly one attempt-1 current REQUEST instance fails (restart/second attempt/none)', () => {
    const none = positiveData()
    none.approvalInstances = []
    assert.ok(failing(evaluateT18c2VacancyEvidence(none, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/request-instance'))

    const supersededOnly = positiveData()
    ;(supersededOnly.approvalInstances[0] as DbEvidenceRow).supersededAt = '2026-09-25T00:00:00Z'
    assert.ok(failing(evaluateT18c2VacancyEvidence(supersededOnly, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/request-instance'))

    const attempt2 = positiveData()
    ;(attempt2.approvalInstances[0] as DbEvidenceRow).attempt = 2
    assert.ok(failing(evaluateT18c2VacancyEvidence(attempt2, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/request-instance'))

    const extra = positiveData()
    extra.approvalInstances.push({ ...(extra.approvalInstances[0] as DbEvidenceRow), id: 'inst-c2-extra' })
    assert.ok(failing(evaluateT18c2VacancyEvidence(extra, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/request-instance'))
  })

  it('a restart linkage on the instance fails (this scenario has no restart)', () => {
    const data = positiveData()
    ;(data.approvalInstances[0] as DbEvidenceRow).restartOfInstanceId = 'inst-old'
    ;(data.approvalInstances[0] as DbEvidenceRow).restartReason = 'some reason'
    ;(data.approvalInstances[0] as DbEvidenceRow).restartedById = 'user-admin'
    assert.ok(failing(evaluateT18c2VacancyEvidence(data, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/no-restart-linkage'))
  })

  it('wrong route, wrong state (including AUTO_APPROVED), wrong completion reason each fail', () => {
    const wrongRoute = positiveData()
    ;(wrongRoute.approvalInstances[0] as DbEvidenceRow).routeVersionId = 'solution-exception-request-default'
    assert.ok(failing(evaluateT18c2VacancyEvidence(wrongRoute, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/request-route'))

    const autoApproved = positiveData()
    ;(autoApproved.approvalInstances[0] as DbEvidenceRow).state = 'AUTO_APPROVED'
    // A real AUTO_APPROVED row persists no NO_ELIGIBLE_APPROVAL_STEPS reason.
    ;(autoApproved.approvalInstances[0] as DbEvidenceRow).completionReason = null
    const stateChecks = evaluateT18c2VacancyEvidence(autoApproved, input())
    assert.ok(failing(stateChecks).includes('db-evidence/Business T18C2/vacancy-auto-complete/completion-state'))
    assert.ok(failing(stateChecks).includes('db-evidence/Business T18C2/vacancy-auto-complete/completion-reason'))

    const wrongReason = positiveData()
    ;(wrongReason.approvalInstances[0] as DbEvidenceRow).completionReason = null
    assert.ok(failing(evaluateT18c2VacancyEvidence(wrongReason, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/completion-reason'))
  })

  it('tampered skip set fails: missing skip, wrong reason, extra skip position', () => {
    const missingSkip = positiveData()
    missingSkip.instanceSkips = missingSkip.instanceSkips.slice(1)
    assert.ok(failing(evaluateT18c2VacancyEvidence(missingSkip, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/vacant-skips'))

    const wrongReason = positiveData()
    ;(wrongReason.instanceSkips[0] as DbEvidenceRow).reason = 'SKIPPED_BY_REQUESTER'
    assert.ok(failing(evaluateT18c2VacancyEvidence(wrongReason, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/vacant-skips'))

    const extraSkip = positiveData()
    extraSkip.instanceSkips.push({ approvalInstanceId: 'inst-c2', requiredPositionId: 'position-vacancy-anchor', reason: 'VACANT_POSITION' })
    assert.ok(failing(evaluateT18c2VacancyEvidence(extraSkip, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/vacant-skips'))
  })

  it('a captured candidate group fails the zero-eligible-groups expectation', () => {
    const data = positiveData()
    data.candidateGroups = [{ id: 'g-c2', approvalInstanceId: 'inst-c2', requiredPositionId: POSITION_SUPERVISOR, members: [{ userId: 'user-supervisor-p' }] }]
    assert.ok(failing(evaluateT18c2VacancyEvidence(data, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/zero-candidate-groups'))
  })

  it('any request approval row fails (zero approvals / no fabricated decisions)', () => {
    const data = positiveData()
    data.requestApprovals = [{ id: 'ra-c2', requestId: 'req-c2', instanceId: 'inst-c2', order: 1, status: 'approved', requiredPositionId: POSITION_SUPERVISOR, approverId: 'user-supervisor-p', isFinalApproval: false }]
    assert.ok(failing(evaluateT18c2VacancyEvidence(data, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/zero-request-approvals'))
  })

  it('terminal status must be SentToEngineer', () => {
    const data = positiveData()
    ;(data.requests[0] as DbEvidenceRow).status = 'ImprovementRequest'
    assert.ok(failing(evaluateT18c2VacancyEvidence(data, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/terminal-status'))
  })

  it('missing created activity or missing/altered auto-completion audit fails', () => {
    const noCreated = positiveData()
    noCreated.requestActivities = noCreated.requestActivities.filter((row) => String((row as DbEvidenceRow).action) !== 'created')
    assert.ok(failing(evaluateT18c2VacancyEvidence(noCreated, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/created-activity'))

    const alteredAudit = positiveData()
    ;(alteredAudit.requestActivities[1] as DbEvidenceRow).comments = 'Auto-approved by position ceiling'
    assert.ok(failing(evaluateT18c2VacancyEvidence(alteredAudit, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/status-changed-audit'))

    const missingAudit = positiveData()
    missingAudit.requestActivities = [missingAudit.requestActivities[0]]
    assert.ok(failing(evaluateT18c2VacancyEvidence(missingAudit, input())).includes('db-evidence/Business T18C2/vacancy-auto-complete/status-changed-audit'))
  })
})

describe('T18C2 browser correlation (fail-closed parsing)', () => {
  it('accepts only an exact-title object', () => {
    assert.deepEqual(parseT18c2BrowserCorrelation(`{"requestTitle":"${EXACT_TITLE}"}`), { status: 'present', correlation: { requestTitle: EXACT_TITLE } })
  })

  it('rejects corrupt payloads, wrong scenario prefix, and empty suffix', () => {
    assert.equal(parseT18c2BrowserCorrelation('not json').status, 'corrupt')
    assert.equal(parseT18c2BrowserCorrelation('null').status, 'corrupt')
    assert.equal(parseT18c2BrowserCorrelation('{"requestTitle":123}').status, 'corrupt')
    assert.equal(parseT18c2BrowserCorrelation('{"requestTitle":"Business T18B 1"}').status, 'corrupt')
    assert.equal(parseT18c2BrowserCorrelation('{"requestTitle":"Business T18C2 "}').status, 'corrupt')
    assert.equal(parseT18c2BrowserCorrelation('{"requestTitle":"Business T18C2"}').status, 'corrupt')
    assert.equal(parseT18c2BrowserCorrelation('{"other":"x"}').status, 'corrupt')
  })

  it('uses the small dedicated correlation file name', () => {
    assert.equal(T18C2_BROWSER_CORRELATION_FILE, 't18c2-browser-correlation.json')
  })
})

describe('T18C2 evidence requirement gate (full/all-defaults default-ALL and focused selections)', () => {
  const presentCorrelation = { status: 'present' as const, correlation: { requestTitle: EXACT_TITLE } }

  it('t18c2EvidenceApplies mirrors the confirmed requirement matrix', () => {
    assert.equal(t18c2EvidenceApplies('full', 'all-defaults', undefined), true, 'default full all-defaults run REQUIRES T18C2 evidence')
    assert.equal(t18c2EvidenceApplies('full', 'all-defaults', 'T18C2'), true, 'focused T18C2 run REQUIRES T18C2 evidence')
    assert.equal(t18c2EvidenceApplies('full', 'all-defaults', 'T18B'), false, 'focused T18B run does not select T18C2')
    assert.equal(t18c2EvidenceApplies('prepare', 'all-defaults', undefined), false)
    assert.equal(t18c2EvidenceApplies('lifecycle-smoke', 'all-defaults', undefined), false)
    assert.equal(t18c2EvidenceApplies('full', 'solution-exception', undefined), false)
  })

  it('default full all-defaults assembly FAILS on missing or corrupt T18C2 correlation', () => {
    const missing = assembleBusinessDbChecks(positiveData(), 'all-defaults', { status: 'missing' }, { requireT18c2: true })
    assert.equal(missing.find((check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-missing')?.status, 'fail')
    const corrupt = assembleBusinessDbChecks(positiveData(), 'all-defaults', { status: 'missing' }, { requireT18c2: true, t18c2: { status: 'corrupt' } })
    assert.equal(corrupt.find((check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-missing')?.status, 'fail')
  })

  it('focused T18C2 with a present correlation runs the full evaluator and passes on real data', () => {
    const checks = assembleBusinessDbChecks(positiveData(), 'all-defaults', { status: 'missing' }, {
      requireT18b: false,
      requireT18c2: true,
      t18c2: presentCorrelation,
      focusedScenario: 'T18C2',
    })
    const t18c2Checks = checks.filter((check) => check.name.includes('T18C2'))
    assert.ok(t18c2Checks.length > 0)
    assert.ok(t18c2Checks.every((check) => check.status === 'pass'))
  })

  it('focused T18C2 with a STALE title (no matching request) fails, never silently skips', () => {
    const checks = assembleBusinessDbChecks(positiveData(), 'all-defaults', { status: 'missing' }, {
      requireT18c2: true,
      t18c2: { status: 'present', correlation: { requestTitle: 'Business T18C2 1999999999999-9' } },
      focusedScenario: 'T18C2',
    })
    assert.equal(checks.find((check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/request-present')?.status, 'fail')
  })

  it('focused T18B records T18C2 as an explicit NOT-SELECTED skip (T18B requirements unchanged)', () => {
    const checks = assembleBusinessDbChecks(positiveData(), 'all-defaults', { status: 'missing' }, {
      requireT18b: true,
      requireT18c2: t18c2EvidenceApplies('full', 'all-defaults', 'T18B'),
      focusedScenario: 'T18B',
    })
    const notSelected = checks.find((check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-not-selected')
    assert.equal(notSelected?.status, 'skipped')
    // T18B evidence still FAILS closed on its own missing correlation in the
    // same assembly — the T18B requirement is preserved, not weakened.
    assert.equal(checks.find((check) => check.name === 'db-evidence/Business T18B/stranded-restart/browser-correlation-missing')?.status, 'fail')
  })

  it('unselected route profiles emit no T18C2 checks (no coverage claimed)', () => {
    const checks = assembleBusinessDbChecks(positiveData(), 'solution-exception', { status: 'missing' }, { requireT18c2: false })
    assert.equal(checks.some((check) => check.name.includes('T18C2')), false)
  })
})
