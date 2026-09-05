/**
 * Shared Task 1 fixtures for the organization approval redesign baseline.
 *
 * Data only: stable actor/unit IDs and stored legacy-behavior expectations that
 * later tasks must keep green. The fixture deliberately does NOT encode a
 * department-to-position mapping or a replacement candidate; test scenarios
 * seed their own staffing into their own fakes. Future tasks extend these
 * exports; earlier behavioral assertions stay green.
 */

export const ORGANIZATION_APPROVAL_FIXTURE = {
  factoryId: 'factory-1',
  divisionId: 'division-1',
  departmentId: 'department-pd',
  sectionId: 'section-pd1',
  siblingSectionId: 'section-pd2',
  requesterId: 'staff-1',
  supervisorId: 'supervisor-1',
  sectionManagerId: 'section-manager-1',
  departmentManagerId: 'department-manager-1',
  divisionManagerId: 'division-manager-1',
  factoryManagerId: 'factory-manager-1',
  engineeringId: 'engineer-1',
  inactiveCandidateId: 'inactive-1',
  /** System role actor, kept separate from positions. */
  adminId: 'admin-1',
  /** Custom-chain cross-check approver (DepartmentApprover-style external). */
  customCrossCheckApproverId: 'custom-approver-1',
  /** Departed actor whose historical approval rows still coordinate guards. */
  historicalActorId: 'historical-actor-1',
  /** User with no department membership. */
  nullOrgUserId: 'null-org-user-1',
  /** Engineering department unit ID (solution/final phase origin). */
  engineeringDepartmentId: 'department-engineering',
} as const

export const LEGACY_CHAIN_EXPECTATIONS = {
  sparseLevels: [3, 5],
  requestCompletion: { from: 'ImprovementRequest', to: 'SentToEngineer' },
  solutionCompletion: { from: 'DesignCostEstimationApproval', to: 'SendBackToRequester' },
  finalCompletion: { from: 'FinalApproval', to: 'Completed' },
} as const

export function legacyRequestRows(input: {
  requestId: string
  levels: number[]
}): Array<{ requestId: string; requiredLevel: number; order: number; status: 'pending' }> {
  return input.levels.map((requiredLevel, index) => ({
    requestId: input.requestId,
    requiredLevel,
    order: index + 1,
    status: 'pending',
  }))
}

export function phaseStatusExpectation(phase: 'REQUEST' | 'SOLUTION' | 'FINAL'):
  { from: string; to: string } {
  if (phase === 'REQUEST') return { from: 'ImprovementRequest', to: 'SentToEngineer' }
  if (phase === 'SOLUTION') return { from: 'DesignCostEstimationApproval', to: 'SendBackToRequester' }
  return { from: 'FinalApproval', to: 'Completed' }
}

// ---------------------------------------------------------------------------
// Legacy notification event contract
// ---------------------------------------------------------------------------

/**
 * Delivery channels in the legacy workflow. `in_app` rows written directly via
 * `tx.notifications.create` never trigger email; `createNotification` /
 * `notifyUsersInDepartment` add the best-effort email copy; department
 * broadcasts fan out one row per active department user.
 */
export type LegacyNotificationChannel =
  | 'in_app'
  | 'in_app+email'
  | 'in_app_department_broadcast+email'

/**
 * How a stored expectation is verified. Entries whose recipient/event decision
 * lives inline inside an action body (or a module-private helper) have no
 * injectable boundary yet: their contracts are STORED here for later tasks and
 * flagged as residuals instead of being faked as asserted evidence.
 */
export type LegacyNotificationAssertedVia =
  | 'recorded production delivery (real action + notifications module, mocked SMTP/DB)'
  | 'recorded db writes'
  | 'recorded orchestration dispatch'

export interface LegacyNotificationExpectation {
  /** Named workflow case (Task 1 baseline ID). */
  case: string
  eventType:
    | 'approval_needed'
    | 'approval_granted'
    | 'approval_rejected'
    | 'status_changed'
    | 'request_assigned'
    | 'solution_ready'
    | 'final_approval_needed'
    | null
  /** Fixed fixture recipients for the baseline scenario, when applicable. */
  recipientIds: readonly string[]
  /** How the production boundary derives recipients. */
  recipientsRule: string
  channel: LegacyNotificationChannel
  transition: Readonly<{ from: string; to: string }> | null
  assertedVia: LegacyNotificationAssertedVia
}

/**
 * The preserved phase-specific notification contract. Phase-specific rules the
 * redesign must keep exactly: custom solution chains notify ALL approvers at
 * submit; custom final chains notify ONLY the first-step approver; completion
 * broadcasts reach the requester department while excluding engineering users;
 * cancellation notifies no one.
 */
export const LEGACY_NOTIFICATION_EXPECTATIONS: readonly LegacyNotificationExpectation[] = [
  {
    case: 'request submit approval needed',
    eventType: 'approval_needed',
    recipientIds: ['supervisor-1'],
    recipientsRule:
      'active internal and external approvers at the first pending request-approval level',
    channel: 'in_app+email',
    transition: null,
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'request approval intermediate next approver',
    eventType: 'approval_needed',
    recipientIds: ['department-manager-1'],
    recipientsRule: 'all active approvers at the next pending request-approval level',
    channel: 'in_app+email',
    transition: null,
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'request approval phase completed engineering task broadcast',
    eventType: 'request_assigned',
    recipientIds: [],
    recipientsRule: 'all active users of the ENGINEERING department',
    channel: 'in_app_department_broadcast+email',
    transition: phaseStatusExpectation('REQUEST'),
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'request approval phase other status requester notice',
    eventType: 'status_changed',
    recipientIds: ['staff-1'],
    recipientsRule: 'the requester',
    channel: 'in_app+email',
    transition: { from: 'SendBackToRequester', to: 'Completed' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'solution submit custom chain all at submit',
    eventType: 'approval_needed',
    recipientIds: [],
    recipientsRule:
      'notifies every id in the submitted customApproverIds array verbatim (raw list: duplicates and the submitter included), while the persisted chain rows are the sanitized unique non-submitter set',
    channel: 'in_app+email',
    transition: { from: 'SentToEngineer', to: 'DesignCostEstimationApproval' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'solution submit hierarchy chain first level',
    eventType: 'approval_needed',
    recipientIds: [],
    recipientsRule:
      'active Engineering users at the first pending hierarchy level (from actual chain data, never arithmetic submitter+1)',
    channel: 'in_app+email',
    transition: { from: 'SentToEngineer', to: 'DesignCostEstimationApproval' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'solution submit auto top level requester ready',
    eventType: 'solution_ready',
    recipientIds: ['staff-1'],
    recipientsRule: 'the requester',
    channel: 'in_app+email',
    transition: { from: 'SentToEngineer', to: 'SendBackToRequester' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'solution approval intermediate next approver',
    eventType: 'approval_needed',
    recipientIds: ['supervisor-1'],
    recipientsRule:
      'custom chain: the requiredApproverId of the first pending row only; hierarchy chain: all active Engineering users at its requiredLevel',
    channel: 'in_app+email',
    transition: null,
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'solution approval completed requester department ready',
    eventType: 'solution_ready',
    recipientIds: [],
    recipientsRule: 'all active users of the requester department',
    channel: 'in_app_department_broadcast+email',
    transition: phaseStatusExpectation('SOLUTION'),
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'solution rejected submitter rework',
    eventType: 'approval_rejected',
    recipientIds: ['engineer-1'],
    recipientsRule: 'the solution submitter',
    channel: 'in_app+email',
    transition: { from: 'DesignCostEstimationApproval', to: 'SentToEngineer' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'solution resubmit custom chain all approvers',
    eventType: 'approval_needed',
    recipientIds: [],
    recipientsRule: 'every submitted custom approver (auto path notifies the requester department instead)',
    channel: 'in_app+email',
    transition: { from: 'SentToEngineer', to: 'DesignCostEstimationApproval' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'final initiate custom chain first step only',
    eventType: 'final_approval_needed',
    recipientIds: [],
    recipientsRule:
      'the requiredApproverId of the first pending final-approval row only (order 1), never later steps',
    channel: 'in_app+email',
    transition: { from: 'SendBackToRequester', to: 'FinalApproval' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'final initiate hierarchy chain first level',
    eventType: 'final_approval_needed',
    recipientIds: [],
    recipientsRule: 'active requester-department users at the first pending final level',
    channel: 'in_app+email',
    transition: { from: 'SendBackToRequester', to: 'FinalApproval' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'final initiate auto top level completed notice',
    eventType: 'status_changed',
    recipientIds: ['staff-1'],
    recipientsRule: 'the requester (in-app row only, written inside the transaction)',
    channel: 'in_app',
    transition: { from: 'SendBackToRequester', to: 'Completed' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'final approval intermediate next approver',
    eventType: 'final_approval_needed',
    recipientIds: [],
    recipientsRule: 'the next pending final step only (custom: assigned person; hierarchy: level members)',
    channel: 'in_app+email',
    transition: null,
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'final approval completed department broadcast',
    eventType: 'approval_granted',
    recipientIds: [],
    recipientsRule: 'all active users of the requester department excluding engineering users',
    channel: 'in_app_department_broadcast+email',
    transition: phaseStatusExpectation('FINAL'),
    assertedVia: 'recorded orchestration dispatch',
  },
  {
    case: 'final approval rejected engineering rework',
    eventType: 'approval_rejected',
    recipientIds: [],
    recipientsRule:
      'Engineering department excluding the rejector (approval_rejected), plus the requester department excluding the rejector (status_changed)',
    channel: 'in_app_department_broadcast+email',
    transition: { from: 'FinalApproval', to: 'SentToEngineer' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'request cancelled',
    eventType: null,
    recipientIds: [],
    recipientsRule: 'cancellation notifies no one; only the cancelled activity is written',
    channel: 'in_app',
    transition: { from: 'any current status', to: 'Cancelled' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
  {
    case: 'request completed manual',
    eventType: 'status_changed',
    recipientIds: ['staff-1'],
    recipientsRule: 'the requester (in-app row only, written inside the transaction)',
    channel: 'in_app',
    transition: { from: 'SendBackToRequester', to: 'Completed' },
    assertedVia: 'recorded production delivery (real action + notifications module, mocked SMTP/DB)',
  },
]
