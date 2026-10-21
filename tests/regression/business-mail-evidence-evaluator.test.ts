import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  evaluateCapturedMailEvidence,
  type CapturedMailSummaryMessage,
  type MailEvidenceRequestRow,
} from '../support/native/capture-workflow-mail-evidence'
import type { T15aCorrelationRead } from '../support/business-t15a-double-click'
import { decideBusinessEvidenceGate } from '../support/native/business-evidence-gate'
import { BUSINESS_FIXTURE_OUTBOUND_SENDER_ADDRESS } from '../support/native/seed-business-fixture-plan'

/**
 * Regression for the T13 mail evaluator (pure function, no I/O): it must
 * PASS the confirmed recipient matrix for the T12A all-defaults workflow,
 * FAIL visibly on non-participant recipients, non-fixture domains,
 * secret-looking envelope material and missing expected mails, and record
 * explicit `skipped` (never pass) when the scenario was not executed or
 * another route profile is active.
 *
 * Mail shapes mirror mail-capture.ts summarizeCapturedMessages output over
 * the real notification emails (notifications.ts subjects: "Approval
 * Needed: <title>", "Solution Ready: <title>", "Final Approval Needed:
 * <title>" carry the title; "Request Completed" does not and joins via the
 * requestId parsed from the request link). status_changed NEVER mails:
 * approvals.ts notifyRequestStatusChange persists the in-app row directly
 * (OWNER DECISION 2026-09-25, Task45: in-app-only channel), so the green
 * fixture carries NO "Request Status Changed" mail and the evaluator
 * treats one joined to the correlated request as a policy violation.
 *
 * The green path sends FROM the address the seed actually configures
 * (BUSINESS_FIXTURE_OUTBOUND_SENDER_ADDRESS — the import-safe seed-plan
 * constant consumed by seed-business-fixture.ts), so this regression fails
 * if the seeded outbound identity ever drifts off the evaluator's
 * fixture-domain contract again (T18B: seed used @example.test while the
 * evaluator requires @business.test for sender AND recipients).
 */

const TITLE = 'Business T12A 1789800000000-1234'
const REQUEST_ID = 'req-t12a-0001'

const P = {
  requesterA: 'user-requester-a@business.test',
  supervisorP: 'user-supervisor-p@business.test',
  sectionManagerP: 'user-section-manager-p@business.test',
  departmentManager: 'user-department-manager@business.test',
  secondApprover: 'user-second-approver@business.test',
  staffC: 'user-staff-c@business.test',
  inactive: 'user-inactive@business.test',
  unassigned: 'user-unassigned@business.test',
} as const

const T15A_TITLE = 'Business T15A 1789800000000-5678'
const T15A_REQUEST_ID = 'req-t15a-0001'
const T15A_CORRELATION: T15aCorrelationRead = {
  status: 'present',
  correlation: { requestTitle: T15A_TITLE, attemptedClicks: 2, observedRequestCalls: 2, status: 'measured' },
}

const REQUESTS: MailEvidenceRequestRow[] = [
  { id: REQUEST_ID, title: TITLE },
  // Task59: the default full all-defaults run now REQUIRES the T15A
  // duplicate-mail matrix as well; green full-run fixtures carry a valid
  // T15A request row + correlation + mails so T12A expectations stay exact.
  { id: T15A_REQUEST_ID, title: T15A_TITLE },
]

/** Task59: the green T15A FINAL-phase duplicate-mail capture (one mail per final-step recipient + one completion mail). */
function greenT15AMail(): CapturedMailSummaryMessage[] {
  return [
    mail({ subject: `Final Approval Needed: ${T15A_TITLE}`, to: P.sectionManagerP, requestId: T15A_REQUEST_ID }),
    mail({ subject: `Final Approval Needed: ${T15A_TITLE}`, to: P.departmentManager, requestId: T15A_REQUEST_ID }),
    mail({ subject: 'Request Completed', to: P.requesterA, requestId: T15A_REQUEST_ID }),
  ]
}

function mail(input: {
  subject: string
  to: string | string[]
  requestId?: string | null
  from?: string
}): CapturedMailSummaryMessage {
  return {
    receivedAt: '2026-09-19T00:00:00.000Z',
    from: input.from ?? BUSINESS_FIXTURE_OUTBOUND_SENDER_ADDRESS,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    requestId: input.requestId === undefined ? REQUEST_ID : input.requestId,
  }
}

/** The full expected T12A capture: every checkpoint mail, correct recipients. */
function greenT12AMail(): CapturedMailSummaryMessage[] {
  return greenMailFor(TITLE, REQUEST_ID)
}

/** greenT12AMail for an arbitrary (title, requestId) pair — used by the Task42 identity negatives. */
function greenMailFor(title: string, requestId: string): CapturedMailSummaryMessage[] {
  return [
    mail({ subject: `Approval Needed: ${title}`, to: [P.supervisorP, P.secondApprover], requestId }),
    mail({ subject: `Approval Needed: ${title}`, to: P.sectionManagerP, requestId }),
    mail({ subject: `Approval Needed: ${title}`, to: P.departmentManager, requestId }),
    mail({ subject: `Approval Needed: ${title}`, to: 'user-supervisor-e@business.test', requestId }),
    mail({ subject: `Solution Ready: ${title}`, to: P.requesterA, requestId }),
    mail({ subject: `Final Approval Needed: ${title}`, to: P.sectionManagerP, requestId }),
    mail({ subject: `Final Approval Needed: ${title}`, to: P.departmentManager, requestId }),
    mail({ subject: 'Request Completed', to: P.requesterA, requestId }),
  ]
}

function checksByName(checks: ReturnType<typeof evaluateCapturedMailEvidence>): Map<string, { status: string; detail: string }> {
  return new Map(checks.map((check) => [check.name, check]))
}

describe('business mail evidence evaluator', () => {
  it('passes the confirmed T12A recipient matrix (all-defaults)', () => {
    const checks = evaluateCapturedMailEvidence({
      messages: [...greenT12AMail(), ...greenT15AMail()],
      requests: REQUESTS,
      routesConfig: 'all-defaults',
      t15a: T15A_CORRELATION,
    })
    const byName = checksByName(checks)
    for (const check of checks) {
      assert.equal(check.status, 'pass', `${check.name}: ${check.detail}`)
    }
    // Honest counts (Task45; Task59): 13 checks total — 3 run-global + 8
    // scenario-group (6 positive SMTP expectations + 2 scenario negatives,
    // the second being the in-app-only status_changed check) + 2 T15A
    // duplicate-mail multiplicity checks. Nothing was dropped to turn this
    // green.
    assert.equal(checks.length, 13)
    assert.ok(byName.has('mail-evidence/Business T12A/create-approval-needed-to-current-candidates'))
    assert.ok(byName.has('mail-evidence/Business T12A/request-completed-to-requester'))
    assert.ok(byName.has('mail-evidence/Business T12A/status-changed-in-app-only-no-email'))
    assert.ok(byName.has('mail-evidence/Business T15A/final-approval-needed-exact-multiplicity'))
    assert.ok(byName.has('mail-evidence/Business T15A/completion-mail-once-to-requester'))
  })

  it('seeds the outbound sender on the fixture domain the evaluator requires (source-consumed seam)', () => {
    // The seed-plan constant is the actual fromAddress seeded into
    // email_settings; it must be the exact business.test sender.
    assert.equal(BUSINESS_FIXTURE_OUTBOUND_SENDER_ADDRESS, 'business-workflow-test@business.test')
    // And the evaluator must accept it as the envelope sender.
    const checks = evaluateCapturedMailEvidence({
      messages: greenT12AMail(),
      requests: REQUESTS,
      routesConfig: 'all-defaults',
    })
    assert.equal(checksByName(checks).get('mail-evidence/fixture-domains-only')?.status, 'pass')
  })

  it('fails on a wrong-domain SENDER (the T18B regression: @example.test envelope sender)', () => {
    const messages = [
      ...greenT12AMail(),
      mail({ subject: `Approval Needed: ${TITLE}`, to: P.supervisorP, from: 'business-workflow-test@example.test' }),
    ]
    const checks = evaluateCapturedMailEvidence({ messages, requests: REQUESTS, routesConfig: 'all-defaults' })
    const domains = checksByName(checks).get('mail-evidence/fixture-domains-only')
    assert.equal(domains?.status, 'fail', 'an example.test sender must fail the fixture-domain check')
    assert.match(domains?.detail ?? '', /business-workflow-test@example\.test/)
  })

  it('fails on a wrong-domain RECIPIENT envelope address', () => {
    const messages = [
      ...greenT12AMail(),
      mail({ subject: `Approval Needed: ${TITLE}`, to: 'someone@example.com' }),
    ]
    const checks = evaluateCapturedMailEvidence({ messages, requests: REQUESTS, routesConfig: 'all-defaults' })
    const domains = checksByName(checks).get('mail-evidence/fixture-domains-only')
    assert.equal(domains?.status, 'fail', 'an example.com recipient must fail the fixture-domain check')
    assert.match(domains?.detail ?? '', /someone@example\.com/)
  })

  it('joins the title-less subject (Request Completed) by requestId, not title', () => {
    // No message carries the title for the completion mail; only the
    // requestId join can satisfy the check. A completion mail for a
    // DIFFERENT request must not satisfy the T12A check.
    const messages = [
      ...greenT12AMail().filter((message) => message.subject !== 'Request Completed'),
      mail({ subject: 'Request Completed', to: P.requesterA, requestId: 'req-OTHER-0002' }),
    ]
    const checks = evaluateCapturedMailEvidence({ messages, requests: REQUESTS, routesConfig: 'all-defaults' })
    const completed = checksByName(checks).get('mail-evidence/Business T12A/request-completed-to-requester')
    assert.ok(completed)
    assert.equal(completed.status, 'fail', 'a completion mail for another request must not satisfy the T12A check')
  })

  it('fails when an expected recipient mail is missing', () => {
    const messages = greenT12AMail().filter((message) => message.subject !== `Solution Ready: ${TITLE}`)
    const checks = evaluateCapturedMailEvidence({ messages, requests: REQUESTS, routesConfig: 'all-defaults' })
    const solutionReady = checksByName(checks).get('mail-evidence/Business T12A/solution-ready-to-requester')
    assert.ok(solutionReady)
    assert.equal(solutionReady.status, 'fail')
    assert.match(solutionReady.detail, /Solution Ready/)
  })

  it('fails on any mail to Staff C / inactive / unassigned (run-global and scenario)', () => {
    const messages = [
      ...greenT12AMail(),
      mail({ subject: `Approval Needed: ${TITLE}`, to: P.staffC }),
    ]
    const checks = evaluateCapturedMailEvidence({ messages, requests: REQUESTS, routesConfig: 'all-defaults' })
    const byName = checksByName(checks)
    const global = byName.get('mail-evidence/zero-mail-to-non-participants')
    const scenario = byName.get('mail-evidence/Business T12A/zero-scenario-mail-to-non-participants')
    assert.equal(global?.status, 'fail')
    assert.equal(scenario?.status, 'fail')
    assert.match(global?.detail ?? '', /user-staff-c@business.test/)
  })

  it('fails on secret-looking material in envelope fields', () => {
    const messages = [
      ...greenT12AMail(),
      mail({ subject: 'Approval Needed: password=hunter2', to: P.supervisorP, requestId: null }),
    ]
    const checks = evaluateCapturedMailEvidence({ messages, requests: REQUESTS, routesConfig: 'all-defaults' })
    const secrets = checksByName(checks).get('mail-evidence/no-secrets-in-envelope')
    assert.equal(secrets?.status, 'fail')
  })

  it('records an explicit skipped T12A scenario (never pass) when a DIFFERENT focused scenario ran', () => {
    const checks = evaluateCapturedMailEvidence({
      messages: greenT12AMail(),
      requests: [],
      routesConfig: 'all-defaults',
      focusedScenario: 'T18B',
    })
    const scenario = checksByName(checks).get('mail-evidence/Business T12A')
    assert.equal(scenario?.status, 'skipped')
    assert.match(scenario?.detail ?? '', /no coverage claimed|NOT run/)
    // Global envelope checks still run.
    assert.equal(checksByName(checks).get('mail-evidence/fixture-domains-only')?.status, 'pass')
  })

  it('skips the T12A recipient matrix under other route profiles while keeping global checks', () => {
    const checks = evaluateCapturedMailEvidence({
      messages: [],
      requests: REQUESTS,
      routesConfig: 'final-exception',
    })
    const scenario = checksByName(checks).get('mail-evidence/Business T12A')
    assert.equal(scenario?.status, 'skipped')
    assert.match(scenario?.detail ?? '', /final-exception/)
    assert.equal(checksByName(checks).get('mail-evidence/zero-mail-to-non-participants')?.status, 'pass')
  })
})

describe('business mail evidence evaluator: T12A REQUIRED-positive matrix (Task41)', () => {
  it('default full all-defaults run: a missing T12A request FAILS — required evidence, never a skip and never a vacuous pass', () => {
    const checks = evaluateCapturedMailEvidence({ messages: [], requests: [], routesConfig: 'all-defaults' })
    const byName = checksByName(checks)
    const present = byName.get('mail-evidence/Business T12A/request-present')
    assert.ok(present, 'the required request-present check must exist')
    assert.equal(present.status, 'fail')
    assert.match(present.detail, /REQUIRED T12A request/)
    assert.match(present.detail, /not skipped/)
    assert.equal(byName.get('mail-evidence/Business T12A'), undefined, 'no skip entry may coexist with the required failure')
    // The 3 run-global envelope checks still pass; the failures are the
    // missing REQUIRED scenario evidence itself (zero-mail-to-non-
    // participants alone is vacuous and never sufficient). Task59: the same
    // default full run also REQUIRES the T15A duplicate-mail matrix — its
    // absent correlation fails closed alongside the missing T12A request.
    assert.deepEqual(
      checks.filter((check) => check.status === 'fail').map((check) => check.name),
      ['mail-evidence/Business T12A/request-present', 'mail-evidence/Business T15A/browser-correlation-missing'],
    )
  })

  it('focused T12A selection: a missing T12A request FAILS the same required matrix', () => {
    const checks = evaluateCapturedMailEvidence({
      messages: [],
      requests: [{ id: 'req-other', title: 'Business T18B 1' }],
      routesConfig: 'all-defaults',
      focusedScenario: 'T12A',
    })
    const present = checksByName(checks).get('mail-evidence/Business T12A/request-present')
    assert.equal(present?.status, 'fail')
    assert.match(present?.detail ?? '', /REQUIRED T12A request/)
  })

  it('focused T12A with the request present but ZERO captured messages fails every delivery check (no vacuous pass)', () => {
    const checks = evaluateCapturedMailEvidence({
      messages: [],
      requests: REQUESTS,
      routesConfig: 'all-defaults',
      focusedScenario: 'T12A',
    })
    const byName = checksByName(checks)
    assert.equal(byName.get('mail-evidence/Business T12A/request-present'), undefined, 'request exists — no request-present entry')
    for (const name of [
      'mail-evidence/Business T12A/create-approval-needed-to-current-candidates',
      'mail-evidence/Business T12A/request-step2-approval-needed-section-manager',
      'mail-evidence/Business T12A/request-step3-approval-needed-department-manager',
      'mail-evidence/Business T12A/solution-ready-to-requester',
      'mail-evidence/Business T12A/final-approval-needed-to-final-candidates',
      'mail-evidence/Business T12A/request-completed-to-requester',
    ]) {
      assert.equal(byName.get(name)?.status, 'fail', `${name} must fail with zero messages`)
    }
    // The status_changed in-app-only negative passes vacuously here, but it
    // can NEVER carry the matrix alone: the six required positives above
    // fail, so a zero-mail capture still fails (no 0-mail pass).
    assert.equal(byName.get('mail-evidence/Business T12A/status-changed-in-app-only-no-email')?.status, 'pass')
    // zero-scenario-mail-to-non-participants passes VACUOUSLY here — alone it
    // is not sufficient, the failing delivery matrix carries the failure.
    assert.equal(byName.get('mail-evidence/Business T12A/zero-scenario-mail-to-non-participants')?.status, 'pass')
    assert.ok(checks.filter((check) => check.status === 'fail').length >= 6)
  })

  it('ambiguous identity: multiple Business T12A request rows FAIL instead of prefix-matching the first', () => {
    const checks = evaluateCapturedMailEvidence({
      messages: greenT12AMail(),
      requests: [
        { id: 'req-t12a-0001', title: TITLE },
        { id: 'req-t12a-0002', title: 'Business T12A 1789800000001-9999' },
      ],
      routesConfig: 'all-defaults',
    })
    const present = checksByName(checks).get('mail-evidence/Business T12A/request-present')
    assert.equal(present?.status, 'fail')
    assert.match(present?.detail ?? '', /ambiguous/)
    assert.match(present?.detail ?? '', /2 rows/)
  })

  it('focused T18C2/T04B selections keep the run-global mail checks green and skip T12A explicitly (no failure)', () => {
    for (const focusedScenario of ['T18C2', 'T04B'] as const) {
      const checks = evaluateCapturedMailEvidence({ messages: [], requests: [], routesConfig: 'all-defaults', focusedScenario })
      const byName = checksByName(checks)
      assert.deepEqual(checks.filter((check) => check.status === 'fail'), [], `focused ${focusedScenario} must not fail mail evidence`)
      assert.equal(byName.get('mail-evidence/Business T12A')?.status, 'skipped')
      assert.match(byName.get('mail-evidence/Business T12A')?.detail ?? '', new RegExp(`focused ${focusedScenario} run`))
      for (const global of [
        'mail-evidence/fixture-domains-only',
        'mail-evidence/no-secrets-in-envelope',
        'mail-evidence/zero-mail-to-non-participants',
      ]) {
        assert.equal(byName.get(global)?.status, 'pass', global)
      }
    }
  })

  it('the required matrix still PASSES green when the focused T12A capture satisfies it', () => {
    const checks = evaluateCapturedMailEvidence({
      messages: greenT12AMail(),
      requests: REQUESTS,
      routesConfig: 'all-defaults',
      focusedScenario: 'T12A',
    })
    // Task59: a focused T12A run records T15A as an explicit not-selected
    // skip — no T15A coverage claimed; every OTHER check stays green.
    const skippedT15a = checks.filter((check) => check.status === 'skipped')
    assert.deepEqual(skippedT15a.map((check) => check.name), ['mail-evidence/Business T15A'])
    for (const check of checks.filter((check) => check.status !== 'skipped')) {
      assert.equal(check.status, 'pass', `${check.name}: ${check.detail}`)
    }
  })

  it('the evidence gate fails closed on a thrown or missing mail capture for full runs (generic, not scenario-specific)', () => {
    for (const mailCapture of ['thrown', 'null', 'not-applicable', 'failed'] as const) {
      const gate = decideBusinessEvidenceGate({
        mode: 'full',
        routesConfig: 'all-defaults',
        dbCapture: 'success',
        mailCapture,
        mailFailureCount: mailCapture === 'failed' ? 1 : 0,
      })
      assert.equal(gate.status, 'failed', `mailCapture=${mailCapture} must fail the gate`)
      assert.equal(gate.exitCode, 1)
    }
    // Modes that never start mail capture stay green.
    const prepare = decideBusinessEvidenceGate({
      mode: 'prepare', routesConfig: 'all-defaults', dbCapture: 'success', mailCapture: 'not-applicable',
    })
    assert.equal(prepare.status, 'passed')
  })
})

describe('business mail evidence evaluator: status_changed is in-app only (OWNER DECISION 2026-09-25, Task45)', () => {
  it('a "Request Status Changed" email joined to the T12A request FAILS the channel-policy check', () => {
    const messages = [
      ...greenT12AMail(),
      ...greenT15AMail(),
      mail({ subject: 'Request Status Changed', to: P.requesterA }),
    ]
    const checks = evaluateCapturedMailEvidence({ messages, requests: REQUESTS, routesConfig: 'all-defaults', t15a: T15A_CORRELATION })
    const statusChanged = checksByName(checks).get('mail-evidence/Business T12A/status-changed-in-app-only-no-email')
    assert.ok(statusChanged, 'the in-app-only policy check must exist')
    assert.equal(statusChanged.status, 'fail', 'a status_changed email is a channel-policy violation')
    assert.match(statusChanged.detail, /Request Status Changed/)
    assert.match(statusChanged.detail, /user-requester-a@business\.test/)
    // Only the policy check fails; the six required positives (and the
    // Task59 T15A multiplicity checks) stay green.
    assert.deepEqual(
      checks.filter((check) => check.status === 'fail').map((check) => check.name),
      ['mail-evidence/Business T12A/status-changed-in-app-only-no-email'],
    )
  })

  it('a "Request Status Changed" email for a DIFFERENT request does not violate the correlated-request policy (exact request scoping)', () => {
    const messages = [
      ...greenT12AMail(),
      ...greenT15AMail(),
      mail({ subject: 'Request Status Changed', to: P.requesterA, requestId: 'req-OTHER-0002' }),
    ]
    const checks = evaluateCapturedMailEvidence({ messages, requests: REQUESTS, routesConfig: 'all-defaults', t15a: T15A_CORRELATION })
    for (const check of checks) {
      assert.equal(check.status, 'pass', `${check.name}: ${check.detail}`)
    }
  })
})

describe('business mail evidence evaluator: status_changed negative identity integrity (Task46, pinned Astra P1)', () => {
  const STATUS_CHECK = 'mail-evidence/Business T12A/status-changed-in-app-only-no-email'

  function statusCheckStatus(extra: CapturedMailSummaryMessage): { status: string | undefined; detail: string; failingNames: string[]; checkCount: number } {
    const checks = evaluateCapturedMailEvidence({
      messages: [...greenT12AMail(), ...greenT15AMail(), extra],
      requests: REQUESTS,
      routesConfig: 'all-defaults',
      t15a: T15A_CORRELATION,
    })
    const byName = checksByName(checks)
    return {
      status: byName.get(STATUS_CHECK)?.status,
      detail: byName.get(STATUS_CHECK)?.detail ?? '',
      failingNames: checks.filter((check) => check.status === 'fail').map((check) => check.name),
      checkCount: checks.length,
    }
  }

  it('indeterminate identity (null/empty id, parser issue, or issue-even-with-id) FAILS the negative — absence cannot be proven', () => {
    const variants: Array<{ label: string; message: CapturedMailSummaryMessage }> = [
      {
        label: 'conflicting request ids',
        message: { ...mail({ subject: 'Request Status Changed', to: P.requesterA, requestId: null }), requestIdIssue: 'conflicting-request-ids' },
      },
      {
        label: 'malformed content-transfer-encoding',
        message: { ...mail({ subject: 'Request Status Changed', to: P.requesterA, requestId: null }), requestIdIssue: 'malformed-transfer-encoding' },
      },
      {
        label: 'empty request id value',
        message: { ...mail({ subject: 'Request Status Changed', to: P.requesterA, requestId: '' }), requestIdIssue: 'empty-request-id-value' },
      },
      {
        label: 'missing id (null, no issue recorded)',
        message: mail({ subject: 'Request Status Changed', to: P.requesterA, requestId: null }),
      },
      {
        label: 'issue even with a DIFFERENT id present',
        message: { ...mail({ subject: 'Request Status Changed', to: P.requesterA, requestId: 'req-OTHER-0002' }), requestIdIssue: 'conflicting-request-ids' },
      },
    ]
    for (const variant of variants) {
      const result = statusCheckStatus(variant.message)
      assert.equal(result.status, 'fail', `${variant.label}: indeterminate identity must fail the negative`)
      assert.match(result.detail, /indeterminate/, `${variant.label}: the fail must be labeled indeterminate`)
      assert.match(result.detail, /Request Status Changed/, `${variant.label}: the diagnostic names the forbidden subject`)
      assert.match(result.detail, /cannot prove|unusable|unavailable/, `${variant.label}: the diagnostic explains why absence is unproven`)
      // Only the subject-scoped negative fails; the green matrix and the
      // other checks stay green, and the total count is unchanged.
      assert.deepEqual(result.failingNames, [STATUS_CHECK], `${variant.label}: only the negative check may fail`)
      assert.equal(result.checkCount, 13, `${variant.label}: 13 checks unchanged (3 global + 6 positive + 2 negative + 2 T15A Task59)`)
    }
  })

  it('a VALID id equal to the selected request FAILS the negative as a forbidden violation (not indeterminate)', () => {
    const result = statusCheckStatus(mail({ subject: 'Request Status Changed', to: P.requesterA }))
    assert.equal(result.status, 'fail')
    assert.doesNotMatch(result.detail, /indeterminate/, 'a valid same-id join is a proven violation, never indeterminate')
    assert.match(result.detail, /user-requester-a@business\.test/)
    assert.deepEqual(result.failingNames, [STATUS_CHECK])
  })

  it('a demonstrably DIFFERENT valid id is excluded — the negative passes', () => {
    const result = statusCheckStatus(mail({ subject: 'Request Status Changed', to: P.requesterA, requestId: 'req-OTHER-0002' }))
    assert.equal(result.status, 'pass', 'a different valid id cannot be the T12A request mail')
    assert.deepEqual(result.failingNames, [], 'the whole matrix stays green')
    assert.equal(result.checkCount, 13)
  })

  it('an unrelated subject with unusable identity is NOT implicitly negative-related (subject scoping)', () => {
    const result = statusCheckStatus({
      ...mail({ subject: 'Approval Needed: Some Other Title', to: P.supervisorP, requestId: null }),
      requestIdIssue: 'malformed-request-link',
    })
    assert.equal(result.status, 'pass', 'only the forbidden subject may trip the negative')
    assert.equal(result.checkCount, 13)
  })
})

describe('business mail evidence evaluator: T12A request identity delimiter (Task42)', () => {
  const WRONG_LONGER_TITLE = 'Business T12AB123-456'
  const WRONG_ID = 'req-t12ab-0001'

  it('a longer wrong token row (Business T12AB…) carrying ALL otherwise-qualifying delivery mails FAILS request-present — never a false pass, never a silent skip (default full run)', () => {
    const checks = evaluateCapturedMailEvidence({
      messages: greenMailFor(WRONG_LONGER_TITLE, WRONG_ID),
      requests: [{ id: WRONG_ID, title: WRONG_LONGER_TITLE }],
      routesConfig: 'all-defaults',
    })
    const byName = checksByName(checks)
    const present = byName.get('mail-evidence/Business T12A/request-present')
    assert.ok(present, 'the required request-present check must exist')
    assert.equal(present.status, 'fail')
    assert.match(present.detail, /REQUIRED T12A request/)
    assert.equal(byName.get('mail-evidence/Business T12A'), undefined, 'no skip entry may coexist')
    // The failing checks are the missing REQUIRED identities — the wrong
    // row's qualifying mails must NOT satisfy the matrix in its place, and
    // (Task59) the default full run's T15A correlation fails closed too.
    assert.deepEqual(
      checks.filter((check) => check.status === 'fail').map((check) => check.name),
      ['mail-evidence/Business T12A/request-present', 'mail-evidence/Business T15A/browser-correlation-missing'],
    )
  })

  it('same negative under the FOCUSED required T12A selection', () => {
    const checks = evaluateCapturedMailEvidence({
      messages: greenMailFor(WRONG_LONGER_TITLE, WRONG_ID),
      requests: [{ id: WRONG_ID, title: WRONG_LONGER_TITLE }],
      routesConfig: 'all-defaults',
      focusedScenario: 'T12A',
    })
    assert.equal(checksByName(checks).get('mail-evidence/Business T12A/request-present')?.status, 'fail')
  })

  it('T12A1-style, empty-suffix and bare-token rows never qualify as the T12A request', () => {
    for (const title of ['Business T12A1 999-1', 'Business T12A   ', 'Business T12A', 'Business T12A-999-9']) {
      const checks = evaluateCapturedMailEvidence({
        messages: greenT12AMail(),
        requests: [{ id: 'req-x', title }],
        routesConfig: 'all-defaults',
      })
      assert.equal(
        checksByName(checks).get('mail-evidence/Business T12A/request-present')?.status,
        'fail',
        `title=${JSON.stringify(title)} must not qualify`,
      )
    }
  })

  it('a valid T12A row plus an unrelated longer row selects EXACTLY the valid one (green matrix passes, latter ignored)', () => {
    const checks = evaluateCapturedMailEvidence({
      messages: greenT12AMail(),
      requests: [REQUESTS[0], { id: 'req-unrelated', title: 'Business T12AB9-9' }],
      routesConfig: 'all-defaults',
      focusedScenario: 'T12A',
    })
    // Task59: focused T12A records T15A as an explicit not-selected skip;
    // every executed check stays green.
    const skippedT15a = checks.filter((check) => check.status === 'skipped')
    assert.deepEqual(skippedT15a.map((check) => check.name), ['mail-evidence/Business T15A'])
    for (const check of checks.filter((check) => check.status !== 'skipped')) {
      assert.equal(check.status, 'pass', `${check.name}: ${check.detail}`)
    }
  })
})
