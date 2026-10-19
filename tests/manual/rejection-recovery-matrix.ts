/**
 * Rejection/Recovery Matrix — owned-runtime UI driver (TASK 3 executor).
 * TEST-ONLY. Plan/orchestration come from the pure module; this file implements
 * the MatrixUi boundary with real Playwright flows and owns the matrix runtime
 * lifecycle. ZERO product source imports.
 *
 * Evidence: typed builders query the owned DB via READ ONLY single SELECTs with
 * row_to_json projections and ACTIVE-instance correlation (no attempt column —
 * attempts come from approval_instances). Validators require REAL ids, the
 * EXPECTED actor/order/phase/attempt and the intended custom chain.
 * Exactly-once: journal (FULL ledger) is awaited before every business click;
 * confirmations require the typed evidence. Approvals are single real clicks
 * with phase-correct controls. FINAL recovery: Engineering revise/resubmit ->
 * SOLUTION reapprovals -> requester re-initiation -> FINAL approvals.
 * Stale negatives: held dialog (never submitted) + before/after terminal
 * snapshot comparison after Completed is proven. Any page error or unexpected
 * failure stops the entire matrix.
 */
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import nextPackage from 'next/package.json'
import { chromium, expect, type Browser, type BrowserContext, type Page, type Locator } from '@playwright/test'
import {
  assertApprovalEvidence,
  assertClickAllowed,
  assertCompletedEvidence,
  assertFinalInitiationEvidence,
  assertRejectionEvidence,
  assertRequestCreateEvidence,
  assertResubmitEvidence,
  assertSnapshotsEqual,
  assertSolutionSubmitEvidence,
  activeInstanceSql,
  approvalRowSql,
  buildCasePlan,
  buildInventory,
  buildStaleNegativeChecks,
  CUSTOM_CHAINS,
  customChainSelectionClicks,
  emptyMatrixJournal,
  encloseFailedSetup,
  enableCustomHierarchy,
  expectedPostRejectStatus,
  expectedRouteSource,
  finalizeTraceArtifact,
  FIXTURE_ACTORS,
  fixtureActorIdFromMatrix,
  LIVE_CO_CANDIDATE_VERIFICATION,
  matrixActorEmail,
  matrixActorId,
  MATRIX_HEADED,
  MatrixLedger,
  MATRIX_ACTION_REGISTRY, projectPrivateText,
  normalizeActionArguments, normalizeActionResult, normalizeActionError,
  assertNegativePair, assertPassInventory, buildEvidenceRunPlan, businessSnapshotSql, candidateGroupIdSql,
  evaluateAction, loadClearedInvocation, serializeBusinessSnapshot, verifyCompletedCaseEntry,
  type ArtifactReader,
  type ArtifactWriter,
  type VerifiedPassInventory,
  type ObservedApprovalRow,
  instanceRouteSql,
  latestSolutionSql,
  pendingChainSql,
  pendingCustomActorId,
  phaseHistorySql,
  RANK_CHAINS,
  activeAssignmentSql,
  assembleRouteProof,
  buildActionBaseline,
  buildFinalInitiationEvidence,
  buildRevisionBaseline,
  buildSolutionSubmitEvidence,
  classifyPendingChain,
  persistScopedCaseEvidence,
  proveFinalInitiation,
  publishedRouteProofSql,
  scopedBusinessEvidenceSql,
  renderMatrixProgress,
  retainProfileAggregate,
  requestByTitleSql,
  retainCaseJournal,
  runMatrixCase,
  terminalSnapshotSql,
  validateCasePlan,
  type ActivePhaseRef,
  type ActionEvaluation,
  type ActionEvidence,
  type ActionIdentity,
  type ActionRecord,
  type ActionSpec,
  type ActionBaseline,
  type ApprovalEvidence,
  type ArtifactRef,
  type DecisionTarget,
  type ExpectedApprovalStep,
  type BuildBinding,
  type ClockMark,
  type CompletedEvidence,
  type DispatchProof,
  type FinalInitiationEvidence,
  type FlightResult,
  type BusinessSnapshot,
  type CaseProvenance,
  type CaseQualification,
  type CaseRunBinding,
  type ClearedInvocationContext,
  type CompletedCaseEntry,
  type CompletedCaseProof,
  type GateReceipt,
  type InvocationQualification,
  type NegativePair,
  type NegativeProofArtifact,
  type PhaseProof,
  type RowlessTarget,
  type RunBinding,
  type ServerProof,
  type HandlerKey,
  type JsonValue,
  type HeldRejectDialog,
  type MatrixJournal,
  type MatrixRow,
  type MatrixUi,
  type Phase,
  type PlanStep,
  type RejectionEvidence,
  type RequestCreateEvidence,
  type ResubmitEvidence,
  type RouteProfile,
  type SolutionSubmitEvidence,
  type TerminalSnapshot,
  type ToggleDriver,
} from '../support/rejection-recovery-matrix'
import {
  ownedArtifactReader,
  runOwnedMatrixSession,
  startMatrixRuntime,
  writeFailureArtifacts,
  type MatrixRuntimeHandle,
  type ObserverCopyManifest,
} from '../support/native/rejection-recovery-runtime'

interface Options {
  routesConfig: RouteProfile
  evidenceRoot: string
  caseIds?: string[]
  /** Explicit future opt-in. Default false. Never implied by implementation. */
  seedCleared: boolean
  /** Task5 proposed strict-lane options, NOT current CLI support for any run:
   *  the parent-pinned authority artifact plus the owner slot id. A missing
   *  authority leaves historical/legacy mode, which can never qualify a
   *  fresh pass. No --pass label, subset --case-ids or entry labels grant
   *  strict acceptance. */
  assurance?: { authority: ArtifactRef; invocationId: string }
  pauseAtActionBoundary?: boolean
}

function parseOptions(): Options {
  const routesConfigArg = process.argv.find((a) => a.startsWith('--routes-config='))
  const evidenceRoot = process.argv.find((a) => a.startsWith('--evidence-root='))?.slice('--evidence-root='.length)
  if (!routesConfigArg || !evidenceRoot) {
    throw new Error('usage: --routes-config=<profile> --evidence-root=<abs dir> [--case-ids=a,b] [--seed-cleared=true] [--assurance-authority=<abs>] [--assurance-authority-sha256=<hex>] [--assurance-authority-bytes=<n>] [--invocation-id=<slot>]')
  }
  const caseIds = process.argv.find((a) => a.startsWith('--case-ids='))?.slice('--case-ids='.length).split(',')
  const authorityPath = process.argv.find((a) => a.startsWith('--assurance-authority='))?.slice('--assurance-authority='.length)
  const authoritySha = process.argv.find((a) => a.startsWith('--assurance-authority-sha256='))?.slice('--assurance-authority-sha256='.length)
  const authorityBytesRaw = process.argv.find((a) => a.startsWith('--assurance-authority-bytes='))?.slice('--assurance-authority-bytes='.length)
  const invocationId = process.argv.find((a) => a.startsWith('--invocation-id='))?.slice('--invocation-id='.length)
  let assurance: Options['assurance']
  if (authorityPath || authoritySha || authorityBytesRaw || invocationId) {
    if (!authorityPath || !authoritySha || !authorityBytesRaw || !invocationId) {
      throw new Error('strict assurance requires ALL of --assurance-authority=<abs> --assurance-authority-sha256=<hex> --assurance-authority-bytes=<n> --invocation-id=<slot>')
    }
    const bytes = Number(authorityBytesRaw)
    if (!/^[0-9a-f]{64}$/.test(authoritySha) || !Number.isSafeInteger(bytes) || bytes <= 0) {
      throw new Error('assurance authority digest/bytes are not a canonical pinned reference')
    }
    assurance = { authority: { path: authorityPath, sha256: authoritySha, bytes }, invocationId }
  }
  return {
    routesConfig: routesConfigArg.slice('--routes-config='.length) as RouteProfile,
    evidenceRoot,
    caseIds,
    seedCleared: process.argv.includes('--seed-cleared=true'),
    assurance,
    pauseAtActionBoundary: process.argv.includes('--pause-at-action-boundary'),
  }
}

/** Operator pause at the actual admission/action boundary: stop admitting new
 *  actions, keep every ambiguous attempting entry (never cleared, never
 *  replayed), and drain/seal evidence with the existing bounded budget. */
export async function pauseAtActionBoundary(input: {
  ledger: MatrixLedger
  drain: (reason: 'pause') => Promise<CaptureSummary>
}): Promise<{ admittedResolved: boolean; ambiguousAttempting: ReadonlyArray<{ caseId: string; action: string }>; drainErrors: readonly string[] }> {
  const attempting = input.ledger.all.filter((entry) => entry.stage === 'attempting')
  const last = input.ledger.all[input.ledger.all.length - 1]
  const summary = await input.drain('pause')
  if (summary.errors.length > 0) throw new Error(`pause drain failed: ${summary.errors.join('; ')}`)
  return {
    admittedResolved: !!last && last.stage === 'confirmed',
    ambiguousAttempting: attempting.map((entry) => ({ caseId: entry.caseId, action: entry.action })),
    drainErrors: [],
  }
}

/** Task5 producer, called ONLY after the verified owned stop/browser close and
 *  the external review/parent barriers: loads the parent-pinned invocation
 *  qualification, re-derives every completed entry from the canonical loaded
 *  case results (never caller labels), verifies each with the strict gate and
 *  freezes inventory/<caseId>.json through the immutable writer. Allocates no
 *  next runtime. */
export async function finalizeInvocationInventory(input: {
  expectedAuthority: ArtifactRef
  invocationId: string
  qualification: ArtifactRef
  readArtifact: ArtifactReader
  writeArtifact: ArtifactWriter
}): Promise<readonly CompletedCaseEntry[]> {
  const bytes = await input.readArtifact(input.qualification)
  if (bytes.length !== input.qualification.bytes) throw new Error('pinned invocation qualification byte size drift')
  const qualification = JSON.parse(Buffer.from(bytes).toString('utf8')) as InvocationQualification
  const required: ReadonlyArray<GateReceipt | ArtifactRef> = [
    qualification.ownedStop, qualification.nativeCheck, qualification.visualReview, qualification.independentReview, qualification.parentAcceptance,
  ]
  for (const ref of required) {
    if (!ref || typeof (ref as ArtifactRef).sha256 !== 'string') throw new Error('invocation qualification is missing an external receipt reference')
  }
  if (!qualification.caseResults.length) throw new Error('pinned qualification carries no case results')
  const entries: CompletedCaseEntry[] = []
  for (const caseResultRef of qualification.caseResults) {
    const resultBytes = await input.readArtifact(caseResultRef)
    const loaded = JSON.parse(Buffer.from(resultBytes).toString('utf8')) as CaseResult
    if (loaded.status !== 'passed' || !loaded.provenance || !loaded.qualification) {
      throw new Error(`pinned case result ${loaded.caseId} is not a passed strict result`)
    }
    if (loaded.provenance.binding.invocationId !== input.invocationId) {
      throw new Error(`pinned case result ${loaded.caseId} belongs to another invocation slot`)
    }
    const entry: CompletedCaseEntry = {
      provenance: loaded.provenance,
      caseResult: caseResultRef,
      caseQualification: loaded.qualification,
      invocationQualification: input.qualification,
    }
    await verifyCompletedCaseEntry({ expectedAuthority: input.expectedAuthority, entry, readArtifact: input.readArtifact })
    await input.writeArtifact(`inventory/${entry.provenance.caseId}.json`, Buffer.from(JSON.stringify(entry, null, 2), 'utf8'))
    entries.push(entry)
  }
  return entries
}

/** Immutable artifact writer over an evidence root: unique temp + rename,
 *  canonical ArtifactRef digest/size of the exact persisted bytes. */
export function evidenceArtifactWriter(root: string, io: CaptureIo = fsCaptureIo): ArtifactWriter {
  return async (relative: string, bytes: Uint8Array): Promise<ArtifactRef> => {
    const dest = path.join(root, relative)
    const tmp = path.join(root, '.capture-tmp', `inv-${randomUUID()}.tmp`)
    await io.mkdir(path.dirname(tmp), { recursive: true })
    await io.writeFile(tmp, bytes)
    await io.mkdir(path.dirname(dest), { recursive: true })
    await io.rename(tmp, dest)
    return { path: dest, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
  }
}

export interface CaseResult {
  caseId: string
  requestTitle: string
  status: 'passed' | 'failed' | 'blocked'
  staleNegative?: 'passed' | 'stale-window-unavailable' | 'failed'
  error?: string
  /** Task5 strict lane: populated from the verified runtime binding BEFORE
   *  runMatrixCase/any attempting record, and retained on failure — including
   *  a rowless create with no request yet. */
  caseBinding?: CaseRunBinding
  provenance?: CaseProvenance
  qualification?: ArtifactRef
}

const results: CaseResult[] = []
let handle: MatrixRuntimeHandle
let evidenceDir = ''
let shotSeq = 0
const activePageErrors: string[] = []
const allPageErrors: string[] = []
let activeLedger: MatrixLedger | null = null
let currentCaseId: string | null = null
let currentCaseDir: string | null = null
let activeHeldReject: HeldRejectDialog | null = null
const matrixJournal: MatrixJournal = emptyMatrixJournal()

function log(message: string): void {
  console.log(`[rrm ${new Date().toISOString()}] ${message}`)
}

function guardClick(): void {
  assertClickAllowed(activePageErrors)
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2))
}

/** Durable journal. The current case is updated in place; earlier cases stay. */
async function journal(note?: string): Promise<void> {
  if (activeLedger && currentCaseId) {
    retainCaseJournal(matrixJournal, currentCaseId, activeLedger.all, note)
    if (currentCaseDir) {
      await writeJson(path.join(currentCaseDir, 'ledger.json'), matrixJournal.cases[currentCaseId])
    }
  }
  await writeJson(path.join(evidenceDir, 'matrix-progress.json'), renderMatrixProgress(
    matrixJournal,
    Object.fromEntries(results.map((result) => [result.caseId, result])),
    allPageErrors,
  ))
  await writeJson(path.join(evidenceDir, 'ledger.json'), matrixJournal)
}

async function flushProgress(): Promise<void> {
  await journal('flush')
}

async function caseDir(evidenceRoot: string, row: MatrixRow): Promise<string> {
  const dir = path.join(evidenceRoot, row.profile, row.id)
  await fs.mkdir(path.join(dir, 'screenshots'), { recursive: true })
  await fs.mkdir(path.join(dir, 'videos'), { recursive: true })
  await fs.mkdir(path.join(dir, 'traces'), { recursive: true })
  return dir
}

let videoSeq = 0
async function checkpoint(page: Page, dir: string, label: string): Promise<void> {
  const file = path.join(dir, 'screenshots', `${String(++shotSeq).padStart(4, '0')}-${label.replace(/[^a-z0-9-]/gi, '-')}.png`)
  await page.screenshot({ path: file }) // viewport-only: real in-viewport proof
  log(`screenshot ${path.basename(file)}`)
  await page.waitForTimeout(MATRIX_HEADED.checkpointMs)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Fixed evidence budgets: the EXISTING business waits. The held-stale
 *  confirm keeps its 15,000 ms window after its single click (250 ms polling
 *  cadence unchanged), positive result waits keep 30,000 ms, and the
 *  shutdown/case/close drain is a separate evidence-only 5,000 ms budget that
 *  can never admit a late response as a timely business result. No business
 *  retry, replay, sleep, poll or timeout enlargement lives here. */
export const HELD_STALE_CONFIRM_BUDGET_MS = 15_000
export const POSITIVE_RESULT_BUDGET_MS = 30_000
export const CAPTURE_DRAIN_BUDGET_MS = 5_000

// ===========================================================================
// Tasks4/5 strict-assurance action producers. Every business UI path runs the
// same lane: durable attempting ActionRecord (identity inherited from the
// verified RunBinding) -> capture.begin BEFORE the single business click ->
// the existing operation-specific result wait (same elapsed budget, clock
// started only after the click) -> capture.finish with the exact served
// binding + dispatch proof -> journal-backed ServerProof (parsed from the
// owned original observer journal, never fabricated) -> fresh BEFORE/AFTER
// full business snapshots persisted immutably (also when the UI wait fails)
// -> evaluateAction -> durable ActionEvidence. Only expected successful
// evidence confirms the original ledger; null/missing snapshots are missing
// evidence, never permission to clear attempting. Legacy (no assurance
// binding) callers keep the exact prior behavior and can never qualify.
// ===========================================================================

/** Complete snapshot + isolated mail is written before resolving. */
export async function persistActionSnapshot(input: {
  root: string
  record: ActionRecord
  edge: 'before' | 'after'
  read: () => Promise<BusinessSnapshot>
  io?: CaptureIo
}): Promise<{ snapshot: BusinessSnapshot; artifact: ArtifactRef }> {
  const io = input.io ?? fsCaptureIo
  const snapshot = await input.read()
  const bytes = Buffer.from(serializeBusinessSnapshot(snapshot), 'utf8')
  const relative = path.join('actions', input.record.identity.caseId, `identity-${String(input.record.identity.sequence).padStart(3, '0')}-${input.record.spec.kind}`, `${input.edge}.json`)
  const dest = path.join(input.root, relative)
  const tmp = path.join(input.root, '.capture-tmp', `${input.record.identity.contextId}-${randomUUID()}.tmp`)
  await io.mkdir(path.dirname(tmp), { recursive: true })
  await io.writeFile(tmp, bytes)
  await io.mkdir(path.dirname(dest), { recursive: true })
  await io.rename(tmp, dest)
  const artifact: ArtifactRef = { path: dest, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
  return { snapshot, artifact }
}

/** Parse the owned original observer journal and build THE ServerProof for one
 *  dispatch: handler + exact canonical argument projection + intended actor
 *  must match exactly one admitted invocation. Missing exit/auth/actor or
 *  sticky observer errors fail closed into the returned proof fields, never
 *  into invented success. */
async function journalServerProof(input: {
  handler: HandlerKey
  argumentProjection: JsonValue
  intendedActor: string
  journalPath: string
  moduleSourceSha256: string
  io: CaptureIo
}): Promise<ServerProof | null> {
  let raw: Uint8Array
  try {
    raw = await input.io.readFile(input.journalPath)
  } catch {
    return null
  }
  interface JournalLine { kind?: string; invocationId?: unknown; handler?: unknown; argumentProjection?: unknown; actorId?: unknown; authObserved?: unknown; phase?: unknown; exit?: unknown; observerErrors?: unknown; at?: unknown; inputSha256?: unknown; htmlSha256?: unknown; uploadSessionId?: unknown; observation?: unknown; message?: unknown }
  const records = Buffer.from(raw).toString('utf8').split('\n').filter((line) => line.trim()).map((line) => {
    try { return JSON.parse(line) as JournalLine } catch { return {} as JournalLine }
  })
  const projectionOf = (value: unknown): JsonValue | null => (value === undefined || value === null ? null : value as JsonValue)
  const candidates = records.filter((record) => record.kind === 'begin'
    && record.handler === input.handler
    && stableStringify(projectionOf(record.argumentProjection)) === stableStringify(input.argumentProjection))
  if (candidates.length !== 1) return null
  const invocationId = typeof candidates[0].invocationId === 'string' ? candidates[0].invocationId : null
  if (!invocationId) return null
  const actor = records.find((record) => record.kind === 'actor' && record.invocationId === invocationId)
  const exits = records.filter((record) => record.kind === 'exit' && record.invocationId === invocationId)
  const transactions = records.filter((record) => record.kind === 'transaction' && record.invocationId === invocationId)
  const prepared = records.find((record) => record.kind === 'prepared' && record.invocationId === invocationId)
  const faults = records.filter((record) => record.kind === 'fault' && record.invocationId === invocationId)
  const beginAt = candidates[0].at as ClockMark | undefined
  const endAt = exits.length === 1 ? exits[0].at as ClockMark | undefined : undefined
  const observerErrors: string[] = [
    ...faults.map((fault) => typeof fault.observation === 'string' && typeof fault.message === 'string' ? `${fault.observation}: ${fault.message}` : 'observer fault record'),
    ...(exits.length === 1 && Array.isArray(exits[0].observerErrors) ? exits[0].observerErrors.filter((item): item is string => typeof item === 'string') : []),
  ]
  const transaction: ServerProof['transaction'] = transactions.some((record) => record.phase === 'resolved') ? 'resolved'
    : transactions.some((record) => record.phase === 'rejected') ? 'rejected'
    : transactions.length === 0 ? 'not-started'
    : 'unknown'
  let exit: FlightResult
  if (exits.length !== 1 || !exits[0].exit || typeof exits[0].exit !== 'object') {
    exit = { state: 'missing', reason: 'observer journal has no exit record for the admitted invocation' }
  } else {
    const observed = exits[0].exit as { state?: unknown; projection?: unknown; code?: unknown; digest?: unknown }
    if (observed.state === 'returned') exit = { state: 'returned', projection: projectionOf(observed.projection) as JsonValue }
    else if (observed.state === 'thrown') exit = { state: 'thrown', code: String(observed.code), digest: observed.digest === null || observed.digest === undefined ? null : String(observed.digest) }
    else exit = { state: 'missing', reason: 'observer exit record has no supported state' }
  }
  return {
    invocationId,
    handler: input.handler,
    argumentProjection: projectionOf(candidates[0].argumentProjection) as JsonValue,
    actorId: actor && typeof actor.actorId === 'string' ? actor.actorId : null,
    authObserved: actor?.authObserved === true,
    originalInvoked: exits.length === 1,
    start: beginAt ?? { domain: 'observer', monotonicMs: 0, wallMs: 0 },
    end: endAt ?? null,
    transaction,
    exit,
    observerErrors,
    sourceSha256: input.moduleSourceSha256,
    preparedDescription: prepared && typeof prepared.inputSha256 === 'string' && typeof prepared.htmlSha256 === 'string'
      ? { inputSha256: prepared.inputSha256, htmlSha256: prepared.htmlSha256, uploadSessionId: typeof prepared.uploadSessionId === 'string' ? prepared.uploadSessionId : '' }
      : undefined,
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

interface StrictActionLane {
  record: ActionRecord
  /** Durable attempting + capture.begin. Must complete BEFORE the one click. */
  begin(): Promise<void>
  /** capture.finish + journal ServerProof + fresh AFTER snapshot/persist even
   *  when the UI wait or finish itself failed. Returns the accumulated
   *  ActionEvidence; complete() then evaluates and gates it. */
  finish(deadline: ActionResultDeadline): Promise<void>
  /** evaluate + strict gate + durable resolved ActionEvidence. */
  complete(phaseProof: PhaseProof, uiConfirmed: boolean): Promise<ActionEvidence>
  /** Failure path: retain the attempting/resolved facts without clearing. */
  retain(): ActionRecord
}

const strictActionSequences = new Map<string, number>()

/** Canonical rowless intended route for one workflow position: the full
 *  ordered membership comes from the pure fixture plan, never a count. */
function rowlessTargetFor(input: {
  row: MatrixRow; phase: Phase; title: string
  requestId: string | null; solutionId: string | null; attempt: number; custom: boolean
  previous?: RowlessTarget['previous']
}): RowlessTarget {
  const chain = RANK_CHAINS[input.row.profile][input.phase].map((id) => matrixActorId(id))
  const expectedSteps: ExpectedApprovalStep[] = buildCasePlan(input.row)
    .filter((step): step is Extract<PlanStep, { kind: 'approve' }> => step.kind === 'approve' && step.phase === input.phase)
    .map((step) => ({
      primaryActorId: matrixActorId(step.actor),
      order: step.stepOrder,
      requiredPositionId: null,
      requiredApproverId: null,
      candidateUserIds: chain,
    }))
  const customApproverIds = input.custom ? CUSTOM_CHAINS[input.phase as 'SOLUTION' | 'FINAL'].map((id) => matrixActorId(id)) : undefined
  return {
    routingMode: input.custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
    expectedSteps,
    ...(customApproverIds ? { customApproverIds } : {}),
    requestId: input.requestId,
    solutionId: input.solutionId,
    phase: input.phase,
    previous: input.previous ?? null,
    expectedAttempt: input.attempt,
    expectedChain: customApproverIds ?? [],
    titleSha256: createHash('sha256').update(input.title).digest('hex'),
  }
}

function decisionSpec(input: {
  kind: 'approve' | 'reject' | 'deny-stale'
  handler: HandlerKey
  baseline: ActionBaseline
  candidateGroupId: string | null
  current?: TerminalSnapshot
}): ActionSpec {
  const target: DecisionTarget = {
    ...input.baseline,
    candidateGroupId: input.candidateGroupId,
    currentOrder: input.baseline.order,
  }
  return (input.kind === 'deny-stale'
    ? { kind: 'deny-stale', handler: input.handler, target, current: input.current as TerminalSnapshot }
    : { kind: input.kind, handler: input.handler, target }) as ActionSpec
}

async function strictCandidateGroupId(rt: MatrixRuntimeHandle, phase: Phase, instanceId: string, order: number): Promise<string | null> {
  const rows = await rt.queryReadOnly(candidateGroupIdSql(phase, instanceId, order)) as Array<{ candidateGroupId: string | null }>
  return rows.length === 1 ? rows[0].candidateGroupId : null
}

async function beginStrictAction(input: {
  capture: ContextCapture | undefined
  binding: RunBinding | null
  manifest: ObserverCopyManifest
  handler: HandlerKey
  spec: ActionSpec
  intendedActor: string
  args: readonly unknown[]
  caseId: string
  title: string
  journalPath: string | null
  root: string
  io: CaptureIo
  readBusiness: () => Promise<BusinessSnapshot>
}): Promise<StrictActionLane | null> {
  if (!input.binding || !input.capture) return null
  if (input.capture === null || input.capture === undefined) return null
  if (input.binding.sourceMode !== 'strict-assurance') return null
  const admitted = input.capture as RegisteredContextCapture
  if (!input.manifest.compiled) throw new Error('strict action lane requires the compiled observed app copy')
  const seq = (strictActionSequences.get(input.caseId) ?? 0) + 1
  strictActionSequences.set(input.caseId, seq)
  const identity: ActionIdentity = {
    ...input.binding,
    caseId: input.caseId,
    contextId: admitted.contextId,
    sequence: seq,
  }
  const moduleFile = `src/server-actions/${input.handler.split('.')[0]}.ts`
  const generatedRef = input.manifest.generated.find((ref) => ref.path === moduleFile)
  const record: ActionRecord = {
    identity,
    spec: input.spec,
    intendedActor: input.intendedActor,
    argumentProjection: normalizeActionArguments(input.handler, input.args),
    stage: 'attempting',
    start: admitted.now(),
  }
  const before = await persistActionSnapshot({ root: input.root, record, edge: 'before', read: input.readBusiness, io: input.io })
  const evidence: ActionEvidence = {
    record,
    binding: null,
    dispatch: null,
    server: null,
    before: before.snapshot,
    after: null,
    beforeArtifact: before.artifact,
    afterArtifact: null,
    phaseProof: null,
    uiConfirmed: false,
  }
  const durableWrite = async (): Promise<void> => {
    const bytes = Buffer.from(JSON.stringify(evidence, null, 2))
    const relative = path.join('actions', input.caseId, `identity-${String(seq).padStart(3, '0')}-${record.spec.kind}.json`)
    const dest = path.join(input.root, relative)
    const tmp = path.join(input.root, '.capture-tmp', `${identity.contextId}-${randomUUID()}.tmp`)
    await input.io.mkdir(path.dirname(tmp), { recursive: true })
    await input.io.writeFile(tmp, bytes)
    await input.io.mkdir(path.dirname(dest), { recursive: true })
    await input.io.rename(tmp, dest)
  }
  return {
    record,
    begin: async () => {
      await durableWrite()
      await admitted.begin(record)
    },
    finish: async (deadline) => {
      let finishError: unknown
      let finished: Awaited<ReturnType<ContextCapture['finish']>> | null = null
      try {
        finished = await admitted.finish(record, deadline)
      } catch (error) {
        finishError = error
      }
      if (finished) {
        evidence.binding = finished.binding
        evidence.dispatch = finished.dispatch
        evidence.server = input.journalPath
          ? await journalServerProof({
              handler: input.handler,
              argumentProjection: record.argumentProjection,
              intendedActor: input.intendedActor,
              journalPath: input.journalPath,
              moduleSourceSha256: generatedRef?.sha256 ?? '',
              io: input.io,
            })
          : null
      }
      // Fresh AFTER capture/write even when the UI wait failed.
      try {
        const after = await persistActionSnapshot({ root: input.root, record, edge: 'after', read: input.readBusiness, io: input.io })
        evidence.after = after.snapshot
        evidence.afterArtifact = after.artifact
      } catch (snapshotError) {
        finishError = finishError ?? snapshotError
      }
      evidence.record.stage = finished ? 'resolved' : 'attempting'
      await durableWrite()
      if (finishError !== null && finishError !== undefined) throw finishError
    },
    complete: async (phaseProof, uiConfirmed) => {
      evidence.phaseProof = phaseProof
      evidence.uiConfirmed = uiConfirmed
      evidence.record.stage = 'resolved'
      await durableWrite()
      return evidence
    },
    retain: () => {
      evidence.record.stage = evidence.after ? 'resolved' : 'attempting'
      void durableWrite().catch(() => undefined)
      return record
    },
  }
}

export interface CaptureSummary { artifacts: readonly ArtifactRef[]; errors: readonly string[] }

export type ActionResultDeadline =
  | { operation: 'held-stale-confirm'; budgetMs: 15000; started: ClockMark }
  | { operation: 'positive-result'; budgetMs: 30000; started: ClockMark }

export interface ContextCapture {
  contextId: string
  begin(record: ActionRecord): Promise<void>
  startResultWait(record: ActionRecord, operation: ActionResultDeadline['operation']): ActionResultDeadline
  finish(record: ActionRecord, deadline: ActionResultDeadline): Promise<{ binding: BuildBinding | null; dispatch: DispatchProof | null }>
  drain(reason: 'action' | 'case' | 'close' | 'pause' | 'stop'): Promise<CaptureSummary>
  cancel(reason: string): void
}

/** Offline-injectable capture IO. Defaults to fs; the playwrightMatrixUi
 *  dependency seam forwards its own IO members. */
interface CaptureIo {
  mkdir(dir: string, options: { recursive: true }): Promise<unknown>
  writeFile(file: string, body: string | Uint8Array): Promise<void>
  readFile(file: string): Promise<Uint8Array>
  rename(from: string, to: string): Promise<void>
}

const fsCaptureIo: CaptureIo = {
  mkdir: (dir, options) => fs.mkdir(dir, options),
  writeFile: (file, body) => fs.writeFile(file, body),
  readFile: (file) => fs.readFile(file),
  rename: (from, to) => fs.rename(from, to),
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function captureClock(): ClockMark {
  return { domain: 'matrix-context-capture', monotonicMs: Math.round(performance.now()), wallMs: Date.now() }
}

/* ── Next 15.5.23 Flight framing (installed
 * react-server-dom-webpack-client.node.development.js:3150–3218): hex row id
 * + colon, newline-delimited model/control rows, and length-delimited
 * T/A/O/o/U/S/s/L/l/G/g/M/m/V byte rows. The whole finished body is framed;
 * nothing is executed or loaded as a module. */

const FLIGHT_LENGTH_TAGS: ReadonlySet<number> = new Set([
  0x54, 0x41, 0x4f, 0x6f, 0x55, 0x53, 0x73, 0x4c, 0x6c, 0x47, 0x67, 0x4d, 0x6d, 0x56, // A O o U S s L l G g M m V
])

interface FlightRow {
  id: number
  tag: number
  bytes: Uint8Array
}

interface FramedFlight {
  rows: readonly FlightRow[]
  error: string | null
}

function assertFlightVersion(): void {
  if (nextPackage.version !== '15.5.23') throw new Error('installed Next Flight version drift')
}

function frameFlightRows(bytes: Uint8Array): FramedFlight {
  const rows: FlightRow[] = []
  let i = 0
  while (i < bytes.length) {
    let id = 0
    let sawColon = false
    let digits = 0
    while (i < bytes.length) {
      const b = bytes[i]!
      i += 1
      if (b === 0x3a) {
        sawColon = true
        break
      }
      const nibble = b >= 96 ? b - 87 : b - 48
      if (nibble < 0 || nibble > 15) return { rows, error: `invalid hex row-id byte 0x${b.toString(16)} at offset ${i - 1}` }
      digits++
      id = id * 16 + nibble
      if (!Number.isSafeInteger(id)) return {rows,error:'flight row id overflow'}
    }
    if (!digits) return {rows,error:'empty flight row id'}
    if (!sawColon) return { rows, error: 'absent EOF: row id is not terminated by a colon' }
    if (i >= bytes.length) return { rows, error: 'absent EOF: body ends before a row tag' }
    const tagByte = bytes[i]!
    i += 1
    let tag = 0
    let lengthDelimited = false
    let rowLength = 0
    if (FLIGHT_LENGTH_TAGS.has(tagByte)) {
      tag = tagByte
      lengthDelimited = true
      let sawComma = false
      let lengthDigits = 0
      while (i < bytes.length) {
        const b = bytes[i]!
        i += 1
        if (b === 0x2c) {
          sawComma = true
          break
        }
        const nibble = b >= 96 ? b - 87 : b - 48
        if (nibble < 0 || nibble > 15) return { rows, error: `invalid hex length byte 0x${b.toString(16)} at offset ${i - 1}` }
        lengthDigits++
        rowLength = rowLength * 16 + nibble
        if (!Number.isSafeInteger(rowLength)) return {rows,error:'flight row length overflow'}
      }
      if (!lengthDigits) return {rows,error:'empty flight row length'}
      if (!sawComma) return { rows, error: 'absent EOF: length-framed row is not terminated by a comma' }
    } else if ((tagByte > 0x40 && tagByte < 0x5b) || tagByte === 0x23 || tagByte === 0x72 || tagByte === 0x78) {
      // '[' ' #' 'r' 'x' — newline-delimited tagged rows.
      tag = tagByte
    } else {
      // No tag byte: a model row; the byte just read belongs to its content.
      i -= 1
    }
    let content: Uint8Array
    if (lengthDelimited) {
      if (i + rowLength > bytes.length) return { rows, error: 'absent EOF: length-framed row is truncated' }
      content = bytes.subarray(i, i + rowLength)
      i += rowLength
    } else {
      const newline = bytes.indexOf(0x0a, i)
      if (newline < 0) return { rows, error: 'absent EOF: newline-delimited row is not terminated' }
      content = bytes.subarray(i, newline)
      i = newline + 1
    }
    rows.push({ id, tag, bytes: content })
  }
  return { rows, error: null }
}

type FlightRowKind = 'model' | 'error' | 'text' | 'module' | 'binary' | 'stream' | 'debug' | 'halted'

interface FlightTableEntry {
  kind: FlightRowKind
  text: string | null
  bytes: Uint8Array
}

function classifyFlightRows(rows: readonly FlightRow[]): { table: Map<number, FlightTableEntry>; error: string | null } {
  const table = new Map<number, FlightTableEntry>()
  const decoder = new TextDecoder('utf-8', { fatal:true })
  for (const row of rows) {
    let kind: FlightRowKind
    let text: string | null = null
    switch (row.tag) {
      case 0x49: kind = 'module'; break // I
      case 0x45: kind = 'error'; text = decoder.decode(row.bytes); break // E
      case 0x54: kind = 'text'; text = decoder.decode(row.bytes); break // T
      case 0x48: case 0x44: case 0x4a: case 0x57: case 0x4e: kind = 'debug'; break // H D J W N
      case 0x52: case 0x72: case 0x58: case 0x78: case 0x43: kind = 'stream'; break // R r X x C
      default:
        if (FLIGHT_LENGTH_TAGS.has(row.tag)) {
          kind = 'binary'
        } else {
          text = decoder.decode(row.bytes)
          kind = text === '' ? 'halted' : 'model'
        }
        break
    }
    if (kind === 'debug') continue // controls share IDs with later models
    const previous = table.get(row.id)
    if (previous) {
      const identical = previous.kind === kind && previous.text === text
        && Buffer.from(previous.bytes).equals(Buffer.from(row.bytes))
      if (!identical) return { table, error: `duplicate conflicting flight row ${row.id.toString(16)}` }
      continue
    }
    table.set(row.id, { kind, text, bytes: row.bytes })
  }
  return { table, error: null }
}

class FlightDecodeFailure extends Error {
  constructor(readonly state: 'incomplete' | 'unsupported', reason: string) {
    super(reason)
  }
}

class FlightThrown extends Error {
  constructor(readonly thrown: { code: string; digest: string | null }) {
    super('flight error row')
  }
}

function decodeFlightErrorRow(text: string | null): { code: string; digest: string | null } {
  let row: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(text ?? '{}')
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('malformed error row')
    row = parsed as Record<string, unknown>
  } catch {
    throw new FlightDecodeFailure('incomplete','malformed Flight error row')
  }
  const normalized = normalizeActionError(typeof row.message === 'string' ? row.message : '',row.digest)
  return {code:normalized.code,digest:normalized.digest}
}

function resolveFlightChunk(table: Map<number, FlightTableEntry>, id: number, visiting: Set<number>): unknown {
  if (visiting.has(id)) throw new FlightDecodeFailure('unsupported', `cyclic model reference $${id.toString(16)}`)
  const entry = table.get(id)
  if (!entry) throw new FlightDecodeFailure('incomplete', `unresolved reference $${id.toString(16)}`)
  switch (entry.kind) {
    case 'halted': throw new FlightDecodeFailure('incomplete', `halted stream row $${id.toString(16)}`)
    case 'error': throw new FlightThrown(decodeFlightErrorRow(entry.text))
    case 'module': throw new FlightDecodeFailure('unsupported', `module chunk $${id.toString(16)} referenced by the result graph`)
    case 'stream': throw new FlightDecodeFailure('unsupported', `stream chunk $${id.toString(16)} referenced by the result graph`)
    case 'binary': throw new FlightDecodeFailure('unsupported', `binary chunk $${id.toString(16)} referenced by the result graph`)
    case 'text': return entry.text
    case 'debug': throw new FlightDecodeFailure('incomplete', `debug row $${id.toString(16)} referenced by the result graph`)
    case 'model': break
  }
  visiting.add(id)
  try {
    let parsed: unknown
    try {
      parsed = JSON.parse(entry.text ?? '')
    } catch {
      throw new FlightDecodeFailure('incomplete', `model row $${id.toString(16)} is not valid JSON`)
    }
    return resolveFlightModel(parsed, table, visiting)
  } finally {
    visiting.delete(id)
  }
}

function resolveFlightModel(value: unknown, table: Map<number, FlightTableEntry>, visiting: Set<number>): unknown {
  if (typeof value === 'string') return parseFlightModelString(value, table, visiting)
  if (Array.isArray(value)) return value.map((item) => resolveFlightModel(item, table, visiting))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
      if (key === '__proto__') throw new FlightDecodeFailure('unsupported', 'prototype-polluting key in the result graph')
      out[key] = resolveFlightModel(member, table, visiting)
    }
    return out
  }
  return value
}

function resolveFlightReference(reference: string, table: Map<number, FlightTableEntry>, visiting: Set<number>): unknown {
  const segments = reference.split(':')
  const id = /^[0-9a-f]+$/.test(segments[0] ?? '') ? Number.parseInt(segments[0]!,16) : NaN
  if (!Number.isSafeInteger(id) || id < 0) throw new FlightDecodeFailure('incomplete', `malformed flight reference $${reference}`)
  let value = resolveFlightChunk(table, id, visiting)
  for (let index = 1; index < segments.length; index++) {
    const segment = segments[index]!
    if (value === null || typeof value !== 'object') {
      throw new FlightDecodeFailure('incomplete', `outlined path $${reference} cannot resolve segment '${segment}'`)
    }
    const container = value as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(container,segment) || ['__proto__','constructor','prototype'].includes(segment)) throw new FlightDecodeFailure('incomplete', `outlined path $${reference} has no property '${segment}'`)
    value = container[segment]
  }
  return value
}

function parseFlightModelString(value: string, table: Map<number, FlightTableEntry>, visiting: Set<number>): unknown {
  if (!value.startsWith('$')) return value
  if (value === '$') throw new FlightDecodeFailure('unsupported', 'react element in the result graph')
  switch (value[1]) {
    case '$': return value.slice(1)
    case 'L': throw new FlightDecodeFailure('unsupported', 'lazy chunk reference in the result graph')
    case '@': return resolveFlightReference(value.slice(2), table, visiting)
    case 'S': throw new FlightDecodeFailure('unsupported', 'symbol in the result graph')
    case 'h': throw new FlightDecodeFailure('unsupported', 'server reference in the result graph')
    case 'T': throw new FlightDecodeFailure('unsupported', 'temporary reference in the result graph')
    case 'Q': case 'W': case 'B': case 'K':
      throw new FlightDecodeFailure('unsupported', `built-in collection (${String(value[1])}) in the result graph`)
    case 'Z': {
      const segments = value.slice(2).split(':')
      const id = Number.parseInt(segments[0] ?? '', 16)
      const entry = Number.isInteger(id) ? table.get(id) : undefined
      if (!entry || entry.kind !== 'error') {
        throw new FlightDecodeFailure('incomplete', `outlined error reference $${value.slice(2)} has no error row`)
      }
      throw new FlightThrown(decodeFlightErrorRow(entry.text))
    }
    case 'i': throw new FlightDecodeFailure('unsupported', 'iterator in the result graph')
    case 'I': if (value !== '$Infinity') throw new FlightDecodeFailure('unsupported','invalid Infinity'); return Number.POSITIVE_INFINITY
    case '-': if (value !== '$-0' && value !== '$-Infinity') throw new FlightDecodeFailure('unsupported','invalid negative scalar'); return value === '$-0' ? -0 : Number.NEGATIVE_INFINITY
    case 'N': if (value !== '$NaN') throw new FlightDecodeFailure('unsupported','invalid NaN'); return Number.NaN
    case 'u': if (value !== '$undefined') throw new FlightDecodeFailure('unsupported','invalid undefined'); return undefined
    case 'D': if (!Number.isFinite(Date.parse(value.slice(2)))) throw new FlightDecodeFailure('unsupported','invalid Date'); return value.slice(2) // resolved Date, kept as its ISO-8601 text
    case 'n': throw new FlightDecodeFailure('unsupported', 'BigInt in the result graph')
    case 'P': throw new FlightDecodeFailure('unsupported', 'constructed instance in the result graph')
    case 'E': throw new FlightDecodeFailure('unsupported', 'evaluated function in the result graph')
    case 'Y': throw new FlightDecodeFailure('unsupported', 'debug-omitted value in the result graph')
    default: return resolveFlightReference(value.slice(1), table, visiting)
  }
}

function resultHandler(result: Record<string, unknown>): HandlerKey {
  if ('request' in result) return 'requests.resubmitRequest'
  if ('requestId' in result || 'error' in result || 'errors' in result) return 'requests.createRequest'
  if ('cleanupWarnings' in result || 'deletedAttachmentIds' in result) return 'solutions.resubmitSolution'
  if ('solutionId' in result) return 'solutions.submitSolution'
  return 'approvals.approveRequest'
}

/** Decode an entire finished Flight body against the installed Next 15.5.23
 *  framing. Root `a` is resolved exactly as Next's server-action reducer does
 *  (external redirects never carry a Flight body and fail the content-type
 *  gate first). No module is loaded and nothing is evaluated. */
export function decodeActionFlight(bytes: Uint8Array, contentType: string, handler?: HandlerKey): FlightResult {
  try {
    assertFlightVersion()
    if (contentType.split(';')[0]?.trim() !== 'text/x-component') {
      return { state: 'missing', reason: 'response is not a Flight body' }
    }
    if (bytes.byteLength === 0) return { state: 'missing', reason: 'response body is empty' }
    const framed = frameFlightRows(bytes)
    if (framed.error) return { state: 'incomplete', reason: framed.error }
    const classified = classifyFlightRows(framed.rows)
    if (classified.error) return { state: 'incomplete', reason: classified.error }
    const root = classified.table.get(0)
    if (!root || root.kind !== 'model' || root.text === null) {
      return { state: 'incomplete', reason: 'flight body has no root model row 0' }
    }
    let rootModel: unknown
    try {
      rootModel = JSON.parse(root.text)
    } catch {
      return { state: 'incomplete', reason: 'root model row 0 is not valid JSON' }
    }
    if (rootModel === null || typeof rootModel !== 'object' || Array.isArray(rootModel)) {
      return { state: 'incomplete', reason: 'root model row 0 is not a JSON object' }
    }
    if (!('a' in rootModel)) return { state: 'incomplete', reason: 'root model has no action result key a' }
    const visiting = new Set<number>()
    try {
      const actionResult = resolveFlightModel((rootModel as Record<string, unknown>).a, classified.table, visiting)
      if (actionResult === undefined) return { state: 'missing', reason: 'action result resolved to undefined' }
      if (actionResult === null || typeof actionResult !== 'object' || Array.isArray(actionResult)) {
        return { state: 'missing', reason: 'action result is not a JSON object' }
      }
      return { state: 'returned', projection: normalizeActionResult(handler ?? resultHandler(actionResult as Record<string, unknown>),actionResult) }
    } catch (error) {
      if (error instanceof FlightThrown) return { state: 'thrown', code: error.thrown.code, digest: error.thrown.digest }
      if (error instanceof FlightDecodeFailure) return { state: error.state, reason: error.state === 'unsupported' ? 'unsupported action result graph' : 'incomplete action result graph' }
      throw error
    }
  } catch (error) {
    return { state: 'unsupported', reason: 'Flight action projection failed' }
  }
}

const SERVED_ACTION_ID_PATTERN = /^[0-9a-f]{40,64}$/

/** Parse served JS bytes for `createServerReference(actionId, ..., exportName)`
 *  bindings with the TypeScript AST. Requires source registration and module
 *  provenance plus the exact source span; same-named ambiguity, unknown
 *  emitted forms and drifted archived bytes fail instead of guessing. */
export function extractServedBindings(
  bytes: Uint8Array,
  artifact: ArtifactRef,
  contextId: string,
  manifest: ObserverCopyManifest,
): readonly BuildBinding[] {
  assertFlightVersion()
  const digest = sha256Hex(bytes)
  if (artifact.sha256 !== digest || artifact.bytes !== bytes.byteLength) {
    throw new Error(`served JS bytes do not match the archived artifact digest (${artifact.path})`)
  }
  const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes)
  const bindings: BuildBinding[] = []
  const scan = (sourceText: string, sourceOffset: (offset:number)=>number, moduleHint: string|null, depth:number):void => {
    if (depth > 1) throw new Error('unsupported nested served source literal')
    const sourceFile=ts.createSourceFile('served-chunk.js',sourceText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
    if ((sourceFile as ts.SourceFile & {parseDiagnostics?:readonly unknown[]}).parseDiagnostics?.length) throw new Error('served JS has invalid AST')
    const visit=(node:ts.Node):void=>{
      if (ts.isCallExpression(node)) {
        let callee:ts.Expression=node.expression
        while(ts.isParenthesizedExpression(callee))callee=callee.expression
        if(ts.isBinaryExpression(callee) && callee.operatorToken.kind === ts.SyntaxKind.CommaToken)callee=callee.right
        const name=ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
        if(name === 'createServerReference') {
          const exportName=node.arguments[4]
          // Unused, non-matrix references are archived but never admitted as
          // bindings. A used unmapped ID still fails finish; computed names fail.
          if (!exportName || !ts.isStringLiteral(exportName)) throw new Error('unknown emitted server reference export name')
          if (manifest.registered.some(handler=>handler.endsWith('.'+exportName.text))) bindings.push(servedBindingFromCall(node,sourceFile,sourceText,bytes,artifact,contextId,manifest,moduleHint,sourceOffset,text))
        }
        if(name === 'eval') {
          const arg=node.arguments[0]
          const literal=arg && ts.isStringLiteral(arg) ? arg : arg && ts.isCallExpression(arg) && ts.isPropertyAccessExpression(arg.expression) && arg.expression.name.text === 'ts' && arg.arguments.length === 1 && ts.isStringLiteral(arg.arguments[0]!) ? arg.arguments[0] as ts.StringLiteral : null
          if(literal) {
            const raw=literal.getText(sourceFile)
            // Webpack's public devtool embeds JSON-quoted source. Decode its
            // AST text ONLY and map decoded offsets back to exact served bytes.
            if(raw !== JSON.stringify(literal.text))throw new Error('unsupported served source literal encoding')
            const hint=publicModuleFor(node) ?? moduleHint
            scan(literal.text,offset=>sourceOffset(literal.getStart(sourceFile)+1+JSON.stringify(literal.text.slice(0,offset)).slice(1,-1).length),hint,depth+1)
          }
        }
      }
      ts.forEachChild(node,visit)
    }
    ts.forEachChild(sourceFile,visit)
  }
  scan(text,offset=>offset,null,0)
  const seen = new Set<string>()
  const handlers = new Set<HandlerKey>()
  for (const binding of bindings) {
    if (seen.has(binding.actionId)) throw new Error(`duplicate served server reference for action id ${binding.actionId}`)
    if (handlers.has(binding.handler)) throw new Error('ambiguous same-named served handler binding')
    seen.add(binding.actionId); handlers.add(binding.handler)
  }
  return bindings
}

function publicModuleFor(node: ts.Node): string | null {
  let parent:ts.Node|undefined=node
  while(parent) {
    if(ts.isPropertyAssignment(parent) && ts.isStringLiteral(parent.name)) {
      const match=/(?:^|\/)(?:\.\/)?(src\/server-actions\/[a-z-]+\.ts)(?:$|[?)])/.exec(parent.name.text)
      if(match)return match[1]!
    }
    parent=parent.parent
  }
  return null
}

function servedBindingFromCall(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  text: string,
  bytes: Uint8Array,
  artifact: ArtifactRef,
  contextId: string,
  manifest: ObserverCopyManifest,
  moduleHint: string | null, sourceOffset: (offset:number)=>number, servedText: string,
): BuildBinding {
  const fail = (reason: string): never => {
    throw new Error(`unknown emitted createServerReference form: ${reason}`)
  }
  const actionIdNode = call.arguments[0] as ts.Node | undefined
  if (!actionIdNode || !ts.isStringLiteral(actionIdNode) || !SERVED_ACTION_ID_PATTERN.test(actionIdNode.text)) {
    return fail('action id argument is not a known hex server reference id')
  }
  const actionId = actionIdNode.text
  const exportNode = call.arguments[4] as ts.Node | undefined
  if (!exportNode || !ts.isStringLiteral(exportNode)) return fail('export name argument is missing')
  const exportName = exportNode.text
  const modulePath=publicModuleFor(call) ?? moduleHint
  if (!modulePath) return fail('missing public module/source provenance')
  const guards=manifest.original.filter(guard=>guard.relativePath === modulePath && /^[0-9a-f]{64}$/.test(guard.sha256))
  if (guards.length !== 1) return fail('module/source provenance is not uniquely registered')
  const candidates = manifest.registered.filter((handler) => handler.endsWith(`.${exportName}`) && guards[0]!.exports.includes(handler))
  if (candidates.length === 0) return fail(`served export '${exportName}' is not a registered matrix handler`)
  if (candidates.length > 1) return fail(`served export '${exportName}' is ambiguous across registered handlers`)
  const handler = candidates[0]!
  if (!manifest.original.some((guard) => guard.exports.includes(handler))) {
    return fail(`registered handler '${handler}' has no observed source guard provenance`)
  }
  const byteOffset = Buffer.byteLength(servedText.slice(0, sourceOffset(actionIdNode.getStart(sourceFile) + 1)), 'utf8')
  const echoed = Buffer.from(bytes.subarray(byteOffset, byteOffset + Buffer.byteLength(actionId, 'utf8'))).toString('utf8')
  if (echoed !== actionId) return fail('action id source span does not match the archived bytes')
  return Object.assign({ actionId, handler, chunk: artifact, byteOffset, generatedSourceSha256: artifact.sha256, contextId },{sourcePath:modulePath,sourceSha256:guards[0]!.sha256,callByteOffset:Buffer.byteLength(servedText.slice(0,sourceOffset(call.getStart(sourceFile))),'utf8'),callByteLength:Buffer.byteLength(servedText.slice(sourceOffset(call.getStart(sourceFile)),sourceOffset(call.end)),'utf8')})
}

function freezeCaptureValue<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeCaptureValue(child)
    Object.freeze(value)
  }
  return value
}

interface WireRequest {
  url(): string
  method(): string
  headerValue(name: string): Promise<string | null>
  failure?(): {errorText:string} | null
  postDataBuffer?(): Buffer | null
}
interface WireResponse {
  status(): number
  headerValue(name: string): Promise<string | null>
  body(): Promise<Buffer>
  request(): WireRequest
}
interface CaptureTiming {
  clock?(): ClockMark
  setTimer?(fn: () => void, ms: number): ReturnType<typeof setTimeout>
  clearTimer?(timer: ReturnType<typeof setTimeout>): void
}
interface CapturedResponse {
  sequence: number
  start: ClockMark
  end: ClockMark | null
  method: string
  pathName: string
  actionId: string | null
  contentType: string
  status: number | null
  failed: boolean
  finished: boolean
  failure: JsonValue | null
  redirect: boolean
  body: Uint8Array | null
  artifact: ArtifactRef | null
  argumentProjection: JsonValue | null
  result: FlightResult | null
  headersReady: Promise<void>
}
interface RegisteredContextCapture extends ContextCapture {
  startCallerResultWait(handler: HandlerKey, operation: ActionResultDeadline['operation']): ActionResultDeadline
  finishCallerResultWait(deadline: ActionResultDeadline): Promise<void>
  now(): ClockMark
}

/** Decode only React's public ordinary typed argument graph. No bound server
 * references, temporary values, binary uploads or encrypted closure reads. */
function decodePublicArguments(raw: Buffer | null, contentType: string): readonly unknown[] {
  if (!raw?.length) throw new Error('dispatch arguments missing')
  const rows = new Map<string, unknown>()
  const text = new TextDecoder('utf-8', {fatal:true})
  if (/^(text\/plain|application\/json)(;|$)/i.test(contentType)) {
    rows.set('0', JSON.parse(text.decode(raw)))
  } else if (/^multipart\/form-data;/i.test(contentType)) {
    const boundary = /boundary=(?:"([^"\r\n]+)"|([^;\s\r\n]+))/.exec(contentType)
    const name = boundary?.[1] ?? boundary?.[2]
    if (!name) throw new Error('multipart boundary missing')
    const delimiter = Buffer.from('--' + name)
    let offset = 0
    for (;;) {
      if (!raw.subarray(offset,offset+delimiter.length).equals(delimiter)) throw new Error('multipart framing unsupported')
      offset += delimiter.length
      if (raw.subarray(offset,offset+2).toString() === '--') {
        if (raw.subarray(offset+2).toString().trim() !== '') throw new Error('multipart trailing payload')
        break
      }
      if (raw.subarray(offset,offset+2).toString() !== '\r\n') throw new Error('multipart separator missing')
      const endHeaders = raw.indexOf('\r\n\r\n',offset+2)
      if (endHeaders < 0) throw new Error('multipart headers truncated')
      const headers = text.decode(raw.subarray(offset+2,endHeaders))
      const partName = /^content-disposition: form-data; name="([0-9a-f]+)"$/i.exec(headers)?.[1]
      if (!partName || rows.has(partName)) throw new Error('opaque or duplicate multipart part')
      const end = raw.indexOf(Buffer.from('\r\n--' + name),endHeaders+4)
      if (end < 0) throw new Error('multipart body truncated')
      rows.set(partName,JSON.parse(text.decode(raw.subarray(endHeaders+4,end))))
      offset = end + 2
    }
  } else throw new Error('opaque dispatch content type')
  const visiting = new Set<string>()
  const resolve = (value: unknown, depth = 0): unknown => {
    if (depth > 20) throw new Error('argument graph too deep')
    if (typeof value === 'string' && value.startsWith('$')) {
      if (value.startsWith('$$')) return value.slice(1)
      if (value === '$undefined') return undefined
      if (value.startsWith('$D') && Number.isFinite(Date.parse(value.slice(2)))) return new Date(value.slice(2))
      if (!/^\$[0-9a-f]+$/.test(value)) throw new Error('opaque dispatch reference')
      const id = value.slice(1)
      if (visiting.has(id) || !rows.has(id)) throw new Error('unresolved dispatch reference')
      visiting.add(id)
      try { return resolve(rows.get(id),depth+1) } finally { visiting.delete(id) }
    }
    if (Array.isArray(value)) return value.map(v=>resolve(v,depth+1))
    if (value !== null && typeof value === 'object') {
      const out: Record<string,unknown> = Object.create(null) as Record<string,unknown>
      for (const [key,member] of Object.entries(value)) {
        if (['__proto__','prototype','constructor'].includes(key)) throw new Error('unsafe argument key')
        out[key] = resolve(member,depth+1)
      }
      return out
    }
    return value
  }
  visiting.add('0')
  const args = resolve(rows.get('0'))
  if (!Array.isArray(args)) throw new Error('dispatch arguments are not an array')
  return args
}
function projectPublicArguments(handler: HandlerKey, args: readonly unknown[]): JsonValue {
  const keys: Partial<Record<HandlerKey, readonly string[]>> = {
    'requests.createRequest':['title','description','inlineImageSessionId','stagedAttachmentIds'],
    'requests.resubmitRequest':['requestId','title','description','inlineImageSessionId'],
    'solutions.submitSolution':['requestId','title','description','inlineImageSessionId','costEstimate','currency','timeline','conceptDesign','useCustomApprovals','customApproverIds','fileIds'],
    'solutions.resubmitSolution':['requestId','title','description','inlineImageSessionId','cost','currency','timeline','newFileIds','deletedFileIds','useCustomHierarchy','customApprovers'],
  }
  const allowed = keys[handler]
  if (allowed) {
    if (args.length !== 1 || args[0] === null || typeof args[0] !== 'object' || Array.isArray(args[0]) || Object.keys(args[0]).some(key=>!allowed.includes(key))) throw new Error('unexpected opaque dispatch fields')
  }
  return normalizeActionArguments(handler,args)
}

function createContextCapture(context: BrowserContext, input: {
  contextId: string; root: string; manifest: ObserverCopyManifest
}, io: CaptureIo & CaptureTiming): RegisteredContextCapture {
  assertFlightVersion()
  if (!input.manifest.compiled || input.manifest.registered.length !== MATRIX_ACTION_REGISTRY.length || MATRIX_ACTION_REGISTRY.some(entry=>!input.manifest.registered.includes(entry.handler))) throw new Error('compiled observed app manifest required for capture admission')
  if (!/^[a-zA-Z0-9-]+$/.test(input.contextId) || !path.isAbsolute(input.root)) throw new Error('invalid context evidence path')
  const manifest = structuredClone(input.manifest)
  const now = io.clock ?? captureClock
  const setTimer = io.setTimer ?? setTimeout
  const clearTimer = io.clearTimer ?? clearTimeout
  const contextId = input.contextId
  const errors: string[] = [], artifacts: ArtifactRef[] = [], bindings: BuildBinding[] = []
  const byRequest = new Map<WireRequest,CapturedResponse>()
  const byAction = new Map<string,BuildBinding>()
  const jobs = new Set<Promise<void>>()
  const signals = new Set<() => void>()
  const published = new Map<string,ArtifactRef>()
  const attempts = new WeakMap<ActionResultDeadline,{handler:HandlerKey;after:number;record:ActionRecord|null}>()
  const starts = new WeakMap<ActionRecord,number>()
  let sequence = 0, generation = 0, accepting = true
  let cancelled = false, summary: CaptureSummary | null = null, drainJob: Promise<CaptureSummary> | null = null
  const signal = (): void => { for (const resolve of signals) resolve(); signals.clear() }
  const note = (message: string): void => { if (!summary) errors.push(message); signal() }
  const track = (promise: Promise<unknown>): void => {
    const job = promise.then(()=>undefined,()=>{note('capture asynchronous operation failed')})
    jobs.add(job)
    void job.then(()=>{jobs.delete(job);signal()})
  }
  const active = (g: number): boolean => accepting && generation === g
  const publish = async (relative: string, bytes: Uint8Array, g: number): Promise<ArtifactRef | null> => {
    if (!active(g)) return null
    const old = published.get(relative)
    if (old) return old
    const tmp = path.join(input.root,'.capture-tmp',contextId+'-'+randomUUID()+'.tmp')
    const dest = path.join(input.root,relative)
    try {
      await io.mkdir(path.dirname(tmp),{recursive:true}); if (!active(g)) return null
      await io.writeFile(tmp,bytes); if (!active(g)) return null
      await io.mkdir(path.dirname(dest),{recursive:true}); if (!active(g)) return null
      await io.rename(tmp,dest); if (!active(g)) return null
      const ref = Object.freeze({path:relative,sha256:sha256Hex(bytes),bytes:bytes.length})
      published.set(relative,ref);artifacts.push(ref)
      return ref
    } catch { if (active(g)) note('capture artifact write failed'); return null }
  }
  const onRequest = (request: WireRequest): void => {
    if (!accepting) return
    const url = new URL(request.url())
    // Auth paths are rejected BEFORE even safe-header/body access.
    if (url.pathname === '/sign-in' || url.pathname.startsWith('/sign-in/') || url.pathname.startsWith('/api/auth')) return
    if (!/^\/requests(?:\/|$)/.test(url.pathname) && !/^\/_next\/static\/.*\.js$/.test(url.pathname)) return
    const g = generation
    const r: CapturedResponse = {sequence:++sequence,start:Object.freeze({...now()}),end:null,method:request.method(),pathName:url.pathname,actionId:null,contentType:'',status:null,failed:false,finished:false,failure:null,redirect:false,body:null,artifact:null,argumentProjection:null,result:null,headersReady:Promise.resolve()}
    byRequest.set(request,r)
    r.headersReady = (async()=>{const id = await request.headerValue('next-action'); if (active(g)) {if(id !== null && !SERVED_ACTION_ID_PATTERN.test(id)){r.failed=true;note('invalid public action id header')}else r.actionId=id}})()
    track(r.headersReady)
  }
  const onResponse = (response: WireResponse): void => {
    if (!accepting) return
    const r = byRequest.get(response.request())
    if (!r) return
    const g = generation
    const job = (async()=>{
      try {
        await r.headersReady; if (!active(g)) return
        const ct = await response.headerValue('content-type'); if (!active(g)) return
        const redirect = await response.headerValue('x-action-redirect'); if (!active(g)) return
        r.status=response.status();r.contentType=ct??'';r.redirect=redirect !== null
        if (r.redirect) {r.failed=true;signal();return}
        const js = /(?:javascript|ecmascript)/i.test(r.contentType)
        const flight = r.contentType.split(';')[0]?.trim() === 'text/x-component'
        if (!js && !(flight && r.method === 'POST' && r.actionId)) { if (r.actionId) {r.failed=true;signal()} return }
        const bytes = Uint8Array.from(await response.body()); if (!active(g)) return
        if (js) {
          const relative = path.posix.join('contexts',contextId,'js',sha256Hex(bytes)+'.js')
          const artifact = await publish(relative,bytes,g); if (!active(g) || !artifact) return
          const extracted=extractServedBindings(bytes,artifact,contextId,manifest)
          for (const binding of extracted) {
            const old=byAction.get(binding.actionId)
            if (old && (old.handler !== binding.handler || old.generatedSourceSha256 !== binding.generatedSourceSha256)) throw new Error('conflicting public action binding')
            if (bindings.some(b=>b.handler === binding.handler && b.actionId !== binding.actionId)) throw new Error('ambiguous served handler binding')
            if (!old) {bindings.push(Object.freeze(binding));byAction.set(binding.actionId,binding)}
          }
        } else {
          r.body=bytes
          r.artifact=await publish(path.posix.join('contexts',contextId,'responses',String(r.sequence)+'.flight'),bytes,g)
        }
        signal()
      } catch { if (active(g)) {r.failed=true;note('served response body/binding capture failed')} }
    })()
    track(job)
  }
  const onFinished = (request: WireRequest): void => { if (!accepting) return;const r=byRequest.get(request);if(r){r.end=Object.freeze({...now()});r.finished=true}signal() }
  const onFailed = (request: WireRequest): void => { if (!accepting) return;const r=byRequest.get(request);if(r){r.failed=true;r.end=Object.freeze({...now()});const failure=request.failure?.();r.failure=failure?projectPrivateText(failure.errorText):null}signal() }
  const remove = (): void => {
    context.off('request',onRequest);context.off('response',onResponse);context.off('requestfinished',onFinished);context.off('requestfailed',onFailed)
  }
  const cancel = (reason: string): void => {
    if (!cancelled) {cancelled=true;accepting=false;generation++;remove();note('capture cancelled ('+sha256Hex(Buffer.from(reason))+')')}
  }
  const within = async <T>(promise: Promise<T>, expires: number, label: string): Promise<T> => {
    // I/O may already have started before this admission clock is read.
    // Observe rejection even on immediate expiry; the race still sees the original failure.
    void promise.catch(() => undefined)
    const left=expires-now().monotonicMs
    if (left <= 0) throw new Error(label+' deadline expired')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result=await Promise.race([promise,new Promise<never>((_resolve,reject)=>{timer=setTimer(()=>reject(new Error(label+' deadline expired')),left)})])
      if (now().monotonicMs >= expires) throw new Error(label+' deadline expired')
      return result
    } finally { if(timer !== undefined)clearTimer(timer) }
  }
  const start = (handler: HandlerKey, operation: ActionResultDeadline['operation'], after: number, record:ActionRecord|null): ActionResultDeadline => {
    if (!accepting) throw new Error('capture sealed before result wait')
    if (!manifest.registered.includes(handler)) throw new Error('unregistered handler before result wait')
    const deadline: ActionResultDeadline = operation === 'held-stale-confirm' ? {operation,budgetMs:15000,started:now()} : operation === 'positive-result' ? {operation,budgetMs:30000,started:now()} : (()=>{throw new Error('unknown result-wait operation')})()
    Object.freeze(deadline.started);Object.freeze(deadline)
    attempts.set(deadline,{handler,after,record})
    return deadline
  }
  const waitResult = async (deadline: ActionResultDeadline): Promise<{binding:BuildBinding;response:CapturedResponse}> => {
    const attempt=attempts.get(deadline)
    if (!attempt || deadline.budgetMs !== (deadline.operation === 'held-stale-confirm' ? 15000 : 30000)) throw new Error('unknown or changed result deadline')
    const expires=deadline.started.monotonicMs+deadline.budgetMs
    try {
      for (;;) {
        if (!accepting || now().monotonicMs >= expires) throw new Error('result deadline '+deadline.budgetMs+'ms expired')
        if (errors.length) throw new Error(errors.join('; '))
        const candidates=[...byRequest.values()].filter(r=>r.sequence>attempt.after && r.method === 'POST' && r.actionId)
        if (candidates.length>1) throw new Error('ambiguous action dispatch')
        const r=candidates[0]
        if (r?.failed) throw new Error('action request failed or redirected')
        const binding=r?.actionId ? byAction.get(r.actionId) : undefined
        if (binding && binding.handler !== attempt.handler) throw new Error('mismapped public action binding')
        if (r && binding && r.body && r.artifact && r.end) {
          const archived=await within(io.readFile(path.join(input.root,binding.chunk.path)),expires,'result '+deadline.budgetMs+'ms')
          if (sha256Hex(archived) !== binding.chunk.sha256 || archived.length !== binding.chunk.bytes) throw new Error('archived served binding bytes drifted')
          // Decode only the relevant public body, after its exact binding is known.
          const argumentContentType=await within(byRequestKey(r).headerValue('content-type'),expires,'result '+deadline.budgetMs+'ms')
          if (!accepting) throw new Error('capture sealed before result evidence completed')
          r.argumentProjection=freezeCaptureValue(projectPublicArguments(attempt.handler,decodePublicArguments(byRequestKey(r).postDataBuffer?.()??null,argumentContentType??'')))
          r.result=freezeCaptureValue(decodeActionFlight(r.body,r.contentType,attempt.handler))
          // Next15.5.23 user-code throws are HTTP500 with a rejected Flight action result.
          const statusSupported = r.status !== null && ((r.status >= 200 && r.status < 300) || (r.status === 500 && r.result.state === 'thrown'))
          if (!['returned','thrown'].includes(r.result.state) || !statusSupported) throw new Error('action result evidence incomplete or unsupported')
          if (now().monotonicMs >= expires || r.end.monotonicMs >= expires) throw new Error('result deadline '+deadline.budgetMs+'ms expired')
          return {binding,response:r}
        }
        let notify!:()=>void
        const changed=new Promise<void>(resolve=>{notify=resolve;signals.add(resolve)})
        try { await within(changed,expires,'result '+deadline.budgetMs+'ms') } finally {signals.delete(notify)}
      }
    } catch (error) { cancel('result evidence failed'); throw error }
  }
  const byRequestKey = (record:CapturedResponse):WireRequest => {for(const [request,value] of byRequest)if(value===record)return request;throw new Error('request missing')}
  const drain = (reason: 'action'|'case'|'close'|'pause'|'stop'): Promise<CaptureSummary> => {
    if (drainJob) return drainJob
    drainJob=(async()=>{
      remove()
      const expires=now().monotonicMs+CAPTURE_DRAIN_BUDGET_MS
      accepting=false;generation++
      const pending=jobs.size
      if (pending) note('capture drain has pending operations; incomplete evidence')
      // Seal an immutable incomplete index concurrently with bounded cleanup,
      // not after an unfinished body has consumed the whole evidence budget.
      const drainPending=(async()=>{
        if (!pending) return
        try {await within(Promise.all([...jobs]),expires,'evidence drain 5000ms')}
        catch {note('evidence drain 5000ms exhausted; incomplete capture')}
      })()
      const relative=path.posix.join('contexts',contextId,'build-bindings.json')
      const index={contextId,complete:errors.length===0 && pending===0,reason,bindings:[...bindings],artifacts:[...artifacts],errors:[...errors],requests:[...byRequest.values()].map(r=>({sequence:r.sequence,method:r.method,path:r.pathName,actionId:r.actionId,start:r.start,end:r.end,status:r.status,contentType:r.contentType,failed:r.failed,finished:r.finished,failure:r.failure,body:r.artifact,arguments:r.argumentProjection,result:r.result}))}
      const bytes=Buffer.from(JSON.stringify(index,null,2))
      const tmp=path.join(input.root,'.capture-tmp','sealed-'+contextId+'-'+randomUUID()+'.tmp')
      const indexJob=(async()=>{
        await io.mkdir(path.dirname(tmp),{recursive:true});await io.writeFile(tmp,bytes)
        // Timeout/cancellation cannot publish an index or overwrite a sealed one.
        if (summary || now().monotonicMs >= expires) return
        await io.mkdir(path.dirname(path.join(input.root,relative)),{recursive:true})
        if (summary || now().monotonicMs >= expires) return
        await io.rename(tmp,path.join(input.root,relative))
        if (!summary && now().monotonicMs < expires) artifacts.push(Object.freeze({path:relative,sha256:sha256Hex(bytes),bytes:bytes.length}))
      })()
      const sealPending=(async()=>{try {await within(indexJob,expires,'evidence seal 5000ms')} catch {note('capture index seal/write failed or exceeded 5000ms')}})()
      await Promise.all([drainPending,sealPending])
      summary=Object.freeze({artifacts:Object.freeze([...artifacts]),errors:Object.freeze([...errors])})
      return summary
    })()
    return drainJob
  }
  context.on('request',onRequest);context.on('response',onResponse);context.on('requestfinished',onFinished);context.on('requestfailed',onFailed)
  return {
    contextId, now,
    begin:async(record)=>{if(!accepting || record.identity.contextId !== contextId)throw new Error('unregistered action context');starts.set(record,sequence)},
    startResultWait:(record,operation)=>{if(!starts.has(record))throw new Error('action begin required');return start(record.spec.handler,operation,starts.get(record)!,record)},
    finish:async(record,deadline)=>{if(attempts.get(deadline)?.record !== record)throw new Error('result deadline action mismatch');const {binding,response:r}=await waitResult(deadline);return {binding,dispatch:{identity:record.identity,actionId:binding.actionId,argumentProjection:r.argumentProjection!,start:r.start,end:r.end,status:r.status,body:r.artifact,result:r.result!}}},
    startCallerResultWait:(handler,operation)=>start(handler,operation,0,null),
    finishCallerResultWait:async(deadline)=>{await waitResult(deadline)},
    drain,cancel,
  }
}

/** Register the capture listeners on a real Playwright case context,
 *  immediately after browser.newContext and before any page work. */
export function registerMatrixContextCapture(
  context: BrowserContext,
  input: {
    contextId: string
    root: string
    manifest: ObserverCopyManifest
  },
): ContextCapture {
  return createContextCapture(context, input, fsCaptureIo)
}

export interface MatrixUiDependencies extends CaptureTiming {
  handle: MatrixRuntimeHandle
  manifest: ObserverCopyManifest
  mkdir(dir: string, options: { recursive: true }): Promise<unknown>
  writeFile(file: string, body: string | Uint8Array): Promise<void>
  readFile(file: string): Promise<Uint8Array>
  rename(from: string, to: string): Promise<void>
}

export function playwrightMatrixUi(browser: Browser, evidenceRoot: string, deps?: MatrixUiDependencies): MatrixUi & { traces: string[]; captures: readonly ContextCapture[] } {
  const files = deps ?? fsCaptureIo
  const traces: string[] = []
  const captures: ContextCapture[] = []
  /** Runtime boundary: injected offline deps own the handle; the owned
   *  session handle remains the default for the existing two-arg call. */
  const rt = (): MatrixRuntimeHandle => deps?.handle ?? handle
  const newContext = async (row: MatrixRow | null, label: string): Promise<{ context: BrowserContext; page: Page; closeContext: () => Promise<void>; capture: RegisteredContextCapture }> => {
    const videoDir = path.join(currentCaseDir ?? evidenceRoot, 'videos', `${label.replace(/[^a-z0-9-]/gi, '-')}-${++videoSeq}`)
    await files.mkdir(videoDir, { recursive: true })
    const context = await browser.newContext({
      viewport: MATRIX_HEADED.viewport,
      recordVideo: { dir: videoDir },
    })
    const traceBase = row
      ? path.join(evidenceRoot, row.profile, row.id, 'traces', `${label.replace(/[^a-z0-9-]/gi, '-')}-${Date.now()}`)
      : path.join(evidenceRoot, 'traces', `${label.replace(/[^a-z0-9-]/gi, '-')}-${Date.now()}`)
    let capture: RegisteredContextCapture | undefined
    let page: Page | undefined
    let intentionalClose = false
    return encloseFailedSetup({
      open: async () => ({
        capture: async () => {
          const failedTrace = `${traceBase}-setup-failed.zip`
          const failures: string[] = []
          const retainFailure = (stage: string, error: unknown): void => {
            failures.push(`${stage}: ${error instanceof Error ? error.message : String(error)}`)
          }
          // Finalize registered capture independently of every artifact operation.
          if (capture) {
            try {
              const summary=await capture.drain('close')
              for (const error of summary.errors) retainFailure('capture drain failed', error)
            } catch (error) {
              retainFailure('capture drain failed', error)
              try { capture.cancel('setup capture drain failed') } catch (error) { retainFailure('capture cancel failed', error) }
            }
          }
          try {
            await files.mkdir(path.dirname(failedTrace), { recursive: true })
          } catch (error) {
            retainFailure('setup artifact mkdir failed', error)
          }
          if (page) {
            try {
              await page.screenshot({ path: `${traceBase}-setup-failed.png` })
            } catch (error) {
              retainFailure('setup screenshot failed', error)
            }
          }
          try {
            await context.tracing.stop({ path: failedTrace })
          } catch (error) {
            retainFailure('setup trace failed', error)
          }
          if (failures.length > 0) throw new Error(failures.join('; '))
        },
        close: async () => {
          intentionalClose = true
          await context.close()
        },
      }),
      run: async () => {
        const captureManifest = deps?.manifest ?? rt().observerManifest
        if (!captureManifest) {
          throw new Error('observed app copy manifest is required before a matrix case context can be admitted')
        }
        const contextId = randomUUID()
        // Registered immediately after browser.newContext and BEFORE tracing,
        // newPage, goto or sign-in; an unadmitted context fails the lane here.
        capture = createContextCapture(context, {
          contextId,
          root: currentCaseDir ?? evidenceRoot,
          manifest: captureManifest,
        }, deps ?? fsCaptureIo)
        captures.push(capture)
        page = await context.newPage()
        page.setDefaultTimeout(30_000)
        page.setDefaultNavigationTimeout(90_000)
        page.on('pageerror', (error: Error) => {
          activePageErrors.push(`${label}: ${error.message}`)
          allPageErrors.push(`${label}: ${error.message}`)
        })
        page.on('close', () => {
          if (!intentionalClose) activePageErrors.push(`${label}: page closed unexpectedly`)
        })
        await page.goto(`${rt().baseUrl}/sign-in`)
        await page.locator('#email').fill(actorEmail(label))
        await page.locator('#password').fill(rt().runtime.e2ePassword)
        await page.getByRole('button', { name: 'Sign in' }).click()
        await page.waitForURL((url) => !url.pathname.includes('/sign-in'))
        await files.mkdir(path.dirname(traceBase), {recursive:true})
        // Authentication is outside traces. snapshots:true also starts the
        // Playwright HAR tracer, which would copy Cookie/Set-Cookie even
        // after sign-in. Dedicated capture owns the allowlisted wire proof.
        await context.tracing.start({ screenshots:true,snapshots:false,sources:true })
        const admittedCapture=capture
        let closeJob: Promise<void> | undefined
        const closeContext = async (): Promise<void> => {
          if (closeJob) return closeJob
          closeJob=(async()=>{
          intentionalClose = true
          const tracePath = `${traceBase}.zip`
          let drainFailure: string | null = null
          try {
            const summary = await admittedCapture.drain('close')
            if (summary.errors.length > 0) drainFailure = summary.errors.join('; ')
          } catch (drainError) {
            drainFailure = drainError instanceof Error ? drainError.message : String(drainError)
          }
          let traceError: unknown
          try {
            await finalizeTraceArtifact({
              stop: () => context.tracing.stop({ path: tracePath }),
              exists: async () => files.readFile(tracePath).then(bytes=>bytes.length>0).catch(()=>false),
              tracePath,
              index: traces,
            })
          } catch (error) {
            traceError = error
          } finally {
            try {
              await context.close()
            } catch (closeError) {
              const extra = closeError instanceof Error ? closeError.message : String(closeError)
              traceError = traceError
                ? new Error(`${traceError instanceof Error ? traceError.message : String(traceError)}; context close failed: ${extra}`)
                : closeError
            }
          }
          const failures: string[] = []
          if (drainFailure) failures.push(`capture drain failed: ${drainFailure}`)
          if (traceError) failures.push(traceError instanceof Error ? traceError.message : String(traceError))
          if (failures.length > 0) throw new Error(failures.join('; '))
          })()
          return closeJob
        }
        return { context, page, closeContext, capture:admittedCapture }
      },
    })
  }

  /** The single UI wait and evidence finish share one deadline started only
   * after the original business click. Legacy injected-factory fixtures do
   * not enter the capture lane and cannot produce strict evidence. */
  const strictBinding = (): RunBinding | null => rt().assuranceBinding ?? null
  const journalPathOf = (): string | null => {
    const paths = (rt().runtime as { paths?: { logsDir?: string } } | undefined)?.paths
    return paths?.logsDir ? path.join(paths.logsDir, 'observer-journal', 'observer-journal.jsonl') : null
  }
  const manifestOf = (): ObserverCopyManifest => deps?.manifest ?? rt().observerManifest as ObserverCopyManifest
  async function strictResultWait<T>(lane: StrictActionLane | null, capture: ContextCapture | undefined, handler: HandlerKey, operation: ActionResultDeadline['operation'], wait: (deadline:ActionResultDeadline|null)=>Promise<T>): Promise<T> {
    if (!lane || !capture) return resultWait(capture, handler, operation, wait)
    const admitted = capture as RegisteredContextCapture
    const deadline = admitted.startResultWait(lane.record, operation)
    let value!: T, primary: unknown
    try { value = await wait(deadline) } catch (error) { primary = error }
    try { await lane.finish(deadline) } catch (error) {
      const finishText = error instanceof Error ? error.message : String(error)
      primary = primary !== undefined
        ? new Error(`${primary instanceof Error ? primary.message : String(primary)}; capture result failed: ${finishText}`)
        : error
    }
    if (primary !== undefined) throw primary
    return value
  }
  async function requireStrictAction(lane: StrictActionLane, phaseProof: PhaseProof | null, expectation: 'positive' | 'denied'): Promise<ActionEvidence> {
    const evidence = await lane.complete(phaseProof as PhaseProof, true)
    const evaluation: ActionEvaluation = evaluateAction(evidence)
    const required = expectation === 'positive' ? 'COMMITTED_AND_UI_CONFIRMED' : 'DENIED_UNCHANGED'
    if (!evaluation.evidenceValid || evaluation.outcome !== required) {
      throw new Error(`strict action evidence failed: ${evaluation.outcome} (${evaluation.gaps.join('; ')})`)
    }
    return evidence
  }
  const readBusinessSnapshot = async (row: MatrixRow, title: string): Promise<BusinessSnapshot> => {
    const mail = rt().mail?.messages() ?? []
    const empty: BusinessSnapshot = { terminal: null, request: null, solutions: [], instances: [], approvalRows: [], groups: [], activities: [], notifications: [], mail: [...mail] as unknown as readonly JsonValue[] }
    let request: { id: string; status: string; title: string }
    try {
      request = await requestByTitle(title)
    } catch {
      return empty
    }
    const terminal = await readSnapshot(title)
    const doc = await rt().queryReadOnly(businessSnapshotSql(request.id)) as {
      request: BusinessSnapshot['request']; solutions: BusinessSnapshot['solutions']; instances: BusinessSnapshot['instances']
      approvalRows: BusinessSnapshot['approvalRows']; groups: BusinessSnapshot['groups']; activities: BusinessSnapshot['activities']
      notifications: BusinessSnapshot['notifications']
    }
    return { terminal, request: doc.request, solutions: doc.solutions, instances: doc.instances, approvalRows: doc.approvalRows, groups: doc.groups, activities: doc.activities, notifications: doc.notifications, mail: [...mail] as unknown as readonly JsonValue[] }
  }
  const writeNegativeSnapshot = async (id: string, edge: 'before' | 'after' | 'pair', value: BusinessSnapshot | NegativePair): Promise<ArtifactRef> => {
    const bytes = Buffer.from(typeof value === 'object' && value !== null && 'kind' in (value as object) && 'pair' in (value as object)
      ? JSON.stringify(value, null, 2)
      : serializeBusinessSnapshot(value as BusinessSnapshot), 'utf8')
    const dest = path.join(currentCaseDir ?? evidenceRoot, 'negatives', id, `${edge}.json`)
    const tmp = path.join(currentCaseDir ?? evidenceRoot, '.capture-tmp', `neg-${id}-${edge}-${randomUUID()}.tmp`)
    await files.mkdir(path.dirname(tmp), { recursive: true })
    await files.writeFile(tmp, bytes)
    await files.mkdir(path.dirname(dest), { recursive: true })
    await files.rename(tmp, dest)
    return { path: dest, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
  }
  const uiOnlyPair = async (id: string, kind: NegativePair['kind'], row: MatrixRow, title: string, assertMiddle: () => Promise<void>): Promise<void> => {
    // Immediate pair: BEFORE snapshot AND its immutable write complete before
    // the disabled/absent-control assertion; fresh AFTER completes the gate.
    const before = await readBusinessSnapshot(row, title)
    const beforeArtifact = await writeNegativeSnapshot(id, 'before', before)
    await assertMiddle()
    const after = await readBusinessSnapshot(row, title)
    const afterArtifact = await writeNegativeSnapshot(id, 'after', after)
    const pair: NegativePair = { id, kind, before, after, beforeArtifact, afterArtifact, action: null }
    await writeNegativeSnapshot(id, 'pair', pair)
    assertNegativePair(pair)
  }
  const strictLaneFor = async (input: {
    capture: ContextCapture | undefined
    handler: HandlerKey
    spec: ActionSpec
    intendedActor: string
    args: readonly unknown[]
    row: MatrixRow
    title: string
  }): Promise<StrictActionLane | null> => beginStrictAction({
    capture: input.capture,
    binding: strictBinding(),
    manifest: manifestOf(),
    handler: input.handler,
    spec: input.spec,
    intendedActor: input.intendedActor,
    args: input.args,
    caseId: input.row.id,
    title: input.title,
    journalPath: journalPathOf(),
    root: currentCaseDir ?? evidenceRoot,
    io: files,
    readBusiness: () => readBusinessSnapshot(input.row, input.title),
  })

  async function resultWait<T>(capture: ContextCapture | undefined, handler: HandlerKey, operation: ActionResultDeadline['operation'], wait: (deadline:ActionResultDeadline|null)=>Promise<T>): Promise<T> {
    if (!capture) return wait(null)
    const admitted=capture as RegisteredContextCapture
    if (!captures.includes(capture) || !admitted.startCallerResultWait) throw new Error('unregistered context cannot enter result evidence lane')
    const deadline=admitted.startCallerResultWait(handler,operation)
    let value!:T, primary:unknown
    try {value=await wait(deadline)} catch(error){primary=error}
    try {await admitted.finishCallerResultWait(deadline)} catch(error) {
      if(primary)throw new Error(`${primary instanceof Error ? primary.message : String(primary)}; capture result failed: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
    if(primary)throw primary
    return value
  }

  async function openRequest(page: Page, title: string, listPath = '/requests'): Promise<Locator> {
    await page.goto(`${rt().baseUrl}${listPath}`, { waitUntil: 'load' })
    const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
    await expect(rowEl).toBeVisible()
    await rowEl.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0)
    return dialog
  }

  function toggleDriver(form: Locator): ToggleDriver {
    const label = form.getByText('Custom Approval Hierarchy', { exact: true })
    return {
      clickSwitch: async () => {
        await label.scrollIntoViewIfNeeded()
        await form.getByRole('switch').click()
      },
      clickUnnamedFinalButton: async () => {
        await label.scrollIntoViewIfNeeded()
        const toggle = label.locator('xpath=../..').getByRole('button')
        await expect(toggle).toHaveCount(1)
        await toggle.click()
      },
      switchChecked: async () => (await form.getByRole('switch').getAttribute('aria-checked')) === 'true'
        || (await form.getByRole('switch').getAttribute('data-state')) === 'checked',
      finalOnVisible: async () => label.locator('xpath=../..').getByText(/^on$/i).isVisible(),
    }
  }

  async function enableCustom(form: Locator, surface: 'solution' | 'resubmit' | 'final'): Promise<void> {
    await enableCustomHierarchy(toggleDriver(form), surface)
  }

  /** Selects and reorders only. The caller enables the surface-correct toggle once. */
  async function pickCustomChain(page: Page, form: Locator, chain: readonly [string, string]): Promise<void> {
    const add = form.locator('[data-picker-open]')
    await expect(add).toBeVisible({ timeout: 20_000 })
    for (const actorId of customChainSelectionClicks(chain)) {
      await add.click()
      const item = form.locator('[data-picker-item]').filter({ hasText: actorEmail(actorId) })
      await expect(item).toBeVisible({ timeout: 20_000 })
      await item.click()
      await expect(form.locator('[data-picker-item]')).toHaveCount(0)
    }
    const firstRow = form.locator('div').filter({ hasText: actorIdEmail(chain[0]) }).filter({ has: page.getByRole('button') }).last()
    const secondRow = form.locator('div').filter({ hasText: actorIdEmail(chain[1]) }).filter({ has: page.getByRole('button') }).last()
    await firstRow.getByRole('button').first().click()
    await page.waitForTimeout(1500)
    const firstBox = await firstRow.boundingBox()
    const secondBox = await secondRow.boundingBox()
    if (!firstBox || !secondBox || !(firstBox.y < secondBox.y)) {
      throw new Error(`custom chain reorder failed (y ${firstBox?.y} !< ${secondBox?.y})`)
    }
  }

  async function findStageBlock(dialog: Locator, stageNumber: number): Promise<Locator> {
    const blocks = dialog.locator('div.flex.flex-col.sm\\:flex-row')
    const count = await blocks.count()
    for (let i = 0; i < count; i++) {
      const b = blocks.nth(i)
      const marker = await b.getByText(/^stage\s*\d$/i).first().innerText().catch(() => null)
      if (marker && new RegExp(`stage\\s*${stageNumber}`, 'i').test(marker.trim())) return b
    }
    throw new Error(`stage ${stageNumber} block not found (case-insensitive)`)
  }

  async function queryRows<T>(sql: string, readQuery?: (sql: string) => Promise<unknown>): Promise<T[]> {
    const parsed = await (readQuery ?? rt().queryReadOnly)(sql)
    if (!Array.isArray(parsed)) throw new Error('evidence query did not return a JSON array')
    return parsed as T[]
  }

  async function requestByTitle(title: string, readQuery?: (sql: string) => Promise<unknown>): Promise<{ id: string; status: string; title: string }> {
    const rows = await queryRows<{ id: string; status: string; title: string }>(requestByTitleSql(title), readQuery)
    if (rows.length !== 1) throw new Error(`request row for '${title}' not found (${rows.length})`)
    return rows[0]
  }

  async function activePhase(phase: Phase, requestId: string, readQuery?: (sql: string) => Promise<unknown>): Promise<ActivePhaseRef> {
    const rows = await queryRows<ActivePhaseRef & { requestId: string }>(activeInstanceSql(phase, requestId), readQuery)
    if (rows.length !== 1) throw new Error(`no active ${phase} instance for request ${requestId}`)
    if (rows[0].phase !== phase || !Number.isInteger(rows[0].attempt) || rows[0].attempt < 1) {
      throw new Error(`active ${phase} instance is not usable: ${JSON.stringify(rows[0])}`)
    }
    return { requestId: rows[0].requestId, instanceId: rows[0].instanceId, attempt: rows[0].attempt, phase }
  }

  async function pendingRows(phase: Phase, instanceId: string): Promise<Array<{ order: number; requiredApproverId: string | null; approverId: string | null; status: string; routingMode?: string }>> {
    return queryRows(pendingChainSql(phase, instanceId))
  }

  async function pendingActors(phase: Phase, instanceId: string): Promise<string[]> {
    const rows = await pendingRows(phase, instanceId)
    return rows.filter((row) => row.status === 'pending' && row.routingMode === 'CUSTOM_PERSON').map((row) => pendingCustomActorId(row))
  }

  async function requestCreateEvidence(title: string): Promise<RequestCreateEvidence> {
    const request = await requestByTitle(title)
    return { requestId: request.id, status: request.status as 'ImprovementRequest', title: request.title }
  }

  async function approvalEvidence(step: Extract<PlanStep, { kind: 'approve' }>, title: string, captured: { requestId: string; instanceId: string; attempt: number; approvalRowId: string }): Promise<ApprovalEvidence> {
    const rows = await queryRows<ApprovalEvidence>(approvalRowSql({
      phase: step.phase,
      requestId: captured.requestId,
      instanceId: captured.instanceId,
      attempt: captured.attempt,
      stepOrder: step.stepOrder,
      actor: step.actor,
      status: 'approved',
      rowId: captured.approvalRowId,
    }))
    if (rows.length !== 1) throw new Error(`no persisted approved ${step.phase} row at pos ${step.stepOrder} by ${step.actor} on ${captured.instanceId}`)
    const evidence = rows[0]
    return {
      phase: step.phase,
      attempt: Number(evidence.attempt),
      stepOrder: step.stepOrder,
      actor: evidence.actor,
      approvalRowId: evidence.approvalRowId,
      requestId: evidence.requestId,
      status: 'approved',
      order: Number(evidence.order),
      instanceId: evidence.instanceId,
    }
  }

  async function solutionSubmitEvidence(title: string, custom: boolean, profile: RouteProfile): Promise<SolutionSubmitEvidence> {
    const request = await requestByTitle(title)
    const active = await activePhase('SOLUTION', request.id)
    const solutionRows = await queryRows<{ id: string }>(latestSolutionSql(request.id))
    if (solutionRows.length !== 1) throw new Error('solution row missing after submission')
    const routeRows = await queryRows<{ routingMode: string; scopeUnitId: string | null }>(instanceRouteSql(active.instanceId))
    const chainRows = await queryRows<ObservedApprovalRow>(pendingChainSql('SOLUTION', active.instanceId))
    return buildSolutionSubmitEvidence({
      request,
      active,
      solutionId: solutionRows[0].id,
      rows: chainRows,
      route: routeRows[0] ?? null,
      custom,
      profile,
    })
  }

  async function rejectionEvidence(row: MatrixRow, title: string, rejector: string, captured: { requestId: string; instanceId: string; attempt: number; approvalRowId: string }): Promise<RejectionEvidence> {
    const request = await requestByTitle(title)
    if (request.id !== captured.requestId) throw new Error('rejection evidence request != pre-click request')
    const rows = await queryRows<{ approvalRowId: string; instanceId: string; actor: string; reason: string; order: number; attempt: number; requestId: string; isFinalApproval?: boolean }>(
      approvalRowSql({
        phase: row.phase,
        requestId: captured.requestId,
        instanceId: captured.instanceId,
        attempt: captured.attempt,
        stepOrder: row.rejectOrder,
        actor: rejector,
        status: 'rejected',
        rowId: captured.approvalRowId,
      }),
    )
    if (rows.length !== 1) throw new Error(`no persisted rejected ${row.phase} row by ${rejector} on captured instance ${captured.instanceId}`)
    const found = rows[0]
    if (found.reason !== row.reason) throw new Error('persisted rejection reason does not match the submitted reason')
    return {
      phase: row.phase,
      requestId: found.requestId,
      rejectionRowId: found.approvalRowId,
      status: request.status as RejectionEvidence['status'],
      actor: found.actor,
      reason: found.reason,
      rejectedRows: 1,
      instanceId: found.instanceId,
      attempt: Number(found.attempt),
      order: Number(found.order),
      isFinalApproval: row.phase === 'FINAL' ? true : row.phase === 'REQUEST' ? false : undefined,
    }
  }

  async function resubmitEvidence(phase: 'REQUEST' | 'SOLUTION', title: string, custom: boolean, readQuery?: (sql: string) => Promise<unknown>): Promise<ResubmitEvidence> {
    const request = await requestByTitle(title, readQuery)
    const active = await activePhase(phase, request.id, readQuery)
    const history = await queryRows<{ instanceId: string; attempt: number; supersededAt: string | null }>(phaseHistorySql(phase, request.id), readQuery)
    const previous = history.filter((item) => item.attempt < active.attempt).sort((a, b) => b.attempt - a.attempt)[0]
    if (!previous) throw new Error('previous attempt is missing from history; it must be captured before revision')
    const chain = await queryRows<ObservedApprovalRow>(pendingChainSql(phase, active.instanceId), readQuery)
    const classified = custom
      ? classifyPendingChain(chain, { routingMode: 'CUSTOM_PERSON', orderedActors: CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id)) })
      : undefined
    return {
      phase,
      requestId: request.id,
      previousAttempt: previous.attempt,
      newAttempt: active.attempt,
      previousInstanceId: previous.instanceId,
      newInstanceId: active.instanceId,
      previousSuperseded: previous.supersededAt !== null,
      carriedApprovals: chain.filter((item) => item.status === 'approved').length,
      customChainIds: classified?.customChainIds,
    }
  }

  async function finalInitiationEvidence(row: MatrixRow, title: string, custom: boolean, expectedAttempt: number): Promise<FinalInitiationEvidence> {
    const request = await requestByTitle(title)
    const active = await activePhase('FINAL', request.id)
    const rows = await queryRows<ObservedApprovalRow>(pendingChainSql('FINAL', active.instanceId))
    const routeRows = await queryRows<{ routingMode: string; scopeUnitId: string | null }>(instanceRouteSql(active.instanceId))
    return buildFinalInitiationEvidence({
      request,
      active,
      rows,
      route: routeRows[0] ?? null,
      custom,
      profile: row.profile,
      expectedAttempt,
    })
  }

  async function completedDbEvidence(requestId: string, bannerSeen: boolean, stage3InViewport: boolean): Promise<CompletedEvidence> {
    const snapshot = await rt().queryReadOnly(terminalSnapshotSql(requestId)) as TerminalSnapshot
    if (snapshot.status !== 'Completed') throw new Error(`observed completed status ${snapshot.status}`)
    return {
      requestId: snapshot.requestId,
      status: snapshot.status,
      requestPendingRows: Number(snapshot.requestPendingRows),
      solutionPendingRows: Number(snapshot.solutionPendingRows),
      finalPendingRows: Number(snapshot.finalPendingRows),
      bannerSeen,
      stage3InViewport,
    }
  }

  async function readSnapshot(title: string): Promise<TerminalSnapshot> {
    const request = await requestByTitle(title)
    const snapshot = await rt().queryReadOnly(terminalSnapshotSql(request.id)) as TerminalSnapshot
    return snapshot
  }

  const ui: MatrixUi & { traces: string[]; captures: readonly ContextCapture[] } = {
    traces,
    captures,
    readBusinessSnapshot: (row, title) => readBusinessSnapshot(row, title),
    writeNegativeSnapshot: (id, edge, value) => writeNegativeSnapshot(id, edge, value),
    hasFailed: () => activePageErrors.length > 0,
    readActivePhase: async (phase, title) => {
      const request = await requestByTitle(title)
      return activePhase(phase, request.id)
    },
    readRequestRef: async (title) => {
      const request = await requestByTitle(title)
      return { requestId: request.id, status: request.status }
    },
    readPublishedRouteProof: async (profile) => {
      const routes = await queryRows<{ phase: Phase; scopeUnitId: string; steps: Array<{ order: number; positionId: string }> }>(publishedRouteProofSql())
      const assignments = await queryRows<{ userId: string; unitId: string; positionId: string }>(activeAssignmentSql())
      return assembleRouteProof(profile, routes, assignments)
    },
    readActionBaseline: async (phase, title, order, expected) => {
      const request = await requestByTitle(title)
      const active = await activePhase(phase, request.id)
      const rows = await queryRows<ObservedApprovalRow>(pendingChainSql(phase, active.instanceId))
      const solutionRows = phase === 'SOLUTION' ? await queryRows<{ id: string }>(latestSolutionSql(request.id)) : []
      return buildActionBaseline({ phase, request, active, rows, order, solutionId: solutionRows[0]?.id ?? null, expected })
    },
    readRevisionBaseline: async (phase, title, expectedState, expectedInstanceId) => {
      const request = await requestByTitle(title)
      const history = await queryRows<{ instanceId: string; attempt: number; supersededAt: string | null }>(phaseHistorySql(phase, request.id))
      const prior = [...history].sort((a, b) => b.attempt - a.attempt)[0]
      const rows = prior ? await queryRows<ObservedApprovalRow>(pendingChainSql(phase, prior.instanceId)) : []
      const solutionRows = phase === 'SOLUTION' ? await queryRows<{ id: string }>(latestSolutionSql(request.id)) : []
      return buildRevisionBaseline({
        phase,
        request,
        history,
        rows: rows.map((row) => ({ ...row, instanceId: prior?.instanceId })),
        solutionId: solutionRows[0]?.id ?? null,
        expectedState,
        expectedInstanceId,
      })
    },
    readTerminalSnapshot: async (_row, title) => readSnapshot(title),

    async createRequest(row, title) {
      const { context, page, closeContext, capture } = await newContext(row, FIXTURE_ACTORS.requesterA)
      const description = `Rejection matrix ${row.id}: reject ${row.phase} position ${row.rejectOrder} (${row.chainKind}), recover to Completed.`
      let lane: StrictActionLane | null = null
      try {
        guardClick()
        await page.goto(`${rt().baseUrl}/requests`)
        await page.getByRole('button', { name: 'New Request' }).click()
        const form = page.getByRole('dialog')
        await expect(form.getByRole('heading', { name: 'Submit New Request' })).toBeVisible()
        await form.locator('#title').fill(title)
        const editor = form.locator('[contenteditable="true"]').first()
        await editor.click()
        await editor.fill(description)
        const session = await editor.getAttribute('data-inline-image-session')
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-request-form`)
        lane = await strictLaneFor({
          capture,
          handler: 'requests.createRequest',
          spec: { kind: 'create', handler: 'requests.createRequest', target: rowlessTargetFor({ row, phase: 'REQUEST', title, requestId: null, solutionId: null, attempt: 1, custom: false }) },
          intendedActor: matrixActorId(FIXTURE_ACTORS.requesterA),
          args: [{ title, description, ...(session ? { inlineImageSessionId: session } : {}), stagedAttachmentIds: [] }],
          row,
          title,
        })
        if (lane) await lane.begin() // durable attempting + capture.begin BEFORE the single click
        guardClick()
        await form.getByRole('button', { name: 'Submit Request' }).click()
        await strictResultWait(lane, capture,'requests.createRequest','positive-result',async()=>{ await expect(page.getByText('Request created successfully')).toBeVisible({ timeout: 30_000 }) })
        await closeContext()
        const evidence = await requestCreateEvidence(title)
        assertRequestCreateEvidence(evidence)
        if (lane) await requireStrictAction(lane, evidence, 'positive')
        return JSON.stringify(evidence)
      } catch (error) {
        (lane as StrictActionLane | null)?.retain()
        return failClosed(page, error, closeContext, files)
      }
    },

    async approveStep(row, step, title, baseline) {
      const { context, page, closeContext, capture } = await newContext(row, step.actor)
      const approveHandler: HandlerKey = step.phase === 'REQUEST' ? 'approvals.approveRequest' : step.phase === 'SOLUTION' ? 'solutions.approveSolution' : 'solutions.approveFinalApproval'
      let lane: StrictActionLane | null = null
      try {
        const candidateGroupId = strictBinding() ? await strictCandidateGroupId(rt(), step.phase, baseline.instanceId, baseline.order) : null
        lane = await strictLaneFor({
          capture,
          handler: approveHandler,
          spec: decisionSpec({ kind: 'approve', handler: approveHandler, baseline, candidateGroupId }),
          intendedActor: step.actor,
          args: baseline.phase === 'SOLUTION' ? [baseline.requestId, baseline.solutionId] : [baseline.requestId],
          row,
          title,
        })
        if (lane) await lane.begin() // durable attempting + capture.begin BEFORE the single click
        await page.goto(`${rt().baseUrl}/requests/my-actions`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        if (step.phase === 'SOLUTION') {
          // SOLUTION approvals are ONE direct "Approve Solution" mutation.
          await expect(dialog.getByRole('button', { name: 'Approve Solution' })).toHaveCount(1)
          await dialog.getByRole('button', { name: 'Approve Solution' }).scrollIntoViewIfNeeded()
          await page.waitForTimeout(MATRIX_HEADED.checkpointMs)
          guardClick()
          await dialog.getByRole('button', { name: 'Approve Solution' }).click()
        } else {
          await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(1)
          await dialog.getByRole('button', { name: 'Approve', exact: true }).scrollIntoViewIfNeeded()
          await page.waitForTimeout(MATRIX_HEADED.checkpointMs)
          guardClick()
          await dialog.getByRole('button', { name: 'Approve', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Confirm Approval' })).toBeVisible()
          guardClick()
          await page.getByRole('button', { name: 'Confirm Approval' }).click()
        }
        await strictResultWait(lane, capture,approveHandler,'positive-result',async()=>{ await expect(page.getByText('Approved successfully', { exact: true })).toBeVisible({ timeout: 30_000 }) })
        await closeContext()
        const evidence = await approvalEvidence(step, title, baseline)
        assertApprovalEvidence(evidence, {
          phase: baseline.phase,
          attempt: baseline.attempt,
          stepOrder: baseline.order,
          actor: step.actor,
          requestId: baseline.requestId,
          instanceId: baseline.instanceId,
        })
        if (lane) await requireStrictAction(lane, evidence, 'positive')
        return JSON.stringify(evidence)
      } catch (error) {
        (lane as StrictActionLane | null)?.retain()
        return failClosed(page, error, closeContext, files)
      }
    },

    async submitSolution(row, title, custom, priorRequest) {
      const { context, page, closeContext, capture } = await newContext(row, FIXTURE_ACTORS.engineerA)
      const solutionTitle = `Solution ${row.id}`
      let lane: StrictActionLane | null = null
      try {
        guardClick()
        await page.goto(`${rt().baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const requestDialog = page.getByRole('dialog')
        await requestDialog.getByRole('button', { name: 'Submit Solution' }).click()
        const form = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Submit Engineering Solution' }) })
        await expect(form).toBeVisible()
        await form.locator('#solutionTitle').fill(solutionTitle)
        const editor = form.locator('[contenteditable="true"]').first()
        await editor.click()
        await editor.fill(`Matrix solution ${row.id}`)
        await form.locator('#cost').fill('100')
        await form.locator('#timeline').fill('5 days')
        if (custom) {
          await enableCustom(form, 'solution')
          await pickCustomChain(page, form, CUSTOM_CHAINS.SOLUTION)
        }
        const session = await editor.getAttribute('data-inline-image-session')
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-solution-form`)
        lane = await strictLaneFor({
          capture,
          handler: 'solutions.submitSolution',
          spec: { kind: 'submit-solution', handler: 'solutions.submitSolution', target: rowlessTargetFor({ row, phase: 'SOLUTION', title: solutionTitle, requestId: priorRequest?.requestId ?? null, solutionId: null, attempt: 1, custom }) },
          intendedActor: matrixActorId(FIXTURE_ACTORS.engineerA),
          args: [{ requestId: priorRequest?.requestId ?? '', title: solutionTitle, description: `Matrix solution ${row.id}`, ...(session ? { inlineImageSessionId: session } : {}), costEstimate: 100, currency: 'THB', timeline: '5 days', fileIds: [], useCustomApprovals: custom, customApproverIds: custom ? CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id)) : [] }],
          row,
          title,
        })
        if (lane) await lane.begin() // durable attempting + capture.begin BEFORE the single click
        guardClick()
        await form.getByRole('button', { name: 'Submit Solution' }).click()
        await strictResultWait(lane, capture,'solutions.submitSolution','positive-result',async()=>{ await expect(page.getByText('Solution submitted successfully')).toBeVisible({ timeout: 30_000 }) })
        await closeContext()
        const evidence = await solutionSubmitEvidence(title, custom, row.profile)
        if (!priorRequest) throw new Error('submitSolution requires the pre-click request id')
        if (!evidence.observedInstanceId) throw new Error('solution submit did not return the observed instance id')
        assertSolutionSubmitEvidence(evidence, {
          requestId: priorRequest.requestId,
          instanceId: evidence.observedInstanceId,
          attempt: 1,
          customChainIds: custom ? CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id)) : undefined,
        })
        if (evidence.requestId !== priorRequest.requestId) throw new Error('solution evidence request != pre-click request')
        if (lane) await requireStrictAction(lane, evidence, 'positive')
        return JSON.stringify(evidence)
      } catch (error) {
        (lane as StrictActionLane | null)?.retain()
        return failClosed(page, error, closeContext, files)
      }
    },

    async rejectCurrentStep(row, title, baseline) {
      const rejector = row.orderedActorIds[row.rejectOrder - 1]
      const { context, page, closeContext, capture } = await newContext(row, rejector)
      const rejectHandler: HandlerKey = row.phase === 'REQUEST' ? 'approvals.rejectRequest' : row.phase === 'SOLUTION' ? 'solutions.rejectSolution' : 'solutions.rejectFinalApproval'
      let lane: StrictActionLane | null = null
      try {
        await page.goto(`${rt().baseUrl}/requests/my-actions`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        const rejectButton = row.phase === 'SOLUTION' ? 'Reject Solution' : 'Reject'
        const placeholder = row.phase === 'SOLUTION' ? /rejecting this solution/i : /explain the reason/i
        await dialog.getByRole('button', { name: rejectButton, exact: true }).click()
        const confirm = page.getByRole('button', { name: 'Confirm Rejection' })
        await expect(confirm).toBeVisible()
        // REQUIRED blank-reason guard as an immediate UI-only negative pair:
        // the BEFORE snapshot and its immutable write complete before the
        // disabled assertion; the AFTER completes the unchanged gate.
        const blankLane = strictBinding() && capture
        if (blankLane) {
          await uiOnlyPair(`${row.id}-blank-reason`, 'blank-reason', row, title, async () => {
            await expect(confirm).toBeDisabled()
          })
        } else {
          await expect(confirm).toBeDisabled()
        }
        const reasonField = page.getByPlaceholder(placeholder)
        await expect(reasonField).toBeVisible()
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-pre-reject-${rejector}`)
        await reasonField.fill(row.reason)
        const candidateGroupId = strictBinding() ? await strictCandidateGroupId(rt(), row.phase, baseline.instanceId, baseline.order) : null
        lane = await strictLaneFor({
          capture,
          handler: rejectHandler,
          spec: decisionSpec({ kind: 'reject', handler: rejectHandler, baseline, candidateGroupId }),
          intendedActor: rejector,
          args: row.phase === 'SOLUTION' ? [baseline.requestId, baseline.solutionId, row.reason] : [baseline.requestId, row.reason],
          row,
          title,
        })
        if (lane) await lane.begin() // durable attempting + capture.begin BEFORE the single click
        guardClick()
        await confirm.click()
        await strictResultWait(lane, capture, rejectHandler,'positive-result',async()=>{ await expect(page.getByText('Rejected successfully', { exact: true })).toBeVisible({ timeout: 30_000 }) })
        await closeContext()
        const evidence = await rejectionEvidence(row, title, rejector, {
          requestId: baseline.requestId,
          instanceId: baseline.instanceId,
          attempt: baseline.attempt,
          approvalRowId: baseline.approvalRowId,
        })
        assertRejectionEvidence(evidence, {
          phase: baseline.phase,
          requestId: baseline.requestId,
          status: expectedPostRejectStatus(row.phase),
          actor: rejector,
          reason: row.reason,
          order: baseline.order,
          instanceId: baseline.instanceId,
          attempt: baseline.attempt,
        })
        if (lane) await requireStrictAction(lane, evidence, 'positive')
        return JSON.stringify(evidence)
      } catch (error) {
        (lane as StrictActionLane | null)?.retain()
        return failClosed(page, error, closeContext, files)
      }
    },

    async openHeldRejectDialog(row, title, baseline) {
      const rejector = row.orderedActorIds[row.rejectOrder - 1]
      const opened = await newContext(row, rejector)
      return encloseFailedSetup({
        open: async () => ({
          capture: async () => {
            const shot = path.join(currentCaseDir ?? evidenceRoot, 'failures', `${row.id}-held-setup.png`)
            await fs.mkdir(path.dirname(shot), { recursive: true })
            await opened.page.screenshot({ path: shot })
          },
          close: () => opened.closeContext(),
        }),
        run: async () => {
          const { page, closeContext, capture } = opened
          await page.goto(`${rt().baseUrl}/requests/my-actions`)
          const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
          await expect(rowEl).toBeVisible()
          await rowEl.click()
          const dialog = page.getByRole('dialog')
          await expect(dialog).toBeVisible()
          const rejectButton = row.phase === 'SOLUTION' ? 'Reject Solution' : 'Reject'
          await dialog.getByRole('button', { name: rejectButton, exact: true }).click()
          const confirm = page.getByRole('button', { name: 'Confirm Rejection' })
          await expect(confirm).toBeVisible()
          const reasonField = page.getByPlaceholder(row.phase === 'SOLUTION' ? /rejecting this solution/i : /explain the reason/i)
          await reasonField.fill(`HELD stale dialog ${row.id}`)
          let closed = false
          const held: HeldRejectDialog = {
            target: {
              instanceId: baseline.instanceId,
              attempt: baseline.attempt,
              stepOrder: baseline.order,
              actor: row.orderedActorIds[row.rejectOrder - 1],
              approvalRowId: baseline.approvalRowId,
            },
            confirmAvailable: async () => (await confirm.isVisible()) && (await confirm.isEnabled()),
            staleConfirm: async () => {
              if (!(await confirm.isVisible().catch(() => false))) {
                return { outcome: 'unavailable' as const, evidence: 'held confirm is not available' }
              }
              // Strict lane: exactly one confirm click with the same bounded
              // 15,000 ms window; the deny-stale ActionEvidence comes from the
              // same capture/journal lane, never from the toast text.
              const staleHandler: HandlerKey = row.phase === 'REQUEST' ? 'approvals.rejectRequest' : row.phase === 'SOLUTION' ? 'solutions.rejectSolution' : 'solutions.rejectFinalApproval'
              const binding = rt().assuranceBinding ?? null
              const staleLane = binding && capture ? await beginStrictAction({
                capture,
                binding,
                manifest: rt().observerManifest as ObserverCopyManifest,
                handler: staleHandler,
                spec: { kind: 'deny-stale', handler: staleHandler, target: { ...baseline, candidateGroupId: null, currentOrder: baseline.order }, current: await readSnapshot(title) },
                intendedActor: row.orderedActorIds[row.rejectOrder - 1],
                args: [baseline.requestId, `HELD stale dialog ${row.id}`],
                caseId: row.id,
                title,
                journalPath: journalPathOf(),
                root: currentCaseDir ?? evidenceRoot,
                io: files,
                readBusiness: () => readBusinessSnapshot(row, title),
              }) : null
              if (staleLane) await staleLane.begin()
              const admitted = capture as RegisteredContextCapture
              const staleDeadline = staleLane ? admitted.startResultWait(staleLane.record, 'held-stale-confirm') : null
              guardClick()
              await confirm.click()
              let denied = false
              let succeeded = false
              if (staleDeadline) {
                const now = (): number => admitted.now().monotonicMs
                const deadline = staleDeadline.started.monotonicMs + 15_000
                while (now() < deadline) {
                  denied = await page.getByText('An error occurred while rejecting').isVisible().catch(() => false)
                  succeeded = await page.getByText('Rejected successfully', { exact: true }).isVisible().catch(() => false)
                  if (denied || succeeded) break
                  await page.waitForTimeout(250)
                }
              } else {
                const now = (): number => capture.now().monotonicMs
                const legacyDeadline = await resultWait(capture, staleHandler, 'held-stale-confirm', async (resultDeadline) => {
                  const deadline = resultDeadline!.started.monotonicMs + 15_000
                  while (now() < deadline) {
                    denied = await page.getByText('An error occurred while rejecting').isVisible().catch(() => false)
                    succeeded = await page.getByText('Rejected successfully', { exact: true }).isVisible().catch(() => false)
                    if (denied || succeeded) return
                    await page.waitForTimeout(250)
                  }
                })
                void legacyDeadline
              }
              let outcome: { outcome: 'denied' | 'succeeded' | 'unavailable' | 'unknown'; evidence: string }
              if (succeeded) outcome = { outcome: 'succeeded', evidence: 'Rejected successfully toast observed' }
              else if (!denied) outcome = { outcome: 'unknown', evidence: 'no denial toast and no success toast' }
              else outcome = { outcome: 'denied', evidence: 'denial toast; terminal/instance/audit snapshot compared before and after' }
              if (staleLane && staleDeadline) {
                await staleLane.finish(staleDeadline)
                if (outcome.outcome === 'denied') {
                  const actionEvidence = await requireStrictAction(staleLane, null, 'denied')
                  return { ...outcome, actionEvidence }
                }
                staleLane.retain()
              }
              return outcome
            },
            close: async () => {
              if (closed) return
              closed = true
              await closeContext()
            },
          }
          activeHeldReject = held
          return held
        },
      })
    },

    async resubmit(row, phase, custom, title, baseline, deps?: {
      newContext?: (row: MatrixRow | null, label: string) => Promise<{ context: BrowserContext; page: Page; closeContext: () => Promise<void>; capture?: ContextCapture }>
      baseUrl?: string
      queryReadOnly?: (sql: string) => Promise<unknown>
      opener?: { openerVisible?: (open: Locator, timeoutMs: number) => Promise<void> }
    }): Promise<string> {
      const actorId = phase === 'REQUEST' ? FIXTURE_ACTORS.requesterA : FIXTURE_ACTORS.engineerA
      const { context, page, closeContext, capture } = await (deps?.newContext ?? newContext)(row, actorId)
      const readQuery = deps?.queryReadOnly ?? ((sql: string) => rt().queryReadOnly(sql))
      const resubmitHandler: HandlerKey = phase === 'REQUEST' ? 'requests.resubmitRequest' : 'solutions.resubmitSolution'
      let lane: StrictActionLane | null = null
      const beginResubmitLane = async (input: { args: readonly unknown[]; title: string }): Promise<void> => {
        if (deps?.newContext || !strictBinding()) return
        lane = await strictLaneFor({
          capture,
          handler: resubmitHandler,
          spec: { kind: 'resubmit', handler: resubmitHandler, target: rowlessTargetFor({ row, phase, title: input.title, requestId: baseline.requestId, solutionId: phase === 'SOLUTION' ? baseline.solutionId ?? null : null, attempt: baseline.attempt + 1, custom, previous: baseline }) },
          intendedActor: actorId,
          args: input.args,
          row,
          title,
        })
        if (lane) await lane.begin()
      }
      try {
        guardClick()
        await page.goto(`${deps?.baseUrl ?? rt().baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        if (phase === 'REQUEST') {
          await expect(dialog.getByRole('heading', { name: 'Resubmit Request' })).toBeVisible()
          const editor = dialog.locator('[contenteditable="true"]').first()
          await editor.click()
          await editor.fill(`Corrected request ${row.id} (recovery attempt)`)
          const requestSession = await editor.getAttribute('data-inline-image-session')
          await beginResubmitLane({
            args: [{ requestId: baseline.requestId, title: `Corrected request ${row.id} (recovery attempt)`, description: `Corrected request ${row.id} (recovery attempt)`, ...(requestSession ? { inlineImageSessionId: requestSession } : {}) }],
            title: `Corrected request ${row.id} (recovery attempt)`,
          })
          guardClick()
          await dialog.getByRole('button', { name: 'Resubmit Request' }).click()
          await strictResultWait(lane, capture,'requests.resubmitRequest','positive-result',async()=>{ await expect(page.getByText('Request resubmitted successfully')).toBeVisible({ timeout: 30_000 }) })
        } else {
          // The resubmit form may already be open; only click the opener when
          // the form is not visible yet.
          let form = page.getByRole('dialog', { name: /Resubmit Solution/ })
          const open = dialog.getByRole('button', { name: 'Resubmit Solution' })
          await ensureResubmitSolutionOpenerReadyAndOpen({ form, open, deps: deps?.opener })
          await expect(form).toBeVisible()
          const editor = form.locator('[contenteditable="true"]').first()
          await editor.click()
          await editor.fill(`Revised solution ${row.id} (Engineering redesign)`)
          await form.locator('#cost').fill('200')
          await form.locator('#timeline').fill('8 days')
          if (custom) {
            await enableCustom(form, 'resubmit')
            await pickCustomChain(page, form, CUSTOM_CHAINS.SOLUTION)
          }
          const solutionSession = await (form.locator('[contenteditable="true"]').first()).getAttribute('data-inline-image-session')
          await beginResubmitLane({
            args: [{ requestId: baseline.requestId, title: `Revised solution ${row.id} (Engineering redesign)`, description: `Revised solution ${row.id} (Engineering redesign)`, ...(solutionSession ? { inlineImageSessionId: solutionSession } : {}), cost: 200, currency: 'THB', timeline: '8 days', newFileIds: [], deletedFileIds: [], useCustomHierarchy: custom, customApprovers: custom ? CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id)) : [] }],
            title: `Revised solution ${row.id} (Engineering redesign)`,
          })
          guardClick()
          await form.getByRole('button', { name: 'Resubmit Solution' }).click()
          await strictResultWait(lane, capture,'solutions.resubmitSolution','positive-result',async()=>{ await expect(page.getByText('Solution resubmitted successfully')).toBeVisible({ timeout: 30_000 }) })
        }
        await closeContext()
        const evidence = await resubmitEvidence(phase, title, custom, readQuery)
        assertResubmitEvidence(evidence, {
          requestId: baseline.requestId,
          previousAttempt: baseline.attempt,
          previousInstanceId: baseline.instanceId,
          customChainIds: custom ? CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id)) : undefined,
        })
        if (lane) await requireStrictAction(lane, evidence, 'positive')
        return JSON.stringify(evidence)
      } catch (error) {
        (lane as StrictActionLane | null)?.retain()
        return failClosed(page, error, closeContext, files)
      }
    },

    async initiateFinal(row, title, custom, _priorRequest, expectedAttempt) {
      const { context, page, closeContext, capture } = await newContext(row, FIXTURE_ACTORS.requesterA)
      let lane: StrictActionLane | null = null
      try {
        const priorRequest = await requestByTitle(title)
        lane = await strictLaneFor({
          capture,
          handler: 'solutions.initiateFinalApproval',
          spec: { kind: 'initiate-final', handler: 'solutions.initiateFinalApproval', target: rowlessTargetFor({ row, phase: 'FINAL', title, requestId: priorRequest.id, solutionId: null, attempt: expectedAttempt, custom }) },
          intendedActor: matrixActorId(FIXTURE_ACTORS.requesterA),
          args: [priorRequest.id, custom, ...(custom ? [CUSTOM_CHAINS.FINAL.map((id) => matrixActorId(id))] : [])],
          row,
          title,
        })
        if (lane) await lane.begin() // durable attempting + capture.begin BEFORE the single click
        guardClick()
        await page.goto(`${rt().baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const requestDialog = page.getByRole('dialog')
        await requestDialog.getByRole('button', { name: 'Submit Final Approval' }).click()
        const form = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Initiate Final Approval' }) })
        await expect(form).toBeVisible()
        if (custom) {
          await enableCustom(form, 'final')
          await pickCustomChain(page, form, CUSTOM_CHAINS.FINAL)
        }
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-final-form`)
        guardClick()
        await form.getByRole('button', { name: 'Start Final Approval' }).click()
        await strictResultWait(lane, capture,'solutions.initiateFinalApproval','positive-result',async()=>{ await expect(page.getByText('Final approval initiated successfully')).toBeVisible({ timeout: 30_000 }) })
        await closeContext()
        const evidence = await finalInitiationEvidence(row, title, custom, expectedAttempt)
        proveFinalInitiation(evidence, {
          requestId: priorRequest.id,
          instanceId: evidence.observedInstanceId ?? evidence.instanceId,
          attempt: expectedAttempt,
          routingMode: custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
          routeSource: custom ? 'CUSTOM_PERSON' : expectedRouteSource(row.profile, 'FINAL'),
          orderedActorIds: custom ? CUSTOM_CHAINS.FINAL.map((id) => matrixActorId(id)) : RANK_CHAINS[row.profile].FINAL.map((id) => matrixActorId(id)),
          customChainIds: custom ? CUSTOM_CHAINS.FINAL.map((id) => matrixActorId(id)) : undefined,
        })
        if (lane) await requireStrictAction(lane, evidence, 'positive')
        return JSON.stringify(evidence)
      } catch (error) {
        (lane as StrictActionLane | null)?.retain()
        return failClosed(page, error, closeContext, files)
      }
    },

    async checkReviserControl(row, title) {
      const { context, page, closeContext, capture } = await newContext(row, row.reviser)
      try {
        await page.goto(`${rt().baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        const control = row.phase === 'REQUEST' ? 'Resubmit Request' : 'Resubmit Solution'
        await expect(dialog.getByRole('button', { name: control })).toBeVisible()
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-reviser-control-${row.reviser}`)
        await closeContext()
        return `${row.reviser} has ${control}`
      } catch (error) {
        return failClosed(page, error, closeContext, files)
      }
    },

    async checkUnauthorizedViewer(row, title) {
      const { context, page, closeContext, capture } = await newContext(row, FIXTURE_ACTORS.staffB)
      try {
        await page.goto(`${rt().baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByRole('button', { name: /Resubmit/ })).toHaveCount(0)
        await expect(dialog.getByRole('button', { name: /^Approve/ })).toHaveCount(0)
        await expect(dialog.getByRole('button', { name: /Reject/ })).toHaveCount(0)
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-unauthorized-readonly`)
        await closeContext()
        return 'unauthorized viewer read-only (loaded-list visibility only; no direct-link claim)'
      } catch (error) {
        return failClosed(page, error, closeContext, files)
      }
    },

    async verifyCompleted(row, title) {
      const { context, page, closeContext, capture } = await newContext(row, FIXTURE_ACTORS.requesterA)
      try {
        guardClick()
        await page.goto(`${rt().baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl.getByText('Completed', { exact: true })).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        const bannerSeen = await dialog.getByText('Final Approval Completed').isVisible()
        if (!bannerSeen) throw new Error('Final Approval Completed banner was not visible')
        const stage3 = await findStageBlock(dialog, 3)
        await stage3.scrollIntoViewIfNeeded()
        const stageBox = await stage3.boundingBox()
        const viewport = page.viewportSize()
        const stage3InViewport = Boolean(stageBox && viewport && stageBox.y >= 0 && stageBox.y < viewport.height)
        if (!stage3InViewport) throw new Error('stage 3 is not in the viewport')
        await page.waitForTimeout(MATRIX_HEADED.checkpointMs)
        await page.screenshot({ path: path.join(currentCaseDir ?? evidenceRoot, 'screenshots', `completed-stage3-inviewport-${Date.now()}.png`) })
        await closeContext()
        const request = await requestByTitle(title)
        const evidence = await completedDbEvidence(request.id, bannerSeen, stage3InViewport)
        assertCompletedEvidence(evidence)
        return JSON.stringify(evidence)
      } catch (error) {
        return failClosed(page, error, closeContext, files)
      }
    },
  }
  return ui
}

export async function failClosed(
  page: Page | { screenshot(opts: { path: string }): Promise<unknown> },
  error: unknown,
  cleanup: () => Promise<void>,
  io?: { mkdir(dir: string, opts?: { recursive?: boolean }): Promise<unknown>; writeFile(file: string, body: string): Promise<unknown> },
): Promise<never> {
  const files = io ?? fs
  let failure: unknown = error
  const dir = path.join(currentCaseDir ?? evidenceDir, 'failures')
  const shot = path.join(dir, `context-${Date.now()}.png`)
  try {
    try {
      await files.mkdir(dir, { recursive: true })
      try {
        await page.screenshot({ path: shot })
      } catch (shotError) {
        try {
          await files.writeFile(path.join(dir, 'screenshot-failed.txt'), shotError instanceof Error ? shotError.message : String(shotError))
        } catch (writeError) {
          const shotText = shotError instanceof Error ? shotError.message : String(shotError)
          const writeText = writeError instanceof Error ? writeError.message : String(writeError)
          failure = new Error(`${failure instanceof Error ? failure.message : String(failure)}; screenshot failed: ${shotText}; screenshot record failed: ${writeText}`)
        }
      }
    } catch (writeError) {
      failure = new Error(`${failure instanceof Error ? failure.message : String(failure)}; artifact write failed: ${writeError instanceof Error ? writeError.message : String(writeError)}`)
    }
  } finally {
    try {
      await cleanup()
    } catch (cleanupError) {
      failure = new Error(`${failure instanceof Error ? failure.message : String(failure)}; cleanup failure: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
    }
  }
  throw failure
}

async function rethrowWithCleanup(error: unknown, cleanup: () => Promise<void>): Promise<never> {
  try {
    await cleanup()
  } catch (cleanupError) {
    const original = error instanceof Error ? error.message : String(error)
    const extra = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    throw new Error(`${original}; cleanup failure: ${extra}`)
  }
  throw error
}

export interface ScopedCaptureOutcome {
  errors: readonly string[]
  payload?: unknown
}

/** Single session-level caller gate around exactly one matrix case: runs the
 *  case, captures the required scoped evidence, records failure artifacts,
 *  attempts the final progress flush and decides the CaseResult. Required
 *  scoped evidence must persist with zero errors BEFORE a case is marked or
 *  logged as passed; otherwise the case fails, failure artifacts are attempted
 *  with the combined error, and the combined error propagates so no further
 *  case can run (session runtime and browser cleanup still execute
 *  unconditionally in the session enclosure). The failure path throws the
 *  primary error COMBINED with retained capture errors — never the original
 *  alone. The final progress flush runs INSIDE the gate on every completed
 *  case outcome, so a flush failure can never replace the pending gate error
 *  (the previous `finally { await flushProgress() }` in the loop did exactly
 *  that): flush failures are appended to the propagated error, and a flush
 *  failure after a green run still fails the case and stops the session. */
export async function runCaseWithEvidenceGate(input: {
  caseId: string
  result: CaseResult
  runCase: () => Promise<{ staleNegative: CaseResult['staleNegative'] }>
  captureEvidence: (outcome: 'passed' | 'failed' | 'ambiguous') => Promise<ScopedCaptureOutcome>
  recordFailureArtifacts: (error: Error, captured: ScopedCaptureOutcome) => Promise<void>
  flushProgress: () => Promise<void>
  log: (line: string) => void
}): Promise<void> {
  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  const safeCapture = async (outcome: 'passed' | 'failed' | 'ambiguous'): Promise<ScopedCaptureOutcome> => {
    try {
      return await input.captureEvidence(outcome)
    } catch (error) {
      return { errors: [`capture crashed: ${message(error)}`] }
    }
  }
  const safeFlush = async (): Promise<string> => {
    try {
      await input.flushProgress()
      return ''
    } catch (error) {
      return `; progress flush failed: ${message(error)}`
    }
  }
  const preserveAndThrow = async (combined: Error, captured: ScopedCaptureOutcome, flushAttempted: boolean): Promise<never> => {
    let artifactNote = ''
    try {
      await input.recordFailureArtifacts(combined, captured)
    } catch (artifactError) {
      artifactNote = `; failure artifact write failed: ${message(artifactError)}`
    }
    const flushNote = flushAttempted ? '' : await safeFlush()
    throw new Error(`${combined.message}${artifactNote}${flushNote}`)
  }
  let green: { staleNegative: CaseResult['staleNegative'] } | null = null
  let primaryError: unknown = null
  try {
    green = await input.runCase()
  } catch (error) {
    primaryError = error
  }
  if (primaryError !== null || green === null) {
    const primaryMessage = primaryError !== null ? message(primaryError) : 'runCase returned no outcome'
    input.result.status = 'failed'
    input.result.error = primaryMessage
    input.log(`CASE ${input.caseId} FAILED: ${primaryMessage}`)
    const captured = await safeCapture(primaryMessage.includes('unknown') ? 'ambiguous' : 'failed')
    const combined = captured.errors.length > 0
      ? new Error(`${primaryMessage}; ${captured.errors.join('; ')}`)
      : primaryError instanceof Error ? primaryError : new Error(primaryMessage)
    await preserveAndThrow(combined, captured, false)
  }
  const captured = await safeCapture('passed')
  if (captured.errors.length > 0) {
    const combined = new Error(`${input.caseId} ran green but required scoped evidence did not persist: ${captured.errors.join('; ')}`)
    input.result.status = 'failed'
    input.result.error = combined.message
    input.log(`CASE ${input.caseId} FAILED: ${combined.message}`)
    await preserveAndThrow(combined, captured, false)
  }
  const flushNote = await safeFlush()
  if (flushNote) {
    const combined = new Error(`${input.caseId} ran green but the final progress flush failed${flushNote}`)
    input.result.status = 'failed'
    input.result.error = combined.message
    input.log(`CASE ${input.caseId} FAILED: ${combined.message}`)
    await preserveAndThrow(combined, captured, true)
  }
  input.result.status = 'passed'
  input.result.staleNegative = (green as { staleNegative: CaseResult['staleNegative'] }).staleNegative
  input.log(`CASE ${input.caseId} PASSED`)
}

export const RESUBMIT_OPENER_READINESS_TIMEOUT_MS = 30_000

/** The request dialog may still show its loading skeleton when the recovery
 *  resubmit step opens it: the opener renders only after the modal data
 *  resolves. The Playwright default expect budget (5s) raced exactly that
 *  latency in profile-2 RRM-023, so the opener readiness uses an explicit
 *  bounded budget instead. This seam OWNS the single opener click: returns
 *  without touching anything when the resubmit form is already open
 *  (identical isVisible().catch(() => false) branch as before), otherwise
 *  waits the bounded budget and clicks the opener exactly once. No retry,
 *  polling, or extra click semantics live here; ledger/correlation are
 *  untouched. */
export async function ensureResubmitSolutionOpenerReadyAndOpen(input: {
  form: Locator
  open: Locator
  deps?: {
    formVisible?: (form: Locator) => Promise<boolean>
    openerVisible?: (open: Locator, timeoutMs: number) => Promise<void>
    click?: (open: Locator) => Promise<void>
  }
}): Promise<void> {
  const formVisible = input.deps?.formVisible ?? ((form: Locator) => form.isVisible().catch(() => false))
  if (await formVisible(input.form)) return
  const openerVisible = input.deps?.openerVisible ??
    ((open: Locator, timeoutMs: number) => expect(open).toBeVisible({ timeout: timeoutMs }))
  const click = input.deps?.click ?? ((open: Locator) => open.click())
  await openerVisible(input.open, RESUBMIT_OPENER_READINESS_TIMEOUT_MS)
  await click(input.open)
}

function actorEmail(actorId: string): string {
  try {
    return matrixActorEmail(fixtureActorIdFromMatrix(actorId))
  } catch {
    return matrixActorEmail(actorId)
  }
}

function actorIdEmail(actorId: string): string {
  return actorEmail(actorId)
}

async function main(): Promise<void> {
  const options = parseOptions()
  evidenceDir = path.join(options.evidenceRoot, options.routesConfig, 'runtime')
  await fs.mkdir(evidenceDir, { recursive: true })
  const allRows = buildInventory()
  // State-machine validation of EVERY selected plan before any runtime exists.
  for (const row of allRows) validateCasePlan(row, buildCasePlan(row))
  const staleChecks = buildStaleNegativeChecks(allRows)
  const rows = allRows.filter(
    (r) => r.profile === options.routesConfig && (!options.caseIds || options.caseIds.includes(r.id)),
  )
  if (rows.length === 0) throw new Error('no matching inventory rows')
  log(`profile ${options.routesConfig}: ${rows.length} selected case(s); all plans state-machine validated; co-candidate verification ${LIVE_CO_CANDIDATE_VERIFICATION}`)
  await journal('startup')

  handle = await startMatrixRuntime({
    routesConfig: options.routesConfig,
    log,
    seedCleared: options.seedCleared,
    artifactCapture: async (note) => { await journal(`runtime artifact capture (${note})`) },
  })
  handle.setArtifactCapture(async () => {
    await journal('pre-stop artifact capture')
    const mailFile = path.join(evidenceDir, 'mail.json')
    const messages = handle.mail?.messages() ?? []
    await fs.writeFile(mailFile, JSON.stringify(messages, null, 2))
    const aggregatePath = path.join(options.evidenceRoot, 'all-profiles.json')
    let existing: Record<string, unknown> = {}
    try {
      existing = JSON.parse(await fs.readFile(aggregatePath, 'utf8')) as Record<string, unknown>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`all-profiles aggregate is unreadable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const next = retainProfileAggregate(existing, options.routesConfig, {
      mailFile,
      cases: results.map((result) => result.caseId),
      updatedAt: new Date().toISOString(),
    })
    await fs.writeFile(aggregatePath, JSON.stringify(next, null, 2))
  })
  let traces: string[] = []
  await runOwnedMatrixSession({
    handle,
    log,
    launchBrowser: () => chromium.launch({ headless: MATRIX_HEADED.headless, slowMo: MATRIX_HEADED.slowMo }),
    run: async (browser) => {
      const ui = playwrightMatrixUi(browser as Browser, options.evidenceRoot)
      traces = ui.traces
      const captureCaseEvidence = async (caseId: string, title: string, outcome: 'passed' | 'failed' | 'ambiguous') => {
        const unresolved = activeLedger?.all.find((entry) => entry.stage === 'attempting')
        let requestId = 'missing-request'
        try {
          const found = await handle.queryReadOnly(requestByTitleSql(title))
          if (Array.isArray(found) && found[0] && typeof found[0] === 'object' && 'id' in found[0]) requestId = String(found[0].id)
        } catch (error) {
          requestId = `lookup-failed:${error instanceof Error ? error.message : String(error)}`
        }
        const aggregatePath = path.join(options.evidenceRoot, 'all-profiles.json')
        const casePath = path.join(currentCaseDir ?? evidenceDir, outcome === 'passed' ? 'business-evidence.json' : path.join('failures', 'business-evidence.json'))
        return persistScopedCaseEvidence({
          requestId,
          profile: options.routesConfig,
          caseId,
          outcome,
          unresolvedTarget: unresolved?.instanceId && unresolved.rowId && unresolved.phase && unresolved.attempt
            ? { instanceId: unresolved.instanceId, attempt: unresolved.attempt, approvalRowId: unresolved.rowId, phase: unresolved.phase }
            : null,
          query: (sql) => handle.queryReadOnly(sql),
          readAggregate: () => fs.readFile(aggregatePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return ''
            throw error
          }),
          writeAggregate: (body) => fs.writeFile(aggregatePath, body),
          writeCase: async (body) => {
            await fs.mkdir(path.dirname(casePath), { recursive: true })
            await fs.writeFile(casePath, body)
          },
          cleanup: () => journal(`evidence cleanup ${caseId}`),
        })
      }
      for (const row of rows) {
        currentCaseId = row.id
        currentCaseDir = await caseDir(options.evidenceRoot, row)
        const title = `RRM ${row.id} ${row.profile} ${row.phase} pos${row.rejectOrder} ${Date.now()}`
        const result: CaseResult = { caseId: row.id, requestTitle: title, status: 'failed' }
        results.push(result)
        activeLedger?.assertNoUnresolvedAttempting()
        const ledger = new MatrixLedger()
        activeLedger = ledger
        retainCaseJournal(matrixJournal, row.id, ledger.all, 'case-start')
        await runCaseWithEvidenceGate({
          caseId: row.id,
          result,
          runCase: () => runMatrixCase(row, ui, ledger, journal, title),
          captureEvidence: (outcome) => captureCaseEvidence(row.id, title, outcome),
          recordFailureArtifacts: async (failureError, captured) => {
            let mailText = ''
            try { mailText = JSON.stringify(handle.mail?.messages() ?? []) } catch (mailError) {
              mailText = `mail capture failed: ${mailError instanceof Error ? mailError.message : String(mailError)}`
            }
            await writeFailureArtifacts({
              dir: path.join(currentCaseDir ?? evidenceDir, 'failures'),
              label: row.id,
              error: failureError,
              dbText: JSON.stringify(captured.payload),
              auditText: JSON.stringify((captured.payload as { activities?: unknown }).activities ?? captured.payload),
              notificationText: JSON.stringify((captured.payload as { notifications?: unknown }).notifications ?? captured.payload),
              mailText,
              progressText: JSON.stringify({ runId: handle.runtime.runId, dataDir: handle.runtime.paths.dataDir, databasePort: handle.runtime.ports.databasePort, journal: matrixJournal }),
            })
            await journal(`FAILED case ${row.id}`)
            const failedLines = await Promise.all(ui.traces.map(async (trace) => {
              const stat = await fs.stat(trace).catch(() => null)
              return stat?.isFile() && stat.size > 0 ? `PASSED ${trace}` : `FAILED ${trace}`
            }))
            await fs.writeFile(path.join(evidenceDir, 'traces-index.txt'), failedLines.join('\n'))
          },
          flushProgress,
          log,
        })
      }
      const lines: string[] = []
      for (const trace of ui.traces) {
        const stat = await fs.stat(trace).catch(() => null)
        lines.push(stat?.isFile() && stat.size > 0 ? `PASSED ${trace}` : `FAILED ${trace}`)
      }
      await fs.writeFile(path.join(evidenceDir, 'traces-index.txt'), lines.join('\n'))
      if (lines.some((line) => line.startsWith('FAILED '))) throw new Error(`trace index contains missing artifacts: ${lines.filter((line) => line.startsWith('FAILED ')).join('; ')}`)
      log(`MATRIX PASSED: ${results.length} case(s) on ${options.routesConfig}.`)
    },
  })
  if (activeHeldReject) await activeHeldReject.close()
  void traces
  void staleChecks
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
