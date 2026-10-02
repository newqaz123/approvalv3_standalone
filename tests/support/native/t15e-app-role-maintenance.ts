/**
 * T15E app-role maintenance checkpoint (Task107).
 * Pure credential rendering and a cluster gate. No mint, no exported spawn
 * driver, and no production authority. A matching gate is not issuance.
 * SQL is for a future private stdin executor; this module does not spawn psql.
 */

export const T15E_APP_ROLE_SAFE_MESSAGE = 'T15E app role maintenance failure'
export const T15E_APP_ROLE_MAINTENANCE_OBLIGATIONS = [
  'NO_MINT_IN_THIS_SLICE',
  'NO_EXPORTED_DRIVER',
  'STDIN_NOT_ARGV',
  'NOT_AUTHENTICATED_ISSUANCE',
] as const

const SECRET_RE = /^[A-Za-z0-9_-]{24,128}$/
const ROLE_RE = /^t15e_app_[a-z0-9_]{1,40}$/
const SUPPORTED_PG_MAJORS = Object.freeze([15, 16])
const FORBIDDEN_PORTS = new Set([3100, 5432])

type FailureCategory =
  | 'T15E_APP_ROLE_MALFORMED'
  | 'T15E_APP_ROLE_CLUSTER_MISMATCH'
  | 'T15E_APP_ROLE_SERVER_VERSION'

type Failure = {
  ok: false
  category: FailureCategory
  message: string
  stdin: null
  argv: null
}

function fail(category: FailureCategory): Failure {
  return { ok: false, category, message: T15E_APP_ROLE_SAFE_MESSAGE, stdin: null, argv: null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isSupportedServerVersion(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 100000) return false
  return (SUPPORTED_PG_MAJORS as readonly number[]).includes(Math.floor(value / 10000))
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function redactT15EAppRoleSecret(text: unknown, secret: unknown): string {
  if (typeof text !== 'string' || typeof secret !== 'string' || !SECRET_RE.test(secret)) return T15E_APP_ROLE_SAFE_MESSAGE
  return text.split(secret).join('[REDACTED]')
}

export function renderT15EAppRoleCreateRoleSql(
  roleName: unknown,
  secret: unknown,
): { ok: true; sql: string } | Failure {
  if (typeof roleName !== 'string' || !ROLE_RE.test(roleName)) return fail('T15E_APP_ROLE_MALFORMED')
  if (typeof secret !== 'string' || !SECRET_RE.test(secret)) return fail('T15E_APP_ROLE_MALFORMED')
  return {
    ok: true,
    sql: `CREATE ROLE ${quoteIdent(roleName)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${secret}';`,
  }
}

function positivePid(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function parseEndpoint(value: unknown, requireVersion: boolean): {
  dataDirectory: string
  databasePort: number
  databaseName: string
  postmasterPid: number
  serverVersionNum?: number
} | Failure {
  if (!isRecord(value)) return fail('T15E_APP_ROLE_MALFORMED')
  const keys = requireVersion
    ? ['dataDirectory', 'databasePort', 'databaseName', 'postmasterPid', 'serverVersionNum']
    : ['dataDirectory', 'databasePort', 'databaseName', 'postmasterPid']
  if (!exactKeys(value, keys)) return fail('T15E_APP_ROLE_MALFORMED')
  if (typeof value.dataDirectory !== 'string' || !value.dataDirectory.startsWith('/') || value.dataDirectory.length > 4096) {
    return fail('T15E_APP_ROLE_MALFORMED')
  }
  if (typeof value.databasePort !== 'number' || !Number.isInteger(value.databasePort) || value.databasePort < 1 || value.databasePort > 65535) {
    return fail('T15E_APP_ROLE_MALFORMED')
  }
  if (FORBIDDEN_PORTS.has(value.databasePort)) return fail('T15E_APP_ROLE_MALFORMED')
  if (typeof value.databaseName !== 'string' || value.databaseName !== 'app_cleanstart_dev') return fail('T15E_APP_ROLE_MALFORMED')
  if (!positivePid(value.postmasterPid)) return fail('T15E_APP_ROLE_CLUSTER_MISMATCH')
  if (requireVersion && !isSupportedServerVersion(value.serverVersionNum)) return fail('T15E_APP_ROLE_SERVER_VERSION')
  return {
    dataDirectory: value.dataDirectory,
    databasePort: value.databasePort,
    databaseName: value.databaseName,
    postmasterPid: value.postmasterPid,
    serverVersionNum: requireVersion ? value.serverVersionNum as number : undefined,
  }
}

export function prepareT15EAppRoleMaintenance(input: unknown): Failure | {
  ok: true
  authority: 'NONE'
  argv: string[]
  stdin: string
  redactedStdin: string
} {
  if (!isRecord(input) || !exactKeys(input, ['roleName', 'secret', 'allocation', 'observed'])) return fail('T15E_APP_ROLE_MALFORMED')
  const rendered = renderT15EAppRoleCreateRoleSql(input.roleName, input.secret)
  if (!rendered.ok) return rendered
  const allocation = parseEndpoint(input.allocation, false)
  if (!('dataDirectory' in allocation)) return allocation
  const observed = parseEndpoint(input.observed, true)
  if (!('dataDirectory' in observed)) return observed
  if (
    observed.dataDirectory !== allocation.dataDirectory ||
    observed.databasePort !== allocation.databasePort ||
    observed.databaseName !== allocation.databaseName ||
    observed.postmasterPid !== allocation.postmasterPid
  ) {
    return fail('T15E_APP_ROLE_CLUSTER_MISMATCH')
  }
  const argv = [
    '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1',
    '-p', String(allocation.databasePort),
    '-U', 'postgres',
    '-d', allocation.databaseName,
  ]
  return {
    ok: true,
    authority: 'NONE',
    argv,
    stdin: rendered.sql,
    redactedStdin: redactT15EAppRoleSecret(rendered.sql, input.secret),
  }
}
