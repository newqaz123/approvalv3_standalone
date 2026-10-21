import { promises as fs } from 'node:fs'
import path from 'node:path'

import { REQUIRED_DATABASE_NAME } from './native-environment'
import { psqlQuery, type OwnedRuntime } from './postgres-instance'
import { t12aEvidenceApplies, t15aEvidenceApplies } from './business-evidence-gate'
import { readT15aBrowserCorrelation, type T15aCorrelationRead } from '../business-t15a-double-click'
import type { WorkflowCheck } from './capture-workflow-db-evidence'

/**
 * Runner-owned EMAIL evidence for the business workflows (test-only, T13).
 *
 * The native runner's fail-closed loopback SMTP capture already retains every
 * message the application sends (mail-capture.ts; captured-mail.json). This
 * module adds EVALUATOR CHECKS over that capture — the same contract as
 * capture-workflow-db-evidence.ts: pure expectation checks whose failures
 * FAIL the run (never silently dropped), explicit `skipped` entries when a
 * scenario's request was not executed in the run (no coverage claimed), and
 * no real SMTP is ever contacted (the outbound allowlist preload blocks
 * everything but the runner-owned loopback port).
 *
 * CONFIRMED RECIPIENT POLICY asserted (mirrors the T12 in-app matrix and
 * src/lib/notification-recipients.ts PARTICIPANTS_ONLY — every in-app
 * notification EXCEPT status_changed also dispatches its email through
 * createNotification -> sendEmailNotification):
 *  - approval_needed emails ("Approval Needed: <title>" subject) go to the
 *    CURRENT step's captured candidates only — at create the step-1 group
 *    [second approver, Supervisor P], then Section manager P, then Department
 *    manager; the solution chain likewise notifies its current candidates;
 *  - status_changed is IN-APP ONLY (OWNER DECISION 2026-09-25, Task45):
 *    approvals.ts notifyRequestStatusChange persists the requester's row
 *    with a raw prisma.notifications.create and never enters the email
 *    path, so the capture must contain ZERO "Request Status Changed"
 *    mail — a message with that subject joined to the correlated request
 *    is a channel-policy violation that FAILS the run (the requester's
 *    positive proof is T12's live-browser bell assertion);
 *  - solution_ready ("Solution Ready: <title>") goes to the requester;
 *  - final_approval_needed ("Final Approval Needed: <title>") goes to the
 *    current Final-step candidates (Section manager P, then Department
 *    manager);
 *  - completion ("Request Completed") goes to the requester — its subject
 *    carries NO title, so it is joined to the scenario request via the
 *    requestId parsed from the email's request link (mail-capture.ts);
 *  - Staff C (sibling-section viewer), the inactive user and the unassigned
 *    user receive ZERO emails for the whole run;
 *  - every captured envelope is fixture-only: all recipients (and the
 *    sender) must use the fixture domain @business.test, and no secret-looking
 *    material (password/secret/token/bearer patterns) may appear in the
 *    envelope fields.
 */

const FIXTURE_DOMAIN = '@business.test'

/**
 * Scenario request identity prefix. The ACTUAL producer is
 * uniqueBusinessTitle('T12A') (tests/business-e2e/business-flow-helpers.ts):
 * `Business T12A ${Date.now()}-${random}` — the scenario token is followed
 * by a SPACE and a non-empty timestamp-suffix. Matching the bare token
 * 'Business T12A' would wrongly accept longer tokens ('Business T12AB…',
 * 'Business T12A1 …') as the selected T12A request (Task42).
 */
const T12A_REQUEST_TITLE_PREFIX = 'Business T12A '

/** Exact-delimiter T12A identity: prefix 'T12A ' + a NON-EMPTY suffix. */
function isT12aScenarioRequestRow(row: MailEvidenceRequestRow): boolean {
  if (!row.title.startsWith(T12A_REQUEST_TITLE_PREFIX)) return false
  return row.title.slice(T12A_REQUEST_TITLE_PREFIX.length).trim().length > 0
}

/** Fixture actor emails permitted as notification recipients (seed fixture). */
const PARTICIPANT_EMAILS = {
  requesterA: 'user-requester-a@business.test',
  staffB: 'user-staff-b@business.test',
  supervisorP: 'user-supervisor-p@business.test',
  sectionManagerP: 'user-section-manager-p@business.test',
  departmentManager: 'user-department-manager@business.test',
  engineerA: 'user-engineer-a@business.test',
  supervisorE: 'user-supervisor-e@business.test',
  sectionManagerE: 'user-section-manager-e@business.test',
  admin: 'user-admin@business.test',
  secondApprover: 'user-second-approver@business.test',
} as const

/** Never a notification recipient: viewer / no-session / no-assignment actors. */
const NON_PARTICIPANT_EMAILS = [
  'user-staff-c@business.test',
  'user-inactive@business.test',
  'user-unassigned@business.test',
] as const

const SECRET_PATTERN = /(password|passwd|secret|token|bearer|authorization)/i

export interface CapturedMailSummaryMessage {
  receivedAt: string
  from: string
  to: string[]
  subject: string
  requestId: string | null
  /** mail-capture sets this when a body referenced the request link but no
 * single valid id could be derived (conflicting ids; an invalid/empty/
 * malformed-encoded value; a malformed link incl. raw control characters or
 * an unclosed attribute quote; an explicit id on an unsupported link path;
 * unknown/malformed transfer encoding; malformed multipart framing); such
 * mail must never join a request — fail closed, no title fallback. */
  requestIdIssue?:
    | 'malformed-transfer-encoding'
    | 'unknown-content-transfer-encoding'
    | 'malformed-multipart-framing'
    | 'malformed-request-link'
    | 'malformed-request-id-encoding'
    | 'invalid-request-id-value'
    | 'empty-request-id-value'
    | 'unsupported-request-link'
    | 'conflicting-request-ids'
}

export interface MailEvidenceRequestRow {
  id: string
  title: string
}

export interface MailEvidenceResult {
  file: string
  checks: WorkflowCheck[]
  failures: string[]
}

function messageMatchesRequest(message: CapturedMailSummaryMessage, request: MailEvidenceRequestRow): boolean {
  if (message.requestId != null) return message.requestId === request.id
  // Fail closed: an explicit-but-unusable link id (conflicting ids across
  // parts, unknown/malformed transfer encoding) is evidence of a problem,
  // never of a title join — the strict-id contract must not be relaxed.
  if (message.requestIdIssue) return false
  // Title-bearing subjects ("Approval Needed: <title>") still match without
  // a parsed link; subjects that carry no title cannot match here.
  return message.subject.includes(request.title)
}

function messagesForRequest(
  messages: readonly CapturedMailSummaryMessage[],
  request: MailEvidenceRequestRow,
): CapturedMailSummaryMessage[] {
  return messages.filter((message) => messageMatchesRequest(message, request))
}

function recipientsOf(messages: readonly CapturedMailSummaryMessage[]): string[] {
  return [...new Set(messages.flatMap((message) => message.to))]
}

function hasAll(recipients: readonly string[], expected: readonly string[]): boolean {
  return expected.every((email) => recipients.includes(email))
}

function pass(name: string, detail: string): WorkflowCheck {
  return { name, status: 'pass', detail }
}

function fail(name: string, detail: string): WorkflowCheck {
  return { name, status: 'fail', detail }
}

function skipped(name: string, detail: string): WorkflowCheck {
  return { name, status: 'skipped', detail }
}

/** One expected-mail presence check: subject + required recipients for a request. */
function expectedMailCheck(
  messages: readonly CapturedMailSummaryMessage[],
  request: MailEvidenceRequestRow,
  name: string,
  subject: string,
  requiredRecipients: readonly string[],
  description: string,
): WorkflowCheck {
  const matching = messagesForRequest(messages, request).filter((message) => message.subject === subject)
  const recipients = recipientsOf(matching)
  if (hasAll(recipients, requiredRecipients)) {
    return pass(`mail-evidence/${name}`, `${request.title}: "${subject}" delivered to ${[...requiredRecipients].join(', ')} (${description})`)
  }
  return fail(
    `mail-evidence/${name}`,
    `${request.title}: expected "${subject}" to ${[...requiredRecipients].join(', ')} (${description}); captured recipients for that subject: [${recipients.join(', ') || 'none'}]`,
  )
}

/**
 * One forbidden-mail check (negative, subject-scoped, integrity-fenced).
 * Backs the status_changed IN-APP ONLY channel policy (owner decision
 * 2026-09-25, Task45): the product never dispatches that email, so the
 * capture must contain ZERO mail with the forbidden subject for the
 * selected request. Because this is a NEGATIVE claim, identity integrity
 * matters more than for the positives: a matching-subject message whose
 * request identity is unusable or unavailable (null id, empty id, or any
 * parser issue — even alongside a derived id) makes absence UNPROVABLE,
 * so the check FAILS as indeterminate instead of passing (pinned Astra
 * P1, Task46). Only a demonstrably DIFFERENT valid id is excluded; the
 * selected request's own valid id is the forbidden violation. No title
 * fallback, no joining of uncertain ids. Diagnostics are fixed-safe: they
 * name the subject and the identity state only — no bodies, no raw error
 * output. Absence passes only alongside the required positive matrix
 * (zero-mail captures still fail those positives).
 */
function forbiddenMailCheck(
  messages: readonly CapturedMailSummaryMessage[],
  request: MailEvidenceRequestRow,
  name: string,
  subject: string,
  description: string,
): WorkflowCheck {
  const subjectMatches = messages.filter((message) => message.subject === subject)
  const indeterminateReasons = new Set<string>()
  const offenders: CapturedMailSummaryMessage[] = []
  for (const message of subjectMatches) {
    // An issue flag marks the identity as unusable even when an id was
    // derived — uncertain ids are never joined for a negative claim.
    if (message.requestIdIssue) {
      indeterminateReasons.add(`request identity issue: ${message.requestIdIssue}`)
      continue
    }
    if (message.requestId == null) {
      indeterminateReasons.add('no request id available (null)')
      continue
    }
    if (message.requestId === '') {
      indeterminateReasons.add('empty request id')
      continue
    }
    if (message.requestId === request.id) {
      offenders.push(message)
      continue
    }
    // A demonstrably different VALID id: this mail cannot belong to the
    // selected request, so it is excluded.
  }
  if (indeterminateReasons.size > 0) {
    return fail(
      `mail-evidence/${name}`,
      `${request.title}: indeterminate — cannot prove ZERO "${subject}" mails for this request: matching-subject message(s) with unusable or unavailable request identity ([${[...indeterminateReasons].join('; ')}]); absence is unproven, never a pass (${description})`,
    )
  }
  if (offenders.length === 0) {
    return pass(
      `mail-evidence/${name}`,
      `${request.title}: ZERO "${subject}" mails joined to this request (${description})`,
    )
  }
  return fail(
    `mail-evidence/${name}`,
    `${request.title}: expected NO "${subject}" mail for this request (${description}); captured ${offenders.length} joined to it: [${recipientsOf(offenders).join(', ')}]`,
  )
}

/**
 * Pure evaluator (no I/O): compares the captured loopback mail with the
 * confirmed recipient policy. The T12A workflow (the T12 in-app spec) drives
 * the mails checked here; it only exists under the "all-defaults" profile,
 * so other profiles record the scenario as an explicit skipped entry while
 * the run-global envelope checks still run.
 *
 * Task41 requirement matrix: the T12A recipient matrix is REQUIRED whenever
 * the T12A spec actually runs — the DEFAULT full all-defaults run and the
 * focused --scenario=T12A selection. For those runs a missing scenario
 * request, an ambiguous prefix match, or zero captured messages FAIL the
 * matrix checks (a skip or a vacuous zero-mail pass is never accepted). A
 * focused OTHER selection (T18B/T18C2/T04B) executes no T12A test: its
 * T12A matrix is an explicit not-selected skip, never a failure.
 */
export function evaluateCapturedMailEvidence(input: {
  messages: readonly CapturedMailSummaryMessage[]
  requests: readonly MailEvidenceRequestRow[]
  routesConfig: string
  /** Focused browser scenario of this run (undefined = default full suite). */
  focusedScenario?: string
  /** Task59: T15A browser correlation (exact title) for the duplicate-mail
   * multiplicity checks; REQUIRED for the default full all-defaults run and
   * the focused T15A selection. */
  t15a?: T15aCorrelationRead
}): WorkflowCheck[] {
  const { messages, requests, routesConfig, focusedScenario } = input
  const checks: WorkflowCheck[] = []

  // --- Run-global envelope checks (every profile, every message). ---
  const domainOffenders = messages.flatMap((message) => {
    const bad = [
      ...(message.from ? [message.from] : []),
      ...message.to,
    ].filter((address) => !address.toLowerCase().endsWith(FIXTURE_DOMAIN))
    return bad.map((address) => `${address} (subject: ${message.subject || '(none)'})`)
  })
  checks.push(
    domainOffenders.length === 0
      ? pass(
          'mail-evidence/fixture-domains-only',
          `every captured envelope address (${messages.length} messages) uses the fixture domain ${FIXTURE_DOMAIN} — loopback capture only, no real SMTP`,
        )
      : fail(
          'mail-evidence/fixture-domains-only',
          `non-fixture envelope addresses captured: ${domainOffenders.slice(0, 5).join('; ')}${domainOffenders.length > 5 ? ` (+${domainOffenders.length - 5} more)` : ''}`,
        ),
  )

  const secretOffenders = messages
    .flatMap((message) => [
      message.from,
      message.subject,
      ...(message.requestId ? [message.requestId] : []),
    ])
    .filter((value) => SECRET_PATTERN.test(value))
  checks.push(
    secretOffenders.length === 0
      ? pass('mail-evidence/no-secrets-in-envelope', 'no secret-looking material (password/secret/token/bearer) appears in any captured envelope field')
      : fail('mail-evidence/no-secrets-in-envelope', `secret-looking values captured in envelope fields: ${secretOffenders.slice(0, 5).join('; ')}`),
  )

  const nonParticipantMessages = messages.filter((message) =>
    message.to.some((address) => (NON_PARTICIPANT_EMAILS as readonly string[]).includes(address)),
  )
  checks.push(
    nonParticipantMessages.length === 0
      ? pass(
          'mail-evidence/zero-mail-to-non-participants',
          `Staff C (viewer), the inactive user and the unassigned user received ZERO of the ${messages.length} captured messages`,
        )
      : fail(
          'mail-evidence/zero-mail-to-non-participants',
          `non-participant recipients captured: ${nonParticipantMessages
            .slice(0, 5)
            .map((message) => `${message.to.join(',')} <- "${message.subject}"`)
            .join('; ')}`,
        ),
  )

  // --- T13 scenario checks over the T12A workflow's mails. ---
  const t12aSelected = routesConfig === 'all-defaults' && t12aEvidenceApplies('full', routesConfig, focusedScenario)
  if (routesConfig !== 'all-defaults') {
    checks.push(
      skipped(
        'mail-evidence/Business T12A',
        `T13 recipient-matrix checks belong to the "all-defaults" profile (active: "${routesConfig}") — no coverage claimed`,
      ),
    )
  } else if (!t12aSelected) {
    checks.push(
      skipped(
        'mail-evidence/Business T12A',
        `T12A was not selected in this focused ${focusedScenario} run — the T12A test did not execute, its recipient-matrix checks were NOT run, and no T12A coverage is claimed`,
      ),
    )
  } else {
  // Single source of truth for the requirement matrix: the shared
  // t12aEvidenceApplies seam (full + all-defaults + default-ALL or focused
  // T12A). Every other focused selection skipped T12A explicitly.
  // REQUIRED from here on (default full all-defaults run or focused T12A):
  // the scenario request is matched by its EXACT title delimiter — zero or
  // multiple valid matches FAIL (identity is never a first-prefix guess,
  // and a longer wrong token never stands in for the selected request).
  const scenarioMatches = requests.filter(isT12aScenarioRequestRow)
  if (scenarioMatches.length !== 1) {
    checks.push(
      fail(
        'mail-evidence/Business T12A/request-present',
        scenarioMatches.length === 0
          ? `REQUIRED T12A request (title delimiter "${T12A_REQUEST_TITLE_PREFIX.trim()} " + non-empty suffix) not found — required evidence is missing, not skipped`
          : `REQUIRED T12A request title delimiter matched ${scenarioMatches.length} rows — identity is ambiguous`,
      ),
    )
  } else {
  const scenarioRequest = scenarioMatches[0]

  const scenarioMessages = messagesForRequest(messages, scenarioRequest)
  const scenarioNonParticipant = scenarioMessages.filter((message) =>
    message.to.some((address) => (NON_PARTICIPANT_EMAILS as readonly string[]).includes(address)),
  )
  checks.push(
    scenarioNonParticipant.length === 0
      ? pass(
          'mail-evidence/Business T12A/zero-scenario-mail-to-non-participants',
          `none of the ${scenarioMessages.length} mails referencing ${scenarioRequest.title} went to Staff C / inactive / unassigned`,
        )
      : fail(
          'mail-evidence/Business T12A/zero-scenario-mail-to-non-participants',
          `non-participant recipients on this scenario: ${scenarioNonParticipant
            .map((message) => `${message.to.join(',')} <- "${message.subject}"`)
            .join('; ')}`,
        ),
  )

  const title = scenarioRequest.title
  checks.push(
    expectedMailCheck(
      messages,
      scenarioRequest,
      'Business T12A/create-approval-needed-to-current-candidates',
      `Approval Needed: ${title}`,
      [PARTICIPANT_EMAILS.supervisorP, PARTICIPANT_EMAILS.secondApprover],
      'create notifies the captured step-1 candidate group, not viewers',
    ),
  )
  checks.push(
    expectedMailCheck(
      messages,
      scenarioRequest,
      'Business T12A/request-step2-approval-needed-section-manager',
      `Approval Needed: ${title}`,
      [PARTICIPANT_EMAILS.sectionManagerP],
      'after step 1 the next current candidate is notified',
    ),
  )
  checks.push(
    expectedMailCheck(
      messages,
      scenarioRequest,
      'Business T12A/request-step3-approval-needed-department-manager',
      `Approval Needed: ${title}`,
      [PARTICIPANT_EMAILS.departmentManager],
      'step-3 current candidate is notified',
    ),
  )
  checks.push(
    forbiddenMailCheck(
      messages,
      scenarioRequest,
      'Business T12A/status-changed-in-app-only-no-email',
      'Request Status Changed',
      'status_changed is IN-APP ONLY (owner decision 2026-09-25, Task45) — the requester bell row is the required positive, this subject must never mail; joined by requestId — the subject carries no title',
    ),
  )
  checks.push(
    expectedMailCheck(
      messages,
      scenarioRequest,
      'Business T12A/solution-ready-to-requester',
      `Solution Ready: ${title}`,
      [PARTICIPANT_EMAILS.requesterA],
      'solution_ready goes to the requester',
    ),
  )
  checks.push(
    expectedMailCheck(
      messages,
      scenarioRequest,
      'Business T12A/final-approval-needed-to-final-candidates',
      `Final Approval Needed: ${title}`,
      [PARTICIPANT_EMAILS.sectionManagerP, PARTICIPANT_EMAILS.departmentManager],
      'final_approval_needed goes to the current Final-step candidates as the chain advances',
    ),
  )
  checks.push(
    expectedMailCheck(
      messages,
      scenarioRequest,
      'Business T12A/request-completed-to-requester',
      'Request Completed',
      [PARTICIPANT_EMAILS.requesterA],
      'completion notifies the requester (joined by requestId — the subject carries no title)',
    ),
  )
  }
  }

  // --- Task59: T15A FINAL-phase duplicate-mail multiplicity (REQUIRED for
  // the default full all-defaults run and the focused T15A selection). ---
  checks.push(
    ...evaluateT15aMailMultiplicities({ messages, requests, routesConfig, focusedScenario, t15a: input.t15a }),
  )

  return checks
}

/**
 * T15A duplicate-mail multiplicity (Task59; pure, no I/O). Exact per-event
 * DISTINCT-MESSAGE counts for the browser-correlated T15A request — never a
 * Set-deduplicated recipient presence check (dedup would conceal a
 * duplicate send), never an aggregate envelope count:
 *  - "Final Approval Needed: <exact title>" (notifications.ts
 *    sendEmailNotification maps final_approval_needed to exactly this
 *    subject; one sendMail per created notification, one recipient each —
 *    createNotification never multicasts): EXACTLY two distinct messages,
 *    one addressed ONLY to user-section-manager-p@business.test (initiation
 *    step) and one ONLY to user-department-manager@business.test (after the
 *    section manager decided). A duplicate message to ANY recipient, a
 *    single multicast message to both, a missing recipient, or a wrong
 *    recipient FAILS.
 *  - "Request Completed" (approveFinalApproval completion branch; subject
 *    carries no title so it joins ONLY by the requestId parsed from the
 *    email's request link): EXACTLY one distinct message addressed ONLY to
 *    user-requester-a@business.test.
 * Identity discipline (fail-closed): for a matching relevant subject, a
 * malformed/unavailable request identity (parser issue flag, or a null id
 * where no title join is possible) FAILS as indeterminate — never a silent
 * skip; only a demonstrably DIFFERENT valid id is excluded as foreign.
 */
function evaluateT15aMailMultiplicities(input: {
  messages: readonly CapturedMailSummaryMessage[]
  requests: readonly MailEvidenceRequestRow[]
  routesConfig: string
  focusedScenario?: string
  t15a?: T15aCorrelationRead
}): WorkflowCheck[] {
  const { messages, requests, routesConfig, focusedScenario, t15a } = input
  if (routesConfig !== 'all-defaults') {
    return [
      skipped(
        'mail-evidence/Business T15A',
        `T15A duplicate-mail multiplicity checks belong to the "all-defaults" profile (active: "${routesConfig}") — no coverage claimed`,
      ),
    ]
  }
  if (!t15aEvidenceApplies('full', routesConfig, focusedScenario)) {
    return [
      skipped(
        'mail-evidence/Business T15A',
        `T15A was not selected in this focused ${focusedScenario} run — the T15A test did not execute, its duplicate-mail multiplicity checks were NOT run, and no T15A coverage is claimed`,
      ),
    ]
  }
  const correlation = t15a ?? { status: 'missing' as const }
  if (correlation.status !== 'present') {
    return [
      fail(
        'mail-evidence/Business T15A/browser-correlation-missing',
        correlation.status === 'corrupt'
          ? 'REQUIRED T15A browser correlation file is corrupt — the exact request title needed to join mail to the selected request was not proven'
          : 'REQUIRED T15A browser correlation (exact request title) is missing — duplicate-mail evidence fails, it is never skipped',
      ),
    ]
  }
  const titled = requests.filter((row) => row.title === correlation.correlation.requestTitle)
  if (titled.length !== 1) {
    return [
      fail(
        'mail-evidence/Business T15A/request-present',
        titled.length === 0
          ? `REQUIRED T15A request "${correlation.correlation.requestTitle}" not found — duplicate-mail evidence is missing, not skipped`
          : `REQUIRED T15A request title "${correlation.correlation.requestTitle}" matched ${titled.length} rows — identity is ambiguous`,
      ),
    ]
  }
  const selected = titled[0]
  const title = selected.title
  const finalSubject = `Final Approval Needed: ${title}`
  const completionSubject = 'Request Completed'
  const relevant = messages.filter(
    (message) => message.subject === finalSubject || message.subject === completionSubject,
  )
  const indeterminate: string[] = []
  const joined: CapturedMailSummaryMessage[] = []
  for (const message of relevant) {
    if (message.requestIdIssue) {
      indeterminate.push(`"${message.subject}" request identity issue: ${message.requestIdIssue}`)
      continue
    }
    if (message.requestId != null) {
      // A demonstrably different VALID id is a foreign request's mail —
      // excluded, never counted for the selected request.
      if (message.requestId === selected.id) joined.push(message)
      continue
    }
    if (message.subject === finalSubject) {
      // Title-bearing subject: the exact unique title is a valid join.
      joined.push(message)
      continue
    }
    // "Request Completed" with a null id and no parser issue: no title
    // exists in the subject, so this message can be neither joined nor
    // excluded — absence/presence is unprovable, fail indeterminate.
    indeterminate.push(`"${completionSubject}" with no request id available (null) — cannot join or exclude`)
  }
  if (indeterminate.length > 0) {
    return [
      fail(
        'mail-evidence/Business T15A/request-identity-indeterminate',
        `${title}: cannot prove the duplicate-mail multiplicity — matching-subject message(s) with unusable or unavailable request identity ([${indeterminate.join('; ')}]); an indeterminate identity fails, never a silent skip`,
      ),
    ]
  }

  const finalMail = joined.filter((message) => message.subject === finalSubject)
  const section = finalMail.filter(
    (message) => message.to.length === 1 && message.to[0] === PARTICIPANT_EMAILS.sectionManagerP,
  )
  const department = finalMail.filter(
    (message) => message.to.length === 1 && message.to[0] === PARTICIPANT_EMAILS.departmentManager,
  )
  const finalOk = finalMail.length === 2 && section.length === 1 && department.length === 1
  const describe = (message: CapturedMailSummaryMessage): string =>
    `to:[${message.to.join(', ')}]`
  const checks: WorkflowCheck[] = [
    finalOk
      ? pass(
          'mail-evidence/Business T15A/final-approval-needed-exact-multiplicity',
          `${title}: exactly two distinct "${finalSubject}" messages — one solely to ${PARTICIPANT_EMAILS.sectionManagerP} (initiation step) and one solely to ${PARTICIPANT_EMAILS.departmentManager} (after the section manager decided); no duplicate send concealed by dedup or multicast`,
        )
      : fail(
          'mail-evidence/Business T15A/final-approval-needed-exact-multiplicity',
          `${title}: expected exactly two distinct "${finalSubject}" messages (${PARTICIPANT_EMAILS.sectionManagerP}×1, ${PARTICIPANT_EMAILS.departmentManager}×1, each addressed to exactly one recipient); observed ${finalMail.length} message(s): [${finalMail.map(describe).join(' | ') || 'none'}]`,
        ),
  ]

  const completionMail = joined.filter((message) => message.subject === completionSubject)
  const completionOk = completionMail.length === 1
    && completionMail[0].to.length === 1
    && completionMail[0].to[0] === PARTICIPANT_EMAILS.requesterA
  checks.push(
    completionOk
      ? pass(
          'mail-evidence/Business T15A/completion-mail-once-to-requester',
          `${title}: exactly one distinct "${completionSubject}" message solely to ${PARTICIPANT_EMAILS.requesterA} (joined by requestId — the subject carries no title)`,
        )
      : fail(
          'mail-evidence/Business T15A/completion-mail-once-to-requester',
          `${title}: expected exactly one distinct "${completionSubject}" message solely to ${PARTICIPANT_EMAILS.requesterA}; observed ${completionMail.length} message(s): [${completionMail.map(describe).join(' | ') || 'none'}]`,
        ),
  )
  return checks
}

/**
 * Runner-owned capture wrapper: reads the scenario request rows (id, title)
 * from the owned database with the same read-only psql contract as the DB
 * evidence layer, evaluates the captured mail summaries, and persists
 * mail-evidence.json next to captured-mail.json. A capture crash must not
 * mask the original run outcome; CHECK failures inside a successful capture
 * DO fail the run (surfaced by the caller).
 */
export async function captureWorkflowMailEvidence(
  runtime: OwnedRuntime,
  evidenceDir: string,
  routesConfig: string,
  messages: readonly CapturedMailSummaryMessage[],
  focusedScenario?: string,
): Promise<MailEvidenceResult> {
  const raw = await psqlQuery(
    runtime,
    REQUIRED_DATABASE_NAME,
    `select coalesce(json_agg(row_to_json(t) order by t."createdAt"), '[]'::json) from (
       select id, title, "createdAt" from requests
       where title like 'Business T%' and "isDeleted" = false
     ) t`,
  )
  const requests: MailEvidenceRequestRow[] = raw === '' ? [] : (JSON.parse(raw) as MailEvidenceRequestRow[])
  const t15a = await readT15aBrowserCorrelation(evidenceDir)
  const checks = evaluateCapturedMailEvidence({ messages, requests, routesConfig, focusedScenario, t15a })
  const failures = checks.filter((check) => check.status === 'fail').map((check) => `${check.name}: ${check.detail}`)
  const payload = {
    note: 'evaluator checks over the runner-owned loopback mail capture (captured-mail.json); envelope-safe fields only, no secrets',
    capturedAt: new Date().toISOString(),
    routesConfiguration: routesConfig,
    focusedScenario: focusedScenario ?? null,
    t15aBrowserCorrelation: t15a.status === 'present' ? t15a.correlation : { status: t15a.status },
    checks,
  }
  const file = 'mail-evidence.json'
  await fs.writeFile(path.join(evidenceDir, file), JSON.stringify(payload, null, 2))
  return { file, checks, failures }
}
