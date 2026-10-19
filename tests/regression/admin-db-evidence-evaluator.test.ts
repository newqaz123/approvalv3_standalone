import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES,
  expectedFinalTemplateStates,
} from '../support/admin-security/admin-security-fixture'
import {
  evaluateAdminSecurityDbEvidence,
  type AdminSecurityDbRawRows,
  type DbCheck,
} from '../support/native/capture-admin-security-db-evidence'

/**
 * Regression (Astra admin-harness review, finding 1): the runner-owned DB
 * evidence must be evaluated against REAL psql output. `psql -t -A` renders
 * PostgreSQL booleans as `t`/`f` — the original evaluator compared raw cells
 * against `admin|true|false`-style strings, so CORRECT fixture state failed
 * every user/template check (while the request check alone expected `t|f`).
 *
 * These tests feed the evaluator psql-shaped rows exactly as
 * `psqlQuery` (tests/support/native/postgres-instance.ts: -X -t -A) returns
 * them: tuples only, unaligned `|` fields, newline-separated rows, empty
 * string for zero rows. Passing and failing cases are both locked, so the
 * evaluator can neither reject correct state nor accept wrong state.
 */

function checksByName(checks: DbCheck[]): Map<string, DbCheck> {
  return new Map(checks.map((check) => [check.name, check]))
}

/**
 * The exact rows a healthy full-mode run must persist after the authorized
 * controls and every denial replay (booleans in psql `t`/`f` form).
 */
function psqlShapedPassingRows(): AdminSecurityDbRawRows {
  const users = [
    'user-admin|admin|t|f', // untouched primary admin
    'user-admin-standby|admin|f|f', // deactivated by the authorized control
    'user-engineering|engineering|t|f',
    'user-eng-member-general|general_dept|t|f', // denial replay target: untouched
    'user-general|general_dept|t|f',
    'user-target|general_dept|t|t', // reset password control: forcePasswordChange
  ]
  const templateRows: string[] = []
  for (const expected of expectedFinalTemplateStates()) {
    if (!expected.present) continue // template-delete row is gone
    templateRows.push(`${expected.id}|${expected.isActive ? 't' : 'f'}|${expected.isDefault ? 't' : 'f'}`)
  }
  return {
    users: users.join('\n'),
    membershipCount: '1',
    templates: templateRows.join('\n'),
    templateCount: String(expectedFinalTemplateStates().filter((t) => t.present).length),
    requestRow: 't|f', // archived, never deleted
    requestCount: '1',
  }
}

describe('admin-security DB evidence evaluator: psql boolean decoding', () => {
  it('accepts a healthy run whose rows use psql t/f boolean cells (the exact regression)', () => {
    const checks = evaluateAdminSecurityDbEvidence(psqlShapedPassingRows())
    const failures = checks.filter((check) => check.status === 'fail')
    assert.deepEqual(
      failures.map((f) => f.name),
      [],
      `expected every check to pass; failing: ${failures.map((f) => `${f.name} (${f.detail})`).join('; ')}`
    )
    // The previously-broken comparisons specifically: user flags and template
    // state decoded from t/f instead of compared against `true`/`false`.
    const byName = checksByName(checks)
    assert.equal(byName.get('db-evidence/users/user-target')?.status, 'pass')
    assert.equal(byName.get('db-evidence/templates/template-toggle')?.status, 'pass')
    assert.equal(byName.get('db-evidence/retention/guard-request-intact')?.status, 'pass')
    assert.equal(byName.get('db-evidence/denial-targets/template-guard')?.status, 'pass')
  })

  it('rejects a flipped user flag even when every boolean is in t/f form', () => {
    const rows = psqlShapedPassingRows()
    rows.users = rows.users.replace('user-target|general_dept|t|t', 'user-target|general_dept|f|t')
    const byName = checksByName(evaluateAdminSecurityDbEvidence(rows))
    assert.equal(byName.get('db-evidence/users/user-target')?.status, 'fail')
  })

  it('rejects a mutated denial-target template (isActive flipped back to t)', () => {
    const rows = psqlShapedPassingRows()
    rows.templates = rows.templates.replace('template-guard|t|f', 'template-guard|f|f')
    const byName = checksByName(evaluateAdminSecurityDbEvidence(rows))
    assert.equal(byName.get('db-evidence/templates/template-guard')?.status, 'fail')
    assert.equal(byName.get('db-evidence/denial-targets/template-guard')?.status, 'fail')
  })

  it('rejects a mutated archived guard request row', () => {
    const rows = psqlShapedPassingRows()
    rows.requestRow = 'f|f'
    const byName = checksByName(evaluateAdminSecurityDbEvidence(rows))
    assert.equal(byName.get('db-evidence/retention/guard-request-intact')?.status, 'fail')
  })

  it('rejects wrong table counts and extra/missing users', () => {
    const rows = psqlShapedPassingRows()
    rows.requestCount = '2'
    rows.templateCount = '99'
    rows.users = `${rows.users}\nuser-injected|admin|t|f`
    const byName = checksByName(evaluateAdminSecurityDbEvidence(rows))
    assert.equal(byName.get('db-evidence/retention/exact-count')?.status, 'fail')
    assert.equal(byName.get('db-evidence/templates/exact-count')?.status, 'fail')
    assert.equal(byName.get('db-evidence/users/exact-set')?.status, 'fail')
  })

  it('rejects empty query results (missing evidence), not silently passing', () => {
    const rows: AdminSecurityDbRawRows = {
      users: '',
      membershipCount: '',
      templates: '',
      templateCount: '',
      requestRow: '',
      requestCount: '',
    }
    const checks = evaluateAdminSecurityDbEvidence(rows)
    const failures = checks.filter((check) => check.status === 'fail')
    // The aggregate must fail, and every expected-present row must be
    // reported missing. (The template-delete absence check alone can pass
    // vacuously on an empty table; the exact-count check is what proves the
    // table was actually captured.)
    assert.ok(failures.length > 0, 'empty query results must fail the evidence')
    for (const name of [
      'db-evidence/users/exact-set',
      'db-evidence/membership/eng-member-general-still-assigned',
      'db-evidence/templates/exact-count',
      'db-evidence/templates/template-anchor',
      'db-evidence/retention/guard-request-intact',
      'db-evidence/retention/exact-count',
      'db-evidence/denial-targets/template-guard',
    ]) {
      assert.equal(
        checksByName(checks).get(name)?.status,
        'fail',
        `${name} must fail when its query returned nothing`
      )
    }
  })

  it('locks one independent toggle witness per unauthorized persona (Astra finding 5)', () => {
    const rows = psqlShapedPassingRows()
    const byName = checksByName(evaluateAdminSecurityDbEvidence(rows))
    for (const [persona, templateId] of Object.entries(ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES)) {
      assert.equal(
        byName.get(`db-evidence/denial-targets/${templateId}`)?.status,
        'pass',
        `${persona} witness ${templateId} must be evaluated`
      )
      // And flipping exactly one persona's witness must fail exactly that
      // witness check — repeated unauthorized toggles can no longer cancel.
      const flipped = psqlShapedPassingRows()
      flipped.templates = flipped.templates.replace(`${templateId}|t|f`, `${templateId}|f|f`)
      const flippedChecks = checksByName(evaluateAdminSecurityDbEvidence(flipped))
      assert.equal(flippedChecks.get(`db-evidence/denial-targets/${templateId}`)?.status, 'fail')
      assert.equal(flippedChecks.get(`db-evidence/templates/${templateId}`)?.status, 'fail')
    }
  })
})
