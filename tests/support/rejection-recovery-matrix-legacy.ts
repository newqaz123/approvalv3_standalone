/**
 * Rejection/Recovery Matrix — PURE inventory, execution plans and ledger policy.
 * Test-only: no product imports, no I/O, no Playwright.
 *
 * Chain derivation source of truth: createBusinessWorkflowFixture() from
 * tests/support/business-workflow-fixture.ts (the NATIVE four-rank fixture:
 * R3 all profiles; S3 default / S2 solution-exception; F2 default / F1
 * final-exception). Deliberately unlike the six-rank corrected demo, which is
 * never touched. Rank SOLUTION steps run on the ENGINEERING origin path
 * (Supervisor E / Section manager E / Department manager); the shared
 * Department manager is the same actor in every phase.
 */
import { createHash } from 'node:crypto'
import { createBusinessWorkflowFixture } from './business-workflow-fixture'
import { buildBusinessSeedPlan, type BusinessSeedPlan } from './native/seed-business-fixture-plan'

export type RouteProfile =
  | 'all-defaults'
  | 'solution-exception'
  | 'final-exception'
  | 'solution-and-final-exceptions'

export type Phase = 'REQUEST' | 'SOLUTION' | 'FINAL'
export type ChainKind = 'rank' | 'custom'

export const FIXTURE_ACTORS = {
  requesterA: 'user-requester-a',
  staffB: 'user-staff-b',
  supervisorP: 'user-supervisor-p',
  sectionManagerP: 'user-section-manager-p',
  departmentManager: 'user-department-manager',
  engineerA: 'user-engineer-a',
  supervisorE: 'user-supervisor-e',
  sectionManagerE: 'user-section-manager-e',
} as const

/** Permitted revisers: REQUEST -> original requester; SOLUTION/FINAL -> the
 *  Engineering submitter (FINAL rejection returns to Engineering). */
export function reviserFor(phase: Phase): string {
  return phase === 'REQUEST' ? FIXTURE_ACTORS.requesterA : FIXTURE_ACTORS.engineerA
}

const MATRIX_ACTOR_NAMESPACE = Buffer.from('6f1e2d3c4b5a5968a7b6c5d4e3f20110', 'hex')

/** Deterministic UUID v5 for an isolated matrix actor. Fixture ids stay the email identity. */
export function matrixActorId(fixtureActorId: string): string {
  const hash = createHash('sha1').update(MATRIX_ACTOR_NAMESPACE).update(`matrix-actor:${fixtureActorId}`).digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function matrixActorEmail(fixtureActorId: string): string {
  return `${fixtureActorId}@business.test`
}

const MATRIX_ACTOR_REVERSE = new Map(
  Object.values(createBusinessWorkflowFixture().actors).map((actor) => [matrixActorId(actor.id), actor.id]),
)

export function fixtureActorIdFromMatrix(matrixId: string): string {
  const fixtureId = MATRIX_ACTOR_REVERSE.get(matrixId)
  if (!fixtureId) throw new Error(`matrix actor id ${matrixId} is not in the isolated bijection`)
  return fixtureId
}

function mapActor(actorId: string): string {
  if (MATRIX_ACTOR_REVERSE.has(actorId)) return actorId
  return matrixActorId(actorId)
}

export const PROFILE_ORDER: readonly RouteProfile[] = [
  'all-defaults',
  'solution-exception',
  'final-exception',
  'solution-and-final-exceptions',
]

/** REQUEST CUSTOM_PERSON has NO exposed creation UI (submitter-modal.tsx renders
 *  the Custom Approval Hierarchy toggle only for solution/resubmit modes) — an
 *  explicit unsupported gap, never passed, never API-injected. */
export const REQUEST_CUSTOM_UI_SUPPORTED = false as const

/** Two-person UI custom chains (select SECOND first, then FIRST, move FIRST up). */
export const CUSTOM_CHAINS: Record<'SOLUTION' | 'FINAL', readonly [string, string]> = {
  SOLUTION: [FIXTURE_ACTORS.supervisorE, FIXTURE_ACTORS.departmentManager],
  FINAL: [FIXTURE_ACTORS.supervisorP, FIXTURE_ACTORS.departmentManager],
}

// ---------------------------------------------------------------------------
// Rank chains derived from the ACTUAL fixture (position -> unit actor).
// ---------------------------------------------------------------------------

const fixture = createBusinessWorkflowFixture()

/**
 * Rank-chain resolution rules (documented, evidence-backed):
 *  - EXCEPTION-scope routes resolve by exact position within the exception
 *    unit (unique active fixture holders).
 *  - COMPANY-scope routes resolve through the phase ORIGIN reporting path:
 *    REQUEST/FINAL use the requester path (team step = Section manager P;
 *    UNIT_MANAGER Production 1 = Department manager), SOLUTION uses the
 *    Engineering submitter path (team step = Section manager E; same
 *    Department manager). The company supervisor position has NO path step;
 *    its primary candidate is the origin-unit Supervisor (T14-verified:
 *    Supervisor P for REQUEST/FINAL origins, Supervisor E for SOLUTION), with
 *    the documented co-candidate (Second eligible approver, same
 *    unit/position for the Production origin; none for Engineering) to be
 *    confirmed against the live route/candidates at case start.
 */
function primaryCompanyOriginActor(phase: Phase, positionId: string): { primary: string; coCandidates: string[] } {
  const inUnit = (unitId: string) =>
    Object.values(fixture.actors).filter(
      (actor) => actor.isActive && actor.assignment !== null &&
        actor.assignment.unitId === unitId && actor.assignment.positionId === positionId,
    ).map((actor) => actor.id)
  if (positionId === fixture.positions.find((p) => p.id === 'position-department-manager')!.id) {
    return { primary: FIXTURE_ACTORS.departmentManager, coCandidates: [] }
  }
  const originUnit = phase === 'SOLUTION' ? 'unit-engineering-section' : 'unit-production-1-section'
  const candidates = inUnit(originUnit)
  const expectedPrimary = phase === 'SOLUTION'
    ? (positionId === 'position-supervisor' ? FIXTURE_ACTORS.supervisorE : FIXTURE_ACTORS.sectionManagerE)
    : (positionId === 'position-supervisor' ? FIXTURE_ACTORS.supervisorP : FIXTURE_ACTORS.sectionManagerP)
  const coCandidates = candidates.filter((c) => c !== expectedPrimary)
  return { primary: expectedPrimary, coCandidates }
}

function chainForRoute(profile: RouteProfile, phase: Phase): string[] {
  const config = fixture.routeConfigurations[profile]
  const source = config.expectedSources[phase]
  const exceptionUnit = phase === 'SOLUTION' ? 'unit-engineering-section' : 'unit-production-1-section'
  const route = source === 'UNIT_EXCEPTION'
    ? config.routes.find((candidate) => candidate.phase === phase && candidate.scopeUnitId === exceptionUnit)!
    : config.routes.find((candidate) => candidate.phase === phase)!
  if (!route) throw new Error(`no published route for ${profile}/${phase}`)
  // Phase-dependent in-scope unit: SOLUTION steps resolve on the ENGINEERING
  // origin section; REQUEST/FINAL steps on the Production 1 Section chain.
  const effectiveUnit = phase === 'SOLUTION'
    ? 'unit-engineering-section'
    : source === 'UNIT_EXCEPTION' && phase === 'FINAL'
      ? 'unit-production-1-section'
      : 'unit-production-1-section'
  return route.steps.map((step) => {
    const originName = phase === 'SOLUTION' ? 'engineerA' : 'requesterA'
    const inScope = Object.values(fixture.actors).filter(
      (actor) => actor.isActive && actor.assignment !== null &&
        actor.assignment.unitId === effectiveUnit &&
        actor.assignment.positionId === step.positionId,
    )
    if (inScope.length > 1) {
      // Multiple same-unit/same-position active holders: the ORIGIN TEAM'S
      // reports-to holder is the documented primary (T14 parity); the others
      // are recorded co-candidates confirmed against the live route.
      const teamReportsToPrimary: Record<string, string> = {
        'unit-production-1-section': FIXTURE_ACTORS.supervisorP,
        'unit-engineering-section': FIXTURE_ACTORS.supervisorE,
      }
      const primary = inScope.find(
        (candidate) => (candidate as { id?: string }).id === teamReportsToPrimary[effectiveUnit],
      )
      if (primary === undefined) {
        throw new Error(`no team-reports-to primary among ${(inScope as Array<{ id?: string }>).map((c) => c.id).join(',')}`)
      }
      return (primary as { id: string }).id
    }
    if (inScope.length === 1) {
      if (phase === 'SOLUTION' && inScope[0].id === FIXTURE_ACTORS.requesterA) {
        throw new Error('SOLUTION chain must run on the Engineering origin path')
      }
      return inScope[0].id
    }
    // Resolve through the phase ORIGIN reporting path (positions with no
    // unique in-scope holder, e.g. the Department manager on the Production 1
    // manager step shared by both sections).
    const originStep = (fixture.paths[originName as keyof typeof fixture.paths] as { steps: ReadonlyArray<{ positionId: string; userId: string }> }).steps.find(
      (originStepEntry) => originStepEntry.positionId === step.positionId,
    )
    if (!originStep) throw new Error(`cannot resolve ${phase} step position ${step.positionId} for ${profile}`)
    return originStep.userId
  })
}

export const RANK_CHAINS: Record<RouteProfile, Record<Phase, readonly string[]>> = Object.fromEntries(
  PROFILE_ORDER.map((profile) => [
    profile,
    Object.fromEntries(
      (["REQUEST", "SOLUTION", "FINAL"] as const).map((phase) => [phase, chainForRoute(profile, phase)]),
    ),
  ]),
) as unknown as Record<RouteProfile, Record<Phase, readonly string[]>>

/** Co-candidates that must be confirmed against the live route at case start. */
export const COMPANY_SCOPE_CO_CANDIDATES = {
  supervisorPosition: ['user-supervisor-p', 'user-second-approver'],
} as const

// ---------------------------------------------------------------------------
// Inventory rows + execution plans.
// ---------------------------------------------------------------------------

export interface MatrixRow {
  id: string
  profile: RouteProfile
  phase: Phase
  chainKind: ChainKind
  rejectOrder: number
  orderedActorIds: readonly string[]
  precedingApprovals: number
  reviser: string
  reason: string
}

/** Full primary inventory: rank chains (28) + custom S/F (16) = 44. */
export function buildInventory(): readonly MatrixRow[] {
  const rows: MatrixRow[] = []
  let seq = 0
  for (const profile of PROFILE_ORDER) {
    for (const phase of ['REQUEST', 'SOLUTION', 'FINAL'] as const) {
      const chain = RANK_CHAINS[profile][phase]
      for (let i = 0; i < chain.length; i++) {
        seq += 1
        rows.push({
          id: `RRM-${String(seq).padStart(3, '0')}`,
          profile,
          phase,
          chainKind: 'rank',
          rejectOrder: i + 1,
          orderedActorIds: chain.map(mapActor),
          precedingApprovals: i,
          reviser: mapActor(reviserFor(phase)),
          reason: `Rejection matrix ${profile} ${phase} rank position ${i + 1}`,
        })
      }
    }
    for (const phase of ['SOLUTION', 'FINAL'] as const) {
      const chain = CUSTOM_CHAINS[phase as 'SOLUTION' | 'FINAL']
      for (let i = 0; i < chain.length; i++) {
        seq += 1
        rows.push({
          id: `RRM-${String(seq).padStart(3, '0')}`,
          profile,
          phase,
          chainKind: 'custom',
          rejectOrder: i + 1,
          orderedActorIds: chain.map(mapActor),
          precedingApprovals: i,
          reviser: mapActor(reviserFor(phase)),
          reason: `Rejection matrix ${profile} ${phase} custom position ${i + 1}`,
        })
      }
    }
  }
  return rows
}

export interface NegativeCheck {
  id: string
  kind: 'blank-reason' | 'unauthorized-viewer' | 'stale-reject'
  attachedTo: string
  expectedPredicate: string
}

export function buildStaleNegativeChecks(rows: readonly MatrixRow[]): readonly NegativeCheck[] {
  return rows
    .filter((row) => row.phase === 'FINAL')
    .map((row) => ({
      id: `${row.id}-stale`,
      kind: 'stale-reject' as const,
      attachedTo: row.id,
      expectedPredicate:
        'A SECOND current-actor Reject/Confirm dialog is held open (never submitted) while the target step is legitimately pending; a separate context rejects once, resubmits and reapproves through Completed; the held dialog then issues exactly one Confirm Rejection which MUST be denied (no success toast) with terminal/instance/audit state unchanged. Requires proving Completed/current-pending-0 FIRST. If the held dialog auto-invalidates, disposition = stale-window-unavailable (not a passed denial).',
    }))
}

// ---------------------------------------------------------------------------
// Phase-aware execution plans (every case covers REQUEST -> SOLUTION -> FINAL).
// ---------------------------------------------------------------------------

export type PlanStep =
  | { kind: 'create-request'; actor: string }
  | { kind: 'submit-solution'; actor: string; custom: boolean }
  | { kind: 'approve'; phase: Phase; stepOrder: number; actor: string; attempt: number }
  | { kind: 'reject'; phase: Phase; stepOrder: number; actor: string }
  | { kind: 'resubmit'; phase: 'REQUEST' | 'SOLUTION'; actor: string; custom: boolean }
  | { kind: 'initiate-final'; actor: string; custom: boolean }
  | { kind: 'verify-completed' }

/** The attempt epoch increments on every resubmission (new approval attempt).
 *  Sequencing rules (reviewed):
 *  - Pre-rejection: approve ONLY the steps preceding the target (never an
 *    already-approved target); SOLUTION/FINAL targets require the complete
 *    preceding workflow (R chain, S submission + approvals, and for FINAL the
 *    F initiation + preceding F approvals).
 *  - Recovery: EXACTLY ONE resubmission of the rejected phase's revisable
 *    artifact (REQUEST -> resubmit request; SOLUTION/FINAL -> Engineering
 *    revise/resubmit solution), then the FULL chain approvals for that
 *    attempt, then the remaining phases to Completed. FINAL recovery never
 *    bypasses Engineering with a restart. No duplicate submissions. */
export function buildCasePlan(row: MatrixRow): readonly PlanStep[] {
  const plan: PlanStep[] = []
  const requestChain = RANK_CHAINS[row.profile].REQUEST
  const solutionChain = RANK_CHAINS[row.profile].SOLUTION
  const finalChain = RANK_CHAINS[row.profile].FINAL
  const solutionCustom = row.phase === 'SOLUTION' && row.chainKind === 'custom'
  const finalCustom = row.phase === 'FINAL' && row.chainKind === 'custom'
  const activeFinalChain = finalCustom ? CUSTOM_CHAINS.FINAL : finalChain

  plan.push({ kind: 'create-request', actor: FIXTURE_ACTORS.requesterA })
  // REQUEST attempt 1: approve ONLY preceding steps (target stays pending).
  const requestPreceding = row.phase === 'REQUEST' ? row.precedingApprovals : requestChain.length
  for (let i = 0; i < requestPreceding; i++) {
    plan.push({ kind: 'approve', phase: 'REQUEST', stepOrder: i + 1, actor: requestChain[i], attempt: 1 })
  }
  if (row.phase !== 'REQUEST') {
    plan.push({ kind: 'submit-solution', actor: FIXTURE_ACTORS.engineerA, custom: solutionCustom })
    const chain = solutionCustom ? CUSTOM_CHAINS.SOLUTION : solutionChain
    const solutionPreceding = row.phase === 'SOLUTION' ? row.precedingApprovals : chain.length
    for (let i = 0; i < solutionPreceding; i++) {
      plan.push({ kind: 'approve', phase: 'SOLUTION', stepOrder: i + 1, actor: chain[i], attempt: 1 })
    }
    if (row.phase === 'FINAL') {
      plan.push({ kind: 'initiate-final', actor: FIXTURE_ACTORS.requesterA, custom: finalCustom })
      for (let i = 0; i < row.precedingApprovals; i++) {
        plan.push({ kind: 'approve', phase: 'FINAL', stepOrder: i + 1, actor: activeFinalChain[i], attempt: 1 })
      }
    }
  }
  // The target rejection.
  plan.push({ kind: 'reject', phase: row.phase, stepOrder: row.rejectOrder, actor: row.orderedActorIds[row.rejectOrder - 1] })

  // Recovery to Completed.
  if (row.phase === 'REQUEST') {
    plan.push({ kind: 'resubmit', phase: 'REQUEST', actor: FIXTURE_ACTORS.requesterA, custom: false })
    for (let i = 0; i < requestChain.length; i++) {
      plan.push({ kind: 'approve', phase: 'REQUEST', stepOrder: i + 1, actor: requestChain[i], attempt: 2 })
    }
    plan.push({ kind: 'submit-solution', actor: FIXTURE_ACTORS.engineerA, custom: false })
    for (let i = 0; i < solutionChain.length; i++) {
      plan.push({ kind: 'approve', phase: 'SOLUTION', stepOrder: i + 1, actor: solutionChain[i], attempt: 1 })
    }
    plan.push({ kind: 'initiate-final', actor: FIXTURE_ACTORS.requesterA, custom: false })
    for (let i = 0; i < finalChain.length; i++) {
      plan.push({ kind: 'approve', phase: 'FINAL', stepOrder: i + 1, actor: finalChain[i], attempt: 1 })
    }
  } else if (row.phase === 'SOLUTION') {
    plan.push({ kind: 'resubmit', phase: 'SOLUTION', actor: FIXTURE_ACTORS.engineerA, custom: solutionCustom })
    const chain = solutionCustom ? CUSTOM_CHAINS.SOLUTION : solutionChain
    for (let i = 0; i < chain.length; i++) {
      plan.push({ kind: 'approve', phase: 'SOLUTION', stepOrder: i + 1, actor: chain[i], attempt: 2 })
    }
    plan.push({ kind: 'initiate-final', actor: FIXTURE_ACTORS.requesterA, custom: false })
    for (let i = 0; i < finalChain.length; i++) {
      plan.push({ kind: 'approve', phase: 'FINAL', stepOrder: i + 1, actor: finalChain[i], attempt: 1 })
    }
  } else {
    plan.push({ kind: 'resubmit', phase: 'SOLUTION', actor: FIXTURE_ACTORS.engineerA, custom: false })
    for (let i = 0; i < solutionChain.length; i++) {
      plan.push({ kind: 'approve', phase: 'SOLUTION', stepOrder: i + 1, actor: solutionChain[i], attempt: 2 })
    }
    plan.push({ kind: 'initiate-final', actor: FIXTURE_ACTORS.requesterA, custom: finalCustom })
    for (let i = 0; i < activeFinalChain.length; i++) {
      plan.push({ kind: 'approve', phase: 'FINAL', stepOrder: i + 1, actor: activeFinalChain[i], attempt: 2 })
    }
  }
  plan.push({ kind: 'verify-completed' })
  return plan.map((step) => ('actor' in step ? { ...step, actor: mapActor(step.actor) } : step))
}

/** Expected persisted status ENUM after a rejection (verify via scoped DB, not
 *  as dialog text; the UI display label is verified separately). */
export function expectedPostRejectStatus(phase: Phase): 'ImprovementRequest' | 'SentToEngineer' {
  if (phase === 'REQUEST') return 'ImprovementRequest'
  // Product writes SentToEngineer after a SOLUTION rejection (solutions.ts).
  return 'SentToEngineer'
}

/** The approvals table a rejection lives in, per phase. */
export function rejectionTable(phase: Phase): 'request_approvals' | 'solution_approvals' {
  return phase === 'SOLUTION' ? 'solution_approvals' : 'request_approvals'
}

// ---------------------------------------------------------------------------
// Ledger: keys include PHASE + ATTEMPT + STEP so legitimate repeated actors
// (same actor across phases/attempts) never conflict; the SAME step/attempt
// can never be actioned twice. Entries are journaled by the driver (durable
// write BEFORE the click; fresh scoped evidence BEFORE confirm).
// ---------------------------------------------------------------------------

export type LedgerStage = 'attempting' | 'confirmed' | 'denied'

export type LedgerAction =
  | 'submit-request'
  | 'submit-solution'
  | 'approve-step'
  | 'confirm-rejection'
  | 'resubmit'
  | 'initiate-final'
  | 'stale-confirm-rejection'

export interface LedgerEntry {
  caseId: string
  action: LedgerAction
  phase?: Phase
  attempt?: number
  stepOrder?: number
  actor: string
  instanceId?: string
  rowId?: string
  expectedChainIds?: readonly string[]
  stage: LedgerStage
  attemptedAt: string
  confirmedAt?: string
  persistedEvidence?: string
}

export interface LedgerKey {
  caseId: string
  action: LedgerAction
  phase?: Phase
  attempt?: number
  stepOrder?: number
  actor: string
  /** Active approval_instances id captured BEFORE the click. */
  instanceId?: string
  /** Approval/rejection row id once known; never a substitute for requestId. */
  rowId?: string
  /** Intended custom chain, in selected order. Not part of the conflict key. */
  expectedChainIds?: readonly string[]
}

export class LedgerPolicyError extends Error {}

export class MatrixLedger {
  private readonly entries: LedgerEntry[] = []

  get all(): readonly LedgerEntry[] {
    return this.entries
  }

  private static sameKey(a: LedgerEntry, k: LedgerKey): boolean {
    return a.caseId === k.caseId && a.action === k.action && a.phase === k.phase &&
      a.attempt === k.attempt && a.stepOrder === k.stepOrder && a.actor === k.actor &&
      a.instanceId === k.instanceId
  }

  /** Durable-attempt BEGIN. An unresolved attempting entry blocks EVERY later
   *  mutation, not only the same key. The same step/attempt/instance can never
   *  be actioned twice. Different phases, attempts, or instances do not conflict
   *  once the earlier entry is confirmed or denied. */
  begin(key: LedgerKey): LedgerEntry {
    const open = this.entries.find((e) => e.stage === 'attempting')
    if (open) {
      if (MatrixLedger.sameKey(open, key)) {
        throw new LedgerPolicyError(
          `AMBIGUOUS ATTEMPTING: ${key.caseId}/${key.action}/${key.phase}/attempt${key.attempt}/step${key.stepOrder} is already attempting; resolve before retry`,
        )
      }
      throw new LedgerPolicyError(
        `unresolved attempting entry blocks every later mutation: ${open.caseId}/${open.action}/${open.phase}/attempt${open.attempt}/step${open.stepOrder}`,
      )
    }
    const existing = this.entries.find((e) => MatrixLedger.sameKey(e, key))
    if (existing) {
      throw new LedgerPolicyError(
        `EXACTLY-ONCE violation: ${key.caseId}/${key.action} already ${existing.stage} for this step/attempt`,
      )
    }
    const record: LedgerEntry = { ...key, stage: 'attempting', attemptedAt: new Date().toISOString() }
    this.entries.push(record)
    return record
  }

  /** Open (unresolved) attempting entry for a key, if any. */
  openFor(key: LedgerKey): LedgerEntry | undefined {
    return this.entries.find((e) => MatrixLedger.sameKey(e, key) && e.stage === 'attempting')
  }

  confirm(record: LedgerEntry, persistedEvidence: string): void {
    if (record.stage !== 'attempting') throw new LedgerPolicyError(`cannot confirm a ${record.stage} entry`)
    if (!persistedEvidence.trim()) throw new LedgerPolicyError('confirmation requires fresh persisted evidence')
    record.stage = 'confirmed'
    record.confirmedAt = new Date().toISOString()
    record.persistedEvidence = persistedEvidence
  }

  deny(record: LedgerEntry, evidence?: string): void {
    if (record.stage !== 'attempting') throw new LedgerPolicyError('cannot deny a non-attempting entry')
    if (evidence !== undefined && !evidence.trim()) throw new LedgerPolicyError('denial requires the observed outcome evidence')
    record.stage = 'denied'
    if (evidence !== undefined) record.persistedEvidence = evidence
  }

  /** Refuses a denied record that was never begun. Stale denials must begin
   *  before the single click; there is no bypass that inserts a denied row. */
  recordDeniedStaleConfirm(key: LedgerKey & { action: 'stale-confirm-rejection' }, evidence: string): LedgerEntry {
    const open = this.openFor(key)
    if (!open) throw new LedgerPolicyError('no fake denied record without preattempt')
    this.deny(open, evidence)
    return open
  }

  assertNoUnresolvedAttempting(): void {
    const open = this.entries.find((e) => e.stage === 'attempting')
    if (open) throw new LedgerPolicyError(`unresolved attempting entry blocks the matrix: ${open.caseId}/${open.action}`)
  }
}

export function validateRejectReason(caseId: string, reason: string, used: ReadonlySet<string>): void {
  if (!reason.trim()) throw new LedgerPolicyError(`${caseId}: reject reason must be nonempty`)
  if (used.has(reason)) throw new LedgerPolicyError(`${caseId}: reject reason must be unique across the matrix`)
}

export function assertSupportedCombination(profile: RouteProfile, phase: Phase, chainKind: ChainKind): void {
  if (phase === 'REQUEST' && chainKind === 'custom') {
    throw new LedgerPolicyError('REQUEST CUSTOM_PERSON has no exposed creation UI (unsupported gap, never passed)')
  }
  void profile
}


// ---------------------------------------------------------------------------
// State-machine validation: validates a case plan as a strict state machine
// (reject ONLY the current pending position; exactly one submission/revision
// per attempt; submission/initiation attempt-keyed; controls/recovery in the
// reviewed order). Used by regressions across ALL 44 cases.
// ---------------------------------------------------------------------------

export function validateCasePlan(row: MatrixRow, plan: readonly PlanStep[]): void {
  const fail = (reason: string): never => { throw new Error(`${row.id}: ${reason}`) }
  const solutionCustom = row.phase === 'SOLUTION' && row.chainKind === 'custom'
  const finalCustom = row.phase === 'FINAL' && row.chainKind === 'custom'
  if (plan.length === 0) fail("empty plan")
  if (plan[0].kind !== "create-request") fail("plan must start with create-request")
  if (plan[plan.length - 1].kind !== "verify-completed") fail("plan must end with verify-completed")

  const requestApproved: Record<number, number> = { 1: 0, 2: 0 }
  const solutionApproved: Record<number, number> = { 1: 0, 2: 0 }
  const finalApproved: Record<number, number> = { 1: 0, 2: 0 }
  const solutionSubmits: number[] = []
  const finalInitiations: Array<{ attempt: number; custom: boolean }> = []
  const resubmits: Array<{ phase: string; attempt: number }> = []
  let rejects = 0
  let resubmitAfterReject = false
  let verifySeen = false

  const requestChain = RANK_CHAINS[row.profile].REQUEST.map(mapActor)
  const solutionChain = (row.phase === 'SOLUTION' && row.chainKind === 'custom'
    ? CUSTOM_CHAINS.SOLUTION
    : RANK_CHAINS[row.profile].SOLUTION).map(mapActor)
  const finalChain = (row.phase === 'FINAL' && row.chainKind === 'custom'
    ? CUSTOM_CHAINS.FINAL
    : RANK_CHAINS[row.profile].FINAL).map(mapActor)

  for (let index = 0; index < plan.length; index++) {
    const step = plan[index]
    if (verifySeen) fail(`step ${index} after verify-completed`)
    if (step.kind === 'create-request') {
      if (index !== 0) fail("duplicate create-request")
      continue
    }
    if (step.kind === 'verify-completed') {
      if (rejects !== 1) fail("verify-completed before exactly one rejection")
      if (resubmits.length !== 1) fail("verify-completed before exactly one resubmission")
      // Each phase must be COMPLETE in its LATEST attempt (the rejected
      // phase's chain legitimately restarts, so cross-attempt totals overcount).
      const latestComplete = (map: Record<number, number>, length: number): boolean => {
        const latest = Math.max(...Object.keys(map).map(Number).filter((attempt) => map[attempt] > 0), 0)
        return latest > 0 && map[latest] === length
      }
      if (!latestComplete(requestApproved, requestChain.length)) fail(`verify-completed with incomplete latest REQUEST attempt (${JSON.stringify(requestApproved)})`)
      if (!latestComplete(solutionApproved, solutionChain.length)) fail(`verify-completed with incomplete latest SOLUTION attempt (${JSON.stringify(solutionApproved)})`)
      if (!latestComplete(finalApproved, finalChain.length)) fail(`verify-completed with incomplete latest FINAL attempt (${JSON.stringify(finalApproved)})`)
      verifySeen = true
      continue
    }
    if (step.kind === 'submit-solution') {
      // Exactly ONE submission per SOLUTION attempt epoch: attempt 1 BEFORE the
      // rejection, attempt 2 only via the resubmission (which carries the
      // revision itself — never a second submit step).
      if (row.phase === 'SOLUTION' && step.custom !== solutionCustom) {
        fail(`submit-solution custom=${step.custom} contradicts the row's original SOLUTION kind`)
      }
      if (row.phase !== 'REQUEST' && step.custom !== (row.phase === 'SOLUTION' && row.chainKind === 'custom')) {
        fail(`pre-rejection SOLUTION submission custom flag wrong for ${row.phase}`)
      }
      const afterResubmit = resubmits.length > 0 && requestApproved[2] === requestChain.length
      if (solutionSubmits.length >= 1) {
        if (row.phase === 'REQUEST' && afterResubmit) {
          // Legitimate FIRST solution submission of the recovery (the REQUEST
          // rejection happened before any solution existed).
        } else {
          fail(`duplicate submit-solution (submission ${solutionSubmits.length + 1}) — recovery resubmission must NOT be a second submit`)
        }
      }
      if (rejects > 0 && row.phase !== 'REQUEST') fail(`submit-solution after the rejection (recovery must use resubmit)`)
      if (row.phase === 'REQUEST' && rejects === 0) fail(`REQUEST-row solution submission before the REQUEST rejection`)
      solutionSubmits.push(index)
      continue
    }
    if (step.kind === 'initiate-final') {
      if (row.phase !== 'FINAL') {
        if (finalInitiations.length !== 0) fail(`unexpected FINAL initiation count ${finalInitiations.length + 1} for a ${row.phase} case`)
        const solutionAttempt = row.phase === 'SOLUTION' ? 2 : 1
        if (solutionApproved[solutionAttempt] !== solutionChain.length) fail(`FINAL initiation before SOLUTION completion (${solutionApproved[solutionAttempt]}/${solutionChain.length})`)
        if (step.custom !== false) fail("REQUEST/SOLUTION-case FINAL initiation must be profile rank")
        finalInitiations.push({ attempt: 1, custom: step.custom })
        continue
      }
      // FINAL case: initiation attempt 1 before the rejection (after S chain),
      // initiation attempt 2 in recovery; custom flag must match the row kind.
      if (step.custom !== finalCustom) fail(`FINAL initiation custom=${step.custom} contradicts the row kind`)
      const attempt = finalInitiations.length === 0 ? 1 : 2
      if (attempt === 1) {
        if (solutionApproved[1] !== solutionChain.length) fail("FINAL initiation attempt 1 before the S chain completed")
        if (rejects > 0) fail("FINAL initiation attempt 1 after the rejection")
      } else {
        if (rejects !== 1) fail("FINAL initiation attempt 2 without the rejection")
        if (!resubmitAfterReject) fail("FINAL initiation attempt 2 before the resubmission")
        if (solutionApproved[2] !== solutionChain.length) fail(`FINAL initiation attempt 2 before the revised S chain completed (${solutionApproved[2]}/${solutionChain.length})`)
      }
      finalInitiations.push({ attempt, custom: step.custom })
      continue
    }
    if (step.kind === 'resubmit') {
      if (rejects !== 1) fail("resubmit before the rejection")
      if (resubmits.length !== 0) fail("duplicate resubmission")
      if (step.phase !== (row.phase === 'REQUEST' ? 'REQUEST' : 'SOLUTION')) fail(`resubmit phase ${step.phase} wrong for a ${row.phase} rejection`)
      if (step.custom !== (row.phase === 'SOLUTION' && row.chainKind === 'custom')) fail(`resubmit custom=${step.custom} contradicts the original SOLUTION kind`)
      resubmits.push({ phase: step.phase, attempt: 2 })
      resubmitAfterReject = true
      continue
    }
    if (step.kind === 'reject') {
      rejects += 1
      if (rejects > 1) fail("duplicate rejection")
      if (step.phase !== row.phase) fail(`rejection phase ${step.phase} wrong`)
      if (step.stepOrder !== row.rejectOrder) fail(`rejection position ${step.stepOrder} wrong`)
      if (step.actor !== row.orderedActorIds[row.rejectOrder - 1]) fail("rejection actor wrong")
      // Target must be the CURRENT pending position of its attempt.
      if (row.phase === 'REQUEST') {
        if (requestApproved[1] !== row.precedingApprovals) fail(`REQUEST target not current: ${requestApproved[1]} approved before pos ${row.rejectOrder}`)
      } else if (row.phase === 'SOLUTION') {
        if (solutionSubmits.length !== 1) fail("SOLUTION rejection without a solution submission")
        if (solutionApproved[1] !== row.precedingApprovals) fail(`SOLUTION target not current: ${solutionApproved[1]} approved before pos ${row.rejectOrder}`)
      } else {
        if (finalInitiations.length !== 1 || finalInitiations[0].attempt !== 1) fail("FINAL rejection without attempt-1 initiation")
        if (finalApproved[1] !== row.precedingApprovals) fail(`FINAL target not current: ${finalApproved[1]} approved before pos ${row.rejectOrder}`)
      }
      continue
    }
    if (step.kind === 'approve') {
      if (step.phase === 'FINAL') {
        if (step.attempt !== finalInitiations.length) {
          fail(`FINAL approval attempt ${step.attempt} != initiation count ${finalInitiations.length}`)
        }
      } else if (step.phase === 'SOLUTION') {
        const expectedAttempt = resubmits.some((item) => item.phase === 'SOLUTION') ? 2 : 1
        if (step.attempt !== expectedAttempt) {
          fail(`SOLUTION approval attempt ${step.attempt} != phase-local ${expectedAttempt}`)
        }
      } else if (rejects > 0 && step.attempt !== 2) {
        fail(`post-rejection approval with attempt ${step.attempt}`)
      } else if (rejects === 0 && step.attempt !== 1) {
        fail(`pre-rejection approval with attempt ${step.attempt}`)
      }
      const approvedMap = step.phase === 'REQUEST' ? requestApproved : step.phase === 'SOLUTION' ? solutionApproved : finalApproved
      const chainLength = step.phase === 'REQUEST' ? requestChain.length : step.phase === 'SOLUTION' ? solutionChain.length : finalChain.length
      if (step.stepOrder !== approvedMap[step.attempt] + 1) {
        fail(`${step.phase} attempt ${step.attempt} approval out of order: pos ${step.stepOrder} but ${approvedMap[step.attempt]} approved`)
      }
      if (step.stepOrder > chainLength) fail(`${step.phase} approval beyond chain length`)
      const expectedActor = step.phase === 'REQUEST'
        ? requestChain[step.stepOrder - 1]
        : step.phase === 'SOLUTION'
          ? solutionChain[step.stepOrder - 1]
          : finalChain[step.stepOrder - 1]
      if (step.actor !== expectedActor) fail(`${step.phase} pos ${step.stepOrder} actor ${step.actor} != intended ${expectedActor}`)
      approvedMap[step.attempt] = step.stepOrder
      continue
    }
    fail(`unknown step kind ${JSON.stringify(step)}`)
  }
}

// ---------------------------------------------------------------------------
// Driver dependency boundary: the manual driver (Playwright) implements this
// interface; the pure orchestrator below never touches a browser. Fakes in
// regressions prove orchestration invariants.
// ---------------------------------------------------------------------------

export const MATRIX_HEADED = {
  headless: false as const,
  slowMo: 1500,
  viewport: { width: 1440, height: 1000 },
  checkpointMs: 6000,
} as const

export type CustomToggleSurface = 'solution' | 'resubmit' | 'final'
export type CustomToggleControl = 'radix-switch' | 'unnamed-final-button'

/** Solution/resubmit use the Radix Switch (role=switch). FINAL uses the
 *  unnamed button beside the On/Off label in submit-final-approval-modal.tsx
 *  and must be clicked exactly once. Never assume role=switch on FINAL. */
export function customToggleControl(surface: CustomToggleSurface): CustomToggleControl {
  return surface === 'final' ? 'unnamed-final-button' : 'radix-switch'
}

/** Select the second intended actor first, then the first, then move the
 *  first up. The returned order is the click order, not the final order. */
export function customChainSelectionClicks(chain: readonly [string, string]): readonly [string, string] {
  return [chain[1], chain[0]]
}

export interface ToggleDriver {
  clickSwitch(): Promise<void>
  clickUnnamedFinalButton(): Promise<void>
  switchChecked(): Promise<boolean>
  finalOnVisible(): Promise<boolean>
}

/** Enables the custom hierarchy exactly once on the surface-correct control. */
export async function enableCustomHierarchy(driver: ToggleDriver, surface: CustomToggleSurface): Promise<void> {
  const control = customToggleControl(surface)
  if (control === 'radix-switch') {
    await driver.clickSwitch()
    if (!(await driver.switchChecked())) {
      throw new LedgerPolicyError('solution/resubmit custom switch did not become checked')
    }
    return
  }
  await driver.clickUnnamedFinalButton()
  if (!(await driver.finalOnVisible())) {
    throw new LedgerPolicyError('FINAL unnamed custom toggle did not show On after exactly one click')
  }
}

export function assertClickAllowed(pageErrors: readonly string[]): void {
  if (pageErrors.length > 0) {
    throw new LedgerPolicyError(`page error recorded; blocking business click: ${pageErrors.join(' | ')}`)
  }
}

export interface ActivePhaseRef {
  requestId: string
  instanceId: string
  attempt: number
  phase: Phase
}

export interface TerminalSnapshot {
  requestId: string
  status: string
  requestPendingRows: number
  solutionPendingRows: number
  finalPendingRows: number
  instances: ReadonlyArray<{ id: string; phase: string; attempt: number; state: string; supersededAt: string | null }>
  activities: ReadonlyArray<{ id: string; action: string; fromStatus: string | null; toStatus: string | null; userId: string; comments: string | null }>
  notifications: ReadonlyArray<{ id: string; type: string; userId: string; title: string }>
}

export interface ActionBaseline {
  requestId: string
  phase: Phase
  instanceId: string
  attempt: number
  approvalRowId: string
  order: number
  actorId: string
  routingMode: 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  requiredPositionId: string | null
  candidateUserIds: readonly string[]
  observedStatus: string
  solutionId: string | null
}

export interface HeldTarget {
  instanceId: string
  attempt: number
  stepOrder: number
  actor: string
  approvalRowId: string
}

export interface HeldRejectDialog {
  /** The pending row/attempt that was current when the dialog was opened. */
  target: HeldTarget
  /** Visible and enabled. False when the held confirm auto-invalidated. */
  confirmAvailable(): Promise<boolean>
  /** Exactly one click, then a bounded wait for denial or success. */
  staleConfirm(): Promise<{ outcome: 'denied' | 'succeeded' | 'unavailable' | 'unknown'; evidence: string }>
  close(): Promise<void>
}

export interface RevisionBaseline {
  requestId: string
  phase: 'REQUEST' | 'SOLUTION'
  instanceId: string
  attempt: number
  solutionId: string | null
  observedStatus: string
  expectedState: 'rejected' | 'approved'
  rowStates: ReadonlyArray<{ order: number; status: string; approvalRowId: string }>
}

export interface ObservedApprovalRow {
  approvalRowId: string
  order: number
  status: string
  routingMode: string
  requiredApproverId: string | null
  approverId: string | null
  requiredPositionId: string | null
  candidateUserIds: readonly string[]
  instanceId?: string
}

export interface MatrixUi {
  hasFailed(): boolean
  readActivePhase(phase: Phase, title: string): Promise<ActivePhaseRef>
  readRequestRef(title: string): Promise<{ requestId: string; status: string }>
  readPublishedRouteProof(profile: RouteProfile): Promise<RouteProof[]>
  readActionBaseline(phase: Phase, title: string, order: number, expected: { actorId: string; profile: RouteProfile }): Promise<ActionBaseline>
  readRevisionBaseline(phase: 'REQUEST' | 'SOLUTION', title: string, expectedState: 'rejected' | 'approved', expectedInstanceId?: string): Promise<RevisionBaseline>
  readTerminalSnapshot(row: MatrixRow, title: string): Promise<TerminalSnapshot>
  createRequest(row: MatrixRow, title: string): Promise<string>
  approveStep(row: MatrixRow, step: Extract<PlanStep, { kind: 'approve' }>, title: string, baseline: ActionBaseline): Promise<string>
  submitSolution(row: MatrixRow, title: string, custom: boolean, priorRequest: { requestId: string } | null): Promise<string>
  rejectCurrentStep(row: MatrixRow, title: string, baseline: ActionBaseline): Promise<string>
  openHeldRejectDialog(row: MatrixRow, title: string, baseline: ActionBaseline): Promise<HeldRejectDialog>
  resubmit(row: MatrixRow, phase: 'REQUEST' | 'SOLUTION', custom: boolean, title: string, baseline: RevisionBaseline): Promise<string>
  initiateFinal(row: MatrixRow, title: string, custom: boolean, priorRequest: { requestId: string } | null, expectedAttempt: number): Promise<string>
  checkReviserControl(row: MatrixRow, title: string): Promise<string>
  checkUnauthorizedViewer(row: MatrixRow, title: string): Promise<string>
  verifyCompleted(row: MatrixRow, title: string): Promise<string>
}

export type JournalFn = (note?: string) => Promise<void>

export interface CaseJournal {
  caseId: string
  entries: LedgerEntry[]
  notes: string[]
}

export interface MatrixJournal {
  cases: Record<string, CaseJournal>
}

export function emptyMatrixJournal(): MatrixJournal {
  return { cases: {} }
}

/** Retain every case. Updating the current case must not drop earlier cases. */
export function retainCaseJournal(
  journal: MatrixJournal,
  caseId: string,
  entries: readonly LedgerEntry[],
  note?: string,
): void {
  const prior = journal.cases[caseId]
  journal.cases[caseId] = {
    caseId,
    entries: entries.map((entry) => ({ ...entry, expectedChainIds: entry.expectedChainIds ? [...entry.expectedChainIds] : undefined })),
    notes: [...(prior?.notes ?? []), ...(note ? [note] : [])],
  }
}

export function renderMatrixProgress(
  journal: MatrixJournal,
  results: Readonly<Record<string, unknown>>,
  pageErrors: readonly string[],
): {
  cases: Readonly<Record<string, unknown>>
  ledgers: Record<string, LedgerEntry[]>
  pageErrors: string[]
  updatedAt: string
} {
  return {
    cases: results,
    ledgers: Object.fromEntries(Object.entries(journal.cases).map(([id, item]) => [id, item.entries])),
    pageErrors: [...pageErrors],
    updatedAt: new Date().toISOString(),
  }
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    }
    return item
  })
}

/** Before/after equality of the full terminal/instance/audit/notification
 *  snapshot. A second Completed status read is not this proof. */
export function assertSnapshotsEqual(before: TerminalSnapshot, after: TerminalSnapshot): void {
  if (!Array.isArray(before.instances) || !Array.isArray(before.activities) || !Array.isArray(before.notifications)) {
    throw new LedgerPolicyError('terminal snapshot missing instance/audit/notification proof')
  }
  if (!Array.isArray(after.instances) || !Array.isArray(after.activities) || !Array.isArray(after.notifications)) {
    throw new LedgerPolicyError('post-click snapshot missing instance/audit/notification proof')
  }
  if (stable(before) !== stable(after)) {
    throw new LedgerPolicyError('stale confirm changed terminal/instance/audit snapshot')
  }
}

function proofObject(evidence: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(evidence)
  } catch {
    throw new LedgerPolicyError('persisted proof is not target-correlated JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LedgerPolicyError('persisted proof is not a JSON object')
  }
  return parsed as Record<string, unknown>
}

function exactChain(actual: unknown, expected: readonly string[], label: string): void {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new LedgerPolicyError(`${label} ids/order ${JSON.stringify(actual)} != intended ${JSON.stringify([...expected])}`)
  }
}

/** Confirm only when the persisted JSON matches the attempting target. */
export function correlatePersistedProof(key: LedgerKey, evidence: string): void {
  const parsed = proofObject(evidence)
  requireRealId(parsed.requestId, 'requestId')
  if (key.action === 'submit-request') {
    if (parsed.status !== 'ImprovementRequest') throw new LedgerPolicyError(`create proof status ${String(parsed.status)}`)
    return
  }
  if (key.action === 'approve-step') {
    if (parsed.phase !== key.phase || parsed.attempt !== key.attempt || parsed.stepOrder !== key.stepOrder || parsed.actor !== key.actor) {
      throw new LedgerPolicyError('approval proof does not match the attempting target')
    }
    if (parsed.instanceId !== key.instanceId) {
      throw new LedgerPolicyError('approval proof instance does not match the instance captured before the click')
    }
    if (parsed.status !== 'approved' || parsed.order !== key.stepOrder) throw new LedgerPolicyError('approval proof status/order')
    if (parsed.approvalRowId === parsed.requestId) throw new LedgerPolicyError('approvalRowId mislabeled as requestId')
    requireRealId(parsed.approvalRowId, 'approvalRowId')
    requireRealId(parsed.instanceId, 'instanceId')
    if (key.rowId && parsed.approvalRowId !== key.rowId) throw new LedgerPolicyError('approval proof row != captured pending row')
    return
  }
  if (key.action === 'confirm-rejection') {
    if (parsed.phase !== key.phase || parsed.actor !== key.actor || parsed.order !== key.stepOrder) {
      throw new LedgerPolicyError('rejection proof does not match the attempting target')
    }
    if (parsed.instanceId !== key.instanceId) throw new LedgerPolicyError('rejection proof instance is stale or mismatched')
    if (parsed.status !== expectedPostRejectStatus(key.phase as Phase)) {
      throw new LedgerPolicyError(`rejection proof status ${String(parsed.status)} != ${expectedPostRejectStatus(key.phase as Phase)}`)
    }
    if (parsed.rejectionRowId === parsed.requestId) throw new LedgerPolicyError('rejectionRowId mislabeled as requestId')
    requireRealId(parsed.rejectionRowId, 'rejectionRowId')
    if (key.rowId && parsed.rejectionRowId !== key.rowId) throw new LedgerPolicyError('rejection proof row != captured pending row')
    if (typeof parsed.reason !== 'string' || !parsed.reason.trim()) throw new LedgerPolicyError('rejection proof missing reason')
    return
  }
  if (key.action === 'resubmit') {
    if (parsed.phase !== key.phase) throw new LedgerPolicyError('resubmit proof phase != pre-click phase')
    if (parsed.previousInstanceId !== key.instanceId) {
      throw new LedgerPolicyError('resubmit previousInstanceId != pre-click ledger instance')
    }
    if (parsed.previousAttempt !== key.attempt) {
      throw new LedgerPolicyError('resubmit proof previousAttempt was not the attempt captured before revision')
    }
    if (typeof parsed.newAttempt !== 'number' || !key.attempt || parsed.newAttempt <= key.attempt) {
      throw new LedgerPolicyError('resubmit proof newAttempt must exceed the pre-revision attempt')
    }
    if (parsed.previousSuperseded !== true) throw new LedgerPolicyError('resubmit proof missing supersession')
    if (parsed.carriedApprovals !== 0) throw new LedgerPolicyError('resubmit proof carried prior approvals into the new attempt')
    if (parsed.newInstanceId === parsed.previousInstanceId) throw new LedgerPolicyError('resubmit proof reused the previous instance')
    requireRealId(parsed.previousInstanceId, 'previousInstanceId')
    requireRealId(parsed.newInstanceId, 'newInstanceId')
    if (key.expectedChainIds) exactChain(parsed.customChainIds, key.expectedChainIds, 'resubmit custom chain')
    return
  }
  if (key.action === 'submit-solution' || key.action === 'initiate-final') {
    requireRealId(parsed.instanceId, 'instanceId')
    if (key.expectedChainIds) exactChain(parsed.customChainIds, key.expectedChainIds, key.action)
    if (parsed.observedStatus !== parsed.status) {
      throw new LedgerPolicyError('submission proof status was not the observed database status')
    }
    if (key.instanceId && parsed.instanceId !== key.instanceId) {
      throw new LedgerPolicyError('submission proof instance != captured instance')
    }
    if (key.attempt && parsed.attempt !== key.attempt) {
      throw new LedgerPolicyError('submission proof attempt != captured attempt')
    }
    if (key.action === 'submit-solution' && parsed.status !== 'DesignCostEstimationApproval') {
      throw new LedgerPolicyError(`solution proof status ${String(parsed.status)}`)
    }
    if (key.action === 'initiate-final' && parsed.status !== 'FinalApproval') {
      throw new LedgerPolicyError(`final initiation proof status ${String(parsed.status)}`)
    }
    return
  }
  if (key.action === 'stale-confirm-rejection') {
    throw new LedgerPolicyError('stale confirm is a denial, not a confirmation')
  }
}

async function confirmCorrelated(ledger: MatrixLedger, entry: LedgerEntry, evidence: string): Promise<void> {
  correlatePersistedProof(entry, evidence)
  ledger.confirm(entry, evidence)
}

function assertFreshPhaseProof(evidence: string, expected: {
  requestId: string
  attempt: number
  routingMode: 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  routeSource: string
  orderedActorIds: readonly string[]
}): void {
  const parsed = proofObject(evidence)
  if (parsed.requestId !== expected.requestId) throw new LedgerPolicyError('submission requestId != pre-click request')
  if (parsed.attempt !== expected.attempt) throw new LedgerPolicyError(`submission attempt ${String(parsed.attempt)} != phase-local ${expected.attempt}`)
  if (parsed.observedInstanceId !== parsed.instanceId) throw new LedgerPolicyError('submission instance was not the observed database id')
  if (parsed.observedRouteSource !== parsed.routeSource) throw new LedgerPolicyError('route source was not observed from the database')
  if (parsed.routingMode !== expected.routingMode) throw new LedgerPolicyError(`routingMode ${String(parsed.routingMode)} != ${expected.routingMode}`)
  if (parsed.routeSource !== expected.routeSource) throw new LedgerPolicyError(`route source ${String(parsed.routeSource)} != ${expected.routeSource}`)
  exactChain(parsed.pendingActorIds, expected.orderedActorIds, 'fresh phase chain')
}

function assertEligibleBaseline(
  caseId: string,
  baseline: ActionBaseline,
  phase: Phase,
  attempt: number,
  order: number,
  actor: string,
): void {
  if (baseline.phase !== phase || baseline.attempt !== attempt || baseline.order !== order) {
    throw new LedgerPolicyError(`${caseId}: pre-click baseline ${baseline.phase}/a${baseline.attempt}/pos${baseline.order} != ${phase}/a${attempt}/pos${order}`)
  }
  if (!baseline.approvalRowId || !baseline.instanceId) {
    throw new LedgerPolicyError(`${caseId}: pre-click baseline missing pending row or instance`)
  }
  if (baseline.routingMode === 'CUSTOM_PERSON') {
    if (baseline.actorId !== actor) throw new LedgerPolicyError(`${caseId}: custom pending actor ${baseline.actorId} != ${actor}`)
    return
  }
  if (baseline.routingMode !== 'SNAPSHOT_GROUP') throw new LedgerPolicyError(`${caseId}: unknown routing mode ${baseline.routingMode}`)
  if (baseline.requiredPositionId === null) throw new LedgerPolicyError(`${caseId}: rank pending row missing position`)
  if (!baseline.candidateUserIds.includes(actor)) {
    throw new LedgerPolicyError(`${caseId}: actor ${actor} is not a candidate of the captured rank row`)
  }
}

/**
 * Pure orchestrator. Every business click is preceded by a durable journal of
 * the attempting record. Confirmations require target-correlated persisted
 * proof. The held stale dialog is closed in finally even when a later step fails.
 */
export async function runMatrixCase(
  row: MatrixRow,
  ui: MatrixUi,
  ledger: MatrixLedger,
  journal: JournalFn,
  title: string,
): Promise<{ staleNegative: 'passed' | 'stale-window-unavailable' | 'failed' | undefined }> {
  let staleNegative: 'passed' | 'stale-window-unavailable' | 'failed' | undefined
  let held: HeldRejectDialog | null = null
  let failure: unknown
  const staleCheck = buildStaleNegativeChecks([row]).find((check) => check.attachedTo === row.id)
  const guardUi = async (): Promise<void> => {
    if (ui.hasFailed()) throw new LedgerPolicyError(`${row.id}: page error recorded; blocking all further clicks`)
    ledger.assertNoUnresolvedAttempting()
  }

  try {
    for (const step of buildCasePlan(row)) {
      await guardUi()
      if (step.kind === 'create-request') {
        assertRouteProof(row.profile, await ui.readPublishedRouteProof(row.profile))
        const entry = ledger.begin({ caseId: row.id, action: 'submit-request', actor: step.actor })
        await journal('before submit-request click')
        const evidence = await ui.createRequest(row, title)
        await confirmCorrelated(ledger, entry, evidence)
        await journal('submit-request confirmed')
        continue
      }
      if (step.kind === 'submit-solution') {
        if (!step.custom) assertRouteStepsBeforeAction(await ui.readPublishedRouteProof(row.profile), 'SOLUTION', row.profile)
        const customChain = step.custom ? CUSTOM_CHAINS.SOLUTION.map(mapActor) : undefined
        const entry = ledger.begin({

          caseId: row.id, action: 'submit-solution', phase: 'SOLUTION', attempt: 1, actor: step.actor,
          expectedChainIds: customChain,
        })
        await journal('before submit-solution click')
        const prior = await ui.readRequestRef(title)
        const evidence = await ui.submitSolution(row, title, step.custom, prior)
        assertFreshPhaseProof(evidence, {
          requestId: prior.requestId,
          attempt: 1,
          routingMode: step.custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
          routeSource: step.custom ? 'CUSTOM_PERSON' : expectedRouteSource(row.profile, 'SOLUTION'),
          orderedActorIds: step.custom ? CUSTOM_CHAINS.SOLUTION.map(mapActor) : RANK_CHAINS[row.profile].SOLUTION.map(mapActor),
        })
        await confirmCorrelated(ledger, entry, evidence)
        await journal('submit-solution confirmed')
        continue
      }
      if (step.kind === 'approve') {
        const baseline = await ui.readActionBaseline(step.phase, title, step.stepOrder, { actorId: step.actor, profile: row.profile })
        assertEligibleBaseline(row.id, baseline, step.phase, step.attempt, step.stepOrder, step.actor)
        const entry = ledger.begin({
          caseId: row.id, action: 'approve-step', phase: step.phase, attempt: baseline.attempt,
          stepOrder: step.stepOrder, actor: step.actor, instanceId: baseline.instanceId, rowId: baseline.approvalRowId,
        })
        await journal(`before approve click ${step.phase}/pos${step.stepOrder}/${step.actor}`)
        const evidence = await ui.approveStep(row, step, title, baseline)
        await confirmCorrelated(ledger, entry, evidence)
        await journal(`approve confirmed ${step.phase}/pos${step.stepOrder}`)
        continue
      }
      if (step.kind === 'reject') {
        const baseline = await ui.readActionBaseline(step.phase, title, step.stepOrder, { actorId: step.actor, profile: row.profile })
        assertEligibleBaseline(row.id, baseline, step.phase, baseline.attempt, step.stepOrder, step.actor)
        if (staleCheck) held = await ui.openHeldRejectDialog(row, title, baseline)
        const entry = ledger.begin({
          caseId: row.id, action: 'confirm-rejection', phase: step.phase, attempt: baseline.attempt,
          stepOrder: step.stepOrder, actor: step.actor, instanceId: baseline.instanceId, rowId: baseline.approvalRowId,
        })
        await journal('before reject confirm click')
        const evidence = await ui.rejectCurrentStep(row, title, baseline)
        await confirmCorrelated(ledger, entry, evidence)
        await journal('rejection confirmed')
        await journal(`rejected checkpoint reviser control: ${await ui.checkReviserControl(row, title)}`)
        await journal(`rejected checkpoint unauthorized viewer: ${await ui.checkUnauthorizedViewer(row, title)}`)
        continue
      }
      if (step.kind === 'resubmit') {
        const expectedState = step.phase === 'SOLUTION' && row.phase === 'FINAL' ? 'approved' : 'rejected'
        const evidence = await captureRevisionBeforeResubmit(
          () => ui.readRevisionBaseline(step.phase, title, expectedState),
          async (baseline) => {
            const entry = ledger.begin({
              caseId: row.id, action: 'resubmit', phase: step.phase, attempt: baseline.attempt,
              actor: step.actor, instanceId: baseline.instanceId, rowId: baseline.rowStates[0]?.approvalRowId,
              expectedChainIds: step.custom ? CUSTOM_CHAINS.SOLUTION.map(mapActor) : undefined,
            })
            await journal('before resubmit click')
            const submitted = await ui.resubmit(row, step.phase, step.custom, title, baseline)
            await confirmCorrelated(ledger, entry, submitted)
            return submitted
          },
        )
        void evidence
        await journal('resubmit confirmed')
        continue
      }
      if (step.kind === 'initiate-final') {
        const initiateIndex = ledger.all.filter((entry) => entry.caseId === row.id && entry.action === 'initiate-final').length + 1
        const entry = ledger.begin({
          caseId: row.id, action: 'initiate-final', phase: 'FINAL', attempt: initiateIndex, actor: step.actor,
          expectedChainIds: step.custom ? CUSTOM_CHAINS.FINAL.map(mapActor) : undefined,
        })
        if (!step.custom) assertRouteStepsBeforeAction(await ui.readPublishedRouteProof(row.profile), 'FINAL', row.profile)
        await journal('before Start Final Approval click')
        const prior = await ui.readRequestRef(title)
        const evidence = await ui.initiateFinal(row, title, step.custom, prior, initiateIndex)
        assertFreshPhaseProof(evidence, {
          requestId: prior.requestId,
          attempt: initiateIndex,
          routingMode: step.custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
          routeSource: step.custom ? 'CUSTOM_PERSON' : expectedRouteSource(row.profile, 'FINAL'),
          orderedActorIds: step.custom ? CUSTOM_CHAINS.FINAL.map(mapActor) : RANK_CHAINS[row.profile].FINAL.map(mapActor),
        })
        await confirmCorrelated(ledger, entry, evidence)
        await journal('initiate-final confirmed')
        continue
      }
      if (step.kind === 'verify-completed') {
        const evidence = await ui.verifyCompleted(row, title)
        const parsed = proofObject(evidence)
        if (parsed.status !== 'Completed' || parsed.requestPendingRows !== 0 || parsed.solutionPendingRows !== 0 || parsed.finalPendingRows !== 0 || parsed.bannerSeen !== true) {
          throw new LedgerPolicyError(`${row.id}: completed proof is incomplete`)
        }
        requireRealId(parsed.requestId, 'requestId')
        await journal(`completed verified: ${evidence}`)
        continue
      }
      throw new LedgerPolicyError('unknown plan step')
    }

    if (staleCheck) {
      await guardUi()
      if (!held) throw new LedgerPolicyError(`${row.id}: FINAL case without a held dialog for the stale negative`)
      const available = await held.confirmAvailable()
      if (!available) {
        staleNegative = 'stale-window-unavailable'
        await journal('stale confirm unavailable; no click; not a passed denial')
      } else {
      const before = await ui.readTerminalSnapshot(row, title)
      if (before.status !== 'Completed' || before.requestPendingRows !== 0 || before.solutionPendingRows !== 0 || before.finalPendingRows !== 0) {
        throw new LedgerPolicyError(`${row.id}: stale confirm refused until Completed and current pending rows are 0`)
      }
      if (held.target.attempt !== 1 || held.target.stepOrder !== row.rejectOrder) {
        throw new LedgerPolicyError(`${row.id}: held target must retain the original pending attempt, not rejectOrder-as-attempt`)
      }
      const key = {
        caseId: row.id,
        action: 'stale-confirm-rejection' as const,
        phase: 'FINAL' as const,
        attempt: held.target.attempt,
        stepOrder: held.target.stepOrder,
        actor: held.target.actor,
        instanceId: held.target.instanceId,
        rowId: held.target.approvalRowId,
      }
      const entry = ledger.begin(key)
      await journal(`before exactly one stale confirm click; snapshot ${stable(before)}`)
      const outcome = await held.staleConfirm()
      if (outcome.outcome === 'succeeded') {
        staleNegative = 'failed'
        throw new LedgerPolicyError(`${row.id}: STALE REJECTION SUCCEEDED — unexpected mutation (${outcome.evidence})`)
      }
      if (outcome.outcome === 'unknown') {
        throw new LedgerPolicyError(`${row.id}: stale outcome unknown remains unresolved attempting (${outcome.evidence})`)
      }
      if (outcome.outcome !== 'denied') {
        throw new LedgerPolicyError(`${row.id}: stale outcome ${outcome.outcome} is not a passed denial (${outcome.evidence})`)
      }
      const after = await ui.readTerminalSnapshot(row, title)
      assertSnapshotsEqual(before, after)
      ledger.recordDeniedStaleConfirm(key, outcome.evidence)
      staleNegative = 'passed'
      await journal(`stale confirm denied; snapshot unchanged: ${outcome.evidence}`)
    }
    }
  } catch (error) {
    failure = error
  }
  if (held) {
    try {
      await held.close()
    } catch (error) {
      const closeMessage = error instanceof Error ? error.message : String(error)
      const original = failure instanceof Error ? failure.message : failure ? String(failure) : ''
      failure = new LedgerPolicyError(original ? `${original}; held close failed: ${closeMessage}` : `held close failed: ${closeMessage}`)
    }
  }
  if (failure) throw failure
  return { staleNegative }
}

// ---------------------------------------------------------------------------
// Typed persisted-evidence validators. Expected targets are required. A proof
// object alone is not accepted: wrong status, stale instance, placeholder ids,
// mislabeled row ids, and length-only custom chains all fail closed.
// ---------------------------------------------------------------------------

export interface RequestCreateEvidence {
  title: string
  status: 'ImprovementRequest'
  requestId: string
}
export interface ApprovalEvidence {
  phase: Phase
  attempt: number
  stepOrder: number
  actor: string
  approvalRowId: string
  requestId: string
  status: 'approved'
  order: number
  instanceId: string
}
export interface SolutionSubmitEvidence {
  requestId: string
  solutionId: string
  instanceId: string
  attempt: number
  status: 'DesignCostEstimationApproval'
  pendingApprovalRows: number
  pendingApproverIds: readonly string[]
  customChainIds?: readonly string[]
  routingMode?: string
  routeVersionId?: string | null
  scopeUnitId?: string | null
  supersededInstanceIds?: readonly string[]
  observedInstanceId?: string
  observedStatus?: string
  routeSource?: string
  observedRouteSource?: string
  pendingActorIds?: readonly string[]
}
export interface RejectionEvidence {
  phase: Phase
  requestId: string
  rejectionRowId: string
  status: 'ImprovementRequest' | 'DesignCostEstimationApproval' | 'SentToEngineer'
  actor: string
  reason: string
  rejectedRows: number
  instanceId: string
  attempt: number
  order: number
  isFinalApproval?: boolean
}
export interface ResubmitEvidence {
  phase: 'REQUEST' | 'SOLUTION'
  requestId: string
  newAttempt: number
  previousAttempt: number
  previousInstanceId: string
  newInstanceId: string
  previousSuperseded: boolean
  carriedApprovals: number
  customChainIds?: readonly string[]
}
export interface FinalInitiationEvidence {
  requestId: string
  initiationRowId: string
  instanceId: string
  observedInstanceId?: string
  attempt: number
  status: 'FinalApproval'
  /** The request status ACTUALLY observed in the database at initiation time;
   *  the outer submission guard requires it to equal `status`. */
  observedStatus: string
  pendingFinalRows: number
  pendingApproverIds: readonly string[]
  customChainIds?: readonly string[]
  routingMode?: string
  routeSource?: string
  observedRouteSource?: string
  pendingActorIds?: readonly string[]
  routeVersionId?: string | null
}
export interface CompletedEvidence {
  requestId: string
  status: 'Completed'
  requestPendingRows: number
  solutionPendingRows: number
  finalPendingRows: number
  bannerSeen: boolean
  stage3InViewport: boolean
}

export interface RejectionExpectation {
  phase: Phase
  requestId: string
  status: RejectionEvidence['status']
  actor: string
  reason: string
  order: number
  instanceId: string
  attempt: number
}

export interface ApprovalExpectation {
  phase: Phase
  attempt: number
  stepOrder: number
  actor: string
  requestId: string
  instanceId: string
}

const PLACEHOLDER_IDS = new Set(['by-title', 'correlated-by-title', 'via-solution', 'approval-row-id'])

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new LedgerPolicyError(`evidence missing ${field}`)
  return value
}

function requireRealId(value: unknown, field: string): string {
  const id = requireString(value, field)
  if (PLACEHOLDER_IDS.has(id) || id.startsWith('by-') || id.startsWith('correlated-')) {
    throw new LedgerPolicyError(`evidence ${field} is a placeholder ('${id}'), not a real DB id`)
  }
  return id
}

function requireExpected<T>(expected: T | undefined, label: string): T {
  if (expected === undefined || expected === null) throw new LedgerPolicyError(`${label} is required`)
  return expected
}

export function assertRequestCreateEvidence(evidence: RequestCreateEvidence): void {
  requireRealId(evidence.requestId, 'requestId')
  if (evidence.status !== 'ImprovementRequest') throw new LedgerPolicyError(`create evidence wrong status ${evidence.status}`)
  if (!evidence.title || evidence.title !== evidence.title.trim()) throw new LedgerPolicyError('create evidence missing title')
}

export function assertApprovalEvidence(evidence: ApprovalEvidence, expected?: ApprovalExpectation): void {
  const target = requireExpected(expected, 'expected approval target')
  requireRealId(evidence.requestId, 'requestId')
  requireRealId(evidence.approvalRowId, 'approvalRowId')
  requireRealId(evidence.instanceId, 'instanceId')
  if (evidence.approvalRowId === evidence.requestId) throw new LedgerPolicyError('approvalRowId mislabeled as requestId')
  if (evidence.requestId !== target.requestId) throw new LedgerPolicyError(`approval requestId ${evidence.requestId} != ${target.requestId}`)
  if (evidence.phase !== target.phase) throw new LedgerPolicyError(`approval phase ${evidence.phase} != ${target.phase}`)
  if (evidence.attempt !== target.attempt) throw new LedgerPolicyError(`approval attempt ${evidence.attempt} != captured ${target.attempt}`)
  if (evidence.instanceId !== target.instanceId) throw new LedgerPolicyError(`stale or wrong approval instance ${evidence.instanceId} != ${target.instanceId}`)
  if (evidence.actor !== target.actor) throw new LedgerPolicyError(`approval actor ${evidence.actor} != ${target.actor}`)
  if (evidence.stepOrder !== target.stepOrder || evidence.order !== target.stepOrder) {
    throw new LedgerPolicyError(`approval order ${evidence.order} != target step ${target.stepOrder}`)
  }
  if (evidence.status !== 'approved') throw new LedgerPolicyError(`approval evidence status ${evidence.status}`)
}

export function assertSolutionSubmitEvidence(
  evidence: SolutionSubmitEvidence,
  expected?: { requestId: string; customChainIds?: readonly string[]; attempt: number; instanceId: string },
): void {
  const target = requireExpected(expected, 'expected solution target')
  requireRealId(evidence.requestId, 'requestId')
  requireRealId(evidence.solutionId, 'solutionId')
  requireRealId(evidence.instanceId, 'instanceId')
  if (evidence.requestId !== target.requestId) throw new LedgerPolicyError('solution submit request mismatch')
  if (evidence.instanceId !== target.instanceId) throw new LedgerPolicyError('solution submit instance mismatch')
  if (evidence.attempt !== target.attempt) throw new LedgerPolicyError('solution submit attempt mismatch')
  if (evidence.status !== 'DesignCostEstimationApproval') throw new LedgerPolicyError(`solution submit evidence status ${evidence.status}`)
  if (!Number.isInteger(evidence.pendingApprovalRows) || evidence.pendingApprovalRows < 1) {
    throw new LedgerPolicyError(`solution submit evidence pendingApprovalRows ${evidence.pendingApprovalRows}`)
  }
  if (target.customChainIds) {
    exactChain(evidence.pendingApproverIds, target.customChainIds, 'pending custom solution chain')
    exactChain(evidence.customChainIds, target.customChainIds, 'custom solution chain')
  }
}

export function assertRejectionEvidence(evidence: RejectionEvidence, expected?: RejectionExpectation): void {
  const target = requireExpected(expected, 'expected rejection target')
  requireRealId(evidence.requestId, 'requestId')
  requireRealId(evidence.rejectionRowId, 'rejectionRowId')
  requireRealId(evidence.instanceId, 'instanceId')
  if (evidence.rejectionRowId === evidence.requestId) throw new LedgerPolicyError('rejectionRowId mislabeled as requestId')
  if (evidence.phase !== target.phase) throw new LedgerPolicyError(`rejection phase ${evidence.phase} != ${target.phase}`)
  if (evidence.requestId !== target.requestId) throw new LedgerPolicyError(`rejection requestId ${evidence.requestId} != ${target.requestId}`)
  if (evidence.actor !== target.actor) throw new LedgerPolicyError(`rejection actor ${evidence.actor} != ${target.actor}`)
  if (evidence.reason !== target.reason) throw new LedgerPolicyError('rejection reason does not match the submitted reason')
  if (evidence.order !== target.order) throw new LedgerPolicyError(`rejection order ${evidence.order} != ${target.order}`)
  if (evidence.instanceId !== target.instanceId) throw new LedgerPolicyError(`stale or wrong rejection instance ${evidence.instanceId} != ${target.instanceId}`)
  if (evidence.attempt !== target.attempt) throw new LedgerPolicyError(`rejection attempt ${evidence.attempt} != captured ${target.attempt}`)
  const expectedStatus = expectedPostRejectStatus(target.phase)
  if (evidence.status !== expectedStatus || evidence.status !== target.status) {
    throw new LedgerPolicyError(`wrong rejection status ${String(evidence.status)}; expected ${expectedStatus}`)
  }
  if (target.phase === 'FINAL' && evidence.isFinalApproval !== true) {
    throw new LedgerPolicyError('FINAL rejection must be scoped with isFinalApproval on request_approvals')
  }
  if (target.phase === 'REQUEST' && evidence.isFinalApproval === true) {
    throw new LedgerPolicyError('REQUEST rejection must not be a FINAL request_approvals row')
  }
  if (!Number.isInteger(evidence.rejectedRows) || evidence.rejectedRows < 1) throw new LedgerPolicyError('rejection evidence rejectedRows')
}

export function assertResubmitEvidence(
  evidence: ResubmitEvidence,
  expected?: { requestId: string; previousAttempt: number; previousInstanceId: string; customChainIds?: readonly string[] },
): void {
  const target = requireExpected(expected, 'expected resubmit target')
  requireRealId(evidence.requestId, 'requestId')
  requireRealId(evidence.previousInstanceId, 'previousInstanceId')
  requireRealId(evidence.newInstanceId, 'newInstanceId')
  if (evidence.requestId !== target.requestId) throw new LedgerPolicyError('resubmit request mismatch')
  if (target.previousAttempt < 1) throw new LedgerPolicyError('previous attempt must be captured before revision')
  if (evidence.previousAttempt !== target.previousAttempt) {
    throw new LedgerPolicyError(`resubmit previousAttempt ${evidence.previousAttempt} != captured ${target.previousAttempt}`)
  }
  if (evidence.newAttempt !== target.previousAttempt + 1) {
    throw new LedgerPolicyError(`resubmit newAttempt ${evidence.newAttempt} must be the next attempt after ${target.previousAttempt}`)
  }
  if (evidence.previousInstanceId !== target.previousInstanceId) throw new LedgerPolicyError('resubmit previous instance mismatch')
  if (!evidence.previousSuperseded) throw new LedgerPolicyError('previous attempt was not superseded')
  if (evidence.carriedApprovals !== 0) throw new LedgerPolicyError('prior approvals were carried into the new attempt')
  if (evidence.newInstanceId === evidence.previousInstanceId) throw new LedgerPolicyError('resubmit reused the previous instance')
  if (target.customChainIds) exactChain(evidence.customChainIds, target.customChainIds, 'resubmit custom chain')
}

export function assertFinalInitiationEvidence(
  evidence: FinalInitiationEvidence,
  expected?: { requestId: string; customChainIds?: readonly string[]; instanceId: string; attempt: number },
): void {
  const target = requireExpected(expected, 'expected final initiation target')
  requireRealId(evidence.requestId, 'requestId')
  requireRealId(evidence.initiationRowId, 'initiationRowId')
  requireRealId(evidence.instanceId, 'instanceId')
  if (evidence.requestId !== target.requestId) throw new LedgerPolicyError('final initiation request mismatch')
  if (evidence.instanceId !== target.instanceId) throw new LedgerPolicyError('final initiation instance mismatch')
  if (evidence.attempt !== target.attempt) throw new LedgerPolicyError('final initiation attempt mismatch')
  if (evidence.status !== 'FinalApproval') throw new LedgerPolicyError(`final initiation evidence status ${evidence.status}`)
  if (evidence.observedStatus !== evidence.status) {
    throw new LedgerPolicyError(`final initiation observedStatus ${String(evidence.observedStatus)} != evidence status ${evidence.status}`)
  }
  if (!Number.isInteger(evidence.pendingFinalRows) || evidence.pendingFinalRows < 1) throw new LedgerPolicyError('final initiation pendingFinalRows')
  if (target.customChainIds) {
    exactChain(evidence.pendingApproverIds, target.customChainIds, 'pending custom final chain')
    exactChain(evidence.customChainIds, target.customChainIds, 'custom final chain')
  }
}

export function assertCompletedEvidence(evidence: CompletedEvidence): void {
  requireRealId(evidence.requestId, 'requestId')
  if (evidence.status !== 'Completed') throw new LedgerPolicyError(`completed evidence status ${evidence.status}`)
  if (evidence.requestPendingRows !== 0 || evidence.solutionPendingRows !== 0 || evidence.finalPendingRows !== 0) {
    throw new LedgerPolicyError(`completed evidence pending rows r=${evidence.requestPendingRows} s=${evidence.solutionPendingRows} f=${evidence.finalPendingRows}`)
  }
  if (evidence.bannerSeen !== true) throw new LedgerPolicyError('completed evidence missing actual final banner')
  if (evidence.stage3InViewport !== true) throw new LedgerPolicyError('completed evidence missing in-viewport stage 3')
}

export function pendingCustomActorId(row: { routingMode?: string; requiredApproverId: string | null; approverId: string | null }): string {
  if (row.routingMode && row.routingMode !== 'CUSTOM_PERSON') {
    throw new LedgerPolicyError('requiredApproverId/approverId resolution is custom-person only')
  }
  const id = row.requiredApproverId ?? row.approverId
  if (!id) throw new LedgerPolicyError('pending custom row has neither requiredApproverId nor approverId')
  return id
}

export interface RankPendingRow {
  routingMode: string
  requiredApproverId: string | null
  approverId: string | null
  requiredPositionId: string | null
  candidateUserIds: readonly string[]
  order: number
  status: string
}

/** Rank SNAPSHOT_GROUP rows persist position + candidate membership, not a person id. */
export function assertRankPendingRow(row: RankPendingRow, expected: {
  order: number
  positionId: string
  actorId: string
  candidateUserIds: readonly string[]
}): void {
  if (row.routingMode !== 'SNAPSHOT_GROUP') throw new LedgerPolicyError(`rank row routingMode ${row.routingMode}`)
  if (row.status === 'pending' && (row.requiredApproverId !== null || row.approverId !== null)) {
    throw new LedgerPolicyError('rank pending row must not be resolved as a custom person')
  }
  if (row.requiredPositionId !== expected.positionId) {
    throw new LedgerPolicyError(`rank position ${row.requiredPositionId} != ${expected.positionId}`)
  }
  if (row.order !== expected.order) throw new LedgerPolicyError(`rank order ${row.order} != ${expected.order}`)
  if (!row.candidateUserIds.includes(expected.actorId)) {
    throw new LedgerPolicyError('intended rank actor is not a candidate')
  }
  const actual = [...row.candidateUserIds].sort()
  const wanted = [...expected.candidateUserIds].sort()
  if (actual.length !== wanted.length || actual.some((id, index) => id !== wanted[index])) {
    throw new LedgerPolicyError(`rank candidates ${actual.join(',')} != ${wanted.join(',')}`)
  }
}

export function assertObservedStatus(observed: string, expected: string): void {
  if (observed !== expected) throw new LedgerPolicyError(`observed status ${observed} != expected ${expected}`)
}

export function expectedRankStep(profile: RouteProfile, phase: Phase, order: number): RouteProofStep {
  const step = expectedActiveRouteProof(profile).find((item) => item.phase === phase)?.steps.find((item) => item.order === order)
  if (!step) throw new LedgerPolicyError(`no expected rank step ${profile}/${phase}/${order}`)
  return step
}

/** Published-route check used before a rank business action. Candidate order does not matter; position and membership do. */
export function assertRouteStepsBeforeAction(proof: readonly RouteProof[], phase: Phase, profile: RouteProfile): void {
  const actual = proof.find((item) => item.phase === phase)
  const expected = expectedActiveRouteProof(profile).find((item) => item.phase === phase)
  if (!actual || !expected) throw new LedgerPolicyError(`route proof missing ${profile}/${phase}`)
  if (actual.steps.length !== expected.steps.length) throw new LedgerPolicyError(`route step count ${actual.steps.length} != ${expected.steps.length}`)
  const ordered = [...actual.steps].sort((a, b) => a.order - b.order)
  ordered.forEach((step, index) => {
    const wanted = expected.steps[index]
    assertRankPendingRow({
      routingMode: 'SNAPSHOT_GROUP',
      requiredApproverId: null,
      approverId: null,
      requiredPositionId: step.positionId,
      candidateUserIds: step.candidateUserIds,
      order: step.order,
      status: 'pending',
    }, {
      order: wanted.order,
      positionId: wanted.positionId,
      actorId: wanted.primaryActorId,
      candidateUserIds: wanted.candidateUserIds,
    })
  })
}

export function classifyPendingChain(rows: readonly ObservedApprovalRow[], expected: {
  routingMode: 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  orderedActors: readonly string[]
  rankSteps?: readonly RouteProofStep[]
}): { pendingActorIds: readonly string[]; customChainIds?: readonly string[]; rankGroups?: ReadonlyArray<{ order: number; positionId: string | null; candidateUserIds: readonly string[] }> } {
  const pending = rows.filter((row) => row.status === 'pending').sort((a, b) => a.order - b.order)
  if (expected.routingMode === 'CUSTOM_PERSON') {
    const ids = pending.map((row) => pendingCustomActorId(row))
    if (ids.length !== expected.orderedActors.length || ids.some((id, index) => id !== expected.orderedActors[index])) {
      throw new LedgerPolicyError(`custom pending ${ids.join(',')} != ${expected.orderedActors.join(',')}`)
    }
    return { pendingActorIds: ids, customChainIds: ids }
  }
  if (!expected.rankSteps || pending.length !== expected.rankSteps.length) {
    throw new LedgerPolicyError('rank pending rows do not match the expected position chain')
  }
  pending.forEach((row, index) => {
    const wanted = expected.rankSteps![index]
    assertRankPendingRow(row, {
      order: wanted.order,
      positionId: wanted.positionId,
      actorId: wanted.primaryActorId,
      candidateUserIds: wanted.candidateUserIds,
    })
  })
  return {
    pendingActorIds: expected.rankSteps.map((step) => step.primaryActorId),
    rankGroups: pending.map((row) => ({ order: row.order, positionId: row.requiredPositionId, candidateUserIds: row.candidateUserIds })),
  }
}

export function buildActionBaseline(input: {
  phase: Phase
  request: { id: string; status: string }
  active: { instanceId: string; attempt: number }
  rows: readonly ObservedApprovalRow[]
  order: number
  solutionId: string | null
  expected: { actorId: string; profile: RouteProfile }
}): ActionBaseline {
  const current = input.rows.find((row) => row.order === input.order && row.status === 'pending')
  if (!current?.approvalRowId || !input.active.instanceId) throw new LedgerPolicyError(`no pending ${input.phase} row at order ${input.order}`)
  if (current.routingMode === 'CUSTOM_PERSON') {
    const actorId = pendingCustomActorId(current)
    if (actorId !== input.expected.actorId) throw new LedgerPolicyError(`custom pending actor ${actorId} != ${input.expected.actorId}`)
    return {
      requestId: input.request.id, phase: input.phase, instanceId: input.active.instanceId, attempt: input.active.attempt,
      approvalRowId: current.approvalRowId, order: input.order, actorId, routingMode: 'CUSTOM_PERSON',
      requiredPositionId: null, candidateUserIds: [], observedStatus: input.request.status, solutionId: input.solutionId,
    }
  }
  const wanted = expectedRankStep(input.expected.profile, input.phase, input.order)
  assertRankPendingRow(current, { order: wanted.order, positionId: wanted.positionId, actorId: input.expected.actorId, candidateUserIds: wanted.candidateUserIds })
  return {
    requestId: input.request.id, phase: input.phase, instanceId: input.active.instanceId, attempt: input.active.attempt,
    approvalRowId: current.approvalRowId, order: input.order, actorId: input.expected.actorId, routingMode: 'SNAPSHOT_GROUP',
    requiredPositionId: current.requiredPositionId, candidateUserIds: current.candidateUserIds, observedStatus: input.request.status, solutionId: input.solutionId,
  }
}

export function buildRevisionBaseline(input: {
  phase: 'REQUEST' | 'SOLUTION'
  request: { id: string; status: string }
  history: ReadonlyArray<{ instanceId: string; attempt: number; supersededAt: string | null }>
  rows: readonly ObservedApprovalRow[]
  solutionId: string | null
  expectedState: 'rejected' | 'approved'
  expectedInstanceId?: string
}): RevisionBaseline {
  const prior = [...input.history].sort((a, b) => b.attempt - a.attempt)[0]
  if (!prior?.instanceId) throw new LedgerPolicyError('revision baseline has no previous instance')
  if (input.expectedInstanceId && prior.instanceId !== input.expectedInstanceId) {
    throw new LedgerPolicyError(`revision instance ${prior.instanceId} != ${input.expectedInstanceId}`)
  }
  const rows = input.rows.filter((row) => !row.instanceId || row.instanceId === prior.instanceId)
  if (rows.length === 0) throw new LedgerPolicyError('revision baseline has no rows on the previous instance')
  if (rows.some((row) => row.status === 'pending')) throw new LedgerPolicyError('revision baseline must not require a pending row')
  if (input.expectedState === 'rejected' && !rows.some((row) => row.status === 'rejected')) {
    throw new LedgerPolicyError('REQUEST/SOLUTION recovery requires a rejected row')
  }
  if (input.expectedState === 'approved' && rows.some((row) => row.status !== 'approved')) {
    throw new LedgerPolicyError('FINAL recovery prior SOLUTION rows must be approved')
  }
  return {
    requestId: input.request.id,
    phase: input.phase,
    instanceId: prior.instanceId,
    attempt: prior.attempt,
    solutionId: input.solutionId,
    observedStatus: input.request.status,
    expectedState: input.expectedState,
    rowStates: rows.map((row) => ({ order: row.order, status: row.status, approvalRowId: row.approvalRowId })),
  }
}

export async function captureRevisionBeforeResubmit(
  read: () => Promise<RevisionBaseline>,
  resubmit: (baseline: RevisionBaseline) => Promise<string>,
): Promise<string> {
  const baseline = await read()
  if (baseline.rowStates.some((row) => row.status === 'pending')) throw new LedgerPolicyError('revision action refused while a pending row remains')
  return resubmit(baseline)
}

function observedRouteSource(routingMode: string | undefined, scopeUnitId: string | null | undefined, phase: Phase, profile: RouteProfile, custom: boolean): string {
  if (custom) {
    if (routingMode !== 'CUSTOM_PERSON') throw new LedgerPolicyError('custom proof routingMode was not observed')
    return 'CUSTOM_PERSON'
  }
  if (routingMode !== 'SNAPSHOT_GROUP') throw new LedgerPolicyError('rank proof routingMode was not observed')
  const source = scopeUnitId === 'unit-company' ? 'COMPANY_DEFAULT' : 'UNIT_EXCEPTION'
  if (source !== expectedRouteSource(profile, phase)) throw new LedgerPolicyError(`route source ${source} != ${expectedRouteSource(profile, phase)}`)
  return source
}

export function buildSolutionSubmitEvidence(input: {
  request: { id: string; status: string }
  active: { instanceId: string; attempt: number }
  solutionId: string
  rows: readonly ObservedApprovalRow[]
  route: { routingMode?: string; scopeUnitId?: string | null } | null
  custom: boolean
  profile: RouteProfile
}): SolutionSubmitEvidence {
  if (input.request.status !== 'DesignCostEstimationApproval') throw new LedgerPolicyError(`observed solution status ${input.request.status}`)
  const routeSource = observedRouteSource(input.route?.routingMode, input.route?.scopeUnitId, 'SOLUTION', input.profile, input.custom)
  const classified = classifyPendingChain(input.rows, {
    routingMode: input.custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
    orderedActors: input.custom ? CUSTOM_CHAINS.SOLUTION.map(matrixActorId) : RANK_CHAINS[input.profile].SOLUTION.map(matrixActorId),
    rankSteps: input.custom ? undefined : expectedActiveRouteProof(input.profile).find((item) => item.phase === 'SOLUTION')?.steps,
  })
  return {
    requestId: input.request.id,
    solutionId: input.solutionId,
    instanceId: input.active.instanceId,
    observedInstanceId: input.active.instanceId,
    attempt: input.active.attempt,
    status: 'DesignCostEstimationApproval',
    observedStatus: input.request.status,
    routingMode: input.route?.routingMode,
    routeSource,
    observedRouteSource: routeSource,
    pendingActorIds: classified.pendingActorIds,
    pendingApprovalRows: input.rows.filter((row) => row.status === 'pending').length,
    pendingApproverIds: input.custom ? classified.customChainIds ?? [] : [],
    customChainIds: classified.customChainIds,
  }
}

export function buildFinalInitiationEvidence(input: {
  request: { id: string; status: string }
  active: { instanceId: string; attempt: number }
  rows: readonly ObservedApprovalRow[]
  route: { routingMode?: string; scopeUnitId?: string | null } | null
  custom: boolean
  profile: RouteProfile
  expectedAttempt: number
}): FinalInitiationEvidence {
  if (input.request.status !== 'FinalApproval') throw new LedgerPolicyError(`observed final status ${input.request.status}`)
  if (input.active.attempt !== input.expectedAttempt) throw new LedgerPolicyError(`final attempt ${input.active.attempt} != ${input.expectedAttempt}`)
  const routeSource = observedRouteSource(input.route?.routingMode, input.route?.scopeUnitId, 'FINAL', input.profile, input.custom)
  const classified = classifyPendingChain(input.rows, {
    routingMode: input.custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
    orderedActors: input.custom ? CUSTOM_CHAINS.FINAL.map(matrixActorId) : RANK_CHAINS[input.profile].FINAL.map(matrixActorId),
    rankSteps: input.custom ? undefined : expectedActiveRouteProof(input.profile).find((item) => item.phase === 'FINAL')?.steps,
  })
  const first = input.rows.find((row) => row.status === 'pending')
  if (!first?.approvalRowId) throw new LedgerPolicyError('final initiation produced no pending row id')
  return {
    requestId: input.request.id,
    initiationRowId: first.approvalRowId,
    instanceId: input.active.instanceId,
    observedInstanceId: input.active.instanceId,
    attempt: input.active.attempt,
    status: 'FinalApproval',
    observedStatus: input.request.status,
    pendingFinalRows: classified.pendingActorIds.length,
    pendingApproverIds: input.custom ? classified.customChainIds ?? [] : [],
    customChainIds: classified.customChainIds,
    routingMode: input.route?.routingMode,
    routeSource,
    observedRouteSource: routeSource,
    pendingActorIds: classified.pendingActorIds,
  }
}

export function proveFinalInitiation(evidence: FinalInitiationEvidence, expected: {
  requestId: string
  instanceId: string
  attempt: number
  routingMode: 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  routeSource: string
  orderedActorIds: readonly string[]
  customChainIds?: readonly string[]
}): void {
  assertFinalInitiationEvidence(evidence, {
    requestId: expected.requestId,
    instanceId: expected.instanceId,
    attempt: expected.attempt,
    customChainIds: expected.customChainIds,
  })
  assertFreshPhaseProof(JSON.stringify(evidence), {
    requestId: expected.requestId,
    attempt: expected.attempt,
    routingMode: expected.routingMode,
    routeSource: expected.routeSource,
    orderedActorIds: expected.orderedActorIds,
  })
}

export interface ScopedBusinessEvidence {
  request: { id: string; title: string; status: string }
  solution: { id: string; title?: string } | null
  instances: Array<{ id: string; phase: string; attempt: number; state: string; supersededAt: string | null }>
  approvalRows: Array<{ approvalRowId: string; phase: string; isFinalApproval: boolean; instanceId: string | null; order: number; status: string; routingMode: string; requiredApproverId: string | null; requiredPositionId: string | null; candidateUserIds: string[] }>
  candidates: Array<{ userId: string; unitId: string; positionId: string }>
  activities: Array<{ id: string; action: string; fromStatus: string | null; toStatus: string | null; userId: string; comments: string | null }>
  notifications: Array<{ id: string; type: string; userId: string; title: string }>
  unresolvedTarget: { instanceId: string; attempt: number; approvalRowId: string; phase: string } | null
}

export function assertScopedBusinessEvidence(payload: ScopedBusinessEvidence): void {
  if (!payload.request?.id || !payload.request.status || !payload.request.title) throw new LedgerPolicyError('scoped evidence missing request header')
  if (!Array.isArray(payload.instances) || !Array.isArray(payload.approvalRows) || !Array.isArray(payload.candidates)) {
    throw new LedgerPolicyError('scoped evidence missing instances, approval rows, or candidate membership')
  }
  if (!Array.isArray(payload.activities) || !Array.isArray(payload.notifications)) {
    throw new LedgerPolicyError('scoped evidence missing activities or notifications')
  }
  if (payload.solution !== null && !payload.solution?.id) throw new LedgerPolicyError('scoped evidence solution is not a row')
  const instancePhaseById = new Map(payload.instances.map((instance) => [instance.id, instance.phase]))
  for (const row of payload.approvalRows) {
    if (row.phase !== 'REQUEST' && row.phase !== 'SOLUTION' && row.phase !== 'FINAL') {
      throw new LedgerPolicyError(`scoped approval row ${row.approvalRowId} has unknown phase ${String(row.phase)}`)
    }
    if (row.phase === 'FINAL' && row.isFinalApproval !== true) {
      throw new LedgerPolicyError(`scoped FINAL approval row ${row.approvalRowId} is missing the isFinalApproval discriminator`)
    }
    if (row.phase !== 'FINAL' && row.isFinalApproval === true) {
      throw new LedgerPolicyError(`scoped ${row.phase} approval row ${row.approvalRowId} must not be marked isFinalApproval`)
    }
    if (row.instanceId) {
      const instancePhase = instancePhaseById.get(row.instanceId)
      if (instancePhase === undefined) {
        throw new LedgerPolicyError(`scoped approval row ${row.approvalRowId} references instance ${row.instanceId} absent from the scoped snapshot`)
      }
      if (instancePhase !== row.phase) {
        throw new LedgerPolicyError(`scoped approval row ${row.approvalRowId} phase ${row.phase} contradicts instance ${row.instanceId} phase ${instancePhase}`)
      }
    }
  }
}

export async function persistScopedCaseEvidence(input: {
  requestId: string
  profile: string
  caseId: string
  outcome: 'passed' | 'failed' | 'ambiguous'
  unresolvedTarget: ScopedBusinessEvidence['unresolvedTarget']
  query: (sql: string) => Promise<unknown>
  readAggregate: () => Promise<string>
  writeAggregate: (body: string) => Promise<void>
  writeCase: (body: string) => Promise<void>
  cleanup: () => Promise<void>
}): Promise<{ errors: string[]; aggregate: Record<string, unknown>; payload: unknown }> {
  const errors: string[] = []
  let payload: unknown = null
  try {
    const raw = await input.query(scopedBusinessEvidenceSql(input.requestId))
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ScopedBusinessEvidence
    parsed.unresolvedTarget = input.unresolvedTarget
    assertScopedBusinessEvidence(parsed)
    payload = parsed
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    payload = { captureError: errors[errors.length - 1], unresolvedTarget: input.unresolvedTarget }
  }
  try {
    await input.writeCase(JSON.stringify(payload))
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  let aggregate: Record<string, unknown> = {}
  try {
    const existingText = await input.readAggregate()
    let existing: Record<string, unknown> = {}
    if (existingText) {
      try {
        existing = JSON.parse(existingText) as Record<string, unknown>
      } catch (error) {
        throw new LedgerPolicyError(`all-profiles aggregate is unreadable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    aggregate = retainProfileAggregate(existing, input.profile, { caseId: input.caseId, outcome: input.outcome, requestId: input.requestId, evidence: payload })
    await input.writeAggregate(JSON.stringify(aggregate))
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  } finally {
    try {
      await input.cleanup()
    } catch (error) {
      errors.push(`cleanup failure: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { errors, aggregate, payload }
}

export interface MappedRouteInsert {
  id: string
  scopeUnitId: string
  phase: Phase
  version: number
  status: 'PUBLISHED'
  createdById: string
  approvalLimitPositionId: string
  steps: ReadonlyArray<{ stepOrder: number; positionId: string }>
}

export function mappedRouteInserts(profile: RouteProfile): MappedRouteInsert[] {
  const source = createBusinessWorkflowFixture()
  const createdById = matrixActorId(source.actors.admin.id)
  return source.routeConfigurations[profile].routes.map((route) => ({
    id: route.id,
    scopeUnitId: route.scopeUnitId,
    phase: route.phase,
    version: route.version,
    status: 'PUBLISHED' as const,
    createdById,
    approvalLimitPositionId: route.approvalLimitPositionId,
    steps: route.steps.map((step) => ({ stepOrder: step.order, positionId: step.positionId })),
  }))
}

export interface SeedApplyTx {
  insert(table: string, data: Record<string, unknown>): Promise<void>
  update(table: string, where: Record<string, unknown>, data: Record<string, unknown>): Promise<void>
}

export async function applyMappedMatrixSeed(input: {
  seedCleared: boolean
  routesConfig: RouteProfile
  mailPort: number
  password: string
  hashPassword: (plain: string) => Promise<string>
  connectedDatabase: string
  counts: { company: number; users: number; units: number; routes: number; mail: number }
  indexes: readonly string[]
  tx: SeedApplyTx
}): Promise<{ users: number; routes: number; mailHost: string; fromAddress: string }> {
  if (input.seedCleared !== true) {
    throw new LedgerPolicyError('mapped seed apply requires explicit seedCleared from a future cleared caller')
  }
  if (input.connectedDatabase !== 'app_cleanstart_dev') {
    throw new LedgerPolicyError(`seed connected to ${input.connectedDatabase}, refusing`)
  }
  const counts = [input.counts.company, input.counts.users, input.counts.units, input.counts.routes, input.counts.mail]
  if (counts.some((count) => count !== 0)) {
    throw new LedgerPolicyError('seed target is not an empty owned database')
  }
  for (const required of ['one_active_assignment_per_user', 'one_active_company_root', 'one_published_route_per_scope_phase', 'one_active_team_name_per_unit']) {
    if (!input.indexes.includes(required)) throw new LedgerPolicyError(`seed missing index ${required}`)
  }
  const passwordHash = await input.hashPassword(input.password)
  if (passwordHash.includes(input.password)) throw new LedgerPolicyError('password hash must not contain the plaintext password')
  const plan = buildIsolatedMatrixSeedPlan(passwordHash)
  for (const step of plan.steps) {
    const data = { ...step.data } as Record<string, unknown>
    if ('passwordHash' in data) data.passwordHash = passwordHash
    await input.tx.insert(step.table, data)
  }
  for (const update of plan.teamUpdates) {
    await input.tx.update('organization_assignments', { id: update.assignmentId }, { teamId: update.teamId })
  }
  const routes = mappedRouteInserts(input.routesConfig)
  for (const route of routes) {
    await input.tx.insert('approval_route_versions', {
      id: route.id,
      scopeUnitId: route.scopeUnitId,
      phase: route.phase,
      version: route.version,
      status: route.status,
      createdById: route.createdById,
      approvalLimitPositionId: route.approvalLimitPositionId,
    })
    for (const step of route.steps) {
      await input.tx.insert('approval_route_steps', { routeVersionId: route.id, stepOrder: step.stepOrder, positionId: step.positionId })
    }
  }
  await input.tx.insert('email_settings', {
    id: 'default',
    enabled: true,
    provider: 'custom',
    host: '127.0.0.1',
    port: input.mailPort,
    username: null,
    passwordEncrypted: null,
    fromAddress: 'business-workflow-test@business.test',
  })
  return { users: plan.steps.filter((step) => step.table === 'users').length, routes: routes.length, mailHost: '127.0.0.1', fromAddress: 'business-workflow-test@business.test' }
}

export function buildIsolatedMatrixSeedPlan(passwordHash: string): BusinessSeedPlan {
  const source = createBusinessWorkflowFixture()
  const plan = buildBusinessSeedPlan(source, { passwordHash })
  const actorIds = new Set(Object.values(source.actors).map((actor) => actor.id))
  return {
    steps: plan.steps.map((step) => {
      if (step.table === 'users') {
        return { ...step, data: { ...step.data, id: matrixActorId(step.data.id) } }
      }
      if (step.table === 'organization_units') {
        return {
          ...step,
          data: {
            ...step.data,
            managerUserId: step.data.managerUserId && actorIds.has(step.data.managerUserId)
              ? matrixActorId(step.data.managerUserId)
              : step.data.managerUserId,
          },
        }
      }
      if (step.table === 'organization_assignments') {
        return { ...step, data: { ...step.data, userId: matrixActorId(step.data.userId) } }
      }
      return step
    }),
    teamUpdates: plan.teamUpdates,
  }
}

export function retainProfileAggregate<T>(aggregate: Record<string, T>, profile: string, value: T): Record<string, T> {
  return { ...aggregate, [profile]: value }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Failure-only enclosure. Success leaves the opened resource with the caller.
 *  A setup failure after open captures, closes, and keeps both errors. */
export async function encloseFailedSetup<T, Opened extends { close: () => Promise<void>; capture?: () => Promise<void> }>(input: {
  open: () => Promise<Opened>
  run: (opened: Opened) => Promise<T>
}): Promise<T> {
  let opened: Opened | undefined
  try {
    opened = await input.open()
    return await input.run(opened)
  } catch (error) {
    if (!opened) throw error
    let cleanup: unknown
    try {
      await opened.capture?.()
    } catch (captureError) {
      cleanup = captureError
    }
    try {
      await opened.close()
    } catch (closeError) {
      cleanup = cleanup ? new Error(`${errorText(cleanup)}; ${errorText(closeError)}`) : closeError
    }
    if (cleanup) throw new Error(`${errorText(error)}; cleanup failure: ${errorText(cleanup)}`)
    throw error
  }
}

export function expectedScopeUnitId(profile: RouteProfile, phase: Phase): string {
  const source = fixture.routeConfigurations[profile].expectedSources[phase]
  if (source === 'UNIT_EXCEPTION') {
    return phase === 'SOLUTION' ? 'unit-engineering-section' : 'unit-production-1-section'
  }
  return 'unit-company'
}

export function expectedRouteSource(profile: RouteProfile, phase: Phase): 'COMPANY_DEFAULT' | 'UNIT_EXCEPTION' {
  return fixture.routeConfigurations[profile].expectedSources[phase]
}

export interface RouteProofStep {
  order: number
  positionId: string
  primaryActorId: string
  candidateUserIds: readonly string[]
}
export interface RouteProof {
  phase: Phase
  source: 'COMPANY_DEFAULT' | 'UNIT_EXCEPTION'
  scopeUnitId: string
  steps: readonly RouteProofStep[]
}

export function expectedActiveRouteProof(profile: RouteProfile): RouteProof[] {
  return (['REQUEST', 'SOLUTION', 'FINAL'] as const).map((phase) => {
    const source = expectedRouteSource(profile, phase)
    const scopeUnitId = expectedScopeUnitId(profile, phase)
    const config = fixture.routeConfigurations[profile]
    const route = source === 'UNIT_EXCEPTION'
      ? config.routes.find((candidate) => candidate.phase === phase && candidate.scopeUnitId === scopeUnitId)!
      : config.routes.find((candidate) => candidate.phase === phase && candidate.scopeUnitId === 'unit-company')!
    const effectiveUnit = phase === 'SOLUTION' ? 'unit-engineering-section' : 'unit-production-1-section'
    return {
      phase,
      source,
      scopeUnitId,
      steps: route.steps.map((step, index) => {
        const inScope = Object.values(fixture.actors).filter((actor) =>
          actor.isActive && actor.assignment !== null &&
          actor.assignment.unitId === effectiveUnit && actor.assignment.positionId === step.positionId,
        ).map((actor) => actor.id)
        const primary = RANK_CHAINS[profile][phase][index]
        const candidates = inScope.length > 0 ? inScope : [primary]
        return {
          order: index + 1,
          positionId: step.positionId,
          primaryActorId: matrixActorId(primary),
          candidateUserIds: candidates.map(matrixActorId),
        }
      }),
    }
  })
}

export function publishedRouteProofSql(): string {
  return assertReadOnlySingleSelect(`
    select coalesce(json_agg(row_to_json(evidence)), '[]'::json)::text from (
      select v.phase::text as phase, v."scopeUnitId" as "scopeUnitId",
        coalesce((select json_agg(json_build_object('order', st."stepOrder", 'positionId', st."positionId") order by st."stepOrder") from approval_route_steps st where st."routeVersionId" = v.id), '[]'::json) as steps
      from approval_route_versions v
      where v.status = 'PUBLISHED'
    ) evidence
  `)
}

export function activeAssignmentSql(): string {
  return evidenceJsonSql(`select "userId", "unitId", "positionId" from organization_assignments where "isActive"`)
}

export function assembleRouteProof(
  profile: RouteProfile,
  routes: ReadonlyArray<{ phase: Phase; scopeUnitId: string; steps: ReadonlyArray<{ order: number; positionId: string }> }>,
  assignments: ReadonlyArray<{ userId: string; unitId: string; positionId: string }>,
): RouteProof[] {
  return expectedActiveRouteProof(profile).map((expected) => {
    const route = routes.find((item) => item.phase === expected.phase && item.scopeUnitId === expected.scopeUnitId)
    if (!route) throw new LedgerPolicyError(`published route missing for ${profile}/${expected.phase}@${expected.scopeUnitId}`)
    const effectiveUnit = expected.phase === 'SOLUTION' ? 'unit-engineering-section' : 'unit-production-1-section'
    return {
      phase: expected.phase,
      source: route.scopeUnitId === 'unit-company' ? 'COMPANY_DEFAULT' : 'UNIT_EXCEPTION',
      scopeUnitId: route.scopeUnitId,
      steps: route.steps.map((step) => {
        const inUnit = assignments.filter((assignment) => assignment.unitId === effectiveUnit && assignment.positionId === step.positionId).map((assignment) => assignment.userId)
        const byPosition = assignments.filter((assignment) => assignment.positionId === step.positionId).map((assignment) => assignment.userId)
        const candidates = inUnit.length > 0 ? inUnit : byPosition
        const primary = expected.steps.find((item) => item.order === step.order)?.primaryActorId
        if (!primary) throw new LedgerPolicyError(`route step ${step.order} has no fixture primary`)
        if (!candidates.includes(primary)) throw new LedgerPolicyError(`primary ${primary} is not an active candidate at ${step.positionId}`)
        return {
          order: step.order,
          positionId: step.positionId,
          primaryActorId: primary,
          candidateUserIds: candidates,
        }
      }),
    }
  })
}

export function assertRouteProof(profile: RouteProfile, actual: readonly RouteProof[]): void {
  const expected = expectedActiveRouteProof(profile)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new LedgerPolicyError(`published route proof does not match fixture source/order/positions/candidates for ${profile}`)
  }
}

/** Live co-candidate confirmation is required later and is not a pass now. */
export const LIVE_CO_CANDIDATE_VERIFICATION = 'required-at-case-start-not-passed' as const

// ---------------------------------------------------------------------------
// psql -t -A adapter. The native helper returns pipe-separated text, and a
// multi-statement wrapper can prefix command tags. Evidence statements must
// be one JSON-producing SELECT; this parser fails closed on pipe text.
// ---------------------------------------------------------------------------

const PSQL_COMMAND_TAG = /^(START TRANSACTION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT|PREPARE TRANSACTION|SET)(\s.*)?$/i

export function parsePsqlJsonDocument(raw: string): unknown {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '' && !PSQL_COMMAND_TAG.test(line))
  if (lines.length !== 1) {
    throw new LedgerPolicyError(`psql JSON payload must be exactly one cell after stripping transaction tags, got ${lines.length}: ${lines[0]?.slice(0, 48) ?? ''}`)
  }
  const cell = lines[0]
  if (!cell.startsWith('{') && !cell.startsWith('[')) {
    throw new LedgerPolicyError(`psql output is not JSON: ${cell.slice(0, 48)}`)
  }
  try {
    return JSON.parse(cell)
  } catch (error) {
    throw new LedgerPolicyError(`psql output is not JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const READ_ONLY_FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|commit|rollback|begin|start|copy|call|do|set|vacuum|reindex|cluster|discard|prepare|execute|deallocate|listen|notify|load|refresh|lock)\b/i

/** Single SELECT/WITH only. Semicolons, comments, and write/transaction
 *  keywords are refused before any connection is used. */
export function assertReadOnlySingleSelect(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  if (trimmed.includes(';')) throw new LedgerPolicyError('queryReadOnly: multiple statements are not allowed')
  if (trimmed.includes('--') || trimmed.includes('/*') || trimmed.includes('*/')) {
    throw new LedgerPolicyError('queryReadOnly: comments are not allowed')
  }
  if (!/^(select|with)\b/i.test(trimmed)) throw new LedgerPolicyError('queryReadOnly: only a single SELECT is allowed')
  if (READ_ONLY_FORBIDDEN.test(trimmed)) throw new LedgerPolicyError(`queryReadOnly: write/transaction keyword refused: ${trimmed.slice(0, 60)}`)
  if (/\binto\b/i.test(trimmed)) throw new LedgerPolicyError('queryReadOnly: SELECT INTO is not a read')
  return trimmed
}

export function sqlText(value: string): string {
  if (value.length === 0 || value.length > 400 || /['"\\;]|--|\/\*/.test(value)) {
    throw new LedgerPolicyError('refusing unsafe SQL literal')
  }
  return `'${value}'`
}

export function evidenceJsonSql(innerSelect: string): string {
  const inner = innerSelect.trim().replace(/;+\s*$/, '')
  if (inner.includes(';')) throw new LedgerPolicyError('evidence SQL inner select must be one statement')
  return assertReadOnlySingleSelect(
    `select coalesce(json_agg(row_to_json(evidence)), '[]'::json)::text from (${inner}) evidence`,
  )
}

export function activeInstanceSql(phase: Phase, requestId: string): string {
  const phaseSql = sqlText(phase)
  const requestSql = sqlText(requestId)
  return evidenceJsonSql(`
    select i.id as "instanceId", i.attempt, i.phase::text as phase,
           i."routingMode"::text as "routingMode", i."routeVersionId", i.state::text as state,
           i."supersededAt", coalesce(i."requestId", s."requestId") as "requestId", i."solutionId"
    from approval_instances i
    left join solutions s on s.id = i."solutionId"
    where i.phase = ${phaseSql}
      and i."supersededAt" is null
      and coalesce(i."requestId", s."requestId") = ${requestSql}
    order by i.attempt desc
    limit 1
  `)
}

export function approvalRowSql(input: {
  phase: Phase
  requestId: string
  instanceId: string
  attempt: number
  stepOrder: number
  actor: string
  status: 'approved' | 'rejected'
  rowId?: string
}): string {
  if (!Number.isInteger(input.attempt) || !Number.isInteger(input.stepOrder)) {
    throw new LedgerPolicyError('approval evidence SQL requires integer attempt and order')
  }
  const requestSql = sqlText(input.requestId)
  const instanceSql = sqlText(input.instanceId)
  const actorSql = sqlText(input.actor)
  const phaseSql = sqlText(input.phase)
  const statusSql = sqlText(input.status)
  if (input.phase === 'SOLUTION') {
    return evidenceJsonSql(`
      select t.id as "approvalRowId", t."instanceId", t."order", t."approverId" as actor,
             t.status::text as status, t.comments as reason, t."requiredApproverId",
             i.attempt, i.phase::text as phase, s."requestId" as "requestId"
      from solution_approvals t
      join approval_instances i on i.id = t."instanceId"
      join solutions s on s.id = t."solutionId"
      where t."instanceId" = ${instanceSql}
        and i.attempt = ${input.attempt}
        and i.phase = ${phaseSql}
        and i."supersededAt" is null
        and s."requestId" = ${requestSql}
        and t."order" = ${input.stepOrder}
        and t.status = ${statusSql}
        and t."approverId" = ${actorSql}
        ${input.rowId ? `and t.id = ${sqlText(input.rowId)}` : ''}
    `)
  }
  const finalFlag = input.phase === 'FINAL' ? 'true' : 'false'
  return evidenceJsonSql(`
    select t.id as "approvalRowId", t."instanceId", t."order", t."approverId" as actor,
           t.status::text as status, t.comments as reason, t."requiredApproverId",
           t."isFinalApproval", i.attempt, i.phase::text as phase, t."requestId" as "requestId"
    from request_approvals t
    join approval_instances i on i.id = t."instanceId"
    where t."instanceId" = ${instanceSql}
      and i.attempt = ${input.attempt}
      and i.phase = ${phaseSql}
      and i."supersededAt" is null
      and t."requestId" = ${requestSql}
      and t."isFinalApproval" = ${finalFlag}
      and t."order" = ${input.stepOrder}
      and t.status = ${statusSql}
      and t."approverId" = ${actorSql}
      ${input.rowId ? `and t.id = ${sqlText(input.rowId)}` : ''}
  `)
}

export function pendingChainSql(phase: Phase, instanceId: string): string {
  const instanceSql = sqlText(instanceId)
  if (phase === 'SOLUTION') {
    return evidenceJsonSql(`
      select t.id as "approvalRowId", t."order", t."requiredApproverId", t."approverId", t."requiredPositionId", t."routingMode"::text as "routingMode",
             t.status::text as status,
             coalesce((select json_agg(m."userId" order by m."userId") from approval_candidate_group_members m where m."candidateGroupId" = t."candidateGroupId"), '[]'::json) as "candidateUserIds"
      from solution_approvals t
      where t."instanceId" = ${instanceSql}
      order by t."order"
    `)
  }
  const finalFlag = phase === 'FINAL' ? 'true' : 'false'
  return evidenceJsonSql(`
    select t.id as "approvalRowId", t."order", t."requiredApproverId", t."approverId", t."requiredPositionId", t."routingMode"::text as "routingMode",
           t.status::text as status, t."isFinalApproval",
           coalesce((select json_agg(m."userId" order by m."userId") from approval_candidate_group_members m where m."candidateGroupId" = t."candidateGroupId"), '[]'::json) as "candidateUserIds"
    from request_approvals t
    where t."instanceId" = ${instanceSql} and t."isFinalApproval" = ${finalFlag}
    order by t."order"
  `)
}

export function terminalSnapshotSql(requestId: string): string {
  const requestSql = sqlText(requestId)
  return assertReadOnlySingleSelect(`
    select json_build_object(
      'requestId', r.id,
      'status', r.status::text,
      'requestPendingRows', (select count(*) from request_approvals t where t."requestId" = r.id and t."isFinalApproval" = false and t.status = 'pending'),
      'solutionPendingRows', (select count(*) from solution_approvals sa join solutions s on s.id = sa."solutionId" where s."requestId" = r.id and sa.status = 'pending'),
      'finalPendingRows', (select count(*) from request_approvals t where t."requestId" = r.id and t."isFinalApproval" = true and t.status = 'pending'),
      'instances', coalesce((select json_agg(json_build_object('id', i.id, 'phase', i.phase::text, 'attempt', i.attempt, 'state', i.state::text, 'supersededAt', i."supersededAt") order by i.phase, i.attempt) from approval_instances i left join solutions s on s.id = i."solutionId" where coalesce(i."requestId", s."requestId") = r.id), '[]'::json),
      'activities', coalesce((select json_agg(json_build_object('id', a.id, 'action', a.action, 'fromStatus', a."fromStatus"::text, 'toStatus', a."toStatus"::text, 'userId', a."userId", 'comments', a.comments) order by a."createdAt", a.id) from request_activities a where a."requestId" = r.id), '[]'::json),
      'notifications', coalesce((select json_agg(json_build_object('id', n.id, 'type', n.type::text, 'userId', n."userId", 'title', n.title) order by n."createdAt", n.id) from notifications n where n."requestId" = r.id), '[]'::json)
    )::text
    from requests r
    where r.id = ${requestSql}
  `)
}

export function scopedBusinessEvidenceSql(requestId: string): string {
  const id = sqlText(requestId)
  return assertReadOnlySingleSelect(`
    select json_build_object(
      'request', (select json_build_object('id', r.id, 'title', r.title, 'status', r.status::text) from requests r where r.id = ${id}),
      'solution', (select json_build_object('id', s.id, 'title', s.title) from solutions s where s."requestId" = ${id} order by s."submittedAt" desc limit 1),
      'instances', coalesce((select json_agg(json_build_object('id', i.id, 'phase', i.phase::text, 'attempt', i.attempt, 'state', i.state::text, 'supersededAt', i."supersededAt") order by i.attempt) from approval_instances i left join solutions s on s.id = i."solutionId" where coalesce(i."requestId", s."requestId") = ${id}), '[]'::json),
      'approvalRows', coalesce((select json_agg(row_to_json(rows)) from (
        select t.id as "approvalRowId", (case when t."isFinalApproval" then 'FINAL' else 'REQUEST' end)::text as phase, t."isFinalApproval", t."instanceId", t."order", t.status::text as status, t."routingMode"::text as "routingMode", t."requiredApproverId", t."requiredPositionId",
          coalesce((select json_agg(m."userId" order by m."userId") from approval_candidate_group_members m where m."candidateGroupId" = t."candidateGroupId"), '[]'::json) as "candidateUserIds"
        from request_approvals t where t."requestId" = ${id}
        union all
        select t.id, 'SOLUTION'::text, false, t."instanceId", t."order", t.status::text, t."routingMode"::text, t."requiredApproverId", t."requiredPositionId",
          coalesce((select json_agg(m."userId" order by m."userId") from approval_candidate_group_members m where m."candidateGroupId" = t."candidateGroupId"), '[]'::json)
        from solution_approvals t join solutions s on s.id = t."solutionId" where s."requestId" = ${id}
      ) rows), '[]'::json),
      'candidates', coalesce((select json_agg(json_build_object('userId', a."userId", 'unitId', a."unitId", 'positionId', a."positionId")) from organization_assignments a where a."isActive"), '[]'::json),
      'activities', coalesce((select json_agg(json_build_object('id', a.id, 'action', a.action, 'fromStatus', a."fromStatus"::text, 'toStatus', a."toStatus"::text, 'userId', a."userId", 'comments', a.comments) order by a."createdAt", a.id) from request_activities a where a."requestId" = ${id}), '[]'::json),
      'notifications', coalesce((select json_agg(json_build_object('id', n.id, 'type', n.type::text, 'userId', n."userId", 'title', n.title) order by n."createdAt", n.id) from notifications n where n."requestId" = ${id}), '[]'::json)
    )::text
  `)
}

export function requestByTitleSql(title: string): string {
  return evidenceJsonSql(`select id, status::text as status, title from requests where title = ${sqlText(title)} limit 1`)
}

export function phaseHistorySql(phase: Phase, requestId: string): string {
  const phaseSql = sqlText(phase)
  const requestSql = sqlText(requestId)
  return evidenceJsonSql(`
    select i.id as "instanceId", i.attempt, i."supersededAt", i.phase::text as phase
    from approval_instances i
    left join solutions s on s.id = i."solutionId"
    where i.phase = ${phaseSql}
      and coalesce(i."requestId", s."requestId") = ${requestSql}
    order by i.attempt
  `)
}

export function latestSolutionSql(requestId: string): string {
  return evidenceJsonSql(`select id from solutions where "requestId" = ${sqlText(requestId)} order by "submittedAt" desc limit 1`)
}

export function instanceRouteSql(instanceId: string): string {
  return evidenceJsonSql(`
    select i."routingMode"::text as "routingMode", v."scopeUnitId" as "scopeUnitId"
    from approval_instances i
    left join approval_route_versions v on v.id = i."routeVersionId"
    where i.id = ${sqlText(instanceId)}
  `)
}

export async function finalizeTraceArtifact(input: {
  stop: () => Promise<void>
  exists: () => Promise<boolean>
  tracePath: string
  index: string[]
}): Promise<void> {
  try {
    await input.stop()
  } catch (error) {
    throw new LedgerPolicyError(`trace save failed: ${input.tracePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!(await input.exists())) {
    throw new LedgerPolicyError(`trace indexed only after it exists: ${input.tracePath}`)
  }
  input.index.push(input.tracePath)
}

