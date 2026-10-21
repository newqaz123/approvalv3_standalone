import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import {
  createSonnerFixedToastTotals,
  DEFAULT_INITIATE_FINAL_APPROVAL_SETTLEMENT,
  FINAL_TRIGGER_CATCH_ERROR_TOAST,
  FINAL_TRIGGER_RESULT_ERROR_TOAST,
  FINAL_TRIGGER_SUCCESS_TOAST,
  measureInitiateFinalApprovalRequests,
  parseT15aBrowserCorrelation,
  readInitiateFinalApprovalActionId,
  SERIALIZED_TOAST_CALLBACKS,
  T15A_ATTEMPTED_CLICKS,
  type FixedToastTotals,
  type SettlementClock,
} from '../support/business-t15a-double-click'

/**
 * T15A rapid double-click MEASUREMENT slice (Task52) + bounded EXPLICIT
 * settlement (Task53, pinned Astra P1: a first-success snapshot does not
 * establish a settled count — installed Next QUEUES server actions and starts
 * the second only after the first finishes, so a late second POST was
 * missed/misclassified).
 *
 * Layers, all pure/synthetic (no browser, no server, no HTTP, no DB):
 *  1. the same-run manifest resolver (fail-closed, unchanged from Task52);
 *  2. the settlement-based measurement: observe through matching-request
 *     COMPLETION (requestfinished/requestfailed) + a bounded quiet period
 *     after the LATEST activity (requests AND fixed-message toasts) + a
 *     minimum observation window from the clicks; a hard deadline fails
 *     closed; disposal always disarms listeners/uninstalls instrumentation.
 *     ALL timing is a FAKE CLOCK (no real sleeps) and events are fake —
 *     deterministic regression for the late-2nd, slow-pending, failed,
 *     deadline, disposal, 0 and >2 cases;
 *  3. the Sonner fixed-toast-totals instrumentation LIFECYCLE (install/read/
 *     uninstall through a fake evaluate — the injected DOM observer itself is
 *     source-pinned only; it has no unit-executable DOM here);
 *  4. STATIC SOURCE-CONTRACT PINS ONLY (no browser execution): the shipped
 *     spec keeps the one-evaluate two-native-click pattern, asserts FINAL
 *     totals together AFTER settlement (no mid-window instantaneous DOM toast
 *     counts), and preserves T15B/C/D + the Completed endpoint.
 *
 * Limits stated honestly: a bounded window CANNOT prove no arbitrarily late
 * event — it bounds when the measurement stops believing more will arrive;
 * observedCalls === 1 is never a server-dedupe/concurrency claim; a generic
 * initiation-error toast is NOT a classified server conflict (separate layer).
 */

const ACTION_FILE = 'server-actions/solutions.ts'
const ACTION_EXPORT = 'initiateFinalApproval'
const LOADER_MARKER = 'next-flight-action-entry-loader.js?actions='

/** Synthetic manifest mirroring the real next dev server-reference shape. */
function loaderModuleIdFor(entries: ReadonlyArray<{ file: string; exportName: string; id: string }>): string {
  // Real shape: the loader query carries ONE `actions=` (part of the marker)
  // followed by the percent-encoded actions JSON, then further loader options.
  const actionsJson = JSON.stringify(entries.map((entry) => ['src/app/placeholder', [{ id: entry.id, exportedName: entry.exportName, filename: entry.file }]]))
  return `(rsc)/./node_modules/next/dist/build/webpack/loaders/${LOADER_MARKER}${encodeURIComponent(actionsJson)}&__client_imported__=!`
}

function manifestWith(entries: ReadonlyArray<{ file: string; exportName: string; id: string }>): string {
  const moduleId = loaderModuleIdFor(entries)
  return JSON.stringify({
    node: {
      'placeholder-key': { workers: { 'placeholder-worker': { moduleId } } },
    },
  })
}

function manifestWithTwoWorkers(entriesA: ReadonlyArray<{ file: string; exportName: string; id: string }>, entriesB: ReadonlyArray<{ file: string; exportName: string; id: string }>): string {
  return JSON.stringify({
    node: {
      'key-a': { workers: { 'worker-a': { moduleId: loaderModuleIdFor(entriesA) } } },
      'key-b': { workers: { 'worker-b': { moduleId: loaderModuleIdFor(entriesB) } } },
    },
  })
}

describe('T15A measurement: initiateFinalApproval manifest resolver (fail-closed)', () => {
  it('resolves the single registered id for solutions.ts#initiateFinalApproval', () => {
    const manifest = manifestWith([
      { file: ACTION_FILE, exportName: ACTION_EXPORT, id: 'abc123' },
      { file: 'server-actions/users.ts', exportName: 'getUsers', id: 'other' },
    ])
    assert.equal(readInitiateFinalApprovalActionId(manifest), 'abc123')
  })

  it('rejects identical duplicate registrations of the SAME id (not ambiguous)', () => {
    const manifest = manifestWithTwoWorkers(
      [{ file: ACTION_FILE, exportName: ACTION_EXPORT, id: 'same-id' }],
      [{ file: ACTION_FILE, exportName: ACTION_EXPORT, id: 'same-id' }],
    )
    assert.equal(readInitiateFinalApprovalActionId(manifest), 'same-id')
  })

  it('fails closed on an AMBIGUOUS registration (two distinct ids for the export)', () => {
    const manifest = manifestWithTwoWorkers(
      [{ file: ACTION_FILE, exportName: ACTION_EXPORT, id: 'id-one' }],
      [{ file: ACTION_FILE, exportName: ACTION_EXPORT, id: 'id-two' }],
    )
    assert.throws(() => readInitiateFinalApprovalActionId(manifest), /initiateFinalApproval action id is not available/)
  })

  it('fails closed when the export is missing, the manifest is invalid JSON, or the node object is absent', () => {
    const noExport = manifestWith([{ file: 'server-actions/users.ts', exportName: 'getUsers', id: 'x' }])
    assert.throws(() => readInitiateFinalApprovalActionId(noExport), /initiateFinalApproval action id is not available/)
    assert.throws(() => readInitiateFinalApprovalActionId('not-json'), /initiateFinalApproval action id is not available/)
    assert.throws(() => readInitiateFinalApprovalActionId('{"noNode":1}'), /initiateFinalApproval action id is not available/)
    assert.throws(() => readInitiateFinalApprovalActionId('null'), /initiateFinalApproval action id is not available/)
  })

  it('fails closed on a malformed loader query (never fabricates an id)', () => {
    const broken = JSON.stringify({
      node: { key: { workers: { worker: { moduleId: '(rsc)/./broken?not-the-loader' } } } },
    })
    assert.throws(() => readInitiateFinalApprovalActionId(broken), /initiateFinalApproval action id is not available/)
  })
})

// ---------------------------------------------------------------------------
// Settlement measurement: fake page events + fake clock (deterministic)
// ---------------------------------------------------------------------------

type EventKind = 'request' | 'requestfinished' | 'requestfailed'

interface FakeRequest {
  method(): string
  headers(): Record<string, string>
}

function fakeRequest(method: string, nextAction: string | undefined): FakeRequest {
  const headers: Record<string, string> = {}
  if (nextAction !== undefined) headers['next-action'] = nextAction
  return { method: () => method, headers: () => headers }
}

function fakePage() {
  const listeners = new Map<EventKind, Set<(source: FakeRequest) => void>>([
    ['request', new Set()],
    ['requestfinished', new Set()],
    ['requestfailed', new Set()],
  ])
  return {
    armed: () => [...listeners.values()].some((set) => set.size > 0),
    armedKinds: () => [...listeners.entries()].filter(([, set]) => set.size > 0).map(([kind]) => kind),
    emit: (kind: EventKind, source: FakeRequest) => {
      for (const listener of [...(listeners.get(kind) ?? [])]) listener(source)
    },
    on: (kind: EventKind, listener: (source: FakeRequest) => void) => {
      listeners.get(kind)?.add(listener)
    },
    off: (kind: EventKind, listener: (source: FakeRequest) => void) => {
      listeners.get(kind)?.delete(listener)
    },
  }
}

/**
 * Deterministic virtual clock: advance() resolves due wakes AND catches up
 * wakes pushed while draining. Ordinary poll sleeps (plain `sleep`) and race
 * timers (`sleepCancellable`, whose cancel() removes the wake) share the wake
 * list but stay SEPARATE seams; pendingWakes() exposes the count so the
 * Task55 timer-cleanup regressions can prove losing race timers are cancelled.
 */
function fakeClock(startAt = 0) {
  let now = startAt
  const wakes: Array<{ dueAt: number; resolve: () => void }> = []
  const clock: SettlementClock = {
    now: () => now,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        wakes.push({ dueAt: now + ms, resolve })
      }),
    sleepCancellable: (ms: number) => {
      const wake: { dueAt: number; resolve: () => void } = { dueAt: now + ms, resolve: () => undefined }
      wakes.push(wake)
      const promise = new Promise<void>((resolve) => {
        wake.resolve = resolve
      })
      return {
        promise,
        cancel: (): void => {
          const index = wakes.indexOf(wake)
          if (index >= 0) wakes.splice(index, 1)
        },
      }
    },
  }
  const advance = async (ms: number): Promise<void> => {
    now += ms
    // Catch-up loop: resolve every due wake, let the parked iterations run
    // (they may push new wakes that are also due by `now`), repeat until the
    // loop is genuinely parked in the future.
    for (;;) {
      const due = wakes.filter((wake) => wake.dueAt <= now)
      if (due.length === 0) break
      for (const wake of due) wake.resolve()
      for (const wake of due) {
        const index = wakes.indexOf(wake)
        if (index >= 0) wakes.splice(index, 1)
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
  return { clock, advance, now: () => now, pendingWakes: () => wakes.length }
}

async function drain(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}

/** Toast-totals fake: read() derives from virtual time, so bumps are deterministic. */
function timeAwareToastSource(now: () => number, schedule: ReadonlyArray<{ atMs: number; totals: FixedToastTotals }>) {
  const zeros: FixedToastTotals = { success: 0, resultError: 0, catchError: 0 }
  let installs = 0
  let uninstalls = 0
  const sorted = [...schedule].sort((a, b) => a.atMs - b.atMs)
  return {
    get installs() {
      return installs
    },
    get uninstalls() {
      return uninstalls
    },
    source: {
      install: async () => {
        installs += 1
      },
      read: async (): Promise<FixedToastTotals> => {
        let current = zeros
        for (const entry of sorted) if (now() >= entry.atMs) current = entry.totals
        return { ...current }
      },
      uninstall: async () => {
        uninstalls += 1
      },
    },
  }
}

interface MeasurementOutcome {
  done: boolean
  result?: Awaited<ReturnType<typeof measureInitiateFinalApprovalRequests>>
  error?: { message: string }
}

async function startMeasurement(
  input: Parameters<typeof measureInitiateFinalApprovalRequests>[0],
): Promise<MeasurementOutcome & { settle: () => Promise<void> }> {
  const outcome: MeasurementOutcome = { done: false }
  const measurement = measureInitiateFinalApprovalRequests(input)
  void measurement.then(
    (result) => {
      outcome.done = true
      outcome.result = result
    },
    (error: unknown) => {
      outcome.done = true
      outcome.error = error instanceof Error ? { message: error.message } : { message: String(error) }
    },
  )
  await drain()
  return {
    ...outcome,
    get done() {
      return outcome.done
    },
    get result() {
      return outcome.result
    },
    get error() {
      return outcome.error
    },
    settle: async () => {
      for (let i = 0; i < 24 && !outcome.done; i += 1) {
        await drain()
      }
      if (!outcome.done) throw new Error('measurement did not settle under the fake clock')
    },
  } as MeasurementOutcome & { settle: () => Promise<void> }
}

describe('T15A measurement: bounded EXPLICIT settlement (fake clock, deterministic events)', () => {
  const ID = 'id-under-test'
  const BUDGET = DEFAULT_INITIATE_FINAL_APPROVAL_SETTLEMENT

  it('pins the documented pragmatic budgets (quiet 1s, min 3s, hard 15s, poll step 100ms, cleanup 2s)', () => {
    assert.equal(BUDGET.quietMs, 1_000)
    assert.equal(BUDGET.minObservationMs, 3_000)
    assert.equal(BUDGET.hardDeadlineMs, 15_000)
    assert.equal(BUDGET.pollStepMs, 100)
    assert.equal(BUDGET.cleanupTimeoutMs, 2_000)
  })

  it('Astra P1: a LATE second request (Next queues actions) EXTENDS settlement — no premature one-call classification', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    // Toast totals appear as the actions complete: success at +150ms (first
    // action), the fixed-branch error at +2600ms (queued second action).
    const toasts = timeAwareToastSource(() => clock.now(), [
      { atMs: 150, totals: { success: 1, resultError: 0, catchError: 0 } },
      { atMs: 2_600, totals: { success: 1, resultError: 0, catchError: 1 } },
    ])
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: toasts.source,
      clock,
      run: async () => undefined,
    })
    const first = fakeRequest('POST', ID)
    const second = fakeRequest('POST', ID)
    page.emit('request', first)
    await advance(100)
    await drain()
    page.emit('requestfinished', first)
    await advance(2_400) // t=2500 — WITHOUT the late second request this would settle at t=3000
    page.emit('request', second) // the queued second action only starts after the first finished
    await advance(100)
    await drain()
    page.emit('requestfinished', second) // t=2600; error toast readable at >=2600
    await advance(899) // t=3499: quiet (1000ms) from the latest activity (~2600 read) NOT yet satisfied
    await drain()
    assert.equal(m.done, false, 'must NOT settle while the late second request is still within its quiet window')
    await advance(1_101) // t=4600 ≥ ~2600 + 1000
    await m.settle()
    assert.equal(m.error, undefined, `measurement must succeed, got ${m.error?.message}`)
    assert.equal(m.result?.observedCalls, 2, 'the late second POST is COUNTED, not missed')
    assert.equal(m.result?.toastTotals?.success, 1)
    assert.equal(m.result?.toastTotals?.catchError, 1)
    assert.ok((m.result?.settledAfterMs ?? 0) >= 3_600, `settledAfterMs ${m.result?.settledAfterMs} must extend past the pre-late settlement point (3000)`)
    assert.equal(page.armed(), false)
    assert.equal(toasts.uninstalls, 1)
  })

  it('a slow PENDING first request blocks settlement until it completes (not just min-window)', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const toasts = timeAwareToastSource(() => clock.now(), [
      { atMs: 8_050, totals: { success: 1, resultError: 0, catchError: 0 } },
    ])
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: toasts.source,
      clock,
      run: async () => undefined,
    })
    const first = fakeRequest('POST', ID)
    page.emit('request', first)
    await advance(7_000)
    await drain()
    assert.equal(m.done, false, 'pending (unfinished) matching request must block settlement past min+quiet')
    page.emit('requestfinished', first)
    // Virtual-time note: with a jumped clock the first poll after the
    // scheduled toast time (8050) reads it at t=8999, so the quiet window
    // runs from 8999 → settles at 9999 (real-clock polls land ~100ms apart).
    await advance(1_999) // t=8999 — quiet from the toast read at 8999 not yet 1000ms
    await drain()
    assert.equal(m.done, false)
    await advance(1_001) // t=10000 ≥ 8999 + 1000
    await m.settle()
    assert.equal(m.result?.observedCalls, 1)
    assert.equal(m.result?.toastTotals?.success, 1)
    assert.ok((m.result?.settledAfterMs ?? 0) >= 9_999)
  })

  it('a FAILED matching request (requestfailed) completes the window and is counted without crashing', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: timeAwareToastSource(() => clock.now(), []).source,
      clock,
      run: async () => undefined,
    })
    const failed = fakeRequest('POST', ID)
    page.emit('request', failed)
    await advance(200)
    await drain()
    page.emit('requestfailed', failed)
    await advance(2_800) // t=3000 = max(min 3000, 200+1000)
    await m.settle()
    assert.equal(m.result?.observedCalls, 1)
    assert.equal(page.armed(), false)
  })

  it('the hard deadline FAILS CLOSED when a matching request never completes (counts only, no wire data)', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const toasts = timeAwareToastSource(() => clock.now(), [])
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: toasts.source,
      clock,
      run: async () => undefined,
    })
    page.emit('request', fakeRequest('POST', ID))
    await advance(15_000)
    await m.settle()
    assert.match(m.error?.message ?? '', /initiateFinalApproval settlement deadline exceeded/)
    assert.match(m.error?.message ?? '', /observed 1/)
    assert.match(m.error?.message ?? '', /pending 1/)
    assert.equal(page.armed(), false, 'listeners are removed even on the deadline failure')
    assert.equal(toasts.uninstalls, 1, 'instrumentation is uninstalled even on the deadline failure')
  })

  it('disposal disarms listeners and uninstalls instrumentation when run() itself throws (primary error wins)', async () => {
    const page = fakePage()
    const { clock } = fakeClock()
    const toasts = timeAwareToastSource(() => clock.now(), [])
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: toasts.source,
      clock,
      run: async () => {
        throw new Error('primary click failure')
      },
    })
    await m.settle()
    assert.match(m.error?.message ?? '', /primary click failure/)
    assert.equal(page.armed(), false)
    assert.equal(toasts.uninstalls, 1)
  })

  it('fails closed on ZERO observed calls after the full bounded window (never a silent pass)', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      clock,
      run: async () => undefined,
    })
    await advance(3_000) // max(min 3000, quiet from arm)
    await m.settle()
    assert.match(m.error?.message ?? '', /initiateFinalApproval POST count was 0/)
    assert.equal(page.armed(), false)
  })

  it('fails closed on MORE than 2 observed calls (bounded categories: only 1 or 2 are meaningful)', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      clock,
      run: async () => undefined,
    })
    for (let index = 0; index < 3; index += 1) {
      const request = fakeRequest('POST', ID)
      page.emit('request', request)
      await advance(100)
      page.emit('requestfinished', request)
      await advance(100)
    }
    await advance(2_400) // t=3000 = max(min 3000, 600+1000)
    await m.settle()
    assert.match(m.error?.message ?? '', /initiateFinalApproval POST count exceeded 2 \(got 3\)/)
    assert.equal(page.armed(), false)
  })

  it('counts ONLY matching POSTs (method + sync next-action header) and ignores everything else', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      clock,
      run: async () => undefined,
    })
    page.emit('request', fakeRequest('GET', ID))
    page.emit('request', fakeRequest('POST', 'a-different-action'))
    page.emit('request', fakeRequest('POST', undefined))
    const matching = fakeRequest('POST', ID)
    page.emit('request', matching)
    page.emit('requestfinished', fakeRequest('GET', ID)) // unmatched finish events are ignored by identity
    await advance(100)
    await drain()
    page.emit('requestfinished', matching)
    await advance(2_900) // t=3000
    await m.settle()
    assert.equal(m.result?.observedCalls, 1)
  })

  it('the minimum observation window from the clicks is enforced even when everything completes instantly', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      clock,
      run: async () => undefined,
    })
    const request = fakeRequest('POST', ID)
    page.emit('request', request)
    await advance(1)
    page.emit('requestfinished', request) // completes instantly; only the MIN window keeps observing
    await advance(2_998)
    await drain()
    assert.equal(m.done, false, 'settlement must wait out the minimum observation window (2999ms < 3000ms)')
    await advance(1)
    await m.settle()
    assert.equal(m.result?.observedCalls, 1)
    assert.ok((m.result?.settledAfterMs ?? 0) >= 3_000)
  })

  it('a fixed-message toast appearing LATE inside the window extends the quiet period and its total is retained', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const toasts = timeAwareToastSource(() => clock.now(), [
      { atMs: 2_500, totals: { success: 0, resultError: 1, catchError: 0 } },
    ])
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: toasts.source,
      clock,
      run: async () => undefined,
    })
    const request = fakeRequest('POST', ID)
    page.emit('request', request)
    await advance(100)
    await drain()
    page.emit('requestfinished', request)
    // Virtual-time note: the scheduled toast (2500) is first READ at the
    // jumped poll time 2999, so the quiet window runs from 2999 → settles at
    // 3999 (real-clock polls land ~100ms apart).
    await advance(2_899) // t=2999 — still inside the minimum observation window
    await drain()
    assert.equal(m.done, false)
    await advance(400) // t=3399: quiet (1000ms) from the toast read at 2999 not yet satisfied
    await drain()
    assert.equal(m.done, false, 'the late toast (read at 2999) must keep the window open past 3399')
    await advance(601) // t=4000 ≥ 2999 + 1000
    await m.settle()
    assert.equal(m.result?.toastTotals?.resultError, 1, 'the late toast total is retained in the final totals')
    assert.ok((m.result?.settledAfterMs ?? 0) >= 3_999)
  })

  it('fails closed when the sync header read itself throws (fixed category, after disposal)', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      clock,
      run: async () => undefined,
    })
    const hostile = {
      method: () => 'POST',
      headers: () => {
        throw new Error('Target page, context or browser has been closed')
      },
    }
    page.emit('request', hostile as never)
    const matching = fakeRequest('POST', ID)
    page.emit('request', matching)
    await advance(100)
    await drain()
    page.emit('requestfinished', matching)
    await advance(2_900)
    await m.settle()
    assert.match(m.error?.message ?? '', /initiateFinalApproval request observer failed/)
    assert.equal(page.armed(), false)
  })

  it('fails closed when the toast totals read itself fails (fixed category, after disposal)', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const source = {
      install: async () => undefined,
      read: async (): Promise<FixedToastTotals | null> => {
        throw new Error('page round-trip collapsed')
      },
      uninstall: async () => undefined,
    }
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: source,
      clock,
      run: async () => undefined,
    })
    await drain()
    await m.settle()
    assert.match(m.error?.message ?? '', /initiateFinalApproval toast totals read failed/)
    assert.equal(page.armed(), false)
  })

  it('rejects an empty expected action id (never an unrestricted match)', async () => {
    const page = fakePage()
    const { clock } = fakeClock()
    const m = await startMeasurement({
      expectedActionId: '',
      page,
      clock,
      run: async () => undefined,
    })
    await m.settle()
    assert.match(m.error?.message ?? '', /initiateFinalApproval expected action id is required/)
    assert.equal(page.armed(), false)
  })
})

describe('T15A measurement: Sonner fixed-toast-totals instrumentation lifecycle (fake evaluate seam)', () => {
  /**
   * The injected MutationObserver needs a real DOM, so this suite pins the
   * LIFECYCLE contract through a fake evaluate: every call carries its ENTIRE
   * argument payload explicitly (instrument key, disposal token, and the
   * three fixed messages — NO captured module values, which die with
   * serialization in a real browser), read returns the page-held totals
   * object, uninstall is callable — and ALWAYS page-evaluates even when
   * install never resolved (a late install must be aborted page-side by the
   * disposal token). The observer's browser behavior is exercised by the
   * serialization-isolation vm suite below and proven live by the first T15A
   * run (labeled limitation).
   */
  it('install()/read()/uninstall() pass their ENTIRE argument payload explicitly — no captured module values', async () => {
    const calls: Array<{ fnSource: string; arg: unknown }> = []
    const totals: FixedToastTotals = { success: 1, resultError: 0, catchError: 0 }
    const page = {
      evaluate: async <R, Arg>(fn: (arg: Arg) => R, arg: Arg): Promise<R> => {
        calls.push({ fnSource: String(fn), arg })
        return totals as unknown as R
      },
    }
    const source = createSonnerFixedToastTotals(page)
    await source.install()
    const installArg = calls[0]?.arg as { key?: string; disposedKey?: string; messages?: string[] }
    assert.equal(typeof installArg?.key, 'string')
    assert.equal(typeof installArg?.disposedKey, 'string')
    assert.notEqual(installArg?.key, installArg?.disposedKey)
    assert.deepEqual(installArg?.messages, [
      FINAL_TRIGGER_SUCCESS_TOAST,
      FINAL_TRIGGER_RESULT_ERROR_TOAST,
      FINAL_TRIGGER_CATCH_ERROR_TOAST,
    ])
    assert.deepEqual(await source.read(), totals)
    assert.equal(calls[1]?.arg, installArg?.key, 'read passes the instrument key as its ONLY argument')
    await source.uninstall()
    assert.deepEqual(calls[2]?.arg, { key: installArg?.key, disposedKey: installArg?.disposedKey })
    assert.equal(calls.length, 3, 'install, read and uninstall each use the page seam exactly once')
    // The serialized callback sources carry no module-scope identifier.
    for (const call of calls) {
      assert.doesNotMatch(call.fnSource, /TOAST_INSTRUMENT_KEY/, 'serialized callbacks must not reference module constants')
    }
  })

  it('uninstall() still page-evaluates when install never resolved — the disposal token must abort a LATE install page-side', async () => {
    const stalledInstall = new Promise<never>(() => undefined)
    const calls: Array<{ arg: unknown }> = []
    const page = {
      evaluate: async <R, Arg>(fn: (arg: Arg) => R, arg: Arg): Promise<R> => {
        calls.push({ arg })
        // The install call stalls (like a hung page.evaluate); uninstall must still run.
        if (calls.length === 1) return stalledInstall as unknown as Promise<R>
        return true as unknown as R
      },
    }
    const source = createSonnerFixedToastTotals(page)
    const installAttempt = source.install()
    void installAttempt.catch(() => undefined)
    await source.uninstall()
    assert.equal(calls.length, 2, 'uninstall page-evaluates even though install never resolved')
    const uninstallArg = calls[1]?.arg as { key?: string; disposedKey?: string }
    assert.equal(typeof uninstallArg?.key, 'string')
    assert.equal(typeof uninstallArg?.disposedKey, 'string')
    await source.uninstall()
    assert.equal(calls.length, 2, 'uninstall is idempotent')
  })
})

describe('T15A measurement: serialization isolation (clean vm, minimal fake DOM, ONLY passed args)', () => {
  /**
   * Astra round-2 P1: Playwright serializes the FUNCTION SOURCE, not its
   * closure — a module constant referenced inside a serialized callback is a
   * guaranteed ReferenceError in a real browser. These tests compile
   * callback.toString() inside a CLEAN vm context whose globals are ONLY the
   * browser-like surface the callbacks may use (window/document/
   * MutationObserver/HTMLElement/Element) plus the vm's own standard
   * builtins, then EXECUTE them with plain-JSON args — never by invoking the
   * original Node closure. A captured module identifier would throw here.
   */
  function cleanPageContext() {
    const observeCalls: Array<{ target: unknown; options: unknown }> = []
    const observerCallbacks: Array<(records: unknown, observer: unknown) => void> = []
    let disconnects = 0
    class FakeElement {
      textContent = ''
      matches(_selector: string): boolean {
        return false
      }
      querySelectorAll(_selector: string): Array<unknown> {
        return []
      }
    }
    class FakeHTMLElement extends FakeElement {}
    const window: Record<string, unknown> = {}
    const document = { body: new FakeHTMLElement(), querySelectorAll: (_selector: string): Array<unknown> => [] }
    class FakeMutationObserver {
      constructor(callback: (records: unknown, observer: unknown) => void) {
        observerCallbacks.push(callback)
      }
      observe(target: unknown, options: unknown): void {
        observeCalls.push({ target, options })
      }
      disconnect(): void {
        disconnects += 1
      }
    }
    const sandbox = {
      window,
      document,
      MutationObserver: FakeMutationObserver,
      HTMLElement: FakeHTMLElement,
      Element: FakeElement,
    }
    const context = vm.createContext(sandbox)
    const compile = (source: string): ((arg: unknown) => unknown) => vm.runInContext(`(${source})`, context) as (arg: unknown) => unknown
    return { window, bodyPrototype: FakeHTMLElement.prototype, observeCalls, observerCallbacks, disconnects: () => disconnects, compile }
  }

  const ARGS = {
    key: 'instrument-key',
    disposedKey: 'disposed-key',
    messages: ['success-message', 'result-error-message', 'catch-error-message'],
  }

  it('install compiles and runs in the clean context, observing body and seeding present toasts', () => {
    const page = cleanPageContext()
    const install = page.compile(String(SERIALIZED_TOAST_CALLBACKS.install))
    assert.equal(install({ ...ARGS }), true)
    assert.equal(page.observeCalls.length, 1, 'observes document.body')
    assert.ok(page.window[ARGS.key], 'installs the page-held holder')
  })

  it('a seeded toast node is counted, read returns ONLY integer totals, uninstall disconnects and arms the disposal token', () => {
    const page = cleanPageContext()
    const install = page.compile(String(SERIALIZED_TOAST_CALLBACKS.install))
    const read = page.compile(String(SERIALIZED_TOAST_CALLBACKS.read))
    const uninstall = page.compile(String(SERIALIZED_TOAST_CALLBACKS.uninstall))
    assert.equal(install({ ...ARGS }), true)
    // Fire the installed observer with one added toast node carrying a FIXED message.
    const node = Object.create(page.bodyPrototype)
    Object.assign(node, {
      textContent: `${ARGS.messages[0]} (plus any close-button glyphs)`,
      matches: (selector: string) => selector === 'li[data-sonner-toast]',
      querySelectorAll: () => [],
    })
    page.observerCallbacks[0]?.([Object.freeze({ addedNodes: [node] })], undefined)
    // Cross-realm note: read() returns a vm-realm object — compare by VALUE
    // (JSON round-trip), not prototype-sensitive deepEqual.
    assert.deepEqual(JSON.parse(JSON.stringify(read(ARGS.key))), { success: 1, resultError: 0, catchError: 0 })
    assert.equal(read('missing-key'), null)
    assert.equal(uninstall({ key: ARGS.key, disposedKey: ARGS.disposedKey }), true)
    assert.equal(page.disconnects(), 1)
    assert.equal(page.window[ARGS.key], undefined, 'holder removed')
    assert.equal(page.window[ARGS.disposedKey], true, 'disposal token armed for late installs')
  })

  it('a LATE install is ABORTED page-side when the disposal token is armed (no leaked observer after cleanup)', () => {
    const page = cleanPageContext()
    page.window[ARGS.disposedKey] = true
    const install = page.compile(String(SERIALIZED_TOAST_CALLBACKS.install))
    assert.equal(install({ ...ARGS }), 'aborted')
    assert.equal(page.observeCalls.length, 0, 'no observer is installed')
    assert.equal(page.window[ARGS.key], undefined, 'no holder is left behind')
  })

  it('the clean context DETECTS captured module identifiers (harness sanity — the round-2 defect shape)', () => {
    const page = cleanPageContext()
    // Cross-realm note: the vm throws its OWN realm's ReferenceError, so the
    // assertion matches the message, not the prototype.
    const capturing = page.compile('function bad() { return TOAST_INSTRUMENT_KEY }')
    assert.throws(() => capturing(undefined), /TOAST_INSTRUMENT_KEY is not defined/)
  })
})

describe('T15A measurement: hard deadline bounds AWAITED operations (stalled ops fail closed; late ops cannot turn timeout into success)', () => {
  const ID = 'id-under-test'
  const BUDGET = DEFAULT_INITIATE_FINAL_APPROVAL_SETTLEMENT

  function controllable<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  function totalsSource(overrides?: {
    install?: () => Promise<void>
    read?: () => Promise<FixedToastTotals | null>
    uninstall?: () => Promise<void>
  }) {
    const zeros: FixedToastTotals = { success: 0, resultError: 0, catchError: 0 }
    let uninstalls = 0
    return {
      uninstalls: () => uninstalls,
      source: {
        install: overrides?.install ?? (async () => undefined),
        read: overrides?.read ?? (async () => zeros),
        uninstall: overrides?.uninstall ?? (async () => {
          uninstalls += 1
        }),
      },
    }
  }

  async function collectUnhandled<T>(run: () => Promise<T>): Promise<{ outcome: T; unhandled: unknown[] }> {
    const unhandled: unknown[] = []
    const handler = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', handler)
    let outcome: T
    try {
      outcome = await run()
    } finally {
      process.off('unhandledRejection', handler)
    }
    for (let i = 0; i < 4; i += 1) await new Promise<void>((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', handler)
    return { outcome, unhandled }
  }

  it('a STALLED install fails closed at the deadline — listeners never armed, cleanup still runs', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const stalled = controllable<void>()
    const toasts = totalsSource({ install: () => stalled.promise })
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: toasts.source,
      clock,
      run: async () => undefined,
    })
    await advance(BUDGET.hardDeadlineMs)
    await m.settle()
    assert.match(m.error?.message ?? '', /initiateFinalApproval toast instrumentation install timed out/)
    assert.equal(page.armed(), false, 'request listeners are never armed when install stalls')
    assert.equal(toasts.uninstalls(), 1, 'bounded cleanup still ran (aborting any late install page-side)')
    // The stalled install may still resolve LATE — it must not resurrect the measurement.
    const before = m.error?.message
    stalled.resolve()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(m.error?.message, before)
  })

  it('a STALLED clicks run fails closed with the honest cannot-cancel note; listeners are disarmed', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const stalled = controllable<number>()
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      clock,
      run: () => stalled.promise.then(() => undefined),
    })
    await advance(BUDGET.hardDeadlineMs)
    await m.settle()
    assert.match(m.error?.message ?? '', /initiateFinalApproval clicks operation timed out/)
    assert.match(m.error?.message ?? '', /cannot be cancelled/, 'the error must not silently claim cancellation')
    assert.equal(page.armed(), false)
    const before = m.error?.message
    stalled.resolve(2)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(m.error?.message, before, 'a late clicks result cannot turn the timeout into success')
  })

  it('a STALLED toast read fails closed (fixed category) and actual disposal runs', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const stalled = controllable<FixedToastTotals | null>()
    const toasts = totalsSource({ read: () => stalled.promise })
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: toasts.source,
      clock,
      run: async () => undefined,
    })
    const request = fakeRequest('POST', ID)
    page.emit('request', request)
    await advance(100)
    page.emit('requestfinished', request)
    await advance(BUDGET.hardDeadlineMs - 100)
    await m.settle()
    assert.match(m.error?.message ?? '', /initiateFinalApproval toast totals read timed out/)
    assert.equal(page.armed(), false)
    assert.equal(toasts.uninstalls(), 1)
  })

  it('a LATE read resolution or rejection after the timeout cannot turn it into success and raises NO unhandled rejection', async () => {
    for (const lateKind of ['resolve', 'reject'] as const) {
      const page = fakePage()
      const { clock, advance } = fakeClock()
      const late = controllable<FixedToastTotals | null>()
      const toasts = totalsSource({ read: () => late.promise })
      const m = await startMeasurement({
        expectedActionId: ID,
        page,
        toastTotals: toasts.source,
        clock,
        run: async () => undefined,
      })
      await advance(BUDGET.hardDeadlineMs)
      await m.settle()
      assert.match(m.error?.message ?? '', /toast totals read timed out/, lateKind)
      const before = m.error?.message
      const collected = await collectUnhandled(async () => {
        if (lateKind === 'resolve') late.resolve({ success: 1, resultError: 0, catchError: 0 })
        else late.reject(new Error('late read rejection'))
        for (let i = 0; i < 6; i += 1) await new Promise<void>((resolve) => setImmediate(resolve))
        return m.error?.message ?? ''
      })
      assert.equal(collected.outcome, before, `late ${lateKind} cannot change the outcome`)
      assert.deepEqual(collected.unhandled, [], `late ${lateKind} must not raise an unhandled rejection`)
    }
  })

  it('settlement is NOT accepted when a read resolves after the deadline (expiry checked before settled-return)', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    // The read is SLOW (real clock semantics: it resolves after the deadline)
    // and returns totals that would satisfy settlement if accepted.
    let releaseRead: (() => void) | undefined
    const toasts = totalsSource({
      read: () => new Promise<FixedToastTotals | null>((resolve) => {
        releaseRead = () => resolve({ success: 1, resultError: 0, catchError: 0 })
      }),
    })
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: toasts.source,
      clock,
      run: async () => undefined,
    })
    const request = fakeRequest('POST', ID)
    page.emit('request', request)
    await advance(100)
    page.emit('requestfinished', request)
    // Advance past the hard deadline while the read is still pending: the
    // operation-timeout race fires first with the remaining budget.
    await advance(BUDGET.hardDeadlineMs - 100)
    await m.settle()
    assert.match(m.error?.message ?? '', /timed out/)
    // A late resolution at now > deadline must NEVER produce success.
    releaseRead?.()
    for (let i = 0; i < 4; i += 1) await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(m.done, true)
    assert.match(m.error?.message ?? '', /timed out/)
  })

  it('a STALLED cleanup fails closed on its OWN bounded budget with the honest observer-may-remain note', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const stalled = controllable<void>()
    const toasts = totalsSource({ uninstall: () => stalled.promise })
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: toasts.source,
      clock,
      run: async () => undefined,
    })
    const request = fakeRequest('POST', ID)
    page.emit('request', request)
    await advance(100)
    page.emit('requestfinished', request)
    await advance(BUDGET.minObservationMs - 100) // t=3000: settled, enters bounded cleanup
    await advance(BUDGET.cleanupTimeoutMs) // cleanup budget expires
    await m.settle()
    assert.match(m.error?.message ?? '', /initiateFinalApproval cleanup timed out/)
    assert.match(m.error?.message ?? '', /may remain active/, 'the error must tell the caller the observer may leak')
    assert.equal(page.armed(), false)
  })

  it('PRIMARY precedence: a run() failure wins over a stalled cleanup timeout', async () => {
    const page = fakePage()
    const { clock, advance } = fakeClock()
    const stalled = controllable<void>()
    const toasts = totalsSource({ uninstall: () => stalled.promise })
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: toasts.source,
      clock,
      run: async () => {
        throw new Error('primary click failure')
      },
    })
    await advance(BUDGET.cleanupTimeoutMs)
    await m.settle()
    assert.match(m.error?.message ?? '', /primary click failure/)
    assert.doesNotMatch(m.error?.message ?? '', /cleanup timed out/)
    assert.equal(page.armed(), false)
    const before = m.error?.message
    stalled.resolve()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(m.error?.message, before)
  })
})

describe('T15A measurement: timeout-timer cleanup (Task55 P2 — losing race timers are cancelled)', () => {
  const ID = 'id-under-test'
  const BUDGET = DEFAULT_INITIATE_FINAL_APPROVAL_SETTLEMENT

  /**
   * raceWithBudget's losing timer must be CANCELLED when the operation wins,
   * throws, or times out — a successful read otherwise leaves a referenced
   * timeout pending until the hard deadline. These prove it on the fake clock:
   * after the measurement fully settles (success/error/timeout+cleanup), ZERO
   * wakes remain pending.
   */
  it('a SUCCESSFUL settlement leaves NO pending race timer (each read timer cancelled on win)', async () => {
    const page = fakePage()
    const { clock, advance, pendingWakes } = fakeClock()
    const zeros: FixedToastTotals = { success: 0, resultError: 0, catchError: 0 }
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: { install: async () => undefined, read: async () => zeros, uninstall: async () => undefined },
      clock,
      run: async () => undefined,
    })
    const request = fakeRequest('POST', ID)
    page.emit('request', request)
    await advance(100)
    page.emit('requestfinished', request)
    await advance(BUDGET.minObservationMs - 100)
    await m.settle()
    assert.equal(m.error, undefined, `measurement must succeed, got ${m.error?.message}`)
    assert.equal(m.result?.observedCalls, 1)
    await drain()
    assert.equal(pendingWakes(), 0, 'the winning read timer must be cancelled, not left pending until the deadline')
  })

  it('a quick operation ERROR leaves NO pending race timer', async () => {
    const page = fakePage()
    const { clock, pendingWakes } = fakeClock()
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: {
        install: async () => {
          throw new Error('install blew up')
        },
        read: async () => null,
        uninstall: async () => undefined,
      },
      clock,
      run: async () => undefined,
    })
    await m.settle()
    assert.match(m.error?.message ?? '', /install blew up/)
    await drain()
    assert.equal(pendingWakes(), 0, 'the losing install-timeout timer must be cancelled when the operation throws')
  })

  it('after a read TIMEOUT, the cleanup race timer is cancelled too (uninstall won)', async () => {
    const page = fakePage()
    const { clock, advance, pendingWakes } = fakeClock()
    const stalledRead = new Promise<FixedToastTotals | null>(() => undefined)
    const m = await startMeasurement({
      expectedActionId: ID,
      page,
      toastTotals: { install: async () => undefined, read: () => stalledRead, uninstall: async () => undefined },
      clock,
      run: async () => undefined,
    })
    await advance(BUDGET.hardDeadlineMs)
    await m.settle()
    assert.match(m.error?.message ?? '', /toast totals read timed out/)
    await drain()
    assert.equal(pendingWakes(), 0, 'the cleanup race timer (uninstall won) must be cancelled, not left pending')
  })

  it('ordinary poll sleeps stay UNTOUCHED: the poll loop still uses clock.sleep while races use the cancellable seam (source pin)', () => {
    const moduleSource = readFileSync('tests/support/business-t15a-double-click.ts', 'utf8')
    assert.match(moduleSource, /await clock\.sleep\(step\)/, 'the ordinary poll sleep (absolute-deadline ordering) is unchanged')
    const raceMatch = moduleSource.match(/async function raceWithBudget[\s\S]*?\n\}/)
    assert.ok(raceMatch, 'raceWithBudget must exist')
    assert.match(raceMatch[0], /sleepCancellable\(timeoutMs\)/, 'operation races use the cancellable timer seam')
    assert.match(raceMatch[0], /finally[\s\S]*?cancel\(\)/, 'the race timer is cancelled in a finally (win/throw/timeout)')
    assert.doesNotMatch(raceMatch[0], /\n\s*clock\.sleep\(/, 'the race path must not fall back to the ordinary sleep')
  })
})

describe('T15A measurement: bounded correlation identity (no wire data persisted)', () => {
  it('round-trips the exact bounded record: title + attemptedClicks 2 + observedRequestCalls + fixed status ONLY', () => {
    const raw = JSON.stringify({
      requestTitle: 'Business T15A 1789000000000-1234',
      attemptedClicks: 2,
      observedRequestCalls: 2,
      status: 'measured',
    })
    const parsed = parseT15aBrowserCorrelation(raw)
    assert.equal(parsed.status, 'present')
    assert.deepEqual(parsed.status === 'present' ? parsed.correlation : null, {
      requestTitle: 'Business T15A 1789000000000-1234',
      attemptedClicks: 2,
      observedRequestCalls: 2,
      status: 'measured',
    })
    // Hard bound on the persisted shape: nothing else may ride along.
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['attemptedClicks', 'observedRequestCalls', 'requestTitle', 'status'])
  })

  it('accepts both honest outcomes (1 or 2 observed calls) and rejects every other value', () => {
    const valid = (calls: number) =>
      JSON.stringify({ requestTitle: 'Business T15A 1-1', attemptedClicks: 2, observedRequestCalls: calls, status: 'measured' })
    assert.equal(parseT15aBrowserCorrelation(valid(1)).status, 'present')
    assert.equal(parseT15aBrowserCorrelation(valid(2)).status, 'present')
    for (const bad of [0, 3, -1, 1.5, '2', null]) {
      assert.equal(parseT15aBrowserCorrelation(valid(bad as number)).status, 'corrupt', `observedRequestCalls=${String(bad)}`)
    }
  })

  it('marks corrupt records (wrong title prefix, wrong attemptedClicks, wrong status, malformed JSON)', () => {
    for (const raw of [
      JSON.stringify({ requestTitle: 'Business T15B 1-1', attemptedClicks: 2, observedRequestCalls: 1, status: 'measured' }),
      JSON.stringify({ requestTitle: 'Business T15A', attemptedClicks: 2, observedRequestCalls: 1, status: 'measured' }),
      JSON.stringify({ requestTitle: 'Business T15A 1-1', attemptedClicks: 1, observedRequestCalls: 1, status: 'measured' }),
      JSON.stringify({ requestTitle: 'Business T15A 1-1', attemptedClicks: 2, observedRequestCalls: 1, status: 'guessed' }),
      'not-json',
      'null',
    ]) {
      assert.equal(parseT15aBrowserCorrelation(raw).status, 'corrupt', raw)
    }
  })

  it('pins the attempted-click constant to exactly 2', () => {
    assert.equal(T15A_ATTEMPTED_CLICKS, 2)
  })
})

describe('T15A measurement: STATIC SOURCE-CONTRACT PINS (no browser execution — see layer label)', () => {
  const specSource = readFileSync('tests/business-e2e/business-races.spec.ts', 'utf8')
  const routerSource = readFileSync('src/components/requests/request-modal-router.tsx', 'utf8')

  it('spec: ONE evaluate round-trip issues TWO NATIVE el.click() attempts with NO await between them, on the RESOLVED handle', () => {
    const evaluateMatch = specSource.match(
      /const attemptedClicks = await page\.evaluate\(\(el: SVGElement \| HTMLElement\) => \{([\s\S]*?)\n\s*return 2\s*\n\s*\}, startHandle\)/,
    )
    assert.ok(evaluateMatch, 'the spec must ship the single-evaluate two-native-click pattern on the resolved handle')
    const body = evaluateMatch[1]
    assert.equal(
      (body.match(/button\.click\(\)/g) ?? []).length,
      2,
      'exactly two native click attempts inside the one evaluate',
    )
    assert.doesNotMatch(body, /await/, 'no awaits between the two clicks (same browser task)')
    assert.match(specSource, /const startHandle = await start\.elementHandle\(\)/, 'the handle is resolved once')
    assert.doesNotMatch(specSource, /dispatchEvent\(/, 'the disproven dispatchEvent technique is gone')
    const startQueries = specSource.match(/getByRole\('button', \{ name: 'Start Final Approval' \}\)/g) ?? []
    assert.equal(startQueries.length, 1, 'the Start Final Approval button is queried by name exactly ONCE (no second re-query)')
  })

  it('spec: settles through the bounded measurement, then asserts FINAL totals TOGETHER (no mid-window instantaneous toast snapshots)', () => {
    assert.match(specSource, /measureInitiateFinalApprovalRequests\(\{/, 'the settlement-based measurement helper is used')
    assert.match(specSource, /createSonnerFixedToastTotals\(page\)/, 'fixed-message toast totals are instrumented for the whole window')
    assert.match(specSource, /readInitiateFinalApprovalActionId\(/)
    assert.match(specSource, /\.next\/server\/server-reference-manifest\.json/)
    assert.match(specSource, /writeT15aBrowserCorrelation\(env\.evidenceDir, \{/)
    // The Astra P1 pattern is GONE: no first-success locator snapshot, no
    // mid-window toast-count polls.
    assert.doesNotMatch(specSource, /successToasts/, 'no instantaneous success-toast DOM snapshot remains')
    assert.doesNotMatch(specSource, /expect\s*\n?\s*\.poll\(\(\) => live\.count\(\)/, 'no live-count branch poll remains')
  })

  it('spec: the Completed endpoint and T15B/T15C/T15D are preserved unchanged', () => {
    assert.match(specSource, /T15B two eligible approvers race the same step/)
    assert.match(specSource, /T15C approve vs reject race/)
    assert.match(specSource, /T15D retrying a stale decision form/)
    assert.match(specSource, /expectCompletedRequest\(page, title\)/, 'the T15A chain still completes to Completed')
  })

  it('source pin: the EXACT router toast strings (Task51\'s invented wording must never drift in)', () => {
    // Verified against src/components/requests/request-modal-router.tsx —
    // the actual success text ENDS with "successfully" (router :622), and the
    // only two initiation-error branches are :626 and :630.
    assert.match(routerSource, /toast\.success\("Final approval initiated successfully"\)/)
    assert.match(routerSource, /toast\.error\("Failed to initiate final approval"\)/)
    assert.match(routerSource, /toast\.error\("An error occurred while initiating final approval"\)/)
    assert.equal(FINAL_TRIGGER_SUCCESS_TOAST, 'Final approval initiated successfully')
    assert.equal(FINAL_TRIGGER_RESULT_ERROR_TOAST, 'Failed to initiate final approval')
    assert.equal(FINAL_TRIGGER_CATCH_ERROR_TOAST, 'An error occurred while initiating final approval')
  })
})
