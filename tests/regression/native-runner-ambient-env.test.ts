import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildSpawnEnvironment } from '../support/native/native-environment'
import { assertNoProtectedAmbientKeys, buildAppEnvironment } from '../support/native/postgres-instance'

/**
 * Regression coverage for the runner's ambient-environment safety split:
 *
 *  - the runner's OWN (ambient) environment must not carry protected keys
 *    (DATABASE_URL / SMTP_* / CLEAN_START_CI_DATABASE_URL) — key NAMES are
 *    checked only, values are never read;
 *  - the app environment is EXPLICITLY built by the runner and deliberately
 *    carries the runner-generated OWNED DATABASE_URL (it is allowlisted).
 *    buildAppEnvironment used to run the ambient-key assert on its own
 *    explicit map instead, which deterministically aborted EVERY native run
 *    (any mode) at createOwnedRuntime with
 *    "SAFETY: spawn env carries protected ambient keys: DATABASE_URL";
 *  - the ambient preflight must fire BEFORE the runtime root is allocated,
 *    so a rejected run leaves no directories behind.
 */

const execFileAsync = promisify(execFile)

const OWNED_DB_URL =
  'postgresql://postgres:run-generated@127.0.0.1:47112/app_cleanstart_dev?schema=public'

function appEnv() {
  return buildAppEnvironment({
    runId: 'business-test-20990101T000000-synthetic',
    ports: { databasePort: 47112, serverPort: 47113, mailPort: 47114 },
    paths: { rootDir: '/tmp/business-test-owned-synthetic', dataDir: '', socketDir: '', secretsDir: '', logsDir: '' },
    databaseUrl: OWNED_DB_URL,
    e2ePassword: 'synthetic-e2e-password',
    allowlistEnv: '{"mode":"ENFORCE","tcp":{},"unixSocketPrefixes":[],"resolvableHostnames":[]}',
  })
}

describe('ambient protected-key preflight (key names only)', () => {
  it('rejects an ambient environment carrying DATABASE_URL', () => {
    assert.throws(
      () => assertNoProtectedAmbientKeys({ PATH: '/bin', DATABASE_URL: 'never-read' }),
      /SAFETY: spawn env carries protected ambient keys: DATABASE_URL/,
    )
  })

  it('rejects ambient SMTP_* keys (any of them)', () => {
    assert.throws(
      () => assertNoProtectedAmbientKeys({ SMTP_HOST: 'never-read' }),
      /protected ambient keys: SMTP_HOST/,
    )
    assert.throws(
      () => assertNoProtectedAmbientKeys({ SMTP_PASSWORD: 'never-read' }),
      /protected ambient keys: SMTP_PASSWORD/,
    )
    assert.throws(
      () => assertNoProtectedAmbientKeys({ CLEAN_START_CI_DATABASE_URL: 'never-read' }),
      /protected ambient keys: CLEAN_START_CI_DATABASE_URL/,
    )
  })

  it('accepts a benign ambient environment (no protected key names present)', () => {
    assertNoProtectedAmbientKeys({ PATH: '/bin', HOME: '/tmp', TERM: 'xterm' })
  })
})

describe('explicit app environment keeps the runner-generated OWNED DATABASE_URL', () => {
  it('buildAppEnvironment accepts and returns the owned DATABASE_URL unchanged', () => {
    const env = appEnv()
    assert.equal(env.DATABASE_URL, OWNED_DB_URL)
    assert.equal(env.BUSINESS_MAIL_HOST, '127.0.0.1')
    assert.equal(env.BUSINESS_MAIL_PORT, '47114')
    // Regression for the original defect: this exact call used to throw the
    // ambient-key SAFETY error because the assert ran on the explicit map.
  })

  it('every key of the app environment is within the fixed allowlist', () => {
    const allowlist = [
      'DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'AUTH_TRUST_HOST', 'UPLOAD_DIR',
      'NEXT_TELEMETRY_DISABLED', 'NODE_OPTIONS', 'BUSINESS_NET_ALLOWLIST', 'BUSINESS_NET_BLOCK_LOG',
      'BUSINESS_MAIL_HOST', 'BUSINESS_MAIL_PORT', 'BUSINESS_E2E_PASSWORD', 'BUSINESS_APP_DIR',
    ]
    for (const key of Object.keys(appEnv())) {
      assert.ok(allowlist.includes(key), `unexpected app env key ${key}`)
    }
  })
})

describe('spawn environment sanitizer never inherits protected ambient keys', () => {
  it('drops ambient DATABASE_URL/SMTP_* and only keeps allowlisted keys plus explicit ones', () => {
    const env = buildSpawnEnvironment(
      { PATH: '/bin', HOME: '/tmp', DATABASE_URL: 'leak-attempt', SMTP_PASSWORD: 'leak-attempt', EDITOR: 'vim' },
      { DATABASE_URL: OWNED_DB_URL },
    )
    assert.equal(env.DATABASE_URL, OWNED_DB_URL, 'explicit owned value must win')
    assert.equal('SMTP_PASSWORD' in env, false)
    assert.equal('EDITOR' in env, false, 'ambient non-allowlisted keys are not inherited')
    assert.equal(env.PATH, '/bin')
    assert.equal(env.HOME, '/tmp')
  })
})

describe('ambient preflight fires BEFORE the runtime root is allocated', () => {
  it('a polluted runner env aborts createOwnedRuntime without creating any directory', async () => {
    const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 'native-ambient-preflight-'))
    try {
      // Run createOwnedRuntime in a subprocess whose environment carries a
      // protected key. It must fail fast with the SAFETY error and allocate
      // nothing (the parent dir must stay exactly as it was before).
      const scriptPath = path.join(tmpParent, 'run-create-owned-runtime.ts')
      await fs.writeFile(scriptPath, [
        `import { createOwnedRuntime } from ${JSON.stringify(path.resolve('tests/support/native/postgres-instance'))}`,
        `createOwnedRuntime({ parentDir: ${JSON.stringify(tmpParent)} }).then(`,
        `  (r) => { console.log('CREATED ' + r.paths.rootDir); process.exit(0) },`,
        `  (e) => { console.log('THREW ' + (e && e.message ? e.message : e)); process.exit(0) },`,
        `)`,
      ].join('\n'))
      const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx')
      const before = (await fs.readdir(tmpParent)).sort()
      const { stdout } = await execFileAsync(
        tsxBin,
        [scriptPath],
        {
          cwd: process.cwd(),
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.tmpdir(), NODE_ENV: 'test', DATABASE_URL: 'polluted-ambient' },
        },
      )
      assert.match(stdout, /THREW SAFETY: spawn env carries protected ambient keys: DATABASE_URL/)
      const after = (await fs.readdir(tmpParent)).sort()
      assert.deepEqual(after, before, 'no runtime root may be allocated when the ambient env is polluted')
    } finally {
      await fs.rm(tmpParent, { recursive: true, force: true })
    }
  })

  it('a clean runner env lets createOwnedRuntime allocate (and the test cleans it up)', async () => {
    const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), 'native-ambient-preflight-'))
    const { createOwnedRuntime, removeOwnedRuntimeRoot } = await import('../support/native/postgres-instance')
    try {
      // The test process env must be clean of protected keys for this to
      // pass — the ambient preflight is exactly what guards that.
      const runtime = await createOwnedRuntime({ parentDir: tmpParent })
      const created = (await fs.readdir(tmpParent)).length
      assert.equal(created, 1, 'exactly one owned runtime root allocated')
      await removeOwnedRuntimeRoot(runtime.paths)
      assert.deepEqual((await fs.readdir(tmpParent)).sort(), [], 'owned runtime root removed cleanly')
    } finally {
      await fs.rm(tmpParent, { recursive: true, force: true })
    }
  })
})
