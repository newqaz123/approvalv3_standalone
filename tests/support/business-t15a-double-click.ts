/**
 * T15A rapid double-click MEASUREMENT slice with bounded EXPLICIT settlement
 * (test-only; Task52 measurement + Task53 Astra-P1 fix).
 *
 * Scope (UI click measurement ONLY): the T15A browser spec resolves the
 * Start Final Approval button ONCE, issues two NATIVE el.click() attempts in
 * a SINGLE page.evaluate round-trip (no awaits between them — native clicks
 * honor a committed `disabled` button), and MEASURES how many actual
 * `initiateFinalApproval` server-action POSTs left the page for THIS run.
 *
 * SETTLEMENT CONTRACT (Task53, pinned Astra P1): a first-success snapshot is
 * NOT a settled outcome — installed Next QUEUES server actions and starts the
 * second only after the first finishes (next/dist/client/components/
 * app-router-instance.js runRemainingActions), so a second POST can arrive
 * well after the first success toast. The measurement therefore keeps
 * observing through an explicit bounded window:
 *   - MATCHING-REQUEST COMPLETION: every matching POST is tracked from
 *     `request` until its `requestfinished`/`requestfailed` (pending blocks
 *     settlement);
 *   - QUIET PERIOD (default 1000ms) after the LATEST activity — matching
 *     requests issued/finished/failed AND fixed-message toast observations;
 *   - MINIMUM OBSERVATION (default 3000ms) from the clicks;
 *   - HARD DEADLINE (default 15000ms) from measurement START (before the
 *     instrumentation install): it bounds EVERY awaited operation — install,
 *     the clicks run, and each toast read race against the REMAINING budget,
 *     and deadline expiry is checked BEFORE a settled return is accepted, so
 *     a read resolving late can never turn the deadline into success
 *     (Task54, pinned Astra round-2 P1). Fixed timeout categories fail
 *     closed; the cleanup (listener removal + observer uninstall) runs on its
 *     OWN bounded budget (default 2000ms) and always executes — even when the
 *     install never resolved.
 *   - UNCANCELABLE OPERATIONS ARE NEVER CLAIMED CANCELLED: Promise.race does
 *     not cancel a page.evaluate. The page-side uninstall arms a DISPOSAL
 *     TOKEN first, so a LATE install observing it aborts page-side instead of
 *     leaking an active MutationObserver after cleanup; a late clicks result
 *     or late read is surfaced by its timeout category (the clicks evaluate
 *     may genuinely still fire later — its error says so). Losing operations
 *     keep rejection handlers attached (no unhandled rejections).
 * Budgets are pragmatic, documented choices (not proofs): a bounded window
 * CANNOT prove no arbitrarily late event exists; it bounds when the
 * measurement stops believing more will arrive. Polling steps are small
 * (default 100ms) and every sleep is bounded — no arbitrary long sleeps.
 * Disposal ALWAYS disarms the three page listeners and uninstalls the toast
 * instrumentation (primary error first; a cleanup-only failure fails closed
 * on its own).
 *
 * What this module deliberately does NOT claim:
 *  - a POST count is NOT proof of simultaneous server execution (two requests
 *    can be serialized server-side; one request can even mean the second
 *    click was suppressed before the wire);
 *  - observedCalls === 1 is never a server-dedupe or concurrency-tested
 *    claim — the client latch legitimately winning is a pass for the UI
 *    slice;
 *  - a generic initiation-error toast is NOT by itself a classified server
 *    conflict (that classification is the separate pending layer);
 *  - no persisted DB/server-race proof lives here (a later task gates the
 *    persisted single-transition state; the bounded identity written here is
 *    the correlation input for that gate).
 *
 * Privacy: the observer reads ONLY the request method and the `next-action`
 * header through Playwright's SYNCHRONOUS `Request#headers()` (verified
 * against playwright-core 1.58.2 types — no async allHeaders() work, no
 * unhandled-rejection surface). The Sonner instrumentation counts UNIQUE
 * toast DOM nodes matching the three FIXED source messages and returns ONLY
 * integer totals — no arbitrary text, bodies, header maps, URLs, or the
 * action id ever leave the page or get persisted. Every serialized page
 * callback carries its ENTIRE argument payload (instrument key, disposal
 * token, fixed messages) explicitly — serialized functions have NO closure,
 * so referencing a module constant would be a guaranteed browser ReferenceError
 * (Task54 round-2 P1; locked by the clean-vm serialization-isolation regression).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Correlation file the spec writes into the runner evidence directory. */
export const T15A_BROWSER_CORRELATION_FILE = 't15a-browser-correlation.json'

/** The spec's single-evaluate double click always ATTEMPTS exactly 2 native clicks. */
export const T15A_ATTEMPTED_CLICKS = 2

/**
 * EXACT toast strings pinned against
 * src/components/requests/request-modal-router.tsx (success :622, result-error
 * :626, catch :630 — verified against source in Task52; the success text ends
 * with "successfully", unlike the trace-snapshot abbreviation). Shared here so
 * the spec and the regression pin can never drift apart.
 */
export const FINAL_TRIGGER_SUCCESS_TOAST = 'Final approval initiated successfully'
export const FINAL_TRIGGER_RESULT_ERROR_TOAST = 'Failed to initiate final approval'
export const FINAL_TRIGGER_CATCH_ERROR_TOAST = 'An error occurred while initiating final approval'

// ---------------------------------------------------------------------------
// Same-run server-reference manifest resolver (fail-closed)
// ---------------------------------------------------------------------------

const FINAL_TRIGGER_ACTION_FILE = 'server-actions/solutions.ts'
const FINAL_TRIGGER_ACTION_EXPORT = 'initiateFinalApproval'
const ACTION_ENTRY_LOADER_MARKER = 'next-flight-action-entry-loader.js?actions='

/**
 * Resolve `initiateFinalApproval`'s action id from THIS run's
 * `.next/server/server-reference-manifest.json` (next dev writes it as routes
 * compile). Fails CLOSED — invalid JSON, a missing node object, zero
 * registrations, or an AMBIGUOUS registration (two distinct ids for the same
 * export) throws instead of guessing: a wrong id would silently count zero
 * POSTs and pass the test vacuously. The single fixed message never leaks
 * manifest content.
 */
export function readInitiateFinalApprovalActionId(manifestText: string): string {
  const UNAVAILABLE = 'initiateFinalApproval action id is not available'
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestText)
  } catch {
    throw new Error(UNAVAILABLE)
  }
  const node = (parsed as { node?: unknown } | null)?.node
  if (!node || typeof node !== 'object') throw new Error(UNAVAILABLE)
  const ids = new Set<string>()
  for (const entry of Object.values(node as Record<string, { workers?: unknown }>)) {
    const workers = entry?.workers
    if (!workers || typeof workers !== 'object') continue
    for (const worker of Object.values(workers as Record<string, { moduleId?: unknown }>)) {
      if (typeof worker?.moduleId !== 'string') continue
      for (const registered of decodeActionExports(worker.moduleId)) {
        if (registered.filename === FINAL_TRIGGER_ACTION_FILE && registered.exportName === FINAL_TRIGGER_ACTION_EXPORT) {
          ids.add(registered.id)
        }
      }
    }
  }
  // Exactly one distinct id may back the export; duplicates of the SAME id
  // (the manifest repeats one module's loader across node entries) are fine.
  if (ids.size !== 1) throw new Error(UNAVAILABLE)
  return [...ids][0]
}

function decodeActionExports(moduleId: string): Array<{ id: string; filename: string; exportName: string }> {
  let decoded: string
  try {
    decoded = decodeURIComponent(moduleId)
  } catch {
    return []
  }
  const marker = decoded.indexOf(ACTION_ENTRY_LOADER_MARKER)
  if (marker === -1) return []
  const query = decoded.slice(marker + ACTION_ENTRY_LOADER_MARKER.length).split('&')[0]
  let actions: unknown
  try {
    actions = JSON.parse(query)
  } catch {
    return []
  }
  if (!Array.isArray(actions)) return []
  const out: Array<{ id: string; filename: string; exportName: string }> = []
  for (const group of actions) {
    if (!Array.isArray(group) || group.length < 2 || !Array.isArray(group[1])) continue
    for (const entry of group[1] as Array<{ id?: unknown; filename?: unknown; exportedName?: unknown }>) {
      if (typeof entry?.id !== 'string' || typeof entry.filename !== 'string' || typeof entry.exportedName !== 'string') continue
      out.push({ id: entry.id, filename: entry.filename, exportName: entry.exportedName })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Settlement-based count-only measurement (Task53: bounded EXPLICIT window)
// ---------------------------------------------------------------------------

/** Minimal sync request surface (a Playwright Request satisfies this). */
export interface CountedRequestSource {
  method(): string
  headers(): Record<string, string>
}

/** Injectable clock so regressions drive the window deterministically (no real sleeps). */
export interface CancellableSleep {
  /** Settles (void) when the timer fires. */
  readonly promise: Promise<void>
  /** Removes the timer without settling the promise (real clock: clearTimeout). */
  cancel(): void
}

export interface SettlementClock {
  now(): number
  /** Ordinary bounded poll sleep — unchanged semantics (absolute deadlines, expiry order). */
  sleep(ms: number): Promise<void>
  /**
   * Cancellable timeout timer used ONLY by operation races (Task55 P2: the
   * losing race timer is cancelled when the operation wins/throws, so a
   * successful read no longer leaves a referenced timeout pending until the
   * hard deadline). Deliberately a SEPARATE seam — never reuse `sleep` here.
   */
  sleepCancellable(ms: number): CancellableSleep
}

export const realSettlementClock: SettlementClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  sleepCancellable: (ms: number): CancellableSleep => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const promise = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms)
    })
    return {
      promise,
      cancel: (): void => {
        if (timer !== undefined) clearTimeout(timer)
      },
    }
  },
}

/**
 * Pragmatic, documented budgets (NOT proofs — see the settlement contract in
 * the module header): quiet 1000ms covers post-completion render delay for
 * the fixed toasts; min 3000ms is a conservative floor for the installed
 * Next action queue to start a queued second POST after the first completes;
 * hard 15000ms (from measurement START) bounds every awaited operation and
 * fails closed well inside the 600s T15A budget and Playwright's defaults;
 * pollStep 100ms keeps real-clock polling cheap and bounded; cleanupTimeoutMs
 * 2000ms bounds listener/observer disposal on its own budget.
 */
export interface InitiateFinalApprovalSettlementBudget {
  readonly quietMs: number
  readonly minObservationMs: number
  readonly hardDeadlineMs: number
  readonly pollStepMs: number
  readonly cleanupTimeoutMs: number
}

export const DEFAULT_INITIATE_FINAL_APPROVAL_SETTLEMENT: InitiateFinalApprovalSettlementBudget = {
  quietMs: 1_000,
  minObservationMs: 3_000,
  hardDeadlineMs: 15_000,
  pollStepMs: 100,
  cleanupTimeoutMs: 2_000,
}

/** Page seam: Playwright's page (or a fake) for the three request lifecycle events. */
export interface InitiateFinalApprovalPageSource {
  on(event: 'request' | 'requestfinished' | 'requestfailed', listener: (request: CountedRequestSource) => void): unknown
  off(event: 'request' | 'requestfinished' | 'requestfailed', listener: (request: CountedRequestSource) => void): unknown
}

/** Final totals of UNIQUE toast nodes per FIXED source message (no text persists). */
export interface FixedToastTotals {
  readonly success: number
  readonly resultError: number
  readonly catchError: number
}

export interface FixedToastTotalsSource {
  install(): Promise<void>
  read(): Promise<FixedToastTotals | null>
  uninstall(): Promise<void>
}

const TOAST_INSTRUMENT_KEY = '__t15aFixedToastTotals'

/** Minimal page surface for the injected observer (a Playwright Page satisfies this). */
export interface SonnerToastTotalsPageSource {
  evaluate<Arg, R>(pageFunction: (arg: Arg) => R, arg: Arg): Promise<R>
}

/**
 * Serialized into the page: bounded unique-node counting of the FIXED
 * messages only. Carries its ENTIRE payload (instrument key, disposal token,
 * messages) as arguments — serialized functions have no closure, so NO
 * module constant may be referenced here (Task54 round-2 P1). Returns
 * 'aborted' when the disposal token is already armed (a late install after
 * cleanup must not leak an active MutationObserver).
 */
function installFixedToastObserver(arg: { key: string; disposedKey: string; messages: string[] }): boolean | 'aborted' {
  const w = window as unknown as Record<string, unknown>
  if (w[arg.disposedKey] === true) return 'aborted'
  if (w[arg.key] !== undefined) throw new Error('initiateFinalApproval toast totals instrumentation already installed')
  const seen = new Set<Element>()
  const totals = { success: 0, resultError: 0, catchError: 0 }
  let capped = false
  // SERIALIZATION CONSTRAINT (locked by the clean-vm regression): Playwright
  // sends String(fn) to the page, and tsx/esbuild keepNames injects a
  // __name() helper call for every NAME-INFERRED inner function (const arrow
  // assignments AND function declarations) — which would be a ReferenceError
  // in the real browser. Inner helpers therefore use METHOD SHORTHAND and
  // argument-position arrows ONLY (the two constructs keepNames leaves
  // untouched); do not convert them back.
  const helpers = {
    count(el: Element): void {
      // Bounded memory: stop retaining detached nodes past the cap.
      if (capped || seen.has(el)) return
      seen.add(el)
      if (seen.size > 64) {
        capped = true
        return
      }
      const text = el.textContent ?? ''
      if (text.includes(arg.messages[0])) totals.success += 1
      else if (text.includes(arg.messages[1])) totals.resultError += 1
      else if (text.includes(arg.messages[2])) totals.catchError += 1
    },
    scan(root: Node): void {
      if (!(root instanceof HTMLElement)) return
      if (root.matches('li[data-sonner-toast]')) helpers.count(root)
      root.querySelectorAll('li[data-sonner-toast]').forEach(helpers.count)
    },
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) helpers.scan(node)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  helpers.scan(document.body)
  w[arg.key] = {
    totals,
    uninstall(): void {
      observer.disconnect()
      delete w[arg.key]
    },
  }
  return true
}

/** Serialized into the page: returns the integer totals only (never text). Key passed as the ONLY argument. */
function readFixedToastTotals(key: string): FixedToastTotals | null {
  const w = window as unknown as Record<string, { totals: FixedToastTotals } | undefined>
  const holder = w[key]
  return holder ? { ...holder.totals } : null
}

/**
 * Serialized into the page: arms the disposal token FIRST (so a racing/late
 * install aborts instead of leaking an active observer), then disconnects the
 * observer and removes the holder. Entire payload passed as arguments.
 */
function uninstallFixedToastObserver(arg: { key: string; disposedKey: string }): boolean {
  const w = window as unknown as Record<string, unknown>
  w[arg.disposedKey] = true
  ;(w[arg.key] as { uninstall: () => void } | undefined)?.uninstall()
  return true
}

/** Test-only export: the ACTUAL serialized callbacks, for the clean-vm serialization-isolation regression. */
export const SERIALIZED_TOAST_CALLBACKS = {
  install: installFixedToastObserver,
  read: readFixedToastTotals,
  uninstall: uninstallFixedToastObserver,
} as const

/**
 * Sonner (2.0.7) auto-dismisses toasts (~4s default), so a DOM snapshot at
 * one instant is NOT a total. This instrument installs a MutationObserver
 * counting UNIQUE `li[data-sonner-toast]` nodes ever ADDED during the window
 * (deduped by node identity), matching ONLY the three FIXED source messages;
 * read() returns the integer totals; uninstall() arms the disposal token,
 * disconnects the observer and deletes the page-held state — and always
 * page-evaluates, even when install() never resolved (a late install must be
 * aborted page-side). No arbitrary text is captured or persisted.
 */
export function createSonnerFixedToastTotals(page: SonnerToastTotalsPageSource): FixedToastTotalsSource {
  const args = {
    key: TOAST_INSTRUMENT_KEY,
    disposedKey: `__t15aToastDisposed_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    messages: [
      FINAL_TRIGGER_SUCCESS_TOAST,
      FINAL_TRIGGER_RESULT_ERROR_TOAST,
      FINAL_TRIGGER_CATCH_ERROR_TOAST,
    ],
  }
  let installed = false
  let uninstalled = false
  return {
    async install(): Promise<void> {
      if (installed) throw new Error('initiateFinalApproval toast totals instrumentation already installed')
      const result = await page.evaluate<typeof args, boolean | 'aborted'>(installFixedToastObserver, {
        key: args.key,
        disposedKey: args.disposedKey,
        messages: [...args.messages],
      })
      if (result === 'aborted') throw new Error('initiateFinalApproval toast instrumentation was disposed before it installed')
      installed = true
    },
    async read(): Promise<FixedToastTotals | null> {
      if (!installed) throw new Error('initiateFinalApproval toast totals instrumentation is not installed')
      return page.evaluate<string, FixedToastTotals | null>(readFixedToastTotals, args.key)
    },
    async uninstall(): Promise<void> {
      if (uninstalled) return
      // ALWAYS page-evaluates (even when install never resolved): the
      // page-side callback arms the disposal token first, so a LATE install
      // aborts instead of leaking an active MutationObserver after cleanup.
      await page.evaluate<{ key: string; disposedKey: string }, boolean>(uninstallFixedToastObserver, {
        key: args.key,
        disposedKey: args.disposedKey,
      })
      uninstalled = true
    },
  }
}

export interface InitiateFinalApprovalMeasurement {
  /** Matching POSTs ISSUED during the window (final, after settlement). */
  readonly observedCalls: number
  /** Settlement time measured from the clicks (bounded window length). */
  readonly settledAfterMs: number
  /** Final unique-toast-node totals for the three FIXED messages (null when no source given). */
  readonly toastTotals: FixedToastTotals | null
}

/**
 * Measure the actual `initiateFinalApproval` POSTs (method POST + synchronous
 * `next-action` header equal to `expectedActionId`) for the rapid clicks run
 * inside `run`, through a bounded EXPLICIT settlement window:
 *
 *   settled ⟺ elapsed ≥ minObservationMs since the clicks
 *             AND no matching request is still pending (requestfinished/
 *                 requestfailed seen)
 *             AND ≥ quietMs since the LATEST matching-request or fixed-toast
 *                 activity
 *             AND the hard deadline has NOT expired (checked BEFORE a settled
 *                 return is accepted)
 *   otherwise FAIL CLOSED (fixed message, counts only).
 *
 * Deadline bounding (Task54, pinned Astra round-2 P1): the hard deadline is
 * anchored at measurement START and bounds EVERY awaited operation — the
 * instrumentation install, the clicks run, and each toast read race against
 * the REMAINING budget (clock.sleep-based timers, so injected fake clocks
 * stay coherent). Losing operations are never claimed cancelled (Promise.race
 * cannot cancel a page.evaluate): the page-side uninstall arms a disposal
 * token first so a LATE install aborts page-side; late clicks/read results
 * surface through their fixed timeout categories and can never turn a
 * timeout into success; late rejections keep handlers attached (no unhandled
 * rejections). Cleanup (listener removal + uninstall) always runs on its OWN
 * bounded budget — even when install never resolved — and a cleanup-only
 * failure fails closed on its own while a PRIMARY error still takes
 * precedence. Counts are validated to be exactly 1 or 2 (bounded, honest
 * categories — 0 means the observer missed the wire or the id is stale; more
 * than 2 exceeds this slice's meaning).
 */
const INSTALL_TIMEOUT_MESSAGE =
  'initiateFinalApproval toast instrumentation install timed out (the page evaluate may still complete later; the disposal token aborts a late install page-side)'
const CLICKS_TIMEOUT_MESSAGE =
  'initiateFinalApproval clicks operation timed out (the clicks evaluate cannot be cancelled and may still fire later — treat the workflow state as unknown)'
const READ_TIMEOUT_MESSAGE = 'initiateFinalApproval toast totals read timed out'
const CLEANUP_TIMEOUT_MESSAGE =
  'initiateFinalApproval cleanup timed out (the page-side toast observer may remain active — close the owned page context)'

type BoundedOutcome<T> =
  | { status: 'value'; value: T }
  | { status: 'error'; error: unknown }
  | { status: 'timeout' }

/**
 * Race an operation against a clock-based timeout. The operation is NOT
 * cancelled on timeout (its side effects may still land later); both of its
 * settlements are handled here, so a late rejection can never become an
 * unhandled rejection. The LOSING race timer is CANCELLED in a finally
 * (operation win / throw / timeout) — Task55 P2: no timer stays referenced
 * until the hard deadline after a successful read.
 */
async function raceWithBudget<T>(clock: SettlementClock, operation: Promise<T>, timeoutMs: number): Promise<BoundedOutcome<T>> {
  if (timeoutMs <= 0) {
    void operation.then(
      () => undefined,
      () => undefined,
    )
    return { status: 'timeout' }
  }
  const timer = clock.sleepCancellable(timeoutMs)
  try {
    return await Promise.race([
      operation.then(
        (value): BoundedOutcome<T> => ({ status: 'value', value }),
        (error): BoundedOutcome<T> => ({ status: 'error', error }),
      ),
      timer.promise.then((): BoundedOutcome<T> => ({ status: 'timeout' })),
    ])
  } finally {
    timer.cancel()
  }
}

export async function measureInitiateFinalApprovalRequests(input: {
  expectedActionId: string
  page: InitiateFinalApprovalPageSource
  toastTotals?: FixedToastTotalsSource
  clock?: SettlementClock
  budget?: Partial<InitiateFinalApprovalSettlementBudget>
  run: () => Promise<void>
}): Promise<InitiateFinalApprovalMeasurement> {
  if (input.expectedActionId.trim() === '') {
    throw new Error('initiateFinalApproval expected action id is required')
  }
  const clock = input.clock ?? realSettlementClock
  const budget = { ...DEFAULT_INITIATE_FINAL_APPROVAL_SETTLEMENT, ...input.budget }
  const zeroTotals: FixedToastTotals = { success: 0, resultError: 0, catchError: 0 }
  // The hard deadline is anchored at measurement START and bounds EVERY
  // awaited operation (install, clicks, reads) plus settlement acceptance.
  const startAt = clock.now()
  const deadlineAt = startAt + budget.hardDeadlineMs
  const remainingMs = (): number => deadlineAt - clock.now()
  let observed = 0
  let listenerFailed = false
  let toastReadFailed = false
  const pending = new Set<CountedRequestSource>()
  let lastActivityAt = startAt
  const listener = (request: CountedRequestSource): void => {
    try {
      if (request.method() !== 'POST') return
      if (request.headers()['next-action'] !== input.expectedActionId) return
      observed += 1
      pending.add(request)
      lastActivityAt = clock.now()
    } catch {
      // Sync header reads can throw on a destroyed request — fail closed
      // AFTER the window, never silently undercount.
      listenerFailed = true
    }
  }
  const settledListener = (request: CountedRequestSource): void => {
    // Identity-only: a matching issued request reaching requestfinished or
    // requestfailed leaves the pending set; unrelated requests are ignored.
    if (pending.delete(request)) lastActivityAt = clock.now()
  }
  let windowStart: number | null = null
  let lastTotals: FixedToastTotals | null = null
  let primary: unknown
  let hasPrimary = false
  let disposalError: unknown
  let hasDisposalError = false
  const totalsExceeds = (previous: FixedToastTotals, next: FixedToastTotals): boolean =>
    next.success > previous.success || next.resultError > previous.resultError || next.catchError > previous.catchError
  try {
    // 1. Instrumentation install — bounded by the remaining budget; a stall
    //    fails closed BEFORE any listener is armed or click is attempted.
    if (input.toastTotals) {
      const outcome = await raceWithBudget(clock, input.toastTotals.install(), remainingMs())
      if (outcome.status === 'timeout') throw new Error(INSTALL_TIMEOUT_MESSAGE)
      if (outcome.status === 'error') throw outcome.error
    }
    // 2. Arm the three request-lifecycle listeners.
    input.page.on('request', listener)
    input.page.on('requestfinished', settledListener)
    input.page.on('requestfailed', settledListener)
    // 3. The rapid clicks — bounded by the remaining budget.
    try {
      const clicks = await raceWithBudget(clock, input.run(), remainingMs())
      if (clicks.status === 'timeout') throw new Error(CLICKS_TIMEOUT_MESSAGE)
      if (clicks.status === 'error') throw clicks.error
      windowStart = clock.now()
    } catch (error) {
      hasPrimary = true
      primary = error
    }
    if (!hasPrimary && windowStart !== null) {
      lastTotals = input.toastTotals ? zeroTotals : null
      for (;;) {
        // EXPIRY FIRST — before the read is even attempted: an exhausted
        // budget is the SETTLEMENT deadline, never a per-read timeout, and a
        // read that landed at/past the deadline must NEVER be accepted as
        // settlement (checked again after the read below).
        if (clock.now() >= deadlineAt) {
          primary = new Error(
            `initiateFinalApproval settlement deadline exceeded after ${Math.round(clock.now() - startAt)}ms (observed ${observed}, pending ${pending.size})`,
          )
          hasPrimary = true
          break
        }
        if (input.toastTotals) {
          const read = await raceWithBudget(clock, input.toastTotals.read(), remainingMs())
          if (read.status === 'timeout') throw new Error(READ_TIMEOUT_MESSAGE)
          if (read.status === 'error') {
            toastReadFailed = true
            break
          }
          if (read.value === null) {
            toastReadFailed = true
            break
          }
          if (totalsExceeds(lastTotals ?? zeroTotals, read.value)) lastActivityAt = clock.now()
          lastTotals = read.value
        }
        const now = clock.now()
        if (now >= deadlineAt) {
          primary = new Error(
            `initiateFinalApproval settlement deadline exceeded after ${Math.round(now - startAt)}ms (observed ${observed}, pending ${pending.size})`,
          )
          hasPrimary = true
          break
        }
        const elapsed = now - windowStart
        const quietFor = now - lastActivityAt
        if (elapsed >= budget.minObservationMs && pending.size === 0 && quietFor >= budget.quietMs) break
        const untilQuiet = budget.quietMs - quietFor
        const untilMin = budget.minObservationMs - elapsed
        const untilDeadline = deadlineAt - now
        const step = Math.max(1, Math.min(budget.pollStepMs, untilQuiet, untilMin, untilDeadline))
        await clock.sleep(step)
      }
    }
  } catch (error) {
    if (!hasPrimary) {
      hasPrimary = true
      primary = error
    }
  } finally {
    input.page.off('request', listener)
    input.page.off('requestfinished', settledListener)
    input.page.off('requestfailed', settledListener)
    if (input.toastTotals) {
      // Cleanup runs on its OWN bounded budget and ALWAYS page-evaluates —
      // even when the install never resolved — because the page-side
      // uninstall arms the disposal token that aborts a LATE install.
      const cleanup = await raceWithBudget(clock, input.toastTotals.uninstall(), budget.cleanupTimeoutMs)
      if (cleanup.status === 'timeout') {
        hasDisposalError = true
        disposalError = new Error(CLEANUP_TIMEOUT_MESSAGE)
      } else if (cleanup.status === 'error') {
        hasDisposalError = true
        disposalError = cleanup.error
      }
    }
  }
  if (hasPrimary) throw primary
  if (hasDisposalError) throw disposalError
  if (toastReadFailed) throw new Error('initiateFinalApproval toast totals read failed')
  if (listenerFailed) throw new Error('initiateFinalApproval request observer failed')
  if (observed === 0) throw new Error('initiateFinalApproval POST count was 0')
  if (observed > 2) throw new Error(`initiateFinalApproval POST count exceeded 2 (got ${observed})`)
  const settledFrom = windowStart ?? clock.now()
  return { observedCalls: observed, settledAfterMs: Math.round(clock.now() - settledFrom), toastTotals: lastTotals }
}

// ---------------------------------------------------------------------------
// Bounded correlation identity (input for the later persisted-DB gate)
// ---------------------------------------------------------------------------

export interface T15aBrowserCorrelation {
  /** Exact title returned by uniqueBusinessTitle('T15A'), not a prefix. */
  requestTitle: string
  /** Native click attempts issued by the spec's single evaluate (always 2). */
  attemptedClicks: typeof T15A_ATTEMPTED_CLICKS
  /** Actual initiateFinalApproval POSTs observed for THIS title (1 or 2). */
  observedRequestCalls: number
  /** Fixed measurement status token. */
  status: 'measured'
}

export type T15aCorrelationRead =
  | { status: 'present'; correlation: T15aBrowserCorrelation }
  | { status: 'missing' }
  | { status: 'corrupt' }

/**
 * Validate the bounded identity. Corrupt (never guessed) on a wrong title
 * prefix, an attemptedClicks other than 2, an observed count other than 1/2,
 * a wrong status token, or malformed JSON. This record intentionally carries
 * NO action id and NO wire data.
 */
export function parseT15aBrowserCorrelation(raw: string): T15aCorrelationRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { status: 'corrupt' }
  }
  if (parsed === null || typeof parsed !== 'object') return { status: 'corrupt' }
  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (
    keys.length !== 4 ||
    keys.join(',') !== 'attemptedClicks,observedRequestCalls,requestTitle,status'
  ) {
    return { status: 'corrupt' }
  }
  const { requestTitle, attemptedClicks, observedRequestCalls, status } = record as {
    requestTitle?: unknown
    attemptedClicks?: unknown
    observedRequestCalls?: unknown
    status?: unknown
  }
  if (typeof requestTitle !== 'string' || !requestTitle.startsWith('Business T15A ') || requestTitle === 'Business T15A') {
    return { status: 'corrupt' }
  }
  if (attemptedClicks !== T15A_ATTEMPTED_CLICKS || !Number.isInteger(observedRequestCalls)) {
    return { status: 'corrupt' }
  }
  if (observedRequestCalls !== 1 && observedRequestCalls !== 2) {
    return { status: 'corrupt' }
  }
  if (status !== 'measured') return { status: 'corrupt' }
  return {
    status: 'present',
    correlation: {
      requestTitle,
      attemptedClicks: T15A_ATTEMPTED_CLICKS,
      observedRequestCalls,
      status: 'measured',
    },
  }
}

export async function writeT15aBrowserCorrelation(
  evidenceDir: string,
  correlation: T15aBrowserCorrelation,
): Promise<void> {
  const validated = parseT15aBrowserCorrelation(JSON.stringify(correlation))
  if (validated.status !== 'present') {
    throw new Error('T15A browser correlation must be an exact request title, attemptedClicks 2, an observed count of 1 or 2, and the fixed measured status')
  }
  await fs.mkdir(evidenceDir, { recursive: true })
  await fs.writeFile(
    path.join(evidenceDir, T15A_BROWSER_CORRELATION_FILE),
    JSON.stringify(validated.correlation),
    { encoding: 'utf8', mode: 0o600 },
  )
}

export async function readT15aBrowserCorrelation(evidenceDir: string): Promise<T15aCorrelationRead> {
  try {
    const raw = await fs.readFile(path.join(evidenceDir, T15A_BROWSER_CORRELATION_FILE), 'utf8')
    return parseT15aBrowserCorrelation(raw)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT') return { status: 'missing' }
    return { status: 'corrupt' }
  }
}
