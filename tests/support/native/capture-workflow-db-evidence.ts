import { promises as fs } from 'node:fs'
import path from 'node:path'

import { BUSINESS_POSITIONS, BUSINESS_UNITS } from '../business-workflow-fixture'
import {
  T18B_RESTART_REASON,
  readT18bBrowserCorrelation,
  type T18bBrowserCorrelation,
  type T18bCorrelationRead,
} from '../business-t18b-correlation'
import { readT18c2BrowserCorrelation, type T18c2CorrelationRead } from '../business-t18c2-correlation'
import { readT15aBrowserCorrelation, type T15aCorrelationRead } from '../business-t15a-double-click'
import { evaluateT15aPersistedEvidence } from './t15a-persisted-evidence'
import { evaluateT15aNotificationEvidence } from './t15a-notification-evidence'
import { REQUIRED_DATABASE_NAME } from './native-environment'
import { psqlQuery, type OwnedRuntime } from './postgres-instance'

/**
 * Runner-owned, READ-ONLY durable DB evidence for the business workflows
 * (test-only). Runs in the native runner process — the only layer allowed
 * to touch the owned database — AFTER the browser suite finishes and BEFORE
 * cleanup stops/removes the owned PostgreSQL cluster, so the persisted
 * routing truth (route version ids, ordered required steps, captured
 * candidates, origins, decisions, transitions) survives the disposable
 * runtime as `db-evidence.json` in the run evidence directory.
 *
 * Safety/scope contracts:
 *  - SELECT-only statements; no writes, no schema changes, no migrations;
 *  - fixture workflow tables only (requests, solutions, approval_instances,
 *    approval_candidate_groups(+members), request_approvals,
 *    solution_approvals, approval_instance_skips, approval_route_versions
 *    (+steps), request_activities) restricted to the business-test rows
 *    (title LIKE 'Business T%' so T10+ are included; T0% dropped T10*) or fixture route scopes — never a generic
 *    data dump, never any user/password/email-settings rows;
 *  - assertions compare the ACTUAL saved data against the confirmed
 *    expectations OF THE RUN'S ROUTE CONFIGURATION (one fixture profile per
 *    run: published chain ids, referenced route scope, ordered required
 *    steps, per-step captured candidate groups, Department-manager ceiling,
 *    origins, approvers, terminal statuses). A failed check is reported as a
 *    run FAILURE by the caller — never silently dropped — while the raw rows
 *    stay in the evidence file for review. Scenarios of a route profile that
 *    was NOT selected for the run produce explicit SKIPPED entries (never
 *    "pass"), and a scenario of another profile executing under the active
 *    one is a FAILURE (cross-profile leakage).
 *
 * Instance/row linkage contract (matches the persisted schema):
 *  - REQUEST and FINAL approval_instances carry requestId; SOLUTION instances
 *    persist requestId = null and link via solutionId -> solutions.requestId;
 *    the evaluator therefore resolves SOLUTION instances by solutionId.
 *  - request_approvals rows are attributed to a phase by their owning
 *    instanceId, never by the isFinalApproval flag. The flag has its own
 *    explicit consistency checks (expected false on REQUEST rows, true on
 *    FINAL rows) so a product-side flag inconsistency FAILS visibly instead
 *    of hiding the linked rows (or faking a pass) — row evaluation and flag
 *    auditing are deliberately separate assertions.
 */

const POSITION_SUPERVISOR = BUSINESS_POSITIONS.supervisor
const POSITION_SECTION_MANAGER = BUSINESS_POSITIONS.sectionManager
const POSITION_DEPARTMENT_MANAGER = BUSINESS_POSITIONS.departmentManager
const CEILING_ALLOWED_POSITIONS = [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER] as const
const FIXTURE_ROUTE_SCOPES = [
  BUSINESS_UNITS.company,
  BUSINESS_UNITS.production,
  BUSINESS_UNITS.productionSection,
  BUSINESS_UNITS.engineering,
  BUSINESS_UNITS.engineeringSection,
  BUSINESS_UNITS.siblingSection,
] as const

export interface DbEvidenceRow {
  [key: string]: unknown
}

export interface DbEvidenceData {
  requests: DbEvidenceRow[]
  solutions: DbEvidenceRow[]
  approvalInstances: DbEvidenceRow[]
  candidateGroups: DbEvidenceRow[]
  requestApprovals: DbEvidenceRow[]
  solutionApprovals: DbEvidenceRow[]
  instanceSkips: DbEvidenceRow[]
  routeVersions: DbEvidenceRow[]
  requestActivities: DbEvidenceRow[]
  /** Task59: FINAL-phase notification multiplicity projection (id,
   * requestId, userId, type only — no titles, no bodies). Optional so
   * pre-Task59 fixtures stay valid; the T15A evaluator fails closed on
   * absent/empty captures. */
  notifications?: DbEvidenceRow[]
}

export interface WorkflowCheck {
  name: string
  /** 'skipped' explicitly claims NO coverage (never counted as Pass or Fail). */
  status: 'pass' | 'fail' | 'skipped'
  detail: string
}

export interface DbEvidenceResult {
  file: string
  checks: WorkflowCheck[]
  failures: string[]
}

interface ScenarioExpectation {
  requestOrigin: string
  requestSteps: string[]
  requestApprovers: string[]
  /** Explicit expected REQUEST route version id (defaults to `<config>-request-default`). */
  requestRouteId?: string
  /** When set, the referenced REQUEST route version's persisted scopeUnitId is verified. */
  requestRouteScopeUnitId?: string
  /** Per-step captured REQUEST candidate-group members, aligned with requestSteps. */
  requestCandidates?: string[][]
  solution?: {
    origin: string
    steps: string[]
    approvers: string[] | null
    firstPendingCandidates?: string[]
    /** Explicit expected SOLUTION route version id (defaults to `<config>-solution-default`). */
    routeId?: string
    /** When set, the referenced SOLUTION route version's persisted scopeUnitId is verified. */
    routeScopeUnitId?: string
    /** Per-step captured SOLUTION candidate-group members, aligned with steps. */
    candidates?: string[][]
  }
  final?: {
    origin: string
    steps: string[]
    approvers: string[]
    /** Explicit expected FINAL route version id (defaults to `<config>-final-default`). */
    routeId?: string
    /** When set, the referenced FINAL route version's persisted scopeUnitId is verified. */
    routeScopeUnitId?: string
    /** Per-step captured FINAL candidate-group members, aligned with steps. */
    candidates?: string[][]
  }
  /** When true, NO SOLUTION row may exist for this request (T03 denial proof: unauthorized submit must not create a partial solution). */
  solutionForbidden?: boolean
  /** When true, NO FINAL approval instance may exist for this request (denial proof: a denied/premature trigger must not create an attempt). */
  finalForbidden?: boolean
  /** When true, the request must carry EXACTLY ONE FINAL approval instance (attempt 1, not superseded) — proof that no extra attempt was created. */
  singleFinalAttempt?: boolean
  finalStatus: string
}

const USER = {
  requesterA: 'user-requester-a',
  supervisorP: 'user-supervisor-p',
  sectionManagerP: 'user-section-manager-p',
  departmentManager: 'user-department-manager',
  engineerA: 'user-engineer-a',
  supervisorE: 'user-supervisor-e',
  sectionManagerE: 'user-section-manager-e',
  // T18C2 all-steps-vacant origin: staffVacantAll on the isolated vacancy
  // branch (tests/support/business-workflow-fixture.ts).
  staffVacantAll: 'user-staff-vacant-all',
} as const

/**
 * Confirmed expectations for the T08 Final-TRIGGER scenarios (all-defaults
 * profile): one FRESH Requester-A-origin request per ORIGIN-UNIT trigger actor
 * (Requester A, Staff B, Supervisor P, Section manager P), Final triggered
 * after Solution approval.
 *
 * CONFIRMED RULE asserted for EVERY trigger actor (plan §1/§6):
 *  - the trigger SUCCEEDS (triggering is NOT approving);
 *  - the FINAL phase still follows the ORIGINAL REQUESTER's branch:
 *    originUserId = user-requester-a, all-defaults FINAL route (scope
 *    unit-company), Section manager P → Department manager steps;
 *  - the trigger actor appears NOWHERE in the FINAL approver/candidate sets.
 *
 * KNOWN PRODUCT DEVIATIONS that must FAIL here honestly (plan appendix; do
 * NOT encode as expected, do NOT patch production):
 *  - attempt origin may persist as the TRIGGER actor (solutions.ts
 *    createFinalApprovalAttempt originUserId: userId) → final-origin fails
 *    for every non-requester trigger;
 *
 * INTENDED RULE (owner decision H6, permission-checks.ts
 * canInitiateFinalApproval): only an active assignment in the request ORIGIN
 * unit may initiate Final. The parent Department manager sits in the parent
 * unit and is therefore DENIED — T08E uses
 * allDefaultsParentManagerDeniedExpectation below (no FINAL attempt, status
 * stays SendBackToRequester), not this builder.
 * Step arrays are the same positions as the shared STEPS_* consts below (the
 * consts themselves are declared after this map, so positions are inlined).
 */
function allDefaultsFinalTriggerExpectation(): ScenarioExpectation {
  return {
    requestOrigin: USER.requesterA,
    requestSteps: [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
    requestApprovers: [USER.supervisorP, USER.sectionManagerP, USER.departmentManager],
    requestCandidates: [['user-second-approver', 'user-supervisor-p'], ['user-section-manager-p'], ['user-department-manager']],
    solution: {
      origin: USER.engineerA,
      steps: [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
      approvers: [USER.supervisorE, USER.sectionManagerE, USER.departmentManager],
      routeScopeUnitId: BUSINESS_UNITS.company,
      candidates: [['user-supervisor-e'], ['user-section-manager-e'], ['user-department-manager']],
    },
    final: {
      origin: USER.requesterA,
      steps: [POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
      approvers: [USER.sectionManagerP, USER.departmentManager],
      routeScopeUnitId: BUSINESS_UNITS.company,
      candidates: [['user-section-manager-p'], ['user-department-manager']],
    },
    finalStatus: 'Completed',
  }
}

/**
 * T08E (all-defaults): the parent-department Department manager attempts
 * Final after Solution approval and is DENIED (origin-unit-only rule). The
 * Request and Solution phases are the same as the other T08 scenarios; NO
 * FINAL approval instance may exist and the request stays in
 * SendBackToRequester.
 */
function allDefaultsParentManagerDeniedExpectation(): ScenarioExpectation {
  const base = allDefaultsFinalTriggerExpectation()
  return {
    requestOrigin: base.requestOrigin,
    requestSteps: base.requestSteps,
    requestApprovers: base.requestApprovers,
    requestCandidates: base.requestCandidates,
    solution: base.solution,
    finalForbidden: true,
    finalStatus: 'SendBackToRequester',
  }
}

/**
 * Confirmed all-defaults expectations per scenario title prefix
 * (tests/business-e2e/business-default-workflows.spec.ts). Supervisor-rank
 * steps are OMITTED (not merely skipped) for Supervisor origins — the engine
 * drops stepRank <= originRank steps from the snapshot entirely.
 */
export const DEFAULT_WORKFLOW_EXPECTATIONS: Record<string, ScenarioExpectation> = {
  'Business T02A': {
    requestOrigin: USER.requesterA,
    requestSteps: [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
    requestApprovers: [USER.supervisorP, USER.sectionManagerP, USER.departmentManager],
    finalStatus: 'SentToEngineer',
  },
  'Business T02B': {
    requestOrigin: USER.supervisorP,
    requestSteps: [POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
    requestApprovers: [USER.sectionManagerP, USER.departmentManager],
    finalStatus: 'SentToEngineer',
  },
  'Business T03A': {
    requestOrigin: USER.requesterA,
    requestSteps: [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
    requestApprovers: [USER.supervisorP, USER.sectionManagerP, USER.departmentManager],
    solution: {
      origin: USER.engineerA,
      steps: [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
      approvers: null,
      firstPendingCandidates: [USER.supervisorE],
    },
    finalStatus: 'DesignCostEstimationApproval',
  },
  'Business T03B': {
    requestOrigin: USER.requesterA,
    requestSteps: [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
    requestApprovers: [USER.supervisorP, USER.sectionManagerP, USER.departmentManager],
    solution: {
      origin: USER.supervisorE,
      steps: [POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
      approvers: null,
      firstPendingCandidates: [USER.sectionManagerE],
    },
    finalStatus: 'DesignCostEstimationApproval',
  },
  // T03 negatives: Request approved, solution submission denied — no solution row.
  'Business T03C': {
    requestOrigin: USER.requesterA,
    requestSteps: [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
    requestApprovers: [USER.supervisorP, USER.sectionManagerP, USER.departmentManager],
    solutionForbidden: true,
    finalStatus: 'SentToEngineer',
  },
  'Business T04A': {
    requestOrigin: USER.requesterA,
    requestSteps: [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
    requestApprovers: [USER.supervisorP, USER.sectionManagerP, USER.departmentManager],
    solution: {
      origin: USER.engineerA,
      steps: [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
      approvers: [USER.supervisorE, USER.sectionManagerE, USER.departmentManager],
    },
    final: {
      origin: USER.requesterA,
      steps: [POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
      approvers: [USER.sectionManagerP, USER.departmentManager],
    },
    finalStatus: 'Completed',
    // The T09 post-Completed Final denials target THIS completed request; the
    // persisted proof that those denials created no extra attempt lives here.
    singleFinalAttempt: true,
  },
  'Business T04B': {
    requestOrigin: USER.supervisorP,
    requestSteps: [POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
    requestApprovers: [USER.sectionManagerP, USER.departmentManager],
    solution: {
      origin: USER.supervisorE,
      steps: [POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
      approvers: [USER.sectionManagerE, USER.departmentManager],
    },
    final: {
      origin: USER.supervisorP,
      steps: [POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
      approvers: [USER.sectionManagerP, USER.departmentManager],
      // Task28 diagnostic coverage (existing T08 pattern): retain the FINAL
      // per-step captured candidate groups (members + company scope) so a
      // failing focused run still proves whether the PERSISTED candidates
      // were correct while the completion checks below honestly FAIL.
      // Grounded in the preserved 2026-09-19T13-31-00-268Z-full capture
      // (request 285d3105…, groups e67df579…/8e9e3727…, scope unit-company).
      candidates: [['user-section-manager-p'], ['user-department-manager']],
    },
    finalStatus: 'Completed',
    // Task28: one intact FINAL attempt (attempt 1, not superseded) — the
    // same T04A/T09 denial-proof shape, distinguishing the CURRENT pending
    // FINAL step from any restarted/superseded history.
    singleFinalAttempt: true,
  },
  // T08A–T08E — Final triggered after Solution approval by a DIFFERENT
  // authorized actor per fresh request. Triggering is NOT approving: see the
  // builder contract above. (T08D Section manager P is INDEPENDENTLY the
  // first saved FINAL candidate on the all-defaults chain; the in-UI proof
  // that a trigger grants no decision right comes from the other actors.)
  'Business T08A': allDefaultsFinalTriggerExpectation(), // trigger: Requester A (original requester)
  'Business T08B': allDefaultsFinalTriggerExpectation(), // trigger: Staff B (other Production 1 Staff)
  'Business T08C': allDefaultsFinalTriggerExpectation(), // trigger: Supervisor P (requester-unit hierarchy)
  'Business T08D': allDefaultsFinalTriggerExpectation(), // trigger: Section manager P (requester-unit hierarchy)
  'Business T08E': allDefaultsParentManagerDeniedExpectation(), // parent-department Department manager: DENIED (origin-unit-only rule)
  // T09A — PREMATURE Final denials: the four unauthorized actors attempt
  // Final BEFORE Solution approval on this fresh request. The request must
  // stay in the Solution-approval stage with NO FINAL approval instance at
  // all — a denied trigger must not create an attempt or a status change
  // (plan T09; notifications/mail are reviewed from captured-mail.json). The
  // T09 post-Completed denial segments target the completed T04A request;
  // their persisted proof is T04A's singleFinalAttempt check above.
  'Business T09A': {
    requestOrigin: USER.requesterA,
    requestSteps: [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
    requestApprovers: [USER.supervisorP, USER.sectionManagerP, USER.departmentManager],
    requestCandidates: [['user-second-approver', 'user-supervisor-p'], ['user-section-manager-p'], ['user-department-manager']],
    // Solution approval INTENTIONALLY never completes here (premature stage):
    // first pending step stays Supervisor E — same shape as the T03A
    // interrupted-solution expectation (no per-step candidates until approved).
    solution: {
      origin: USER.engineerA,
      steps: [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER],
      approvers: null,
      firstPendingCandidates: [USER.supervisorE],
    },
    finalStatus: 'DesignCostEstimationApproval',
    finalForbidden: true,
  },
}

/** Default-chain step sequences shared by the expectation maps below. */
const STEPS_SUPERVISOR_TO_DEPARTMENT = [
  POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER,
] as const
const STEPS_SECTION_TO_DEPARTMENT = [POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER] as const
const STEPS_DEPARTMENT_ONLY = [POSITION_DEPARTMENT_MANAGER] as const

/**
 * Confirmed expectations for the UNIT-EXCEPTION route profiles (plan §3:
 * test-only position-step replacement chains, never named-person chains and
 * never appended to the inherited default chain).
 *
 * Route ids below mirror what the fixture publishes per profile
 * (tests/support/business-workflow-fixture.ts routesFor): company defaults
 * `<config>-{request,solution,final}-default` (scope unit-company) plus, per
 * profile, the unit exception `<config>-solution-exception` (scope
 * unit-engineering-section, steps Section manager → Department manager) and
 * `<config>-final-exception` (scope unit-production-1-section, steps
 * Department manager only). The browser slice only ever has the ORIGINAL
 * REQUESTER trigger Final (T08/T10 other-actor trigger authority remains a
 * later slice), so FINAL origins below are the original requesters.
 *
 * Captured candidates per step are grounded in the real engine candidate
 * resolution locked by tests/regression/business-workflow-preparation.test.ts
 * (own team + reporting path intersected with the required position) and the
 * recorded all-defaults green run (supervisor step of a Production request
 * captures [user-second-approver, user-supervisor-p]).
 */
export const SOLUTION_EXCEPTION_EXPECTATIONS: Record<string, ScenarioExpectation> = {
  // T05 — Solution replacement only (Engineering scope); Request and Final stay defaults.
  'Business T05': {
    requestOrigin: USER.requesterA,
    requestSteps: [...STEPS_SUPERVISOR_TO_DEPARTMENT],
    requestApprovers: [USER.supervisorP, USER.sectionManagerP, USER.departmentManager],
    requestRouteId: 'solution-exception-request-default',
    requestRouteScopeUnitId: BUSINESS_UNITS.company,
    requestCandidates: [['user-second-approver', 'user-supervisor-p'], ['user-section-manager-p'], ['user-department-manager']],
    solution: {
      origin: USER.engineerA,
      steps: [...STEPS_SECTION_TO_DEPARTMENT],
      approvers: [USER.sectionManagerE, USER.departmentManager],
      routeId: 'solution-exception-solution-exception',
      routeScopeUnitId: BUSINESS_UNITS.engineeringSection,
      candidates: [['user-section-manager-e'], ['user-department-manager']],
    },
    final: {
      origin: USER.requesterA,
      steps: [...STEPS_SECTION_TO_DEPARTMENT],
      approvers: [USER.sectionManagerP, USER.departmentManager],
      routeId: 'solution-exception-final-default',
      routeScopeUnitId: BUSINESS_UNITS.company,
      candidates: [['user-section-manager-p'], ['user-department-manager']],
    },
    finalStatus: 'Completed',
  },
}

/**
 * Confirmed expectations for the T10 Final-ORIGIN scenarios (final-exception
 * profile): three EQUIVALENT Production 1 requests, all originating from
 * Requester A, each with a DIFFERENT Final-trigger actor (Requester A,
 * Staff B, parent Department manager). The parent Department manager is NOT
 * eligible (origin-unit-only rule, canInitiateFinalApproval): T10C proves the
 * denial, then the original requester initiates, so T10C additionally
 * asserts exactly one FINAL attempt. Per plan §3/§6 the FINAL phase must
 * follow the ORIGINAL REQUESTER for every trigger actor: route id
 * `final-exception-final-exception`, persisted scope unit-production-1-section
 * (the Production 1 requester-origin branch), originUserId = user-requester-a
 * (NEVER the trigger actor), Department-manager-only steps and captured
 * candidates.
 *
 * DISTINGUISHABILITY: Staff B shares Production 1 Section with Requester A (a
 * wrong trigger-origin would still resolve the same exception route — only
 * the persisted originUserId exposes it), while the parent Department manager
 * sits in unit-production-1: a wrong trigger-origin there would walk the
 * PARENT/company branch and select `final-exception-final-default` (scope
 * unit-company, Section manager → Department manager) — a DIFFERENT persisted
 * route id, scope, ordered steps and candidate set. A wrong trigger-origin is
 * therefore always visible in the persisted rows.
 */
function finalExceptionFinalOriginExpectation(): ScenarioExpectation {
  return {
    requestOrigin: USER.requesterA,
    requestSteps: [...STEPS_SUPERVISOR_TO_DEPARTMENT],
    requestApprovers: [USER.supervisorP, USER.sectionManagerP, USER.departmentManager],
    requestRouteId: 'final-exception-request-default',
    requestRouteScopeUnitId: BUSINESS_UNITS.company,
    requestCandidates: [['user-second-approver', 'user-supervisor-p'], ['user-section-manager-p'], ['user-department-manager']],
    solution: {
      origin: USER.engineerA,
      steps: [...STEPS_SUPERVISOR_TO_DEPARTMENT],
      approvers: [USER.supervisorE, USER.sectionManagerE, USER.departmentManager],
      routeId: 'final-exception-solution-default',
      routeScopeUnitId: BUSINESS_UNITS.company,
      candidates: [['user-supervisor-e'], ['user-section-manager-e'], ['user-department-manager']],
    },
    final: {
      origin: USER.requesterA,
      steps: [...STEPS_DEPARTMENT_ONLY],
      approvers: [USER.departmentManager],
      routeId: 'final-exception-final-exception',
      routeScopeUnitId: BUSINESS_UNITS.productionSection,
      candidates: [['user-department-manager']],
    },
    finalStatus: 'Completed',
  }
}

export const FINAL_EXCEPTION_EXPECTATIONS: Record<string, ScenarioExpectation> = {
  // T06 — Final replacement only (Production 1 requester-origin branch); Request and Solution stay defaults.
  'Business T06': {
    requestOrigin: USER.requesterA,
    requestSteps: [...STEPS_SUPERVISOR_TO_DEPARTMENT],
    requestApprovers: [USER.supervisorP, USER.sectionManagerP, USER.departmentManager],
    requestRouteId: 'final-exception-request-default',
    requestRouteScopeUnitId: BUSINESS_UNITS.company,
    requestCandidates: [['user-second-approver', 'user-supervisor-p'], ['user-section-manager-p'], ['user-department-manager']],
    solution: {
      origin: USER.engineerA,
      steps: [...STEPS_SUPERVISOR_TO_DEPARTMENT],
      approvers: [USER.supervisorE, USER.sectionManagerE, USER.departmentManager],
      routeId: 'final-exception-solution-default',
      routeScopeUnitId: BUSINESS_UNITS.company,
      candidates: [['user-supervisor-e'], ['user-section-manager-e'], ['user-department-manager']],
    },
    final: {
      origin: USER.requesterA,
      steps: [...STEPS_DEPARTMENT_ONLY],
      approvers: [USER.departmentManager],
      routeId: 'final-exception-final-exception',
      routeScopeUnitId: BUSINESS_UNITS.productionSection,
      candidates: [['user-department-manager']],
    },
    finalStatus: 'Completed',
  },
  // T10A–T10C — equivalent requests, DIFFERENT trigger actors; FINAL routing
  // must stay on the ORIGINAL requester's branch for every one of them
  // (builder contract above). A wrong trigger-origin for Staff B surfaces in
  // originUserId; for the Department manager it would additionally flip the
  // persisted route/scope/steps to the parent-branch company default.
  'Business T10A': finalExceptionFinalOriginExpectation(), // trigger: Requester A
  'Business T10B': finalExceptionFinalOriginExpectation(), // trigger: Staff B
  // T10C: the parent Department manager is DENIED (origin-unit-only rule);
  // the original requester then initiates, so exactly one FINAL attempt
  // exists and it follows the requester branch.
  'Business T10C': { ...finalExceptionFinalOriginExpectation(), singleFinalAttempt: true },
}

export const SOLUTION_AND_FINAL_EXCEPTIONS_EXPECTATIONS: Record<string, ScenarioExpectation> = {
  // T07A — both exceptions, STAFF origins (Requester A request, Engineer A solution).
  'Business T07A': {
    requestOrigin: USER.requesterA,
    requestSteps: [...STEPS_SUPERVISOR_TO_DEPARTMENT],
    requestApprovers: [USER.supervisorP, USER.sectionManagerP, USER.departmentManager],
    requestRouteId: 'solution-and-final-exceptions-request-default',
    requestRouteScopeUnitId: BUSINESS_UNITS.company,
    requestCandidates: [['user-second-approver', 'user-supervisor-p'], ['user-section-manager-p'], ['user-department-manager']],
    solution: {
      origin: USER.engineerA,
      steps: [...STEPS_SECTION_TO_DEPARTMENT],
      approvers: [USER.sectionManagerE, USER.departmentManager],
      routeId: 'solution-and-final-exceptions-solution-exception',
      routeScopeUnitId: BUSINESS_UNITS.engineeringSection,
      candidates: [['user-section-manager-e'], ['user-department-manager']],
    },
    final: {
      origin: USER.requesterA,
      steps: [...STEPS_DEPARTMENT_ONLY],
      approvers: [USER.departmentManager],
      routeId: 'solution-and-final-exceptions-final-exception',
      routeScopeUnitId: BUSINESS_UNITS.productionSection,
      candidates: [['user-department-manager']],
    },
    finalStatus: 'Completed',
  },
  // T07B — both exceptions, SUPERVISOR origins with own-rank skipping: the
  // Supervisor rank is omitted from the default REQUEST chain (Supervisor P
  // never approves their own request) and the Supervisor-origin solution
  // carries no supervisor step anyway (the replacement chain replaces — never
  // appends to — the default chain).
  'Business T07B': {
    requestOrigin: USER.supervisorP,
    requestSteps: [...STEPS_SECTION_TO_DEPARTMENT],
    requestApprovers: [USER.sectionManagerP, USER.departmentManager],
    requestRouteId: 'solution-and-final-exceptions-request-default',
    requestRouteScopeUnitId: BUSINESS_UNITS.company,
    requestCandidates: [['user-section-manager-p'], ['user-department-manager']],
    solution: {
      origin: USER.supervisorE,
      steps: [...STEPS_SECTION_TO_DEPARTMENT],
      approvers: [USER.sectionManagerE, USER.departmentManager],
      routeId: 'solution-and-final-exceptions-solution-exception',
      routeScopeUnitId: BUSINESS_UNITS.engineeringSection,
      candidates: [['user-section-manager-e'], ['user-department-manager']],
    },
    final: {
      origin: USER.supervisorP,
      steps: [...STEPS_DEPARTMENT_ONLY],
      approvers: [USER.departmentManager],
      routeId: 'solution-and-final-exceptions-final-exception',
      routeScopeUnitId: BUSINESS_UNITS.productionSection,
      candidates: [['user-department-manager']],
    },
    finalStatus: 'Completed',
  },
}

/** One expectation set per fixture route configuration (one profile per run). */
export const ROUTE_PROFILE_EXPECTATIONS: Readonly<Record<string, Readonly<Record<string, ScenarioExpectation>>>> = {
  'all-defaults': DEFAULT_WORKFLOW_EXPECTATIONS,
  'solution-exception': SOLUTION_EXCEPTION_EXPECTATIONS,
  'final-exception': FINAL_EXCEPTION_EXPECTATIONS,
  'solution-and-final-exceptions': SOLUTION_AND_FINAL_EXCEPTIONS_EXPECTATIONS,
}

/** LIKE pattern for business-scenario request titles. `T0%` wrongly dropped T10+. */
export const BUSINESS_REQUEST_TITLE_LIKE = 'Business T%'
const BUSINESS_REQUEST_FILTER = `r.title like '${BUSINESS_REQUEST_TITLE_LIKE}'`
const BUSINESS_INSTANCE_TITLE_FILTER = `r.title like '${BUSINESS_REQUEST_TITLE_LIKE}' or rs.title like '${BUSINESS_REQUEST_TITLE_LIKE}'`

async function queryJson(runtime: OwnedRuntime, sql: string): Promise<DbEvidenceRow[]> {
  let raw: string
  try {
    raw = await psqlQuery(runtime, REQUIRED_DATABASE_NAME, sql)
  } catch {
    // PSQL rejection: the original failure is deliberately UNBOUND and never
    // read/retained/coerced/wrapped (no cause, no payload, no original ref) —
    // only this fixed category is reported.
    throw new Error('db evidence: DB_EVIDENCE_QUERY_FAILED')
  }
  if (raw === '') return []
  try {
    const parsed = JSON.parse(raw) as DbEvidenceRow[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Malformed returned JSON: fixed category only — no SQL text, no raw
    // output payload, no diagnostic suffix.
    throw new Error('db evidence: DB_EVIDENCE_JSON_PARSE_FAILED')
  }
}

async function captureData(runtime: OwnedRuntime): Promise<DbEvidenceData> {
  const requests = await queryJson(
    runtime,
    `select coalesce(json_agg(row_to_json(t) order by t."createdAt"), '[]'::json) from (
       select id, title, status, "requesterId", "organizationUnitId", "createdAt", "updatedAt"
       from requests r
       where ${BUSINESS_REQUEST_FILTER} and "isDeleted" = false
     ) t`,
  )
  const solutions = await queryJson(
    runtime,
    `select coalesce(json_agg(row_to_json(t) order by t."submittedAt"), '[]'::json) from (
       select s.id, s."requestId", s."submittedById", s.title, s."costEstimate", s.currency, s.timeline, s."submittedAt"
       from solutions s
       join requests r on r.id = s."requestId"
       where ${BUSINESS_REQUEST_FILTER}
     ) t`,
  )
  const approvalInstances = await queryJson(
    runtime,
    `select coalesce(json_agg(row_to_json(t) order by t."createdAt"), '[]'::json) from (
       select i.id, i.phase, i."requestId", i."solutionId", i."routeVersionId", i."originUserId", i."originUnitId",
              i."originPositionId", i."routingMode", i.state, i.attempt, i."completionReason", i."supersededAt", i."createdAt",
              i."restartOfInstanceId", i."restartReason", i."restartedById"
       from approval_instances i
       left join requests r on r.id = i."requestId"
       left join solutions s on s.id = i."solutionId"
       left join requests rs on rs.id = s."requestId"
       where ${BUSINESS_INSTANCE_TITLE_FILTER}
     ) t`,
  )
  const candidateGroups = await queryJson(
    runtime,
    `select coalesce(json_agg(row_to_json(t) order by t."capturedAt"), '[]'::json) from (
       select g.id, g."approvalInstanceId", g."requiredPositionId", g."scopeUnitId", g."capturedAt",
              (select coalesce(json_agg(json_build_object('userId', m."userId", 'name', m."capturedDisplayName") order by m."userId"), '[]'::json)
               from approval_candidate_group_members m
               where m."candidateGroupId" = g.id) as members
       from approval_candidate_groups g
       join approval_instances i on i.id = g."approvalInstanceId"
       left join requests r on r.id = i."requestId"
       left join solutions s on s.id = i."solutionId"
       left join requests rs on rs.id = s."requestId"
       where ${BUSINESS_INSTANCE_TITLE_FILTER}
     ) t`,
  )
  const requestApprovals = await queryJson(
    runtime,
    `select coalesce(json_agg(row_to_json(t) order by t."createdAt", t."order"), '[]'::json) from (
       select a.id, a."requestId", a."instanceId", a."order", a.status, a."requiredPositionId", a."requiredApproverId",
              a."candidateGroupId", a."approverId", a."isFinalApproval", a."approvedAt", a."createdAt"
       from request_approvals a
       join requests r on r.id = a."requestId"
       where ${BUSINESS_REQUEST_FILTER}
     ) t`,
  )
  const solutionApprovals = await queryJson(
    runtime,
    `select coalesce(json_agg(row_to_json(t) order by t."createdAt", t."order"), '[]'::json) from (
       select a.id, a."solutionId", a."instanceId", a."order", a.status, a."requiredPositionId", a."requiredApproverId",
              a."candidateGroupId", a."approverId", a."approvedAt", a."createdAt"
       from solution_approvals a
       join solutions s on s.id = a."solutionId"
       join requests r on r.id = s."requestId"
       where ${BUSINESS_REQUEST_FILTER}
     ) t`,
  )
  const instanceSkips = await queryJson(
    runtime,
    `select coalesce(json_agg(row_to_json(t) order by t."createdAt"), '[]'::json) from (
       select k."approvalInstanceId", k."requiredPositionId", k.reason, k."createdAt"
       from approval_instance_skips k
       join approval_instances i on i.id = k."approvalInstanceId"
       left join requests r on r.id = i."requestId"
       left join solutions s on s.id = i."solutionId"
       left join requests rs on rs.id = s."requestId"
       where ${BUSINESS_INSTANCE_TITLE_FILTER}
     ) t`,
  )
  const routeVersions = await queryJson(
    runtime,
    `select coalesce(json_agg(row_to_json(t) order by t.id), '[]'::json) from (
       select v.id, v."scopeUnitId", v.phase, v.version, v.status, v."approvalLimitPositionId",
              (select coalesce(json_agg(json_build_object('order', st."stepOrder", 'positionId', st."positionId") order by st."stepOrder"), '[]'::json)
               from approval_route_steps st
               where st."routeVersionId" = v.id) as steps
       from approval_route_versions v
       where v."scopeUnitId" in (${FIXTURE_ROUTE_SCOPES.map((id) => `'${id}'`).join(', ')})
     ) t`,
  )
  const requestActivities = await queryJson(runtime, businessRequestActivitySelectSql())
  const notifications = await queryJson(runtime, businessNotificationsSelectSql())
  return {
    requests,
    solutions,
    approvalInstances,
    candidateGroups,
    requestApprovals,
    solutionApprovals,
    instanceSkips,
    routeVersions,
    requestActivities,
    notifications,
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function currentInstance(
  instances: DbEvidenceRow[],
  match: { requestId?: string; solutionId?: string; phase: string },
): DbEvidenceRow | undefined {
  // Linkage contract (verified against persisted rows): REQUEST and FINAL
  // instances carry requestId; SOLUTION instances persist requestId = null and
  // link through solutionId -> solutions.requestId instead. Matching a SOLUTION
  // instance by requestId never finds it (false negative), so the matcher takes
  // the phase-appropriate key.
  return instances
    .filter((row) => {
      if (str(row.phase) !== match.phase || row.supersededAt != null) return false
      if (match.solutionId !== undefined) return str(row.solutionId) === match.solutionId
      return str(row.requestId) === match.requestId
    })
    .sort((a, b) => Number(b.attempt ?? 0) - Number(a.attempt ?? 0))[0]
}

function orderedApprovals(rows: DbEvidenceRow[], instanceId: string): DbEvidenceRow[] {
  return rows
    .filter((row) => str(row.instanceId) === instanceId)
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
}

function candidateUserIds(groups: DbEvidenceRow[], candidateGroupId: string): string[] {
  const group = groups.find((row) => str(row.id) === candidateGroupId)
  const members = Array.isArray(group?.members) ? (group.members as Array<{ userId?: unknown }>) : []
  return members.map((member) => str(member.userId)).sort()
}

function idsEqual(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

/**
 * One captured-candidates check comparing the per-step persisted candidate
 * groups (member ids AND group scope) against the expected step alignment.
 */
function capturedCandidatesCheck(
  data: DbEvidenceData,
  prefix: string,
  title: string,
  phaseLabel: 'request' | 'solution' | 'final',
  rows: DbEvidenceRow[],
  expected: string[][],
  expectedGroupScopeUnitId: string,
): WorkflowCheck {
  const groups = rows.map((row) => data.candidateGroups.find((group) => str(group.id) === str(row.candidateGroupId)))
  const captured = rows.map((row) => candidateUserIds(data.candidateGroups, str(row.candidateGroupId)))
  const membersOk =
    captured.length === expected.length && captured.every((ids, index) => idsEqual(ids, [...expected[index]].sort()))
  const scopeMismatches = groups
    .map((group, index) =>
      group === undefined || str(group.scopeUnitId) !== expectedGroupScopeUnitId
        ? `${rows[index] ? str(rows[index].requiredPositionId) : '?'}→${group ? str(group.scopeUnitId) : '(group not found)'}`
        : '',
    )
    .filter((entry) => entry !== '')
  const format = (ids: string[][], positions: string[]): string =>
    ids.map((stepIds, index) => `${positions[index] ?? '?'}:[${stepIds.join(', ')}]`).join(' | ')
  return {
    name: `db-evidence/${prefix}/${phaseLabel}-captured-candidates`,
    status: membersOk && scopeMismatches.length === 0 ? 'pass' : 'fail',
    detail:
      membersOk && scopeMismatches.length === 0
        ? `${title}: ${phaseLabel.toUpperCase()} per-step captured candidates ${format(expected, rows.map((row) => str(row.requiredPositionId)))} (group scope ${expectedGroupScopeUnitId}) match the persisted candidate groups`
        : `${title}: ${phaseLabel.toUpperCase()} captured candidates ${format(captured, rows.map((row) => str(row.requiredPositionId)))} (expected ${format(expected, rows.map((row) => str(row.requiredPositionId)))}); group scope problems: ${scopeMismatches.join(', ') || '(none)'} (expected ${expectedGroupScopeUnitId})`,
  }
}

/**
 * Pure evaluator (no SQL): compares captured rows with the confirmed
 * expectations OF THE GIVEN ROUTE CONFIGURATION. Scenarios whose request
 * was not created in this run produce an explicit SKIPPED entry (no coverage
 * claimed — never a silent pass), scenarios of OTHER profiles executing
 * under this one FAIL (cross-profile leakage), and T01 smoke requests (no
 * expectation) are ignored.
 */

// ---------------------------------------------------------------------------
// T18B stranded-restart evidence (Astra round-14 P1-4): scoped, REQUIRED
// ---------------------------------------------------------------------------

/**
 * Runner-owned activity projection. `comments` is required so the exact
 * restart reason can be checked; omitting it made every real T18B activity
 * look missing.
 */
export function businessRequestActivitySelectSql(): string {
  return `select coalesce(json_agg(row_to_json(t) order by t."createdAt"), '[]'::json) from (
       select act."requestId", act."userId", act.action, act."fromStatus", act."toStatus", act.comments, act."createdAt"
       from request_activities act
       join requests r on r.id = act."requestId"
       where ${BUSINESS_REQUEST_FILTER}
     ) t`
}

/**
 * Task59/Task60: notifications capture SQL. The derived table projects ONLY
 * the structural multiplicity fields (id, requestId, userId, type — no
 * titles, no message bodies), so the outer aggregate MUST order by a
 * PROJECTED column: PostgreSQL rejects `order by t."createdAt"` when the
 * derived table does not project it (Astra P1 — that shape broke every
 * capture unconditionally). t.id keeps the aggregate deterministic;
 * chronological ordering is unnecessary for the count/multiplicity checks.
 * Shape is regression-locked by business-t15a-notification-evidence.test.ts
 * (static source pin — execution is proven by the live runner, not here).
 */
export function businessNotificationsSelectSql(): string {
  return `select coalesce(json_agg(row_to_json(t) order by t.id), '[]'::json) from (
       select n.id, n."requestId", n."userId", n.type
       from notifications n
       join requests r on r.id = n."requestId"
       where ${BUSINESS_REQUEST_FILTER}
     ) t`
}

export interface StrandedRestartEvidenceInput {
  /** Check-name prefix. Matching uses exactTitle, not this prefix. */
  titlePrefix: string
  /** Exact created request title recorded by the browser. */
  exactTitle: string
  /** requestId from createRequest, matched to the stranded row before restart. */
  recordedRequestId: string
  /** Old instance id selected in the browser, correlated to that title. */
  recordedOldInstanceId: string
  oldInstance: {
    attempt: number
    originUserId: string
    /** Captured groups of the PRESERVED old snapshot: [positionId, memberUserIds] pairs. */
    groups: ReadonlyArray<readonly [string, readonly string[]]>
  }
  replacement: {
    attempt: number
    restartReason: string
    restartedById: string
    /** The live step captured on the replacement: [positionId, memberUserIds]. */
    pendingGroup: readonly [string, readonly string[]]
    /** The intentionally skipped step on the replacement. */
    skip: { positionId: string; reason: string }
  }
  /** The admin activity audit expected for the restart. */
  activity: { action: string; userId: string; comments: string }
}

function memberIdsOf(data: DbEvidenceData, instanceId: string, positionId: string): string[] {
  const groups = data.candidateGroups.filter(
    (row) => str(row.approvalInstanceId) === instanceId && str(row.requiredPositionId) === positionId,
  )
  return groups
    .flatMap((group) => (Array.isArray(group.members) ? (group.members as Array<{ userId?: unknown }>) : []))
    .map((member) => str(member.userId))
    .sort()
}

function isFabricatedApprovalDecision(row: DbEvidenceRow): boolean {
  const status = str(row.status).toLowerCase()
  if (status === 'approved' || status === 'rejected') return true
  if (str(row.approverId) !== '') return true
  if (row.approvedAt != null && str(row.approvedAt) !== '') return true
  if (row.isFinalApproval === true) return true
  return false
}

/**
 * Pure REQUIRED evaluator for the T18B restart history of ONE exact request.
 * The request is matched by the browser-recorded exact title, and the old
 * instance is the browser-recorded id — not an origin-only guess. Missing
 * rows, a mismatched instance, corrupted linkage, an altered old snapshot,
 * or a fabricated approval decision FAIL. A pending step row written by
 * restart is not a decision. The browser never gets DB credentials.
 */
export function evaluateStrandedRestartEvidence(
  data: DbEvidenceData,
  input: StrandedRestartEvidenceInput,
): WorkflowCheck[] {
  const prefix = input.titlePrefix
  const n = (name: string) => `db-evidence/${prefix}/stranded-restart/${name}`
  const checks: WorkflowCheck[] = []
  const titled = data.requests.filter((row) => str(row.title) === input.exactTitle)
  const request = titled.length === 1 ? titled[0] : undefined
  if (!request) {
    checks.push({
      name: n('request-present'),
      status: 'fail',
      detail: titled.length === 0
        ? `REQUIRED T18B request "${input.exactTitle}" not found — required evidence is missing, not skipped`
        : `REQUIRED T18B request title "${input.exactTitle}" matched ${titled.length} rows — identity is ambiguous`,
    })
    checks.push({
      name: n('browser-instance-correlation'),
      status: 'fail',
      detail: `cannot correlate old instance ${input.recordedOldInstanceId} without the exact request`,
    })
    return checks
  }
  const requestId = str(request.id)
  const title = str(request.title)
  const recorded = data.approvalInstances.find((row) => str(row.id) === input.recordedOldInstanceId)
  const correlated = recorded !== undefined && str(recorded.requestId) === requestId && requestId === input.recordedRequestId
  checks.push({
    name: n('browser-instance-correlation'),
    status: correlated ? 'pass' : 'fail',
    detail: correlated
      ? `${title}: browser-recorded old instance ${input.recordedOldInstanceId} belongs to created request ${input.recordedRequestId}`
      : `${title}: browser-recorded old instance ${input.recordedOldInstanceId} does not belong to created request ${input.recordedRequestId} (origin-only matching is not identity)`,
  })
  const instances = data.approvalInstances.filter((row) => str(row.requestId) === requestId)
  const old = correlated ? recorded : undefined
  const oldPreserved = old !== undefined
    && Number(old.attempt ?? 0) === input.oldInstance.attempt
    && old.supersededAt != null
    && str(old.originUserId) === input.oldInstance.originUserId
  const current = instances.filter((row) => row.supersededAt == null && str(row.phase) === 'REQUEST')
  const replacement = current.find((row) => Number(row.attempt ?? 0) === input.replacement.attempt)

  checks.push({
    name: n('old-instance-preserved'),
    status: oldPreserved ? 'pass' : 'fail',
    detail: oldPreserved
      ? `${title}: original attempt ${input.oldInstance.attempt} from ${input.oldInstance.originUserId} preserved with supersession`
      : `${title}: preserved superseded original instance (attempt ${input.oldInstance.attempt}, origin ${input.oldInstance.originUserId}, id ${input.recordedOldInstanceId}) MISSING or altered`,
  })
  checks.push({
    name: n('exactly-one-current-replacement'),
    status: current.length === 1 && replacement !== undefined ? 'pass' : 'fail',
    detail: current.length === 1 && replacement !== undefined
      ? `${title}: exactly one current REQUEST instance (attempt ${input.replacement.attempt})`
      : `${title}: expected exactly one current replacement instance (attempt ${input.replacement.attempt}), found ${current.length}`,
  })

  if (old !== undefined) {
    for (const [positionId, expectedMembers] of input.oldInstance.groups) {
      const actual = memberIdsOf(data, str(old.id), positionId)
      const ok = actual.length === expectedMembers.length && [...expectedMembers].sort().every((id, index) => id === actual[index])
      checks.push({
        name: n(`old-group-${positionId}`),
        status: ok ? 'pass' : 'fail',
        detail: ok
          ? `${title}: preserved old snapshot group ${positionId} unchanged (${actual.join(', ')})`
          : `${title}: preserved old snapshot group ${positionId} ALTERED — expected [${[...expectedMembers].sort().join(', ')}], found [${actual.join(', ')}]`,
      })
    }
  }

  if (replacement !== undefined) {
    const linkageOk = str(replacement.restartOfInstanceId) === (old ? str(old.id) : '')
    checks.push({
      name: n('restart-linkage'),
      status: linkageOk ? 'pass' : 'fail',
      detail: linkageOk
        ? `${title}: replacement references the preserved old instance (restartOfInstanceId set)`
        : `${title}: corrupted/missing restart linkage — restartOfInstanceId "${str(replacement.restartOfInstanceId)}" does not match the preserved old instance`,
    })
    const reasonOk = str(replacement.restartReason) === input.replacement.restartReason
    checks.push({
      name: n('restart-reason'),
      status: reasonOk ? 'pass' : 'fail',
      detail: reasonOk
        ? `${title}: restart reason persisted exactly`
        : `${title}: restart reason mismatch — expected exactly ${JSON.stringify(input.replacement.restartReason)}, found ${JSON.stringify(str(replacement.restartReason))}`,
    })
    const adminOk = str(replacement.restartedById) === input.replacement.restartedById
    checks.push({
      name: n('restart-admin'),
      status: adminOk ? 'pass' : 'fail',
      detail: adminOk
        ? `${title}: restarted by ${input.replacement.restartedById}`
        : `${title}: restartedBy mismatch — expected ${input.replacement.restartedById}, found ${str(replacement.restartedById)}`,
    })

    const [pendingPositionId, pendingMembers] = input.replacement.pendingGroup
    const pendingActual = memberIdsOf(data, str(replacement.id), pendingPositionId)
    const pendingOk = pendingActual.length === pendingMembers.length && [...pendingMembers].sort().every((id, index) => id === pendingActual[index])
    checks.push({
      name: n('replacement-pending-group'),
      status: pendingOk ? 'pass' : 'fail',
      detail: pendingOk
        ? `${title}: replacement live step ${pendingPositionId} captured for [${pendingActual.join(', ')}]`
        : `${title}: replacement live step ${pendingPositionId} expected [${[...pendingMembers].sort().join(', ')}], found [${pendingActual.join(', ')}]`,
    })

    const skipOk = data.instanceSkips.some(
      (row) => str(row.approvalInstanceId) === str(replacement.id)
        && str(row.requiredPositionId) === input.replacement.skip.positionId
        && str(row.reason) === input.replacement.skip.reason,
    )
    checks.push({
      name: n('replacement-vacant-skip'),
      status: skipOk ? 'pass' : 'fail',
      detail: skipOk
        ? `${title}: replacement records ${input.replacement.skip.reason} skip for ${input.replacement.skip.positionId}`
        : `${title}: expected ${input.replacement.skip.reason} skip for ${input.replacement.skip.positionId} on the replacement — missing`,
    })

    const stateOk = str(replacement.state) === 'PENDING'
    checks.push({
      name: n('replacement-pending-state'),
      status: stateOk ? 'pass' : 'fail',
      detail: stateOk
        ? `${title}: replacement instance state is PENDING`
        : `${title}: replacement state must be PENDING, found ${JSON.stringify(str(replacement.state) || '(missing)')}`,
    })
    const pendingGroup = data.candidateGroups.find((group) => {
      if (str(group.approvalInstanceId) !== str(replacement.id) || str(group.requiredPositionId) !== pendingPositionId) return false
      const members = memberIdsOf(data, str(replacement.id), pendingPositionId)
      return members.length === pendingMembers.length && [...pendingMembers].sort().every((id, index) => id === members[index])
    })
    const pendingApproval = data.requestApprovals.find((row) => (
      str(row.instanceId) === str(replacement.id)
      && str(row.status).toLowerCase() === 'pending'
      && str(row.requiredPositionId) === pendingPositionId
      && pendingGroup !== undefined
      && str(row.candidateGroupId) === str(pendingGroup.id)
      && !isFabricatedApprovalDecision(row)
    ))
    checks.push({
      name: n('replacement-pending-approval'),
      status: pendingApproval !== undefined ? 'pass' : 'fail',
      detail: pendingApproval !== undefined
        ? `${title}: pending ${pendingPositionId} approval row is persisted for the spare group`
        : `${title}: pending ${pendingPositionId} approval row for the spare group is missing, removed, or not pending`,
    })
    const fabricatedApprovals = data.requestApprovals.filter(
      (row) => str(row.instanceId) === str(replacement.id) && isFabricatedApprovalDecision(row),
    )
    checks.push({
      name: n('no-fabricated-approval'),
      status: fabricatedApprovals.length === 0 ? 'pass' : 'fail',
      detail: fabricatedApprovals.length === 0
        ? `${title}: restart granted no approval decision (the pending Department row is the new step, not a decision)`
        : `${title}: fabricated approval decision(s) on the replacement: ${fabricatedApprovals.map((row) => str(row.id)).join(', ')}`,
    })

    const activityOk = data.requestActivities.some(
      (row) => str(row.requestId) === requestId
        && str(row.userId) === input.activity.userId
        && str(row.action) === input.activity.action
        && str(row.comments) === input.activity.comments,
    )
    checks.push({
      name: n('restart-activity-audit'),
      status: activityOk ? 'pass' : 'fail',
      detail: activityOk
        ? `${title}: restarted_stranded_attempt activity recorded by ${input.activity.userId} with the exact reason`
        : `${title}: restarted_stranded_attempt activity (user ${input.activity.userId}, exact reason) MISSING`,
    })
  }

  return checks
}

// ---------------------------------------------------------------------------
// T18C2 all-steps-vacant auto-completion evidence (Task24): REQUIRED,
// runner-owned, read-only
// ---------------------------------------------------------------------------

export interface T18c2VacancyEvidenceInput {
  /** Exact created request title recorded by the browser. */
  exactTitle: string
  /** Expected REQUEST route version id (`<config>-request-default`). */
  expectedRouteVersionId: string
}

/** Exact auto-completion audit comment persisted by src/server-actions/requests.ts. */
const T18C2_AUTO_COMPLETION_COMMENT = 'Auto-completed: NO_ELIGIBLE_APPROVAL_STEPS (no eligible approval steps)'

/**
 * Pure REQUIRED evaluator for the T18C2 all-vacant auto-completion of ONE
 * exact request (matched by the browser-recorded unique exact title — zero
 * or multiple matches FAIL, an origin-only prefix is never identity).
 * Verified against the ACTUAL production behavior (no invented values):
 *  - plan.ts: zero eligible steps → state COMPLETED_NO_ELIGIBLE_STEPS with
 *    completionReason NO_ELIGIBLE_APPROVAL_STEPS (never AUTO_APPROVED),
 *    every route step skipped with reason VACANT_POSITION;
 *  - attempts.ts statusChangeFor: REQUEST phase completes → request status
 *    SentToEngineer;
 *  - requests.ts: 'created' activity plus a 'status_changed' activity whose
 *    comments are exactly the auto-completion sentence above.
 * The scenario never restarts, captures no candidate group, and persists no
 * approval decision — any of those rows FAILS. The browser never gets DB
 * credentials.
 */
export function evaluateT18c2VacancyEvidence(
  data: DbEvidenceData,
  input: T18c2VacancyEvidenceInput,
): WorkflowCheck[] {
  const n = (name: string) => `db-evidence/Business T18C2/vacancy-auto-complete/${name}`
  const checks: WorkflowCheck[] = []
  const titled = data.requests.filter((row) => str(row.title) === input.exactTitle)
  const request = titled.length === 1 ? titled[0] : undefined
  if (!request) {
    checks.push({
      name: n('request-present'),
      status: 'fail',
      detail: titled.length === 0
        ? `REQUIRED T18C2 request "${input.exactTitle}" not found — required evidence is missing, not skipped`
        : `REQUIRED T18C2 request title "${input.exactTitle}" matched ${titled.length} rows — identity is ambiguous`,
    })
    return checks
  }
  const requestId = str(request.id)
  const title = str(request.title)
  checks.push({
    name: n('request-present'),
    status: 'pass',
    detail: `${title}: exactly one request matches the browser-recorded exact title`,
  })
  checks.push({
    name: n('requester-bound'),
    status: str(request.requesterId) === USER.staffVacantAll ? 'pass' : 'fail',
    detail: `${title}: requester ${str(request.requesterId)} (expected ${USER.staffVacantAll} — the all-steps-vacant account on the isolated branch)`,
  })

  const requestInstances = data.approvalInstances.filter(
    (row) => str(row.requestId) === requestId && str(row.phase) === 'REQUEST',
  )
  const instance = requestInstances.length === 1 ? requestInstances[0] : undefined
  const soleInstance = instance !== undefined
    && Number(instance.attempt ?? 0) === 1
    && instance.supersededAt == null
  checks.push({
    name: n('request-instance'),
    status: soleInstance ? 'pass' : 'fail',
    detail: soleInstance
      ? `${title}: exactly one REQUEST approval instance, attempt 1, current (not superseded)`
      : `${title}: expected exactly one current attempt-1 REQUEST instance, found ${requestInstances.length}${requestInstances.length === 1 ? ` (attempt ${String(requestInstances[0]?.attempt ?? '?')}${requestInstances[0]?.supersededAt != null ? ', superseded' : ''})` : ''}`,
  })

  if (instance !== undefined && soleInstance) {
    checks.push({
      name: n('request-route'),
      status: str(instance.routeVersionId) === input.expectedRouteVersionId ? 'pass' : 'fail',
      detail: `${title}: REQUEST route ${str(instance.routeVersionId)} (expected ${input.expectedRouteVersionId})`,
    })
    checks.push({
      name: n('completion-state'),
      status: str(instance.state) === 'COMPLETED_NO_ELIGIBLE_STEPS' ? 'pass' : 'fail',
      detail: str(instance.state) === 'COMPLETED_NO_ELIGIBLE_STEPS'
        ? `${title}: instance state COMPLETED_NO_ELIGIBLE_STEPS (not AUTO_APPROVED — the origin rank is below the limit)`
        : `${title}: instance state must be COMPLETED_NO_ELIGIBLE_STEPS, found ${JSON.stringify(str(instance.state) || '(missing)')}`,
    })
    checks.push({
      name: n('completion-reason'),
      status: str(instance.completionReason) === 'NO_ELIGIBLE_APPROVAL_STEPS' ? 'pass' : 'fail',
      detail: `${title}: completionReason ${JSON.stringify(str(instance.completionReason))} (expected exactly "NO_ELIGIBLE_APPROVAL_STEPS")`,
    })
    const restartFields = [instance.restartOfInstanceId, instance.restartReason, instance.restartedById]
    const noRestart = restartFields.every((field) => field == null || str(field) === '')
    checks.push({
      name: n('no-restart-linkage'),
      status: noRestart ? 'pass' : 'fail',
      detail: noRestart
        ? `${title}: no restart linkage — the attempt was decided at creation, never restarted`
        : `${title}: unexpected restart linkage on the creation attempt (restartOfInstanceId/restartReason/restartedById set)`,
    })

    const groups = data.candidateGroups.filter((row) => str(row.approvalInstanceId) === str(instance.id))
    checks.push({
      name: n('zero-candidate-groups'),
      status: groups.length === 0 ? 'pass' : 'fail',
      detail: groups.length === 0
        ? `${title}: zero candidate groups captured — no step was ever eligible`
        : `${title}: expected zero candidate groups, found ${groups.length} (${groups.map((row) => str(row.requiredPositionId)).join(', ')})`,
    })

    const skips = data.instanceSkips.filter((row) => str(row.approvalInstanceId) === str(instance.id))
    const expectedSkips = [POSITION_SUPERVISOR, POSITION_SECTION_MANAGER, POSITION_DEPARTMENT_MANAGER]
    const actualPositions = skips.map((row) => str(row.requiredPositionId)).sort()
    const positionsOk = idsEqual(actualPositions, [...expectedSkips].sort())
    const reasonsOk = skips.every((row) => str(row.reason) === 'VACANT_POSITION')
    checks.push({
      name: n('vacant-skips'),
      status: positionsOk && reasonsOk ? 'pass' : 'fail',
      detail: positionsOk && reasonsOk
        ? `${title}: exactly 3 VACANT_POSITION skips [${actualPositions.join(', ')}] — supervisor, section manager, department manager`
        : `${title}: expected exactly [${[...expectedSkips].sort().join(', ')}] skips each reason VACANT_POSITION, found [${skips.map((row) => `${str(row.requiredPositionId)}:${str(row.reason)}`).join(', ')}]`,
    })
  }

  const approvals = data.requestApprovals.filter((row) => str(row.requestId) === requestId)
  checks.push({
    name: n('zero-request-approvals'),
    status: approvals.length === 0 ? 'pass' : 'fail',
    detail: approvals.length === 0
      ? `${title}: zero request approval rows — no step was ever decided and none was fabricated`
      : `${title}: expected zero request approval rows, found ${approvals.length} (${approvals.map((row) => `${str(row.requiredPositionId)}:${str(row.status)}`).join(', ')})`,
  })

  checks.push({
    name: n('terminal-status'),
    status: str(request.status) === 'SentToEngineer' ? 'pass' : 'fail',
    detail: `${title}: final persisted status ${str(request.status)} (expected SentToEngineer)`,
  })

  const createdActivity = data.requestActivities.some(
    (row) => str(row.requestId) === requestId && str(row.action) === 'created' && str(row.userId) === USER.staffVacantAll,
  )
  checks.push({
    name: n('created-activity'),
    status: createdActivity ? 'pass' : 'fail',
    detail: createdActivity
      ? `${title}: 'created' activity recorded by ${USER.staffVacantAll}`
      : `${title}: 'created' activity (user ${USER.staffVacantAll}) MISSING`,
  })
  const autoCompletionAudit = data.requestActivities.some(
    (row) => str(row.requestId) === requestId
      && str(row.action) === 'status_changed'
      && str(row.userId) === USER.staffVacantAll
      && str(row.fromStatus) === 'ImprovementRequest'
      && str(row.toStatus) === 'SentToEngineer'
      && str(row.comments) === T18C2_AUTO_COMPLETION_COMMENT,
  )
  checks.push({
    name: n('status-changed-audit'),
    status: autoCompletionAudit ? 'pass' : 'fail',
    detail: autoCompletionAudit
      ? `${title}: 'status_changed' ImprovementRequest→SentToEngineer activity persisted with the exact auto-completion comment`
      : `${title}: auto-completion 'status_changed' audit (ImprovementRequest→SentToEngineer by ${USER.staffVacantAll}, exact comment) MISSING or altered`,
  })

  return checks
}

export function evaluateDefaultWorkflowEvidence(data: DbEvidenceData, routesConfig: string): WorkflowCheck[] {
  const checks: WorkflowCheck[] = []
  const expectations = ROUTE_PROFILE_EXPECTATIONS[routesConfig]
  if (!expectations) {
    throw new Error(
      `db evidence: unknown route configuration "${routesConfig}" (known: ${Object.keys(ROUTE_PROFILE_EXPECTATIONS).join(', ')})`,
    )
  }

  const ceilingViolations = [...data.requestApprovals, ...data.solutionApprovals]
    .map((row) => str(row.requiredPositionId))
    .filter((positionId) => positionId !== '' && !(CEILING_ALLOWED_POSITIONS as readonly string[]).includes(positionId))
  checks.push({
    name: 'db-evidence/department-ceiling',
    status: ceilingViolations.length === 0 ? 'pass' : 'fail',
    detail:
      ceilingViolations.length === 0
        ? `every persisted approval step position is within Supervisor → Department manager (no position above the Department ceiling)`
        : `approval steps above/outside the allowed ceiling: ${ceilingViolations.join(', ')}`,
  })

  const limitViolations = data.routeVersions
    .filter((row) => str(row.status) === 'PUBLISHED')
    .filter((row) => str(row.approvalLimitPositionId) !== POSITION_DEPARTMENT_MANAGER)
  checks.push({
    name: 'db-evidence/published-limit-position',
    status: limitViolations.length === 0 ? 'pass' : 'fail',
    detail:
      limitViolations.length === 0
        ? 'every published fixture route caps approval at the Department manager position'
        : `published routes with a different limit: ${limitViolations.map((row) => `${str(row.id)}→${str(row.approvalLimitPositionId)}`).join(', ')}`,
  })

  for (const [prefix, expectation] of Object.entries(expectations)) {
    const request = data.requests.find((row) => str(row.title).startsWith(prefix))
    if (!request) {
      checks.push({
        name: `db-evidence/${prefix}`,
        status: 'skipped',
        detail: `scenario request not executed in this "${routesConfig}" run — no coverage claimed`,
      })
      continue
    }
    const requestId = str(request.id)
    const title = str(request.title)

    const requestInstance = currentInstance(data.approvalInstances, { requestId, phase: 'REQUEST' })
    if (!requestInstance) {
      checks.push({ name: `db-evidence/${prefix}/request-instance`, status: 'fail', detail: `${title}: no current REQUEST approval instance persisted` })
      continue
    }
    // Rows are matched by the owning instance id (instanceId) — the durable
    // phase linkage. The isFinalApproval flag is NOT used for row selection:
    // the flag itself is audited by the explicit *-flag-consistency checks
    // below so a product inconsistency is surfaced, never swallowed.
    const requestRows = orderedApprovals(data.requestApprovals, str(requestInstance.id))
    const requestFlagViolations = requestRows.filter((row) => row.isFinalApproval !== false)
    checks.push({
      name: `db-evidence/${prefix}/request-flag-consistency`,
      status: requestFlagViolations.length === 0 ? 'pass' : 'fail',
      detail:
        requestFlagViolations.length === 0
          ? `${title}: every REQUEST-phase approval row is persisted with isFinalApproval=false`
          : `${title}: REQUEST-phase rows persisted with unexpected isFinalApproval values (expected false for every REQUEST row): ${requestFlagViolations.map((row) => `${str(row.id)}→${String(row.isFinalApproval)}`).join(', ')}`,
    })
    const expectedRequestRoute = expectation.requestRouteId ?? `${routesConfig}-request-default`
    checks.push({
      name: `db-evidence/${prefix}/request-route`,
      status: str(requestInstance.routeVersionId) === expectedRequestRoute ? 'pass' : 'fail',
      detail: `${title}: REQUEST route ${str(requestInstance.routeVersionId)} (expected ${expectedRequestRoute}, source COMPANY_DEFAULT)`,
    })
    if (expectation.requestRouteScopeUnitId) {
      const routeVersion = data.routeVersions.find((row) => str(row.id) === str(requestInstance.routeVersionId))
      checks.push({
        name: `db-evidence/${prefix}/request-route-scope`,
        status: routeVersion !== undefined && str(routeVersion.scopeUnitId) === expectation.requestRouteScopeUnitId ? 'pass' : 'fail',
        detail: `${title}: REQUEST route ${str(requestInstance.routeVersionId)} persisted scope ${routeVersion ? str(routeVersion.scopeUnitId) : '(route version not found)'} (expected ${expectation.requestRouteScopeUnitId})`,
      })
    }
    checks.push({
      name: `db-evidence/${prefix}/request-origin`,
      status: str(requestInstance.originUserId) === expectation.requestOrigin ? 'pass' : 'fail',
      detail: `${title}: REQUEST origin ${str(requestInstance.originUserId)} (expected ${expectation.requestOrigin})`,
    })
    checks.push({
      name: `db-evidence/${prefix}/request-ordered-steps`,
      status: idsEqual(requestRows.map((row) => str(row.requiredPositionId)), expectation.requestSteps) ? 'pass' : 'fail',
      detail: `${title}: REQUEST ordered required steps [${requestRows.map((row) => str(row.requiredPositionId)).join(' → ')}] (expected [${expectation.requestSteps.join(' → ')}]${expectation.requestSteps.includes(POSITION_SUPERVISOR) ? '' : ' — Supervisor rank omitted for the Supervisor origin'})`,
    })
    const approvedRequestRows = requestRows.filter((row) => str(row.status) === 'approved')
    checks.push({
      name: `db-evidence/${prefix}/request-approvers`,
      status: idsEqual(approvedRequestRows.map((row) => str(row.approverId)), expectation.requestApprovers) ? 'pass' : 'fail',
      detail: `${title}: REQUEST approvers [${approvedRequestRows.map((row) => str(row.approverId)).join(' → ')}] (expected [${expectation.requestApprovers.join(' → ')}])`,
    })
    if (expectation.requestCandidates) {
      checks.push(
        capturedCandidatesCheck(
          data, prefix, title, 'request', requestRows, expectation.requestCandidates,
          expectation.requestRouteScopeUnitId ?? BUSINESS_UNITS.company,
        ),
      )
    }

    if (expectation.solutionForbidden) {
      const rogueSolution = data.solutions.find((row) => str(row.requestId) === requestId)
      checks.push({
        name: `db-evidence/${prefix}/no-solution`,
        status: rogueSolution === undefined ? 'pass' : 'fail',
        detail:
          rogueSolution === undefined
            ? `${title}: no SOLUTION row persisted (unauthorized submit created no partial write)`
            : `${title}: SOLUTION row ${str(rogueSolution.id)} persisted after unauthorized submit (expected none)`,
      })
    }

    if (expectation.solution) {
      const solution = data.solutions.find((row) => str(row.requestId) === requestId)
      // SOLUTION instances persist requestId = null; linkage is
      // solutionId -> solutions.requestId. Matching by solutionId (not
      // requestId) is the fix for the original false-negative lookup.
      const solutionInstance = solution
        ? currentInstance(data.approvalInstances, { solutionId: str(solution.id), phase: 'SOLUTION' })
        : undefined
      if (!solution || !solutionInstance) {
        checks.push({ name: `db-evidence/${prefix}/solution-instance`, status: 'fail', detail: `${title}: no current SOLUTION approval instance persisted` })
      } else {
        const solutionRows = orderedApprovals(data.solutionApprovals, str(solutionInstance.id))
        const expectedSolutionRoute = expectation.solution.routeId ?? `${routesConfig}-solution-default`
        checks.push({
          name: `db-evidence/${prefix}/solution-route`,
          status: str(solutionInstance.routeVersionId) === expectedSolutionRoute ? 'pass' : 'fail',
          detail: `${title}: SOLUTION route ${str(solutionInstance.routeVersionId)} (expected ${expectedSolutionRoute}), solution submitter ${str(solution.submittedById)} (expected ${expectation.solution.origin})`,
        })
        if (expectation.solution.routeScopeUnitId) {
          const routeVersion = data.routeVersions.find((row) => str(row.id) === str(solutionInstance.routeVersionId))
          checks.push({
            name: `db-evidence/${prefix}/solution-route-scope`,
            status: routeVersion !== undefined && str(routeVersion.scopeUnitId) === expectation.solution.routeScopeUnitId ? 'pass' : 'fail',
            detail: `${title}: SOLUTION route ${str(solutionInstance.routeVersionId)} persisted scope ${routeVersion ? str(routeVersion.scopeUnitId) : '(route version not found)'} (expected ${expectation.solution.routeScopeUnitId}${expectation.solution.routeScopeUnitId === BUSINESS_UNITS.company ? '' : ' — UNIT_EXCEPTION scope'})`,
          })
        }
        checks.push({
          name: `db-evidence/${prefix}/solution-origin`,
          status: str(solutionInstance.originUserId) === expectation.solution.origin ? 'pass' : 'fail',
          detail: `${title}: SOLUTION origin ${str(solutionInstance.originUserId)} (expected ${expectation.solution.origin})`,
        })
        checks.push({
          name: `db-evidence/${prefix}/solution-ordered-steps`,
          status: idsEqual(solutionRows.map((row) => str(row.requiredPositionId)), expectation.solution.steps) ? 'pass' : 'fail',
          detail: `${title}: SOLUTION ordered required steps [${solutionRows.map((row) => str(row.requiredPositionId)).join(' → ')}] (expected [${expectation.solution.steps.join(' → ')}]${expectation.solution.steps.includes(POSITION_SUPERVISOR) ? '' : ' — replacement chain / Supervisor rank omitted for the Supervisor origin'})`,
        })
        if (expectation.solution.approvers !== null) {
          const approvedSolutionRows = solutionRows.filter((row) => str(row.status) === 'approved')
          checks.push({
            name: `db-evidence/${prefix}/solution-approvers`,
            status: idsEqual(approvedSolutionRows.map((row) => str(row.approverId)), expectation.solution.approvers as string[]) ? 'pass' : 'fail',
            detail: `${title}: SOLUTION approvers [${approvedSolutionRows.map((row) => str(row.approverId)).join(' → ')}] (expected [${(expectation.solution.approvers as string[]).join(' → ')}])`,
          })
        }
        if (expectation.solution.candidates) {
          checks.push(
            capturedCandidatesCheck(
              data, prefix, title, 'solution', solutionRows, expectation.solution.candidates,
              expectation.solution.routeScopeUnitId ?? BUSINESS_UNITS.company,
            ),
          )
        }
        if (expectation.solution.firstPendingCandidates) {
          const pending = solutionRows.find((row) => str(row.status) === 'pending')
          const captured = pending ? candidateUserIds(data.candidateGroups, str(pending.candidateGroupId)) : []
          checks.push({
            name: `db-evidence/${prefix}/solution-pending-candidates`,
            status:
              pending !== undefined &&
              idsEqual(captured, [...(expectation.solution.firstPendingCandidates as string[])].sort())
                ? 'pass'
                : 'fail',
            detail: `${title}: first pending SOLUTION step ${pending ? str(pending.requiredPositionId) : '(none)'} captured candidates [${captured.join(', ')}] (expected [${(expectation.solution.firstPendingCandidates as string[]).join(', ')}])`,
          })
        }
      }
    }

    if (expectation.final) {
      const finalInstance = currentInstance(data.approvalInstances, { requestId, phase: 'FINAL' })
      if (!finalInstance) {
        checks.push({ name: `db-evidence/${prefix}/final-instance`, status: 'fail', detail: `${title}: no current FINAL approval instance persisted` })
      } else {
        // FINAL rows are matched by the owning instance id, NOT by the
        // isFinalApproval flag. The flag expectation itself is asserted
        // separately right below so a product inconsistency stays visible
        // instead of being hidden by the instanceId-based row matching.
        const finalRows = orderedApprovals(data.requestApprovals, str(finalInstance.id))
        const finalFlagViolations = finalRows.filter((row) => row.isFinalApproval !== true)
        checks.push({
          name: `db-evidence/${prefix}/final-flag-consistency`,
          status: finalFlagViolations.length === 0 ? 'pass' : 'fail',
          detail:
            finalFlagViolations.length === 0
              ? `${title}: every FINAL-phase approval row is persisted with isFinalApproval=true`
              : `${title}: FINAL-phase rows persisted with isFinalApproval=false (expected true for every FINAL row — product flag inconsistency; the rows themselves are still evaluated via instanceId): ${finalFlagViolations.map((row) => `${str(row.id)}→${String(row.isFinalApproval)}`).join(', ')}`,
        })
        const expectedFinalRoute = expectation.final.routeId ?? `${routesConfig}-final-default`
        checks.push({
          name: `db-evidence/${prefix}/final-route`,
          status: str(finalInstance.routeVersionId) === expectedFinalRoute ? 'pass' : 'fail',
          detail: `${title}: FINAL route ${str(finalInstance.routeVersionId)} (expected ${expectedFinalRoute})`,
        })
        if (expectation.final.routeScopeUnitId) {
          const routeVersion = data.routeVersions.find((row) => str(row.id) === str(finalInstance.routeVersionId))
          checks.push({
            name: `db-evidence/${prefix}/final-route-scope`,
            status: routeVersion !== undefined && str(routeVersion.scopeUnitId) === expectation.final.routeScopeUnitId ? 'pass' : 'fail',
            detail: `${title}: FINAL route ${str(finalInstance.routeVersionId)} persisted scope ${routeVersion ? str(routeVersion.scopeUnitId) : '(route version not found)'} (expected ${expectation.final.routeScopeUnitId}${expectation.final.routeScopeUnitId === BUSINESS_UNITS.company ? '' : ' — UNIT_EXCEPTION scope'})`,
          })
        }
        checks.push({
          name: `db-evidence/${prefix}/final-origin`,
          status: str(finalInstance.originUserId) === expectation.final.origin ? 'pass' : 'fail',
          detail: `${title}: FINAL origin ${str(finalInstance.originUserId)} (expected ${expectation.final.origin} — the original requester branch)`,
        })
        checks.push({
          name: `db-evidence/${prefix}/final-ordered-steps`,
          status: idsEqual(finalRows.map((row) => str(row.requiredPositionId)), expectation.final.steps) ? 'pass' : 'fail',
          detail: `${title}: FINAL ordered required steps [${finalRows.map((row) => str(row.requiredPositionId)).join(' → ')}] (expected [${expectation.final.steps.join(' → ')}])`,
        })
        const approvedFinalRows = finalRows.filter((row) => str(row.status) === 'approved')
        checks.push({
          name: `db-evidence/${prefix}/final-approvers`,
          status: idsEqual(approvedFinalRows.map((row) => str(row.approverId)), expectation.final.approvers) ? 'pass' : 'fail',
          detail: `${title}: FINAL approvers [${approvedFinalRows.map((row) => str(row.approverId)).join(' → ')}] (expected [${expectation.final.approvers.join(' → ')}])`,
        })
        if (expectation.final.candidates) {
          checks.push(
            capturedCandidatesCheck(
              data, prefix, title, 'final', finalRows, expectation.final.candidates,
              expectation.final.routeScopeUnitId ?? BUSINESS_UNITS.company,
            ),
          )
        }
      }
    }

    // T09 denial proofs (persisted truth; notifications/mail for denied
    // attempts are reviewed from the runner's captured-mail.json):
    if (expectation.finalForbidden) {
      const finalAttempts = data.approvalInstances.filter(
        (row) => str(row.phase) === 'FINAL' && str(row.requestId) === requestId,
      )
      checks.push({
        name: `db-evidence/${prefix}/no-final-instance`,
        status: finalAttempts.length === 0 ? 'pass' : 'fail',
        detail:
          finalAttempts.length === 0
            ? `${title}: no FINAL approval instance exists — denied/premature Final triggers created no attempt`
            : `${title}: unexpected FINAL approval instance(s) persisted (attempt(s) ${finalAttempts.map((row) => String(row.attempt ?? '?')).join(', ')}) — a denied/premature Final trigger must not create an attempt`,
      })
    }
    if (expectation.singleFinalAttempt) {
      const finalAttempts = data.approvalInstances.filter(
        (row) => str(row.phase) === 'FINAL' && str(row.requestId) === requestId,
      )
      const sole = finalAttempts.length === 1 ? finalAttempts[0] : undefined
      const intact = sole !== undefined && Number(sole.attempt ?? 0) === 1 && sole.supersededAt == null
      checks.push({
        name: `db-evidence/${prefix}/single-final-attempt`,
        status: intact ? 'pass' : 'fail',
        detail: intact
          ? `${title}: exactly one FINAL approval instance (attempt 1, not superseded) — no extra attempt was created`
          : `${title}: expected exactly one intact FINAL approval instance (attempt 1, not superseded), found ${finalAttempts.length}`,      })
    }

    checks.push({
      name: `db-evidence/${prefix}/terminal-status`,
      status: str(request.status) === expectation.finalStatus ? 'pass' : 'fail',
      detail: `${title}: final persisted status ${str(request.status)} (expected ${expectation.finalStatus})`,
    })

    const ownedSolutionId = str(data.solutions.find((solution) => str(solution.requestId) === requestId)?.id ?? '')
    const unexpectedSkips = data.instanceSkips.filter((row) => {
      const instance = data.approvalInstances.find((candidate) => str(candidate.id) === str(row.approvalInstanceId))
      if (!instance) return false
      if (str(instance.requestId) === requestId) return true
      // An empty solution id is not an identity. Matching '' to '' blamed
      // every solution-less request for another request's vacancy skips.
      return ownedSolutionId !== '' && str(instance.solutionId) === ownedSolutionId
    })
    checks.push({
      name: `db-evidence/${prefix}/no-vacant-skips`,
      status: unexpectedSkips.length === 0 ? 'pass' : 'fail',
      detail:
        unexpectedSkips.length === 0
          ? `${title}: no VACANT_POSITION skips were recorded (all default positions staffed)`
          : `${title}: unexpected skips ${JSON.stringify(unexpectedSkips)}`,
    })
  }

  // Scenarios of the OTHER fixture route profiles: an explicit SKIPPED entry
  // (never "pass" — a skipped profile is never counted as coverage), and a
  // FAILURE if a scenario of another profile somehow executed under this
  // configuration (cross-profile leakage must be visible, not silent).
  for (const [otherProfile, otherExpectations] of Object.entries(ROUTE_PROFILE_EXPECTATIONS)) {
    if (otherProfile === routesConfig) continue
    const executed = Object.keys(otherExpectations).filter((prefix) =>
      data.requests.some((row) => str(row.title).startsWith(prefix)),
    )
    checks.push({
      name: `db-evidence/config/${otherProfile}`,
      status: executed.length === 0 ? 'skipped' : 'fail',
      detail:
        executed.length === 0
          ? `route configuration "${otherProfile}" not selected for this run — its scenarios were not executed and are NOT counted as coverage`
          : `scenarios ${executed.join(', ')} belong to configuration "${otherProfile}" but executed under "${routesConfig}" — cross-profile execution is not allowed`,
    })
  }

  return checks
}

export function t18bStrandedRestartInput(correlation: T18bBrowserCorrelation): StrandedRestartEvidenceInput {
  return {
    titlePrefix: 'Business T18B',
    exactTitle: correlation.requestTitle,
    recordedRequestId: correlation.requestId,
    recordedOldInstanceId: correlation.oldInstanceId,
    oldInstance: {
      attempt: 1,
      originUserId: USER.supervisorP,
      groups: [
        [BUSINESS_POSITIONS.sectionManager, [USER.sectionManagerP]],
        [BUSINESS_POSITIONS.departmentManager, [USER.departmentManager]],
      ],
    },
    replacement: {
      attempt: 2,
      restartReason: T18B_RESTART_REASON,
      restartedById: 'user-admin',
      pendingGroup: [BUSINESS_POSITIONS.departmentManager, ['user-unassigned']],
      skip: { positionId: BUSINESS_POSITIONS.sectionManager, reason: 'VACANT_POSITION' },
    },
    activity: {
      action: 'restarted_stranded_attempt',
      userId: 'user-admin',
      comments: T18B_RESTART_REASON,
    },
  }
}

/**
 * Checks the runner actually persists. Generic profile evaluation does not
 * verify T18B (that silence is a coverage gap). On all-defaults the browser
 * correlation is REQUIRED; missing or corrupt correlation fails rather than
 * skipping or prefix-matching an origin. A focused run that selected a
 * DIFFERENT scenario (focusedScenario) executed no T18B test: its T18B
 * checks are not run and T18B is recorded as an explicit NOT-SELECTED skip
 * — never a missing-correlation failure and never claimed as coverage.
 *
 * Task24: the same contract now covers the REQUIRED T18C2 evidence
 * (all-steps-vacant auto-completion). T18C2 is required when the runner
 * passes requireT18c2 (default full all-defaults run and focused T18C2 —
 * t18c2EvidenceApplies); a focused T18B run records T18C2 as an explicit
 * not-selected skip instead, and T18B requirements are unchanged.
 *
 * Task56: the same contract now covers the REQUIRED T15A persisted
 * single-transition evidence (exact browser-correlated title, one FINAL
 * attempt, APPROVED state, Completed request, exact rows/groups/audits).
 * T15A is required when the runner passes requireT15a (default full
 * all-defaults run and focused T15A — t15aEvidenceApplies); every other
 * selection records T15A as an explicit not-selected skip, and no other
 * scenario's requirement is weakened.
 *
 * Task59: when the T15A correlation is present, the assembler ALSO appends
 * the separate notification-multiplicity checks (duplicate alert evidence)
 * — the 12 Task56 persisted checks are unchanged; the not-selected and
 * missing/corrupt-correlation paths fail/skip exactly as before.
 */
export function assembleBusinessDbChecks(
  data: DbEvidenceData,
  routesConfig: string,
  correlation: T18bCorrelationRead,
  options: {
    requireT18b?: boolean
    requireT18c2?: boolean
    t18c2?: T18c2CorrelationRead
    focusedScenario?: string
    requireT15a?: boolean
    t15a?: T15aCorrelationRead
  } = {},
): WorkflowCheck[] {
  const checks = [...evaluateDefaultWorkflowEvidence(data, routesConfig)]
  const requireT18b = options.requireT18b ?? routesConfig === 'all-defaults'
  if (!requireT18b) {
    if (options.focusedScenario && options.focusedScenario !== 'T18B') {
      checks.push({
        name: 'db-evidence/Business T18B/stranded-restart/browser-correlation-not-selected',
        status: 'skipped',
        detail: `T18B was not selected in this focused ${options.focusedScenario} run — the T18B test did not execute, its browser correlation is not required, and its stranded-restart checks were NOT run (no T18B coverage claimed for this selection)`,
      })
    }
  } else if (correlation.status !== 'present') {
    checks.push({
      name: 'db-evidence/Business T18B/stranded-restart/browser-correlation-missing',
      status: 'fail',
      detail: correlation.status === 'corrupt'
        ? 'REQUIRED T18B browser correlation file is corrupt — exact request title and selected old instance id were not proven'
        : 'REQUIRED T18B browser correlation (exact created request title + selected old instance id) is missing — origin-only rows are not verification',
    })
  } else {
    checks.push(...evaluateStrandedRestartEvidence(data, t18bStrandedRestartInput(correlation.correlation)))
  }

  const requireT18c2 = options.requireT18c2 ?? false
  // Task56: REQUIRED T15A persisted single-transition evidence — same
  // require/not-selected/missing triad as T18C2, no weakening elsewhere.
  // Runs BEFORE the T18C2 block because that block's not-required path is
  // an early return (T15A must never be unreachable behind it).
  const requireT15a = options.requireT15a ?? false
  if (!requireT15a) {
    if (options.focusedScenario && options.focusedScenario !== 'T15A') {
      checks.push({
        name: 'db-evidence/Business T15A/persisted-single-transition/browser-correlation-not-selected',
        status: 'skipped',
        detail: `T15A was not selected in this focused ${options.focusedScenario} run — the T15A test did not execute, its browser correlation is not required, and its persisted single-transition checks were NOT run (no T15A coverage claimed for this selection)`,
      })
    }
  } else {
    const t15a = options.t15a ?? { status: 'missing' as const }
    if (t15a.status !== 'present') {
      checks.push({
        name: 'db-evidence/Business T15A/persisted-single-transition/browser-correlation-missing',
        status: 'fail',
        detail: t15a.status === 'corrupt'
          ? 'REQUIRED T15A browser correlation file is corrupt — the exact request title and measured identity were not proven'
          : 'REQUIRED T15A browser correlation (exact request title + attemptedClicks 2 + observed 1-or-2 POSTs) is missing — required evidence fails, it is never skipped',
      })
    } else {
      checks.push(...evaluateT15aPersistedEvidence(data, {
        exactTitle: t15a.correlation.requestTitle,
        expectedRouteVersionId: `${routesConfig}-final-default`,
      }))
      checks.push(...evaluateT15aNotificationEvidence(data, {
        exactTitle: t15a.correlation.requestTitle,
      }))
    }
  }
  if (!requireT18c2) {
    if (options.focusedScenario && options.focusedScenario !== 'T18C2') {
      checks.push({
        name: 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-not-selected',
        status: 'skipped',
        detail: `T18C2 was not selected in this focused ${options.focusedScenario} run — the T18C2 test did not execute, its browser correlation is not required, and its vacancy-auto-complete checks were NOT run (no T18C2 coverage claimed for this selection)`,
      })
    }
    return checks
  }
  const t18c2 = options.t18c2 ?? { status: 'missing' as const }
  if (t18c2.status !== 'present') {
    checks.push({
      name: 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-missing',
      status: 'fail',
      detail: t18c2.status === 'corrupt'
        ? 'REQUIRED T18C2 browser correlation file is corrupt — the exact created request title was not proven'
        : 'REQUIRED T18C2 browser correlation (exact created request title) is missing — required evidence fails, it is never skipped',
    })
    return checks
  }
  checks.push(...evaluateT18c2VacancyEvidence(data, {
    exactTitle: t18c2.correlation.requestTitle,
    expectedRouteVersionId: `${routesConfig}-request-default`,
  }))
  return checks
}

export async function captureWorkflowDbEvidence(
  runtime: OwnedRuntime,
  evidenceDir: string,
  routesConfig: string,
  options: { requireT18b?: boolean; requireT18c2?: boolean; focusedScenario?: string; requireT15a?: boolean } = {},
): Promise<DbEvidenceResult> {
  const data = await captureData(runtime)
  const correlation = await readT18bBrowserCorrelation(evidenceDir)
  const t18c2 = await readT18c2BrowserCorrelation(evidenceDir)
  const t15a = await readT15aBrowserCorrelation(evidenceDir)
  const checks = assembleBusinessDbChecks(data, routesConfig, correlation, {
    requireT18b: options.requireT18b,
    requireT18c2: options.requireT18c2,
    t18c2,
    focusedScenario: options.focusedScenario,
    requireT15a: options.requireT15a,
    t15a,
  })
  const failures = checks.filter((check) => check.status === 'fail').map((check) => `${check.name}: ${check.detail}`)
  const payload = {
    note: 'read-only psql capture of the runner-owned disposable database, taken after the browser suite and before cleanup; no secrets, fixture workflow tables only; browser never receives DATABASE_URL',
    capturedAt: new Date().toISOString(),
    routesConfiguration: routesConfig,
    t18bBrowserCorrelation: correlation.status === 'present' ? correlation.correlation : { status: correlation.status },
    t18c2BrowserCorrelation: t18c2.status === 'present' ? t18c2.correlation : { status: t18c2.status },
    t15aBrowserCorrelation: t15a.status === 'present' ? t15a.correlation : { status: t15a.status },
    data,
    checks,
  }
  const file = 'db-evidence.json'
  await fs.writeFile(path.join(evidenceDir, file), JSON.stringify(payload, null, 2))
  return { file, checks, failures }
}
