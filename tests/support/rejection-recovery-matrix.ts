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
  /** Exactly one click, then a bounded wait for denial or success. The Task4
   *  strict producer additionally returns the dispatched action evidence for
   *  the deny-stale attempt (capture.begin BEFORE the single click, capture
   *  finish with the exact handler/result, journal-backed ServerProof). It is
   *  optional only so the byte-frozen legacy compatibility fakes keep their
   *  exact shape; strict producers must always supply it and runMatrixCase
   *  builds the correlated immutable stale pair from it. */
  staleConfirm(): Promise<{ outcome: 'denied' | 'succeeded' | 'unavailable' | 'unknown'; evidence: string; actionEvidence?: ActionEvidence }>
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
  /** Task4 immediate negative/correlation hooks. Optional members so the
   *  byte-frozen legacy compatibility fakes stay assignable: the strict
   *  runMatrixCase stale gate activates only when the full business snapshot
   *  producer and immutable negative writer are present. Real driver M
   *  implements all three against the same canonical snapshot writer. */
  readBusinessSnapshot?(row: MatrixRow, title: string): Promise<BusinessSnapshot>
  writeNegativeSnapshot?(id: string, edge: 'before' | 'after' | 'pair', value: BusinessSnapshot | NegativePair): Promise<ArtifactRef>
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
      // Task4 immediate pair: the BEFORE business snapshot and its immutable
      // write complete BEFORE the confirm-availability assertion and the one
      // confirm click. A delayed/rejected BEFORE write means zero confirm
      // clicks; the stale window can never be accepted without it.
      const strictPair = typeof ui.readBusinessSnapshot === 'function' && typeof ui.writeNegativeSnapshot === 'function'
      const before = strictPair ? await ui.readBusinessSnapshot!(row, title) : null
      const beforeArtifact = strictPair ? await ui.writeNegativeSnapshot!(staleCheck.id, 'before', before as BusinessSnapshot) : null
      const available = await held.confirmAvailable()
      if (!available) {
        staleNegative = 'stale-window-unavailable'
        await journal('stale confirm unavailable; no click; not a passed denial')
      } else {
      const beforeTerminal = strictPair ? before!.terminal : await ui.readTerminalSnapshot(row, title)
      if (!beforeTerminal) {
        throw new LedgerPolicyError(`${row.id}: immediate BEFORE business snapshot is missing terminal evidence; the stale window cannot be entered`)
      }
      if (beforeTerminal.status !== 'Completed' || beforeTerminal.requestPendingRows !== 0 || beforeTerminal.solutionPendingRows !== 0 || beforeTerminal.finalPendingRows !== 0) {
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
      await journal(`before exactly one stale confirm click; snapshot ${stable(beforeTerminal)}`)
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
      // Fresh AFTER capture and immutable write, then the full gate: explicit
      // terminal comparison plus complete business-snapshot equality with the
      // dispatched deny-stale action evidence correlated (Finding 6). Toast
      // text alone is no longer denial proof.
      const after = strictPair ? await ui.readBusinessSnapshot!(row, title) : null
      const afterArtifact = strictPair ? await ui.writeNegativeSnapshot!(staleCheck.id, 'after', after as BusinessSnapshot) : null
      const afterTerminal = strictPair ? after!.terminal : await ui.readTerminalSnapshot(row, title)
      if (!afterTerminal) {
        throw new LedgerPolicyError(`${row.id}: fresh AFTER business snapshot is missing terminal evidence; null is missing proof, not an unchanged denial`)
      }
      assertSnapshotsEqual(beforeTerminal, afterTerminal)
      if (strictPair) {
        if (!outcome.actionEvidence) {
          throw new LedgerPolicyError(`${row.id}: strict snapshot producer present but the held stale confirm returned no dispatched action evidence; toast-only denial is not proof`)
        }
        const actionEvidence = outcome.actionEvidence
        actionEvidence.before = before as BusinessSnapshot
        actionEvidence.after = after as BusinessSnapshot
        actionEvidence.beforeArtifact = beforeArtifact as ArtifactRef
        actionEvidence.afterArtifact = afterArtifact as ArtifactRef
        const pair: NegativePair = {
          id: staleCheck.id,
          kind: 'stale',
          before: before as BusinessSnapshot,
          after: after as BusinessSnapshot,
          beforeArtifact: beforeArtifact as ArtifactRef,
          afterArtifact: afterArtifact as ArtifactRef,
          action: actionEvidence,
        }
        await ui.writeNegativeSnapshot!(staleCheck.id, 'pair', pair)
        assertNegativePair(pair)
      }
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

/** The persisted candidate group id of one pending row, for the strict
 *  DecisionTarget. Real relation, never an invented column. */
export function candidateGroupIdSql(phase: Phase, instanceId: string, order: number): string {
  if (!Number.isInteger(order) || (order as number) < 1) throw new LedgerPolicyError('candidate group SQL requires an integer order')
  const instanceSql = sqlText(instanceId)
  const table = phase === 'SOLUTION' ? 'solution_approvals' : 'request_approvals'
  return evidenceJsonSql(`
    select t."candidateGroupId" as "candidateGroupId"
    from ${table} t
    where t."instanceId" = ${instanceSql} and t."order" = ${Number(order)}
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


// ============================================================================
// Strict-assurance shared contracts (revision-3 plan, Task 1).
// Pure registry/evaluator surface only: no runtime, browser, DB or product
// imports. RunBinding is defined here (plan assigns its text to Task 5's
// final state, also in S) because ActionIdentity extends it below.
// ============================================================================

// Approved pure validation dependency: no handler/Prisma/auth initialization.
import { z } from 'zod'
import { descriptionSchema, submitSolutionSchema, resubmitSolutionSchema } from '../../src/lib/schemas/solution-schemas'
import { MAX_ATTACHMENTS_PER_FORM } from '../../src/lib/attachments/policy'

export type HandlerKey =
  | 'requests.createRequest' | 'requests.resubmitRequest'
  | 'approvals.approveRequest' | 'approvals.rejectRequest'
  | 'solutions.submitSolution' | 'solutions.resubmitSolution'
  | 'solutions.approveSolution' | 'solutions.rejectSolution'
  | 'solutions.initiateFinalApproval'
  | 'solutions.approveFinalApproval' | 'solutions.rejectFinalApproval'

export type JsonValue = null | boolean | number | string | JsonValue[]
  | { [key: string]: JsonValue }

export interface ArtifactRef { path: string; sha256: string; bytes: number }

/** Legacy optional V2 raw sample (clock-v3 lane A): old low-level/legacy
 *  callers keep the three-field shape and never inspect the extra field;
 *  fresh clock proofs require the rrm-clock-sample-v2 sample on new marks. */
export interface ClockMark { domain: string; monotonicMs: number; wallMs: number; clockSample?: ClockSampleV3 }

export type SourceMode = 'strict-assurance' | 'historical-legacy'

export interface RunBinding {
  pass: 1 | 2
  invocation: number
  invocationId: string
  profile: RouteProfile
  runId: string
  sourceMode: SourceMode
  evidenceRoot: string
  clearanceManifest: ArtifactRef
  runtimeManifest: ArtifactRef
}

export interface ActionIdentity extends RunBinding {
  caseId: string
  contextId: string
  sequence: number
}

export interface ExpectedApprovalStep {
  /** Intended primary, distinct from complete unordered rank membership. */
  primaryActorId: string
  order: number
  requiredPositionId: string | null
  requiredApproverId: string | null
  candidateUserIds: readonly string[]
}

export interface RowlessTarget {
  /** Immutable intended route, including complete membership, not a count or
   *  a handler return. Later snapshot/capture producers must supply it. */
  routingMode: 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
  expectedSteps: readonly ExpectedApprovalStep[]
  customApproverIds?: readonly string[]
  requestId: string | null
  solutionId: string | null
  phase: Phase
  previous: RevisionBaseline | null
  expectedAttempt: number
  expectedChain: readonly string[]
  titleSha256: string
}

export interface DecisionTarget extends ActionBaseline {
  candidateGroupId: string | null
  currentOrder: number
}

export type ActionSpec =
  | { kind: 'create'; handler: HandlerKey; target: RowlessTarget }
  | { kind: 'submit-solution'; handler: HandlerKey; target: RowlessTarget }
  | { kind: 'initiate-final'; handler: HandlerKey; target: RowlessTarget }
  | { kind: 'resubmit'; handler: HandlerKey; target: RowlessTarget }
  | { kind: 'approve' | 'reject'; handler: HandlerKey; target: DecisionTarget }
  | { kind: 'deny-stale'; handler: HandlerKey; target: DecisionTarget; current: TerminalSnapshot }

export interface ActionRecord {
  identity: ActionIdentity
  spec: ActionSpec
  intendedActor: string
  argumentProjection: JsonValue
  stage: 'attempting' | 'resolved'
  start: ClockMark
}

export interface BusinessSnapshot {
  terminal: TerminalSnapshot | null
  request: JsonValue
  solutions: readonly JsonValue[]
  instances: readonly JsonValue[]
  approvalRows: readonly JsonValue[]
  groups: readonly JsonValue[]
  activities: readonly JsonValue[]
  notifications: readonly JsonValue[]
  mail: readonly JsonValue[]
}

export type PhaseProof = RequestCreateEvidence | SolutionSubmitEvidence
  | ApprovalEvidence | RejectionEvidence | ResubmitEvidence | FinalInitiationEvidence

export type LifecycleOutcome =
  | 'OBSERVER_FAILED_BEFORE_INVOCATION'
  | 'QUEUED_OR_UNOBSERVED_DISPATCH'
  | 'DISPATCHED_RESPONSE_ABSENT'
  | 'DENIED_UNCHANGED'
  | 'THROWN_NONCOMMITTING'
  | 'RETURNED_NONCOMMITTING'
  | 'COMMITTED_AND_UI_CONFIRMED'
  | 'COMMITTED_BUT_UI_FAILED'
  | 'EVIDENCE_FAILURE'

export interface BuildBinding {
  actionId: string
  handler: HandlerKey
  chunk: ArtifactRef
  byteOffset: number
  generatedSourceSha256: string
  contextId: string
}

export type FlightResult =
  | { state: 'returned'; projection: JsonValue }
  | { state: 'thrown'; code: string; digest: string | null }
  | { state: 'missing' | 'incomplete' | 'unsupported'; reason: string }

export interface DispatchProof {
  identity: ActionIdentity
  actionId: string
  argumentProjection: JsonValue
  start: ClockMark
  end: ClockMark | null
  status: number | null
  body: ArtifactRef | null
  result: FlightResult
}

export interface ServerProof {
  invocationId: string
  handler: HandlerKey
  argumentProjection: JsonValue
  actorId: string | null
  authObserved: boolean
  originalInvoked: boolean
  start: ClockMark
  end: ClockMark | null
  transaction: 'not-started' | 'resolved' | 'rejected' | 'unknown'
  exit: FlightResult
  observerErrors: readonly string[]
  sourceSha256: string
  /** Same-invocation observation of prepareInlineDescription, NOT a handler
   * return. Its trusted production remains a later observer/capture gate. */
  preparedDescription?: { inputSha256: string; htmlSha256: string; uploadSessionId: string }
}

export interface ActionEvidence {
  record: ActionRecord
  binding: BuildBinding | null
  dispatch: DispatchProof | null
  server: ServerProof | null
  before: BusinessSnapshot | null
  after: BusinessSnapshot | null
  beforeArtifact: ArtifactRef | null
  afterArtifact: ArtifactRef | null
  phaseProof: PhaseProof | null
  uiConfirmed: boolean
  /** Pure supplied calibration: to.monotonic = from.monotonic + offsetMs
   *  +/- uncertaintyMs. Numeric robust containment is mandatory; verified
   *  alone proves nothing. The later live producer remains unimplemented. */
  clockCalibration?: {
    fromDomain: string
    toDomain: string
    offsetMs: number
    uncertaintyMs: number
    verified: true
  }
}

export interface ActionEvaluation {
  outcome: LifecycleOutcome
  gaps: readonly string[]
  commitProven: boolean
  evidenceValid: boolean
  expectedSatisfied: boolean
}

export interface NegativePair {
  id: string
  kind: 'stale' | 'blank-reason' | 'unauthorized-viewer'
  before: BusinessSnapshot
  after: BusinessSnapshot
  beforeArtifact: ArtifactRef
  afterArtifact: ArtifactRef
  /** Mandatory for stale; absent for UI-only checks. */
  action: ActionEvidence | null
}

/** The exact eleven real server exports, with the kind/phase that must use
 *  each. Source module/export identities, never wire fingerprints. */
export const MATRIX_ACTION_REGISTRY: readonly {
  handler: HandlerKey
  module: string
  exportName: string
  kind: ActionSpec['kind'] | 'approve' | 'reject'
  phase: Phase | null
}[] = [
  { handler: 'requests.createRequest', module: 'requests', exportName: 'createRequest', kind: 'create', phase: null },
  { handler: 'requests.resubmitRequest', module: 'requests', exportName: 'resubmitRequest', kind: 'resubmit', phase: 'REQUEST' },
  { handler: 'approvals.approveRequest', module: 'approvals', exportName: 'approveRequest', kind: 'approve', phase: 'REQUEST' },
  { handler: 'approvals.rejectRequest', module: 'approvals', exportName: 'rejectRequest', kind: 'reject', phase: 'REQUEST' },
  { handler: 'solutions.submitSolution', module: 'solutions', exportName: 'submitSolution', kind: 'submit-solution', phase: null },
  { handler: 'solutions.resubmitSolution', module: 'solutions', exportName: 'resubmitSolution', kind: 'resubmit', phase: 'SOLUTION' },
  { handler: 'solutions.approveSolution', module: 'solutions', exportName: 'approveSolution', kind: 'approve', phase: 'SOLUTION' },
  { handler: 'solutions.rejectSolution', module: 'solutions', exportName: 'rejectSolution', kind: 'reject', phase: 'SOLUTION' },
  { handler: 'solutions.initiateFinalApproval', module: 'solutions', exportName: 'initiateFinalApproval', kind: 'initiate-final', phase: null },
  { handler: 'solutions.approveFinalApproval', module: 'solutions', exportName: 'approveFinalApproval', kind: 'approve', phase: 'FINAL' },
  { handler: 'solutions.rejectFinalApproval', module: 'solutions', exportName: 'rejectFinalApproval', kind: 'reject', phase: 'FINAL' },
]

/** Exact registry member for a spec's kind/phase. No any-member acceptance.
 *  deny-stale aliases the reject/FINAL export — the same real server export
 *  invoked by the held stale confirm. Rowless kinds are phase-discriminated by
 *  their real workflow position: create=REQUEST, submit-solution=SOLUTION,
 *  initiate-final=FINAL (revision-3 plan registry table). */
export function expectedHandlerFor(spec: ActionSpec): HandlerKey {
  const lookupKind = spec.kind === 'deny-stale' ? 'reject' as const : spec.kind
  const rowlessPhase: Phase | null = spec.kind === 'create' ? 'REQUEST'
    : spec.kind === 'submit-solution' ? 'SOLUTION'
    : spec.kind === 'initiate-final' ? 'FINAL'
    : null
  if (rowlessPhase !== null && spec.target.phase !== rowlessPhase) {
    throw new LedgerPolicyError(`rowless kind ${spec.kind} requires phase ${rowlessPhase}, got ${spec.target.phase}`)
  }
  const exact = MATRIX_ACTION_REGISTRY.filter((entry) => {
    if (entry.kind !== lookupKind) return false
    if (spec.kind === 'approve' || spec.kind === 'reject' || spec.kind === 'deny-stale') {
      const phase = spec.kind === 'deny-stale' ? 'FINAL' : spec.target.phase
      return entry.phase === phase
    }
    if (spec.kind === 'resubmit') return entry.phase === spec.target.phase
    return entry.phase === null && rowlessPhase !== null
  })
  if (exact.length !== 1) {
    throw new LedgerPolicyError(`action registry has no exact member for kind ${spec.kind}${rowlessPhase ? `/${rowlessPhase}` : ''}`)
  }
  return exact[0].handler
}

// --- Task 1 evaluator: discriminated, fail-closed action evidence gate ---

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonId(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function snapshotRequestId(snapshot: BusinessSnapshot): string | null {
  return isJsonObject(snapshot.request) ? jsonId(snapshot.request.id) : null
}

function snapshotArraysComplete(snapshot: BusinessSnapshot): boolean {
  return snapshot.solutions instanceof Array && snapshot.instances instanceof Array
    && snapshot.approvalRows instanceof Array && snapshot.groups instanceof Array
    && snapshot.activities instanceof Array && snapshot.notifications instanceof Array
    && snapshot.mail instanceof Array
}

/** Canonical form: existing stable() ordering, so equality and serialization
 *  cannot drift apart. */
export function serializeBusinessSnapshot(input: BusinessSnapshot): string {
  if (!snapshotArraysComplete(input)) {
    throw new LedgerPolicyError('business snapshot is missing required array evidence')
  }
  return stable(input)
}

function artifactRefValid(ref: ArtifactRef | null | undefined): boolean {
  return !!ref && typeof ref.path === 'string' && ref.path.trim() !== ''
    && typeof ref.sha256 === 'string' && /^[0-9a-f]{64}$/.test(ref.sha256)
    && Number.isInteger(ref.bytes) && ref.bytes > 0
}

function validateIdentity(identity: ActionIdentity, gaps: string[]): boolean {
  let ok = true
  const fail = (gap: string): void => { gaps.push(gap); ok = false }
  if (!identity.caseId?.trim()) fail('identity-case')
  if (!identity.contextId?.trim()) fail('identity-context')
  if (!Number.isInteger(identity.sequence) || identity.sequence < 1) fail('identity-sequence')
  if (!identity.runId?.trim()) fail('identity-run')
  if (!identity.invocationId?.trim()) fail('identity-invocation')
  if (!Number.isInteger(identity.invocation) || identity.invocation < 1) fail('identity-invocation-slot')
  if (identity.pass !== 1 && identity.pass !== 2) fail('identity-pass')
  if (!PROFILE_ORDER.includes(identity.profile)) fail('identity-profile')
  if (identity.sourceMode !== 'strict-assurance') fail('identity-source-mode')
  if (!identity.evidenceRoot?.trim()) fail('identity-evidence-root')
  if (!artifactRefValid(identity.clearanceManifest)) fail('identity-clearance-manifest')
  if (!artifactRefValid(identity.runtimeManifest)) fail('identity-runtime-manifest')
  return ok
}

// Source contracts: Prisma schema; approvals/requests/solutions actions; the
// transaction adapter and notification-recipient mapping. No product imports.
const SOURCE_NOTIFICATION_TYPES = ['approval_needed', 'approval_granted', 'approval_rejected', 'status_changed', 'request_assigned', 'solution_ready', 'final_approval_needed']
const INSTANCE_STATES = ['PENDING', 'AUTO_APPROVED', 'COMPLETED_NO_ELIGIBLE_STEPS', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED']
const PHASE_STATUS: Record<Phase, string> = { REQUEST: 'ImprovementRequest', SOLUTION: 'DesignCostEstimationApproval', FINAL: 'FinalApproval' }
const APPROVED_STATUS: Record<Phase, string> = { REQUEST: 'SentToEngineer', SOLUTION: 'SendBackToRequester', FINAL: 'Completed' }
const DECISION_AUDIT_ACTION: Record<Phase, { approve: string; reject: string }> = {
  REQUEST: { approve: 'approved', reject: 'rejected' },
  SOLUTION: { approve: 'solution_approved', reject: 'solution_rejected' },
  FINAL: { approve: 'final_approval_approved', reject: 'final_approval_rejected' },
}
const STALE_ELIGIBILITY_THROWN_CODE = 'You cannot reject this request at this time'

type JsonRecord = Record<string, unknown>
function isJsonObjectRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function is64Hex(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) }
function stringField(record: unknown, key: string): string | null {
  const v = isJsonObjectRecord(record) ? record[key] : null
  return typeof v === 'string' && v.trim() ? v : null
}
function numberField(record: unknown, key: string): number | null {
  const v = isJsonObjectRecord(record) ? record[key] : null
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function arrayField(snapshot: BusinessSnapshot, key: 'solutions' | 'instances' | 'approvalRows' | 'groups' | 'activities' | 'notifications' | 'mail'): readonly JsonRecord[] {
  return snapshot[key].filter(isJsonObjectRecord) as JsonRecord[]
}
function instanceById(snapshot: BusinessSnapshot, id: string): JsonRecord | null {
  return arrayField(snapshot, 'instances').find(i => i.id === id) ?? null
}
function findRow(rows: readonly JsonRecord[], id: string): JsonRecord | null { return rows.find(r => r.id === id) ?? null }
function requestStatus(s: BusinessSnapshot): string | null { return stringField(s.request, 'status') }
function same(a: unknown, b: unknown): boolean { return stable(a) === stable(b) }
function membersFor(s: BusinessSnapshot, row: JsonRecord): string[] {
  if (row.routingMode === 'CUSTOM_PERSON') return typeof row.requiredApproverId === 'string' ? [row.requiredApproverId] : []
  const g = arrayField(s, 'groups').find(g => g.id === row.candidateGroupId)
  return g && Array.isArray(g.members) ? g.members.map(m => stringField(m, 'userId')).filter((x): x is string => x !== null).sort() : []
}
function currentRows(s: BusinessSnapshot, phase: Phase): JsonRecord[] {
  return arrayField(s, 'approvalRows').filter(row => {
    const i = instanceById(s, String(row.instanceId))
    return i?.phase === phase && i.supersededAt === null
  }).sort((a, b) => Number(a.order) - Number(b.order))
}
function terminalBusiness(s: BusinessSnapshot): unknown {
  return {
    requestId: snapshotRequestId(s), status: requestStatus(s),
    requestPendingRows: currentRows(s, 'REQUEST').filter(r => r.status === 'pending').length,
    solutionPendingRows: currentRows(s, 'SOLUTION').filter(r => r.status === 'pending').length,
    finalPendingRows: currentRows(s, 'FINAL').filter(r => r.status === 'pending').length,
    instances: arrayField(s, 'instances').map(i => ({ id: i.id, phase: i.phase, attempt: i.attempt, state: i.state, supersededAt: i.supersededAt })),
  }
}
function without(o: JsonRecord, keys: string[]): JsonRecord { return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) }

/** Full-row JSON plus an explicit table discriminant. Phase/attempt/request are
 * resolved through real relations, never invented columns on approval rows. */
function validateBusinessSnapshot(s: BusinessSnapshot, side: string, gaps: string[]): boolean {
  const start = gaps.length
  const fail = (field: string): void => { gaps.push(`snapshot:${side}:${field}`) }
  const required = (o: unknown, fields: string[], label: string): void => {
    if (!isJsonObjectRecord(o) || fields.some(k => !(k in o))) fail(`${label}-fields`)
  }
  if (s.request === null) {
    if (s.terminal !== null || ['solutions', 'instances', 'approvalRows', 'groups', 'activities', 'notifications', 'mail'].some(k => (s[k as keyof BusinessSnapshot] as unknown[]).length)) fail('null-subject-not-empty')
    return gaps.length === start
  }
  required(s.request, ['id','title','description','status','requesterId','organizationUnitId','createdAt','updatedAt','projectEstimateCost'], 'request')
  const requestId = snapshotRequestId(s)
  if (!requestId || !stringField(s.request, 'requesterId') || !requestStatus(s)) fail('request-identity')
  for (const key of ['solutions','instances','approvalRows','groups','activities'] as const) {
    const rows = arrayField(s, key)
    if (rows.length !== s[key].length || rows.some(r => !stringField(r, 'id')) || new Set(rows.map(r => r.id)).size !== rows.length) fail(`${key}-identity`)
  }
  for (const sol of arrayField(s, 'solutions')) {
    required(sol, ['id','requestId','title','description','costEstimate','currency','timeline','conceptDesign','submittedById','submittedAt','createdAt','updatedAt'], 'solution')
    if (sol.requestId !== requestId || !stringField(sol, 'submittedById') || 'status' in sol) fail('solution-subject')
    if (decimalCents(sol.costEstimate) === null) fail('solution-cost')
  }
  const instances = arrayField(s, 'instances')
  for (const i of instances) {
    required(i, ['id','phase','requestId','solutionId','attempt','state','supersededAt','routingMode','routeVersionId','originUserId','originUnitId','originAssignmentId','originPositionId','createdAt'], 'instance')
    if (!['REQUEST','SOLUTION','FINAL'].includes(String(i.phase)) || !INSTANCE_STATES.includes(String(i.state)) || !Number.isInteger(i.attempt) || Number(i.attempt) < 1) fail('instance-phase-attempt-state')
    if (i.supersededAt !== null && !stringField(i, 'supersededAt')) fail('instance-supersession')
    if (i.phase === 'SOLUTION') {
      if (i.requestId !== null || !arrayField(s, 'solutions').some(sol => sol.id === i.solutionId && sol.requestId === requestId)) fail('instance-solution')
    } else if (i.requestId !== requestId || i.solutionId !== null) fail('instance-request')
    const peers = instances.filter(p => p.phase === i.phase && p.solutionId === i.solutionId && p.requestId === i.requestId)
    if (peers.some(p => p !== i && p.attempt === i.attempt)) fail('instance-duplicate-attempt')
    if (i.supersededAt === null && peers.some(p => Number(p.attempt) > Number(i.attempt))) fail('instance-not-latest')
  }
  for (const row of arrayField(s, 'approvalRows')) {
    required(row, ['id','table','instanceId','order','status','approverId','comments','approvedAt','createdAt','requiredApproverId','requiredPositionId','candidateGroupId','routingMode'], 'row')
    const i = instanceById(s, String(row.instanceId))
    if (!i || !Number.isInteger(row.order) || Number(row.order) < 1 || !['pending','approved','rejected'].includes(String(row.status))) { fail('row-instance-order-status'); continue }
    if (i.phase === 'SOLUTION') {
      if (row.table !== 'solution_approvals' || row.solutionId !== i.solutionId || 'isFinalApproval' in row) fail('row-solution-category')
    } else if (row.table !== 'request_approvals' || row.requestId !== requestId || row.isFinalApproval !== (i.phase === 'FINAL')) fail('row-request-category')
    if (row.routingMode !== i.routingMode) fail('row-routing-mode')
    if (row.routingMode === 'SNAPSHOT_GROUP') {
      const group = arrayField(s, 'groups').find(g => g.id === row.candidateGroupId)
      if (!group || group.approvalInstanceId !== i.id || group.requiredPositionId !== row.requiredPositionId || !stringField(row, 'requiredPositionId') || row.requiredApproverId !== null) fail('row-group')
    } else if (row.routingMode !== 'CUSTOM_PERSON' || row.candidateGroupId !== null || row.requiredPositionId !== null || !stringField(row, 'requiredApproverId')) fail('row-custom-person')
    if (row.status === 'pending' && (row.approverId !== null || row.approvedAt !== null)) fail('pending-row-decided')
    if (row.status === 'approved' && (!stringField(row, 'approverId') || !stringField(row, 'approvedAt'))) fail('approved-row-decider')
  }
  for (const g of arrayField(s, 'groups')) {
    required(g, ['id','approvalInstanceId','scopeUnitId','requiredPositionId','capturedAt','members'], 'group')
    if (!instanceById(s, String(g.approvalInstanceId)) || !Array.isArray(g.members) || g.members.length === 0) { fail('group-members'); continue }
    const ids = g.members.map(m => stringField(m, 'userId'))
    if (ids.some(x => !x) || new Set(ids).size !== ids.length || g.members.some(m => !isJsonObjectRecord(m) || m.candidateGroupId !== g.id || !stringField(m, 'capturedAt') || !stringField(m, 'capturedDisplayName'))) fail('group-members')
  }
  if (!s.terminal || !same(without(s.terminal as unknown as JsonRecord, ['activities','notifications']), terminalBusiness(s))) fail('terminal-business-projection')
  return gaps.length === start
}

function auditHasNewActorRecord(before: BusinessSnapshot, after: BusinessSnapshot, actor: string, action: string, comments?: string): boolean {
  const ids = new Set(arrayField(before, 'activities').map(a => a.id))
  return arrayField(after, 'activities').some(a => !ids.has(a.id) && a.requestId === snapshotRequestId(after) && a.userId === actor && a.action === action && (comments === undefined || a.comments === comments))
}
/** PostgreSQL Decimal(15,2): compare persisted values, not JSON scale spelling.
 * Numeric arguments are rounded at the same two-decimal storage boundary. */
function decimalCents(value: unknown, roundInput = false): bigint | null {
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) return null
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value))
  if (!match) return null
  const exponent = Number(match[4] ?? 0)
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 400) return null
  const fraction = match[3] ?? ''
  let cents = BigInt(match[2] + fraction)
  const shift = exponent + 2 - fraction.length
  if (shift >= 0) cents *= BigInt('1' + '0'.repeat(shift))
  else {
    const divisor = BigInt('1' + '0'.repeat(-shift))
    if (!roundInput && cents % divisor !== BigInt(0)) return null
    cents = cents / divisor + (cents % divisor * BigInt(2) >= divisor ? BigInt(1) : BigInt(0))
  }
  if (cents > BigInt('999999999999999')) return null
  return match[1] === '-' ? -cents : cents
}
function sameDecimal(a: unknown, b: unknown, roundInput = false): boolean {
  const value = decimalCents(a)
  return value !== null && value === decimalCents(b, roundInput)
}
function validateActualTransition(input: ActionEvidence, _handler: HandlerKey, reason: string | null, gaps: string[]): boolean {
  const {record, before, after, phaseProof} = input
  const start = gaps.length
  const fail = (s: string): void => { gaps.push(`transition:${s}`) }
  if (!before || !after || !snapshotArraysComplete(before) || !snapshotArraysComplete(after) || !phaseProof) return false
  validateBusinessSnapshot(before, 'before', gaps); validateBusinessSnapshot(after, 'after', gaps)
  const spec = record.spec, target = spec.target, requestId = snapshotRequestId(after)
  if (spec.kind !== 'create' && (requestId !== target.requestId || snapshotRequestId(before) !== target.requestId)) fail('request-identity')
  if (spec.kind === 'approve' || spec.kind === 'reject') {
    const t = spec.target
    const b = instanceById(before, t.instanceId), a = instanceById(after, t.instanceId)
    const br = findRow(arrayField(before, 'approvalRows'), t.approvalRowId), ar = findRow(arrayField(after, 'approvalRows'), t.approvalRowId)
    if (!b || !a || !br || !ar) { fail('target-instance-row'); return false }
    if (b.phase !== t.phase || b.attempt !== t.attempt || b.state !== 'PENDING' || b.supersededAt !== null) fail('before-instance')
    if (!same(without(b, ['state']), without(a, ['state']))) fail('after-instance-metadata')
    if (!same(without(br, ['status','approverId','approvedAt','comments']), without(ar, ['status','approverId','approvedAt','comments']))) fail('after-row-metadata')
    if (br.instanceId !== t.instanceId || br.order !== t.order || t.currentOrder !== t.order || br.status !== 'pending') fail('target-row')
    if (br.routingMode !== t.routingMode || br.requiredPositionId !== t.requiredPositionId || br.candidateGroupId !== t.candidateGroupId) fail('target-routing')
    const candidates = membersFor(before, br)
    if (!same(candidates, [...t.candidateUserIds].sort()) || !candidates.includes(record.intendedActor) || t.actorId !== record.intendedActor) fail('target-membership-actor')
    const pending = currentRows(before, t.phase).filter(r => r.status === 'pending')
    if (!pending.length || pending[0].id !== t.approvalRowId) fail('actual-current-turn')
    if (requestStatus(before) !== PHASE_STATUS[t.phase] || t.observedStatus !== requestStatus(before)) fail('before-status')
    if (t.phase === 'SOLUTION' && (br.solutionId !== t.solutionId || b.solutionId !== t.solutionId)) fail('solution-identity')
    if (t.phase !== 'SOLUTION' && t.solutionId !== null) fail('unexpected-solution-target')
    if (ar.status !== (spec.kind === 'approve' ? 'approved' : 'rejected') || ar.approverId !== record.intendedActor || !stringField(ar, 'approvedAt')) fail('deciding-row')
    if (isJsonObjectRecord(record.argumentProjection) && record.argumentProjection.comments !== undefined && !same(record.argumentProjection.comments,projectPrivateText('')) && !privateTextMatches(record.argumentProjection.comments,ar.comments)) fail(spec.kind === 'reject' ? 'deciding-reason' : 'deciding-comments')
    if (spec.kind === 'reject' && (!reason || ar.comments !== reason)) fail('deciding-reason')
    if (spec.kind === 'approve' && ar.comments !== (reason || br.comments)) fail('deciding-comments')
    if (!same(before.groups, after.groups)) fail('group-history-changed')
    if (!same(without(before.request as JsonRecord, ['status','updatedAt','projectEstimateCost']), without(after.request as JsonRecord, ['status','updatedAt','projectEstimateCost']))) fail('request-fields-changed')
    if (!same(before.solutions, after.solutions)) fail('solution-history-changed')
    if (arrayField(before,'instances').filter(i=>i.id !== t.instanceId).some(i=>!same(i,instanceById(after,String(i.id))))) fail('other-instance-changed')
    const remaining = currentRows(after, t.phase).filter(r => r.status === 'pending')
    const expectedState = spec.kind === 'reject' ? 'REJECTED' : remaining.length ? 'PENDING' : 'APPROVED'
    if (a.state !== expectedState) fail('after-instance-state')
    const expectedStatus = spec.kind === 'reject' ? expectedPostRejectStatus(t.phase) : remaining.length ? PHASE_STATUS[t.phase] : APPROVED_STATUS[t.phase]
    if (requestStatus(after) !== expectedStatus) fail('after-request-status')
    for (const r of arrayField(before, 'approvalRows').filter(r => r.id !== br.id)) {
      const actual = findRow(arrayField(after, 'approvalRows'), String(r.id))
      const expected = spec.kind === 'reject' && r.instanceId === t.instanceId && r.status === 'pending' ? {...r, status: 'rejected'} : r
      if (!same(actual, expected)) fail('other-row-transition')
    }
    if (spec.kind === 'reject' && remaining.length) fail('remaining-pending')
    if (spec.kind === 'approve' && t.phase === 'SOLUTION' && !remaining.length) {
      const sol = arrayField(after, 'solutions').find(s => s.id === t.solutionId)
      const expectedCost = sol?.costEstimate == null ? (before.request as JsonRecord).projectEstimateCost : sol.costEstimate
      const actualCost = (after.request as JsonRecord).projectEstimateCost
      if (!sol || !(expectedCost === null ? actualCost === null : sameDecimal(actualCost, expectedCost))) fail('approved-solution-cost')
    } else if (!same((before.request as JsonRecord).projectEstimateCost, (after.request as JsonRecord).projectEstimateCost)) fail('decision-cost-preservation')
    const oldActivityIds = new Set(arrayField(before, 'activities').map(a => a.id))
    const newActivities = arrayField(after, 'activities').filter(a => !oldActivityIds.has(a.id))
    const solutionTitle = stringField(arrayField(after, 'solutions').find(s => s.id === t.solutionId), 'title') ?? ''
    const defaultComment = t.phase === 'SOLUTION' ? `Solution "${solutionTitle}" approved at step ${t.order}` : t.phase === 'FINAL' ? `Final approval approved at step ${t.order}` : `Approved at step ${t.order}`
    const decidingComment = spec.kind === 'reject' ? reason : reason || defaultComment
    const deciding = newActivities.filter(a => a.requestId === requestId && a.userId === record.intendedActor && a.action === DECISION_AUDIT_ACTION[t.phase][spec.kind] && a.comments === decidingComment && a.fromStatus === null && a.toStatus === null)
    if (deciding.length !== 1) fail('audit-record-missing')
    const needsStatusAudit = spec.kind === 'approve' && !remaining.length || spec.kind === 'reject' && t.phase === 'FINAL'
    if (needsStatusAudit) {
      const statusComment = spec.kind === 'reject' ? `Final approval rejected. Request returned to engineering for revision. Reason: "${reason}"` : t.phase === 'SOLUTION' ? `Solution "${solutionTitle}" approved. Request sent back to requester for final review.` : t.phase === 'FINAL' ? 'All final approvals completed. Request marked as completed.' : `Status changed from ${requestStatus(before)} to ${expectedStatus}`
      const statusActor = spec.kind === 'reject' ? record.intendedActor : stringField(before.request, 'requesterId')
      const statusAudits = newActivities.filter(a => a.requestId === requestId && a.action === 'status_changed' && a.userId === statusActor && a.fromStatus === requestStatus(before) && a.toStatus === expectedStatus && a.comments === statusComment)
      if (statusAudits.length !== 1) fail('status-audit')
    }
    if (newActivities.length !== (needsStatusAudit ? 2 : 1)) fail('audit-delta')
    if (arrayField(before,'activities').some(a => !same(a, findRow(arrayField(after,'activities'), String(a.id))))) fail('audit-history-changed')
    return gaps.length === start
  }
  if (spec.kind === 'deny-stale') return false
  const t = spec.target as RowlessTarget
  let freshId: string | null = null
  if (spec.kind === 'create') {
    const p = phaseProof as RequestCreateEvidence
    if (before.request !== null || p.requestId !== requestId || stringField(after.request, 'requesterId') !== record.intendedActor || stringField(after.request, 'title') !== p.title) fail('create-subject')
    freshId = stringField(arrayField(after, 'instances').find(i => i.phase === 'REQUEST' && i.attempt === t.expectedAttempt), 'id')
  } else if (spec.kind === 'resubmit') freshId = (phaseProof as ResubmitEvidence).newInstanceId
  else freshId = (phaseProof as SolutionSubmitEvidence | FinalInitiationEvidence).instanceId
  const fresh = freshId ? instanceById(after, freshId) : null
  if (!fresh || instanceById(before, freshId!) || fresh.phase !== t.phase || fresh.attempt !== t.expectedAttempt || fresh.state !== 'PENDING' || fresh.supersededAt !== null || fresh.routingMode !== t.routingMode) fail('fresh-instance')
  if (requestStatus(after) !== PHASE_STATUS[t.phase]) fail('fresh-status')
  if (!Number.isInteger(t.expectedAttempt) || t.expectedAttempt < 1 || !Array.isArray(t.expectedSteps) || !t.expectedSteps.length) { fail('expected-full-chain'); return false }
  const rows = arrayField(after, 'approvalRows').filter(r => r.instanceId === freshId).sort((a,b) => Number(a.order)-Number(b.order))
  const actualSteps = rows.map(r => ({order:r.order, requiredPositionId:r.requiredPositionId, requiredApproverId:r.requiredApproverId, candidateUserIds:membersFor(after,r)}))
  const intendedSteps = t.expectedSteps.map(({primaryActorId: _primary, ...r}) => ({...r, candidateUserIds:[...r.candidateUserIds].sort()}))
  if (t.expectedSteps.some((step,index) => !step.primaryActorId || !rows[index] || !membersFor(after,rows[index]).includes(step.primaryActorId) || (t.routingMode === 'CUSTOM_PERSON' && step.primaryActorId !== step.requiredApproverId))) fail('primary-actor')
  if (!same(actualSteps, intendedSteps)) fail('fresh-full-chain')
  if (rows.some(r => r.status !== 'pending' || r.approverId !== null || r.approvedAt !== null || r.comments !== null)) fail('fresh-carried-approvals')
  if (rows.some(r => arrayField(before, 'approvalRows').some(b => b.id === r.id))) fail('fresh-reused-row')
  if (t.routingMode === 'CUSTOM_PERSON' && !same(rows.map(r => r.requiredApproverId), t.expectedChain)) fail('fresh-custom-chain')
  const p = phaseProof as unknown as JsonRecord
  if ((spec.kind === 'submit-solution' || 'pendingApprovalRows' in p) && p.pendingApprovalRows !== rows.length) fail('proof-pending-count')
  if ((spec.kind === 'initiate-final' || 'pendingFinalRows' in p) && p.pendingFinalRows !== rows.length) fail('proof-pending-count')
  if (spec.kind === 'submit-solution' || spec.kind === 'initiate-final' || 'pendingApproverIds' in p || 'pendingActorIds' in p) {
    const primaryActors = t.expectedSteps.map(step => step.primaryActorId)
    const personIds = t.routingMode === 'CUSTOM_PERSON' ? rows.map(r => r.requiredApproverId) : []
    if (!same(p.pendingApproverIds, personIds) || !same(p.pendingActorIds, primaryActors)) fail('proof-pending-actors')
  }
  if (isJsonObjectRecord(record.argumentProjection)) {
    const subject = t.phase === 'SOLUTION' ? arrayField(after,'solutions').find(s=>s.id === fresh?.solutionId) : after.request
    const title = stringField(subject,'title')
    const actualTitleHash = title ? createHash('sha256').update(title).digest('hex') : null
    if (actualTitleHash !== t.titleSha256 || ('titleSha256' in record.argumentProjection && (actualTitleHash !== record.argumentProjection.titleSha256 || title?.length !== record.argumentProjection.titleLength))) fail('persisted-title-hash')
  }
  if (spec.kind === 'submit-solution' || spec.kind === 'initiate-final') {
    if (p.routingMode !== fresh?.routingMode || p.routeVersionId !== fresh?.routeVersionId) fail('observed-routing')
    if (p.observedStatus !== requestStatus(after) || p.observedInstanceId !== freshId) fail('observed-instance-status')
    if (spec.kind === 'initiate-final' && p.initiationRowId !== rows[0]?.id) fail('initiation-row')
  }
  if (spec.kind === 'submit-solution') {
    const solId = (phaseProof as SolutionSubmitEvidence).solutionId
    const sol = arrayField(after, 'solutions').find(s => s.id === solId)
    if (!sol || arrayField(before, 'solutions').some(s => s.id === solId) || sol.requestId !== requestId || sol.submittedById !== record.intendedActor || fresh?.solutionId !== solId || t.solutionId !== null || requestStatus(before) !== 'SentToEngineer') fail('submitted-solution')
  }
  if (spec.kind === 'initiate-final' && (t.solutionId !== null || requestStatus(before) !== 'SendBackToRequester')) fail('initiate-baseline')
  if ((spec.kind === 'submit-solution' || spec.kind === 'resubmit' && t.phase === 'SOLUTION') && isJsonObjectRecord(record.argumentProjection)) {
    const args = record.argumentProjection
    const sol = arrayField(after,'solutions').find(s => s.id === fresh?.solutionId)
    const previous = arrayField(before,'solutions').find(s => s.id === t.solutionId)
    if (!sol || !sameDecimal(sol.costEstimate, spec.kind === 'submit-solution' ? args.costEstimate ?? 0 : args.cost, true)) fail('solution-payload:costEstimate')
    if (!sol || sol.currency !== args.currency) fail('solution-payload:currency')
    if (!sol || (args.timeline === undefined ? sol.timeline !== null : !privateTextMatches(args.timeline,sol.timeline))) fail('solution-payload:timeline')
    if (!sol || (spec.kind === 'submit-solution' ? args.conceptDesign === undefined ? sol.conceptDesign !== null : !privateTextMatches(args.conceptDesign,sol.conceptDesign) : sol.conceptDesign !== previous?.conceptDesign)) fail('solution-payload:conceptDesign')
    if (spec.kind === 'resubmit' && (!previous || !sol || !same(without(previous,['title','description','costEstimate','currency','timeline','updatedAt']),without(sol,['title','description','costEstimate','currency','timeline','updatedAt'])))) fail('solution-payload:preserved-fields')
  }
  if (spec.kind === 'resubmit') {
    const prev = t.previous, proof = phaseProof as ResubmitEvidence
    const b = prev ? instanceById(before, prev.instanceId) : null, a = prev ? instanceById(after, prev.instanceId) : null
    if (!prev || !b || !a || prev.requestId !== requestId || prev.phase !== t.phase || prev.solutionId !== t.solutionId || b.phase !== prev.phase || b.attempt !== prev.attempt || b.state !== prev.expectedState.toUpperCase() || b.supersededAt !== null || requestStatus(before) !== prev.observedStatus) fail('previous-baseline')
    if (a && b && (!stringField(a,'supersededAt') || !same(without(a,['supersededAt']),without(b,['supersededAt'])))) fail('previous-instance-not-superseded')
    if (prev && (t.expectedAttempt !== prev.attempt+1 || proof.previousInstanceId !== prev.instanceId || proof.previousAttempt !== prev.attempt)) fail('previous-attempt')
    if (prev) {
      const prevRows = arrayField(before,'approvalRows').filter(r => r.instanceId === prev.instanceId).sort((a,b)=>Number(a.order)-Number(b.order))
      if (!same(prevRows.map(r=>({order:r.order,status:r.status,approvalRowId:r.id})),prev.rowStates) || !prevRows.length) fail('previous-row-history')
      if (prevRows.some(r=>!same(r,findRow(arrayField(after,'approvalRows'),String(r.id))))) fail('previous-row-rewritten')
    }
    if (t.phase === 'REQUEST' && !(Date.parse(stringField(after.request,'updatedAt') ?? '') > Date.parse(stringField(before.request,'updatedAt') ?? ''))) fail('resubmit-request-token')
    if (t.phase === 'REQUEST' && (requestStatus(before) !== 'ImprovementRequest' || stringField(before.request,'requesterId') !== record.intendedActor)) fail('resubmit-request-owner-status')
    if (t.phase === 'REQUEST') {
      if (prev?.expectedState !== 'rejected' || b?.state !== 'REJECTED' || !currentRows(before,'REQUEST').some(r => r.instanceId === prev?.instanceId && r.table === 'request_approvals' && r.isFinalApproval === false && r.status === 'rejected')) fail('resubmit-request-rejection')
      const args = isJsonObjectRecord(record.argumentProjection) ? record.argumentProjection : {}
      const allowedFields = ['updatedAt', ...('titleSha256' in args ? ['title'] : []), ...('descriptionSha256' in args ? ['description'] : [])]
      if (!same(without(before.request as JsonRecord,allowedFields),without(after.request as JsonRecord,allowedFields))) fail('resubmit-request-fields')
      if ('titleSha256' in args && createHash('sha256').update(String((after.request as JsonRecord).title)).digest('hex') !== args.titleSha256) fail('resubmit-request-title')
    }
    if (t.phase === 'SOLUTION' && (!arrayField(before,'solutions').some(s=>s.id === t.solutionId && s.requestId === requestId) || fresh?.solutionId !== t.solutionId)) fail('resubmit-solution-identity')
    if (t.phase === 'SOLUTION' && prev?.expectedState === 'approved' && !currentRows(before,'FINAL').some(r=>r.status === 'rejected' && instanceById(before,String(r.instanceId))?.state === 'REJECTED')) fail('final-rejection-history')
  } else if (spec.kind !== 'initiate-final' && t.expectedAttempt !== 1) fail('initial-attempt')
  const action = spec.kind === 'create' ? 'created' : spec.kind === 'submit-solution' ? 'solution_submitted' : spec.kind === 'initiate-final' ? 'final_approval_initiated' : t.phase === 'REQUEST' ? 'resubmitted' : 'solution_resubmitted'
  if (!auditHasNewActorRecord(before, after, record.intendedActor, action)) fail('audit-record-missing')
  return gaps.length === start
}

/** Canonical review-safe text. Length is JS UTF-16; blank does not imply
 * source validity. Raw schemas still run before argument normalization. */
export function projectPrivateText(value: string): JsonValue {
  return {sha256:createHash('sha256').update(value).digest('hex'),length:value.length,blank:value.trim().length === 0}
}
function privateTextValid(value: unknown): boolean {
  return isJsonObjectRecord(value) && Object.keys(value).sort().join(',') === 'blank,length,sha256'
    && is64Hex(value.sha256) && Number.isInteger(value.length) && Number(value.length) >= 0 && typeof value.blank === 'boolean'
    && (value.length !== 0 || value.blank === true)
}
function privateTextMatches(value: unknown, raw: unknown): boolean {
  return typeof raw === 'string' && privateTextValid(value) && same(value,projectPrivateText(raw))
}
const KNOWN_ACTION_ERRORS = new Set([
  'Unauthorized', 'You cannot approve this request at this time', 'You cannot reject this request at this time',
  'You cannot approve this solution at this time', 'You cannot reject this solution at this time',
  'Comments are required when rejecting', 'This request was updated by another user.',
])
/** Only fixed source-supported errors carry meaning. Unknown text is a hash,
 * never an invented stale/denial code; raw message/stack/digest are not copied. */
export function normalizeActionError(message: string, digest: unknown = null): {state:'thrown';code:string;digest:string|null} {
  return {state:'thrown',code:KNOWN_ACTION_ERRORS.has(message) ? message : 'unknown-error:' + createHash('sha256').update(message).digest('hex'),
    digest:typeof digest === 'string' ? (/^\d{1,20}$/.test(digest) ? digest : 'sha256:' + createHash('sha256').update(digest).digest('hex')) : null}
}
function canonicalPrivateText(value: unknown): JsonValue {
  if (typeof value === 'string') return projectPrivateText(value)
  if (privateTextValid(value)) return value as JsonValue
  throw new LedgerPolicyError('result-shape:private-text')
}
/** Project only fields actually returned by the eleven exports. Canonical
 * input is stable for strict validation; raw legacy projections compare
 * unequal and therefore cannot qualify fresh assurance. */
export function normalizeActionResult(handler: HandlerKey, value: unknown): JsonValue {
  if (!isJsonObjectRecord(value) || typeof value.success !== 'boolean') throw new LedgerPolicyError('result-shape:object-success')
  if (value.success === false) {
    if (value.stale === true && (typeof value.message === 'string' || privateTextValid(value.message))) return {success:false,stale:true,message:canonicalPrivateText(value.message)}
    if (handler === 'requests.createRequest' && (typeof value.error === 'string' || privateTextValid(value.error))) return {success:false,error:canonicalPrivateText(value.error)}
    if (handler === 'requests.createRequest' && isJsonObjectRecord(value.errors)) {
      const errors: {[key:string]:JsonValue} = {}
      for (const [key,list] of Object.entries(value.errors)) {
        if (!['title','description','inlineImageSessionId','stagedAttachmentIds'].includes(key) || !Array.isArray(list)) throw new LedgerPolicyError('result-shape:errors')
        errors[key] = list.map(canonicalPrivateText)
      }
      return {success:false,errors}
    }
    throw new LedgerPolicyError('result-shape:failure')
  }
  const result: {[key:string]:JsonValue} = {success:true}
  const requireId = (key:string): string => { const id=stringField(value,key); if (!id) throw new LedgerPolicyError(`result-identity-missing:${key}`); return id }
  if (handler === 'requests.createRequest') result.requestId = requireId('requestId')
  if (handler === 'solutions.submitSolution' || handler === 'solutions.resubmitSolution') result.solutionId = requireId('solutionId')
  if (handler === 'requests.resubmitRequest') {
    const id = stringField(value.request,'id'); if (!id) throw new LedgerPolicyError('result-identity-missing:request.id')
    result.request = {id}
  }
  if (handler === 'solutions.resubmitSolution') {
    for (const key of ['deletedAttachmentIds','cleanupWarnings']) {
      const v=value[key]; if (!Array.isArray(v) || (key === 'deletedAttachmentIds' && v.some(x=>typeof x !== 'string'))) throw new LedgerPolicyError(`result-shape:${key}`)
      result[key]=key === 'cleanupWarnings' ? v.map(canonicalPrivateText) : v
    }
  }
  return result
}
const requestContentSchema = {
  title: z.string().min(1).max(200),
  description: descriptionSchema,
  inlineImageSessionId: z.string().uuid(),
}
const createInputSchema = z.object({...requestContentSchema, stagedAttachmentIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS_PER_FORM).refine(ids => new Set(ids).size === ids.length).default([])})
const reviseRequestInputSchema = z.object({requestId:z.string(),title:requestContentSchema.title.optional(),description:descriptionSchema.optional(),inlineImageSessionId:z.string().uuid().optional()})
function objectInputSchema(handler: HandlerKey) {
  return handler === 'solutions.submitSolution' ? submitSolutionSchema : handler === 'solutions.resubmitSolution' ? resubmitSolutionSchema : handler === 'requests.createRequest' ? createInputSchema : reviseRequestInputSchema
}
/** Safe parameter projection of the actual eleven signatures. Rich content is
 * hashed; optional parameters stay absent; only real schema defaults are made
 * explicit. No request/solution identity is synthesized from another argument. */
export function normalizeActionArguments(handler: HandlerKey, args: readonly unknown[]): JsonValue {
  const out: {[key: string]: JsonValue} = {}
  const copy = (from: JsonRecord, keys: string[]): void => {
    for (const key of keys) if (from[key] !== undefined) out[key] = from[key] as JsonValue
  }
  const content = (from: JsonRecord, optional = false): void => {
    for (const field of ['title','description']) {
      if (optional && from[field] === undefined) continue
      if (typeof from[field] !== 'string') throw new LedgerPolicyError(`argument-shape:${field}`)
      out[`${field}Sha256`] = createHash('sha256').update(from[field] as string).digest('hex')
      out[`${field}Length`] = (from[field] as string).length
    }
  }
  if (['requests.createRequest','requests.resubmitRequest','solutions.submitSolution','solutions.resubmitSolution'].includes(handler)) {
    if (args.length !== 1 || !isJsonObjectRecord(args[0])) throw new LedgerPolicyError('argument-shape:input-object')
    const parsed = objectInputSchema(handler).safeParse(args[0])
    if (!parsed.success) throw new LedgerPolicyError(`argument-shape:${parsed.error.issues[0]?.path.join('.')}`)
    const value = parsed.data as JsonRecord
    if (handler === 'requests.resubmitRequest' && (value.description !== undefined ? value.inlineImageSessionId === undefined : value.inlineImageSessionId !== undefined)) throw new LedgerPolicyError('argument-shape:inlineImageSessionId')
    if (handler === 'solutions.resubmitSolution' && (value.newFileIds as string[]).some(id => (value.deletedFileIds as string[]).includes(id))) throw new LedgerPolicyError('argument-shape:attachment-overlap')
    copy(value,['requestId','inlineImageSessionId'])
    content(value,handler === 'requests.resubmitRequest')
    if (handler === 'requests.createRequest') out.stagedAttachmentIds = (value.stagedAttachmentIds ?? []) as JsonValue
    if (handler === 'solutions.submitSolution') {
      copy(value,['costEstimate','customApproverIds'])
      for (const key of ['timeline','conceptDesign']) if (value[key] !== undefined) out[key] = projectPrivateText(value[key] as string)
      out.currency = (value.currency ?? 'THB') as JsonValue
      out.fileIds = (value.fileIds ?? []) as JsonValue
      out.useCustomApprovals = (value.useCustomApprovals ?? false) as JsonValue
    }
    if (handler === 'solutions.resubmitSolution') {
      copy(value,['cost','currency','useCustomHierarchy'])
      out.timeline = projectPrivateText(value.timeline as string)
      out.newFileIds = (value.newFileIds ?? []) as JsonValue
      out.deletedFileIds = (value.deletedFileIds ?? []) as JsonValue
      out.customApprovers = (value.customApprovers ?? []) as JsonValue
    }
  } else {
    const idField = handler === 'solutions.approveSolution' || handler === 'solutions.rejectSolution' ? 'solutionId' : 'requestId'
    out[idField] = args[0] as JsonValue
    if (handler === 'solutions.initiateFinalApproval') {
      out.useCustomChain = args[1] as JsonValue
      if (args[2] !== undefined) out.customApproverIds = args[2] as JsonValue
    } else {
      if (args[1] !== undefined) {
        if (typeof args[1] !== 'string') throw new LedgerPolicyError('argument-shape:comments')
        out.comments = projectPrivateText(args[1])
      }
      if (args[2] !== undefined) out.expectedUpdatedAt = args[2] instanceof Date ? args[2].toISOString() : args[2] as JsonValue
    }
    if (args.length < 1 || args.length > 3) throw new LedgerPolicyError('argument-shape:arity')
    if (typeof args[0] !== 'string' || !args[0]) throw new LedgerPolicyError(`argument-shape:${idField}`)
    if (handler === 'solutions.initiateFinalApproval') {
      if (typeof args[1] !== 'boolean' || args[2] !== undefined && (!Array.isArray(args[2]) || args[2].some(id => typeof id !== 'string'))) throw new LedgerPolicyError('argument-shape:custom-chain')
    } else if (args[1] !== undefined && typeof args[1] !== 'string') throw new LedgerPolicyError('argument-shape:comments')
  }
  return out
}

function returnedProjection(exit: FlightResult): {[key:string]:JsonValue} | null { return exit.state === 'returned' && isJsonObjectRecord(exit.projection) ? exit.projection as {[key:string]:JsonValue} : null }
function returnedSuccessFalse(exit: FlightResult): boolean { return returnedProjection(exit)?.success === false }
function validateOriginalResult(input: ActionEvidence, gaps: string[]): boolean {
  if (!input.server) return false
  if (input.server.exit.state !== 'returned') return input.server.exit.state === 'thrown'
  try {
    const v = normalizeActionResult(input.record.spec.handler,input.server.exit.projection) as {[key:string]:JsonValue}
    if (!same(v,input.server.exit.projection)) throw new LedgerPolicyError('result-shape:not-normalized')
    if (v.success !== true) return false
    const kind=input.record.spec.kind, t=input.record.spec.target, p=input.phaseProof
    if (kind === 'create' && v.requestId !== (p as RequestCreateEvidence | null)?.requestId) throw new LedgerPolicyError('result-identity-mismatch:requestId')
    if (kind === 'submit-solution' && v.solutionId !== (p as SolutionSubmitEvidence | null)?.solutionId) throw new LedgerPolicyError('result-identity-mismatch:solutionId')
    if (kind === 'resubmit' && (t.phase === 'SOLUTION' ? v.solutionId !== t.solutionId : !isJsonObjectRecord(v.request) || v.request.id !== t.requestId)) throw new LedgerPolicyError('result-identity-mismatch:resubmit-subject')
    if (input.record.spec.handler === 'solutions.resubmitSolution') {
      const args = input.record.argumentProjection
      const deleted = v.deletedAttachmentIds as string[]
      if (!isJsonObjectRecord(args) || !Array.isArray(args.deletedFileIds) || !same([...deleted].sort(), [...args.deletedFileIds].sort())) throw new LedgerPolicyError('result-identity-mismatch:deletedAttachmentIds')
      const warnings = v.cleanupWarnings as JsonValue[]
      const allowed = deleted.map(id=>projectPrivateText(`Attachment ${id} file could not be deleted`))
      if (warnings.some(w=>!allowed.some(a=>same(a,w))) || new Set(warnings.map(stable)).size !== warnings.length) throw new LedgerPolicyError('result-shape:cleanupWarnings')
    }
    return true
  } catch(e) { gaps.push(String((e as Error).message)); return false }
}
/** Preparation is a same-server-invocation observation, never inferred from
 * persisted HTML. Missing capture fails qualification independently of commit. */
function validatePreparedDescription(input: ActionEvidence, gaps: string[]): void {
  const {record,server,after} = input
  if (!server || server.transaction !== 'resolved' || !after) return
  const spec = record.spec
  if (spec.kind !== 'create' && spec.kind !== 'submit-solution' && spec.kind !== 'resubmit') return
  const args = record.argumentProjection
  if (!isJsonObjectRecord(args)) return
  const proof = server.preparedDescription
  if (!('descriptionSha256' in args)) {
    if (proof !== undefined) gaps.push('prepared-description:unexpected')
    return
  }
  if (!proof) {gaps.push('prepared-description:missing');return}
  if (!is64Hex(proof.inputSha256) || proof.inputSha256 !== args.descriptionSha256 || proof.uploadSessionId !== args.inlineImageSessionId) gaps.push('prepared-description:input-session')
  const subject = spec.target.phase === 'SOLUTION'
    ? arrayField(after,'solutions').find(s => s.id === (spec.kind === 'submit-solution' ? (input.phaseProof as SolutionSubmitEvidence | null)?.solutionId : spec.target.solutionId))
    : after.request
  const html = isJsonObjectRecord(subject) ? subject.description : null
  if (typeof html !== 'string' || !is64Hex(proof.htmlSha256) || createHash('sha256').update(html).digest('hex') !== proof.htmlSha256) gaps.push('prepared-description:html')
}
function validateResultCorrelation(input: ActionEvidence, gaps:string[]): boolean {
  const {dispatch,server}=input
  if (!dispatch || !server) return false
  for (const exit of [server.exit,dispatch.result]) if (exit.state === 'thrown' &&
    ((!KNOWN_ACTION_ERRORS.has(exit.code) && !/^unknown-error:[0-9a-f]{64}$/.test(exit.code)) ||
    (exit.digest !== null && !/^(?:[0-9]{1,20}|sha256:[0-9a-f]{64})$/.test(exit.digest)))) gaps.push('exit-privacy-projection')
  if (!same(server.exit,dispatch.result)) { gaps.push('exit-result-mismatch'); return false }
  return true
}
function validateArgumentsAgainstTarget(record: ActionRecord, gaps: string[]): boolean {
  const start=gaps.length, v=record.argumentProjection, t=record.spec.target, h=record.spec.handler
  const fail=(key:string):void=>{gaps.push(`argument-target:${key}`)}
  if (!isJsonObjectRecord(v)) {fail('not-object');return false}
  const requireMatch=(key:string,expected:unknown):void=>{if (!same(v[key],expected)) fail(key)}
  const objectFields: Partial<Record<HandlerKey, string[]>> = {
    'requests.createRequest': ['titleSha256','titleLength','descriptionSha256','descriptionLength','inlineImageSessionId','stagedAttachmentIds'],
    'requests.resubmitRequest': ['requestId','titleSha256','titleLength','descriptionSha256','descriptionLength','inlineImageSessionId'],
    'solutions.submitSolution': ['requestId','titleSha256','titleLength','descriptionSha256','descriptionLength','inlineImageSessionId','costEstimate','currency','timeline','conceptDesign','useCustomApprovals','customApproverIds','fileIds'],
    'solutions.resubmitSolution': ['requestId','titleSha256','titleLength','descriptionSha256','descriptionLength','inlineImageSessionId','cost','currency','timeline','newFileIds','deletedFileIds','useCustomHierarchy','customApprovers'],
    'solutions.initiateFinalApproval': ['requestId','useCustomChain','customApproverIds'],
  }
  const allowed = objectFields[h] ?? ['requestId','solutionId','comments','expectedUpdatedAt']
  if (Object.keys(v).some(k=>!allowed.includes(k))) fail('unknown-field')
  if (h in objectFields && h !== 'solutions.initiateFinalApproval') {
    let lengthsValid = true
    for (const [field,maximum] of [['title',200],['description',20000]] as const) {
      const present = `${field}Sha256` in v
      const length = v[`${field}Length`]
      if (present ? !is64Hex(v[`${field}Sha256`]) || !Number.isInteger(length) || Number(length) < 1 || Number(length) > maximum : `${field}Length` in v) {fail(`${field}Length`);lengthsValid=false}
    }
    if (lengthsValid) {
      // These placeholders validate ONLY representable scalar/list/length
      // constraints. Raw visible-content validation belongs to the shared
      // normalizer; hashes cannot reconstruct it or prove its authenticity.
      for (const [key,maximum] of [['timeline',500],['conceptDesign',2000]] as const) if (key in v && (!privateTextValid(v[key]) || Number((v[key] as JsonRecord).length) > maximum)) {fail(key);lengthsValid=false}
      const parsed = objectInputSchema(h).safeParse({...v,
        ...('titleSha256' in v ? {title:'x'.repeat(Number(v.titleLength))} : {}),
        ...('descriptionSha256' in v ? {description:'x'.repeat(Number(v.descriptionLength))} : {}),
        ...Object.fromEntries(['timeline','conceptDesign'].filter(key=>lengthsValid && key in v && privateTextValid(v[key])).map(key=>[key,'x'.repeat(Number((v[key] as JsonRecord).length))])),
      })
      if (!parsed.success) for (const issue of parsed.error.issues) fail(String(issue.path[0]))
    }
    if (h === 'solutions.resubmitSolution' && Array.isArray(v.newFileIds) && Array.isArray(v.deletedFileIds) && v.newFileIds.some(id => (v.deletedFileIds as unknown[]).includes(id))) fail('attachment-overlap')
  }
  if ((record.spec.kind === 'approve' || record.spec.kind === 'reject' || record.spec.kind === 'deny-stale') && v.comments !== undefined && !privateTextValid(v.comments)) fail('comments')
  if (h === 'requests.createRequest' || h === 'solutions.submitSolution' || h === 'solutions.resubmitSolution') {
    if (!stringField(v,'inlineImageSessionId')) fail('inlineImageSessionId')
  }
  if (h === 'requests.resubmitRequest') {
    if (v.titleSha256 !== undefined && !is64Hex(v.titleSha256)) fail('titleSha256')
    if (v.descriptionSha256 !== undefined && !is64Hex(v.descriptionSha256)) fail('descriptionSha256')
    if ((v.descriptionSha256 !== undefined && !stringField(v,'inlineImageSessionId')) || (v.descriptionSha256 === undefined && v.inlineImageSessionId !== undefined)) fail('inlineImageSessionId')
  }
  const requiredArrays = h === 'requests.createRequest' ? ['stagedAttachmentIds'] : h === 'solutions.submitSolution' ? ['fileIds'] : h === 'solutions.resubmitSolution' ? ['newFileIds','deletedFileIds','customApprovers'] : []
  for (const key of requiredArrays) {
    const list=v[key]
    if (!Array.isArray(list) || list.some(x=>typeof x !== 'string' || !x.trim()) || new Set(list).size !== list.length) fail(key)
  }
  if (h === 'solutions.submitSolution' || h === 'solutions.resubmitSolution') {
    if (!['THB','USD','EUR'].includes(String(v.currency))) fail('currency')
    for (const key of ['timeline','conceptDesign']) if (key in v && !privateTextValid(v[key])) fail(key)
    if (h === 'solutions.resubmitSolution' && (!privateTextValid(v.timeline) || Number((v.timeline as JsonRecord).length) < 1)) fail('timeline')
    const key = h === 'solutions.resubmitSolution' ? 'cost' : 'costEstimate'
    if ((h === 'solutions.resubmitSolution' || v[key] !== undefined) && (typeof v[key] !== 'number' || !Number.isFinite(v[key]) || Number(v[key]) <= 0)) fail(key)
  }
  if (h === 'solutions.approveSolution' || h === 'solutions.rejectSolution') requireMatch('solutionId',t.solutionId)
  else if (h !== 'requests.createRequest') requireMatch('requestId',t.requestId)
  if (record.spec.kind === 'reject' || record.spec.kind === 'deny-stale') { if (!privateTextValid(v.comments) || Number((v.comments as JsonRecord).length) < 1) fail('comments') }
  if ('expectedUpdatedAt' in v && (typeof v.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(v.expectedUpdatedAt)))) fail('expectedUpdatedAt')
  if ('expectedSteps' in t) {
    if (!['SNAPSHOT_GROUP','CUSTOM_PERSON'].includes(t.routingMode)) fail('routingMode')
    if (h === 'requests.createRequest' || h === 'solutions.submitSolution' || h === 'solutions.resubmitSolution') {
      if (!is64Hex(v.titleSha256) || v.titleSha256 !== t.titleSha256 || !is64Hex(v.descriptionSha256)) fail('content-hashes')
    }
    const flag = h === 'solutions.initiateFinalApproval' ? 'useCustomChain' : h === 'solutions.submitSolution' ? 'useCustomApprovals' : h === 'solutions.resubmitSolution' ? 'useCustomHierarchy' : null
    const list = h === 'solutions.resubmitSolution' ? 'customApprovers' : 'customApproverIds'
    if (flag) {
      if (typeof v[flag] !== 'boolean' || v[flag] !== (t.routingMode === 'CUSTOM_PERSON')) fail(flag)
      if (t.routingMode === 'CUSTOM_PERSON') {
        if (!Array.isArray(t.customApproverIds) || !t.customApproverIds.length || !same(v[list],t.customApproverIds)) fail(list)
        const normalized=Array.isArray(v[list]) ? [...new Set(v[list].filter(id=>id !== record.intendedActor))] : []
        if (!same(normalized,t.expectedChain)) fail('normalized-custom-chain')
      } else if (v[list] !== undefined && (!Array.isArray(v[list]) || v[list].length !== 0)) fail(list)
    }
  }
  return gaps.length === start
}

function validateSemanticRecords(snapshot: BusinessSnapshot, side: string, gaps:string[]): boolean {
  const start=gaps.length, requestId=snapshotRequestId(snapshot)
  for (const n of snapshot.notifications) {
    if (!isJsonObjectRecord(n) || !stringField(n,'id') || !stringField(n,'userId') || n.requestId !== requestId || !SOURCE_NOTIFICATION_TYPES.includes(String(n.type))) gaps.push(`notification-record:${side}:semantic-fields`)
  }
  for (const m of snapshot.mail) {
    if (!isJsonObjectRecord(m) || !stringField(m,'messageId') || !stringField(m,'recipientId') || m.requestId !== requestId || !SOURCE_NOTIFICATION_TYPES.includes(String(m.semanticType)) || !is64Hex(m.bodyDigest)) gaps.push(`mail-record:${side}:semantic-fields`)
  }
  return start === gaps.length
}
/** Delivery is qualification evidence, not part of the persisted commit proof. */
function validateDelivery(input:ActionEvidence,gaps:string[]):void {
  const {before,after,record}=input
  if (!before || !after || !snapshotArraysComplete(before) || !snapshotArraysComplete(after)) return
  validateSemanticRecords(before,'before',gaps);validateSemanticRecords(after,'after',gaps)
  if (record.spec.kind === 'deny-stale' || input.server?.transaction !== 'resolved') return
  const spec=record.spec,phase=spec.target.phase,requestId=snapshotRequestId(after),requester=stringField(after.request,'requesterId')
  let type:string,recipients:string[],mail=true
  if (spec.kind === 'resubmit' && phase === 'REQUEST') {type='';recipients=[];mail=false}
  else if (spec.kind === 'reject') {type='approval_rejected';recipients=[...new Set([requester,record.intendedActor].filter((x):x is string=>!!x))]}
  else {
    const next=currentRows(after,phase).find(r=>r.status === 'pending')
    if (next) {type=phase === 'FINAL' ? 'final_approval_needed' : 'approval_needed';recipients=membersFor(after,next)}
    else if (phase === 'REQUEST') {type='status_changed';recipients=requester ? [requester] : [];mail=false}
    else if (phase === 'FINAL') {type='approval_granted';recipients=requester ? [requester] : []}
    else {type='solution_ready';recipients=[...new Set([requester,...arrayField(after,'solutions').map(s=>stringField(s,'submittedById'))].filter((x):x is string=>!!x))]}
  }
  const newNotes=arrayField(after,'notifications').filter(n=>!arrayField(before,'notifications').some(b=>b.id === n.id))
  const newMail=arrayField(after,'mail').filter(m=>!arrayField(before,'mail').some(b=>b.messageId === m.messageId))
  const noteKeys=newNotes.map(n=>`${n.requestId}|${n.type}|${n.userId}`).sort()
  const mailKeys=newMail.map(m=>`${m.requestId}|${m.semanticType}|${m.recipientId}`).sort()
  const expected=recipients.map(r=>`${requestId}|${type}|${r}`).sort()
  if (!same(noteKeys,expected)) gaps.push('delivery:notification-type-recipient-request')
  if (!same(mailKeys,mail ? expected : [])) gaps.push('delivery:mail-type-recipient-request')
}

function sameDomainIntervalOk(start:ClockMark|null|undefined,end:ClockMark|null|undefined,label:string,gaps:string[]):boolean {
  if (!start || !end || !start.domain?.trim() || start.domain !== end.domain || ![start.monotonicMs,end.monotonicMs,start.wallMs,end.wallMs].every(Number.isFinite) || end.monotonicMs < start.monotonicMs) {gaps.push(`${label}-interval-incoherent`);return false}
  return true
}
function validateTemporalAndIdentity(input:ActionEvidence,gaps:string[]):boolean {
  const start=gaps.length,{record,dispatch,server}=input
  if (!record.start || !record.start.domain?.trim() || !Number.isFinite(record.start.monotonicMs) || !Number.isFinite(record.start.wallMs) || (dispatch && (record.start.domain !== dispatch.start.domain || record.start.monotonicMs > dispatch.start.monotonicMs))) gaps.push('record-clock')
  if (!server) return false
  if (!server.invocationId?.trim() || server.invocationId === record.identity.invocationId) gaps.push('server-invocation-id-namespace')
  const serverOk=sameDomainIntervalOk(server.start,server.end,'server',gaps)
  if (!dispatch) return false
  const dispatchOk=sameDomainIntervalOk(dispatch.start,dispatch.end,'dispatch',gaps)
  if (!same(dispatch.identity,record.identity)) gaps.push('dispatch-identity-mismatch')
  if (!same(dispatch.argumentProjection,record.argumentProjection)) gaps.push('dispatch-arguments-mismatch')
  if (!artifactRefValid(dispatch.body)) gaps.push('dispatch-body-missing')
  if (dispatch.result.state === 'incomplete' || dispatch.result.state === 'unsupported') gaps.push(`flight-result-${dispatch.result.state}`)
  if (serverOk && dispatchOk && server.end && dispatch.end) {
    let offset=0,uncertainty=0,calibrated=true
    if (dispatch.start.domain !== server.start.domain) {
      const c=input.clockCalibration
      if (!c || c.verified !== true || !Number.isFinite(c.offsetMs) || !Number.isFinite(c.uncertaintyMs) || c.uncertaintyMs < 0) calibrated=false
      else if (c.fromDomain === dispatch.start.domain && c.toDomain === server.start.domain) {offset=c.offsetMs;uncertainty=c.uncertaintyMs}
      else if (c.toDomain === dispatch.start.domain && c.fromDomain === server.start.domain) {offset=-c.offsetMs;uncertainty=c.uncertaintyMs}
      else calibrated=false
    }
    if (!calibrated) gaps.push('clock-domain-uncalibrated')
    // Direction: to = from + offset +/- uncertainty. Robust containment must
    // hold for every possible offset, not merely one overlapping possibility.
    else if (![dispatch.start.monotonicMs+offset+uncertainty,dispatch.end.monotonicMs+offset-uncertainty].every(Number.isFinite) || server.start.monotonicMs < dispatch.start.monotonicMs+offset+uncertainty || server.end.monotonicMs > dispatch.end.monotonicMs+offset-uncertainty) gaps.push('server-interval-outside-dispatch-envelope')
  }
  return gaps.length === start
}

function validateStaleDenial(input:ActionEvidence,gaps:string[]):boolean {
  const {record,before,after,server}=input
  if (record.spec.kind !== 'deny-stale') return true
  const start=gaps.length,t=record.spec.target,current=record.spec.current
  const fail=(s:string):void=>{gaps.push(`stale:${s}`)}
  if (!before || !after || !snapshotArraysComplete(before) || !snapshotArraysComplete(after)) return false
  validateBusinessSnapshot(before,'stale-before',gaps);validateBusinessSnapshot(after,'stale-after',gaps)
  if (t.phase !== 'FINAL' || t.solutionId !== null || t.requestId !== current.requestId || t.requestId !== snapshotRequestId(before) || t.requestId !== snapshotRequestId(after)) fail('subject')
  if (current.status !== 'Completed' || requestStatus(before) !== 'Completed' || !same(current,before.terminal) || !same(current,after.terminal)) fail('current-completed-baseline')
  if ([before.terminal,after.terminal].some(t=>!t || t.requestPendingRows !== 0 || t.solutionPendingRows !== 0 || t.finalPendingRows !== 0) || currentRows(before,'FINAL').some(r=>r.status === 'pending')) fail('pending-zero')
  const row=findRow(arrayField(before,'approvalRows'),t.approvalRowId),instance=instanceById(before,t.instanceId)
  if (!row || !instance || instance.phase !== 'FINAL' || instance.attempt !== t.attempt || instance.state !== 'APPROVED' || instance.supersededAt !== null || row.instanceId !== t.instanceId || row.status !== 'approved' || row.order !== t.order || t.currentOrder !== t.order || row.table !== 'request_approvals' || row.requestId !== t.requestId || row.isFinalApproval !== true || row.candidateGroupId !== t.candidateGroupId || row.requiredPositionId !== t.requiredPositionId || row.routingMode !== t.routingMode || t.actorId !== record.intendedActor || !same(membersFor(before,row),[...t.candidateUserIds].sort()) || !membersFor(before,row).includes(t.actorId) || t.observedStatus !== 'FinalApproval') fail('held-history-tuple')
  if (serializeBusinessSnapshot(before) !== serializeBusinessSnapshot(after)) fail('state-changed')
  if (isJsonObjectRecord(record.argumentProjection) && Object.keys(record.argumentProjection).some(k=>!['requestId','comments'].includes(k))) fail('not-two-argument-caller')
  // Completed/held two-argument path always fails eligibility BEFORE the
  // optional expectedUpdatedAt branch and before opening a transaction.
  if (!server || server.transaction !== 'not-started') fail('transaction-not-started-required')
  if (!server || server.exit.state !== 'thrown' || server.exit.code !== STALE_ELIGIBILITY_THROWN_CODE) fail('reachable-eligibility-throw-required')
  return gaps.length === start
}

function validatePhaseProofForCommit(
  input: ActionEvidence,
  expectedHandler: HandlerKey,
  gaps: string[],
): boolean {
  const localGaps: string[] = []
  const valid = validatePhaseProof(input, expectedHandler, localGaps)
  gaps.push(...localGaps)
  return valid
}

/** Phase-proof validation against the recorded target using the EXISTING
 *  evidence validators, bound to the after-snapshot identity. Local gap list:
 *  validity must be independent of unrelated capture gaps (Finding 7). */
function validatePhaseProof(
  input: ActionEvidence,
  expectedHandler: HandlerKey,
  gaps: string[],
): boolean {
  const { record, phaseProof, after } = input
  if (!phaseProof) {
    gaps.push('phase-proof-missing')
    return false
  }
  const afterRequestId = after ? snapshotRequestId(after) : null
  const instanceInSnapshot = (instanceId: string): boolean => {
    if (!after) return false
    return arrayField(after, 'instances').some((entry) => stringField(entry, 'id') === instanceId)
  }
  try {
    if (record.spec.kind === 'create') {
      const proof = phaseProof as RequestCreateEvidence
      const createTarget = record.spec.target
      if (createTarget.phase !== 'REQUEST') gaps.push('phase-proof:wrong-kind-phase')
      if (createTarget.requestId !== null || createTarget.solutionId !== null) gaps.push('create-target-not-rowless')
      assertRequestCreateEvidence(proof)
      if (afterRequestId && proof.requestId !== afterRequestId) gaps.push('phase-proof-request')
      return gaps.length === 0
    }
    if (record.spec.kind === 'submit-solution') {
      const proof = phaseProof as SolutionSubmitEvidence
      const requestId = record.spec.target.requestId
      if (!requestId) {
        gaps.push('target-request-missing')
        return false
      }
      if (record.spec.target.phase !== 'SOLUTION') gaps.push('phase-proof:wrong-kind-phase')
      assertSolutionSubmitEvidence(proof, { requestId, attempt: record.spec.target.expectedAttempt, instanceId: proof.instanceId })
      // Strict freshness: observed route/instance/status fields are mandatory
      // and must agree (revision-3 fresh-phase rules).
      if (proof.observedInstanceId !== proof.instanceId) gaps.push('phase-proof:observed-instance')
      if (proof.observedStatus !== proof.status) gaps.push('phase-proof:observed-status')
      if (!proof.routeSource?.trim() || proof.observedRouteSource !== proof.routeSource) gaps.push('phase-proof:observed-route-source')
      if (!proof.pendingActorIds || proof.pendingActorIds.length === 0) gaps.push('phase-proof:pending-actors')
      if (record.spec.target.routingMode === 'CUSTOM_PERSON') {
        const expected = JSON.parse(JSON.stringify(record.spec.target.expectedChain)) as JsonValue
        if (!proof.pendingApproverIds || stable(proof.pendingApproverIds as unknown) !== stable(expected)
          || !proof.customChainIds || stable(proof.customChainIds as unknown) !== stable(expected)) {
          gaps.push('phase-proof:chain-mismatch')
        }
      }
      if (afterRequestId && proof.requestId !== afterRequestId) gaps.push('phase-proof-request')
      if (proof.instanceId && after && !instanceInSnapshot(proof.instanceId)) gaps.push('phase-proof-instance')
      if (proof.solutionId && after && !arrayField(after, 'solutions').some((entry) => stringField(entry, 'id') === proof.solutionId)) {
        gaps.push('phase-proof-solution')
      }
      return gaps.length === 0
    }
    if (record.spec.kind === 'initiate-final') {
      const proof = phaseProof as FinalInitiationEvidence
      const requestId = record.spec.target.requestId
      if (!requestId) {
        gaps.push('target-request-missing')
        return false
      }
      if (record.spec.target.phase !== 'FINAL') gaps.push('phase-proof:wrong-kind-phase')
      assertFinalInitiationEvidence(proof, {
        requestId,
        customChainIds: record.spec.target.routingMode === 'CUSTOM_PERSON' ? [...record.spec.target.expectedChain] : undefined,
        attempt: record.spec.target.expectedAttempt,
        instanceId: proof.instanceId,
      })
      if (!proof.observedInstanceId || proof.observedInstanceId !== proof.instanceId) gaps.push('phase-proof:observed-instance')
      if (!proof.observedRouteSource || proof.observedRouteSource !== proof.routeSource) gaps.push('phase-proof:observed-route-source')
      if (afterRequestId && proof.requestId !== afterRequestId) gaps.push('phase-proof-request')
      if (proof.instanceId && after && !instanceInSnapshot(proof.instanceId)) gaps.push('phase-proof-instance')
      return gaps.length === 0
    }
    if (record.spec.kind === 'resubmit') {
      const proof = phaseProof as ResubmitEvidence
      const revisionTarget = record.spec.target
      if (!revisionTarget.previous) {
        gaps.push('target-revision-baseline-missing')
        return false
      }
      if (proof.phase !== revisionTarget.phase || revisionTarget.previous.phase !== revisionTarget.phase) {
        gaps.push('phase-proof:resubmit-phase-mismatch')
      }
      if (revisionTarget.expectedAttempt > 0 && proof.newAttempt !== revisionTarget.expectedAttempt) {
        gaps.push('phase-proof:resubmit-attempt-mismatch')
      }
      assertResubmitEvidence(proof, {
        requestId: revisionTarget.requestId ?? proof.requestId,
        previousAttempt: revisionTarget.previous.attempt,
        previousInstanceId: revisionTarget.previous.instanceId,
        customChainIds: revisionTarget.routingMode === 'CUSTOM_PERSON' ? [...revisionTarget.expectedChain] : undefined,
      })
      if (afterRequestId && proof.requestId !== afterRequestId) gaps.push('phase-proof-request')
      if (after && !instanceInSnapshot(proof.newInstanceId)) gaps.push('phase-proof-instance')
      return gaps.length === 0
    }
    if (record.spec.kind === 'approve' || record.spec.kind === 'reject') {
      const decisionTarget = record.spec.target
      if (record.spec.kind === 'approve') {
        const proof = phaseProof as ApprovalEvidence
        assertApprovalEvidence(proof, {
          phase: decisionTarget.phase,
          attempt: decisionTarget.attempt,
          stepOrder: decisionTarget.order,
          actor: record.intendedActor,
          requestId: decisionTarget.requestId,
          instanceId: decisionTarget.instanceId,
        })
        if (proof.order !== decisionTarget.currentOrder) gaps.push('current-turn')
        if (proof.approvalRowId !== decisionTarget.approvalRowId) gaps.push('target-row')
        if (after && !instanceInSnapshot(proof.instanceId)) gaps.push('phase-proof-instance')
      } else {
        const proof = phaseProof as RejectionEvidence
        const projected = record.argumentProjection
        const reason = isJsonObjectRecord(projected) && typeof proof.reason === 'string' && proof.reason.trim() && privateTextMatches(projected.comments,proof.reason) ? proof.reason : null
        if (!reason) {
          gaps.push('rejection-reason-projection')
          return false
        }
        assertRejectionEvidence(proof, {
          phase: decisionTarget.phase,
          requestId: decisionTarget.requestId,
          status: expectedPostRejectStatus(decisionTarget.phase),
          actor: record.intendedActor,
          reason,
          order: decisionTarget.order,
          instanceId: decisionTarget.instanceId,
          attempt: decisionTarget.attempt,
        })
        if (proof.order !== decisionTarget.currentOrder) gaps.push('current-turn')
        if (proof.rejectionRowId !== decisionTarget.approvalRowId) gaps.push('target-row')
        if (after && !instanceInSnapshot(proof.instanceId)) gaps.push('phase-proof-instance')
      }
      if (decisionTarget.routingMode === 'SNAPSHOT_GROUP' && !decisionTarget.candidateGroupId) {
        gaps.push('group-missing')
      }
      if (decisionTarget.candidateUserIds.length > 0 && !decisionTarget.candidateUserIds.includes(record.intendedActor)) {
        gaps.push('actor-not-candidate')
      }
      return gaps.length === 0
    }
    gaps.push(`unsupported-phase-proof-kind:${record.spec.kind}`)
    return false
  } catch (error) {
    gaps.push(`phase-proof:${error instanceof LedgerPolicyError ? error.message : String(error)}`)
    return false
  }
}

export function evaluateAction(input: ActionEvidence): ActionEvaluation {
  const gaps: string[] = []
  const record = input.record

  if (!validateIdentity(record.identity, gaps)) {
    return { outcome: 'EVIDENCE_FAILURE', gaps, commitProven: false, evidenceValid: false, expectedSatisfied: false }
  }
  if (record.stage !== 'resolved') gaps.push('record-stage-attempting')
  if (!record.intendedActor?.trim()) gaps.push('record-actor')

  let expectedHandler: HandlerKey
  try {
    expectedHandler = expectedHandlerFor(record.spec)
  } catch (error) {
    gaps.push(`registry:${error instanceof Error ? error.message : String(error)}`)
    return { outcome: 'EVIDENCE_FAILURE', gaps, commitProven: false, evidenceValid: false, expectedSatisfied: false }
  }
  if (record.spec.handler !== expectedHandler) gaps.push('registry-handler')
  if (!record.spec.target) gaps.push('target-missing')

  // --- dispatch / server presence ---
  const dispatchProof = input.dispatch
  const serverProof = input.server
  if (!dispatchProof) gaps.push('dispatch-missing')
  if (!serverProof) gaps.push('server-missing')

  // --- server-side truth ---
  if (serverProof) {
    if (serverProof.handler !== expectedHandler) gaps.push('server-handler')
    if (serverProof.originalInvoked !== true) gaps.push('server-not-invoked')
    if (serverProof.authObserved !== true) gaps.push('server-auth-unobserved')
    if (!serverProof.actorId?.trim()) gaps.push('server-actor-missing')
    else if (serverProof.actorId !== record.intendedActor) gaps.push('server-actor-mismatch')
    const projected = JSON.parse(JSON.stringify(record.argumentProjection)) as JsonValue
    if (stable(serverProof.argumentProjection) !== stable(projected)) gaps.push('server-arguments-mismatch')
    if (serverProof.observerErrors.length > 0) gaps.push('server-observer-fault')
  }
  const serverTrustsOriginal = serverProof !== null && serverProof.originalInvoked === true && serverProof.authObserved === true
    && serverProof.actorId === record.intendedActor && serverProof.handler === expectedHandler
    && stable(serverProof.argumentProjection) === stable(JSON.parse(JSON.stringify(record.argumentProjection)) as JsonValue)

  // --- build/source binding ---
  const buildBinding = input.binding
  if (!buildBinding) {
    gaps.push('binding-missing')
  } else {
    if (buildBinding.handler !== expectedHandler) gaps.push('binding-handler')
    if (!buildBinding.actionId?.trim()) gaps.push('binding-action-id')
    if (!is64Hex(buildBinding.generatedSourceSha256)) gaps.push('binding-source-sha')
    if (!Number.isInteger(buildBinding.byteOffset) || buildBinding.byteOffset < 0) gaps.push('binding-offset')
    if (!artifactRefValid(buildBinding.chunk)) gaps.push('binding-chunk')
    if (buildBinding.contextId !== record.identity.contextId) gaps.push('binding-context')
    if (serverProof && serverProof.sourceSha256 !== buildBinding.generatedSourceSha256) gaps.push('server-source-mismatch')
    if (dispatchProof && dispatchProof.actionId !== buildBinding.actionId) gaps.push('dispatch-action-mismatch')
  }

  // --- argument/result/temporal semantic gates (Findings 2, 5) ---
  const argumentsBound = validateArgumentsAgainstTarget(record, gaps)
  validateResultCorrelation(input, gaps)
  const originalResultValid = validateOriginalResult(input, gaps)
  validatePreparedDescription(input, gaps)
  validateTemporalAndIdentity(input, gaps)

  // --- snapshots/artifacts, semantic records and transition (Finding 1) ---
  const before = input.before
  const after = input.after
  const snapshotsComplete = !!before && !!after && snapshotArraysComplete(before) && snapshotArraysComplete(after)
  if (!before) gaps.push('before-snapshot-missing')
  if (!after) gaps.push('after-snapshot-missing')
  if (before && !snapshotArraysComplete(before)) gaps.push('before-snapshot-incomplete')
  if (after && !snapshotArraysComplete(after)) gaps.push('after-snapshot-incomplete')
  if (!artifactRefValid(input.beforeArtifact)) gaps.push('before-artifact-missing')
  if (!artifactRefValid(input.afterArtifact)) gaps.push('after-artifact-missing')
  validateDelivery(input, gaps)
  let changed = false
  if (snapshotsComplete && before && after) {
    changed = serializeBusinessSnapshot(before) !== serializeBusinessSnapshot(after)
  }

  // --- transition + phase proof: run only where they decide commit truth
  // --- (Finding 7: unrelated capture gaps must not erase commit facts).
  // Approval source stores truthy whitespace verbatim; authenticate its exact typed value below.
  const actualCommentValue = arrayField(after ?? {approvalRows:[]} as unknown as BusinessSnapshot,'approvalRows').find(r=>r.id === ('approvalRowId' in record.spec.target ? record.spec.target.approvalRowId : null))?.comments
  const actualComment = typeof actualCommentValue === 'string' ? actualCommentValue : null
  const reason = isJsonObjectRecord(record.argumentProjection) ? same(record.argumentProjection.comments,projectPrivateText('')) ? '' : privateTextMatches(record.argumentProjection.comments,actualComment) ? actualComment : null : null
  let transitionValid = false
  let phaseProofValidForCommit = false
  if (record.spec.kind !== 'deny-stale' && serverProof?.transaction === 'resolved') {
    // Only positive transactions need a positive business-transition proof.
    transitionValid = validateActualTransition(input, expectedHandler, reason, gaps)
  }
  if (serverProof && serverProof.transaction === 'resolved') {
    phaseProofValidForCommit = validatePhaseProofForCommit(input, expectedHandler, gaps)
  }
  const commitProven = serverTrustsOriginal && !!serverProof && serverProof.transaction === 'resolved'
    && phaseProofValidForCommit && transitionValid && snapshotsComplete && changed
    && argumentsBound && originalResultValid
    && !!buildBinding && buildBinding.handler === expectedHandler
    && is64Hex(serverProof.sourceSha256) && serverProof.sourceSha256 === buildBinding.generatedSourceSha256
    && !(serverProof.exit.state === 'returned' && returnedSuccessFalse(serverProof.exit))
  if (serverProof && serverProof.transaction === 'resolved' && !commitProven) {
    gaps.push('commit-unproven-despite-resolved-transaction')
  }

  // --- stale-specific gates (Finding 3) ---
  const staleValid = validateStaleDenial(input, gaps)

  // --- outcome discrimination (fail closed) ---
  const dispatchResultState = dispatchProof?.result.state ?? null
  const serverExitState = serverProof?.exit.state ?? null
  if (dispatchResultState && serverExitState && dispatchResultState !== serverExitState) {
    gaps.push('exit-state-mismatch')
  }

  let outcome: LifecycleOutcome = 'EVIDENCE_FAILURE'
  if (serverProof && serverProof.originalInvoked === false) {
    outcome = 'OBSERVER_FAILED_BEFORE_INVOCATION'
  } else if (!dispatchProof) {
    outcome = 'QUEUED_OR_UNOBSERVED_DISPATCH'
  } else if (dispatchProof.result.state === 'missing') {
    outcome = 'DISPATCHED_RESPONSE_ABSENT'
    gaps.push('response-absent')
  } else if (serverExitState === 'thrown') {
    if (record.spec.kind === 'deny-stale' && staleValid) {
      outcome = 'DENIED_UNCHANGED'
    } else if (commitProven) {
      outcome = 'COMMITTED_BUT_UI_FAILED'
      gaps.push('thrown-exit-after-commit')
    } else if (serverProof && (serverProof.transaction === 'rejected' || serverProof.transaction === 'not-started')) {
      if (!snapshotsComplete) {
        outcome = 'EVIDENCE_FAILURE'
        gaps.push('noncommit-without-snapshots')
      } else if (changed) {
        outcome = 'EVIDENCE_FAILURE'
        gaps.push('noncommit-with-changed-state')
      } else if (record.spec.kind === 'deny-stale') {
        // A thrown error that is not the source-bound denial is unexpected
        // evidence failure, not stale coverage.
        outcome = 'EVIDENCE_FAILURE'
        if (!gaps.some((gap) => gap.startsWith('stale-'))) gaps.push('stale-denial-not-source-bound')
      } else {
        outcome = 'THROWN_NONCOMMITTING'
      }
    } else {
      outcome = 'EVIDENCE_FAILURE'
      gaps.push('throw-without-transaction-resolution')
    }
  } else if (serverExitState === 'returned') {
    if (commitProven) {
      outcome = input.uiConfirmed ? 'COMMITTED_AND_UI_CONFIRMED' : 'COMMITTED_BUT_UI_FAILED'
      if (!input.uiConfirmed) gaps.push('ui-confirmation-missing')
    } else if (serverProof && serverProof.transaction === 'resolved') {
      outcome = 'EVIDENCE_FAILURE'
      gaps.push(returnedSuccessFalse(serverProof.exit)
        ? 'resolved-transaction-with-success-false'
        : 'resolved-transaction-without-transition-proof')
    } else if (!snapshotsComplete) {
      outcome = 'EVIDENCE_FAILURE'
      gaps.push('noncommit-without-snapshots')
    } else if (changed) {
      outcome = 'EVIDENCE_FAILURE'
      gaps.push('noncommit-with-changed-state')
    } else if (record.spec.kind === 'deny-stale') {
      outcome = staleValid ? 'DENIED_UNCHANGED' : 'EVIDENCE_FAILURE'
      if (!staleValid && !gaps.some((gap) => gap.startsWith('stale-'))) gaps.push('stale-denial-not-source-bound')
    } else {
      outcome = 'RETURNED_NONCOMMITTING'
    }
  } else {
    outcome = 'EVIDENCE_FAILURE'
  }

  const evidenceValid = gaps.length === 0 && (outcome === 'COMMITTED_AND_UI_CONFIRMED'
    || outcome === 'THROWN_NONCOMMITTING' || outcome === 'RETURNED_NONCOMMITTING' || outcome === 'DENIED_UNCHANGED')
  const expectedSatisfied = evidenceValid
    && (record.spec.kind === 'deny-stale'
      ? outcome === 'DENIED_UNCHANGED'
      : outcome === 'COMMITTED_AND_UI_CONFIRMED')
  return { outcome, gaps, commitProven, evidenceValid, expectedSatisfied }
}

/** Complete paired-equality gate with Finding 6 correlation: a stale pair must
 *  carry THE action evidence for the SAME subject — semantic equality of
 *  before/after snapshots and exact artifact-reference agreement. */
export function assertNegativePair(input: NegativePair): void {
  if (!snapshotArraysComplete(input.before)) throw new LedgerPolicyError(`negative pair ${input.id}: before snapshot is missing required array evidence`)
  if (!snapshotArraysComplete(input.after)) throw new LedgerPolicyError(`negative pair ${input.id}: after snapshot is missing required array evidence`)
  if (!artifactRefValid(input.beforeArtifact) || !artifactRefValid(input.afterArtifact)) {
    throw new LedgerPolicyError(`negative pair ${input.id}: missing immutable before/after artifact reference`)
  }
  if (input.before.terminal && input.after.terminal) {
    assertSnapshotsEqual(input.before.terminal, input.after.terminal)
  } else if ((input.before.terminal === null) !== (input.after.terminal === null)) {
    throw new LedgerPolicyError(`negative pair ${input.id}: terminal presence changed`)
  }
  if (serializeBusinessSnapshot(input.before) !== serializeBusinessSnapshot(input.after)) {
    const fields: (keyof BusinessSnapshot)[] = ['request', 'solutions', 'instances', 'approvalRows', 'groups', 'activities', 'notifications', 'mail', 'terminal']
    const changedField = fields.find((field) => stable(input.before[field]) !== stable(input.after[field])) ?? 'unknown'
    throw new LedgerPolicyError(`negative pair ${input.id}: stale/UI-only unchanged proof violated — ${String(changedField)} changed`)
  }
  if (input.kind === 'stale') {
    if (!input.action) {
      throw new LedgerPolicyError(`negative pair ${input.id}: stale denial requires the dispatched action evidence; UI-only absence cannot stand in`)
    }
    // Correlation: the pair must be THE action's own immediate pair (Finding 6).
    const action = input.action
    if (!action.before || !action.after) throw new LedgerPolicyError(`negative pair ${input.id}: action snapshots missing`)
    if (serializeBusinessSnapshot(action.before) !== serializeBusinessSnapshot(input.before)
      || serializeBusinessSnapshot(action.after) !== serializeBusinessSnapshot(input.after)) {
      throw new LedgerPolicyError(`negative pair ${input.id}: pair snapshots do not correlate with the action's own before/after subject`)
    }
    if (!same(action.beforeArtifact, input.beforeArtifact) || !same(action.afterArtifact, input.afterArtifact)) {
      throw new LedgerPolicyError(`negative pair ${input.id}: pair artifact references do not match the action's own before/after artifact references`)
    }
    if (action.record.spec.kind !== 'deny-stale' || action.record.spec.current.status !== input.after.terminal?.status) {
      throw new LedgerPolicyError(`negative pair ${input.id}: action held/current identity does not match the pair subject`)
    }
    const evaluation = evaluateAction(action)
    if (evaluation.outcome !== 'DENIED_UNCHANGED' || !evaluation.evidenceValid || !evaluation.expectedSatisfied) {
      throw new LedgerPolicyError(`negative pair ${input.id}: stale action evidence did not prove the unchanged denial (${evaluation.outcome}: ${evaluation.gaps.join('; ')})`)
    }
  } else if (input.action !== null) {
    throw new LedgerPolicyError(`negative pair ${input.id}: UI-only pair must not carry a fabricated action proof`)
  }
}

// ---------------------------------------------------------------------------
// Task4 full business snapshot producer: one read-only SELECT assembling the
// complete canonical BusinessSnapshot subject (request, solutions, instances,
// approval rows with table discriminant, captured groups + members,
// activities, notifications). Mail evidence is owned by the runtime mail
// capture, not SQL, so it is joined by the caller. Row JSON is full-row; the
// request subject is null only before a create has been validated.
// ---------------------------------------------------------------------------

export function businessSnapshotSql(requestId: string): string {
  const id = sqlText(requestId)
  return assertReadOnlySingleSelect(`
    select json_build_object(
      'request', (select json_build_object('id', r.id, 'title', r.title, 'description', r.description, 'status', r.status::text, 'requesterId', r."requesterId", 'organizationUnitId', r."organizationUnitId", 'createdAt', r."createdAt", 'updatedAt', r."updatedAt", 'projectEstimateCost', r."projectEstimateCost"::text) from requests r where r.id = ${id}),
      'solutions', coalesce((select json_agg(json_build_object('id', s.id, 'requestId', s."requestId", 'title', s.title, 'description', s.description, 'costEstimate', s."costEstimate"::text, 'currency', s.currency, 'timeline', s.timeline, 'conceptDesign', s."conceptDesign", 'submittedById', s."submittedById", 'submittedAt', s."submittedAt", 'createdAt', s."createdAt", 'updatedAt', s."updatedAt") order by s."createdAt", s.id) from solutions s where s."requestId" = ${id}), '[]'::json),
      'instances', coalesce((select json_agg(json_build_object('id', i.id, 'phase', i.phase::text, 'requestId', i."requestId", 'solutionId', i."solutionId", 'attempt', i.attempt, 'state', i.state::text, 'supersededAt', i."supersededAt", 'routingMode', i."routingMode"::text, 'routeVersionId', i."routeVersionId", 'originUserId', i."originUserId", 'originUnitId', i."originUnitId", 'originAssignmentId', i."originAssignmentId", 'originPositionId', i."originPositionId", 'createdAt', i."createdAt") order by i.phase, i.attempt) from approval_instances i where i."requestId" = ${id} or i."solutionId" in (select s2.id from solutions s2 where s2."requestId" = ${id})), '[]'::json),
      'approvalRows', coalesce((select json_agg(rows order by rows."instanceId", rows."order") from (
        select t.id, 'request_approvals'::text as "table", t."instanceId", t."order", t.status::text as status, t."approverId", t.comments, t."approvedAt", t."createdAt", t."requiredApproverId", t."requiredPositionId", t."candidateGroupId", t."routingMode"::text as "routingMode", t."requestId", null::text as "solutionId", t."isFinalApproval"
        from request_approvals t where t."requestId" = ${id}
        union all
        select t.id, 'solution_approvals'::text as "table", t."instanceId", t."order", t.status::text as status, t."approverId", t.comments, t."approvedAt", t."createdAt", t."requiredApproverId", t."requiredPositionId", t."candidateGroupId", t."routingMode"::text as "routingMode", null::text as "requestId", t."solutionId", null::boolean as "isFinalApproval"
        from solution_approvals t join solutions s3 on s3.id = t."solutionId" where s3."requestId" = ${id}
      ) rows), '[]'::json),
      'groups', coalesce((select json_agg(json_build_object('id', g.id, 'approvalInstanceId', g."approvalInstanceId", 'scopeUnitId', g."scopeUnitId", 'requiredPositionId', g."requiredPositionId", 'capturedAt', g."capturedAt", 'members', coalesce((select json_agg(json_build_object('candidateGroupId', m."candidateGroupId", 'userId', m."userId", 'capturedAt', m."capturedAt", 'capturedDisplayName', m."capturedDisplayName") order by m."userId") from approval_candidate_group_members m where m."candidateGroupId" = g.id), '[]'::json)) order by g.id) from approval_candidate_groups g where g."approvalInstanceId" in (select i2.id from approval_instances i2 where i2."requestId" = ${id} or i2."solutionId" in (select s2.id from solutions s2 where s2."requestId" = ${id}))), '[]'::json),
      'activities', coalesce((select json_agg(row_to_json(a) order by a."createdAt", a.id) from request_activities a where a."requestId" = ${id}), '[]'::json),
      'notifications', coalesce((select json_agg(row_to_json(n) order by n."createdAt", n.id) from notifications n where n."requestId" = ${id}), '[]'::json)
    )::text
  `)
}

// ---------------------------------------------------------------------------
// Task5: pure strict-assurance plan, authority, qualification verification and
// pass inventory. No allocation, no clearance granting, no live evidence: the
// parent owns the authority lane and persists plan/clearance/authority
// snapshots outside these functions. Everything here fails closed on schema,
// digest/size, lineage, namespace and identity mismatches. Legacy
// (historical-legacy) compatibility can never qualify either fresh pass.
// ---------------------------------------------------------------------------

export type ArtifactReader = (ref: ArtifactRef) => Promise<Uint8Array>
export type ArtifactWriter = (path: string, bytes: Uint8Array) => Promise<ArtifactRef>

export interface ProfileInvocation {
  pass: 1 | 2
  invocation: number
  invocationId: string
  profile: RouteProfile
  caseIds: readonly string[]
}

export interface AssurancePlanManifest {
  planId: string
  sourceMode: 'strict-assurance'
  invocations: readonly ProfileInvocation[]
}

export interface OwnerClearedInvocation {
  plan: ArtifactRef
  slot: ProfileInvocation
  clearanceId: string
  sourceMode: 'strict-assurance'
  evidenceRoot: string
  approvedSource: ArtifactRef
}

export interface AssuranceAuthority {
  plan: ArtifactRef
  clearances: readonly ArtifactRef[]
  qualifiedInvocations: readonly ArtifactRef[]
  acceptedPasses: readonly ArtifactRef[]
}

export interface ClearedInvocationContext {
  authority: ArtifactRef
  manifest: ArtifactRef
  value: OwnerClearedInvocation
}

export interface RuntimeProvenance {
  authority: ArtifactRef
  clearanceManifest: ArtifactRef
  slot: ProfileInvocation
  runId: string
  sourceMode: 'strict-assurance'
  evidenceRoot: string
  ownedRoot: string
  approvedSource: ArtifactRef
  observerManifest: ArtifactRef
  ownedIdentity: ArtifactRef
  freshEmptyFixture: ArtifactRef
}

export interface CaseRunBinding { binding: RunBinding; caseId: string }
export interface CaseProvenance extends CaseRunBinding { requestId: string }
export interface NegativeProofArtifact { provenance: CaseProvenance; pair: NegativePair }
export interface CompletedCaseProof {
  provenance: CaseProvenance
  completed: CompletedEvidence
  snapshot: BusinessSnapshot
  snapshotArtifact: ArtifactRef
}
export interface CaseQualification {
  schema: 'strict-assurance-case-v3'
  provenance: CaseProvenance
  actions: readonly ArtifactRef[]
  negatives: readonly ArtifactRef[]
  completed: ArtifactRef
  traces: readonly ArtifactRef[]
  artifactIndex: ArtifactRef
}
export interface GateReceipt {
  gate: 'owned-stop' | 'native-check' | 'visual-review' | 'independent-review' | 'parent-acceptance'
  runtimeManifest: ArtifactRef
  caseQualifications: readonly ArtifactRef[]
  verdict: 'accepted'
  evidence: readonly ArtifactRef[]
}
export interface InvocationQualification {
  runtimeManifest: ArtifactRef
  caseResults: readonly ArtifactRef[]
  ownedStop: ArtifactRef
  nativeCheck: ArtifactRef
  visualReview: ArtifactRef
  independentReview: ArtifactRef
  parentAcceptance: ArtifactRef
}
export interface CompletedCaseEntry {
  provenance: CaseProvenance
  caseResult: ArtifactRef
  caseQualification: ArtifactRef
  invocationQualification: ArtifactRef
}
export interface VerifiedPassInventory {
  schema: 'strict-assurance-pass-v3'
  sourceMode: 'strict-assurance'
  pass: 1 | 2
  authority: ArtifactRef
  completed: readonly CompletedCaseEntry[]
  invocations: readonly ArtifactRef[]
}

const PLAN_KEYS = ['planId', 'sourceMode', 'invocations'] as const
const SLOT_KEYS = ['pass', 'invocation', 'invocationId', 'profile', 'caseIds'] as const
const CLEARANCE_KEYS = ['plan', 'slot', 'clearanceId', 'sourceMode', 'evidenceRoot', 'approvedSource'] as const
const AUTHORITY_KEYS = ['plan', 'clearances', 'qualifiedInvocations', 'acceptedPasses'] as const

function canonicalRecord(value: unknown, keys: readonly string[], label: string): JsonRecord {
  if (!isJsonObjectRecord(value)) throw new LedgerPolicyError(`${label}: not a JSON object`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new LedgerPolicyError(`${label}: non-canonical schema (${actual.join(',')})`)
  }
  return value
}

function refFrom(value: unknown, label: string): ArtifactRef {
  if (!artifactRefValid(value as ArtifactRef | undefined)) throw new LedgerPolicyError(`${label}: invalid artifact reference`)
  return value as ArtifactRef
}

function refsFrom(value: unknown, label: string): ArtifactRef[] {
  if (!Array.isArray(value)) throw new LedgerPolicyError(`${label}: artifact reference list expected`)
  return value.map((item, index) => refFrom(item, `${label}[${index}]`))
}

function sameRef(a: ArtifactRef, b: ArtifactRef): boolean {
  return a.path === b.path && a.sha256 === b.sha256 && a.bytes === b.bytes
}

function expectBytes(label: string, bytes: Uint8Array, ref: ArtifactRef): unknown {
  if (bytes.length !== ref.bytes) throw new LedgerPolicyError(`${label}: archived byte size ${bytes.length} != ${ref.bytes}`)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== ref.sha256) throw new LedgerPolicyError(`${label}: archived digest ${digest} != ${ref.sha256}`)
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch (error) {
    throw new LedgerPolicyError(`${label}: archived bytes are not canonical JSON (${error instanceof Error ? error.message : String(error)})`)
  }
}

/** Canonical strict-assurance plan for the eight profile-pass slots. Pure
 *  derivation from PROFILE_ORDER/buildInventory: invocations 1–4 are pass 1
 *  and 5–8 are pass 2, each slot owning exactly one profile's inventory
 *  membership (12/11/11/10). Allocates no runtime and grants no clearance. */
export function buildEvidenceRunPlan(planId: string): readonly ProfileInvocation[] {
  if (!planId.trim()) throw new LedgerPolicyError('assurance plan requires a non-empty planId')
  const inventory = buildInventory()
  return PROFILE_ORDER.flatMap((profile, index) => {
    const caseIds = inventory.filter((row) => row.profile === profile).map((row) => row.id)
    const pass1: ProfileInvocation = { pass: 1, invocation: index + 1, invocationId: `${planId}:invocation-${index + 1}`, profile, caseIds }
    const pass2: ProfileInvocation = { pass: 2, invocation: index + 5, invocationId: `${planId}:invocation-${index + 5}`, profile, caseIds }
    return [pass1, pass2]
  }).sort((a, b) => a.invocation - b.invocation)
}

function slotFrom(value: unknown, label: string): ProfileInvocation {
  const record = canonicalRecord(value, SLOT_KEYS, label)
  const pass = record.pass as unknown
  const invocation = record.invocation as unknown
  const profile = record.profile as unknown
  if ((pass !== 1 && pass !== 2) || !Number.isInteger(invocation) || (invocation as number) < 1 || (invocation as number) > 8
    || typeof record.invocationId !== 'string' || !record.invocationId.trim()
    || !PROFILE_ORDER.includes(profile as RouteProfile) || !Array.isArray(record.caseIds)
    || record.caseIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new LedgerPolicyError(`${label}: invalid profile-pass slot`)
  }
  return { pass: pass as 1 | 2, invocation: invocation as number, invocationId: record.invocationId, profile: profile as RouteProfile, caseIds: [...record.caseIds] as string[] }
}

function planFrom(value: unknown): AssurancePlanManifest {
  const record = canonicalRecord(value, PLAN_KEYS, 'assurance plan')
  if (record.sourceMode !== 'strict-assurance' || typeof record.planId !== 'string' || !record.planId.trim() || !Array.isArray(record.invocations)) {
    throw new LedgerPolicyError('assurance plan must be a strict-assurance manifest with a planId and slot list')
  }
  const invocations = record.invocations.map((slot, index) => slotFrom(slot, `plan slot ${index}`))
  const expected = buildEvidenceRunPlan(record.planId)
  if (invocations.length !== 8
    || invocations.some((slot, index) => slot.invocation !== index + 1
      || slot.pass !== (index < 4 ? 1 : 2)
      || slot.invocationId !== `${record.planId}:invocation-${index + 1}`
      || slot.profile !== expected[index].profile
      || stable(slot.caseIds) !== stable(expected[index].caseIds))) {
    throw new LedgerPolicyError('assurance plan slots do not match the canonical eight-slot derivation')
  }
  return { planId: record.planId, sourceMode: 'strict-assurance', invocations }
}

function authorityFrom(value: unknown): AssuranceAuthority {
  const record = canonicalRecord(value, AUTHORITY_KEYS, 'assurance authority')
  const authority: AssuranceAuthority = {
    plan: refFrom(record.plan, 'authority.plan'),
    clearances: refsFrom(record.clearances, 'authority.clearances'),
    qualifiedInvocations: refsFrom(record.qualifiedInvocations, 'authority.qualifiedInvocations'),
    acceptedPasses: refsFrom(record.acceptedPasses, 'authority.acceptedPasses'),
  }
  const seen = new Set<string>()
  for (const ref of [...authority.clearances, ...authority.qualifiedInvocations, ...authority.acceptedPasses]) {
    const key = stable(ref)
    if (seen.has(key)) throw new LedgerPolicyError('assurance authority repeats one artifact reference across lane entries')
    seen.add(key)
  }
  return authority
}

function clearanceFrom(value: unknown): OwnerClearedInvocation {
  const record = canonicalRecord(value, CLEARANCE_KEYS, 'owner clearance')
  if (record.sourceMode !== 'strict-assurance' || typeof record.clearanceId !== 'string' || !record.clearanceId.trim()
    || typeof record.evidenceRoot !== 'string' || !pathIsAbsoluteEvidenceRoot(record.evidenceRoot)) {
    throw new LedgerPolicyError('owner clearance must pin strict-assurance mode and an absolute evidence root')
  }
  return {
    plan: refFrom(record.plan, 'clearance.plan'),
    slot: slotFrom(record.slot, 'clearance.slot'),
    clearanceId: record.clearanceId,
    sourceMode: 'strict-assurance',
    evidenceRoot: record.evidenceRoot,
    approvedSource: refFrom(record.approvedSource, 'clearance.approvedSource'),
  }
}

function pathIsAbsoluteEvidenceRoot(root: string): boolean {
  return pathPosixLike(root)
}

function pathPosixLike(root: string): boolean {
  return root.startsWith('/') || /^[A-Za-z]:[\\/]/.test(root)
}

/** Read the parent-pinned authority and its plan, then the ONE clearance whose
 *  slot carries exactly this owner invocation id. The slot must occur exactly
 *  once in the pinned plan; the clearance must be pinned in authority
 *  clearances and must repeat the same slot, plan reference, mode, root and
 *  approved source. Legacy mode never reaches a cleared context. */
export async function loadClearedInvocation(input: {
  authority: ArtifactRef
  invocationId: string
  readArtifact: ArtifactReader
}): Promise<ClearedInvocationContext> {
  if (!input.invocationId.trim()) throw new LedgerPolicyError('owner invocation id is required')
  const authority = authorityFrom(expectBytes('authority', await input.readArtifact(input.authority), input.authority))
  const plan = planFrom(expectBytes('assurance plan', await input.readArtifact(authority.plan), authority.plan))
  const slots = plan.invocations.filter((slot) => slot.invocationId === input.invocationId)
  if (slots.length !== 1) throw new LedgerPolicyError(`invocation ${input.invocationId} must occur exactly once in the pinned plan (${slots.length})`)
  const slot = slots[0]
  let matched: OwnerClearedInvocation | null = null
  let matchedRef: ArtifactRef | null = null
  for (const ref of authority.clearances) {
    const candidate = clearanceFrom(expectBytes('owner clearance', await input.readArtifact(ref), ref))
    if (candidate.slot.invocationId === input.invocationId) {
      if (matched) throw new LedgerPolicyError(`multiple pinned clearances claim invocation ${input.invocationId}`)
      if (!sameRef(candidate.plan, authority.plan)) throw new LedgerPolicyError('clearance pins a different plan reference than the authority')
      if (stable(candidate.slot) !== stable(slot)) throw new LedgerPolicyError('clearance slot does not equal the canonical plan slot')
      matched = candidate
      matchedRef = ref
    }
  }
  if (!matched || !matchedRef) throw new LedgerPolicyError(`no owner clearance pinned for invocation ${input.invocationId}`)
  return { authority: input.authority, manifest: matchedRef, value: matched }
}

function runBindingFrom(value: unknown, label: string): RunBinding {
  const record = canonicalRecord(value, ['pass', 'invocation', 'invocationId', 'profile', 'runId', 'sourceMode', 'evidenceRoot', 'clearanceManifest', 'runtimeManifest'], label)
  const binding: RunBinding = {
    pass: record.pass as 1 | 2,
    invocation: record.invocation as number,
    invocationId: record.invocationId as string,
    profile: record.profile as RouteProfile,
    runId: record.runId as string,
    sourceMode: record.sourceMode as SourceMode,
    evidenceRoot: record.evidenceRoot as string,
    clearanceManifest: refFrom(record.clearanceManifest, `${label}.clearanceManifest`),
    runtimeManifest: refFrom(record.runtimeManifest, `${label}.runtimeManifest`),
  }
  const gaps: string[] = []
  if (!validateIdentityFields(binding, gaps) && gaps.length > 0) throw new LedgerPolicyError(`${label}: ${gaps.join('; ')}`)
  if (binding.sourceMode !== 'strict-assurance') throw new LedgerPolicyError(`${label}: legacy source mode can never qualify`)
  return binding
}

function validateIdentityFields(identity: RunBinding, gaps: string[]): boolean {
  let ok = true
  const fail = (gap: string): void => { gaps.push(gap); ok = false }
  if (identity.pass !== 1 && identity.pass !== 2) fail('pass')
  if (!Number.isInteger(identity.invocation) || (identity.invocation as number) < 1 || (identity.invocation as number) > 8) fail('invocation-slot')
  if (typeof identity.invocationId !== 'string' || !identity.invocationId.trim()) fail('invocation-id')
  if (!PROFILE_ORDER.includes(identity.profile)) fail('profile')
  if (typeof identity.runId !== 'string' || !identity.runId.trim()) fail('run-id')
  if (typeof identity.evidenceRoot !== 'string' || !pathIsAbsoluteEvidenceRoot(identity.evidenceRoot)) fail('evidence-root')
  return ok
}

function caseProvenanceFrom(value: unknown): CaseProvenance {
  const record = canonicalRecord(value, ['binding', 'caseId', 'requestId'], 'case provenance')
  if (typeof record.caseId !== 'string' || !record.caseId.trim() || typeof record.requestId !== 'string' || !record.requestId.trim()) {
    throw new LedgerPolicyError('case provenance requires real case and request ids')
  }
  return { binding: runBindingFrom(record.binding, 'case provenance binding'), caseId: record.caseId, requestId: record.requestId }
}

function gateReceiptFrom(value: unknown, label: string): GateReceipt {
  const record = canonicalRecord(value, ['gate', 'runtimeManifest', 'caseQualifications', 'verdict', 'evidence'], label)
  if (record.verdict !== 'accepted') throw new LedgerPolicyError(`${label}: verdict must be accepted`)
  if (!['owned-stop', 'native-check', 'visual-review', 'independent-review', 'parent-acceptance'].includes(String(record.gate))) {
    throw new LedgerPolicyError(`${label}: unknown gate`)
  }
  const evidence = refsFrom(record.evidence, `${label}.evidence`)
  if (evidence.length === 0) throw new LedgerPolicyError(`${label}: accepted receipt requires nonempty supporting evidence`)
  return {
    gate: record.gate as GateReceipt['gate'],
    runtimeManifest: refFrom(record.runtimeManifest, `${label}.runtimeManifest`),
    caseQualifications: refsFrom(record.caseQualifications, `${label}.caseQualifications`),
    verdict: 'accepted',
    evidence,
  }
}

const CASE_RESULT_KEYS = ['caseId', 'requestTitle', 'status', 'staleNegative', 'caseBinding', 'provenance', 'qualification'] as const
const CASE_QUALIFICATION_KEYS = ['schema', 'provenance', 'actions', 'negatives', 'completed', 'traces', 'artifactIndex'] as const
const COMPLETED_PROOF_KEYS = ['provenance', 'completed', 'snapshot', 'snapshotArtifact'] as const
const NEGATIVE_ENVELOPE_KEYS = ['provenance', 'pair'] as const
const INVOCATION_QUALIFICATION_KEYS = ['runtimeManifest', 'caseResults', 'ownedStop', 'nativeCheck', 'visualReview', 'independentReview', 'parentAcceptance'] as const
const RUNTIME_PROVENANCE_KEYS = ['authority', 'clearanceManifest', 'slot', 'runId', 'sourceMode', 'evidenceRoot', 'ownedRoot', 'approvedSource', 'observerManifest', 'ownedIdentity', 'freshEmptyFixture'] as const

async function loadEnvelope<T>(label: string, ref: ArtifactRef, keys: readonly string[], reader: ArtifactReader, build: (record: JsonRecord) => T): Promise<T> {
  const record = canonicalRecord(expectBytes(label, await reader(ref), ref), keys, label)
  return build(record)
}

function requireUnderApprovedRoot(ref: ArtifactRef, roots: readonly string[], label: string): void {
  const normalized = ref.path.replaceAll('\\', '/')
  if (!roots.some((root) => normalized.startsWith(root.replaceAll('\\', '/').replace(/\/$/, '') + '/'))) {
    throw new LedgerPolicyError(`${label}: artifact ${ref.path} is outside every approved evidence root`)
  }
}

/** Verify one completed case entry end to end against the parent-pinned
 *  authority: digest/size of every reference, lineage agreement between the
 *  case result, qualification, runtime provenance, owner clearance and plan
 *  slot, strict re-evaluation of every action and negative with the retained
 *  Task1 gates, and every external receipt bound to the exact runtime
 *  manifest and complete case qualifications. Returns the canonical loaded
 *  provenance; nothing is trusted from caller labels. */
export async function verifyCompletedCaseEntry(input: {
  expectedAuthority: ArtifactRef
  entry: CompletedCaseEntry
  readArtifact: ArtifactReader
}): Promise<CaseProvenance> {
  const reader = input.readArtifact
  const entryRecord = canonicalRecord(input.entry as unknown as JsonRecord, ['provenance', 'caseResult', 'caseQualification', 'invocationQualification'], 'completed case entry')
  const provenance = caseProvenanceFrom(entryRecord.provenance)
  const caseResultRef = refFrom(entryRecord.caseResult, 'entry.caseResult')
  const caseQualificationRef = refFrom(entryRecord.caseQualification, 'entry.caseQualification')
  const invocationQualificationRef = refFrom(entryRecord.invocationQualification, 'entry.invocationQualification')

  const authority = authorityFrom(expectBytes('authority', await reader(input.expectedAuthority), input.expectedAuthority))
  const plan = planFrom(expectBytes('assurance plan', await reader(authority.plan), authority.plan))
  const slot = plan.invocations.find((candidate) => candidate.invocationId === provenance.binding.invocationId)
  if (!slot || stable(slot) !== stable(plan.invocations[slot.invocation - 1])) {
    throw new LedgerPolicyError(`case ${provenance.caseId}: binding invocation is not the pinned canonical slot`)
  }
  if (slot.profile !== provenance.binding.profile || slot.pass !== provenance.binding.pass || slot.invocation !== provenance.binding.invocation) {
    throw new LedgerPolicyError(`case ${provenance.caseId}: binding slot fields disagree with the pinned plan`)
  }
  if (!slot.caseIds.includes(provenance.caseId)) throw new LedgerPolicyError(`case ${provenance.caseId} is not a member of the pinned slot`)

  const caseResult = canonicalRecord(expectBytes('case result', await reader(caseResultRef), caseResultRef), CASE_RESULT_KEYS as unknown as string[], 'case result')
  if (caseResult.caseId !== provenance.caseId || caseResult.status !== 'passed') {
    throw new LedgerPolicyError(`case ${provenance.caseId}: only passed case results qualify`)
  }
  if (stable(caseResult.provenance) !== stable(provenance as unknown as JsonRecord)) {
    throw new LedgerPolicyError(`case ${provenance.caseId}: case result provenance drift`)
  }
  if (caseResult.qualification !== null && stable(caseResult.qualification) !== stable(caseQualificationRef as unknown as JsonRecord)) {
    throw new LedgerPolicyError(`case ${provenance.caseId}: case result pins a different qualification reference`)
  }

  const qualification = await loadEnvelope('case qualification', caseQualificationRef, CASE_QUALIFICATION_KEYS as unknown as string[], reader, (record) => ({
    schema: record.schema,
    provenance: caseProvenanceFrom(record.provenance),
    actions: refsFrom(record.actions, 'qualification.actions'),
    negatives: refsFrom(record.negatives, 'qualification.negatives'),
    completed: refFrom(record.completed, 'qualification.completed'),
    traces: refsFrom(record.traces, 'qualification.traces'),
    artifactIndex: refFrom(record.artifactIndex, 'qualification.artifactIndex'),
  }))
  if (qualification.schema !== 'strict-assurance-case-v3') throw new LedgerPolicyError('case qualification schema must be strict-assurance-case-v3')
  if (stable(qualification.provenance as unknown as JsonRecord) !== stable(provenance as unknown as JsonRecord)) {
    throw new LedgerPolicyError('case qualification provenance drift')
  }

  const runtimeProvenance = await loadEnvelope('runtime provenance', provenance.binding.runtimeManifest, RUNTIME_PROVENANCE_KEYS as unknown as string[], reader, (record) => ({
    authority: refFrom(record.authority, 'runtime authority'),
    clearanceManifest: refFrom(record.clearanceManifest, 'runtime clearanceManifest'),
    slot: slotFrom(record.slot, 'runtime slot'),
    runId: record.runId as string,
    sourceMode: record.sourceMode as string,
    evidenceRoot: record.evidenceRoot as string,
    ownedRoot: record.ownedRoot as string,
    approvedSource: refFrom(record.approvedSource, 'runtime approvedSource'),
    observerManifest: refFrom(record.observerManifest, 'runtime observerManifest'),
    ownedIdentity: refFrom(record.ownedIdentity, 'runtime ownedIdentity'),
    freshEmptyFixture: refFrom(record.freshEmptyFixture, 'runtime freshEmptyFixture'),
  }))
  if (runtimeProvenance.sourceMode !== 'strict-assurance' || typeof runtimeProvenance.ownedRoot !== 'string' || !pathIsAbsoluteEvidenceRoot(runtimeProvenance.ownedRoot)) {
    throw new LedgerPolicyError('runtime provenance must pin strict-assurance mode and an absolute owned root')
  }
  if (!sameRef(runtimeProvenance.authority, input.expectedAuthority)) throw new LedgerPolicyError('runtime provenance pins a different authority than the parent expected')
  if (runtimeProvenance.runId !== provenance.binding.runId || runtimeProvenance.evidenceRoot !== provenance.binding.evidenceRoot) {
    throw new LedgerPolicyError('runtime provenance run/identity disagrees with the case binding')
  }
  if (stable(runtimeProvenance.slot) !== stable(slot)) throw new LedgerPolicyError('runtime provenance slot drift')
  if (!sameRef(runtimeProvenance.clearanceManifest, provenance.binding.clearanceManifest)) {
    throw new LedgerPolicyError('case binding clearance manifest does not match the runtime provenance')
  }
  // The served/generated source identity is verified through the observer
  // manifest artifact (a SourceGuard manifest is re-read and compared against
  // every action's BuildBinding.generatedSourceSha256), never a mode string.
  const observerManifestBytes = await reader(runtimeProvenance.observerManifest)
  if (observerManifestBytes.length !== runtimeProvenance.observerManifest.bytes) throw new LedgerPolicyError('observer manifest size drift')
  const observerManifest = JSON.parse(Buffer.from(observerManifestBytes).toString('utf8')) as ObserverManifestLike
  if (!observerManifest || observerManifest.compiled !== true || !Array.isArray(observerManifest.generated)) {
    throw new LedgerPolicyError('runtime provenance must carry a compiled observer copy manifest')
  }

  const evidenceRoots = [provenance.binding.evidenceRoot.replaceAll('\\', '/')]
  for (const ref of qualification.actions) requireUnderApprovedRoot(ref, evidenceRoots, 'qualification action')
  for (const ref of qualification.negatives) requireUnderApprovedRoot(ref, evidenceRoots, 'qualification negative')
  requireUnderApprovedRoot(qualification.completed, evidenceRoots, 'qualification completed')
  for (const ref of qualification.traces) requireUnderApprovedRoot(ref, evidenceRoots, 'qualification trace')
  requireUnderApprovedRoot(qualification.artifactIndex, evidenceRoots, 'qualification artifact index')
  requireUnderApprovedRoot(caseResultRef, evidenceRoots, 'case result')

  let sawPositive = false
  let sawNegative = false
  const actionIdentities: string[] = []
  for (const ref of qualification.actions) {
    const record = canonicalRecord(expectBytes('action evidence', await reader(ref), ref), ['record', 'binding', 'dispatch', 'server', 'before', 'after', 'beforeArtifact', 'afterArtifact', 'phaseProof', 'uiConfirmed'], 'action evidence')
    const evidence = record as unknown as ActionEvidence
    if (stable(evidence.record.identity) !== stable({ ...provenance.binding, caseId: provenance.caseId, contextId: evidence.record.identity.contextId, sequence: evidence.record.identity.sequence })) {
      throw new LedgerPolicyError(`action evidence identity does not inherit the verified run binding (${provenance.caseId})`)
    }
    if (evidence.record.identity.caseId !== provenance.caseId) throw new LedgerPolicyError('action evidence case drift')
    const evaluation = evaluateAction(evidence)
    if (!evaluation.evidenceValid || !evaluation.expectedSatisfied) {
      throw new LedgerPolicyError(`action ${ref.path} failed strict re-evaluation: ${evaluation.outcome} (${evaluation.gaps.join('; ')})`)
    }
    if (evidence.record.spec.kind === 'deny-stale') sawNegative = true
    else sawPositive = true
    actionIdentities.push(`${evidence.record.spec.kind}:${evidence.record.identity.sequence}`)
    if (evidence.binding && evidence.server && evidence.binding.generatedSourceSha256 !== evidence.server.sourceSha256) {
      throw new LedgerPolicyError('action served-build binding does not match the observed source')
    }
    if (evidence.record.spec.kind === 'create') {
      const createProof = evidence.phaseProof as RequestCreateEvidence | null
      if (!createProof || createProof.requestId !== provenance.requestId) {
        throw new LedgerPolicyError('requestId must come from the validated persisted create proof')
      }
    }
  }
  if (!sawPositive) throw new LedgerPolicyError('case qualification must contain the expected positive actions')
  if (new Set(actionIdentities).size !== actionIdentities.length) throw new LedgerPolicyError('duplicate action identities inside one case qualification')

  for (const ref of qualification.negatives) {
    const envelope = await loadEnvelope('negative proof artifact', ref, NEGATIVE_ENVELOPE_KEYS as unknown as string[], reader, (record) => ({
      provenance: caseProvenanceFrom(record.provenance),
      pair: record.pair as unknown as NegativePair,
    }))
    if (stable(envelope.provenance as unknown as JsonRecord) !== stable(provenance as unknown as JsonRecord)) {
      throw new LedgerPolicyError('negative proof envelope provenance does not match the case')
    }
    assertNegativePair(envelope.pair)
    sawNegative = true
  }

  const completedProof = await loadEnvelope('completed case proof', qualification.completed, COMPLETED_PROOF_KEYS as unknown as string[], reader, (record) => ({
    provenance: caseProvenanceFrom(record.provenance),
    completed: record.completed as unknown as CompletedEvidence,
    snapshot: record.snapshot as unknown as BusinessSnapshot,
    snapshotArtifact: refFrom(record.snapshotArtifact, 'completed snapshotArtifact'),
  }))
  if (stable(completedProof.provenance as unknown as JsonRecord) !== stable(provenance as unknown as JsonRecord)) {
    throw new LedgerPolicyError('completed case proof provenance drift')
  }
  assertCompletedEvidence(completedProof.completed)
  const snapshotBytes = Buffer.from(serializeBusinessSnapshot(completedProof.snapshot), 'utf8')
  if (snapshotBytes.length !== completedProof.snapshotArtifact.bytes
    || createHash('sha256').update(snapshotBytes).digest('hex') !== completedProof.snapshotArtifact.sha256) {
    throw new LedgerPolicyError('completed snapshot artifact digest/size does not match the canonical serialization')
  }
  if (completedProof.completed.requestId !== provenance.requestId) throw new LedgerPolicyError('completed proof requestId drift')
  // Completed means CURRENT phases with no carried approvals: every persisted
  // instance must be its peers' latest attempt and nothing may remain pending.
  const instances = completedProof.snapshot.instances
  for (const candidate of instances) {
    if (!isJsonObject(candidate)) throw new LedgerPolicyError('completed snapshot instance drift')
    const peers = instances.filter((peer) => isJsonObject(peer) && peer.phase === candidate.phase && peer.requestId === candidate.requestId && peer.solutionId === candidate.solutionId)
    if (peers.some((peer) => isJsonObject(peer) && Number(peer.attempt) > Number(candidate.attempt))) {
      throw new LedgerPolicyError('completed snapshot retains a superseded instance as current')
    }
  }
  for (const row of completedProof.snapshot.approvalRows) {
    if (isJsonObject(row) && row.status === 'pending') throw new LedgerPolicyError('completed snapshot retains pending approval rows')
  }

  const invocationQualification = await loadEnvelope('invocation qualification', invocationQualificationRef, INVOCATION_QUALIFICATION_KEYS as unknown as string[], reader, (record) => ({
    runtimeManifest: refFrom(record.runtimeManifest, 'invocation runtimeManifest'),
    caseResults: refsFrom(record.caseResults, 'invocation caseResults'),
    ownedStop: refFrom(record.ownedStop, 'invocation ownedStop'),
    nativeCheck: refFrom(record.nativeCheck, 'invocation nativeCheck'),
    visualReview: refFrom(record.visualReview, 'invocation visualReview'),
    independentReview: refFrom(record.independentReview, 'invocation independentReview'),
    parentAcceptance: refFrom(record.parentAcceptance, 'invocation parentAcceptance'),
  }))
  if (!sameRef(invocationQualification.runtimeManifest, provenance.binding.runtimeManifest)) {
    throw new LedgerPolicyError('invocation qualification is bound to a different runtime manifest')
  }
  if (!invocationQualification.caseResults.some((ref) => sameRef(ref, caseResultRef))) {
    throw new LedgerPolicyError('invocation qualification does not list this case result')
  }
  const receipts = [
    { label: 'owned-stop', ref: invocationQualification.ownedStop },
    { label: 'native-check', ref: invocationQualification.nativeCheck },
    { label: 'visual-review', ref: invocationQualification.visualReview },
    { label: 'independent-review', ref: invocationQualification.independentReview },
    { label: 'parent-acceptance', ref: invocationQualification.parentAcceptance },
  ] as const
  for (const receipt of receipts) {
    const loaded = gateReceiptFrom(expectBytes(receipt.label, await reader(receipt.ref), receipt.ref), receipt.label)
    if (!sameRef(loaded.runtimeManifest, provenance.binding.runtimeManifest)) {
      throw new LedgerPolicyError(`${receipt.label} receipt is not subject-bound to the exact runtime manifest`)
    }
    if (!loaded.caseQualifications.some((ref) => sameRef(ref, caseQualificationRef))) {
      throw new LedgerPolicyError(`${receipt.label} receipt does not cover this case qualification`)
    }
  }
  return provenance
}

interface ObserverManifestLike { compiled?: boolean; generated?: unknown }

/** Consume the parent-pinned authority and verify a complete pass inventory.
 *  expectedAuthority is always the parent-pinned reference — never recovered
 *  from submitted entries. Pass 1 requires an empty priorAccepted; pass 2
 *  requires exactly the pinned pass1 acceptance from authority.acceptedPasses
 *  and revalidates its whole inventory against its own authority. Every entry
 *  is verified with verifyCompletedCaseEntry; membership, namespace, runtime
 *  grouping and request uniqueness are enforced across the union. */
export async function assertPassInventory(input: {
  pass: 1 | 2
  expectedAuthority: ArtifactRef
  completed: readonly CompletedCaseEntry[]
  priorAccepted: readonly ArtifactRef[]
  readArtifact: ArtifactReader
}): Promise<VerifiedPassInventory> {
  const authority = authorityFrom(expectBytes('authority', await input.readArtifact(input.expectedAuthority), input.expectedAuthority))
  const plan = planFrom(expectBytes('assurance plan', await input.readArtifact(authority.plan), authority.plan))
  const passSlots = plan.invocations.filter((slot) => slot.pass === input.pass)
  if (passSlots.length !== 4) throw new LedgerPolicyError('a pass must own exactly four canonical slots')

  let pinnedPrior: VerifiedPassInventory | null = null
  if (input.pass === 1) {
    if (input.priorAccepted.length !== 0) throw new LedgerPolicyError('pass 1 inventory cannot accept prior accepted passes')
  } else {
    if (input.priorAccepted.length !== 1) throw new LedgerPolicyError('pass 2 requires exactly the pinned pass 1 acceptance')
    if (!authority.acceptedPasses.some((ref) => sameRef(ref, input.priorAccepted[0]))) {
      throw new LedgerPolicyError('pass 1 acceptance must be pinned in authority acceptedPasses')
    }
    const priorRecord = canonicalRecord(expectBytes('prior accepted pass', await input.readArtifact(input.priorAccepted[0]), input.priorAccepted[0]), ['schema', 'sourceMode', 'pass', 'authority', 'completed', 'invocations'], 'prior accepted pass')
    if (priorRecord.schema !== 'strict-assurance-pass-v3' || priorRecord.sourceMode !== 'strict-assurance' || priorRecord.pass !== 1) {
      throw new LedgerPolicyError('pinned prior acceptance is not a strict-assurance pass 1 inventory')
    }
    pinnedPrior = {
      schema: 'strict-assurance-pass-v3',
      sourceMode: 'strict-assurance',
      pass: 1,
      authority: refFrom(priorRecord.authority, 'prior authority'),
      completed: (priorRecord.completed as readonly CompletedCaseEntry[]).map((entry) => entry),
      invocations: refsFrom(priorRecord.invocations, 'prior invocations'),
    }
    // Revalidate the complete pass 1 lineage under ITS OWN pinned authority;
    // totals and labels of the prior inventory are never trusted.
    const priorEntries = []
    for (const entry of pinnedPrior.completed) priorEntries.push(await verifyCompletedCaseEntry({ expectedAuthority: pinnedPrior.authority, entry, readArtifact: input.readArtifact }))
    if (priorEntries.length !== 44) throw new LedgerPolicyError('pinned pass 1 acceptance must carry 44 verified entries')
  }

  if (input.completed.length !== 44) throw new LedgerPolicyError(`pass ${input.pass} inventory requires exactly 44 entries (received ${input.completed.length})`)
  const bySlot = new Map<string, CompletedCaseEntry[]>()
  const seenCase = new Set<string>()
  const seenRequest = new Set<string>()
  for (const entry of input.completed) {
    const record = canonicalRecord(entry as unknown as JsonRecord, ['provenance', 'caseResult', 'caseQualification', 'invocationQualification'], 'completed case entry')
    const provenance = caseProvenanceFrom(record.provenance)
    if (provenance.binding.pass !== input.pass) throw new LedgerPolicyError(`entry pass label ${provenance.binding.pass} does not match the intended pass`)
    if (seenCase.has(provenance.caseId)) throw new LedgerPolicyError(`duplicate case ${provenance.caseId}`)
    if (seenRequest.has(provenance.requestId)) throw new LedgerPolicyError(`duplicate request id ${provenance.requestId}`)
    seenCase.add(provenance.caseId)
    seenRequest.add(provenance.requestId)
    const slot = passSlots.find((candidate) => candidate.invocationId === provenance.binding.invocationId)
    if (!slot) throw new LedgerPolicyError(`entry invocation ${provenance.binding.invocationId} is not a pass ${input.pass} slot`)
    const bucket = bySlot.get(slot.invocationId) ?? []
    bucket.push(entry)
    bySlot.set(slot.invocationId, bucket)
  }
  if (bySlot.size !== 4) throw new LedgerPolicyError('pass entries must cover exactly four distinct invocation slots')
  const namespaceSeen = new Set<string>()
  const runtimeSeen = new Map<string, { runtimeManifest: ArtifactRef; runId: string; ownedRoot: string }>()
  for (const slot of passSlots) {
    const bucket = bySlot.get(slot.invocationId)
    if (!bucket || bucket.length !== slot.caseIds.length || stable([...bucket.map((entry) => entry.provenance.caseId)].sort()) !== stable([...slot.caseIds].sort())) {
      throw new LedgerPolicyError(`slot ${slot.invocationId} membership does not equal the canonical ${slot.caseIds.length}-case profile inventory`)
    }
    let runtime: { runtimeManifest: ArtifactRef; runId: string; ownedRoot: string } | null = null
    for (const entry of bucket) {
      const provenance = await verifyCompletedCaseEntry({ expectedAuthority: input.expectedAuthority, entry, readArtifact: input.readArtifact })
      const current = { runtimeManifest: provenance.binding.runtimeManifest, runId: provenance.binding.runId, ownedRoot: '' }
      const runtimeRecord = canonicalRecord(expectBytes('runtime provenance', await input.readArtifact(provenance.binding.runtimeManifest), provenance.binding.runtimeManifest), RUNTIME_PROVENANCE_KEYS as unknown as string[], 'runtime provenance')
      current.ownedRoot = String(runtimeRecord.ownedRoot)
      if (!runtime) runtime = current
      else if (stable(runtime) !== stable(current)) throw new LedgerPolicyError(`slot ${slot.invocationId} cases do not share one identical runtime`)
      const namespace = `${provenance.binding.evidenceRoot.replaceAll('\\', '/')}|${provenance.binding.profile}`
      if (namespaceSeen.has(namespace)) throw new LedgerPolicyError(`artifact namespace ${namespace} collides across slots`)
      namespaceSeen.add(namespace)
    }
    if (!runtime) throw new LedgerPolicyError(`slot ${slot.invocationId} has no entries`)
    runtimeSeen.set(slot.invocationId, runtime)
  }
  const runtimeKeys = [...runtimeSeen.values()].map((runtime) => stable(runtime))
  if (new Set(runtimeKeys).size !== 4) throw new LedgerPolicyError('each slot requires a distinct runtime manifest/runId/ownedRoot')
  if (pinnedPrior) {
    const priorNamespaces = new Set<string>()
    const priorRequests = new Set<string>()
    for (const entry of pinnedPrior.completed) {
      const provenance = await verifyCompletedCaseEntry({ expectedAuthority: pinnedPrior.authority, entry, readArtifact: input.readArtifact })
      priorNamespaces.add(`${provenance.binding.evidenceRoot.replaceAll('\\', '/')}|${provenance.binding.profile}`)
      priorRequests.add(provenance.requestId)
    }
    for (const namespace of namespaceSeen) {
      if (priorNamespaces.has(namespace)) throw new LedgerPolicyError(`pass 2 reuses pass 1 artifact namespace ${namespace}`)
    }
    for (const entry of input.completed) {
      if (priorRequests.has((entry.provenance as CaseProvenance).requestId)) throw new LedgerPolicyError('request id reused across passes')
    }
  }
  const qualified = authority.qualifiedInvocations
  const invocations: ArtifactRef[] = []
  for (const slot of passSlots) {
    let match: ArtifactRef | null = null
    for (const ref of qualified) {
      const runtime = canonicalRecord(expectBytes('qualified invocation', await input.readArtifact(ref), ref), RUNTIME_PROVENANCE_KEYS as unknown as string[], 'qualified invocation')
      const runtimeSlot = slotFrom(runtime.slot, 'qualified invocation slot')
      if (runtimeSlot.invocationId === slot.invocationId) {
        if (match) throw new LedgerPolicyError(`authority pins multiple qualified invocations for ${slot.invocationId}`)
        match = ref
      }
    }
    if (!match) throw new LedgerPolicyError(`pass ${input.pass} slot ${slot.invocationId} has no pinned qualified invocation`)
    invocations.push(match)
  }
  return {
    schema: 'strict-assurance-pass-v3',
    sourceMode: 'strict-assurance',
    pass: input.pass,
    authority: input.expectedAuthority,
    completed: [...input.completed],
    invocations,
  }
}


// ---------------------------------------------------------------------------
// Clock calibration V3 (clock-only scope, lane A). Canonical wire types plus
// the pure sampler, exact BigInt rational bounds and strict exact containment
// guard. STRICTLY ADDITIVE: every pre-existing declaration above — including
// the accepted Task1 evaluator — stays byte-identical. This pure math API
// returns arithmetic results and typed failures only; it never mints
// authority (no `verified` labels, no provenance verdicts). The provenance
// verifier, native bridge lifecycle and production consumers belong to later
// lanes (B/C) and are intentionally NOT implemented here; only their DTO
// types are declared.
// ---------------------------------------------------------------------------

/** Canonical lowercase 8-4-4-4-12 hex UUID string. */
export type ClockUuidV3 = string
/** Canonical decimal uint64 string: "0" or "1".."18446744073709551615". */
export type ClockUint64DecimalV3 = string
/** Canonical role domains; matching labels never waive measured proof. */
export type ClockRoleDomainV3 = 'matrix-context-capture' | 'observer'
/** Numeric mark representation: observer renders raw P, host Math.round(P). */
export type ClockRepresentationV3 = 'raw-ms' | 'host-rounded-ms'
/** Reviewed Node basis: B=hrtime bigint, P=performance.now(), A=hrtime bigint. */
export type ClockBasisV3 = 'node-hrtime-bigint-performance-now'

/** Selected Darwin kernel birth identity (PROC_PIDUNIQIDENTIFIERINFO +
 *  kern.bootsessionuuid). uniqueId rejects PID reuse, idVersion disallows
 *  exec; canonical uint64 decimal, int32 and UUID forms are required. */
export interface NativeBirthV3 {
  bootUuid: ClockUuidV3
  pid: number
  uniqueId: ClockUint64DecimalV3
  idVersion: number
  executableUuid: string
}

/** One selected live native read: birth tuple plus observed parent edge and
 *  selected numeric status/flags. parentUniqueId is an edge observation, NOT
 *  part of immutable birth identity. Readers reject SZOMB and in-exit flags. */
export interface NativeProcessReadV3 extends NativeBirthV3 {
  ppid: number
  parentUniqueId: ClockUint64DecimalV3
  status: number
  flags: number
}

/** Existing host absolute monotonic deadline shared by all nested host IO. */
export interface DeadlineV3 { domain: string; expiresMs: number; now: () => number }

/** Canonical exact rational: reduced decimal numerator, positive denominator,
 *  integer numerators carry no "-0". Bounded operand sizes are enforced. */
export interface ClockRationalV3 { numerator: string; denominator: string }

/** Synchronous reader triple for one sample bracket. Actual Node production
 *  readers are provided by the emitter (B lane); tests inject pure fakes. */
export interface ClockReadersV3 {
  sharedNs: () => bigint
  performanceMs: () => number
  wallMs: () => number
}

/** All nonreading metadata of a ClockSampleV3. No caller-supplied authority
 *  flag exists: trust comes only from later verification lanes. */
export interface ClockSamplerDescriptorV3 {
  schema: 'rrm-clock-sampler-v3'
  scopeId: string
  clockInstanceId: ClockUuidV3
  sequence: number
  domain: ClockRoleDomainV3
  representation: ClockRepresentationV3
  basis: ClockBasisV3
  nativeBirth: NativeBirthV3
  observedParent: { pid: number; parentUniqueId: ClockUint64DecimalV3 }
  rootScopeObservedRef: ArtifactRef
}

/** Raw V2 sample embedded in a mark (schema rrm-clock-sample-v2). Later
 *  emitters add the self-acquisition lease/registration/completion refs and
 *  the actual measured {startedNs,finishedNs,localBudgetMs:1000}; the
 *  verifier recomputes that duration and requires finishedNs<=sharedBeforeNs. */
export interface ClockSampleV3 {
  schema: 'rrm-clock-sample-v2'
  scopeId: string
  clockInstanceId: ClockUuidV3
  sequence: number
  domain: ClockRoleDomainV3
  representation: ClockRepresentationV3
  basis: ClockBasisV3
  nativeBirth: NativeBirthV3
  observedParent: { pid: number; parentUniqueId: ClockUint64DecimalV3 }
  rootScopeObservedRef: ArtifactRef
  sharedBeforeNs: ClockUint64DecimalV3
  rawPerformanceMs: number
  sharedAfterNs: ClockUint64DecimalV3
  selfAcquisition?: {
    leaseRef: ArtifactRef
    registrationRef: ArtifactRef | null
    completionRef: ArtifactRef
    startedNs: ClockUint64DecimalV3
    finishedNs: ClockUint64DecimalV3
    localBudgetMs: 1000
  }
}

/** Immutable action-bound source pointer into a raw snapshot. */
export interface ClockSourceSelectorV3 { snapshotRef: ArtifactRef; selector: string }

/** Actual endpoint marks for one cross-domain envelope with raw source
 *  snapshot refs/selectors for each. */
export interface ClockEndpointSetV3 {
  schema: 'rrm-clock-endpoints-v3'
  scopeId: string
  recordStart: ClockMark
  dispatchStart: ClockMark
  dispatchEnd: ClockMark
  serverStart: ClockMark
  serverEnd: ClockMark
  sources: {
    record: ClockSourceSelectorV3
    dispatchStart: ClockSourceSelectorV3
    dispatchEnd: ClockSourceSelectorV3
    serverStart: ClockSourceSelectorV3
    serverEnd: ClockSourceSelectorV3
  }
}

/** Exact rational host→observer mapping bounds with the outward numeric
 *  projection: lowerMs<=exactLower, upperMs>=exactUpper, c = nearest-float
 *  midpoint of the widened exact interval, u = outward-up max distance. */
export interface ClockBoundsV3 {
  schema: 'rrm-clock-bounds-v3'
  scopeId: string
  fromDomain: string
  toDomain: string
  exactLowerMs: ClockRationalV3
  exactUpperMs: ClockRationalV3
  lowerMs: number
  upperMs: number
  offsetMs: number
  uncertaintyMs: number
}

/** Verdict recomputed from stored numbers only; it carries arithmetic bits,
 *  never authority. contained requires every bit and zero gaps. */
export interface ClockContainmentVerdictV3 {
  schema: 'rrm-clock-containment-verdict-v3'
  contained: boolean
  numericProjectionOk: boolean
  exactGuardOk: boolean
  boundsCoverageOk: boolean
  boundsProjectionOk: boolean
  endpointsCoherent: boolean
  gaps: readonly string[]
}

// --- verifier/root/probe DTO types (lane A declares; later owners implement) ---

/** Source/configuration metadata available BEFORE observer self-acquisition
 *  or the root scope read. No future observer birth/parent or root hash is
 *  required. Completion consumes the acquired identity and observed root
 *  reference; pure construction does not authenticate either input. */
export interface ClockPreRootDescriptorV3 {
  schema: 'rrm-clock-preroot-descriptor-v3'
  scopeId: string
  clockInstanceId: ClockUuidV3
  domain: ClockRoleDomainV3
  representation: ClockRepresentationV3
  basis: ClockBasisV3
}

/** Unlike an eventual observer, the driver's actual identity is already
 *  known when the seed is written. It remains explicit seed metadata. */
export interface ClockDriverPreRootDescriptorV3 extends ClockPreRootDescriptorV3 {
  nativeBirth: NativeBirthV3
  observedParent: { pid: number; parentUniqueId: ClockUint64DecimalV3 }
}

/** Created after valid pre-allocation authority/source admission, before copy
 *  generation. purpose marks pure compiler/generated-module fixtures;
 *  production root binding and native qualification reject offline-fixture
 *  seeds. Contains no future worker admission. */
export interface ClockScopeSeedV3 {
  schema: 'rrm-clock-scope-seed-v3'
  purpose: 'native' | 'offline-fixture'
  scopeId: string
  preRuntimeSubject: Omit<RunBinding, 'runtimeManifest'>
  approvedSourceRef: ArtifactRef
  toolPolicyRef: ArtifactRef
  ownedNamespaces: readonly string[]
  driverDescriptor: ClockDriverPreRootDescriptorV3
}

/** Written once before browser admissions; references completed seed/copy/
 *  runtime/source/ownership/tool artifacts and the actual driver and app-root
 *  birth tuples. Contains NO observer-worker list and NO generation proofs. */
export interface ClockRootScopeV3 {
  schema: 'rrm-clock-root-scope-v3'
  subject: RunBinding
  seedRef: ArtifactRef
  copyManifestRef: ArtifactRef
  runtimeManifestRef: ArtifactRef
  sourceRef: ArtifactRef
  nativeOwnerRef: ArtifactRef
  toolPolicyRef: ArtifactRef
  driverBirth: NativeBirthV3
  appRootBirth: NativeBirthV3
  clockProbeRoot: string
}

/** One fixed dual ancestry observation edge (child→parent). */
export interface ClockAncestryEdgeV3 { child: NativeProcessReadV3; parent: NativeProcessReadV3 }

/** Binds one actual ActionIdentity/role/clock-instance/birth to the root
 *  scope with raw source selectors, the recorded AND independently current
 *  matching native birth, and the fixed dual ancestry collections. Host
 *  proofs match the actual driver instead of app ancestry. */
export interface ClockProducerGenerationProofV3 {
  schema: 'rrm-clock-generation-proof-v3'
  identity: ActionIdentity
  roleDomain: ClockRoleDomainV3
  clockInstanceId: ClockUuidV3
  rootScopeRef: ArtifactRef
  sourceSnapshots: readonly ClockSourceSelectorV3[]
  recordedBirth: NativeBirthV3
  currentBirth: NativeProcessReadV3
  ancestry: {
    walkOne: readonly ClockAncestryEdgeV3[]
    walkTwo: readonly ClockAncestryEdgeV3[]
    rootBefore: NativeProcessReadV3
    rootAfter: NativeProcessReadV3
  }
  selfAcquisition: NonNullable<ClockSampleV3['selfAcquisition']>
}

/** References root scope, host/observer generation proofs, raw endpoint
 *  snapshot refs and the recomputable bounds + numeric projection. */
export interface ClockCalibrationProofV3 {
  schema: 'rrm-clock-calibration-proof-v3'
  identity: ActionIdentity
  rootScopeRef: ArtifactRef
  hostGenerationProofRef: ArtifactRef
  observerGenerationProofRef: ArtifactRef
  endpointSetRef: ArtifactRef
  bounds: ClockBoundsV3
}

/** Computed ONLY by the future verifier after all source/process/raw-byte/
 *  bounds/exact-guard checks; never trusted from deserialization. Carries the
 *  old inline calibration shape only once all checks pass. */
export interface VerifiedClockCalibrationV3 {
  schema: 'rrm-clock-verified-calibration-v3'
  identity: ActionIdentity
  rootScopeRef: ArtifactRef
  calibration: { fromDomain: string; toDomain: string; offsetMs: number; uncertaintyMs: number; verified: true }
}

/** Observer bootstrap handed to the private emitted self-acquisition: fixed
 *  root scope/probe paths and pinned policy/source refs. Contains NO client
 *  deadline: the synchronous seam follows the separate local-cap contract.
 *  sourceDescriptor is source/configuration metadata only: bootstrap exists
 *  before observer birth/parent acquisition and before the root scope read. */
export interface ClockObserverBootstrapV3 {
  schema: 'rrm-clock-observer-bootstrap-v3'
  seedRef: ArtifactRef
  protocolId: string
  appDir: string
  rootScopePath: string
  probeRoot: string
  toolPolicyRef: ArtifactRef
  sourceDescriptor: ClockPreRootDescriptorV3
}

/** Result of the private synchronous observer self lookup (B lane emits it).
 *  Synchronous return only; no Promise. */
export interface ClockSelfAcquisitionV3 {
  schema: 'rrm-clock-self-acquisition-v3'
  birth: NativeBirthV3
  parent: { pid: number; parentUniqueId: ClockUint64DecimalV3 }
  leaseRef: ArtifactRef
  registrationRef: ArtifactRef | null
  completionRef: ArtifactRef
  startedNs: ClockUint64DecimalV3
  finishedNs: ClockUint64DecimalV3
}

/** Fixed typed native metadata result: selected identity/lineage or a fixed
 *  failure code. Never raw buffers/stderr/exception dumps. */
export type ClockNativeReadFailureCodeV3 =
  | 'unavailable' | 'denied' | 'exited' | 'changed' | 'invalid-abi'
  | 'invalid-response' | 'deadline-elapsed' | 'unsupported-platform'
export type NativeReadResultV3 =
  | { ok: true; kind: 'single'; read: NativeProcessReadV3 }
  | { ok: true; kind: 'lineage'; reads: readonly NativeProcessReadV3[] }
  | { ok: false; failure: { code: ClockNativeReadFailureCodeV3; detail: string } }

/** Input DTO for R readNativeClockProcessV3 (fixed U→B→U read semantics,
 *  shared absolute host deadline). */
export interface ClockNativeReadInputV3 {
  pid: number
  mode: 'single' | 'lineage'
  expectedRoot?: NativeBirthV3
  deadline: DeadlineV3
}

/** Diagnostic probe ledger DTOs. Acyclic order: NativeAppGroupStopFactV3 →
 *  ClockProbeCleanupClosureV3/sealed index → final owned-stop receipt; the
 *  index may reference raw probe records but never the final receipt. */
export interface ClockProbeLeaseV3 {
  schema: 'rrm-clock-probe-lease-v3'
  scopeId: string
  probeId: ClockUuidV3
  clockInstanceId: ClockUuidV3
  ownerPidHint: number
  role: ClockRoleDomainV3
  rootScopeRef: ArtifactRef
  localPolicy: { localBudgetMs: number }
  mode: 'observer-self' | 'host-driver'
  context: string
  createdAtNs: ClockUint64DecimalV3
}
export interface ClockProbeRegistrationV3 {
  schema: 'rrm-clock-probe-registration-v3'
  leaseRef: ArtifactRef
  helperBirth: NativeBirthV3
  ownerBirth: NativeBirthV3
  pgid: number
  sessionId: number
}
export interface ClockProbeCompletionV3 {
  schema: 'rrm-clock-probe-completion-v3'
  leaseRef: ArtifactRef
  registrationRef: ArtifactRef | null
  spawnPid: number | null
  status: number | null
  signal: string | null
  outcome: 'returned' | 'timeout' | 'error' | 'not-spawned'
  elapsedNs: ClockUint64DecimalV3
  sourceAssociation: string
}
export interface ClockProbeSealV3 {
  schema: 'rrm-clock-probe-seal-v3'
  scopeId: string
  sealedAtNs: ClockUint64DecimalV3
  reason: string
}
export interface ClockProbeCleanupClosureV3 {
  schema: 'rrm-clock-probe-cleanup-closure-v3'
  leaseRef: ArtifactRef
  closure: 'closed-by-owned-group-stop' | 'closed-by-tracked-exit' | 'quarantined'
  evidenceRef: ArtifactRef
}
export interface NativeAppGroupStopFactV3 {
  schema: 'rrm-clock-native-app-group-stop-fact-v3'
  rootBirth: NativeBirthV3
  groupEmpty: boolean
  stopInvocationRef: ArtifactRef
}

/** Typed failure for pure clock math: additive, fail-closed, no authority. */
export type ClockMathErrorCodeV3 =
  | 'invalid-descriptor' | 'invalid-readers' | 'invalid-samples' | 'invalid-endpoints'
  | 'invalid-bounds' | 'empty-sample-intersection' | 'process-mix' | 'domain-mismatch'
export class ClockMathErrorV3 extends Error {
  constructor(readonly code: ClockMathErrorCodeV3, message: string) {
    super(message)
    this.name = 'ClockMathErrorV3'
  }
}

// --- exact rational core (bounded BigInt; never Number(bigint) cancellation) ---

interface ClockRat { n: bigint; d: bigint }

const CLOCK_UINT64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1)
// Bounded representation (repair of independent-review finding 5, aligned
// with exact binary64 needs): admitted inputs are P < 2^53 (including
// subnormals down to 2^-1074, whose exact decode carries a 2^1074
// denominator) and uint64 nanoseconds scaled by 1e6. Worst-case reduced
// operands therefore reach ~1140 bits (value×denominator products over the
// lcm of binary64 and 1e6 scales). 1280 bits with margin keeps every derivable
// fraction consumable by the companion validator — derive must never emit a
// bound the validator would reject as oversized.
const CLOCK_RAT_MAX_BITS = 1280
// Decimal digits bound enforced BEFORE BigInt conversion (repair of finding
// 7): 1280 bits ≈ 386 decimal digits; 400 gives margin. Also bounds uint64
// decimals at their exact 20-digit maximum.
const CLOCK_RAT_MAX_DECIMAL_DIGITS = 400
const CLOCK_UINT64_MAX_DECIMAL_DIGITS = 20
const CLOCK_MAX_SAFE_MS = 2 ** 53
const CLOCK_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CLOCK_EXECUTABLE_UUID_PATTERN = /^[0-9a-f]{32}$/
const CLOCK_UINT64_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/
const CLOCK_INTEGER_DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)$/

const clockF64 = new Float64Array(1)
const clockF64Bits = new BigUint64Array(clockF64.buffer)

function clockBitLength(v: bigint): number {
  return v.toString(2).length
}

function clockGcd(a: bigint, b: bigint): bigint {
  let x = a < BigInt(0) ? -a : a
  let y = b < BigInt(0) ? -b : b
  while (y !== BigInt(0)) { const t = x % y; x = y; y = t }
  return x
}

function clockRatReduce(n: bigint, d: bigint): ClockRat {
  if (d === BigInt(0)) throw new ClockMathErrorV3('invalid-bounds', 'rational denominator is zero')
  if (d < BigInt(0)) { n = -n; d = -d }
  if (n === BigInt(0)) return { n: BigInt(0), d: BigInt(1) }
  const g = clockGcd(n, d)
  return { n: n / g, d: d / g }
}

function clockRatAdd(a: ClockRat, b: ClockRat): ClockRat {
  return clockRatReduce(a.n * b.d + b.n * a.d, a.d * b.d)
}
function clockRatSub(a: ClockRat, b: ClockRat): ClockRat {
  return clockRatReduce(a.n * b.d - b.n * a.d, a.d * b.d)
}
function clockRatCmp(a: ClockRat, b: ClockRat): number {
  const l = a.n * b.d
  const r = b.n * a.d
  return l < r ? -1 : l > r ? 1 : 0
}
function clockRatHalfSum(a: ClockRat, b: ClockRat): ClockRat {
  return clockRatReduce(a.n * b.d + b.n * a.d, a.d * b.d * BigInt(2))
}
function clockRatSerialize(r: ClockRat): ClockRationalV3 {
  return { numerator: r.n.toString(), denominator: r.d.toString() }
}

/** Exact finite binary64 decode. Rejects non-finite input. */
function clockRatFromNumber(x: number): ClockRat {
  if (!Number.isFinite(x)) throw new ClockMathErrorV3('invalid-bounds', 'non-finite number has no exact rational')
  if (x === 0) return { n: BigInt(0), d: BigInt(1) }
  clockF64[0] = x
  const bits = clockF64Bits[0]
  const sign = (bits >> BigInt(63)) & BigInt(1)
  const biased = Number((bits >> BigInt(52)) & BigInt(0x7ff))
  const frac = bits & ((BigInt(1) << BigInt(52)) - BigInt(1))
  let n: bigint
  let d: bigint
  if (biased === 0) {
    n = frac
    d = BigInt(1) << BigInt(1074)
  } else {
    n = frac | (BigInt(1) << BigInt(52))
    const shift = biased - 1075
    if (shift >= 0) { n <<= BigInt(shift); d = BigInt(1) } else { d = BigInt(1) << BigInt(-shift) }
  }
  if (sign === BigInt(1)) n = -n
  return clockRatReduce(n, d)
}

function clockNormalizedNumber(x: number): number {
  return Object.is(x, -0) ? 0 : x
}

/** q = round-half-even(num/den) with den > 0, num >= 0. Fully exact. */
function clockDivRoundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den
  const rem = num - q * den
  const twice = rem * BigInt(2)
  if (twice > den || (twice === den && q % BigInt(2) !== BigInt(0))) return q + BigInt(1)
  return q
}

/** Unique e with 2^e <= a < 2^(e+1). */
function clockExactExponent(a: ClockRat): number {
  let e = clockBitLength(a.n) - clockBitLength(a.d)
  const pow2 = (k: number): ClockRat => k >= 0
    ? { n: BigInt(1) << BigInt(k), d: BigInt(1) }
    : { n: BigInt(1), d: BigInt(1) << BigInt(-k) }
  while (clockRatCmp(a, pow2(e)) < 0) e -= 1
  while (clockRatCmp(a, pow2(e + 1)) >= 0) e += 1
  return e
}

function clockAssembleNormal(mantissa: bigint, exponent: number): number {
  const frac = mantissa - (BigInt(1) << BigInt(52))
  clockF64Bits[0] = (BigInt(exponent + 1023) << BigInt(52)) | frac
  return clockF64[0]
}

function clockAssembleSubnormal(k: bigint): number {
  clockF64Bits[0] = k
  return clockF64[0]
}

/** Nearest binary64 to r with ties-to-even (IEEE Number semantics), exact. */
function clockRatToNearestFloat(r: ClockRat): number {
  if (r.n === BigInt(0)) return 0
  const negative = r.n < BigInt(0)
  const a: ClockRat = negative ? { n: -r.n, d: r.d } : { n: r.n, d: r.d }
  const overflowLimit: ClockRat = { n: BigInt(1) << BigInt(1024), d: BigInt(1) }
  if (clockRatCmp(a, overflowLimit) >= 0) {
    return negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  }
  let value: number
  const e = clockExactExponent(a)
  if (e < -1022) {
    // Subnormal grid: k * 2^-1074.
    value = clockAssembleSubnormal(clockDivRoundHalfEven(a.n << BigInt(1074), a.d))
  } else {
    const mantissa = e >= 52
      ? clockDivRoundHalfEven(a.n, a.d << BigInt(e - 52))
      : clockDivRoundHalfEven(a.n << BigInt(52 - e), a.d)
    let q = mantissa
    let ee = e
    if (q >= BigInt(1) << BigInt(53)) { q = BigInt(1) << BigInt(52); ee += 1 }
    value = clockAssembleNormal(q, ee)
  }
  return negative ? -value : value
}

function clockFloatStepUp(x: number): number {
  if (x === 0) return Number.MIN_VALUE
  clockF64[0] = x
  clockF64Bits[0] += BigInt(1)
  return clockF64[0]
}
function clockFloatStepDown(x: number): number {
  clockF64[0] = x
  clockF64Bits[0] -= BigInt(1)
  return clockF64[0]
}

/** Smallest float >= r ('up') / largest float <= r ('down'); overflows to
 *  ±Infinity which callers must reject (stored outward bounds stay finite). */
function clockRatToOutwardFloat(r: ClockRat, direction: 'up' | 'down'): number {
  if (r.n === BigInt(0)) return 0
  const negative = r.n < BigInt(0)
  const a: ClockRat = negative ? { n: -r.n, d: r.d } : { n: r.n, d: r.d }
  const positiveDirection: 'up' | 'down' = negative ? (direction === 'up' ? 'down' : 'up') : direction
  let g = clockRatToNearestFloat(a)
  for (let guard = 4; guard > 0; guard -= 1) {
    const ga = clockRatFromNumber(g)
    if (positiveDirection === 'up') {
      if (clockRatCmp(ga, a) >= 0) break
      g = clockFloatStepUp(g)
    } else {
      if (clockRatCmp(ga, a) <= 0) break
      g = clockFloatStepDown(g)
    }
  }
  const ga = clockRatFromNumber(g)
  const covered = positiveDirection === 'up' ? clockRatCmp(ga, a) >= 0 : clockRatCmp(ga, a) <= 0
  if (!covered) throw new ClockMathErrorV3('invalid-bounds', 'outward float conversion failed to cover the exact rational')
  return negative ? -g : g
}

// --- canonical field validation ---

function clockIsCanonicalUint64Decimal(s: string): boolean {
  if (s.length > CLOCK_UINT64_MAX_DECIMAL_DIGITS) return false
  return CLOCK_UINT64_DECIMAL_PATTERN.test(s) && BigInt(s) <= CLOCK_UINT64_MAX
}

function clockIsNonNegativeInt32(v: number): boolean {
  return Number.isSafeInteger(v) && v >= 0 && v <= 2147483647
}

function clockValidateBirth(birth: NativeBirthV3, code: ClockMathErrorCodeV3, label: string): void {
  if (typeof birth !== 'object' || birth === null) throw new ClockMathErrorV3(code, label + ' native birth must be an object')
  if (typeof birth.bootUuid !== 'string' || !CLOCK_UUID_PATTERN.test(birth.bootUuid)) throw new ClockMathErrorV3(code, label + ' bootUuid must be a canonical lowercase UUID')
  if (!clockIsNonNegativeInt32(birth.pid) || birth.pid === 0) throw new ClockMathErrorV3(code, label + ' pid must be a positive int32')
  if (typeof birth.uniqueId !== 'string' || !clockIsCanonicalUint64Decimal(birth.uniqueId) || birth.uniqueId === '0') throw new ClockMathErrorV3(code, label + ' uniqueId must be a canonical nonzero uint64 decimal')
  if (!clockIsNonNegativeInt32(birth.idVersion)) throw new ClockMathErrorV3(code, label + ' idVersion must be a nonnegative int32')
  if (typeof birth.executableUuid !== 'string' || !CLOCK_EXECUTABLE_UUID_PATTERN.test(birth.executableUuid)) throw new ClockMathErrorV3(code, label + ' executableUuid must be 32 lowercase hex characters')
}

function clockValidateObservedParent(parent: { pid: number; parentUniqueId: string }, code: ClockMathErrorCodeV3): void {
  if (typeof parent !== 'object' || parent === null) throw new ClockMathErrorV3(code, 'observed parent must be an object')
  if (!clockIsNonNegativeInt32(parent.pid)) throw new ClockMathErrorV3(code, 'observed parent pid must be a nonnegative int32')
  if (typeof parent.parentUniqueId !== 'string' || !clockIsCanonicalUint64Decimal(parent.parentUniqueId)) throw new ClockMathErrorV3(code, 'observed parentUniqueId must be a canonical uint64 decimal')
}

function clockValidateSharedNs(value: bigint, label: string): void {
  if (typeof value !== 'bigint' || value < BigInt(0) || value > CLOCK_UINT64_MAX) throw new ClockMathErrorV3('invalid-readers', label + ' must be a uint64 bigint')
}

function clockValidatePerformanceMs(p: number, code: ClockMathErrorCodeV3): void {
  if (!Number.isFinite(p) || p < 0 || p >= CLOCK_MAX_SAFE_MS) throw new ClockMathErrorV3(code, 'performance reader must return finite nonnegative P below 2^53')
}

function clockValidateEndpoints(endpoints: ClockEndpointSetV3): { fromDomain: string; toDomain: string } {
  if (typeof endpoints !== 'object' || endpoints === null) throw new ClockMathErrorV3('invalid-endpoints', 'clock endpoint set must be an object')
  if (endpoints.schema !== 'rrm-clock-endpoints-v3') throw new ClockMathErrorV3('invalid-endpoints', 'unexpected endpoint set schema')
  if (typeof endpoints.scopeId !== 'string' || endpoints.scopeId === '' || endpoints.scopeId.length > 256) throw new ClockMathErrorV3('invalid-endpoints', 'endpoint scopeId must be a nonempty bounded string')
  const marks: [string, ClockMark | undefined][] = [
    ['recordStart', endpoints.recordStart], ['dispatchStart', endpoints.dispatchStart],
    ['dispatchEnd', endpoints.dispatchEnd], ['serverStart', endpoints.serverStart],
    ['serverEnd', endpoints.serverEnd],
  ]
  for (const [name, markValue] of marks) {
    if (typeof markValue !== 'object' || markValue === null) throw new ClockMathErrorV3('invalid-endpoints', 'endpoint mark ' + name + ' missing')
    if (typeof markValue.domain !== 'string' || markValue.domain === '') throw new ClockMathErrorV3('invalid-endpoints', 'endpoint mark ' + name + ' domain empty')
    if (!Number.isFinite(markValue.monotonicMs) || !Number.isFinite(markValue.wallMs)) throw new ClockMathErrorV3('invalid-endpoints', 'endpoint mark ' + name + ' has nonfinite clocks')
  }
  if (endpoints.recordStart.domain !== endpoints.dispatchStart.domain) throw new ClockMathErrorV3('invalid-endpoints', 'record start must share the dispatch domain')
  if (endpoints.dispatchStart.domain !== endpoints.dispatchEnd.domain) throw new ClockMathErrorV3('invalid-endpoints', 'dispatch interval must share one domain')
  if (endpoints.serverStart.domain !== endpoints.serverEnd.domain) throw new ClockMathErrorV3('invalid-endpoints', 'server interval must share one domain')
  if (endpoints.dispatchStart.monotonicMs > endpoints.dispatchEnd.monotonicMs) throw new ClockMathErrorV3('invalid-endpoints', 'dispatch interval is inverted')
  if (endpoints.serverStart.monotonicMs > endpoints.serverEnd.monotonicMs) throw new ClockMathErrorV3('invalid-endpoints', 'server interval is inverted')
  if (endpoints.recordStart.monotonicMs > endpoints.dispatchStart.monotonicMs) throw new ClockMathErrorV3('invalid-endpoints', 'record start must not follow dispatch start')
  const sources: [string, ClockSourceSelectorV3 | undefined][] = [
    ['record', endpoints.sources?.record], ['dispatchStart', endpoints.sources?.dispatchStart],
    ['dispatchEnd', endpoints.sources?.dispatchEnd], ['serverStart', endpoints.sources?.serverStart],
    ['serverEnd', endpoints.sources?.serverEnd],
  ]
  for (const [name, source] of sources) {
    if (typeof source !== 'object' || source === null) throw new ClockMathErrorV3('invalid-endpoints', 'endpoint source ' + name + ' missing')
    if (!artifactRefValid(source.snapshotRef)) throw new ClockMathErrorV3('invalid-endpoints', 'endpoint source ' + name + ' snapshotRef invalid')
    if (typeof source.selector !== 'string' || source.selector === '' || source.selector.length > 256) throw new ClockMathErrorV3('invalid-endpoints', 'endpoint source ' + name + ' selector must be a nonempty bounded string')
  }
  return { fromDomain: endpoints.dispatchStart.domain, toDomain: endpoints.serverStart.domain }
}

/** Canonical value equality for process identity (repair of finding 6):
 *  compares selected field VALUES, never property insertion order. */
function clockBirthEquals(a: NativeBirthV3, b: NativeBirthV3): boolean {
  return a.bootUuid === b.bootUuid && a.pid === b.pid && a.uniqueId === b.uniqueId
    && a.idVersion === b.idVersion && a.executableUuid === b.executableUuid
}
function clockRefEquals(a: ArtifactRef, b: ArtifactRef): boolean {
  return a.path === b.path && a.sha256 === b.sha256 && a.bytes === b.bytes
}
function clockSampleEquals(a: ClockSampleV3, b: ClockSampleV3): boolean {
  return a.schema === b.schema && a.scopeId === b.scopeId && a.clockInstanceId === b.clockInstanceId
    && a.sequence === b.sequence && a.domain === b.domain && a.representation === b.representation
    && a.basis === b.basis && clockBirthEquals(a.nativeBirth, b.nativeBirth)
    && a.observedParent.pid === b.observedParent.pid && a.observedParent.parentUniqueId === b.observedParent.parentUniqueId
    && clockRefEquals(a.rootScopeObservedRef, b.rootScopeObservedRef)
    && a.sharedBeforeNs === b.sharedBeforeNs && a.rawPerformanceMs === b.rawPerformanceMs
    && a.sharedAfterNs === b.sharedAfterNs
}

function clockValidateSampleRole(samples: readonly ClockSampleV3[], expectedDomain: string, expectedRepresentation: ClockRepresentationV3, scopeId: string): void {
  if (!Array.isArray(samples) || samples.length === 0) throw new ClockMathErrorV3('invalid-samples', 'at least one required clock sample per role')
  const seenSequences = new Set<number>()
  let anchor: ClockSampleV3 | null = null
  for (const sample of samples) {
    if (typeof sample !== 'object' || sample === null) throw new ClockMathErrorV3('invalid-samples', 'clock sample must be an object')
    if (sample.schema !== 'rrm-clock-sample-v2') throw new ClockMathErrorV3('invalid-samples', 'unexpected clock sample schema')
    if (sample.scopeId !== scopeId) throw new ClockMathErrorV3('invalid-samples', 'clock sample scope mismatch')
    // Canonical clock-instance identity on EVERY imported sample (repair of
    // finding 3), not only on the producer descriptor.
    if (typeof sample.clockInstanceId !== 'string' || !CLOCK_UUID_PATTERN.test(sample.clockInstanceId)) throw new ClockMathErrorV3('invalid-samples', 'clockInstanceId must be a canonical UUID')
    if (sample.domain !== expectedDomain) throw new ClockMathErrorV3('invalid-samples', 'clock sample domain does not match the endpoint role')
    if (sample.representation !== expectedRepresentation) throw new ClockMathErrorV3('invalid-samples', 'clock sample representation does not match the endpoint role')
    if (sample.basis !== 'node-hrtime-bigint-performance-now') throw new ClockMathErrorV3('invalid-samples', 'unexpected clock sample basis')
    if (!Number.isSafeInteger(sample.sequence) || sample.sequence <= 0) throw new ClockMathErrorV3('invalid-samples', 'clock sample sequence must be a positive safe integer')
    if (seenSequences.has(sample.sequence)) throw new ClockMathErrorV3('invalid-samples', 'clock sample sequences must be distinct')
    seenSequences.add(sample.sequence)
    clockValidateBirth(sample.nativeBirth, 'invalid-samples', 'clock sample')
    clockValidateObservedParent(sample.observedParent, 'invalid-samples')
    if (!artifactRefValid(sample.rootScopeObservedRef)) throw new ClockMathErrorV3('invalid-samples', 'clock sample rootScopeObservedRef invalid')
    if (typeof sample.sharedBeforeNs !== 'string' || !clockIsCanonicalUint64Decimal(sample.sharedBeforeNs)) throw new ClockMathErrorV3('invalid-samples', 'sharedBeforeNs must be a canonical uint64 decimal')
    if (typeof sample.sharedAfterNs !== 'string' || !clockIsCanonicalUint64Decimal(sample.sharedAfterNs)) throw new ClockMathErrorV3('invalid-samples', 'sharedAfterNs must be a canonical uint64 decimal')
    if (BigInt(sample.sharedAfterNs) < BigInt(sample.sharedBeforeNs)) throw new ClockMathErrorV3('invalid-samples', 'shared nanoseconds moved backwards inside the sample')
    clockValidatePerformanceMs(sample.rawPerformanceMs, 'invalid-samples')
    if (anchor === null) {
      anchor = sample
    } else {
      if (!clockBirthEquals(anchor.nativeBirth, sample.nativeBirth)) throw new ClockMathErrorV3('process-mix', 'required samples of one role must come from one native process')
      if (anchor.clockInstanceId !== sample.clockInstanceId) throw new ClockMathErrorV3('process-mix', 'required samples of one role must share one clock instance')
      if (!clockRefEquals(anchor.rootScopeObservedRef, sample.rootScopeObservedRef)) throw new ClockMathErrorV3('process-mix', 'required samples of one role must observe one root scope')
    }
  }
}

/** e(P) = (4/2^52) * max(1, |P|) milliseconds as an exact rational. */
function clockEofP(p: number): ClockRat {
  const m = Math.max(1, Math.abs(p))
  const mRat = clockRatFromNumber(m)
  return clockRatReduce(BigInt(4) * mRat.n, mRat.d * (BigInt(1) << BigInt(52)))
}

/** Intersect ALL required samples of one role: K_i = [P - A/1e6 - e(P),
 *  P - B/1e6 + e(P)]. Never discards or selects a favorable subset. */
function clockIntersectSamples(samples: readonly ClockSampleV3[]): { lower: ClockRat; upper: ClockRat } {
  let lower: ClockRat | null = null
  let upper: ClockRat | null = null
  for (const sample of samples) {
    const p = clockRatFromNumber(sample.rawPerformanceMs)
    const beforeMs = clockRatReduce(BigInt(sample.sharedBeforeNs), BigInt(1000000))
    const afterMs = clockRatReduce(BigInt(sample.sharedAfterNs), BigInt(1000000))
    const eP = clockEofP(sample.rawPerformanceMs)
    const sampleLower = clockRatSub(clockRatSub(p, afterMs), eP)
    const sampleUpper = clockRatAdd(clockRatSub(p, beforeMs), eP)
    if (lower === null || clockRatCmp(sampleLower, lower) > 0) lower = sampleLower
    if (upper === null || clockRatCmp(sampleUpper, upper) < 0) upper = sampleUpper
  }
  if (lower === null || upper === null) throw new ClockMathErrorV3('invalid-samples', 'required sample intersection needs at least one sample')
  if (clockRatCmp(lower, upper) > 0) throw new ClockMathErrorV3('empty-sample-intersection', 'required clock samples have an empty intersection')
  return { lower, upper }
}

/** Association of one endpoint mark with its actual raw sample (repair of
 *  finding 1): the mark must embed a clockSample, that sample must be one of
 *  the required role samples by canonical value (no substitution), and the
 *  rendered monotonic value must be exactly the sample's representation
 *  (host Math.round(P), observer raw P). */
function clockAssociateEndpointSample(mark: ClockMark, role: 'host' | 'observer', samples: readonly ClockSampleV3[], label: string): ClockSampleV3 {
  const sample = mark.clockSample
  if (typeof sample !== 'object' || sample === null) throw new ClockMathErrorV3('invalid-endpoints', label + ' must embed its actual raw clockSample')
  // Validate nested values before canonical equality can dereference them.
  clockValidateBirth(sample.nativeBirth, 'invalid-endpoints', label)
  clockValidateObservedParent(sample.observedParent, 'invalid-endpoints')
  if (!artifactRefValid(sample.rootScopeObservedRef)) throw new ClockMathErrorV3('invalid-endpoints', label + ' sample rootScopeObservedRef invalid')
  if (role === 'host') {
    if (sample.domain !== 'matrix-context-capture' || sample.representation !== 'host-rounded-ms') throw new ClockMathErrorV3('invalid-endpoints', label + ' sample must be a host-rounded capture sample')
    if (mark.monotonicMs !== Math.round(sample.rawPerformanceMs)) throw new ClockMathErrorV3('invalid-endpoints', label + ' rendered value must equal Math.round(raw sample P)')
  } else {
    if (sample.domain !== 'observer' || sample.representation !== 'raw-ms') throw new ClockMathErrorV3('invalid-endpoints', label + ' sample must be a raw observer sample')
    if (mark.monotonicMs !== sample.rawPerformanceMs) throw new ClockMathErrorV3('invalid-endpoints', label + ' rendered value must equal the raw sample P')
  }
  if (!samples.some((s) => clockSampleEquals(s, sample))) throw new ClockMathErrorV3('invalid-endpoints', label + ' sample must be one of the required role samples (no missing or substituted sample)')
  return sample
}

function clockMaxEofPair(a: ClockSampleV3, b: ClockSampleV3): ClockRat {
  const ea = clockEofP(a.rawPerformanceMs)
  const eb = clockEofP(b.rawPerformanceMs)
  return clockRatCmp(ea, eb) >= 0 ? ea : eb
}

function clockParseRational(pair: ClockRationalV3, label: string): ClockRat {
  if (typeof pair !== 'object' || pair === null) throw new ClockMathErrorV3('invalid-bounds', label + ' must be an object')
  const num = typeof pair.numerator === 'string' ? pair.numerator : ''
  const den = typeof pair.denominator === 'string' ? pair.denominator : ''
  if (!CLOCK_INTEGER_DECIMAL_PATTERN.test(num) || !/^[1-9][0-9]*$/.test(den)) throw new ClockMathErrorV3('invalid-bounds', label + ' must use canonical decimal strings')
  if (num.startsWith('-') && num.slice(1) === '0') throw new ClockMathErrorV3('invalid-bounds', label + ' must not serialize negative zero')
  // Bounded length BEFORE BigInt allocation (repair of finding 7).
  if (num.replace('-', '').length > CLOCK_RAT_MAX_DECIMAL_DIGITS || den.length > CLOCK_RAT_MAX_DECIMAL_DIGITS) {
    throw new ClockMathErrorV3('invalid-bounds', label + ' exceeds the bounded decimal digit limit')
  }
  const n = BigInt(num)
  const d = BigInt(den)
  if (clockBitLength(n < BigInt(0) ? -n : n) > CLOCK_RAT_MAX_BITS || clockBitLength(d) > CLOCK_RAT_MAX_BITS) throw new ClockMathErrorV3('invalid-bounds', label + ' exceeds bounded operand sizes')
  const reduced = clockRatReduce(n, d)
  if (reduced.n !== n || reduced.d !== d) throw new ClockMathErrorV3('invalid-bounds', label + ' must be reduced')
  return reduced
}

function clockErrorDetail(error: unknown): string {
  return error instanceof ClockMathErrorV3 ? error.code : error instanceof Error ? error.message : String(error)
}

// --- proposed V3 API (pure math; returns no authority) ---

/**
 * Complete source/configuration metadata with the self-acquisition result's
 * identity and the root reference observed by the producer. Validates shape
 * only, not provenance, acquisition lifecycle or actual artifact bytes.
 */
export function completeClockSamplerDescriptorV3(preRoot: ClockPreRootDescriptorV3, acquired: Pick<ClockSelfAcquisitionV3, 'birth' | 'parent'>, rootScopeObservedRef: ArtifactRef, sequence: number): ClockSamplerDescriptorV3 {
  if (typeof preRoot !== 'object' || preRoot === null) throw new ClockMathErrorV3('invalid-descriptor', 'pre-root descriptor must be an object')
  if (preRoot.schema !== 'rrm-clock-preroot-descriptor-v3') throw new ClockMathErrorV3('invalid-descriptor', 'unexpected pre-root descriptor schema')
  if (typeof preRoot.scopeId !== 'string' || preRoot.scopeId === '' || preRoot.scopeId.length > 256) throw new ClockMathErrorV3('invalid-descriptor', 'pre-root scopeId must be a nonempty bounded string')
  if (typeof preRoot.clockInstanceId !== 'string' || !CLOCK_UUID_PATTERN.test(preRoot.clockInstanceId)) throw new ClockMathErrorV3('invalid-descriptor', 'pre-root clockInstanceId must be a canonical UUID')
  if (preRoot.domain !== 'matrix-context-capture' && preRoot.domain !== 'observer') throw new ClockMathErrorV3('invalid-descriptor', 'unknown pre-root role domain')
  const expectedRepresentation: ClockRepresentationV3 = preRoot.domain === 'observer' ? 'raw-ms' : 'host-rounded-ms'
  if (preRoot.representation !== expectedRepresentation) throw new ClockMathErrorV3('invalid-descriptor', 'domain ' + preRoot.domain + ' requires representation ' + expectedRepresentation)
  if (preRoot.basis !== 'node-hrtime-bigint-performance-now') throw new ClockMathErrorV3('invalid-descriptor', 'unexpected pre-root basis')
  if (typeof acquired !== 'object' || acquired === null) throw new ClockMathErrorV3('invalid-descriptor', 'acquired identity must be an object')
  clockValidateBirth(acquired.birth, 'invalid-descriptor', 'acquired')
  clockValidateObservedParent(acquired.parent, 'invalid-descriptor')
  if (!artifactRefValid(rootScopeObservedRef)) throw new ClockMathErrorV3('invalid-descriptor', 'observed root scope ref must have valid ArtifactRef shape')
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new ClockMathErrorV3('invalid-descriptor', 'sequence must be a positive safe integer')
  return {
    schema: 'rrm-clock-sampler-v3',
    scopeId: preRoot.scopeId,
    clockInstanceId: preRoot.clockInstanceId,
    sequence,
    domain: preRoot.domain,
    representation: preRoot.representation,
    basis: preRoot.basis,
    nativeBirth: acquired.birth,
    observedParent: acquired.parent,
    rootScopeObservedRef,
  }
}

/**
 * One V3 clock sample bracket: fixed read order B = sharedNs(), P =
 * performanceMs(), A = sharedNs(), with wallMs read outside the bracket.
 * Observer marks keep raw P; host matrix-context-capture marks keep the
 * original Math.round(P) render. The raw sample rides the mark as the legacy
 * optional clockSample field (schema rrm-clock-sample-v2).
 */
export function sampleClockMarkV3(descriptor: ClockSamplerDescriptorV3, readers: ClockReadersV3): ClockMark {
  if (typeof descriptor !== 'object' || descriptor === null) throw new ClockMathErrorV3('invalid-descriptor', 'clock sampler descriptor must be an object')
  if (descriptor.schema !== 'rrm-clock-sampler-v3') throw new ClockMathErrorV3('invalid-descriptor', 'unexpected sampler descriptor schema')
  if (typeof readers !== 'object' || readers === null
    || typeof readers.sharedNs !== 'function' || typeof readers.performanceMs !== 'function' || typeof readers.wallMs !== 'function') {
    throw new ClockMathErrorV3('invalid-readers', 'clock readers must provide sharedNs/performanceMs/wallMs functions')
  }
  if (typeof descriptor.scopeId !== 'string' || descriptor.scopeId === '' || descriptor.scopeId.length > 256) throw new ClockMathErrorV3('invalid-descriptor', 'sampler scopeId must be a nonempty bounded string')
  if (typeof descriptor.clockInstanceId !== 'string' || !CLOCK_UUID_PATTERN.test(descriptor.clockInstanceId)) throw new ClockMathErrorV3('invalid-descriptor', 'clockInstanceId must be a canonical UUID')
  if (!Number.isSafeInteger(descriptor.sequence) || descriptor.sequence <= 0) throw new ClockMathErrorV3('invalid-descriptor', 'sequence must be a positive safe integer')
  if (descriptor.domain !== 'matrix-context-capture' && descriptor.domain !== 'observer') throw new ClockMathErrorV3('invalid-descriptor', 'unknown role domain')
  const expectedRepresentation: ClockRepresentationV3 = descriptor.domain === 'observer' ? 'raw-ms' : 'host-rounded-ms'
  if (descriptor.representation !== expectedRepresentation) throw new ClockMathErrorV3('invalid-descriptor', 'domain ' + descriptor.domain + ' requires representation ' + expectedRepresentation)
  if (descriptor.basis !== 'node-hrtime-bigint-performance-now') throw new ClockMathErrorV3('invalid-descriptor', 'unexpected sampler basis')
  clockValidateBirth(descriptor.nativeBirth, 'invalid-descriptor', 'sampler')
  clockValidateObservedParent(descriptor.observedParent, 'invalid-descriptor')
  if (!artifactRefValid(descriptor.rootScopeObservedRef)) throw new ClockMathErrorV3('invalid-descriptor', 'sampler rootScopeObservedRef invalid')
  const sharedBeforeNs = readers.sharedNs()
  const rawPerformanceMs = readers.performanceMs()
  const sharedAfterNs = readers.sharedNs()
  const wallMs = readers.wallMs()
  clockValidateSharedNs(sharedBeforeNs, 'sharedBeforeNs')
  clockValidateSharedNs(sharedAfterNs, 'sharedAfterNs')
  if (sharedAfterNs < sharedBeforeNs) throw new ClockMathErrorV3('invalid-readers', 'shared clock moved backwards inside the sample bracket')
  clockValidatePerformanceMs(rawPerformanceMs, 'invalid-readers')
  if (!Number.isFinite(wallMs)) throw new ClockMathErrorV3('invalid-readers', 'wall reader must return a finite wall clock')
  const monotonicMs = descriptor.representation === 'host-rounded-ms' ? Math.round(rawPerformanceMs) : rawPerformanceMs
  const sample: ClockSampleV3 = {
    schema: 'rrm-clock-sample-v2',
    scopeId: descriptor.scopeId,
    clockInstanceId: descriptor.clockInstanceId,
    sequence: descriptor.sequence,
    domain: descriptor.domain,
    representation: descriptor.representation,
    basis: descriptor.basis,
    nativeBirth: descriptor.nativeBirth,
    observedParent: descriptor.observedParent,
    rootScopeObservedRef: descriptor.rootScopeObservedRef,
    sharedBeforeNs: sharedBeforeNs.toString(),
    rawPerformanceMs,
    sharedAfterNs: sharedAfterNs.toString(),
  }
  return { domain: descriptor.domain, monotonicMs, wallMs, clockSample: sample }
}

/**
 * Exact host→observer bounds: intersect ALL required per-role samples,
 * widen by each role's maximum endpoint e(P) allowance plus host ±0.5ms
 * quantization (server quantization 0), map O = K_S - K_H, choose c by
 * nearest-binary64 midpoint conversion, and convert exact u = max(c-lower,
 * upper-c) outward/upward including conversion error. Never fits, never
 * picks a favorable subset, never trusts precomputed c/u.
 */
export function deriveClockBoundsV3(from: readonly ClockSampleV3[], to: readonly ClockSampleV3[], endpoints: ClockEndpointSetV3): ClockBoundsV3 {
  const domains = clockValidateEndpoints(endpoints)
  if (domains.fromDomain === domains.toDomain) throw new ClockMathErrorV3('domain-mismatch', 'cross-process clock bounds require distinct dispatch and server domains')
  // Role domains are canonical roles, not the marks' clock domain labels:
  // host dispatch samples come from matrix-context-capture, server samples
  // from the observer. bounds.fromDomain/toDomain carry the clock labels.
  clockValidateSampleRole(from, 'matrix-context-capture', 'host-rounded-ms', endpoints.scopeId)
  clockValidateSampleRole(to, 'observer', 'raw-ms', endpoints.scopeId)
  // Every record/interval mark must associate with a required role sample
  // and render it correctly. Only the four interval endpoints contribute
  // endpoint allowances; recordStart does not alter those fixed allowances.
  clockAssociateEndpointSample(endpoints.recordStart, 'host', from, 'recordStart')
  const dispatchStartSample = clockAssociateEndpointSample(endpoints.dispatchStart, 'host', from, 'dispatchStart')
  const dispatchEndSample = clockAssociateEndpointSample(endpoints.dispatchEnd, 'host', from, 'dispatchEnd')
  const serverStartSample = clockAssociateEndpointSample(endpoints.serverStart, 'observer', to, 'serverStart')
  const serverEndSample = clockAssociateEndpointSample(endpoints.serverEnd, 'observer', to, 'serverEnd')
  const host = clockIntersectSamples(from)
  const server = clockIntersectSamples(to)
  // Endpoint floating allowances come from the ACTUAL associated endpoint
  // magnitudes (max e(P) per role pair), plus host ±0.5ms quantization
  // (server quantization 0) — never from an array maximum or anchors only.
  const hostAllowance = clockRatAdd(clockMaxEofPair(dispatchStartSample, dispatchEndSample), { n: BigInt(1), d: BigInt(2) })
  const serverAllowance = clockMaxEofPair(serverStartSample, serverEndSample)
  const hostLower = clockRatSub(host.lower, hostAllowance)
  const hostUpper = clockRatAdd(host.upper, hostAllowance)
  const serverLower = clockRatSub(server.lower, serverAllowance)
  const serverUpper = clockRatAdd(server.upper, serverAllowance)
  const oLower = clockRatSub(serverLower, hostUpper)
  const oUpper = clockRatSub(serverUpper, hostLower)
  if (clockRatCmp(oLower, oUpper) > 0) throw new ClockMathErrorV3('empty-sample-intersection', 'host→observer offset interval is empty after the required-sample intersection')
  // Bounded-representation invariant (repair of finding 5): every derivable
  // fraction must stay inside the documented bound so the companion validator
  // can always consume derive output.
  if (clockBitLength(oLower.n < BigInt(0) ? -oLower.n : oLower.n) > CLOCK_RAT_MAX_BITS || clockBitLength(oUpper.n) > CLOCK_RAT_MAX_BITS
    || clockBitLength(oLower.d) > CLOCK_RAT_MAX_BITS || clockBitLength(oUpper.d) > CLOCK_RAT_MAX_BITS) {
    throw new ClockMathErrorV3('invalid-bounds', 'derived exact bounds exceed the documented bounded representation')
  }
  const offsetMs = clockNormalizedNumber(clockRatToNearestFloat(clockRatHalfSum(oLower, oUpper)))
  const cRat = clockRatFromNumber(offsetMs)
  const uToLower = clockRatSub(cRat, oLower)
  const uToUpper = clockRatSub(oUpper, cRat)
  const uExact = clockRatCmp(uToLower, uToUpper) >= 0 ? uToLower : uToUpper
  const uncertaintyMs = clockNormalizedNumber(clockRatToOutwardFloat(uExact, 'up'))
  const lowerMs = clockRatToOutwardFloat(oLower, 'down')
  const upperMs = clockRatToOutwardFloat(oUpper, 'up')
  if (!Number.isFinite(uncertaintyMs) || !Number.isFinite(lowerMs) || !Number.isFinite(upperMs)) {
    throw new ClockMathErrorV3('invalid-bounds', 'exact clock bounds overflowed binary64')
  }
  return {
    schema: 'rrm-clock-bounds-v3',
    scopeId: endpoints.scopeId,
    fromDomain: domains.fromDomain,
    toDomain: domains.toDomain,
    exactLowerMs: clockRatSerialize(oLower),
    exactUpperMs: clockRatSerialize(oUpper),
    lowerMs,
    upperMs,
    offsetMs,
    uncertaintyMs,
  }
}

/**
 * Strict exact final containment on exact binary64 decodes: rational(serverStart)
 * >= rational(dispatchStart) + rational(c) + rational(u) and
 * rational(serverEnd) <= rational(dispatchEnd) + rational(c) - rational(u).
 * The verdict requires this exact guard AND the unchanged numeric evaluator
 * semantics AND canonical bounds (outward coverage, recomputed projection,
 * +0 normalization, coherent endpoints). Pure math: returns a verdict, never
 * authority; fail closed on every mismatch.
 */
export function validateExactClockContainmentV3(bounds: ClockBoundsV3, endpoints: ClockEndpointSetV3): ClockContainmentVerdictV3 {
  const gaps: string[] = []
  if (typeof bounds !== 'object' || bounds === null) throw new ClockMathErrorV3('invalid-bounds', 'clock bounds must be an object')
  if (typeof endpoints !== 'object' || endpoints === null) throw new ClockMathErrorV3('invalid-endpoints', 'clock endpoint set must be an object')
  let endpointsCoherent = true
  let fromDomain = ''
  let toDomain = ''
  try {
    const domains = clockValidateEndpoints(endpoints)
    fromDomain = domains.fromDomain
    toDomain = domains.toDomain
  } catch (error) {
    endpointsCoherent = false
    gaps.push('endpoints-incoherent:' + clockErrorDetail(error))
  }
  let structureOk = true
  if (bounds.schema !== 'rrm-clock-bounds-v3') { structureOk = false; gaps.push('bounds-schema') }
  if (endpointsCoherent && bounds.scopeId !== endpoints.scopeId) gaps.push('scope-mismatch')
  if (endpointsCoherent && (bounds.fromDomain !== fromDomain || bounds.toDomain !== toDomain)) {
    endpointsCoherent = false
    gaps.push('endpoint-domain-mismatch')
  }
  let exactLower: ClockRat | null = null
  let exactUpper: ClockRat | null = null
  try {
    exactLower = clockParseRational(bounds.exactLowerMs, 'exactLowerMs')
    exactUpper = clockParseRational(bounds.exactUpperMs, 'exactUpperMs')
    if (clockRatCmp(exactLower, exactUpper) > 0) { structureOk = false; gaps.push('bounds-order') }
  } catch (error) {
    structureOk = false
    gaps.push('bounds-unparseable:' + clockErrorDetail(error))
  }
  for (const field of ['lowerMs', 'upperMs', 'offsetMs', 'uncertaintyMs'] as const) {
    const value: number = bounds[field]
    if (!Number.isFinite(value)) { structureOk = false; gaps.push('bounds-' + field + '-nonfinite') }
    else if (Object.is(value, -0)) gaps.push('bounds-' + field + '-negative-zero')
  }
  if (Number.isFinite(bounds.uncertaintyMs) && bounds.uncertaintyMs < 0) gaps.push('bounds-negative-uncertainty')
  let boundsCoverageOk = false
  if (exactLower !== null && exactUpper !== null
    && Number.isFinite(bounds.lowerMs) && Number.isFinite(bounds.upperMs)) {
    const storedLower = clockRatFromNumber(clockNormalizedNumber(bounds.lowerMs))
    const storedUpper = clockRatFromNumber(clockNormalizedNumber(bounds.upperMs))
    boundsCoverageOk = clockRatCmp(storedLower, exactLower) <= 0 && clockRatCmp(storedUpper, exactUpper) >= 0
    if (!boundsCoverageOk) gaps.push('bounds-outward-coverage')
  }
  let boundsProjectionOk = false
  if (exactLower !== null && exactUpper !== null) {
    try {
      const recomputedC = clockNormalizedNumber(clockRatToNearestFloat(clockRatHalfSum(exactLower, exactUpper)))
      const recomputedCRat = clockRatFromNumber(recomputedC)
      const uLower = clockRatSub(recomputedCRat, exactLower)
      const uUpper = clockRatSub(exactUpper, recomputedCRat)
      const recomputedU = clockNormalizedNumber(clockRatToOutwardFloat(clockRatCmp(uLower, uUpper) >= 0 ? uLower : uUpper, 'up'))
      const offsetMatches = recomputedC === bounds.offsetMs || (recomputedC === 0 && bounds.offsetMs === 0)
      const uncertaintyMatches = recomputedU === bounds.uncertaintyMs || (recomputedU === 0 && bounds.uncertaintyMs === 0)
      boundsProjectionOk = offsetMatches && uncertaintyMatches
        && !Object.is(bounds.offsetMs, -0) && !Object.is(bounds.uncertaintyMs, -0)
      if (!boundsProjectionOk) gaps.push('bounds-projection-mismatch')
    } catch (error) {
      gaps.push('bounds-projection-unrepresentable:' + clockErrorDetail(error))
    }
  }
  // Mirror of the unchanged evaluator's numeric envelope (same expression
  // order and non-finite rejection), recomputed here instead of trusted.
  // Computed ONLY after endpoint validation succeeded (repair of finding 4):
  // missing/null marks return the negative verdict via the coherence gap
  // instead of escaping as a TypeError.
  let numericProjectionOk = false
  if (endpointsCoherent) {
    const startLimit = endpoints.dispatchStart.monotonicMs + bounds.offsetMs + bounds.uncertaintyMs
    const endLimit = endpoints.dispatchEnd.monotonicMs + bounds.offsetMs - bounds.uncertaintyMs
    numericProjectionOk = Number.isFinite(bounds.offsetMs) && Number.isFinite(bounds.uncertaintyMs)
      && bounds.uncertaintyMs >= 0
      && Number.isFinite(startLimit) && Number.isFinite(endLimit)
      && endpoints.serverStart.monotonicMs >= startLimit
      && endpoints.serverEnd.monotonicMs <= endLimit
    if (!numericProjectionOk) gaps.push('numeric-envelope-violated')
  }
  let exactGuardOk = false
  if (endpointsCoherent && Number.isFinite(bounds.offsetMs) && Number.isFinite(bounds.uncertaintyMs) && bounds.uncertaintyMs >= 0) {
    const cRat = clockRatFromNumber(clockNormalizedNumber(bounds.offsetMs))
    const uRat = clockRatFromNumber(clockNormalizedNumber(bounds.uncertaintyMs))
    const dispatchStart = clockRatFromNumber(endpoints.dispatchStart.monotonicMs)
    const dispatchEnd = clockRatFromNumber(endpoints.dispatchEnd.monotonicMs)
    const serverStart = clockRatFromNumber(endpoints.serverStart.monotonicMs)
    const serverEnd = clockRatFromNumber(endpoints.serverEnd.monotonicMs)
    exactGuardOk = clockRatCmp(serverStart, clockRatAdd(clockRatAdd(dispatchStart, cRat), uRat)) >= 0
      && clockRatCmp(serverEnd, clockRatSub(clockRatAdd(dispatchEnd, cRat), uRat)) <= 0
  }
  if (!exactGuardOk) gaps.push('exact-containment-violated')
  const contained = gaps.length === 0 && structureOk && endpointsCoherent
    && numericProjectionOk && exactGuardOk && boundsCoverageOk && boundsProjectionOk
  return {
    schema: 'rrm-clock-containment-verdict-v3',
    contained,
    numericProjectionOk,
    exactGuardOk,
    boundsCoverageOk,
    boundsProjectionOk,
    endpointsCoherent,
    gaps,
  }
}
