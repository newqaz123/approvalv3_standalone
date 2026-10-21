/**
 * T15E private maintenance prefix protocol (Task116) — FIRST SMALL PART of
 * corrected pure Slice A: canonical maintenance prefix + single-snapshot
 * framed readback SCRIPT DATA ONLY.
 *
 * Scope limits (honest): the full decoder is Task117; transport (executor
 * invocation), and issuer slices B1/B2 are separate. This module is PURE: no
 * spawn driver, no registry, no mint, no integration — the returned stdin is
 * ephemeral data for a future PRIVATE caller only. SQL generation is
 * source/pure tested; actual PostgreSQL validity is NOT claimed here.
 *
 * Canonical regeneration only: the plan (buildT15EAppRolePlan), the CREATE
 * utility renderer, and grants are regenerated internally from validated
 * inputs. Caller-supplied plan/query/SQL blobs and role OIDs are never
 * concatenated — extra input properties are rejected.
 *
 * Prefix structure: transaction BEGIN + canonical CREATE/grants + ONE
 * single-snapshot framed readback statement. NEVER COMMIT in the prefix —
 * commit/rollback tails are later reviewed slices; no rollback is promised
 * after ON_ERROR_STOP aborts the transaction.
 *
 * Frame grammar (for the Task117 decoder), fixed section order S1..S6:
 *   T15E_MAINT_S<n>_B\n<json-payload>\nT15E_MAINT_S<n>_E:<octets>\n
 * where <octets> is octet_length(convert_to(<payload>, 'UTF8')) computed over
 * the SAME materialized payload bytes the section emits (each payload is
 * materialized exactly once, in a MATERIALIZED CTE, and every section is
 * evaluated from one consistent statement snapshot). DDL and grants carry no
 * framed sections; the readback resolves the role BY NAME (never a caller
 * OID). PUBLIC/builtin EXECUTE is observed via grantee 0 (pg_catalog `now`),
 * not via the created role's OID. schemaCreate:false is a READBACK FACT for
 * the later full client validator; no new PUBLIC revocations are generated.
 */

import { buildT15EAppRolePlan } from './t15e-app-role-plan'
import { renderT15EAppRoleCreateRoleSql } from './t15e-app-role-maintenance'

export const T15E_MAINT_PROTOCOL_SAFE_MESSAGE = 'T15E maintenance prefix failure'
export const T15E_MAINT_PROTOCOL_OBLIGATIONS = [
  'NO_MINT_IN_THIS_SLICE',
  'NO_EXPORTED_DRIVER',
  'STDIN_NOT_ARGV',
  'NOT_AUTHENTICATED_ISSUANCE',
  'NO_COMMIT_IN_PREFIX',
] as const

export type T15EMaintenancePrefixFailureCategory =
  | 'T15E_MAINT_MALFORMED'
  | 'T15E_MAINT_PLAN_REJECTED'
  | 'T15E_MAINT_STDIN_OVERFLOW'

const SECRET_RE = /^[A-Za-z0-9_-]{24,128}$/
export const T15E_MAINT_MAX_STDIN_BYTES = 64 * 1024

/** Fixed readback section order (maps 1:1 onto the plan's six queries). */
export const T15E_MAINT_SECTION_ORDER = Object.freeze([
  'role_identity',
  'effective_privileges',
  'table_privileges',
  'sequence_privileges',
  'unpinned_accessible',
  'function_grants',
] as const)

/** Transport obligations for later slices (documented, NOT enforced here). */
export const T15E_MAINT_TRANSPORT_OBLIGATIONS = Object.freeze({
  maxSectionBytes: 64 * 1024,
  maxTotalStdoutBytes: 512 * 1024,
  maxStderrBytes: 4 * 1024,
})

export const T15E_MAINT_FRAME_GRAMMAR =
  'T15E_MAINT_S<n>_B\\n<json-payload>\\nT15E_MAINT_S<n>_E:<octets> for n=1..6 in fixed order, sections separated by EXACTLY ONE LF (no trailing LF embedded in any section: the last payload contributes no additional final LF); the psql record terminator contributes EXACTLY ONE terminal LF after S6_E:<octets>; <octets> = octet_length(convert_to(<payload>, \'UTF8\')) over the same materialized payload bytes'

type Failure = {
  ok: false
  authority: 'NONE'
  category: T15EMaintenancePrefixFailureCategory
  message: string
  stdin: null
}

function fail(category: T15EMaintenancePrefixFailureCategory): Failure {
  return { ok: false, authority: 'NONE', category, message: T15E_MAINT_PROTOCOL_SAFE_MESSAGE, stdin: null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

/**
 * Pure stdin bound check (64 KiB). A bound violation is a whole-script
 * failure — no fragment is ever returned.
 */
export function checkT15EMaintenanceStdinBound(byteLength: number): { ok: true } | { ok: false; category: 'T15E_MAINT_STDIN_OVERFLOW' } {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > T15E_MAINT_MAX_STDIN_BYTES) {
    return { ok: false, category: 'T15E_MAINT_STDIN_OVERFLOW' }
  }
  return { ok: true }
}

/** Strip one trailing statement terminator from a canonical query. */
function withoutTrailingSemicolon(sql: string): string {
  return sql.endsWith(';') ? sql.slice(0, -1) : sql
}

/**
 * Build the canonical maintenance prefix script. PURE: regenerates the plan,
 * CREATE statement, and grants from validated inputs; accepts no caller SQL,
 * plan blobs, queries, or role OIDs (extra properties are rejected).
 */
export function buildT15EMaintenancePrefix(input: unknown): Failure | {
  ok: true
  authority: 'NONE'
  stdin: string
  sectionOrder: readonly typeof T15E_MAINT_SECTION_ORDER[number][]
  frameGrammar: string
  transportObligations: typeof T15E_MAINT_TRANSPORT_OBLIGATIONS
} {
  if (!isRecord(input)) return fail('T15E_MAINT_MALFORMED')
  // Exact key shape FIRST, before ANY value is read: no getter runs on an
  // extra-key malformed input. Shape probing itself is contained — a proxy
  // whose ownKeys/getOwnPropertyDescriptor traps throw is a fixed malformed,
  // never a raw exception.
  let shapeOk: boolean
  try {
    shapeOk = exactKeys(input, ['roleName', 'secret', 'cluster', 'catalog'])
  } catch {
    return fail('T15E_MAINT_MALFORMED')
  }
  if (!shapeOk) return fail('T15E_MAINT_MALFORMED')
  // Snapshot EVERY caller property exactly once, before validation, inside a
  // contained try/catch: getters with side effects or divergent second reads
  // can never split the script (no B-create/A-grant incoherence), and a
  // THROWING getter is a fixed malformed — the raw throw is discarded, no
  // raw error or secret is retained or surfaced.
  let roleNameInput: unknown
  let secretInput: unknown
  let clusterInput: unknown
  let catalogInput: unknown
  try {
    roleNameInput = input.roleName
    secretInput = input.secret
    clusterInput = input.cluster
    catalogInput = input.catalog
  } catch {
    return fail('T15E_MAINT_MALFORMED')
  }
  if (typeof secretInput !== 'string' || !SECRET_RE.test(secretInput)) return fail('T15E_MAINT_MALFORMED')
  // The plan is regenerated internally; its own validators (roleName/cluster/
  // catalog shapes, no roleOid, PG 15/16 policy vocabulary) remain the source
  // of truth for those inputs.
  const plan = buildT15EAppRolePlan({ roleName: roleNameInput, cluster: clusterInput, catalog: catalogInput })
  if (!plan.ok) return fail('T15E_MAINT_PLAN_REJECTED')
  // CREATE uses the CANONICAL plan role name — never a re-read of the caller.
  const create = renderT15EAppRoleCreateRoleSql(plan.plan.roleName, secretInput)
  if (!create.ok) return fail('T15E_MAINT_MALFORMED')

  // Single-snapshot framed readback: each canonical query (by role NAME) is
  // materialized exactly once as a text payload CTE; the final select emits
  // marker + payload + trailer where the trailer measures the SAME material-
  // ized bytes. All six CTEs evaluate in one statement snapshot.
  const sections = plan.plan.readbackQueries.map((query, index) => {
    const alias = `s${index + 1}`
    const payloadCte = `${alias} as materialized (select row_to_json(q.*)::text as payload from (${withoutTrailingSemicolon(query.sql)}) q)`
    // Section skeleton: marker/LF/payload/LF/trailer with NO trailing LF —
    // the join below contributes exactly ONE LF between sections, and the
    // single terminal LF of the whole stream comes only from the psql record
    // terminator (the last embedded payload contributes no final LF).
    const framed = `'T15E_MAINT_S${index + 1}_B' || chr(10) || ${alias}.payload || chr(10) || 'T15E_MAINT_S${index + 1}_E:' || octet_length(convert_to(${alias}.payload, 'UTF8'))`
    return { payloadCte, framed }
  })
  const snapshotStatement =
    'with ' + sections.map((section) => section.payloadCte).join(',\n') + '\n' +
    'select ' + sections.map((section) => section.framed).join(' || chr(10) || ') + '\n' +
    'from ' + sections.map((_, index) => `s${index + 1}`).join(', ') + ';'

  // Prefix: BEGIN + canonical CREATE + canonical grants + framed readback.
  // NO COMMIT — the commit/rollback tails are later reviewed slices.
  const stdin = [
    'BEGIN;',
    create.sql,
    ...plan.plan.grantStatements,
    snapshotStatement,
  ].join('\n') + '\n'

  const bound = checkT15EMaintenanceStdinBound(Buffer.byteLength(stdin, 'utf8'))
  if (!bound.ok) return fail(bound.category)

  return {
    ok: true,
    authority: 'NONE',
    // stdin carries the secret and is EPHEMERAL data for a future PRIVATE
    // caller only; there is deliberately no redactedStdin field (diagnostics
    // never derive from the secret-bearing script).
    stdin,
    sectionOrder: T15E_MAINT_SECTION_ORDER,
    frameGrammar: T15E_MAINT_FRAME_GRAMMAR,
    transportObligations: T15E_MAINT_TRANSPORT_OBLIGATIONS,
  }
}
