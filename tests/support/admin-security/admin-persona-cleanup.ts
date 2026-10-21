/**
 * Bounded, fail-closed persona cleanup + sanitized persistent phase timing
 * for the admin HTTP-security spec (test-only; Astra run-7 review).
 *
 * Run 7 timed out in test 3 (180s timeout, ~728s beyond; the exact blocking
 * operation — close, a preceding sign-in step, or Playwright teardown — is
 * NOT verifiable from the artifacts, and the context.close() cause is
 * unproven). This seam therefore does not claim to fix any hang: it makes
 * the persona lifecycle OBSERVABLE and BOUNDED so the next run can attribute
 * it:
 *
 *  - fixed-label phase marks (context/page creation, sign-in stages, denial
 *    callback, close start) with LOCAL context IDs and monotonic timestamps;
 *  - the close await is deadline-bounded (default PERSONA_CLOSE_DEADLINE_MS).
 *    On expiry the outcome is recorded as UNKNOWN and the test FAILS —
 *    expiry is never converted to success and never claimed as cancellation;
 *    handlers for late completion/rejection stay attached (recorded as
 *    `completed-late`/`rejected-late`, never unhandled);
 *  - a primary callback failure is preserved over cleanup failures; the
 *    cleanup outcome is persisted separately; a standalone close
 *    rejection/deadline with no primary itself fails;
 *  - persisted evidence contains ONLY ids, labels, timestamps, statuses,
 *    and allowlisted error categories (via classifyCaptureError) — no
 *    credentials, bodies, headers, arbitrary error text, or filepaths;
 *  - the existing runner-owned boundary (Playwright child budget + owned
 *    runtime cleanup) remains the FINAL cleanup — this module adds no
 *    shared-process handling and promises nothing about Playwright's
 *    internal teardown.
 *
 * Locked by tests/regression/admin-persona-cleanup.test.ts (RED/GREEN).
 */

import { classifyCaptureError } from './admin-action-wire-capture'

/** Default bounded close deadline (short, fail-closed). */
export const PERSONA_CLOSE_DEADLINE_MS = 15_000

const MAX_PHASE_RECORDS = 64
const MAX_CLOSE_OUTCOMES = 16
const MAX_LABEL_LENGTH = 64

export type PersonaCloseStatus =
  | 'completed'
  | 'rejected'
  | 'deadline-exceeded'
  | 'completed-late'
  | 'rejected-late'

/** Sanitized close failure (allowlisted category only — never raw error text). */
export class PersonaCloseError extends Error {
  constructor(readonly errorCategory: string) {
    super(`persona context close failed (sanitized category: ${errorCategory})`)
    this.name = 'PersonaCloseError'
  }
}

/** Deadline expiry: outcome UNKNOWN — closure is not cancelled and late settlement stays handled. */
export class PersonaCloseDeadlineError extends Error {
  constructor(readonly deadlineMs: number) {
    super(
      `persona context close exceeded the ${deadlineMs}ms deadline — close outcome UNKNOWN ` +
        '(not cancelled; late settlement stays handled and recorded)',
    )
    this.name = 'PersonaCloseDeadlineError'
  }
}

export interface PersonaPhaseEvidence {
  readonly contextId: number
  /** Record a fixed-label lifecycle phase at a monotonic offset. */
  mark(label: string): void
  /** Record a sanitized operation-failure attribution (fixed stage + allowlisted category only). */
  recordOperationFailure(stage: string, category: string): void
  /** Record a sanitized close outcome (status + optional allowlisted category). */
  recordCloseOutcome(status: PersonaCloseStatus, errorCategory?: string): void
  /** Bounded, sanitized JSON evidence (test/persist this, not memory). */
  serialize(): string
}

export function createPersonaPhaseEvidence(contextId: number): PersonaPhaseEvidence {
  const startedAtMs = performance.now()
  const phases: Array<{ label: string; atMs: number }> = []
  const operationFailures: Array<{ stage: string; category: string }> = []
  const closeOutcomes: Array<{ status: PersonaCloseStatus; atMs: number; errorCategory?: string }> = []
  let truncatedPhases = 0
  const relative = (): number => Math.round(performance.now() - startedAtMs)
  return {
    contextId,
    mark(label: string): void {
      if (phases.length >= MAX_PHASE_RECORDS) {
        truncatedPhases += 1
        return
      }
      phases.push({ label: label.slice(0, MAX_LABEL_LENGTH), atMs: relative() })
    },
    recordOperationFailure(stage: string, category: string): void {
      if (operationFailures.length >= MAX_CLOSE_OUTCOMES) return
      operationFailures.push({ stage: stage.slice(0, MAX_LABEL_LENGTH), category: category.slice(0, MAX_LABEL_LENGTH) })
    },
    recordCloseOutcome(status: PersonaCloseStatus, errorCategory?: string): void {
      if (closeOutcomes.length >= MAX_CLOSE_OUTCOMES) return
      closeOutcomes.push({ status, atMs: relative(), errorCategory })
    },
    serialize(): string {
      return JSON.stringify({
        version: 2,
        contextId,
        phaseCount: phases.length,
        truncatedPhases,
        phases,
        operationFailures,
        closeOutcomes,
      })
    },
  }
}

/** Minimal closeable surface (a Playwright BrowserContext satisfies this). */
export interface PersonaCloseable {
  close(): Promise<void>
}

/**
 * Shared per-await timing helper used by BOTH the lifecycle seam and the
 * spec's real signIn helper: records `<stage>-start` before the await and
 * `<stage>-completed` after it — so the LAST STARTED operation is
 * identifiable even when it never finishes — and on failure records
 * `<stage>-failed` plus a sanitized classifier-category attribution. The
 * operation itself is untouched; its arguments are never logged.
 */
export async function markPersonaOperation<T>(
  evidence: PersonaPhaseEvidence,
  stage: string,
  operation: () => Promise<T>,
): Promise<T> {
  evidence.mark(`${stage}-start`)
  try {
    const result = await operation()
    evidence.mark(`${stage}-completed`)
    return result
  } catch (error) {
    evidence.mark(`${stage}-failed`)
    evidence.recordOperationFailure(stage, classifyCaptureError(error).category)
    throw error
  }
}

/** Injected lifecycle steps for runPersonaLifecycle (the shared real seam withPersonaContext invokes). */
export interface PersonaLifecycleSteps<C, P, R> {
  createContext(): Promise<C>
  createPage(context: C): Promise<P>
  /** Optional sign-in step; receives the SAME evidence to mark its inner awaits. */
  signIn?(page: P, evidence: PersonaPhaseEvidence): Promise<void>
  callback(context: C, page: P): Promise<R>
  close(context: C): Promise<void>
}

/**
 * The ACTUAL persona lifecycle orchestration shared by the spec's
 * withPersonaContext: fixed start/completion/failure marks around context
 * creation, page creation, the sign-in wrapper, and the callback — then a
 * deadline-bounded fail-closed close with primary-precedence semantics:
 * the ORIGINAL step error identity wins over close rejection/deadline while
 * the secondary cleanup outcome is recorded separately in the evidence; a
 * standalone close failure (no primary) itself fails. A context-creation
 * failure fails without attempting close (nothing exists to close). No UI
 * or security operation is altered — the seam only observes them.
 */
export async function runPersonaLifecycle<C, P, R>(
  steps: PersonaLifecycleSteps<C, P, R>,
  evidence: PersonaPhaseEvidence,
  options?: { closeDeadlineMs?: number },
): Promise<R> {
  const context = await markPersonaOperation(evidence, 'context-create', () => steps.createContext())
  let primary: unknown
  let hasPrimary = false
  let result!: R
  let page!: P
  try {
    page = await markPersonaOperation(evidence, 'page-create', () => steps.createPage(context))
    if (steps.signIn) {
      await markPersonaOperation(evidence, 'sign-in', () => steps.signIn!(page, evidence))
    }
    result = await markPersonaOperation(evidence, 'callback', () => steps.callback(context, page))
  } catch (error) {
    hasPrimary = true
    primary = error
  } finally {
    try {
      await closeWithPersonaDeadline({ close: () => steps.close(context) }, evidence, options?.closeDeadlineMs)
    } catch (cleanupError) {
      // Cleanup outcome is recorded in the evidence; a primary failure is
      // preserved over it. Without a primary, the cleanup failure itself
      // fails (fail-closed).
      if (!hasPrimary) throw cleanupError
    }
  }
  if (hasPrimary) throw primary
  return result
}

/**
 * Deadline-bounded fail-closed close used by withPersonaContext:
 * resolves on completion; FAILS (PersonaCloseError, sanitized category) on
 * rejection; FAILS (PersonaCloseDeadlineError, outcome unknown) on expiry
 * while keeping late-settlement handlers attached and recording their
 * outcomes. Never converts expiry into success; never claims cancellation.
 */
export async function closeWithPersonaDeadline(
  closeable: PersonaCloseable,
  evidence: PersonaPhaseEvidence,
  deadlineMs: number = PERSONA_CLOSE_DEADLINE_MS,
): Promise<void> {
  evidence.mark('close-start')
  let done = false
  let deadlineHit = false
  await new Promise<void>((resolve, reject) => {
    // The timer always fires or is cleared within the deadline.
    const timer = setTimeout(() => {
      if (done) return
      done = true
      deadlineHit = true
      evidence.recordCloseOutcome('deadline-exceeded')
      reject(new PersonaCloseDeadlineError(deadlineMs))
    }, deadlineMs)
    void Promise.resolve(closeable.close()).then(
      () => {
        clearTimeout(timer)
        if (done) {
          if (deadlineHit) evidence.recordCloseOutcome('completed-late')
          return
        }
        done = true
        evidence.recordCloseOutcome('completed')
        resolve()
      },
      (error: unknown) => {
        clearTimeout(timer)
        const { category } = classifyCaptureError(error)
        if (done) {
          if (deadlineHit) evidence.recordCloseOutcome('rejected-late', category)
          return
        }
        done = true
        evidence.recordCloseOutcome('rejected', category)
        reject(new PersonaCloseError(category))
      },
    )
  })
}
