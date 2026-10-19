import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PERSONA_CLOSE_DEADLINE_MS,
  PersonaCloseDeadlineError,
  PersonaCloseError,
  closeWithPersonaDeadline,
  createPersonaPhaseEvidence,
  markPersonaOperation,
  runPersonaLifecycle,
  type PersonaPhaseEvidence,
} from '../support/admin-security/admin-persona-cleanup'

/**
 * Regression contract for bounded, fail-closed persona cleanup + per-operation
 * phase timing (Astra run-7/round-11 reviews).
 *
 * The tests exercise the ACTUAL shared lifecycle seam (`runPersonaLifecycle`)
 * that the spec's `withPersonaContext` invokes — with injected
 * creation/page/sign-in/callback/close steps and the real evidence sink —
 * NOT a copied orchestration. Locked:
 *  - fixed start/completion/failure marks for context creation, page
 *    creation, the sign-in wrapper AND each real signIn await
 *    (navigation / email-fill / password-fill / submit-click / URL-wait),
 *    so the LAST STARTED operation is identifiable even when unfinished;
 *    failure attribution is classifier-category only (no credentials,
 *    arguments, URLs, or error strings in timing evidence);
 *  - page-creation and sign-in failures still attempt the bounded close;
 *  - the ORIGINAL callback/sign-in error identity wins over close
 *    rejection/deadline, while the secondary cleanup outcome remains in the
 *    serialized evidence;
 *  - a standalone close rejection/deadline (no primary) fails;
 *  - the bounded close retains late-settlement handlers (never unhandled).
 */

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

describe('admin persona cleanup: markPersonaOperation (shared per-await timing helper)', () => {
  it('records start/completed around success and start/failed + classifier category on failure', async () => {
    const evidence = createPersonaPhaseEvidence(1)
    await markPersonaOperation(evidence, 'sign-in-navigation', async () => undefined)
    await assert.rejects(
      markPersonaOperation(evidence, 'sign-in-email-fill', () => Promise.reject(new Error('Target page, context or browser has been closed'))),
    )
    const serialized = evidence.serialize()
    assert.ok(serialized.includes('"sign-in-navigation-start"'))
    assert.ok(serialized.includes('"sign-in-navigation-completed"'))
    assert.ok(serialized.includes('"sign-in-email-fill-start"'))
    assert.ok(serialized.includes('"sign-in-email-fill-failed"'))
    const parsed = JSON.parse(serialized) as { operationFailures: Array<{ stage: string; category: string }> }
    assert.deepEqual(parsed.operationFailures, [{ stage: 'sign-in-email-fill', category: 'target-closed' }])
    assert.ok(!serialized.includes('Target page'), 'classifier categories only — never raw error text')
  })
})

describe('admin persona cleanup: bounded fail-closed close (retained)', () => {
  it('a successful close resolves and records the completed outcome', async () => {
    const evidence = createPersonaPhaseEvidence(2)
    await closeWithPersonaDeadline({ close: async () => undefined }, evidence, 1_000)
    assert.ok(evidence.serialize().includes('"completed"'))
  })

  it('a rejected close FAILS with a sanitized category — no raw error text', async () => {
    const evidence = createPersonaPhaseEvidence(3)
    await assert.rejects(
      closeWithPersonaDeadline({ close: () => Promise.reject(new Error('Target page, context or browser has been closed')) }, evidence, 1_000),
      (error: unknown) => {
        assert.ok(error instanceof PersonaCloseError)
        assert.equal(error.errorCategory, 'target-closed')
        assert.ok(!error.message.includes('Target page'))
        return true
      },
    )
  })

  it('a never-resolving close hits the deadline, FAILS with outcome unknown, and late settlement stays handled and recorded', { timeout: 10_000 }, async () => {
    const evidence = createPersonaPhaseEvidence(4)
    const never = deferred<void>()
    await assert.rejects(
      closeWithPersonaDeadline({ close: () => never.promise }, evidence, 20),
      (error: unknown) => {
        assert.ok(error instanceof PersonaCloseDeadlineError)
        assert.ok(/unknown/i.test(error.message))
        return true
      },
    )
    assert.ok(evidence.serialize().includes('"deadline-exceeded"'))
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      never.resolve()
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(unhandled.length, 0)
      assert.ok(evidence.serialize().includes('"completed-late"'))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('default deadline is the configured 15s constant', () => {
    assert.equal(PERSONA_CLOSE_DEADLINE_MS, 15_000)
  })
})

describe('admin persona cleanup: the ACTUAL lifecycle seam (runPersonaLifecycle)', () => {
  /** Minimal fake browser-ish objects; close invocations are counted for assertion. */
  function fakeSteps(overrides?: {
    createContext?: () => Promise<{ close(): Promise<void> }>
    createPage?: () => Promise<unknown>
    signIn?: (page: unknown, evidence: PersonaPhaseEvidence) => Promise<void>
    callback?: () => Promise<string>
    close?: () => Promise<void>
  }) {
    const calls: string[] = []
    return {
      calls,
      steps: {
        createContext:
          overrides?.createContext ?? (async () => ({ close: async () => { calls.push('close') } })),
        createPage: overrides?.createPage ?? (async () => ({ fake: 'page' })),
        signIn: overrides?.signIn ?? (async () => undefined),
        callback: overrides?.callback ?? (async () => 'callback-result'),
        close:
          overrides?.close ??
          (async () => {
            calls.push('close-explicit')
          }),
      },
    }
  }

  it('happy path: fixed start/completion marks for creation, sign-in (inner awaits), callback, and a completed close', async () => {
    const evidence = createPersonaPhaseEvidence(10)
    const { steps } = fakeSteps({
      signIn: async (_page, innerEvidence) => {
        // Mirror the REAL signIn helper: every await goes through the shared marker.
        await markPersonaOperation(innerEvidence, 'sign-in-navigation', async () => undefined)
        await markPersonaOperation(innerEvidence, 'sign-in-email-fill', async () => undefined)
        await markPersonaOperation(innerEvidence, 'sign-in-password-fill', async () => undefined)
        await markPersonaOperation(innerEvidence, 'sign-in-submit-click', async () => undefined)
        await markPersonaOperation(innerEvidence, 'sign-in-url-wait', async () => undefined)
      },
    })
    const result = await runPersonaLifecycle(steps, evidence, { closeDeadlineMs: 1_000 })
    assert.equal(result, 'callback-result')
    const phases = (JSON.parse(evidence.serialize()) as { phases: Array<{ label: string }> }).phases.map((p) => p.label)
    assert.deepEqual(phases, [
      'context-create-start',
      'context-create-completed',
      'page-create-start',
      'page-create-completed',
      'sign-in-start',
      'sign-in-navigation-start',
      'sign-in-navigation-completed',
      'sign-in-email-fill-start',
      'sign-in-email-fill-completed',
      'sign-in-password-fill-start',
      'sign-in-password-fill-completed',
      'sign-in-submit-click-start',
      'sign-in-submit-click-completed',
      'sign-in-url-wait-start',
      'sign-in-url-wait-completed',
      'sign-in-completed',
      'callback-start',
      'callback-completed',
      'close-start',
    ])
    assert.ok(evidence.serialize().includes('"completed"'))
  })

  it('a PAGE-CREATION failure still attempts close and preserves the original error identity', { timeout: 10_000 }, async () => {
    const evidence = createPersonaPhaseEvidence(11)
    const pageError = new Error('page creation failed')
    const closeAttempts: string[] = []
    await assert.rejects(
      runPersonaLifecycle(
        {
          createContext: async () => ({ close: async () => undefined }),
          createPage: () => Promise.reject(pageError),
          signIn: async () => undefined,
          callback: async () => 'unused',
          close: async () => {
            closeAttempts.push('close-attempted')
            throw new Error('close also failed')
          },
        },
        evidence,
        { closeDeadlineMs: 50 },
      ),
      (error: unknown) => error === pageError,
      'the page-creation error must win over the close failure',
    )
    assert.ok(closeAttempts.includes('close-attempted'), 'close must still be attempted after a page-creation failure')
    const serialized = evidence.serialize()
    assert.ok(serialized.includes('"page-create-failed"'), 'failure mark for page creation')
    assert.ok(serialized.includes('"rejected"'), 'the secondary cleanup outcome must persist separately')
  })

  it('a SIGN-IN failure still attempts close, preserves identity, and the last started operation is identifiable', { timeout: 10_000 }, async () => {
    const evidence = createPersonaPhaseEvidence(12)
    const signInError = new Error('sign-in blew up')
    await assert.rejects(
      runPersonaLifecycle(
        {
          createContext: async () => ({ close: async () => undefined }),
          createPage: async () => ({ fake: 'page' }),
          signIn: async () => Promise.reject(signInError),
          callback: async () => 'unused',
          close: () => Promise.resolve(),
        },
        evidence,
      ),
      (error: unknown) => error === signInError,
    )
    const phases = (JSON.parse(evidence.serialize()) as { phases: Array<{ label: string }> }).phases.map((p) => p.label)
    assert.ok(phases.includes('sign-in-start') && phases.includes('sign-in-failed'))
    assert.equal(phases[phases.length - 1], 'close-start', 'close is attempted after the sign-in failure')
  })

  it('the last STARTED operation is identifiable while an inner sign-in await is unfinished', async () => {
    const evidence = createPersonaPhaseEvidence(13)
    const never = deferred<void>()
    const lifecycle = runPersonaLifecycle(
      {
        createContext: async () => ({ close: () => never.promise }),
        createPage: async () => ({ fake: 'page' }),
        signIn: async (_page, innerEvidence) => {
          await markPersonaOperation(innerEvidence, 'sign-in-navigation', async () => undefined)
          await markPersonaOperation(innerEvidence, 'sign-in-email-fill', () => never.promise)
        },
        callback: async () => 'unused',
        close: () => never.promise,
      },
      evidence,
      { closeDeadlineMs: 5_000 },
    )
    void lifecycle.catch(() => undefined) // keep the pending lifecycle handled
    await new Promise((resolve) => setTimeout(resolve, 20))
    const phases = (JSON.parse(evidence.serialize()) as { phases: Array<{ label: string }> }).phases.map((p) => p.label)
    assert.equal(phases[phases.length - 1], 'sign-in-email-fill-start', 'the unfinished operation is the last started mark')
  })

  it('primary callback identity wins over a close DEADLINE; the unknown close outcome persists separately', { timeout: 10_000 }, async () => {
    const evidence = createPersonaPhaseEvidence(14)
    const primary = new Error('denial assertion failed')
    const never = deferred<void>()
    await assert.rejects(
      runPersonaLifecycle(
        {
          createContext: async () => ({ close: () => never.promise }),
          createPage: async () => ({ fake: 'page' }),
          signIn: async () => undefined,
          callback: () => Promise.reject(primary),
          close: () => never.promise,
        },
        evidence,
        { closeDeadlineMs: 20 },
      ),
      (error: unknown) => error === primary,
    )
    const serialized = evidence.serialize()
    assert.ok(serialized.includes('"deadline-exceeded"'), 'the secondary cleanup outcome (unknown) must persist')
  })

  it('a standalone close failure with no primary must itself fail', { timeout: 10_000 }, async () => {
    await assert.rejects(
      runPersonaLifecycle(fakeSteps({ close: () => Promise.reject(new Error('close boom')) }).steps, createPersonaPhaseEvidence(15), { closeDeadlineMs: 1_000 }),
      (error: unknown) => error instanceof PersonaCloseError,
    )
  })

  it('a context-creation failure fails without attempting close (nothing to close) and is attributed', async () => {
    const evidence = createPersonaPhaseEvidence(16)
    const createError = new Error('no browser context')
    await assert.rejects(
      runPersonaLifecycle(
        {
          createContext: () => Promise.reject(createError),
          createPage: async () => ({ fake: 'page' }),
          signIn: async () => undefined,
          callback: async () => 'unused',
          close: async () => undefined,
        },
        evidence,
      ),
      (error: unknown) => error === createError,
    )
    const parsed = JSON.parse(evidence.serialize()) as { phases: Array<{ label: string }>; closeOutcomes: unknown[] }
    const labels = parsed.phases.map((phase) => phase.label)
    assert.ok(labels.includes('context-create-start') && labels.includes('context-create-failed'))
    assert.equal(parsed.closeOutcomes.length, 0)
  })

  it('timing evidence carries no credentials, arguments, URLs, error strings, or filepaths', { timeout: 10_000 }, async () => {
    const evidence = createPersonaPhaseEvidence(17)
    await assert.rejects(
      runPersonaLifecycle(
        {
          createContext: async () => ({ close: async () => undefined }),
          createPage: async () => ({ fake: 'page' }),
          signIn: async () => undefined,
          callback: async () => 'unused',
          close: () => Promise.reject(new Error('net::ERR_CONNECTION_REFUSED /tmp/private-token/worker.ts:12:34 {"password":"hunter2"}')),
        },
        evidence,
        { closeDeadlineMs: 1_000 },
      ),
    )
    const serialized = evidence.serialize()
    for (const forbidden of ['hunter2', '/tmp/private-token', 'worker.ts', 'password', 'http://', 'ERR_CONNECTION_REFUSED /tmp']) {
      assert.ok(!serialized.includes(forbidden), `timing evidence must never contain ${JSON.stringify(forbidden)}`)
    }
    const parsed = JSON.parse(serialized) as { operationFailures: Array<{ stage: string; category: string }> }
    assert.ok(parsed.operationFailures.every((failure) => /^[a-z-]+$/.test(failure.stage) && /^[a-z-]+$/.test(failure.category)), 'failure attribution is fixed stages + classifier categories only')
  })
})
