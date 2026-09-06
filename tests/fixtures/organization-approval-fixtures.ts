/**
 * Shared Task 1 fixtures for the organization approval redesign baseline.
 *
 * Data only: stable actor/unit IDs and stored legacy-behavior expectations that
 * later tasks must keep green. The fixture deliberately does NOT encode a
 * department-to-position mapping or a replacement candidate; test scenarios
 * seed their own staffing into their own fakes. Future tasks extend these
 * exports; earlier behavioral assertions stay green.
 */

import type { OrganizationPositionCode, ReportingBranch } from '@/lib/organization/types'
import type { ResolvedApprovalRoute } from '@/lib/approval-routes/types'
import type { RequestStatus } from '@prisma/client'
import type { ApprovalInstancePlan, ApprovalStepPlan } from '@/lib/approval-engine/types'
import type { ApprovalEngineDb, PhaseOrigin } from '@/lib/approval-engine/types'
import type { PhaseAdapterDb } from '@/lib/approval-engine/phase-adapters'

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

// ---------------------------------------------------------------------------
// Task 7 NEW approval-engine boundary fake
// ---------------------------------------------------------------------------

/** Positions whose candidate pools resolve through reporting-group paths. */
const GROUP_PATH_POSITIONS: readonly OrganizationPositionCode[] = ['STAFF', 'SUPERVISOR']

const PHASE_ORIGIN_SOURCES: Record<PhaseOrigin['phase'], PhaseOrigin['source']> = {
  REQUEST: 'REQUESTER',
  SOLUTION: 'SOLUTION_SUBMITTER',
  FINAL: 'FINAL_INITIATOR',
}

export interface FakeApprovalEngineDbInput {
  origin: { userId: string; unitId: string; position: OrganizationPositionCode }
  route: ResolvedApprovalRoute
  candidates: Partial<Record<OrganizationPositionCode, string[]>>
}

/**
 * Task 7 engine-boundary fake. Its three repository methods resolve the
 * supplied origin/route and return `{ id, isActive: true }` records from an
 * internal Map keyed by required position; `replaceCandidates` changes only
 * that Map after a plan has been built, proving the returned snapshot is
 * immutable. The full branch/context is derived from the supplied origin and
 * route path. It must never call Prisma.
 */
// ---------------------------------------------------------------------------
// Task 8 phase-adapter fixtures
// ---------------------------------------------------------------------------


/** Persisted approval-row shape the phase-adapter fakes store and return. */
export interface FakeAdapterApprovalRow {
  id: string
  requestId?: string
  solutionId?: string
  isFinalApproval?: boolean
  requiredLevel?: number | null
  requiredApproverId?: string | null
  order: number
  status: 'pending' | 'approved' | 'rejected'
  approverId?: string | null
  comments?: string | null
  approvedAt?: Date | null
  isCustomChain: boolean
  routingMode?: string
  integrityVersion?: number
  instanceId?: string | null
  requiredPosition?: string | null
  candidateGroupId?: string | null
  createdAt?: Date
}

/** Persisted approval_instances shape the phase-adapter fakes store. */
export interface FakeAdapterInstanceRow {
  id: string
  requestId: string | null
  solutionId: string | null
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  routeVersionId: string | null
  originUserId: string
  originUnitId: string
  originContext: unknown
  routingMode: string
  state: string
  attempt: number
  completionReason: string | null
  supersededAt: Date | null
  createdAt: Date
}

/** What `ensureLegacyAttemptWrapped` did, for adapter-test assertions. */
export interface LegacyWrapRecord {
  instanceId: string
  attempt: number
  routingMode: 'LEGACY_LEVEL' | 'CUSTOM_PERSON'
  state: string
  wrappedRowCount: number
}

export interface PhaseAdapterFixtureOptions {
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  /** Phase initiator resolved by the fake engine db (per-phase origin). */
  originUserId?: string
  originUnitId?: string
  originPosition?: OrganizationPositionCode
  requestId?: string
  solutionId?: string
  /** Initial document status supplied by `loadRequestContext`. */
  initialStatus?: string
  /** Route shape the fake resolver returns; decides AUTO/PENDING/NO_ELIGIBLE. */
  planOutcome?: 'AUTO_APPROVED' | 'PENDING' | 'NO_ELIGIBLE'
  candidates?: Partial<Record<OrganizationPositionCode, string[]>>
  /** An existing (current) NEW attempt from a previous submission. */
  priorAttempt?: {
    attempt: number
    state: string
    rows: FakeAdapterApprovalRow[]
  }
  /** Legacy (instance-less) rows the wrap capability imports on first NEW resubmission. */
  legacyRows?: FakeAdapterApprovalRow[]
  requesterId?: string
  departmentId?: string | null
  organizationUnitId?: string | null
}

export interface PhaseAdapterFixtureDb extends PhaseAdapterDb {
  /** Capability mirror of the production Prisma wrap; mechanical row/instance bookkeeping only. */
  ensureLegacyAttemptWrapped(input: {
    requestId: string
    solutionId?: string
    phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
    fallbackOriginUserId: string
  }): Promise<LegacyWrapRecord | null>
  instances(): FakeAdapterInstanceRow[]
  approvalRows(): FakeAdapterApprovalRow[]
  requestStatus(): string
  statusUpdates(): Array<{ from: string; to: string }>
  priorAttemptState(requestId: string, phase: 'REQUEST' | 'SOLUTION' | 'FINAL'): 'SUPERSEDED' | 'PENDING'
  priorAttemptRowsRemain(requestId: string): boolean
}

const PHASE_INITIAL_STATUS: Record<'REQUEST' | 'SOLUTION' | 'FINAL', string> = {
  REQUEST: 'ImprovementRequest',
  SOLUTION: 'SentToEngineer',
  FINAL: 'SendBackToRequester',
}

const PHASE_ORIGIN_ACTOR: Record<'REQUEST' | 'SOLUTION' | 'FINAL', string> = {
  REQUEST: 'staff-1',
  SOLUTION: 'engineer-1',
  FINAL: 'department-member-1',
}

function autoApprovedRoute(phase: 'REQUEST' | 'SOLUTION' | 'FINAL'): ResolvedApprovalRoute {
  // Ceiling 1 puts every initiator at/above the ceiling: the builder returns
  // AUTO_APPROVED before consulting steps.
  return {
    id: `route-${phase.toLowerCase()}-auto`,
    phase,
    scopeUnitId: 'section-pd1',
    version: 1,
    maximumPositionLevel: 1,
    status: 'PUBLISHED',
    ancestorScopeIds: ['section-pd1', 'department-pd', 'division-1', 'factory-1'],
    steps: [
      { order: 1, position: 'SUPERVISOR' },
      { order: 2, position: 'SECTION_MANAGER' },
    ],
  }
}

function pendingRoute(phase: 'REQUEST' | 'SOLUTION' | 'FINAL'): ResolvedApprovalRoute {
  return {
    id: `route-${phase.toLowerCase()}-pending`,
    phase,
    scopeUnitId: 'section-pd1',
    version: 1,
    maximumPositionLevel: 4,
    status: 'PUBLISHED',
    ancestorScopeIds: ['section-pd1', 'department-pd', 'division-1', 'factory-1'],
    steps: [
      { order: 1, position: 'SUPERVISOR' },
      { order: 2, position: 'SECTION_MANAGER' },
      { order: 3, position: 'DEPARTMENT_MANAGER' },
    ],
  }
}

/** DB-faithful null defaults for legacy/prior row seeds (nullable columns). */
function normalizeAdapterRow(row: FakeAdapterApprovalRow): FakeAdapterApprovalRow {
  return {
    approverId: null,
    requiredApproverId: null,
    requiredLevel: null,
    requiredPosition: null,
    candidateGroupId: null,
    comments: null,
    approvedAt: null,
    routingMode: 'LEGACY_LEVEL',
    integrityVersion: 0,
    ...row,
  }
}

/**
 * Task 8 phase-adapter fixture. Supplies document context, an AUTO/PENDING/
 * NO_ELIGIBLE route, current/prior instance rows and legacy rows in Maps, and
 * records supersession and status CAS writes. The ADAPTER computes every
 * transition and history decision; the fixture only emulates the mechanical
 * persistence the Prisma transaction client would perform. It never calls
 * Prisma.
 */
export function createPhaseAdapterFixture(options: PhaseAdapterFixtureOptions): PhaseAdapterFixtureDb {
  const phase = options.phase
  const requestId = options.requestId ?? 'r1'
  const solutionId = options.solutionId ?? 's1'
  const originUserId = options.originUserId ?? PHASE_ORIGIN_ACTOR[phase]
  const originUnitId = options.originUnitId ?? 'section-pd1'
  const originPosition: OrganizationPositionCode = options.originPosition ?? 'STAFF'
  let docStatus = options.initialStatus ?? PHASE_INITIAL_STATUS[phase]
  const statusUpdates: Array<{ from: string; to: string }> = []

  const planOutcome = options.planOutcome ?? 'AUTO_APPROVED'
  const candidates = options.candidates ?? (
    planOutcome === 'PENDING'
      ? {
        SUPERVISOR: ['supervisor-1'],
        SECTION_MANAGER: ['section-manager-1'],
        DEPARTMENT_MANAGER: ['department-manager-1'],
      }
      : {}
  )

  const instances = new Map<string, FakeAdapterInstanceRow>()
  const rows = new Map<string, FakeAdapterApprovalRow>()
  let instanceSeq = 0
  let rowSeq = 0

  const docInstanceWhere = (row: FakeAdapterInstanceRow): boolean =>
    row.phase === phase &&
    (phase === 'SOLUTION' ? row.solutionId === solutionId : row.requestId === requestId)

  if (options.priorAttempt) {
    const id = `instance-prior-${phase}`
    instances.set(id, {
      id,
      requestId: phase === 'SOLUTION' ? null : requestId,
      solutionId: phase === 'SOLUTION' ? solutionId : null,
      phase,
      routeVersionId: null,
      originUserId,
      originUnitId,
      originContext: {},
      routingMode: 'SNAPSHOT_GROUP',
      state: options.priorAttempt.state,
      attempt: options.priorAttempt.attempt,
      completionReason: null,
      supersededAt: null,
      createdAt: new Date(),
    })
    for (const row of options.priorAttempt.rows) {
      const rowId = row.id ?? `row-prior-${++rowSeq}`
      rows.set(rowId, { ...normalizeAdapterRow(row), id: rowId, instanceId: id })
    }
  }
  for (const row of options.legacyRows ?? []) {
    const rowId = row.id ?? `row-legacy-${++rowSeq}`
    rows.set(rowId, { ...normalizeAdapterRow(row), id: rowId, instanceId: row.instanceId ?? null })
  }

  const engine: ApprovalEngineDb = {
    resolvePhaseOrigin: async (query) => {
      if (query.originUserId !== undefined && query.originUserId !== originUserId) {
        throw new Error('Fake adapter origin user does not match the requested actor')
      }
      return {
        phase: query.phase,
        originUserId,
        originUnitId,
        branch: {
          originUserId,
          primaryUnitId: originUnitId,
          primaryAssignmentId: `assignment-${originUserId}`,
          primaryPosition: originPosition,
          unitPath: ['section-pd1', 'department-pd', 'division-1', 'factory-1'],
          groupPath: ['group-pd1'],
        },
        originalRequestId: query.requestId,
        requestDepartmentId: options.departmentId ?? 'department-pd',
        source: PHASE_ORIGIN_SOURCES[query.phase],
      }
    },
    resolvePublishedRoute: async () => {
      if (planOutcome === 'AUTO_APPROVED') {
        return { ...autoApprovedRoute(phase), steps: autoApprovedRoute(phase).steps.map((s) => ({ ...s })), ancestorScopeIds: [...autoApprovedRoute(phase).ancestorScopeIds] }
      }
      return { ...pendingRoute(phase), steps: pendingRoute(phase).steps.map((s) => ({ ...s })), ancestorScopeIds: [...pendingRoute(phase).ancestorScopeIds] }
    },
    findCandidates: async (query) =>
      (candidates[query.requiredPosition] ?? []).map((id) => ({ id, isActive: true })),
  }

  const currentAttempt = (): FakeAdapterInstanceRow | null =>
    [...instances.values()].filter((row) => docInstanceWhere(row) && row.supersededAt === null)
      .sort((a, b) => b.attempt - a.attempt)[0] ?? null

  const persistPlan = (plan: ApprovalInstancePlan): ApprovalInstancePlan & { id: string; attempt: number } => {
    const latest = [...instances.values()].filter(docInstanceWhere).reduce((max, row) => Math.max(max, row.attempt), 0)
    const attempt = latest + 1
    instanceSeq += 1
    const id = `instance-${plan.phase.toLowerCase()}-${attempt}-${instanceSeq}`
    instances.set(id, {
      id,
      requestId: plan.phase === 'SOLUTION' ? null : requestId,
      solutionId: plan.phase === 'SOLUTION' ? solutionId : null,
      phase: plan.phase,
      routeVersionId: plan.routeVersionId ?? null,
      originUserId: plan.originUserId,
      originUnitId: plan.originUnitId,
      originContext: plan.originContext,
      routingMode: plan.routingMode,
      state: plan.state,
      attempt,
      completionReason: plan.completionReason ?? null,
      supersededAt: null,
      createdAt: new Date(),
    })
    if (plan.routingMode === 'CUSTOM_PERSON') {
      for (const step of plan.steps) {
        rowSeq += 1
        const base: FakeAdapterApprovalRow = {
          id: `row-${id}-${step.order}`,
          order: step.order,
          status: 'pending',
          approverId: null,
          requiredLevel: null,
          requiredApproverId: step.requiredApproverId ?? null,
          comments: null,
          approvedAt: null,
          isCustomChain: true,
          routingMode: 'CUSTOM_PERSON',
          integrityVersion: 1,
          instanceId: id,
          requiredPosition: null,
          candidateGroupId: null,
        }
        if (plan.phase === 'SOLUTION') {
          rows.set(base.id, { ...base, solutionId })
        } else {
          rows.set(base.id, { ...base, requestId, isFinalApproval: plan.phase === 'FINAL' })
        }
      }
      return { ...plan, attempt, id }
    }
    if (plan.state === 'AUTO_APPROVED') {
      rowSeq += 1
      const selfRow: FakeAdapterApprovalRow = {
        id: `row-${id}-self`,
        order: 1,
        status: 'approved',
        approverId: plan.originUserId,
        requiredLevel: null,
        requiredApproverId: null,
        comments: null,
        approvedAt: new Date(),
        isCustomChain: false,
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
        instanceId: id,
        requiredPosition: (plan.originContext as { position?: string }).position ?? null,
        candidateGroupId: null,
      }
      if (plan.phase === 'SOLUTION') {
        rows.set(selfRow.id, { ...selfRow, solutionId })
      } else {
        rows.set(selfRow.id, { ...selfRow, requestId, isFinalApproval: plan.phase === 'FINAL' })
      }
    }
    for (const step of plan.steps as readonly ApprovalStepPlan[]) {
      rowSeq += 1
      const base: FakeAdapterApprovalRow = {
        id: `row-${id}-${step.order}`,
        order: step.order,
        status: 'pending',
        approverId: null,
        requiredLevel: null,
        requiredApproverId: null,
        comments: null,
        approvedAt: null,
        isCustomChain: false,
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
        instanceId: id,
        requiredPosition: step.requiredPosition ?? null,
        candidateGroupId: `group-${id}-${step.order}`,
      }
      if (plan.phase === 'SOLUTION') {
        rows.set(base.id, { ...base, solutionId })
      } else {
        rows.set(base.id, { ...base, requestId, isFinalApproval: plan.phase === 'FINAL' })
      }
    }
    return { ...plan, attempt, id }
  }

  const docWhereFor = (input: { requestId: string; solutionId?: string; phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }) =>
    (row: FakeAdapterApprovalRow): boolean => {
      if (input.phase === 'SOLUTION') return row.solutionId === input.solutionId
      if (input.phase === 'FINAL') return row.requestId === input.requestId && row.isFinalApproval === true
      return row.requestId === input.requestId && row.isFinalApproval !== true
    }

  const fixture: PhaseAdapterFixtureDb = {
    ...engine,
    loadRequestContext: async (id) => {
      if (id !== requestId) throw new Error(`Fake adapter has no request context for ${id}`)
      return {
        status: docStatus as RequestStatus,
        requesterId: options.requesterId ?? 'staff-1',
        departmentId: options.departmentId === undefined ? 'department-pd' : options.departmentId,
        organizationUnitId: options.organizationUnitId === undefined ? 'section-pd1' : options.organizationUnitId,
      }
    },
    loadCurrentAttempt: async (input) => {
      const current = currentAttempt()
      if (input.phase !== phase) return null
      return current ? { id: current.id, attempt: current.attempt, state: current.state } : null
    },
    persistApprovalInstance: async (plan) => persistPlan(plan),
    supersedeApprovalInstance: async (instanceId) => {
      const row = instances.get(instanceId)
      if (!row) throw new Error(`Fake adapter has no instance ${instanceId} to supersede`)
      row.supersededAt = new Date()
    },
    updateRequestStatus: async (input) => {
      if (input.requestId !== requestId) throw new Error(`Fake adapter has no request ${input.requestId}`)
      if (input.from === input.to) return
      if (docStatus !== input.from) {
        throw new Error(`Status conflict: expected ${input.from}, current ${docStatus}`)
      }
      statusUpdates.push({ from: input.from, to: input.to })
      docStatus = input.to
    },
    ensureLegacyAttemptWrapped: async (input) => {
      if (currentAttempt()) return null
      const legacy = [...rows.values()].filter(docWhereFor(input)).filter((row) => !row.instanceId)
      if (legacy.length === 0) return null
      const rejected = legacy.some((row) => row.status === 'rejected')
      const pending = legacy.some((row) => row.status === 'pending')
      const state = rejected ? 'REJECTED' : pending ? 'PENDING' : 'APPROVED'
      const routingMode = legacy.some((row) => row.isCustomChain) ? 'CUSTOM_PERSON' : 'LEGACY_LEVEL'
      const latest = [...instances.values()].filter(docInstanceWhere).reduce((max, row) => Math.max(max, row.attempt), 0)
      const attempt = latest + 1
      instanceSeq += 1
      const id = `instance-wrapped-${phase}-${attempt}-${instanceSeq}`
      instances.set(id, {
        id,
        requestId: input.phase === 'SOLUTION' ? null : input.requestId,
        solutionId: input.phase === 'SOLUTION' ? input.solutionId ?? solutionId : null,
        phase: input.phase,
        routeVersionId: null,
        originUserId: input.fallbackOriginUserId,
        originUnitId,
        originContext: {},
        routingMode,
        state,
        attempt,
        completionReason: null,
        supersededAt: new Date(),
        createdAt: new Date(),
      })
      for (const row of legacy) {
        row.instanceId = id
      }
      return { instanceId: id, attempt, routingMode: routingMode as LegacyWrapRecord['routingMode'], state, wrappedRowCount: legacy.length }
    },
    instances: () => [...instances.values()].map((row) => ({ ...row })),
    approvalRows: () => [...rows.values()].map((row) => ({ ...row })),
    requestStatus: () => docStatus,
    statusUpdates: () => [...statusUpdates],
    priorAttemptState: (id, inputPhase) => {
      if (inputPhase !== phase) return 'PENDING'
      const prior = [...instances.values()].filter(docInstanceWhere).sort((a, b) => a.attempt - b.attempt)[0]
      if (!prior) return 'PENDING'
      return prior.supersededAt !== null ? 'SUPERSEDED' : 'PENDING'
    },
    priorAttemptRowsRemain: (id) => {
      const prior = [...instances.values()].filter(docInstanceWhere).sort((a, b) => a.attempt - b.attempt)[0]
      if (!prior) return false
      return [...rows.values()].some((row) => row.instanceId === prior.id)
    },
  }
  return fixture
}

/** Brief contract: an AUTO_APPROVED plan for the phase initiator. */
export function createPhaseAdapterDb(input: { phase: 'REQUEST' | 'SOLUTION' | 'FINAL' }): PhaseAdapterDb {
  return createPhaseAdapterFixture({ phase: input.phase, planOutcome: 'AUTO_APPROVED' })
}

/** Brief contract: a rejected attempt-1 REQUEST instance awaiting resubmission. */
export function createPhaseAdapterDbWithRejectedAttempt(requestId: string): PhaseAdapterFixtureDb & {
  priorAttemptState(requestId: string, phase: 'REQUEST' | 'SOLUTION' | 'FINAL'): 'SUPERSEDED' | 'PENDING'
  priorAttemptRowsRemain(requestId: string): boolean
} {
  return createPhaseAdapterFixture({
    phase: 'REQUEST',
    requestId,
    planOutcome: 'AUTO_APPROVED',
    priorAttempt: {
      attempt: 1,
      state: 'REJECTED',
      rows: [
        {
          id: 'row-prior-1',
          requestId,
          isFinalApproval: false,
          order: 1,
          status: 'rejected',
          approverId: 'supervisor-1',
          requiredLevel: 2,
          requiredApproverId: null,
          comments: 'Not ready',
          approvedAt: new Date('2026-01-05T00:00:00Z'),
          isCustomChain: false,
          routingMode: 'LEGACY_LEVEL',
          integrityVersion: 0,
        },
      ],
    },
  })
}

export function createFakeApprovalEngineDb(
  input: FakeApprovalEngineDbInput,
): ApprovalEngineDb & { replaceCandidates(position: OrganizationPositionCode, ids: string[]): void } {
  if (input.route.ancestorScopeIds.length === 0 || input.route.ancestorScopeIds[0] !== input.origin.unitId) {
    throw new Error(`Fake route ancestorScopeIds must start at the origin unit ${input.origin.unitId}`)
  }
  const candidateMap = new Map<OrganizationPositionCode, string[]>(
    (Object.entries(input.candidates) as Array<[OrganizationPositionCode, string[]]>).map(([position, ids]) => [
      position,
      [...ids],
    ]),
  )
  const branch: ReportingBranch = {
    originUserId: input.origin.userId,
    primaryUnitId: input.origin.unitId,
    primaryAssignmentId: `assignment-${input.origin.userId}`,
    primaryPosition: input.origin.position,
    unitPath: [...input.route.ancestorScopeIds],
    groupPath: GROUP_PATH_POSITIONS.includes(input.origin.position) ? [`${input.origin.unitId}-group-a`] : [],
  }
  const db: ApprovalEngineDb = {
    resolvePhaseOrigin: async (query) => {
      if (query.originUserId && query.originUserId !== input.origin.userId) {
        throw new Error('Fake engine origin user does not match the requested actor')
      }
      const phaseOrigin: PhaseOrigin = {
        phase: query.phase,
        originUserId: input.origin.userId,
        originUnitId: input.origin.unitId,
        branch,
        originalRequestId: query.requestId,
        requestDepartmentId: null,
        source: PHASE_ORIGIN_SOURCES[query.phase],
      }
      return phaseOrigin
    },
    resolvePublishedRoute: async () => ({
      ...input.route,
      steps: input.route.steps.map((step) => ({ ...step })),
      ancestorScopeIds: [...input.route.ancestorScopeIds],
    }),
    findCandidates: async (query) =>
      (candidateMap.get(query.requiredPosition) ?? []).map((id) => ({ id, isActive: true })),
  }
  return {
    ...db,
    replaceCandidates: (position, ids) => {
      candidateMap.set(position, [...ids])
    },
  }
}
