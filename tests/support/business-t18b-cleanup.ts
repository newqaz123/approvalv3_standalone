/**
 * T18B stranded-replacement cleanup seam v2 (test-only; Astra round-14
 * review corrections).
 *
 * Required semantics (review P1-2/P1-3):
 *  - the PRIMARY test failure is ALWAYS rethrown — including when the
 *    cleanup harness itself (sign-in via `enter`, checkpoint, evidence
 *    writing) fails; evidence/reporting failures never stop feasible
 *    restoration and never become the thrown error;
 *  - EACH original captured account is reactivated INDEPENDENTLY (one
 *    failure never skips the other);
 *  - spare-assignment removal runs only after restoreOriginalUnitManager()
 *    confirms success: if restoration fails, the assignment is RETAINED,
 *    cleanup is recorded as BLOCKED, safe (read-only) verification still
 *    runs, and the cleanup FAILS;
 *  - "assignment never created / already absent" is distinguished from a
 *    genuine removal failure (throw CleanupStepAbsentError from the step);
 *  - with NO primary failure, a step failure/block or a session-harness
 *    error throws (standalone fail-closed).
 *
 * Locked by tests/regression/business-t18b-replacement.test.ts (RED/GREEN).
 */

import { classifyCaptureError } from './admin-security/admin-action-wire-capture'

/** Throw from a step when its target never existed / is already absent (not a failure). */
export class CleanupStepAbsentError extends Error {
  constructor(readonly step: string) {
    super(`cleanup step ${step}: target already absent`)
    this.name = 'CleanupStepAbsentError'
  }
}

export interface StrandedReplacementCleanupSteps {
  /** Reactivate the original Section manager P (independent). */
  reactivateSectionManager(): Promise<void>
  /** Reactivate the original Department manager (independent). */
  reactivateDepartmentManager(): Promise<void>
  /** Restore the ORIGINAL Production 1 unit manager (confirmed on success). */
  restoreOriginalUnitManager(): Promise<void>
  /**
   * Remove ONLY the temporary spare assignment. May throw CleanupStepAbsentError
   * when the assignment was never created or is already absent.
   */
  removeTemporarySpareAssignment(): Promise<void>
  /** Read-only verification of the restored fixture state. */
  verifyRestoration(): Promise<void>
}

export interface StrandedReplacementCleanupOutcome {
  /** Steps actually attempted (fixed labels, required order). */
  readonly attempted: readonly string[]
  /** Sanitized per-step failures (classifier categories only). */
  readonly failures: ReadonlyArray<{ step: string; category: string }>
  /** Steps intentionally skipped because their target was already absent. */
  readonly absent: readonly string[]
  /** Set when removal was withheld because manager restoration failed. */
  readonly blocked: { step: string; reason: string } | null
  /** True only when every required step succeeded and verification passed. */
  readonly completed: boolean
}

/** Standalone cleanup failure (no primary test failure to preserve). */
export class StrandedReplacementCleanupError extends Error {
  constructor(readonly outcome: StrandedReplacementCleanupOutcome) {
    super(
      `T18B cleanup failed: ${outcome.failures.map((f) => `${f.step}(${f.category})`).join(', ') || 'no step failures'}` +
        (outcome.blocked ? `; blocked: ${outcome.blocked.step} (${outcome.blocked.reason})` : ''),
    )
    this.name = 'StrandedReplacementCleanupError'
  }
}

/**
 * Attempt every feasible cleanup step; never throws by itself; returns a
 * sanitized outcome. Removal is dependency-aware: it only runs after
 * restoreOriginalUnitManager() confirms success.
 */
export async function runStrandedReplacementCleanup(
  steps: StrandedReplacementCleanupSteps,
): Promise<StrandedReplacementCleanupOutcome> {
  const attempted: string[] = []
  const failures: Array<{ step: string; category: string }> = []
  const absent: string[] = []
  let blocked: { step: string; reason: string } | null = null

  const runStep = async (label: string, run: () => Promise<void>): Promise<boolean> => {
    attempted.push(label)
    try {
      await run()
      return true
    } catch (error) {
      if (error instanceof CleanupStepAbsentError) {
        absent.push(error.step)
        return true
      }
      failures.push({ step: label, category: classifyCaptureError(error).category })
      return false
    }
  }

  await runStep('reactivate-section-manager', () => steps.reactivateSectionManager())
  await runStep('reactivate-department-manager', () => steps.reactivateDepartmentManager())
  const managerRestored = await runStep('restore-manager', () => steps.restoreOriginalUnitManager())

  if (!managerRestored) {
    // Dependency-aware fail-closed: WITHOUT a confirmed original manager,
    // removing the spare assignment could leave Production 1 managerless
    // (manager selection requires an active directly-assigned user). Retain
    // the assignment, record BLOCKED, still run safe read-only verification.
    blocked = { step: 'remove-spare-assignment', reason: 'original-manager-restoration-failed' }
  } else {
    await runStep('remove-spare-assignment', () => steps.removeTemporarySpareAssignment())
  }
  await runStep('verify-restoration', () => steps.verifyRestoration())

  return { attempted, failures, absent, blocked, completed: failures.length === 0 && blocked === null }
}

export interface StrandedReplacementCleanupGuardOptions {
  primary?: unknown
  hasPrimary?: boolean
  /**
   * Session harness (sign-in). Must invoke `run` to execute restoration.
   * A throw before or around `run` is a harness error: it must not replace
   * a primary failure, and without a primary it fails the test as itself.
   */
  enter?: (run: () => Promise<void>) => Promise<void>
  /**
   * Evidence/checkpoint writing. Best-effort: a throw is swallowed so it
   * cannot stop restoration (already finished) or replace the primary.
   */
  report?: (outcome: StrandedReplacementCleanupOutcome) => Promise<void> | void
}

function unfinishedOutcome(category: string): StrandedReplacementCleanupOutcome {
  return {
    attempted: [],
    failures: [{ step: 'session', category }],
    absent: [],
    blocked: null,
    completed: false,
  }
}

/**
 * Guarded cleanup finalization. Steps run inside `enter` when provided
 * (so a sign-in failure is visible to this seam). The primary error is
 * rethrown last, after every feasible step and best-effort reporting.
 * Without a primary, a harness error is rethrown as itself and a step
 * failure/block throws StrandedReplacementCleanupError.
 */
export async function runStrandedReplacementCleanupGuarded(
  steps: StrandedReplacementCleanupSteps,
  options: StrandedReplacementCleanupGuardOptions = {},
): Promise<void> {
  const hasPrimary = options.hasPrimary ?? options.primary !== undefined
  let outcome: StrandedReplacementCleanupOutcome | undefined
  let harnessError: unknown
  const execute = async (): Promise<void> => {
    outcome = await runStrandedReplacementCleanup(steps)
    try {
      await options.report?.(outcome)
    } catch {
      // Evidence/checkpoint failure must not stop restoration or become
      // the error that replaces a primary (or a successful cleanup).
    }
    if (!hasPrimary && !outcome.completed) {
      throw new StrandedReplacementCleanupError(outcome)
    }
  }
  try {
    if (options.enter) await options.enter(execute)
    else await execute()
  } catch (error) {
    harnessError = error
  }
  if (hasPrimary) throw options.primary
  if (harnessError) throw harnessError
  if (!outcome || !outcome.completed) {
    throw new StrandedReplacementCleanupError(outcome ?? unfinishedOutcome('not-run'))
  }
}
