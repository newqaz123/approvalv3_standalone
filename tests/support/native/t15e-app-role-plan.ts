/**
 * T15E app-role plan and readback validator (Task104).
 * Data only: no mint, register, driver, or production role.
 * CREATE ROLE is a non-executable typed operation. Credential rendering is
 * out of scope. Readback SQL is a static PostgreSQL source contract, not a
 * live execution claim. NULL privilege results are not treated as true.
 * PUBLIC TEMP and built-in EXECUTE may remain allowed. That is not hardening.
 */

export const T15E_APP_ROLE_SAFE_MESSAGE = 'T15E app role plan failure'
export const T15E_APP_ROLE_CREDENTIAL_SLOT = 'T15E_APP_ROLE_CREDENTIAL'
export const T15E_APP_ROLE_PLAN_OBLIGATIONS = [
  'DATA_ONLY_NO_PRODUCTION_MINT',
  'NOT_AUTHENTICATED_ISSUANCE',
  'CREATE_ROLE_IS_NON_EXECUTABLE_OPERATION',
  'PUBLIC_TEMP_AND_BUILTIN_EXECUTE_ALLOWED_NOT_A_HARDENING_CLAIM',
] as const

const ROLE_RE = /^t15e_app_[a-z0-9_]{1,40}$/
const IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/
const MAX_TABLES = 64
const MAX_SEQUENCES = 32
const PG_OID_MAX = 4294967295
const FORBIDDEN_PORTS = new Set([3100, 5432])
const FORBIDDEN_DATABASES = new Set(['postgres', 'template0', 'template1'])
const TABLE_PRIVILEGES = Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
const SEQUENCE_PRIVILEGES = Object.freeze(['USAGE', 'SELECT'])
const ALLOWED_NOT_DENIED = Object.freeze(['DATABASE_TEMP', 'PUBLIC_BUILTIN_EXECUTE'])

export type T15EAppRoleFailureCategory =
  | 'T15E_APP_ROLE_MALFORMED'
  | 'T15E_APP_ROLE_CATALOG_INVALID'
  | 'T15E_APP_ROLE_OID_UNBOUND'
  | 'T15E_APP_ROLE_IDENTITY_MISMATCH'
  | 'T15E_APP_ROLE_FLAGS'
  | 'T15E_APP_ROLE_MEMBERSHIP'
  | 'T15E_APP_ROLE_SCHEMA_CREATE'
  | 'T15E_APP_ROLE_GRANT_MISMATCH'
  | 'T15E_APP_ROLE_READBACK_ERROR'
  | 'T15E_APP_ROLE_SQL_STATUS_INSUFFICIENT'
  | 'T15E_APP_ROLE_SERVER_VERSION'

type Failure = { ok: false; category: T15EAppRoleFailureCategory; message: string }
type Relation = { schema: 'public'; name: string }
type Catalog = { tables: Relation[]; sequences: Relation[] }
type Cluster = { dataDirectory: string; databasePort: number; databaseName: string }
type ReadbackQuery = {
  id: string
  sql: string
  sourceContract: 'POSTGRESQL'
  executedByThisModule: false
  rowContract: 'EXACTLY_ONE'
  nullPolicy: 'IS_TRUE_REJECTS_NULL' | 'JSON_NULL_IS_FAILURE_NOT_EMPTY'
  mapsTo: readonly string[]
}

const PLAN_KEYS = [
  'stage', 'roleOid', 'oidBinding', 'roleName', 'databaseName', 'dataDirectory', 'databasePort',
  'createRole', 'grantStatements', 'readbackQueries', 'catalog', 'expected', 'observation',
] as const
const TABLE_OBSERVED_PRIVILEGES = Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
const SEQUENCE_OBSERVED_PRIVILEGES = Object.freeze(['USAGE', 'SELECT', 'UPDATE'])
const SUPPORTED_PG_MAJORS = Object.freeze([15, 16])
const FACT_KEYS = [
  'sqlOk', 'roleName', 'roleOid', 'databaseName', 'databaseOid', 'dataDirectory', 'databasePort',
  'rolcanlogin', 'rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolinherit', 'membershipRoleOids',
  'databaseConnect', 'schemaUsage', 'schemaCreate', 'databaseTemp', 'publicBuiltinExecute',
  'tables', 'sequences', 'userDefinedFunctionGrants', 'unpinnedAccessible', 'serverVersionNum',
] as const

function fail(category: T15EAppRoleFailureCategory): Failure {
  return { ok: false, category, message: T15E_APP_ROLE_SAFE_MESSAGE }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function isPgOid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= PG_OID_MAX
}

function isSupportedServerVersion(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 100000) return false
  return (SUPPORTED_PG_MAJORS as readonly number[]).includes(Math.floor(value / 10000))
}

function validDirectory(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && value.length <= 4096 && !/[\0\n\r]/.test(value)
}

function parseRelations(value: unknown, kind: 'tables' | 'sequences'): Relation[] | Failure {
  if (!Array.isArray(value)) return fail('T15E_APP_ROLE_CATALOG_INVALID')
  const max = kind === 'tables' ? MAX_TABLES : MAX_SEQUENCES
  if (value.length > max || (kind === 'tables' && value.length === 0)) return fail('T15E_APP_ROLE_CATALOG_INVALID')
  const seen = new Set<string>()
  const relations: Relation[] = []
  for (const item of value) {
    if (!isRecord(item) || !exactKeys(item, ['schema', 'name'])) return fail('T15E_APP_ROLE_CATALOG_INVALID')
    if (item.schema !== 'public' || typeof item.name !== 'string' || !IDENT_RE.test(item.name)) {
      return fail('T15E_APP_ROLE_CATALOG_INVALID')
    }
    const key = `public.${item.name}`
    if (seen.has(key)) return fail('T15E_APP_ROLE_CATALOG_INVALID')
    seen.add(key)
    relations.push({ schema: 'public', name: item.name })
  }
  return relations
}

function parseCatalog(value: unknown): Catalog | Failure {
  if (!isRecord(value) || !exactKeys(value, ['tables', 'sequences'])) return fail('T15E_APP_ROLE_CATALOG_INVALID')
  const tables = parseRelations(value.tables, 'tables')
  if (!Array.isArray(tables)) return tables
  const sequences = parseRelations(value.sequences, 'sequences')
  if (!Array.isArray(sequences)) return sequences
  return { tables, sequences }
}

function parseCluster(value: unknown): Cluster | Failure {
  if (!isRecord(value) || !exactKeys(value, ['dataDirectory', 'databasePort', 'databaseName'])) {
    return fail('T15E_APP_ROLE_MALFORMED')
  }
  if (!validDirectory(value.dataDirectory)) return fail('T15E_APP_ROLE_MALFORMED')
  if (typeof value.databasePort !== 'number' || !Number.isInteger(value.databasePort) || value.databasePort < 1 || value.databasePort > 65535) {
    return fail('T15E_APP_ROLE_MALFORMED')
  }
  if (FORBIDDEN_PORTS.has(value.databasePort)) return fail('T15E_APP_ROLE_MALFORMED')
  if (typeof value.databaseName !== 'string' || !IDENT_RE.test(value.databaseName) || FORBIDDEN_DATABASES.has(value.databaseName)) {
    return fail('T15E_APP_ROLE_MALFORMED')
  }
  return {
    dataDirectory: value.dataDirectory,
    databasePort: value.databasePort,
    databaseName: value.databaseName,
  }
}

function sortedRelations(relations: readonly Relation[]): Relation[] {
  return [...relations].sort((left, right) => left.name.localeCompare(right.name))
}

function grantStatementsFor(roleName: string, databaseName: string, catalog: Catalog): string[] {
  const role = quoteIdent(roleName)
  const database = quoteIdent(databaseName)
  const statements = [
    `GRANT CONNECT ON DATABASE ${database} TO ${role};`,
    `GRANT USAGE ON SCHEMA "public" TO ${role};`,
  ]
  for (const table of sortedRelations(catalog.tables)) {
    statements.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public".${quoteIdent(table.name)} TO ${role};`)
  }
  for (const sequence of sortedRelations(catalog.sequences)) {
    statements.push(`GRANT USAGE, SELECT ON SEQUENCE "public".${quoteIdent(sequence.name)} TO ${role};`)
  }
  return statements
}

function valuesList(relations: readonly Relation[]): string {
  return sortedRelations(relations).map((relation) => `(${quoteLiteral(relation.name)})`).join(', ')
}

function query(
  id: string,
  nullPolicy: ReadbackQuery['nullPolicy'],
  mapsTo: readonly string[],
  sql: string,
): ReadbackQuery {
  return {
    id,
    sql,
    sourceContract: 'POSTGRESQL',
    executedByThisModule: false,
    rowContract: 'EXACTLY_ONE',
    nullPolicy,
    mapsTo,
  }
}

function grantedUnion(functionName: string, privileges: readonly string[]): string {
  return privileges.map((priv, index) => {
    const projection = index === 0 ? `'${priv}'::text as priv` : `'${priv}'::text`
    return `${index === 0 ? 'select' : 'union all select'} ${projection} where ${functionName}(r.oid, c.oid, '${priv}') is true`
  }).join(' ')
}

function anyGranted(functionName: string, privileges: readonly string[]): string {
  return privileges.map((priv) => `${functionName}(r.oid, c.oid, '${priv}') is true`).join(' or ')
}

function textArray(relations: readonly Relation[]): string {
  const items = sortedRelations(relations).map((relation) => quoteLiteral(relation.name))
  return items.length === 0 ? 'array[]::text[]' : `array[${items.join(', ')}]::text[]`
}

function relationJson(kind: 'r' | 'S', functionName: string, privileges: readonly string[], bound: number): string {
  return (
    `select case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = '${kind}') > ${bound} then null ` +
    `else coalesce((select json_agg(json_build_object('schema', 'public', 'name', c.relname, 'privileges', coalesce((select json_agg(s.priv order by s.priv) from (${grantedUnion(functionName, privileges)}) s), '[]'::json)) order by c.relname) ` +
    `from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = '${kind}'), '[]'::json) end as relations from pg_roles r where ${'ROLE_FILTER'};`
  )
}

function readbackQueriesFor(roleName: string, catalog: Catalog): ReadbackQuery[] {
  const roleLiteral = quoteLiteral(roleName)
  const roleFilter = `r.rolname = ${roleLiteral}`
  const tableSql = relationJson('r', 'has_table_privilege', TABLE_OBSERVED_PRIVILEGES, MAX_TABLES).replace('ROLE_FILTER', roleFilter)
  const sequenceSql = relationJson('S', 'has_sequence_privilege', SEQUENCE_OBSERVED_PRIVILEGES, MAX_SEQUENCES).replace('ROLE_FILTER', roleFilter)
  const unpinnedSql =
    'select case when count(*) > 32 then null else coalesce(json_agg(json_build_object(\'schema\', n.nspname, \'name\', c.relname, \'relkind\', c.relkind) order by c.relkind, c.relname), \'[]\'::json) end as unpinned_accessible ' +
    'from pg_class c join pg_namespace n on n.oid = c.relnamespace ' +
    `join pg_roles r on ${roleFilter} where n.nspname = 'public' and (` +
    `(c.relkind = 'r' and c.relname <> all (${textArray(catalog.tables)}) and (${anyGranted('has_table_privilege', TABLE_OBSERVED_PRIVILEGES)})) or ` +
    `(c.relkind = 'S' and c.relname <> all (${textArray(catalog.sequences)}) and (${anyGranted('has_sequence_privilege', SEQUENCE_OBSERVED_PRIVILEGES)})) or ` +
    `(c.relkind in ('v', 'm', 'p', 'f') and (${anyGranted('has_table_privilege', TABLE_OBSERVED_PRIVILEGES)})));`
  return [
    query('role_identity', 'IS_TRUE_REJECTS_NULL', [
      'roleName', 'roleOid', 'rolcanlogin', 'rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolinherit',
      'membershipRoleOids', 'databaseName', 'databaseOid', 'dataDirectory', 'databasePort', 'serverVersionNum',
    ], (
      'select r.rolname as role_name, r.oid as role_oid, r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolinherit, ' +
      'coalesce((select json_agg(m.roleid order by m.roleid) from pg_auth_members m where m.member = r.oid), \'[]\'::json) as membership_role_oids, ' +
      'd.datname as database_name, d.oid as database_oid, current_setting(\'data_directory\') as data_directory, ' +
      `current_setting('port')::integer as database_port, current_setting('server_version_num')::int as server_version_num from pg_roles r join pg_database d on d.datname = current_database() where ${roleFilter};`
    )),
    query('effective_privileges', 'IS_TRUE_REJECTS_NULL', [
      'databaseConnect', 'schemaUsage', 'schemaCreate', 'databaseTemp', 'publicBuiltinExecute',
    ], (
      'select (has_database_privilege(r.oid, d.oid, \'CONNECT\') is true) as database_connect, ' +
      '(has_database_privilege(r.oid, d.oid, \'TEMPORARY\') is true) as database_temp, ' +
      '(has_schema_privilege(r.oid, n.oid, \'CREATE\') is true) as schema_create, ' +
      '(has_schema_privilege(r.oid, n.oid, \'USAGE\') is true) as schema_usage, ' +
      '(exists (select 1 from pg_proc p join pg_namespace pn on pn.oid = p.pronamespace ' +
      'cross join lateral aclexplode(coalesce(p.proacl, acldefault(\'f\'::"char", p.proowner))) as a(grantor, grantee, privilege_type, is_grantable) ' +
      'where pn.nspname = \'pg_catalog\' and p.proname = \'now\' and a.grantee = 0 and a.privilege_type = \'EXECUTE\')) as public_builtin_execute ' +
      `from pg_roles r join pg_database d on d.datname = current_database() join pg_namespace n on n.nspname = 'public' where ${roleFilter};`
    )),
    query('table_privileges', 'JSON_NULL_IS_FAILURE_NOT_EMPTY', ['tables'], tableSql),
    query('sequence_privileges', 'JSON_NULL_IS_FAILURE_NOT_EMPTY', ['sequences'], sequenceSql),
    query('unpinned_accessible', 'JSON_NULL_IS_FAILURE_NOT_EMPTY', ['unpinnedAccessible'], unpinnedSql),
    query('function_grants', 'JSON_NULL_IS_FAILURE_NOT_EMPTY', ['userDefinedFunctionGrants'], (
      'select case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace ' +
      'where n.nspname not in (\'pg_catalog\', \'information_schema\') and has_function_privilege(r.oid, p.oid, \'EXECUTE\') is true) > 32 then null ' +
      'else coalesce((select json_agg(format(\'%I.%I\', n.nspname, p.proname) order by n.nspname, p.proname) from pg_proc p ' +
      'join pg_namespace n on n.oid = p.pronamespace where n.nspname not in (\'pg_catalog\', \'information_schema\') ' +
      'and has_function_privilege(r.oid, p.oid, \'EXECUTE\') is true), \'[]\'::json) end as user_defined_function_grants ' +
      `from pg_roles r where ${roleFilter};`
    )),
  ]
}

function expectedPolicy() {
  return {
    login: true as const,
    superuser: false as const,
    createdb: false as const,
    createrole: false as const,
    inherit: false as const,
    memberships: 'NONE' as const,
    schemaCreate: false as const,
    databaseConnect: true as const,
    schemaUsage: true as const,
    tablePrivileges: Object.freeze([...TABLE_PRIVILEGES]),
    sequencePrivileges: Object.freeze([...SEQUENCE_PRIVILEGES]),
    allowedNotDenied: Object.freeze([...ALLOWED_NOT_DENIED]),
  }
}

function sameStatements(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((statement, index) => statement === right[index])
}

function sameStringList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((item, index) => item === expected[index])
}

function samePrivilegeSet(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false
  if (!actual.every((item) => typeof item === 'string')) return false
  const seen = new Set(actual)
  return seen.size === expected.length && expected.every((item) => seen.has(item))
}

function relationMap(value: unknown): Map<string, unknown> | Failure {
  if (!Array.isArray(value)) return fail('T15E_APP_ROLE_GRANT_MISMATCH')
  const mapped = new Map<string, unknown>()
  for (const item of value) {
    if (!isRecord(item) || typeof item.schema !== 'string' || typeof item.name !== 'string') {
      return fail('T15E_APP_ROLE_GRANT_MISMATCH')
    }
    const key = `${item.schema}.${item.name}`
    if (mapped.has(key)) return fail('T15E_APP_ROLE_GRANT_MISMATCH')
    mapped.set(key, item.privileges)
  }
  return mapped
}

function grantsMatch(actual: unknown, expectedRelations: readonly Relation[], privileges: readonly string[]): boolean {
  const mapped = relationMap(actual)
  if (mapped instanceof Map === false) return false
  if (mapped.size !== expectedRelations.length) return false
  return expectedRelations.every((relation) => samePrivilegeSet(mapped.get(`public.${relation.name}`), privileges))
}

function policyMatches(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, [
    'login', 'superuser', 'createdb', 'createrole', 'inherit', 'memberships', 'schemaCreate',
    'databaseConnect', 'schemaUsage', 'tablePrivileges', 'sequencePrivileges', 'allowedNotDenied',
  ])) return false
  return value.login === true && value.superuser === false && value.createdb === false &&
    value.createrole === false && value.inherit === false && value.memberships === 'NONE' &&
    value.schemaCreate === false && value.databaseConnect === true && value.schemaUsage === true &&
    sameStringList(value.tablePrivileges, TABLE_PRIVILEGES) &&
    sameStringList(value.sequencePrivileges, SEQUENCE_PRIVILEGES) &&
    sameStringList(value.allowedNotDenied, ALLOWED_NOT_DENIED)
}

export function buildT15EAppRolePlan(input: unknown): { ok: true; plan: ReturnType<typeof assemblePlan> } | Failure {
  const parsed = parsePlanInput(input)
  if (!('roleName' in parsed)) return parsed
  return { ok: true, plan: deepFreeze(assemblePlan(parsed.roleName, parsed.cluster, parsed.catalog)) }
}

function parsePlanInput(input: unknown): { roleName: string; cluster: Cluster; catalog: Catalog } | Failure {
  if (!isRecord(input)) return fail('T15E_APP_ROLE_MALFORMED')
  if ('roleOid' in input) return fail('T15E_APP_ROLE_OID_UNBOUND')
  if (!exactKeys(input, ['roleName', 'cluster', 'catalog'])) return fail('T15E_APP_ROLE_MALFORMED')
  if (typeof input.roleName !== 'string' || !ROLE_RE.test(input.roleName)) return fail('T15E_APP_ROLE_MALFORMED')
  const cluster = parseCluster(input.cluster)
  if (!('databaseName' in cluster)) return cluster
  const catalog = parseCatalog(input.catalog)
  if (!('tables' in catalog)) return catalog
  return { roleName: input.roleName, cluster, catalog }
}

function assemblePlan(roleName: string, cluster: Cluster, catalog: Catalog) {
  return {
    stage: 'PLAN' as const,
    roleOid: null,
    oidBinding: 'UNOBSERVED_UNTIL_READBACK' as const,
    roleName,
    databaseName: cluster.databaseName,
    dataDirectory: cluster.dataDirectory,
    databasePort: cluster.databasePort,
    createRole: {
      kind: 'CREATE_ROLE' as const,
      executable: false as const,
      roleName,
      credentialSlot: T15E_APP_ROLE_CREDENTIAL_SLOT,
      attributes: {
        login: true as const,
        superuser: false as const,
        createdb: false as const,
        createrole: false as const,
        inherit: false as const,
      },
    },
    grantStatements: grantStatementsFor(roleName, cluster.databaseName, catalog),
    readbackQueries: readbackQueriesFor(roleName, catalog),
    catalog,
    expected: expectedPolicy(),
    observation: {
      versionPolicy: 'DECLARED_COMPATIBILITY_NOT_OBSERVED_IDENTITY' as const,
      supportedMajors: Object.freeze([...SUPPORTED_PG_MAJORS]),
      privilegeVocabulary: 'TABLE7_SEQUENCE3' as const,
      maintainPrivilege: 'NOT_QUERIED_REJECT_17_PLUS' as const,
      catalogScope: Object.freeze(['r', 'S']),
      unsupportedFailClosed: Object.freeze(['v', 'm', 'p', 'f']),
    },
  }
}

function createRoleMatches(value: unknown, roleName: string): boolean {
  if (!isRecord(value) || !exactKeys(value, ['kind', 'executable', 'roleName', 'credentialSlot', 'attributes'])) return false
  if (value.kind !== 'CREATE_ROLE' || value.executable !== false || value.roleName !== roleName) return false
  if (value.credentialSlot !== T15E_APP_ROLE_CREDENTIAL_SLOT || 'sql' in value) return false
  if (!isRecord(value.attributes) || !exactKeys(value.attributes, ['login', 'superuser', 'createdb', 'createrole', 'inherit'])) return false
  return value.attributes.login === true && value.attributes.superuser === false &&
    value.attributes.createdb === false && value.attributes.createrole === false && value.attributes.inherit === false
}

function decodePlan(planResult: unknown): ReturnType<typeof assemblePlan> | Failure {
  if (!isRecord(planResult) || planResult.ok !== true || !isRecord(planResult.plan)) return fail('T15E_APP_ROLE_MALFORMED')
  if (!exactKeys(planResult, ['ok', 'plan'])) return fail('T15E_APP_ROLE_MALFORMED')
  const plan = planResult.plan
  if (!exactKeys(plan, PLAN_KEYS)) return fail('T15E_APP_ROLE_MALFORMED')
  if (plan.stage !== 'PLAN' || plan.roleOid !== null || plan.oidBinding !== 'UNOBSERVED_UNTIL_READBACK') {
    return fail('T15E_APP_ROLE_MALFORMED')
  }
  if (!createRoleMatches(plan.createRole, typeof plan.roleName === 'string' ? plan.roleName : '')) {
    return fail('T15E_APP_ROLE_MALFORMED')
  }
  if (JSON.stringify(plan.createRole).includes('PASSWORD')) return fail('T15E_APP_ROLE_MALFORMED')
  if (typeof plan.roleName !== 'string' || !ROLE_RE.test(plan.roleName)) return fail('T15E_APP_ROLE_MALFORMED')
  const cluster = parseCluster({
    dataDirectory: plan.dataDirectory,
    databasePort: plan.databasePort,
    databaseName: plan.databaseName,
  })
  if (!('databaseName' in cluster)) return cluster
  const catalog = parseCatalog(plan.catalog)
  if (!('tables' in catalog)) return catalog
  if (!policyMatches(plan.expected)) return fail('T15E_APP_ROLE_MALFORMED')
  if (!Array.isArray(plan.grantStatements) || !plan.grantStatements.every((item) => typeof item === 'string')) {
    return fail('T15E_APP_ROLE_MALFORMED')
  }
  const rebuilt = assemblePlan(plan.roleName, cluster, catalog)
  if (!sameStatements(plan.grantStatements, rebuilt.grantStatements)) return fail('T15E_APP_ROLE_MALFORMED')
  if (JSON.stringify(plan.readbackQueries) !== JSON.stringify(rebuilt.readbackQueries)) return fail('T15E_APP_ROLE_MALFORMED')
  if (JSON.stringify(plan.observation) !== JSON.stringify(rebuilt.observation)) return fail('T15E_APP_ROLE_MALFORMED')
  return rebuilt
}

export function validateT15EAppRoleReadback(
  planResult: unknown,
  facts: unknown,
): { ok: true; identity: { roleName: string; roleOid: number; databaseName: string; databaseOid: number } } | Failure {
  const plan = decodePlan(planResult)
  if (!('stage' in plan)) return plan
  if (!isRecord(facts)) return fail('T15E_APP_ROLE_MALFORMED')
  if (facts.sqlOk === false) return fail('T15E_APP_ROLE_READBACK_ERROR')
  if (facts.sqlOk !== true) return fail('T15E_APP_ROLE_MALFORMED')
  const versionReady = FACT_KEYS.filter((key) => key !== 'sqlOk' && key !== 'serverVersionNum').every((key) => key in facts)
  if (versionReady || 'serverVersionNum' in facts) {
    if (!isSupportedServerVersion(facts.serverVersionNum)) return fail('T15E_APP_ROLE_SERVER_VERSION')
  }
  if (FACT_KEYS.some((key) => !(key in facts))) return fail('T15E_APP_ROLE_SQL_STATUS_INSUFFICIENT')
  if (!exactKeys(facts, FACT_KEYS)) return fail('T15E_APP_ROLE_MALFORMED')
  if (!isPgOid(facts.roleOid) || !isPgOid(facts.databaseOid)) return fail('T15E_APP_ROLE_OID_UNBOUND')
  if (
    facts.roleName !== plan.roleName ||
    facts.databaseName !== plan.databaseName ||
    facts.dataDirectory !== plan.dataDirectory ||
    facts.databasePort !== plan.databasePort
  ) {
    return fail('T15E_APP_ROLE_IDENTITY_MISMATCH')
  }
  if (
    facts.rolcanlogin !== true ||
    facts.rolsuper !== false ||
    facts.rolcreatedb !== false ||
    facts.rolcreaterole !== false ||
    facts.rolinherit !== false
  ) {
    return fail('T15E_APP_ROLE_FLAGS')
  }
  if (!Array.isArray(facts.membershipRoleOids)) return fail('T15E_APP_ROLE_MALFORMED')
  if (facts.membershipRoleOids.some((oid) => !isPgOid(oid))) return fail('T15E_APP_ROLE_OID_UNBOUND')
  if (facts.membershipRoleOids.length !== 0) return fail('T15E_APP_ROLE_MEMBERSHIP')
  if (typeof facts.schemaCreate !== 'boolean') return fail('T15E_APP_ROLE_MALFORMED')
  if (facts.schemaCreate !== false) return fail('T15E_APP_ROLE_SCHEMA_CREATE')
  if (typeof facts.databaseConnect !== 'boolean' || typeof facts.schemaUsage !== 'boolean') {
    return fail('T15E_APP_ROLE_MALFORMED')
  }
  if (facts.databaseConnect !== true || facts.schemaUsage !== true) return fail('T15E_APP_ROLE_GRANT_MISMATCH')
  if (typeof facts.databaseTemp !== 'boolean' || typeof facts.publicBuiltinExecute !== 'boolean') {
    return fail('T15E_APP_ROLE_MALFORMED')
  }
  if (!Array.isArray(facts.userDefinedFunctionGrants) || facts.userDefinedFunctionGrants.some((item) => typeof item !== 'string')) {
    return fail('T15E_APP_ROLE_MALFORMED')
  }
  if (!Array.isArray(facts.unpinnedAccessible)) return fail('T15E_APP_ROLE_MALFORMED')
  if (
    facts.unpinnedAccessible.length !== 0 ||
    facts.userDefinedFunctionGrants.length !== 0 ||
    !grantsMatch(facts.tables, plan.catalog.tables, TABLE_PRIVILEGES) ||
    !grantsMatch(facts.sequences, plan.catalog.sequences, SEQUENCE_PRIVILEGES)
  ) {
    return fail('T15E_APP_ROLE_GRANT_MISMATCH')
  }
  return {
    ok: true,
    identity: {
      roleName: plan.roleName,
      roleOid: facts.roleOid,
      databaseName: plan.databaseName,
      databaseOid: facts.databaseOid,
    },
  }
}
