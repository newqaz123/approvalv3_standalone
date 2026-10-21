import type { DbEvidenceResult } from './capture-admin-security-db-evidence'

/**
 * PURE success/interruption contract of the native admin-security runner
 * (test-only; unit-tested in tests/regression/admin-runner-outcome.test.ts).
 *
 * Extracted from run-native-admin-security-tests.ts because the Astra
 * admin-harness review found two decision bugs that a passing cleanup could
 * hide (findings 3 and 6):
 *
 *  (3) In full mode the DB evidence capture is MANDATORY durable
 *      non-mutation proof. A capture that rejected/errored (null evidence)
 *      or produced failed checks must fail the whole run — evidence absence
 *      is never "no failures".
 *  (6) An interrupted run (SIGINT/SIGTERM) must end interrupted/failed with
 *      a NONZERO exit code even when every owned resource stopped cleanly —
 *      the security suite did not complete.
 *
 * The runner always performs cleanup FIRST and then applies this decision,
 * so cleanup failures are an input here, never a reason to skip cleanup.
 */

export type AdminSecurityRunMode = 'lifecycle-smoke' | 'prepare' | 'full'

export interface AdminSecurityRunOutcome {
  status: 'passed' | 'failed' | 'interrupted'
  error: string | null
  exitCode: 0 | 1
}

export function resolveAdminSecurityRunOutcome(input: {
  mode: AdminSecurityRunMode
  dbEvidence: DbEvidenceResult | null
  dbCaptureError: string | null
  cleanupFailures: readonly string[]
}): AdminSecurityRunOutcome {
  const reasons: string[] = []

  if (input.mode === 'full') {
    if (input.dbEvidence === null) {
      reasons.push(
        input.dbCaptureError
          ? `admin-security DB evidence capture failed (mandatory in full mode): ${input.dbCaptureError}`
          : 'admin-security DB evidence is missing (mandatory in full mode: the capture did not run or returned nothing)'
      )
    } else if (input.dbEvidence.failures.length > 0) {
      reasons.push(
        `admin-security DB evidence checks failed (${input.dbEvidence.failures.length}): ${input.dbEvidence.failures.slice(0, 5).join(' | ')}`
      )
    }
  }

  if (input.cleanupFailures.length > 0) {
    reasons.push(`cleanup failures (${input.cleanupFailures.length}; runtime dir preserved): ${input.cleanupFailures.join(' | ')}`)
  }

  if (reasons.length === 0) return { status: 'passed', error: null, exitCode: 0 }
  return { status: 'failed', error: reasons.join('; '), exitCode: 1 }
}

export function adminInterruptedRunOutcome(
  signal: 'SIGINT' | 'SIGTERM',
  cleanupFailures: readonly string[],
): AdminSecurityRunOutcome {
  const reasons = [`run interrupted by ${signal}: the admin-security suite did NOT complete (no final summary of checks) — outcome is failed regardless of cleanup`]
  if (cleanupFailures.length > 0) {
    reasons.push(`cleanup failures (${cleanupFailures.length}; runtime dir preserved): ${cleanupFailures.join(' | ')}`)
  }
  return { status: 'interrupted', error: reasons.join('; '), exitCode: 1 }
}
