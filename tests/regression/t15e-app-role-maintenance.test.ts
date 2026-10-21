// T15E app-role maintenance (Task107) — fake process only. No mint, psql, or live DB.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateDatabasePassword } from '../support/native/native-environment'
import { buildT15EAppRolePlan } from '../support/native/t15e-app-role-plan'
import * as maintenance from '../support/native/t15e-app-role-maintenance'
import {
  T15E_APP_ROLE_SAFE_MESSAGE,
  prepareT15EAppRoleMaintenance,
  redactT15EAppRoleSecret,
  renderT15EAppRoleCreateRoleSql,
} from '../support/native/t15e-app-role-maintenance'

const SECRET = 'Abcdefghijklmnop-qrstuv_1234'
const ROLE = 't15e_app_run1'
const ALLOCATION = {
  dataDirectory: '/tmp/owned-run/data',
  databasePort: 20111,
  databaseName: 'app_cleanstart_dev',
  postmasterPid: 4242,
}
const OBSERVED = {
  ...ALLOCATION,
  serverVersionNum: 160001,
}

function input(overrides: Record<string, unknown> = {}) {
  return { roleName: ROLE, secret: SECRET, allocation: ALLOCATION, observed: OBSERVED, ...overrides }
}

function assertFail(result: { ok: boolean; category?: string; message?: string; stdin?: string | null }, category: string) {
  assert.equal(result.ok, false)
  assert.equal(result.category, category)
  assert.equal(result.message, T15E_APP_ROLE_SAFE_MESSAGE)
  assert.equal(result.stdin, null)
  assert.equal(JSON.stringify(result).includes(SECRET), false)
}

describe('T15E app-role maintenance exports no issuer', () => {
  it('has no mint, register, driver, or spawn export', () => {
    const keys = Object.keys(maintenance).sort()
    assert.deepEqual(keys, [
      'T15E_APP_ROLE_MAINTENANCE_OBLIGATIONS',
      'T15E_APP_ROLE_SAFE_MESSAGE',
      'prepareT15EAppRoleMaintenance',
      'redactT15EAppRoleSecret',
      'renderT15EAppRoleCreateRoleSql',
    ])
    const source = readFileSync(new URL('../support/native/t15e-app-role-maintenance.ts', import.meta.url), 'utf8')
    assert.equal(source.includes('export function mint'), false)
    assert.equal(source.includes('export function register'), false)
    assert.equal(source.includes('psqlQuery'), false)
    assert.equal(source.includes("'-c'"), false)
    assert.equal(source.includes('t15eMintedCapabilities'), false)
  })
})

describe('renderT15EAppRoleCreateRoleSql', () => {
  it('renders utility grammar for a canonical generated secret and rejects unsafe text', () => {
    const generated = generateDatabasePassword()
    const rendered = renderT15EAppRoleCreateRoleSql(ROLE, generated)
    assert.equal(rendered.ok, true)
    if (!rendered.ok) return
    assert.equal(rendered.sql, `CREATE ROLE "t15e_app_run1" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${generated}';`)
    assert.equal(rendered.sql.includes('$1'), false)
    assertFail(renderT15EAppRoleCreateRoleSql(`t15e_app_x'; DROP ROLE x;--`, SECRET), 'T15E_APP_ROLE_MALFORMED')
    assertFail(renderT15EAppRoleCreateRoleSql(ROLE, `${SECRET}'`), 'T15E_APP_ROLE_MALFORMED')
    assertFail(renderT15EAppRoleCreateRoleSql(ROLE, 'short'), 'T15E_APP_ROLE_MALFORMED')
  })
})

describe('prepareT15EAppRoleMaintenance', () => {
  it('puts the secret on stdin only and never in argv', async () => {
    const prepared = prepareT15EAppRoleMaintenance(input())
    assert.equal(prepared.ok, true)
    if (!prepared.ok) return
    assert.equal(prepared.authority, 'NONE')
    assert.equal(prepared.argv.includes('-c'), false)
    assert.equal(prepared.argv.join(' ').includes(SECRET), false)
    assert.equal(prepared.stdin.includes(`PASSWORD '${SECRET}'`), true)
    assert.equal(prepared.redactedStdin.includes(SECRET), false)
    const echoed = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (chunk) => { out += String(chunk) })
      child.on('error', reject)
      child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`fake process exit ${code}`)))
      child.stdin.end(prepared.stdin)
    })
    assert.equal(echoed, prepared.stdin)
    assert.equal(JSON.stringify(prepared.argv).includes(SECRET), false)
  })

  it('refuses DDL when the observed cluster does not match the allocation', () => {
    assertFail(prepareT15EAppRoleMaintenance(input({ observed: { ...OBSERVED, dataDirectory: '/tmp/other' } })), 'T15E_APP_ROLE_CLUSTER_MISMATCH')
    assertFail(prepareT15EAppRoleMaintenance(input({ observed: { ...OBSERVED, postmasterPid: null } })), 'T15E_APP_ROLE_CLUSTER_MISMATCH')
    assertFail(prepareT15EAppRoleMaintenance(input({ observed: { ...OBSERVED, serverVersionNum: 170000 } })), 'T15E_APP_ROLE_SERVER_VERSION')
    assertFail(prepareT15EAppRoleMaintenance(input({ allocation: { ...ALLOCATION, databasePort: 5432 } })), 'T15E_APP_ROLE_MALFORMED')
    const plan = buildT15EAppRolePlan({
      roleName: ROLE,
      cluster: { dataDirectory: ALLOCATION.dataDirectory, databasePort: ALLOCATION.databasePort, databaseName: ALLOCATION.databaseName },
      catalog: { tables: [{ schema: 'public', name: 'requests' }], sequences: [] },
    })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.deepEqual(plan.plan.observation.supportedMajors, [15, 16])
  })

  it('redacts the secret from text that must not be logged', () => {
    assert.equal(redactT15EAppRoleSecret(`psql failed ${SECRET}`, SECRET), 'psql failed [REDACTED]')
    assert.equal(redactT15EAppRoleSecret(`bad ${SECRET}`, `${SECRET}'`), T15E_APP_ROLE_SAFE_MESSAGE)
  })
})
