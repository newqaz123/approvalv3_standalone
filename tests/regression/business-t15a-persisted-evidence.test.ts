import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  assembleBusinessDbChecks,
  type DbEvidenceData,
  type DbEvidenceRow,
  type WorkflowCheck,
} from '../support/native/capture-workflow-db-evidence'
import { evaluateT15aPersistedEvidence } from '../support/native/t15a-persisted-evidence'
import { parseT15aBrowserCorrelation } from '../support/business-t15a-double-click'
import { decideBusinessEvidenceGate, t15aEvidenceApplies } from '../support/native/business-evidence-gate'

/**
 * Task56 — REQUIRED T15A persisted DB evidence (runner-owned, READ-ONLY).
 * The evaluator is pure (no SQL, no database): the runner captures the rows
 * read-only and these tests pin the exact expectations and every tamper that
 * must FAIL. Expected values are verified against the ACTUAL production
 * behavior — nothing invented:
 *  - solutions.ts initiateFinalApproval: activity action 'final_approval_initiated',
 *    userId = trigger actor, comments 'Final approval attempt created from
 *    the published route' (useCustomChain=false for this spec);
 *  - decisions.ts/transaction-adapter.ts: the last FINAL approval sets the
 *    instance state APPROVED (PENDING-guarded), request status
 *    FinalApproval→Completed, approval activities action
 *    'final_approval_approved' by each actor;
 *  - the T15A spec: Requester A creates AND triggers; Section manager P →
 *    Department manager decide the all-defaults FINAL chain (route
 *    all-defaults-final-default, scope unit-company).
 *
 * Honest scope (do NOT claim full T15 proof): this layer proves the PERSISTED
 * single-transition state only. Duplicate alerts/mail evidence is a PENDING
 * separate task, and the browser measurement's observed-count branches
 * (1 or 2 POSTs) share the SAME persisted expectations.
 */

const EXACT_TITLE = 'Business T15A 1789800000000-42'
const REQUESTER_A = 'user-requester-a'
const SECTION_MANAGER_P = 'user-section-manager-p'
const DEPARTMENT_MANAGER = 'user-department-manager'
const POSITION_SECTION_MANAGER = 'position-section-manager'
const POSITION_DEPARTMENT_MANAGER = 'position-department-manager'
const EXPECTED_FINAL_ROUTE = 'all-defaults-final-default'
const INITIATION_COMMENT = 'Final approval attempt created from the published route'
const PREFIX = 'db-evidence/Business T15A/persisted-single-transition'

const CORRELATION = parseT15aBrowserCorrelation(
  JSON.stringify({ requestTitle: EXACT_TITLE, attemptedClicks: 2, observedRequestCalls: 2, status: 'measured' }),
)

function positiveData(): DbEvidenceData {
  return {
    requests: [{ id: 'req-15a', title: EXACT_TITLE, status: 'Completed', requesterId: REQUESTER_A }],
    solutions: [],
    approvalInstances: [
      {
        id: 'inst-15a',
        phase: 'FINAL',
        requestId: 'req-15a',
        solutionId: null,
        routeVersionId: EXPECTED_FINAL_ROUTE,
        originUserId: REQUESTER_A,
        state: 'APPROVED',
        attempt: 1,
        supersededAt: null,
        restartOfInstanceId: null,
        restartReason: null,
        restartedById: null,
      },
    ],
    candidateGroups: [
      {
        id: 'grp-sm',
        approvalInstanceId: 'inst-15a',
        requiredPositionId: POSITION_SECTION_MANAGER,
        scopeUnitId: 'unit-company',
        members: [{ userId: SECTION_MANAGER_P }],
      },
      {
        id: 'grp-dm',
        approvalInstanceId: 'inst-15a',
        requiredPositionId: POSITION_DEPARTMENT_MANAGER,
        scopeUnitId: 'unit-company',
        members: [{ userId: DEPARTMENT_MANAGER }],
      },
    ],
    requestApprovals: [
      {
        id: 'ra-1',
        requestId: 'req-15a',
        instanceId: 'inst-15a',
        order: 1,
        status: 'approved',
        requiredPositionId: POSITION_SECTION_MANAGER,
        candidateGroupId: 'grp-sm',
        approverId: SECTION_MANAGER_P,
        isFinalApproval: true,
        approvedAt: '2026-09-26T08:00:00Z',
      },
      {
        id: 'ra-2',
        requestId: 'req-15a',
        instanceId: 'inst-15a',
        order: 2,
        status: 'approved',
        requiredPositionId: POSITION_DEPARTMENT_MANAGER,
        candidateGroupId: 'grp-dm',
        approverId: DEPARTMENT_MANAGER,
        isFinalApproval: true,
        approvedAt: '2026-09-26T08:01:00Z',
      },
    ],
    solutionApprovals: [],
    instanceSkips: [],
    routeVersions: [],
    requestActivities: [
      { requestId: 'req-15a', userId: REQUESTER_A, action: 'final_approval_initiated', comments: INITIATION_COMMENT },
      { requestId: 'req-15a', userId: SECTION_MANAGER_P, action: 'final_approval_approved', comments: 'Final approval approved at step 1' },
      { requestId: 'req-15a', userId: DEPARTMENT_MANAGER, action: 'final_approval_approved', comments: 'Final approval approved at step 2' },
      { requestId: 'req-15a', userId: REQUESTER_A, action: 'status_changed', fromStatus: 'FinalApproval', toStatus: 'Completed', comments: 'All final approvals completed. Request marked as completed.' },
    ],
  }
}

function emptyDbData(): DbEvidenceData {
  return {
    requests: [],
    solutions: [],
    approvalInstances: [],
    candidateGroups: [],
    requestApprovals: [],
    solutionApprovals: [],
    instanceSkips: [],
    routeVersions: [],
    requestActivities: [],
  }
}

const allPass = (checks: WorkflowCheck[]): boolean => checks.length > 0 && checks.every((check) => check.status === 'pass')
const failing = (checks: WorkflowCheck[]): string[] => checks.filter((check) => check.status === 'fail').map((check) => check.name)

describe('T15A persisted single-transition evidence evaluator (real evaluation, tamper negatives included)', () => {
  it('positive control: every required persisted check passes', () => {
    assert.ok(CORRELATION.status === 'present')
    const checks = evaluateT15aPersistedEvidence(positiveData(), { exactTitle: EXACT_TITLE })
    assert.ok(allPass(checks), `unexpected failures: ${failing(checks).join(', ')}`)
  })

  it('missing or ambiguous exact title FAILS (never skipped)', () => {
    const missing = positiveData()
    missing.requests = []
    assert.ok(failing(evaluateT15aPersistedEvidence(missing, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/request-present`))

    const ambiguous = positiveData()
    ambiguous.requests.push({ ...(ambiguous.requests[0] as DbEvidenceRow), id: 'req-15a-dup' })
    assert.ok(failing(evaluateT15aPersistedEvidence(ambiguous, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/request-present`))
  })

  it('a SECOND final attempt (or a superseded/restarted instance) FAILS the single-attempt gate', () => {
    const secondAttempt = positiveData()
    secondAttempt.approvalInstances.push({ ...(secondAttempt.approvalInstances[0] as DbEvidenceRow), id: 'inst-15a-2', attempt: 2 })
    assert.ok(failing(evaluateT15aPersistedEvidence(secondAttempt, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-instance`))

    const superseded = positiveData()
    ;(superseded.approvalInstances[0] as DbEvidenceRow).supersededAt = '2026-09-26T08:00:00Z'
    assert.ok(failing(evaluateT15aPersistedEvidence(superseded, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-instance`))

    const restart = positiveData()
    ;(restart.approvalInstances[0] as DbEvidenceRow).attempt = 2
    assert.ok(failing(evaluateT15aPersistedEvidence(restart, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-instance`))
  })

  it('duplicate FINAL approval decisions FAIL (exactly two approved rows, one per step)', () => {
    const duplicate = positiveData()
    duplicate.requestApprovals.push({ ...(duplicate.requestApprovals[0] as DbEvidenceRow), id: 'ra-1-dup' })
    assert.ok(failing(evaluateT15aPersistedEvidence(duplicate, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approved-rows`))
  })

  it('a WRONG final approver actor FAILS', () => {
    const wrongActor = positiveData()
    ;(wrongActor.requestApprovals[0] as DbEvidenceRow).approverId = DEPARTMENT_MANAGER
    assert.ok(failing(evaluateT15aPersistedEvidence(wrongActor, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approved-rows`))
  })

  it('a non-APPROVED instance state FAILS (persisted final state must be APPROVED)', () => {
    const pending = positiveData()
    ;(pending.approvalInstances[0] as DbEvidenceRow).state = 'PENDING'
    assert.ok(failing(evaluateT15aPersistedEvidence(pending, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-state`))
  })

  it('a wrong route, origin, or terminal status FAILS', () => {
    const route = positiveData()
    ;(route.approvalInstances[0] as DbEvidenceRow).routeVersionId = 'final-exception-final-exception'
    assert.ok(failing(evaluateT15aPersistedEvidence(route, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-route`))

    const origin = positiveData()
    ;(origin.approvalInstances[0] as DbEvidenceRow).originUserId = 'user-staff-b'
    assert.ok(failing(evaluateT15aPersistedEvidence(origin, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-origin`))

    const status = positiveData()
    ;(status.requests[0] as DbEvidenceRow).status = 'FinalApproval'
    assert.ok(failing(evaluateT15aPersistedEvidence(status, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/request-completed`))
  })

  it('an ALTERED captured candidate group FAILS (exact members per step)', () => {
    const group = positiveData()
    ;((group.candidateGroups[0] as DbEvidenceRow).members as Array<{ userId: string }>)[0].userId = 'user-staff-b'
    assert.ok(failing(evaluateT15aPersistedEvidence(group, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-captured-groups`))
  })

  it('the final initiation audit is REQUIRED exactly once with the ACTUAL action and comment (no invented enum)', () => {
    const missing = positiveData()
    missing.requestActivities = missing.requestActivities.filter((row) => String(row.action) !== 'final_approval_initiated')
    assert.ok(failing(evaluateT15aPersistedEvidence(missing, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-initiation-audit`))

    const duplicated = positiveData()
    duplicated.requestActivities.push(duplicated.requestActivities.find((row) => String(row.action) === 'final_approval_initiated') as DbEvidenceRow)
    assert.ok(failing(evaluateT15aPersistedEvidence(duplicated, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-initiation-audit`))

    const wrongComment = positiveData()
    ;(wrongComment.requestActivities.find((row) => String(row.action) === 'final_approval_initiated') as DbEvidenceRow).comments = 'invented text'
    assert.ok(failing(evaluateT15aPersistedEvidence(wrongComment, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-initiation-audit`))

    const wrongActor = positiveData()
    ;(wrongActor.requestActivities.find((row) => String(row.action) === 'final_approval_initiated') as DbEvidenceRow).userId = 'user-admin'
    assert.ok(failing(evaluateT15aPersistedEvidence(wrongActor, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-initiation-audit`))
  })

  it('the final approval activity count must be exactly two (one per decided step)', () => {
    const extra = positiveData()
    extra.requestActivities.push({ requestId: 'req-15a', userId: SECTION_MANAGER_P, action: 'final_approval_approved', comments: 'Final approval approved at step 1' })
    assert.ok(failing(evaluateT15aPersistedEvidence(extra, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approval-activity-count`))
  })

  it('exactly one FinalApproval→Completed status_changed audit is REQUIRED', () => {
    const missing = positiveData()
    missing.requestActivities = missing.requestActivities.filter((row) => String(row.action) !== 'status_changed')
    assert.ok(failing(evaluateT15aPersistedEvidence(missing, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/completion-audit`))

    const duplicated = positiveData()
    duplicated.requestActivities.push(duplicated.requestActivities.find((row) => String(row.action) === 'status_changed') as DbEvidenceRow)
    assert.ok(failing(evaluateT15aPersistedEvidence(duplicated, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/completion-audit`))
  })
})

describe('T15A persisted evidence: reviewer round-2 P1 linkage tamper matrix (union row scope + row-linked groups)', () => {
  // Reviewer finding 1: an EXTRA FINAL row for the SAME request with
  // instanceId NULL (schema-permitted) must FAIL — the instance-only filter
  // used to miss it. Same-request FINAL rows are taken as the UNION of
  // isFinalApproval OR instance-linked-to-the-sole-FINAL-instance, then the
  // flag must be true on both and orders must be numerically EXACTLY 1 and 2.
  it('an extra same-request FINAL row with instanceId null FAILS (union scope, no silent pass)', () => {
    const tampered = positiveData()
    tampered.requestApprovals.push({
      id: 'ra-extra-null-instance',
      requestId: 'req-15a',
      instanceId: null,
      order: 3,
      status: 'approved',
      requiredPositionId: POSITION_DEPARTMENT_MANAGER,
      candidateGroupId: 'grp-dm',
      approverId: DEPARTMENT_MANAGER,
      isFinalApproval: true,
      approvedAt: '2026-09-26T08:02:00Z',
    })
    assert.ok(failing(evaluateT15aPersistedEvidence(tampered, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approved-rows`))
  })

  it('a wrong-flag (isFinalApproval=false) row LINKED to the FINAL instance is never silently ignored', () => {
    // Replaces one correct row: the union contains it via the instance link,
    // so the exactly-two + flag-true + full shape requirements FAIL.
    const tampered = positiveData()
    ;(tampered.requestApprovals[1] as DbEvidenceRow).isFinalApproval = false
    const checks = evaluateT15aPersistedEvidence(tampered, { exactTitle: EXACT_TITLE })
    assert.ok(failing(checks).includes(`${PREFIX}/final-approved-rows`))
    // A THIRD wrong-flag row linked to the instance also fails the count.
    const third = positiveData()
    third.requestApprovals.push({
      id: 'ra-third-wrong-flag',
      requestId: 'req-15a',
      instanceId: 'inst-15a',
      order: 3,
      status: 'pending',
      requiredPositionId: POSITION_SECTION_MANAGER,
      candidateGroupId: 'grp-sm',
      approverId: null,
      isFinalApproval: false,
      approvedAt: null,
    })
    assert.ok(failing(evaluateT15aPersistedEvidence(third, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approved-rows`))
  })

  it('duplicate numeric orders 1/1 and 2/2 FAIL (exact multiset {1,2}, never sort-only)', () => {
    const dupOne = positiveData()
    ;(dupOne.requestApprovals[1] as DbEvidenceRow).order = 1
    assert.ok(failing(evaluateT15aPersistedEvidence(dupOne, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approved-rows`))

    const dupTwo = positiveData()
    ;(dupTwo.requestApprovals[0] as DbEvidenceRow).order = 2
    assert.ok(failing(evaluateT15aPersistedEvidence(dupTwo, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approved-rows`))
  })

  it('non-numeric orders FAIL; string numerics parse-and-cast EXACT and pass', () => {
    for (const bad of [null, 'abc', undefined]) {
      const tampered = positiveData()
      ;(tampered.requestApprovals[0] as DbEvidenceRow).order = bad as unknown as number
      assert.ok(
        failing(evaluateT15aPersistedEvidence(tampered, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approved-rows`),
        `order ${JSON.stringify(bad)} must fail the numeric-order requirement`,
      )
    }
    const stringOrders = positiveData()
    ;(stringOrders.requestApprovals[0] as DbEvidenceRow).order = '1'
    ;(stringOrders.requestApprovals[1] as DbEvidenceRow).order = '2'
    assert.ok(allPass(evaluateT15aPersistedEvidence(stringOrders, { exactTitle: EXACT_TITLE })))
  })

  it('order/position misalignment FAILS (order 1 must be section-manager, order 2 department-manager)', () => {
    const swapped = positiveData()
    ;(swapped.requestApprovals[0] as DbEvidenceRow).requiredPositionId = POSITION_DEPARTMENT_MANAGER
    ;(swapped.requestApprovals[1] as DbEvidenceRow).requiredPositionId = POSITION_SECTION_MANAGER
    assert.ok(failing(evaluateT15aPersistedEvidence(swapped, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approved-rows`))
  })

  // Reviewer finding 2: groups are verified THROUGH the approval rows'
  // candidateGroupId links — never as independent existence.
  it('a NULL candidateGroupId on a FINAL row FAILS the group linkage', () => {
    const tampered = positiveData()
    ;(tampered.requestApprovals[0] as DbEvidenceRow).candidateGroupId = null
    assert.ok(failing(evaluateT15aPersistedEvidence(tampered, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-captured-groups`))
  })

  it('SWAPPED group links (order 1 -> department-manager group) FAIL', () => {
    const tampered = positiveData()
    ;(tampered.requestApprovals[0] as DbEvidenceRow).candidateGroupId = 'grp-dm'
    ;(tampered.requestApprovals[1] as DbEvidenceRow).candidateGroupId = 'grp-sm'
    assert.ok(failing(evaluateT15aPersistedEvidence(tampered, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-captured-groups`))
  })

  it('a DANGLING candidateGroupId (group not found) FAILS', () => {
    const tampered = positiveData()
    ;(tampered.requestApprovals[1] as DbEvidenceRow).candidateGroupId = 'grp-does-not-exist'
    assert.ok(failing(evaluateT15aPersistedEvidence(tampered, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-captured-groups`))
  })

  it('a group belonging to ANOTHER instance linked from a row FAILS (never independent existence)', () => {
    const tampered = positiveData()
    tampered.candidateGroups.push({
      id: 'grp-other-instance',
      approvalInstanceId: 'inst-someone-else',
      requiredPositionId: POSITION_SECTION_MANAGER,
      scopeUnitId: 'unit-company',
      members: [{ userId: SECTION_MANAGER_P }],
    })
    ;(tampered.requestApprovals[0] as DbEvidenceRow).candidateGroupId = 'grp-other-instance'
    assert.ok(failing(evaluateT15aPersistedEvidence(tampered, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-captured-groups`))
  })

  it('an EXTRA group on the FINAL instance FAILS (exact two-group set)', () => {
    const tampered = positiveData()
    tampered.candidateGroups.push({
      id: 'grp-extra',
      approvalInstanceId: 'inst-15a',
      requiredPositionId: POSITION_DEPARTMENT_MANAGER,
      scopeUnitId: 'unit-company',
      members: [{ userId: DEPARTMENT_MANAGER }],
    })
    assert.ok(failing(evaluateT15aPersistedEvidence(tampered, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-captured-groups`))
  })

  it('UNRELATED request rows (other requestId / other instance groups) do NOT fail the T15A checks', () => {
    const untampered = positiveData()
    untampered.requests.push({ id: 'req-other', title: 'Business T15A other', status: 'FinalApproval', requesterId: REQUESTER_A })
    untampered.approvalInstances.push({
      id: 'inst-other', phase: 'FINAL', requestId: 'req-other', solutionId: null,
      routeVersionId: EXPECTED_FINAL_ROUTE, originUserId: REQUESTER_A, state: 'PENDING', attempt: 1,
      supersededAt: null, restartOfInstanceId: null, restartReason: null, restartedById: null,
    })
    untampered.requestApprovals.push(
      {
        id: 'ra-other-1', requestId: 'req-other', instanceId: null, order: 1, status: 'approved',
        requiredPositionId: POSITION_SECTION_MANAGER, candidateGroupId: 'grp-other-sm',
        approverId: SECTION_MANAGER_P, isFinalApproval: true, approvedAt: '2026-09-26T08:03:00Z',
      },
      {
        id: 'ra-other-2', requestId: 'req-other', instanceId: 'inst-other', order: 7, status: 'pending',
        requiredPositionId: POSITION_DEPARTMENT_MANAGER, candidateGroupId: 'grp-other-dm',
        approverId: null, isFinalApproval: false, approvedAt: null,
      },
    )
    untampered.candidateGroups.push(
      {
        id: 'grp-other-sm', approvalInstanceId: 'inst-other', requiredPositionId: POSITION_SECTION_MANAGER,
        scopeUnitId: 'unit-company', members: [{ userId: SECTION_MANAGER_P }],
      },
      {
        id: 'grp-other-dm', approvalInstanceId: 'inst-other', requiredPositionId: POSITION_DEPARTMENT_MANAGER,
        scopeUnitId: 'unit-company', members: [{ userId: DEPARTMENT_MANAGER }],
      },
    )
    const checks = evaluateT15aPersistedEvidence(untampered, { exactTitle: EXACT_TITLE })
    assert.ok(allPass(checks), `unrelated-request rows must not fail: ${failing(checks).join(', ')}`)
  })
})

describe('T15A persisted evidence: cross-request-linked FINAL row (Astra round-3 P1 — separate FK permits requestId/instanceId divergence)', () => {
  // The inspected UNION must be (sameRequest AND isFinalApproval) OR
  // (instanceId === the selected FINAL instance): a FOREIGN-request row
  // linked to the selected FINAL instance is INSPECTED and then must fail the
  // per-row identity requirement (requestId AND instanceId both correct).
  it('an APPENDED foreign-request row linked to the selected FINAL instance FAILS (no longer hidden)', () => {
    const tampered = positiveData()
    tampered.requestApprovals.push({
      id: 'ra-foreign-appended',
      requestId: 'req-foreign',
      instanceId: 'inst-15a',
      order: 3,
      status: 'approved',
      requiredPositionId: POSITION_DEPARTMENT_MANAGER,
      candidateGroupId: 'grp-dm',
      approverId: DEPARTMENT_MANAGER,
      isFinalApproval: true,
      approvedAt: '2026-09-27T00:00:00Z',
    })
    assert.ok(failing(evaluateT15aPersistedEvidence(tampered, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approved-rows`))
  })

  it('a REPLACEMENT foreign-request row on the same instance FAILS even though the count stays 2 (identity, not just count)', () => {
    const tampered = positiveData()
    ;(tampered.requestApprovals[1] as DbEvidenceRow).requestId = 'req-foreign'
    assert.ok(failing(evaluateT15aPersistedEvidence(tampered, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approved-rows`))
  })

  it('a REPLACEMENT foreign-request WRONG-FLAG row on the same instance FAILS (instance link brings it into the union)', () => {
    const tampered = positiveData()
    ;(tampered.requestApprovals[1] as DbEvidenceRow).requestId = 'req-foreign'
    ;(tampered.requestApprovals[1] as DbEvidenceRow).isFinalApproval = false
    assert.ok(failing(evaluateT15aPersistedEvidence(tampered, { exactTitle: EXACT_TITLE })).includes(`${PREFIX}/final-approved-rows`))
  })

  it('genuinely FOREIGN request + FOREIGN instance rows stay ignored (no cross-request contamination)', () => {
    const untampered = positiveData()
    untampered.requestApprovals.push(
      {
        id: 'ra-foreign-clean-final', requestId: 'req-foreign-2', instanceId: 'inst-foreign', order: 1, status: 'approved',
        requiredPositionId: POSITION_SECTION_MANAGER, candidateGroupId: 'grp-foreign-sm',
        approverId: SECTION_MANAGER_P, isFinalApproval: true, approvedAt: '2026-09-27T00:01:00Z',
      },
      {
        id: 'ra-foreign-clean-null', requestId: 'req-foreign-2', instanceId: null, order: 2, status: 'pending',
        requiredPositionId: POSITION_DEPARTMENT_MANAGER, candidateGroupId: null,
        approverId: null, isFinalApproval: false, approvedAt: null,
      },
    )
    const checks = evaluateT15aPersistedEvidence(untampered, { exactTitle: EXACT_TITLE })
    assert.ok(allPass(checks), `genuinely foreign rows must stay ignored: ${failing(checks).join(', ')}`)
  })
})

describe('T15A persisted evidence: capture assembler requirement matrix (exact runner call shape)', () => {
  it('a REQUIRED run with a MISSING T15A correlation FAILS — never skipped', () => {
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, { requireT15a: true })
    const missing = checks.find((check) => check.name === `${PREFIX}/browser-correlation-missing`)
    assert.ok(missing, 'the browser-correlation-missing check must be present')
    assert.equal(missing?.status, 'fail')
  })

  it('a REQUIRED run with a CORRUPT T15A correlation FAILS', () => {
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, {
      requireT15a: true,
      t15a: { status: 'corrupt' },
    })
    const corrupt = checks.find((check) => check.name === `${PREFIX}/browser-correlation-missing`)
    assert.equal(corrupt?.status, 'fail')
    assert.match(corrupt?.detail ?? '', /corrupt/)
  })

  it('a REQUIRED run with a PRESENT correlation runs the evaluator against the persisted rows', () => {
    const checks = assembleBusinessDbChecks(positiveData(), 'all-defaults', { status: 'missing' }, {
      requireT15a: true,
      t15a: { status: 'present', correlation: { requestTitle: EXACT_TITLE, attemptedClicks: 2, observedRequestCalls: 1, status: 'measured' } },
      requireT18b: false,
    })
    assert.ok(
      allPass(checks.filter((check) => check.name.startsWith(`${PREFIX}/`))),
      `T15A checks must all pass: ${failing(checks).join(', ')}`,
    )
    assert.ok(checks.some((check) => check.name === `${PREFIX}/request-present` && check.status === 'pass'))
  })

  it('a focused OTHER selection records T15A as a NOT-SELECTED skip — never a failure, never coverage', () => {
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, {
      requireT15a: false,
      focusedScenario: 'T18B',
    })
    const notSelected = checks.find((check) => check.name === `${PREFIX}/browser-correlation-not-selected`)
    assert.ok(notSelected, 'the not-selected skip must be present')
    assert.equal(notSelected?.status, 'skipped')
    assert.ok(!checks.some((check) => check.name === `${PREFIX}/browser-correlation-missing`))
  })
})

describe('T15A persisted evidence: gate + runner wiring', () => {
  it('t15aEvidenceApplies: REQUIRED for the default full all-defaults run AND focused T15A; false otherwise', () => {
    assert.equal(t15aEvidenceApplies('full', 'all-defaults', undefined), true)
    assert.equal(t15aEvidenceApplies('full', 'all-defaults', 'T15A'), true)
    for (const other of ['T18B', 'T18C2', 'T04B', 'T12A']) {
      assert.equal(t15aEvidenceApplies('full', 'all-defaults', other), false, `focused ${other} must not require T15A evidence`)
    }
    assert.equal(t15aEvidenceApplies('prepare', 'all-defaults', undefined), false)
    assert.equal(t15aEvidenceApplies('lifecycle-smoke', 'all-defaults', undefined), false)
    assert.equal(t15aEvidenceApplies('full', 'final-exception', undefined), false)
  })

  it('a failing T15A check keeps the run gate nonzero (generic fail stays nonzero)', () => {
    const gate = decideBusinessEvidenceGate({ mode: 'full', routesConfig: 'all-defaults', dbCapture: 'failed', dbFailureCount: 1, mailCapture: 'success' })
    assert.equal(gate.exitCode, 1)
  })

  it('the runner wires requireT15a through the shared applies seam (source pins)', async () => {
    const { readFileSync } = await import('node:fs')
    const runnerSource = readFileSync('tests/support/native/run-native-business-tests.ts', 'utf8')
    assert.match(runnerSource, /t15aEvidenceApplies\(options\.mode, options\.routesConfig, options\.scenario\)/)
    const captureSource = readFileSync('tests/support/native/capture-workflow-db-evidence.ts', 'utf8')
    assert.match(captureSource, /readT15aBrowserCorrelation\(evidenceDir\)/)
    assert.match(captureSource, /requireT15a: options\.requireT15a/)
  })
})
