/**
 * Lifecycle-safe action-wire capture for the admin HTTP-security spec
 * (test-only).
 *
 * History:
 *  - run 3: unhandled request.allHeaders() rejection racing teardown →
 *    tracked captures + detach/settle/close order.
 *  - run 4: unbounded settlement hung the suite → bounded diagnostic
 *    deadline failing with pending metadata.
 *  - round 5 diagnostics review: real Page lifecycle events, persisted
 *    sanitized artifact, allowlisted categories.
 *  - round 6 diagnostics review (this version):
 *      (P1) disposal is UNCONDITIONAL: the afterAll evidence seam
 *          `settleThenPersistAndDispose` nests dispose() in a finally
 *          around serialization/attachment, so an attachment or
 *          serialization failure can never skip listener removal; the
 *          primary settlement failure takes precedence; with no primary,
 *          the evidence failure itself propagates.
 *      (P1) NO stack-location extraction exists (removed entirely — no
 *          regex could be made provably safe against multiline messages
 *          and path-bearing frames); no raw filepaths or arbitrary
 *          multiline error text ever enter artifacts or thrown summaries.
 *          Network codes come from a finite explicit allowlist;
 *          unrecognized ERR_* tokens fall back to `unknown` and are never
 *          exported.
 *      (P2) attachments AND timeout/settlement summaries use the SAME
 *          bounded projection (capped records, capped events per record,
 *          total/truncation counts, failed/pending records prioritized),
 *          preserving full failure accounting while keeping every output
 *          finite. Expiry is never success.
 *
 * Privacy scope, stated honestly: diagnostics contain a local id, the
 * next-action id and request pathname (both LENGTH-CAPPED, not claimed
 * universally secret-safe), monotonic timestamps, sanitized timeline
 * events, and allowlisted error categories/codes. They never contain
 * header maps, cookies, bodies, postData, passwords, tokens, query
 * strings, filepaths, or raw error text — in memory, in artifacts, and in
 * thrown summaries alike.
 *
 * Snapshot timing, stated honestly: the serialized artifact is a
 * point-in-time snapshot taken by the afterAll seam after context
 * cleanup. Failures occurring AFTER that snapshot stay HANDLED in memory
 * (rejection handlers remain attached; accounting is never dropped) but
 * are not streamed into any artifact — this is not a streaming sink.
 *
 * `context.close()` awaits remain unbounded (pre-existing browser
 * semantics); only settlement is deadline-bounded here.
 *
 * Locked by tests/regression/admin-action-wire-capture.test.ts (RED/GREEN).
 */

export interface CapturedWire {
  actionId: string
  path: string
  postData: string | null
  stateTree: string | null
  nextUrl: string | null
}

/** Minimal request surface the capture reads (a Playwright Request satisfies this). */
export interface ActionWireRequestSource {
  method(): string
  headers(): Record<string, string>
  url(): string
  postData(): string | null
  allHeaders(): Promise<Record<string, string>>
}

/** Minimal response surface for page 'response' correlation (a Playwright Response satisfies this). */
export interface ActionWireResponseSource {
  request(): ActionWireRequestSource
}

/** Minimal page surface with Playwright's REAL event names (a Playwright Page satisfies this). */
export interface ActionWirePageSource {
  on(event: 'request', listener: (request: ActionWireRequestSource) => void): unknown
  on(event: 'response', listener: (response: ActionWireResponseSource) => void): unknown
  on(event: 'requestfinished' | 'requestfailed', listener: (request: ActionWireRequestSource) => void): unknown
  off(event: 'request', listener: (request: ActionWireRequestSource) => void): unknown
  off(event: 'response', listener: (response: ActionWireResponseSource) => void): unknown
  off(event: 'requestfinished' | 'requestfailed', listener: (request: ActionWireRequestSource) => void): unknown
}

export interface ActionWireCapture {
  /** Wires captured so far (mutated as in-flight captures complete). */
  readonly captured: readonly CapturedWire[]
  /** Sanitized per-capture diagnostics (in memory; serialize for artifacts). */
  readonly diagnostics: readonly SanitizedCaptureDiagnostic[]
  /** Stop accepting new requests (idempotent); lifecycle correlation and settlement continue. */
  detach(): void
  /** Finally remove EVERY page listener (idempotent); rejection handlers stay attached. */
  dispose(): void
  /** Bounded, sanitized JSON artifact of all diagnostic records (test/persist this, not memory). */
  serializeDiagnostics(): string
  /**
   * Await every in-flight capture, then rethrow the capture failure(s) as a
   * SAFE summary error. Bounded by a diagnostic deadline: on expiry, fails
   * with CaptureSettlementTimeoutError carrying sanitized pending-request
   * metadata. Pending tasks are kept (never discarded); late completions
   * still record and late rejections stay handled and reported in memory.
   */
  settle(options?: { deadlineMs?: number }): Promise<void>
}

/** Default diagnostic settlement deadline (short and configurable). */
export const DEFAULT_SETTLEMENT_DEADLINE_MS = 15_000

/** Sanitized per-capture diagnostic: allowlisted categories/codes only — never raw text, paths, headers, bodies, or secrets. */
export interface SanitizedCaptureDiagnostic {
  readonly id: number
  readonly actionId: string
  readonly pathname: string
  /** Whether this request's action ID belongs to the resolved REQUIRED set. */
  readonly required: boolean
  readonly startedAtMs: number
  readonly settledAtMs: number | null
  readonly status: 'in-flight' | 'completed' | 'header-failed' | 'not-required'
  /** True when the record settled after an observed settlement deadline expiry. */
  readonly late: boolean
  readonly events: readonly string[]
  readonly error: { category: string; code?: string } | null
}

/** Shared bounded projection used by attachments AND failure summaries. */
export interface DiagnosticProjection {
  readonly totals: {
    readonly total: number
    readonly completed: number
    readonly failed: number
    readonly inFlight: number
    readonly late: number
    readonly truncated: number
  }
  readonly records: readonly SanitizedCaptureDiagnostic[]
}

/** Thrown when bounded settlement expires with captures still pending (never success). */
export class CaptureSettlementTimeoutError extends Error {
  constructor(
    readonly deadlineMs: number,
    readonly pendingDiagnostics: readonly SanitizedCaptureDiagnostic[],
    readonly failedCategoryCounts: Readonly<Record<string, number>>,
    readonly pendingTotal = pendingDiagnostics.length,
  ) {
    super(
      `action-wire capture settlement exceeded the ${deadlineMs}ms diagnostic deadline with ${pendingTotal} pending capture(s); ` +
        `pending: ${JSON.stringify(pendingDiagnostics)}` +
        (pendingTotal > pendingDiagnostics.length ? ` (truncated: ${pendingTotal - pendingDiagnostics.length})` : '') +
        (Object.keys(failedCategoryCounts).length > 0 ? `; failed so far: ${JSON.stringify(failedCategoryCounts)}` : ''),
    )
    this.name = 'CaptureSettlementTimeoutError'
  }
}

/** Safe-summary settlement failure: bounded projection, no raw text or paths. */
export class CaptureSettlementError extends Error {
  constructor(
    readonly summary: {
      completed: number
      failed: number
      pending: number
      failedCategoryCounts: Readonly<Record<string, number>>
    },
    readonly projection: DiagnosticProjection,
  ) {
    super(
      `action-wire capture settlement failed: ${summary.failed} capture(s) failed [${JSON.stringify(summary.failedCategoryCounts)}] — ` +
        `sanitized diagnostics: ${JSON.stringify(projection)}`,
    )
    this.name = 'CaptureSettlementError'
  }
}

// ---------------------------------------------------------------------------
// Sanitization: allowlisted categories and a finite network-code allowlist
// ---------------------------------------------------------------------------

const MAX_ACTION_ID_LENGTH = 128
const MAX_PATHNAME_LENGTH = 200
const MAX_EVENTS_PER_RECORD = 32
const MAX_RECORDS_IN_ARTIFACT = 512
const MAX_RECORDS_IN_FAILURE_REPORT = 64

/**
 * Finite, explicit network-code allowlist. Any other `net::ERR_*` token
 * found in an error message is NOT exported — the failure falls back to
 * the `unknown` category (fabricated or secret-bearing codes never leak).
 */
const NET_ERROR_CODE_ALLOWLIST: ReadonlySet<string> = new Set([
  'net::ERR_ABORTED',
  'net::ERR_ADDRESS_UNREACHABLE',
  'net::ERR_CONNECTION_ABORTED',
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_TIMED_OUT',
  'net::ERR_EMPTY_RESPONSE',
  'net::ERR_FAILED',
  'net::ERR_INTERNET_DISCONNECTED',
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_NETWORK_CHANGED',
  'net::ERR_TIMED_OUT',
])

/** Allowlisted failure classification; never exports arbitrary message text, stacks, or paths. */
export interface SanitizedCaptureError {
  category: string
  code?: string
}

export function classifyCaptureError(error: unknown): SanitizedCaptureError {
  const message = error instanceof Error ? error.message : ''
  if (/Target page, context or browser has been closed/i.test(message)) {
    return { category: 'target-closed' }
  }
  if (/Request context destroyed/i.test(message)) {
    return { category: 'request-context-destroyed' }
  }
  const netCode = message.match(/net::(ERR_[A-Z_]+)/)
  if (netCode) {
    const code = `net::${netCode[1]}`
    if (NET_ERROR_CODE_ALLOWLIST.has(code)) return { category: 'net-error', code }
    return { category: 'unknown' }
  }
  if ((error as { name?: string } | null)?.name === 'TimeoutError' || /\btimeout\b/i.test(message)) {
    return { category: 'timeout' }
  }
  return { category: 'unknown' }
}

/** Internal mutable diagnostic record; exposed through the readonly SanitizedCaptureDiagnostic view. */
interface MutableCaptureDiagnostic {
  id: number
  actionId: string
  pathname: string
  required: boolean
  startedAtMs: number
  settledAtMs: number | null
  status: 'in-flight' | 'completed' | 'header-failed' | 'not-required'
  late: boolean
  events: string[]
  error: SanitizedCaptureError | null
}

/** Frozen sanitized copy for error propagation and artifacts. */
function snapshotDiagnostic(diagnostic: MutableCaptureDiagnostic): SanitizedCaptureDiagnostic {
  return {
    ...diagnostic,
    events: [...diagnostic.events],
    error: diagnostic.error ? { ...diagnostic.error } : null,
  }
}

/**
 * Shared bounded projection: caps records, prioritizes failed/pending over
 * completed/in-flight (stable id order within groups), and reports
 * total/truncation counts so full failure accounting survives the cap.
 */
function projectDiagnostics(
  records: readonly MutableCaptureDiagnostic[],
  maxRecords: number,
  prioritize: (record: MutableCaptureDiagnostic) => boolean,
): DiagnosticProjection {
  const prioritized = [...records].sort((a, b) => {
    const pa = prioritize(a) ? 0 : 1
    const pb = prioritize(b) ? 0 : 1
    return pa !== pb ? pa - pb : a.id - b.id
  })
  const kept = prioritized.slice(0, maxRecords).map(snapshotDiagnostic)
  const count = (predicate: (record: SanitizedCaptureDiagnostic) => boolean): number =>
    records.filter((record) => predicate(record as SanitizedCaptureDiagnostic)).length
  return {
    totals: {
      total: records.length,
      completed: count((record) => record.status === 'completed'),
      failed: count((record) => record.status === 'header-failed'),
      inFlight: count((record) => record.status === 'in-flight'),
      late: count((record) => record.late),
      truncated: Math.max(0, records.length - kept.length),
    },
    records: kept,
  }
}

// ---------------------------------------------------------------------------
// Capture hook
// ---------------------------------------------------------------------------

export interface ActionWireCaptureOptions {
  /**
   * The resolved REQUIRED action IDs (same run's manifest, complete and
   * unique — validated fail-closed). Asynchronous allHeaders() work is
   * restricted to this explicit set, selected by the request's existing
   * next-action header; unrelated actions are evidenced as not-required
   * but never trigger header capture.
   */
  requiredActionIds: readonly string[]
}

export function captureActionWires(
  page: ActionWirePageSource,
  options: ActionWireCaptureOptions,
): ActionWireCapture {
  if (options.requiredActionIds.length === 0) {
    throw new Error('admin-action-wire-capture: required action ids must be non-empty — refusing an unrestricted capture')
  }
  const requiredActionIdSet = new Set(options.requiredActionIds)
  if (requiredActionIdSet.size !== options.requiredActionIds.length) {
    throw new Error('admin-action-wire-capture: required action ids must be unique — refusing an ambiguous capture allowlist')
  }
  const captured: CapturedWire[] = []
  const diagnosticRecords: MutableCaptureDiagnostic[] = []
  const pending = new Set<Promise<unknown>>()
  const diagnosticsByTask = new Map<Promise<unknown>, MutableCaptureDiagnostic>()
  const diagnosticsByRequest = new Map<ActionWireRequestSource, MutableCaptureDiagnostic>()
  const errors: unknown[] = []
  let detached = false
  let disposed = false
  let nextCaptureId = 1
  let timedOutAtMs: number | null = null

  const markEvent = (diagnostic: MutableCaptureDiagnostic, name: string, suffix = ''): void => {
    if (diagnostic.events.length >= MAX_EVENTS_PER_RECORD) {
      if (diagnostic.events[diagnostic.events.length - 1] !== 'events-truncated') {
        diagnostic.events.push('events-truncated')
      }
      return
    }
    diagnostic.events.push(`${name}@${Math.round(performance.now() - diagnostic.startedAtMs)}ms${suffix}`)
  }
  const markLateIfAfterDeadline = (diagnostic: MutableCaptureDiagnostic): void => {
    if (timedOutAtMs !== null) diagnostic.late = true
  }

  // REAL Playwright page lifecycle events, correlated by request identity.
  const onPageResponse = (response: ActionWireResponseSource): void => {
    const diagnostic = diagnosticsByRequest.get(response.request())
    if (diagnostic) markEvent(diagnostic, 'response')
  }
  const onPageRequestFinished = (request: ActionWireRequestSource): void => {
    const diagnostic = diagnosticsByRequest.get(request)
    if (diagnostic) markEvent(diagnostic, 'requestfinished')
  }
  const onPageRequestFailed = (request: ActionWireRequestSource): void => {
    const diagnostic = diagnosticsByRequest.get(request)
    if (diagnostic) markEvent(diagnostic, 'requestfailed')
  }
  page.on('response', onPageResponse)
  page.on('requestfinished', onPageRequestFinished)
  page.on('requestfailed', onPageRequestFailed)

  const onRequest = (request: ActionWireRequestSource): void => {
    if (detached) return
    if (request.method() !== 'POST') return
    const actionId = request.headers()['next-action']
    if (!actionId) return
    const pathname = new URL(request.url()).pathname
    const required = requiredActionIdSet.has(actionId)
    const diagnostic: MutableCaptureDiagnostic = {
      id: nextCaptureId++,
      actionId: actionId.slice(0, MAX_ACTION_ID_LENGTH),
      pathname: pathname.slice(0, MAX_PATHNAME_LENGTH),
      required,
      startedAtMs: performance.now(),
      settledAtMs: null,
      status: 'in-flight',
      late: false,
      events: [],
      error: null,
    }
    diagnosticRecords.push(diagnostic)
    diagnosticsByRequest.set(request, diagnostic)
    markEvent(diagnostic, 'started')
    if (!required) {
      // Conditional capture (Astra run-6 review): unrelated actions are
      // evidenced (membership attribution) but never invoke allHeaders().
      diagnostic.status = 'not-required'
      markEvent(diagnostic, 'not-required')
      diagnosticsByRequest.delete(request)
      return
    }

    const task = (async () => {
      const headers = await request.allHeaders()
      captured.push({
        actionId,
        path: pathname,
        postData: request.postData(),
        stateTree: headers['next-router-state-tree'] ?? null,
        nextUrl: headers['next-url'] ?? null,
      })
    })()
    pending.add(task)
    diagnosticsByTask.set(task, diagnostic)
    // Route rejections into `errors` (surfaced by settle()) so a pending
    // capture can never become an unhandled promise rejection, while real
    // capture errors still propagate as SAFE summary failures.
    void task
      .catch((error: unknown) => {
        errors.push(error)
        diagnostic.settledAtMs = performance.now()
        diagnostic.status = 'header-failed'
        diagnostic.error = { ...classifyCaptureError(error) }
        markLateIfAfterDeadline(diagnostic)
        markEvent(diagnostic, 'header-failed', `(${diagnostic.error.category})`)
        diagnosticsByRequest.delete(request)
      })
      .finally(() => {
        if (diagnostic.status === 'in-flight') {
          diagnostic.settledAtMs = performance.now()
          diagnostic.status = 'completed'
          markLateIfAfterDeadline(diagnostic)
          markEvent(diagnostic, 'settled')
        }
        pending.delete(task)
        diagnosticsByTask.delete(task)
      })
  }

  page.on('request', onRequest)

  return {
    captured,
    diagnostics: diagnosticRecords,
    detach(): void {
      if (detached) return
      detached = true
      page.off('request', onRequest)
      // Lifecycle listeners stay attached so pending captures keep
      // correlating network events until final disposal.
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      detached = true
      page.off('request', onRequest)
      page.off('response', onPageResponse)
      page.off('requestfinished', onPageRequestFinished)
      page.off('requestfailed', onPageRequestFailed)
      diagnosticsByRequest.clear()
      // Rejection handlers on unresolved tasks REMAIN attached: late
      // failures stay handled and accounted (see serializeDiagnostics),
      // though they are not streamed into already-taken snapshots.
    },
    serializeDiagnostics(): string {
      const projection = projectDiagnostics(
        diagnosticRecords,
        MAX_RECORDS_IN_ARTIFACT,
        // Round 7 P2: the attachment uses the SAME failed/in-flight
        // priority as failure reports — a late failure after 512 completed
        // captures must never be truncated out of the evidence.
        (record) => record.status === 'header-failed' || record.status === 'in-flight',
      )
      return JSON.stringify({ version: 5, capturedCount: captured.length, ...projection })
    },
    async settle(options?: { deadlineMs?: number }): Promise<void> {
      const deadlineMs = options?.deadlineMs ?? DEFAULT_SETTLEMENT_DEADLINE_MS
      const deadlineAt = performance.now() + deadlineMs
      while (pending.size > 0) {
        const remainingMs = deadlineAt - performance.now()
        if (remainingMs <= 0) break
        await new Promise<void>((resolveRace) => {
          // The timer always fires or is cleared within the deadline; it
          // must NOT be unref'd (an unref'd deadline drains the event loop
          // under awaiting tests, which node:test fatals on).
          const timer = setTimeout(resolveRace, remainingMs)
          void Promise.allSettled([...pending]).then(() => {
            clearTimeout(timer)
            resolveRace()
          })
        })
      }
      if (pending.size > 0) {
        // Deadline expired: FAIL with sanitized pending-request metadata.
        // Tasks are NOT discarded: accounting and handlers stay attached.
        timedOutAtMs ??= performance.now()
        const pendingRecords = [...pending]
          .map((task) => diagnosticsByTask.get(task))
          .filter((diagnostic): diagnostic is MutableCaptureDiagnostic => diagnostic !== undefined)
        const projection = projectDiagnostics(pendingRecords, MAX_RECORDS_IN_FAILURE_REPORT, () => true)
        const failedCategoryCounts: Record<string, number> = {}
        for (const error of errors) {
          const { category } = classifyCaptureError(error)
          failedCategoryCounts[category] = (failedCategoryCounts[category] ?? 0) + 1
        }
        errors.length = 0
        throw new CaptureSettlementTimeoutError(
          deadlineMs,
          projection.records,
          failedCategoryCounts,
          projection.totals.total,
        )
      }
      if (errors.length === 0) return
      const failedCategoryCounts: Record<string, number> = {}
      for (const error of errors) {
        const { category } = classifyCaptureError(error)
        failedCategoryCounts[category] = (failedCategoryCounts[category] ?? 0) + 1
      }
      errors.length = 0
      const projection = projectDiagnostics(
        diagnosticRecords,
        MAX_RECORDS_IN_FAILURE_REPORT,
        (record) => record.status === 'header-failed' || record.status === 'in-flight',
      )
      throw new CaptureSettlementError(
        {
          completed: projection.totals.completed,
          failed: Object.values(failedCategoryCounts).reduce((sum, count) => sum + count, 0),
          pending: projection.totals.inFlight,
          failedCategoryCounts,
        },
        projection,
      )
    },
  }
}

/** Minimal context surface the teardown closes (a Playwright BrowserContext satisfies this). */
export interface TeardownContext {
  close(): Promise<void>
}

/**
 * Settlement + evidence persistence + disposal for the admin spec's
 * afterAll (Astra round-6 P1): settle (bounded) → close every context →
 * serialize + attach the sanitized artifact AFTER cleanup → dispose EVERY
 * page listener.
 *
 * Ordering guarantees:
 *  - dispose() runs UNCONDITIONALLY (nested finally around serialization
 *    and attachment) — an attachment or serialization failure can never
 *    skip listener removal;
 *  - a settlement failure is the PRIMARY error and wins; with no primary,
 *    the attachment/serialization failure itself propagates (fail loudly,
 *    never swallow);
 *  - context.close() awaits remain unbounded (pre-existing); only
 *    settlement is deadline-bounded.
 *
 * Locked by tests/regression/admin-action-wire-capture.test.ts.
 */
export async function teardownActionWireCapture(
  capture: ActionWireCapture | undefined,
  contexts: ReadonlyArray<TeardownContext | undefined>,
  options?: { settleDeadlineMs?: number },
): Promise<void> {
  try {
    if (capture) {
      capture.detach()
      await capture.settle({ deadlineMs: options?.settleDeadlineMs })
    }
  } finally {
    for (const context of contexts) {
      if (context) await context.close().catch(() => undefined)
    }
  }
}

/** Evidence sink for the afterAll seam (the spec wraps testInfo.attach). */
export interface DiagnosticEvidenceSink {
  attachDiagnostics(serialized: string): Promise<void>
}

/** The actual afterAll integration seam: settle/close → attach (after cleanup) → unconditional dispose. */
export async function settleThenPersistAndDispose(
  capture: ActionWireCapture | undefined,
  contexts: ReadonlyArray<TeardownContext | undefined>,
  sink: DiagnosticEvidenceSink,
  options?: { settleDeadlineMs?: number },
): Promise<void> {
  let primary: unknown
  let hasPrimary = false
  try {
    await teardownActionWireCapture(capture, contexts, options)
  } catch (error) {
    hasPrimary = true
    primary = error
  }
  let evidenceFailure: unknown
  let hasEvidenceFailure = false
  try {
    try {
      if (capture) await sink.attachDiagnostics(capture.serializeDiagnostics())
    } finally {
      // UNCONDITIONAL disposal: never skipped by attachment/serialization
      // failure. Rejection handlers on unresolved tasks stay attached.
      capture?.dispose()
    }
  } catch (error) {
    hasEvidenceFailure = true
    evidenceFailure = error
  }
  if (hasPrimary) throw primary
  if (hasEvidenceFailure) throw evidenceFailure
}
