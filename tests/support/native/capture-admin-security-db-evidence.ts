import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  createAdminSecurityFixture,
  expectedFinalTemplateStates,
  ADMIN_SECURITY_UNITS,
  ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES,
} from '../admin-security/admin-security-fixture'
import { psqlQuery, type OwnedRuntime } from './postgres-instance'

/**
 * Runner-owned, READ-ONLY durable DB evidence for the admin HTTP-security
 * suite (test-only). Mirrors capture-workflow-db-evidence.ts: runs in the
 * native runner process — the only layer allowed to touch the owned
 * database — AFTER the browser suite finishes and BEFORE cleanup drops the
 * owned PostgreSQL cluster. This is the durable non-mutation half of the
 * review requirement: HTTP status alone never proves "denied without
 * mutation"; the persisted rows do.
 *
 * Safety/scope contracts:
 *  - SELECT-only statements; no writes, no schema changes, no migrations;
 *  - fixture rows only (users/templates/requests of the admin-security
 *    fixture ids) — never a generic dump, never password hashes;
 *  - every check compares the actual persisted state against the documented
 *    expected final state (authorized controls ran exactly once; every
 *    unauthorized replay changed nothing). A failed check fails the run via
 *    the returned failures list — never silently dropped.
 */

export interface DbCheck {
  name: string
  status: 'pass' | 'fail'
  detail: string
}

export interface DbEvidenceResult {
  file: string
  checks: DbCheck[]
  failures: string[]
}

/**
 * Raw `psql -X -t -A -c` outputs exactly as shared `psqlQuery` returns them
 * (tests/support/native/postgres-instance.ts): tuples only, unaligned `|`
 * fields, newline-separated rows, empty string for zero rows. PostgreSQL
 * booleans render as `t`/`f` here — NEVER as `true`/`false`.
 */
export interface AdminSecurityDbRawRows {
  users: string
  membershipCount: string
  templates: string
  templateCount: string
  requestRow: string
  requestCount: string
}

/**
 * Normalize one psql cell: booleans `t`/`f` become `true`/`false` once, at
 * the parse boundary, so every comparison below works in one canonical form
 * (the original evaluator compared raw `t`/`f` cells against `true`/`false`
 * strings and necessarily rejected correct fixture state — Astra finding 1).
 */
function normalizeCell(value: string): string {
  const trimmed = value.trim()
  if (trimmed === 't') return 'true'
  if (trimmed === 'f') return 'false'
  return trimmed
}

function cell(rows: readonly string[], row = 0): string {
  return rows[row]?.trim() ?? ''
}

/**
 * PURE evaluator: turns raw psql rows into the documented final-state
 * checks. No I/O — unit-tested directly with psql-shaped rows
 * (tests/regression/admin-db-evidence-evaluator.test.ts), including passing
 * and failing cases.
 */
export function evaluateAdminSecurityDbEvidence(rows: AdminSecurityDbRawRows): DbCheck[] {
  const checks: DbCheck[] = []

  // ---- users: exact fixture population, roles, active flags -------------
  const usersById = new Map<string, string>()
  for (const line of rows.users ? rows.users.split('\n') : []) {
    const [id, role, isActive, forcePasswordChange] = line.split('|').map(normalizeCell)
    usersById.set(id, `${role}|${isActive}|${forcePasswordChange}`)
  }
  const expectedUsers = new Map<string, string>([
    // After the authorized controls: target was deactivated → reactivated and
    // password-reset (forcePasswordChange true); standby admin was
    // deactivated through the real UI; everyone else untouched. Denial
    // replays must not have altered a single flag.
    ['user-admin', 'admin|true|false'],
    ['user-admin-standby', 'admin|false|false'],
    ['user-engineering', 'engineering|true|false'],
    ['user-general', 'general_dept|true|false'],
    ['user-eng-member-general', 'general_dept|true|false'],
    ['user-target', 'general_dept|true|true'],
  ])
  checks.push({
    name: 'db-evidence/users/exact-set',
    status:
      usersById.size === expectedUsers.size && [...expectedUsers.keys()].every((id) => usersById.has(id))
        ? 'pass'
        : 'fail',
    detail: `user rows: ${[...usersById.keys()].sort().join(', ') || '(none)'}`,
  })
  for (const [id, expected] of expectedUsers) {
    const actual = usersById.get(id)
    checks.push({
      name: `db-evidence/users/${id}`,
      status: actual === expected ? 'pass' : 'fail',
      detail: `role|isActive|forcePasswordChange expected ${expected}, got ${actual ?? '(missing)'}`,
    })
  }

  // ---- engineering membership without engineering role stays intact ------
  checks.push({
    name: 'db-evidence/membership/eng-member-general-still-assigned',
    status: cell([rows.membershipCount]) === '1' ? 'pass' : 'fail',
    detail: `active engineering assignment rows: ${cell([rows.membershipCount]) || '(missing)'} (expected 1)`,
  })

  // ---- templates: documented post-control final state --------------------
  const templatesById = new Map<string, string>()
  for (const line of rows.templates ? rows.templates.split('\n') : []) {
    const [id, isActive, isDefault] = line.split('|').map(normalizeCell)
    templatesById.set(id, `${isActive}|${isDefault}`)
  }
  for (const expected of expectedFinalTemplateStates()) {
    const actual = templatesById.get(expected.id)
    const matches = expected.present
      ? actual === `${expected.isActive}|${expected.isDefault}`
      : actual === undefined
    checks.push({
      name: `db-evidence/templates/${expected.id}`,
      status: matches ? 'pass' : 'fail',
      detail: expected.present
        ? `isActive|isDefault expected ${expected.isActive}|${expected.isDefault}, got ${actual ?? '(missing)'}`
        : `row must be absent (authorized delete control removed it), got ${actual ?? '(absent)'}`,
    })
  }
  const expectedTemplateCount = expectedFinalTemplateStates().filter((t) => t.present).length
  checks.push({
    name: 'db-evidence/templates/exact-count',
    status: cell([rows.templateCount]) === String(expectedTemplateCount) ? 'pass' : 'fail',
    detail: `templates rows: ${cell([rows.templateCount]) || '(missing)'} (expected ${expectedTemplateCount} after the authorized delete)`,
  })

  // ---- archived guard request: survived every unauthorized API call ------
  const requestState = rows.requestRow.split('|').map(normalizeCell).join('|')
  checks.push({
    name: 'db-evidence/retention/guard-request-intact',
    status: requestState === 'true|false' ? 'pass' : 'fail',
    detail: `isArchived|isDeleted for ${createAdminSecurityFixture().request.id}: ${requestState || '(missing)'} (expected true|false — unauthorized backup/hard-delete must never mutate it)`,
  })
  checks.push({
    name: 'db-evidence/retention/exact-count',
    status: cell([rows.requestCount]) === '1' ? 'pass' : 'fail',
    detail: `requests rows: ${cell([rows.requestCount]) || '(missing)'} (expected exactly the fixture request)`,
  })

  // ---- denial targets never mutated (strongest non-mutation witness) -----
  // user-eng-member-general is the replay target of deactivateUser /
  // activateUser / resetUserPassword denials: it must still be active with
  // forcePasswordChange false (a broken guard flips these visibly).
  // template-guard is the replay target of setTemplateDefault /
  // deleteTemplate / getTemplate denials (monotonic mutations — always
  // visible in final state). user-admin-standby is the activateUser denial
  // target: a broken guard would have re-activated it (asserted above as
  // inactive).
  const guardTemplate = templatesById.get('template-guard')
  checks.push({
    name: 'db-evidence/denial-targets/user-eng-member-general',
    status: usersById.get('user-eng-member-general') === 'general_dept|true|false' ? 'pass' : 'fail',
    detail: `deactivate/activate/reset denial target flags: ${usersById.get('user-eng-member-general') ?? '(missing)'} (expected general_dept|true|false)`,
  })
  checks.push({
    name: 'db-evidence/denial-targets/template-guard',
    status: guardTemplate === 'true|false' ? 'pass' : 'fail',
    detail: `setDefault/delete denial target state: ${guardTemplate ?? '(missing)'} (expected true|false)`,
  })

  // ---- independent per-persona toggle witnesses (Astra finding 5) --------
  // toggleTemplateStatus is self-inverse: with a single shared target, four
  // unauthorized replays could flip it an even number of times and cancel
  // out. One dedicated witness template per persona makes EVERY unauthorized
  // flip individually visible in final state.
  for (const [persona, templateId] of Object.entries(ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES)) {
    const witness = templatesById.get(templateId)
    checks.push({
      name: `db-evidence/denial-targets/${templateId}`,
      status: witness === 'true|false' ? 'pass' : 'fail',
      detail: `${persona} toggleTemplateStatus witness: ${witness ?? '(missing)'} (expected true|false — this persona's denial replay flipped it)`,
    })
  }
  return checks
}

export async function captureAdminSecurityDbEvidence(
  runtime: OwnedRuntime,
  evidenceDir: string,
): Promise<DbEvidenceResult> {
  const fixture = createAdminSecurityFixture()
  const checks = evaluateAdminSecurityDbEvidence({
    users: await psqlQuery(
      runtime,
      'app_cleanstart_dev',
      'select id, role, "isActive", "forcePasswordChange" from users order by id',
    ),
    membershipCount: await psqlQuery(
      runtime,
      'app_cleanstart_dev',
      `select count(*) from organization_assignments where "userId" = 'user-eng-member-general' and "unitId" = '${ADMIN_SECURITY_UNITS.engineering}' and "isActive"`,
    ),
    templates: await psqlQuery(
      runtime,
      'app_cleanstart_dev',
      'select id, "isActive", "isDefault" from templates order by id',
    ),
    templateCount: await psqlQuery(runtime, 'app_cleanstart_dev', 'select count(*) from templates'),
    requestRow: await psqlQuery(
      runtime,
      'app_cleanstart_dev',
      `select "isArchived", "isDeleted" from requests where id = '${fixture.request.id}'`,
    ),
    requestCount: await psqlQuery(runtime, 'app_cleanstart_dev', 'select count(*) from requests'),
  })
  const file = path.join(evidenceDir, 'admin-security-db-evidence.json')
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        note: 'read-only psql capture of the owned disposable database, taken by the native runner before cleanup',
        fixture: fixture.id,
        checks,
      },
      null,
      2,
    ),
    'utf8',
  )
  return { file, checks, failures: checks.filter((c) => c.status === 'fail').map((c) => `${c.name}: ${c.detail}`) }
}
