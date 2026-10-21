/**
 * T15E maintenance readback schema validation (Task118B) — PURE six-section
 * exact-schema / full-readback composition over the reviewed modules
 * (frame decoder + bounded strict JSON + canonical plan + approved fact
 * validator). The reviewed modules are UNCHANGED; this is a new sibling.
 *
 * STATUS CONTRACT (prominent): the `sqlOk` input is a CALLER-SUPPLIED,
 * TEST-DOMAIN STATUS BOOLEAN. It is NEVER derived from frames, JSON, or
 * markers, and this pure export can NEVER mint production authority
 * (`authority: 'NONE'` on both outcomes). It is NOT production SQL-success
 * provenance and NOT a commit proof: a future PRIVATE transport must
 * independently establish SQL success before presenting status here.
 *
 * On any failure: no partial identity/facts are returned, and no raw wire
 * bytes, errors, or query payloads appear in results (fixed categories only).
 * On success: read-only, deep-frozen parsed facts + the validated identity —
 * data only.
 *
 * Boundary hygiene (mirrors the cleared Task116C contract): exact key shape
 * is rejected before ANY value read (no getter runs on extra-key input);
 * one-time captures are contained (throwing getters => fixed failure); the
 * canonical plan is regenerated internally — caller plans/SQL/OIDs are never
 * accepted. No universal hostile-JS authority promise is made.
 */

import { buildT15EAppRolePlan, validateT15EAppRoleReadback } from './t15e-app-role-plan'
import { parseT15EMaintenanceFrames } from './t15e-maintenance-frame-decoder'
import { parseT15EBoundedJson } from './t15e-maintenance-bounded-json'

export const T15E_MAINT_READBACK_SAFE_MESSAGE = 'T15E maintenance readback failure'

export type T15EMaintenanceReadbackFailureReason =
  | 'INPUT_INVALID'
  | 'SHAPE_INVALID'
  | 'SQL_STATUS_INVALID'
  | 'PLAN_REJECTED'
  | 'FRAMES_INVALID'
  | 'SECTION_JSON_INVALID'
  | 'SECTION_SCHEMA_INVALID'
  | 'VALIDATOR_REJECTED'

export type T15EMaintenanceReadbackFailure = {
  ok: false
  authority: 'NONE'
  category: 'T15E_MAINT_READBACK_INVALID' | string // propagated plan-validator categories keep their fixed vocabulary
  reason: T15EMaintenanceReadbackFailureReason
  message: string
  value: null
}

// Mirrors of the reviewed plan module's private vocabularies (not exported there).
const IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/
const TABLE_OBSERVED_PRIVILEGES = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
const SEQUENCE_OBSERVED_PRIVILEGES = new Set(['USAGE', 'SELECT', 'UPDATE'])
const RELKINDS = new Set(['r', 'S', 'v', 'm', 'p', 'f'])
const SUPPORTED_MAJORS = new Set([15, 16])
const MAX_PG_OID = 4294967295
const MAX_TABLES = 64
const MAX_SEQUENCES = 32
const MAX_UNPINNED = 32
const MAX_FUNCTIONS = 32
const MAX_MEMBERSHIP = 32
const MAX_STRING_BYTES = 4096

const fail = (reason: T15EMaintenanceReadbackFailureReason, category = 'T15E_MAINT_READBACK_INVALID'): T15EMaintenanceReadbackFailure => ({
  ok: false, authority: 'NONE', category, reason, message: T15E_MAINT_READBACK_SAFE_MESSAGE, value: null,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

const isPgOid = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_PG_OID

const isBoundedIdent = (value: unknown): value is string => typeof value === 'string' && IDENT_RE.test(value)

const isBoundedString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= MAX_STRING_BYTES

/** Relation privilege list bounded by the observed vocabulary, no duplicates. */
const privilegesWithin = (value: unknown, vocabulary: Set<string>): boolean => {
  if (!Array.isArray(value) || value.length === 0) return false
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || !vocabulary.has(item)) return false
    if (seen.has(item)) return false
    seen.add(item)
  }
  return true
}

/** Relations array bounded and schema-exact; duplicate relations rejected.
 * An EMPTY list is accepted ONLY when the canonical plan's catalog expects
 * zero relations for this kind (tables are never empty by plan contract;
 * sequences may be) — the approved validator still enforces exact grants. */
const relationsWithin = (value: unknown, bound: number, vocabulary: Set<string>, allowEmpty: boolean): boolean => {
  if (!Array.isArray(value) || value.length > bound) return false
  if (value.length === 0 && !allowEmpty) return false
  const seen = new Set<string>()
  for (const relation of value) {
    if (!isRecord(relation) || !exactKeys(relation, ['schema', 'name', 'privileges'])) return false
    if (relation.schema !== 'public' || !isBoundedIdent(relation.name)) return false
    if (!privilegesWithin(relation.privileges, vocabulary)) return false
    const key = `${relation.schema}.${relation.name}`
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

export function validateT15EMaintenanceReadback(input: unknown):
  | { ok: true; authority: 'NONE'; identity: { roleName: string; roleOid: number; databaseName: string; databaseOid: number }; facts: unknown }
  | T15EMaintenanceReadbackFailure {
  // The initial record probe is contained: exotic inputs whose internal
  // array check throws (e.g. a REVOKED proxy) are a fixed INPUT_INVALID —
  // never a raw exception.
  let isRecordInput: boolean
  try {
    isRecordInput = isRecord(input)
  } catch {
    return fail('INPUT_INVALID')
  }
  if (!isRecordInput) return fail('INPUT_INVALID')
  const record = input as Record<string, unknown>
  // Exact shape FIRST: no getter runs on an extra-key malformed input; the
  // shape probe itself is contained.
  let shapeOk: boolean
  try {
    shapeOk = exactKeys(record, ['roleName', 'cluster', 'catalog', 'frames', 'sqlOk'])
  } catch {
    return fail('SHAPE_INVALID')
  }
  if (!shapeOk) return fail('SHAPE_INVALID')
  // Contained one-time captures (throwing getters => fixed failure).
  let roleNameInput: unknown
  let clusterInput: unknown
  let catalogInput: unknown
  let framesInput: unknown
  let sqlOkInput: unknown
  try {
    roleNameInput = record.roleName
    clusterInput = record.cluster
    catalogInput = record.catalog
    framesInput = record.frames
    sqlOkInput = record.sqlOk
  } catch {
    return fail('INPUT_INVALID')
  }
  // EXPLICIT sqlOk true only — never derived from wire/JSON/markers. This is
  // caller-supplied test-domain status; a future private transport must
  // independently establish it. false/absent-equivalents/malformed => fixed.
  if (sqlOkInput !== true) return fail('SQL_STATUS_INVALID')
  // Canonical plan regenerated internally; caller plan/SQL/OIDs rejected.
  // Documented classification: ANY exception while the plan module evaluates
  // the (already captured) inputs — e.g. a nested throwing getter inside
  // cluster — is a fixed PLAN_REJECTED; the raw throw is discarded.
  let planResult
  try {
    planResult = buildT15EAppRolePlan({ roleName: roleNameInput, cluster: clusterInput, catalog: catalogInput })
  } catch {
    return fail('PLAN_REJECTED')
  }
  if (!planResult.ok) return fail('PLAN_REJECTED')
  const plan = planResult.plan

  const frames = parseT15EMaintenanceFrames(framesInput)
  if (!frames.ok) return fail('FRAMES_INVALID')
  const sectionObjects: Record<string, unknown>[] = []
  for (const section of frames.sections) {
    const parsed = parseT15EBoundedJson(section)
    if (!parsed.ok) return fail('SECTION_JSON_INVALID')
    if (!isRecord(parsed.value)) return fail('SECTION_SCHEMA_INVALID') // singleton OBJECT payload, not array
    sectionObjects.push(parsed.value)
  }
  const [identity, effective, tables, sequences, unpinned, functions] = sectionObjects

  // S1 role_identity: exact source aliases.
  if (!exactKeys(identity, ['role_name', 'role_oid', 'rolcanlogin', 'rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolinherit', 'membership_role_oids', 'database_name', 'database_oid', 'data_directory', 'database_port', 'server_version_num'])) {
    return fail('SECTION_SCHEMA_INVALID')
  }
  if (!isPgOid(identity.role_oid) || !isPgOid(identity.database_oid)) return fail('SECTION_SCHEMA_INVALID')
  for (const flag of ['rolcanlogin', 'rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolinherit']) {
    if (typeof identity[flag] !== 'boolean') return fail('SECTION_SCHEMA_INVALID')
  }
  if (!Array.isArray(identity.membership_role_oids) || identity.membership_role_oids.length > MAX_MEMBERSHIP) {
    return fail('SECTION_SCHEMA_INVALID')
  }
  if (identity.membership_role_oids.some((oid) => !isPgOid(oid))) return fail('SECTION_SCHEMA_INVALID')
  if (typeof identity.database_name !== 'string' || typeof identity.data_directory !== 'string') return fail('SECTION_SCHEMA_INVALID')
  const port = identity.database_port
  if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535 || port === 3100 || port === 5432) {
    return fail('SECTION_SCHEMA_INVALID')
  }
  const version = identity.server_version_num
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || !SUPPORTED_MAJORS.has(Math.floor(version / 10000))) {
    return fail('SECTION_SCHEMA_INVALID')
  }

  // S2 effective_privileges: exactly five strict booleans.
  if (!exactKeys(effective, ['database_connect', 'database_temp', 'schema_create', 'schema_usage', 'public_builtin_execute'])) {
    return fail('SECTION_SCHEMA_INVALID')
  }
  for (const key of ['database_connect', 'database_temp', 'schema_create', 'schema_usage', 'public_builtin_execute']) {
    if (typeof effective[key] !== 'boolean') return fail('SECTION_SCHEMA_INVALID')
  }

  // S3/S4 relation sections: the wire field is the canonical `relations`
  // alias (source-pinned: relationJson emits `end as relations`; the prefix
  // wraps whole rows), mapped onto facts.tables / facts.sequences below.
  if (!exactKeys(tables, ['relations']) || !relationsWithin(tables.relations, MAX_TABLES, TABLE_OBSERVED_PRIVILEGES, false)) {
    return fail('SECTION_SCHEMA_INVALID')
  }
  // Sequences may legitimately be empty at the schema layer: whether empty
  // is CORRECT is decided by the approved validator's exact-grants match
  // (expected-empty + observed-empty => ok; expected-nonempty + observed-
  // empty => GRANT_MISMATCH). Tables stay structurally nonempty above.
  if (!exactKeys(sequences, ['relations']) || !relationsWithin(sequences.relations, MAX_SEQUENCES, SEQUENCE_OBSERVED_PRIVILEGES, true)) {
    return fail('SECTION_SCHEMA_INVALID')
  }

  // S5 unpinned: exact single field, bounded, schema-exact entries. Null
  // overflow is never converted to empty; any nonempty list fails the
  // approved validator below.
  if (!exactKeys(unpinned, ['unpinned_accessible'])) return fail('SECTION_SCHEMA_INVALID')
  if (!Array.isArray(unpinned.unpinned_accessible) || unpinned.unpinned_accessible.length > MAX_UNPINNED) {
    return fail('SECTION_SCHEMA_INVALID')
  }
  for (const entry of unpinned.unpinned_accessible) {
    if (!isRecord(entry) || !exactKeys(entry, ['schema', 'name', 'relkind'])) return fail('SECTION_SCHEMA_INVALID')
    if (entry.schema !== 'public' || !isBoundedIdent(entry.name) || typeof entry.relkind !== 'string' || !RELKINDS.has(entry.relkind)) {
      return fail('SECTION_SCHEMA_INVALID')
    }
  }

  // S6 functions: exact single field, bounded nonempty-forbidden strings.
  if (!exactKeys(functions, ['user_defined_function_grants'])) return fail('SECTION_SCHEMA_INVALID')
  if (!Array.isArray(functions.user_defined_function_grants) || functions.user_defined_function_grants.length > MAX_FUNCTIONS) {
    return fail('SECTION_SCHEMA_INVALID')
  }
  if (functions.user_defined_function_grants.some((item) => !isBoundedString(item))) return fail('SECTION_SCHEMA_INVALID')

  // Map to the approved fact shape — role name/queries come from the
  // canonical plan inputs, never a caller role OID — then run the approved
  // full validator ONLY now that facts are complete and sqlOk is explicit.
  const facts = {
    sqlOk: true,
    roleName: identity.role_name,
    roleOid: identity.role_oid,
    databaseName: identity.database_name,
    databaseOid: identity.database_oid,
    dataDirectory: identity.data_directory,
    databasePort: port,
    rolcanlogin: identity.rolcanlogin,
    rolsuper: identity.rolsuper,
    rolcreatedb: identity.rolcreatedb,
    rolcreaterole: identity.rolcreaterole,
    rolinherit: identity.rolinherit,
    membershipRoleOids: identity.membership_role_oids,
    databaseConnect: effective.database_connect,
    schemaUsage: effective.schema_usage,
    schemaCreate: effective.schema_create,
    databaseTemp: effective.database_temp,
    publicBuiltinExecute: effective.public_builtin_execute,
    tables: tables.relations,
    sequences: sequences.relations,
    userDefinedFunctionGrants: functions.user_defined_function_grants,
    unpinnedAccessible: unpinned.unpinned_accessible,
    serverVersionNum: version,
  }
  const validated = validateT15EAppRoleReadback(planResult, facts)
  if (!validated.ok) return fail('VALIDATOR_REJECTED', validated.category)

  // Success: read-only deep-frozen facts view — data only, no mint.
  const deepFreeze = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) for (const item of value) deepFreeze(item)
    else for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key])
    Object.freeze(value)
  }
  deepFreeze(facts)

  // Freeze the validated identity before publish, matching the claimed
  // read-only data contract (facts are already deep-frozen above).
  Object.freeze(validated.identity)
  return { ok: true, authority: 'NONE', identity: validated.identity, facts }
}
