import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  captureActionWires,
  teardownActionWireCapture,
  settleThenPersistAndDispose,
  CaptureSettlementError,
  CaptureSettlementTimeoutError,
  type ActionWireCapture,
  type ActionWirePageSource,
  type ActionWireRequestSource,
  type ActionWireResponseSource,
  type TeardownContext,
} from '../support/admin-security/admin-action-wire-capture'
import {
  resolveRequiredUiWireActionIds,
  serializeRequiredActionMapping,
} from '../support/admin-security/admin-action-wire'

/**
 * Regression contract for the admin spec's action-wire capture hook.
 *
 * Rounds 2-4 locked: tracked pending captures with rejection routing
 * (never unhandled), drain-before-close teardown with per-context close
 * isolation, and bounded settlement (Astra fresh run-4 review).
 *
 * Round 5 (Astra diagnostics review, three P1s):
 *  (real events) lifecycle evidence comes from the PAGE's real Playwright
 *      events — 'response' (payload exposes .request()), 'requestfinished',
 *      'requestfailed' — never from invented Request-object events; a
 *      header-capture rejection is distinguished from a network failure.
 *  (persistence) a sanitized, bounded diagnostic artifact is serialized on
 *      success/error/timeout AND after context cleanup, including completed,
 *      failed, and LATE records with per-request attribution; late
 *      rejections stay handled AND reported; final disposal removes every
 *      page listener while rejection handlers remain attached.
 *  (privacy) no arbitrary error message/stack text is serialized — only
 *      allowlisted categories/codes and safe stack locations; adversarial
 *      quoted-JSON passwords and multi-cookie strings must not leak; errors
 *      propagate as test failures with safe summaries, not raw text.
 */

/** Minimal fake page with the REAL Playwright event surface: request/response/requestfinished/requestfailed. */
function fakePage(): ActionWirePageSource & {
  emitRequest(request: ActionWireRequestSource): void
  emitResponse(response: ActionWireResponseSource): void
  emitRequestFinished(request: ActionWireRequestSource): void
  emitRequestFailed(request: ActionWireRequestSource): void
  listenerCount(event?: string): number
} {
  const listeners = new Map<string, Set<(payload: never) => void>>()
  const add = (event: string, listener: (payload: never) => void): void => {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(listener)
  }
  const drop = (event: string, listener: (payload: never) => void): void => {
    listeners.get(event)?.delete(listener)
  }
  const fire = (event: string, payload: never): void => {
    for (const listener of listeners.get(event) ?? []) listener(payload)
  }
  return {
    on: ((event: string, listener: (payload: never) => void) => add(event, listener)) as ActionWirePageSource['on'],
    off: ((event: string, listener: (payload: never) => void) => drop(event, listener)) as ActionWirePageSource['off'],
    emitRequest: (request) => fire('request', request as never),
    emitResponse: (response) => fire('response', response as never),
    emitRequestFinished: (request) => fire('requestfinished', request as never),
    emitRequestFailed: (request) => fire('requestfailed', request as never),
    listenerCount: (event) =>
      event
        ? listeners.get(event)?.size ?? 0
        : [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeRequest(overrides?: {
  method?: string
  actionId?: string | null
  url?: string
  postData?: string | null
  allHeaders?: Promise<Record<string, string>>
}): ActionWireRequestSource {
  const url = overrides?.url ?? 'http://127.0.0.1:41060/admin/users'
  const actionId: string | null = overrides?.actionId === undefined ? 'action-id-1' : overrides.actionId
  return {
    method: () => overrides?.method ?? 'POST',
    headers: (): Record<string, string> => (actionId === null ? {} : { 'next-action': actionId }),
    url: () => url,
    postData: () => overrides?.postData ?? '["user-target"]',
    allHeaders: () =>
      overrides?.allHeaders ??
      Promise.resolve({
        'next-action': actionId ?? '',
        'next-router-state-tree': 'state-tree-1',
        'next-url': '/admin/users',
      }),
  }
}

/** Minimal fake context: records close order in a shared event log; optionally fails the close. */
function fakeContext(events: string[], label: string, opts?: { failClose?: Error }): TeardownContext {
  return {
    close: async () => {
      events.push(`${label}-closed`)
      if (opts?.failClose) throw opts.failClose
    },
  }
}

describe('admin action-wire capture: wire parity (completeness never weakened)', () => {
  it('captures exactly the POSTs with a next-action header, in the CapturedWire shape the spec asserts', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['action-id-2', 'action-id-get'] })
    page.emitRequest(fakeRequest({ method: 'GET', actionId: 'action-id-get' }))
    page.emitRequest(fakeRequest({ actionId: null }))
    page.emitRequest(
      fakeRequest({
        actionId: 'action-id-2',
        url: 'http://127.0.0.1:41060/admin/templates',
        postData: '["template-toggle"]',
        allHeaders: Promise.resolve({ 'next-router-state-tree': 'tree-2' }),
      }),
    )
    await capture.settle()
    assert.deepEqual(capture.captured, [
      {
        actionId: 'action-id-2',
        path: '/admin/templates',
        postData: '["template-toggle"]',
        stateTree: 'tree-2',
        nextUrl: null,
      },
    ])
  })
})

describe('admin action-wire capture: safe error propagation (round 5 privacy contract)', () => {
  it('a rejecting allHeaders propagates as a SAFE summary with an allowlisted category, never raw text', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['action-id-1'] })
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const boom = deferred<Record<string, string>>()
      page.emitRequest(fakeRequest({ allHeaders: boom.promise }))
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(unhandled.length, 0, 'a tracked capture rejection must never be an unhandled rejection')
      boom.reject(new Error('Target page, context or browser has been closed'))
      await assert.rejects(
        capture.settle(),
        (error: unknown) => {
          assert.ok(error instanceof CaptureSettlementError, `expected CaptureSettlementError, got: ${String(error)}`)
          assert.equal(error.summary.failed, 1)
          assert.deepEqual(error.summary.failedCategoryCounts, { 'target-closed': 1 }, 'category counts must be finite and allowlisted')
          assert.ok(!error.message.includes('Target page'), 'the propagated error must not carry raw message text')
          const record = error.projection.records[0]
          assert.equal(record.error?.category, 'target-closed')
          return true
        },
        'settle() must propagate the capture failure as a test failure with a safe summary',
      )
      await capture.settle()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('aggregates every distinct capture failure safely, never silently dropping one', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['a', 'b'] })
    page.emitRequest(fakeRequest({ actionId: 'a', allHeaders: Promise.reject(new Error('first failure')) }))
    page.emitRequest(fakeRequest({ actionId: 'b', allHeaders: Promise.reject(new Error('second failure')) }))
    await assert.rejects(capture.settle(), (error: unknown) => {
      assert.ok(error instanceof CaptureSettlementError)
      assert.equal(error.summary.failed, 2, 'both capture failures must be reported')
      assert.equal(error.summary.failedCategoryCounts.unknown, 2)
      return true
    })
  })
})

describe('admin action-wire capture: real Page lifecycle events (round 5 P1-1)', () => {
  it("correlates the page's real response/requestfinished/requestfailed events with capture records", async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['evented-action'] })
    const headers = deferred<Record<string, string>>()
    const request = fakeRequest({ actionId: 'evented-action', url: 'http://127.0.0.1:41060/admin/users', allHeaders: headers.promise })
    page.emitRequest(request)
    const diagnostic = capture.diagnostics[0]
    assert.ok(diagnostic, 'capture must register diagnostics at request time')
    assert.ok(diagnostic.events.some((entry) => entry.startsWith('started@')), 'timeline must start at request time')
    assert.equal(diagnostic.status, 'in-flight')
    // Real payload shapes: 'response' carries a Response whose .request() is
    // the originating Request; requestfinished/requestfailed carry the Request.
    page.emitResponse({ request: () => request })
    page.emitRequestFinished(request)
    assert.ok(diagnostic.events.some((entry) => entry.startsWith('response@')), "page 'response' event must be correlated via response.request()")
    assert.ok(diagnostic.events.some((entry) => entry.startsWith('requestfinished@')), "page 'requestfinished' event must be correlated")
    headers.resolve({ 'next-router-state-tree': 'tree-real' })
    await capture.settle({ deadlineMs: 1_000 })
    assert.equal(diagnostic.status, 'completed')
    assert.ok(diagnostic.settledAtMs !== null, 'settledAtMs must be recorded once settled')
    assert.ok(diagnostic.events.some((entry) => entry.startsWith('settled@')), 'settlement must close the timeline')
  })

  it('distinguishes a network requestfailed event from a later header-capture rejection', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['netfail-action'] })
    const headers = deferred<Record<string, string>>()
    const request = fakeRequest({ actionId: 'netfail-action', url: 'http://127.0.0.1:41060/admin/templates', allHeaders: headers.promise })
    page.emitRequest(request)
    const diagnostic = capture.diagnostics[0]
    page.emitRequestFailed(request)
    assert.ok(
      diagnostic.events.some((entry) => entry.startsWith('requestfailed@')),
      'network failure event must be recorded distinctly',
    )
    // The header capture fails afterwards for a DIFFERENT reason.
    headers.reject(new Error('Target page, context or browser has been closed'))
    await assert.rejects(capture.settle({ deadlineMs: 1_000 }))
    assert.equal(diagnostic.status, 'header-failed')
    assert.equal(diagnostic.error?.category, 'target-closed', 'the header-capture error category must be attributed')
    assert.ok(diagnostic.events.some((entry) => entry.startsWith('header-failed@')), 'header failure must be a distinct timeline event')
  })

  it('ignores lifecycle events for requests it never captured', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['stranger-irrelevant'] })
    const stranger = fakeRequest({ actionId: 'stranger-action' })
    page.emitRequestFinished(stranger)
    page.emitRequestFailed(stranger)
    page.emitResponse({ request: () => stranger })
    await capture.settle({ deadlineMs: 500 })
    assert.equal(capture.diagnostics.length, 0, 'uncaptured requests must not create diagnostics')
  })
})

describe('admin action-wire capture: persisted sanitized diagnostics (round 5 P1-2)', () => {
  it('serializes completed records with attribution on the success path', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['ok-action'] })
    page.emitRequest(
      fakeRequest({ actionId: 'ok-action', url: 'http://127.0.0.1:41060/admin/users', postData: '["user-target"]' }),
    )
    await capture.settle({ deadlineMs: 1_000 })
    const serialized = capture.serializeDiagnostics()
    const parsed = JSON.parse(serialized) as { totals: { total: number; completed: number }; records: Array<{ actionId: string; pathname: string; status: string }> }
    assert.equal(parsed.totals.total, 1)
    assert.equal(parsed.totals.completed, 1)
    assert.equal(parsed.records[0].actionId, 'ok-action')
    assert.equal(parsed.records[0].pathname, '/admin/users')
    assert.equal(parsed.records[0].status, 'completed')
    assert.ok(!serialized.includes('user-target'), 'the artifact must never contain request body data')
  })

  it('persists late failures after a bounded timeout: serialized output (not memory) carries the late record', { timeout: 10_000 }, async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['late-action'] })
    const never = deferred<Record<string, string>>()
    page.emitRequest(
      fakeRequest({ actionId: 'late-action', url: 'http://127.0.0.1:41060/admin/templates', allHeaders: never.promise }),
    )
    await assert.rejects(
      capture.settle({ deadlineMs: 15 }),
      (error: unknown) => {
        assert.ok(error instanceof CaptureSettlementTimeoutError)
        assert.equal(error.pendingDiagnostics.length, 1)
        assert.equal(error.pendingDiagnostics[0].actionId, 'late-action')
        return true
      },
      'settlement must fail boundedly with pending attribution',
    )
    // Late rejection arrives AFTER the timeout snapshot — it must stay
    // handled and be REPORTED in the serialized artifact.
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      never.reject(new Error('late allHeaders failure'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(unhandled.length, 0, 'late rejection must stay handled')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    const serialized = capture.serializeDiagnostics()
    const parsed = JSON.parse(serialized) as { totals: { failed: number; inFlight: number }; records: Array<{ actionId: string; late: boolean; status: string; error: { category: string } | null }> }
    const record = parsed.records.find((entry) => entry.actionId === 'late-action')
    assert.ok(record, 'the late record must persist in the serialized artifact')
    assert.equal(record.status, 'header-failed')
    assert.equal(record.late, true, 'the record must be marked late (settled after the diagnostic deadline)')
    assert.equal(record.error?.category, 'unknown', 'the late failure must carry an allowlisted category')
    assert.equal(parsed.totals.failed, 1)
    assert.ok(!serialized.includes('late allHeaders failure'), 'no raw failure text may appear in the artifact')
  })
})

describe('admin action-wire capture: adversarial sanitization (round 5 P1-3)', () => {
  it('quoted JSON passwords, multi-cookie strings, and body-bearing messages never leak into diagnostics or propagated errors', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['adversarial'] })
    page.emitRequest(
      fakeRequest({
        actionId: 'adversarial',
        url: 'http://127.0.0.1:41060/admin/users?token=abc123&password=hunter2',
        allHeaders: Promise.reject(
          new Error('bad wire: {"password":"hunter2"} Cookie: sid=alpha; session=beta; authorization=Bearer eyJhbGciOiJ9x'),
        ),
      }),
    )
    let propagated = ''
    await assert.rejects(capture.settle({ deadlineMs: 1_000 }), (error: unknown) => {
      propagated = String((error as Error)?.message ?? error)
      return true
    })
    const serialized = capture.serializeDiagnostics()
    for (const text of [propagated, serialized]) {
      for (const secret of ['hunter2', 'sid=alpha', 'session=beta', 'abc123', 'eyJhbGciOiJ9x', 'Bearer eyJ', 'user-target', 'password":"']) {
        assert.ok(!text.includes(secret), `neither propagated errors nor artifacts may contain ${JSON.stringify(secret)}`)
      }
    }
    const record = capture.diagnostics[0]
    assert.ok(record.error, 'the failure must still be recorded')
    assert.ok(typeof record.error?.category === 'string', 'the error must surface as an allowlisted category')
  })

  it('classifies known failure shapes into allowlisted categories without exporting message text', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['net-err'] })
    page.emitRequest(
      fakeRequest({ actionId: 'net-err', allHeaders: Promise.reject(new Error('net::ERR_CONNECTION_REFUSED at 127.0.0.1:5432')) }),
    )
    await assert.rejects(capture.settle({ deadlineMs: 1_000 }))
    const record = capture.diagnostics[0]
    assert.equal(record.error?.category, 'net-error')
    assert.equal(record.error?.code, 'net::ERR_CONNECTION_REFUSED', 'net error codes are allowlisted and safe')
  })
})

describe('admin action-wire capture: final disposal (round 5 P1-2)', () => {
  it('dispose removes every page listener, is idempotent, and keeps rejection handlers active for late failures', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['dispose-action'] })
    const never = deferred<Record<string, string>>()
    page.emitRequest(fakeRequest({ actionId: 'dispose-action', allHeaders: never.promise }))
    assert.ok(page.listenerCount('request') >= 1, 'request listener registered while collecting')
    capture.detach()
    assert.equal(page.listenerCount('request'), 0, 'detach must stop collection')
    assert.ok(page.listenerCount('response') > 0, 'lifecycle listeners stay active after detach for pending captures')
    capture.dispose()
    assert.equal(page.listenerCount(), 0, 'dispose must remove every page listener')
    capture.dispose() // idempotent
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      never.reject(new Error('post-dispose late failure'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(unhandled.length, 0, 'rejection handlers must remain attached after disposal — no unhandled late rejection')
      const serialized = capture.serializeDiagnostics()
      assert.ok(serialized.includes('"header-failed"'), 'failure accounting must survive disposal in the serialized artifact')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('admin action-wire capture: afterAll teardown integration (Astra lifecycle review P1)', () => {
  it('settle() throw still closes every context, after draining a still-pending capture, keeping the failure observable', { timeout: 10_000 }, async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['already-rejected', 'still-pending'] })
    const events: string[] = []
    page.emitRequest(fakeRequest({ actionId: 'already-rejected', allHeaders: Promise.reject(new Error('capture rejected A')) }))
    const pendingHeaders = deferred<Record<string, string>>()
    page.emitRequest(fakeRequest({ actionId: 'still-pending', allHeaders: pendingHeaders.promise }))

    const admin = fakeContext(events, 'admin')
    const standby = fakeContext(events, 'standby')
    const teardown = teardownActionWireCapture(capture, [admin, standby])

    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(events.length, 0, 'no context may close while a capture is still in flight')

    events.push('pending-drained')
    pendingHeaders.resolve({ 'next-router-state-tree': 'tree-late' })
    await assert.rejects(
      teardown,
      (error: unknown) => {
        assert.ok(error instanceof CaptureSettlementError, 'the capture failure must stay observable')
        assert.equal(error.summary.failed, 1)
        return true
      },
      'the capture failure must propagate through the settle() throw',
    )
    assert.deepEqual(
      events,
      ['pending-drained', 'admin-closed', 'standby-closed'],
      'both contexts must close AFTER the drain, despite settlement throwing',
    )
  })

  it('a context close failure neither prevents the remaining closes nor masks the primary capture error', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['rejecting'] })
    const events: string[] = []
    page.emitRequest(fakeRequest({ actionId: 'rejecting', allHeaders: Promise.reject(new Error('primary capture error')) }))

    const failing = fakeContext(events, 'failing', { failClose: new Error('close failed') })
    const remaining = fakeContext(events, 'remaining')
    await assert.rejects(
      teardownActionWireCapture(capture, [failing, remaining]),
      (error: unknown) => {
        assert.ok(error instanceof CaptureSettlementError, 'the primary capture error must propagate, not the close failure')
        assert.equal(error.summary.failed, 1)
        return true
      },
    )
    assert.deepEqual(events, ['failing-closed', 'remaining-closed'], 'a failed close must not stop the remaining closes')
  })
})

describe('admin action-wire capture: bounded settlement and detach/drain semantics (run-4 review, retained)', () => {
  it('never-resolving allHeaders fails boundedly with identifiable pending metadata and attempts both contexts', { timeout: 10_000 }, async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['pending-action-1'] })
    const events: string[] = []
    const never = deferred<Record<string, string>>()
    page.emitRequest(
      fakeRequest({
        actionId: 'pending-action-1',
        url: 'http://127.0.0.1:41060/admin/templates',
        allHeaders: never.promise,
      }),
    )
    const admin = fakeContext(events, 'admin')
    const standby = fakeContext(events, 'standby')
    await assert.rejects(
      teardownActionWireCapture(capture, [admin, standby], { settleDeadlineMs: 25 }),
      (error: unknown) => {
        assert.ok(error instanceof CaptureSettlementTimeoutError)
        assert.equal(error.pendingDiagnostics.length, 1, 'the pending capture must be identifiable')
        const pending = error.pendingDiagnostics[0]
        assert.equal(pending.actionId, 'pending-action-1')
        assert.equal(pending.pathname, '/admin/templates')
        assert.ok(pending.events.some((entry) => entry.startsWith('started@')), 'pending metadata must carry the start event')
        return true
      },
      'settlement must FAIL with pending-request metadata once the diagnostic deadline expires',
    )
    assert.deepEqual(events, ['admin-closed', 'standby-closed'], 'both contexts must still be attempted despite the bounded failure')
  })

  it('expiry is never success and never discards the task: it still completes and a later settle passes', { timeout: 10_000 }, async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['slow-action'] })
    const slow = deferred<Record<string, string>>()
    page.emitRequest(
      fakeRequest({ actionId: 'slow-action', url: 'http://127.0.0.1:41060/admin/users', allHeaders: slow.promise }),
    )
    await assert.rejects(
      capture.settle({ deadlineMs: 15 }),
      (error: unknown) => error instanceof CaptureSettlementTimeoutError,
      'the diagnostic deadline must bound settlement',
    )
    assert.equal(capture.captured.length, 0, 'expiry must never count as capture success')
    slow.resolve({ 'next-router-state-tree': 'tree-slow', 'next-url': '/admin/users' })
    await capture.settle({ deadlineMs: 5_000 })
    assert.equal(capture.captured.length, 1, 'the pending task must complete — never discarded by the timeout')
    assert.equal(capture.captured[0].actionId, 'slow-action')
    assert.equal(capture.captured[0].path, '/admin/users')
  })

  it('settle() stays pending while a capture is in flight and completes it even after detach (drain before close)', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['drain-me'] })
    const headers = deferred<Record<string, string>>()
    page.emitRequest(fakeRequest({ actionId: 'drain-me', allHeaders: headers.promise }))
    capture.detach()
    let settled = false
    const settleDone = capture.settle().then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(settled, false, 'settle() must not resolve while a capture is still in flight')
    headers.resolve({ 'next-router-state-tree': 'tree-late', 'next-url': '/admin/users' })
    await settleDone
    assert.deepEqual(capture.captured, [
      {
        actionId: 'drain-me',
        path: '/admin/users',
        postData: '["user-target"]',
        stateTree: 'tree-late',
        nextUrl: '/admin/users',
      },
    ])
  })
})

describe('admin action-wire capture: runtime-derived required mapping (round 9, run-6 review)', () => {
  const fullManifest = (): Map<string, string> =>
    new Map([
      ['server-actions/users.ts#getUsers', 'id-get-users'],
      ['server-actions/users.ts#getUser', 'id-get-user'],
      ['server-actions/users.ts#deactivateUser', 'id-deactivate'],
      ['server-actions/users.ts#activateUser', 'id-activate'],
      ['server-actions/users.ts#resetUserPassword', 'id-reset'],
      ['server-actions/templates.ts#getTemplates', 'id-get-templates'],
      ['server-actions/templates.ts#getTemplate', 'id-get-template'],
      ['server-actions/templates.ts#toggleTemplateStatus', 'id-toggle'],
      ['server-actions/templates.ts#setTemplateDefault', 'id-default'],
      ['server-actions/templates.ts#deleteTemplate', 'id-delete'],
    ])

  it('resolves exactly the six ui-wire exports from the SAME manifest as a complete unique mapping', () => {
    const entries = resolveRequiredUiWireActionIds(fullManifest())
    assert.equal(entries.length, 6)
    assert.deepEqual(
      entries.map((entry) => entry.exportName).sort(),
      ['activateUser', 'deactivateUser', 'deleteTemplate', 'resetUserPassword', 'setTemplateDefault', 'toggleTemplateStatus'],
    )
    assert.equal(new Set(entries.map((entry) => entry.actionId)).size, 6, 'mapping must be unique')
  })

  it('fails closed when a required export is missing from the manifest', () => {
    const manifest = fullManifest()
    manifest.delete('server-actions/templates.ts#deleteTemplate')
    assert.throws(() => resolveRequiredUiWireActionIds(manifest), /no action id registered for server-actions\/templates.ts#deleteTemplate/)
  })

  it('fails closed when two required exports resolve to the same ID', () => {
    const manifest = fullManifest()
    manifest.set('server-actions/templates.ts#deleteTemplate', 'id-toggle')
    assert.throws(() => resolveRequiredUiWireActionIds(manifest), /not unique|ambiguous/)
  })

  it('serializes the mapping bounded and safe: export names and IDs only — no bodies, credentials, or loader paths', () => {
    const serialized = serializeRequiredActionMapping(resolveRequiredUiWireActionIds(fullManifest()))
    const parsed = JSON.parse(serialized) as { count: number; entries: Array<{ file: string; exportName: string; actionId: string }> }
    assert.equal(parsed.count, 6)
    assert.equal(parsed.entries.length, 6)
    assert.ok(parsed.entries.every((entry) => entry.actionId.startsWith('id-')))
    for (const forbidden of ['loader', 'next-flight', 'password', 'credential', '/var/folders', 'postData']) {
      assert.ok(!serialized.includes(forbidden), `mapping artifact must not contain ${forbidden}`)
    }
  })
})

describe('admin action-wire capture: conditional required-ID capture (round 9, run-6 review)', () => {
  it('fails closed on an empty or duplicate required set at install time', () => {
    const page = fakePage()
    assert.throws(() => captureActionWires(page, { requiredActionIds: [] }), /required action ids must be non-empty/)
    assert.throws(() => captureActionWires(page, { requiredActionIds: ['dup', 'dup'] }), /unique/)
  })

  it('an unrelated never-resolving action is recorded as not-required and NEVER invokes allHeaders', { timeout: 10_000 }, async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['required-1'] })
    let allHeadersInvocations = 0
    const never = deferred<Record<string, string>>()
    const unrelated = fakeRequest({
      actionId: 'unrelated-never-resolving',
      url: 'http://127.0.0.1:41060/requests/my-actions',
      allHeaders: never.promise.then((value) => {
        allHeadersInvocations += 1
        return value
      }),
    })
    page.emitRequest(unrelated)
    page.emitRequest(fakeRequest({ actionId: 'required-1', url: 'http://127.0.0.1:41060/admin/users' }))
    await capture.settle({ deadlineMs: 1_000 })
    assert.equal(allHeadersInvocations, 0, 'asynchronous allHeaders work is restricted to the required set')
    assert.equal(capture.captured.length, 1, 'only the required capture produces a wire')
    assert.equal(capture.captured[0].actionId, 'required-1')
    const unrelatedRecord = capture.diagnostics.find((record) => record.actionId === 'unrelated-never-resolving')
    assert.ok(unrelatedRecord, 'the unrelated request is still evidenced (membership attribution)')
    assert.equal(unrelatedRecord.required, false)
    assert.equal(unrelatedRecord.status, 'not-required')
    assert.ok(unrelatedRecord.events.some((entry) => entry.startsWith('not-required@')))
    const serialized = capture.serializeDiagnostics()
    assert.ok(serialized.includes('"required":false'), 'membership is part of the bounded diagnostic evidence')
    assert.ok(serialized.includes('"required":true'))
    void never
  })

  it('a REQUIRED never-resolving capture still fails settlement with required:true attribution', { timeout: 10_000 }, async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['required-stuck'] })
    const never = deferred<Record<string, string>>()
    page.emitRequest(fakeRequest({ actionId: 'required-stuck', url: 'http://127.0.0.1:41060/admin/templates', allHeaders: never.promise }))
    await assert.rejects(
      capture.settle({ deadlineMs: 15 }),
      (error: unknown) => {
        assert.ok(error instanceof CaptureSettlementTimeoutError)
        assert.equal(error.pendingDiagnostics.length, 1)
        assert.equal(error.pendingDiagnostics[0].actionId, 'required-stuck')
        assert.equal(error.pendingDiagnostics[0].required, true, 'required membership is carried into the failure evidence')
        return true
      },
      'a required pending capture must fail — never silently ignored',
    )
  })

  it('a REQUIRED rejected capture still fails settlement with required:true attribution', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['required-reject'] })
    page.emitRequest(
      fakeRequest({ actionId: 'required-reject', url: 'http://127.0.0.1:41060/admin/users', allHeaders: Promise.reject(new Error('Target page, context or browser has been closed')) }),
    )
    await assert.rejects(capture.settle({ deadlineMs: 1_000 }), (error: unknown) => {
      assert.ok(error instanceof CaptureSettlementError)
      const record = error.projection.records.find((entry) => entry.actionId === 'required-reject')
      assert.ok(record, 'the failed required capture must be prioritized in the failure evidence')
      assert.equal(record.required, true)
      assert.equal(record.error?.category, 'target-closed')
      return true
    })
  })
})

describe('admin action-wire capture: afterAll evidence seam — disposal is unconditional (round 6 P1)', () => {
  const sinkSpy = (behavior: { attachError?: Error } = {}) => {
    const calls: string[] = []
    return {
      calls,
      attachDiagnostics: async (serialized: string): Promise<void> => {
        calls.push(serialized)
        if (behavior.attachError) throw behavior.attachError
      },
    }
  }
  const fakeCaptureHandle = (overrides?: { settleError?: Error; serializeError?: Error }): ActionWireCapture & { disposed: () => boolean } => {
    let disposed = false
    return {
      captured: [],
      diagnostics: [],
      detach: () => undefined,
      dispose: () => {
        disposed = true
      },
      disposed: () => disposed,
      serializeDiagnostics: () => {
        if (overrides?.serializeError) throw overrides.serializeError
        return '{"version":3}'
      },
      settle: async () => {
        if (overrides?.settleError) throw overrides.settleError
      },
    }
  }
  const noopContext = (): TeardownContext => ({ close: async () => undefined })

  it('attachment rejection without a settlement failure propagates the attachment error AND still disposes', async () => {
    const handle = fakeCaptureHandle()
    const sink = sinkSpy({ attachError: new Error('attachment IO failed') })
    await assert.rejects(
      settleThenPersistAndDispose(handle, [noopContext()], sink),
      /attachment IO failed/,
      'with no primary failure the evidence failure must propagate safely',
    )
    assert.equal(handle.disposed(), true, 'disposal must be unconditional — never skipped by attachment failure')
    assert.equal(sink.calls.length, 1, 'serialization output reached the sink')
  })

  const primarySettlementError = (): CaptureSettlementError =>
    new CaptureSettlementError(
      { completed: 0, failed: 1, pending: 0, failedCategoryCounts: { 'target-closed': 1 } },
      { totals: { total: 1, completed: 0, failed: 1, inFlight: 0, late: 0, truncated: 0 }, records: [] },
    )

  it('attachment rejection WITH a settlement failure preserves the PRIMARY error and still disposes', async () => {
    const primary = primarySettlementError()
    const handle = fakeCaptureHandle({ settleError: primary })
    const sink = sinkSpy({ attachError: new Error('attachment IO failed') })
    await assert.rejects(
      settleThenPersistAndDispose(handle, [noopContext()], sink),
      (error: unknown) => error === primary,
      'the primary settlement failure must win over the evidence failure',
    )
    assert.equal(handle.disposed(), true, 'disposal must be unconditional')
  })

  it('serialization failure propagates when there is no primary, and never skips disposal', async () => {
    const handle = fakeCaptureHandle({ serializeError: new Error('serialization boom') })
    const sink = sinkSpy()
    await assert.rejects(
      settleThenPersistAndDispose(handle, [noopContext()], sink),
      /serialization boom/,
      'a serialization failure with no primary must propagate',
    )
    assert.equal(handle.disposed(), true)
  })

  it('serialization failure with a primary preserves the primary and still disposes', async () => {
    const primary = primarySettlementError()
    const handle = fakeCaptureHandle({
      settleError: primary,
      serializeError: new Error('serialization boom'),
    })
    const sink = sinkSpy()
    await assert.rejects(
      settleThenPersistAndDispose(handle, [noopContext()], sink),
      (error: unknown) => error === primary,
    )
    assert.equal(handle.disposed(), true)
  })

  it('the real capture hook removes every page listener through the seam even when attachment rejects', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['seam-action'] })
    page.emitRequest(fakeRequest({ actionId: 'seam-action', url: 'http://127.0.0.1:41060/admin/users' }))
    const sink = sinkSpy({ attachError: new Error('attachment IO failed') })
    await assert.rejects(settleThenPersistAndDispose(capture, [noopContext()], sink), /attachment IO failed/)
    assert.equal(page.listenerCount(), 0, 'every page listener must be removed through the integration seam')
  })
})

describe('admin action-wire capture: no path or fabricated-code export (round 6 P1)', () => {
  it('multiline messages with location-looking secrets and fabricated net codes never reach artifacts or summaries', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['poison'] })
    const poisonous = new Error('failure\npassword/hunter2.ts:12:34')
    poisonous.stack = `${poisonous.message}\n    at worker (/tmp/private-token/worker.ts:12:34)\n    at net::ERR_PRIVATE_TOKEN (/tmp/private-token/worker.ts:56:78)`
    page.emitRequest(fakeRequest({ actionId: 'poison', url: 'http://127.0.0.1:41060/admin/users', allHeaders: Promise.reject(poisonous) }))
    let propagated = ''
    await assert.rejects(capture.settle({ deadlineMs: 1_000 }), (error: unknown) => {
      propagated = String((error as Error)?.message ?? error)
      return true
    })
    const serialized = capture.serializeDiagnostics()
    for (const text of [propagated, serialized]) {
      for (const leak of ['hunter2', 'password/', '/tmp/private-token', 'worker.ts', 'ERR_PRIVATE_TOKEN']) {
        assert.ok(!text.includes(leak), `neither propagated summaries nor artifacts may contain ${JSON.stringify(leak)}`)
      }
    }
    const record = capture.diagnostics[0]
    assert.ok(record.error, 'the failure must still be recorded')
    assert.equal(record.error.category, 'unknown', 'unrecognized shapes fall back to unknown')
    assert.ok(!('stackLocations' in (record.error as object)), 'stack-location extraction must not exist at all')
  })

  it('real allowlisted network codes are retained verbatim', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: ['net-ok'] })
    page.emitRequest(
      fakeRequest({ actionId: 'net-ok', allHeaders: Promise.reject(new Error('net::ERR_CONNECTION_REFUSED somewhere')) }),
    )
    await assert.rejects(capture.settle({ deadlineMs: 1_000 }))
    const record = capture.diagnostics[0]
    assert.equal(record.error?.category, 'net-error')
    assert.equal(record.error?.code, 'net::ERR_CONNECTION_REFUSED')
  })
})

describe('admin action-wire capture: bounded failure projections (round 6 P2)', () => {
  it('settlement errors use the same capped projection with failed-priority and truncation counts', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: [...Array.from({ length: 70 }, (_, i) => `ok-${i}`), ...Array.from({ length: 20 }, (_, i) => `fail-${50 + i}`)] })
    const TOTAL = 70
    for (let i = 0; i < TOTAL; i += 1) {
      const failing = i >= TOTAL - 20
      page.emitRequest(
        fakeRequest({
          actionId: failing ? `fail-${i}` : `ok-${i}`,
          url: 'http://127.0.0.1:41060/admin/users',
          allHeaders: failing ? Promise.reject(new Error(`boom ${i}`)) : Promise.resolve({}),
        }),
      )
    }
    let propagated = ''
    await assert.rejects(capture.settle({ deadlineMs: 5_000 }), (error: unknown) => {
      assert.ok(error instanceof CaptureSettlementError)
      assert.equal(error.summary.failed, 20, 'full failure accounting survives the cap')
      propagated = error.message
      const projection = error.projection
      assert.ok(projection.records.length <= 64, 'the failure report must be bounded')
      assert.equal(projection.totals.total, TOTAL)
      assert.equal(projection.totals.truncated, TOTAL - projection.records.length)
      for (let i = TOTAL - 20; i < TOTAL; i += 1) {
        assert.ok(
          projection.records.some((record) => record.actionId === `fail-${i}`),
          `failed record fail-${i} must be prioritized over completed ones`,
        )
      }
      return true
    })
    assert.ok(propagated.length < 100_000, 'the propagated failure string must stay bounded')
    assert.ok(propagated.includes('fail-69'), 'the bounded summary must still name the newest failure')
  })

  it('timeout errors prioritize pending records within the same bounded projection', { timeout: 10_000 }, async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: [...Array.from({ length: 10 }, (_, i) => `ok-${i}`), 'pending-priority'] })
    for (let i = 0; i < 10; i += 1) {
      page.emitRequest(fakeRequest({ actionId: `ok-${i}`, url: 'http://127.0.0.1:41060/admin/users' }))
    }
    const pendingHeaders = deferred<Record<string, string>>()
    page.emitRequest(fakeRequest({ actionId: 'pending-priority', url: 'http://127.0.0.1:41060/admin/templates', allHeaders: pendingHeaders.promise }))
    await assert.rejects(
      capture.settle({ deadlineMs: 15 }),
      (error: unknown) => {
        assert.ok(error instanceof CaptureSettlementTimeoutError)
        assert.equal(error.pendingDiagnostics.length, 1, 'pending records must be prioritized and present')
        assert.equal(error.pendingDiagnostics[0].actionId, 'pending-priority')
        return true
      },
      'expiry must never be success',
    )
  })

  it('serializeDiagnostics keeps the 512-record artifact cap with truncation accounting', async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: Array.from({ length: 520 }, (_, i) => `bulk-${i}`) })
    for (let i = 0; i < 520; i += 1) {
      page.emitRequest(fakeRequest({ actionId: `bulk-${i}`, url: 'http://127.0.0.1:41060/admin/users' }))
    }
    await capture.settle({ deadlineMs: 30_000 })
    const parsed = JSON.parse(capture.serializeDiagnostics()) as { totals: { total: number; truncated: number }; records: unknown[] }
    assert.equal(parsed.totals.total, 520)
    assert.equal(parsed.records.length, 512)
    assert.equal(parsed.totals.truncated, 8)
  })
})

describe('admin action-wire capture: finite category counts at volume (round 7 P2)', () => {
  it('high-volume all-rejected settlement keeps an exact count with a finite category-count map and a bounded message', { timeout: 10_000 }, async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: Array.from({ length: 80 }, (_, i) => `reject-${i}`) })
    const TOTAL = 80
    for (let i = 0; i < TOTAL; i += 1) {
      page.emitRequest(
        fakeRequest({ actionId: `reject-${i}`, url: 'http://127.0.0.1:41060/admin/users', allHeaders: Promise.reject(new Error(`boom ${i}`)) }),
      )
    }
    await assert.rejects(capture.settle({ deadlineMs: 5_000 }), (error: unknown) => {
      assert.ok(error instanceof CaptureSettlementError)
      assert.equal(error.summary.failed, TOTAL, 'exact total failures retained')
      assert.deepEqual(error.summary.failedCategoryCounts, { unknown: TOTAL }, 'finite category counts, one entry per category')
      const counts = error.summary.failedCategoryCounts as Record<string, number>
      assert.ok(Object.keys(counts).length <= 5, 'the counts map is bounded by the finite category set')
      assert.ok(error.projection.records.length <= 64, 'record projections stay capped')
      assert.equal(error.projection.totals.failed, TOTAL)
      assert.ok(error.message.length < 100_000, 'message stays bounded independently of the failure count')
      return true
    })
  })

  it('mixed rejected+pending timeout carries exact counts for both, with pending prioritized and a bounded message', { timeout: 10_000 }, async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: [...Array.from({ length: 70 }, (_, i) => `mix-reject-${i}`), 'mix-pending-a', 'mix-pending-b'] })
    const REJECTED = 70
    for (let i = 0; i < REJECTED; i += 1) {
      page.emitRequest(
        fakeRequest({ actionId: `mix-reject-${i}`, url: 'http://127.0.0.1:41060/admin/users', allHeaders: Promise.reject(new Error('Target page, context or browser has been closed')) }),
      )
    }
    const pendingA = deferred<Record<string, string>>()
    const pendingB = deferred<Record<string, string>>()
    page.emitRequest(fakeRequest({ actionId: 'mix-pending-a', url: 'http://127.0.0.1:41060/admin/templates', allHeaders: pendingA.promise }))
    page.emitRequest(fakeRequest({ actionId: 'mix-pending-b', url: 'http://127.0.0.1:41060/admin/retention', allHeaders: pendingB.promise }))
    await assert.rejects(
      capture.settle({ deadlineMs: 15 }),
      (error: unknown) => {
        assert.ok(error instanceof CaptureSettlementTimeoutError)
        assert.equal(error.pendingTotal, 2, 'exact pending total retained')
        assert.equal(error.pendingDiagnostics.length, 2, 'both pending records prioritized and present')
        assert.ok(error.pendingDiagnostics.some((record) => record.actionId === 'mix-pending-b'))
        const counts = error.failedCategoryCounts as Record<string, number>
        assert.deepEqual(counts, { 'target-closed': REJECTED }, 'exact per-category failure counts, finite map')
        assert.ok(Object.keys(counts).length <= 5)
        assert.ok(error.message.length < 100_000, 'timeout message stays bounded independently of failure count')
        return true
      },
      'expiry is never success',
    )
  })
})

describe('admin action-wire capture: attachment prioritizes failed and pending records (round 7 P2)', () => {
  it('>512 mixed statuses: late failed and pending records are retained with correct counts and truncation', { timeout: 30_000 }, async () => {
    const page = fakePage()
    const capture = captureActionWires(page, { requiredActionIds: [...Array.from({ length: 600 }, (_, i) => `ok-${i}`), ...Array.from({ length: 20 }, (_, i) => `late-fail-${i}`), 'late-pending'] })
    const COMPLETED = 600
    const FAILED = 20
    for (let i = 0; i < COMPLETED; i += 1) {
      page.emitRequest(fakeRequest({ actionId: `ok-${i}`, url: 'http://127.0.0.1:41060/admin/users' }))
    }
    for (let i = 0; i < FAILED; i += 1) {
      page.emitRequest(
        fakeRequest({ actionId: `late-fail-${i}`, url: 'http://127.0.0.1:41060/admin/templates', allHeaders: Promise.reject(new Error(`late boom ${i}`)) }),
      )
    }
    const pendingHeaders = deferred<Record<string, string>>()
    page.emitRequest(fakeRequest({ actionId: 'late-pending', url: 'http://127.0.0.1:41060/admin/retention', allHeaders: pendingHeaders.promise }))
    // Drain the failed/completed work without touching the pending capture.
    await assert.rejects(capture.settle({ deadlineMs: 5_000 }))
    const parsed = JSON.parse(capture.serializeDiagnostics()) as {
      totals: { total: number; completed: number; failed: number; inFlight: number; truncated: number }
      records: Array<{ actionId: string; status: string }>
    }
    const TOTAL = COMPLETED + FAILED + 1
    assert.equal(parsed.totals.total, TOTAL)
    assert.equal(parsed.totals.completed, COMPLETED)
    assert.equal(parsed.totals.failed, FAILED)
    assert.equal(parsed.totals.inFlight, 1)
    assert.equal(parsed.records.length, 512)
    assert.equal(parsed.totals.truncated, TOTAL - 512)
    for (let i = 0; i < FAILED; i += 1) {
      assert.ok(
        parsed.records.some((record) => record.actionId === `late-fail-${i}`),
        `failed record late-fail-${i} must survive the artifact cap`,
      )
    }
    assert.ok(parsed.records.some((record) => record.actionId === 'late-pending'), 'the pending record must survive the artifact cap')
    assert.ok(
      parsed.records.slice(0, FAILED + 1).every((record) => record.status !== 'completed'),
      'failed and pending records must occupy the leading (prioritized) slots',
    )
  })
})
