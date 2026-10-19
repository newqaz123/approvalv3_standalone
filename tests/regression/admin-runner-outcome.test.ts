import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  adminInterruptedRunOutcome,
  resolveAdminSecurityRunOutcome,
} from '../support/native/admin-security-run-outcome'
import type { DbEvidenceResult } from '../support/native/capture-admin-security-db-evidence'

/**
 * Regression (Astra admin-harness review, findings 3 and 6): the native
 * admin-security runner's SUCCESS decision must be a pure, unit-tested
 * contract.
 *
 *  (3) In full mode the DB evidence capture is MANDATORY durable
 *      non-mutation proof: a rejected/errored capture (null evidence) or a
 *      capture with failing checks MUST fail the whole run — the original
 *      runner treated null evidence as "no failures" and reported success
 *      while deleting the runtime.
 *  (6) An interrupted run (SIGINT/SIGTERM) must record an interrupted
 *      outcome and exit NONZERO even when cleanup succeeds — the original
 *      signal handler exited 0 after a successful cleanup, hiding that the
 *      security suite never completed.
 *
 * The decision inputs are exactly what the runner holds at decision time;
 * cleanup ALWAYS runs before the decision is applied (asserted here by
 * keeping cleanup failures as an input, not a precondition).
 */

function passingEvidence(): DbEvidenceResult {
  return {
    file: '/evidence/admin-security-db-evidence.json',
    checks: [
      { name: 'db-evidence/users/exact-set', status: 'pass', detail: 'ok' },
      { name: 'db-evidence/templates/template-guard', status: 'pass', detail: 'ok' },
    ],
    failures: [],
  }
}

function failingEvidence(): DbEvidenceResult {
  return {
    file: '/evidence/admin-security-db-evidence.json',
    checks: [
      { name: 'db-evidence/users/exact-set', status: 'pass', detail: 'ok' },
      { name: 'db-evidence/denial-targets/template-guard', status: 'fail', detail: 'flipped' },
    ],
    failures: ['db-evidence/denial-targets/template-guard: flipped'],
  }
}

describe('admin-security run outcome: mandatory DB evidence (full mode)', () => {
  it('passes only with captured evidence, zero failed checks, and zero cleanup failures', () => {
    const outcome = resolveAdminSecurityRunOutcome({
      mode: 'full',
      dbEvidence: passingEvidence(),
      dbCaptureError: null,
      cleanupFailures: [],
    })
    assert.equal(outcome.status, 'passed')
    assert.equal(outcome.exitCode, 0)
    assert.equal(outcome.error, null)
  })

  it('fails the whole run when the capture itself rejected (null evidence)', () => {
    const outcome = resolveAdminSecurityRunOutcome({
      mode: 'full',
      dbEvidence: null,
      dbCaptureError: 'psql: connection refused',
      cleanupFailures: [],
    })
    assert.equal(outcome.status, 'failed')
    assert.equal(outcome.exitCode, 1)
    assert.match(outcome.error ?? '', /psql: connection refused/)
    assert.match(outcome.error ?? '', /DB evidence/i)
  })

  it('fails the whole run when evidence is null with no recorded capture error', () => {
    const outcome = resolveAdminSecurityRunOutcome({
      mode: 'full',
      dbEvidence: null,
      dbCaptureError: null,
      cleanupFailures: [],
    })
    assert.equal(outcome.status, 'failed')
    assert.equal(outcome.exitCode, 1)
    assert.match(outcome.error ?? '', /DB evidence/i)
  })

  it('fails the whole run when captured evidence contains failed checks', () => {
    const outcome = resolveAdminSecurityRunOutcome({
      mode: 'full',
      dbEvidence: failingEvidence(),
      dbCaptureError: null,
      cleanupFailures: [],
    })
    assert.equal(outcome.status, 'failed')
    assert.equal(outcome.exitCode, 1)
    assert.match(outcome.error ?? '', /denial-targets\/template-guard/)
  })

  it('still fails (and reports) cleanup failures alongside good evidence — cleanup is not a pass gate bypass', () => {
    const outcome = resolveAdminSecurityRunOutcome({
      mode: 'full',
      dbEvidence: passingEvidence(),
      dbCaptureError: null,
      cleanupFailures: ['postgres stop failed'],
    })
    assert.equal(outcome.status, 'failed')
    assert.equal(outcome.exitCode, 1)
    assert.match(outcome.error ?? '', /postgres stop failed/)
  })
})

describe('admin-security run outcome: non-full modes', () => {
  it('prepare/lifecycle-smoke pass without DB evidence (no suite ran)', () => {
    for (const mode of ['prepare', 'lifecycle-smoke'] as const) {
      const outcome = resolveAdminSecurityRunOutcome({
        mode,
        dbEvidence: null,
        dbCaptureError: null,
        cleanupFailures: [],
      })
      assert.equal(outcome.status, 'passed', `${mode} must pass without DB evidence`)
      assert.equal(outcome.exitCode, 0)
    }
  })
})

describe('admin-security run outcome: interruption (finding 6)', () => {
  it('records an interrupted outcome with nonzero exit even after successful cleanup', () => {
    const outcome = adminInterruptedRunOutcome('SIGINT', [])
    assert.equal(outcome.status, 'interrupted')
    assert.equal(outcome.exitCode, 1)
    assert.match(outcome.error ?? '', /SIGINT/)
    assert.match(outcome.error ?? '', /interrupted/i)
  })

  it('records an interrupted outcome with nonzero exit when cleanup also failed', () => {
    const outcome = adminInterruptedRunOutcome('SIGTERM', ['app stop failed'])
    assert.equal(outcome.status, 'interrupted')
    assert.equal(outcome.exitCode, 1)
    assert.match(outcome.error ?? '', /SIGTERM/)
    assert.match(outcome.error ?? '', /app stop failed/)
  })
})
