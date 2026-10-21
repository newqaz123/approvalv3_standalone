// T15E app-role plan (Task104) — pure data. No mint, spawn, or live SQL.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as appRolePlan from '../support/native/t15e-app-role-plan'
import {
  T15E_APP_ROLE_CREDENTIAL_SLOT,
  T15E_APP_ROLE_SAFE_MESSAGE,
  buildT15EAppRolePlan,
  validateT15EAppRoleReadback,
} from '../support/native/t15e-app-role-plan'

const SECRET = 'super-secret-password-not-for-sql'
const ROLE = 't15e_app_run1'
const CLUSTER = {
  dataDirectory: '/tmp/owned-run/data',
  databasePort: 20111,
  databaseName: 'app_cleanstart_dev',
}
const CATALOG = {
  tables: [
    { schema: 'public', name: 'users' },
    { schema: 'public', name: 'requests' },
  ],
  sequences: [{ schema: 'public', name: 'requests_id_seq' }],
}
const FACT_FIELDS = [
  'roleName', 'roleOid', 'databaseName', 'databaseOid', 'dataDirectory', 'databasePort',
  'rolcanlogin', 'rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolinherit', 'membershipRoleOids',
  'databaseConnect', 'schemaUsage', 'schemaCreate', 'databaseTemp', 'publicBuiltinExecute',
  'tables', 'sequences', 'userDefinedFunctionGrants', 'unpinnedAccessible', 'serverVersionNum',
] as const

function planInput(overrides: Record<string, unknown> = {}) {
  return { roleName: ROLE, cluster: { ...CLUSTER }, catalog: CATALOG, ...overrides }
}

function facts(overrides: Record<string, unknown> = {}) {
  return {
    sqlOk: true,
    roleName: ROLE,
    roleOid: 4242,
    databaseName: CLUSTER.databaseName,
    databaseOid: 16384,
    dataDirectory: CLUSTER.dataDirectory,
    databasePort: CLUSTER.databasePort,
    serverVersionNum: 160001,
    rolcanlogin: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolinherit: false,
    membershipRoleOids: [] as number[],
    databaseConnect: true,
    schemaUsage: true,
    schemaCreate: false,
    databaseTemp: true,
    publicBuiltinExecute: true,
    tables: [
      { schema: 'public', name: 'requests', privileges: ['UPDATE', 'SELECT', 'INSERT', 'DELETE'] },
      { schema: 'public', name: 'users', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
    ],
    sequences: [{ schema: 'public', name: 'requests_id_seq', privileges: ['USAGE', 'SELECT'] }],
    userDefinedFunctionGrants: [] as string[],
    unpinnedAccessible: [] as Array<{ schema: string; name: string; relkind: string }>,
    ...overrides,
  }
}

function assertFail(
  result: { ok: boolean; category?: string; message?: string },
  category: string,
) {
  assert.equal(result.ok, false)
  assert.equal(result.category, category)
  assert.equal(result.message, T15E_APP_ROLE_SAFE_MESSAGE)
  assert.equal(JSON.stringify(result).includes(SECRET), false)
}

describe('T15E app-role plan exports no production authority', () => {
  it('exports only the data-only plan surface', () => {
    const keys = Object.keys(appRolePlan).sort()
    assert.deepEqual(keys, [
      'T15E_APP_ROLE_CREDENTIAL_SLOT',
      'T15E_APP_ROLE_PLAN_OBLIGATIONS',
      'T15E_APP_ROLE_SAFE_MESSAGE',
      'buildT15EAppRolePlan',
      'validateT15EAppRoleReadback',
    ])
    assert.equal(JSON.stringify(keys).toLowerCase().includes('mint'), false)
    assert.equal(JSON.stringify(keys).toLowerCase().includes('register'), false)
    assert.equal(JSON.stringify(keys).toLowerCase().includes('spawn'), false)
  })
})

describe('buildT15EAppRolePlan', () => {
  it('emits a non-executable createRole slot and quoted grants, not PASSWORD $1 SQL', () => {
    const built = buildT15EAppRolePlan(planInput())
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.equal(built.plan.stage, 'PLAN')
    assert.equal(built.plan.roleOid, null)
    assert.equal(built.plan.oidBinding, 'UNOBSERVED_UNTIL_READBACK')
    assert.equal(built.plan.createRole.executable, false)
    assert.equal(built.plan.createRole.credentialSlot, T15E_APP_ROLE_CREDENTIAL_SLOT)
    assert.equal('sql' in built.plan.createRole, false)
    const sql = built.plan.grantStatements.join('\n')
    assert.equal(sql.includes('CREATE ROLE'), false)
    assert.equal(sql.includes('PASSWORD'), false)
    assert.equal(sql.includes('$1'), false)
    assert.match(sql, /GRANT CONNECT ON DATABASE "app_cleanstart_dev" TO "t15e_app_run1";/)
    assert.match(sql, /GRANT USAGE ON SCHEMA "public" TO "t15e_app_run1";/)
    assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"\."requests" TO "t15e_app_run1";/)
    assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"\."users" TO "t15e_app_run1";/)
    assert.match(sql, /GRANT USAGE, SELECT ON SEQUENCE "public"\."requests_id_seq" TO "t15e_app_run1";/)
    assert.equal(sql.includes('GRANT ALL'), false)
    assert.equal(sql.includes('ALTER DEFAULT PRIVILEGES'), false)
    assert.equal(sql.includes('GRANT EXECUTE'), false)
    assert.equal(sql.includes('GRANT CREATE'), false)
    assert.equal(JSON.stringify(built).includes(SECRET), false)
    assert.equal(JSON.stringify(built).includes('PASSWORD $1'), false)
    assert.equal(built.plan.grantStatements.every((statement) => statement.endsWith(';') && !statement.slice(0, -1).includes(';')), true)
  })

  it('maps readback queries onto the fact shape without a membership-count claim', () => {
    const built = buildT15EAppRolePlan(planInput())
    assert.equal(built.ok, true)
    if (!built.ok) return
    const queries = built.plan.readbackQueries
    assert.equal(queries.every((query) => query.executedByThisModule === false && query.sourceContract === 'POSTGRESQL'), true)
    const mapped = queries.flatMap((query) => query.mapsTo)
    assert.deepEqual([...mapped].sort(), [...FACT_FIELDS].sort())
    const sql = queries.map((query) => query.sql).join('\n')
    assert.equal(sql.includes('count(*) from pg_auth_members'), false)
    assert.equal(sql.includes('json_agg(m.roleid order by m.roleid)'), true)
    assert.equal(sql.includes('has_database_privilege(r.oid, d.oid, \'CONNECT\') is true'), true)
    assert.equal(sql.includes('has_schema_privilege(r.oid, n.oid, \'USAGE\') is true'), true)
    assert.equal(sql.includes('has_table_privilege(r.oid, c.oid,'), true)
    assert.equal(sql.includes('has_sequence_privilege(r.oid, c.oid,'), true)
    assert.equal(sql.includes('has_function_privilege(r.oid, p.oid, \'EXECUTE\') is true'), true)
    assert.equal(sql.includes('has_function_privilege(0'), false)
    assert.equal(sql.includes('a.grantee = 0'), true)
    assert.equal(queries.every((query) => query.sql.endsWith(';') && !query.sql.slice(0, -1).includes(';')), true)
    const table = queries.find((query) => query.id === 'table_privileges')
    const sequence = queries.find((query) => query.id === 'sequence_privileges')
    const unpinned = queries.find((query) => query.id === 'unpinned_accessible')
    assert.equal(table !== undefined && sequence !== undefined && unpinned !== undefined, true)
    if (table === undefined || sequence === undefined || unpinned === undefined) return
    assert.equal(table.sql.includes("'TRUNCATE'"), true)
    assert.equal(table.sql.includes("'REFERENCES'"), true)
    assert.equal(table.sql.includes("'TRIGGER'"), true)
    assert.equal(table.sql.includes('MAINTAIN'), false)
    assert.equal(table.sql.includes("relkind = 'r'"), true)
    assert.equal(table.sql.includes('from (values'), false)
    assert.equal(table.sql.includes('> 64 then null'), true)
    assert.equal(sequence.sql.includes("'UPDATE'"), true)
    assert.equal(sequence.sql.includes('where false'), false)
    assert.equal(sequence.sql.includes("relkind = 'S'"), true)
    assert.equal(unpinned.sql.includes("relkind in ('v', 'm', 'p', 'f')"), true)
    assert.equal(unpinned.sql.includes('then null'), true)
    assert.equal(unpinned.sql.toLowerCase().includes('limit '), false)
    assert.deepEqual(built.plan.observation.supportedMajors, [15, 16])
  })

  it('rejects an unobserved role OID at plan time', () => {
    assertFail(buildT15EAppRolePlan(planInput({ roleOid: 4242 })), 'T15E_APP_ROLE_OID_UNBOUND')
  })

  it('rejects a password field before interpolation', () => {
    assertFail(buildT15EAppRolePlan(planInput({ password: SECRET })), 'T15E_APP_ROLE_MALFORMED')
  })

  it('rejects injected role and relation identifiers', () => {
    assertFail(buildT15EAppRolePlan(planInput({ roleName: `t15e_app_x'; DROP TABLE requests;--` })), 'T15E_APP_ROLE_MALFORMED')
    assertFail(
      buildT15EAppRolePlan(planInput({
        catalog: { tables: [{ schema: 'public', name: 'requests"; GRANT ALL ON TABLE requests TO public;--' }], sequences: [] },
      })),
      'T15E_APP_ROLE_CATALOG_INVALID',
    )
    assert.equal(JSON.stringify(buildT15EAppRolePlan(planInput({ roleName: SECRET }))).includes(SECRET), false)
  })

  it('rejects duplicate, foreign-schema, empty, and over-bound catalogs', () => {
    assertFail(
      buildT15EAppRolePlan(planInput({
        catalog: {
          tables: [{ schema: 'public', name: 'requests' }, { schema: 'public', name: 'requests' }],
          sequences: [],
        },
      })),
      'T15E_APP_ROLE_CATALOG_INVALID',
    )
    assertFail(
      buildT15EAppRolePlan(planInput({
        catalog: { tables: [{ schema: 'pg_catalog', name: 'pg_class' }], sequences: [] },
      })),
      'T15E_APP_ROLE_CATALOG_INVALID',
    )
    assertFail(buildT15EAppRolePlan(planInput({ catalog: { tables: [], sequences: [] } })), 'T15E_APP_ROLE_CATALOG_INVALID')
    const tables = Array.from({ length: 65 }, (_, index) => ({ schema: 'public', name: `table_${index}` }))
    assertFail(buildT15EAppRolePlan(planInput({ catalog: { tables, sequences: [] } })), 'T15E_APP_ROLE_CATALOG_INVALID')
  })

  it('rejects default and shared database ports as cluster expectations', () => {
    assertFail(buildT15EAppRolePlan(planInput({ cluster: { ...CLUSTER, databasePort: 5432 } })), 'T15E_APP_ROLE_MALFORMED')
    assertFail(buildT15EAppRolePlan(planInput({ cluster: { ...CLUSTER, databasePort: 3100 } })), 'T15E_APP_ROLE_MALFORMED')
  })
})

describe('validateT15EAppRoleReadback', () => {
  it('accepts matching observed facts, including allowed TEMP and builtin execute', () => {
    const built = buildT15EAppRolePlan(planInput())
    assert.equal(built.ok, true)
    if (!built.ok) return
    const checked = validateT15EAppRoleReadback(built, facts())
    assert.equal(checked.ok, true)
    if (!checked.ok) return
    assert.deepEqual(checked.identity, {
      roleName: ROLE,
      roleOid: 4242,
      databaseName: CLUSTER.databaseName,
      databaseOid: 16384,
    })
    assert.equal(JSON.stringify(checked).includes(SECRET), false)
    const tempFalse = validateT15EAppRoleReadback(built, facts({ databaseTemp: false, publicBuiltinExecute: false }))
    assert.equal(tempFalse.ok, true)
    const maxOid = validateT15EAppRoleReadback(built, facts({ roleOid: 4294967295, databaseOid: 1 }))
    assert.equal(maxOid.ok, true)
  })

  it('does not treat successful SQL alone as validation', () => {
    const built = buildT15EAppRolePlan(planInput())
    assert.equal(built.ok, true)
    if (!built.ok) return
    assertFail(validateT15EAppRoleReadback(built, { sqlOk: true }), 'T15E_APP_ROLE_SQL_STATUS_INSUFFICIENT')
    assertFail(validateT15EAppRoleReadback(built, facts({ sqlOk: false })), 'T15E_APP_ROLE_READBACK_ERROR')
  })

  it('requires effective CONNECT and USAGE and rejects impossible OIDs', () => {
    const built = buildT15EAppRolePlan(planInput())
    assert.equal(built.ok, true)
    if (!built.ok) return
    assertFail(validateT15EAppRoleReadback(built, facts({ databaseConnect: false })), 'T15E_APP_ROLE_GRANT_MISMATCH')
    assertFail(validateT15EAppRoleReadback(built, facts({ schemaUsage: false })), 'T15E_APP_ROLE_GRANT_MISMATCH')
    assertFail(validateT15EAppRoleReadback(built, facts({ databaseConnect: 'true' })), 'T15E_APP_ROLE_MALFORMED')
    const missing = facts()
    delete (missing as { databaseConnect?: boolean }).databaseConnect
    assertFail(validateT15EAppRoleReadback(built, missing), 'T15E_APP_ROLE_SQL_STATUS_INSUFFICIENT')
    assertFail(validateT15EAppRoleReadback(built, facts({ roleOid: 4294967296 })), 'T15E_APP_ROLE_OID_UNBOUND')
    assertFail(validateT15EAppRoleReadback(built, facts({ roleOid: Number.MAX_SAFE_INTEGER })), 'T15E_APP_ROLE_OID_UNBOUND')
    assertFail(validateT15EAppRoleReadback(built, facts({ databaseOid: 4294967296 })), 'T15E_APP_ROLE_OID_UNBOUND')
    assertFail(validateT15EAppRoleReadback(built, facts({ membershipRoleOids: [4294967296] })), 'T15E_APP_ROLE_OID_UNBOUND')
  })

  it('binds the role OID only from a consistent readback', () => {
    const built = buildT15EAppRolePlan(planInput())
    assert.equal(built.ok, true)
    if (!built.ok) return
    assertFail(validateT15EAppRoleReadback(built, facts({ roleOid: undefined })), 'T15E_APP_ROLE_OID_UNBOUND')
    assertFail(validateT15EAppRoleReadback(built, facts({ roleOid: '4242' })), 'T15E_APP_ROLE_OID_UNBOUND')
    assertFail(validateT15EAppRoleReadback(built, facts({ roleOid: 0 })), 'T15E_APP_ROLE_OID_UNBOUND')
    assertFail(validateT15EAppRoleReadback(built, facts({ roleName: 't15e_app_other' })), 'T15E_APP_ROLE_IDENTITY_MISMATCH')
    assertFail(validateT15EAppRoleReadback(built, facts({ databaseName: 'postgres' })), 'T15E_APP_ROLE_IDENTITY_MISMATCH')
    assertFail(validateT15EAppRoleReadback(built, facts({ dataDirectory: '/tmp/other' })), 'T15E_APP_ROLE_IDENTITY_MISMATCH')
  })

  it('keeps private grant policy after a returned plan is mutated', () => {
    const first = buildT15EAppRolePlan(planInput())
    assert.equal(first.ok, true)
    if (!first.ok) return
    const widened = facts({
      tables: [
        { schema: 'public', name: 'requests', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] },
        { schema: 'public', name: 'users', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] },
      ],
    })
    assert.throws(() => {
      (first.plan.expected.tablePrivileges as string[]).push('TRUNCATE')
    })
    assertFail(validateT15EAppRoleReadback(first, widened), 'T15E_APP_ROLE_GRANT_MISMATCH')
    const later = buildT15EAppRolePlan(planInput())
    assert.equal(later.ok, true)
    if (!later.ok) return
    assert.equal(later.plan.expected.tablePrivileges.includes('TRUNCATE'), false)
    assert.notEqual(first.plan.expected.tablePrivileges, later.plan.expected.tablePrivileges)
    assert.equal(validateT15EAppRoleReadback(later, facts()).ok, true)
  })

  it('fails closed on flags, memberships, schema CREATE, and grant drift', () => {
    const built = buildT15EAppRolePlan(planInput())
    assert.equal(built.ok, true)
    if (!built.ok) return
    assertFail(validateT15EAppRoleReadback(built, facts({ rolsuper: true })), 'T15E_APP_ROLE_FLAGS')
    assertFail(validateT15EAppRoleReadback(built, facts({ rolinherit: true })), 'T15E_APP_ROLE_FLAGS')
    assertFail(validateT15EAppRoleReadback(built, facts({ membershipRoleOids: [1] })), 'T15E_APP_ROLE_MEMBERSHIP')
    assertFail(validateT15EAppRoleReadback(built, facts({ schemaCreate: true })), 'T15E_APP_ROLE_SCHEMA_CREATE')
    assertFail(
      validateT15EAppRoleReadback(built, facts({
        tables: [{ schema: 'public', name: 'requests', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] }],
      })),
      'T15E_APP_ROLE_GRANT_MISMATCH',
    )
    assertFail(
      validateT15EAppRoleReadback(built, facts({
        tables: [
          { schema: 'public', name: 'requests', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] },
          { schema: 'public', name: 'users', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
        ],
      })),
      'T15E_APP_ROLE_GRANT_MISMATCH',
    )
    assertFail(
      validateT15EAppRoleReadback(built, facts({ userDefinedFunctionGrants: ['public.dangerous'] })),
      'T15E_APP_ROLE_GRANT_MISMATCH',
    )
  })

  it('rejects a forged plan whose grants or expected policy differ from the private policy', () => {
    const built = buildT15EAppRolePlan(planInput())
    assert.equal(built.ok, true)
    if (!built.ok) return
    const forgedGrants = {
      ok: true as const,
      plan: {
        ...built.plan,
        grantStatements: ['GRANT ALL ON TABLE "public"."requests" TO "t15e_app_run1";'],
      },
    }
    assertFail(validateT15EAppRoleReadback(forgedGrants, facts()), 'T15E_APP_ROLE_MALFORMED')
    const forgedExpected = {
      ok: true as const,
      plan: {
        ...built.plan,
        expected: {
          ...built.plan.expected,
          tablePrivileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'],
        },
      },
    }
    assertFail(validateT15EAppRoleReadback(forgedExpected, facts({
      tables: [
        { schema: 'public', name: 'requests', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] },
        { schema: 'public', name: 'users', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] },
      ],
    })), 'T15E_APP_ROLE_MALFORMED')
    const superuser = {
      ok: true as const,
      plan: {
        ...built.plan,
        createRole: {
          ...built.plan.createRole,
          attributes: { ...built.plan.createRole.attributes, superuser: true },
        },
      },
    }
    assertFail(validateT15EAppRoleReadback(superuser, facts()), 'T15E_APP_ROLE_MALFORMED')
    const renamed = {
      ok: true as const,
      plan: {
        ...built.plan,
        createRole: { ...built.plan.createRole, roleName: 't15e_app_other', kind: 'CREATE_ROLE' },
      },
    }
    assertFail(validateT15EAppRoleReadback(renamed, facts()), 'T15E_APP_ROLE_MALFORMED')
    const extra = {
      ok: true as const,
      plan: {
        ...built.plan,
        createRole: { ...built.plan.createRole, bypassrls: true },
      },
    }
    assertFail(validateT15EAppRoleReadback(extra, facts()), 'T15E_APP_ROLE_MALFORMED')
  })

  it('rejects a non-empty unpinned observation instead of treating overflow as empty', () => {
    const built = buildT15EAppRolePlan(planInput())
    assert.equal(built.ok, true)
    if (!built.ok) return
    assertFail(validateT15EAppRoleReadback(built, facts({
      unpinnedAccessible: [{ schema: 'public', name: 'other', relkind: 'r' }],
    })), 'T15E_APP_ROLE_GRANT_MISMATCH')
    assertFail(validateT15EAppRoleReadback(built, facts({ unpinnedAccessible: null })), 'T15E_APP_ROLE_MALFORMED')
  })

  it('requires an observed supported server_version_num and ignores image metadata', () => {
    const built = buildT15EAppRolePlan(planInput())
    assert.equal(built.ok, true)
    if (!built.ok) return
    const sql = built.plan.readbackQueries.map((query) => query.sql).join('\n')
    assert.equal(sql.includes("current_setting('server_version_num')::int"), true)
    assert.equal(JSON.stringify(built.plan.observation).includes('sourceImage'), false)
    assert.equal(JSON.stringify(built.plan.observation).includes('postgres:15-alpine'), false)
    assert.deepEqual(built.plan.observation.supportedMajors, [15, 16])
    const missing = facts()
    delete (missing as { serverVersionNum?: number }).serverVersionNum
    assertFail(validateT15EAppRoleReadback(built, missing), 'T15E_APP_ROLE_SERVER_VERSION')
    assert.equal(validateT15EAppRoleReadback(built, facts({ serverVersionNum: 150004 })).ok, true)
    assert.equal(validateT15EAppRoleReadback(built, facts({ serverVersionNum: 160001 })).ok, true)
    assertFail(validateT15EAppRoleReadback(built, facts({ serverVersionNum: 140000 })), 'T15E_APP_ROLE_SERVER_VERSION')
    assertFail(validateT15EAppRoleReadback(built, facts({ serverVersionNum: 170000 })), 'T15E_APP_ROLE_SERVER_VERSION')
    assertFail(validateT15EAppRoleReadback(built, facts({ serverVersionNum: '160001' })), 'T15E_APP_ROLE_SERVER_VERSION')
    assertFail(validateT15EAppRoleReadback(built, facts({ serverVersionNum: Number.POSITIVE_INFINITY })), 'T15E_APP_ROLE_SERVER_VERSION')
    assertFail(validateT15EAppRoleReadback(built, facts({ serverVersionNum: 16.1 })), 'T15E_APP_ROLE_SERVER_VERSION')
    const altered = {
      ok: true as const,
      plan: {
        ...built.plan,
        observation: { ...built.plan.observation, supportedMajors: [15] },
      },
    }
    assertFail(validateT15EAppRoleReadback(altered, facts({ serverVersionNum: 160001 })), 'T15E_APP_ROLE_MALFORMED')
  })
})
