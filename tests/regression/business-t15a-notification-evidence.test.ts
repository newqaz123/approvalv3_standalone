import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  assembleBusinessDbChecks,
  businessNotificationsSelectSql,
  type DbEvidenceData,
  type DbEvidenceRow,
  type WorkflowCheck,
} from '../support/native/capture-workflow-db-evidence'
import {
  evaluateT15aNotificationEvidence,
  T15A_NOTIFICATION_CHECK_PREFIX,
} from '../support/native/t15a-notification-evidence'
import { evaluateCapturedMailEvidence, type CapturedMailSummaryMessage } from '../support/native/capture-workflow-mail-evidence'
import { parseT15aBrowserCorrelation, type T15aCorrelationRead } from '../support/business-t15a-double-click'
import { t15aEvidenceApplies } from '../support/native/business-evidence-gate'

/**
 * Task59 — REQUIRED T15A duplicate alert/mail evidence (runner-owned,
 * READ-ONLY, test-only). Every expected count is pinned against the ACTUAL
 * product sources, nothing invented:
 *  - solutions.ts queueNextFinalApproverNotifications resolves the CURRENT
 *    pending FINAL row's active candidates (all-defaults T15A chain:
 *    section manager group [user-section-manager-p], then department
 *    manager group [user-department-manager]) → one in-app notification AND
 *    one email per candidate per event;
 *  - notifications.ts createNotification → one notifications row per plan
 *    and one sendMail to that single user (never multicast);
 *  - notifications.ts sendEmailNotification maps final_approval_needed to
 *    subject "Final Approval Needed: <request title>";
 *  - solutions.ts approveFinalApproval completion branch is the ONLY
 *    approval_granted producer: requester-only recipients, in-app title
 *    'Request Completed', email subject carries no title (joins by the
 *    requestId parsed from the request link).
 *
 * Honest scope: FINAL-phase multiplicity only; server-race proof stays a
 * separate pending task; T12A/global mail policy requirements unchanged.
 */

const EXACT_TITLE = 'Business T15A 1789800000000-42'
const REQUESTER_A = 'user-requester-a'
const SECTION_MANAGER_P = 'user-section-manager-p'
const DEPARTMENT_MANAGER = 'user-department-manager'
const DB_PREFIX = T15A_NOTIFICATION_CHECK_PREFIX
const MAIL_PREFIX_FINAL = 'mail-evidence/Business T15A/final-approval-needed-exact-multiplicity'
const MAIL_PREFIX_COMPLETION = 'mail-evidence/Business T15A/completion-mail-once-to-requester'

const CORRELATION = parseT15aBrowserCorrelation(
  JSON.stringify({ requestTitle: EXACT_TITLE, attemptedClicks: 2, observedRequestCalls: 2, status: 'measured' }),
)

function notificationRows(): DbEvidenceRow[] {
  return [
    { id: 'ntf-1', requestId: 'req-15a', userId: SECTION_MANAGER_P, type: 'final_approval_needed' },
    { id: 'ntf-2', requestId: 'req-15a', userId: DEPARTMENT_MANAGER, type: 'final_approval_needed' },
    { id: 'ntf-3', requestId: 'req-15a', userId: REQUESTER_A, type: 'approval_granted' },
    // Foreign-request rows exist in the same capture and must NEVER count.
    { id: 'ntf-f1', requestId: 'req-other', userId: SECTION_MANAGER_P, type: 'final_approval_needed' },
    { id: 'ntf-f2', requestId: 'req-other', userId: REQUESTER_A, type: 'approval_granted' },
  ]
}

function notificationData(notifications: DbEvidenceRow[]): DbEvidenceData {
  return {
    requests: [
      { id: 'req-15a', title: EXACT_TITLE, status: 'Completed', requesterId: REQUESTER_A },
      { id: 'req-other', title: 'Business T18B other', status: 'Completed', requesterId: REQUESTER_A },
    ],
    solutions: [],
    approvalInstances: [],
    candidateGroups: [],
    requestApprovals: [],
    solutionApprovals: [],
    instanceSkips: [],
    routeVersions: [],
    requestActivities: [],
    notifications,
  }
}

const allPass = (checks: WorkflowCheck[]): boolean => checks.length > 0 && checks.every((check) => check.status === 'pass')
const failing = (checks: WorkflowCheck[]): string[] => checks.filter((check) => check.status === 'fail').map((check) => check.name)

describe('T15A notification multiplicity evaluator (DB, duplicate-alert evidence)', () => {
  it('positive control: exactly one final_approval_needed per FINAL-step recipient and one completion row', () => {
    assert.ok(CORRELATION.status === 'present')
    const checks = evaluateT15aNotificationEvidence(notificationData(notificationRows()), { exactTitle: EXACT_TITLE })
    assert.ok(allPass(checks), `unexpected failures: ${failing(checks).join(', ')}`)
  })

  it('missing or ambiguous exact title FAILS (never skipped)', () => {
    const missing = notificationData(notificationRows())
    missing.requests = missing.requests.filter((row) => row.title !== EXACT_TITLE)
    assert.ok(failing(evaluateT15aNotificationEvidence(missing, { exactTitle: EXACT_TITLE })).includes(`${DB_PREFIX}/request-present`))

    const ambiguous = notificationData(notificationRows())
    ambiguous.requests.push({ ...(ambiguous.requests[0] as DbEvidenceRow), id: 'req-15a-dup' })
    assert.ok(failing(evaluateT15aNotificationEvidence(ambiguous, { exactTitle: EXACT_TITLE })).includes(`${DB_PREFIX}/request-present`))
  })

  it('a DUPLICATE final_approval_needed row for any recipient FAILS', () => {
    const duplicateSection = notificationData(notificationRows())
    duplicateSection.notifications?.push({ id: 'ntf-1-dup', requestId: 'req-15a', userId: SECTION_MANAGER_P, type: 'final_approval_needed' })
    assert.ok(failing(evaluateT15aNotificationEvidence(duplicateSection, { exactTitle: EXACT_TITLE })).includes(`${DB_PREFIX}/final-approval-needed-multiset`))

    const duplicateDepartment = notificationData(notificationRows())
    duplicateDepartment.notifications?.push({ id: 'ntf-2-dup', requestId: 'req-15a', userId: DEPARTMENT_MANAGER, type: 'final_approval_needed' })
    assert.ok(failing(evaluateT15aNotificationEvidence(duplicateDepartment, { exactTitle: EXACT_TITLE })).includes(`${DB_PREFIX}/final-approval-needed-multiset`))
  })

  it('a MISSING final_approval_needed recipient FAILS', () => {
    const missingDepartment = notificationData(notificationRows().filter((row) => row.id !== 'ntf-2'))
    assert.ok(failing(evaluateT15aNotificationEvidence(missingDepartment, { exactTitle: EXACT_TITLE })).includes(`${DB_PREFIX}/final-approval-needed-multiset`))
  })

  it('a WRONG final_approval_needed recipient FAILS', () => {
    const wrongRecipient = notificationData(notificationRows())
    ;(wrongRecipient.notifications?.[1] as DbEvidenceRow).userId = 'user-staff-b'
    assert.ok(failing(evaluateT15aNotificationEvidence(wrongRecipient, { exactTitle: EXACT_TITLE })).includes(`${DB_PREFIX}/final-approval-needed-multiset`))
  })

  it('foreign-request rows are excluded, never counted for the selected request', () => {
    const onlyForeign = notificationData([])
    assert.ok(failing(evaluateT15aNotificationEvidence(onlyForeign, { exactTitle: EXACT_TITLE })).includes(`${DB_PREFIX}/final-approval-needed-multiset`))
  })

  it('a missing notifications capture (zero rows / absent projection) FAILS closed', () => {
    const zeroRows = notificationData([])
    assert.ok(failing(evaluateT15aNotificationEvidence(zeroRows, { exactTitle: EXACT_TITLE })).length >= 2)

    const absentProjection = notificationData([])
    delete absentProjection.notifications
    assert.ok(failing(evaluateT15aNotificationEvidence(absentProjection, { exactTitle: EXACT_TITLE })).includes(`${DB_PREFIX}/final-approval-needed-multiset`))
  })

  it('completion notification: duplicate, missing, or wrong recipient FAILS; foreign excluded', () => {
    const duplicate = notificationData(notificationRows())
    duplicate.notifications?.push({ id: 'ntf-3-dup', requestId: 'req-15a', userId: REQUESTER_A, type: 'approval_granted' })
    assert.ok(failing(evaluateT15aNotificationEvidence(duplicate, { exactTitle: EXACT_TITLE })).includes(`${DB_PREFIX}/completion-notification-once-to-requester`))

    const missing = notificationData(notificationRows().filter((row) => row.id !== 'ntf-3'))
    assert.ok(failing(evaluateT15aNotificationEvidence(missing, { exactTitle: EXACT_TITLE })).includes(`${DB_PREFIX}/completion-notification-once-to-requester`))

    const wrongRecipient = notificationData(notificationRows())
    ;(wrongRecipient.notifications?.[2] as DbEvidenceRow).userId = 'user-staff-b'
    assert.ok(failing(evaluateT15aNotificationEvidence(wrongRecipient, { exactTitle: EXACT_TITLE })).includes(`${DB_PREFIX}/completion-notification-once-to-requester`))
  })
})

describe('T15A notification checks in the DB assembler (wiring, no weakening)', () => {
  const correlationInput: T15aCorrelationRead = { status: 'present', correlation: { requestTitle: EXACT_TITLE, attemptedClicks: 2, observedRequestCalls: 2, status: 'measured' } }

  it('focused T15A with a present correlation appends the notification checks after the persisted checks', () => {
    const checks = assembleBusinessDbChecks(notificationData(notificationRows()), 'all-defaults', { status: 'missing' as const }, {
      requireT18b: false,
      requireT15a: true,
      t15a: correlationInput,
      focusedScenario: 'T15A',
    })
    const names = checks.map((check) => check.name)
    assert.ok(names.includes(`${DB_PREFIX}/final-approval-needed-multiset`))
    assert.ok(names.includes(`${DB_PREFIX}/completion-notification-once-to-requester`))
    assert.ok(
      allPass(checks.filter((check) => check.name.startsWith(`${DB_PREFIX}/`))),
      `T15A notification checks must all pass: ${failing(checks).join(', ')}`,
    )
  })

  it('a notification failure inside the assembler FAILS the run capture (not skipped)', () => {
    const duplicate = notificationData(notificationRows())
    duplicate.notifications?.push({ id: 'ntf-1-dup', requestId: 'req-15a', userId: SECTION_MANAGER_P, type: 'final_approval_needed' })
    const checks = assembleBusinessDbChecks(duplicate, 'all-defaults', { status: 'missing' as const }, {
      requireT18b: false,
      requireT15a: true,
      t15a: correlationInput,
      focusedScenario: 'T15A',
    })
    assert.ok(failing(checks).includes(`${DB_PREFIX}/final-approval-needed-multiset`))
  })

  it('a focused OTHER selection records T15A as an explicit not-selected skip with no notification checks claimed', () => {
    const checks = assembleBusinessDbChecks(notificationData([]), 'all-defaults', { status: 'missing' as const }, {
      requireT18b: false,
      requireT15a: false,
      focusedScenario: 'T18B',
    })
    const names = checks.map((check) => check.name)
    assert.ok(names.includes('db-evidence/Business T15A/persisted-single-transition/browser-correlation-not-selected'))
    assert.ok(!names.some((name) => name.startsWith(DB_PREFIX)))
  })

  it('a missing or corrupt T15A correlation FAILS closed before any notification check runs', () => {
    for (const status of ['missing', 'corrupt'] as const) {
      const checks = assembleBusinessDbChecks(notificationData(notificationRows()), 'all-defaults', { status: 'missing' as const }, {
        requireT18b: false,
        requireT15a: true,
        t15a: { status },
        focusedScenario: 'T15A',
      })
      assert.ok(failing(checks).includes('db-evidence/Business T15A/persisted-single-transition/browser-correlation-missing'))
      assert.ok(!checks.map((check) => check.name).some((name) => name.startsWith(DB_PREFIX)))
    }
  })
})

function mailMessage(input: Partial<CapturedMailSummaryMessage> & { subject: string; to: string[] }): CapturedMailSummaryMessage {
  return { receivedAt: '2026-09-26T08:00:00Z', from: 'notify@business.test', requestId: null, ...input }
}

function positiveMail(): CapturedMailSummaryMessage[] {
  return [
    mailMessage({ subject: `Final Approval Needed: ${EXACT_TITLE}`, to: ['user-section-manager-p@business.test'], requestId: 'req-15a' }),
    mailMessage({ subject: `Final Approval Needed: ${EXACT_TITLE}`, to: ['user-department-manager@business.test'], requestId: 'req-15a' }),
    mailMessage({ subject: 'Request Completed', to: ['user-requester-a@business.test'], requestId: 'req-15a' }),
    // Foreign valid requests' mail is excluded by its parsed id.
    mailMessage({ subject: 'Request Completed', to: ['user-requester-a@business.test'], requestId: 'req-other' }),
    mailMessage({ subject: 'Final Approval Needed: Business T12A other-title', to: ['user-section-manager-p@business.test'], requestId: 'req-t12a' }),
    // Other-event mail on the same request does not disturb the matrix.
    mailMessage({ subject: `Approval Needed: ${EXACT_TITLE}`, to: ['user-supervisor-p@business.test'], requestId: 'req-15a' }),
  ]
}

function evaluateMail(messages: readonly CapturedMailSummaryMessage[], focusedScenario?: string, t15a: T15aCorrelationRead = CORRELATION) {
  return evaluateCapturedMailEvidence({
    messages,
    requests: [
      { id: 'req-15a', title: EXACT_TITLE },
      { id: 'req-other', title: 'Business T18B other' },
      { id: 'req-t12a', title: 'Business T12A other-title' },
    ],
    routesConfig: 'all-defaults',
    focusedScenario,
    t15a,
  })
}

const t15aMailChecks = (checks: WorkflowCheck[]): WorkflowCheck[] =>
  checks.filter((check) => check.name.startsWith('mail-evidence/Business T15A'))

describe('T15A duplicate-mail multiplicity evaluator (exact distinct-message counts)', () => {
  it('positive control: two Final Approval Needed messages (one per recipient) and one completion mail', () => {
    const checks = evaluateMail(positiveMail())
    assert.ok(allPass(t15aMailChecks(checks)), `unexpected failures: ${failing(t15aMailChecks(checks)).join(', ')}`)
    // T12A policy checks are not weakened by the new block.
    assert.ok(checks.some((check) => check.name === 'mail-evidence/Business T12A/final-approval-needed-to-final-candidates'))
  })

  it('a DUPLICATE Final Approval Needed mail to any recipient FAILS (dedup must never conceal it)', () => {
    const duplicate = [...positiveMail(), mailMessage({ subject: `Final Approval Needed: ${EXACT_TITLE}`, to: ['user-section-manager-p@business.test'], requestId: 'req-15a' })]
    assert.ok(failing(evaluateMail(duplicate)).includes(MAIL_PREFIX_FINAL))
  })

  it('a single MULTICAST message to both final approvers FAILS (two distinct sends are required)', () => {
    const multicast = [
      mailMessage({ subject: `Final Approval Needed: ${EXACT_TITLE}`, to: ['user-section-manager-p@business.test', 'user-department-manager@business.test'], requestId: 'req-15a' }),
      mailMessage({ subject: 'Request Completed', to: ['user-requester-a@business.test'], requestId: 'req-15a' }),
    ]
    assert.ok(failing(evaluateMail(multicast)).includes(MAIL_PREFIX_FINAL))
  })

  it('a MISSING Final Approval Needed recipient or a WRONG recipient FAILS', () => {
    const missingDepartment = positiveMail().filter((message) => !(message.to[0] === 'user-department-manager@business.test' && message.subject.startsWith('Final Approval')))
    assert.ok(failing(evaluateMail(missingDepartment)).includes(MAIL_PREFIX_FINAL))

    const wrongRecipient = positiveMail()
    wrongRecipient[1] = mailMessage({ subject: `Final Approval Needed: ${EXACT_TITLE}`, to: ['user-staff-b@business.test'], requestId: 'req-15a' })
    assert.ok(failing(evaluateMail(wrongRecipient)).includes(MAIL_PREFIX_FINAL))
  })

  it('completion mail: duplicate, missing, or wrong recipient FAILS', () => {
    const duplicate = [...positiveMail(), mailMessage({ subject: 'Request Completed', to: ['user-requester-a@business.test'], requestId: 'req-15a' })]
    assert.ok(failing(evaluateMail(duplicate)).includes(MAIL_PREFIX_COMPLETION))

    const missing = positiveMail().filter((message) => message.subject !== 'Request Completed' || message.requestId !== 'req-15a')
    assert.ok(failing(evaluateMail(missing)).includes(MAIL_PREFIX_COMPLETION))

    const wrong = positiveMail()
    wrong[2] = mailMessage({ subject: 'Request Completed', to: ['user-staff-c@business.test'], requestId: 'req-15a' })
    assert.ok(failing(evaluateMail(wrong)).includes(MAIL_PREFIX_COMPLETION))
  })

  it('a matching-subject message with a MALFORMED identity fails indeterminate — never silently skipped', () => {
    const malformed = positiveMail()
    malformed[0] = mailMessage({ subject: `Final Approval Needed: ${EXACT_TITLE}`, to: ['user-section-manager-p@business.test'] })
    malformed[0].requestIdIssue = 'conflicting-request-ids'
    assert.ok(failing(evaluateMail(malformed)).includes('mail-evidence/Business T15A/request-identity-indeterminate'))
  })

  it('a title-bearing "Request Completed" subject with NO available id fails indeterminate (no title join exists)', () => {
    const unavailable = positiveMail()
    unavailable[2] = mailMessage({ subject: 'Request Completed', to: ['user-requester-a@business.test'], requestId: null })
    assert.ok(failing(evaluateMail(unavailable)).includes('mail-evidence/Business T15A/request-identity-indeterminate'))
  })

  it('a foreign valid request id on a relevant subject is excluded, not counted', () => {
    const foreignOnly = positiveMail().map((message) =>
      message.subject.startsWith('Approval Needed') ? message : { ...message, requestId: 'req-other' },
    )
    const failures = failing(evaluateMail(foreignOnly))
    assert.ok(failures.includes(MAIL_PREFIX_FINAL))
    assert.ok(failures.includes(MAIL_PREFIX_COMPLETION))
  })

  it('missing, corrupt, ambiguous, or absent request rows FAIL closed for required selections', () => {
    assert.ok(failing(evaluateMail(positiveMail(), 'T15A', { status: 'missing' as const })).includes('mail-evidence/Business T15A/browser-correlation-missing'))
    assert.ok(failing(evaluateMail(positiveMail(), 'T15A', { status: 'corrupt' as const })).includes('mail-evidence/Business T15A/browser-correlation-missing'))

    const ambiguous = evaluateCapturedMailEvidence({
      messages: positiveMail(),
      requests: [
        { id: 'req-15a', title: EXACT_TITLE },
        { id: 'req-15a-b', title: EXACT_TITLE },
      ],
      routesConfig: 'all-defaults',
      focusedScenario: 'T15A',
      t15a: CORRELATION,
    })
    assert.ok(failing(ambiguous).includes('mail-evidence/Business T15A/request-present'))
  })

  it('requirement matrix: full default run and focused T15A REQUIRE the checks; other selections skip explicitly; other profiles skip', () => {
    assert.ok(t15aEvidenceApplies('full', 'all-defaults', undefined))
    assert.ok(t15aEvidenceApplies('full', 'all-defaults', 'T15A'))
    assert.ok(!t15aEvidenceApplies('full', 'all-defaults', 'T18B'))
    assert.ok(!t15aEvidenceApplies('full', 'final-exception', undefined))

    const focusedOther = evaluateMail(positiveMail(), 'T18B')
    const t15aSkips = t15aMailChecks(focusedOther).filter((check) => check.status === 'skipped')
    assert.ok(t15aSkips.length === 1 && t15aSkips[0].name === 'mail-evidence/Business T15A')

    const otherProfile = evaluateCapturedMailEvidence({
      messages: positiveMail(),
      requests: [{ id: 'req-15a', title: EXACT_TITLE }],
      routesConfig: 'final-exception',
      t15a: CORRELATION,
    })
    const skippedT15a = otherProfile.filter((check) => check.name === 'mail-evidence/Business T15A' && check.status === 'skipped')
    assert.ok(skippedT15a.length === 1)
    const skippedT12a = otherProfile.filter((check) => check.name === 'mail-evidence/Business T12A' && check.status === 'skipped')
    assert.ok(skippedT12a.length === 1, 'T12A skip behavior unchanged')
  })
})

describe('T15A notifications capture SQL shape (STATIC source pin — NOT SQL execution proof)', () => {
  // Task60 (Astra P1): the notifications capture's outer aggregate ordered
  // by t."createdAt" while the derived table projected ONLY
  // id/"requestId"/"userId"/type — PostgreSQL rejects an ORDER BY on a
  // non-projected derived column unconditionally, breaking EVERY capture
  // (the gate fails closed on a thrown capture). This is a STATIC shape
  // validation of the actual builder SQL: it proves the projected-field vs
  // aggregate-reference invariant, NOT that the statement executes — the
  // focused/full live runs are the execution proof (no DB here).
  const MODULE_SOURCE_PATH = 'tests/support/native/capture-workflow-db-evidence.ts'

  /** Parse the derived-table projection and the outer-aggregate ORDER BY refs. */
  function parseSqlShape(sql: string): { projected: string[]; orderRefs: string[] } {
    const innerMatch = sql.match(/from \(\s*select ([\s\S]*?)\s*from notifications n\b/)
    assert.ok(innerMatch, 'the notifications SQL must build its derived table from notifications n')
    const projected = innerMatch[1]
      .split(',')
      .map((column) => column.trim().replace(/^n\./, '').replace(/^"|"$/g, ''))
      .sort()
    const orderMatch = sql.match(/json_agg\(row_to_json\(t\) order by ([^)]+)\)/)
    assert.ok(orderMatch, 'the outer aggregate must carry an explicit order by')
    const orderRefs = [...orderMatch[1].matchAll(/\bt(?:\.("([^"]+)"|[A-Za-z_][A-Za-z0-9_]*))/g)]
      .map((match) => match[2] ?? match[1])
    return { projected, orderRefs }
  }

  it('projects EXACTLY the four structural fields and orders the aggregate by the projected t.id', () => {
    const { projected, orderRefs } = parseSqlShape(businessNotificationsSelectSql())
    assert.deepEqual(projected, ['id', 'requestId', 'type', 'userId'], 'projection must stay the 4-field structural set (no scope expansion, no bodies)')
    assert.deepEqual(orderRefs, ['id'], 'the aggregate must order by the projected t.id (deterministic; createdAt is neither projected nor needed for count/multiplicity checks)')
  })

  it('VALIDATOR CONTROL: an ORDER BY on a non-projected column (the shipped bug shape) is caught, not string-matched away', () => {
    const bugShape = businessNotificationsSelectSql().replace('order by t.id)', 'order by t."createdAt")')
    assert.notEqual(bugShape, businessNotificationsSelectSql(), 'control must actually mutate the order-by')
    const { projected, orderRefs } = parseSqlShape(bugShape)
    const invalid = orderRefs.filter((ref) => !projected.includes(ref))
    assert.deepEqual(invalid, ['createdAt'], 'the validator must flag the non-projected createdAt reference (this is the PostgreSQL failure class)')
  })

  it('source pin: the runner capture path calls the validated builder (the fixed SQL is wired, not an unused export)', () => {
    const source = readFileSync(MODULE_SOURCE_PATH, 'utf8')
    assert.match(
      source,
      /const notifications = await queryJson\(\s*runtime,\s*businessNotificationsSelectSql\(\),?\s*\)/,
      'captureData must capture notifications through businessNotificationsSelectSql()',
    )
  })
})
